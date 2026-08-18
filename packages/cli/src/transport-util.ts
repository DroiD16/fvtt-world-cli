import { ERROR_CODES, parseBridgeMessage, validateTransportMessage } from "@fvtt-world-cli/protocol";
import type WebSocket from "ws";
import type { RawData } from "ws";

export interface ProtocolErrorShape {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface CommandResponseEnvelope {
  protocolVersion: string;
  type: string;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: ProtocolErrorShape;
}

export class DaemonTransportError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DaemonTransportError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeIncomingData(data: RawData) {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  return data.toString("utf8");
}

export function isCommandResponseEnvelope(
  message: unknown,
  acceptedTypes: readonly string[]
): message is CommandResponseEnvelope {
  return (
    typeof message === "object" &&
    message !== null &&
    acceptedTypes.includes((message as CommandResponseEnvelope).type) &&
    typeof (message as CommandResponseEnvelope).id === "string" &&
    typeof (message as CommandResponseEnvelope).ok === "boolean"
  );
}

export function decodeTransportFrame(
  data: RawData
): { ok: true; value: unknown } | { ok: false; error: DaemonTransportError } {
  const parsed = parseBridgeMessage(normalizeIncomingData(data));
  if (!parsed.ok) {
    return {
      ok: false,
      error: new DaemonTransportError(
        ERROR_CODES.INVALID_MESSAGE,
        parsed.error?.message ?? "Daemon returned invalid JSON",
        { reason: "invalid_json" }
      )
    };
  }

  const validation = validateTransportMessage(parsed.value);
  if (!validation.ok) {
    return {
      ok: false,
      error: new DaemonTransportError(
        ERROR_CODES.INVALID_MESSAGE,
        "Daemon returned an invalid transport message",
        { reason: "invalid_message", errors: validation.errors }
      )
    };
  }

  return { ok: true, value: parsed.value };
}

export function sendJson(socket: WebSocket, payload: unknown) {
  if (socket.readyState !== socket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
}
