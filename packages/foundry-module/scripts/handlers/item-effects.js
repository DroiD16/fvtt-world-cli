import {
  cloneEmbeddedEffect,
  createEmbeddedEffect,
  deleteEmbeddedEffect,
  getEmbeddedEffect,
  previewEmbeddedEffectCreate,
  previewEmbeddedEffectUpdate,
  updateEmbeddedEffect
} from "../lib/effects.js";
import { getItemById } from "../lib/game-collections.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { createEmbeddedEffectBatchHandlers } from "./effect-batch.js";
import {
  filterByName,
  paginate,
  serializeActiveEffect,
  serializeActiveEffectSummary
} from "../lib/serializers.js";

export function createItemEffectHandlers() {
  return {
    ...createEmbeddedEffectBatchHandlers({
      prefix: "item.effect",
      resolve: (params) => ({
        parent: getItemById(params.itemId),
        scope: { itemId: params.itemId }
      })
    }),

    async "item.effect.list"(params) {
      const item = getItemById(params.itemId);
      const effects = filterByName(Array.from(item.effects ?? []), params.name);
      const { page, total, hasMore } = paginate(effects, params);
      return {
        itemId: item.id ?? params.itemId,
        effects: page.map((effect) => serializeActiveEffectSummary(effect)),
        total,
        hasMore
      };
    },

    async "item.effect.get"(params) {
      const effect = getEmbeddedEffect(getItemById(params.itemId), params.effectId, {
        itemId: params.itemId
      });
      return { itemId: params.itemId, effect: serializeActiveEffect(effect) };
    },

    async "item.effect.create"(params) {
      const parent = getItemById(params.itemId);
      const effect = await createEmbeddedEffect(parent, params.data, { dryRun: isDryRun(params) });
      const result = { itemId: params.itemId, effect: serializeActiveEffect(effect) };
      if (isDryRun(params)) {
        const preview = previewEmbeddedEffectCreate(parent, params.data);
        return dryRunResponse({ ...result, effect: serializeActiveEffect(preview) });
      }
      return result;
    },

    async "item.effect.update"(params) {
      const parent = getItemById(params.itemId);
      const effect = await updateEmbeddedEffect(
        parent,
        params.effectId,
        params.patch,
        { itemId: params.itemId },
        { dryRun: isDryRun(params) }
      );
      const result = { itemId: params.itemId, effect: serializeActiveEffect(effect) };
      if (isDryRun(params)) {
        const preview = await previewEmbeddedEffectUpdate(parent, effect, params.patch);
        return dryRunResponse({ ...result, effect: serializeActiveEffect(preview) });
      }
      return result;
    },

    async "item.effect.clone"(params) {
      const clone = await cloneEmbeddedEffect(
        getItemById(params.itemId),
        params.effectId,
        params.patch ?? {},
        { itemId: params.itemId },
        { dryRun: isDryRun(params) }
      );
      const result = { itemId: params.itemId, effect: serializeActiveEffect(clone) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "item.effect.delete"(params) {
      await deleteEmbeddedEffect(
        getItemById(params.itemId),
        params.effectId,
        { itemId: params.itemId },
        { dryRun: isDryRun(params) }
      );
      const result = { itemId: params.itemId, id: params.effectId, deleted: !isDryRun(params) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    }
  };
}
