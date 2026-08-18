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
    }
  };
}
