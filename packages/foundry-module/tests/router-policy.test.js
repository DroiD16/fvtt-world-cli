import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";
import {
  APPROVAL_TIMEOUT_DEFAULT_MINUTES,
  COMMAND_DEFINITIONS,
  COMMAND_NAMES,
  DEFAULT_COMMAND_PROFILE,
  ERROR_CODES,
  MODULE_ID,
  POLICY_EXEMPT_COMMANDS
} from "../scripts/generated/protocol.js";
import { MODULE_SETTING_KEYS } from "../scripts/lib/validators.js";

import {
  COMBAT_GROUP_A,
  clearStoredCommandPolicy,
  createRequest,
  installFakeFoundry
} from "./helpers/fake-foundry.js";

const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS_DIR = join(MODULE_ROOT, "scripts");
const EXCLUDED_SCRIPT_DIRS = new Set(["generated", "vendor"]);
const MARKER_SOURCE = join("scripts", "command-router.js");

function listModuleScripts(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_SCRIPT_DIRS.has(entry.name)) {
        files.push(...listModuleScripts(path));
      }
      continue;
    }
    if (entry.name.endsWith(".js")) {
      files.push(relative(MODULE_ROOT, path));
    }
  }
  return files;
}

const EXEMPT = new Set(POLICY_EXEMPT_COMMANDS);
const GOVERNED_COMMANDS = COMMAND_NAMES.filter((command) => !EXEMPT.has(command));
const APPROVE_BY_PROFILE = GOVERNED_COMMANDS.filter(
  (command) => DEFAULT_COMMAND_PROFILE[command] === "approve"
);

const DENY_BY_PROFILE = GOVERNED_COMMANDS.filter((command) => DEFAULT_COMMAND_PROFILE[command] === "deny");

const PREVIEWABLE_APPROVE_COMMANDS = APPROVE_BY_PROFILE.filter(
  (command) => COMMAND_DEFINITIONS[command].paramsSchema.properties?.dryRun
);
const PREVIEW_FIXTURES = {
  ids: ["missing-fixture-id-1"],
  sceneId: "scene-1",
  tokenId: "token-a",
  actorId: "actor-1",
  itemId: "item-1",
  journalId: "journal-1",
  macroId: "macro-1",
  playlistId: "playlist-1",
  tableId: "table-1",
  combatId: "combat-1",
  folderId: "folder-actors-test",
  cardsId: "cards-deck",
  cardId: "card-ace",
  messageId: "msg-1",
  userId: "user-1",
  tileId: "tile-a",
  wallId: "wall-plain",
  noteId: "note-quest",
  drawingId: "drawing-rect",
  lightId: "light-torch",
  templateId: "template-fireball",
  regionId: "region-lava",
  behaviorId: "behavior-darkness",
  soundId: "sound-a",
  categoryId: "cat-lore",
  resultId: "result-1",
  combatantId: "combatant-1",
  groupId: COMBAT_GROUP_A,
  path: "worlds/world-1/readme.txt",
  from: "worlds/world-1/readme.txt",
  to: "worlds/world-1/notes/readme.txt"
};
const PREVIEW_PARAM_OVERRIDES = {
  "scene.delete": { force: true },
  "scene.region.behavior.delete": { regionId: "region-safe" },
  "scene.token.item.delete": { itemId: "delta-item-1" },
  "scene.token.item.effect.delete": { itemId: "delta-item-1" },
  "scene.token.item.effect.delete-many": { itemId: "delta-item-1" },
  "playlist.sound.delete": { soundId: "sound-1" },
  "journal.category.delete": { journalId: "journal-guard" },
  "actor.delete": { force: true },
  "actor.item.delete": { itemId: "actor-item-1" },
  "actor.item.effect.delete": { itemId: "actor-item-1" },
  "actor.item.effect.delete-many": { itemId: "actor-item-1" }
};
const PREVIEWS_THE_FAKE_WORLD_REFUSES = ["scene.fog.reset"];
const PREVIEWS_NO_FOUNDRY_VERSION_SUPPORTS = ["file.delete", "file.move"];
const PREVIEWS_NO_HANDLER_ROUTES = ["chat.flush", "user.create", "user.delete"];
const PREVIEWS_WITHOUT_A_RESULT = new Set([
  ...PREVIEWS_THE_FAKE_WORLD_REFUSES,
  ...PREVIEWS_NO_FOUNDRY_VERSION_SUPPORTS,
  ...PREVIEWS_NO_HANDLER_ROUTES
]);

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

function registerPolicySettings() {
  clearStoredCommandPolicy();
  globalThis.game.settings.register(MODULE_ID, MODULE_SETTING_KEYS.COMMAND_POLICY, {
    name: "FVTTWORLDCLI.Settings.CommandPolicyName",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });
  globalThis.game.settings.register(MODULE_ID, MODULE_SETTING_KEYS.APPROVAL_TIMEOUT_MINUTES, {
    name: "FVTTWORLDCLI.Settings.ApprovalTimeoutMinutesName",
    scope: "client",
    config: true,
    type: Number,
    default: APPROVAL_TIMEOUT_DEFAULT_MINUTES
  });
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

function requiredKeys(command) {
  return COMMAND_DEFINITIONS[command].paramsSchema.required ?? [];
}

function previewParams(command, seeded = {}) {
  const chosen = { ...PREVIEW_PARAM_OVERRIDES[command], ...seeded };
  const params = { ...chosen };
  for (const key of requiredKeys(command)) {
    params[key] = Object.hasOwn(chosen, key) ? chosen[key] : PREVIEW_FIXTURES[key];
    expect(params[key], `${command} needs a ${key} fixture`).toBeDefined();
  }
  return params;
}

async function seedPreviewEffects() {
  const seeded = {};
  for (const command of PREVIEWABLE_APPROVE_COMMANDS) {
    if (!requiredKeys(command).includes("effectId")) continue;

    const parent = previewParams(command, { effectId: "seeding" });
    delete parent.effectId;
    const response = await router().route(
      createRequest(command.replace(/\.delete$/, ".create"), { ...parent, data: { name: "Seeded Effect" } })
    );
    seeded[command] = { effectId: response.ok ? response.result.effect.id : "no-such-effect" };
  }
  return seeded;
}

function actorName(id) {
  return globalThis.game.actors.get(id)?.name;
}

describe("command policy gate", () => {
  beforeEach(() => {
    installFakeFoundry();
    registerPolicySettings();
  });

  describe("with no stored policy", () => {
    it("dispatches a read the default profile allows", async () => {
      const response = await router().route(createRequest("actor.get", { actorId: "actor-1" }));

      expect(response.ok).toBe(true);
      expect(response.result.actor.id).toBe("actor-1");
    });

    it("hands an approve-listed command to the GM instead of dispatching it", async () => {
      const actorId = await createDeletableActor();

      const response = await router().route(createRequest("actor.delete", { actorId }), {
        measureRequestBytes: () => 256
      });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.APPROVAL_PENDING);
      expect(response.error.details.command).toBe("actor.delete");
      expect(globalThis.game.actors.get(actorId).deleted).toBeUndefined();
    });

    it("resolves the destructive commands to approve and the denied-by-default ones to deny", async () => {
      const response = await router().route(createRequest("policy.snapshot"));

      expect(response.ok).toBe(true);
      expect(response.result).toEqual({ approve: APPROVE_BY_PROFILE, deny: DENY_BY_PROFILE });
      expect(response.result.approve).toContain("actor.delete");
      expect(response.result.deny).toContain("macro.execute");
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

    it("is refused for a non-GM session before the policy verdict", async () => {
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

    it("carries no marker on a denied invocation", async () => {
      await storePolicy({ "actor.delete": "deny" });
      const actorId = await createDeletableActor();

      const response = await router().route(createRequest("actor.delete", { actorId, dryRun: true }));

      expect(response.ok).toBe(false);
      expect(response.error.details).toEqual({ command: "actor.delete" });
      expect(response.error.details).not.toHaveProperty("approvalRequired");
    });

    it("is marked in the preview of every approve-listed command", async () => {
      const seeded = await seedPreviewEffects();
      const unmarked = [];
      const refused = [];

      for (const command of PREVIEWABLE_APPROVE_COMMANDS) {
        const params = { ...previewParams(command, seeded[command]), dryRun: true };

        const response = await router().route(createRequest(command, params));
        if (!response.ok) {
          expect(response.error.code, command).not.toBe(ERROR_CODES.COMMAND_DENIED);
          refused.push(command);
          continue;
        }

        expect(response.result.dryRun, command).toBe(true);
        if (response.result.approvalRequired !== true) unmarked.push(command);
      }

      expect(unmarked).toEqual([]);
      expect(refused).toEqual(
        PREVIEWABLE_APPROVE_COMMANDS.filter((command) => PREVIEWS_WITHOUT_A_RESULT.has(command))
      );
    });

    it("is marked by the gate alone, nowhere else in the module", () => {
      const producers = listModuleScripts(SCRIPTS_DIR)
        .filter((path) => path !== MARKER_SOURCE)
        .filter((path) => readFileSync(join(MODULE_ROOT, path), "utf8").includes("approvalRequired"));

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
      for (const value of ["deny", ["actor.get"], null, {}, { overrides: { "actor.get": "deny" } }]) {
        await storeRawPolicy(value);

        const read = await router().route(createRequest("actor.get", { actorId: "actor-1" }));
        const snapshot = await router().route(createRequest("policy.snapshot"));

        expect(read.ok, JSON.stringify(value)).toBe(true);
        expect(snapshot.result, JSON.stringify(value)).toEqual({
          approve: APPROVE_BY_PROFILE,
          deny: DENY_BY_PROFILE
        });
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
      expect(response.result).toEqual({
        approve: expectedApprove,
        deny: GOVERNED_COMMANDS.filter(
          (command) => command === "actor.get" || DEFAULT_COMMAND_PROFILE[command] === "deny"
        )
      });
    });
  });

  describe("the settings the policy lives in", () => {
    it("lists both of them, the hidden one included", async () => {
      const response = await router().route(createRequest("setting.list", {}));

      const policyKeys = [MODULE_SETTING_KEYS.COMMAND_POLICY, MODULE_SETTING_KEYS.APPROVAL_TIMEOUT_MINUTES];

      for (const key of policyKeys) {
        const row = response.result.settings.find(
          (candidate) => candidate.namespace === MODULE_ID && candidate.key === key
        );
        expect(row, key).toBeDefined();
        expect(row, key).not.toHaveProperty("valueRedacted");
      }
    });

    it("reads the stored policy and timeout back unredacted", async () => {
      await storePolicy({ "actor.get": "deny" });
      await globalThis.game.settings.set(MODULE_ID, MODULE_SETTING_KEYS.APPROVAL_TIMEOUT_MINUTES, 5);

      const policy = await router().route(
        createRequest("setting.get", { namespace: MODULE_ID, key: MODULE_SETTING_KEYS.COMMAND_POLICY })
      );
      const timeout = await router().route(
        createRequest("setting.get", {
          namespace: MODULE_ID,
          key: MODULE_SETTING_KEYS.APPROVAL_TIMEOUT_MINUTES
        })
      );

      expect(policy.result.setting.value).toEqual({ version: 1, overrides: { "actor.get": "deny" } });
      expect(policy.result.setting).not.toHaveProperty("valueRedacted");
      expect(timeout.result.setting.value).toBe(5);
    });
  });

  describe("the params the gate reads", () => {
    it("leaves them untouched on a refusal and on a marked preview", async () => {
      await storePolicy({ "actor.update": "deny" });
      const denied = { actorId: "actor-1", patch: { name: "Denied Rename" }, dryRun: true };
      const previewed = { actorId: await createDeletableActor(), dryRun: true };
      const deniedBefore = structuredClone(denied);
      const previewedBefore = structuredClone(previewed);

      const refusal = await router().route(createRequest("actor.update", denied));
      const preview = await router().route(createRequest("actor.delete", previewed));

      expect(refusal.error.code).toBe(ERROR_CODES.COMMAND_DENIED);
      expect(preview.result.approvalRequired).toBe(true);
      expect(denied).toEqual(deniedBefore);
      expect(previewed).toEqual(previewedBefore);
    });
  });

  describe("an invocation that skips the gate", () => {
    it("cannot be asked for by a request arriving over the transport", async () => {
      await storePolicy({ "actor.update": "deny" });

      const response = await router().route({
        ...createRequest("actor.update", { actorId: "actor-1", patch: { name: "Smuggled Rename" } }),
        skipApprovalGate: true
      });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMMAND_DENIED);
      expect(actorName("actor-1")).toBe("Valeros");
    });

    it("dispatches a command the stored policy still allows", async () => {
      const response = await router().executeGuardedCommand({
        command: "actor.update",
        params: { actorId: "actor-1", patch: { name: "Approved Rename" } },
        messageId: "approved-1",
        skipApprovalGate: true
      });

      expect(response).toMatchObject({ ok: true, id: "approved-1" });
      expect(actorName("actor-1")).toBe("Approved Rename");
    });

    it("refuses a command the stored policy denied while the decision was waiting", async () => {
      await storePolicy({ "actor.update": "deny" });

      const response = await router().executeGuardedCommand({
        command: "actor.update",
        params: { actorId: "actor-1", patch: { name: "Approved Rename" } },
        messageId: "approved-1",
        skipApprovalGate: true
      });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMMAND_DENIED);
      expect(actorName("actor-1")).toBe("Valeros");
    });

    it("adds no approval marker to a preview taken past the approval gate", async () => {
      const response = await router().executeGuardedCommand({
        command: "actor.delete",
        params: { actorId: await createDeletableActor(), dryRun: true },
        messageId: "approved-2",
        skipApprovalGate: true
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
        skipApprovalGate: true
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
        skipApprovalGate: true
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
        skipApprovalGate: true
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
            skipApprovalGate: true
          });

        expect(response.ok).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.UNKNOWN_COMMAND);
        expect(response.error.details).toEqual({ command: "actor.get" });
      });
    });
  });
});
