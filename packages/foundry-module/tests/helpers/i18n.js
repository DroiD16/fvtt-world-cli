import { readFileSync } from "node:fs";

const CATALOG = JSON.parse(readFileSync(new URL("../../languages/en.json", import.meta.url), "utf8"));

// Foundry's Localization#format substitutes every {name} with data[name] and stringifies a missing
// key as "undefined" (v13 localization.mjs:415-422, v14 localization.mjs:435-445, format === localize).
const PLACEHOLDER_PATTERN = /{[^}]+}/g;

/** @param {string} key */
export function localizeEnglish(key) {
  const value = key.split(".").reduce((branch, part) => branch?.[part], CATALOG);
  return typeof value === "string" ? value : key;
}

/**
 * @param {string} key
 * @param {Record<string, unknown>} [data]
 */
export function formatEnglish(key, data = {}) {
  return localizeEnglish(key).replace(PLACEHOLDER_PATTERN, (placeholder) =>
    String(data[placeholder.slice(1, -1)])
  );
}

export function createEnglishI18n() {
  return { localize: localizeEnglish, format: formatEnglish };
}
