import {
  cloneEmbeddedEffect,
  createEmbeddedEffect,
  deleteEmbeddedEffect,
  getEmbeddedEffect,
  previewEmbeddedEffectCreate,
  previewEmbeddedEffectUpdate,
  updateEmbeddedEffect
} from "../lib/effects.js";
import { getActorById } from "../lib/game-collections.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { createEmbeddedEffectBatchHandlers } from "./effect-batch.js";
import {
  filterByName,
  paginate,
  serializeActiveEffect,
  serializeActiveEffectSummary,
  serializeAppliedEffectSummary
} from "../lib/serializers.js";

export function createActorEffectHandlers() {
  return {
    ...createEmbeddedEffectBatchHandlers({
      prefix: "actor.effect",
      resolve: (params) => ({
        parent: getActorById(params.actorId),
        scope: { actorId: params.actorId }
      })
    }),

    async "actor.effect.list"(params) {
      const actor = getActorById(params.actorId);
      const effects = filterByName(Array.from(actor.effects ?? []), params.name);
      const { page, total, hasMore } = paginate(effects, params);
      return {
        actorId: actor.id ?? params.actorId,
        effects: page.map((effect) => serializeActiveEffectSummary(effect)),
        total,
        hasMore
      };
    },

    async "actor.effect.applied"(params) {
      const actor = getActorById(params.actorId);

      const all = Array.from(actor.allApplicableEffects?.() ?? actor.appliedEffects ?? actor.effects ?? []);
      const { page, total, hasMore } = paginate(all, params);
      return {
        actorId: actor.id ?? params.actorId,
        effects: page.map((effect) => serializeAppliedEffectSummary(effect)),
        total,
        hasMore
      };
    },

    async "actor.effect.get"(params) {
      const effect = getEmbeddedEffect(getActorById(params.actorId), params.effectId, {
        actorId: params.actorId
      });
      return { actorId: params.actorId, effect: serializeActiveEffect(effect) };
    },

    async "actor.effect.create"(params) {
      const parent = getActorById(params.actorId);
      const effect = await createEmbeddedEffect(parent, params.data, { dryRun: isDryRun(params) });
      const result = { actorId: params.actorId, effect: serializeActiveEffect(effect) };
      if (isDryRun(params)) {
        const preview = previewEmbeddedEffectCreate(parent, params.data);
        return dryRunResponse({ ...result, effect: serializeActiveEffect(preview) });
      }
      return result;
    },

    async "actor.effect.update"(params) {
      const parent = getActorById(params.actorId);
      const effect = await updateEmbeddedEffect(
        parent,
        params.effectId,
        params.patch,
        { actorId: params.actorId },
        { dryRun: isDryRun(params) }
      );
      const result = { actorId: params.actorId, effect: serializeActiveEffect(effect) };
      if (isDryRun(params)) {
        const preview = await previewEmbeddedEffectUpdate(parent, effect, params.patch);
        return dryRunResponse({ ...result, effect: serializeActiveEffect(preview) });
      }
      return result;
    },

    async "actor.effect.clone"(params) {
      const clone = await cloneEmbeddedEffect(
        getActorById(params.actorId),
        params.effectId,
        params.patch ?? {},
        { actorId: params.actorId },
        { dryRun: isDryRun(params) }
      );
      const result = { actorId: params.actorId, effect: serializeActiveEffect(clone) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "actor.effect.delete"(params) {
      await deleteEmbeddedEffect(
        getActorById(params.actorId),
        params.effectId,
        { actorId: params.actorId },
        { dryRun: isDryRun(params) }
      );
      const result = { actorId: params.actorId, id: params.effectId, deleted: !isDryRun(params) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    }
  };
}
