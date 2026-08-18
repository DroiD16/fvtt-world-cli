import { effectCreateSchema, effectPatchSchema } from "./effect-data.js";
import { itemDataSchema, itemPatchSchema } from "./item-data.js";
import { ownershipLevelSchema, ownershipSetSchema } from "./ownership-users.js";
import {
  batchIdsProperty,
  batchWriteCommands,
  cmd,
  compendiumImportSchema,
  dryRunProperty,
  emptyScopeProperties,
  idempotencyKeyProperty,
  includeProperty,
  itemScopeProperties,
  nameFilterProperty,
  nameFilteredListSchema,
  paginationProperties
} from "./shared.js";

export const itemCommands = {
  "item.list": cmd(nameFilteredListSchema),
  "item.get": cmd({
    type: "object",
    required: ["itemId"],
    properties: {
      itemId: { type: "string", minLength: 1 },
      ...includeProperty
    },
    additionalProperties: false
  }),
  "item.get-many": cmd({
    type: "object",
    required: ["ids"],
    properties: { ...batchIdsProperty, ...includeProperty },
    additionalProperties: false
  }),
  "item.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: itemDataSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty,
        ...includeProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "item.update": cmd(
    {
      type: "object",
      required: ["itemId", "patch"],
      properties: {
        itemId: { type: "string", minLength: 1 },
        patch: itemPatchSchema,
        ...dryRunProperty,
        ...includeProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "item.delete": cmd(
    {
      type: "object",
      required: ["itemId"],
      properties: {
        itemId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "item.clone": cmd(
    {
      type: "object",
      required: ["itemId"],
      properties: {
        itemId: { type: "string", minLength: 1 },
        patch: itemPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "item.import-from-compendium": cmd(compendiumImportSchema(itemPatchSchema), { mutation: true }),
  "item.ownership.set": cmd(ownershipSetSchema("itemId", { levelSchema: ownershipLevelSchema }), {
    mutation: true
  }),
  ...batchWriteCommands("item", {
    scopeProperties: emptyScopeProperties,
    patchSchema: itemPatchSchema,
    verbs: ["update-many", "delete-many"]
  }),
  "item.effect.list": cmd({
    type: "object",
    required: ["itemId"],
    properties: {
      itemId: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "item.effect.get": cmd({
    type: "object",
    required: ["itemId", "effectId"],
    properties: {
      itemId: { type: "string", minLength: 1 },
      effectId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "item.effect.create": cmd(
    {
      type: "object",
      required: ["itemId", "data"],
      properties: {
        itemId: { type: "string", minLength: 1 },
        data: effectCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "item.effect.update": cmd(
    {
      type: "object",
      required: ["itemId", "effectId", "patch"],
      properties: {
        itemId: { type: "string", minLength: 1 },
        effectId: { type: "string", minLength: 1 },
        patch: effectPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "item.effect.delete": cmd(
    {
      type: "object",
      required: ["itemId", "effectId"],
      properties: {
        itemId: { type: "string", minLength: 1 },
        effectId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "item.effect.clone": cmd(
    {
      type: "object",
      required: ["itemId", "effectId"],
      properties: {
        itemId: { type: "string", minLength: 1 },
        effectId: { type: "string", minLength: 1 },
        patch: effectPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  ...batchWriteCommands("item.effect", {
    scopeProperties: itemScopeProperties,
    createSchema: effectCreateSchema,
    patchSchema: effectPatchSchema
  })
};
