import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLIENT_LABEL_FIELD_SELECTOR,
  createAuthorizationApplication,
  ensureClientId,
  getClientId,
  getCurrentCredential,
  requestPairing,
  sanitizeClientLabel,
  setCurrentCredential
} from "../scripts/authorization.js";
import {
  CONNECTION_ACTION_LABELS,
  CONNECTION_ACTIONS,
  DISPLAY_STATE_NAMES
} from "../scripts/lib/bridge-status.js";
import { publishStatus, subscribeStatus } from "../scripts/lib/status-signal.js";
import {
  CLIENT_LABEL_MAX_LENGTH,
  CLIENT_LABEL_SCHEMA,
  MESSAGE_TYPES,
  MODULE_ID,
  MODULE_TITLE,
  PROTOCOL_VERSION,
  validatePairingRequest,
  validateSchema
} from "../scripts/generated/protocol.js";
import { MODULE_SETTING_KEYS } from "../scripts/lib/validators.js";
import { createEnglishI18n, formatEnglish, localizeEnglish } from "./helpers/i18n.js";

const STORED_CLIENT_ID = "a1a1a1a1b2b2c3c3d4d4e5e5f6f6a7a7";

async function nextPairingSocket() {
  for (let attempt = 0; attempt < 50 && PairingSocket.instances.length === 0; attempt += 1)
    await Promise.resolve();
  const socket = PairingSocket.instances[0];
  socket.readyState = PairingSocket.OPEN;
  await socket.emit("open");
  return socket;
}

describe("Authorization application", () => {
  let credentials;
  let clientId;

  beforeEach(() => {
    credentials = {
      "world-1:gm-1": { pairingId: "pair-1", credential: "secret", label: "Zen Browser" }
    };
    clientId = STORED_CLIENT_ID;
    class ApplicationV2 {
      id = "fvtt-world-cli-authorization";

      render = vi.fn();

      async _onRender() {}

      _onClose() {}
    }
    globalThis.foundry = {
      applications: {
        api: {
          ApplicationV2,
          HandlebarsApplicationMixin: (Base) => class extends Base {}
        }
      }
    };
    globalThis.game = {
      world: { id: "world-1", title: "World" },
      user: { id: "gm-1", name: "GM", isGM: true },
      i18n: createEnglishI18n(),
      modules: { get: vi.fn(() => ({ version: "1.0.0" })) },
      settings: {
        get: vi.fn((_moduleId, key) => {
          if (key === MODULE_SETTING_KEYS.CREDENTIALS) return credentials;
          if (key === MODULE_SETTING_KEYS.CLIENT_ID) return clientId;
          return "ws://127.0.0.1:47833";
        }),
        set: vi.fn(async (moduleId, key, value) => {
          expect(moduleId).toBe(MODULE_ID);
          if (key === MODULE_SETTING_KEYS.CREDENTIALS) credentials = value;
          if (key === MODULE_SETTING_KEYS.CLIENT_ID) clientId = value;
        })
      }
    };
    globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
  });

  function application(connect = vi.fn()) {
    const Application = createAuthorizationApplication({ connect });
    const app = new Application();
    const click = (action) =>
      Application.DEFAULT_OPTIONS.actions[action].call(
        app,
        { preventDefault: vi.fn() },
        { dataset: { action } }
      );
    return { app, Application, click };
  }

  async function unpair() {
    const { click } = application();
    await click("unpair");
  }

  function labelField(value, readOnly) {
    return {
      querySelector: vi.fn((selector) =>
        selector === CLIENT_LABEL_FIELD_SELECTOR ? { value, readOnly } : null
      )
    };
  }

  it("uses the ApplicationV2 Handlebars contract and prepares current status", async () => {
    globalThis.foundryCliBridge = { getStatus: () => ({ status: "connected" }) };
    const { Application, app } = application();

    expect(Application.DEFAULT_OPTIONS).toMatchObject({
      id: "fvtt-world-cli-authorization",
      window: { title: "FVTTWORLDCLI.Authorization.Title", contentClasses: ["standard-form"] },
      position: { width: 520 }
    });
    expect(Object.keys(Application.DEFAULT_OPTIONS.actions)).toEqual([
      "pair",
      "connect",
      "disconnect",
      "unpair",
      "forget"
    ]);
    expect(Application.PARTS.authorization.template).toBe(
      "modules/fvtt-world-cli/templates/authorization.hbs"
    );
    await expect(app._prepareContext()).resolves.toEqual({
      isGM: true,
      paired: true,
      clientLabel: "Zen Browser",
      clientLabelEditable: false,
      clientLabelMaxLength: CLIENT_LABEL_MAX_LENGTH,
      clientLabelTooltip: "FVTTWORLDCLI.Authorization.ClientLabelFixed",
      displayState: "pending",
      connectionLabel: "Connecting (Awaiting handshake)",
      connectionAction: "disconnect",
      connectionActionGlyph: "fa-plug-circle-minus",
      connectionActionLabel: "FVTTWORLDCLI.Authorization.Disconnect"
    });
  });

  it("refreshes the reported status while open and stops listening once closed", async () => {
    globalThis.foundryCliBridge = { getStatus: () => ({ status: "connecting" }) };
    const { app } = application();

    await app._onRender({}, {});
    publishStatus({ status: "connected" });

    expect(app.render).toHaveBeenCalledTimes(1);
    expect(app.render).toHaveBeenCalledWith({ force: false });

    app._onClose({});
    publishStatus({ status: "stopped" });

    expect(app.render).toHaveBeenCalledTimes(1);
  });

  it("announces the cleared credential only after the local store no longer holds it", async () => {
    const revokePairing = vi.fn(async () => ({ revoked: true }));
    globalThis.foundryCliBridge = { revokePairing, stop: vi.fn(), getStatus: () => ({ status: "stopped" }) };
    const observed = [];
    const unsubscribe = subscribeStatus(() => observed.push(getCurrentCredential()));

    await unpair();
    unsubscribe();

    expect(observed).toEqual([null]);
  });

  it("announces the stored credential after pairing completes", async () => {
    const observed = [];
    const unsubscribe = subscribeStatus(() => observed.push(getCurrentCredential()));

    await setCurrentCredential({ pairingId: "pair-9", credential: "fresh" });
    unsubscribe();

    expect(observed).toEqual([{ pairingId: "pair-9", credential: "fresh" }]);
  });

  it("stops refreshing an instance that a same-id window has superseded", async () => {
    const { app } = application();
    const { app: replacement } = application();
    await app._onRender({}, {});
    await replacement._onRender({}, {});
    globalThis.foundry.applications.instances = new Map([[app.id, replacement]]);

    publishStatus({ status: "connected" });
    publishStatus({ status: "stopped" });

    expect(app.render).not.toHaveBeenCalled();
    expect(replacement.render).toHaveBeenCalledTimes(2);
    replacement._onClose({});
  });

  it("stops refreshing an instance whose element left the document", async () => {
    const { app } = application();
    await app._onRender({}, {});
    app.element = { isConnected: false };

    publishStatus({ status: "connected" });
    publishStatus({ status: "stopped" });

    expect(app.render).not.toHaveBeenCalled();
  });

  it("subscribes to the status signal only once across repeated renders", async () => {
    const { app } = application();

    await app._onRender({}, {});
    await app._onRender({}, {});
    publishStatus({ status: "connected" });

    expect(app.render).toHaveBeenCalledTimes(1);
    app._onClose({});
  });

  it("removes the local credential only after daemon revocation succeeds", async () => {
    const revokePairing = vi.fn(async () => ({ revoked: true }));
    const stop = vi.fn();
    globalThis.foundryCliBridge = { revokePairing, stop, getStatus: () => ({ status: "connected" }) };
    application();

    await unpair();

    expect(revokePairing).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(getCurrentCredential()).toBeNull();
    expect(globalThis.ui.notifications.info).toHaveBeenCalledWith(
      "Pairing revoked and local credential removed."
    );
  });

  it("retains the local credential when no authenticated daemon connection can revoke it", async () => {
    const stop = vi.fn();
    globalThis.foundryCliBridge = { stop, getStatus: () => ({ status: "stopped" }) };
    application();

    await unpair();

    expect(stop).not.toHaveBeenCalled();
    expect(getCurrentCredential()).toEqual({
      pairingId: "pair-1",
      credential: "secret",
      label: "Zen Browser"
    });
    expect(globalThis.ui.notifications.error).toHaveBeenCalledWith(
      "Unpair failed; the local credential was retained so revocation can be retried. Authenticated daemon connection is not available Use Forget local only if you accept leaving the daemon profile active.",
      { permanent: true }
    );
  });

  it("retains the local credential when daemon revocation cannot be confirmed", async () => {
    const revokePairing = vi.fn(async () => {
      throw new Error("daemon unavailable");
    });
    const stop = vi.fn();
    globalThis.foundryCliBridge = { revokePairing, stop, getStatus: () => ({ status: "disconnected" }) };
    application();

    await unpair();

    expect(stop).not.toHaveBeenCalled();
    expect(globalThis.game.settings.set).not.toHaveBeenCalled();
    expect(getCurrentCredential()).toEqual({
      pairingId: "pair-1",
      credential: "secret",
      label: "Zen Browser"
    });
    expect(globalThis.ui.notifications.error).toHaveBeenCalledWith(
      expect.stringContaining("local credential was retained"),
      { permanent: true }
    );
  });

  it("reports Connect failures in the Foundry UI instead of rejecting the click handler", async () => {
    const connect = vi.fn(async () => {
      throw new Error("daemon unavailable");
    });
    const { app, click } = application(connect);

    await expect(click("connect")).resolves.toBeUndefined();

    expect(globalThis.ui.notifications.error).toHaveBeenCalledWith("Connect failed: daemon unavailable", {
      permanent: true
    });
    expect(app.render).toHaveBeenCalledWith({ force: false });
  });

  it("restarts the bridge with the stored credential from Connect", async () => {
    const connect = vi.fn(async () => {});
    const { click } = application(connect);

    await click("connect");

    expect(connect).toHaveBeenCalledWith({
      pairingId: "pair-1",
      credential: "secret",
      label: "Zen Browser"
    });
  });

  it("stops the live bridge from Disconnect and keeps the credential", async () => {
    const stop = vi.fn();
    globalThis.foundryCliBridge = { stop, getStatus: () => ({ status: "connected" }) };
    const { click } = application();

    await click("disconnect");

    expect(stop).toHaveBeenCalledTimes(1);
    expect(getCurrentCredential()).toEqual({
      pairingId: "pair-1",
      credential: "secret",
      label: "Zen Browser"
    });
  });

  it.each([
    [
      "a connected bridge",
      { status: "connected", helloAcknowledged: true },
      "connected",
      "disconnect",
      "fa-plug-circle-minus",
      "FVTTWORLDCLI.Authorization.Disconnect"
    ],
    [
      "a connecting bridge",
      { status: "connecting", helloAcknowledged: false },
      "pending",
      "disconnect",
      "fa-plug-circle-minus",
      "FVTTWORLDCLI.Authorization.Disconnect"
    ],
    [
      "a reconnecting bridge",
      { status: "reconnecting", helloAcknowledged: false },
      "pending",
      "disconnect",
      "fa-plug-circle-minus",
      "FVTTWORLDCLI.Authorization.Disconnect"
    ],
    [
      "a stopped bridge",
      { status: "stopped", helloAcknowledged: false },
      "offline",
      "connect",
      "fa-plug-circle-bolt",
      "FVTTWORLDCLI.Authorization.Connect"
    ],
    [
      "a dropped bridge",
      { status: "disconnected", helloAcknowledged: false },
      "offline",
      "connect",
      "fa-plug-circle-bolt",
      "FVTTWORLDCLI.Authorization.Connect"
    ]
  ])(
    "offers a single %s action button",
    async (_label, bridgeStatus, displayState, action, glyph, actionLabel) => {
      globalThis.foundryCliBridge = { getStatus: () => bridgeStatus };
      const { app } = application();

      await expect(app._prepareContext()).resolves.toMatchObject({
        paired: true,
        displayState,
        connectionAction: action,
        connectionActionGlyph: glyph,
        connectionActionLabel: actionLabel
      });
    }
  );

  it("offers Pair alone and no connection action while unpaired", async () => {
    credentials = {};
    delete globalThis.foundryCliBridge;
    const { app } = application();

    await expect(app._prepareContext()).resolves.toMatchObject({
      paired: false,
      displayState: "unpaired",
      connectionLabel: localizeEnglish("FVTTWORLDCLI.BridgeStatus.State.unpaired"),
      connectionAction: null,
      connectionActionGlyph: "",
      connectionActionLabel: ""
    });
  });

  it.each([
    ["Offline", { status: "stopped", helloAcknowledged: false }, "Offline (Stopped)"],
    ["Offline", { status: "error", helloAcknowledged: false }, "Offline (Error)"],
    ["Offline", { status: "disconnected", helloAcknowledged: false }, "Offline (Disconnected)"],
    ["Offline", { status: "idle", helloAcknowledged: false }, "Offline (Idle)"],
    ["Connecting", { status: "reconnecting", helloAcknowledged: false }, "Connecting (Reconnecting)"],
    ["Connecting", { status: "connecting", helloAcknowledged: false }, "Connecting"],
    ["Connected", { status: "connected", helloAcknowledged: true }, "Connected"]
  ])(
    "names the raw status beside %s only when it adds information",
    async (_label, bridgeStatus, expected) => {
      globalThis.foundryCliBridge = { getStatus: () => bridgeStatus };
      const { app } = application();

      await expect(app._prepareContext()).resolves.toMatchObject({
        connectionLabel: expected
      });
    }
  );

  it("reports Pair failures in the Foundry UI instead of rejecting the click handler", async () => {
    PairingSocket.instances = [];
    globalThis.WebSocket = /** @type {any} */ (PairingSocket);
    const { app, click } = application();

    const pendingClick = click("pair");
    const socket = await nextPairingSocket();
    await socket.emit("error");
    await expect(pendingClick).resolves.toBeUndefined();

    expect(globalThis.ui.notifications.error).toHaveBeenCalledWith("Pairing failed: Daemon unavailable", {
      permanent: true
    });
    expect(app.render).toHaveBeenCalledWith({ force: false });
  });

  it("offers an editable label field prefilled with the localized default while unpaired", async () => {
    credentials = {};
    delete globalThis.foundryCliBridge;
    const { app } = application();

    await expect(app._prepareContext()).resolves.toMatchObject({
      clientLabel: "GM's Browser",
      clientLabelEditable: true,
      clientLabelTooltip: "FVTTWORLDCLI.Authorization.ClientLabelEditable"
    });
  });

  it("shows the stored label read-only once the browser is paired", async () => {
    credentials = {
      "world-1:gm-1": { pairingId: "pair-1", credential: "secret", label: "Zen Browser" }
    };
    const { app } = application();

    await expect(app._prepareContext()).resolves.toMatchObject({
      clientLabel: "Zen Browser",
      clientLabelEditable: false,
      clientLabelTooltip: "FVTTWORLDCLI.Authorization.ClientLabelFixed"
    });
  });

  it("leaves the label field blank for a paired credential that carries no label", async () => {
    credentials = { "world-1:gm-1": { pairingId: "pair-1", credential: "secret" } };
    const { app } = application();

    await expect(app._prepareContext()).resolves.toMatchObject({
      clientLabel: "",
      clientLabelEditable: false
    });
  });

  it("keeps the label read-only for a player while the browser is unpaired", async () => {
    credentials = {};
    delete globalThis.foundryCliBridge;
    globalThis.game.user = { id: "player-1", name: "Player", isGM: false };
    const { app } = application();

    await expect(app._prepareContext()).resolves.toMatchObject({
      paired: false,
      clientLabel: "Player's Browser",
      clientLabelEditable: false,
      clientLabelTooltip: "FVTTWORLDCLI.Authorization.ClientLabelGMOnly"
    });
  });

  it("resolves every localization key the window and its template hand to Foundry", async () => {
    const english = JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url), "utf8"));
    const template = readFileSync(new URL("../templates/authorization.hbs", import.meta.url), "utf8");
    const resolve = (key) =>
      key.split(".").reduce((branch, part) => (branch == null ? branch : branch[part]), english);
    const contexts = [];

    credentials = {};
    delete globalThis.foundryCliBridge;
    contexts.push(await application().app._prepareContext());
    globalThis.game.user = { id: "player-1", name: "Player", isGM: false };
    contexts.push(await application().app._prepareContext());
    globalThis.game.user = { id: "gm-1", name: "GM", isGM: true };
    credentials = {
      "world-1:gm-1": { pairingId: "pair-1", credential: "secret", label: "Zen Browser" }
    };
    for (const status of ["connected", "stopped"]) {
      globalThis.foundryCliBridge = { getStatus: () => ({ status }) };
      contexts.push(await application().app._prepareContext());
    }
    const keys = new Set([
      ...[...template.matchAll(/localize\s+"([^"]+)"/g)].map(([, key]) => key),
      ...contexts
        .flatMap(({ clientLabelTooltip, connectionActionLabel }) => [
          clientLabelTooltip,
          connectionActionLabel
        ])
        .filter(Boolean)
    ]);

    expect(new Set(contexts.map((context) => context.clientLabelTooltip)).size).toBe(3);
    expect(new Set(contexts.map((context) => context.connectionActionLabel))).toContain(
      "FVTTWORLDCLI.Authorization.Connect"
    );
    expect(keys).toContain("FVTTWORLDCLI.Authorization.ClientLabel");
    expect(keys).toContain("FVTTWORLDCLI.BridgeStatus.NotConfigured");
    expect([...keys].filter((key) => typeof resolve(key) !== "string" || !resolve(key).trim())).toEqual([]);
  });

  it("keeps a typed label through a status refresh that re-renders the window", async () => {
    credentials = {};
    delete globalThis.foundryCliBridge;
    const { app } = application();
    app.element = labelField("Chrome profile", false);
    const rendered = [];
    app.render = vi.fn(async () => {
      rendered.push(await app._prepareContext());
    });

    await app._onRender({}, {});
    publishStatus({ status: "connected" });
    await Promise.all(app.render.mock.results.map((result) => result.value));
    app._onClose({});

    expect(rendered).toEqual([
      expect.objectContaining({ clientLabel: "Chrome profile", clientLabelEditable: true })
    ]);
  });

  it("leaves a cleared label field empty instead of restoring the prefill under the caret", async () => {
    credentials = {};
    delete globalThis.foundryCliBridge;
    const { app } = application();
    app.element = labelField("", false);

    await expect(app._prepareContext()).resolves.toMatchObject({
      clientLabel: "",
      clientLabelEditable: true
    });
  });

  it("returns the label field to the localized prefill after unpairing", async () => {
    credentials = {
      "world-1:gm-1": { pairingId: "pair-1", credential: "secret", label: "Zen Browser" }
    };
    globalThis.foundryCliBridge = {
      revokePairing: vi.fn(async () => ({ revoked: true })),
      stop: vi.fn(),
      getStatus: () => ({ status: "connected" })
    };
    const { app, click } = application();
    app.element = labelField("Zen Browser", true);

    await click("unpair");

    expect(getCurrentCredential()).toBeNull();
    await expect(app._prepareContext()).resolves.toMatchObject({
      clientLabel: "GM's Browser",
      clientLabelEditable: true,
      clientLabelTooltip: "FVTTWORLDCLI.Authorization.ClientLabelEditable"
    });
  });

  it("pairs with the sanitized label left in the field, not the raw input", async () => {
    credentials = {};
    PairingSocket.instances = [];
    globalThis.WebSocket = /** @type {any} */ (PairingSocket);
    const { app, click } = application();
    app.element = labelField(
      `  Zen${String.fromCodePoint(0x200b)} Browser${String.fromCodePoint(0x0007)}  `,
      false
    );

    const pendingClick = click("pair");
    const socket = await nextPairingSocket();
    const request = JSON.parse(socket.sent[0]);

    expect(request.identity.client.label).toBe("Zen Browser");
    expect(validatePairingRequest(request)).toEqual({ ok: true, errors: [] });

    socket.readyState = 3;
    await socket.emit("close", { code: 1000, reason: "done" });
    await expect(pendingClick).resolves.toBeUndefined();
  });

  it("pairs under the localized default label when the field was left empty", async () => {
    credentials = {};
    PairingSocket.instances = [];
    globalThis.WebSocket = /** @type {any} */ (PairingSocket);
    const { app, click } = application();
    app.element = labelField("", false);

    const pendingClick = click("pair");
    const socket = await nextPairingSocket();
    const request = JSON.parse(socket.sent[0]);

    expect(request.identity.client.label).toBe("GM's Browser");
    expect(validatePairingRequest(request)).toEqual({ ok: true, errors: [] });

    socket.readyState = 3;
    await socket.emit("close", { code: 1000, reason: "done" });
    await expect(pendingClick).resolves.toBeUndefined();
  });

  it("forgets only the local credential and warns about the retained daemon profile", async () => {
    const stop = vi.fn();
    globalThis.foundryCliBridge = { stop };
    const { click } = application();

    await click("forget");

    expect(stop).toHaveBeenCalledTimes(1);
    expect(getCurrentCredential()).toBeNull();
    expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith(
      expect.stringContaining("does not revoke the daemon profile"),
      { permanent: true }
    );
  });

  it("keeps the browser client id after unpairing and after forgetting the credential", async () => {
    globalThis.foundryCliBridge = {
      revokePairing: vi.fn(async () => ({ revoked: true })),
      stop: vi.fn(),
      getStatus: () => ({ status: "connected" })
    };
    const { click } = application();

    await click("unpair");
    expect(getCurrentCredential()).toBeNull();
    expect(getClientId()).toBe(STORED_CLIENT_ID);

    await setCurrentCredential({ pairingId: "pair-3", credential: "secret" });
    await click("forget");

    expect(getCurrentCredential()).toBeNull();
    expect(getClientId()).toBe(STORED_CLIENT_ID);
    expect(
      globalThis.game.settings.set.mock.calls.filter(([, key]) => key === MODULE_SETTING_KEYS.CLIENT_ID)
    ).toEqual([]);
  });

  it("ignores actions after GM authority is lost", async () => {
    const connect = vi.fn();
    const { app, click } = application(connect);
    globalThis.game.user.isGM = false;

    await click("connect");

    expect(connect).not.toHaveBeenCalled();
    expect(app.render).not.toHaveBeenCalled();
  });
});

class PairingSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor() {
    this.readyState = PairingSocket.CONNECTING;
    this.listeners = new Map();
    this.sent = [];
    this.close = vi.fn(() => {
      this.readyState = 3;
    });
    PairingSocket.instances.push(this);
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== handler)
    );
  }

  send(value) {
    this.sent.push(value);
  }

  async emit(type, event = {}) {
    await Promise.all((this.listeners.get(type) ?? []).map((handler) => handler(event)));
  }
}

PairingSocket.instances = [];

describe("Pairing request lifecycle", () => {
  const DEFAULT_LABEL = "GM's Browser";
  let storedClientId;

  beforeEach(() => {
    let pairingCredentials = {};
    storedClientId = "";
    PairingSocket.instances = [];
    globalThis.WebSocket = /** @type {any} */ (PairingSocket);
    globalThis.game = {
      world: { id: "world-1", title: "World" },
      user: { id: "gm-1", name: "GM", isGM: true },
      i18n: createEnglishI18n(),
      modules: { get: vi.fn(() => ({ version: "1.0.0" })) },
      settings: {
        get: vi.fn((_moduleId, key) => {
          if (key === MODULE_SETTING_KEYS.CREDENTIALS) return pairingCredentials;
          if (key === MODULE_SETTING_KEYS.CLIENT_ID) return storedClientId;
          return "ws://127.0.0.1:47833";
        }),
        set: vi.fn(async (_moduleId, key, value) => {
          if (key === MODULE_SETTING_KEYS.CREDENTIALS) pairingCredentials = value;
          if (key === MODULE_SETTING_KEYS.CLIENT_ID) storedClientId = value;
        })
      }
    };
    globalThis.ui = { notifications: { info: vi.fn() } };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function openPairing() {
    const result = requestPairing();
    const socket = await nextPairingSocket();
    const request = JSON.parse(socket.sent[0]);
    expect(request).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      type: MESSAGE_TYPES.PAIRING_REQUEST,
      identity: { world: { id: "world-1" }, user: { id: "gm-1", isGM: true } }
    });
    return { result, socket, request };
  }

  it("identifies the browser with a persistent client id and a localized default label", async () => {
    const { result, socket, request } = await openPairing();

    expect(validatePairingRequest(request)).toEqual({ ok: true, errors: [] });
    expect(request.identity.client).toEqual({ id: storedClientId, label: DEFAULT_LABEL });
    expect(storedClientId).toMatch(/^[0-9a-f]{32}$/);

    socket.readyState = 3;
    await socket.emit("close", { code: 1000, reason: "done" });
    await expect(result).rejects.toThrow("Pairing connection closed");
  });

  it("keeps the asserted and the stored client id identical when two first-use callers overlap", async () => {
    globalThis.game.settings.set = vi.fn(async (_moduleId, key, value) => {
      await Promise.resolve();
      if (key === MODULE_SETTING_KEYS.CLIENT_ID) storedClientId = value;
    });

    const [first, second] = await Promise.all([ensureClientId(), ensureClientId()]);

    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toBe(first);
    expect(storedClientId).toBe(first);
    expect(
      globalThis.game.settings.set.mock.calls.filter(([, key]) => key === MODULE_SETTING_KEYS.CLIENT_ID)
    ).toHaveLength(1);
  });

  it("reuses the stored client id on a later pairing request instead of generating another", async () => {
    const first = await openPairing();
    const generated = first.request.identity.client.id;
    first.socket.readyState = 3;
    await first.socket.emit("close", { code: 1000, reason: "done" });
    await expect(first.result).rejects.toThrow("Pairing connection closed");

    PairingSocket.instances = [];
    const second = await openPairing();

    expect(second.request.identity.client.id).toBe(generated);
    expect(
      globalThis.game.settings.set.mock.calls.filter(([, key]) => key === MODULE_SETTING_KEYS.CLIENT_ID)
    ).toHaveLength(1);

    second.socket.readyState = 3;
    await second.socket.emit("close", { code: 1000, reason: "done" });
    await expect(second.result).rejects.toThrow("Pairing connection closed");
  });

  it("keeps the default label wire-valid when the user name carries invisible characters", async () => {
    const man = String.fromCodePoint(0x1f468);
    const rocket = String.fromCodePoint(0x1f680);
    globalThis.game.user.name = `${man}${String.fromCodePoint(0x200d)}${rocket} Astro GM`;
    const { result, socket, request } = await openPairing();

    expect(validatePairingRequest(request)).toEqual({ ok: true, errors: [] });
    expect(request.identity.client.label).toBe(`${man}${rocket} Astro GM's Browser`);

    socket.readyState = 3;
    await socket.emit("close", { code: 1000, reason: "done" });
    await expect(result).rejects.toThrow("Pairing connection closed");
  });

  it("caps the default label at the length the label schema accepts", async () => {
    globalThis.game.user.name = "Ludovico".repeat(10);
    const { result, socket, request } = await openPairing();

    expect(validatePairingRequest(request)).toEqual({ ok: true, errors: [] });
    expect(request.identity.client.label).toBe("Ludovico".repeat(8));
    expect([...request.identity.client.label]).toHaveLength(64);

    socket.readyState = 3;
    await socket.emit("close", { code: 1000, reason: "done" });
    await expect(result).rejects.toThrow("Pairing connection closed");
  });

  it("falls back to the shipped fallback label when the Foundry user name is blank", async () => {
    globalThis.game.user.name = " ".repeat(64);
    const { result, socket, request } = await openPairing();

    expect(validatePairingRequest(request)).toEqual({ ok: true, errors: [] });
    expect(request.identity.client.label).toBe(localizeEnglish("FVTTWORLDCLI.Authorization.FallbackLabel"));

    socket.readyState = 3;
    await socket.emit("close", { code: 1000, reason: "done" });
    await expect(result).rejects.toThrow("Pairing connection closed");
  });

  it("falls back to the fallback label when the locale's default label is invisible-only", async () => {
    const fallback = localizeEnglish("FVTTWORLDCLI.Authorization.FallbackLabel");
    globalThis.game.i18n = {
      ...createEnglishI18n(),
      format: (key, data) =>
        key === "FVTTWORLDCLI.Authorization.DefaultLabel"
          ? `${String.fromCodePoint(0x200b)}${String.fromCodePoint(0x2060)}`
          : formatEnglish(key, data)
    };
    const { result, socket, request } = await openPairing();

    expect(validatePairingRequest(request)).toEqual({ ok: true, errors: [] });
    expect(request.identity.client.label).toBe(fallback);

    socket.readyState = 3;
    await socket.emit("close", { code: 1000, reason: "done" });
    await expect(result).rejects.toThrow("Pairing connection closed");
  });

  it("rejects and closes the socket when pairing expires", async () => {
    vi.useFakeTimers();
    const { result, socket } = await openPairing();
    const rejection = expect(result).rejects.toThrow("Pairing request expired");
    await socket.emit("message", {
      data: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_PENDING,
        code: "7K9M2QXR",
        expiresAt: new Date(Date.now() + 1_000).toISOString()
      })
    });

    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { code: 1006, reason: "" },
    { code: 1011, reason: "daemon stopped" }
  ])(
    "rejects from the catalog when the daemon closes before returning a result ($code)",
    async ({ code, reason }) => {
      const { result, socket } = await openPairing();
      const rejection = expect(result).rejects.toThrow(
        `Pairing connection closed before authorization completed (${code}): ${reason || "no reason"}`
      );

      socket.readyState = 3;
      await socket.emit("close", { code, reason });

      await rejection;
      expect(socket.close).not.toHaveBeenCalled();
    }
  );

  it("rejects from the catalog when the pending response carries an unusable expiry", async () => {
    const { result, socket } = await openPairing();
    const rejection = expect(result).rejects.toThrow("Pairing request returned an invalid expiry");

    await socket.emit("message", {
      data: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_PENDING,
        code: "7K9M2QXR",
        expiresAt: "as soon as possible"
      })
    });

    await rejection;
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it("stores an approved credential before expiry and settles only once", async () => {
    vi.useFakeTimers();
    const { result, socket } = await openPairing();
    await socket.emit("message", {
      data: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_PENDING,
        code: "7K9M2QXR",
        expiresAt: new Date(Date.now() + 1_000).toISOString()
      })
    });
    await socket.emit("message", {
      data: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_RESULT,
        ok: true,
        pairingId: "pair-2",
        credential: "new-secret"
      })
    });

    await expect(result).resolves.toEqual({
      pairingId: "pair-2",
      credential: "new-secret",
      label: DEFAULT_LABEL
    });
    expect(getCurrentCredential()).toEqual({
      pairingId: "pair-2",
      credential: "new-secret",
      label: DEFAULT_LABEL
    });
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await socket.emit("close", { code: 1000, reason: "done" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it("discards an approved credential whose client id another tab replaced meanwhile", async () => {
    const { result, socket, request } = await openPairing();
    const asserted = request.identity.client.id;
    const rejection = result.catch((error) => error);
    storedClientId = "b2b2b2b2c3c3d4d4e5e5f6f6a7a7b8b8";

    await socket.emit("message", {
      data: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_RESULT,
        ok: true,
        pairingId: "pair-2",
        credential: "new-secret"
      })
    });

    const error = await rejection;
    // The whole rendered sentence, not two containment checks: the ids are interchangeable strings,
    // and swapping them names the stored id as the one the approved request carried.
    expect(error.message).toBe(
      `This browser now identifies itself as a different client (${storedClientId}) than the one the approved request carried (${asserted}), which the daemon would reject on every connection, so the credential was discarded. Pair again from a single tab, then remove the unused profile with auth revoke.`
    );
    expect(getCurrentCredential()).toBeNull();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed daemon JSON and closes the pairing socket", async () => {
    const { result, socket } = await openPairing();
    const rejection = result.catch((error) => error);

    await socket.emit("message", { data: "{" });

    expect(await rejection).toEqual(new Error("Pairing response was not valid JSON"));
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it("shows the code the GM must transcribe, then removes it after pairing completes", async () => {
    const remove = vi.fn();
    globalThis.ui.notifications.info.mockReturnValue({ remove });
    const { result, socket } = await openPairing();
    await socket.emit("message", {
      data: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_PENDING,
        code: "7K9M2QXR",
        expiresAt: new Date(Date.now() + 1_000).toISOString()
      })
    });
    await socket.emit("message", {
      data: JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_RESULT,
        ok: true,
        pairingId: "pair-2",
        credential: "new-secret"
      })
    });

    await expect(result).resolves.toEqual({
      pairingId: "pair-2",
      credential: "new-secret",
      label: DEFAULT_LABEL
    });
    // The whole rendered sentence: the code is the one value the GM copies into the approval, and the
    // placeholder lints compare names only, so a call site reading the wrong field still renders.
    expect(globalThis.ui.notifications.info).toHaveBeenCalledWith("Pairing code: 7K9M2QXR", {
      permanent: true
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("Client label sanitization", () => {
  const DEFAULT_LABEL = "GM's Browser";
  const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
  const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d);
  const WORD_JOINER = String.fromCodePoint(0x2060);

  beforeEach(() => {
    globalThis.game = {
      user: { id: "gm-1", name: "GM", isGM: true },
      i18n: createEnglishI18n()
    };
  });

  it("strips the control characters an escape sequence would carry", () => {
    expect(
      sanitizeClientLabel(
        `Zen${String.fromCodePoint(0x001b)}[31m${String.fromCodePoint(0x0007)} Browser${String.fromCodePoint(0x009b)}`
      )
    ).toBe("Zen[31m Browser");
  });

  it("strips every invisible code point the wire schema refuses, and refuses each one on the wire", () => {
    // Spelled out rather than derived from the shared character class: a sweep built from that
    // constant would shrink with it, and a range dropped from the wire pattern must fail here.
    const codePoints = [
      0x00, 0x09, 0x0a, 0x1b, 0x1f, 0x7f, 0x85, 0x9b, 0x9f, 0xad, 0x61c, 0x180e, 0x200b, 0x200c, 0x200d,
      0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202c, 0x202d, 0x202e, 0x2060, 0x2061, 0x2064, 0x2066, 0x2068,
      0x2069, 0xfeff, 0xfff9, 0xfffa, 0xfffb, 0xe0000, 0xe0041, 0xe007f
    ];

    for (const codePoint of codePoints) {
      const raw = `Chrome${String.fromCodePoint(codePoint)}profile`;
      const where = `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;

      expect(sanitizeClientLabel(raw), where).toBe("Chromeprofile");
      expect(validateSchema(CLIENT_LABEL_SCHEMA, raw, "label"), where).not.toEqual([]);
    }
  });

  it("strips zero-width, joiner, and bidirectional-override characters", () => {
    expect(
      sanitizeClientLabel(
        `Zen${ZERO_WIDTH_SPACE}${WORD_JOINER}${String.fromCodePoint(0x202e)} Browser${String.fromCodePoint(0xfeff)}`
      )
    ).toBe("Zen Browser");
  });

  it("normalizes a decomposed label to its composed form", () => {
    const decomposed = `Cafe${String.fromCodePoint(0x0301)} Browser`;
    const sanitized = sanitizeClientLabel(decomposed);

    expect(sanitized).toBe(decomposed.normalize("NFC"));
    expect([...decomposed]).toHaveLength(13);
    expect([...sanitized]).toHaveLength(12);
  });

  it("composes a combining mark that an invisible character separated from its base letter", () => {
    const sanitized = sanitizeClientLabel(`e${ZERO_WIDTH_SPACE}${String.fromCodePoint(0x0301)} Browser`);

    expect(sanitized).toBe(`${String.fromCodePoint(0x00e9)} Browser`);
    expect(sanitized).toBe(sanitized.normalize("NFC"));
  });

  it("trims the whitespace around a typed label", () => {
    expect(sanitizeClientLabel("   Zen Browser   ")).toBe("Zen Browser");
  });

  it("caps a long label at the length the wire schema accepts", () => {
    const sanitized = sanitizeClientLabel("Ludovico".repeat(20));

    expect(sanitized).toBe("Ludovico".repeat(8));
    expect([...sanitized]).toHaveLength(CLIENT_LABEL_MAX_LENGTH);
  });

  it("caps a long emoji label by code points, not UTF-16 units", () => {
    const grin = String.fromCodePoint(0x1f600);
    const sanitized = sanitizeClientLabel(`a${grin.repeat(100)}`);

    expect(sanitized).toBe(`a${grin.repeat(CLIENT_LABEL_MAX_LENGTH - 1)}`);
    expect([...sanitized]).toHaveLength(CLIENT_LABEL_MAX_LENGTH);
    expect(sanitized).not.toMatch(/\p{Surrogate}/u);
    expect(validateSchema(CLIENT_LABEL_SCHEMA, sanitized, "label")).toEqual([]);
  });

  it("passes Cyrillic letters and single-code-point emoji through untouched", () => {
    const label = `Хром 🦊 Браузер`;

    expect(sanitizeClientLabel(label)).toBe(label);
  });

  it("passes a keycap, a skin-tone variant, and a variation selector through untouched", () => {
    const keycap = `1${String.fromCodePoint(0xfe0f)}${String.fromCodePoint(0x20e3)}`;
    const thumbsUp = `${String.fromCodePoint(0x1f44d)}${String.fromCodePoint(0x1f3fd)}`;
    const heart = `${String.fromCodePoint(0x2764)}${String.fromCodePoint(0xfe0f)}`;
    const label = `${keycap} ${thumbsUp} ${heart} Browser`;

    expect(sanitizeClientLabel(label)).toBe(label);
  });

  it("keeps the parts of a joined emoji sequence and drops the joiner between them", () => {
    const woman = String.fromCodePoint(0x1f469);
    const girl = String.fromCodePoint(0x1f467);

    expect(sanitizeClientLabel(`${woman}${ZERO_WIDTH_JOINER}${girl} Browser`)).toBe(
      `${woman}${girl} Browser`
    );
  });

  it("passes a regional-indicator flag through untouched", () => {
    const label = `${String.fromCodePoint(0x1f1fa)}${String.fromCodePoint(0x1f1f8)} Browser`;

    expect(sanitizeClientLabel(label)).toBe(label);
  });

  it("reduces a tagged subdivision flag to its base flag", () => {
    const blackFlag = String.fromCodePoint(0x1f3f4);
    const tags = [0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f]
      .map((codePoint) => String.fromCodePoint(codePoint))
      .join("");

    expect(sanitizeClientLabel(`${blackFlag}${tags} Browser`)).toBe(`${blackFlag} Browser`);
  });

  it("falls back to the localized default label when nothing survives", () => {
    expect(sanitizeClientLabel("")).toBe(DEFAULT_LABEL);
    expect(sanitizeClientLabel(undefined)).toBe(DEFAULT_LABEL);
    expect(sanitizeClientLabel(`  ${ZERO_WIDTH_SPACE}${WORD_JOINER} `)).toBe(DEFAULT_LABEL);
  });

  it("names the module when the locale leaves both default labels empty", () => {
    globalThis.game.i18n = { localize: () => "", format: () => "" };

    expect(sanitizeClientLabel("")).toBe(MODULE_TITLE);
    expect([...MODULE_TITLE].length).toBeLessThanOrEqual(CLIENT_LABEL_MAX_LENGTH);
  });

  it("returns only labels the wire schema accepts", () => {
    const locales = [
      { localize: (key) => key, format: (key, data) => `${key}:${data.user}` },
      { localize: () => "", format: () => "" }
    ];

    for (const i18n of locales) {
      globalThis.game.i18n = i18n;
      for (const raw of [
        "",
        "   ",
        `${ZERO_WIDTH_SPACE}${WORD_JOINER}`,
        `${String.fromCodePoint(0x001b)}[2J`,
        "Ludovico".repeat(20),
        "Хром 🦊 Браузер",
        "Café Browser"
      ])
        expect(validateSchema(CLIENT_LABEL_SCHEMA, sanitizeClientLabel(raw), "label")).toEqual([]);
    }
  });
});

describe("Authorization window markup", () => {
  const template = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "authorization.hbs"),
    "utf8"
  );

  it("renders exactly one connection-action button whose action comes from the context", () => {
    expect(template.match(/data-action="\{\{connectionAction\}\}"/g)).toHaveLength(1);
    expect(template).not.toContain('data-action="connect"');
    expect(template).not.toContain('data-action="disconnect"');
  });

  it("reserves a fixed slot for the connection action so a state flip cannot resize it", () => {
    expect(template).toContain('class="fvtt-world-cli-connection-action"');
    const styles = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "styles", "scene-controls.css"),
      "utf8"
    );
    expect(styles).toMatch(/\.fvtt-world-cli-connection-action \{[^}]*min-width:/);
    expect(styles).toMatch(/\.fvtt-world-cli-connection-action \{[^}]*white-space: nowrap/);
  });

  it("keeps every row the GM cannot edit out of the interactive label hover styling", () => {
    const rows = template.split('<div class="form-group').slice(1);
    expect(rows).toHaveLength(3);
    const [connection, pairing, clientLabel] = rows.map((row) => row.slice(0, row.indexOf('"')).trim());

    expect(connection).toBe("fvtt-world-cli-readonly");
    expect(pairing).toBe("fvtt-world-cli-readonly");
    expect(clientLabel).toBe("{{#unless clientLabelEditable}}fvtt-world-cli-readonly{{/unless}}");
  });

  it("names the label input with the selector the module reads the typed draft through", () => {
    expect(CLIENT_LABEL_FIELD_SELECTOR).toMatch(/^input\[name="[^"]+"\]$/);
    const nameAttribute = CLIENT_LABEL_FIELD_SELECTOR.slice("input[".length, -1);

    expect(template).toMatch(new RegExp(`<input\\b[^>]*\\s${nameAttribute}`));
  });

  it("renders the label field editable only where the context allows it", () => {
    expect(template).toContain('value="{{clientLabel}}"');
    expect(template).toContain('maxlength="{{clientLabelMaxLength}}"');
    expect(template).toContain('data-tooltip="{{localize clientLabelTooltip}}"');
    expect(template).toContain("{{#unless clientLabelEditable}}readonly{{/unless}}");
  });

  it("chooses a connection action for every display state", () => {
    expect(Object.keys(CONNECTION_ACTIONS).sort()).toEqual([...DISPLAY_STATE_NAMES].sort());
    expect(CONNECTION_ACTIONS.unpaired).toBeNull();
  });

  it("labels every connection action a display state can reach", () => {
    const reachable = [...new Set(Object.values(CONNECTION_ACTIONS).filter((action) => action !== null))];

    expect(Object.keys(CONNECTION_ACTION_LABELS).sort()).toEqual(reachable.sort());
  });
});
