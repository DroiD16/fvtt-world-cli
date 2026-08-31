import { MACRO_EXECUTE_TIMEOUT_DEFAULT_MS, MODULE_ID } from "./generated/protocol.js";
import { format, localize } from "./lib/i18n.js";
import { readApprovalSoundEnabled } from "./lib/policy.js";
import { utf8ByteLength } from "./lib/setting-values.js";
import { assignableUserRoles } from "./lib/validators.js";

/** @typedef {import("./lib/approval-store.js").ApprovalStore} ApprovalStore */
/** @typedef {import("./lib/approval-store.js").ApprovalQueueView} ApprovalQueueView */
/** @typedef {import("./lib/approval-store.js").ApprovalRequestView} ApprovalRequestView */
/** @typedef {import("./lib/approval-targets.js").ApprovalTargetSummary} ApprovalTargetSummary */
/** @typedef {{ role: string | null, label: string | null, type: string | null, missing: boolean, unnamed: boolean, parents: string }} ApprovalTargetRow */
/** @typedef {{ key: string | null, name: string | null, value: string }} ApprovalDetailRow */
/** @typedef {{ rows: ApprovalDetailRow[], omitted: number, body: string | null }} ApprovalDetails */
/**
 * @typedef {{
 *   command: string,
 *   bulk: boolean,
 *   elementCount: number,
 *   targets: ApprovalTargetRow[],
 *   descriptor: { key: string, value: string }[],
 *   hasTargets: boolean,
 *   omitted: number,
 *   details: ApprovalDetailRow[],
 *   detailsOmitted: number,
 *   body: string | null,
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

const APPROVAL_PARAM_TEXT_MAX_CHARS = 16_384;

const APPROVAL_DETAIL_DISPLAY_MAX = 25;

const DIFF_SEPARATOR = " → ";

const EVENT_SEPARATOR = ", ";

/** @type {ApprovalDetails} */
const NO_DETAILS = Object.freeze({ rows: [], omitted: 0, body: null });

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

  if (typeof value === "string" && value.length > APPROVAL_PARAM_TEXT_MAX_CHARS) {
    return format("FVTTWORLDCLI.Approval.RedactedText", { characters: value.length });
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
 * @param {unknown} value
 * @returns {string | null}
 */
function readableString(value) {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function readableCount(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * @param {string | null} key
 * @param {string | null} name
 * @param {string} value
 * @returns {ApprovalDetailRow}
 */
function detailRow(key, name, value) {
  return { key, name, value };
}

/**
 * @param {string} text
 * @returns {string}
 */
function boundedText(text) {
  return text.length > APPROVAL_PARAM_TEXT_MAX_CHARS
    ? format("FVTTWORLDCLI.Approval.RedactedText", { characters: text.length })
    : text;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function describeValue(value) {
  if (value === undefined) return localize("FVTTWORLDCLI.Approval.ValueAbsent");
  const text = readableString(JSON.stringify(value));
  return text === null ? localize("FVTTWORLDCLI.Approval.ValueUnreadable") : boundedText(text);
}

/**
 * @param {string} namespace
 * @param {string} key
 * @returns {string}
 */
function readSettingValue(namespace, key) {
  if (namespace === MODULE_ID) return localize("FVTTWORLDCLI.Approval.ValueRedacted");

  try {
    const settings = /** @type {any} */ (globalThis).game?.settings;
    if (!settings?.settings?.get(`${namespace}.${key}`)) {
      return localize("FVTTWORLDCLI.Approval.SettingUnregistered");
    }

    return describeValue(settings.get(namespace, key));
  } catch {
    return localize("FVTTWORLDCLI.Approval.ValueUnreadable");
  }
}

/**
 * @param {any} item
 * @returns {string}
 */
function settingDiff(item) {
  const requested =
    item?.namespace === MODULE_ID
      ? localize("FVTTWORLDCLI.Approval.ValueRedacted")
      : describeValue(item?.value);
  return `${readSettingValue(String(item?.namespace), String(item?.key))}${DIFF_SEPARATOR}${requested}`;
}

/**
 * @param {unknown} role
 * @returns {string}
 */
function describeRole(role) {
  if (readableCount(role) === null) return localize("FVTTWORLDCLI.Approval.ValueAbsent");

  try {
    const name = Object.entries(assignableUserRoles()).find(([, value]) => value === role)?.[0];
    return name ? `${name} (${role})` : String(role);
  } catch {
    return String(role);
  }
}

/**
 * @param {unknown} override
 * @returns {string}
 */
function describeOverride(override) {
  if (override === true) return localize("FVTTWORLDCLI.Approval.PermissionGranted");
  if (override === false) return localize("FVTTWORLDCLI.Approval.PermissionRevoked");
  return localize("FVTTWORLDCLI.Approval.PermissionRoleDefault");
}

/**
 * @param {string} uuid
 * @returns {string | null}
 */
function resolveMacroName(uuid) {
  try {
    return readableString(/** @type {any} */ (globalThis).fromUuidSync?.(uuid)?.name);
  } catch {
    return null;
  }
}

/**
 * @param {unknown} uuid
 * @returns {string}
 */
function describeMacroReference(uuid) {
  const reference = readableString(uuid);
  if (reference === null) return localize("FVTTWORLDCLI.Approval.ValueAbsent");
  const name = resolveMacroName(reference);

  return name === null
    ? format("FVTTWORLDCLI.Approval.MacroNotFound", { uuid: reference })
    : `${name} [${reference}]`;
}

/**
 * @param {any} params
 * @returns {ApprovalDetails}
 */
function macroExecuteDetails(params) {
  const macro = /** @type {any} */ (globalThis).game?.macros?.get?.(params?.macroId) ?? null;
  const timeoutMs = readableCount(params?.timeoutMs) ?? MACRO_EXECUTE_TIMEOUT_DEFAULT_MS;
  const command = readableString(macro?.command);

  return {
    rows: [
      detailRow(
        "FVTTWORLDCLI.Approval.DetailMacroType",
        null,
        readableString(macro?.type) ?? localize("FVTTWORLDCLI.Approval.ValueAbsent")
      ),
      detailRow(
        "FVTTWORLDCLI.Approval.DetailTimeout",
        null,
        format("FVTTWORLDCLI.Approval.TimeoutSeconds", { seconds: Math.ceil(timeoutMs / 1000) })
      )
    ],
    omitted: 0,
    body: command === null ? localize("FVTTWORLDCLI.Approval.MacroBodyEmpty") : boundedText(command)
  };
}

/**
 * @param {any} params
 * @returns {ApprovalDetails}
 */
function settingSetDetails(params) {
  return {
    rows: [detailRow("FVTTWORLDCLI.Approval.DetailValue", null, settingDiff(params))],
    omitted: 0,
    body: null
  };
}

/**
 * @param {any} params
 * @returns {ApprovalDetails}
 */
function settingSetManyDetails(params) {
  const items = Array.isArray(params?.items) ? params.items : [];
  const shown = items.slice(0, APPROVAL_DETAIL_DISPLAY_MAX);

  return {
    rows: shown.map((/** @type {any} */ item) =>
      detailRow(null, `${item?.namespace}.${item?.key}`, settingDiff(item))
    ),
    omitted: items.length - shown.length,
    body: null
  };
}

/**
 * @param {any} params
 * @returns {ApprovalDetails}
 */
function userRoleDetails(params) {
  const current = /** @type {any} */ (globalThis).game?.users?.get?.(params?.userId)?.role;

  return {
    rows: [
      detailRow(
        "FVTTWORLDCLI.Approval.DetailRole",
        null,
        `${describeRole(current)}${DIFF_SEPARATOR}${describeRole(params?.role)}`
      )
    ],
    omitted: 0,
    body: null
  };
}

/**
 * @param {any} params
 * @returns {ApprovalDetails}
 */
function userPermissionDetails(params) {
  const overrides = /** @type {any} */ (globalThis).game?.users?.get?.(params?.userId)?.permissions ?? {};
  const requested = Object.entries(params?.permissions ?? {});
  const shown = requested.slice(0, APPROVAL_DETAIL_DISPLAY_MAX);

  return {
    rows: shown.map(([name, value]) =>
      detailRow(
        null,
        name,
        `${describeOverride(Object.hasOwn(overrides, name) ? overrides[name] : undefined)}${DIFF_SEPARATOR}${describeOverride(value)}`
      )
    ),
    omitted: requested.length - shown.length,
    body: null
  };
}

/**
 * @returns {ApprovalDetails}
 */
function chatFlushDetails() {
  const size = readableCount(/** @type {any} */ (globalThis).game?.messages?.size);

  return {
    rows: [
      detailRow(
        "FVTTWORLDCLI.Approval.DetailMessages",
        null,
        size === null ? localize("FVTTWORLDCLI.Approval.ValueUnreadable") : String(size)
      )
    ],
    omitted: 0,
    body: null
  };
}

/**
 * @param {any} params
 * @returns {ApprovalDetails}
 */
function gamePauseDetails(params) {
  const current = /** @type {any} */ (globalThis).game?.paused;

  return {
    rows: [
      detailRow(
        "FVTTWORLDCLI.Approval.DetailPaused",
        null,
        `${describeValue(Boolean(current))}${DIFF_SEPARATOR}${describeValue(params?.paused)}`
      )
    ],
    omitted: 0,
    body: null
  };
}

/**
 * @returns {ApprovalDetails}
 */
function systemReloadDetails() {
  return {
    rows: [
      detailRow("FVTTWORLDCLI.Approval.DetailReload", null, localize("FVTTWORLDCLI.Approval.ReloadWarning"))
    ],
    omitted: 0,
    body: null
  };
}

/**
 * @param {any} params
 * @returns {ApprovalDetails}
 */
function executableBehaviorDetails(params) {
  const system = (params?.data ?? params?.patch ?? {}).system ?? {};
  const events = Array.isArray(system.events) ? system.events : null;

  return {
    rows: [
      detailRow("FVTTWORLDCLI.Approval.DetailMacro", null, describeMacroReference(system.uuid)),
      detailRow(
        "FVTTWORLDCLI.Approval.DetailEvents",
        null,
        events === null
          ? localize("FVTTWORLDCLI.Approval.ValueAbsent")
          : events.join(EVENT_SEPARATOR) || localize("FVTTWORLDCLI.Approval.ValueAbsent")
      ),
      detailRow("FVTTWORLDCLI.Approval.DetailEveryone", null, describeValue(system.everyone))
    ],
    omitted: 0,
    body: null
  };
}

const DETAIL_BUILDERS = Object.freeze({
  "macro.execute": macroExecuteDetails,
  "setting.set": settingSetDetails,
  "setting.set-many": settingSetManyDetails,
  "user.role.set": userRoleDetails,
  "user.permissions.set": userPermissionDetails,
  "chat.flush": chatFlushDetails,
  "game.pause": gamePauseDetails,
  "system.reload": systemReloadDetails,
  "scene.region.behavior.executable.create": executableBehaviorDetails,
  "scene.region.behavior.executable.update": executableBehaviorDetails,
  "scene.region.behavior.executable.clone": executableBehaviorDetails
});

/**
 * @param {string} command
 * @param {unknown} params
 * @returns {ApprovalDetails}
 */
export function buildApprovalDetails(command, params) {
  const build = Object.hasOwn(DETAIL_BUILDERS, command)
    ? DETAIL_BUILDERS[/** @type {keyof typeof DETAIL_BUILDERS} */ (command)]
    : null;
  if (build === null) return NO_DETAILS;

  try {
    return build(params);
  } catch {
    return NO_DETAILS;
  }
}

/**
 * @param {ApprovalRequestView} request
 * @returns {PreparedApprovalRequest}
 */
function prepareRequest(request) {
  const summary = /** @type {ApprovalTargetSummary} */ (request.targets ?? NO_TARGET_SUMMARY);
  const rows = prepareTargetRows(summary);
  const details = buildApprovalDetails(request.command, request.params);

  return {
    command: request.command,
    bulk: summary.kind === "bulk",
    elementCount: summary.totalCount,
    targets: rows,
    descriptor: summary.descriptor,
    hasTargets: rows.length > 0 || summary.descriptor.length > 0,
    omitted: summary.omittedCount,
    details: details.rows,
    detailsOmitted: details.omitted,
    body: details.body,
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

    _onClose(options) {
      super._onClose(options);
      this.stopCountdown();
      if (approvalStore.getQueueView().current === null) this.prepared = null;
    }
  };
}

function playApprovalSound() {
  if (!readApprovalSoundEnabled()) return;

  try {
    const src = globalThis.CONFIG?.sounds?.notification;
    if (!src) return;
    void Promise.resolve(
      globalThis.foundry?.audio?.AudioHelper?.play?.({ src, channel: "interface" }, false)
    ).catch(() => undefined);
  } catch {
    return;
  }
}

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
    const opening = held === 0 && total > 0;
    held = total;
    shown = currentId;

    if (total === 0) {
      void application?.close();
      return;
    }

    if (arrived) {
      globalThis.ui?.notifications?.info?.(localize("FVTTWORLDCLI.Approval.Arrived"));
      if (opening) playApprovalSound();
    }

    application ??= new (createCommandApprovalApplication({ approvalStore }))();
    void application.render({ force: arrived || advanced });
  });
}
