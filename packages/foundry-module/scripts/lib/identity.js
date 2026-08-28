export function isGameMasterUser() {
  const game = /** @type {any} */ (globalThis).game;
  const user = game?.user;
  if (user) return Boolean(user.isGM);

  const userId = game?.data?.userId;
  const users = game?.data?.users;
  if (!userId || !Array.isArray(users)) return false;

  const self = users.find((entry) => (entry?._id ?? entry?.id) === userId);
  const assistantRole = /** @type {any} */ (globalThis).CONST?.USER_ROLES?.ASSISTANT;
  return typeof self?.role === "number" && typeof assistantRole === "number" && self.role >= assistantRole;
}
