const DESTRUCTIVE_VERBS = Object.freeze(["delete", "delete-many"]);

const DESTRUCTIVE_COMMANDS = Object.freeze(["chat.flush", "file.move", "scene.fog.reset"]);

export const APPROVE_EXTRA_COMMANDS = Object.freeze(["system.reload", "user.create"]);

export const DENIED_BY_DEFAULT_COMMANDS = Object.freeze([
  "macro.execute",
  "setting.set",
  "setting.set-many",
  "user.role.set",
  "user.permissions.set",
  "scene.region.behavior.executable.create",
  "scene.region.behavior.executable.update",
  "scene.region.behavior.executable.clone"
]);

/** @param {string} name */
export function isDestructiveCommand(name) {
  const separator = name.lastIndexOf(".");
  const verb = separator === -1 ? "" : name.slice(separator + 1);
  return DESTRUCTIVE_VERBS.includes(verb) || DESTRUCTIVE_COMMANDS.includes(name);
}

/**
 * @param {string} name
 * @returns {"allow" | "approve" | "deny"}
 */
export function defaultBehaviorFor(name) {
  if (DENIED_BY_DEFAULT_COMMANDS.includes(name)) return "deny";
  if (isDestructiveCommand(name) || APPROVE_EXTRA_COMMANDS.includes(name)) return "approve";
  return "allow";
}
