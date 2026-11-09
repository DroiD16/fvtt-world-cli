/**
 * @param {unknown} value
 * @returns {string | null}
 */
function jsonFieldSource(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
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
