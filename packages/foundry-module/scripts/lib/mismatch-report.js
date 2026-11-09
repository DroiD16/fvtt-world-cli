import { ERROR_CODES } from "../generated/protocol.js";
import { isPlainObject, sourceValuesEqual, structuredCloneish } from "./batch-guards.js";
import { createBridgeError } from "./errors.js";

export const WORLD_VETO_REMEDY =
  "One possible cause is a module that blocks or rewrites this write; there is no force flag to override that, and the same change can also be made from the Foundry UI.";

export const MISMATCH_PATH_LIMIT = 20;
const LISTED_PATH_LIMIT = 5;
const TEXT_LIMIT = 240;
const JSON_LIMIT = 480;
const WINDOW_LENGTH = 160;
const WINDOW_CONTEXT = 48;

/**
 * @typedef {{ segments: string[], deletes?: boolean, requested?: unknown }} RequestedLeaf
 * @typedef {{ path: string, requested?: unknown, stored?: unknown, absent?: "requested" | "stored", truncated?: { format: "text" | "json", offset: number, requestedLength: number, storedLength: number } }} MismatchPath
 * @typedef {{ fields: string[], paths: MismatchPath[], pathsTruncated?: number }} MismatchReport
 * @typedef {{ status: "confirmed" }
 *   | { status: "pending", report: MismatchReport }
 *   | { status: "unprovable", probeError: string }} RequestedDiffEvaluation
 */

/**
 * @param {unknown} value
 * @returns {{ deletes: boolean, value?: unknown } | null}
 */
function dataFieldOperator(value) {
  const operators = /** @type {any} */ (globalThis).foundry?.data?.operators;
  const Base = operators?.DataFieldOperator;
  if (typeof Base !== "function" || !(value instanceof Base)) return null;
  if (typeof operators.ForcedDeletion === "function" && value instanceof operators.ForcedDeletion) {
    return { deletes: true };
  }
  return { deletes: false, value: Base.get(value) };
}

/**
 * @param {Record<string, unknown>} diff
 * @param {string[]} prefix
 * @param {RequestedLeaf[]} out
 */
function collectLeaves(diff, prefix, out) {
  for (const [key, value] of Object.entries(diff)) {
    if (prefix.length === 0 && key === "_id") continue;
    const operator = key.startsWith("-=") ? "delete" : key.startsWith("==") ? "replace" : null;
    const segments = [...prefix, operator ? key.slice(2) : key];
    if (operator === "delete") {
      out.push({ segments, deletes: true });
      continue;
    }
    if (operator === "replace") {
      out.push({ segments, requested: value });
      continue;
    }
    const inner = dataFieldOperator(value);
    if (inner) {
      out.push(inner.deletes ? { segments, deletes: true } : { segments, requested: inner.value });
      continue;
    }
    if (isPlainObject(value) && Object.keys(/** @type {object} */ (value)).length > 0) {
      collectLeaves(/** @type {Record<string, unknown>} */ (value), segments, out);
      continue;
    }
    out.push(value === undefined ? { segments, deletes: true } : { segments, requested: value });
  }
}

/**
 * @param {unknown} source
 * @param {string[]} segments
 * @returns {{ present: boolean, value?: unknown }}
 */
function readStoredPath(source, segments) {
  let current = /** @type {any} */ (source);
  for (const segment of segments) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      return { present: false };
    }
    current = current[segment];
  }
  return current === undefined ? { present: false } : { present: true, value: current };
}

/**
 * @param {RequestedLeaf} leaf
 * @param {unknown} stored
 */
function leafSatisfied(leaf, stored) {
  const found = readStoredPath(stored, leaf.segments);
  if (leaf.deletes) return !found.present;
  return found.present && sourceValuesEqual(leaf.requested, found.value);
}

/**
 * @param {string} a
 * @param {string} b
 */
function firstDifference(a, b) {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return index;
  }
  return length;
}

/**
 * @param {unknown} value
 * @param {"text" | "json"} format
 */
function serialize(value, format) {
  if (format === "text") return /** @type {string} */ (value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * @param {MismatchPath} entry
 * @returns {MismatchPath}
 */
function shortenEntry(entry) {
  const hasRequested = entry.absent !== "requested";
  const hasStored = entry.absent !== "stored";
  const textual =
    (!hasRequested || typeof entry.requested === "string") &&
    (!hasStored || typeof entry.stored === "string");
  /** @type {"text" | "json"} */
  const format = textual ? "text" : "json";
  const limit = textual ? TEXT_LIMIT : JSON_LIMIT;
  const requestedText = hasRequested ? serialize(entry.requested, format) : "";
  const storedText = hasStored ? serialize(entry.stored, format) : "";
  if (requestedText.length <= limit && storedText.length <= limit) return entry;
  const offset = firstDifference(requestedText, storedText);
  const start = Math.max(0, offset - WINDOW_CONTEXT);
  /** @type {MismatchPath} */
  const shortened = { path: entry.path };
  if (hasRequested) shortened.requested = requestedText.slice(start, start + WINDOW_LENGTH);
  if (hasStored) shortened.stored = storedText.slice(start, start + WINDOW_LENGTH);
  if (entry.absent) shortened.absent = entry.absent;
  shortened.truncated = {
    format,
    offset,
    requestedLength: requestedText.length,
    storedLength: storedText.length
  };
  return shortened;
}

/**
 * @param {RequestedLeaf[]} leaves
 * @param {unknown} stored
 * @returns {MismatchReport}
 */
export function buildMismatchReport(leaves, stored) {
  const entries = leaves.map((leaf) => {
    /** @type {MismatchPath} */
    const entry = { path: leaf.segments.join(".") };
    if (leaf.deletes) entry.absent = "requested";
    else entry.requested = leaf.requested;
    const found = readStoredPath(stored, leaf.segments);
    if (found.present) entry.stored = found.value;
    else entry.absent = "stored";
    return shortenEntry(entry);
  });
  /** @type {MismatchReport} */
  const report = {
    fields: [...new Set(leaves.map((leaf) => leaf.segments[0]))],
    paths: entries.slice(0, MISMATCH_PATH_LIMIT)
  };
  if (entries.length > MISMATCH_PATH_LIMIT) report.pathsTruncated = entries.length - MISMATCH_PATH_LIMIT;
  return report;
}

/**
 * @param {Record<string, unknown> | null | undefined} diff
 * @param {() => unknown} readStored
 * @returns {RequestedDiffEvaluation}
 */
export function evaluateRequestedDiff(diff, readStored) {
  const source = diff && typeof diff === "object" ? diff : {};
  if (Object.keys(source).every((key) => key === "_id")) return { status: "confirmed" };
  const stored = readStored();
  if (stored === null || typeof stored !== "object") {
    return { status: "unprovable", probeError: "the stored document source is not readable" };
  }
  /** @type {RequestedLeaf[]} */
  const leaves = [];
  collectLeaves(source, [], leaves);
  const pending = leaves.filter((leaf) => !leafSatisfied(leaf, stored));
  if (pending.length === 0) return { status: "confirmed" };
  const report = buildMismatchReport(pending, stored);
  return { status: "pending", report };
}

/**
 * @param {string[]} roots
 * @param {Record<string, unknown> | null} before
 * @param {Record<string, unknown> | null} stored
 * @returns {string[] | null}
 */
export function changedRoots(roots, before, stored) {
  if (before === null || stored === null) return null;
  return roots.filter((root) => root !== "_id" && !sourceValuesEqual(before[root], stored[root]));
}

/**
 * @param {Record<string, any>} patch
 * @returns {string[]}
 */
export function requestedRoots(patch) {
  const roots = Object.keys(patch ?? {}).map((key) => (key.split(".")[0] ?? "").replace(/^(==|-=)/, ""));
  return [...new Set(roots)].filter((root) => root !== "_id");
}

/**
 * @param {Record<string, any> | null} source
 * @param {string[]} roots
 * @returns {Record<string, any> | null}
 */
export function snapshotRoots(source, roots) {
  return source === null
    ? null
    : structuredCloneish(Object.fromEntries(roots.map((root) => [root, source[root]])));
}

/**
 * @param {string | null} [hookName]
 * @returns {string}
 */
export function unverifiableCauseSentence(hookName = null, { resendDeterministic = true } = {}) {
  return (
    `The bridge cannot verify whether Foundry core, the game system or a module normalized the value, or ` +
    `whether a ${hookName ? `${hookName} ` : ""}hook rewrote, dropped or vetoed the change` +
    (resendDeterministic ? `, so resending the same value will not change the result.` : ".")
  );
}

/**
 * @param {MismatchReport} report
 * @param {string} pathsAt
 */
function describeLocation(report, pathsAt) {
  const total = report.paths.length + (report.pathsTruncated ?? 0);
  const listed = report.paths.slice(0, LISTED_PATH_LIMIT).map((entry) => entry.path);
  const more = total - listed.length;
  return `at ${listed.join(", ")}${more > 0 ? ` and ${more} more path(s)` : ""} (${pathsAt} lists the requested and the stored value per path)`;
}

/**
 * @param {object} args
 * @param {string} args.subject
 * @param {MismatchReport} args.report
 * @param {string | null} [args.hookName]
 * @param {string[] | null} [args.changedFields]
 * @param {Record<string, any>} [args.details]
 * @param {string} [args.note]
 * @param {string} [args.pathsAt]
 * @param {string} [args.remedy]
 * @param {boolean} [args.resendDeterministic]
 */
export function createMismatchError({
  subject,
  report,
  hookName = null,
  changedFields = null,
  details = {},
  note = "",
  pathsAt = "details.paths",
  remedy = WORLD_VETO_REMEDY,
  resendDeterministic = true
}) {
  /** @type {Record<string, any>} */
  const change = {};
  let changeSentence = "";
  if (Array.isArray(changedFields)) {
    change.changedFields = changedFields;
    if (changedFields.length > 0) {
      const pendingRoots = new Set(report.fields);
      change.appliedFields = changedFields.filter((root) => !pendingRoots.has(root));
      change.partial = true;
      changeSentence = `Stored data did change in ${changedFields.join(", ")}. `;
    } else {
      changeSentence = "None of the requested fields changed. ";
    }
  }
  return createBridgeError(
    ERROR_CODES.INTERNAL_ERROR,
    `${subject}: Foundry stored a different value than requested ${describeLocation(report, pathsAt)}. ` +
      `${unverifiableCauseSentence(hookName, { resendDeterministic })} ${changeSentence}` +
      `Compare the requested and stored values and re-read the stored state before deciding what remains to apply. ${note ? `${note} ` : ""}${remedy}`,
    {
      ...details,
      fields: report.fields,
      paths: report.paths,
      ...(report.pathsTruncated ? { pathsTruncated: report.pathsTruncated } : {}),
      ...change
    }
  );
}
