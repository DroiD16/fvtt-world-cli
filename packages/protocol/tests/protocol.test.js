import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  OUTPUT_PATH,
  PROFILE_PATH,
  buildDefaultCommandProfileSource,
  buildGeneratedSource
} from "../../../scripts/generate-protocol.mjs";
import * as moduleProtocol from "../../foundry-module/scripts/generated/protocol.js";
import * as protocol from "../src/index.js";
import {
  APPROVAL_AWAIT_PARK_CAP_MS,
  APPROVAL_PENDING_MAX,
  APPROVAL_RESULT_RETENTION_MS,
  APPROVAL_TIMEOUT_DEFAULT_MINUTES,
  APPROVAL_TIMEOUT_MAX_MINUTES,
  APPROVAL_TIMEOUT_MIN_MINUTES,
  AUTH_AWAIT_PARK_CAP_MS,
  AUTH_PRUNE_DEFAULT_DAYS,
  BATCH_GET_MAX_IDS,
  BATCH_WRITE_MAX_ITEMS,
  BATCH_WRITE_PERSISTED_STATUSES,
  BATCH_WRITE_STATUSES,
  BATCH_WRITE_SUCCESS_STATUSES,
  BRIDGE_LEASE_MS,
  COMMAND_DEFINITIONS,
  COMMAND_NAMES,
  DAEMON_OPERATIONS,
  DAEMON_OPERATION_DEFINITIONS,
  DAEMON_REQUEST_SCHEMA,
  DAEMON_REQUEST_VARIANT_SCHEMAS,
  DEFAULT_COMMAND_PROFILE,
  DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
  DEFAULT_WS_MAX_PAYLOAD_BYTES,
  DISCOVERABLE_COMMAND_NAMES,
  ERROR_CODES,
  SETTING_VALUE_MAX_BYTES,
  SETTING_VALUE_MAX_DEPTH,
  SETTING_VALUE_MAX_NODES,
  MESSAGE_TYPES,
  POLICY_BEHAVIORS,
  POLICY_DISCOVERY_TIMEOUT_MS,
  POLICY_EXEMPT_COMMANDS,
  PROTOCOL_COMPONENTS,
  PROTOCOL_HANDSHAKES,
  PROTOCOL_VERSION,
  defaultProfile,
  isDestructiveCommand,
  FOG_RESET_CONFIRM_POLL_INTERVAL_MS,
  FOG_RESET_CONFIRM_TIMEOUT_MS,
  SCENE_THUMBNAIL_MAX_BYTES,
  SCENE_THUMBNAIL_MAX_DIMENSION,
  SCENE_THUMBNAIL_MIN_DIMENSION,
  SCENE_THUMBNAIL_RESPONSE_MAX_BYTES,
  SEARCH_COMPENDIUM_INDEX_MAX_BYTES,
  SEARCH_COMPENDIUM_INDEX_MAX_ENTRIES,
  SEARCH_CORPUS_STATUSES,
  SEARCH_DOC_TEXT_MAX_CHARS,
  SEARCH_INDEXED_TYPES,
  SEARCH_INDEX_BYTES_PER_CHAR,
  SEARCH_INDEX_BYTES_PER_ENTRY,
  SEARCH_MAX_MATCHES,
  SEARCH_MODES,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
  SEARCH_RESPONSE_MAX_BYTES,
  SEARCH_RESULT_DEFAULT_LIMIT,
  SEARCH_RESULT_MAX_LIMIT,
  SEARCH_RESULT_SOURCES,
  SEARCH_SNIPPET_FIELDS,
  SEARCH_SNIPPET_MAX_CHARS,
  SEARCH_SNIPPET_MAX_MATCHES,
  SEARCH_SNIPPET_RADIUS,
  SEARCH_SOURCES,
  SEARCH_SYSTEM_WALK_MAX_BYTES,
  SEARCH_SYSTEM_WALK_MAX_DEPTH,
  SEARCH_SYSTEM_WALK_MAX_NODES,
  SEARCH_WORLD_INDEX_MAX_BYTES,
  SEARCH_WORLD_INDEX_MAX_ENTRIES,
  estimateSearchIndexBytes,
  CARDS_ACTION_CHAT_STATUSES,
  CARDS_ACTION_MUTATION_OUTCOMES,
  CARDS_ACTION_RECONCILIATIONS,
  CARDS_DELETE_CHAT_STATUSES,
  CARDS_DRAW_MODES,
  CARDS_PASS_MAX_IDS,
  CARDS_RECALL_CONSEQUENCE_SCOPES,
  CARDS_RECALL_STATUSES,
  CHAT_CAPTURE_STATUSES,
  COMBAT_INITIATIVE_MODES,
  COMBAT_INITIATIVE_SELECTIONS,
  COMBAT_MUTATION_OUTCOMES,
  COMBAT_ROLL_MODES,
  COMBAT_TRANSITIONS,
  TABLE_DRAW_MAX_COUNT,
  TABLE_MUTATION_OUTCOMES,
  TABLE_ROLL_MODES,
  TRANSPORT_MESSAGE_SCHEMAS,
  UPLOAD_SIZE_LIMIT_MAX_BYTES,
  WRITE_COMMANDS,
  createBridgeHello,
  getProtocolVersionError,
  isWriteCommand,
  normalizeComparableProtocolVersion,
  resolveEffectiveLimits,
  validateCommandRequest,
  validateDaemonRequest,
  validateHelloMessage,
  validateSchema,
  validateTransportMessage,
  wsMaxPayloadForUploadLimit
} from "../src/index.js";
import { mergeCommandFamilies } from "../src/schemas/shared.js";

const REPO_ROOT = path.resolve(path.dirname(OUTPUT_PATH), "../../../..");

const CLIENT_ID = "a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5";

const BATCHED_FAMILIES = COMMAND_NAMES.filter((name) => name.endsWith(".create-many"))
  .map((name) => name.slice(0, -".create-many".length))
  .sort();

const BATCH_UPDATE_DELETE_FAMILIES = COMMAND_NAMES.filter((name) => name.endsWith(".update-many"))
  .map((name) => name.slice(0, -".update-many".length))
  .filter((family) => !BATCHED_FAMILIES.includes(family))
  .sort();

const ALL_BATCHED_FAMILIES = [...BATCHED_FAMILIES, ...BATCH_UPDATE_DELETE_FAMILIES].sort();

const BATCH_SCOPE_KEYS = Object.freeze({
  "scene.drawing": ["sceneId"],
  "scene.light": ["sceneId"],
  "scene.note": ["sceneId"],
  "scene.region": ["sceneId"],
  "scene.sound": ["sceneId"],
  "scene.template": ["sceneId"],
  "scene.tile": ["sceneId"],
  "scene.token": ["sceneId"],
  "scene.wall": ["sceneId"],
  "actor.effect": ["actorId"],
  "item.effect": ["itemId"],
  "actor.item.effect": ["actorId", "itemId"],
  "scene.token.effect": ["sceneId", "tokenId"],
  "scene.token.item.effect": ["sceneId", "tokenId", "itemId"],
  item: [],
  actor: [],
  journal: []
});

const BATCH_EXTRA_PARAMS = Object.freeze({ "actor.delete-many": ["force"] });

const validate = (command, params) =>
  validateCommandRequest({
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.COMMAND_REQUEST,
    id: `req_${command}`,
    command,
    params
  });

const expectValid = (command, params) => {
  const result = validate(command, params);
  expect(result, `${command} ${JSON.stringify(params)}: ${result.errors?.join("; ")}`).toEqual({
    ok: true,
    errors: []
  });
};

const expectRejected = (command, params, needle) => {
  const result = validate(command, params);
  expect(result.ok, `${command} ${JSON.stringify(params)} should reject`).toBe(false);
  if (needle) {
    expect(
      result.errors.some((message) => message.includes(needle)),
      `${command} errors ${JSON.stringify(result.errors)} should include ${needle}`
    ).toBe(true);
  }
};

const PROTECTED_META_VALUES = Object.freeze({
  _id: "spoofed-id",
  _stats: "spoofed-stats",
  ownership: {}
});

const OPEN_PAYLOAD_FAMILIES = Object.freeze([
  "actor.effect",
  "actor.item.effect",
  "item.effect",
  "scene.drawing",
  "scene.light",
  "scene.note",
  "scene.region",
  "scene.region.behavior",
  "scene.sound",
  "scene.template",
  "scene.tile",
  "scene.token",
  "scene.token.effect",
  "scene.token.item.effect",
  "scene.wall"
]);

const EXPECTED_CLOSED_PAYLOADS = Object.freeze([
  "actor.clone.patch",
  "actor.create.data",
  "actor.import-from-compendium.patch",
  "actor.item.clone.patch",
  "actor.item.create.data",
  "actor.item.import-from-compendium.patch",
  "actor.item.update.patch",
  "actor.update-many.patches[].patch",
  "actor.update.patch",
  "cards.card.clone.patch",
  "cards.card.create.data",
  "cards.card.update.patch",
  "cards.clone.patch",
  "cards.create.data",
  "cards.import-from-compendium.patch",
  "cards.update.patch",
  "chat.create.data",
  "chat.create.roll",
  "combat.combatant.create.data",
  "combat.combatant.update.patch",
  "combat.create.data",
  "combat.group.create.data",
  "combat.group.update.patch",
  "combat.update.patch",
  "folder.create.data",
  "folder.update.patch",
  "item.clone.patch",
  "item.create.data",
  "item.import-from-compendium.patch",
  "item.update-many.patches[].patch",
  "item.update.patch",
  "journal.category.create.data",
  "journal.category.update.patch",
  "journal.clone.patch",
  "journal.create.data",
  "journal.import-from-compendium.patch",
  "journal.update-many.patches[].patch",
  "journal.update.patch",
  "macro.clone.patch",
  "macro.create.data",
  "macro.import-from-compendium.patch",
  "macro.update.patch",
  "playlist.clone.patch",
  "playlist.create.data",
  "playlist.import-from-compendium.patch",
  "playlist.sound.clone.patch",
  "playlist.sound.create.data",
  "playlist.sound.update.patch",
  "playlist.update.patch",
  "scene.clone.patch",
  "scene.create.data",
  "scene.import-from-compendium.patch",
  "scene.token.item.clone.patch",
  "scene.token.item.create.data",
  "scene.token.item.update.patch",
  "scene.update.patch",
  "table.clone.patch",
  "table.create.data",
  "table.import-from-compendium.patch",
  "table.result.clone.patch",
  "table.result.create.data",
  "table.result.update.patch",
  "table.update.patch"
]);

const EXPECTED_FAMILY_FIELDS = Object.freeze({
  "actor.create.data": ["flags", "folder", "img", "name", "prototypeToken", "sort", "system", "type"],
  "actor.item.create.data": ["effects", "flags", "folder", "img", "name", "sort", "system", "type"],
  "actor.item.update.patch": ["flags", "folder", "img", "name", "sort", "system"],
  "actor.update.patch": ["flags", "folder", "img", "name", "prototypeToken", "sort", "system"],
  "cards.card.create.data": [
    "back",
    "description",
    "face",
    "faces",
    "flags",
    "height",
    "name",
    "rotation",
    "sort",
    "suit",
    "system",
    "type",
    "value",
    "width"
  ],
  "cards.card.update.patch": [
    "back",
    "description",
    "face",
    "faces",
    "flags",
    "height",
    "name",
    "rotation",
    "sort",
    "suit",
    "system",
    "value",
    "width"
  ],
  "cards.create.data": [
    "cards",
    "description",
    "displayCount",
    "flags",
    "folder",
    "height",
    "img",
    "name",
    "rotation",
    "sort",
    "system",
    "type",
    "width"
  ],
  "cards.update.patch": [
    "description",
    "displayCount",
    "flags",
    "folder",
    "height",
    "img",
    "name",
    "rotation",
    "sort",
    "system",
    "width"
  ],
  "chat.create.data": ["blind", "content", "flags", "flavor", "sound", "speaker", "style", "whisper"],
  "combat.combatant.create.data": [
    "actorId",
    "defeated",
    "flags",
    "group",
    "hidden",
    "img",
    "initiative",
    "name",
    "roundJoined",
    "sceneId",
    "system",
    "tokenId",
    "type"
  ],
  "combat.combatant.update.patch": [
    "actorId",
    "defeated",
    "flags",
    "group",
    "hidden",
    "img",
    "name",
    "roundJoined",
    "sceneId",
    "system",
    "tokenId"
  ],
  "combat.create.data": ["flags", "name", "scene", "sort", "system", "type"],
  "combat.group.create.data": ["flags", "img", "initiative", "name", "system", "type"],
  "combat.group.update.patch": ["flags", "img", "initiative", "name", "system"],
  "combat.update.patch": ["flags", "name", "scene", "sort", "system"],
  "folder.create.data": ["color", "description", "flags", "folder", "name", "sort", "sorting", "type"],
  "folder.update.patch": ["color", "description", "flags", "folder", "name", "sort", "sorting"],
  "item.create.data": ["flags", "folder", "img", "name", "sort", "system", "type"],
  "item.update.patch": ["flags", "folder", "img", "name", "sort", "system"],
  "journal.category.create.data": ["flags", "name", "sort"],
  "journal.category.update.patch": ["flags", "name", "sort"],
  "journal.create.data": ["flags", "folder", "name", "pages", "sort"],
  "journal.update.patch": ["deletePageIds", "flags", "folder", "name", "pages", "sort"],
  "macro.create.data": ["command", "flags", "folder", "img", "name", "scope", "type"],
  "macro.update.patch": ["command", "flags", "folder", "img", "name", "scope", "type"],
  "playlist.create.data": [
    "channel",
    "description",
    "fade",
    "flags",
    "folder",
    "mode",
    "name",
    "playing",
    "seed",
    "sort",
    "sorting",
    "sounds"
  ],
  "playlist.sound.create.data": [
    "channel",
    "description",
    "fade",
    "flags",
    "name",
    "path",
    "pausedTime",
    "playing",
    "repeat",
    "sort",
    "volume"
  ],
  "playlist.sound.update.patch": [
    "channel",
    "description",
    "fade",
    "flags",
    "name",
    "path",
    "pausedTime",
    "playing",
    "repeat",
    "sort",
    "volume"
  ],
  "playlist.update.patch": [
    "channel",
    "description",
    "fade",
    "flags",
    "folder",
    "mode",
    "name",
    "playing",
    "seed",
    "sort",
    "sorting"
  ],
  "scene.create.data": [
    "active",
    "background",
    "backgroundColor",
    "environment",
    "flags",
    "fog",
    "foreground",
    "foregroundElevation",
    "grid",
    "height",
    "initial",
    "initialLevel",
    "journal",
    "journalEntryPage",
    "name",
    "navName",
    "navOrder",
    "navigation",
    "padding",
    "playlist",
    "playlistSound",
    "shiftX",
    "shiftY",
    "sort",
    "thumb",
    "tokenVision",
    "transition",
    "weather",
    "width"
  ],
  "scene.token.item.create.data": ["effects", "flags", "folder", "img", "name", "sort", "system", "type"],
  "scene.token.item.update.patch": ["flags", "folder", "img", "name", "sort", "system"],
  "scene.update.patch": [
    "active",
    "background",
    "backgroundColor",
    "environment",
    "flags",
    "fog",
    "foreground",
    "foregroundElevation",
    "grid",
    "height",
    "initial",
    "initialLevel",
    "journal",
    "journalEntryPage",
    "name",
    "navName",
    "navOrder",
    "navigation",
    "padding",
    "playlist",
    "playlistSound",
    "shiftX",
    "shiftY",
    "sort",
    "thumb",
    "tokenVision",
    "transition",
    "weather",
    "width"
  ],
  "table.create.data": [
    "description",
    "displayRoll",
    "flags",
    "folder",
    "formula",
    "img",
    "name",
    "replacement",
    "results",
    "sort"
  ],
  "table.result.create.data": [
    "description",
    "documentUuid",
    "drawn",
    "flags",
    "img",
    "name",
    "range",
    "type",
    "weight"
  ],
  "table.result.update.patch": [
    "description",
    "documentUuid",
    "drawn",
    "flags",
    "img",
    "name",
    "range",
    "type",
    "weight"
  ],
  "table.update.patch": [
    "description",
    "displayRoll",
    "flags",
    "folder",
    "formula",
    "img",
    "name",
    "replacement",
    "sort"
  ]
});

function collectPayloadSchemas() {
  const payloads = [];
  for (const [command, definition] of Object.entries(COMMAND_DEFINITIONS)) {
    const properties = /** @type {any} */ (definition.paramsSchema.properties ?? {});
    const family = command.slice(0, command.lastIndexOf("."));

    for (const key of ["data", "patch", "roll"]) {
      const declared = properties[key];
      if (!declared) {
        continue;
      }
      if (declared.type === "array") {
        payloads.push({
          command,
          family,
          path: `${command}.${key}[]`,
          errorPath: `$.params.${key}[0]`,
          schema: declared.items,
          inject: (base, field, value) => ({
            ...base,
            [key]: base[key].map((element, index) => (index === 0 ? { ...element, [field]: value } : element))
          })
        });
      } else {
        payloads.push({
          command,
          family,
          path: `${command}.${key}`,
          errorPath: `$.params.${key}`,
          schema: declared,
          inject: (base, field, value) => ({ ...base, [key]: { ...base[key], [field]: value } })
        });
      }
    }

    if (properties.patches) {
      payloads.push({
        command,
        family,
        path: `${command}.patches[].patch`,
        errorPath: "$.params.patches[0].patch",
        schema: properties.patches.items.properties.patch,
        inject: (base, field, value) => ({
          ...base,
          patches: base.patches.map((element, index) =>
            index === 0 ? { ...element, patch: { ...element.patch, [field]: value } } : element
          )
        })
      });
    }
  }
  return payloads;
}

const MUTATION_BASES = Object.freeze({
  "scene.update": { sceneId: "scene-1", patch: { name: "X" } },
  "scene.create": { data: { name: "X" } },
  "scene.delete": { sceneId: "scene-1" },
  "scene.clone": { sceneId: "scene-1" },
  "scene.thumbnail.generate": { sceneId: "scene-1" },
  "scene.fog.reset": { sceneId: "scene-1" },
  "scene.token.create": { sceneId: "scene-1", data: { name: "X" } },
  "scene.token.update": { sceneId: "scene-1", tokenId: "tok-1", patch: { name: "X" } },
  "scene.token.delete": { sceneId: "scene-1", tokenId: "tok-1" },
  "scene.token.clone": { sceneId: "scene-1", tokenId: "tok-1" },
  "scene.token.item.create": { sceneId: "scene-1", tokenId: "tok-1", data: { name: "X", type: "loot" } },
  "scene.token.item.update": {
    sceneId: "scene-1",
    tokenId: "tok-1",
    itemId: "item-1",
    patch: { name: "X" }
  },
  "scene.token.item.delete": { sceneId: "scene-1", tokenId: "tok-1", itemId: "item-1" },
  "scene.token.item.clone": { sceneId: "scene-1", tokenId: "tok-1", itemId: "item-1" },
  "scene.token.effect.create": { sceneId: "scene-1", tokenId: "tok-1", data: { name: "Aura" } },
  "scene.token.effect.update": {
    sceneId: "scene-1",
    tokenId: "tok-1",
    effectId: "eff-1",
    patch: { name: "X" }
  },
  "scene.token.effect.delete": { sceneId: "scene-1", tokenId: "tok-1", effectId: "eff-1" },
  "scene.token.effect.clone": { sceneId: "scene-1", tokenId: "tok-1", effectId: "eff-1" },
  "scene.token.item.effect.create": {
    sceneId: "scene-1",
    tokenId: "tok-1",
    itemId: "item-1",
    data: { name: "Aura" }
  },
  "scene.token.item.effect.update": {
    sceneId: "scene-1",
    tokenId: "tok-1",
    itemId: "item-1",
    effectId: "eff-1",
    patch: { name: "X" }
  },
  "scene.token.item.effect.delete": {
    sceneId: "scene-1",
    tokenId: "tok-1",
    itemId: "item-1",
    effectId: "eff-1"
  },
  "scene.token.item.effect.clone": {
    sceneId: "scene-1",
    tokenId: "tok-1",
    itemId: "item-1",
    effectId: "eff-1"
  },
  "scene.tile.create": { sceneId: "scene-1", data: { x: 1 } },
  "scene.tile.update": { sceneId: "scene-1", tileId: "tile-1", patch: { x: 1 } },
  "scene.tile.delete": { sceneId: "scene-1", tileId: "tile-1" },
  "scene.tile.clone": { sceneId: "scene-1", tileId: "tile-1" },
  "scene.sound.create": { sceneId: "scene-1", data: { path: "a.ogg" } },
  "scene.sound.update": { sceneId: "scene-1", soundId: "snd-1", patch: { volume: 1 } },
  "scene.sound.delete": { sceneId: "scene-1", soundId: "snd-1" },
  "scene.sound.clone": { sceneId: "scene-1", soundId: "snd-1" },
  "scene.wall.create": { sceneId: "scene-1", data: { c: [0, 0, 100, 0] } },
  "scene.wall.update": { sceneId: "scene-1", wallId: "wall-1", patch: { door: 1 } },
  "scene.wall.delete": { sceneId: "scene-1", wallId: "wall-1" },
  "scene.wall.clone": { sceneId: "scene-1", wallId: "wall-1" },

  "scene.wall.create-many": { sceneId: "scene-1", data: [{ c: [0, 0, 100, 0] }] },
  "scene.wall.update-many": { sceneId: "scene-1", patches: [{ id: "wall-1", patch: { door: 1 } }] },
  "scene.wall.delete-many": { sceneId: "scene-1", ids: ["wall-1"] },
  "scene.token.create-many": { sceneId: "scene-1", data: [{ actorId: "actor-1", x: 10, y: 20 }] },
  "scene.token.update-many": { sceneId: "scene-1", patches: [{ id: "tok-1", patch: { x: 5 } }] },
  "scene.token.delete-many": { sceneId: "scene-1", ids: ["tok-1"] },
  "scene.tile.create-many": { sceneId: "scene-1", data: [{ x: 1, y: 2 }] },
  "scene.tile.update-many": { sceneId: "scene-1", patches: [{ id: "tile-1", patch: { x: 1 } }] },
  "scene.tile.delete-many": { sceneId: "scene-1", ids: ["tile-1"] },
  "scene.sound.create-many": { sceneId: "scene-1", data: [{ path: "a.ogg" }] },
  "scene.sound.update-many": { sceneId: "scene-1", patches: [{ id: "snd-1", patch: { volume: 1 } }] },
  "scene.sound.delete-many": { sceneId: "scene-1", ids: ["snd-1"] },
  "scene.note.create-many": { sceneId: "scene-1", data: [{ x: 10, y: 20 }] },
  "scene.note.update-many": { sceneId: "scene-1", patches: [{ id: "note-1", patch: { text: "X" } }] },
  "scene.note.delete-many": { sceneId: "scene-1", ids: ["note-1"] },

  "scene.drawing.create-many": { sceneId: "scene-1", data: [{ x: 1, y: 2 }] },
  "scene.drawing.update-many": { sceneId: "scene-1", patches: [{ id: "drw-1", patch: { x: 1 } }] },
  "scene.drawing.delete-many": { sceneId: "scene-1", ids: ["drw-1"] },
  "scene.light.create-many": { sceneId: "scene-1", data: [{ x: 1, y: 2 }] },
  "scene.light.update-many": { sceneId: "scene-1", patches: [{ id: "lgt-1", patch: { x: 1 } }] },
  "scene.light.delete-many": { sceneId: "scene-1", ids: ["lgt-1"] },
  "scene.template.create-many": { sceneId: "scene-1", data: [{ t: "circle", x: 1, y: 2, distance: 5 }] },
  "scene.template.update-many": {
    sceneId: "scene-1",
    patches: [{ id: "tpl-1", patch: { distance: 9 } }]
  },
  "scene.template.delete-many": { sceneId: "scene-1", ids: ["tpl-1"] },
  "scene.region.create-many": { sceneId: "scene-1", data: [{ name: "Zone" }] },
  "scene.region.update-many": { sceneId: "scene-1", patches: [{ id: "rgn-1", patch: { name: "Zone" } }] },
  "scene.region.delete-many": { sceneId: "scene-1", ids: ["rgn-1"] },

  "actor.effect.create-many": { actorId: "actor-1", data: [{ name: "Bless" }] },
  "actor.effect.update-many": {
    actorId: "actor-1",
    patches: [{ id: "eff-1", patch: { disabled: true } }]
  },
  "actor.effect.delete-many": { actorId: "actor-1", ids: ["eff-1"] },
  "item.effect.create-many": { itemId: "item-1", data: [{ name: "Bless" }] },
  "item.effect.update-many": { itemId: "item-1", patches: [{ id: "eff-1", patch: { disabled: true } }] },
  "item.effect.delete-many": { itemId: "item-1", ids: ["eff-1"] },
  "actor.item.effect.create-many": { actorId: "actor-1", itemId: "item-1", data: [{ name: "Bless" }] },
  "actor.item.effect.update-many": {
    actorId: "actor-1",
    itemId: "item-1",
    patches: [{ id: "eff-1", patch: { disabled: true } }]
  },
  "actor.item.effect.delete-many": { actorId: "actor-1", itemId: "item-1", ids: ["eff-1"] },
  "scene.token.effect.create-many": { sceneId: "scene-1", tokenId: "token-1", data: [{ name: "Bless" }] },
  "scene.token.effect.update-many": {
    sceneId: "scene-1",
    tokenId: "token-1",
    patches: [{ id: "eff-1", patch: { disabled: true } }]
  },
  "scene.token.effect.delete-many": { sceneId: "scene-1", tokenId: "token-1", ids: ["eff-1"] },
  "scene.token.item.effect.create-many": {
    sceneId: "scene-1",
    tokenId: "token-1",
    itemId: "item-1",
    data: [{ name: "Bless" }]
  },
  "scene.token.item.effect.update-many": {
    sceneId: "scene-1",
    tokenId: "token-1",
    itemId: "item-1",
    patches: [{ id: "eff-1", patch: { disabled: true } }]
  },
  "scene.token.item.effect.delete-many": {
    sceneId: "scene-1",
    tokenId: "token-1",
    itemId: "item-1",
    ids: ["eff-1"]
  },
  "item.update-many": { patches: [{ id: "item-1", patch: { name: "Sword" } }] },
  "item.delete-many": { ids: ["item-1"] },
  "actor.update-many": { patches: [{ id: "actor-1", patch: { name: "Hero" } }] },
  "actor.delete-many": { ids: ["actor-1"] },
  "journal.update-many": { patches: [{ id: "journal-1", patch: { name: "Notes" } }] },
  "journal.delete-many": { ids: ["journal-1"] },
  "scene.note.create": { sceneId: "scene-1", data: { x: 10, y: 20 } },
  "scene.note.update": { sceneId: "scene-1", noteId: "note-1", patch: { text: "X" } },
  "scene.note.delete": { sceneId: "scene-1", noteId: "note-1" },
  "scene.note.clone": { sceneId: "scene-1", noteId: "note-1" },
  "scene.drawing.create": { sceneId: "scene-1", data: { x: 10, y: 20 } },
  "scene.drawing.update": { sceneId: "scene-1", drawingId: "draw-1", patch: { text: "X" } },
  "scene.drawing.delete": { sceneId: "scene-1", drawingId: "draw-1" },
  "scene.drawing.clone": { sceneId: "scene-1", drawingId: "draw-1" },
  "scene.light.create": { sceneId: "scene-1", data: { x: 10, y: 20 } },
  "scene.light.update": { sceneId: "scene-1", lightId: "light-1", patch: { config: { dim: 30 } } },
  "scene.light.delete": { sceneId: "scene-1", lightId: "light-1" },
  "scene.light.clone": { sceneId: "scene-1", lightId: "light-1" },
  "scene.template.create": { sceneId: "scene-1", data: { t: "circle", x: 10, y: 20 } },
  "scene.template.update": { sceneId: "scene-1", templateId: "tmpl-1", patch: { distance: 30 } },
  "scene.template.delete": { sceneId: "scene-1", templateId: "tmpl-1" },
  "scene.template.clone": { sceneId: "scene-1", templateId: "tmpl-1" },
  "scene.region.create": { sceneId: "scene-1", data: { name: "Zone" } },
  "scene.region.update": { sceneId: "scene-1", regionId: "region-1", patch: { name: "X" } },
  "scene.region.delete": { sceneId: "scene-1", regionId: "region-1" },
  "scene.region.clone": { sceneId: "scene-1", regionId: "region-1" },
  "item.create": { data: { name: "X", type: "loot" } },
  "item.update": { itemId: "item-1", patch: { name: "X" } },
  "item.delete": { itemId: "item-1" },
  "item.clone": { itemId: "item-1" },
  "journal.create": { data: { name: "X" } },
  "journal.update": { journalId: "j-1", patch: { name: "X" } },
  "journal.delete": { journalId: "j-1" },
  "journal.clone": { journalId: "j-1" },
  "macro.create": { data: { name: "X" } },
  "macro.update": { macroId: "macro-1", patch: { name: "X" } },
  "macro.delete": { macroId: "macro-1" },
  "macro.clone": { macroId: "macro-1" },
  "actor.create": { data: { name: "X", type: "npc" } },
  "actor.update": { actorId: "actor-1", patch: { name: "X" } },
  "actor.delete": { actorId: "actor-1" },
  "actor.clone": { actorId: "actor-1" },
  "actor.item.create": { actorId: "actor-1", data: { name: "X", type: "loot" } },
  "actor.item.update": { actorId: "actor-1", itemId: "item-1", patch: { name: "X" } },
  "actor.item.delete": { actorId: "actor-1", itemId: "item-1" },
  "actor.item.clone": { actorId: "actor-1", itemId: "item-1" },
  "actor.effect.create": { actorId: "actor-1", data: { name: "Aura" } },
  "actor.effect.update": { actorId: "actor-1", effectId: "eff-1", patch: { name: "X" } },
  "actor.effect.delete": { actorId: "actor-1", effectId: "eff-1" },
  "actor.effect.clone": { actorId: "actor-1", effectId: "eff-1" },
  "item.effect.create": { itemId: "item-1", data: { name: "Aura" } },
  "item.effect.update": { itemId: "item-1", effectId: "eff-1", patch: { name: "X" } },
  "item.effect.delete": { itemId: "item-1", effectId: "eff-1" },
  "item.effect.clone": { itemId: "item-1", effectId: "eff-1" },
  "actor.item.effect.create": { actorId: "actor-1", itemId: "item-1", data: { name: "Aura" } },
  "actor.item.effect.update": {
    actorId: "actor-1",
    itemId: "item-1",
    effectId: "eff-1",
    patch: { name: "X" }
  },
  "actor.item.effect.delete": { actorId: "actor-1", itemId: "item-1", effectId: "eff-1" },
  "actor.item.effect.clone": { actorId: "actor-1", itemId: "item-1", effectId: "eff-1" },
  "actor.import-from-compendium": { pack: "world.x", entryId: "e-1" },
  "actor.item.import-from-compendium": { actorId: "actor-1", pack: "world.x", entryId: "e-1" },

  "item.import-from-compendium": { pack: "world.x", entryId: "e-1" },
  "journal.import-from-compendium": { pack: "world.x", entryId: "e-1" },
  "scene.import-from-compendium": { pack: "world.x", entryId: "e-1" },
  "macro.import-from-compendium": { pack: "world.x", entryId: "e-1" },
  "playlist.import-from-compendium": { pack: "world.x", entryId: "e-1" },
  "table.import-from-compendium": { pack: "world.x", entryId: "e-1" },
  "cards.import-from-compendium": { pack: "world.x", entryId: "e-1" },
  "playlist.create": { data: { name: "X" } },
  "playlist.update": { playlistId: "pl-1", patch: { name: "X" } },
  "playlist.delete": { playlistId: "pl-1" },
  "playlist.clone": { playlistId: "pl-1" },
  "playlist.sound.create": { playlistId: "pl-1", data: { path: "a.ogg" } },
  "playlist.sound.update": { playlistId: "pl-1", soundId: "s-1", patch: { volume: 0.5 } },
  "playlist.sound.delete": { playlistId: "pl-1", soundId: "s-1" },
  "playlist.sound.clone": { playlistId: "pl-1", soundId: "s-1" },
  "playlist.play": { playlistId: "pl-1" },
  "playlist.stop": { playlistId: "pl-1" },
  "playlist.playNext": { playlistId: "pl-1" },
  "playlist.sound.play": { playlistId: "pl-1", soundId: "s-1" },
  "playlist.sound.stop": { playlistId: "pl-1", soundId: "s-1" },
  "chat.create": { data: { content: "hi" } },
  "chat.delete": { messageId: "msg-1" },
  "folder.create": { data: { name: "X", type: "Item" } },
  "folder.update": { folderId: "folder-1", patch: { name: "Y" } },
  "folder.delete": { folderId: "folder-1" },
  "file.mkdir": { path: "worlds/w/fvtt-world-cli/x" },
  "file.upload": { path: "worlds/w/fvtt-world-cli/x.txt", contentBase64: "QQ==" },
  "file.delete": { path: "worlds/w/fvtt-world-cli/x.txt" },
  "file.move": { from: "worlds/w/fvtt-world-cli/a.txt", to: "worlds/w/fvtt-world-cli/b.txt" },
  "actor.ownership.set": { actorId: "actor-1", default: 2 },
  "item.ownership.set": { itemId: "item-1", default: 0 },
  "scene.ownership.set": { sceneId: "scene-1", users: { "user-1": 3 } },
  "macro.ownership.set": { macroId: "macro-1", default: 1 },
  "playlist.ownership.set": { playlistId: "pl-1", default: 2 },
  "journal.ownership.set": { journalId: "j-1", pageId: "page-1", default: -1 },

  "journal.category.create": { journalId: "j-1", data: { name: "Chapter One" } },
  "journal.category.update": { journalId: "j-1", categoryId: "cat-1", patch: { name: "X" } },
  "journal.category.delete": { journalId: "j-1", categoryId: "cat-1" },

  "scene.region.behavior.create": {
    sceneId: "scene-1",
    regionId: "region-1",
    data: { type: "pauseGame" }
  },
  "scene.region.behavior.update": {
    sceneId: "scene-1",
    regionId: "region-1",
    behaviorId: "beh-1",
    patch: { name: "X" }
  },
  "scene.region.behavior.delete": { sceneId: "scene-1", regionId: "region-1", behaviorId: "beh-1" },
  "scene.region.behavior.clone": { sceneId: "scene-1", regionId: "region-1", behaviorId: "beh-1" },
  "table.create": { data: { name: "X" } },
  "table.update": { tableId: "tbl-1", patch: { name: "X" } },
  "table.delete": { tableId: "tbl-1" },
  "table.clone": { tableId: "tbl-1" },
  "table.ownership.set": { tableId: "tbl-1", default: 2 },
  "table.result.create": { tableId: "tbl-1", data: { range: [1, 1] } },
  "table.result.update": { tableId: "tbl-1", resultId: "res-1", patch: { name: "X" } },
  "table.result.delete": { tableId: "tbl-1", resultId: "res-1" },
  "table.result.clone": { tableId: "tbl-1", resultId: "res-1" },

  "table.draw": { tableId: "tbl-1", idempotencyKey: "draw-1" },
  "table.reset": { tableId: "tbl-1" },

  "cards.create": { data: { name: "Deck", type: "deck" } },
  "cards.update": { cardsId: "crd-1", patch: { sort: 3 } },
  "cards.delete": { cardsId: "crd-1" },
  "cards.clone": { cardsId: "crd-1" },
  "cards.ownership.set": { cardsId: "crd-1", default: 2 },

  "cards.card.create": { cardsId: "crd-1", data: { name: "Ace of Spades" } },
  "cards.card.update": { cardsId: "crd-1", cardId: "crd-card-1", patch: { face: 0 } },
  "cards.card.delete": { cardsId: "crd-1", cardId: "crd-card-1" },
  "cards.card.clone": { cardsId: "crd-1", cardId: "crd-card-1" },

  "cards.shuffle": { cardsId: "crd-1" },
  "cards.reset": { cardsId: "crd-1" },
  "cards.deal": { cardsId: "crd-1", to: ["crd-2"], idempotencyKey: "deal-1" },
  "cards.draw": { cardsId: "crd-1", from: "crd-2", idempotencyKey: "draw-1" },
  "cards.pass": { cardsId: "crd-1", to: "crd-2", cardIds: ["crd-card-1"], idempotencyKey: "pass-1" },

  "combat.create": { data: {} },
  "combat.update": { combatId: "cbt-1", patch: { sort: 3 } },
  "combat.delete": { combatId: "cbt-1" },

  "combat.combatant.create": { combatId: "cbt-1", data: {} },
  "combat.combatant.update": { combatId: "cbt-1", combatantId: "cmb-1", patch: { hidden: true } },
  "combat.combatant.delete": { combatId: "cbt-1", combatantId: "cmb-1" },
  "combat.group.create": { combatId: "cbt-1", data: {} },
  "combat.group.update": { combatId: "cbt-1", groupId: "grp-1", patch: { initiative: 12 } },
  "combat.group.delete": { combatId: "cbt-1", groupId: "grp-1" },

  "combat.start": { combatId: "cbt-1" },
  "combat.activate": { combatId: "cbt-1" },
  "combat.next-turn": { combatId: "cbt-1", idempotencyKey: "adv-1" },
  "combat.previous-turn": { combatId: "cbt-1", idempotencyKey: "adv-2" },
  "combat.next-round": { combatId: "cbt-1", idempotencyKey: "adv-3" },
  "combat.previous-round": { combatId: "cbt-1", idempotencyKey: "adv-4" },
  "combat.reset-initiative": { combatId: "cbt-1" },
  "combat.roll-initiative": { combatId: "cbt-1", combatantIds: ["cmb-1"], idempotencyKey: "roll-1" },
  "combat.set-initiative": { combatId: "cbt-1", combatantId: "cmb-1", initiative: 12 }
});

describe("schema validator `pattern` keyword", () => {
  const CONTROL_FREE = [
    "^[^",
    "\\u0000-\\u001f",
    "\\u007f-\\u009f",
    "\\u00ad",
    "\\u061c",
    "\\u180e",
    "\\u200b-\\u200f",
    "\\u2028\\u2029",
    "\\u202a-\\u202e",
    "\\u2060-\\u2064",
    "\\u2066-\\u2069",
    "\\ufeff",
    "\\ufff9-\\ufffb",
    "]+$"
  ].join("");

  const ESCAPE = String.fromCodePoint(0x1b);

  it("accepts a matching string and reports the constraint for a non-matching one", () => {
    const schema = { type: "string", pattern: "^[a-z]+$" };
    expect(validateSchema(schema, "label", "$.label")).toEqual([]);
    expect(validateSchema(schema, "Label", "$.label")).toEqual(["$.label must match ^[a-z]+$"]);
  });

  it("names the constraint without echoing the rejected value", () => {
    const errors = validateSchema({ type: "string", pattern: "^[a-z]+$" }, `${ESCAPE}[31mred`, "$.label");
    expect(errors).toEqual(["$.label must match ^[a-z]+$"]);
    expect(errors[0]).not.toContain(ESCAPE);
  });

  it("tests the pattern unanchored, leaving anchoring to the schema author", () => {
    expect(validateSchema({ type: "string", pattern: "ab" }, "xxabxx", "$.value")).toEqual([]);
    expect(validateSchema({ type: "string", pattern: "^ab$" }, "xxabxx", "$.value")).toEqual([
      "$.value must match ^ab$"
    ]);
  });

  it("applies unicode semantics so property escapes and astral characters match", () => {
    const letters = { type: "string", pattern: "^\\p{L}+$" };
    expect(validateSchema(letters, "Гамма", "$.label")).toEqual([]);
    expect(validateSchema(letters, "Gamemaster1", "$.label")).toEqual(["$.label must match ^\\p{L}+$"]);

    const die = String.fromCodePoint(0x1f3b2);
    const single = { type: "string", pattern: "^.$" };
    expect(validateSchema(single, die, "$.label")).toEqual([]);
    expect(validateSchema(single, `${die}${die}`, "$.label")).toEqual(["$.label must match ^.$"]);
  });

  it("leaves non-string values unconstrained, deferring to `type` alone", () => {
    expect(validateSchema({ pattern: "^[a-z]+$" }, 42, "$.value")).toEqual([]);
    expect(validateSchema({ pattern: "^[a-z]+$" }, null, "$.value")).toEqual([]);
    expect(validateSchema({ pattern: "^[a-z]+$" }, { nested: true }, "$.value")).toEqual([]);
    expect(validateSchema({ type: "string", pattern: "^[a-z]+$" }, 42, "$.value")).toEqual([
      "$.value must be string"
    ]);
  });

  it("rejects control, zero-width, and bidi-formatting code points through a negated class", () => {
    const schema = { type: "string", pattern: CONTROL_FREE };
    expect(validateSchema(schema, `Chrome ГМ ${String.fromCodePoint(0x1f3b2)}`, "$.label")).toEqual([]);

    for (const codePoint of [
      0x00, 0x07, 0x09, 0x0a, 0x1b, 0x7f, 0x85, 0xad, 0x61c, 0x180e, 0x200b, 0x200e, 0x200f, 0x2028, 0x2029,
      0x202e, 0x2060, 0x2066, 0x2069, 0xfeff, 0xfff9, 0xfffb
    ]) {
      const label = `Chrome${String.fromCodePoint(codePoint)}profile`;
      expect(validateSchema(schema, label, "$.label"), `U+${codePoint.toString(16)}`).toEqual([
        `$.label must match ${CONTROL_FREE}`
      ]);
    }
  });

  it("reports a pattern that cannot compile in unicode mode instead of throwing", () => {
    for (const pattern of ["^[a-z\\_]+$", "^a{b$", "^[\\w-\\.]+$", "^\\p{Nonexistent}+$"]) {
      expect(() => new RegExp(pattern, "u"), pattern).toThrow();
      expect(validateSchema({ type: "string", pattern }, "chrome", "$.label"), pattern).toEqual([
        `$.label cannot be validated: ${pattern} is not a valid unicode-mode pattern`
      ]);
    }
  });

  it("keeps validating the rest of an object when a nested pattern cannot compile", () => {
    const schema = {
      type: "object",
      required: ["code"],
      properties: { label: { type: "string", pattern: "^[a-z\\_]+$" } },
      additionalProperties: false
    };

    expect(validateSchema(schema, { label: "chrome" }, "$.identity")).toEqual([
      "$.identity.code is required",
      "$.identity.label cannot be validated: ^[a-z\\_]+$ is not a valid unicode-mode pattern"
    ]);
  });

  it("accumulates a pattern failure alongside the other string keyword failures", () => {
    expect(validateSchema({ type: "string", maxLength: 3, pattern: "^[a-z]+$" }, "ABCD", "$.label")).toEqual([
      "$.label must be at most 3 characters long",
      "$.label must match ^[a-z]+$"
    ]);
  });
});

describe("protocol transport registry", () => {
  it("derives exhaustive closed message coverage from MESSAGE_TYPES", () => {
    expect(Object.keys(TRANSPORT_MESSAGE_SCHEMAS).sort()).toEqual(Object.values(MESSAGE_TYPES).sort());
    for (const [type, schema] of Object.entries(TRANSPORT_MESSAGE_SCHEMAS)) {
      expect(schema.additionalProperties, type).toBe(false);
      expect(schema.properties.type.const, type).toBe(type);
      expect(moduleProtocol.TRANSPORT_MESSAGE_SCHEMAS[type]).toEqual(schema);
    }
  });

  it("derives exhaustive daemon operation coverage and keeps every params schema closed", () => {
    expect(Object.keys(DAEMON_OPERATION_DEFINITIONS).sort()).toEqual(
      [...moduleProtocol.DAEMON_OPERATIONS].sort()
    );
    for (const [operation, definition] of Object.entries(DAEMON_OPERATION_DEFINITIONS)) {
      expect(definition.paramsSchema.additionalProperties, operation).toBe(false);
      expect(DAEMON_REQUEST_VARIANT_SCHEMAS[operation].properties.params).toBe(definition.paramsSchema);
    }
    expect(DAEMON_REQUEST_SCHEMA.oneOf).toEqual(Object.values(DAEMON_REQUEST_VARIANT_SCHEMAS));
  });

  it("freezes every exported registry recursively, not just the top-level table", () => {
    const unfrozen = [];
    const seen = new WeakSet();
    const walk = (value, valuePath) => {
      if (value === null || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      if (!Object.isFrozen(value)) unfrozen.push(valuePath);
      for (const key of Object.keys(value)) walk(value[key], `${valuePath}.${key}`);
    };

    const rootNames = Object.keys(protocol);
    expect(rootNames).toContain("COMMAND_DEFINITIONS");
    for (const rootName of rootNames) walk(protocol[rootName], rootName);
    expect(unfrozen).toEqual([]);

    const patchProperty = COMMAND_DEFINITIONS["actor.update"].paramsSchema.properties.patch.properties.name;
    expect(Object.isFrozen(patchProperty)).toBe(true);
    expect(() => {
      patchProperty.minLength = 99;
    }).toThrow(TypeError);

    const requestRequired = TRANSPORT_MESSAGE_SCHEMAS[MESSAGE_TYPES.COMMAND_REQUEST].required;
    expect(Object.isFrozen(requestRequired)).toBe(true);
    expect(() => requestRequired.push("nope")).toThrow(TypeError);

    const approveCode = DAEMON_OPERATION_DEFINITIONS["auth.approve"].paramsSchema.properties.code;
    expect(Object.isFrozen(approveCode)).toBe(true);
    expect(() => {
      approveCode.maxLength = 99;
    }).toThrow(TypeError);
  });

  it("keeps derived patch property ORDER stable, because schema --json prints it verbatim", () => {
    expect(
      Object.keys(
        COMMAND_DEFINITIONS["journal.update"].paramsSchema.properties.patch.properties.pages.items.properties
      ),
      "a page patch declares id FIRST: appending it would change the schema --json bytes"
    ).toEqual([
      "id",
      "name",
      "type",
      "sort",
      "text",
      "title",
      "image",
      "video",
      "src",
      "category",
      "system",
      "flags"
    ]);

    const patchOrder = (command) =>
      Object.keys(COMMAND_DEFINITIONS[command].paramsSchema.properties.patch.properties);
    expect(patchOrder("item.update")).toEqual(["name", "img", "folder", "sort", "system", "flags"]);
    expect(patchOrder("cards.update")).toEqual([
      "name",
      "description",
      "img",
      "system",
      "width",
      "height",
      "rotation",
      "displayCount",
      "folder",
      "sort",
      "flags"
    ]);
    expect(patchOrder("combat.combatant.update")).toEqual([
      "system",
      "actorId",
      "tokenId",
      "sceneId",
      "name",
      "img",
      "hidden",
      "defeated",
      "group",
      "roundJoined",
      "flags"
    ]);
  });

  it.each([
    ["auth.status", {}],
    ["auth.pending", {}],
    ["auth.approve", {}],
    ["auth.approve", { code: "23456789" }],
    ["auth.deny", { code: "23456789" }],
    ["auth.await", {}],
    ["auth.await", { timeoutMs: 0 }],
    ["auth.await", { timeoutMs: 1000 }],
    ["auth.await", { timeoutMs: AUTH_AWAIT_PARK_CAP_MS }],
    ["auth.list", {}],
    ["auth.prune", {}],
    ["auth.prune", { olderThanDays: 0 }],
    ["auth.prune", { olderThanDays: AUTH_PRUNE_DEFAULT_DAYS }],
    ["auth.revoke", { pairingId: "pair-1" }],
    ["auth.rotate-client", {}],
    ["bridge.release", {}]
  ])("accepts the typed %s params", (operation, params) => {
    expect(
      validateDaemonRequest({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.DAEMON_REQUEST,
        id: "control-1",
        operation,
        params
      })
    ).toEqual({ ok: true, errors: [] });
  });

  it("declares no pairing-label operation, so a label is only chosen at pairing time", () => {
    expect(Object.keys(DAEMON_OPERATION_DEFINITIONS)).not.toContain("auth.rename");
    expect(moduleProtocol.DAEMON_OPERATIONS).not.toContain("auth.rename");
    expect(Object.keys(DAEMON_OPERATION_DEFINITIONS["auth.approve"].paramsSchema.properties)).toEqual([
      "code"
    ]);
    expect(
      validateDaemonRequest({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.DAEMON_REQUEST,
        id: "control-1",
        operation: "auth.approve",
        params: { code: "23456789", label: "Chrome" }
      }).ok
    ).toBe(false);
  });

  it("rejects missing required and unknown daemon operation params", () => {
    expect(
      validateDaemonRequest({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.DAEMON_REQUEST,
        id: "control-1",
        operation: "auth.revoke",
        params: {}
      }).ok
    ).toBe(false);
    expect(
      validateDaemonRequest({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.DAEMON_REQUEST,
        id: "control-1",
        operation: "auth.status",
        params: { surprise: true }
      }).ok
    ).toBe(false);
  });

  it("bounds a pairing wait's park request to a whole number of milliseconds under the cap", () => {
    for (const params of [
      { timeoutMs: AUTH_AWAIT_PARK_CAP_MS + 1 },
      { timeoutMs: -1 },
      { timeoutMs: 1.5 },
      { timeoutMs: "1000" },
      { forever: true }
    ]) {
      expect(
        validateDaemonRequest({
          protocolVersion: PROTOCOL_VERSION,
          type: MESSAGE_TYPES.DAEMON_REQUEST,
          id: "control-1",
          operation: "auth.await",
          params
        }).ok,
        JSON.stringify(params)
      ).toBe(false);
    }
  });

  it("bounds a prune cutoff to a whole non-negative number of days", () => {
    for (const params of [
      { olderThanDays: -1 },
      { olderThanDays: 1.5 },
      { olderThanDays: "30" },
      { olderThanDays: null },
      { olderThan: 30 }
    ]) {
      expect(
        validateDaemonRequest({
          protocolVersion: PROTOCOL_VERSION,
          type: MESSAGE_TYPES.DAEMON_REQUEST,
          id: "control-1",
          operation: "auth.prune",
          params
        }).ok,
        JSON.stringify(params)
      ).toBe(false);
    }
  });

  it("enforces success and failure fields on response envelopes", () => {
    expect(
      validateTransportMessage({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.DAEMON_RESPONSE,
        id: "control-1",
        operation: "auth.revoke",
        ok: true
      }).ok
    ).toBe(false);
    expect(
      validateTransportMessage({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.PAIRING_RESULT,
        ok: false
      }).ok
    ).toBe(false);
    expect(
      validateTransportMessage({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.BRIDGE_GOODBYE,
        extra: true
      }).ok
    ).toBe(false);
  });

  it("allows daemon error responses to echo an invalid requested operation", () => {
    expect(
      validateTransportMessage({
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.DAEMON_RESPONSE,
        id: "control-invalid",
        operation: "unknown.operation",
        ok: false,
        error: { code: "INVALID_MESSAGE", message: "Invalid transport message" }
      })
    ).toEqual({ ok: true, errors: [] });
  });
});

describe("upload limit + derived WS caps", () => {
  const MiB = 1024 * 1024;

  it("pins the default upload limit at 100 MiB and the ceiling at 512 MiB", () => {
    expect(DEFAULT_UPLOAD_SIZE_LIMIT_BYTES).toBe(100 * MiB);
    expect(UPLOAD_SIZE_LIMIT_MAX_BYTES).toBe(512 * MiB);
  });

  it("derives the WS frame cap as ceil(limit*4/3) + 1 MiB", () => {
    expect(wsMaxPayloadForUploadLimit(100 * MiB)).toBe(Math.ceil((100 * MiB * 4) / 3) + MiB);

    expect(DEFAULT_WS_MAX_PAYLOAD_BYTES).toBe(wsMaxPayloadForUploadLimit(DEFAULT_UPLOAD_SIZE_LIMIT_BYTES));
    expect(DEFAULT_WS_MAX_PAYLOAD_BYTES).toBeGreaterThan(DEFAULT_UPLOAD_SIZE_LIMIT_BYTES);
  });

  it("keeps the derived cap monotonic and always above the base64-inflated need", () => {
    let previous = 0;
    for (const limit of [1 * MiB, 8 * MiB, 100 * MiB, 200 * MiB, 512 * MiB]) {
      const cap = wsMaxPayloadForUploadLimit(limit);
      expect(cap).toBeGreaterThan(previous);

      expect(cap).toBeGreaterThan(Math.ceil((limit * 4) / 3));
      previous = cap;
    }
  });

  it("floors the effective WS cap at the default for a sub-default upload limit", () => {
    const low = resolveEffectiveLimits(10 * MiB);
    expect(low.uploadBytes).toBe(10 * MiB);
    expect(low.wsMaxPayloadBytes).toBe(DEFAULT_WS_MAX_PAYLOAD_BYTES);

    const high = resolveEffectiveLimits(200 * MiB);
    expect(high.uploadBytes).toBe(200 * MiB);
    expect(high.wsMaxPayloadBytes).toBe(wsMaxPayloadForUploadLimit(200 * MiB));
    expect(high.wsMaxPayloadBytes).toBeGreaterThan(DEFAULT_WS_MAX_PAYLOAD_BYTES);
  });

  it("defaults to the default upload limit when called with no argument", () => {
    expect(resolveEffectiveLimits()).toEqual({
      uploadBytes: DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
      wsMaxPayloadBytes: DEFAULT_WS_MAX_PAYLOAD_BYTES
    });
  });
});

describe("protocol contract", () => {
  it("accepts a valid bridge hello envelope", () => {
    const message = createBridgeHello({
      pairingId: "pairing-1",
      credential: "a".repeat(43),
      clientId: CLIENT_ID,
      session: {
        moduleId: "fvtt-world-cli",
        moduleVersion: "0.1.0",
        world: {
          id: "world-1",
          title: "Automation Test World"
        },
        user: {
          id: "user-1",
          name: "GM",
          isGM: true
        },
        commands: COMMAND_NAMES
      }
    });

    expect(validateHelloMessage(message)).toEqual({ ok: true, errors: [] });
  });

  it("accepts a hello advertising a command the daemon does not know (forward-compat, no hard enum)", () => {
    const message = createBridgeHello({
      pairingId: "pairing-1",
      credential: "a".repeat(43),
      clientId: CLIENT_ID,
      session: {
        moduleId: "fvtt-world-cli",
        moduleVersion: "9.9.9",
        world: { id: "world-1", title: "Automation Test World" },
        user: { id: "user-1", name: "GM", isGM: true },
        commands: [...COMMAND_NAMES, "some.future.command"]
      }
    });

    expect(validateHelloMessage(message)).toEqual({ ok: true, errors: [] });
  });

  it("still rejects a hello whose advertised commands are not non-empty strings", () => {
    const message = createBridgeHello({
      pairingId: "pairing-1",
      credential: "a".repeat(43),
      clientId: CLIENT_ID,
      session: {
        moduleId: "fvtt-world-cli",
        moduleVersion: "0.1.0",
        world: { id: "world-1", title: "Automation Test World" },
        user: { id: "user-1", name: "GM", isGM: true },
        commands: [""]
      }
    });

    const result = validateHelloMessage(message);
    expect(result.ok).toBe(false);
  });

  describe("per-client pairing identity", () => {
    const helloSession = {
      moduleId: "fvtt-world-cli",
      moduleVersion: "0.1.0",
      world: { id: "world-1", title: "Automation Test World" },
      user: { id: "user-1", name: "GM", isGM: true },
      commands: ["system.ping"]
    };

    const pairingRequest = (client) => ({
      protocolVersion: PROTOCOL_VERSION,
      type: MESSAGE_TYPES.PAIRING_REQUEST,
      identity: {
        moduleId: "fvtt-world-cli",
        moduleVersion: "0.1.0",
        world: { id: "world-1", title: "Automation Test World" },
        user: { id: "user-1", name: "GM", isGM: true },
        ...(client === undefined ? {} : { client })
      }
    });

    it("requires a client id and label on a pairing request", () => {
      expect(validateTransportMessage(pairingRequest({ id: CLIENT_ID, label: "Zen Browser" }))).toEqual({
        ok: true,
        errors: []
      });
      expect(validateTransportMessage(pairingRequest()).ok).toBe(false);
      expect(validateTransportMessage(pairingRequest({ id: CLIENT_ID })).ok).toBe(false);
      expect(validateTransportMessage(pairingRequest({ label: "Zen Browser" })).ok).toBe(false);
      expect(
        validateTransportMessage(pairingRequest({ id: CLIENT_ID, label: "Zen Browser", nickname: "extra" }))
          .ok
      ).toBe(false);
    });

    it("accepts a Unicode label up to the cap and rejects an empty or oversized one", () => {
      for (const label of ["Зен браузер", `Chrome ${String.fromCodePoint(0x1f3b2)}`, "x".repeat(64)]) {
        expect(validateTransportMessage(pairingRequest({ id: CLIENT_ID, label })).ok, label).toBe(true);
      }
      for (const label of ["", "x".repeat(65), 42, null]) {
        expect(validateTransportMessage(pairingRequest({ id: CLIENT_ID, label })).ok, String(label)).toBe(
          false
        );
      }
    });

    it("rejects a whitespace-only label", () => {
      for (const label of [
        " ",
        "   ",
        "\t",
        String.fromCodePoint(0x00a0),
        String.fromCodePoint(0x2000),
        String.fromCodePoint(0x3000)
      ]) {
        expect(
          validateTransportMessage(pairingRequest({ id: CLIENT_ID, label })).ok,
          JSON.stringify(label)
        ).toBe(false);
      }
      expect(validateTransportMessage(pairingRequest({ id: CLIENT_ID, label: " Zen Browser " })).ok).toBe(
        true
      );
    });

    it("rejects a label carrying control, escape, zero-width, or tag characters", () => {
      for (const codePoint of [
        0x00, 0x07, 0x09, 0x0a, 0x1b, 0x7f, 0x85, 0xad, 0x200b, 0x200e, 0x202e, 0xfeff, 0xe0000, 0xe0041,
        0xe007f
      ]) {
        const label = `Chrome${String.fromCodePoint(codePoint)}profile`;
        const result = validateTransportMessage(pairingRequest({ id: CLIENT_ID, label }));
        expect(result.ok, `U+${codePoint.toString(16)}`).toBe(false);
        expect(result.errors.join(" ")).not.toContain(String.fromCodePoint(codePoint));
      }
    });

    it("bounds the client id to hex and dashes within a length range", () => {
      for (const id of [CLIENT_ID, "abcdef01", "a".repeat(64)]) {
        expect(validateTransportMessage(pairingRequest({ id, label: "Zen Browser" })).ok, id).toBe(true);
      }
      for (const id of ["abcdef0", "a".repeat(65), "client id", "zzzzzzzz", ""]) {
        expect(validateTransportMessage(pairingRequest({ id, label: "Zen Browser" })).ok, id).toBe(false);
      }
    });

    it("requires the same client id on a bridge hello beside the pairing credential", () => {
      const accepted = createBridgeHello({
        pairingId: "pairing-1",
        credential: "a".repeat(43),
        clientId: CLIENT_ID,
        session: helloSession
      });
      expect(validateHelloMessage(accepted)).toEqual({ ok: true, errors: [] });
      expect(accepted.session).toEqual(helloSession);

      const { clientId: _clientId, ...withoutClientId } = accepted;
      expect(validateHelloMessage(withoutClientId).ok).toBe(false);
      expect(validateHelloMessage({ ...accepted, clientId: "client id" }).ok).toBe(false);
    });

    it("pins the protocol version the daemon and module must share exactly", () => {
      expect(PROTOCOL_VERSION).toBe("1.1.0");
    });
  });

  describe("protocol version mismatch details", () => {
    const { MODULE, CLI_DAEMON, UNKNOWN } = PROTOCOL_COMPONENTS;
    const LEGACY_VERSION = "3.0";
    const HIGHER_VERSION = "9.9.0";

    it("maps the one pre-lockstep protocol value onto its release and passes releases through", () => {
      expect(normalizeComparableProtocolVersion(LEGACY_VERSION)).toBe("1.0.0");
      expect(normalizeComparableProtocolVersion(PROTOCOL_VERSION)).toBe(PROTOCOL_VERSION);
      expect(normalizeComparableProtocolVersion("2.10.3")).toBe("2.10.3");
    });

    it("reports every other spelling as not comparable instead of parsing it", () => {
      for (const value of [
        "3.1",
        "abc",
        "",
        "1.1",
        "1.1.0-rc1",
        "1.1.0.1",
        "v1.1.0",
        " 1.1.0",
        undefined,
        null,
        1.1
      ]) {
        expect(normalizeComparableProtocolVersion(value), String(value)).toBeNull();
      }
    });

    it("pins the component and handshake literals callers may report", () => {
      expect(PROTOCOL_COMPONENTS).toEqual({
        MODULE: "module",
        CLI_DAEMON: "cli-daemon",
        UNKNOWN: "unknown"
      });
      expect(PROTOCOL_HANDSHAKES).toEqual({
        CLI_DAEMON: "cli-daemon",
        MODULE_DAEMON: "module-daemon",
        COMMAND_REQUEST: "command-request",
        DAEMON_REQUEST: "daemon-request",
        UNKNOWN: "unknown"
      });
      expect(Object.isFrozen(PROTOCOL_COMPONENTS)).toBe(true);
      expect(Object.isFrozen(PROTOCOL_HANDSHAKES)).toBe(true);
      expect(moduleProtocol.PROTOCOL_COMPONENTS).toEqual({ ...PROTOCOL_COMPONENTS });
      expect(moduleProtocol.PROTOCOL_HANDSHAKES).toEqual({ ...PROTOCOL_HANDSHAKES });
    });

    it("blames the peer that reports the lower release, on either side of the connection", () => {
      const fromModule = getProtocolVersionError(LEGACY_VERSION, {
        peer: CLI_DAEMON,
        reporter: MODULE,
        handshake: PROTOCOL_HANDSHAKES.COMMAND_REQUEST
      });
      expect(fromModule.code).toBe(ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION);
      expect(fromModule.details).toEqual({
        expectedVersion: PROTOCOL_VERSION,
        actualVersion: LEGACY_VERSION,
        staleComponent: CLI_DAEMON,
        handshake: "command-request"
      });
      expect(fromModule.message).toContain("update the fvtt-world-cli package");

      const fromDaemon = getProtocolVersionError(LEGACY_VERSION, {
        peer: MODULE,
        reporter: CLI_DAEMON,
        handshake: PROTOCOL_HANDSHAKES.MODULE_DAEMON
      });
      expect(fromDaemon.details).toEqual({
        expectedVersion: PROTOCOL_VERSION,
        actualVersion: LEGACY_VERSION,
        staleComponent: MODULE,
        handshake: "module-daemon"
      });
      expect(fromDaemon.message).toContain("update the module in Foundry");
      expect(fromDaemon.message).toContain("refused by design");
    });

    it("blames the reporting side when the peer reports the higher release", () => {
      expect(
        getProtocolVersionError(HIGHER_VERSION, {
          peer: MODULE,
          reporter: CLI_DAEMON,
          handshake: PROTOCOL_HANDSHAKES.MODULE_DAEMON
        }).details
      ).toEqual({
        expectedVersion: PROTOCOL_VERSION,
        actualVersion: HIGHER_VERSION,
        staleComponent: CLI_DAEMON,
        handshake: "module-daemon"
      });

      expect(
        getProtocolVersionError("1.2.0", {
          peer: CLI_DAEMON,
          reporter: MODULE,
          handshake: PROTOCOL_HANDSHAKES.COMMAND_REQUEST
        }).details
      ).toEqual({
        expectedVersion: PROTOCOL_VERSION,
        actualVersion: "1.2.0",
        staleComponent: MODULE,
        handshake: "command-request"
      });
    });

    it("names the same component on both ends of a CLI-to-daemon skew", () => {
      expect(
        getProtocolVersionError(LEGACY_VERSION, {
          peer: CLI_DAEMON,
          reporter: CLI_DAEMON,
          handshake: PROTOCOL_HANDSHAKES.CLI_DAEMON
        }).details
      ).toEqual({
        expectedVersion: PROTOCOL_VERSION,
        actualVersion: LEGACY_VERSION,
        staleComponent: CLI_DAEMON,
        handshake: "cli-daemon"
      });

      expect(
        getProtocolVersionError(HIGHER_VERSION, {
          peer: CLI_DAEMON,
          reporter: CLI_DAEMON,
          handshake: PROTOCOL_HANDSHAKES.CLI_DAEMON
        }).details.staleComponent
      ).toBe(CLI_DAEMON);

      expect(
        getProtocolVersionError(LEGACY_VERSION, {
          peer: CLI_DAEMON,
          reporter: CLI_DAEMON,
          handshake: PROTOCOL_HANDSHAKES.DAEMON_REQUEST
        }).details
      ).toEqual({
        expectedVersion: PROTOCOL_VERSION,
        actualVersion: LEGACY_VERSION,
        staleComponent: CLI_DAEMON,
        handshake: "daemon-request"
      });
    });

    it("refuses to guess when a version cannot be ordered or a side is unidentified", () => {
      const uncomparable = getProtocolVersionError("9.9", {
        peer: CLI_DAEMON,
        reporter: MODULE,
        handshake: PROTOCOL_HANDSHAKES.COMMAND_REQUEST
      });

      expect(uncomparable.details).toEqual({
        expectedVersion: PROTOCOL_VERSION,
        actualVersion: "9.9",
        staleComponent: UNKNOWN,
        handshake: "command-request"
      });
      expect(uncomparable.message).toContain("cannot be ordered");

      for (const options of [
        { peer: UNKNOWN, reporter: MODULE, handshake: PROTOCOL_HANDSHAKES.COMMAND_REQUEST },
        { peer: "browser", reporter: MODULE, handshake: PROTOCOL_HANDSHAKES.COMMAND_REQUEST }
      ]) {
        expect(getProtocolVersionError(LEGACY_VERSION, options).details.staleComponent).toBe(UNKNOWN);
      }

      expect(
        getProtocolVersionError(HIGHER_VERSION, {
          peer: MODULE,
          handshake: PROTOCOL_HANDSHAKES.MODULE_DAEMON
        }).details.staleComponent
      ).toBe(UNKNOWN);
    });

    it("still reports both versions when the caller identifies nothing", () => {
      const error = getProtocolVersionError(LEGACY_VERSION);

      expect(error.code).toBe(ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION);
      expect(error.details).toEqual({
        expectedVersion: PROTOCOL_VERSION,
        actualVersion: LEGACY_VERSION,
        staleComponent: UNKNOWN,
        handshake: "unknown"
      });
      expect(error.message).toContain("bring the fvtt-world-cli package and the Foundry module");
      expect(error.message).not.toContain("cannot be ordered");
    });

    it("carries the comparison and the enriched error into the module mirror", () => {
      expect(moduleProtocol.normalizeComparableProtocolVersion(LEGACY_VERSION)).toBe("1.0.0");
      expect(moduleProtocol.normalizeComparableProtocolVersion("1.1")).toBeNull();
      expect(
        moduleProtocol.getProtocolVersionError(LEGACY_VERSION, {
          peer: CLI_DAEMON,
          reporter: MODULE,
          handshake: PROTOCOL_HANDSHAKES.COMMAND_REQUEST
        }).details
      ).toEqual({
        expectedVersion: PROTOCOL_VERSION,
        actualVersion: LEGACY_VERSION,
        staleComponent: CLI_DAEMON,
        handshake: "command-request"
      });
    });
  });

  it("accepts file.list requests rooted at the data source", () => {
    const result = validate("file.list", {
      path: ""
    });

    expect(result).toEqual({ ok: true, errors: [] });
  });

  describe("file.list recursive params", () => {
    const validateFileList = (params) => validate("file.list", { path: "", ...params });

    it("pins the enumerated allowed param field set", () => {
      expect(Object.keys(COMMAND_DEFINITIONS["file.list"].paramsSchema.properties).sort()).toEqual([
        "limit",
        "maxDepth",
        "maxEntries",
        "offset",
        "path",
        "recursive"
      ]);
    });

    it("accepts recursive with in-range maxDepth/maxEntries", () => {
      expect(validateFileList({ recursive: true })).toEqual({ ok: true, errors: [] });
      expect(validateFileList({ recursive: true, maxDepth: 1, maxEntries: 1 })).toEqual({
        ok: true,
        errors: []
      });
      expect(validateFileList({ recursive: true, maxDepth: 10, maxEntries: 2000 })).toEqual({
        ok: true,
        errors: []
      });
    });

    it("rejects maxDepth outside 1..10", () => {
      expect(validateFileList({ recursive: true, maxDepth: 0 }).ok).toBe(false);
      expect(validateFileList({ recursive: true, maxDepth: 11 }).ok).toBe(false);
      expect(validateFileList({ recursive: true, maxDepth: 2.5 }).ok).toBe(false);
    });

    it("rejects maxEntries outside 1..2000", () => {
      expect(validateFileList({ recursive: true, maxEntries: 0 }).ok).toBe(false);
      expect(validateFileList({ recursive: true, maxEntries: 2001 }).ok).toBe(false);
      expect(validateFileList({ recursive: true, maxEntries: 10.5 }).ok).toBe(false);
    });

    it("rejects a non-boolean recursive", () => {
      expect(validateFileList({ recursive: "yes" }).ok).toBe(false);
    });
  });

  describe("file.move params + error code", () => {
    const validateMove = (params) => validate("file.move", params);

    it("is a registered mutation command", () => {
      expect(COMMAND_NAMES).toContain("file.move");
      expect(COMMAND_DEFINITIONS["file.move"].mutation).toBe(true);
      expect(isWriteCommand("file.move")).toBe(true);
    });

    it("pins the enumerated allowed param field set", () => {
      expect(Object.keys(COMMAND_DEFINITIONS["file.move"].paramsSchema.properties).sort()).toEqual([
        "dryRun",
        "from",
        "idempotencyKey",
        "to"
      ]);
      expect([...COMMAND_DEFINITIONS["file.move"].paramsSchema.required].sort()).toEqual(["from", "to"]);
    });

    it("accepts from/to with optional dryRun + idempotencyKey", () => {
      expect(
        validateMove({ from: "worlds/w/fvtt-world-cli/a.txt", to: "worlds/w/fvtt-world-cli/b.txt" })
      ).toEqual({
        ok: true,
        errors: []
      });
      expect(
        validateMove({
          from: "worlds/w/fvtt-world-cli/a.txt",
          to: "worlds/w/fvtt-world-cli/b.txt",
          dryRun: true,
          idempotencyKey: "k-1"
        })
      ).toEqual({ ok: true, errors: [] });
    });

    it("rejects a missing end, an empty path, and an unknown field", () => {
      expect(validateMove({ from: "worlds/w/fvtt-world-cli/a.txt" }).ok).toBe(false);
      expect(validateMove({ to: "worlds/w/fvtt-world-cli/b.txt" }).ok).toBe(false);
      expect(validateMove({ from: "", to: "worlds/w/fvtt-world-cli/b.txt" }).ok).toBe(false);
      expect(
        validateMove({
          from: "worlds/w/fvtt-world-cli/a.txt",
          to: "worlds/w/fvtt-world-cli/b.txt",
          bogus: true
        }).ok
      ).toBe(false);
    });

    it("exposes FILE_ALREADY_EXISTS in ERROR_CODES", () => {
      expect(ERROR_CODES.FILE_ALREADY_EXISTS).toBe("FILE_ALREADY_EXISTS");
    });
  });

  describe("world.audit-files params", () => {
    const validateAudit = (params) => validate("world.audit-files", params);

    it("is a registered, read-only command", () => {
      expect(COMMAND_NAMES).toContain("world.audit-files");
      expect(COMMAND_DEFINITIONS["world.audit-files"].mutation).toBe(false);
      expect(isWriteCommand("world.audit-files")).toBe(false);
    });

    it("pins the enumerated allowed param field set", () => {
      expect(Object.keys(COMMAND_DEFINITIONS["world.audit-files"].paramsSchema.properties).sort()).toEqual([
        "limit",
        "offset",
        "scope"
      ]);
    });

    it("pins the scope enum groups", () => {
      const schemaEnum = COMMAND_DEFINITIONS["world.audit-files"].paramsSchema.properties.scope.items.enum;
      expect([...schemaEnum].sort()).toEqual([
        "actor",

        "cards",

        "combat",
        "item",
        "journal",
        "macro",
        "playlist",
        "scene",

        "table"
      ]);
    });

    it("accepts empty params, a scope subset, and pagination", () => {
      expect(validateAudit({})).toEqual({ ok: true, errors: [] });
      expect(validateAudit({ scope: ["scene", "playlist"] })).toEqual({ ok: true, errors: [] });
      expect(validateAudit({ limit: 10, offset: 5 })).toEqual({ ok: true, errors: [] });
    });

    it("rejects an unknown scope value, an empty scope array, and an unknown key", () => {
      expect(validateAudit({ scope: ["nonsense"] }).ok).toBe(false);
      expect(validateAudit({ scope: [] }).ok).toBe(false);
      expect(validateAudit({ bogus: true }).ok).toBe(false);
    });
  });

  describe("scene.thumbnail.generate / scene.fog.reset params + error codes", () => {
    it("registers both as GM-gated mutations", () => {
      expect(COMMAND_NAMES).toContain("scene.thumbnail.generate");
      expect(COMMAND_NAMES).toContain("scene.fog.reset");
      expect(COMMAND_DEFINITIONS["scene.thumbnail.generate"].mutation).toBe(true);
      expect(COMMAND_DEFINITIONS["scene.fog.reset"].mutation).toBe(true);
      expect(isWriteCommand("scene.thumbnail.generate")).toBe(true);
      expect(isWriteCommand("scene.fog.reset")).toBe(true);
    });

    it("exposes the four new error codes", () => {
      expect(ERROR_CODES.THUMBNAIL_RENDER_FAILED).toBe("THUMBNAIL_RENDER_FAILED");
      expect(ERROR_CODES.THUMBNAIL_UPLOAD_DENIED).toBe("THUMBNAIL_UPLOAD_DENIED");
      expect(ERROR_CODES.SCENE_NOT_VIEWED).toBe("SCENE_NOT_VIEWED");
      expect(ERROR_CODES.FOG_RESET_UNCONFIRMED).toBe("FOG_RESET_UNCONFIRMED");
    });

    it("pins the enumerated allowed param field sets", () => {
      expect(
        Object.keys(COMMAND_DEFINITIONS["scene.thumbnail.generate"].paramsSchema.properties).sort()
      ).toEqual(["dryRun", "height", "includeThumb", "sceneId", "width"]);
      expect(COMMAND_DEFINITIONS["scene.thumbnail.generate"].paramsSchema.required).toEqual(["sceneId"]);

      expect(Object.keys(COMMAND_DEFINITIONS["scene.fog.reset"].paramsSchema.properties).sort()).toEqual([
        "dryRun",
        "sceneId"
      ]);
      expect(COMMAND_DEFINITIONS["scene.fog.reset"].paramsSchema.required).toEqual(["sceneId"]);
    });

    it("bounds the thumbnail width/height to the shared dimension constants", () => {
      const props = COMMAND_DEFINITIONS["scene.thumbnail.generate"].paramsSchema.properties;
      for (const dimension of ["width", "height"]) {
        expect(props[dimension]).toEqual({
          type: "integer",
          minimum: SCENE_THUMBNAIL_MIN_DIMENSION,
          maximum: SCENE_THUMBNAIL_MAX_DIMENSION
        });
      }
      expect(SCENE_THUMBNAIL_MIN_DIMENSION).toBe(16);
      expect(SCENE_THUMBNAIL_MAX_DIMENSION).toBe(1024);

      expect(validate("scene.thumbnail.generate", { sceneId: "scene-1", width: 16, height: 1024 }).ok).toBe(
        true
      );
      expect(validate("scene.thumbnail.generate", { sceneId: "scene-1", width: 15 }).ok).toBe(false);
      expect(validate("scene.thumbnail.generate", { sceneId: "scene-1", height: 1025 }).ok).toBe(false);
      expect(validate("scene.thumbnail.generate", { sceneId: "scene-1", width: 300.5 }).ok).toBe(false);
    });

    it("accepts the documented param combinations and rejects unknown fields", () => {
      expect(validate("scene.thumbnail.generate", { sceneId: "scene-1" })).toEqual({ ok: true, errors: [] });
      expect(
        validate("scene.thumbnail.generate", {
          sceneId: "scene-1",
          width: 400,
          height: 300,
          includeThumb: true,
          dryRun: true
        })
      ).toEqual({ ok: true, errors: [] });
      expect(validate("scene.thumbnail.generate", { sceneId: "scene-1", format: "image/png" }).ok).toBe(
        false
      );
      expect(validate("scene.thumbnail.generate", {}).ok).toBe(false);

      expect(validate("scene.fog.reset", { sceneId: "scene-1" })).toEqual({ ok: true, errors: [] });
      expect(validate("scene.fog.reset", { sceneId: "scene-1", dryRun: true })).toEqual({
        ok: true,
        errors: []
      });
      expect(validate("scene.fog.reset", { sceneId: "scene-1", force: true }).ok).toBe(false);
      expect(validate("scene.fog.reset", { sceneId: "" }).ok).toBe(false);
    });

    it("pins the thumbnail byte caps (response cap tighter than the persistence cap) and the fog poll bounds", () => {
      expect(SCENE_THUMBNAIL_MAX_BYTES).toBe(2 * 1024 * 1024);
      expect(SCENE_THUMBNAIL_RESPONSE_MAX_BYTES).toBe(1024 * 1024);

      expect(SCENE_THUMBNAIL_RESPONSE_MAX_BYTES).toBeLessThan(SCENE_THUMBNAIL_MAX_BYTES);

      expect(FOG_RESET_CONFIRM_TIMEOUT_MS).toBe(5_000);
      expect(FOG_RESET_CONFIRM_TIMEOUT_MS).toBeGreaterThan(2_000);
      expect(FOG_RESET_CONFIRM_POLL_INTERVAL_MS).toBe(250);
      expect(FOG_RESET_CONFIRM_POLL_INTERVAL_MS).toBeLessThan(FOG_RESET_CONFIRM_TIMEOUT_MS);
    });
  });

  describe("folder.get/create/update/delete params + error code", () => {
    it("registers folder.get (read) and folder.update/delete (mutations)", () => {
      expect(COMMAND_NAMES).toContain("folder.get");
      expect(COMMAND_NAMES).toContain("folder.update");
      expect(COMMAND_NAMES).toContain("folder.delete");
      expect(COMMAND_DEFINITIONS["folder.get"].mutation).toBe(false);
      expect(isWriteCommand("folder.get")).toBe(false);
      expect(COMMAND_DEFINITIONS["folder.update"].mutation).toBe(true);
      expect(COMMAND_DEFINITIONS["folder.delete"].mutation).toBe(true);
      expect(ERROR_CODES.FOLDER_NOT_FOUND).toBe("FOLDER_NOT_FOUND");
    });

    it("accepts a null folder colour and only the enumerated sorting modes", () => {
      expect(validate("folder.create", { data: { name: "F", type: "Actor", color: null } }).ok).toBe(true);
      expect(validate("folder.create", { data: { name: "F", type: "Actor", color: "" } }).ok).toBe(false);

      expect(validate("folder.create", { data: { name: "F", type: "Actor", sorting: "a" } }).ok).toBe(true);
      expect(validate("folder.create", { data: { name: "F", type: "Actor", sorting: "z" } }).ok).toBe(false);
    });

    it("keeps `type` off the folder patch and requires a non-empty one", () => {
      expect(COMMAND_DEFINITIONS["folder.update"].paramsSchema.properties.patch.minProperties).toBe(1);

      expectRejected(
        "folder.update",
        { folderId: "f", patch: { type: "x" } },
        "$.params.patch.type is not allowed"
      );

      expect(validate("folder.update", { folderId: "f", patch: {} }).ok).toBe(false);
      expect(validate("folder.update", { folderId: "f", patch: { folder: null } }).ok).toBe(true);
    });

    it("pins the folder.delete params (CLOSED, force gate + idempotencyKey)", () => {
      expect(Object.keys(COMMAND_DEFINITIONS["folder.delete"].paramsSchema.properties).sort()).toEqual(
        ["deleteContents", "deleteSubfolders", "dryRun", "folderId", "force", "idempotencyKey"].sort()
      );
      expect(validate("folder.delete", { folderId: "f" }).ok).toBe(true);
      expect(
        validate("folder.delete", {
          folderId: "f",
          deleteSubfolders: true,
          deleteContents: true,
          force: true,
          idempotencyKey: "k"
        }).ok
      ).toBe(true);
      expect(validate("folder.delete", { folderId: "f", bogus: true }).ok).toBe(false);
    });

    it("folder.get / folder.update do NOT accept idempotencyKey; folder.update accepts dryRun only", () => {
      const getProps = /** @type {Record<string, unknown>} */ (
        COMMAND_DEFINITIONS["folder.get"].paramsSchema.properties
      );
      const updateProps = /** @type {Record<string, unknown>} */ (
        COMMAND_DEFINITIONS["folder.update"].paramsSchema.properties
      );
      expect(getProps.idempotencyKey).toBeUndefined();
      expect(updateProps.idempotencyKey).toBeUndefined();
      expect(updateProps.dryRun).toEqual({ type: "boolean" });
    });
  });

  it("rejects malformed item.update params", () => {
    const result = validate("item.update", {
      itemId: "item-1",
      patch: {
        unsupported: true
      }
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("$.params.patch.unsupported is not allowed")
    );
  });

  it("suggests the closest allowed field on a near-miss unknown key (closed schema)", () => {
    const result = validate("item.update", { itemId: "item-1", patch: { nam: "Torch" } });

    expect(result.ok).toBe(false);
    const message = result.errors.find((entry) => entry.startsWith("$.params.patch.nam is not allowed"));
    expect(message).toBeDefined();
    expect(message).toContain('did you mean "name"?');
    expect(message).toContain("allowed fields:");
  });

  it("lists allowed fields without a bad suggestion on an unrelated unknown key", () => {
    const result = validate("item.update", { itemId: "item-1", patch: { zzzzzzzzzz: true } });

    expect(result.ok).toBe(false);
    const message = result.errors.find((entry) =>
      entry.startsWith("$.params.patch.zzzzzzzzzz is not allowed")
    );
    expect(message).toBeDefined();
    expect(message).not.toContain("did you mean");
    expect(message).toContain("allowed fields:");
  });

  it("rejects malformed file.read encodings", () => {
    const result = validate("file.read", {
      path: "worlds/world-1/readme.txt",
      encoding: "hex"
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("$.params.encoding must be one of text, base64");
  });

  it("accepts scene.update requests with background patches", () => {
    const result = validate("scene.update", {
      sceneId: "scene-1",
      patch: {
        background: {
          src: "worlds/world-1/maps/level-2.webp"
        }
      }
    });

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("rejects a scene background `-=key` deletion form (closed sub-schema, additionalProperties:false)", () => {
    const result = validate("scene.update", {
      sceneId: "scene-1",
      patch: { background: { "-=src": null } }
    });

    expect(result.ok).toBe(false);
  });

  it("rejects malformed journal.update params", () => {
    const result = validate("journal.update", {
      journalId: "journal-1",
      patch: {
        pages: [
          {
            id: "page-1",
            unsupported: true
          }
        ]
      }
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("$.params.patch.pages[0].unsupported is not allowed")
    );
  });

  it("accepts actor.item.create requests", () => {
    const result = validate("actor.item.create", {
      actorId: "actor-1",
      data: {
        name: "Torch",
        type: "loot",
        system: {
          quantity: 1
        }
      }
    });

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("keeps the module runtime snapshot aligned with canonical protocol definitions", () => {
    expect(moduleProtocol.PROTOCOL_VERSION).toBe(PROTOCOL_VERSION);
    expect(moduleProtocol.MESSAGE_TYPES).toEqual(MESSAGE_TYPES);
    expect(moduleProtocol.ERROR_CODES).toEqual(ERROR_CODES);
    expect(moduleProtocol.COMMAND_NAMES).toEqual(COMMAND_NAMES);
    expect(moduleProtocol.WRITE_COMMANDS).toEqual(WRITE_COMMANDS);

    expect(moduleProtocol.COMMAND_DEFINITIONS).toEqual(COMMAND_DEFINITIONS);
  });

  it("does not let the generated module mirror drift from source", () => {
    expect(buildGeneratedSource()).toBe(readFileSync(OUTPUT_PATH, "utf8"));
  });

  it("keeps every family command name in the assembled registry", async () => {
    const schemasDir = new URL("../src/schemas/", import.meta.url);
    const schemaModules = await Promise.all(
      readdirSync(schemasDir)
        .sort()
        .map((entry) => import(new URL(entry, schemasDir).href))
    );
    const familyKeyCount = schemaModules
      .flatMap((schemaModule) => Object.entries(schemaModule))
      .filter(([name, value]) => name.endsWith("Commands") && value?.constructor === Object)
      .reduce((total, [, family]) => total + Object.keys(family).length, 0);

    expect(familyKeyCount).toBe(COMMAND_NAMES.length);
  });

  it("rejects a command name declared by two families", () => {
    expect(mergeCommandFamilies([{ "a.get": {} }, { "b.get": {} }])).toEqual({
      "a.get": {},
      "b.get": {}
    });
    expect(() => mergeCommandFamilies([{ "a.get": {} }, { "a.get": {} }])).toThrow(
      /Duplicate command definition: a\.get/
    );
  });

  it("exports the same names from the module mirror as from the canonical package", () => {
    const canonicalKeys = Object.keys(protocol).sort();
    const mirrorKeys = Object.keys(moduleProtocol).sort();

    expect(mirrorKeys).toEqual(canonicalKeys);
  });

  it("keeps every product manifest on one fixed version", () => {
    const readJson = (file) => JSON.parse(readFileSync(path.join(REPO_ROOT, file), "utf8"));
    const rootPackage = readJson("package.json");
    const cliPackage = readJson("packages/cli/package.json");
    const protocolPackage = readJson("packages/protocol/package.json");
    const modulePackage = readJson("packages/foundry-module/package.json");
    const moduleManifest = readJson("packages/foundry-module/module.json");
    const lockfile = readJson("package-lock.json");
    const version = rootPackage.version;

    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(cliPackage.version).toBe(version);
    expect(protocolPackage.version).toBe(version);
    expect(modulePackage.version).toBe(version);
    expect(moduleManifest.version).toBe(version);
    expect(cliPackage.devDependencies["@fvtt-world-cli/protocol"]).toBe(version);
    expect(lockfile.version).toBe(version);
    expect(lockfile.packages[""].version).toBe(version);
    expect(lockfile.packages["packages/cli"].version).toBe(version);
    expect(lockfile.packages["packages/protocol"].version).toBe(version);
    expect(lockfile.packages["packages/foundry-module"].version).toBe(version);
    expect(lockfile.packages["packages/cli"].devDependencies["@fvtt-world-cli/protocol"]).toBe(version);
  });

  it("keeps every error code a self-named entry with no duplicate value", () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      expect(value, `${key} must name itself`).toBe(key);
      expect(key).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }

    expect(new Set(Object.values(ERROR_CODES)).size).toBe(Object.keys(ERROR_CODES).length);
  });

  describe("command policy primitives", () => {
    const DESTRUCTIVE_EXTRAS = ["file.move", "scene.fog.reset"];
    const finalSegment = (name) => name.slice(name.lastIndexOf(".") + 1);

    it("exposes a code for the deny verdict and for every approval outcome", () => {
      for (const code of [
        "COMMAND_DENIED",
        "APPROVAL_PENDING",
        "APPROVAL_DENIED",
        "APPROVAL_TIMEOUT",
        "APPROVAL_CANCELLED",
        "APPROVAL_QUEUE_FULL",
        "APPROVAL_UNKNOWN"
      ]) {
        expect(ERROR_CODES[code]).toBe(code);
      }
    });

    it("pins the tri-state behavior list", () => {
      expect(POLICY_BEHAVIORS).toEqual(["allow", "approve", "deny"]);
      expect(Object.isFrozen(POLICY_BEHAVIORS)).toBe(true);
    });

    it("exempts exactly the status reads and the plumbing commands, and nothing that mutates", () => {
      expect(Object.isFrozen(POLICY_EXEMPT_COMMANDS)).toBe(true);
      expect(new Set(POLICY_EXEMPT_COMMANDS).size).toBe(POLICY_EXEMPT_COMMANDS.length);
      expect(POLICY_EXEMPT_COMMANDS).toEqual([
        "system.ping",
        "system.info",
        "approval.await",
        "approval.cancel",
        "policy.snapshot"
      ]);

      for (const command of POLICY_EXEMPT_COMMANDS) {
        expect(
          COMMAND_DEFINITIONS[command].mutation,
          `${command} bypasses the policy gate, so it must not mutate`
        ).toBe(false);
      }
    });

    it("classifies registry commands as destructive by delete verb plus the explicit extras", () => {
      const deleteVerbs = COMMAND_NAMES.filter((name) =>
        ["delete", "delete-many"].includes(finalSegment(name))
      );

      for (const name of COMMAND_NAMES) {
        const expected =
          ["delete", "delete-many"].includes(finalSegment(name)) || DESTRUCTIVE_EXTRAS.includes(name);

        expect(isDestructiveCommand(name), name).toBe(expected);
      }

      for (const name of DESTRUCTIVE_EXTRAS) {
        expect(COMMAND_NAMES).toContain(name);
        expect(deleteVerbs).not.toContain(name);
      }

      expect(deleteVerbs.length).toBeGreaterThan(0);
      expect(COMMAND_NAMES.filter(isDestructiveCommand).length).toBe(
        deleteVerbs.length + DESTRUCTIVE_EXTRAS.length
      );
    });

    it("reads only the final dot-separated segment, so malformed names are not destructive", () => {
      for (const name of ["", "delete", "actor.deleted", "actor.delete.extra"]) {
        expect(isDestructiveCommand(name), name).toBe(false);
      }

      expect(isDestructiveCommand("actor.delete")).toBe(true);
      expect(isDestructiveCommand("actor.item.delete-many")).toBe(true);
    });

    it("parks an approval poll for the same ceiling the pairing wait uses", () => {
      expect(APPROVAL_AWAIT_PARK_CAP_MS).toBe(25_000);
      expect(APPROVAL_AWAIT_PARK_CAP_MS).toBe(AUTH_AWAIT_PARK_CAP_MS);
      expect(APPROVAL_AWAIT_PARK_CAP_MS).toBeLessThan(BRIDGE_LEASE_MS);
      expect(APPROVAL_RESULT_RETENTION_MS).toBe(300_000);
      expect(APPROVAL_RESULT_RETENTION_MS).toBeGreaterThan(APPROVAL_AWAIT_PARK_CAP_MS);
    });

    it("bounds the pending approval count and the policy discovery wait", () => {
      expect(APPROVAL_PENDING_MAX).toBe(20);
      expect(POLICY_DISCOVERY_TIMEOUT_MS).toBe(1_500);
    });

    it("keeps the configurable approval timeout inside the browser timer ceiling", () => {
      const timerCeilingMs = 2 ** 31 - 1;

      expect(APPROVAL_TIMEOUT_MIN_MINUTES).toBe(1);
      expect(APPROVAL_TIMEOUT_DEFAULT_MINUTES).toBe(60);
      expect(APPROVAL_TIMEOUT_MIN_MINUTES).toBeLessThanOrEqual(APPROVAL_TIMEOUT_DEFAULT_MINUTES);
      expect(APPROVAL_TIMEOUT_DEFAULT_MINUTES).toBeLessThanOrEqual(APPROVAL_TIMEOUT_MAX_MINUTES);
      expect(APPROVAL_TIMEOUT_MAX_MINUTES * 60_000).toBeLessThan(timerCeilingMs);
      expect((APPROVAL_TIMEOUT_MAX_MINUTES + 1) * 60_000).toBeGreaterThan(timerCeilingMs);
    });

    it("carries the approval and policy primitives into the module mirror", () => {
      const numeric = /** @type {Record<string, number>} */ ({
        APPROVAL_AWAIT_PARK_CAP_MS,
        APPROVAL_RESULT_RETENTION_MS,
        APPROVAL_PENDING_MAX,
        APPROVAL_TIMEOUT_DEFAULT_MINUTES,
        APPROVAL_TIMEOUT_MIN_MINUTES,
        APPROVAL_TIMEOUT_MAX_MINUTES,
        POLICY_DISCOVERY_TIMEOUT_MS
      });

      for (const [key, value] of Object.entries(numeric)) {
        expect(moduleProtocol[key], `${key} must reach the module mirror`).toBe(value);
      }

      expect(moduleProtocol.POLICY_BEHAVIORS).toEqual([...POLICY_BEHAVIORS]);
      expect(moduleProtocol.POLICY_EXEMPT_COMMANDS).toEqual([...POLICY_EXEMPT_COMMANDS]);
      expect(moduleProtocol.isDestructiveCommand("scene.fog.reset")).toBe(true);
    });
  });

  describe("default command profile", () => {
    const expectedBehavior = (command) => (isDestructiveCommand(command) ? "approve" : "allow");

    it("stays byte-identical to what the generator emits", () => {
      expect(
        readFileSync(PROFILE_PATH, "utf8"),
        "the snapshot is stale; run `npm run generate:protocol`"
      ).toBe(buildDefaultCommandProfileSource());
    });

    it("covers every registry command exactly once, in registry order", () => {
      expect(Object.keys(DEFAULT_COMMAND_PROFILE)).toEqual([...COMMAND_NAMES]);
    });

    it("assigns every command the behavior the destructive rule dictates", () => {
      for (const command of COMMAND_NAMES) {
        expect(POLICY_BEHAVIORS, command).toContain(DEFAULT_COMMAND_PROFILE[command]);
        expect(DEFAULT_COMMAND_PROFILE[command], command).toBe(expectedBehavior(command));
      }
    });

    it("puts exactly the destructive commands in the approve bucket", () => {
      const approved = COMMAND_NAMES.filter((command) => DEFAULT_COMMAND_PROFILE[command] === "approve");

      expect(approved).toEqual(COMMAND_NAMES.filter(isDestructiveCommand));
      expect(approved.length).toBeGreaterThan(0);
      expect(approved.length).toBeLessThan(COMMAND_NAMES.length);
      for (const command of ["actor.delete", "actor.delete-many", "file.move", "scene.fog.reset"]) {
        expect(DEFAULT_COMMAND_PROFILE[command], command).toBe("approve");
      }
      expect(DEFAULT_COMMAND_PROFILE["actor.get"]).toBe("allow");
    });

    it("counts 54 approve-listed and 262 self-running commands in a registry of 316", () => {
      const approved = COMMAND_NAMES.filter((command) => DEFAULT_COMMAND_PROFILE[command] === "approve");

      expect(
        {
          commands: COMMAND_NAMES.length,
          approve: approved.length,
          allow: COMMAND_NAMES.length - approved.length
        },
        'the totals moved: update every count docs/commands.md states ("54 of the 316 commands in the registry; the other 262 run on their own") in the same change'
      ).toEqual({ commands: 316, approve: 54, allow: 262 });
    });

    it("leaves 311 governed commands in 16 top-level groups once the exempt ones are removed", () => {
      const exempt = new Set(POLICY_EXEMPT_COMMANDS);
      const governed = COMMAND_NAMES.filter((command) => !exempt.has(command));

      expect(
        {
          governed: governed.length,
          groups: new Set(governed.map((command) => command.split(".")[0])).size,
          approve: governed.filter((command) => DEFAULT_COMMAND_PROFILE[command] === "approve").length
        },
        'the window totals moved: update the counts docs/commands.md states ("the 311 commands the permissions govern, in 16 top-level groups, and states that 54 of them wait for approval by default") in the same change'
      ).toEqual({ governed: 311, groups: 16, approve: 54 });
    });

    it("cannot be mutated in place", () => {
      const table = /** @type {Record<string, string>} */ (DEFAULT_COMMAND_PROFILE);

      expect(Object.isFrozen(DEFAULT_COMMAND_PROFILE)).toBe(true);
      expect(() => {
        table["actor.delete"] = "allow";
      }).toThrow(TypeError);
      expect(() => {
        table["bogus.command"] = "deny";
      }).toThrow(TypeError);
    });

    it("looks up a command and reports nothing for a name the registry does not carry", () => {
      for (const command of COMMAND_NAMES) {
        expect(defaultProfile(command), command).toBe(expectedBehavior(command));
      }

      for (const name of ["bogus.command", "", "toString", "constructor", "__proto__"]) {
        expect(defaultProfile(name), name).toBeUndefined();
      }
    });

    it("reaches the module mirror with the same table and lookup", () => {
      expect(moduleProtocol.DEFAULT_COMMAND_PROFILE).toEqual({ ...DEFAULT_COMMAND_PROFILE });
      expect(moduleProtocol.defaultProfile("actor.delete")).toBe("approve");
      expect(moduleProtocol.defaultProfile("actor.get")).toBe("allow");
      expect(moduleProtocol.defaultProfile("bogus.command")).toBeUndefined();
    });
  });

  describe("approval and policy plumbing commands", () => {
    const HIDDEN_COMMANDS = Object.freeze(["approval.await", "approval.cancel", "policy.snapshot"]);
    const APPROVAL_ID = "AbCdEf0123456789_-wxyZ";
    const hiddenNames = () => COMMAND_NAMES.filter((name) => COMMAND_DEFINITIONS[name].discovery === false);

    it("hides exactly the plumbing commands from discovery", () => {
      expect(hiddenNames()).toEqual([...HIDDEN_COMMANDS]);
      expect(DISCOVERABLE_COMMAND_NAMES).toHaveLength(COMMAND_NAMES.length - HIDDEN_COMMANDS.length);
      for (const command of HIDDEN_COMMANDS) {
        expect(DISCOVERABLE_COMMAND_NAMES, `${command} must not be discoverable`).not.toContain(command);
      }
      expect(DISCOVERABLE_COMMAND_NAMES).toContain("system.info");
    });

    it("exports the plumbing command names the CLI polls as registry keys", () => {
      const exported = [
        protocol.APPROVAL_AWAIT_COMMAND,
        protocol.APPROVAL_CANCEL_COMMAND,
        protocol.POLICY_SNAPSHOT_COMMAND
      ];
      expect(exported).toEqual([...HIDDEN_COMMANDS]);
      for (const command of exported) {
        expect(COMMAND_NAMES, `${command} must name a registry command`).toContain(command);
        expect(Object.hasOwn(COMMAND_DEFINITIONS, command)).toBe(true);
      }
      expect(moduleProtocol.APPROVAL_AWAIT_COMMAND).toBe(protocol.APPROVAL_AWAIT_COMMAND);
      expect(moduleProtocol.APPROVAL_CANCEL_COMMAND).toBe(protocol.APPROVAL_CANCEL_COMMAND);
      expect(moduleProtocol.POLICY_SNAPSHOT_COMMAND).toBe(protocol.POLICY_SNAPSHOT_COMMAND);
    });

    it("carries no discovery field on a discoverable command", () => {
      const annotated = DISCOVERABLE_COMMAND_NAMES.filter(
        (command) => "discovery" in COMMAND_DEFINITIONS[command]
      );
      expect(annotated, "the flag marks hidden entries only, never every discoverable one").toEqual([]);
    });

    it("keeps the discoverable set frozen and in registry order", () => {
      expect(Object.isFrozen(DISCOVERABLE_COMMAND_NAMES)).toBe(true);
      expect(() => {
        DISCOVERABLE_COMMAND_NAMES.push("bogus.command");
      }).toThrow(TypeError);

      const positions = DISCOVERABLE_COMMAND_NAMES.map((command) => COMMAND_NAMES.indexOf(command));
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
      expect(positions).not.toContain(-1);
      expect(moduleProtocol.DISCOVERABLE_COMMAND_NAMES).toEqual([...DISCOVERABLE_COMMAND_NAMES]);
    });

    it("keeps every hidden command exempt read-only plumbing", () => {
      for (const command of hiddenNames()) {
        expect(POLICY_EXEMPT_COMMANDS, `${command} must be exempt`).toContain(command);
        expect(COMMAND_DEFINITIONS[command].mutation, `${command} must not mutate`).toBe(false);
      }
    });

    it("keeps every exempt name a module command, since daemon operations never reach the module", () => {
      for (const command of POLICY_EXEMPT_COMMANDS) {
        expect(COMMAND_NAMES, `${command} must be a registry command`).toContain(command);
        expect(command.startsWith("auth."), `${command} must not be a daemon operation`).toBe(false);
      }

      for (const operation of DAEMON_OPERATIONS) {
        expect(COMMAND_NAMES, `${operation} is a daemon operation, not a module command`).not.toContain(
          operation
        );
        expect(POLICY_EXEMPT_COMMANDS, `${operation} is exempt by construction`).not.toContain(operation);
      }
    });

    it("keeps a hidden command callable and validated", () => {
      for (const command of HIDDEN_COMMANDS) {
        expect(protocol.REQUEST_SCHEMA.properties.command.enum).toContain(command);
        expect(protocol.isKnownCommand(command)).toBe(true);
        expect(protocol.getCommandDefinition(command).paramsSchema.additionalProperties).toBe(false);
        expect(WRITE_COMMANDS).not.toContain(command);
      }
    });

    it("accepts an approval id of the generated shape, with or without a park duration", () => {
      expectValid("approval.await", { approvalId: APPROVAL_ID });
      expectValid("approval.await", { approvalId: APPROVAL_ID, waitMs: 0 });
      expectValid("approval.await", { approvalId: APPROVAL_ID, waitMs: APPROVAL_AWAIT_PARK_CAP_MS });
      expectValid("approval.cancel", { approvalId: APPROVAL_ID });
      expectValid("policy.snapshot", {});
    });

    it("rejects an approval id outside the base64url shape the store generates", () => {
      for (const command of ["approval.await", "approval.cancel"]) {
        expectRejected(command, {}, "approvalId");
        expectRejected(command, { approvalId: "" }, "approvalId");
        expectRejected(command, { approvalId: APPROVAL_ID.slice(0, 21) }, "approvalId");
        expectRejected(command, { approvalId: `${APPROVAL_ID}A` }, "approvalId");
        expectRejected(command, { approvalId: `${APPROVAL_ID.slice(0, 20)}+/` }, "approvalId");
        expectRejected(command, { approvalId: 1 }, "approvalId");
        expectRejected(command, { approvalId: APPROVAL_ID, extra: true }, "extra");
      }
    });

    it("rejects a park duration outside the poll ceiling", () => {
      expectRejected("approval.await", { approvalId: APPROVAL_ID, waitMs: -1 }, "waitMs");
      expectRejected(
        "approval.await",
        { approvalId: APPROVAL_ID, waitMs: APPROVAL_AWAIT_PARK_CAP_MS + 1 },
        "waitMs"
      );
      expectRejected("approval.await", { approvalId: APPROVAL_ID, waitMs: 1.5 }, "waitMs");
      expectRejected("approval.cancel", { approvalId: APPROVAL_ID, waitMs: 0 }, "waitMs");
    });

    it("takes no parameters for the policy snapshot", () => {
      expect(COMMAND_DEFINITIONS["policy.snapshot"].paramsSchema.required).toEqual([]);
      expect(Object.keys(COMMAND_DEFINITIONS["policy.snapshot"].paramsSchema.properties)).toEqual([]);
      expectRejected("policy.snapshot", { approvalId: APPROVAL_ID }, "approvalId");
    });
  });

  describe("editable flags / prototypeToken on world documents", () => {
    it("accepts flags on item create and update", () => {
      expectValid("item.create", {
        data: { name: "Torch", type: "loot", flags: { mymod: { burning: true } } }
      });
      expectValid("item.update", {
        itemId: "item-1",
        patch: { flags: { mymod: { burning: false } } }
      });
    });

    it("accepts flags and prototypeToken on actor create and update", () => {
      expectValid("actor.create", {
        data: {
          name: "Goblin",
          type: "npc",
          flags: { mymod: { tag: "minion" } },
          prototypeToken: { name: "Goblin", disposition: -1 }
        }
      });
      expectValid("actor.update", {
        actorId: "actor-1",
        patch: {
          flags: { mymod: { tag: "elite" } },
          prototypeToken: { texture: { src: "worlds/w/tokens/goblin.webp" } }
        }
      });
    });

    it("accepts flags on journal create and update", () => {
      expectValid("journal.create", {
        data: { name: "Lore", flags: { mymod: { secret: true } } }
      });
      expectValid("journal.update", {
        journalId: "journal-1",
        patch: { flags: { mymod: { secret: false } } }
      });
    });

    it("accepts flags on scene create and update", () => {
      expectValid("scene.create", {
        data: { name: "Cavern", flags: { mymod: { weather: "fog" } } }
      });
      expectValid("scene.update", {
        sceneId: "scene-1",
        patch: { flags: { mymod: { weather: "clear" } } }
      });
    });

    it("accepts the optional scene display and audio fields and still rejects unknown ones", () => {
      expectValid("scene.update", {
        sceneId: "scene-1",
        patch: {
          tokenVision: true,
          weather: "rain",
          padding: 0.25,
          playlist: "playlist-1",
          playlistSound: null,
          environment: { darkness: 0.5, globalLight: { enabled: true } }
        }
      });
      expectValid("scene.create", {
        data: { name: "Cavern", tokenVision: false, initial: { x: 100, y: 100, scale: 1 } }
      });

      expectValid("scene.update", {
        sceneId: "scene-1",
        patch: { foreground: "worlds/w/fg.webp", foregroundElevation: 20 }
      });
      expectValid("scene.update", {
        sceneId: "scene-1",
        patch: { foreground: null, foregroundElevation: null }
      });
      const bad = validate("scene.update", {
        sceneId: "scene-1",
        patch: { tokenVision: true, bogusField: 1 }
      });
      expect(bad.ok).toBe(false);
      expect(bad.errors).toContainEqual(expect.stringContaining("$.params.patch.bogusField is not allowed"));
    });

    it("rejects a non-object flags value (freeformObjectSchema requires an object)", () => {
      const result = validate("item.update", {
        itemId: "item-1",
        patch: { flags: "not-an-object" }
      });

      expect(result.ok).toBe(false);
      expect(result.errors).toContain("$.params.patch.flags must be object");
    });

    it("rejects prototypeToken on item/journal/scene (actor-only field)", () => {
      for (const [command, params] of [
        ["item.update", { itemId: "item-1", patch: { prototypeToken: {} } }],
        ["journal.update", { journalId: "journal-1", patch: { prototypeToken: {} } }],
        ["scene.update", { sceneId: "scene-1", patch: { prototypeToken: {} } }]
      ]) {
        const result = validate(command, params);
        expect(result.ok, `${command} should reject prototypeToken`).toBe(false);
        expect(result.errors).toContainEqual(
          expect.stringContaining("$.params.patch.prototypeToken is not allowed")
        );
      }
    });

    it("still rejects an unknown top-level field on these schemas (closed backstop intact)", () => {
      for (const [command, params] of [
        ["item.update", { itemId: "item-1", patch: { bogusField: true } }],
        ["actor.update", { actorId: "actor-1", patch: { bogusField: true } }],
        ["journal.update", { journalId: "journal-1", patch: { bogusField: true } }],
        ["scene.update", { sceneId: "scene-1", patch: { bogusField: true } }]
      ]) {
        const result = validate(command, params);
        expect(result.ok, `${command} should reject bogusField`).toBe(false);
        expect(result.errors).toContainEqual(
          expect.stringContaining("$.params.patch.bogusField is not allowed")
        );
      }
    });

    it("pins every import patch to its family's own closed patch schema, journal excepted", () => {
      const patchOf = (command) => COMMAND_DEFINITIONS[command].paramsSchema.properties.patch;

      const REUSES = {
        "actor.import-from-compendium": "actor.update",
        "actor.item.import-from-compendium": "actor.item.update",
        "item.import-from-compendium": "item.update",
        "scene.import-from-compendium": "scene.update",
        "macro.import-from-compendium": "macro.update",
        "playlist.import-from-compendium": "playlist.update",
        "table.import-from-compendium": "table.update",
        "cards.import-from-compendium": "cards.update"
      };
      const DEDICATED = ["journal.import-from-compendium"];

      const importCommands = COMMAND_NAMES.filter((name) => name.endsWith(".import-from-compendium")).sort();
      expect(importCommands.length).toBeGreaterThan(0);
      expect(
        [...Object.keys(REUSES), ...DEDICATED].sort(),
        "a *.import-from-compendium verb has no patch-schema pin: add it to REUSES or DEDICATED"
      ).toEqual(importCommands);

      for (const [importCommand, updateCommand] of Object.entries(REUSES)) {
        expect(
          patchOf(importCommand),
          `${importCommand} must reuse ${updateCommand}'s patch schema object, not a copy`
        ).toBe(patchOf(updateCommand));
      }

      const journalImportPatch = patchOf("journal.import-from-compendium");
      expect(journalImportPatch).not.toBe(patchOf("journal.update"));

      expect(
        journalImportPatch,
        "journal's import patch and `journal.update-many`'s element patch must be the SAME object, not a copy"
      ).toBe(
        COMMAND_DEFINITIONS["journal.update-many"].paramsSchema.properties.patches.items.properties.patch
      );
      expect(Object.keys(journalImportPatch.properties).sort()).toEqual(["flags", "folder", "name", "sort"]);
      for (const handlerCommand of ["pages", "deletePageIds"]) {
        expect(
          Object.keys(journalImportPatch.properties),
          `journal's import patch must NOT accept the handler command \`${handlerCommand}\``
        ).not.toContain(handlerCommand);

        const result = validate("journal.import-from-compendium", {
          pack: "world.p",
          entryId: "e1",
          patch: { [handlerCommand]: handlerCommand === "pages" ? [{ name: "x" }] : ["pg1"] }
        });
        expect(result.ok, `${handlerCommand} should be rejected`).toBe(false);
        expect(result.errors).toContainEqual(
          expect.stringContaining(`$.params.patch.${handlerCommand} is not allowed`)
        );
      }

      for (const command of importCommands) {
        expect(patchOf(command).additionalProperties, `${command} patch must stay closed`).toBe(false);
        for (const meta of ["_id", "_stats", "ownership"]) {
          const params = {
            pack: "world.p",
            entryId: "e1",
            patch: { [meta]: meta === "ownership" ? {} : "x" }
          };
          if (command === "actor.item.import-from-compendium") {
            params.actorId = "actor-1";
          }
          const result = validate(command, params);
          expect(result.ok, `${command} must reject patch.${meta} at the protocol layer`).toBe(false);
          expect(result.errors).toContainEqual(
            expect.stringContaining(`$.params.patch.${meta} is not allowed`)
          );
        }
      }
    });

    it("propagates flags/prototypeToken into the shared clone override schemas, except journal.clone", () => {
      const cloneProps = (command) =>
        Object.keys(COMMAND_DEFINITIONS[command].paramsSchema.properties.patch.properties);

      expect(cloneProps("scene.clone")).toContain("flags");
      expect(cloneProps("item.clone")).toContain("flags");
      expect(cloneProps("actor.clone")).toContain("flags");
      expect(cloneProps("actor.clone")).toContain("prototypeToken");

      expect(cloneProps("macro.clone")).toContain("flags");
      expect(cloneProps("macro.clone")).not.toContain("prototypeToken");

      const journalCloneProps = cloneProps("journal.clone");
      expect(journalCloneProps).not.toContain("flags");
      expect(journalCloneProps).not.toContain("prototypeToken");
    });
  });

  describe("journal page shape", () => {
    const createPageSchema =
      COMMAND_DEFINITIONS["journal.create"].paramsSchema.properties.data.properties.pages.items;
    const patchPageSchema =
      COMMAND_DEFINITIONS["journal.update"].paramsSchema.properties.patch.properties.pages.items;

    it("pins the exact top-level page property set on create and patch page schemas", () => {
      expect(Object.keys(createPageSchema.properties).sort()).toEqual(
        [
          "category",
          "flags",
          "image",
          "name",
          "sort",
          "src",
          "system",
          "text",
          "title",
          "type",
          "video"
        ].sort()
      );
      expect(Object.keys(patchPageSchema.properties).sort()).toEqual(
        [
          "category",
          "flags",
          "id",
          "image",
          "name",
          "sort",
          "src",
          "system",
          "text",
          "title",
          "type",
          "video"
        ].sort()
      );

      expect(createPageSchema.additionalProperties).toBe(false);
      expect(patchPageSchema.additionalProperties).toBe(false);
    });

    it("pins the text / title / image / video sub-schema property sets and the format enum", () => {
      const textSchema = createPageSchema.properties.text;
      expect(Object.keys(textSchema.properties).sort()).toEqual(["content", "format", "markdown"].sort());
      expect(textSchema.properties.format.enum).toEqual([1, 2]);
      expect(textSchema.additionalProperties).toBe(false);

      const titleSchema = createPageSchema.properties.title;
      expect(Object.keys(titleSchema.properties).sort()).toEqual(["level", "show"].sort());
      expect(titleSchema.additionalProperties).toBe(false);

      const imageSchema = createPageSchema.properties.image;
      expect(Object.keys(imageSchema.properties).sort()).toEqual(["caption"].sort());
      expect(imageSchema.additionalProperties).toBe(false);

      const videoSchema = createPageSchema.properties.video;
      expect(Object.keys(videoSchema.properties).sort()).toEqual(
        ["autoplay", "controls", "height", "loop", "timestamp", "volume", "width"].sort()
      );
      expect(videoSchema.additionalProperties).toBe(false);

      expect(videoSchema.properties.timestamp.type).toEqual(["number", "null"]);
      expect(videoSchema.properties.width.type).toEqual(["integer", "null"]);
      expect(videoSchema.properties.height.type).toEqual(["integer", "null"]);
      expect(videoSchema.properties.volume.type).toBe("number");
    });

    it("accepts null to clear nullable video.timestamp/width/height but rejects volume:null", () => {
      for (const field of ["timestamp", "width", "height"]) {
        expect(
          validate("journal.update", {
            journalId: "j1",
            patch: { pages: [{ id: "x", video: { [field]: null } }] }
          }).ok,
          `video.${field}=null should be accepted (nullable NumberField)`
        ).toBe(true);
      }
      expect(
        validate("journal.update", {
          journalId: "j1",
          patch: { pages: [{ id: "x", video: { volume: null } }] }
        }).ok,
        "video.volume=null should be rejected (AlphaField is nullable:false)"
      ).toBe(false);
    });

    it("validates a full journal.update page patch (image/title/video/category/system/flags)", () => {
      expect(
        validate("journal.update", {
          journalId: "j1",
          patch: {
            pages: [
              {
                id: "x",
                image: { caption: "hi" },
                title: { level: 2 },
                video: { volume: 0.3 },
                category: null,
                system: { tooltip: "t" },
                flags: { m: {} }
              }
            ]
          }
        })
      ).toEqual({ ok: true, errors: [] });
    });

    it("accepts a markdown/format-only text write (content no longer required)", () => {
      expect(
        validate("journal.create", {
          data: {
            name: "J",
            pages: [{ name: "P", type: "text", text: { markdown: "# hi", format: 2 } }]
          }
        }).ok
      ).toBe(true);
    });

    it("rejects _id / _stats / ownership meta on a page (closed backstop, no stripper)", () => {
      for (const meta of ["_id", "_stats", "ownership"]) {
        const result = validate("journal.update", {
          journalId: "j1",
          patch: { pages: [{ id: "x", [meta]: "spoof" }] }
        });
        expect(result.ok, `${meta} should be rejected on a page`).toBe(false);
        expect(result.errors).toContainEqual(
          expect.stringContaining(`$.params.patch.pages[0].${meta} is not allowed`)
        );
      }
    });

    it("rejects out-of-range title.level and out-of-enum text.format", () => {
      expect(
        validate("journal.update", {
          journalId: "j1",
          patch: { pages: [{ id: "x", title: { level: 7 } }] }
        }).ok
      ).toBe(false);
      expect(
        validate("journal.update", {
          journalId: "j1",
          patch: { pages: [{ id: "x", title: { level: 0 } }] }
        }).ok
      ).toBe(false);
      expect(
        validate("journal.update", {
          journalId: "j1",
          patch: { pages: [{ id: "x", text: { format: 3 } }] }
        }).ok
      ).toBe(false);
    });

    it("rejects non-positive video.width/height (exclusiveMinimum) and out-of-range volume", () => {
      for (const dim of ["width", "height"]) {
        for (const bad of [0, -1]) {
          const result = validate("journal.update", {
            journalId: "j1",
            patch: { pages: [{ id: "x", video: { [dim]: bad } }] }
          });
          expect(result.ok, `video.${dim}=${bad} should be rejected`).toBe(false);
          expect(result.errors).toContainEqual(
            expect.stringContaining(`$.params.patch.pages[0].video.${dim} must be > 0`)
          );
        }
      }
      expect(
        validate("journal.update", {
          journalId: "j1",
          patch: { pages: [{ id: "x", video: { volume: 1.5 } }] }
        }).ok
      ).toBe(false);
    });
  });

  describe("journal.category embedded family", () => {
    const createDataSchema = COMMAND_DEFINITIONS["journal.category.create"].paramsSchema.properties.data;
    const patchSchema = COMMAND_DEFINITIONS["journal.category.update"].paramsSchema.properties.patch;

    it("exposes JOURNAL_CATEGORY_NOT_FOUND in ERROR_CODES", () => {
      expect(ERROR_CODES.JOURNAL_CATEGORY_NOT_FOUND).toBe("JOURNAL_CATEGORY_NOT_FOUND");
    });

    it("declares exactly the FIVE verbs — no clone, no get-many", () => {
      expect(COMMAND_NAMES.filter((name) => name.startsWith("journal.category.")).sort()).toEqual([
        "journal.category.create",
        "journal.category.delete",
        "journal.category.get",
        "journal.category.list",
        "journal.category.update"
      ]);

      for (const absent of ["journal.category.clone", "journal.category.get-many"]) {
        expect(COMMAND_NAMES).not.toContain(absent);
      }
    });

    it("requires a non-empty category patch", () => {
      expect(patchSchema.minProperties).toBe(1);
      expect(validate("journal.category.update", { journalId: "j-1", categoryId: "c-1", patch: {} }).ok).toBe(
        false
      );
    });

    it("requires `name` on create but allows it BLANK (no minLength Foundry does not have)", () => {
      expect(createDataSchema.required).toEqual(["name"]);
      expect(createDataSchema.properties.name).toEqual({ type: "string" });
      expect(patchSchema.properties.name).toEqual({ type: "string" });
      expect(validate("journal.category.create", { journalId: "j-1", data: { name: "" } }).ok).toBe(true);
      expect(
        validate("journal.category.update", { journalId: "j-1", categoryId: "c-1", patch: { name: "" } }).ok
      ).toBe(true);
      expect(validate("journal.category.create", { journalId: "j-1", data: {} }).ok).toBe(false);
    });

    it('rejects a NULL name (Foundry silently coerces null to "")', () => {
      expect(validate("journal.category.create", { journalId: "j-1", data: { name: null } }).ok).toBe(false);
      expect(
        validate("journal.category.update", { journalId: "j-1", categoryId: "c-1", patch: { name: null } }).ok
      ).toBe(false);
    });

    it("pins `sort` as INTEGER (IntegerSortField silently ROUNDS a float — measured 1.5→2, 2.7→3)", () => {
      expect(createDataSchema.properties.sort).toEqual({ type: "integer" });
      expect(patchSchema.properties.sort).toEqual({ type: "integer" });
      expect(
        validate("journal.category.create", { journalId: "j-1", data: { name: "C", sort: 100 } }).ok
      ).toBe(true);
      expect(
        validate("journal.category.create", { journalId: "j-1", data: { name: "C", sort: -3 } }).ok
      ).toBe(true);

      expect(
        validate("journal.category.create", { journalId: "j-1", data: { name: "C", sort: 1.5 } }).ok
      ).toBe(false);
      expect(
        validate("journal.category.update", { journalId: "j-1", categoryId: "c-1", patch: { sort: 2.7 } }).ok
      ).toBe(false);
      expect(
        COMMAND_DEFINITIONS["playlist.sound.create"].paramsSchema.properties.data.properties.sort
      ).toEqual({ type: "number" });
    });

    it("accepts freeform flags", () => {
      expect(
        validate("journal.category.create", {
          journalId: "j-1",
          data: { name: "C", sort: 10, flags: { mymod: { x: 1 } } }
        }).ok
      ).toBe(true);
    });

    it("journal.category.list REQUIRES journalId (deliberately NOT the optional-parent read)", () => {
      expect(COMMAND_DEFINITIONS["journal.category.list"].paramsSchema.required).toEqual(["journalId"]);
      expect(validate("journal.category.list", {}).ok).toBe(false);
      expect(validate("journal.category.list", { journalId: "j-1" }).ok).toBe(true);
      expect(
        validate("journal.category.list", { journalId: "j-1", name: "chap", limit: 5, offset: 2 }).ok
      ).toBe(true);
      expect(validate("journal.category.list", { journalId: "j-1", bogus: true }).ok).toBe(false);
      for (const optional of ["playlist.sound.list", "table.result.list", "cards.card.list"]) {
        expect(
          COMMAND_DEFINITIONS[optional].paramsSchema.required,
          `${optional} keeps its optional parent`
        ).toEqual([]);
      }
    });

    it("requires both ids on get/update/delete", () => {
      for (const command of ["journal.category.get", "journal.category.delete"]) {
        expect(validate(command, { journalId: "j-1" }).ok, `${command} needs categoryId`).toBe(false);
        expect(validate(command, { categoryId: "c-1" }).ok, `${command} needs journalId`).toBe(false);
        expect(validate(command, { journalId: "j-1", categoryId: "c-1" }).ok).toBe(true);
      }
      expect(validate("journal.category.update", { journalId: "j-1", categoryId: "c-1" }).ok).toBe(false);
    });
  });

  describe("scene.region.behavior embedded family", () => {
    const createDataSchema = COMMAND_DEFINITIONS["scene.region.behavior.create"].paramsSchema.properties.data;
    const patchSchema = COMMAND_DEFINITIONS["scene.region.behavior.update"].paramsSchema.properties.patch;
    const clonePatchSchema = COMMAND_DEFINITIONS["scene.region.behavior.clone"].paramsSchema.properties.patch;

    it("exposes REGION_BEHAVIOR_NOT_FOUND in ERROR_CODES", () => {
      expect(ERROR_CODES.REGION_BEHAVIOR_NOT_FOUND).toBe("REGION_BEHAVIOR_NOT_FOUND");
    });

    it("declares exactly the SIX verbs — no get-many", () => {
      expect(COMMAND_NAMES.filter((name) => name.startsWith("scene.region.behavior.")).sort()).toEqual([
        "scene.region.behavior.clone",
        "scene.region.behavior.create",
        "scene.region.behavior.delete",
        "scene.region.behavior.get",
        "scene.region.behavior.list",
        "scene.region.behavior.update"
      ]);
      expect(COMMAND_NAMES).not.toContain("scene.region.behavior.get-many");

      expect(COMMAND_NAMES).not.toContain("scene.region.behavior.ownership.set");
    });

    it("keeps data and patch OPEN passthrough (the scene-embedded taxonomy)", () => {
      expect(createDataSchema.additionalProperties).toBe(true);
      expect(patchSchema.additionalProperties).toBe(true);
      expect(clonePatchSchema.additionalProperties).toBe(true);
      expect(
        validate("scene.region.behavior.create", {
          sceneId: "s-1",
          regionId: "r-1",
          data: { type: "teleportToken", system: { destination: "Scene.abc.Region.def" } }
        }).ok
      ).toBe(true);
    });

    it("type-checks the measured field set (name/type/disabled/system/flags)", () => {
      expect(Object.keys(createDataSchema.properties).sort()).toEqual(
        ["disabled", "flags", "name", "system", "type"].sort()
      );
      expect(createDataSchema.properties.name).toEqual({ type: "string" });
      expect(createDataSchema.properties.disabled).toEqual({ type: "boolean" });
      expect(
        validate("scene.region.behavior.create", { sceneId: "s-1", regionId: "r-1", data: { type: 7 } }).ok
      ).toBe(false);
      expect(
        validate("scene.region.behavior.create", {
          sceneId: "s-1",
          regionId: "r-1",
          data: { type: "pauseGame", disabled: "yes" }
        }).ok
      ).toBe(false);
    });

    it("REQUIRES `type` on create and leaves it un-enumerated (version- and module-dependent choices)", () => {
      expect(createDataSchema.required).toEqual(["type"]);
      expect(createDataSchema.properties.type).toEqual({ type: "string", minLength: 1 });
      expect(validate("scene.region.behavior.create", { sceneId: "s-1", regionId: "r-1", data: {} }).ok).toBe(
        false
      );
      expect(
        validate("scene.region.behavior.create", { sceneId: "s-1", regionId: "r-1", data: { type: "" } }).ok
      ).toBe(false);

      expect(
        validate("scene.region.behavior.create", {
          sceneId: "s-1",
          regionId: "r-1",
          data: { type: "changeLevel" }
        }).ok
      ).toBe(true);
    });

    it("OMITS `type` from both patch schemas (impossible on update, bridge policy on clone)", () => {
      expect(Object.prototype.hasOwnProperty.call(patchSchema.properties, "type")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(clonePatchSchema.properties, "type")).toBe(false);
      expect(Object.keys(patchSchema.properties).sort()).toEqual(
        ["disabled", "flags", "name", "system"].sort()
      );
    });

    it("requires a non-empty patch on update and leaves the clone patch OPTIONAL", () => {
      expect(patchSchema.minProperties).toBe(1);
      expect(clonePatchSchema.minProperties).toBe(1);
      expect(
        validate("scene.region.behavior.update", {
          sceneId: "s-1",
          regionId: "r-1",
          behaviorId: "b-1",
          patch: {}
        }).ok
      ).toBe(false);
      expect(
        validate("scene.region.behavior.update", { sceneId: "s-1", regionId: "r-1", behaviorId: "b-1" }).ok
      ).toBe(false);
      expect(
        validate("scene.region.behavior.clone", { sceneId: "s-1", regionId: "r-1", behaviorId: "b-1" }).ok
      ).toBe(true);
    });

    it("rejects an ARRAY `system` (Foundry silently stores it as {})", () => {
      expect(
        validate("scene.region.behavior.create", {
          sceneId: "s-1",
          regionId: "r-1",
          data: { type: "pauseGame", system: [1, 2] }
        }).ok
      ).toBe(false);
      expect(
        validate("scene.region.behavior.update", {
          sceneId: "s-1",
          regionId: "r-1",
          behaviorId: "b-1",
          patch: { system: [1, 2] }
        }).ok
      ).toBe(false);
    });

    it("requires all three ids where the address needs them, and rejects unknown params", () => {
      for (const command of [
        "scene.region.behavior.get",
        "scene.region.behavior.delete",
        "scene.region.behavior.clone"
      ]) {
        expect(COMMAND_DEFINITIONS[command].paramsSchema.required).toEqual([
          "sceneId",
          "regionId",
          "behaviorId"
        ]);
        expect(validate(command, { sceneId: "s-1", regionId: "r-1" }).ok, `${command} needs behaviorId`).toBe(
          false
        );
        expect(validate(command, { sceneId: "s-1", behaviorId: "b-1" }).ok, `${command} needs regionId`).toBe(
          false
        );
        expect(validate(command, { sceneId: "s-1", regionId: "r-1", behaviorId: "b-1", bogus: 1 }).ok).toBe(
          false
        );
      }
      expect(COMMAND_DEFINITIONS["scene.region.behavior.list"].paramsSchema.required).toEqual([
        "sceneId",
        "regionId"
      ]);
      expect(
        validate("scene.region.behavior.list", { sceneId: "s-1", regionId: "r-1", limit: 5, offset: 1 }).ok
      ).toBe(true);
    });
  });

  describe("macro command family", () => {
    it("exposes MACRO_NOT_FOUND in ERROR_CODES", () => {
      expect(ERROR_CODES.MACRO_NOT_FOUND).toBe("MACRO_NOT_FOUND");
    });

    it("accepts a minimal name-only create (type/scope have Foundry defaults)", () => {
      expect(validate("macro.create", { data: { name: "Heal" } })).toEqual({ ok: true, errors: [] });
    });

    it("accepts a full script macro create with command body, scope, and flags", () => {
      expect(
        validate("macro.create", {
          data: {
            name: "Fireball Macro",
            type: "script",
            command: "console.log(`hi ${actor?.name}`);",
            img: "icons/svg/dice-target.svg",
            scope: "global",
            flags: { "midi-qol": { onUseMacroName: "x" } }
          }
        })
      ).toEqual({ ok: true, errors: [] });
    });

    it("accepts chat type and every valid scope on create/update", () => {
      expect(validate("macro.create", { data: { name: "Say Hi", type: "chat" } }).ok).toBe(true);
      for (const scope of ["global", "actors", "actor"]) {
        expect(validate("macro.update", { macroId: "m-1", patch: { scope } }).ok).toBe(true);
      }
    });

    it("accepts flags on macro update (incl the -=key deletion payload shape)", () => {
      expect(
        validate("macro.update", { macroId: "m-1", patch: { flags: { mymod: { "-=stale": null } } } }).ok
      ).toBe(true);
    });

    it("rejects an invalid type/scope enum value", () => {
      expect(validate("macro.create", { data: { name: "X", type: "bogus" } }).ok).toBe(false);
      expect(validate("macro.create", { data: { name: "X", scope: "bogus" } }).ok).toBe(false);
    });

    it("rejects an unknown top-level field on create and patch (closed backstop intact)", () => {
      for (const [command, params] of [
        ["macro.create", { data: { name: "X", bogusField: true } }],
        ["macro.update", { macroId: "m-1", patch: { bogusField: true } }]
      ]) {
        const result = validate(command, params);
        expect(result.ok, `${command} should reject bogusField`).toBe(false);
      }
    });

    it("rejects the server-controlled `author` field on create and update", () => {
      expectRejected(
        "macro.create",
        { data: { name: "X", author: "spoof" } },
        "$.params.data.author is not allowed"
      );
      expectRejected(
        "macro.update",
        { macroId: "m-1", patch: { author: "spoof" } },
        "$.params.patch.author is not allowed"
      );
    });
  });

  describe("playlist command family", () => {
    it("exposes PLAYLIST_NOT_FOUND / PLAYLIST_SOUND_NOT_FOUND in ERROR_CODES", () => {
      expect(ERROR_CODES.PLAYLIST_NOT_FOUND).toBe("PLAYLIST_NOT_FOUND");
      expect(ERROR_CODES.PLAYLIST_SOUND_NOT_FOUND).toBe("PLAYLIST_SOUND_NOT_FOUND");
    });

    it("accepts a minimal name-only create", () => {
      expect(validate("playlist.create", { data: { name: "Ambience" } })).toEqual({ ok: true, errors: [] });
    });

    it("accepts a full create with every top-level field", () => {
      expect(
        validate("playlist.create", {
          data: {
            name: "Battle",
            description: "combat music",
            mode: 1,
            playing: false,
            fade: 2000,
            channel: "music",
            sorting: "m",
            seed: 7,
            folder: null,
            sort: 100,
            flags: { mymod: { x: 1 } }
          }
        }).ok
      ).toBe(true);
    });

    it("accepts inline sounds[] on create (proves the reused item schema)", () => {
      expect(
        validate("playlist.create", { data: { name: "P", sounds: [{ path: "a.ogg", volume: 0.5 }] } }).ok
      ).toBe(true);
    });

    it("tightened mode/channel/sorting enums reject out-of-enum values and accept valid ones (verified v13)", () => {
      expect(validate("playlist.create", { data: { name: "P", mode: 99 } }).ok).toBe(false);
      expect(validate("playlist.create", { data: { name: "P", mode: -1 } }).ok).toBe(true);

      expect(validate("playlist.create", { data: { name: "P", channel: "bogus" } }).ok).toBe(false);
      expect(validate("playlist.create", { data: { name: "P", channel: "environment" } }).ok).toBe(true);

      expect(validate("playlist.create", { data: { name: "P", sorting: "z" } }).ok).toBe(false);
      expect(validate("playlist.create", { data: { name: "P", sorting: "a" } }).ok).toBe(true);

      expect(validate("playlist.update", { playlistId: "pl-1", patch: { mode: 99 } }).ok).toBe(false);
      expect(validate("playlist.update", { playlistId: "pl-1", patch: { channel: "music" } }).ok).toBe(true);
    });

    it("rejects an unknown top-level field on create and patch (closed backstop intact)", () => {
      expect(validate("playlist.create", { data: { name: "X", bogus: true } }).ok).toBe(false);
      expect(validate("playlist.update", { playlistId: "pl-1", patch: { bogus: true } }).ok).toBe(false);
    });

    it("rejects sounds on playlist.update patch (fields-only update)", () => {
      expect(
        validate("playlist.update", { playlistId: "pl-1", patch: { sounds: [{ path: "a.ogg" }] } }).ok
      ).toBe(false);
    });
  });

  describe("playlist.sound embedded family", () => {
    it("accepts a minimal create (path only, name optional)", () => {
      expect(validate("playlist.sound.create", { playlistId: "pl-1", data: { path: "a.ogg" } })).toEqual({
        ok: true,
        errors: []
      });
    });

    it("rejects a create missing path", () => {
      expect(validate("playlist.sound.create", { playlistId: "pl-1", data: { name: "no path" } }).ok).toBe(
        false
      );
    });

    it("accepts the full field set incl volume/repeat/pausedTime/flags", () => {
      expect(
        validate("playlist.sound.create", {
          playlistId: "pl-1",
          data: {
            name: "Track",
            description: "d",
            path: "a.ogg",
            channel: "music",
            playing: true,
            pausedTime: 3,
            repeat: true,
            volume: 0.5,
            fade: 500,
            sort: 10,
            flags: { mymod: { x: 1 } }
          }
        }).ok
      ).toBe(true);
    });

    it("rejects an unknown top-level field on data and patch", () => {
      expect(
        validate("playlist.sound.create", { playlistId: "pl-1", data: { path: "a.ogg", bogus: true } }).ok
      ).toBe(false);
      expect(
        validate("playlist.sound.update", { playlistId: "pl-1", soundId: "s-1", patch: { bogus: true } }).ok
      ).toBe(false);
    });

    it("channel enum accepts the three keys AND null (nullable = inherit) and rejects out-of-enum (verified v13)", () => {
      expect(
        validate("playlist.sound.create", {
          playlistId: "pl-1",
          data: { path: "a.ogg", channel: "interface" }
        }).ok
      ).toBe(true);

      expect(
        validate("playlist.sound.create", { playlistId: "pl-1", data: { path: "a.ogg", channel: null } }).ok
      ).toBe(true);
      expect(
        validate("playlist.sound.create", { playlistId: "pl-1", data: { path: "a.ogg", channel: "bogus" } })
          .ok
      ).toBe(false);
      expect(
        validate("playlist.sound.update", { playlistId: "pl-1", soundId: "s-1", patch: { channel: "bogus" } })
          .ok
      ).toBe(false);
    });

    it("playlist.sound.list makes playlistId OPTIONAL (cross-playlist read) and adds a path filter", () => {
      expect(validate("playlist.sound.list", {})).toEqual({ ok: true, errors: [] });

      expect(validate("playlist.sound.list", { playlistId: "pl-1" }).ok).toBe(true);

      expect(
        validate("playlist.sound.list", { path: "extended", name: "battle", limit: 5, offset: 0 }).ok
      ).toBe(true);

      expect(validate("playlist.sound.list", { path: "" }).ok).toBe(false);

      expect(validate("playlist.sound.list", { bogus: true }).ok).toBe(false);
      expect(COMMAND_DEFINITIONS["playlist.sound.list"].paramsSchema.required).toEqual([]);
      expect(Object.keys(COMMAND_DEFINITIONS["playlist.sound.list"].paramsSchema.properties).sort()).toEqual(
        ["limit", "name", "offset", "path", "playlistId"].sort()
      );
    });
  });

  describe("playlist playback commands", () => {
    const PLAYBACK_COMMANDS = [
      "playlist.play",
      "playlist.stop",
      "playlist.playNext",
      "playlist.sound.play",
      "playlist.sound.stop"
    ];

    it("keeps every playback command a mutation and leaves dryRun off the playlist reads", () => {
      for (const command of PLAYBACK_COMMANDS) {
        expect(COMMAND_DEFINITIONS[command].mutation).toBe(true);
      }

      for (const readCommand of ["playlist.get", "playlist.sound.get"]) {
        expect(COMMAND_DEFINITIONS[readCommand].paramsSchema.properties?.dryRun).toBeUndefined();
      }
    });

    it("accepts playlist-level params and rejects unknown / missing fields", () => {
      expect(validate("playlist.play", { playlistId: "pl-1" }).ok).toBe(true);
      expect(validate("playlist.stop", { playlistId: "pl-1", dryRun: true }).ok).toBe(true);
      expect(validate("playlist.play", { playlistId: "pl-1", bogus: true }).ok).toBe(false);
      expect(validate("playlist.play", {}).ok).toBe(false);

      expect(validate("playlist.play", { playlistId: "pl-1", idempotencyKey: "k" }).ok).toBe(false);
    });

    it("playNext accepts optional soundId + direction 1/-1 and rejects other directions", () => {
      expect(validate("playlist.playNext", { playlistId: "pl-1" }).ok).toBe(true);
      expect(validate("playlist.playNext", { playlistId: "pl-1", soundId: "s-1", direction: 1 }).ok).toBe(
        true
      );
      expect(validate("playlist.playNext", { playlistId: "pl-1", direction: -1 }).ok).toBe(true);
      expect(validate("playlist.playNext", { playlistId: "pl-1", direction: 2 }).ok).toBe(false);
    });

    it("sound-level playback requires both playlistId and soundId", () => {
      expect(validate("playlist.sound.play", { playlistId: "pl-1", soundId: "s-1" }).ok).toBe(true);
      expect(validate("playlist.sound.stop", { playlistId: "pl-1" }).ok).toBe(false);
    });
  });

  describe("table world family", () => {
    it("exposes TABLE_NOT_FOUND in ERROR_CODES", () => {
      expect(ERROR_CODES.TABLE_NOT_FOUND).toBe("TABLE_NOT_FOUND");
    });

    it("declares the full CRUD + ownership surface with the right mutation flags", () => {
      for (const command of ["table.list", "table.get", "table.get-many"]) {
        expect(COMMAND_DEFINITIONS[command].mutation).toBe(false);
      }
      for (const command of [
        "table.create",
        "table.update",
        "table.clone",
        "table.delete",
        "table.ownership.set"
      ]) {
        expect(COMMAND_DEFINITIONS[command].mutation).toBe(true);
      }
    });

    it("accepts a minimal create (name only) and rejects a missing/blank name", () => {
      expect(validate("table.create", { data: { name: "Loot" } })).toEqual({ ok: true, errors: [] });
      expect(validate("table.create", { data: {} }).ok).toBe(false);

      expect(validate("table.create", { data: { name: "" } }).ok).toBe(false);
    });

    it("accepts the full table field set incl nullable img/folder and inline results", () => {
      expect(
        validate("table.create", {
          data: {
            name: "Loot",
            img: "worlds/w/loot.webp",
            description: "<p>Treasure</p>",
            formula: "1d20",
            replacement: false,
            displayRoll: true,
            folder: "folder-1",
            sort: 10,
            flags: { mymod: { x: 1 } },
            results: [{ name: "Sword", range: [1, 10], weight: 2, img: "worlds/w/sword.webp" }]
          }
        }).ok
      ).toBe(true);

      expect(validate("table.create", { data: { name: "L", img: null, folder: null } }).ok).toBe(true);

      expect(validate("table.create", { data: { name: "L", formula: null } }).ok).toBe(false);
      expect(validate("table.create", { data: { name: "L", formula: "" } }).ok).toBe(true);
    });

    it("rejects an unknown top-level field on data and patch (CLOSED world doc)", () => {
      expect(validate("table.create", { data: { name: "L", bogus: true } }).ok).toBe(false);
      expect(validate("table.update", { tableId: "t-1", patch: { bogus: true } }).ok).toBe(false);
    });

    it("keeps inline `results` a CREATE-only field", () => {
      const createProps = Object.keys(
        COMMAND_DEFINITIONS["table.create"].paramsSchema.properties.data.properties
      );
      const updateProps = Object.keys(
        COMMAND_DEFINITIONS["table.update"].paramsSchema.properties.patch.properties
      );

      expect(createProps).toContain("results");
      expect(updateProps).not.toContain("results");
      expect(COMMAND_DEFINITIONS["table.update"].paramsSchema.properties.patch.minProperties).toBe(1);
    });

    it("pins the inline results[] item schema as the closed TableResult create field set", () => {
      const resultSchema =
        COMMAND_DEFINITIONS["table.create"].paramsSchema.properties.data.properties.results.items;
      expect(Object.keys(resultSchema.properties).sort()).toEqual(
        ["description", "documentUuid", "drawn", "flags", "img", "name", "range", "type", "weight"].sort()
      );
      expect(resultSchema.additionalProperties).toBe(false);

      expect(resultSchema.required).toEqual(["range"]);

      expect(resultSchema.properties.name).toEqual({ type: "string" });
      expect(resultSchema.properties.type.enum).toEqual(["text", "document"]);
      expect(resultSchema.properties.weight).toEqual({ type: "integer", minimum: 1 });
      expect(resultSchema.properties.range).toEqual({
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: { type: "integer" }
      });
    });

    it("validates inline result payloads: range shape, type enum, weight, and the legacy traps", () => {
      const create = (result) => validate("table.create", { data: { name: "L", results: [result] } });
      expect(create({ range: [1, 1] }).ok).toBe(true);
      expect(create({ name: "", range: [1, 1] }).ok).toBe(true);

      expect(create({ name: "X" }).ok).toBe(false);
      expect(create({ range: [1] }).ok).toBe(false);
      expect(create({ range: [1.5, 2] }).ok).toBe(false);
      expect(create({ range: [null, null] }).ok).toBe(false);

      expect(create({ type: "text", range: [1, 1] }).ok).toBe(true);
      expect(create({ type: "document", documentUuid: "Actor.abc", range: [1, 1] }).ok).toBe(true);
      expect(create({ type: "pack", range: [1, 1] }).ok).toBe(false);
      expect(create({ type: "compendium", range: [1, 1] }).ok).toBe(false);

      expect(create({ weight: 0, range: [1, 1] }).ok).toBe(false);
      expect(create({ weight: 1.5, range: [1, 1] }).ok).toBe(false);

      expect(create({ documentUuid: null, img: null, range: [1, 1] }).ok).toBe(true);

      for (const legacy of [
        { text: "legacy", range: [1, 1] },
        { documentId: "abcdefghij123456", range: [1, 1] },
        { documentCollection: "Actor", range: [1, 1] }
      ]) {
        expect(create(legacy).ok, `${JSON.stringify(legacy)} should be rejected`).toBe(false);
      }

      expect(create({ _id: "spoof", range: [1, 1] }).ok).toBe(false);
      expect(create({ _stats: {}, range: [1, 1] }).ok).toBe(false);
    });

    it("rejects a BLANK img / documentUuid everywhere while keeping null accepted", () => {
      const create = (data) => validate("table.create", { data: { name: "L", ...data } });
      const patch = (p) => validate("table.update", { tableId: "t-1", patch: p });
      const clonePatch = (p) => validate("table.clone", { tableId: "t-1", patch: p });
      const inline = (result) => validate("table.create", { data: { name: "L", results: [result] } });

      for (const blank of ["", "  "]) {
        const expected = blank === "";
        expect(create({ img: blank }).ok).toBe(!expected);
        expect(patch({ img: blank }).ok).toBe(!expected);
        expect(clonePatch({ img: blank }).ok).toBe(!expected);
        expect(inline({ range: [1, 1], img: blank }).ok).toBe(!expected);
        expect(inline({ range: [1, 1], type: "document", documentUuid: blank }).ok).toBe(!expected);
      }
      expect(create({ img: "" }).errors).toContainEqual(
        expect.stringContaining("$.params.data.img must be at least 1 characters long")
      );
      expect(inline({ range: [1, 1], documentUuid: "" }).errors).toContainEqual(
        expect.stringContaining("$.params.data.results[0].documentUuid must be at least 1 characters long")
      );

      expect(create({ img: null }).ok).toBe(true);
      expect(patch({ img: null }).ok).toBe(true);
      expect(clonePatch({ img: null }).ok).toBe(true);
      expect(inline({ range: [1, 1], img: null, documentUuid: null }).ok).toBe(true);
    });

    it("table.get / get-many / list carry no dryRun and no include", () => {
      for (const command of ["table.get", "table.get-many", "table.list"]) {
        expect(COMMAND_DEFINITIONS[command].paramsSchema.properties?.dryRun).toBeUndefined();
        expect(COMMAND_DEFINITIONS[command].paramsSchema.properties?.include).toBeUndefined();
      }
      expect(validate("table.get", { tableId: "t-1" }).ok).toBe(true);
      expect(validate("table.get", { tableId: "t-1", bogus: 1 }).ok).toBe(false);
      expect(validate("table.get-many", { ids: ["t-1", "t-2"] }).ok).toBe(true);
      expect(validate("table.get-many", { ids: [] }).ok).toBe(false);
      expect(validate("table.list", { name: "loot", limit: 5, offset: 0 }).ok).toBe(true);
    });

    it("table.ownership.set is the SEVENTH ownership family (levels 0..3, no INHERIT)", () => {
      const props = /** @type {any} */ (COMMAND_DEFINITIONS["table.ownership.set"].paramsSchema.properties);
      expect(props.tableId).toEqual({ type: "string", minLength: 1 });
      expect(props.default.enum).toEqual([0, 1, 2, 3]);
      expect(props.users.additionalProperties.enum).toEqual([0, 1, 2, 3]);

      expect(props.pageId).toBeUndefined();
      expect(validate("table.ownership.set", { tableId: "t-1", default: 2 }).ok).toBe(true);
      expect(validate("table.ownership.set", { tableId: "t-1", default: -1 }).ok).toBe(false);
    });

    it("table.result.create reuses the EXACT inline results[] item schema object", () => {
      expect(COMMAND_DEFINITIONS["table.result.create"].paramsSchema.properties.data).toBe(
        COMMAND_DEFINITIONS["table.create"].paramsSchema.properties.data.properties.results.items
      );
    });

    it("shares the table.result patch with clone and leaves `range` optional", () => {
      const patchSchema = COMMAND_DEFINITIONS["table.result.update"].paramsSchema.properties.patch;

      expect(COMMAND_DEFINITIONS["table.result.clone"].paramsSchema.properties.patch).toBe(patchSchema);

      expect(patchSchema.required).toEqual([]);
      expect(patchSchema.minProperties).toBe(1);
      expect(patchSchema.properties.range).toEqual({
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: { type: "integer" }
      });

      expect(patchSchema.properties.img).toEqual({ type: ["string", "null"], minLength: 1 });
      expect(patchSchema.properties.documentUuid).toEqual({ type: ["string", "null"], minLength: 1 });

      expect(patchSchema.properties.type.enum).toEqual(["text", "document"]);

      expect(patchSchema.properties.name).toEqual({ type: "string" });
    });

    it("validates the table.result.* param surface (ids, enums, empty patch)", () => {
      expect(validate("table.result.create", { tableId: "t-1", data: { range: [1, 1] } }).ok).toBe(true);

      expect(validate("table.result.create", { tableId: "t-1", data: { name: "X" } }).ok).toBe(false);
      expect(validate("table.result.create", { data: { range: [1, 1] } }).ok).toBe(false);
      expect(validate("table.result.get", { tableId: "t-1", resultId: "r-1" }).ok).toBe(true);
      expect(validate("table.result.get", { tableId: "t-1" }).ok).toBe(false);
      expect(validate("table.result.get", { tableId: "t-1", resultId: "" }).ok).toBe(false);
      expect(
        validate("table.result.update", { tableId: "t-1", resultId: "r-1", patch: { weight: 3 } }).ok
      ).toBe(true);

      expect(validate("table.result.update", { tableId: "t-1", resultId: "r-1", patch: {} }).ok).toBe(false);
      expect(
        validate("table.result.update", { tableId: "t-1", resultId: "r-1", patch: { type: "pack" } }).ok
      ).toBe(false);

      for (const legacy of [
        { text: "x" },
        { documentId: "abcdefghij123456" },
        { documentCollection: "Actor" }
      ]) {
        expect(validate("table.result.update", { tableId: "t-1", resultId: "r-1", patch: legacy }).ok).toBe(
          false
        );
      }

      expect(validate("table.result.clone", { tableId: "t-1", resultId: "r-1" }).ok).toBe(true);
      expect(
        validate("table.result.clone", { tableId: "t-1", resultId: "r-1", patch: { name: "Copy" } }).ok
      ).toBe(true);
      expect(validate("table.result.delete", { tableId: "t-1", resultId: "r-1" }).ok).toBe(true);
      expect(validate("table.result.delete", { tableId: "t-1", resultId: "r-1", patch: {} }).ok).toBe(false);
    });

    it("table.result.list takes an OPTIONAL tableId (cross-table mode) and no dryRun", () => {
      const schema = /** @type {any} */ (COMMAND_DEFINITIONS["table.result.list"].paramsSchema);
      expect(schema.required).toEqual([]);
      expect(schema.additionalProperties).toBe(false);
      expect(schema.properties.dryRun).toBeUndefined();

      expect(Object.keys(schema.properties).sort()).toEqual(["limit", "name", "offset", "tableId"]);
      expect(validate("table.result.list", {}).ok).toBe(true);
      expect(validate("table.result.list", { tableId: "t-1", name: "sword", limit: 5, offset: 0 }).ok).toBe(
        true
      );
      expect(validate("table.result.list", { tableId: "" }).ok).toBe(false);

      for (const command of ["table.result.get", "table.result.list"]) {
        expect(COMMAND_DEFINITIONS[command].paramsSchema.properties?.include).toBeUndefined();
      }
    });

    it("pins table.draw's allowed key set AND its required array (the only command REQUIRING idempotencyKey)", () => {
      const schema = /** @type {any} */ (COMMAND_DEFINITIONS["table.draw"].paramsSchema);
      expect(COMMAND_DEFINITIONS["table.draw"].mutation).toBe(true);
      expect(schema.additionalProperties).toBe(false);
      expect(Object.keys(schema.properties).sort()).toEqual([
        "chat",
        "count",
        "dryRun",
        "idempotencyKey",
        "recursive",
        "rollMode",
        "tableId"
      ]);

      expect(schema.required).toEqual(["tableId", "idempotencyKey"]);
      expect(validate("table.draw", { tableId: "t-1" }).ok).toBe(false);
      expect(validate("table.draw", { tableId: "t-1" }).errors).toContain(
        "$.params.idempotencyKey is required"
      );

      expect(validate("table.draw", { tableId: "t-1", dryRun: true }).ok).toBe(false);
      expect(validate("table.draw", { tableId: "t-1", idempotencyKey: "k", dryRun: true }).ok).toBe(true);
    });

    it("pins TABLE_ROLL_MODES and rejects the two values deliberately kept out of the enum", () => {
      expect(TABLE_ROLL_MODES).toEqual(["public", "gm", "blind", "self"]);
      for (const mode of TABLE_ROLL_MODES) {
        expect(validate("table.draw", { tableId: "t-1", idempotencyKey: "k", rollMode: mode }).ok).toBe(true);
      }

      for (const mode of ["roll", "ic", "publicroll", "gmroll", "PUBLIC", ""]) {
        expect(validate("table.draw", { tableId: "t-1", idempotencyKey: "k", rollMode: mode }).ok, mode).toBe(
          false
        );
      }
    });

    it("bounds table.draw --count and type-checks the two boolean switches", () => {
      expect(TABLE_DRAW_MAX_COUNT).toBe(100);
      const base = { tableId: "t-1", idempotencyKey: "k" };
      expect(validate("table.draw", { ...base, count: 1 }).ok).toBe(true);
      expect(validate("table.draw", { ...base, count: TABLE_DRAW_MAX_COUNT }).ok).toBe(true);

      expect(validate("table.draw", { ...base, count: TABLE_DRAW_MAX_COUNT + 1 }).ok).toBe(false);
      expect(validate("table.draw", { ...base, count: 0 }).ok).toBe(false);
      expect(validate("table.draw", { ...base, count: 1.5 }).ok).toBe(false);
      expect(validate("table.draw", { ...base, chat: false, recursive: false }).ok).toBe(true);
      expect(validate("table.draw", { ...base, chat: "no" }).ok).toBe(false);
      expect(validate("table.draw", { ...base, recursive: 1 }).ok).toBe(false);
    });

    it("pins table.reset's key set: id + dryRun + an OPTIONAL idempotencyKey", () => {
      const schema = /** @type {any} */ (COMMAND_DEFINITIONS["table.reset"].paramsSchema);
      expect(COMMAND_DEFINITIONS["table.reset"].mutation).toBe(true);
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(["tableId"]);
      expect(Object.keys(schema.properties).sort()).toEqual(["dryRun", "idempotencyKey", "tableId"]);

      expect(validate("table.reset", { tableId: "t-1" }).ok).toBe(true);
      expect(validate("table.reset", { tableId: "t-1", dryRun: true, idempotencyKey: "k" }).ok).toBe(true);
      expect(validate("table.reset", {}).ok).toBe(false);
    });

    it("pins the FULL chat-capture status enum and the mutation-outcome enum", () => {
      expect(CHAT_CAPTURE_STATUSES).toEqual([
        "captured",
        "partial",
        "not-created",
        "not-requested",
        "unknown"
      ]);
      expect(TABLE_MUTATION_OUTCOMES).toEqual(["committed", "unknown", "not-executed"]);
    });
  });

  describe("cards world family", () => {
    it("exposes CARDS_NOT_FOUND and CARD_NOT_FOUND in ERROR_CODES", () => {
      expect(ERROR_CODES.CARDS_NOT_FOUND).toBe("CARDS_NOT_FOUND");

      expect(ERROR_CODES.CARD_NOT_FOUND).toBe("CARD_NOT_FOUND");
    });

    it("declares the eight cards.* CRUD verbs, the ownership setter, the five action verbs and the six cards.card.* verbs", () => {
      expect(COMMAND_NAMES.filter((name) => name.startsWith("cards.")).sort()).toEqual([
        "cards.card.clone",
        "cards.card.create",
        "cards.card.delete",
        "cards.card.get",
        "cards.card.list",
        "cards.card.update",
        "cards.clone",
        "cards.create",
        "cards.deal",
        "cards.delete",
        "cards.draw",
        "cards.get",
        "cards.get-many",

        "cards.import-from-compendium",
        "cards.list",
        "cards.ownership.set",
        "cards.pass",
        "cards.reset",
        "cards.shuffle",
        "cards.update"
      ]);

      for (const absent of [
        "cards.card.get-many",
        "cards.card.ownership.set",
        "cards.card.play",
        "cards.card.discard",
        "cards.card.flip"
      ]) {
        expect(COMMAND_NAMES).not.toContain(absent);
      }
      for (const command of ["cards.shuffle", "cards.reset", "cards.deal", "cards.draw", "cards.pass"]) {
        expect(COMMAND_DEFINITIONS[command].mutation).toBe(true);
      }
      for (const command of [
        "cards.list",
        "cards.get",
        "cards.get-many",
        "cards.card.list",
        "cards.card.get"
      ]) {
        expect(COMMAND_DEFINITIONS[command].mutation).toBe(false);
      }
      for (const command of [
        "cards.create",
        "cards.update",
        "cards.clone",
        "cards.delete",
        "cards.ownership.set",
        "cards.card.create",
        "cards.card.update",
        "cards.card.clone",
        "cards.card.delete"
      ]) {
        expect(COMMAND_DEFINITIONS[command].mutation).toBe(true);
      }
    });

    it("requires `type` beside `name` on cards.create", () => {
      const data = COMMAND_DEFINITIONS["cards.create"].paramsSchema.properties.data;

      expect(data.required.slice().sort()).toEqual(["name", "type"]);
      expect(validate("cards.create", { data: { name: "Deck", type: "deck" } }).ok).toBe(true);
      expect(validate("cards.create", { data: { name: "Deck" } }).ok).toBe(false);
      expect(validate("cards.create", { data: { type: "deck" } }).ok).toBe(false);
    });

    it("pins the `type` enum as the bridge POLICY it is, and keeps it OUT of the patch", () => {
      const data = COMMAND_DEFINITIONS["cards.create"].paramsSchema.properties.data;

      expect(data.properties.type).toEqual({ type: "string", enum: ["deck", "hand", "pile"] });
      expect(validate("cards.create", { data: { name: "D", type: "base" } }).ok).toBe(false);

      const patch = COMMAND_DEFINITIONS["cards.update"].paramsSchema.properties.patch;
      expect(patch.properties).not.toHaveProperty("type");
      expect(validate("cards.update", { cardsId: "c1", patch: { type: "hand" } }).ok).toBe(false);
    });

    it("keeps cards.update fields-only: `cards` is rejected in the patch", () => {
      const patch = COMMAND_DEFINITIONS["cards.update"].paramsSchema.properties.patch;
      expect(patch.properties).not.toHaveProperty("cards");
      expect(patch.additionalProperties).toBe(false);
      expect(patch.minProperties).toBe(1);

      expect(validate("cards.update", { cardsId: "c1", patch: { cards: [] } }).ok).toBe(false);
      expect(validate("cards.update", { cardsId: "c1", patch: { cards: [{ name: "X" }] } }).ok).toBe(false);
      expect(validate("cards.update", { cardsId: "c1", patch: {} }).ok).toBe(false);

      expect(COMMAND_DEFINITIONS["cards.clone"].paramsSchema.properties.patch).toBe(patch);
    });

    it("pins the CLOSED Card patch field set: create minus `type`, name no longer required", () => {
      const create = COMMAND_DEFINITIONS["cards.card.create"].paramsSchema.properties.data;
      const patch = COMMAND_DEFINITIONS["cards.card.update"].paramsSchema.properties.patch;

      expect(Object.keys(patch.properties).sort()).toEqual(
        Object.keys(create.properties)
          .filter((field) => field !== "type")
          .sort()
      );

      for (const field of Object.keys(patch.properties)) {
        expect(patch.properties[field], field).toBe(create.properties[field]);
      }

      const freeform = { type: "object", required: [], properties: {}, additionalProperties: true };
      const imgField = { type: ["string", "null"], minLength: 1 };
      const faceLike = {
        type: "object",
        required: [],
        properties: { name: { type: "string" }, text: { type: "string" }, img: imgField },
        additionalProperties: false
      };
      expect(create.properties).toEqual({
        name: { type: "string", minLength: 1 }, // StringField blank:false, no initial
        description: { type: "string" },
        type: { type: "string", minLength: 1 }, // NOT enum-typed: a system may register a subtype
        system: freeform,
        suit: { type: "string" }, // blank IS legal in Foundry — a minLength here is an over-refusal
        value: { type: ["number", "null"] }, // a NumberField: "K" is rejected by Foundry itself
        back: faceLike, // nullable-but-not-blankable img ("" → null)
        faces: { type: "array", items: faceLike }, // "" → the joker DEFAULT ICON
        face: { type: ["integer", "null"], minimum: 0 }, // -1 silently clamps to face 0
        width: { type: ["integer", "null"], minimum: 1 }, // v14 clamps 0 to 1; v13 throws
        height: { type: ["integer", "null"], minimum: 1 },

        rotation: { type: "number", minimum: 0, exclusiveMaximum: 360 },
        sort: { type: "integer" }, // IntegerSortField, no minimum (-5 is accepted)
        flags: freeform
      });

      expect(patch.properties).not.toHaveProperty("type");
      expect(create.properties.type).toEqual({ type: "string", minLength: 1 });
      expect(patch.additionalProperties).toBe(false);
      expect(patch.required).toEqual([]);
      expect(patch.minProperties).toBe(1);

      for (const absent of ["drawn", "origin", "img"]) {
        expect(patch.properties).not.toHaveProperty(absent);
      }

      expect(COMMAND_DEFINITIONS["cards.card.clone"].paramsSchema.properties.patch).toBe(patch);

      expect(patch.properties.back).toBe(create.properties.back);
      expect(patch.properties.faces).toBe(create.properties.faces);
    });

    it("validates cards.card.* params: the (cardsId, cardId) pair, closed nesting, no dotted faces", () => {
      expect(validate("cards.card.list", {}).ok).toBe(true);
      expect(validate("cards.card.list", { cardsId: "c1", limit: 5, name: "ace" }).ok).toBe(true);
      expect(validate("cards.card.get", { cardsId: "c1", cardId: "k1" }).ok).toBe(true);

      for (const command of [
        "cards.card.get",
        "cards.card.update",
        "cards.card.clone",
        "cards.card.delete"
      ]) {
        expect(validate(command, { cardId: "k1", patch: { sort: 1 } }).ok, command).toBe(false);
        expect(validate(command, { cardsId: "c1", patch: { sort: 1 } }).ok, command).toBe(false);
      }
      expect(validate("cards.card.create", { cardsId: "c1", data: { name: "Ace" } }).ok).toBe(true);
      expect(validate("cards.card.create", { cardsId: "c1", data: {} }).ok).toBe(false);

      for (const bad of [{ drawn: true }, { origin: "cardsAAAAAAAAAA1" }, { img: "worlds/w/a.webp" }]) {
        expect(
          validate("cards.card.create", { cardsId: "c1", data: { name: "A", ...bad } }).ok,
          JSON.stringify(bad)
        ).toBe(false);
        expect(
          validate("cards.card.update", { cardsId: "c1", cardId: "k1", patch: bad }).ok,
          JSON.stringify(bad)
        ).toBe(false);
      }

      expect(
        validate("cards.card.update", { cardsId: "c1", cardId: "k1", patch: { back: { nope: 1 } } }).ok
      ).toBe(false);
      expect(
        validate("cards.card.update", { cardsId: "c1", cardId: "k1", patch: { faces: [{ nope: 1 }] } }).ok
      ).toBe(false);
      expect(
        validate("cards.card.update", { cardsId: "c1", cardId: "k1", patch: { back: { img: "" } } }).ok
      ).toBe(false);
      expect(
        validate("cards.card.update", { cardsId: "c1", cardId: "k1", patch: { back: { img: null } } }).ok
      ).toBe(true);

      expect(
        validate("cards.card.update", { cardsId: "c1", cardId: "k1", patch: { "faces.0.name": "x" } }).ok
      ).toBe(false);

      expect(validate("cards.card.update", { cardsId: "c1", cardId: "k1", patch: { face: -1 } }).ok).toBe(
        false
      );
      expect(validate("cards.card.update", { cardsId: "c1", cardId: "k1", patch: {} }).ok).toBe(false);

      expect(validate("cards.card.clone", { cardsId: "c1", cardId: "k1" }).ok).toBe(true);
    });

    it("cards.card.create reuses the EXACT inline cards[] item schema object", () => {
      expect(COMMAND_DEFINITIONS["cards.card.create"].paramsSchema.properties.data).toBe(
        COMMAND_DEFINITIONS["cards.create"].paramsSchema.properties.data.properties.cards.items
      );
    });

    it("pins the inline cards[] item schema as the closed Card create field set", () => {
      const cardSchema =
        COMMAND_DEFINITIONS["cards.create"].paramsSchema.properties.data.properties.cards.items;
      expect(Object.keys(cardSchema.properties).sort()).toEqual(
        [
          "back",
          "description",
          "face",
          "faces",
          "flags",
          "height",
          "name",
          "rotation",
          "sort",
          "suit",
          "system",
          "type",
          "value",
          "width"
        ].sort()
      );
      expect(cardSchema.additionalProperties).toBe(false);
      expect(cardSchema.required).toEqual(["name"]);

      for (const absent of ["drawn", "origin", "img"]) {
        expect(cardSchema.properties).not.toHaveProperty(absent);
      }

      expect(cardSchema.properties.value).toEqual({ type: ["number", "null"] });

      expect(cardSchema.properties.suit).toEqual({ type: "string" });

      expect(cardSchema.properties.face).toEqual({ type: ["integer", "null"], minimum: 0 });

      expect(cardSchema.properties.back.additionalProperties).toBe(false);
      expect(Object.keys(cardSchema.properties.back.properties).sort()).toEqual(["img", "name", "text"]);
      expect(cardSchema.properties.faces.items.additionalProperties).toBe(false);
      expect(Object.keys(cardSchema.properties.faces.items.properties).sort()).toEqual([
        "img",
        "name",
        "text"
      ]);
    });

    it("validates inline card payloads: name required, value numeric, closed sub-schemas", () => {
      const create = (card) => validate("cards.create", { data: { name: "D", type: "deck", cards: [card] } });
      expect(create({ name: "Ace" }).ok).toBe(true);
      expect(create({ name: "Ace", suit: "", value: null, face: null }).ok).toBe(true);
      expect(create({ suit: "S" }).ok).toBe(false);
      expect(create({ name: "" }).ok).toBe(false);
      expect(create({ name: "K", value: "K" }).ok).toBe(false);
      expect(create({ name: "A", face: -1 }).ok).toBe(false);
      expect(create({ name: "A", drawn: true }).ok).toBe(false);
      expect(create({ name: "A", origin: "cardsAAAAAAAAAA1" }).ok).toBe(false);
      expect(create({ name: "A", img: "worlds/w/a.webp" }).ok).toBe(false);
      expect(create({ name: "A", back: { nope: 1 } }).ok).toBe(false);
      expect(create({ name: "A", faces: [{ nope: 1 }] }).ok).toBe(false);

      expect(validate("cards.update", { cardsId: "c1", patch: { "faces.0.name": "x" } }).ok).toBe(false);
    });

    it("nullable-but-NOT-blankable: the three FilePath fields and the two foreign ids", () => {
      const data = COMMAND_DEFINITIONS["cards.create"].paramsSchema.properties.data;
      const cardSchema = data.properties.cards.items;

      for (const schema of [
        data.properties.img,
        cardSchema.properties.back.properties.img,
        cardSchema.properties.faces.items.properties.img
      ]) {
        expect(schema).toEqual({ type: ["string", "null"], minLength: 1 });
      }

      expect(data.properties.folder).toEqual({ type: ["string", "null"], minLength: 1 });
      expect(validate("cards.create", { data: { name: "D", type: "deck", img: "" } }).ok).toBe(false);
      expect(validate("cards.create", { data: { name: "D", type: "deck", img: null } }).ok).toBe(true);
      expect(validate("cards.create", { data: { name: "D", type: "deck", folder: "" } }).ok).toBe(false);
      expect(validate("cards.create", { data: { name: "D", type: "deck", folder: null } }).ok).toBe(true);
      expect(validate("cards.create", { data: { name: "D", type: "deck", folder: 0 } }).ok).toBe(false);
    });

    it("pins the numeric bounds that make the two cores agree", () => {
      const data = COMMAND_DEFINITIONS["cards.create"].paramsSchema.properties.data;
      const cardSchema = data.properties.cards.items;
      for (const schema of [
        data.properties.width,
        data.properties.height,
        cardSchema.properties.width,
        cardSchema.properties.height
      ]) {
        expect(schema).toEqual({ type: ["integer", "null"], minimum: 1 });
      }

      expect(data.properties.rotation).toEqual({ type: "number", minimum: 0, exclusiveMaximum: 360 });

      expect(data.properties.sort).toEqual({ type: "integer" });
      expect(validate("cards.create", { data: { name: "D", type: "deck", width: 0 } }).ok).toBe(false);
      expect(validate("cards.create", { data: { name: "D", type: "deck", rotation: 370 } }).ok).toBe(false);
      expect(validate("cards.create", { data: { name: "D", type: "deck", sort: -5 } }).ok).toBe(true);

      const freeform = { type: "object", required: [], properties: {}, additionalProperties: true };
      const patch = COMMAND_DEFINITIONS["cards.update"].paramsSchema.properties.patch;
      expect(patch.properties).toEqual({
        name: { type: "string", minLength: 1 },
        description: { type: "string" },
        img: { type: ["string", "null"], minLength: 1 }, // nullable, NOT blankable
        system: freeform,
        width: { type: ["integer", "null"], minimum: 1 },
        height: { type: ["integer", "null"], minimum: 1 },
        rotation: { type: "number", minimum: 0, exclusiveMaximum: 360 },
        displayCount: { type: "boolean" },
        folder: { type: ["string", "null"], minLength: 1 }, // a blank folder is a real UNLINK
        sort: { type: "integer" },
        flags: freeform
      });
      const sharedWithCreate = Object.fromEntries(
        Object.entries(data.properties).filter(([field]) => field !== "type" && field !== "cards")
      );
      expect(sharedWithCreate).toEqual(patch.properties);
      expect(validate("cards.update", { cardsId: "c1", patch: { width: 0 } }).ok).toBe(false);
      expect(validate("cards.update", { cardsId: "c1", patch: { rotation: 370 } }).ok).toBe(false);

      for (const [command, params] of [
        ["cards.create", { data: { name: "D", type: "deck", rotation: 360 } }],
        ["cards.create", { data: { name: "D", type: "deck", cards: [{ name: "C", rotation: 360 }] } }],
        ["cards.update", { cardsId: "c1", patch: { rotation: 360 } }],
        ["cards.clone", { cardsId: "c1", patch: { rotation: 360 } }],
        ["cards.card.create", { cardsId: "c1", data: { name: "C", rotation: 360 } }],
        ["cards.card.update", { cardsId: "c1", cardId: "x1", patch: { rotation: 360 } }],
        ["cards.card.clone", { cardsId: "c1", cardId: "x1", patch: { rotation: 360 } }]
      ]) {
        expect(validate(command, params).ok, `${command} must reject rotation 360`).toBe(false);
      }
      expect(validate("cards.create", { data: { name: "D", type: "deck", rotation: 359.5 } }).ok).toBe(true);
      expect(validate("cards.card.create", { cardsId: "c1", data: { name: "C", rotation: 0 } }).ok).toBe(
        true
      );
    });

    it("cards.delete carries dryRun + an OPTIONAL idempotencyKey and NO chat param", () => {
      const schema = COMMAND_DEFINITIONS["cards.delete"].paramsSchema;
      expect(Object.keys(schema.properties).sort()).toEqual(["cardsId", "dryRun", "idempotencyKey"]);
      expect(schema.required).toEqual(["cardsId"]);

      expect(schema.properties).not.toHaveProperty("chat");
      expect(validate("cards.delete", { cardsId: "c1", chat: false }).ok).toBe(false);
    });

    it("keeps cards.list pagination + the standard name filter, and cards.get closed", () => {
      expect(validate("cards.list", { name: "deck", limit: 5, offset: 1 }).ok).toBe(true);
      expect(validate("cards.list", { name: "" }).ok).toBe(false);
      expect(validate("cards.get", { cardsId: "c1" }).ok).toBe(true);
      expect(validate("cards.get", { cardsId: "c1", dryRun: true }).ok).toBe(false);
      expect(validate("cards.get-many", { ids: ["c1", "c2"] }).ok).toBe(true);
      expect(validate("cards.get-many", { ids: [] }).ok).toBe(false);
    });

    it("pins the FULL cards.delete chatNotification.status enum", () => {
      expect(CARDS_DELETE_CHAT_STATUSES).toEqual(["dispatched", "unknown", "not-requested"]);

      expect(COMMAND_DEFINITIONS["cards.delete"].paramsSchema.properties).not.toHaveProperty("chat");
    });

    it("pins the FULL cards.delete recall.status enum, beside its chat sibling", () => {
      expect(CARDS_RECALL_STATUSES).toEqual(["not-executed", "confirmed", "unconfirmed", "not-verified"]);

      for (const status of CARDS_RECALL_STATUSES) {
        expect(CARDS_DELETE_CHAT_STATUSES).not.toContain(status);
      }

      expect(CARDS_RECALL_STATUSES).not.toContain("committed");
      expect(CARDS_RECALL_STATUSES).not.toContain("unknown");
    });

    it("pins the recall.deleteConsequences enum, DISJOINT from its two siblings in the same body", () => {
      expect(CARDS_RECALL_CONSEQUENCE_SCOPES).toEqual(["applied", "prospective", "unknown"]);

      for (const scope of CARDS_RECALL_CONSEQUENCE_SCOPES) {
        expect(CARDS_RECALL_STATUSES).not.toContain(scope);
      }

      expect(CARDS_DELETE_CHAT_STATUSES).toContain("unknown");
      expect(CARDS_RECALL_CONSEQUENCE_SCOPES).toContain("unknown");
    });

    it("cards.ownership.set takes cardsId and rejects INHERIT (-1)", () => {
      const schema = COMMAND_DEFINITIONS["cards.ownership.set"].paramsSchema;
      expect(schema.required).toEqual(["cardsId"]);
      expect(schema.additionalProperties).toBe(false);
      expect(validate("cards.ownership.set", { cardsId: "c1", default: 3 }).ok).toBe(true);
      expect(validate("cards.ownership.set", { cardsId: "c1", users: { u1: 2 } }).ok).toBe(true);

      expect(validate("cards.ownership.set", { cardsId: "c1", default: -1 }).ok).toBe(false);
      expect(validate("cards.ownership.set", { cardsId: "c1", users: { u1: -1 } }).ok).toBe(false);

      expect(schema.properties).not.toHaveProperty("pageId");
    });
  });

  describe("cards action verbs", () => {
    it("exposes INSUFFICIENT_CARDS in ERROR_CODES", () => {
      expect(ERROR_CODES.INSUFFICIENT_CARDS).toBe("INSUFFICIENT_CARDS");
    });

    it("pins the `how` enum as STRINGS covering Foundry's three numeric draw modes", () => {
      expect(CARDS_DRAW_MODES).toEqual(["top", "bottom", "random"]);
      for (const how of CARDS_DRAW_MODES) {
        expect(validate("cards.deal", { cardsId: "c1", to: ["c2"], how, idempotencyKey: "k" }).ok).toBe(true);
        expect(validate("cards.draw", { cardsId: "c1", from: "c2", how, idempotencyKey: "k" }).ok).toBe(true);
      }

      for (const how of ["first", "last", 0, 1, 2, null]) {
        expect(validate("cards.deal", { cardsId: "c1", to: ["c2"], how, idempotencyKey: "k" }).ok).toBe(
          false
        );
      }

      expect(COMMAND_DEFINITIONS["cards.pass"].paramsSchema.properties).not.toHaveProperty("how");
      expect(COMMAND_DEFINITIONS["cards.shuffle"].paramsSchema.properties).not.toHaveProperty("how");
      expect(COMMAND_DEFINITIONS["cards.reset"].paramsSchema.properties).not.toHaveProperty("how");
    });

    it("pins `count` as a POSITIVE integer on BOTH deal and draw", () => {
      for (const command of ["cards.deal", "cards.draw"]) {
        const target = command === "cards.deal" ? { to: ["c2"] } : { from: "c2" };
        const base = { cardsId: "c1", ...target, idempotencyKey: "k" };
        expect(validate(command, { ...base, count: 1 }).ok).toBe(true);
        for (const count of [0, -1, -0, 1.5, "2", null]) {
          expect(validate(command, { ...base, count }).ok, `${command} count=${String(count)}`).toBe(false);
        }

        expect(COMMAND_DEFINITIONS[command].paramsSchema.properties.count.maximum).toBeUndefined();
      }

      expect(COMMAND_DEFINITIONS["cards.pass"].paramsSchema.properties).not.toHaveProperty("count");
    });

    it("pins the source/destination wire params per verb", () => {
      expect(COMMAND_DEFINITIONS["cards.deal"].paramsSchema.required).toEqual([
        "cardsId",
        "to",
        "idempotencyKey"
      ]);
      expect(COMMAND_DEFINITIONS["cards.draw"].paramsSchema.required).toEqual([
        "cardsId",
        "from",
        "idempotencyKey"
      ]);
      expect(COMMAND_DEFINITIONS["cards.pass"].paramsSchema.required).toEqual([
        "cardsId",
        "to",
        "cardIds",
        "idempotencyKey"
      ]);

      expect(COMMAND_DEFINITIONS["cards.deal"].paramsSchema.properties.to.type).toBe("array");
      expect(COMMAND_DEFINITIONS["cards.pass"].paramsSchema.properties.to.type).toBe("string");
      expect(COMMAND_DEFINITIONS["cards.draw"].paramsSchema.properties.from.type).toBe("string");
      expect(COMMAND_DEFINITIONS["cards.draw"].paramsSchema.properties).not.toHaveProperty("to");
      expect(COMMAND_DEFINITIONS["cards.deal"].paramsSchema.properties).not.toHaveProperty("from");
    });

    it("rejects an EMPTY --to / --card-ids list (Foundry accepts one and posts a chat card about nothing)", () => {
      expect(validate("cards.deal", { cardsId: "c1", to: [], idempotencyKey: "k" }).ok).toBe(false);
      expect(validate("cards.pass", { cardsId: "c1", to: "c2", cardIds: [], idempotencyKey: "k" }).ok).toBe(
        false
      );
      expect(validate("cards.pass", { cardsId: "c1", to: "c2", cardIds: [""], idempotencyKey: "k" }).ok).toBe(
        false
      );
    });

    it("documents the handler-enforced cards.pass cardIds bound", () => {
      const cardIdsSchema = COMMAND_DEFINITIONS["cards.pass"].paramsSchema.properties.cardIds;
      expect(CARDS_PASS_MAX_IDS).toBe(100);
      expect(cardIdsSchema.maxItems).toBe(CARDS_PASS_MAX_IDS);

      expect(
        validate("cards.pass", {
          cardsId: "c1",
          to: "c2",
          cardIds: Array.from({ length: CARDS_PASS_MAX_IDS + 1 }, (_, index) => `card-${index}`),
          idempotencyKey: "k"
        }).ok
      ).toBe(true);
    });

    it("gives every action verb a `chat` opt-out and NO roll mode", () => {
      for (const command of ["cards.shuffle", "cards.reset", "cards.deal", "cards.draw", "cards.pass"]) {
        expect(COMMAND_DEFINITIONS[command].paramsSchema.properties.chat).toEqual({ type: "boolean" });

        expect(COMMAND_DEFINITIONS[command].paramsSchema.properties).not.toHaveProperty("rollMode");
      }

      expect(COMMAND_DEFINITIONS["table.draw"].paramsSchema.properties).toHaveProperty("rollMode");
    });

    it("pins the THREE action markers as disjoint, non-drifting enums", () => {
      expect(CARDS_ACTION_CHAT_STATUSES).toEqual([
        "dispatched",
        "not-requested",
        "not-dispatched",
        "unknown"
      ]);

      expect(CARDS_DELETE_CHAT_STATUSES).not.toContain("not-dispatched");

      expect(CARDS_ACTION_CHAT_STATUSES).toContain("unknown");

      expect(CARDS_ACTION_MUTATION_OUTCOMES).toEqual(["committed", "partial", "unknown", "not-executed"]);

      expect(TABLE_MUTATION_OUTCOMES).not.toContain("partial");

      expect(CARDS_ACTION_RECONCILIATIONS).toEqual(["confirmed", "best-effort", "not-executed"]);

      expect(
        CARDS_ACTION_RECONCILIATIONS.filter((value) => CARDS_ACTION_MUTATION_OUTCOMES.includes(value))
      ).toEqual(["not-executed"]);
    });
  });

  describe("combat world family", () => {
    it("exposes COMBAT_NOT_FOUND and COMBAT_SCENE_MISMATCH in ERROR_CODES", () => {
      expect(ERROR_CODES.COMBAT_NOT_FOUND).toBe("COMBAT_NOT_FOUND");
      expect(ERROR_CODES.COMBAT_SCENE_MISMATCH).toBe("COMBAT_SCENE_MISMATCH");
    });

    it("declares exactly the five CRUD verbs with the right mutation flags", () => {
      for (const command of ["combat.list", "combat.get"]) {
        expect(COMMAND_DEFINITIONS[command].mutation).toBe(false);
      }
      for (const command of ["combat.create", "combat.update", "combat.delete"]) {
        expect(COMMAND_DEFINITIONS[command].mutation).toBe(true);
      }

      for (const command of ["combat.clone", "combat.get-many", "combat.ownership.set"]) {
        expect(COMMAND_NAMES).not.toContain(command);
      }
    });

    it("accepts an EMPTY create payload (every Combat field has a Foundry initial)", () => {
      expect(validate("combat.create", { data: {} })).toEqual({ ok: true, errors: [] });
      expect(COMMAND_DEFINITIONS["combat.create"].paramsSchema.properties.data.required).toEqual([]);

      expect(validate("combat.create", {}).ok).toBe(false);
    });

    it("keeps round/turn, active and the embedded collections off combat.create", () => {
      const createProps = Object.keys(
        COMMAND_DEFINITIONS["combat.create"].paramsSchema.properties.data.properties
      ).sort();

      for (const field of ["active", "round", "turn", "combatants", "groups"]) {
        expect(createProps).not.toContain(field);
        expect(validate("combat.create", { data: { [field]: 1 } }).ok).toBe(false);
      }
    });

    it("keeps `type` off the combat patch and requires a non-empty one", () => {
      const patchSchema = /** @type {any} */ (
        COMMAND_DEFINITIONS["combat.update"].paramsSchema.properties.patch
      );

      expect(patchSchema.properties.type).toBeUndefined();
      expect(patchSchema.required).toEqual([]);
      expect(patchSchema.minProperties).toBe(1);
      expect(validate("combat.update", { combatId: "c-1", patch: {} }).ok).toBe(false);
      expect(validate("combat.update", { combatId: "c-1", patch: { type: "base" } }).ok).toBe(false);
    });

    it("types `scene` as a nullable, NON-blankable id and `type` as a bare string (never an enum)", () => {
      const sceneSchema = { type: ["string", "null"], minLength: 1 };
      expect(COMMAND_DEFINITIONS["combat.create"].paramsSchema.properties.data.properties.scene).toEqual(
        sceneSchema
      );
      expect(COMMAND_DEFINITIONS["combat.update"].paramsSchema.properties.patch.properties.scene).toEqual(
        sceneSchema
      );
      expect(validate("combat.update", { combatId: "c-1", patch: { scene: null } }).ok).toBe(true);
      expect(validate("combat.update", { combatId: "c-1", patch: { scene: "" } }).ok).toBe(false);

      const typeSchema = COMMAND_DEFINITIONS["combat.create"].paramsSchema.properties.data.properties.type;
      expect(typeSchema).toEqual({ type: "string", minLength: 1 });
      expect(typeSchema.enum).toBeUndefined();
      expect(validate("combat.create", { data: { type: "dnd5e-subtype" } }).ok).toBe(true);
    });

    it("accepts the v14-only `name` at the PROTOCOL layer (the version gate is the module's)", () => {
      expect(validate("combat.create", { data: { name: "Boss fight" } }).ok).toBe(true);
      expect(validate("combat.create", { data: { name: "" } }).ok).toBe(true);
      expect(COMMAND_DEFINITIONS["combat.create"].paramsSchema.properties.data.properties.name).toEqual({
        type: "string"
      });
    });

    it("rejects `folder`, which Combat does not have", () => {
      expectRejected("combat.create", { data: { folder: "spoof" } }, "$.params.data.folder is not allowed");
      expectRejected(
        "combat.update",
        { combatId: "c-1", patch: { folder: "spoof" } },
        "$.params.patch.folder is not allowed"
      );
    });

    it("keeps combat.list pagination-only (no `name` filter — v13 Combat has no name field)", () => {
      expect(validate("combat.list", {}).ok).toBe(true);
      expect(validate("combat.list", { limit: 5, offset: 2 }).ok).toBe(true);
      expect(validate("combat.list", { name: "boss" }).ok).toBe(false);
    });

    it("keeps combat.get read-only (no dryRun leak) and combat.delete dry-runnable", () => {
      expect(
        /** @type {any} */ (COMMAND_DEFINITIONS["combat.get"].paramsSchema.properties).dryRun
      ).toBeUndefined();
      expect(validate("combat.get", { combatId: "c-1", dryRun: true }).ok).toBe(false);
      expect(validate("combat.delete", { combatId: "c-1", dryRun: true }).ok).toBe(true);

      expect(
        /** @type {any} */ (COMMAND_DEFINITIONS["combat.update"].paramsSchema.properties).idempotencyKey
      ).toBeUndefined();
      expect(
        /** @type {any} */ (COMMAND_DEFINITIONS["combat.delete"].paramsSchema.properties).idempotencyKey
      ).toBeUndefined();
    });
  });

  describe("combat embedded families: combatant + group", () => {
    it("exposes COMBATANT_NOT_FOUND and COMBATANT_GROUP_NOT_FOUND in ERROR_CODES", () => {
      expect(ERROR_CODES.COMBATANT_NOT_FOUND).toBe("COMBATANT_NOT_FOUND");
      expect(ERROR_CODES.COMBATANT_GROUP_NOT_FOUND).toBe("COMBATANT_GROUP_NOT_FOUND");
    });

    it("declares five verbs per family with the right mutation flags and no clone/get-many", () => {
      for (const command of [
        "combat.combatant.list",
        "combat.combatant.get",
        "combat.group.list",
        "combat.group.get"
      ]) {
        expect(COMMAND_DEFINITIONS[command].mutation).toBe(false);
      }
      for (const command of [
        "combat.combatant.create",
        "combat.combatant.update",
        "combat.combatant.delete",
        "combat.group.create",
        "combat.group.update",
        "combat.group.delete"
      ]) {
        expect(COMMAND_DEFINITIONS[command].mutation).toBe(true);
      }

      for (const command of [
        "combat.combatant.clone",
        "combat.combatant.get-many",
        "combat.group.clone",
        "combat.group.get-many",
        "combat.group.ownership.set"
      ]) {
        expect(COMMAND_DEFINITIONS[command]).toBeUndefined();
        expect(COMMAND_NAMES).not.toContain(command);
      }
    });

    it("requires nothing on a combatant create but still requires the payload", () => {
      const data = /** @type {any} */ (
        COMMAND_DEFINITIONS["combat.combatant.create"].paramsSchema.properties.data
      );

      expect(data.required).toEqual([]);
      expect(validate("combat.combatant.create", { combatId: "c-1", data: {} }).ok).toBe(true);

      expect(validate("combat.combatant.create", { combatId: "c-1" }).ok).toBe(false);
    });

    it("keeps `initiative` a combatant CREATE field, never a patch field", () => {
      const patch = /** @type {any} */ (
        COMMAND_DEFINITIONS["combat.combatant.update"].paramsSchema.properties.patch
      );

      expect(patch.minProperties).toBe(1);

      expect(
        validate("combat.combatant.update", {
          combatId: "c-1",
          combatantId: "cmb-1",
          patch: { initiative: 5 }
        }).ok
      ).toBe(false);
      expect(validate("combat.combatant.create", { combatId: "c-1", data: { initiative: 5 } }).ok).toBe(true);
      expect(validate("combat.combatant.create", { combatId: "c-1", data: { initiative: null } }).ok).toBe(
        true
      );

      expect(
        validate("combat.combatant.update", {
          combatId: "c-1",
          combatantId: "cmb-1",
          patch: { type: "base" }
        }).ok
      ).toBe(false);

      expect(
        validate("combat.combatant.update", { combatId: "c-1", combatantId: "cmb-1", patch: {} }).ok
      ).toBe(false);
    });

    it("types the three id links + `group` as nullable BARE ids with minLength 1", () => {
      const idField = { type: ["string", "null"], minLength: 1 };
      const create = /** @type {any} */ (
        COMMAND_DEFINITIONS["combat.combatant.create"].paramsSchema.properties.data
      );
      const patch = /** @type {any} */ (
        COMMAND_DEFINITIONS["combat.combatant.update"].paramsSchema.properties.patch
      );
      for (const field of ["actorId", "tokenId", "sceneId", "group"]) {
        expect(create.properties[field], field).toEqual(idField);
        expect(patch.properties[field], field).toEqual(idField);

        expect(
          validate("combat.combatant.create", { combatId: "c-1", data: { [field]: null } }).ok,
          field
        ).toBe(true);
        expect(
          validate("combat.combatant.create", { combatId: "c-1", data: { [field]: "" } }).ok,
          field
        ).toBe(false);
      }

      expect(
        validate("combat.combatant.create", { combatId: "c-1", data: { tokenId: "Token.abc" } }).ok
      ).toBe(true);
    });

    it("pins `img` minLength:1 and `name` WITHOUT one, on both families", () => {
      const imgField = { type: ["string", "null"], minLength: 1 };
      const cases = /** @type {{command: string, key: string, extra: Record<string, any>}[]} */ ([
        { command: "combat.combatant.create", key: "data", extra: { combatId: "c-1" } },
        {
          command: "combat.combatant.update",
          key: "patch",
          extra: { combatId: "c-1", combatantId: "cmb-1" }
        },
        { command: "combat.group.create", key: "data", extra: { combatId: "c-1" } },
        { command: "combat.group.update", key: "patch", extra: { combatId: "c-1", groupId: "grp-1" } }
      ]);
      for (const { command, key, extra } of cases) {
        const schema = /** @type {any} */ (COMMAND_DEFINITIONS[command].paramsSchema.properties[key]);

        expect(schema.properties.img, command).toEqual(imgField);
        expect(validate(command, { ...extra, [key]: { img: "" } }).ok, command).toBe(false);
        expect(validate(command, { ...extra, [key]: { img: null } }).ok, command).toBe(true);

        expect(schema.properties.name, command).toEqual({ type: "string" });
        expect(validate(command, { ...extra, [key]: { name: "" } }).ok, command).toBe(true);
      }
    });

    it("pins `roundJoined` as an integer >= 1 on the combatant only (v14-only, module-gated)", () => {
      const create = /** @type {any} */ (
        COMMAND_DEFINITIONS["combat.combatant.create"].paramsSchema.properties.data
      );
      const patch = /** @type {any} */ (
        COMMAND_DEFINITIONS["combat.combatant.update"].paramsSchema.properties.patch
      );

      for (const schema of [create, patch]) {
        expect(schema.properties.roundJoined).toEqual({ type: "integer", minimum: 1 });
      }
      expect(validate("combat.combatant.create", { combatId: "c-1", data: { roundJoined: 1 } }).ok).toBe(
        true
      );
      expect(validate("combat.combatant.create", { combatId: "c-1", data: { roundJoined: 0 } }).ok).toBe(
        false
      );
      expect(validate("combat.combatant.create", { combatId: "c-1", data: { roundJoined: 2.5 } }).ok).toBe(
        false
      );
      expect(validate("combat.combatant.create", { combatId: "c-1", data: { roundJoined: null } }).ok).toBe(
        false
      );

      const group = /** @type {any} */ (
        COMMAND_DEFINITIONS["combat.group.create"].paramsSchema.properties.data
      );
      expect(group.properties.roundJoined).toBeUndefined();
      expect(validate("combat.group.create", { combatId: "c-1", data: { roundJoined: 2 } }).ok).toBe(false);
    });

    it("keeps `initiative` on the group PATCH, unlike the combatant patch", () => {
      const create = /** @type {any} */ (
        COMMAND_DEFINITIONS["combat.group.create"].paramsSchema.properties.data
      );
      const patch = /** @type {any} */ (
        COMMAND_DEFINITIONS["combat.group.update"].paramsSchema.properties.patch
      );
      expect(patch.properties.initiative).toBeDefined();
      expect(patch.minProperties).toBe(1);
      expect(create.required).toEqual([]);

      expect(
        validate("combat.group.update", { combatId: "c-1", groupId: "grp-1", patch: { initiative: 12 } }).ok
      ).toBe(true);
      expect(
        validate("combat.group.update", { combatId: "c-1", groupId: "grp-1", patch: { initiative: null } }).ok
      ).toBe(true);

      expect(
        validate("combat.group.create", { combatId: "c-1", data: { ownership: { default: 2 } } }).ok
      ).toBe(false);
      expect(
        validate("combat.group.update", {
          combatId: "c-1",
          groupId: "grp-1",
          patch: { ownership: { default: 2 } }
        }).ok
      ).toBe(false);
    });

    it("keeps both lists pagination-only and both reads dryRun-free", () => {
      for (const command of ["combat.combatant.list", "combat.group.list"]) {
        const schema = /** @type {any} */ (COMMAND_DEFINITIONS[command].paramsSchema);
        expect(schema.required).toEqual(["combatId"]);
        expect(Object.keys(schema.properties).sort()).toEqual(["combatId", "limit", "offset"]);

        expect(validate(command, { combatId: "c-1", name: "goblin" }).ok).toBe(false);
        expect(validate(command, { combatId: "c-1", limit: 5, offset: 2 }).ok).toBe(true);
      }
      const reads = /** @type {{command: string, params: Record<string, any>}[]} */ ([
        { command: "combat.combatant.get", params: { combatId: "c-1", combatantId: "cmb-1" } },
        { command: "combat.group.get", params: { combatId: "c-1", groupId: "grp-1" } }
      ]);
      for (const { command, params } of reads) {
        expect(
          /** @type {any} */ (COMMAND_DEFINITIONS[command].paramsSchema.properties).dryRun
        ).toBeUndefined();
        expect(validate(command, { ...params, dryRun: true }).ok).toBe(false);
      }
    });
  });

  describe("combat action verbs", () => {
    const KEY = { idempotencyKey: "k" };
    const ADVANCE = [
      "combat.next-turn",
      "combat.previous-turn",
      "combat.next-round",
      "combat.previous-round"
    ];

    it("declares exactly the nine action verbs, all mutations, and NO combat.end", () => {
      for (const command of [
        "combat.start",
        "combat.activate",
        ...ADVANCE,
        "combat.reset-initiative",
        "combat.roll-initiative",
        "combat.set-initiative"
      ]) {
        expect(COMMAND_DEFINITIONS[command], command).toBeDefined();
        expect(COMMAND_DEFINITIONS[command].mutation, command).toBe(true);
      }

      expect(COMMAND_NAMES.filter((command) => command.startsWith("combat.")).sort()).toEqual(
        [
          "combat.activate",
          "combat.combatant.create",
          "combat.combatant.delete",
          "combat.combatant.get",
          "combat.combatant.list",
          "combat.combatant.update",
          "combat.create",
          "combat.delete",
          "combat.get",
          "combat.group.create",
          "combat.group.delete",
          "combat.group.get",
          "combat.group.list",
          "combat.group.update",
          "combat.list",
          "combat.next-round",
          "combat.next-turn",
          "combat.previous-round",
          "combat.previous-turn",
          "combat.reset-initiative",
          "combat.roll-initiative",
          "combat.set-initiative",
          "combat.start",
          "combat.update"
        ].sort()
      );
    });

    it("pins the five new protocol enums (the module may not invent a further value)", () => {
      expect(COMBAT_TRANSITIONS).toEqual(["none", "turn", "round"]);
      expect(COMBAT_MUTATION_OUTCOMES).toEqual(["committed", "unknown", "not-executed"]);

      expect(COMBAT_ROLL_MODES).toEqual(["public", "gm", "blind", "self"]);
      expect(COMBAT_INITIATIVE_SELECTIONS).toEqual(["all", "npc"]);

      expect(COMBAT_INITIATIVE_MODES).toEqual(["ids", "all", "npc"]);
      expect(validate("combat.roll-initiative", { combatId: "c", select: "ids", ...KEY }).ok).toBe(false);

      for (const mode of ["roll", "ic", "publicroll", "gmroll"]) {
        expect(
          validate("combat.roll-initiative", { combatId: "c", select: "all", rollMode: mode, ...KEY }).ok,
          mode
        ).toBe(false);
      }
    });

    it("requires idempotencyKey on the four advancement verbs and on roll-initiative", () => {
      for (const command of [...ADVANCE, "combat.roll-initiative"]) {
        expect(COMMAND_DEFINITIONS[command].paramsSchema.required, command).toContain("idempotencyKey");
      }
      for (const command of [
        "combat.start",
        "combat.activate",
        "combat.reset-initiative",
        "combat.set-initiative"
      ]) {
        expect(COMMAND_DEFINITIONS[command].paramsSchema.required, command).not.toContain("idempotencyKey");

        expect(
          /** @type {any} */ (COMMAND_DEFINITIONS[command].paramsSchema.properties).idempotencyKey,
          command
        ).toEqual({ type: "string", minLength: 1 });
      }
      for (const command of ADVANCE) {
        expect(validate(command, { combatId: "c" }).ok, command).toBe(false);
        expect(validate(command, { combatId: "c", ...KEY }).ok, command).toBe(true);
      }
    });

    it("accepts a NULL expectedTurn through the real validator (the --expected-turn-none path)", () => {
      for (const command of ADVANCE) {
        expect(validate(command, { combatId: "c", expectedTurn: null, ...KEY }).ok, command).toBe(true);
        expect(validate(command, { combatId: "c", expectedTurn: 0, ...KEY }).ok, command).toBe(true);
        expect(validate(command, { combatId: "c", expectedRound: 0, ...KEY }).ok, command).toBe(true);

        expect(validate(command, { combatId: "c", expectedRound: -1, ...KEY }).ok, command).toBe(false);
        expect(validate(command, { combatId: "c", expectedTurn: -1, ...KEY }).ok, command).toBe(false);
        expect(validate(command, { combatId: "c", expectedRound: 1.5, ...KEY }).ok, command).toBe(false);

        expect(validate(command, { combatId: "c", expectedRound: null, ...KEY }).ok, command).toBe(false);
        expect(validate(command, { combatId: "c", extra: 1, ...KEY }).ok, command).toBe(false);
      }
    });

    it("pins the roll-initiative selector shape and rejects unknown keys", () => {
      expect(validate("combat.roll-initiative", { combatId: "c", combatantIds: ["a"], ...KEY }).ok).toBe(
        true
      );
      expect(validate("combat.roll-initiative", { combatId: "c", select: "npc", ...KEY }).ok).toBe(true);

      expect(validate("combat.roll-initiative", { combatId: "c", ...KEY }).ok).toBe(true);
      expect(
        validate("combat.roll-initiative", { combatId: "c", combatantIds: ["a"], select: "all", ...KEY }).ok
      ).toBe(true);

      expect(validate("combat.roll-initiative", { combatId: "c", combatantIds: [], ...KEY }).ok).toBe(false);
      expect(validate("combat.roll-initiative", { combatId: "c", select: "everyone", ...KEY }).ok).toBe(
        false
      );
      expect(
        validate("combat.roll-initiative", { combatId: "c", select: "all", formula: "", ...KEY }).ok
      ).toBe(false);
      expect(
        validate("combat.roll-initiative", { combatId: "c", select: "all", chat: false, ...KEY }).ok
      ).toBe(false);
      expect(validate("combat.roll-initiative", { combatId: "c", select: "all", extra: 1, ...KEY }).ok).toBe(
        false
      );
    });

    it("pins set-initiative's REQUIRED nullable initiative", () => {
      expect(COMMAND_DEFINITIONS["combat.set-initiative"].paramsSchema.required).toEqual([
        "combatId",
        "combatantId",
        "initiative"
      ]);
      expect(validate("combat.set-initiative", { combatId: "c", combatantId: "m", initiative: 0 }).ok).toBe(
        true
      );
      expect(
        validate("combat.set-initiative", { combatId: "c", combatantId: "m", initiative: -3.5 }).ok
      ).toBe(true);

      expect(
        validate("combat.set-initiative", { combatId: "c", combatantId: "m", initiative: null }).ok
      ).toBe(true);

      expect(validate("combat.set-initiative", { combatId: "c", combatantId: "m" }).ok).toBe(false);
      expect(validate("combat.set-initiative", { combatId: "c", combatantId: "m", initiative: "5" }).ok).toBe(
        false
      );
    });

    it("exposes COMBAT_NOT_STARTED and keeps PRECONDITION_FAILED distinct from it", () => {
      expect(ERROR_CODES.COMBAT_NOT_STARTED).toBe("COMBAT_NOT_STARTED");
      expect(ERROR_CODES.PRECONDITION_FAILED).toBe("PRECONDITION_FAILED");
      expect(ERROR_CODES.COMBAT_SCENE_MISMATCH).toBe("COMBAT_SCENE_MISMATCH");

      expect(ERROR_CODES.COMBAT_STATE_DIVERGED).toBe("COMBAT_STATE_DIVERGED");
      expect(new Set(Object.values(ERROR_CODES)).size).toBe(Object.keys(ERROR_CODES).length);
    });

    it("declares dryRun on all nine and accepts it alongside the required key", () => {
      for (const command of [
        "combat.start",
        "combat.activate",
        ...ADVANCE,
        "combat.reset-initiative",
        "combat.roll-initiative",
        "combat.set-initiative"
      ]) {
        expect(
          /** @type {any} */ (COMMAND_DEFINITIONS[command].paramsSchema.properties).dryRun,
          command
        ).toEqual({ type: "boolean" });
      }

      expect(validate("combat.next-turn", { combatId: "c", dryRun: true }).ok).toBe(false);
      expect(validate("combat.next-turn", { combatId: "c", dryRun: true, ...KEY }).ok).toBe(true);
    });
  });

  describe("chat command family", () => {
    it("exposes CHAT_MESSAGE_NOT_FOUND in ERROR_CODES", () => {
      expect(ERROR_CODES.CHAT_MESSAGE_NOT_FOUND).toBe("CHAT_MESSAGE_NOT_FOUND");
    });

    it("accepts a minimal content-only create", () => {
      expect(validate("chat.create", { data: { content: "hello" } })).toEqual({ ok: true, errors: [] });
    });

    it("accepts a full create with whisper/blind/style/flavor/sound/speaker + roll + idempotencyKey", () => {
      expect(
        validate("chat.create", {
          data: {
            content: "attack!",
            whisper: ["u1", "u2"],
            blind: true,
            style: 0,
            flavor: "flavor",
            sound: "a.ogg",
            speaker: { alias: "GM" }
          },
          roll: { formula: "2d6+3" },
          idempotencyKey: "k"
        }).ok
      ).toBe(true);
    });

    it("tightened style enum rejects out-of-enum values and accepts valid ones (CHAT_MESSAGE_STYLES, verified v13)", () => {
      expect(validate("chat.create", { data: { content: "x", style: 9 } }).ok).toBe(false);
      expect(validate("chat.create", { data: { content: "x", style: 2 } }).ok).toBe(true);
    });

    it("accepts a roll-only create at the PROTOCOL layer (content-or-roll is a handler check)", () => {
      expect(validate("chat.create", { data: {}, roll: { formula: "1d20" } }).ok).toBe(true);
    });

    it("REJECTS data.system and data.type (scope-enforcement proof)", () => {
      const systemResult = validate("chat.create", { data: { content: "x", system: {} } });
      expect(systemResult.ok).toBe(false);
      expect(systemResult.errors).toContainEqual(
        expect.stringContaining("$.params.data.system is not allowed")
      );

      const typeResult = validate("chat.create", { data: { content: "x", type: "base" } });
      expect(typeResult.ok).toBe(false);
      expect(typeResult.errors).toContainEqual(expect.stringContaining("$.params.data.type is not allowed"));
    });

    it("rejects roll INSIDE data (roll is a sibling, not a document field)", () => {
      const result = validate("chat.create", { data: { content: "x", roll: { formula: "1d4" } } });
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining("$.params.data.roll is not allowed"));
    });

    it("rejects an unknown field on the roll sibling (roll is closed)", () => {
      expect(validate("chat.create", { data: { content: "x" }, roll: { formula: "1d4", bogus: 1 } }).ok).toBe(
        false
      );
    });

    it("requires roll.formula when roll is supplied", () => {
      expect(validate("chat.create", { data: { content: "x" }, roll: {} }).ok).toBe(false);
    });

    it("chat.list carries pagination but NOT a name filter", () => {
      const props = /** @type {any} */ (COMMAND_DEFINITIONS["chat.list"].paramsSchema.properties);
      expect(props.limit).toBeDefined();
      expect(props.offset).toBeDefined();
      expect(props.name).toBeUndefined();
    });

    it("chat.create carries dryRun + idempotencyKey; chat.delete carries dryRun but NOT idempotencyKey; chat.get carries neither", () => {
      const create = /** @type {any} */ (COMMAND_DEFINITIONS["chat.create"].paramsSchema.properties);
      expect(create.dryRun).toBeDefined();
      expect(create.idempotencyKey).toBeDefined();

      const del = /** @type {any} */ (COMMAND_DEFINITIONS["chat.delete"].paramsSchema.properties);
      expect(del.dryRun).toBeDefined();
      expect(del.idempotencyKey).toBeUndefined();

      const get = /** @type {any} */ (COMMAND_DEFINITIONS["chat.get"].paramsSchema.properties);
      expect(get.dryRun).toBeUndefined();
      expect(get.idempotencyKey).toBeUndefined();
    });

    it("chat.get / chat.delete require a messageId", () => {
      expect(validate("chat.get", {}).ok).toBe(false);
      expect(validate("chat.get", { messageId: "m-1" }).ok).toBe(true);
      expect(validate("chat.delete", {}).ok).toBe(false);
      expect(validate("chat.delete", { messageId: "m-1", dryRun: true }).ok).toBe(true);
    });
  });

  describe("embedded-item create data schema (flags + nested effects)", () => {
    for (const command of ["actor.item.create", "scene.token.item.create"]) {
      const parentIds =
        command === "actor.item.create" ? { actorId: "actor-1" } : { sceneId: "scene-1", tokenId: "token-1" };

      it(`accepts flags and an effects array on ${command}`, () => {
        expectValid(command, {
          ...parentIds,
          data: {
            name: "Longsword",
            type: "weapon",
            flags: { ddbimporter: { id: 1 }, "midi-qol": { onUseMacroName: "x" } },
            effects: [
              { name: "Bless", transfer: true, origin: "Item.abc", changes: [{ key: "a", value: "1" }] }
            ]
          }
        });
      });

      it(`rejects an unknown top-level create field on ${command} (schema stays closed)`, () => {
        const result = validate(command, {
          ...parentIds,
          data: { name: "X", type: "loot", bogusField: true }
        });
        expect(result.ok).toBe(false);
        expect(result.errors).toContainEqual(
          expect.stringContaining("$.params.data.bogusField is not allowed")
        );
      });
    }
  });

  describe("open-passthrough ActiveEffect schemas", () => {
    it("passes nested effect config (type/system/flags/transfer) through the open create schema", () => {
      expectValid("actor.effect.create", {
        actorId: "actor-1",
        data: {
          name: "Aura of Protection",
          type: "auraeffects.aura",
          transfer: true,
          system: { radius: 5 },
          flags: { dae: {} }
        }
      });
    });

    it("still type-checks the well-known effect fields it declares", () => {
      const boolResult = validate("actor.effect.create", {
        actorId: "actor-1",
        data: { name: "Aura", disabled: "yes" }
      });
      expect(boolResult.ok).toBe(false);
      expect(boolResult.errors).toContain("$.params.data.disabled must be boolean");

      const arrayResult = validate("actor.effect.create", {
        actorId: "actor-1",
        data: { name: "Aura", changes: "x" }
      });
      expect(arrayResult.ok).toBe(false);
      expect(arrayResult.errors).toContain("$.params.data.changes must be array");
    });
  });

  describe("scene.wall.* + scene.note.* embedded families", () => {
    const WALL_COMMANDS = [
      "scene.wall.list",
      "scene.wall.get",
      "scene.wall.create",
      "scene.wall.update",
      "scene.wall.delete",
      "scene.wall.clone"
    ];
    const NOTE_COMMANDS = [
      "scene.note.list",
      "scene.note.get",
      "scene.note.create",
      "scene.note.update",
      "scene.note.delete",
      "scene.note.clone"
    ];

    it("defines both full command sets", () => {
      for (const command of [...WALL_COMMANDS, ...NOTE_COMMANDS]) {
        expect(COMMAND_DEFINITIONS[command], `${command} must be defined`).toBeDefined();
      }
    });

    it("exposes WALL_NOT_FOUND / NOTE_NOT_FOUND in ERROR_CODES", () => {
      expect(ERROR_CODES.WALL_NOT_FOUND).toBe("WALL_NOT_FOUND");
      expect(ERROR_CODES.NOTE_NOT_FOUND).toBe("NOTE_NOT_FOUND");
    });

    it("keeps the create `data` schemas open (additionalProperties:true, minProperties:1)", () => {
      for (const command of ["scene.wall.create", "scene.note.create"]) {
        const dataSchema = COMMAND_DEFINITIONS[command].paramsSchema.properties.data;
        expect(dataSchema.additionalProperties, `${command} data must stay open`).toBe(true);
        expect(dataSchema.minProperties, `${command} data must require at least one field`).toBe(1);
      }
    });

    it("keeps the update/clone `patch` schemas open (additionalProperties:true, minProperties:1)", () => {
      for (const command of [
        "scene.wall.update",
        "scene.wall.clone",
        "scene.note.update",
        "scene.note.clone"
      ]) {
        const patchSchema = COMMAND_DEFINITIONS[command].paramsSchema.properties.patch;
        expect(patchSchema.additionalProperties, `${command} patch must stay open`).toBe(true);
        expect(patchSchema.minProperties, `${command} patch must require at least one field`).toBe(1);
      }
    });

    it("passes an unknown extra field through the open wall update patch", () => {
      expectValid("scene.wall.update", {
        sceneId: "scene-1",
        wallId: "wall-1",
        patch: { doorSound: "woodBasic", totallyUnknownWallField: 42 }
      });
    });

    it("passes an unknown extra field through the open note create data", () => {
      expectValid("scene.note.create", {
        sceneId: "scene-1",
        data: { text: "Trapdoor", entryId: "j-1", totallyUnknownNoteField: true }
      });
    });

    it("rejects an empty wall patch (minProperties:1)", () => {
      const result = validate("scene.wall.update", { sceneId: "scene-1", wallId: "wall-1", patch: {} });
      expect(result.ok).toBe(false);
    });

    it("rejects an empty note patch (minProperties:1)", () => {
      const result = validate("scene.note.update", { sceneId: "scene-1", noteId: "note-1", patch: {} });
      expect(result.ok).toBe(false);
    });

    it("accepts a boolean door filter on scene.wall.list and has NO name filter", () => {
      expectValid("scene.wall.list", { sceneId: "scene-1", door: true });
      expectValid("scene.wall.list", { sceneId: "scene-1", door: false });
      const wallProps = /** @type {Record<string, unknown>} */ (
        COMMAND_DEFINITIONS["scene.wall.list"].paramsSchema.properties
      );
      expect(wallProps.door).toEqual({ type: "boolean" });
      expect(wallProps.name).toBeUndefined();
    });

    it("rejects a non-boolean door filter on scene.wall.list", () => {
      const result = validate("scene.wall.list", { sceneId: "scene-1", door: "yes" });
      expect(result.ok).toBe(false);
      expect(result.errors).toContain("$.params.door must be boolean");
    });

    it("has no door filter on scene.note.list (mirror of tile/sound: no list filter)", () => {
      const noteProps = /** @type {Record<string, unknown>} */ (
        COMMAND_DEFINITIONS["scene.note.list"].paramsSchema.properties
      );
      expect(noteProps.door).toBeUndefined();
      expect(noteProps.name).toBeUndefined();
    });

    it("requires sceneId + wallId / noteId on the *.get reads", () => {
      expect(COMMAND_DEFINITIONS["scene.wall.get"].paramsSchema.required).toEqual(["sceneId", "wallId"]);
      expect(COMMAND_DEFINITIONS["scene.note.get"].paramsSchema.required).toEqual(["sceneId", "noteId"]);
      const missingWallId = validate("scene.wall.get", { sceneId: "scene-1" });
      expect(missingWallId.ok).toBe(false);
    });
  });

  describe("bulk writes: the shared batch envelope", () => {
    const ARRAY_FIELD = Object.freeze({
      "create-many": "data",
      "update-many": "patches",
      "delete-many": "ids"
    });
    const batchVerbs = (family) => Object.keys(ARRAY_FIELD).map((suffix) => `${family}.${suffix}`);

    it("pins BOTH batched-family SETS by name so the derived pins below cannot shrink", () => {
      expect(BATCHED_FAMILIES).toEqual([
        "actor.effect",
        "actor.item.effect",
        "item.effect",
        "scene.drawing",
        "scene.light",
        "scene.note",
        "scene.region",
        "scene.sound",
        "scene.template",
        "scene.tile",
        "scene.token",
        "scene.token.effect",
        "scene.token.item.effect",
        "scene.wall"
      ]);
      expect(BATCH_UPDATE_DELETE_FAMILIES).toEqual(["actor", "item", "journal"]);

      expect(BATCHED_FAMILIES.filter((family) => BATCH_UPDATE_DELETE_FAMILIES.includes(family))).toEqual([]);

      expect(Object.keys(BATCH_SCOPE_KEYS).sort()).toEqual(ALL_BATCHED_FAMILIES);
    });

    it("defines exactly its own verb set, all mutations, for EVERY batched family", () => {
      const manyVerbsOf = (family) =>
        Object.keys(ARRAY_FIELD)
          .map((suffix) => `${family}.${suffix}`)
          .filter((command) => COMMAND_NAMES.includes(command))
          .sort();
      for (const family of BATCHED_FAMILIES) {
        expect(
          manyVerbsOf(family),
          `${family} must declare exactly create-many/update-many/delete-many`
        ).toEqual([...batchVerbs(family)].sort());
      }
      for (const family of BATCH_UPDATE_DELETE_FAMILIES) {
        expect(manyVerbsOf(family), `${family} must declare exactly update-many/delete-many`).toEqual([
          `${family}.delete-many`,
          `${family}.update-many`
        ]);
        expect(COMMAND_NAMES, `${family}.create-many must NOT exist`).not.toContain(`${family}.create-many`);
      }
      for (const family of ALL_BATCHED_FAMILIES) {
        for (const command of manyVerbsOf(family)) {
          expect(COMMAND_DEFINITIONS[command].mutation, `${command} must be a mutation`).toBe(true);
        }
      }

      const attributed = new Set(ALL_BATCHED_FAMILIES.flatMap((family) => manyVerbsOf(family)));
      const strays = COMMAND_NAMES.filter(
        (name) => name.endsWith("-many") && COMMAND_DEFINITIONS[name].mutation && !attributed.has(name)
      );
      expect(strays, "a mutating *-many verb exists outside the pinned batched-family sets").toEqual([]);
    });

    it("pins the FULL outcome status enum, including `unknown`, and both subsets", () => {
      expect(BATCH_WRITE_STATUSES).toEqual([
        "created",
        "updated",
        "deleted",
        "unchanged",
        "alreadyDeleted",
        "dropped",
        "unknown"
      ]);

      expect(BATCH_WRITE_SUCCESS_STATUSES).toEqual([
        "created",
        "updated",
        "deleted",
        "unchanged",
        "alreadyDeleted"
      ]);
      expect(BATCH_WRITE_PERSISTED_STATUSES).toEqual(["created", "updated", "deleted"]);
      for (const status of BATCH_WRITE_SUCCESS_STATUSES) {
        expect(BATCH_WRITE_STATUSES).toContain(status);
      }
      for (const status of BATCH_WRITE_PERSISTED_STATUSES) {
        expect(BATCH_WRITE_SUCCESS_STATUSES).toContain(status);
      }
      expect(BATCH_WRITE_SUCCESS_STATUSES).not.toContain("dropped");
      expect(BATCH_WRITE_SUCCESS_STATUSES).not.toContain("unknown");
      expect(BATCH_WRITE_PERSISTED_STATUSES).not.toContain("unchanged");
      expect(BATCH_WRITE_PERSISTED_STATUSES).not.toContain("alreadyDeleted");
    });

    it("caps every envelope array at BATCH_WRITE_MAX_ITEMS, SEPARATELY from BATCH_GET_MAX_IDS", () => {
      expect(BATCH_WRITE_MAX_ITEMS).toBe(100);
      const arrays = Object.fromEntries(
        ALL_BATCHED_FAMILIES.flatMap((family) =>
          Object.entries(ARRAY_FIELD)
            .map(([suffix, field]) => [`${family}.${suffix}`, field])
            .filter(([command]) => COMMAND_NAMES.includes(command))
        )
      );

      expect(Object.keys(arrays)).toHaveLength(
        BATCHED_FAMILIES.length * 3 + BATCH_UPDATE_DELETE_FAMILIES.length * 2
      );
      for (const [command, field] of Object.entries(arrays)) {
        const schema = COMMAND_DEFINITIONS[command].paramsSchema.properties[field];
        expect(schema.type, `${command}.${field} must be an array`).toBe("array");
        expect(schema.minItems, `${command}.${field} must reject an empty array`).toBe(1);
        expect(schema.maxItems, `${command}.${field} must document the write cap`).toBe(
          BATCH_WRITE_MAX_ITEMS
        );
      }

      const readIds = COMMAND_DEFINITIONS["item.get-many"].paramsSchema.properties.ids;
      expect(readIds.maxItems).toBe(BATCH_GET_MAX_IDS);
      const writeCapSources = Object.entries(arrays).map(
        ([command, field]) => COMMAND_DEFINITIONS[command].paramsSchema.properties[field].maxItems
      );
      for (const maxItems of writeCapSources) {
        expect(maxItems).toBe(BATCH_WRITE_MAX_ITEMS);
      }
    });

    it("reuses the SINGLE verb's schemas by REFERENCE, for EVERY batched family", () => {
      for (const family of BATCHED_FAMILIES) {
        expect(
          COMMAND_DEFINITIONS[`${family}.create-many`].paramsSchema.properties.data.items,
          `${family}.create-many must reuse ${family}.create's data schema by reference`
        ).toBe(COMMAND_DEFINITIONS[`${family}.create`].paramsSchema.properties.data);
      }

      const JOURNAL_EXEMPT = "journal";
      const exempt = [];
      for (const family of [...BATCHED_FAMILIES, ...BATCH_UPDATE_DELETE_FAMILIES]) {
        const elementPatch =
          COMMAND_DEFINITIONS[`${family}.update-many`].paramsSchema.properties.patches.items.properties.patch;
        const singlePatch = COMMAND_DEFINITIONS[`${family}.update`].paramsSchema.properties.patch;
        if (elementPatch === singlePatch) continue;
        exempt.push(family);
      }
      expect(exempt, "only `journal` may diverge from its single verb's patch schema").toEqual([
        JOURNAL_EXEMPT
      ]);
      const journalElementPatch =
        COMMAND_DEFINITIONS["journal.update-many"].paramsSchema.properties.patches.items.properties.patch;

      expect(Object.keys(journalElementPatch.properties).sort()).toEqual(["flags", "folder", "name", "sort"]);
      expect(journalElementPatch.additionalProperties).toBe(false);
      expect(journalElementPatch.minProperties).toBe(1);

      expect(
        Object.keys(COMMAND_DEFINITIONS["journal.update"].paramsSchema.properties.patch.properties).sort()
      ).toEqual(["deletePageIds", "flags", "folder", "name", "pages", "sort"]);
      for (const pageOp of ["pages", "deletePageIds"]) {
        expectRejected(
          "journal.update-many",
          {
            patches: [
              { id: "journal-1", patch: { name: "A" } },
              { id: "journal-2", patch: { [pageOp]: [] } }
            ]
          },
          `$.params.patches[1].patch.${pageOp} is not allowed (allowed fields: name, folder, sort, flags)`
        );
      }

      expect(
        COMMAND_DEFINITIONS["scene.token.create-many"].paramsSchema.properties.data.items.properties.actorId
      ).toEqual({ type: "string", minLength: 1 });
      expectValid("scene.token.create-many", {
        sceneId: "scene-1",
        data: [
          { actorId: "actor-1", x: 10, y: 20 },
          { name: "Trap", x: 0, y: 0 }
        ]
      });
    });

    it("gives every built batch verb a REAL element schema (no unvalidated element array)", () => {
      const elementSchemas = [];
      for (const family of BATCHED_FAMILIES) {
        elementSchemas.push([
          `${family}.create-many`,
          COMMAND_DEFINITIONS[`${family}.create-many`].paramsSchema.properties.data.items
        ]);
      }
      for (const family of [...BATCHED_FAMILIES, ...BATCH_UPDATE_DELETE_FAMILIES]) {
        elementSchemas.push([
          `${family}.update-many`,
          COMMAND_DEFINITIONS[`${family}.update-many`].paramsSchema.properties.patches.items.properties.patch
        ]);
      }
      expect(elementSchemas.length, "the batch surface must not be empty").toBeGreaterThan(20);
      for (const [command, schema] of elementSchemas) {
        expect(schema, `${command} has no element schema: its elements would be unvalidated`).toBeTruthy();
        expect(schema.type, `${command}'s element schema must be an object schema`).toBe("object");
        expect(
          Object.keys(schema.properties ?? {}).length,
          `${command}'s element schema declares no fields`
        ).toBeGreaterThan(0);
      }
    });

    it("keeps the update-many element WRAPPER closed with the id OUTSIDE the patch", () => {
      const element = COMMAND_DEFINITIONS["scene.wall.update-many"].paramsSchema.properties.patches.items;
      expect(element.additionalProperties).toBe(false);
      expect(element.required).toEqual(["id", "patch"]);
      expect(Object.keys(element.properties).sort()).toEqual(["id", "patch"]);
      expectValid("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [{ id: "wall-1", patch: { door: 1 } }]
      });
      expectRejected(
        "scene.wall.update-many",
        { sceneId: "scene-1", patches: [{ id: "wall-1", patch: { door: 1 }, extra: true }] },
        "$.params.patches[0].extra is not allowed"
      );
      expectRejected(
        "scene.wall.update-many",
        { sceneId: "scene-1", patches: [{ patch: { door: 1 } }] },
        "$.params.patches[0].id is required"
      );
      expectRejected(
        "scene.wall.update-many",
        { sceneId: "scene-1", patches: [{ id: "wall-1" }] },
        "$.params.patches[0].patch is required"
      );

      expectRejected(
        "scene.wall.update-many",
        { sceneId: "scene-1", patches: [{ id: "wall-1", patch: {} }] },
        "$.params.patches[0].patch must contain at least 1 properties"
      );
    });

    it("validates EVERY element against the family schema, naming the offending index", () => {
      expectRejected(
        "scene.wall.create-many",
        { sceneId: "scene-1", data: [{ c: [0, 0, 1, 1] }, { c: "not-an-array" }] },
        "$.params.data[1].c must be array"
      );
      expectRejected(
        "scene.wall.update-many",
        {
          sceneId: "scene-1",
          patches: [
            { id: "wall-1", patch: { door: 1 } },
            { id: "wall-2", patch: { door: "x" } }
          ]
        },
        "$.params.patches[1].patch.door must be number"
      );
      expectRejected(
        "scene.wall.delete-many",
        { sceneId: "scene-1", ids: ["wall-1", ""] },
        "$.params.ids[1] must be at least 1 characters long"
      );
    });

    it("requires the family's OWN scope ids and its own array, and rejects an empty array", () => {
      for (const family of ALL_BATCHED_FAMILIES) {
        for (const [suffix, field] of Object.entries(ARRAY_FIELD)) {
          const command = `${family}.${suffix}`;
          if (!COMMAND_NAMES.includes(command)) continue;
          expect(COMMAND_DEFINITIONS[command].paramsSchema.required, `${command} required`).toEqual([
            ...BATCH_SCOPE_KEYS[family],
            field
          ]);
        }
      }
      expectRejected(
        "scene.wall.create-many",
        { data: [{ c: [0, 0, 1, 1] }] },
        "$.params.sceneId is required"
      );
      expectRejected(
        "scene.wall.create-many",
        { sceneId: "scene-1", data: [] },
        "$.params.data must contain at least 1 items"
      );
      expectRejected(
        "scene.wall.delete-many",
        { sceneId: "scene-1", ids: [] },
        "$.params.ids must contain at least 1 items"
      );

      expectRejected(
        "scene.token.item.effect.create-many",
        { sceneId: "scene-1", tokenId: "token-1", data: [{ name: "Bless" }] },
        "$.params.itemId is required"
      );
      expectValid("item.update-many", { patches: [{ id: "item-1", patch: { name: "Sword" } }] });
      expectValid("actor.delete-many", { ids: ["actor-1"], force: true });
    });

    it("carries exactly {scope, array, dryRun, idempotencyKey} + its pinned extras", () => {
      for (const family of ALL_BATCHED_FAMILIES) {
        for (const [suffix, field] of Object.entries(ARRAY_FIELD)) {
          const command = `${family}.${suffix}`;
          if (!COMMAND_NAMES.includes(command)) continue;
          expect(Object.keys(COMMAND_DEFINITIONS[command].paramsSchema.properties).sort(), command).toEqual(
            [
              "dryRun",
              "idempotencyKey",
              ...BATCH_SCOPE_KEYS[family],
              field,
              ...(BATCH_EXTRA_PARAMS[command] ?? [])
            ].sort()
          );

          expect(COMMAND_DEFINITIONS[command].paramsSchema.required, command).not.toContain("idempotencyKey");

          for (const extra of BATCH_EXTRA_PARAMS[command] ?? []) {
            expect(COMMAND_DEFINITIONS[command].paramsSchema.required, command).not.toContain(extra);
          }
        }
      }

      expect(COMMAND_DEFINITIONS["actor.delete-many"].paramsSchema.properties.force).toEqual({
        type: "boolean"
      });
      expect(COMMAND_DEFINITIONS["actor.delete"].paramsSchema.properties.force).toEqual({ type: "boolean" });
      const forceCarriers = COMMAND_NAMES.filter(
        (name) =>
          name.endsWith("-many") && COMMAND_DEFINITIONS[name].paramsSchema.properties.force !== undefined
      );
      expect(forceCarriers).toEqual(["actor.delete-many"]);
    });
  });

  describe("scene.drawing.* / scene.light.* / scene.template.* / scene.region.* families", () => {
    const FAMILIES = [
      { family: "drawing", idKey: "drawingId" },
      { family: "light", idKey: "lightId" },
      { family: "template", idKey: "templateId" },
      { family: "region", idKey: "regionId" }
    ];
    const ACTIONS = ["list", "get", "create", "update", "delete", "clone"];

    it("defines all four full command sets", () => {
      for (const { family } of FAMILIES) {
        for (const action of ACTIONS) {
          const command = `scene.${family}.${action}`;
          expect(COMMAND_DEFINITIONS[command], `${command} must be defined`).toBeDefined();
        }
      }
    });

    it("exposes the four *_NOT_FOUND codes in ERROR_CODES", () => {
      expect(ERROR_CODES.DRAWING_NOT_FOUND).toBe("DRAWING_NOT_FOUND");
      expect(ERROR_CODES.LIGHT_NOT_FOUND).toBe("LIGHT_NOT_FOUND");
      expect(ERROR_CODES.TEMPLATE_NOT_FOUND).toBe("TEMPLATE_NOT_FOUND");
      expect(ERROR_CODES.REGION_NOT_FOUND).toBe("REGION_NOT_FOUND");
    });

    it("keeps the create `data` schemas open (additionalProperties:true, minProperties:1)", () => {
      for (const { family } of FAMILIES) {
        const command = `scene.${family}.create`;
        const dataSchema = COMMAND_DEFINITIONS[command].paramsSchema.properties.data;
        expect(dataSchema.additionalProperties, `${command} data must stay open`).toBe(true);
        expect(dataSchema.minProperties, `${command} data must require at least one field`).toBe(1);
      }
    });

    it("keeps the update/clone `patch` schemas open (additionalProperties:true, minProperties:1)", () => {
      for (const { family } of FAMILIES) {
        for (const action of ["update", "clone"]) {
          const command = `scene.${family}.${action}`;
          const patchSchema = COMMAND_DEFINITIONS[command].paramsSchema.properties.patch;
          expect(patchSchema.additionalProperties, `${command} patch must stay open`).toBe(true);
          expect(patchSchema.minProperties, `${command} patch must require at least one field`).toBe(1);
        }
      }
    });

    it("validates a well-known nested config update and an unknown extra field on scene.light.update", () => {
      expectValid("scene.light.update", {
        sceneId: "scene-1",
        lightId: "light-1",
        patch: { config: { dim: 30 }, totallyUnknownLightField: 42 }
      });
    });

    it("passes an unknown extra field through the open drawing create data", () => {
      expectValid("scene.drawing.create", {
        sceneId: "scene-1",
        data: { text: "Label", shape: { type: "r", width: 10, height: 5 }, totallyUnknownDrawingField: true }
      });
    });

    it("rejects an empty patch on each family (minProperties:1)", () => {
      for (const { family, idKey } of FAMILIES) {
        const result = validate(`scene.${family}.update`, {
          sceneId: "scene-1",
          [idKey]: `${family}-1`,
          patch: {}
        });
        expect(result.ok, `scene.${family}.update must reject an empty patch`).toBe(false);
      }
    });

    it("gives scene.region.list a name filter but drawing/light/template lists none (wall precedent)", () => {
      expectValid("scene.region.list", { sceneId: "scene-1", name: "Zone" });
      const regionProps = /** @type {Record<string, unknown>} */ (
        COMMAND_DEFINITIONS["scene.region.list"].paramsSchema.properties
      );
      expect(regionProps.name).toEqual({ type: "string", minLength: 1 });
      for (const family of ["drawing", "light", "template"]) {
        const props = /** @type {Record<string, unknown>} */ (
          COMMAND_DEFINITIONS[`scene.${family}.list`].paramsSchema.properties
        );
        expect(props.name, `scene.${family}.list must have NO name filter`).toBeUndefined();
      }
    });

    it("requires sceneId + the type id on the *.get reads", () => {
      for (const { family, idKey } of FAMILIES) {
        expect(COMMAND_DEFINITIONS[`scene.${family}.get`].paramsSchema.required).toEqual(["sceneId", idKey]);
        const missingId = validate(`scene.${family}.get`, { sceneId: "scene-1" });
        expect(missingId.ok, `scene.${family}.get must require ${idKey}`).toBe(false);
      }
    });
  });

  describe("list pagination params", () => {
    const LIST_COMMANDS = [
      { command: "scene.list", base: {} },
      { command: "item.list", base: {} },
      { command: "journal.list", base: {} },
      { command: "actor.list", base: {} },
      { command: "compendium.list", base: {} },
      { command: "scene.token.list", base: { sceneId: "scene-1" } },
      { command: "scene.tile.list", base: { sceneId: "scene-1" } },
      { command: "scene.sound.list", base: { sceneId: "scene-1" } },
      { command: "scene.wall.list", base: { sceneId: "scene-1" } },
      { command: "scene.note.list", base: { sceneId: "scene-1" } },
      { command: "scene.drawing.list", base: { sceneId: "scene-1" } },
      { command: "scene.light.list", base: { sceneId: "scene-1" } },
      { command: "scene.template.list", base: { sceneId: "scene-1" } },
      { command: "scene.region.list", base: { sceneId: "scene-1" } },
      { command: "scene.token.item.list", base: { sceneId: "scene-1", tokenId: "token-a" } },
      { command: "actor.item.list", base: { actorId: "actor-1" } },
      { command: "actor.effect.list", base: { actorId: "actor-1" } },
      { command: "item.effect.list", base: { itemId: "item-1" } },
      { command: "actor.item.effect.list", base: { actorId: "actor-1", itemId: "item-1" } },
      { command: "scene.token.effect.list", base: { sceneId: "scene-1", tokenId: "tok-1" } },
      {
        command: "scene.token.item.effect.list",
        base: { sceneId: "scene-1", tokenId: "tok-1", itemId: "item-1" }
      },
      { command: "compendium.index", base: { pack: "world.test-monsters" } },
      { command: "folder.list", base: {} },
      { command: "file.list", base: { path: "" } },
      { command: "playlist.list", base: {} },
      { command: "playlist.sound.list", base: { playlistId: "pl-1" } },
      { command: "chat.list", base: {} }
    ];

    it("accepts optional limit and offset on every list command", () => {
      for (const { command, base } of LIST_COMMANDS) {
        expectValid(command, { ...base, limit: 5, offset: 10 });

        expectValid(command, { ...base });

        expectValid(command, { ...base, offset: 0 });
      }
    });

    it("rejects a limit below 1", () => {
      expectRejected("item.list", { limit: 0 }, "$.params.limit must be >= 1");
      expectRejected("compendium.index", { pack: "world.x", limit: -3 }, "$.params.limit must be >= 1");
    });

    it("rejects a negative offset", () => {
      expectRejected("item.list", { offset: -1 }, "$.params.offset must be >= 0");
    });

    it("rejects a non-integer limit or offset", () => {
      expectRejected("item.list", { limit: 2.5 }, "$.params.limit must be integer");
      expectRejected("actor.list", { offset: 1.5 }, "$.params.offset must be integer");
    });

    it("still rejects unknown params on a paginated list", () => {
      expectRejected("item.list", { bogus: true }, "$.params.bogus is not allowed");
      expectRejected("scene.token.list", { sceneId: "scene-1", bogus: 1 }, "$.params.bogus is not allowed");
    });

    it("does not leak pagination into the matching *.get / single-doc commands", () => {
      expectRejected("actor.get", { actorId: "actor-1", limit: 5 }, "$.params.limit is not allowed");
      expectRejected("scene.get", { sceneId: "scene-1", offset: 0 }, "$.params.offset is not allowed");
      expectRejected("item.get", { itemId: "item-1", limit: 1 }, "$.params.limit is not allowed");
      expectRejected("system.info", { limit: 1 }, "$.params.limit is not allowed");
    });

    const PAGINATED_COMMANDS = Object.freeze([
      "scene.list",
      "scene.token.list",
      "scene.tile.list",
      "scene.sound.list",
      "scene.wall.list",
      "scene.note.list",
      "scene.drawing.list",
      "scene.light.list",
      "scene.template.list",
      "scene.region.list",
      "scene.region.behavior.list",
      "scene.token.item.list",
      "scene.token.effect.list",
      "scene.token.effect.applied",
      "scene.token.item.effect.list",
      "item.list",
      "item.effect.list",
      "journal.list",
      "journal.category.list",
      "macro.list",
      "actor.list",
      "actor.item.list",
      "actor.effect.list",
      "actor.effect.applied",
      "actor.item.effect.list",
      "compendium.list",
      "compendium.index",
      "folder.list",
      "file.list",
      "playlist.list",
      "playlist.sound.list",
      "table.list",
      "table.result.list",
      "combat.list",
      "combat.combatant.list",
      "combat.group.list",
      "cards.list",
      "cards.card.list",
      "chat.list",
      "user.list",

      "setting.list",

      "world.audit-files",

      "world.search"
    ]);

    it("declares pagination on exactly the documented set (both directions)", () => {
      const declared = COMMAND_NAMES.filter((command) => {
        const properties = COMMAND_DEFINITIONS[command].paramsSchema.properties ?? {};
        return "limit" in properties || "offset" in properties;
      });
      expect(
        [...declared].sort(),
        'a command gained/lost pagination: update docs/commands.md\'s "This applies to:" index (and its stated count) in the same change'
      ).toEqual([...PAGINATED_COMMANDS].sort());

      for (const command of PAGINATED_COMMANDS) {
        const properties = COMMAND_DEFINITIONS[command].paramsSchema.properties ?? {};
        expect(properties.limit, `${command} must declare limit`).toBeDefined();
        expect(properties.offset, `${command} must declare offset`).toBeDefined();
      }
    });
  });

  describe("name substring filter", () => {
    const NAME_FILTERED = Object.freeze({
      "scene.list": {},
      "item.list": {},
      "journal.list": {},
      "macro.list": {},
      "actor.list": {},
      "scene.token.list": { sceneId: "scene-1" },
      "scene.token.item.list": { sceneId: "scene-1", tokenId: "token-a" },
      "actor.item.list": { actorId: "actor-1" },
      "actor.effect.list": { actorId: "actor-1" },
      "item.effect.list": { itemId: "item-1" },
      "actor.item.effect.list": { actorId: "actor-1", itemId: "item-1" },
      "scene.token.effect.list": { sceneId: "scene-1", tokenId: "tok-1" },
      "scene.token.item.effect.list": { sceneId: "scene-1", tokenId: "tok-1", itemId: "item-1" },
      "scene.region.list": { sceneId: "scene-1" },
      "compendium.index": { pack: "world.test-monsters" },
      "folder.list": {},
      "playlist.list": {},
      "playlist.sound.list": { playlistId: "pl-1" },
      "table.list": {},
      "table.result.list": { tableId: "tbl-1" },
      "cards.list": {},

      "cards.card.list": { cardsId: "cards-1" },

      "journal.category.list": { journalId: "j-1" },

      "scene.region.behavior.list": { sceneId: "scene-1", regionId: "region-1" },
      "user.list": {},

      "setting.list": {}
    });

    const NAME_FILTERED_COMMANDS = Object.freeze(Object.keys(NAME_FILTERED));

    const NAME_REJECTED = Object.freeze([
      { command: "scene.tile.list", base: { sceneId: "scene-1" } },
      { command: "scene.sound.list", base: { sceneId: "scene-1" } },
      { command: "scene.wall.list", base: { sceneId: "scene-1" } },
      { command: "scene.note.list", base: { sceneId: "scene-1" } },
      { command: "scene.drawing.list", base: { sceneId: "scene-1" } },
      { command: "scene.light.list", base: { sceneId: "scene-1" } },
      { command: "scene.template.list", base: { sceneId: "scene-1" } },
      { command: "compendium.list", base: {} },
      { command: "file.list", base: { path: "" } },
      { command: "scene.get", base: { sceneId: "scene-1" } },
      { command: "actor.get", base: { actorId: "actor-1" } },
      { command: "item.get", base: { itemId: "item-1" } },
      { command: "compendium.get", base: { pack: "world.x", entryId: "e-1" } },
      { command: "actor.update", base: { actorId: "actor-1", patch: { img: "x.png" } } }
    ]);

    it("declares an optional name (string, minLength:1) on exactly the named list/index commands", () => {
      for (const command of NAME_FILTERED_COMMANDS) {
        const schema = COMMAND_DEFINITIONS[command].paramsSchema;
        expect(schema.properties?.name, `${command} must declare name`).toEqual({
          type: "string",
          minLength: 1
        });

        expect(schema.required, `${command} must not require name`).not.toContain("name");
      }
    });

    it("accepts a name filter alongside the required scope params and pagination", () => {
      for (const [command, base] of Object.entries(NAME_FILTERED)) {
        expectValid(command, { ...base, name: "shadow" });

        expectValid(command, { ...base, name: "shadow", limit: 5, offset: 10 });

        expectValid(command, { ...base });
      }
    });

    it("composes name + type on folder.list", () => {
      expectValid("folder.list", { name: "monsters", type: "Actor", limit: 2 });
    });

    it("rejects an empty name (minLength:1, no ambiguous match-all)", () => {
      expectRejected("item.list", { name: "" }, "$.params.name must be at least 1 characters long");
      expectRejected(
        "compendium.index",
        { pack: "world.x", name: "" },
        "$.params.name must be at least 1 characters long"
      );
    });

    it("rejects a non-string name", () => {
      expectRejected("actor.list", { name: 5 }, "$.params.name must be string");
    });

    it("does NOT declare name on any command outside the named list/index set", () => {
      for (const command of COMMAND_NAMES) {
        if (NAME_FILTERED_COMMANDS.includes(command)) {
          continue;
        }
        expect(
          COMMAND_DEFINITIONS[command].paramsSchema.properties?.name,
          `${command} must NOT declare a name filter param`
        ).toBeUndefined();
      }
    });

    it("rejects name on the nameless lists and on *.get / mutation commands (no shared-schema leak)", () => {
      for (const { command, base } of NAME_REJECTED) {
        expectRejected(command, { ...base, name: "shadow" }, "$.params.name is not allowed");
      }
    });
  });

  describe("compendium.index exact / fields params", () => {
    it("accepts exact (boolean) and fields (string[]) alongside name/pagination", () => {
      expectValid("compendium.index", { pack: "world.x", name: "Shield", exact: true });
      expectValid("compendium.index", {
        pack: "world.x",
        fields: ["flags.ddbimporter.definitionId", "system.source"]
      });
      expectValid("compendium.index", {
        pack: "world.x",
        name: "Shield",
        exact: true,
        fields: ["system.source"],
        limit: 5,
        offset: 2
      });

      expectValid("compendium.index", { pack: "world.x" });
    });

    it("rejects a non-boolean exact and a non-array/non-string fields", () => {
      expectRejected("compendium.index", { pack: "world.x", exact: "yes" }, "$.params.exact must be boolean");
      expectRejected(
        "compendium.index",
        { pack: "world.x", fields: "system.source" },
        "$.params.fields must be array"
      );
      expectRejected(
        "compendium.index",
        { pack: "world.x", fields: [1] },
        "$.params.fields[0] must be string"
      );
    });

    it("still rejects unknown props (additionalProperties:false)", () => {
      expectRejected("compendium.index", { pack: "world.x", bogus: true }, "$.params.bogus is not allowed");
    });
  });

  describe("dryRun mutation param", () => {
    it("declares dryRun on every mutation command and accepts dryRun:true alongside valid params", () => {
      for (const command of WRITE_COMMANDS) {
        const schema = COMMAND_DEFINITIONS[command].paramsSchema;
        expect(schema.properties?.dryRun, `${command} must declare dryRun`).toBeDefined();
        expect(schema.properties.dryRun, `${command} dryRun must be a boolean schema`).toEqual({
          type: "boolean"
        });

        const base = MUTATION_BASES[command];
        expect(base, `missing test base for ${command}`).toBeDefined();

        expectValid(command, base);
        expectValid(command, { ...base, dryRun: true });
        expectValid(command, { ...base, dryRun: false });
      }
    });

    it("never declares dryRun on a read command (no leak via shared schemas)", () => {
      for (const command of COMMAND_NAMES) {
        if (COMMAND_DEFINITIONS[command].mutation) {
          continue;
        }
        expect(
          COMMAND_DEFINITIONS[command].paramsSchema.properties?.dryRun,
          `${command} is a read command and must NOT carry dryRun`
        ).toBeUndefined();
      }
    });

    it("rejects dryRun on the read commands that share a base schema with a delete", () => {
      expectRejected("item.get", { itemId: "item-1", dryRun: true }, "$.params.dryRun is not allowed");
      expectRejected("journal.get", { journalId: "j-1", dryRun: true }, "$.params.dryRun is not allowed");
    });

    it("rejects a non-boolean dryRun on a mutation command", () => {
      const result = validate("item.delete", { itemId: "item-1", dryRun: "yes" });
      expect(result.ok).toBe(false);
      expect(result.errors).toContain("$.params.dryRun must be boolean");
    });
  });

  describe("idempotencyKey on create/upload/clone commands", () => {
    const IDEMPOTENT_BASES = Object.freeze({
      "scene.create": { data: { name: "X" } },
      "scene.token.create": { sceneId: "scene-1", data: { name: "X" } },
      "scene.token.item.create": { sceneId: "scene-1", tokenId: "tok-1", data: { name: "X", type: "loot" } },
      "scene.token.item.clone": { sceneId: "scene-1", tokenId: "tok-1", itemId: "item-1" },
      "scene.token.effect.create": { sceneId: "scene-1", tokenId: "tok-1", data: { name: "Aura" } },
      "scene.token.item.effect.create": {
        sceneId: "scene-1",
        tokenId: "tok-1",
        itemId: "item-1",
        data: { name: "Aura" }
      },
      "scene.tile.create": { sceneId: "scene-1", data: { x: 1 } },
      "scene.sound.create": { sceneId: "scene-1", data: { path: "a.ogg" } },
      "scene.wall.create": { sceneId: "scene-1", data: { c: [0, 0, 100, 0] } },
      "scene.note.create": { sceneId: "scene-1", data: { x: 10, y: 20 } },
      "scene.drawing.create": { sceneId: "scene-1", data: { x: 10, y: 20 } },
      "scene.light.create": { sceneId: "scene-1", data: { x: 10, y: 20 } },
      "scene.template.create": { sceneId: "scene-1", data: { t: "circle", x: 10, y: 20 } },
      "scene.region.create": { sceneId: "scene-1", data: { name: "Zone" } },
      "item.create": { data: { name: "X", type: "loot" } },
      "journal.create": { data: { name: "X" } },
      "macro.create": { data: { name: "X" } },
      "actor.create": { data: { name: "X", type: "npc" } },
      "actor.item.create": { actorId: "actor-1", data: { name: "X", type: "loot" } },
      "actor.effect.create": { actorId: "actor-1", data: { name: "Aura" } },
      "item.effect.create": { itemId: "item-1", data: { name: "Aura" } },
      "actor.item.effect.create": { actorId: "actor-1", itemId: "item-1", data: { name: "Aura" } },
      "folder.create": { data: { name: "X", type: "Item" } },
      "actor.import-from-compendium": { pack: "world.x", entryId: "e-1" },
      "actor.item.import-from-compendium": { actorId: "actor-1", pack: "world.x", entryId: "e-1" },
      "item.import-from-compendium": { pack: "world.x", entryId: "e-1" },
      "journal.import-from-compendium": { pack: "world.x", entryId: "e-1" },

      "journal.category.create": { journalId: "j-1", data: { name: "Chapter One" } },

      "scene.region.behavior.create": {
        sceneId: "scene-1",
        regionId: "region-1",
        data: { type: "pauseGame" }
      },
      "scene.region.behavior.clone": { sceneId: "scene-1", regionId: "region-1", behaviorId: "beh-1" },
      "scene.import-from-compendium": { pack: "world.x", entryId: "e-1" },
      "macro.import-from-compendium": { pack: "world.x", entryId: "e-1" },
      "playlist.import-from-compendium": { pack: "world.x", entryId: "e-1" },
      "table.import-from-compendium": { pack: "world.x", entryId: "e-1" },
      "cards.import-from-compendium": { pack: "world.x", entryId: "e-1" },
      "file.upload": { path: "worlds/w/fvtt-world-cli/x.txt", contentBase64: "QQ==" },

      "file.move": { from: "worlds/w/fvtt-world-cli/a.txt", to: "worlds/w/fvtt-world-cli/b.txt" },

      "folder.delete": { folderId: "folder-1" },

      "scene.clone": { sceneId: "scene-1" },
      "scene.token.clone": { sceneId: "scene-1", tokenId: "tok-1" },
      "scene.token.effect.clone": { sceneId: "scene-1", tokenId: "tok-1", effectId: "eff-1" },
      "scene.token.item.effect.clone": {
        sceneId: "scene-1",
        tokenId: "tok-1",
        itemId: "item-1",
        effectId: "eff-1"
      },
      "scene.tile.clone": { sceneId: "scene-1", tileId: "tile-1" },
      "scene.sound.clone": { sceneId: "scene-1", soundId: "sound-1" },
      "scene.wall.clone": { sceneId: "scene-1", wallId: "wall-1" },

      "scene.wall.create-many": { sceneId: "scene-1", data: [{ c: [0, 0, 100, 0] }] },
      "scene.wall.update-many": { sceneId: "scene-1", patches: [{ id: "wall-1", patch: { door: 1 } }] },
      "scene.wall.delete-many": { sceneId: "scene-1", ids: ["wall-1"] },
      "scene.token.create-many": { sceneId: "scene-1", data: [{ actorId: "actor-1" }] },
      "scene.token.update-many": { sceneId: "scene-1", patches: [{ id: "tok-1", patch: { x: 5 } }] },
      "scene.token.delete-many": { sceneId: "scene-1", ids: ["tok-1"] },
      "scene.tile.create-many": { sceneId: "scene-1", data: [{ x: 1, y: 2 }] },
      "scene.tile.update-many": { sceneId: "scene-1", patches: [{ id: "tile-1", patch: { x: 1 } }] },
      "scene.tile.delete-many": { sceneId: "scene-1", ids: ["tile-1"] },
      "scene.sound.create-many": { sceneId: "scene-1", data: [{ path: "a.ogg" }] },
      "scene.sound.update-many": { sceneId: "scene-1", patches: [{ id: "snd-1", patch: { volume: 1 } }] },
      "scene.sound.delete-many": { sceneId: "scene-1", ids: ["snd-1"] },
      "scene.note.create-many": { sceneId: "scene-1", data: [{ x: 10, y: 20 }] },
      "scene.note.update-many": { sceneId: "scene-1", patches: [{ id: "note-1", patch: { text: "X" } }] },
      "scene.note.delete-many": { sceneId: "scene-1", ids: ["note-1"] },

      "scene.drawing.create-many": { sceneId: "scene-1", data: [{ x: 1, y: 2 }] },
      "scene.drawing.update-many": { sceneId: "scene-1", patches: [{ id: "drw-1", patch: { x: 1 } }] },
      "scene.drawing.delete-many": { sceneId: "scene-1", ids: ["drw-1"] },
      "scene.light.create-many": { sceneId: "scene-1", data: [{ x: 1, y: 2 }] },
      "scene.light.update-many": { sceneId: "scene-1", patches: [{ id: "lgt-1", patch: { x: 1 } }] },
      "scene.light.delete-many": { sceneId: "scene-1", ids: ["lgt-1"] },
      "scene.template.create-many": { sceneId: "scene-1", data: [{ t: "circle", x: 1, y: 2, distance: 5 }] },
      "scene.template.update-many": {
        sceneId: "scene-1",
        patches: [{ id: "tpl-1", patch: { distance: 9 } }]
      },
      "scene.template.delete-many": { sceneId: "scene-1", ids: ["tpl-1"] },
      "scene.region.create-many": { sceneId: "scene-1", data: [{ name: "Zone" }] },
      "scene.region.update-many": { sceneId: "scene-1", patches: [{ id: "rgn-1", patch: { name: "Zone" } }] },
      "scene.region.delete-many": { sceneId: "scene-1", ids: ["rgn-1"] },

      "actor.effect.create-many": { actorId: "actor-1", data: [{ name: "Bless" }] },
      "actor.effect.update-many": {
        actorId: "actor-1",
        patches: [{ id: "eff-1", patch: { disabled: true } }]
      },
      "actor.effect.delete-many": { actorId: "actor-1", ids: ["eff-1"] },
      "item.effect.create-many": { itemId: "item-1", data: [{ name: "Bless" }] },
      "item.effect.update-many": { itemId: "item-1", patches: [{ id: "eff-1", patch: { disabled: true } }] },
      "item.effect.delete-many": { itemId: "item-1", ids: ["eff-1"] },
      "actor.item.effect.create-many": { actorId: "actor-1", itemId: "item-1", data: [{ name: "Bless" }] },
      "actor.item.effect.update-many": {
        actorId: "actor-1",
        itemId: "item-1",
        patches: [{ id: "eff-1", patch: { disabled: true } }]
      },
      "actor.item.effect.delete-many": { actorId: "actor-1", itemId: "item-1", ids: ["eff-1"] },
      "scene.token.effect.create-many": { sceneId: "scene-1", tokenId: "token-1", data: [{ name: "Bless" }] },
      "scene.token.effect.update-many": {
        sceneId: "scene-1",
        tokenId: "token-1",
        patches: [{ id: "eff-1", patch: { disabled: true } }]
      },
      "scene.token.effect.delete-many": { sceneId: "scene-1", tokenId: "token-1", ids: ["eff-1"] },
      "scene.token.item.effect.create-many": {
        sceneId: "scene-1",
        tokenId: "token-1",
        itemId: "item-1",
        data: [{ name: "Bless" }]
      },
      "scene.token.item.effect.update-many": {
        sceneId: "scene-1",
        tokenId: "token-1",
        itemId: "item-1",
        patches: [{ id: "eff-1", patch: { disabled: true } }]
      },
      "scene.token.item.effect.delete-many": {
        sceneId: "scene-1",
        tokenId: "token-1",
        itemId: "item-1",
        ids: ["eff-1"]
      },
      "item.update-many": { patches: [{ id: "item-1", patch: { name: "Sword" } }] },
      "item.delete-many": { ids: ["item-1"] },
      "actor.update-many": { patches: [{ id: "actor-1", patch: { name: "Hero" } }] },
      "actor.delete-many": { ids: ["actor-1"] },
      "journal.update-many": { patches: [{ id: "journal-1", patch: { name: "Notes" } }] },
      "journal.delete-many": { ids: ["journal-1"] },
      "scene.note.clone": { sceneId: "scene-1", noteId: "note-1" },
      "scene.drawing.clone": { sceneId: "scene-1", drawingId: "draw-1" },
      "scene.light.clone": { sceneId: "scene-1", lightId: "light-1" },
      "scene.template.clone": { sceneId: "scene-1", templateId: "tmpl-1" },
      "scene.region.clone": { sceneId: "scene-1", regionId: "region-1" },
      "item.clone": { itemId: "item-1" },
      "item.effect.clone": { itemId: "item-1", effectId: "eff-1" },
      "journal.clone": { journalId: "journal-1" },
      "macro.clone": { macroId: "macro-1" },
      "actor.clone": { actorId: "actor-1" },
      "actor.item.clone": { actorId: "actor-1", itemId: "item-1" },
      "actor.effect.clone": { actorId: "actor-1", effectId: "eff-1" },
      "actor.item.effect.clone": { actorId: "actor-1", itemId: "item-1", effectId: "eff-1" },
      "playlist.create": { data: { name: "X" } },
      "playlist.clone": { playlistId: "pl-1" },
      "playlist.sound.create": { playlistId: "pl-1", data: { path: "a.ogg" } },
      "playlist.sound.clone": { playlistId: "pl-1", soundId: "s-1" },
      "table.create": { data: { name: "X" } },
      "table.clone": { tableId: "tbl-1" },
      "table.result.create": { tableId: "tbl-1", data: { range: [1, 1] } },
      "table.result.clone": { tableId: "tbl-1", resultId: "res-1" },

      "table.draw": { tableId: "tbl-1", idempotencyKey: "draw-1" },

      "table.reset": { tableId: "tbl-1" },
      "chat.create": { data: { content: "hi" } },

      "cards.create": { data: { name: "Deck", type: "deck" } },
      "cards.clone": { cardsId: "crd-1" },
      "cards.delete": { cardsId: "crd-1" },

      "cards.card.create": { cardsId: "crd-1", data: { name: "Ace of Spades" } },
      "cards.card.clone": { cardsId: "crd-1", cardId: "crd-card-1" },

      "cards.shuffle": { cardsId: "crd-1" },
      "cards.reset": { cardsId: "crd-1" },
      "cards.deal": { cardsId: "crd-1", to: ["crd-2"], idempotencyKey: "deal-1" },
      "cards.draw": { cardsId: "crd-1", from: "crd-2", idempotencyKey: "draw-1" },
      "cards.pass": { cardsId: "crd-1", to: "crd-2", cardIds: ["crd-card-1"], idempotencyKey: "pass-1" },

      "combat.create": { data: {} },

      "combat.combatant.create": { combatId: "cbt-1", data: {} },
      "combat.group.create": { combatId: "cbt-1", data: {} },

      "combat.start": { combatId: "cbt-1" },
      "combat.activate": { combatId: "cbt-1" },
      "combat.next-turn": { combatId: "cbt-1", idempotencyKey: "adv-1" },
      "combat.previous-turn": { combatId: "cbt-1", idempotencyKey: "adv-2" },
      "combat.next-round": { combatId: "cbt-1", idempotencyKey: "adv-3" },
      "combat.previous-round": { combatId: "cbt-1", idempotencyKey: "adv-4" },
      "combat.reset-initiative": { combatId: "cbt-1" },
      "combat.roll-initiative": { combatId: "cbt-1", select: "all", idempotencyKey: "roll-1" },
      "combat.set-initiative": { combatId: "cbt-1", combatantId: "cmb-1", initiative: 12 }
    });

    const IDEMPOTENT_COMMANDS = Object.freeze(Object.keys(IDEMPOTENT_BASES));

    it("declares idempotencyKey on exactly the create/upload/clone commands and accepts it alongside valid params", () => {
      for (const command of IDEMPOTENT_COMMANDS) {
        const schema = COMMAND_DEFINITIONS[command].paramsSchema;
        expect(schema.properties?.idempotencyKey, `${command} must declare idempotencyKey`).toEqual({
          type: "string",
          minLength: 1
        });

        const base = IDEMPOTENT_BASES[command];
        expectValid(command, base);
        expectValid(command, { ...base, idempotencyKey: "key-1" });
      }
    });

    it("pins the RULE: every *.create/*.clone carries idempotencyKey, plus exactly the named action verbs", () => {
      const carriers = COMMAND_NAMES.filter(
        (command) => COMMAND_DEFINITIONS[command].paramsSchema.properties?.idempotencyKey
      );
      const createLike = (command) => command.endsWith(".create") || command.endsWith(".clone");

      expect(
        COMMAND_NAMES.filter((command) => createLike(command) && !carriers.includes(command)),
        "every *.create/*.clone must declare idempotencyKey"
      ).toEqual([]);
      expect(carriers.filter((command) => !createLike(command)).sort()).toEqual([
        "actor.delete-many",
        "actor.effect.create-many",
        "actor.effect.delete-many",
        "actor.effect.update-many",
        "actor.import-from-compendium",
        "actor.item.effect.create-many",
        "actor.item.effect.delete-many",
        "actor.item.effect.update-many",
        "actor.item.import-from-compendium",
        "actor.update-many",

        "cards.deal",
        "cards.delete",
        "cards.draw",
        "cards.import-from-compendium",
        "cards.pass",
        "cards.reset",
        "cards.shuffle",

        "combat.activate",
        "combat.next-round",
        "combat.next-turn",
        "combat.previous-round",
        "combat.previous-turn",
        "combat.reset-initiative",
        "combat.roll-initiative",
        "combat.set-initiative",
        "combat.start",
        "file.move",
        "file.upload",
        "folder.delete",
        "item.delete-many",
        "item.effect.create-many",
        "item.effect.delete-many",
        "item.effect.update-many",
        "item.import-from-compendium",
        "item.update-many",
        "journal.delete-many",
        "journal.import-from-compendium",
        "journal.update-many",
        "macro.import-from-compendium",
        "playlist.import-from-compendium",

        "scene.drawing.create-many",
        "scene.drawing.delete-many",
        "scene.drawing.update-many",
        "scene.import-from-compendium",
        "scene.light.create-many",
        "scene.light.delete-many",
        "scene.light.update-many",
        "scene.note.create-many",
        "scene.note.delete-many",
        "scene.note.update-many",
        "scene.region.create-many",
        "scene.region.delete-many",
        "scene.region.update-many",
        "scene.sound.create-many",
        "scene.sound.delete-many",
        "scene.sound.update-many",
        "scene.template.create-many",
        "scene.template.delete-many",
        "scene.template.update-many",
        "scene.tile.create-many",
        "scene.tile.delete-many",
        "scene.tile.update-many",
        "scene.token.create-many",
        "scene.token.delete-many",
        "scene.token.effect.create-many",
        "scene.token.effect.delete-many",
        "scene.token.effect.update-many",
        "scene.token.item.effect.create-many",
        "scene.token.item.effect.delete-many",
        "scene.token.item.effect.update-many",
        "scene.token.update-many",
        "scene.wall.create-many",
        "scene.wall.delete-many",
        "scene.wall.update-many",

        "table.draw",
        "table.import-from-compendium",
        "table.reset"
      ]);
    });

    it("pins WHICH commands REQUIRE idempotencyKey (table.draw, the three cards movement verbs + the five non-convergent combat verbs)", () => {
      const requiringKey = COMMAND_NAMES.filter((command) =>
        (COMMAND_DEFINITIONS[command].paramsSchema.required ?? []).includes("idempotencyKey")
      );
      expect(
        requiringKey.sort(),
        "widening this set means the documents enumerating the required-key verbs must be updated too"
      ).toEqual([
        "cards.deal",
        "cards.draw",
        "cards.pass",
        "combat.next-round",
        "combat.next-turn",
        "combat.previous-round",
        "combat.previous-turn",
        "combat.roll-initiative",
        "table.draw"
      ]);
    });

    it("rejects an empty idempotencyKey (minLength:1)", () => {
      expectRejected(
        "item.create",
        { data: { name: "X", type: "loot" }, idempotencyKey: "" },
        "$.params.idempotencyKey must be at least 1 characters long"
      );
    });

    it("rejects a non-string idempotencyKey", () => {
      expectRejected(
        "item.create",
        { data: { name: "X", type: "loot" }, idempotencyKey: 5 },
        "$.params.idempotencyKey must be string"
      );
    });

    it("does NOT declare idempotencyKey on any non-idempotent command", () => {
      for (const command of COMMAND_NAMES) {
        if (IDEMPOTENT_COMMANDS.includes(command)) {
          continue;
        }
        expect(
          COMMAND_DEFINITIONS[command].paramsSchema.properties?.idempotencyKey,
          `${command} must NOT carry idempotencyKey`
        ).toBeUndefined();
      }
    });

    it("rejects idempotencyKey on update/delete and read commands (clones now accept it)", () => {
      expectRejected(
        "item.update",
        { itemId: "item-1", patch: { name: "X" }, idempotencyKey: "k" },
        "$.params.idempotencyKey is not allowed"
      );
      expectRejected(
        "item.delete",
        { itemId: "item-1", idempotencyKey: "k" },
        "$.params.idempotencyKey is not allowed"
      );
      expectRejected(
        "item.get",
        { itemId: "item-1", idempotencyKey: "k" },
        "$.params.idempotencyKey is not allowed"
      );
      expectRejected("item.list", { idempotencyKey: "k" }, "$.params.idempotencyKey is not allowed");
      expectRejected(
        "file.mkdir",
        { path: "worlds/w/fvtt-world-cli/x", idempotencyKey: "k" },
        "$.params.idempotencyKey is not allowed"
      );
    });
  });

  describe("include opt-in on detailed reads", () => {
    const INCLUDE_BASES = Object.freeze({
      "actor.get": { actorId: "actor-1" },
      "actor.get-many": { ids: ["actor-1"] },
      "item.get": { itemId: "item-1" },
      "item.get-many": { ids: ["item-1"] },
      "actor.item.get": { actorId: "actor-1", itemId: "item-1" },
      "actor.item.list": { actorId: "actor-1" },
      "item.create": { data: { name: "Torch", type: "loot" } },
      "item.update": { itemId: "item-1", patch: { name: "Renamed" } },
      "actor.create": { data: { name: "Goblin", type: "npc" } },
      "actor.update": { actorId: "actor-1", patch: { name: "Renamed" } },
      "actor.item.create": { actorId: "actor-1", data: { name: "Torch", type: "loot" } },
      "actor.item.update": { actorId: "actor-1", itemId: "item-1", patch: { name: "Renamed" } },
      "actor.item.import-from-compendium": { actorId: "actor-1", pack: "world.x", entryId: "e-1" },
      "scene.token.item.create": {
        sceneId: "scene-1",
        tokenId: "token-1",
        data: { name: "Torch", type: "loot" }
      },
      "scene.token.item.update": {
        sceneId: "scene-1",
        tokenId: "token-1",
        itemId: "item-1",
        patch: { name: "Renamed" }
      },
      "scene.token.get": { sceneId: "scene-1", tokenId: "token-1" },
      "compendium.get": { pack: "world.x", entryId: "e-1" }
    });

    const INCLUDE_COMMANDS = Object.freeze(Object.keys(INCLUDE_BASES));

    const BASE_INCLUDE_ENUM = Object.freeze(["flags", "effects"]);
    const ACTOR_INCLUDE_ENUM = Object.freeze([
      "flags",
      "effects",
      "items.flags",
      "items.effects",
      "prepared"
    ]);
    const TOKEN_INCLUDE_ENUM = Object.freeze(["prepared"]);

    const COMPENDIUM_INCLUDE_ENUM = Object.freeze(["effects"]);
    const expectedIncludeEnum = (command) => {
      if (command === "actor.get" || command === "actor.get-many") return ACTOR_INCLUDE_ENUM;
      if (command === "scene.token.get") return TOKEN_INCLUDE_ENUM;
      if (command === "compendium.get") return COMPENDIUM_INCLUDE_ENUM;
      return BASE_INCLUDE_ENUM;
    };

    it("declares an optional include with the right enum on exactly the include reads", () => {
      for (const command of INCLUDE_COMMANDS) {
        const schema = COMMAND_DEFINITIONS[command].paramsSchema;
        expect(schema.properties?.include, `${command} must declare include`).toEqual({
          type: "array",
          items: { type: "string", enum: expectedIncludeEnum(command) }
        });

        expect(schema.required, `${command} must not require include`).not.toContain("include");

        const base = INCLUDE_BASES[command];

        const enumValues = expectedIncludeEnum(command);
        expectValid(command, base);
        for (const value of enumValues) {
          expectValid(command, { ...base, include: [value] });
        }
        expectValid(command, { ...base, include: enumValues.slice() });

        expectValid(command, { ...base, include: [] });
      }
    });

    it("accepts the scoped-nested items.* values ONLY on actor.get; item-level reads reject them", () => {
      expectValid("actor.get", { actorId: "actor-1", include: ["items.flags"] });
      expectValid("actor.get", { actorId: "actor-1", include: ["items.effects"] });
      expectValid("actor.get", {
        actorId: "actor-1",
        include: ["flags", "items.flags", "items.effects"]
      });

      expectValid("actor.get-many", { ids: ["actor-1"], include: ["items.flags"] });
      for (const command of INCLUDE_COMMANDS) {
        if (
          command === "actor.get" ||
          command === "actor.get-many" ||
          command === "scene.token.get" ||
          command === "compendium.get"
        ) {
          continue;
        }
        const base = INCLUDE_BASES[command];
        expectRejected(
          command,
          { ...base, include: ["items.flags"] },
          "$.params.include[0] must be one of flags"
        );
      }
    });

    it("scene.token.get accepts prepared and rejects flags/effects/items.* (singleton enum)", () => {
      expectValid("scene.token.get", { sceneId: "scene-1", tokenId: "token-1", include: ["prepared"] });
      for (const bogus of ["flags", "effects", "items.flags"]) {
        expectRejected(
          "scene.token.get",
          { sceneId: "scene-1", tokenId: "token-1", include: [bogus] },
          "$.params.include[0] must be one of prepared"
        );
      }
    });

    it("rejects an unknown include value and a non-array include on every detailed read", () => {
      for (const command of INCLUDE_COMMANDS) {
        const base = INCLUDE_BASES[command];
        const firstAllowed = expectedIncludeEnum(command)[0];
        expectRejected(
          command,
          { ...base, include: ["bogus"] },
          `$.params.include[0] must be one of ${firstAllowed}`
        );
        expectRejected(command, { ...base, include: "flags" }, "$.params.include must be array");
      }
    });

    it("does NOT declare include on any other command (no shared-schema leak)", () => {
      for (const command of COMMAND_NAMES) {
        if (INCLUDE_COMMANDS.includes(command)) {
          continue;
        }
        expect(
          COMMAND_DEFINITIONS[command].paramsSchema.properties?.include,
          `${command} must NOT carry include`
        ).toBeUndefined();
      }
    });

    it("rejects include on sibling commands that key off the same id base (fresh-schema guard)", () => {
      expectRejected(
        "item.delete",
        { itemId: "item-1", include: ["flags"] },
        "$.params.include is not allowed"
      );
      expectRejected(
        "actor.delete",
        { actorId: "actor-1", include: ["flags"] },
        "$.params.include is not allowed"
      );
      expectRejected(
        "actor.item.delete",
        { actorId: "actor-1", itemId: "item-1", include: ["flags"] },
        "$.params.include is not allowed"
      );
      expectRejected("item.list", { include: ["flags"] }, "$.params.include is not allowed");
      expectRejected("actor.list", { include: ["flags"] }, "$.params.include is not allowed");
    });
  });

  describe("batched reads (*.get-many)", () => {
    const BATCH_COMMANDS = [
      "actor.get-many",
      "item.get-many",
      "journal.get-many",
      "scene.get-many",
      "macro.get-many",
      "playlist.get-many",
      "table.get-many"
    ];
    it("defines the six batch reads as non-mutating with a required ids array (minItems:1, closed schema)", () => {
      for (const command of BATCH_COMMANDS) {
        const def = COMMAND_DEFINITIONS[command];
        expect(def, `${command} must exist`).toBeDefined();
        expect(def.mutation).toBe(false);
        const schema = def.paramsSchema;
        expect(schema.required).toContain("ids");
        expect(schema.additionalProperties).toBe(false);
        expect(schema.properties.ids).toEqual({
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { type: "string", minLength: 1 }
        });
      }
    });

    it("accepts a non-empty ids array and rejects an empty one, unknown props, and a non-array ids", () => {
      for (const command of BATCH_COMMANDS) {
        expect(validate(command, { ids: ["a", "b"] }).ok, command).toBe(true);
        expect(validate(command, { ids: [] }).ok, `${command} empty ids`).toBe(false);
        expect(validate(command, {}).ok, `${command} missing ids`).toBe(false);
        expect(validate(command, { ids: "a" }).ok, `${command} non-array ids`).toBe(false);
        expect(validate(command, { ids: ["a"], bogus: 1 }).ok, `${command} unknown prop`).toBe(false);
      }
    });

    it("carries include on actor/item get-many but NOT on journal/scene/macro/playlist/table get-many", () => {
      expect(COMMAND_DEFINITIONS["actor.get-many"].paramsSchema.properties.include).toEqual({
        type: "array",
        items: { type: "string", enum: ["flags", "effects", "items.flags", "items.effects", "prepared"] }
      });
      expect(COMMAND_DEFINITIONS["item.get-many"].paramsSchema.properties.include).toEqual({
        type: "array",
        items: { type: "string", enum: ["flags", "effects"] }
      });

      for (const command of [
        "journal.get-many",
        "scene.get-many",
        "macro.get-many",
        "playlist.get-many",
        "table.get-many"
      ]) {
        expect(
          /** @type {Record<string, unknown>} */ (COMMAND_DEFINITIONS[command].paramsSchema.properties)
            .include
        ).toBeUndefined();
        expect(validate(command, { ids: ["a"], include: ["flags"] }).ok).toBe(false);
      }
    });
  });

  it("gates exactly the expected set of commands as GM-only writes", () => {
    const EXPECTED_WRITE_COMMANDS = [
      "scene.create",
      "scene.update",
      "scene.delete",
      "scene.clone",

      "scene.thumbnail.generate",
      "scene.fog.reset",
      "scene.token.create",
      "scene.token.update",
      "scene.token.delete",
      "scene.token.clone",
      "scene.token.item.create",
      "scene.token.item.update",
      "scene.token.item.delete",
      "scene.token.item.clone",
      "scene.token.effect.create",
      "scene.token.effect.update",
      "scene.token.effect.delete",
      "scene.token.effect.clone",
      "scene.token.item.effect.create",
      "scene.token.item.effect.update",
      "scene.token.item.effect.delete",
      "scene.token.item.effect.clone",
      "scene.tile.create",
      "scene.tile.update",
      "scene.tile.delete",
      "scene.tile.clone",
      "scene.sound.create",
      "scene.sound.update",
      "scene.sound.delete",
      "scene.sound.clone",
      "scene.wall.create",
      "scene.wall.update",
      "scene.wall.delete",
      "scene.wall.clone",

      "scene.wall.create-many",
      "scene.wall.update-many",
      "scene.wall.delete-many",
      "scene.token.create-many",
      "scene.token.update-many",
      "scene.token.delete-many",
      "scene.tile.create-many",
      "scene.tile.update-many",
      "scene.tile.delete-many",
      "scene.sound.create-many",
      "scene.sound.update-many",
      "scene.sound.delete-many",
      "scene.note.create-many",
      "scene.note.update-many",
      "scene.note.delete-many",

      "scene.drawing.create-many",
      "scene.drawing.update-many",
      "scene.drawing.delete-many",
      "scene.light.create-many",
      "scene.light.update-many",
      "scene.light.delete-many",
      "scene.template.create-many",
      "scene.template.update-many",
      "scene.template.delete-many",
      "scene.region.create-many",
      "scene.region.update-many",
      "scene.region.delete-many",

      "actor.effect.create-many",
      "actor.effect.update-many",
      "actor.effect.delete-many",
      "item.effect.create-many",
      "item.effect.update-many",
      "item.effect.delete-many",
      "actor.item.effect.create-many",
      "actor.item.effect.update-many",
      "actor.item.effect.delete-many",
      "scene.token.effect.create-many",
      "scene.token.effect.update-many",
      "scene.token.effect.delete-many",
      "scene.token.item.effect.create-many",
      "scene.token.item.effect.update-many",
      "scene.token.item.effect.delete-many",
      "item.update-many",
      "item.delete-many",
      "actor.update-many",
      "actor.delete-many",
      "journal.update-many",
      "journal.delete-many",
      "scene.note.create",
      "scene.note.update",
      "scene.note.delete",
      "scene.note.clone",
      "scene.drawing.create",
      "scene.drawing.update",
      "scene.drawing.delete",
      "scene.drawing.clone",
      "scene.light.create",
      "scene.light.update",
      "scene.light.delete",
      "scene.light.clone",
      "scene.template.create",
      "scene.template.update",
      "scene.template.delete",
      "scene.template.clone",
      "scene.region.create",
      "scene.region.update",
      "scene.region.delete",
      "scene.region.clone",

      "scene.region.behavior.create",
      "scene.region.behavior.update",
      "scene.region.behavior.delete",
      "scene.region.behavior.clone",
      "item.create",
      "item.update",
      "item.delete",
      "item.clone",
      "journal.create",
      "journal.update",
      "journal.delete",
      "journal.clone",
      "macro.create",
      "macro.update",
      "macro.delete",
      "macro.clone",
      "playlist.create",
      "playlist.update",
      "playlist.delete",
      "playlist.clone",
      "playlist.sound.create",
      "playlist.sound.update",
      "playlist.sound.delete",
      "playlist.sound.clone",
      "playlist.play",
      "playlist.stop",
      "playlist.playNext",
      "playlist.sound.play",
      "playlist.sound.stop",
      "chat.create",
      "chat.delete",
      "actor.create",
      "actor.update",
      "actor.delete",
      "actor.clone",
      "actor.item.create",
      "actor.item.update",
      "actor.item.delete",
      "actor.item.clone",
      "actor.item.import-from-compendium",
      "actor.effect.create",
      "actor.effect.update",
      "actor.effect.delete",
      "actor.effect.clone",
      "item.effect.create",
      "item.effect.update",
      "item.effect.delete",
      "item.effect.clone",
      "actor.item.effect.create",
      "actor.item.effect.update",
      "actor.item.effect.delete",
      "actor.item.effect.clone",

      "actor.import-from-compendium",
      "item.import-from-compendium",
      "journal.import-from-compendium",
      "scene.import-from-compendium",
      "macro.import-from-compendium",
      "playlist.import-from-compendium",
      "table.import-from-compendium",
      "cards.import-from-compendium",
      "folder.create",
      "folder.update",
      "folder.delete",
      "file.mkdir",
      "file.upload",
      "file.delete",
      "file.move",

      "actor.ownership.set",
      "item.ownership.set",
      "scene.ownership.set",
      "macro.ownership.set",
      "playlist.ownership.set",
      "journal.ownership.set",

      "journal.category.create",
      "journal.category.update",
      "journal.category.delete",

      "table.create",
      "table.update",
      "table.delete",
      "table.clone",
      "table.ownership.set",

      "table.result.create",
      "table.result.update",
      "table.result.delete",
      "table.result.clone",

      "table.draw",
      "table.reset",

      "cards.create",
      "cards.update",
      "cards.delete",
      "cards.clone",
      "cards.ownership.set",

      "cards.card.create",
      "cards.card.update",
      "cards.card.delete",
      "cards.card.clone",

      "cards.shuffle",
      "cards.reset",
      "cards.deal",
      "cards.draw",
      "cards.pass",

      "combat.create",
      "combat.update",
      "combat.delete",

      "combat.combatant.create",
      "combat.combatant.update",
      "combat.combatant.delete",
      "combat.group.create",
      "combat.group.update",
      "combat.group.delete",

      "combat.start",
      "combat.activate",
      "combat.next-turn",
      "combat.previous-turn",
      "combat.next-round",
      "combat.previous-round",
      "combat.reset-initiative",
      "combat.roll-initiative",
      "combat.set-initiative"
    ];

    expect([...WRITE_COMMANDS].sort()).toEqual([...EXPECTED_WRITE_COMMANDS].sort());

    for (const command of COMMAND_NAMES) {
      expect(isWriteCommand(command)).toBe(EXPECTED_WRITE_COMMANDS.includes(command));
    }
  });

  describe("schema keyword lint (validator support pin)", () => {
    const SUPPORTED_KEYWORDS = new Set([
      "oneOf",
      "const",
      "enum",
      "type",
      "minLength",

      "maxLength",
      "pattern",
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
      "required",
      "additionalProperties",
      "minProperties",
      "minItems",
      "items",
      "properties"
    ]);

    const ADVISORY_KEYWORDS = new Set(["maxItems"]);

    const ANNOTATION_KEYWORDS = new Set(["description"]);

    const EXPECTED_ADVISORY_PATHS = new Set([
      "actor.get-many.paramsSchema.properties.ids",
      "item.get-many.paramsSchema.properties.ids",
      "journal.get-many.paramsSchema.properties.ids",
      "scene.get-many.paramsSchema.properties.ids",
      "macro.get-many.paramsSchema.properties.ids",
      "playlist.get-many.paramsSchema.properties.ids",
      "table.get-many.paramsSchema.properties.ids",
      "cards.get-many.paramsSchema.properties.ids",
      "cards.pass.paramsSchema.properties.cardIds",

      "table.create.paramsSchema.properties.data.properties.results.items.properties.range",

      "table.result.create.paramsSchema.properties.data.properties.range",
      "table.result.update.paramsSchema.properties.patch.properties.range",
      "table.result.clone.paramsSchema.properties.patch.properties.range",

      ...BATCHED_FAMILIES.flatMap((family) => [
        `${family}.create-many.paramsSchema.properties.data`,
        `${family}.update-many.paramsSchema.properties.patches`,
        `${family}.delete-many.paramsSchema.properties.ids`
      ]),

      ...BATCH_UPDATE_DELETE_FAMILIES.flatMap((family) => [
        `${family}.update-many.paramsSchema.properties.patches`,
        `${family}.delete-many.paramsSchema.properties.ids`
      ])
    ]);

    const KNOWN_TYPES = new Set(["array", "boolean", "integer", "null", "number", "object", "string"]);

    function isPlainObject(value) {
      return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    function lintSchema(schema, path, violations, advisoryPaths) {
      if (!isPlainObject(schema)) {
        return;
      }

      for (const key of Object.keys(schema)) {
        if (ANNOTATION_KEYWORDS.has(key)) {
          continue;
        } else if (ADVISORY_KEYWORDS.has(key)) {
          advisoryPaths.push(path);
        } else if (!SUPPORTED_KEYWORDS.has(key)) {
          violations.push(`${path}: unsupported keyword "${key}"`);
        }
      }

      if ("type" in schema) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        for (const typeName of types) {
          if (!KNOWN_TYPES.has(typeName)) {
            violations.push(`${path}: unknown type "${String(typeName)}"`);
          }
        }
      }

      if ("pattern" in schema) {
        if (typeof schema.pattern !== "string") {
          violations.push(`${path}: pattern must be a string`);
        } else {
          try {
            new RegExp(schema.pattern, "u");
          } catch {
            violations.push(`${path}: pattern is not a valid unicode-mode regular expression`);
          }
        }
      }

      if (Array.isArray(schema.oneOf)) {
        for (const [index, variant] of schema.oneOf.entries()) {
          lintSchema(variant, `${path}.oneOf[${index}]`, violations, advisoryPaths);
        }
      }

      if (isPlainObject(schema.properties)) {
        for (const [name, subSchema] of Object.entries(schema.properties)) {
          lintSchema(subSchema, `${path}.properties.${name}`, violations, advisoryPaths);
        }
      }

      if (schema.items !== undefined) {
        lintSchema(schema.items, `${path}.items`, violations, advisoryPaths);
      }

      if (isPlainObject(schema.additionalProperties)) {
        lintSchema(schema.additionalProperties, `${path}.additionalProperties`, violations, advisoryPaths);
      }
    }

    const rootSchemas = [
      ...Object.entries(TRANSPORT_MESSAGE_SCHEMAS).map(([type, schema]) => [
        `TRANSPORT_MESSAGE_SCHEMAS[${type}]`,
        schema
      ]),
      ...Object.entries(DAEMON_OPERATION_DEFINITIONS).map(([operation, definition]) => [
        `${operation}.paramsSchema`,
        definition.paramsSchema
      ]),
      ...Object.entries(COMMAND_DEFINITIONS).map(([name, definition]) => [
        `${name}.paramsSchema`,
        definition.paramsSchema
      ])
    ];

    it("rejects a pattern that is not a string or cannot compile in unicode mode", () => {
      const violations = [];
      lintSchema({ type: "string", pattern: "^[a-z\\_]+$" }, "$", violations, []);
      lintSchema({ type: "string", pattern: /^[a-z]+$/ }, "$", violations, []);

      expect(violations).toEqual([
        "$: pattern is not a valid unicode-mode regular expression",
        "$: pattern must be a string"
      ]);
    });

    it("every protocol schema uses only validator-supported keywords and known type names", () => {
      const violations = [];
      const advisoryPaths = [];
      for (const [label, schema] of rootSchemas) {
        lintSchema(schema, label, violations, advisoryPaths);
      }

      expect(violations).toEqual([]);

      expect(new Set(advisoryPaths)).toEqual(EXPECTED_ADVISORY_PATHS);
    });

    it("keeps every command's params schema closed to unknown top-level fields", () => {
      expect(COMMAND_NAMES.length, "an empty registry would make this sweep vacuous").toBeGreaterThan(0);

      const openCommands = COMMAND_NAMES.filter(
        (command) => COMMAND_DEFINITIONS[command].paramsSchema.additionalProperties !== false
      );

      expect(
        openCommands,
        "these commands would accept unknown top-level params, including protected metadata"
      ).toEqual([]);
    });

    it("pins the top-level field set of every closed create/update payload from one table", () => {
      const canonical = collectPayloadSchemas().filter(
        (payload) =>
          !OPEN_PAYLOAD_FAMILIES.includes(payload.family) &&
          (payload.path.endsWith(".create.data") || payload.path.endsWith(".update.patch"))
      );

      expect(
        canonical.map((payload) => payload.path).sort(),
        "a closed family gained or lost a create/update verb: add or drop its EXPECTED_FAMILY_FIELDS entry"
      ).toEqual(Object.keys(EXPECTED_FAMILY_FIELDS).sort());

      for (const payload of canonical) {
        expect(Object.keys(payload.schema.properties).sort(), payload.path).toEqual(
          [...EXPECTED_FAMILY_FIELDS[payload.path]].sort()
        );
      }
    });

    it("splits every create/patch payload schema into the closed and open family taxonomies", () => {
      const payloads = collectPayloadSchemas();
      const openFamilies = [
        ...new Set(
          payloads.filter((payload) => payload.schema.additionalProperties === true).map((p) => p.family)
        )
      ].sort();

      expect(
        openFamilies,
        "a family moved between the closed and open taxonomies: docs/security.md and the sanitizer routes must follow"
      ).toEqual([...OPEN_PAYLOAD_FAMILIES].sort());

      for (const payload of payloads) {
        const open = OPEN_PAYLOAD_FAMILIES.includes(payload.family);
        expect(
          payload.schema.additionalProperties,
          `${payload.path} must be ${open ? "open (passthrough)" : "closed (additionalProperties:false)"}`
        ).toBe(open);
      }
    });

    it("rejects _id / _stats / ownership on every closed payload and passes them to the open ones", () => {
      const payloads = collectPayloadSchemas();
      const closed = payloads.filter((payload) => !OPEN_PAYLOAD_FAMILIES.includes(payload.family));
      const open = payloads.filter((payload) => OPEN_PAYLOAD_FAMILIES.includes(payload.family));

      expect(closed.map((payload) => payload.path).sort()).toEqual([...EXPECTED_CLOSED_PAYLOADS].sort());
      expect(open.length, "the open taxonomy must not be empty").toBeGreaterThan(0);

      for (const payload of closed) {
        const base = MUTATION_BASES[payload.command];
        expect(base, `missing test base for ${payload.command}`).toBeDefined();
        for (const [field, value] of Object.entries(PROTECTED_META_VALUES)) {
          expectRejected(
            payload.command,
            payload.inject(base, field, value),
            `${payload.errorPath}.${field} is not allowed`
          );
        }
      }

      for (const payload of open) {
        const base = MUTATION_BASES[payload.command];
        expect(base, `missing test base for ${payload.command}`).toBeDefined();
        for (const [field, value] of Object.entries(PROTECTED_META_VALUES)) {
          expectValid(payload.command, payload.inject(base, field, value));
        }
      }
    });
  });

  describe("user + ownership axis", () => {
    const OWNERSHIP_SET_COMMANDS = [
      "actor.ownership.set",
      "item.ownership.set",
      "scene.ownership.set",
      "macro.ownership.set",
      "playlist.ownership.set",
      "table.ownership.set",

      "cards.ownership.set",
      "journal.ownership.set"
    ];

    const ID_FIELD = {
      "actor.ownership.set": "actorId",
      "item.ownership.set": "itemId",
      "scene.ownership.set": "sceneId",
      "macro.ownership.set": "macroId",
      "playlist.ownership.set": "playlistId",
      "table.ownership.set": "tableId",
      "cards.ownership.set": "cardsId",
      "journal.ownership.set": "journalId"
    };

    it("the ownership WRITE surface is EXACTLY the .ownership.set commands (derived, not counted by hand)", () => {
      const derived = COMMAND_NAMES.filter((name) => name.endsWith(".ownership.set"));
      expect(
        derived.slice().sort(),
        "ownership families changed: update OWNERSHIP_SET_COMMANDS/ID_FIELD here AND the canonical rule in docs/security.md 'Document ownership' (plus the ownership mentions in docs/commands.md, skills/foundry-world-editor/SKILL.md, and the serializeOwnership block)"
      ).toEqual(OWNERSHIP_SET_COMMANDS.slice().sort());
      expect(derived).toHaveLength(8);

      for (const command of derived) expect(COMMAND_DEFINITIONS[command].mutation).toBe(true);

      for (const name of COMMAND_NAMES) {
        if (name.includes("ownership") && !name.endsWith(".ownership.set")) {
          throw new Error(`unexpected ownership command outside the .ownership.set family: ${name}`);
        }
      }
    });

    it("no same-file doc anchor points at a heading that does not exist (derived doc lint)", () => {
      const headingSlugsOf = (text) => {
        const slugs = new Set();
        const seen = new Map();
        let inFence = false;
        for (const line of text.split("\n")) {
          if (/^\s*(?:```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
          }
          if (inFence) continue;
          const heading = /^(#{1,6})\s+(.*)$/.exec(line);
          if (!heading) continue;
          const base = heading[2]
            .trim()
            .toLowerCase()
            .replace(/[^\w\s\-À-￿]/g, "")
            .replace(/\s/g, "-");
          const count = seen.get(base) ?? 0;
          seen.set(base, count + 1);
          slugs.add(count === 0 ? base : `${base}-${count}`);
        }
        return slugs;
      };

      expect([...headingSlugsOf("## Compendium Import Commands (`*.import-from-compendium`)")]).toEqual([
        "compendium-import-commands-import-from-compendium"
      ]);
      expect([...headingSlugsOf("### Dry run\n\n### Dry run\n\n### Dry run")]).toEqual([
        "dry-run",
        "dry-run-1",
        "dry-run-2"
      ]);

      expect([...headingSlugsOf("```\n## Not A Heading\n```")]).toEqual([]);

      const sameFileAnchorsOf = (line) =>
        [...line.replace(/`[^`]*`/g, "").matchAll(/\]\(#([^)\s]+)\)/g)].map((match) => match[1]);
      expect(sameFileAnchorsOf("see [x](#real-anchor) and `](#not-a-link)` here")).toEqual(["real-anchor"]);

      const DOCS = [
        "README.md",
        "CHANGELOG.md",
        ...execFileSync("git", ["ls-files", "docs"], {
          cwd: REPO_ROOT,
          encoding: "utf8"
        })
          .trim()
          .split("\n")
          .filter((file) => file.endsWith(".md"))
      ];
      const offenders = [];
      let linksChecked = 0;
      let filesChecked = 0;
      for (const file of DOCS) {
        let text;
        try {
          text = readFileSync(`${REPO_ROOT}/${file}`, "utf8");
        } catch {
          continue;
        }
        filesChecked += 1;
        const slugs = headingSlugsOf(text);
        let inFence = false;
        text.split("\n").forEach((line, index) => {
          if (/^\s*(?:```|~~~)/.test(line)) {
            inFence = !inFence;
            return;
          }
          if (inFence) return;
          for (const slug of sameFileAnchorsOf(line)) {
            linksChecked += 1;
            if (!slugs.has(slug)) {
              offenders.push(`${file}:${index + 1}: dead same-file anchor #${slug}`);
            }
          }
        });
      }
      expect(
        offenders,
        "a doc link points at a heading slug that does not exist — fix the anchor (a heading carrying punctuation such as `(`*.x`)` keeps it in the slug as words, and a repeated heading needs the `-1`/`-2` suffix)"
      ).toEqual([]);

      expect(filesChecked).toBeGreaterThanOrEqual(5);
    });

    it("exposes USER_NOT_FOUND in ERROR_CODES", () => {
      expect(ERROR_CODES.USER_NOT_FOUND).toBe("USER_NOT_FOUND");
    });

    it("exposes PRECONDITION_FAILED in ERROR_CODES (wired by the combat advancement verbs)", () => {
      expect(ERROR_CODES.PRECONDITION_FAILED).toBe("PRECONDITION_FAILED");
    });

    it("declares the user.list / user.get read commands (mutation:false)", () => {
      expect(COMMAND_DEFINITIONS["user.list"].mutation).toBe(false);
      expect(COMMAND_DEFINITIONS["user.get"].mutation).toBe(false);
      expectValid("user.list", {});
      expectValid("user.list", { name: "hrelga", limit: 5, offset: 0 });
      expectValid("user.get", { userId: "user-1" });
      expectRejected("user.get", {}, "$.params.userId is required");
      expectRejected("user.get", { userId: "u", extra: 1 }, "$.params.extra is not allowed");
    });

    it("pins the six non-journal ownership.set level enum to 0..3 (no INHERIT)", () => {
      for (const command of OWNERSHIP_SET_COMMANDS.filter((c) => c !== "journal.ownership.set")) {
        const props = COMMAND_DEFINITIONS[command].paramsSchema.properties;
        expect(props.default.enum, `${command} default enum`).toEqual([0, 1, 2, 3]);
        expect(props.users.additionalProperties.enum, `${command} users level enum`).toEqual([0, 1, 2, 3]);
      }
    });

    it("pins the journal ownership.set level enum to -1..3 (page INHERIT) + pageId", () => {
      const props = /** @type {any} */ (COMMAND_DEFINITIONS["journal.ownership.set"].paramsSchema.properties);
      expect(props.default.enum).toEqual([-1, 0, 1, 2, 3]);
      expect(props.users.additionalProperties.enum).toEqual([-1, 0, 1, 2, 3]);
      expect(props.pageId).toEqual({ type: "string", minLength: 1 });
    });

    it("keeps every ownership.set schema CLOSED (rejects raw meta / unknown keys)", () => {
      for (const command of OWNERSHIP_SET_COMMANDS) {
        const idField = ID_FIELD[command];

        expectRejected(
          command,
          { [idField]: "x", ownership: { default: 2 } },
          "$.params.ownership is not allowed"
        );
        expectRejected(command, { [idField]: "x", _id: "y" }, "$.params._id is not allowed");
      }
    });

    it("accepts default and/or users on ownership.set, and rejects a bad level / empty users", () => {
      for (const command of OWNERSHIP_SET_COMMANDS) {
        const idField = ID_FIELD[command];
        expectValid(command, { [idField]: "x", default: 2 });
        expectValid(command, { [idField]: "x", users: { "user-1": 3 } });
        expectValid(command, { [idField]: "x", default: 0, users: { "user-1": 1 }, dryRun: true });

        expectRejected(command, { [idField]: "x", default: 5 }, "$.params.default must be one of");
        expectRejected(command, { [idField]: "x", users: { "user-1": 9 } }, "must be one of");

        expectRejected(command, { [idField]: "x", users: {} }, "at least 1 properties");
      }
    });

    it("accepts -1 (INHERIT) only on journal.ownership.set at the schema layer", () => {
      expectValid("journal.ownership.set", { journalId: "j-1", pageId: "p-1", default: -1 });

      for (const command of OWNERSHIP_SET_COMMANDS.filter((c) => c !== "journal.ownership.set")) {
        const idField = ID_FIELD[command];
        expectRejected(command, { [idField]: "x", default: -1 }, "must be one of");
      }
    });
  });

  describe("settings read surface", () => {
    it("declares exactly two setting commands, both mutation:false", () => {
      expect(COMMAND_NAMES.filter((command) => command.startsWith("setting."))).toEqual([
        "setting.list",
        "setting.get"
      ]);
      expect(COMMAND_DEFINITIONS["setting.list"].mutation).toBe(false);
      expect(COMMAND_DEFINITIONS["setting.get"].mutation).toBe(false);
      expect(isWriteCommand("setting.list")).toBe(false);
      expect(isWriteCommand("setting.get")).toBe(false);
    });

    it("pins setting.list's key set: the name filter + pagination, nothing else", () => {
      const schema = /** @type {any} */ (COMMAND_DEFINITIONS["setting.list"].paramsSchema);
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual([]);
      expect(Object.keys(schema.properties).sort()).toEqual(["limit", "name", "offset"]);

      expect(schema.properties.dryRun).toBeUndefined();
      expect(schema.properties.idempotencyKey).toBeUndefined();

      expect(schema.properties.scope).toBeUndefined();
      expect(schema.properties.values).toBeUndefined();
      expect(validate("setting.list", { name: "token", limit: 5, offset: 10 }).ok).toBe(true);
      expectRejected("setting.list", { scope: "world" }, "$.params.scope is not allowed");
      expectRejected("setting.list", { name: "" }, "$.params.name must be at least 1 characters long");
    });

    it("pins setting.get's REQUIRED (namespace, key) pair and rejects a dotted id", () => {
      const schema = /** @type {any} */ (COMMAND_DEFINITIONS["setting.get"].paramsSchema);
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(["namespace", "key"]);
      expect(Object.keys(schema.properties).sort()).toEqual(["key", "namespace"]);
      expect(schema.properties.namespace).toEqual({ type: "string", minLength: 1 });
      expect(schema.properties.key).toEqual({ type: "string", minLength: 1 });
      const valid = validate("setting.get", { namespace: "core", key: "combatTrackerConfig" });
      expect(valid.ok).toBe(true);

      expectRejected("setting.get", { id: "core.time" }, "$.params.id is not allowed");
      expectRejected("setting.get", { namespace: "core" }, "$.params.key is required");
      expectRejected("setting.get", { key: "time" }, "$.params.namespace is required");
      expectRejected("setting.get", { namespace: "", key: "time" }, "$.params.namespace must be at least 1");

      for (const leak of [{ dryRun: true }, { limit: 1 }, { include: ["flags"] }]) {
        expectRejected("setting.get", { namespace: "core", key: "time", ...leak }, "is not allowed");
      }
    });

    it("exposes the three new setting error codes and keeps them distinct", () => {
      expect(ERROR_CODES.SETTING_NOT_FOUND).toBe("SETTING_NOT_FOUND");
      expect(ERROR_CODES.SETTING_READ_FAILED).toBe("SETTING_READ_FAILED");
      expect(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE).toBe("SETTING_VALUE_NOT_SERIALIZABLE");
      expect(ERROR_CODES.PAYLOAD_TOO_LARGE).toBe("PAYLOAD_TOO_LARGE");
      expect(new Set(Object.values(ERROR_CODES)).size).toBe(Object.keys(ERROR_CODES).length);
    });

    it("pins the value-walk bounds and mirrors them into the module", () => {
      expect(SETTING_VALUE_MAX_DEPTH).toBe(32);
      expect(SETTING_VALUE_MAX_NODES).toBe(20_000);
      expect(SETTING_VALUE_MAX_BYTES).toBe(256 * 1024);

      expect(moduleProtocol.SETTING_VALUE_MAX_DEPTH).toBe(SETTING_VALUE_MAX_DEPTH);
      expect(moduleProtocol.SETTING_VALUE_MAX_NODES).toBe(SETTING_VALUE_MAX_NODES);
      expect(moduleProtocol.SETTING_VALUE_MAX_BYTES).toBe(SETTING_VALUE_MAX_BYTES);

      expect(SETTING_VALUE_MAX_BYTES).toBeLessThan(DEFAULT_WS_MAX_PAYLOAD_BYTES);
    });
  });
  describe("world.search", () => {
    const expectSearchValid = (params) => expectValid("world.search", params);

    it("declares one search command, mutation:false, with no dryRun and no idempotencyKey", () => {
      expect(COMMAND_NAMES.filter((command) => command.endsWith(".search"))).toEqual(["world.search"]);
      expect(COMMAND_DEFINITIONS["world.search"].mutation).toBe(false);
      expect(isWriteCommand("world.search")).toBe(false);
      const schema = /** @type {any} */ (COMMAND_DEFINITIONS["world.search"].paramsSchema);
      expect(schema.properties.dryRun).toBeUndefined();
      expect(schema.properties.idempotencyKey).toBeUndefined();
    });

    it("pins the closed param set", () => {
      const schema = /** @type {any} */ (COMMAND_DEFINITIONS["world.search"].paramsSchema);
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(["query"]);
      expect(Object.keys(schema.properties).sort()).toEqual([
        "includeCompendia",
        "limit",
        "mode",
        "offset",
        "query",
        "source",
        "types"
      ]);
      expectSearchValid({ query: "goblin" });
      expectSearchValid({
        query: "goblin",
        mode: "name",
        types: ["Actor", "Item"],
        includeCompendia: true,
        source: "pack",
        limit: 100,
        offset: 40
      });
      expectRejected("world.search", { query: "goblin", name: "goblin" }, "$.params.name is not allowed");
      expectRejected("world.search", {}, "$.params.query is required");
    });

    it("bounds `query` at both ends — and the maxLength is genuinely ENFORCED, not advisory", () => {
      expect(SEARCH_QUERY_MIN_LENGTH).toBe(2);
      expect(SEARCH_QUERY_MAX_LENGTH).toBe(256);
      expectSearchValid({ query: "ab" });
      expectSearchValid({ query: "x".repeat(SEARCH_QUERY_MAX_LENGTH) });
      expectRejected("world.search", { query: "a" }, "$.params.query must be at least 2 characters long");
      expectRejected(
        "world.search",
        { query: "x".repeat(SEARCH_QUERY_MAX_LENGTH + 1) },
        "$.params.query must be at most 256 characters long"
      );

      expectRejected("world.search", { query: "🎲" }, "$.params.query must be at least 2 characters long");
      expectSearchValid({ query: "🎲🎲" });
      expectSearchValid({ query: "🎲".repeat(SEARCH_QUERY_MAX_LENGTH) });
      expectRejected(
        "world.search",
        { query: "🎲".repeat(SEARCH_QUERY_MAX_LENGTH + 1) },
        "$.params.query must be at most 256 characters long"
      );

      expectSearchValid({ query: "e\u0301" });

      expectRejected(
        "world.search",
        { query: "\ud83c" },
        "$.params.query must be at least 2 characters long"
      );
    });

    it("ships `mode` as the TWO-member enum, and any other value is INVALID_PARAMS naming both", () => {
      expect(SEARCH_MODES).toEqual(["name", "full"]);
      const schema = /** @type {any} */ (COMMAND_DEFINITIONS["world.search"].paramsSchema);
      expect(schema.properties.mode).toEqual({ type: "string", enum: ["name", "full"] });
      expectSearchValid({ query: "goblin", mode: "name" });
      expectSearchValid({ query: "goblin", mode: "full" });

      expect(schema.properties.mode.default).toBeUndefined();
      expectRejected(
        "world.search",
        { query: "goblin", mode: "text" },
        "$.params.mode must be one of name, full"
      );

      expectRejected("world.search", { query: "goblin", mode: "FULL" }, "must be one of name, full");
    });

    it("pins the `types` enum to the indexed set and rejects an unknown member", () => {
      expect([...SEARCH_INDEXED_TYPES]).toEqual([
        "Actor",
        "Item",
        "ActiveEffect",
        "JournalEntry",
        "JournalEntryPage",
        "JournalEntryCategory",
        "Scene",
        "Token",
        "Region",
        "RegionBehavior",
        "Macro",
        "Playlist",
        "PlaylistSound",
        "RollTable",
        "TableResult",
        "Cards",
        "Card",
        "Folder"
      ]);

      for (const excluded of [
        "Setting",
        "User",
        "ChatMessage",
        "FogExploration",
        "Combat",
        "Combatant",
        "CombatantGroup",
        "Wall",
        "Tile",
        "AmbientLight",
        "AmbientSound",
        "Drawing",
        "Note",
        "MeasuredTemplate",
        "Level",
        "ActorDelta",
        "Adventure"
      ]) {
        expect(SEARCH_INDEXED_TYPES, `${excluded} must never be indexable`).not.toContain(excluded);
      }

      expect(
        /** @type {any} */ (COMMAND_DEFINITIONS["world.search"].paramsSchema).properties.types.minItems
      ).toBe(1);
      expectRejected(
        "world.search",
        { query: "goblin", types: [] },
        "$.params.types must contain at least 1 items"
      );
      expectSearchValid({ query: "goblin", types: ["Actor"] });
      expectRejected("world.search", { query: "x", types: ["Setting"] }, "$.params.types[0] must be one of");
      expectRejected("world.search", { query: "x", types: ["ChatMessage"] }, "must be one of");
      expectRejected("world.search", { query: "x", types: "Actor" }, "$.params.types must be array");
    });

    it("pins `source` as an optional two-member enum with NO default", () => {
      expect(SEARCH_SOURCES).toEqual(["world", "pack"]);
      const schema = /** @type {any} */ (COMMAND_DEFINITIONS["world.search"].paramsSchema);
      expect(schema.properties.source).toEqual({ type: "string", enum: ["world", "pack"] });

      expect(schema.properties.source.default).toBeUndefined();
      expect(schema.required).not.toContain("source");
      expectRejected(
        "world.search",
        { query: "x", source: "compendium" },
        "$.params.source must be one of world, pack"
      );

      expect(SEARCH_RESULT_SOURCES).toEqual(["world", "compendium"]);

      expectSearchValid({ query: "xy", source: "pack", includeCompendia: true });
    });

    it("bounds `limit` at the protocol layer (unlike an advisory maxItems) and pins the handler default", () => {
      expect(SEARCH_RESULT_MAX_LIMIT).toBe(100);
      expect(SEARCH_RESULT_DEFAULT_LIMIT).toBe(20);
      expectSearchValid({ query: "xy", limit: SEARCH_RESULT_MAX_LIMIT });
      expectRejected("world.search", { query: "x", limit: 0 }, "$.params.limit must be >= 1");
      expectRejected(
        "world.search",
        { query: "x", limit: SEARCH_RESULT_MAX_LIMIT + 1 },
        "$.params.limit must be <= 100"
      );
      expectRejected("world.search", { query: "x", offset: -1 }, "$.params.offset must be >= 0");
    });

    it("exposes the two new error codes and keeps every code unique", () => {
      expect(ERROR_CODES.SEARCH_INDEX_OVERFLOW).toBe("SEARCH_INDEX_OVERFLOW");
      expect(ERROR_CODES.QUERY_TOO_BROAD).toBe("QUERY_TOO_BROAD");
      expect(new Set(Object.values(ERROR_CODES)).size).toBe(Object.keys(ERROR_CODES).length);
    });

    it("pins every search cap + the byte estimator, and mirrors them into the module", () => {
      expect(SEARCH_WORLD_INDEX_MAX_BYTES).toBe(32 * 1024 * 1024);
      expect(SEARCH_WORLD_INDEX_MAX_ENTRIES).toBe(100_000);
      expect(SEARCH_COMPENDIUM_INDEX_MAX_BYTES).toBe(48 * 1024 * 1024);
      expect(SEARCH_COMPENDIUM_INDEX_MAX_ENTRIES).toBe(300_000);
      expect(SEARCH_DOC_TEXT_MAX_CHARS).toBe(32_768);
      expect(SEARCH_SYSTEM_WALK_MAX_BYTES).toBe(8_192);
      expect(SEARCH_SYSTEM_WALK_MAX_NODES).toBe(2_000);
      expect(SEARCH_SYSTEM_WALK_MAX_DEPTH).toBe(8);
      expect(SEARCH_MAX_MATCHES).toBe(20_000);
      expect(SEARCH_SNIPPET_MAX_CHARS).toBe(240);
      expect(SEARCH_SNIPPET_MAX_MATCHES).toBe(5);
      expect(SEARCH_RESPONSE_MAX_BYTES).toBe(256 * 1024);
      for (const key of [
        "SEARCH_WORLD_INDEX_MAX_BYTES",
        "SEARCH_WORLD_INDEX_MAX_ENTRIES",
        "SEARCH_COMPENDIUM_INDEX_MAX_BYTES",
        "SEARCH_COMPENDIUM_INDEX_MAX_ENTRIES",
        "SEARCH_DOC_TEXT_MAX_CHARS",
        "SEARCH_SYSTEM_WALK_MAX_BYTES",
        "SEARCH_SYSTEM_WALK_MAX_NODES",
        "SEARCH_SYSTEM_WALK_MAX_DEPTH",
        "SEARCH_MAX_MATCHES",
        "SEARCH_SNIPPET_MAX_CHARS",
        "SEARCH_SNIPPET_MAX_MATCHES",
        "SEARCH_RESPONSE_MAX_BYTES",
        "SEARCH_RESULT_MAX_LIMIT",
        "SEARCH_RESULT_DEFAULT_LIMIT",
        "SEARCH_INDEX_BYTES_PER_ENTRY",
        "SEARCH_INDEX_BYTES_PER_CHAR"
      ]) {
        expect(moduleProtocol[key], `${key} must reach the module mirror`).toBe(
          /** @type {any} */ ({
            SEARCH_WORLD_INDEX_MAX_BYTES,
            SEARCH_WORLD_INDEX_MAX_ENTRIES,
            SEARCH_COMPENDIUM_INDEX_MAX_BYTES,
            SEARCH_COMPENDIUM_INDEX_MAX_ENTRIES,
            SEARCH_DOC_TEXT_MAX_CHARS,
            SEARCH_SYSTEM_WALK_MAX_BYTES,
            SEARCH_SYSTEM_WALK_MAX_NODES,
            SEARCH_SYSTEM_WALK_MAX_DEPTH,
            SEARCH_MAX_MATCHES,
            SEARCH_SNIPPET_MAX_CHARS,
            SEARCH_SNIPPET_MAX_MATCHES,
            SEARCH_RESPONSE_MAX_BYTES,
            SEARCH_RESULT_MAX_LIMIT,
            SEARCH_RESULT_DEFAULT_LIMIT,
            SEARCH_INDEX_BYTES_PER_ENTRY,
            SEARCH_INDEX_BYTES_PER_CHAR
          })[key]
        );
      }

      expect(estimateSearchIndexBytes(0, 0)).toBe(0);
      expect(estimateSearchIndexBytes(1, 100)).toBe(SEARCH_INDEX_BYTES_PER_ENTRY + 120);
      const fullModeEntriesAtByteCap = Math.floor(
        SEARCH_WORLD_INDEX_MAX_BYTES / (SEARCH_INDEX_BYTES_PER_ENTRY + SEARCH_INDEX_BYTES_PER_CHAR * 445.4)
      );
      expect(fullModeEntriesAtByteCap).toBeGreaterThan(48_000);
      expect(fullModeEntriesAtByteCap).toBeLessThan(48_600);
      expect(fullModeEntriesAtByteCap).toBeLessThan(SEARCH_WORLD_INDEX_MAX_ENTRIES);
      const nameModeEntriesAtByteCap = Math.floor(
        SEARCH_WORLD_INDEX_MAX_BYTES / (SEARCH_INDEX_BYTES_PER_ENTRY + SEARCH_INDEX_BYTES_PER_CHAR * 11.1)
      );
      expect(nameModeEntriesAtByteCap).toBeGreaterThan(SEARCH_WORLD_INDEX_MAX_ENTRIES);

      expect(SEARCH_RESPONSE_MAX_BYTES).toBeLessThan(DEFAULT_WS_MAX_PAYLOAD_BYTES);
    });

    it("pins the corpus-status enum and mirrors every search enum into the module", () => {
      expect(SEARCH_CORPUS_STATUSES).toEqual(["ready", "overflow"]);
      expect(moduleProtocol.SEARCH_MODES).toEqual([...SEARCH_MODES]);
      expect(moduleProtocol.SEARCH_SOURCES).toEqual([...SEARCH_SOURCES]);
      expect(moduleProtocol.SEARCH_RESULT_SOURCES).toEqual([...SEARCH_RESULT_SOURCES]);
      expect(moduleProtocol.SEARCH_CORPUS_STATUSES).toEqual([...SEARCH_CORPUS_STATUSES]);
      expect(moduleProtocol.SEARCH_INDEXED_TYPES).toEqual([...SEARCH_INDEXED_TYPES]);
      expect(moduleProtocol.SEARCH_SNIPPET_FIELDS).toEqual([...SEARCH_SNIPPET_FIELDS]);
    });

    it("pins the snippet contract: the field enum, the radius and the two snippet caps", () => {
      expect(SEARCH_SNIPPET_FIELDS).toEqual(["text", "systemText", "name"]);
      expect(SEARCH_SNIPPET_RADIUS).toBe(60);

      expect(SEARCH_SNIPPET_MAX_CHARS).toBeGreaterThan(SEARCH_SNIPPET_RADIUS * 2 + 2);
      expect(moduleProtocol.SEARCH_SNIPPET_RADIUS).toBe(SEARCH_SNIPPET_RADIUS);

      expect(SEARCH_RESULT_MAX_LIMIT * SEARCH_SNIPPET_MAX_CHARS * 4).toBeLessThan(SEARCH_RESPONSE_MAX_BYTES);
    });
  });
});
