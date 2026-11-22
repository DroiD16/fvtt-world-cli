import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

import { getUsersCollection } from "./game-collections.js";

export function assertKnownOwnershipUsers(users) {
  if (!users) {
    return;
  }
  const collection = getUsersCollection();
  const invalid = Object.keys(users).filter(
    (id) => (users[id] !== null || id === "default") && !collection.get?.(id)
  );
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
 * @param {{ defaultLevel?: number, users?: Record<string, number | null> }} [patch]
 * @returns {{ ownership: Record<string, number>, patch: Record<string, any> }}
 */
export function planOwnershipWrite(target, { defaultLevel, users } = {}) {
  const source = typeof target?.toObject === "function" ? target.toObject() : null;
  /** @type {Record<string, number>} */
  const stored = { ...(source?.ownership ?? target?.ownership ?? {}) };
  const ownership = { ...stored };
  if (defaultLevel !== undefined) {
    ownership.default = defaultLevel;
  }
  let removesStoredEntry = false;
  for (const [id, level] of Object.entries(users ?? {})) {
    if (level === null) {
      removesStoredEntry ||= Object.hasOwn(stored, id);
      delete ownership[id];
    } else {
      ownership[id] = level;
    }
  }

  if (!removesStoredEntry) {
    return { ownership, patch: { ownership } };
  }

  // A merge update cannot delete a user's entry. Foundry's own ownership dialog replaces the whole
  // map instead, and Foundry 14 rejects a deletion operator inside the ownership field.
  const ForcedReplacement = /** @type {any} */ (globalThis).foundry?.data?.operators?.ForcedReplacement;
  return {
    ownership,
    patch:
      typeof ForcedReplacement?.create === "function"
        ? { ownership: ForcedReplacement.create(ownership) }
        : { "==ownership": ownership }
  };
}
