import { Option } from "commander";

import {
  type ActorFieldOptions,
  createActorCloneParams,
  createActorCreateParams,
  createActorImportParams,
  createActorItemCloneParams,
  createActorItemCreateParams,
  createActorItemImportParams,
  createActorItemUpdateParams,
  createActorUpdateParams,
  createEffectClonePatch,
  createEffectCreateParams,
  createEffectUpdatePatch,
  type EffectFieldOptions
} from "../params.js";
import { executeRemoteCommand } from "../exec.js";
import { parseIdList, parseIncludeFields, parseNumber } from "../parse.js";
import {
  addActorFieldOptions,
  addActorIncludeOption,
  addEffectFieldOptions,
  addEmbeddedItemFieldOptions,
  addReservedIncludeOption
} from "./field-options.js";
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

export function registerActor({ program, dependencies }: RegistrationContext) {
  const { registerOwnershipSet, registerBatchWriteCommands } = createSharedRegistrars(dependencies);
  const actor = program.command("actor").description("Foundry actor commands");
  actor.addHelpText(
    "after",
    "\nResult key (--json): .result.actor (single/write) / .result.actors[] (list, get-many). Embedded items at .result.item; effects at .result.effect."
  );

  registerBatchWriteCommands(actor, {
    prefix: "actor",
    noun: "actor",
    scope: "world",
    verbs: ["update-many", "delete-many"],
    withForce: true
  });
  registerOwnershipSet(actor, {
    idFlag: "--actor-id <actorId>",
    idKey: "actorId",
    commandName: "actor.ownership.set",
    noun: "actor"
  });
  addNameFilterOption(addPaginationOptions(actor.command("list"))).action(async function listActors(options: {
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "actor.list",
      params: { ...nameFilterParams(options), ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  addActorIncludeOption(actor.command("get").requiredOption("--actor-id <actorId>", "Actor id")).action(
    async function getActor(options: { actorId: string; include?: string[] }) {
      await executeRemoteCommand({
        commandName: "actor.get",
        params: {
          actorId: options.actorId,
          ...(options.include ? { include: options.include } : {})
        },
        command: this,
        dependencies
      });
    }
  );
  addActorIncludeOption(
    actor
      .command("get-many")
      .requiredOption("--ids <list>", "Comma-separated actor ids (atomic: all must exist)", parseIdList)
  ).action(async function getManyActors(options: { ids: string[]; include?: string[] }) {
    await executeRemoteCommand({
      commandName: "actor.get-many",
      params: {
        ids: options.ids,
        ...(options.include ? { include: options.include } : {})
      },
      command: this,
      dependencies
    });
  });
  addReservedIncludeOption(
    addActorFieldOptions(
      addIdempotencyKeyOption(actor.command("create"))
        .requiredOption("--name <name>", "Actor name")
        .requiredOption("--type <type>", "Actor type (e.g. character, npc)"),
      "create"
    ).option(
      "--data-json <json>",
      "Extra actor fields (e.g. flags, prototypeToken) as a JSON object (merged last)"
    ),
    "in the result"
  ).action(async function createActorCommand(
    options: ActorFieldOptions & { name: string; type: string; dataJson?: string; include?: string[] }
  ) {
    await executeRemoteCommand({
      commandName: "actor.create",
      params: createActorCreateParams(options),
      command: this,
      dependencies
    });
  });
  addReservedIncludeOption(
    addActorFieldOptions(
      actor
        .command("update")
        .requiredOption("--actor-id <actorId>", "Actor id")
        .option("--name <name>", "New actor name"),
      "update"
    ).option(
      "--patch-json <json>",
      "Extra actor patch fields (e.g. flags, prototypeToken) as a JSON object (merged last)"
    ),
    "in the result"
  ).action(async function updateActorCommand(
    options: ActorFieldOptions & { actorId: string; patchJson?: string; include?: string[] }
  ) {
    await executeRemoteCommand({
      commandName: "actor.update",
      params: createActorUpdateParams(options),
      command: this,
      dependencies
    });
  });
  addActorFieldOptions(
    addIdempotencyKeyOption(actor.command("clone"))
      .requiredOption("--actor-id <actorId>", "Source actor id")
      .option("--name <name>", "Name override for the clone"),
    "clone"
  ).action(async function cloneActorCommand(options: ActorFieldOptions & { actorId: string }) {
    await executeRemoteCommand({
      commandName: "actor.clone",
      params: createActorCloneParams(options),
      command: this,
      dependencies
    });
  });
  actor
    .command("delete")
    .requiredOption("--actor-id <actorId>", "Actor id")
    .option("--force", "Allow deleting an actor referenced by tokens")
    .action(async function deleteActorCommand(options: { actorId: string; force?: boolean }) {
      await executeRemoteCommand({
        commandName: "actor.delete",
        params: { actorId: options.actorId, ...(options.force ? { force: true } : {}) },
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(actor.command("import-from-compendium"))
    .requiredOption("--pack <pack>", "Compendium pack id (e.g. dnd5e.monsters)")
    .requiredOption("--entry-id <entryId>", "Compendium entry id")
    .option("--folder <folder>", "Destination folder id")
    .addOption(new Option("--clear-folder", "Place at the folder root (folder = null)").conflicts("folder"))
    .option("--name <name>", "Name override for the imported actor")
    .option("--img <img>", "Portrait image override")
    .option("--token-img <tokenImg>", "Prototype token texture override (the placed token's image)")
    .addOption(new Option("--sort <sort>", "Sort override").argParser(parseNumber))
    .option("--patch-json <json>", "Extra override fields as a JSON object (merged into updateData)")
    .action(async function importActorFromCompendium(options: {
      pack: string;
      entryId: string;
      folder?: string;
      clearFolder?: boolean;
      name?: string;
      img?: string;
      tokenImg?: string;
      sort?: number;
      patchJson?: string;
    }) {
      await executeRemoteCommand({
        commandName: "actor.import-from-compendium",
        params: createActorImportParams(options),
        command: this,
        dependencies
      });
    });

  const actorItem = actor.command("item").description("Foundry actor embedded item commands");
  addNameFilterOption(
    addPaginationOptions(actorItem.command("list").requiredOption("--actor-id <actorId>", "Actor id")).option(
      "--include <fields>",
      "Comma-separated extra fields to include per row (allowed: flags, effects)",
      parseIncludeFields
    )
  ).action(async function listActorItems(options: {
    actorId: string;
    name?: string;
    limit?: number;
    offset?: number;
    include?: string[];
  }) {
    await executeRemoteCommand({
      commandName: "actor.item.list",
      params: {
        actorId: options.actorId,
        ...nameFilterParams(options),
        ...paginationParams(options),
        ...(options.include ? { include: options.include } : {})
      },
      command: this,
      dependencies
    });
  });
  addReservedIncludeOption(
    addEmbeddedItemFieldOptions(
      addIdempotencyKeyOption(actorItem.command("create"))
        .requiredOption("--actor-id <actorId>", "Actor id")
        .requiredOption("--name <name>", "Item name")
        .requiredOption("--type <type>", "Item type"),
      "create"
    ).option("--data-json <json>", "Extra item fields (e.g. flags, effects) as a JSON object (merged last)"),
    "in the result"
  ).action(async function createActorItem(options: {
    actorId: string;
    name: string;
    type: string;
    img?: string;
    sort?: number;
    systemJson?: string;
    dataJson?: string;
    include?: string[];
  }) {
    await executeRemoteCommand({
      commandName: "actor.item.create",
      params: createActorItemCreateParams(options),
      command: this,
      dependencies
    });
  });
  addReservedIncludeOption(
    addEmbeddedItemFieldOptions(
      actorItem
        .command("update")
        .requiredOption("--actor-id <actorId>", "Actor id")
        .requiredOption("--item-id <itemId>", "Item id")
        .option("--name <name>", "New item name"),
      "update"
    ).option("--patch-json <json>", "Extra item patch fields (e.g. flags) as a JSON object (merged last)"),
    "in the result"
  ).action(async function updateActorItem(options: {
    actorId: string;
    itemId: string;
    name?: string;
    img?: string;
    sort?: number;
    systemJson?: string;
    patchJson?: string;
    include?: string[];
  }) {
    await executeRemoteCommand({
      commandName: "actor.item.update",
      params: createActorItemUpdateParams(options),
      command: this,
      dependencies
    });
  });
  addReservedIncludeOption(
    actorItem
      .command("get")
      .requiredOption("--actor-id <actorId>", "Actor id")
      .requiredOption("--item-id <itemId>", "Item id"),
    "on this command"
  ).action(async function getActorItem(options: { actorId: string; itemId: string; include?: string[] }) {
    await executeRemoteCommand({
      commandName: "actor.item.get",
      params: {
        actorId: options.actorId,
        itemId: options.itemId,
        ...(options.include ? { include: options.include } : {})
      },
      command: this,
      dependencies
    });
  });
  addEmbeddedItemFieldOptions(
    addIdempotencyKeyOption(actorItem.command("clone"))
      .requiredOption("--actor-id <actorId>", "Actor id")
      .requiredOption("--item-id <itemId>", "Source item id")
      .option("--name <name>", "Name override for the clone"),
    "clone"
  ).action(async function cloneActorItem(options: {
    actorId: string;
    itemId: string;
    name?: string;
    img?: string;
    sort?: number;
    systemJson?: string;
  }) {
    await executeRemoteCommand({
      commandName: "actor.item.clone",
      params: createActorItemCloneParams(options),
      command: this,
      dependencies
    });
  });
  addReservedIncludeOption(
    addIdempotencyKeyOption(actorItem.command("import-from-compendium"))
      .requiredOption("--actor-id <actorId>", "Actor id")
      .requiredOption("--pack <pack>", "Compendium pack id (e.g. dnd5e.items)")
      .requiredOption("--entry-id <entryId>", "Compendium entry id")
      .option("--name <name>", "Name override for the imported item")
      .option("--img <img>", "Image override (applies reliably)")
      .addOption(new Option("--sort <sort>", "Sort override").argParser(parseNumber))
      .option("--system-json <json>", "Item system override as JSON object")
      .option("--patch-json <json>", "Extra override fields as a JSON object (merged last)"),
    "in the result"
  ).action(async function importActorItemFromCompendium(options: {
    actorId: string;
    pack: string;
    entryId: string;
    name?: string;
    img?: string;
    sort?: number;
    systemJson?: string;
    patchJson?: string;
    include?: string[];
  }) {
    await executeRemoteCommand({
      commandName: "actor.item.import-from-compendium",
      params: createActorItemImportParams(options),
      command: this,
      dependencies
    });
  });
  actorItem
    .command("delete")
    .requiredOption("--actor-id <actorId>", "Actor id")
    .requiredOption("--item-id <itemId>", "Item id")
    .action(async function deleteActorItem(options: { actorId: string; itemId: string }) {
      await executeRemoteCommand({
        commandName: "actor.item.delete",
        params: { actorId: options.actorId, itemId: options.itemId },
        command: this,
        dependencies
      });
    });

  const actorEffect = actor.command("effect").description("Actor ActiveEffect commands");

  registerBatchWriteCommands(actorEffect, { prefix: "actor.effect", noun: "effect", scope: "actor" });
  addNameFilterOption(
    addPaginationOptions(actorEffect.command("list").requiredOption("--actor-id <actorId>", "Actor id"))
  ).action(async function listActorEffects(options: {
    actorId: string;
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "actor.effect.list",
      params: { actorId: options.actorId, ...nameFilterParams(options), ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  addPaginationOptions(
    actorEffect.command("applied").requiredOption("--actor-id <actorId>", "Actor id")
  ).action(async function listAppliedActorEffects(options: {
    actorId: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "actor.effect.applied",
      params: { actorId: options.actorId, ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  actorEffect
    .command("get")
    .requiredOption("--actor-id <actorId>", "Actor id")
    .requiredOption("--effect-id <effectId>", "Effect id")
    .action(async function getActorEffect(options: { actorId: string; effectId: string }) {
      await executeRemoteCommand({
        commandName: "actor.effect.get",
        params: { actorId: options.actorId, effectId: options.effectId },
        command: this,
        dependencies
      });
    });
  addEffectFieldOptions(
    addIdempotencyKeyOption(actorEffect.command("create")).requiredOption("--actor-id <actorId>", "Actor id"),
    "create",
    " (item parents only)"
  )
    .option("--data-json <json>", "Effect payload as JSON object (merged last, overrides typed flags)")
    .action(async function createActorEffect(options: EffectFieldOptions & { actorId: string }) {
      await executeRemoteCommand({
        commandName: "actor.effect.create",
        params: { actorId: options.actorId, ...createEffectCreateParams(options) },
        command: this,
        dependencies
      });
    });
  addEffectFieldOptions(
    actorEffect
      .command("update")
      .requiredOption("--actor-id <actorId>", "Actor id")
      .requiredOption("--effect-id <effectId>", "Effect id"),
    "update",
    " (item parents only)"
  )
    .option("--patch-json <json>", "Effect patch as JSON object (merged last, overrides typed flags)")
    .action(async function updateActorEffect(
      options: EffectFieldOptions & { actorId: string; effectId: string }
    ) {
      await executeRemoteCommand({
        commandName: "actor.effect.update",
        params: {
          actorId: options.actorId,
          effectId: options.effectId,
          patch: createEffectUpdatePatch(options)
        },
        command: this,
        dependencies
      });
    });
  addEffectFieldOptions(
    addIdempotencyKeyOption(actorEffect.command("clone"))
      .requiredOption("--actor-id <actorId>", "Actor id")
      .requiredOption("--effect-id <effectId>", "Source effect id"),
    "clone",
    " (item parents only)"
  )
    .option("--patch-json <json>", "Effect override as JSON object (merged last, overrides typed flags)")
    .action(async function cloneActorEffect(
      options: EffectFieldOptions & { actorId: string; effectId: string }
    ) {
      await executeRemoteCommand({
        commandName: "actor.effect.clone",
        params: { actorId: options.actorId, effectId: options.effectId, ...createEffectClonePatch(options) },
        command: this,
        dependencies
      });
    });
  actorEffect
    .command("delete")
    .requiredOption("--actor-id <actorId>", "Actor id")
    .requiredOption("--effect-id <effectId>", "Effect id")
    .action(async function deleteActorEffect(options: { actorId: string; effectId: string }) {
      await executeRemoteCommand({
        commandName: "actor.effect.delete",
        params: { actorId: options.actorId, effectId: options.effectId },
        command: this,
        dependencies
      });
    });

  const actorItemEffect = actorItem
    .command("effect")
    .description(
      "Actor-embedded-item ActiveEffect commands (deepest nesting → protocol actor.item.effect.*)"
    );

  registerBatchWriteCommands(actorItemEffect, {
    prefix: "actor.item.effect",
    noun: "effect",
    scope: "actorItem"
  });
  addNameFilterOption(
    addPaginationOptions(
      actorItemEffect
        .command("list")
        .requiredOption("--actor-id <actorId>", "Actor id")
        .requiredOption("--item-id <itemId>", "Item id")
    )
  ).action(async function listActorItemEffects(options: {
    actorId: string;
    itemId: string;
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "actor.item.effect.list",
      params: {
        actorId: options.actorId,
        itemId: options.itemId,
        ...nameFilterParams(options),
        ...paginationParams(options)
      },
      command: this,
      dependencies
    });
  });
  actorItemEffect
    .command("get")
    .requiredOption("--actor-id <actorId>", "Actor id")
    .requiredOption("--item-id <itemId>", "Item id")
    .requiredOption("--effect-id <effectId>", "Effect id")
    .action(async function getActorItemEffect(options: {
      actorId: string;
      itemId: string;
      effectId: string;
    }) {
      await executeRemoteCommand({
        commandName: "actor.item.effect.get",
        params: { actorId: options.actorId, itemId: options.itemId, effectId: options.effectId },
        command: this,
        dependencies
      });
    });
  addEffectFieldOptions(
    addIdempotencyKeyOption(actorItemEffect.command("create"))
      .requiredOption("--actor-id <actorId>", "Actor id")
      .requiredOption("--item-id <itemId>", "Item id"),
    "create"
  )
    .option("--data-json <json>", "Effect payload as JSON object (merged last, overrides typed flags)")
    .action(async function createActorItemEffect(
      options: EffectFieldOptions & { actorId: string; itemId: string }
    ) {
      await executeRemoteCommand({
        commandName: "actor.item.effect.create",
        params: { actorId: options.actorId, itemId: options.itemId, ...createEffectCreateParams(options) },
        command: this,
        dependencies
      });
    });
  addEffectFieldOptions(
    actorItemEffect
      .command("update")
      .requiredOption("--actor-id <actorId>", "Actor id")
      .requiredOption("--item-id <itemId>", "Item id")
      .requiredOption("--effect-id <effectId>", "Effect id"),
    "update"
  )
    .option("--patch-json <json>", "Effect patch as JSON object (merged last, overrides typed flags)")
    .action(async function updateActorItemEffect(
      options: EffectFieldOptions & { actorId: string; itemId: string; effectId: string }
    ) {
      await executeRemoteCommand({
        commandName: "actor.item.effect.update",
        params: {
          actorId: options.actorId,
          itemId: options.itemId,
          effectId: options.effectId,
          patch: createEffectUpdatePatch(options)
        },
        command: this,
        dependencies
      });
    });
  addEffectFieldOptions(
    addIdempotencyKeyOption(actorItemEffect.command("clone"))
      .requiredOption("--actor-id <actorId>", "Actor id")
      .requiredOption("--item-id <itemId>", "Item id")
      .requiredOption("--effect-id <effectId>", "Source effect id"),
    "clone"
  )
    .option("--patch-json <json>", "Effect override as JSON object (merged last, overrides typed flags)")
    .action(async function cloneActorItemEffect(
      options: EffectFieldOptions & { actorId: string; itemId: string; effectId: string }
    ) {
      await executeRemoteCommand({
        commandName: "actor.item.effect.clone",
        params: {
          actorId: options.actorId,
          itemId: options.itemId,
          effectId: options.effectId,
          ...createEffectClonePatch(options)
        },
        command: this,
        dependencies
      });
    });
  actorItemEffect
    .command("delete")
    .requiredOption("--actor-id <actorId>", "Actor id")
    .requiredOption("--item-id <itemId>", "Item id")
    .requiredOption("--effect-id <effectId>", "Effect id")
    .action(async function deleteActorItemEffect(options: {
      actorId: string;
      itemId: string;
      effectId: string;
    }) {
      await executeRemoteCommand({
        commandName: "actor.item.effect.delete",
        params: { actorId: options.actorId, itemId: options.itemId, effectId: options.effectId },
        command: this,
        dependencies
      });
    });
}
