import { BATCH_GET_MAX_IDS, ERROR_CODES } from "../generated/protocol.js";
import { getSceneById, getScenesCollection } from "../lib/game-collections.js";
import { assertSceneLevelsFieldsSupported } from "../lib/scene-embedded.js";
import {
  cloneDocument,
  createScene,
  deleteDocument,
  previewDocumentUpdate,
  previewSceneCreate
} from "../lib/world-docs.js";
import { resolveBroadcastUsers } from "../lib/broadcast-targets.js";
import { createBridgeError } from "../lib/errors.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { canonicalizeFilePathFields } from "../lib/file-access.js";
import { filterByName, paginate, serializeScene } from "../lib/serializers.js";

export function createSceneHandlers() {
  return {
    async "scene.list"(params) {
      const scenes = filterByName(Array.from(getScenesCollection()), params.name);
      const { page, total, hasMore } = paginate(scenes, params);
      return {
        scenes: page.map((scene) => serializeScene(scene)),
        total,
        hasMore
      };
    },

    async "scene.get"(params) {
      const scene = getSceneById(params.sceneId);
      return {
        scene: serializeScene(scene, { counts: true, ownership: true, flags: true, provenance: true })
      };
    },

    async "scene.get-many"(params) {
      const ids = params.ids;
      if (ids.length > BATCH_GET_MAX_IDS) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `scene.get-many accepts at most ${BATCH_GET_MAX_IDS} ids`,
          { max: BATCH_GET_MAX_IDS, received: ids.length }
        );
      }

      const scenes = ids.map((id) =>
        serializeScene(getSceneById(id), { counts: true, ownership: true, flags: true, provenance: true })
      );
      return { scenes };
    },

    async "scene.create"(params) {
      assertSceneLevelsFieldsSupported(params.data);

      const data = canonicalizeFilePathFields(params.data, "Scene");

      if (isDryRun(params)) {
        const preview = previewSceneCreate(data);
        return dryRunResponse({ scene: serializeScene(preview, { flags: true, provenance: true }) });
      }

      const scene = await createScene(data);
      return {
        scene: serializeScene(scene, { flags: true, provenance: true })
      };
    },

    async "scene.update"(params) {
      const scene = getSceneById(params.sceneId);
      assertSceneLevelsFieldsSupported(params.patch);
      const patch = canonicalizeFilePathFields(params.patch, "Scene");
      if (isDryRun(params)) {
        const preview = await previewDocumentUpdate(scene, patch);
        return dryRunResponse({ scene: serializeScene(preview, { flags: true, provenance: true }) });
      }

      await scene.update(patch, { diff: true, render: true });
      return {
        scene: serializeScene(scene, { flags: true, provenance: true })
      };
    },

    async "scene.clone"(params) {
      const scene = getSceneById(params.sceneId);

      assertSceneLevelsFieldsSupported(params.patch);

      const patch = canonicalizeFilePathFields({ active: false, ...(params.patch ?? {}) }, "Scene");

      const clone = await cloneDocument(scene, patch, { dryRun: isDryRun(params) });
      const result = { scene: serializeScene(clone, { flags: true, provenance: true }) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "scene.delete"(params) {
      const scene = getSceneById(params.sceneId);
      const wasActive = Boolean(scene.active);

      if (wasActive && params.force !== true) {
        throw createBridgeError(
          ERROR_CODES.DELETE_FORBIDDEN,
          "Refusing to delete the active scene; re-run scene.delete with force:true to delete it anyway",
          { sceneId: params.sceneId, active: true }
        );
      }

      const id = scene.id ?? params.sceneId;
      if (isDryRun(params)) {
        return dryRunResponse({ id, deleted: false, wasActive });
      }

      await deleteDocument(scene);
      return {
        id,
        deleted: true,
        wasActive
      };
    },

    async "scene.activate"(params) {
      const scene = getSceneById(params.sceneId);
      const wasActive = Boolean(scene.active);
      const sceneId = scene.id ?? params.sceneId;

      if (wasActive) {
        const result = { sceneId, active: true, wasActive, changed: false };
        return isDryRun(params) ? dryRunResponse(result) : result;
      }

      if (typeof scene.activate !== "function") {
        throw createBridgeError(
          ERROR_CODES.BRIDGE_NOT_READY,
          "Foundry scene activation API (Scene#activate) is not available; reload the GM client"
        );
      }

      if (isDryRun(params)) {
        return dryRunResponse({ sceneId, active: true, wasActive, changed: true });
      }

      await scene.activate();
      const stored = getSceneById(sceneId);
      if (!stored.active) {
        throw createBridgeError(
          ERROR_CODES.INTERNAL_ERROR,
          `Foundry accepted the activation of scene ${sceneId} and still reports it as inactive, so the requested ` +
            `state did not land: another client may have activated a different scene in the meantime. Re-read the ` +
            `scene before retrying`,
          { sceneId }
        );
      }

      return { sceneId, active: true, wasActive, changed: true };
    },

    async "scene.pull-users"(params) {
      const scene = getSceneById(params.sceneId);
      const sceneId = scene.id ?? params.sceneId;
      const users = resolveBroadcastUsers(params.userIds);

      if (typeof scene.pullUsers !== "function") {
        throw createBridgeError(
          ERROR_CODES.UNSUPPORTED_OPERATION,
          "This Foundry version exposes no player-pulling API (Scene#pullUsers); nobody was pulled",
          { sceneId }
        );
      }

      // Foundry only reaches a connected client, and one supported version throws on an empty list, so
      // a call with nothing to pull stays on this side of the socket.
      if (users.active.length > 0) {
        scene.pullUsers(users.active);
      }

      return {
        sceneId,
        userIds: users.active,
        skippedUserIds: users.inactive,
        dispatched: users.active.length > 0
      };
    }
  };
}
