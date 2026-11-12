import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";
import { canonicalizeFilePathFields } from "./file-access.js";
import {
  applyConfirmedUpdate,
  assertDocumentDeleteCommitted,
  assertRequestedWriteStorable,
  writeCommitted
} from "./write-confirmation.js";

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

  const prepared = prepareEmbeddedItemCreateData(data);

  if (dryRun) {
    return prepared;
  }

  const results = await actor.createEmbeddedDocuments("Item", [prepared], { render: true });
  return getCreateResult(results, "Embedded item creation");
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

  const canonicalPatch = prepareEmbeddedItemUpdateData(patch);
  if (dryRun) {
    await assertRequestedWriteStorable({
      document: current,
      patch: canonicalPatch,
      subject: `Item ${itemId} of actor ${actor.id}`,
      details: { ...details, itemId }
    });
    return current;
  }

  await applyConfirmedUpdate({
    document: current,
    patch: canonicalPatch,
    write: (payload) =>
      actor.updateEmbeddedDocuments("Item", [{ _id: itemId, ...payload }], { diff: true, render: true }),
    subject: `Item ${itemId} of actor ${actor.id}`,
    hookName: "preUpdateItem",
    details: { ...details, itemId }
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

  const results = await actor.deleteEmbeddedDocuments("Item", [itemId], { render: true });
  assertDocumentDeleteCommitted({
    committed: writeCommitted(results),
    subject: `Item ${itemId} of actor ${actor.id}`,
    hookName: "preDeleteItem",
    details: { ...details, itemId }
  });
}

export function getActorItemById(actorId, itemId) {
  return getEmbeddedItem(getActorById(actorId), itemId, { actorId });
}

export async function updateActorItem(actorId, itemId, patch, { dryRun = false } = {}) {
  return updateEmbeddedItem(getActorById(actorId), itemId, patch, { actorId }, { dryRun });
}

/** @param {Record<string, any>} data */
export function prepareEmbeddedItemCreateData(data) {
  return sanitizeEmbeddedItemData(canonicalizeFilePathFields(data, "Item"));
}

/** @param {Record<string, any>} patch */
export function prepareEmbeddedItemUpdateData(patch) {
  return canonicalizeFilePathFields(patch, "Item");
}

export function previewEmbeddedItemCreate(parent, data) {
  return previewPreparedEmbeddedItemCreate(parent, prepareEmbeddedItemCreateData(data));
}

/**
 * @param {any} parent
 * @param {Record<string, any>} preparedData
 */
export function previewPreparedEmbeddedItemCreate(parent, preparedData) {
  return previewDocumentCreate(resolveEmbeddedDocumentClass(parent?.items, "Item"), preparedData, { parent });
}

/** @param {any} parent */
export function getEmbeddedItemDocumentClass(parent) {
  return resolveEmbeddedDocumentClass(parent?.items, "Item") ?? null;
}

export async function createEmbeddedItemMany(parent, payloads) {
  if (typeof parent?.createEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Embedded document create API is not available");
  }
  return parent.createEmbeddedDocuments("Item", payloads, { keepId: true, render: true });
}

export async function updateEmbeddedItemMany(parent, entries) {
  if (typeof parent?.updateEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Embedded document update API is not available");
  }
  return parent.updateEmbeddedDocuments("Item", entries, { diff: true, render: true });
}

export async function deleteEmbeddedItemMany(parent, ids) {
  if (typeof parent?.deleteEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Embedded document delete API is not available");
  }
  return parent.deleteEmbeddedDocuments("Item", ids, { render: true });
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
