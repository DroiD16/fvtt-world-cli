import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PREPARED_VALUE_MAX_BYTES,
  PREPARED_VALUE_MAX_DEPTH,
  PREPARED_VALUE_MAX_NODES
} from "../scripts/generated/protocol.js";
import { serializePreparedValue } from "../scripts/lib/prepared-values.js";

class DataModel {
  static schema = { fields: {} };
  get schema() {
    return /** @type {any} */ (this.constructor).schema;
  }
}

class Document extends DataModel {}

const schemaField = (fields) => ({ fields });
const dataField = () => ({});

function defineHidden(target, key, value) {
  Object.defineProperty(target, key, { value, writable: false, enumerable: false });
}

beforeEach(() => {
  globalThis.foundry = /** @type {any} */ ({ abstract: { DataModel, Document } });
});

afterEach(() => {
  delete globalThis.foundry;
});

describe("serializePreparedValue", () => {
  it("reads schema keys Foundry v13 defines non-enumerable, nested ones included, and keeps derived own values", () => {
    class SystemModel extends DataModel {
      static schema = {
        fields: {
          _id: dataField(),
          rank: dataField(),
          label: dataField(),
          attributes: schemaField({ ac: schemaField({ flat: dataField(), locked: dataField() }) })
        }
      };
    }
    const system = /** @type {any} */ (new SystemModel());
    defineHidden(system, "_id", "activity00000001");
    defineHidden(system, "rank", 3);
    Object.defineProperty(system, "label", { get: () => "Derived label", set() {}, configurable: true });
    const ac = { flat: 12, value: 15 };
    defineHidden(ac, "locked", true);
    system.attributes = { ac };
    system.derivedTotal = 7;
    defineHidden(system, "parent", { name: "owner" });
    defineHidden(system, "_source", { rank: 3 });

    expect(serializePreparedValue(system)).toEqual({
      value: {
        _id: "activity00000001",
        rank: 3,
        label: "Derived label",
        attributes: { ac: { flat: 12, locked: true, value: 15 } },
        derivedTotal: 7
      }
    });
  });

  it("reads schema getter fields Foundry v14 defines as enumerable accessors", () => {
    class SystemModel extends DataModel {
      static schema = { fields: { race: dataField(), level: dataField() } };
    }
    const system = /** @type {any} */ (new SystemModel());
    Object.defineProperty(system, "race", { get: () => "Elf", configurable: true, enumerable: true });
    system.level = 4;

    expect(serializePreparedValue(system).value).toEqual({ race: "Elf", level: 4 });
  });

  it("skips own accessors and prototype getters outside the schema", () => {
    class Proficiency {
      constructor() {
        this.multiplier = 1;
      }
      get flat() {
        return 2;
      }
    }
    const node = { prof: new Proficiency() };
    Object.defineProperty(node, "computed", { get: () => 9, enumerable: true });

    expect(serializePreparedValue(node).value).toEqual({ prof: { multiplier: 1 } });
  });

  it("stubs nested documents and keys Maps and values-only Collections by their keys", () => {
    class Collection extends Map {
      /** @returns {any} */
      [Symbol.iterator]() {
        return this.values();
      }
    }
    const item = Object.assign(new Document(), { id: "item0000000000001", name: "Sword" });
    Object.defineProperty(item, "documentName", { value: "Item" });
    Object.defineProperty(item, "uuid", { value: "Actor.a.Item.item0000000000001" });
    const activities = new Collection([["act1", { type: "attack", labels: { toHit: "+5" } }]]);

    expect(serializePreparedValue({ item, activities, tags: new Set(["a", "b"]) }).value).toEqual({
      item: { documentName: "Item", id: "item0000000000001", uuid: "Actor.a.Item.item0000000000001" },
      activities: { act1: { type: "attack", labels: { toHit: "+5" } } },
      tags: ["a", "b"]
    });
  });

  it("marks cycles and non-JSON kinds instead of failing, and keeps dates readable", () => {
    const node = /** @type {any} */ ({ when: new Date(Date.UTC(2026, 0, 2)), roll: () => 1, big: 1n });
    node.self = node;

    expect(serializePreparedValue(node).value).toEqual({
      when: "2026-01-02T00:00:00.000Z",
      roll: { $unserializable: "function" },
      big: { $unserializable: "bigint" },
      self: { $unserializable: "circular-reference" }
    });
  });

  it("answers null with the limit that was reached instead of a partial value", () => {
    /** @type {any} */
    let deep = {};
    const root = deep;
    for (let level = 0; level <= PREPARED_VALUE_MAX_DEPTH; level += 1) {
      deep.next = {};
      deep = deep.next;
    }
    expect(serializePreparedValue(root)).toEqual({
      value: null,
      omitted: { reason: "too-large", limit: "depth", max: PREPARED_VALUE_MAX_DEPTH }
    });

    expect(serializePreparedValue(new Array(PREPARED_VALUE_MAX_NODES).fill(1))).toEqual({
      value: null,
      omitted: { reason: "too-large", limit: "nodes", max: PREPARED_VALUE_MAX_NODES }
    });

    expect(serializePreparedValue({ text: "x".repeat(PREPARED_VALUE_MAX_BYTES) })).toEqual({
      value: null,
      omitted: { reason: "too-large", limit: "bytes", max: PREPARED_VALUE_MAX_BYTES }
    });
  });
});
