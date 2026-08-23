import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";

import {
  COMMAND_NAMES,
  DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
  DEFAULT_WS_MAX_PAYLOAD_BYTES,
  DISCOVERABLE_COMMAND_NAMES,
  ERROR_CODES
} from "../scripts/generated/protocol.js";

import {
  createActorDocument,
  createDocument,
  createFetchResponse,
  createRequest,
  createTableDocument,
  installFakeFoundry,
  makeDocumentClass
} from "./helpers/fake-foundry.js";

describe("command router", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  it("returns module and bridge status for system.info", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(createRequest("system.info"));

    expect(response.ok).toBe(true);
    expect(response.result.module.version).toBe("0.1.0");
    expect(response.result.bridge.status).toBe("connected");

    expect(response.result.modules).toEqual([
      { id: "fvtt-world-cli", title: "World CLI for Foundry VTT", version: "0.1.0", active: true },
      { id: "dae", title: "Dynamic Active Effects", version: "11.0.0", active: false }
    ]);
    expect(response.result.commands).toContain("journal.update");
    expect(response.result.commands).toContain("actor.item.update");

    expect(response.result.commands).toEqual([...DISCOVERABLE_COMMAND_NAMES]);
    for (const hidden of COMMAND_NAMES.filter((name) => !DISCOVERABLE_COMMAND_NAMES.includes(name))) {
      expect(response.result.commands, `${hidden} must not be advertised`).not.toContain(hidden);
    }

    expect(response.result.limits).toEqual({
      uploadBytes: DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
      wsMaxPayloadBytes: DEFAULT_WS_MAX_PAYLOAD_BYTES,
      uploadSource: "default"
    });
  });

  it("returns a deterministic permission error without stopping transport in the router", async () => {
    globalThis.game.user.isGM = false;
    const stop = vi.fn();
    const router = createCommandRouter({
      bridgeClient: { stop, getStatus: () => ({ status: "connected" }) }
    });

    const response = await router.route(createRequest("system.ping"));

    expect(response).toMatchObject({
      ok: false,
      error: { code: ERROR_CODES.PERMISSION_DENIED }
    });
    expect(stop).not.toHaveBeenCalled();
  });

  it("system.info surfaces the daemon-acked limits block", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" }),
        getLimitsInfo: () => ({
          uploadBytes: 200 * 1024 * 1024,
          wsMaxPayloadBytes: 300 * 1024 * 1024,
          uploadSource: "config"
        })
      }
    });

    const response = await router.route(createRequest("system.info"));

    expect(response.ok).toBe(true);
    expect(response.result.limits).toEqual({
      uploadBytes: 200 * 1024 * 1024,
      wsMaxPayloadBytes: 300 * 1024 * 1024,
      uploadSource: "config"
    });
  });

  it("routes world.audit-files end-to-end and returns the report shape", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const response = await router.route(createRequest("world.audit-files", { scope: ["item"] }));

    expect(response.ok).toBe(true);

    expect(Array.isArray(response.result.broken)).toBe(true);
    expect(typeof response.result.total).toBe("number");
    expect(typeof response.result.hasMore).toBe("boolean");
    expect(typeof response.result.checkedRefs).toBe("number");
    expect(typeof response.result.checkedFiles).toBe("number");
    expect(Array.isArray(response.result.skipped)).toBe(true);
  });

  it("rejects an unknown world.audit-files scope value at the protocol layer", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const response = await router.route(createRequest("world.audit-files", { scope: ["bogus"] }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
  });

  it("system.info falls back to unknown/null when core version + system are absent", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const response = await router.route(createRequest("system.info"));

    expect(response.ok).toBe(true);
    expect(response.result.foundry).toEqual({ version: "unknown", generation: null });
    expect(response.result.system).toEqual({ id: "unknown", version: "unknown" });
  });

  it("system.info reports the Foundry core version/generation and the game system", async () => {
    globalThis.game.version = "13.346";
    globalThis.game.release = { version: "13.346", generation: 13 };
    globalThis.game.system = { id: "dnd5e", version: "4.1.2" };

    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const response = await router.route(createRequest("system.info"));

    expect(response.ok).toBe(true);
    expect(response.result.foundry).toEqual({ version: "13.346", generation: 13 });
    expect(response.result.system).toEqual({ id: "dnd5e", version: "4.1.2" });
  });

  describe("write-confirmation invariant (stored state, per write site)", () => {
    /**
     * @param {string} id
     * @param {{ results?: any[], replacement?: boolean }} [options]
     */
    function seedDrawTable(id, { results = [], replacement = false } = {}) {
      const table = createTableDocument(id, {
        name: "Restock",
        replacement,
        formula: "1d3",
        results
      });
      globalThis.game.tables.set(table);
      return table;
    }

    it("table.draw REFUSES to report a draw whose drawn-marking write was vetoed (per-row stored flag)", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = seedDrawTable("table-draw-veto", {
        results: [
          { id: "veto-1", name: "Rope", range: [1, 1] },
          { id: "veto-2", name: "Torch", range: [2, 2] }
        ]
      });

      table.vetoResultUpdates = new Set(["veto-1"]);

      const response = await router.route(
        createRequest("table.draw", { tableId: "table-draw-veto", idempotencyKey: "draw-veto" })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INTERNAL_ERROR");
      expect(response.error.details).toMatchObject({
        tableId: "table-draw-veto",
        drawnCount: 1,
        unpersisted: [{ tableId: "table-draw-veto", resultId: "veto-1" }]
      });

      expect(response.error.message).toMatch(/preUpdateTableResult/);
      expect(response.error.message).toMatch(/re-sending the same key will draw AGAIN/);

      expect(table.results.get("veto-1")._source.drawn).toBe(false);
      const got = await router.route(createRequest("table.get", { tableId: "table-draw-veto" }));
      expect(got.result.table.results.map((row) => row.drawn)).toEqual([false, false]);
    });

    it("HEALTHY CONTROL: the same draw with no veto stays ok:true and confirms against stored state", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = seedDrawTable("table-draw-ok", {
        results: [
          { id: "ok-1", name: "Rope", range: [1, 1] },
          { id: "ok-2", name: "Torch", range: [2, 2] }
        ]
      });

      const response = await router.route(
        createRequest("table.draw", { tableId: "table-draw-ok", idempotencyKey: "draw-ok" })
      );

      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({
        complete: true,
        mutation: "committed",
        availableBefore: 2,
        availableAfter: 1
      });
      expect(response.result.results.map((row) => row.id)).toEqual(["ok-1"]);
      expect(table.results.get("ok-1")._source.drawn).toBe(true);
    });

    it("table.draw reports a PARTIALLY vetoed multi-draw batch, whose availableAfter would be numerically WRONG", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = seedDrawTable("table-draw-partial", {
        results: [
          { id: "part-1", name: "Rope", range: [1, 1] },
          { id: "part-2", name: "Torch", range: [2, 2] },
          { id: "part-3", name: "Rations", range: [3, 3] }
        ]
      });

      table.vetoResultUpdates = new Set(["part-3"]);

      const response = await router.route(
        createRequest("table.draw", {
          tableId: "table-draw-partial",
          idempotencyKey: "draw-partial",
          count: 3
        })
      );

      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({
        tableId: "table-draw-partial",
        complete: false,
        mutation: "unknown"
      });
      expect(response.result.failure.code).toBe("INTERNAL_ERROR");
      expect(response.result.failure.message).toMatch(/table-draw-partial\/part-3/);
      expect(response.result.failure.message).toMatch(/committed in PART/);
      expect(response.result.failure.message).toMatch(/IS stored under the request's idempotencyKey/);

      expect(Array.from(table.results).map((row) => row._source.drawn)).toEqual([true, true, false]);
      expect(Array.from(table.results).map((row) => row.drawn)).toEqual([true, true, false]);
    });

    it("HEALTHY CONTROL: the same multi-draw with no veto reports availableAfter 0 and all rows stored drawn", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = seedDrawTable("table-draw-partial-ok", {
        results: [
          { id: "pok-1", name: "Rope", range: [1, 1] },
          { id: "pok-2", name: "Torch", range: [2, 2] },
          { id: "pok-3", name: "Rations", range: [3, 3] }
        ]
      });

      const response = await router.route(
        createRequest("table.draw", {
          tableId: "table-draw-partial-ok",
          idempotencyKey: "draw-partial-ok",
          count: 3
        })
      );

      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({ mutation: "committed", availableBefore: 3, availableAfter: 0 });
      expect(Array.from(table.results).map((row) => row._source.drawn)).toEqual([true, true, true]);
    });

    function seedNestedPair({ outerId, innerId, outerReplacement }) {
      const outer = createTableDocument(outerId, {
        name: "Outer",
        replacement: outerReplacement,
        formula: "1d1",
        results: [
          {
            id: `${outerId}-link`,
            type: "document",
            name: "Inner",
            documentUuid: `RollTable.${innerId}`,
            range: [1, 1]
          }
        ]
      });
      const inner = createTableDocument(innerId, {
        name: "Inner",
        replacement: false,
        formula: "1d1",
        results: [{ id: `${innerId}-row`, name: "Kobold", range: [1, 1] }]
      });
      globalThis.game.tables.set(outer);
      globalThis.game.tables.set(inner);
      return { outer, inner };
    }

    it("table.draw catches a vetoed NESTED write through each row's OWN parent, from a replacement:true root", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const { inner } = seedNestedPair({
        outerId: "table-nest-root",
        innerId: "table-nest-inner",
        outerReplacement: true
      });
      inner.vetoResultUpdates = new Set(["table-nest-inner-row"]);

      const response = await router.route(
        createRequest("table.draw", { tableId: "table-nest-root", idempotencyKey: "nest-veto" })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INTERNAL_ERROR");

      expect(response.error.details.unpersisted).toEqual([
        { tableId: "table-nest-inner", resultId: "table-nest-inner-row" }
      ]);
    });

    it("HEALTHY CONTROL: the same recursive draw with no veto returns the inner row and confirms it stored", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const { inner } = seedNestedPair({
        outerId: "table-nest-root-ok",
        innerId: "table-nest-inner-ok",
        outerReplacement: true
      });

      const response = await router.route(
        createRequest("table.draw", { tableId: "table-nest-root-ok", idempotencyKey: "nest-ok" })
      );

      expect(response.ok).toBe(true);
      expect(response.result.mutation).toBe("committed");

      expect(response.result.results.map((row) => [row.id, row.tableId])).toEqual([
        ["table-nest-inner-ok-row", "table-nest-inner-ok"]
      ]);
      expect(inner.results.get("table-nest-inner-ok-row")._source.drawn).toBe(true);
    });

    it("table.draw catches a vetoed OUTER LINK-row write as a CACHED partial commit, not an uncached error", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const { outer, inner } = seedNestedPair({
        outerId: "table-link-veto",
        innerId: "table-link-inner",
        outerReplacement: false
      });
      outer.vetoResultUpdates = new Set(["table-link-veto-link"]);

      const response = await router.route(
        createRequest("table.draw", { tableId: "table-link-veto", idempotencyKey: "link-veto" })
      );

      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({
        tableId: "table-link-veto",
        complete: false,
        mutation: "unknown"
      });

      expect(response.result.results.map((row) => [row.id, row.tableId])).toEqual([
        ["table-link-inner-row", "table-link-inner"]
      ]);
      expect(response.result.failure.code).toBe("INTERNAL_ERROR");
      expect(response.result.failure.message).toMatch(/the consumed row is the LINK row/);
      expect(response.result.failure.message).toMatch(/table-link-inner\/table-link-inner-row/);

      expect(inner.results.get("table-link-inner-row")._source.drawn).toBe(true);
      expect(outer.results.get("table-link-veto-link")._source.drawn).toBe(false);
    });

    it("table.draw CACHES a vetoed NESTED row when the ROOT's link row DID land", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const { outer, inner } = seedNestedPair({
        outerId: "table-nest-landed",
        innerId: "table-nest-landed-inner",
        outerReplacement: false
      });
      inner.vetoResultUpdates = new Set(["table-nest-landed-inner-row"]);

      const response = await router.route(
        createRequest("table.draw", { tableId: "table-nest-landed", idempotencyKey: "nest-landed" })
      );

      expect(outer.results.get("table-nest-landed-link")._source.drawn).toBe(true);
      expect(inner.results.get("table-nest-landed-inner-row")._source.drawn).toBe(false);
      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({ complete: false, mutation: "unknown" });
      expect(response.result.failure.message).toMatch(/table-nest-landed-inner\/table-nest-landed-inner-row/);
      expect(response.result.failure.message).toMatch(/table-nest-landed\/table-nest-landed-link/);
    });

    it("table.draw still ERRORS when the target's row is unconfirmed and NOTHING landed anywhere", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const table = createTableDocument("table-self-veto", {
        name: "Self",
        replacement: false,
        formula: "1d1",
        results: [
          { id: "self-veto-text", name: "Text", range: [1, 1] },
          {
            id: "self-veto-link",
            type: "document",
            name: "Self",
            documentUuid: "RollTable.table-self-veto",
            range: [1, 1]
          }
        ]
      });
      globalThis.game.tables.set(table);
      table.vetoResultUpdates = new Set(["self-veto-link", "self-veto-text"]);

      const response = await router.route(
        createRequest("table.draw", { tableId: "table-self-veto", idempotencyKey: "self-veto" })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INTERNAL_ERROR");
      expect(response.error.message).toMatch(/no row the bridge could observe is stored as drawn/);

      expect(response.error.message).toMatch(
        /covered every table this draw could write and was undisturbed, so nothing was consumed/
      );
      expect(response.error.message).toMatch(/NOT stored under the request's idempotencyKey/);
      expect(response.error.details).toMatchObject({
        tableId: "table-self-veto",
        unconfirmedTargetRow: true,
        landed: [],
        snapshotComplete: true,
        snapshotDisturbed: false
      });
    });

    it("table.draw treats a COMPENDIUM-hop draw whose write landed out of sight as a CACHED partial commit", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const outer = createTableDocument("pack-hop-root", {
        name: "Root",
        replacement: false,
        formula: "1d1",
        results: [
          {
            id: "pack-hop-link",
            type: "document",
            name: "Packed",
            documentUuid: "Compendium.world.tables.RollTable.pack-hop-packed",
            range: [1, 1]
          }
        ]
      });

      const world = createTableDocument("pack-hop-world", {
        name: "Beyond the pack",
        replacement: false,
        formula: "1d1",
        results: [{ id: "pack-hop-world-row", name: "Kobold", range: [1, 1] }]
      });
      globalThis.game.tables.set(outer);
      globalThis.game.tables.set(world);
      outer.vetoResultUpdates = new Set(["pack-hop-link"]);
      outer.draw = vi.fn(async () => {
        const link = outer.results.get("pack-hop-link");

        await outer.updateEmbeddedDocuments("TableResult", [{ _id: link.id, drawn: true }], { diff: false });

        const worldRow = world.results.get("pack-hop-world-row");
        await world.updateEmbeddedDocuments("TableResult", [{ _id: worldRow.id, drawn: true }], {
          diff: false
        });
        return { roll: { formula: "1d1", total: 1 }, results: [worldRow] };
      });

      const response = await router.route(
        createRequest("table.draw", { tableId: "pack-hop-root", idempotencyKey: "pack-hop" })
      );

      expect(world.results.get("pack-hop-world-row")._source.drawn).toBe(true);
      expect(outer.results.get("pack-hop-link")._source.drawn).toBe(false);

      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({
        tableId: "pack-hop-root",
        complete: false,
        mutation: "unknown"
      });
      expect(response.result.failure.code).toBe("INTERNAL_ERROR");
      expect(response.result.failure.message).toMatch(/a commit CANNOT be ruled out/);
      expect(response.result.failure.message).toMatch(/COMPENDIUM-pack link row/);

      expect(response.result.failure.message).not.toMatch(/nothing was consumed/);

      const visible = createTableDocument("pack-hop-visible", {
        name: "Root",
        replacement: false,
        formula: "1d1",
        results: [
          {
            id: "pack-hop-visible-link",
            type: "document",
            name: "World",
            documentUuid: "RollTable.pack-hop-world2",
            range: [1, 1]
          }
        ]
      });
      const world2 = createTableDocument("pack-hop-world2", {
        name: "Reachable",
        replacement: false,
        formula: "1d1",
        results: [{ id: "pack-hop-world2-row", name: "Kobold", range: [1, 1] }]
      });
      globalThis.game.tables.set(visible);
      globalThis.game.tables.set(world2);
      visible.vetoResultUpdates = new Set(["pack-hop-visible-link"]);
      visible.draw = vi.fn(async () => {
        const link = visible.results.get("pack-hop-visible-link");
        await visible.updateEmbeddedDocuments("TableResult", [{ _id: link.id, drawn: true }], {
          diff: false
        });
        const worldRow = world2.results.get("pack-hop-world2-row");
        await world2.updateEmbeddedDocuments("TableResult", [{ _id: worldRow.id, drawn: true }], {
          diff: false
        });
        return { roll: { formula: "1d1", total: 1 }, results: [worldRow] };
      });
      const visibleResponse = await router.route(
        createRequest("table.draw", { tableId: "pack-hop-visible", idempotencyKey: "pack-hop-visible" })
      );
      expect(visibleResponse.ok).toBe(true);
      expect(visibleResponse.result.failure.message).toMatch(/pack-hop-world2\/pack-hop-world2-row/);
      expect(visibleResponse.result.failure.message).not.toMatch(/CANNOT be ruled out/);

      const bothVetoed = createTableDocument("pack-hop-both", {
        name: "Root",
        replacement: false,
        formula: "1d1",
        results: [
          {
            id: "pack-hop-both-link",
            type: "document",
            name: "Packed",
            documentUuid: "Compendium.world.tables.RollTable.pack-hop-packed",
            range: [1, 1]
          }
        ]
      });
      const world3 = createTableDocument("pack-hop-world3", {
        name: "Beyond the pack",
        replacement: false,
        formula: "1d1",
        results: [{ id: "pack-hop-world3-row", name: "Kobold", range: [1, 1] }]
      });
      globalThis.game.tables.set(bothVetoed);
      globalThis.game.tables.set(world3);
      bothVetoed.vetoResultUpdates = new Set(["pack-hop-both-link"]);
      world3.vetoResultUpdates = new Set(["pack-hop-world3-row"]);
      bothVetoed.draw = vi.fn(async () => {
        const link = bothVetoed.results.get("pack-hop-both-link");
        await bothVetoed.updateEmbeddedDocuments("TableResult", [{ _id: link.id, drawn: true }], {
          diff: false
        });
        const worldRow = world3.results.get("pack-hop-world3-row");
        await world3.updateEmbeddedDocuments("TableResult", [{ _id: worldRow.id, drawn: true }], {
          diff: false
        });
        return { roll: { formula: "1d1", total: 1 }, results: [worldRow] };
      });
      const perRowResponse = await router.route(
        createRequest("table.draw", { tableId: "pack-hop-both", idempotencyKey: "pack-hop-both" })
      );
      expect(perRowResponse.ok).toBe(true);
      expect(perRowResponse.result).toMatchObject({ complete: false, mutation: "unknown" });

      expect(perRowResponse.result.failure.message).toMatch(/pack-hop-world3\/pack-hop-world3-row/);
      expect(perRowResponse.result.failure.message).toMatch(/a commit CANNOT be ruled out/);
      expect(perRowResponse.result.failure.message).toMatch(/COMPENDIUM-pack link row/);
      expect(perRowResponse.result.failure.message).not.toMatch(/nothing was consumed/);
    });

    it("table.draw treats a DISTURBED snapshot on the resolved path as a CACHED partial commit too", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const { outer, inner } = seedNestedPair({
        outerId: "disturbed-root",
        innerId: "disturbed-inner",
        outerReplacement: false
      });
      outer.vetoResultUpdates = new Set(["disturbed-root-link"]);
      const originalDraw = outer.draw;
      outer.draw = vi.fn(async (options) => {
        const draw = await originalDraw(options);

        inner.results.delete("disturbed-inner-row");
        return draw;
      });

      const response = await router.route(
        createRequest("table.draw", { tableId: "disturbed-root", idempotencyKey: "disturbed" })
      );

      expect(outer.results.get("disturbed-root-link")._source.drawn).toBe(false);
      expect(inner.results.get("disturbed-inner-row")).toBeNull();
      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({ complete: false, mutation: "unknown" });
      expect(response.result.failure.message).toMatch(/a commit CANNOT be ruled out/);
      expect(response.result.failure.message).toMatch(/the evidence was DISTURBED/);
    });

    it("table.draw reports a HEALTHY replacement:true --count 2 draw over a nested world table as committed", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const root = createTableDocument("count-rep-root", {
        name: "Root",
        replacement: true,
        formula: "1d1",
        results: [
          {
            id: "count-rep-link",
            type: "document",
            name: "Inner",
            documentUuid: "RollTable.count-rep-inner",
            range: [1, 1]
          }
        ]
      });
      const inner = createTableDocument("count-rep-inner", {
        name: "Inner",
        replacement: false,
        formula: "1d1",
        results: [
          { id: "count-rep-inner-a", name: "Kobold", range: [1, 1] },
          { id: "count-rep-inner-b", name: "Goblin", range: [1, 1] }
        ]
      });
      globalThis.game.tables.set(root);
      globalThis.game.tables.set(inner);

      root.drawMany = vi.fn(async (count, options) => {
        root.drawCalls.push({ count, ...options });
        const rows = Array.from(inner.results).slice(0, count);
        return { roll: { formula: "{1d1,1d1}", total: 2 }, results: rows };
      });

      const response = await router.route(
        createRequest("table.draw", {
          tableId: "count-rep-root",
          idempotencyKey: "count-rep",
          count: 2,
          chat: false
        })
      );

      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({
        tableId: "count-rep-root",
        complete: true,
        mutation: "committed"
      });
      expect(response.result.chatMessages).toEqual({ status: "not-requested", expectedCount: 0, ids: [] });
      expect(response.result).not.toHaveProperty("failure");

      expect(response.result.results.map((row) => [row.id, row.tableId])).toEqual([
        ["count-rep-inner-a", "count-rep-inner"],
        ["count-rep-inner-b", "count-rep-inner"]
      ]);
      expect(Array.from(inner.results).map((row) => row._source.drawn)).toEqual([false, false]);
    });

    it("HEALTHY CONTROL: the same recursive draw with no veto consumes the link row AND the inner row", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const { outer, inner } = seedNestedPair({
        outerId: "table-link-ok",
        innerId: "table-link-inner-ok2",
        outerReplacement: false
      });

      const response = await router.route(
        createRequest("table.draw", { tableId: "table-link-ok", idempotencyKey: "link-ok" })
      );

      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({ mutation: "committed", availableBefore: 1, availableAfter: 0 });
      expect(outer.results.get("table-link-ok-link")._source.drawn).toBe(true);
      expect(inner.results.get("table-link-inner-ok2-row")._source.drawn).toBe(true);
    });

    /**
     * @param {string} id
     * @param {{ replacement?: boolean, rows?: any[] }} [options]
     */
    function seedSelfLinkTable(id, { replacement = false, rows = [] } = {}) {
      const table = createTableDocument(id, {
        name: "Recursive Loot",
        replacement,
        formula: "1d2",
        results: [
          {
            id: `${id}-link`,
            type: "document",
            name: "Itself",
            documentUuid: `RollTable.${id}`,
            range: [1, 1]
          },
          { id: `${id}-text`, name: "Coins", range: [2, 2] },
          ...rows
        ]
      });
      globalThis.game.tables.set(table);
      return table;
    }

    it("table.draw does NOT report a bogus refusal for a recursive draw that returns into the TARGETED table", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = seedSelfLinkTable("table-self-link");

      const response = await router.route(
        createRequest("table.draw", { tableId: "table-self-link", idempotencyKey: "self-1" })
      );

      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({
        mutation: "committed",
        complete: true,
        availableBefore: 2,
        availableAfter: 1
      });

      expect(response.result.results.map((row) => [row.id, row.tableId])).toEqual([
        ["table-self-link-text", "table-self-link"]
      ]);
      expect(table.results.get("table-self-link-link")._source.drawn).toBe(true);
      expect(table.results.get("table-self-link-text")._source.drawn).toBe(false);
    });

    it("table.draw does NOT report a bogus refusal for an A→B→A CYCLE either (no self-reference needed)", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const a = createTableDocument("table-cycle-a", {
        name: "A",
        replacement: false,
        formula: "1d2",
        results: [
          {
            id: "cycle-a-link",
            type: "document",
            name: "toB",
            documentUuid: "RollTable.table-cycle-b",
            range: [1, 1]
          },
          { id: "cycle-a-text", name: "Coins", range: [2, 2] }
        ]
      });
      const b = createTableDocument("table-cycle-b", {
        name: "B",
        replacement: false,
        formula: "1d1",
        results: [
          {
            id: "cycle-b-link",
            type: "document",
            name: "toA",
            documentUuid: "RollTable.table-cycle-a",
            range: [1, 1]
          }
        ]
      });
      globalThis.game.tables.set(a);
      globalThis.game.tables.set(b);

      const response = await router.route(
        createRequest("table.draw", { tableId: "table-cycle-a", idempotencyKey: "cycle-1" })
      );

      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({ mutation: "committed", availableBefore: 2, availableAfter: 1 });
      expect(response.result.results.map((row) => [row.id, row.tableId])).toEqual([
        ["cycle-a-text", "table-cycle-a"]
      ]);
      expect(a.results.get("cycle-a-link")._source.drawn).toBe(true);

      expect(b.results.get("cycle-b-link")._source.drawn).toBe(false);
    });

    it("REGRESSION PIN: the exemption is COUNT-gated — a self-reachable --count > 1 draw still catches a PARTIAL refusal", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const table = seedSelfLinkTable("table-self-many", {
        rows: [
          { id: "self-many-b", name: "Gems", range: [3, 3] },
          { id: "self-many-c", name: "Art", range: [4, 4] }
        ]
      });

      table.vetoResultUpdates = new Set(["self-many-b"]);

      const response = await router.route(
        createRequest("table.draw", { tableId: "table-self-many", idempotencyKey: "self-many", count: 3 })
      );

      expect(response.ok).toBe(true);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.complete).toBe(false);
      expect(response.result.failure.message).toMatch(/table-self-many\/self-many-b/);
      expect(table.results.get("self-many-b")._source.drawn).toBe(false);
    });

    it("DISCLOSED: a self-link --count > 1 whose LATER iteration throws leaves a live/stored divergence, and reports the real error", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const table = seedSelfLinkTable("table-self-depth");
      table.drawLoopFailure = new Error(
        "Maximum recursion depth exceeded when attempting to draw from RollTable table-self-depth"
      );

      const response = await router.route(
        createRequest("table.draw", { tableId: "table-self-depth", idempotencyKey: "self-depth", count: 2 })
      );

      expect(response.ok).toBe(false);
      expect(response.error.message).toMatch(/Maximum recursion depth exceeded/);

      const link = table.results.get("table-self-depth-link");
      expect(link.drawn).toBe(true);
      expect(link._source.drawn).toBe(false);

      const reset = await router.route(createRequest("table.reset", { tableId: "table-self-depth" }));
      expect(reset.ok).toBe(true);
      expect(reset.result.changedCount).toBe(0);
      expect(link.drawn).toBe(false);
    });

    it("REGRESSION PIN: the exemption is RECURSION-gated — --no-recursive on the same table still catches a refusal", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = seedSelfLinkTable("table-self-norec");

      table.vetoResultUpdates = new Set(["table-self-norec-link"]);

      const response = await router.route(
        createRequest("table.draw", {
          tableId: "table-self-norec",
          idempotencyKey: "self-norec",
          recursive: false
        })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INTERNAL_ERROR");
      expect(response.error.details.unpersisted).toEqual([
        { tableId: "table-self-norec", resultId: "table-self-norec-link" }
      ]);
    });

    it("REGRESSION PIN: the exemption is REACHABILITY-gated — a one-way nested link (A→B, no cycle) still catches an own-row refusal", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const a = createTableDocument("table-oneway-a", {
        name: "A",
        replacement: false,
        formula: "1d2",
        results: [
          { id: "oneway-a-text", name: "Coins", range: [1, 1] },
          {
            id: "oneway-a-link",
            type: "document",
            name: "toB",
            documentUuid: "RollTable.table-oneway-b",
            range: [2, 2]
          }
        ]
      });
      const b = createTableDocument("table-oneway-b", {
        name: "B",
        replacement: false,
        formula: "1d1",
        results: [{ id: "oneway-b-text", name: "Kobold", range: [1, 1] }]
      });
      globalThis.game.tables.set(a);
      globalThis.game.tables.set(b);
      a.vetoResultUpdates = new Set(["oneway-a-text"]);

      const response = await router.route(
        createRequest("table.draw", { tableId: "table-oneway-a", idempotencyKey: "oneway" })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INTERNAL_ERROR");
      expect(response.error.details.unpersisted).toEqual([
        { tableId: "table-oneway-a", resultId: "oneway-a-text" }
      ]);
    });

    it("DOCUMENTED COST: on a self-reachable recursive singular draw an own-row refusal is caught by AVAILABILITY, not per row", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const table = seedSelfLinkTable("table-self-cost");
      table.vetoResultUpdates = new Set(["table-self-cost-link"]);

      const response = await router.route(
        createRequest("table.draw", { tableId: "table-self-cost", idempotencyKey: "self-cost" })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INTERNAL_ERROR");

      expect(response.error.details).toMatchObject({
        tableId: "table-self-cost",
        persistedAvailableBefore: 2,
        persistedAvailableAfter: 2
      });
      expect(response.error.details.unpersisted).toBeUndefined();
    });

    it("table.draw's confirmation is REAL-path only: a dry run over the same vetoed table still previews", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = seedDrawTable("table-draw-veto-dry", {
        results: [{ id: "dry-1", name: "Rope", range: [1, 1] }]
      });
      table.vetoResultUpdates = new Set(["dry-1"]);

      const response = await router.route(
        createRequest("table.draw", { tableId: "table-draw-veto-dry", idempotencyKey: "dry", dryRun: true })
      );

      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({ dryRun: true, mutation: "not-executed", results: [] });
    });

    /**
     * @param {any} router
     * @param {string} id
     */
    async function poisonLiveFlagsThroughTheBridge(router, id) {
      const table = seedDrawTable(id, {
        results: [
          { id: `${id}-1`, name: "Rope", range: [1, 1] },
          { id: `${id}-2`, name: "Torch", range: [2, 2] },
          { id: `${id}-3`, name: "Rations", range: [3, 3] }
        ]
      });

      table.vetoResultUpdates = new Set([`${id}-1`, `${id}-2`, `${id}-3`]);

      const failed = await router.route(
        createRequest("table.draw", { tableId: id, idempotencyKey: `${id}-veto`, count: 3 })
      );
      expect(failed.ok).toBe(false);
      expect(failed.error.details.unpersisted).toHaveLength(3);
      expect(Array.from(table.results).map((row) => row.drawn)).toEqual([true, true, true]);
      expect(Array.from(table.results).map((row) => row._source.drawn)).toEqual([false, false, false]);
      return table;
    }

    it("a draw in a session with EARLIER-poisoned live flags keeps all four drawn-derived reads in agreement", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const id = "table-scope-agree";
      const table = await poisonLiveFlagsThroughTheBridge(router, id);

      const drew = await router.route(
        createRequest("table.draw", { tableId: id, idempotencyKey: `${id}-next` })
      );
      expect(drew.ok).toBe(true);
      expect(drew.result).toMatchObject({
        mutation: "committed",
        complete: true,
        results: [],
        availableBefore: 3,
        availableAfter: 3
      });

      const got = await router.route(createRequest("table.get", { tableId: id }));
      const storedDrawn = got.result.table.results.map((row) => row.drawn);
      expect(storedDrawn).toEqual([false, false, false]);
      expect(storedDrawn.filter((drawn) => !drawn).length).toBe(drew.result.availableAfter);

      const listed = await router.route(createRequest("table.list", { name: "Restock" }));
      const listedRow = listed.result.tables.find((row) => row.id === id);
      expect(listedRow).toMatchObject({ resultCount: 3, drawnCount: 0 });
      expect(listedRow.resultCount - listedRow.drawnCount).toBe(drew.result.availableAfter);

      const reset = await router.route(createRequest("table.reset", { tableId: id }));
      expect(reset.result.changedCount).toBe(listedRow.drawnCount);
      expect(reset.result.changedCount).toBe(
        (await router.route(createRequest("table.get", { tableId: id }))).result.table.results.length -
          drew.result.availableAfter
      );

      expect(Array.from(table.results).map((row) => row.drawn)).toEqual([true, true, true]);
      expect(Array.from(table.results).map((row) => row._source.drawn)).toEqual([false, false, false]);
    });

    it("DISCLOSED LIMIT: a wholly write-locked table stays undrawable, and `table.reset` repairs it the moment one row can dispatch", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const id = "table-scope-undrawable";
      const table = await poisonLiveFlagsThroughTheBridge(router, id);

      const empty = await router.route(
        createRequest("table.draw", { tableId: id, idempotencyKey: `${id}-empty` })
      );
      expect(empty.ok).toBe(true);
      expect(empty.result).toMatchObject({ results: [], availableBefore: 3, availableAfter: 3 });

      const got = await router.route(createRequest("table.get", { tableId: id }));
      expect(got.result.table.results.map((row) => row.drawn)).toEqual([false, false, false]);
      const lockedReset = await router.route(createRequest("table.reset", { tableId: id }));
      expect(lockedReset.ok).toBe(true);
      expect(lockedReset.result.changedCount).toBe(0);
      expect(Array.from(table.results).map((row) => row.drawn)).toEqual([true, true, true]);

      table.vetoResultUpdates = new Set([`${id}-3`]);
      const repaired = await router.route(createRequest("table.reset", { tableId: id }));
      expect(repaired.ok).toBe(true);

      expect(repaired.result.changedCount).toBe(0);
      expect(repaired.result.changedCount).toBe(lockedReset.result.changedCount);
      expect(Array.from(table.results).map((row) => row.drawn)).toEqual([false, false, false]);
      expect(Array.from(table.results).map((row) => row._source.drawn)).toEqual([false, false, false]);

      const drewAgain = await router.route(
        createRequest("table.draw", { tableId: id, idempotencyKey: `${id}-after-repair` })
      );
      expect(drewAgain.ok).toBe(true);
      expect(drewAgain.result.results.map((row) => row.id)).toEqual([`${id}-1`]);
      expect(drewAgain.result).toMatchObject({ availableBefore: 3, availableAfter: 2 });
    });

    it("table.update reports a VETOED update instead of echoing the unchanged table as ok:true", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = globalThis.game.tables.get("table-1");
      table.update = vi.fn(async () => undefined);

      const response = await router.route(
        createRequest("table.update", { tableId: "table-1", patch: { name: "Vetoed" } })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toMatch(/was NOT updated/);
      expect(response.error.message).toMatch(/preUpdateRollTable/);
      expect(response.error.details).toMatchObject({ tableId: "table-1", fields: ["name"] });
      expect(response.error.details.validationError).toBeNull();
      expect(globalThis.game.tables.get("table-1").name).toBe("Loot");
    });

    it("NO-OP CONTROL: table.update treats an empty-diff patch (also resolves undefined) as success", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = globalThis.game.tables.get("table-1");

      table.update = vi.fn(async () => undefined);

      const response = await router.route(
        createRequest("table.update", { tableId: "table-1", patch: { name: "Loot", formula: "1d6" } })
      );

      expect(response.ok).toBe(true);
      expect(response.result.table).toMatchObject({ id: "table-1", name: "Loot", formula: "1d6" });
    });

    it("table.delete reports a VETOED delete instead of deleted:true", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = globalThis.game.tables.get("table-1");
      table.delete = vi.fn(async () => undefined);

      const response = await router.route(createRequest("table.delete", { tableId: "table-1" }));

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toMatch(/was NOT deleted/);
      expect(response.error.message).toMatch(/preDeleteRollTable/);
      expect(response.error.details).toMatchObject({ tableId: "table-1" });
    });

    it("HEALTHY CONTROL: an ordinary table.delete still answers deleted:true", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(createRequest("table.delete", { tableId: "table-1" }));
      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({ id: "table-1", deleted: true });
    });

    it("table.clone reports a REFUSED clone rather than a fabricated body", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = globalThis.game.tables.get("table-1");

      table.clone = vi.fn(async () => undefined);

      const response = await router.route(createRequest("table.clone", { tableId: "table-1" }));

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    });

    it("table.result.update reports a VETOED row update instead of echoing the unchanged row", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = globalThis.game.tables.get("table-1");
      table.vetoResultUpdates = new Set(["result-1"]);

      const response = await router.route(
        createRequest("table.result.update", {
          tableId: "table-1",
          resultId: "result-1",
          patch: { weight: 7 }
        })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toMatch(/was NOT updated/);
      expect(response.error.message).toMatch(/preUpdateTableResult/);
      expect(response.error.details).toMatchObject({
        tableId: "table-1",
        resultId: "result-1",
        fields: ["weight"]
      });
      expect(table.results.get("result-1")._source.weight).toBe(2);
    });

    it("NO-OP CONTROL: table.result.update treats an empty-diff row patch as success", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = globalThis.game.tables.get("table-1");
      const current = table.results.get("result-1")._source.weight;

      const response = await router.route(
        createRequest("table.result.update", {
          tableId: "table-1",
          resultId: "result-1",
          patch: { weight: current }
        })
      );

      expect(response.ok).toBe(true);
      expect(response.result.result).toMatchObject({ id: "result-1", weight: current });
    });

    it("HEALTHY CONTROL: an unvetoed table.result.update still persists and answers ok:true", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = globalThis.game.tables.get("table-1");

      const response = await router.route(
        createRequest("table.result.update", {
          tableId: "table-1",
          resultId: "result-1",
          patch: { weight: 9 }
        })
      );

      expect(response.ok).toBe(true);
      expect(response.result.result.weight).toBe(9);
      expect(table.results.get("result-1")._source.weight).toBe(9);
    });

    it("table.result.delete reports a VETOED row delete instead of deleted:true", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = globalThis.game.tables.get("table-1");
      table.vetoResultDeletes = new Set(["result-1"]);

      const response = await router.route(
        createRequest("table.result.delete", { tableId: "table-1", resultId: "result-1" })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toMatch(/was NOT deleted/);
      expect(response.error.message).toMatch(/preDeleteTableResult/);
      expect(response.error.details).toMatchObject({ tableId: "table-1", resultId: "result-1" });

      expect(table.results.get("result-1")).not.toBeNull();
    });

    it("HEALTHY CONTROL: an unvetoed table.result.delete still answers deleted:true and removes the row", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = globalThis.game.tables.get("table-1");

      const response = await router.route(
        createRequest("table.result.delete", { tableId: "table-1", resultId: "result-1" })
      );

      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({ tableId: "table-1", id: "result-1", deleted: true });
      expect(table.results.get("result-1")).toBeNull();
    });

    it("row-verb confirmations are REAL-path only: dry runs over a fully vetoed table still preview", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = globalThis.game.tables.get("table-1");
      table.vetoResultUpdates = new Set(["result-1"]);
      table.vetoResultDeletes = new Set(["result-1"]);

      const update = await router.route(
        createRequest("table.result.update", {
          tableId: "table-1",
          resultId: "result-1",
          patch: { weight: 7 },
          dryRun: true
        })
      );
      expect(update.ok).toBe(true);
      expect(update.result).toMatchObject({ dryRun: true });
      expect(update.result.result.weight).toBe(7);

      const remove = await router.route(
        createRequest("table.result.delete", { tableId: "table-1", resultId: "result-1", dryRun: true })
      );
      expect(remove.ok).toBe(true);
      expect(remove.result).toMatchObject({ dryRun: true, deleted: false });
      expect(table.results.get("result-1")).not.toBeNull();
    });
  });

  it("rejects write commands for non-GM sessions", async () => {
    globalThis.game.user.isGM = false;

    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(
      createRequest("item.update", {
        itemId: "item-1",
        patch: {
          name: "Renamed Longsword"
        }
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("PERMISSION_DENIED");
  });

  it("rejects file upload for non-GM sessions", async () => {
    globalThis.game.user.isGM = false;

    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(
      createRequest("file.upload", {
        path: "worlds/world-1/upload.txt",
        contentBase64: Buffer.from("upload", "utf8").toString("base64")
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("PERMISSION_DENIED");
  });

  describe("list projection + pagination", () => {
    const connectedRouter = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    function seedFiveItems() {
      const collection = globalThis.game.items;
      for (let i = 2; i <= 5; i += 1) {
        collection.set(
          createDocument(`item-${i}`, {
            name: `Item ${i}`,
            type: "weapon",
            img: `icons/item-${i}.svg`,
            sort: i * 10,
            folder: null,
            system: { damage: `${i}d6` }
          })
        );
      }
    }

    it("returns item summaries (no system body) on item.list, but full system on item.get", async () => {
      const router = connectedRouter();

      const list = await router.route(createRequest("item.list"));
      expect(list.ok).toBe(true);
      expect(list.result.items).toHaveLength(1);
      expect(list.result.total).toBe(1);
      expect(list.result.hasMore).toBe(false);

      expect(list.result.items[0]).toEqual({
        id: "item-1",
        _id: "item-1",
        name: "Longsword",
        type: "weapon",
        img: "icons/svg/sword.svg",
        folder: null,
        sort: 10,
        effectCount: 0
      });
      expect(list.result.items[0]).not.toHaveProperty("system");

      const get = await router.route(createRequest("item.get", { itemId: "item-1" }));
      expect(get.ok).toBe(true);
      expect(get.result.item.system).toEqual({ damage: "1d8" });
    });

    it("returns journal summaries (pageCount, no pages) on journal.list, full pages on journal.get", async () => {
      const router = connectedRouter();

      const list = await router.route(createRequest("journal.list", { name: "GM Notes" }));
      expect(list.ok).toBe(true);
      expect(list.result.journals).toHaveLength(1);
      expect(list.result.total).toBe(1);
      expect(list.result.hasMore).toBe(false);
      expect(list.result.journals[0]).toEqual({
        id: "journal-1",
        _id: "journal-1",
        name: "GM Notes",
        folder: null,
        sort: 0,
        pageCount: 1,
        categoryCount: 0
      });
      expect(list.result.journals[0]).not.toHaveProperty("pages");

      const get = await router.route(createRequest("journal.get", { journalId: "journal-1" }));
      expect(get.ok).toBe(true);
      expect(get.result.journal.pages[0].text.content).toBe("Secret text");
      expect(get.result.journal).toHaveProperty("flags");
      expect(typeof get.result.journal.flags).toBe("object");
    });

    it("slices with offset/limit and reports total + hasMore at boundaries", async () => {
      seedFiveItems();
      const router = connectedRouter();

      const all = await router.route(createRequest("item.list"));
      expect(all.result.items).toHaveLength(5);
      expect(all.result.total).toBe(5);
      expect(all.result.hasMore).toBe(false);

      const first = await router.route(createRequest("item.list", { limit: 2, offset: 0 }));
      expect(first.result.items.map((i) => i.id)).toEqual(["item-1", "item-2"]);
      expect(first.result.total).toBe(5);
      expect(first.result.hasMore).toBe(true);

      const middle = await router.route(createRequest("item.list", { limit: 2, offset: 2 }));
      expect(middle.result.items.map((i) => i.id)).toEqual(["item-3", "item-4"]);
      expect(middle.result.hasMore).toBe(true);

      const last = await router.route(createRequest("item.list", { limit: 2, offset: 4 }));
      expect(last.result.items.map((i) => i.id)).toEqual(["item-5"]);
      expect(last.result.total).toBe(5);
      expect(last.result.hasMore).toBe(false);

      const atEnd = await router.route(createRequest("item.list", { limit: 2, offset: 5 }));
      expect(atEnd.result.items).toEqual([]);
      expect(atEnd.result.total).toBe(5);
      expect(atEnd.result.hasMore).toBe(false);

      const beyond = await router.route(createRequest("item.list", { limit: 2, offset: 99 }));
      expect(beyond.result.items).toEqual([]);
      expect(beyond.result.total).toBe(5);
      expect(beyond.result.hasMore).toBe(false);

      const fromOffset = await router.route(createRequest("item.list", { offset: 3 }));
      expect(fromOffset.result.items.map((i) => i.id)).toEqual(["item-4", "item-5"]);
      expect(fromOffset.result.hasMore).toBe(false);
    });

    it("paginates scene.token.list with summaries", async () => {
      const router = connectedRouter();

      const page = await router.route(
        createRequest("scene.token.list", { sceneId: "scene-1", limit: 1, offset: 0 })
      );
      expect(page.ok).toBe(true);
      expect(page.result.tokens).toHaveLength(1);
      expect(page.result.total).toBe(2);
      expect(page.result.hasMore).toBe(true);

      expect(page.result.tokens[0]).not.toHaveProperty("texture");
    });

    it("paginates compendium.index and reports total + hasMore", async () => {
      const router = connectedRouter();

      const full = await router.route(createRequest("compendium.index", { pack: "world.test-monsters" }));
      expect(full.result.entries).toHaveLength(1);
      expect(full.result.total).toBe(1);
      expect(full.result.hasMore).toBe(false);

      const empty = await router.route(
        createRequest("compendium.index", { pack: "world.test-monsters", offset: 1 })
      );
      expect(empty.result.entries).toEqual([]);
      expect(empty.result.total).toBe(1);
      expect(empty.result.hasMore).toBe(false);
    });

    it("paginates file.list entries and reports total + hasMore over the directory", async () => {
      const router = connectedRouter();

      const full = await router.route(createRequest("file.list", { path: "worlds/world-1" }));
      expect(full.result.entries).toHaveLength(2);
      expect(full.result.total).toBe(2);
      expect(full.result.hasMore).toBe(false);

      const first = await router.route(
        createRequest("file.list", { path: "worlds/world-1", limit: 1, offset: 0 })
      );
      expect(first.result.entries).toHaveLength(1);
      expect(first.result.total).toBe(2);
      expect(first.result.hasMore).toBe(true);

      const second = await router.route(
        createRequest("file.list", { path: "worlds/world-1", limit: 1, offset: 1 })
      );
      expect(second.result.entries).toHaveLength(1);
      expect(second.result.total).toBe(2);
      expect(second.result.hasMore).toBe(false);

      expect(second.result.entries[0].path).not.toBe(first.result.entries[0].path);
    });
  });

  describe("server-side name substring filter", () => {
    const connectedRouter = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    function seedSwords() {
      const collection = globalThis.game.items;
      collection.set(
        createDocument("item-shortsword", { name: "Shortsword", type: "weapon", folder: null, system: {} })
      );
      collection.set(
        createDocument("item-shield", { name: "Shield", type: "equipment", folder: null, system: {} })
      );
      collection.set(
        createDocument("item-dagger", { name: "Dagger", type: "weapon", folder: null, system: {} })
      );
    }

    it("filters item.list server-side: total is the FILTERED count and only matches are serialized", async () => {
      seedSwords();
      const router = connectedRouter();

      const unfiltered = await router.route(createRequest("item.list"));
      expect(unfiltered.result.total).toBe(4);

      const filtered = await router.route(createRequest("item.list", { name: "SWORD" }));
      expect(filtered.ok).toBe(true);

      expect(filtered.result.total).toBe(2);
      expect(filtered.result.hasMore).toBe(false);
      const names = filtered.result.items.map((i) => i.name).sort();
      expect(names).toEqual(["Longsword", "Shortsword"]);

      expect(filtered.result.items.every((i) => /sword/i.test(i.name))).toBe(true);
    });

    it("composes the name filter with pagination over the FILTERED set", async () => {
      seedSwords();
      const router = connectedRouter();

      const first = await router.route(createRequest("item.list", { name: "sword", limit: 1, offset: 0 }));
      expect(first.result.items).toHaveLength(1);
      expect(first.result.total).toBe(2);
      expect(first.result.hasMore).toBe(true);

      const second = await router.route(createRequest("item.list", { name: "sword", limit: 1, offset: 1 }));
      expect(second.result.items).toHaveLength(1);
      expect(second.result.total).toBe(2);
      expect(second.result.hasMore).toBe(false);
      expect(second.result.items[0].name).not.toBe(first.result.items[0].name);
    });

    it("returns a well-formed empty list (total:0, hasMore:false) for a zero-match name", async () => {
      const router = connectedRouter();
      const none = await router.route(createRequest("item.list", { name: "no-such-item" }));
      expect(none.ok).toBe(true);
      expect(none.result.items).toEqual([]);
      expect(none.result.total).toBe(0);
      expect(none.result.hasMore).toBe(false);
    });

    it("filters actor.list by name, total reflects the filtered actors", async () => {
      const router = connectedRouter();

      globalThis.game.actors.set(
        createActorDocument("actor-shadow", { name: "Shadow Spirit (Fear)", type: "npc" })
      );
      globalThis.game.actors.set(createActorDocument("actor-goblin", { name: "Goblin", type: "npc" }));

      const unfiltered = await router.route(createRequest("actor.list"));
      expect(unfiltered.result.total).toBe(3);

      const filtered = await router.route(createRequest("actor.list", { name: "shadow spirit" }));
      expect(filtered.ok).toBe(true);
      expect(filtered.result.total).toBe(1);
      expect(filtered.result.hasMore).toBe(false);
      expect(filtered.result.actors[0].name).toBe("Shadow Spirit (Fear)");
    });

    it("filters scene.token.list by name, total reflects the filtered tokens", async () => {
      const router = connectedRouter();

      const filtered = await router.route(
        createRequest("scene.token.list", { sceneId: "scene-1", name: "linked" })
      );
      expect(filtered.result.tokens).toHaveLength(1);
      expect(filtered.result.total).toBe(1);
      expect(filtered.result.tokens[0].name).toBe("Linked Valeros");
    });

    it("filters compendium.index entries on the wire", async () => {
      const router = connectedRouter();

      const hit = await router.route(
        createRequest("compendium.index", { pack: "world.test-monsters", name: "arch" })
      );
      expect(hit.result.entries.map((e) => e.name)).toEqual(["Archmage"]);
      expect(hit.result.total).toBe(1);

      const miss = await router.route(
        createRequest("compendium.index", { pack: "world.test-monsters", name: "dragon" })
      );
      expect(miss.result.entries).toEqual([]);
      expect(miss.result.total).toBe(0);
      expect(miss.result.hasMore).toBe(false);
    });

    it("narrows compendium.index name matching with exact:true", async () => {
      const router = connectedRouter();

      const substr = await router.route(
        createRequest("compendium.index", { pack: "world.test-monsters", name: "arch" })
      );
      expect(substr.result.entries.map((e) => e.name)).toEqual(["Archmage"]);

      const exactMiss = await router.route(
        createRequest("compendium.index", { pack: "world.test-monsters", name: "arch", exact: true })
      );
      expect(exactMiss.result.entries).toEqual([]);

      const exactHit = await router.route(
        createRequest("compendium.index", { pack: "world.test-monsters", name: "archmage", exact: true })
      );
      expect(exactHit.result.entries.map((e) => e.name)).toEqual(["Archmage"]);
    });

    it("passes fields to pack.getIndex and returns them at their dot-paths", async () => {
      const router = connectedRouter();
      const pack = globalThis.game.packs.get("world.test-monsters");

      const response = await router.route(
        createRequest("compendium.index", {
          pack: "world.test-monsters",
          fields: ["flags.ddbimporter.definitionId"]
        })
      );
      expect(response.ok).toBe(true);
      expect(pack.getIndex).toHaveBeenCalledWith({ fields: ["flags.ddbimporter.definitionId"] });
      expect(response.result.entries[0]).toMatchObject({
        id: "arch1",
        _id: "arch1",
        name: "Archmage",
        flags: { ddbimporter: { definitionId: 42 } }
      });

      const plain = await router.route(createRequest("compendium.index", { pack: "world.test-monsters" }));
      expect(plain.result.entries[0]).not.toHaveProperty("flags");
    });

    it("recovers a requested field even when getIndex returns it under a FLATTENED literal key", async () => {
      const router = connectedRouter();
      const pack = globalThis.game.packs.get("world.test-monsters");
      const original = pack.getIndex;
      pack.getIndex = vi.fn(async () => [
        {
          _id: "arch1",
          name: "Archmage",
          type: "npc",
          img: "compendium/archmage.png",
          "system.source": "SRD"
        }
      ]);
      try {
        const response = await router.route(
          createRequest("compendium.index", { pack: "world.test-monsters", fields: ["system.source"] })
        );
        expect(response.ok).toBe(true);
        expect(response.result.entries[0]).toMatchObject({
          id: "arch1",
          system: { source: "SRD" }
        });
      } finally {
        pack.getIndex = original;
      }
    });

    it("composes the name filter with folder.list's existing type filter", async () => {
      const router = connectedRouter();

      const both = await router.route(createRequest("folder.list", { name: "test" }));
      expect(both.result.total).toBe(2);

      const narrowed = await router.route(createRequest("folder.list", { name: "test", type: "Actor" }));
      expect(narrowed.result.total).toBe(1);
      expect(narrowed.result.folders[0]).toMatchObject({ name: "Test", type: "Actor" });
    });
  });

  describe("server-side dry-run", () => {
    const connectedRouter = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    it("update (item.update): returns the merged would-be doc in `item`, dryRun:true, no Document.update", async () => {
      const router = connectedRouter();
      const item = globalThis.game.items.get("item-1");

      const response = await router.route(
        createRequest("item.update", { itemId: "item-1", patch: { name: "Renamed" }, dryRun: true })
      );

      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);

      expect(response.result.item.name).toBe("Renamed");
      expect(response.result.item.id).toBe("item-1");
      expect(response.result).not.toHaveProperty("preview");
      expect(item.update).not.toHaveBeenCalled();
    });

    it("update dry-run preview reflects Foundry merge semantics and never persists", async () => {
      const router = connectedRouter();

      const original = {
        name: "Preview Sword",
        type: "weapon",
        system: {
          damage: "1d8",
          activation: { type: "action", cost: 1 },
          properties: ["mgc"]
        }
      };
      const doc = createDocument("item-preview", original);
      globalThis.game.items.set(doc);

      const response = await router.route(
        createRequest("item.update", {
          itemId: "item-preview",
          patch: {
            system: {
              activation: { cost: 3 },

              properties: ["fin", "two-handed"],

              "-=damage": null
            }
          },
          dryRun: true
        })
      );

      expect(response.ok, JSON.stringify(response.error)).toBe(true);
      expect(response.result.dryRun).toBe(true);
      const previewSystem = response.result.item.system;

      expect(previewSystem.activation).toEqual({ type: "action", cost: 3 });

      expect(previewSystem.properties).toEqual(["fin", "two-handed"]);

      expect(previewSystem.damage).toBeUndefined();

      expect(doc.update).not.toHaveBeenCalled();
      const reread = await router.route(createRequest("item.get", { itemId: "item-preview" }));
      expect(reread.result.item.system).toEqual(original.system);
    });

    it("update dry-run FAILS (INVALID_PARAMS) when the PATCH is invalid", async () => {
      const router = connectedRouter();

      const doc = createDocument(
        "item-invalid",
        { name: "Broken", type: "weapon" },
        {
          validatePreview: (patch) => (patch.type === "not-a-real-type" ? "type: invalid value" : null)
        }
      );
      globalThis.game.items.set(doc);

      const response = await router.route(
        createRequest("item.update", {
          itemId: "item-invalid",
          patch: { type: "not-a-real-type" },
          dryRun: true
        })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(doc.update).not.toHaveBeenCalled();
    });

    it("update dry-run SUCCEEDS when only an UNTOUCHED field is invalid (validation scope = the patch)", async () => {
      const router = connectedRouter();

      const doc = createDocument(
        "item-legacy",

        { name: "Legacy", type: "not-a-real-type", system: { damage: "1d6" } },
        {
          validatePreview: (patch) => (patch.type === "not-a-real-type" ? "type: invalid value" : null)
        }
      );
      globalThis.game.items.set(doc);

      const response = await router.route(
        createRequest("item.update", {
          itemId: "item-legacy",
          patch: { name: "Renamed", system: { damage: "1d8" } },
          dryRun: true
        })
      );

      expect(response.ok, JSON.stringify(response.error)).toBe(true);
      expect(response.result.dryRun).toBe(true);

      expect(response.result.item.name).toBe("Renamed");
      expect(response.result.item.system.damage).toBe("1d8");
      expect(response.result.item.type).toBe("not-a-real-type");
      expect(response.result).not.toHaveProperty("preview");
      expect(doc.update).not.toHaveBeenCalled();
    });

    it("delete (item.delete): returns deleted:false, dryRun:true, no Document.delete", async () => {
      const router = connectedRouter();
      const item = globalThis.game.items.get("item-1");

      const response = await router.route(createRequest("item.delete", { itemId: "item-1", dryRun: true }));

      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result.deleted).toBe(false);
      expect(item.delete).not.toHaveBeenCalled();
    });

    it("clone (item.clone): returns the merged preview with a nulled id, dryRun:true, non-persisting save:false clone", async () => {
      const router = connectedRouter();
      const item = globalThis.game.items.get("item-1");

      const response = await router.route(
        createRequest("item.clone", { itemId: "item-1", patch: { name: "Copy" }, dryRun: true })
      );

      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);

      expect(response.result.item.id).toBeNull();

      expect(response.result.item._id).toBeNull();
      expect(response.result.item.name).toBe("Copy");

      expect(item.clone).toHaveBeenCalledWith({ name: "Copy" }, { save: false });
    });

    it("clone dry-run applies `-=key` deletions (matching a real Document#clone's performDeletions)", async () => {
      const router = connectedRouter();

      const doc = createDocument("item-clone-del", {
        name: "Deletable",
        type: "weapon",
        system: { damage: "1d8", weight: 3 }
      });
      globalThis.game.items.set(doc);

      const response = await router.route(
        createRequest("item.clone", {
          itemId: "item-clone-del",
          patch: { system: { "-=damage": null } },
          dryRun: true
        })
      );

      expect(response.ok, JSON.stringify(response.error)).toBe(true);
      expect(response.result.dryRun).toBe(true);

      expect(response.result.item.system.damage).toBeUndefined();

      expect(response.result.item.system.weight).toBe(3);
      expect(response.result.item.id).toBeNull();

      expect(doc.clone).toHaveBeenCalledWith({ system: { "-=damage": null } }, { save: false });
    });

    it("clone dry-run tolerates legacy-invalid UNTOUCHED source (previews at save:false, not strict:true)", async () => {
      const router = connectedRouter();

      const doc = createDocument(
        "item-legacy-invalid",
        { name: "Legacy", type: "weapon", system: { damage: "1d8" } },
        { validatePreview: () => "legacy-invalid source" }
      );
      globalThis.game.items.set(doc);

      const response = await router.route(
        createRequest("item.clone", { itemId: "item-legacy-invalid", patch: { name: "Copy" }, dryRun: true })
      );

      expect(response.ok, JSON.stringify(response.error)).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result.item.name).toBe("Copy");
      expect(response.result.item.id).toBeNull();
      expect(doc.clone).toHaveBeenCalledWith({ name: "Copy" }, { save: false });
    });

    it("create (item.create): dry-run returns the would-be doc (defaults applied, id null) in the item key, no preview/echo, no Item.create", async () => {
      const router = connectedRouter();

      globalThis.game.items.documentClass = makeDocumentClass({
        create: globalThis.Item.create,
        applyDefaults: () => ({ img: "icons/svg/item-bag.svg" })
      });

      const response = await router.route(
        createRequest("item.create", { data: { name: "Potion", type: "consumable" }, dryRun: true })
      );

      expect(response.ok, JSON.stringify(response.error)).toBe(true);
      expect(response.result.dryRun).toBe(true);

      expect(response.result.item.name).toBe("Potion");
      expect(response.result.item.type).toBe("consumable");
      expect(response.result.item.img).toBe("icons/svg/item-bag.svg");
      expect(response.result.item.id).toBeNull();
      expect(response.result).not.toHaveProperty("preview");

      expect(globalThis.Item.create).not.toHaveBeenCalled();
      const list = await router.route(createRequest("item.list"));
      expect(list.result.items.some((item) => item.name === "Potion")).toBe(false);
    });

    it("create dry-run FAILS (INVALID_PARAMS) when the constructed document is invalid", async () => {
      const router = connectedRouter();

      globalThis.game.items.documentClass = makeDocumentClass({
        create: globalThis.Item.create,
        validatePreview: (source) => (source.type === "not-a-real-type" ? "type: invalid value" : null)
      });

      const response = await router.route(
        createRequest("item.create", { data: { name: "Broken", type: "not-a-real-type" }, dryRun: true })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(globalThis.Item.create).not.toHaveBeenCalled();
    });

    it("embedded create (actor.item.create): returns the validated would-be item (defaults, id null), no create", async () => {
      const router = connectedRouter();
      const actor = globalThis.game.actors.get("actor-1");

      actor.items.documentClass = makeDocumentClass({
        applyDefaults: () => ({ img: "icons/svg/sword.svg" })
      });

      const response = await router.route(
        createRequest("actor.item.create", {
          actorId: "actor-1",
          data: { name: "Rapier", type: "weapon" },
          dryRun: true
        })
      );

      expect(response.ok, JSON.stringify(response.error)).toBe(true);
      expect(response.result.dryRun).toBe(true);

      expect(response.result.item.name).toBe("Rapier");
      expect(response.result.item.img).toBe("icons/svg/sword.svg");
      expect(response.result.item.id).toBeNull();
      expect(response.result).not.toHaveProperty("preview");

      expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("embedded create dry-run FAILS (INVALID_PARAMS) when the constructed document is invalid", async () => {
      const router = connectedRouter();
      const actor = globalThis.game.actors.get("actor-1");
      actor.items.documentClass = makeDocumentClass({
        validatePreview: (source) => (source.type === "not-a-real-type" ? "type: invalid value" : null)
      });

      const response = await router.route(
        createRequest("actor.item.create", {
          actorId: "actor-1",
          data: { name: "Broken", type: "not-a-real-type" },
          dryRun: true
        })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("import-from-compendium: resolves the pack entry, dryRun:true, no importFromCompendium", async () => {
      const router = connectedRouter();

      const response = await router.route(
        createRequest("actor.import-from-compendium", {
          pack: "world.test-monsters",
          entryId: "arch1",
          dryRun: true
        })
      );

      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);

      expect(response.result.actor.name).toBe("Archmage");
      expect(globalThis.game.actors.importFromCompendium).not.toHaveBeenCalled();
    });

    it("import-from-compendium: COMPENDIUM_ENTRY_NOT_FOUND still fires under dryRun", async () => {
      const router = connectedRouter();

      const response = await router.route(
        createRequest("actor.import-from-compendium", {
          pack: "world.test-monsters",
          entryId: "missing",
          dryRun: true
        })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("COMPENDIUM_ENTRY_NOT_FOUND");
      expect(globalThis.game.actors.importFromCompendium).not.toHaveBeenCalled();
    });

    it("scene create-from-actor token: resolves the actor, no createEmbeddedDocuments", async () => {
      const router = connectedRouter();
      const scene = globalThis.game.scenes.get("scene-1");

      const response = await router.route(
        createRequest("scene.token.create", {
          sceneId: "scene-1",
          data: { actorId: "actor-1" },
          dryRun: true
        })
      );

      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);

      expect(response.result.token.actorId).toBe("actor-1");
      expect(response.result.token.id).toBeNull();
      expect(response.result).not.toHaveProperty("preview");
      expect(scene.createEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("embedded update (scene.token.item.update): no updateEmbeddedDocuments on the delta actor", async () => {
      const router = connectedRouter();
      const deltaActor = globalThis.game.scenes.get("scene-1").tokens.get("token-a").actor;

      const response = await router.route(
        createRequest("scene.token.item.update", {
          sceneId: "scene-1",
          tokenId: "token-a",
          itemId: "delta-item-1",
          patch: { name: "Renamed Dagger" },
          dryRun: true
        })
      );

      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);

      expect(response.result.item.name).toBe("Renamed Dagger");
      expect(response.result).not.toHaveProperty("preview");
      expect(deltaActor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("file.mkdir: returns the would-be directory, dryRun:true, no FilePicker.createDirectory", async () => {
      const router = connectedRouter();

      const response = await router.route(
        createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli/assets", dryRun: true })
      );

      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result.directory.path).toBe("worlds/world-1/fvtt-world-cli/assets");
      expect(
        globalThis.foundry.applications.apps.FilePicker.implementation.createDirectory
      ).not.toHaveBeenCalled();
    });

    it("file.upload: returns the would-be file, dryRun:true, no FilePicker.upload", async () => {
      const router = connectedRouter();

      const response = await router.route(
        createRequest("file.upload", {
          path: "worlds/world-1/fvtt-world-cli/token.txt",
          contentBase64: Buffer.from("token-data", "utf8").toString("base64"),
          mimeType: "text/plain",
          dryRun: true
        })
      );

      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result.file.path).toBe("worlds/world-1/fvtt-world-cli/token.txt");
      expect(globalThis.foundry.applications.apps.FilePicker.implementation.upload).not.toHaveBeenCalled();
    });

    it("NOT_FOUND still fires under dryRun (scene.update of a missing scene)", async () => {
      const router = connectedRouter();

      const response = await router.route(
        createRequest("scene.update", { sceneId: "nope", patch: { name: "X" }, dryRun: true })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("SCENE_NOT_FOUND");
    });

    it("DELETE_FORBIDDEN still fires under dryRun (active scene delete without force)", async () => {
      const router = connectedRouter();
      const scene = globalThis.game.scenes.get("scene-1");

      const response = await router.route(
        createRequest("scene.delete", { sceneId: "scene-1", dryRun: true })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("DELETE_FORBIDDEN");
      expect(scene.delete).not.toHaveBeenCalled();
    });

    it("DELETE_FORBIDDEN still fires under dryRun (actor referenced by a token)", async () => {
      const router = connectedRouter();
      const actor = globalThis.game.actors.get("actor-1");

      const response = await router.route(
        createRequest("actor.delete", { actorId: "actor-1", dryRun: true })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("DELETE_FORBIDDEN");
      expect(actor.delete).not.toHaveBeenCalled();
    });

    it("PERMISSION_DENIED still fires under dryRun for a non-GM session", async () => {
      globalThis.game.user.isGM = false;
      const router = connectedRouter();
      const item = globalThis.game.items.get("item-1");

      const response = await router.route(
        createRequest("item.update", { itemId: "item-1", patch: { name: "X" }, dryRun: true })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("PERMISSION_DENIED");
      expect(item.update).not.toHaveBeenCalled();
    });

    it("PATH_NOT_ALLOWED still fires under dryRun for a file write outside the managed root", async () => {
      const router = connectedRouter();

      const response = await router.route(
        createRequest("file.mkdir", { path: "modules/evil", dryRun: true })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("PATH_NOT_ALLOWED");
      expect(
        globalThis.foundry.applications.apps.FilePicker.implementation.createDirectory
      ).not.toHaveBeenCalled();
    });

    it("PAYLOAD_TOO_LARGE still fires under dryRun for an oversized file.upload", async () => {
      const uploadLimitBytes = 1024;
      const router = createCommandRouter({
        bridgeClient: {
          getStatus: () => ({ status: "connected" }),
          getEffectiveLimits: () => ({ uploadBytes: uploadLimitBytes, wsMaxPayloadBytes: 4 * 1024 * 1024 })
        }
      });
      const oversized = Buffer.alloc(uploadLimitBytes + 1).toString("base64");

      const response = await router.route(
        createRequest("file.upload", {
          path: "worlds/world-1/fvtt-world-cli/huge.bin",
          contentBase64: oversized,
          dryRun: true
        })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("PAYLOAD_TOO_LARGE");
      expect(response.error.details.limitBytes).toBe(uploadLimitBytes);
      expect(response.error.details.actualBytes).toBe(uploadLimitBytes + 1);

      expect(response.error.message).toBe(
        `Upload payload for worlds/world-1/fvtt-world-cli/huge.bin is ${uploadLimitBytes + 1} bytes ` +
          `but the effective upload limit is ${uploadLimitBytes} bytes; raise uploadLimitBytes in ` +
          `the daemon config (max ${512 * 1024 * 1024} bytes) and restart the daemon, or shrink the asset`
      );
      expect(globalThis.foundry.applications.apps.FilePicker.implementation.upload).not.toHaveBeenCalled();
    });

    it("honors the daemon default (no getEffectiveLimits) for a modest file.upload", async () => {
      const router = createCommandRouter({
        bridgeClient: { getStatus: () => ({ status: "connected" }) }
      });
      const modest = Buffer.alloc(8 * 1024 * 1024).toString("base64");

      const response = await router.route(
        createRequest("file.upload", {
          path: "worlds/world-1/fvtt-world-cli/modest.bin",
          contentBase64: modest,
          dryRun: true
        })
      );

      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
    });
  });

  describe("stable mappable error codes", () => {
    let consoleErrorSpy;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();

      delete globalThis.foundry;
    });

    it("maps a Foundry validation error (by name) to INVALID_PARAMS, not INTERNAL_ERROR", async () => {
      const router = createCommandRouter({
        bridgeClient: { getStatus: () => ({ status: "connected" }) }
      });

      const validationError = new Error("foo is not a valid value for Actor#system.bar");
      validationError.name = "DataModelValidationError";
      globalThis.game.actors.get("actor-1").update = vi.fn(async () => {
        throw validationError;
      });

      const response = await router.route(
        createRequest("actor.update", { actorId: "actor-1", patch: { name: "Renamed" } })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.code).not.toBe("INTERNAL_ERROR");
      expect(response.error.details.reason).toBe("foundry_validation");
      expect(response.error.details.message).toBe("foo is not a valid value for Actor#system.bar");
    });

    it("maps a Foundry validation error (by instanceof) to INVALID_PARAMS", async () => {
      class DataModelValidationError extends Error {}
      globalThis.foundry = { data: { validation: { DataModelValidationError } } };

      const instanceError = new DataModelValidationError("required field name is missing");
      instanceError.name = "Error";
      globalThis.game.actors.get("actor-1").update = vi.fn(async () => {
        throw instanceError;
      });

      const router = createCommandRouter({
        bridgeClient: { getStatus: () => ({ status: "connected" }) }
      });

      const response = await router.route(
        createRequest("actor.update", { actorId: "actor-1", patch: { name: "Renamed" } })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.details.reason).toBe("foundry_validation");
      expect(response.error.details.message).toBe("required field name is missing");
    });

    it("forwards structured Foundry validation field failures under details.errors", async () => {
      const validationError = /** @type {any} */ (new Error("Actor validation failed"));
      validationError.name = "DataModelValidationError";

      validationError.getAllFailures = () => ({
        "system.attributes.hp.value": { message: "must be a number" },
        name: { message: "may not be empty" }
      });
      globalThis.game.actors.get("actor-1").update = vi.fn(async () => {
        throw validationError;
      });

      const router = createCommandRouter({
        bridgeClient: { getStatus: () => ({ status: "connected" }) }
      });

      const response = await router.route(
        createRequest("actor.update", { actorId: "actor-1", patch: { name: "Renamed" } })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.details.reason).toBe("foundry_validation");
      expect(response.error.details.errors).toEqual(["system.attributes.hp.value", "name"]);
    });

    it("maps a truly unexpected error to INTERNAL_ERROR with details.message", async () => {
      const router = createCommandRouter({
        bridgeClient: { getStatus: () => ({ status: "connected" }) }
      });

      globalThis.game.actors.get("actor-1").update = vi.fn(async () => {
        throw new Error("kaboom in the document layer");
      });

      const response = await router.route(
        createRequest("actor.update", { actorId: "actor-1", patch: { name: "Renamed" } })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INTERNAL_ERROR");
      expect(response.error.details.message).toBe("kaboom in the document layer");

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("carries details.message on a BridgeError(INTERNAL_ERROR) from the document layer", async () => {
      const router = createCommandRouter({
        bridgeClient: { getStatus: () => ({ status: "connected" }) }
      });

      globalThis.Actor.create = vi.fn(async () => null);

      const response = await router.route(
        createRequest("actor.create", { data: { name: "Ghost", type: "npc" } })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INTERNAL_ERROR");
      expect(response.error.details.message).toBe("Actor.create returned no document");
    });

    it("includes raw message on toFileError FILE_NOT_FOUND while preserving the code", async () => {
      const router = createCommandRouter({
        bridgeClient: { getStatus: () => ({ status: "connected" }) }
      });

      const response = await router.route(
        createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli/missing-parent/leaf" })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("FILE_NOT_FOUND");
      expect(response.error.details.message).toMatch(/path not found/i);
    });

    it("includes raw message on toFileError PATH_NOT_ALLOWED while preserving the code", async () => {
      const router = createCommandRouter({
        bridgeClient: { getStatus: () => ({ status: "connected" }) }
      });

      await router.route(createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli" }));
      globalThis.foundry.applications.apps.FilePicker.implementation.upload = vi.fn(async () => {
        throw new Error("You are not allowed to upload to this directory");
      });

      const response = await router.route(
        createRequest("file.upload", {
          path: "worlds/world-1/fvtt-world-cli/denied.txt",
          contentBase64: Buffer.from("nope", "utf8").toString("base64")
        })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("PATH_NOT_ALLOWED");
      expect(response.error.details.message).toMatch(/not allowed to upload/i);
    });

    it("includes raw message on toFileError INTERNAL_ERROR for an unclassifiable failure", async () => {
      const router = createCommandRouter({
        bridgeClient: { getStatus: () => ({ status: "connected" }) }
      });

      await router.route(createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli" }));
      globalThis.foundry.applications.apps.FilePicker.implementation.upload = vi.fn(async () => {
        throw new Error("disk on fire");
      });

      const response = await router.route(
        createRequest("file.upload", {
          path: "worlds/world-1/fvtt-world-cli/ok.txt",
          contentBase64: Buffer.from("data", "utf8").toString("base64")
        })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INTERNAL_ERROR");
      expect(response.error.details.message).toBe("disk on fire");
    });

    it("file.stat on a missing file under an existing parent carries details.message", async () => {
      const router = createCommandRouter({
        bridgeClient: { getStatus: () => ({ status: "connected" }) }
      });

      const response = await router.route(
        createRequest("file.stat", { path: "worlds/world-1/does-not-exist.txt" })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("FILE_NOT_FOUND");
      expect(response.error.details.path).toBe("worlds/world-1/does-not-exist.txt");
      expect(response.error.details.message).toMatch(/path not found/i);
    });

    it("file.read on a fetch-404 path carries details.message", async () => {
      const router = createCommandRouter({
        bridgeClient: { getStatus: () => ({ status: "connected" }) }
      });

      const target = "worlds/world-1/fvtt-world-cli/ghost.txt";
      await router.route(createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli" }));
      const parent = globalThis.__routerTestState.directoryContents.get("worlds/world-1/fvtt-world-cli");
      parent.files = [...parent.files, { path: target, size: 4, mimeType: "text/plain" }];
      globalThis.__routerTestState.fetchOverrides.set(
        target,
        createFetchResponse({ ok: false, status: 404, bytes: new Uint8Array() })
      );

      const response = await router.route(createRequest("file.read", { path: target, encoding: "text" }));

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("FILE_NOT_FOUND");
      expect(response.error.details.message).toMatch(/404/);
    });
  });
});
