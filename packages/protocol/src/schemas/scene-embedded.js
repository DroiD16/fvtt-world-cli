import { effectCreateSchema, effectPatchSchema } from "./effect-data.js";
import { embeddedItemDataSchema, itemPatchSchema } from "./item-data.js";
import {
  batchWriteCommands,
  cmd,
  dryRunProperty,
  freeformObjectSchema,
  idempotencyKeyProperty,
  includeProperty,
  nameFilterProperty,
  nullableStringSchema,
  paginationProperties,
  sceneScopeProperties,
  sceneTokenItemScopeProperties,
  sceneTokenScopeProperties,
  tokenIncludeProperty
} from "./shared.js";

const tokenWriteProperties = {
  actorId: { type: "string", minLength: 1 },
  actorLink: { type: "boolean" },
  name: { type: "string", minLength: 1 },
  x: { type: "number" },
  y: { type: "number" },
  elevation: { type: "number" },
  rotation: { type: "number" },
  width: { type: "number" },
  height: { type: "number" },
  hidden: { type: "boolean" },
  disposition: { type: "number" },
  texture: freeformObjectSchema,
  light: freeformObjectSchema,
  sight: freeformObjectSchema,
  bar1: freeformObjectSchema,
  bar2: freeformObjectSchema,
  flags: freeformObjectSchema
};

const tokenCreateSchema = {
  type: "object",
  required: [],
  properties: tokenWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const tokenPatchSchema = {
  type: "object",
  required: [],
  properties: tokenWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const tileWriteProperties = {
  texture: freeformObjectSchema,
  x: { type: "number" },
  y: { type: "number" },
  width: { type: "number" },
  height: { type: "number" },
  rotation: { type: "number" },
  elevation: { type: "number" },
  sort: { type: "number" },
  hidden: { type: "boolean" },
  locked: { type: "boolean" },
  alpha: { type: "number" },
  occlusion: freeformObjectSchema,
  restrictions: freeformObjectSchema,
  flags: freeformObjectSchema
};

const tileCreateSchema = {
  type: "object",
  required: [],
  properties: tileWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const tilePatchSchema = {
  type: "object",
  required: [],
  properties: tileWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const soundWriteProperties = {
  path: { type: "string", minLength: 1 },
  x: { type: "number" },
  y: { type: "number" },
  radius: { type: "number" },
  elevation: { type: "number" },
  volume: { type: "number" },
  walls: { type: "boolean" },
  easing: { type: "boolean" },
  repeat: { type: "boolean" },
  hidden: { type: "boolean" },
  darkness: freeformObjectSchema,
  effects: freeformObjectSchema,
  flags: freeformObjectSchema
};

const soundCreateSchema = {
  type: "object",
  required: [],
  properties: soundWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const soundPatchSchema = {
  type: "object",
  required: [],
  properties: soundWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const wallWriteProperties = {
  c: { type: "array", items: { type: "number" } },
  light: { type: "number" },
  sight: { type: "number" },
  sound: { type: "number" },
  move: { type: "number" },
  dir: { type: "number" },
  door: { type: "number" },
  ds: { type: "number" },
  doorSound: { type: "string" },
  threshold: freeformObjectSchema,
  flags: freeformObjectSchema
};

const wallCreateSchema = {
  type: "object",
  required: [],
  properties: wallWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const wallPatchSchema = {
  type: "object",
  required: [],
  properties: wallWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const noteWriteProperties = {
  entryId: nullableStringSchema,
  pageId: nullableStringSchema,
  x: { type: "number" },
  y: { type: "number" },
  elevation: { type: "number" },
  sort: { type: "number" },
  texture: freeformObjectSchema,
  iconSize: { type: "number" },
  text: { type: "string" },
  fontFamily: { type: "string" },
  fontSize: { type: "number" },
  textAnchor: { type: "number" },
  textColor: { type: "string" },
  global: { type: "boolean" },
  flags: freeformObjectSchema
};

const noteCreateSchema = {
  type: "object",
  required: [],
  properties: noteWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const notePatchSchema = {
  type: "object",
  required: [],
  properties: noteWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const drawingWriteProperties = {
  shape: freeformObjectSchema,
  x: { type: "number" },
  y: { type: "number" },
  elevation: { type: "number" },
  sort: { type: "number" },
  rotation: { type: "number" },
  bezierFactor: { type: "number" },
  fillType: { type: "number" },
  fillColor: { type: "string" },
  fillAlpha: { type: "number" },
  strokeWidth: { type: "number" },
  strokeColor: { type: "string" },
  strokeAlpha: { type: "number" },
  texture: { type: "string" },
  text: { type: "string" },
  fontFamily: { type: "string" },
  fontSize: { type: "number" },
  textColor: { type: "string" },
  textAlpha: { type: "number" },
  hidden: { type: "boolean" },
  locked: { type: "boolean" },
  interface: { type: "boolean" },
  flags: freeformObjectSchema
};

const drawingCreateSchema = {
  type: "object",
  required: [],
  properties: drawingWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const drawingPatchSchema = {
  type: "object",
  required: [],
  properties: drawingWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const lightWriteProperties = {
  x: { type: "number" },
  y: { type: "number" },
  elevation: { type: "number" },
  rotation: { type: "number" },
  walls: { type: "boolean" },
  vision: { type: "boolean" },
  config: freeformObjectSchema,
  hidden: { type: "boolean" },
  flags: freeformObjectSchema
};

const lightCreateSchema = {
  type: "object",
  required: [],
  properties: lightWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const lightPatchSchema = {
  type: "object",
  required: [],
  properties: lightWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const templateWriteProperties = {
  t: { type: "string" },
  x: { type: "number" },
  y: { type: "number" },
  elevation: { type: "number" },
  sort: { type: "number" },
  distance: { type: "number" },
  direction: { type: "number" },
  angle: { type: "number" },
  width: { type: "number" },
  borderColor: { type: "string" },
  fillColor: { type: "string" },
  texture: { type: "string" },
  hidden: { type: "boolean" },
  flags: freeformObjectSchema
};

const templateCreateSchema = {
  type: "object",
  required: [],
  properties: templateWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const templatePatchSchema = {
  type: "object",
  required: [],
  properties: templateWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const regionWriteProperties = {
  name: { type: "string" },
  color: { type: "string" },
  shapes: { type: "array", items: freeformObjectSchema },
  elevation: freeformObjectSchema,
  behaviors: { type: "array", items: freeformObjectSchema },
  visibility: { type: "number" },
  locked: { type: "boolean" },
  flags: freeformObjectSchema
};

const regionCreateSchema = {
  type: "object",
  required: [],
  properties: regionWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const regionPatchSchema = {
  type: "object",
  required: [],
  properties: regionWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const regionBehaviorWriteProperties = {
  name: { type: "string" },
  disabled: { type: "boolean" },
  system: freeformObjectSchema,
  flags: freeformObjectSchema
};

const regionBehaviorCreateSchema = {
  type: "object",
  required: ["type"],
  properties: {
    type: { type: "string", minLength: 1 },
    ...regionBehaviorWriteProperties
  },
  additionalProperties: true
};

const regionBehaviorPatchSchema = {
  type: "object",
  required: [],

  properties: regionBehaviorWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

const executableBehaviorTypeSchema = { type: "string", enum: ["executeMacro"] };

const executableBehaviorCreateSchema = {
  type: "object",
  required: ["type"],
  properties: {
    type: executableBehaviorTypeSchema,
    ...regionBehaviorWriteProperties
  },
  additionalProperties: true
};

const executableBehaviorPatchSchema = {
  type: "object",
  required: [],
  properties: {
    type: executableBehaviorTypeSchema,
    ...regionBehaviorWriteProperties
  },
  additionalProperties: true,
  minProperties: 1
};

export const sceneEmbeddedCommands = {
  "scene.token.list": cmd({
    type: "object",
    required: ["sceneId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "scene.token.get": cmd({
    type: "object",
    required: ["sceneId", "tokenId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      tokenId: { type: "string", minLength: 1 },
      ...tokenIncludeProperty
    },
    additionalProperties: false
  }),
  "scene.token.create": cmd(
    {
      type: "object",
      required: ["sceneId", "data"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        data: tokenCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.token.update": cmd(
    {
      type: "object",
      required: ["sceneId", "tokenId", "patch"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tokenId: { type: "string", minLength: 1 },
        patch: tokenPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.token.delete": cmd(
    {
      type: "object",
      required: ["sceneId", "tokenId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tokenId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.token.clone": cmd(
    {
      type: "object",
      required: ["sceneId", "tokenId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tokenId: { type: "string", minLength: 1 },
        patch: tokenPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  ...batchWriteCommands("scene.token", {
    scopeProperties: sceneScopeProperties,
    createSchema: tokenCreateSchema,
    patchSchema: tokenPatchSchema
  }),
  "scene.token.item.list": cmd({
    type: "object",
    required: ["sceneId", "tokenId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      tokenId: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "scene.token.item.get": cmd({
    type: "object",
    required: ["sceneId", "tokenId", "itemId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      tokenId: { type: "string", minLength: 1 },
      itemId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "scene.token.item.create": cmd(
    {
      type: "object",
      required: ["sceneId", "tokenId", "data"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tokenId: { type: "string", minLength: 1 },
        data: embeddedItemDataSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty,
        ...includeProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.token.item.update": cmd(
    {
      type: "object",
      required: ["sceneId", "tokenId", "itemId", "patch"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tokenId: { type: "string", minLength: 1 },
        itemId: { type: "string", minLength: 1 },
        patch: itemPatchSchema,
        ...dryRunProperty,
        ...includeProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.token.item.delete": cmd(
    {
      type: "object",
      required: ["sceneId", "tokenId", "itemId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tokenId: { type: "string", minLength: 1 },
        itemId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.token.item.clone": cmd(
    {
      type: "object",
      required: ["sceneId", "tokenId", "itemId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tokenId: { type: "string", minLength: 1 },
        itemId: { type: "string", minLength: 1 },
        patch: itemPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.token.item.effect.list": cmd({
    type: "object",
    required: ["sceneId", "tokenId", "itemId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      tokenId: { type: "string", minLength: 1 },
      itemId: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "scene.token.item.effect.get": cmd({
    type: "object",
    required: ["sceneId", "tokenId", "itemId", "effectId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      tokenId: { type: "string", minLength: 1 },
      itemId: { type: "string", minLength: 1 },
      effectId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "scene.token.item.effect.create": cmd(
    {
      type: "object",
      required: ["sceneId", "tokenId", "itemId", "data"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tokenId: { type: "string", minLength: 1 },
        itemId: { type: "string", minLength: 1 },
        data: effectCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.token.item.effect.update": cmd(
    {
      type: "object",
      required: ["sceneId", "tokenId", "itemId", "effectId", "patch"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tokenId: { type: "string", minLength: 1 },
        itemId: { type: "string", minLength: 1 },
        effectId: { type: "string", minLength: 1 },
        patch: effectPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.token.item.effect.delete": cmd(
    {
      type: "object",
      required: ["sceneId", "tokenId", "itemId", "effectId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tokenId: { type: "string", minLength: 1 },
        itemId: { type: "string", minLength: 1 },
        effectId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.token.item.effect.clone": cmd(
    {
      type: "object",
      required: ["sceneId", "tokenId", "itemId", "effectId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tokenId: { type: "string", minLength: 1 },
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
  ...batchWriteCommands("scene.token.item.effect", {
    scopeProperties: sceneTokenItemScopeProperties,
    createSchema: effectCreateSchema,
    patchSchema: effectPatchSchema
  }),
  "scene.token.effect.list": cmd({
    type: "object",
    required: ["sceneId", "tokenId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      tokenId: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "scene.token.effect.applied": cmd({
    type: "object",
    required: ["sceneId", "tokenId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      tokenId: { type: "string", minLength: 1 },
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "scene.token.effect.get": cmd({
    type: "object",
    required: ["sceneId", "tokenId", "effectId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      tokenId: { type: "string", minLength: 1 },
      effectId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "scene.token.effect.create": cmd(
    {
      type: "object",
      required: ["sceneId", "tokenId", "data"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tokenId: { type: "string", minLength: 1 },
        data: effectCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.token.effect.update": cmd(
    {
      type: "object",
      required: ["sceneId", "tokenId", "effectId", "patch"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tokenId: { type: "string", minLength: 1 },
        effectId: { type: "string", minLength: 1 },
        patch: effectPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.token.effect.delete": cmd(
    {
      type: "object",
      required: ["sceneId", "tokenId", "effectId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tokenId: { type: "string", minLength: 1 },
        effectId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.token.effect.clone": cmd(
    {
      type: "object",
      required: ["sceneId", "tokenId", "effectId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tokenId: { type: "string", minLength: 1 },
        effectId: { type: "string", minLength: 1 },
        patch: effectPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  ...batchWriteCommands("scene.token.effect", {
    scopeProperties: sceneTokenScopeProperties,
    createSchema: effectCreateSchema,
    patchSchema: effectPatchSchema
  }),
  "scene.tile.list": cmd({
    type: "object",
    required: ["sceneId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "scene.tile.get": cmd({
    type: "object",
    required: ["sceneId", "tileId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      tileId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "scene.tile.create": cmd(
    {
      type: "object",
      required: ["sceneId", "data"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        data: tileCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.tile.update": cmd(
    {
      type: "object",
      required: ["sceneId", "tileId", "patch"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tileId: { type: "string", minLength: 1 },
        patch: tilePatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.tile.delete": cmd(
    {
      type: "object",
      required: ["sceneId", "tileId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tileId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.tile.clone": cmd(
    {
      type: "object",
      required: ["sceneId", "tileId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        tileId: { type: "string", minLength: 1 },
        patch: tilePatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  ...batchWriteCommands("scene.tile", {
    scopeProperties: sceneScopeProperties,
    createSchema: tileCreateSchema,
    patchSchema: tilePatchSchema
  }),
  "scene.sound.list": cmd({
    type: "object",
    required: ["sceneId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "scene.sound.get": cmd({
    type: "object",
    required: ["sceneId", "soundId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      soundId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "scene.sound.create": cmd(
    {
      type: "object",
      required: ["sceneId", "data"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        data: soundCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.sound.update": cmd(
    {
      type: "object",
      required: ["sceneId", "soundId", "patch"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        soundId: { type: "string", minLength: 1 },
        patch: soundPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.sound.delete": cmd(
    {
      type: "object",
      required: ["sceneId", "soundId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        soundId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.sound.clone": cmd(
    {
      type: "object",
      required: ["sceneId", "soundId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        soundId: { type: "string", minLength: 1 },
        patch: soundPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  ...batchWriteCommands("scene.sound", {
    scopeProperties: sceneScopeProperties,
    createSchema: soundCreateSchema,
    patchSchema: soundPatchSchema
  }),
  "scene.wall.list": cmd({
    type: "object",
    required: ["sceneId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },

      door: { type: "boolean" },
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "scene.wall.get": cmd({
    type: "object",
    required: ["sceneId", "wallId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      wallId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "scene.wall.create": cmd(
    {
      type: "object",
      required: ["sceneId", "data"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        data: wallCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.wall.update": cmd(
    {
      type: "object",
      required: ["sceneId", "wallId", "patch"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        wallId: { type: "string", minLength: 1 },
        patch: wallPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.wall.delete": cmd(
    {
      type: "object",
      required: ["sceneId", "wallId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        wallId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.wall.clone": cmd(
    {
      type: "object",
      required: ["sceneId", "wallId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        wallId: { type: "string", minLength: 1 },
        patch: wallPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  ...batchWriteCommands("scene.wall", {
    scopeProperties: sceneScopeProperties,
    createSchema: wallCreateSchema,
    patchSchema: wallPatchSchema
  }),
  "scene.note.list": cmd({
    type: "object",
    required: ["sceneId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "scene.note.get": cmd({
    type: "object",
    required: ["sceneId", "noteId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      noteId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "scene.note.create": cmd(
    {
      type: "object",
      required: ["sceneId", "data"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        data: noteCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.note.update": cmd(
    {
      type: "object",
      required: ["sceneId", "noteId", "patch"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        noteId: { type: "string", minLength: 1 },
        patch: notePatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.note.delete": cmd(
    {
      type: "object",
      required: ["sceneId", "noteId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        noteId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.note.clone": cmd(
    {
      type: "object",
      required: ["sceneId", "noteId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        noteId: { type: "string", minLength: 1 },
        patch: notePatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  ...batchWriteCommands("scene.note", {
    scopeProperties: sceneScopeProperties,
    createSchema: noteCreateSchema,
    patchSchema: notePatchSchema
  }),
  "scene.drawing.list": cmd({
    type: "object",
    required: ["sceneId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },

      ...paginationProperties
    },
    additionalProperties: false
  }),
  "scene.drawing.get": cmd({
    type: "object",
    required: ["sceneId", "drawingId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      drawingId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "scene.drawing.create": cmd(
    {
      type: "object",
      required: ["sceneId", "data"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        data: drawingCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.drawing.update": cmd(
    {
      type: "object",
      required: ["sceneId", "drawingId", "patch"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        drawingId: { type: "string", minLength: 1 },
        patch: drawingPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.drawing.delete": cmd(
    {
      type: "object",
      required: ["sceneId", "drawingId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        drawingId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.drawing.clone": cmd(
    {
      type: "object",
      required: ["sceneId", "drawingId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        drawingId: { type: "string", minLength: 1 },
        patch: drawingPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  ...batchWriteCommands("scene.drawing", {
    scopeProperties: sceneScopeProperties,
    createSchema: drawingCreateSchema,
    patchSchema: drawingPatchSchema
  }),
  "scene.light.list": cmd({
    type: "object",
    required: ["sceneId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },

      ...paginationProperties
    },
    additionalProperties: false
  }),
  "scene.light.get": cmd({
    type: "object",
    required: ["sceneId", "lightId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      lightId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "scene.light.create": cmd(
    {
      type: "object",
      required: ["sceneId", "data"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        data: lightCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.light.update": cmd(
    {
      type: "object",
      required: ["sceneId", "lightId", "patch"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        lightId: { type: "string", minLength: 1 },
        patch: lightPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.light.delete": cmd(
    {
      type: "object",
      required: ["sceneId", "lightId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        lightId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.light.clone": cmd(
    {
      type: "object",
      required: ["sceneId", "lightId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        lightId: { type: "string", minLength: 1 },
        patch: lightPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  ...batchWriteCommands("scene.light", {
    scopeProperties: sceneScopeProperties,
    createSchema: lightCreateSchema,
    patchSchema: lightPatchSchema
  }),
  "scene.template.list": cmd({
    type: "object",
    required: ["sceneId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },

      ...paginationProperties
    },
    additionalProperties: false
  }),
  "scene.template.get": cmd({
    type: "object",
    required: ["sceneId", "templateId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      templateId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "scene.template.create": cmd(
    {
      type: "object",
      required: ["sceneId", "data"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        data: templateCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.template.update": cmd(
    {
      type: "object",
      required: ["sceneId", "templateId", "patch"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        templateId: { type: "string", minLength: 1 },
        patch: templatePatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.template.delete": cmd(
    {
      type: "object",
      required: ["sceneId", "templateId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        templateId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.template.clone": cmd(
    {
      type: "object",
      required: ["sceneId", "templateId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        templateId: { type: "string", minLength: 1 },
        patch: templatePatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  ...batchWriteCommands("scene.template", {
    scopeProperties: sceneScopeProperties,
    createSchema: templateCreateSchema,
    patchSchema: templatePatchSchema
  }),
  "scene.region.list": cmd({
    type: "object",
    required: ["sceneId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },

      ...nameFilterProperty,
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "scene.region.get": cmd({
    type: "object",
    required: ["sceneId", "regionId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      regionId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "scene.region.create": cmd(
    {
      type: "object",
      required: ["sceneId", "data"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        data: regionCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.region.update": cmd(
    {
      type: "object",
      required: ["sceneId", "regionId", "patch"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        regionId: { type: "string", minLength: 1 },
        patch: regionPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.region.delete": cmd(
    {
      type: "object",
      required: ["sceneId", "regionId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        regionId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.region.clone": cmd(
    {
      type: "object",
      required: ["sceneId", "regionId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        regionId: { type: "string", minLength: 1 },
        patch: regionPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  ...batchWriteCommands("scene.region", {
    scopeProperties: sceneScopeProperties,
    createSchema: regionCreateSchema,
    patchSchema: regionPatchSchema
  }),
  "scene.region.behavior.list": cmd({
    type: "object",
    required: ["sceneId", "regionId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      regionId: { type: "string", minLength: 1 },

      ...nameFilterProperty,
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "scene.region.behavior.get": cmd({
    type: "object",
    required: ["sceneId", "regionId", "behaviorId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      regionId: { type: "string", minLength: 1 },
      behaviorId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "scene.region.behavior.create": cmd(
    {
      type: "object",
      required: ["sceneId", "regionId", "data"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        regionId: { type: "string", minLength: 1 },
        data: regionBehaviorCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.region.behavior.update": cmd(
    {
      type: "object",
      required: ["sceneId", "regionId", "behaviorId", "patch"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        regionId: { type: "string", minLength: 1 },
        behaviorId: { type: "string", minLength: 1 },
        patch: regionBehaviorPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.region.behavior.delete": cmd(
    {
      type: "object",
      required: ["sceneId", "regionId", "behaviorId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        regionId: { type: "string", minLength: 1 },
        behaviorId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.region.behavior.clone": cmd(
    {
      type: "object",
      required: ["sceneId", "regionId", "behaviorId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        regionId: { type: "string", minLength: 1 },
        behaviorId: { type: "string", minLength: 1 },

        patch: regionBehaviorPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.region.behavior.executable.create": cmd(
    {
      type: "object",
      required: ["sceneId", "regionId", "data"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        regionId: { type: "string", minLength: 1 },
        data: executableBehaviorCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.region.behavior.executable.update": cmd(
    {
      type: "object",
      required: ["sceneId", "regionId", "behaviorId", "patch"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        regionId: { type: "string", minLength: 1 },
        behaviorId: { type: "string", minLength: 1 },
        patch: executableBehaviorPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "scene.region.behavior.executable.clone": cmd(
    {
      type: "object",
      required: ["sceneId", "regionId", "behaviorId"],
      properties: {
        sceneId: { type: "string", minLength: 1 },
        regionId: { type: "string", minLength: 1 },
        behaviorId: { type: "string", minLength: 1 },
        patch: executableBehaviorPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};
