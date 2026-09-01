import {
  cmd,
  dryRunProperty,
  freeformObjectSchema,
  idempotencyKeyProperty,
  nameFilteredListSchema,
  nullableStringSchema,
  patchFrom
} from "./shared.js";

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

export const userRoleSchema = { type: "integer", enum: [1, 2, 3, 4] };

const userDataSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    role: userRoleSchema,
    color: { type: "string", minLength: 1 },
    pronouns: { type: "string" },
    avatar: nullableStringSchema,
    character: nullableStringSchema,
    flags: freeformObjectSchema
  },
  additionalProperties: false
};

const userPatchSchema = patchFrom(userDataSchema, { omit: ["role"] });

const userPermissionsSchema = {
  type: "object",
  required: [],
  properties: {},
  additionalProperties: { type: ["boolean", "null"] },
  minProperties: 1
};

export const userCommands = {
  "user.list": cmd(nameFilteredListSchema),
  "user.get": cmd(userIdSchema),
  "user.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: userDataSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "user.update": cmd(
    {
      type: "object",
      required: ["userId", "patch"],
      properties: {
        userId: { type: "string", minLength: 1 },
        patch: userPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "user.delete": cmd(
    {
      type: "object",
      required: ["userId"],
      properties: {
        userId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "user.role.set": cmd(
    {
      type: "object",
      required: ["userId", "role"],
      properties: {
        userId: { type: "string", minLength: 1 },
        role: userRoleSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "user.permissions.set": cmd(
    {
      type: "object",
      required: ["userId", "permissions"],
      properties: {
        userId: { type: "string", minLength: 1 },
        permissions: userPermissionsSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};
