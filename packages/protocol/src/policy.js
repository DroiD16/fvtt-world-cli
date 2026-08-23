import { DEFAULT_COMMAND_PROFILE } from "./generated/default-command-profile.js";

export { isDestructiveCommand } from "./destructive-commands.js";
export { DEFAULT_COMMAND_PROFILE } from "./generated/default-command-profile.js";

export const POLICY_BEHAVIORS = Object.freeze(["allow", "approve", "deny"]);

export const POLICY_EXEMPT_COMMANDS = Object.freeze([
  "system.ping",
  "system.info",
  "approval.await",
  "approval.cancel",
  "policy.snapshot"
]);

/** @param {string} name */
export function defaultProfile(name) {
  return Object.hasOwn(DEFAULT_COMMAND_PROFILE, name) ? DEFAULT_COMMAND_PROFILE[name] : undefined;
}
