import { ERROR_CODES } from "../generated/protocol.js";
import {
  assertBatchArrayWritesReflected,
  assertNoAmbiguousBatchKeySpellings,
  batchEmbeddedCreateKeys,
  batchMergedConfirmationKeys,
  batchValuesEqual,
  readDocumentSource,
  structuredCloneish
} from "./batch-guards.js";
import {
  BridgeError,
  createBridgeError,
  isFoundryValidationError,
  toFoundryValidationError
} from "./errors.js";
import { computeDocumentUpdateDiff, previewDocumentUpdate } from "./world-docs.js";

export const WORLD_VETO_REMEDY =
  "There is no force flag for a world-side veto — disable the module that blocks this write (or make the change from the Foundry UI) and retry.";

/**
 * @param {unknown} result
 * @returns {boolean}
 */
export function writeCommitted(result) {
  return Array.isArray(result) ? result.length > 0 : Boolean(result);
}

/**
 * @typedef {{ status: "confirmed", fields: [] }
 *   | { status: "pending", fields: string[] }
 *   | { status: "rejected", error: unknown }
 *   | { status: "unprovable", probeError: string }} RequestedStateProbe
 */

/**
 * @param {any} document
 * @param {Record<string, any>} requested
 * @returns {Promise<RequestedStateProbe>}
 */
export async function probeRequestedState(document, requested) {
  try {
    const diff = await computeDocumentUpdateDiff(document, structuredCloneish(requested ?? {}));
    const fields = Object.keys(diff).filter((key) => key !== "_id");
    return fields.length === 0 ? { status: "confirmed", fields: [] } : { status: "pending", fields };
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
 * @param {{ subject: string, hookName: string, details: Record<string, any>, remedy: string }} coordinates
 * @param {string[]} fields
 * @param {string | null} probeError
 * @returns {never}
 */
function throwUpdateNotCommitted({ subject, hookName, details, remedy }, fields, probeError) {
  throw createBridgeError(
    ERROR_CODES.INTERNAL_ERROR,
    `${subject} was NOT updated: Foundry resolved the update without applying it, which means a module's ${hookName} hook or a core _preUpdate refused the write, or the patch failed Foundry's own client-side validation (which Foundry reports only as a UI notification). It still holds its previous values for ${
      fields.join(", ") || "the requested fields"
    }. ${remedy}`,
    { ...details, fields, validationError: probeError }
  );
}

/**
 * @param {object} args
 * @param {any} args.document
 * @param {Record<string, any>} args.patch
 * @param {string} args.subject
 * @param {string} args.hookName
 * @param {Record<string, any>} args.details
 * @param {string} [args.remedy]
 * @returns {Promise<void>}
 */
export async function assertDocumentUpdateCommitted({
  document,
  patch,
  subject,
  hookName,
  details,
  remedy = WORLD_VETO_REMEDY
}) {
  const probe = await probeRequestedState(document, patch ?? {});
  if (probe.status === "confirmed") return;
  if (probe.status === "rejected") throwUpdateRejected({ subject, hookName, details }, probe.error);

  const fields =
    probe.status === "pending" ? probe.fields : Object.keys(patch ?? {}).filter((key) => key !== "_id");
  throwUpdateNotCommitted(
    { subject, hookName, details, remedy },
    fields,
    probe.status === "unprovable" ? probe.probeError : null
  );
}

/**
 * @param {string} key
 * @returns {string}
 */
function patchKeyRoot(key) {
  const first = key.split(".")[0] ?? "";
  return first.startsWith("==") || first.startsWith("-=") ? first.slice(2) : first;
}

/**
 * Foundry 14 silently discards several array-write shapes — a dotted path into an array field, an
 * invalid array value, an ambiguous dual spelling — without an error, a diff, or any trace the
 * post-write probe could see, so these shapes must be refused before the write, exactly as the
 * batch commands refuse them.
 * @param {object} args
 * @param {any} args.document
 * @param {any} args.documentClass
 * @param {Record<string, any>} args.requested
 * @param {any} args.mergedPreview
 * @param {string} args.subject
 * @param {Record<string, any>} args.details
 * @returns {void}
 */
function assertPatchShapeStorable({ document, documentClass, requested, mergedPreview, subject, details }) {
  const id = typeof document?.id === "string" ? document.id : "";
  const coordinate = `${subject} element 0 (id ${id})`;
  try {
    assertNoAmbiguousBatchKeySpellings({
      documentClass,
      patch: requested,
      index: 0,
      command: subject,
      id
    });
    if (mergedPreview !== null) {
      assertBatchArrayWritesReflected({
        documentClass,
        patch: requested,
        merged: mergedPreview,
        stored: document,
        index: 0,
        command: subject,
        id
      });
    }
  } catch (error) {
    if (error instanceof BridgeError) {
      const { index: _index, id: _entryId, ...guardDetails } = error.details ?? {};
      const message = error.message.split(coordinate).join(subject);
      throw createBridgeError(
        error.code,
        message.endsWith("Nothing was written.") ? message : `${message} Nothing was written.`,
        { ...details, ...guardDetails }
      );
    }
    throw error;
  }
}

/**
 * The preview-time face of the shape guard: a dry run must refuse exactly the patches the real
 * write refuses, before reporting a preview.
 * @param {object} args
 * @param {any} args.document
 * @param {Record<string, any>} args.patch
 * @param {string} args.subject
 * @param {Record<string, any>} [args.details]
 * @returns {Promise<void>}
 */
export async function assertRequestedWriteStorable({ document, patch, subject, details = {} }) {
  const requested = structuredCloneish(patch ?? {});
  let mergedPreview = null;
  try {
    mergedPreview = await previewDocumentUpdate(document, structuredCloneish(requested));
  } catch {
    mergedPreview = null;
  }
  assertPatchShapeStorable({
    document,
    documentClass: document?.constructor,
    requested,
    mergedPreview,
    subject,
    details
  });
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
  const requested = structuredCloneish(patch ?? {});
  const documentClass = document?.constructor;

  const mergedConfirmationKeys = batchMergedConfirmationKeys(requested);
  const embeddedCreateKeys = batchEmbeddedCreateKeys(documentClass, requested);

  let mergedPreview = null;
  try {
    mergedPreview = await previewDocumentUpdate(document, structuredCloneish(requested));
  } catch {
    mergedPreview = null;
  }
  assertPatchShapeStorable({ document, documentClass, requested, mergedPreview, subject, details });
  const mergedSource =
    mergedConfirmationKeys.length > 0 && mergedPreview !== null ? readDocumentSource(mergedPreview) : null;

  const requestedRoots = [...new Set(Object.keys(requested).map((key) => patchKeyRoot(key)))];
  const source = readDocumentSource(document);
  const beforeSource =
    source === null
      ? null
      : structuredCloneish(Object.fromEntries(requestedRoots.map((root) => [root, source[root]])));
  const returned = await write(structuredCloneish(requested));
  const current = await readDocument();
  const after = await probeRequestedState(current, requested);
  const stored = readDocumentSource(current);
  const changedFields =
    beforeSource !== null && stored !== null
      ? requestedRoots.filter((key) => key !== "_id" && !batchValuesEqual(beforeSource[key], stored[key]))
      : null;

  let unprovable = after.status === "unprovable";
  /** @type {string[] | null} */
  let pending = after.status === "confirmed" ? [] : after.status === "pending" ? [...after.fields] : null;

  if (pending !== null && pending.length > 0 && mergedConfirmationKeys.length > 0) {
    if (mergedSource === null || stored === null) {
      unprovable = true;
    } else {
      const reflected = new Set(
        mergedConfirmationKeys.filter((root) => batchValuesEqual(mergedSource[root], stored[root]))
      );
      pending = pending.filter((key) => !reflected.has(patchKeyRoot(key)));
    }
  }

  if (pending !== null && pending.length === 0 && embeddedCreateKeys.length === 0) return returned;

  const fields = [...new Set([...(pending ?? Object.keys(requested)), ...embeddedCreateKeys])].filter(
    (key) => key !== "_id"
  );

  if (unprovable || changedFields === null || embeddedCreateKeys.length > 0) {
    throw createBridgeError(
      ERROR_CODES.INTERNAL_ERROR,
      `${subject}: the requested update could not be confirmed. Foundry may have persisted some or all ` +
        `of the change. ${embeddedCreateKeys.length > 0 ? "Embedded creations without requested ids cannot be confirmed from the parent update result. " : ""}` +
        `Re-read the document before retrying, especially before creating embedded documents again.`,
      {
        ...details,
        fields,
        changedFields,
        indeterminate: true,
        validationError: after.status === "unprovable" ? after.probeError : null
      }
    );
  }

  if (changedFields.length > 0) {
    const pendingRoots = new Set(fields.map((key) => patchKeyRoot(key)));
    const appliedFields = changedFields.filter((root) => !pendingRoots.has(root));
    throw createBridgeError(
      ERROR_CODES.INTERNAL_ERROR,
      `${subject} was updated only in PART or rewritten: stored data changed in ${changedFields.join(", ")}, ` +
        `but the requested state is not confirmed for ${fields.join(", ")}. A module's ${hookName} hook, ` +
        `core _preUpdate, or another concurrent write may have changed the outcome. Re-read the document ` +
        `before deciding what remains to apply. ${remedy}`,
      { ...details, fields, changedFields, appliedFields, partial: true }
    );
  }

  if (after.status === "rejected") throwUpdateRejected({ subject, hookName, details }, after.error);
  throwUpdateNotCommitted({ subject, hookName, details, remedy }, fields, null);
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
