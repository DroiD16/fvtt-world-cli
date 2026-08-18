import { Command, Option } from "commander";

import type { CliDependencies } from "../deps.js";
import { executeRemoteCommand } from "../exec.js";
import { folderField, numberField, optionalPatch, stringField } from "../params.js";
import {
  parseIdList,
  parseJsonObject,
  parseJsonObjectArray,
  parseNonNegativeInt,
  parseNumber,
  parseOwnershipLevel,
  parseOwnershipUsers,
  parsePositiveInt
} from "../parse.js";

export interface RegistrationContext {
  program: Command;
  dependencies: CliDependencies;
}

export function addIdempotencyKeyOption(command: Command): Command {
  return command.option(
    "--idempotency-key <key>",
    "Client-supplied key so a retried create/upload returns the original result instead of duplicating. Reuse the SAME key across retries of one operation."
  );
}

export function addPaginationOptions(command: Command): Command {
  return command
    .addOption(new Option("--limit <n>", "Maximum number of entries to return").argParser(parsePositiveInt))
    .addOption(
      new Option("--offset <n>", "Number of entries to skip before this page").argParser(parseNonNegativeInt)
    );
}

export function paginationParams(options: { limit?: number; offset?: number }): Record<string, number> {
  const params: Record<string, number> = {};
  if (options.limit !== undefined) {
    params.limit = options.limit;
  }
  if (options.offset !== undefined) {
    params.offset = options.offset;
  }
  return params;
}

export function addNameFilterOption(command: Command): Command {
  return command.option(
    "--name <substring>",
    "Case-insensitive substring filter on the entry name (applied server-side before pagination)"
  );
}

export function nameFilterParams(options: { name?: string }): Record<string, string> {
  return options.name !== undefined ? { name: options.name } : {};
}

type ImportPatchFlag = "name" | "img" | "sort";

export const IMPORT_PATCH_FLAGS = {
  "scene.import-from-compendium": ["name", "sort"],
  "item.import-from-compendium": ["name", "img", "sort"],
  "journal.import-from-compendium": ["name", "sort"],
  "macro.import-from-compendium": ["name", "img"],
  "playlist.import-from-compendium": ["name", "sort"],
  "table.import-from-compendium": ["name", "img", "sort"],
  "cards.import-from-compendium": ["name", "img", "sort"]
} as const satisfies Record<string, readonly ImportPatchFlag[]>;

const IMPORT_PATCH_FLAG_OPTIONS: Record<ImportPatchFlag, (command: Command, noun: string) => void> = {
  name: (command, noun) => {
    command.option("--name <name>", `Name override for the imported ${noun}`);
  },
  img: (command) => {
    command.option("--img <img>", "Image override");
  },
  sort: (command) => {
    command.addOption(new Option("--sort <sort>", "Sort override").argParser(parseNumber));
  }
};

export function createSharedRegistrars(dependencies: CliDependencies) {
  function registerOwnershipSet(
    group: Command,
    {
      idFlag,
      idKey,
      commandName,
      noun,
      withPageId = false
    }: { idFlag: string; idKey: string; commandName: string; noun: string; withPageId?: boolean }
  ) {
    const ownership = group
      .command("ownership")
      .description(`${noun} ownership (visibility / access policy)`);
    const set = ownership
      .command("set")
      .description(`Set ${noun} ownership levels (0=none, 1=limited, 2=observer, 3=owner)`)
      .requiredOption(idFlag, `${noun} id`);
    if (withPageId) {
      set.option(
        "--page-id <pageId>",
        "Target a single journal page (page ownership overrides the entry; level -1 = inherit)"
      );
    }
    set
      .addOption(
        new Option(
          "--default <level>",
          "Default ownership level for all users (0=none, 1=limited, 2=observer, 3=owner)"
        ).argParser(parseOwnershipLevel)
      )
      .option(
        "--users-json <json>",
        'Per-user levels as a JSON object, e.g. {"<userId>":3} (use `fvtt-world-cli user list` for ids)',
        parseOwnershipUsers
      )
      .action(async function ownershipSet(this: Command, options: Record<string, unknown>) {
        const params: Record<string, unknown> = { [idKey]: options[idKey] };
        if (withPageId && options.pageId !== undefined) {
          params.pageId = options.pageId;
        }
        if (options.default !== undefined) {
          params.default = options.default;
        }
        if (options.usersJson !== undefined) {
          params.users = options.usersJson;
        }
        await executeRemoteCommand({ commandName, params, command: this, dependencies });
      });
  }

  function registerCompendiumImport(
    group: Command,
    {
      commandName,
      noun,
      packExample
    }: { commandName: keyof typeof IMPORT_PATCH_FLAGS; noun: string; packExample: string }
  ) {
    const command = addIdempotencyKeyOption(group.command("import-from-compendium"))
      .description(`Import a compendium ${noun} into the world (provenance is reported as compendiumSource)`)
      .requiredOption("--pack <pack>", `Compendium pack id (e.g. ${packExample})`)
      .requiredOption("--entry-id <entryId>", "Compendium entry id")
      .option("--folder <folder>", "Destination folder id")
      .addOption(
        new Option("--clear-folder", "Place at the folder root (folder = null)").conflicts("folder")
      );
    for (const field of IMPORT_PATCH_FLAGS[commandName]) {
      IMPORT_PATCH_FLAG_OPTIONS[field](command, noun);
    }
    command
      .option("--patch-json <json>", "Extra override fields as a JSON object (merged into the patch)")
      .action(async function importFromCompendium(
        this: Command,
        options: {
          pack: string;
          entryId: string;
          folder?: string;
          clearFolder?: boolean;
          name?: string;
          img?: string;
          sort?: number;
          patchJson?: string;
        }
      ) {
        const patch = {
          ...stringField("name", options.name),
          ...stringField("img", options.img),
          ...numberField("sort", options.sort),

          ...(options.patchJson ? parseJsonObject(options.patchJson, "--patch-json") : {})
        };
        await executeRemoteCommand({
          commandName,
          params: {
            pack: options.pack,
            entryId: options.entryId,
            ...folderField(options),
            ...optionalPatch(patch)
          },
          command: this,
          dependencies
        });
      });
  }

  const BATCH_SCOPES: Record<string, { flag: string; help: string; key: string }[]> = {
    scene: [{ flag: "--scene-id <sceneId>", help: "Scene id", key: "sceneId" }],
    actor: [{ flag: "--actor-id <actorId>", help: "Actor id", key: "actorId" }],
    item: [{ flag: "--item-id <itemId>", help: "Item id", key: "itemId" }],
    actorItem: [
      { flag: "--actor-id <actorId>", help: "Actor id", key: "actorId" },
      { flag: "--item-id <itemId>", help: "Embedded item id", key: "itemId" }
    ],
    sceneToken: [
      { flag: "--scene-id <sceneId>", help: "Scene id", key: "sceneId" },
      { flag: "--token-id <tokenId>", help: "Token id", key: "tokenId" }
    ],
    sceneTokenItem: [
      { flag: "--scene-id <sceneId>", help: "Scene id", key: "sceneId" },
      { flag: "--token-id <tokenId>", help: "Token id", key: "tokenId" },
      { flag: "--item-id <itemId>", help: "Item id on the token's actor", key: "itemId" }
    ],

    world: []
  };

  function registerBatchWriteCommands(
    group: Command,
    {
      prefix,
      noun,
      dataHelp,
      scope = "scene",
      verbs = ["create-many", "update-many", "delete-many"],
      withForce = false
    }: {
      prefix: string;
      noun: string;
      dataHelp?: string;
      scope?: keyof typeof BATCH_SCOPES;
      verbs?: Array<"create-many" | "update-many" | "delete-many">;
      withForce?: boolean;
    }
  ) {
    const scopeSpec = BATCH_SCOPES[scope];
    const scopeOption = (command: Command) => {
      for (const { flag, help } of scopeSpec) command.requiredOption(flag, help);
      return command;
    };

    const scopeParams = (options: Record<string, unknown>) =>
      Object.fromEntries(scopeSpec.map(({ key }) => [key, options[key]]));
    if (verbs.includes("create-many")) registerBatchCreateMany();
    if (verbs.includes("update-many")) registerBatchUpdateMany();
    if (verbs.includes("delete-many")) registerBatchDeleteMany();

    function registerBatchCreateMany() {
      scopeOption(addIdempotencyKeyOption(group.command("create-many")))
        .description(
          `Create many ${noun}s in ONE call (per-element outcomes; nothing is written if any element is invalid)`
        )
        .requiredOption(
          "--data-json <json>",
          dataHelp ?? `${noun[0].toUpperCase()}${noun.slice(1)} data as a JSON ARRAY of objects`,
          (value) => parseJsonObjectArray(value, "--data-json")
        )
        .action(async function createMany(
          this: Command,
          options: Record<string, any> & { dataJson: Array<Record<string, unknown>> }
        ) {
          await executeRemoteCommand({
            commandName: `${prefix}.create-many`,
            params: { ...scopeParams(options), data: options.dataJson },
            command: this,
            dependencies
          });
        });
    }

    function registerBatchUpdateMany() {
      scopeOption(addIdempotencyKeyOption(group.command("update-many")))
        .description(`Patch many ${noun}s in ONE call (a no-op element reports \`unchanged\`)`)
        .requiredOption(
          "--patches-json <json>",
          `${noun[0].toUpperCase()}${noun.slice(1)} patches as a JSON ARRAY of {"id","patch"} objects`,
          (value) => parseJsonObjectArray(value, "--patches-json")
        )
        .action(async function updateMany(
          this: Command,
          options: Record<string, any> & { patchesJson: Array<Record<string, unknown>> }
        ) {
          await executeRemoteCommand({
            commandName: `${prefix}.update-many`,
            params: { ...scopeParams(options), patches: options.patchesJson },
            command: this,
            dependencies
          });
        });
    }

    function registerBatchDeleteMany() {
      const deleteCommand = scopeOption(addIdempotencyKeyOption(group.command("delete-many")))
        .description(`Delete many ${noun}s in ONE call (an already-gone id reports \`alreadyDeleted\`)`)
        .requiredOption("--ids <list>", `Comma-separated ${noun} ids`, parseIdList);

      if (withForce) {
        deleteCommand.option(
          "--force",
          `Delete even when an element trips the ${noun} delete guard (without it, ONE violation rejects the whole call naming its index)`
        );
      }
      deleteCommand.action(async function deleteMany(
        this: Command,
        options: Record<string, any> & { ids: string[]; force?: boolean }
      ) {
        await executeRemoteCommand({
          commandName: `${prefix}.delete-many`,
          params: {
            ...scopeParams(options),
            ids: options.ids,
            ...(withForce && options.force === true ? { force: true } : {})
          },
          command: this,
          dependencies
        });
      });
    }
  }

  return { registerOwnershipSet, registerCompendiumImport, registerBatchWriteCommands };
}
