import {
  DEFAULT_DAEMON_URL,
  ERROR_CODES,
  MODULE_ID,
  isWriteCommand,
  validateSchema
} from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

export const MODULE_SETTING_KEYS = Object.freeze({
  AUTH_TOKEN: "authToken",
  DAEMON_URL: "daemonUrl",
  CREDENTIALS: "credentials",
  CLIENT_ID: "clientId",
  AUTO_CONNECT: "autoConnect",
  COMMAND_POLICY: "commandPolicy",
  APPROVAL_TIMEOUT_MINUTES: "approvalTimeoutMinutes"
});

export function getGame() {
  if (!globalThis.game) {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Foundry game object is not ready");
  }

  return globalThis.game;
}

export function assertFoundryReady() {
  const game = getGame();

  if (!game.ready) {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Foundry game data is not ready");
  }

  return game;
}

export function assertWritePermission(command) {
  if (!isWriteCommand(command)) {
    return;
  }

  const game = getGame();
  if (!game.user?.isGM) {
    throw createBridgeError(ERROR_CODES.PERMISSION_DENIED, `Command ${command} requires a GM session`, {
      command
    });
  }
}

export function validateCommandParams(command, params, commandDefinitions) {
  const definition = commandDefinitions[command];
  const errors = validateSchema(definition.paramsSchema, params, "$.params");

  if (errors.length > 0) {
    throw createBridgeError(ERROR_CODES.INVALID_PARAMS, `Invalid params for ${command}`, {
      command,
      errors
    });
  }
}

export function getBridgeSettings() {
  const game = getGame();
  return {
    daemonUrl: game.settings.get(MODULE_ID, MODULE_SETTING_KEYS.DAEMON_URL) || DEFAULT_DAEMON_URL,
    credentials: game.settings.get(MODULE_ID, MODULE_SETTING_KEYS.CREDENTIALS) || {},
    clientId: game.settings.get(MODULE_ID, MODULE_SETTING_KEYS.CLIENT_ID) || "",
    autoConnect: game.settings.get(MODULE_ID, MODULE_SETTING_KEYS.AUTO_CONNECT) !== false
  };
}

export function assertBridgeSettingsConfigured(settings) {
  if (!settings.credential) {
    throw createBridgeError(ERROR_CODES.PAIRING_REQUIRED, "This browser, world, and GM user must be paired", {
      setting: MODULE_SETTING_KEYS.CREDENTIALS
    });
  }
}
