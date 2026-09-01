import { getUserById, getUsersCollection } from "./game-collections.js";

/**
 * @param {any} user
 * @returns {string | null}
 */
function userId(user) {
  const id = user?.id ?? null;
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * @typedef {{ requested: string[] | null, active: string[], inactive: string[] }} BroadcastUsers
 */

/**
 * @param {unknown} userIds
 * @returns {BroadcastUsers}
 */
export function resolveBroadcastUsers(userIds) {
  const everyone = Array.from(getUsersCollection());
  if (!Array.isArray(userIds)) {
    return {
      requested: null,
      active: everyone.filter((user) => user.active).flatMap((user) => userId(user) ?? []),
      inactive: everyone.filter((user) => !user.active).flatMap((user) => userId(user) ?? [])
    };
  }

  const requested = [...new Set(userIds.map((id) => String(id)))];
  /** @type {string[]} */
  const active = [];
  /** @type {string[]} */
  const inactive = [];
  for (const id of requested) {
    const user = getUserById(id);
    (user.active ? active : inactive).push(userId(user) ?? id);
  }

  return { requested, active, inactive };
}
