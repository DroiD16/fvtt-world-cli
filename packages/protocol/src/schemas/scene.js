import { SCENE_THUMBNAIL_MAX_DIMENSION, SCENE_THUMBNAIL_MIN_DIMENSION } from "../constants.js";
import { ownershipLevelSchema, ownershipSetSchema } from "./ownership-users.js";
import { levelCreateSchema } from "./scene-embedded.js";
import {
  batchIdsProperty,
  cmd,
  compendiumImportSchema,
  dryRunProperty,
  freeformObjectSchema,
  idempotencyKeyProperty,
  nameFilteredListSchema,
  nullableStringSchema,
  patchFrom,
  userIdsProperty
} from "./shared.js";

const sceneIdSchema = {
  type: "object",
  required: ["sceneId"],
  properties: {
    sceneId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};

const sceneBackgroundSchema = {
  type: "object",
  required: [],
  properties: {
    src: { type: ["string", "null"], minLength: 1 },
    offsetX: { type: "number" },
    offsetY: { type: "number" },
    scaleX: { type: "number" },
    scaleY: { type: "number" },
    rotation: { type: "number" },
    anchorX: { type: "number" },
    anchorY: { type: "number" },
    fit: { type: "string", minLength: 1 },
    alphaThreshold: { type: "number" },

    tint: { type: "string", minLength: 1 }
  },
  additionalProperties: false,
  minProperties: 1
};

const sceneGridSchema = {
  type: "object",
  required: [],
  properties: {
    type: { type: "number" },
    size: { type: "number" },
    distance: { type: "number" },
    units: { type: "string" },
    style: { type: "string" },
    thickness: { type: "number" },
    color: { type: "string", minLength: 1 },
    alpha: { type: "number" }
  },
  additionalProperties: false,
  minProperties: 1
};

const sceneCreateSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    folder: nullableStringSchema,
    active: { type: "boolean" },
    navigation: { type: "boolean" },
    navOrder: { type: "number" },
    width: { type: ["number", "null"] },
    height: { type: ["number", "null"] },
    grid: sceneGridSchema,
    background: sceneBackgroundSchema,
    backgroundColor: { type: "string", minLength: 1 },
    tokenVision: { type: "boolean" },
    weather: nullableStringSchema,
    padding: { type: "number" },
    shiftX: { type: ["number", "null"] },
    shiftY: { type: ["number", "null"] },
    navName: nullableStringSchema,
    thumb: nullableStringSchema,
    sort: { type: "number" },
    levels: { type: "array", minItems: 1, items: levelCreateSchema },

    playlist: nullableStringSchema,
    playlistSound: nullableStringSchema,
    journal: nullableStringSchema,
    journalEntryPage: nullableStringSchema,

    environment: freeformObjectSchema,
    fog: freeformObjectSchema,
    initial: freeformObjectSchema,
    transition: freeformObjectSchema,

    foreground: nullableStringSchema,
    foregroundElevation: { type: ["number", "null"] },
    flags: freeformObjectSchema
  },
  additionalProperties: false
};

const scenePatchSchema = patchFrom(sceneCreateSchema, {
  omit: ["levels"],
  prepend: { initialLevel: nullableStringSchema }
});

export const sceneCommands = {
  "scene.list": cmd(nameFilteredListSchema),
  "scene.get": cmd(sceneIdSchema),
  "scene.get-many": cmd({
    type: "object",
    required: ["ids"],
    properties: { ...batchIdsProperty },
    additionalProperties: false
  }),
  "scene.update": cmd(
    {
      type: "object",
      required: ["sceneId", "patch"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        patch: scenePatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: sceneCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.delete": cmd(
    {
      type: "object",
      required: ["sceneId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        force: { type: "boolean" },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.clone": cmd(
    {
      type: "object",
      required: ["sceneId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        patch: scenePatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.import-from-compendium": cmd(compendiumImportSchema(scenePatchSchema), { mutation: true }),
  "scene.thumbnail.generate": cmd(
    {
      type: "object",
      required: ["sceneId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },

        width: {
          type: "integer",
          minimum: SCENE_THUMBNAIL_MIN_DIMENSION,
          maximum: SCENE_THUMBNAIL_MAX_DIMENSION
        },
        height: {
          type: "integer",
          minimum: SCENE_THUMBNAIL_MIN_DIMENSION,
          maximum: SCENE_THUMBNAIL_MAX_DIMENSION
        },

        includeThumb: { type: "boolean" },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.fog.reset": cmd(
    {
      type: "object",
      required: ["sceneId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.activate": cmd(
    {
      type: "object",
      required: ["sceneId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.pull-users": cmd({
    type: "object",
    required: ["sceneId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      ...userIdsProperty
    },
    additionalProperties: false
  }),
  "scene.ownership.set": cmd(ownershipSetSchema("sceneId", { levelSchema: ownershipLevelSchema }), {
    mutation: true
  })
};
