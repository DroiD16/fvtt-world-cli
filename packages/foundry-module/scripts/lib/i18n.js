/** @param {string} key */
export function localize(key) {
  return globalThis.game?.i18n?.localize?.(key) ?? key;
}

/**
 * @param {string} key
 * @param {Record<string, string | number>} data
 */
export function format(key, data) {
  return globalThis.game?.i18n?.format?.(key, data) ?? key;
}
