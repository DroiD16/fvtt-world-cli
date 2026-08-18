import { executeRemoteCommand } from "../exec.js";
import { parseCompendiumFieldsList, parseCompendiumIncludeFields } from "../parse.js";
import {
  type RegistrationContext,
  addNameFilterOption,
  addPaginationOptions,
  nameFilterParams,
  paginationParams
} from "./shared.js";

export function registerCompendium({ program, dependencies }: RegistrationContext) {
  const compendium = program.command("compendium").description("Foundry compendium pack commands (read)");
  compendium.addHelpText(
    "after",
    "\nResult key (--json): .result.packs[] (list), .result.entries[] (index), .result.document (get — Foundry's raw source object)."
  );
  addPaginationOptions(compendium.command("list")).action(async function listCompendiums(options: {
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "compendium.list",
      params: paginationParams(options),
      command: this,
      dependencies
    });
  });
  addNameFilterOption(
    addPaginationOptions(compendium.command("index").requiredOption("--pack <pack>", "Compendium pack id"))
  )
    .option("--exact", "Match the --name filter as a case-insensitive full-string equality (not substring)")
    .option(
      "--fields <list>",
      "Comma-separated extra index dot-paths to include (via pack.getIndex({fields})), returned at their paths",
      parseCompendiumFieldsList
    )
    .action(async function indexCompendium(options: {
      pack: string;
      name?: string;
      exact?: boolean;
      fields?: string[];
      limit?: number;
      offset?: number;
    }) {
      await executeRemoteCommand({
        commandName: "compendium.index",
        params: {
          pack: options.pack,
          ...nameFilterParams(options),
          ...(options.exact ? { exact: true } : {}),
          ...(options.fields && options.fields.length ? { fields: options.fields } : {}),
          ...paginationParams(options)
        },
        command: this,
        dependencies
      });
    });
  compendium
    .command("get")
    .requiredOption("--pack <pack>", "Compendium pack id")
    .requiredOption("--entry-id <entryId>", "Compendium entry id")
    .option(
      "--include <fields>",
      "Comma-separated extra fields to include (allowed: effects)",
      parseCompendiumIncludeFields
    )
    .action(async function getCompendiumEntry(options: {
      pack: string;
      entryId: string;
      include?: string[];
    }) {
      await executeRemoteCommand({
        commandName: "compendium.get",
        params: {
          pack: options.pack,
          entryId: options.entryId,
          ...(options.include ? { include: options.include } : {})
        },
        command: this,
        dependencies
      });
    });
}
