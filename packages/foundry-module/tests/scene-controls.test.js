import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBridgeStatusApplication,
  createSceneControls,
  prepareBridgeStatusContext
} from "../scripts/scene-controls.js";
import {
  DISPLAY_STATE_NAMES,
  describeConnection,
  resolveDisplayState
} from "../scripts/lib/bridge-status.js";
import { publishStatus } from "../scripts/lib/status-signal.js";
import { MODULE_SETTING_KEYS } from "../scripts/lib/validators.js";
import { createEnglishI18n, localizeEnglish } from "./helpers/i18n.js";

const CONTROL_GROUP = "fvtt-world-cli";
const STATUS_CLASSES = [
  "fvtt-world-cli-status--connected",
  "fvtt-world-cli-status--pending",
  "fvtt-world-cli-status--offline",
  "fvtt-world-cli-status--unpaired"
];
const STATUS_GLYPHS = [
  "fa-plug-circle-check",
  "fa-plug-circle-exclamation",
  "fa-plug-circle-xmark",
  "fa-plug"
];

function fakeButton(attributes = {}, classes = []) {
  const classList = new Set(classes);
  return {
    attributes,
    classes: classList,
    classList: {
      add: (name) => classList.add(name),
      remove: (name) => classList.delete(name),
      contains: (name) => classList.has(name)
    },
    getAttribute: (name) => attributes[name] ?? null,
    hasAttribute: (name) => name in attributes,
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
    removeAttribute: (name) => {
      delete attributes[name];
    }
  };
}

function fakeSceneControlsElement({
  groupExpanded = true,
  statusToolClasses = ["fa-solid", "fa-plug"]
} = {}) {
  const groupButton = fakeButton({ "aria-pressed": groupExpanded ? "true" : "false" }, [
    "control",
    "ui-control",
    "layer",
    "icon",
    "fa-solid",
    "fa-terminal"
  ]);
  const statusToolButton = fakeButton({}, ["control", "ui-control", "tool", "icon", ...statusToolClasses]);
  const connectButton = fakeButton({}, ["control", "ui-control", "tool", "icon"]);
  const disconnectButton = fakeButton({}, ["control", "ui-control", "tool", "icon"]);
  const nodes = {
    [`button.control[data-control="${CONTROL_GROUP}"]`]: groupButton,
    'button.tool[data-tool="status"]': statusToolButton,
    'button.tool[data-tool="connect"]': connectButton,
    'button.tool[data-tool="disconnect"]': disconnectButton
  };
  return {
    groupButton,
    statusToolButton,
    connectButton,
    disconnectButton,
    element: { querySelector: (selector) => nodes[selector] ?? null }
  };
}

function stubGame({ isGM = true, paired = true } = {}) {
  globalThis.game = /** @type {any} */ ({
    world: { id: "world-1", title: "World" },
    user: { id: "gm-1", name: "GM", isGM },
    i18n: createEnglishI18n(),
    settings: {
      get: vi.fn((_moduleId, key) =>
        key === MODULE_SETTING_KEYS.CREDENTIALS
          ? paired
            ? { "world-1:gm-1": { pairingId: "pair-1", credential: "secret" } }
            : {}
          : "ws://127.0.0.1:47833"
      )
    }
  });
}

function flushHandler() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function stubBridge(status) {
  globalThis.foundryCliBridge = /** @type {any} */ ({ getStatus: () => status });
}

describe("bridge display state mapping", () => {
  const credential = { pairingId: "pair-1", credential: "secret" };

  it.each([
    ["connected", { status: "connected", helloAcknowledged: true }, "connected"],
    ["connected awaiting the handshake", { status: "connected", helloAcknowledged: false }, "pending"],
    ["connecting", { status: "connecting", helloAcknowledged: false }, "pending"],
    ["reconnecting", { status: "reconnecting", helloAcknowledged: false }, "pending"],
    ["disconnected", { status: "disconnected", helloAcknowledged: false }, "offline"],
    ["stopped", { status: "stopped", helloAcknowledged: false }, "offline"],
    ["error", { status: "error", helloAcknowledged: false }, "offline"],
    ["idle", { status: "idle", helloAcknowledged: false }, "offline"],
    ["an unrecognized state", { status: "starting", helloAcknowledged: false }, "offline"]
  ])("maps a paired client that is %s to %s", (_label, bridgeStatus, expected) => {
    expect(resolveDisplayState(credential, bridgeStatus)).toBe(expected);
  });

  it("maps a paired client with no bridge instance to offline", () => {
    expect(resolveDisplayState(credential, undefined)).toBe("offline");
  });

  it.each([
    ["no bridge instance", undefined],
    ["a connected bridge instance", { status: "connected", helloAcknowledged: true }]
  ])("maps a missing credential with %s to unpaired", (_label, bridgeStatus) => {
    expect(resolveDisplayState(null, bridgeStatus)).toBe("unpaired");
  });

  it.each([...DISPLAY_STATE_NAMES])("names the %s display state from the catalog", (state) => {
    stubGame();

    const label = describeConnection(/** @type {any} */ (state), null);

    expect(label).toBe(localizeEnglish(`FVTTWORLDCLI.BridgeStatus.State.${state}`));
    expect(label).not.toContain("FVTTWORLDCLI");
  });
});

describe("World CLI scene control group", () => {
  /** @type {ReturnType<typeof createSceneControls>} */
  let sceneControls;
  let AuthorizationApplication;
  let BridgeStatusApplication;
  let authorizationRender;
  let bridgeStatusRender;
  let startBridge;

  beforeEach(() => {
    stubGame();
    stubBridge({ status: "connected", helloAcknowledged: true, url: "ws://127.0.0.1:47833" });
    globalThis.ui = /** @type {any} */ ({
      notifications: { warn: vi.fn(), error: vi.fn() },
      controls: { rendered: true, render: vi.fn(), control: { name: CONTROL_GROUP }, element: null }
    });
    authorizationRender = vi.fn(async () => {});
    bridgeStatusRender = vi.fn(async () => {});
    AuthorizationApplication = class {
      static DEFAULT_OPTIONS = { id: "fvtt-world-cli-authorization" };

      render = authorizationRender;
    };
    BridgeStatusApplication = class {
      static DEFAULT_OPTIONS = { id: "fvtt-world-cli-bridge-status" };

      render = bridgeStatusRender;
    };
    startBridge = vi.fn(async () => {});
    sceneControls = createSceneControls({
      AuthorizationApplication,
      BridgeStatusApplication,
      startBridge
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.game;
    delete globalThis.ui;
    delete globalThis.foundryCliBridge;
  });

  /** @param {Record<string, any>} [controls] */
  function addedGroup(controls = { tokens: { order: 0 }, walls: { order: 40 } }) {
    sceneControls.addControls(controls);
    return controls[CONTROL_GROUP];
  }

  it("appends the group one order slot below every existing control", () => {
    expect(addedGroup().order).toBe(41);
  });

  it("ignores existing controls that declare no order", () => {
    expect(addedGroup({ tokens: { order: 7 }, exotic: {} }).order).toBe(8);
  });

  it("places the group first when no other control declares an order", () => {
    expect(addedGroup({}).order).toBe(0);
  });

  it("uses a static terminal glyph and localizable title for the group", () => {
    const group = addedGroup();

    expect(group.icon).toBe("fa-solid fa-terminal");
    expect(group.title).toBe("FVTTWORLDCLI.Controls.Group");
    expect(group.layer).toBeUndefined();
  });

  it("is visible to a GM and hidden from a player", () => {
    expect(addedGroup().visible).toBe(true);

    stubGame({ isGM: false });
    expect(addedGroup().visible).toBe(false);
  });

  it("declares no active tool so expanding the group activates nothing", () => {
    expect(addedGroup().activeTool).toBeUndefined();
  });

  it("exposes the four bridge tools in order, each as an immediate button", () => {
    const tools = Object.values(addedGroup().tools);

    expect(tools.map((tool) => tool.name)).toEqual([
      "status",
      "connect",
      "disconnect",
      "authorization",
      "settings"
    ]);
    expect(tools.map((tool) => tool.order)).toEqual([0, 1, 2, 3, 4]);
    expect(tools.every((tool) => tool.button === true)).toBe(true);
    expect(tools.some((tool) => tool.toggle)).toBe(false);
    expect(tools.every((tool) => typeof tool.onChange === "function")).toBe(true);
    expect(tools.some((tool) => tool.onClick)).toBe(false);
    expect(tools.some((tool) => "pip" in tool)).toBe(false);
  });

  it("gives the four action tools static core-style glyphs", () => {
    const { connect, disconnect, authorization, settings } = addedGroup().tools;

    expect(connect.icon).toBe("fa-solid fa-plug-circle-bolt");
    expect(disconnect.icon).toBe("fa-solid fa-plug-circle-minus");
    expect(authorization.icon).toBe("fa-solid fa-key-skeleton");
    expect(settings.icon).toBe("fa-solid fa-gear");
  });

  it("keeps the three plug glyphs adjacent at the top of the group", () => {
    const plugOrders = Object.values(addedGroup().tools)
      .filter((tool) => tool.icon.includes("fa-plug"))
      .map((tool) => tool.order);

    expect(plugOrders).toEqual([0, 1, 2]);
  });

  it("builds the status tool glyph from the current display state", () => {
    expect(addedGroup().tools.status.icon).toBe("fa-solid fa-plug-circle-check");

    stubBridge({ status: "reconnecting", helloAcknowledged: false });
    expect(addedGroup().tools.status.icon).toBe("fa-solid fa-plug-circle-exclamation");

    stubGame({ paired: false });
    expect(addedGroup().tools.status.icon).toBe("fa-solid fa-plug");
  });

  it("reuses a live window instead of stacking a duplicate instance", async () => {
    const group = addedGroup();
    const open = new BridgeStatusApplication();
    globalThis.foundry = /** @type {any} */ ({
      applications: {
        instances: new Map([["fvtt-world-cli-bridge-status", open]])
      }
    });

    group.tools.status.onChange(new Event("change"), true);
    await flushHandler();

    expect(open.render).toHaveBeenCalledWith({ force: true });
    expect(bridgeStatusRender).toHaveBeenCalledTimes(1);
    delete globalThis.foundry;
  });

  it("opens the bridge status window from the status tool", async () => {
    addedGroup().tools.status.onChange(new Event("change"), true);
    await flushHandler();

    expect(bridgeStatusRender).toHaveBeenCalledWith({ force: true });
  });

  it("opens the authorization window from the authorization tool", async () => {
    addedGroup().tools.authorization.onChange(new Event("change"), true);
    await flushHandler();

    expect(authorizationRender).toHaveBeenCalledWith({ force: true });
  });

  it("focuses this module's category after opening the settings sheet", async () => {
    const sheet = { render: vi.fn(async () => {}), changeTab: vi.fn() };
    globalThis.game.settings.sheet = sheet;

    addedGroup().tools.settings.onChange(new Event("change"), true);
    await flushHandler();

    expect(sheet.render).toHaveBeenCalledWith({ force: true });
    expect(sheet.changeTab).toHaveBeenCalledWith(CONTROL_GROUP, "categories");
  });

  it("leaves the settings sheet open when the module category cannot be focused", async () => {
    const sheet = {
      render: vi.fn(async () => {}),
      changeTab: vi.fn(() => {
        throw new Error("No matching tab element found");
      })
    };
    globalThis.game.settings.sheet = sheet;

    expect(addedGroup().tools.settings.onChange(new Event("change"), true)).toBeUndefined();
    await flushHandler();

    expect(sheet.render).toHaveBeenCalledWith({ force: true });
    expect(sheet.changeTab).toHaveBeenCalledTimes(1);
  });

  it("restarts the bridge with the stored credential from the connect tool", async () => {
    addedGroup().tools.connect.onChange(new Event("change"), true);
    await flushHandler();

    expect(startBridge).toHaveBeenCalledWith({ pairingId: "pair-1", credential: "secret" });
    expect(globalThis.ui.notifications.warn).not.toHaveBeenCalled();
  });

  it("offers pairing instead of connecting when no credential is stored", async () => {
    stubGame({ paired: false });

    addedGroup().tools.connect.onChange(new Event("change"), true);
    await flushHandler();

    expect(startBridge).not.toHaveBeenCalled();
    expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith(
      "World CLI is not paired yet. Pair this browser with the local daemon first."
    );
    expect(authorizationRender).toHaveBeenCalledWith({ force: true });
  });

  it("reports a failed connect in the Foundry UI instead of rejecting the click handler", async () => {
    startBridge.mockRejectedValue(new Error("daemon unavailable"));

    expect(addedGroup().tools.connect.onChange(new Event("change"), true)).toBeUndefined();
    await flushHandler();

    // The whole sentence, not the substituted value: the Authorization window's sibling string differs
    // only in its prefix, and a call site pointed at that key renders the wrong window's wording here.
    expect(globalThis.ui.notifications.error).toHaveBeenCalledWith(
      "Bridge connect failed: daemon unavailable",
      { permanent: true }
    );
  });

  it("stops the live bridge from the disconnect tool", () => {
    const stop = vi.fn();
    globalThis.foundryCliBridge = /** @type {any} */ ({
      getStatus: () => ({ status: "connected", helloAcknowledged: true }),
      stop
    });

    addedGroup().tools.disconnect.onChange(new Event("change"), true);

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("ignores the disconnect tool when no bridge instance exists", () => {
    delete globalThis.foundryCliBridge;

    expect(() => addedGroup().tools.disconnect.onChange(new Event("change"), true)).not.toThrow();
  });

  it.each([
    ["connected", { status: "connected", helloAcknowledged: true }, true, true, false],
    ["connecting", { status: "connecting", helloAcknowledged: false }, true, false, false],
    ["reconnecting", { status: "reconnecting", helloAcknowledged: false }, true, false, false],
    ["awaiting the handshake", { status: "connected", helloAcknowledged: false }, true, false, false],
    ["stopped", { status: "stopped", helloAcknowledged: false }, true, false, true],
    ["disconnected", { status: "disconnected", helloAcknowledged: false }, true, false, true],
    ["unpaired", null, false, false, true]
  ])(
    "gates connect and disconnect for a bridge that is %s",
    (_label, bridgeStatus, paired, connectDisabled, disconnectDisabled) => {
      if (paired) stubBridge(bridgeStatus);
      else stubGame({ paired: false });
      const { element, connectButton, disconnectButton } = fakeSceneControlsElement();
      addedGroup();

      sceneControls.applyStatusIndicator(null, element);

      expect(connectButton.hasAttribute("disabled")).toBe(connectDisabled);
      expect(disconnectButton.hasAttribute("disabled")).toBe(disconnectDisabled);
    }
  );

  it("re-enables connect in place when a connected bridge stops while the group is open", () => {
    const { element, connectButton, disconnectButton } = fakeSceneControlsElement();
    globalThis.ui.controls.element = element;
    addedGroup();
    sceneControls.applyStatusIndicator(null, element);

    expect(connectButton.hasAttribute("disabled")).toBe(true);
    expect(disconnectButton.hasAttribute("disabled")).toBe(false);

    stubBridge({ status: "stopped", helloAcknowledged: false });
    sceneControls.handleStatusChange();

    expect(globalThis.ui.controls.render).not.toHaveBeenCalled();
    expect(connectButton.hasAttribute("disabled")).toBe(false);
    expect(disconnectButton.hasAttribute("disabled")).toBe(true);
  });

  it("leaves the gated buttons alone while another control group is active", () => {
    globalThis.ui.controls.control = { name: "tokens" };
    const { element, connectButton, disconnectButton } = fakeSceneControlsElement();
    addedGroup();

    sceneControls.applyStatusIndicator(null, element);

    expect(connectButton.hasAttribute("disabled")).toBe(false);
    expect(disconnectButton.hasAttribute("disabled")).toBe(false);
  });

  it("gates the action buttons even when the status button is absent", () => {
    const { connectButton, disconnectButton } = fakeSceneControlsElement();
    const nodes = {
      'button.tool[data-tool="connect"]': connectButton,
      'button.tool[data-tool="disconnect"]': disconnectButton
    };
    addedGroup();

    sceneControls.applyStatusIndicator(null, { querySelector: (selector) => nodes[selector] ?? null });

    expect(connectButton.hasAttribute("disabled")).toBe(true);
    expect(disconnectButton.hasAttribute("disabled")).toBe(false);
  });

  it("colors the always-visible group button without changing its glyph", () => {
    globalThis.ui.controls.control = { name: "tokens" };
    const { element, groupButton } = fakeSceneControlsElement();
    addedGroup();

    sceneControls.applyStatusIndicator(null, element);

    expect(groupButton.classList.contains("fvtt-world-cli-status--connected")).toBe(true);
    expect(groupButton.classList.contains("fa-terminal")).toBe(true);
    expect(STATUS_GLYPHS.some((glyph) => groupButton.classList.contains(glyph))).toBe(false);
  });

  it.each([
    [{ status: "connected", helloAcknowledged: true }, "connected", "fa-plug-circle-check"],
    [{ status: "connecting", helloAcknowledged: false }, "pending", "fa-plug-circle-exclamation"],
    [{ status: "stopped", helloAcknowledged: false }, "offline", "fa-plug-circle-xmark"]
  ])("marks the expanded status tool as %#", (bridgeStatus, expectedState, expectedGlyph) => {
    stubBridge(bridgeStatus);
    const { element, groupButton, statusToolButton } = fakeSceneControlsElement();
    addedGroup();

    sceneControls.applyStatusIndicator(null, element);

    const expectedClass = `fvtt-world-cli-status--${expectedState}`;
    expect(groupButton.classList.contains(expectedClass)).toBe(true);
    expect(statusToolButton.classList.contains(expectedClass)).toBe(true);
    expect(STATUS_CLASSES.filter((name) => statusToolButton.classList.contains(name))).toEqual([
      expectedClass
    ]);
    expect(STATUS_GLYPHS.filter((glyph) => statusToolButton.classList.contains(glyph))).toEqual([
      expectedGlyph
    ]);
  });

  it("marks an unpaired bridge with the neutral plug glyph", () => {
    stubGame({ paired: false });
    const { element, statusToolButton } = fakeSceneControlsElement();
    addedGroup();

    sceneControls.applyStatusIndicator(null, element);

    expect(statusToolButton.classList.contains("fvtt-world-cli-status--unpaired")).toBe(true);
    expect(STATUS_GLYPHS.filter((glyph) => statusToolButton.classList.contains(glyph))).toEqual(["fa-plug"]);
  });

  it("replaces the previous status class and glyph when the state changes", () => {
    const { element, statusToolButton } = fakeSceneControlsElement();
    addedGroup();
    sceneControls.applyStatusIndicator(null, element);

    stubBridge({ status: "stopped", helloAcknowledged: false });
    sceneControls.applyStatusIndicator(null, element);

    expect(STATUS_CLASSES.filter((name) => statusToolButton.classList.contains(name))).toEqual([
      "fvtt-world-cli-status--offline"
    ]);
    expect(STATUS_GLYPHS.filter((glyph) => statusToolButton.classList.contains(glyph))).toEqual([
      "fa-plug-circle-xmark"
    ]);
  });

  it("leaves a foreign status tool untouched while another control group is active", () => {
    globalThis.ui.controls.control = { name: "tokens" };
    const { element, statusToolButton } = fakeSceneControlsElement();
    addedGroup();

    sceneControls.applyStatusIndicator(null, element);

    expect(STATUS_CLASSES.some((name) => statusToolButton.classList.contains(name))).toBe(false);
  });

  it("colors the status tool on the render that opens the group, before aria-pressed is set", () => {
    const { element, statusToolButton } = fakeSceneControlsElement();
    addedGroup();

    expect(statusToolButton.getAttribute("aria-pressed")).toBeNull();
    sceneControls.applyStatusIndicator(null, element);

    expect(statusToolButton.classList.contains("fvtt-world-cli-status--connected")).toBe(true);
  });

  it("tolerates a scene-controls render that has no World CLI group", () => {
    const element = { querySelector: () => null };

    expect(() => sceneControls.applyStatusIndicator(null, element)).not.toThrow();
  });

  it("repaints the rendered toolbar in place instead of rebuilding it", () => {
    const { element, groupButton, statusToolButton } = fakeSceneControlsElement();
    globalThis.ui.controls.element = element;
    addedGroup();

    stubBridge({ status: "stopped", helloAcknowledged: false });
    sceneControls.handleStatusChange();

    expect(globalThis.ui.controls.render).not.toHaveBeenCalled();
    expect(groupButton.classList.contains("fvtt-world-cli-status--offline")).toBe(true);
    expect(STATUS_GLYPHS.filter((glyph) => statusToolButton.classList.contains(glyph))).toEqual([
      "fa-plug-circle-xmark"
    ]);
  });

  it("keeps the retained status tool glyph correct for the next full render", () => {
    const group = addedGroup();

    stubBridge({ status: "stopped", helloAcknowledged: false });
    sceneControls.handleStatusChange();

    expect(group.tools.status.icon).toBe("fa-solid fa-plug-circle-xmark");
  });

  it("repaints on every status change so backoff flapping stays visible", () => {
    const { element, groupButton } = fakeSceneControlsElement();
    globalThis.ui.controls.element = element;
    addedGroup();

    for (const bridgeStatus of [
      { status: "reconnecting", helloAcknowledged: false },
      { status: "connecting", helloAcknowledged: false },
      { status: "stopped", helloAcknowledged: false }
    ]) {
      stubBridge(bridgeStatus);
      sceneControls.handleStatusChange();
    }

    expect(globalThis.ui.controls.render).not.toHaveBeenCalled();
    expect(STATUS_CLASSES.filter((name) => groupButton.classList.contains(name))).toEqual([
      "fvtt-world-cli-status--offline"
    ]);
  });

  it("does not touch scene controls that have never been rendered", () => {
    const { element, groupButton } = fakeSceneControlsElement();
    globalThis.ui.controls.rendered = false;
    globalThis.ui.controls.element = element;
    addedGroup();

    sceneControls.handleStatusChange();

    expect(globalThis.ui.controls.render).not.toHaveBeenCalled();
    expect(STATUS_CLASSES.some((name) => groupButton.classList.contains(name))).toBe(false);
  });

  it("survives a status change that arrives before the group is built", () => {
    globalThis.ui.controls.element = { querySelector: () => null };

    expect(() => sceneControls.handleStatusChange()).not.toThrow();
    expect(globalThis.ui.controls.render).not.toHaveBeenCalled();
  });
});

describe("Bridge status window", () => {
  let renderCalls;

  beforeEach(() => {
    renderCalls = [];
    class ApplicationV2 {
      render = vi.fn(async (options) => {
        renderCalls.push(options);
      });

      async _onRender() {}

      _onClose() {}
    }
    globalThis.foundry = /** @type {any} */ ({
      applications: {
        api: { ApplicationV2, HandlebarsApplicationMixin: (Base) => class extends Base {} }
      }
    });
    stubGame();
    stubBridge({
      status: "connected",
      url: "ws://127.0.0.1:47833",
      helloAcknowledged: true,
      hasEstablishedSession: true,
      lastConnectedAt: "2026-08-12T10:00:00.000Z",
      reconnectAttempts: 2,
      terminalStopReason: null
    });
  });

  afterEach(() => {
    delete globalThis.game;
    delete globalThis.foundry;
    delete globalThis.foundryCliBridge;
  });

  it("uses the ApplicationV2 Handlebars contract with a localizable title", () => {
    const BridgeStatusApplication = createBridgeStatusApplication();

    expect(BridgeStatusApplication.DEFAULT_OPTIONS).toMatchObject({
      id: "fvtt-world-cli-bridge-status",
      window: { title: "FVTTWORLDCLI.BridgeStatus.Title" }
    });
    expect(BridgeStatusApplication.PARTS.status.template).toBe(
      "modules/fvtt-world-cli/templates/bridge-status.hbs"
    );
    expect(BridgeStatusApplication.prototype).toBeInstanceOf(
      globalThis.foundry.applications.api.ApplicationV2
    );
  });

  it("reports the stored connection detail of the live bridge in one connection row", () => {
    expect(prepareBridgeStatusContext()).toEqual({
      displayState: "connected",
      connectionLabel: "Connected",
      paired: true,
      url: "ws://127.0.0.1:47833",
      lastConnectedAt: "2026-08-12T10:00:00.000Z",
      reconnectAttempts: 2,
      terminalStopReason: "",
      protocolVersionMismatch: null
    });
  });

  it.each([
    ["module", "1.0.0", "9.9.0", "9.9.0", "module"],
    ["cliDaemon", "1.1.0", "3.0", "3.0, from release 1.0.0", "cli-daemon"],
    ["unknown", "1.1.0", "next-dev", "next-dev", "unknown"]
  ])(
    "names both versions and the remedy while the bridge is stopped over a %s release gap",
    (leaf, expectedVersion, actualVersion, shownActualVersion, staleComponent) => {
      stubBridge({
        status: "stopped",
        url: "ws://127.0.0.1:47833",
        helloAcknowledged: false,
        terminalStopReason: "UNSUPPORTED_PROTOCOL_VERSION",
        protocolVersionMismatch: { expectedVersion, actualVersion, staleComponent }
      });

      expect(prepareBridgeStatusContext()).toMatchObject({
        displayState: "offline",
        terminalStopReason: "UNSUPPORTED_PROTOCOL_VERSION",
        protocolVersionMismatch: {
          expectedVersion,
          actualVersion: shownActualVersion,
          staleComponent: localizeEnglish(`FVTTWORLDCLI.BridgeStatus.VersionMismatch.Component.${leaf}`),
          remedy: localizeEnglish(`FVTTWORLDCLI.BridgeStatus.VersionMismatch.Advice.${leaf}`)
        }
      });
    }
  );

  it("reports an unpaired browser that has no bridge instance", () => {
    stubGame({ paired: false });
    delete globalThis.foundryCliBridge;

    expect(prepareBridgeStatusContext()).toMatchObject({
      displayState: "unpaired",
      connectionLabel: "Not paired",
      paired: false,
      url: "",
      reconnectAttempts: 0
    });
  });

  it("reports an offline bridge without a parenthetical when no client exists", () => {
    delete globalThis.foundryCliBridge;

    expect(prepareBridgeStatusContext()).toMatchObject({
      displayState: "offline",
      connectionLabel: "Offline"
    });
  });

  it("re-renders while open and stops listening once closed", async () => {
    const BridgeStatusApplication = createBridgeStatusApplication();
    const app = new BridgeStatusApplication();

    await app._onRender({}, {});
    publishStatus({ status: "reconnecting" });
    expect(renderCalls).toEqual([{ force: false }]);

    await app._onRender({}, {});
    publishStatus({ status: "connected" });
    expect(renderCalls).toEqual([{ force: false }, { force: false }]);

    app._onClose({});
    publishStatus({ status: "stopped" });
    expect(renderCalls).toHaveLength(2);
  });
});

describe("Bridge Status window markup", () => {
  const template = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "bridge-status.hbs"),
    "utf8"
  );

  it("names the connection state in one row without a glyph column", () => {
    expect(template).toContain('class="fvtt-world-cli-status--{{displayState}}"');
    expect(template).toContain("{{connectionLabel}}");
    expect(template).not.toContain("{{glyph}}");
    expect(template).not.toContain("fa-plug");
  });

  it("no longer carries a separate handshake or raw status row", () => {
    expect(template).not.toContain("Handshake");
    expect(template).not.toContain("ClientStatus");
    expect(template).not.toContain("helloAcknowledged");
  });

  it("keeps read-only rows out of the interactive label hover styling", () => {
    const rows = template.match(/<div class="form-group[^"]*"/g) ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toContain("fvtt-world-cli-readonly");
  });
});
