/**
 * @param {any} message
 * @returns {any}
 */
function readRollTableFlag(message) {
  if (typeof message?.getFlag === "function") {
    return message.getFlag("core", "RollTable") ?? null;
  }
  return message?.flags?.core?.RollTable ?? null;
}

/**
 * @typedef {object} ChatCapture
 * @property {boolean} available
 * @property {() => string[]} stop
 */

/**
 * @param {string} tableId
 * @returns {ChatCapture}
 */
export function startRollTableChatCapture(tableId) {
  const hooks = globalThis.Hooks;
  if (!hooks || typeof hooks.on !== "function" || typeof hooks.off !== "function") {
    return { available: false, stop: () => [] };
  }

  /** @type {string[]} */
  const ids = [];
  const userId = globalThis.game?.user?.id ?? null;

  const handler = (message, _options, createdByUserId) => {
    if (userId && createdByUserId && createdByUserId !== userId) return;
    if (readRollTableFlag(message) !== tableId) return;
    const id = message?.id ?? message?._id ?? null;
    if (typeof id === "string" && id !== "" && !ids.includes(id)) {
      ids.push(id);
    }
  };

  hooks.on("createChatMessage", handler);
  let stopped = false;
  return {
    available: true,
    stop() {
      if (!stopped) {
        stopped = true;
        hooks.off("createChatMessage", handler);
      }
      return [...ids];
    }
  };
}

export const BRIDGE_FLAG_SCOPE = "fvtt-world-cli";

/** @returns {string} */
export function newBridgeCorrelationId() {
  const uuid = globalThis.crypto?.randomUUID;
  if (typeof uuid === "function") return globalThis.crypto.randomUUID();
  return `corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {string} correlationId
 * @returns {ChatCapture}
 */
export function startCombatInitiativeChatCapture(correlationId) {
  const hooks = globalThis.Hooks;
  if (!hooks || typeof hooks.on !== "function" || typeof hooks.off !== "function") {
    return { available: false, stop: () => [] };
  }

  /** @type {string[]} */
  const ids = [];
  const handler = (message) => {
    const flag =
      typeof message?.getFlag === "function"
        ? (message.getFlag(BRIDGE_FLAG_SCOPE, "correlationId") ?? null)
        : (message?.flags?.[BRIDGE_FLAG_SCOPE]?.correlationId ?? null);
    if (flag !== correlationId) return;
    const id = message?.id ?? message?._id ?? null;
    if (typeof id === "string" && id !== "" && !ids.includes(id)) ids.push(id);
  };

  hooks.on("createChatMessage", handler);
  let stopped = false;
  return {
    available: true,
    stop() {
      if (!stopped) {
        stopped = true;
        hooks.off("createChatMessage", handler);
      }
      return [...ids];
    }
  };
}

/**
 * @param {object} options
 * @param {number} options.expectedCount
 * @param {string[]} options.ids
 * @returns {string[]}
 */
export function selectReportedChatIds({ expectedCount, ids }) {
  return ids.length > expectedCount ? [] : [...ids];
}

/**
 * @param {object} options
 * @param {boolean} options.requested
 * @param {boolean} options.available
 * @param {number} options.expectedCount
 * @param {string[]} options.ids
 * @returns {"captured"|"partial"|"not-created"|"not-requested"|"unknown"}
 */
export function deriveChatCaptureStatus({ requested, available, expectedCount, ids }) {
  if (!requested) return "not-requested";

  if (!available) return "unknown";
  if (ids.length >= expectedCount) {
    return "captured";
  }
  return ids.length > 0 ? "partial" : "not-created";
}
