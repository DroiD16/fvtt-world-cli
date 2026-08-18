import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Argument, Command, Option } from "commander";
import { describe, expect, it } from "vitest";

import { createProgram } from "../src/index.js";

const FIXTURE_PATH = fileURLToPath(new URL("./fixtures/option-graph.txt", import.meta.url));

const FIXTURE_HEADER = [
  "# Declared CLI option graph: every command path with its arguments, flags, help text,",
  "# argument parsers, conflicts, defaults and required/hidden state.",
  "#",
  "# Shared field tables (packages/cli/src/commands/field-options.ts) feed several verbs and",
  "# families from one spec, and the argv-mapping tests only observe flags an argv actually",
  "# uses. This fixture is the detector for a flag that is dropped, renamed, reworded, or has",
  "# its parser, conflict or default silently changed.",
  "#",
  "# Regenerate after an intentional change:",
  "#   UPDATE_OPTION_GRAPH=1 npx vitest run packages/cli/tests/option-graph.test.ts",
  "# then review the diff as a user-visible help change."
].join("\n");

function describeCallable(value: unknown): string {
  if (typeof value !== "function") {
    return "-";
  }
  return value.name || "<anonymous>";
}

function describeValue(value: unknown): string {
  if (value === undefined) {
    return "-";
  }
  return JSON.stringify(value) ?? "-";
}

function escapeText(value: string | undefined): string {
  return (value ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

function readRuntimeField(source: Argument | Option, field: "parseArg" | "conflictsWith"): unknown {
  return (source as unknown as Record<string, unknown>)[field];
}

function describeArgument(argument: Argument): string {
  return [
    `arg ${argument.name()}`,
    `required=${argument.required}`,
    `variadic=${argument.variadic}`,
    `parser=${describeCallable(readRuntimeField(argument, "parseArg"))}`,
    `choices=${describeValue(argument.argChoices)}`,
    `default=${describeValue(argument.defaultValue)}`,
    `help=${escapeText(argument.description)}`
  ].join(" | ");
}

function describeOption(option: Option): string {
  return [
    `opt ${option.flags}`,
    `parser=${describeCallable(readRuntimeField(option, "parseArg"))}`,
    `conflicts=${describeValue(readRuntimeField(option, "conflictsWith"))}`,
    `choices=${describeValue(option.argChoices)}`,
    `required=${Boolean(option.mandatory)}`,
    `hidden=${Boolean(option.hidden)}`,
    `default=${describeValue(option.defaultValue)}`,
    `help=${escapeText(option.description)}`
  ].join(" | ");
}

function serializeOptionGraph(program: Command): string {
  const lines: string[] = [];

  const walk = (command: Command, path: readonly string[]): void => {
    lines.push("");
    lines.push(`command ${path.length === 0 ? "(root)" : path.join(" ")}`);
    lines.push(`  aliases=${describeValue(command.aliases())}`);
    lines.push(`  summary=${escapeText(command.description())}`);
    for (const argument of command.registeredArguments ?? []) {
      lines.push(`  ${describeArgument(argument)}`);
    }
    for (const option of command.options) {
      lines.push(`  ${describeOption(option)}`);
    }
    for (const child of command.commands) {
      walk(child, [...path, child.name()]);
    }
  };

  walk(program, []);
  return `${FIXTURE_HEADER}\n${lines.join("\n")}\n`;
}

describe("declared CLI option graph", () => {
  it("matches the checked-in option-graph fixture", () => {
    const serialized = serializeOptionGraph(createProgram({}));

    if (process.env.UPDATE_OPTION_GRAPH === "1") {
      writeFileSync(FIXTURE_PATH, serialized);
    }

    expect(serialized).toBe(readFileSync(FIXTURE_PATH, "utf8"));
  });

  it("stays free of machine-specific paths", () => {
    const serialized = serializeOptionGraph(createProgram({}));
    const home = process.env.HOME;
    for (const forbidden of home ? [process.cwd(), home] : [process.cwd()]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
