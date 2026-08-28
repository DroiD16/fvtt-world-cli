import {
  COMMAND_DEFINITIONS,
  DEFAULT_WS_MAX_PAYLOAD_BYTES,
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
import { createApprovalHandlers } from "./handlers/approval.js";
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
import { createPolicyHandlers } from "./handlers/policy.js";
import { createSystemHandlers } from "./handlers/system.js";
import { createTableHandlers, withQueuedTableOwnership } from "./handlers/tables.js";
import { ApprovalStore } from "./lib/approval-store.js";
import { resolveApprovalTargets } from "./lib/approval-targets.js";
import { isDryRun } from "./lib/dry-run.js";
import {
  createBridgeError,
  isFoundryValidationError,
  toFoundryValidationError,
  toProtocolError
} from "./lib/errors.js";
import { readStoredCommandPolicy, resolveCommandPolicy } from "./lib/policy.js";
import { assertFoundryReady, assertWritePermission, validateCommandParams } from "./lib/validators.js";

const COMMAND_DENIED_MESSAGE_TAIL =
  "Nothing was executed and no world state changed: the refusal happens before the command runs, in a " +
  "dry run exactly as in a real call. The verdict is terminal for this invocation, and it is not a " +
  "transient failure to retry or to route around with a different command that reaches the same effect. " +
  "Treat the command as unavailable, and report the refusal to the user: only a human editing that GM " +
  "client's command policy in Foundry can lift it.";

const APPROVAL_PENDING_MESSAGE_TAIL =
  "Nothing has executed yet and no world state has changed. The decision is a human one, taken in the " +
  "approval window of the GM client holding this bridge. Poll approval.await with details.approvalId to " +
  "wait for it: an Allow answers with the command's own response, and a denial, a timeout, or a confirmed " +
  "cancellation answers with a terminal error guaranteeing that the command never ran. A client that does " +
  "not implement that wait loop must treat this response as a failure and must not report the command as " +
  "done.";

const APPROVAL_QUEUE_FULL_MESSAGE_TAIL =
  "Nothing was displayed to the GM and nothing executed. The approval store bounds both the number of " +
  "decisions waiting for the GM and their combined weight, and it refuses a new request rather than " +
  "discard an outcome no client has read yet; a request whose frame weight could not be measured is " +
  "refused the same way. Retry once the GM has worked through the waiting decisions, or report to the " +
  "user that this command needs to be set to allow in that GM client's command policy.";

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSpreadableResult(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function withApprovalRequired(result) {
  if (!isSpreadableResult(result) || Object.hasOwn(result, "approvalRequired")) {
    return result;
  }

  return { ...result, approvalRequired: true };
}

export function createCommandRouter({ bridgeClient, approvalStoreOptions = {} }) {
  const approvalStore = new ApprovalStore({
    pendingByteBudgetProvider: () =>
      bridgeClient?.getEffectiveLimits?.()?.wsMaxPayloadBytes ?? DEFAULT_WS_MAX_PAYLOAD_BYTES,
    ...approvalStoreOptions,
    // The guarded path is what makes a delayed decision safe to run: this option is not replaceable.
    execute: ({ approvalId, command, params }) =>
      executeGuardedCommand({ command, params, messageId: approvalId, skipApprovalGate: true })
  });

  const handlers = /** @type {Record<string, (params: any, context: any) => Promise<any>>} */ ({
    ...createApprovalHandlers({ approvalStore }),
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
    ...createPolicyHandlers(),
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
   * @param {string} command
   * @param {any} params
   * @returns {unknown}
   */
  function resolveTargetsForDisplay(command, params) {
    try {
      return resolveApprovalTargets(command, params);
    } catch (error) {
      console.error(`[fvtt-world-cli] approval targets for ${command} could not be resolved:`, error);
      return null;
    }
  }

  /**
   * @param {{ command: string, params: any, measureRequestBytes?: () => number }} request
   * @returns {Error}
   */
  function admitForApproval({ command, params, measureRequestBytes }) {
    const admission = approvalStore.admit({
      command,
      params,
      resolveTargets: () => resolveTargetsForDisplay(command, params),
      requestBytes: /** @type {number} */ (measureRequestBytes?.())
    });

    if (!admission.admitted) {
      return createBridgeError(
        ERROR_CODES.APPROVAL_QUEUE_FULL,
        `Command ${command} was refused before it reached the GM of this bridge for approval. ` +
          APPROVAL_QUEUE_FULL_MESSAGE_TAIL,
        { command, reason: admission.reason }
      );
    }

    return createBridgeError(
      ERROR_CODES.APPROVAL_PENDING,
      `Command ${command} needs an approval from the GM of this bridge before it runs. ` +
        APPROVAL_PENDING_MESSAGE_TAIL,
      { approvalId: admission.approvalId, expiresAt: admission.expiresAt, command }
    );
  }

  /**
   * @param {{
   *   command: string,
   *   params: any,
   *   messageId: string,
   *   measureRequestBytes?: () => number,
   *   skipApprovalGate?: boolean
   * }} request
   */
  async function executeGuardedCommand({
    command,
    params,
    messageId,
    measureRequestBytes,
    skipApprovalGate = false
  }) {
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

      const dryRun = isDryRun(params);
      const policy = resolveCommandPolicy(readStoredCommandPolicy(), command, { dryRun });

      if (policy?.behavior === "deny") {
        throw createBridgeError(
          ERROR_CODES.COMMAND_DENIED,
          `Command ${command} is denied by the command policy of the GM client holding this bridge. ` +
            COMMAND_DENIED_MESSAGE_TAIL,
          { command }
        );
      }

      if (!skipApprovalGate && policy?.behavior === "approve") {
        throw admitForApproval({ command, params, measureRequestBytes });
      }

      const handler = handlers[command];
      if (!handler) {
        return createErrorResponse({
          id: messageId,
          error: getInvalidCommandError(command)
        });
      }

      const result = await handler(params, { bridgeClient });
      return createCommandResponse({
        id: messageId,
        result:
          dryRun && !skipApprovalGate && policy?.baseBehavior === "approve"
            ? withApprovalRequired(result)
            : result
      });
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
    approvalStore,
    executeGuardedCommand,

    /**
     * @param {any} message
     * @param {{ measureRequestBytes?: () => number }} [frame]
     */
    async route(message, { measureRequestBytes } = {}) {
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
        messageId,
        measureRequestBytes
      });
    }
  };
}
