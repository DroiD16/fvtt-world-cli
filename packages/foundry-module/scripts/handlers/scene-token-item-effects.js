import {
  cloneEmbeddedEffect,
  createEmbeddedEffect,
  deleteEmbeddedEffect,
  getEmbeddedEffect,
  previewEmbeddedEffectCreate,
  previewEmbeddedEffectUpdate,
  updateEmbeddedEffect
} from "../lib/effects.js";
import { getEmbeddedItem, getSceneTokenActor } from "../lib/embedded-items.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { createEmbeddedEffectBatchHandlers } from "./effect-batch.js";
import {
  filterByName,
  paginate,
  serializeActiveEffect,
  serializeActiveEffectSummary
} from "../lib/serializers.js";

function resolveParentItem(params) {
  const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);
  const item = getEmbeddedItem(actor, params.itemId, {
    sceneId: params.sceneId,
    tokenId: params.tokenId
  });
  return { item, actorLink };
}

function tokenItemEffectDurability(actorLink) {
  if (actorLink) {
    return { nonDurable: false };
  }
  return {
    nonDurable: true,
    warning:
      "Item-parented ActiveEffects on an unlinked token are NOT durable: they are dropped by any later mutation of the shared world actor (a Foundry ActorDelta limitation) — use scene.token.effect.* for durable token-local effects, or a linked token."
  };
}

export function createSceneTokenItemEffectHandlers() {
  return {
    ...createEmbeddedEffectBatchHandlers({
      prefix: "scene.token.item.effect",
      resolve: (params) => {
        const { item, actorLink } = resolveParentItem(params);
        return {
          parent: item,
          scope: { sceneId: params.sceneId, tokenId: params.tokenId, itemId: params.itemId },
          extra: { actorLink, mutatesWorldActor: actorLink, ...tokenItemEffectDurability(actorLink) }
        };
      }
    }),

    async "scene.token.item.effect.list"(params) {
      const { item, actorLink } = resolveParentItem(params);
      const effects = filterByName(Array.from(item.effects ?? []), params.name);
      const { page, total, hasMore } = paginate(effects, params);
      return {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        itemId: params.itemId,
        actorLink,
        effects: page.map((effect) => serializeActiveEffectSummary(effect)),
        total,
        hasMore
      };
    },

    async "scene.token.item.effect.get"(params) {
      const { item, actorLink } = resolveParentItem(params);
      const effect = getEmbeddedEffect(item, params.effectId, {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        itemId: params.itemId
      });
      return {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        itemId: params.itemId,
        actorLink,
        effect: serializeActiveEffect(effect)
      };
    },

    async "scene.token.item.effect.create"(params) {
      const { item, actorLink } = resolveParentItem(params);
      const effect = await createEmbeddedEffect(item, params.data, { dryRun: isDryRun(params) });
      const result = {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        itemId: params.itemId,
        actorLink,
        mutatesWorldActor: actorLink,
        ...tokenItemEffectDurability(actorLink),
        effect: serializeActiveEffect(effect)
      };
      if (isDryRun(params)) {
        const preview = previewEmbeddedEffectCreate(item, params.data);
        return dryRunResponse({ ...result, effect: serializeActiveEffect(preview) });
      }
      return result;
    },

    async "scene.token.item.effect.update"(params) {
      const { item, actorLink } = resolveParentItem(params);
      const effect = await updateEmbeddedEffect(
        item,
        params.effectId,
        params.patch,
        {
          sceneId: params.sceneId,
          tokenId: params.tokenId,
          itemId: params.itemId
        },
        { dryRun: isDryRun(params) }
      );
      const result = {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        itemId: params.itemId,
        actorLink,
        mutatesWorldActor: actorLink,
        ...tokenItemEffectDurability(actorLink),
        effect: serializeActiveEffect(effect)
      };
      if (isDryRun(params)) {
        const preview = await previewEmbeddedEffectUpdate(item, effect, params.patch);
        return dryRunResponse({ ...result, effect: serializeActiveEffect(preview) });
      }
      return result;
    },

    async "scene.token.item.effect.clone"(params) {
      const { item, actorLink } = resolveParentItem(params);
      const clone = await cloneEmbeddedEffect(
        item,
        params.effectId,
        params.patch ?? {},
        {
          sceneId: params.sceneId,
          tokenId: params.tokenId,
          itemId: params.itemId
        },
        { dryRun: isDryRun(params) }
      );
      const result = {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        itemId: params.itemId,
        actorLink,
        mutatesWorldActor: actorLink,
        ...tokenItemEffectDurability(actorLink),
        effect: serializeActiveEffect(clone)
      };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "scene.token.item.effect.delete"(params) {
      const { item, actorLink } = resolveParentItem(params);
      await deleteEmbeddedEffect(
        item,
        params.effectId,
        {
          sceneId: params.sceneId,
          tokenId: params.tokenId,
          itemId: params.itemId
        },
        { dryRun: isDryRun(params) }
      );
      const result = {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        itemId: params.itemId,
        actorLink,
        mutatesWorldActor: actorLink,
        id: params.effectId,
        deleted: !isDryRun(params)
      };
      return isDryRun(params) ? dryRunResponse(result) : result;
    }
  };
}
