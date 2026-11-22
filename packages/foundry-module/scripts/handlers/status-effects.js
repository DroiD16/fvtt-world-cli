import { ERROR_CODES } from "../generated/protocol.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { getSceneTokenActor } from "../lib/embedded-items.js";
import { createBridgeError } from "../lib/errors.js";
import { getActorById } from "../lib/game-collections.js";

function configuredStatusIds() {
  const configured = /** @type {any} */ (globalThis).CONFIG?.statusEffects;
  const entries = Array.isArray(configured) ? configured : Object.values(configured ?? {});
  return [...new Set(entries.map((entry) => entry?.id).filter((id) => typeof id === "string"))];
}

/**
 * @param {string} statusId
 */
function assertConfiguredStatus(statusId) {
  const validStatusIds = configuredStatusIds();
  if (!validStatusIds.includes(statusId)) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `Status ${statusId} is not one of the status effects this world configures; details.validStatusIds lists them`,
      { statusId, validStatusIds }
    );
  }
}

/**
 * @param {any} actor
 * @param {string} statusId
 */
function effectsCarrying(actor, statusId) {
  const effects = Array.from(actor.allApplicableEffects?.() ?? actor.effects ?? []);
  return effects
    .filter((/** @type {any} */ effect) => effect.statuses?.has?.(statusId))
    .map((/** @type {any} */ effect) => ({
      id: effect.id ?? null,
      name: effect.name ?? null,
      parentType: effect.parent?.documentName ?? null,
      parentId: effect.parent?.id ?? null,
      statuses: Array.from(effect.statuses ?? [])
    }));
}

/**
 * @param {{ actor: any, params: any, subject: string, coordinates: Record<string, unknown> }} target
 */
async function setStatus({ actor, params, subject, coordinates }) {
  assertConfiguredStatus(params.statusId);
  if (typeof actor.toggleStatusEffect !== "function") {
    throw createBridgeError(
      ERROR_CODES.UNSUPPORTED_OPERATION,
      "This Foundry core has no Actor#toggleStatusEffect, so status effects cannot be set",
      coordinates
    );
  }

  const previous = Boolean(actor.statuses?.has?.(params.statusId));
  const result = { ...coordinates, statusId: params.statusId, active: params.active, previous };
  if (isDryRun(params)) {
    return dryRunResponse({ ...result, changed: previous !== params.active });
  }
  if (previous === params.active) {
    return { ...result, changed: false };
  }

  await actor.toggleStatusEffect(params.statusId, {
    active: params.active,
    overlay: params.overlay === true
  });
  if (Boolean(actor.statuses?.has?.(params.statusId)) !== params.active) {
    throw createBridgeError(
      ERROR_CODES.INTERNAL_ERROR,
      `${subject}: status ${params.statusId} is still ${params.active ? "inactive" : "active"} after Foundry's status toggle. The toggle removes only an effect that carries this status alone or the status's own effect; details.effects lists the effects that still carry it, which an effect command can change. A game system or module may also have intercepted the toggle`,
      {
        ...coordinates,
        statusId: params.statusId,
        active: params.active,
        effects: effectsCarrying(actor, params.statusId)
      }
    );
  }

  return { ...result, changed: true };
}

export function createStatusEffectHandlers() {
  return {
    async "actor.status.set"(params) {
      const actor = getActorById(params.actorId);
      return setStatus({
        actor,
        params,
        subject: `Actor ${params.actorId}`,
        coordinates: { actorId: params.actorId }
      });
    },

    async "scene.token.status.set"(params) {
      const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);
      return setStatus({
        actor,
        params,
        subject: `Token ${params.tokenId} of scene ${params.sceneId}`,
        coordinates: {
          sceneId: params.sceneId,
          tokenId: params.tokenId,
          actorLink,
          mutatesWorldActor: actorLink
        }
      });
    }
  };
}
