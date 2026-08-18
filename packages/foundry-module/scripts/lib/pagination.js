/**
 * @template T
 * @param {T[]} items
 * @param {{ limit?: number | null; offset?: number | null }} [params]
 * @returns {{ page: T[]; total: number; hasMore: boolean }}
 */
export function paginate(items, params = {}) {
  const total = items.length;
  const offset = params.offset != null ? params.offset : 0;
  const end = params.limit != null ? offset + params.limit : undefined;
  const page = items.slice(offset, end);
  return {
    page,
    total,
    hasMore: offset + page.length < total
  };
}

/**
 * @template {{ name?: unknown }} T
 * @param {T[]} items
 * @param {string | null | undefined} name
 * @param {{ exact?: boolean, nameOf?: (entry: T) => unknown }} [options]
 * @returns {T[]}
 */
export function filterByName(items, name, { exact, nameOf } = {}) {
  if (name == null) {
    return items;
  }

  const read = typeof nameOf === "function" ? nameOf : (entry) => entry?.name;
  const needle = String(name).toLowerCase();
  return items.filter((entry) => {
    const candidate = String(read(entry) ?? "").toLowerCase();
    return exact ? candidate === needle : candidate.includes(needle);
  });
}

/**
 * @template {{ path?: unknown }} T
 * @param {T[]} items
 * @param {string | null | undefined} path
 * @returns {T[]}
 */
export function filterByPath(items, path) {
  if (path == null) {
    return items;
  }

  const needle = String(path).toLowerCase();
  return items.filter((entry) =>
    String(entry?.path ?? "")
      .toLowerCase()
      .includes(needle)
  );
}
