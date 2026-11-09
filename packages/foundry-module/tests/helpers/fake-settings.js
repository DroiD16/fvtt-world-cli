/**
 * @param {unknown} value
 * @returns {string | null}
 */
function jsonFieldSource(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * @param {Map<string, unknown>} values
 * @param {string} id
 */
function storedDocument(values, id) {
  return { id: `setting-${id}`, _source: { value: JSON.stringify(values.get(id)) } };
}

/**
 * @param {Map<string, unknown>} values
 * @param {string} id
 * @param {unknown} defaultValue
 */
export function fakeSettingDocument(values, id, defaultValue) {
  return values.has(id)
    ? storedDocument(values, id)
    : { id: null, _source: { value: jsonFieldSource(defaultValue) } };
}
