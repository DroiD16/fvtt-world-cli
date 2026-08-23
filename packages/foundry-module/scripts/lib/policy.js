import {
  APPROVAL_TIMEOUT_DEFAULT_MINUTES,
  APPROVAL_TIMEOUT_MAX_MINUTES,
  APPROVAL_TIMEOUT_MIN_MINUTES,
  COMMAND_NAMES,
  MODULE_ID,
  POLICY_BEHAVIORS,
  POLICY_EXEMPT_COMMANDS,
  defaultProfile
} from "../generated/protocol.js";
import { MODULE_SETTING_KEYS, getGame } from "./validators.js";

/** @typedef {"allow" | "approve" | "deny"} PolicyBehavior */
/** @typedef {{ version: number, overrides: Record<string, PolicyBehavior> }} CommandPolicy */

const POLICY_STORAGE_VERSION = 1;

const KNOWN_COMMANDS = new Set(COMMAND_NAMES);
const KNOWN_BEHAVIORS = new Set(POLICY_BEHAVIORS);
const EXEMPT_COMMANDS = new Set(POLICY_EXEMPT_COMMANDS);

const INTEGER_MINUTES_PATTERN = /^\d+$/;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is PolicyBehavior}
 */
function isPolicyBehavior(value) {
  return typeof value === "string" && KNOWN_BEHAVIORS.has(value);
}

/**
 * @param {unknown} value
 * @returns {CommandPolicy}
 */
export function normalizeStoredPolicy(value) {
  /** @type {Record<string, PolicyBehavior>} */
  const overrides = {};

  if (isRecord(value) && value.version === POLICY_STORAGE_VERSION && isRecord(value.overrides)) {
    for (const [command, behavior] of Object.entries(value.overrides)) {
      if (!KNOWN_COMMANDS.has(command) || !isPolicyBehavior(behavior)) {
        continue;
      }

      if (behavior === defaultProfile(command)) {
        continue;
      }

      overrides[command] = behavior;
    }
  }

  return { version: POLICY_STORAGE_VERSION, overrides };
}

/**
 * @param {unknown} storedPolicy
 * @param {string} command
 * @returns {PolicyBehavior}
 */
function resolveBaseBehavior(storedPolicy, command) {
  if (EXEMPT_COMMANDS.has(command)) {
    return "allow";
  }

  const { overrides } = normalizeStoredPolicy(storedPolicy);
  if (Object.hasOwn(overrides, command)) {
    return overrides[command];
  }

  const profileBehavior = defaultProfile(command);
  return isPolicyBehavior(profileBehavior) ? profileBehavior : "deny";
}

/**
 * @param {unknown} storedPolicy
 * @param {string} command
 * @param {{ dryRun?: boolean }} [options]
 * @returns {{ behavior: PolicyBehavior, baseBehavior: PolicyBehavior }}
 */
export function resolveCommandPolicy(storedPolicy, command, { dryRun = false } = {}) {
  const baseBehavior = resolveBaseBehavior(storedPolicy, command);
  const behavior = baseBehavior === "approve" && dryRun === true ? "allow" : baseBehavior;

  return { behavior, baseBehavior };
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function resolveApprovalTimeoutMinutes(value) {
  const minutes =
    typeof value === "number"
      ? value
      : typeof value === "string" && INTEGER_MINUTES_PATTERN.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;

  if (
    !Number.isInteger(minutes) ||
    minutes < APPROVAL_TIMEOUT_MIN_MINUTES ||
    minutes > APPROVAL_TIMEOUT_MAX_MINUTES
  ) {
    return APPROVAL_TIMEOUT_DEFAULT_MINUTES;
  }

  return minutes;
}

/**
 * @param {unknown} storedPolicy
 * @returns {{ approve: string[], deny: string[] }}
 */
export function buildPolicySnapshot(storedPolicy) {
  const policy = normalizeStoredPolicy(storedPolicy);

  /** @type {string[]} */
  const approve = [];
  /** @type {string[]} */
  const deny = [];

  for (const command of COMMAND_NAMES) {
    if (EXEMPT_COMMANDS.has(command)) {
      continue;
    }

    const { baseBehavior } = resolveCommandPolicy(policy, command);
    if (baseBehavior === "approve") {
      approve.push(command);
    } else if (baseBehavior === "deny") {
      deny.push(command);
    }
  }

  return { approve, deny };
}

/**
 * @param {string} key
 * @returns {unknown}
 */
function readSetting(key) {
  return getGame().settings.get(MODULE_ID, key);
}

/**
 * @returns {CommandPolicy}
 */
export function readStoredCommandPolicy() {
  let stored = null;
  try {
    stored = readSetting(MODULE_SETTING_KEYS.COMMAND_POLICY);
  } catch {
    stored = null;
  }

  return normalizeStoredPolicy(stored);
}

/**
 * @returns {number}
 */
export function readApprovalTimeoutMinutes() {
  let stored = null;
  try {
    stored = readSetting(MODULE_SETTING_KEYS.APPROVAL_TIMEOUT_MINUTES);
  } catch {
    stored = null;
  }

  return resolveApprovalTimeoutMinutes(stored);
}
