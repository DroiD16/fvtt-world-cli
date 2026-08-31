import { ERROR_CODES } from "../generated/protocol.js";
import { getSceneById } from "../lib/game-collections.js";
import {
  assertExecutableBehaviorMacroResolves,
  assertRegionBehaviorWriteAllowed
} from "../lib/region-behavior-guards.js";
import {
  REGION_BEHAVIOR_VETO_REMEDY,
  cloneRegionBehavior,
  createRegionBehavior,
  deleteRegionBehavior,
  getSceneRegionBehaviorById,
  previewRegionBehaviorCreate,
  previewRegionBehaviorUpdate,
  updateRegionBehavior
} from "../lib/region-behaviors.js";
import {
  cloneSceneEmbedded,
  createSceneEmbedded,
  getSceneEmbeddedById,
  previewSceneEmbeddedCreate,
  previewSceneEmbeddedUpdate,
  updateSceneEmbedded
} from "../lib/scene-embedded.js";
import { assertTableFamilyDeleteCommitted, assertTableFamilyUpdateCommitted } from "../lib/table-docs.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { createBridgeError } from "../lib/errors.js";
import {
  cloneValue,
  filterByName,
  paginate,
  placeableName,
  serializeRegion,
  serializeRegionBehavior,
  serializeRegionBehaviorSummary,
  serializeRegionSummary,
  storedRegionBehaviorName
} from "../lib/serializers.js";
import { createScenePlaceableHandlers } from "./scene-placeables.js";

const REGION = "Region";

const EXECUTABLE_BEHAVIOR_TYPES = Object.freeze(new Set(["executeMacro"]));

/** @type {{ allowedTypes?: ReadonlySet<string>, allowTypeChange?: boolean, executable?: boolean }} */
const DECLARATIVE_BEHAVIOR_ROUTE = Object.freeze({});

/** @type {{ allowedTypes: ReadonlySet<string>, allowTypeChange: boolean, executable: boolean }} */
const EXECUTABLE_BEHAVIOR_ROUTE = Object.freeze({
  allowedTypes: EXECUTABLE_BEHAVIOR_TYPES,
  allowTypeChange: true,
  executable: true
});

/**
 * @param {any} region
 * @returns {Set<string>}
 */
function storedRegionBehaviorIds(region) {
  const rows = region?.behaviors ? Array.from(region.behaviors) : [];
  const ids = new Set();
  for (const row of rows) {
    const id = /** @type {any} */ (row)?.id ?? /** @type {any} */ (row)?._id ?? null;
    if (typeof id === "string") {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * @typedef {{ allowedTypes?: ReadonlySet<string>, allowTypeChange?: boolean, executable?: boolean }} RegionBehaviorRoute
 */

/**
 * @param {any} params
 * @param {RegionBehaviorRoute} route
 */
async function createBehavior(params, route) {
  const { document: region } = getSceneEmbeddedById(
    params.sceneId,
    REGION,
    params.regionId,
    ERROR_CODES.REGION_NOT_FOUND,
    "regionId"
  );
  const details = { sceneId: params.sceneId, regionId: params.regionId };

  assertRegionBehaviorWriteAllowed({
    verb: "create",
    payload: params.data,
    details,
    allowedTypes: route.allowedTypes
  });

  if (route.executable) {
    assertExecutableBehaviorMacroResolves(params.data, details, { required: true });
  }

  const preview = previewRegionBehaviorCreate(region, cloneValue(params.data));
  if (isDryRun(params)) {
    return dryRunResponse({
      sceneId: params.sceneId,
      regionId: params.regionId,
      behavior: serializeRegionBehavior(preview, { knownBehaviorIds: new Set() })
    });
  }

  const behavior = await createRegionBehavior(region, params.data);
  return {
    sceneId: params.sceneId,
    regionId: params.regionId,
    behavior: serializeRegionBehavior(behavior)
  };
}

/**
 * @param {any} behavior
 * @returns {string | null}
 */
function storedBehaviorType(behavior) {
  const source =
    behavior?._source ?? (typeof behavior?.toObject === "function" ? behavior.toObject() : behavior);
  const type = source?.type ?? behavior?.type ?? null;
  return typeof type === "string" ? type : null;
}

/**
 * @param {any} params
 * @param {RegionBehaviorRoute} route
 */
async function updateBehavior(params, route) {
  const { region, behavior } = getSceneRegionBehaviorById(params.sceneId, params.regionId, params.behaviorId);
  const details = {
    sceneId: params.sceneId,
    regionId: params.regionId,
    behaviorId: params.behaviorId
  };

  assertRegionBehaviorWriteAllowed({
    verb: "update",
    payload: params.patch,
    behavior,
    details,
    allowedTypes: route.allowedTypes,
    allowTypeChange: route.allowTypeChange
  });

  if (route.executable) {
    // A patch that turns a declarative behavior into an executeMacro one carries the only uuid the
    // behavior will have, so it must name a macro just as a create does.
    const armsBehavior =
      params.patch?.type === "executeMacro" && storedBehaviorType(behavior) !== "executeMacro";
    assertExecutableBehaviorMacroResolves(params.patch, details, { required: armsBehavior });
  }

  if (isDryRun(params)) {
    const preview = await previewRegionBehaviorUpdate(behavior, params.patch);
    return dryRunResponse({
      sceneId: params.sceneId,
      regionId: params.regionId,
      behavior: serializeRegionBehavior(preview)
    });
  }

  const {
    behavior: updated,
    committed,

    sent
  } = await updateRegionBehavior(region, params.behaviorId, params.patch);

  if (!updated) {
    throw createBridgeError(
      ERROR_CODES.REGION_BEHAVIOR_NOT_FOUND,
      `RegionBehavior ${params.behaviorId} is no longer on region ${params.regionId} of scene ${params.sceneId}: the row was REMOVED while this update was in flight (a concurrent scene.region.behavior.delete — this family takes no mutation queue — or a behavior deleted from Foundry's own region sheet), so the update's outcome cannot be confirmed and the behavior no longer exists. This is NOT a module veto: no preUpdateRegionBehavior hook was involved. Re-read the region's behaviors with scene.region.behavior.list before retrying.`,
      { ...details, removedDuringUpdate: true }
    );
  }
  if (!committed) {
    await assertTableFamilyUpdateCommitted({
      document: updated,
      patch: sent,
      subject: `Region behavior ${params.behaviorId} of region ${params.regionId}`,
      hookName: "preUpdateRegionBehavior",
      details,
      remedy: REGION_BEHAVIOR_VETO_REMEDY
    });
  }
  return {
    sceneId: params.sceneId,
    regionId: params.regionId,
    behavior: serializeRegionBehavior(updated)
  };
}

/**
 * @param {any} params
 * @param {RegionBehaviorRoute} route
 */
async function cloneBehavior(params, route) {
  const { behavior } = getSceneRegionBehaviorById(params.sceneId, params.regionId, params.behaviorId);

  const details = {
    sceneId: params.sceneId,
    regionId: params.regionId,
    behaviorId: params.behaviorId
  };

  assertRegionBehaviorWriteAllowed({
    verb: "clone",
    payload: params.patch,
    behavior,
    details,
    allowedTypes: route.allowedTypes
  });

  if (route.executable) {
    assertExecutableBehaviorMacroResolves(params.patch, details, { required: false });
  }

  const clone = await cloneRegionBehavior(behavior, params.patch, { dryRun: isDryRun(params) });
  if (isDryRun(params)) {
    return dryRunResponse({
      sceneId: params.sceneId,
      regionId: params.regionId,
      behavior: serializeRegionBehavior(clone, { knownBehaviorIds: new Set() })
    });
  }
  return {
    sceneId: params.sceneId,
    regionId: params.regionId,
    behavior: serializeRegionBehavior(clone)
  };
}

export function createSceneRegionHandlers() {
  return {
    ...createScenePlaceableHandlers({
      type: REGION,
      prefix: "scene.region",
      idField: "regionId",
      resultKey: "region",
      pluralKey: "regions",
      notFoundCode: ERROR_CODES.REGION_NOT_FOUND,
      serialize: (document) => serializeRegion(document),
      serializeSummary: (document) => serializeRegionSummary(document),
      listFilter: (regions, params) => filterByName(regions, params.name),
      summarize: (document) => ({ name: placeableName(document) }),
      omitVerbs: ["create", "update", "clone"]
    }),

    async "scene.region.create"(params) {
      const scene = getSceneById(params.sceneId);
      const region = await createSceneEmbedded(scene, REGION, params.data, { dryRun: isDryRun(params) });
      const result = { sceneId: params.sceneId, region: serializeRegion(region) };
      if (isDryRun(params)) {
        const preview = previewSceneEmbeddedCreate(scene, REGION, params.data);

        return dryRunResponse({
          ...result,
          region: serializeRegion(preview, { knownBehaviorIds: new Set() })
        });
      }
      return result;
    },

    async "scene.region.update"(params) {
      const region = await updateSceneEmbedded(
        params.sceneId,
        REGION,
        params.regionId,
        params.patch,
        ERROR_CODES.REGION_NOT_FOUND,
        "regionId",
        { dryRun: isDryRun(params) }
      );
      const result = { sceneId: params.sceneId, region: serializeRegion(region) };
      if (isDryRun(params)) {
        const knownBehaviorIds = storedRegionBehaviorIds(region);
        const preview = await previewSceneEmbeddedUpdate(region, params.patch);
        return dryRunResponse({ ...result, region: serializeRegion(preview, { knownBehaviorIds }) });
      }
      return result;
    },

    async "scene.region.clone"(params) {
      const clone = await cloneSceneEmbedded(
        params.sceneId,
        REGION,
        params.regionId,
        params.patch ?? {},
        ERROR_CODES.REGION_NOT_FOUND,
        "regionId",
        { dryRun: isDryRun(params) }
      );
      if (isDryRun(params)) {
        const { document: source } = getSceneEmbeddedById(
          params.sceneId,
          REGION,
          params.regionId,
          ERROR_CODES.REGION_NOT_FOUND,
          "regionId"
        );
        return dryRunResponse({
          sceneId: params.sceneId,
          region: serializeRegion(clone, { knownBehaviorIds: storedRegionBehaviorIds(source) })
        });
      }
      return { sceneId: params.sceneId, region: serializeRegion(clone) };
    },

    async "scene.region.behavior.list"(params) {
      const { document: region } = getSceneEmbeddedById(
        params.sceneId,
        REGION,
        params.regionId,
        ERROR_CODES.REGION_NOT_FOUND,
        "regionId"
      );
      const behaviors = region.behaviors ? Array.from(region.behaviors) : [];

      const filtered = filterByName(behaviors, params.name, { nameOf: storedRegionBehaviorName });
      const { page, total, hasMore } = paginate(filtered, params);
      return {
        sceneId: params.sceneId,
        regionId: params.regionId,

        behaviors: page.map((behavior) => serializeRegionBehaviorSummary(behavior)),
        total,
        hasMore
      };
    },

    async "scene.region.behavior.get"(params) {
      const { behavior } = getSceneRegionBehaviorById(params.sceneId, params.regionId, params.behaviorId);
      return {
        sceneId: params.sceneId,
        regionId: params.regionId,
        behavior: serializeRegionBehavior(behavior)
      };
    },

    async "scene.region.behavior.create"(params) {
      return createBehavior(params, DECLARATIVE_BEHAVIOR_ROUTE);
    },

    async "scene.region.behavior.executable.create"(params) {
      return createBehavior(params, EXECUTABLE_BEHAVIOR_ROUTE);
    },

    async "scene.region.behavior.update"(params) {
      return updateBehavior(params, DECLARATIVE_BEHAVIOR_ROUTE);
    },

    async "scene.region.behavior.executable.update"(params) {
      return updateBehavior(params, EXECUTABLE_BEHAVIOR_ROUTE);
    },

    async "scene.region.behavior.delete"(params) {
      const { region } = getSceneRegionBehaviorById(params.sceneId, params.regionId, params.behaviorId);
      if (isDryRun(params)) {
        return dryRunResponse({
          sceneId: params.sceneId,
          regionId: params.regionId,
          id: params.behaviorId,
          deleted: false
        });
      }

      const { committed } = await deleteRegionBehavior(region, params.behaviorId);
      assertTableFamilyDeleteCommitted({
        committed,
        subject: `Region behavior ${params.behaviorId} of region ${params.regionId}`,
        hookName: "preDeleteRegionBehavior",
        details: {
          sceneId: params.sceneId,
          regionId: params.regionId,
          behaviorId: params.behaviorId
        },
        remedy: REGION_BEHAVIOR_VETO_REMEDY
      });
      return {
        sceneId: params.sceneId,
        regionId: params.regionId,
        id: params.behaviorId,
        deleted: true
      };
    },

    async "scene.region.behavior.clone"(params) {
      return cloneBehavior(params, DECLARATIVE_BEHAVIOR_ROUTE);
    },

    async "scene.region.behavior.executable.clone"(params) {
      return cloneBehavior(params, EXECUTABLE_BEHAVIOR_ROUTE);
    }
  };
}
