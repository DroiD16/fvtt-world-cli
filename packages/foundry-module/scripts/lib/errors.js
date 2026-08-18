import { ERROR_CODES } from "../generated/protocol.js";

export class BridgeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function createBridgeError(code, message, details = {}) {
  return new BridgeError(code, message, details);
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isFoundryValidationError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  if (/** @type {any} */ (error).name === "DataModelValidationError") {
    return true;
  }

  const ValidationError = /** @type {any} */ (globalThis).foundry?.data?.validation?.DataModelValidationError;
  return typeof ValidationError === "function" && error instanceof ValidationError;
}

/** @param {any} error */
export function toFoundryValidationError(error) {
  const rawMessage = error instanceof Error ? error.message : String(error?.message ?? "");
  const details = {
    reason: "foundry_validation",
    message: rawMessage
  };

  const failures = typeof error?.getAllFailures === "function" ? error.getAllFailures() : undefined;
  if (failures && typeof failures === "object") {
    const fieldErrors = Object.keys(failures);
    if (fieldErrors.length > 0) {
      /** @type {any} */ (details).errors = fieldErrors;
    }
  }

  return {
    code: ERROR_CODES.INVALID_PARAMS,
    message:
      "Foundry rejected the document data; see details.message for the raw validation error and details.errors (when present) for the offending field paths, then fix those fields and resend",
    details
  };
}

/**
 * @param {unknown} error
 * @returns {{code: string, message: string}}
 */
export function toFailureSummary(error) {
  const protocolError = isFoundryValidationError(error)
    ? toFoundryValidationError(error)
    : toProtocolError(error);
  const raw = /** @type {any} */ (protocolError.details)?.message;
  return {
    code: protocolError.code,
    message: typeof raw === "string" && raw !== "" ? raw : protocolError.message
  };
}

export function toProtocolError(error) {
  if (error instanceof BridgeError) {
    const details = error.details ?? {};

    if (error.code === ERROR_CODES.INTERNAL_ERROR && details.message === undefined) {
      return {
        code: error.code,
        message: error.message,
        details: { ...details, message: error.message }
      };
    }

    return {
      code: error.code,
      message: error.message,
      details
    };
  }

  return {
    code: ERROR_CODES.INTERNAL_ERROR,
    message: error instanceof Error ? error.message : "Unexpected bridge error",
    details: {
      message: error instanceof Error ? error.message : String(error ?? "Unexpected bridge error")
    }
  };
}
