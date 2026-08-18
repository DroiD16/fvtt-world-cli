import {
  computeDocumentUpdateDiff,
  deleteWorldDocumentMany,
  getWorldDocumentClass,
  getWorldDocumentCollection,
  previewDocumentUpdate,
  updateWorldDocumentMany
} from "../lib/world-docs.js";
import { executeBatchDelete, executeBatchUpdate } from "../lib/batch-write.js";
import { BridgeError, createBridgeError } from "../lib/errors.js";
import { isDryRun } from "../lib/dry-run.js";

/** @param {{ prefix: string, documentName: "Item"|"Actor"|"JournalEntry", label: string, resolve: (id: string) => any, prepareUpdate?: (patch: Record<string, any>) => Record<string, any>, assertDeletable?: (document: any, index: number, params: Record<string, any>) => void, summarize?: (document: any) => Record<string, unknown> }} config */
export function createWorldDocumentBatchHandlers({
  prefix,
  documentName,
  label,
  resolve,
  prepareUpdate,
  assertDeletable,
  summarize
}) {
  const updateCommand = `${prefix}.update-many`;
  const deleteCommand = `${prefix}.delete-many`;

  const resolveForBatch = (id, index, command) => {
    try {
      return resolve(id);
    } catch (error) {
      if (!(error instanceof BridgeError)) throw error;
      throw createBridgeError(
        error.code,
        `${command} element ${index} names ${label} ${id}, which was not found; use ${prefix}.list to find valid ids. Nothing was written.`,
        { ...(error.details ?? {}), index }
      );
    }
  };

  const collection = () => getWorldDocumentCollection(documentName);

  return {
    async [updateCommand](params) {
      const result = await executeBatchUpdate({
        command: updateCommand,
        patches: params.patches,
        dryRun: isDryRun(params),

        resolve: (id, index) => resolveForBatch(id, index, updateCommand),
        prepare: (patch) => (prepareUpdate ? prepareUpdate(patch) : patch),

        documentClass: getWorldDocumentClass(documentName),
        diff: (document, patch) => computeDocumentUpdateDiff(document, patch),
        mergePreview: (document, patch) => previewDocumentUpdate(document, patch),
        update: (entries) => updateWorldDocumentMany(documentName, entries),
        summarize
      });
      return result;
    },

    async [deleteCommand](params) {
      const result = await executeBatchDelete({
        command: deleteCommand,
        ids: params.ids,
        dryRun: isDryRun(params),

        resolve: (id) => collection()?.get?.(id) ?? null,
        assertDeletable: assertDeletable
          ? (document, index) => assertDeletable(document, index, params)
          : undefined,
        remove: (ids) => deleteWorldDocumentMany(documentName, ids),

        exists: (id) => Boolean(collection()?.get?.(id))
      });
      return result;
    }
  };
}
