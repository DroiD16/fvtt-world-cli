import {
  APPROVAL_TIMEOUT_MAX_MINUTES,
  APPROVAL_TIMEOUT_MIN_MINUTES,
  MODULE_ID,
  POLICY_BEHAVIORS
} from "./generated/protocol.js";
import { format, localize } from "./lib/i18n.js";
import {
  normalizeStoredPolicy,
  readApprovalTimeoutMinutes,
  readStoredCommandPolicy,
  resolveApprovalTimeoutMinutes
} from "./lib/policy.js";
import {
  buildPolicyView,
  clearOverrides,
  listFilteredCommands,
  listSubtreeCommands,
  normalizeFilterTerm,
  writeBehaviors
} from "./lib/policy-tree.js";
import { MODULE_SETTING_KEYS } from "./lib/validators.js";

/** @typedef {import("./lib/policy.js").CommandPolicy} CommandPolicy */
/** @typedef {import("./lib/policy-tree.js").PolicyNode} PolicyNode */
/**
 * @typedef {{
 *   policy: CommandPolicy,
 *   timeoutMinutes: number,
 *   filter: string,
 *   saveError: string
 * }} PolicyDraft
 */

export const FILTER_FIELD_SELECTOR = 'input[name="commandFilter"]';
export const TIMEOUT_FIELD_SELECTOR = 'input[name="approvalTimeout"]';

const SAVE_FAILURE_KEYS = Object.freeze({
  commandPolicy: "FVTTWORLDCLI.Permissions.SaveFailedPolicy",
  approvalTimeoutMinutes: "FVTTWORLDCLI.Permissions.SaveFailedTimeout"
});

/** @returns {PolicyDraft} */
function readDraft() {
  return {
    policy: readStoredCommandPolicy(),
    timeoutMinutes: readApprovalTimeoutMinutes(),
    filter: "",
    saveError: ""
  };
}

/**
 * @param {{ draft: PolicyDraft | null }} application
 * @returns {PolicyDraft}
 */
function openDraft(application) {
  application.draft ??= readDraft();
  return application.draft;
}

/**
 * @param {PolicyDraft} draft
 * @returns {boolean}
 */
function isDirty(draft) {
  const stored = readStoredCommandPolicy().overrides;
  const current = draft.policy.overrides;
  const storedCommands = Object.keys(stored);

  return (
    draft.timeoutMinutes !== readApprovalTimeoutMinutes() ||
    storedCommands.length !== Object.keys(current).length ||
    storedCommands.some((command) => stored[command] !== current[command])
  );
}

/**
 * @param {PolicyDraft} draft
 */
function buildContext(draft) {
  const view = buildPolicyView(draft.policy, { filter: draft.filter });

  return {
    ...view,
    fillLabel: view.filtered
      ? format("FVTTWORLDCLI.Permissions.MasterFillFiltered", { count: view.visibleCount })
      : localize("FVTTWORLDCLI.Permissions.MasterFill"),
    dirty: isDirty(draft),
    saveError: draft.saveError,
    timeoutMinutes: draft.timeoutMinutes,
    timeoutMin: APPROVAL_TIMEOUT_MIN_MINUTES,
    timeoutMax: APPROVAL_TIMEOUT_MAX_MINUTES
  };
}

/**
 * @param {PolicyNode[]} nodes
 * @returns {Generator<PolicyNode>}
 */
function* eachNode(nodes) {
  for (const node of nodes) {
    yield node;
    yield* eachNode(node.nodes);
  }
}

/**
 * @param {any} root
 * @param {ReturnType<typeof buildContext>} context
 */
function paintBehaviors(root, context) {
  for (const node of eachNode(context.nodes)) {
    const element = root?.querySelector(`[data-node="${node.path}"]`);
    if (element) {
      for (const behavior of POLICY_BEHAVIORS) {
        const badge = element.querySelector(`:scope > summary [data-count="${behavior}"]`);
        if (!badge) continue;
        badge.textContent = String(node.counts[behavior]);
        badge.classList.toggle("fvtt-world-cli-policy-count--empty", node.counts[behavior] === 0);
      }
      for (const button of element.querySelectorAll(':scope > summary button[data-action="fillNode"]')) {
        button.setAttribute("aria-pressed", String(node.pressed[button.dataset.behavior] === true));
      }
      element.classList.toggle("fvtt-world-cli-policy-node--changed", node.changed > 0);
    }

    for (const command of node.commands) {
      const row = root?.querySelector(`[data-command="${command.name}"]`);
      if (!row) continue;
      row.dataset.behavior = command.behavior;
      row.classList.toggle("fvtt-world-cli-policy-row--changed", command.changed);
      for (const button of row.querySelectorAll("button[data-behavior]")) {
        button.setAttribute("aria-pressed", String(command.pressed[button.dataset.behavior] === true));
      }
    }
  }
}

/**
 * @param {any} root
 * @param {ReturnType<typeof buildContext>} context
 */
function paintVisibility(root, context) {
  for (const node of eachNode(context.nodes)) {
    const element = root?.querySelector(`[data-node="${node.path}"]`);
    if (element) {
      element.hidden = node.hidden;
      element.open = node.open;
    }

    for (const command of node.commands) {
      const row = root?.querySelector(`[data-command="${command.name}"]`);
      if (!row) continue;
      row.hidden = command.hidden;
      row.classList.toggle("fvtt-world-cli-policy-row--odd", command.band);
    }
  }

  const label = root?.querySelector("[data-fill-label]");
  if (label) label.textContent = context.fillLabel;
  const empty = root?.querySelector("[data-empty-notice]");
  if (empty) empty.hidden = context.visibleCount > 0;
}

/**
 * @param {any} root
 * @param {ReturnType<typeof buildContext>} context
 */
function paintFooter(root, context) {
  const marker = root?.querySelector("[data-dirty-marker]");
  if (marker) marker.classList.toggle("fvtt-world-cli-policy-dirty--active", context.dirty);
  const save = root?.querySelector('button[data-action="savePolicy"]');
  if (save) save.classList.toggle("fvtt-world-cli-policy-save--dirty", context.dirty);
  const failure = root?.querySelector("[data-save-error]");
  if (failure) {
    failure.textContent = context.saveError;
    failure.hidden = context.saveError === "";
  }
}

/**
 * @param {any} root
 * @param {PolicyDraft} draft
 */
function paintState(root, draft) {
  const context = buildContext(draft);
  paintBehaviors(root, context);
  paintFooter(root, context);
}

/**
 * @param {any} root
 * @param {PolicyDraft} draft
 */
function paintAll(root, draft) {
  const context = buildContext(draft);
  paintBehaviors(root, context);
  paintVisibility(root, context);
  paintFooter(root, context);
}

/**
 * @param {any} root
 * @param {boolean} open
 */
function setTreeOpen(root, open) {
  for (const node of root?.querySelectorAll("[data-node]") ?? []) node.open = open;
}

/** @param {unknown} error */
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {PolicyDraft} draft
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<boolean>}
 */
async function writeSetting(draft, key, value) {
  try {
    await globalThis.game.settings.set(MODULE_ID, key, value);
    return true;
  } catch (error) {
    draft.saveError = format(SAVE_FAILURE_KEYS[key], { error: describeError(error) });
    return false;
  }
}

/**
 * @param {PolicyDraft} draft
 * @returns {Promise<boolean>}
 */
async function savePolicy(draft) {
  const policy = normalizeStoredPolicy(draft.policy);
  const timeoutMinutes = resolveApprovalTimeoutMinutes(draft.timeoutMinutes);
  draft.saveError = "";

  if (!(await writeSetting(draft, MODULE_SETTING_KEYS.COMMAND_POLICY, policy))) return false;
  if (!(await writeSetting(draft, MODULE_SETTING_KEYS.APPROVAL_TIMEOUT_MINUTES, timeoutMinutes)))
    return false;

  draft.policy = policy;
  draft.timeoutMinutes = timeoutMinutes;
  return true;
}

/**
 * @param {string} titleKey
 * @param {string} contentKey
 * @returns {Promise<boolean>}
 */
async function askToDiscard(titleKey, contentKey) {
  const confirmed = await globalThis.foundry.applications.api.DialogV2.confirm({
    window: { title: titleKey },
    content: localize(contentKey),
    modal: true,
    rejectClose: false
  });
  return confirmed === true;
}

/**
 * ApplicationV2 dispatches an action from a click listener, so a button inside a `<summary>` toggles
 * its node unless the handler prevents the default: every action shares this one entry point.
 * @this {{ draft: PolicyDraft | null, element?: any, close: (options?: any) => Promise<unknown> }}
 * @param {Event} event
 * @param {any} target
 */
const handleAction = async function (event, target) {
  event.preventDefault();
  const draft = openDraft(this);
  const root = this.element;
  const action = target.dataset.action;

  if (action === "setBehavior") {
    draft.policy = writeBehaviors(draft.policy, [target.dataset.command], target.dataset.behavior);
    paintState(root, draft);
    return;
  }

  if (action === "fillNode") {
    draft.policy = writeBehaviors(
      draft.policy,
      listSubtreeCommands(target.dataset.path),
      target.dataset.behavior
    );
    paintState(root, draft);
    return;
  }

  // The fill sits beside the filter, so it means what the filter shows: with no term every command
  // is visible and the fill is global.
  if (action === "fillAll") {
    draft.policy = writeBehaviors(draft.policy, listFilteredCommands(draft.filter), target.dataset.behavior);
    paintState(root, draft);
    return;
  }

  if (action === "expandAll" || action === "collapseAll") {
    setTreeOpen(root, action === "expandAll");
    return;
  }

  if (action === "resetPolicy") {
    const confirmed = await askToDiscard(
      "FVTTWORLDCLI.Permissions.ResetConfirmTitle",
      "FVTTWORLDCLI.Permissions.ResetConfirmContent"
    );
    if (!confirmed) return;
    draft.policy = clearOverrides(draft.policy);
    paintState(root, draft);
    return;
  }

  if (action === "savePolicy") {
    if (await savePolicy(draft)) {
      const timeout = root?.querySelector(TIMEOUT_FIELD_SELECTOR);
      if (timeout) timeout.value = String(draft.timeoutMinutes);
    }
    paintState(root, draft);
    return;
  }

  if (action === "closePolicy") await this.close();
};

export function createCommandPermissionsApplication() {
  const { ApplicationV2, HandlebarsApplicationMixin } = globalThis.foundry.applications.api;

  return class CommandPermissionsApplication extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "fvtt-world-cli-command-permissions",
      classes: ["fvtt-world-cli-policy"],
      window: {
        title: "FVTTWORLDCLI.Permissions.Title",
        icon: "fa-solid fa-shield-halved",
        contentClasses: ["standard-form"],
        resizable: true
      },
      position: { width: 760, height: 720 },
      actions: {
        setBehavior: handleAction,
        fillNode: handleAction,
        fillAll: handleAction,
        expandAll: handleAction,
        collapseAll: handleAction,
        resetPolicy: handleAction,
        savePolicy: handleAction,
        closePolicy: handleAction
      }
    };

    static PARTS = {
      permissions: {
        template: "modules/fvtt-world-cli/templates/command-permissions.hbs",
        scrollable: [".fvtt-world-cli-policy-list"]
      }
    };

    /** @type {PolicyDraft | null} */
    draft = null;

    async _prepareContext() {
      return buildContext(openDraft(this));
    }

    _onRender(context, options) {
      super._onRender(context, options);
      const root = this.element;
      const draft = openDraft(this);

      root?.querySelector(FILTER_FIELD_SELECTOR)?.addEventListener("input", (/** @type {any} */ event) => {
        draft.filter = normalizeFilterTerm(event.target?.value);
        paintAll(root, draft);
      });

      root?.querySelector(TIMEOUT_FIELD_SELECTOR)?.addEventListener("change", (/** @type {any} */ event) => {
        draft.timeoutMinutes = Number.parseInt(event.target?.value, 10);
        paintState(root, draft);
      });

      paintAll(root, draft);
    }

    async close(options) {
      if (
        this.draft &&
        isDirty(this.draft) &&
        !(await askToDiscard(
          "FVTTWORLDCLI.Permissions.DiscardTitle",
          "FVTTWORLDCLI.Permissions.DiscardContent"
        ))
      ) {
        return this;
      }

      this.draft = null;
      return super.close(options);
    }
  };
}
