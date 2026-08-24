import { APPROVAL_AWAIT_PARK_CAP_MS, ERROR_CODES, MESSAGE_TYPES } from "@fvtt-world-cli/protocol";

import { DEFAULT_CLIENT_TIMEOUT_MS } from "./bridge/session-store.js";
import { localErrorEnvelope, toTransportErrorEnvelope } from "./errors.js";
import {
  APPROVAL_AWAIT_COMMAND,
  APPROVAL_CANCEL_COMMAND,
  isCommandResponseEnvelope,
  type CommandResponseEnvelope
} from "./transport-util.js";

export const APPROVAL_AWAIT_CLIENT_TIMEOUT_FLOOR_MS = APPROVAL_AWAIT_PARK_CAP_MS + 5_000;
export const APPROVAL_EMPTY_POLL_DELAY_MS = 250;
export const APPROVAL_RETRY_BASE_DELAY_MS = 500;
export const APPROVAL_RETRY_MAX_DELAY_MS = 5_000;
export const APPROVAL_RETRY_MARGIN_MS = 30_000;

const TRANSIENT_TRANSPORT_CODES: ReadonlySet<string> = new Set([
  ERROR_CODES.DAEMON_UNAVAILABLE,
  ERROR_CODES.BRIDGE_NOT_READY,
  ERROR_CODES.BRIDGE_DISCONNECTED
]);

const APPROVAL_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export interface ApprovalSendRequest {
  command: string;
  params: Record<string, unknown>;
  timeoutMs: number;
}

export interface ApprovalSignalScope {
  on(signal: "SIGINT", listener: () => void): unknown;
  off(signal: "SIGINT", listener: () => void): unknown;
}

export interface ApprovalWaitOptions {
  pendingResponse: CommandResponseEnvelope;
  send: (request: ApprovalSendRequest) => Promise<CommandResponseEnvelope>;
  stderr: { write(chunk: string): void };
  timeoutMs?: number;
  reconnect?: () => Promise<void>;
  onCancelRequested?: () => void;
  signalScope?: ApprovalSignalScope;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface PendingApproval {
  approvalId: string;
  expiresAt: number;
  command: string;
}

type WaitStep =
  | { kind: "settled"; envelope: CommandResponseEnvelope }
  | { kind: "pending" }
  | { kind: "transport"; envelope: CommandResponseEnvelope };

function readPendingApproval(response: CommandResponseEnvelope): PendingApproval | null {
  if (response.error?.code !== ERROR_CODES.APPROVAL_PENDING) {
    return null;
  }

  const details = response.error.details ?? {};
  const approvalId = details.approvalId;
  const expiresAt = details.expiresAt;
  if (typeof approvalId !== "string" || !APPROVAL_ID_PATTERN.test(approvalId)) {
    return null;
  }
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    return null;
  }

  return {
    approvalId,
    expiresAt,
    command: typeof details.command === "string" ? details.command : "unknown"
  };
}

function describeTransportFailure(envelope: CommandResponseEnvelope): string {
  return `${envelope.error?.code ?? ERROR_CODES.INTERNAL_ERROR}: ${envelope.error?.message ?? "unknown error"}`;
}

export async function awaitApprovalOutcome({
  pendingResponse,
  send,
  stderr,
  timeoutMs,
  reconnect,
  onCancelRequested,
  signalScope = process,
  now = () => Date.now(),
  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
}: ApprovalWaitOptions): Promise<CommandResponseEnvelope> {
  const pending = readPendingApproval(pendingResponse);
  if (!pending) {
    return pendingResponse;
  }

  const { approvalId, expiresAt, command } = pending;
  const responseId = pendingResponse.id;
  const pollTimeoutMs = Math.max(timeoutMs ?? 0, APPROVAL_AWAIT_CLIENT_TIMEOUT_FLOOR_MS);
  const cancelTimeoutMs = timeoutMs ?? DEFAULT_CLIENT_TIMEOUT_MS;

  function terminal(code: string, message: string, details: Record<string, unknown>) {
    return { ...localErrorEnvelope(code, message, details), id: responseId };
  }

  function indeterminate(message: string, details: Record<string, unknown>) {
    return terminal(
      ERROR_CODES.APPROVAL_UNKNOWN,
      `${message} The outcome is indeterminate: command ${command} may never have started, may be running ` +
        "now, or may have completed and changed the world. Read the documents it would have written before " +
        "anything else, report what you found, and if you decide to send it again, send it under a fresh " +
        "idempotency key.",
      { approvalId, command, ...details }
    );
  }

  function outcomeEnvelope(outcome: string): CommandResponseEnvelope {
    if (outcome === "denied") {
      return terminal(
        ERROR_CODES.APPROVAL_DENIED,
        `The GM of this bridge denied command ${command}. It never ran and no world state changed: a denial ` +
          "is decided before execution starts, so nothing was partially applied. The verdict is terminal for " +
          "this invocation and is not a transient failure to retry in a loop. Report the denial to the user; " +
          "sending the same command again only makes sense once that human decision changes.",
        { approvalId, command }
      );
    }

    if (outcome === "timeout") {
      return terminal(
        ERROR_CODES.APPROVAL_TIMEOUT,
        `The approval for command ${command} expired before a GM decided it. It never ran and no world state ` +
          "changed: the expiry is decided before execution starts. The verdict is terminal for this " +
          "invocation. Before sending the command again, check that a GM is present at the Foundry client " +
          "holding this bridge and able to answer its approval window, and tell the user the decision is " +
          "waiting on them.",
        { approvalId, command }
      );
    }

    if (outcome === "cancelled") {
      return terminal(
        ERROR_CODES.APPROVAL_CANCELLED,
        `The approval for command ${command} was cancelled before the GM decided it. The cancellation won the ` +
          "decision, so the command never ran and no world state changed. The verdict is terminal for this " +
          "invocation, and sending the command again is safe: it asks the GM for a new approval.",
        { approvalId, command }
      );
    }

    return indeterminate(
      `The GM client reported an approval outcome this CLI does not understand (${outcome}).`,
      { outcome }
    );
  }

  function readAwaitResult(result: unknown): WaitStep {
    const report = (result ?? {}) as { status?: unknown; outcome?: unknown; response?: unknown };
    if (report.status === "pending") {
      return { kind: "pending" };
    }

    if (report.status !== "resolved") {
      return {
        kind: "settled",
        envelope: indeterminate("The GM client reported an approval status this CLI does not understand.", {
          status: typeof report.status === "string" ? report.status : null
        })
      };
    }

    if (report.outcome !== "approved") {
      return { kind: "settled", envelope: outcomeEnvelope(String(report.outcome)) };
    }

    if (!isCommandResponseEnvelope(report.response, [MESSAGE_TYPES.COMMAND_RESPONSE])) {
      return {
        kind: "settled",
        envelope: indeterminate("The GM allowed the command, but its response was not delivered.", {
          outcome: "approved"
        })
      };
    }

    return { kind: "settled", envelope: report.response };
  }

  async function pollOnce(): Promise<WaitStep> {
    let response: CommandResponseEnvelope;
    try {
      response = await send({
        command: APPROVAL_AWAIT_COMMAND,
        params: { approvalId, waitMs: APPROVAL_AWAIT_PARK_CAP_MS },
        timeoutMs: pollTimeoutMs
      });
    } catch (error) {
      return { kind: "transport", envelope: toTransportErrorEnvelope(error) };
    }

    if (response.ok) {
      return readAwaitResult(response.result);
    }

    if (TRANSIENT_TRANSPORT_CODES.has(response.error?.code ?? "")) {
      return { kind: "transport", envelope: response };
    }

    return { kind: "settled", envelope: response };
  }

  async function requestCancellation(): Promise<WaitStep> {
    let response: CommandResponseEnvelope;
    try {
      response = await send({
        command: APPROVAL_CANCEL_COMMAND,
        params: { approvalId },
        timeoutMs: cancelTimeoutMs
      });
    } catch (error) {
      return {
        kind: "settled",
        envelope: indeterminate(
          `Cancellation of command ${command} could not be confirmed: the GM client could not be reached ` +
            `(${describeTransportFailure(toTransportErrorEnvelope(error))}).`,
          { cancellation: "unconfirmed" }
        )
      };
    }

    if (!response.ok) {
      return {
        kind: "settled",
        envelope: indeterminate(
          `Cancellation of command ${command} could not be confirmed: the cancellation request itself failed ` +
            `(${describeTransportFailure(response)}).`,
          { cancellation: "unconfirmed" }
        )
      };
    }

    const status = (response.result as { status?: unknown } | undefined)?.status;
    if (status === "cancelled") {
      return { kind: "settled", envelope: outcomeEnvelope("cancelled") };
    }

    return {
      kind: "settled",
      envelope: indeterminate(
        `Cancellation of command ${command} could not be confirmed: the GM client answered ` +
          `"${String(status)}", so the decision had already left the cancellable state.`,
        { cancellation: "unconfirmed", status: typeof status === "string" ? status : null }
      )
    };
  }

  stderr.write(
    `Waiting for GM approval in Foundry (command ${command}, expires ${new Date(expiresAt).toISOString()}). ` +
      "Press Ctrl+C to request cancellation.\n"
  );

  let settleCancellation: (step: WaitStep) => void = () => {};
  const cancellation = new Promise<WaitStep>((resolve) => {
    settleCancellation = resolve;
  });
  let cancelling = false;

  function onSignal() {
    if (cancelling) {
      return;
    }
    cancelling = true;
    onCancelRequested?.();
    void requestCancellation().then(settleCancellation);
  }

  signalScope.on("SIGINT", onSignal);

  try {
    let retryDelayMs = APPROVAL_RETRY_BASE_DELAY_MS;

    for (;;) {
      const step = await Promise.race([pollOnce(), cancellation]);

      if (step.kind === "settled") {
        return step.envelope;
      }

      if (step.kind === "pending") {
        retryDelayMs = APPROVAL_RETRY_BASE_DELAY_MS;
        await sleep(APPROVAL_EMPTY_POLL_DELAY_MS);
        continue;
      }

      if (now() > expiresAt + APPROVAL_RETRY_MARGIN_MS) {
        return step.envelope;
      }

      await sleep(retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, APPROVAL_RETRY_MAX_DELAY_MS);

      if (reconnect) {
        try {
          await reconnect();
        } catch (error) {
          if (now() > expiresAt + APPROVAL_RETRY_MARGIN_MS) {
            return toTransportErrorEnvelope(error);
          }
        }
      }
    }
  } finally {
    signalScope.off("SIGINT", onSignal);
  }
}
