import {
  cloneEmbeddedEffect,
  createEmbeddedEffect,
  deleteEmbeddedEffect,
  getEmbeddedEffect,
  previewEmbeddedEffectCreate,
  previewEmbeddedEffectUpdate,
  updateEmbeddedEffect
} from "../lib/effects.js";
import { getEmbeddedItem } from "../lib/embedded-items.js";
import { getActorById } from "../lib/game-collections.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { createEmbeddedEffectBatchHandlers } from "./effect-batch.js";
import {
  filterByName,
  paginate,
  serializeActiveEffect,
  serializeActiveEffectSummary
} from "../lib/serializers.js";

function resolveParentItem(params) {
  return getEmbeddedItem(getActorById(params.actorId), params.itemId, { actorId: params.actorId });
}

export function createActorItemEffectHandlers() {
  return {
    ...createEmbeddedEffectBatchHandlers({
      prefix: "actor.item.effect",
      resolve: (params) => ({
        parent: resolveParentItem(params),
        scope: { actorId: params.actorId, itemId: params.itemId }
      })
    }),

    async "actor.item.effect.list"(params) {
      const item = resolveParentItem(params);
      const effects = filterByName(Array.from(item.effects ?? []), params.name);
      const { page, total, hasMore } = paginate(effects, params);
      return {
        actorId: params.actorId,
        itemId: params.itemId,
        effects: page.map((effect) => serializeActiveEffectSummary(effect)),
        total,
        hasMore
      };
    },

    async "actor.item.effect.get"(params) {
      const effect = getEmbeddedEffect(resolveParentItem(params), params.effectId, {
        actorId: params.actorId,
        itemId: params.itemId
      });
      return { actorId: params.actorId, itemId: params.itemId, effect: serializeActiveEffect(effect) };
    },

    async "actor.item.effect.create"(params) {
      const parent = resolveParentItem(params);
      const effect = await createEmbeddedEffect(parent, params.data, { dryRun: isDryRun(params) });
      const result = {
        actorId: params.actorId,
        itemId: params.itemId,
        effect: serializeActiveEffect(effect)
      };
      if (isDryRun(params)) {
        const preview = previewEmbeddedEffectCreate(parent, params.data);
        return dryRunResponse({ ...result, effect: serializeActiveEffect(preview) });
      }
      return result;
    },

    async "actor.item.effect.update"(params) {
      const parent = resolveParentItem(params);
      const effect = await updateEmbeddedEffect(
        parent,
        params.effectId,
        params.patch,
        { actorId: params.actorId, itemId: params.itemId },
        { dryRun: isDryRun(params) }
      );
      const result = {
        actorId: params.actorId,
        itemId: params.itemId,
        effect: serializeActiveEffect(effect)
      };
      if (isDryRun(params)) {
        const preview = await previewEmbeddedEffectUpdate(parent, effect, params.patch);
        return dryRunResponse({ ...result, effect: serializeActiveEffect(preview) });
      }
      return result;
    },

    async "actor.item.effect.clone"(params) {
      const clone = await cloneEmbeddedEffect(
        resolveParentItem(params),
        params.effectId,
        params.patch ?? {},
        { actorId: params.actorId, itemId: params.itemId },
        { dryRun: isDryRun(params) }
      );
      const result = {
        actorId: params.actorId,
        itemId: params.itemId,
        effect: serializeActiveEffect(clone)
      };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "actor.item.effect.delete"(params) {
      await deleteEmbeddedEffect(
        resolveParentItem(params),
        params.effectId,
        { actorId: params.actorId, itemId: params.itemId },
        { dryRun: isDryRun(params) }
      );
      const result = {
        actorId: params.actorId,
        itemId: params.itemId,
        id: params.effectId,
        deleted: !isDryRun(params)
      };
      return isDryRun(params) ? dryRunResponse(result) : result;
    }
  };
}
