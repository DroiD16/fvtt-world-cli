import { InvalidArgumentError } from "commander";
import { describe, expect, it } from "vitest";

import {
  booleanField,
  folderField,
  jsonArrayField,
  jsonObjectField,
  numberField,
  optionalJsonObject,
  optionalPatch,
  stringField,
  truthyStringField
} from "../src/params.js";

describe("stringField (presence guard)", () => {
  it("omits the key when the value is undefined", () => {
    expect(stringField("name", undefined)).toEqual({});
  });

  it('keeps an explicit empty string so --name "" survives to the protocol', () => {
    expect(stringField("name", "")).toEqual({ name: "" });
  });

  it("keeps a non-empty value", () => {
    expect(stringField("img", "x.png")).toEqual({ img: "x.png" });
  });
});

describe("truthyStringField (truthiness guard)", () => {
  it("omits the key when the value is undefined", () => {
    expect(truthyStringField("folder", undefined)).toEqual({});
  });

  it("DROPS an explicit empty string (truthiness, not presence)", () => {
    expect(truthyStringField("folder", "")).toEqual({});
  });

  it("keeps a non-empty value", () => {
    expect(truthyStringField("path", "music/song.ogg")).toEqual({ path: "music/song.ogg" });
  });
});

describe("numberField (typeof number guard)", () => {
  it("omits the key when undefined", () => {
    expect(numberField("sort", undefined)).toEqual({});
  });

  it("keeps 0 (a valid number, not falsy-dropped)", () => {
    expect(numberField("sort", 0)).toEqual({ sort: 0 });
  });

  it("keeps a negative value (Foundry coords can be negative)", () => {
    expect(numberField("x", -5)).toEqual({ x: -5 });
  });
});

describe("booleanField (typeof boolean guard)", () => {
  it("omits the key when undefined", () => {
    expect(booleanField("hidden", undefined)).toEqual({});
  });

  it("keeps false (a valid boolean, not falsy-dropped)", () => {
    expect(booleanField("hidden", false)).toEqual({ hidden: false });
  });

  it("keeps true", () => {
    expect(booleanField("active", true)).toEqual({ active: true });
  });
});

describe("folderField (--clear-folder / --folder ternary)", () => {
  it("clears to null when clearFolder is set (clear wins over folder)", () => {
    expect(folderField({ clearFolder: true, folder: "f1" })).toEqual({ folder: null });
  });

  it("sets a truthy folder when clearFolder is absent", () => {
    expect(folderField({ folder: "f1" })).toEqual({ folder: "f1" });
  });

  it("omits when folder is an empty string (truthiness preserved)", () => {
    expect(folderField({ folder: "" })).toEqual({});
  });

  it("omits when nothing is supplied", () => {
    expect(folderField({})).toEqual({});
  });
});

describe("jsonObjectField (truthiness-guarded object parse)", () => {
  it("omits and does NOT throw on an absent flag", () => {
    expect(jsonObjectField("system", undefined, "--system-json")).toEqual({});
  });

  it("omits and does NOT throw on an empty string", () => {
    expect(jsonObjectField("system", "", "--system-json")).toEqual({});
  });

  it("parses a JSON object into the key", () => {
    expect(jsonObjectField("system", '{"hp":7}', "--system-json")).toEqual({ system: { hp: 7 } });
  });

  it("throws an InvalidArgumentError carrying the verbatim label on malformed JSON", () => {
    expect(() => jsonObjectField("system", "{bad", "--system-json")).toThrow(InvalidArgumentError);
    expect(() => jsonObjectField("system", "{bad", "--system-json")).toThrow(
      /--system-json must be valid JSON for an object/
    );
  });
});

describe("jsonArrayField (truthiness-guarded array parse)", () => {
  it("omits and does NOT throw on an absent flag", () => {
    expect(jsonArrayField("pages", undefined, "--pages-json")).toEqual({});
  });

  it("parses a JSON array of objects into the key", () => {
    expect(jsonArrayField("pages", '[{"name":"P1"}]', "--pages-json")).toEqual({
      pages: [{ name: "P1" }]
    });
  });

  it("throws with the verbatim label when the value is not an array of objects", () => {
    expect(() => jsonArrayField("pages", "{}", "--pages-json")).toThrow(
      /--pages-json must be valid JSON for an array of objects/
    );
  });
});

describe("optionalJsonObject (spread variant returns undefined, not {})", () => {
  it("returns undefined when absent so a caller's ...(json ?? {}) is a no-op", () => {
    expect(optionalJsonObject(undefined, "--data-json")).toBeUndefined();
  });

  it("returns undefined on an empty string", () => {
    expect(optionalJsonObject("", "--data-json")).toBeUndefined();
  });

  it("returns the parsed object to be spread", () => {
    expect(optionalJsonObject('{"x":1}', "--data-json")).toEqual({ x: 1 });
  });
});

describe("optionalPatch (omit empty patch, never throw)", () => {
  it("omits the patch entirely when empty (cloning with no overrides is valid)", () => {
    expect(optionalPatch({})).toEqual({});
  });

  it("wraps a non-empty patch", () => {
    expect(optionalPatch({ name: "X" })).toEqual({ patch: { name: "X" } });
  });
});
