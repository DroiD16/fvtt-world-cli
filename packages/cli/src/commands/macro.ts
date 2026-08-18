import {
  createMacroCloneParams,
  createMacroCreateParams,
  createMacroUpdateParams,
  resolveMacroCommandBody
} from "../params.js";
import { executeRemoteCommand } from "../exec.js";
import { parseIdList } from "../parse.js";
import { addMacroFieldOptions } from "./field-options.js";
import {
  type RegistrationContext,
  createSharedRegistrars,
  addIdempotencyKeyOption,
  addNameFilterOption,
  addPaginationOptions,
  nameFilterParams,
  paginationParams
} from "./shared.js";
import { write } from "../deps.js";

export function registerMacro({ program, dependencies }: RegistrationContext) {
  const { registerOwnershipSet, registerCompendiumImport } = createSharedRegistrars(dependencies);
  const macro = program.command("macro").description("Foundry macro commands");
  macro.addHelpText(
    "after",
    "\nResult key (--json): .result.macro (single/write) / .result.macros[] (list, get-many)."
  );
  registerOwnershipSet(macro, {
    idFlag: "--macro-id <macroId>",
    idKey: "macroId",
    commandName: "macro.ownership.set",
    noun: "macro"
  });
  addNameFilterOption(addPaginationOptions(macro.command("list"))).action(async function listMacros(options: {
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "macro.list",
      params: { ...nameFilterParams(options), ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  macro
    .command("get")
    .requiredOption("--macro-id <macroId>", "Macro id")
    .action(async function getMacro(options: { macroId: string }) {
      await executeRemoteCommand({
        commandName: "macro.get",
        params: { macroId: options.macroId },
        command: this,
        dependencies
      });
    });
  macro
    .command("get-many")
    .requiredOption("--ids <list>", "Comma-separated macro ids (atomic: all must exist)", parseIdList)
    .action(async function getManyMacros(options: { ids: string[] }) {
      await executeRemoteCommand({
        commandName: "macro.get-many",
        params: { ids: options.ids },
        command: this,
        dependencies
      });
    });
  addMacroFieldOptions(
    addIdempotencyKeyOption(macro.command("create")).requiredOption("--name <name>", "Macro name"),
    "create"
  )
    .option("--data-json <json>", "Extra macro fields (e.g. flags) as a JSON object (merged last)")
    .action(async function createMacroCommand(options: {
      name: string;
      type?: string;
      command?: string;
      commandFile?: string;
      commandStdin?: boolean;
      img?: string;
      folder?: string;
      clearFolder?: boolean;
      scope?: string;
      dataJson?: string;
    }) {
      const command = await resolveMacroCommandBody(options, dependencies);
      await executeRemoteCommand({
        commandName: "macro.create",
        params: createMacroCreateParams({ ...options, command }),
        command: this,
        dependencies
      });
    });
  addMacroFieldOptions(
    macro
      .command("update")
      .requiredOption("--macro-id <macroId>", "Macro id")
      .option("--name <name>", "New macro name"),
    "update"
  )
    .option("--patch-json <json>", "Extra macro patch fields (e.g. flags) as a JSON object (merged last)")
    .action(async function updateMacroCommand(options: {
      macroId: string;
      name?: string;
      type?: string;
      command?: string;
      commandFile?: string;
      commandStdin?: boolean;
      img?: string;
      folder?: string;
      clearFolder?: boolean;
      scope?: string;
      patchJson?: string;
    }) {
      const command = await resolveMacroCommandBody(options, dependencies);
      await executeRemoteCommand({
        commandName: "macro.update",
        params: createMacroUpdateParams({ ...options, command }),
        command: this,
        dependencies
      });
    });
  addMacroFieldOptions(
    addIdempotencyKeyOption(macro.command("clone"))
      .requiredOption("--macro-id <macroId>", "Source macro id")
      .option("--name <name>", "Name override for the clone"),
    "clone"
  ).action(async function cloneMacroCommand(options: {
    macroId: string;
    name?: string;
    type?: string;
    command?: string;
    commandFile?: string;
    commandStdin?: boolean;
    img?: string;
    folder?: string;
    clearFolder?: boolean;
    scope?: string;
  }) {
    const command = await resolveMacroCommandBody(options, dependencies);
    await executeRemoteCommand({
      commandName: "macro.clone",
      params: createMacroCloneParams({ ...options, command }),
      command: this,
      dependencies
    });
  });
  macro
    .command("delete")
    .requiredOption("--macro-id <macroId>", "Macro id")
    .action(async function deleteMacro(options: { macroId: string }) {
      await executeRemoteCommand({
        commandName: "macro.delete",
        params: { macroId: options.macroId },
        command: this,
        dependencies
      });
    });

  registerCompendiumImport(macro, {
    commandName: "macro.import-from-compendium",
    noun: "macro",
    packExample: "mymodule.macros"
  });
}
