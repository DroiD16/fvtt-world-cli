import {
  COMMAND_NAMES,
  POLICY_BEHAVIORS,
  POLICY_EXEMPT_COMMANDS,
  defaultProfile,
  isDestructiveCommand
} from "../generated/protocol.js";
import { normalizeStoredPolicy, resolveNormalizedBehavior } from "./policy.js";

const EXEMPT_COMMANDS = new Set(POLICY_EXEMPT_COMMANDS);

/** @typedef {import("./policy.js").CommandPolicy} CommandPolicy */
/** @typedef {import("./policy.js").PolicyBehavior} PolicyBehavior */
/** @typedef {Record<PolicyBehavior, number>} BehaviorCounts */

/**
 * @typedef {{
 *   name: string,
 *   verb: string,
 *   behavior: PolicyBehavior,
 *   exempt: boolean,
 *   destructive: boolean,
 *   changed: boolean,
 *   pressed: Record<string, boolean>,
 *   hidden: boolean,
 *   band: boolean
 * }} PolicyRow
 */

/**
 * @typedef {{
 *   segment: string,
 *   path: string,
 *   depth: number,
 *   commands: PolicyRow[],
 *   nodes: PolicyNode[],
 *   counts: BehaviorCounts,
 *   changed: number,
 *   commandCount: number,
 *   pressed: Record<string, boolean>,
 *   exempt: boolean,
 *   hidden: boolean,
 *   open: boolean
 * }} PolicyNode
 */

const PROFILE_APPROVE_COUNT = COMMAND_NAMES.filter((command) => defaultProfile(command) === "approve").length;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeFilterTerm(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * @param {string} command
 * @param {string} term
 * @returns {boolean}
 */
function matchesFilterTerm(command, term) {
  return term === "" || command.toLowerCase().includes(term);
}

/**
 * @param {unknown} filter
 * @returns {string[]}
 */
export function listFilteredCommands(filter) {
  const term = normalizeFilterTerm(filter);
  return COMMAND_NAMES.filter((command) => matchesFilterTerm(command, term));
}

/**
 * @param {string} path
 * @returns {string[]}
 */
export function listSubtreeCommands(path) {
  const prefix = `${path}.`;
  return COMMAND_NAMES.filter((command) => command.startsWith(prefix));
}

/**
 * @param {CommandPolicy} policy
 * @param {readonly string[]} commands
 * @param {unknown} behavior
 * @returns {CommandPolicy}
 */
export function writeBehaviors(policy, commands, behavior) {
  if (typeof behavior !== "string" || !POLICY_BEHAVIORS.includes(behavior)) {
    return policy;
  }

  const overrides = { ...policy.overrides };
  for (const command of commands) {
    overrides[command] = /** @type {PolicyBehavior} */ (behavior);
  }

  return normalizeStoredPolicy({ ...policy, overrides });
}

/**
 * @param {CommandPolicy} policy
 * @returns {CommandPolicy}
 */
export function clearOverrides(policy) {
  return normalizeStoredPolicy({ ...policy, overrides: {} });
}

/**
 * @param {string} segment
 * @param {string} path
 */
function createBranch(segment, path) {
  return {
    segment,
    path,
    children: /** @type {Map<string, ReturnType<typeof createBranch>>} */ (new Map()),
    commands: /** @type {PolicyRow[]} */ ([])
  };
}

/** @returns {BehaviorCounts} */
function emptyCounts() {
  return { allow: 0, approve: 0, deny: 0 };
}

/**
 * @param {ReturnType<typeof createBranch>} branch
 * @param {number} depth
 * @returns {PolicyNode}
 */
function finalizeBranch(branch, depth) {
  const nodes = [...branch.children.values()].map((child) => finalizeBranch(child, depth + 1));
  const counts = emptyCounts();
  let changed = 0;

  for (const command of branch.commands) {
    counts[command.behavior] += 1;
    if (command.changed) changed += 1;
  }

  for (const node of nodes) {
    for (const behavior of POLICY_BEHAVIORS) counts[behavior] += node.counts[behavior];
    changed += node.changed;
  }

  const commandCount = branch.commands.length + nodes.reduce((total, node) => total + node.commandCount, 0);
  const exempt = branch.commands.every((command) => command.exempt) && nodes.every((node) => node.exempt);
  const visible = branch.commands.some((command) => !command.hidden) || nodes.some((node) => !node.hidden);

  let band = 0;
  for (const command of branch.commands) {
    if (command.hidden) continue;
    command.band = band % 2 === 1;
    band += 1;
  }

  return {
    segment: branch.segment,
    path: branch.path,
    depth,
    commands: branch.commands,
    nodes,
    counts,
    changed,
    commandCount,
    pressed: Object.fromEntries(
      POLICY_BEHAVIORS.map((behavior) => [behavior, counts[behavior] === commandCount])
    ),
    exempt,
    hidden: !visible,
    open: false
  };
}

/**
 * @param {PolicyNode[]} nodes
 * @param {boolean} filtered
 */
function openMatchingNodes(nodes, filtered) {
  for (const node of nodes) {
    node.open = filtered && !node.hidden;
    openMatchingNodes(node.nodes, filtered);
  }
}

// A command name is a path: every segment before the verb is a level, so a tree built from any other
// split would place `scene.token.item.effect.delete` somewhere other than four levels down.
/**
 * @param {unknown} storedPolicy
 * @param {{ filter?: unknown }} [options]
 */
export function buildPolicyView(storedPolicy, { filter = "" } = {}) {
  const policy = normalizeStoredPolicy(storedPolicy);
  const term = normalizeFilterTerm(filter);
  const root = createBranch("", "");
  let visibleCount = 0;

  for (const command of COMMAND_NAMES) {
    const segments = command.split(".");
    const verb = segments.pop() ?? command;
    let branch = root;
    let path = "";

    for (const segment of segments) {
      path = path ? `${path}.${segment}` : segment;
      if (!branch.children.has(segment)) branch.children.set(segment, createBranch(segment, path));
      branch = /** @type {ReturnType<typeof createBranch>} */ (branch.children.get(segment));
    }

    const baseBehavior = resolveNormalizedBehavior(policy, command);
    const hidden = !matchesFilterTerm(command, term);
    if (!hidden) visibleCount += 1;

    branch.commands.push({
      name: command,
      verb,
      behavior: baseBehavior,
      exempt: EXEMPT_COMMANDS.has(command),
      destructive: isDestructiveCommand(command),
      changed: Object.hasOwn(policy.overrides, command),
      pressed: Object.fromEntries(POLICY_BEHAVIORS.map((value) => [value, value === baseBehavior])),
      hidden,
      band: false
    });
  }

  const nodes = [...root.children.values()].map((branch) => finalizeBranch(branch, 0));
  openMatchingNodes(nodes, term !== "");

  return {
    nodes,
    filter: term,
    filtered: term !== "",
    commandCount: COMMAND_NAMES.length,
    groupCount: nodes.length,
    profileApproveCount: PROFILE_APPROVE_COUNT,
    visibleCount
  };
}
