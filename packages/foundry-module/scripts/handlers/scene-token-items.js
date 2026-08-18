import {
  createEmbeddedItem,
  deleteEmbeddedItem,
  getEmbeddedItem,
  getSceneTokenActor,
  previewEmbeddedItemCreate,
  updateEmbeddedItem
} from "../lib/embedded-items.js";
import { cloneDocument, previewDocumentUpdate } from "../lib/world-docs.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { canonicalizeFilePathFields } from "../lib/file-access.js";
import { filterByName, paginate, serializeItem, serializeItemSummary } from "../lib/serializers.js";

export function createSceneTokenItemHandlers() {
  return {
    async "scene.token.item.list"(params) {
      const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);
      const items = filterByName(Array.from(actor.items ?? []), params.name);
      const { page, total, hasMore } = paginate(items, params);
      return {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        actorLink,
        items: page.map((item) => serializeItemSummary(item)),
        total,
        hasMore
      };
    },

    async "scene.token.item.get"(params) {
      const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);
      const item = getEmbeddedItem(actor, params.itemId, {
        sceneId: params.sceneId,
        tokenId: params.tokenId
      });
      return {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        actorLink,
        item: serializeItem(item)
      };
    },

    async "scene.token.item.create"(params) {
      const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);
      const item = await createEmbeddedItem(actor, params.data, { dryRun: isDryRun(params) });
      const result = {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        actorLink,
        mutatesWorldActor: actorLink,
        item: serializeItem(item, { include: params.include })
      };
      if (isDryRun(params)) {
        const preview = previewEmbeddedItemCreate(actor, params.data);
        return dryRunResponse({ ...result, item: serializeItem(preview, { include: params.include }) });
      }
      return result;
    },

    async "scene.token.item.update"(params) {
      const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);

      const patch = canonicalizeFilePathFields(params.patch, "Item");
      const item = await updateEmbeddedItem(
        actor,
        params.itemId,
        patch,
        {
          sceneId: params.sceneId,
          tokenId: params.tokenId
        },
        { dryRun: isDryRun(params) }
      );
      const result = {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        actorLink,
        mutatesWorldActor: actorLink,
        item: serializeItem(item, { include: params.include })
      };
      if (isDryRun(params)) {
        const preview = await previewDocumentUpdate(item, patch);
        return dryRunResponse({ ...result, item: serializeItem(preview, { include: params.include }) });
      }
      return result;
    },

    async "scene.token.item.clone"(params) {
      const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);
      const item = getEmbeddedItem(actor, params.itemId, {
        sceneId: params.sceneId,
        tokenId: params.tokenId
      });

      const patch = canonicalizeFilePathFields(params.patch ?? {}, "Item");
      const clone = await cloneDocument(item, patch, { dryRun: isDryRun(params) });
      const result = {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        actorLink,
        mutatesWorldActor: actorLink,
        item: serializeItem(clone)
      };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "scene.token.item.delete"(params) {
      const { actor, actorLink } = getSceneTokenActor(params.sceneId, params.tokenId);
      await deleteEmbeddedItem(
        actor,
        params.itemId,
        {
          sceneId: params.sceneId,
          tokenId: params.tokenId
        },
        { dryRun: isDryRun(params) }
      );
      const result = {
        sceneId: params.sceneId,
        tokenId: params.tokenId,
        actorLink,
        mutatesWorldActor: actorLink,
        id: params.itemId,
        deleted: !isDryRun(params)
      };
      return isDryRun(params) ? dryRunResponse(result) : result;
    }
  };
}
