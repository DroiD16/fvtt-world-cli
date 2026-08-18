import { Command, CommanderError } from "commander";

import type { RegistrationContext } from "./shared.js";
import { runExecBatch } from "../exec.js";

export function registerExec({ program, dependencies }: RegistrationContext) {
  program
    .command("exec")
    .description(
      "Execute a batch of NDJSON command requests from stdin over one persistent daemon connection"
    )
    .option("--stdin", "Read newline-delimited JSON requests from stdin (required)")
    .option(
      "--stop-on-error",
      "Abort the batch after the first failing request (its failure line is still emitted)"
    )
    .action(async function execBatch(this: Command, options: { stdin?: boolean; stopOnError?: boolean }) {
      if (!options.stdin) {
        throw new CommanderError(
          1,
          "fvtt-world-cli.execRequiresStdin",
          "exec currently supports only NDJSON batch mode: pass --stdin and pipe one JSON request per line."
        );
      }
      await runExecBatch({ command: this, dependencies });
    });
}
