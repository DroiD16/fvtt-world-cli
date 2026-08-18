import {
  cmd,
  deepFreeze,
  dryRunProperty,
  freeformObjectSchema,
  idempotencyKeyProperty,
  paginatedListSchema
} from "./shared.js";

export const CHAT_CAPTURE_STATUSES = deepFreeze([
  "captured",
  "partial",
  "not-created",
  "not-requested",
  "unknown"
]);

const chatMessageCreateSchema = {
  type: "object",
  required: [],
  properties: {
    content: { type: "string" },
    speaker: freeformObjectSchema,
    whisper: { type: "array", items: { type: "string", minLength: 1 } },
    blind: { type: "boolean" },
    style: { type: "number", enum: [0, 1, 2, 3] }, // CHAT_MESSAGE_STYLES (verified v13)
    flavor: { type: "string" },
    sound: { type: "string", minLength: 1 },
    flags: freeformObjectSchema
  },
  additionalProperties: false
};

const chatRollSchema = {
  type: "object",
  required: ["formula"],
  properties: {
    formula: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};

const chatMessageIdSchema = {
  type: "object",
  required: ["messageId"],
  properties: {
    messageId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};

export const chatCommands = {
  "chat.list": cmd(paginatedListSchema),
  "chat.get": cmd(chatMessageIdSchema),
  "chat.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: chatMessageCreateSchema,
        roll: chatRollSchema, // OPTIONAL sibling of data (NOT a document field)
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "chat.delete": cmd(
    {
      type: "object",
      required: ["messageId"],
      properties: {
        messageId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};
