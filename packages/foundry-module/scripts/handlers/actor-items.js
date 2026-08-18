import {
  cloneActorItem,
  createEmbeddedItem,
  deleteActorItem,
  getActorItemById,
  importActorItemFromCompendium,
  previewEmbeddedItemCreate,
  updateActorItem
} from "../lib/embedded-items.js";
import { getActorById } from "../lib/game-collections.js";
import { previewDocumentUpdate } from "../lib/world-docs.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { canonicalizeFilePathFields } from "../lib/file-access.js";
import { filterByName, paginate, serializeItem, serializeItemSummary } from "../lib/serializers.js";

export function createActorItemHandlers() {
  return {
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
