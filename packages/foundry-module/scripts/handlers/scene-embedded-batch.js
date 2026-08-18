import { getSceneById } from "../lib/game-collections.js";
import {
  createSceneEmbeddedMany,
  deleteSceneEmbeddedMany,
  getSceneEmbeddedCollection,
  prepareSceneEmbeddedCreateData,
  prepareSceneEmbeddedUpdateData,
  previewPreparedSceneEmbeddedCreate,
  updateSceneEmbeddedMany
} from "../lib/scene-embedded.js";
import { computeDocumentUpdateDiff, previewDocumentUpdate } from "../lib/world-docs.js";
import { executeBatchCreate, executeBatchDelete, executeBatchUpdate } from "../lib/batch-write.js";
import { createBridgeError } from "../lib/errors.js";
import { isDryRun } from "../lib/dry-run.js";

/** @param {{ type: string, prefix: string, idField: string, notFoundCode: string, listCommand: string, prepareCreate?: (data: Record<string, any>, scene: any) => any, assertSupported?: (scene: any) => void, summarize?: (document: any) => Record<string, unknown> }} config */
export function createSceneEmbeddedBatchHandlers({
  type,
  prefix,
  idField,
  notFoundCode,
  listCommand,
  prepareCreate,
  assertSupported,
  summarize
}) {
  const createCommand = `${prefix}.create-many`;
  const updateCommand = `${prefix}.update-many`;
  const deleteCommand = `${prefix}.delete-many`;

  const collectionOf = (scene) => getSceneEmbeddedCollection(scene, type);

  const missing = (command, sceneId, id, index) =>
    createBridgeError(
      notFoundCode,
      `${command} element ${index} names ${type} ${id}, which was not found on scene ${sceneId}; use ${listCommand} to find valid ids. Nothing was written.`,
      { sceneId, [idField]: id, index }
    );

  const resolveScene = (sceneId) => {
    const scene = getSceneById(sceneId);
    assertSupported?.(scene);
    return scene;
  };

  return {
    async [createCommand](params) {
      const scene = resolveScene(params.sceneId);
      const collection = collectionOf(scene);
      const result = await executeBatchCreate({
        command: createCommand,
        items: params.data,
        dryRun: isDryRun(params),

        prepare: (data) =>
          prepareCreate ? prepareCreate(data, scene) : prepareSceneEmbeddedCreateData(type, data),
        preview: (preparedCopy) => previewPreparedSceneEmbeddedCreate(scene, type, preparedCopy),
        isIdTaken: (id) => Boolean(collection?.has?.(id)),
        create: (payloads) => createSceneEmbeddedMany(scene, type, payloads),
        readBack: (id) => collection?.get?.(id) ?? null,
        summarize
      });
      return { sceneId: params.sceneId, ...result };
    },

    async [updateCommand](params) {
      const scene = resolveScene(params.sceneId);
      const collection = collectionOf(scene);
      const result = await executeBatchUpdate({
        command: updateCommand,
        patches: params.patches,
        dryRun: isDryRun(params),
        resolve: (id, index) => {
          const document = collection?.get?.(id) ?? null;
          if (!document) {
            throw missing(updateCommand, params.sceneId, id, index);
          }
          return document;
        },

        prepare: (patch, _index, document) => prepareSceneEmbeddedUpdateData(type, patch, document),
        diff: (document, patch) => computeDocumentUpdateDiff(document, patch),
        mergePreview: (document, patch) => previewDocumentUpdate(document, patch),
        update: (entries) => updateSceneEmbeddedMany(scene, type, entries),
        summarize
      });
      return { sceneId: params.sceneId, ...result };
    },

    async [deleteCommand](params) {
      const scene = resolveScene(params.sceneId);
      const collection = collectionOf(scene);
      const result = await executeBatchDelete({
        command: deleteCommand,
        ids: params.ids,
        dryRun: isDryRun(params),

        resolve: (id) => collection?.get?.(id) ?? null,
        remove: (ids) => deleteSceneEmbeddedMany(scene, type, ids),
        exists: (id) => Boolean(collection?.has?.(id))
      });
      return { sceneId: params.sceneId, ...result };
    }
  };
}
