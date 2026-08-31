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

    async "chat.flush"(params) {
      const messages = getMessagesCollection();
      const count = messages.size ?? Array.from(messages).length;

      const DocumentClass = messages.documentClass ?? globalThis.ChatMessage;
      if (typeof DocumentClass?.deleteDocuments !== "function") {
        throw createBridgeError(
          ERROR_CODES.BRIDGE_NOT_READY,
          "Foundry chat deletion API (ChatMessage.deleteDocuments) is not available; reload the GM client"
        );
      }

      if (isDryRun(params)) {
        return dryRunResponse({ deleted: 0, count, remaining: count });
      }

      await DocumentClass.deleteDocuments([], { deleteAll: true });

      const remaining = getMessagesCollection().size ?? Array.from(getMessagesCollection()).length;
      if (remaining > 0) {
        throw createBridgeError(
          ERROR_CODES.INTERNAL_ERROR,
          `Foundry accepted the chat flush and the log still holds ${remaining} of ${count} message(s), so the ` +
            `deletion is unconfirmed and may have landed in part. Re-read the log with \`chat list\` before ` +
            `retrying`,
          { count, remaining }
        );
      }

      return { deleted: count, count, remaining: 0 };
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
