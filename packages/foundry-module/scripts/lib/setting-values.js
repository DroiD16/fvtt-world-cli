import {
  ERROR_CODES,
  SETTING_VALUE_MAX_BYTES,
  SETTING_VALUE_MAX_DEPTH,
  SETTING_VALUE_MAX_NODES
} from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

const NOT_SERIALIZABLE_MESSAGES = Object.freeze({
  bigint:
    "cannot be serialized: the value contains a BigInt, which has no JSON representation (Foundry allows `type: BigInt` on a setting registration)",
  function: "cannot be serialized: the value contains a function, which has no JSON representation",
  symbol: "cannot be serialized: the value contains a symbol, which has no JSON representation",
  "accessor-property":
    "cannot be serialized: the value contains an own getter/setter property, and the bridge never invokes foreign getters",
  "circular-reference": "cannot be serialized: the value contains a circular reference",

  "data-model-read":
    "cannot be serialized: reading the DataModel's source data threw, so the bridge has no value to report"
});

const DIAGNOSTIC_PATH_MAX_LENGTH = 1024;

/**
 * @param {string} path
 * @returns {string}
 */
function boundPath(path) {
  if (path.length <= DIAGNOSTIC_PATH_MAX_LENGTH) {
    return path;
  }

  const budget = DIAGNOSTIC_PATH_MAX_LENGTH - 1;
  let headLength = Math.ceil(budget * 0.75);

  const headLast = path.charCodeAt(headLength - 1);
  if (headLast >= 0xd800 && headLast <= 0xdbff) {
    headLength -= 1;
  }

  let tailStart = path.length - (budget - headLength);

  const tailFirst = path.charCodeAt(tailStart);
  if (tailFirst >= 0xdc00 && tailFirst <= 0xdfff) {
    tailStart += 1;
  }

  return `${path.slice(0, headLength)}…${path.slice(tailStart)}`;
}

/**
 * @param {string} reason
 * @param {string} path
 */
function notSerializable(reason, path) {
  const shown = boundPath(path);
  return createBridgeError(
    ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE,
    `Setting value at ${shown} ${NOT_SERIALIZABLE_MESSAGES[reason]}`,
    { reason, path: shown }
  );
}

/**
 * @param {"value-depth" | "value-nodes" | "value-bytes"} limit
 * @param {string} path
 * @param {number} max
 */
function tooLarge(limit, path, max) {
  const what =
    limit === "value-depth"
      ? `nests deeper than the ${max}-level limit`
      : limit === "value-nodes"
        ? `contains more than the ${max}-node limit`
        : `exceeds the ${max}-byte serialized limit`;
  const shown = boundPath(path);
  return createBridgeError(
    ERROR_CODES.PAYLOAD_TOO_LARGE,
    `Setting value ${what} (first exceeded at ${shown}); the value is too large to return through the bridge`,
    { limit, path: shown, max }
  );
}

/**
 * @param {string} text
 * @returns {number}
 */
export function utf8ByteLength(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

/**
 * @param {string} text
 * @returns {number}
 */
export function jsonStringByteLength(text) {
  let bytes = 2;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) {
      bytes += 2;
    } else if (code < 0x20) {
      bytes += code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6;
    } else if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xd800 && code <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

function getDataModelClass() {
  const DataModel = /** @type {any} */ (globalThis).foundry?.abstract?.DataModel;
  return typeof DataModel === "function" ? DataModel : null;
}

function isDataModelInstance(value) {
  const DataModel = getDataModelClass();
  return DataModel !== null && value instanceof DataModel;
}

function getColorClass() {
  const scope = /** @type {any} */ (globalThis);
  const Color = scope.foundry?.utils?.Color ?? scope.Color;

  return typeof Color === "function" && typeof Color.prototype === "object" && Color.prototype !== null
    ? Color
    : null;
}

/**
 * @param {number} numeric
 * @returns {string}
 */
function colorToCss(numeric) {
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0xffffff) {
    return "";
  }

  return `#${Number.prototype.toString.call(numeric, 16).padStart(6, "0")}`;
}

/**
 * @param {Function} intrinsic
 * @param {object} node
 * @returns {{ ok: boolean, value: any }}
 */
function unbox(intrinsic, node) {
  try {
    return { ok: true, value: intrinsic.call(node) };
  } catch {
    return { ok: false, value: undefined };
  }
}

/**
 * @param {any} value
 * @returns {{ ok: boolean, value: any }}
 */
function dataModelToObject(value) {
  try {
    const DataModel = getDataModelClass();
    const intrinsic = DataModel?.prototype?.toObject;
    if (typeof intrinsic === "function") {
      return { ok: true, value: intrinsic.call(value) };
    }

    return { ok: true, value: typeof value?.toObject === "function" ? value.toObject() : {} };
  } catch {
    return { ok: false, value: undefined };
  }
}

/**
 * @param {unknown} value
 * @param {{ maxDepth?: number, maxNodes?: number, maxBytes?: number }} [limits]
 * @returns {unknown}
 */
export function serializeSettingValue(value, limits = {}) {
  const maxDepth = limits.maxDepth ?? SETTING_VALUE_MAX_DEPTH;
  const maxNodes = limits.maxNodes ?? SETTING_VALUE_MAX_NODES;
  const maxBytes = limits.maxBytes ?? SETTING_VALUE_MAX_BYTES;

  let nodes = 0;
  let bytes = 0;
  /** @type {Set<object>} */
  const ancestors = new Set();

  const ColorClass = getColorClass();

  /**
   * @param {number} amount
   * @param {string} path
   */
  const chargeBytes = (amount, path) => {
    bytes += amount;
    if (bytes > maxBytes) {
      throw tooLarge("value-bytes", path, maxBytes);
    }
  };

  /**
   * @param {unknown} node
   * @param {string} path
   * @param {number} depth
   * @param {number} [wrapperHops]
   * @returns {unknown}
   */
  const walk = (node, path, depth, wrapperHops = 0) => {
    if (wrapperHops === 0) {
      nodes += 1;
      if (nodes > maxNodes) {
        throw tooLarge("value-nodes", path, maxNodes);
      }
    } else if (wrapperHops > maxDepth) {
      throw tooLarge("value-depth", path, maxDepth);
    }

    if (depth > maxDepth) {
      throw tooLarge("value-depth", path, maxDepth);
    }

    if (node === undefined || node === null) {
      chargeBytes(4, path);
      return null;
    }

    const kind = typeof node;

    if (kind === "boolean") {
      chargeBytes(node ? 4 : 5, path);
      return node;
    }

    if (kind === "number") {
      if (!Number.isFinite(node)) {
        chargeBytes(4, path);
        return null;
      }

      chargeBytes(String(node).length, path);
      return node;
    }

    if (typeof node === "string") {
      chargeBytes(jsonStringByteLength(node), path);
      return node;
    }

    if (kind === "bigint" || kind === "function" || kind === "symbol") {
      throw notSerializable(kind, path);
    }

    if (ancestors.has(/** @type {object} */ (node))) {
      throw notSerializable("circular-reference", path);
    }

    ancestors.add(/** @type {object} */ (node));
    try {
      if (node instanceof Date) {
        const time = unbox(Date.prototype.getTime, /** @type {object} */ (node));
        if (time.ok) {
          if (!Number.isFinite(time.value)) {
            chargeBytes(4, path);
            return null;
          }

          const iso = Date.prototype.toISOString.call(node);
          chargeBytes(jsonStringByteLength(iso), path);
          return iso;
        }
      }

      if (ColorClass !== null && node instanceof ColorClass) {
        const numeric = unbox(Number.prototype.valueOf, /** @type {object} */ (node));
        if (numeric.ok) {
          const css = colorToCss(numeric.value);
          chargeBytes(jsonStringByteLength(css), path);
          return css;
        }
      }

      if (node instanceof Number || node instanceof String || node instanceof Boolean) {
        const intrinsic =
          node instanceof Number
            ? Number.prototype.valueOf
            : node instanceof String
              ? String.prototype.valueOf
              : Boolean.prototype.valueOf;
        const unboxed = unbox(intrinsic, /** @type {object} */ (node));
        if (unboxed.ok) {
          return walk(unboxed.value, path, depth, wrapperHops + 1);
        }
      }

      if (node instanceof Map) {
        const iterator = unbox(Map.prototype.entries, /** @type {object} */ (node));
        if (iterator.ok) {
          chargeBytes(2, path);
          const pairs = [];
          let index = 0;
          for (const [key, mapValue] of iterator.value) {
            const pairPath = `${path}[${index}]`;

            if (index > 0) {
              chargeBytes(1, path);
            }

            nodes += 1;
            if (nodes > maxNodes) {
              throw tooLarge("value-nodes", pairPath, maxNodes);
            }

            if (depth + 1 > maxDepth) {
              throw tooLarge("value-depth", pairPath, maxDepth);
            }

            chargeBytes(3, pairPath);
            pairs.push([walk(key, `${pairPath}[0]`, depth + 2), walk(mapValue, `${pairPath}[1]`, depth + 2)]);
            index += 1;
          }

          return pairs;
        }
      }

      if (node instanceof Set) {
        const iterator = unbox(Set.prototype.values, /** @type {object} */ (node));
        if (iterator.ok) {
          chargeBytes(2, path);
          const values = [];
          let index = 0;
          for (const setValue of iterator.value) {
            if (index > 0) {
              chargeBytes(1, path);
            }

            values.push(walk(setValue, `${path}[${index}]`, depth + 1));
            index += 1;
          }

          return values;
        }
      }

      if (isDataModelInstance(node)) {
        const source = dataModelToObject(node);
        if (!source.ok) {
          throw notSerializable("data-model-read", path);
        }

        return walk(source.value, path, depth, wrapperHops + 1);
      }

      if (Array.isArray(node)) {
        chargeBytes(2, path);

        if (node.length <= maxNodes) {
          for (let index = 0; index < node.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(node, index);
            if (
              descriptor &&
              (typeof descriptor.get === "function" || typeof descriptor.set === "function")
            ) {
              throw notSerializable("accessor-property", `${path}[${index}]`);
            }
          }
        } else {
          for (const name of Object.getOwnPropertyNames(node)) {
            if (!/^(?:0|[1-9][0-9]*)$/.test(name) || Number(name) >= node.length) {
              continue;
            }

            const descriptor = Object.getOwnPropertyDescriptor(node, name);
            if (
              descriptor &&
              (typeof descriptor.get === "function" || typeof descriptor.set === "function")
            ) {
              throw notSerializable("accessor-property", `${path}[${name}]`);
            }
          }
        }

        const items = [];
        for (let index = 0; index < node.length; index += 1) {
          if (index > 0) {
            chargeBytes(1, path);
          }

          const descriptor = Object.getOwnPropertyDescriptor(node, index);
          const elementPath = `${path}[${index}]`;
          if (descriptor && (typeof descriptor.get === "function" || typeof descriptor.set === "function")) {
            throw notSerializable("accessor-property", elementPath);
          }

          items.push(walk(descriptor ? descriptor.value : undefined, elementPath, depth + 1));
        }

        return items;
      }

      chargeBytes(2, path);

      for (const key of Object.getOwnPropertyNames(/** @type {object} */ (node))) {
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (descriptor && (typeof descriptor.get === "function" || typeof descriptor.set === "function")) {
          throw notSerializable("accessor-property", `${path}.${key}`);
        }
      }

      /** @type {Record<string, unknown>} */
      const result = {};
      let first = true;
      for (const key of Object.getOwnPropertyNames(/** @type {object} */ (node))) {
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (!descriptor) {
          continue;
        }

        const childPath = `${path}.${key}`;

        chargeBytes(jsonStringByteLength(key) + 1 + (first ? 0 : 1), childPath);
        first = false;

        Object.defineProperty(result, key, {
          value: walk(descriptor.value, childPath, depth + 1),
          writable: true,
          enumerable: true,
          configurable: true
        });
      }

      return result;
    } finally {
      ancestors.delete(/** @type {object} */ (node));
    }
  };

  return walk(value, "$", 0);
}
