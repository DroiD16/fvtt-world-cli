import {
  APPROVAL_AWAIT_PARK_CAP_MS,
  ERROR_CODES,
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  createCommandResponse,
  createErrorResponse,
  createProtocolError
} from "@fvtt-world-cli/protocol";
import { describe, expect, it } from "vitest";

import {
  APPROVAL_AWAIT_CLIENT_TIMEOUT_FLOOR_MS,
  APPROVAL_EMPTY_POLL_DELAY_MS,
  APPROVAL_RETRY_MARGIN_MS,
  awaitApprovalOutcome,
  type ApprovalSendRequest,
  type ApprovalSignalScope
} from "../src/approval-wait.js";
import { DaemonTransportError, type CommandResponseEnvelope } from "../src/transport-util.js";

const APPROVAL_ID = "AAAAAAAAAAAAAAAAAAAAAA";
const EXPIRES_AT = 3_600_000;
const COMMAND = "scene.delete";

function pendingEnvelope(details: Record<string, unknown> = {}): CommandResponseEnvelope {
  return createErrorResponse({
    id: "req-1",
    error: createProtocolError({
      code: ERROR_CODES.APPROVAL_PENDING,
      message: `Command ${COMMAND} needs an approval`,
      details: { approvalId: APPROVAL_ID, expiresAt: EXPIRES_AT, command: COMMAND, ...details }
    })
  });
}

function awaitPending(): CommandResponseEnvelope {
  return createCommandResponse({
    id: "poll",
    result: { approvalId: APPROVAL_ID, status: "pending", expiresAt: EXPIRES_AT }
  });
}

function awaitResolved(outcome: string, response?: unknown): CommandResponseEnvelope {
  return createCommandResponse({
    id: "poll",
    result: {
      approvalId: APPROVAL_ID,
      status: "resolved",
      outcome,
      ...(response === undefined ? {} : { response })
    }
  });
}

function deliveredSuccess(): CommandResponseEnvelope {
  return createCommandResponse({ id: APPROVAL_ID, result: { deleted: true, sceneId: "s1" } });
}

function deliveredHandlerError(): CommandResponseEnvelope {
  return createErrorResponse({
    id: APPROVAL_ID,
    error: createProtocolError({ code: ERROR_CODES.SCENE_NOT_FOUND, message: "No scene s1" })
  });
}

function transportEnvelope(code: string): CommandResponseEnvelope {
  return createErrorResponse({
    id: "poll",
    error: createProtocolError({ code, message: `transport said ${code}` })
  });
}

type Step = CommandResponseEnvelope | Error | (() => Promise<CommandResponseEnvelope>);

function createHarness(steps: Step[]) {
  const calls: ApprovalSendRequest[] = [];
  const sleeps: number[] = [];
  const stderrChunks: string[] = [];
  let clock = 0;

  return {
    calls,
    sleeps,
    stderr: {
      write(chunk: string) {
        stderrChunks.push(chunk);
      },
      read() {
        return stderrChunks.join("");
      },
      chunks: stderrChunks
    },
    advanceTo(value: number) {
      clock = value;
    },
    options: {
      send: async (request: ApprovalSendRequest) => {
        calls.push(request);
        const step = steps.shift();
        if (step === undefined) throw new Error(`unscripted send of ${request.command}`);
        if (step instanceof Error) throw step;
        if (typeof step === "function") return await step();
        return step;
      },
      now: () => clock,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      }
    }
  };
}

function createSignalScope() {
  const listeners = new Set<() => void>();
  const scope: ApprovalSignalScope = {
    on(_signal, listener) {
      listeners.add(listener);
      return scope;
    },
    off(_signal, listener) {
      listeners.delete(listener);
      return scope;
    }
  };
  return {
    scope,
    fire() {
      for (const listener of [...listeners]) listener();
    },
    get size() {
      return listeners.size;
    }
  };
}

describe("approval wait", () => {
  it("returns the delivered response of an allowed command unchanged", async () => {
    const delivered = deliveredSuccess();
    const harness = createHarness([awaitResolved("approved", delivered)]);

    const envelope = await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options
    });

    expect(envelope).toEqual(delivered);
  });

  it("returns a delivered handler error as that handler error", async () => {
    const delivered = deliveredHandlerError();
    const harness = createHarness([awaitResolved("approved", delivered)]);

    const envelope = await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options
    });

    expect(envelope).toEqual(delivered);
    expect(envelope.error?.code).toBe(ERROR_CODES.SCENE_NOT_FOUND);
  });

  it("reports a denial as a terminal outcome that never executed", async () => {
    const harness = createHarness([awaitResolved("denied")]);

    const envelope = await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options
    });

    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe(ERROR_CODES.APPROVAL_DENIED);
    expect(envelope.error?.details).toEqual({ approvalId: APPROVAL_ID, command: COMMAND });
    expect(envelope.error?.message).toContain("It never ran and no world state changed");
  });

  it("reports an expired approval as a terminal outcome that never executed", async () => {
    const harness = createHarness([awaitResolved("timeout")]);

    const envelope = await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options
    });

    expect(envelope.error?.code).toBe(ERROR_CODES.APPROVAL_TIMEOUT);
    expect(envelope.error?.details).toEqual({ approvalId: APPROVAL_ID, command: COMMAND });
    expect(envelope.error?.message).toContain("check that a GM is present");
  });

  it("reports a cancellation decided by the store as guaranteed not executed", async () => {
    const harness = createHarness([awaitResolved("cancelled")]);

    const envelope = await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options
    });

    expect(envelope.error?.code).toBe(ERROR_CODES.APPROVAL_CANCELLED);
    expect(envelope.error?.message).toContain("the command never ran and no world state changed");
  });

  it("surfaces an unknown approval id with its indeterminacy intact", async () => {
    const moduleError = createErrorResponse({
      id: "poll",
      error: createProtocolError({
        code: ERROR_CODES.APPROVAL_UNKNOWN,
        message: "no approval state; read the documents the command would have written",
        details: { approvalId: APPROVAL_ID, reason: "result-retention-cap" }
      })
    });
    const harness = createHarness([moduleError]);

    const envelope = await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options
    });

    expect(envelope).toEqual(moduleError);
    expect(envelope.error?.code).toBe(ERROR_CODES.APPROVAL_UNKNOWN);
  });

  it("treats an approved outcome without a delivered response as indeterminate", async () => {
    const harness = createHarness([awaitResolved("approved")]);

    const envelope = await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options
    });

    expect(envelope.error?.code).toBe(ERROR_CODES.APPROVAL_UNKNOWN);
    expect(envelope.error?.message).toContain("indeterminate");
  });

  it("parks repeatedly at the protocol cap and spaces empty polls", async () => {
    const harness = createHarness([
      awaitPending(),
      awaitPending(),
      awaitResolved("approved", deliveredSuccess())
    ]);

    await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options
    });

    expect(harness.calls).toHaveLength(3);
    for (const call of harness.calls) {
      expect(call.command).toBe("approval.await");
      expect(call.params).toEqual({ approvalId: APPROVAL_ID, waitMs: APPROVAL_AWAIT_PARK_CAP_MS });
      expect(call.timeoutMs).toBe(APPROVAL_AWAIT_CLIENT_TIMEOUT_FLOOR_MS);
    }
    expect(harness.sleeps).toEqual([APPROVAL_EMPTY_POLL_DELAY_MS, APPROVAL_EMPTY_POLL_DELAY_MS]);
  });

  it("keeps a user timeout above the park floor for each poll", async () => {
    const harness = createHarness([awaitResolved("denied")]);

    await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      timeoutMs: 90_000,
      ...harness.options
    });

    expect(harness.calls[0].timeoutMs).toBe(90_000);
  });

  it("retries a transient transport failure until the daemon answers", async () => {
    const harness = createHarness([
      new DaemonTransportError(ERROR_CODES.DAEMON_UNAVAILABLE, "connection refused"),
      transportEnvelope(ERROR_CODES.BRIDGE_DISCONNECTED),
      awaitResolved("approved", deliveredSuccess())
    ]);

    const envelope = await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options
    });

    expect(envelope).toEqual(deliveredSuccess());
    expect(harness.sleeps).toEqual([500, 1_000]);
  });

  it("surfaces the last transport failure once the approval deadline has passed", async () => {
    const harness = createHarness([
      transportEnvelope(ERROR_CODES.BRIDGE_NOT_READY),
      transportEnvelope(ERROR_CODES.DAEMON_UNAVAILABLE)
    ]);
    harness.advanceTo(EXPIRES_AT);

    const first = awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options,
      sleep: async (ms: number) => {
        harness.sleeps.push(ms);
        harness.advanceTo(EXPIRES_AT + APPROVAL_RETRY_MARGIN_MS + 1);
      }
    });

    const envelope = await first;
    expect(envelope.error?.code).toBe(ERROR_CODES.DAEMON_UNAVAILABLE);
    expect(harness.calls).toHaveLength(2);
  });

  it("keeps polling when the daemon times the park out before the GM decides", async () => {
    const harness = createHarness([
      transportEnvelope(ERROR_CODES.BRIDGE_TIMEOUT),
      transportEnvelope(ERROR_CODES.BRIDGE_TIMEOUT),
      awaitResolved("approved", deliveredSuccess())
    ]);

    const envelope = await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options
    });

    expect(envelope).toEqual(deliveredSuccess());
    expect(harness.calls).toHaveLength(3);
  });

  it("stops re-polling a timing-out park once the approval deadline has passed", async () => {
    const harness = createHarness([
      transportEnvelope(ERROR_CODES.BRIDGE_TIMEOUT),
      transportEnvelope(ERROR_CODES.BRIDGE_TIMEOUT)
    ]);
    harness.advanceTo(EXPIRES_AT);

    const envelope = await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options,
      sleep: async (ms: number) => {
        harness.sleeps.push(ms);
        harness.advanceTo(EXPIRES_AT + APPROVAL_RETRY_MARGIN_MS + 1);
      }
    });

    expect(envelope.error?.code).toBe(ERROR_CODES.BRIDGE_TIMEOUT);
    expect(harness.calls).toHaveLength(2);
  });

  it("surfaces a non-transient error immediately", async () => {
    const unauthorized = createErrorResponse({
      id: "poll",
      error: createProtocolError({ code: ERROR_CODES.UNAUTHORIZED, message: "pair this client" })
    });
    const harness = createHarness([unauthorized]);

    const envelope = await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options
    });

    expect(envelope).toEqual(unauthorized);
    expect(harness.calls).toHaveLength(1);
  });

  it("replaces a dead connection through the reconnect seam before retrying", async () => {
    const harness = createHarness([
      new DaemonTransportError(ERROR_CODES.DAEMON_UNAVAILABLE, "closed"),
      awaitResolved("approved", deliveredSuccess())
    ]);
    let reconnects = 0;

    await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      reconnect: async () => {
        reconnects += 1;
      },
      ...harness.options
    });

    expect(reconnects).toBe(1);
  });

  it("reports a confirmed cancellation as guaranteed not executed", async () => {
    const signals = createSignalScope();
    const harness = createHarness([
      () => new Promise<CommandResponseEnvelope>(() => {}),
      createCommandResponse({ id: "cancel", result: { approvalId: APPROVAL_ID, status: "cancelled" } })
    ]);

    const pending = awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      signalScope: signals.scope,
      ...harness.options
    });
    signals.fire();
    const envelope = await pending;

    expect(harness.calls[1]).toEqual({
      command: "approval.cancel",
      params: { approvalId: APPROVAL_ID },
      timeoutMs: 60_000
    });
    expect(envelope.error?.code).toBe(ERROR_CODES.APPROVAL_CANCELLED);
    expect(signals.size).toBe(0);
  });

  it("never claims a cancellation the GM client could not confirm", async () => {
    const signals = createSignalScope();
    const harness = createHarness([
      () => new Promise<CommandResponseEnvelope>(() => {}),
      createCommandResponse({ id: "cancel", result: { approvalId: APPROVAL_ID, status: "executing" } })
    ]);

    const pending = awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      signalScope: signals.scope,
      ...harness.options
    });
    signals.fire();
    const envelope = await pending;

    expect(envelope.error?.code).toBe(ERROR_CODES.APPROVAL_UNKNOWN);
    expect(envelope.error?.message).toContain("could not be confirmed");
    expect(envelope.error?.details).toMatchObject({ cancellation: "unconfirmed", status: "executing" });
    expect(signals.size).toBe(0);
  });

  it("reads the verdict a cancellation lost to instead of reporting it indeterminate", async () => {
    const signals = createSignalScope();
    const harness = createHarness([
      () => new Promise<CommandResponseEnvelope>(() => {}),
      createCommandResponse({ id: "cancel", result: { approvalId: APPROVAL_ID, status: "resolved" } }),
      awaitResolved("denied")
    ]);

    const pending = awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      signalScope: signals.scope,
      ...harness.options
    });
    signals.fire();
    const envelope = await pending;

    expect(envelope.error?.code).toBe(ERROR_CODES.APPROVAL_DENIED);
    expect(harness.calls[2]).toMatchObject({
      command: "approval.await",
      params: { approvalId: APPROVAL_ID, waitMs: 0 }
    });
  });

  it("falls back to the indeterminate outcome when the follow-up poll cannot read the verdict", async () => {
    const signals = createSignalScope();
    const harness = createHarness([
      () => new Promise<CommandResponseEnvelope>(() => {}),
      createCommandResponse({ id: "cancel", result: { approvalId: APPROVAL_ID, status: "resolved" } }),
      transportEnvelope(ERROR_CODES.DAEMON_UNAVAILABLE)
    ]);

    const pending = awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      signalScope: signals.scope,
      ...harness.options
    });
    signals.fire();
    const envelope = await pending;

    expect(envelope.error?.code).toBe(ERROR_CODES.APPROVAL_UNKNOWN);
    expect(envelope.error?.details).toMatchObject({ cancellation: "unconfirmed", status: "resolved" });
  });

  it("never claims a cancellation the daemon never received", async () => {
    const signals = createSignalScope();
    const harness = createHarness([
      () => new Promise<CommandResponseEnvelope>(() => {}),
      new DaemonTransportError(ERROR_CODES.DAEMON_UNAVAILABLE, "connection refused")
    ]);

    const pending = awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      signalScope: signals.scope,
      ...harness.options
    });
    signals.fire();
    const envelope = await pending;

    expect(envelope.error?.code).toBe(ERROR_CODES.APPROVAL_UNKNOWN);
    expect(envelope.error?.message).toContain("could not be reached");
    expect(signals.size).toBe(0);
  });

  it("stops the poll it outran, so no connection outlives the cancellation", async () => {
    const signals = createSignalScope();
    const abortStates: boolean[] = [];
    const harness = createHarness([
      () => new Promise<CommandResponseEnvelope>(() => {}),
      createCommandResponse({ id: "cancel", result: { approvalId: APPROVAL_ID, status: "cancelled" } })
    ]);
    const send = async (request: ApprovalSendRequest) => {
      if (request.signal) request.signal.addEventListener("abort", () => abortStates.push(true));
      return await harness.options.send(request);
    };

    const pending = awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      signalScope: signals.scope,
      ...harness.options,
      send
    });
    signals.fire();
    await pending;

    expect(abortStates).toEqual([true]);
  });

  it("answers a cancellation taken while the retry backoff is still waiting", async () => {
    const signals = createSignalScope();
    let releaseSleep: () => void = () => {};
    const harness = createHarness([
      transportEnvelope(ERROR_CODES.DAEMON_UNAVAILABLE),
      createCommandResponse({ id: "cancel", result: { approvalId: APPROVAL_ID, status: "cancelled" } })
    ]);

    const pending = awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      signalScope: signals.scope,
      ...harness.options,
      sleep: () =>
        new Promise<void>((resolve) => {
          releaseSleep = resolve;
        }),
      reconnect: async () => {}
    });

    await Promise.resolve();
    await Promise.resolve();
    signals.fire();
    const envelope = await pending;
    releaseSleep();

    expect(envelope.error?.code).toBe(ERROR_CODES.APPROVAL_CANCELLED);
    expect(harness.calls[1].command).toBe("approval.cancel");
  });

  it("tells the caller a cancellation was requested", async () => {
    const signals = createSignalScope();
    const harness = createHarness([
      () => new Promise<CommandResponseEnvelope>(() => {}),
      createCommandResponse({ id: "cancel", result: { approvalId: APPROVAL_ID, status: "cancelled" } })
    ]);
    let requested = false;

    const pending = awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      signalScope: signals.scope,
      onCancelRequested: () => {
        requested = true;
      },
      ...harness.options
    });
    signals.fire();
    await pending;

    expect(requested).toBe(true);
  });

  it("leaves the next interrupt to the process while a cancellation is still in flight", async () => {
    const signals = createSignalScope();
    const harness = createHarness([
      () => new Promise<CommandResponseEnvelope>(() => {}),
      () => new Promise<CommandResponseEnvelope>(() => {})
    ]);

    void awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      signalScope: signals.scope,
      ...harness.options
    });
    signals.fire();

    expect(signals.size).toBe(0);
    expect(harness.calls[1].command).toBe("approval.cancel");
  });

  it("leaves no signal listener behind on the success path", async () => {
    const harness = createHarness([awaitResolved("approved", deliveredSuccess())]);
    const before = process.listenerCount("SIGINT");

    await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options
    });

    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("returns the original envelope when the pending details cannot drive a wait", async () => {
    for (const broken of [
      { approvalId: "short" },
      { expiresAt: "soon" },
      { approvalId: undefined },
      { expiresAt: 1e20 }
    ]) {
      const harness = createHarness([]);
      const original = pendingEnvelope(broken);

      const envelope = await awaitApprovalOutcome({
        pendingResponse: original,
        stderr: harness.stderr,
        ...harness.options
      });

      expect(envelope).toBe(original);
      expect(harness.calls).toHaveLength(0);
      expect(harness.stderr.chunks).toHaveLength(0);
    }
  });

  it("announces the wait once on stderr and writes nothing else", async () => {
    const harness = createHarness([awaitPending(), awaitResolved("approved", deliveredSuccess())]);

    await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options
    });

    expect(harness.stderr.chunks).toHaveLength(1);
    expect(harness.stderr.read()).toBe(
      `Waiting for GM approval in Foundry (command ${COMMAND}, expires ${new Date(EXPIRES_AT).toISOString()}). Press Ctrl+C to request cancellation.\n`
    );
  });

  it("keeps a delivered response addressed by the module", async () => {
    const harness = createHarness([awaitResolved("approved", deliveredSuccess())]);

    const envelope = await awaitApprovalOutcome({
      pendingResponse: pendingEnvelope(),
      stderr: harness.stderr,
      ...harness.options
    });

    expect(envelope.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(envelope.type).toBe(MESSAGE_TYPES.COMMAND_RESPONSE);
  });
});
