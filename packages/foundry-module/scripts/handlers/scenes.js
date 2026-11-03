import { BATCH_GET_MAX_IDS, ERROR_CODES } from "../generated/protocol.js";
import { getSceneById, getScenesCollection } from "../lib/game-collections.js";
import { assertInitialLevelExists, assertSceneLevelsFieldsSupported } from "../lib/scene-embedded.js";
import {
  cloneDocument,
  createScene,
  deleteDocument,
  previewDocumentUpdate,
  previewSceneCreate
} from "../lib/world-docs.js";
import { resolveBroadcastUsers } from "../lib/broadcast-targets.js";
import { createBridgeError } from "../lib/errors.js";
import {
  applyConfirmedUpdate,
  assertDocumentDeleteCommitted,
  assertRequestedWriteStorable
} from "../lib/write-confirmation.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { canonicalizeFilePathFields } from "../lib/file-access.js";
import { filterByName, paginate, serializeScene } from "../lib/serializers.js";

const SCENE_DETAIL = { flags: true, provenance: true, levels: true };

function assertScenePatch(scene, patch) {
  assertSceneLevelsFieldsSupported(patch);
  assertInitialLevelExists(
    patch,
    Array.from(scene.levels ?? [], (level) => level.id),
    { sceneId: scene.id }
  );
}

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
        scene: serializeScene(scene, { ...SCENE_DETAIL, counts: true, ownership: true })
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
        serializeScene(getSceneById(id), { ...SCENE_DETAIL, counts: true, ownership: true })
      );
      return { scenes };
    },

    async "scene.create"(params) {
      assertSceneLevelsFieldsSupported(params.data);

      const canonical = canonicalizeFilePathFields(params.data, "Scene");
      const data = canonical.levels
        ? {
            ...canonical,
            levels: canonical.levels.map((level) => canonicalizeFilePathFields(level, "Level"))
          }
        : canonical;

      if (isDryRun(params)) {
        const preview = previewSceneCreate(data);
        return dryRunResponse({ scene: serializeScene(preview, SCENE_DETAIL) });
      }

      const scene = await createScene(data);
      const result = serializeScene(scene, SCENE_DETAIL);
      if (data.levels) {
        const createdCount = /** @type {unknown[]} */ (result.levels).length;
        if (createdCount !== data.levels.length) {
          throw createBridgeError(
            ERROR_CODES.INTERNAL_ERROR,
            `Scene ${result.id} was created with ${createdCount} levels instead of the ${data.levels.length} requested: a module hook or Foundry changed the level list. Inspect it with scene.level.list and fix it with scene.level.create or scene.level.delete`,
            { sceneId: result.id, requested: data.levels.length, created: createdCount }
          );
        }
      }
      return { scene: result };
    },

    async "scene.update"(params) {
      const scene = getSceneById(params.sceneId);
      assertScenePatch(scene, params.patch);
      const patch = canonicalizeFilePathFields(params.patch, "Scene");
      if (isDryRun(params)) {
        await assertRequestedWriteStorable({
          document: scene,
          patch,
          subject: `Scene ${scene.id ?? params.sceneId}`,
          details: { sceneId: scene.id ?? params.sceneId }
        });
        const preview = await previewDocumentUpdate(scene, patch);
        return dryRunResponse({ scene: serializeScene(preview, SCENE_DETAIL) });
      }

      await applyConfirmedUpdate({
        document: scene,
        patch,
        write: (payload) => scene.update(payload, { diff: true, render: true }),
        subject: `Scene ${scene.id ?? params.sceneId}`,
        hookName: "preUpdateScene",
        details: { sceneId: scene.id ?? params.sceneId }
      });
      return {
        scene: serializeScene(scene, SCENE_DETAIL)
      };
    },

    async "scene.clone"(params) {
      const scene = getSceneById(params.sceneId);
      assertScenePatch(scene, params.patch);

      const patch = canonicalizeFilePathFields({ active: false, ...(params.patch ?? {}) }, "Scene");

      const clone = await cloneDocument(scene, patch, { dryRun: isDryRun(params) });
      const result = { scene: serializeScene(clone, SCENE_DETAIL) };
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

      const deletedDocument = await deleteDocument(scene);
      assertDocumentDeleteCommitted({
        committed: Boolean(deletedDocument),
        subject: `Scene ${id}`,
        hookName: "preDeleteScene",
        details: { sceneId: id }
      });
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
