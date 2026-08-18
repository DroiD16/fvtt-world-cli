import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

import { getMessagesCollection } from "./game-collections.js";
import { createWorldDocument, previewDocumentCreate, resolveWorldDocumentClass } from "./world-docs.js";

export function getChatMessageById(messageId) {
  const message = getMessagesCollection().get?.(messageId) ?? null;
  if (!message) {
    throw createBridgeError(
      ERROR_CODES.CHAT_MESSAGE_NOT_FOUND,
      `ChatMessage ${messageId} was not found; use chat.list to find valid ids`,
      { messageId }
    );
  }
  return message;
}

export async function createChatMessage(data) {
  return createWorldDocument("ChatMessage", data);
}

export function previewChatMessageCreate(data) {
  return previewDocumentCreate(resolveWorldDocumentClass("ChatMessage"), data);
}

export async function evaluateChatRoll(formula) {
  const RollClass = globalThis.Roll;
  if (typeof RollClass !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Foundry Roll API is not available");
  }
  let roll;
  try {
    roll = new RollClass(formula);
    await roll.evaluate();
  } catch (error) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `Invalid roll formula "${formula}": ${/** @type {any} */ (error)?.message ?? "could not be parsed"}`,
      { formula, reason: "invalid_roll_formula" }
    );
  }
  return roll;
}
