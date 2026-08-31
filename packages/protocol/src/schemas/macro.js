import { MACRO_EXECUTE_TIMEOUT_MAX_MS } from "../constants.js";
import { ownershipLevelSchema, ownershipSetSchema } from "./ownership-users.js";
import {
  batchIdsProperty,
  cmd,
  compendiumImportSchema,
  dryRunProperty,
  freeformObjectSchema,
  idempotencyKeyProperty,
  nameFilteredListSchema,
  nullableStringSchema,
  patchFrom
} from "./shared.js";

const macroTypeSchema = { type: "string", enum: ["script", "chat"] };

const macroScopeSchema = { type: "string", enum: ["global", "actors", "actor"] };

const macroDataSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    type: macroTypeSchema,
    command: { type: "string" },
    img: { type: "string", minLength: 1 },
    folder: nullableStringSchema,
    scope: macroScopeSchema,
    flags: freeformObjectSchema
  },
  additionalProperties: false
};

const macroPatchSchema = patchFrom(macroDataSchema);

const macroExecuteArgsSchema = {
  ...freeformObjectSchema,
  propertyNames: { pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$" }
};

const macroExecuteScopeSchema = {
  type: "object",
  required: [],
  properties: {
    actorId: { type: "string", minLength: 1 },
    sceneId: { type: "string", minLength: 1 },
    tokenId: { type: "string", minLength: 1 },
    args: macroExecuteArgsSchema
  },
  additionalProperties: false,
  minProperties: 1
};

const macroIdSchema = {
  type: "object",
  required: ["macroId"],
  properties: {
    macroId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};

export const macroCommands = {
  "macro.list": cmd(nameFilteredListSchema),
  "macro.get": cmd(macroIdSchema),
  "macro.get-many": cmd({
    type: "object",
    required: ["ids"],
    properties: { ...batchIdsProperty },
    additionalProperties: false
  }),
  "macro.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: macroDataSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "macro.update": cmd(
    {
      type: "object",
      required: ["macroId", "patch"],
      properties: {
        macroId: { type: "string", minLength: 1 },
        patch: macroPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "macro.delete": cmd(
    {
      type: "object",
      required: ["macroId"],
      properties: {
        macroId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "macro.clone": cmd(
    {
      type: "object",
      required: ["macroId"],
      properties: {
        macroId: { type: "string", minLength: 1 },
        patch: macroPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "macro.execute": cmd(
    {
      type: "object",
      required: ["macroId"],
      properties: {
        macroId: { type: "string", minLength: 1 },
        scope: macroExecuteScopeSchema,
        timeoutMs: { type: "integer", minimum: 1, maximum: MACRO_EXECUTE_TIMEOUT_MAX_MS },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "macro.import-from-compendium": cmd(compendiumImportSchema(macroPatchSchema), { mutation: true }),
  "macro.ownership.set": cmd(ownershipSetSchema("macroId", { levelSchema: ownershipLevelSchema }), {
    mutation: true
  })
};
