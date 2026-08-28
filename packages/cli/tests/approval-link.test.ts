import {
  APPROVAL_RESULT_RETENTION_MS,
  ERROR_CODES,
  createCommandResponse,
  createErrorResponse,
  createProtocolError
} from "@fvtt-world-cli/protocol";
import { describe, expect, it } from "vitest";

import { ApprovalIdempotencyLinks, readApprovalSettlement } from "../src/bridge/approval-link.js";
import { readPendingApprovalDetails, type CommandResponseEnvelope } from "../src/transport-util.js";

const APPROVAL_ID = "CCCCCCCCCCCCCCCCCCCCCC";
const EXPIRES_AT = 1_000_000;
const RETAIN_MS = 600_000;

function pendingResponse(approvalId = APPROVAL_ID, expiresAt: unknown = EXPIRES_AT) {
  return createErrorResponse({
    id: "req-1",
    error: createProtocolError({
      code: ERROR_CODES.APPROVAL_PENDING,
      message: "needs approval",
      details: { approvalId, expiresAt, command: "scene.delete" }
    })
  });
}

function awaitReport(result: Record<string, unknown>) {
  return createCommandResponse({ id: "poll", result });
}

function delivered() {
  return createCommandResponse({ id: APPROVAL_ID, result: { id: "s1" } });
}

function createLinks(now: () => number = () => 0) {
  const links = new ApprovalIdempotencyLinks({ now });
  links.record({
    key: "key-1",
    fingerprint: "fp-1",
    approvalId: APPROVAL_ID,
    expiresAt: EXPIRES_AT,
    pendingResponse: pendingResponse()
  });
  return links;
}

describe("approval idempotency links", () => {
  it("replays the pending answer to a byte-identical retry", () => {
    const links = createLinks();

    const lookup = links.lookup("key-1", "fp-1");

    expect(lookup).toMatchObject({ status: "pending", approvalId: APPROVAL_ID });
  });

  it("reports a conflict for the same key with different params", () => {
    const links = createLinks();

    expect(links.lookup("key-1", "fp-2")).toMatchObject({ status: "conflict" });
  });

  it("promotes an approved response once and then forgets the link", () => {
    const links = createLinks();
    const settlement = readApprovalSettlement(
      "approval.await",
      awaitReport({ approvalId: APPROVAL_ID, status: "resolved", outcome: "approved", response: delivered() })
    );

    expect(links.settle(settlement)).toEqual({ key: "key-1", fingerprint: "fp-1" });
    expect(links.settle(settlement)).toBeNull();
    expect(links.lookup("key-1", "fp-1")).toEqual({ status: "miss" });
  });

  it("promotes a handler error, because an approved command started running", () => {
    const links = createLinks();
    const handlerError = createErrorResponse({
      id: APPROVAL_ID,
      error: createProtocolError({ code: ERROR_CODES.SCENE_NOT_FOUND, message: "gone" })
    });

    const settlement = readApprovalSettlement(
      "approval.await",
      awaitReport({
        approvalId: APPROVAL_ID,
        status: "resolved",
        outcome: "approved",
        response: handlerError
      })
    );

    expect(settlement).toMatchObject({ kind: "promote" });
    expect(links.settle(settlement)).toEqual({ key: "key-1", fingerprint: "fp-1" });
  });

  it.each(["denied", "timeout", "cancelled"])("frees the key after a %s outcome", (outcome) => {
    const links = createLinks();

    links.settle(
      readApprovalSettlement(
        "approval.await",
        awaitReport({ approvalId: APPROVAL_ID, status: "resolved", outcome })
      )
    );

    expect(links.lookup("key-1", "fp-1")).toEqual({ status: "miss" });
  });

  it("frees the key after a confirmed cancellation", () => {
    const links = createLinks();

    links.settle(
      readApprovalSettlement("approval.cancel", awaitReport({ approvalId: APPROVAL_ID, status: "cancelled" }))
    );

    expect(links.lookup("key-1", "fp-1")).toEqual({ status: "miss" });
  });

  it("keeps an indeterminate marker when the cancellation could not be confirmed", () => {
    const links = createLinks();

    links.settle(
      readApprovalSettlement("approval.cancel", awaitReport({ approvalId: APPROVAL_ID, status: "executing" }))
    );

    expect(links.lookup("key-1", "fp-1")).toMatchObject({
      status: "indeterminate",
      approvalId: APPROVAL_ID
    });
  });

  it("leaves the link whole when a cancellation lost to a decision already taken", () => {
    const links = createLinks();

    links.settle(
      readApprovalSettlement("approval.cancel", awaitReport({ approvalId: APPROVAL_ID, status: "resolved" }))
    );

    expect(links.lookup("key-1", "fp-1")).toMatchObject({ status: "pending", approvalId: APPROVAL_ID });

    links.settle(
      readApprovalSettlement(
        "approval.await",
        awaitReport({ approvalId: APPROVAL_ID, status: "resolved", outcome: "denied" })
      )
    );

    expect(links.lookup("key-1", "fp-1")).toEqual({ status: "miss" });
  });

  it("keeps an indeterminate marker when the approval id is no longer known", () => {
    const links = createLinks();
    const unknown = createErrorResponse({
      id: "poll",
      error: createProtocolError({
        code: ERROR_CODES.APPROVAL_UNKNOWN,
        message: "gone",
        details: { approvalId: APPROVAL_ID }
      })
    });

    links.settle(readApprovalSettlement("approval.await", unknown));

    expect(links.lookup("key-1", "fp-1")).toMatchObject({ status: "indeterminate" });
  });

  it("keeps the key usable again once the link has expired", () => {
    let clock = 0;
    const links = createLinks(() => clock);

    clock = EXPIRES_AT + APPROVAL_RESULT_RETENTION_MS;
    expect(links.lookup("key-1", "fp-1")).toEqual({ status: "miss" });
    expect(links.size).toBe(0);
  });

  it("refuses a reservation once the bound is reached instead of evicting an approval link", () => {
    const links = new ApprovalIdempotencyLinks({ maxEntries: 2, now: () => 0 });
    for (const index of [1, 2]) {
      expect(links.reserve({ key: `key-${index}`, fingerprint: `fp-${index}`, retainMs: RETAIN_MS })).toBe(
        true
      );
      links.record({
        key: `key-${index}`,
        fingerprint: `fp-${index}`,
        approvalId: `approval-${index}`,
        expiresAt: EXPIRES_AT,
        pendingResponse: pendingResponse(`approval-${index}`)
      });
    }

    expect(links.reserve({ key: "key-3", fingerprint: "fp-3", retainMs: RETAIN_MS })).toBe(false);
    expect(links.size).toBe(2);
    expect(links.lookup("key-1", "fp-1")).toMatchObject({ status: "pending" });
    expect(links.lookup("key-3", "fp-3")).toEqual({ status: "miss" });
  });

  it("refuses a reservation rather than evicting a lost-in-flight key", () => {
    const links = new ApprovalIdempotencyLinks({ maxEntries: 2, now: () => 0 });
    for (const index of [1, 2]) {
      links.reserve({ key: `key-${index}`, fingerprint: `fp-${index}`, retainMs: RETAIN_MS });
      links.recordLostInFlight({ key: `key-${index}`, fingerprint: `fp-${index}`, retainMs: RETAIN_MS });
    }

    expect(links.reserve({ key: "key-3", fingerprint: "fp-3", retainMs: RETAIN_MS })).toBe(false);
    expect(links.lookup("key-1", "fp-1")).toEqual({ status: "lost-in-flight" });
    expect(links.lookup("key-2", "fp-2")).toEqual({ status: "lost-in-flight" });
  });

  it("tombstones a reserved key at the bound without displacing the other kind of state", () => {
    const links = new ApprovalIdempotencyLinks({ maxEntries: 2, now: () => 0 });
    links.reserve({ key: "key-1", fingerprint: "fp-1", retainMs: RETAIN_MS });
    links.record({
      key: "key-1",
      fingerprint: "fp-1",
      approvalId: APPROVAL_ID,
      expiresAt: EXPIRES_AT,
      pendingResponse: pendingResponse()
    });
    expect(links.reserve({ key: "key-2", fingerprint: "fp-2", retainMs: RETAIN_MS })).toBe(true);

    expect(links.recordLostInFlight({ key: "key-2", fingerprint: "fp-2", retainMs: RETAIN_MS })).toBe(true);
    expect(links.size).toBe(2);
    expect(links.lookup("key-1", "fp-1")).toMatchObject({ status: "pending" });
    expect(links.lookup("key-2", "fp-2")).toEqual({ status: "lost-in-flight" });
  });

  it("keeps a reserved key invisible until it settles and reusable once released", () => {
    const links = new ApprovalIdempotencyLinks({ maxEntries: 1, now: () => 0 });
    links.reserve({ key: "key-1", fingerprint: "fp-1", retainMs: RETAIN_MS });

    expect(links.lookup("key-1", "fp-1")).toEqual({ status: "miss" });
    expect(links.reserve({ key: "key-2", fingerprint: "fp-2", retainMs: RETAIN_MS })).toBe(false);

    links.release("key-1");
    expect(links.size).toBe(0);
    expect(links.reserve({ key: "key-2", fingerprint: "fp-2", retainMs: RETAIN_MS })).toBe(true);
  });

  it("refuses same-key and different-fingerprint retries of a lost key until the retention expires", () => {
    let clock = 0;
    const links = new ApprovalIdempotencyLinks({ maxEntries: 2, now: () => clock });
    links.reserve({ key: "key-1", fingerprint: "fp-1", retainMs: RETAIN_MS });
    links.recordLostInFlight({ key: "key-1", fingerprint: "fp-1", retainMs: RETAIN_MS });

    expect(links.lookup("key-1", "fp-1")).toEqual({ status: "lost-in-flight" });
    expect(links.lookup("key-1", "other-fp")).toEqual({ status: "conflict", approvalId: null });

    clock = RETAIN_MS;
    expect(links.lookup("key-1", "fp-1")).toEqual({ status: "miss" });
    expect(links.reserve({ key: "key-1", fingerprint: "fp-1", retainMs: RETAIN_MS })).toBe(true);
  });

  it("ignores responses that carry no approval settlement", () => {
    for (const [command, envelope] of [
      ["scene.delete", delivered()],
      ["approval.await", awaitReport({ approvalId: APPROVAL_ID, status: "pending" })],
      [
        "approval.cancel",
        createErrorResponse({ id: "x", error: createProtocolError({ code: "X", message: "y" }) })
      ]
    ] as Array<[string, CommandResponseEnvelope]>) {
      expect(readApprovalSettlement(command, envelope)).toEqual({ kind: "none" });
    }
  });

  it("reads a pending approval only from details a waiter could act on", () => {
    expect(readPendingApprovalDetails(pendingResponse())).toEqual({
      approvalId: APPROVAL_ID,
      expiresAt: EXPIRES_AT
    });
    expect(readPendingApprovalDetails(pendingResponse(APPROVAL_ID, "soon"))).toBeNull();
    expect(readPendingApprovalDetails(pendingResponse(APPROVAL_ID, 1e20))).toBeNull();
    expect(readPendingApprovalDetails(pendingResponse("short"))).toBeNull();
    expect(readPendingApprovalDetails(delivered())).toBeNull();
  });
});
