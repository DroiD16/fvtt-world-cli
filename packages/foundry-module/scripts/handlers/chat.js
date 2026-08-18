import {
  createChatMessage,
  evaluateChatRoll,
  getChatMessageById,
  previewChatMessageCreate
} from "../lib/chat-docs.js";
import { getMessagesCollection } from "../lib/game-collections.js";
import { deleteDocument } from "../lib/world-docs.js";
import { createBridgeError } from "../lib/errors.js";
import { ERROR_CODES } from "../generated/protocol.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { canonicalizeFilePathFields } from "../lib/file-access.js";
import { paginate, serializeChatMessage, serializeChatMessageSummary } from "../lib/serializers.js";

async function buildChatMessageData(params) {
  const data = canonicalizeFilePathFields({ ...params.data }, "ChatMessage");

  if (data.author === undefined || data.author === null) {
    data.author = globalThis.game?.user?.id ?? null;
  }

  if (data.speaker === undefined || data.speaker === null) {
    const ChatMessageClass = globalThis.ChatMessage;
    if (typeof ChatMessageClass?.getSpeaker === "function") {
      data.speaker = ChatMessageClass.getSpeaker({ user: globalThis.game?.user });
    }
  }

  if (params.roll?.formula) {
    const roll = await evaluateChatRoll(params.roll.formula);
    data.rolls = [roll.toJSON()];
  }

  if (!params.roll && !(typeof data.content === "string" && data.content.trim())) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      "A chat message must have content or a roll formula; provide `data.content` or `roll.formula`",
      { reason: "empty_message" }
    );
  }

  return data;
}

export function createChatHandlers() {
  return {
    async "chat.list"(params) {
      const all = Array.from(getMessagesCollection()).reverse();
      const { page, total, hasMore } = paginate(all, params);
      return {
        messages: page.map((m) => serializeChatMessageSummary(m)),
        total,
        hasMore
      };
    },

    async "chat.get"(params) {
      const message = getChatMessageById(params.messageId);
      return { message: serializeChatMessage(message) };
    },

    async "chat.create"(params) {
      const data = await buildChatMessageData(params);
      if (isDryRun(params)) {
        const preview = previewChatMessageCreate(data);
        return dryRunResponse({ message: serializeChatMessage(preview) });
      }
      const message = await createChatMessage(data);
      return { message: serializeChatMessage(message) };
    },

    async "chat.delete"(params) {
      const message = getChatMessageById(params.messageId);
      const id = message.id ?? params.messageId;
      if (isDryRun(params)) {
        return dryRunResponse({ id, deleted: false });
      }
      await deleteDocument(message);
      return { id, deleted: true };
    }
  };
}
