import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertBatchArrayWritesReflected,
  assertNoAmbiguousBatchKeySpellings,
  batchMergedConfirmationKeys,
  batchValuesEqual
} from "../scripts/lib/batch-guards.js";
import {
  BATCH_STATUS,
  assertBatchWithinLimit,
  assertNoDuplicateBatchIds,
  buildBatchResult,
  executeBatchCreate,
  executeBatchDelete,
  executeBatchUpdate,
  generateUnusedDocumentId
} from "../scripts/lib/batch-write.js";
import {
  BATCH_WRITE_MAX_ITEMS,
  BATCH_WRITE_PERSISTED_STATUSES,
  BATCH_WRITE_STATUSES,
  BATCH_WRITE_SUCCESS_STATUSES,
  ERROR_CODES
} from "../scripts/generated/protocol.js";
import { BridgeError, createBridgeError, toProtocolError } from "../scripts/lib/errors.js";

const ERROR_CODES_VALUES = Object.values(ERROR_CODES);

function createStore(rows = []) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    byId,
    has: (id) => byId.has(id),
    get: (id) => byId.get(id) ?? null,
    set: (row) => byId.set(row.id, row),
    delete: (id) => byId.delete(id)
  };
}

let idCounter = 0;

beforeEach(() => {
  idCounter = 0;
  globalThis.foundry = {
    utils: {
      randomID: () => `batchid${String(idCounter++).padStart(8, "0")}`,
      deepClone: (value) => structuredClone(value)
    }
  };
});

afterEach(() => {
  delete globalThis.foundry;
  vi.restoreAllMocks();
});

describe("batch-write engine: shared gates", () => {
  it("enforces BATCH_WRITE_MAX_ITEMS itself, because the schema maxItems is advisory", () => {
    const items = Array.from({ length: BATCH_WRITE_MAX_ITEMS + 1 }, (_unused, index) => index);
    expect(() => assertBatchWithinLimit(items, { command: "scene.wall.create-many", field: "data" })).toThrow(
      /at most 100 data per call \(received 101\)/
    );

    /** @type {any} */
    let capped = null;
    try {
      assertBatchWithinLimit(items, { command: "scene.wall.create-many", field: "data" });
    } catch (error) {
      capped = error;
    }
    expect(capped?.message.endsWith("Nothing was written.")).toBe(true);
    expect(capped?.message).not.toContain("element ");

    expect(() =>
      assertBatchWithinLimit(items.slice(0, BATCH_WRITE_MAX_ITEMS), {
        command: "scene.wall.create-many",
        field: "data"
      })
    ).not.toThrow();
  });

  it("rejects a duplicate id naming BOTH indices", () => {
    /** @type {any} */
    let error = null;
    try {
      assertNoDuplicateBatchIds(["a", "b", "a"], { command: "scene.wall.update-many", field: "id" });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain("twice (indices 0 and 2)");

    expect(error?.message.endsWith("Nothing was written.")).toBe(true);
    expect(error?.details).toEqual({ index: 2, duplicateOfIndex: 0, id: "a", field: "id" });
  });

  it("mints ids that collide with NEITHER stored state NOR ids already minted in this call", () => {
    const taken = new Set(["batchid00000000"]);
    const first = generateUnusedDocumentId((id) => taken.has(id));
    taken.add(first);
    const second = generateUnusedDocumentId((id) => taken.has(id));
    expect(first).toBe("batchid00000001");
    expect(second).toBe("batchid00000002");
  });

  it("reports BRIDGE_NOT_READY when the Foundry id generator is absent", () => {
    delete globalThis.foundry;
    expect(() => generateUnusedDocumentId(() => false)).toThrow(/randomID/);
  });

  it("derives `complete` from the SUCCESS statuses and pins the enum membership", () => {
    for (const status of Object.values(BATCH_STATUS)) {
      expect(BATCH_WRITE_STATUSES).toContain(status);
    }
    for (const status of BATCH_WRITE_SUCCESS_STATUSES) {
      expect(BATCH_WRITE_STATUSES).toContain(status);
    }
    for (const status of BATCH_WRITE_PERSISTED_STATUSES) {
      expect(BATCH_WRITE_SUCCESS_STATUSES).toContain(status);
    }
    expect(
      buildBatchResult({ outcomes: [{ index: 0, id: "a", status: BATCH_STATUS.UNCHANGED }] }).complete
    ).toBe(true);
    expect(
      buildBatchResult({ outcomes: [{ index: 0, id: "a", status: BATCH_STATUS.DROPPED }] }).complete
    ).toBe(false);
    expect(
      buildBatchResult({ outcomes: [{ index: 0, id: "a", status: BATCH_STATUS.UNKNOWN }] }).complete
    ).toBe(false);

    expect(Object.keys(buildBatchResult({ outcomes: [] }))).toEqual(["complete", "outcomes"]);
  });
});

describe("batch-write engine: create-many", () => {
  const baseArgs = (store, overrides = {}) => ({
    command: "scene.wall.create-many",
    items: [{ c: [0, 0, 1, 1] }, { c: [1, 1, 2, 2] }],
    dryRun: false,
    prepare: (data) => ({ ...data }),
    preview: () => ({}),
    isIdTaken: (id) => store.has(id),
    create: async (payloads) => {
      const created = payloads.map((payload) => ({ id: payload._id, ...payload }));
      for (const row of created) store.set(row);
      return created;
    },
    readBack: (id) => store.get(id),
    ...overrides
  });

  it("pre-generates ids, calls Foundry ONCE, and credits each element by its OWN id", async () => {
    const store = createStore();
    const create = vi.fn(baseArgs(store).create);
    const result = await executeBatchCreate(baseArgs(store, { create }));

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].map((payload) => payload._id)).toEqual([
      "batchid00000000",
      "batchid00000001"
    ]);
    expect(result).toEqual({
      complete: true,
      outcomes: [
        { index: 0, id: "batchid00000000", status: "created" },
        { index: 1, id: "batchid00000001", status: "created" }
      ]
    });
  });

  it("keeps outcomes in INPUT order even when Foundry returns the documents REVERSED", async () => {
    const store = createStore();
    const result = await executeBatchCreate(
      baseArgs(store, {
        create: async (payloads) => {
          const created = payloads.map((payload) => ({ id: payload._id, ...payload }));
          for (const row of created) store.set(row);
          return [...created].reverse();
        }
      })
    );
    expect(result.outcomes.map((outcome) => [outcome.index, outcome.id])).toEqual([
      [0, "batchid00000000"],
      [1, "batchid00000001"]
    ]);
  });

  it("prevalidates EVERY element before writing, and one bad element rejects the whole call", async () => {
    const store = createStore();
    const create = vi.fn();
    await expect(
      executeBatchCreate(
        baseArgs(store, {
          create,
          preview: (_payload, index) => {
            if (index === 1) throw Object.assign(new Error("bad wall"), { code: ERROR_CODES.INVALID_PARAMS });
            return {};
          }
        })
      )
    ).rejects.toThrow("bad wall");
    expect(create).not.toHaveBeenCalled();
    expect(store.byId.size).toBe(0);
  });

  it("names the ELEMENT INDEX on a prevalidation failure, whatever layer raised it", async () => {
    /** @type {Array<{label: string, args: Record<string, any>, code: string, message: string, details: Record<string, any>}>} */
    const cases = [
      {
        label: "a family BridgeError from prepare",
        args: {
          prepare: (data, index) => {
            if (index === 1)
              throw createBridgeError(ERROR_CODES.INVALID_PARAMS, "the family refused this element");
            return { ...data };
          }
        },
        code: ERROR_CODES.INVALID_PARAMS,
        message: "scene.wall.create-many element 1: the family refused this element. Nothing was written.",
        details: { index: 1 }
      },
      {
        label: "a Foundry validation error from strict construction",
        args: {
          preview: (_copy, index) => {
            if (index === 1) {
              throw Object.assign(new Error("Wall validation errors: c: may not be an array of 2"), {
                name: "DataModelValidationError"
              });
            }
            return {};
          }
        },
        code: ERROR_CODES.INVALID_PARAMS,

        message:
          "scene.wall.create-many element 1: Foundry rejected the document data; see details.message for the raw " +
          "validation error and details.errors (when present) for the offending field paths, then fix those " +
          "fields and resend. Nothing was written.",
        details: {
          index: 1,
          reason: "foundry_validation",
          message: "Wall validation errors: c: may not be an array of 2"
        }
      },
      {
        label: "a BRIDGE_NOT_READY from a missing Foundry API",
        args: {
          preview: () => {
            throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "construction API is not available");
          }
        },

        code: ERROR_CODES.BRIDGE_NOT_READY,
        message: "scene.wall.create-many element 0: construction API is not available. Nothing was written.",
        details: { index: 0 }
      }
    ];

    for (const { label, args, code, message, details } of cases) {
      const store = createStore();
      const create = vi.fn();
      /** @type {any} */
      let caught = null;
      try {
        await executeBatchCreate(baseArgs(store, { create, ...args }));
      } catch (error) {
        caught = error;
      }
      expect(caught?.code, label).toBe(code);
      expect(caught?.message, label).toBe(message);
      expect(caught?.details, label).toMatchObject(details);

      expect(caught?.details, label).not.toHaveProperty("id");
      expect(create, label).not.toHaveBeenCalled();
      expect(store.byId.size, label).toBe(0);
    }
  });

  it("stamps the message IDEMPOTENTLY, so a family that already builds the shared shape is untouched", async () => {
    const store = createStore();
    const alreadyShaped =
      "scene.wall.create-many element 1 names actor nope, which was not found; use actor.list to find " +
      "valid ids. Nothing was written.";
    /** @type {any} */
    let caught = null;
    try {
      await executeBatchCreate(
        baseArgs(store, {
          create: vi.fn(),
          prepare: (data, index) => {
            if (index === 1)
              throw createBridgeError(ERROR_CODES.ACTOR_NOT_FOUND, alreadyShaped, { index: 1 });
            return { ...data };
          }
        })
      );
    } catch (error) {
      caught = error;
    }
    expect(caught?.code).toBe(ERROR_CODES.ACTOR_NOT_FOUND);
    expect(caught?.message).toBe(alreadyShaped);

    /** @type {any} */
    let mismatched = null;
    try {
      await executeBatchCreate(
        baseArgs(store, {
          create: vi.fn(),
          items: Array.from({ length: 2 }, () => ({ c: [0, 0, 1, 1] })),
          prepare: (data, index) => {
            if (index === 1) {
              throw createBridgeError(
                ERROR_CODES.INVALID_PARAMS,
                "scene.wall.create-many element 10 is the one at fault. Nothing was written."
              );
            }
            return { ...data };
          }
        })
      );
    } catch (error) {
      mismatched = error;
    }
    expect(mismatched?.message).toBe(
      "scene.wall.create-many element 1: scene.wall.create-many element 10 is the one at fault. Nothing was written."
    );
  });

  it("leaves an UNRECOGNIZED throw untouched — it is a bridge bug, not an addressed refusal", async () => {
    const store = createStore();
    /** @type {any} */
    let caught = null;
    try {
      await executeBatchCreate(
        baseArgs(store, {
          create: vi.fn(),
          prepare: (data, index) => {
            if (index === 1) throw new TypeError("cannot read properties of undefined");
            return { ...data };
          }
        })
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TypeError);
    expect(caught.message).toBe("cannot read properties of undefined");
    expect(caught.message).not.toContain("element 1");
    expect(caught.message).not.toContain("Nothing was written");
    expect(caught.details).toBeUndefined();
  });

  it("validates a COPY, so strict construction cannot mutate the payload Foundry receives", async () => {
    const store = createStore();
    const create = vi.fn(baseArgs(store).create);
    await executeBatchCreate(
      baseArgs(store, {
        create,
        items: [{ c: [0, 0, 1, 1] }],
        preview: (copy) => {
          copy.injectedByValidation = true;
          return {};
        }
      })
    );
    expect(create.mock.calls[0][0][0]).not.toHaveProperty("injectedByValidation");
  });

  /** @type {Array<[string, boolean]>} */
  const cloneFallbackCases = [
    ["falls back to structuredClone when foundry.utils.deepClone is absent", false],
    ["falls back to a recursive copy when NEITHER clone API is available", true]
  ];
  for (const [label, withoutStructuredClone] of cloneFallbackCases) {
    it(label, async () => {
      const store = createStore();
      const create = vi.fn(baseArgs(store).create);
      const nativeStructuredClone = globalThis.structuredClone;
      delete (/** @type {any} */ (globalThis.foundry).utils.deepClone);
      if (withoutStructuredClone) {
        // @ts-expect-error
        delete globalThis.structuredClone;
      }
      try {
        await executeBatchCreate(
          baseArgs(store, {
            create,
            items: [{ c: [0, 0, 1, 1], texture: { src: "a.webp" } }],
            preview: (copy) => {
              copy.injectedByValidation = true;
              copy.texture.injectedNested = true;
              copy.c.push(999);
              return {};
            }
          })
        );
      } finally {
        if (withoutStructuredClone) globalThis.structuredClone = nativeStructuredClone;
      }
      const sent = create.mock.calls[0][0][0];
      expect(sent).not.toHaveProperty("injectedByValidation");
      expect(sent.texture).not.toHaveProperty("injectedNested");
      expect(sent.c).toEqual([0, 0, 1, 1]);
    });
  }

  it("dry-run previews every element with id:null and never calls Foundry", async () => {
    const store = createStore();
    const create = vi.fn();
    const result = await executeBatchCreate(baseArgs(store, { create, dryRun: true }));
    expect(create).not.toHaveBeenCalled();
    expect(result).toEqual({
      complete: true,
      dryRun: true,
      outcomes: [
        { index: 0, id: null, status: "created" },
        { index: 1, id: null, status: "created" }
      ]
    });
  });

  it("reports `dropped` for an element Foundry silently refused, with complete:false", async () => {
    const store = createStore();
    const result = await executeBatchCreate(
      baseArgs(store, {
        create: async (payloads) => {
          const created = payloads
            .filter((_payload, index) => index !== 1)
            .map((payload) => ({ id: payload._id, ...payload }));
          for (const row of created) store.set(row);
          return created;
        }
      })
    );
    expect(result.complete).toBe(false);
    expect(result.outcomes).toEqual([
      { index: 0, id: "batchid00000000", status: "created" },
      { index: 1, id: "batchid00000001", status: "dropped" }
    ]);

    expect(result.outcomes[1]).not.toHaveProperty("error");
    expect(result).not.toHaveProperty("failure");
  });

  it("ERRORS (uncached) when the call resolved and NOTHING landed", async () => {
    const store = createStore();
    /** @type {any} */
    let error = null;
    try {
      await executeBatchCreate(baseArgs(store, { create: async () => [] }));
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INTERNAL_ERROR);

    expect(error?.message).toContain("confirmed no requested write");
    expect(error?.details.outcomes.map((outcome) => outcome.status)).toEqual(["dropped", "dropped"]);
  });

  it("on a THROW after partial persistence: ok body, complete:false, `unknown` for the unestablished", async () => {
    const store = createStore();
    const result = await executeBatchCreate(
      baseArgs(store, {
        create: async (payloads) => {
          store.set({ id: payloads[0]._id, ...payloads[0] });

          throw createBridgeError(ERROR_CODES.BRIDGE_DISCONNECTED, "socket closed");
        }
      })
    );
    expect(result.complete).toBe(false);
    expect(result.outcomes).toEqual([
      { index: 0, id: "batchid00000000", status: "created" },
      { index: 1, id: "batchid00000001", status: "unknown" }
    ]);

    expect(result.failure).toEqual({ code: ERROR_CODES.BRIDGE_DISCONNECTED, message: "socket closed" });
  });

  it("classifies `failure.code` through the shared seam, so it is ALWAYS a protocol error code", async () => {
    /** @type {Array<{ label: string, thrown: Error, expectedCode: string }>} */
    const cases = [
      {
        label: "a foreign string code",
        thrown: Object.assign(new Error("module said no"), { code: "MY_MODULE_FAIL" }),
        expectedCode: ERROR_CODES.INTERNAL_ERROR
      },
      {
        label: "a bare Error",
        thrown: new Error("server refused the operation"),
        expectedCode: ERROR_CODES.INTERNAL_ERROR
      },
      {
        label: "a Foundry validation error",
        thrown: Object.assign(new Error("Wall validation errors: c: may not be an array of 2"), {
          name: "DataModelValidationError"
        }),
        expectedCode: ERROR_CODES.INVALID_PARAMS
      }
    ];
    for (const { label, thrown, expectedCode } of cases) {
      const store = createStore();
      const result = await executeBatchCreate(
        baseArgs(store, {
          create: async (payloads) => {
            store.set({ id: payloads[0]._id, ...payloads[0] });
            throw thrown;
          }
        })
      );
      expect(result.failure.code, label).toBe(expectedCode);
      expect(ERROR_CODES_VALUES, label).toContain(result.failure.code);

      expect(result.failure.message, label).toBe(thrown.message);
    }
  });

  it("on a THROW with nothing persisted: raises the cause with the reconciliation ON THE WIRE", async () => {
    const store = createStore();
    const thrown = new Error("server refused the operation");
    /** @type {any} */
    let error = null;
    try {
      await executeBatchCreate(
        baseArgs(store, {
          create: async () => {
            throw thrown;
          }
        })
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(BridgeError);
    const routed = toProtocolError(error);
    expect(routed.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(routed.message).toBe("server refused the operation");
    expect(routed.details.message).toBe("server refused the operation");
    expect(routed.details.outcomes.map((outcome) => outcome.status)).toEqual(["unknown", "unknown"]);
  });

  it("does not let a NON-EXTENSIBLE thrown error replace the cause", async () => {
    const store = createStore();
    const thrown = Object.freeze(new Error("hook says no"));
    /** @type {any} */
    let error = null;
    try {
      await executeBatchCreate(
        baseArgs(store, {
          create: async () => {
            throw thrown;
          }
        })
      );
    } catch (caught) {
      error = caught;
    }
    const routed = toProtocolError(error);
    expect(routed.message).toBe("hook says no");
    expect(routed.message).not.toContain("not extensible");
    expect(routed.details.outcomes.map((outcome) => outcome.status)).toEqual(["unknown", "unknown"]);
  });

  it("keeps a BridgeError cause's own code and details BESIDE the reconciliation", async () => {
    const store = createStore();
    /** @type {any} */
    let error = null;
    try {
      await executeBatchCreate(
        baseArgs(store, {
          create: async () => {
            throw createBridgeError(ERROR_CODES.SCENE_NOT_FOUND, "scene vanished mid-batch", {
              sceneId: "s1"
            });
          }
        })
      );
    } catch (caught) {
      error = caught;
    }
    const routed = toProtocolError(error);
    expect(routed.code).toBe(ERROR_CODES.SCENE_NOT_FOUND);
    expect(routed.message).toBe("scene vanished mid-batch");
    expect(routed.details.sceneId).toBe("s1");
    expect(routed.details.outcomes.map((outcome) => outcome.status)).toEqual(["unknown", "unknown"]);
  });
});

describe("batch-write engine: update-many", () => {
  function createRow(id, source) {
    return { id, source: { ...source } };
  }

  const baseArgs = (store, overrides = {}) => ({
    command: "scene.wall.update-many",
    patches: [
      { id: "wall-1", patch: { door: 1 } },
      { id: "wall-2", patch: { ds: 1 } }
    ],
    dryRun: false,
    resolve: (id, index) => {
      const row = store.get(id);
      if (!row)
        throw Object.assign(new Error(`missing ${id}`), { code: "WALL_NOT_FOUND", details: { index } });
      return row;
    },
    prepare: (patch) => ({ ...patch }),

    diff: async (document, patch) =>
      Object.fromEntries(Object.entries(patch).filter(([key, value]) => document.source[key] !== value)),
    mergePreview: async (document, patch) => ({ toObject: () => ({ ...document.source, ...patch }) }),
    update: async (entries) => {
      const updated = [];
      for (const entry of entries) {
        const { _id, ...patch } = entry;
        const row = store.get(_id);
        Object.assign(row.source, patch);
        updated.push(row);
      }
      return updated;
    },
    ...overrides
  });

  let store;
  beforeEach(() => {
    store = createStore([createRow("wall-1", { door: 0, ds: 0 }), createRow("wall-2", { door: 0, ds: 0 })]);
  });

  it("updates both elements and reports them in input order", async () => {
    const result = await executeBatchUpdate(baseArgs(store));
    expect(result).toEqual({
      complete: true,
      outcomes: [
        { index: 0, id: "wall-1", status: "updated" },
        { index: 1, id: "wall-2", status: "updated" }
      ]
    });
  });

  const collapsingIdSetField = {
    clean: (value) => {
      if (value === null || value === undefined) return [];
      if (!Array.isArray(value)) return typeof value === "object" ? [] : [String(value)];
      return value.map((entry) => String(entry));
    },
    validate: (value) =>
      Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length === 16)
        ? null
        : { unresolved: true, message: "must be an array of ids" }
  };
  const levelsArgs = (patchValue, mergedLevels, preLevels) => {
    const row = { id: "wall-1", source: { levels: preLevels }, _source: { levels: preLevels } };
    const rowStore = createStore([row]);
    return {
      ...baseArgs(rowStore),
      documentClass: { schema: { get: (key) => (key === "levels" ? collapsingIdSetField : null) } },
      patches: [{ id: "wall-1", patch: { levels: patchValue } }],
      mergePreview: async () => ({ toObject: () => ({ levels: mergedLevels }) }),
      diff: async () => ({}),
      resolve: () => row
    };
  };

  it("refuses an AMBIGUOUS element patch before mergePreview is even called", async () => {
    const row = { id: "wall-1", source: { c: [0, 0, 1, 1] } };
    const rowStore = createStore([row]);
    const mergePreview = vi.fn(async () => {
      throw createBridgeError(ERROR_CODES.INVALID_PARAMS, "the v13 merge probe complains about [1,2]");
    });
    await expect(
      executeBatchUpdate({
        ...baseArgs(rowStore),
        patches: [{ id: "wall-1", patch: { "==c": [1, 2], c: [1, 2, 3, 4] } }],
        resolve: () => row,
        mergePreview
      })
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_PARAMS,
      details: { index: 0, id: "wall-1", ambiguousRoot: "c", ambiguousKeys: ["==c", "c"] }
    });
    expect(mergePreview).not.toHaveBeenCalled();
  });

  it("refuses an AMBIGUOUS element patch under --dry-run too (one shared prevalidation path)", async () => {
    const row = { id: "wall-1", source: { ds: 0 } };
    const rowStore = createStore([row]);
    await expect(
      executeBatchUpdate({
        ...baseArgs(rowStore),
        dryRun: true,
        patches: [{ id: "wall-1", patch: { ds: 1, "-=ds": null } }],
        resolve: () => row
      })
    ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_PARAMS, details: { ambiguousRoot: "ds" } });
  });

  it("refuses the whole batch when an element's array write COLLAPSES onto the stored value", async () => {
    await expect(executeBatchUpdate(levelsArgs({ nope: 1 }, [], []))).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_PARAMS,
      details: { index: 0, id: "wall-1", field: "levels" }
    });
  });

  it("applies the pre-state rule identically under --dry-run (one shared prevalidation path)", async () => {
    await expect(
      executeBatchUpdate({ ...levelsArgs({ nope: 1 }, [], []), dryRun: true })
    ).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_PARAMS,
      details: { index: 0, id: "wall-1", field: "levels" }
    });
    const preview = await executeBatchUpdate({
      ...levelsArgs([1234567890123456], ["1234567890123456"], []),
      dryRun: true
    });
    expect(preview).toMatchObject({
      dryRun: true,
      outcomes: [{ index: 0, id: "wall-1", status: "unchanged" }]
    });
  });

  it("accepts an element the core CLEANED AND APPLIED, which needs the engine's pre-state", async () => {
    const result = await executeBatchUpdate(levelsArgs([1234567890123456], ["1234567890123456"], []));
    expect(result.outcomes).toEqual([{ index: 0, id: "wall-1", status: "unchanged" }]);
  });

  it("hands `prepare` the resolved document as its third argument, per element", async () => {
    /** @type {Array<{ index: number, sameObject: boolean }>} */
    const seen = [];
    await executeBatchUpdate(
      baseArgs(store, {
        prepare: (patch, index, document) => {
          seen.push({ index, sameObject: document === store.get(index === 0 ? "wall-1" : "wall-2") });
          return { ...patch };
        }
      })
    );
    expect(seen).toEqual([
      { index: 0, sameObject: true },
      { index: 1, sameObject: true }
    ]);
  });

  it("lets a preparation that DEPENDS on the resolved document refuse its element", async () => {
    /** @type {any} */
    let error = null;
    try {
      await executeBatchUpdate(
        baseArgs(store, {
          patches: [{ id: "wall-2", patch: { ds: 1 } }],
          prepare: (patch, index, document) => {
            if (document?.source?.door === 0) {
              throw createBridgeError(ERROR_CODES.INVALID_PARAMS, "the resolved document forbids this patch");
            }
            return { ...patch };
          }
        })
      );
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);

    expect(error?.message).toBe(
      "scene.wall.update-many element 0 (id wall-2): the resolved document forbids this patch. Nothing was written."
    );
    expect(error?.details).toMatchObject({ index: 0, id: "wall-2" });

    expect(store.get("wall-2").source.ds).toBe(0);
  });

  it("classifies a NO-OP element as `unchanged`, does not send it, and still orders by index", async () => {
    const update = vi.fn(baseArgs(store).update);
    const result = await executeBatchUpdate(
      baseArgs(store, {
        update,
        patches: [
          { id: "wall-1", patch: { door: 0 } },
          { id: "wall-2", patch: { ds: 1 } }
        ]
      })
    );
    expect(update.mock.calls[0][0]).toEqual([{ _id: "wall-2", ds: 1 }]);
    expect(result).toEqual({
      complete: true,
      outcomes: [
        { index: 0, id: "wall-1", status: "unchanged" },
        { index: 1, id: "wall-2", status: "updated" }
      ]
    });
  });

  it("names the ELEMENT INDEX and ID whatever prevalidation layer refuses the patch", async () => {
    const validationError = () =>
      Object.assign(new Error("Wall validation errors: doorSound: not a valid choice"), {
        name: "DataModelValidationError"
      });
    /** @type {Array<{label: string, args: Record<string, any>, code: string, details: Record<string, any>}>} */
    const cases = [
      {
        label: "prepare",
        args: {
          prepare: (patch, index) => {
            if (index === 1)
              throw createBridgeError(ERROR_CODES.INVALID_PARAMS, "the family refused this patch");
            return { ...patch };
          }
        },
        code: ERROR_CODES.INVALID_PARAMS,
        details: { index: 1, id: "wall-2" }
      },
      {
        label: "the merge probe",
        args: {
          mergePreview: async (document, patch) => {
            if ("ds" in patch) throw validationError();
            return { toObject: () => ({ ...document.source, ...patch }) };
          }
        },
        code: ERROR_CODES.INVALID_PARAMS,
        details: {
          index: 1,
          id: "wall-2",
          reason: "foundry_validation",
          message: "Wall validation errors: doorSound: not a valid choice"
        }
      },
      {
        label: "the diff probe",
        args: {
          diff: async (_document, patch) => {
            if ("ds" in patch) throw validationError();
            return {};
          }
        },
        code: ERROR_CODES.INVALID_PARAMS,
        details: { index: 1, id: "wall-2", reason: "foundry_validation" }
      },
      {
        label: "a guard that already named its own coordinates",
        args: {
          prepare: (patch, index) => {
            if (index === 1) {
              throw createBridgeError(ERROR_CODES.INVALID_PARAMS, "already addressed", {
                index: 7,
                id: "some-other-id",
                field: "c"
              });
            }
            return { ...patch };
          }
        },
        code: ERROR_CODES.INVALID_PARAMS,
        details: { index: 7, id: "some-other-id", field: "c" }
      }
    ];

    for (const { label, args, code, details } of cases) {
      const update = vi.fn();
      /** @type {any} */
      let caught = null;
      try {
        await executeBatchUpdate(baseArgs(store, { update, ...args }));
      } catch (error) {
        caught = error;
      }
      expect(caught?.code, label).toBe(code);
      expect(caught?.details, label).toMatchObject(details);
      expect(update, label).not.toHaveBeenCalled();
      expect(store.get("wall-1").source, label).toEqual({ door: 0, ds: 0 });
    }
  });

  it("hands every probe its OWN COPY, so a v13 core cannot rewrite the payload Foundry receives", async () => {
    const declared = new Set(["door", "ds", "threshold"]);
    const mutateLikeV13 = (patch) => {
      for (const key of Object.keys(patch)) {
        if (key.includes(".")) {
          const [root, leaf] = key.split(".");
          const value = patch[key];
          delete patch[key];
          patch[root] = { ...(patch[root] ?? {}), [leaf]: value };
        } else if (!declared.has(key)) {
          delete patch[key];
        }
      }
      return patch;
    };
    /** @type {any[]} */
    const probed = [];
    const update = vi.fn(async (entries) => {
      for (const entry of entries) {
        const { _id, ...patch } = entry;

        Object.assign(store.get(_id).source, mutateLikeV13({ ...patch }));
      }

      return [];
    });
    const callerPatches = [
      { id: "wall-1", patch: { someModuleKey: 1, "threshold.light": 12, door: 1 } },
      { id: "wall-2", patch: { onlyAModuleKey: 1 } }
    ];
    const result = await executeBatchUpdate(
      baseArgs(store, {
        update,
        patches: callerPatches,
        prepare: (patch) => ({ ...patch }),
        mergePreview: async (document, patch) => {
          probed.push(patch);
          return { toObject: () => ({ ...document.source, ...mutateLikeV13(patch) }) };
        },
        diff: async (document, patch) => {
          probed.push(patch);
          return Object.fromEntries(
            Object.entries(mutateLikeV13(patch)).filter(
              ([key, value]) => JSON.stringify(document.source[key]) !== JSON.stringify(value)
            )
          );
        }
      })
    );

    expect(update.mock.calls[0][0]).toEqual([
      { _id: "wall-1", someModuleKey: 1, "threshold.light": 12, door: 1 }
    ]);

    expect(result.outcomes).toEqual([
      { index: 0, id: "wall-1", status: "updated" },
      { index: 1, id: "wall-2", status: "unchanged" }
    ]);

    expect(callerPatches[0].patch).toEqual({ someModuleKey: 1, "threshold.light": 12, door: 1 });

    expect(probed).toHaveLength(5);
    expect(new Set(probed).size).toBe(probed.length);
  });

  it("an ALL-unchanged call is a converged SUCCESS: Foundry is never called and complete stays true", async () => {
    const update = vi.fn();
    const result = await executeBatchUpdate(
      baseArgs(store, {
        update,
        patches: [
          { id: "wall-1", patch: { door: 0 } },
          { id: "wall-2", patch: { ds: 0 } }
        ]
      })
    );
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({
      complete: true,
      outcomes: [
        { index: 0, id: "wall-1", status: "unchanged" },
        { index: 1, id: "wall-2", status: "unchanged" }
      ]
    });
  });

  it("credits `updated` from the POST-WRITE diff probe when Foundry returns nothing", async () => {
    const result = await executeBatchUpdate(
      baseArgs(store, {
        update: async (entries) => {
          for (const entry of entries) {
            const { _id, ...patch } = entry;
            Object.assign(store.get(_id).source, patch);
          }
          return [];
        }
      })
    );
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(["updated", "updated"]);
  });

  it("reports `dropped` when the call resolved and stored state does NOT show the patch", async () => {
    const result = await executeBatchUpdate(
      baseArgs(store, {
        update: async (entries) => {
          const { _id, ...patch } = entries[0];
          Object.assign(store.get(_id).source, patch);
          return [store.get(_id)];
        }
      })
    );
    expect(result.complete).toBe(false);
    expect(result.outcomes).toEqual([
      { index: 0, id: "wall-1", status: "updated" },
      { index: 1, id: "wall-2", status: "dropped" }
    ]);
  });

  it("does NOT credit an element Foundry RETURNED whose requested key never landed", async () => {
    const result = await executeBatchUpdate(
      baseArgs(store, {
        patches: [
          { id: "wall-1", patch: { door: 1 } },
          { id: "wall-2", patch: { door: 1, ds: 1 } }
        ],
        update: async (entries) => {
          for (const entry of entries) {
            const row = store.get(entry._id);
            if (row.id === "wall-2") {
              row.source.ds = entry.ds;
              row.source.doorSound = "hookStamped";
              continue;
            }
            const { _id, ...patch } = entry;
            Object.assign(row.source, patch);
          }
          return entries.map((entry) => store.get(entry._id));
        }
      })
    );
    expect(store.get("wall-2").source.door).toBe(0);
    expect(result.complete).toBe(false);

    expect(result.outcomes).toEqual([
      { index: 0, id: "wall-1", status: "updated" },
      { index: 1, id: "wall-2", status: "dropped" }
    ]);
  });

  it("credits an EMBEDDED-COLLECTION CREATE from the resolved array — the one patch a re-probe cannot confirm", async () => {
    const ecfStore = createStore([createRow("region-1", { behaviors: [] })]);
    const documentClass = {
      schema: {
        get: (key) =>
          key === "behaviors"
            ? { getCollection: () => new Map(), schema: { get: () => null }, clean: () => [] }
            : null
      }
    };
    const ecfArgs = (overrides = {}) => ({
      command: "scene.region.update-many",
      patches: [{ id: "region-1", patch: { behaviors: [{ type: "pause" }] } }],
      dryRun: false,
      documentClass,
      resolve: (id) => ecfStore.get(id),
      prepare: (patch) => ({ ...patch }),

      diff: async (document, patch) => ({ ...patch }),
      mergePreview: async (document, patch) => ({
        toObject: () => ({ behaviors: [...document.source.behaviors, ...patch.behaviors] })
      }),
      update: async (entries) => {
        for (const entry of entries) {
          const row = ecfStore.get(entry._id);
          row.source.behaviors = [...row.source.behaviors, { _id: "server-minted-id", type: "pause" }];
        }
        return entries.map((entry) => ecfStore.get(entry._id));
      },
      ...overrides
    });

    const landed = await executeBatchUpdate(ecfArgs());
    expect(ecfStore.get("region-1").source.behaviors).toHaveLength(1);
    expect(landed).toEqual({ complete: true, outcomes: [{ index: 0, id: "region-1", status: "updated" }] });

    ecfStore.get("region-1").source.behaviors = [];
    /** @type {any} */
    let siblingStripped = null;
    const siblingArgs = () =>
      ecfArgs({
        patches: [{ id: "region-1", patch: { name: "Zone A", behaviors: [{ type: "pause" }] } }],
        diff: async (document, patch) => {
          const out = {};

          if (patch.behaviors) out.behaviors = patch.behaviors;
          if ("name" in patch && document.source.name !== patch.name) out.name = patch.name;
          return out;
        },
        update: async (entries) => {
          for (const entry of entries) {
            const row = ecfStore.get(entry._id);

            row.source.behaviors = [...row.source.behaviors, { _id: "server-minted-id", type: "pause" }];
          }
          return entries.map((entry) => ecfStore.get(entry._id));
        }
      });
    try {
      await executeBatchUpdate(siblingArgs());
    } catch (error) {
      siblingStripped = error;
    }
    expect(ecfStore.get("region-1").source.behaviors).toHaveLength(1);

    expect(siblingStripped?.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(siblingStripped?.details.outcomes).toEqual([{ index: 0, id: "region-1", status: "dropped" }]);

    ecfStore.get("region-1").source.behaviors = [];
    /** @type {any} */
    let refused = null;
    try {
      await executeBatchUpdate(ecfArgs({ update: async () => [] }));
    } catch (error) {
      refused = error;
    }
    expect(refused?.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(refused?.details.outcomes).toEqual([{ index: 0, id: "region-1", status: "dropped" }]);
  });

  it("arms the create fallback for a BLANK `_id`, which both cores treat as no id at all", async () => {
    const blankStore = createStore([createRow("region-1", { behaviors: [] })]);
    const result = await executeBatchUpdate({
      command: "scene.region.update-many",
      patches: [{ id: "region-1", patch: { behaviors: [{ _id: "", name: "new", type: "pause" }] } }],
      dryRun: false,
      documentClass: {
        schema: {
          get: (key) =>
            key === "behaviors"
              ? { getCollection: () => new Map(), schema: { get: () => null }, clean: () => [] }
              : null
        }
      },
      resolve: (id) => blankStore.get(id),
      prepare: (patch) => ({ ...patch }),

      diff: async (document, patch) => ({ ...patch }),
      mergePreview: async (document, patch) => ({
        toObject: () => ({
          behaviors: [
            ...document.source.behaviors,
            ...patch.behaviors.map((entry) => ({ ...entry, _id: "merge-preview-id" }))
          ]
        })
      }),
      update: async (entries) => {
        for (const entry of entries) {
          const row = blankStore.get(entry._id);
          row.source.behaviors = [
            ...row.source.behaviors,
            { _id: "server-minted-id", name: "new", type: "pause" }
          ];
        }
        return entries.map((entry) => blankStore.get(entry._id));
      }
    });
    expect(blankStore.get("region-1").source.behaviors).toHaveLength(1);
    expect(result).toEqual({ complete: true, outcomes: [{ index: 0, id: "region-1", status: "updated" }] });
  });

  it("still confirms the `_id`-ADDRESSED entries of a MIXED embedded-collection array in stored state", async () => {
    const B1 = "b1b1b1b1b1b1b1b1";
    const booleanField = { clean: (value) => Boolean(value), validate: () => null };
    const stringField = { clean: (value) => String(value ?? ""), validate: () => null };
    const elementSchema = { get: (key) => ({ disabled: booleanField, type: stringField })[key] ?? null };
    const documentClass = {
      schema: {
        get: (key) =>
          key === "behaviors"
            ? {
                getCollection: () => new Map(),
                schema: elementSchema,
                clean: (value) => (Array.isArray(value) ? value : [])
              }
            : null
      }
    };
    const mixedStore = createStore([
      createRow("region-1", { behaviors: [{ _id: B1, type: "pause", disabled: false }] })
    ]);
    const mixedArgs = (overrides = {}) => ({
      command: "scene.region.update-many",
      patches: [{ id: "region-1", patch: { behaviors: [{ _id: B1, disabled: true }, { type: "pause" }] } }],
      dryRun: false,
      documentClass,
      resolve: (id) => mixedStore.get(id),
      prepare: (patch) => ({ ...patch }),

      diff: async (document, patch) => {
        /** @type {Record<string, any>} */
        const out = {};
        for (const [key, value] of Object.entries(patch)) {
          if (key !== "behaviors") {
            if (document.source[key] !== value) out[key] = value;
            continue;
          }
          const rows = document.source.behaviors ?? [];
          const residual = value.filter((entry) => {
            const id = typeof entry._id === "string" && entry._id.length > 0 ? entry._id : null;
            if (!id) return true;
            const row = rows.find((candidate) => candidate._id === id);
            if (!row) return true;
            return Object.entries(entry).some(
              ([entryKey, entryValue]) => entryKey !== "_id" && row[entryKey] !== entryValue
            );
          });
          if (residual.length > 0) out.behaviors = residual;
        }
        return out;
      },
      mergePreview: async (document, patch) => ({
        toObject: () => {
          const rows = document.source.behaviors.map((row) => ({ ...row }));
          for (const entry of patch.behaviors ?? []) {
            const id = typeof entry._id === "string" && entry._id.length > 0 ? entry._id : null;
            const target = id ? rows.find((row) => row._id === id) : null;
            if (target) {
              for (const [key, value] of Object.entries(entry)) {
                if (key === "_id") continue;
                target[key.startsWith("==") || key.startsWith("-=") ? key.slice(2) : key] = value;
              }
            } else rows.push({ _id: "merge-preview-id", type: "pause", disabled: false, ...entry });
          }
          return { behaviors: rows };
        }
      }),

      update: async (entries) => entries.map((entry) => mixedStore.get(entry._id)),
      ...overrides
    });

    /** @type {any} */
    let addressedDropped = null;
    try {
      await executeBatchUpdate(
        mixedArgs({
          update: async (entries) => {
            for (const entry of entries) {
              const row = mixedStore.get(entry._id);
              row.source.behaviors = [...row.source.behaviors, { _id: "server-minted-id", type: "pause" }];
            }
            return entries.map((entry) => mixedStore.get(entry._id));
          }
        })
      );
    } catch (error) {
      addressedDropped = error;
    }

    expect(mixedStore.get("region-1").source.behaviors).toHaveLength(2);
    expect(mixedStore.get("region-1").source.behaviors[0].disabled).toBe(false);
    expect(addressedDropped?.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(addressedDropped?.details.outcomes).toEqual([{ index: 0, id: "region-1", status: "dropped" }]);

    mixedStore.get("region-1").source.behaviors = [{ _id: B1, type: "pause", disabled: false }];
    const bothLanded = await executeBatchUpdate(
      mixedArgs({
        update: async (entries) => {
          for (const entry of entries) {
            const row = mixedStore.get(entry._id);
            row.source.behaviors = [
              ...row.source.behaviors.map((candidate) =>
                candidate._id === B1 ? { ...candidate, disabled: true } : candidate
              ),
              { _id: "server-minted-id", type: "pause" }
            ];
          }
          return entries.map((entry) => mixedStore.get(entry._id));
        }
      })
    );
    expect(bothLanded).toEqual({
      complete: true,
      outcomes: [{ index: 0, id: "region-1", status: "updated" }]
    });

    mixedStore.get("region-1").source.behaviors = [{ _id: B1, type: "pause", disabled: false }];
    const operatorCredited = await executeBatchUpdate(
      mixedArgs({
        patches: [
          { id: "region-1", patch: { behaviors: [{ _id: B1, "==disabled": true }, { type: "pause" }] } }
        ],
        update: async (entries) => {
          for (const entry of entries) {
            const row = mixedStore.get(entry._id);
            row.source.behaviors = [...row.source.behaviors, { _id: "server-minted-id", type: "pause" }];
          }
          return entries.map((entry) => mixedStore.get(entry._id));
        }
      })
    );
    expect(operatorCredited).toEqual({
      complete: true,
      outcomes: [{ index: 0, id: "region-1", status: "updated" }]
    });
    expect(mixedStore.get("region-1").source.behaviors[0].disabled).toBe(false);
  });

  it("ERRORS (uncached) when every changed element was refused", async () => {
    /** @type {any} */
    let error = null;
    try {
      await executeBatchUpdate(baseArgs(store, { update: async () => [] }));
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(error?.details.outcomes.map((outcome) => outcome.status)).toEqual(["dropped", "dropped"]);
  });

  it("on a THROW: a confirmed element is `updated`, an unconfirmable one is `unknown` (never dropped)", async () => {
    const result = await executeBatchUpdate(
      baseArgs(store, {
        update: async (entries) => {
          const { _id, ...patch } = entries[0];
          Object.assign(store.get(_id).source, patch);
          throw new Error("socket closed mid-batch");
        }
      })
    );
    expect(result.complete).toBe(false);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(["updated", "unknown"]);
    expect(result.failure.message).toBe("socket closed mid-batch");
  });

  it("reports `unknown` — never `dropped` — when the post-write probe cannot answer", async () => {
    let probes = 0;
    const result = await executeBatchUpdate(
      baseArgs(store, {
        diff: async (document, patch) => {
          probes += 1;
          if (probes > 3) throw new Error("probe failed");
          return Object.fromEntries(
            Object.entries(patch).filter(([key, value]) => document.source[key] !== value)
          );
        },
        update: async (entries) => {
          const { _id, ...patch } = entries[0];
          Object.assign(store.get(_id).source, patch);
          return [];
        }
      })
    );
    expect(result.complete).toBe(false);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(["updated", "unknown"]);

    expect(result).not.toHaveProperty("failure");
  });

  it("an all-`unknown` resolved call errors with a message that does NOT claim a confirmed refusal", async () => {
    /** @type {any} */
    let error = null;
    try {
      await executeBatchUpdate(
        baseArgs(store, {
          diff: async (document, patch) => {
            if (document.probed) throw new Error("probe failed");
            document.probed = true;
            return Object.fromEntries(
              Object.entries(patch).filter(([key, value]) => document.source[key] !== value)
            );
          },
          update: async () => []
        })
      );
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(error?.message).toContain("could not establish");
    expect(error?.message).not.toContain("refused every element");
    expect(error?.details.outcomes.map((outcome) => outcome.status)).toEqual(["unknown", "unknown"]);
  });

  it("rejects the WHOLE call for a missing target and writes nothing", async () => {
    const update = vi.fn();
    await expect(
      executeBatchUpdate(
        baseArgs(store, {
          update,
          patches: [
            { id: "wall-1", patch: { door: 1 } },
            { id: "nope", patch: { ds: 1 } }
          ]
        })
      )
    ).rejects.toThrow("missing nope");
    expect(update).not.toHaveBeenCalled();
    expect(store.get("wall-1").source.door).toBe(0);
  });

  it("dry-run previews the would-be status per element and never calls Foundry", async () => {
    const update = vi.fn();
    const result = await executeBatchUpdate(
      baseArgs(store, {
        update,
        dryRun: true,
        patches: [
          { id: "wall-1", patch: { door: 0 } },
          { id: "wall-2", patch: { ds: 1 } }
        ]
      })
    );
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({
      complete: true,
      dryRun: true,
      outcomes: [
        { index: 0, id: "wall-1", status: "unchanged" },
        { index: 1, id: "wall-2", status: "updated" }
      ]
    });
    expect(store.get("wall-2").source.ds).toBe(0);
  });

  it("hands `prepare` the resolved target so a family guard can read it", async () => {
    const prepare = vi.fn((patch, _index, _document) => patch);
    await executeBatchUpdate(baseArgs(store, { prepare }));
    expect(prepare.mock.calls[0][1]).toBe(0);
    expect(prepare.mock.calls[0][2]).toBe(store.get("wall-1"));
  });

  it("reports the all-failed tally per STATUS, because a CONVERGED element can sit beside a refused one", async () => {
    /** @type {any} */
    let error = null;
    try {
      await executeBatchUpdate(
        baseArgs(store, {
          patches: [
            { id: "wall-1", patch: { door: 0 } }, // already 0 → unchanged, never dispatched
            { id: "wall-2", patch: { ds: 1 } }
          ],
          update: async () => []
        })
      );
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(error?.details.outcomes.map((outcome) => outcome.status)).toEqual(["unchanged", "dropped"]);
    expect(error?.message).toContain("refused every element it was sent");
    expect(error?.message).toContain("1 refused, 0 unestablished, 1 already converged");

    expect(error?.message).not.toContain("refused every element (");
  });
});

describe("batch-write engine: update-many confirmation for OPERATOR spellings", () => {
  const bare = (key) => (key.startsWith("==") || key.startsWith("-=") ? key.slice(2) : key);

  function createRow(id, source) {
    return {
      id,
      source: { ...source },
      toObject() {
        return { ...this.source };
      }
    };
  }

  const args = (store, overrides = {}) => ({
    command: "scene.wall.update-many",
    patches: [{ id: "wall-1", patch: { "==c": [5, 6, 7, 8] } }],
    dryRun: false,
    resolve: (id, index) => {
      const row = store.get(id);
      if (!row)
        throw Object.assign(new Error(`missing ${id}`), { code: "WALL_NOT_FOUND", details: { index } });
      return row;
    },
    prepare: (patch) => ({ ...patch }),

    diff: async (document, patch) =>
      Object.fromEntries(
        Object.entries(patch).filter(([key, value]) => key.startsWith("==") || document.source[key] !== value)
      ),
    mergePreview: async (document, patch) => {
      const merged = { ...document.source };
      for (const [key, value] of Object.entries(patch)) merged[bare(key)] = value;
      return { toObject: () => merged };
    },
    update: async (entries) => {
      for (const entry of entries) {
        const { _id, ...patch } = entry;
        const row = store.get(_id);
        for (const [key, value] of Object.entries(patch)) row.source[bare(key)] = value;
      }

      return [];
    },
    ...overrides
  });

  let store;
  beforeEach(() => {
    store = createRow("wall-1", { c: [0, 0, 1, 1] });
    store = createStore([store]);
  });

  it("credits a LANDED `==` element the diff probe can never confirm", async () => {
    const result = await executeBatchUpdate(args(store));
    expect(store.get("wall-1").source.c).toEqual([5, 6, 7, 8]);
    expect(result).toEqual({
      complete: true,
      outcomes: [{ index: 0, id: "wall-1", status: "updated" }]
    });
  });

  it("confirms an embedded-collection element by comparing the by-_id MERGED preview against stored state", async () => {
    const B1 = "b1b1b1b1b1b1b1b1";
    const B2 = "b2b2b2b2b2b2b2b2";
    const behaviors = () => [
      { _id: B1, name: "one", disabled: false },
      { _id: B2, name: "two", disabled: false }
    ];
    const row = {
      id: "region-1",
      source: { behaviors: behaviors() },
      toObject() {
        return structuredClone(this.source);
      }
    };
    const regionStore = createStore([row]);

    const mergePreview = async (document, patch) => {
      const merged = structuredClone(document.source);
      for (const entry of patch["==behaviors"] ?? patch.behaviors ?? []) {
        const target = merged.behaviors.find((candidate) => candidate._id === entry._id);
        if (target) Object.assign(target, entry);
      }
      return { toObject: () => merged };
    };

    const base = {
      command: "scene.region.update-many",
      patches: [{ id: "region-1", patch: { "==behaviors": [{ _id: B1, disabled: true }] } }],
      dryRun: false,
      resolve: (id) => regionStore.get(id),
      prepare: (patch) => ({ ...patch }),

      diff: async (_document, patch) => ({ ...patch }),
      mergePreview,

      documentClass: {}
    };

    const landed = await executeBatchUpdate({
      ...base,
      update: async (entries) => {
        for (const entry of entries) {
          const target = regionStore
            .get(entry._id)
            .source.behaviors.find((candidate) => candidate._id === B1);
          Object.assign(target, { disabled: true });
        }
        return [];
      }
    });
    expect(landed).toEqual({ complete: true, outcomes: [{ index: 0, id: "region-1", status: "updated" }] });

    row.source.behaviors = behaviors();
    /** @type {any} */
    let error = null;
    try {
      await executeBatchUpdate({ ...base, update: async () => [] });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(error?.details?.outcomes).toEqual([{ index: 0, id: "region-1", status: "dropped" }]);
  });

  it("returns the cacheable ok BODY for a landed `==` element whose batch then THREW", async () => {
    const result = await executeBatchUpdate(
      args(store, {
        update: async (entries) => {
          for (const entry of entries) {
            const { _id, ...patch } = entry;
            for (const [key, value] of Object.entries(patch)) store.get(_id).source[bare(key)] = value;
          }
          throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, "socket closed after the server wrote");
        }
      })
    );
    expect(store.get("wall-1").source.c).toEqual([5, 6, 7, 8]);
    expect(result.outcomes).toEqual([{ index: 0, id: "wall-1", status: "updated" }]);

    expect(result.complete).toBe(true);
    expect(result.failure.code).toBe(ERROR_CODES.INTERNAL_ERROR);
  });

  it("still reports a REFUSED `==` element as `dropped`, so the comparison is not a blanket credit", async () => {
    /** @type {any} */
    let error = null;
    try {
      await executeBatchUpdate(args(store, { update: async () => [] }));
    } catch (thrown) {
      error = thrown;
    }
    expect(store.get("wall-1").source.c).toEqual([0, 0, 1, 1]);
    expect(error?.details.outcomes).toEqual([{ index: 0, id: "wall-1", status: "dropped" }]);
    expect(error?.message).toContain("refused every element it was sent");
  });

  it("reports `unknown`, never `dropped`, when the comparison itself cannot be made", async () => {
    const opaque = createStore([{ id: "wall-1", source: { c: [0, 0, 1, 1] } }]);
    /** @type {any} */
    let error = null;
    try {
      await executeBatchUpdate(args(opaque, { update: async () => [] }));
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.details.outcomes).toEqual([{ index: 0, id: "wall-1", status: "unknown" }]);
    expect(error?.message).toContain("could not establish");
  });

  it("leaves a PLAIN-key element on the diff probe alone (the comparison is opt-in per patch)", () => {
    expect(batchMergedConfirmationKeys({ door: 1, "threshold.light": 12 })).toEqual([]);
    expect(batchMergedConfirmationKeys({})).toEqual([]);
    expect(batchMergedConfirmationKeys(/** @type {any} */ (null))).toEqual([]);

    expect(batchMergedConfirmationKeys({ "==c": [1, 2, 3, 4], ds: 1 })).toEqual(["c", "ds"]);
    expect(batchMergedConfirmationKeys({ "-=flags": null, "flags.mod.x": 1 })).toEqual(["flags"]);
  });

  it("arms the comparison for an operator spelled on an INNER segment, which v13's diff also never confirms", () => {
    expect(batchMergedConfirmationKeys({ "threshold.==light": 7 })).toEqual(["threshold"]);
    expect(batchMergedConfirmationKeys({ "threshold.==light": 7, ds: 0 })).toEqual(["threshold", "ds"]);
    expect(batchMergedConfirmationKeys({ "flags.core.-=a": null, ds: 1 })).toEqual(["flags", "ds"]);

    expect(batchMergedConfirmationKeys({ "==threshold.==light": 7 })).toEqual(["threshold"]);
  });

  describe("an INNER-segment operator element, judged end to end", () => {
    const nestedArgs = (row, overrides = {}) => ({
      command: "scene.wall.update-many",
      patches: [{ id: "wall-1", patch: { "threshold.==light": 7 } }],
      dryRun: false,
      resolve: (id) => (row.id === id ? row : null),
      prepare: (patch) => ({ ...patch }),

      diff: async (_document, patch) => ({ threshold: { "==light": patch["threshold.==light"] } }),

      mergePreview: async (document) => {
        const merged = structuredClone(document.source);
        merged.threshold.light = 7;
        return { toObject: () => merged };
      },
      documentClass: {},

      update: async () => [],
      ...overrides
    });
    const nestedRow = () => ({
      id: "wall-1",
      source: { threshold: { light: 5, sight: 5, sound: 5, attenuation: false } },
      toObject() {
        return structuredClone(this.source);
      }
    });

    it("returns the cacheable ok BODY when the write LANDED and the batch then THREW", async () => {
      const row = nestedRow();
      const result = await executeBatchUpdate(
        nestedArgs(row, {
          update: async () => {
            row.source.threshold.light = 7;
            throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, "socket closed after the server wrote");
          }
        })
      );
      expect(row.source.threshold).toEqual({ light: 7, sight: 5, sound: 5, attenuation: false });
      expect(result.outcomes).toEqual([{ index: 0, id: "wall-1", status: "updated" }]);
      expect(result.complete).toBe(true);
      expect(result.failure.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    });

    it("still reports a REFUSED element as `dropped`, so arming the comparison is not a blanket credit", async () => {
      const row = nestedRow();
      /** @type {any} */
      let error = null;
      try {
        await executeBatchUpdate(nestedArgs(row, { update: async () => [] }));
      } catch (thrown) {
        error = thrown;
      }
      expect(row.source.threshold.light).toBe(5);
      expect(error?.details.outcomes).toEqual([{ index: 0, id: "wall-1", status: "dropped" }]);
    });
  });
});

describe("batch-write engine: the per-element SUMMARY seam", () => {
  const createArgs = (store, overrides = {}) => ({
    command: "scene.token.create-many",
    items: [{ name: "Alpha" }, { name: "Beta" }],
    dryRun: false,
    prepare: (data) => ({ ...data }),
    preview: () => ({}),
    isIdTaken: (id) => store.has(id),
    create: async (payloads) => {
      const created = payloads.map((payload) => ({ id: payload._id, ...payload }));
      for (const row of created) store.set(row);
      return created;
    },
    readBack: (id) => store.get(id),
    summarize: (document) => ({ name: document ? document.name : null }),
    ...overrides
  });

  it("summarizes a CREATED element from the document it read back", async () => {
    const result = await executeBatchCreate(createArgs(createStore()));
    expect(result.outcomes).toEqual([
      { index: 0, id: "batchid00000000", status: "created", name: "Alpha" },
      { index: 1, id: "batchid00000001", status: "created", name: "Beta" }
    ]);
  });

  it("still summarizes a DROPPED element, with `null` — there is no document to read", async () => {
    const store = createStore();
    const result = await executeBatchCreate(
      createArgs(store, {
        create: async (payloads) => {
          const first = { id: payloads[0]._id, ...payloads[0] };
          store.set(first);
          return [first];
        }
      })
    );
    expect(result.complete).toBe(false);
    expect(result.outcomes).toEqual([
      { index: 0, id: "batchid00000000", status: "created", name: "Alpha" },
      { index: 1, id: "batchid00000001", status: "dropped", name: null }
    ]);
  });

  it("still summarizes an UNKNOWN element, with `null`", async () => {
    const store = createStore();
    const result = await executeBatchCreate(
      createArgs(store, {
        create: async (payloads) => {
          const first = { id: payloads[0]._id, ...payloads[0] };
          store.set(first);
          throw new Error("socket closed");
        }
      })
    );
    expect(result.outcomes).toEqual([
      { index: 0, id: "batchid00000000", status: "created", name: "Alpha" },
      { index: 1, id: "batchid00000001", status: "unknown", name: null }
    ]);
  });

  it("summarizes a CREATE dry run with `null`, exactly as it reports `id: null`", async () => {
    const summarize = vi.fn((document) => ({ name: document ? document.name : null }));
    const result = await executeBatchCreate(createArgs(createStore(), { dryRun: true, summarize }));
    expect(result.outcomes).toEqual([
      { index: 0, id: null, status: "created", name: null },
      { index: 1, id: null, status: "created", name: null }
    ]);

    expect(summarize).toHaveBeenCalledTimes(2);
    expect(summarize.mock.calls.map((call) => call[0])).toEqual([null, null]);
  });

  it("omits the summary keys ENTIRELY for a family that passes no seam", async () => {
    const result = await executeBatchCreate(createArgs(createStore(), { summarize: undefined }));
    expect(result.outcomes).toEqual([
      { index: 0, id: "batchid00000000", status: "created" },
      { index: 1, id: "batchid00000001", status: "created" }
    ]);
    expect(Object.keys(result.outcomes[0])).toEqual(["index", "id", "status"]);
  });

  describe("update-many", () => {
    const row = (id, name) => ({ id, name, source: { name } });
    const updateArgs = (store, overrides = {}) => ({
      command: "scene.token.update-many",
      patches: [
        { id: "token-1", patch: { name: "Renamed" } },
        { id: "token-2", patch: { name: "Unmoved" } }
      ],
      dryRun: false,
      resolve: (id) => store.get(id),
      prepare: (patch) => ({ ...patch }),
      diff: async (document, patch) =>
        Object.fromEntries(Object.entries(patch).filter(([key, value]) => document.source[key] !== value)),
      mergePreview: async (document, patch) => ({ toObject: () => ({ ...document.source, ...patch }) }),
      update: async (entries) => {
        const updated = [];
        for (const entry of entries) {
          const { _id, ...patch } = entry;
          const target = store.get(_id);
          Object.assign(target.source, patch);
          target.name = target.source.name;
          updated.push(target);
        }
        return updated;
      },
      summarize: (document) => ({ name: document ? document.name : null }),
      ...overrides
    });

    it("summarizes UPDATED from the post-write document and UNCHANGED from the untouched one", async () => {
      const store = createStore([row("token-1", "Before"), row("token-2", "Unmoved")]);
      const result = await executeBatchUpdate(updateArgs(store));
      expect(result.outcomes).toEqual([
        { index: 0, id: "token-1", status: "updated", name: "Renamed" },
        { index: 1, id: "token-2", status: "unchanged", name: "Unmoved" }
      ]);
    });

    it("summarizes a DROPPED element from the document as it STANDS — the patch did not land", async () => {
      const store = createStore([
        row("token-1", "Before"),
        row("token-2", "Unmoved"),
        row("token-3", "Third")
      ]);
      const applyOnly = (id) => async (entries) => {
        const updated = [];
        for (const entry of entries) {
          if (entry._id !== id) continue;
          const { _id, ...patch } = entry;
          const target = store.get(_id);
          Object.assign(target.source, patch);
          target.name = target.source.name;
          updated.push(target);
        }
        return updated;
      };
      const result = await executeBatchUpdate(
        updateArgs(store, {
          patches: [
            { id: "token-1", patch: { name: "Renamed" } },
            { id: "token-2", patch: { name: "Unmoved" } },
            { id: "token-3", patch: { name: "Refused" } }
          ],

          update: applyOnly("token-1")
        })
      );
      expect(result.complete).toBe(false);
      expect(result.outcomes).toEqual([
        { index: 0, id: "token-1", status: "updated", name: "Renamed" },
        { index: 1, id: "token-2", status: "unchanged", name: "Unmoved" },
        { index: 2, id: "token-3", status: "dropped", name: "Third" }
      ]);
    });

    it("summarizes an UPDATE dry run from the CURRENT stored state, patching nothing", async () => {
      const store = createStore([row("token-1", "Before"), row("token-2", "Unmoved")]);
      const result = await executeBatchUpdate(updateArgs(store, { dryRun: true }));
      expect(result.outcomes).toEqual([
        { index: 0, id: "token-1", status: "updated", name: "Before" },
        { index: 1, id: "token-2", status: "unchanged", name: "Unmoved" }
      ]);
      expect(store.get("token-1").name).toBe("Before");
    });
  });
});

describe("batch-write engine: delete-many", () => {
  const baseArgs = (store, overrides = {}) => ({
    command: "scene.wall.delete-many",
    ids: ["wall-1", "wall-2"],
    dryRun: false,
    resolve: (id) => store.get(id),
    remove: async (ids) => {
      for (const id of ids) store.delete(id);
    },
    exists: (id) => store.has(id),
    ...overrides
  });

  let store;
  beforeEach(() => {
    store = createStore([{ id: "wall-1" }, { id: "wall-2" }]);
  });

  it("deletes every id and confirms each by its ABSENCE from stored state", async () => {
    const result = await executeBatchDelete(baseArgs(store));
    expect(result).toEqual({
      complete: true,
      outcomes: [
        { index: 0, id: "wall-1", status: "deleted" },
        { index: 1, id: "wall-2", status: "deleted" }
      ]
    });
    expect(store.byId.size).toBe(0);
  });

  it("reports a missing target as `alreadyDeleted` and EXCLUDES it from the Foundry call", async () => {
    const remove = vi.fn(baseArgs(store).remove);
    const result = await executeBatchDelete(baseArgs(store, { remove, ids: ["wall-1", "gone", "wall-2"] }));
    expect(remove.mock.calls[0][0]).toEqual(["wall-1", "wall-2"]);
    expect(result).toEqual({
      complete: true,
      outcomes: [
        { index: 0, id: "wall-1", status: "deleted" },
        { index: 1, id: "gone", status: "alreadyDeleted" },
        { index: 2, id: "wall-2", status: "deleted" }
      ]
    });
  });

  it("an ALL-alreadyDeleted call converges: Foundry is never called, complete stays true", async () => {
    const remove = vi.fn();
    const result = await executeBatchDelete(baseArgs(store, { remove, ids: ["gone-1", "gone-2"] }));
    expect(remove).not.toHaveBeenCalled();
    expect(result.complete).toBe(true);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(["alreadyDeleted", "alreadyDeleted"]);
  });

  it("reports `dropped` for a row still present after a resolved call", async () => {
    const result = await executeBatchDelete(
      baseArgs(store, {
        remove: async (ids) => {
          store.delete(ids[0]);
        }
      })
    );
    expect(result.complete).toBe(false);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(["deleted", "dropped"]);
  });

  it("ERRORS (uncached) when a resolved call deleted nothing", async () => {
    /** @type {any} */
    let error = null;
    try {
      await executeBatchDelete(baseArgs(store, { remove: async () => {} }));
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INTERNAL_ERROR);
  });

  it("on a THROW: an absent row is `deleted`, a surviving row is `unknown`", async () => {
    const result = await executeBatchDelete(
      baseArgs(store, {
        remove: async (ids) => {
          store.delete(ids[0]);
          throw new Error("socket closed mid-batch");
        }
      })
    );
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(["deleted", "unknown"]);
    expect(result.failure.message).toBe("socket closed mid-batch");
  });

  it("runs a per-element delete guard before writing anything", async () => {
    const remove = vi.fn();
    await expect(
      executeBatchDelete(
        baseArgs(store, {
          remove,
          assertDeletable: (_document, index) => {
            if (index === 1)
              throw Object.assign(new Error("guarded"), { code: ERROR_CODES.DELETE_FORBIDDEN });
          }
        })
      )
    ).rejects.toThrow("guarded");
    expect(remove).not.toHaveBeenCalled();
    expect(store.byId.size).toBe(2);
  });

  it("addresses a delete guard's refusal in the MESSAGE, id included", async () => {
    const remove = vi.fn();
    /** @type {any} */
    let error = null;
    try {
      await executeBatchDelete(
        baseArgs(store, {
          remove,
          assertDeletable: (_document, index) => {
            if (index === 1) {
              throw createBridgeError(ERROR_CODES.DELETE_FORBIDDEN, "this document is referenced elsewhere", {
                referenced: true
              });
            }
          }
        })
      );
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.DELETE_FORBIDDEN);
    expect(error?.message).toBe(
      "scene.wall.delete-many element 1 (id wall-2): this document is referenced elsewhere. Nothing was written."
    );
    expect(error?.details).toMatchObject({ index: 1, id: "wall-2", referenced: true });
    expect(remove).not.toHaveBeenCalled();
    expect(store.byId.size).toBe(2);
  });

  it("dry-run previews the would-be statuses and never calls Foundry", async () => {
    const remove = vi.fn();
    const result = await executeBatchDelete(
      baseArgs(store, { remove, ids: ["wall-1", "gone"], dryRun: true })
    );
    expect(remove).not.toHaveBeenCalled();
    expect(result).toEqual({
      complete: true,
      dryRun: true,
      outcomes: [
        { index: 0, id: "wall-1", status: "deleted" },
        { index: 1, id: "gone", status: "alreadyDeleted" }
      ]
    });
    expect(store.byId.size).toBe(2);
  });
});

describe("batch-write: the silently-discarded ARRAY guard", () => {
  const wallSchema = {
    get: (key) => (key === "c" ? { clean: (value) => value } : null)
  };
  const documentClass = { schema: wallSchema };

  const guard = (patch, storedC) =>
    assertBatchArrayWritesReflected({
      documentClass,
      patch,
      merged: { toObject: () => ({ c: storedC, door: 1 }) },
      index: 3,
      command: "scene.wall.update-many",
      id: "wall-7"
    });

  it("refuses an array write the merged document did not take", () => {
    /** @type {any} */
    let error = null;
    try {
      guard({ c: [1, 2] }, [0, 0, 100, 100]);
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain("element 3 (id wall-7)");
    expect(error?.message).toContain("SILENTLY DISCARDS");
    expect(error?.details).toEqual({
      index: 3,
      id: "wall-7",
      field: "c",
      arrayField: "c",
      requested: [1, 2],
      stored: [0, 0, 100, 100]
    });
  });

  it("refuses it even when the diff is NON-empty because a sibling field landed", () => {
    expect(() => guard({ ds: 1, c: [1, 2] }, [0, 0, 100, 100])).toThrow(/SILENTLY DISCARDS/);
  });

  it("allows a genuine no-op array (the requested value IS the stored value)", () => {
    expect(() => guard({ c: [0, 0, 100, 100] }, [0, 0, 100, 100])).not.toThrow();
  });

  it("allows an array write the merged document DID take", () => {
    expect(() => guard({ c: [5, 5, 6, 6] }, [5, 5, 6, 6])).not.toThrow();
  });

  it("skips a field the schema does not declare (an open-passthrough family may carry unknown fields)", () => {
    expect(() => guard({ unknownArrayField: [1, 2, 3] }, [0, 0, 100, 100])).not.toThrow();
  });

  it("skips a field whose clean() does not return an array (a scalar field handed an array)", () => {
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: { schema: { get: () => ({ clean: (value) => String(value) }) } },
        patch: { animation: ["a", "b"] },
        merged: { toObject: () => ({ animation: "a,b" }) },
        index: 0,
        command: "scene.wall.update-many",
        id: "wall-1"
      })
    ).not.toThrow();
  });

  const setField = {
    clean: (value) => [...new Set(value.map((entry) => String(entry)))]
  };

  it("JUDGES a SetField-backed write and allows the one the merged document took", () => {
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: { schema: { get: () => setField } },
        patch: { levels: ["aaaaaaaaaaaaaaaa"] },
        merged: { toObject: () => ({ levels: ["aaaaaaaaaaaaaaaa"] }) },
        index: 0,
        command: "scene.wall.update-many",
        id: "wall-1"
      })
    ).not.toThrow();
  });

  it("REFUSES a SetField-backed write the merged document discarded", () => {
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: { schema: { get: () => setField } },
        patch: { levels: ["aaaaaaaaaaaaaaaa"] },
        merged: { toObject: () => ({ levels: [] }) },
        index: 0,
        command: "scene.wall.update-many",
        id: "wall-1"
      })
    ).toThrow(/SILENTLY DISCARDS/);
  });

  const idSetField = {
    clean: (value) => {
      if (value === null || value === undefined) return [];
      if (!Array.isArray(value)) return typeof value === "object" ? [] : [String(value)];
      return [
        ...new Set(
          value.map((entry) => (entry && typeof entry === "object" ? "[object Object]" : String(entry)))
        )
      ];
    },
    validate: (value) =>
      Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length === 16)
        ? null
        : { unresolved: true, message: "must be an array of ids" }
  };
  const levelsGuard = (patch, mergedLevels, preLevels) =>
    assertBatchArrayWritesReflected({
      documentClass: { schema: { get: (key) => (key === "levels" ? idSetField : null) } },
      patch,
      merged: { toObject: () => ({ levels: mergedLevels }) },
      stored: { toObject: () => ({ levels: preLevels }) },
      index: 1,
      command: "scene.wall.update-many",
      id: "wall-5"
    });

  it("REFUSES a value whose clean() COLLAPSES onto the stored value (the v14 silent drop)", () => {
    /** @type {any} */
    let error = null;
    try {
      levelsGuard({ levels: { nope: 1 } }, [], []);
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain("SILENTLY DISCARDS");
    expect(error?.message).toContain("COLLAPSES");
    expect(error?.details).toEqual({
      index: 1,
      id: "wall-5",
      field: "levels",
      arrayField: "levels",
      requested: { nope: 1 },
      stored: []
    });

    expect(() => levelsGuard({ levels: null }, [], [])).toThrow(/COLLAPSES/);
    expect(() => levelsGuard({ levels: [{ nope: 1 }] }, [], [])).toThrow(/SILENTLY DISCARDS/);
  });

  it("does NOT refuse a value the core CLEANED AND APPLIED (the over-refusal a bare validate rule would cause)", () => {
    expect(() => levelsGuard({ levels: [1234567890123456] }, ["1234567890123456"], [])).not.toThrow();

    expect(() => levelsGuard({ levels: "aaaaaaaaaaaaaaaa" }, ["aaaaaaaaaaaaaaaa"], [])).not.toThrow();
  });

  it("CREDITS the destructive clear of a non-empty set (v14 `levels`), which is disclosed, not guarded", () => {
    expect(() => levelsGuard({ levels: null }, [], ["defaultLevel0000"])).not.toThrow();
    expect(() => levelsGuard({ levels: { nope: 1 } }, [], ["defaultLevel0000"])).not.toThrow();

    expect(() => levelsGuard({ levels: null }, [], [])).toThrow(/COLLAPSES/);
  });

  it("allows a validator-clean write and needs no pre-state for it", () => {
    expect(() => levelsGuard({ levels: ["aaaaaaaaaaaaaaaa"] }, ["aaaaaaaaaaaaaaaa"], [])).not.toThrow();
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: { schema: { get: () => idSetField } },
        patch: { levels: ["aaaaaaaaaaaaaaaa"] },
        merged: { toObject: () => ({ levels: ["aaaaaaaaaaaaaaaa"] }) },
        index: 0,
        command: "scene.wall.update-many",
        id: "wall-1"
      })
    ).not.toThrow();
  });

  it("REFUSES rather than allows when the pre-state is unreadable (the blind spot must not come back)", () => {
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: { schema: { get: () => idSetField } },
        patch: { levels: { nope: 1 } },
        merged: { toObject: () => ({ levels: [] }) },
        stored: {},
        index: 0,
        command: "scene.wall.update-many",
        id: "wall-1"
      })
    ).toThrow(/COLLAPSES/);

    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: { schema: { get: () => idSetField } },
        patch: { levels: { nope: 1 } },
        merged: { toObject: () => ({ levels: [] }) },
        index: 0,
        command: "scene.wall.update-many",
        id: "wall-1"
      })
    ).toThrow(/COLLAPSES/);
  });

  const v14EffectClass = {
    schema: {
      get: (key) =>
        key === "system"
          ? { clean: (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {}) }
          : null
    },
    migrateData(source) {
      const migrated = { ...source };
      if (Array.isArray(migrated.changes)) {
        migrated.system = {
          ...(migrated.system ?? {}),

          changes: migrated.changes.map((change) => ({
            key: change.key,
            type: change.type ?? "add",
            value: change.value
          }))
        };
        delete migrated.changes;
      }
      return migrated;
    }
  };

  const v14ChangesField = {
    clean: (entries) =>
      (Array.isArray(entries) ? entries : []).map((entry) => ({
        key: entry?.key ?? "",
        type: entry?.type === "" || entry?.type === undefined ? "add" : entry.type,
        value: entry?.value ?? "",
        phase: entry?.phase ?? "initial"
      }))
  };
  const v14EffectSystem = { schema: { get: (key) => (key === "changes" ? v14ChangesField : null) } };

  const mergedWith = (changes) => ({
    system: v14EffectSystem,
    toObject: () => ({ system: { changes }, disabled: false })
  });
  const v14EffectMerged = mergedWith([{ key: "system.a", type: "add", value: "1", phase: "initial" }]);
  const shimGuard = (patch, merged = v14EffectMerged) =>
    assertBatchArrayWritesReflected({
      documentClass: v14EffectClass,
      patch,
      merged,
      stored: v14EffectMerged,
      index: 2,
      command: "actor.effect.update-many",
      id: "effect-1"
    });

  const shimGuardEmptyStored = (patch, merged) =>
    assertBatchArrayWritesReflected({
      documentClass: v14EffectClass,
      patch,
      merged,
      stored: mergedWith([]),
      index: 2,
      command: "actor.effect.update-many",
      id: "effect-1"
    });

  it("REFUSES only the SPELLINGS the v14 `changes` migration never sees", () => {
    /** @type {any} */
    let error = null;
    try {
      shimGuard({ changes: "nope" });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain('has MOVED to "system.changes"');
    expect(error?.message).toContain("SILENTLY DISCARDED");
    expect(error?.message).toContain("migrates the field only when the value is an ARRAY");
    expect(error?.details).toMatchObject({
      index: 2,
      id: "effect-1",
      field: "changes",
      arrayField: "changes",
      movedTo: "system.changes"
    });

    for (const patch of [{ changes: { nope: 1 } }, { changes: 5 }, { changes: null }]) {
      expect(() => shimGuard(patch)).toThrow(/migrates the field only when the value is an ARRAY/);
    }
    expect(() => shimGuard({ "changes.0.value": "9" })).toThrow(/dotted path into the field is not migrated/);
    expect(() => shimGuard({ "==changes": [{ key: "a", value: "1" }] })).toThrow(
      /legacy "==" operator key is not migrated/
    );
    expect(() => shimGuard({ "-=changes": null })).toThrow(/legacy "-=" operator key is not migrated/);
  });

  it("does NOT refuse the mainstream migrated write, in any of its three landing shapes", () => {
    expect(() =>
      shimGuard(
        { changes: [{ key: "system.b", mode: 2, value: "5" }] },
        mergedWith([{ key: "system.b", type: "add", value: "5", phase: "initial" }])
      )
    ).not.toThrow();
    expect(() =>
      shimGuard(
        { changes: [{ key: "system.a", value: "1" }] },
        mergedWith([{ key: "system.a", type: "add", value: "1", phase: "initial" }])
      )
    ).not.toThrow();
    expect(() => shimGuard({ changes: [] }, mergedWith([]))).not.toThrow();
  });

  it("REFUSES a migrated array whose ENTRIES this core rejects, and only when nothing moved", () => {
    const malformed = { changes: [{ key: "system.a", type: "my-module.bonus", value: 2 }] };
    /** @type {any} */
    let error = null;
    try {
      shimGuard(malformed);
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain('has MOVED to "system.changes"');
    expect(error?.message).toContain("does NOT accept");
    expect(error?.message).toContain("SILENTLY DISCARDS");

    expect(error?.message).toContain("dot-delimited alphanumeric");
    expect(error?.details).toMatchObject({
      index: 2,
      id: "effect-1",
      field: "changes",
      arrayField: "changes",
      movedTo: "system.changes"
    });

    expect(error?.details?.requested).toEqual([{ key: "system.a", type: "my-module.bonus", value: 2 }]);
    expect(error?.details?.stored).toEqual([{ key: "system.a", type: "add", value: "1", phase: "initial" }]);

    for (const patch of [
      { changes: [{ key: "system.a", type: "or", value: 2 }] },
      { changes: [{ key: "system.a", type: "my_module.bonus", value: 2 }] },
      {
        changes: [
          { key: "system.a", type: "add", value: 3 },
          { key: "system.a", type: "my-module.bonus", value: 2 }
        ]
      }
    ]) {
      expect(() => shimGuard(patch), JSON.stringify(patch)).toThrow(/does NOT accept/);
    }

    expect(() =>
      shimGuard(
        malformed,
        mergedWith([{ key: "system.a", type: "my-module.bonus", value: 2, phase: "afterDerived" }])
      )
    ).not.toThrow();

    expect(() =>
      shimGuard(
        { changes: [{ key: "system.b", mode: 2, value: "5" }] },
        mergedWith([{ key: "system.b", type: "add", value: 5, phase: "initial" }])
      )
    ).not.toThrow();

    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: v14EffectClass,
        patch: malformed,
        merged: v14EffectMerged,
        index: 2,
        command: "actor.effect.update-many",
        id: "effect-1"
      })
    ).toThrow(/does NOT accept/);

    const rawMerged = {
      toObject: () => ({ system: { changes: [{ key: "system.a", type: "my-module.bonus", value: 2 }] } })
    };
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: v14EffectClass,
        patch: malformed,
        merged: rawMerged,
        stored: rawMerged,
        index: 2,
        command: "actor.effect.update-many",
        id: "effect-1"
      })
    ).not.toThrow();
  });

  it("does NOT refuse an ordinary undeclared key, nor one the class does not migrate", () => {
    expect(() => shimGuard({ someModuleKey: [1, 2, 3] })).not.toThrow();
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: v14EffectClass,
        patch: { scalarish: 5 },
        merged: { toObject: () => ({ system: { scalarish: 5 } }) },
        index: 0,
        command: "actor.effect.update-many",
        id: "effect-1"
      })
    ).not.toThrow();

    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: { schema: { get: () => null } },
        patch: { changes: "nope" },
        merged: { toObject: () => ({ door: 1 }) },
        index: 0,
        command: "scene.wall.update-many",
        id: "wall-1"
      })
    ).not.toThrow();
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: {
          schema: { get: () => null },
          migrateData() {
            throw new Error("boom");
          }
        },
        patch: { changes: "nope" },
        merged: { toObject: () => ({ door: 1 }) },
        index: 0,
        command: "scene.wall.update-many",
        id: "wall-1"
      })
    ).not.toThrow();
  });

  it("leaves a version that DOES declare the field alone (v13 has no migration to report)", () => {
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: { schema: { get: (key) => (key === "changes" ? { clean: (value) => value } : null) } },
        patch: { changes: [{ key: "system.a", value: "9" }] },
        merged: { toObject: () => ({ changes: [{ key: "system.a", value: "9" }], system: { changes: [] } }) },
        index: 0,
        command: "actor.effect.update-many",
        id: "effect-1"
      })
    ).not.toThrow();
  });

  it("judges the migration TARGET spelled directly, in both of its spellings", () => {
    const malformed = [{ key: "system.a", type: "my-module.bonus", value: 2 }];
    /** @type {any} */
    let error = null;
    try {
      shimGuard({ "system.changes": malformed });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain('sets "system.changes" to a value that field does NOT accept');
    expect(error?.message).toContain("SILENTLY DISCARDS");
    expect(error?.message).toContain("dot-delimited alphanumeric");

    expect(error?.message).not.toContain("has MOVED to");
    expect(error?.details).toMatchObject({
      index: 2,
      id: "effect-1",
      field: "system.changes",
      arrayField: "changes",
      movedTo: "system.changes"
    });
    expect(error?.details?.requested).toEqual(malformed);
    expect(error?.details?.stored).toEqual([{ key: "system.a", type: "add", value: "1", phase: "initial" }]);

    /** @type {any} */
    let nestedError = null;
    try {
      shimGuard({ system: { changes: malformed } });
    } catch (thrown) {
      nestedError = thrown;
    }
    expect(nestedError?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(nestedError?.message).toContain('sets "system.changes" (through "system")');
    expect(nestedError?.details).toMatchObject({
      field: "system",
      arrayField: "changes",
      movedTo: "system.changes"
    });

    expect(() =>
      shimGuard({ "system.changes": [{ key: "system.a", type: "add", value: 3 }, ...malformed] })
    ).toThrow(/does NOT accept/);

    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: v14EffectClass,
        patch: { "system.changes": malformed },
        merged: v14EffectMerged,
        index: 2,
        command: "actor.effect.update-many",
        id: "effect-1"
      })
    ).toThrow(/does NOT accept/);
  });

  it("refuses a DEEPER path into the migration target that the merge silently discarded", () => {
    /** @type {any} */
    let error = null;
    try {
      shimGuard({ "system.changes.0.type": "my-module.bonus" });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain(
      'writes "system.changes.0.type" INSIDE the array field "system.changes"'
    );
    expect(error?.message).toContain("SILENTLY DISCARDS the whole write");
    expect(error?.message).toContain('Send the WHOLE array at "system.changes"');
    expect(error?.details).toMatchObject({
      index: 2,
      id: "effect-1",
      field: "system.changes.0.type",
      arrayField: "changes",
      movedTo: "system.changes",
      path: "system.changes.0.type",
      requested: "my-module.bonus",
      stored: "add"
    });

    expect(() =>
      shimGuard({ "system.changes.0": { key: "system.a", type: "my-module.bonus", value: 4 } })
    ).toThrow(/SILENTLY DISCARDS the whole write/);
    expect(() => shimGuard({ "system.changes.1.type": "my-module.bonus" })).toThrow(
      /SILENTLY DISCARDS the whole write/
    );

    /** @type {any} */
    let nestedError = null;
    try {
      shimGuard({ system: { "changes.0.type": "my-module.bonus" } });
    } catch (thrown) {
      nestedError = thrown;
    }
    expect(nestedError?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(nestedError?.details).toMatchObject({ field: "system", path: "system.changes.0.type" });

    expect(() =>
      shimGuard({ "system.changes.0.type": "my-module.bonus", "system.changes.1.value": 5 })
    ).toThrow(/system\.changes\.0\.type/);

    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: v14EffectClass,
        patch: { "system.changes.0.value": 9 },
        merged: v14EffectMerged,
        index: 2,
        command: "actor.effect.update-many",
        id: "effect-1"
      })
    ).toThrow(/SILENTLY DISCARDS the whole write/);
  });

  it("refuses a NON-ARRAY value at the migration target that the merge silently discarded", () => {
    const dropped = { 0: { key: "system.a", type: "my-module.bonus", value: 2 } };
    /** @type {any} */
    let error = null;
    try {
      shimGuard({ "system.changes": dropped });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain('sets "system.changes" to a value that field does NOT accept');
    expect(error?.details).toMatchObject({ field: "system.changes", arrayField: "changes" });
    expect(error?.details?.requested).toEqual(dropped);

    expect(() => shimGuard({ system: { changes: dropped } })).toThrow(/does NOT accept/);
  });

  it("normalizes the `==` prefix at EVERY segment, so `system.==changes` is judged by its value", () => {
    const malformed = [{ key: "system.a", type: "my-module.bonus", value: 2 }];
    /** @type {any} */
    let error = null;
    try {
      shimGuard({ "system.==changes": malformed });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);

    expect(error?.message).toContain('sets "system.changes" (through "system.==changes")');
    expect(error?.details).toMatchObject({
      field: "system.==changes",
      arrayField: "changes",
      movedTo: "system.changes"
    });

    expect(() => shimGuard({ system: { "==changes": malformed } })).toThrow(/does NOT accept/);
    const empty = mergedWith([]);
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: v14EffectClass,
        patch: { "system.==changes": malformed },
        merged: empty,
        stored: empty,
        index: 2,
        command: "actor.effect.update-many",
        id: "effect-1"
      })
    ).toThrow(/does NOT accept/);

    expect(() => shimGuard({ "system.-=changes": null })).toThrow(/does NOT accept/);
    expect(() => shimGuard({ system: { "-=changes": null } })).toThrow(/does NOT accept/);
  });

  it("judges a `-=` at a DEEPER segment by what the merge did, not by the spelling", () => {
    /** @type {any} */
    let error = null;
    try {
      shimGuard({ "system.changes.0.-=type": null });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain(
      'writes "system.changes.0.-=type" INSIDE the array field "system.changes"'
    );
    expect(error?.details).toMatchObject({
      field: "system.changes.0.-=type",
      arrayField: "changes",
      movedTo: "system.changes",
      path: "system.changes.0.type",
      stored: "add"
    });

    expect(() => shimGuard({ "system.changes.0.-=type": null, "system.changes.0.value": 7 })).toThrow(
      /SILENTLY DISCARDS the whole write/
    );

    for (const patch of [{ "system.changes.-=0": null }, { system: { "changes.-=0": null } }]) {
      expect(() => shimGuard(patch, mergedWith([])), JSON.stringify(patch)).toThrow(
        /REBUILDS it from this patch alone/
      );
    }

    expect(() => shimGuard({ system: { changes: { "-=0": null } } }, mergedWith([]))).not.toThrow();

    expect(() => shimGuardEmptyStored({ "system.changes.-=0": null }, mergedWith([]))).not.toThrow();

    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: v14EffectClass,
        patch: { "system.changes.0.type": null },
        merged: mergedWith([{ key: "", type: "add", value: "", phase: "initial" }]),
        stored: mergedWith([]),
        index: 2,
        command: "actor.effect.update-many",
        id: "effect-1"
      })
    ).not.toThrow();

    expect(() => shimGuard({ "system.changes.0.type": null })).toThrow(/SILENTLY DISCARDS the whole write/);
  });

  it("refuses a `==<index>` write whose merge EMPTIED the array, even with a valid entry", () => {
    const valid = { key: "system.a", type: "add", value: 2 };
    /** @type {any} */
    let error = null;
    try {
      shimGuard({ "system.changes.==0": valid }, mergedWith([]));
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain('writes "system.changes.==0" INSIDE the array field "system.changes"');
    expect(error?.details).toMatchObject({
      field: "system.changes.==0",
      arrayField: "changes",
      movedTo: "system.changes",
      path: "system.changes.0",
      stored: null
    });
    expect(error?.details?.requested).toEqual(valid);

    expect(() =>
      shimGuard(
        { "system.changes.==0": { key: "system.a", type: "my-module.bonus", value: 2 } },
        mergedWith([])
      )
    ).toThrow(/SILENTLY DISCARDS the whole write/);

    expect(() =>
      shimGuardEmptyStored(
        { "system.changes.0.==value": 9 },
        mergedWith([{ key: "", type: "add", value: 9, phase: "initial" }])
      )
    ).not.toThrow();
    expect(() =>
      shimGuard(
        { "system.changes.0.==value": 9 },
        mergedWith([{ key: "", type: "add", value: 9, phase: "initial" }])
      )
    ).toThrow(/REBUILDS it from this patch alone/);
  });

  it("refuses a NON-INDEX segment on the migrated ARRAY, in every spelling that wipes it", () => {
    const wiped = mergedWith([]);
    /** @type {any} */
    let error = null;
    try {
      shimGuard({ "system.changes.length": 3 }, wiped);
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain('addresses the array field "system.changes" and is not an ARRAY INDEX');
    expect(error?.details).toMatchObject({
      field: "system.changes.length",
      arrayField: "changes",
      movedTo: "system.changes",
      path: "system.changes.length",
      segment: "length"
    });

    expect(() => shimGuard({ "system.changes.-=length": null }, wiped)).toThrow(/not an ARRAY INDEX/);
    expect(() => shimGuard({ system: { "changes.length": 3 } }, wiped)).toThrow(/not an ARRAY INDEX/);

    expect(() => shimGuard({ "system.changes.length": 0 }, wiped)).toThrow(/not an ARRAY INDEX/);

    expect(() => shimGuard({ "system.changes.constructor": 1 })).toThrow(/not an ARRAY INDEX/);

    expect(() => shimGuardEmptyStored({ "system.changes.-=0": null }, wiped)).not.toThrow();
    expect(() =>
      shimGuardEmptyStored(
        { "system.changes.0.value": 9 },
        mergedWith([{ key: "", type: "add", value: 9, phase: "initial" }])
      )
    ).not.toThrow();
    expect(() =>
      shimGuard(
        { "system.changes.0.value": 9 },
        mergedWith([{ key: "", type: "add", value: 9, phase: "initial" }])
      )
    ).toThrow(/REBUILDS it from this patch alone/);

    expect(() =>
      shimGuardEmptyStored(
        { "system.changes.0.value.x": 1 },
        mergedWith([{ key: "", type: "add", value: { x: 1 }, phase: "initial" }])
      )
    ).not.toThrow();

    for (const patch of [
      { "system.changes.0.key.-=length": null },
      { "system.changes.0.value.-=deep": null },
      { "system.changes.0.key.length": 3 }
    ]) {
      /** @type {any} */
      let scalarError = null;
      try {
        shimGuard(patch, mergedWith([{ key: "[object Object]", type: "add", value: "", phase: "initial" }]));
      } catch (thrown) {
        scalarError = thrown;
      }
      expect(scalarError?.code, JSON.stringify(patch)).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(scalarError?.message, JSON.stringify(patch)).toContain(
        "a property of a SCALAR value stored inside"
      );
    }

    expect(() =>
      shimGuardEmptyStored(
        { "system.changes.0.key.length": 3 },
        mergedWith([{ key: "[object Object]", type: "add", value: "", phase: "initial" }])
      )
    ).toThrow(/a property of a SCALAR value stored inside/);
  });

  it("REFUSES every deeper-path cell whose merge LOSES stored entry content", () => {
    const stored = [
      { key: "aaa", type: "add", value: 1, phase: "initial" },
      { key: "bbb", type: "add", value: 2, phase: "initial" },
      { key: "ccc", type: "override", value: 3, phase: "initial" }
    ];
    const storedDoc = mergedWith(stored);
    const guard = (patch, merged) =>
      assertBatchArrayWritesReflected({
        documentClass: v14EffectClass,
        patch,
        merged,
        stored: storedDoc,
        index: 2,
        command: "actor.effect.update-many",
        id: "effect-1"
      });
    const defaulted = { key: "", type: "add", value: "", phase: "initial" };

    /** @type {Array<[string, any, any[]]>} */
    const cells = [
      ["J1 -=0", { "system.changes.-=0": null }, []],
      ["J2 -=5", { "system.changes.-=5": null }, []],
      ["J3 0.-=nope", { "system.changes.0.-=nope": null }, [defaulted]],
      [
        "J4 0.key.-=length",
        { "system.changes.0.key.-=length": null },
        [{ ...defaulted, key: "[object Object]" }]
      ],
      ["J6 -=00", { "system.changes.-=00": null }, []],
      ["J7 0.value.-=deep", { "system.changes.0.value.-=deep": null }, [{ ...defaulted, value: {} }]],
      ["J9 nested -=5", { system: { "changes.-=5": null } }, []],
      ["K1 0.toString", { "system.changes.0.toString": 1 }, [{ ...defaulted, toString: 1 }]],
      [
        "K4 0.hasOwnProperty",
        { "system.changes.0.hasOwnProperty": 1 },
        [{ ...defaulted, hasOwnProperty: 1 }]
      ],
      [
        "L1 index 5",
        { "system.changes.5": { key: "system.a", type: "add", value: 2 } },
        [
          defaulted,
          defaulted,
          defaulted,
          defaulted,
          defaulted,
          { key: "system.a", type: "add", value: 2, phase: "initial" }
        ]
      ],
      [
        "L3 index 5 leaf",
        { "system.changes.5.value": 9 },
        [defaulted, defaulted, defaulted, defaulted, defaulted, { ...defaulted, value: 9 }]
      ],
      ["N1 0.value", { "system.changes.0.value": 9 }, [{ ...defaulted, value: 9 }]],
      [
        "N5 whole entry 0",
        { "system.changes.0": { key: "system.a", type: "add", value: 2 } },
        [{ key: "system.a", type: "add", value: 2, phase: "initial" }]
      ]
    ];
    for (const cellRow of cells) {
      const label = /** @type {string} */ (cellRow[0]);
      const patch = /** @type {any} */ (cellRow[1]);
      const merged = /** @type {any[]} */ (cellRow[2]);

      const lost = stored.filter(
        (entry) => !merged.some((after) => JSON.stringify(after) === JSON.stringify(entry))
      );
      expect(
        lost.length,
        `${label} must be a destructive cell for this table to mean anything`
      ).toBeGreaterThan(0);
      /** @type {any} */
      let error = null;
      try {
        guard(patch, mergedWith(merged));
      } catch (thrown) {
        error = thrown;
      }
      expect(error?.code, `${label} must be REFUSED`).toBe(ERROR_CODES.INVALID_PARAMS);

      expect(error?.message, label).toContain('the array field "system.changes"');
      expect(error?.message, label).toContain('the WHOLE array at "system.changes"');
    }
  });

  it("does NOT refuse a direct `system.<key>` write that lands, in any measured shape", () => {
    const valid = [{ key: "system.a", type: "add", value: "2" }];
    const cleaned = [{ key: "system.a", type: "add", value: "2", phase: "initial" }];

    expect(() => shimGuard({ "system.changes": valid }, mergedWith(cleaned))).not.toThrow();
    expect(() => shimGuard({ system: { changes: valid } }, mergedWith(cleaned))).not.toThrow();

    expect(() => shimGuard({ "system.changes": [] }, mergedWith([]))).not.toThrow();
    expect(() =>
      shimGuard({ "system.changes": [{ key: "system.a", type: "add", value: "1", phase: "initial" }] })
    ).not.toThrow();

    expect(() =>
      shimGuardEmptyStored(
        { "system.changes.0.value": 9 },
        mergedWith([{ key: "", type: "add", value: 9, phase: "initial" }])
      )
    ).not.toThrow();
    expect(() =>
      shimGuardEmptyStored(
        { "system.changes.0.value.x": 1 },
        mergedWith([{ key: "", type: "add", value: { x: 1 }, phase: "initial" }])
      )
    ).not.toThrow();

    expect(() =>
      shimGuardEmptyStored(
        { "system.changes.1.value": 5 },
        mergedWith([
          { key: "", type: "add", value: "", phase: "initial" },
          { key: "", type: "add", value: 5, phase: "initial" }
        ])
      )
    ).not.toThrow();

    expect(() => shimGuard({ "system.changes.0.type": "add" })).toThrow(/REBUILDS it from this patch alone/);

    expect(() =>
      shimGuardEmptyStored(
        { "system.changes.0.priority": "3" },
        mergedWith([{ key: "", type: "add", value: "", phase: "initial", priority: 3 }])
      )
    ).not.toThrow();
    expect(() =>
      shimGuardEmptyStored(
        { "system.changes.0": { key: "system.a", type: "add", value: 4 } },
        mergedWith([{ key: "system.a", type: "add", value: 4, phase: "initial" }])
      )
    ).not.toThrow();

    expect(() =>
      shimGuard(
        { "system.changes.0": { key: "system.a", type: "add", value: 4 } },
        mergedWith([{ key: "system.a", type: "add", value: 4, phase: "initial" }])
      )
    ).toThrow(/REBUILDS it from this patch alone/);

    for (const patch of [
      { "system.changes": "nope" },
      { "system.changes": null },
      { "system.changes": 5 },
      { system: { changes: { nope: 1 } } }
    ]) {
      expect(() => shimGuard(patch, mergedWith([])), JSON.stringify(patch)).not.toThrow();
    }

    expect(() =>
      shimGuard(
        { system: { changes: { 0: { key: "system.a", type: "add", value: "2" } } } },
        mergedWith(cleaned)
      )
    ).not.toThrow();

    expect(() => shimGuard({ "system.otherKey.deep": 1 })).not.toThrow();

    expect(() => shimGuard({ system: { somethingElse: 1 } })).not.toThrow();
    expect(() => shimGuard({ "system.someModuleArray": [1, 2, 3] })).not.toThrow();

    expect(() => shimGuard({ "==system.changes": valid }, mergedWith(cleaned))).not.toThrow();
    expect(() =>
      shimGuard({ "==system.changes": [{ key: "system.a", type: "my-module.bonus", value: 2 }] })
    ).toThrow(/does NOT accept/);

    expect(() => shimGuard({ "system.==changes": valid }, mergedWith(cleaned))).not.toThrow();
    expect(() => shimGuard({ system: { "==changes": valid } }, mergedWith(cleaned))).not.toThrow();

    expect(() =>
      shimGuardEmptyStored(
        { system: { "==changes.0.value": 9 } },
        mergedWith([{ key: "", type: "add", value: 9, phase: "initial" }])
      )
    ).not.toThrow();
    expect(() =>
      shimGuard(
        { system: { "==changes.0.value": 9 } },
        mergedWith([{ key: "", type: "add", value: 9, phase: "initial" }])
      )
    ).toThrow(/REBUILDS it from this patch alone/);

    expect(() =>
      shimGuard(
        { "system.changes": [{ key: "system.a", type: "my-module.bonus", value: 2 }] },
        mergedWith([{ key: "system.a", type: "my-module.bonus", value: 2, phase: "afterDerived" }])
      )
    ).not.toThrow();
  });

  it("refuses the rebuild without claiming destruction, and names the wholesale workaround", () => {
    /** @type {any} */
    let error = null;
    try {
      shimGuard({ "system.changes.0.type": "add" });
    } catch (thrown) {
      error = thrown;
    }
    expect(error, "the deeper write over stored entries must still be refused").toBeTruthy();
    const message = String(error.message);

    expect(message).toMatch(/REBUILDS it from this patch alone/);
    expect(message).toMatch(/does not compare the rebuilt array/i);
    expect(message).toMatch(/conservative/i);
    expect(message).toMatch(/WHOLE array/);

    expect(message).not.toMatch(/DESTROYED|destroys|destroyed/);
  });

  it("judges a legacy ==forced replacement like a plain array write", () => {
    expect(() => guard({ "==c": [5, 6, 7, 8] }, [5, 6, 7, 8])).not.toThrow();

    /** @type {any} */
    let error = null;
    try {
      guard({ "==c": [1, 2] }, [0, 0, 100, 100]);
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain("SILENTLY DISCARDS");
    expect(error?.details).toEqual({
      index: 3,
      id: "wall-7",
      field: "==c",
      arrayField: "c",
      requested: [1, 2],
      stored: [0, 0, 100, 100]
    });
  });

  it("refuses a DOTTED write into an array field, which neither core applies", () => {
    /** @type {any} */
    let error = null;
    try {
      guard({ "c.0": 5 }, [0, 0, 100, 100]);
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain('dotted path "c.0"');
    expect(error?.message).toContain("SILENTLY DISCARDS");
    expect(error?.message).toContain("Send the WHOLE array instead");
    expect(error?.details).toEqual({
      index: 3,
      id: "wall-7",
      field: "c.0",
      arrayField: "c",
      requested: 5,
      stored: 0
    });

    expect(() => guard({ "c.9": 5 }, [0, 0, 100, 100])).toThrow(/SILENTLY DISCARDS/);

    expect(() => guard({ ds: 1, "c.3": 999 }, [0, 0, 100, 100])).toThrow(/SILENTLY DISCARDS/);
  });

  it("skips a forced DELETION of a DECLARED field (no array value to compare; loud on both cores)", () => {
    expect(() => guard({ "-=c": null }, [0, 0, 100, 100])).not.toThrow();

    expect(() => guard({ "-=someModuleKey": null }, [0, 0, 100, 100])).not.toThrow();
  });

  it("allows a dotted write whose requested value the stored array ALREADY holds", () => {
    expect(() => guard({ "c.0": 0 }, [0, 0, 100, 100])).not.toThrow();
  });

  it("skips a dotted write whose root is NOT an array in the merged state", () => {
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: { schema: { get: () => ({ clean: (value) => value }) } },
        patch: { "animation.type": "swing", "flags.mod.x": 1 },
        merged: { toObject: () => ({ animation: { type: "swing" }, flags: {} }) },
        index: 0,
        command: "scene.wall.update-many",
        id: "wall-1"
      })
    ).not.toThrow();
  });

  it("skips a dotted write whose root the schema does not declare", () => {
    expect(() => guard({ "unknownArray.0": 5 }, [0, 0, 100, 100])).not.toThrow();
  });

  it("skips a field whose cleaner throws for EVERY input (it cannot be classified array-backed)", () => {
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: {
          schema: {
            get: () => ({
              clean: () => {
                throw new Error("invalid");
              }
            })
          }
        },
        patch: { c: [1, 2] },
        merged: { toObject: () => ({ c: [0, 0, 1, 1] }) },
        index: 0,
        command: "scene.wall.update-many",
        id: "wall-1"
      })
    ).not.toThrow();
  });

  it("REFUSES an array-backed field whose cleaner throws for THIS value", () => {
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: {
          schema: {
            get: () => ({
              clean: (value) => {
                if (Array.isArray(value) && value.length === 0) return [];
                throw new Error("invalid");
              }
            })
          }
        },
        patch: { c: [1, 2] },
        merged: { toObject: () => ({ c: [0, 0, 1, 1] }) },
        index: 0,
        command: "scene.wall.update-many",
        id: "wall-1"
      })
    ).toThrow(/SILENTLY DISCARDS/);
  });

  it("is inert (never throws) when no schema or no merged source is available", () => {
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: {},
        patch: { c: [1, 2] },
        merged: { toObject: () => ({ c: [9] }) },
        index: 0,
        command: "x",
        id: "y"
      })
    ).not.toThrow();
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass,
        patch: { c: [1, 2] },
        merged: null,
        index: 0,
        command: "x",
        id: "y"
      })
    ).not.toThrow();
  });

  it("compares structurally (nested arrays/objects), not by reference", () => {
    expect(batchValuesEqual([{ a: [1] }], [{ a: [1] }])).toBe(true);
    expect(batchValuesEqual([{ a: [1] }], [{ a: [2] }])).toBe(false);
    expect(batchValuesEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(batchValuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);

    expect(batchValuesEqual(Object.assign(Object.create(null), { a: 1 }), { a: 1 })).toBe(true);
  });

  it("never declares two DISTINCT key-less objects equal (an equal verdict here means ALLOW)", () => {
    expect(batchValuesEqual(new Set([1, 2]), new Set([3, 4]))).toBe(false);
    expect(batchValuesEqual(new Date(0), new Date(1_000_000_000))).toBe(false);
    expect(batchValuesEqual(new Map([["a", 1]]), new Map([["b", 2]]))).toBe(false);

    const shared = new Set([1]);
    expect(batchValuesEqual(shared, shared)).toBe(true);
  });
});

describe("batch-write: a token's detectionModes across the version SHAPE change", () => {
  const v13JunkEntry = [{ enabled: true, range: null }];
  const v13DetectionModes = {
    clean: (value) => {
      if (Array.isArray(value)) return value;
      if (value === null || typeof value === "object") return [];
      return v13JunkEntry.map((entry) => ({ ...entry }));
    },
    validate: (value) => (Array.isArray(value) ? null : { unresolved: true, message: "must be an array" })
  };

  const v14DetectionModes = {
    clean: (value) => (Array.isArray(value) || !value || typeof value !== "object" ? {} : { ...value }),
    validate: (value) =>
      value && typeof value === "object" && !Array.isArray(value) ? null : { unresolved: true }
  };
  const arrayShape = [{ id: "basicSight", enabled: true, range: 60 }];
  const objectShape = { basicSight: { enabled: true, range: 60 } };

  const runUpdate = (field, storedBefore, patchValue, mergedAfter) => {
    /** @type {any} */
    const row = {
      id: "token-1",
      source: { detectionModes: storedBefore },
      toObject: () => ({ detectionModes: row.source.detectionModes })
    };
    return executeBatchUpdate({
      command: "scene.token.update-many",
      patches: [{ id: "token-1", patch: { detectionModes: patchValue } }],
      dryRun: false,
      resolve: () => row,
      prepare: (patch) => ({ ...patch }),
      documentClass: { schema: { get: (key) => (key === "detectionModes" ? field : null) } },
      mergePreview: async () => ({ toObject: () => ({ detectionModes: mergedAfter }) }),
      diff: async () =>
        JSON.stringify(mergedAfter) === JSON.stringify(row.source.detectionModes)
          ? {}
          : { detectionModes: mergedAfter },
      update: async (entries) => {
        row.source.detectionModes = mergedAfter;
        return entries.map((entry) => ({ id: entry._id }));
      }
    });
  };

  it("on 14.365 a v13-shaped ARRAY is a NO-OP, reported `unchanged` — not refused", async () => {
    const result = await runUpdate(v14DetectionModes, objectShape, arrayShape, objectShape);
    expect(result.outcomes).toEqual([{ index: 0, id: "token-1", status: "unchanged" }]);
    expect(result.complete).toBe(true);
  });

  it("on 13.351 a v14-shaped OBJECT is a real write that CLEARS the modes, and is NOT refused", async () => {
    const result = await runUpdate(v13DetectionModes, arrayShape, objectShape, []);
    expect(result.outcomes).toEqual([{ index: 0, id: "token-1", status: "updated" }]);
    expect(result.complete).toBe(true);
  });

  it("still refuses the v13 object-into-array write when NOTHING was stored (nothing moved)", async () => {
    await expect(runUpdate(v13DetectionModes, [], objectShape, [])).rejects.toMatchObject({
      code: ERROR_CODES.INVALID_PARAMS,
      details: { index: 0, id: "token-1", arrayField: "detectionModes" }
    });
  });

  it("on 13.351 a bare STRING lands a DEFAULTED junk entry over stored modes, reported `updated`", async () => {
    const result = await runUpdate(v13DetectionModes, arrayShape, "basicSight", v13JunkEntry);
    expect(result.outcomes).toEqual([{ index: 0, id: "token-1", status: "updated" }]);
    expect(result.complete).toBe(true);
  });

  it("on 13.351 the same bare STRING over an EMPTY field is `updated` too, not refused", async () => {
    const result = await runUpdate(v13DetectionModes, [], "basicSight", v13JunkEntry);
    expect(result.outcomes).toEqual([{ index: 0, id: "token-1", status: "updated" }]);
    expect(result.complete).toBe(true);
  });

  it("on 14.365 a bare STRING is a NO-OP, reported `unchanged`", async () => {
    const result = await runUpdate(v14DetectionModes, objectShape, "basicSight", objectShape);
    expect(result.outcomes).toEqual([{ index: 0, id: "token-1", status: "unchanged" }]);
    expect(result.complete).toBe(true);
  });
});

describe("batch-write: the array guard judges a NON-ARRAY value written to an array field", () => {
  const cField = {
    clean: (value) => {
      if (Array.isArray(value)) return value;
      if (value === null || (value && typeof value === "object")) return [];
      return [value];
    }
  };
  const guard = (patch, storedC) =>
    assertBatchArrayWritesReflected({
      documentClass: { schema: { get: (key) => (key === "c" ? cField : null) } },
      patch,
      merged: { toObject: () => ({ c: storedC }) },
      index: 2,
      command: "scene.wall.update-many",
      id: "wall-9"
    });

  it("refuses an OBJECT written to an array field", () => {
    /** @type {any} */
    let error = null;
    try {
      guard({ c: { nope: 1 } }, [0, 0, 100, 100]);
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain("SILENTLY DISCARDS");
    expect(error?.details).toEqual({
      index: 2,
      id: "wall-9",
      field: "c",
      arrayField: "c",
      requested: { nope: 1 },
      stored: [0, 0, 100, 100]
    });
  });

  it("refuses a STRING, a NUMBER and NULL written to an array field", () => {
    expect(() => guard({ c: "nope" }, [0, 0, 100, 100])).toThrow(/SILENTLY DISCARDS/);
    expect(() => guard({ c: 5 }, [0, 0, 100, 100])).toThrow(/SILENTLY DISCARDS/);
    expect(() => guard({ c: null }, [0, 0, 100, 100])).toThrow(/SILENTLY DISCARDS/);
  });

  it("refuses it even when a sibling field in the same patch lands", () => {
    expect(() => guard({ ds: 1, c: { nope: 1 } }, [0, 0, 100, 100])).toThrow(/SILENTLY DISCARDS/);
  });

  it("still skips a NON-array-backed field handed an array (the merge probe really does judge those)", () => {
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: { schema: { get: () => ({ clean: () => ({ light: null }) }) } },
        patch: { threshold: [1, 2] },
        merged: { toObject: () => ({ threshold: { light: null } }) },
        index: 0,
        command: "scene.wall.update-many",
        id: "wall-1"
      })
    ).not.toThrow();
  });

  it("allows a NULL the merged document really stores (a nullable array field is not over-refused)", () => {
    expect(() => guard({ c: null }, null)).not.toThrow();
  });

  it("classifies by instanceof when the REAL field classes are reachable", () => {
    class ArrayField {}
    class EmbeddedCollectionField extends ArrayField {}
    globalThis.foundry.data = { fields: { ArrayField, EmbeddedCollectionField } };
    const field = Object.assign(new ArrayField(), {
      clean: (value) => (Array.isArray(value) && value.length === 0 ? "not-an-array" : value)
    });
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: { schema: { get: () => field } },
        patch: { c: [1, 2] },
        merged: { toObject: () => ({ c: [0, 0, 1, 1] }) },
        index: 0,
        command: "scene.wall.update-many",
        id: "wall-1"
      })
    ).toThrow(/SILENTLY DISCARDS/);
  });
});

describe("batch-write: the array guard models EmbeddedCollectionField MERGE-BY-_id", () => {
  const B1 = "b1b1b1b1b1b1b1b1";
  const B2 = "b2b2b2b2b2b2b2b2";

  const booleanField = {
    clean: (value) =>
      typeof value === "boolean"
        ? value
        : typeof value === "string"
          ? value === "true"
          : typeof value === "object" && value !== null
            ? false
            : Boolean(value),
    validate: (value) =>
      typeof value === "boolean" ? null : { unresolved: true, message: "must be a boolean" }
  };
  const stringField = {
    clean: (value) =>
      value === null || value === undefined ? "" : typeof value === "string" ? value : String(value),
    validate: (value) =>
      typeof value === "string" ? null : { unresolved: true, message: "must be a string" }
  };

  const typeDataField = {
    clean: (value) => (value && typeof value === "object" ? value : {}),
    validate: () => null
  };
  const flagsField = {
    clean: (value) =>
      Object.fromEntries(
        Object.entries(value ?? {}).filter(([, entry]) => entry && typeof entry === "object")
      ),
    validate: (value) =>
      Object.entries(value ?? {}).some(([, entry]) => !entry || typeof entry !== "object")
        ? { unresolved: true, message: "invalid flag scope" }
        : null
  };
  const elementSchema = {
    get: (key) =>
      ({
        disabled: booleanField,
        name: stringField,
        type: stringField,
        system: typeDataField,
        flags: flagsField
      })[key] ?? null
  };

  const behaviorsField = {
    getCollection: () => new Map(),
    schema: elementSchema,
    clean: (value) =>
      (Array.isArray(value) ? value : []).map((entry) => ({
        name: "",
        type: "base",
        system: {},
        flags: {},
        disabled: false,
        ...entry
      }))
  };

  const nestedGuard = (entryPatch, mergedEntryOverride) =>
    assertBatchArrayWritesReflected({
      documentClass: { schema: { get: (key) => (key === "behaviors" ? behaviorsField : null) } },
      patch: { behaviors: [{ _id: "b1b1b1b1b1b1b1b1", ...entryPatch }] },
      merged: {
        toObject: () => ({
          behaviors: [
            {
              _id: "b1b1b1b1b1b1b1b1",
              name: "one",
              type: "pause",
              system: {},
              flags: {},
              disabled: false,
              ...mergedEntryOverride
            }
          ]
        })
      },
      index: 0,
      command: "scene.region.update-many",
      id: "region-1"
    });

  const guard = (patch, mergedBehaviors) =>
    assertBatchArrayWritesReflected({
      documentClass: { schema: { get: (key) => (key === "behaviors" ? behaviorsField : null) } },
      patch,
      merged: { toObject: () => ({ behaviors: mergedBehaviors }) },
      index: 4,
      command: "scene.region.update-many",
      id: "region-3"
    });

  const mergedAfterPartial = [
    { _id: B1, name: "one", type: "pause", system: {}, flags: {}, disabled: true },
    { _id: B2, name: "two", type: "pause", system: {}, flags: {}, disabled: false }
  ];

  const mergedUnchanged = [
    { _id: B1, name: "one", type: "pause", system: {}, flags: {}, disabled: false },
    { _id: B2, name: "two", type: "pause", system: {}, flags: {}, disabled: false }
  ];

  it("ALLOWS a legal PARTIAL entry patch (the false refusal the wholesale premise produced)", () => {
    expect(() => guard({ behaviors: [{ _id: B1, disabled: true }] }, mergedAfterPartial)).not.toThrow();
  });

  it("ALLOWS a FULL array naming every entry verbatim (clean() re-defaults, the merge does not)", () => {
    expect(() =>
      guard(
        {
          behaviors: [
            { _id: B1, name: "one", type: "pause", disabled: false },
            { _id: B2, name: "two", type: "pause", disabled: false }
          ]
        },
        mergedUnchanged
      )
    ).not.toThrow();
  });

  it("REFUSES an entry value the core silently discards, which the CLEANER cannot catch", () => {
    /** @type {any} */
    let error = null;
    try {
      guard({ behaviors: [{ _id: B1, disabled: { nope: 1 } }] }, mergedUnchanged);
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain("SILENTLY DISCARDS");
    expect(error?.message).toContain("must be a boolean");
    expect(error?.details).toMatchObject({
      index: 4,
      id: "region-3",
      field: "behaviors",
      arrayField: "behaviors",
      embeddedCollection: true
    });
  });

  it("REFUSES an entry whose _id is neither merged nor created in the result", () => {
    expect(() => guard({ behaviors: [{ _id: "zzzzzzzzzzzzzzzz", name: "n" }] }, mergedUnchanged)).toThrow(
      /neither merged nor created/
    );
  });

  it("ALLOWS an entry whose UNKNOWN _id the core CREATED (measured: applied on both)", () => {
    expect(() =>
      guard({ behaviors: [{ _id: "zzzzzzzzzzzzzzzz", name: "n", type: "pause" }] }, [
        ...mergedUnchanged,
        { _id: "zzzzzzzzzzzzzzzz", name: "n", type: "pause", system: {}, flags: {}, disabled: false }
      ])
    ).not.toThrow();
  });

  const mergedAfterCreate = [
    ...mergedUnchanged,
    { _id: "mintedmintedmint", name: "new", type: "pause", system: {}, flags: {}, disabled: false }
  ];

  it("ALLOWS a create the core APPENDED, including with a null/empty _id and a COERCED value", () => {
    expect(() => guard({ behaviors: [{ name: "new", type: "pause" }] }, mergedAfterCreate)).not.toThrow();
    expect(() =>
      guard({ behaviors: [{ _id: null, name: "new", type: "pause" }] }, mergedAfterCreate)
    ).not.toThrow();
    expect(() =>
      guard({ behaviors: [{ _id: "", name: "new", type: "pause" }] }, mergedAfterCreate)
    ).not.toThrow();

    expect(() =>
      guard({ behaviors: [{ name: 5, type: "pause" }] }, [
        ...mergedUnchanged,
        { _id: "mintedmintedmint", name: "5", type: "pause", system: {}, flags: {}, disabled: false }
      ])
    ).not.toThrow();
  });

  it("REFUSES a create the core SILENTLY DROPPED (v14) — including a wrong-TYPE _id", () => {
    /** @type {any} */
    let error = null;
    try {
      guard({ behaviors: [{ disabled: true }] }, mergedUnchanged);
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain("was not added to the collection");
    expect(error?.details).toMatchObject({ index: 4, id: "region-3", embeddedCollection: true });

    expect(() => guard({ behaviors: [{ _id: 5, name: "new", type: "pause" }] }, mergedUnchanged)).toThrow(
      /was not added to the collection[\s\S]*"_id" was 5/
    );
  });

  it("does NOT let a SIBLING entry's own write witness a create", () => {
    expect(() =>
      guard(
        {
          behaviors: [
            { _id: B1, disabled: true },
            { disabled: true, type: "pause" }
          ]
        },
        mergedAfterPartial
      )
    ).toThrow(/was not added to the collection/);
  });

  it("does NOT let ONE appended row witness TWO _id-less creates", () => {
    const mergedAfterOneOfTwo = [
      ...mergedUnchanged,
      { _id: "mintedmintedmint", name: "dup", type: "pause", system: {}, flags: {}, disabled: false }
    ];
    expect(() =>
      guard({ behaviors: [{ name: "dup", type: "pause" }, { name: "dup" }] }, mergedAfterOneOfTwo)
    ).toThrow(/at least one of them was NOT added to the collection/);

    expect(() =>
      guard({ behaviors: [{ name: "dup", type: "pause" }, { name: "dup" }] }, mergedAfterOneOfTwo)
    ).toThrow(/cannot be determined from the result/);
    expect(() => guard({ behaviors: [{ name: "solo" }] }, mergedUnchanged)).toThrow(
      /the entry with no usable "_id" was not added to the collection/
    );
    expect(() => guard({ behaviors: [{ name: "solo" }] }, mergedUnchanged)).not.toThrow(
      /cannot be determined from the result/
    );

    expect(() =>
      guard(
        {
          behaviors: [
            { name: "dup", type: "pause" },
            { name: "dup", type: "pause" }
          ]
        },
        [
          ...mergedAfterOneOfTwo,
          { _id: "mintedmintedmin2", name: "dup", type: "pause", system: {}, flags: {}, disabled: false }
        ]
      )
    ).not.toThrow();
  });

  it("PINS a paired value: a key that MOVED to something else is not credited to this entry", () => {
    expect(() =>
      guardWithPre(
        { behaviors: [{ _id: B1, name: "x", "==name": "y" }] },
        [{ ...mergedUnchanged[0], name: "y" }, mergedUnchanged[1]],
        mergedUnchanged
      )
    ).toThrow(/sets "name" to a value the merged entry does not hold/);

    expect(() =>
      guardWithPre({ behaviors: [{ _id: B1, disabled: 1 }] }, mergedAfterPartial, mergedUnchanged)
    ).not.toThrow();
    expect(() =>
      guardWithPre(
        { behaviors: [{ _id: B1, name: 5 }] },
        [{ ...mergedUnchanged[0], name: "5" }, mergedUnchanged[1]],
        mergedUnchanged
      )
    ).not.toThrow();

    expect(() =>
      guardWithPre({ behaviors: [{ _id: B1, disabled: { nope: 1 } }] }, mergedUnchanged, mergedUnchanged)
    ).toThrow(/the element schema rejects/);
  });

  it("REFUSES two entries naming the same _id (measured last-write-wins on both cores)", () => {
    /** @type {any} */
    let error = null;
    try {
      guard(
        {
          behaviors: [
            { _id: B1, name: "x" },
            { _id: B1, name: "y" }
          ]
        },
        [{ ...mergedUnchanged[0], name: "y" }, mergedUnchanged[1]]
      );
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain(`two entries name the same "_id" ${B1}`);
    expect(error?.details).toMatchObject({ embeddedCollection: true, duplicateEntryId: B1 });

    expect(() =>
      guard(
        {
          behaviors: [
            { _id: "zzzzzzzzzzzzzzzz", name: "a", type: "pause" },
            { _id: "zzzzzzzzzzzzzzzz", name: "b", type: "pause" }
          ]
        },
        mergedUnchanged
      )
    ).toThrow(/two entries name the same "_id"/);
  });

  const guardWithPre = (patch, mergedBehaviors, preBehaviors) =>
    assertBatchArrayWritesReflected({
      documentClass: { schema: { get: (key) => (key === "behaviors" ? behaviorsField : null) } },
      patch,
      merged: { toObject: () => ({ behaviors: mergedBehaviors }) },
      stored: { toObject: () => ({ behaviors: preBehaviors }) },
      index: 4,
      command: "scene.region.update-many",
      id: "region-3"
    });

  it("EXEMPTS a plain-object entry value from the value pin (a partial nested write DEEP-MERGES)", () => {
    const preWithSystem = [
      { _id: B1, name: "one", type: "pause", system: { keep: 9 }, flags: {}, disabled: false }
    ];
    const mergedDeepMerged = [
      { _id: B1, name: "one", type: "pause", system: { keep: 9, foo: 1 }, flags: {}, disabled: false }
    ];
    expect(() =>
      guardWithPre({ behaviors: [{ _id: B1, system: { foo: 1 } }] }, mergedDeepMerged, preWithSystem)
    ).not.toThrow();

    expect(() =>
      guardWithPre({ behaviors: [{ _id: B1, system: { foo: 1 } }] }, preWithSystem, preWithSystem)
    ).toThrow(/does not hold/);
  });

  it("ALLOWS a paired entry value the core COERCED AND APPLIED", () => {
    expect(() =>
      guardWithPre({ behaviors: [{ _id: B1, disabled: 1 }] }, mergedAfterPartial, mergedUnchanged)
    ).not.toThrow();
    expect(() =>
      guardWithPre({ behaviors: [{ _id: B1, disabled: "true" }] }, mergedAfterPartial, mergedUnchanged)
    ).not.toThrow();

    expect(() => guard({ behaviors: [{ _id: B1, disabled: 1 }] }, mergedAfterPartial)).toThrow(
      /the element schema rejects/
    );
  });

  it("JUDGES a NULL entry value instead of crashing on it, and the two null cells differ", () => {
    const mergedNameBlanked = [{ ...mergedUnchanged[0], name: "" }, mergedUnchanged[1]];
    expect(() =>
      guardWithPre({ behaviors: [{ _id: B1, name: null }] }, mergedNameBlanked, mergedUnchanged)
    ).not.toThrow();

    expect(() =>
      guardWithPre({ behaviors: [{ _id: B1, disabled: null }] }, mergedUnchanged, mergedUnchanged)
    ).toThrow(/the element schema rejects/);

    let nullRefusal = null;
    try {
      guardWithPre({ behaviors: [{ _id: B1, disabled: null }] }, mergedUnchanged, mergedUnchanged);
    } catch (thrown) {
      nullRefusal = /** @type {any} */ (thrown);
    }
    expect(nullRefusal?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(nullRefusal?.details?.behaviorIndex ?? nullRefusal?.details?.index).not.toBeUndefined();
  });

  it("still REFUSES a silently dropped value when the pre-state is present", () => {
    expect(() =>
      guardWithPre({ behaviors: [{ _id: B1, disabled: { nope: 1 } }] }, mergedUnchanged, mergedUnchanged)
    ).toThrow(/the element schema rejects/);

    expect(() =>
      guardWithPre(
        { behaviors: [{ _id: B1, flags: { "my-mod": { x: 1 } } }] },
        mergedUnchanged,
        mergedUnchanged
      )
    ).toThrow(/does not hold/);
  });

  it("REFUSES a key the element schema does not declare (measured STRIPPED on both cores, always)", () => {
    expect(() => guard({ behaviors: [{ _id: B1, nopeKey: 1 }] }, mergedUnchanged)).toThrow(
      /does not declare and therefore STRIPS/
    );

    expect(() => guard({ behaviors: [{ _id: B1, "-=nopeKey": null }] }, mergedUnchanged)).toThrow(
      /does not declare and therefore STRIPS/
    );
    expect(() => guard({ behaviors: [{ _id: B1, "==nopeKey": 1 }] }, mergedUnchanged)).toThrow(
      /does not declare and therefore STRIPS/
    );
  });

  it("REFUSES a STACKED-prefix entry key beside a landing sibling (case f, by design — not an over-refusal)", () => {
    expect(() =>
      guard({ behaviors: [{ _id: B1, "====name": "z", name: "y" }] }, [
        { ...mergedUnchanged[0], name: "y" },
        mergedUnchanged[1]
      ])
    ).toThrow(/entry b1b1b1b1b1b1b1b1 writes "====name", which the element schema does not declare/);
  });

  it("reports an undeclared key the DOCUMENT MOVED into system as the move, not as an unknown key", () => {
    /** @type {any} */
    let error = null;
    try {
      guard({ behaviors: [{ _id: B1, changes: "nope" }] }, [
        { ...mergedUnchanged[0], system: { changes: [{ key: "system.a" }] } },
        mergedUnchanged[1]
      ]);
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.message).toContain('holds an array at "system.changes"');
    expect(error?.message).toContain("most likely MOVED there");

    expect(error?.message).toContain(`entry ${B1}`);
    expect(error?.details).toMatchObject({
      field: "behaviors",
      arrayField: "behaviors",
      embeddedCollection: true,
      movedTo: "system.changes"
    });
  });

  it("strips a ==forced replacement inside an entry and judges it like a plain key", () => {
    expect(() =>
      guard({ behaviors: [{ _id: B1, "==name": "forced" }] }, [
        { ...mergedUnchanged[0], name: "forced" },
        mergedUnchanged[1]
      ])
    ).not.toThrow();

    expect(() => guard({ behaviors: [{ _id: B1, "==disabled": { nope: 1 } }] }, mergedUnchanged)).toThrow(
      /the element schema rejects/
    );
  });

  it("REFUSES a -=forced deletion inside an entry the merged entry still holds", () => {
    expect(() => guard({ behaviors: [{ _id: B1, "-=name": null }] }, mergedUnchanged)).toThrow(
      /asks to DELETE "name"[\s\S]*still holds/
    );

    expect(() =>
      guard({ behaviors: [{ _id: B1, "-=name": null }] }, [
        { _id: B1, type: "pause", system: {}, flags: {}, disabled: false },
        mergedUnchanged[1]
      ])
    ).not.toThrow();
  });

  it("judges a DOTTED key inside an entry per core: allowed when reflected, refused when not", () => {
    expect(() =>
      guard({ behaviors: [{ _id: B1, "system.foo": 1 }] }, [
        { ...mergedUnchanged[0], system: { foo: 1 } },
        mergedUnchanged[1]
      ])
    ).not.toThrow();
    expect(() => guard({ behaviors: [{ _id: B1, "system.foo": 1 }] }, mergedUnchanged)).toThrow(
      /dotted path "system.foo"/
    );

    expect(() => guard({ behaviors: [{ _id: B1, "flags.mod.x": 1 }] }, mergedUnchanged)).toThrow(
      /dotted path "flags.mod.x"/
    );
  });

  it("REFUSES a non-array value and a non-object entry", () => {
    expect(() => guard({ behaviors: { nope: 1 } }, mergedUnchanged)).toThrow(/not an array of entries/);
    expect(() => guard({ behaviors: ["nope"] }, mergedUnchanged)).toThrow(/not a plain object/);
  });

  it("allows a `system` write the core APPLIES inside an entry (raw value equals the merged value)", () => {
    expect(() => nestedGuard({ system: { foo: 1 } }, { system: { foo: 1 } })).not.toThrow();
  });

  it("refuses a BARE flag key (stripped, silent on both cores) via the element validator", () => {
    expect(() => nestedGuard({ flags: { foo: 1 } }, {})).toThrow(/invalid flag scope/);
  });

  it("refuses a VALID namespaced flag the core silently dropped — the validator PASSES it", () => {
    expect(() => nestedGuard({ flags: { "my-mod": { x: 1 } } }, {})).toThrow(/does not hold/);

    expect(() =>
      nestedGuard({ flags: { "my-mod": { x: 1 } } }, { flags: { "my-mod": { x: 1 } } })
    ).not.toThrow();
  });

  it("allows a per-key NO-OP whose element cleaner throws (the raw-value escape runs FIRST)", () => {
    const hostileField = {
      clean: () => {
        throw new Error("cannot clean");
      },
      validate: () => ({ unresolved: true, message: "cannot validate either" })
    };
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: {
          schema: {
            get: (key) =>
              key === "behaviors"
                ? { ...behaviorsField, schema: { get: (inner) => (inner === "name" ? hostileField : null) } }
                : null
          }
        },

        patch: { behaviors: [{ _id: B1, name: "one" }] },
        merged: {
          toObject: () => ({
            behaviors: [
              { _id: B1, name: "one" },
              { _id: B2, name: "two" }
            ]
          })
        },
        index: 0,
        command: "scene.region.update-many",
        id: "region-1"
      })
    ).not.toThrow();
  });

  it("classifies an ECF by instanceof when the real field classes are reachable", () => {
    class ArrayField {}
    class EmbeddedCollectionField extends ArrayField {}
    globalThis.foundry.data = { fields: { ArrayField, EmbeddedCollectionField } };

    const field = Object.assign(new EmbeddedCollectionField(), {
      schema: elementSchema,
      clean: behaviorsField.clean
    });
    expect(() =>
      assertBatchArrayWritesReflected({
        documentClass: { schema: { get: () => field } },
        patch: { behaviors: [{ _id: B1, disabled: true }] },
        merged: { toObject: () => ({ behaviors: mergedAfterPartial }) },
        index: 0,
        command: "scene.region.update-many",
        id: "region-1"
      })
    ).not.toThrow();
  });
});

describe("batch-write: two spellings of ONE field in one element patch", () => {
  const B1 = "b1b1b1b1b1b1b1b1";

  const behaviorsField = { getCollection: () => new Map(), schema: { get: () => null }, clean: () => [] };
  const plainArrayField = { clean: (value) => (Array.isArray(value) ? value : []) };
  const documentClass = {
    schema: {
      get: (key) =>
        key === "behaviors"
          ? behaviorsField
          : key === "shapes"
            ? plainArrayField
            : key === "c"
              ? plainArrayField
              : {}
    }
  };
  const scan = (patch) =>
    assertNoAmbiguousBatchKeySpellings({
      documentClass,
      patch,
      index: 3,
      command: "scene.wall.update-many",
      id: "wall-9"
    });

  it("REFUSES two spellings of the same TOP-LEVEL root, in both key orders", () => {
    /** @type {any} */
    let error = null;
    try {
      scan({ "==threshold": { light: 2 }, threshold: { light: 1 } });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain("scene.wall.update-many element 3 (id wall-9)");
    expect(error?.message).toContain('"threshold"');
    expect(error?.message).toContain("Merge them into one key and retry");
    expect(error?.details).toMatchObject({
      index: 3,
      id: "wall-9",
      field: "threshold",
      ambiguousRoot: "threshold"
    });
    expect(error?.details?.ambiguousKeys).toEqual(["==threshold", "threshold"]);

    expect(() => scan({ threshold: { light: 1 }, "==threshold": { light: 2 } })).toThrow(/more than one key/);

    expect(() => scan({ ds: 1, "-=ds": null })).toThrow(/more than one key/);
    expect(() => scan({ "-=ds": null, ds: 1 })).toThrow(/more than one key/);
    expect(() => scan({ "==ds": 1, "-=ds": null })).toThrow(/more than one key/);
    expect(() => scan({ "-=ds": null, "==ds": 1 })).toThrow(/more than one key/);

    expect(() => scan({ "threshold.light": 9, "==threshold.light": 7 })).toThrow(/more than one key/);
    expect(() => scan({ "==threshold.light": 7, "threshold.light": 9 })).toThrow(/more than one key/);
  });

  it("REFUSES an OPERATOR-spelled wholesale root beside a dotted key under it", () => {
    expect(() => scan({ "==threshold": { light: 1 }, "threshold.light": 9 })).toThrow(/more than one key/);
    expect(() => scan({ "threshold.light": 9, "==threshold": { light: 1 } })).toThrow(/more than one key/);
    expect(() => scan({ "-=threshold": null, "threshold.light": 9 })).toThrow(/more than one key/);

    /** @type {any} */
    let error = null;
    try {
      scan({ "==threshold": { light: 1 }, "threshold.light": 9 });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.details?.ambiguityRule).toBe(2);
    expect(error?.message).toContain("Foundry 13 applies the narrower key on top of the forced replacement");
    expect(error?.message).not.toContain("keeps the LAST spelling");
    expect(error?.message).toContain("Merge them into one key and retry");

    try {
      scan({ threshold: { light: 1 }, "==threshold": { light: 2 } });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.details?.ambiguityRule).toBe(1);
    expect(error?.message).toContain("keeps the LAST spelling");
    expect(error?.message).not.toContain("applies the narrower key");
  });

  it("ALLOWS ordinary patches that merely SHARE a root", () => {
    expect(() => scan({ "threshold.light": 9, "threshold.sight": 8 })).not.toThrow();
    expect(() => scan({ "flags.mod.a": 1, "flags.mod.b": 2 })).not.toThrow();

    expect(() => scan({ threshold: { light: 1, sight: 1 }, "threshold.light": 9 })).not.toThrow();
    expect(() => scan({ "threshold.light": 9, threshold: { light: 1, sight: 1 } })).not.toThrow();

    expect(() => scan({ "==threshold": { light: 1 }, ds: 1, "-=door": null, "c.0": 5 })).not.toThrow();
    expect(() => scan({})).not.toThrow();
  });

  it("REFUSES a nested operator spelling on an INNER segment of a top-level dotted key", () => {
    expect(() => scan({ "threshold.light": 9, "threshold.==light": 7 })).toThrow(/more than one key/);
    expect(() => scan({ "threshold.==light": 7, "threshold.light": 9 })).toThrow(/more than one key/);
    expect(() => scan({ "threshold.light": 9, "threshold.-=light": null })).toThrow(/more than one key/);
    expect(() => scan({ "flags.core.a": 1, "flags.core.==a": 7 })).toThrow(/more than one key/);

    expect(() => scan({ "flags.==core.a": 1, "flags.core.==a": 7 })).toThrow(/more than one key/);
    /** @type {any} */
    let error = null;
    try {
      scan({ "flags.core.a": 1, "flags.core.==a": 7 });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.details).toMatchObject({ field: "flags.core.a", ambiguousRoot: "flags", ambiguityRule: 1 });
    expect(error?.details?.ambiguousKeys).toEqual(["flags.core.a", "flags.core.==a"]);

    expect(error?.message).toContain('writes the same field "flags.core.a"');

    expect(() => scan({ "==flags.core": { a: 5 }, "flags.core.b": 9 })).toThrow(/more than one key/);
    expect(() => scan({ "flags.core.b": 9, "==flags.core": { a: 5 } })).toThrow(/more than one key/);
    expect(() => scan({ "flags.==core": { a: 5 }, "flags.core.b": 9 })).toThrow(/more than one key/);
    expect(() => scan({ "-=flags.core": null, "flags.core.b": 9 })).toThrow(/more than one key/);
    error = null;
    try {
      scan({ "flags.==core": { a: 5 }, "flags.core.b": 9 });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.details).toMatchObject({ field: "flags.core", ambiguousRoot: "flags", ambiguityRule: 2 });
    expect(error?.details?.ambiguousKeys).toEqual(["flags.==core", "flags.core.b"]);

    error = null;
    try {
      scan({ "==threshold.light": 7, "threshold.==light": 3 });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.details?.ambiguityRule).toBe(1);
    expect(error?.details?.field).toBe("threshold.light");
  });

  it("targets the SEGMENT the operator sits on, so only keys under THAT path collide", () => {
    expect(() => scan({ "==threshold.light": 7, "threshold.sight": 8 })).toThrow(/more than one key/);

    expect(() => scan({ "threshold.==light": 7, "threshold.sight": 8 })).not.toThrow();
  });

  it("ALLOWS a nested operator key that collides with nothing", () => {
    expect(() => scan({ "==threshold.==light": 7 })).not.toThrow();

    expect(() => scan({ "threshold.==light": 7 })).not.toThrow();

    expect(() => scan({ "flags.==core": { a: 5 } })).not.toThrow();

    expect(() => scan({ "flags.==core": { a: 5 }, "flags.other": 1 })).not.toThrow();

    expect(() => scan({ "flags.==core": { a: 5 }, "flags.other.deep": 1 })).not.toThrow();

    expect(() => scan({ "threshold.==light": 7, "threshold.==sight": 8 })).not.toThrow();
  });

  it("keeps the ECF ENTRY scan leading-only, so a nested entry key is judged by the reflection arm", () => {
    expect(() => scan({ behaviors: [{ _id: B1, "system.keep": 3, "system.==keep": 7 }] })).not.toThrow();
    expect(() =>
      scan({ behaviors: [{ _id: B1, "flags.==core": { a: 5 }, "flags.core.z": 9 }] })
    ).not.toThrow();

    expect(() =>
      scan({ behaviors: [{ _id: B1, "==flags.core": { a: 5 }, "flags.core.z": 9 }] })
    ).not.toThrow();

    expect(() =>
      scan({ behaviors: [{ _id: B1, "==flags": { core: { a: 5 } }, "flags.core.z": 9 }] })
    ).toThrow(/more than one key/);
  });

  it("REFUSES two spellings of one field INSIDE an embedded-collection entry", () => {
    /** @type {any} */
    let error = null;
    try {
      scan({ behaviors: [{ _id: B1, system: { bar: 2 }, "==system": { foo: 1 } }] });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain('inside one entry of the embedded collection "behaviors"');
    expect(error?.details).toMatchObject({ field: "system", ambiguousRoot: "system" });

    expect(() => scan({ behaviors: [{ _id: B1, name: "x", "==name": "y" }] })).toThrow(/more than one key/);
    expect(() => scan({ behaviors: [{ _id: B1, "==name": "y", name: "x" }] })).toThrow(/more than one key/);
    expect(() => scan({ behaviors: [{ _id: B1, name: "x", "-=name": null }] })).toThrow(/more than one key/);

    expect(() =>
      scan({
        behaviors: [
          { _id: B1, name: "ok" },
          { name: "x", "==name": "y" }
        ]
      })
    ).toThrow(/more than one key/);

    expect(() => scan({ behaviors: [{ _id: B1, name: "x" }] })).not.toThrow();
    expect(() => scan({ behaviors: [{ _id: B1, "flags.mod.a": 1, "flags.mod.b": 2 }] })).not.toThrow();
  });

  it("does NOT scan entries of a plain ArrayField, or a non-array value", () => {
    expect(() => scan({ shapes: [{ "==type": "a", type: "b" }] })).not.toThrow();
    expect(() => scan({ behaviors: { "==name": 1, name: 2 } })).not.toThrow();

    expect(() =>
      assertNoAmbiguousBatchKeySpellings({
        documentClass: null,
        patch: { behaviors: [{ _id: B1, name: "x", "==name": "y" }] },
        index: 0,
        command: "scene.region.update-many",
        id: "r1"
      })
    ).not.toThrow();
    expect(() =>
      assertNoAmbiguousBatchKeySpellings({
        documentClass: null,
        patch: { name: "x", "==name": "y" },
        index: 0,
        command: "scene.region.update-many",
        id: "r1"
      })
    ).toThrow(/more than one key/);
  });

  it("reports the SAME-PATH collision when a patch trips both rules (precedence is pinned)", () => {
    /** @type {any} */
    let error = null;
    try {
      scan({ "==threshold": { light: 1 }, threshold: { light: 2 }, "threshold.light": 9 });
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.details?.field).toBe("threshold");
    expect(error?.details?.ambiguousKeys).toEqual(["==threshold", "threshold"]);
  });
});

describe("batch-write: a Region's `shapes` — credited when it moves, refused when it collapses", () => {
  const shapesField = {
    clean: (value) => (Array.isArray(value) ? value.map((entry) => ({ ...entry })) : []),
    validate: (value) =>
      Array.isArray(value) &&
      value.every((entry) => entry && typeof entry === "object" && typeof entry.type === "string")
        ? null
        : { unresolved: true, message: "must be an array of shapes" }
  };
  const shapesGuard = (patch, mergedShapes, preShapes) =>
    assertBatchArrayWritesReflected({
      documentClass: { schema: { get: (key) => (key === "shapes" ? shapesField : null) } },
      patch,
      merged: { toObject: () => ({ shapes: mergedShapes }) },
      stored: { toObject: () => ({ shapes: preShapes }) },
      index: 2,
      command: "scene.region.update-many",
      id: "region-lava"
    });
  const RECT = { type: "rectangle", x: 0, y: 0, width: 10, height: 10 };

  it("CREDITS the destructive clear of a NON-EMPTY shapes array, which is disclosed, not guarded", () => {
    expect(() => shapesGuard({ shapes: { nope: 1 } }, [], [RECT])).not.toThrow();
    expect(() => shapesGuard({ shapes: null }, [], [RECT])).not.toThrow();
  });

  it("REFUSES the same value over an ALREADY-EMPTY shapes array, where nothing moves", () => {
    /** @type {any} */
    let error = null;
    try {
      shapesGuard({ shapes: { nope: 1 } }, [], []);
    } catch (thrown) {
      error = thrown;
    }
    expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(error?.message).toContain("COLLAPSES");
    expect(error?.details).toMatchObject({ index: 2, id: "region-lava", arrayField: "shapes" });
    expect(() => shapesGuard({ shapes: null }, [], [])).toThrow(/COLLAPSES/);
  });

  it("allows an ORDINARY shapes write (the over-refusal arm)", () => {
    expect(() => shapesGuard({ shapes: [RECT] }, [RECT], [])).not.toThrow();

    expect(() => shapesGuard({ shapes: [] }, [], [RECT])).not.toThrow();
  });

  it("refuses a DOTTED write into shapes, which no supported core applies", () => {
    expect(() => shapesGuard({ "shapes.0.x": 5 }, [RECT], [RECT])).toThrow(/SILENTLY DISCARDS/);
  });
});

describe("batch-write: an operator key INSIDE a plain-array element", () => {
  const cleanV13 = (value) => value.map((entry) => ({ ...entry }));
  const cleanV14 = (value) =>
    value.map((entry) => {
      const out = {};
      for (const [key, entryValue] of Object.entries(entry)) {
        if (key.startsWith("=="))
          out[key.slice(2)] = { __$OPERATOR$__: "ForcedReplacement", value: entryValue };
        else out[key] = entryValue;
      }
      return out;
    });

  const cleanErasing = (value) =>
    value.map((entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => !key.startsWith("=="))));

  const guard = (clean, patch, mergedShapes) =>
    assertBatchArrayWritesReflected({
      documentClass: { schema: { get: (key) => (key === "shapes" ? { clean } : null) } },
      patch,
      merged: { toObject: () => ({ shapes: mergedShapes }) },
      index: 1,
      command: "scene.region.update-many",
      id: "region-9"
    });

  const cells = [
    [
      "13.351 (the literal ==x key survives clean())",
      cleanV13,

      { type: "rectangle", "==x": 9, x: 1, y: 1, width: 2, height: 2 },
      { type: "rectangle", x: 1, y: 1, width: 2, height: 2 }
    ],
    [
      "14.365 (clean() emits a ForcedReplacement operator object)",
      cleanV14,

      { type: "rectangle", x: 9, "==x": 9, y: 1, width: 2, height: 2 },
      { type: "rectangle", x: 9, y: 1, width: 2, height: 2 }
    ]
  ];

  for (const [label, clean, requested, stored] of cells) {
    it(`refuses it on ${label}`, () => {
      /** @type {any} */
      let error = null;
      try {
        guard(clean, { shapes: [requested] }, [stored]);
      } catch (thrown) {
        error = thrown;
      }
      expect(error?.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(error?.message).toContain("SILENTLY DISCARDS");

      expect(error?.details).toMatchObject({
        index: 1,
        id: "region-9",
        field: "shapes",
        arrayField: "shapes"
      });

      expect(() => guard(cleanErasing, { shapes: [requested] }, [stored])).not.toThrow();
    });
  }
});
