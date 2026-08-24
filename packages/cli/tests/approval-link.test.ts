import {
  APPROVAL_RESULT_RETENTION_MS,
  ERROR_CODES,
  createCommandResponse,
  createErrorResponse,
  createProtocolError
} from "@fvtt-world-cli/protocol";
import { describe, expect, it } from "vitest";

import {
  ApprovalIdempotencyLinks,
  readApprovalSettlement,
  readPendingApprovalDetails
} from "../src/bridge/approval-link.js";
import type { CommandResponseEnvelope } from "../src/transport-util.js";

const APPROVAL_ID = "CCCCCCCCCCCCCCCCCCCCCC";
const EXPIRES_AT = 1_000_000;

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

  it("bounds how many links it holds", () => {
    const links = new ApprovalIdempotencyLinks({ maxEntries: 2, now: () => 0 });
    for (const index of [1, 2, 3]) {
      links.record({
        key: `key-${index}`,
        fingerprint: `fp-${index}`,
        approvalId: `approval-${index}`,
        expiresAt: EXPIRES_AT,
        pendingResponse: pendingResponse(`approval-${index}`)
      });
    }

    expect(links.size).toBe(2);
    expect(links.lookup("key-1", "fp-1")).toEqual({ status: "miss" });
    expect(links.lookup("key-3", "fp-3")).toMatchObject({ status: "pending" });
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

  it("records a link only from a pending answer it can bound in time", () => {
    expect(readPendingApprovalDetails(pendingResponse())).toEqual({
      approvalId: APPROVAL_ID,
      expiresAt: EXPIRES_AT
    });
    expect(readPendingApprovalDetails(pendingResponse(APPROVAL_ID, "soon"))).toBeNull();
    expect(readPendingApprovalDetails(delivered())).toBeNull();
  });
});
