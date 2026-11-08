/**
 * @param {unknown} value
 * @returns {boolean}
 */
function holdsOverride(value) {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return true;
  return Object.keys(value).length > 0;
}

/**
 * @param {Record<string, any> | null | undefined} delta
 * @returns {{ itemEntries: number, effectEntries: number, overriddenKeys: string[] } | null}
 */
export function summarizeTokenDelta(delta) {
  if (!delta || typeof delta !== "object") return null;
  const overriddenKeys = Object.keys(delta).filter((key) => key !== "_id" && holdsOverride(delta[key]));
  if (overriddenKeys.length === 0) return null;
  return {
    itemEntries: Array.isArray(delta.items) ? delta.items.length : 0,
    effectEntries: Array.isArray(delta.effects) ? delta.effects.length : 0,
    overriddenKeys
  };
}
