import { APPROVAL_RESULT_RETENTION_MS, ERROR_CODES, MESSAGE_TYPES } from "@fvtt-world-cli/protocol";

import {
  APPROVAL_AWAIT_COMMAND,
  APPROVAL_CANCEL_COMMAND,
  isCommandResponseEnvelope,
  readApprovalId,
  type CommandResponseEnvelope
} from "../transport-util.js";

const DEFAULT_MAX_ENTRIES = 1_000;

interface ApprovalLink {
  key: string;
  kind: "reserved" | "link" | "lost";
  fingerprint: string;
  approvalId: string | null;
  pendingResponse: CommandResponseEnvelope | null;
  expiresAt: number;
}

export type ApprovalLinkLookup =
  | { status: "miss" }
  | { status: "pending"; approvalId: string; response: CommandResponseEnvelope }
  | { status: "conflict"; approvalId: string | null }
  | { status: "indeterminate"; approvalId: string }
  | { status: "lost-in-flight" };

export type ApprovalReservation = { ok: true } | { ok: false; reason: "full" | "conflict" };

export type ApprovalSettlement =
  | { kind: "none" }
  | { kind: "promote"; approvalId: string; response: CommandResponseEnvelope }
  | { kind: "clear"; approvalId: string }
  | { kind: "indeterminate"; approvalId: string };

export interface ApprovalLinkOptions {
  maxEntries?: number;
  retentionMs?: number;
  now?: () => number;
}

function settlementForAwait(envelope: CommandResponseEnvelope): ApprovalSettlement {
  if (!envelope.ok) {
    const approvalId = readApprovalId(envelope.error?.details?.approvalId);
    return envelope.error?.code === ERROR_CODES.APPROVAL_UNKNOWN && approvalId
      ? { kind: "indeterminate", approvalId }
      : { kind: "none" };
  }

  const report = (envelope.result ?? {}) as { approvalId?: unknown; status?: unknown; outcome?: unknown };
  const approvalId = readApprovalId(report.approvalId);
  if (!approvalId || report.status !== "resolved") {
    return { kind: "none" };
  }

  if (report.outcome !== "approved") {
    return { kind: "clear", approvalId };
  }

  const response = (report as { response?: unknown }).response;
  return isCommandResponseEnvelope(response, [MESSAGE_TYPES.COMMAND_RESPONSE])
    ? { kind: "promote", approvalId, response }
    : { kind: "indeterminate", approvalId };
}

function settlementForCancel(envelope: CommandResponseEnvelope): ApprovalSettlement {
  if (!envelope.ok) {
    return { kind: "none" };
  }

  const report = (envelope.result ?? {}) as { approvalId?: unknown; status?: unknown };
  const approvalId = readApprovalId(report.approvalId);
  if (!approvalId) {
    return { kind: "none" };
  }

  if (report.status === "cancelled") {
    return { kind: "clear", approvalId };
  }

  // Still readable through approval.await, so the link stays whole for that poll to settle.
  return report.status === "resolved" ? { kind: "none" } : { kind: "indeterminate", approvalId };
}

export function readApprovalSettlement(
  command: string | null,
  envelope: CommandResponseEnvelope
): ApprovalSettlement {
  if (command === APPROVAL_AWAIT_COMMAND) {
    return settlementForAwait(envelope);
  }
  if (command === APPROVAL_CANCEL_COMMAND) {
    return settlementForCancel(envelope);
  }
  return { kind: "none" };
}

export class ApprovalIdempotencyLinks {
  maxEntries: number;
  retentionMs: number;
  private now: () => number;

  private links: Map<string, ApprovalLink>;
  private keysByApprovalId: Map<string, string>;

  constructor({
    maxEntries = DEFAULT_MAX_ENTRIES,
    retentionMs = APPROVAL_RESULT_RETENTION_MS,
    now = () => Date.now()
  }: ApprovalLinkOptions = {}) {
    this.maxEntries = maxEntries;
    this.retentionMs = retentionMs;
    this.now = now;
    this.links = new Map();
    this.keysByApprovalId = new Map();
  }

  record({
    key,
    fingerprint,
    approvalId,
    expiresAt,
    pendingResponse
  }: {
    key: string;
    fingerprint: string;
    approvalId: string;
    expiresAt: number;
    pendingResponse: CommandResponseEnvelope;
  }) {
    this.prune();
    this.forget(key);

    this.links.set(key, {
      key,
      kind: "link",
      fingerprint,
      approvalId,
      pendingResponse,
      expiresAt: expiresAt + this.retentionMs
    });
    this.keysByApprovalId.set(approvalId, key);
  }

  // The reservation is held for the pending request's whole lifetime, so a tombstone converts an
  // existing entry instead of competing for capacity with newer keys. recordLostInFlight stays
  // unconditional so that the boundary tick, where both expire at once, still retains the key.
  reserve({
    key,
    fingerprint,
    retainMs
  }: {
    key: string;
    fingerprint: string;
    retainMs: number;
  }): ApprovalReservation {
    this.prune();

    const existing = this.links.get(key);
    if (existing) {
      return existing.kind === "reserved" && existing.fingerprint === fingerprint
        ? { ok: true }
        : { ok: false, reason: "conflict" };
    }

    if (this.links.size >= this.maxEntries) {
      return { ok: false, reason: "full" };
    }

    this.links.set(key, {
      key,
      kind: "reserved",
      fingerprint,
      approvalId: null,
      pendingResponse: null,
      expiresAt: this.now() + retainMs
    });
    return { ok: true };
  }

  release(key: string) {
    if (this.links.get(key)?.kind === "reserved") {
      this.forget(key);
    }
  }

  recordLostInFlight({ key, fingerprint, retainMs }: { key: string; fingerprint: string; retainMs: number }) {
    this.prune();

    const existing = this.links.get(key);
    if (existing && existing.kind !== "reserved") {
      return false;
    }

    this.links.set(key, {
      key,
      kind: "lost",
      fingerprint,
      approvalId: null,
      pendingResponse: null,
      expiresAt: this.now() + retainMs
    });
    return true;
  }

  lookup(key: string, fingerprint: string): ApprovalLinkLookup {
    this.prune();

    const link = this.links.get(key);
    if (!link) {
      return { status: "miss" };
    }

    if (link.kind === "reserved") {
      return { status: "miss" };
    }

    if (link.fingerprint !== fingerprint) {
      return { status: "conflict", approvalId: link.approvalId };
    }

    if (link.approvalId === null) {
      return { status: "lost-in-flight" };
    }

    return link.pendingResponse
      ? { status: "pending", approvalId: link.approvalId, response: link.pendingResponse }
      : { status: "indeterminate", approvalId: link.approvalId };
  }

  settle(settlement: ApprovalSettlement): { key: string; fingerprint: string } | null {
    if (settlement.kind === "none") {
      return null;
    }

    const key = this.keysByApprovalId.get(settlement.approvalId);
    const link = key === undefined ? undefined : this.links.get(key);
    if (!link) {
      return null;
    }

    if (settlement.kind === "indeterminate") {
      link.pendingResponse = null;
      return null;
    }

    const promoted = settlement.kind === "promote" ? { key: link.key, fingerprint: link.fingerprint } : null;
    this.forget(link.key);
    return promoted;
  }

  prune() {
    const now = this.now();
    for (const [key, link] of this.links) {
      if (link.expiresAt <= now) {
        this.forget(key);
      }
    }
  }

  get size() {
    return this.links.size;
  }

  clear() {
    this.links.clear();
    this.keysByApprovalId.clear();
  }

  private forget(key: string) {
    const link = this.links.get(key);
    if (!link) {
      return;
    }
    this.links.delete(key);
    if (link.approvalId !== null && this.keysByApprovalId.get(link.approvalId) === key) {
      this.keysByApprovalId.delete(link.approvalId);
    }
  }
}

export { DEFAULT_MAX_ENTRIES as APPROVAL_LINK_DEFAULT_MAX_ENTRIES };
