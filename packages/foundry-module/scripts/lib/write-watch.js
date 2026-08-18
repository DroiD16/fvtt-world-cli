/**
 * @typedef {object} DocumentUpdateWatch
 * @property {boolean} available
 * @property {() => boolean} stop
 */

/**
 * @param {string} combatId
 * @returns {DocumentUpdateWatch}
 */
export function startCombatUpdateWatch(combatId) {
  const hooks = globalThis.Hooks;
  if (!hooks || typeof hooks.on !== "function" || typeof hooks.off !== "function") {
    return { available: false, stop: () => false };
  }

  let observed = false;
  const handler = (document) => {
    const id = document?.id ?? document?._id ?? null;
    if (typeof id === "string" && id === combatId) observed = true;
  };

  hooks.on("updateCombat", handler);
  let stopped = false;
  return {
    available: true,
    stop() {
      if (!stopped) {
        stopped = true;
        hooks.off("updateCombat", handler);
      }
      return observed;
    }
  };
}
