import { cmd, dryRunProperty, nameFilteredListSchema } from "./shared.js";

export const ownershipLevelSchema = { type: "integer", enum: [0, 1, 2, 3] };

export const journalOwnershipLevelSchema = { type: "integer", enum: [-1, 0, 1, 2, 3] };

function ownershipUsersSchema(levelSchema) {
  return {
    type: "object",
    required: [],
    properties: {},
    additionalProperties: levelSchema,
    minProperties: 1
  };
}

/**
 * @param {string} idField
 * @param {{ levelSchema: object, extraProperties?: Record<string, object> }} options
 */
export function ownershipSetSchema(idField, { levelSchema, extraProperties = {} }) {
  return {
    type: "object",
    required: [idField],
    properties: {
      [idField]: { type: "string", minLength: 1 },
      default: levelSchema,
      users: ownershipUsersSchema(levelSchema),
      ...extraProperties,
      ...dryRunProperty
    },
    additionalProperties: false
  };
}

const userIdSchema = {
  type: "object",
  required: ["userId"],
  properties: { userId: { type: "string", minLength: 1 } },
  additionalProperties: false
};

export const userCommands = {
  "user.list": cmd(nameFilteredListSchema),
  "user.get": cmd(userIdSchema)
};
