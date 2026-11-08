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

/** @param {Map<string, unknown>} values */
export function fakeSettingStorage(values) {
  const world = {
    getSetting: (/** @type {string} */ id) => (values.has(id) ? storedDocument(values, id) : undefined)
  };
  return new Map(
    /** @type {Array<[string, any]>} */ ([
      [
        "client",
        { getItem: (/** @type {string} */ id) => (values.has(id) ? JSON.stringify(values.get(id)) : null) }
      ],
      ["world", world],
      ["user", world]
    ])
  );
}
