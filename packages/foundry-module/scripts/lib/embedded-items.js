import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";
import { canonicalizeFilePathFields } from "./file-access.js";

import { getActorById, getItemsCollection } from "./game-collections.js";
import { sanitizeEmbeddedItemData, stripProtectedMeta } from "./sanitize.js";
import {
  cloneDocument,
  getCreateResult,
  previewDocumentCreate,
  resolveEmbeddedDocumentClass
} from "./world-docs.js";
import { getCompendiumDocument, getCompendiumPack } from "./compendium.js";
import { getSceneEmbeddedById } from "./scene-embedded.js";

export function getEmbeddedItem(actor, itemId, details = {}) {
  const item = actor.items?.get?.(itemId) ?? null;
  if (!item) {
    throw createBridgeError(
      ERROR_CODES.ITEM_NOT_FOUND,
      `Item ${itemId} was not found; use actor.item.list or scene.token.item.list to find valid ids`,
      {
        ...details,
        itemId
      }
    );
  }

  return item;
}

export async function createEmbeddedItem(actor, data, { dryRun = false } = {}) {
  if (typeof actor.createEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Embedded document create API is not available");
  }

  data = canonicalizeFilePathFields(data, "Item");

  const prepared = sanitizeEmbeddedItemData(data);

  if (dryRun) {
    return prepared;
  }

  const results = await actor.createEmbeddedDocuments("Item", [prepared], { render: true });
  return getCreateResult(results, "Embedded item creation returned no document");
}

export async function importActorItemFromCompendium(
  actor,
  packId,
  entryId,
  updateData = {},
  { dryRun = false } = {}
) {
  const pack = getCompendiumPack(packId);
  if (pack.documentName !== "Item") {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `Compendium ${packId} holds ${pack.documentName} documents, not Item`,
      { pack: packId, documentName: pack.documentName }
    );
  }

  const source = await getCompendiumDocument(packId, entryId);

  const items = getItemsCollection();
  if (typeof items.fromCompendium !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Item fromCompendium API is not available");
  }

  const importData = items.fromCompendium(source, { keepId: false, clearFolder: true, clearOwnership: true });

  const safeUpdate = stripProtectedMeta(updateData);
  const mergeObject = globalThis.foundry?.utils?.mergeObject;
  const merged =
    typeof mergeObject === "function"
      ? mergeObject(importData, safeUpdate, {
          inplace: false,
          insertKeys: true,
          insertValues: true
        })
      : { ...importData, ...safeUpdate };

  return createEmbeddedItem(actor, merged, { dryRun });
}

export async function updateEmbeddedItem(actor, itemId, patch, details = {}, { dryRun = false } = {}) {
  if (typeof actor.updateEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Embedded document update API is not available");
  }

  const current = getEmbeddedItem(actor, itemId, details);

  if (dryRun) {
    return current;
  }

  const canonicalPatch = canonicalizeFilePathFields(patch, "Item");
  await actor.updateEmbeddedDocuments("Item", [{ _id: itemId, ...canonicalPatch }], {
    diff: true,
    render: true
  });
  return getEmbeddedItem(actor, itemId, details);
}

export async function deleteEmbeddedItem(actor, itemId, details = {}, { dryRun = false } = {}) {
  if (typeof actor.deleteEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Embedded document delete API is not available");
  }

  getEmbeddedItem(actor, itemId, details);

  if (dryRun) {
    return;
  }

  await actor.deleteEmbeddedDocuments("Item", [itemId], { render: true });
}

export function getActorItemById(actorId, itemId) {
  return getEmbeddedItem(getActorById(actorId), itemId, { actorId });
}

export async function updateActorItem(actorId, itemId, patch, { dryRun = false } = {}) {
  return updateEmbeddedItem(getActorById(actorId), itemId, patch, { actorId }, { dryRun });
}

export function previewEmbeddedItemCreate(parent, data) {
  return previewDocumentCreate(
    resolveEmbeddedDocumentClass(parent?.items, "Item"),
    sanitizeEmbeddedItemData(canonicalizeFilePathFields(data, "Item")),
    { parent }
  );
}

export async function deleteActorItem(actorId, itemId, { dryRun = false } = {}) {
  return deleteEmbeddedItem(getActorById(actorId), itemId, { actorId }, { dryRun });
}

export function getSceneTokenActor(sceneId, tokenId) {
  const { document: token } = getSceneEmbeddedById(
    sceneId,
    "Token",
    tokenId,
    ERROR_CODES.TOKEN_NOT_FOUND,
    "tokenId"
  );

  const actor = token.actor ?? null;
  if (!actor) {
    throw createBridgeError(ERROR_CODES.ACTOR_NOT_FOUND, `Token ${tokenId} has no actor`, {
      sceneId,
      tokenId
    });
  }

  return { token, actor, actorLink: Boolean(token.actorLink) };
}

export async function cloneActorItem(actorId, itemId, patch = {}, { dryRun = false } = {}) {
  const item = getActorItemById(actorId, itemId);

  return cloneDocument(item, canonicalizeFilePathFields(patch, "Item"), { dryRun });
}
