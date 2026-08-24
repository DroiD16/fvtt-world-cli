import { format, localize } from "./lib/i18n.js";
import { utf8ByteLength } from "./lib/setting-values.js";

/** @typedef {import("./lib/approval-store.js").ApprovalStore} ApprovalStore */
/** @typedef {import("./lib/approval-store.js").ApprovalQueueView} ApprovalQueueView */
/** @typedef {import("./lib/approval-store.js").ApprovalRequestView} ApprovalRequestView */
/** @typedef {import("./lib/approval-targets.js").ApprovalTargetSummary} ApprovalTargetSummary */
/** @typedef {{ role: string | null, label: string | null, type: string | null, missing: boolean, unnamed: boolean, parents: string }} ApprovalTargetRow */
/**
 * @typedef {{
 *   command: string,
 *   bulk: boolean,
 *   elementCount: number,
 *   targets: ApprovalTargetRow[],
 *   descriptor: { key: string, value: string }[],
 *   hasTargets: boolean,
 *   omitted: number,
 *   params: { json: string, bytes: number },
 *   timeoutMinutes: number,
 *   expiresAt: number
 * }} PreparedApprovalRequest
 */

export const APPROVAL_REDACTED_PARAM_FIELDS = Object.freeze(["contentBase64"]);

export const COUNTDOWN_SELECTOR = "[data-countdown]";

const COUNTDOWN_INTERVAL_MS = 1000;

const MS_PER_MINUTE = 60_000;

const PARENT_SEPARATOR = " › ";

const BASE64_GROUP_CHARS = 4;

const BASE64_GROUP_BYTES = 3;

/** @type {ApprovalTargetSummary} */
const NO_TARGET_SUMMARY = Object.freeze({
  kind: "none",
  collection: null,
  targets: [],
  totalCount: 0,
  omittedCount: 0,
  descriptor: []
});

// The encoded length is read rather than the payload: decoding a 512 MiB upload to count its bytes is
// the allocation the redaction exists to avoid.
/**
 * @param {string} value
 * @returns {number}
 */
function decodedBase64Bytes(value) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const groups = Math.floor(value.length / BASE64_GROUP_CHARS);
  return Math.max(0, groups * BASE64_GROUP_BYTES - padding);
}

/**
 * @param {unknown} value
 * @param {string | null} field
 * @returns {unknown}
 */
function redactValue(value, field) {
  if (typeof value === "string" && field !== null && APPROVAL_REDACTED_PARAM_FIELDS.includes(field)) {
    return format("FVTTWORLDCLI.Approval.RedactedContent", { bytes: decodedBase64Bytes(value) });
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, null));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactValue(entry, key)]));
  }

  return value;
}

/**
 * @param {unknown} params
 * @returns {{ json: string, bytes: number }}
 */
export function formatApprovalParams(params) {
  const json = JSON.stringify(redactValue(params, null), null, 2) ?? "";
  return { json, bytes: utf8ByteLength(json) };
}

/**
 * @param {number} milliseconds
 * @returns {string}
 */
function formatRemaining(milliseconds) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (/** @type {number} */ value) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

// Rows of one command can name documents of the same type in different roles — the stack a deal draws
// from and the one it fills — and nothing but the parameter each row came from tells them apart. A
// descriptor row always names its parameter, so the rows beside it name theirs too.
/**
 * @param {ApprovalTargetSummary} summary
 * @returns {ApprovalTargetRow[]}
 */
function prepareTargetRows(summary) {
  const roles = new Set(summary.targets.map((target) => target.role));
  const named = roles.size > 1 || summary.descriptor.length > 0;

  return summary.targets.map((target) => ({
    role: named ? target.role : null,
    label: target.name ?? target.id,
    type: target.type,
    missing: target.state === "not-found",
    unnamed: target.name === null && target.id !== null,
    parents: target.parents
      .map((parent) => parent.name ?? parent.id ?? "")
      .filter(Boolean)
      .join(PARENT_SEPARATOR)
  }));
}

/**
 * @param {ApprovalRequestView} request
 * @returns {PreparedApprovalRequest}
 */
function prepareRequest(request) {
  const summary = /** @type {ApprovalTargetSummary} */ (request.targets ?? NO_TARGET_SUMMARY);
  const rows = prepareTargetRows(summary);

  return {
    command: request.command,
    bulk: summary.kind === "bulk",
    elementCount: summary.totalCount,
    targets: rows,
    descriptor: summary.descriptor,
    hasTargets: rows.length > 0 || summary.descriptor.length > 0,
    omitted: summary.omittedCount,
    params: formatApprovalParams(request.params),
    timeoutMinutes: Math.max(1, Math.round((request.expiresAt - request.createdAt) / MS_PER_MINUTE)),
    expiresAt: request.expiresAt
  };
}

/**
 * @param {{ prepared: { approvalId: string, request: PreparedApprovalRequest } | null }} cache
 * @param {ApprovalRequestView} request
 * @returns {PreparedApprovalRequest}
 */
function readPrepared(cache, request) {
  if (cache.prepared?.approvalId !== request.approvalId) {
    cache.prepared = { approvalId: request.approvalId, request: prepareRequest(request) };
  }

  return cache.prepared.request;
}

/**
 * @param {ApprovalQueueView} view
 * @param {{ prepared: { approvalId: string, request: PreparedApprovalRequest } | null }} cache
 * @param {number} now
 */
function buildApprovalContext(view, cache, now) {
  const current = view.current;
  if (current === null) {
    return { request: null, waiting: 0, meta: false };
  }

  const executing = current.state === "executing";
  const countdown = executing ? null : formatRemaining(current.expiresAt - now);

  return {
    request: { ...readPrepared(cache, current), approvalId: current.approvalId, executing, countdown },
    waiting: view.waitingCount,
    meta: countdown !== null || view.waitingCount > 0
  };
}

/**
 * @param {{ approvalStore: ApprovalStore }} runtime
 */
export function createCommandApprovalApplication({ approvalStore }) {
  const { ApplicationV2, HandlebarsApplicationMixin } = globalThis.foundry.applications.api;

  /**
   * The clicked row carries the id it was rendered with: a timeout, a cancellation or a preceding
   * decision advances the queue synchronously while the re-render is not, so a decision that no longer
   * names the request on screen must not fall through onto the one that took its place.
   * @this {{ element?: any }}
   * @param {Event} event
   * @param {any} target
   */
  const handleAction = async function (event, target) {
    event.preventDefault();
    if (!globalThis.game?.user?.isGM) return;
    const action = target.dataset.action;
    if (action !== "allow" && action !== "deny") return;
    const { current } = approvalStore.getQueueView();
    if (current === null || current.state !== "pending") return;
    if (target.dataset.approvalId !== current.approvalId) return;
    await approvalStore.decide(current.approvalId, action);
  };

  return class CommandApprovalApplication extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "fvtt-world-cli-command-approval",
      classes: ["fvtt-world-cli-approval"],
      window: {
        title: "FVTTWORLDCLI.Approval.Title",
        icon: "fa-solid fa-user-shield",
        contentClasses: ["standard-form"],
        resizable: true
      },
      position: { width: 620, height: 700 },
      actions: {
        allow: handleAction,
        deny: handleAction
      }
    };

    static PARTS = {
      approval: {
        template: "modules/fvtt-world-cli/templates/command-approval.hbs",
        scrollable: [".fvtt-world-cli-approval-summary", ".fvtt-world-cli-approval-json"]
      }
    };

    /** @type {any} */
    countdownTimer = null;

    /** @type {{ approvalId: string, request: PreparedApprovalRequest } | null} */
    prepared = null;

    async _prepareContext() {
      return buildApprovalContext(approvalStore.getQueueView(), this, Date.now());
    }

    _onRender(context, options) {
      super._onRender(context, options);
      this.stopCountdown();
      if (context.request === null || context.request.countdown === null) return;
      this.countdownTimer = setInterval(() => this.refreshCountdown(), COUNTDOWN_INTERVAL_MS);
    }

    refreshCountdown() {
      const { current } = approvalStore.getQueueView();
      const countdown = this.element?.querySelector(COUNTDOWN_SELECTOR);
      if (current === null || current.state !== "pending" || !countdown) {
        this.stopCountdown();
        return;
      }

      countdown.textContent = formatRemaining(current.expiresAt - Date.now());
    }

    stopCountdown() {
      if (this.countdownTimer === null) return;
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    // The store drops the parameters of a request it has claimed for execution, so the entry prepared
    // while it was still pending is the only copy left to render if the window opens again.
    _onClose(options) {
      super._onClose(options);
      this.stopCountdown();
      if (approvalStore.getQueueView().current === null) this.prepared = null;
    }
  };
}

// The queue view names only the request on screen, so an arrival is read from the number of decisions
// the store holds: admission is the one transition that raises it. A request the queue advances to
// reopens the window as an arrival does, because nothing else can bring it back on screen: it has
// already pinged while it waited, and the window opens from the queue alone.
/**
 * @param {{ approvalStore: ApprovalStore }} runtime
 */
export function createApprovalWindow({ approvalStore }) {
  /** @type {any} */
  let application = null;
  let held = 0;
  /** @type {string | null} */
  let shown = null;

  approvalStore.subscribe((view) => {
    const total = (view.current === null ? 0 : 1) + view.waitingCount;
    const arrived = total > held;
    const currentId = view.current?.approvalId ?? null;
    const advanced = currentId !== null && currentId !== shown;
    held = total;
    shown = currentId;

    if (total === 0) {
      void application?.close();
      return;
    }

    if (arrived) {
      globalThis.ui?.notifications?.info?.(localize("FVTTWORLDCLI.Approval.Arrived"));
    }

    application ??= new (createCommandApprovalApplication({ approvalStore }))();
    void application.render({ force: arrived || advanced });
  });
}
