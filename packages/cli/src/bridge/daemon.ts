import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";

import {
  AUTH_AWAIT_PARK_CAP_MS,
  AUTH_FIRST_MESSAGE_TIMEOUT_MS,
  AUTH_PRUNE_DEFAULT_DAYS,
  BRIDGE_LEASE_MS,
  BRIDGE_RELEASE_CLOSE_CODE,
  BRIDGE_RELEASE_CLOSE_REASON,
  DEFAULT_DAEMON_URL,
  DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
  ERROR_CODES,
  MESSAGE_TYPES,
  MODULE_ID,
  PAIRING_PENDING_MAX,
  PAIRING_REQUEST_TTL_MS,
  PROTOCOL_COMPONENTS,
  PROTOCOL_HANDSHAKES,
  PROTOCOL_VERSION,
  createErrorResponse,
  createProtocolError,
  getProtocolVersionError,
  pairingPruneCutoffAt,
  parseBridgeMessage,
  resolveEffectiveLimits,
  validateTransportMessage
} from "@fvtt-world-cli/protocol";
import pino, { type Logger } from "pino";
import { WebSocketServer } from "ws";
import type WebSocket from "ws";
import type { CliConfigStore, PersistedCliConfig, PersistedCliConfigV3 } from "../config.js";
import { PersistedCliConfigSchema, createEmptyConfig } from "../config.js";
import { isCommandResponseEnvelope, normalizeIncomingData, sendJson } from "../transport-util.js";

import {
  IdempotencyCache,
  computeRequestFingerprint,
  type IdempotencyCacheOptions
} from "./idempotency-cache.js";
import {
  BridgeSessionStore,
  DEFAULT_CLIENT_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type BridgeSessionInfo,
  type CommandRequestEnvelope
} from "./session-store.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const ACCEPTED_BRIDGE_RESPONSE_TYPES: readonly string[] = Object.freeze([MESSAGE_TYPES.COMMAND_RESPONSE]);

interface ConnectionState {
  authorizedCli: boolean;
  role: "unknown" | "bridge" | "cli" | "pairing";
  origin: string | null;
  pairingId: string | null;

  isAlive: boolean;
}

type ProtocolMismatchOrigin = {
  peer: string;
  handshake: (typeof PROTOCOL_HANDSHAKES)[keyof typeof PROTOCOL_HANDSHAKES];
};

const CLI_HELLO_ORIGIN: ProtocolMismatchOrigin = {
  peer: PROTOCOL_COMPONENTS.CLI_DAEMON,
  handshake: PROTOCOL_HANDSHAKES.CLI_DAEMON
};
const MODULE_HELLO_ORIGIN: ProtocolMismatchOrigin = {
  peer: PROTOCOL_COMPONENTS.MODULE,
  handshake: PROTOCOL_HANDSHAKES.MODULE_DAEMON
};
const CLI_COMMAND_ORIGIN: ProtocolMismatchOrigin = {
  peer: PROTOCOL_COMPONENTS.CLI_DAEMON,
  handshake: PROTOCOL_HANDSHAKES.COMMAND_REQUEST
};
const CLI_CONTROL_ORIGIN: ProtocolMismatchOrigin = {
  peer: PROTOCOL_COMPONENTS.CLI_DAEMON,
  handshake: PROTOCOL_HANDSHAKES.DAEMON_REQUEST
};

function createBridgeHelloAck({
  ok,
  error,
  limits
}: {
  ok: boolean;
  error?: unknown;

  limits?: { uploadBytes: number; wsMaxPayloadBytes: number };
}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.BRIDGE_HELLO_ACK,
    ok,
    ...(error ? { error } : {}),
    ...(limits ? { limits } : {})
  };
}

function parseListenUrl(daemonUrl: string) {
  const url = new URL(daemonUrl);
  if (url.protocol !== "ws:") {
    throw new Error(`Daemon URL must use ws://, received ${daemonUrl}`);
  }
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error(`Daemon must listen on a loopback host, received ${url.hostname}`);
  }

  return {
    host: url.hostname,
    port: Number(url.port || "80"),
    path: url.pathname === "/" ? undefined : url.pathname
  };
}

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function digestCredential(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function equalSecret(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function daemonEnvelope(
  type: string,
  id: string,
  operation: string,
  ok: boolean,
  result?: unknown,
  error?: unknown
) {
  return { protocolVersion: PROTOCOL_VERSION, type, id, operation, ok, ...(ok ? { result } : { error }) };
}

export interface BridgeDaemonOptions {
  daemonUrl?: string;
  configStore?: CliConfigStore;
  config?: PersistedCliConfig;
  requestTimeoutMs?: number;
  heartbeatIntervalMs?: number;

  idempotencyTtlMs?: number;

  uploadLimitBytes?: number;

  idempotencyCacheOptions?: IdempotencyCacheOptions;
  logger?: Logger;
}

interface PendingPairingEntry {
  code: string;
  socket: WebSocket;
  origin: string;
  expiresAt: number;
  identity: any;
}

interface AwaitWaiter {
  socket: WebSocket;
  timer: NodeJS.Timeout;
  settle: (entry: PendingPairingEntry) => void;
}

function publicPendingPairing(entry: PendingPairingEntry) {
  return {
    code: entry.code,
    expiresAt: new Date(entry.expiresAt).toISOString(),
    origin: entry.origin,
    worldId: entry.identity.world.id,
    worldTitle: entry.identity.world.title,
    userId: entry.identity.user.id,
    userName: entry.identity.user.name,
    clientId: entry.identity.client.id,
    label: entry.identity.client.label,
    moduleVersion: entry.identity.moduleVersion
  };
}

type DaemonOperationRespond = (result: unknown) => void;
type DaemonOperationReject = (code: string, text: string, details?: Record<string, unknown>) => void;
type DaemonOperationHandler = (
  params: Record<string, unknown>,
  respond: DaemonOperationRespond,
  reject: DaemonOperationReject,
  socket: WebSocket
) => void;

export class BridgeDaemon {
  daemonUrl: string;
  listenAuthority: string;
  configStore?: CliConfigStore;
  config: PersistedCliConfigV3;
  pendingPairings: Map<string, PendingPairingEntry>;
  awaitWaiters: Set<AwaitWaiter>;
  activePairingId: string | null;
  leasePairingId: string | null;
  leaseExpiresAt: number;
  logger: Logger;
  requestTimeoutMs: number;
  heartbeatIntervalMs: number;
  uploadLimitBytes: number;
  wsMaxPayloadBytes: number;
  sessionStore: BridgeSessionStore;
  idempotencyCache: IdempotencyCache;

  cachedWorldId: string | null;
  server: WebSocketServer | null;
  connectionStates: WeakMap<WebSocket, ConnectionState>;
  heartbeatTimer: NodeJS.Timeout | null;
  daemonOperations: Record<string, DaemonOperationHandler>;

  constructor({
    daemonUrl = DEFAULT_DAEMON_URL,
    configStore,
    config,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    idempotencyTtlMs = DEFAULT_IDEMPOTENCY_TTL_MS,
    idempotencyCacheOptions = {},
    uploadLimitBytes = DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
    logger = pino({ level: process.env.FVTT_WORLD_CLI_LOG_LEVEL ?? "warn" })
  }: BridgeDaemonOptions = {}) {
    this.daemonUrl = daemonUrl;
    this.listenAuthority = new URL(daemonUrl).host;
    this.configStore = configStore;
    const initialConfig = config ?? configStore?.readConfig() ?? null;
    this.config = PersistedCliConfigSchema.parse(initialConfig ?? createEmptyConfig());
    if (!initialConfig && configStore) configStore.writeConfig(this.config);
    this.pendingPairings = new Map();
    this.awaitWaiters = new Set();
    this.activePairingId = null;
    this.leasePairingId = null;
    this.leaseExpiresAt = 0;
    this.requestTimeoutMs = requestTimeoutMs;
    this.heartbeatIntervalMs = heartbeatIntervalMs;

    this.uploadLimitBytes = uploadLimitBytes;
    this.wsMaxPayloadBytes = resolveEffectiveLimits(uploadLimitBytes).wsMaxPayloadBytes;
    this.logger = logger;

    if (this.requestTimeoutMs <= DEFAULT_CLIENT_TIMEOUT_MS) {
      this.logger.warn(
        { requestTimeoutMs: this.requestTimeoutMs, clientTimeoutDefaultMs: DEFAULT_CLIENT_TIMEOUT_MS },
        `bridge --request-timeout-ms (${this.requestTimeoutMs}) is not above the CLI client wait default (${DEFAULT_CLIENT_TIMEOUT_MS}ms); with this inverted ordering slow ops surface a spurious BRIDGE_TIMEOUT and non-keyed ops reach the may-have-committed window sooner (keyed idempotent retries still dedupe safely). Raise --request-timeout-ms above the client --timeout-ms.`
      );
    }
    this.sessionStore = new BridgeSessionStore();
    this.idempotencyCache = new IdempotencyCache({
      ...idempotencyCacheOptions,
      ttlMs: idempotencyCacheOptions.ttlMs ?? idempotencyTtlMs
    });
    this.cachedWorldId = null;
    this.server = null;
    this.connectionStates = new WeakMap();
    this.heartbeatTimer = null;
    this.daemonOperations = this.createDaemonOperations();
  }

  async start() {
    if (this.server) {
      return;
    }

    const { host, port, path } = parseListenUrl(this.daemonUrl);

    const server = new WebSocketServer({ host, port, path, maxPayload: this.wsMaxPayloadBytes });

    server.on("connection", (socket, request) => {
      if (request.headers.host !== this.listenAuthority) {
        socket.close(1008, "Invalid Host");
        return;
      }
      const origin = normalizeOrigin(request.headers.origin);

      this.connectionStates.set(socket, {
        authorizedCli: false,
        role: "unknown",
        origin,
        pairingId: null,
        isAlive: true
      });

      const firstMessageTimer = setTimeout(
        () => socket.close(1008, "First message timeout"),
        AUTH_FIRST_MESSAGE_TIMEOUT_MS
      );

      socket.on("pong", () => {
        const state = this.connectionStates.get(socket);
        if (state) {
          state.isAlive = true;
        }
      });

      socket.on("message", (data) => {
        void this.handleMessage(socket, normalizeIncomingData(data)).then(() => {
          if (this.connectionStates.get(socket)?.role !== "unknown") clearTimeout(firstMessageTimer);
        });
      });
      socket.on("close", (code) => {
        clearTimeout(firstMessageTimer);
        for (const [pairingCode, pending] of this.pendingPairings) {
          if (pending.socket === socket) this.pendingPairings.delete(pairingCode);
        }
        this.dropAwaitWaiters((waiter) => waiter.socket === socket);
        const state = this.connectionStates.get(socket);
        this.stampPairingLastSeen(state?.pairingId ?? null);
        if (code === 1000 && state?.pairingId && this.sessionStore.activeBridgeSocket === socket) {
          this.activePairingId = null;
          this.leasePairingId = null;
          this.leaseExpiresAt = 0;
        }
        if (code !== 1000 && state?.pairingId && this.sessionStore.activeBridgeSocket === socket) {
          this.leasePairingId = state.pairingId;
          this.leaseExpiresAt = Date.now() + BRIDGE_LEASE_MS;
          this.activePairingId = null;
        }
        this.sessionStore.removeSocket(socket);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("listening", () => resolve());
      server.once("error", (error) => reject(error));
    });

    const address = server.address();
    if (address && typeof address !== "string") {
      const pathname = path ?? "/";
      const listenUrl = new URL(this.daemonUrl);
      listenUrl.port = String(address.port);
      this.listenAuthority = listenUrl.host;
      const runtimeHost = address.address.includes(":") ? `[${address.address}]` : address.address;
      this.daemonUrl = `ws://${runtimeHost}:${address.port}${pathname}`;
    }

    this.config = PersistedCliConfigSchema.parse({
      ...this.config,
      daemonUrl: this.daemonUrl
    });
    this.persistConfig();

    this.server = server;

    this.heartbeatTimer = setInterval(() => {
      this.sweepHeartbeats(server);
    }, this.heartbeatIntervalMs);
  }

  sweepHeartbeats(server: WebSocketServer) {
    for (const socket of server.clients) {
      const state = this.connectionStates.get(socket);
      if (!state) {
        continue;
      }

      if (!state.isAlive) {
        socket.terminate();
        continue;
      }

      state.isAlive = false;
      socket.ping();
    }
  }

  async stop() {
    if (!this.server) {
      return;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.idempotencyCache.clear();
    this.cachedWorldId = null;

    this.dropAwaitWaiters(() => true);
    this.sessionStore.clearAllPending();

    const server = this.server;
    this.server = null;

    for (const client of server.clients) {
      client.close();
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  getConnectionInfo() {
    return {
      daemonUrl: this.daemonUrl,
      bridge: this.sessionStore.getBridgeStatus()
    };
  }

  async handleMessage(socket: WebSocket, rawMessage: string) {
    const parsed = parseBridgeMessage(rawMessage);
    if (!parsed.ok) {
      this.logger.warn({ error: parsed.error }, "Rejecting invalid JSON bridge message");
      socket.close(1008, "Invalid JSON message");
      return;
    }

    const state = this.connectionStates.get(socket) ?? {
      authorizedCli: false,
      role: "unknown",
      origin: null,
      pairingId: null,
      isAlive: true
    };
    const message = parsed.value as Record<string, unknown>;

    const validationResult = validateTransportMessage(message);
    if (!validationResult.ok) {
      const rejection = (origin: ProtocolMismatchOrigin) =>
        message.protocolVersion !== undefined && message.protocolVersion !== PROTOCOL_VERSION
          ? getProtocolVersionError(String(message.protocolVersion), {
              ...origin,
              reporter: PROTOCOL_COMPONENTS.CLI_DAEMON
            })
          : createProtocolError({
              code: ERROR_CODES.INVALID_MESSAGE,
              message: "Invalid transport message",
              details: { errors: validationResult.errors }
            });
      if (state.role === "unknown" && message.type === MESSAGE_TYPES.CLIENT_HELLO) {
        sendJson(socket, {
          protocolVersion: PROTOCOL_VERSION,
          type: MESSAGE_TYPES.CLIENT_HELLO_ACK,
          ok: false,
          error: rejection(CLI_HELLO_ORIGIN)
        });
      } else if (state.role === "unknown" && message.type === MESSAGE_TYPES.PAIRING_REQUEST) {
        sendJson(socket, {
          protocolVersion: PROTOCOL_VERSION,
          type: MESSAGE_TYPES.PAIRING_RESULT,
          ok: false,
          error: rejection(MODULE_HELLO_ORIGIN)
        });
      } else if (state.role === "unknown" && message.type === MESSAGE_TYPES.BRIDGE_HELLO) {
        sendJson(socket, createBridgeHelloAck({ ok: false, error: rejection(MODULE_HELLO_ORIGIN) }));
      } else if (state.role === "cli" && message.type === MESSAGE_TYPES.COMMAND_REQUEST) {
        sendJson(
          socket,
          createErrorResponse({
            id: typeof message.id === "string" ? message.id : `invalid_${randomUUID()}`,
            error: rejection(CLI_COMMAND_ORIGIN)
          })
        );
        return;
      } else if (state.role === "cli" && message.type === MESSAGE_TYPES.DAEMON_REQUEST) {
        const id = typeof message.id === "string" && message.id ? message.id : `invalid_${randomUUID()}`;
        const operation =
          typeof message.operation === "string" && message.operation ? message.operation : "unknown";
        sendJson(
          socket,
          daemonEnvelope(
            MESSAGE_TYPES.DAEMON_RESPONSE,
            id,
            operation,
            false,
            undefined,
            rejection(CLI_CONTROL_ORIGIN)
          )
        );
        return;
      }
      socket.close(1008, "Invalid transport message");
      return;
    }

    if (state.role === "unknown" && message.type === MESSAGE_TYPES.CLIENT_HELLO) {
      if (state.origin || !equalSecret(String(message.credential), this.config.deviceCredential)) {
        sendJson(socket, {
          protocolVersion: PROTOCOL_VERSION,
          type: MESSAGE_TYPES.CLIENT_HELLO_ACK,
          ok: false,
          error: createProtocolError({
            code: ERROR_CODES.UNAUTHORIZED,
            message: "Invalid device-local client authentication"
          })
        });
        socket.close(1008, "Unauthorized client");
        return;
      }
      state.authorizedCli = true;
      state.role = "cli";
      this.connectionStates.set(socket, state);
      sendJson(socket, { protocolVersion: PROTOCOL_VERSION, type: MESSAGE_TYPES.CLIENT_HELLO_ACK, ok: true });
      return;
    }

    if (state.role === "unknown" && message.type === MESSAGE_TYPES.PAIRING_REQUEST) {
      this.handlePairingRequest(socket, state, message);
      return;
    }

    if (state.role === "unknown" && message.type === MESSAGE_TYPES.BRIDGE_HELLO) {
      this.handleBridgeMessage(socket, message);
      return;
    }

    if (
      state.role === "cli" &&
      (message.type === MESSAGE_TYPES.COMMAND_REQUEST || message.type === MESSAGE_TYPES.DAEMON_REQUEST)
    ) {
      this.handleCliMessage(socket, state, message);
      return;
    }

    if (
      state.role === "bridge" &&
      (message.type === MESSAGE_TYPES.COMMAND_RESPONSE ||
        message.type === MESSAGE_TYPES.DAEMON_REQUEST ||
        message.type === MESSAGE_TYPES.BRIDGE_GOODBYE)
    ) {
      this.handleBridgeMessage(socket, message);
      return;
    }

    socket.close(1008, "Unsupported message type");
  }

  persistConfig() {
    if (!this.configStore) return;
    const persisted = this.configStore.readConfig();
    this.config = PersistedCliConfigSchema.parse({
      ...this.config,
      ...(persisted?.uploadLimitBytes === undefined ? {} : { uploadLimitBytes: persisted.uploadLimitBytes })
    });
    this.configStore.writeConfig(this.config);
  }

  handlePairingRequest(socket: WebSocket, state: ConnectionState, message: Record<string, unknown>) {
    const identity = message.identity as any;
    if (!state.origin || !identity.user.isGM) {
      sendJson(socket, {
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_RESULT,
        ok: false,
        error: createProtocolError({ code: ERROR_CODES.INVALID_MESSAGE, message: "Invalid pairing request" })
      });
      socket.close(1008, "Invalid pairing request");
      return;
    }
    for (const [code, pending] of this.pendingPairings) {
      if (pending.expiresAt <= Date.now()) this.pendingPairings.delete(code);
      else if (
        pending.origin === state.origin &&
        pending.identity.world.id === identity.world.id &&
        pending.identity.user.id === identity.user.id &&
        pending.identity.client.id === identity.client.id
      )
        this.pendingPairings.delete(code);
    }
    if (this.pendingPairings.size >= PAIRING_PENDING_MAX) {
      sendJson(socket, {
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_RESULT,
        ok: false,
        error: createProtocolError({
          code: ERROR_CODES.BRIDGE_BUSY,
          message: "Too many pending pairing requests"
        })
      });
      return;
    }
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let code = "";
    do {
      code = Array.from(randomBytes(8), (byte) => alphabet[byte % alphabet.length]).join("");
    } while (this.pendingPairings.has(code));
    const expiresAt = Date.now() + PAIRING_REQUEST_TTL_MS;
    const entry = { code, socket, origin: state.origin, expiresAt, identity };
    this.pendingPairings.set(code, entry);
    state.role = "pairing";
    this.connectionStates.set(socket, state);
    sendJson(socket, {
      protocolVersion: PROTOCOL_VERSION,
      type: MESSAGE_TYPES.PAIRING_PENDING,
      code,
      expiresAt: new Date(expiresAt).toISOString()
    });
    this.resolveAwaitWaiters(entry);
  }

  publicPairing(entry: PersistedCliConfigV3["pairings"][number]) {
    const { credentialDigest: _credentialDigest, ...publicEntry } = entry;
    return { ...publicEntry, status: this.activePairingId === entry.pairingId ? "active" : "inactive" };
  }

  releaseActiveBridge(socket: WebSocket, closeCode: number, closeReason: string) {
    if (this.sessionStore.activeBridgeSocket !== socket) return;
    this.activePairingId = null;
    this.leasePairingId = null;
    this.leaseExpiresAt = 0;
    const state = this.connectionStates.get(socket);
    if (state) {
      // The stamp has to happen here, before pairingId is cleared: this method releases the slot
      // ahead of the close, so the socket's own close handler no longer knows which pairing it was.
      this.stampPairingLastSeen(state.pairingId);
      state.role = "unknown";
      state.pairingId = null;
    }
    this.sessionStore.removeSocket(socket);
    socket.close(closeCode, closeReason);
  }

  stampPairingLastSeen(pairingId: string | null) {
    if (!pairingId) return;
    // Stamp only a record that still exists: a pairing deleted while its browser was connected must
    // not come back through that browser's own disconnect.
    const pairing = this.config.pairings.find((entry) => entry.pairingId === pairingId);
    if (!pairing) return;
    pairing.lastSeenAt = new Date().toISOString();
    this.persistConfig();
  }

  livePendingPairings() {
    return [...this.pendingPairings.values()].filter((entry) => entry.expiresAt > Date.now());
  }

  dropAwaitWaiters(matches: (waiter: AwaitWaiter) => boolean) {
    for (const waiter of this.awaitWaiters) {
      if (!matches(waiter)) continue;
      clearTimeout(waiter.timer);
      this.awaitWaiters.delete(waiter);
    }
  }

  resolveAwaitWaiters(entry: PendingPairingEntry) {
    for (const waiter of this.awaitWaiters) {
      clearTimeout(waiter.timer);
      this.awaitWaiters.delete(waiter);
      waiter.settle(entry);
    }
  }

  createDaemonOperations(): Record<string, DaemonOperationHandler> {
    const operations: Record<string, DaemonOperationHandler> = Object.create(null);

    operations["auth.status"] = (params, respond) => {
      respond({
        bridge: this.sessionStore.getBridgeStatus(),
        pairings: this.config.pairings.map((entry) => this.publicPairing(entry))
      });
    };

    operations["auth.pending"] = (params, respond) => {
      respond({ pending: this.livePendingPairings().map((entry) => publicPendingPairing(entry)) });
    };

    operations["auth.await"] = (params, respond, _reject, socket) => {
      const [earliest] = this.livePendingPairings();
      if (earliest) {
        respond({ request: publicPendingPairing(earliest) });
        return;
      }
      const parkMs = Math.min(
        typeof params.timeoutMs === "number" ? params.timeoutMs : AUTH_AWAIT_PARK_CAP_MS,
        AUTH_AWAIT_PARK_CAP_MS
      );
      const waiter: AwaitWaiter = {
        socket,
        timer: setTimeout(() => {
          this.awaitWaiters.delete(waiter);
          respond({ request: null });
        }, parkMs),
        settle: (entry) => respond({ request: publicPendingPairing(entry) })
      };
      this.awaitWaiters.add(waiter);
    };

    operations["auth.approve"] = (params, respond, reject) => {
      const live = this.livePendingPairings();
      const code = typeof params.code === "string" ? params.code : live.length === 1 ? live[0].code : null;
      if (!code) {
        reject(ERROR_CODES.INVALID_PARAMS, "A pairing code is required when multiple requests are pending", {
          candidates: live.map((entry) => entry.code)
        });
        return;
      }

      const pending = this.pendingPairings.get(code);
      if (!pending) {
        reject(ERROR_CODES.PAIRING_NOT_FOUND, "Pairing request not found");
        return;
      }
      if (pending.expiresAt <= Date.now()) {
        this.pendingPairings.delete(code);
        reject(ERROR_CODES.PAIRING_EXPIRED, "Pairing request expired");
        return;
      }

      const credential = randomBytes(32).toString("base64url");
      const now = new Date().toISOString();
      const existing = this.config.pairings.find(
        (entry) =>
          entry.origin === pending.origin &&
          entry.worldId === pending.identity.world.id &&
          entry.userId === pending.identity.user.id &&
          entry.clientId === pending.identity.client.id
      );
      const pairingId = existing?.pairingId ?? randomUUID();
      const record = {
        pairingId,
        clientId: pending.identity.client.id,
        label: pending.identity.client.label,
        origin: pending.origin,
        worldId: pending.identity.world.id,
        worldTitle: pending.identity.world.title,
        userId: pending.identity.user.id,
        userName: pending.identity.user.name,
        createdAt: existing?.createdAt ?? now,
        lastSeenAt: now,
        credentialDigest: digestCredential(credential)
      };
      this.config.pairings = [
        ...this.config.pairings.filter((entry) => entry.pairingId !== pairingId),
        record
      ];
      this.persistConfig();
      this.pendingPairings.delete(code);
      sendJson(pending.socket, {
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_RESULT,
        ok: true,
        pairingId,
        credential
      });
      respond({ pairing: this.publicPairing(record) });
    };

    operations["auth.deny"] = (params, respond, reject) => {
      const code = String(params.code ?? "");
      const pending = this.pendingPairings.get(code);
      if (!pending) {
        reject(ERROR_CODES.PAIRING_NOT_FOUND, "Pairing request not found");
        return;
      }

      this.pendingPairings.delete(code);
      sendJson(pending.socket, {
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_RESULT,
        ok: false,
        error: createProtocolError({ code: ERROR_CODES.UNAUTHORIZED, message: "Pairing denied" })
      });
      respond({ denied: true });
    };

    operations["auth.list"] = (params, respond) => {
      respond({ pairings: this.config.pairings.map((entry) => this.publicPairing(entry)) });
    };

    operations["auth.prune"] = (params, respond) => {
      const olderThanDays =
        typeof params.olderThanDays === "number" ? params.olderThanDays : AUTH_PRUNE_DEFAULT_DAYS;
      const cutoff = pairingPruneCutoffAt(olderThanDays);
      const leaseHolder =
        this.leasePairingId && Date.now() < this.leaseExpiresAt ? this.leasePairingId : null;
      const removed = this.config.pairings.filter(
        (entry) =>
          entry.pairingId !== this.activePairingId &&
          entry.pairingId !== leaseHolder &&
          Date.parse(entry.lastSeenAt) < cutoff
      );
      const pruned = removed.map((entry) => this.publicPairing(entry));
      if (removed.length > 0) {
        const removedIds = new Set(removed.map((entry) => entry.pairingId));
        this.config.pairings = this.config.pairings.filter((entry) => !removedIds.has(entry.pairingId));
        this.persistConfig();
      }
      respond({ olderThanDays, pruned });
    };

    operations["auth.revoke"] = (params, respond, reject) => {
      const pairingId = String(params.pairingId);
      if (!this.config.pairings.some((entry) => entry.pairingId === pairingId)) {
        reject(ERROR_CODES.PAIRING_NOT_FOUND, "Pairing not found");
        return;
      }

      this.config.pairings = this.config.pairings.filter((entry) => entry.pairingId !== pairingId);
      this.persistConfig();
      respond({ revoked: true, pairingId });
      if (this.activePairingId === pairingId && this.sessionStore.activeBridgeSocket) {
        this.releaseActiveBridge(this.sessionStore.activeBridgeSocket, 1008, "Pairing revoked");
      }
    };

    operations["auth.rotate-client"] = (params, respond) => {
      this.config.deviceCredential = randomBytes(32).toString("base64url");
      this.persistConfig();
      respond({ rotated: true });
      setTimeout(() => {
        for (const client of this.server?.clients ?? []) {
          const clientState = this.connectionStates.get(client);
          if (clientState?.role === "cli") client.close(1008, "Client credential rotated");
        }
      }, 0);
    };

    operations["bridge.release"] = (params, respond) => {
      this.leasePairingId = null;
      this.leaseExpiresAt = 0;
      const active = this.sessionStore.activeBridgeSocket;
      if (active) this.releaseActiveBridge(active, BRIDGE_RELEASE_CLOSE_CODE, BRIDGE_RELEASE_CLOSE_REASON);
      respond({ released: true });
    };

    return operations;
  }

  handleDaemonRequest(socket: WebSocket, message: Record<string, unknown>) {
    const id = typeof message.id === "string" ? message.id : randomUUID();
    const operation = String(message.operation);
    const params = (message.params ?? {}) as Record<string, unknown>;
    const respond = (result: unknown) =>
      sendJson(socket, daemonEnvelope(MESSAGE_TYPES.DAEMON_RESPONSE, id, operation, true, result));
    const reject = (code: string, text: string, details: Record<string, unknown> = {}) =>
      sendJson(
        socket,
        daemonEnvelope(
          MESSAGE_TYPES.DAEMON_RESPONSE,
          id,
          operation,
          false,
          undefined,
          createProtocolError({ code, message: text, details })
        )
      );

    const handler = this.daemonOperations[operation];
    if (!handler) {
      reject(ERROR_CODES.UNKNOWN_COMMAND, `Unknown daemon operation: ${String(operation)}`);
      return;
    }

    handler(params, respond, reject, socket);
  }

  handleBridgeMessage(socket: WebSocket, message: Record<string, unknown>) {
    if (message.type === MESSAGE_TYPES.DAEMON_REQUEST) {
      const state = this.connectionStates.get(socket);
      const params = message.params as Record<string, unknown>;
      if (
        state?.role === "bridge" &&
        state.pairingId &&
        message.operation === "auth.revoke" &&
        params.pairingId === state.pairingId
      ) {
        this.handleDaemonRequest(socket, message);
      } else socket.close(1008, "Bridge control operation not allowed");
      return;
    }
    if (message.type === MESSAGE_TYPES.BRIDGE_GOODBYE) {
      const state = this.connectionStates.get(socket);
      if (
        state?.role === "bridge" &&
        state.pairingId === this.activePairingId &&
        this.sessionStore.activeBridgeSocket === socket
      ) {
        this.releaseActiveBridge(socket, 1000, "Bridge goodbye");
      } else {
        socket.close(1008, "Bridge goodbye not authorized");
      }
      return;
    }
    if (message.type === MESSAGE_TYPES.BRIDGE_HELLO) {
      const pairing = this.config.pairings.find((entry) => entry.pairingId === message.pairingId);
      const state = this.connectionStates.get(socket);
      const credentialDigest =
        typeof message.credential === "string" ? digestCredential(message.credential) : "";
      const newSession = message.session as BridgeSessionInfo;
      if (
        !pairing ||
        !state?.origin ||
        pairing.origin !== state.origin ||
        pairing.worldId !== newSession.world.id ||
        pairing.userId !== newSession.user.id ||
        pairing.clientId !== message.clientId ||
        newSession.moduleId !== MODULE_ID ||
        !newSession.user.isGM ||
        !equalSecret(credentialDigest, pairing.credentialDigest)
      ) {
        sendJson(
          socket,
          createBridgeHelloAck({
            ok: false,
            error: createProtocolError({
              code: ERROR_CODES.UNAUTHORIZED,
              message: "Bridge pairing credential or identity mismatch"
            })
          })
        );
        socket.close(1008, "Unauthorized bridge");
        return;
      }

      const leaseBusy =
        this.leasePairingId && this.leasePairingId !== pairing.pairingId && Date.now() < this.leaseExpiresAt;
      if ((this.activePairingId && this.activePairingId !== pairing.pairingId) || leaseBusy) {
        // The credential check above already passed, so this browser proved it is still in use even
        // though it never reaches the success stamp and its socket carries no pairing id to close on.
        this.stampPairingLastSeen(pairing.pairingId);
        sendJson(
          socket,
          createBridgeHelloAck({
            ok: false,
            error: createProtocolError({
              code: ERROR_CODES.BRIDGE_BUSY,
              message: "Another pairing owns the active bridge slot"
            })
          })
        );
        socket.close(1008, "Bridge busy");
        return;
      }
      this.activePairingId = pairing.pairingId;
      this.leasePairingId = null;
      state.role = "bridge";
      state.pairingId = pairing.pairingId;
      this.connectionStates.set(socket, state);
      pairing.lastSeenAt = new Date().toISOString();
      this.persistConfig();

      const idempotencyScope = `${pairing.pairingId}:${pairing.origin}:${newSession.world.id}`;
      if (this.cachedWorldId !== null && this.cachedWorldId !== idempotencyScope) {
        this.idempotencyCache.clear();
      }
      this.cachedWorldId = idempotencyScope;
      this.sessionStore.registerBridge(socket, newSession);
      sendJson(
        socket,
        createBridgeHelloAck({
          ok: true,
          limits: { uploadBytes: this.uploadLimitBytes, wsMaxPayloadBytes: this.wsMaxPayloadBytes }
        })
      );
      return;
    }

    if (!isCommandResponseEnvelope(message, ACCEPTED_BRIDGE_RESPONSE_TYPES)) {
      this.logger.warn({ message }, "Ignoring non-response message from bridge socket");
      return;
    }

    const { idempotency, worldId: matchedWorldId } = this.sessionStore.resolveResponse(message);

    if (
      idempotency &&
      message.ok === true &&
      (socket === this.sessionStore.activeBridgeSocket ||
        (matchedWorldId !== null && matchedWorldId === this.cachedWorldId))
    ) {
      this.idempotencyCache.storeIfAbsent(idempotency.key, idempotency.fingerprint, message);
    }
  }

  handleCliMessage(socket: WebSocket, state: ConnectionState, message: Record<string, unknown>) {
    const requestId = typeof message.id === "string" ? message.id : `invalid_${randomUUID()}`;

    if (!state.authorizedCli) {
      sendJson(
        socket,
        createErrorResponse({
          id: requestId,
          error: createProtocolError({
            code: ERROR_CODES.UNAUTHORIZED,
            message: "CLI credential is missing or invalid"
          })
        })
      );
      socket.close(1008, "Unauthorized CLI client");
      return;
    }

    if (message.type === MESSAGE_TYPES.DAEMON_REQUEST) {
      this.handleDaemonRequest(socket, message);
      return;
    }

    const params = (message.params ?? {}) as Record<string, unknown>;
    const idempotencyKey = typeof params.idempotencyKey === "string" ? params.idempotencyKey : null;
    let idempotency: { key: string; fingerprint: string } | undefined;

    if (idempotencyKey && params.dryRun !== true) {
      const fingerprint = computeRequestFingerprint(String(message.command), params);
      const lookup = this.idempotencyCache.lookup(idempotencyKey, fingerprint);

      if (lookup.status === "hit") {
        sendJson(socket, { ...lookup.response, id: requestId });
        return;
      }

      if (lookup.status === "conflict") {
        sendJson(
          socket,
          createErrorResponse({
            id: requestId,
            error: createProtocolError({
              code: ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT,
              message: `Idempotency key "${idempotencyKey}" was already used for a different ${message.command} request (same key, different command or params); use a fresh idempotencyKey for this new request, or resend the byte-identical original request to fetch its cached result`,
              details: {
                command: message.command,
                idempotencyKey
              }
            })
          })
        );
        return;
      }

      if (this.cachedWorldId !== null) {
        const inFlight = this.sessionStore.findInFlight(this.cachedWorldId, idempotencyKey);
        if (inFlight) {
          if (inFlight.fingerprint === fingerprint) {
            const coalesced = this.sessionStore.addWaiter(inFlight.requestId, {
              clientSocket: socket,
              requestId
            });
            if (coalesced) {
              return;
            }
            // The in-flight entry vanished between findInFlight and addWaiter — fall
            // through and forward as a fresh request.
          } else {
            sendJson(
              socket,
              createErrorResponse({
                id: requestId,
                error: createProtocolError({
                  code: ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT,
                  message: `Idempotency key "${idempotencyKey}" is already in flight for a different ${message.command} request (same key, different command or params); use a fresh idempotencyKey for this new request, or resend the byte-identical original request to coalesce onto the in-flight one`,
                  details: {
                    command: message.command,
                    idempotencyKey
                  }
                })
              })
            );
            return;
          }
        }
      }

      idempotency = { key: idempotencyKey, fingerprint };
    }

    const result = this.sessionStore.forwardRequest({
      request: message as unknown as CommandRequestEnvelope,
      clientSocket: socket,
      requestTimeoutMs: this.requestTimeoutMs,

      retentionMs: this.idempotencyCache.ttlMs,
      ...(idempotency ? { idempotency } : {}),

      ...(idempotency && this.cachedWorldId !== null ? { worldId: this.cachedWorldId } : {})
    });

    if (!result.ok) {
      sendJson(
        socket,
        createErrorResponse({
          id: requestId,
          error: result.error
        })
      );
    }
  }
}

export function createBridgeDaemon(options?: BridgeDaemonOptions) {
  return new BridgeDaemon(options);
}
