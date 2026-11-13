import {
  PREPARED_VALUE_MAX_BYTES,
  PREPARED_VALUE_MAX_DEPTH,
  PREPARED_VALUE_MAX_NODES
} from "../generated/protocol.js";
import {
  UNSERIALIZABLE_MARKER_KEY,
  getColorClass,
  isDataModelInstance,
  jsonStringByteLength,
  readScalarObject,
  unbox,
  utf8ByteLength
} from "./setting-values.js";

class PreparedLimitReached extends Error {
  /**
   * @param {"depth" | "nodes" | "bytes"} limit
   * @param {number} max
   */
  constructor(limit, max) {
    super(limit);
    this.limit = limit;
    this.max = max;
  }
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
  const Document = /** @type {any} */ (globalThis).foundry?.abstract?.Document;
  const DocumentClass = typeof Document === "function" ? Document : null;
  const ColorClass = getColorClass();
  /** @type {Set<object>} */
  const ancestors = new Set();
  let nodes = 0;
  let bytes = 0;

  /** @param {number} size */
  const charge = (size) => {
    bytes += size;
    if (bytes > PREPARED_VALUE_MAX_BYTES) throw new PreparedLimitReached("bytes", PREPARED_VALUE_MAX_BYTES);
  };
  /**
   * @template T
   * @param {T} emitted
   * @returns {T}
   */
  const leaf = (emitted) => {
    charge(
      typeof emitted === "string"
        ? jsonStringByteLength(emitted, PREPARED_VALUE_MAX_BYTES - bytes)
        : utf8ByteLength(JSON.stringify(emitted) ?? "null")
    );
    return emitted;
  };
  /**
   * @param {Record<string, unknown>} target
   * @param {string} key
   * @param {() => unknown} read
   * @param {boolean} separated
   */
  const entry = (target, key, read, separated) => {
    charge(jsonStringByteLength(key, PREPARED_VALUE_MAX_BYTES - bytes) + (separated ? 2 : 1));
    Object.defineProperty(target, key, {
      value: read(),
      writable: true,
      enumerable: true,
      configurable: true
    });
  };

  /**
   * @param {unknown} node
   * @param {any} field
   * @param {number} depth
   * @returns {unknown}
   */
  const walk = (node, field, depth) => {
    nodes += 1;
    if (nodes > PREPARED_VALUE_MAX_NODES) throw new PreparedLimitReached("nodes", PREPARED_VALUE_MAX_NODES);
    if (depth > PREPARED_VALUE_MAX_DEPTH) throw new PreparedLimitReached("depth", PREPARED_VALUE_MAX_DEPTH);

    if (node === undefined || node === null) return leaf(null);
    const kind = typeof node;
    if (kind === "boolean" || kind === "string") return leaf(node);
    if (kind === "number") return leaf(Number.isFinite(node) ? node : null);
    if (kind !== "object") return leaf({ [UNSERIALIZABLE_MARKER_KEY]: kind });

    const object = /** @type {any} */ (node);
    if (DocumentClass !== null && object instanceof DocumentClass) {
      let stub;
      try {
        stub = {
          documentName: object.documentName ?? null,
          id: object.id ?? null,
          uuid: object.uuid ?? null
        };
      } catch {
        stub = { [UNSERIALIZABLE_MARKER_KEY]: "getter-threw" };
      }
      return leaf(stub);
    }
    if (ancestors.has(object)) return leaf({ [UNSERIALIZABLE_MARKER_KEY]: "circular-reference" });

    ancestors.add(object);
    try {
      const scalar = readScalarObject(object, ColorClass);
      if (scalar.ok) {
        return leaf(typeof scalar.value === "number" && !Number.isFinite(scalar.value) ? null : scalar.value);
      }
      charge(2);
      if (object instanceof Map) {
        const iterator = unbox(Map.prototype.entries, object);
        if (iterator.ok) {
          /** @type {Record<string, unknown>} */
          const result = {};
          let count = 0;
          for (const [key, value] of iterator.value) {
            entry(result, String(key), () => walk(value, null, depth + 1), count++ > 0);
          }
          return result;
        }
      }
      if (object instanceof Set) {
        const iterator = unbox(Set.prototype.values, object);
        if (iterator.ok) {
          return Array.from(iterator.value, (value, index) => {
            if (index > 0) charge(1);
            return walk(value, null, depth + 1);
          });
        }
      }
      if (Array.isArray(object)) {
        const element = elementFieldOf(field);
        const items = [];
        for (let index = 0; index < object.length; index += 1) {
          const own = ownDataValue(object, String(index));
          if (index > 0) charge(1);
          items.push(walk(own.present ? own.value : null, element, depth + 1));
        }
        return items;
      }

      const schema = isDataModelInstance(object) ? (object.schema ?? object.constructor?.schema) : field;
      /** @type {Record<string, any> | null} */
      const fields = schema?.fields && typeof schema.fields === "object" ? schema.fields : null;
      const element = fields ? null : elementFieldOf(field);
      /** @type {Record<string, unknown>} */
      const result = {};
      let count = 0;
      if (fields) {
        for (const key of Object.keys(fields)) {
          let value;
          try {
            value = object[key];
          } catch {
            entry(result, key, () => leaf({ [UNSERIALIZABLE_MARKER_KEY]: "getter-threw" }), count++ > 0);
            continue;
          }
          if (value !== undefined) entry(result, key, () => walk(value, fields[key], depth + 1), count++ > 0);
        }
      }
      for (const key of Object.keys(object)) {
        if (fields && Object.hasOwn(fields, key)) continue;
        const own = ownDataValue(object, key);
        if (own.present && own.value !== undefined) {
          entry(result, key, () => walk(own.value, element, depth + 1), count++ > 0);
        }
      }
      return result;
    } finally {
      ancestors.delete(object);
    }
  };

  try {
    return { value: walk(value, null, 0) };
  } catch (error) {
    if (error instanceof PreparedLimitReached) {
      return {
        value: null,
        omitted: { reason: "too-large", limit: error.limit, max: error.max }
      };
    }
    return { value: null, omitted: { reason: "unreadable" } };
  }
}
