import { ERROR_CODES } from "../generated/protocol.js";
import {
  assertBatchArrayWritesReflected,
  assertNoAmbiguousBatchKeySpellings,
  assertNoStoredArrayDescent,
  assertNoTopLevelDottedArrayWrite,
  batchEmbeddedCreateKeys,
  expandPatch,
  readDocumentSource,
  structuredCloneish
} from "./batch-guards.js";
import {
  BridgeError,
  createBridgeError,
  isFoundryValidationError,
  toFoundryValidationError
} from "./errors.js";
import {
  WORLD_VETO_REMEDY,
  changedRoots,
  createMismatchError,
  evaluateRequestedDiff,
  requestedRoots,
  snapshotRoots
} from "./mismatch-report.js";
import { computeDocumentUpdateDiff, previewExpandedDocumentUpdate } from "./world-docs.js";

/**
 * @param {unknown} result
 * @returns {boolean}
 */
export function writeCommitted(result) {
  return Array.isArray(result) ? result.length > 0 : Boolean(result);
}

/**
 * @typedef {import("./mismatch-report.js").RequestedDiffEvaluation
 *   | { status: "rejected", error: unknown }} RequestedStateProbe
 */

/**
 * @param {any} document
 * @param {Record<string, any>} requested
 * @returns {Promise<RequestedStateProbe>}
 */
export async function probeRequestedState(document, requested) {
  try {
    const diff = await computeDocumentUpdateDiff(document, structuredCloneish(requested ?? {}));
    return evaluateRequestedDiff(diff, () => readDocumentSource(document));
  } catch (error) {
    if (isFoundryValidationError(error)) {
      return { status: "rejected", error };
    }
    return { status: "unprovable", probeError: /** @type {any} */ (error)?.message ?? String(error) };
  }
}

/**
 * @param {{ subject: string, hookName: string, details: Record<string, any> }} coordinates
 * @param {unknown} error
 * @returns {never}
 */
function throwUpdateRejected({ subject, hookName, details }, error) {
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `${subject} was NOT updated: Foundry REJECTED the patch. Foundry's client backend reports such a validation failure only as a UI notification and resolves the update without writing, so the bridge re-ran the same validation to recover the cause — see details.message for the raw validation error (and details.errors, when Foundry exposes the offending field paths), fix the offending field and resend. This is NOT a module veto: no ${hookName} hook was involved.`,
    {
      ...details,
      ...toFoundryValidationError(error).details
    }
  );
}

/**
 * @param {object} args
 * @param {any} args.document
 * @param {Record<string, any>} args.patch
 * @param {string} args.subject
 * @param {string} args.hookName
 * @param {Record<string, any>} args.details
 * @param {Record<string, any> | null} args.before
 * @param {string} [args.remedy]
 * @param {string} [args.note]
 * @param {boolean} [args.resendDeterministic]
 * @returns {Promise<void>}
 */
export async function assertDocumentUpdateCommitted({
  document,
  patch,
  subject,
  hookName,
  details,
  before,
  remedy = WORLD_VETO_REMEDY,
  note = "",
  resendDeterministic = true
}) {
  const probe = await probeRequestedState(document, patch ?? {});
  if (probe.status === "confirmed") return;
  const changedFields = changedRoots(requestedRoots(patch), before, readDocumentSource(document));
  if (probe.status === "rejected" && changedFields !== null && changedFields.length === 0) {
    throwUpdateRejected({ subject, hookName, details }, probe.error);
  }
  if (probe.status !== "pending") {
    throw createIndeterminateError({ subject, probe, fields: requestedRoots(patch), changedFields, details });
  }
  throw createMismatchError({
    subject,
    report: probe.report,
    hookName,
    changedFields,
    details,
    note,
    remedy,
    resendDeterministic
  });
}

/**
 * @param {object} args
 * @param {string} args.subject
 * @param {RequestedStateProbe} args.probe
 * @param {string[]} args.fields
 * @param {string[] | null} args.changedFields
 * @param {Record<string, any>} args.details
 * @param {string} [args.note]
 */
export function createIndeterminateError({
  subject,
  probe,
  fields,
  changedFields,
  details,
  note = "Re-read the document before retrying."
}) {
  return createBridgeError(
    ERROR_CODES.INTERNAL_ERROR,
    `${subject}: the requested update could not be confirmed. Foundry may have persisted some or all of the change. ${note}`,
    {
      ...details,
      fields,
      ...(probe.status === "pending"
        ? {
            paths: probe.report.paths,
            ...(probe.report.pathsTruncated ? { pathsTruncated: probe.report.pathsTruncated } : {})
          }
        : {}),
      changedFields,
      indeterminate: true,
      validationError: probeFailureMessage(probe)
    }
  );
}

/**
 * @param {RequestedStateProbe} probe
 * @returns {string | null}
 */
function probeFailureMessage(probe) {
  if (probe.status === "unprovable") return probe.probeError;
  if (probe.status === "rejected") {
    const error = /** @type {any} */ (probe.error);
    return String(error?.message ?? error);
  }
  return null;
}

/**
 * @param {object} args
 * @param {any} args.document
 * @param {Record<string, any>} args.patch
 * @param {string} args.subject
 * @param {Record<string, any>} [args.details]
 * @returns {Promise<Record<string, any>>}
 */
export async function assertRequestedWriteStorable({ document, patch, subject, details = {} }) {
  const documentClass = document?.constructor;
  const id = typeof document?.id === "string" ? document.id : "";
  try {
    const expanded = expandPatch(patch ?? {});
    assertNoAmbiguousBatchKeySpellings({
      expandedPatch: expanded,
      index: 0,
      command: subject,
      id,
      coordinate: subject
    });
    const storedSource = readDocumentSource(document);
    assertNoTopLevelDottedArrayWrite({
      rawPatch: patch ?? {},
      stored: storedSource,
      documentClass,
      index: 0,
      command: subject,
      id,
      coordinate: subject
    });
    assertNoStoredArrayDescent({
      expandedPatch: expanded,
      stored: storedSource,
      documentClass,
      index: 0,
      command: subject,
      id,
      coordinate: subject
    });
    let mergedPreview = null;
    try {
      mergedPreview = await previewExpandedDocumentUpdate(document, structuredCloneish(expanded));
    } catch {
      mergedPreview = null;
    }
    if (mergedPreview !== null) {
      assertBatchArrayWritesReflected({
        documentClass,
        patch: expanded,
        merged: mergedPreview,
        stored: document,
        index: 0,
        command: subject,
        id,
        coordinate: subject
      });
    }
    return expanded;
  } catch (error) {
    if (error instanceof BridgeError) {
      const { index: _index, id: _entryId, ...guardDetails } = error.details ?? {};
      throw createBridgeError(
        error.code,
        error.message.endsWith("Nothing was written.")
          ? error.message
          : `${error.message} Nothing was written.`,
        { ...details, ...guardDetails }
      );
    }
    throw error;
  }
}

/**
 * @param {object} args
 * @param {any} args.document
 * @param {Record<string, any>} args.patch
 * @param {(payload: Record<string, any>) => Promise<any>} args.write
 * @param {() => any | Promise<any>} [args.readDocument]
 * @param {string} args.subject
 * @param {string} args.hookName
 * @param {Record<string, any>} args.details
 * @param {string} [args.remedy]
 * @returns {Promise<any>}
 */
export async function applyConfirmedUpdate({
  document,
  patch,
  write,
  readDocument = () => document,
  subject,
  hookName,
  details,
  remedy = WORLD_VETO_REMEDY
}) {
  const expanded = await assertRequestedWriteStorable({ document, patch, subject, details });
  const embeddedCreateKeys = batchEmbeddedCreateKeys(document?.constructor, expanded);
  const roots = requestedRoots(expanded);
  const beforeSource = snapshotRoots(readDocumentSource(document), roots);
  const returned = await write(structuredCloneish(expanded));
  const current = await readDocument();
  const after = await probeRequestedState(current, expanded);
  if (after.status === "confirmed" && embeddedCreateKeys.length === 0) return returned;

  const changedFields = changedRoots(roots, beforeSource, readDocumentSource(current));

  const pendingFields =
    after.status === "pending" ? after.report.fields : after.status === "confirmed" ? [] : roots;
  const fields = [...new Set([...pendingFields, ...embeddedCreateKeys])].filter((key) => key !== "_id");

  if (after.status === "rejected" && changedFields !== null && changedFields.length === 0) {
    throwUpdateRejected({ subject, hookName, details }, after.error);
  }

  if (after.status !== "pending" || changedFields === null || embeddedCreateKeys.length > 0) {
    throw createIndeterminateError({
      subject,
      probe: after,
      fields,
      changedFields,
      details,
      note:
        `${embeddedCreateKeys.length > 0 ? "Embedded creations without requested ids cannot be confirmed from the parent update result. " : ""}` +
        "Re-read the document before retrying, especially before creating embedded documents again."
    });
  }

  throw createMismatchError({
    subject,
    report: after.report,
    hookName,
    changedFields,
    details,
    remedy
  });
}

/**
 * @param {object} args
 * @param {boolean} args.committed
 * @param {string} args.subject
 * @param {string} args.hookName
 * @param {Record<string, any>} args.details
 * @param {string} [args.remedy]
 * @returns {void}
 */
export function assertDocumentDeleteCommitted({
  committed,
  subject,
  hookName,
  details,
  remedy = WORLD_VETO_REMEDY
}) {
  if (committed) return;
  throw createBridgeError(
    ERROR_CODES.INTERNAL_ERROR,
    `${subject} was NOT deleted: Foundry resolved the delete without removing the document, which means a module's ${hookName} hook or a core _preDelete refused it. Nothing was deleted. ${remedy}`,
    details
  );
}
