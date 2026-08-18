import { afterEach, describe, expect, it, vi } from "vitest";

import { CHAT_CAPTURE_STATUSES } from "../scripts/generated/protocol.js";
import {
  BRIDGE_FLAG_SCOPE,
  deriveChatCaptureStatus,
  newBridgeCorrelationId,
  selectReportedChatIds,
  startCombatInitiativeChatCapture,
  startRollTableChatCapture
} from "../scripts/lib/chat-capture.js";

function installHooks() {
  const listeners = new Map();
  globalThis.Hooks = {
    on: vi.fn((event, fn) => {
      const bucket = listeners.get(event) ?? [];
      bucket.push(fn);
      listeners.set(event, bucket);
      return bucket.length;
    }),
    off: vi.fn((event, fn) => {
      const bucket = listeners.get(event) ?? [];
      const index = bucket.indexOf(fn);
      if (index >= 0) bucket.splice(index, 1);
    }),
    callAll: (event, ...args) => {
      for (const fn of [...(listeners.get(event) ?? [])]) fn(...args);
    }
  };
  return listeners;
}

function chatMessage(id, tableId, { withGetFlag = true } = {}) {
  const flags = tableId === null ? {} : { core: { RollTable: tableId } };
  return {
    id,
    flags,
    ...(withGetFlag
      ? {
          getFlag: (scope, key) =>
            scope === "core" && key === "RollTable" ? (flags.core?.RollTable ?? null) : null
        }
      : {})
  };
}

describe("chat-message capture", () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;

  afterEach(() => {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  });

  it("captures only the GM's messages carrying flags.core.RollTable === tableId", () => {
    const hooks = installHooks();
    globalThis.game = { user: { id: "gm-1" } };

    const capture = startRollTableChatCapture("table-1");
    expect(capture.available).toBe(true);
    expect(hooks.get("createChatMessage")).toHaveLength(1);

    globalThis.Hooks.callAll("createChatMessage", chatMessage("msg-1", "table-1"), {}, "gm-1");

    globalThis.Hooks.callAll("createChatMessage", chatMessage("msg-2", "table-2"), {}, "gm-1");

    globalThis.Hooks.callAll("createChatMessage", chatMessage("msg-3", null), {}, "gm-1");

    globalThis.Hooks.callAll("createChatMessage", chatMessage("msg-4", "table-1"), {}, "player-9");

    globalThis.Hooks.callAll(
      "createChatMessage",
      chatMessage("msg-5", "table-1", { withGetFlag: false }),
      {},
      "gm-1"
    );

    expect(capture.stop()).toEqual(["msg-1", "msg-5"]);

    expect(hooks.get("createChatMessage")).toHaveLength(0);

    expect(capture.stop()).toEqual(["msg-1", "msg-5"]);
    expect(globalThis.Hooks.off).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable (never a false empty capture) when no Hooks API exists", () => {
    globalThis.Hooks = undefined;
    const capture = startRollTableChatCapture("table-1");
    expect(capture.available).toBe(false);
    expect(capture.stop()).toEqual([]);
  });

  it("derives every status from the pinned protocol enum", () => {
    const cases = [
      { input: { requested: false, available: true, expectedCount: 0, ids: [] }, expected: "not-requested" },

      { input: { requested: true, available: false, expectedCount: 1, ids: [] }, expected: "unknown" },
      { input: { requested: true, available: true, expectedCount: 1, ids: ["m1"] }, expected: "captured" },

      { input: { requested: true, available: true, expectedCount: 0, ids: [] }, expected: "captured" },
      { input: { requested: true, available: true, expectedCount: 2, ids: ["m1"] }, expected: "partial" },

      { input: { requested: true, available: true, expectedCount: 1, ids: [] }, expected: "not-created" },

      {
        input: { requested: true, available: true, expectedCount: 1, ids: ["m1", "m2"] },
        expected: "captured"
      }
    ];
    for (const { input, expected } of cases) {
      const status = deriveChatCaptureStatus(input);
      expect(status, JSON.stringify(input)).toBe(expected);

      expect(CHAT_CAPTURE_STATUSES).toContain(status);
    }
  });

  it("reports only ATTRIBUTABLE ids: never more than expectedCount", () => {
    expect(selectReportedChatIds({ expectedCount: 1, ids: ["m1"] })).toEqual(["m1"]);

    expect(selectReportedChatIds({ expectedCount: 0, ids: ["m1"] })).toEqual([]);
    expect(selectReportedChatIds({ expectedCount: 0, ids: [] })).toEqual([]);

    expect(selectReportedChatIds({ expectedCount: 1, ids: ["m1", "m2"] })).toEqual([]);

    expect(selectReportedChatIds({ expectedCount: 2, ids: ["m1"] })).toEqual(["m1"]);

    const ids = ["m1"];
    expect(selectReportedChatIds({ expectedCount: 1, ids })).not.toBe(ids);
  });
});

describe("combat initiative chat capture", () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;

  afterEach(() => {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  });

  const initiativeMessage = (id, correlationId, { withGetFlag = true } = {}) => {
    const flags = correlationId === null ? {} : { [BRIDGE_FLAG_SCOPE]: { correlationId } };
    return {
      id,
      flags,
      ...(withGetFlag
        ? {
            getFlag: (scope, key) =>
              scope === BRIDGE_FLAG_SCOPE && key === "correlationId"
                ? (flags[scope]?.correlationId ?? null)
                : null
          }
        : {})
    };
  };

  it("captures only the messages carrying THIS call's correlation flag", () => {
    const hooks = installHooks();
    const capture = startCombatInitiativeChatCapture("corr-1");
    expect(capture.available).toBe(true);

    globalThis.Hooks.callAll("createChatMessage", initiativeMessage("m1", "corr-1"), {}, "gm-1");
    globalThis.Hooks.callAll("createChatMessage", initiativeMessage("m2", "corr-1"), {}, "gm-1");

    globalThis.Hooks.callAll("createChatMessage", initiativeMessage("m3", "corr-2"), {}, "gm-1");
    globalThis.Hooks.callAll("createChatMessage", initiativeMessage("m4", null), {}, "gm-1");

    globalThis.Hooks.callAll("createChatMessage", initiativeMessage("m5", "corr-1"), {}, "player-9");

    globalThis.Hooks.callAll(
      "createChatMessage",
      initiativeMessage("m6", "corr-1", { withGetFlag: false }),
      {},
      "gm-1"
    );

    expect(capture.stop()).toEqual(["m1", "m2", "m5", "m6"]);
    expect(hooks.get("createChatMessage")).toHaveLength(0);
  });

  it("reports unavailable (never a false empty capture) when no Hooks API exists", () => {
    globalThis.Hooks = undefined;
    const capture = startCombatInitiativeChatCapture("corr-1");
    expect(capture.available).toBe(false);
    expect(capture.stop()).toEqual([]);
  });

  it("mints a unique correlation id whose namespace Foundry's flag key validator accepts", () => {
    const first = newBridgeCorrelationId();
    const second = newBridgeCorrelationId();
    expect(typeof first).toBe("string");
    expect(first.length).toBeGreaterThan(8);
    expect(first).not.toBe(second);

    expect(BRIDGE_FLAG_SCOPE).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});
