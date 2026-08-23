import { afterEach, describe, expect, it } from "vitest";

import {
  APPROVAL_TIMEOUT_DEFAULT_MINUTES,
  APPROVAL_TIMEOUT_MAX_MINUTES,
  APPROVAL_TIMEOUT_MIN_MINUTES,
  COMMAND_NAMES,
  DEFAULT_COMMAND_PROFILE,
  MODULE_ID,
  POLICY_BEHAVIORS,
  POLICY_EXEMPT_COMMANDS,
  isDestructiveCommand
} from "../scripts/generated/protocol.js";
import {
  buildPolicySnapshot,
  normalizeStoredPolicy,
  readApprovalTimeoutMinutes,
  readStoredCommandPolicy,
  resolveApprovalTimeoutMinutes,
  resolveCommandPolicy
} from "../scripts/lib/policy.js";
import { MODULE_SETTING_KEYS } from "../scripts/lib/validators.js";

const EXEMPT = new Set(POLICY_EXEMPT_COMMANDS);

const GOVERNED_COMMANDS = COMMAND_NAMES.filter((command) => !EXEMPT.has(command));

function firstCommandWithProfile(behavior) {
  const command = GOVERNED_COMMANDS.find((name) => DEFAULT_COMMAND_PROFILE[name] === behavior);
  if (!command) {
    throw new Error(`the default profile assigns no governed command the behavior ${behavior}`);
  }

  return command;
}

const APPROVE_BY_DEFAULT = firstCommandWithProfile("approve");
const ALLOW_BY_DEFAULT = firstCommandWithProfile("allow");
const SECOND_ALLOW_BY_DEFAULT = GOVERNED_COMMANDS.filter(
  (name) => DEFAULT_COMMAND_PROFILE[name] === "allow"
)[1];

function storedPolicy(overrides) {
  return { version: 1, overrides };
}

function behaviorOf(policy, command, options) {
  return resolveCommandPolicy(policy, command, options).behavior;
}

afterEach(() => {
  delete globalThis.game;
});

describe("normalizeStoredPolicy", () => {
  it("returns an empty override set for every unusable stored value", () => {
    for (const value of [undefined, null, "", "{}", 0, false, [], [["scene.delete", "deny"]]]) {
      expect(normalizeStoredPolicy(value)).toEqual({ version: 1, overrides: {} });
    }
  });

  it("discards the whole override set when the storage version is not the supported one", () => {
    expect(normalizeStoredPolicy({ version: 2, overrides: { [ALLOW_BY_DEFAULT]: "deny" } })).toEqual({
      version: 1,
      overrides: {}
    });

    expect(normalizeStoredPolicy({ overrides: { [ALLOW_BY_DEFAULT]: "deny" } })).toEqual({
      version: 1,
      overrides: {}
    });
  });

  it("discards overrides that are not a plain object", () => {
    for (const overrides of [undefined, null, "", 7, [[ALLOW_BY_DEFAULT, "deny"]]]) {
      expect(normalizeStoredPolicy(storedPolicy(overrides))).toEqual({ version: 1, overrides: {} });
    }
  });

  it("keeps the valid entries next to an unknown behavior and an unknown command name", () => {
    const policy = normalizeStoredPolicy(
      storedPolicy({
        [ALLOW_BY_DEFAULT]: "deny",
        [SECOND_ALLOW_BY_DEFAULT]: "ask-nicely",
        "scene.explode": "deny",
        "": "deny",
        [APPROVE_BY_DEFAULT]: "allow"
      })
    );

    expect(policy).toEqual({
      version: 1,
      overrides: { [ALLOW_BY_DEFAULT]: "deny", [APPROVE_BY_DEFAULT]: "allow" }
    });
  });

  it("keeps the valid entries next to prototype-polluting keys and leaves the prototype alone", () => {
    const stored = JSON.parse(
      `{"version":1,"overrides":{"__proto__":"deny","constructor":"deny","prototype":"deny",${JSON.stringify(
        ALLOW_BY_DEFAULT
      )}:"approve"}}`
    );
    expect(Object.hasOwn(stored.overrides, "__proto__")).toBe(true);

    const policy = normalizeStoredPolicy(stored);

    expect(policy.overrides).toEqual({ [ALLOW_BY_DEFAULT]: "approve" });
    expect(Object.getPrototypeOf(policy.overrides)).toBe(Object.prototype);
    expect(Object.hasOwn(policy.overrides, "__proto__")).toBe(false);
    expect(Object.hasOwn(policy.overrides, "constructor")).toBe(false);
    expect(behaviorOf(policy, "__proto__")).toBe("deny");
    expect(behaviorOf(policy, "constructor")).toBe("deny");
  });

  it("drops entries that merely restate the default profile value", () => {
    const policy = normalizeStoredPolicy(
      storedPolicy({
        [ALLOW_BY_DEFAULT]: "allow",
        [APPROVE_BY_DEFAULT]: "approve",
        [SECOND_ALLOW_BY_DEFAULT]: "deny"
      })
    );

    expect(policy.overrides).toEqual({ [SECOND_ALLOW_BY_DEFAULT]: "deny" });
    expect(behaviorOf(policy, ALLOW_BY_DEFAULT)).toBe("allow");
    expect(behaviorOf(policy, APPROVE_BY_DEFAULT)).toBe("approve");
  });

  it("drops an override stored for an exempt command, which could never take effect", () => {
    for (const command of POLICY_EXEMPT_COMMANDS) {
      for (const behavior of ["deny", "approve", "allow"]) {
        const policy = normalizeStoredPolicy(
          storedPolicy({ [command]: behavior, [ALLOW_BY_DEFAULT]: "deny" })
        );

        expect(policy.overrides, `${command}=${behavior}`).toEqual({ [ALLOW_BY_DEFAULT]: "deny" });
      }
    }
  });

  it("leaves its input untouched", () => {
    const stored = storedPolicy({ [ALLOW_BY_DEFAULT]: "deny", [APPROVE_BY_DEFAULT]: "approve" });
    const before = structuredClone(stored);

    normalizeStoredPolicy(stored);

    expect(stored).toEqual(before);
  });

  it("is idempotent, so a caller may pass an already normalized policy back in", () => {
    const once = normalizeStoredPolicy(storedPolicy({ [ALLOW_BY_DEFAULT]: "deny" }));

    expect(normalizeStoredPolicy(once)).toEqual(once);
  });
});

describe("resolveCommandPolicy", () => {
  it("falls back to the default profile for a missing, empty or corrupt setting", () => {
    for (const value of [undefined, null, "", { version: 9 }, { overrides: "nope" }]) {
      expect(behaviorOf(value, APPROVE_BY_DEFAULT)).toBe("approve");
      expect(behaviorOf(value, ALLOW_BY_DEFAULT)).toBe("allow");
    }
  });

  it("resolves every registered command to its profile behavior with no overrides stored", () => {
    for (const command of COMMAND_NAMES) {
      const { behavior, baseBehavior } = resolveCommandPolicy(null, command);
      expect(POLICY_BEHAVIORS, command).toContain(behavior);

      if (EXEMPT.has(command)) {
        expect(baseBehavior, command).toBe("allow");
        continue;
      }

      expect(Object.hasOwn(DEFAULT_COMMAND_PROFILE, command), command).toBe(true);
      expect(baseBehavior, command).toBe(DEFAULT_COMMAND_PROFILE[command]);
    }
  });

  it("applies a stored override over the default profile value", () => {
    expect(behaviorOf(storedPolicy({ [ALLOW_BY_DEFAULT]: "deny" }), ALLOW_BY_DEFAULT)).toBe("deny");
    expect(behaviorOf(storedPolicy({ [ALLOW_BY_DEFAULT]: "approve" }), ALLOW_BY_DEFAULT)).toBe("approve");
    expect(behaviorOf(storedPolicy({ [APPROVE_BY_DEFAULT]: "allow" }), APPROVE_BY_DEFAULT)).toBe("allow");
  });

  it("ignores an explicit deny on an exempt command", () => {
    for (const command of POLICY_EXEMPT_COMMANDS) {
      const { behavior, baseBehavior } = resolveCommandPolicy(storedPolicy({ [command]: "deny" }), command);
      expect(behavior, command).toBe("allow");
      expect(baseBehavior, command).toBe("allow");
    }
  });

  it("denies a command the default profile does not know", () => {
    const { behavior, baseBehavior } = resolveCommandPolicy(null, "scene.explode");

    expect(behavior).toBe("deny");
    expect(baseBehavior).toBe("deny");
  });

  it("lets a dry run bypass approve while still reporting the approve baseline", () => {
    const resolved = resolveCommandPolicy(null, APPROVE_BY_DEFAULT, { dryRun: true });

    expect(resolved).toEqual({ behavior: "allow", baseBehavior: "approve" });
  });

  it("keeps deny in force for a dry run and leaves allow alone", () => {
    const policy = storedPolicy({ [ALLOW_BY_DEFAULT]: "deny" });

    expect(resolveCommandPolicy(policy, ALLOW_BY_DEFAULT, { dryRun: true })).toEqual({
      behavior: "deny",
      baseBehavior: "deny"
    });
    expect(resolveCommandPolicy(null, ALLOW_BY_DEFAULT, { dryRun: true })).toEqual({
      behavior: "allow",
      baseBehavior: "allow"
    });
  });

  it("treats a non-boolean dry-run flag as a real call", () => {
    expect(behaviorOf(null, APPROVE_BY_DEFAULT, { dryRun: /** @type {any} */ ("yes") })).toBe("approve");
  });
});

describe("resolveApprovalTimeoutMinutes", () => {
  it("accepts an integer inside the supported range", () => {
    expect(resolveApprovalTimeoutMinutes(APPROVAL_TIMEOUT_MIN_MINUTES)).toBe(APPROVAL_TIMEOUT_MIN_MINUTES);
    expect(resolveApprovalTimeoutMinutes(APPROVAL_TIMEOUT_MAX_MINUTES)).toBe(APPROVAL_TIMEOUT_MAX_MINUTES);
    expect(resolveApprovalTimeoutMinutes(15)).toBe(15);
  });

  it("accepts a plain decimal integer written as a string", () => {
    expect(resolveApprovalTimeoutMinutes("30")).toBe(30);
    expect(resolveApprovalTimeoutMinutes(" 30 ")).toBe(30);
  });

  it("falls back to the default for anything else", () => {
    for (const value of [
      undefined,
      null,
      true,
      false,
      {},
      [],
      0,
      -1,
      APPROVAL_TIMEOUT_MAX_MINUTES + 1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "",
      "abc",
      "1.5",
      "-1",
      "0x1e",
      "1e3"
    ]) {
      expect(resolveApprovalTimeoutMinutes(value), String(value)).toBe(APPROVAL_TIMEOUT_DEFAULT_MINUTES);
    }
  });
});

describe("buildPolicySnapshot", () => {
  const DESTRUCTIVE_COMMANDS = GOVERNED_COMMANDS.filter((command) => isDestructiveCommand(command));

  it("lists the destructive commands as approve and nothing as deny for an empty policy", () => {
    expect(buildPolicySnapshot(null)).toEqual({ approve: DESTRUCTIVE_COMMANDS, deny: [] });
  });

  it("reflects overrides in both lists and keeps registry order", () => {
    const snapshot = buildPolicySnapshot(
      storedPolicy({
        [ALLOW_BY_DEFAULT]: "approve",
        [SECOND_ALLOW_BY_DEFAULT]: "deny",
        [DESTRUCTIVE_COMMANDS[0]]: "allow"
      })
    );

    const expectedApprove = GOVERNED_COMMANDS.filter(
      (command) =>
        command === ALLOW_BY_DEFAULT || (isDestructiveCommand(command) && command !== DESTRUCTIVE_COMMANDS[0])
    );

    expect(snapshot.approve).toEqual(expectedApprove);
    expect(snapshot.deny).toEqual([SECOND_ALLOW_BY_DEFAULT]);
  });

  it("never lists an exempt command, even with an explicit override stored for it", () => {
    const overrides = {};
    for (const command of POLICY_EXEMPT_COMMANDS) {
      overrides[command] = "deny";
    }

    const snapshot = buildPolicySnapshot(storedPolicy(overrides));

    for (const command of POLICY_EXEMPT_COMMANDS) {
      expect(snapshot.approve, command).not.toContain(command);
      expect(snapshot.deny, command).not.toContain(command);
    }
  });
});

describe("reading the policy settings out of Foundry", () => {
  it("returns the stored overrides once the setting holds a policy", () => {
    const values = {
      [MODULE_SETTING_KEYS.COMMAND_POLICY]: storedPolicy({ [ALLOW_BY_DEFAULT]: "deny" }),
      [MODULE_SETTING_KEYS.APPROVAL_TIMEOUT_MINUTES]: 5
    };
    globalThis.game = /** @type {any} */ ({
      settings: {
        get: (namespace, key) => (namespace === MODULE_ID ? values[key] : undefined)
      }
    });

    expect(readStoredCommandPolicy().overrides).toEqual({ [ALLOW_BY_DEFAULT]: "deny" });
    expect(readApprovalTimeoutMinutes()).toBe(5);
  });

  it("degrades to the default profile and timeout when the setting is not registered yet", () => {
    globalThis.game = /** @type {any} */ ({
      settings: {
        get: (namespace, key) => {
          throw new Error(`"${namespace}.${key}" is not a registered game setting`);
        }
      }
    });

    expect(readStoredCommandPolicy()).toEqual({ version: 1, overrides: {} });
    expect(behaviorOf(readStoredCommandPolicy(), APPROVE_BY_DEFAULT)).toBe("approve");
    expect(readApprovalTimeoutMinutes()).toBe(APPROVAL_TIMEOUT_DEFAULT_MINUTES);
  });

  it("degrades to the default profile and timeout with no game object at all", () => {
    expect(readStoredCommandPolicy()).toEqual({ version: 1, overrides: {} });
    expect(readApprovalTimeoutMinutes()).toBe(APPROVAL_TIMEOUT_DEFAULT_MINUTES);
  });

  it("degrades to the default timeout when the stored timeout is corrupt", () => {
    globalThis.game = /** @type {any} */ ({
      settings: {
        get: () => "not a number"
      }
    });

    expect(readApprovalTimeoutMinutes()).toBe(APPROVAL_TIMEOUT_DEFAULT_MINUTES);
    expect(readStoredCommandPolicy()).toEqual({ version: 1, overrides: {} });
  });
});
