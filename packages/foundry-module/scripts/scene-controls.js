import { MODULE_ID } from "./generated/protocol.js";
import { getCurrentCredential } from "./authorization.js";
import {
  BRIDGE_ACTION_AVAILABILITY,
  DISPLAY_STATE_GLYPHS,
  DISPLAY_STATE_GLYPH_NAMES,
  DISPLAY_STATE_NAMES,
  describeConnection,
  describeProtocolVersionMismatch,
  resolveDisplayState
} from "./lib/bridge-status.js";
import { format, localize } from "./lib/i18n.js";
import { subscribeStatus, withStatusRefresh } from "./lib/status-signal.js";

const CONTROL_GROUP = MODULE_ID;
const STATUS_CLASS_PREFIX = `${MODULE_ID}-status--`;
const GROUP_ICON = "fa-solid fa-terminal";
const STATUS_TOOL = "status";

export function readDisplayState() {
  return resolveDisplayState(getCurrentCredential(), globalThis.foundryCliBridge?.getStatus?.());
}

export function prepareBridgeStatusContext() {
  const credential = getCurrentCredential();
  const bridgeStatus = globalThis.foundryCliBridge?.getStatus?.() ?? null;
  const displayState = resolveDisplayState(credential, bridgeStatus);
  return {
    displayState,
    connectionLabel: describeConnection(displayState, bridgeStatus?.status),
    paired: Boolean(credential),
    url: bridgeStatus?.url ?? "",
    lastConnectedAt: bridgeStatus?.lastConnectedAt ?? "",
    reconnectAttempts: bridgeStatus?.reconnectAttempts ?? 0,
    terminalStopReason: bridgeStatus?.terminalStopReason ?? "",
    protocolVersionMismatch: describeProtocolVersionMismatch(bridgeStatus?.protocolVersionMismatch)
  };
}

export function createBridgeStatusApplication() {
  const { ApplicationV2, HandlebarsApplicationMixin } = globalThis.foundry.applications.api;

  return class BridgeStatusApplication extends withStatusRefresh(HandlebarsApplicationMixin(ApplicationV2)) {
    static DEFAULT_OPTIONS = {
      id: "fvtt-world-cli-bridge-status",
      window: {
        title: "FVTTWORLDCLI.BridgeStatus.Title",
        icon: "fa-solid fa-plug",
        contentClasses: ["standard-form"]
      },
      position: { width: 480 }
    };

    static PARTS = {
      status: {
        template: "modules/fvtt-world-cli/templates/bridge-status.hbs"
      }
    };

    async _prepareContext() {
      return prepareBridgeStatusContext();
    }
  };
}

/** @param {Record<string, any>} controls */
function nextControlOrder(controls) {
  const orders = Object.values(controls)
    .map((control) => control?.order)
    .filter((order) => Number.isFinite(order));
  return orders.length ? Math.max(...orders) + 1 : 0;
}

/** @param {any} ApplicationClass */
function openApplication(ApplicationClass) {
  const id = ApplicationClass.DEFAULT_OPTIONS?.id;
  const existing = id ? globalThis.foundry?.applications?.instances?.get?.(id) : null;
  const application = existing instanceof ApplicationClass ? existing : new ApplicationClass();
  return application.render({ force: true });
}

/**
 * @param {any} button
 * @param {string} displayState
 */
function applyStatusClasses(button, displayState) {
  for (const name of DISPLAY_STATE_NAMES) button.classList.remove(`${STATUS_CLASS_PREFIX}${name}`);
  button.classList.add(`${STATUS_CLASS_PREFIX}${displayState}`);
}

export function createSceneControls({ AuthorizationApplication, BridgeStatusApplication, startBridge }) {
  /** @type {any} */
  let statusTool = null;

  const openAuthorization = () => openApplication(AuthorizationApplication);

  const openBridgeStatus = () => openApplication(BridgeStatusApplication);

  const openModuleSettings = async () => {
    const sheet = globalThis.game?.settings?.sheet;
    if (!sheet) return;
    await sheet.render({ force: true });
    try {
      sheet.changeTab(MODULE_ID, "categories");
    } catch {
      // changeTab throws when this module has no settings category; the unfocused sheet is the fallback.
    }
  };

  const disconnectBridge = () => {
    globalThis.foundryCliBridge?.stop?.();
  };

  const connectBridge = async () => {
    const credential = getCurrentCredential();
    if (!credential) {
      globalThis.ui?.notifications?.warn?.(localize("FVTTWORLDCLI.Notifications.ConnectUnpaired"));
      await openAuthorization();
      return;
    }

    try {
      await startBridge(credential);
    } catch (error) {
      globalThis.ui?.notifications?.error?.(
        format("FVTTWORLDCLI.Notifications.BridgeConnectFailed", {
          error: error instanceof Error ? error.message : String(error)
        }),
        { permanent: true }
      );
    }
  };

  const addControls = (controls) => {
    const tools = {
      status: {
        name: STATUS_TOOL,
        title: "FVTTWORLDCLI.Controls.Status",
        icon: `fa-solid ${DISPLAY_STATE_GLYPHS[readDisplayState()]}`,
        button: true,
        order: 0,
        onChange: () => {
          void openBridgeStatus();
        }
      },
      connect: {
        name: "connect",
        title: "FVTTWORLDCLI.Controls.Connect",
        icon: "fa-solid fa-plug-circle-bolt",
        button: true,
        order: 1,
        onChange: () => {
          void connectBridge();
        }
      },
      disconnect: {
        name: "disconnect",
        title: "FVTTWORLDCLI.Controls.Disconnect",
        icon: "fa-solid fa-plug-circle-minus",
        button: true,
        order: 2,
        onChange: () => {
          disconnectBridge();
        }
      },
      authorization: {
        name: "authorization",
        title: "FVTTWORLDCLI.Controls.Authorization",
        icon: "fa-solid fa-key-skeleton",
        button: true,
        order: 3,
        onChange: () => {
          void openAuthorization();
        }
      },
      settings: {
        name: "settings",
        title: "FVTTWORLDCLI.Controls.Settings",
        icon: "fa-solid fa-gear",
        button: true,
        order: 4,
        onChange: () => {
          void openModuleSettings();
        }
      }
    };

    statusTool = tools.status;
    controls[CONTROL_GROUP] = {
      name: CONTROL_GROUP,
      title: "FVTTWORLDCLI.Controls.Group",
      icon: GROUP_ICON,
      visible: Boolean(globalThis.game?.user?.isGM),
      order: nextControlOrder(controls),
      tools
    };
  };

  const applyStatusIndicator = (_application, element) => {
    const displayState = readDisplayState();
    const groupButton = element?.querySelector?.(`button.control[data-control="${CONTROL_GROUP}"]`);
    if (groupButton) applyStatusClasses(groupButton, displayState);
    if (globalThis.ui?.controls?.control?.name !== CONTROL_GROUP) return;

    const statusButton = element?.querySelector?.(`button.tool[data-tool="${STATUS_TOOL}"]`);
    if (statusButton) {
      applyStatusClasses(statusButton, displayState);
      for (const glyph of DISPLAY_STATE_GLYPH_NAMES) statusButton.classList.remove(glyph);
      statusButton.classList.add(DISPLAY_STATE_GLYPHS[displayState]);
    }

    for (const [name, enabled] of Object.entries(BRIDGE_ACTION_AVAILABILITY[displayState])) {
      const actionButton = element?.querySelector?.(`button.tool[data-tool="${name}"]`);
      if (!actionButton) continue;
      if (enabled) actionButton.removeAttribute("disabled");
      else actionButton.setAttribute("disabled", "");
    }
  };

  const handleStatusChange = () => {
    if (statusTool) statusTool.icon = `fa-solid ${DISPLAY_STATE_GLYPHS[readDisplayState()]}`;
    const controls = globalThis.ui?.controls;
    if (controls?.rendered) applyStatusIndicator(null, controls.element);
  };

  return { addControls, applyStatusIndicator, handleStatusChange };
}

export function registerSceneControls(dependencies) {
  const sceneControls = createSceneControls(dependencies);
  globalThis.Hooks.on("getSceneControlButtons", sceneControls.addControls);
  globalThis.Hooks.on("renderSceneControls", sceneControls.applyStatusIndicator);
  subscribeStatus(sceneControls.handleStatusChange);
  return sceneControls;
}
