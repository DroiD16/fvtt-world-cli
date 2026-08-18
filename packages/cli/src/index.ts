import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type CliDependencies, resolveDependencies, suppressCommanderStderr } from "./deps.js";
import { planCliErrorOutput } from "./errors.js";
import { createProgram } from "./program.js";

export { IMPORT_PATCH_FLAGS } from "./commands/shared.js";
export { exitCodeForErrorCode, planCliErrorOutput, planLocalError } from "./errors.js";
export {
  booleanField,
  colorField,
  folderField,
  jsonArrayField,
  jsonObjectField,
  numberField,
  optionalJsonObject,
  optionalPatch,
  stringField,
  truthyStringField
} from "./params.js";
export { createProgram } from "./program.js";
export {
  buildSkillsAddArguments,
  inspectInstalledSkill,
  installSkillIntoRoot,
  syncInstalledSkillCopies,
  updateSkillInRoot
} from "./skill.js";

function argvWantsJson(argv: readonly string[]) {
  return argv.includes("--json");
}

export async function executeCli(argv = process.argv, partialDependencies: Partial<CliDependencies> = {}) {
  const base = resolveDependencies(partialDependencies);

  let commanderWroteStderr = false;
  const dependencies: CliDependencies = {
    ...base,
    stderr: {
      write: (chunk: string) => {
        if (typeof chunk === "string" && chunk.length > 0) {
          commanderWroteStderr = true;
        }
        base.stderr.write(chunk);
      }
    }
  };

  const program = createProgram(dependencies);

  let resolvedJsonMode = argvWantsJson(argv);
  program.hook("preAction", (_thisCommand, actionCommand) => {
    resolvedJsonMode = Boolean(actionCommand.optsWithGlobals().json);
  });

  if (resolvedJsonMode) {
    suppressCommanderStderr(program);
  }

  try {
    await program.parseAsync(argv, { from: "node" });
    return 0;
  } catch (error) {
    const { exitCode, stdout, stderr } = planCliErrorOutput(error, resolvedJsonMode, {
      commanderAlreadyPrinted: commanderWroteStderr
    });
    if (stdout) {
      dependencies.stdout.write(stdout);
    }
    if (stderr) {
      base.stderr.write(stderr);
    }

    return exitCode;
  }
}

async function main() {
  process.exitCode = await executeCli(process.argv);
}

const currentFilePath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";

if (currentFilePath === entryPath) {
  void main();
}
