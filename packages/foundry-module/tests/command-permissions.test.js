import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BEHAVIOR_BUTTON_SELECTOR,
  DIRTY_MARKER_SELECTOR,
  EMPTY_NOTICE_SELECTOR,
  FILL_LABEL_SELECTOR,
  FILTER_FIELD_SELECTOR,
  NODE_FILL_SELECTOR,
  NODE_SELECTOR,
  ROW_SELECTOR,
  SAVE_BUTTON_SELECTOR,
  SAVE_ERROR_SELECTOR,
  TIMEOUT_FIELD_SELECTOR,
  createCommandPermissionsApplication
} from "../scripts/command-permissions.js";
import {
  APPROVAL_TIMEOUT_DEFAULT_MINUTES,
  APPROVAL_TIMEOUT_MAX_MINUTES,
  APPROVAL_TIMEOUT_MIN_MINUTES,
  COMMAND_NAMES,
  DEFAULT_COMMAND_PROFILE,
  MODULE_ID,
  POLICY_BEHAVIORS,
  POLICY_EXEMPT_COMMANDS
} from "../scripts/generated/protocol.js";
import { buildPolicyView, listSubtreeCommands } from "../scripts/lib/policy-tree.js";
import { MODULE_SETTING_KEYS } from "../scripts/lib/validators.js";

import { installFakeFoundry } from "./helpers/fake-foundry.js";
import { createEnglishI18n, formatEnglish, localizeEnglish } from "./helpers/i18n.js";

const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = readFileSync(join(MODULE_ROOT, "templates", "command-permissions.hbs"), "utf8");
const FLAT_TEMPLATE = TEMPLATE.replace(/\s+/g, " ");
const ATTRIBUTE_HOOKS = [
  FILTER_FIELD_SELECTOR,
  TIMEOUT_FIELD_SELECTOR,
  NODE_FILL_SELECTOR,
  SAVE_BUTTON_SELECTOR,
  FILL_LABEL_SELECTOR,
  EMPTY_NOTICE_SELECTOR,
  DIRTY_MARKER_SELECTOR,
  SAVE_ERROR_SELECTOR
];

function attributeOf(selector) {
  return selector.replace(/^[a-z]+/, "").replace(/[[\]]/g, "");
}

function flatSection(start, end) {
  return FLAT_TEMPLATE.slice(FLAT_TEMPLATE.indexOf(start), FLAT_TEMPLATE.indexOf(end));
}

const EXEMPT_COMMANDS = new Set(POLICY_EXEMPT_COMMANDS);
const TOP_LEVEL_GROUPS = new Set(COMMAND_NAMES.map((command) => command.split(".")[0]));
const PROFILE_APPROVALS = COMMAND_NAMES.filter((command) => DEFAULT_COMMAND_PROFILE[command] === "approve");
const DEEPEST_COMMAND = COMMAND_NAMES.reduce((deepest, command) =>
  command.split(".").length > deepest.split(".").length ? command : deepest
);
const DEEP_NODE_PATH = DEEPEST_COMMAND.split(".").slice(0, -1).join(".");
const ALLOWED_BY_PROFILE = COMMAND_NAMES.find(
  (command) => !EXEMPT_COMMANDS.has(command) && DEFAULT_COMMAND_PROFILE[command] === "allow"
);
const APPROVED_BY_PROFILE = COMMAND_NAMES.find(
  (command) => !EXEMPT_COMMANDS.has(command) && DEFAULT_COMMAND_PROFILE[command] === "approve"
);
const EXEMPT_GROUP = POLICY_EXEMPT_COMMANDS[0].split(".")[0];
const EXEMPT_ONLY_GROUPS = [...TOP_LEVEL_GROUPS].filter((group) =>
  listSubtreeCommands(group).every((command) => EXEMPT_COMMANDS.has(command))
);
const STORED_TIMEOUT_MINUTES =
  APPROVAL_TIMEOUT_DEFAULT_MINUTES === APPROVAL_TIMEOUT_MAX_MINUTES
    ? APPROVAL_TIMEOUT_MIN_MINUTES
    : APPROVAL_TIMEOUT_DEFAULT_MINUTES + 1;

function profileBehaviorOf(command) {
  return EXEMPT_COMMANDS.has(command) ? "allow" : DEFAULT_COMMAND_PROFILE[command];
}

function* eachNode(nodes) {
  for (const node of nodes) {
    yield node;
    yield* eachNode(node.nodes);
  }
}

function eachRow(nodes) {
  return [...eachNode(nodes)].flatMap((node) => node.commands);
}

/** @returns {any} */
function findNode(nodes, path) {
  return [...eachNode(nodes)].find((node) => node.path === path);
}

/** @returns {any} */
function findRow(nodes, name) {
  return eachRow(nodes).find((row) => row.name === name);
}

/** @returns {any} */
function draftOf(app) {
  return app.draft;
}

/** @returns {any} */
function badgeOf(badges, behavior) {
  return badges.get(behavior);
}

function element(extra = {}) {
  const classes = new Map();
  const attributes = new Map();
  const listeners = new Map();

  return {
    dataset: {},
    hidden: false,
    open: false,
    textContent: "",
    value: "",
    classes,
    attributes,
    listeners,
    classList: { toggle: (name, on) => classes.set(name, on) },
    setAttribute: (name, value) => attributes.set(name, value),
    addEventListener: (type, handler) => listeners.set(type, handler),
    querySelector: () => null,
    querySelectorAll: () => [],
    ...extra
  };
}

function behaviorButtons(action, extra = {}) {
  return POLICY_BEHAVIORS.map((behavior) => {
    const button = element(extra);
    button.dataset.action = action;
    button.dataset.behavior = behavior;
    return button;
  });
}

function pressedBehavior(buttons) {
  return buttons.find((button) => button.attributes.get("aria-pressed") === "true")?.dataset.behavior;
}

function createRowElement(name) {
  const buttons = behaviorButtons("setBehavior");
  const row = element({
    querySelectorAll: (/** @type {string} */ selector) =>
      selector === BEHAVIOR_BUTTON_SELECTOR ? buttons : []
  });
  row.dataset.command = name;
  return { row, buttons };
}

function createNodeElement(path) {
  const buttons = behaviorButtons("fillNode");
  for (const button of buttons) button.dataset.path = path;
  const badges = new Map(POLICY_BEHAVIORS.map((behavior) => [behavior, element()]));
  const node = element({
    querySelector: (/** @type {string} */ selector) => {
      if (!selector.startsWith(":scope > summary ")) return null;
      const behavior = POLICY_BEHAVIORS.find((value) => selector.includes(`"${value}"`));
      return behavior === undefined ? null : badgeOf(badges, behavior);
    }
  });
  node.dataset.node = path;
  return { node, buttons, badges };
}

describe("Command permissions application", () => {
  let closeCalls;
  let confirmed;

  beforeEach(() => {
    installFakeFoundry();
    globalThis.game.i18n = createEnglishI18n();
    globalThis.game.settings.register(MODULE_ID, MODULE_SETTING_KEYS.COMMAND_POLICY, {
      scope: "client",
      config: false,
      type: Object,
      default: {}
    });
    globalThis.game.settings.register(MODULE_ID, MODULE_SETTING_KEYS.APPROVAL_TIMEOUT_MINUTES, {
      scope: "client",
      config: true,
      type: Number,
      default: APPROVAL_TIMEOUT_DEFAULT_MINUTES
    });

    closeCalls = 0;
    confirmed = true;

    class ApplicationV2 {
      element = null;

      async _onRender() {}

      async close() {
        closeCalls += 1;
        return "closed";
      }
    }

    globalThis.foundry.applications.api = {
      ApplicationV2,
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2: { confirm: vi.fn(async () => confirmed) }
    };
    globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
  });

  afterEach(() => {
    delete globalThis.game;
    delete globalThis.foundry;
    delete globalThis.ui;
  });

  function application() {
    const Application = createCommandPermissionsApplication();
    const app = new Application();
    const events = [];
    const dispatch = (action, dataset = {}) => {
      const event = { preventDefault: vi.fn() };
      events.push(event);
      return Application.DEFAULT_OPTIONS.actions[action].call(app, event, {
        dataset: { action, ...dataset }
      });
    };
    return { app, Application, dispatch, events };
  }

  function storedPolicy() {
    return globalThis.game.settings.get(MODULE_ID, MODULE_SETTING_KEYS.COMMAND_POLICY);
  }

  function storedTimeout() {
    return globalThis.game.settings.get(MODULE_ID, MODULE_SETTING_KEYS.APPROVAL_TIMEOUT_MINUTES);
  }

  async function store(key, value) {
    await globalThis.game.settings.set(MODULE_ID, key, value);
    globalThis.game.settings.set.mockClear();
  }

  function expectNoNotification() {
    expect(globalThis.ui.notifications.info).not.toHaveBeenCalled();
    expect(globalThis.ui.notifications.warn).not.toHaveBeenCalled();
    expect(globalThis.ui.notifications.error).not.toHaveBeenCalled();
  }

  it("ships the window stylesheet in the module manifest", () => {
    const manifest = JSON.parse(readFileSync(join(MODULE_ROOT, "module.json"), "utf8"));

    expect(manifest.styles).toContain("styles/command-policy.css");
  });

  it("uses the ApplicationV2 Handlebars contract and the shipped form classes", () => {
    const { Application } = application();

    expect(Application.prototype).toBeInstanceOf(globalThis.foundry.applications.api.ApplicationV2);
    expect(Application.DEFAULT_OPTIONS.window.contentClasses).toEqual(["standard-form"]);
    expect(Application.DEFAULT_OPTIONS.classes).toEqual(["fvtt-world-cli-policy"]);
    expect(Application.DEFAULT_OPTIONS.position).toMatchObject({ width: 760, height: 720 });
    expect(Application.PARTS.permissions.template).toBe(
      "modules/fvtt-world-cli/templates/command-permissions.hbs"
    );
    expect(Application.PARTS.permissions.scrollable).toEqual([".fvtt-world-cli-policy-list"]);
  });

  it("keys its repaint on the class hooks and node paths the template renders", () => {
    expect(TEMPLATE).toContain(`class="${NODE_SELECTOR.replace(".", "")}`);
    expect(TEMPLATE).toContain(`class="${ROW_SELECTOR.replace(".", "")}`);
    expect(TEMPLATE).toContain('data-action="fillNode" data-path="{{this.path}}"');
    const summaryMarkup = TEMPLATE.slice(TEMPLATE.indexOf("<summary"), TEMPLATE.indexOf("</summary>"));
    for (const behavior of POLICY_BEHAVIORS) {
      expect(summaryMarkup).toContain(`data-count="${behavior}"`);
    }
  });

  it("finds every element it repaints or dispatches from through an attribute the template renders", () => {
    const { Application } = application();

    for (const selector of ATTRIBUTE_HOOKS) {
      expect(FLAT_TEMPLATE, selector).toContain(attributeOf(selector));
    }
    expect(FLAT_TEMPLATE).toContain('data-node="{{this.path}}"');
    for (const action of Object.keys(Application.DEFAULT_OPTIONS.actions)) {
      expect(FLAT_TEMPLATE, action).toContain(`data-action="${action}"`);
    }
    for (const behavior of POLICY_BEHAVIORS) {
      expect(FLAT_TEMPLATE).toContain(`data-action="fillAll" data-behavior="${behavior}"`);
      expect(FLAT_TEMPLATE).toContain(
        `data-action="fillNode" data-path="{{this.path}}" data-behavior="${behavior}"`
      );
    }

    const rowMarkup = flatSection("{{#each this.commands}}", "{{#each this.nodes}}");
    for (const behavior of POLICY_BEHAVIORS) {
      expect(rowMarkup).toContain(
        `<button type="button" data-action="setBehavior" data-command="{{this.name}}" ` +
          `data-behavior="${behavior}"`
      );
    }
  });

  it("describes the registry's command total, groups and default approvals", async () => {
    const { app } = application();

    const context = await app._prepareContext();

    expect(context.commandCount).toBe(COMMAND_NAMES.length);
    expect(context.groupCount).toBe(TOP_LEVEL_GROUPS.size);
    expect(context.profileApproveCount).toBe(PROFILE_APPROVALS.length);
    expect(context.timeoutMinutes).toBe(APPROVAL_TIMEOUT_DEFAULT_MINUTES);
    expect(context.dirty).toBe(false);
  });

  it("opens on the stored overrides and keeps them when another command changes", async () => {
    await store(MODULE_SETTING_KEYS.COMMAND_POLICY, {
      version: 1,
      overrides: { [ALLOWED_BY_PROFILE]: "deny" }
    });
    const { app, dispatch } = application();

    const context = await app._prepareContext();

    expect(findRow(context.nodes, ALLOWED_BY_PROFILE)).toMatchObject({ behavior: "deny", changed: true });
    const groupPath = ALLOWED_BY_PROFILE.split(".")[0];
    const expectedCounts = { allow: 0, approve: 0, deny: 0 };
    for (const command of listSubtreeCommands(groupPath)) {
      expectedCounts[command === ALLOWED_BY_PROFILE ? "deny" : profileBehaviorOf(command)] += 1;
    }
    expect(findNode(context.nodes, groupPath).counts).toEqual(expectedCounts);
    expect(findNode(context.nodes, groupPath).changed).toBe(1);
    expect(context.dirty).toBe(false);

    await dispatch("setBehavior", { command: APPROVED_BY_PROFILE, behavior: "deny" });
    await dispatch("savePolicy");

    expect(storedPolicy()).toEqual({
      version: 1,
      overrides: { [ALLOWED_BY_PROFILE]: "deny", [APPROVED_BY_PROFILE]: "deny" }
    });
  });

  it("opens the timeout on the stored value rather than the registered default", async () => {
    await store(MODULE_SETTING_KEYS.APPROVAL_TIMEOUT_MINUTES, STORED_TIMEOUT_MINUTES);
    const { app } = application();

    const context = await app._prepareContext();

    expect(STORED_TIMEOUT_MINUTES).not.toBe(APPROVAL_TIMEOUT_DEFAULT_MINUTES);
    expect(context.timeoutMinutes).toBe(STORED_TIMEOUT_MINUTES);
    expect(context.dirty).toBe(false);
    expect(context.timeoutMin).toBe(APPROVAL_TIMEOUT_MIN_MINUTES);
    expect(context.timeoutMax).toBe(APPROVAL_TIMEOUT_MAX_MINUTES);
    expect(TEMPLATE).toContain('name="approvalTimeout"');
    expect(FLAT_TEMPLATE).toContain('min="{{timeoutMin}}" max="{{timeoutMax}}" value="{{timeoutMinutes}}"');
  });

  it("nests every name segment before the verb as its own level", async () => {
    const { app } = application();

    const context = await app._prepareContext();

    const segments = DEEPEST_COMMAND.split(".").slice(0, -1);
    segments.forEach((segment, depth) => {
      const path = segments.slice(0, depth + 1).join(".");
      const node = findNode(context.nodes, path);
      expect(node, `${path} must exist in the tree`).toBeDefined();
      expect(node.segment).toBe(segment);
      expect(node.depth).toBe(depth);
    });

    const row = findRow(context.nodes, DEEPEST_COMMAND);
    expect(row.verb).toBe(DEEPEST_COMMAND.split(".").at(-1));
  });

  it("labels a command row with its verb, the full name as its tooltip, and no caret", () => {
    const rowMarkup = TEMPLATE.slice(
      TEMPLATE.indexOf("{{#each this.commands}}"),
      TEMPLATE.indexOf("{{#each this.nodes}}")
    );

    expect(rowMarkup).toContain('data-command="{{this.name}}"');
    expect(rowMarkup).toContain('<span class="fvtt-world-cli-policy-command" data-tooltip="{{this.name}}">');
    expect(rowMarkup).toContain('<span class="fvtt-world-cli-policy-command-verb">{{this.verb}}</span>');
    expect(rowMarkup).not.toContain("{{this.name}}</span>");
    expect(rowMarkup).not.toContain("fvtt-world-cli-policy-caret");
  });

  it("places every command of the registry in the tree exactly once", async () => {
    const { app } = application();

    const rows = eachRow((await app._prepareContext()).nodes).map((row) => row.name);

    expect(rows.length).toBe(COMMAND_NAMES.length);
    expect([...rows].sort()).toEqual([...COMMAND_NAMES].sort());
  });

  it("keeps a node's subtree the commands its path prefixes", async () => {
    const { app } = application();
    const context = await app._prepareContext();

    for (const node of eachNode(context.nodes)) {
      const walked = eachRow([node]).map((row) => row.name);
      expect(listSubtreeCommands(node.path).sort()).toEqual(walked.sort());
    }
  });

  it("shows an exempt command as always allowed and leaves it out of a mass fill", async () => {
    const { app, dispatch } = application();

    await dispatch("fillAll", { behavior: "deny" });
    const context = await app._prepareContext();

    for (const command of POLICY_EXEMPT_COMMANDS) {
      const row = findRow(context.nodes, command);
      expect(row.exempt).toBe(true);
      expect(row.behavior).toBe("allow");
      expect(row.changed).toBe(false);
    }
    expect(Object.keys(draftOf(app).policy.overrides)).not.toContain(POLICY_EXEMPT_COMMANDS[0]);
    expect(TEMPLATE).toMatch(
      /{{#if this\.exempt}}[\s\S]*FVTTWORLDCLI\.Permissions\.Exempt"}}[\s\S]*{{else}}[\s\S]*data-action="setBehavior"/
    );
  });

  it("marks a group that holds only always-allowed commands and gives it no switch", async () => {
    const { app } = application();
    expect(EXEMPT_ONLY_GROUPS.length).toBeGreaterThan(0);

    const context = await app._prepareContext();

    for (const group of EXEMPT_ONLY_GROUPS) {
      expect(findNode(context.nodes, group).exempt).toBe(true);
    }
    for (const node of eachNode(context.nodes)) {
      expect(node.exempt).toBe(eachRow([node]).every((row) => row.exempt));
    }
    expect(TEMPLATE).toMatch(
      /{{#if this\.exempt}}[\s\S]*FVTTWORLDCLI\.Permissions\.Exempt"}}[\s\S]*{{else}}[\s\S]*data-action="fillNode"/
    );
  });

  it("stores an override only while it differs from the default profile", async () => {
    const { app, dispatch } = application();

    await dispatch("setBehavior", { command: ALLOWED_BY_PROFILE, behavior: "deny" });
    let context = await app._prepareContext();
    expect(findRow(context.nodes, ALLOWED_BY_PROFILE)).toMatchObject({ behavior: "deny", changed: true });
    expect(context.dirty).toBe(true);

    await dispatch("setBehavior", { command: ALLOWED_BY_PROFILE, behavior: "allow" });
    context = await app._prepareContext();
    expect(findRow(context.nodes, ALLOWED_BY_PROFILE)).toMatchObject({ behavior: "allow", changed: false });
    expect(draftOf(app).policy.overrides).toEqual({});
    expect(context.dirty).toBe(false);
  });

  it("fills a whole subtree from one node switch and reports it as uniform", async () => {
    const { app, dispatch } = application();
    const subtree = listSubtreeCommands(DEEP_NODE_PATH);
    expect(subtree.length).toBeGreaterThan(1);

    await dispatch("fillNode", { path: DEEP_NODE_PATH, behavior: "approve" });
    const context = await app._prepareContext();

    const node = findNode(context.nodes, DEEP_NODE_PATH);
    expect(node.counts).toMatchObject({ allow: 0, approve: subtree.length, deny: 0 });
    expect(node.pressed).toMatchObject({ allow: false, approve: true, deny: false });
    expect(node.changed).toBe(
      subtree.filter((command) => DEFAULT_COMMAND_PROFILE[command] !== "approve").length
    );
    for (const command of subtree) {
      expect(findRow(context.nodes, command).behavior).toBe("approve");
    }
  });

  it("keeps a node switch inside its summary from toggling that group open", async () => {
    const { dispatch, events } = application();

    await dispatch("fillNode", { path: DEEP_NODE_PATH, behavior: "deny" });

    expect(events.at(-1).preventDefault).toHaveBeenCalled();
  });

  it("counts an exempt command at its allowed value, so its group never reads as uniform", async () => {
    const { app, dispatch } = application();

    await dispatch("fillNode", { path: EXEMPT_GROUP, behavior: "deny" });
    const node = findNode((await app._prepareContext()).nodes, EXEMPT_GROUP);

    const exemptInGroup = POLICY_EXEMPT_COMMANDS.filter((command) => command.startsWith(`${EXEMPT_GROUP}.`));
    expect(exemptInGroup.length).toBeGreaterThan(0);
    expect(node.counts.allow).toBe(exemptInGroup.length);
    expect(node.pressed.deny).toBe(false);
  });

  it("drops every override on a confirmed reset, whatever the filter shows", async () => {
    const { app, dispatch } = application();
    await dispatch("setBehavior", { command: ALLOWED_BY_PROFILE, behavior: "deny" });
    draftOf(app).filter = DEEPEST_COMMAND;

    await dispatch("resetPolicy");

    expect(globalThis.foundry.applications.api.DialogV2.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        window: { title: "FVTTWORLDCLI.Permissions.ResetConfirmTitle" },
        content: localizeEnglish("FVTTWORLDCLI.Permissions.ResetConfirmContent")
      })
    );
    expect(draftOf(app).policy.overrides).toEqual({});
    expectNoNotification();
  });

  it("keeps the overrides when a reset is not confirmed", async () => {
    const { app, dispatch } = application();
    await dispatch("setBehavior", { command: ALLOWED_BY_PROFILE, behavior: "deny" });
    confirmed = false;

    await dispatch("resetPolicy");

    expect(draftOf(app).policy.overrides).toEqual({ [ALLOWED_BY_PROFILE]: "deny" });
  });

  it("saves the normalized policy and then the normalized timeout, without a notification", async () => {
    const { app, dispatch } = application();
    await dispatch("setBehavior", { command: ALLOWED_BY_PROFILE, behavior: "approve" });
    draftOf(app).timeoutMinutes = 5;

    await dispatch("savePolicy");

    expect(globalThis.game.settings.set.mock.calls.map(([, key]) => key)).toEqual([
      MODULE_SETTING_KEYS.COMMAND_POLICY,
      MODULE_SETTING_KEYS.APPROVAL_TIMEOUT_MINUTES
    ]);
    expect(storedPolicy()).toEqual({ version: 1, overrides: { [ALLOWED_BY_PROFILE]: "approve" } });
    expect(storedTimeout()).toBe(5);
    const context = await app._prepareContext();
    expect(context.dirty).toBe(false);
    expect(context.saveError).toBe("");
    expectNoNotification();
  });

  it("falls back to the default timeout when the field holds an unusable value", async () => {
    const { app, dispatch } = application();
    await app._prepareContext();
    draftOf(app).timeoutMinutes = 0;

    await dispatch("savePolicy");

    expect(storedTimeout()).toBe(APPROVAL_TIMEOUT_DEFAULT_MINUTES);
    expect((await app._prepareContext()).timeoutMinutes).toBe(APPROVAL_TIMEOUT_DEFAULT_MINUTES);
  });

  it("keeps the window dirty and names the policy write that Foundry refused", async () => {
    const { app, dispatch } = application();
    globalThis.game.settings.set = vi.fn(async (_namespace, key) => {
      if (key === MODULE_SETTING_KEYS.COMMAND_POLICY) throw new Error("storage is full");
      return null;
    });
    await dispatch("setBehavior", { command: ALLOWED_BY_PROFILE, behavior: "deny" });

    await dispatch("savePolicy");

    const context = await app._prepareContext();
    expect(context.dirty).toBe(true);
    expect(context.saveError).toBe(
      formatEnglish("FVTTWORLDCLI.Permissions.SaveFailedPolicy", { error: "storage is full" })
    );
    expect(globalThis.game.settings.set.mock.calls.map(([, key]) => key)).toEqual([
      MODULE_SETTING_KEYS.COMMAND_POLICY
    ]);
    expectNoNotification();
  });

  it("keeps the window dirty and names the timeout write that Foundry refused", async () => {
    const { app, dispatch } = application();
    globalThis.game.settings.set = vi.fn(async (_namespace, key) => {
      if (key === MODULE_SETTING_KEYS.APPROVAL_TIMEOUT_MINUTES) throw new Error("no room");
      return null;
    });
    await app._prepareContext();
    draftOf(app).timeoutMinutes = 7;

    await dispatch("savePolicy");

    const context = await app._prepareContext();
    expect(context.dirty).toBe(true);
    expect(context.saveError).toBe(
      formatEnglish("FVTTWORLDCLI.Permissions.SaveFailedTimeout", { error: "no room" })
    );
    expectNoNotification();
  });

  it("keeps the window dirty when the timeout is refused after the policy was stored", async () => {
    const { app, dispatch } = application();
    const write = globalThis.game.settings.set;
    globalThis.game.settings.set = vi.fn(async (namespace, key, value) => {
      if (key === MODULE_SETTING_KEYS.APPROVAL_TIMEOUT_MINUTES) throw new Error("no room");
      return write(namespace, key, value);
    });

    await dispatch("setBehavior", { command: ALLOWED_BY_PROFILE, behavior: "deny" });
    await dispatch("savePolicy");

    expect(storedPolicy()).toEqual({ version: 1, overrides: { [ALLOWED_BY_PROFILE]: "deny" } });
    expect(draftOf(app).timeoutMinutes).toBe(storedTimeout());
    const context = await app._prepareContext();
    expect(context.dirty).toBe(true);
    expect(context.saveError).toBe(
      formatEnglish("FVTTWORLDCLI.Permissions.SaveFailedTimeout", { error: "no room" })
    );
    expectNoNotification();
  });

  it("asks before closing a window with unsaved changes and keeps it open when refused", async () => {
    const { app, dispatch } = application();
    await dispatch("setBehavior", { command: ALLOWED_BY_PROFILE, behavior: "deny" });
    confirmed = false;

    expect(await app.close()).toBe(app);
    expect(closeCalls).toBe(0);
    expect(draftOf(app).policy.overrides).toEqual({ [ALLOWED_BY_PROFILE]: "deny" });

    confirmed = true;
    expect(await app.close()).toBe("closed");
    expect(draftOf(app)).toBeNull();
  });

  it("asks before closing a window whose last save was refused", async () => {
    const { app, dispatch } = application();
    const write = globalThis.game.settings.set;
    globalThis.game.settings.set = vi.fn(async (namespace, key, value) => {
      if (key === MODULE_SETTING_KEYS.APPROVAL_TIMEOUT_MINUTES) throw new Error("no room");
      return write(namespace, key, value);
    });

    await dispatch("setBehavior", { command: ALLOWED_BY_PROFILE, behavior: "deny" });
    await dispatch("savePolicy");
    confirmed = false;

    expect(await app.close()).toBe(app);
    expect(closeCalls).toBe(0);

    confirmed = true;
    expect(await app.close()).toBe("closed");
  });

  it("closes a window without unsaved changes without asking", async () => {
    const { app } = application();
    await app._prepareContext();

    expect(await app.close()).toBe("closed");
    expect(globalThis.foundry.applications.api.DialogV2.confirm).not.toHaveBeenCalled();
  });

  describe("filter", () => {
    it("matches a fully qualified command name and opens its ancestors", () => {
      const view = buildPolicyView({}, { filter: DEEPEST_COMMAND });

      expect(view.visibleCount).toBe(1);
      expect(view.filtered).toBe(true);
      const segments = DEEPEST_COMMAND.split(".").slice(0, -1);
      for (let depth = 0; depth < segments.length; depth += 1) {
        const node = findNode(view.nodes, segments.slice(0, depth + 1).join("."));
        expect(node.hidden).toBe(false);
        expect(node.open).toBe(true);
      }
      expect(findRow(view.nodes, DEEPEST_COMMAND).hidden).toBe(false);
      const others = eachRow(view.nodes).filter((row) => row.name !== DEEPEST_COMMAND);
      expect(others.every((row) => row.hidden)).toBe(true);
    });

    it("matches an unqualified fragment of a name", () => {
      const view = buildPolicyView({}, { filter: "DELETE" });

      const visible = eachRow(view.nodes)
        .filter((row) => !row.hidden)
        .map((row) => row.name);
      expect(visible.sort()).toEqual(COMMAND_NAMES.filter((command) => command.includes("delete")).sort());
    });

    it("returns the tree to fully collapsed once it is cleared", () => {
      const view = buildPolicyView({}, { filter: "" });

      expect(view.visibleCount).toBe(COMMAND_NAMES.length);
      expect([...eachNode(view.nodes)].every((node) => node.open === false && node.hidden === false)).toBe(
        true
      );
      expect(eachRow(view.nodes).every((row) => row.hidden === false)).toBe(true);
    });

    it("bands the rows a filter leaves visible rather than every second row", () => {
      const view = buildPolicyView({}, { filter: "delete" });
      const node = findNode(view.nodes, DEEP_NODE_PATH);

      const bands = node.commands.filter((row) => !row.hidden).map((row) => row.band);
      expect(bands.length).toBeGreaterThan(1);
      expect(bands).toEqual(bands.map((_value, index) => index % 2 === 1));
      expect(node.commands.filter((row) => row.hidden).every((row) => row.band === false)).toBe(true);
    });
  });

  describe("rendered window", () => {
    function render() {
      const { app, dispatch } = application();
      const filterField = element();
      const timeoutField = element();
      const { row, buttons: rowButtons } = createRowElement(ALLOWED_BY_PROFILE);
      const { node, buttons: nodeButtons, badges } = createNodeElement(ALLOWED_BY_PROFILE.split(".")[0]);
      const fillLabel = element();
      const emptyNotice = element();
      const dirtyMarker = element();
      const saveButton = element();
      const saveError = element();
      const map = new Map([
        [FILTER_FIELD_SELECTOR, filterField],
        [TIMEOUT_FIELD_SELECTOR, timeoutField],
        ["[data-fill-label]", fillLabel],
        ["[data-empty-notice]", emptyNotice],
        ["[data-dirty-marker]", dirtyMarker],
        ['button[data-action="savePolicy"]', saveButton],
        ["[data-save-error]", saveError]
      ]);
      const lists = new Map([
        [NODE_SELECTOR, [node]],
        [ROW_SELECTOR, [row]],
        [NODE_FILL_SELECTOR, nodeButtons]
      ]);

      app.element = {
        querySelector: (selector) => map.get(selector) ?? null,
        querySelectorAll: (selector) => lists.get(selector) ?? []
      };

      return {
        app,
        dispatch,
        filterField,
        timeoutField,
        row,
        rowButtons,
        node,
        nodeButtons,
        badges,
        fillLabel,
        emptyNotice,
        dirtyMarker,
        saveError
      };
    }

    it("paints the stored policy into the rows, nodes and footer it finds", async () => {
      const view = render();

      await view.app._onRender({}, {});

      expect(view.row.dataset.behavior).toBe("allow");
      expect(pressedBehavior(view.rowButtons)).toBe("allow");
      expect(view.row.classes.get("fvtt-world-cli-policy-row--changed")).toBe(false);
      const group = findNode((await view.app._prepareContext()).nodes, ALLOWED_BY_PROFILE.split(".")[0]);
      expect(badgeOf(view.badges, "allow").textContent).toBe(String(group.counts.allow));
      expect(badgeOf(view.badges, "deny").textContent).toBe(String(group.counts.deny));
      expect(badgeOf(view.badges, "deny").classes.get("fvtt-world-cli-policy-count--empty")).toBe(true);
      expect(view.dirtyMarker.classes.get("fvtt-world-cli-policy-dirty--active")).toBe(false);
      expect(view.saveError.hidden).toBe(true);
      expect(view.fillLabel.textContent).toBe(localizeEnglish("FVTTWORLDCLI.Permissions.MasterFill"));
    });

    it("repaints one row and its node when a behavior changes", async () => {
      const view = render();
      await view.app._onRender({}, {});

      await view.dispatch("setBehavior", { command: ALLOWED_BY_PROFILE, behavior: "deny" });

      expect(view.row.dataset.behavior).toBe("deny");
      expect(pressedBehavior(view.rowButtons)).toBe("deny");
      expect(view.row.classes.get("fvtt-world-cli-policy-row--changed")).toBe(true);
      expect(view.node.classes.get("fvtt-world-cli-policy-node--changed")).toBe(true);
      expect(badgeOf(view.badges, "deny").textContent).toBe("1");
      expect(view.dirtyMarker.classes.get("fvtt-world-cli-policy-dirty--active")).toBe(true);
    });

    it("scopes the mass fill and its label to what the filter leaves visible", async () => {
      const view = render();
      await view.app._onRender({}, {});

      view.filterField.listeners.get("input")({ target: { value: DEEPEST_COMMAND } });
      await view.dispatch("fillAll", { behavior: "deny" });

      expect(view.fillLabel.textContent).toBe(
        formatEnglish("FVTTWORLDCLI.Permissions.MasterFillFiltered", { count: 1 })
      );
      expect(draftOf(view.app).policy.overrides).toEqual({ [DEEPEST_COMMAND]: "deny" });
      expect(view.row.hidden).toBe(true);
      expect(view.node.hidden).toBe(false);
      expect(view.node.open).toBe(true);
      expect(view.emptyNotice.hidden).toBe(true);
    });

    it("counts only what a filter scoped to always-allowed commands can change", async () => {
      const view = render();
      const exemptCommand = POLICY_EXEMPT_COMMANDS[0];
      await view.app._onRender({}, {});

      view.filterField.listeners.get("input")({ target: { value: exemptCommand } });
      await view.dispatch("fillAll", { behavior: "deny" });

      const context = await view.app._prepareContext();
      expect(context.visibleCount).toBe(1);
      expect(view.fillLabel.textContent).toBe(
        formatEnglish("FVTTWORLDCLI.Permissions.MasterFillFiltered", { count: 0 })
      );
      expect(draftOf(view.app).policy.overrides).toEqual({});
      expect(view.emptyNotice.hidden).toBe(true);
    });

    it("reports an empty result and reopens the whole tree when the filter is cleared", async () => {
      const view = render();
      await view.app._onRender({}, {});

      view.filterField.listeners.get("input")({ target: { value: "no-such-command" } });
      expect(view.emptyNotice.hidden).toBe(false);
      expect(view.node.hidden).toBe(true);

      view.filterField.listeners.get("input")({ target: { value: "" } });
      expect(view.emptyNotice.hidden).toBe(true);
      expect(view.node.hidden).toBe(false);
      expect(view.node.open).toBe(false);
      expect(view.row.hidden).toBe(false);
    });

    it("expands and collapses every node from the tree controls", async () => {
      const view = render();
      await view.app._onRender({}, {});

      await view.dispatch("expandAll");
      expect(view.node.open).toBe(true);

      await view.dispatch("collapseAll");
      expect(view.node.open).toBe(false);
    });

    it("reads the timeout field on change and writes back the value it saved", async () => {
      const view = render();
      await view.app._onRender({}, {});

      view.timeoutField.listeners.get("change")({ target: { value: "0" } });
      expect((await view.app._prepareContext()).dirty).toBe(true);

      await view.dispatch("savePolicy");

      expect(storedTimeout()).toBe(APPROVAL_TIMEOUT_DEFAULT_MINUTES);
      expect(view.timeoutField.value).toBe(String(APPROVAL_TIMEOUT_DEFAULT_MINUTES));
      expect(view.dirtyMarker.classes.get("fvtt-world-cli-policy-dirty--active")).toBe(false);
    });

    it("shows the refused write in the window instead of a notification", async () => {
      const view = render();
      globalThis.game.settings.set = vi.fn(async () => {
        throw new Error("storage is full");
      });
      await view.app._onRender({}, {});
      await view.dispatch("setBehavior", { command: ALLOWED_BY_PROFILE, behavior: "deny" });
      view.timeoutField.listeners.get("change")({ target: { value: "" } });

      await view.dispatch("savePolicy");

      expect(view.saveError.hidden).toBe(false);
      expect(view.saveError.textContent).toContain("storage is full");
      expect(view.dirtyMarker.classes.get("fvtt-world-cli-policy-dirty--active")).toBe(true);
      expect(view.timeoutField.value).toBe("");
      expectNoNotification();
    });
  });
});
