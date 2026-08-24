import { randomUUID } from "node:crypto";

import {
  DEFAULT_DAEMON_URL,
  DEFAULT_WS_MAX_PAYLOAD_BYTES,
  ERROR_CODES,
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  createProtocolError,
  createClientHello,
  parseBridgeMessage,
  validateCommandRequest,
  validateDaemonRequest,
  validateTransportMessage
} from "@fvtt-world-cli/protocol";
import WebSocket from "ws";

import { DEFAULT_CLIENT_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS } from "../bridge/session-store.js";
import {
  DaemonTransportError,
  decodeTransportFrame,
  isCommandResponseEnvelope,
  normalizeIncomingData,
  protocolVersionSkewError,
  type CommandResponseEnvelope
} from "../transport-util.js";

export { DaemonTransportError };

const ACCEPTED_RESPONSE_TYPES: readonly string[] = Object.freeze([
  MESSAGE_TYPES.COMMAND_RESPONSE,
  MESSAGE_TYPES.DAEMON_RESPONSE
]);

let hasWarnedUnsafeClientTimeout = false;

export function resetUnsafeClientTimeoutWarningForTests() {
  hasWarnedUnsafeClientTimeout = false;
}

export function warnIfClientTimeoutUnsafe(
  timeoutMs: number,
  writeStderr: (message: string) => void = (message) => {
    process.stderr.write(message);
  }
) {
  if (timeoutMs < DEFAULT_REQUEST_TIMEOUT_MS || hasWarnedUnsafeClientTimeout) {
    return;
  }

  hasWarnedUnsafeClientTimeout = true;
  writeStderr(
    `warning: --timeout-ms (${timeoutMs}) is not below the daemon forward-timeout default (${DEFAULT_REQUEST_TIMEOUT_MS}ms); with this inverted ordering a slow op surfaces a spurious BRIDGE_TIMEOUT and non-keyed ops reach the may-have-committed window sooner (keyed idempotent retries still dedupe safely). Lower --timeout-ms or raise the daemon --request-timeout-ms.\n`
  );
}

export interface SendCommandOptions {
  daemonUrl?: string;
  deviceCredential?: string;
  command: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;

  maxPayloadBytes?: number;
}

function buildValidatedRequest(
  command: string,
  params: Record<string, unknown>
):
  | {
      ok: true;
      request: {
        protocolVersion: string;
        type: string;
        id: string;
        command: string;
        params: Record<string, unknown>;
      };
    }
  | { ok: false; envelope: CommandResponseEnvelope } {
  const request = {
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.COMMAND_REQUEST,
    id: randomUUID(),
    command,
    params
  };

  const validationResult = validateCommandRequest(request);
  if (!validationResult.ok) {
    return {
      ok: false,
      envelope: {
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_RESPONSE,
        id: request.id,
        ok: false,
        error: createProtocolError({
          code: ERROR_CODES.INVALID_PARAMS,
          message: `Invalid params for ${command}`,
          details: {
            errors: validationResult.errors
          }
        })
      }
    };
  }

  return { ok: true, request };
}

export async function sendCommand({
  daemonUrl = DEFAULT_DAEMON_URL,
  deviceCredential,
  command,
  params = {},
  timeoutMs = DEFAULT_CLIENT_TIMEOUT_MS,
  maxPayloadBytes = DEFAULT_WS_MAX_PAYLOAD_BYTES
}: SendCommandOptions) {
  warnIfClientTimeoutUnsafe(timeoutMs);

  const built = buildValidatedRequest(command, params);
  if (!built.ok) {
    return built.envelope;
  }
  const request = built.request;

  const socket = new WebSocket(daemonUrl, { maxPayload: maxPayloadBytes });

  return await new Promise<CommandResponseEnvelope>((resolve, reject) => {
    let settled = false;

    let opened = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      socket.terminate();
      reject(
        new DaemonTransportError(
          ERROR_CODES.DAEMON_UNAVAILABLE,
          `Timed out waiting for daemon response to ${command} after ${timeoutMs}ms`,
          { reason: "timeout", command, timeoutMs }
        )
      );
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      socket.removeAllListeners();
      if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) {
        socket.close();
      }
    }

    socket.once("open", () => {
      opened = true;
      socket.send(JSON.stringify(createClientHello({ credential: deviceCredential ?? "" })));
    });

    socket.on("message", (data) => {
      if (settled) {
        return;
      }

      const decoded = decodeTransportFrame(data);
      if (!decoded.ok) {
        settled = true;
        cleanup();
        reject(decoded.error);
        return;
      }

      const frame = decoded.value;

      if ((frame as { type?: string }).type === MESSAGE_TYPES.CLIENT_HELLO_ACK) {
        const ack = frame as {
          ok?: boolean;
          error?: { code?: string; message?: string; details?: Record<string, unknown> };
        };
        if (ack.ok) {
          socket.send(JSON.stringify(request));
          return;
        }
        settled = true;
        cleanup();
        reject(
          new DaemonTransportError(
            ack.error?.code ?? ERROR_CODES.UNAUTHORIZED,
            ack.error?.message ?? "Daemon rejected client authentication",
            ack.error?.details
          )
        );
        return;
      }

      if (!isCommandResponseEnvelope(frame, ACCEPTED_RESPONSE_TYPES)) {
        settled = true;
        cleanup();
        reject(
          new DaemonTransportError(
            ERROR_CODES.INVALID_MESSAGE,
            "Daemon returned an unexpected message type",
            { reason: "unexpected_type" }
          )
        );
        return;
      }

      if (frame.id !== request.id) {
        return;
      }

      settled = true;
      cleanup();
      resolve(frame);
    });

    socket.once("close", (code, reason) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(
        new DaemonTransportError(
          ERROR_CODES.DAEMON_UNAVAILABLE,
          `Daemon connection closed (${code}): ${reason.toString() || "no reason"}`,
          { reason: "closed", closeCode: code }
        )
      );
    });

    socket.once("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(
        new DaemonTransportError(
          ERROR_CODES.DAEMON_UNAVAILABLE,
          error instanceof Error ? error.message : String(error),

          { reason: opened ? "closed" : "connect_error" }
        )
      );
    });
  });
}

export interface PersistentDaemonClient {
  send(options: {
    command: string;
    params?: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<CommandResponseEnvelope>;
  requestControl(options: {
    operation: string;
    params?: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<CommandResponseEnvelope>;
  close(): Promise<void>;
}

interface PendingRequest {
  resolve: (envelope: CommandResponseEnvelope) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export async function connectDaemonClient({
  daemonUrl = DEFAULT_DAEMON_URL,
  deviceCredential,
  timeoutMs = DEFAULT_CLIENT_TIMEOUT_MS,
  maxPayloadBytes = DEFAULT_WS_MAX_PAYLOAD_BYTES
}: {
  daemonUrl?: string;
  deviceCredential?: string;
  timeoutMs?: number;
  maxPayloadBytes?: number;
}): Promise<PersistentDaemonClient> {
  warnIfClientTimeoutUnsafe(timeoutMs);

  const socket = new WebSocket(daemonUrl, { maxPayload: maxPayloadBytes });
  const pending = new Map<string, PendingRequest>();
  let closedError: DaemonTransportError | null = null;

  function rejectPending(error: DaemonTransportError) {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  }

  function failAllPending(error: DaemonTransportError) {
    if (!closedError) {
      closedError = error;
    }
    rejectPending(error);
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(
        new DaemonTransportError(
          ERROR_CODES.DAEMON_UNAVAILABLE,
          `Timed out connecting to daemon after ${timeoutMs}ms`,
          { reason: "timeout", timeoutMs }
        )
      );
    }, timeoutMs);

    socket.once("open", () => {
      socket.send(JSON.stringify(createClientHello({ credential: deviceCredential ?? "" })));
    });
    socket.once("message", (data) => {
      const parsed = parseBridgeMessage(normalizeIncomingData(data));
      const skew = parsed.ok ? protocolVersionSkewError(parsed.value) : null;
      if (skew) {
        clearTimeout(timer);
        reject(skew);
        socket.close();
        return;
      }
      const validation = parsed.ok ? validateTransportMessage(parsed.value) : { ok: false };
      const message =
        parsed.ok && validation.ok
          ? (parsed.value as {
              type?: string;
              ok?: boolean;
              error?: { code?: string; message?: string; details?: Record<string, unknown> };
            })
          : null;
      if (!message || message.type !== MESSAGE_TYPES.CLIENT_HELLO_ACK || !message.ok) {
        clearTimeout(timer);
        reject(
          new DaemonTransportError(
            message?.error?.code ?? ERROR_CODES.UNAUTHORIZED,
            message?.error?.message ?? "Daemon rejected client authentication",
            message?.error?.details
          )
        );
        socket.close();
        return;
      }
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(
        new DaemonTransportError(
          ERROR_CODES.DAEMON_UNAVAILABLE,
          error instanceof Error ? error.message : String(error),
          { reason: "connect_error" }
        )
      );
    });
    socket.once("close", (code, reason) => {
      clearTimeout(timer);
      reject(
        new DaemonTransportError(
          ERROR_CODES.DAEMON_UNAVAILABLE,
          `Daemon connection closed (${code}): ${reason.toString() || "no reason"}`,
          { reason: "closed", closeCode: code }
        )
      );
    });
  });

  socket.removeAllListeners();

  socket.on("message", (data) => {
    const decoded = decodeTransportFrame(data);

    if (!decoded.ok) {
      rejectPending(decoded.error);
      return;
    }

    if (!isCommandResponseEnvelope(decoded.value, ACCEPTED_RESPONSE_TYPES)) {
      rejectPending(
        new DaemonTransportError(ERROR_CODES.INVALID_MESSAGE, "Daemon returned an unexpected message type", {
          reason: "unexpected_type"
        })
      );
      return;
    }

    const envelope = decoded.value;
    const entry = pending.get(envelope.id);
    if (!entry) {
      return;
    }

    pending.delete(envelope.id);
    clearTimeout(entry.timer);
    entry.resolve(envelope);
  });

  socket.on("close", (code, reason) => {
    failAllPending(
      new DaemonTransportError(
        ERROR_CODES.DAEMON_UNAVAILABLE,
        `Daemon connection closed (${code}): ${reason.toString() || "no reason"}`,
        { reason: "closed", closeCode: code }
      )
    );
  });

  socket.on("error", (error) => {
    failAllPending(
      new DaemonTransportError(
        ERROR_CODES.DAEMON_UNAVAILABLE,
        error instanceof Error ? error.message : String(error),

        { reason: "closed" }
      )
    );
  });

  return {
    async send({ command, params = {}, timeoutMs = DEFAULT_CLIENT_TIMEOUT_MS }) {
      warnIfClientTimeoutUnsafe(timeoutMs);

      if (closedError) {
        throw closedError;
      }

      const built = buildValidatedRequest(command, params);
      if (!built.ok) {
        return built.envelope;
      }
      const request = built.request;

      return await new Promise<CommandResponseEnvelope>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(request.id);
          reject(
            new DaemonTransportError(
              ERROR_CODES.DAEMON_UNAVAILABLE,
              `Timed out waiting for daemon response to ${command} after ${timeoutMs}ms`,
              { reason: "timeout", command, timeoutMs }
            )
          );
        }, timeoutMs);

        pending.set(request.id, { resolve, reject, timer });
        socket.send(JSON.stringify(request));
      });
    },

    async requestControl({ operation, params = {}, timeoutMs = DEFAULT_CLIENT_TIMEOUT_MS }) {
      if (closedError) throw closedError;
      const id = randomUUID();
      const request = {
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.DAEMON_REQUEST,
        id,
        operation,
        params
      };
      const validation = validateDaemonRequest(request);
      if (!validation.ok) {
        return {
          protocolVersion: PROTOCOL_VERSION,
          type: MESSAGE_TYPES.DAEMON_RESPONSE,
          id,
          operation,
          ok: false,
          error: createProtocolError({
            code: ERROR_CODES.INVALID_PARAMS,
            message: `Invalid params for ${operation}`,
            details: { errors: validation.errors }
          })
        };
      }
      return await new Promise<CommandResponseEnvelope>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new DaemonTransportError(
              ERROR_CODES.DAEMON_UNAVAILABLE,
              `Timed out waiting for daemon control response to ${operation}`,
              { reason: "timeout", operation, timeoutMs }
            )
          );
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify(request));
      });
    },

    async close() {
      if (socket.readyState === socket.CLOSED) {
        return;
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          socket.terminate();
          resolve();
        }, timeoutMs);

        socket.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
        socket.close();
      });
    }
  };
}
