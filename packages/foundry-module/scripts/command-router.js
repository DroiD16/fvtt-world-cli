import {
  COMMAND_DEFINITIONS,
  ERROR_CODES,
  MESSAGE_TYPES,
  PROTOCOL_COMPONENTS,
  PROTOCOL_HANDSHAKES,
  PROTOCOL_VERSION,
  createCommandResponse,
  createErrorResponse,
  getInvalidCommandError,
  getInvalidMessageError,
  getProtocolVersionError,
  isKnownCommand
} from "./generated/protocol.js";
import { createActorEffectHandlers } from "./handlers/actor-effects.js";
import { createAuditHandlers } from "./handlers/audit.js";
import { createActorItemEffectHandlers } from "./handlers/actor-item-effects.js";
import { createActorItemHandlers } from "./handlers/actor-items.js";
import { createActorHandlers } from "./handlers/actors.js";
import { createCardsHandlers } from "./handlers/cards.js";
import { createChatHandlers } from "./handlers/chat.js";
import { createCombatHandlers } from "./handlers/combats.js";
import { createCompendiumHandlers } from "./handlers/compendium.js";
import { createCompendiumImportHandlers } from "./handlers/compendium-imports.js";
import { createItemEffectHandlers } from "./handlers/item-effects.js";
import { createSceneTokenEffectHandlers } from "./handlers/scene-token-effects.js";
import { createFileHandlers } from "./handlers/files.js";
import { createFolderHandlers } from "./handlers/folders.js";
import { createItemHandlers } from "./handlers/items.js";
import { createJournalHandlers } from "./handlers/journals.js";
import { createMacroHandlers } from "./handlers/macros.js";
import { createOwnershipHandlers } from "./handlers/ownership.js";
import { createPlaylistHandlers } from "./handlers/playlists.js";
import { createUserHandlers } from "./handlers/users.js";
import { createSceneSoundHandlers } from "./handlers/scene-sounds.js";
import { createSceneTileHandlers } from "./handlers/scene-tiles.js";
import { createSceneWallHandlers } from "./handlers/scene-walls.js";
import { createSceneNoteHandlers } from "./handlers/scene-notes.js";
import { createSceneDrawingHandlers } from "./handlers/scene-drawings.js";
import { createSceneLightHandlers } from "./handlers/scene-lights.js";
import { createSceneTemplateHandlers } from "./handlers/scene-templates.js";
import { createSceneRegionHandlers } from "./handlers/scene-regions.js";
import { createSceneFogHandlers } from "./handlers/scene-fog.js";
import { createSceneThumbnailHandlers } from "./handlers/scene-thumbnails.js";
import { createSceneTokenItemEffectHandlers } from "./handlers/scene-token-item-effects.js";
import { createSceneTokenItemHandlers } from "./handlers/scene-token-items.js";
import { createSceneTokenHandlers } from "./handlers/scene-tokens.js";
import { createSceneHandlers } from "./handlers/scenes.js";
import { createSearchHandlers } from "./handlers/search.js";
import { createSettingHandlers } from "./handlers/settings.js";
import { createSystemHandlers } from "./handlers/system.js";
import { createTableHandlers, withQueuedTableOwnership } from "./handlers/tables.js";
import {
  createBridgeError,
  isFoundryValidationError,
  toFoundryValidationError,
  toProtocolError
} from "./lib/errors.js";
import { assertFoundryReady, assertWritePermission, validateCommandParams } from "./lib/validators.js";

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createCommandRouter({ bridgeClient }) {
  const handlers = /** @type {Record<string, (params: any, context: any) => Promise<any>>} */ ({
    ...createActorHandlers(),
    ...createActorItemHandlers(),
    ...createActorEffectHandlers(),
    ...createAuditHandlers(),
    ...createActorItemEffectHandlers(),
    ...createItemEffectHandlers(),
    ...createSceneTokenEffectHandlers(),
    ...createCardsHandlers(),
    ...createChatHandlers(),
    ...createCombatHandlers(),
    ...createCompendiumHandlers(),
    ...createFolderHandlers(),
    ...createFileHandlers(),
    ...createJournalHandlers(),
    ...createMacroHandlers(),

    ...withQueuedTableOwnership(createOwnershipHandlers()),
    ...createUserHandlers(),

    ...createSettingHandlers(),

    ...createSearchHandlers(),
    ...createPlaylistHandlers(),
    ...createTableHandlers(),
    ...createSystemHandlers({ bridgeClient }),
    ...createSceneHandlers(),
    ...createSceneThumbnailHandlers(),
    ...createSceneFogHandlers(),
    ...createSceneTokenHandlers(),
    ...createSceneTokenItemHandlers(),
    ...createSceneTokenItemEffectHandlers(),
    ...createSceneTileHandlers(),
    ...createSceneWallHandlers(),
    ...createSceneNoteHandlers(),
    ...createSceneDrawingHandlers(),
    ...createSceneLightHandlers(),
    ...createSceneTemplateHandlers(),
    ...createSceneRegionHandlers(),
    ...createSceneSoundHandlers(),
    ...createItemHandlers(),

    ...createCompendiumImportHandlers()
  });

  /**
   * @param {{ command: string, params: any, messageId: string }} request
   */
  async function executeGuardedCommand({ command, params, messageId }) {
    try {
      assertFoundryReady();
      if (!globalThis.game?.user?.isGM) {
        throw createBridgeError(
          ERROR_CODES.PERMISSION_DENIED,
          `Command ${command} requires a current GM session`,
          { command }
        );
      }
      validateCommandParams(command, params, COMMAND_DEFINITIONS);
      assertWritePermission(command);

      const handler = handlers[command];
      if (!handler) {
        return createErrorResponse({
          id: messageId,
          error: getInvalidCommandError(command)
        });
      }

      const result = await handler(params, { bridgeClient });
      return createCommandResponse({ id: messageId, result });
    } catch (error) {
      const bridgeError = /** @type {any} */ (error);

      let protocolError;
      if (isFoundryValidationError(error)) {
        protocolError = toFoundryValidationError(error);
      } else {
        protocolError = toProtocolError(bridgeError);
      }

      if (protocolError.code === ERROR_CODES.INTERNAL_ERROR) {
        console.error(`[fvtt-world-cli] command ${command} failed:`, error);
      }

      return createErrorResponse({
        id: messageId,
        error: protocolError
      });
    }
  }

  return {
    executeGuardedCommand,

    async route(message) {
      if (!isPlainObject(message)) {
        return createErrorResponse({
          id: "unknown",
          error: getInvalidMessageError(["Message must be an object"])
        });
      }

      const messageId = typeof message.id === "string" && message.id ? message.id : "unknown";

      if (message.protocolVersion !== PROTOCOL_VERSION) {
        return createErrorResponse({
          id: messageId,
          error: getProtocolVersionError(message.protocolVersion, {
            peer: PROTOCOL_COMPONENTS.CLI_DAEMON,
            reporter: PROTOCOL_COMPONENTS.MODULE,
            handshake: PROTOCOL_HANDSHAKES.COMMAND_REQUEST
          })
        });
      }

      if (message.type !== MESSAGE_TYPES.COMMAND_REQUEST) {
        return createErrorResponse({
          id: messageId,
          error: getInvalidMessageError([`Unsupported message type: ${message.type}`])
        });
      }

      if (typeof message.id !== "string" || !message.id) {
        return createErrorResponse({
          id: "unknown",
          error: getInvalidMessageError(["Message id must be a non-empty string"])
        });
      }

      if (typeof message.command !== "string" || !message.command) {
        return createErrorResponse({
          id: messageId,
          error: getInvalidMessageError(["Message command must be a non-empty string"])
        });
      }

      if (!Object.hasOwn(message, "params")) {
        return createErrorResponse({
          id: messageId,
          error: getInvalidMessageError(["Message params are required"])
        });
      }

      if (!isKnownCommand(message.command)) {
        return createErrorResponse({
          id: messageId,
          error: getInvalidCommandError(message.command)
        });
      }

      return executeGuardedCommand({
        command: message.command,
        params: message.params,
        messageId
      });
    }
  };
}
