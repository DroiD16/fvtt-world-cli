export const POLICY_BEHAVIORS = Object.freeze(["allow", "approve", "deny"]);

export const POLICY_EXEMPT_COMMANDS = Object.freeze([
  "system.ping",
  "system.info",
  "approval.await",
  "approval.cancel",
  "policy.snapshot"
]);

const DESTRUCTIVE_VERBS = Object.freeze(["delete", "delete-many"]);

const DESTRUCTIVE_COMMANDS = Object.freeze(["file.delete", "file.move", "scene.fog.reset"]);

/** @param {string} name */
export function isDestructiveCommand(name) {
  const separator = name.lastIndexOf(".");
  const verb = separator === -1 ? "" : name.slice(separator + 1);
  return DESTRUCTIVE_VERBS.includes(verb) || DESTRUCTIVE_COMMANDS.includes(name);
}
