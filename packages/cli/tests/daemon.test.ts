import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { Readable } from "node:stream";

import {
  AUTH_AWAIT_PARK_CAP_MS,
  AUTH_PRUNE_DEFAULT_DAYS,
  BRIDGE_LEASE_MS,
  BRIDGE_RELEASE_CLOSE_CODE,
  COMMAND_NAMES,
  DAEMON_OPERATIONS,
  DAEMON_OPERATION_DEFINITIONS,
  DISCOVERABLE_COMMAND_NAMES,
  ERROR_CODES,
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  createBridgeHello,
  createClientHello
} from "@fvtt-world-cli/protocol";
import { CommanderError } from "commander";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { createBridgeDaemon } from "../src/bridge/daemon.js";
import { DEFAULT_CLIENT_TIMEOUT_MS } from "../src/bridge/session-store.js";
import { AWAIT_CLIENT_TIMEOUT_FLOOR_MS, AWAIT_EMPTY_POLL_DELAY_MS } from "../src/commands/auth.js";
import { createEmptyConfig } from "../src/config.js";
import { createProgram, planCliErrorOutput } from "../src/index.js";
import { DaemonTransportError } from "../src/transport-util.js";

async function freePort() {
  return await new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "string" || !address ? 0 : address.port));
    });
  });
}

async function open(url: string, origin?: string, host?: string) {
  const socket = new WebSocket(url, {
    ...(origin ? { origin } : {}),
    ...(host ? { headers: { Host: host } } : {})
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

function next(socket: WebSocket) {
  return new Promise<any>((resolve, reject) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString())));
    socket.once("error", reject);
  });
}

function nextMessages(socket: WebSocket, count: number) {
  return new Promise<any[]>((resolve, reject) => {
    const messages: any[] = [];
    const onMessage = (data: WebSocket.RawData) => {
      messages.push(JSON.parse(data.toString()));
      if (messages.length === count) {
        socket.off("message", onMessage);
        resolve(messages);
      }
    };
    socket.on("message", onMessage);
    socket.once("error", reject);
  });
}

const DEFAULT_CLIENT_ID = "a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5";
const SECOND_CLIENT_ID = "b2b2b2b2c3c3d4d4e5e5f6f6a7a7b8b8";
const THIRD_CLIENT_ID = "c3c3c3c3d4d4e5e5f6f6a7a7b8b8c9c9";

function pairingIdentity({
  worldId = "world-1",
  userId = "gm-1",
  clientId = DEFAULT_CLIENT_ID,
  label = "Zen Browser"
}: { worldId?: string; userId?: string; clientId?: string; label?: string } = {}) {
  const identity = session(worldId, userId);
  return {
    moduleId: identity.moduleId,
    moduleVersion: identity.moduleVersion,
    world: identity.world,
    user: identity.user,
    client: { id: clientId, label }
  };
}

function session(worldId = "world-1", userId = "gm-1", commands = ["system.ping"]) {
  return {
    moduleId: "fvtt-world-cli",
    moduleVersion: "1.0.0",
    world: { id: worldId, title: "World" },
    user: { id: userId, name: "GM", isGM: true },
    commands
  };
}

function addPairing(
  config: ReturnType<typeof createEmptyConfig>,
  {
    pairingId,
    credential,
    origin = "http://localhost:30000",
    worldId = "world-1",
    userId = "gm-1",
    clientId = DEFAULT_CLIENT_ID,
    label = "Zen Browser",
    createdAt,
    lastSeenAt
  }: {
    pairingId: string;
    credential: string;
    origin?: string;
    worldId?: string;
    userId?: string;
    clientId?: string;
    label?: string;
    createdAt?: string;
    lastSeenAt?: string;
  }
) {
  const now = new Date().toISOString();
  config.pairings.push({
    pairingId,
    clientId,
    label,
    origin,
    worldId,
    worldTitle: worldId,
    userId,
    userName: userId,
    createdAt: createdAt ?? now,
    lastSeenAt: lastSeenAt ?? now,
    credentialDigest: createHash("sha256").update(credential).digest("hex")
  });
}

async function connectBridge(
  daemon: ReturnType<typeof createBridgeDaemon>,
  {
    pairingId,
    credential,
    origin = "http://localhost:30000",
    worldId = "world-1",
    userId = "gm-1",
    clientId = DEFAULT_CLIENT_ID,
    commands = ["system.ping"]
  }: {
    pairingId: string;
    credential: string;
    origin?: string;
    worldId?: string;
    userId?: string;
    clientId?: string;
    commands?: string[];
  }
) {
  const socket = await open(daemon.daemonUrl, origin);
  sockets.push(socket);
  const ack = next(socket);
  socket.send(
    JSON.stringify(
      createBridgeHello({
        pairingId,
        credential,
        clientId,
        session: session(worldId, userId, commands)
      })
    )
  );
  return { socket, ack: await ack };
}

async function connectCli(daemon: ReturnType<typeof createBridgeDaemon>, credential: string) {
  const socket = await open(daemon.daemonUrl);
  sockets.push(socket);
  const ack = next(socket);
  socket.send(JSON.stringify(createClientHello({ credential })));
  expect(await ack).toMatchObject({ type: MESSAGE_TYPES.CLIENT_HELLO_ACK, ok: true });
  return socket;
}

async function requestPairing(
  daemon: ReturnType<typeof createBridgeDaemon>,
  identity: Parameters<typeof pairingIdentity>[0] = {}
) {
  const browser = await open(daemon.daemonUrl, "http://localhost:30000");
  sockets.push(browser);
  const pending = next(browser);
  browser.send(
    JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      type: MESSAGE_TYPES.PAIRING_REQUEST,
      identity: pairingIdentity(identity)
    })
  );
  return { browser, pending: await pending };
}

async function control(
  socket: WebSocket,
  id: string,
  operation: string,
  params: Record<string, unknown> = {}
) {
  const response = next(socket);
  socket.send(
    JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      type: MESSAGE_TYPES.DAEMON_REQUEST,
      id,
      operation,
      params
    })
  );
  return await response;
}

async function startStubControlDaemon(
  respond: (request: { id: string; operation: string }, reply: (response: unknown) => void) => void
) {
  const port = await freePort();
  const server = new WebSocketServer({ host: "127.0.0.1", port });
  stubServers.push(server);
  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as { type?: string; id: string; operation: string };
      if (message.type === MESSAGE_TYPES.CLIENT_HELLO) {
        socket.send(
          JSON.stringify({
            protocolVersion: PROTOCOL_VERSION,
            type: MESSAGE_TYPES.CLIENT_HELLO_ACK,
            ok: true
          })
        );
        return;
      }
      respond({ id: message.id, operation: message.operation }, (response) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(response));
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  return { daemonUrl: `ws://127.0.0.1:${port}`, config: createEmptyConfig() };
}

async function runAuthCli(
  daemon: { daemonUrl: string; config: ReturnType<typeof createEmptyConfig> },
  args: string[],
  { answer, isTTY = true }: { answer?: string | (() => Promise<string>); isTTY?: boolean } = {}
) {
  let output = "";
  const stdin = Readable.from(
    (async function* answerLines() {
      if (answer === undefined) return;
      yield `${typeof answer === "function" ? await answer() : answer}\n`;
    })()
  ) as Readable & { isTTY?: boolean };
  stdin.isTTY = isTTY;
  const program = createProgram({
    stdout: { write: (chunk: string) => void (output += chunk) },
    stderr: { write: () => {} },
    stdin,
    configStore: {
      getConfigPath: () => "/tmp/fvtt-world-cli-daemon-test-config.json",
      readConfig: () => daemon.config,
      writeConfig: () => {}
    }
  });
  program.exitOverride();

  let error: unknown = null;
  try {
    await program.parseAsync(["node", "fvtt-world-cli", "--daemon-url", daemon.daemonUrl, ...args], {
      from: "node"
    });
  } catch (thrown) {
    error = thrown;
  }
  return { output, error };
}

function closed(socket: WebSocket) {
  return new Promise<{ code: number; reason: string }>((resolve) =>
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }))
  );
}

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 1_000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for daemon state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function itemCreateRequest(id: string, idempotencyKey: string, name = "Sword", dryRun = false) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.COMMAND_REQUEST,
    id,
    command: "item.create",
    params: { data: { name, type: "weapon" }, idempotencyKey, ...(dryRun ? { dryRun: true } : {}) }
  };
}

async function startItemDaemon(options: Record<string, unknown> = {}) {
  const credential = "b".repeat(43);
  const config = createEmptyConfig();
  addPairing(config, { pairingId: "pair-1", credential });
  const daemon = createBridgeDaemon({
    daemonUrl: `ws://127.0.0.1:${await freePort()}`,
    config,
    logger: pino({ level: "silent" }),
    ...options
  });
  daemons.push(daemon);
  await daemon.start();
  const bridge = await connectBridge(daemon, { pairingId: "pair-1", credential, commands: ["item.create"] });
  const cli = await connectCli(daemon, config.deviceCredential);
  return { daemon, bridge: bridge.socket, cli };
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function startPrunableDaemon(config: ReturnType<typeof createEmptyConfig>) {
  const writes: Array<ReturnType<typeof createEmptyConfig>> = [];
  const daemon = createBridgeDaemon({
    daemonUrl: `ws://127.0.0.1:${await freePort()}`,
    config,
    configStore: {
      getConfigPath: () => "/tmp/fvtt-world-cli-prune-test-config.json",
      readConfig: () => null,
      writeConfig: (written) => void writes.push(structuredClone(written))
    },
    logger: pino({ level: "silent" })
  });
  daemons.push(daemon);
  await daemon.start();
  const writesAfterStart = writes.length;
  return { daemon, writes, writesAfterStart };
}

async function startPairingDaemon() {
  const daemon = createBridgeDaemon({
    daemonUrl: `ws://127.0.0.1:${await freePort()}`,
    config: createEmptyConfig(),
    logger: pino({ level: "silent" })
  });
  daemons.push(daemon);
  await daemon.start();
  return daemon;
}

const DAEMON_OPERATION_PROBES: Record<string, Record<string, unknown>> = {
  "auth.status": {},
  "auth.pending": {},
  "auth.await": { timeoutMs: 0 },
  "auth.approve": {},
  "auth.deny": { code: "ABCDEFGH" },
  "auth.list": {},
  "auth.prune": { olderThanDays: 30 },
  "auth.revoke": { pairingId: "absent-pairing" },
  "auth.rotate-client": {},
  "bridge.release": {}
};

const daemons: Array<{ stop(): Promise<void> }> = [];
const sockets: WebSocket[] = [];
const stubServers: WebSocketServer[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const daemon of daemons.splice(0)) await daemon.stop();
  for (const server of stubServers.splice(0)) {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("authorization daemon", () => {
  it("authenticates a local client with client.hello", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const socket = await open(daemon.daemonUrl);
    sockets.push(socket);
    socket.send(JSON.stringify(createClientHello({ credential: config.deviceCredential })));
    expect(await next(socket)).toMatchObject({ type: MESSAGE_TYPES.CLIENT_HELLO_ACK, ok: true });
  });

  it("accepts the configured localhost authority after binding and rejects unrelated Host authorities", async () => {
    const port = await freePort();
    const configuredUrl = `ws://localhost:${port}`;
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: configuredUrl,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();

    const socket = await open(daemon.daemonUrl, undefined, new URL(configuredUrl).host);
    sockets.push(socket);
    const ack = next(socket);
    socket.send(JSON.stringify(createClientHello({ credential: config.deviceCredential })));
    expect(await ack).toMatchObject({ type: MESSAGE_TYPES.CLIENT_HELLO_ACK, ok: true });

    const wrongName = await open(daemon.daemonUrl, undefined, `example.test:${port}`);
    sockets.push(wrongName);
    expect(await closed(wrongName)).toMatchObject({ code: 1008, reason: "Invalid Host" });

    const wrongPort = await open(daemon.daemonUrl, undefined, `localhost:${port + 1}`);
    sockets.push(wrongPort);
    expect(await closed(wrongPort)).toMatchObject({ code: 1008, reason: "Invalid Host" });
  });

  it("pairs over the original browser socket and persists only the digest", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const browser = await open(daemon.daemonUrl, "http://localhost:30000");
    sockets.push(browser);
    browser.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_REQUEST,
        identity: pairingIdentity()
      })
    );
    const pending = await next(browser);
    const client = await open(daemon.daemonUrl);
    sockets.push(client);
    client.send(JSON.stringify(createClientHello({ credential: config.deviceCredential })));
    await next(client);
    client.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.DAEMON_REQUEST,
        id: "approve",
        operation: "auth.approve",
        params: { code: pending.code }
      })
    );
    const [control, result] = await Promise.all([next(client), next(browser)]);
    expect(control.ok).toBe(true);
    expect(result.ok).toBe(true);
    expect(daemon.config.pairings).toHaveLength(1);
    expect(daemon.config.pairings[0].credentialDigest).toBe(
      createHash("sha256").update(result.credential).digest("hex")
    );
    expect(JSON.stringify(daemon.config)).not.toContain(result.credential);
  });

  it("rejects another pairing without displacement and permits same-pairing takeover", async () => {
    const credential = "b".repeat(43);
    const otherCredential = "c".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-1", credential });
    addPairing(config, {
      pairingId: "pair-2",
      credential: otherCredential,
      worldId: "world-2",
      userId: "gm-2"
    });
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const { socket: first, ack } = await connectBridge(daemon, { pairingId: "pair-1", credential });
    expect(ack.ok).toBe(true);
    const busy = await connectBridge(daemon, {
      pairingId: "pair-2",
      credential: otherCredential,
      worldId: "world-2",
      userId: "gm-2"
    });
    expect(busy.ack).toMatchObject({ ok: false, error: { code: ERROR_CODES.BRIDGE_BUSY } });
    expect(daemon.activePairingId).toBe("pair-1");
    const displaced = closed(first);
    const replacement = await connectBridge(daemon, { pairingId: "pair-1", credential });
    expect(replacement.ack.ok).toBe(true);
    expect(await displaced).toMatchObject({
      code: 4001,
      reason: "Bridge session taken over by the same pairing"
    });
  });

  it("does not let an unauthenticated bridge socket release the active owner", async () => {
    const credential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-1", credential });
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const active = await connectBridge(daemon, { pairingId: "pair-1", credential });
    expect(active.ack.ok).toBe(true);

    const attacker = await open(daemon.daemonUrl, "http://localhost:30000");
    sockets.push(attacker);
    const rejected = next(attacker);
    attacker.send(
      JSON.stringify(
        createBridgeHello({
          pairingId: "pair-1",
          credential: "x".repeat(43),
          clientId: DEFAULT_CLIENT_ID,
          session: session()
        })
      )
    );
    attacker.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: MESSAGE_TYPES.BRIDGE_GOODBYE }));
    expect(await rejected).toMatchObject({ ok: false, error: { code: ERROR_CODES.UNAUTHORIZED } });
    await closed(attacker);

    expect(daemon.activePairingId).toBe("pair-1");
    expect(daemon.activePairingId).toBe("pair-1");
  });

  it("fails in-flight requests immediately when the same pairing takes over", async () => {
    const credential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-1", credential });
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      requestTimeoutMs: 5_000,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const first = await connectBridge(daemon, { pairingId: "pair-1", credential });
    const cli = await connectCli(daemon, config.deviceCredential);
    const forwarded = next(first.socket);
    const failed = next(cli);
    cli.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_REQUEST,
        id: "pending-1",
        command: "system.ping",
        params: {}
      })
    );
    expect(await forwarded).toMatchObject({ id: "pending-1", command: "system.ping" });

    const replacement = await connectBridge(daemon, { pairingId: "pair-1", credential });
    expect(replacement.ack.ok).toBe(true);
    expect(await failed).toMatchObject({
      id: "pending-1",
      ok: false,
      error: { code: ERROR_CODES.BRIDGE_DISCONNECTED, details: { reason: "taken-over" } }
    });
    expect(daemon.sessionStore.pendingRequests.size).toBe(0);
  });

  it("closes a malformed first frame instead of disabling the authentication deadline", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const socket = await open(daemon.daemonUrl);
    sockets.push(socket);
    const close = closed(socket);
    socket.send("{not-json");
    expect(await close).toMatchObject({ code: 1008, reason: "Invalid JSON message" });
  });

  it("forwards commands, relays responses, and reports a bounded bridge timeout", async () => {
    const credential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-1", credential });
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      requestTimeoutMs: 25,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const bridge = await connectBridge(daemon, { pairingId: "pair-1", credential });
    const cli = await connectCli(daemon, config.deviceCredential);

    const forwarded = next(bridge.socket);
    cli.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_REQUEST,
        id: "ok-1",
        command: "system.ping",
        params: {}
      })
    );
    expect(await forwarded).toMatchObject({ id: "ok-1" });
    const success = next(cli);
    bridge.socket.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_RESPONSE,
        id: "ok-1",
        ok: true,
        result: { pong: true }
      })
    );
    expect(await success).toMatchObject({ id: "ok-1", ok: true, result: { pong: true } });

    const timedForward = next(bridge.socket);
    const timedOut = next(cli);
    cli.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_REQUEST,
        id: "timeout-1",
        command: "system.ping",
        params: {}
      })
    );
    await timedForward;
    expect(await timedOut).toMatchObject({
      id: "timeout-1",
      ok: false,
      error: { code: ERROR_CODES.BRIDGE_TIMEOUT }
    });
  });

  it("refuses a bridge-sent daemon.response frame at the router instead of resolving the pending request", async () => {
    const credential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-1", credential });
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const bridge = await connectBridge(daemon, { pairingId: "pair-1", credential });
    const cli = await connectCli(daemon, config.deviceCredential);

    const forwarded = next(bridge.socket);
    cli.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_REQUEST,
        id: "spoof-1",
        command: "system.ping",
        params: {}
      })
    );
    expect(await forwarded).toMatchObject({ id: "spoof-1" });

    const relayed = next(cli);
    const bridgeClosed = closed(bridge.socket);
    bridge.socket.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.DAEMON_RESPONSE,
        id: "spoof-1",
        operation: "auth.status",
        ok: true,
        result: { spoofed: true }
      })
    );

    expect(await bridgeClosed).toMatchObject({ code: 1008, reason: "Unsupported message type" });
    expect(await relayed).toMatchObject({
      id: "spoof-1",
      ok: false,
      error: { code: ERROR_CODES.BRIDGE_DISCONNECTED }
    });
    expect(daemon.sessionStore.pendingRequests.size).toBe(0);
  });

  it("releases cleanly, leases abnormal disconnects, and admits another pairing after lease expiry", async () => {
    const firstCredential = "b".repeat(43);
    const secondCredential = "c".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-1", credential: firstCredential });
    addPairing(config, {
      pairingId: "pair-2",
      credential: secondCredential,
      worldId: "world-2",
      userId: "gm-2"
    });
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();

    const first = await connectBridge(daemon, { pairingId: "pair-1", credential: firstCredential });
    const firstClosed = closed(first.socket);
    first.socket.send(
      JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: MESSAGE_TYPES.BRIDGE_GOODBYE })
    );
    expect(await firstClosed).toMatchObject({ code: 1000 });
    const second = await connectBridge(daemon, {
      pairingId: "pair-2",
      credential: secondCredential,
      worldId: "world-2",
      userId: "gm-2"
    });
    expect(second.ack.ok).toBe(true);

    const abnormal = closed(second.socket);
    second.socket.terminate();
    await abnormal;
    await waitFor(() => daemon.leasePairingId === "pair-2");
    expect(daemon.leasePairingId).toBe("pair-2");
    const leasedOut = await connectBridge(daemon, { pairingId: "pair-1", credential: firstCredential });
    expect(leasedOut.ack).toMatchObject({ ok: false, error: { code: ERROR_CODES.BRIDGE_BUSY } });
    daemon.leaseExpiresAt = Date.now() - 1;
    const afterExpiry = await connectBridge(daemon, { pairingId: "pair-1", credential: firstCredential });
    expect(afterExpiry.ack.ok).toBe(true);
  });

  it("uses the terminal release close code for bridge.release", async () => {
    const credential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-1", credential });
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const bridge = await connectBridge(daemon, { pairingId: "pair-1", credential });
    const cli = await connectCli(daemon, config.deviceCredential);
    const bridgeClosed = closed(bridge.socket);

    expect(await control(cli, "release-1", "bridge.release")).toMatchObject({
      ok: true,
      result: { released: true }
    });
    expect(await bridgeClosed).toMatchObject({ code: BRIDGE_RELEASE_CLOSE_CODE, reason: "Bridge released" });
    expect(daemon.activePairingId).toBeNull();
    expect(daemon.leasePairingId).toBeNull();
  });

  it("reports only advertised commands in the bridge session status while still forwarding the rest", async () => {
    const credential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-1", credential });
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const bridge = await connectBridge(daemon, {
      pairingId: "pair-1",
      credential,
      commands: [...COMMAND_NAMES]
    });
    const cli = await connectCli(daemon, config.deviceCredential);

    const status = await control(cli, "status-1", "auth.status");

    expect(status).toMatchObject({ ok: true });
    const reported = (status as { result: { bridge: { session: { commands: string[] } } } }).result.bridge
      .session.commands;
    expect(reported).toEqual([...DISCOVERABLE_COMMAND_NAMES]);
    const undiscoverable = COMMAND_NAMES.filter((name) => !DISCOVERABLE_COMMAND_NAMES.includes(name));
    expect(undiscoverable.length).toBeGreaterThan(0);
    for (const command of undiscoverable)
      expect(reported, `${command} must not be advertised`).not.toContain(command);

    expect(undiscoverable).toContain("policy.snapshot");
    const forwarded = next(bridge.socket);
    cli.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_REQUEST,
        id: "hidden-1",
        command: "policy.snapshot",
        params: {}
      })
    );
    expect(await forwarded).toMatchObject({ id: "hidden-1", command: "policy.snapshot" });
  });

  it("revokes an active pairing without creating a lease and never discloses stored secrets", async () => {
    const firstCredential = "b".repeat(43);
    const secondCredential = "c".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-1", credential: firstCredential });
    addPairing(config, {
      pairingId: "pair-2",
      credential: secondCredential,
      worldId: "world-2",
      userId: "gm-2"
    });
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const bridge = await connectBridge(daemon, { pairingId: "pair-1", credential: firstCredential });
    const cli = await connectCli(daemon, config.deviceCredential);

    const status = await control(cli, "status-1", "auth.status");
    expect(JSON.stringify(status)).not.toContain("credentialDigest");
    expect(JSON.stringify(status)).not.toContain(firstCredential);
    const bridgeClosed = closed(bridge.socket);
    const revocationResponse = next(bridge.socket);
    bridge.socket.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.DAEMON_REQUEST,
        id: "revoke-1",
        operation: "auth.revoke",
        params: { pairingId: "pair-1" }
      })
    );
    const revoked = await revocationResponse;
    expect(revoked).toMatchObject({
      operation: "auth.revoke",
      ok: true,
      result: { revoked: true, pairingId: "pair-1" }
    });
    await bridgeClosed;
    expect(daemon.leasePairingId).toBeNull();
    expect(daemon.activePairingId).toBeNull();

    const second = await connectBridge(daemon, {
      pairingId: "pair-2",
      credential: secondCredential,
      worldId: "world-2",
      userId: "gm-2"
    });
    expect(second.ack.ok).toBe(true);
  });

  it("lists the live pending pairing requests and omits the expired ones", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const cli = await connectCli(daemon, config.deviceCredential);

    expect(await control(cli, "pending-empty", "auth.pending")).toMatchObject({
      ok: true,
      result: { pending: [] }
    });

    const live = await requestPairing(daemon);
    const stale = await requestPairing(daemon, { worldId: "world-2", userId: "gm-2" });
    daemon.pendingPairings.get(stale.pending.code)!.expiresAt = Date.now() - 1;

    const listed = await control(cli, "pending-1", "auth.pending");
    expect(listed).toMatchObject({ operation: "auth.pending", ok: true });
    expect(listed.result.pending).toEqual([
      {
        code: live.pending.code,
        expiresAt: new Date(daemon.pendingPairings.get(live.pending.code)!.expiresAt).toISOString(),
        origin: "http://localhost:30000",
        worldId: "world-1",
        worldTitle: "World",
        userId: "gm-1",
        userName: "GM",
        clientId: DEFAULT_CLIENT_ID,
        label: "Zen Browser",
        moduleVersion: "1.0.0"
      }
    ]);
  });

  it("lists stored pairings with their activity status and never discloses stored secrets", async () => {
    const activeCredential = "b".repeat(43);
    const idleCredential = "c".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-1", credential: activeCredential });
    addPairing(config, {
      pairingId: "pair-2",
      credential: idleCredential,
      worldId: "world-2",
      userId: "gm-2"
    });
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    await connectBridge(daemon, { pairingId: "pair-1", credential: activeCredential });
    const cli = await connectCli(daemon, config.deviceCredential);

    const listed = await control(cli, "list-1", "auth.list");
    expect(listed).toMatchObject({ operation: "auth.list", ok: true });
    expect(listed.result.pairings).toMatchObject([
      { pairingId: "pair-1", worldId: "world-1", userId: "gm-1", status: "active" },
      { pairingId: "pair-2", worldId: "world-2", userId: "gm-2", status: "inactive" }
    ]);
    expect(Object.keys(listed.result.pairings[0]).sort()).toEqual([
      "clientId",
      "createdAt",
      "label",
      "lastSeenAt",
      "origin",
      "pairingId",
      "status",
      "userId",
      "userName",
      "worldId",
      "worldTitle"
    ]);
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain("credentialDigest");
    expect(serialized).not.toContain('"name"');
    expect(serialized).not.toContain(activeCredential);
    expect(serialized).not.toContain(idleCredential);
  });

  it("answers every daemon control operation the protocol declares", async () => {
    expect(Object.keys(DAEMON_OPERATION_PROBES).sort()).toEqual([...DAEMON_OPERATIONS].sort());

    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();

    for (const operation of DAEMON_OPERATIONS) {
      const params = DAEMON_OPERATION_PROBES[operation];
      expect(params, `no probe params are defined for daemon operation ${operation}`).toBeDefined();
      const cli = await connectCli(daemon, daemon.config.deviceCredential);
      const response = await control(cli, `probe-${operation}`, operation, params);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(response).toMatchObject({
        type: MESSAGE_TYPES.DAEMON_RESPONSE,
        id: `probe-${operation}`,
        operation
      });
      expect(
        response.error?.code,
        `the probe params for daemon operation ${operation} are rejected by transport validation, so this probe never reaches the operation handler`
      ).not.toBe(ERROR_CODES.INVALID_MESSAGE);
      expect(
        response.error?.code,
        `daemon operation ${operation} is declared by the protocol but left unhandled`
      ).not.toBe(ERROR_CODES.UNKNOWN_COMMAND);
    }
  });

  it("keeps a parked pairing wait shorter than the client request timeout", () => {
    expect(AWAIT_CLIENT_TIMEOUT_FLOOR_MS).toBeGreaterThan(AUTH_AWAIT_PARK_CAP_MS);
    expect(AWAIT_CLIENT_TIMEOUT_FLOOR_MS).toBeLessThan(DEFAULT_CLIENT_TIMEOUT_MS);
    expect(DAEMON_OPERATION_DEFINITIONS["auth.await"].paramsSchema.properties.timeoutMs.maximum).toBe(
      AUTH_AWAIT_PARK_CAP_MS
    );
  });

  it("answers a pairing wait immediately with the earliest live request", async () => {
    const daemon = await startPairingDaemon();
    const first = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
    await requestPairing(daemon, { clientId: THIRD_CLIENT_ID, label: "Chrome" });
    const cli = await connectCli(daemon, daemon.config.deviceCredential);

    const response = await control(cli, "await-1", "auth.await", { timeoutMs: 0 });

    expect(response).toMatchObject({
      ok: true,
      result: { request: { code: first.pending.code, clientId: SECOND_CLIENT_ID, label: "Zen Browser" } }
    });
    expect(JSON.stringify(response)).not.toContain("credential");
    expect(daemon.awaitWaiters.size).toBe(0);
  });

  it("parks a pairing wait until a request arrives", async () => {
    const daemon = await startPairingDaemon();
    const cli = await connectCli(daemon, daemon.config.deviceCredential);
    const parked = control(cli, "await-1", "auth.await", { timeoutMs: 10_000 });
    await waitFor(() => daemon.awaitWaiters.size === 1);

    const requested = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });

    expect(await parked).toMatchObject({
      ok: true,
      result: { request: { code: requested.pending.code, label: "Zen Browser" } }
    });
    expect(daemon.awaitWaiters.size).toBe(0);
  });

  it("resolves every parked pairing wait with the same arriving request", async () => {
    const daemon = await startPairingDaemon();
    const firstCli = await connectCli(daemon, daemon.config.deviceCredential);
    const secondCli = await connectCli(daemon, daemon.config.deviceCredential);
    const parked = [
      control(firstCli, "await-1", "auth.await", { timeoutMs: 10_000 }),
      control(secondCli, "await-2", "auth.await", { timeoutMs: 10_000 })
    ];
    await waitFor(() => daemon.awaitWaiters.size === 2);

    const requested = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });

    for (const response of await Promise.all(parked)) {
      expect(response).toMatchObject({ ok: true, result: { request: { code: requested.pending.code } } });
    }
    expect(daemon.awaitWaiters.size).toBe(0);
  });

  it("ends a parked pairing wait with an empty result when a caller-requested park elapses", async () => {
    const daemon = await startPairingDaemon();
    const cli = await connectCli(daemon, daemon.config.deviceCredential);

    expect(await control(cli, "await-1", "auth.await", { timeoutMs: 20 })).toMatchObject({
      ok: true,
      result: { request: null }
    });
    expect(daemon.awaitWaiters.size).toBe(0);
  });

  it("ends a pairing wait that requests no park length with an empty result at the park cap", async () => {
    const daemon = await startPairingDaemon();
    const cli = await connectCli(daemon, daemon.config.deviceCredential);
    const answers: unknown[] = [];
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      daemon.daemonOperations["auth.await"](
        {},
        (result) => answers.push(result),
        () => {},
        cli
      );
      expect(daemon.awaitWaiters.size).toBe(1);

      vi.advanceTimersByTime(AUTH_AWAIT_PARK_CAP_MS - 1);
      expect(answers).toEqual([]);
      vi.advanceTimersByTime(1);

      expect(answers).toEqual([{ request: null }]);
      expect(daemon.awaitWaiters.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("parks a pairing wait that requests no park length instead of answering it empty", async () => {
    const daemon = await startPairingDaemon();
    const cli = await connectCli(daemon, daemon.config.deviceCredential);
    const parked = control(cli, "await-1", "auth.await");
    await waitFor(() => daemon.awaitWaiters.size === 1);

    const requested = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });

    expect(await parked).toMatchObject({
      ok: true,
      result: { request: { code: requested.pending.code, label: "Zen Browser" } }
    });
    expect(daemon.awaitWaiters.size).toBe(0);
  });

  it("drops a parked pairing wait when its client disconnects", async () => {
    const daemon = await startPairingDaemon();
    const cli = await connectCli(daemon, daemon.config.deviceCredential);
    void control(cli, "await-1", "auth.await", { timeoutMs: 10_000 });
    await waitFor(() => daemon.awaitWaiters.size === 1);

    cli.close();
    await waitFor(() => daemon.awaitWaiters.size === 0);

    await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
    expect(daemon.awaitWaiters.size).toBe(0);
  });

  it("removes only the pairings idle longer than the requested cutoff", async () => {
    const config = createEmptyConfig();
    addPairing(config, {
      pairingId: "pair-stale",
      credential: "b".repeat(43),
      label: "Old Chrome",
      lastSeenAt: daysAgo(11)
    });
    addPairing(config, {
      pairingId: "pair-fresh",
      credential: "c".repeat(43),
      worldId: "world-2",
      userId: "gm-2",
      lastSeenAt: daysAgo(9)
    });
    const { daemon, writes, writesAfterStart } = await startPrunableDaemon(config);
    const cli = await connectCli(daemon, daemon.config.deviceCredential);

    const response = await control(cli, "prune-1", "auth.prune", { olderThanDays: 10 });

    expect(response).toMatchObject({ operation: "auth.prune", ok: true, result: { olderThanDays: 10 } });
    expect(response.result.pruned).toMatchObject([
      { pairingId: "pair-stale", label: "Old Chrome", status: "inactive" }
    ]);
    expect(Object.keys(response.result.pruned[0])).not.toContain("credentialDigest");
    expect(JSON.stringify(response)).not.toContain("b".repeat(43));
    expect(daemon.config.pairings.map((entry) => entry.pairingId)).toEqual(["pair-fresh"]);
    expect(writes.length).toBe(writesAfterStart + 1);
    expect(writes.at(-1)!.pairings.map((entry) => entry.pairingId)).toEqual(["pair-fresh"]);
  });

  it("applies a thirty-day cutoff when no cutoff is requested", async () => {
    const config = createEmptyConfig();
    addPairing(config, {
      pairingId: "pair-stale",
      credential: "b".repeat(43),
      lastSeenAt: daysAgo(AUTH_PRUNE_DEFAULT_DAYS + 1)
    });
    addPairing(config, {
      pairingId: "pair-fresh",
      credential: "c".repeat(43),
      worldId: "world-2",
      userId: "gm-2",
      lastSeenAt: daysAgo(AUTH_PRUNE_DEFAULT_DAYS - 1)
    });
    const { daemon } = await startPrunableDaemon(config);
    const cli = await connectCli(daemon, daemon.config.deviceCredential);

    const response = await control(cli, "prune-1", "auth.prune");

    expect(response).toMatchObject({
      ok: true,
      result: { olderThanDays: AUTH_PRUNE_DEFAULT_DAYS, pruned: [{ pairingId: "pair-stale" }] }
    });
    expect(daemon.config.pairings.map((entry) => entry.pairingId)).toEqual(["pair-fresh"]);
  });

  it("keeps the active bridge pairing and a live lease holder however idle they look", async () => {
    const activeCredential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-active", credential: activeCredential });
    addPairing(config, {
      pairingId: "pair-leased",
      credential: "c".repeat(43),
      worldId: "world-2",
      userId: "gm-2"
    });
    addPairing(config, {
      pairingId: "pair-idle",
      credential: "d".repeat(43),
      worldId: "world-3",
      userId: "gm-3"
    });
    const { daemon, writes, writesAfterStart } = await startPrunableDaemon(config);
    await connectBridge(daemon, { pairingId: "pair-active", credential: activeCredential });
    const cli = await connectCli(daemon, daemon.config.deviceCredential);
    for (const entry of daemon.config.pairings) entry.lastSeenAt = daysAgo(90);
    daemon.leasePairingId = "pair-leased";
    daemon.leaseExpiresAt = Date.now() + BRIDGE_LEASE_MS;

    const response = await control(cli, "prune-1", "auth.prune", { olderThanDays: 0 });

    expect(response).toMatchObject({ ok: true, result: { pruned: [{ pairingId: "pair-idle" }] } });
    expect(daemon.config.pairings.map((entry) => entry.pairingId)).toEqual(["pair-active", "pair-leased"]);
    expect(daemon.activePairingId).toBe("pair-active");

    daemon.leaseExpiresAt = Date.now() - 1;
    const afterLease = await control(cli, "prune-2", "auth.prune", { olderThanDays: 0 });

    expect(afterLease).toMatchObject({ ok: true, result: { pruned: [{ pairingId: "pair-leased" }] } });
    expect(daemon.config.pairings.map((entry) => entry.pairingId)).toEqual(["pair-active"]);
    expect(writes.length).toBe(writesAfterStart + 3);
  });

  it("answers a prune that matches nothing without rewriting the config", async () => {
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-fresh", credential: "b".repeat(43) });
    const { daemon, writes, writesAfterStart } = await startPrunableDaemon(config);
    const cli = await connectCli(daemon, daemon.config.deviceCredential);

    const response = await control(cli, "prune-1", "auth.prune", { olderThanDays: 1 });

    expect(response).toMatchObject({ ok: true, result: { olderThanDays: 1, pruned: [] } });
    expect(daemon.config.pairings.map((entry) => entry.pairingId)).toEqual(["pair-fresh"]);
    expect(writes.length).toBe(writesAfterStart);
  });

  it("marks a pairing as last seen when its bridge disconnects so a long session is not pruned", async () => {
    const credential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-long-lived", credential });
    const { daemon, writes } = await startPrunableDaemon(config);
    const bridge = await connectBridge(daemon, { pairingId: "pair-long-lived", credential });
    for (const entry of daemon.config.pairings) entry.lastSeenAt = daysAgo(90);
    const writesBeforeClose = writes.length;
    const cli = await connectCli(daemon, daemon.config.deviceCredential);

    bridge.socket.close();
    await waitFor(() => writes.length === writesBeforeClose + 1);

    expect(Date.parse(daemon.config.pairings[0]!.lastSeenAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(writes.at(-1)!.pairings[0]!.lastSeenAt).toBe(daemon.config.pairings[0]!.lastSeenAt);
    const response = await control(cli, "prune-1", "auth.prune", { olderThanDays: 1 });

    expect(response).toMatchObject({ ok: true, result: { pruned: [] } });
    expect(daemon.config.pairings.map((entry) => entry.pairingId)).toEqual(["pair-long-lived"]);
  });

  it("marks a pairing as last seen when a busy bridge slot turns its hello away", async () => {
    const activeCredential = "b".repeat(43);
    const busyCredential = "c".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-active", credential: activeCredential });
    addPairing(config, {
      pairingId: "pair-turned-away",
      credential: busyCredential,
      worldId: "world-2",
      userId: "gm-2",
      lastSeenAt: daysAgo(90)
    });
    const { daemon } = await startPrunableDaemon(config);
    await connectBridge(daemon, { pairingId: "pair-active", credential: activeCredential });
    const cli = await connectCli(daemon, daemon.config.deviceCredential);

    const busy = await connectBridge(daemon, {
      pairingId: "pair-turned-away",
      credential: busyCredential,
      worldId: "world-2",
      userId: "gm-2"
    });

    expect(busy.ack).toMatchObject({ ok: false, error: { code: ERROR_CODES.BRIDGE_BUSY } });
    expect(daemon.activePairingId).toBe("pair-active");
    const turnedAway = daemon.config.pairings.find((entry) => entry.pairingId === "pair-turned-away")!;
    expect(Date.parse(turnedAway.lastSeenAt)).toBeGreaterThan(Date.now() - 60_000);
    const response = await control(cli, "prune-1", "auth.prune", { olderThanDays: 1 });

    expect(response).toMatchObject({ ok: true, result: { pruned: [] } });
    expect(daemon.config.pairings.map((entry) => entry.pairingId)).toEqual([
      "pair-active",
      "pair-turned-away"
    ]);
  });

  it("marks a pairing as last seen when its browser ends the session with a goodbye", async () => {
    const credential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-goodbye", credential });
    const { daemon, writes } = await startPrunableDaemon(config);
    const bridge = await connectBridge(daemon, { pairingId: "pair-goodbye", credential });
    for (const entry of daemon.config.pairings) entry.lastSeenAt = daysAgo(90);
    const writesBeforeGoodbye = writes.length;
    const cli = await connectCli(daemon, daemon.config.deviceCredential);

    const bridgeClosed = closed(bridge.socket);
    bridge.socket.send(
      JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: MESSAGE_TYPES.BRIDGE_GOODBYE })
    );
    expect(await bridgeClosed).toMatchObject({ code: 1000 });

    expect(writes.length).toBe(writesBeforeGoodbye + 1);
    expect(Date.parse(daemon.config.pairings[0]!.lastSeenAt)).toBeGreaterThan(Date.now() - 60_000);
    const response = await control(cli, "prune-1", "auth.prune", { olderThanDays: 1 });

    expect(response).toMatchObject({ ok: true, result: { pruned: [] } });
    expect(daemon.config.pairings.map((entry) => entry.pairingId)).toEqual(["pair-goodbye"]);
  });

  it("does not restore a revoked pairing when the daemon releases its bridge", async () => {
    const credential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-revoked", credential });
    const { daemon, writes } = await startPrunableDaemon(config);
    const bridge = await connectBridge(daemon, { pairingId: "pair-revoked", credential });
    const cli = await connectCli(daemon, daemon.config.deviceCredential);
    const bridgeClosed = closed(bridge.socket);
    const writesBeforeRevoke = writes.length;

    expect(await control(cli, "revoke-1", "auth.revoke", { pairingId: "pair-revoked" })).toMatchObject({
      ok: true,
      result: { revoked: true }
    });
    await bridgeClosed;

    expect(daemon.config.pairings).toEqual([]);
    expect(writes.length).toBe(writesBeforeRevoke + 1);
    expect(writes.at(-1)!.pairings).toEqual([]);
    expect(await control(cli, "list-1", "auth.list")).toMatchObject({ ok: true, result: { pairings: [] } });
  });

  it("keeps the active bridge connected while rotating the device-local credential", async () => {
    const bridgeCredential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-1", credential: bridgeCredential });
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const bridge = await connectBridge(daemon, { pairingId: "pair-1", credential: bridgeCredential });
    const cli = await connectCli(daemon, config.deviceCredential);
    const oldCredential = daemon.config.deviceCredential;
    const cliClosed = closed(cli);
    expect(await control(cli, "rotate-1", "auth.rotate-client")).toMatchObject({
      ok: true,
      result: { rotated: true }
    });
    await cliClosed;
    expect(daemon.config.deviceCredential).not.toBe(oldCredential);
    expect(bridge.socket.readyState).toBe(WebSocket.OPEN);
    expect(daemon.activePairingId).toBe("pair-1");
  });

  it("persists the bound URL through later daemon writes", async () => {
    const config = { ...createEmptyConfig(), daemonUrl: "ws://127.0.0.1:0" };
    addPairing(config, { pairingId: "pair-1", credential: "b".repeat(43) });
    let persisted = structuredClone(config);
    const configStore = {
      getConfigPath: () => "/tmp/fvtt-world-cli-test-config.json",
      readConfig: () => structuredClone(persisted),
      writeConfig: (value: unknown) => {
        persisted = structuredClone(value as typeof persisted);
      }
    };
    const daemon = createBridgeDaemon({
      daemonUrl: config.daemonUrl,
      config,
      configStore,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const boundUrl = daemon.daemonUrl;
    expect(boundUrl).not.toContain(":0");
    expect(persisted).toMatchObject({ daemonUrl: boundUrl });

    const cli = await connectCli(daemon, config.deviceCredential);
    expect((await control(cli, "revoke-1", "auth.revoke", { pairingId: "pair-1" })).ok).toBe(true);
    expect(persisted).toMatchObject({ daemonUrl: boundUrl });
  });

  it("preserves an upload limit written while the daemon is running", async () => {
    const credential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-1", credential });
    let persisted = structuredClone(config);
    const configStore = {
      getConfigPath: () => "/tmp/fvtt-world-cli-test-config.json",
      readConfig: () => structuredClone(persisted),
      writeConfig: (value: unknown) => {
        persisted = structuredClone(value as typeof persisted);
      }
    };
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      configStore,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();

    configStore.writeConfig({ ...persisted, uploadLimitBytes: 200 * 1024 * 1024 });
    await connectBridge(daemon, { pairingId: "pair-1", credential });

    expect(persisted.uploadLimitBytes).toBe(200 * 1024 * 1024);
    expect(daemon.config.uploadLimitBytes).toBe(200 * 1024 * 1024);
  });

  it("returns an error envelope for malformed daemon requests without closing the CLI connection", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const cli = await connectCli(daemon, config.deviceCredential);

    const invalidResponse = next(cli);
    cli.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.DAEMON_REQUEST,
        id: "invalid-control",
        operation: "unknown.operation",
        params: {}
      })
    );

    expect(await invalidResponse).toMatchObject({
      type: MESSAGE_TYPES.DAEMON_RESPONSE,
      id: "invalid-control",
      operation: "unknown.operation",
      ok: false,
      error: { code: ERROR_CODES.INVALID_MESSAGE }
    });
    expect(await control(cli, "status-after-invalid", "auth.status")).toMatchObject({ ok: true });
  });

  it("enforces client and browser role separation before credentials are considered", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();

    const browserCli = await open(daemon.daemonUrl, "http://localhost:30000");
    sockets.push(browserCli);
    const browserRejected = next(browserCli);
    browserCli.send(JSON.stringify(createClientHello({ credential: config.deviceCredential })));
    expect(await browserRejected).toMatchObject({ ok: false, error: { code: ERROR_CODES.UNAUTHORIZED } });

    const localPairing = await open(daemon.daemonUrl);
    sockets.push(localPairing);
    const localRejected = next(localPairing);
    localPairing.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_REQUEST,
        identity: pairingIdentity()
      })
    );
    expect(await localRejected).toMatchObject({ ok: false, error: { code: ERROR_CODES.INVALID_MESSAGE } });
  });

  it("denies and expires pending pairing requests without creating profiles", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const cli = await connectCli(daemon, config.deviceCredential);

    const deniedBrowser = await open(daemon.daemonUrl, "http://localhost:30000");
    sockets.push(deniedBrowser);
    let pendingMessage = next(deniedBrowser);
    deniedBrowser.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_REQUEST,
        identity: pairingIdentity()
      })
    );
    const deniedPending = await pendingMessage;
    const denial = next(deniedBrowser);
    expect(await control(cli, "deny-1", "auth.deny", { code: deniedPending.code })).toMatchObject({
      ok: true,
      result: { denied: true }
    });
    expect(await denial).toMatchObject({ ok: false, error: { code: ERROR_CODES.UNAUTHORIZED } });

    const expiredBrowser = await open(daemon.daemonUrl, "http://localhost:30000");
    sockets.push(expiredBrowser);
    pendingMessage = next(expiredBrowser);
    expiredBrowser.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_REQUEST,
        identity: pairingIdentity()
      })
    );
    const expiredPending = await pendingMessage;
    daemon.pendingPairings.get(expiredPending.code)!.expiresAt = Date.now() - 1;
    expect(
      await control(cli, "approve-expired", "auth.approve", { code: expiredPending.code })
    ).toMatchObject({ ok: false, error: { code: ERROR_CODES.PAIRING_EXPIRED } });
    expect(daemon.config.pairings).toHaveLength(0);
  });

  it("keeps two browsers on one origin, world, and GM as separate pairings", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const cli = await connectCli(daemon, config.deviceCredential);

    const zen = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
    const chrome = await requestPairing(daemon, { clientId: THIRD_CLIENT_ID, label: "Zen Browser" });
    expect((await control(cli, "pending-two", "auth.pending")).result.pending).toHaveLength(2);

    const zenApproved = await control(cli, "approve-zen", "auth.approve", { code: zen.pending.code });
    const chromeApproved = await control(cli, "approve-chrome", "auth.approve", {
      code: chrome.pending.code
    });

    expect(zenApproved.ok).toBe(true);
    expect(chromeApproved.ok).toBe(true);
    expect(daemon.config.pairings).toHaveLength(2);
    expect(daemon.config.pairings.map((entry) => entry.clientId)).toEqual([
      SECOND_CLIENT_ID,
      THIRD_CLIENT_ID
    ]);
    expect(daemon.config.pairings.map((entry) => entry.label)).toEqual(["Zen Browser", "Zen Browser"]);
    expect(new Set(daemon.config.pairings.map((entry) => entry.pairingId)).size).toBe(2);
    expect(JSON.stringify(await control(cli, "list-two", "auth.list"))).not.toContain("Zen Browser 2");
  });

  it("replaces only the re-pairing client's record and keeps the other browser paired", async () => {
    const otherCredential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, {
      pairingId: "pair-other",
      credential: otherCredential,
      clientId: SECOND_CLIENT_ID,
      label: "Chrome"
    });
    const otherDigest = config.pairings[0].credentialDigest;
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const cli = await connectCli(daemon, config.deviceCredential);

    const first = await requestPairing(daemon, { clientId: THIRD_CLIENT_ID, label: "Zen Browser" });
    const firstApproved = await control(cli, "approve-first", "auth.approve", { code: first.pending.code });
    const firstPairingId = firstApproved.result.pairing.pairingId;

    const again = await requestPairing(daemon, { clientId: THIRD_CLIENT_ID, label: "Zen Browser" });
    const againApproved = await control(cli, "approve-again", "auth.approve", { code: again.pending.code });

    expect(againApproved.result.pairing.pairingId).toBe(firstPairingId);
    expect(daemon.config.pairings).toHaveLength(2);
    expect(daemon.config.pairings.find((entry) => entry.pairingId === "pair-other")?.credentialDigest).toBe(
      otherDigest
    );
  });

  it("supersedes its own pending request when the same browser asks to pair twice", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const cli = await connectCli(daemon, config.deviceCredential);

    const first = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID });
    const second = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID });

    const pending = (await control(cli, "pending-superseded", "auth.pending")).result.pending;
    expect(pending).toHaveLength(1);
    expect(pending[0].code).toBe(second.pending.code);
    expect(
      await control(cli, "approve-superseded", "auth.approve", { code: first.pending.code })
    ).toMatchObject({ ok: false, error: { code: ERROR_CODES.PAIRING_NOT_FOUND } });
    expect(daemon.config.pairings).toHaveLength(0);
  });

  it("shows the requesting browser's label and client id before an interactive approval", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();

    const declined = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
    for (const answer of ["n", "", "maybe"]) {
      const declinedRun = await runAuthCli(daemon, ["auth", "approve", declined.pending.code], { answer });
      expect(declinedRun.output, answer).toContain(`Client: Zen Browser (${SECOND_CLIENT_ID})`);
      expect(declinedRun.error, answer).toBeInstanceOf(CommanderError);
      expect((declinedRun.error as CommanderError).code, answer).toBe("fvtt-world-cli.approvalDenied");
      expect(
        planCliErrorOutput(declinedRun.error, false, { commanderAlreadyPrinted: false }),
        answer
      ).toMatchObject({
        exitCode: 1,
        stderr: expect.stringContaining("PAIRING_DECLINED")
      });
      expect(daemon.pendingPairings.has(declined.pending.code), answer).toBe(true);
      expect(daemon.config.pairings, answer).toHaveLength(0);
    }

    const paired = next(declined.browser);
    const approvedRun = await runAuthCli(daemon, ["auth", "approve", declined.pending.code], { answer: "y" });
    expect(approvedRun.error).toBeNull();
    expect(approvedRun.output).toContain("Origin: http://localhost:30000");
    expect(approvedRun.output).toContain("GM: GM (gm-1)");
    expect(approvedRun.output).toContain(`Client: Zen Browser (${SECOND_CLIENT_ID})`);
    expect(await paired).toMatchObject({ type: MESSAGE_TYPES.PAIRING_RESULT, ok: true });
    expect(daemon.config.pairings).toHaveLength(1);
    expect(daemon.config.pairings[0].clientId).toBe(SECOND_CLIENT_ID);
  });

  it("approves the pending request whose identity it displayed, not another candidate", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();

    const shown = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "My Zen Browser" });
    const listPending = daemon.daemonOperations["auth.pending"];
    daemon.daemonOperations["auth.pending"] = (params, respond, reject, socket) => {
      listPending(
        params,
        async (result) => {
          await requestPairing(daemon, { clientId: THIRD_CLIENT_ID, label: "Also Mine" });
          respond(result);
        },
        reject,
        socket
      );
    };

    const run = await runAuthCli(daemon, ["auth", "approve"], { answer: "y" });

    expect(run.error).toBeNull();
    expect(run.output).toContain(`Client: My Zen Browser (${SECOND_CLIENT_ID})`);
    expect(daemon.config.pairings).toHaveLength(1);
    expect(daemon.config.pairings[0]).toMatchObject({
      clientId: SECOND_CLIENT_ID,
      label: "My Zen Browser"
    });
    expect(daemon.pendingPairings.has(shown.pending.code)).toBe(false);
  });

  it("fails an interactive approval whose displayed request is gone by the time it is confirmed", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();

    const shown = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "My Zen Browser" });
    const listPending = daemon.daemonOperations["auth.pending"];
    daemon.daemonOperations["auth.pending"] = (params, respond, reject, socket) => {
      listPending(
        params,
        async (result) => {
          shown.browser.close();
          await waitFor(() => daemon.pendingPairings.size === 0);
          await requestPairing(daemon, { clientId: THIRD_CLIENT_ID, label: "Hostile" });
          respond(result);
        },
        reject,
        socket
      );
    };

    const run = await runAuthCli(daemon, ["auth", "approve"], { answer: "y" });

    expect(run.output).toContain(`Client: My Zen Browser (${SECOND_CLIENT_ID})`);
    expect((run.error as CommanderError).code).toBe("fvtt-world-cli.remoteError");
    expect((run.error as CommanderError).message).toBe("Pairing request not found");
    expect(daemon.config.pairings).toHaveLength(0);
  });

  it("refuses an interactive approval it cannot show an identity for", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();

    const empty = await runAuthCli(daemon, ["auth", "approve"], { answer: "y" });
    expect((empty.error as CommanderError).code).toBe("fvtt-world-cli.approvalIdentityUnavailable");
    expect((empty.error as CommanderError).message).toBe("No pairing request is pending");

    const zen = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
    const chrome = await requestPairing(daemon, { clientId: THIRD_CLIENT_ID, label: "Chrome" });

    const ambiguous = await runAuthCli(daemon, ["auth", "approve"], { answer: "y" });
    expect((ambiguous.error as CommanderError).code).toBe("fvtt-world-cli.approvalIdentityUnavailable");
    expect((ambiguous.error as CommanderError).message).toContain(zen.pending.code);
    expect((ambiguous.error as CommanderError).message).toContain(chrome.pending.code);
    expect(ambiguous.output).not.toContain("Client:");
    expect(planCliErrorOutput(ambiguous.error, false, { commanderAlreadyPrinted: false }).exitCode).toBe(2);

    const unknown = await runAuthCli(daemon, ["auth", "approve", "ABCDEFGH"], { answer: "y" });
    expect((unknown.error as CommanderError).code).toBe("fvtt-world-cli.approvalIdentityUnavailable");
    expect((unknown.error as CommanderError).message).toContain(zen.pending.code);
    expect(daemon.config.pairings).toHaveLength(0);
  });

  it("renders the daemon error when an interactive approval cannot list pending requests", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    daemon.daemonOperations["auth.pending"] = (_params, _respond, reject) =>
      reject(ERROR_CODES.INTERNAL_ERROR, "Pending pairing registry unavailable");

    const failed = await runAuthCli(daemon, ["auth", "approve"], { answer: "y" });

    expect((failed.error as CommanderError).code).toBe("fvtt-world-cli.approvalPendingUnavailable");
    const rendered = planCliErrorOutput(failed.error, false, { commanderAlreadyPrinted: false });
    expect(rendered.stderr).toContain("Pending pairing registry unavailable");
    expect(rendered.stderr).toContain(ERROR_CODES.INTERNAL_ERROR);
    expect(rendered.exitCode).toBe(1);
    expect(daemon.config.pairings).toHaveLength(0);
  });

  it("refuses an interactive approval without a terminal", async () => {
    const daemon = await startPairingDaemon();
    await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });

    const run = await runAuthCli(daemon, ["auth", "approve"], { answer: "y", isTTY: false });

    expect((run.error as CommanderError).code).toBe("fvtt-world-cli.approvalRequired");
    expect(planCliErrorOutput(run.error, false, { commanderAlreadyPrinted: false }).exitCode).toBe(2);
    expect(daemon.config.pairings).toHaveLength(0);
  });

  it("leaves a pending request untouched when an interactive approval ends without an answer", async () => {
    const daemon = await startPairingDaemon();
    const requested = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });

    const run = await runAuthCli(daemon, ["auth", "approve", requested.pending.code]);

    expect((run.error as CommanderError).code).toBe("fvtt-world-cli.pairingPromptAborted");
    expect(planCliErrorOutput(run.error, false, { commanderAlreadyPrinted: false })).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("PAIRING_PROMPT_ABORTED")
    });
    expect(daemon.pendingPairings.has(requested.pending.code)).toBe(true);
    expect(daemon.config.pairings).toHaveLength(0);
  });

  it("approves without a terminal, a prompt, or an identity listing when --yes is passed", async () => {
    const daemon = await startPairingDaemon();
    const requested = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
    const paired = next(requested.browser);

    const run = await runAuthCli(daemon, ["auth", "approve", "--yes"], { isTTY: false });

    expect(run.error).toBeNull();
    expect(run.output).not.toContain("Client:");
    expect(await paired).toMatchObject({ type: MESSAGE_TYPES.PAIRING_RESULT, ok: true });
    expect(daemon.config.pairings).toHaveLength(1);
    expect(daemon.config.pairings[0].clientId).toBe(SECOND_CLIENT_ID);
  });

  it("waits for a pairing request and approves the one it renders", async () => {
    const daemon = await startPairingDaemon();
    const run = runAuthCli(daemon, ["auth"], { answer: "y" });
    await waitFor(() => daemon.awaitWaiters.size === 1);

    const requested = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
    const paired = next(requested.browser);
    const finished = await run;

    expect(finished.error).toBeNull();
    expect(finished.output).toContain("Waiting for a pairing request");
    expect(finished.output).toContain("Origin: http://localhost:30000");
    expect(finished.output).toContain("GM: GM (gm-1)");
    expect(finished.output).toContain(`Client: Zen Browser (${SECOND_CLIENT_ID})`);
    expect(finished.output).toContain(`Code: ${requested.pending.code}`);
    expect(finished.output).toContain(`Approve pairing request ${requested.pending.code}?`);
    expect(await paired).toMatchObject({ type: MESSAGE_TYPES.PAIRING_RESULT, ok: true });
    expect(daemon.config.pairings).toHaveLength(1);
    expect(daemon.config.pairings[0].clientId).toBe(SECOND_CLIENT_ID);
  });

  it("renders the earliest already-pending request without waiting and leaves a later one pending", async () => {
    const daemon = await startPairingDaemon();
    const shown = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
    const later = await requestPairing(daemon, { clientId: THIRD_CLIENT_ID, label: "Chrome" });
    const paired = next(shown.browser);

    const finished = await runAuthCli(daemon, ["auth"], { answer: "y" });

    expect(finished.error).toBeNull();
    expect(finished.output).toContain(`Client: Zen Browser (${SECOND_CLIENT_ID})`);
    expect(finished.output).toContain(`Code: ${shown.pending.code}`);
    expect(finished.output).not.toContain("Chrome");
    expect(await paired).toMatchObject({ type: MESSAGE_TYPES.PAIRING_RESULT, ok: true });
    expect(daemon.config.pairings).toHaveLength(1);
    expect(daemon.config.pairings[0].clientId).toBe(SECOND_CLIENT_ID);
    expect(daemon.pendingPairings.has(later.pending.code)).toBe(true);
    expect(daemon.awaitWaiters.size).toBe(0);
  });

  it("keeps waiting after the daemon answers a long poll with no pairing request", async () => {
    const daemon = await startPairingDaemon();
    const awaitPairing = daemon.daemonOperations["auth.await"];
    let polls = 0;
    let answeredEmptyAt = 0;
    let reissuedAfterMs = -1;
    daemon.daemonOperations["auth.await"] = (params, respond, reject, socket) => {
      polls += 1;
      if (polls === 1) {
        answeredEmptyAt = Date.now();
        respond({ request: null });
        return;
      }
      reissuedAfterMs = Date.now() - answeredEmptyAt;
      awaitPairing(params, respond, reject, socket);
    };
    const run = runAuthCli(daemon, ["auth"], { answer: "y" });
    await waitFor(() => daemon.awaitWaiters.size === 1);

    const requested = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
    const paired = next(requested.browser);
    const finished = await run;

    expect(polls).toBe(2);
    expect(reissuedAfterMs).toBeGreaterThanOrEqual(AWAIT_EMPTY_POLL_DELAY_MS);
    expect(finished.error).toBeNull();
    expect(finished.output).toContain(`Client: Zen Browser (${SECOND_CLIENT_ID})`);
    expect(await paired).toMatchObject({ type: MESSAGE_TYPES.PAIRING_RESULT, ok: true });
    expect(daemon.config.pairings).toHaveLength(1);
  });

  it("rejects a control operation it does not serve as an invalid transport message", async () => {
    const daemon = await startPairingDaemon();
    const cli = await connectCli(daemon, daemon.config.deviceCredential);

    expect(await control(cli, "undeclared-1", "auth.undeclared")).toMatchObject({
      ok: false,
      error: { code: ERROR_CODES.INVALID_MESSAGE }
    });
  });

  it("names the daemon restart when the daemon does not serve the pairing wait", async () => {
    for (const answer of [
      { code: ERROR_CODES.UNKNOWN_COMMAND, message: "Unknown daemon operation: auth.await" },
      { code: ERROR_CODES.INVALID_MESSAGE, message: "Invalid transport message" }
    ]) {
      const daemon = await startPairingDaemon();
      if (answer.code === ERROR_CODES.UNKNOWN_COMMAND) delete daemon.daemonOperations["auth.await"];
      else
        daemon.daemonOperations["auth.await"] = (_params, _respond, reject) =>
          reject(answer.code, answer.message);

      const run = await runAuthCli(daemon, ["auth"], { answer: "y" });

      expect((run.error as CommanderError).code, answer.code).toBe("fvtt-world-cli.pairingWaitUnavailable");
      expect((run.error as CommanderError).message).toContain(answer.message);
      expect((run.error as CommanderError).message).toContain("bridge serve");
      const rendered = planCliErrorOutput(run.error, false, { commanderAlreadyPrinted: false });
      expect(rendered.exitCode).toBe(1);
      expect(rendered.stderr).toContain(ERROR_CODES.INTERNAL_ERROR);
      expect(daemon.config.pairings).toHaveLength(0);
    }
  });

  it("reports a lost daemon connection as an unavailable daemon rather than ending the wait quietly", async () => {
    const daemon = await startPairingDaemon();
    const run = runAuthCli(daemon, ["auth"], { answer: "y" });
    await waitFor(() => daemon.awaitWaiters.size === 1);

    await daemon.stop();
    const finished = await run;

    expect(finished.output).toContain("Waiting for a pairing request");
    expect(finished.output).not.toContain("Approve pairing request");
    expect(planCliErrorOutput(finished.error, false, { commanderAlreadyPrinted: false })).toMatchObject({
      exitCode: 3,
      stderr: expect.stringContaining(`${ERROR_CODES.DAEMON_UNAVAILABLE}: Daemon connection closed`)
    });
    expect(daemon.config.pairings).toHaveLength(0);
  });

  it("reports an unreachable daemon as unavailable for a control verb rather than as an internal error", async () => {
    const daemon = await startPairingDaemon();
    await daemon.stop();

    for (const args of [
      ["auth", "status"],
      ["auth", "list"],
      ["auth", "pending"],
      ["bridge", "release"]
    ]) {
      const run = await runAuthCli(daemon, args);

      expect(
        planCliErrorOutput(run.error, false, { commanderAlreadyPrinted: false }),
        args.join(" ")
      ).toMatchObject({
        exitCode: 3,
        stderr: expect.stringContaining(ERROR_CODES.DAEMON_UNAVAILABLE)
      });
    }
  });

  it("waits out a control verb for --timeout-ms rather than the fixed client default", async () => {
    const stub = await startStubControlDaemon(() => {});

    for (const [args, operation] of [
      [["auth", "status"], "auth.status"],
      [["auth", "deny", "ABCDEFGH"], "auth.deny"],
      [["bridge", "release"], "bridge.release"]
    ] as Array<[string[], string]>) {
      const run = await runAuthCli(stub, ["--timeout-ms", "300", ...args]);

      const error = run.error as DaemonTransportError;
      expect(error.code, operation).toBe(ERROR_CODES.DAEMON_UNAVAILABLE);
      expect(error.details, operation).toMatchObject({ reason: "timeout", operation, timeoutMs: 300 });
      expect(
        planCliErrorOutput(run.error, false, { commanderAlreadyPrinted: false }).exitCode,
        operation
      ).toBe(3);
    }
  });

  it("waits out the listing an interactive confirmation previews for --timeout-ms", async () => {
    const stub = await startStubControlDaemon(() => {});

    for (const [args, operation] of [
      [["auth", "approve"], "auth.pending"],
      [["auth", "prune"], "auth.list"]
    ] as Array<[string[], string]>) {
      const run = await runAuthCli(stub, ["--timeout-ms", "300", ...args]);

      const error = run.error as DaemonTransportError;
      expect(error.code, operation).toBe(ERROR_CODES.DAEMON_UNAVAILABLE);
      expect(error.details, operation).toMatchObject({ reason: "timeout", operation, timeoutMs: 300 });
    }
  });

  it("holds a parked pairing wait past --timeout-ms and applies it to the approval", async () => {
    const stub = await startStubControlDaemon(({ id, operation }, reply) => {
      if (operation !== "auth.await") return;
      setTimeout(
        () =>
          reply({
            protocolVersion: PROTOCOL_VERSION,
            type: MESSAGE_TYPES.DAEMON_RESPONSE,
            id,
            operation,
            ok: true,
            result: {
              request: {
                code: "ABCDEFGH",
                expiresAt: new Date(Date.now() + 300_000).toISOString(),
                origin: "http://localhost:30000",
                worldId: "world-1",
                worldTitle: "World",
                userId: "gm-1",
                userName: "GM",
                clientId: SECOND_CLIENT_ID,
                label: "Zen Browser",
                moduleVersion: "1.0.0"
              }
            }
          }),
        900
      );
    });

    const run = await runAuthCli(stub, ["--timeout-ms", "300", "auth"], { answer: "y" });

    expect(run.output).toContain(`Client: Zen Browser (${SECOND_CLIENT_ID})`);
    expect((run.error as DaemonTransportError).details).toMatchObject({
      reason: "timeout",
      operation: "auth.approve",
      timeoutMs: 300
    });
  });

  it("waits for a pairing request longer than a --timeout-ms below the park cap", async () => {
    const daemon = await startPairingDaemon();
    const run = runAuthCli(daemon, ["--timeout-ms", "2000", "auth"], { answer: "y" });
    await waitFor(() => daemon.awaitWaiters.size === 1);
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    const requested = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
    const paired = next(requested.browser);
    const finished = await run;

    expect(finished.error).toBeNull();
    expect(finished.output).toContain(`Client: Zen Browser (${SECOND_CLIENT_ID})`);
    expect(await paired).toMatchObject({ type: MESSAGE_TYPES.PAIRING_RESULT, ok: true });
    expect(daemon.config.pairings).toHaveLength(1);
  });

  it("denies the awaited pairing request and stops waiting for any answer that is not yes", async () => {
    const daemon = await startPairingDaemon();

    for (const answer of ["n", "", "maybe"]) {
      const run = runAuthCli(daemon, ["auth"], { answer });
      await waitFor(() => daemon.awaitWaiters.size === 1);

      const requested = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
      const denied = next(requested.browser);
      const finished = await run;

      expect((finished.error as CommanderError).code, answer).toBe("fvtt-world-cli.pairingDeclined");
      expect(
        planCliErrorOutput(finished.error, false, { commanderAlreadyPrinted: false }),
        answer
      ).toMatchObject({
        exitCode: 1,
        stderr: expect.stringContaining("PAIRING_DECLINED")
      });
      expect(await denied, answer).toMatchObject({ type: MESSAGE_TYPES.PAIRING_RESULT, ok: false });
      expect(daemon.pendingPairings.size, answer).toBe(0);
      expect(daemon.config.pairings, answer).toHaveLength(0);
    }
  });

  it("leaves the awaited request pending when the prompt ends without an answer", async () => {
    const daemon = await startPairingDaemon();
    const run = runAuthCli(daemon, ["auth"]);
    await waitFor(() => daemon.awaitWaiters.size === 1);

    const requested = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
    const finished = await run;

    expect(finished.output).toContain(`Approve pairing request ${requested.pending.code}?`);
    expect((finished.error as CommanderError).code).toBe("fvtt-world-cli.pairingPromptAborted");
    expect(planCliErrorOutput(finished.error, false, { commanderAlreadyPrinted: false })).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("PAIRING_PROMPT_ABORTED")
    });
    expect(daemon.pendingPairings.has(requested.pending.code)).toBe(true);
    expect(daemon.config.pairings).toHaveLength(0);
  });

  it("approves the awaited request it rendered when another arrives at the prompt", async () => {
    const daemon = await startPairingDaemon();
    const run = runAuthCli(daemon, ["auth"], {
      answer: async () => {
        await requestPairing(daemon, { clientId: THIRD_CLIENT_ID, label: "Also Mine" });
        return "y";
      }
    });
    await waitFor(() => daemon.awaitWaiters.size === 1);

    const shown = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
    const finished = await run;

    expect(finished.error).toBeNull();
    expect(finished.output).toContain(`Client: Zen Browser (${SECOND_CLIENT_ID})`);
    expect(daemon.config.pairings).toHaveLength(1);
    expect(daemon.config.pairings[0]).toMatchObject({ clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
    expect(daemon.pendingPairings.has(shown.pending.code)).toBe(false);
  });

  it("fails an awaited approval whose rendered request is gone by the time it is confirmed", async () => {
    const daemon = await startPairingDaemon();
    let shown: Awaited<ReturnType<typeof requestPairing>> | null = null;
    const run = runAuthCli(daemon, ["auth"], {
      answer: async () => {
        shown?.browser.close();
        await waitFor(() => daemon.pendingPairings.size === 0);
        await requestPairing(daemon, { clientId: THIRD_CLIENT_ID, label: "Hostile" });
        return "y";
      }
    });
    await waitFor(() => daemon.awaitWaiters.size === 1);

    shown = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
    const finished = await run;

    expect(finished.output).toContain(`Client: Zen Browser (${SECOND_CLIENT_ID})`);
    expect((finished.error as CommanderError).code).toBe("fvtt-world-cli.remoteError");
    expect((finished.error as CommanderError).message).toBe("Pairing request not found");
    expect(daemon.config.pairings).toHaveLength(0);
  });

  it("refuses to wait for a pairing request without a terminal", async () => {
    const daemon = await startPairingDaemon();

    const run = await runAuthCli(daemon, ["auth"], { answer: "y", isTTY: false });

    expect((run.error as CommanderError).code).toBe("fvtt-world-cli.pairingWaitInteractiveOnly");
    expect((run.error as CommanderError).message).toContain("auth approve --yes");
    expect(planCliErrorOutput(run.error, false, { commanderAlreadyPrinted: false }).exitCode).toBe(2);
    expect(run.output).toBe("");
    expect(daemon.awaitWaiters.size).toBe(0);
  });

  it("refuses to wait for a pairing request with --json", async () => {
    const daemon = await startPairingDaemon();

    for (const args of [
      ["--json", "auth"],
      ["auth", "--json"]
    ]) {
      const run = await runAuthCli(daemon, args, { answer: "y" });

      expect((run.error as CommanderError).code, args.join(" ")).toBe(
        "fvtt-world-cli.pairingWaitInteractiveOnly"
      );
      expect(run.output).toBe("");
      expect(daemon.awaitWaiters.size).toBe(0);
    }
  });

  it("waits for a pairing request with a --timeout-ms spelled after the command name", async () => {
    const daemon = await startPairingDaemon();
    const run = runAuthCli(daemon, ["auth", "--timeout-ms", "2000"], { answer: "y" });
    await waitFor(() => daemon.awaitWaiters.size === 1);

    const requested = await requestPairing(daemon, { clientId: SECOND_CLIENT_ID, label: "Zen Browser" });
    const paired = next(requested.browser);
    const finished = await run;

    expect(finished.error).toBeNull();
    expect(finished.output).toContain(`Client: Zen Browser (${SECOND_CLIENT_ID})`);
    expect(await paired).toMatchObject({ type: MESSAGE_TYPES.PAIRING_RESULT, ok: true });
    expect(daemon.config.pairings).toHaveLength(1);
  });

  it("names an unknown auth subcommand instead of waiting for a pairing request", async () => {
    const daemon = await startPairingDaemon();

    const unknown = await runAuthCli(daemon, ["auth", "bogus"], { answer: "y" });
    expect((unknown.error as CommanderError).code).toBe("commander.unknownCommand");
    expect((unknown.error as CommanderError).message).toContain("unknown command 'bogus'");
    expect(unknown.output).not.toContain("Waiting for a pairing request");

    const misspelled = await runAuthCli(daemon, ["auth", "aprove", "ABCDEFGH"], { answer: "y" });
    expect((misspelled.error as CommanderError).code).toBe("commander.unknownCommand");
    expect((misspelled.error as CommanderError).message).toContain("Did you mean approve?");

    const jsonMode = await runAuthCli(daemon, ["--json", "auth", "bogus"], { answer: "y" });
    expect((jsonMode.error as CommanderError).code).toBe("commander.unknownCommand");

    expect(daemon.awaitWaiters.size).toBe(0);
  });

  it("prints auth help instead of waiting for a pairing request", async () => {
    const daemon = await startPairingDaemon();

    const family = await runAuthCli(daemon, ["auth", "help"]);
    expect((family.error as CommanderError).code).toBe("commander.help");
    expect(planCliErrorOutput(family.error, false).exitCode).toBe(0);
    expect(family.output).toContain("approve [options] [code]");
    expect(family.output).not.toContain("Waiting for a pairing request");

    const verb = await runAuthCli(daemon, ["auth", "help", "approve"]);
    expect((verb.error as CommanderError).code).toBe("commander.help");
    expect(verb.output).toContain("--yes");

    expect(daemon.awaitWaiters.size).toBe(0);
  });

  it("prunes the idle profiles it listed once the operator confirms", async () => {
    const config = createEmptyConfig();
    addPairing(config, {
      pairingId: "pair-stale",
      credential: "b".repeat(43),
      label: "Old Chrome",
      lastSeenAt: daysAgo(60)
    });
    addPairing(config, {
      pairingId: "pair-fresh",
      credential: "c".repeat(43),
      worldId: "world-2",
      userId: "gm-2",
      label: "Daily Zen"
    });
    const { daemon } = await startPrunableDaemon(config);

    const run = await runAuthCli(daemon, ["auth", "prune"], { answer: "y" });

    expect(run.error).toBeNull();
    expect(run.output).toContain("1 pairing profile idle for more than 30 days:");
    expect(run.output).toContain("Old Chrome");
    expect(run.output).not.toContain("Daily Zen");
    expect(run.output).toContain("Remove 1 pairing profile?");
    expect(JSON.parse(run.output.slice(run.output.indexOf("{")))).toMatchObject({
      olderThanDays: 30,
      pruned: [{ pairingId: "pair-stale" }]
    });
    expect(daemon.config.pairings.map((entry) => entry.pairingId)).toEqual(["pair-fresh"]);
  });

  it("keeps the connected profile out of the prune listing and its confirmation", async () => {
    const activeCredential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-active", credential: activeCredential, label: "Live Chrome" });
    addPairing(config, {
      pairingId: "pair-stale",
      credential: "c".repeat(43),
      worldId: "world-2",
      userId: "gm-2",
      label: "Old Zen",
      lastSeenAt: daysAgo(60)
    });
    const { daemon } = await startPrunableDaemon(config);
    await connectBridge(daemon, { pairingId: "pair-active", credential: activeCredential });
    for (const entry of daemon.config.pairings) {
      if (entry.pairingId === "pair-active") entry.lastSeenAt = daysAgo(60);
    }

    const run = await runAuthCli(daemon, ["auth", "prune"], { answer: "y" });

    expect(run.error).toBeNull();
    expect(run.output).toContain("1 pairing profile idle for more than 30 days:");
    expect(run.output).toContain("Old Zen");
    expect(run.output).not.toContain("Live Chrome");
    expect(run.output).toContain("Remove 1 pairing profile?");
    expect(JSON.parse(run.output.slice(run.output.indexOf("{")))).toMatchObject({
      pruned: [{ pairingId: "pair-stale" }]
    });
    expect(daemon.config.pairings.map((entry) => entry.pairingId)).toEqual(["pair-active"]);
  });

  it("lists only the profiles idle past an explicit cutoff", async () => {
    const config = createEmptyConfig();
    addPairing(config, {
      pairingId: "pair-week",
      credential: "b".repeat(43),
      label: "Week Old",
      lastSeenAt: daysAgo(7)
    });
    const { daemon } = await startPrunableDaemon(config);

    const kept = await runAuthCli(daemon, ["auth", "prune", "--older-than", "30"], { answer: "y" });
    expect(kept.error).toBeNull();
    expect(kept.output).toContain("No pairing profile has been idle for more than 30 days");
    expect(kept.output).not.toContain("Remove ");
    expect(kept.output).toContain('"pruned": []');
    expect(daemon.config.pairings).toHaveLength(1);

    const pruned = await runAuthCli(daemon, ["auth", "prune", "--older-than", "3"], { answer: "y" });
    expect(pruned.error).toBeNull();
    expect(pruned.output).toContain("1 pairing profile idle for more than 3 days:");
    expect(pruned.output).toContain("Week Old");
    expect(daemon.config.pairings).toHaveLength(0);
  });

  it("leaves every profile in place when the prune confirmation is declined", async () => {
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-stale", credential: "b".repeat(43), lastSeenAt: daysAgo(60) });
    const { daemon } = await startPrunableDaemon(config);
    let pruneCalls = 0;
    const prune = daemon.daemonOperations["auth.prune"];
    daemon.daemonOperations["auth.prune"] = (params, respond, reject, socket) => {
      pruneCalls += 1;
      prune(params, respond, reject, socket);
    };

    for (const answer of ["n", "", "maybe"]) {
      const run = await runAuthCli(daemon, ["auth", "prune"], { answer });

      expect((run.error as CommanderError).code, answer).toBe("fvtt-world-cli.pruneDeclined");
      expect(planCliErrorOutput(run.error, false, { commanderAlreadyPrinted: false }), answer).toMatchObject({
        exitCode: 1,
        stderr: expect.stringContaining("PAIRING_DECLINED")
      });
      expect(daemon.config.pairings, answer).toHaveLength(1);
    }
    expect(pruneCalls).toBe(0);
  });

  it("leaves every profile in place when the prune prompt ends without an answer", async () => {
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-stale", credential: "b".repeat(43), lastSeenAt: daysAgo(60) });
    const { daemon } = await startPrunableDaemon(config);

    const run = await runAuthCli(daemon, ["auth", "prune"]);

    expect((run.error as CommanderError).code).toBe("fvtt-world-cli.pairingPromptAborted");
    expect(planCliErrorOutput(run.error, false, { commanderAlreadyPrinted: false })).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("PAIRING_PROMPT_ABORTED")
    });
    expect(daemon.config.pairings).toHaveLength(1);
  });

  it("renders the daemon error when a prune cannot list its candidates", async () => {
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-stale", credential: "b".repeat(43), lastSeenAt: daysAgo(60) });
    const { daemon } = await startPrunableDaemon(config);
    daemon.daemonOperations["auth.list"] = (_params, _respond, reject) =>
      reject(ERROR_CODES.INTERNAL_ERROR, "Pairing registry unavailable");

    const run = await runAuthCli(daemon, ["auth", "prune"], { answer: "y" });

    expect((run.error as CommanderError).code).toBe("fvtt-world-cli.pruneCandidatesUnavailable");
    const rendered = planCliErrorOutput(run.error, false, { commanderAlreadyPrinted: false });
    expect(rendered.stderr).toContain("Pairing registry unavailable");
    expect(rendered.stderr).toContain(ERROR_CODES.INTERNAL_ERROR);
    expect(rendered.exitCode).toBe(1);
    expect(daemon.config.pairings).toHaveLength(1);
  });

  it("refuses to prune without a terminal unless --yes is passed", async () => {
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-stale", credential: "b".repeat(43), lastSeenAt: daysAgo(60) });
    const { daemon } = await startPrunableDaemon(config);

    const guarded = await runAuthCli(daemon, ["auth", "prune"], { answer: "y", isTTY: false });
    expect((guarded.error as CommanderError).code).toBe("fvtt-world-cli.approvalRequired");
    expect(planCliErrorOutput(guarded.error, false, { commanderAlreadyPrinted: false }).exitCode).toBe(2);
    expect(guarded.output).toBe("");
    expect(daemon.config.pairings).toHaveLength(1);

    const confirmed = await runAuthCli(daemon, ["auth", "prune", "--yes"], { isTTY: false });
    expect(confirmed.error).toBeNull();
    expect(confirmed.output).not.toContain("idle for more than");
    expect(confirmed.output).not.toContain("Remove ");
    expect(JSON.parse(confirmed.output)).toMatchObject({ pruned: [{ pairingId: "pair-stale" }] });
    expect(daemon.config.pairings).toHaveLength(0);
  });

  it("refuses to prune with --json unless --yes is passed", async () => {
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-stale", credential: "b".repeat(43), lastSeenAt: daysAgo(60) });
    const { daemon } = await startPrunableDaemon(config);

    for (const args of [
      ["--json", "auth", "prune"],
      ["auth", "prune", "--json"]
    ]) {
      const run = await runAuthCli(daemon, args, { answer: "y" });

      expect((run.error as CommanderError).code, args.join(" ")).toBe("fvtt-world-cli.approvalRequired");
      expect((run.error as CommanderError).message, args.join(" ")).toContain("--yes");
      expect(planCliErrorOutput(run.error, true).exitCode, args.join(" ")).toBe(2);
      expect(run.output, args.join(" ")).toBe("");
    }
    expect(daemon.config.pairings).toHaveLength(1);

    const confirmed = await runAuthCli(daemon, ["--json", "auth", "prune", "--yes"], { isTTY: false });
    expect(confirmed.error).toBeNull();
    expect(JSON.parse(confirmed.output)).toMatchObject({
      operation: "auth.prune",
      ok: true,
      result: { olderThanDays: 30, pruned: [{ pairingId: "pair-stale" }] }
    });
    expect(daemon.config.pairings).toHaveLength(0);
  });

  it("rejects a prune cutoff that is not a whole number of days", async () => {
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-stale", credential: "b".repeat(43), lastSeenAt: daysAgo(60) });
    const { daemon } = await startPrunableDaemon(config);

    for (const value of ["1.5", "-1", "later"]) {
      const run = await runAuthCli(daemon, ["auth", "prune", "--older-than", value, "--yes"], {
        isTTY: false
      });

      expect(run.error, value).toBeInstanceOf(CommanderError);
      expect(planCliErrorOutput(run.error, false, { commanderAlreadyPrinted: false }).exitCode, value).toBe(
        2
      );
      expect(daemon.config.pairings, value).toHaveLength(1);
    }
  });

  it("rejects extra arguments to an auth subcommand", async () => {
    const daemon = await startPairingDaemon();

    const run = await runAuthCli(daemon, ["auth", "deny", "ABCDEFGH", "extra"], { answer: "y" });

    expect((run.error as CommanderError).code).toBe("commander.excessArguments");
    expect(daemon.awaitWaiters.size).toBe(0);
  });

  it("rejects a bridge hello whose client id does not match the stored pairing", async () => {
    const credential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, { pairingId: "pair-1", credential, clientId: SECOND_CLIENT_ID });
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();

    const mismatched = await connectBridge(daemon, {
      pairingId: "pair-1",
      credential,
      clientId: THIRD_CLIENT_ID
    });
    expect(mismatched.ack).toMatchObject({ ok: false, error: { code: ERROR_CODES.UNAUTHORIZED } });
    expect(daemon.activePairingId).toBeNull();

    const matching = await connectBridge(daemon, {
      pairingId: "pair-1",
      credential,
      clientId: SECOND_CLIENT_ID
    });
    expect(matching.ack.ok).toBe(true);
  });

  it("rejects a pairing label carrying terminal escapes without recording it", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const cli = await connectCli(daemon, config.deviceCredential);

    for (const label of [
      `${String.fromCodePoint(0x1b)}[31mChrome`,
      `Chrome${String.fromCodePoint(0x200b)}Profile`,
      `Chrome${String.fromCodePoint(0x07)}`
    ]) {
      const browser = await open(daemon.daemonUrl, "http://localhost:30000");
      sockets.push(browser);
      const rejected = next(browser);
      browser.send(
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          type: MESSAGE_TYPES.PAIRING_REQUEST,
          identity: pairingIdentity({ label })
        })
      );
      expect(await rejected, label).toMatchObject({
        ok: false,
        error: { code: ERROR_CODES.INVALID_MESSAGE }
      });
      await closed(browser);
    }

    expect(daemon.pendingPairings.size).toBe(0);
    expect((await control(cli, "pending-none", "auth.pending")).result.pending).toEqual([]);
    expect(daemon.config.pairings).toEqual([]);
  });

  it("scopes cached idempotent results per client so another browser's retry is forwarded", async () => {
    const firstCredential = "b".repeat(43);
    const secondCredential = "c".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, {
      pairingId: "pair-first",
      credential: firstCredential,
      clientId: SECOND_CLIENT_ID
    });
    addPairing(config, {
      pairingId: "pair-second",
      credential: secondCredential,
      clientId: THIRD_CLIENT_ID
    });
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();

    const first = await connectBridge(daemon, {
      pairingId: "pair-first",
      credential: firstCredential,
      clientId: SECOND_CLIENT_ID,
      commands: ["item.create"]
    });
    const cli = await connectCli(daemon, config.deviceCredential);
    const forwarded = next(first.socket);
    cli.send(JSON.stringify(itemCreateRequest("item-1", "shared-key")));
    await forwarded;
    const response = next(cli);
    first.socket.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_RESPONSE,
        id: "item-1",
        ok: true,
        result: { item: { id: "created-1" } }
      })
    );
    await response;
    expect(daemon.idempotencyCache.size).toBe(1);

    const goodbye = closed(first.socket);
    first.socket.send(
      JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: MESSAGE_TYPES.BRIDGE_GOODBYE })
    );
    await goodbye;

    const second = await connectBridge(daemon, {
      pairingId: "pair-second",
      credential: secondCredential,
      clientId: THIRD_CLIENT_ID,
      commands: ["item.create"]
    });
    expect(second.ack.ok).toBe(true);
    const forwardedAgain = next(second.socket);
    cli.send(JSON.stringify(itemCreateRequest("item-2", "shared-key")));

    expect(await forwardedAgain).toMatchObject({ id: "item-2", command: "item.create" });
  });

  it("re-pairs the same client in place, rotating its credential and adopting its new label", async () => {
    const oldCredential = "b".repeat(43);
    const config = createEmptyConfig();
    addPairing(config, {
      pairingId: "pair-1",
      credential: oldCredential,
      label: "Chrome",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
    const oldDigest = config.pairings[0].credentialDigest;
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const cli = await connectCli(daemon, config.deviceCredential);
    const browser = await open(daemon.daemonUrl, "http://localhost:30000");
    sockets.push(browser);
    const pending = next(browser);
    browser.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_REQUEST,
        identity: pairingIdentity({ label: "Zen Browser" })
      })
    );
    const pairingPending = await pending;
    const result = next(browser);
    expect(
      (await control(cli, "repair-1", "auth.approve", { code: pairingPending.code })).result.pairing.pairingId
    ).toBe("pair-1");
    const delivered = await result;
    expect(delivered).toMatchObject({ ok: true, pairingId: "pair-1" });
    expect(delivered.credential).not.toBe(oldCredential);
    expect(daemon.config.pairings).toHaveLength(1);
    expect(daemon.config.pairings[0].credentialDigest).not.toBe(oldDigest);
    expect(daemon.config.pairings[0].label).toBe("Zen Browser");
    expect(daemon.config.pairings[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("cancels a pending pairing when its bound browser socket closes", async () => {
    const config = createEmptyConfig();
    const daemon = createBridgeDaemon({
      daemonUrl: `ws://127.0.0.1:${await freePort()}`,
      config,
      logger: pino({ level: "silent" })
    });
    daemons.push(daemon);
    await daemon.start();
    const cli = await connectCli(daemon, config.deviceCredential);
    const browser = await open(daemon.daemonUrl, "http://localhost:30000");
    sockets.push(browser);
    const pending = next(browser);
    browser.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_REQUEST,
        identity: pairingIdentity()
      })
    );
    const pairingPending = await pending;
    const browserClosed = closed(browser);
    browser.close(1000);
    await browserClosed;
    await waitFor(() => !daemon.pendingPairings.has(pairingPending.code));
    expect(await control(cli, "approve-gone", "auth.approve", { code: pairingPending.code })).toMatchObject({
      ok: false,
      error: { code: ERROR_CODES.PAIRING_NOT_FOUND }
    });
  });

  it("returns a cached idempotent success without forwarding the retry", async () => {
    const { daemon, bridge, cli } = await startItemDaemon();
    const firstForward = next(bridge);
    cli.send(JSON.stringify(itemCreateRequest("item-1", "key-1")));
    await firstForward;
    const firstResponse = next(cli);
    bridge.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_RESPONSE,
        id: "item-1",
        ok: true,
        result: { item: { id: "created-1" } }
      })
    );
    await firstResponse;
    expect(daemon.idempotencyCache.size).toBe(1);

    let forwardedAgain = false;
    bridge.once("message", () => {
      forwardedAgain = true;
    });
    const cached = next(cli);
    cli.send(JSON.stringify(itemCreateRequest("item-2", "key-1")));
    expect(await cached).toMatchObject({ id: "item-2", ok: true, result: { item: { id: "created-1" } } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(forwardedAgain).toBe(false);
  });

  it("rejects conflicting and coalesces identical in-flight idempotency keys", async () => {
    const { bridge, cli } = await startItemDaemon();
    const forwarded = next(bridge);
    cli.send(JSON.stringify(itemCreateRequest("item-a", "shared-key")));
    const first = await forwarded;
    expect(first.id).toBe("item-a");

    const conflict = next(cli);
    cli.send(JSON.stringify(itemCreateRequest("item-conflict", "shared-key", "Shield")));
    expect(await conflict).toMatchObject({
      id: "item-conflict",
      ok: false,
      error: { code: ERROR_CODES.IDEMPOTENCY_KEY_CONFLICT }
    });

    const responsesPromise = nextMessages(cli, 2);
    cli.send(JSON.stringify(itemCreateRequest("item-b", "shared-key")));
    bridge.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_RESPONSE,
        id: "item-a",
        ok: true,
        result: { item: { id: "created-shared" } }
      })
    );
    const responses = await responsesPromise;
    expect(responses.map((entry) => entry.id).sort()).toEqual(["item-a", "item-b"]);
  });

  it("does not cache failed or dry-run idempotent responses", async () => {
    const { daemon, bridge, cli } = await startItemDaemon();
    let forwarded = next(bridge);
    cli.send(JSON.stringify(itemCreateRequest("failed-1", "key-failed")));
    await forwarded;
    let response = next(cli);
    bridge.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_RESPONSE,
        id: "failed-1",
        ok: false,
        error: { code: ERROR_CODES.INTERNAL_ERROR, message: "failed", details: {} }
      })
    );
    await response;
    expect(daemon.idempotencyCache.size).toBe(0);
    forwarded = next(bridge);
    cli.send(JSON.stringify(itemCreateRequest("failed-2", "key-failed")));
    expect((await forwarded).id).toBe("failed-2");

    response = next(cli);
    bridge.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_RESPONSE,
        id: "failed-2",
        ok: true,
        result: { item: { id: "created" } }
      })
    );
    await response;
    forwarded = next(bridge);
    cli.send(JSON.stringify(itemCreateRequest("preview-1", "key-preview", "Preview", true)));
    await forwarded;
    response = next(cli);
    bridge.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_RESPONSE,
        id: "preview-1",
        ok: true,
        result: { dryRun: true }
      })
    );
    await response;
    expect(daemon.idempotencyCache.size).toBe(1);
  });

  it("expires cached idempotent results and forwards the same key again", async () => {
    let now = 1_000;
    const { bridge, cli } = await startItemDaemon({
      idempotencyCacheOptions: { now: () => now },
      idempotencyTtlMs: 100
    });
    let forwarded = next(bridge);
    cli.send(JSON.stringify(itemCreateRequest("ttl-1", "ttl-key")));
    await forwarded;
    const completed = next(cli);
    bridge.send(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_RESPONSE,
        id: "ttl-1",
        ok: true,
        result: { item: { id: "created" } }
      })
    );
    await completed;
    now = 2_000;
    forwarded = next(bridge);
    cli.send(JSON.stringify(itemCreateRequest("ttl-2", "ttl-key")));
    expect((await forwarded).id).toBe("ttl-2");
  });
});
