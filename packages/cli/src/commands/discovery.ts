import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  COMMAND_DEFINITIONS,
  COMMAND_NAMES,
  getCommandDefinition,
  isKnownCommand
} from "@fvtt-world-cli/protocol";
import { Command, CommanderError, InvalidArgumentError } from "commander";

import type { RegistrationContext } from "./shared.js";
import { listDocEntries, resolveDocsDirectory } from "../docs.js";
import { localSuccessEnvelope } from "../errors.js";
import { write } from "../deps.js";

export function registerDiscovery({ program, dependencies }: RegistrationContext) {
  program
    .command("commands")
    .description("List all protocol commands and whether each mutates world state")
    .action(function listCommands() {
      const payload = COMMAND_NAMES.map((name) => ({
        command: name,
        mutation: COMMAND_DEFINITIONS[name].mutation
      }));

      if (Boolean(this.optsWithGlobals().json)) {
        write(dependencies.stdout, `${JSON.stringify(localSuccessEnvelope(payload), null, 2)}\n`);
        return;
      }

      write(
        dependencies.stdout,
        `${payload.map((entry) => `${entry.command}\t${entry.mutation ? "write" : "read"}`).join("\n")}\n`
      );
    });
  program
    .command("schema")
    .description("Print the parameter JSON schema for a protocol command")
    .argument("<command>", "Protocol command name, e.g. scene.update")
    .action(function commandSchema(commandName: string) {
      if (!isKnownCommand(commandName)) {
        throw new InvalidArgumentError(`Unknown command: ${commandName}`);
      }

      const definition = getCommandDefinition(commandName);

      const payload = {
        command: commandName,
        mutation: definition.mutation,
        paramsSchema: definition.paramsSchema
      };

      if (Boolean(this.optsWithGlobals().json)) {
        write(dependencies.stdout, `${JSON.stringify(localSuccessEnvelope(payload), null, 2)}\n`);
        return;
      }

      write(
        dependencies.stdout,
        `${[
          `command: ${payload.command}`,
          `mutation: ${payload.mutation ? "write" : "read"}`,
          "paramsSchema:",
          JSON.stringify(payload.paramsSchema, null, 2)
        ].join("\n")}\n`
      );
    });

  program
    .command("docs")
    .description("List or print the documentation shipped with the CLI")
    .argument("[name]", "Document name from the list, e.g. protocol")
    .action(function printDocs(this: Command, name?: string) {
      const docsDirectory = resolveDocsDirectory();
      if (!docsDirectory) {
        throw new CommanderError(
          1,
          "fvtt-world-cli.docsUnavailable",
          "Documentation files are not available in this installation. Use `commands --json` and `schema <command>` for runtime discovery."
        );
      }

      const entries = listDocEntries(docsDirectory);
      const json = Boolean(this.optsWithGlobals().json);

      if (!name) {
        const payload = entries.map((entry) => ({ name: entry.name, title: entry.title }));
        if (json) {
          write(dependencies.stdout, `${JSON.stringify(localSuccessEnvelope(payload), null, 2)}\n`);
          return;
        }
        write(dependencies.stdout, `${entries.map((entry) => `${entry.name}\t${entry.title}`).join("\n")}\n`);
        return;
      }

      const entry = entries.find((candidate) => candidate.name === name.toLowerCase());
      if (!entry) {
        throw new InvalidArgumentError(
          `Unknown document: ${name}. Available: ${entries.map((candidate) => candidate.name).join(", ")}`
        );
      }

      const content = readFileSync(resolve(docsDirectory, entry.file), "utf8");
      if (json) {
        write(
          dependencies.stdout,
          `${JSON.stringify(localSuccessEnvelope({ name: entry.name, title: entry.title, content }), null, 2)}\n`
        );
        return;
      }
      write(dependencies.stdout, content.endsWith("\n") ? content : `${content}\n`);
    });
}
