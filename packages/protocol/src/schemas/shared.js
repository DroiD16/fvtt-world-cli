import { BATCH_GET_MAX_IDS, BATCH_WRITE_MAX_ITEMS } from "../constants.js";

export const cmd = (paramsSchema, { mutation = false } = {}) => ({ mutation, paramsSchema });

/**
 * @param {Record<string, object>[]} families
 * @returns {Record<string, object>}
 */
export function mergeCommandFamilies(families) {
  const merged = {};
  for (const family of families) {
    for (const [name, definition] of Object.entries(family)) {
      if (Object.hasOwn(merged, name)) throw new Error(`Duplicate command definition: ${name}`);
      merged[name] = definition;
    }
  }
  return merged;
}

const deepFrozen = new WeakSet();

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepFreeze(value) {
  if (value === null || typeof value !== "object" || deepFrozen.has(value)) return value;
  deepFrozen.add(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

/**
 * @param {{ properties: Record<string, object> }} createSchema
 * @param {{ omit?: string[], prepend?: Record<string, object> }} [options]
 */
export const patchFrom = (createSchema, { omit = [], prepend = {} } = {}) => ({
  type: "object",
  required: [],
  properties: {
    ...prepend,
    ...Object.fromEntries(Object.entries(createSchema.properties).filter(([field]) => !omit.includes(field)))
  },
  additionalProperties: false,
  minProperties: 1
});

export const emptyObjectSchema = {
  type: "object",
  required: [],
  properties: {},
  additionalProperties: false
};

export const paginationProperties = {
  limit: { type: "integer", minimum: 1 },
  offset: { type: "integer", minimum: 0 }
};

export const paginatedListSchema = {
  type: "object",
  required: [],
  properties: { ...paginationProperties },
  additionalProperties: false
};

export const nameFilterProperty = {
  name: { type: "string", minLength: 1 }
};

export const nameFilteredListSchema = {
  type: "object",
  required: [],
  properties: { ...nameFilterProperty, ...paginationProperties },
  additionalProperties: false
};

export const dryRunProperty = {
  dryRun: { type: "boolean" }
};

export const includeProperty = {
  include: { type: "array", items: { type: "string", enum: ["flags", "effects"] } }
};

export const actorIncludeProperty = {
  include: {
    type: "array",
    items: { type: "string", enum: ["flags", "effects", "items.flags", "items.effects", "prepared"] }
  }
};

export const batchIdsProperty = {
  ids: {
    type: "array",
    minItems: 1,
    maxItems: BATCH_GET_MAX_IDS,
    items: { type: "string", minLength: 1 }
  }
};

export const tokenIncludeProperty = {
  include: { type: "array", items: { type: "string", enum: ["prepared"] } }
};

export const compendiumIncludeProperty = {
  include: { type: "array", items: { type: "string", enum: ["effects"] } }
};

export const idempotencyKeyProperty = {
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

const batchDeleteManyProperties = {
  ids: {
    type: "array",
    minItems: 1,
    maxItems: BATCH_WRITE_MAX_ITEMS,
    items: { type: "string", minLength: 1 }
  }
};

/**
 * @param {string} prefix
 * @param {{ scopeProperties: Record<string, object>, createSchema?: object, patchSchema?: object, verbs?: string[], extraProperties?: Record<string, Record<string, object>> }} config
 */
export function batchWriteCommands(
  prefix,
  {
    scopeProperties,
    createSchema,
    patchSchema,
    verbs = ["create-many", "update-many", "delete-many"],
    extraProperties = {}
  }
) {
  const scopeKeys = Object.keys(scopeProperties);
  const build = (suffix, required, properties) =>
    cmd(
      {
        type: "object",
        required: [...scopeKeys, required],
        properties: {
          ...scopeProperties,
          ...properties,
          ...(extraProperties[suffix] ?? {}),
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

export const sceneScopeProperties = { sceneId: { type: "string", minLength: 1 } };

export const emptyScopeProperties = {};

export const actorScopeProperties = { actorId: { type: "string", minLength: 1 } };

export const itemScopeProperties = { itemId: { type: "string", minLength: 1 } };

export const actorItemScopeProperties = {
  actorId: { type: "string", minLength: 1 },
  itemId: { type: "string", minLength: 1 }
};

export const sceneTokenScopeProperties = {
  sceneId: { type: "string", minLength: 1 },
  tokenId: { type: "string", minLength: 1 }
};

export const sceneTokenItemScopeProperties = {
  sceneId: { type: "string", minLength: 1 },
  tokenId: { type: "string", minLength: 1 },
  itemId: { type: "string", minLength: 1 }
};

export const nullableStringSchema = {
  type: ["string", "null"]
};

export const freeformObjectSchema = {
  type: "object",
  required: [],
  properties: {},
  additionalProperties: true
};

export function compendiumImportSchema(patchSchema) {
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
