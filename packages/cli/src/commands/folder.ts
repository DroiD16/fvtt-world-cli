import {
  createFolderCreateParams,
  createFolderDeleteParams,
  createFolderUpdateParams,
  type FolderFieldOptions
} from "../params.js";
import { executeRemoteCommand } from "../exec.js";
import { addFolderFieldOptions } from "./field-options.js";
import {
  type RegistrationContext,
  addIdempotencyKeyOption,
  addNameFilterOption,
  addPaginationOptions,
  nameFilterParams,
  paginationParams
} from "./shared.js";

export function registerFolder({ program, dependencies }: RegistrationContext) {
  const folder = program.command("folder").description("Foundry folder commands");
  folder.addHelpText(
    "after",
    "\nResult key (--json): .result.folder (get/create/update) / .result.folders[] (list). Rows carry both id and _id (Folder is a document). folder delete returns .result.folders/.result.contents (deleted/reparented counts + capped ids), .result.counts, .result.complete, .result.deleted; on a partial commit (.result.complete === false) the folder row is removed last, so the folder itself may survive (.result.deleted === false), the .result.*.deleted lists hold only ids observed gone, and any planned deletion still present surfaces under .result.remaining (folders/contents)."
  );
  addNameFilterOption(
    addPaginationOptions(
      folder
        .command("list")
        .option("--type <type>", "Filter by document type (e.g. Actor, Item, Scene, JournalEntry)")
    )
  ).action(async function listFolders(options: {
    type?: string;
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "folder.list",
      params: {
        ...(options.type ? { type: options.type } : {}),
        ...nameFilterParams(options),
        ...paginationParams(options)
      },
      command: this,
      dependencies
    });
  });
  folder
    .command("get")
    .requiredOption("--folder-id <folderId>", "Folder id")
    .action(async function getFolderCommand(options: { folderId: string }) {
      await executeRemoteCommand({
        commandName: "folder.get",
        params: { folderId: options.folderId },
        command: this,
        dependencies
      });
    });
  addFolderFieldOptions(
    addIdempotencyKeyOption(folder.command("create"))
      .requiredOption("--name <name>", "Folder name")
      .requiredOption("--type <type>", "Document type the folder holds (e.g. Actor)"),
    "create"
  )
    .option("--data-json <json>", "Extra folder fields (e.g. flags) as a JSON object (merged last)")
    .action(async function createFolderCommand(
      options: FolderFieldOptions & {
        name: string;
        type: string;
        dataJson?: string;
      }
    ) {
      await executeRemoteCommand({
        commandName: "folder.create",
        params: createFolderCreateParams(options),
        command: this,
        dependencies
      });
    });
  addFolderFieldOptions(
    folder
      .command("update")
      .requiredOption("--folder-id <folderId>", "Folder id")
      .option("--name <name>", "New folder name"),
    "update"
  )
    .option("--patch-json <json>", "Extra folder patch fields (e.g. flags) as a JSON object (merged last)")
    .action(async function updateFolderCommand(
      options: FolderFieldOptions & {
        folderId: string;
        name?: string;
        patchJson?: string;
      }
    ) {
      await executeRemoteCommand({
        commandName: "folder.update",
        params: createFolderUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(folder.command("delete"))
    .requiredOption("--folder-id <folderId>", "Folder id")
    .option(
      "--delete-subfolders",
      "Delete descendant folders too (default: re-parent them to this folder's parent)"
    )
    .option(
      "--delete-contents",
      "Delete the documents in the folder too (requires --force; forbidden for Cards folders). Default: re-parent them to this folder's parent"
    )
    .option(
      "--force",
      "Required with --delete-contents; bypasses per-family delete guards (token-used actors, active scene)"
    )
    .action(async function deleteFolderCommand(options: {
      folderId: string;
      deleteSubfolders?: boolean;
      deleteContents?: boolean;
      force?: boolean;
    }) {
      await executeRemoteCommand({
        commandName: "folder.delete",
        params: createFolderDeleteParams(options),
        command: this,
        dependencies
      });
    });
}
