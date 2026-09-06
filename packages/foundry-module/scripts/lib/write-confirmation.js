import { ERROR_CODES } from "../generated/protocol.js";
import {
  batchEcfResidualEntries,
  batchEmbeddedCreateKeys,
  batchMergedConfirmationKeys,
  mergedPreviewReflected,
  readDocumentSource,
  structuredCloneish
} from "./batch-guards.js";
import { createBridgeError, isFoundryValidationError, toFoundryValidationError } from "./errors.js";
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
 * Runs one single-document update and reports success only after the stored document holds the
 * requested state. The write receives a private deep copy of the patch: a preUpdate hook may
 * mutate the payload it is handed before vetoing, so every confirmation probe must compare
 * against the caller's untouched patch, never the object Foundry saw.
 * @param {object} args
 * @param {any} args.document
 * @param {Record<string, any>} args.patch
 * @param {(payload: Record<string, any>) => Promise<unknown>} args.write
 * @param {string} args.subject
 * @param {string} args.hookName
 * @param {Record<string, any>} args.details
 * @param {string} [args.remedy]
 * @returns {Promise<void>}
 */
export async function applyConfirmedUpdate({
  document,
  patch,
  write,
  subject,
  hookName,
  details,
  remedy = WORLD_VETO_REMEDY
}) {
  const requested = structuredCloneish(patch ?? {});
  const documentClass = document?.constructor;

  const mergedConfirmationKeys = batchMergedConfirmationKeys(requested);
  let mergedSource = null;
  if (mergedConfirmationKeys.length > 0) {
    try {
      mergedSource = readDocumentSource(await previewDocumentUpdate(document, structuredCloneish(requested)));
    } catch {
      mergedSource = null;
    }
  }
  const embeddedCreateKeys = batchEmbeddedCreateKeys(documentClass, requested);

  const before = await probeRequestedState(document, requested);
  const requestedChangeFields = before.status === "pending" ? before.fields : null;

  const returned = await write(structuredCloneish(requested));

  const after = await probeRequestedState(document, requested);
  if (after.status === "rejected") throwUpdateRejected({ subject, hookName, details }, after.error);

  let applied = after.status === "confirmed";
  let probeAnswered = after.status !== "unprovable";

  if (!applied && mergedConfirmationKeys.length > 0) {
    const reflected = mergedPreviewReflected({ document, mergedSource, mergedConfirmationKeys });
    applied = reflected === true;
    probeAnswered = reflected !== null;
  }

  if (!applied && embeddedCreateKeys.length > 0) {
    const residual = { ...requested };
    for (const key of embeddedCreateKeys) {
      const retained = batchEcfResidualEntries(residual[key]);
      if (retained.length > 0) residual[key] = retained;
      else delete residual[key];
    }
    let residualConfirmed = Object.keys(residual).length === 0;
    if (!residualConfirmed) {
      const residualProbe = await probeRequestedState(document, residual);
      residualConfirmed = residualProbe.status === "confirmed";
      if (residualProbe.status === "unprovable") probeAnswered = false;
    }
    applied = residualConfirmed && writeCommitted(returned);
  }

  if (applied) return;

  const fields =
    after.status === "pending" ? after.fields : Object.keys(requested).filter((key) => key !== "_id");

  if (probeAnswered && requestedChangeFields !== null && after.status === "pending") {
    const appliedFields = requestedChangeFields.filter((key) => !after.fields.includes(key));
    if (appliedFields.length > 0) {
      throw createBridgeError(
        ERROR_CODES.INTERNAL_ERROR,
        `${subject} was updated only in PART: Foundry persisted ${appliedFields.join(", ")} but resolved ` +
          `${fields.join(", ")} without applying ${fields.length === 1 ? "it" : "them"} — a module's ` +
          `${hookName} hook stripped or rewrote that part of the change while letting the rest through, ` +
          `which Foundry reports only as a UI notification, if at all. The document now holds a MIX of ` +
          `requested and previous values — re-read it before deciding what to do. ${remedy}`,
        { ...details, fields, appliedFields, partial: true }
      );
    }
  }

  throwUpdateNotCommitted(
    { subject, hookName, details, remedy },
    fields,
    after.status === "unprovable" ? after.probeError : null
  );
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
