import {
  createEffectClonePatch,
  createEffectCreateParams,
  createEffectUpdatePatch,
  createItemCloneParams,
  createItemCreateParams,
  createItemUpdateParams,
  type EffectFieldOptions
} from "../params.js";
import { executeRemoteCommand } from "../exec.js";
import { parseIdList } from "../parse.js";
import { addEffectFieldOptions, addItemFieldOptions, addReservedIncludeOption } from "./field-options.js";
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

export function registerItem({ program, dependencies }: RegistrationContext) {
  const { registerOwnershipSet, registerCompendiumImport, registerBatchWriteCommands } =
    createSharedRegistrars(dependencies);
  const item = program.command("item").description("Foundry world item commands");
  item.addHelpText(
    "after",
    "\nResult key (--json): .result.item (single/write) / .result.items[] (list, get-many)."
  );

  registerBatchWriteCommands(item, {
    prefix: "item",
    noun: "item",
    scope: "world",
    verbs: ["update-many", "delete-many"]
  });
  registerOwnershipSet(item, {
    idFlag: "--item-id <itemId>",
    idKey: "itemId",
    commandName: "item.ownership.set",
    noun: "item"
  });
  addNameFilterOption(addPaginationOptions(item.command("list"))).action(async function listItems(options: {
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "item.list",
      params: { ...nameFilterParams(options), ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  addReservedIncludeOption(
    item.command("get").requiredOption("--item-id <itemId>", "Item id"),
    "on this command"
  ).action(async function getItem(options: { itemId: string; include?: string[] }) {
    await executeRemoteCommand({
      commandName: "item.get",
      params: {
        itemId: options.itemId,
        ...(options.include ? { include: options.include } : {})
      },
      command: this,
      dependencies
    });
  });
  addReservedIncludeOption(
    item
      .command("get-many")
      .requiredOption("--ids <list>", "Comma-separated item ids (atomic: all must exist)", parseIdList),
    "on this command"
  ).action(async function getManyItems(options: { ids: string[]; include?: string[] }) {
    await executeRemoteCommand({
      commandName: "item.get-many",
      params: {
        ids: options.ids,
        ...(options.include ? { include: options.include } : {})
      },
      command: this,
      dependencies
    });
  });
  addReservedIncludeOption(
    addItemFieldOptions(
      addIdempotencyKeyOption(item.command("create"))
        .requiredOption("--name <name>", "Item name")
        .requiredOption("--type <type>", "Item type"),
      "create"
    ).option("--data-json <json>", "Extra item fields (e.g. flags) as a JSON object (merged last)"),
    "in the result"
  ).action(async function createItem(options: {
    name: string;
    type: string;
    img?: string;
    folder?: string;
    clearFolder?: boolean;
    sort?: number;
    systemJson?: string;
    dataJson?: string;
    include?: string[];
  }) {
    await executeRemoteCommand({
      commandName: "item.create",
      params: createItemCreateParams(options),
      command: this,
      dependencies
    });
  });
  addReservedIncludeOption(
    addItemFieldOptions(
      item
        .command("update")
        .requiredOption("--item-id <itemId>", "Item id")
        .option("--name <name>", "New item name"),
      "update"
    ).option("--patch-json <json>", "Extra item patch fields (e.g. flags) as a JSON object (merged last)"),
    "in the result"
  ).action(async function updateItem(options: {
    itemId: string;
    name?: string;
    img?: string;
    folder?: string;
    clearFolder?: boolean;
    sort?: number;
    systemJson?: string;
    patchJson?: string;
    include?: string[];
  }) {
    await executeRemoteCommand({
      commandName: "item.update",
      params: createItemUpdateParams(options),
      command: this,
      dependencies
    });
  });
  addItemFieldOptions(
    addIdempotencyKeyOption(item.command("clone"))
      .requiredOption("--item-id <itemId>", "Source item id")
      .option("--name <name>", "Name override for the clone"),
    "clone"
  ).action(async function cloneItem(options: {
    itemId: string;
    name?: string;
    img?: string;
    folder?: string;
    clearFolder?: boolean;
    sort?: number;
    systemJson?: string;
  }) {
    await executeRemoteCommand({
      commandName: "item.clone",
      params: createItemCloneParams(options),
      command: this,
      dependencies
    });
  });
  item
    .command("delete")
    .requiredOption("--item-id <itemId>", "Item id")
    .action(async function deleteItem(options: { itemId: string }) {
      await executeRemoteCommand({
        commandName: "item.delete",
        params: { itemId: options.itemId },
        command: this,
        dependencies
      });
    });

  registerCompendiumImport(item, {
    commandName: "item.import-from-compendium",
    noun: "item",
    packExample: "dnd5e.items"
  });

  const itemEffect = item.command("effect").description("World-item ActiveEffect commands");

  registerBatchWriteCommands(itemEffect, { prefix: "item.effect", noun: "effect", scope: "item" });
  addNameFilterOption(
    addPaginationOptions(itemEffect.command("list").requiredOption("--item-id <itemId>", "Item id"))
  ).action(async function listItemEffects(options: {
    itemId: string;
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "item.effect.list",
      params: { itemId: options.itemId, ...nameFilterParams(options), ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  itemEffect
    .command("get")
    .requiredOption("--item-id <itemId>", "Item id")
    .requiredOption("--effect-id <effectId>", "Effect id")
    .action(async function getItemEffect(options: { itemId: string; effectId: string }) {
      await executeRemoteCommand({
        commandName: "item.effect.get",
        params: { itemId: options.itemId, effectId: options.effectId },
        command: this,
        dependencies
      });
    });
  addEffectFieldOptions(
    addIdempotencyKeyOption(itemEffect.command("create")).requiredOption("--item-id <itemId>", "Item id"),
    "create"
  )
    .option("--data-json <json>", "Effect payload as JSON object (merged last, overrides typed flags)")
    .action(async function createItemEffect(options: EffectFieldOptions & { itemId: string }) {
      await executeRemoteCommand({
        commandName: "item.effect.create",
        params: { itemId: options.itemId, ...createEffectCreateParams(options) },
        command: this,
        dependencies
      });
    });
  addEffectFieldOptions(
    itemEffect
      .command("update")
      .requiredOption("--item-id <itemId>", "Item id")
      .requiredOption("--effect-id <effectId>", "Effect id"),
    "update"
  )
    .option("--patch-json <json>", "Effect patch as JSON object (merged last, overrides typed flags)")
    .action(async function updateItemEffect(
      options: EffectFieldOptions & { itemId: string; effectId: string }
    ) {
      await executeRemoteCommand({
        commandName: "item.effect.update",
        params: {
          itemId: options.itemId,
          effectId: options.effectId,
          patch: createEffectUpdatePatch(options)
        },
        command: this,
        dependencies
      });
    });
  addEffectFieldOptions(
    addIdempotencyKeyOption(itemEffect.command("clone"))
      .requiredOption("--item-id <itemId>", "Item id")
      .requiredOption("--effect-id <effectId>", "Source effect id"),
    "clone"
  )
    .option("--patch-json <json>", "Effect override as JSON object (merged last, overrides typed flags)")
    .action(async function cloneItemEffect(
      options: EffectFieldOptions & { itemId: string; effectId: string }
    ) {
      await executeRemoteCommand({
        commandName: "item.effect.clone",
        params: { itemId: options.itemId, effectId: options.effectId, ...createEffectClonePatch(options) },
        command: this,
        dependencies
      });
    });
  itemEffect
    .command("delete")
    .requiredOption("--item-id <itemId>", "Item id")
    .requiredOption("--effect-id <effectId>", "Effect id")
    .action(async function deleteItemEffect(options: { itemId: string; effectId: string }) {
      await executeRemoteCommand({
        commandName: "item.effect.delete",
        params: { itemId: options.itemId, effectId: options.effectId },
        command: this,
        dependencies
      });
    });
}
