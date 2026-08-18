import { BATCH_GET_MAX_IDS, ERROR_CODES } from "../generated/protocol.js";
import { getItemById, getItemsCollection } from "../lib/game-collections.js";
import {
  cloneDocument,
  createWorldItem,
  deleteDocument,
  previewDocumentUpdate,
  previewWorldItemCreate
} from "../lib/world-docs.js";
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
import { createWorldDocumentBatchHandlers } from "./world-doc-batch.js";

export function createItemHandlers() {
  return {
    ...createWorldDocumentBatchHandlers({
      prefix: "item",
      documentName: "Item",

      label: "item",
      resolve: (id) => getItemById(id),

      prepareUpdate: (patch) => canonicalizeFilePathFields(patch, "Item"),
      summarize: (document) => ({ name: document ? worldDocumentName(document) : null })
    }),

    async "item.list"(params) {
      const items = filterByName(Array.from(getItemsCollection()), params.name);
      const { page, total, hasMore } = paginate(items, params);
      return {
        items: page.map((item) => serializeItemSummary(item)),
        total,
        hasMore
      };
    },

    async "item.get"(params) {
      const item = getItemById(params.itemId);
      return {
        item: serializeItem(item, { include: params.include, ownership: true })
      };
    },

    async "item.get-many"(params) {
      const ids = params.ids;
      if (ids.length > BATCH_GET_MAX_IDS) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `item.get-many accepts at most ${BATCH_GET_MAX_IDS} ids`,
          { max: BATCH_GET_MAX_IDS, received: ids.length }
        );
      }

      const items = ids.map((id) =>
        serializeItem(getItemById(id), { include: params.include, ownership: true })
      );
      return { items };
    },

    async "item.create"(params) {
      const data = canonicalizeFilePathFields(params.data, "Item");
      if (isDryRun(params)) {
        const preview = previewWorldItemCreate(data);
        return dryRunResponse({ item: serializeItem(preview, { include: params.include }) });
      }

      const item = await createWorldItem(data);
      return {
        item: serializeItem(item, { include: params.include })
      };
    },

    async "item.update"(params) {
      const item = getItemById(params.itemId);
      const patch = canonicalizeFilePathFields(params.patch, "Item");
      if (isDryRun(params)) {
        const preview = await previewDocumentUpdate(item, patch);
        return dryRunResponse({ item: serializeItem(preview, { include: params.include }) });
      }

      await item.update(patch, { diff: true, render: true });
      return {
        item: serializeItem(item, { include: params.include })
      };
    },

    async "item.clone"(params) {
      const item = getItemById(params.itemId);
      const patch = canonicalizeFilePathFields(params.patch, "Item");
      const clone = await cloneDocument(item, patch ?? {}, { dryRun: isDryRun(params) });
      const result = { item: serializeItem(clone) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "item.delete"(params) {
      const item = getItemById(params.itemId);
      const id = item.id ?? params.itemId;
      if (isDryRun(params)) {
        return dryRunResponse({ id, deleted: false });
      }

      await deleteDocument(item);
      return {
        id,
        deleted: true
      };
    }
  };
}
