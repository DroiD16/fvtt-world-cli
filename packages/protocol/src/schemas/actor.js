import { effectCreateSchema, effectPatchSchema } from "./effect-data.js";
import { embeddedItemDataSchema, itemPatchSchema } from "./item-data.js";
import { ownershipLevelSchema, ownershipSetSchema } from "./ownership-users.js";
import {
  actorIncludeProperty,
  actorItemScopeProperties,
  actorScopeProperties,
  batchIdsProperty,
  batchWriteCommands,
  cmd,
  compendiumImportSchema,
  dryRunProperty,
  emptyScopeProperties,
  freeformObjectSchema,
  idempotencyKeyProperty,
  includeProperty,
  nameFilterProperty,
  nameFilteredListSchema,
  nullableStringSchema,
  paginationProperties,
  patchFrom
} from "./shared.js";

const actorDataSchema = {
  type: "object",
  required: ["name", "type"],
  properties: {
    name: { type: "string", minLength: 1 },
    type: { type: "string", minLength: 1 },
    img: { type: "string", minLength: 1 },
    folder: nullableStringSchema,
    sort: { type: "number" },
    system: freeformObjectSchema,
    prototypeToken: freeformObjectSchema,
    flags: freeformObjectSchema
  },
  additionalProperties: false
};

const actorPatchSchema = patchFrom(actorDataSchema, { omit: ["type"] });

export const actorCommands = {
  "actor.list": cmd(nameFilteredListSchema),
  "actor.get": cmd({
    type: "object",
    required: ["actorId"],
    properties: {
      actorId: { type: "string", minLength: 1 },
      ...actorIncludeProperty
    },
    additionalProperties: false
  }),
  "actor.get-many": cmd({
    type: "object",
    required: ["ids"],
    properties: { ...batchIdsProperty, ...actorIncludeProperty },
    additionalProperties: false
  }),
  "actor.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: actorDataSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty,
        ...includeProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "actor.update": cmd(
    {
      type: "object",
      required: ["actorId", "patch"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        patch: actorPatchSchema,
        ...dryRunProperty,
        ...includeProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "actor.delete": cmd(
    {
      type: "object",
      required: ["actorId"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        force: { type: "boolean" },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "actor.clone": cmd(
    {
      type: "object",
      required: ["actorId"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        patch: actorPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "actor.ownership.set": cmd(ownershipSetSchema("actorId", { levelSchema: ownershipLevelSchema }), {
    mutation: true
  }),
  "actor.item.list": cmd({
    type: "object",
    required: ["actorId"],
    properties: {
      actorId: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      ...paginationProperties,
      ...includeProperty
    },
    additionalProperties: false
  }),
  "actor.item.create": cmd(
    {
      type: "object",
      required: ["actorId", "data"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        data: embeddedItemDataSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty,
        ...includeProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "actor.item.update": cmd(
    {
      type: "object",
      required: ["actorId", "itemId", "patch"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        itemId: { type: "string", minLength: 1 },
        patch: itemPatchSchema,
        ...dryRunProperty,
        ...includeProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "actor.item.get": cmd({
    type: "object",
    required: ["actorId", "itemId"],
    properties: {
      actorId: { type: "string", minLength: 1 },
      itemId: { type: "string", minLength: 1 },
      ...includeProperty
    },
    additionalProperties: false
  }),
  "actor.item.delete": cmd(
    {
      type: "object",
      required: ["actorId", "itemId"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        itemId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "actor.item.clone": cmd(
    {
      type: "object",
      required: ["actorId", "itemId"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        itemId: { type: "string", minLength: 1 },
        patch: itemPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "actor.item.import-from-compendium": cmd(
    {
      type: "object",
      required: ["actorId", "pack", "entryId"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        pack: { type: "string", minLength: 1 },
        entryId: { type: "string", minLength: 1 },

        patch: itemPatchSchema,
        ...includeProperty,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  ...batchWriteCommands("actor", {
    scopeProperties: emptyScopeProperties,
    patchSchema: actorPatchSchema,
    verbs: ["update-many", "delete-many"],
    extraProperties: { "delete-many": { force: { type: "boolean" } } }
  }),
  "actor.effect.list": cmd({
    type: "object",
    required: ["actorId"],
    properties: {
      actorId: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "actor.effect.applied": cmd({
    type: "object",
    required: ["actorId"],
    properties: {
      actorId: { type: "string", minLength: 1 },
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "actor.effect.get": cmd({
    type: "object",
    required: ["actorId", "effectId"],
    properties: {
      actorId: { type: "string", minLength: 1 },
      effectId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "actor.effect.create": cmd(
    {
      type: "object",
      required: ["actorId", "data"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        data: effectCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "actor.effect.update": cmd(
    {
      type: "object",
      required: ["actorId", "effectId", "patch"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        effectId: { type: "string", minLength: 1 },
        patch: effectPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "actor.effect.delete": cmd(
    {
      type: "object",
      required: ["actorId", "effectId"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        effectId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "actor.effect.clone": cmd(
    {
      type: "object",
      required: ["actorId", "effectId"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        effectId: { type: "string", minLength: 1 },
        patch: effectPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  ...batchWriteCommands("actor.effect", {
    scopeProperties: actorScopeProperties,
    createSchema: effectCreateSchema,
    patchSchema: effectPatchSchema
  }),
  "actor.item.effect.list": cmd({
    type: "object",
    required: ["actorId", "itemId"],
    properties: {
      actorId: { type: "string", minLength: 1 },
      itemId: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "actor.item.effect.get": cmd({
    type: "object",
    required: ["actorId", "itemId", "effectId"],
    properties: {
      actorId: { type: "string", minLength: 1 },
      itemId: { type: "string", minLength: 1 },
      effectId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "actor.item.effect.create": cmd(
    {
      type: "object",
      required: ["actorId", "itemId", "data"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        itemId: { type: "string", minLength: 1 },
        data: effectCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "actor.item.effect.update": cmd(
    {
      type: "object",
      required: ["actorId", "itemId", "effectId", "patch"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        itemId: { type: "string", minLength: 1 },
        effectId: { type: "string", minLength: 1 },
        patch: effectPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "actor.item.effect.delete": cmd(
    {
      type: "object",
      required: ["actorId", "itemId", "effectId"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        itemId: { type: "string", minLength: 1 },
        effectId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "actor.item.effect.clone": cmd(
    {
      type: "object",
      required: ["actorId", "itemId", "effectId"],
      properties: {
        actorId: { type: "string", minLength: 1 },
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
  ...batchWriteCommands("actor.item.effect", {
    scopeProperties: actorItemScopeProperties,
    createSchema: effectCreateSchema,
    patchSchema: effectPatchSchema
  })
};

export const actorCompendiumImportCommands = {
  "actor.import-from-compendium": cmd(compendiumImportSchema(actorPatchSchema), { mutation: true })
};
