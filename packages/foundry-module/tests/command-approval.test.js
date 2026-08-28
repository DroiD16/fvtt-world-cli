import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APPROVAL_REDACTED_PARAM_FIELDS,
  COUNTDOWN_SELECTOR,
  createApprovalWindow,
  createCommandApprovalApplication,
  formatApprovalParams
} from "../scripts/command-approval.js";
import { createCommandRouter } from "../scripts/command-router.js";
import { COMMAND_DEFINITIONS, MODULE_ID } from "../scripts/generated/protocol.js";
import { ApprovalStore } from "../scripts/lib/approval-store.js";
import { resolveApprovalTargets } from "../scripts/lib/approval-targets.js";
import { MODULE_SETTING_KEYS } from "../scripts/lib/validators.js";

import { createRequest, installFakeFoundry } from "./helpers/fake-foundry.js";
import { createEnglishI18n } from "./helpers/i18n.js";

const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = readFileSync(join(MODULE_ROOT, "templates", "command-approval.hbs"), "utf8");
const BINARY_FIELD_PATTERN = /Base64$/;

/**
 * @param {any} schema
 * @param {Set<string>} found
 */
function collectBinaryFields(schema, found) {
  if (schema === null || typeof schema !== "object") return found;
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    if (BINARY_FIELD_PATTERN.test(name)) found.add(name);
    collectBinaryFields(property, found);
  }

  for (const variant of schema.oneOf ?? []) collectBinaryFields(variant, found);
  collectBinaryFields(schema.items, found);
  collectBinaryFields(schema.additionalProperties, found);
  return found;
}

describe("Command approval window", () => {
  /** @type {any[]} */
  let instances;
  /** @type {number} */
  let executions;

  beforeEach(() => {
    vi.useFakeTimers();
    installFakeFoundry();
    globalThis.game.i18n = createEnglishI18n();
    instances = [];
    executions = 0;

    class ApplicationV2 {
      /** @type {any} */
      element = null;

      rendered = false;

      renderCount = 0;

      closeCount = 0;

      /** @type {any[]} */
      contexts = [];

      countdownNode = { textContent: "" };

      constructor() {
        instances.push(this);
      }

      async render(options = {}) {
        if (!this.rendered && options.force !== true) return this;
        this.rendered = true;
        this.renderCount += 1;
        const context = await this._prepareContext();
        this.contexts.push(context);
        this.element = {
          querySelector: (/** @type {string} */ selector) =>
            selector === COUNTDOWN_SELECTOR ? this.countdownNode : null
        };
        this._onRender(context, options);
        return this;
      }

      async close() {
        if (!this.rendered) return this;
        this.rendered = false;
        this.closeCount += 1;
        this.element = null;
        this._onClose({});
        return this;
      }

      async _prepareContext() {
        return {};
      }

      _onRender(/** @type {any} */ _context, /** @type {any} */ _options) {}

      _onClose(/** @type {any} */ _options) {}
    }

    globalThis.foundry.applications.api = {
      ApplicationV2,
      HandlebarsApplicationMixin: (/** @type {any} */ Base) => class extends Base {}
    };
    globalThis.ui = {
      notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() }
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.game;
    delete globalThis.foundry;
    delete globalThis.ui;
  });

  function createStore(options = {}) {
    return new ApprovalStore({
      execute: async () => {
        executions += 1;
        return { ok: true };
      },
      timeoutMinutesProvider: () => 60,
      ...options
    });
  }

  /**
   * @param {any} store
   * @param {string} command
   * @param {any} params
   */
  function admit(store, command, params) {
    return store.admit({
      command,
      params,
      resolveTargets: () => resolveApprovalTargets(command, params),
      requestBytes: 1024
    });
  }

  /**
   * @param {any} app
   * @param {string} action
   * @param {string | null} [approvalId]
   */
  function dispatchOn(app, action, approvalId = app.contexts.at(-1)?.request?.approvalId ?? null) {
    const Application = /** @type {any} */ (app.constructor);
    return Application.DEFAULT_OPTIONS.actions[action].call(
      app,
      { preventDefault: vi.fn() },
      { dataset: { action, approvalId } }
    );
  }

  /** @param {any} store */
  function application(store) {
    const Application = createCommandApprovalApplication({ approvalStore: store });
    const app = new Application();
    const dispatch = (/** @type {string} */ action) =>
      dispatchOn(app, action, store.getQueueView().current?.approvalId ?? null);
    return { app, Application, dispatch };
  }

  /** @param {any} context */
  function shown(context) {
    return context.request;
  }

  async function flush() {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  }

  function notificationCalls() {
    return Object.values(globalThis.ui.notifications).reduce(
      (total, channel) => total + /** @type {any} */ (channel).mock.calls.length,
      0
    );
  }

  it("presents the pending request with its command, resolved target, params and countdown", async () => {
    const store = createStore();
    admit(store, "actor.update", { actorId: "actor-1", patch: { name: "Valeros the Bold" } });
    const { app } = application(store);

    const context = await app._prepareContext();

    expect(shown(context).command).toBe("actor.update");
    expect(shown(context).targets).toEqual([
      { role: null, label: "Valeros", type: "Actor", missing: false, unnamed: false, parents: "" }
    ]);
    expect(shown(context).hasTargets).toBe(true);
    expect(shown(context).countdown).toBe("1:00:00");
    expect(shown(context).timeoutMinutes).toBe(60);
    expect(shown(context).executing).toBe(false);
    expect(JSON.parse(shown(context).params.json)).toEqual({
      actorId: "actor-1",
      patch: { name: "Valeros the Bold" }
    });
    expect(context.waiting).toBe(0);
  });

  it("presents the oldest request alone and counts the ones still waiting", async () => {
    const store = createStore();
    admit(store, "actor.update", { actorId: "actor-1", patch: { name: "First" } });
    admit(store, "scene.delete", { sceneId: "scene-1" });
    const { app } = application(store);

    const context = await app._prepareContext();

    expect(shown(context).command).toBe("actor.update");
    expect(context.waiting).toBe(1);
    expect(context.meta).toBe(true);
  });

  it("renders no request and no waiting counter while the queue is empty", async () => {
    const { app } = application(createStore());

    expect(await app._prepareContext()).toEqual({ request: null, waiting: 0, meta: false });
  });

  it("shows the element count and every target of a bulk envelope as one decision", async () => {
    const store = createStore();
    admit(store, "scene.token.delete-many", {
      sceneId: "scene-1",
      ids: ["token-a", "token-linked", "token-gone"]
    });
    const { app } = application(store);

    const context = await app._prepareContext();

    expect(shown(context).bulk).toBe(true);
    expect(shown(context).elementCount).toBe(3);
    expect(shown(context).targets.map((/** @type {any} */ row) => row.label)).toEqual([
      "Valeros Token",
      "Linked Valeros",
      "token-gone"
    ]);
    expect(shown(context).targets.map((/** @type {any} */ row) => row.missing)).toEqual([false, false, true]);
    expect(shown(context).targets.every((/** @type {any} */ row) => row.parents === "Dungeon Level 1")).toBe(
      true
    );
    expect(shown(context).targets.every((/** @type {any} */ row) => row.role === null)).toBe(true);
  });

  it("names the parameter behind each target when one command addresses several of them", async () => {
    const store = createStore();
    admit(store, "cards.deal", { cardsId: "cards-deck", to: ["cards-hand"], count: 2 });
    admit(store, "file.move", { from: "worlds/world-1/a.txt", to: "worlds/world-1/b.txt" });
    const { app } = application(store);

    const dealt = await app._prepareContext();
    expect(shown(dealt).targets.map((/** @type {any} */ row) => [row.role, row.label, row.type])).toEqual([
      ["cardsId", "Poker Deck", "Cards"],
      ["to", "Player Hand", "Cards"]
    ]);

    await dispatchOn(app, "deny", store.getQueueView().current?.approvalId);
    const moved = await app._prepareContext();
    expect(shown(moved).targets.map((/** @type {any} */ row) => [row.role, row.label])).toEqual([
      ["from", "worlds/world-1/a.txt"],
      ["to", "worlds/world-1/b.txt"]
    ]);
    expect(TEMPLATE).toContain("{{this.role}}");
  });

  it("names the parameter behind a target that stands beside a described one", async () => {
    const store = createStore();
    admit(store, "file.read", { path: "worlds/world-1/notes.txt", encoding: "utf8" });
    const { app } = application(store);

    const context = await app._prepareContext();

    expect(shown(context).targets.map((/** @type {any} */ row) => [row.role, row.label])).toEqual([
      ["path", "worlds/world-1/notes.txt"]
    ]);
    expect(shown(context).descriptor).toEqual([{ key: "encoding", value: "utf8" }]);
  });

  it("summarizes a binary upload field instead of copying or printing it", async () => {
    const store = createStore();
    const contentBase64 = "A".repeat(3_000_000);
    admit(store, "file.upload", {
      path: "worlds/world-1/maps/handout.webp",
      contentBase64,
      mimeType: "image/webp"
    });
    const { app } = application(store);

    const context = await app._prepareContext();

    expect(shown(context).params.json).toContain("<content: 2250000 bytes>");
    expect(shown(context).params.json).not.toContain("AAAAAAAA");
    expect(shown(context).params.json.length).toBeLessThan(500);
    expect(JSON.stringify(context).length).toBeLessThan(2000);
  });

  it("redacts every binary parameter the command registry declares", () => {
    /** @type {Set<string>} */
    const declared = new Set();
    for (const definition of Object.values(COMMAND_DEFINITIONS))
      collectBinaryFields(definition.paramsSchema, declared);

    expect(declared.size).toBeGreaterThan(0);
    expect([...declared].sort()).toEqual([...APPROVAL_REDACTED_PARAM_FIELDS].sort());
  });

  it("measures the parameter block from the redacted text it renders", () => {
    const rendered = formatApprovalParams({ contentBase64: "QUJD", note: "kept" });

    expect(rendered.json).toContain("<content: 3 bytes>");
    expect(rendered.json).toContain("kept");
    expect(rendered.bytes).toBe(new TextEncoder().encode(rendered.json).length);
  });

  it("summarizes a long parameter string instead of rendering it into the window", () => {
    const long = "x".repeat(20_000);
    const rendered = formatApprovalParams({ content: long, note: "kept" });

    expect(rendered.json).toContain("<text: 20000 characters>");
    expect(rendered.json).not.toContain(long);
    expect(rendered.json).toContain("kept");
  });

  it("opens on the first arrival and pings once for every request that arrives", async () => {
    const store = createStore();
    createApprovalWindow({ approvalStore: store });

    admit(store, "actor.update", { actorId: "actor-1", patch: { name: "First" } });
    await flush();
    const [app] = instances;
    expect(app.rendered).toBe(true);
    expect(globalThis.ui.notifications.info).toHaveBeenCalledTimes(1);

    admit(store, "scene.delete", { sceneId: "scene-1" });
    await flush();
    expect(instances).toHaveLength(1);
    expect(globalThis.ui.notifications.info).toHaveBeenCalledTimes(2);
    expect(app.contexts.at(-1).waiting).toBe(1);
  });

  it("plays the notification sound once when the window opens, not for a request that joins the queue", async () => {
    const store = createStore();
    createApprovalWindow({ approvalStore: store });

    admit(store, "actor.update", { actorId: "actor-1", patch: { name: "First" } });
    await flush();

    expect(globalThis.foundry.audio.AudioHelper.play).toHaveBeenCalledTimes(1);
    expect(globalThis.foundry.audio.AudioHelper.play).toHaveBeenCalledWith(
      { src: globalThis.CONFIG.sounds.notification, channel: "interface" },
      false
    );

    admit(store, "scene.delete", { sceneId: "scene-1" });
    await flush();

    expect(globalThis.foundry.audio.AudioHelper.play).toHaveBeenCalledTimes(1);
    expect(globalThis.ui.notifications.info).toHaveBeenCalledTimes(2);
  });

  it("stays silent while the sound setting is off", async () => {
    await globalThis.game.settings.set(MODULE_ID, MODULE_SETTING_KEYS.APPROVAL_SOUND, false);
    const store = createStore();
    createApprovalWindow({ approvalStore: store });

    admit(store, "actor.delete", { actorId: "actor-1" });
    await flush();

    expect(globalThis.foundry.audio.AudioHelper.play).not.toHaveBeenCalled();
    expect(instances[0].rendered).toBe(true);
    expect(globalThis.ui.notifications.info).toHaveBeenCalledTimes(1);
  });

  it("opens the window even when playing the sound throws", async () => {
    globalThis.foundry.audio.AudioHelper.play = vi.fn(() => {
      throw new Error("no audio context");
    });
    const store = createStore();
    createApprovalWindow({ approvalStore: store });

    admit(store, "actor.delete", { actorId: "actor-1" });
    await flush();

    expect(instances[0].rendered).toBe(true);
    expect(globalThis.foundry.audio.AudioHelper.play).toHaveBeenCalledTimes(1);
  });

  it("opens the window even when playing the sound rejects", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    let plays = 0;
    // vi.fn() attaches its own handler to a returned rejection, which would hide a dropped promise.
    globalThis.foundry.audio.AudioHelper.play = () => {
      plays += 1;
      return Promise.reject(new Error("audio blocked"));
    };
    const store = createStore();
    createApprovalWindow({ approvalStore: store });

    admit(store, "actor.delete", { actorId: "actor-1" });
    await flush();
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.off("unhandledRejection", unhandled);

    expect(instances[0].rendered).toBe(true);
    expect(plays).toBe(1);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("adds no notification to a decision, a timeout, a cancellation or an emptied queue", async () => {
    const store = createStore({ timeoutMinutesProvider: () => 1 });
    createApprovalWindow({ approvalStore: store });

    const denied = admit(store, "actor.update", { actorId: "actor-1", patch: { name: "Denied" } });
    const cancelled = admit(store, "scene.delete", { sceneId: "scene-1" });
    const expired = admit(store, "actor.delete", { actorId: "actor-1" });
    const allowed = admit(store, "item.delete", { itemId: "item-1" });
    await flush();

    await store.decide(denied.approvalId, "deny");
    store.cancel(cancelled.approvalId);
    await store.decide(allowed.approvalId, "allow");
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();

    expect(store.getQueueView()).toEqual({ current: null, waitingCount: 0 });
    expect(expired.admitted).toBe(true);
    expect(notificationCalls()).toBe(4);
    expect(globalThis.ui.notifications.info).toHaveBeenCalledTimes(4);
  });

  it("holds the executing request on screen and advances only once its outcome is recorded", async () => {
    /** @type {(value: unknown) => void} */
    let settleExecution = () => {};
    const store = createStore({
      execute: () =>
        new Promise((resolve) => {
          executions += 1;
          settleExecution = resolve;
        })
    });
    createApprovalWindow({ approvalStore: store });
    admit(store, "actor.delete", { actorId: "actor-1" });
    admit(store, "scene.delete", { sceneId: "scene-1" });
    await flush();
    const [app] = instances;

    const decision = dispatchOn(app, "allow");
    await flush();

    expect(app.contexts.at(-1).request.command).toBe("actor.delete");
    expect(app.contexts.at(-1).request.executing).toBe(true);
    expect(app.contexts.at(-1).request.countdown).toBeNull();

    await dispatchOn(app, "allow");
    await dispatchOn(app, "deny");
    expect(executions).toBe(1);
    expect(app.contexts.at(-1).request.command).toBe("actor.delete");

    settleExecution({ ok: true });
    await decision;
    await flush();

    expect(app.contexts.at(-1).request.command).toBe("scene.delete");
    expect(app.contexts.at(-1).waiting).toBe(0);
  });

  it("keeps the parameters of the running request when a later arrival opens the window again", async () => {
    /** @type {(value: unknown) => void} */
    let settleExecution = () => {};
    const store = createStore({
      execute: () =>
        new Promise((resolve) => {
          executions += 1;
          settleExecution = resolve;
        })
    });
    createApprovalWindow({ approvalStore: store });
    admit(store, "actor.update", { actorId: "actor-1", patch: { name: "Valeros the Bold" } });
    await flush();
    const [app] = instances;

    const decision = dispatchOn(app, "allow");
    await flush();
    await app.close();
    admit(store, "scene.delete", { sceneId: "scene-1" });
    await flush();

    expect(app.contexts.at(-1).request.executing).toBe(true);
    expect(JSON.parse(app.contexts.at(-1).request.params.json)).toEqual({
      actorId: "actor-1",
      patch: { name: "Valeros the Bold" }
    });

    settleExecution({ ok: true });
    await decision;
    await flush();

    expect(app.contexts.at(-1).request.command).toBe("scene.delete");
  });

  it("decides nothing when the request that was on screen left the queue before the click", async () => {
    const store = createStore();
    createApprovalWindow({ approvalStore: store });
    const displayed = admit(store, "scene.delete", { sceneId: "scene-1" });
    const next = admit(store, "actor.delete", { actorId: "actor-1" });
    await flush();
    const [app] = instances;

    store.cancel(displayed.approvalId);
    await dispatchOn(app, "allow", displayed.approvalId);
    await dispatchOn(app, "deny", displayed.approvalId);
    await flush();

    expect(executions).toBe(0);
    expect(store.getQueueView().current?.approvalId).toBe(next.approvalId);
    expect(store.getQueueView().current?.state).toBe("pending");
  });

  it("advances to the next request as soon as one is denied", async () => {
    const store = createStore();
    createApprovalWindow({ approvalStore: store });
    admit(store, "actor.delete", { actorId: "actor-1" });
    admit(store, "scene.delete", { sceneId: "scene-1" });
    await flush();
    const [app] = instances;

    await dispatchOn(app, "deny");
    await flush();

    expect(executions).toBe(0);
    expect(app.contexts.at(-1).request.command).toBe("scene.delete");
  });

  it("advances when a request expires and when a client cancellation removes it", async () => {
    const store = createStore({ timeoutMinutesProvider: () => 1 });
    createApprovalWindow({ approvalStore: store });
    admit(store, "actor.delete", { actorId: "actor-1" });
    const cancelled = admit(store, "scene.delete", { sceneId: "scene-1" });
    admit(store, "item.delete", { itemId: "item-1" });
    await flush();
    const [app] = instances;

    store.cancel(cancelled.approvalId);
    await flush();
    expect(app.contexts.at(-1).request.command).toBe("actor.delete");
    expect(app.contexts.at(-1).waiting).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(app.contexts.at(-1).request.command).toBe("item.delete");
    expect(app.contexts.at(-1).waiting).toBe(0);
  });

  it("closes the window and leaves no timer running once the queue empties", async () => {
    const store = createStore();
    createApprovalWindow({ approvalStore: store });
    admit(store, "actor.delete", { actorId: "actor-1" });
    await flush();
    const [app] = instances;

    await dispatchOn(app, "deny");
    await flush();

    expect(app.closeCount).toBe(1);
    expect(app.rendered).toBe(false);
    expect(app.prepared).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps one countdown refresh across repeated renders and updates the rendered value", async () => {
    const store = createStore();
    createApprovalWindow({ approvalStore: store });
    admit(store, "actor.delete", { actorId: "actor-1" });
    await flush();
    const [app] = instances;

    await app.render({ force: false });
    await app.render({ force: false });

    expect(app.renderCount).toBe(3);
    expect(vi.getTimerCount()).toBe(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(app.countdownNode.textContent).toBe("59:59");
  });

  it("leaves a window the GM closed shut while the same request stays on screen", async () => {
    const store = createStore();
    createApprovalWindow({ approvalStore: store });
    admit(store, "actor.delete", { actorId: "actor-1" });
    const waiting = admit(store, "scene.delete", { sceneId: "scene-1" });
    await flush();
    const [app] = instances;

    await app.close();
    store.cancel(waiting.approvalId);
    await flush();

    expect(app.rendered).toBe(false);
    expect(store.getQueueView().waitingCount).toBe(0);
  });

  it("shows the next request when the queue moves past the one the GM was looking at", async () => {
    const store = createStore({ timeoutMinutesProvider: () => 1 });
    createApprovalWindow({ approvalStore: store });
    admit(store, "actor.delete", { actorId: "actor-1" });
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    admit(store, "scene.delete", { sceneId: "scene-1" });
    await flush();
    const [app] = instances;

    await app.close();
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();

    expect(app.rendered).toBe(true);
    expect(app.contexts.at(-1).request.command).toBe("scene.delete");
    expect(globalThis.ui.notifications.info).toHaveBeenCalledTimes(2);
  });

  it("decides nothing from a session that is not a GM", async () => {
    const store = createStore();
    const admission = admit(store, "actor.delete", { actorId: "actor-1" });
    const { app, dispatch } = application(store);
    globalThis.game.user.isGM = false;

    await dispatch("allow");
    await dispatch("deny");

    expect(executions).toBe(0);
    expect(store.getQueueView().current?.approvalId).toBe(admission.approvalId);
    expect(app.contexts).toEqual([]);
  });

  it("runs an allowed command through the guarded path and answers the client that waits for it", async () => {
    await globalThis.game.settings.set(MODULE_ID, MODULE_SETTING_KEYS.COMMAND_POLICY, {
      version: 1,
      overrides: { "actor.update": "approve" }
    });
    const router = createCommandRouter({ bridgeClient: null });
    createApprovalWindow({ approvalStore: router.approvalStore });

    const pending = await router.route(
      createRequest("actor.update", { actorId: "actor-1", patch: { name: "Allowed By The GM" } }),
      { measureRequestBytes: () => 512 }
    );
    await flush();
    const [app] = instances;
    const approvalId = pending.error.details.approvalId;
    expect(app.contexts.at(-1).request.approvalId).toBe(approvalId);

    await dispatchOn(app, "allow");
    const awaited = await router.route(createRequest("approval.await", { approvalId, waitMs: 0 }), {
      measureRequestBytes: () => 512
    });

    expect(awaited.result.status).toBe("resolved");
    expect(awaited.result.outcome).toBe("approved");
    expect(awaited.result.response.id).toBe(approvalId);
    expect(awaited.result.response.result.actor.name).toBe("Allowed By The GM");
    expect(globalThis.game.actors.get("actor-1").name).toBe("Allowed By The GM");
    expect(app.rendered).toBe(false);
  });

  it("wires the template to the two decisions the window registers and to the countdown element", () => {
    const Application = createCommandApprovalApplication({ approvalStore: createStore() });
    const actions = [...TEMPLATE.matchAll(/data-action="([a-zA-Z]+)"/g)].map(([, action]) => action);

    expect(new Set(actions)).toEqual(new Set(Object.keys(Application.DEFAULT_OPTIONS.actions)));
    expect(new Set(actions)).toEqual(new Set(["allow", "deny"]));
    expect(TEMPLATE.match(/data-approval-id="\{\{request\.approvalId\}\}"/g)).toHaveLength(actions.length);
    expect(TEMPLATE).toContain("data-countdown");
  });
});
