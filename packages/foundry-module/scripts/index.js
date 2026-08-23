import { BridgeClient } from "./bridge-client.js";
import {
  DEFAULT_DAEMON_URL,
  DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
  DEFAULT_WS_MAX_PAYLOAD_BYTES,
  DISCOVERABLE_COMMAND_NAMES,
  MODULE_ID,
  MODULE_TITLE
} from "./generated/protocol.js";
import { createCommandRouter } from "./command-router.js";
import { createAuthorizationApplication, ensureClientId, getCurrentCredential } from "./authorization.js";
import { createBridgeStatusApplication, registerSceneControls } from "./scene-controls.js";
import { getNotPairedWarningMessage, warnBridgeDisabled } from "./lib/startup.js";
import { publishStatus } from "./lib/status-signal.js";
import { MODULE_SETTING_KEYS, getBridgeSettings } from "./lib/validators.js";

const DEFAULT_EFFECTIVE_LIMITS = Object.freeze({
  uploadBytes: DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
  wsMaxPayloadBytes: DEFAULT_WS_MAX_PAYLOAD_BYTES
});

function log(level, message, details = {}) {
  const prefix = `[${MODULE_TITLE}]`;
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

function getModuleVersion() {
  return globalThis.game?.modules?.get?.(MODULE_ID)?.version ?? "0.0.0";
}

function handleStatusChange(snapshot) {
  publishStatus(snapshot);
  globalThis.Hooks?.callAll?.(`${MODULE_ID}.statusChanged`, snapshot);
}

function createBridgeRuntime(credential, clientId) {
  const settings = getBridgeSettings();

  let bridgeClient = null;
  const router = createCommandRouter({
    bridgeClient: {
      getStatus: () => bridgeClient?.getStatus() ?? { status: "starting" },

      getEffectiveLimits: () => bridgeClient?.getEffectiveLimits() ?? DEFAULT_EFFECTIVE_LIMITS,

      getLimitsInfo: () =>
        bridgeClient?.getLimitsInfo?.() ?? {
          ...DEFAULT_EFFECTIVE_LIMITS,
          uploadSource: "default"
        }
    }
  });

  bridgeClient = new BridgeClient({
    url: settings.daemonUrl,
    pairingId: credential.pairingId,
    credential: credential.credential,
    clientId,
    router,
    logger: log,
    onStatusChange: handleStatusChange,
    getSession: () => ({
      moduleId: MODULE_ID,
      moduleVersion: getModuleVersion(),
      world: {
        id: globalThis.game.world?.id ?? "unknown-world",
        title: globalThis.game.world?.title ?? "Unknown World"
      },
      user: {
        id: globalThis.game.user?.id ?? "unknown-user",
        name: globalThis.game.user?.name ?? "Unknown User",
        isGM: Boolean(globalThis.game.user?.isGM)
      },
      commands: DISCOVERABLE_COMMAND_NAMES
    })
  });

  return bridgeClient;
}

function registerSettings() {
  globalThis.game.settings.register(MODULE_ID, MODULE_SETTING_KEYS.DAEMON_URL, {
    name: "FVTTWORLDCLI.Settings.DaemonUrlName",
    hint: "FVTTWORLDCLI.Settings.DaemonUrlHint",
    scope: "client",
    config: true,
    type: String,
    default: DEFAULT_DAEMON_URL
  });

  globalThis.game.settings.register(MODULE_ID, MODULE_SETTING_KEYS.AUTO_CONNECT, {
    name: "FVTTWORLDCLI.Settings.AutoConnectName",
    hint: "FVTTWORLDCLI.Settings.AutoConnectHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  globalThis.game.settings.register(MODULE_ID, MODULE_SETTING_KEYS.CREDENTIALS, {
    name: "FVTTWORLDCLI.Settings.CredentialsName",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  globalThis.game.settings.register(MODULE_ID, MODULE_SETTING_KEYS.CLIENT_ID, {
    name: "FVTTWORLDCLI.Settings.ClientIdName",
    scope: "client",
    config: false,
    type: String,
    default: ""
  });

  const AuthorizationApplication = createAuthorizationApplication({ connect: startBridge });
  globalThis.game.settings.registerMenu(MODULE_ID, "authorization", {
    name: "FVTTWORLDCLI.Settings.AuthorizationName",
    label: "FVTTWORLDCLI.Settings.AuthorizationLabel",
    hint: "FVTTWORLDCLI.Settings.AuthorizationHint",
    icon: "fa-solid fa-key-skeleton",
    type: AuthorizationApplication,
    restricted: true
  });

  const BridgeStatusApplication = createBridgeStatusApplication();
  globalThis.game.settings.registerMenu(MODULE_ID, "bridgeStatus", {
    name: "FVTTWORLDCLI.BridgeStatus.MenuName",
    label: "FVTTWORLDCLI.BridgeStatus.MenuLabel",
    hint: "FVTTWORLDCLI.BridgeStatus.MenuHint",
    icon: "fa-solid fa-plug",
    type: BridgeStatusApplication,
    restricted: true
  });

  registerSceneControls({ AuthorizationApplication, BridgeStatusApplication, startBridge });
}

async function deleteLegacyWorldSettings() {
  const storage = globalThis.game.settings.storage?.get?.("world");
  for (const key of [`${MODULE_ID}.authToken`, `${MODULE_ID}.daemonUrl`]) {
    const setting = storage?.getSetting?.(key);
    if (setting?.delete) await setting.delete();
  }
}

let bridgeStartGeneration = 0;

async function startBridge(credential = getCurrentCredential()) {
  const generation = ++bridgeStartGeneration;
  globalThis.foundryCliBridge?.stop?.();
  if (!credential) return;
  const clientId = await ensureClientId();
  // Only the newest start may install a client: an overtaken one is never stopped here, so
  // starting it anyway would leave two clients racing for the slot and publishing conflicting status.
  if (generation !== bridgeStartGeneration) return;
  const bridgeClient = createBridgeRuntime(credential, clientId);
  globalThis.foundryCliBridge = bridgeClient;
  bridgeClient.start();
}

Hooks.once("init", () => {
  registerSettings();
  log("info", "Registered World CLI for Foundry VTT settings");
});

Hooks.once("ready", async () => {
  if (!globalThis.game.user?.isGM) {
    log("info", "Skipping bridge startup for non-GM user");
    return;
  }

  await deleteLegacyWorldSettings();
  if (!getBridgeSettings().autoConnect) {
    log("info", "Skipping bridge startup because auto-connect is disabled");
    return;
  }
  const credential = getCurrentCredential();
  if (!credential) {
    warnBridgeDisabled(log, getNotPairedWarningMessage(), {
      setting: MODULE_SETTING_KEYS.CREDENTIALS
    });
    return;
  }

  try {
    await startBridge(credential);
  } catch (error) {
    log("error", "Bridge startup failed", {
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});
