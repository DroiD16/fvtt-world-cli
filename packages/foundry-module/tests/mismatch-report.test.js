import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ERROR_CODES } from "../scripts/generated/protocol.js";
import {
  MISMATCH_PATH_LIMIT,
  buildMismatchReport,
  createMismatchError,
  evaluateRequestedDiff
} from "../scripts/lib/mismatch-report.js";
import { applyConfirmedUpdate, assertDocumentUpdateCommitted } from "../scripts/lib/write-confirmation.js";

import { ForcedDeletion, ForcedReplacement, dataFieldOperators } from "./helpers/data-field-operators.js";

beforeEach(() => {
  globalThis.foundry = /** @type {any} */ ({
    utils: { deepClone: (/** @type {unknown} */ value) => structuredClone(value) },
    data: { operators: dataFieldOperators }
  });
});

afterEach(() => {
  delete globalThis.foundry;
});

/**
 * @param {Record<string, unknown>} diff
 * @param {unknown} stored
 */
function evaluate(diff, stored) {
  return evaluateRequestedDiff(diff, () => stored);
}

/**
 * @param {Record<string, any>} source
 * @param {{ probe: (stored: Record<string, any>, patch: Record<string, any>) => Record<string, any>, write?: (stored: Record<string, any>, patch: Record<string, any>) => void }} behavior
 */
function createDocument(source, { probe, write = () => {} }) {
  const document = {
    id: "item-1",
    source: structuredClone(source),
    toObject() {
      return structuredClone(this.source);
    },
    async clone() {
      return {
        updateSource(/** @type {Record<string, any>} */ patch, /** @type {any} */ context = {}) {
          if (context.dryRun) return probe(document.source, patch);
          return {};
        },
        toObject: () => structuredClone(document.source)
      };
    },
    updateSource() {
      return {};
    }
  };
  return {
    document,
    write: async (/** @type {Record<string, any>} */ payload) => {
      write(document.source, payload);
      return document;
    }
  };
}

/**
 * @param {Promise<unknown>} pending
 * @returns {Promise<any>}
 */
async function rejection(pending) {
  try {
    await pending;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("evaluateRequestedDiff", () => {
  it("confirms an empty diff and a diff that names only _id", () => {
    expect(evaluate({}, { name: "A" })).toEqual({ status: "confirmed" });
    expect(evaluate({ _id: "x" }, { name: "A" })).toEqual({ status: "confirmed" });
  });

  it("reports every differing leaf with the requested and the stored value", () => {
    const evaluation = evaluate(
      { system: { description: { value: "<p>A & B</p>" } }, name: "B" },
      { name: "A", system: { description: { value: "<p>A &amp; B</p>" } } }
    );
    expect(evaluation).toEqual({
      status: "pending",
      report: {
        fields: ["system", "name"],
        paths: [
          { path: "system.description.value", requested: "<p>A & B</p>", stored: "<p>A &amp; B</p>" },
          { path: "name", requested: "B", stored: "A" }
        ]
      }
    });
  });

  it("drops a leaf the stored source already holds", () => {
    expect(evaluate({ system: { hp: 5, ac: 12 } }, { system: { hp: 5, ac: 12 } })).toEqual({
      status: "confirmed"
    });
  });

  it("satisfies a legacy deletion of a key that is absent, present or never existed", () => {
    const stored = { flags: { kept: 1 }, system: { activities: { a2: {} } } };
    expect(evaluate({ flags: { "-=gone": null } }, stored)).toEqual({ status: "confirmed" });
    expect(evaluate({ system: { activities: { "-=a1": null } } }, stored)).toEqual({
      status: "confirmed"
    });
    expect(evaluate({ flags: { "-=kept": null } }, stored)).toMatchObject({
      status: "pending",
      report: { paths: [{ path: "flags.kept", absent: "requested", stored: 1 }] }
    });
  });

  it("satisfies a ForcedDeletion when the key is absent, whatever the probe re-emits", () => {
    const stored = { system: { activities: { a2: { n: 2 } } } };
    expect(evaluate({ system: { activities: { a1: new ForcedDeletion() } } }, stored)).toEqual({
      status: "confirmed"
    });
    expect(evaluate({ system: { activities: { zz: new ForcedDeletion() } } }, stored)).toEqual({
      status: "confirmed"
    });
    expect(evaluate({ system: { activities: { a2: new ForcedDeletion() } } }, stored)).toMatchObject({
      status: "pending",
      report: { paths: [{ path: "system.activities.a2", absent: "requested", stored: { n: 2 } }] }
    });
  });

  it("reports a deletion that left an emptied container behind", () => {
    expect(evaluate({ flags: { "-=dnd5e": null } }, { flags: { dnd5e: {}, mod: { k: 1 } } })).toMatchObject({
      status: "pending",
      report: { fields: ["flags"], paths: [{ path: "flags.dnd5e", absent: "requested", stored: {} }] }
    });
  });

  it("compares a forced replacement as a whole value at any depth", () => {
    const stored = { system: { attrs: { a: 5, b: "dflt", inner: { c: 9, d: "d0" } } } };
    const replacement = { a: 5, b: "dflt", inner: { c: 9, d: "d0" } };
    for (const diff of [
      { system: { "==attrs": replacement } },
      { system: { attrs: { "==inner": { c: 9, d: "d0" } } } },
      { "==system": { attrs: replacement } },
      { system: { attrs: new ForcedReplacement(replacement) } },
      { system: { attrs: { inner: new ForcedReplacement({ c: 9, d: "d0" }) } } }
    ]) {
      expect(evaluate(diff, stored), JSON.stringify(diff)).toEqual({ status: "confirmed" });
    }
    expect(evaluate({ system: { "==attrs": { a: 6 } } }, stored)).toMatchObject({
      status: "pending",
      report: { paths: [{ path: "system.attrs", requested: { a: 6 }, stored: replacement }] }
    });
    expect(evaluate({ system: { attrs: new ForcedReplacement({ a: 6 }) } }, stored)).toMatchObject({
      status: "pending",
      report: { paths: [{ path: "system.attrs", requested: { a: 6 } }] }
    });
  });

  it("treats an own key holding undefined as absent on either side", () => {
    const replacement = { identifier: "new", level: { min: undefined } };
    const stored = { system: { visibility: { identifier: "new", level: {} } } };
    expect(evaluate({ system: { visibility: new ForcedReplacement(replacement) } }, stored)).toEqual({
      status: "confirmed"
    });
    expect(
      evaluate(
        { system: { "==visibility": { identifier: "new", level: {} } } },
        { system: { visibility: { identifier: "new", level: { min: undefined } } } }
      )
    ).toEqual({ status: "confirmed" });
    expect(
      evaluate(
        { system: { visibility: new ForcedReplacement(replacement) } },
        {
          system: { visibility: { identifier: "new", level: { min: 0 } } }
        }
      )
    ).toMatchObject({ status: "pending", report: { paths: [{ path: "system.visibility" }] } });
  });

  it("satisfies a deletion that left an own key holding undefined", () => {
    const stored = { system: { attrs: { a: undefined, b: "x" }, activities: { a1: { n: undefined } } } };
    expect(evaluate({ system: { attrs: { "-=a": null } } }, stored)).toEqual({
      status: "confirmed"
    });
    expect(evaluate({ system: { activities: { a1: { n: new ForcedDeletion() } } } }, stored)).toEqual({
      status: "confirmed"
    });
  });

  it("marks a stored key holding undefined as absent in the report", () => {
    expect(evaluate({ system: { attrs: { a: 3 } } }, { system: { attrs: { a: undefined } } })).toMatchObject({
      status: "pending",
      report: { paths: [{ path: "system.attrs.a", requested: 3, absent: "stored" }] }
    });
  });

  it("treats a cleared field (requested undefined) as a deletion", () => {
    expect(evaluate({ system: { label: undefined } }, { system: { label: undefined } })).toEqual({
      status: "confirmed"
    });
    expect(evaluate({ system: { label: undefined } }, { system: {} })).toEqual({
      status: "confirmed"
    });
    expect(evaluate({ system: { label: undefined } }, { system: { label: "x" } })).toMatchObject({
      status: "pending",
      report: { paths: [{ path: "system.label", absent: "requested", stored: "x" }] }
    });
  });

  it("treats an empty object as a leaf, not as nothing to confirm", () => {
    expect(evaluate({ flags: { newns: {} } }, { flags: {} })).toMatchObject({
      status: "pending",
      report: { paths: [{ path: "flags.newns", requested: {}, absent: "stored" }] }
    });
    expect(evaluate({ flags: { newns: {} } }, { flags: { newns: {} } })).toEqual({
      status: "confirmed"
    });
  });

  it("cannot confirm a non-empty diff when the stored source is unreadable", () => {
    expect(evaluate({ name: "B" }, null)).toMatchObject({ status: "unprovable" });
  });
});

describe("buildMismatchReport", () => {
  it("shortens long strings around the first differing offset", () => {
    const prefix = "word ".repeat(200);
    const report = buildMismatchReport(
      [{ segments: ["system", "description", "value"], requested: `${prefix}A & B` }],
      { system: { description: { value: `${prefix}A &amp; B` } } }
    );
    const [entry] = report.paths;
    expect(entry.truncated).toEqual({
      format: "text",
      offset: 1003,
      requestedLength: 1005,
      storedLength: 1009
    });
    expect(entry.requested).toContain("A & B");
    expect(entry.stored).toContain("A &amp; B");
    expect(String(entry.requested).length).toBeLessThanOrEqual(160);
  });

  it("caps objects and arrays by serialized size", () => {
    const items = Array.from({ length: 60 }, (_unused, index) => ({
      _id: `item${index}`,
      name: `Item ${index}`
    }));
    const report = buildMismatchReport(
      [
        {
          segments: ["items"],
          requested: [...items.slice(0, 59), { _id: "item59", name: "X" }]
        }
      ],
      {
        items
      }
    );
    const [entry] = report.paths;
    expect(entry.truncated?.format).toBe("json");
    expect(typeof entry.requested).toBe("string");
    expect(entry.requested).toContain('"X"');
    expect(entry.stored).toContain('"Item 59"');
  });

  it("lists at most the path limit and counts the rest", () => {
    const leaves = Array.from({ length: MISMATCH_PATH_LIMIT + 3 }, (_unused, index) => ({
      segments: ["flags", "mod", `k${index}`],
      requested: index
    }));
    const report = buildMismatchReport(leaves, { flags: { mod: {} } });
    expect(report.paths).toHaveLength(MISMATCH_PATH_LIMIT);
    expect(report.pathsTruncated).toBe(3);
    expect(report.fields).toEqual(["flags"]);
  });
});

describe("createMismatchError", () => {
  const report = { fields: ["name"], paths: [{ path: "name", requested: "B", stored: "A" }] };

  it("carries the path limit and the truncated count into the error details", () => {
    const leaves = Array.from({ length: MISMATCH_PATH_LIMIT + 3 }, (_unused, index) => ({
      segments: ["flags", `k${index}`],
      requested: index
    }));
    const error = createMismatchError({
      subject: "Item X",
      report: buildMismatchReport(leaves, { flags: {} })
    });
    expect(error.details.paths).toHaveLength(MISMATCH_PATH_LIMIT);
    expect(error.details.pathsTruncated).toBe(3);
  });

  it("keeps INTERNAL_ERROR and makes no change claim without a before snapshot", () => {
    const error = createMismatchError({ subject: "Item X", report, details: { itemId: "X" } });
    expect(error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(error.message).toContain("cannot verify");
    expect(error.details).toEqual({ itemId: "X", fields: ["name"], paths: report.paths });
  });

  it("flags partial and the applied fields when stored data changed", () => {
    const error = createMismatchError({ subject: "Item X", report, changedFields: ["name", "img"] });
    expect(error.details).toMatchObject({
      changedFields: ["name", "img"],
      appliedFields: ["img"],
      partial: true
    });
  });

  it("reports an unchanged document without the partial flag", () => {
    const error = createMismatchError({ subject: "Item X", report, changedFields: [] });
    expect(error.details.changedFields).toEqual([]);
    expect(error.details.partial).toBeUndefined();
  });

  it("never instructs disabling a module", () => {
    const error = createMismatchError({ subject: "Item X", report, changedFields: [] });
    expect(error.message).not.toMatch(/disable the module/i);
  });
});

describe("applyConfirmedUpdate with Foundry-shaped post-write diffs", () => {
  it("confirms a nested forced replacement that the probe re-emits after it landed", async () => {
    const { document, write } = createDocument(
      { system: { attrs: { a: 2, b: "old" } } },
      {
        probe: () => ({ system: { "==attrs": { a: 5, b: "dflt" } } }),
        write: (stored) => {
          stored.system.attrs = { a: 5, b: "dflt" };
        }
      }
    );
    await expect(
      applyConfirmedUpdate({
        document,
        patch: { system: { "==attrs": { a: 5 } } },
        write,
        subject: "Item item-1",
        hookName: "preUpdateItem",
        details: { itemId: "item-1" }
      })
    ).resolves.toBe(document);
  });

  it("confirms a TypedObjectField deletion that the probe still reports as a ForcedDeletion", async () => {
    const { document, write } = createDocument(
      { system: { activities: { a1: { n: 1 }, a2: { n: 2 } } } },
      {
        probe: () => ({ system: { activities: { a1: new ForcedDeletion() } } }),
        write: (stored) => {
          delete stored.system.activities.a1;
        }
      }
    );
    await expect(
      applyConfirmedUpdate({
        document,
        patch: { system: { activities: { "-=a1": null } } },
        write,
        subject: "Item item-1",
        hookName: "preUpdateItem",
        details: {}
      })
    ).resolves.toBe(document);
  });

  it("confirms the deletion of a key that never existed", async () => {
    const { document, write } = createDocument(
      { system: { activities: { a1: { n: 1 } } } },
      { probe: () => ({ system: { activities: { zz: new ForcedDeletion() } } }) }
    );
    await expect(
      applyConfirmedUpdate({
        document,
        patch: { system: { activities: { "-=zz": null } } },
        write,
        subject: "Item item-1",
        hookName: "preUpdateItem",
        details: {}
      })
    ).resolves.toBe(document);
  });

  it("reports a rewritten value as partial with per-path values", async () => {
    const { document, write } = createDocument(
      { system: { description: { value: "<p>old</p>" } } },
      {
        probe: (stored) =>
          stored.system.description.value === "<p>A & B</p>"
            ? {}
            : { system: { description: { value: "<p>A & B</p>" } } },
        write: (stored) => {
          stored.system.description.value = "<p>A &amp; B</p>";
        }
      }
    );
    const error = await rejection(
      applyConfirmedUpdate({
        document,
        patch: { system: { description: { value: "<p>A & B</p>" } } },
        write,
        subject: "Item item-1",
        hookName: "preUpdateItem",
        details: { itemId: "item-1" }
      })
    );
    expect(error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(error.message).toContain("cannot verify");
    expect(error.details).toEqual({
      itemId: "item-1",
      fields: ["system"],
      paths: [{ path: "system.description.value", requested: "<p>A & B</p>", stored: "<p>A &amp; B</p>" }],
      changedFields: ["system"],
      appliedFields: [],
      partial: true
    });
  });
});

describe("applyConfirmedUpdate with a post-write probe Foundry rejects", () => {
  it("reports a changed document as indeterminate instead of an empty mismatch", async () => {
    const { document, write } = createDocument(
      { name: "A" },
      {
        probe: () => {
          throw Object.assign(new Error("name: may not be undefined"), { name: "DataModelValidationError" });
        },
        write: (stored) => {
          stored.name = "B";
        }
      }
    );
    const error = await rejection(
      applyConfirmedUpdate({
        document,
        patch: { name: "C" },
        write,
        subject: "Item item-1",
        hookName: "preUpdateItem",
        details: {}
      })
    );
    expect(error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(error.details).toMatchObject({ fields: ["name"], changedFields: ["name"], indeterminate: true });
    expect(error.details.validationError).toContain("may not be undefined");
    expect(error.details.paths).toBeUndefined();
  });
});

describe("assertDocumentUpdateCommitted", () => {
  it("reports an unchanged document from a before snapshot", async () => {
    const { document } = createDocument({ active: false }, { probe: () => ({ active: true }) });
    const error = await rejection(
      assertDocumentUpdateCommitted({
        document,
        patch: { active: true },
        subject: "Combat c1",
        hookName: "preUpdateCombat",
        details: { combatId: "c1" },
        before: { active: false }
      })
    );
    expect(error.details).toEqual({
      combatId: "c1",
      fields: ["active"],
      paths: [{ path: "active", requested: true, stored: false }],
      changedFields: []
    });
  });

  it("reports a rejected probe after a change as indeterminate", async () => {
    const { document } = createDocument(
      { active: true },
      {
        probe: () => {
          throw Object.assign(new Error("active: invalid"), { name: "DataModelValidationError" });
        }
      }
    );
    const error = await rejection(
      assertDocumentUpdateCommitted({
        document,
        patch: { active: true },
        subject: "Combat c1",
        hookName: "preUpdateCombat",
        details: { combatId: "c1" },
        before: { active: false }
      })
    );
    expect(error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(error.details).toMatchObject({ changedFields: ["active"], indeterminate: true });
    expect(error.details.validationError).toContain("invalid");
  });

  it("still reports a rejected probe without a change as a rejection", async () => {
    const { document } = createDocument(
      { active: false },
      {
        probe: () => {
          throw Object.assign(new Error("active: invalid"), { name: "DataModelValidationError" });
        }
      }
    );
    const error = await rejection(
      assertDocumentUpdateCommitted({
        document,
        patch: { active: true },
        subject: "Combat c1",
        hookName: "preUpdateCombat",
        details: {},
        before: { active: false }
      })
    );
    expect(error.code).toBe(ERROR_CODES.INVALID_PARAMS);
  });

  it("reports a rejected probe without a before snapshot as indeterminate", async () => {
    const { document } = createDocument(
      { active: false },
      {
        probe: () => {
          throw Object.assign(new Error("active: invalid"), { name: "DataModelValidationError" });
        }
      }
    );
    const error = await rejection(
      assertDocumentUpdateCommitted({
        document,
        patch: { active: true },
        subject: "Combat c1",
        hookName: "preUpdateCombat",
        details: {},
        before: null
      })
    );
    expect(error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(error.details).toMatchObject({ changedFields: null, indeterminate: true });
  });

  it("makes no change claim without a before snapshot", async () => {
    const { document } = createDocument({ active: false }, { probe: () => ({ active: true }) });
    const error = await rejection(
      assertDocumentUpdateCommitted({
        document,
        patch: { active: true },
        subject: "Combat c1",
        hookName: "preUpdateCombat",
        details: {},
        before: null
      })
    );
    expect(error.details.changedFields).toBeUndefined();
    expect(error.details.paths).toEqual([{ path: "active", requested: true, stored: false }]);
  });
});
