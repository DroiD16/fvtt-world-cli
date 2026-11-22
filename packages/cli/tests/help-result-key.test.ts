import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import { createProgram } from "../src/index.js";
import { createWritableBuffer } from "./helpers/cli-harness.js";

const LOCAL_ONLY_COMMANDS = new Set(["config", "auth", "bridge", "skill", "docs", "exec"]);

function leafCommands(command: Command, path: string[] = []): { path: string; command: Command }[] {
  return command.commands.flatMap((sub) => {
    const subPath = [...path, sub.name()];
    return sub.commands.length === 0
      ? [{ path: subPath.join(" "), command: sub }]
      : leafCommands(sub, subPath);
  });
}

function renderedHelp(command: Command) {
  let output = "";
  command.configureOutput({
    writeOut: (chunk) => {
      output += chunk;
    },
    writeErr: (chunk) => {
      output += chunk;
    }
  });
  command.outputHelp();
  return output;
}

describe("Result key help", () => {
  const program = createProgram({ stdout: createWritableBuffer(), stderr: createWritableBuffer() });
  const leaves = leafCommands(program).filter(({ path }) => !LOCAL_ONLY_COMMANDS.has(path.split(" ")[0]));

  it.each(leaves.map(({ path, command }) => [path, command] as const))(
    "names the result key in the help of %s",
    (_path, command) => {
      expect(renderedHelp(command)).toContain("Result key (--json):");
    }
  );
});
