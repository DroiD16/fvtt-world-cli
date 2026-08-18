import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

import { getUsersCollection } from "./game-collections.js";

export function assertKnownOwnershipUsers(users) {
  if (!users) {
    return;
  }
  const collection = getUsersCollection();
  const invalid = Object.keys(users).filter((id) => !collection.get?.(id));
  if (invalid.length === 0) {
    return;
  }
  const all = Array.from(collection);
  const valid = all.map((user) => `${user.id} (${user.name})`);
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `Unknown user id(s) in ownership patch: ${invalid.join(", ")}; valid user ids: ${
      valid.join(", ") || "(none)"
    } — use user.list to find valid ids`,
    { invalidUserIds: invalid, validUserIds: all.map((user) => user.id) }
  );
}

/**
 * @param {any} target
 * @param {{ defaultLevel?: number, users?: Record<string, number> }} [patch]
 */
export function mergeOwnershipPatch(target, { defaultLevel, users } = {}) {
  const source = typeof target?.toObject === "function" ? target.toObject() : null;
  const current = source?.ownership ?? target?.ownership ?? {};
  const merged = { ...current };
  if (defaultLevel !== undefined) {
    merged.default = defaultLevel;
  }
  if (users) {
    for (const [id, level] of Object.entries(users)) {
      merged[id] = level;
    }
  }
  return merged;
}
