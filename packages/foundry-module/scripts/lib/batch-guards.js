import { ERROR_CODES, PATCH_MAX_DEPTH } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

/** @param {unknown} value */
export function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * @param {any} entry
 * @returns {boolean}
 */
function usableEntryId(entry) {
  const id = entry?._id;
  return typeof id === "string" && id.length > 0;
}

/**
 * @param {string} rawKey
 * @returns {{ segments: string[], operators: Array<"delete" | "replace" | null>, path: string, root: string, operatorAt: number, target: string[] }}
 */
export function parsePatchKey(rawKey) {
  /** @type {string[]} */
  const segments = [];
  /** @type {Array<"delete" | "replace" | null>} */
  const operators = [];
  for (const segment of rawKey.split(".")) {
    const operator = segment.startsWith("-=") ? "delete" : segment.startsWith("==") ? "replace" : null;
    segments.push(operator ? segment.slice(2) : segment);
    operators.push(operator);
  }
  const operatorAt = operators.findIndex((operator) => operator !== null);
  return {
    segments,
    operators,
    path: segments.join("."),
    root: segments[0],
    operatorAt,
    target: operatorAt < 0 ? segments : segments.slice(0, operatorAt + 1)
  };
}

const SERIALIZED_OPERATOR_KEY = "__$OPERATOR$__";
const RESERVED_KEY_SEGMENTS = new Set(["__proto__", "constructor", "prototype", SERIALIZED_OPERATOR_KEY]);

/**
 * @param {string} key
 * @returns {string | undefined}
 */
function reservedSegmentOf(key) {
  return parsePatchKey(key).segments.find((segment) => RESERVED_KEY_SEGMENTS.has(segment));
}

/**
 * @param {unknown} root
 * @returns {{ key: string, segment: string } | null}
 */
export function findReservedKeySegment(root) {
  /** @typedef {{ value: unknown, key: string, parent: Visit | null }} Visit */
  /** @type {Visit[]} */
  const pending = [{ value: root, key: "", parent: null }];
  while (pending.length > 0) {
    const visit = /** @type {Visit} */ (pending.pop());
    const { value } = visit;
    if (value === null || typeof value !== "object") continue;
    for (const key of Object.keys(value)) {
      const segment = reservedSegmentOf(key);
      if (segment !== undefined) {
        const path = [key];
        for (let node = /** @type {Visit | null} */ (visit); node?.parent; node = node.parent)
          path.push(node.key);
        return { key: path.reverse().join("."), segment };
      }
      pending.push({ value: /** @type {Record<string, unknown>} */ (value)[key], key, parent: visit });
    }
  }
  return null;
}

/**
 * @param {string[]} path
 * @returns {never}
 */
function refuseTooDeep(path) {
  const field = `${path.slice(0, PATCH_MAX_DEPTH + 1).join(".")}${path.length > PATCH_MAX_DEPTH + 1 ? "…" : ""}`;
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `The patch key "${field}" nests deeper than the ${PATCH_MAX_DEPTH}-level limit. Stored Foundry ` +
      `documents nest far less deeply, so the bridge refuses the patch instead of expanding it. Send a ` +
      `shallower patch.`,
    { field, limit: "patch-depth", max: PATCH_MAX_DEPTH }
  );
}

/**
 * @param {string} key
 * @param {string} segment
 * @param {{ subject?: string, details?: Record<string, unknown> }} [context]
 * @returns {never}
 */
export function refuseReservedSegment(key, segment, { subject = "The patch", details = {} } = {}) {
  const reason =
    segment === SERIALIZED_OPERATOR_KEY
      ? `That name is Foundry 14's internal form of a deletion or forced replacement: Foundry 14 rebuilds the ` +
        `operator from it and replaces the whole object, dropping every other key beside it, while Foundry 13 ` +
        `stores it as data. Send a "-=key" deletion or a "==key" replacement instead.`
      : `That name is a JavaScript object internal, never a document field or setting key, and the bridge ` +
        `refuses it so that no request can reach an object prototype. Remove the key and resend.`;
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `${subject} has the key "${key}", which contains the segment "${segment}". ${reason}`,
    { ...details, field: key, reservedSegment: segment }
  );
}

/**
 * @param {string} key
 * @param {string} arrayPath
 * @returns {never}
 */
function refuseArrayDescent(key, arrayPath) {
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `The patch key "${key}" writes inside the array that another key of the same patch sets at "${arrayPath}". ` +
      `Foundry rebuilds an array from the patch instead of changing one entry, so the bridge refuses the ` +
      `combination. Send the whole array in one key.`,
    { field: key, arrayField: arrayPath }
  );
}

/**
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} source
 * @param {string[]} path
 * @param {string} key
 * @returns {Record<string, unknown>}
 */
function mergeExpanded(target, source, path, key) {
  for (const [name, value] of Object.entries(source)) {
    const current = target[name];
    if (Array.isArray(current) && isPlainObject(value)) refuseArrayDescent(key, [...path, name].join("."));
    target[name] =
      isPlainObject(value) && isPlainObject(current)
        ? mergeExpanded(
            /** @type {Record<string, unknown>} */ (current),
            /** @type {Record<string, unknown>} */ (value),
            [...path, name],
            key
          )
        : value;
  }
  return target;
}

/**
 * @param {unknown} value
 * @param {string[]} prefix
 * @returns {unknown}
 */
function expandValue(value, prefix) {
  if (Array.isArray(value)) {
    if (value.length > 0 && prefix.length >= PATCH_MAX_DEPTH) refuseTooDeep([...prefix, "0"]);
    return value.map((entry, index) => expandValue(entry, [...prefix, String(index)]));
  }
  return isPlainObject(value) ? expandKeys(/** @type {Record<string, unknown>} */ (value), prefix) : value;
}

/**
 * @param {Record<string, unknown>} object
 * @param {string[]} prefix
 * @returns {Record<string, unknown>}
 */
function expandKeys(object, prefix) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(object)) {
    const key = [...prefix, rawKey].join(".");
    const reserved = reservedSegmentOf(rawKey);
    if (reserved !== undefined) refuseReservedSegment(key, reserved);
    const segments = rawKey.split(".");
    if (prefix.length + segments.length > PATCH_MAX_DEPTH) refuseTooDeep([...prefix, ...segments]);
    /** @type {Record<string, unknown>} */
    let node = out;
    for (const [depth, segment] of segments.slice(0, -1).entries()) {
      if (Array.isArray(node[segment]))
        refuseArrayDescent(key, [...prefix, ...segments.slice(0, depth + 1)].join("."));
      if (!isPlainObject(node[segment])) node[segment] = {};
      node = /** @type {Record<string, unknown>} */ (node[segment]);
    }
    const last = /** @type {string} */ (segments.at(-1));
    const value = expandValue(rawValue, [...prefix, ...segments]);
    if (Array.isArray(node[last]) && isPlainObject(value))
      refuseArrayDescent(key, [...prefix, ...segments].join("."));
    node[last] =
      isPlainObject(value) && isPlainObject(node[last])
        ? mergeExpanded(
            /** @type {Record<string, unknown>} */ (node[last]),
            /** @type {Record<string, unknown>} */ (value),
            [...prefix, ...segments],
            key
          )
        : value;
  }
  return out;
}

/**
 * @param {Record<string, any>} patch
 * @returns {Record<string, any>}
 */
export function expandPatch(patch) {
  return isPlainObject(patch) ? /** @type {Record<string, any>} */ (expandKeys(patch, [])) : patch;
}

/** @param {string} key */
function isArrayIndexKey(key) {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0;
}

/**
 * @param {unknown} patch
 * @param {unknown} stored
 * @param {string[]} path
 * @param {any} [documentClass]
 * @returns {{ field: string, arrayField: string, movedTo?: string } | null}
 */
function findStoredArrayDescent(patch, stored, path, documentClass = null) {
  if (!isPlainObject(patch) || !isPlainObject(stored)) return null;
  const storedObject = /** @type {Record<string, unknown>} */ (stored);
  for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (patch))) {
    if (key === "_id") continue;
    const parsed = parsePatchKey(key);
    const operator = parsed.operators[0];
    if (operator === "delete") continue;
    const name = parsed.root;
    const storedValue = storedObject[name];
    const here = [...path, name];
    const movedTo = path.length === 0 ? findMigratedArrayTarget(documentClass, name) : null;
    if (movedTo) {
      const firstKey = isPlainObject(value)
        ? Object.keys(/** @type {Record<string, unknown>} */ (value))[0]
        : undefined;
      if (firstKey !== undefined)
        return { field: `${name}.${parsePatchKey(firstKey).root}`, arrayField: name, movedTo };
      continue;
    }
    if (Array.isArray(storedValue)) {
      if (isPlainObject(value)) {
        const innerKey = Object.keys(/** @type {Record<string, unknown>} */ (value)).find(
          (inner) => path.length > 0 || isArrayIndexKey(parsePatchKey(inner).root)
        );
        if (innerKey !== undefined) {
          return { field: [...here, parsePatchKey(innerKey).root].join("."), arrayField: here.join(".") };
        }
      } else if (Array.isArray(value) && operator !== "replace") {
        /** @type {Map<unknown, unknown> | null} */
        let storedById = null;
        for (const [position, entry] of value.entries()) {
          const entryId = isPlainObject(entry)
            ? /** @type {Record<string, unknown>} */ (entry)._id
            : undefined;
          if (typeof entryId !== "string") continue;
          storedById ??= new Map(
            storedValue
              .filter((candidate) => isPlainObject(candidate))
              .map((candidate) => [candidate._id, candidate])
          );
          const inner = findStoredArrayDescent(entry, storedById.get(entryId), [...here, String(position)]);
          if (inner) return inner;
        }
      }
      continue;
    }
    if (operator === "replace") continue;
    const inner = findStoredArrayDescent(value, storedValue, here);
    if (inner) return inner;
  }
  return null;
}

/** @param {{ expandedPatch: Record<string, any>, stored: unknown, documentClass?: any, index?: number, command?: string, id?: string, coordinate?: string }} args */
export function assertNoStoredArrayDescent({
  expandedPatch,
  stored,
  documentClass = null,
  index,
  command,
  id,
  coordinate = `${command} element ${index} (id ${id})`
}) {
  const descent = findStoredArrayDescent(expandedPatch, stored, [], documentClass);
  if (!descent) return;
  if (descent.movedTo) {
    refuseMigratedRootWrite({
      coordinate,
      field: descent.field,
      rootKey: descent.arrayField,
      movedTo: descent.movedTo,
      index,
      id
    });
  }
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `${coordinate} writes "${descent.field}" inside the stored array "${descent.arrayField}". Foundry does not ` +
      `change one entry of an array: it rebuilds the array from the patch, so every entry the patch does not ` +
      `name is lost while the write still succeeds. Send the whole array instead: read it, change the entry ` +
      `you mean, and send all entries back.`,
    { ...elementCoordinates(index, id), field: descent.field, arrayField: descent.arrayField }
  );
}

/**
 * @param {number | undefined} index
 * @param {string | undefined} id
 */
function elementCoordinates(index, id) {
  return index === undefined ? {} : { index, id };
}

/**
 * @param {{ coordinate: string, field: string, rootKey: string, movedTo: string, index?: number, id?: string }} args
 * @returns {never}
 */
function refuseMigratedRootWrite({ coordinate, field, rootKey, movedTo, index, id }) {
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `${coordinate} writes "${field}", inside "${rootKey}", which this Foundry version does NOT declare at the ` +
      `top level: the field has MOVED to "${movedTo}", and a write inside the field is not migrated by this ` +
      `Foundry version. An update silently discards such a write, so it would be reported as applied while ` +
      `nothing changed; a clone (or an import, when the game system migrates the key) rebuilds the copy's ` +
      `array from these keys alone and loses every entry they do not name. Send the whole array as ` +
      `"${rootKey}": [ … ] (or write "${movedTo}" directly — that spelling is judged by the same rule) and retry.`,
    { ...elementCoordinates(index, id), field, arrayField: rootKey, movedTo }
  );
}

/** @param {{ rawPatch: Record<string, any>, stored: unknown, documentClass?: any, index?: number, command?: string, id?: string, coordinate?: string }} args */
export function assertNoTopLevelDottedArrayWrite({
  rawPatch,
  stored,
  documentClass = null,
  index,
  command,
  id,
  coordinate = `${command} element ${index} (id ${id})`
}) {
  if (!isPlainObject(rawPatch) || !isPlainObject(stored)) return;
  const storedSource = /** @type {Record<string, unknown>} */ (stored);
  for (const [rawKey, value] of Object.entries(rawPatch)) {
    const parsedKey = parsePatchKey(rawKey);
    if (parsedKey.segments.length < 2 || parsedKey.operators[0] === "delete") continue;
    const rootKey = parsedKey.root;
    const movedTo = findMigratedArrayTarget(documentClass, rootKey);
    if (movedTo) refuseMigratedRootWrite({ coordinate, field: rawKey, rootKey, movedTo, index, id });
    if (!Array.isArray(storedSource[rootKey])) continue;
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `${coordinate} writes the dotted path "${rawKey}" INSIDE the ARRAY field ` +
        `"${rootKey}". Foundry does NOT patch an array in place: it REBUILDS the array from this patch alone, so ` +
        `every entry the patch does not name is DESTROYED — and when the rebuilt array fails the field's own ` +
        `validator, Foundry drops the whole write with only a UI notification, so the write would be ` +
        `reported as applied while the stored array lost data or kept none of it. Send the WHOLE array instead ` +
        `(for a Wall, "c": [x1, y1, x2, y2]): read it first, change the entry you mean, send all of them back, ` +
        `and retry.`,
      {
        ...elementCoordinates(index, id),
        field: rawKey,
        arrayField: rootKey,
        requested: value,
        stored: storedSource[rootKey]
      }
    );
  }
}

/**
 * @param {{ rawPatch: Record<string, any>, expandedPatch: Record<string, any>, stored: unknown, documentClass?: any, subject: string }} args
 */
export function assertPatchFitsStored({ rawPatch, expandedPatch, stored, documentClass, subject }) {
  assertNoAmbiguousBatchKeySpellings({ expandedPatch, coordinate: subject });
  assertNoTopLevelDottedArrayWrite({ rawPatch, stored, documentClass, coordinate: subject });
  assertNoStoredArrayDescent({ expandedPatch, stored, documentClass, coordinate: subject });
}

/**
 * @param {unknown} value
 * @param {string[]} prefix
 * @param {boolean} inArray
 * @returns {{ rule: 1 | 2, path: string, root: string, spellings: string[], where: string } | null}
 */
function findOperatorConflict(value, prefix, inArray) {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const inner = findOperatorConflict(entry, [...prefix, String(index)], true);
      if (inner) return inner;
    }
    return null;
  }
  if (!isPlainObject(value)) return null;
  const object = /** @type {Record<string, unknown>} */ (value);
  /** @type {Map<string, Array<{ key: string, operator: boolean }>>} */
  const byName = new Map();
  for (const key of Object.keys(object)) {
    if (key === "_id") continue;
    const parsed = parsePatchKey(key);
    byName.set(parsed.root, [...(byName.get(parsed.root) ?? []), { key, operator: parsed.operatorAt >= 0 }]);
  }
  for (const [name, keys] of byName) {
    if (keys.length < 2 || !keys.some((entry) => entry.operator)) continue;
    const plain = keys.find((entry) => !entry.operator);
    const path = [...prefix, name];
    return {
      rule: plain && isPlainObject(object[plain.key]) ? 2 : 1,
      path: path.join("."),
      root: path[0],
      spellings: keys.map((entry) => [...prefix, entry.key].join(".")),
      where: inArray
        ? "inside an array entry"
        : prefix.length > 0
          ? "inside a nested object"
          : "at the top level"
    };
  }
  for (const [key, inner] of Object.entries(object)) {
    if (parsePatchKey(key).operatorAt >= 0) continue;
    const conflict = findOperatorConflict(inner, [...prefix, key], inArray);
    if (conflict) return conflict;
  }
  return null;
}

/** @param {{ expandedPatch: Record<string, any>, index?: number, command?: string, id?: string, coordinate?: string }} args */
export function assertNoAmbiguousBatchKeySpellings({
  expandedPatch,
  index,
  command,
  id,
  coordinate = `${command} element ${index} (id ${id})`
}) {
  const conflict = findOperatorConflict(expandedPatch, [], false);
  if (!conflict) return;
  const { rule, path, root, spellings, where } = conflict;
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `${coordinate} writes the field "${path}" ${where} through more than one key, one of them an operator: ` +
      `${spellings.map((key) => `"${key}"`).join(" and ")}. A "-=" deletion or "==" replacement of a field ` +
      `cannot be combined with another write to the same field, and Foundry resolves the combination ` +
      `differently on the two supported cores. Send one key: the "==${path.split(".").at(-1)}" replacement ` +
      `alone with the complete value, or the plain key without the operator.`,
    {
      ...elementCoordinates(index, id),
      field: path,
      ambiguousRoot: root,
      ambiguousKeys: spellings,
      ambiguityRule: rule
    }
  );
}

/** @param {Record<string, unknown>} value */
function definedKeys(value) {
  return Object.keys(value).filter((key) => value[key] !== undefined);
}

/**
 * An own key holding `undefined` equals an absent key: Foundry produces both for the same state.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function sourceValuesEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((entry, index) => sourceValuesEqual(entry, b[index]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const left = /** @type {Record<string, unknown>} */ (a);
  const right = /** @type {Record<string, unknown>} */ (b);
  const leftKeys = definedKeys(left);
  if (leftKeys.length !== definedKeys(right).length) return false;
  return leftKeys.every((key) => right[key] !== undefined && sourceValuesEqual(left[key], right[key]));
}

/** @param {{ documentClass: any, patch: Record<string, any>, merged: any, stored?: any, index: number, command: string, id: string, coordinate?: string }} args */
export function assertBatchArrayWritesReflected({
  documentClass,
  patch,
  merged,
  stored,
  index,
  command,
  id,
  coordinate = `${command} element ${index} (id ${id})`
}) {
  const schema = documentClass?.schema;
  const source = readDocumentSource(merged);

  const preSource = stored === undefined ? null : readDocumentSource(stored);
  if (!schema || typeof schema.get !== "function" || !source) {
    return;
  }

  for (const [rawKey, value] of Object.entries(patch ?? {})) {
    const parsedKey = parsePatchKey(rawKey);
    const operator =
      parsedKey.operators[0] === "replace" ? "==" : parsedKey.operators[0] === "delete" ? "-=" : "";
    const rootKey = parsedKey.root;
    if (!rootKey) continue;

    let field;
    try {
      field = schema.get(rootKey);
    } catch {
      field = null;
    }
    if (!field) {
      assertMigratedArrayKeyReflected({
        documentClass,
        rawKey,
        rootKey,
        operator,
        value,
        source,

        merged,

        preSource,
        index,
        id,
        coordinate
      });
      continue;
    }

    if (operator === "-=") continue;

    assertMigratedSystemArrayReflected({
      documentClass,
      rawKey,
      value,
      source,
      merged,
      preSource,
      index,
      id,
      coordinate
    });

    const kind = classifyArrayBackedField(field);
    if (!kind) continue;

    if (sourceValuesEqual(value, source[rootKey])) continue;

    if (kind === "embedded-collection") {
      assertBatchEcfEntriesReflected({
        field,
        rootKey,
        rawKey,
        value,
        source,
        preSource,
        index,
        id,
        coordinate
      });
      continue;
    }

    if (typeof field.clean !== "function") continue;

    let expected;
    try {
      expected = field.clean(structuredCloneish(value));
    } catch {
      expected = undefined;
    }

    if (!sourceValuesEqual(expected, source[rootKey])) {
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        `${coordinate} sets "${rawKey}" to a value this Foundry version SILENTLY DISCARDS: ` +
          `the merged document keeps ${JSON.stringify(source[rootKey])}. Foundry 14 drops an invalid array field ` +
          `without an error (Foundry 13 rejects it outright), so the write would be reported as applied while ` +
          `nothing changed. Fix the value (a Wall's "c", for example, must be exactly four numbers) and retry.`,
        { index, id, field: rawKey, arrayField: rootKey, requested: value, stored: source[rootKey] ?? null }
      );
    }

    if (!arrayWriteLanded({ field, value, rootKey, source, preSource })) {
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        `${coordinate} sets "${rawKey}" to a value the element schema does not accept, ` +
          `and this Foundry version SILENTLY DISCARDS it: cleaning it COLLAPSES onto the value already stored ` +
          `(${JSON.stringify(source[rootKey])}), so nothing changes and the write would be reported as applied. ` +
          `Send an array of values the field accepts (for a set-valued field such as a Wall's "levels", an array ` +
          `of level ids) and retry.`,
        { index, id, field: rawKey, arrayField: rootKey, requested: value, stored: source[rootKey] ?? null }
      );
    }
  }
}

/** @param {{ documentClass: any, rawKey: string, rootKey: string, operator: ""|"=="|"-=", value: unknown, source: Record<string, any>, merged?: any, preSource?: Record<string, any>|null, index: number, id: string, coordinate: string }} args */
function assertMigratedArrayKeyReflected({
  documentClass,
  rawKey,
  rootKey,
  operator,
  value,
  source,
  merged,
  preSource = null,
  index,
  id,
  coordinate
}) {
  const movedTo = findMigratedArrayTarget(documentClass, rootKey);
  if (!movedTo) return;

  const system = source?.system;
  const storedNow =
    (system && typeof system === "object" && !Array.isArray(system) ? system[rootKey] : undefined) ?? null;

  const migratedValue = operator ? undefined : migratedArrayValue(documentClass, rootKey, value);
  if (migratedValue !== undefined) {
    if (migratedArrayWriteLanded({ merged, rootKey, migratedValue, storedNow, preSource })) return;
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `${coordinate} sets "${rawKey}" — a field this Foundry version has MOVED to ` +
        `"${movedTo}" — to a value the moved field does NOT accept, and this Foundry version SILENTLY ` +
        `DISCARDS it: the merged document keeps ${JSON.stringify(storedNow)} there, so nothing changes and ` +
        `the write would be reported as applied. Send entries the field accepts (an ActiveEffect change ` +
        `"type", for example, must be dot-delimited alphanumeric segments of at least three characters, or ` +
        `"custom.<number>" — a hyphen or an underscore is rejected) and retry.`,
      {
        index,
        id,
        field: rawKey,
        arrayField: rootKey,
        movedTo,
        requested: value ?? null,
        stored: storedNow
      }
    );
  }

  const reason = operator
    ? `a legacy "${operator}" operator key is not migrated by this Foundry version`
    : `this Foundry version migrates the field only when the value is an ARRAY`;
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `${coordinate} writes "${rawKey}", which this Foundry version does NOT declare at ` +
      `the top level: the field has MOVED to "${movedTo}", and ${reason}. The write is SILENTLY DISCARDED — ` +
      `no error, no diff — so it would be reported as applied while nothing changed. Send the whole array as ` +
      `"${rootKey}": [ … ] (or write "${movedTo}" directly — that spelling is judged by the same rule) and retry.`,
    {
      index,
      id,
      field: rawKey,
      arrayField: rootKey,
      movedTo,
      requested: value ?? null,
      stored: storedNow
    }
  );
}

/** @param {{ documentClass: any, rawKey: string, value: unknown, source: Record<string, any>, merged?: any, preSource?: Record<string, any>|null, index: number, id: string, coordinate: string }} args */
function assertMigratedSystemArrayReflected({
  documentClass,
  rawKey,
  value,
  source,
  merged,
  preSource = null,
  index,
  id,
  coordinate
}) {
  const migrationRoot = parsePatchKey(rawKey).root;
  if (!migrationRoot || !isPlainObject(value)) return;

  for (const [entryKey, requested] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
    const candidateKey = parsePatchKey(entryKey).root;
    if (!candidateKey) continue;

    const movedTo = findMigratedArrayTarget(documentClass, candidateKey);
    if (movedTo !== `${migrationRoot}.${candidateKey}`) continue;

    const container = source?.[migrationRoot];
    const storedNow =
      (container && typeof container === "object" && !Array.isArray(container)
        ? container[candidateKey]
        : undefined) ?? null;

    if (sourceValuesEqual(requested, storedNow)) continue;
    if (
      migratedArrayWriteLanded({
        merged,
        rootKey: candidateKey,
        migratedValue: requested,
        storedNow,
        preSource
      })
    ) {
      continue;
    }

    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `${coordinate} sets "${movedTo}"${rawKey === movedTo ? "" : ` (through "${rawKey}")`} ` +
        `to a value that field does NOT accept, and this Foundry version SILENTLY DISCARDS it: the merged ` +
        `document keeps ${JSON.stringify(storedNow)} there, so nothing changes and the write would be reported ` +
        `as applied. Send entries the field accepts (an ActiveEffect change "type", for example, must be ` +
        `dot-delimited alphanumeric segments of at least three characters, or "custom.<number>" — a hyphen or ` +
        `an underscore is rejected) and retry.`,
      {
        index,
        id,
        field: rawKey,
        arrayField: candidateKey,
        movedTo,
        requested,
        stored: storedNow
      }
    );
  }
}

/**
 * @param {{ merged: any, rootKey: string, migratedValue: unknown, storedNow: unknown, preSource: Record<string, any>|null }} args
 * @returns {boolean}
 */
function migratedArrayWriteLanded({ merged, rootKey, migratedValue, storedNow, preSource }) {
  let expected = migratedValue;
  const field = systemModelField(merged, rootKey);
  if (typeof field?.clean === "function") {
    try {
      expected = field.clean(structuredCloneish(migratedValue));
    } catch {
      expected = undefined;
    }
  }
  if (sourceValuesEqual(expected, storedNow)) return true;

  if (!preSource) return false;
  const system = preSource.system;
  const storedBefore =
    (system && typeof system === "object" && !Array.isArray(system) ? system[rootKey] : undefined) ?? null;
  return !sourceValuesEqual(storedNow, storedBefore);
}

/**
 * @param {any} document
 * @param {string} key
 * @returns {any}
 */
function systemModelField(document, key) {
  try {
    return document?.system?.schema?.get?.(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {any} documentClass
 * @param {string} rootKey
 * @returns {string|null}
 */
function findMigratedArrayTarget(documentClass, rootKey) {
  return migratedArrayValue(documentClass, rootKey, []) === undefined ? null : `system.${rootKey}`;
}

/**
 * @param {any} documentClass
 * @param {string} rootKey
 * @param {unknown} value
 * @returns {unknown[]|undefined}
 */
function migratedArrayValue(documentClass, rootKey, value) {
  const migrateData = documentClass?.migrateData;
  if (typeof migrateData !== "function") return undefined;
  let migrated;
  try {
    migrated = migrateData.call(documentClass, { [rootKey]: structuredCloneish(value) });
  } catch {
    return undefined;
  }
  const system = migrated?.system;
  if (!system || typeof system !== "object" || Array.isArray(system) || !isPlainObject(system))
    return undefined;
  if (!Object.hasOwn(system, rootKey) || !Array.isArray(system[rootKey])) return undefined;
  return system[rootKey];
}

/**
 * @param {any} source
 * @param {string} rootKey
 * @returns {string|null}
 */
function findShimmedArrayPath(source, rootKey) {
  const system = source?.system;
  if (!system || typeof system !== "object" || Array.isArray(system) || !isPlainObject(system)) return null;
  if (!Object.hasOwn(system, rootKey) || !Array.isArray(system[rootKey])) return null;
  return `system.${rootKey}`;
}

/**
 * @param {{ field: any, value: unknown, rootKey: string, source: Record<string, any>, preSource: Record<string, any>|null }} args
 * @returns {boolean}
 */
function arrayWriteLanded({ field, value, rootKey, source, preSource }) {
  if (typeof field?.validate !== "function") return true;
  let failure = null;
  try {
    failure = field.validate(structuredCloneish(value), { strict: false, partial: true });
  } catch {
    return true;
  }
  if (!failure?.unresolved) return true;

  if (!preSource) return false;
  return !sourceValuesEqual(source[rootKey], preSource[rootKey]);
}

/**
 * @param {any} field
 * @returns {"array"|"embedded-collection"|null}
 */
function classifyArrayBackedField(field) {
  if (!field) return null;
  const fieldClasses = /** @type {any} */ (globalThis).foundry?.data?.fields;
  const ArrayFieldClass = fieldClasses?.ArrayField;
  const EcfClass = fieldClasses?.EmbeddedCollectionField;

  const isEcf =
    typeof EcfClass === "function"
      ? field instanceof EcfClass
      : typeof field.getCollection === "function" && Boolean(field.schema);

  let isArrayBacked;
  if (typeof ArrayFieldClass === "function") {
    isArrayBacked = field instanceof ArrayFieldClass;
  } else if (typeof field.clean === "function") {
    try {
      isArrayBacked = Array.isArray(field.clean([]));
    } catch {
      isArrayBacked = false;
    }
  } else {
    isArrayBacked = false;
  }

  if (isEcf)
    return isArrayBacked || typeof EcfClass === "function"
      ? "embedded-collection"
      : /** @type {null} */ (null);
  return isArrayBacked ? "array" : null;
}

/** @param {{ field: any, rootKey: string, rawKey: string, value: unknown, source: Record<string, any>, preSource: Record<string, any>|null, index: number, id: string, coordinate: string }} args */
function assertBatchEcfEntriesReflected({
  field,
  rootKey,
  rawKey,
  value,
  source,
  preSource,
  index,
  id,
  coordinate
}) {
  const stored = source[rootKey];
  /**
   * @param {string} detail
   * @param {unknown} [requested]
   * @param {unknown} [storedValue]
   * @param {Record<string, any>} [extraDetails]
   * @returns {never}
   */
  const refuse = (detail, requested, storedValue, extraDetails) => {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `${coordinate} writes "${rawKey}", an EMBEDDED COLLECTION, in a way this Foundry ` +
        `version SILENTLY DISCARDS: ${detail}. An embedded collection is merged by "_id" (entries you do not ` +
        `name are kept), so send each entry as { "_id": "<existing id>", <fields to change> } with values the ` +
        `element schema accepts. Foundry 14 drops an invalid embedded entry without an error or a diff ` +
        `(Foundry 13 rejects it outright), so the write would be reported as applied while nothing changed.`,
      {
        index,
        id,
        field: rawKey,
        arrayField: rootKey,
        embeddedCollection: true,
        requested: requested ?? null,
        stored: storedValue ?? null,
        ...(extraDetails ?? {})
      }
    );
  };

  if (!Array.isArray(value)) {
    refuse(`the value is not an array of entries`, value, stored);
  }

  if (!Array.isArray(stored)) return;

  const elementSchema = field?.schema ?? field?.element?.schema ?? null;
  const mergedById = new Map();
  for (const entry of stored) {
    if (entry && typeof entry === "object" && typeof entry._id === "string") mergedById.set(entry._id, entry);
  }

  const preById = new Map();
  const preEntries = preSource?.[rootKey];
  if (Array.isArray(preEntries)) {
    for (const entry of preEntries) {
      if (entry && typeof entry === "object" && typeof entry._id === "string") preById.set(entry._id, entry);
    }
  }

  const addressedIds = new Set();
  for (const entry of /** @type {any[]} */ (value)) {
    if (!entry || typeof entry !== "object" || !usableEntryId(entry)) continue;
    const candidateId = /** @type {any} */ (entry)._id;
    if (addressedIds.has(candidateId)) {
      refuse(
        `two entries name the same "_id" ${candidateId} — Foundry applies them IN ORDER and keeps only the ` +
          `LAST value for each field, so the earlier entry's values are discarded without an error. Name ` +
          `each entry once and merge the fields you want changed into ONE entry`,
        entry,
        mergedById.get(candidateId) ?? null,
        { duplicateEntryId: candidateId }
      );
    }
    addressedIds.add(candidateId);
  }

  const idlessCreateCount = /** @type {any[]} */ (value).filter(
    (entry) => entry && typeof entry === "object" && !Array.isArray(entry) && !usableEntryId(entry)
  ).length;
  const unaddressedCandidates = stored.filter(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      !(typeof candidate._id === "string" && addressedIds.has(candidate._id))
  );
  const consumedCandidates = new Set();

  for (const entry of /** @type {any[]} */ (value)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !isPlainObject(entry)) {
      refuse(`one of the entries is not a plain object`, entry, null);
    }
    const entryId = /** @type {any} */ (entry)._id;
    const usableId = usableEntryId(entry);

    if (!usableId) {
      const witness = findEcfCreateWitness({
        entry,
        candidates: unaddressedCandidates,
        consumed: consumedCandidates,
        elementSchema
      });
      if (witness.index >= 0) consumedCandidates.add(witness.index);
      if (!witness.credited) {
        const idNote = entryId === undefined ? "" : `; "_id" was ${JSON.stringify(entryId)}`;
        refuse(
          consumedCandidates.size > 0
            ? `this patch sends ${idlessCreateCount} entries with no usable "_id" and only ` +
                `${consumedCandidates.size} resulting entr${consumedCandidates.size === 1 ? "y" : "ies"} ` +
                `hold${consumedCandidates.size === 1 ? "s" : ""} the values they name, so at least one of them ` +
                `was NOT added to the collection — and because such entries are told apart only by the values ` +
                `they name, WHICH of them Foundry dropped cannot be determined from the result. Send each create ` +
                `as its own element (or give each one an "_id") so a failure names one entry${idNote}`
            : `the entry with no usable "_id" was not added to the collection (no resulting entry holds the ` +
                `values it names${idNote})`,
          entry,
          null,
          consumedCandidates.size > 0
            ? { idlessCreateCount, creditedCreateCount: consumedCandidates.size, unattributable: true }
            : undefined
        );
      }
      continue;
    }

    const mergedEntry = mergedById.get(entryId);
    if (!mergedEntry) {
      refuse(`the entry naming "_id" ${entryId} is neither merged nor created in the result`, entry, null);
    }

    const preEntry = preById.get(entryId) ?? null;

    for (const [rawEntryKey, entryValue] of Object.entries(/** @type {any} */ (entry))) {
      if (rawEntryKey === "_id") continue;

      const parsedEntryKey = parsePatchKey(rawEntryKey);
      const isDeletion = parsedEntryKey.operators[0] === "delete";
      const entryKey = parsedEntryKey.root;
      if (!entryKey) continue;

      let elementField;
      try {
        elementField = elementSchema?.get?.(entryKey) ?? null;
      } catch {
        elementField = null;
      }

      if (!elementField) {
        const movedTo = findShimmedArrayPath(mergedEntry, entryKey);
        if (movedTo) {
          refuse(
            `entry ${entryId} writes "${rawEntryKey}", which this Foundry version does not declare on the element ` +
              `and therefore STRIPS: the merged entry holds an array at "${movedTo}", so the field has most likely ` +
              `MOVED there — write "${movedTo}" instead`,
            entryValue,
            readSourcePath(mergedEntry, movedTo),
            { movedTo }
          );
        }
        refuse(
          `entry ${entryId} writes "${rawEntryKey}", which the element schema does not declare and therefore ` +
            `STRIPS on every supported core`,
          entryValue,
          null
        );
      }

      if (isDeletion) {
        if (mergedEntry[entryKey] !== undefined) {
          refuse(
            `entry ${entryId} asks to DELETE "${entryKey}" ("${rawEntryKey}"), which the merged entry still holds ` +
              `— no supported core applies a forced deletion inside an embedded entry`,
            null,
            mergedEntry[entryKey]
          );
        }
        continue;
      }

      const mergedValue = mergedEntry[entryKey];

      if (sourceValuesEqual(entryValue, mergedValue)) continue;

      if (!isPlainObject(entryValue) && typeof elementField.clean === "function") {
        let pinned;
        try {
          pinned = elementField.clean(structuredCloneish(entryValue));
        } catch {
          pinned = undefined;
        }
        if (!sourceValuesEqual(pinned, mergedValue)) {
          refuse(
            `entry ${entryId} sets "${entryKey}" to a value the merged entry does not hold ` +
              `(another entry, or another key of this entry, wrote "${entryKey}" last)`,
            entryValue,
            mergedValue
          );
        }
      }

      if (preEntry && !sourceValuesEqual(mergedValue, preEntry[entryKey])) continue;

      if (typeof elementField.validate === "function") {
        let failure = null;
        try {
          failure = elementField.validate(structuredCloneish(entryValue), { strict: false, partial: true });
        } catch {
          failure = null;
        }
        if (failure?.unresolved) {
          refuse(
            `entry ${entryId} sets "${entryKey}" to a value the element schema rejects ` +
              `(${String(failure.message ?? "invalid value")})`,
            entryValue,
            mergedValue
          );
        }
      }

      if (typeof elementField.clean !== "function") continue;
      let expected;
      try {
        expected = elementField.clean(structuredCloneish(entryValue));
      } catch {
        expected = undefined;
      }
      if (!sourceValuesEqual(expected, mergedValue)) {
        refuse(
          `entry ${entryId} sets "${entryKey}" to a value the merged entry does not hold`,
          entryValue,
          mergedValue
        );
      }
    }
  }
}

/**
 * @param {{ entry: Record<string, any>, candidates: any[], consumed: Set<number>, elementSchema: any }} args
 * @returns {{ credited: boolean, index: number }}
 */
function findEcfCreateWitness({ entry, candidates, consumed, elementSchema }) {
  const keys = Object.keys(entry).filter((key) => key !== "_id");

  if (keys.length === 0) return { credited: true, index: -1 };

  const matches = (candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    return keys.every((rawEntryKey) => {
      const parsedEntryKey = parsePatchKey(rawEntryKey);
      if (parsedEntryKey.operators[0] === "delete") return false;
      const entryKey = parsedEntryKey.root;
      const requested = entry[rawEntryKey];
      const present = candidate[entryKey];
      if (sourceValuesEqual(requested, present)) return true;

      let elementField;
      try {
        elementField = elementSchema?.get?.(entryKey) ?? null;
      } catch {
        elementField = null;
      }
      if (typeof elementField?.clean !== "function") return false;
      try {
        return sourceValuesEqual(elementField.clean(structuredCloneish(requested)), present);
      } catch {
        return false;
      }
    });
  };

  for (let index = 0; index < candidates.length; index += 1) {
    if (consumed.has(index)) continue;
    if (matches(candidates[index])) return { credited: true, index };
  }
  return { credited: false, index: -1 };
}

export function readDocumentSource(document) {
  if (typeof document?.toObject === "function") {
    const source = document.toObject();
    return source && typeof source === "object" ? source : null;
  }
  const source = document?._source;
  return source && typeof source === "object" ? source : null;
}

/**
 * @param {any} documentClass
 * @param {Record<string, any>} patch
 * @returns {string[]}
 */
export function batchEmbeddedCreateKeys(documentClass, patch) {
  const schema = documentClass?.schema;
  if (!schema || typeof schema.get !== "function") return [];
  /** @type {string[]} */
  const keys = [];
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!Array.isArray(value)) continue;
    const { path, root, operatorAt } = parsePatchKey(key);

    if (path !== root || operatorAt >= 0) continue;
    let field = null;
    try {
      field = schema.get(root);
    } catch {
      continue;
    }
    if (classifyArrayBackedField(field) !== "embedded-collection") continue;

    if (
      value.some(
        (entry) => entry && typeof entry === "object" && !Array.isArray(entry) && !usableEntryId(entry)
      )
    ) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * @param {any} value
 * @returns {any[]}
 */
export function batchEcfResidualEntries(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !usableEntryId(entry)) return false;

    return Object.keys(entry).every((rawKey) => parsePatchKey(rawKey).operatorAt < 0);
  });
}

function readSourcePath(source, path) {
  let current = /** @type {any} */ (source);
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

export function structuredCloneish(value) {
  const deepClone = /** @type {any} */ (globalThis).foundry?.utils?.deepClone;
  if (typeof deepClone === "function") {
    return deepClone(value);
  }
  const structured = /** @type {any} */ (globalThis).structuredClone;
  if (typeof structured === "function") {
    try {
      return structured(value);
    } catch {
      // A non-cloneable value (a function, a DOM-ish object) throws a DataCloneError. Fall through to
      // the manual copy rather than swapping "shared reference" for "the write cannot happen".
    }
  }
  return cloneJsonish(value);
}

function cloneJsonish(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonish(entry));
  }
  if (value && typeof value === "object") {
    /** @type {Record<string, any>} */
    const copy = {};
    for (const [key, entry] of Object.entries(value)) {
      copy[key] = cloneJsonish(entry);
    }
    return copy;
  }
  return value;
}
