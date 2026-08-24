import {
  ERROR_CODES,
  MESSAGE_TYPES,
  PROTOCOL_COMPONENTS,
  PROTOCOL_HANDSHAKES,
  PROTOCOL_VERSION,
  getProtocolVersionError,
  parseBridgeMessage,
  validateTransportMessage
} from "@fvtt-world-cli/protocol";
import type WebSocket from "ws";
import type { RawData } from "ws";

export const APPROVAL_AWAIT_COMMAND = "approval.await";
export const APPROVAL_CANCEL_COMMAND = "approval.cancel";

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

export function protocolVersionSkewError(message: unknown): DaemonTransportError | null {
  if (typeof message !== "object" || message === null) {
    return null;
  }

  const frame = message as { type?: unknown; protocolVersion?: unknown };
  if (
    frame.type !== MESSAGE_TYPES.CLIENT_HELLO_ACK ||
    typeof frame.protocolVersion !== "string" ||
    frame.protocolVersion === PROTOCOL_VERSION
  ) {
    return null;
  }

  const error = getProtocolVersionError(frame.protocolVersion, {
    peer: PROTOCOL_COMPONENTS.CLI_DAEMON,
    reporter: PROTOCOL_COMPONENTS.CLI_DAEMON,
    handshake: PROTOCOL_HANDSHAKES.CLI_DAEMON
  });

  return new DaemonTransportError(error.code, error.message, error.details);
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

  const skew = protocolVersionSkewError(parsed.value);
  if (skew) {
    return { ok: false, error: skew };
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
