// @ts-nocheck
// Generated from packages/protocol/src by scripts/generate-protocol.mjs. Do not edit.
// The bundler strips the JSDoc that types the canonical source, so this copy is not type-checked.

// packages/protocol/src/constants.js
var PROTOCOL_VERSION = "1.1.0";
var PROTOCOL_COMPONENTS = Object.freeze({
  MODULE: "module",
  CLI_DAEMON: "cli-daemon",
  UNKNOWN: "unknown"
});
var PROTOCOL_HANDSHAKES = Object.freeze({
  CLI_DAEMON: "cli-daemon",
  MODULE_DAEMON: "module-daemon",
  COMMAND_REQUEST: "command-request",
  DAEMON_REQUEST: "daemon-request",
  UNKNOWN: "unknown"
});
var MODULE_ID = "fvtt-world-cli";
var MODULE_TITLE = "World CLI for Foundry VTT";
var DEFAULT_DAEMON_URL = "ws://127.0.0.1:47833";
var RECONNECT_BASE_DELAY_MS = 1e3;
var RECONNECT_MAX_DELAY_MS = 3e4;
var AUTH_FIRST_MESSAGE_TIMEOUT_MS = 5e3;
var PAIRING_REQUEST_TTL_MS = 5 * 60 * 1e3;
var PAIRING_PENDING_MAX = 10;
var AUTH_AWAIT_PARK_CAP_MS = 25e3;
var AUTH_PRUNE_DEFAULT_DAYS = 30;
function pairingPruneCutoffAt(olderThanDays, now = Date.now()) {
  return now - olderThanDays * 24 * 60 * 60 * 1e3;
}
var BRIDGE_LEASE_MS = 3e4;
var BRIDGE_TAKEOVER_CLOSE_CODE = 4001;
var BRIDGE_TAKEOVER_CLOSE_REASON = "Bridge session taken over by the same pairing";
var BRIDGE_RELEASE_CLOSE_CODE = 4002;
var BRIDGE_RELEASE_CLOSE_REASON = "Bridge released";
var APPROVAL_AWAIT_PARK_CAP_MS = 25e3;
var APPROVAL_RESULT_RETENTION_MS = 5 * 60 * 1e3;
var APPROVAL_PENDING_MAX = 20;
var APPROVAL_TIMEOUT_DEFAULT_MINUTES = 60;
var APPROVAL_TIMEOUT_MIN_MINUTES = 1;
var APPROVAL_TIMEOUT_MAX_MINUTES = 35791;
var POLICY_DISCOVERY_TIMEOUT_MS = 1500;
var CLIENT_ID_MIN_LENGTH = 8;
var CLIENT_ID_MAX_LENGTH = 64;
var CLIENT_ID_PATTERN = "^[0-9a-fA-F-]+$";
var CLIENT_LABEL_MAX_LENGTH = 64;
var CLIENT_LABEL_CHARACTER_CLASS = [
  "[^",
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
  "\\u{e0000}-\\u{e007f}",
  "]"
].join("");
var CLIENT_LABEL_CHARACTER_PATTERN = `^${CLIENT_LABEL_CHARACTER_CLASS}+$`;
var CLIENT_LABEL_PATTERN = `^(?=.*\\S)${CLIENT_LABEL_CHARACTER_CLASS}+$`;
var DEFAULT_UPLOAD_SIZE_LIMIT_BYTES = 100 * 1024 * 1024;
var UPLOAD_SIZE_LIMIT_MAX_BYTES = 512 * 1024 * 1024;
function wsMaxPayloadForUploadLimit(limitBytes) {
  return Math.ceil(limitBytes * 4 / 3) + 1024 * 1024;
}
var DEFAULT_WS_MAX_PAYLOAD_BYTES = wsMaxPayloadForUploadLimit(DEFAULT_UPLOAD_SIZE_LIMIT_BYTES);
function resolveEffectiveLimits(uploadLimitBytes = DEFAULT_UPLOAD_SIZE_LIMIT_BYTES) {
  return {
    uploadBytes: uploadLimitBytes,
    wsMaxPayloadBytes: Math.max(wsMaxPayloadForUploadLimit(uploadLimitBytes), DEFAULT_WS_MAX_PAYLOAD_BYTES)
  };
}
var BATCH_GET_MAX_IDS = 100;
var BATCH_WRITE_MAX_ITEMS = 100;
var BATCH_WRITE_STATUSES = Object.freeze([
  "created",
  "updated",
  "deleted",
  "unchanged",
  "alreadyDeleted",
  "dropped",
  "unknown"
]);
var BATCH_WRITE_SUCCESS_STATUSES = Object.freeze([
  "created",
  "updated",
  "deleted",
  "unchanged",
  "alreadyDeleted"
]);
var BATCH_WRITE_PERSISTED_STATUSES = Object.freeze(["created", "updated", "deleted"]);
var CARDS_PASS_MAX_IDS = 100;
var AUDIT_FILES_MAX_DIRS = 500;
var SCENE_THUMBNAIL_MIN_DIMENSION = 16;
var SCENE_THUMBNAIL_MAX_DIMENSION = 1024;
var SCENE_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
var SCENE_THUMBNAIL_RESPONSE_MAX_BYTES = 1024 * 1024;
var FOG_RESET_CONFIRM_TIMEOUT_MS = 5e3;
var FOG_RESET_CONFIRM_POLL_INTERVAL_MS = 250;
var TABLE_DRAW_MAX_COUNT = 100;
var SETTING_VALUE_MAX_DEPTH = 32;
var SETTING_VALUE_MAX_NODES = 2e4;
var SETTING_VALUE_MAX_BYTES = 256 * 1024;
var SEARCH_MODES = Object.freeze(["name", "full"]);
var SEARCH_SOURCES = Object.freeze(["world", "pack"]);
var SEARCH_SNIPPET_FIELDS = Object.freeze(["text", "systemText", "name"]);
var SEARCH_RESULT_SOURCES = Object.freeze(["world", "compendium"]);
var SEARCH_CORPUS_STATUSES = Object.freeze(["ready", "overflow"]);
var SEARCH_INDEXED_TYPES = Object.freeze([
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
var SEARCH_INDEX_BYTES_PER_ENTRY = 160;
var SEARCH_INDEX_BYTES_PER_CHAR = 1.2;
function estimateSearchIndexBytes(entryCount, indexedChars) {
  return SEARCH_INDEX_BYTES_PER_ENTRY * entryCount + SEARCH_INDEX_BYTES_PER_CHAR * indexedChars;
}
var SEARCH_WORLD_INDEX_MAX_BYTES = 32 * 1024 * 1024;
var SEARCH_WORLD_INDEX_MAX_ENTRIES = 1e5;
var SEARCH_COMPENDIUM_INDEX_MAX_BYTES = 48 * 1024 * 1024;
var SEARCH_COMPENDIUM_INDEX_MAX_ENTRIES = 3e5;
var SEARCH_DOC_TEXT_MAX_CHARS = 32768;
var SEARCH_SYSTEM_WALK_MAX_BYTES = 8192;
var SEARCH_SYSTEM_WALK_MAX_NODES = 2e3;
var SEARCH_SYSTEM_WALK_MAX_DEPTH = 8;
var SEARCH_MAX_MATCHES = 2e4;
var SEARCH_SNIPPET_MAX_CHARS = 240;
var SEARCH_SNIPPET_MAX_MATCHES = 5;
var SEARCH_SNIPPET_RADIUS = 60;
var SEARCH_QUERY_MIN_LENGTH = 2;
var SEARCH_QUERY_MAX_LENGTH = 256;
var SEARCH_RESULT_MAX_LIMIT = 100;
var SEARCH_RESULT_DEFAULT_LIMIT = 20;
var SEARCH_RESPONSE_MAX_BYTES = 256 * 1024;
var MESSAGE_TYPES = Object.freeze({
  CLIENT_HELLO: "client.hello",
  CLIENT_HELLO_ACK: "client.hello.ack",
  PAIRING_REQUEST: "pairing.request",
  PAIRING_PENDING: "pairing.pending",
  PAIRING_RESULT: "pairing.result",
  DAEMON_REQUEST: "daemon.request",
  DAEMON_RESPONSE: "daemon.response",
  BRIDGE_HELLO: "bridge.hello",
  BRIDGE_HELLO_ACK: "bridge.hello.ack",
  BRIDGE_GOODBYE: "bridge.goodbye",
  COMMAND_REQUEST: "command.request",
  COMMAND_RESPONSE: "command.response"
});
var ERROR_CODES = Object.freeze({
  ACTOR_NOT_FOUND: "ACTOR_NOT_FOUND",
  DAEMON_UNAVAILABLE: "DAEMON_UNAVAILABLE",
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  INVALID_MESSAGE: "INVALID_MESSAGE",
  INVALID_PARAMS: "INVALID_PARAMS",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  ITEM_NOT_FOUND: "ITEM_NOT_FOUND",
  JOURNAL_NOT_FOUND: "JOURNAL_NOT_FOUND",
  MACRO_NOT_FOUND: "MACRO_NOT_FOUND",
  PATH_NOT_ALLOWED: "PATH_NOT_ALLOWED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  SCENE_NOT_FOUND: "SCENE_NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  UNKNOWN_COMMAND: "UNKNOWN_COMMAND",
  UNSUPPORTED_PROTOCOL_VERSION: "UNSUPPORTED_PROTOCOL_VERSION",
  BRIDGE_NOT_READY: "BRIDGE_NOT_READY",
  BRIDGE_TIMEOUT: "BRIDGE_TIMEOUT",
  BRIDGE_DISCONNECTED: "BRIDGE_DISCONNECTED",
  DELETE_FORBIDDEN: "DELETE_FORBIDDEN",
  TOKEN_NOT_FOUND: "TOKEN_NOT_FOUND",
  TILE_NOT_FOUND: "TILE_NOT_FOUND",
  SOUND_NOT_FOUND: "SOUND_NOT_FOUND",
  WALL_NOT_FOUND: "WALL_NOT_FOUND",
  NOTE_NOT_FOUND: "NOTE_NOT_FOUND",
  DRAWING_NOT_FOUND: "DRAWING_NOT_FOUND",
  LIGHT_NOT_FOUND: "LIGHT_NOT_FOUND",
  TEMPLATE_NOT_FOUND: "TEMPLATE_NOT_FOUND",
  REGION_NOT_FOUND: "REGION_NOT_FOUND",
  REGION_BEHAVIOR_NOT_FOUND: "REGION_BEHAVIOR_NOT_FOUND",
  COMPENDIUM_NOT_FOUND: "COMPENDIUM_NOT_FOUND",
  COMPENDIUM_ENTRY_NOT_FOUND: "COMPENDIUM_ENTRY_NOT_FOUND",
  IDEMPOTENCY_KEY_CONFLICT: "IDEMPOTENCY_KEY_CONFLICT",
  EFFECT_NOT_FOUND: "EFFECT_NOT_FOUND",
  PLAYLIST_NOT_FOUND: "PLAYLIST_NOT_FOUND",
  PLAYLIST_SOUND_NOT_FOUND: "PLAYLIST_SOUND_NOT_FOUND",
  JOURNAL_CATEGORY_NOT_FOUND: "JOURNAL_CATEGORY_NOT_FOUND",
  CHAT_MESSAGE_NOT_FOUND: "CHAT_MESSAGE_NOT_FOUND",
  TABLE_NOT_FOUND: "TABLE_NOT_FOUND",
  TABLE_RESULT_NOT_FOUND: "TABLE_RESULT_NOT_FOUND",
  COMBAT_NOT_FOUND: "COMBAT_NOT_FOUND",
  COMBAT_SCENE_MISMATCH: "COMBAT_SCENE_MISMATCH",
  COMBAT_NOT_STARTED: "COMBAT_NOT_STARTED",
  COMBAT_STATE_DIVERGED: "COMBAT_STATE_DIVERGED",
  COMBATANT_NOT_FOUND: "COMBATANT_NOT_FOUND",
  COMBATANT_GROUP_NOT_FOUND: "COMBATANT_GROUP_NOT_FOUND",
  CARDS_NOT_FOUND: "CARDS_NOT_FOUND",
  CARD_NOT_FOUND: "CARD_NOT_FOUND",
  INSUFFICIENT_CARDS: "INSUFFICIENT_CARDS",
  FOLDER_NOT_FOUND: "FOLDER_NOT_FOUND",
  SETTING_NOT_FOUND: "SETTING_NOT_FOUND",
  SETTING_READ_FAILED: "SETTING_READ_FAILED",
  SETTING_VALUE_NOT_SERIALIZABLE: "SETTING_VALUE_NOT_SERIALIZABLE",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  SEARCH_INDEX_OVERFLOW: "SEARCH_INDEX_OVERFLOW",
  QUERY_TOO_BROAD: "QUERY_TOO_BROAD",
  UNSUPPORTED_OPERATION: "UNSUPPORTED_OPERATION",
  FILE_ALREADY_EXISTS: "FILE_ALREADY_EXISTS",
  SCENE_NOT_VIEWED: "SCENE_NOT_VIEWED",
  THUMBNAIL_RENDER_FAILED: "THUMBNAIL_RENDER_FAILED",
  THUMBNAIL_UPLOAD_DENIED: "THUMBNAIL_UPLOAD_DENIED",
  FOG_RESET_UNCONFIRMED: "FOG_RESET_UNCONFIRMED",
  PRECONDITION_FAILED: "PRECONDITION_FAILED",
  PAIRING_REQUIRED: "PAIRING_REQUIRED",
  PAIRING_NOT_FOUND: "PAIRING_NOT_FOUND",
  PAIRING_EXPIRED: "PAIRING_EXPIRED",
  BRIDGE_BUSY: "BRIDGE_BUSY",
  COMMAND_DENIED: "COMMAND_DENIED",
  APPROVAL_PENDING: "APPROVAL_PENDING",
  APPROVAL_DENIED: "APPROVAL_DENIED",
  APPROVAL_TIMEOUT: "APPROVAL_TIMEOUT",
  APPROVAL_CANCELLED: "APPROVAL_CANCELLED",
  APPROVAL_QUEUE_FULL: "APPROVAL_QUEUE_FULL",
  APPROVAL_UNKNOWN: "APPROVAL_UNKNOWN"
});

// packages/protocol/src/schemas/shared.js
var cmd = (paramsSchema, { mutation = false, discovery = true } = {}) => ({
  mutation,
  ...discovery ? {} : { discovery: false },
  paramsSchema
});
function mergeCommandFamilies(families) {
  const merged = {};
  for (const family of families) {
    for (const [name, definition] of Object.entries(family)) {
      if (Object.hasOwn(merged, name)) throw new Error(`Duplicate command definition: ${name}`);
      merged[name] = definition;
    }
  }
  return merged;
}
var deepFrozen = /* @__PURE__ */ new WeakSet();
function deepFreeze(value) {
  if (value === null || typeof value !== "object" || deepFrozen.has(value)) return value;
  deepFrozen.add(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}
var patchFrom = (createSchema, { omit = [], prepend = {} } = {}) => ({
  type: "object",
  required: [],
  properties: {
    ...prepend,
    ...Object.fromEntries(Object.entries(createSchema.properties).filter(([field]) => !omit.includes(field)))
  },
  additionalProperties: false,
  minProperties: 1
});
var emptyObjectSchema = {
  type: "object",
  required: [],
  properties: {},
  additionalProperties: false
};
var paginationProperties = {
  limit: { type: "integer", minimum: 1 },
  offset: { type: "integer", minimum: 0 }
};
var paginatedListSchema = {
  type: "object",
  required: [],
  properties: { ...paginationProperties },
  additionalProperties: false
};
var nameFilterProperty = {
  name: { type: "string", minLength: 1 }
};
var nameFilteredListSchema = {
  type: "object",
  required: [],
  properties: { ...nameFilterProperty, ...paginationProperties },
  additionalProperties: false
};
var dryRunProperty = {
  dryRun: { type: "boolean" }
};
var includeProperty = {
  include: { type: "array", items: { type: "string", enum: ["flags", "effects"] } }
};
var actorIncludeProperty = {
  include: {
    type: "array",
    items: { type: "string", enum: ["flags", "effects", "items.flags", "items.effects", "prepared"] }
  }
};
var batchIdsProperty = {
  ids: {
    type: "array",
    minItems: 1,
    maxItems: BATCH_GET_MAX_IDS,
    items: { type: "string", minLength: 1 }
  }
};
var tokenIncludeProperty = {
  include: { type: "array", items: { type: "string", enum: ["prepared"] } }
};
var compendiumIncludeProperty = {
  include: { type: "array", items: { type: "string", enum: ["effects"] } }
};
var idempotencyKeyProperty = {
  idempotencyKey: { type: "string", minLength: 1 }
};
function batchCreateManyProperties(itemSchema) {
  return {
    data: {
      type: "array",
      minItems: 1,
      maxItems: BATCH_WRITE_MAX_ITEMS,
      items: itemSchema
    }
  };
}
function batchUpdateManyProperties(patchSchema) {
  return {
    patches: {
      type: "array",
      minItems: 1,
      maxItems: BATCH_WRITE_MAX_ITEMS,
      items: {
        type: "object",
        required: ["id", "patch"],
        properties: {
          id: { type: "string", minLength: 1 },
          patch: patchSchema
        },
        additionalProperties: false
      }
    }
  };
}
var batchDeleteManyProperties = {
  ids: {
    type: "array",
    minItems: 1,
    maxItems: BATCH_WRITE_MAX_ITEMS,
    items: { type: "string", minLength: 1 }
  }
};
function batchWriteCommands(prefix, {
  scopeProperties,
  createSchema,
  patchSchema,
  verbs = ["create-many", "update-many", "delete-many"],
  extraProperties = {}
}) {
  const scopeKeys = Object.keys(scopeProperties);
  const build = (suffix, required, properties) => cmd(
    {
      type: "object",
      required: [...scopeKeys, required],
      properties: {
        ...scopeProperties,
        ...properties,
        ...extraProperties[suffix] ?? {},
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  );
  const builders = {
    "create-many": () => {
      if (!createSchema) {
        throw new Error(
          `${prefix}.create-many needs a createSchema: without it every element is unvalidated`
        );
      }
      return build("create-many", "data", batchCreateManyProperties(createSchema));
    },
    "update-many": () => {
      if (!patchSchema) {
        throw new Error(`${prefix}.update-many needs a patchSchema: without it no element patch is accepted`);
      }
      return build("update-many", "patches", batchUpdateManyProperties(patchSchema));
    },
    "delete-many": () => build("delete-many", "ids", batchDeleteManyProperties)
  };
  return Object.fromEntries(verbs.map((suffix) => [`${prefix}.${suffix}`, builders[suffix]()]));
}
var sceneScopeProperties = { sceneId: { type: "string", minLength: 1 } };
var emptyScopeProperties = {};
var actorScopeProperties = { actorId: { type: "string", minLength: 1 } };
var itemScopeProperties = { itemId: { type: "string", minLength: 1 } };
var actorItemScopeProperties = {
  actorId: { type: "string", minLength: 1 },
  itemId: { type: "string", minLength: 1 }
};
var sceneTokenScopeProperties = {
  sceneId: { type: "string", minLength: 1 },
  tokenId: { type: "string", minLength: 1 }
};
var sceneTokenItemScopeProperties = {
  sceneId: { type: "string", minLength: 1 },
  tokenId: { type: "string", minLength: 1 },
  itemId: { type: "string", minLength: 1 }
};
var nullableStringSchema = {
  type: ["string", "null"]
};
var freeformObjectSchema = {
  type: "object",
  required: [],
  properties: {},
  additionalProperties: true
};
function compendiumImportSchema(patchSchema) {
  return {
    type: "object",
    required: ["pack", "entryId"],
    properties: {
      pack: { type: "string", minLength: 1 },
      entryId: { type: "string", minLength: 1 },
      folder: nullableStringSchema,
      patch: patchSchema,
      ...dryRunProperty,
      ...idempotencyKeyProperty
    },
    additionalProperties: false
  };
}

// packages/protocol/src/schemas/effect-data.js
var effectWriteProperties = {
  name: { type: "string", minLength: 1 },
  type: { type: "string", minLength: 1 },
  img: { type: "string", minLength: 1 },
  origin: nullableStringSchema,
  disabled: { type: "boolean" },
  transfer: { type: "boolean" },
  duration: freeformObjectSchema,
  changes: { type: "array", items: freeformObjectSchema },
  statuses: { type: "array", items: { type: "string", minLength: 1 } },
  tint: { type: "string", minLength: 1 },
  description: { type: "string" },
  sort: { type: "number" },
  system: freeformObjectSchema,
  flags: freeformObjectSchema
};
var effectCreateSchema = {
  type: "object",
  required: ["name"],
  properties: effectWriteProperties,
  additionalProperties: true
};
var effectPatchSchema = {
  type: "object",
  required: [],
  properties: effectWriteProperties,
  additionalProperties: true,
  minProperties: 1
};

// packages/protocol/src/schemas/item-data.js
var itemDataSchema = {
  type: "object",
  required: ["name", "type"],
  properties: {
    name: { type: "string", minLength: 1 },
    type: { type: "string", minLength: 1 },
    img: { type: "string", minLength: 1 },
    folder: nullableStringSchema,
    sort: { type: "number" },
    system: freeformObjectSchema,
    flags: freeformObjectSchema
  },
  additionalProperties: false
};
var itemPatchSchema = patchFrom(itemDataSchema, { omit: ["type"] });
var embeddedItemDataSchema = {
  type: "object",
  required: ["name", "type"],
  properties: {
    ...itemDataSchema.properties,
    effects: { type: "array", items: effectCreateSchema }
  },
  additionalProperties: false
};

// packages/protocol/src/schemas/ownership-users.js
var ownershipLevelSchema = { type: "integer", enum: [0, 1, 2, 3] };
var journalOwnershipLevelSchema = { type: "integer", enum: [-1, 0, 1, 2, 3] };
function ownershipUsersSchema(levelSchema) {
  return {
    type: "object",
    required: [],
    properties: {},
    additionalProperties: levelSchema,
    minProperties: 1
  };
}
function ownershipSetSchema(idField, { levelSchema, extraProperties = {} }) {
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
var userIdSchema = {
  type: "object",
  required: ["userId"],
  properties: { userId: { type: "string", minLength: 1 } },
  additionalProperties: false
};
var userCommands = {
  "user.list": cmd(nameFilteredListSchema),
  "user.get": cmd(userIdSchema)
};

// packages/protocol/src/schemas/actor.js
var actorDataSchema = {
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
var actorPatchSchema = patchFrom(actorDataSchema, { omit: ["type"] });
var actorCommands = {
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
var actorCompendiumImportCommands = {
  "actor.import-from-compendium": cmd(compendiumImportSchema(actorPatchSchema), { mutation: true })
};

// packages/protocol/src/schemas/approval.js
var approvalIdProperty = {
  approvalId: { type: "string", minLength: 22, maxLength: 22, pattern: "^[A-Za-z0-9_-]{22}$" }
};
var approvalAwaitSchema = {
  type: "object",
  required: ["approvalId"],
  properties: {
    ...approvalIdProperty,
    waitMs: { type: "integer", minimum: 0, maximum: APPROVAL_AWAIT_PARK_CAP_MS }
  },
  additionalProperties: false
};
var approvalCancelSchema = {
  type: "object",
  required: ["approvalId"],
  properties: { ...approvalIdProperty },
  additionalProperties: false
};
var approvalCommands = {
  "approval.await": cmd(approvalAwaitSchema, { discovery: false }),
  "approval.cancel": cmd(approvalCancelSchema, { discovery: false }),
  "policy.snapshot": cmd(emptyObjectSchema, { discovery: false })
};

// packages/protocol/src/schemas/cards.js
var cardBackSchema = {
  type: "object",
  required: [],
  properties: {
    name: { type: "string" },
    // blank:true, ABSENT when unset — no minLength
    text: { type: "string" },
    img: { type: ["string", "null"], minLength: 1 }
  },
  additionalProperties: false
};
var cardFaceSchema = {
  type: "object",
  required: [],
  properties: {
    name: { type: "string" },
    text: { type: "string" },
    img: { type: ["string", "null"], minLength: 1 }
  },
  additionalProperties: false
};
var cardCreateSchema = {
  type: "object",
  required: ["name"],
  // StringField blank:false with no initial (executed: "" and "   " rejected)
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    type: { type: "string", minLength: 1 },
    system: freeformObjectSchema,
    suit: { type: "string" },
    // blank IS legal in Foundry — no minLength (over-refusal otherwise)
    value: { type: ["number", "null"] },
    // a NumberField: "K" is rejected by Foundry itself
    back: cardBackSchema,
    faces: { type: "array", items: cardFaceSchema },
    face: { type: ["integer", "null"], minimum: 0 },
    // -1 silently clamps to face 0
    width: { type: ["integer", "null"], minimum: 1 },
    // v14 clamps 0/-2 to 1; v13 throws
    height: { type: ["integer", "null"], minimum: 1 },
    rotation: { type: "number", minimum: 0, exclusiveMaximum: 360 },
    sort: { type: "integer" },
    flags: freeformObjectSchema
    // NO `drawn`, NO `origin` (movement state — the action verbs only), NO `img` (derived getter)
  },
  additionalProperties: false
};
var cardPatchSchema = patchFrom(cardCreateSchema, { omit: ["type"] });
var cardsDataSchema = {
  type: "object",
  required: ["name", "type"],
  // `type` has NO initial — Foundry throws without it
  properties: {
    name: { type: "string", minLength: 1 },
    type: { type: "string", enum: ["deck", "hand", "pile"] },
    // bridge POLICY — see the note above
    description: { type: "string" },
    img: { type: ["string", "null"], minLength: 1 },
    // nullable, NOT blankable (--clear-img → null)
    system: freeformObjectSchema,
    width: { type: ["integer", "null"], minimum: 1 },
    height: { type: ["integer", "null"], minimum: 1 },
    rotation: { type: "number", minimum: 0, exclusiveMaximum: 360 },
    displayCount: { type: "boolean" },
    folder: { type: ["string", "null"], minLength: 1 },
    sort: { type: "integer" },
    flags: freeformObjectSchema,
    cards: { type: "array", items: cardCreateSchema }
  },
  additionalProperties: false
};
var cardsPatchSchema = patchFrom(cardsDataSchema, { omit: ["type", "cards"] });
var CARDS_DELETE_CHAT_STATUSES = deepFreeze(["dispatched", "unknown", "not-requested"]);
var CARDS_RECALL_STATUSES = deepFreeze(["not-executed", "confirmed", "unconfirmed", "not-verified"]);
var CARDS_RECALL_CONSEQUENCE_SCOPES = deepFreeze(["applied", "prospective", "unknown"]);
var CARDS_DRAW_MODES = deepFreeze(["top", "bottom", "random"]);
var CARDS_ACTION_CHAT_STATUSES = deepFreeze([
  "dispatched",
  "not-requested",
  "not-dispatched",
  "unknown"
]);
var CARDS_ACTION_MUTATION_OUTCOMES = deepFreeze(["committed", "partial", "unknown", "not-executed"]);
var CARDS_ACTION_RECONCILIATIONS = deepFreeze(["confirmed", "best-effort", "not-executed"]);
var cardsActionChatProperty = { chat: { type: "boolean" } };
var cardsMoveCountProperty = { count: { type: "integer", minimum: 1 } };
var cardsIdSchema = {
  type: "object",
  required: ["cardsId"],
  properties: { cardsId: { type: "string", minLength: 1 } },
  additionalProperties: false
};
var cardsCommands = {
  "cards.list": cmd(nameFilteredListSchema),
  "cards.get": cmd(cardsIdSchema),
  "cards.get-many": cmd({
    type: "object",
    required: ["ids"],
    properties: { ...batchIdsProperty },
    additionalProperties: false
  }),
  "cards.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: cardsDataSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.update": cmd(
    {
      type: "object",
      required: ["cardsId", "patch"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        patch: cardsPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.clone": cmd(
    {
      type: "object",
      required: ["cardsId"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        patch: cardsPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.import-from-compendium": cmd(compendiumImportSchema(cardsPatchSchema), { mutation: true }),
  "cards.delete": cmd(
    {
      type: "object",
      required: ["cardsId"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.ownership.set": cmd(ownershipSetSchema("cardsId", { levelSchema: ownershipLevelSchema }), {
    mutation: true
  }),
  "cards.shuffle": cmd(
    {
      type: "object",
      required: ["cardsId"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        ...cardsActionChatProperty,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.reset": cmd(
    {
      type: "object",
      required: ["cardsId"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        ...cardsActionChatProperty,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.deal": cmd(
    {
      type: "object",
      required: ["cardsId", "to", "idempotencyKey"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        to: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 }
        },
        ...cardsMoveCountProperty,
        how: { type: "string", enum: [...CARDS_DRAW_MODES] },
        ...cardsActionChatProperty,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.draw": cmd(
    {
      type: "object",
      required: ["cardsId", "from", "idempotencyKey"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        from: { type: "string", minLength: 1 },
        ...cardsMoveCountProperty,
        how: { type: "string", enum: [...CARDS_DRAW_MODES] },
        ...cardsActionChatProperty,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.pass": cmd(
    {
      type: "object",
      required: ["cardsId", "to", "cardIds", "idempotencyKey"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        to: { type: "string", minLength: 1 },
        cardIds: {
          type: "array",
          minItems: 1,
          maxItems: CARDS_PASS_MAX_IDS,
          items: { type: "string", minLength: 1 }
        },
        ...cardsActionChatProperty,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.card.list": cmd({
    type: "object",
    required: [],
    properties: {
      cardsId: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "cards.card.get": cmd({
    type: "object",
    required: ["cardsId", "cardId"],
    properties: {
      cardsId: { type: "string", minLength: 1 },
      cardId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  }),
  "cards.card.create": cmd(
    {
      type: "object",
      required: ["cardsId", "data"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        data: cardCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.card.update": cmd(
    {
      type: "object",
      required: ["cardsId", "cardId", "patch"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        cardId: { type: "string", minLength: 1 },
        patch: cardPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.card.clone": cmd(
    {
      type: "object",
      required: ["cardsId", "cardId"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        cardId: { type: "string", minLength: 1 },
        patch: cardPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "cards.card.delete": cmd(
    {
      type: "object",
      required: ["cardsId", "cardId"],
      properties: {
        cardsId: { type: "string", minLength: 1 },
        cardId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};

// packages/protocol/src/schemas/chat.js
var CHAT_CAPTURE_STATUSES = deepFreeze([
  "captured",
  "partial",
  "not-created",
  "not-requested",
  "unknown"
]);
var chatMessageCreateSchema = {
  type: "object",
  required: [],
  properties: {
    content: { type: "string" },
    speaker: freeformObjectSchema,
    whisper: { type: "array", items: { type: "string", minLength: 1 } },
    blind: { type: "boolean" },
    style: { type: "number", enum: [0, 1, 2, 3] },
    // CHAT_MESSAGE_STYLES (verified v13)
    flavor: { type: "string" },
    sound: { type: "string", minLength: 1 },
    flags: freeformObjectSchema
  },
  additionalProperties: false
};
var chatRollSchema = {
  type: "object",
  required: ["formula"],
  properties: {
    formula: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};
var chatMessageIdSchema = {
  type: "object",
  required: ["messageId"],
  properties: {
    messageId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};
var chatCommands = {
  "chat.list": cmd(paginatedListSchema),
  "chat.get": cmd(chatMessageIdSchema),
  "chat.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: chatMessageCreateSchema,
        roll: chatRollSchema,
        // OPTIONAL sibling of data (NOT a document field)
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

// packages/protocol/src/schemas/combat.js
var combatDataSchema = {
  type: "object",
  required: [],
  // every field has a working Foundry initial — `combat.create {}` is legal
  properties: {
    name: { type: "string" },
    // v14 only (module-gated); blank:true, initial "" → no minLength
    type: { type: "string", minLength: 1 },
    // NOT an enum — `choices` is a runtime function
    system: freeformObjectSchema,
    scene: { type: ["string", "null"], minLength: 1 },
    // bare 16-char id; "" would clean to null
    sort: { type: "integer" },
    flags: freeformObjectSchema
  },
  additionalProperties: false
};
var combatPatchSchema = patchFrom(combatDataSchema, { omit: ["type"] });
var combatIdSchema = {
  type: "object",
  required: ["combatId"],
  properties: { combatId: { type: "string", minLength: 1 } },
  additionalProperties: false
};
var combatExpectedStateProperties = {
  expectedRound: { type: "integer", minimum: 0 },
  expectedTurn: { type: ["integer", "null"], minimum: 0 }
};
var COMBAT_TRANSITIONS = deepFreeze(["none", "turn", "round"]);
var COMBAT_MUTATION_OUTCOMES = deepFreeze(["committed", "unknown", "not-executed"]);
var COMBAT_ROLL_MODES = deepFreeze(["public", "gm", "blind", "self"]);
var COMBAT_INITIATIVE_SELECTIONS = deepFreeze(["all", "npc"]);
var COMBAT_INITIATIVE_MODES = deepFreeze(["ids", ...COMBAT_INITIATIVE_SELECTIONS]);
function combatAdvanceSchema() {
  return {
    type: "object",
    required: ["combatId", "idempotencyKey"],
    properties: {
      combatId: { type: "string", minLength: 1 },
      ...combatExpectedStateProperties,
      ...dryRunProperty,
      ...idempotencyKeyProperty
    },
    additionalProperties: false
  };
}
function combatActionSchema() {
  return {
    type: "object",
    required: ["combatId"],
    properties: {
      combatId: { type: "string", minLength: 1 },
      ...dryRunProperty,
      ...idempotencyKeyProperty
    },
    additionalProperties: false
  };
}
var combatRollInitiativeSchema = {
  type: "object",
  required: ["combatId", "idempotencyKey"],
  properties: {
    combatId: { type: "string", minLength: 1 },
    combatantIds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    select: { type: "string", enum: [...COMBAT_INITIATIVE_SELECTIONS] },
    formula: { type: "string", minLength: 1 },
    rollMode: { type: "string", enum: [...COMBAT_ROLL_MODES] },
    ...dryRunProperty,
    ...idempotencyKeyProperty
  },
  additionalProperties: false
};
var combatSetInitiativeSchema = {
  type: "object",
  required: ["combatId", "combatantId", "initiative"],
  properties: {
    combatId: { type: "string", minLength: 1 },
    combatantId: { type: "string", minLength: 1 },
    initiative: { type: ["number", "null"] },
    ...dryRunProperty,
    ...idempotencyKeyProperty
  },
  additionalProperties: false
};
var combatantCreateSchema = {
  type: "object",
  required: [],
  // every field has a working Foundry initial — an EMPTY combatant is legal (executed)
  properties: {
    type: { type: "string", minLength: 1 },
    // NOT an enum — `choices` is a runtime function
    system: freeformObjectSchema,
    actorId: { type: ["string", "null"], minLength: 1 },
    tokenId: { type: ["string", "null"], minLength: 1 },
    sceneId: { type: ["string", "null"], minLength: 1 },
    name: { type: "string" },
    // faithful + blank-meaningful → deliberately NO minLength
    img: { type: ["string", "null"], minLength: 1 },
    // "" silently clears → minLength is the guard
    initiative: { type: ["number", "null"] },
    hidden: { type: "boolean" },
    defeated: { type: "boolean" },
    group: { type: ["string", "null"], minLength: 1 },
    // module checks it names a group of THIS combat
    roundJoined: { type: "integer", minimum: 1 },
    // v14 only (module-gated); 0/-3/null are clamped
    flags: freeformObjectSchema
  },
  additionalProperties: false
};
var combatantPatchSchema = patchFrom(combatantCreateSchema, { omit: ["type", "initiative"] });
var combatantGroupCreateSchema = {
  type: "object",
  required: [],
  // every field has a working initial — an unnamed empty group is legal (executed)
  properties: {
    type: { type: "string", minLength: 1 },
    system: freeformObjectSchema,
    name: { type: "string" },
    // faithful + blank-meaningful → no minLength
    img: { type: ["string", "null"], minLength: 1 },
    // same silent blank→null coercion as Combatant
    initiative: { type: ["number", "null"] },
    flags: freeformObjectSchema
    // `ownership` rejected by omission — read-only on combat.group.get, no setter.
  },
  additionalProperties: false
};
var combatantGroupPatchSchema = patchFrom(combatantGroupCreateSchema, { omit: ["type"] });
var combatantIdSchema = {
  type: "object",
  required: ["combatId", "combatantId"],
  properties: {
    combatId: { type: "string", minLength: 1 },
    combatantId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};
var combatantGroupIdSchema = {
  type: "object",
  required: ["combatId", "groupId"],
  properties: {
    combatId: { type: "string", minLength: 1 },
    groupId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};
var combatCommands = {
  "combat.list": cmd(paginatedListSchema),
  "combat.get": cmd(combatIdSchema),
  "combat.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: combatDataSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.update": cmd(
    {
      type: "object",
      required: ["combatId", "patch"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        patch: combatPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.delete": cmd(
    {
      type: "object",
      required: ["combatId"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.start": cmd(combatActionSchema(), { mutation: true }),
  "combat.activate": cmd(combatActionSchema(), { mutation: true }),
  "combat.next-turn": cmd(combatAdvanceSchema(), { mutation: true }),
  "combat.previous-turn": cmd(combatAdvanceSchema(), { mutation: true }),
  "combat.next-round": cmd(combatAdvanceSchema(), { mutation: true }),
  "combat.previous-round": cmd(combatAdvanceSchema(), { mutation: true }),
  "combat.reset-initiative": cmd(combatActionSchema(), { mutation: true }),
  "combat.roll-initiative": cmd(combatRollInitiativeSchema, { mutation: true }),
  "combat.set-initiative": cmd(combatSetInitiativeSchema, { mutation: true }),
  "combat.combatant.list": cmd({
    type: "object",
    required: ["combatId"],
    properties: {
      combatId: { type: "string", minLength: 1 },
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "combat.combatant.get": cmd(combatantIdSchema),
  "combat.combatant.create": cmd(
    {
      type: "object",
      required: ["combatId", "data"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        data: combatantCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.combatant.update": cmd(
    {
      type: "object",
      required: ["combatId", "combatantId", "patch"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        combatantId: { type: "string", minLength: 1 },
        patch: combatantPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.combatant.delete": cmd(
    {
      type: "object",
      required: ["combatId", "combatantId"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        combatantId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.group.list": cmd({
    type: "object",
    required: ["combatId"],
    properties: {
      combatId: { type: "string", minLength: 1 },
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "combat.group.get": cmd(combatantGroupIdSchema),
  "combat.group.create": cmd(
    {
      type: "object",
      required: ["combatId", "data"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        data: combatantGroupCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.group.update": cmd(
    {
      type: "object",
      required: ["combatId", "groupId", "patch"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        groupId: { type: "string", minLength: 1 },
        patch: combatantGroupPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "combat.group.delete": cmd(
    {
      type: "object",
      required: ["combatId", "groupId"],
      properties: {
        combatId: { type: "string", minLength: 1 },
        groupId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};

// packages/protocol/src/schemas/compendium.js
var compendiumCommands = {
  "compendium.list": cmd(paginatedListSchema),
  "compendium.index": cmd({
    type: "object",
    required: ["pack"],
    properties: {
      pack: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      exact: { type: "boolean" },
      fields: { type: "array", items: { type: "string" } },
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "compendium.get": cmd({
    type: "object",
    required: ["pack", "entryId"],
    properties: {
      pack: { type: "string", minLength: 1 },
      entryId: { type: "string", minLength: 1 },
      ...compendiumIncludeProperty
    },
    additionalProperties: false
  })
};

// packages/protocol/src/schemas/file.js
var dataPathSchema = {
  type: "string",
  minLength: 0
};
var nonEmptyDataPathSchema = {
  type: "string",
  minLength: 1
};
var fileEncodingSchema = {
  type: "string",
  enum: ["text", "base64"]
};
var AUDIT_FILE_SCOPES = deepFreeze([
  "scene",
  "actor",
  "item",
  "journal",
  "playlist",
  "macro",
  "table",
  "combat",
  "cards"
]);
var auditFilesSchema = {
  type: "object",
  required: [],
  properties: {
    scope: {
      type: "array",
      minItems: 1,
      items: { type: "string", enum: [...AUDIT_FILE_SCOPES] }
    },
    ...paginationProperties
  },
  additionalProperties: false
};
var fileCommands = {
  "file.list": cmd({
    type: "object",
    description: "List a data-source directory. Default: the single named directory (paginated via limit/offset). With recursive:true it walks subdirectories depth-first (pre-order) bounded by maxDepth (dirs at the boundary are listed but not descended) and maxEntries (a hard cap on returned entries; hitting it sets truncated:true + truncatedAt). In recursive mode limit/offset are ignored \u2014 maxEntries is the cap.",
    required: ["path"],
    properties: {
      path: dataPathSchema,
      recursive: { type: "boolean" },
      maxDepth: { type: "integer", minimum: 1, maximum: 10 },
      maxEntries: { type: "integer", minimum: 1, maximum: 2e3 },
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "file.stat": cmd({
    type: "object",
    required: ["path"],
    properties: {
      path: dataPathSchema
    },
    additionalProperties: false
  }),
  "file.read": cmd({
    type: "object",
    required: ["path", "encoding"],
    properties: {
      path: nonEmptyDataPathSchema,
      encoding: fileEncodingSchema
    },
    additionalProperties: false
  }),
  "file.mkdir": cmd(
    {
      type: "object",
      required: ["path"],
      properties: {
        path: nonEmptyDataPathSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "file.upload": cmd(
    {
      type: "object",
      description: "Upload a file to the Foundry data source. Size-capped: default 100 MiB raw (before base64), configurable up to 512 MiB via the daemon's uploadLimitBytes config key. An over-limit payload returns PAYLOAD_TOO_LARGE. Read the effective limit before a large upload via system.info result.limits.uploadBytes.",
      required: ["path", "contentBase64"],
      properties: {
        path: nonEmptyDataPathSchema,
        contentBase64: { type: "string", minLength: 1 },
        mimeType: { type: "string", minLength: 1 },
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "file.delete": cmd(
    {
      type: "object",
      required: ["path"],
      properties: {
        path: nonEmptyDataPathSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "file.move": cmd(
    {
      type: "object",
      required: ["from", "to"],
      properties: {
        from: nonEmptyDataPathSchema,
        to: nonEmptyDataPathSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};
var worldAuditCommands = {
  "world.audit-files": cmd(auditFilesSchema)
};

// packages/protocol/src/schemas/folder.js
var folderListSchema = {
  type: "object",
  required: [],
  properties: {
    type: { type: "string", minLength: 1 },
    ...nameFilterProperty,
    ...paginationProperties
  },
  additionalProperties: false
};
var folderSortingSchema = { type: "string", enum: ["a", "m"] };
var folderColorSchema = { type: ["string", "null"], minLength: 1 };
var folderMutableFields = {
  name: { type: "string", minLength: 1 },
  description: { type: "string" },
  color: folderColorSchema,
  sorting: folderSortingSchema,
  sort: { type: "number" },
  folder: nullableStringSchema,
  flags: freeformObjectSchema
};
var folderCreateSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["name", "type"],
      properties: {
        ...folderMutableFields,
        type: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    ...dryRunProperty,
    ...idempotencyKeyProperty
  },
  additionalProperties: false
};
var folderUpdateSchema = {
  type: "object",
  required: ["folderId", "patch"],
  properties: {
    folderId: { type: "string", minLength: 1 },
    patch: {
      type: "object",
      required: [],
      properties: { ...folderMutableFields },
      additionalProperties: false,
      minProperties: 1
    },
    ...dryRunProperty
  },
  additionalProperties: false
};
var folderDeleteSchema = {
  type: "object",
  required: ["folderId"],
  properties: {
    folderId: { type: "string", minLength: 1 },
    deleteSubfolders: { type: "boolean" },
    deleteContents: { type: "boolean" },
    force: { type: "boolean" },
    ...dryRunProperty,
    ...idempotencyKeyProperty
  },
  additionalProperties: false
};
var folderIdSchema = {
  type: "object",
  required: ["folderId"],
  properties: {
    folderId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};
var folderCommands = {
  "folder.list": cmd(folderListSchema),
  "folder.get": cmd(folderIdSchema),
  "folder.create": cmd(folderCreateSchema, { mutation: true }),
  "folder.update": cmd(folderUpdateSchema, { mutation: true }),
  "folder.delete": cmd(folderDeleteSchema, { mutation: true })
};

// packages/protocol/src/schemas/item.js
var itemCommands = {
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

// packages/protocol/src/schemas/journal.js
var journalIdSchema = {
  type: "object",
  required: ["journalId"],
  properties: {
    journalId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};
var journalPageTextSchema = {
  type: "object",
  required: [],
  properties: {
    content: { type: "string" },
    markdown: { type: "string" },
    format: { type: "number", enum: [1, 2] }
  },
  additionalProperties: false,
  minProperties: 1
};
var journalPageTitleSchema = {
  type: "object",
  required: [],
  properties: {
    show: { type: "boolean" },
    level: { type: "integer", minimum: 1, maximum: 6 }
  },
  additionalProperties: false,
  minProperties: 1
};
var journalPageImageSchema = {
  type: "object",
  required: [],
  properties: {
    caption: { type: "string" }
  },
  additionalProperties: false,
  minProperties: 1
};
var journalPageVideoSchema = {
  type: "object",
  required: [],
  properties: {
    controls: { type: "boolean" },
    loop: { type: "boolean" },
    autoplay: { type: "boolean" },
    volume: { type: "number", minimum: 0, maximum: 1 },
    timestamp: { type: ["number", "null"], minimum: 0 },
    width: { type: ["integer", "null"], exclusiveMinimum: 0 },
    height: { type: ["integer", "null"], exclusiveMinimum: 0 }
  },
  additionalProperties: false,
  minProperties: 1
};
var journalPageCreateSchema = {
  type: "object",
  required: ["name", "type"],
  properties: {
    name: { type: "string", minLength: 1 },
    type: { type: "string", minLength: 1 },
    sort: { type: "number" },
    text: journalPageTextSchema,
    title: journalPageTitleSchema,
    image: journalPageImageSchema,
    video: journalPageVideoSchema,
    src: { type: "string", minLength: 1 },
    category: nullableStringSchema,
    system: freeformObjectSchema,
    flags: freeformObjectSchema
  },
  additionalProperties: false
};
var journalPagePatchSchema = patchFrom(journalPageCreateSchema, {
  prepend: { id: { type: "string", minLength: 1 } }
});
var journalDataSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    folder: nullableStringSchema,
    sort: { type: "number" },
    pages: {
      type: "array",
      items: journalPageCreateSchema
    },
    flags: freeformObjectSchema
  },
  additionalProperties: false
};
var journalPatchSchema = {
  type: "object",
  required: [],
  properties: {
    name: { type: "string", minLength: 1 },
    folder: nullableStringSchema,
    sort: { type: "number" },
    pages: {
      type: "array",
      items: journalPagePatchSchema,
      minItems: 1
    },
    deletePageIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1
    },
    flags: freeformObjectSchema
  },
  additionalProperties: false,
  minProperties: 1
};
var journalCategoryCreateSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string" },
    sort: { type: "integer" },
    flags: freeformObjectSchema
  },
  additionalProperties: false
};
var journalCategoryPatchSchema = patchFrom(journalCategoryCreateSchema);
var journalCategoryIdSchema = {
  type: "object",
  required: ["journalId", "categoryId"],
  properties: {
    journalId: { type: "string", minLength: 1 },
    categoryId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};
var journalDocumentPatchSchema = {
  type: "object",
  required: [],
  properties: {
    name: { type: "string", minLength: 1 },
    folder: nullableStringSchema,
    sort: { type: "number" },
    flags: freeformObjectSchema
    // NO `pages` / `deletePageIds` — see the note above.
  },
  additionalProperties: false,
  minProperties: 1
};
var journalClonePatchSchema = {
  type: "object",
  required: [],
  properties: {
    name: { type: "string", minLength: 1 },
    folder: nullableStringSchema,
    sort: { type: "number" }
  },
  additionalProperties: false,
  minProperties: 1
};
var journalCommands = {
  "journal.list": cmd(nameFilteredListSchema),
  "journal.get": cmd(journalIdSchema),
  "journal.get-many": cmd({
    type: "object",
    required: ["ids"],
    properties: { ...batchIdsProperty },
    additionalProperties: false
  }),
  "journal.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: journalDataSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "journal.update": cmd(
    {
      type: "object",
      required: ["journalId", "patch"],
      properties: {
        journalId: { type: "string", minLength: 1 },
        patch: journalPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "journal.delete": cmd(
    {
      type: "object",
      required: ["journalId"],
      properties: {
        journalId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "journal.clone": cmd(
    {
      type: "object",
      required: ["journalId"],
      properties: {
        journalId: { type: "string", minLength: 1 },
        patch: journalClonePatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "journal.import-from-compendium": cmd(compendiumImportSchema(journalDocumentPatchSchema), {
    mutation: true
  }),
  "journal.ownership.set": cmd(
    ownershipSetSchema("journalId", {
      levelSchema: journalOwnershipLevelSchema,
      extraProperties: { pageId: { type: "string", minLength: 1 } }
    }),
    { mutation: true }
  ),
  ...batchWriteCommands("journal", {
    scopeProperties: emptyScopeProperties,
    patchSchema: journalDocumentPatchSchema,
    verbs: ["update-many", "delete-many"]
  }),
  "journal.category.list": cmd({
    type: "object",
    required: ["journalId"],
    properties: {
      journalId: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "journal.category.get": cmd(journalCategoryIdSchema),
  "journal.category.create": cmd(
    {
      type: "object",
      required: ["journalId", "data"],
      properties: {
        journalId: { type: "string", minLength: 1 },
        data: journalCategoryCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "journal.category.update": cmd(
    {
      type: "object",
      required: ["journalId", "categoryId", "patch"],
      properties: {
        journalId: { type: "string", minLength: 1 },
        categoryId: { type: "string", minLength: 1 },
        patch: journalCategoryPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "journal.category.delete": cmd(
    {
      type: "object",
      required: ["journalId", "categoryId"],
      properties: {
        journalId: { type: "string", minLength: 1 },
        categoryId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};

// packages/protocol/src/schemas/macro.js
var macroTypeSchema = { type: "string", enum: ["script", "chat"] };
var macroScopeSchema = { type: "string", enum: ["global", "actors", "actor"] };
var macroDataSchema = {
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
var macroPatchSchema = patchFrom(macroDataSchema);
var macroIdSchema = {
  type: "object",
  required: ["macroId"],
  properties: {
    macroId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};
var macroCommands = {
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
  "macro.import-from-compendium": cmd(compendiumImportSchema(macroPatchSchema), { mutation: true }),
  "macro.ownership.set": cmd(ownershipSetSchema("macroId", { levelSchema: ownershipLevelSchema }), {
    mutation: true
  })
};

// packages/protocol/src/schemas/playlist.js
var playlistSoundCreateSchema = {
  type: "object",
  required: ["path"],
  // name optional — Foundry derives it from path
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    path: { type: "string", minLength: 1 },
    channel: { type: ["string", "null"], enum: ["music", "environment", "interface", null] },
    playing: { type: "boolean" },
    pausedTime: { type: "number" },
    repeat: { type: "boolean" },
    volume: { type: "number" },
    // linear 0–1; scaling verified live
    fade: { type: "number" },
    sort: { type: "number" },
    flags: freeformObjectSchema
  },
  additionalProperties: false
};
var playlistSoundPatchSchema = patchFrom(playlistSoundCreateSchema);
var playlistSoundIdSchema = {
  type: "object",
  required: ["playlistId", "soundId"],
  properties: {
    playlistId: { type: "string", minLength: 1 },
    soundId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};
var playlistDataSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    mode: { type: "number", enum: [-1, 0, 1, 2] },
    // PLAYLIST_MODES (verified v13)
    playing: { type: "boolean" },
    fade: { type: "number" },
    channel: { type: "string", enum: ["music", "environment", "interface"] },
    // AUDIO_CHANNELS keys (verified v13)
    sorting: { type: "string", enum: ["a", "m"] },
    // PLAYLIST_SORT_MODES (verified v13)
    seed: { type: "number" },
    folder: nullableStringSchema,
    sort: { type: "number" },
    flags: freeformObjectSchema,
    sounds: { type: "array", items: playlistSoundCreateSchema }
  },
  additionalProperties: false
};
var playlistPatchSchema = patchFrom(playlistDataSchema, { omit: ["sounds"] });
var playlistIdSchema = {
  type: "object",
  required: ["playlistId"],
  properties: { playlistId: { type: "string", minLength: 1 } },
  additionalProperties: false
};
var playlistCommands = {
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

// packages/protocol/src/schemas/scene-embedded.js
var tokenWriteProperties = {
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
var tokenCreateSchema = {
  type: "object",
  required: [],
  properties: tokenWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var tokenPatchSchema = {
  type: "object",
  required: [],
  properties: tokenWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var tileWriteProperties = {
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
var tileCreateSchema = {
  type: "object",
  required: [],
  properties: tileWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var tilePatchSchema = {
  type: "object",
  required: [],
  properties: tileWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var soundWriteProperties = {
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
var soundCreateSchema = {
  type: "object",
  required: [],
  properties: soundWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var soundPatchSchema = {
  type: "object",
  required: [],
  properties: soundWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var wallWriteProperties = {
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
var wallCreateSchema = {
  type: "object",
  required: [],
  properties: wallWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var wallPatchSchema = {
  type: "object",
  required: [],
  properties: wallWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var noteWriteProperties = {
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
var noteCreateSchema = {
  type: "object",
  required: [],
  properties: noteWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var notePatchSchema = {
  type: "object",
  required: [],
  properties: noteWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var drawingWriteProperties = {
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
var drawingCreateSchema = {
  type: "object",
  required: [],
  properties: drawingWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var drawingPatchSchema = {
  type: "object",
  required: [],
  properties: drawingWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var lightWriteProperties = {
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
var lightCreateSchema = {
  type: "object",
  required: [],
  properties: lightWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var lightPatchSchema = {
  type: "object",
  required: [],
  properties: lightWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var templateWriteProperties = {
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
var templateCreateSchema = {
  type: "object",
  required: [],
  properties: templateWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var templatePatchSchema = {
  type: "object",
  required: [],
  properties: templateWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var regionWriteProperties = {
  name: { type: "string" },
  color: { type: "string" },
  shapes: { type: "array", items: freeformObjectSchema },
  elevation: freeformObjectSchema,
  behaviors: { type: "array", items: freeformObjectSchema },
  visibility: { type: "number" },
  locked: { type: "boolean" },
  flags: freeformObjectSchema
};
var regionCreateSchema = {
  type: "object",
  required: [],
  properties: regionWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var regionPatchSchema = {
  type: "object",
  required: [],
  properties: regionWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var regionBehaviorWriteProperties = {
  name: { type: "string" },
  disabled: { type: "boolean" },
  system: freeformObjectSchema,
  flags: freeformObjectSchema
};
var regionBehaviorCreateSchema = {
  type: "object",
  required: ["type"],
  properties: {
    type: { type: "string", minLength: 1 },
    ...regionBehaviorWriteProperties
  },
  additionalProperties: true
};
var regionBehaviorPatchSchema = {
  type: "object",
  required: [],
  properties: regionBehaviorWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
var sceneEmbeddedCommands = {
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
  )
};

// packages/protocol/src/schemas/scene.js
var sceneIdSchema = {
  type: "object",
  required: ["sceneId"],
  properties: {
    sceneId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};
var sceneBackgroundSchema = {
  type: "object",
  required: [],
  properties: {
    src: { type: "string", minLength: 1 },
    offsetX: { type: "number" },
    offsetY: { type: "number" },
    scaleX: { type: "number" },
    scaleY: { type: "number" },
    rotation: { type: "number" },
    tint: { type: "string", minLength: 1 }
  },
  additionalProperties: false,
  minProperties: 1
};
var sceneGridSchema = {
  type: "object",
  required: [],
  properties: {
    type: { type: "number" },
    size: { type: "number" },
    sizeX: { type: "number" },
    sizeY: { type: "number" },
    distance: { type: "number" },
    units: { type: "string" },
    style: { type: "string" },
    thickness: { type: "number" },
    color: { type: "string", minLength: 1 },
    alpha: { type: "number" },
    diagonals: { type: "number" }
  },
  additionalProperties: false,
  minProperties: 1
};
var sceneCreateSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    active: { type: "boolean" },
    navigation: { type: "boolean" },
    navOrder: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
    grid: sceneGridSchema,
    background: sceneBackgroundSchema,
    backgroundColor: { type: "string", minLength: 1 },
    tokenVision: { type: "boolean" },
    weather: nullableStringSchema,
    padding: { type: "number" },
    shiftX: { type: "number" },
    shiftY: { type: "number" },
    navName: nullableStringSchema,
    thumb: nullableStringSchema,
    sort: { type: "number" },
    initialLevel: nullableStringSchema,
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
var scenePatchSchema = patchFrom(sceneCreateSchema);
var sceneCommands = {
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
  "scene.ownership.set": cmd(ownershipSetSchema("sceneId", { levelSchema: ownershipLevelSchema }), {
    mutation: true
  })
};

// packages/protocol/src/schemas/search.js
var worldSearchSchema = {
  type: "object",
  required: ["query"],
  properties: {
    query: { type: "string", minLength: SEARCH_QUERY_MIN_LENGTH, maxLength: SEARCH_QUERY_MAX_LENGTH },
    mode: { type: "string", enum: [...SEARCH_MODES] },
    types: { type: "array", minItems: 1, items: { type: "string", enum: [...SEARCH_INDEXED_TYPES] } },
    includeCompendia: { type: "boolean" },
    source: { type: "string", enum: [...SEARCH_SOURCES] },
    limit: { type: "integer", minimum: 1, maximum: SEARCH_RESULT_MAX_LIMIT },
    offset: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
};
var worldSearchCommands = {
  "world.search": cmd(worldSearchSchema)
};

// packages/protocol/src/schemas/settings.js
var settingListSchema = {
  type: "object",
  required: [],
  properties: { ...nameFilterProperty, ...paginationProperties },
  additionalProperties: false
};
var settingGetSchema = {
  type: "object",
  required: ["namespace", "key"],
  properties: {
    namespace: { type: "string", minLength: 1 },
    key: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};
var settingCommands = {
  "setting.list": cmd(settingListSchema),
  "setting.get": cmd(settingGetSchema)
};

// packages/protocol/src/schemas/system.js
var systemCommands = {
  "system.ping": cmd(emptyObjectSchema),
  "system.info": cmd(emptyObjectSchema)
};

// packages/protocol/src/schemas/table.js
var tableResultCreateSchema = {
  type: "object",
  required: ["range"],
  // Foundry's own `initial: []` fails its min:2 — see the note above
  properties: {
    type: { type: "string", enum: ["text", "document"] },
    // TABLE_RESULT_TYPES (executed, v13+v14)
    name: { type: "string" },
    // blank:true, initial "" → NO minLength, not required
    img: { type: ["string", "null"], minLength: 1 },
    // nullable but not blankable (see above)
    description: { type: "string" },
    documentUuid: { type: ["string", "null"], minLength: 1 },
    // ditto — "" is silently DROPPED
    weight: { type: "integer", minimum: 1 },
    range: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      // advisory (validator ignores maxItems) — module-gated to exactly 2, ascending
      items: { type: "integer" }
    },
    drawn: { type: "boolean" },
    flags: freeformObjectSchema
  },
  additionalProperties: false
};
var tableResultPatchSchema = patchFrom(tableResultCreateSchema);
var tableResultIdSchema = {
  type: "object",
  required: ["tableId", "resultId"],
  properties: {
    tableId: { type: "string", minLength: 1 },
    resultId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};
var tableDataSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    // StringField blank:false (executed: "" is rejected)
    img: { type: ["string", "null"], minLength: 1 },
    // nullable, NOT blankable (--clear-img → null)
    description: { type: "string" },
    formula: { type: "string" },
    // NOT nullable
    replacement: { type: "boolean" },
    displayRoll: { type: "boolean" },
    folder: nullableStringSchema,
    sort: { type: "number" },
    flags: freeformObjectSchema,
    results: { type: "array", items: tableResultCreateSchema }
  },
  additionalProperties: false
};
var tablePatchSchema = patchFrom(tableDataSchema, { omit: ["results"] });
var tableIdSchema = {
  type: "object",
  required: ["tableId"],
  properties: { tableId: { type: "string", minLength: 1 } },
  additionalProperties: false
};
var TABLE_ROLL_MODES = deepFreeze(["public", "gm", "blind", "self"]);
var tableDrawSchema = {
  type: "object",
  required: ["tableId", "idempotencyKey"],
  properties: {
    tableId: { type: "string", minLength: 1 },
    count: { type: "integer", minimum: 1, maximum: TABLE_DRAW_MAX_COUNT },
    rollMode: { type: "string", enum: [...TABLE_ROLL_MODES] },
    chat: { type: "boolean" },
    // false = `displayChat:false` (CLI `--no-chat`)
    recursive: { type: "boolean" },
    // false = `recursive:false` (CLI `--no-recursive`)
    ...dryRunProperty,
    ...idempotencyKeyProperty
  },
  additionalProperties: false
};
var TABLE_MUTATION_OUTCOMES = deepFreeze(["committed", "unknown", "not-executed"]);
var tableCommands = {
  "table.list": cmd(nameFilteredListSchema),
  "table.get": cmd(tableIdSchema),
  "table.get-many": cmd({
    type: "object",
    required: ["ids"],
    properties: { ...batchIdsProperty },
    additionalProperties: false
  }),
  "table.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: tableDataSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.update": cmd(
    {
      type: "object",
      required: ["tableId", "patch"],
      properties: {
        tableId: { type: "string", minLength: 1 },
        patch: tablePatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.delete": cmd(
    {
      type: "object",
      required: ["tableId"],
      properties: {
        tableId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.clone": cmd(
    {
      type: "object",
      required: ["tableId"],
      properties: {
        tableId: { type: "string", minLength: 1 },
        patch: tablePatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.import-from-compendium": cmd(compendiumImportSchema(tablePatchSchema), { mutation: true }),
  "table.draw": cmd(tableDrawSchema, { mutation: true }),
  "table.reset": cmd(
    {
      type: "object",
      required: ["tableId"],
      properties: {
        tableId: { type: "string", minLength: 1 },
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.ownership.set": cmd(ownershipSetSchema("tableId", { levelSchema: ownershipLevelSchema }), {
    mutation: true
  }),
  "table.result.list": cmd({
    type: "object",
    required: [],
    properties: {
      tableId: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "table.result.get": cmd(tableResultIdSchema),
  "table.result.create": cmd(
    {
      type: "object",
      required: ["tableId", "data"],
      properties: {
        tableId: { type: "string", minLength: 1 },
        data: tableResultCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.result.update": cmd(
    {
      type: "object",
      required: ["tableId", "resultId", "patch"],
      properties: {
        tableId: { type: "string", minLength: 1 },
        resultId: { type: "string", minLength: 1 },
        patch: tableResultPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.result.delete": cmd(
    {
      type: "object",
      required: ["tableId", "resultId"],
      properties: {
        tableId: { type: "string", minLength: 1 },
        resultId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.result.clone": cmd(
    {
      type: "object",
      required: ["tableId", "resultId"],
      properties: {
        tableId: { type: "string", minLength: 1 },
        resultId: { type: "string", minLength: 1 },
        patch: tableResultPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};

// packages/protocol/src/commands.js
var COMMAND_DEFINITIONS = deepFreeze(
  mergeCommandFamilies([
    systemCommands,
    sceneCommands,
    sceneEmbeddedCommands,
    itemCommands,
    journalCommands,
    macroCommands,
    playlistCommands,
    tableCommands,
    combatCommands,
    cardsCommands,
    chatCommands,
    actorCommands,
    fileCommands,
    compendiumCommands,
    folderCommands,
    userCommands,
    settingCommands,
    actorCompendiumImportCommands,
    worldAuditCommands,
    worldSearchCommands,
    approvalCommands
  ])
);
var COMMAND_NAMES = deepFreeze(Object.keys(COMMAND_DEFINITIONS));
var WRITE_COMMANDS = deepFreeze(
  COMMAND_NAMES.filter((command) => COMMAND_DEFINITIONS[command].mutation === true)
);
var DISCOVERABLE_COMMAND_NAMES = deepFreeze(
  COMMAND_NAMES.filter((command) => COMMAND_DEFINITIONS[command].discovery !== false)
);
var REQUEST_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "id", "command", "params"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.COMMAND_REQUEST },
    id: { type: "string", minLength: 1 },
    command: { type: "string", enum: COMMAND_NAMES },
    params: { type: "object", required: [], properties: {}, additionalProperties: true }
  },
  additionalProperties: false
};
var protocolErrorSchema = {
  type: "object",
  required: ["code", "message"],
  properties: {
    code: { type: "string", minLength: 1 },
    message: { type: "string", minLength: 1 },
    details: { type: "object", required: [], properties: {}, additionalProperties: true }
  },
  additionalProperties: false
};
var limitsSchema = {
  type: "object",
  required: ["uploadBytes", "wsMaxPayloadBytes"],
  properties: {
    uploadBytes: { type: "integer", minimum: 1 },
    wsMaxPayloadBytes: { type: "integer", minimum: 1 }
  },
  additionalProperties: false
};
var openResultSchema = {
  type: "object",
  required: [],
  properties: {},
  additionalProperties: true
};
var CLIENT_ID_SCHEMA = {
  type: "string",
  minLength: CLIENT_ID_MIN_LENGTH,
  maxLength: CLIENT_ID_MAX_LENGTH,
  pattern: CLIENT_ID_PATTERN
};
var CLIENT_LABEL_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: CLIENT_LABEL_MAX_LENGTH,
  pattern: CLIENT_LABEL_PATTERN
};
var HELLO_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "pairingId", "credential", "clientId", "session"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.BRIDGE_HELLO },
    pairingId: { type: "string", minLength: 1 },
    credential: { type: "string", minLength: 32 },
    clientId: CLIENT_ID_SCHEMA,
    session: {
      type: "object",
      required: ["moduleId", "moduleVersion", "world", "user", "commands"],
      properties: {
        moduleId: { type: "string", minLength: 1 },
        moduleVersion: { type: "string", minLength: 1 },
        world: {
          type: "object",
          required: ["id", "title"],
          properties: {
            id: { type: "string", minLength: 1 },
            title: { type: "string", minLength: 1 }
          },
          additionalProperties: false
        },
        user: {
          type: "object",
          required: ["id", "name", "isGM"],
          properties: {
            id: { type: "string", minLength: 1 },
            name: { type: "string", minLength: 1 },
            isGM: { type: "boolean" }
          },
          additionalProperties: false
        },
        commands: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1
        }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};
var CLIENT_HELLO_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "credential", "client"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.CLIENT_HELLO },
    credential: { type: "string", minLength: 43 },
    client: { type: "string", enum: ["cli", "companion"] }
  },
  additionalProperties: false
};
var CLIENT_HELLO_ACK_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "ok"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.CLIENT_HELLO_ACK },
    ok: { type: "boolean" },
    error: protocolErrorSchema
  },
  additionalProperties: false
};
var PAIRING_REQUEST_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "identity"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.PAIRING_REQUEST },
    identity: {
      type: "object",
      required: ["moduleId", "moduleVersion", "world", "user", "client"],
      properties: {
        moduleId: { type: "string", const: MODULE_ID },
        moduleVersion: { type: "string", minLength: 1 },
        world: HELLO_SCHEMA.properties.session.properties.world,
        user: HELLO_SCHEMA.properties.session.properties.user,
        client: {
          type: "object",
          required: ["id", "label"],
          properties: {
            id: CLIENT_ID_SCHEMA,
            label: CLIENT_LABEL_SCHEMA
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};
var PAIRING_PENDING_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "code", "expiresAt"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.PAIRING_PENDING },
    code: { type: "string", minLength: 8, maxLength: 8 },
    expiresAt: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};
var PAIRING_RESULT_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "ok"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.PAIRING_RESULT },
    ok: { type: "boolean" },
    pairingId: { type: "string", minLength: 1 },
    credential: { type: "string", minLength: 32 },
    error: protocolErrorSchema
  },
  additionalProperties: false
};
var DAEMON_OPERATIONS = deepFreeze([
  "auth.status",
  "auth.pending",
  "auth.await",
  "auth.approve",
  "auth.deny",
  "auth.list",
  "auth.prune",
  "auth.revoke",
  "auth.rotate-client",
  "bridge.release"
]);
var DAEMON_OPERATION_DEFINITIONS = deepFreeze({
  "auth.status": { paramsSchema: emptyObjectSchema },
  "auth.pending": { paramsSchema: emptyObjectSchema },
  "auth.await": {
    paramsSchema: {
      type: "object",
      required: [],
      properties: {
        timeoutMs: { type: "integer", minimum: 0, maximum: AUTH_AWAIT_PARK_CAP_MS }
      },
      additionalProperties: false
    }
  },
  "auth.approve": {
    paramsSchema: {
      type: "object",
      required: [],
      properties: {
        code: { type: "string", minLength: 8, maxLength: 8 }
      },
      additionalProperties: false
    }
  },
  "auth.deny": {
    paramsSchema: {
      type: "object",
      required: ["code"],
      properties: { code: { type: "string", minLength: 8, maxLength: 8 } },
      additionalProperties: false
    }
  },
  "auth.list": { paramsSchema: emptyObjectSchema },
  "auth.prune": {
    paramsSchema: {
      type: "object",
      required: [],
      properties: {
        olderThanDays: { type: "integer", minimum: 0 }
      },
      additionalProperties: false
    }
  },
  "auth.revoke": {
    paramsSchema: {
      type: "object",
      required: ["pairingId"],
      properties: { pairingId: { type: "string", minLength: 1 } },
      additionalProperties: false
    }
  },
  "auth.rotate-client": { paramsSchema: emptyObjectSchema },
  "bridge.release": { paramsSchema: emptyObjectSchema }
});
var DAEMON_REQUEST_VARIANT_SCHEMAS = deepFreeze(
  Object.fromEntries(
    DAEMON_OPERATIONS.map((operation) => [
      operation,
      {
        type: "object",
        required: ["protocolVersion", "type", "id", "operation", "params"],
        properties: {
          protocolVersion: { type: "string", const: PROTOCOL_VERSION },
          type: { type: "string", const: MESSAGE_TYPES.DAEMON_REQUEST },
          id: { type: "string", minLength: 1 },
          operation: { type: "string", const: operation },
          params: DAEMON_OPERATION_DEFINITIONS[operation].paramsSchema
        },
        additionalProperties: false
      }
    ])
  )
);
var DAEMON_REQUEST_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "id", "operation", "params"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.DAEMON_REQUEST },
    id: { type: "string", minLength: 1 },
    operation: { type: "string", enum: DAEMON_OPERATIONS },
    params: { type: "object", required: [], properties: {}, additionalProperties: true }
  },
  additionalProperties: false,
  oneOf: Object.values(DAEMON_REQUEST_VARIANT_SCHEMAS)
};
var DAEMON_RESPONSE_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "id", "operation", "ok"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.DAEMON_RESPONSE },
    id: { type: "string", minLength: 1 },
    operation: { type: "string", minLength: 1 },
    ok: { type: "boolean" },
    result: openResultSchema,
    error: protocolErrorSchema
  },
  additionalProperties: false
};
var BRIDGE_HELLO_ACK_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "ok"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.BRIDGE_HELLO_ACK },
    ok: { type: "boolean" },
    limits: limitsSchema,
    error: protocolErrorSchema
  },
  additionalProperties: false
};
var BRIDGE_GOODBYE_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.BRIDGE_GOODBYE }
  },
  additionalProperties: false
};
var COMMAND_RESPONSE_SCHEMA = {
  type: "object",
  required: ["protocolVersion", "type", "id", "ok"],
  properties: {
    protocolVersion: { type: "string", const: PROTOCOL_VERSION },
    type: { type: "string", const: MESSAGE_TYPES.COMMAND_RESPONSE },
    id: { type: "string", minLength: 1 },
    ok: { type: "boolean" },
    result: {},
    error: protocolErrorSchema
  },
  additionalProperties: false
};
var TRANSPORT_MESSAGE_SCHEMAS = deepFreeze({
  [MESSAGE_TYPES.CLIENT_HELLO]: CLIENT_HELLO_SCHEMA,
  [MESSAGE_TYPES.CLIENT_HELLO_ACK]: CLIENT_HELLO_ACK_SCHEMA,
  [MESSAGE_TYPES.PAIRING_REQUEST]: PAIRING_REQUEST_SCHEMA,
  [MESSAGE_TYPES.PAIRING_PENDING]: PAIRING_PENDING_SCHEMA,
  [MESSAGE_TYPES.PAIRING_RESULT]: PAIRING_RESULT_SCHEMA,
  [MESSAGE_TYPES.DAEMON_REQUEST]: DAEMON_REQUEST_SCHEMA,
  [MESSAGE_TYPES.DAEMON_RESPONSE]: DAEMON_RESPONSE_SCHEMA,
  [MESSAGE_TYPES.BRIDGE_HELLO]: HELLO_SCHEMA,
  [MESSAGE_TYPES.BRIDGE_HELLO_ACK]: BRIDGE_HELLO_ACK_SCHEMA,
  [MESSAGE_TYPES.BRIDGE_GOODBYE]: BRIDGE_GOODBYE_SCHEMA,
  [MESSAGE_TYPES.COMMAND_REQUEST]: REQUEST_SCHEMA,
  [MESSAGE_TYPES.COMMAND_RESPONSE]: COMMAND_RESPONSE_SCHEMA
});
function isKnownCommand(command) {
  return Object.hasOwn(COMMAND_DEFINITIONS, command);
}
function getCommandDefinition(command) {
  return COMMAND_DEFINITIONS[command] ?? null;
}
function isWriteCommand(command) {
  return getCommandDefinition(command)?.mutation === true;
}
function getInvalidCommandError(command) {
  return {
    code: ERROR_CODES.UNKNOWN_COMMAND,
    message: `Unsupported command: ${command}`,
    details: {
      command
    }
  };
}

// packages/protocol/src/generated/default-command-profile.js
var DEFAULT_COMMAND_PROFILE = deepFreeze({
  "system.ping": "allow",
  "system.info": "allow",
  "scene.list": "allow",
  "scene.get": "allow",
  "scene.get-many": "allow",
  "scene.update": "allow",
  "scene.create": "allow",
  "scene.delete": "approve",
  "scene.clone": "allow",
  "scene.import-from-compendium": "allow",
  "scene.thumbnail.generate": "allow",
  "scene.fog.reset": "approve",
  "scene.ownership.set": "allow",
  "scene.token.list": "allow",
  "scene.token.get": "allow",
  "scene.token.create": "allow",
  "scene.token.update": "allow",
  "scene.token.delete": "approve",
  "scene.token.clone": "allow",
  "scene.token.create-many": "allow",
  "scene.token.update-many": "allow",
  "scene.token.delete-many": "approve",
  "scene.token.item.list": "allow",
  "scene.token.item.get": "allow",
  "scene.token.item.create": "allow",
  "scene.token.item.update": "allow",
  "scene.token.item.delete": "approve",
  "scene.token.item.clone": "allow",
  "scene.token.item.effect.list": "allow",
  "scene.token.item.effect.get": "allow",
  "scene.token.item.effect.create": "allow",
  "scene.token.item.effect.update": "allow",
  "scene.token.item.effect.delete": "approve",
  "scene.token.item.effect.clone": "allow",
  "scene.token.item.effect.create-many": "allow",
  "scene.token.item.effect.update-many": "allow",
  "scene.token.item.effect.delete-many": "approve",
  "scene.token.effect.list": "allow",
  "scene.token.effect.applied": "allow",
  "scene.token.effect.get": "allow",
  "scene.token.effect.create": "allow",
  "scene.token.effect.update": "allow",
  "scene.token.effect.delete": "approve",
  "scene.token.effect.clone": "allow",
  "scene.token.effect.create-many": "allow",
  "scene.token.effect.update-many": "allow",
  "scene.token.effect.delete-many": "approve",
  "scene.tile.list": "allow",
  "scene.tile.get": "allow",
  "scene.tile.create": "allow",
  "scene.tile.update": "allow",
  "scene.tile.delete": "approve",
  "scene.tile.clone": "allow",
  "scene.tile.create-many": "allow",
  "scene.tile.update-many": "allow",
  "scene.tile.delete-many": "approve",
  "scene.sound.list": "allow",
  "scene.sound.get": "allow",
  "scene.sound.create": "allow",
  "scene.sound.update": "allow",
  "scene.sound.delete": "approve",
  "scene.sound.clone": "allow",
  "scene.sound.create-many": "allow",
  "scene.sound.update-many": "allow",
  "scene.sound.delete-many": "approve",
  "scene.wall.list": "allow",
  "scene.wall.get": "allow",
  "scene.wall.create": "allow",
  "scene.wall.update": "allow",
  "scene.wall.delete": "approve",
  "scene.wall.clone": "allow",
  "scene.wall.create-many": "allow",
  "scene.wall.update-many": "allow",
  "scene.wall.delete-many": "approve",
  "scene.note.list": "allow",
  "scene.note.get": "allow",
  "scene.note.create": "allow",
  "scene.note.update": "allow",
  "scene.note.delete": "approve",
  "scene.note.clone": "allow",
  "scene.note.create-many": "allow",
  "scene.note.update-many": "allow",
  "scene.note.delete-many": "approve",
  "scene.drawing.list": "allow",
  "scene.drawing.get": "allow",
  "scene.drawing.create": "allow",
  "scene.drawing.update": "allow",
  "scene.drawing.delete": "approve",
  "scene.drawing.clone": "allow",
  "scene.drawing.create-many": "allow",
  "scene.drawing.update-many": "allow",
  "scene.drawing.delete-many": "approve",
  "scene.light.list": "allow",
  "scene.light.get": "allow",
  "scene.light.create": "allow",
  "scene.light.update": "allow",
  "scene.light.delete": "approve",
  "scene.light.clone": "allow",
  "scene.light.create-many": "allow",
  "scene.light.update-many": "allow",
  "scene.light.delete-many": "approve",
  "scene.template.list": "allow",
  "scene.template.get": "allow",
  "scene.template.create": "allow",
  "scene.template.update": "allow",
  "scene.template.delete": "approve",
  "scene.template.clone": "allow",
  "scene.template.create-many": "allow",
  "scene.template.update-many": "allow",
  "scene.template.delete-many": "approve",
  "scene.region.list": "allow",
  "scene.region.get": "allow",
  "scene.region.create": "allow",
  "scene.region.update": "allow",
  "scene.region.delete": "approve",
  "scene.region.clone": "allow",
  "scene.region.create-many": "allow",
  "scene.region.update-many": "allow",
  "scene.region.delete-many": "approve",
  "scene.region.behavior.list": "allow",
  "scene.region.behavior.get": "allow",
  "scene.region.behavior.create": "allow",
  "scene.region.behavior.update": "allow",
  "scene.region.behavior.delete": "approve",
  "scene.region.behavior.clone": "allow",
  "item.list": "allow",
  "item.get": "allow",
  "item.get-many": "allow",
  "item.create": "allow",
  "item.update": "allow",
  "item.delete": "approve",
  "item.clone": "allow",
  "item.import-from-compendium": "allow",
  "item.ownership.set": "allow",
  "item.update-many": "allow",
  "item.delete-many": "approve",
  "item.effect.list": "allow",
  "item.effect.get": "allow",
  "item.effect.create": "allow",
  "item.effect.update": "allow",
  "item.effect.delete": "approve",
  "item.effect.clone": "allow",
  "item.effect.create-many": "allow",
  "item.effect.update-many": "allow",
  "item.effect.delete-many": "approve",
  "journal.list": "allow",
  "journal.get": "allow",
  "journal.get-many": "allow",
  "journal.create": "allow",
  "journal.update": "allow",
  "journal.delete": "approve",
  "journal.clone": "allow",
  "journal.import-from-compendium": "allow",
  "journal.ownership.set": "allow",
  "journal.update-many": "allow",
  "journal.delete-many": "approve",
  "journal.category.list": "allow",
  "journal.category.get": "allow",
  "journal.category.create": "allow",
  "journal.category.update": "allow",
  "journal.category.delete": "approve",
  "macro.list": "allow",
  "macro.get": "allow",
  "macro.get-many": "allow",
  "macro.create": "allow",
  "macro.update": "allow",
  "macro.delete": "approve",
  "macro.clone": "allow",
  "macro.import-from-compendium": "allow",
  "macro.ownership.set": "allow",
  "playlist.list": "allow",
  "playlist.get": "allow",
  "playlist.get-many": "allow",
  "playlist.create": "allow",
  "playlist.update": "allow",
  "playlist.delete": "approve",
  "playlist.clone": "allow",
  "playlist.import-from-compendium": "allow",
  "playlist.ownership.set": "allow",
  "playlist.sound.list": "allow",
  "playlist.sound.get": "allow",
  "playlist.sound.create": "allow",
  "playlist.sound.update": "allow",
  "playlist.sound.delete": "approve",
  "playlist.sound.clone": "allow",
  "playlist.play": "allow",
  "playlist.stop": "allow",
  "playlist.playNext": "allow",
  "playlist.sound.play": "allow",
  "playlist.sound.stop": "allow",
  "table.list": "allow",
  "table.get": "allow",
  "table.get-many": "allow",
  "table.create": "allow",
  "table.update": "allow",
  "table.delete": "approve",
  "table.clone": "allow",
  "table.import-from-compendium": "allow",
  "table.draw": "allow",
  "table.reset": "allow",
  "table.ownership.set": "allow",
  "table.result.list": "allow",
  "table.result.get": "allow",
  "table.result.create": "allow",
  "table.result.update": "allow",
  "table.result.delete": "approve",
  "table.result.clone": "allow",
  "combat.list": "allow",
  "combat.get": "allow",
  "combat.create": "allow",
  "combat.update": "allow",
  "combat.delete": "approve",
  "combat.start": "allow",
  "combat.activate": "allow",
  "combat.next-turn": "allow",
  "combat.previous-turn": "allow",
  "combat.next-round": "allow",
  "combat.previous-round": "allow",
  "combat.reset-initiative": "allow",
  "combat.roll-initiative": "allow",
  "combat.set-initiative": "allow",
  "combat.combatant.list": "allow",
  "combat.combatant.get": "allow",
  "combat.combatant.create": "allow",
  "combat.combatant.update": "allow",
  "combat.combatant.delete": "approve",
  "combat.group.list": "allow",
  "combat.group.get": "allow",
  "combat.group.create": "allow",
  "combat.group.update": "allow",
  "combat.group.delete": "approve",
  "cards.list": "allow",
  "cards.get": "allow",
  "cards.get-many": "allow",
  "cards.create": "allow",
  "cards.update": "allow",
  "cards.clone": "allow",
  "cards.import-from-compendium": "allow",
  "cards.delete": "approve",
  "cards.ownership.set": "allow",
  "cards.shuffle": "allow",
  "cards.reset": "allow",
  "cards.deal": "allow",
  "cards.draw": "allow",
  "cards.pass": "allow",
  "cards.card.list": "allow",
  "cards.card.get": "allow",
  "cards.card.create": "allow",
  "cards.card.update": "allow",
  "cards.card.clone": "allow",
  "cards.card.delete": "approve",
  "chat.list": "allow",
  "chat.get": "allow",
  "chat.create": "allow",
  "chat.delete": "approve",
  "actor.list": "allow",
  "actor.get": "allow",
  "actor.get-many": "allow",
  "actor.create": "allow",
  "actor.update": "allow",
  "actor.delete": "approve",
  "actor.clone": "allow",
  "actor.ownership.set": "allow",
  "actor.item.list": "allow",
  "actor.item.create": "allow",
  "actor.item.update": "allow",
  "actor.item.get": "allow",
  "actor.item.delete": "approve",
  "actor.item.clone": "allow",
  "actor.item.import-from-compendium": "allow",
  "actor.update-many": "allow",
  "actor.delete-many": "approve",
  "actor.effect.list": "allow",
  "actor.effect.applied": "allow",
  "actor.effect.get": "allow",
  "actor.effect.create": "allow",
  "actor.effect.update": "allow",
  "actor.effect.delete": "approve",
  "actor.effect.clone": "allow",
  "actor.effect.create-many": "allow",
  "actor.effect.update-many": "allow",
  "actor.effect.delete-many": "approve",
  "actor.item.effect.list": "allow",
  "actor.item.effect.get": "allow",
  "actor.item.effect.create": "allow",
  "actor.item.effect.update": "allow",
  "actor.item.effect.delete": "approve",
  "actor.item.effect.clone": "allow",
  "actor.item.effect.create-many": "allow",
  "actor.item.effect.update-many": "allow",
  "actor.item.effect.delete-many": "approve",
  "file.list": "allow",
  "file.stat": "allow",
  "file.read": "allow",
  "file.mkdir": "allow",
  "file.upload": "allow",
  "file.delete": "approve",
  "file.move": "approve",
  "compendium.list": "allow",
  "compendium.index": "allow",
  "compendium.get": "allow",
  "folder.list": "allow",
  "folder.get": "allow",
  "folder.create": "allow",
  "folder.update": "allow",
  "folder.delete": "approve",
  "user.list": "allow",
  "user.get": "allow",
  "setting.list": "allow",
  "setting.get": "allow",
  "actor.import-from-compendium": "allow",
  "world.audit-files": "allow",
  "world.search": "allow",
  "approval.await": "allow",
  "approval.cancel": "allow",
  "policy.snapshot": "allow"
});

// packages/protocol/src/destructive-commands.js
var DESTRUCTIVE_VERBS = Object.freeze(["delete", "delete-many"]);
var DESTRUCTIVE_COMMANDS = Object.freeze(["file.delete", "file.move", "scene.fog.reset"]);
function isDestructiveCommand(name) {
  const separator = name.lastIndexOf(".");
  const verb = separator === -1 ? "" : name.slice(separator + 1);
  return DESTRUCTIVE_VERBS.includes(verb) || DESTRUCTIVE_COMMANDS.includes(name);
}

// packages/protocol/src/policy.js
var POLICY_BEHAVIORS = Object.freeze(["allow", "approve", "deny"]);
var POLICY_EXEMPT_COMMANDS = Object.freeze([
  "system.ping",
  "system.info",
  "approval.await",
  "approval.cancel",
  "policy.snapshot"
]);
function defaultProfile(name) {
  return Object.hasOwn(DEFAULT_COMMAND_PROFILE, name) ? DEFAULT_COMMAND_PROFILE[name] : void 0;
}

// packages/protocol/src/validation.js
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function countCodePoints(value, stopAfter) {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 55296 && code <= 56319 && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 56320 && low <= 57343) {
        index += 1;
      }
    }
    count += 1;
    if (count > stopAfter) {
      return count;
    }
  }
  return count;
}
function compilePattern(pattern) {
  try {
    return new RegExp(pattern, "u");
  } catch {
    return null;
  }
}
function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);
  for (let i = 1; i < rows; i += 1) {
    const current = [i];
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[cols - 1];
}
function describeAllowedFields(key, allowedFields) {
  if (allowedFields.length === 0) {
    return "";
  }
  const threshold = Math.max(1, Math.floor(key.length / 3));
  let closest = null;
  let closestDistance = Infinity;
  for (const candidate of allowedFields) {
    const distance = editDistance(key, candidate);
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }
  const allowedList = `allowed fields: ${allowedFields.join(", ")}`;
  if (closest !== null && closestDistance > 0 && closestDistance <= threshold) {
    return ` (did you mean "${closest}"? ${allowedList})`;
  }
  return ` (${allowedList})`;
}
function matchesType(expectedType, value) {
  if (Array.isArray(expectedType)) {
    return expectedType.some((typeName) => matchesType(typeName, value));
  }
  switch (expectedType) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isPlainObject(value);
    case "string":
      return typeof value === "string";
    default:
      return true;
  }
}
function validateObjectSchema(schema, value, path, errors) {
  const required = schema.required ?? [];
  const properties = schema.properties ?? {};
  const additionalProperties = schema.additionalProperties ?? true;
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      errors.push(`${path}.${key} is required`);
    }
  }
  const ownKeys = Object.keys(value);
  if (typeof schema.minProperties === "number" && ownKeys.length < schema.minProperties) {
    errors.push(`${path} must contain at least ${schema.minProperties} properties`);
  }
  for (const [key, propertyValue] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (propertySchema) {
      validateSchema(propertySchema, propertyValue, `${path}.${key}`, errors);
      continue;
    }
    if (additionalProperties === false) {
      errors.push(`${path}.${key} is not allowed${describeAllowedFields(key, Object.keys(properties))}`);
      continue;
    }
    if (isPlainObject(additionalProperties)) {
      validateSchema(additionalProperties, propertyValue, `${path}.${key}`, errors);
    }
  }
}
function validateArraySchema(schema, value, path, errors) {
  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    errors.push(`${path} must contain at least ${schema.minItems} items`);
  }
  if (!schema.items) {
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    validateSchema(schema.items, value[index], `${path}[${index}]`, errors);
  }
}
function validateSchema(schema, value, path = "$", errors = []) {
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter(
      (candidate) => validateSchema(candidate, value, path, []).length === 0
    );
    if (matches.length !== 1) {
      errors.push(`${path} must match exactly one allowed schema`);
    }
  }
  if (schema.const !== void 0 && value !== schema.const) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
    return errors;
  }
  if (schema.type && !matchesType(schema.type, value)) {
    const typeNames = Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type;
    errors.push(`${path} must be ${typeNames}`);
    return errors;
  }
  if (typeof value === "string" && typeof schema.minLength === "number") {
    const enoughUnits = value.length >= schema.minLength;
    const enough = enoughUnits && (value.length >= schema.minLength * 2 || countCodePoints(value, schema.minLength) >= schema.minLength);
    if (!enough) {
      errors.push(`${path} must be at least ${schema.minLength} characters long`);
    }
  }
  if (typeof value === "string" && typeof schema.maxLength === "number" && value.length > schema.maxLength && countCodePoints(value, schema.maxLength) > schema.maxLength) {
    errors.push(`${path} must be at most ${schema.maxLength} characters long`);
  }
  if (typeof value === "string" && typeof schema.pattern === "string") {
    const expression = compilePattern(schema.pattern);
    if (expression === null) {
      errors.push(`${path} cannot be validated: ${schema.pattern} is not a valid unicode-mode pattern`);
    } else if (!expression.test(value)) {
      errors.push(`${path} must match ${schema.pattern}`);
    }
  }
  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) {
    errors.push(`${path} must be >= ${schema.minimum}`);
  }
  if (typeof value === "number" && typeof schema.maximum === "number" && value > schema.maximum) {
    errors.push(`${path} must be <= ${schema.maximum}`);
  }
  if (typeof value === "number" && typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
    errors.push(`${path} must be > ${schema.exclusiveMinimum}`);
  }
  if (typeof value === "number" && typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
    errors.push(`${path} must be < ${schema.exclusiveMaximum}`);
  }
  if (schema.type === "object" && isPlainObject(value)) {
    validateObjectSchema(schema, value, path, errors);
  }
  if (schema.type === "array" && Array.isArray(value)) {
    validateArraySchema(schema, value, path, errors);
  }
  return errors;
}
function validateHelloMessage(message) {
  const errors = validateSchema(HELLO_SCHEMA, message);
  return {
    ok: errors.length === 0,
    errors
  };
}
function validateClientHello(message) {
  const errors = validateSchema(CLIENT_HELLO_SCHEMA, message);
  return { ok: errors.length === 0, errors };
}
function validatePairingRequest(message) {
  const errors = validateSchema(PAIRING_REQUEST_SCHEMA, message);
  return { ok: errors.length === 0, errors };
}
function validateDaemonRequest(message) {
  const errors = validateSchema(DAEMON_REQUEST_SCHEMA, message);
  const definition = DAEMON_OPERATION_DEFINITIONS[message?.operation];
  if (definition) {
    validateSchema(definition.paramsSchema, message.params, "$.params", errors);
  }
  return { ok: errors.length === 0, errors };
}
function validateOutcomeEnvelope(message, { successRequired = [], successFields = [] } = {}) {
  const errors = [];
  if (message.ok === true) {
    for (const key of successRequired) {
      if (!Object.hasOwn(message, key)) errors.push(`$.${key} is required when $.ok is true`);
    }
    if (Object.hasOwn(message, "error")) errors.push("$.error is not allowed when $.ok is true");
  } else if (message.ok === false) {
    if (!Object.hasOwn(message, "error")) errors.push("$.error is required when $.ok is false");
    for (const key of successFields) {
      if (Object.hasOwn(message, key)) errors.push(`$.${key} is not allowed when $.ok is false`);
    }
  }
  return errors;
}
function validateTransportMessage(message) {
  if (!isPlainObject(message) || typeof message.type !== "string") {
    return { ok: false, errors: ["$.type is required"] };
  }
  const schema = TRANSPORT_MESSAGE_SCHEMAS[message.type];
  if (!schema) {
    return {
      ok: false,
      errors: [`$.type must be one of ${Object.keys(TRANSPORT_MESSAGE_SCHEMAS).join(", ")}`]
    };
  }
  const errors = validateSchema(schema, message);
  if (message.type === MESSAGE_TYPES.COMMAND_REQUEST && errors.length === 0) {
    return validateCommandRequest(message);
  }
  if (message.type === MESSAGE_TYPES.DAEMON_REQUEST && errors.length === 0) {
    return validateDaemonRequest(message);
  }
  if (message.type === MESSAGE_TYPES.CLIENT_HELLO_ACK) {
    errors.push(...validateOutcomeEnvelope(message));
  } else if (message.type === MESSAGE_TYPES.PAIRING_RESULT) {
    errors.push(
      ...validateOutcomeEnvelope(message, {
        successRequired: ["pairingId", "credential"],
        successFields: ["pairingId", "credential"]
      })
    );
  } else if (message.type === MESSAGE_TYPES.DAEMON_RESPONSE) {
    errors.push(
      ...validateOutcomeEnvelope(message, {
        successRequired: ["result"],
        successFields: ["result"]
      })
    );
  } else if (message.type === MESSAGE_TYPES.BRIDGE_HELLO_ACK) {
    errors.push(...validateOutcomeEnvelope(message, { successFields: ["limits"] }));
  } else if (message.type === MESSAGE_TYPES.COMMAND_RESPONSE) {
    errors.push(
      ...validateOutcomeEnvelope(message, {
        successRequired: ["result"],
        successFields: ["result"]
      })
    );
  }
  return { ok: errors.length === 0, errors };
}
function validateCommandRequest(message) {
  const requestErrors = validateSchema(REQUEST_SCHEMA, message);
  if (requestErrors.length > 0) {
    return {
      ok: false,
      errors: requestErrors
    };
  }
  if (!isKnownCommand(message.command)) {
    return {
      ok: false,
      errors: [getInvalidCommandError(message.command).message]
    };
  }
  const definition = getCommandDefinition(message.command);
  const paramsErrors = validateSchema(definition.paramsSchema, message.params, "$.params");
  return {
    ok: paramsErrors.length === 0,
    errors: paramsErrors
  };
}
function createBridgeHello(options) {
  const { pairingId, credential, clientId, session } = options;
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.BRIDGE_HELLO,
    pairingId,
    credential,
    clientId,
    session
  };
}
function createClientHello({ credential, client = "cli" }) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.CLIENT_HELLO,
    credential,
    client
  };
}
function createCommandResponse({ id, result }) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.COMMAND_RESPONSE,
    id,
    ok: true,
    result
  };
}
function createErrorResponse({ id, error }) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.COMMAND_RESPONSE,
    id,
    ok: false,
    error
  };
}
function createProtocolError({ code, message, details = {} }) {
  return {
    code,
    message,
    details
  };
}
var LEGACY_PROTOCOL_RELEASES = Object.freeze({ "3.0": "1.0.0" });
var RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
function normalizeComparableProtocolVersion(value) {
  if (typeof value !== "string") {
    return null;
  }
  if (Object.hasOwn(LEGACY_PROTOCOL_RELEASES, value)) {
    return LEGACY_PROTOCOL_RELEASES[value];
  }
  return RELEASE_VERSION_PATTERN.test(value) ? value : null;
}
function compareReleaseVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}
function isNamedComponent(component) {
  return component === PROTOCOL_COMPONENTS.MODULE || component === PROTOCOL_COMPONENTS.CLI_DAEMON;
}
function resolveStaleComponent(actualVersion, peer, reporter) {
  const actual = normalizeComparableProtocolVersion(actualVersion);
  const expected = normalizeComparableProtocolVersion(PROTOCOL_VERSION);
  if (actual === null || expected === null) {
    return PROTOCOL_COMPONENTS.UNKNOWN;
  }
  const order = compareReleaseVersions(actual, expected);
  if (order < 0) {
    return isNamedComponent(peer) ? peer : PROTOCOL_COMPONENTS.UNKNOWN;
  }
  if (order > 0) {
    return isNamedComponent(reporter) ? reporter : PROTOCOL_COMPONENTS.UNKNOWN;
  }
  return PROTOCOL_COMPONENTS.UNKNOWN;
}
function describeStaleComponent(staleComponent) {
  if (staleComponent === PROTOCOL_COMPONENTS.MODULE) {
    return "the Foundry module is the older component, so update the module in Foundry until both halves come from the same release, then reload the GM client";
  }
  if (staleComponent === PROTOCOL_COMPONENTS.CLI_DAEMON) {
    return "the CLI and daemon are the older component, so update the fvtt-world-cli package until both halves come from the same release, then restart the daemon";
  }
  return "these versions cannot be ordered, so the older component is unknown: bring the fvtt-world-cli package and the Foundry module to the same release, restart the daemon, and reload the GM client";
}
function getProtocolVersionError(actualVersion, options = {}) {
  const {
    peer = PROTOCOL_COMPONENTS.UNKNOWN,
    reporter = PROTOCOL_COMPONENTS.UNKNOWN,
    handshake = PROTOCOL_HANDSHAKES.UNKNOWN
  } = options;
  const staleComponent = resolveStaleComponent(actualVersion, peer, reporter);
  return createProtocolError({
    code: ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION,
    message: `Unsupported protocol version: ${actualVersion} (expected ${PROTOCOL_VERSION}); ${describeStaleComponent(staleComponent)}. Components from different releases are refused by design.`,
    details: {
      expectedVersion: PROTOCOL_VERSION,
      actualVersion,
      staleComponent,
      handshake
    }
  });
}
function getInvalidMessageError(errors) {
  return createProtocolError({
    code: ERROR_CODES.INVALID_MESSAGE,
    message: "Invalid bridge message",
    details: {
      errors
    }
  });
}
function getInvalidParamsError(command, errors) {
  return createProtocolError({
    code: ERROR_CODES.INVALID_PARAMS,
    message: `Invalid params for ${command}`,
    details: {
      command,
      errors
    }
  });
}
function parseBridgeMessage(rawMessage) {
  try {
    return {
      ok: true,
      value: JSON.parse(rawMessage)
    };
  } catch (error) {
    return {
      ok: false,
      error: getInvalidMessageError([error instanceof Error ? error.message : "Unknown JSON parse error"])
    };
  }
}
export {
  APPROVAL_AWAIT_PARK_CAP_MS,
  APPROVAL_PENDING_MAX,
  APPROVAL_RESULT_RETENTION_MS,
  APPROVAL_TIMEOUT_DEFAULT_MINUTES,
  APPROVAL_TIMEOUT_MAX_MINUTES,
  APPROVAL_TIMEOUT_MIN_MINUTES,
  AUDIT_FILES_MAX_DIRS,
  AUDIT_FILE_SCOPES,
  AUTH_AWAIT_PARK_CAP_MS,
  AUTH_FIRST_MESSAGE_TIMEOUT_MS,
  AUTH_PRUNE_DEFAULT_DAYS,
  BATCH_GET_MAX_IDS,
  BATCH_WRITE_MAX_ITEMS,
  BATCH_WRITE_PERSISTED_STATUSES,
  BATCH_WRITE_STATUSES,
  BATCH_WRITE_SUCCESS_STATUSES,
  BRIDGE_GOODBYE_SCHEMA,
  BRIDGE_HELLO_ACK_SCHEMA,
  BRIDGE_LEASE_MS,
  BRIDGE_RELEASE_CLOSE_CODE,
  BRIDGE_RELEASE_CLOSE_REASON,
  BRIDGE_TAKEOVER_CLOSE_CODE,
  BRIDGE_TAKEOVER_CLOSE_REASON,
  CARDS_ACTION_CHAT_STATUSES,
  CARDS_ACTION_MUTATION_OUTCOMES,
  CARDS_ACTION_RECONCILIATIONS,
  CARDS_DELETE_CHAT_STATUSES,
  CARDS_DRAW_MODES,
  CARDS_PASS_MAX_IDS,
  CARDS_RECALL_CONSEQUENCE_SCOPES,
  CARDS_RECALL_STATUSES,
  CHAT_CAPTURE_STATUSES,
  CLIENT_HELLO_ACK_SCHEMA,
  CLIENT_HELLO_SCHEMA,
  CLIENT_ID_MAX_LENGTH,
  CLIENT_ID_MIN_LENGTH,
  CLIENT_ID_PATTERN,
  CLIENT_ID_SCHEMA,
  CLIENT_LABEL_CHARACTER_PATTERN,
  CLIENT_LABEL_MAX_LENGTH,
  CLIENT_LABEL_PATTERN,
  CLIENT_LABEL_SCHEMA,
  COMBAT_INITIATIVE_MODES,
  COMBAT_INITIATIVE_SELECTIONS,
  COMBAT_MUTATION_OUTCOMES,
  COMBAT_ROLL_MODES,
  COMBAT_TRANSITIONS,
  COMMAND_DEFINITIONS,
  COMMAND_NAMES,
  COMMAND_RESPONSE_SCHEMA,
  DAEMON_OPERATIONS,
  DAEMON_OPERATION_DEFINITIONS,
  DAEMON_REQUEST_SCHEMA,
  DAEMON_REQUEST_VARIANT_SCHEMAS,
  DAEMON_RESPONSE_SCHEMA,
  DEFAULT_COMMAND_PROFILE,
  DEFAULT_DAEMON_URL,
  DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
  DEFAULT_WS_MAX_PAYLOAD_BYTES,
  DISCOVERABLE_COMMAND_NAMES,
  ERROR_CODES,
  FOG_RESET_CONFIRM_POLL_INTERVAL_MS,
  FOG_RESET_CONFIRM_TIMEOUT_MS,
  HELLO_SCHEMA,
  MESSAGE_TYPES,
  MODULE_ID,
  MODULE_TITLE,
  PAIRING_PENDING_MAX,
  PAIRING_PENDING_SCHEMA,
  PAIRING_REQUEST_SCHEMA,
  PAIRING_REQUEST_TTL_MS,
  PAIRING_RESULT_SCHEMA,
  POLICY_BEHAVIORS,
  POLICY_DISCOVERY_TIMEOUT_MS,
  POLICY_EXEMPT_COMMANDS,
  PROTOCOL_COMPONENTS,
  PROTOCOL_HANDSHAKES,
  PROTOCOL_VERSION,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  REQUEST_SCHEMA,
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
  SETTING_VALUE_MAX_BYTES,
  SETTING_VALUE_MAX_DEPTH,
  SETTING_VALUE_MAX_NODES,
  TABLE_DRAW_MAX_COUNT,
  TABLE_MUTATION_OUTCOMES,
  TABLE_ROLL_MODES,
  TRANSPORT_MESSAGE_SCHEMAS,
  UPLOAD_SIZE_LIMIT_MAX_BYTES,
  WRITE_COMMANDS,
  createBridgeHello,
  createClientHello,
  createCommandResponse,
  createErrorResponse,
  createProtocolError,
  defaultProfile,
  estimateSearchIndexBytes,
  getCommandDefinition,
  getInvalidCommandError,
  getInvalidMessageError,
  getInvalidParamsError,
  getProtocolVersionError,
  isDestructiveCommand,
  isKnownCommand,
  isWriteCommand,
  normalizeComparableProtocolVersion,
  pairingPruneCutoffAt,
  parseBridgeMessage,
  resolveEffectiveLimits,
  validateClientHello,
  validateCommandRequest,
  validateDaemonRequest,
  validateHelloMessage,
  validatePairingRequest,
  validateSchema,
  validateTransportMessage,
  wsMaxPayloadForUploadLimit
};
