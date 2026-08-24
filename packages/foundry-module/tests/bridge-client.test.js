import { beforeEach, describe, expect, it, vi } from "vitest";

import { BridgeClient } from "../scripts/bridge-client.js";
import {
  BRIDGE_RELEASE_CLOSE_CODE,
  BRIDGE_TAKEOVER_CLOSE_CODE,
  DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
  DEFAULT_WS_MAX_PAYLOAD_BYTES,
  ERROR_CODES,
  MESSAGE_TYPES,
  MODULE_TITLE,
  PROTOCOL_VERSION,
  validateHelloMessage
} from "../scripts/generated/protocol.js";
import {
  getBridgeBusyWarningMessage,
  getDaemonUnavailableWarningMessage,
  getRejectedCredentialWarningMessage,
  getProtocolVersionSkewWarningMessage,
  getRejectedHandshakeWarningMessage
} from "../scripts/lib/startup.js";
import { createEnglishI18n } from "./helpers/i18n.js";

// Without a localizer every warning builder returns its bare catalog key, which would make each
// expectation below compare one key to itself and accept a swapped or dropped placeholder value.
beforeEach(() => {
  globalThis.game = /** @type {any} */ ({ i18n: createEnglishI18n() });
});

// The prose belongs to the catalog, so a message is pinned by the key it was rendered from and the data
// it was rendered with; comparing sentences would pass a key that renders the wrong remedy.
function observeLocalization() {
  const i18n = createEnglishI18n();
  const localizer = { localize: vi.fn(i18n.localize), format: vi.fn(i18n.format) };
  globalThis.game = /** @type {any} */ ({ i18n: localizer });
  return localizer;
}

function countNotifications() {
  return Object.values(globalThis.ui.notifications).reduce(
    (total, notify) => total + notify.mock.calls.length,
    0
  );
}

function createClient(logger = vi.fn()) {
  return new BridgeClient({
    url: "ws://127.0.0.1:47833",
    credential: "invalid-credential",
    router: {
      route: vi.fn(async () => ({ ok: true }))
    },
    getSession: () => ({ moduleId: "fvtt-world-cli" }),
    logger
  });
}

/** @param {{ ok: boolean, error?: Record<string, unknown>, protocolVersion?: string, limits?: Record<string, unknown> }} args */
function createHelloAck({ ok, error, protocolVersion = PROTOCOL_VERSION, limits }) {
  return {
    data: JSON.stringify({
      protocolVersion,
      type: MESSAGE_TYPES.BRIDGE_HELLO_ACK,
      ok,
      ...(error ? { error } : {}),
      ...(limits ? { limits } : {})
    })
  };
}

function markClientConnected(client) {
  globalThis.WebSocket = /** @type {any} */ ({
    CONNECTING: 0,
    OPEN: 1
  });

  const send = vi.fn();
  client.socket = /** @type {any} */ ({
    readyState: 1,
    send
  });

  client.handleOpen();
  return send;
}

describe("BridgeClient terminal shutdown", () => {
  beforeEach(() => {
    globalThis.ui = {
      notifications: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    };
  });

  it("stops permanently after an unauthorized hello ack and warns only once", async () => {
    const logger = vi.fn();
    const client = createClient(logger);
    const scheduleReconnect = vi.spyOn(client, "scheduleReconnect");

    await client.handleMessage(
      createHelloAck({
        ok: false,
        error: {
          code: ERROR_CODES.UNAUTHORIZED,
          message: "Bridge hello credential mismatch"
        }
      })
    );

    client.handleClose({ code: 1008, reason: "Unauthorized bridge" });
    client.handleClose({ code: 1008, reason: "Unauthorized bridge" });

    expect(scheduleReconnect).not.toHaveBeenCalled();
    expect(globalThis.ui.notifications.warn).toHaveBeenCalledTimes(1);
    expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith(getRejectedCredentialWarningMessage(), {
      permanent: true
    });
    expect(logger.mock.calls.filter(([, message]) => message === "Bridge client disconnected")).toHaveLength(
      0
    );
    expect(client.getStatus()).toMatchObject({
      status: "stopped",
      terminalStopReason: ERROR_CODES.UNAUTHORIZED
    });
  });

  it("does not restart once terminally stopped for unauthorized auth", async () => {
    const client = createClient();
    const connect = vi.spyOn(client, "connect");

    await client.handleMessage(
      createHelloAck({
        ok: false,
        error: {
          code: ERROR_CODES.UNAUTHORIZED,
          message: "Bridge hello credential mismatch"
        }
      })
    );

    client.start();

    expect(connect).not.toHaveBeenCalled();
    expect(client.getStatus().status).toBe("stopped");
  });

  it("reports BRIDGE_BUSY distinctly, preserves the pairing state, and waits for manual retry", async () => {
    const logger = vi.fn();
    const client = createClient(logger);
    const scheduleReconnect = vi.spyOn(client, "scheduleReconnect");

    await client.handleMessage(
      createHelloAck({
        ok: false,
        error: { code: ERROR_CODES.BRIDGE_BUSY, message: "Another pairing owns the slot" }
      })
    );

    expect(scheduleReconnect).not.toHaveBeenCalled();
    expect(client.getStatus()).toMatchObject({
      status: "stopped",
      terminalStopReason: ERROR_CODES.BRIDGE_BUSY
    });
    expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith(getBridgeBusyWarningMessage(), {
      permanent: true
    });
    expect(globalThis.ui.notifications.warn).not.toHaveBeenCalledWith(getRejectedCredentialWarningMessage(), {
      permanent: true
    });
  });

  it("stops permanently after the initial daemon refusal and warns only once", () => {
    const logger = vi.fn();
    const client = createClient(logger);
    const scheduleReconnect = vi.spyOn(client, "scheduleReconnect").mockImplementation(() => {});

    client.handleSocketError({ type: "error" });
    client.handleClose({ code: 1006, reason: "no reason" });
    client.handleClose({ code: 1006, reason: "no reason" });

    expect(scheduleReconnect).not.toHaveBeenCalled();
    expect(globalThis.ui.notifications.warn).toHaveBeenCalledTimes(1);
    expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith(getDaemonUnavailableWarningMessage(), {
      permanent: true
    });
    expect(
      logger.mock.calls.filter(([, message]) => message === "Bridge socket reported an error")
    ).toHaveLength(0);
    expect(logger.mock.calls.filter(([, message]) => message === "Bridge client disconnected")).toHaveLength(
      0
    );

    expect(logger.mock.calls.filter(([level]) => level === "warn")).toHaveLength(0);
    expect(client.getStatus()).toMatchObject({
      status: "stopped",
      terminalStopReason: ERROR_CODES.DAEMON_UNAVAILABLE
    });
  });

  it("does not restart once terminally stopped for daemon unavailability", () => {
    const client = createClient();
    const connect = vi.spyOn(client, "connect");

    client.handleClose({ code: 1006, reason: "no reason" });
    client.start();

    expect(connect).not.toHaveBeenCalled();
    expect(client.getStatus()).toMatchObject({
      status: "stopped",
      terminalStopReason: ERROR_CODES.DAEMON_UNAVAILABLE
    });
  });

  it("keeps reconnect behavior after a successful non-auth session disconnect", () => {
    const logger = vi.fn();
    const client = createClient(logger);
    const scheduleReconnect = vi.spyOn(client, "scheduleReconnect").mockImplementation(() => {});

    markClientConnected(client);
    client.handleClose({ code: 1006, reason: "socket lost" });

    expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith("warn", "Bridge client disconnected", {
      code: 1006,
      reason: "socket lost"
    });
  });

  it("stops after bridge.release and requires a new manual Retry client", () => {
    const client = createClient();
    const scheduleReconnect = vi.spyOn(client, "scheduleReconnect");
    const connect = vi.spyOn(client, "connect");

    markClientConnected(client);
    client.handleClose({ code: BRIDGE_RELEASE_CLOSE_CODE, reason: "Bridge released" });
    client.start();

    expect(scheduleReconnect).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(client.getStatus()).toMatchObject({ status: "stopped", terminalStopReason: "RELEASED" });
  });
});

describe("BridgeClient handshake reliability", () => {
  beforeEach(() => {
    globalThis.ui = {
      notifications: {
        warn: vi.fn()
      }
    };
  });

  it("names the paired browser in the bridge hello beside the credential", async () => {
    const client = new BridgeClient({
      url: "ws://127.0.0.1:47833",
      pairingId: "pair-1",
      credential: "c".repeat(43),
      clientId: "a1a1a1a1b2b2c3c3d4d4e5e5f6f6a7a7",
      router: { route: vi.fn(async () => ({ ok: true })) },
      getSession: () => ({
        moduleId: "fvtt-world-cli",
        moduleVersion: "1.0.0",
        world: { id: "world-1", title: "World" },
        user: { id: "gm-1", name: "GM", isGM: true },
        commands: ["system.ping"]
      }),
      logger: vi.fn()
    });

    const send = markClientConnected(client);

    const hello = JSON.parse(send.mock.calls[0][0]);
    expect(validateHelloMessage(hello)).toEqual({ ok: true, errors: [] });
    expect(hello).toMatchObject({
      pairingId: "pair-1",
      clientId: "a1a1a1a1b2b2c3c3d4d4e5e5f6f6a7a7"
    });
    expect(hello.session.user).toEqual({ id: "gm-1", name: "GM", isGM: true });
  });

  it("goes terminal on a non-UNAUTHORIZED ok:false hello-ack without scheduling a reconnect", async () => {
    const logger = vi.fn();
    const client = createClient(logger);
    const scheduleReconnect = vi.spyOn(client, "scheduleReconnect");

    markClientConnected(client);
    await client.handleMessage(
      createHelloAck({
        ok: false,
        error: {
          code: ERROR_CODES.INVALID_MESSAGE,
          message: "Invalid bridge hello"
        }
      })
    );

    client.handleClose({ code: 1008, reason: "Bridge session rejected" });

    expect(scheduleReconnect).not.toHaveBeenCalled();
    expect(globalThis.ui.notifications.warn).toHaveBeenCalledTimes(1);
    expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith(
      getRejectedHandshakeWarningMessage("Invalid bridge hello"),
      { permanent: true }
    );
    expect(globalThis.ui.notifications.warn.mock.calls[0][0]).toContain("(Invalid bridge hello)");
    expect(logger.mock.calls.filter(([, message]) => message === "Bridge client disconnected")).toHaveLength(
      0
    );
    expect(client.getStatus()).toMatchObject({
      status: "stopped",
      terminalStopReason: ERROR_CODES.INVALID_MESSAGE
    });
  });

  it("surfaces a protocol-version-skewed hello-ack as a terminal version-skew stop", async () => {
    const logger = vi.fn();
    const client = createClient(logger);
    const scheduleReconnect = vi.spyOn(client, "scheduleReconnect");

    markClientConnected(client);
    await client.handleMessage(
      createHelloAck({
        ok: false,
        protocolVersion: "9.9.0",
        error: {
          code: ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION,
          message: `Unsupported protocol version: ${PROTOCOL_VERSION}`,
          details: {
            expectedVersion: "9.9.0",
            actualVersion: PROTOCOL_VERSION,
            staleComponent: "module",
            handshake: "module-daemon"
          }
        }
      })
    );

    expect(scheduleReconnect).not.toHaveBeenCalled();
    expect(globalThis.ui.notifications.warn).toHaveBeenCalledTimes(1);

    expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith(
      getProtocolVersionSkewWarningMessage({
        expectedVersion: PROTOCOL_VERSION,
        actualVersion: "9.9.0",
        staleComponent: "module"
      }),
      { permanent: true }
    );
    const skewWarning = globalThis.ui.notifications.warn.mock.calls[0][0];
    expect(skewWarning.indexOf(PROTOCOL_VERSION)).toBeGreaterThan(-1);
    expect(skewWarning.indexOf(PROTOCOL_VERSION)).toBeLessThan(skewWarning.indexOf("9.9"));
    expect(client.getStatus()).toMatchObject({
      status: "stopped",
      terminalStopReason: ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION
    });
  });

  // A daemon still on the released protocol answers with no mismatch details at all, so a module that
  // read the older half off the ack would meet the very first mismatch a GM can hit with nothing to say.
  it.each([
    [
      "the daemon speaks the protocol version published before releases matched",
      "3.0",
      "cli-daemon",
      "FVTTWORLDCLI.Startup.ProtocolVersionSkewDaemon"
    ],
    [
      "the daemon speaks a later protocol version than this module",
      "9.9.0",
      "module",
      "FVTTWORLDCLI.Startup.ProtocolVersionSkewModule"
    ],
    [
      "the daemon's protocol version cannot be ordered against this module's",
      "next-dev",
      "unknown",
      "FVTTWORLDCLI.Startup.ProtocolVersionSkewUnknown"
    ]
  ])("tells the GM which half is behind when %s", async (_case, daemonVersion, staleComponent, key) => {
    const localizer = observeLocalization();
    const client = createClient();

    markClientConnected(client);
    await client.handleMessage(
      createHelloAck({
        ok: false,
        protocolVersion: daemonVersion,
        error: {
          code: ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION,
          message: `Unsupported protocol version: ${PROTOCOL_VERSION}`
        }
      })
    );

    expect(localizer.format).toHaveBeenCalledWith(key, {
      module: MODULE_TITLE,
      expected: PROTOCOL_VERSION,
      actual: daemonVersion
    });
    expect(countNotifications()).toBe(1);
    expect(globalThis.ui.notifications.warn.mock.calls[0][1]).toEqual({ permanent: true });
    expect(client.getStatus()).toMatchObject({
      status: "stopped",
      terminalStopReason: ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION,
      protocolVersionMismatch: {
        expectedVersion: PROTOCOL_VERSION,
        actualVersion: daemonVersion,
        staleComponent
      }
    });
  });

  it("does not silently drop a version-skewed hello-ack the way it drops command messages", async () => {
    const logger = vi.fn();
    const client = createClient(logger);

    markClientConnected(client);
    await client.handleMessage(
      createHelloAck({
        ok: false,
        protocolVersion: "9.9.0",
        error: {
          code: ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION,
          message: "Unsupported protocol version: 9.9.0"
        }
      })
    );

    expect(
      logger.mock.calls.filter(
        ([, message]) => message === "Ignoring message with unsupported protocol version"
      )
    ).toHaveLength(0);
    expect(client.getStatus().terminalStopReason).toBe(ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION);
  });

  it("resets reconnectAttempts only after a successful hello-ack, not on transport open", async () => {
    const client = createClient();

    markClientConnected(client);

    client.reconnectAttempts = 4;
    client.handleOpen();
    expect(client.reconnectAttempts).toBe(4);
    expect(client.hasEstablishedSession).toBe(false);

    await client.handleMessage(createHelloAck({ ok: true }));

    expect(client.reconnectAttempts).toBe(0);
    expect(client.hasEstablishedSession).toBe(true);
    expect(client.getStatus()).toMatchObject({
      helloAcknowledged: true,
      hasEstablishedSession: true
    });
  });

  it("still schedules a backoff reconnect after a transport drop that follows a successful ack", async () => {
    const client = createClient();
    const scheduleReconnect = vi.spyOn(client, "scheduleReconnect").mockImplementation(() => {});

    markClientConnected(client);
    await client.handleMessage(createHelloAck({ ok: true }));
    expect(client.reconnectAttempts).toBe(0);

    client.handleClose({ code: 1006, reason: "daemon restarted" });

    expect(scheduleReconnect).toHaveBeenCalledTimes(1);
    expect(client.terminalStopReason).toBeNull();
    expect(client.shouldReconnect).toBe(true);
  });

  it("increments reconnectAttempts across successive never-acked drops (backoff engages)", () => {
    const client = createClient();

    client.hasConnectedOnce = true;

    client.scheduleReconnect();
    client.scheduleReconnect();
    client.scheduleReconnect();

    expect(client.reconnectAttempts).toBe(3);
    client.clearReconnectTimer();
  });

  it("continues routing for a different live GM id and responds before stopping after GM authority is lost", async () => {
    globalThis.game = /** @type {any} */ ({
      i18n: createEnglishI18n(),
      user: { id: "gm-after-reload", isGM: true }
    });
    const route = vi.fn(async (message) => ({
      protocolVersion: PROTOCOL_VERSION,
      type: MESSAGE_TYPES.COMMAND_RESPONSE,
      id: message.id,
      ok: true,
      result: {}
    }));
    const client = new BridgeClient({
      url: "ws://127.0.0.1:47833",
      pairingId: "pair-1",
      credential: "b".repeat(43),
      router: { route },
      getSession: () => ({ user: { id: "gm-original" } }),
      logger: vi.fn()
    });
    globalThis.WebSocket = /** @type {any} */ ({ OPEN: 1 });
    client.socket = /** @type {any} */ ({ readyState: 1, send: vi.fn(), close: vi.fn() });
    client.helloAcknowledged = true;
    const request = {
      protocolVersion: PROTOCOL_VERSION,
      type: MESSAGE_TYPES.COMMAND_REQUEST,
      id: "read-1",
      command: "system.ping",
      params: {}
    };

    await client.handleMessage({ data: JSON.stringify(request) });
    expect(route).toHaveBeenCalledTimes(1);

    for (const deniedRequest of [
      { ...request, id: "read-2" },
      {
        ...request,
        id: "write-1",
        command: "item.create",
        params: { data: { name: "Denied", type: "weapon" } }
      }
    ]) {
      const deniedClient = new BridgeClient({
        url: "ws://127.0.0.1:47833",
        pairingId: "pair-1",
        credential: "b".repeat(43),
        router: { route },
        getSession: () => ({ user: { id: "gm-original" } }),
        logger: vi.fn()
      });
      const send = vi.fn();
      const close = vi.fn();
      deniedClient.socket = /** @type {any} */ ({ readyState: 1, send, close });
      deniedClient.helloAcknowledged = true;
      globalThis.game.user.isGM = false;

      await deniedClient.handleMessage({ data: JSON.stringify(deniedRequest) });

      expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({
        type: MESSAGE_TYPES.COMMAND_RESPONSE,
        id: deniedRequest.id,
        ok: false,
        error: { code: ERROR_CODES.PERMISSION_DENIED, details: { command: deniedRequest.command } }
      });
      expect(JSON.parse(send.mock.calls[1][0])).toMatchObject({ type: MESSAGE_TYPES.BRIDGE_GOODBYE });
      expect(close).toHaveBeenCalledTimes(1);
      expect(deniedClient.status).toBe("stopped");
    }
    expect(route).toHaveBeenCalledTimes(1);
  });

  it("awaits a correlated daemon response when revoking its own pairing", async () => {
    const client = new BridgeClient({
      url: "ws://127.0.0.1:47833",
      pairingId: "pair-1",
      credential: "b".repeat(43),
      router: { route: vi.fn() },
      getSession: () => ({}),
      logger: vi.fn()
    });
    globalThis.WebSocket = /** @type {any} */ ({ OPEN: 1 });
    const send = vi.fn();
    client.socket = /** @type {any} */ ({ readyState: 1, send });
    client.helloAcknowledged = true;

    const pending = client.revokePairing();
    const request = JSON.parse(send.mock.calls[0][0]);
    expect(request).toMatchObject({ operation: "auth.revoke", params: { pairingId: "pair-1" } });
    await client.handleMessage({
      data: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.DAEMON_RESPONSE,
        id: request.id,
        operation: "auth.revoke",
        ok: true,
        result: { revoked: true, pairingId: "pair-1" }
      })
    });
    await expect(pending).resolves.toEqual({ revoked: true, pairingId: "pair-1" });
  });

  it.each([
    {
      source: "the daemon's own explanation",
      response: { ok: false, error: { code: ERROR_CODES.PERMISSION_DENIED, message: "Pairing not yours" } },
      expected: "Pairing not yours",
      code: ERROR_CODES.PERMISSION_DENIED
    },
    {
      source: "the catalog, when the refusal explains nothing",
      response: { ok: false },
      expected: "Pairing revocation failed",
      code: undefined
    }
  ])("reports a refused revocation from $source", async ({ response, expected, code }) => {
    const client = new BridgeClient({
      url: "ws://127.0.0.1:47833",
      pairingId: "pair-1",
      credential: "b".repeat(43),
      router: { route: vi.fn() },
      getSession: () => ({}),
      logger: vi.fn()
    });
    client.requestDaemon = vi.fn(async () => response);

    const error = await client.revokePairing().catch((reason) => reason);

    expect(error.message).toBe(expected);
    expect(error.code).toBe(code);
  });

  it.each([
    { code: 1006, reason: "" },
    { code: 1011, reason: "daemon exploded" }
  ])(
    "rejects an in-flight daemon request from the catalog when the socket closes ($code)",
    async ({ code, reason }) => {
      const client = new BridgeClient({
        url: "ws://127.0.0.1:47833",
        pairingId: "pair-1",
        credential: "b".repeat(43),
        router: { route: vi.fn() },
        getSession: () => ({}),
        logger: vi.fn()
      });
      globalThis.WebSocket = /** @type {any} */ ({ OPEN: 1 });
      client.socket = /** @type {any} */ ({ readyState: 1, send: vi.fn() });
      client.helloAcknowledged = true;

      const rejection = client.revokePairing().catch((error) => error);
      client.handleClose({ code, reason });

      expect((await rejection).message).toBe(`Daemon connection closed (${code}): ${reason || "no reason"}`);
    }
  );
});

describe("BridgeClient daemon-advertised limits", () => {
  beforeEach(() => {
    globalThis.ui = { notifications: { warn: vi.fn() } };
  });

  it("stores the daemon-advertised limits from a successful hello-ack", async () => {
    const client = createClient();
    markClientConnected(client);

    await client.handleMessage(
      createHelloAck({
        ok: true,
        limits: { uploadBytes: 200 * 1024 * 1024, wsMaxPayloadBytes: 300 * 1024 * 1024 }
      })
    );

    expect(client.getEffectiveLimits()).toEqual({
      uploadBytes: 200 * 1024 * 1024,
      wsMaxPayloadBytes: 300 * 1024 * 1024
    });

    expect(client.getLimitsInfo()).toEqual({
      uploadBytes: 200 * 1024 * 1024,
      wsMaxPayloadBytes: 300 * 1024 * 1024,
      uploadSource: "config"
    });
  });

  it("getLimitsInfo reports uploadSource:default when no ack limits are in force", async () => {
    const client = createClient();
    markClientConnected(client);

    await client.handleMessage(createHelloAck({ ok: true }));

    expect(client.getLimitsInfo()).toEqual({
      uploadBytes: DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
      wsMaxPayloadBytes: DEFAULT_WS_MAX_PAYLOAD_BYTES,
      uploadSource: "default"
    });
  });

  it("falls back to the derived default frame cap when the ack carries no limits", async () => {
    const client = createClient();
    markClientConnected(client);

    await client.handleMessage(createHelloAck({ ok: true }));

    expect(client.limits).toBeNull();
    expect(client.getEffectiveLimits()).toEqual({
      uploadBytes: DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
      wsMaxPayloadBytes: DEFAULT_WS_MAX_PAYLOAD_BYTES
    });
  });

  it("ignores malformed limits and falls back to defaults", async () => {
    const client = createClient();
    markClientConnected(client);

    await client.handleMessage(
      createHelloAck({ ok: true, limits: { uploadBytes: "lots", wsMaxPayloadBytes: -1 } })
    );

    expect(client.limits).toBeNull();
    expect(client.getEffectiveLimits().uploadBytes).toBe(DEFAULT_UPLOAD_SIZE_LIMIT_BYTES);
  });

  it("clears advertised limits on a transport close so a fresh ack re-establishes them", async () => {
    const client = createClient();
    markClientConnected(client);
    await client.handleMessage(
      createHelloAck({ ok: true, limits: { uploadBytes: 10, wsMaxPayloadBytes: 20 } })
    );
    expect(client.limits).not.toBeNull();

    client.handleClose({ code: 1006, reason: "drop" });

    expect(client.limits).toBeNull();
    expect(client.getEffectiveLimits()).toEqual({
      uploadBytes: DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
      wsMaxPayloadBytes: DEFAULT_WS_MAX_PAYLOAD_BYTES
    });
  });

  it("uses the daemon-advertised frame cap for the response-size guard once acked", async () => {
    globalThis.WebSocket = /** @type {any} */ ({ CONNECTING: 0, OPEN: 1 });
    const client = createClient();
    const socketSend = vi.fn();
    client.socket = /** @type {any} */ ({ readyState: 1, send: socketSend });

    await client.handleMessage(
      createHelloAck({ ok: true, limits: { uploadBytes: 32, wsMaxPayloadBytes: 64 } })
    );

    client.send({
      protocolVersion: PROTOCOL_VERSION,
      type: MESSAGE_TYPES.COMMAND_RESPONSE,
      id: "req-1",
      ok: true,
      result: { blob: "x".repeat(500) }
    });

    const sent = JSON.parse(socketSend.mock.calls[socketSend.mock.calls.length - 1][0]);
    expect(sent.ok).toBe(false);
    expect(sent.error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(sent.error.details.limitBytes).toBe(64);
  });
});

describe("BridgeClient response-size guard", () => {
  function connectedClientWithBound(maxResponseBytes) {
    globalThis.WebSocket = /** @type {any} */ ({ CONNECTING: 0, OPEN: 1 });
    const client = new BridgeClient({
      url: "ws://127.0.0.1:47833",
      credential: "credential",
      router: { route: vi.fn(async () => ({ ok: true })) },
      getSession: () => ({ moduleId: "fvtt-world-cli" }),
      logger: vi.fn(),
      maxResponseBytes
    });
    const socketSend = vi.fn();
    client.socket = /** @type {any} */ ({ readyState: 1, send: socketSend });
    return { client, socketSend };
  }

  it("returns a PAYLOAD_TOO_LARGE response instead of sending an over-cap command response", () => {
    const { client, socketSend } = connectedClientWithBound(64);
    const bigResult = "x".repeat(500);
    client.send({
      protocolVersion: PROTOCOL_VERSION,
      type: MESSAGE_TYPES.COMMAND_RESPONSE,
      id: "req-1",
      ok: true,
      result: { blob: bigResult }
    });

    expect(socketSend).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(socketSend.mock.calls[0][0]);
    expect(sent.type).toBe(MESSAGE_TYPES.COMMAND_RESPONSE);
    expect(sent.id).toBe("req-1");
    expect(sent.ok).toBe(false);
    expect(sent.error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(sent.error.details.limitBytes).toBe(64);
    expect(sent.error.details.actualBytes).toBeGreaterThan(64);

    expect(sent.error.message).toContain("transport frame cap");
    expect(sent.error.message).toContain("uploadLimitBytes");
  });

  it("sends a response unchanged when it is within the cap", () => {
    const { client, socketSend } = connectedClientWithBound(64 * 1024);
    const payload = {
      protocolVersion: PROTOCOL_VERSION,
      type: MESSAGE_TYPES.COMMAND_RESPONSE,
      id: "req-2",
      ok: true,
      result: { item: { id: "item-1" } }
    };
    client.send(payload);

    expect(socketSend).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(socketSend.mock.calls[0][0]);
    expect(sent).toEqual(payload);
  });
});

describe("BridgeClient status change signal", () => {
  /** @type {ReturnType<typeof vi.fn>} */
  let onStatusChange;

  beforeEach(() => {
    onStatusChange = vi.fn();
    globalThis.ui = { notifications: { warn: vi.fn() } };
  });

  function observedClient(logger = vi.fn()) {
    return new BridgeClient({
      url: "ws://127.0.0.1:47833",
      pairingId: "pair-1",
      credential: "secret",
      router: { route: vi.fn(async () => ({ ok: true })) },
      getSession: () => ({ moduleId: "fvtt-world-cli" }),
      logger,
      onStatusChange
    });
  }

  function emittedStatuses() {
    return onStatusChange.mock.calls.map(([snapshot]) => snapshot.status);
  }

  it("does not emit while constructing the initial idle state", () => {
    observedClient();

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("emits connecting once when the socket is opened", () => {
    const client = observedClient();
    globalThis.WebSocket = /** @type {any} */ (
      class {
        addEventListener() {}
      }
    );

    client.connect();
    client.connect();

    expect(emittedStatuses()).toEqual(["connecting"]);
  });

  it("emits error when no WebSocket implementation is available", () => {
    const client = observedClient();
    /** @type {any} */ (globalThis).WebSocket = undefined;

    client.connect();

    expect(emittedStatuses()).toEqual(["error"]);
  });

  it("emits a connected snapshot carrying the connection timestamp", () => {
    const client = observedClient();

    markClientConnected(client);

    expect(onStatusChange).toHaveBeenCalledTimes(1);
    const snapshot = onStatusChange.mock.calls[0][0];
    expect(snapshot).toMatchObject({
      status: "connected",
      helloAcknowledged: false,
      url: "ws://127.0.0.1:47833"
    });
    expect(snapshot.lastConnectedAt).toBe(client.lastConnectedAt);
  });

  it("emits the acknowledged handshake even though the raw status is unchanged", async () => {
    const client = observedClient();
    markClientConnected(client);
    onStatusChange.mockClear();

    await client.handleMessage(createHelloAck({ ok: true }));

    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange.mock.calls[0][0]).toMatchObject({
      status: "connected",
      helloAcknowledged: true,
      hasEstablishedSession: true,
      protocolVersionMismatch: null
    });
  });

  it("never reports a connected client whose handshake was already dropped", async () => {
    vi.useFakeTimers();
    const client = observedClient();
    markClientConnected(client);
    await client.handleMessage(createHelloAck({ ok: true }));
    onStatusChange.mockClear();

    client.handleClose({ code: 1006, reason: "daemon restarted" });

    expect(
      onStatusChange.mock.calls.map(([snapshot]) => [snapshot.status, snapshot.helloAcknowledged])
    ).toEqual([
      ["disconnected", false],
      ["reconnecting", false]
    ]);
    client.clearReconnectTimer();
    vi.useRealTimers();
  });

  it("reports a dropped handshake alongside the terminal stop of a taken-over bridge", async () => {
    const client = observedClient();
    markClientConnected(client);
    await client.handleMessage(createHelloAck({ ok: true }));
    onStatusChange.mockClear();

    client.handleClose({ code: BRIDGE_RELEASE_CLOSE_CODE, reason: "Bridge released" });

    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange.mock.calls[0][0]).toMatchObject({
      status: "stopped",
      helloAcknowledged: false,
      terminalStopReason: "RELEASED"
    });
  });

  it("emits reconnecting with the incremented attempt count", () => {
    vi.useFakeTimers();
    const client = observedClient();
    markClientConnected(client);
    onStatusChange.mockClear();

    client.scheduleReconnect();

    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange.mock.calls[0][0]).toMatchObject({
      status: "reconnecting",
      reconnectAttempts: 1
    });
    client.clearReconnectTimer();
    vi.useRealTimers();
  });

  it("emits a stopped snapshot carrying the terminal stop reason", async () => {
    const client = observedClient();
    markClientConnected(client);
    onStatusChange.mockClear();

    await client.handleMessage(
      createHelloAck({
        ok: false,
        error: { code: ERROR_CODES.UNAUTHORIZED, message: "Bridge hello credential mismatch" }
      })
    );

    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange.mock.calls[0][0]).toMatchObject({
      status: "stopped",
      terminalStopReason: ERROR_CODES.UNAUTHORIZED
    });
  });

  it("does not re-emit when a terminal stop is repeated", async () => {
    const client = observedClient();
    markClientConnected(client);
    await client.handleMessage(
      createHelloAck({
        ok: false,
        error: { code: ERROR_CODES.UNAUTHORIZED, message: "Bridge hello credential mismatch" }
      })
    );
    onStatusChange.mockClear();

    client.start();
    client.handleClose({ code: 1008, reason: "Unauthorized bridge" });

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("emits stopped once with a dropped handshake when an acknowledged client is stopped", async () => {
    const client = observedClient();
    markClientConnected(client);
    await client.handleMessage(createHelloAck({ ok: true }));
    /** @type {any} */ (client.socket).close = vi.fn();
    onStatusChange.mockClear();

    client.stop();
    client.stop();

    expect(emittedStatuses()).toEqual(["stopped"]);
    expect(onStatusChange.mock.calls[0][0]).toMatchObject({
      status: "stopped",
      helloAcknowledged: false
    });
    expect(client.getStatus().helloAcknowledged).toBe(false);
  });

  it("still sends the goodbye frame before dropping the handshake on stop", async () => {
    const client = observedClient();
    markClientConnected(client);
    await client.handleMessage(createHelloAck({ ok: true }));
    const socket = /** @type {any} */ (client.socket);
    socket.close = vi.fn();
    socket.send.mockClear();

    client.stop();

    expect(JSON.parse(socket.send.mock.calls[0][0]).type).toBe(MESSAGE_TYPES.BRIDGE_GOODBYE);
  });

  it("never publishes an acknowledged handshake after the socket closes and the client stops", async () => {
    const client = observedClient();
    markClientConnected(client);
    await client.handleMessage(createHelloAck({ ok: true }));
    /** @type {any} */ (client.socket).close = vi.fn();

    client.stop();
    client.handleClose({ code: 1000, reason: "goodbye" });

    expect(
      onStatusChange.mock.calls.every(
        ([snapshot]) => snapshot.status !== "stopped" || !snapshot.helloAcknowledged
      )
    ).toBe(true);
  });

  it("keeps the connection state machine intact when a subscriber throws", () => {
    const logger = vi.fn();
    onStatusChange.mockImplementation(() => {
      throw new Error("subscriber exploded");
    });
    const client = observedClient(logger);

    expect(() => markClientConnected(client)).not.toThrow();
    expect(client.getStatus().status).toBe("connected");
    expect(logger).toHaveBeenCalledWith("warn", "Bridge status subscriber failed", {
      message: "subscriber exploded"
    });
  });
});

describe("BridgeClient request frame weight", () => {
  function routingClient() {
    globalThis.game = /** @type {any} */ ({
      i18n: createEnglishI18n(),
      user: { id: "gm", isGM: true }
    });
    /** @type {{ measureRequestBytes: () => number }[]} */
    const frames = [];
    const route = vi.fn(async (/** @type {any} */ message, /** @type {any} */ frame) => {
      frames.push(frame);
      return {
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_RESPONSE,
        id: message.id,
        ok: true,
        result: {}
      };
    });
    const client = new BridgeClient({
      url: "ws://127.0.0.1:47833",
      pairingId: "pair-1",
      credential: "b".repeat(43),
      router: { route },
      getSession: () => ({ moduleId: "fvtt-world-cli" }),
      logger: vi.fn()
    });
    globalThis.WebSocket = /** @type {any} */ ({ OPEN: 1 });
    client.socket = /** @type {any} */ ({ readyState: 1, send: vi.fn(), close: vi.fn() });
    client.helloAcknowledged = true;
    return { client, route, frames };
  }

  /** @param {Record<string, unknown>} params */
  function requestFrame(params) {
    return JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      type: MESSAGE_TYPES.COMMAND_REQUEST,
      id: "weighed-1",
      command: "file.upload",
      params
    });
  }

  it("offers the size of the frame it received, not the length of its text", async () => {
    const { client, route, frames } = routingClient();
    const frame = requestFrame({ path: "worlds/world-1/notes.txt", contentBase64: "A".repeat(4096) });

    await client.handleMessage({ data: frame });

    expect(route).toHaveBeenCalledTimes(1);
    expect(frames[0].measureRequestBytes()).toBe(new TextEncoder().encode(frame).length);
    expect(frames[0].measureRequestBytes()).toBeGreaterThan(4096);
  });

  it("counts a multi-byte payload in bytes rather than characters", async () => {
    const { client, frames } = routingClient();
    const frame = requestFrame({ path: "worlds/world-1/héroïnes-🐉.txt", contentBase64: "é🐉".repeat(64) });

    await client.handleMessage({ data: frame });

    const measured = frames[0].measureRequestBytes();
    expect(measured).toBe(new TextEncoder().encode(frame).length);
    expect(measured).toBeGreaterThan(frame.length);
  });

  it("takes the size of a binary frame from the frame itself", async () => {
    const { client, frames } = routingClient();
    const encoded = new TextEncoder().encode(
      requestFrame({ path: "worlds/world-1/notes.txt", contentBase64: "AAAA" })
    );

    await client.handleMessage({ data: encoded.buffer });

    expect(frames[0].measureRequestBytes()).toBe(encoded.byteLength);
  });

  it("leaves the count to the router, which asks for it only where a weight is needed", async () => {
    const { client, route, frames } = routingClient();

    await client.handleMessage({
      data: requestFrame({ path: "worlds/world-1/notes.txt", contentBase64: "AAAA" })
    });

    expect(route).toHaveBeenCalledTimes(1);
    expect(Object.keys(frames[0])).toEqual(["measureRequestBytes"]);
    expect(typeof frames[0].measureRequestBytes).toBe("function");
  });
});

describe("BridgeClient approvals held for the GM", () => {
  function clientWithApprovals() {
    const clear = vi.fn();
    const client = new BridgeClient({
      url: "ws://127.0.0.1:47833",
      credential: "invalid-credential",
      router: { route: vi.fn(async () => ({ ok: true })), approvalStore: { clear } },
      getSession: () => ({ moduleId: "fvtt-world-cli" }),
      logger: vi.fn()
    });

    globalThis.WebSocket = /** @type {any} */ ({ CONNECTING: 0, OPEN: 1 });
    client.socket = /** @type {any} */ ({ readyState: 1, send: vi.fn(), close: vi.fn() });
    client.handleOpen();

    return { client, clear };
  }

  it("survive a dropped socket the client will reconnect", () => {
    const { client, clear } = clientWithApprovals();
    vi.spyOn(client, "scheduleReconnect").mockImplementation(() => {});

    client.handleClose({ code: 1006, reason: "socket lost" });

    expect(clear).not.toHaveBeenCalled();
  });

  it("are released when the GM disconnects the bridge", () => {
    const { client, clear } = clientWithApprovals();

    client.stop();

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("are released when another client takes the bridge slot", () => {
    const { client, clear } = clientWithApprovals();

    client.handleClose({ code: BRIDGE_TAKEOVER_CLOSE_CODE, reason: "Another client took the bridge" });

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("are released when the daemon releases the bridge", () => {
    const { client, clear } = clientWithApprovals();

    client.handleClose({ code: BRIDGE_RELEASE_CLOSE_CODE, reason: "Bridge released" });

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("are released when the session stops for good", () => {
    const { client, clear } = clientWithApprovals();

    client.stopForRejectedCredential(new Error("Bridge hello credential mismatch"));

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("are released when the client is no longer a GM", async () => {
    const { client, clear } = clientWithApprovals();

    await client.handleMessage({
      data: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_REQUEST,
        id: "demoted-1",
        command: "actor.get",
        params: { actorId: "actor-1" }
      })
    });

    expect(clear).toHaveBeenCalledTimes(1);
  });
});
