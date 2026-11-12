import { getSceneById } from "../lib/game-collections.js";
import {
  cloneSceneEmbedded,
  createSceneEmbedded,
  deleteSceneEmbedded,
  getSceneEmbeddedById,
  previewSceneEmbeddedCreate,
  previewSceneEmbeddedUpdate,
  updateSceneEmbedded
} from "../lib/scene-embedded.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { paginate } from "../lib/serializers.js";
import { createSceneEmbeddedBatchHandlers } from "./scene-embedded-batch.js";

/**
 * @param {{ type: string, prefix: string, idField: string, resultKey: string, pluralKey: string, notFoundCode: string, serialize: (document: any, params?: any) => any, serializeSummary: (document: any, params?: any) => any, listFilter?: (rows: any[], params: any) => any[], omitVerbs?: string[], sequentialCreate?: boolean, prepareCreate?: (data: Record<string, any>, scene: any, params: any) => any, assertSupported?: (scene: any) => void, assertDeleteAllowed?: (scene: any, ids: string[]) => void, summarize?: (document: any) => Record<string, unknown> }} config
 */
export function createScenePlaceableHandlers({
  type,
  prefix,
  idField,
  resultKey,
  pluralKey,
  notFoundCode,
  serialize,
  serializeSummary,
  listFilter,
  omitVerbs = [],
  sequentialCreate,
  prepareCreate,
  assertSupported,
  assertDeleteAllowed,
  summarize
}) {
  const resolveScene = (sceneId) => {
    const scene = getSceneById(sceneId);
    assertSupported?.(scene);
    return scene;
  };

  const verbs = {
    async list(params) {
      const scene = resolveScene(params.sceneId);
      const rows = scene[pluralKey] ? Array.from(scene[pluralKey]) : [];
      const filtered = listFilter ? listFilter(rows, params) : rows;
      const { page, total, hasMore } = paginate(filtered, params);
      return {
        sceneId: params.sceneId,
        [pluralKey]: page.map((row) => serializeSummary(row, params)),
        total,
        hasMore
      };
    },

    async get(params) {
      resolveScene(params.sceneId);
      const { document } = getSceneEmbeddedById(params.sceneId, type, params[idField], notFoundCode, idField);
      return { sceneId: params.sceneId, [resultKey]: serialize(document, params) };
    },

    async create(params) {
      const scene = resolveScene(params.sceneId);
      const document = await createSceneEmbedded(scene, type, params.data, { dryRun: isDryRun(params) });
      const result = { sceneId: params.sceneId, [resultKey]: serialize(document, params) };
      if (isDryRun(params)) {
        const preview = previewSceneEmbeddedCreate(scene, type, params.data);
        return dryRunResponse({ ...result, [resultKey]: serialize(preview, params) });
      }
      return result;
    },

    async update(params) {
      resolveScene(params.sceneId);
      const document = await updateSceneEmbedded(
        params.sceneId,
        type,
        params[idField],
        params.patch,
        notFoundCode,
        idField,
        { dryRun: isDryRun(params) }
      );
      const result = { sceneId: params.sceneId, [resultKey]: serialize(document, params) };
      if (isDryRun(params)) {
        const preview = await previewSceneEmbeddedUpdate(document, params.patch);
        return dryRunResponse({ ...result, [resultKey]: serialize(preview, params) });
      }
      return result;
    },

    async clone(params) {
      resolveScene(params.sceneId);
      const clone = await cloneSceneEmbedded(
        params.sceneId,
        type,
        params[idField],
        params.patch ?? {},
        notFoundCode,
        idField,
        { dryRun: isDryRun(params) }
      );
      const result = { sceneId: params.sceneId, [resultKey]: serialize(clone, params) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async delete(params) {
      const scene = resolveScene(params.sceneId);
      assertDeleteAllowed?.(scene, [params[idField]]);
      await deleteSceneEmbedded(params.sceneId, type, params[idField], notFoundCode, idField, {
        dryRun: isDryRun(params)
      });
      const result = { sceneId: params.sceneId, id: params[idField], deleted: !isDryRun(params) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    }
  };

  const handlers = /** @type {Record<string, (params: any) => Promise<any>>} */ ({
    ...createSceneEmbeddedBatchHandlers({
      type,
      prefix,
      idField,
      notFoundCode,
      listCommand: `${prefix}.list`,
      sequentialCreate,
      prepareCreate,
      assertSupported,
      assertDeleteAllowed,
      summarize
    })
  });

  for (const [verb, handler] of Object.entries(verbs)) {
    if (!omitVerbs.includes(verb)) {
      handlers[`${prefix}.${verb}`] = handler;
    }
  }

  return handlers;
}
