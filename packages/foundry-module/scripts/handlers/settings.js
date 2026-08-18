import { ERROR_CODES, MODULE_ID } from "../generated/protocol.js";
import { createBridgeError } from "../lib/errors.js";
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
    }
  };
}
