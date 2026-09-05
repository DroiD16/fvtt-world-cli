import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError, isFoundryValidationError, toFoundryValidationError } from "./errors.js";
import { computeDocumentUpdateDiff } from "./world-docs.js";

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
  let diff;
  let probeError = null;
  try {
    diff = await computeDocumentUpdateDiff(document, patch);
  } catch (error) {
    if (isFoundryValidationError(error)) {
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        `${subject} was NOT updated: Foundry REJECTED the patch. Foundry's client backend reports such a validation failure only as a UI notification and resolves the update without writing, so the bridge re-ran the same validation to recover the cause — see details.message for the raw validation error (and details.errors, when Foundry exposes the offending field paths), fix the offending field and resend. This is NOT a module veto: no ${hookName} hook was involved.`,
        {
          ...details,
          ...toFoundryValidationError(error).details
        }
      );
    }
    probeError = /** @type {any} */ (error)?.message ?? String(error);
    diff = null;
  }
  if (diff !== null && Object.keys(diff).length === 0) return;

  const fields = (diff ? Object.keys(diff) : Object.keys(patch ?? {})).filter((key) => key !== "_id");
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
