import { ERROR_CODES } from "../generated/protocol.js";
import {
  cloneActorItem,
  createEmbeddedItem,
  createEmbeddedItemMany,
  deleteActorItem,
  deleteEmbeddedItemMany,
  getActorItemById,
  importActorItemFromCompendium,
  prepareEmbeddedItemCreateData,
  prepareEmbeddedItemUpdateData,
  previewEmbeddedItemCreate,
  previewPreparedEmbeddedItemCreate,
  updateActorItem,
  updateEmbeddedItemMany
} from "../lib/embedded-items.js";
import { getActorById } from "../lib/game-collections.js";
import { computeDocumentUpdateDiff, previewDocumentUpdate } from "../lib/world-docs.js";
import { executeBatchCreate, executeBatchDelete, executeBatchUpdate } from "../lib/batch-write.js";
import { createBridgeError } from "../lib/errors.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { canonicalizeFilePathFields } from "../lib/file-access.js";
import {
  filterByName,
  paginate,
  serializeItem,
  serializeItemSummary,
  worldDocumentName
} from "../lib/serializers.js";

/** @param {any} document */
const summarizeItem = (document) => ({ name: document ? worldDocumentName(document) : null });

function createActorItemBatchHandlers() {
  return {
    async "actor.item.create-many"(params) {
      const command = "actor.item.create-many";
      const actor = getActorById(params.actorId);
      const result = await executeBatchCreate({
        command,
        items: params.data,
        dryRun: isDryRun(params),
        prepare: (data) => prepareEmbeddedItemCreateData(data),
        preview: (preparedCopy) => previewPreparedEmbeddedItemCreate(actor, preparedCopy),
        isIdTaken: (id) => Boolean(actor.items?.get?.(id)),
        create: (payloads) => createEmbeddedItemMany(actor, payloads),
        readBack: (id) => actor.items?.get?.(id) ?? null,
        summarize: summarizeItem
      });
      return { actorId: params.actorId, ...result };
    },

    async "actor.item.update-many"(params) {
      const command = "actor.item.update-many";
      const actor = getActorById(params.actorId);
      const result = await executeBatchUpdate({
        command,
        patches: params.patches,
        dryRun: isDryRun(params),
        resolve: (id, index) => {
          const item = actor.items?.get?.(id) ?? null;
          if (!item) {
            throw createBridgeError(
              ERROR_CODES.ITEM_NOT_FOUND,
              `${command} element ${index} names item ${id}, which was not found on actor ${params.actorId}; use actor.item.list to find valid ids. Nothing was written.`,
              { actorId: params.actorId, itemId: id, index }
            );
          }
          return item;
        },
        prepare: (patch) => prepareEmbeddedItemUpdateData(patch),
        diff: (document, patch) => computeDocumentUpdateDiff(document, patch),
        mergePreview: (document, patch) => previewDocumentUpdate(document, patch),
        update: (entries) => updateEmbeddedItemMany(actor, entries),
        summarize: summarizeItem
      });
      return { actorId: params.actorId, ...result };
    },

    async "actor.item.delete-many"(params) {
      const actor = getActorById(params.actorId);
      const result = await executeBatchDelete({
        command: "actor.item.delete-many",
        ids: params.ids,
        dryRun: isDryRun(params),
        resolve: (id) => actor.items?.get?.(id) ?? null,
        remove: (ids) => deleteEmbeddedItemMany(actor, ids),
        exists: (id) => Boolean(actor.items?.get?.(id))
      });
      return { actorId: params.actorId, ...result };
    }
  };
}

export function createActorItemHandlers() {
  return {
    ...createActorItemBatchHandlers(),

    async "actor.item.list"(params) {
      const actor = getActorById(params.actorId);
      const items = filterByName(Array.from(actor.items ?? []), params.name);
      const { page, total, hasMore } = paginate(items, params);
      return {
        actorId: actor.id ?? params.actorId,
        items: page.map((item) => serializeItemSummary(item, { include: params.include })),
        total,
        hasMore
      };
    },

    async "actor.item.get"(params) {
      const item = getActorItemById(params.actorId, params.itemId);
      return {
        actorId: params.actorId,
        item: serializeItem(item, { include: params.include })
      };
    },

    async "actor.item.create"(params) {
      const actor = getActorById(params.actorId);
      const item = await createEmbeddedItem(actor, params.data, { dryRun: isDryRun(params) });
      const result = { actorId: params.actorId, item: serializeItem(item, { include: params.include }) };
      if (isDryRun(params)) {
        const preview = previewEmbeddedItemCreate(actor, params.data);
        return dryRunResponse({ ...result, item: serializeItem(preview, { include: params.include }) });
      }
      return result;
    },

    async "actor.item.import-from-compendium"(params) {
      const actor = getActorById(params.actorId);
      const item = await importActorItemFromCompendium(
        actor,
        params.pack,
        params.entryId,
        params.patch ?? {},
        {
          dryRun: isDryRun(params)
        }
      );
      const result = { actorId: params.actorId, item: serializeItem(item, { include: params.include }) };
      if (isDryRun(params)) {
        const preview = previewEmbeddedItemCreate(actor, item);
        return dryRunResponse({ ...result, item: serializeItem(preview, { include: params.include }) });
      }
      return result;
    },

    async "actor.item.update"(params) {
      const patch = canonicalizeFilePathFields(params.patch, "Item");
      const item = await updateActorItem(params.actorId, params.itemId, patch, {
        dryRun: isDryRun(params)
      });
      const result = { actorId: params.actorId, item: serializeItem(item, { include: params.include }) };
      if (isDryRun(params)) {
        const preview = await previewDocumentUpdate(item, patch);
        return dryRunResponse({ ...result, item: serializeItem(preview, { include: params.include }) });
      }
      return result;
    },

    async "actor.item.clone"(params) {
      const clone = await cloneActorItem(params.actorId, params.itemId, params.patch ?? {}, {
        dryRun: isDryRun(params)
      });
      const result = { actorId: params.actorId, item: serializeItem(clone) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "actor.item.delete"(params) {
      await deleteActorItem(params.actorId, params.itemId, { dryRun: isDryRun(params) });
      const result = { actorId: params.actorId, id: params.itemId, deleted: !isDryRun(params) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    }
  };
}
