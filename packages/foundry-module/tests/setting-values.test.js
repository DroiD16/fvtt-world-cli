import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ERROR_CODES,
  SETTING_VALUE_MAX_BYTES,
  SETTING_VALUE_MAX_DEPTH,
  SETTING_VALUE_MAX_NODES
} from "../scripts/generated/protocol.js";
import {
  jsonStringByteLength,
  serializeSettingValue,
  utf8ByteLength
} from "../scripts/lib/setting-values.js";

function expectThrown(value, limits) {
  try {
    serializeSettingValue(value, limits);
  } catch (error) {
    return /** @type {any} */ (error);
  }

  throw new Error("expected serializeSettingValue to throw");
}

afterEach(() => {
  delete globalThis.foundry;
  vi.restoreAllMocks();
});

describe("serializeSettingValue — plain kinds", () => {
  it("maps undefined to null at the root, in a property and in an array hole", () => {
    expect(serializeSettingValue(undefined)).toBeNull();
    expect(serializeSettingValue({ a: undefined })).toEqual({ a: null });

    expect(serializeSettingValue([1, , 3])).toEqual([1, null, 3]);
  });

  it("passes null/boolean/string/finite-number through unchanged", () => {
    expect(serializeSettingValue(null)).toBeNull();
    expect(serializeSettingValue(true)).toBe(true);
    expect(serializeSettingValue("hello")).toBe("hello");
    expect(serializeSettingValue(0)).toBe(0);
    expect(serializeSettingValue(-2.5)).toBe(-2.5);
  });

  it("maps NaN/Infinity to null (matching how a setting value is PERSISTED)", () => {
    expect(serializeSettingValue(Number.NaN)).toBeNull();
    expect(serializeSettingValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(serializeSettingValue({ n: Number.NaN })).toEqual({ n: null });
  });

  it("walks nested plain objects and arrays, preserving key insertion order", () => {
    const value = { b: 1, a: { deep: [1, "two", { three: false }] } };
    const result = serializeSettingValue(value);
    expect(result).toEqual({ b: 1, a: { deep: [1, "two", { three: false }] } });
    expect(Object.keys(/** @type {any} */ (result))).toEqual(["b", "a"]);
  });

  it("ignores symbol-keyed properties (as JSON.stringify does)", () => {
    const value = { kept: 1, [Symbol("dropped")]: 2 };
    expect(serializeSettingValue(value)).toEqual({ kept: 1 });
  });

  it("REPORTS a `__proto__` key as an own property instead of dropping it into Object.prototype's setter", () => {
    const leaked = /** @type {any} */ (
      serializeSettingValue(JSON.parse('{"a":1,"__proto__":{"secret":"leak"},"b":2}'))
    );
    expect(Object.getOwnPropertyNames(leaked)).toEqual(["a", "__proto__", "b"]);
    expect(Object.getOwnPropertyDescriptor(leaked, "__proto__")).toMatchObject({
      enumerable: true,
      writable: true,
      configurable: true
    });
    expect(Object.getOwnPropertyDescriptor(leaked, "__proto__")?.value).toEqual({ secret: "leak" });

    expect(Object.getPrototypeOf(leaked)).toBe(Object.prototype);
    expect(JSON.stringify(leaked)).toBe('{"a":1,"__proto__":{"secret":"leak"},"b":2}');

    const stringValued = /** @type {any} */ (
      serializeSettingValue(JSON.parse('{"__proto__":"plain-string"}'))
    );
    expect(Object.getOwnPropertyNames(stringValued)).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(stringValued, "__proto__")?.value).toBe("plain-string");
    expect(Object.getPrototypeOf(stringValued)).toBe(Object.prototype);

    const nested = /** @type {any} */ (
      serializeSettingValue(JSON.parse('{"cfg":{"__proto__":{"x":1},"keep":true}}'))
    );
    expect(Object.getOwnPropertyNames(nested)).toEqual(["cfg"]);
    expect(Object.getOwnPropertyNames(nested.cfg)).toEqual(["__proto__", "keep"]);
    expect(Object.getPrototypeOf(nested.cfg)).toBe(Object.prototype);
    expect(JSON.stringify(nested)).toBe('{"cfg":{"__proto__":{"x":1},"keep":true}}');
  });
});

describe("serializeSettingValue — refused kinds", () => {
  it.each([
    ["bigint", 42n, "$"],
    ["function", () => 1, "$"],
    ["symbol", Symbol("s"), "$"]
  ])("refuses a %s with SETTING_VALUE_NOT_SERIALIZABLE and a path", (reason, value, path) => {
    const error = expectThrown(value);
    expect(error.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
    expect(error.details).toMatchObject({ reason, path });
  });

  it("reports the JSON path of the offending node, not just the root", () => {
    const error = expectThrown({ outer: [{ inner: 7n }] });
    expect(error.details).toMatchObject({ reason: "bigint", path: "$.outer[0].inner" });
  });

  it("refuses a circular reference but allows the same object twice as SIBLINGS", () => {
    const cyclic = /** @type {any} */ ({ name: "root" });
    cyclic.self = cyclic;
    const error = expectThrown(cyclic);
    expect(error.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
    expect(error.details).toMatchObject({ reason: "circular-reference", path: "$.self" });

    const shared = { shared: true };
    expect(serializeSettingValue({ a: shared, b: shared })).toEqual({
      a: { shared: true },
      b: { shared: true }
    });
  });

  it("refuses an own ACCESSOR property instead of invoking, dropping or nulling it", () => {
    const getter = vi.fn(() => "invoked");
    const value = {};
    Object.defineProperty(value, "secret", { get: getter, enumerable: true, configurable: true });
    const error = expectThrown(value);
    expect(error.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
    expect(error.details).toMatchObject({ reason: "accessor-property", path: "$.secret" });
    expect(getter).not.toHaveBeenCalled();
  });

  it("refuses an own accessor on an ARRAY INDEX too", () => {
    const getter = vi.fn(() => "invoked");
    const value = [1];
    Object.defineProperty(value, 1, { get: getter, enumerable: true, configurable: true });
    const error = expectThrown(value);
    expect(error.details).toMatchObject({ reason: "accessor-property", path: "$[1]" });
    expect(getter).not.toHaveBeenCalled();
  });

  it("refuses a SET-ONLY accessor on an ARRAY INDEX (it has no `value` to walk)", () => {
    const value = [1, 2];
    Object.defineProperty(value, 1, { set: () => {}, enumerable: true, configurable: true });
    const error = expectThrown(value);
    expect(error.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
    expect(error.details).toMatchObject({ reason: "accessor-property", path: "$[1]" });
  });

  it("refuses a NON-ENUMERABLE own accessor too — the v13 lazy-subfield shape", () => {
    const getter = vi.fn(() => "resolved-document");
    const value = { n: 2 };
    Object.defineProperty(value, "user", { get: getter, set() {}, configurable: true });
    expect(Object.keys(value)).toEqual(["n"]);
    const error = expectThrown(value);
    expect(error.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
    expect(error.details).toMatchObject({ reason: "accessor-property", path: "$.user" });
    expect(getter).not.toHaveBeenCalled();
  });

  it("REPORTS a non-enumerable own DATA property — the v13 `readonly` subfield shape", () => {
    const v13Shape = {};
    Object.defineProperty(v13Shape, "ro", { value: "locked", writable: false });
    v13Shape.n = 5;
    expect(Object.keys(v13Shape)).toEqual(["n"]);
    expect(JSON.stringify(v13Shape)).toBe('{"n":5}');
    expect(serializeSettingValue(v13Shape)).toEqual({ ro: "locked", n: 5 });

    const v14Shape = {};
    Object.defineProperty(v14Shape, "ro", { value: "locked", writable: false, enumerable: true });
    v14Shape.n = 5;
    expect(Object.keys(v14Shape)).toEqual(["ro", "n"]);
    expect(serializeSettingValue(v14Shape)).toEqual({ ro: "locked", n: 5 });
  });

  it("refuses a NON-ENUMERABLE data property holding a FUNCTION — the v13 readonly-thunk shape", () => {
    const thunk = vi.fn(() => ({ id: "abcdefghij123456" }));
    const value = /** @type {any} */ ({});
    Object.defineProperty(value, "ro", { value: thunk, writable: false });
    value.n = 5;
    expect(Object.keys(value)).toEqual(["n"]);
    const error = expectThrown(value);
    expect(error.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
    expect(error.details).toMatchObject({ reason: "function", path: "$.ro" });
    expect(thunk).not.toHaveBeenCalled();
  });

  it("does NOT report a non-index own property of an ARRAY (JSON parity for an index-shaped value)", () => {
    const value = /** @type {any} */ ([1, 2]);
    value.extra = "not-an-index";
    expect(serializeSettingValue(value)).toEqual([1, 2]);
  });

  it("refuses a LAZY-THUNK root value — the ForeignDocumentField-typed setting shape", () => {
    const thunk = vi.fn(() => ({ id: "abcdefghij123456" }));
    const error = expectThrown(thunk);
    expect(error.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
    expect(error.details).toMatchObject({ reason: "function", path: "$" });
    expect(thunk).not.toHaveBeenCalled();
  });

  it("refuses a SETTER-only own property (it can hold no readable value either)", () => {
    const value = {};
    Object.defineProperty(value, "writeOnly", { set: () => {}, enumerable: true, configurable: true });
    expect(expectThrown(value).details).toMatchObject({ reason: "accessor-property", path: "$.writeOnly" });
  });
});

describe("serializeSettingValue — never executes foreign code", () => {
  it("does NOT call a user toJSON/valueOf/toString, and serializes own data fields instead", () => {
    const toJSON = vi.fn(() => ({ hijacked: true }));
    const valueOf = vi.fn(() => "hijacked");
    const toString = vi.fn(() => "hijacked");
    class Constructed {
      constructor() {
        this.raw = "v";
        this.derived = "d:v";
      }

      get computed() {
        throw new Error("prototype getter must never be invoked");
      }
    }

    Constructed.prototype.toJSON = toJSON;
    Constructed.prototype.valueOf = valueOf;
    Constructed.prototype.toString = toString;

    expect(serializeSettingValue(new Constructed())).toEqual({ raw: "v", derived: "d:v" });
    expect(toJSON).not.toHaveBeenCalled();
    expect(valueOf).not.toHaveBeenCalled();
    expect(toString).not.toHaveBeenCalled();
  });

  it("never walks the PROTOTYPE CHAIN (inherited data properties and methods are not reported)", () => {
    const base = { inherited: "from-prototype" };
    const value = Object.create(base);
    value.own = 1;
    expect(serializeSettingValue(value)).toEqual({ own: 1 });
  });

  it("reads a Map through the INTRINSIC entries(), so a subclass override cannot substitute data", () => {
    class EvilMap extends Map {
      entries() {
        return /** @type {any} */ ([["hijacked", true]][Symbol.iterator]());
      }

      [Symbol.iterator]() {
        return /** @type {any} */ ([["hijacked", true]][Symbol.iterator]());
      }
    }

    const evil = new EvilMap([
      ["a", 1],
      ["b", { nested: true }]
    ]);
    expect(serializeSettingValue(evil)).toEqual([
      ["a", 1],
      ["b", { nested: true }]
    ]);
  });

  it("reads a Set through the INTRINSIC values(), so a subclass override cannot substitute data", () => {
    class EvilSet extends Set {
      values() {
        return /** @type {any} */ (["hijacked"][Symbol.iterator]());
      }

      [Symbol.iterator]() {
        return /** @type {any} */ (["hijacked"][Symbol.iterator]());
      }
    }

    expect(serializeSettingValue(new EvilSet(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("walks a DataModel through the INTRINSIC toObject(), so a subclass override cannot decide the report", () => {
    class DataModel {
      toObject() {
        return { .../** @type {any} */ (this)._source };
      }
    }

    class EvilModel extends DataModel {
      constructor(source) {
        super();
        this._source = source;
      }

      toObject() {
        return { hijacked: true };
      }
    }

    globalThis.foundry = { abstract: { DataModel } };
    expect(serializeSettingValue(new EvilModel({ a: "hello", n: 3 }))).toEqual({ a: "hello", n: 3 });
  });

  it("falls back to the instance toObject() only when the INTRINSIC one is absent", () => {
    class DataModel {}
    class Model extends DataModel {
      toObject() {
        return { a: 1 };
      }
    }

    globalThis.foundry = { abstract: { DataModel } };
    expect(serializeSettingValue(new Model())).toEqual({ a: 1 });
  });

  it("REFUSES a DataModel whose source read throws, rather than falling through to the plain-object arm", () => {
    const cloneLike = (original, depth = 0) => {
      if (depth > 100) {
        throw new Error(
          "Maximum depth exceeded. Be sure your object does not contain cyclical data structures."
        );
      }

      if (typeof original !== "object" || original === null) {
        return original;
      }

      const clone = {};
      for (const key of Object.keys(original)) {
        clone[key] = cloneLike(original[key], depth + 1);
      }

      return clone;
    };

    class DataModel {
      toObject(source = true) {
        return source ? cloneLike(/** @type {any} */ (this)._source) : {};
      }
    }

    class Model extends DataModel {
      constructor(source) {
        super();
        this._source = source;
      }
    }

    globalThis.foundry = { abstract: { DataModel } };

    const cyclic = { a: 1 };
    cyclic.self = cyclic;

    for (const [value, path] of [
      [new Model(cyclic), "$"],
      [{ model: new Model(cyclic) }, "$.model"]
    ]) {
      const error = expectThrown(value);
      expect(error.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
      expect(error.details).toMatchObject({ reason: "data-model-read", path });
    }

    expect(serializeSettingValue(new Model({ a: "hello" }))).toEqual({ a: "hello" });
  });

  it("guards the FALLBACK arm too — both the toObject property READ and its dispatch", () => {
    class DataModel {}

    class ThrowingDispatch extends DataModel {
      toObject() {
        throw new Error("toObject boom");
      }
    }

    class ThrowingRead extends DataModel {}
    Object.defineProperty(ThrowingRead.prototype, "toObject", {
      configurable: true,
      get() {
        throw new Error("accessor boom");
      }
    });

    globalThis.foundry = { abstract: { DataModel } };

    for (const value of [new ThrowingDispatch(), new ThrowingRead()]) {
      const error = expectThrown(value);
      expect(error.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
      expect(error.details).toMatchObject({ reason: "data-model-read", path: "$" });
    }
  });

  it("puts `data-model-read` in the SAME precedence slot as every other ARM refusal, not in the accessor pass", () => {
    class DataModel {
      toObject() {
        throw new Error("source boom");
      }
    }

    globalThis.foundry = { abstract: { DataModel } };
    const broken = new DataModel();

    expect(expectThrown({ model: broken, pad: "x".repeat(500) }, { maxBytes: 50 }).details).toMatchObject({
      reason: "data-model-read",
      path: "$.model"
    });

    expect(expectThrown({ pad: "x".repeat(500), model: broken }, { maxBytes: 50 }).details).toMatchObject({
      limit: "value-bytes",
      path: "$.pad"
    });

    expect(expectThrown({ model: broken }, { maxDepth: 0 }).details).toMatchObject({ limit: "value-depth" });
    expect(expectThrown({ model: broken }, { maxNodes: 1 }).details).toMatchObject({ limit: "value-nodes" });
  });

  it("refuses an own FUNCTION property on a plain object (no foundry global, no DataModel branch)", () => {
    const error = expectThrown({ _source: { a: 1 }, toObject: () => ({ a: 1 }) });
    expect(error.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
    expect(error.details).toMatchObject({ reason: "function", path: "$.toObject" });
  });
});

describe("serializeSettingValue — Map / Set / Date shapes", () => {
  it("converts a Map to [key, value] PAIRS, walking both halves", () => {
    const value = new Map(
      /** @type {any[]} */ ([
        ["a", 1],
        ["b", new Set([1, 2])]
      ])
    );
    expect(serializeSettingValue(value)).toEqual([
      ["a", 1],
      ["b", [1, 2]]
    ]);
  });

  it("walks an OBJECT Map key like any other value", () => {
    expect(serializeSettingValue(new Map([[{ k: 1 }, "v"]]))).toEqual([[{ k: 1 }, "v"]]);
  });

  it("counts a Map's SYNTHESIZED pair layer in the DEPTH bound, so the advertised limit is the output's", () => {
    const nest = (levels) => {
      let value = /** @type {any} */ ("leaf");
      for (let index = 0; index < levels; index += 1) {
        value = new Map([["k", value]]);
      }

      return value;
    };

    expect(serializeSettingValue(nest(2), { maxDepth: 4 })).toEqual([["k", [["k", "leaf"]]]]);
    expect(expectThrown(nest(3), { maxDepth: 4 }).details).toMatchObject({ limit: "value-depth", max: 4 });

    const jsonDepth = (node) => (Array.isArray(node) ? 1 + Math.max(0, ...node.map(jsonDepth)) : 0);
    expect(jsonDepth(serializeSettingValue(nest(2), { maxDepth: 4 }))).toBe(4);

    const deepestMapChain = SETTING_VALUE_MAX_DEPTH / 2;
    expect(Number.isInteger(deepestMapChain)).toBe(true);
    expect(jsonDepth(serializeSettingValue(nest(deepestMapChain)))).toBe(SETTING_VALUE_MAX_DEPTH);
    expect(expectThrown(nest(deepestMapChain + 1)).details).toMatchObject({
      limit: "value-depth",
      max: SETTING_VALUE_MAX_DEPTH
    });
  });

  it("counts a Map's SYNTHESIZED pair layer in the NODE bound too", () => {
    const pairs = new Map(
      /** @type {any[]} */ ([
        ["a", 1],
        ["b", 2],
        ["c", 3]
      ])
    );

    expect(serializeSettingValue(pairs, { maxNodes: 10 })).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3]
    ]);
    expect(expectThrown(pairs, { maxNodes: 9 }).details).toMatchObject({ limit: "value-nodes", max: 9 });

    expect(expectThrown(pairs, { maxNodes: 7 }).details.path).toBe("$[2]");

    expect(serializeSettingValue(new Set(["a", "b", "c"]), { maxNodes: 4 })).toEqual(["a", "b", "c"]);
    expect(expectThrown(new Set(["a", "b", "c"]), { maxNodes: 3 }).details).toMatchObject({
      limit: "value-nodes"
    });
  });

  it("converts a Set to an array of its values (deduplicated by Set semantics)", () => {
    expect(serializeSettingValue(new Set(["a", "b", "a"]))).toEqual(["a", "b"]);
  });

  it("converts a Date to its ISO string, and an INVALID Date to null", () => {
    expect(serializeSettingValue(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01T00:00:00.000Z");
    expect(serializeSettingValue(new Date("not-a-date"))).toBeNull();
    expect(serializeSettingValue({ when: new Date(0) })).toEqual({ when: "1970-01-01T00:00:00.000Z" });
  });
});

describe("serializeSettingValue — boxed primitives and Foundry Color", () => {
  class ColorStub extends Number {
    get css() {
      throw new Error("Color#css must never be read by the walk");
    }

    get valid() {
      throw new Error("Color#valid must never be read by the walk");
    }

    /** @returns {string} */
    toString() {
      throw new Error("Color#toString must never be invoked by the walk");
    }

    toJSON() {
      throw new Error("Color#toJSON must never be invoked by the walk");
    }
  }

  it("reports a Color as the #rrggbb string core's own JSON persistence stores", () => {
    globalThis.foundry = { utils: { Color: ColorStub } };
    expect(serializeSettingValue(new ColorStub(0xffffff))).toBe("#ffffff");

    expect(serializeSettingValue({ strokeColor: new ColorStub(0x0000ff) })).toEqual({
      strokeColor: "#0000ff"
    });
    expect(serializeSettingValue({ fillColor: new ColorStub(0x000abc) })).toEqual({ fillColor: "#000abc" });
  });

  it('reports an INVALID Color as "" (what core persists), never as null or {}', () => {
    globalThis.foundry = { utils: { Color: ColorStub } };
    expect(serializeSettingValue(new ColorStub(Number.NaN))).toBe("");
    expect(serializeSettingValue(new ColorStub(-1))).toBe("");
    expect(serializeSettingValue(new ColorStub(0x1000000))).toBe("");
  });

  it("resolves the Color class from the GLOBAL alias too (client.mjs aliases it on both installs)", () => {
    globalThis.Color = ColorStub;
    try {
      expect(serializeSettingValue(new ColorStub(0x102030))).toBe("#102030");
    } finally {
      delete globalThis.Color;
    }
  });

  it("falls back to the NUMERIC value for a Number subclass when no Color class is resolvable", () => {
    class Boxed extends Number {}
    expect(serializeSettingValue(new Boxed(42))).toBe(42);
  });

  it("unboxes a boxed number/string/boolean to the primitive it wraps", () => {
    expect(serializeSettingValue(new Number(5))).toBe(5);
    expect(serializeSettingValue(new String("a"))).toBe("a");
    expect(serializeSettingValue(new Boolean(true))).toBe(true);
    expect(serializeSettingValue({ n: new Number(-2.5) })).toEqual({ n: -2.5 });

    expect(serializeSettingValue(new Number(Number.NaN))).toBeNull();
  });

  it("does not invoke a boxed value's own valueOf/toJSON override", () => {
    const valueOf = vi.fn(() => "hijacked");
    const toJSON = vi.fn(() => ({ hijacked: true }));
    class Evil extends Number {}
    /** @type {any} */ (Evil.prototype).valueOf = valueOf;
    /** @type {any} */ (Evil.prototype).toJSON = toJSON;
    expect(serializeSettingValue(new Evil(7))).toBe(7);
    expect(valueOf).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  it("ignores a `Color` binding that is not usable as an instanceof right-hand side", () => {
    globalThis.foundry = { utils: { Color: () => 0 } };
    expect(serializeSettingValue(new Number(3))).toBe(3);
    expect(serializeSettingValue({ a: 1 })).toEqual({ a: 1 });
  });

  it("does not let a SLOT-LESS impostor escape as a raw TypeError", () => {
    globalThis.foundry = { utils: { Color: ColorStub } };
    expect(serializeSettingValue(Object.create(Date.prototype))).toEqual({});
    expect(serializeSettingValue(Object.create(Number.prototype))).toEqual({});
    expect(serializeSettingValue(Object.create(String.prototype))).toEqual({});
    expect(serializeSettingValue(Object.create(Boolean.prototype))).toEqual({});
    expect(serializeSettingValue(Object.create(ColorStub.prototype))).toEqual({});

    expect(serializeSettingValue(Object.create(Map.prototype))).toEqual({});
    expect(serializeSettingValue(Object.create(Set.prototype))).toEqual({});

    expect(
      serializeSettingValue({ m: Object.create(Map.prototype), s: Object.create(Set.prototype) })
    ).toEqual({
      m: {},
      s: {}
    });
    class FakeMap extends Map {
      constructor() {
        super();
        return Object.create(Map.prototype);
      }
    }
    expect(serializeSettingValue(new FakeMap())).toEqual({});

    expect(serializeSettingValue(Object.create(Map.prototype), { maxBytes: 2 })).toEqual({});
    expect(expectThrown(Object.create(Map.prototype), { maxBytes: 1 }).code).toBe(
      ERROR_CODES.PAYLOAD_TOO_LARGE
    );
  });
});

describe("serializeSettingValue — a NORMALIZATION HOP is not an output node", () => {
  class DataModel {
    toObject(source = true) {
      return source ? /** @type {any} */ (this)._source : {};
    }
  }

  class Model extends DataModel {
    constructor(source) {
      super();
      /** @type {any} */ (this)._source = source;
    }
  }

  it("charges ONE node for a DataModel and its source object, not two", () => {
    globalThis.foundry = { abstract: { DataModel } };

    expect(serializeSettingValue(new Model({}), { maxNodes: 1 })).toEqual({});
    expect(serializeSettingValue(new Model({ a: 1 }), { maxNodes: 2 })).toEqual({ a: 1 });
    expect(expectThrown(new Model({ a: 1 }), { maxNodes: 1 }).details).toMatchObject({
      limit: "value-nodes"
    });

    const stacked = new Set([new Model({}), new Model({}), new Model({})]);
    expect(serializeSettingValue(stacked, { maxNodes: 4 })).toEqual([{}, {}, {}]);
    expect(expectThrown(stacked, { maxNodes: 3 }).details).toMatchObject({ limit: "value-nodes" });

    expect(serializeSettingValue(new Model({}), { maxBytes: 2 })).toEqual({});
    expect(expectThrown(new Model({}), { maxBytes: 1 }).details).toMatchObject({ limit: "value-bytes" });
    expect(serializeSettingValue({ a: new Model({ b: { c: 1 } }) }, { maxDepth: 3 })).toEqual({
      a: { b: { c: 1 } }
    });
    expect(serializeSettingValue({ a: { b: { c: 1 } } }, { maxDepth: 3 })).toEqual({ a: { b: { c: 1 } } });
    expect(expectThrown({ a: new Model({ b: { c: 1 } }) }, { maxDepth: 2 }).details).toMatchObject({
      limit: "value-depth"
    });
  });

  it("charges ONE node for a boxed primitive too", () => {
    expect(serializeSettingValue(new Number(5), { maxNodes: 1 })).toBe(5);
    expect(serializeSettingValue(new String("a"), { maxNodes: 1 })).toBe("a");
    expect(serializeSettingValue([new Number(1), new Number(2)], { maxNodes: 3 })).toEqual([1, 2]);
    expect(expectThrown([new Number(1), new Number(2)], { maxNodes: 2 }).details).toMatchObject({
      limit: "value-nodes"
    });

    expect(serializeSettingValue(new Number(5), { maxBytes: 1 })).toBe(5);
  });

  it("bounds a CHAIN of wrapper hops by DEPTH — a named refusal, never a RangeError", () => {
    globalThis.foundry = { abstract: { DataModel } };

    const chain = (length) => {
      let value = /** @type {any} */ (new Model({ leaf: 1 }));
      for (let index = 0; index < length; index += 1) {
        value = new Model(value);
      }

      return value;
    };

    expect(serializeSettingValue(chain(0))).toEqual({ leaf: 1 });
    expect(serializeSettingValue(chain(3))).toEqual({ leaf: 1 });
    expect(serializeSettingValue(chain(SETTING_VALUE_MAX_DEPTH - 1))).toEqual({ leaf: 1 });

    const overCap = expectThrown(chain(SETTING_VALUE_MAX_DEPTH));
    expect(overCap.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(overCap.details).toMatchObject({ limit: "value-depth", max: SETTING_VALUE_MAX_DEPTH, path: "$" });

    const deep = expectThrown(chain(10_000));
    expect(deep.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(deep.details).toMatchObject({ limit: "value-depth" });

    expect(expectThrown({ a: { b: chain(40) } }).details).toMatchObject({
      limit: "value-depth",
      path: "$.a.b"
    });

    const cyclic = new Model(null);
    /** @type {any} */ (cyclic)._source = cyclic;
    expect(expectThrown(cyclic).details).toMatchObject({ reason: "circular-reference", path: "$" });
  });
});

describe("serializeSettingValue — bounds are enforced DURING the walk", () => {
  it("refuses a value deeper than the depth limit with PAYLOAD_TOO_LARGE", () => {
    let deep = /** @type {any} */ ("leaf");
    for (let index = 0; index < 5; index += 1) {
      deep = { child: deep };
    }

    const error = expectThrown(deep, { maxDepth: 3 });
    expect(error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(error.details).toMatchObject({ limit: "value-depth", max: 3 });
    expect(error.details.path).toContain("child");

    expect(serializeSettingValue({ a: { b: { c: 1 } } }, { maxDepth: 3 })).toEqual({ a: { b: { c: 1 } } });
  });

  it("refuses a value with more nodes than the node limit", () => {
    const error = expectThrown({ a: 1, b: 2, c: 3, d: 4 }, { maxNodes: 3 });
    expect(error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(error.details).toMatchObject({ limit: "value-nodes", max: 3 });
  });

  it("refuses an over-cap value by BYTES before building the whole body", () => {
    const error = expectThrown({ blob: "x".repeat(200) }, { maxBytes: 64 });
    expect(error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(error.details).toMatchObject({ limit: "value-bytes", max: 64 });
  });

  it("reports the OVER-CAP PREFIX, never a later sibling's own refusal — the bound is INCREMENTAL", () => {
    const error = expectThrown({ blob: "x".repeat(1000), tail: 1n }, { maxBytes: 64 });
    expect(error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(error.details).toMatchObject({ limit: "value-bytes", path: "$.blob", max: 64 });

    expect(expectThrown({ blob: "x".repeat(1000), tail: 1n }).details).toMatchObject({
      reason: "bigint",
      path: "$.tail"
    });
  });

  it("lets the ACCESSOR refusal PRE-EMPT the byte and node bounds — guard order is contract", () => {
    const bigFirst = { big: "x".repeat(1000) };
    Object.defineProperty(bigFirst, "acc", { get: () => 1, enumerable: true, configurable: true });
    expect(expectThrown(bigFirst, { maxBytes: 50 }).details).toMatchObject({
      reason: "accessor-property",
      path: "$.acc"
    });

    const accFirst = {};
    Object.defineProperty(accFirst, "acc", { get: () => 1, enumerable: true, configurable: true });
    accFirst.big = "x".repeat(1000);
    expect(expectThrown(accFirst, { maxBytes: 50 }).details).toMatchObject({
      reason: "accessor-property",
      path: "$.acc"
    });

    const nodeBound = { a: 1, b: 2 };
    Object.defineProperty(nodeBound, "acc", { get: () => 1, enumerable: true, configurable: true });
    expect(expectThrown(nodeBound, { maxNodes: 2 }).code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
    expect(expectThrown(nodeBound, { maxNodes: 2 }).details).toMatchObject({
      reason: "accessor-property",
      path: "$.acc"
    });

    expect(expectThrown({ a: 1, b: 2 }, { maxNodes: 2 }).details).toMatchObject({ limit: "value-nodes" });
  });

  it("charges the object's OWN braces BEFORE the accessor scan (the one documented exception)", () => {
    const accessorOnly = {};
    Object.defineProperty(accessorOnly, "acc", { get: () => 1, enumerable: true, configurable: true });
    expect(expectThrown(accessorOnly, { maxBytes: 1 }).details).toMatchObject({
      limit: "value-bytes",
      path: "$",
      max: 1
    });
    expect(expectThrown(accessorOnly, { maxBytes: 2 }).details).toMatchObject({
      reason: "accessor-property",
      path: "$.acc"
    });
  });

  it("lets the ARRAY accessor refusal pre-empt the byte bound too, wherever the accessor sits", () => {
    const bigFirst = ["x".repeat(1000), 0];
    Object.defineProperty(bigFirst, 1, { get: () => 1, enumerable: true, configurable: true });
    expect(expectThrown(bigFirst, { maxBytes: 50 }).details).toMatchObject({
      reason: "accessor-property",
      path: "$[1]"
    });

    const accFirst = [0, "x".repeat(1000)];
    Object.defineProperty(accFirst, 0, { get: () => 1, enumerable: true, configurable: true });
    expect(expectThrown(accFirst, { maxBytes: 50 }).details).toMatchObject({
      reason: "accessor-property",
      path: "$[0]"
    });

    const nodeBound = [1, 2];
    Object.defineProperty(nodeBound, 1, { get: () => 1, enumerable: true, configurable: true });
    expect(expectThrown(nodeBound, { maxNodes: 2 }).details).toMatchObject({
      reason: "accessor-property",
      path: "$[1]"
    });
    expect(expectThrown([1, 2], { maxNodes: 2 }).details).toMatchObject({ limit: "value-nodes" });

    const accessorOnly = [0];
    Object.defineProperty(accessorOnly, 0, { get: () => 1, enumerable: true, configurable: true });
    expect(expectThrown(accessorOnly, { maxBytes: 1 }).details).toMatchObject({
      limit: "value-bytes",
      path: "$"
    });
    expect(expectThrown(accessorOnly, { maxBytes: 2 }).details).toMatchObject({
      reason: "accessor-property"
    });
  });

  it("the array accessor scan is BOUNDED by own names, so a huge SPARSE array still terminates", () => {
    const started = Date.now();
    expect(expectThrown(new Array(1_000_000_000)).details).toMatchObject({ limit: "value-nodes" });
    expect(Date.now() - started).toBeLessThan(5_000);

    const sparse = new Array(1_000_000_000);
    Object.defineProperty(sparse, 999_999_999, { get: () => 1, configurable: true });
    expect(expectThrown(sparse).details).toMatchObject({
      reason: "accessor-property",
      path: "$[999999999]"
    });
  });

  it("the array accessor scan is BOUNDED for a SHORT array too, so a repeated one cannot spin", () => {
    const metadataArray = [];
    for (let index = 0; index < 5_000; index += 1) {
      metadataArray[`meta${index}`] = index;
    }

    const repeated = new Array(19_000).fill(metadataArray);
    const started = Date.now();
    const walked = /** @type {unknown[]} */ (serializeSettingValue(repeated));
    expect(Date.now() - started).toBeLessThan(5_000);

    expect(walked).toHaveLength(19_000);
    expect(walked[0]).toEqual([]);
    expect(walked[18_999]).toEqual([]);

    const shortHostile = [1, 2, 3];
    Object.defineProperty(shortHostile, 2, { get: () => 1, configurable: true });
    for (let index = 0; index < 1_000; index += 1) {
      shortHostile[`meta${index}`] = index;
    }

    expect(expectThrown(shortHostile).details).toMatchObject({
      reason: "accessor-property",
      path: "$[2]"
    });
  });

  it("charges the REAL JSON encoding of a string, escapes included (the cap is not a floor)", () => {
    for (const character of ['"', "\\", "\n", "\u0001"]) {
      const value = character.repeat(250_000);
      expect(expectThrown(value).details).toMatchObject({ limit: "value-bytes", path: "$" });
    }

    expect(serializeSettingValue("y".repeat(SETTING_VALUE_MAX_BYTES - 2))).toHaveLength(
      SETTING_VALUE_MAX_BYTES - 2
    );
    expect(expectThrown("y".repeat(SETTING_VALUE_MAX_BYTES - 1)).details).toMatchObject({
      limit: "value-bytes"
    });

    expect(expectThrown('"'.repeat(SETTING_VALUE_MAX_BYTES / 2)).details).toMatchObject({
      limit: "value-bytes"
    });

    const escapedKey = { 'a"b': 1 };
    expect(expectThrown(escapedKey, { maxBytes: 9 }).details).toMatchObject({ limit: "value-bytes" });
    expect(serializeSettingValue(escapedKey, { maxBytes: 10 })).toEqual(escapedKey);
  });

  it("charges every STRUCTURAL byte too, so the bound is exact for EACH collection kind", () => {
    /** @type {[string, any][]} */
    const cases = [
      ["array", [1, 22, 333, 4444]],
      ["object", { a: 1, bb: 22, ccc: 333 }],
      [
        "Map",
        new Map(
          /** @type {any[]} */ ([
            ["a", 1],
            ["bb", 22],
            ["ccc", 333]
          ])
        )
      ],
      ["Set", new Set([1, 22, 333, 4444])],
      [
        "Map of collections",
        new Map(
          /** @type {any[]} */ ([
            ["s", new Set(["x", "y"])],
            ["a", [1, 2, 3]]
          ])
        )
      ]
    ];
    for (const [label, value] of cases) {
      const walked = serializeSettingValue(value);
      const exact = utf8ByteLength(JSON.stringify(walked));
      expect(serializeSettingValue(value, { maxBytes: exact }), label).toEqual(walked);
      expect(expectThrown(value, { maxBytes: exact - 1 }).details, label).toMatchObject({
        limit: "value-bytes",
        max: exact - 1
      });
    }
  });

  it("pins the escape table by EXECUTION against JSON.stringify, not by derivation", () => {
    const mismatches = [];
    for (let code = 0; code <= 0xffff; code += 1) {
      const text = String.fromCharCode(code);
      if (jsonStringByteLength(text) !== utf8ByteLength(JSON.stringify(text))) {
        mismatches.push(code);
      }
    }

    expect(mismatches).toEqual([]);

    for (const text of [
      "",
      "plain",
      'a"b',
      "Настройка",
      String.fromCodePoint(0x1f600),

      "\ud83d",
      "\udc00",
      "a\ud83d",
      "\ud83dz"
    ]) {
      expect(jsonStringByteLength(text)).toBe(utf8ByteLength(JSON.stringify(text)));
    }
  });

  it("charges multi-byte characters by their UTF-8 length, not their JS length", () => {
    const cyrillic = "Настройка".repeat(4);
    expect(cyrillic.length).toBe(36);
    expect(utf8ByteLength(cyrillic)).toBe(72);
    const error = expectThrown(cyrillic, { maxBytes: 50 });
    expect(error.details).toMatchObject({ limit: "value-bytes" });
    expect(serializeSettingValue(cyrillic, { maxBytes: 80 })).toBe(cyrillic);
  });

  it("cuts off a CYCLIC value even if cycle detection were removed (the bounds are the backstop)", () => {
    const cyclic = /** @type {any} */ ({});
    cyclic.self = cyclic;
    const error = expectThrown(cyclic, { maxDepth: 4 });
    expect(error.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
    expect(error.details.reason).toBe("circular-reference");
  });

  it("uses the protocol constants when no limits are passed", () => {
    expect(SETTING_VALUE_MAX_DEPTH).toBe(32);
    expect(SETTING_VALUE_MAX_NODES).toBe(20_000);
    expect(SETTING_VALUE_MAX_BYTES).toBe(256 * 1024);

    const error = expectThrown({ blob: "y".repeat(SETTING_VALUE_MAX_BYTES + 1) });
    expect(error.details).toMatchObject({ limit: "value-bytes", max: SETTING_VALUE_MAX_BYTES });

    let deep = /** @type {any} */ ("leaf");
    for (let index = 0; index < SETTING_VALUE_MAX_DEPTH + 1; index += 1) {
      deep = { child: deep };
    }

    expect(expectThrown(deep).details).toMatchObject({ limit: "value-depth", max: SETTING_VALUE_MAX_DEPTH });
  });
});

describe("serializeSettingValue — the diagnostic PATH is bounded", () => {
  const PATH_CAP = 1024;

  function hasLoneSurrogate(text) {
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
        if (next < 0xdc00 || next > 0xdfff) {
          return true;
        }

        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return true;
      }
    }

    return false;
  }

  it("caps an over-cap path in BOTH the message and details.path, keeping head and tail", () => {
    const bigKey = `${"k".repeat(2000)}`;
    const error = expectThrown({ nested: { [bigKey]: 1n } });
    expect(error.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
    expect(error.details.reason).toBe("bigint");
    expect(error.details.path.length).toBe(PATH_CAP);

    expect(error.details.path.startsWith("$.nested.kkkk")).toBe(true);
    expect(error.details.path).toContain("…");

    expect(error.message).toContain(error.details.path);
    expect(error.message.length).toBeLessThan(PATH_CAP + 300);
  });

  it("keeps the FAILING LEAF in the tail, which a head-only cut would discard", () => {
    const error = expectThrown({ [`${"z".repeat(2000)}`]: { leaf: 1n } });
    expect(error.details.reason).toBe("bigint");
    expect(error.details.path.length).toBe(PATH_CAP);
    expect(error.details.path.endsWith(".leaf")).toBe(true);
  });

  it("bounds the ACCESSOR path, which no byte/node/depth budget touches at all", () => {
    const hostile = {};
    Object.defineProperty(hostile, "a".repeat(4000), {
      get: () => 1,
      enumerable: true,
      configurable: true
    });
    const error = expectThrown(hostile);
    expect(error.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
    expect(error.details.reason).toBe("accessor-property");
    expect(error.details.path.length).toBe(PATH_CAP);

    expect(SETTING_VALUE_MAX_BYTES).toBeGreaterThan(4000);
  });

  it("bounds an over-cap PAYLOAD_TOO_LARGE path too, and keeps details.limit/max readable", () => {
    const error = expectThrown({ [`${"q".repeat(3000)}`]: 1 }, { maxBytes: 100 });
    expect(error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(error.details).toMatchObject({ limit: "value-bytes", max: 100 });
    expect(error.details.path.length).toBe(PATH_CAP);
  });

  it("leaves a LEGITIMATELY long path untouched — the cap must not corrupt an ordinary diagnostic", () => {
    const key = "setting-subfield-name".repeat(4);
    let value = /** @type {any} */ (1n);
    for (let index = 0; index < 10; index += 1) {
      value = { [`${key}${index}`]: value };
    }

    const error = expectThrown(value);
    expect(error.details.reason).toBe("bigint");
    expect(error.details.path.length).toBeGreaterThan(800);
    expect(error.details.path.length).toBeLessThanOrEqual(PATH_CAP);
    expect(error.details.path).not.toContain("…");

    expect(error.details.path).toBe(
      `$.${key}9.${key}8.${key}7.${key}6.${key}5.${key}4.${key}3.${key}2.${key}1.${key}0`
    );
  });

  it("never cuts through a surrogate pair, on either side of the ellipsis", () => {
    for (const filler of ["", "a", "ab", "abc"]) {
      const key = `${filler}${"😀".repeat(2000)}`;
      const error = expectThrown({ [key]: 1n });
      expect(error.details.reason).toBe("bigint");
      expect(error.details.path.length).toBeLessThanOrEqual(PATH_CAP);
      expect(hasLoneSurrogate(error.details.path)).toBe(false);
      expect(hasLoneSurrogate(error.message)).toBe(false);
    }
  });
});

describe("utf8ByteLength", () => {
  it.each([
    ["", 0],
    ["abc", 3],
    ["é", 2],
    ["Настройка", 18],
    ["日本語", 9],
    ["😀", 4],
    ["\ud800", 3]
  ])("measures %j as %i bytes", (text, bytes) => {
    expect(utf8ByteLength(text)).toBe(bytes);
    if (text !== "\ud800") {
      expect(utf8ByteLength(text)).toBe(new TextEncoder().encode(text).length);
    }
  });
});
