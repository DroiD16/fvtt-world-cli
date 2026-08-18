import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

function isPlainObjectish(value) {
  if (value === null || value === undefined) return false;
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
 * @returns {{ prefix: ""|"=="|"-=", path: string, root: string }}
 */
function splitPatchKey(rawKey) {
  const prefix = rawKey.startsWith("==") ? "==" : rawKey.startsWith("-=") ? "-=" : "";
  const path = prefix ? rawKey.slice(2) : rawKey;
  return { prefix, path, root: path.split(".")[0] };
}

/**
 * @param {string} rawKey
 * @returns {{ path: string, root: string, operatorTargets: string[] }}
 */
function splitPatchKeyDeep(rawKey) {
  /** @type {string[]} */
  const stripped = [];
  /** @type {string[]} */
  const operatorTargets = [];
  for (const segment of rawKey.split(".")) {
    const prefix = segment.startsWith("==") ? "==" : segment.startsWith("-=") ? "-=" : "";
    stripped.push(prefix ? segment.slice(2) : segment);
    if (prefix) operatorTargets.push(stripped.join("."));
  }
  const path = stripped.join(".");
  return { path, root: stripped[0], operatorTargets };
}

/**
 * @param {string} rawKey
 * @returns {{ path: string, deletes: boolean }}
 */
function normalizeOperatorPath(rawKey) {
  const { path } = splitPatchKeyDeep(rawKey);
  return { path, deletes: rawKey.split(".").some((segment) => segment.startsWith("-=")) };
}

/** @param {{ documentClass: any, patch: Record<string, any>, index: number, command: string, id: string }} args */
export function assertNoAmbiguousBatchKeySpellings({ documentClass, patch, index, command, id }) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;

  const refuse = ({ where, rule, path, root, spellings }) => {
    const mechanism =
      rule === 1
        ? `which one is not the same on the two supported cores: Foundry 13 keeps the LAST spelling in the ` +
          `object while Foundry 14 lets a "==" forced replacement win regardless of order`
        : `an operator-spelled ("==" / "-=") whole field (at any depth) and a key underneath it are resolved DIFFERENTLY by ` +
          `the two supported cores: Foundry 13 applies the narrower key on top of the forced replacement, ` +
          `Foundry 14 discards it entirely (and a "-=" whole field beside such a key is rejected outright on ` +
          `both)`;
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,

      `${command} element ${index} (id ${id}) writes the same field "${path}" through more than one key ` +
        `${where}: ${spellings.map((key) => `"${key}"`).join(" and ")}. Foundry applies exactly ONE of them and ` +
        `SILENTLY DISCARDS the rest — ${mechanism}, and no check downstream can see the loss because the merged ` +
        `preview and the stored result come from the same ambiguous patch. Merge them into one key and retry.`,
      { index, id, field: path, ambiguousRoot: root, ambiguousKeys: spellings, ambiguityRule: rule }
    );
  };

  /**
   * @param {string[]} rawKeys
   * @param {{ deep: boolean }} options
   * @returns {{ rule: 1|2, path: string, root: string, spellings: string[] }|null}
   */
  const findCollision = (rawKeys, { deep }) => {
    /** @type {Map<string, string[]>} */
    const byPath = new Map();
    /** @type {Map<string, string[]>} */
    const byRoot = new Map();
    /** @type {Array<{rawKey:string, root:string, path:string, operatorTargets:string[]}>} */
    const keys = [];
    for (const rawKey of rawKeys) {
      const { path, root, operatorTargets } = deep
        ? splitPatchKeyDeep(rawKey)
        : (() => {
            const { prefix, path: shallowPath, root: shallowRoot } = splitPatchKey(rawKey);
            return {
              path: shallowPath,
              root: shallowRoot,
              operatorTargets: prefix && shallowPath === shallowRoot ? [shallowRoot] : []
            };
          })();
      if (!root) continue;
      byPath.set(path, [...(byPath.get(path) ?? []), rawKey]);
      byRoot.set(root, [...(byRoot.get(root) ?? []), rawKey]);
      keys.push({ rawKey, root, path, operatorTargets });
    }

    for (const [path, spellings] of byPath) {
      if (spellings.length > 1) return { rule: 1, path, root: path.split(".")[0], spellings };
    }

    for (const key of keys) {
      for (const target of key.operatorTargets) {
        const others = keys.filter(
          (other) => other !== key && (other.path === target || other.path.startsWith(`${target}.`))
        );
        if (others.length) {
          const involved = new Set([key.rawKey, ...others.map((other) => other.rawKey)]);
          return {
            rule: 2,
            path: target,
            root: target.split(".")[0],
            spellings: rawKeys.filter((rawKey) => involved.has(rawKey))
          };
        }
      }
    }
    return null;
  };

  const topLevel = findCollision(Object.keys(patch), { deep: true });
  if (topLevel) refuse({ where: "at the top level", ...topLevel });

  const schema = documentClass?.schema;
  if (!schema || typeof schema.get !== "function") return;
  for (const [rawKey, value] of Object.entries(patch)) {
    if (!Array.isArray(value)) continue;
    const { path, root } = splitPatchKey(rawKey);
    if (path !== root) continue;
    let field;
    try {
      field = schema.get(root);
    } catch {
      field = null;
    }
    if (!field || classifyArrayBackedField(field) !== "embedded-collection") continue;
    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || !isPlainObjectish(entry)) continue;
      const collision = findCollision(
        Object.keys(entry).filter((key) => key !== "_id"),
        { deep: false }
      );
      if (collision) {
        refuse({
          where: `inside one entry of the embedded collection "${root}"`,
          ...collision
        });
      }
    }
  }
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
export function batchValuesEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((entry, index) => batchValuesEqual(entry, b[index]));
  }
  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    isPlainObjectish(a) &&
    isPlainObjectish(b)
  ) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key) =>
        Object.hasOwn(/** @type {any} */ (b), key) &&
        batchValuesEqual(/** @type {any} */ (a)[key], /** @type {any} */ (b)[key])
    );
  }
  return false;
}

/** @param {{ documentClass: any, patch: Record<string, any>, merged: any, stored?: any, index: number, command: string, id: string }} args */
export function assertBatchArrayWritesReflected({
  documentClass,
  patch,
  merged,
  stored,
  index,
  command,
  id
}) {
  const schema = documentClass?.schema;
  const source = readDocumentSource(merged);

  const preSource = stored === undefined ? null : readDocumentSource(stored);
  if (!schema || typeof schema.get !== "function" || !source) {
    return;
  }

  for (const [rawKey, value] of Object.entries(patch ?? {})) {
    const operator = rawKey.startsWith("==") ? "==" : rawKey.startsWith("-=") ? "-=" : "";
    const key = operator ? rawKey.slice(2) : rawKey;
    const rootKey = key.split(".")[0];
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
        key,
        rootKey,
        operator,
        value,
        source,

        merged,

        preSource,
        index,
        command,
        id
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
      command,
      id
    });

    if (key === rootKey) {
      const kind = classifyArrayBackedField(field);
      if (!kind) continue;

      if (batchValuesEqual(value, source[rootKey])) continue;

      if (kind === "embedded-collection") {
        assertBatchEcfEntriesReflected({
          field,
          rootKey,
          rawKey,
          value,
          source,
          preSource,
          index,
          command,
          id
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

      if (!batchValuesEqual(expected, source[rootKey])) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `${command} element ${index} (id ${id}) sets "${rawKey}" to a value this Foundry version SILENTLY DISCARDS: ` +
            `the merged document keeps ${JSON.stringify(source[rootKey])}. Foundry 14 drops an invalid array field ` +
            `without an error (Foundry 13 rejects it outright), so the write would be reported as applied while ` +
            `nothing changed. Fix the value (a Wall's "c", for example, must be exactly four numbers) and retry.`,
          { index, id, field: rawKey, arrayField: rootKey, requested: value, stored: source[rootKey] ?? null }
        );
      }

      if (!arrayWriteLanded({ field, value, rootKey, source, preSource })) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `${command} element ${index} (id ${id}) sets "${rawKey}" to a value the element schema does not accept, ` +
            `and this Foundry version SILENTLY DISCARDS it: cleaning it COLLAPSES onto the value already stored ` +
            `(${JSON.stringify(source[rootKey])}), so nothing changes and the write would be reported as applied. ` +
            `Send an array of values the field accepts (for a set-valued field such as a Wall's "levels", an array ` +
            `of level ids) and retry.`,
          { index, id, field: rawKey, arrayField: rootKey, requested: value, stored: source[rootKey] ?? null }
        );
      }
      continue;
    }

    if (!Array.isArray(source[rootKey])) continue;
    const stored = readSourcePath(source, key);
    if (batchValuesEqual(value, stored)) continue;

    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `${command} element ${index} (id ${id}) writes the dotted path "${rawKey}" into the ARRAY field "${rootKey}", ` +
        `which this Foundry version SILENTLY DISCARDS: the merged document keeps ` +
        `${JSON.stringify(stored ?? null)} there. Foundry 14 drops a dotted write into an array field without an ` +
        `error or a diff (Foundry 13 rejects it outright), so the write would be reported as applied while nothing ` +
        `changed. Send the WHOLE array instead (for a Wall, "c": [x1, y1, x2, y2]) and retry.`,
      { index, id, field: rawKey, arrayField: rootKey, requested: value, stored: stored ?? null }
    );
  }
}

/** @param {{ documentClass: any, rawKey: string, key: string, rootKey: string, operator: ""|"=="|"-=", value: unknown, source: Record<string, any>, merged?: any, preSource?: Record<string, any>|null, index: number, command: string, id: string }} args */
function assertMigratedArrayKeyReflected({
  documentClass,
  rawKey,
  key,
  rootKey,
  operator,
  value,
  source,
  merged,
  preSource = null,
  index,
  command,
  id
}) {
  const movedTo = findMigratedArrayTarget(documentClass, rootKey);
  if (!movedTo) return;

  const system = source?.system;
  const storedNow =
    (system && typeof system === "object" && !Array.isArray(system) ? system[rootKey] : undefined) ?? null;

  const migratedValue =
    !operator && key === rootKey ? migratedArrayValue(documentClass, key, value, rootKey) : undefined;
  if (migratedValue !== undefined) {
    if (migratedArrayWriteLanded({ merged, rootKey, migratedValue, storedNow, preSource })) return;
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `${command} element ${index} (id ${id}) sets "${rawKey}" — a field this Foundry version has MOVED to ` +
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
    : key === rootKey
      ? `this Foundry version migrates the field only when the value is an ARRAY`
      : `a dotted path into the field is not migrated by this Foundry version`;
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `${command} element ${index} (id ${id}) writes "${rawKey}", which this Foundry version does NOT declare at ` +
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

/** @param {{ documentClass: any, rawKey: string, value: unknown, source: Record<string, any>, merged?: any, preSource?: Record<string, any>|null, index: number, command: string, id: string }} args */
function assertMigratedSystemArrayReflected({
  documentClass,
  rawKey,
  value,
  source,
  merged,
  preSource = null,
  index,
  command,
  id
}) {
  const { path: normalizedKey, deletes: keyDeletes } = normalizeOperatorPath(rawKey);
  const segments = normalizedKey.split(".");
  const migrationRoot = segments[0];
  if (!migrationRoot) return;

  /** @type {Array<{ subPath: string, requested: unknown, deletes: boolean }>} */
  let candidates;
  if (segments.length > 1) {
    candidates = [{ subPath: segments.slice(1).join("."), requested: value, deletes: keyDeletes }];
  } else if (value && typeof value === "object" && !Array.isArray(value) && isPlainObjectish(value)) {
    candidates = Object.entries(value).map(([entryKey, entryValue]) => {
      const inner = normalizeOperatorPath(entryKey);
      return { subPath: inner.path, requested: entryValue, deletes: keyDeletes || inner.deletes };
    });
  } else {
    return;
  }

  for (const { subPath, requested, deletes } of candidates) {
    if (!subPath) continue;
    const candidateKey = subPath.split(".")[0];
    if (!candidateKey) continue;

    const movedTo = findMigratedArrayTarget(documentClass, candidateKey);
    if (movedTo !== `${migrationRoot}.${candidateKey}`) continue;

    const container = source?.[migrationRoot];
    const storedNow =
      (container && typeof container === "object" && !Array.isArray(container)
        ? container[candidateKey]
        : undefined) ?? null;

    if (subPath === candidateKey) {
      if (batchValuesEqual(requested, storedNow)) continue;
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
        `${command} element ${index} (id ${id}) sets "${movedTo}"${rawKey === movedTo ? "" : ` (through "${rawKey}")`} ` +
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

    const fullPath = `${migrationRoot}.${subPath}`;

    const resolvedNow = resolveSourcePath(source, fullPath);

    if (resolvedNow.status === "unaddressable") {
      const arraySegment = resolvedNow.container === "array";
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        `${command} element ${index} (id ${id}) writes "${rawKey}"${rawKey === fullPath ? "" : ` ("${fullPath}")`}, whose segment ` +
          `${JSON.stringify(resolvedNow.segment)} addresses ` +
          (arraySegment
            ? `the array field "${movedTo}" and is not an ARRAY INDEX. An array is addressed by its indices ` +
              `only, so this write cannot land the state it names — and on Foundry 14 a "length" spelling ` +
              `silently EMPTIES the whole array while reporting the write as applied. `
            : `a property of a SCALAR value stored inside the array field "${movedTo}" (a string's or a ` +
              `number's own property is a fact about that value, not stored data), so this write cannot ` +
              `land the state it names — on Foundry 14 it silently REPLACES the scalar with an object and ` +
              `destroys the other entries while reporting the write as applied. `) +
          `Send the WHOLE array at "${movedTo}" (an empty array to clear it) and retry.`,
        {
          index,
          id,
          field: rawKey,
          arrayField: candidateKey,
          movedTo,
          path: fullPath,
          segment: resolvedNow.segment,
          requested: requested ?? null,
          stored: storedNow
        }
      );
    }
    const storedNowAtPath = resolvedNow.value;

    let credited = batchValuesEqual(requested, storedNowAtPath);

    if (deletes && storedNowAtPath === undefined) credited = true;

    if (
      storedNowAtPath !== undefined &&
      preSource &&
      !batchValuesEqual(storedNowAtPath, readSourcePath(preSource, fullPath))
    ) {
      credited = true;
    }

    if (credited) {
      const preArray = preSource ? readSourcePath(preSource, `${migrationRoot}.${candidateKey}`) : undefined;
      if (Array.isArray(preArray) && preArray.length > 0) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `${command} element ${index} (id ${id}) writes "${rawKey}"${rawKey === fullPath ? "" : ` ("${fullPath}")`} ` +
            `INSIDE the array field "${movedTo}", which currently holds ${preArray.length} ` +
            `entr${preArray.length === 1 ? "y" : "ies"}. This Foundry version does NOT patch that array in ` +
            `place: it REBUILDS it from this patch alone, and the bridge does not compare the rebuilt array ` +
            `against the stored one, so it cannot confirm that the entries you did not name — or the fields ` +
            `of the entry you did name that this patch omits — are preserved. The write is refused for that ` +
            `reason; the refusal is deliberately conservative and also covers the narrow case where your ` +
            `patch names every field and nothing would change. WORKAROUND: send the WHOLE array at ` +
            `"${movedTo}" wholesale ({"${movedTo}": [ ...full desired state... ]}) — read it first, change ` +
            `the entry you mean, send all of them back; an empty array clears it — which is allowed and ` +
            `applied faithfully. Then retry.`,
          {
            index,
            id,
            field: rawKey,
            arrayField: candidateKey,
            movedTo,
            path: fullPath,
            requested: requested ?? null,
            stored: preArray
          }
        );
      }
      continue;
    }

    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `${command} element ${index} (id ${id}) writes "${rawKey}" INSIDE the array field "${movedTo}", and this ` +
        `Foundry version SILENTLY DISCARDS the whole write: the merged document still holds ` +
        `${JSON.stringify(storedNowAtPath ?? null)} at "${fullPath}" and ${JSON.stringify(storedNow)} in the ` +
        `array, so nothing changes and the write would be reported as applied. Send the WHOLE array at ` +
        `"${movedTo}" with entries the field accepts (an ActiveEffect change "type", for example, must be ` +
        `dot-delimited alphanumeric segments of at least three characters, or "custom.<number>" — a hyphen or ` +
        `an underscore is rejected) and retry.`,
      {
        index,
        id,
        field: rawKey,
        arrayField: candidateKey,
        movedTo,
        path: fullPath,
        requested: requested ?? null,
        stored: storedNowAtPath ?? null
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
  if (batchValuesEqual(expected, storedNow)) return true;

  if (!preSource) return false;
  const system = preSource.system;
  const storedBefore =
    (system && typeof system === "object" && !Array.isArray(system) ? system[rootKey] : undefined) ?? null;
  return !batchValuesEqual(storedNow, storedBefore);
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
  return migratedArrayValue(documentClass, rootKey, [], rootKey) === undefined ? null : `system.${rootKey}`;
}

/**
 * @param {any} documentClass
 * @param {string} key
 * @param {unknown} value
 * @param {string} rootKey
 * @returns {unknown[]|undefined}
 */
function migratedArrayValue(documentClass, key, value, rootKey) {
  const migrateData = documentClass?.migrateData;
  if (typeof migrateData !== "function") return undefined;
  let migrated;
  try {
    migrated = migrateData.call(documentClass, { [key]: structuredCloneish(value) });
  } catch {
    return undefined;
  }
  const system = migrated?.system;
  if (!system || typeof system !== "object" || Array.isArray(system) || !isPlainObjectish(system))
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
  if (!system || typeof system !== "object" || Array.isArray(system) || !isPlainObjectish(system))
    return null;
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
  return !batchValuesEqual(source[rootKey], preSource[rootKey]);
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

/** @param {{ field: any, rootKey: string, rawKey: string, value: unknown, source: Record<string, any>, preSource: Record<string, any>|null, index: number, command: string, id: string }} args */
function assertBatchEcfEntriesReflected({
  field,
  rootKey,
  rawKey,
  value,
  source,
  preSource,
  index,
  command,
  id
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
      `${command} element ${index} (id ${id}) writes "${rawKey}", an EMBEDDED COLLECTION, in a way this Foundry ` +
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
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !isPlainObjectish(entry)) {
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

      const isDeletion = rawEntryKey.startsWith("-=");
      const entryKey = isDeletion || rawEntryKey.startsWith("==") ? rawEntryKey.slice(2) : rawEntryKey;
      const entryRoot = entryKey.split(".")[0];
      if (!entryRoot) continue;

      let elementField;
      try {
        elementField = elementSchema?.get?.(entryRoot) ?? null;
      } catch {
        elementField = null;
      }

      if (!elementField) {
        const movedTo = findShimmedArrayPath(mergedEntry, entryRoot);
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
        if (readSourcePath(mergedEntry, entryKey) !== undefined) {
          refuse(
            `entry ${entryId} asks to DELETE "${entryKey}" ("${rawEntryKey}"), which the merged entry still holds ` +
              `— no supported core applies a forced deletion inside an embedded entry`,
            null,
            readSourcePath(mergedEntry, entryKey)
          );
        }
        continue;
      }

      if (entryKey !== entryRoot) {
        if (!batchValuesEqual(entryValue, readSourcePath(mergedEntry, entryKey))) {
          refuse(
            `entry ${entryId} writes the dotted path "${entryKey}", which the merged entry does not reflect`,
            entryValue,
            readSourcePath(mergedEntry, entryKey)
          );
        }
        continue;
      }

      const mergedValue = mergedEntry[entryRoot];

      if (batchValuesEqual(entryValue, mergedValue)) continue;

      if (!isPlainObjectish(entryValue) && typeof elementField.clean === "function") {
        let pinned;
        try {
          pinned = elementField.clean(structuredCloneish(entryValue));
        } catch {
          pinned = undefined;
        }
        if (!batchValuesEqual(pinned, mergedValue)) {
          refuse(
            `entry ${entryId} sets "${entryRoot}" to a value the merged entry does not hold ` +
              `(another entry, or another key of this entry, wrote "${entryRoot}" last)`,
            entryValue,
            mergedValue
          );
        }
      }

      if (preEntry && !batchValuesEqual(mergedValue, preEntry[entryRoot])) continue;

      if (typeof elementField.validate === "function") {
        let failure = null;
        try {
          failure = elementField.validate(structuredCloneish(entryValue), { strict: false, partial: true });
        } catch {
          failure = null;
        }
        if (failure?.unresolved) {
          refuse(
            `entry ${entryId} sets "${entryRoot}" to a value the element schema rejects ` +
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
      if (!batchValuesEqual(expected, mergedValue)) {
        refuse(
          `entry ${entryId} sets "${entryRoot}" to a value the merged entry does not hold`,
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
      if (rawEntryKey.startsWith("-=")) return false;
      const entryKey = rawEntryKey.startsWith("==") ? rawEntryKey.slice(2) : rawEntryKey;
      const requested = entry[rawEntryKey];
      const present = readSourcePath(candidate, entryKey);
      if (batchValuesEqual(requested, present)) return true;

      const entryRoot = entryKey.split(".")[0];
      if (entryKey !== entryRoot) return false;
      let elementField;
      try {
        elementField = elementSchema?.get?.(entryRoot) ?? null;
      } catch {
        elementField = null;
      }
      if (typeof elementField?.clean !== "function") return false;
      try {
        return batchValuesEqual(elementField.clean(structuredCloneish(requested)), present);
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
 * @param {Record<string, any>} patch
 * @returns {string[]}
 */
export function batchMergedConfirmationKeys(patch) {
  const split = Object.keys(patch ?? {}).map((key) => splitPatchKeyDeep(key));
  if (!split.some((entry) => entry.operatorTargets.length > 0)) return [];
  const roots = new Set();
  for (const entry of split) {
    if (entry.root) roots.add(entry.root);
  }
  return [...roots];
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
    const { path, root, operatorTargets } = splitPatchKeyDeep(key);

    if (path !== root || operatorTargets.length > 0) continue;
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

    return Object.keys(entry).every((rawKey) => splitPatchKeyDeep(rawKey).operatorTargets.length === 0);
  });
}

/**
 * @param {{ document: any, mergedSource: Record<string, any>|null, mergedConfirmationKeys: string[] }} element
 * @returns {boolean|null}
 */
export function mergedPreviewReflected(element) {
  const merged = element.mergedSource;
  const stored = readDocumentSource(element.document);
  if (!merged || !stored) return null;
  return element.mergedConfirmationKeys.every((rootKey) =>
    batchValuesEqual(merged[rootKey], stored[rootKey])
  );
}

function readSourcePath(source, path) {
  let current = /** @type {any} */ (source);
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

// @returns {{status:"resolved", value:unknown, segment:null}|{status:"missing", value:undefined, segment:string|null}|{status:"unaddressable", value:undefined, segment:string, container:"array"|"scalar"}}
function resolveSourcePath(source, path) {
  let current = /** @type {any} */ (source);
  for (const segment of path.split(".")) {
    if (current === undefined) {
      return { status: "missing", value: undefined, segment };
    }
    if (current === null || typeof current !== "object") {
      return { status: "unaddressable", value: undefined, segment, container: "scalar" };
    }
    if (Array.isArray(current) && !/^\d+$/.test(segment)) {
      return { status: "unaddressable", value: undefined, segment, container: "array" };
    }
    current = current[segment];
  }
  return { status: "resolved", value: current, segment: null };
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
