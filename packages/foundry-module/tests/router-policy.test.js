import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";
import {
  COMMAND_NAMES,
  DEFAULT_COMMAND_PROFILE,
  ERROR_CODES,
  MODULE_ID,
  POLICY_EXEMPT_COMMANDS
} from "../scripts/generated/protocol.js";
import { MODULE_SETTING_KEYS } from "../scripts/lib/validators.js";

import { createRequest, installFakeFoundry } from "./helpers/fake-foundry.js";

const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HANDLERS_DIR = join(MODULE_ROOT, "scripts", "handlers");

const EXEMPT = new Set(POLICY_EXEMPT_COMMANDS);
const GOVERNED_COMMANDS = COMMAND_NAMES.filter((command) => !EXEMPT.has(command));
const APPROVE_BY_PROFILE = GOVERNED_COMMANDS.filter(
  (command) => DEFAULT_COMMAND_PROFILE[command] === "approve"
);

const APPROVAL_ID = "aaaaaaaaaaaaaaaaaaaaaa";
const EXEMPT_PARAMS = {
  "system.ping": {},
  "system.info": {},
  "policy.snapshot": {},
  "approval.await": { approvalId: APPROVAL_ID },
  "approval.cancel": { approvalId: APPROVAL_ID }
};

function router() {
  return createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
}

async function storePolicy(overrides) {
  await globalThis.game.settings.set(MODULE_ID, MODULE_SETTING_KEYS.COMMAND_POLICY, {
    version: 1,
    overrides
  });
}

async function storeRawPolicy(value) {
  await globalThis.game.settings.set(MODULE_ID, MODULE_SETTING_KEYS.COMMAND_POLICY, value);
}

async function createDeletableActor() {
  await router().route(createRequest("actor.create", { data: { name: "Rat", type: "npc" } }));
  return "actor-created";
}

function actorName(id) {
  return globalThis.game.actors.get(id)?.name;
}

describe("command policy gate", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  describe("with no stored policy", () => {
    it("dispatches a read the default profile allows", async () => {
      const response = await router().route(createRequest("actor.get", { actorId: "actor-1" }));

      expect(response.ok).toBe(true);
      expect(response.result.actor.id).toBe("actor-1");
    });

    it("dispatches an approve-listed command until the approval store governs it", async () => {
      const actorId = await createDeletableActor();

      const response = await router().route(createRequest("actor.delete", { actorId }));

      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({ id: actorId, deleted: true });
      expect(globalThis.game.actors.get(actorId).deleted).toBe(true);
    });

    it("resolves the destructive commands the default profile marks approve", async () => {
      const response = await router().route(createRequest("policy.snapshot"));

      expect(response.ok).toBe(true);
      expect(response.result).toEqual({ approve: APPROVE_BY_PROFILE, deny: [] });
      expect(response.result.approve).toContain("actor.delete");
    });
  });

  describe("a denied command", () => {
    it("refuses a read and returns no result", async () => {
      await storePolicy({ "actor.get": "deny" });

      const response = await router().route(createRequest("actor.get", { actorId: "actor-1" }));

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMMAND_DENIED);
      expect(response.error.details).toEqual({ command: "actor.get" });
      expect(response.error.message).toContain("command policy");
      expect(response.result).toBeUndefined();
    });

    it("refuses a write and leaves the document as it was", async () => {
      await storePolicy({ "actor.update": "deny" });
      const before = actorName("actor-1");

      const response = await router().route(
        createRequest("actor.update", { actorId: "actor-1", patch: { name: "Denied Rename" } })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMMAND_DENIED);
      expect(actorName("actor-1")).toBe(before);
    });

    it("refuses a bulk envelope and leaves every element as it was", async () => {
      await storePolicy({ "actor.update-many": "deny" });
      const before = actorName("actor-1");

      const response = await router().route(
        createRequest("actor.update-many", {
          patches: [{ id: "actor-1", patch: { name: "Denied Bulk Rename" } }]
        })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMMAND_DENIED);
      expect(response.error.details).toEqual({ command: "actor.update-many" });
      expect(actorName("actor-1")).toBe(before);
    });

    it("refuses the preview of a write and of a bulk envelope alike", async () => {
      await storePolicy({ "actor.update": "deny", "actor.update-many": "deny" });
      const before = actorName("actor-1");

      const write = await router().route(
        createRequest("actor.update", {
          actorId: "actor-1",
          patch: { name: "Denied Preview" },
          dryRun: true
        })
      );
      const bulk = await router().route(
        createRequest("actor.update-many", {
          patches: [{ id: "actor-1", patch: { name: "Denied Bulk Preview" } }],
          dryRun: true
        })
      );

      expect(write.error.code).toBe(ERROR_CODES.COMMAND_DENIED);
      expect(bulk.error.code).toBe(ERROR_CODES.COMMAND_DENIED);
      expect(write.result).toBeUndefined();
      expect(bulk.result).toBeUndefined();
      expect(actorName("actor-1")).toBe(before);
    });

    it("is refused after the write-permission guard, which answers a non-GM session first", async () => {
      await storePolicy({ "actor.update": "deny" });
      globalThis.game.user.isGM = false;

      const response = await router().route(
        createRequest("actor.update", { actorId: "actor-1", patch: { name: "Denied Rename" } })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
      expect(response.error.details).toEqual({ command: "actor.update" });
    });
  });

  describe("a dry run", () => {
    it("runs the preview of an approve-listed command and marks it as needing approval", async () => {
      const actorId = await createDeletableActor();

      const response = await router().route(createRequest("actor.delete", { actorId, dryRun: true }));

      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({ id: actorId, deleted: false, dryRun: true });
      expect(response.result.approvalRequired).toBe(true);
      expect(globalThis.game.actors.get(actorId).deleted).toBeUndefined();
    });

    it("marks a bulk preview of an approve-listed command the same way", async () => {
      const response = await router().route(
        createRequest("scene.token.delete-many", {
          sceneId: "scene-1",
          ids: ["token-a"],
          dryRun: true
        })
      );

      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result.approvalRequired).toBe(true);
      expect(globalThis.game.scenes.get("scene-1").tokens.get("token-a")).toBeTruthy();
    });

    it("leaves an allow-listed preview unmarked", async () => {
      const response = await router().route(
        createRequest("actor.update", { actorId: "actor-1", patch: { name: "Preview" }, dryRun: true })
      );

      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result).not.toHaveProperty("approvalRequired");
    });

    it("marks a preview an override sends to approve and unmarks one an override allows", async () => {
      await storePolicy({ "actor.update": "approve", "actor.delete": "allow" });
      const actorId = await createDeletableActor();

      const raised = await router().route(
        createRequest("actor.update", { actorId: "actor-1", patch: { name: "Preview" }, dryRun: true })
      );
      const lowered = await router().route(createRequest("actor.delete", { actorId, dryRun: true }));

      expect(raised.result.approvalRequired).toBe(true);
      expect(lowered.result).not.toHaveProperty("approvalRequired");
    });

    it("leaves a real call of an approve-listed command unmarked", async () => {
      const actorId = await createDeletableActor();

      const response = await router().route(createRequest("actor.delete", { actorId }));

      expect(response.ok).toBe(true);
      expect(response.result).not.toHaveProperty("approvalRequired");
    });

    it("carries no marker on a denied invocation", async () => {
      await storePolicy({ "actor.delete": "deny" });
      const actorId = await createDeletableActor();

      const response = await router().route(createRequest("actor.delete", { actorId, dryRun: true }));

      expect(response.ok).toBe(false);
      expect(response.error.details).toEqual({ command: "actor.delete" });
      expect(response.error.details).not.toHaveProperty("approvalRequired");
    });

    it("is answered by handlers that never claim to need approval themselves", () => {
      const producers = readdirSync(HANDLERS_DIR)
        .filter((entry) => entry.endsWith(".js"))
        .filter((entry) => readFileSync(join(HANDLERS_DIR, entry), "utf8").includes("approvalRequired"));

      expect(producers).toEqual([]);
    });
  });

  describe("an exempt command", () => {
    async function denyEverything() {
      await storePolicy(Object.fromEntries(COMMAND_NAMES.map((command) => [command, "deny"])));
    }

    it("runs past the gate even when the stored policy denies it", async () => {
      await denyEverything();

      for (const command of POLICY_EXEMPT_COMMANDS) {
        expect(Object.hasOwn(EXEMPT_PARAMS, command), `${command} needs test params`).toBe(true);

        const response = await router().route(createRequest(command, EXEMPT_PARAMS[command]));

        expect(response.error?.code, command).not.toBe(ERROR_CODES.COMMAND_DENIED);
      }
    });

    it("answers the status and policy reads with a result under that policy", async () => {
      await denyEverything();

      for (const command of ["system.ping", "system.info", "policy.snapshot"]) {
        const response = await router().route(createRequest(command, {}));

        expect(response.ok, command).toBe(true);
      }
    });

    it("is absent from the policy snapshot however the policy names it", async () => {
      await denyEverything();

      const response = await router().route(createRequest("policy.snapshot"));

      expect(response.result).toEqual({ approve: [], deny: GOVERNED_COMMANDS });
      for (const command of POLICY_EXEMPT_COMMANDS) {
        expect(response.result.approve, command).not.toContain(command);
        expect(response.result.deny, command).not.toContain(command);
      }
    });
  });

  describe("an unusable stored policy", () => {
    it("ignores an unknown command name and an unknown behavior", async () => {
      await storePolicy({
        "actor.explode": "deny",
        "actor.get": "refuse-politely",
        "actor.update": "deny"
      });

      const read = await router().route(createRequest("actor.get", { actorId: "actor-1" }));
      const write = await router().route(
        createRequest("actor.update", { actorId: "actor-1", patch: { name: "Denied Rename" } })
      );

      expect(read.ok).toBe(true);
      expect(write.error.code).toBe(ERROR_CODES.COMMAND_DENIED);
    });

    it("falls back to the default profile for a value that is not a policy at all", async () => {
      for (const value of ["deny", ["actor.get"], null, { overrides: { "actor.get": "deny" } }]) {
        await storeRawPolicy(value);

        const read = await router().route(createRequest("actor.get", { actorId: "actor-1" }));
        const snapshot = await router().route(createRequest("policy.snapshot"));

        expect(read.ok, JSON.stringify(value)).toBe(true);
        expect(snapshot.result, JSON.stringify(value)).toEqual({ approve: APPROVE_BY_PROFILE, deny: [] });
      }
    });
  });

  describe("the policy snapshot", () => {
    it("reports the effective behavior of every governed command", async () => {
      await storePolicy({ "actor.get": "deny", "actor.update": "approve", "actor.delete": "allow" });

      const response = await router().route(createRequest("policy.snapshot"));

      const expectedApprove = GOVERNED_COMMANDS.filter(
        (command) =>
          command === "actor.update" ||
          (DEFAULT_COMMAND_PROFILE[command] === "approve" && command !== "actor.delete")
      );
      expect(response.result).toEqual({ approve: expectedApprove, deny: ["actor.get"] });
    });
  });

  describe("the params the gate reads", () => {
    it("leaves them untouched on a refusal and on a marked preview", async () => {
      await storePolicy({ "actor.update": "deny" });
      const denied = { actorId: "actor-1", patch: { name: "Denied Rename" }, dryRun: true };
      const previewed = { actorId: await createDeletableActor(), dryRun: true };

      await router().route({ ...createRequest("actor.update", denied), params: denied });
      await router().route({ ...createRequest("actor.delete", previewed), params: previewed });

      expect(denied).toEqual({ actorId: "actor-1", patch: { name: "Denied Rename" }, dryRun: true });
      expect(previewed).toEqual({ actorId: "actor-created", dryRun: true });
    });
  });

  describe("an invocation that skips the gate", () => {
    it("dispatches a command the stored policy denies", async () => {
      await storePolicy({ "actor.update": "deny" });

      const response = await router().executeGuardedCommand({
        command: "actor.update",
        params: { actorId: "actor-1", patch: { name: "Approved Rename" } },
        messageId: "approved-1",
        skipPolicyGate: true
      });

      expect(response).toMatchObject({ ok: true, id: "approved-1" });
      expect(actorName("actor-1")).toBe("Approved Rename");
    });

    it("adds no approval marker to a preview it no longer resolves a policy for", async () => {
      const response = await router().executeGuardedCommand({
        command: "actor.delete",
        params: { actorId: await createDeletableActor(), dryRun: true },
        messageId: "approved-2",
        skipPolicyGate: true
      });

      expect(response.ok).toBe(true);
      expect(response.result).not.toHaveProperty("approvalRequired");
    });

    it("still reports Foundry as not ready", async () => {
      globalThis.game.ready = false;

      const response = await router().executeGuardedCommand({
        command: "actor.get",
        params: { actorId: "actor-1" },
        messageId: "approved-3",
        skipPolicyGate: true
      });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.BRIDGE_NOT_READY);
    });

    it("still refuses a session that is no longer a GM", async () => {
      globalThis.game.user.isGM = false;

      const response = await router().executeGuardedCommand({
        command: "actor.update",
        params: { actorId: "actor-1", patch: { name: "Approved Rename" } },
        messageId: "approved-4",
        skipPolicyGate: true
      });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
      expect(actorName("actor-1")).toBe("Valeros");
    });

    it("still validates the params", async () => {
      const response = await router().executeGuardedCommand({
        command: "actor.update",
        params: { actorId: "actor-1", patch: { _id: "spoofed" } },
        messageId: "approved-5",
        skipPolicyGate: true
      });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.details.command).toBe("actor.update");
    });

    describe("without the handler its command needs", () => {
      afterEach(() => {
        vi.doUnmock("../scripts/handlers/actors.js");
        vi.resetModules();
      });

      it("still answers with the unsupported-command error", async () => {
        vi.resetModules();
        vi.doMock("../scripts/handlers/actors.js", () => ({ createActorHandlers: () => ({}) }));
        const module = await import("../scripts/command-router.js");

        const response = await module
          .createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } })
          .executeGuardedCommand({
            command: "actor.get",
            params: { actorId: "actor-1" },
            messageId: "approved-6",
            skipPolicyGate: true
          });

        expect(response.ok).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.UNKNOWN_COMMAND);
        expect(response.error.details).toEqual({ command: "actor.get" });
      });
    });
  });
});
