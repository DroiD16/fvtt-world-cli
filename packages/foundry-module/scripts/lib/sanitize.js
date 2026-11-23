import { canonicalizeFilePathFields } from "./file-access.js";

/**
 * @param {unknown} key
 * @returns {string}
 */
export function payloadKeyField(key) {
  if (typeof key !== "string") return "";
  const bare = key.startsWith("==") || key.startsWith("-=") ? key.slice(2) : key;
  const dot = bare.indexOf(".");
  return dot === -1 ? bare : bare.slice(0, dot);
}

/**
 * @param {Record<string, any> | null | undefined} data
 * @param {ReadonlySet<string>} fields
 */
export function omitFields(data, fields) {
  const rest = { ...(data ?? {}) };
  for (const key of Object.keys(rest)) {
    if (fields.has(payloadKeyField(key))) delete rest[key];
  }
  return rest;
}

const PROTECTED_META_FIELDS = Object.freeze(new Set(["_id", "_stats", "ownership"]));

const EMBEDDED_AUTHOR_FIELDS = Object.freeze(new Set(["author", "user"]));

const PROVENANCE_STATS_FIELDS = Object.freeze(["compendiumSource", "duplicateSource", "exportSource"]);

// @param {Record<string, any> | null | undefined} data
export function stripProtectedMeta(data) {
  return omitFields(data, PROTECTED_META_FIELDS);
}

export function sanitizeEmbeddedData(data, { preserveNestedBehaviorIds = false } = {}) {
  const rest = omitFields(stripProtectedMeta(data), EMBEDDED_AUTHOR_FIELDS);
  if (Array.isArray(rest.behaviors)) {
    return {
      ...rest,
      behaviors: rest.behaviors.map((behavior) => {
        const cleaned = stripProtectedMeta(behavior);
        if (preserveNestedBehaviorIds && behavior?._id != null) {
          return { _id: behavior._id, ...cleaned };
        }
        return cleaned;
      })
    };
  }
  return rest;
}

export function sanitizeEffectData(data) {
  return canonicalizeFilePathFields(stripProtectedMeta(data), "ActiveEffect");
}

export function sanitizeEffectCreateData(data) {
  const sanitized = sanitizeEffectData(data);
  const stats = data?._stats;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return sanitized;
  const provenance = Object.fromEntries(
    PROVENANCE_STATS_FIELDS.filter((key) => Object.hasOwn(stats, key)).map((key) => [key, stats[key]])
  );
  return Object.keys(provenance).length > 0 ? { ...sanitized, _stats: provenance } : sanitized;
}

export function sanitizeEmbeddedItemData(data) {
  if (!data || !Array.isArray(data.effects)) {
    return data;
  }
  return {
    ...data,
    effects: data.effects.map((effect) => {
      const sanitized = sanitizeEffectCreateData(effect);
      return effect?._id != null ? { _id: effect._id, ...sanitized } : sanitized;
    })
  };
}
