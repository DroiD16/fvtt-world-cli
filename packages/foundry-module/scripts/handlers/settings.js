import { BATCH_GET_MAX_IDS, ERROR_CODES, MODULE_ID } from "../generated/protocol.js";
import {
  BATCH_STATUS,
  annotateBatchElementFailure,
  assertBatchWithinLimit,
  assertNoDuplicateBatchIds,
  buildBatchResult,
  finishThrownBatch
} from "../lib/batch-write.js";
import { sourceValuesEqual, structuredCloneish } from "../lib/batch-guards.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { createBridgeError, toFailureSummary } from "../lib/errors.js";
import { buildMismatchReport, createMismatchError } from "../lib/mismatch-report.js";
import { paginate, serializeSettingMetadata } from "../lib/serializers.js";
import { serializeSettingValue } from "../lib/setting-values.js";
import { MODULE_SETTING_KEYS, assertFoundryReady } from "../lib/validators.js";

function getSettingsRegistry() {
  const game = assertFoundryReady();
  const registry = game.settings?.settings;
  const usable =
    registry instanceof Map ||
    (registry !== null &&
      typeof registry === "object" &&
      typeof (/** @type {any} */ (registry).entries) === "function" &&
      typeof (/** @type {any} */ (registry).get) === "function");
  if (!usable) {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      "Foundry setting registrations are not available (game.settings.settings is missing); reload the GM client"
    );
  }

  return /** @type {Map<string, any>} */ (registry);
}

function registryEntries(registry) {
  return registry instanceof Map ? Map.prototype.entries.call(registry) : registry.entries();
}

function registryGet(registry, id) {
  return registry instanceof Map ? Map.prototype.get.call(registry, id) : registry.get(id);
}

/**
 * @param {string} id
 * @param {any} config
 * @param {boolean} keyIsString
 * @returns {{ namespace: string | null, key: string | null, id: string, unaddressable?: true }}
 */
function resolveSettingIdentity(id, config, keyIsString) {
  const namespace = config?.namespace;
  const key = config?.key;
  if (
    keyIsString &&
    typeof namespace === "string" &&
    namespace !== "" &&
    typeof key === "string" &&
    key !== "" &&
    `${namespace}.${key}` === id
  ) {
    return { namespace, key, id };
  }

  return splitSettingIdentity(id, keyIsString);
}

/**
 * @param {string} id
 * @param {boolean} keyIsString
 * @returns {{ namespace: string | null, key: null, id: string, unaddressable: true }}
 */
function unregisteredIdentity(id, keyIsString) {
  const identity = splitSettingIdentity(id, keyIsString);
  return { namespace: identity.namespace, key: null, id, unaddressable: true };
}

/**
 * @param {string} id
 * @param {boolean} keyIsString
 * @returns {{ namespace: string | null, key: string | null, id: string, unaddressable?: true }}
 */
function splitSettingIdentity(id, keyIsString) {
  const dotIndex = keyIsString ? id.indexOf(".") : -1;
  return markUnaddressable(
    dotIndex === -1
      ? { namespace: id, key: "", id }
      : { namespace: id.slice(0, dotIndex), key: id.slice(dotIndex + 1), id }
  );
}

/**
 * @param {{ namespace: string, key: string, id: string }} identity
 * @returns {{ namespace: string | null, key: string | null, id: string, unaddressable?: true }}
 */
function markUnaddressable(identity) {
  if (identity.namespace !== "" && identity.key !== "") {
    return identity;
  }

  return {
    namespace: identity.namespace === "" ? null : identity.namespace,
    key: identity.key === "" ? null : identity.key,
    id: identity.id,
    unaddressable: true
  };
}

const METADATA_READ_ERROR_MAX_LENGTH = 200;

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeForeignError(error) {
  try {
    const message = error instanceof Error ? error.message : String(error ?? "unknown error");
    return typeof message === "string" ? message : "unreadable error value";
  } catch {
    return "unreadable error value";
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeMetadataReadError(error) {
  const message = describeForeignError(error);
  return message.length > METADATA_READ_ERROR_MAX_LENGTH
    ? `${message.slice(0, METADATA_READ_ERROR_MAX_LENGTH - 1)}…`
    : message;
}

const UNREADABLE_REGISTRY_KEY = "(unreadable key)";

/**
 * @param {unknown} rawId
 * @returns {string}
 */
function describeRegistryKey(rawId) {
  if (typeof rawId === "string") {
    return rawId;
  }

  try {
    const coerced = String(rawId);
    return typeof coerced === "string" ? coerced : UNREADABLE_REGISTRY_KEY;
  } catch {
    return UNREADABLE_REGISTRY_KEY;
  }
}

/**
 * @param {unknown} rawId
 * @param {any} config
 */
function buildSettingRow(rawId, config) {
  const id = describeRegistryKey(rawId);

  const keyIsString = typeof rawId === "string";

  const redacted = [MODULE_SETTING_KEYS.AUTH_TOKEN, MODULE_SETTING_KEYS.CREDENTIALS].some(
    (key) => id === `${MODULE_ID}.${key}`
  )
    ? { valueRedacted: true }
    : null;
  try {
    const identity = config
      ? resolveSettingIdentity(id, config, keyIsString)
      : unregisteredIdentity(id, keyIsString);
    return {
      ...serializeSettingMetadata(config, identity),
      ...(identity.unaddressable ? { unaddressable: true } : null),
      ...redacted
    };
  } catch (error) {
    const identity = splitSettingIdentity(id, keyIsString);
    return {
      namespace: identity.namespace,
      key: identity.key,
      id,
      name: null,
      nameLocalized: null,
      hint: null,
      hintLocalized: null,
      scope: null,
      type: null,
      config: false,
      requiresReload: false,
      metadataReadFailed: true,

      metadataReadError: describeMetadataReadError(error),
      ...(identity.unaddressable ? { unaddressable: true } : null),
      ...redacted
    };
  }
}

function compareSettingRows(left, right) {
  const leftNamespace = left.namespace ?? "";
  const rightNamespace = right.namespace ?? "";
  if (leftNamespace !== rightNamespace) {
    return leftNamespace < rightNamespace ? -1 : 1;
  }

  const leftKey = left.key ?? "";
  const rightKey = right.key ?? "";
  if (leftKey !== rightKey) {
    return leftKey < rightKey ? -1 : 1;
  }

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function filterSettingRows(rows, name) {
  if (name == null) {
    return rows;
  }

  const needle = String(name).toLowerCase();
  return rows.filter((row) =>
    [row.namespace, row.key, row.name, row.nameLocalized].some(
      (candidate) => typeof candidate === "string" && candidate.toLowerCase().includes(needle)
    )
  );
}

/**
 * @param {string} namespace
 */
function assertWritableNamespace(namespace) {
  if (namespace !== MODULE_ID) {
    return;
  }

  throw createBridgeError(
    ERROR_CODES.SETTING_PROTECTED,
    `Namespace ${MODULE_ID} holds this bridge's own configuration — its daemon URL, credentials and command ` +
      `policy — and no command may write it. The refusal is part of the product, not a permission the command ` +
      `policy can lift: an agent that could rewrite this namespace could grant itself the very commands a human ` +
      `withheld. Nothing was written. Never retry; ask the user to change the bridge settings in Foundry`,
    { namespace }
  );
}

/**
 * @param {unknown} type
 */
function isSettingDataField(type) {
  return (
    typeof (/** @type {any} */ (type)?.clean) === "function" &&
    typeof (/** @type {any} */ (type)?.validate) === "function"
  );
}

/**
 * @param {unknown} type
 */
function isSettingDataModelClass(type) {
  return typeof type === "function" && typeof (/** @type {any} */ (type).fromSource) === "function";
}

/**
 * @param {unknown} failure
 * @returns {string}
 */
function describeValidationFailure(failure) {
  const asError = /** @type {any} */ (failure)?.asError;
  if (typeof asError === "function") {
    try {
      return describeForeignError(asError.call(failure));
    } catch {
      return describeForeignError(failure);
    }
  }

  return describeForeignError(failure);
}

/**
 * @param {string} id
 * @param {unknown} failure
 */
function settingValidationError(id, failure) {
  return createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `Foundry rejected the value for setting ${id}; see details.message for the raw validation error, then fix ` +
      `the value and resend. Nothing was written`,
    { id, reason: "foundry_validation", message: describeValidationFailure(failure) }
  );
}

/**
 * @param {string} id
 * @param {any} config
 * @param {unknown} value
 * @returns {{ validated: boolean, value: unknown }}
 */
function validateSettingValue(id, config, value) {
  const type = config?.type;
  serializeSettingValue(value);

  if (isSettingDataField(type)) {
    let cleaned;
    let failure;
    try {
      cleaned = type.clean(structuredCloneish(value));
      failure = type.validate(cleaned, { fallback: false });
    } catch (error) {
      throw settingValidationError(id, error);
    }

    if (failure) {
      throw settingValidationError(id, failure);
    }

    return { validated: true, value: cleaned === undefined ? config?.default : cleaned };
  }

  if (isSettingDataModelClass(type)) {
    try {
      return {
        validated: true,
        value: /** @type {any} */ (type).fromSource(structuredCloneish(value || {}), { strict: true })
      };
    } catch (error) {
      throw settingValidationError(id, error);
    }
  }

  return { validated: false, value: value === undefined ? config?.default : value };
}

/**
 * @param {unknown} json
 * @returns {unknown}
 */
function parseSettingJson(json) {
  if (typeof json !== "string") return json ?? null;
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function settingJson(value) {
  return JSON.stringify(value) ?? "null";
}

/**
 * @param {string} id
 * @param {string} json
 * @returns {unknown}
 */
function settingReadForm(id, json) {
  const SettingClass = /** @type {any} */ (globalThis).foundry?.documents?.Setting;
  if (typeof SettingClass !== "function") return parseSettingJson(json);
  try {
    return new SettingClass({ key: id, value: json }).value;
  } catch {
    return parseSettingJson(json);
  }
}

/**
 * @param {string} id
 * @param {any} config
 * @returns {string}
 */
function settingDefaultJson(id, config) {
  try {
    return settingJson(validateSettingValue(id, config, config?.default).value);
  } catch {
    return JSON.stringify(config?.default ?? null);
  }
}

/**
 * @param {string} namespace
 * @param {string} key
 * @param {string} id
 * @param {any} config
 * @returns {unknown}
 */
function readStoredSettingJson(namespace, key, id, config) {
  const game = assertFoundryReady();
  try {
    const storage = game.settings.storage?.get?.(config?.scope);
    const stored =
      config?.scope === "client"
        ? (storage?.getItem?.(id) ?? null) !== null
        : Boolean(storage?.getSetting?.(id, config?.scope === "user" ? game.userId : null));
    if (!stored) return parseSettingJson(settingDefaultJson(id, config));
    return parseSettingJson(game.settings.get(namespace, key, { document: true })?._source?.value);
  } catch (error) {
    throw createBridgeError(
      ERROR_CODES.SETTING_READ_FAILED,
      `Foundry failed to read the stored document of setting ${id}; see details.message for the underlying error`,
      { id, message: describeForeignError(error) }
    );
  }
}

/**
 * @param {string} namespace
 * @param {string} key
 * @param {string} id
 * @returns {unknown}
 */
function readSettingValue(namespace, key, id) {
  const game = assertFoundryReady();
  try {
    return serializeSettingValue(game.settings.get(namespace, key));
  } catch (error) {
    if (/** @type {any} */ (error)?.code) {
      throw error;
    }

    throw createBridgeError(
      ERROR_CODES.SETTING_READ_FAILED,
      `Foundry failed to read setting ${id}; see details.message for the underlying error (the registering ` +
        `package's type cast is what threw)`,
      { id, message: describeForeignError(error) }
    );
  }
}

/**
 * @param {{ namespace: string, key: string, value: unknown }} item
 */
function prepareSettingWrite(item) {
  assertWritableNamespace(item.namespace);

  const registry = getSettingsRegistry();
  const id = `${item.namespace}.${item.key}`;
  const config = registryGet(registry, id);
  if (!config) {
    throw createBridgeError(
      ERROR_CODES.SETTING_UNREGISTERED,
      `Setting ${id} is not registered in this GM client, so Foundry has no type, scope or default for it and a ` +
        `write would be discarded. Only the package that owns a setting registers it: run \`setting list\` to see ` +
        `what this world's active packages register. A value left behind by a disabled or uninstalled module ` +
        `cannot be written. Nothing was written`,
      { namespace: item.namespace, key: item.key, id }
    );
  }

  const row = buildSettingRow(id, config);
  const previous = readSettingValue(item.namespace, item.key, id);
  const storedBefore = readStoredSettingJson(item.namespace, item.key, id, config);
  const { validated, value } = validateSettingValue(id, config, item.value);
  const json = settingJson(value);
  const requested = parseSettingJson(json);

  return {
    id,
    namespace: item.namespace,
    key: item.key,
    scope: row.scope,
    requiresReload: row.requiresReload,
    previous,
    value: serializeSettingValue(settingReadForm(id, json)),
    validated,
    config,
    requested,
    storedBefore,
    unchanged: sourceValuesEqual(storedBefore, requested)
  };
}

/**
 * @param {{ id: string, namespace: string, key: string, scope: unknown, requiresReload: unknown, previous: unknown, value: unknown, validated: boolean, unchanged: boolean, config: any }} prepared
 * @param {unknown} requested
 */
async function writeSetting(prepared, requested) {
  const game = assertFoundryReady();
  if (typeof game.settings?.set !== "function") {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      "Foundry setting write API (game.settings.set) is not available; reload the GM client"
    );
  }

  await game.settings.set(prepared.namespace, prepared.key, structuredCloneish(requested));
  return {
    stored: readStoredSettingJson(prepared.namespace, prepared.key, prepared.id, prepared.config),
    value: readSettingValue(prepared.namespace, prepared.key, prepared.id)
  };
}

/**
 * @param {{ id: string, previous: unknown, requested: unknown, storedBefore: unknown }} prepared
 * @param {unknown} stored
 * @param {string} [pathsAt]
 */
function settingMismatch(prepared, stored, pathsAt) {
  if (sourceValuesEqual(stored, prepared.requested)) return null;
  return createMismatchError({
    subject: `Setting ${prepared.id}`,
    report: buildMismatchReport([{ segments: ["value"], requested: prepared.requested }], {
      value: stored
    }),
    changedFields: sourceValuesEqual(stored, prepared.storedBefore) ? [] : ["value"],
    details: { id: prepared.id, previous: prepared.previous, requested: prepared.requested },
    pathsAt,
    remedy:
      "One possible cause is an onChange handler or the package that registered the setting; the value can also be set from Foundry's Configure Settings."
  });
}

/**
 * @param {{ id: string, namespace: string, key: string, scope: unknown, requiresReload: unknown, previous: unknown, value: unknown, validated: boolean }} prepared
 * @param {unknown} value
 * @param {boolean} changed
 */
function settingWriteResult(prepared, value, changed) {
  return {
    namespace: prepared.namespace,
    key: prepared.key,
    id: prepared.id,
    scope: prepared.scope,
    previous: prepared.previous,
    value,
    requiresReload: prepared.requiresReload,
    validated: prepared.validated,
    changed
  };
}

export function createSettingHandlers() {
  return {
    async "setting.list"(params) {
      const registry = getSettingsRegistry();
      const rows = [];
      for (const [id, config] of registryEntries(registry)) {
        rows.push(buildSettingRow(id, config));
      }

      rows.sort(compareSettingRows);
      const filtered = filterSettingRows(rows, params.name);
      const { page, total, hasMore } = paginate(filtered, params);
      return {
        settings: page,
        total,
        hasMore
      };
    },

    async "setting.get"(params) {
      const registry = getSettingsRegistry();
      const game = assertFoundryReady();
      const id = `${params.namespace}.${params.key}`;
      const config = registryGet(registry, id);

      if (!config) {
        throw createBridgeError(
          ERROR_CODES.SETTING_NOT_FOUND,
          `Setting ${id} is not registered in this session; run \`setting list\` to see what is registered. A setting whose value is still stored in the world by a DISABLED or UNINSTALLED module has no registration and cannot be read`,
          { namespace: params.namespace, key: params.key, id }
        );
      }

      const row = buildSettingRow(id, config);

      if (row.valueRedacted) {
        return { setting: { ...row, value: null } };
      }

      let rawValue;
      try {
        rawValue = game.settings.get(params.namespace, params.key);
      } catch (error) {
        throw createBridgeError(
          ERROR_CODES.SETTING_READ_FAILED,
          `Foundry failed to read setting ${id}; see details.message for the underlying error (the registering package's type cast is what threw)`,
          {
            namespace: params.namespace,
            key: params.key,
            id,

            message: describeForeignError(error)
          }
        );
      }

      const value = serializeSettingValue(rawValue);
      return {
        setting: {
          ...row,

          value
        }
      };
    },

    async "setting.get-many"(params) {
      const ids = params.ids;
      if (ids.length > BATCH_GET_MAX_IDS) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `setting.get-many accepts at most ${BATCH_GET_MAX_IDS} ids`,
          { max: BATCH_GET_MAX_IDS, received: ids.length }
        );
      }

      const registry = getSettingsRegistry();
      const settings = ids.map((id) => {
        const identity = splitSettingIdentity(id, true);
        const config = registryGet(registry, id);
        if (!config || identity.unaddressable) {
          return {
            ...buildSettingRow(id, null),
            error: {
              code: ERROR_CODES.SETTING_NOT_FOUND,
              message:
                `Setting ${id} is not registered in this session; ids are spelled \`namespace.key\` and ` +
                `\`setting list\` shows what is registered. A value still stored by a disabled or uninstalled ` +
                `module has no registration and cannot be read`
            }
          };
        }

        const row = buildSettingRow(id, config);
        if (row.valueRedacted) {
          return { ...row, value: null };
        }

        try {
          return {
            ...row,
            value: readSettingValue(
              /** @type {string} */ (identity.namespace),
              /** @type {string} */ (identity.key),
              id
            )
          };
        } catch (error) {
          return { ...row, error: toFailureSummary(error) };
        }
      });

      return { settings };
    },

    async "setting.set"(params) {
      const prepared = prepareSettingWrite(params);
      if (isDryRun(params)) {
        return dryRunResponse(settingWriteResult(prepared, prepared.value, !prepared.unchanged));
      }

      if (prepared.unchanged) {
        return settingWriteResult(prepared, prepared.previous, false);
      }

      const written = await writeSetting(prepared, params.value);
      const mismatch = settingMismatch(prepared, written.stored);
      if (mismatch) throw mismatch;
      return settingWriteResult(prepared, written.value, true);
    },

    async "setting.set-many"(params) {
      const command = "setting.set-many";
      const items = params.items;
      assertBatchWithinLimit(items, { command, field: "items" });
      assertNoDuplicateBatchIds(
        items.map(
          (/** @type {{ namespace: string, key: string }} */ item) => `${item.namespace}.${item.key}`
        ),
        { command, field: "id" }
      );

      const elements = items.map((/** @type {any} */ item, /** @type {number} */ index) => {
        try {
          return prepareSettingWrite(item);
        } catch (error) {
          throw annotateBatchElementFailure(error, { command, index, id: `${item.namespace}.${item.key}` });
        }
      });

      if (isDryRun(params)) {
        return buildBatchResult({
          outcomes: elements.map((element, index) => ({
            ...settingWriteResult(element, element.value, !element.unchanged),
            index,
            status: element.unchanged ? BATCH_STATUS.UNCHANGED : BATCH_STATUS.UPDATED
          })),
          dryRun: true
        });
      }

      /** @type {Array<{index:number,id:string|null,status:string,paths?:unknown[]}>} */
      const outcomes = [];
      /** @type {{ code: string, message: string, error: unknown } | null} */
      let failure = null;
      for (let index = 0; index < elements.length; index += 1) {
        const element = elements[index];
        if (element.unchanged) {
          outcomes.push({
            ...settingWriteResult(element, element.previous, false),
            index,
            status: BATCH_STATUS.UNCHANGED
          });
          continue;
        }

        if (failure) {
          outcomes.push({ index, id: element.id, status: BATCH_STATUS.DROPPED });
          continue;
        }

        let written;
        try {
          written = await writeSetting(element, items[index].value);
        } catch (error) {
          failure = { error, ...toFailureSummary(error) };
          outcomes.push({ index, id: element.id, status: BATCH_STATUS.UNKNOWN });
          continue;
        }
        const mismatch = settingMismatch(element, written.stored, `outcomes[${index}].paths`);
        if (mismatch) {
          failure = { error: mismatch, ...toFailureSummary(mismatch) };
          outcomes.push({
            index,
            id: element.id,
            status: BATCH_STATUS.DROPPED,
            paths: mismatch.details.paths
          });
          continue;
        }
        outcomes.push({
          ...settingWriteResult(element, written.value, true),
          index,
          status: BATCH_STATUS.UPDATED
        });
      }

      if (failure) {
        return finishThrownBatch({
          outcomes,
          failure: { code: failure.code, message: failure.message },
          error: failure.error
        });
      }

      return buildBatchResult({ outcomes });
    }
  };
}
