import { Option } from "commander";

import {
  createEffectClonePatch,
  createEffectCreateParams,
  createEffectUpdatePatch,
  createExecutableBehaviorCloneParams,
  createExecutableBehaviorCreateParams,
  createExecutableBehaviorUpdateParams,
  type ExecutableBehaviorFieldOptions,
  createItemCreateParams,
  createItemUpdateParams,
  createSceneCloneParams,
  createSceneCreateParams,
  createSceneDrawingCloneParams,
  createSceneDrawingCreateParams,
  createSceneDrawingUpdateParams,
  createSceneLightCloneParams,
  createSceneLightCreateParams,
  createSceneLightUpdateParams,
  createSceneNoteCloneParams,
  createSceneNoteCreateParams,
  createSceneNoteUpdateParams,
  createSceneRegionBehaviorCloneParams,
  createSceneRegionBehaviorCreateParams,
  createSceneRegionBehaviorUpdateParams,
  createSceneRegionCloneParams,
  createSceneRegionCreateParams,
  createSceneRegionUpdateParams,
  createSceneSoundCloneParams,
  createSceneSoundCreateParams,
  createSceneSoundUpdateParams,
  createSceneTemplateCloneParams,
  createSceneTemplateCreateParams,
  createSceneTemplateUpdateParams,
  createSceneTileCloneParams,
  createSceneTileCreateParams,
  createSceneTileUpdateParams,
  createSceneTokenCloneParams,
  createSceneTokenCreateParams,
  createSceneTokenUpdateParams,
  createSceneUpdateParams,
  createSceneWallCloneParams,
  createSceneWallCreateParams,
  createSceneWallUpdateParams,
  type EffectFieldOptions,
  jsonObjectField,
  numberField,
  optionalPatch,
  type RegionBehaviorFieldOptions,
  type SceneFieldOptions,
  type SoundFieldOptions,
  stringField,
  type TileFieldOptions,
  type TokenFieldOptions
} from "../params.js";
import { executeRemoteCommand } from "../exec.js";
import { parseCsvList, parseIdList, parseNumber, parseTokenIncludeFields } from "../parse.js";
import {
  addEffectFieldOptions,
  addEmbeddedItemFieldOptions,
  addExecutableBehaviorFieldOptions,
  addRegionBehaviorFieldOptions,
  addReservedIncludeOption,
  addSceneFieldOptions,
  addSceneSoundFieldOptions,
  addTileFieldOptions,
  addTokenFieldOptions
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

export function registerScene({ program, dependencies }: RegistrationContext) {
  const { registerOwnershipSet, registerCompendiumImport, registerBatchWriteCommands } =
    createSharedRegistrars(dependencies);
  const scene = program.command("scene").description("Foundry scene commands");
  scene.addHelpText(
    "after",
    "\nResult key (--json): .result.scene (single/write) / .result.scenes[] (list). Embedded placeables nest under .result.<type> (e.g. .result.token, .result.wall) plus .result.sceneId. Action verbs: .result.thumbnail (thumbnail generate — the persisted asset path is .result.thumbnail.storedPath, the file stat-able value; .thumbnail.thumb is the generated data URL and only with --include-thumb) and .result.clearedCount + .result.confirmation (fog reset — confirmation is observed / nothing-to-observe / not-dispatched; reset:true alone is not proof of an observed reset), both alongside .result.sceneId."
  );
  registerOwnershipSet(scene, {
    idFlag: "--scene-id <sceneId>",
    idKey: "sceneId",
    commandName: "scene.ownership.set",
    noun: "scene"
  });
  addNameFilterOption(addPaginationOptions(scene.command("list"))).action(async function listScenes(options: {
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "scene.list",
      params: { ...nameFilterParams(options), ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  scene
    .command("get")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .action(async function getScene(options: { sceneId: string }) {
      await executeRemoteCommand({
        commandName: "scene.get",
        params: { sceneId: options.sceneId },
        command: this,
        dependencies
      });
    });
  scene
    .command("get-many")
    .requiredOption("--ids <list>", "Comma-separated scene ids (atomic: all must exist)", parseIdList)
    .action(async function getManyScenes(options: { ids: string[] }) {
      await executeRemoteCommand({
        commandName: "scene.get-many",
        params: { ids: options.ids },
        command: this,
        dependencies
      });
    });
  addSceneFieldOptions(
    scene
      .command("update")
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .option("--name <name>", "New scene name"),
    "update"
  )
    .option("--patch-json <json>", "Extra scene patch fields (e.g. flags) as a JSON object (merged last)")
    .action(async function updateScene(options: SceneFieldOptions & { sceneId: string; patchJson?: string }) {
      await executeRemoteCommand({
        commandName: "scene.update",
        params: createSceneUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addSceneFieldOptions(
    addIdempotencyKeyOption(scene.command("create")).requiredOption("--name <name>", "Scene name"),
    "create"
  )
    .option("--data-json <json>", "Extra scene fields (e.g. flags) as a JSON object (merged last)")
    .action(async function createSceneCommand(
      options: SceneFieldOptions & { name: string; dataJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.create",
        params: createSceneCreateParams(options),
        command: this,
        dependencies
      });
    });
  addSceneFieldOptions(
    addIdempotencyKeyOption(scene.command("clone"))
      .requiredOption("--scene-id <sceneId>", "Source scene id")
      .option("--name <name>", "Name override for the clone"),
    "clone"
  ).action(async function cloneScene(options: SceneFieldOptions & { sceneId: string }) {
    await executeRemoteCommand({
      commandName: "scene.clone",
      params: createSceneCloneParams(options),
      command: this,
      dependencies
    });
  });
  scene
    .command("delete")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .option("--force", "Allow deleting the active scene")
    .action(async function deleteScene(options: { sceneId: string; force?: boolean }) {
      await executeRemoteCommand({
        commandName: "scene.delete",
        params: { sceneId: options.sceneId, ...(options.force ? { force: true } : {}) },
        command: this,
        dependencies
      });
    });

  scene
    .command("activate")
    .description("Make a scene the active one for the whole world (a no-op reports changed:false)")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .action(async function activateScene(options: { sceneId: string }) {
      await executeRemoteCommand({
        commandName: "scene.activate",
        params: { sceneId: options.sceneId },
        command: this,
        dependencies
      });
    });
  scene
    .command("pull-users")
    .description(
      "Pull users' views to a scene (a broadcast, not a mutation: only currently ONLINE users are reachable and nothing can be confirmed afterwards)"
    )
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .option(
      "--user-ids <list>",
      "Comma-separated user ids to pull (default: every online user); offline users are reported as skipped",
      (value: string) => parseCsvList(value, "--user-ids")
    )
    .action(async function pullUsersToScene(options: { sceneId: string; userIds?: string[] }) {
      await executeRemoteCommand({
        commandName: "scene.pull-users",
        params: {
          sceneId: options.sceneId,
          ...(options.userIds ? { userIds: options.userIds } : {})
        },
        command: this,
        dependencies
      });
    });

  const sceneThumbnail = scene.command("thumbnail").description("Scene thumbnail commands");
  sceneThumbnail
    .command("generate")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .addOption(
      new Option("--width <width>", "Thumbnail width in px (16–1024, default 300)").argParser(parseNumber)
    )
    .addOption(
      new Option("--height <height>", "Thumbnail height in px (16–1024, default 100)").argParser(parseNumber)
    )
    .option(
      "--include-thumb",
      "Include the generated base64 data URL in the response (read it with --json; the SCENE stores the extracted asset path, reported as .thumbnail.storedPath)"
    )
    .action(async function generateSceneThumbnail(options: {
      sceneId: string;
      width?: number;
      height?: number;
      includeThumb?: boolean;
    }) {
      await executeRemoteCommand({
        commandName: "scene.thumbnail.generate",
        params: {
          sceneId: options.sceneId,
          ...(options.width === undefined ? {} : { width: options.width }),
          ...(options.height === undefined ? {} : { height: options.height }),
          ...(options.includeThumb ? { includeThumb: true } : {})
        },
        command: this,
        dependencies
      });
    });

  const sceneFog = scene.command("fog").description("Scene fog of war commands");
  sceneFog
    .command("reset")
    .requiredOption("--scene-id <sceneId>", "Scene id (must be the scene the GM client is viewing)")
    .action(async function resetSceneFog(options: { sceneId: string }) {
      await executeRemoteCommand({
        commandName: "scene.fog.reset",
        params: { sceneId: options.sceneId },
        command: this,
        dependencies
      });
    });

  const sceneToken = scene.command("token").description("Scene-embedded token commands");
  addNameFilterOption(
    addPaginationOptions(sceneToken.command("list").requiredOption("--scene-id <sceneId>", "Scene id"))
  ).action(async function listSceneTokens(options: {
    sceneId: string;
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "scene.token.list",
      params: { sceneId: options.sceneId, ...nameFilterParams(options), ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  sceneToken
    .command("get")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--token-id <tokenId>", "Token id")
    .option(
      "--include <fields>",
      "Comma-separated extra fields to include (allowed: prepared)",
      parseTokenIncludeFields
    )
    .action(async function getSceneToken(options: { sceneId: string; tokenId: string; include?: string[] }) {
      await executeRemoteCommand({
        commandName: "scene.token.get",
        params: {
          sceneId: options.sceneId,
          tokenId: options.tokenId,
          ...(options.include ? { include: options.include } : {})
        },
        command: this,
        dependencies
      });
    });
  addTokenFieldOptions(
    addIdempotencyKeyOption(sceneToken.command("create"))
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .option("--actor-id <actorId>", "Create the token from this actor's prototype token"),
    "create"
  )
    .option("--data-json <json>", "Full/extra token data as a JSON object (merged last)")
    .action(async function createSceneToken(
      options: TokenFieldOptions & { sceneId: string; dataJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.token.create",
        params: createSceneTokenCreateParams(options),
        command: this,
        dependencies
      });
    });
  addTokenFieldOptions(
    sceneToken
      .command("update")
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--token-id <tokenId>", "Token id"),
    "update"
  )
    .option("--patch-json <json>", "Full/extra token patch as a JSON object (merged last)")
    .action(async function updateSceneToken(
      options: TokenFieldOptions & { sceneId: string; tokenId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.token.update",
        params: createSceneTokenUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addTokenFieldOptions(
    addIdempotencyKeyOption(sceneToken.command("clone"))
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--token-id <tokenId>", "Source token id"),
    "clone"
  )
    .option("--patch-json <json>", "Override fields for the clone as a JSON object (merged last)")
    .action(async function cloneSceneToken(
      options: TokenFieldOptions & { sceneId: string; tokenId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.token.clone",
        params: createSceneTokenCloneParams(options),
        command: this,
        dependencies
      });
    });
  sceneToken
    .command("delete")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--token-id <tokenId>", "Token id")
    .action(async function deleteSceneToken(options: { sceneId: string; tokenId: string }) {
      await executeRemoteCommand({
        commandName: "scene.token.delete",
        params: { sceneId: options.sceneId, tokenId: options.tokenId },
        command: this,
        dependencies
      });
    });

  registerBatchWriteCommands(sceneToken, {
    prefix: "scene.token",
    noun: "token",
    dataHelp:
      'Token data as a JSON ARRAY of objects (each may carry actorId, e.g. [{"actorId":"…","x":0,"y":0}])'
  });

  const sceneTokenItem = sceneToken
    .command("item")
    .description("Items on a scene token's effective actor (delta for unlinked tokens)");
  const sceneTokenItemList = sceneTokenItem
    .command("list")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--token-id <tokenId>", "Token id");
  addNameFilterOption(addPaginationOptions(sceneTokenItemList)).action(
    async function listSceneTokenItems(options: {
      sceneId: string;
      tokenId: string;
      name?: string;
      limit?: number;
      offset?: number;
    }) {
      await executeRemoteCommand({
        commandName: "scene.token.item.list",
        params: {
          sceneId: options.sceneId,
          tokenId: options.tokenId,
          ...nameFilterParams(options),
          ...paginationParams(options)
        },
        command: this,
        dependencies
      });
    }
  );
  sceneTokenItem
    .command("get")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--token-id <tokenId>", "Token id")
    .requiredOption("--item-id <itemId>", "Item id")
    .action(async function getSceneTokenItem(options: { sceneId: string; tokenId: string; itemId: string }) {
      await executeRemoteCommand({
        commandName: "scene.token.item.get",
        params: { sceneId: options.sceneId, tokenId: options.tokenId, itemId: options.itemId },
        command: this,
        dependencies
      });
    });
  addReservedIncludeOption(
    addEmbeddedItemFieldOptions(
      addIdempotencyKeyOption(sceneTokenItem.command("create"))
        .requiredOption("--scene-id <sceneId>", "Scene id")
        .requiredOption("--token-id <tokenId>", "Token id")
        .requiredOption("--name <name>", "Item name")
        .requiredOption("--type <type>", "Item type"),
      "create"
    ).option("--data-json <json>", "Extra item fields (e.g. flags, effects) as a JSON object (merged last)"),
    "in the result"
  ).action(async function createSceneTokenItem(options: {
    sceneId: string;
    tokenId: string;
    name: string;
    type: string;
    img?: string;
    sort?: number;
    systemJson?: string;
    dataJson?: string;
    include?: string[];
  }) {
    await executeRemoteCommand({
      commandName: "scene.token.item.create",
      params: {
        sceneId: options.sceneId,
        tokenId: options.tokenId,
        ...createItemCreateParams(options)
      },
      command: this,
      dependencies
    });
  });
  addReservedIncludeOption(
    addEmbeddedItemFieldOptions(
      sceneTokenItem
        .command("update")
        .requiredOption("--scene-id <sceneId>", "Scene id")
        .requiredOption("--token-id <tokenId>", "Token id")
        .requiredOption("--item-id <itemId>", "Item id")
        .option("--name <name>", "New item name"),
      "update"
    ).option("--patch-json <json>", "Extra item patch fields (e.g. flags) as a JSON object (merged last)"),
    "in the result"
  ).action(async function updateSceneTokenItem(options: {
    sceneId: string;
    tokenId: string;
    itemId: string;
    name?: string;
    img?: string;
    sort?: number;
    systemJson?: string;
    patchJson?: string;
    include?: string[];
  }) {
    await executeRemoteCommand({
      commandName: "scene.token.item.update",
      params: {
        sceneId: options.sceneId,
        tokenId: options.tokenId,
        ...createItemUpdateParams(options)
      },
      command: this,
      dependencies
    });
  });
  addEmbeddedItemFieldOptions(
    addIdempotencyKeyOption(sceneTokenItem.command("clone"))
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--token-id <tokenId>", "Token id")
      .requiredOption("--item-id <itemId>", "Source item id")
      .option("--name <name>", "Name override for the clone"),
    "clone"
  ).action(async function cloneSceneTokenItem(options: {
    sceneId: string;
    tokenId: string;
    itemId: string;
    name?: string;
    img?: string;
    sort?: number;
    systemJson?: string;
  }) {
    const patch = {
      ...stringField("name", options.name),
      ...stringField("img", options.img),
      ...numberField("sort", options.sort),
      ...jsonObjectField("system", options.systemJson, "--system-json")
    };
    await executeRemoteCommand({
      commandName: "scene.token.item.clone",
      params: {
        sceneId: options.sceneId,
        tokenId: options.tokenId,
        itemId: options.itemId,
        ...optionalPatch(patch)
      },
      command: this,
      dependencies
    });
  });
  sceneTokenItem
    .command("delete")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--token-id <tokenId>", "Token id")
    .requiredOption("--item-id <itemId>", "Item id")
    .action(async function deleteSceneTokenItem(options: {
      sceneId: string;
      tokenId: string;
      itemId: string;
    }) {
      await executeRemoteCommand({
        commandName: "scene.token.item.delete",
        params: { sceneId: options.sceneId, tokenId: options.tokenId, itemId: options.itemId },
        command: this,
        dependencies
      });
    });

  const sceneTokenItemEffect = sceneTokenItem
    .command("effect")
    .description(
      "ActiveEffects on an item on a placed token (deepest scene nesting → protocol scene.token.item.effect.*)"
    );

  registerBatchWriteCommands(sceneTokenItemEffect, {
    prefix: "scene.token.item.effect",
    noun: "effect",
    scope: "sceneTokenItem"
  });
  addNameFilterOption(
    addPaginationOptions(
      sceneTokenItemEffect
        .command("list")
        .requiredOption("--scene-id <sceneId>", "Scene id")
        .requiredOption("--token-id <tokenId>", "Token id")
        .requiredOption("--item-id <itemId>", "Item id")
    )
  ).action(async function listSceneTokenItemEffects(options: {
    sceneId: string;
    tokenId: string;
    itemId: string;
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "scene.token.item.effect.list",
      params: {
        sceneId: options.sceneId,
        tokenId: options.tokenId,
        itemId: options.itemId,
        ...nameFilterParams(options),
        ...paginationParams(options)
      },
      command: this,
      dependencies
    });
  });
  sceneTokenItemEffect
    .command("get")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--token-id <tokenId>", "Token id")
    .requiredOption("--item-id <itemId>", "Item id")
    .requiredOption("--effect-id <effectId>", "Effect id")
    .action(async function getSceneTokenItemEffect(options: {
      sceneId: string;
      tokenId: string;
      itemId: string;
      effectId: string;
    }) {
      await executeRemoteCommand({
        commandName: "scene.token.item.effect.get",
        params: {
          sceneId: options.sceneId,
          tokenId: options.tokenId,
          itemId: options.itemId,
          effectId: options.effectId
        },
        command: this,
        dependencies
      });
    });
  addEffectFieldOptions(
    addIdempotencyKeyOption(sceneTokenItemEffect.command("create"))
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--token-id <tokenId>", "Token id")
      .requiredOption("--item-id <itemId>", "Item id"),
    "create"
  )
    .option("--data-json <json>", "Effect payload as JSON object (merged last, overrides typed flags)")
    .action(async function createSceneTokenItemEffect(
      options: EffectFieldOptions & { sceneId: string; tokenId: string; itemId: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.token.item.effect.create",
        params: {
          sceneId: options.sceneId,
          tokenId: options.tokenId,
          itemId: options.itemId,
          ...createEffectCreateParams(options)
        },
        command: this,
        dependencies
      });
    });
  addEffectFieldOptions(
    sceneTokenItemEffect
      .command("update")
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--token-id <tokenId>", "Token id")
      .requiredOption("--item-id <itemId>", "Item id")
      .requiredOption("--effect-id <effectId>", "Effect id"),
    "update"
  )
    .option("--patch-json <json>", "Effect patch as JSON object (merged last, overrides typed flags)")
    .action(async function updateSceneTokenItemEffect(
      options: EffectFieldOptions & { sceneId: string; tokenId: string; itemId: string; effectId: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.token.item.effect.update",
        params: {
          sceneId: options.sceneId,
          tokenId: options.tokenId,
          itemId: options.itemId,
          effectId: options.effectId,
          patch: createEffectUpdatePatch(options)
        },
        command: this,
        dependencies
      });
    });
  addEffectFieldOptions(
    addIdempotencyKeyOption(sceneTokenItemEffect.command("clone"))
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--token-id <tokenId>", "Token id")
      .requiredOption("--item-id <itemId>", "Item id")
      .requiredOption("--effect-id <effectId>", "Source effect id"),
    "clone"
  )
    .option("--patch-json <json>", "Effect override as JSON object (merged last, overrides typed flags)")
    .action(async function cloneSceneTokenItemEffect(
      options: EffectFieldOptions & { sceneId: string; tokenId: string; itemId: string; effectId: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.token.item.effect.clone",
        params: {
          sceneId: options.sceneId,
          tokenId: options.tokenId,
          itemId: options.itemId,
          effectId: options.effectId,
          ...createEffectClonePatch(options)
        },
        command: this,
        dependencies
      });
    });
  sceneTokenItemEffect
    .command("delete")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--token-id <tokenId>", "Token id")
    .requiredOption("--item-id <itemId>", "Item id")
    .requiredOption("--effect-id <effectId>", "Effect id")
    .action(async function deleteSceneTokenItemEffect(options: {
      sceneId: string;
      tokenId: string;
      itemId: string;
      effectId: string;
    }) {
      await executeRemoteCommand({
        commandName: "scene.token.item.effect.delete",
        params: {
          sceneId: options.sceneId,
          tokenId: options.tokenId,
          itemId: options.itemId,
          effectId: options.effectId
        },
        command: this,
        dependencies
      });
    });

  const sceneTile = scene.command("tile").description("Scene-embedded tile commands");
  addPaginationOptions(sceneTile.command("list").requiredOption("--scene-id <sceneId>", "Scene id")).action(
    async function listSceneTiles(options: { sceneId: string; limit?: number; offset?: number }) {
      await executeRemoteCommand({
        commandName: "scene.tile.list",
        params: { sceneId: options.sceneId, ...paginationParams(options) },
        command: this,
        dependencies
      });
    }
  );
  sceneTile
    .command("get")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--tile-id <tileId>", "Tile id")
    .action(async function getSceneTile(options: { sceneId: string; tileId: string }) {
      await executeRemoteCommand({
        commandName: "scene.tile.get",
        params: { sceneId: options.sceneId, tileId: options.tileId },
        command: this,
        dependencies
      });
    });
  addTileFieldOptions(
    addIdempotencyKeyOption(sceneTile.command("create")).requiredOption("--scene-id <sceneId>", "Scene id"),
    "create"
  )
    .option("--data-json <json>", "Full/extra tile data as a JSON object (e.g. texture; merged last)")
    .action(async function createSceneTile(
      options: TileFieldOptions & { sceneId: string; dataJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.tile.create",
        params: createSceneTileCreateParams(options),
        command: this,
        dependencies
      });
    });
  addTileFieldOptions(
    sceneTile
      .command("update")
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--tile-id <tileId>", "Tile id"),
    "update"
  )
    .option("--patch-json <json>", "Full/extra tile patch as a JSON object (merged last)")
    .action(async function updateSceneTile(
      options: TileFieldOptions & { sceneId: string; tileId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.tile.update",
        params: createSceneTileUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addTileFieldOptions(
    addIdempotencyKeyOption(sceneTile.command("clone"))
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--tile-id <tileId>", "Source tile id"),
    "clone"
  )
    .option("--patch-json <json>", "Override fields for the clone as a JSON object (merged last)")
    .action(async function cloneSceneTile(
      options: TileFieldOptions & { sceneId: string; tileId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.tile.clone",
        params: createSceneTileCloneParams(options),
        command: this,
        dependencies
      });
    });
  sceneTile
    .command("delete")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--tile-id <tileId>", "Tile id")
    .action(async function deleteSceneTile(options: { sceneId: string; tileId: string }) {
      await executeRemoteCommand({
        commandName: "scene.tile.delete",
        params: { sceneId: options.sceneId, tileId: options.tileId },
        command: this,
        dependencies
      });
    });

  registerBatchWriteCommands(sceneTile, { prefix: "scene.tile", noun: "tile" });

  const sceneSound = scene.command("sound").description("Scene-embedded ambient sound commands");
  addPaginationOptions(sceneSound.command("list").requiredOption("--scene-id <sceneId>", "Scene id")).action(
    async function listSceneSounds(options: { sceneId: string; limit?: number; offset?: number }) {
      await executeRemoteCommand({
        commandName: "scene.sound.list",
        params: { sceneId: options.sceneId, ...paginationParams(options) },
        command: this,
        dependencies
      });
    }
  );
  sceneSound
    .command("get")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--sound-id <soundId>", "Sound id")
    .action(async function getSceneSound(options: { sceneId: string; soundId: string }) {
      await executeRemoteCommand({
        commandName: "scene.sound.get",
        params: { sceneId: options.sceneId, soundId: options.soundId },
        command: this,
        dependencies
      });
    });
  addSceneSoundFieldOptions(
    addIdempotencyKeyOption(sceneSound.command("create")).requiredOption("--scene-id <sceneId>", "Scene id"),
    "create"
  )
    .option("--data-json <json>", "Full/extra sound data as a JSON object (merged last)")
    .action(async function createSceneSound(
      options: SoundFieldOptions & { sceneId: string; dataJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.sound.create",
        params: createSceneSoundCreateParams(options),
        command: this,
        dependencies
      });
    });
  addSceneSoundFieldOptions(
    sceneSound
      .command("update")
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--sound-id <soundId>", "Sound id"),
    "update"
  )
    .option("--patch-json <json>", "Full/extra sound patch as a JSON object (merged last)")
    .action(async function updateSceneSound(
      options: SoundFieldOptions & { sceneId: string; soundId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.sound.update",
        params: createSceneSoundUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addSceneSoundFieldOptions(
    addIdempotencyKeyOption(sceneSound.command("clone"))
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--sound-id <soundId>", "Source sound id"),
    "clone"
  )
    .option("--patch-json <json>", "Override fields for the clone as a JSON object (merged last)")
    .action(async function cloneSceneSound(
      options: SoundFieldOptions & { sceneId: string; soundId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.sound.clone",
        params: createSceneSoundCloneParams(options),
        command: this,
        dependencies
      });
    });
  sceneSound
    .command("delete")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--sound-id <soundId>", "Sound id")
    .action(async function deleteSceneSound(options: { sceneId: string; soundId: string }) {
      await executeRemoteCommand({
        commandName: "scene.sound.delete",
        params: { sceneId: options.sceneId, soundId: options.soundId },
        command: this,
        dependencies
      });
    });

  registerBatchWriteCommands(sceneSound, { prefix: "scene.sound", noun: "sound" });

  const sceneWall = scene.command("wall").description("Scene-embedded wall commands");
  addPaginationOptions(sceneWall.command("list").requiredOption("--scene-id <sceneId>", "Scene id"))
    .addOption(new Option("--door", "Return only doors and secret doors (door > 0)"))
    .action(async function listSceneWalls(options: {
      sceneId: string;
      door?: boolean;
      limit?: number;
      offset?: number;
    }) {
      await executeRemoteCommand({
        commandName: "scene.wall.list",
        params: {
          sceneId: options.sceneId,
          ...(options.door ? { door: true } : {}),
          ...paginationParams(options)
        },
        command: this,
        dependencies
      });
    });
  sceneWall
    .command("get")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--wall-id <wallId>", "Wall id")
    .action(async function getSceneWall(options: { sceneId: string; wallId: string }) {
      await executeRemoteCommand({
        commandName: "scene.wall.get",
        params: { sceneId: options.sceneId, wallId: options.wallId },
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(sceneWall.command("create"))
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .option("--data-json <json>", "Wall data as a JSON object (e.g. c/door/ds/doorSound)")
    .action(async function createSceneWall(options: { sceneId: string; dataJson?: string }) {
      await executeRemoteCommand({
        commandName: "scene.wall.create",
        params: createSceneWallCreateParams(options),
        command: this,
        dependencies
      });
    });
  sceneWall
    .command("update")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--wall-id <wallId>", "Wall id")
    .option("--patch-json <json>", "Wall patch as a JSON object (e.g. doorSound/ds)")
    .action(async function updateSceneWall(options: { sceneId: string; wallId: string; patchJson?: string }) {
      await executeRemoteCommand({
        commandName: "scene.wall.update",
        params: createSceneWallUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(sceneWall.command("clone"))
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--wall-id <wallId>", "Source wall id")
    .option("--patch-json <json>", "Override fields for the clone as a JSON object")
    .action(async function cloneSceneWall(options: { sceneId: string; wallId: string; patchJson?: string }) {
      await executeRemoteCommand({
        commandName: "scene.wall.clone",
        params: createSceneWallCloneParams(options),
        command: this,
        dependencies
      });
    });
  sceneWall
    .command("delete")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--wall-id <wallId>", "Wall id")
    .action(async function deleteSceneWall(options: { sceneId: string; wallId: string }) {
      await executeRemoteCommand({
        commandName: "scene.wall.delete",
        params: { sceneId: options.sceneId, wallId: options.wallId },
        command: this,
        dependencies
      });
    });

  registerBatchWriteCommands(sceneWall, { prefix: "scene.wall", noun: "wall" });

  const sceneNote = scene.command("note").description("Scene-embedded note (map pin) commands");
  addPaginationOptions(sceneNote.command("list").requiredOption("--scene-id <sceneId>", "Scene id")).action(
    async function listSceneNotes(options: { sceneId: string; limit?: number; offset?: number }) {
      await executeRemoteCommand({
        commandName: "scene.note.list",
        params: { sceneId: options.sceneId, ...paginationParams(options) },
        command: this,
        dependencies
      });
    }
  );
  sceneNote
    .command("get")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--note-id <noteId>", "Note id")
    .action(async function getSceneNote(options: { sceneId: string; noteId: string }) {
      await executeRemoteCommand({
        commandName: "scene.note.get",
        params: { sceneId: options.sceneId, noteId: options.noteId },
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(sceneNote.command("create"))
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .option("--data-json <json>", "Note data as a JSON object (e.g. entryId/x/y/text/texture)")
    .action(async function createSceneNote(options: { sceneId: string; dataJson?: string }) {
      await executeRemoteCommand({
        commandName: "scene.note.create",
        params: createSceneNoteCreateParams(options),
        command: this,
        dependencies
      });
    });
  sceneNote
    .command("update")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--note-id <noteId>", "Note id")
    .option("--patch-json <json>", "Note patch as a JSON object (e.g. texture.src/text)")
    .action(async function updateSceneNote(options: { sceneId: string; noteId: string; patchJson?: string }) {
      await executeRemoteCommand({
        commandName: "scene.note.update",
        params: createSceneNoteUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(sceneNote.command("clone"))
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--note-id <noteId>", "Source note id")
    .option("--patch-json <json>", "Override fields for the clone as a JSON object")
    .action(async function cloneSceneNote(options: { sceneId: string; noteId: string; patchJson?: string }) {
      await executeRemoteCommand({
        commandName: "scene.note.clone",
        params: createSceneNoteCloneParams(options),
        command: this,
        dependencies
      });
    });
  sceneNote
    .command("delete")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--note-id <noteId>", "Note id")
    .action(async function deleteSceneNote(options: { sceneId: string; noteId: string }) {
      await executeRemoteCommand({
        commandName: "scene.note.delete",
        params: { sceneId: options.sceneId, noteId: options.noteId },
        command: this,
        dependencies
      });
    });

  registerBatchWriteCommands(sceneNote, { prefix: "scene.note", noun: "note" });

  const sceneDrawing = scene.command("drawing").description("Scene-embedded drawing commands");
  addPaginationOptions(
    sceneDrawing.command("list").requiredOption("--scene-id <sceneId>", "Scene id")
  ).action(async function listSceneDrawings(options: { sceneId: string; limit?: number; offset?: number }) {
    await executeRemoteCommand({
      commandName: "scene.drawing.list",
      params: { sceneId: options.sceneId, ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  sceneDrawing
    .command("get")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--drawing-id <drawingId>", "Drawing id")
    .action(async function getSceneDrawing(options: { sceneId: string; drawingId: string }) {
      await executeRemoteCommand({
        commandName: "scene.drawing.get",
        params: { sceneId: options.sceneId, drawingId: options.drawingId },
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(sceneDrawing.command("create"))
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .option("--data-json <json>", "Drawing data as a JSON object (e.g. shape/text/x/y)")
    .action(async function createSceneDrawing(options: { sceneId: string; dataJson?: string }) {
      await executeRemoteCommand({
        commandName: "scene.drawing.create",
        params: createSceneDrawingCreateParams(options),
        command: this,
        dependencies
      });
    });
  sceneDrawing
    .command("update")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--drawing-id <drawingId>", "Drawing id")
    .option("--patch-json <json>", "Drawing patch as a JSON object (e.g. text/hidden)")
    .action(async function updateSceneDrawing(options: {
      sceneId: string;
      drawingId: string;
      patchJson?: string;
    }) {
      await executeRemoteCommand({
        commandName: "scene.drawing.update",
        params: createSceneDrawingUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(sceneDrawing.command("clone"))
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--drawing-id <drawingId>", "Source drawing id")
    .option("--patch-json <json>", "Override fields for the clone as a JSON object")
    .action(async function cloneSceneDrawing(options: {
      sceneId: string;
      drawingId: string;
      patchJson?: string;
    }) {
      await executeRemoteCommand({
        commandName: "scene.drawing.clone",
        params: createSceneDrawingCloneParams(options),
        command: this,
        dependencies
      });
    });
  sceneDrawing
    .command("delete")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--drawing-id <drawingId>", "Drawing id")
    .action(async function deleteSceneDrawing(options: { sceneId: string; drawingId: string }) {
      await executeRemoteCommand({
        commandName: "scene.drawing.delete",
        params: { sceneId: options.sceneId, drawingId: options.drawingId },
        command: this,
        dependencies
      });
    });

  registerBatchWriteCommands(sceneDrawing, {
    prefix: "scene.drawing",
    noun: "drawing",
    dataHelp:
      'Drawing data as a JSON ARRAY of objects (e.g. [{"shape":{"type":"r","width":100,"height":50},"x":0,"y":0}])'
  });

  const sceneLight = scene.command("light").description("Scene-embedded ambient light commands");
  addPaginationOptions(sceneLight.command("list").requiredOption("--scene-id <sceneId>", "Scene id")).action(
    async function listSceneLights(options: { sceneId: string; limit?: number; offset?: number }) {
      await executeRemoteCommand({
        commandName: "scene.light.list",
        params: { sceneId: options.sceneId, ...paginationParams(options) },
        command: this,
        dependencies
      });
    }
  );
  sceneLight
    .command("get")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--light-id <lightId>", "Light id")
    .action(async function getSceneLight(options: { sceneId: string; lightId: string }) {
      await executeRemoteCommand({
        commandName: "scene.light.get",
        params: { sceneId: options.sceneId, lightId: options.lightId },
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(sceneLight.command("create"))
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .option("--data-json <json>", "Light data as a JSON object (e.g. x/y/config.dim/config.bright)")
    .action(async function createSceneLight(options: { sceneId: string; dataJson?: string }) {
      await executeRemoteCommand({
        commandName: "scene.light.create",
        params: createSceneLightCreateParams(options),
        command: this,
        dependencies
      });
    });
  sceneLight
    .command("update")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--light-id <lightId>", "Light id")
    .option("--patch-json <json>", "Light patch as a JSON object (e.g. config.dim/hidden)")
    .action(async function updateSceneLight(options: {
      sceneId: string;
      lightId: string;
      patchJson?: string;
    }) {
      await executeRemoteCommand({
        commandName: "scene.light.update",
        params: createSceneLightUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(sceneLight.command("clone"))
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--light-id <lightId>", "Source light id")
    .option("--patch-json <json>", "Override fields for the clone as a JSON object")
    .action(async function cloneSceneLight(options: {
      sceneId: string;
      lightId: string;
      patchJson?: string;
    }) {
      await executeRemoteCommand({
        commandName: "scene.light.clone",
        params: createSceneLightCloneParams(options),
        command: this,
        dependencies
      });
    });
  sceneLight
    .command("delete")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--light-id <lightId>", "Light id")
    .action(async function deleteSceneLight(options: { sceneId: string; lightId: string }) {
      await executeRemoteCommand({
        commandName: "scene.light.delete",
        params: { sceneId: options.sceneId, lightId: options.lightId },
        command: this,
        dependencies
      });
    });

  registerBatchWriteCommands(sceneLight, { prefix: "scene.light", noun: "light" });

  const sceneTemplate = scene.command("template").description("Scene-embedded measured template commands");
  addPaginationOptions(
    sceneTemplate.command("list").requiredOption("--scene-id <sceneId>", "Scene id")
  ).action(async function listSceneTemplates(options: { sceneId: string; limit?: number; offset?: number }) {
    await executeRemoteCommand({
      commandName: "scene.template.list",
      params: { sceneId: options.sceneId, ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  sceneTemplate
    .command("get")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--template-id <templateId>", "Template id")
    .action(async function getSceneTemplate(options: { sceneId: string; templateId: string }) {
      await executeRemoteCommand({
        commandName: "scene.template.get",
        params: { sceneId: options.sceneId, templateId: options.templateId },
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(sceneTemplate.command("create"))
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .option("--data-json <json>", "Template data as a JSON object (e.g. t/x/y/distance)")
    .action(async function createSceneTemplate(options: { sceneId: string; dataJson?: string }) {
      await executeRemoteCommand({
        commandName: "scene.template.create",
        params: createSceneTemplateCreateParams(options),
        command: this,
        dependencies
      });
    });
  sceneTemplate
    .command("update")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--template-id <templateId>", "Template id")
    .option("--patch-json <json>", "Template patch as a JSON object (e.g. distance/hidden)")
    .action(async function updateSceneTemplate(options: {
      sceneId: string;
      templateId: string;
      patchJson?: string;
    }) {
      await executeRemoteCommand({
        commandName: "scene.template.update",
        params: createSceneTemplateUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(sceneTemplate.command("clone"))
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--template-id <templateId>", "Source template id")
    .option("--patch-json <json>", "Override fields for the clone as a JSON object")
    .action(async function cloneSceneTemplate(options: {
      sceneId: string;
      templateId: string;
      patchJson?: string;
    }) {
      await executeRemoteCommand({
        commandName: "scene.template.clone",
        params: createSceneTemplateCloneParams(options),
        command: this,
        dependencies
      });
    });
  sceneTemplate
    .command("delete")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--template-id <templateId>", "Template id")
    .action(async function deleteSceneTemplate(options: { sceneId: string; templateId: string }) {
      await executeRemoteCommand({
        commandName: "scene.template.delete",
        params: { sceneId: options.sceneId, templateId: options.templateId },
        command: this,
        dependencies
      });
    });

  registerBatchWriteCommands(sceneTemplate, { prefix: "scene.template", noun: "template" });

  const sceneRegion = scene.command("region").description("Scene-embedded region commands");
  sceneRegion.addHelpText(
    "after",
    '\n`behaviors` must be the plain `behaviors` key carrying an ARRAY in --data-json/--patch-json. Dotted keys ("behaviors.0.type") and Foundry\'s operator spellings ("==behaviors"/"-=behaviors") are refused with INVALID_PARAMS: a dotted key APPENDS a brand-new behavior instead of editing the row it names (or silently changes nothing), and both bypass the guard that refuses code-executing behavior types.' +
      "\nTo edit or remove ONE behavior use `scene region behavior update` / `scene region behavior delete`; the inline array replaces the whole collection."
  );
  addNameFilterOption(
    addPaginationOptions(sceneRegion.command("list").requiredOption("--scene-id <sceneId>", "Scene id"))
  ).action(async function listSceneRegions(options: {
    sceneId: string;
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "scene.region.list",
      params: { sceneId: options.sceneId, ...nameFilterParams(options), ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  sceneRegion
    .command("get")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--region-id <regionId>", "Region id")
    .action(async function getSceneRegion(options: { sceneId: string; regionId: string }) {
      await executeRemoteCommand({
        commandName: "scene.region.get",
        params: { sceneId: options.sceneId, regionId: options.regionId },
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(sceneRegion.command("create"))
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .option("--data-json <json>", "Region data as a JSON object (e.g. name/shapes/behaviors)")
    .action(async function createSceneRegion(options: { sceneId: string; dataJson?: string }) {
      await executeRemoteCommand({
        commandName: "scene.region.create",
        params: createSceneRegionCreateParams(options),
        command: this,
        dependencies
      });
    });
  sceneRegion
    .command("update")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--region-id <regionId>", "Region id")
    .option("--patch-json <json>", "Region patch as a JSON object (e.g. name/color/visibility)")
    .action(async function updateSceneRegion(options: {
      sceneId: string;
      regionId: string;
      patchJson?: string;
    }) {
      await executeRemoteCommand({
        commandName: "scene.region.update",
        params: createSceneRegionUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(sceneRegion.command("clone"))
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--region-id <regionId>", "Source region id")
    .option("--patch-json <json>", "Override fields for the clone as a JSON object")
    .action(async function cloneSceneRegion(options: {
      sceneId: string;
      regionId: string;
      patchJson?: string;
    }) {
      await executeRemoteCommand({
        commandName: "scene.region.clone",
        params: createSceneRegionCloneParams(options),
        command: this,
        dependencies
      });
    });
  sceneRegion
    .command("delete")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--region-id <regionId>", "Region id")
    .action(async function deleteSceneRegion(options: { sceneId: string; regionId: string }) {
      await executeRemoteCommand({
        commandName: "scene.region.delete",
        params: { sceneId: options.sceneId, regionId: options.regionId },
        command: this,
        dependencies
      });
    });

  registerBatchWriteCommands(sceneRegion, {
    prefix: "scene.region",
    noun: "region",
    dataHelp: 'Region data as a JSON ARRAY of objects (e.g. [{"name":"Lava","shapes":[…]}])'
  });

  const sceneRegionBehavior = sceneRegion
    .command("behavior")
    .description("Region-embedded behavior commands (what a region DOES when it fires)");
  sceneRegionBehavior.addHelpText(
    "after",
    "\nResult key (--json): .result.behavior (single/write) / .result.behaviors[] (list), with .result.sceneId and .result.regionId alongside." +
      '\nA behavior name may legitimately be BLANK (Foundry then displays the localized type label): pass --name "" to author one; the CLI prints it as (blank).' +
      "\n--type is CREATE-ONLY, so update/clone have no --type. If a --patch-json carries a `type` key it is refused even when it restates the current type: drop the key and resend (an unchanged type is a no-op for Foundry). On this family changing a behavior's type is impossible — for that, create the new behavior and delete the old one." +
      "\nThe code-executing types executeScript and executeMacro are REFUSED on THIS family whenever you supply them, and every patch on an existing one is refused too (even --disabled). executeScript is refused everywhere — it runs its source in every connected player's browser. For executeMacro use `scene region behavior executable`; delete removes either type." +
      "\nclone with NO patch flags IS allowed on any behavior — note that cloning a code-executing one mints a NEW self-arming auto-trigger, so audit the region afterwards."
  );
  addNameFilterOption(
    addPaginationOptions(
      sceneRegionBehavior
        .command("list")
        .requiredOption("--scene-id <sceneId>", "Scene id")
        .requiredOption("--region-id <regionId>", "Region id")
    )
  ).action(async function listSceneRegionBehaviors(options: {
    sceneId: string;
    regionId: string;
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "scene.region.behavior.list",
      params: {
        sceneId: options.sceneId,
        regionId: options.regionId,
        ...nameFilterParams(options),
        ...paginationParams(options)
      },
      command: this,
      dependencies
    });
  });
  sceneRegionBehavior
    .command("get")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--region-id <regionId>", "Region id")
    .requiredOption("--behavior-id <behaviorId>", "Behavior id")
    .action(async function getSceneRegionBehavior(options: {
      sceneId: string;
      regionId: string;
      behaviorId: string;
    }) {
      await executeRemoteCommand({
        commandName: "scene.region.behavior.get",
        params: { sceneId: options.sceneId, regionId: options.regionId, behaviorId: options.behaviorId },
        command: this,
        dependencies
      });
    });
  addRegionBehaviorFieldOptions(
    addIdempotencyKeyOption(sceneRegionBehavior.command("create"))
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--region-id <regionId>", "Region id")
      // REQUIRED: Foundry throws on an omitted/blank/unregistered behavior type (measured on both
      // installs). Not an enum here — the core type list differs by version and a system/module may
      // register more, so the installed core decides what validates.
      .requiredOption(
        "--type <type>",
        "Behavior type, e.g. pauseGame / adjustDarknessLevel / teleportToken (executeScript and executeMacro are refused)"
      ),
    "create"
  )
    .option("--data-json <json>", "Full/extra behavior data as a JSON object (merged last)")
    .action(async function createSceneRegionBehavior(
      options: RegionBehaviorFieldOptions & {
        sceneId: string;
        regionId: string;
        type: string;
        dataJson?: string;
      }
    ) {
      await executeRemoteCommand({
        commandName: "scene.region.behavior.create",
        params: createSceneRegionBehaviorCreateParams(options),
        command: this,
        dependencies
      });
    });
  addRegionBehaviorFieldOptions(
    sceneRegionBehavior
      .command("update")
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--region-id <regionId>", "Region id")
      .requiredOption("--behavior-id <behaviorId>", "Behavior id"),
    "update"
  )
    .option("--patch-json <json>", "Full/extra behavior patch as a JSON object (merged last)")
    .action(async function updateSceneRegionBehavior(
      options: RegionBehaviorFieldOptions & {
        sceneId: string;
        regionId: string;
        behaviorId: string;
        patchJson?: string;
      }
    ) {
      await executeRemoteCommand({
        commandName: "scene.region.behavior.update",
        params: createSceneRegionBehaviorUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addRegionBehaviorFieldOptions(
    addIdempotencyKeyOption(sceneRegionBehavior.command("clone"))
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--region-id <regionId>", "Region id")
      .requiredOption("--behavior-id <behaviorId>", "Source behavior id"),
    "clone"
  )
    .option("--patch-json <json>", "Override fields for the clone as a JSON object (merged last)")
    .action(async function cloneSceneRegionBehavior(
      options: RegionBehaviorFieldOptions & {
        sceneId: string;
        regionId: string;
        behaviorId: string;
        patchJson?: string;
      }
    ) {
      await executeRemoteCommand({
        commandName: "scene.region.behavior.clone",
        params: createSceneRegionBehaviorCloneParams(options),
        command: this,
        dependencies
      });
    });
  sceneRegionBehavior
    .command("delete")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--region-id <regionId>", "Region id")
    .requiredOption("--behavior-id <behaviorId>", "Behavior id")
    .action(async function deleteSceneRegionBehavior(options: {
      sceneId: string;
      regionId: string;
      behaviorId: string;
    }) {
      await executeRemoteCommand({
        commandName: "scene.region.behavior.delete",
        params: { sceneId: options.sceneId, regionId: options.regionId, behaviorId: options.behaviorId },
        command: this,
        dependencies
      });
    });

  const executableBehavior = sceneRegionBehavior
    .command("executable")
    .description("Region behaviors that RUN A MACRO when the region fires");
  executableBehavior.addHelpText(
    "after",
    "\nResult key (--json): .result.behavior, with .result.sceneId and .result.regionId alongside — the same shape the ordinary behavior verbs return." +
      "\nThese three verbs are the only route to an executeMacro behavior. The type is fixed: there is no --type, and the behavior cannot be turned into another type later." +
      "\n--macro-uuid must name a macro in THIS world (e.g. Macro.abc123); a compendium macro or a missing uuid is refused, so the behavior never arms a trigger that points at nothing." +
      "\n--events decides WHEN the macro runs (e.g. tokenEnter), and --everyone true runs it in EVERY connected client instead of one elected executor — read it as: every player's browser executes that macro." +
      "\nclone with no patch flags mints a second armed trigger on the same region; audit the region afterwards."
  );
  addExecutableBehaviorFieldOptions(
    addIdempotencyKeyOption(executableBehavior.command("create"))
      .description("Arm a region with an executeMacro behavior")
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--region-id <regionId>", "Region id"),
    "create"
  )
    .option("--data-json <json>", "Full/extra behavior data as a JSON object (merged last)")
    .action(async function createExecutableBehavior(
      options: ExecutableBehaviorFieldOptions & {
        sceneId: string;
        regionId: string;
        dataJson?: string;
      }
    ) {
      await executeRemoteCommand({
        commandName: "scene.region.behavior.executable.create",
        params: createExecutableBehaviorCreateParams(options),
        command: this,
        dependencies
      });
    });
  addExecutableBehaviorFieldOptions(
    executableBehavior
      .command("update")
      .description("Edit an executeMacro behavior (the only route the ordinary update refuses)")
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--region-id <regionId>", "Region id")
      .requiredOption("--behavior-id <behaviorId>", "Behavior id"),
    "update"
  )
    .option("--patch-json <json>", "Full/extra behavior patch as a JSON object (merged last)")
    .action(async function updateExecutableBehavior(
      options: ExecutableBehaviorFieldOptions & {
        sceneId: string;
        regionId: string;
        behaviorId: string;
        patchJson?: string;
      }
    ) {
      await executeRemoteCommand({
        commandName: "scene.region.behavior.executable.update",
        params: createExecutableBehaviorUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addExecutableBehaviorFieldOptions(
    addIdempotencyKeyOption(executableBehavior.command("clone"))
      .description("Copy an executeMacro behavior into a second armed trigger")
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--region-id <regionId>", "Region id")
      .requiredOption("--behavior-id <behaviorId>", "Source behavior id"),
    "clone"
  )
    .option("--patch-json <json>", "Override fields for the clone as a JSON object (merged last)")
    .action(async function cloneExecutableBehavior(
      options: ExecutableBehaviorFieldOptions & {
        sceneId: string;
        regionId: string;
        behaviorId: string;
        patchJson?: string;
      }
    ) {
      await executeRemoteCommand({
        commandName: "scene.region.behavior.executable.clone",
        params: createExecutableBehaviorCloneParams(options),
        command: this,
        dependencies
      });
    });

  registerCompendiumImport(scene, {
    commandName: "scene.import-from-compendium",
    noun: "scene",
    packExample: "dnd5e.scenes"
  });

  const sceneTokenEffect = sceneToken
    .command("effect")
    .description("Placed-token ActiveEffect commands (protocol scene.token.effect.*)");

  registerBatchWriteCommands(sceneTokenEffect, {
    prefix: "scene.token.effect",
    noun: "effect",
    scope: "sceneToken"
  });
  addNameFilterOption(
    addPaginationOptions(
      sceneTokenEffect
        .command("list")
        .requiredOption("--scene-id <sceneId>", "Scene id")
        .requiredOption("--token-id <tokenId>", "Token id")
    )
  ).action(async function listSceneTokenEffects(options: {
    sceneId: string;
    tokenId: string;
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "scene.token.effect.list",
      params: {
        sceneId: options.sceneId,
        tokenId: options.tokenId,
        ...nameFilterParams(options),
        ...paginationParams(options)
      },
      command: this,
      dependencies
    });
  });
  addPaginationOptions(
    sceneTokenEffect
      .command("applied")
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--token-id <tokenId>", "Token id")
  ).action(async function listAppliedSceneTokenEffects(options: {
    sceneId: string;
    tokenId: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "scene.token.effect.applied",
      params: { sceneId: options.sceneId, tokenId: options.tokenId, ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  sceneTokenEffect
    .command("get")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--token-id <tokenId>", "Token id")
    .requiredOption("--effect-id <effectId>", "Effect id")
    .action(async function getSceneTokenEffect(options: {
      sceneId: string;
      tokenId: string;
      effectId: string;
    }) {
      await executeRemoteCommand({
        commandName: "scene.token.effect.get",
        params: { sceneId: options.sceneId, tokenId: options.tokenId, effectId: options.effectId },
        command: this,
        dependencies
      });
    });
  addEffectFieldOptions(
    addIdempotencyKeyOption(sceneTokenEffect.command("create"))
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--token-id <tokenId>", "Token id"),
    "create"
  )
    .option("--data-json <json>", "Effect payload as JSON object (merged last, overrides typed flags)")
    .action(async function createSceneTokenEffect(
      options: EffectFieldOptions & { sceneId: string; tokenId: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.token.effect.create",
        params: { sceneId: options.sceneId, tokenId: options.tokenId, ...createEffectCreateParams(options) },
        command: this,
        dependencies
      });
    });
  addEffectFieldOptions(
    sceneTokenEffect
      .command("update")
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--token-id <tokenId>", "Token id")
      .requiredOption("--effect-id <effectId>", "Effect id"),
    "update"
  )
    .option("--patch-json <json>", "Effect patch as JSON object (merged last, overrides typed flags)")
    .action(async function updateSceneTokenEffect(
      options: EffectFieldOptions & { sceneId: string; tokenId: string; effectId: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.token.effect.update",
        params: {
          sceneId: options.sceneId,
          tokenId: options.tokenId,
          effectId: options.effectId,
          patch: createEffectUpdatePatch(options)
        },
        command: this,
        dependencies
      });
    });
  addEffectFieldOptions(
    addIdempotencyKeyOption(sceneTokenEffect.command("clone"))
      .requiredOption("--scene-id <sceneId>", "Scene id")
      .requiredOption("--token-id <tokenId>", "Token id")
      .requiredOption("--effect-id <effectId>", "Source effect id"),
    "clone"
  )
    .option("--patch-json <json>", "Effect override as JSON object (merged last, overrides typed flags)")
    .action(async function cloneSceneTokenEffect(
      options: EffectFieldOptions & { sceneId: string; tokenId: string; effectId: string }
    ) {
      await executeRemoteCommand({
        commandName: "scene.token.effect.clone",
        params: {
          sceneId: options.sceneId,
          tokenId: options.tokenId,
          effectId: options.effectId,
          ...createEffectClonePatch(options)
        },
        command: this,
        dependencies
      });
    });
  sceneTokenEffect
    .command("delete")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .requiredOption("--token-id <tokenId>", "Token id")
    .requiredOption("--effect-id <effectId>", "Effect id")
    .action(async function deleteSceneTokenEffect(options: {
      sceneId: string;
      tokenId: string;
      effectId: string;
    }) {
      await executeRemoteCommand({
        commandName: "scene.token.effect.delete",
        params: { sceneId: options.sceneId, tokenId: options.tokenId, effectId: options.effectId },
        command: this,
        dependencies
      });
    });
}
