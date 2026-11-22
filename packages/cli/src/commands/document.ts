import { Command } from "commander";

import { executeRemoteCommand, printRemoteResponse, sendRemoteCommand } from "../exec.js";
import { parseCsvList } from "../parse.js";
import type { RegistrationContext } from "./shared.js";

interface DocumentGetOptions {
  uuid: string;
  include?: string[];
}

export function registerDocument({ program, dependencies }: RegistrationContext) {
  const document = program.command("document").description("Read a document by its Foundry UUID");
  document.addHelpText(
    "after",
    "\nResult key (--json): .result.command and .result.params (resolve); get prints the result of the resolved family command."
  );

  document
    .command("resolve")
    .description("Map a UUID to its canonical form and the family get command and parameters that read it")
    .requiredOption("--uuid <uuid>", "Document UUID, such as Actor.<id> or Compendium.<pack>.<Type>.<id>")
    .action(async function resolveDocument(this: Command, options: { uuid: string }) {
      await executeRemoteCommand({
        commandName: "document.resolve",
        params: { uuid: options.uuid },
        command: this,
        dependencies
      });
    });

  document
    .command("get")
    .description("Read a document by UUID: resolve it, then run the family get command it maps to")
    .requiredOption("--uuid <uuid>", "Document UUID, such as Actor.<id> or Compendium.<pack>.<Type>.<id>")
    .option(
      "--include <fields>",
      "Comma-separated extra fields, as the resolved get command accepts them",
      (value: string) => parseCsvList(value, "--include")
    )
    .addHelpText(
      "after",
      "\nThe result, its key and its errors are those of the resolved command (document resolve --uuid shows which). A UUID of a document embedded in a compendium entry, a relative UUID, a setting, or a document type with no get command returns UNSUPPORTED_OPERATION."
    )
    .action(async function getDocument(this: Command, options: DocumentGetOptions) {
      const resolution = await sendRemoteCommand({
        commandName: "document.resolve",
        params: { uuid: options.uuid },
        command: this,
        dependencies
      });
      if (!resolution.response.ok) {
        printRemoteResponse({
          commandName: "document.resolve",
          outcome: resolution,
          command: this,
          dependencies
        });
        return;
      }
      const { command, params } = resolution.response.result as {
        command: string;
        params: Record<string, unknown>;
      };
      await executeRemoteCommand({
        commandName: command,
        params: { ...params, ...(options.include ? { include: options.include } : {}) },
        command: this,
        dependencies
      });
    });
}
