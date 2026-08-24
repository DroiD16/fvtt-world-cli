import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";
import { ERROR_CODES, MODULE_ID } from "../scripts/generated/protocol.js";
import { APPROVAL_REFUSAL_REASONS } from "../scripts/lib/approval-store.js";
import { resolveApprovalTargets } from "../scripts/lib/approval-targets.js";
import { MODULE_SETTING_KEYS } from "../scripts/lib/validators.js";

import { clearStoredCommandPolicy, createRequest, installFakeFoundry } from "./helpers/fake-foundry.js";

const MS_PER_MINUTE = 60_000;
const APPROVAL_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const UNKNOWN_APPROVAL_ID = "AAAAAAAAAAAAAAAAAAAAAA";
const REQUEST_BYTES = 512;
const TIMEOUT_MINUTES = 5;

const BRIDGE_CLIENT = { getStatus: () => ({ status: "connected" }) };

/** @type {any} */
let router;

function flush() {
  return Promise.resolve()
    .then(() => {})
    .then(() => {});
}

/**
 * @param {Record<string, string>} overrides
 */
function storePolicy(overrides) {
  return globalThis.game.settings.set(MODULE_ID, MODULE_SETTING_KEYS.COMMAND_POLICY, {
    version: 1,
    overrides
  });
}

/**
 * @param {string} command
 * @param {Record<string, any>} [params]
 * @param {{ measureRequestBytes?: () => number }} [frame]
 */
function send(command, params = {}, frame = { measureRequestBytes: () => REQUEST_BYTES }) {
  return router.route(createRequest(command, params), frame);
}

/**
 * @param {string} command
 * @param {Record<string, any>} [params]
 */
async function askForApproval(command, params = {}) {
  const response = await send(command, params);

  expect(response.error.code, JSON.stringify(response.error)).toBe(ERROR_CODES.APPROVAL_PENDING);
  return response.error.details.approvalId;
}

/**
 * @param {string} approvalId
 */
function pollOutcome(approvalId) {
  return send("approval.await", { approvalId, waitMs: 0 });
}

function actorName() {
  return globalThis.game.actors.get("actor-1").name;
}

async function createDeletableActor() {
  await send("actor.create", { data: { name: "Rat", type: "npc" } });
  return "actor-created";
}

beforeEach(async () => {
  installFakeFoundry();
  clearStoredCommandPolicy();
  await globalThis.game.settings.set(
    MODULE_ID,
    MODULE_SETTING_KEYS.APPROVAL_TIMEOUT_MINUTES,
    TIMEOUT_MINUTES
  );
  router = createCommandRouter({ bridgeClient: BRIDGE_CLIENT });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a command the policy sends to the GM", () => {
  it("is answered as pending with the id and deadline of the waiting decision", async () => {
    const actorId = await createDeletableActor();
    const before = Date.now();

    const response = await send("actor.delete", { actorId });

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.APPROVAL_PENDING);
    expect(response.error.details.approvalId).toMatch(APPROVAL_ID_PATTERN);
    expect(response.error.details.command).toBe("actor.delete");
    expect(response.error.details.expiresAt).toBeGreaterThanOrEqual(before + TIMEOUT_MINUTES * MS_PER_MINUTE);
    expect(response.error.details.expiresAt).toBeLessThanOrEqual(
      Date.now() + TIMEOUT_MINUTES * MS_PER_MINUTE
    );
    expect(response.error.message).toContain("approval.await");
    expect(response.result).toBeUndefined();
    expect(globalThis.game.actors.get(actorId).deleted).toBeUndefined();
  });

  it("waits in the store as the one decision the GM is asked for", async () => {
    const approvalId = await askForApproval("actor.delete", { actorId: await createDeletableActor() });

    expect(router.approvalStore.getQueueView()).toMatchObject({
      current: { approvalId, command: "actor.delete", state: "pending" },
      waitingCount: 0
    });
  });

  it("answers a poll taken before the decision as still pending, with the deadline it was given", async () => {
    const actorId = await createDeletableActor();
    const pending = await send("actor.delete", { actorId });

    const response = await pollOutcome(pending.error.details.approvalId);

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({
      approvalId: pending.error.details.approvalId,
      status: "pending",
      expiresAt: pending.error.details.expiresAt
    });
    expect(globalThis.game.actors.get(actorId).deleted).toBeUndefined();
  });

  it("names the documents the waiting command would change", async () => {
    const params = { actorId: "actor-1", patch: { name: "Renamed" } };
    await storePolicy({ "actor.update": "approve" });
    const approvalId = await askForApproval("actor.update", params);

    const waiting = router.approvalStore.getQueueView().current;

    expect(waiting.approvalId).toBe(approvalId);
    expect(waiting.targets).toEqual(resolveApprovalTargets("actor.update", params));
    expect(waiting.targets.targets).toEqual([
      { role: "actorId", type: "Actor", id: "actor-1", name: "Valeros", state: "resolved", parents: [] }
    ]);
  });

  it("runs on an allow and delivers exactly what a direct call would have returned", async () => {
    const direct = await send("actor.update", { actorId: "actor-1", patch: { name: "Renamed" } });
    await storePolicy({ "actor.update": "approve" });
    const approvalId = await askForApproval("actor.update", {
      actorId: "actor-1",
      patch: { name: "Renamed" }
    });

    await router.approvalStore.decide(approvalId, "allow");
    const response = await pollOutcome(approvalId);

    expect(response.result).toEqual({
      approvalId,
      status: "resolved",
      outcome: "approved",
      response: { ...direct, id: approvalId }
    });
    expect(response.result.response.result).not.toHaveProperty("approvalRequired");
    expect(actorName()).toBe("Renamed");
  });

  it("delivers a handler error as the outcome of an allowed command, because it ran", async () => {
    await storePolicy({ "actor.update": "approve" });
    const approvalId = await askForApproval("actor.update", {
      actorId: "actor-missing",
      patch: { name: "Nobody" }
    });

    await router.approvalStore.decide(approvalId, "allow");
    const response = await pollOutcome(approvalId);

    expect(response.result.outcome).toBe("approved");
    expect(response.result.response.ok).toBe(false);
    expect(response.result.response.error.code).toBe(ERROR_CODES.ACTOR_NOT_FOUND);
  });

  it("keeps the verdict of the queued invocation when the policy changes under it", async () => {
    await storePolicy({ "actor.update": "approve" });
    const approvalId = await askForApproval("actor.update", {
      actorId: "actor-1",
      patch: { name: "Approved Rename" }
    });

    await storePolicy({ "actor.update": "deny" });
    await router.approvalStore.decide(approvalId, "allow");
    const response = await pollOutcome(approvalId);

    expect(response.result.response.ok).toBe(true);
    expect(actorName()).toBe("Approved Rename");
  });
});

describe("a command whose targets cannot be resolved", () => {
  afterEach(() => {
    vi.doUnmock("../scripts/lib/approval-targets.js");
    vi.resetModules();
  });

  it("still waits for a decision, with no documents named", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("../scripts/lib/approval-targets.js", () => ({
      resolveApprovalTargets: () => {
        throw new Error("target resolution failed");
      }
    }));
    const module = await import("../scripts/command-router.js");
    router = module.createCommandRouter({ bridgeClient: BRIDGE_CLIENT });
    await storePolicy({ "actor.update": "approve" });

    const approvalId = await askForApproval("actor.update", {
      actorId: "actor-1",
      patch: { name: "Unnamed Target" }
    });

    expect(router.approvalStore.getQueueView()).toMatchObject({
      current: { approvalId, command: "actor.update", state: "pending", targets: null },
      waitingCount: 0
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("the guards an allowed command meets at decision time", () => {
  it("reports Foundry as no longer ready", async () => {
    await storePolicy({ "actor.update": "approve" });
    const approvalId = await askForApproval("actor.update", {
      actorId: "actor-1",
      patch: { name: "Too Late" }
    });

    globalThis.game.ready = false;
    await router.approvalStore.decide(approvalId, "allow");
    globalThis.game.ready = true;
    const response = await pollOutcome(approvalId);

    expect(response.result.outcome).toBe("approved");
    expect(response.result.response.error.code).toBe(ERROR_CODES.BRIDGE_NOT_READY);
    expect(actorName()).toBe("Valeros");
  });

  it("refuses a write whose GM authority is gone", async () => {
    await storePolicy({ "actor.update": "approve" });
    const approvalId = await askForApproval("actor.update", {
      actorId: "actor-1",
      patch: { name: "No Longer GM" }
    });

    globalThis.game.user.isGM = false;
    await router.approvalStore.decide(approvalId, "allow");
    globalThis.game.user.isGM = true;
    const response = await pollOutcome(approvalId);

    expect(response.result.response.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(actorName()).toBe("Valeros");
  });

  it("validates the params again, so a request the store holds cannot smuggle any past them", async () => {
    const admission = router.approvalStore.admit({
      command: "actor.update",
      params: { actorId: "actor-1", patch: { _id: "spoofed" } },
      requestBytes: REQUEST_BYTES
    });

    await router.approvalStore.decide(admission.approvalId, "allow");
    const response = await pollOutcome(admission.approvalId);

    expect(response.result.response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.result.response.error.details.command).toBe("actor.update");
  });

  describe("without the handler its command needs", () => {
    afterEach(() => {
      vi.doUnmock("../scripts/handlers/actors.js");
      vi.resetModules();
    });

    it("answers with the unsupported-command error", async () => {
      vi.resetModules();
      vi.doMock("../scripts/handlers/actors.js", () => ({ createActorHandlers: () => ({}) }));
      const module = await import("../scripts/command-router.js");
      router = module.createCommandRouter({ bridgeClient: BRIDGE_CLIENT });
      await storePolicy({ "actor.get": "approve" });

      const approvalId = await askForApproval("actor.get", { actorId: "actor-1" });
      await router.approvalStore.decide(approvalId, "allow");
      const response = await pollOutcome(approvalId);

      expect(response.result.response.error.code).toBe(ERROR_CODES.UNKNOWN_COMMAND);
      expect(response.result.response.error.details).toEqual({ command: "actor.get" });
    });
  });
});

describe("a decision that refuses the command", () => {
  it("reports a denial and leaves the world untouched", async () => {
    await storePolicy({ "actor.update": "approve" });
    const approvalId = await askForApproval("actor.update", {
      actorId: "actor-1",
      patch: { name: "Denied Rename" }
    });

    await router.approvalStore.decide(approvalId, "deny");
    const response = await pollOutcome(approvalId);

    expect(response.result).toEqual({ approvalId, status: "resolved", outcome: "denied" });
    expect(actorName()).toBe("Valeros");
  });

  it("reports a timeout once the deadline passes and leaves the world untouched", async () => {
    vi.useFakeTimers();
    await storePolicy({ "actor.update": "approve" });
    const approvalId = await askForApproval("actor.update", {
      actorId: "actor-1",
      patch: { name: "Expired Rename" }
    });

    await vi.advanceTimersByTimeAsync(TIMEOUT_MINUTES * MS_PER_MINUTE + 1);
    const response = await pollOutcome(approvalId);

    expect(response.result).toEqual({ approvalId, status: "resolved", outcome: "timeout" });
    expect(actorName()).toBe("Valeros");
  });

  it("reports a cancellation the client asked for and leaves the world untouched", async () => {
    await storePolicy({ "actor.update": "approve" });
    const approvalId = await askForApproval("actor.update", {
      actorId: "actor-1",
      patch: { name: "Cancelled Rename" }
    });

    const cancelled = await send("approval.cancel", { approvalId });
    const response = await pollOutcome(approvalId);

    expect(cancelled.result).toEqual({ approvalId, status: "cancelled" });
    expect(response.result).toEqual({ approvalId, status: "resolved", outcome: "cancelled" });
    expect(actorName()).toBe("Valeros");
  });

  it("answers the same terminal outcome to a second poll", async () => {
    await storePolicy({ "actor.update": "approve" });
    const approvalId = await askForApproval("actor.update", {
      actorId: "actor-1",
      patch: { name: "Denied Twice" }
    });

    await router.approvalStore.decide(approvalId, "deny");
    const first = await pollOutcome(approvalId);
    const second = await pollOutcome(approvalId);

    expect(second.result).toEqual(first.result);
  });

  it("answers an id it holds no state for with an indeterminate error", async () => {
    const response = await pollOutcome(UNKNOWN_APPROVAL_ID);

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.APPROVAL_UNKNOWN);
    expect(response.error.details).toEqual({ approvalId: UNKNOWN_APPROVAL_ID });
    expect(response.error.message).toContain("fresh idempotency key");
  });

  it("reports an unknown id to a cancellation without inventing a guarantee", async () => {
    const response = await send("approval.cancel", { approvalId: UNKNOWN_APPROVAL_ID });

    expect(response.result).toEqual({ approvalId: UNKNOWN_APPROVAL_ID, status: "unknown" });
  });
});

describe("a cancellation that arrives while the command runs", () => {
  afterEach(() => {
    vi.doUnmock("../scripts/handlers/actors.js");
    vi.resetModules();
  });

  it("says so and lets the command finish", async () => {
    /** @type {(value: unknown) => void} */
    let release = () => {};
    const running = new Promise((resolve) => {
      release = resolve;
    });
    vi.resetModules();
    vi.doMock("../scripts/handlers/actors.js", () => ({
      createActorHandlers: () => ({
        "actor.update": async () => {
          await running;
          return { actor: { id: "actor-1", name: "Renamed While Cancelling" } };
        }
      })
    }));
    const module = await import("../scripts/command-router.js");
    router = module.createCommandRouter({ bridgeClient: BRIDGE_CLIENT });
    await storePolicy({ "actor.update": "approve" });
    const approvalId = await askForApproval("actor.update", {
      actorId: "actor-1",
      patch: { name: "Renamed While Cancelling" }
    });

    const decision = router.approvalStore.decide(approvalId, "allow");
    await flush();
    const cancelled = await send("approval.cancel", { approvalId });
    release(undefined);
    await decision;
    const response = await pollOutcome(approvalId);

    expect(cancelled.result).toEqual({ approvalId, status: "executing" });
    expect(response.result.outcome).toBe("approved");
    expect(response.result.response.result.actor.name).toBe("Renamed While Cancelling");
  });
});

describe("a request the approval store refuses", () => {
  it("is refused for a full queue before anything is shown or run", async () => {
    router = createCommandRouter({ bridgeClient: BRIDGE_CLIENT, approvalStoreOptions: { pendingMax: 1 } });
    const queueViews = [];
    router.approvalStore.subscribe((view) => queueViews.push(view));
    await storePolicy({ "actor.update": "approve" });
    const approvalId = await askForApproval("actor.update", { actorId: "actor-1", patch: { name: "First" } });

    const response = await send("actor.update", { actorId: "actor-1", patch: { name: "Second" } });

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.APPROVAL_QUEUE_FULL);
    expect(response.error.details).toEqual({
      command: "actor.update",
      reason: APPROVAL_REFUSAL_REASONS.PENDING_COUNT
    });
    expect(queueViews).toHaveLength(1);
    expect(router.approvalStore.getQueueView()).toMatchObject({
      current: { approvalId },
      waitingCount: 0
    });
    expect(actorName()).toBe("Valeros");
  });

  it("is refused when its frame outweighs the budget the transport allows", async () => {
    router = createCommandRouter({
      bridgeClient: BRIDGE_CLIENT,
      approvalStoreOptions: { pendingByteBudgetProvider: () => REQUEST_BYTES - 1 }
    });
    await storePolicy({ "actor.update": "approve" });

    const response = await send("actor.update", { actorId: "actor-1", patch: { name: "Too Heavy" } });

    expect(response.error.code).toBe(ERROR_CODES.APPROVAL_QUEUE_FULL);
    expect(response.error.details.reason).toBe(APPROVAL_REFUSAL_REASONS.PENDING_BYTES);
    expect(router.approvalStore.getQueueView()).toEqual({ current: null, waitingCount: 0 });
    expect(actorName()).toBe("Valeros");
  });

  it("is refused when the weight of its frame is unknown", async () => {
    await storePolicy({ "actor.update": "approve" });

    const response = await send("actor.update", { actorId: "actor-1", patch: { name: "Unweighed" } }, {});

    expect(response.error.code).toBe(ERROR_CODES.APPROVAL_QUEUE_FULL);
    expect(response.error.details.reason).toBe(APPROVAL_REFUSAL_REASONS.PENDING_BYTES);
    expect(router.approvalStore.getQueueView()).toEqual({ current: null, waitingCount: 0 });
  });
});

describe("a command that never reaches the store", () => {
  it("previews an approve-listed command and marks the preview instead", async () => {
    const actorId = await createDeletableActor();

    const response = await send("actor.delete", { actorId, dryRun: true });

    expect(response.ok).toBe(true);
    expect(response.result.approvalRequired).toBe(true);
    expect(globalThis.game.actors.get(actorId).deleted).toBeUndefined();
    expect(router.approvalStore.getQueueView()).toEqual({ current: null, waitingCount: 0 });
  });

  it("rejects params the schema refuses instead of asking the GM about them", async () => {
    const response = await send("actor.delete", { actorId: 5, bogus: true });

    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(router.approvalStore.getQueueView()).toEqual({ current: null, waitingCount: 0 });
  });

  it("refuses a denied command outright", async () => {
    await storePolicy({ "actor.update": "deny" });

    const response = await send("actor.update", { actorId: "actor-1", patch: { name: "Denied" } });

    expect(response.error.code).toBe(ERROR_CODES.COMMAND_DENIED);
    expect(router.approvalStore.getQueueView()).toEqual({ current: null, waitingCount: 0 });
    expect(actorName()).toBe("Valeros");
  });
});
