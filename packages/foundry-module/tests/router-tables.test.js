import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";

import { withQueuedTableOwnership } from "../scripts/handlers/tables.js";

import {
  assertTableDrawCountSupported,
  evaluateTableDrawEvidence,
  isTableDrawCleanRefusal,
  snapshotTableDrawEvidence
} from "../scripts/lib/table-docs.js";

import { ERROR_CODES, TABLE_MUTATION_OUTCOMES } from "../scripts/generated/protocol.js";

import {
  createDocument,
  createRequest,
  createTableDocument,
  installFakeFoundry,
  makeDataModelValidationError,
  setRowDrawn
} from "./helpers/fake-foundry.js";

describe("command router", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  it("lists, gets, creates, updates, clones, and deletes roll tables", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("table.list"));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.tables).toHaveLength(1);

    expect(listResponse.result.tables[0]).toMatchObject({
      id: "table-1",
      name: "Loot",
      formula: "1d6",
      replacement: false,
      resultCount: 2,
      drawnCount: 1
    });
    expect(listResponse.result.tables[0].results).toBeUndefined();
    expect(listResponse.result.tables[0].flags).toBeUndefined();

    const getResponse = await router.route(createRequest("table.get", { tableId: "table-1" }));
    expect(getResponse.ok).toBe(true);

    expect(getResponse.result.table.results).toHaveLength(2);
    expect(getResponse.result.table.results[0]).toMatchObject({
      id: "result-1",
      type: "text",
      name: "Sword",
      range: [1, 3],
      weight: 2,
      drawn: false
    });
    expect(getResponse.result.table.results[1]).toMatchObject({
      type: "document",
      documentUuid: "Actor.abc",
      drawn: true
    });
    expect(getResponse.result.table.ownership).toEqual({ default: 0 });

    const getManyResponse = await router.route(createRequest("table.get-many", { ids: ["table-1"] }));
    expect(getManyResponse.ok).toBe(true);
    expect(getManyResponse.result.tables).toHaveLength(1);
    expect(getManyResponse.result.tables[0].ownership).toEqual({ default: 0 });

    const plainCreateParams = { data: { name: "Rumors", formula: "1d4" } };
    const createResponse = await router.route(createRequest("table.create", plainCreateParams));
    expect(createResponse.ok).toBe(true);
    expect(globalThis.RollTable.create).toHaveBeenCalled();
    expect(createResponse.result.table.id).toBe("table-created");

    expect(createResponse.result.table).not.toHaveProperty("ownership");

    expect(plainCreateParams.data).not.toHaveProperty("_stats");
    expect(plainCreateParams.data).not.toHaveProperty("ownership");
    const plainCreateArgument = globalThis.RollTable.create.mock.calls.at(-1)[0];
    expect(plainCreateArgument).not.toHaveProperty("_stats");
    expect(plainCreateArgument).not.toHaveProperty("ownership");

    const inlineCreateParams = {
      data: {
        name: "Bundle",
        results: [
          { name: "A", range: [1, 1] },
          { name: "B", range: [2, 2], weight: 3 }
        ]
      }
    };
    const createWithResults = await router.route(createRequest("table.create", inlineCreateParams));
    expect(createWithResults.ok).toBe(true);
    expect(createWithResults.result.table.results).toHaveLength(2);

    for (const [index, row] of inlineCreateParams.data.results.entries()) {
      expect(row, `params.data.results[${index}]`).not.toHaveProperty("_id");
      expect(row, `params.data.results[${index}]`).not.toHaveProperty("_stats");
    }
    const inlineCreateArgument = globalThis.RollTable.create.mock.calls.at(-1)[0];
    expect(inlineCreateArgument).not.toHaveProperty("_stats");
    expect(inlineCreateArgument).not.toHaveProperty("ownership");
    for (const [index, row] of inlineCreateArgument.results.entries()) {
      expect(row, `RollTable.create data.results[${index}]`).not.toHaveProperty("_id");
      expect(row, `RollTable.create data.results[${index}]`).not.toHaveProperty("_stats");
    }

    expect(createWithResults.result.table.results[1].weight).toBe(3);

    const updateResponse = await router.route(
      createRequest("table.update", { tableId: "table-1", patch: { name: "Loot v2", formula: "1d8" } })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.table.name).toBe("Loot v2");
    expect(updateResponse.result.table.formula).toBe("1d8");

    const cloneResponse = await router.route(
      createRequest("table.clone", { tableId: "table-1", patch: { name: "Loot Copy" } })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.table.id).toBe("table-1-clone");
    expect(cloneResponse.result.table.name).toBe("Loot Copy");

    expect(cloneResponse.result.table.results).toHaveLength(2);

    const deleteResponse = await router.route(createRequest("table.delete", { tableId: "table-1" }));
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: "table-1", deleted: true });
  });

  it("table.* dry runs persist nothing and return the same keys marked dryRun:true", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const tableCountBefore = globalThis.game.tables.size;

    const createDry = await router.route(
      createRequest("table.create", { data: { name: "Preview", formula: "1d3" }, dryRun: true })
    );
    expect(createDry.ok).toBe(true);
    expect(createDry.result.dryRun).toBe(true);
    expect(createDry.result.table.name).toBe("Preview");
    expect(createDry.result.table.id).toBeNull();
    expect(createDry.result.table._id).toBeNull();
    expect(globalThis.RollTable.create).not.toHaveBeenCalled();

    const updateDry = await router.route(
      createRequest("table.update", { tableId: "table-1", patch: { name: "Nope" }, dryRun: true })
    );
    expect(updateDry.result.dryRun).toBe(true);
    expect(updateDry.result.table.name).toBe("Nope");

    expect(updateDry.result.table.results.map((result) => result.id)).toEqual(["result-1", "result-2"]);

    expect(globalThis.game.tables.get("table-1").name).toBe("Loot");

    const cloneDry = await router.route(
      createRequest("table.clone", { tableId: "table-1", patch: { name: "Loot Copy" }, dryRun: true })
    );
    expect(cloneDry.ok).toBe(true);
    expect(cloneDry.result.dryRun).toBe(true);
    expect(cloneDry.result.table.name).toBe("Loot Copy");
    expect(cloneDry.result.table.id).toBeNull();
    expect(cloneDry.result.table._id).toBeNull();
    expect(cloneDry.result.table.results.map((result) => result.id)).toEqual(["result-1", "result-2"]);
    expect(globalThis.game.tables.size).toBe(tableCountBefore);
    expect(globalThis.game.tables.get("table-1").name).toBe("Loot");
    expect(globalThis.RollTable.create).not.toHaveBeenCalled();

    const deleteDry = await router.route(createRequest("table.delete", { tableId: "table-1", dryRun: true }));
    expect(deleteDry.result).toMatchObject({ id: "table-1", deleted: false, dryRun: true });
    expect(globalThis.game.tables.get("table-1").deleted).toBeUndefined();
    expect(globalThis.game.tables.size).toBe(tableCountBefore);
  });

  it("table.create --dry-run with inline results NULLS the would-be result ids", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const tableCountBefore = globalThis.game.tables.size;

    const response = await router.route(
      createRequest("table.create", {
        data: {
          name: "Preview Rows",
          formula: "1d4",
          results: [
            { name: "Copper", range: [1, 2], weight: 1 },
            { name: "Silver", range: [3, 4], weight: 3, drawn: true }
          ]
        },
        dryRun: true
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.dryRun).toBe(true);

    expect(response.result.table.results).toHaveLength(2);
    expect(response.result.table.results.map((result) => result.name)).toEqual(["Copper", "Silver"]);
    expect(response.result.table.results.map((result) => result.weight)).toEqual([1, 3]);
    expect(response.result.table.results.map((result) => result.range)).toEqual([
      [1, 2],
      [3, 4]
    ]);
    expect(response.result.table.results[1].drawn).toBe(true);

    expect(response.result.table.id).toBeNull();
    expect(response.result.table._id).toBeNull();
    for (const result of response.result.table.results) {
      expect(result.id).toBeNull();
      expect(result._id).toBeNull();
    }
    expect(globalThis.RollTable.create).not.toHaveBeenCalled();
    expect(globalThis.game.tables.size).toBe(tableCountBefore);
  });

  it("table.* not-found paths return TABLE_NOT_FOUND naming table.list", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    for (const [command, params] of [
      ["table.get", { tableId: "nope" }],
      ["table.get-many", { ids: ["table-1", "nope"] }],
      ["table.update", { tableId: "nope", patch: { name: "X" } }],
      ["table.clone", { tableId: "nope" }],
      ["table.delete", { tableId: "nope" }],
      ["table.ownership.set", { tableId: "nope", default: 2 }]
    ]) {
      const response = await router.route(createRequest(String(command), params));
      expect(response.ok, `${command} should fail`).toBe(false);
      expect(response.error.code, String(command)).toBe("TABLE_NOT_FOUND");
      expect(response.error.message).toContain("table.list");
    }
  });

  it("table.create rejects an inline result whose type is document without documentUuid", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const params = { data: { name: "Bad", results: [{ type: "document", name: "X", range: [1, 1] }] } };
    const response = await router.route(createRequest("table.create", params));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.message).toContain("documentUuid");
    expect(response.error.details).toMatchObject({ field: "documentUuid", target: "results[0]" });
    expect(globalThis.RollTable.create).not.toHaveBeenCalled();

    const preview = await router.route(createRequest("table.create", { ...params, dryRun: true }));
    expect(preview.ok).toBe(false);
    expect(preview.error.code).toBe("INVALID_PARAMS");
    expect(preview.error.message).toBe(response.error.message);
    expect(preview.error.details).toMatchObject({ field: "documentUuid", target: "results[0]" });
    expect(globalThis.RollTable.create).not.toHaveBeenCalled();
  });

  it("table.create rejects a BLANK documentUuid on a document result the same way as a missing one", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const makeParams = (documentUuid) => ({
      data: { name: "Bad", results: [{ type: "document", name: "X", range: [1, 1], documentUuid }] }
    });

    const empty = await router.route(createRequest("table.create", makeParams("")));
    expect(empty.ok).toBe(false);
    expect(empty.error.code).toBe("INVALID_PARAMS");
    expect(empty.error.details.errors).toContainEqual(
      expect.stringContaining("$.params.data.results[0].documentUuid must be at least 1 characters long")
    );
    expect(globalThis.RollTable.create).not.toHaveBeenCalled();

    const params = makeParams("   ");
    const response = await router.route(createRequest("table.create", params));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.message).toContain("documentUuid");
    expect(response.error.details).toMatchObject({
      field: "documentUuid",
      target: "results[0]",
      blank: true
    });
    expect(globalThis.RollTable.create).not.toHaveBeenCalled();

    const preview = await router.route(createRequest("table.create", { ...params, dryRun: true }));
    expect(preview.ok).toBe(false);
    expect(preview.error.message).toBe(response.error.message);
    expect(globalThis.RollTable.create).not.toHaveBeenCalled();
  });

  it("table.create rejects an inline result whose range holds more than two entries", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const params = { data: { name: "Bad", results: [{ name: "X", range: [1, 2, 3] }] } };
    const response = await router.route(createRequest("table.create", params));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.message).toContain("range");
    expect(response.error.details).toMatchObject({ field: "range", received: 3, target: "results[0]" });
    expect(globalThis.RollTable.create).not.toHaveBeenCalled();

    const preview = await router.route(createRequest("table.create", { ...params, dryRun: true }));
    expect(preview.ok).toBe(false);
    expect(preview.error.code).toBe("INVALID_PARAMS");
    expect(preview.error.message).toBe(response.error.message);
    expect(preview.error.details).toMatchObject({ field: "range", received: 3, target: "results[0]" });
    expect(globalThis.RollTable.create).not.toHaveBeenCalled();
  });

  it("table.create canonicalizes the table img AND each inline result img", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const response = await router.route(
      createRequest("table.create", {
        data: {
          name: "Art",
          img: "worlds/test/It's a (test) #1.webp",
          results: [{ name: "R", range: [1, 1], img: "worlds/test/my art.webp" }]
        }
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.table.img).toBe("worlds/test/It%27s%20a%20(test)%20%231.webp");
    expect(response.result.table.results[0].img).toBe("worlds/test/my%20art.webp");
  });

  it("table.update and table.clone canonicalize the patched img too (not just create)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const updateResponse = await router.route(
      createRequest("table.update", { tableId: "table-1", patch: { img: "worlds/test/my art.webp" } })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.table.img).toBe("worlds/test/my%20art.webp");

    const cloneResponse = await router.route(
      createRequest("table.clone", {
        tableId: "table-1",
        patch: { name: "Art Copy", img: "worlds/test/It's a (test) #1.webp" }
      })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.table.img).toBe("worlds/test/It%27s%20a%20(test)%20%231.webp");
  });

  it("a CACHE-BUSTED img survives create/update/clone and a get→update round trip", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const created = await router.route(
      createRequest("table.create", {
        data: {
          name: "Cache busted",
          img: "worlds/test/my map.webp?1762953012",
          results: [{ name: "R", range: [1, 1], img: "worlds/test/row art.webp?v=2" }]
        }
      })
    );
    expect(created.ok).toBe(true);

    expect(created.result.table.img).toBe("worlds/test/my%20map.webp?1762953012");
    expect(created.result.table.results[0].img).toBe("worlds/test/row%20art.webp?v=2");

    const updated = await router.route(
      createRequest("table.update", { tableId: "table-1", patch: { img: "worlds/test/map.webp?v=9" } })
    );
    expect(updated.ok).toBe(true);
    expect(updated.result.table.img).toBe("worlds/test/map.webp?v=9");

    const roundTrip = await router.route(
      createRequest("table.update", { tableId: "table-1", patch: { img: updated.result.table.img } })
    );
    expect(roundTrip.ok).toBe(true);
    expect(roundTrip.result.table.img).toBe("worlds/test/map.webp?v=9");

    const cloned = await router.route(
      createRequest("table.clone", {
        tableId: "table-1",
        patch: { name: "Busted copy", img: "worlds/test/my map.webp?1762953012" }
      })
    );
    expect(cloned.ok).toBe(true);
    expect(cloned.result.table.img).toBe("worlds/test/my%20map.webp?1762953012");
  });

  it("table.update reports a Foundry-REJECTED patch as INVALID_PARAMS, not as a module's veto", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const table = globalThis.game.tables.get("table-1");
    table.update = vi.fn(async () => undefined);

    const response = await router.route(
      createRequest("table.update", { tableId: "table-1", patch: { img: "   " } })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details).toMatchObject({
      tableId: "table-1",
      reason: "foundry_validation"
    });
    expect(response.error.details.message).toContain("does not have a valid file extension");

    expect(response.error.message).not.toMatch(/disable the module/);
    expect(response.error.message).toMatch(/NOT a module veto/);
    expect(globalThis.game.tables.get("table-1").img).not.toBe("%20%20%20");
  });

  it("the update-probe INVALID_PARAMS carries the SAME details.errors the create path does", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");
    table.update = vi.fn(async () => undefined);

    const updated = await router.route(
      createRequest("table.update", { tableId: "table-1", patch: { img: "   " } })
    );
    expect(updated.ok).toBe(false);
    expect(updated.error.code).toBe("INVALID_PARAMS");
    expect(updated.error.details).toMatchObject({
      tableId: "table-1",
      reason: "foundry_validation",
      errors: ["img"]
    });

    expect(updated.error.details.message).toContain("does not have a valid file extension");

    globalThis.RollTable.create = vi.fn(async () => {
      throw makeDataModelValidationError("img: does not have a valid file extension");
    });
    const created = await router.route(
      createRequest("table.create", { data: { name: "Busted", img: "   " } })
    );
    expect(created.ok).toBe(false);
    expect(created.error.code).toBe("INVALID_PARAMS");
    expect(created.error.details).toMatchObject({ reason: "foundry_validation", errors: ["img"] });
    expect(created.error.details.errors).toEqual(updated.error.details.errors);
  });

  it("a NON-validation probe failure still reports the veto-shaped INTERNAL_ERROR", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const table = globalThis.game.tables.get("table-1");
    table.update = vi.fn(async () => undefined);
    table.clone = vi.fn(async () => {
      throw new Error("probe clone exploded");
    });

    const response = await router.route(
      createRequest("table.update", { tableId: "table-1", patch: { name: "Renamed" } })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(response.error.message).toMatch(/was NOT updated/);
    expect(response.error.details).toMatchObject({
      tableId: "table-1",
      validationError: "probe clone exploded"
    });
  });

  it("table reads are SOURCE-first: a v14-style derived `formula` accessor never leaks", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const derived = createTableDocument("table-derived", { name: "Empty", formula: "" });
    const storedSource = derived.toObject();
    derived.formula = "1d5";
    derived.toObject = () => storedSource;
    globalThis.game.tables.set(derived);

    const getResponse = await router.route(createRequest("table.get", { tableId: "table-derived" }));
    expect(getResponse.result.table.formula).toBe("");
    const listResponse = await router.route(createRequest("table.list", { name: "Empty" }));
    expect(listResponse.result.tables[0].formula).toBe("");
  });

  it("table.get and table.list agree on the LIVE result set when a v14 loader dropped a legacy row", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const legacy = createTableDocument("table-legacy", {
      name: "Legacy",
      results: [{ id: "legacy-live", name: "live row", range: [2, 2] }]
    });
    const liveSource = legacy.toObject();
    legacy.toObject = () => ({
      ...liveSource,
      results: [
        { _id: "legacy-dropped", name: "dropped row", range: [1, 1], drawn: true },
        ...liveSource.results
      ]
    });
    globalThis.game.tables.set(legacy);

    const getResponse = await router.route(createRequest("table.get", { tableId: "table-legacy" }));
    expect(getResponse.result.table.results.map((result) => result.id)).toEqual(["legacy-live"]);

    const listResponse = await router.route(createRequest("table.list", { name: "Legacy" }));
    expect(listResponse.result.tables).toHaveLength(1);
    expect(listResponse.result.tables[0]).toMatchObject({
      id: "table-legacy",
      resultCount: 1,
      drawnCount: 0
    });
  });

  it("lists, gets, creates, updates, clones, and deletes table results", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("table.result.list", { tableId: "table-1" }));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.tableId).toBe("table-1");
    expect(listResponse.result.results).toHaveLength(2);

    expect(listResponse.result.results[0]).toMatchObject({
      id: "result-1",
      type: "text",
      name: "Sword",
      range: [1, 3],
      weight: 2,
      drawn: false,
      tableId: "table-1",
      tableName: "Loot"
    });
    expect(listResponse.result.results[0].flags).toBeUndefined();
    expect(listResponse.result.results[0].description).toBeUndefined();

    const filtered = await router.route(
      createRequest("table.result.list", { tableId: "table-1", name: "gob" })
    );
    expect(filtered.result.results.map((row) => row.id)).toEqual(["result-2"]);

    const getResponse = await router.route(
      createRequest("table.result.get", { tableId: "table-1", resultId: "result-2" })
    );
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.tableId).toBe("table-1");

    expect(getResponse.result.result).toMatchObject({
      id: "result-2",
      type: "document",
      documentUuid: "Actor.abc",
      range: [4, 6],
      drawn: true
    });
    expect(getResponse.result.result).toHaveProperty("description");
    expect(getResponse.result.result).toHaveProperty("flags");
    expect(getResponse.result.result).not.toHaveProperty("ownership");

    const rowCreateParams = {
      tableId: "table-1",
      data: { name: "Shield", range: [7, 8], weight: 4 }
    };
    const createResponse = await router.route(createRequest("table.result.create", rowCreateParams));
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.tableId).toBe("table-1");
    expect(createResponse.result.result).toMatchObject({ name: "Shield", range: [7, 8], weight: 4 });
    const createdId = createResponse.result.result.id;
    expect(createdId).toBeTruthy();
    expect(globalThis.game.tables.get("table-1").createEmbeddedDocuments).toHaveBeenCalled();

    expect(rowCreateParams.data).not.toHaveProperty("_stats");
    const rowCreateCall = globalThis.game.tables.get("table-1").createEmbeddedDocuments.mock.calls.at(-1);
    expect(rowCreateCall[1][0]).not.toHaveProperty("_stats");

    const updateResponse = await router.route(
      createRequest("table.result.update", {
        tableId: "table-1",
        resultId: createdId,
        patch: { name: "Tower Shield", weight: 5, drawn: true }
      })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.result).toMatchObject({
      id: createdId,
      name: "Tower Shield",
      weight: 5,
      drawn: true
    });

    const updateCall = globalThis.game.tables.get("table-1").updateEmbeddedDocuments.mock.calls.at(-1);
    expect(updateCall[0]).toBe("TableResult");
    expect(updateCall[1]).toEqual([{ _id: createdId, name: "Tower Shield", weight: 5, drawn: true }]);

    const cloneResponse = await router.route(
      createRequest("table.result.clone", {
        tableId: "table-1",
        resultId: "result-1",
        patch: { name: "Sword Copy", range: [9, 9] }
      })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.result).toMatchObject({ name: "Sword Copy", range: [9, 9] });
    expect(cloneResponse.result.result.id).not.toBe("result-1");

    const deleteResponse = await router.route(
      createRequest("table.result.delete", { tableId: "table-1", resultId: createdId })
    );
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ tableId: "table-1", id: createdId, deleted: true });
    expect(globalThis.game.tables.get("table-1").results.get(createdId)).toBeNull();
  });

  it("row reads report STORED name/img/documentUuid, never Foundry's prepareBaseData backfill", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const derivedTable = createTableDocument("table-derived-rows", {
      name: "Derived",
      results: [
        { id: "row-doc", type: "document", name: "", img: null, documentUuid: "Actor.abc", range: [1, 1] },

        { id: "row-text", type: "text", name: "Plain", documentUuid: "Actor.zzz", range: [2, 2] }
      ]
    });

    const docRow = derivedTable.results.get("row-doc");
    const docRowSource = docRow.toObject();
    docRow.toObject = vi.fn(() => docRowSource);
    docRow._source = docRowSource;
    docRow.name = "Goblin (from the referenced actor)";
    docRow.img = "icons/creatures/goblin.webp";
    const textRow = derivedTable.results.get("row-text");
    const textRowSource = textRow.toObject();
    textRow.toObject = () => textRowSource;
    textRow._source = textRowSource;
    textRow.documentUuid = null;
    globalThis.game.tables.set(derivedTable);

    const full = await router.route(
      createRequest("table.result.get", { tableId: "table-derived-rows", resultId: "row-doc" })
    );
    expect(full.result.result.name).toBe("");
    expect(full.result.result.img).toBeNull();

    const textFull = await router.route(
      createRequest("table.result.get", { tableId: "table-derived-rows", resultId: "row-text" })
    );
    expect(textFull.result.result.documentUuid).toBe("Actor.zzz");

    const list = await router.route(createRequest("table.result.list", { tableId: "table-derived-rows" }));
    const rows = Object.fromEntries(list.result.results.map((row) => [row.id, row]));
    expect(rows["row-doc"].name).toBe("");
    expect(rows["row-doc"].img).toBeNull();
    expect(rows["row-text"].documentUuid).toBe("Actor.zzz");

    const table = await router.route(createRequest("table.get", { tableId: "table-derived-rows" }));
    const embedded = Object.fromEntries(table.result.table.results.map((row) => [row.id, row]));
    expect(embedded["row-doc"].img).toBeNull();
    expect(embedded["row-text"].documentUuid).toBe("Actor.zzz");

    const toObjectCallsBeforeFilter = docRow.toObject.mock.calls.length;
    const filteredByBackfill = await router.route(
      createRequest("table.result.list", { tableId: "table-derived-rows", name: "goblin" })
    );
    expect(filteredByBackfill.ok).toBe(true);
    expect(filteredByBackfill.result.results).toEqual([]);
    expect(filteredByBackfill.result.total).toBe(0);

    expect(docRow.toObject.mock.calls.length).toBe(toObjectCallsBeforeFilter);

    const filteredByStored = await router.route(
      createRequest("table.result.list", { tableId: "table-derived-rows", name: "plain" })
    );
    expect(filteredByStored.result.results.map((row) => row.id)).toEqual(["row-text"]);
  });

  it("table.result.list with NO tableId flattens rows across all tables (table sort→name)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const other = createTableDocument("table-2", {
      name: "Aardvark",
      sort: 0,
      results: [{ id: "other-1", name: "Aardvark row", range: [1, 1] }]
    });
    globalThis.game.tables.set(other);

    const response = await router.route(createRequest("table.result.list"));
    expect(response.ok).toBe(true);

    expect(response.result).not.toHaveProperty("tableId");

    expect(response.result.results.map((row) => row.id)).toEqual(["other-1", "result-1", "result-2"]);
    expect(response.result.results[0]).toMatchObject({ tableId: "table-2", tableName: "Aardvark" });
    expect(response.result.total).toBe(3);

    const paged = await router.route(createRequest("table.result.list", { limit: 2, offset: 1 }));
    expect(paged.result.results.map((row) => row.id)).toEqual(["result-1", "result-2"]);
    expect(paged.result.total).toBe(3);
    expect(paged.result.hasMore).toBe(false);
  });

  it("table.result.* not-found paths: bad tableId → TABLE_NOT_FOUND, bad resultId → TABLE_RESULT_NOT_FOUND", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    for (const [command, params] of [
      ["table.result.list", { tableId: "nope" }],
      ["table.result.get", { tableId: "nope", resultId: "result-1" }],
      ["table.result.create", { tableId: "nope", data: { range: [1, 1] } }],
      ["table.result.update", { tableId: "nope", resultId: "result-1", patch: { name: "X" } }],
      ["table.result.clone", { tableId: "nope", resultId: "result-1" }],
      ["table.result.delete", { tableId: "nope", resultId: "result-1" }]
    ]) {
      const response = await router.route(createRequest(String(command), params));
      expect(response.ok, `${command} should fail`).toBe(false);
      expect(response.error.code, String(command)).toBe("TABLE_NOT_FOUND");
      expect(response.error.message).toContain("table.list");
    }

    for (const [command, params] of [
      ["table.result.get", { tableId: "table-1", resultId: "nope" }],
      ["table.result.update", { tableId: "table-1", resultId: "nope", patch: { name: "X" } }],
      ["table.result.clone", { tableId: "table-1", resultId: "nope" }],
      ["table.result.delete", { tableId: "table-1", resultId: "nope" }]
    ]) {
      const response = await router.route(createRequest(String(command), params));
      expect(response.ok, `${command} should fail`).toBe(false);
      expect(response.error.code, String(command)).toBe("TABLE_RESULT_NOT_FOUND");
      expect(response.error.message).toContain("table.result.list");
      expect(response.error.details).toMatchObject({ tableId: "table-1", resultId: "nope" });
    }
  });

  it("table.result.* dry runs persist nothing and return the same keys marked dryRun:true", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");
    const rowsBefore = table.results.size;

    const createDry = await router.route(
      createRequest("table.result.create", {
        tableId: "table-1",
        data: { name: "Ghost", range: [11, 12] },
        dryRun: true
      })
    );
    expect(createDry.ok).toBe(true);
    expect(createDry.result.dryRun).toBe(true);
    expect(createDry.result.tableId).toBe("table-1");

    expect(createDry.result.result).toMatchObject({
      name: "Ghost",
      range: [11, 12],
      type: "text",
      weight: 1,
      drawn: false,
      description: "",
      img: null,
      documentUuid: null
    });
    expect(createDry.result.result.id).toBeNull();
    expect(createDry.result.result._id).toBeNull();
    expect(table.createEmbeddedDocuments).not.toHaveBeenCalled();

    const updateDry = await router.route(
      createRequest("table.result.update", {
        tableId: "table-1",
        resultId: "result-1",
        patch: { name: "Nope", weight: 9 },
        dryRun: true
      })
    );
    expect(updateDry.result.dryRun).toBe(true);
    expect(updateDry.result.result).toMatchObject({ id: "result-1", name: "Nope", weight: 9 });
    expect(table.results.get("result-1").name).toBe("Sword");
    expect(table.updateEmbeddedDocuments).not.toHaveBeenCalled();

    const cloneDry = await router.route(
      createRequest("table.result.clone", {
        tableId: "table-1",
        resultId: "result-1",
        patch: { name: "Ghost Copy" },
        dryRun: true
      })
    );
    expect(cloneDry.result.dryRun).toBe(true);
    expect(cloneDry.result.result.name).toBe("Ghost Copy");
    expect(cloneDry.result.result.id).toBeNull();

    const deleteDry = await router.route(
      createRequest("table.result.delete", { tableId: "table-1", resultId: "result-1", dryRun: true })
    );
    expect(deleteDry.result).toMatchObject({
      tableId: "table-1",
      id: "result-1",
      deleted: false,
      dryRun: true
    });
    expect(table.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    expect(table.results.size).toBe(rowsBefore);
    expect(table.results.get("result-1")).not.toBeNull();
  });

  it("table.result.create dry-run body carries the SAME keys the real create's body does", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const dry = await router.route(
      createRequest("table.result.create", {
        tableId: "table-1",
        data: { name: "Shape Preview", range: [21, 22] },
        dryRun: true
      })
    );
    const real = await router.route(
      createRequest("table.result.create", {
        tableId: "table-1",
        data: { name: "Shape Real", range: [23, 24] }
      })
    );
    expect(dry.ok && real.ok).toBe(true);
    expect(Object.keys(dry.result).sort()).toEqual([...Object.keys(real.result), "dryRun"].sort());
    expect(Object.keys(dry.result.result).sort()).toEqual(Object.keys(real.result.result).sort());
  });

  it("table.result.create REFUSES a descending range, real and dry-run, with the prescriptive gate", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");

    for (const dryRun of [true, false]) {
      const response = await router.route(
        createRequest("table.result.create", {
          tableId: "table-1",
          data: { name: "Backwards", range: [5, 1] },
          ...(dryRun ? { dryRun: true } : {})
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.message).toContain("ascend");
      expect(response.error.details).toMatchObject({ field: "range", low: 5, high: 1 });
      expect(table.createEmbeddedDocuments).not.toHaveBeenCalled();
    }
  });

  it("table.result.update REFUSES a descending range v14 would silently drop", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");
    const before = table.results.get("result-1").toObject().range;

    for (const dryRun of [true, false]) {
      const response = await router.route(
        createRequest("table.result.update", {
          tableId: "table-1",
          resultId: "result-1",
          patch: { range: [9, 3] },
          ...(dryRun ? { dryRun: true } : {})
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.message).toContain("ascend");
      expect(response.error.details).toMatchObject({ field: "range", low: 9, high: 3 });
    }
    expect(table.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(table.results.get("result-1").toObject().range).toEqual(before);
  });

  it("table.result.clone and inline table.create results[] refuse a descending range too", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const cloned = await router.route(
      createRequest("table.result.clone", {
        tableId: "table-1",
        resultId: "result-1",
        patch: { range: [8, 2] }
      })
    );
    expect(cloned.ok).toBe(false);
    expect(cloned.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(cloned.error.details).toMatchObject({ field: "range", low: 8, high: 2 });

    for (const dryRun of [false, true]) {
      const created = await router.route(
        createRequest("table.create", {
          data: {
            name: "Backwards Inline",
            results: [
              { name: "X", range: [4, 4] },
              { name: "Y", range: [7, 3] }
            ]
          },
          ...(dryRun ? { dryRun: true } : {})
        })
      );
      expect(created.ok).toBe(false);
      expect(created.error.code).toBe(ERROR_CODES.INVALID_PARAMS);

      expect(created.error.details).toMatchObject({ field: "range", target: "results[1]", low: 7, high: 3 });
    }
  });

  it("table.result guards run on the MERGED post-state, not the raw patch", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");

    const cleared = await router.route(
      createRequest("table.result.update", {
        tableId: "table-1",
        resultId: "result-2", // type:"document", documentUuid:"Actor.abc"
        patch: { documentUuid: null }
      })
    );
    expect(cleared.ok).toBe(false);
    expect(cleared.error.code).toBe("INVALID_PARAMS");
    expect(cleared.error.message).toContain("documentUuid");
    expect(table.updateEmbeddedDocuments).not.toHaveBeenCalled();

    const blanked = await router.route(
      createRequest("table.result.update", {
        tableId: "table-1",
        resultId: "result-2",
        patch: { documentUuid: "   " }
      })
    );
    expect(blanked.ok).toBe(false);
    expect(blanked.error.details).toMatchObject({ field: "documentUuid", blank: true });

    const flipped = await router.route(
      createRequest("table.result.update", {
        tableId: "table-1",
        resultId: "result-1", // type:"text"
        patch: { type: "document" }
      })
    );
    expect(flipped.ok).toBe(false);
    expect(flipped.error.code).toBe("INVALID_PARAMS");

    const restated = await router.route(
      createRequest("table.result.update", {
        tableId: "table-1",
        resultId: "result-2",
        patch: { type: "document", weight: 7 }
      })
    );
    expect(restated.ok).toBe(true);
    expect(restated.result.result).toMatchObject({ type: "document", documentUuid: "Actor.abc", weight: 7 });

    const overLong = await router.route(
      createRequest("table.result.update", {
        tableId: "table-1",
        resultId: "result-1",
        patch: { range: [1, 2, 3] }
      })
    );
    expect(overLong.ok).toBe(false);
    expect(overLong.error.code).toBe("INVALID_PARAMS");
    expect(overLong.error.details).toMatchObject({ field: "range", received: 3, target: "patch" });

    const untouched = await router.route(
      createRequest("table.result.update", {
        tableId: "table-1",
        resultId: "result-1",
        patch: { name: "Ok" }
      })
    );
    expect(untouched.ok).toBe(true);
  });

  it("table.result create/update/clone canonicalize the row img FilePath", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const created = await router.route(
      createRequest("table.result.create", {
        tableId: "table-1",
        data: { name: "Art", range: [20, 20], img: "worlds/test/my art.webp" }
      })
    );
    expect(created.ok).toBe(true);
    expect(created.result.result.img).toBe("worlds/test/my%20art.webp");

    const updated = await router.route(
      createRequest("table.result.update", {
        tableId: "table-1",
        resultId: "result-1",
        patch: { img: "worlds/test/It's a (test) #1.webp" }
      })
    );
    expect(updated.ok).toBe(true);
    expect(updated.result.result.img).toBe("worlds/test/It%27s%20a%20(test)%20%231.webp");

    const cloned = await router.route(
      createRequest("table.result.clone", {
        tableId: "table-1",
        resultId: "result-1",
        patch: { img: "worlds/test/my art.webp" }
      })
    );
    expect(cloned.ok).toBe(true);
    expect(cloned.result.result.img).toBe("worlds/test/my%20art.webp");
  });

  it("table.result.create rejects a document row with no documentUuid, dry-run included", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");
    const params = { tableId: "table-1", data: { type: "document", name: "X", range: [30, 30] } };

    const response = await router.route(createRequest("table.result.create", params));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details).toMatchObject({ field: "documentUuid", target: "data" });
    expect(table.createEmbeddedDocuments).not.toHaveBeenCalled();

    const preview = await router.route(createRequest("table.result.create", { ...params, dryRun: true }));
    expect(preview.ok).toBe(false);
    expect(preview.error.message).toBe(response.error.message);
    expect(table.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("table.result.create refuses an over-long range, dry-run included", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");

    const params = { tableId: "table-1", data: { name: "X", range: [1, 2, 3] } };

    const response = await router.route(createRequest("table.result.create", params));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details).toMatchObject({ field: "range", received: 3, target: "data" });
    expect(table.createEmbeddedDocuments).not.toHaveBeenCalled();

    const dry = await router.route(createRequest("table.result.create", { ...params, dryRun: true }));
    expect(dry.ok).toBe(false);
    expect(dry.error.message).toBe(response.error.message);
    expect(table.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  const foundryRejectedTablePayloads = [
    { label: "an img with no image extension", field: "img", value: "bad.txt", match: /file extension/ },
    {
      label: "a malformed documentUuid",
      field: "documentUuid",
      value: "garbage",
      match: /documentUuid/
    }
  ];

  it.each(foundryRejectedTablePayloads)(
    "table.create and table.result.create answer INVALID_PARAMS for $label on BOTH the real and the dry-run path",
    async ({ field, value, match }) => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = globalThis.game.tables.get("table-1");

      const tableParams =
        field === "img"
          ? { data: { name: "Bad table", img: value } }
          : {
              data: {
                name: "Bad table",
                results: [{ name: "row", range: [1, 1], type: "document", documentUuid: value }]
              }
            };
      const rowParams = {
        tableId: "table-1",
        data: {
          name: "Bad row",
          range: [1, 1],
          ...(field === "documentUuid" ? { type: "document" } : {}),
          [field]: value
        }
      };

      for (const { command, params } of [
        { command: "table.create", params: tableParams },
        { command: "table.result.create", params: rowParams }
      ]) {
        const real = await router.route(createRequest(command, params));
        const dry = await router.route(createRequest(command, { ...params, dryRun: true }));
        expect(real.ok, `${command} real: ${JSON.stringify(real.result ?? {})}`).toBe(false);
        expect(dry.ok).toBe(false);

        expect(real.error.code).toBe("INVALID_PARAMS");
        expect(dry.error.code).toBe(real.error.code);
        expect(real.error.details).toMatchObject({ reason: "foundry_validation" });
        expect(real.error.details.message).toMatch(match);
        expect(dry.error.message).toBe(real.error.message);
        expect(dry.error.details.message).toBe(real.error.details.message);
      }

      expect(globalThis.RollTable.create).not.toHaveBeenCalled();
      expect(table.createEmbeddedDocuments).not.toHaveBeenCalled();
    }
  );

  it.each(foundryRejectedTablePayloads)(
    "table.clone and table.result.clone answer INVALID_PARAMS for $label on BOTH the real and the dry-run path",
    async ({ field, value, match }) => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const table = createTableDocument("table-clone-invalid", {
        name: "Source",
        results: [{ id: "clone-invalid-row", name: "Row", range: [1, 1] }]
      });
      globalThis.game.tables.set(table);
      const row = table.results.get("clone-invalid-row");

      const cases =
        field === "img"
          ? [
              { command: "table.clone", params: { tableId: "table-clone-invalid", patch: { img: value } } },
              {
                command: "table.result.clone",
                params: {
                  tableId: "table-clone-invalid",
                  resultId: "clone-invalid-row",
                  patch: { img: value }
                }
              }
            ]
          : [
              {
                command: "table.result.clone",
                params: {
                  tableId: "table-clone-invalid",
                  resultId: "clone-invalid-row",
                  patch: { type: "document", documentUuid: value }
                }
              }
            ];

      for (const { command, params } of cases) {
        const real = await router.route(createRequest(command, params));
        const dry = await router.route(createRequest(command, { ...params, dryRun: true }));

        expect(dry.ok, `${command} dry-run: ${JSON.stringify(dry.result ?? {})}`).toBe(false);
        expect(real.ok).toBe(false);
        expect(real.error.code).toBe("INVALID_PARAMS");
        expect(dry.error.code).toBe(real.error.code);
        expect(real.error.details).toMatchObject({ reason: "foundry_validation" });
        expect(real.error.details.message).toMatch(match);
        expect(dry.error.message).toBe(real.error.message);
        expect(dry.error.details.message).toBe(real.error.details.message);
      }

      expect(table.clone.mock.calls.filter(([, context]) => context?.save === true)).toEqual([]);
      expect(row.clone.mock.calls.filter(([, context]) => context?.save === true)).toEqual([]);
    }
  );

  it("HEALTHY CONTROL: a VALID img/documentUuid still creates and clones on both paths", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = createTableDocument("table-clone-valid", {
      name: "Source",
      results: [{ id: "clone-valid-row", name: "Row", range: [1, 1] }]
    });
    globalThis.game.tables.set(table);

    const created = await router.route(
      createRequest("table.create", {
        data: {
          name: "Good table",
          img: "worlds/test/tables/good.webp",
          results: [
            { name: "row", range: [1, 1], type: "document", documentUuid: "RollTable.table-clone-valid" }
          ]
        }
      })
    );
    expect(created.ok, JSON.stringify(created.error ?? {})).toBe(true);

    const rowCreated = await router.route(
      createRequest("table.result.create", {
        tableId: "table-clone-valid",
        data: { name: "Good row", range: [2, 2], img: "worlds/test/tables/good.webp" }
      })
    );
    expect(rowCreated.ok, JSON.stringify(rowCreated.error ?? {})).toBe(true);

    for (const dryRun of [true, false]) {
      const clonedTable = await router.route(
        createRequest("table.clone", {
          tableId: "table-clone-valid",
          patch: { img: "worlds/test/tables/good.webp" },
          dryRun
        })
      );
      expect(clonedTable.ok, JSON.stringify(clonedTable.error ?? {})).toBe(true);
      const clonedRow = await router.route(
        createRequest("table.result.clone", {
          tableId: "table-clone-valid",
          resultId: "clone-valid-row",
          patch: { type: "document", documentUuid: "RollTable.table-clone-valid" },
          dryRun
        })
      );
      expect(clonedRow.ok, JSON.stringify(clonedRow.error ?? {})).toBe(true);
    }
  });

  it("table.result update/clone leave a PRE-EXISTING dangling document row alone (supply-only guard)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const dangling = createTableDocument("table-dangling", {
      name: "Dangling",
      results: [{ id: "row-dangling", type: "document", name: "Legacy", range: [1, 1] }]
    });
    globalThis.game.tables.set(dangling);

    const renamed = await router.route(
      createRequest("table.result.update", {
        tableId: "table-dangling",
        resultId: "row-dangling",
        patch: { name: "Fixed" }
      })
    );
    expect(renamed.ok).toBe(true);
    expect(renamed.result.result.name).toBe("Fixed");

    const cloned = await router.route(
      createRequest("table.result.clone", { tableId: "table-dangling", resultId: "row-dangling" })
    );
    expect(cloned.ok).toBe(true);

    const restated = await router.route(
      createRequest("table.result.update", {
        tableId: "table-dangling",
        resultId: "row-dangling",
        patch: { type: "document" }
      })
    );
    expect(restated.ok).toBe(false);
    expect(restated.error.code).toBe("INVALID_PARAMS");
    expect(restated.error.details).toMatchObject({ field: "documentUuid", target: "patch" });

    const cleared = await router.route(
      createRequest("table.result.update", {
        tableId: "table-dangling",
        resultId: "row-dangling",
        patch: { documentUuid: null }
      })
    );
    expect(cleared.ok).toBe(false);
    expect(cleared.error.code).toBe("INVALID_PARAMS");

    const overLong = await router.route(
      createRequest("table.result.update", {
        tableId: "table-dangling",
        resultId: "row-dangling",
        patch: { range: [1, 2, 3] }
      })
    );
    expect(overLong.ok).toBe(false);
    expect(overLong.error.details).toMatchObject({ field: "range", received: 3, target: "patch" });
  });

  it("table.draw marks the row drawn, projects the owning table per row, and captures Foundry's chat message", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");

    const response = await router.route(
      createRequest("table.draw", { tableId: "table-1", idempotencyKey: "draw-1" })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      tableId: "table-1",
      complete: true,
      mutation: "committed",
      availableBefore: 1,
      availableAfter: 0
    });

    expect(TABLE_MUTATION_OUTCOMES).toContain(response.result.mutation);
    expect(response.result.roll).toEqual({ formula: "1d6", total: 1 });

    expect(response.result.results).toHaveLength(1);
    expect(response.result.results[0]).toMatchObject({
      id: "result-1",
      name: "Sword",
      weight: 2,
      range: [1, 3],
      drawn: true,
      tableId: "table-1",
      tableName: "Loot"
    });

    expect(table.results.get("result-1").drawn).toBe(true);

    expect(response.result.chatMessages.status).toBe("captured");
    expect(response.result.chatMessages.expectedCount).toBe(1);
    expect(response.result.chatMessages.ids).toHaveLength(1);

    expect(globalThis.Hooks._listeners.get("createChatMessage") ?? []).toHaveLength(0);
  });

  it("table.draw translates BOTH the roll-mode option name and value per Foundry generation", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");

    globalThis.game.release = { generation: 13 };
    await router.route(createRequest("table.draw", { tableId: "table-1", idempotencyKey: "k13" }));
    expect(table.drawCalls.at(-1)).toMatchObject({ rollMode: "publicroll" });
    expect(table.drawCalls.at(-1).messageMode).toBeUndefined();

    globalThis.game.release = { generation: 14 };
    await router.route(
      createRequest("table.draw", { tableId: "table-1", idempotencyKey: "k14", rollMode: "gm" })
    );
    expect(table.drawCalls.at(-1)).toMatchObject({ messageMode: "gm" });
    expect(table.drawCalls.at(-1).rollMode).toBeUndefined();

    delete globalThis.game.release;
    await router.route(
      createRequest("table.draw", { tableId: "table-1", idempotencyKey: "k?", rollMode: "blind" })
    );
    expect(table.drawCalls.at(-1)).toMatchObject({ rollMode: "blindroll" });

    for (const call of table.drawCalls) {
      expect(call.rollMode ?? call.messageMode).toBeDefined();
    }
  });

  it("table.draw --no-chat requests no message and reports not-requested", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");
    const response = await router.route(
      createRequest("table.draw", { tableId: "table-1", idempotencyKey: "draw-nochat", chat: false })
    );

    expect(response.ok).toBe(true);
    expect(table.drawCalls.at(-1)).toMatchObject({ displayChat: false });
    expect(response.result.chatMessages).toEqual({
      status: "not-requested",
      expectedCount: 0,
      ids: []
    });

    expect(response.result.complete).toBe(true);
    expect(response.result.mutation).toBe("committed");

    expect(globalThis.Hooks.on).not.toHaveBeenCalled();
  });

  it("table.draw dry-run rolls NOTHING (no normalize write) and matches the real body's keys", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");

    const dry = await router.route(
      createRequest("table.draw", { tableId: "table-1", idempotencyKey: "draw-dry", dryRun: true })
    );
    expect(dry.ok).toBe(true);
    expect(dry.result).toMatchObject({
      tableId: "table-1",
      dryRun: true,
      complete: true,
      mutation: "not-executed",
      results: [],
      roll: null,
      availableBefore: 1,
      availableAfter: 1
    });
    expect(dry.result.chatMessages).toEqual({ status: "not-requested", expectedCount: 0, ids: [] });

    expect(table.draw).not.toHaveBeenCalled();
    expect(table.drawMany).not.toHaveBeenCalled();
    expect(table.results.get("result-1").drawn).toBe(false);

    const real = await router.route(
      createRequest("table.draw", { tableId: "table-1", idempotencyKey: "draw-real" })
    );
    expect(Object.keys(dry.result).sort()).toEqual([...Object.keys(real.result), "dryRun"].sort());
    expect(Object.keys(dry.result.chatMessages).sort()).toEqual(Object.keys(real.result.chatMessages).sort());
  });

  it("table.draw surfaces an EXHAUSTED table explicitly instead of as a bare success", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");

    for (const row of table.results) {
      row.drawn = true;
      row._source.drawn = true;
    }

    const response = await router.route(
      createRequest("table.draw", { tableId: "table-1", idempotencyKey: "draw-empty" })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      complete: true,
      mutation: "committed",
      results: [],
      availableBefore: 0,
      availableAfter: 0
    });

    expect(response.result.chatMessages).toEqual({ status: "captured", expectedCount: 0, ids: [] });

    const many = await router.route(
      createRequest("table.draw", { tableId: "table-1", idempotencyKey: "draw-empty-many", count: 3 })
    );
    expect(many.ok).toBe(true);
    expect(many.result.results).toEqual([]);
    expect(many.result.roll).toEqual({ formula: "{}", total: 0 });
  });

  it("table.draw distinguishes an UNREACHABLE formula from exhaustion via availableBefore", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");

    table.drawNoPossibleMatch = true;

    const response = await router.route(
      createRequest("table.draw", { tableId: "table-1", idempotencyKey: "draw-unreachable" })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      complete: true,
      mutation: "committed",
      results: [],

      availableBefore: 1,
      availableAfter: 1
    });
    expect(response.result.chatMessages).toEqual({ status: "captured", expectedCount: 0, ids: [] });
    expect(table.results.get("result-1").drawn).toBe(false);
  });

  it("table.draw REFUSES --count > 1 on a table holding a nested RollTable row, and names both escapes", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const nested = createTableDocument("table-nested", {
      name: "Encounters",
      replacement: false,
      results: [
        {
          id: "row-nested",
          type: "document",
          name: "Inner",
          documentUuid: "RollTable.table-inner",
          range: [1, 1]
        },
        { id: "row-plain", name: "Plain", range: [2, 2] }
      ]
    });
    const inner = createTableDocument("table-inner", {
      name: "Inner",
      replacement: false,
      results: [{ id: "inner-1", name: "Kobold", range: [1, 1] }]
    });
    globalThis.game.tables.set(nested);
    globalThis.game.tables.set(inner);

    const refused = await router.route(
      createRequest("table.draw", { tableId: "table-nested", idempotencyKey: "nested-many", count: 2 })
    );
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("INVALID_PARAMS");
    expect(refused.error.details).toMatchObject({
      tableId: "table-nested",
      resultId: "row-nested",
      documentUuid: "RollTable.table-inner",
      count: 2
    });

    expect(refused.error.message).toContain("--count 1");
    expect(refused.error.message).toContain("--no-recursive");
    expect(nested.drawMany).not.toHaveBeenCalled();

    const refusedDry = await router.route(
      createRequest("table.draw", {
        tableId: "table-nested",
        idempotencyKey: "nested-dry",
        count: 2,
        dryRun: true
      })
    );
    expect(refusedDry.ok).toBe(false);
    expect(refusedDry.error.code).toBe("INVALID_PARAMS");

    const single = await router.route(
      createRequest("table.draw", { tableId: "table-nested", idempotencyKey: "nested-single" })
    );
    expect(single.ok).toBe(true);
    const nonRecursive = await router.route(
      createRequest("table.draw", {
        tableId: "table-nested",
        idempotencyKey: "nested-norec",
        count: 2,
        recursive: false
      })
    );
    expect(nonRecursive.ok).toBe(true);

    const replacementTable = createTableDocument("table-nested-replacement", {
      name: "Encounters (replacement)",
      replacement: true,
      results: [
        {
          id: "rep-nested",
          type: "document",
          name: "Inner",
          documentUuid: "RollTable.table-inner",
          range: [1, 1]
        }
      ]
    });
    globalThis.game.tables.set(replacementTable);
    const replacementDraw = await router.route(
      createRequest("table.draw", {
        tableId: "table-nested-replacement",
        idempotencyKey: "nested-rep",
        count: 2
      })
    );
    expect(replacementDraw.ok).toBe(true);
  });

  it("table.draw ALLOWS --count > 1 on a DIRECTLY self-referencing table (no foreign id can appear)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const table = createTableDocument("table-self-count", {
      name: "Recursive Loot",
      replacement: false,
      formula: "1d3",
      results: [
        { id: "self-count-a", name: "Coins", range: [1, 1] },
        { id: "self-count-b", name: "Gems", range: [2, 2] },
        {
          id: "self-count-link",
          type: "document",
          name: "Itself",
          documentUuid: "RollTable.table-self-count",
          range: [3, 3]
        }
      ]
    });
    globalThis.game.tables.set(table);

    const response = await router.route(
      createRequest("table.draw", { tableId: "table-self-count", idempotencyKey: "self-count", count: 2 })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({ mutation: "committed", availableBefore: 3, availableAfter: 1 });
    expect(table.drawMany).toHaveBeenCalled();

    const a = createTableDocument("table-cycle-count-a", {
      name: "A",
      replacement: false,
      results: [
        {
          id: "cycle-count-a-link",
          type: "document",
          name: "toB",
          documentUuid: "RollTable.table-cycle-count-b",
          range: [1, 1]
        }
      ]
    });
    const b = createTableDocument("table-cycle-count-b", {
      name: "B",
      replacement: false,
      results: [
        {
          id: "cycle-count-b-link",
          type: "document",
          name: "toA",
          documentUuid: "RollTable.table-cycle-count-a",
          range: [1, 1]
        }
      ]
    });
    globalThis.game.tables.set(a);
    globalThis.game.tables.set(b);

    const refusedCycle = await router.route(
      createRequest("table.draw", { tableId: "table-cycle-count-a", idempotencyKey: "cycle-count", count: 2 })
    );
    expect(refusedCycle.ok).toBe(false);
    expect(refusedCycle.error.code).toBe("INVALID_PARAMS");
    expect(refusedCycle.error.details).toMatchObject({
      tableId: "table-cycle-count-a",
      resultId: "cycle-count-a-link",
      documentUuid: "RollTable.table-cycle-count-b"
    });

    expect(refusedCycle.error.message).toContain("the singular draw path is unaffected");

    const packLookalike = createTableDocument("table-pack-lookalike", {
      name: "Pack lookalike",
      replacement: false,
      results: [
        {
          id: "pack-row",
          type: "document",
          name: "Packed",
          documentUuid: "Compendium.world.tables.RollTable.table-pack-lookalike",
          range: [1, 1]
        }
      ]
    });
    globalThis.game.tables.set(packLookalike);
    const refusedPack = await router.route(
      createRequest("table.draw", { tableId: "table-pack-lookalike", idempotencyKey: "pack-look", count: 2 })
    );
    expect(refusedPack.ok).toBe(false);
    expect(refusedPack.error.code).toBe("INVALID_PARAMS");
    expect(refusedPack.error.details.resultId).toBe("pack-row");
  });

  it("table.draw partial commit: chat failing AFTER the drawn write returns ok:true / complete:false", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");
    table.chatFailure = new Error("chat message creation failed");

    const response = await router.route(
      createRequest("table.draw", { tableId: "table-1", idempotencyKey: "draw-partial" })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      complete: false,
      mutation: "unknown",
      results: [],
      roll: null,
      availableBefore: 1,
      availableAfter: 0
    });

    expect(response.result.chatMessages).toEqual({ status: "unknown", expectedCount: 0, ids: [] });

    expect(response.result.failure).toEqual({
      code: "INTERNAL_ERROR",
      message: "chat message creation failed"
    });
    expect(table.results.get("result-1").drawn).toBe(true);
  });

  it("table.draw partial commit: a NESTED write that landed is CACHED, never rethrown", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const outer = createTableDocument("p1-outer", {
      name: "Outer",
      replacement: false,
      formula: "1d1",
      results: [
        {
          id: "p1-outer-link",
          type: "document",
          name: "Inner",
          documentUuid: "RollTable.p1-inner",
          range: [1, 1]
        }
      ]
    });
    const inner = createTableDocument("p1-inner", {
      name: "Inner",
      replacement: false,
      formula: "1d1",
      results: [{ id: "p1-inner-row", name: "Kobold", range: [1, 1] }]
    });
    globalThis.game.tables.set(outer);
    globalThis.game.tables.set(inner);
    outer.vetoResultUpdates = new Set(["p1-outer-link"]);
    outer.chatFailure = new Error("chat message creation failed");

    const response = await router.route(
      createRequest("table.draw", { tableId: "p1-outer", idempotencyKey: "p1-nested" })
    );

    expect(inner.results.get("p1-inner-row")._source.drawn).toBe(true);
    expect(outer.results.get("p1-outer-link")._source.drawn).toBe(false);

    expect(response.result.availableBefore).toBe(response.result.availableAfter);
    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({ complete: false, mutation: "unknown" });
    expect(response.result.failure).toEqual({
      code: "INTERNAL_ERROR",
      message: "chat message creation failed"
    });
  });

  it("table.draw partial commit: a concurrent UI draw's FALL is not our commit", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const table = createTableDocument("p2a-ui-draw", {
      name: "Restock",
      replacement: false,
      formula: "1d2",
      results: [
        { id: "p2a-1", name: "Rope", range: [1, 1] },
        { id: "p2a-2", name: "Torch", range: [2, 2] }
      ]
    });
    globalThis.game.tables.set(table);
    table.draw = vi.fn(async () => {
      setRowDrawn(table.results.get("p2a-2"), true);
      throw new Error("draw failed before writing anything");
    });

    const response = await router.route(
      createRequest("table.draw", { tableId: "p2a-ui-draw", idempotencyKey: "p2a-ui" })
    );

    expect(response.ok).toBe(true);

    expect(response.result).toMatchObject({
      complete: false,
      mutation: "unknown",
      availableBefore: 2,
      availableAfter: 1
    });
    expect(response.result.failure.message).toBe("draw failed before writing anything");
  });

  it("table.draw partial commit: a DELETED undrawn row lowers the count without any commit", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const table = createTableDocument("p2a-delete", {
      name: "Restock",
      replacement: false,
      formula: "1d2",
      results: [
        { id: "p2a-del-1", name: "Rope", range: [1, 1] },
        { id: "p2a-del-2", name: "Torch", range: [2, 2] }
      ]
    });
    globalThis.game.tables.set(table);
    table.draw = vi.fn(async () => {
      table.results.delete("p2a-del-2");
      throw new Error("draw failed before writing anything");
    });

    const response = await router.route(
      createRequest("table.draw", { tableId: "p2a-delete", idempotencyKey: "p2a-del" })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      complete: false,
      mutation: "unknown",
      availableBefore: 2,
      availableAfter: 1
    });
  });

  it("table.draw partial commit: a table with nested links still RETHROWS a provably clean failure", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const outer = createTableDocument("clean-outer", {
      name: "Outer",
      replacement: false,
      formula: "1d1",
      results: [
        {
          id: "clean-outer-link",
          type: "document",
          name: "Inner",
          documentUuid: "RollTable.clean-inner",
          range: [1, 1]
        }
      ]
    });
    const inner = createTableDocument("clean-inner", {
      name: "Inner",
      replacement: false,
      formula: "1d1",
      results: [{ id: "clean-inner-row", name: "Kobold", range: [1, 1] }]
    });
    globalThis.game.tables.set(outer);
    globalThis.game.tables.set(inner);
    outer.drawFailure = new Error(
      "Maximum recursion depth exceeded when attempting to draw from RollTable clean-outer"
    );

    const response = await router.route(
      createRequest("table.draw", { tableId: "clean-outer", idempotencyKey: "clean-fail" })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INTERNAL_ERROR");
    expect(response.error.details.message).toMatch(/Maximum recursion depth exceeded/);
    expect(inner.results.get("clean-inner-row")._source.drawn).toBe(false);
  });

  it("table.draw partial commit on a replacement:true table is honestly `unknown`", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = createTableDocument("table-replacement", {
      name: "Rumours",
      replacement: true,
      results: [{ id: "rumour-1", name: "A rumour", range: [1, 1] }]
    });
    table.chatFailure = new Error("chat message creation failed");
    globalThis.game.tables.set(table);

    const response = await router.route(
      createRequest("table.draw", { tableId: "table-replacement", idempotencyKey: "rep-partial" })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      complete: false,
      mutation: "unknown",
      availableBefore: 1,
      availableAfter: 1
    });
    expect(response.result.chatMessages.status).toBe("unknown");

    expect(response.result.failure).toEqual({
      code: "INTERNAL_ERROR",
      message: "chat message creation failed"
    });
  });

  it("table.draw partial commit: an availability INCREASE is `unknown`, never a committed draw", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const table = createTableDocument("table-avail-up", {
      name: "Restock",
      replacement: false,
      formula: "1d2",
      results: [
        { id: "up-1", name: "Rope", range: [1, 1] },
        { id: "up-2", name: "Torch", range: [2, 2], drawn: true }
      ]
    });
    setRowDrawn(table.results.get("up-2"), true);
    globalThis.game.tables.set(table);

    table.draw = vi.fn(async () => {
      setRowDrawn(table.results.get("up-2"), false);
      throw new Error("draw failed after a concurrent reset");
    });

    const response = await router.route(
      createRequest("table.draw", { tableId: "table-avail-up", idempotencyKey: "avail-up" })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      complete: false,
      mutation: "unknown",
      availableBefore: 1,
      availableAfter: 2
    });
    expect(response.result.failure).toEqual({
      code: "INTERNAL_ERROR",
      message: "draw failed after a concurrent reset"
    });
  });

  it("table.draw partial commit: an availability change on a replacement:true table is `unknown`, not committed", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const table = createTableDocument("table-rep-moved", {
      name: "Rumours",
      replacement: true,
      formula: "1d2",
      results: [
        { id: "rep-moved-1", name: "A rumour", range: [1, 1] },
        { id: "rep-moved-2", name: "Another", range: [2, 2] }
      ]
    });
    globalThis.game.tables.set(table);
    table.draw = vi.fn(async () => {
      setRowDrawn(table.results.get("rep-moved-2"), true);
      throw new Error("draw failed on a replacement table");
    });

    const response = await router.route(
      createRequest("table.draw", { tableId: "table-rep-moved", idempotencyKey: "rep-moved" })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      complete: false,
      mutation: "unknown",
      availableBefore: 2,
      availableAfter: 1
    });
  });

  it("table.draw --count > 1 goes through drawMany: N rows, one message, availability down by N", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = createTableDocument("table-many", {
      name: "Restock",
      replacement: false,
      results: [
        { id: "many-1", name: "Rope", range: [1, 1] },
        { id: "many-2", name: "Torch", range: [2, 2] },
        { id: "many-3", name: "Rations", range: [3, 3] }
      ]
    });
    globalThis.game.tables.set(table);

    const response = await router.route(
      createRequest("table.draw", { tableId: "table-many", idempotencyKey: "many-ok", count: 2 })
    );

    expect(response.ok).toBe(true);

    expect(table.drawMany).toHaveBeenCalledTimes(1);
    expect(table.draw).not.toHaveBeenCalled();
    expect(table.drawCalls.at(-1)).toMatchObject({ count: 2, recursive: true, displayChat: true });
    expect(response.result).toMatchObject({
      complete: true,
      mutation: "committed",
      availableBefore: 3,
      availableAfter: 1
    });
    expect(response.result.results).toHaveLength(2);

    expect(response.result.results.map((row) => [row.id, row.tableId, row.tableName])).toEqual([
      ["many-1", "table-many", "Restock"],
      ["many-2", "table-many", "Restock"]
    ]);
    expect(response.result.roll.total).toBe(2);

    expect(response.result.chatMessages).toMatchObject({ status: "captured", expectedCount: 1 });
    expect(response.result.chatMessages.ids).toHaveLength(1);
    expect([table.results.get("many-1").drawn, table.results.get("many-2").drawn]).toEqual([true, true]);
    expect(table.results.get("many-3").drawn).toBe(false);
  });

  it("table.draw treats a REJECTED multi-draw write as a clean failure, not as the live flags claim", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = createTableDocument("table-many-fail", {
      name: "Restock",
      replacement: false,
      results: [
        { id: "fail-1", name: "Rope", range: [1, 1] },
        { id: "fail-2", name: "Torch", range: [2, 2] },
        { id: "fail-3", name: "Rations", range: [3, 3] }
      ]
    });

    table.drawUpdateFailure = new Error("embedded update rejected");
    globalThis.game.tables.set(table);

    const response = await router.route(
      createRequest("table.draw", { tableId: "table-many-fail", idempotencyKey: "many-fail", count: 2 })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INTERNAL_ERROR");

    expect([table.results.get("fail-1").drawn, table.results.get("fail-2").drawn]).toEqual([true, true]);
    expect([table.results.get("fail-1")._source.drawn, table.results.get("fail-2")._source.drawn]).toEqual([
      false,
      false
    ]);

    const listed = await router.route(createRequest("table.list", { name: "Restock" }));
    const listedRow = listed.result.tables.find((row) => row.id === "table-many-fail");
    expect(listedRow).toMatchObject({ resultCount: 3, drawnCount: 0 });
    const got = await router.route(createRequest("table.get", { tableId: "table-many-fail" }));
    expect(got.result.table.results.map((row) => row.drawn)).toEqual([false, false, false]);

    const reset = await router.route(createRequest("table.reset", { tableId: "table-many-fail" }));
    expect(reset.result.changedCount).toBe(0);
  });

  it("table.draw drops captured ids when NOTHING was drawn — such a message cannot be ours", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");

    for (const row of table.results) {
      row.drawn = true;
    }

    table.foreignChatMessage = true;

    const response = await router.route(
      createRequest("table.draw", { tableId: "table-1", idempotencyKey: "draw-foreign-chat" })
    );

    expect(response.ok).toBe(true);
    expect(response.result.results).toEqual([]);
    expect(response.result.chatMessages).toEqual({ status: "captured", expectedCount: 0, ids: [] });
  });

  it("table.draw drops ALL ids on an OVER-capture — one of them is provably not ours", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");

    table.foreignChatMessage = true;

    const response = await router.route(
      createRequest("table.draw", { tableId: "table-1", idempotencyKey: "draw-over-capture" })
    );

    expect(response.ok).toBe(true);
    expect(response.result.results).toHaveLength(1);

    expect(response.result.chatMessages).toEqual({ status: "captured", expectedCount: 1, ids: [] });
    expect(response.result.complete).toBe(true);
  });

  it("table.draw applies the same id filter on the PARTIAL-COMMIT path — an over-capture is withheld there too", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");

    table.foreignChatMessage = 2;
    table.chatFailure = new Error("chat message creation failed");

    const messagesBefore = table.drawMessageCount;
    const response = await router.route(
      createRequest("table.draw", { tableId: "table-1", idempotencyKey: "partial-over-capture" })
    );

    expect(table.drawMessageCount - messagesBefore).toBe(2);

    expect(response.ok).toBe(true);

    expect(response.result).toMatchObject({ complete: false, mutation: "unknown" });
    expect(response.result.chatMessages).toEqual({ status: "unknown", expectedCount: 0, ids: [] });

    const single = createTableDocument("table-partial-single", {
      name: "Loot single",
      replacement: false,
      results: [{ id: "single-1", name: "Sword", range: [1, 1] }]
    });
    single.foreignChatMessage = true;
    single.chatFailure = new Error("chat message creation failed");
    globalThis.game.tables.set(single);
    const lone = await router.route(
      createRequest("table.draw", { tableId: "table-partial-single", idempotencyKey: "partial-lone" })
    );
    expect(lone.ok).toBe(true);
    expect(lone.result.complete).toBe(false);
    expect(lone.result.chatMessages.expectedCount).toBe(1);
    expect(lone.result.chatMessages.ids).toHaveLength(1);
  });

  it("table.draw rethrows a CLEAN failure (nothing persisted) instead of faking a partial commit", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");
    table.drawFailure = new Error("roll evaluation failed");

    const response = await router.route(
      createRequest("table.draw", { tableId: "table-1", idempotencyKey: "draw-clean-fail" })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INTERNAL_ERROR");
    expect(table.results.get("result-1").drawn).toBe(false);
  });

  it("table.draw reports `unknown` when no Hooks API is available to capture with", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const previousHooks = globalThis.Hooks;
    globalThis.Hooks = undefined;
    try {
      const response = await router.route(
        createRequest("table.draw", { tableId: "table-1", idempotencyKey: "draw-nohooks" })
      );
      expect(response.ok).toBe(true);

      expect(response.result.chatMessages).toMatchObject({ status: "unknown", expectedCount: 1, ids: [] });
      expect(response.result.complete).toBe(false);
    } finally {
      globalThis.Hooks = previousHooks;
    }
  });

  it("table.reset clears every drawn flag and reports the PRE-reset drawn count", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");

    await router.route(createRequest("table.draw", { tableId: "table-1", idempotencyKey: "pre-reset" }));
    expect(table.results.get("result-1").drawn).toBe(true);

    const response = await router.route(createRequest("table.reset", { tableId: "table-1" }));

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({ tableId: "table-1", reset: true, changedCount: 2 });

    expect(response.result.table.results.every((row) => row.drawn === false)).toBe(true);
    for (const row of table.results) {
      expect(row.drawn).toBe(false);
    }

    const again = await router.route(createRequest("table.reset", { tableId: "table-1" }));
    expect(again.result.changedCount).toBe(0);
    expect(again.result.reset).toBe(true);
  });

  it("table.reset dry-run previews the cleared rows and writes nothing", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");

    const dry = await router.route(createRequest("table.reset", { tableId: "table-1", dryRun: true }));
    expect(dry.ok).toBe(true);
    expect(dry.result).toMatchObject({ tableId: "table-1", reset: false, changedCount: 1, dryRun: true });

    expect(dry.result.table.results.every((row) => row.drawn === false)).toBe(true);

    expect(table.resetResults).not.toHaveBeenCalled();
    expect(table.results.get("result-2").drawn).toBe(true);

    const real = await router.route(createRequest("table.reset", { tableId: "table-1" }));
    expect(Object.keys(dry.result).sort()).toEqual([...Object.keys(real.result), "dryRun"].sort());
  });

  it("table.reset reports a VETOED (or partially vetoed) reset as INTERNAL_ERROR, not reset:true", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");

    await router.route(createRequest("table.draw", { tableId: "table-1", idempotencyKey: "pre-veto" }));
    expect(Array.from(table.results).every((row) => row.drawn)).toBe(true);

    const embeddedUpdate = table.updateEmbeddedDocuments;
    table.updateEmbeddedDocuments = vi.fn(async (type, entries, options) =>
      embeddedUpdate(type, entries.slice(0, 1), options)
    );

    const response = await router.route(createRequest("table.reset", { tableId: "table-1" }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INTERNAL_ERROR");
    expect(response.error.details).toMatchObject({
      tableId: "table-1",
      changedCount: 2,
      remainingDrawn: 1
    });

    expect(response.error.message).toMatch(/preUpdateTableResult/);
    expect(response.error.message).toMatch(/table get --table-id table-1/);

    expect(table.results.get("result-1").drawn).toBe(false);
    expect(table.results.get("result-2").drawn).toBe(true);
  });

  it("table.reset with nothing drawn stays ok:true when a concurrent draw lands inside the call", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const table = globalThis.game.tables.get("table-1");
    setRowDrawn(table.results.get("result-2"), false);

    table.updateEmbeddedDocuments = vi.fn(async () => {
      setRowDrawn(table.results.get("result-1"), true);
      return [];
    });

    const response = await router.route(createRequest("table.reset", { tableId: "table-1" }));
    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({ tableId: "table-1", reset: true, changedCount: 0 });

    expect(response.result.table.results.find((row) => row.id === "result-1").drawn).toBe(true);
  });

  it("table.draw / table.reset report a MISSING typed method as BRIDGE_NOT_READY, never as a partial commit", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const table = createTableDocument("table-no-api", {
      name: "No API",
      replacement: true,
      results: [{ id: "row-1", name: "Row", range: [1, 1] }]
    });
    delete table.draw;
    delete table.drawMany;
    delete table.resetResults;
    globalThis.game.tables.set(table);

    for (const params of [
      { command: "table.draw", params: { tableId: "table-no-api", idempotencyKey: "k" } },
      { command: "table.draw", params: { tableId: "table-no-api", idempotencyKey: "k", dryRun: true } },
      { command: "table.reset", params: { tableId: "table-no-api" } },
      { command: "table.reset", params: { tableId: "table-no-api", dryRun: true } }
    ]) {
      const response = await router.route(createRequest(params.command, params.params));

      expect(response.ok, JSON.stringify(params)).toBe(false);
      expect(response.error.code).toBe("BRIDGE_NOT_READY");
    }
  });

  it("table.draw / table.reset report TABLE_NOT_FOUND for an unknown table", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    for (const request of [
      createRequest("table.draw", { tableId: "nope", idempotencyKey: "k" }),
      createRequest("table.reset", { tableId: "nope" })
    ]) {
      const response = await router.route(request);
      expect(response.ok, request.command).toBe(false);
      expect(response.error.code).toBe("TABLE_NOT_FOUND");
      expect(response.error.message).toContain("table.list");
    }
  });

  it("draw evidence degrades FAIL-SAFE: an absent or `complete`-less snapshot is INCOMPLETE, never clean", () => {
    for (const snapshot of [undefined, null, {}, { tables: [] }, { tables: [], complete: undefined }]) {
      const evidence = evaluateTableDrawEvidence(snapshot);
      expect(evidence.complete, JSON.stringify(snapshot ?? null)).toBe(false);

      expect(isTableDrawCleanRefusal(evidence), JSON.stringify(snapshot ?? null)).toBe(false);
    }

    const complete = evaluateTableDrawEvidence({ tables: [], complete: true });
    expect(complete).toMatchObject({ marked: [], disturbed: false, complete: true });
    expect(isTableDrawCleanRefusal(complete)).toBe(true);
  });

  it("the count>1 snapshot's unconditional `complete:true` is guarded by an ORDERING dependency", () => {
    const inner = createTableDocument("order-inner", {
      name: "Inner",
      replacement: false,
      results: [{ id: "order-inner-1", name: "Kobold", range: [1, 1] }]
    });
    const foreign = createTableDocument("order-foreign", {
      name: "Foreign root",
      replacement: false,
      results: [
        {
          id: "order-link",
          type: "document",
          name: "Inner",
          documentUuid: "RollTable.order-inner",
          range: [1, 1]
        }
      ]
    });
    globalThis.game.tables.set(inner);
    globalThis.game.tables.set(foreign);

    const snapshot = snapshotTableDrawEvidence(foreign, { recursive: true, count: 2 });
    expect(snapshot.complete).toBe(true);
    expect(snapshot.tables.map((entry) => entry.tableId)).toEqual(["order-foreign"]);

    expect(() => assertTableDrawCountSupported(foreign, { count: 2, recursive: true })).toThrow(
      /nested-RollTable result/
    );

    expect(() => assertTableDrawCountSupported(foreign, { count: 2, recursive: false })).not.toThrow();
    const selfLink = createTableDocument("order-self", {
      name: "Self",
      replacement: false,
      results: [
        { id: "order-self-1", name: "Coins", range: [1, 1] },
        {
          id: "order-self-link",
          type: "document",
          name: "Self",
          documentUuid: "RollTable.order-self",
          range: [2, 2]
        }
      ]
    });
    globalThis.game.tables.set(selfLink);
    expect(() => assertTableDrawCountSupported(selfLink, { count: 2, recursive: true })).not.toThrow();
    const selfSnapshot = snapshotTableDrawEvidence(selfLink, { recursive: true, count: 2 });
    expect(selfSnapshot.complete).toBe(true);
    expect(selfSnapshot.tables.map((entry) => entry.tableId)).toEqual(["order-self"]);
  });

  it("pins the SOURCE ORDER the count>1 snapshot depends on (guard before snapshot in table.draw)", () => {
    const source = readFileSync(new URL("../scripts/handlers/tables.js", import.meta.url), "utf8");
    const draw = source.slice(source.indexOf('async "table.draw"(params) {'));
    const body = draw.slice(0, draw.indexOf('async "table.reset"(params) {'));
    const guardIndex = body.indexOf("assertTableDrawCountSupported(table");
    const snapshotIndex = body.indexOf("snapshotTableDrawEvidence(table");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(snapshotIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(snapshotIndex);
  });

  it("the GLOBAL table queue stops two recursive draws from double-selecting a shared nested row", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const shared = createTableDocument("table-shared", {
      name: "Shared",
      replacement: false,
      results: [
        { id: "shared-1", name: "First", range: [1, 1] },
        { id: "shared-2", name: "Second", range: [2, 2] }
      ]
    });
    const makeRoot = (id) =>
      createTableDocument(id, {
        name: id,
        replacement: false,
        results: [
          {
            id: `${id}-link`,
            type: "document",
            name: "Shared",
            documentUuid: "RollTable.table-shared",
            range: [1, 1]
          }
        ]
      });
    const rootA = makeRoot("root-a");
    const rootB = makeRoot("root-b");
    for (const table of [shared, rootA, rootB]) {
      globalThis.game.tables.set(table);
    }

    const [drawA, drawB] = await Promise.all([
      router.route(createRequest("table.draw", { tableId: "root-a", idempotencyKey: "race-a" })),
      router.route(createRequest("table.draw", { tableId: "root-b", idempotencyKey: "race-b" }))
    ]);

    expect(drawA.ok && drawB.ok).toBe(true);
    const drawnIds = [drawA.result.results[0]?.id, drawB.result.results[0]?.id];

    expect(new Set(drawnIds).size).toBe(2);
    expect(Array.from(shared.results).every((row) => row.drawn)).toBe(true);

    expect(drawA.result.results[0].tableId).toBe("table-shared");

    for (const row of shared.results) {
      row.drawn = false;
    }
    for (const root of [rootA, rootB]) {
      for (const row of root.results) {
        row.drawn = false;
      }
    }
    const [unqueuedA, unqueuedB] = await Promise.all([
      rootA.draw({ recursive: true, displayChat: false, rollMode: "publicroll" }),
      rootB.draw({ recursive: true, displayChat: false, rollMode: "publicroll" })
    ]);
    expect(unqueuedA.results[0].id).toBe(unqueuedB.results[0].id);
  });

  const queuedTableMutations = [
    {
      command: "table.update",
      params: { tableId: "table-queued", patch: { name: "Renamed" } },
      arm: (table, mark) => {
        const original = table.update;
        table.update = vi.fn(async (...args) => {
          mark();
          return original(...args);
        });
      }
    },
    {
      command: "table.clone",
      params: { tableId: "table-queued" },

      arm: (table, mark) => {
        const original = table.clone;
        table.clone = vi.fn(async (patch, context = {}) => {
          if (context.save === true) mark();
          return original(patch, context);
        });
      }
    },
    {
      command: "table.delete",
      params: { tableId: "table-queued" },
      arm: (table, mark) => {
        const original = table.delete;
        table.delete = vi.fn(async (...args) => {
          mark();
          return original(...args);
        });
      }
    },
    {
      command: "table.result.create",
      params: { tableId: "table-queued", data: { name: "Added", range: [1, 1] } },
      arm: (table, mark) => {
        const original = table.createEmbeddedDocuments;
        table.createEmbeddedDocuments = vi.fn(async (...args) => {
          mark();
          return original(...args);
        });
      }
    },
    {
      command: "table.result.update",
      params: { tableId: "table-queued", resultId: "queued-1", patch: { name: "Renamed row" } },

      arm: () => {}
    },
    {
      command: "table.result.clone",
      params: { tableId: "table-queued", resultId: "queued-1" },

      arm: (table, mark) => {
        const row = table.results.get("queued-1");
        const original = row.clone;
        row.clone = vi.fn(async (patch, context = {}) => {
          if (context.save === true) mark();
          return original(patch, context);
        });
      }
    },
    {
      command: "table.result.delete",
      params: { tableId: "table-queued", resultId: "queued-1" },
      arm: (table, mark) => {
        const original = table.deleteEmbeddedDocuments;
        table.deleteEmbeddedDocuments = vi.fn(async (...args) => {
          mark();
          return original(...args);
        });
      }
    },
    {
      command: "table.reset",
      params: { tableId: "table-queued" },
      arm: () => {}
    },
    {
      command: "table.ownership.set",
      params: { tableId: "table-queued", default: 2 },
      arm: (table, mark) => {
        const original = table.update;
        table.update = vi.fn(async (...args) => {
          mark();
          return original(...args);
        });
      }
    }
  ];

  it.each(queuedTableMutations)(
    "runs $command inside the global table queue (its write waits for an in-flight draw)",
    async ({ command, params, arm }) => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const table = createTableDocument("table-queued", {
        name: "Queued",
        replacement: false,
        results: [
          { id: "queued-1", name: "First", range: [1, 1] },
          { id: "queued-2", name: "Second", range: [2, 2] }
        ]
      });
      globalThis.game.tables.set(table);

      const order = [];
      /** @type {(value?: unknown) => void} */
      let releaseDraw = () => {};
      const gate = new Promise((resolve) => {
        releaseDraw = resolve;
      });
      const embeddedUpdate = table.updateEmbeddedDocuments;
      table.updateEmbeddedDocuments = vi.fn(async (type, entries, options) => {
        const isDrawMarking =
          options?.diff === false && entries.length > 0 && entries.every((entry) => entry.drawn === true);
        if (isDrawMarking) {
          order.push("draw-write");
          await gate;
          order.push("draw-done");
          return embeddedUpdate(type, entries, options);
        }
        order.push("second-write");
        return embeddedUpdate(type, entries, options);
      });
      arm(table, () => order.push("second-write"));

      const drawing = router.route(
        createRequest("table.draw", { tableId: "table-queued", idempotencyKey: "queued-draw" })
      );
      const second = router.route(createRequest(command, params));

      let snapshot;
      try {
        for (let tick = 0; tick < 6; tick += 1) {
          await Promise.resolve();
        }
        snapshot = [...order];
      } finally {
        releaseDraw();
      }
      const [drawResponse, secondResponse] = await Promise.all([drawing, second]);

      expect(snapshot).toEqual(["draw-write"]);
      expect(drawResponse.ok, JSON.stringify(drawResponse.error ?? {})).toBe(true);
      expect(secondResponse.ok, JSON.stringify(secondResponse.error ?? {})).toBe(true);

      expect(order).toEqual(["draw-write", "draw-done", "second-write"]);
    }
  );

  /** @param {{ folderId: string, seedTableInFolder: boolean }} options */
  async function raceFolderDeleteAgainstInFlightDraw({ folderId, seedTableInFolder }) {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const table = createTableDocument("table-in-folder", {
      name: "Restock",
      replacement: false,
      folder: seedTableInFolder ? "folder-tables" : null,
      results: [
        { id: "cascade-1", name: "First", range: [1, 1] },
        { id: "cascade-2", name: "Second", range: [2, 2] }
      ]
    });
    globalThis.game.tables.set(table);

    globalThis.game.collections = new Map([
      ["RollTable", globalThis.game.tables],
      ["Actor", globalThis.game.actors]
    ]);
    globalThis.game.folders.set(
      createDocument("folder-tables", {
        name: "Tables",
        type: "RollTable",
        folder: null,
        description: "",
        sorting: "a",
        sort: 0,
        flags: {}
      })
    );

    const order = [];
    /** @type {(value?: unknown) => void} */
    let releaseDraw = () => {};
    const gate = new Promise((resolve) => {
      releaseDraw = resolve;
    });
    const embeddedUpdate = table.updateEmbeddedDocuments;
    table.updateEmbeddedDocuments = vi.fn(async (type, entries, options) => {
      const isDrawMarking =
        options?.diff === false && entries.length > 0 && entries.every((entry) => entry.drawn === true);
      if (isDrawMarking) {
        order.push("draw-write");
        await gate;
        order.push("draw-done");
        return embeddedUpdate(type, entries, options);
      }
      return embeddedUpdate(type, entries, options);
    });

    const folder = globalThis.game.folders.get(folderId);
    folder.delete = vi.fn(async () => {
      order.push("cascade-write");
      globalThis.game.folders.delete(folderId);
      return folder;
    });

    const drawing = router.route(
      createRequest("table.draw", { tableId: "table-in-folder", idempotencyKey: `cascade-${folderId}` })
    );
    const deleting = router.route(createRequest("folder.delete", { folderId }));

    let snapshot;
    try {
      for (let tick = 0; tick < 6; tick += 1) {
        await Promise.resolve();
      }
      snapshot = [...order];
    } finally {
      releaseDraw();
    }
    const [drawResponse, deleteResponse] = await Promise.all([drawing, deleting]);
    return { snapshot, order, drawResponse, deleteResponse };
  }

  it("folder.delete of a RollTable folder waits for an in-flight draw (folder → table lock)", async () => {
    const { snapshot, order, drawResponse, deleteResponse } = await raceFolderDeleteAgainstInFlightDraw({
      folderId: "folder-tables",
      seedTableInFolder: true
    });

    expect(snapshot).toEqual(["draw-write"]);
    expect(drawResponse.ok, JSON.stringify(drawResponse.error ?? {})).toBe(true);
    expect(deleteResponse.ok, JSON.stringify(deleteResponse.error ?? {})).toBe(true);

    expect(order).toEqual(["draw-write", "draw-done", "cascade-write"]);

    expect(deleteResponse.result.contents.reparented.ids).toEqual(["table-in-folder"]);
  });

  it("folder.delete of a NON-RollTable folder does NOT wait (the lock is type-scoped)", async () => {
    const { snapshot, drawResponse, deleteResponse } = await raceFolderDeleteAgainstInFlightDraw({
      folderId: "folder-actors-test",
      seedTableInFolder: false
    });

    expect(snapshot).toEqual(["draw-write", "cascade-write"]);
    expect(drawResponse.ok, JSON.stringify(drawResponse.error ?? {})).toBe(true);
    expect(deleteResponse.ok, JSON.stringify(deleteResponse.error ?? {})).toBe(true);
  });
});

describe("withQueuedTableOwnership wiring invariant", () => {
  const noop = async () => ({ ok: true });

  it("throws when the ownership map carries no `table.ownership.set` handler", () => {
    expect(() => withQueuedTableOwnership({})).toThrow(/table\.ownership\.set/);
  });

  it("throws when the map carries OTHER ownership families but not the table one", () => {
    expect(() => withQueuedTableOwnership({ "actor.ownership.set": noop })).toThrow(/table\.ownership\.set/);
  });

  it("throws when `table.ownership.set` is present but is not a function", () => {
    expect(() =>
      withQueuedTableOwnership({ "table.ownership.set": /** @type {any} */ ({ handler: noop }) })
    ).toThrow(/table\.ownership\.set/);
  });

  it.each([
    ["undefined", undefined],
    ["null", null]
  ])("throws when the ownership map itself is %s", (_label, input) => {
    expect(() => withQueuedTableOwnership(/** @type {any} */ (input))).toThrow(/table\.ownership\.set/);
  });

  it("wraps ONLY `table.ownership.set` and passes every other family through identity-equal", async () => {
    const others = {
      "actor.ownership.set": noop,
      "item.ownership.set": noop,
      "journal.ownership.set": noop,
      "scene.ownership.set": noop,
      "macro.ownership.set": noop,
      "playlist.ownership.set": noop
    };
    const tableHandler = vi.fn(async (params, context) => ({ params, context }));
    const wrapped = withQueuedTableOwnership({ ...others, "table.ownership.set": tableHandler });

    for (const [key, handler] of Object.entries(others)) {
      expect(wrapped[key]).toBe(handler);
    }

    expect(wrapped["table.ownership.set"]).not.toBe(tableHandler);
    await expect(wrapped["table.ownership.set"]({ tableId: "t" }, { requestId: "r" })).resolves.toEqual({
      params: { tableId: "t" },
      context: { requestId: "r" }
    });
    expect(tableHandler).toHaveBeenCalledWith({ tableId: "t" }, { requestId: "r" });
  });
});
