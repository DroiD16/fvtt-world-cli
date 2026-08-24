import {
  BRIDGE_RELEASE_CLOSE_CODE,
  BRIDGE_TAKEOVER_CLOSE_CODE,
  BRIDGE_TAKEOVER_CLOSE_REASON,
  DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
  DEFAULT_WS_MAX_PAYLOAD_BYTES,
  ERROR_CODES,
  MESSAGE_TYPES,
  MODULE_ID,
  PROTOCOL_COMPONENTS,
  PROTOCOL_HANDSHAKES,
  PROTOCOL_VERSION,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  createBridgeHello,
  createErrorResponse,
  createProtocolError,
  getProtocolVersionError,
  parseBridgeMessage,
  validateTransportMessage
} from "./generated/protocol.js";

const DEFAULT_EFFECTIVE_LIMITS = Object.freeze({
  uploadBytes: DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
  wsMaxPayloadBytes: DEFAULT_WS_MAX_PAYLOAD_BYTES
});

function normalizeAckLimits(limits) {
  if (!limits || typeof limits !== "object") {
    return null;
  }
  const uploadBytes = limits.uploadBytes;
  const wsMaxPayloadBytes = limits.wsMaxPayloadBytes;
  if (
    typeof uploadBytes !== "number" ||
    !Number.isFinite(uploadBytes) ||
    uploadBytes <= 0 ||
    typeof wsMaxPayloadBytes !== "number" ||
    !Number.isFinite(wsMaxPayloadBytes) ||
    wsMaxPayloadBytes <= 0
  ) {
    return null;
  }
  return { uploadBytes, wsMaxPayloadBytes };
}
import { format, localize } from "./lib/i18n.js";
import { utf8ByteLength } from "./lib/setting-values.js";
import {
  getBridgeBusyWarningMessage,
  getDaemonUnavailableWarningMessage,
  getRejectedCredentialWarningMessage,
  getProtocolVersionSkewWarningMessage,
  getRejectedHandshakeWarningMessage,
  warnBridgeDisabled
} from "./lib/startup.js";

function defaultLogger(level, message, details = {}) {
  const prefix = `[${MODULE_ID}]`;
  const logMethod =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : level === "info"
          ? console.info
          : console.log;
  logMethod(prefix, message, details);
}

// The frame is weighed from the wire form it arrives in, so nothing downstream serializes a request a
// second time to learn how heavy it is. Counting a text frame walks it, and only a command sent to
// approval is ever weighed, so the measurement stays a call the router makes on that branch alone; a
// binary frame reports its own size.
/**
 * @param {unknown} data
 * @returns {Promise<{ text: string, measureBytes: () => number }>}
 */
function normalizeMessageFrame(data) {
  if (typeof data === "string") {
    return Promise.resolve({ text: data, measureBytes: () => utf8ByteLength(data) });
  }

  if (data instanceof ArrayBuffer) {
    const bytes = data.byteLength;
    return Promise.resolve({ text: new TextDecoder().decode(data), measureBytes: () => bytes });
  }

  if (typeof Blob !== "undefined" && data instanceof Blob) {
    const bytes = data.size;
    return data.text().then((text) => ({ text, measureBytes: () => bytes }));
  }

  const text = String(data ?? "");
  return Promise.resolve({ text, measureBytes: () => utf8ByteLength(text) });
}

export class BridgeClient {
  /** @type {((snapshot: Record<string, any>) => void) | null} */
  #onStatusChange = null;

  constructor(options) {
    const {
      url,
      pairingId,
      credential,
      clientId,
      router,
      getSession,
      logger = defaultLogger,
      onStatusChange = null,
      maxResponseBytes = DEFAULT_WS_MAX_PAYLOAD_BYTES
    } = options;
    this.#onStatusChange = onStatusChange;
    this.url = url;
    this.pairingId = pairingId;
    this.credential = credential;
    this.clientId = clientId;
    this.router = router;
    this.getSession = getSession;
    this.logger = logger;

    this.maxResponseBytes = maxResponseBytes;

    this.limits = null;
    this.socket = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.status = "idle";
    this.helloAcknowledged = false;
    this.lastConnectedAt = null;
    this.hasConnectedOnce = false;
    this.hasEstablishedSession = false;
    this.shouldReconnect = true;
    this.terminalStopReason = null;
    /** @type {{ expectedVersion: string, actualVersion: string, staleComponent: string } | null} */
    this.protocolVersionMismatch = null;
    this.hasWarnedTerminalStop = false;
    this.pendingDaemonRequests = new Map();
  }

  #emitStatusChange() {
    if (!this.#onStatusChange) return;
    try {
      this.#onStatusChange(this.getStatus());
    } catch (error) {
      this.logger("warn", "Bridge status subscriber failed", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  /** @param {string} value */
  #setStatus(value) {
    if (this.status === value) return;
    this.status = value;
    this.#emitStatusChange();
  }

  /** @param {boolean} value */
  #setHelloAcknowledged(value) {
    if (this.helloAcknowledged === value) return;
    this.helloAcknowledged = value;
    this.#emitStatusChange();
  }

  // Reset without emitting. Every caller then transitions the status, and that emission carries the
  // truthful snapshot; emitting here would publish a still-connected client with a dropped handshake.
  #dropHandshakeAcknowledgement() {
    this.helloAcknowledged = false;
  }

  start() {
    if (this.terminalStopReason) {
      this.#setStatus("stopped");
      return;
    }

    this.shouldReconnect = true;
    this.connect();
  }

  stop() {
    this.shouldReconnect = false;
    this.clearReconnectTimer();

    if (this.socket) {
      if (this.helloAcknowledged)
        this.send({ protocolVersion: PROTOCOL_VERSION, type: MESSAGE_TYPES.BRIDGE_GOODBYE });
      this.socket.close();
      this.socket = null;
    }

    this.#dropHandshakeAcknowledgement();
    this.#releaseApprovals();
    this.#setStatus("stopped");
  }

  // A session that ends with no reconnect to follow takes its approvals with it: nothing can poll their
  // outcome any more, so a decision left armed would run a command whose caller was already answered
  // with a failure, and its timer, params and parked polls would be held for nobody. A dropped socket
  // that reconnects is not such an end, and keeps them.
  #releaseApprovals() {
    this.router?.approvalStore?.clear?.();
  }

  connect() {
    if (this.terminalStopReason) {
      this.#setStatus("stopped");
      return;
    }

    if (!globalThis.WebSocket) {
      this.#setStatus("error");
      this.logger("error", "WebSocket is not available in this Foundry runtime");
      return;
    }

    this.#setStatus("connecting");
    this.logger("info", "Connecting bridge client", { url: this.url });

    this.socket = new globalThis.WebSocket(this.url);
    this.socket.addEventListener("open", () => this.handleOpen());
    this.socket.addEventListener("message", (event) => {
      void this.handleMessage(event);
    });
    this.socket.addEventListener("close", (event) => this.handleClose(event));
    this.socket.addEventListener("error", (event) => this.handleSocketError(event));
  }

  handleOpen() {
    this.lastConnectedAt = new Date().toISOString();
    this.hasConnectedOnce = true;
    this.#setStatus("connected");

    this.logger("info", "Bridge client connected", { url: this.url });
    this.send(
      createBridgeHello({
        pairingId: this.pairingId,
        credential: this.credential,
        clientId: this.clientId,
        session: this.getSession()
      })
    );
  }

  async handleMessage(event) {
    const frame = await normalizeMessageFrame(event.data);
    const parsed = parseBridgeMessage(frame.text);

    if (!parsed.ok) {
      this.logger("warn", "Received invalid JSON from daemon", parsed.error);
      return;
    }

    const message = parsed.value;
    const validation = validateTransportMessage(message);
    if (!validation.ok) {
      if (message.type === MESSAGE_TYPES.BRIDGE_HELLO_ACK && message.protocolVersion !== PROTOCOL_VERSION) {
        this.handleHelloAck(message);
        return;
      }
      this.logger("warn", "Ignoring invalid daemon transport message", { errors: validation.errors });
      return;
    }

    if (message.type === MESSAGE_TYPES.BRIDGE_HELLO_ACK) {
      this.handleHelloAck(message);
      return;
    }

    if (message.type === MESSAGE_TYPES.DAEMON_RESPONSE) {
      const pending = this.pendingDaemonRequests.get(message.id);
      if (!pending || pending.operation !== message.operation) return;
      clearTimeout(pending.timer);
      this.pendingDaemonRequests.delete(message.id);
      pending.resolve(message);
      return;
    }

    if (message.protocolVersion && message.protocolVersion !== PROTOCOL_VERSION) {
      this.logger("warn", "Ignoring message with unsupported protocol version", {
        actualVersion: message.protocolVersion,
        expectedVersion: PROTOCOL_VERSION
      });
      return;
    }

    if (message.type !== MESSAGE_TYPES.COMMAND_REQUEST) {
      this.logger("warn", "Ignoring unsupported daemon message type", { type: message.type });
      return;
    }

    if (!globalThis.game?.user?.isGM) {
      this.send(
        createErrorResponse({
          id: message.id,
          error: createProtocolError({
            code: ERROR_CODES.PERMISSION_DENIED,
            message: `Command ${message.command} requires a current GM session`,
            details: { command: message.command }
          })
        })
      );
      this.stop();
      return;
    }

    const response = await this.router.route(message, { measureRequestBytes: frame.measureBytes });
    this.send(response);
  }

  handleHelloAck(message) {
    if (message.protocolVersion && message.protocolVersion !== PROTOCOL_VERSION) {
      this.#setHelloAcknowledged(false);
      this.stopForProtocolVersionSkew(message);
      return;
    }

    if (message.ok) {
      this.hasEstablishedSession = true;
      this.reconnectAttempts = 0;

      this.limits = normalizeAckLimits(message.limits);
      this.#setHelloAcknowledged(true);
      this.logger("info", "Daemon acknowledged bridge session", {
        ok: true,
        ...(this.limits ? { limits: this.limits } : {})
      });
      return;
    }

    this.#setHelloAcknowledged(false);

    if (message.error?.code === ERROR_CODES.UNAUTHORIZED) {
      this.stopForRejectedCredential(message.error);
      return;
    }

    if (message.error?.code === ERROR_CODES.BRIDGE_BUSY) {
      this.stopForBridgeBusy(message.error);
      return;
    }

    this.stopForRejectedHandshake(message.error);
  }

  handleClose(event) {
    this.rejectDaemonRequests(
      new Error(
        format("FVTTWORLDCLI.Errors.DaemonClosed", {
          code: event.code,
          reason: event.reason || localize("FVTTWORLDCLI.Errors.NoCloseReason")
        })
      )
    );
    this.socket = null;
    this.#dropHandshakeAcknowledgement();

    this.limits = null;

    if (event.code === BRIDGE_TAKEOVER_CLOSE_CODE) {
      this.terminalStopReason = { code: "TAKEN_OVER", message: event.reason || BRIDGE_TAKEOVER_CLOSE_REASON };
      this.shouldReconnect = false;
      this.clearReconnectTimer();
      this.#releaseApprovals();
      this.#setStatus("stopped");
      return;
    }

    if (event.code === BRIDGE_RELEASE_CLOSE_CODE) {
      this.terminalStopReason = { code: "RELEASED", message: event.reason || "Bridge released" };
      this.shouldReconnect = false;
      this.clearReconnectTimer();
      this.#releaseApprovals();
      this.#setStatus("stopped");
      return;
    }

    if (this.terminalStopReason?.code === ERROR_CODES.UNAUTHORIZED) {
      this.shouldReconnect = false;
      this.clearReconnectTimer();
      this.#setStatus("stopped");

      if (!this.hasWarnedTerminalStop) {
        this.hasWarnedTerminalStop = true;
        warnBridgeDisabled(this.logger, getRejectedCredentialWarningMessage(), {
          code: event.code,
          reason: event.reason || "no reason"
        });
      }

      return;
    }

    if (this.terminalStopReason) {
      this.shouldReconnect = false;
      this.clearReconnectTimer();
      this.#setStatus("stopped");
      return;
    }

    if (!this.hasConnectedOnce && this.shouldReconnect) {
      this.stopForUnavailableDaemon({
        code: event.code,
        reason: event.reason || "no reason"
      });
      return;
    }

    this.#setStatus(this.shouldReconnect ? "disconnected" : "stopped");
    this.logger("warn", "Bridge client disconnected", {
      code: event.code,
      reason: event.reason || "no reason"
    });

    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  handleSocketError(event) {
    if (this.terminalStopReason || !this.hasConnectedOnce) {
      return;
    }

    this.logger("error", "Bridge socket reported an error", {
      type: event.type
    });
  }

  scheduleReconnect() {
    if (!this.shouldReconnect || this.terminalStopReason) {
      return;
    }

    this.clearReconnectTimer();

    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_DELAY_MS);

    this.reconnectAttempts += 1;
    this.#setStatus("reconnecting");
    this.logger("info", "Scheduling bridge reconnect", {
      delay,
      attempt: this.reconnectAttempts
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** @param {{ code: string, message: string, warn?: { message: string, details: Record<string, any> } }} reason */
  stopTerminally({ code, message, warn }) {
    this.terminalStopReason = { code, message };
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.#releaseApprovals();
    this.#setStatus("stopped");

    if (warn && !this.hasWarnedTerminalStop) {
      this.hasWarnedTerminalStop = true;
      warnBridgeDisabled(this.logger, warn.message, warn.details);
    }
  }

  stopForRejectedCredential(error) {
    this.stopTerminally({
      code: ERROR_CODES.UNAUTHORIZED,
      message: error?.message || "Bridge hello credential mismatch"
    });
  }

  stopForBridgeBusy(error) {
    this.stopTerminally({
      code: ERROR_CODES.BRIDGE_BUSY,
      message: error?.message || "Another pairing owns the active bridge slot",
      warn: { message: getBridgeBusyWarningMessage(), details: { error } }
    });
  }

  // The older half is worked out here rather than read off the ack: a daemon from a release that
  // predates these details answers with none, and that is exactly the mismatch a GM meets first.
  stopForProtocolVersionSkew(message) {
    const daemonVersion = String(message.protocolVersion ?? "unknown");
    const details = /** @type {{ staleComponent: string }} */ (
      getProtocolVersionError(daemonVersion, {
        peer: PROTOCOL_COMPONENTS.CLI_DAEMON,
        reporter: PROTOCOL_COMPONENTS.MODULE,
        handshake: PROTOCOL_HANDSHAKES.MODULE_DAEMON
      }).details
    );
    const mismatch = {
      expectedVersion: PROTOCOL_VERSION,
      actualVersion: daemonVersion,
      staleComponent: details.staleComponent
    };
    this.protocolVersionMismatch = mismatch;

    this.stopTerminally({
      code: ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION,
      message: `Module protocol version ${PROTOCOL_VERSION} is incompatible with daemon version ${daemonVersion}`,
      warn: {
        message: getProtocolVersionSkewWarningMessage(mismatch),
        details: mismatch
      }
    });
  }

  stopForRejectedHandshake(error) {
    this.stopTerminally({
      code: error?.code ?? ERROR_CODES.INVALID_MESSAGE,
      message: error?.message || "Daemon rejected the bridge handshake",
      warn: {
        message: getRejectedHandshakeWarningMessage(error?.message),
        details: { ...(error ? { error } : {}) }
      }
    });
  }

  stopForUnavailableDaemon(details) {
    this.stopTerminally({
      code: ERROR_CODES.DAEMON_UNAVAILABLE,
      message: "Initial bridge connection failed because the daemon was unavailable",
      warn: {
        message: getDaemonUnavailableWarningMessage(),
        details: { ...details, url: this.url }
      }
    });
  }

  send(payload) {
    if (!this.socket || this.socket.readyState !== globalThis.WebSocket.OPEN) {
      this.logger("warn", "Skipping send because socket is not open", {
        type: payload?.type
      });
      return;
    }

    const serialized = JSON.stringify(payload);

    const maxResponseBytes = this.limits?.wsMaxPayloadBytes ?? this.maxResponseBytes;
    if (
      payload?.type === MESSAGE_TYPES.COMMAND_RESPONSE &&
      typeof payload.id === "string" &&
      serialized.length * 3 > maxResponseBytes
    ) {
      const responseBytes = new TextEncoder().encode(serialized).length;
      if (responseBytes > maxResponseBytes) {
        this.logger("warn", "Response exceeds transport frame cap; returning PAYLOAD_TOO_LARGE", {
          id: payload.id,
          responseBytes,
          limitBytes: maxResponseBytes
        });
        this.socket.send(
          JSON.stringify(
            createErrorResponse({
              id: payload.id,
              error: createProtocolError({
                code: ERROR_CODES.PAYLOAD_TOO_LARGE,
                message: `Response for request ${payload.id} is ${responseBytes} bytes but the transport frame cap is ${maxResponseBytes} bytes; the frame cap derives from uploadLimitBytes in the daemon config, so raise that or narrow/paginate the query`,
                details: {
                  limitBytes: maxResponseBytes,
                  actualBytes: responseBytes
                }
              })
            })
          )
        );
        return;
      }
    }

    this.socket.send(serialized);
  }

  sendError(id, error) {
    this.send(
      createErrorResponse({
        id,
        error
      })
    );
  }

  rejectDaemonRequests(error) {
    for (const pending of this.pendingDaemonRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingDaemonRequests.clear();
  }

  requestDaemon(operation, params, timeoutMs = 10_000) {
    if (!this.socket || this.socket.readyState !== globalThis.WebSocket.OPEN || !this.helloAcknowledged) {
      return Promise.reject(new Error(localize("FVTTWORLDCLI.Errors.RevokeUnavailable")));
    }
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingDaemonRequests.delete(id);
        reject(new Error(format("FVTTWORLDCLI.Errors.DaemonRequestTimeout", { operation })));
      }, timeoutMs);
      this.pendingDaemonRequests.set(id, { operation, resolve, reject, timer });
      this.send({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.DAEMON_REQUEST,
        id,
        operation,
        params
      });
    });
  }

  async revokePairing() {
    const response = await this.requestDaemon("auth.revoke", { pairingId: this.pairingId });
    if (!response.ok) {
      throw Object.assign(
        new Error(response.error?.message ?? localize("FVTTWORLDCLI.Errors.RevokeFailed")),
        { code: response.error?.code }
      );
    }
    return response.result;
  }

  getEffectiveLimits() {
    return this.limits ?? DEFAULT_EFFECTIVE_LIMITS;
  }

  getLimitsInfo() {
    const limits = this.limits ?? DEFAULT_EFFECTIVE_LIMITS;
    return {
      uploadBytes: limits.uploadBytes,
      wsMaxPayloadBytes: limits.wsMaxPayloadBytes,
      uploadSource: this.limits ? "config" : "default"
    };
  }

  getStatus() {
    return {
      status: this.status,
      url: this.url,
      helloAcknowledged: this.helloAcknowledged,
      hasEstablishedSession: this.hasEstablishedSession,
      lastConnectedAt: this.lastConnectedAt,
      reconnectAttempts: this.reconnectAttempts,
      terminalStopReason: this.terminalStopReason?.code ?? null,
      protocolVersionMismatch: this.protocolVersionMismatch
    };
  }
}
