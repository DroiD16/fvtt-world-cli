import {
  BRIDGE_TAKEOVER_CLOSE_CODE,
  BRIDGE_TAKEOVER_CLOSE_REASON,
  ERROR_CODES,
  createErrorResponse,
  createProtocolError
} from "@fvtt-world-cli/protocol";
import type WebSocket from "ws";

import { sendJson, type CommandResponseEnvelope } from "../transport-util.js";

import type { IdempotencyMetadata } from "./idempotency-cache.js";

export const DEFAULT_CLIENT_TIMEOUT_MS = 60_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export interface BridgeSessionInfo {
  moduleId: string;
  moduleVersion: string;
  world: {
    id: string;
    title: string;
  };
  user: {
    id: string;
    name: string;
    isGM: boolean;
  };
  commands: string[];
}

export interface CommandRequestEnvelope {
  protocolVersion: string;
  type: string;
  id: string;
  command: string;
  params: Record<string, unknown>;
}

interface Waiter {
  clientSocket: WebSocket;
  requestId: string;

  notified?: boolean;
}

interface PendingRequest {
  waiters: Waiter[];
  timeout: NodeJS.Timeout;
  bridgeSocket: WebSocket;

  idempotency?: IdempotencyMetadata;

  worldId?: string;
}

function inFlightIndexKey(worldId: string, idempotencyKey: string) {
  return JSON.stringify([worldId, idempotencyKey]);
}

export class BridgeSessionStore {
  activeBridgeSocket: WebSocket | null;
  activeSession: BridgeSessionInfo | null;
  pendingRequests: Map<string, PendingRequest>;

  inFlightByKey: Map<string, string>;

  constructor() {
    this.activeBridgeSocket = null;
    this.activeSession = null;
    this.pendingRequests = new Map();
    this.inFlightByKey = new Map();
  }

  registerBridge(socket: WebSocket, session: BridgeSessionInfo) {
    const staleSocket =
      this.activeBridgeSocket && this.activeBridgeSocket !== socket ? this.activeBridgeSocket : null;

    if (staleSocket) {
      this.failPendingForBridge(staleSocket, "taken-over");
    }

    this.activeBridgeSocket = socket;
    this.activeSession = session;

    if (staleSocket) {
      staleSocket.close(BRIDGE_TAKEOVER_CLOSE_CODE, BRIDGE_TAKEOVER_CLOSE_REASON);
    }

    return { ok: true };
  }

  getBridgeStatus() {
    return {
      connected: Boolean(this.activeBridgeSocket && this.activeSession),
      session: this.activeSession
    };
  }

  hasActiveBridge() {
    return Boolean(this.activeBridgeSocket && this.activeSession);
  }

  canHandleCommand(command: string) {
    return this.activeSession?.commands.includes(command) ?? false;
  }

  findInFlight(worldId: string, idempotencyKey: string): { requestId: string; fingerprint: string } | null {
    const requestId = this.inFlightByKey.get(inFlightIndexKey(worldId, idempotencyKey));
    if (requestId === undefined) {
      return null;
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending?.idempotency) {
      this.inFlightByKey.delete(inFlightIndexKey(worldId, idempotencyKey));
      return null;
    }

    return { requestId, fingerprint: pending.idempotency.fingerprint };
  }

  addWaiter(forwardedRequestId: string, waiter: Waiter): boolean {
    const pending = this.pendingRequests.get(forwardedRequestId);
    if (!pending) {
      return false;
    }

    pending.waiters.push(waiter);
    return true;
  }

  private forgetPending(requestId: string): PendingRequest | undefined {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return undefined;
    }

    this.pendingRequests.delete(requestId);
    if (pending.idempotency && pending.worldId !== undefined) {
      const indexKey = inFlightIndexKey(pending.worldId, pending.idempotency.key);
      if (this.inFlightByKey.get(indexKey) === requestId) {
        this.inFlightByKey.delete(indexKey);
      }
    }

    return pending;
  }

  forwardRequest({
    request,
    clientSocket,
    requestTimeoutMs,
    retentionMs,
    idempotency,
    worldId
  }: {
    request: CommandRequestEnvelope;
    clientSocket: WebSocket;
    requestTimeoutMs: number;

    retentionMs: number;
    idempotency?: IdempotencyMetadata;

    worldId?: string;
  }) {
    if (!this.activeBridgeSocket || !this.activeSession) {
      return {
        ok: false,
        error: createProtocolError({
          code: ERROR_CODES.BRIDGE_NOT_READY,
          message:
            "No authenticated Foundry bridge session is available; nothing was forwarded (safe to retry) — ensure a GM client is logged into the target world with the bridge module connected, then check `fvtt-world-cli system info`"
        })
      };
    }

    if (!this.canHandleCommand(request.command)) {
      return {
        ok: false,
        error: createProtocolError({
          code: ERROR_CODES.UNKNOWN_COMMAND,
          message: `Bridge session does not advertise support for ${request.command}; run system.info to see the connected bridge's supported command inventory (the module may be older than this CLI)`,
          details: {
            command: request.command,
            supportedCommands: this.activeSession.commands
          }
        })
      };
    }

    const timeout = setTimeout(() => {
      const pending = this.pendingRequests.get(request.id);
      const timeoutError = createErrorResponse({
        id: request.id,
        error: createProtocolError({
          code: ERROR_CODES.BRIDGE_TIMEOUT,
          message: `Timed out waiting for Foundry bridge response to ${request.command} after ${requestTimeoutMs}ms; the request was forwarded so it MAY have committed — verify world state before retrying (a same idempotencyKey retry can fetch the cached late success once it lands)`,
          details: {
            reason: "timeout",
            command: request.command,
            timeoutMs: requestTimeoutMs
          }
        })
      });
      if (pending?.idempotency) {
        for (const waiter of pending.waiters) {
          sendJson(waiter.clientSocket, { ...timeoutError, id: waiter.requestId });
          waiter.notified = true;
        }
        pending.timeout = setTimeout(() => {
          const retentionExpiredError = createErrorResponse({
            id: request.id,
            error: createProtocolError({
              code: ERROR_CODES.BRIDGE_TIMEOUT,
              message: `Idempotency dedupe window for ${request.command} expired after the daemon retained the request ${retentionMs}ms past its forward timeout with no Foundry response; the request was forwarded so it MAY have committed — verify world state before retrying (a same idempotencyKey retry will re-forward, not dedupe)`,
              details: {
                reason: "retention-expired",
                command: request.command,
                retentionMs
              }
            })
          });
          const retained = this.pendingRequests.get(request.id);
          if (retained) {
            for (const waiter of retained.waiters) {
              if (!waiter.notified) {
                sendJson(waiter.clientSocket, { ...retentionExpiredError, id: waiter.requestId });
              }
            }
          }
          this.forgetPending(request.id);
        }, retentionMs);
      } else {
        this.forgetPending(request.id);
        sendJson(clientSocket, timeoutError);
      }
    }, requestTimeoutMs);

    this.pendingRequests.set(request.id, {
      waiters: [{ clientSocket, requestId: request.id }],
      timeout,
      bridgeSocket: this.activeBridgeSocket,
      ...(idempotency ? { idempotency } : {}),
      ...(idempotency && worldId !== undefined ? { worldId } : {})
    });

    if (idempotency && worldId !== undefined) {
      this.inFlightByKey.set(inFlightIndexKey(worldId, idempotency.key), request.id);
    }

    sendJson(this.activeBridgeSocket, request);

    return { ok: true };
  }

  resolveResponse(response: CommandResponseEnvelope): {
    matched: boolean;
    idempotency: IdempotencyMetadata | null;

    worldId: string | null;
  } {
    const pendingRequest = this.pendingRequests.get(response.id);
    if (!pendingRequest) {
      return { matched: false, idempotency: null, worldId: null };
    }

    clearTimeout(pendingRequest.timeout);

    this.forgetPending(response.id);
    for (const waiter of pendingRequest.waiters) {
      sendJson(waiter.clientSocket, { ...response, id: waiter.requestId });
    }
    return {
      matched: true,
      idempotency: pendingRequest.idempotency ?? null,
      worldId: pendingRequest.worldId ?? null
    };
  }

  removeSocket(socket: WebSocket) {
    if (this.activeBridgeSocket === socket) {
      this.failPendingForBridge(socket, "disconnected");
      this.activeBridgeSocket = null;
      this.activeSession = null;
      this.inFlightByKey.clear();
      return;
    }

    for (const [requestId, pendingRequest] of this.pendingRequests.entries()) {
      const remainingWaiters = pendingRequest.waiters.filter((waiter) => waiter.clientSocket !== socket);
      if (remainingWaiters.length === pendingRequest.waiters.length) {
        continue;
      }
      pendingRequest.waiters = remainingWaiters;

      if (pendingRequest.idempotency) {
        continue;
      }

      clearTimeout(pendingRequest.timeout);
      this.forgetPending(requestId);
    }
  }

  failPendingForBridge(socket: WebSocket, reason: "disconnected" | "taken-over") {
    for (const [requestId, pendingRequest] of this.pendingRequests.entries()) {
      if (pendingRequest.bridgeSocket !== socket) {
        continue;
      }
      clearTimeout(pendingRequest.timeout);
      this.forgetPending(requestId);
      const disconnectError = createErrorResponse({
        id: requestId,
        error: createProtocolError({
          code: ERROR_CODES.BRIDGE_DISCONNECTED,
          message:
            reason === "taken-over"
              ? "Authenticated Foundry bridge session was replaced by a newer socket from the same pairing while the request was pending; it was already forwarded so it MAY have committed — verify world state before retrying"
              : "Authenticated Foundry bridge session disconnected while the request was pending; it was already forwarded so it MAY have committed — verify world state before retrying (this is NOT idempotency-key safe: the disconnect path caches nothing, so a keyed retry re-forwards)",
          details: { reason }
        })
      });
      for (const waiter of pendingRequest.waiters) {
        sendJson(waiter.clientSocket, { ...disconnectError, id: waiter.requestId });
      }
    }
  }

  clearAllPending() {
    for (const pendingRequest of this.pendingRequests.values()) {
      clearTimeout(pendingRequest.timeout);
    }
    this.pendingRequests.clear();
    this.inFlightByKey.clear();
  }
}
