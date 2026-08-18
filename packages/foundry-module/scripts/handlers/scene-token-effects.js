import {
  cloneEmbeddedEffect,
  createEmbeddedEffect,
  deleteEmbeddedEffect,
  getEmbeddedEffect,
  previewEmbeddedEffectCreate,
  previewEmbeddedEffectUpdate,
  updateEmbeddedEffect
} from "../lib/effects.js";
import { getSceneTokenActor } from "../lib/embedded-items.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { createEmbeddedEffectBatchHandlers } from "./effect-batch.js";
import {
  filterByName,
  paginate,
  serializeActiveEffect,
  serializeActiveEffectSummary,
  serializeAppliedEffectSummary
} from "../lib/serializers.js";

export function createSceneTokenEffectHandlers() {
  return {
    ...createEmbeddedEffectBatchHandlers({
      prefix: "scene.token.effect",
      resolve: (params) => {
        const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);
        return {
          parent: actor,
          scope: { sceneId: params.sceneId, tokenId: params.tokenId },
          extra: { actorLink, mutatesWorldActor: actorLink }
        };
      }
    }),

    async "scene.token.effect.list"(params) {
      const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);
      const effects = filterByName(Array.from(actor.effects ?? []), params.name);
      const { page, total, hasMore } = paginate(effects, params);
      return {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        actorLink,
        effects: page.map((effect) => serializeActiveEffectSummary(effect)),
        total,
        hasMore
      };
    },

    async "scene.token.effect.applied"(params) {
      const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);
      const all = Array.from(actor.allApplicableEffects?.() ?? actor.appliedEffects ?? actor.effects ?? []);
      const { page, total, hasMore } = paginate(all, params);
      return {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        actorLink,
        effects: page.map((effect) => serializeAppliedEffectSummary(effect)),
        total,
        hasMore
      };
    },

    async "scene.token.effect.get"(params) {
      const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);
      const effect = getEmbeddedEffect(actor, params.effectId, {
        sceneId: params.sceneId,
        tokenId: params.tokenId
      });
      return {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        actorLink,
        effect: serializeActiveEffect(effect)
      };
    },

    async "scene.token.effect.create"(params) {
      const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);
      const effect = await createEmbeddedEffect(actor, params.data, { dryRun: isDryRun(params) });
      const result = {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        actorLink,
        mutatesWorldActor: actorLink,
        effect: serializeActiveEffect(effect)
      };
      if (isDryRun(params)) {
        const preview = previewEmbeddedEffectCreate(actor, params.data);
        return dryRunResponse({ ...result, effect: serializeActiveEffect(preview) });
      }
      return result;
    },

    async "scene.token.effect.update"(params) {
      const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);
      const effect = await updateEmbeddedEffect(
        actor,
        params.effectId,
        params.patch,
        {
          sceneId: params.sceneId,
          tokenId: params.tokenId
        },
        { dryRun: isDryRun(params) }
      );
      const result = {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        actorLink,
        mutatesWorldActor: actorLink,
        effect: serializeActiveEffect(effect)
      };
      if (isDryRun(params)) {
        const preview = await previewEmbeddedEffectUpdate(actor, effect, params.patch);
        return dryRunResponse({ ...result, effect: serializeActiveEffect(preview) });
      }
      return result;
    },

    async "scene.token.effect.clone"(params) {
      const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);
      const clone = await cloneEmbeddedEffect(
        actor,
        params.effectId,
        params.patch ?? {},
        {
          sceneId: params.sceneId,
          tokenId: params.tokenId
        },
        { dryRun: isDryRun(params) }
      );
      const result = {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        actorLink,
        mutatesWorldActor: actorLink,
        effect: serializeActiveEffect(clone)
      };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "scene.token.effect.delete"(params) {
      const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);
      await deleteEmbeddedEffect(
        actor,
        params.effectId,
        {
          sceneId: params.sceneId,
          tokenId: params.tokenId
        },
        { dryRun: isDryRun(params) }
      );
      const result = {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        actorLink,
        mutatesWorldActor: actorLink,
        id: params.effectId,
        deleted: !isDryRun(params)
      };
      return isDryRun(params) ? dryRunResponse(result) : result;
    }
  };
}
