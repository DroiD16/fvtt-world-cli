import { ERROR_CODES } from "../generated/protocol.js";
import {
  createEmbeddedEffectMany,
  deleteEmbeddedEffectMany,
  getEmbeddedEffectCollection,
  getEmbeddedEffectDocumentClass,
  prepareEmbeddedEffectCreateData,
  prepareEmbeddedEffectUpdateData,
  previewPreparedEmbeddedEffectCreate,
  updateEmbeddedEffectMany
} from "../lib/effects.js";
import { computeDocumentUpdateDiff, previewDocumentUpdate } from "../lib/world-docs.js";
import { executeBatchCreate, executeBatchDelete, executeBatchUpdate } from "../lib/batch-write.js";
import { createBridgeError } from "../lib/errors.js";
import { isDryRun } from "../lib/dry-run.js";
import { effectName } from "../lib/serializers.js";

/** @param {{ prefix: string, resolve: (params: Record<string, any>) => { parent: any, scope: Record<string, unknown>, extra?: Record<string, unknown> } }} config */
export function createEmbeddedEffectBatchHandlers({ prefix, resolve }) {
  const createCommand = `${prefix}.create-many`;
  const updateCommand = `${prefix}.update-many`;
  const deleteCommand = `${prefix}.delete-many`;
  const listCommand = `${prefix}.list`;

  const missing = (command, scope, effectId, index) =>
    createBridgeError(
      ERROR_CODES.EFFECT_NOT_FOUND,
      `${command} element ${index} names effect ${effectId}, which was not found on the target parent; use ${listCommand} to find valid ids. Nothing was written.`,
      { ...scope, effectId, index }
    );

  const summarize = (document) => ({ name: document ? effectName(document) : null });

  return {
    async [createCommand](params) {
      const { parent, scope, extra } = resolve(params);
      const collection = getEmbeddedEffectCollection(parent);
      const result = await executeBatchCreate({
        command: createCommand,
        items: params.data,
        dryRun: isDryRun(params),
        prepare: (data) => prepareEmbeddedEffectCreateData(parent, data),
        preview: (preparedCopy) => previewPreparedEmbeddedEffectCreate(parent, preparedCopy),

        isIdTaken: (id) => Boolean(collection?.get?.(id)),
        create: (payloads) => createEmbeddedEffectMany(parent, payloads),
        readBack: (id) => collection?.get?.(id) ?? null,
        summarize
      });
      return { ...scope, ...(extra ?? {}), ...result };
    },

    async [updateCommand](params) {
      const { parent, scope, extra } = resolve(params);
      const collection = getEmbeddedEffectCollection(parent);
      const result = await executeBatchUpdate({
        command: updateCommand,
        patches: params.patches,
        dryRun: isDryRun(params),
        resolve: (id, index) => {
          const document = collection?.get?.(id) ?? null;
          if (!document) {
            throw missing(updateCommand, scope, id, index);
          }
          return document;
        },
        prepare: (patch) => prepareEmbeddedEffectUpdateData(parent, patch),
        documentClass: getEmbeddedEffectDocumentClass(parent),
        diff: (document, patch) => computeDocumentUpdateDiff(document, patch),
        mergePreview: (document, patch) => previewDocumentUpdate(document, patch),
        update: (entries) => updateEmbeddedEffectMany(parent, entries),
        summarize
      });
      return { ...scope, ...(extra ?? {}), ...result };
    },

    async [deleteCommand](params) {
      const { parent, scope, extra } = resolve(params);
      const collection = getEmbeddedEffectCollection(parent);
      const result = await executeBatchDelete({
        command: deleteCommand,
        ids: params.ids,
        dryRun: isDryRun(params),

        resolve: (id) => collection?.get?.(id) ?? null,
        remove: (ids) => deleteEmbeddedEffectMany(parent, ids),
        exists: (id) => Boolean(collection?.get?.(id))
      });
      return { ...scope, ...(extra ?? {}), ...result };
    }
  };
}
