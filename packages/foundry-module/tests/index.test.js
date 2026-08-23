import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APPROVAL_TIMEOUT_DEFAULT_MINUTES,
  APPROVAL_TIMEOUT_MAX_MINUTES,
  APPROVAL_TIMEOUT_MIN_MINUTES,
  COMMAND_NAMES,
  DISCOVERABLE_COMMAND_NAMES
} from "../scripts/generated/protocol.js";

describe("module settings registration", () => {
  let hookCallbacks;
  let hookHandlers;
  let consoleInfo;
  let storedSettings;

  beforeEach(() => {
    vi.resetModules();
    hookCallbacks = new Map();
    hookHandlers = new Map();
    consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    storedSettings = { credentials: {}, clientId: "", daemonUrl: "ws://127.0.0.1:47833" };

    globalThis.game = {
      settings: {
        register: vi.fn(),
        registerMenu: vi.fn(),
        get: vi.fn((_moduleId, key) => storedSettings[key] ?? "ws://127.0.0.1:47833"),
        set: vi.fn(async (_moduleId, key, value) => {
          storedSettings[key] = value;
        })
      },
      world: { id: "world-1" },
      user: {
        isGM: true
      },
      i18n: { localize: (key) => key },
      modules: new Map()
    };

    class ApplicationV2 {}
    globalThis.foundry = {
      applications: {
        api: {
          ApplicationV2,
          HandlebarsApplicationMixin: (Base) => class extends Base {}
        }
      }
    };

    /** @type {any} */ (globalThis).Hooks = {
      once: vi.fn((event, callback) => {
        hookCallbacks.set(event, callback);
      }),
      on: vi.fn((event, callback) => {
        hookHandlers.set(event, callback);
      }),
      callAll: vi.fn()
    };

    globalThis.ui = {
      notifications: {
        warn: vi.fn()
      }
    };
  });

  afterEach(() => {
    consoleInfo.mockRestore();
    delete (/** @type {any} */ (globalThis).Hooks);
    delete globalThis.game;
    delete globalThis.ui;
    delete globalThis.foundryCliBridge;
    delete globalThis.foundry;
    globalThis.WebSocket = /** @type {any} */ (undefined);
  });

  it("stores the daemon URL and credentials in client-scoped settings", async () => {
    await import("../scripts/index.js");

    const initCallback = hookCallbacks.get("init");
    expect(initCallback).toBeTypeOf("function");

    initCallback();

    const credentialRegistration = globalThis.game.settings.register.mock.calls.find(
      ([, key]) => key === "credentials"
    );

    expect(credentialRegistration).toBeDefined();
    expect(credentialRegistration[2]).toMatchObject({
      scope: "client",
      config: false,
      default: {}
    });
  });

  it("keeps the browser client identifier in the same client-scoped partition as the credential", async () => {
    await import("../scripts/index.js");

    hookCallbacks.get("init")();

    const registrations = globalThis.game.settings.register.mock.calls.filter(([, key]) =>
      ["credentials", "clientId"].includes(key)
    );

    expect(registrations.map(([, key]) => key)).toEqual(["credentials", "clientId"]);
    expect(registrations[0][2].scope).toBe("client");
    expect(registrations[1][2]).toMatchObject({
      scope: registrations[0][2].scope,
      config: false,
      type: String,
      default: ""
    });
  });

  it("generates and persists a browser client identifier the first time the bridge starts", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.game.user = { id: "gm-1", isGM: true };
    storedSettings.autoConnect = true;
    storedSettings.credentials = { "world-1:gm-1": { pairingId: "pair-1", credential: "secret" } };

    await import("../scripts/index.js");
    await hookCallbacks.get("ready")();

    expect(storedSettings.clientId).toMatch(/^[0-9a-f]{32}$/);
    expect(globalThis.game.settings.set.mock.calls.filter(([, key]) => key === "clientId")).toHaveLength(1);

    await hookCallbacks.get("ready")();

    expect(globalThis.game.settings.set.mock.calls.filter(([, key]) => key === "clientId")).toHaveLength(1);
    consoleError.mockRestore();
  });

  it("registers auto-connect as a visible client-scoped boolean that defaults to enabled", async () => {
    await import("../scripts/index.js");

    hookCallbacks.get("init")();

    const registration = globalThis.game.settings.register.mock.calls.find(
      ([, key]) => key === "autoConnect"
    );

    expect(registration).toBeDefined();
    expect(registration[2]).toMatchObject({
      scope: "client",
      config: true,
      type: Boolean,
      default: true
    });
  });

  it("keeps the command policy in a hidden client-scoped setting the window is the only editor of", async () => {
    await import("../scripts/index.js");

    hookCallbacks.get("init")();

    const registration = globalThis.game.settings.register.mock.calls.find(
      ([, key]) => key === "commandPolicy"
    );

    expect(registration).toBeDefined();
    expect(registration[2]).toMatchObject({
      scope: "client",
      config: false,
      type: Object,
      default: {}
    });
  });

  it("bounds the visible approval timeout setting without turning its field into a slider", async () => {
    await import("../scripts/index.js");

    hookCallbacks.get("init")();

    const registration = globalThis.game.settings.register.mock.calls.find(
      ([, key]) => key === "approvalTimeoutMinutes"
    );

    expect(registration).toBeDefined();
    expect(registration[2]).toMatchObject({
      scope: "client",
      config: true,
      type: Number,
      default: APPROVAL_TIMEOUT_DEFAULT_MINUTES,
      range: { min: APPROVAL_TIMEOUT_MIN_MINUTES, max: APPROVAL_TIMEOUT_MAX_MINUTES }
    });
    expect(registration[2].range).not.toHaveProperty("step");
  });

  it("skips bridge startup on ready when auto-connect is disabled", async () => {
    storedSettings.autoConnect = false;
    storedSettings.credentials = { "world-1:gm-1": { pairingId: "pair-1", credential: "secret" } };

    await import("../scripts/index.js");
    await hookCallbacks.get("ready")();

    expect(globalThis.foundryCliBridge).toBeUndefined();
    expect(globalThis.ui.notifications.warn).not.toHaveBeenCalled();
  });

  it("starts the bridge on ready for a paired GM when auto-connect is enabled", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.game.user = { id: "gm-1", isGM: true };
    storedSettings.autoConnect = true;
    storedSettings.credentials = { "world-1:gm-1": { pairingId: "pair-1", credential: "secret" } };

    await import("../scripts/index.js");
    await hookCallbacks.get("ready")();

    expect(globalThis.foundryCliBridge).toBeDefined();
    consoleError.mockRestore();
  });

  it("leaves one bridge client running when two startup attempts overlap", async () => {
    globalThis.game.user = { id: "gm-1", isGM: true };
    storedSettings.autoConnect = true;
    storedSettings.credentials = { "world-1:gm-1": { pairingId: "pair-1", credential: "secret" } };
    let openedSockets = 0;
    class FakeSocket {
      constructor() {
        openedSockets += 1;
      }
      addEventListener() {}
      close() {}
    }
    globalThis.WebSocket = /** @type {any} */ (FakeSocket);

    await import("../scripts/index.js");
    const ready = hookCallbacks.get("ready");
    await Promise.all([ready(), ready()]);

    expect(openedSockets).toBe(1);
    expect(globalThis.foundryCliBridge.getStatus().status).toBe("connecting");
  });

  it("advertises every executable command in the handshake so undiscoverable plumbing stays callable", async () => {
    globalThis.game.user = { id: "gm-1", isGM: true };
    storedSettings.autoConnect = true;
    storedSettings.credentials = { "world-1:gm-1": { pairingId: "pair-1", credential: "secret" } };
    class FakeSocket {
      addEventListener() {}
      close() {}
    }
    globalThis.WebSocket = /** @type {any} */ (FakeSocket);

    await import("../scripts/index.js");
    await hookCallbacks.get("ready")();

    const undiscoverable = COMMAND_NAMES.filter((name) => !DISCOVERABLE_COMMAND_NAMES.includes(name));
    expect(undiscoverable.length).toBeGreaterThan(0);

    const { commands } = globalThis.foundryCliBridge.getSession();
    expect(commands).toEqual([...COMMAND_NAMES]);
    for (const command of undiscoverable) {
      expect(commands, `${command} must remain forwardable`).toContain(command);
    }
  });

  it("registers every GM-only ApplicationV2 settings submenu the module ships", async () => {
    await import("../scripts/index.js");

    hookCallbacks.get("init")();

    const menus = globalThis.game.settings.registerMenu.mock.calls;
    expect(menus.map(([, key]) => key)).toEqual(["authorization", "bridgeStatus", "commandPermissions"]);
    for (const [, , registration] of menus) {
      expect(registration.restricted).toBe(true);
      expect(registration.type.prototype).toBeInstanceOf(globalThis.foundry.applications.api.ApplicationV2);
    }
    expect(menus[0][2].icon).toBe("fa-solid fa-key-skeleton");
    expect(menus[1][2].icon).toBe("fa-solid fa-plug");
    expect(menus[2][2].icon).toBe("fa-solid fa-shield-halved");
  });

  it("registers the scene-controls group and indicator hooks on init", async () => {
    await import("../scripts/index.js");

    hookCallbacks.get("init")();

    expect([...hookHandlers.keys()]).toEqual(["getSceneControlButtons", "renderSceneControls"]);
    const controls = { tokens: { order: 0 } };
    hookHandlers.get("getSceneControlButtons")(controls);
    expect(controls["fvtt-world-cli"]).toMatchObject({
      name: "fvtt-world-cli",
      icon: "fa-solid fa-terminal",
      order: 1,
      visible: true
    });
  });

  it("deletes legacy world-scoped settings by setting key on GM ready", async () => {
    const legacyToken = { delete: vi.fn(async () => {}) };
    const legacyUrl = { delete: vi.fn(async () => {}) };
    const worldSettings = {
      getSetting: vi.fn(
        (key) =>
          ({
            "fvtt-world-cli.authToken": legacyToken,
            "fvtt-world-cli.daemonUrl": legacyUrl
          })[key]
      )
    };
    globalThis.game.settings.storage = new Map([["world", worldSettings]]);

    await import("../scripts/index.js");
    await hookCallbacks.get("ready")();

    expect(worldSettings.getSetting.mock.calls).toEqual([
      ["fvtt-world-cli.authToken"],
      ["fvtt-world-cli.daemonUrl"]
    ]);
    expect(legacyToken.delete).toHaveBeenCalledTimes(1);
    expect(legacyUrl.delete).toHaveBeenCalledTimes(1);
  });
});
