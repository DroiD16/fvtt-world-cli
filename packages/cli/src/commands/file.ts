import { CommanderError, Option } from "commander";

import { createFileUploadParams } from "../params.js";
import { executeRemoteCommand } from "../exec.js";
import { getEffectiveUploadLimitBytes } from "../config-io.js";
import { parsePositiveInt } from "../parse.js";
import {
  type RegistrationContext,
  addIdempotencyKeyOption,
  addPaginationOptions,
  paginationParams
} from "./shared.js";

export function registerFile({ program, dependencies }: RegistrationContext) {
  const file = program.command("file").description("Foundry data source file commands");
  file.addHelpText(
    "after",
    "\nResult key (--json): .result.entries[] (list), .result.entry (stat), .result.content (read; also .result.file), .result.directory (mkdir), .result.file (upload/delete/move; delete also .result.deleted/.result.exists; move also .result.from)."
  );
  addPaginationOptions(
    file
      .command("list")
      .option("--path <path>", "Data-relative directory path", "")
      .option("--recursive", "Walk subdirectories depth-first (bounded by --max-depth/--max-entries)")
      .addOption(
        new Option("--max-depth <n>", "Max recursion depth (1-10, default 5; recursive only)").argParser(
          parsePositiveInt
        )
      )
      .addOption(
        new Option(
          "--max-entries <n>",
          "Hard cap on returned entries (1-2000, default 500; recursive only)"
        ).argParser(parsePositiveInt)
      )
  ).action(async function listFiles(options: {
    path: string;
    recursive?: boolean;
    maxDepth?: number;
    maxEntries?: number;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "file.list",
      params: {
        path: options.path,
        ...(options.recursive ? { recursive: true } : {}),
        ...(options.maxDepth != null ? { maxDepth: options.maxDepth } : {}),
        ...(options.maxEntries != null ? { maxEntries: options.maxEntries } : {}),
        ...paginationParams(options)
      },
      command: this,
      dependencies
    });
  });
  file
    .command("stat")
    .option("--path <path>", "Data-relative file or directory path", "")
    .action(async function statFile(options: { path: string }) {
      await executeRemoteCommand({
        commandName: "file.stat",
        params: { path: options.path },
        command: this,
        dependencies
      });
    });
  file
    .command("read")
    .requiredOption("--path <path>", "Data-relative file path")
    .addOption(
      new Option("--encoding <encoding>", "Read encoding").choices(["text", "base64"]).makeOptionMandatory()
    )
    .action(async function readFileCommand(options: { path: string; encoding: "text" | "base64" }) {
      await executeRemoteCommand({
        commandName: "file.read",
        params: {
          path: options.path,
          encoding: options.encoding
        },
        command: this,
        dependencies
      });
    });
  file
    .command("mkdir")
    .requiredOption("--path <path>", "Data-relative directory path")
    .action(async function mkdirFile(options: { path: string }) {
      await executeRemoteCommand({
        commandName: "file.mkdir",
        params: { path: options.path },
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(file.command("upload"))
    .requiredOption("--path <path>", "Data-relative destination file path")
    .requiredOption("--from-file <localPath>", "Read upload content from a local file")
    .option("--mime-type <type>", "Optional MIME type override")
    .action(async function uploadFile(options: { path: string; fromFile: string; mimeType?: string }) {
      await executeRemoteCommand({
        commandName: "file.upload",
        params: createFileUploadParams(options, getEffectiveUploadLimitBytes(dependencies)),
        command: this,
        dependencies
      });
    });
  file
    .command("delete")
    .requiredOption("--path <path>", "Data-relative file path to delete")
    .action(async function deleteFileCommand(options: { path: string }) {
      await executeRemoteCommand({
        commandName: "file.delete",
        params: { path: options.path },
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(file.command("move"))
    .description(
      "Move/rename a managed file (capability-gated: returns UNSUPPORTED_OPERATION on stock Foundry v13/v14)"
    )
    .requiredOption("--from <path>", "Data-relative source file path")
    .requiredOption("--to <path>", "Data-relative destination file path")
    .action(async function moveFileCommand(options: { from: string; to: string }) {
      await executeRemoteCommand({
        commandName: "file.move",
        params: { from: options.from, to: options.to },
        command: this,
        dependencies
      });
    });

  addIdempotencyKeyOption(file.command("rename"))
    .description("Rename a managed file's leaf (alias for file.move; same capability gate)")
    .requiredOption("--from <path>", "Data-relative source file path")
    .requiredOption("--to-name <name>", "New leaf filename (no path separators)")
    .action(async function renameFileCommand(options: { from: string; toName: string }) {
      if (options.toName.includes("/") || options.toName.includes("\\")) {
        throw new CommanderError(
          1,
          "invalidRenameLeaf",
          "--to-name must be a bare filename with no path separators; use `file move --to <path>` to change directories"
        );
      }
      const lastSlash = options.from.replace(/\\/g, "/").lastIndexOf("/");
      const parent = lastSlash === -1 ? "" : options.from.slice(0, lastSlash);
      const to = parent ? `${parent}/${options.toName}` : options.toName;
      await executeRemoteCommand({
        commandName: "file.move",
        params: { from: options.from, to },
        command: this,
        dependencies
      });
    });
}
