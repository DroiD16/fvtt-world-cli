import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APPROVAL_AWAIT_PARK_CAP_MS,
  APPROVAL_RESULT_RETENTION_MS,
  APPROVAL_TIMEOUT_DEFAULT_MINUTES
} from "../scripts/generated/protocol.js";
import {
  APPROVAL_REFUSAL_REASONS,
  APPROVAL_UNKNOWN_REASONS,
  ApprovalStore
} from "../scripts/lib/approval-store.js";

const MS_PER_MINUTE = 60_000;

const APPROVAL_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const weighedResponses = {
  /** @param {any} execution */
  execute: (execution) => ({ ok: true, weight: execution.params.weight }),
  /** @param {any} response */
  measureResponseBytes: (response) => response.weight
};

function flush() {
  return Promise.resolve()
    .then(() => {})
    .then(() => {});
}

function createClock() {
  let now = 1_700_000_000_000;
  let nextHandle = 1;
  /** @type {Map<number, { handler: () => void, dueAt: number }>} */
  const timers = new Map();

  return {
    now: () => now,

    /**
     * @param {() => void} handler
     * @param {number} delayMs
     */
    setTimer(handler, delayMs) {
      const handle = nextHandle;
      nextHandle += 1;
      timers.set(handle, { handler, dueAt: now + delayMs });
      return handle;
    },

    /** @param {any} handle */
    clearTimer(handle) {
      timers.delete(handle);
    },

    liveTimers() {
      return timers.size;
    },

    liveHandlers() {
      return [...timers.values()].map((timer) => timer.handler);
    },

    /** @param {number} ms */
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.dueAt <= target)
          .sort(([, left], [, right]) => left.dueAt - right.dueAt)[0];
        if (!due) break;
        const [handle, timer] = due;
        timers.delete(handle);
        now = timer.dueAt;
        timer.handler();
        await flush();
      }

      now = target;
      await flush();
    }
  };
}

function createDeferred() {
  /** @type {(value: unknown) => void} */
  let settle = () => {};
  const promise = new Promise((resolve) => {
    settle = resolve;
  });

  return { promise, settle };
}

/** @param {Promise<any>} promise */
function track(promise) {
  const tracked = { settled: false, /** @type {any} */ value: null };
  void promise.then((value) => {
    tracked.settled = true;
    tracked.value = value;
  });

  return tracked;
}

/**
 * @param {{ execute?: (execution: any) => unknown } & Record<string, any>} [options]
 */
function createHarness({ execute, ...options } = {}) {
  const clock = createClock();
  /** @type {any[]} */
  const executions = [];

  const store = new ApprovalStore({
    now: clock.now,
    setTimer: (handler, delayMs) => clock.setTimer(handler, delayMs),
    clearTimer: (handle) => clock.clearTimer(handle),
    timeoutMinutesProvider: () => APPROVAL_TIMEOUT_DEFAULT_MINUTES,
    execute: (execution) => {
      executions.push(execution);
      return execute ? execute(execution) : { ok: true, command: execution.command };
    },
    ...options
  });

  return { store, clock, executions };
}

/**
 * @param {ApprovalStore} store
 * @param {Record<string, any>} [overrides]
 */
function admitRequest(store, overrides = {}) {
  const admission = store.admit({
    command: "actor.update",
    params: { actorId: "actor-1", patch: { name: "Aria" } },
    resolveTargets: () => [{ display: "Aria", kind: "Actor", missing: false }],
    requestBytes: 128,
    ...overrides
  });

  if (!admission.admitted) {
    throw new Error(`the store refused an admission the test needs: ${admission.reason}`);
  }

  return admission;
}

/**
 * @param {ApprovalStore} store
 * @param {number} requestBytes
 */
function admitWeighed(store, requestBytes) {
  return admitRequest(store, { requestBytes, params: { weight: requestBytes } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("approval store admission", () => {
  it("issues an unguessable 22-character id per admitted request", () => {
    const { store } = createHarness();

    const first = admitRequest(store);
    const second = admitRequest(store);

    expect(first.approvalId).toMatch(APPROVAL_ID_PATTERN);
    expect(second.approvalId).toMatch(APPROVAL_ID_PATTERN);
    expect(second.approvalId).not.toBe(first.approvalId);
  });

  it("dates the expiry from the configured approval timeout", () => {
    const { store, clock } = createHarness({ timeoutMinutesProvider: () => 5 });

    const admission = admitRequest(store);

    expect(admission.expiresAt).toBe(clock.now() + 5 * MS_PER_MINUTE);
  });

  it("falls back to the default timeout when the setting is out of range or corrupt", () => {
    for (const stored of ["banana", 0, -1, 10 ** 9, null, 1.5]) {
      const { store, clock } = createHarness({ timeoutMinutesProvider: () => stored });

      const admission = admitRequest(store);

      expect(admission.expiresAt).toBe(clock.now() + APPROVAL_TIMEOUT_DEFAULT_MINUTES * MS_PER_MINUTE);
    }
  });

  it("refuses admission once the pending count is reached", () => {
    const { store } = createHarness({ pendingMax: 2 });

    admitRequest(store);
    admitRequest(store);

    expect(store.admit({ command: "actor.update", params: {}, requestBytes: 1 })).toEqual({
      admitted: false,
      reason: APPROVAL_REFUSAL_REASONS.PENDING_COUNT
    });
  });

  it("names the documents a request would change only once it is past every bound", () => {
    const { store } = createHarness({ pendingMax: 1 });
    const resolveTargets = vi.fn(() => [{ display: "Aria", kind: "Actor", missing: false }]);

    admitRequest(store, { resolveTargets });
    const refused = store.admit({
      command: "actor.update",
      params: {},
      resolveTargets,
      requestBytes: 1
    });

    expect(refused).toEqual({ admitted: false, reason: APPROVAL_REFUSAL_REASONS.PENDING_COUNT });
    expect(resolveTargets).toHaveBeenCalledTimes(1);
  });

  it("refuses admission once the pending byte budget is reached", () => {
    const { store } = createHarness({ pendingByteBudgetProvider: () => 1_000 });

    admitRequest(store, { requestBytes: 600 });

    expect(store.admit({ command: "actor.update", params: {}, requestBytes: 600 })).toEqual({
      admitted: false,
      reason: APPROVAL_REFUSAL_REASONS.PENDING_BYTES
    });
  });

  it("admits one request that fills the whole byte budget", () => {
    const { store } = createHarness({ pendingByteBudgetProvider: () => 1_000 });

    expect(admitRequest(store, { requestBytes: 1_000 }).approvalId).toMatch(APPROVAL_ID_PATTERN);
  });

  it("frees the byte budget as soon as a request leaves pending", () => {
    const { store } = createHarness({ pendingByteBudgetProvider: () => 1_000 });

    const admission = admitRequest(store, { requestBytes: 1_000 });
    store.cancel(admission.approvalId);

    expect(admitRequest(store, { requestBytes: 1_000 }).approvalId).toMatch(APPROVAL_ID_PATTERN);
  });

  it("forgets a delivered outcome before an undelivered one when the record cap is reached", async () => {
    const { store } = createHarness({ recordMax: 3 });
    const first = admitRequest(store);
    const second = admitRequest(store);

    await store.decide(first.approvalId, "deny");
    await store.decide(second.approvalId, "deny");
    await store.awaitOutcome({ approvalId: first.approvalId, waitMs: 0 });
    admitRequest(store);
    admitRequest(store);

    await expect(store.awaitOutcome({ approvalId: first.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: first.approvalId,
      status: "unknown"
    });
    await expect(store.awaitOutcome({ approvalId: second.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: second.approvalId,
      status: "resolved",
      outcome: "denied"
    });
  });

  it("refuses a new request rather than forget a verdict no client has read", async () => {
    const { store } = createHarness({ recordMax: 2 });
    const first = admitRequest(store);
    const second = admitRequest(store);
    await store.decide(first.approvalId, "deny");
    await store.decide(second.approvalId, "deny");

    expect(store.admit({ command: "actor.update", params: {}, requestBytes: 1 })).toEqual({
      admitted: false,
      reason: APPROVAL_REFUSAL_REASONS.RETAINED_COUNT
    });
    await expect(store.awaitOutcome({ approvalId: first.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: first.approvalId,
      status: "resolved",
      outcome: "denied"
    });
    await expect(store.awaitOutcome({ approvalId: second.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: second.approvalId,
      status: "resolved",
      outcome: "denied"
    });
  });

  it("keeps admitting while a client requests and cancels in a loop", async () => {
    const { store } = createHarness({ recordMax: 2 });
    const first = admitRequest(store);
    store.cancel(first.approvalId);
    const second = admitRequest(store);
    store.cancel(second.approvalId);

    const third = admitRequest(store);

    expect(third.approvalId).toMatch(APPROVAL_ID_PATTERN);
    await expect(store.awaitOutcome({ approvalId: first.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: first.approvalId,
      status: "unknown"
    });
    await expect(store.awaitOutcome({ approvalId: second.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: second.approvalId,
      status: "resolved",
      outcome: "cancelled"
    });
  });

  it("keeps admitting while approved commands are still running", async () => {
    const executor = createDeferred();
    const { store } = createHarness({ recordMax: 2, execute: () => executor.promise });
    const first = admitRequest(store);
    const second = admitRequest(store);
    const firstDecision = track(store.decide(first.approvalId, "allow"));
    const secondDecision = track(store.decide(second.approvalId, "allow"));
    await flush();

    expect(admitRequest(store).approvalId).toMatch(APPROVAL_ID_PATTERN);

    executor.settle({ ok: true });
    await flush();

    expect(firstDecision.settled).toBe(true);
    expect(secondDecision.settled).toBe(true);
    await expect(store.awaitOutcome({ approvalId: first.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: first.approvalId,
      status: "resolved",
      outcome: "approved",
      response: { ok: true }
    });
  });

  it("still refuses a request over unread verdicts while a command is running", async () => {
    const executor = createDeferred();
    const { store } = createHarness({ recordMax: 2, execute: () => executor.promise });
    const running = admitRequest(store);
    track(store.decide(running.approvalId, "allow"));
    await flush();
    await store.decide(admitRequest(store).approvalId, "deny");
    await store.decide(admitRequest(store).approvalId, "deny");

    expect(store.admit({ command: "actor.update", params: {}, requestBytes: 1 })).toEqual({
      admitted: false,
      reason: APPROVAL_REFUSAL_REASONS.RETAINED_COUNT
    });

    executor.settle({ ok: true });
    await flush();
  });

  it("refuses a request whose byte weight cannot be measured", () => {
    const { store } = createHarness({ pendingByteBudgetProvider: () => 1_000 });

    for (const requestBytes of [Number.POSITIVE_INFINITY, Number.NaN, -1]) {
      expect(store.admit({ command: "actor.update", params: {}, requestBytes })).toEqual({
        admitted: false,
        reason: APPROVAL_REFUSAL_REASONS.PENDING_BYTES
      });
    }
  });

  it("reads the byte budget again for every admission", () => {
    let budget = 500;
    const { store } = createHarness({ pendingByteBudgetProvider: () => budget });

    admitRequest(store, { requestBytes: 400 });
    const refused = store.admit({ command: "actor.update", params: {}, requestBytes: 400 });
    budget = 2_000;
    const admitted = store.admit({ command: "actor.update", params: {}, requestBytes: 400 });

    expect(refused).toEqual({ admitted: false, reason: APPROVAL_REFUSAL_REASONS.PENDING_BYTES });
    expect(admitted).toMatchObject({ admitted: true });
  });
});

describe("approval store decisions", () => {
  it("executes an allowed request and retains its success response", async () => {
    const { store, executions } = createHarness();
    const admission = admitRequest(store);

    const decision = await store.decide(admission.approvalId, "allow");

    expect(decision).toEqual({ approvalId: admission.approvalId, state: "resolved" });
    expect(executions).toEqual([
      {
        approvalId: admission.approvalId,
        command: "actor.update",
        params: { actorId: "actor-1", patch: { name: "Aria" } }
      }
    ]);
    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: admission.approvalId,
      status: "resolved",
      outcome: "approved",
      response: { ok: true, command: "actor.update" }
    });
  });

  it("retains a handler error as the approved outcome, because the command ran", async () => {
    const errorResponse = { ok: false, error: { code: "ACTOR_NOT_FOUND" } };
    const { store } = createHarness({ execute: () => errorResponse });
    const admission = admitRequest(store);

    await store.decide(admission.approvalId, "allow");

    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: admission.approvalId,
      status: "resolved",
      outcome: "approved",
      response: errorResponse
    });
  });

  it("reports an indeterminate outcome, not a success, when the executor throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, clock } = createHarness({
      execute: () => {
        throw new Error("executor exploded");
      }
    });
    const admission = admitRequest(store);

    const decision = await store.decide(admission.approvalId, "allow");
    const report = await store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 });

    expect(decision).toEqual({ approvalId: admission.approvalId, state: "resolved" });
    expect(report).toEqual({
      approvalId: admission.approvalId,
      status: "unknown",
      reason: APPROVAL_UNKNOWN_REASONS.EXECUTOR_FAILED
    });
    expect(store.getQueueView()).toEqual({ current: null, waitingCount: 0 });
    expect(clock.liveTimers()).toBe(0);
  });

  it("denies without executing and reports the denial", async () => {
    const { store, executions } = createHarness();
    const admission = admitRequest(store);

    const decision = await store.decide(admission.approvalId, "deny");

    expect(decision).toEqual({ approvalId: admission.approvalId, state: "denied" });
    expect(executions).toEqual([]);
    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: admission.approvalId,
      status: "resolved",
      outcome: "denied"
    });
  });

  it("times out without executing and reports the timeout", async () => {
    const { store, clock, executions } = createHarness({ timeoutMinutesProvider: () => 1 });
    const admission = admitRequest(store);

    await clock.advance(MS_PER_MINUTE);

    expect(executions).toEqual([]);
    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: admission.approvalId,
      status: "resolved",
      outcome: "timeout"
    });
    expect(clock.liveTimers()).toBe(0);
  });

  it("cancels a pending request without executing", async () => {
    const { store, executions } = createHarness();
    const admission = admitRequest(store);

    expect(store.cancel(admission.approvalId)).toBe("cancelled");
    expect(executions).toEqual([]);
    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: admission.approvalId,
      status: "resolved",
      outcome: "cancelled"
    });
  });

  it("releases the pending parameters as the request leaves pending", async () => {
    const executor = createDeferred();
    const { store } = createHarness({ execute: () => executor.promise });
    const admission = admitRequest(store);

    const decision = track(store.decide(admission.approvalId, "allow"));
    await flush();

    expect(store.getQueueView().current).toEqual({
      approvalId: admission.approvalId,
      command: "actor.update",
      targets: [{ display: "Aria", kind: "Actor", missing: false }],
      createdAt: expect.any(Number),
      expiresAt: admission.expiresAt,
      state: "executing"
    });

    executor.settle({ ok: true });
    await flush();
    expect(decision.settled).toBe(true);
  });

  it("answers a decision on an unknown id without inventing state", async () => {
    const { store, executions } = createHarness();

    await expect(store.decide("AAAAAAAAAAAAAAAAAAAAAA", "allow")).resolves.toEqual({
      approvalId: "AAAAAAAAAAAAAAAAAAAAAA",
      state: "unknown"
    });
    expect(store.cancel("AAAAAAAAAAAAAAAAAAAAAA")).toBe("unknown");
    expect(executions).toEqual([]);
  });
});

describe("approval store races", () => {
  it("answers executing to a deny that arrives after the allow won", async () => {
    const executor = createDeferred();
    const { store, executions } = createHarness({ execute: () => executor.promise });
    const admission = admitRequest(store);

    const allow = track(store.decide(admission.approvalId, "allow"));
    const late = await store.decide(admission.approvalId, "deny");

    expect(late).toEqual({ approvalId: admission.approvalId, state: "executing" });

    executor.settle({ ok: true });
    await flush();

    expect(allow.value).toEqual({ approvalId: admission.approvalId, state: "resolved" });
    expect(executions).toHaveLength(1);
    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: admission.approvalId,
      status: "resolved",
      outcome: "approved",
      response: { ok: true }
    });
  });

  it("answers denied to an allow that arrives after the deny won", async () => {
    const { store, executions } = createHarness();
    const admission = admitRequest(store);

    await store.decide(admission.approvalId, "deny");
    const late = await store.decide(admission.approvalId, "allow");

    expect(late).toEqual({ approvalId: admission.approvalId, state: "denied" });
    expect(executions).toEqual([]);
  });

  it("ignores an expiry that fires after the allow claimed the request", async () => {
    const executor = createDeferred();
    const { store, clock } = createHarness({
      timeoutMinutesProvider: () => 1,
      execute: () => executor.promise
    });
    const admission = admitRequest(store);
    const [expire] = clock.liveHandlers();

    const allow = track(store.decide(admission.approvalId, "allow"));
    await flush();
    expect(clock.liveTimers()).toBe(0);

    expire();
    await clock.advance(MS_PER_MINUTE * 2);

    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: admission.approvalId,
      status: "pending"
    });

    executor.settle({ ok: true });
    await flush();

    expect(allow.value).toEqual({ approvalId: admission.approvalId, state: "resolved" });
    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: admission.approvalId,
      status: "resolved",
      outcome: "approved",
      response: { ok: true }
    });
  });

  it("answers timeout to an allow that arrives after the timer won", async () => {
    const { store, clock, executions } = createHarness({ timeoutMinutesProvider: () => 1 });
    const admission = admitRequest(store);

    await clock.advance(MS_PER_MINUTE);
    const late = await store.decide(admission.approvalId, "allow");

    expect(late).toEqual({ approvalId: admission.approvalId, state: "timeout" });
    expect(executions).toEqual([]);
  });

  it("answers executing to a cancel arriving while the handler runs, and still records the outcome", async () => {
    const executor = createDeferred();
    const { store } = createHarness({ execute: () => executor.promise });
    const admission = admitRequest(store);

    const allow = track(store.decide(admission.approvalId, "allow"));
    expect(store.cancel(admission.approvalId)).toBe("executing");

    executor.settle({ ok: true, updated: true });
    await flush();

    expect(allow.value).toEqual({ approvalId: admission.approvalId, state: "resolved" });
    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: admission.approvalId,
      status: "resolved",
      outcome: "approved",
      response: { ok: true, updated: true }
    });
  });

  it("answers resolved to a cancel that arrives after the outcome exists", async () => {
    const { store } = createHarness();
    const admission = admitRequest(store);

    await store.decide(admission.approvalId, "allow");

    expect(store.cancel(admission.approvalId)).toBe("resolved");
  });

  it("answers cancelled to a repeated cancel of the same request", () => {
    const { store } = createHarness();
    const admission = admitRequest(store);

    expect(store.cancel(admission.approvalId)).toBe("cancelled");
    expect(store.cancel(admission.approvalId)).toBe("cancelled");
  });

  it("ignores a second allow, whether the first is running or already resolved", async () => {
    const executor = createDeferred();
    const { store, executions } = createHarness({ execute: () => executor.promise });
    const admission = admitRequest(store);

    const allow = track(store.decide(admission.approvalId, "allow"));
    await expect(store.decide(admission.approvalId, "allow")).resolves.toEqual({
      approvalId: admission.approvalId,
      state: "executing"
    });

    executor.settle({ ok: true });
    await flush();
    expect(allow.settled).toBe(true);

    await expect(store.decide(admission.approvalId, "allow")).resolves.toEqual({
      approvalId: admission.approvalId,
      state: "resolved"
    });
    expect(executions).toHaveLength(1);
  });
});

describe("approval store waiters", () => {
  it("parks a poll until the decision lands", async () => {
    const { store, clock } = createHarness();
    const admission = admitRequest(store);

    const poll = track(store.awaitOutcome({ approvalId: admission.approvalId }));
    await flush();
    expect(poll.settled).toBe(false);

    await store.decide(admission.approvalId, "deny");

    expect(poll.value).toEqual({
      approvalId: admission.approvalId,
      status: "resolved",
      outcome: "denied"
    });
    expect(clock.liveTimers()).toBe(0);
  });

  it("answers pending when the park expires with the request still undecided", async () => {
    const { store, clock } = createHarness();
    const admission = admitRequest(store);

    const poll = track(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 5_000 }));
    await clock.advance(4_999);
    expect(poll.settled).toBe(false);

    await clock.advance(1);

    expect(poll.value).toEqual({
      approvalId: admission.approvalId,
      status: "pending",
      expiresAt: admission.expiresAt
    });
  });

  it("clamps a park request above the cap", async () => {
    const { store, clock } = createHarness();
    const admission = admitRequest(store);

    const poll = track(
      store.awaitOutcome({ approvalId: admission.approvalId, waitMs: APPROVAL_AWAIT_PARK_CAP_MS + 60_000 })
    );
    await clock.advance(APPROVAL_AWAIT_PARK_CAP_MS - 1);
    expect(poll.settled).toBe(false);

    await clock.advance(1);

    expect(poll.value).toMatchObject({ status: "pending" });
  });

  it("answers a zero wait immediately", async () => {
    const { store, clock } = createHarness();
    const admission = admitRequest(store);

    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: admission.approvalId,
      status: "pending",
      expiresAt: admission.expiresAt
    });
    expect(clock.liveTimers()).toBe(1);
  });

  it("resolves every waiter parked on the same id", async () => {
    const { store } = createHarness();
    const admission = admitRequest(store);

    const first = track(store.awaitOutcome({ approvalId: admission.approvalId }));
    const second = track(store.awaitOutcome({ approvalId: admission.approvalId }));
    store.cancel(admission.approvalId);
    await flush();

    const expected = {
      approvalId: admission.approvalId,
      status: "resolved",
      outcome: "cancelled"
    };
    expect(first.value).toEqual(expected);
    expect(second.value).toEqual(expected);
  });

  it("answers pending without a deadline once execution starts, so a poll never waits on a handler", async () => {
    const executor = createDeferred();
    const { store } = createHarness({ execute: () => executor.promise });
    const admission = admitRequest(store);

    const poll = track(store.awaitOutcome({ approvalId: admission.approvalId }));
    await flush();
    const allow = track(store.decide(admission.approvalId, "allow"));
    await flush();

    expect(poll.value).toEqual({
      approvalId: admission.approvalId,
      status: "pending"
    });

    executor.settle({ ok: true });
    await flush();
    expect(allow.settled).toBe(true);
  });

  it("answers pending at park expiry even while a handler is still running", async () => {
    const executor = createDeferred();
    const { store, clock } = createHarness({ execute: () => executor.promise });
    const admission = admitRequest(store);

    const allow = track(store.decide(admission.approvalId, "allow"));
    const poll = track(store.awaitOutcome({ approvalId: admission.approvalId }));
    await clock.advance(APPROVAL_AWAIT_PARK_CAP_MS);

    expect(poll.value).toMatchObject({ status: "pending" });

    executor.settle({ ok: true });
    await flush();
    expect(allow.settled).toBe(true);
  });

  it("answers unknown to a poll for an id it never issued", async () => {
    const { store } = createHarness();

    await expect(store.awaitOutcome({ approvalId: "BBBBBBBBBBBBBBBBBBBBBB" })).resolves.toEqual({
      approvalId: "BBBBBBBBBBBBBBBBBBBBBB",
      status: "unknown"
    });
  });
});

describe("approval store retention", () => {
  it("delivers the same terminal outcome to every poll inside the retention window", async () => {
    const { store, clock } = createHarness();
    const admission = admitRequest(store);

    await store.decide(admission.approvalId, "allow");
    const expected = {
      approvalId: admission.approvalId,
      status: "resolved",
      outcome: "approved",
      response: { ok: true, command: "actor.update" }
    };

    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual(
      expected
    );
    await clock.advance(APPROVAL_RESULT_RETENTION_MS - 1);
    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual(
      expected
    );
  });

  it("forgets a terminal outcome once its retention window passes", async () => {
    const { store, clock } = createHarness();
    const admission = admitRequest(store);

    await store.decide(admission.approvalId, "deny");
    await clock.advance(APPROVAL_RESULT_RETENTION_MS);

    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: admission.approvalId,
      status: "unknown"
    });
    expect(clock.liveTimers()).toBe(0);
  });

  it("hands a parked waiter a response too large to retain, then reports the loss", async () => {
    const response = { ok: true, payload: "x".repeat(2_000) };
    const executor = createDeferred();
    const { store } = createHarness({
      execute: () => executor.promise,
      resultByteBudgetProvider: () => 200
    });
    const admission = admitRequest(store);

    const allow = track(store.decide(admission.approvalId, "allow"));
    const poll = track(store.awaitOutcome({ approvalId: admission.approvalId }));
    await flush();
    executor.settle(response);
    await flush();
    expect(allow.settled).toBe(true);

    expect(poll.value).toEqual({
      approvalId: admission.approvalId,
      status: "resolved",
      outcome: "approved",
      response
    });
    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: admission.approvalId,
      status: "unknown",
      reason: APPROVAL_UNKNOWN_REASONS.RESULT_RETENTION_CAP
    });
    expect(store.cancel(admission.approvalId)).toBe("unknown");
  });

  it("keeps an earlier undelivered response when a later one cannot fit", async () => {
    const { store } = createHarness({
      execute: (execution) => ({ ok: true, command: execution.command }),
      resultByteBudgetProvider: () => 60
    });
    const first = admitRequest(store, { command: "actor.update" });
    const second = admitRequest(store, { command: "item.update" });

    await store.decide(first.approvalId, "allow");
    await store.decide(second.approvalId, "allow");

    await expect(store.awaitOutcome({ approvalId: first.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: first.approvalId,
      status: "resolved",
      outcome: "approved",
      response: { ok: true, command: "actor.update" }
    });
    await expect(store.awaitOutcome({ approvalId: second.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: second.approvalId,
      status: "unknown",
      reason: APPROVAL_UNKNOWN_REASONS.RESULT_RETENTION_CAP
    });
  });

  it("displaces a response the client already read to retain a newer outcome", async () => {
    const { store } = createHarness({ ...weighedResponses, resultByteBudgetProvider: () => 100 });
    const first = admitWeighed(store, 60);
    const second = admitWeighed(store, 60);

    await store.decide(first.approvalId, "allow");
    await store.awaitOutcome({ approvalId: first.approvalId, waitMs: 0 });
    await store.decide(second.approvalId, "allow");

    await expect(store.awaitOutcome({ approvalId: second.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: second.approvalId,
      status: "resolved",
      outcome: "approved",
      response: { ok: true, weight: 60 }
    });
    await expect(store.awaitOutcome({ approvalId: first.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: first.approvalId,
      status: "unknown",
      reason: APPROVAL_UNKNOWN_REASONS.RESULT_RETENTION_CAP
    });
  });

  it("keeps a read outcome that could not have made room for the newer one anyway", async () => {
    const { store } = createHarness({ ...weighedResponses, resultByteBudgetProvider: () => 100 });
    const read = admitWeighed(store, 40);
    const unread = admitWeighed(store, 50);
    const oversized = admitWeighed(store, 60);

    await store.decide(read.approvalId, "allow");
    await store.awaitOutcome({ approvalId: read.approvalId, waitMs: 0 });
    await store.decide(unread.approvalId, "allow");
    await store.decide(oversized.approvalId, "allow");

    await expect(store.awaitOutcome({ approvalId: oversized.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: oversized.approvalId,
      status: "unknown",
      reason: APPROVAL_UNKNOWN_REASONS.RESULT_RETENTION_CAP
    });
    await expect(store.awaitOutcome({ approvalId: read.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: read.approvalId,
      status: "resolved",
      outcome: "approved",
      response: { ok: true, weight: 40 }
    });
    await expect(store.awaitOutcome({ approvalId: unread.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: unread.approvalId,
      status: "resolved",
      outcome: "approved",
      response: { ok: true, weight: 50 }
    });
  });

  it("does not treat a poll that saw the request pending as a delivered outcome", async () => {
    const { store } = createHarness({ ...weighedResponses, resultByteBudgetProvider: () => 100 });
    const first = admitWeighed(store, 60);
    const second = admitWeighed(store, 60);

    await store.awaitOutcome({ approvalId: first.approvalId, waitMs: 0 });
    await store.decide(first.approvalId, "allow");
    await store.decide(second.approvalId, "allow");

    await expect(store.awaitOutcome({ approvalId: first.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: first.approvalId,
      status: "resolved",
      outcome: "approved",
      response: { ok: true, weight: 60 }
    });
    await expect(store.awaitOutcome({ approvalId: second.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: second.approvalId,
      status: "unknown",
      reason: APPROVAL_UNKNOWN_REASONS.RESULT_RETENTION_CAP
    });
  });

  it("counts the retained bytes correctly after a displaced outcome later expires", async () => {
    const { store, clock } = createHarness({
      ...weighedResponses,
      resultByteBudgetProvider: () => 100
    });
    const first = admitWeighed(store, 60);
    const second = admitWeighed(store, 60);

    await store.decide(first.approvalId, "allow");
    await store.awaitOutcome({ approvalId: first.approvalId, waitMs: 0 });
    await store.decide(second.approvalId, "allow");
    await clock.advance(APPROVAL_RESULT_RETENTION_MS);

    const third = admitWeighed(store, 60);
    const fourth = admitWeighed(store, 60);
    await store.decide(third.approvalId, "allow");
    await store.decide(fourth.approvalId, "allow");

    await expect(store.awaitOutcome({ approvalId: fourth.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: fourth.approvalId,
      status: "unknown",
      reason: APPROVAL_UNKNOWN_REASONS.RESULT_RETENTION_CAP
    });
  });

  it("weighs a retained response in bytes rather than in string length", async () => {
    const response = { text: "ю".repeat(30) };
    const { store } = createHarness({
      execute: () => response,
      resultByteBudgetProvider: () => 50
    });
    const admission = admitRequest(store);

    await store.decide(admission.approvalId, "allow");

    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: admission.approvalId,
      status: "unknown",
      reason: APPROVAL_UNKNOWN_REASONS.RESULT_RETENTION_CAP
    });
  });

  it("frees the retained bytes when a stored outcome expires", async () => {
    const { store, clock } = createHarness({
      execute: (execution) => ({ ok: true, command: execution.command }),
      resultByteBudgetProvider: () => 60
    });
    const first = admitRequest(store, { command: "actor.update" });

    await store.decide(first.approvalId, "allow");
    await clock.advance(APPROVAL_RESULT_RETENTION_MS);

    const second = admitRequest(store, { command: "item.update" });
    await store.decide(second.approvalId, "allow");

    await expect(store.awaitOutcome({ approvalId: second.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: second.approvalId,
      status: "resolved",
      outcome: "approved",
      response: { ok: true, command: "item.update" }
    });
  });
});

describe("approval store queue view", () => {
  it("presents the oldest pending request and counts the rest", async () => {
    const { store } = createHarness();
    const first = admitRequest(store, { command: "actor.update" });
    const second = admitRequest(store, { command: "item.update" });
    admitRequest(store, { command: "scene.update" });

    expect(store.getQueueView()).toMatchObject({
      current: { approvalId: first.approvalId, command: "actor.update", state: "pending" },
      waitingCount: 2
    });

    await store.decide(first.approvalId, "deny");

    expect(store.getQueueView()).toMatchObject({
      current: { approvalId: second.approvalId, command: "item.update", state: "pending" },
      waitingCount: 1
    });
  });

  it("keeps the executing request current until it settles", async () => {
    const executor = createDeferred();
    const { store } = createHarness({ execute: () => executor.promise });
    const first = admitRequest(store, { command: "actor.update" });
    const second = admitRequest(store, { command: "item.update" });

    const allow = track(store.decide(first.approvalId, "allow"));
    await flush();

    expect(store.getQueueView()).toMatchObject({
      current: { approvalId: first.approvalId, state: "executing" },
      waitingCount: 1
    });

    executor.settle({ ok: true });
    await flush();
    expect(allow.settled).toBe(true);

    expect(store.getQueueView()).toMatchObject({
      current: { approvalId: second.approvalId, state: "pending" },
      waitingCount: 0
    });
  });

  it("empties when the last request settles", async () => {
    const { store, clock } = createHarness();
    const admission = admitRequest(store);

    await store.decide(admission.approvalId, "allow");

    expect(store.getQueueView()).toEqual({ current: null, waitingCount: 0 });
    expect(clock.liveTimers()).toBe(0);
  });

  it("publishes the queue view to subscribers until they unsubscribe", async () => {
    const { store } = createHarness();
    /** @type {any[]} */
    const views = [];
    const unsubscribe = store.subscribe((view) => views.push(view));

    const admission = admitRequest(store, { command: "actor.update" });
    await store.decide(admission.approvalId, "deny");
    unsubscribe();
    admitRequest(store, { command: "item.update" });

    expect(views).toEqual([
      {
        current: expect.objectContaining({ command: "actor.update", state: "pending" }),
        waitingCount: 0
      },
      { current: null, waitingCount: 0 }
    ]);
  });

  it("keeps its state consistent when a subscriber throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { store } = createHarness();
    store.subscribe(() => {
      throw new Error("subscriber exploded");
    });

    const admission = admitRequest(store);
    await store.decide(admission.approvalId, "deny");

    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: admission.approvalId,
      status: "resolved",
      outcome: "denied"
    });
  });

  it("drops every timer and answers parked waiters when it is cleared", async () => {
    const { store, clock } = createHarness();
    const admission = admitRequest(store);
    const poll = track(store.awaitOutcome({ approvalId: admission.approvalId }));
    await flush();

    store.clear();
    await flush();

    expect(poll.value).toEqual({
      approvalId: admission.approvalId,
      status: "unknown",
      reason: APPROVAL_UNKNOWN_REASONS.STORE_CLEARED
    });
    expect(store.getQueueView()).toEqual({ current: null, waitingCount: 0 });
    expect(clock.liveTimers()).toBe(0);
    await expect(store.awaitOutcome({ approvalId: admission.approvalId, waitMs: 0 })).resolves.toEqual({
      approvalId: admission.approvalId,
      status: "unknown"
    });
  });

  it("admits again after a clear, so the budget is released with the state", () => {
    const { store } = createHarness({ pendingByteBudgetProvider: () => 1_000, pendingMax: 1 });
    admitRequest(store, { requestBytes: 1_000 });

    store.clear();

    expect(admitRequest(store, { requestBytes: 1_000 }).approvalId).toMatch(APPROVAL_ID_PATTERN);
  });
});
