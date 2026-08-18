import { InvalidArgumentError } from "commander";
import { z } from "zod";

const JsonObjectSchema = z.record(z.string(), z.unknown());

const JsonObjectArraySchema = z.array(JsonObjectSchema);

const DECIMAL_NUMBER_PATTERN = /^-?(\d+(\.\d+)?|\.\d+|\d+\.)$/;

export function parseNumber(value: string) {
  if (!DECIMAL_NUMBER_PATTERN.test(value)) {
    throw new InvalidArgumentError(`Expected a decimal number, received ${value}`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new InvalidArgumentError(`Expected a finite number, received ${value}`);
  }

  return parsed;
}

const POSITIVE_INT_PATTERN = /^\d+$/;

export function parsePositiveInt(value: string) {
  if (!POSITIVE_INT_PATTERN.test(value)) {
    throw new InvalidArgumentError(`Expected a positive integer, received ${value}`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`Expected a positive integer, received ${value}`);
  }

  return parsed;
}

export function parseNonNegativeInt(value: string) {
  if (!POSITIVE_INT_PATTERN.test(value)) {
    throw new InvalidArgumentError(`Expected a non-negative integer, received ${value}`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError(`Expected a non-negative integer, received ${value}`);
  }

  return parsed;
}

export function parseBoolean(value: string) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new InvalidArgumentError(`Expected true or false, received ${value}`);
}

export function parseJsonObject(value: string, label: string) {
  try {
    return JsonObjectSchema.parse(JSON.parse(value));
  } catch (error) {
    throw new InvalidArgumentError(
      error instanceof Error
        ? `${label} must be valid JSON for an object: ${error.message}`
        : `${label} must be valid JSON for an object`
    );
  }
}

export function parseJsonObjectArray(value: string, label: string) {
  try {
    return JsonObjectArraySchema.parse(JSON.parse(value));
  } catch (error) {
    throw new InvalidArgumentError(
      error instanceof Error
        ? `${label} must be valid JSON for an array of objects: ${error.message}`
        : `${label} must be valid JSON for an array of objects`
    );
  }
}

const RANGE_INTEGER_PATTERN = /^-?\d+$/;

export function parseResultRange(value: string) {
  const parts = value.split(",").map((entry) => entry.trim());
  if (parts.length !== 2) {
    throw new InvalidArgumentError(
      `--range must be exactly two comma-separated integers "low,high" (a single-value row uses the same number twice, e.g. 3,3), received ${value}`
    );
  }
  return parts.map((part) => {
    if (!RANGE_INTEGER_PATTERN.test(part)) {
      throw new InvalidArgumentError(`--range entries must be integers, received ${part}`);
    }
    return Number(part);
  });
}

export function parseCsvList(value: string, label: string) {
  const items = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (items.length === 0) {
    throw new InvalidArgumentError(`${label} must contain at least one non-empty id`);
  }
  return items;
}

const INCLUDE_ALLOWED = ["flags", "effects"] as const;

export function parseIncludeFields(value: string) {
  const fields = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (fields.length === 0) {
    throw new InvalidArgumentError(
      `--include must name at least one field (allowed: ${INCLUDE_ALLOWED.join(", ")})`
    );
  }
  for (const field of fields) {
    if (!INCLUDE_ALLOWED.includes(field as (typeof INCLUDE_ALLOWED)[number])) {
      throw new InvalidArgumentError(
        `--include only supports ${INCLUDE_ALLOWED.join(", ")}, received ${field}`
      );
    }
  }
  return fields;
}

const OWNERSHIP_LEVELS = [-1, 0, 1, 2, 3];

const INTEGER_PATTERN = /^-?\d+$/;

export function parseOwnershipLevel(value: string) {
  const trimmed = value.trim();
  const parsed = INTEGER_PATTERN.test(trimmed) ? Number(trimmed) : NaN;
  if (!Number.isInteger(parsed) || !OWNERSHIP_LEVELS.includes(parsed)) {
    throw new InvalidArgumentError(
      `Expected an ownership level (0=none, 1=limited, 2=observer, 3=owner; -1=inherit for journal pages only), received ${value}`
    );
  }
  return parsed;
}

export function parseOwnershipUsers(value: string) {
  const object = parseJsonObject(value, "--users-json");
  const ids = Object.keys(object);
  if (ids.length === 0) {
    throw new InvalidArgumentError("--users-json must name at least one user id");
  }
  for (const id of ids) {
    const level = (object as Record<string, unknown>)[id];
    if (typeof level !== "number" || !Number.isInteger(level) || !OWNERSHIP_LEVELS.includes(level)) {
      throw new InvalidArgumentError(
        `--users-json values must be ownership levels (0..3, or -1 for journal pages); user ${id} = ${JSON.stringify(level)}`
      );
    }
  }
  return object;
}

export function parseIdList(value: string) {
  const ids = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (ids.length === 0) {
    throw new InvalidArgumentError("--ids must name at least one id (comma-separated)");
  }
  return ids;
}

export function parseScopeList(value: string) {
  const scopes = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (scopes.length === 0) {
    throw new InvalidArgumentError("--scope must name at least one group (comma-separated)");
  }
  return scopes;
}

export function parseSearchTypeList(value: string) {
  const types = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (types.length === 0) {
    throw new InvalidArgumentError("--types must name at least one document type (comma-separated)");
  }
  return types;
}

export function parseWhisperIds(value: string) {
  const ids = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (ids.length === 0) {
    throw new InvalidArgumentError("--whisper must name at least one user id (comma-separated)");
  }
  return ids;
}

const ACTOR_INCLUDE_ALLOWED = ["flags", "effects", "items.flags", "items.effects", "prepared"] as const;

export function parseActorIncludeFields(value: string) {
  const fields = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (fields.length === 0) {
    throw new InvalidArgumentError(
      `--include must name at least one field (allowed: ${ACTOR_INCLUDE_ALLOWED.join(", ")})`
    );
  }
  for (const field of fields) {
    if (!ACTOR_INCLUDE_ALLOWED.includes(field as (typeof ACTOR_INCLUDE_ALLOWED)[number])) {
      throw new InvalidArgumentError(
        `--include only supports ${ACTOR_INCLUDE_ALLOWED.join(", ")}, received ${field}`
      );
    }
  }
  return fields;
}

const TOKEN_INCLUDE_ALLOWED = ["prepared"] as const;

export function parseTokenIncludeFields(value: string) {
  const fields = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (fields.length === 0) {
    throw new InvalidArgumentError(
      `--include must name at least one field (allowed: ${TOKEN_INCLUDE_ALLOWED.join(", ")})`
    );
  }
  for (const field of fields) {
    if (!TOKEN_INCLUDE_ALLOWED.includes(field as (typeof TOKEN_INCLUDE_ALLOWED)[number])) {
      throw new InvalidArgumentError(
        `--include only supports ${TOKEN_INCLUDE_ALLOWED.join(", ")}, received ${field}`
      );
    }
  }
  return fields;
}

const COMPENDIUM_INCLUDE_ALLOWED = ["effects"] as const;

export function parseCompendiumIncludeFields(value: string) {
  const fields = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (fields.length === 0) {
    throw new InvalidArgumentError(
      `--include must name at least one field (allowed: ${COMPENDIUM_INCLUDE_ALLOWED.join(", ")})`
    );
  }
  for (const field of fields) {
    if (!COMPENDIUM_INCLUDE_ALLOWED.includes(field as (typeof COMPENDIUM_INCLUDE_ALLOWED)[number])) {
      throw new InvalidArgumentError(
        `--include only supports ${COMPENDIUM_INCLUDE_ALLOWED.join(", ")}, received ${field}`
      );
    }
  }
  return fields;
}

export function parseCompendiumFieldsList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
