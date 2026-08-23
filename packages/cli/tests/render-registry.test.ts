import { COMMAND_NAMES, DISCOVERABLE_COMMAND_NAMES } from "@fvtt-world-cli/protocol";
import { describe, expect, it } from "vitest";

import { humanizeCommandResult, RENDERERS, registerRenderers } from "../src/render/registry.js";

const INTENTIONAL_FALLBACK_JSON: readonly string[] = COMMAND_NAMES.filter(
  (name) => !DISCOVERABLE_COMMAND_NAMES.includes(name)
);

describe("human-output renderer registry", () => {
  it("registers a renderer for every advertised command and none for internal plumbing", () => {
    const expected = COMMAND_NAMES.filter((name) => !INTENTIONAL_FALLBACK_JSON.includes(name)).sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(INTENTIONAL_FALLBACK_JSON.length).toBeGreaterThan(0);
    expect(Object.keys(RENDERERS).sort()).toEqual(expected);
  });

  it("registers no name outside the protocol command set", () => {
    const names = new Set<string>(COMMAND_NAMES);
    expect(Object.keys(RENDERERS).filter((command) => !names.has(command))).toEqual([]);
  });

  it("never both registers a renderer and claims a JSON fallback for the same command", () => {
    expect(INTENTIONAL_FALLBACK_JSON.filter((command) => command in RENDERERS)).toEqual([]);
  });

  it("falls back to pretty JSON for a command with no registered renderer", () => {
    const result = { a: 1, b: ["c"] };
    const unregistered = [
      "not.a.command",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "constructor",
      "__proto__",
      ...INTENTIONAL_FALLBACK_JSON
    ];
    for (const command of unregistered) {
      expect(humanizeCommandResult(command, result)).toBe(JSON.stringify(result, null, 2));
    }
  });

  it("refuses a duplicate registration instead of silently overwriting it", () => {
    const first = () => "first";
    const second = () => "second";
    expect(() => registerRenderers([[["scene.get", first]], [["scene.get", second]]])).toThrow(
      /duplicate human-output renderer registered for scene\.get/
    );
    expect(registerRenderers([[["scene.get", first]]])["scene.get"]({}, 0)).toBe("first");
  });

  it("refuses a duplicate registration for a name inherited from Object.prototype", () => {
    const first = () => "first";
    const second = () => "second";
    expect(() => registerRenderers([[["__proto__", first]], [["__proto__", second]]])).toThrow(
      /duplicate human-output renderer registered for __proto__/
    );
    expect(registerRenderers([[["__proto__", first]]])["__proto__"]({}, 0)).toBe("first");
  });
});
