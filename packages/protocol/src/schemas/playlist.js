import { ownershipLevelSchema, ownershipSetSchema } from "./ownership-users.js";
import {
  batchIdsProperty,
  cmd,
  compendiumImportSchema,
  dryRunProperty,
  freeformObjectSchema,
  idempotencyKeyProperty,
  nameFilterProperty,
  nameFilteredListSchema,
  nullableStringSchema,
  paginationProperties,
  patchFrom
} from "./shared.js";

const playlistSoundCreateSchema = {
  type: "object",
  required: ["path"], // name optional — Foundry derives it from path
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    path: { type: "string", minLength: 1 },

    channel: { type: ["string", "null"], enum: ["music", "environment", "interface", null] },
    playing: { type: "boolean" },
    pausedTime: { type: "number" },
    repeat: { type: "boolean" },
    volume: { type: "number" }, // linear 0–1; scaling verified live
    fade: { type: "number" },
    sort: { type: "number" },
    flags: freeformObjectSchema
  },
  additionalProperties: false
};

const playlistSoundPatchSchema = patchFrom(playlistSoundCreateSchema);

const playlistSoundIdSchema = {
  type: "object",
  required: ["playlistId", "soundId"],
  properties: {
    playlistId: { type: "string", minLength: 1 },
    soundId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};

const playlistDataSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    mode: { type: "number", enum: [-1, 0, 1, 2] }, // PLAYLIST_MODES (verified v13)
    playing: { type: "boolean" },
    fade: { type: "number" },
    channel: { type: "string", enum: ["music", "environment", "interface"] }, // AUDIO_CHANNELS keys (verified v13)
    sorting: { type: "string", enum: ["a", "m"] }, // PLAYLIST_SORT_MODES (verified v13)
    seed: { type: "number" },
    folder: nullableStringSchema,
    sort: { type: "number" },
    flags: freeformObjectSchema,
    sounds: { type: "array", items: playlistSoundCreateSchema }
  },
  additionalProperties: false
};

// NO `sounds` on patch (fields-only update; embedded sound writes → playlist.sound.*)
const playlistPatchSchema = patchFrom(playlistDataSchema, { omit: ["sounds"] });

const playlistIdSchema = {
  type: "object",
  required: ["playlistId"],
  properties: { playlistId: { type: "string", minLength: 1 } },
  additionalProperties: false
};

export const playlistCommands = {
  "playlist.list": cmd(nameFilteredListSchema),
  "playlist.get": cmd(playlistIdSchema),
  "playlist.get-many": cmd({
    type: "object",
    required: ["ids"],
    properties: { ...batchIdsProperty },
    additionalProperties: false
  }),
  "playlist.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: playlistDataSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "playlist.update": cmd(
    {
      type: "object",
      required: ["playlistId", "patch"],
      properties: {
        playlistId: { type: "string", minLength: 1 },
        patch: playlistPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "playlist.delete": cmd(
    {
      type: "object",
      required: ["playlistId"],
      properties: {
        playlistId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "playlist.clone": cmd(
    {
      type: "object",
      required: ["playlistId"],
      properties: {
        playlistId: { type: "string", minLength: 1 },
        patch: playlistPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "playlist.import-from-compendium": cmd(compendiumImportSchema(playlistPatchSchema), { mutation: true }),
  "playlist.ownership.set": cmd(ownershipSetSchema("playlistId", { levelSchema: ownershipLevelSchema }), {
    mutation: true
  }),
  "playlist.sound.list": cmd({
    type: "object",
    required: [],
    properties: {
      playlistId: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      path: { type: "string", minLength: 1 },
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "playlist.sound.get": cmd(playlistSoundIdSchema),
  "playlist.sound.create": cmd(
    {
      type: "object",
      required: ["playlistId", "data"],
      properties: {
        playlistId: { type: "string", minLength: 1 },
        data: playlistSoundCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "playlist.sound.update": cmd(
    {
      type: "object",
      required: ["playlistId", "soundId", "patch"],
      properties: {
        playlistId: { type: "string", minLength: 1 },
        soundId: { type: "string", minLength: 1 },
        patch: playlistSoundPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "playlist.sound.delete": cmd(
    {
      type: "object",
      required: ["playlistId", "soundId"],
      properties: {
        playlistId: { type: "string", minLength: 1 },
        soundId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "playlist.sound.clone": cmd(
    {
      type: "object",
      required: ["playlistId", "soundId"],
      properties: {
        playlistId: { type: "string", minLength: 1 },
        soundId: { type: "string", minLength: 1 },
        patch: playlistSoundPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "playlist.play": cmd(
    {
      type: "object",
      required: ["playlistId"],
      properties: {
        playlistId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "playlist.stop": cmd(
    {
      type: "object",
      required: ["playlistId"],
      properties: {
        playlistId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "playlist.playNext": cmd(
    {
      type: "object",
      required: ["playlistId"],
      properties: {
        playlistId: { type: "string", minLength: 1 },

        soundId: { type: "string", minLength: 1 },

        direction: { enum: [1, -1] },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "playlist.sound.play": cmd(
    {
      type: "object",
      required: ["playlistId", "soundId"],
      properties: {
        playlistId: { type: "string", minLength: 1 },
        soundId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "playlist.sound.stop": cmd(
    {
      type: "object",
      required: ["playlistId", "soundId"],
      properties: {
        playlistId: { type: "string", minLength: 1 },
        soundId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};
