import {
  COMMAND_DEFINITIONS,
  CLIENT_HELLO_SCHEMA,
  DAEMON_OPERATION_DEFINITIONS,
  DAEMON_REQUEST_SCHEMA,
  HELLO_SCHEMA,
  PAIRING_REQUEST_SCHEMA,
  REQUEST_SCHEMA,
  TRANSPORT_MESSAGE_SCHEMAS,
  getCommandDefinition,
  getInvalidCommandError,
  isKnownCommand
} from "./commands.js";
import { ERROR_CODES, MESSAGE_TYPES, PROTOCOL_VERSION } from "./constants.js";

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {string} value
 * @param {number} stopAfter
 * @returns {number}
 */
function countCodePoints(value, stopAfter) {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        index += 1;
      }
    }
    count += 1;
    if (count > stopAfter) {
      return count;
    }
  }
  return count;
}

// validateSchema is total: every caller handles an error array and nothing catches a throw,
// so a pattern that cannot compile must fail closed here instead of escaping as a SyntaxError.
/**
 * @param {string} pattern
 * @returns {RegExp | null}
 */
function compilePattern(pattern) {
  try {
    return new RegExp(pattern, "u");
  } catch {
    return null;
  }
}

function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);
  for (let i = 1; i < rows; i += 1) {
    const current = [i];
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[cols - 1];
}

function describeAllowedFields(key, allowedFields) {
  if (allowedFields.length === 0) {
    return "";
  }

  const threshold = Math.max(1, Math.floor(key.length / 3));
  let closest = null;
  let closestDistance = Infinity;
  for (const candidate of allowedFields) {
    const distance = editDistance(key, candidate);
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }

  const allowedList = `allowed fields: ${allowedFields.join(", ")}`;
  if (closest !== null && closestDistance > 0 && closestDistance <= threshold) {
    return ` (did you mean "${closest}"? ${allowedList})`;
  }
  return ` (${allowedList})`;
}

function matchesType(expectedType, value) {
  if (Array.isArray(expectedType)) {
    return expectedType.some((typeName) => matchesType(typeName, value));
  }

  switch (expectedType) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isPlainObject(value);
    case "string":
      return typeof value === "string";
    default:
      return true;
  }
}

function validateObjectSchema(schema, value, path, errors) {
  const required = schema.required ?? [];
  const properties = schema.properties ?? {};
  const additionalProperties = schema.additionalProperties ?? true;

  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      errors.push(`${path}.${key} is required`);
    }
  }

  const ownKeys = Object.keys(value);
  if (typeof schema.minProperties === "number" && ownKeys.length < schema.minProperties) {
    errors.push(`${path} must contain at least ${schema.minProperties} properties`);
  }

  for (const [key, propertyValue] of Object.entries(value)) {
    const propertySchema = properties[key];

    if (propertySchema) {
      validateSchema(propertySchema, propertyValue, `${path}.${key}`, errors);
      continue;
    }

    if (additionalProperties === false) {
      errors.push(`${path}.${key} is not allowed${describeAllowedFields(key, Object.keys(properties))}`);
      continue;
    }

    if (isPlainObject(additionalProperties)) {
      validateSchema(additionalProperties, propertyValue, `${path}.${key}`, errors);
    }
  }
}

function validateArraySchema(schema, value, path, errors) {
  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    errors.push(`${path} must contain at least ${schema.minItems} items`);
  }

  if (!schema.items) {
    return;
  }

  for (let index = 0; index < value.length; index += 1) {
    validateSchema(schema.items, value[index], `${path}[${index}]`, errors);
  }
}

export function validateSchema(schema, value, path = "$", errors = []) {
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter(
      (candidate) => validateSchema(candidate, value, path, []).length === 0
    );
    if (matches.length !== 1) {
      errors.push(`${path} must match exactly one allowed schema`);
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
    return errors;
  }

  if (schema.type && !matchesType(schema.type, value)) {
    const typeNames = Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type;
    errors.push(`${path} must be ${typeNames}`);
    return errors;
  }

  if (typeof value === "string" && typeof schema.minLength === "number") {
    const enoughUnits = value.length >= schema.minLength;
    const enough =
      enoughUnits &&
      (value.length >= schema.minLength * 2 || countCodePoints(value, schema.minLength) >= schema.minLength);
    if (!enough) {
      errors.push(`${path} must be at least ${schema.minLength} characters long`);
    }
  }

  if (
    typeof value === "string" &&
    typeof schema.maxLength === "number" &&
    value.length > schema.maxLength &&
    countCodePoints(value, schema.maxLength) > schema.maxLength
  ) {
    errors.push(`${path} must be at most ${schema.maxLength} characters long`);
  }

  if (typeof value === "string" && typeof schema.pattern === "string") {
    const expression = compilePattern(schema.pattern);
    if (expression === null) {
      errors.push(`${path} cannot be validated: ${schema.pattern} is not a valid unicode-mode pattern`);
    } else if (!expression.test(value)) {
      errors.push(`${path} must match ${schema.pattern}`);
    }
  }

  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) {
    errors.push(`${path} must be >= ${schema.minimum}`);
  }

  if (typeof value === "number" && typeof schema.maximum === "number" && value > schema.maximum) {
    errors.push(`${path} must be <= ${schema.maximum}`);
  }

  if (
    typeof value === "number" &&
    typeof schema.exclusiveMinimum === "number" &&
    value <= schema.exclusiveMinimum
  ) {
    errors.push(`${path} must be > ${schema.exclusiveMinimum}`);
  }

  if (
    typeof value === "number" &&
    typeof schema.exclusiveMaximum === "number" &&
    value >= schema.exclusiveMaximum
  ) {
    errors.push(`${path} must be < ${schema.exclusiveMaximum}`);
  }

  if (schema.type === "object" && isPlainObject(value)) {
    validateObjectSchema(schema, value, path, errors);
  }

  if (schema.type === "array" && Array.isArray(value)) {
    validateArraySchema(schema, value, path, errors);
  }

  return errors;
}

export function validateHelloMessage(message) {
  const errors = validateSchema(HELLO_SCHEMA, message);
  return {
    ok: errors.length === 0,
    errors
  };
}

export function validateClientHello(message) {
  const errors = validateSchema(CLIENT_HELLO_SCHEMA, message);
  return { ok: errors.length === 0, errors };
}

export function validatePairingRequest(message) {
  const errors = validateSchema(PAIRING_REQUEST_SCHEMA, message);
  return { ok: errors.length === 0, errors };
}

export function validateDaemonRequest(message) {
  const errors = validateSchema(DAEMON_REQUEST_SCHEMA, message);
  const definition = DAEMON_OPERATION_DEFINITIONS[message?.operation];
  if (definition) {
    validateSchema(definition.paramsSchema, message.params, "$.params", errors);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * @param {Record<string, any>} message
 * @param {{ successRequired?: string[], successFields?: string[] }} [options]
 */
function validateOutcomeEnvelope(message, { successRequired = [], successFields = [] } = {}) {
  const errors = [];
  if (message.ok === true) {
    for (const key of successRequired) {
      if (!Object.hasOwn(message, key)) errors.push(`$.${key} is required when $.ok is true`);
    }
    if (Object.hasOwn(message, "error")) errors.push("$.error is not allowed when $.ok is true");
  } else if (message.ok === false) {
    if (!Object.hasOwn(message, "error")) errors.push("$.error is required when $.ok is false");
    for (const key of successFields) {
      if (Object.hasOwn(message, key)) errors.push(`$.${key} is not allowed when $.ok is false`);
    }
  }
  return errors;
}

export function validateTransportMessage(message) {
  if (!isPlainObject(message) || typeof message.type !== "string") {
    return { ok: false, errors: ["$.type is required"] };
  }
  const schema = TRANSPORT_MESSAGE_SCHEMAS[message.type];
  if (!schema) {
    return {
      ok: false,
      errors: [`$.type must be one of ${Object.keys(TRANSPORT_MESSAGE_SCHEMAS).join(", ")}`]
    };
  }
  const errors = validateSchema(schema, message);
  if (message.type === MESSAGE_TYPES.COMMAND_REQUEST && errors.length === 0) {
    return validateCommandRequest(message);
  }
  if (message.type === MESSAGE_TYPES.DAEMON_REQUEST && errors.length === 0) {
    return validateDaemonRequest(message);
  }
  if (message.type === MESSAGE_TYPES.CLIENT_HELLO_ACK) {
    errors.push(...validateOutcomeEnvelope(message));
  } else if (message.type === MESSAGE_TYPES.PAIRING_RESULT) {
    errors.push(
      ...validateOutcomeEnvelope(message, {
        successRequired: ["pairingId", "credential"],
        successFields: ["pairingId", "credential"]
      })
    );
  } else if (message.type === MESSAGE_TYPES.DAEMON_RESPONSE) {
    errors.push(
      ...validateOutcomeEnvelope(message, {
        successRequired: ["result"],
        successFields: ["result"]
      })
    );
  } else if (message.type === MESSAGE_TYPES.BRIDGE_HELLO_ACK) {
    errors.push(...validateOutcomeEnvelope(message, { successFields: ["limits"] }));
  } else if (message.type === MESSAGE_TYPES.COMMAND_RESPONSE) {
    errors.push(
      ...validateOutcomeEnvelope(message, {
        successRequired: ["result"],
        successFields: ["result"]
      })
    );
  }
  return { ok: errors.length === 0, errors };
}

export function validateCommandRequest(message) {
  const requestErrors = validateSchema(REQUEST_SCHEMA, message);
  if (requestErrors.length > 0) {
    return {
      ok: false,
      errors: requestErrors
    };
  }

  if (!isKnownCommand(message.command)) {
    return {
      ok: false,
      errors: [getInvalidCommandError(message.command).message]
    };
  }

  const definition = getCommandDefinition(message.command);
  const paramsErrors = validateSchema(definition.paramsSchema, message.params, "$.params");

  return {
    ok: paramsErrors.length === 0,
    errors: paramsErrors
  };
}

export function createBridgeHello(options) {
  const { pairingId, credential, clientId, session } = options;
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.BRIDGE_HELLO,
    pairingId,
    credential,
    clientId,
    session
  };
}

export function createClientHello({ credential, client = "cli" }) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.CLIENT_HELLO,
    credential,
    client
  };
}

export function createCommandResponse({ id, result }) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.COMMAND_RESPONSE,
    id,
    ok: true,
    result
  };
}

export function createErrorResponse({ id, error }) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.COMMAND_RESPONSE,
    id,
    ok: false,
    error
  };
}

export function createProtocolError({ code, message, details = {} }) {
  return {
    code,
    message,
    details
  };
}

export function getProtocolVersionError(actualVersion) {
  return createProtocolError({
    code: ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION,
    message: `Unsupported protocol version: ${actualVersion}`,
    details: {
      expectedVersion: PROTOCOL_VERSION,
      actualVersion
    }
  });
}

export function getInvalidMessageError(errors) {
  return createProtocolError({
    code: ERROR_CODES.INVALID_MESSAGE,
    message: "Invalid bridge message",
    details: {
      errors
    }
  });
}

export function getInvalidParamsError(command, errors) {
  return createProtocolError({
    code: ERROR_CODES.INVALID_PARAMS,
    message: `Invalid params for ${command}`,
    details: {
      command,
      errors
    }
  });
}

export function parseBridgeMessage(rawMessage) {
  try {
    return {
      ok: true,
      value: JSON.parse(rawMessage)
    };
  } catch (error) {
    return {
      ok: false,
      error: getInvalidMessageError([error instanceof Error ? error.message : "Unknown JSON parse error"])
    };
  }
}

export { COMMAND_DEFINITIONS };
