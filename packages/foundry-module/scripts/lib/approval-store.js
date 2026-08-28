import {
  APPROVAL_AWAIT_PARK_CAP_MS,
  APPROVAL_PENDING_MAX,
  APPROVAL_RESULT_RETENTION_MS,
  DEFAULT_WS_MAX_PAYLOAD_BYTES
} from "../generated/protocol.js";
import { readApprovalTimeoutMinutes, resolveApprovalTimeoutMinutes } from "./policy.js";
import { utf8ByteLength } from "./setting-values.js";

const MS_PER_MINUTE = 60_000;

const APPROVAL_ID_BYTES = 16;

const APPROVAL_ID_LENGTH = 22;

const APPROVAL_RECORD_MAX = 200;

export const APPROVAL_DELIVERY_GRACE_MS = 10_000;

export const APPROVAL_WAITERS_MAX = 4;

export const APPROVAL_UNKNOWN_REASONS = Object.freeze({
  EXECUTOR_FAILED: "executor-failed",
  RESULT_RETENTION_CAP: "result-retention-cap",
  STORE_CLEARED: "store-cleared"
});

export const APPROVAL_REFUSAL_REASONS = Object.freeze({
  PENDING_COUNT: "pending-count",
  PENDING_BYTES: "pending-bytes",
  RETAINED_COUNT: "retained-count"
});

/** @typedef {"pending" | "executing" | "resolved" | "denied" | "timeout" | "cancelled"} ApprovalState */
/** @typedef {"approved" | "denied" | "timeout" | "cancelled"} ApprovalOutcome */
/** @typedef {"allow" | "deny"} ApprovalDecision */
/** @typedef {{ approvalId: string, command: string, params: unknown }} ApprovalExecution */
/** @typedef {(execution: ApprovalExecution) => Promise<unknown> | unknown} ApprovalExecutor */
/**
 * @typedef {{ approvalId: string, status: "pending", expiresAt?: number }
 *   | { approvalId: string, status: "resolved", outcome: ApprovalOutcome, response?: unknown }
 *   | { approvalId: string, status: "unknown", reason?: string }} ApprovalReport
 */
/** @typedef {{ settle: (report: ApprovalReport) => void, timer: any }} ApprovalWaiter */
/**
 * @typedef {{
 *   approvalId: string,
 *   command: string,
 *   params: unknown,
 *   targets: unknown,
 *   createdAt: number,
 *   expiresAt: number,
 *   state: ApprovalState,
 *   requestBytes: number,
 *   timer: any,
 *   waiters: Set<ApprovalWaiter>,
 *   terminalAt: number | null,
 *   response: unknown,
 *   hasResponse: boolean,
 *   responseBytes: number,
 *   delivered: boolean,
 *   deliveredAt: number | null,
 *   unknownReason: string | null
 * }} ApprovalRecord
 */
/**
 * @typedef {{
 *   approvalId: string,
 *   command: string,
 *   params?: unknown,
 *   targets: unknown,
 *   createdAt: number,
 *   expiresAt: number,
 *   state: ApprovalState
 * }} ApprovalRequestView
 */
/** @typedef {{ current: ApprovalRequestView | null, waitingCount: number }} ApprovalQueueView */
/** @typedef {{ admitted: true, approvalId: string, expiresAt: number } | { admitted: false, reason: string }} ApprovalAdmission */
/** @typedef {{ approvalId: string, state: ApprovalState | "unknown" }} ApprovalDecisionReport */

/**
 * @returns {string}
 */
function createApprovalId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(APPROVAL_ID_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .slice(0, APPROVAL_ID_LENGTH);
}

// The budget is a raw-frame byte budget, so string length would undercount non-ASCII characters.
/**
 * @param {unknown} value
 * @returns {number}
 */
function measureJsonBytes(value) {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? utf8ByteLength(serialized) : 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * @param {() => number} provider
 * @returns {number}
 */
function resolveByteBudget(provider) {
  const budget = provider();
  return typeof budget === "number" && Number.isFinite(budget) && budget > 0
    ? budget
    : DEFAULT_WS_MAX_PAYLOAD_BYTES;
}

// A weight that cannot be expressed is charged the whole budget, so the request is refused.
/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeByteWeight(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : Number.POSITIVE_INFINITY;
}

export class ApprovalStore {
  /** @type {Map<string, ApprovalRecord>} */
  #requests = new Map();

  /** @type {Set<(view: ApprovalQueueView) => void>} */
  #subscribers = new Set();

  #pendingBytes = 0;

  #retainedResponseBytes = 0;

  /**
   * @param {{
   *   execute: ApprovalExecutor,
   *   now?: () => number,
   *   setTimer?: (handler: () => void, delayMs: number) => any,
   *   clearTimer?: (handle: any) => void,
   *   pendingMax?: number,
   *   recordMax?: number,
   *   resultRetentionMs?: number,
   *   deliveryGraceMs?: number,
   *   waitersMax?: number,
   *   parkCapMs?: number,
   *   timeoutMinutesProvider?: () => unknown,
   *   pendingByteBudgetProvider?: () => number,
   *   resultByteBudgetProvider?: () => number,
   *   measureResponseBytes?: (response: unknown) => number
   * }} options
   */
  constructor({
    execute,
    now = () => Date.now(),
    setTimer = (handler, delayMs) => setTimeout(handler, delayMs),
    clearTimer = (handle) => clearTimeout(handle),
    pendingMax = APPROVAL_PENDING_MAX,
    recordMax = APPROVAL_RECORD_MAX,
    resultRetentionMs = APPROVAL_RESULT_RETENTION_MS,
    deliveryGraceMs = APPROVAL_DELIVERY_GRACE_MS,
    waitersMax = APPROVAL_WAITERS_MAX,
    parkCapMs = APPROVAL_AWAIT_PARK_CAP_MS,
    timeoutMinutesProvider = readApprovalTimeoutMinutes,
    pendingByteBudgetProvider = () => DEFAULT_WS_MAX_PAYLOAD_BYTES,
    resultByteBudgetProvider = pendingByteBudgetProvider,
    measureResponseBytes = measureJsonBytes
  }) {
    this.execute = execute;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.pendingMax = pendingMax;
    this.recordMax = recordMax;
    this.resultRetentionMs = resultRetentionMs;
    this.deliveryGraceMs = deliveryGraceMs;
    this.waitersMax = waitersMax;
    this.parkCapMs = parkCapMs;
    this.timeoutMinutesProvider = timeoutMinutesProvider;
    this.pendingByteBudgetProvider = pendingByteBudgetProvider;
    this.resultByteBudgetProvider = resultByteBudgetProvider;
    this.measureResponseBytes = measureResponseBytes;
  }

  /**
   * @param {{
   *   command: string,
   *   params: unknown,
   *   resolveTargets?: () => unknown,
   *   requestBytes: number
   * }} request
   * @returns {ApprovalAdmission}
   */
  admit({ command, params, resolveTargets = () => null, requestBytes }) {
    this.#pruneExpired();

    const bytes = normalizeByteWeight(requestBytes);
    if (this.#countPending() >= this.pendingMax) {
      return { admitted: false, reason: APPROVAL_REFUSAL_REASONS.PENDING_COUNT };
    }

    if (this.#pendingBytes + bytes > resolveByteBudget(this.pendingByteBudgetProvider)) {
      return { admitted: false, reason: APPROVAL_REFUSAL_REASONS.PENDING_BYTES };
    }

    if (!this.#reclaimRecordSlot()) {
      return { admitted: false, reason: APPROVAL_REFUSAL_REASONS.RETAINED_COUNT };
    }

    const approvalId = createApprovalId();
    const createdAt = this.now();
    const timeoutMs = resolveApprovalTimeoutMinutes(this.timeoutMinutesProvider()) * MS_PER_MINUTE;

    /** @type {ApprovalRecord} */
    const record = {
      approvalId,
      command,
      params,
      // Resolved past every bound: a refused caller must not be able to buy a lookup per document.
      targets: resolveTargets(),
      createdAt,
      expiresAt: createdAt + timeoutMs,
      state: "pending",
      requestBytes: bytes,
      timer: null,
      waiters: new Set(),
      terminalAt: null,
      response: undefined,
      hasResponse: false,
      responseBytes: 0,
      delivered: false,
      deliveredAt: null,
      unknownReason: null
    };

    this.#requests.set(approvalId, record);
    this.#pendingBytes += bytes;
    record.timer = this.setTimer(() => this.#expire(approvalId), timeoutMs);
    this.#publish();

    return { admitted: true, approvalId, expiresAt: record.expiresAt };
  }

  /**
   * @param {{ approvalId: string, waitMs?: number }} poll
   * @returns {Promise<ApprovalReport>}
   */
  awaitOutcome({ approvalId, waitMs }) {
    this.#pruneExpired();

    const record = this.#requests.get(approvalId);
    if (!record) {
      return Promise.resolve(/** @type {ApprovalReport} */ ({ approvalId, status: "unknown" }));
    }

    const parkMs = this.#resolveParkMs(waitMs);
    if (record.terminalAt !== null || parkMs <= 0) {
      return Promise.resolve(this.#report(record));
    }

    // A polling loop must not accumulate parks, so the oldest is answered rather than kept.
    while (record.waiters.size >= this.waitersMax) {
      const oldest = record.waiters.values().next().value;
      if (!oldest) {
        break;
      }
      record.waiters.delete(oldest);
      this.clearTimer(oldest.timer);
      oldest.settle(this.#report(record));
    }

    return new Promise((resolve) => {
      /** @type {ApprovalWaiter} */
      const waiter = { settle: resolve, timer: null };
      waiter.timer = this.setTimer(() => {
        record.waiters.delete(waiter);
        resolve(this.#report(record));
      }, parkMs);
      record.waiters.add(waiter);
    });
  }

  /**
   * @param {string} approvalId
   * @returns {"cancelled" | "executing" | "resolved" | "unknown"}
   */
  cancel(approvalId) {
    this.#pruneExpired();

    const record = this.#requests.get(approvalId);
    if (!record) {
      return "unknown";
    }

    if (record.state === "pending") {
      this.#settleTerminal(record, "cancelled");
      // The caller receives this verdict as the return value, so the record is already delivered.
      record.delivered = true;
      return "cancelled";
    }

    if (record.state === "executing") {
      return "executing";
    }

    if (record.unknownReason !== null) {
      return "unknown";
    }

    return record.state === "cancelled" ? "cancelled" : "resolved";
  }

  /**
   * @param {string} approvalId
   * @param {ApprovalDecision} decision
   * @returns {Promise<ApprovalDecisionReport>}
   */
  async decide(approvalId, decision) {
    this.#pruneExpired();

    const record = this.#requests.get(approvalId);
    if (!record) {
      return { approvalId, state: "unknown" };
    }

    if (record.state !== "pending" || (decision !== "allow" && decision !== "deny")) {
      return { approvalId, state: record.state };
    }

    if (decision === "deny") {
      this.#settleTerminal(record, "denied");
      return { approvalId, state: "denied" };
    }

    const params = record.params;
    this.#claimPending(record, "executing");
    this.#wakeWaiters(record);
    this.#publish();

    /** @type {unknown} */
    let response;
    let hasResponse = false;
    try {
      response = await this.execute({ approvalId, command: record.command, params });
      hasResponse = true;
    } catch (error) {
      console.error(`[fvtt-world-cli] approved command ${record.command} failed:`, error);
    }

    this.#settleExecution(record, response, hasResponse);
    return { approvalId, state: "resolved" };
  }

  /**
   * @returns {ApprovalQueueView}
   */
  getQueueView() {
    this.#pruneExpired();

    /** @type {ApprovalRecord | null} */
    let executing = null;
    /** @type {ApprovalRecord[]} */
    const pending = [];
    for (const record of this.#requests.values()) {
      if (record.state === "executing" && executing === null) {
        executing = record;
      } else if (record.state === "pending") {
        pending.push(record);
      }
    }

    const current = executing ?? pending[0] ?? null;
    const waitingCount = executing === null ? Math.max(pending.length - 1, 0) : pending.length;

    return { current: current === null ? null : this.#view(current), waitingCount };
  }

  /**
   * @param {(view: ApprovalQueueView) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#subscribers.add(listener);
    return () => {
      this.#subscribers.delete(listener);
    };
  }

  clear() {
    for (const record of this.#requests.values()) {
      this.clearTimer(record.timer);
      record.timer = null;
      record.params = null;

      if (record.state === "pending") {
        record.state = "cancelled";
        record.terminalAt = this.now();
        this.#wakeWaiters(record);
        continue;
      }

      this.#wakeWaiters(record, {
        approvalId: record.approvalId,
        status: "unknown",
        reason: APPROVAL_UNKNOWN_REASONS.STORE_CLEARED
      });
    }

    this.#requests.clear();
    this.#pendingBytes = 0;
    this.#retainedResponseBytes = 0;
    this.#publish();
  }

  /**
   * @returns {number}
   */
  #countPending() {
    let pending = 0;
    for (const record of this.#requests.values()) {
      if (record.state === "pending") pending += 1;
    }

    return pending;
  }

  /**
   * @param {unknown} waitMs
   * @returns {number}
   */
  #resolveParkMs(waitMs) {
    const requested = typeof waitMs === "number" && Number.isFinite(waitMs) ? waitMs : this.parkCapMs;
    return Math.min(Math.max(requested, 0), this.parkCapMs);
  }

  // Every terminal guarantee rests on leaving `pending` synchronously, before any caller awaits.
  /**
   * @param {ApprovalRecord} record
   * @param {ApprovalState} nextState
   */
  #claimPending(record, nextState) {
    record.state = nextState;
    this.clearTimer(record.timer);
    record.timer = null;
    record.params = null;
    this.#pendingBytes -= record.requestBytes;
  }

  /**
   * @param {string} approvalId
   */
  #expire(approvalId) {
    const record = this.#requests.get(approvalId);
    if (!record || record.state !== "pending") {
      return;
    }

    this.#settleTerminal(record, "timeout");
  }

  /**
   * @param {ApprovalRecord} record
   * @param {"denied" | "timeout" | "cancelled"} state
   */
  #settleTerminal(record, state) {
    this.#claimPending(record, state);
    record.terminalAt = this.now();
    record.targets = null;
    this.#wakeWaiters(record);
    this.#publish();
  }

  /**
   * @param {ApprovalRecord} record
   * @param {unknown} response
   * @param {boolean} hasResponse
   */
  #settleExecution(record, response, hasResponse) {
    record.state = "resolved";
    record.terminalAt = this.now();
    record.targets = null;

    /** @type {ApprovalReport | undefined} */
    let deliverable;
    if (!hasResponse) {
      record.unknownReason = APPROVAL_UNKNOWN_REASONS.EXECUTOR_FAILED;
    } else if (this.#requests.get(record.approvalId) === record) {
      const responseBytes = this.measureResponseBytes(response);
      if (this.#makeRoomForResponse(record, responseBytes)) {
        record.response = response;
        record.hasResponse = true;
        record.responseBytes = responseBytes;
        this.#retainedResponseBytes += responseBytes;
      } else {
        record.unknownReason = APPROVAL_UNKNOWN_REASONS.RESULT_RETENTION_CAP;
        deliverable = {
          approvalId: record.approvalId,
          status: "resolved",
          outcome: "approved",
          response
        };
      }
    }

    this.#wakeWaiters(record, deliverable);
    this.#publish();
  }

  // Only spent outcomes are displaced, and only once their combined weight is known to be enough.
  /**
   * @param {ApprovalRecord} record
   * @param {number} responseBytes
   * @returns {boolean}
   */
  #makeRoomForResponse(record, responseBytes) {
    const budget = resolveByteBudget(this.resultByteBudgetProvider);
    if (!Number.isFinite(responseBytes) || responseBytes > budget) {
      return false;
    }

    if (this.#retainedResponseBytes + responseBytes <= budget) {
      return true;
    }

    const candidates = [...this.#requests.values()].filter(
      (candidate) => candidate !== record && candidate.hasResponse && this.#isSpent(candidate)
    );
    const reclaimable = candidates.reduce((total, candidate) => total + candidate.responseBytes, 0);
    if (this.#retainedResponseBytes - reclaimable + responseBytes > budget) {
      return false;
    }

    for (const candidate of candidates) {
      this.#releaseResponse(candidate);
      if (this.#retainedResponseBytes + responseBytes <= budget) {
        break;
      }
    }

    return true;
  }

  // #report() marks a record delivered before its frame reaches the client, hence the grace window.
  /**
   * @param {ApprovalRecord} record
   * @returns {boolean}
   */
  #isSpent(record) {
    if (!record.delivered) {
      return false;
    }
    return record.deliveredAt === null || this.now() - record.deliveredAt >= this.deliveryGraceMs;
  }

  /**
   * @param {ApprovalRecord} record
   */
  #releaseResponse(record) {
    this.#retainedResponseBytes -= record.responseBytes;
    record.responseBytes = 0;
    record.response = undefined;
    record.hasResponse = false;
    record.unknownReason = APPROVAL_UNKNOWN_REASONS.RESULT_RETENTION_CAP;
  }

  // An unread answer is never traded for a new request, and a running command never counts: it can
  // be neither reclaimed nor re-created, so it must not hold the cap when its handler never settles.
  /**
   * @returns {boolean}
   */
  #reclaimRecordSlot() {
    let counted = 0;
    for (const record of this.#requests.values()) {
      if (record.state !== "executing") counted += 1;
    }

    if (counted < this.recordMax) {
      return true;
    }

    const settled = [...this.#requests.values()].filter((record) => record.terminalAt !== null);
    const reclaimable = [
      ...settled.filter((record) => this.#isSpent(record)),
      ...settled.filter((record) => !this.#isSpent(record) && record.unknownReason !== null)
    ];

    for (const candidate of reclaimable) {
      this.#retainedResponseBytes -= candidate.responseBytes;
      this.#requests.delete(candidate.approvalId);
      counted -= 1;
      if (counted < this.recordMax) {
        return true;
      }
    }

    return false;
  }

  /**
   * @param {ApprovalRecord} record
   * @param {ApprovalReport} [report]
   */
  #wakeWaiters(record, report) {
    if (record.waiters.size === 0) {
      return;
    }

    const waiters = [...record.waiters];
    record.waiters.clear();
    for (const waiter of waiters) {
      this.clearTimer(waiter.timer);
      waiter.settle(report ?? this.#report(record));
    }
  }

  /**
   * @param {ApprovalRecord} record
   */
  #markDelivered(record) {
    record.delivered = true;
    if (record.deliveredAt === null) {
      record.deliveredAt = this.now();
    }
  }

  /**
   * @param {ApprovalRecord} record
   * @returns {ApprovalReport}
   */
  #report(record) {
    if (record.unknownReason !== null) {
      return { approvalId: record.approvalId, status: "unknown", reason: record.unknownReason };
    }

    switch (record.state) {
      case "pending":
        return { approvalId: record.approvalId, status: "pending", expiresAt: record.expiresAt };
      case "executing":
        return { approvalId: record.approvalId, status: "pending" };
      case "resolved":
        this.#markDelivered(record);
        return {
          approvalId: record.approvalId,
          status: "resolved",
          outcome: "approved",
          ...(record.hasResponse ? { response: record.response } : {})
        };
      default:
        this.#markDelivered(record);
        return { approvalId: record.approvalId, status: "resolved", outcome: record.state };
    }
  }

  /**
   * @param {ApprovalRecord} record
   * @returns {ApprovalRequestView}
   */
  #view(record) {
    return {
      approvalId: record.approvalId,
      command: record.command,
      ...(record.state === "pending" ? { params: record.params } : {}),
      targets: record.targets,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      state: record.state
    };
  }

  // Retention expires without a timer: every entry point prunes first, so an idle store holds none.
  #pruneExpired() {
    if (this.#requests.size === 0) {
      return;
    }

    const now = this.now();
    for (const [approvalId, record] of this.#requests) {
      if (record.terminalAt === null || now - record.terminalAt < this.resultRetentionMs) {
        continue;
      }

      this.#retainedResponseBytes -= record.responseBytes;
      this.#requests.delete(approvalId);
    }
  }

  #publish() {
    if (this.#subscribers.size === 0) {
      return;
    }

    const view = this.getQueueView();
    for (const listener of this.#subscribers) {
      try {
        listener(view);
      } catch (error) {
        console.error("[fvtt-world-cli] approval queue subscriber failed:", error);
      }
    }
  }
}
