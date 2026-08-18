import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

import { stripProtectedMeta } from "./sanitize.js";
import {
  assertClonePatchValid,
  cloneDocument,
  previewDocumentCreate,
  previewDocumentUpdate,
  resolveEmbeddedDocumentClass
} from "./world-docs.js";
import { getSceneEmbeddedById } from "./scene-embedded.js";

export const REGION_BEHAVIOR_VETO_REMEDY =
  "There is no force flag for a world-side veto — disable the module that locks this region (or make the change from the Foundry UI) and retry.";

/** @param {Record<string, any>} data */
function sanitizeRegionBehaviorData(data) {
  return stripProtectedMeta(data);
}

/**
 * @param {string} sceneId
 * @param {string} regionId
 * @param {string} behaviorId
 */
export function getSceneRegionBehaviorById(sceneId, regionId, behaviorId) {
  const { scene, document: region } = getSceneEmbeddedById(
    sceneId,
    "Region",
    regionId,
    ERROR_CODES.REGION_NOT_FOUND,
    "regionId"
  );
  const behavior = region.behaviors?.get?.(behaviorId) ?? null;
  if (!behavior) {
    throw createBridgeError(
      ERROR_CODES.REGION_BEHAVIOR_NOT_FOUND,
      `RegionBehavior ${behaviorId} was not found on region ${regionId} of scene ${sceneId}; use scene.region.behavior.list to find valid ids`,
      { sceneId, regionId, behaviorId }
    );
  }
  return { scene, region, behavior };
}

/**
 * @param {any} region
 * @param {Record<string, any>} data
 */
export async function createRegionBehavior(region, data) {
  if (typeof region?.createEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "RegionBehavior create API is not available");
  }
  const created = await region.createEmbeddedDocuments("RegionBehavior", [sanitizeRegionBehaviorData(data)], {
    render: true
  });
  const behavior = Array.isArray(created) ? (created[0] ?? null) : created;
  if (!behavior) {
    throw createBridgeError(
      ERROR_CODES.INTERNAL_ERROR,
      `Region behavior was NOT created on region ${region?.id ?? "(unknown)"}: RegionBehavior creation returned no document, which means a module's preCreateRegionBehavior hook or a core _preCreate refused the write, or the payload failed Foundry's own client-side validation (which Foundry reports only as a UI notification). Nothing was created. ${REGION_BEHAVIOR_VETO_REMEDY}`,
      { regionId: region?.id ?? null }
    );
  }
  return behavior;
}

/**
 * @param {any} region
 * @param {Record<string, any>} data
 */
export function previewRegionBehaviorCreate(region, data) {
  return previewDocumentCreate(
    resolveEmbeddedDocumentClass(region?.behaviors, "RegionBehavior"),
    sanitizeRegionBehaviorData(data),
    { parent: region }
  );
}

/**
 * @param {any} behavior
 * @param {Record<string, any>} patch
 */
export async function previewRegionBehaviorUpdate(behavior, patch) {
  return previewDocumentUpdate(behavior, sanitizeRegionBehaviorData(patch ?? {}));
}

/**
 * @param {any} region
 * @param {string} behaviorId
 * @param {Record<string, any>} patch
 */
export async function updateRegionBehavior(region, behaviorId, patch) {
  if (typeof region?.updateEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "RegionBehavior update API is not available");
  }
  const sent = sanitizeRegionBehaviorData(patch);
  const updated = await region.updateEmbeddedDocuments("RegionBehavior", [{ _id: behaviorId, ...sent }], {
    diff: true,
    render: true
  });
  return {
    behavior: region.behaviors?.get?.(behaviorId) ?? null,
    committed: Array.isArray(updated) ? updated.length > 0 : Boolean(updated),
    sent
  };
}

/**
 * @param {any} region
 * @param {string} behaviorId
 */
export async function deleteRegionBehavior(region, behaviorId) {
  if (typeof region?.deleteEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "RegionBehavior delete API is not available");
  }
  const deleted = await region.deleteEmbeddedDocuments("RegionBehavior", [behaviorId], { render: true });
  return { committed: Array.isArray(deleted) ? deleted.length > 0 : Boolean(deleted) };
}

/**
 * @param {any} behavior
 * @param {Record<string, any>} patch
 * @param {{ dryRun?: boolean }} [options]
 */
export async function cloneRegionBehavior(behavior, patch, { dryRun = false } = {}) {
  const overrides = sanitizeRegionBehaviorData(patch ?? {});

  if (patch != null) {
    await assertClonePatchValid(behavior, overrides);
  }
  return cloneDocument(behavior, overrides, { dryRun });
}
