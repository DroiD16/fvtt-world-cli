import {
  PREPARED_VALUE_MAX_BYTES,
  PREPARED_VALUE_MAX_DEPTH,
  PREPARED_VALUE_MAX_NODES
} from "../generated/protocol.js";
import {
  UNSERIALIZABLE_MARKER_KEY,
  getColorClass,
  isDataModelInstance,
  readScalarObject,
  utf8ByteLength
} from "./setting-values.js";

class PreparedLimitReached extends Error {
  /** @param {"depth" | "nodes"} limit */
  constructor(limit) {
    super(limit);
    this.limit = limit;
  }
}

function getDocumentClass() {
  const Document = /** @type {any} */ (globalThis).foundry?.abstract?.Document;
  return typeof Document === "function" ? Document : null;
}

/**
 * @param {any} node
 * @param {any} field
 * @returns {Record<string, any> | null}
 */
function schemaFieldsOf(node, field) {
  if (isDataModelInstance(node)) {
    const schema = node.schema ?? node.constructor?.schema;
    return schema?.fields && typeof schema.fields === "object" ? schema.fields : null;
  }
  return field?.fields && typeof field.fields === "object" ? field.fields : null;
}

/** @param {any} field */
function elementFieldOf(field) {
  return field?.element && typeof field.element === "object" ? field.element : null;
}

/**
 * @param {object} node
 * @param {string} key
 */
function ownDataValue(node, key) {
  const descriptor = Object.getOwnPropertyDescriptor(node, key);
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return { present: false };
  return { present: true, value: descriptor.value };
}

/**
 * @param {unknown} value
 * @returns {{ value: unknown, omitted?: { reason: string, limit?: string, max?: number } }}
 */
export function serializePreparedValue(value) {
  const DocumentClass = getDocumentClass();
  const ColorClass = getColorClass();
  /** @type {Set<object>} */
  const ancestors = new Set();
  let nodes = 0;

  /**
   * @param {unknown} node
   * @param {any} field
   * @param {number} depth
   * @returns {unknown}
   */
  const walk = (node, field, depth) => {
    nodes += 1;
    if (nodes > PREPARED_VALUE_MAX_NODES) throw new PreparedLimitReached("nodes");
    if (depth > PREPARED_VALUE_MAX_DEPTH) throw new PreparedLimitReached("depth");

    if (node === undefined || node === null) return null;
    const kind = typeof node;
    if (kind === "boolean" || kind === "string") return node;
    if (kind === "number") return Number.isFinite(node) ? node : null;
    if (kind !== "object") return { [UNSERIALIZABLE_MARKER_KEY]: kind };

    const object = /** @type {any} */ (node);
    if (DocumentClass !== null && object instanceof DocumentClass) {
      return { documentName: object.documentName ?? null, id: object.id ?? null, uuid: object.uuid ?? null };
    }
    if (ancestors.has(object)) return { [UNSERIALIZABLE_MARKER_KEY]: "circular-reference" };

    ancestors.add(object);
    try {
      const scalar = readScalarObject(object, ColorClass);
      if (scalar.ok) return walk(scalar.value, null, depth);
      if (object instanceof Map) {
        /** @type {Record<string, unknown>} */
        const result = {};
        for (const [key, entry] of Map.prototype.entries.call(object)) {
          defineEntry(result, String(key), walk(entry, null, depth + 1));
        }
        return result;
      }
      if (object instanceof Set) {
        return Array.from(Set.prototype.values.call(object), (entry) => walk(entry, null, depth + 1));
      }
      if (Array.isArray(object)) {
        const element = elementFieldOf(field);
        const items = [];
        for (let index = 0; index < object.length; index += 1) {
          const own = ownDataValue(object, String(index));
          items.push(own.present ? walk(own.value, element, depth + 1) : null);
        }
        return items;
      }

      const fields = schemaFieldsOf(object, field);
      const element = fields ? null : elementFieldOf(field);
      /** @type {Record<string, unknown>} */
      const result = {};
      if (fields) {
        for (const key of Object.keys(fields)) {
          let entry;
          try {
            entry = object[key];
          } catch {
            defineEntry(result, key, { [UNSERIALIZABLE_MARKER_KEY]: "getter-threw" });
            continue;
          }
          if (entry !== undefined) defineEntry(result, key, walk(entry, fields[key], depth + 1));
        }
      }
      for (const key of Object.keys(object)) {
        if (fields && Object.hasOwn(fields, key)) continue;
        const own = ownDataValue(object, key);
        if (own.present && own.value !== undefined) {
          defineEntry(result, key, walk(own.value, element, depth + 1));
        }
      }
      return result;
    } finally {
      ancestors.delete(object);
    }
  };

  let serialized;
  try {
    serialized = walk(value, null, 0);
  } catch (error) {
    if (error instanceof PreparedLimitReached) {
      return {
        value: null,
        omitted: {
          reason: "too-large",
          limit: error.limit,
          max: error.limit === "nodes" ? PREPARED_VALUE_MAX_NODES : PREPARED_VALUE_MAX_DEPTH
        }
      };
    }
    return { value: null, omitted: { reason: "unreadable" } };
  }

  if (utf8ByteLength(JSON.stringify(serialized) ?? "null") > PREPARED_VALUE_MAX_BYTES) {
    return { value: null, omitted: { reason: "too-large", limit: "bytes", max: PREPARED_VALUE_MAX_BYTES } };
  }
  return { value: serialized };
}

/**
 * @param {Record<string, unknown>} target
 * @param {string} key
 * @param {unknown} value
 */
function defineEntry(target, key, value) {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}
