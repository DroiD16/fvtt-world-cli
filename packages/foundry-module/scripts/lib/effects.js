import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

import { omitFields, sanitizeEffectData } from "./sanitize.js";
import {
  cloneDocument,
  getCreateResult,
  previewDocumentCreate,
  previewDocumentUpdate,
  resolveEmbeddedDocumentClass
} from "./world-docs.js";

export async function previewEmbeddedEffectUpdate(parent, effect, patch) {
  return previewDocumentUpdate(effect, prepareEmbeddedEffectUpdateData(parent, patch));
}

export function previewEmbeddedEffectCreate(parent, data) {
  return previewPreparedEmbeddedEffectCreate(parent, prepareEmbeddedEffectCreateData(parent, data));
}

function coerceEffectTransferForParent(parent, prepared) {
  if (parent?.documentName === "Actor") {
    return { ...omitFields(prepared, EFFECT_TRANSFER_FIELD), transfer: false };
  }
  return prepared;
}

const EFFECT_TRANSFER_FIELD = Object.freeze(new Set(["transfer"]));

/**
 * @param {any} parent
 * @param {Record<string, any>} data
 */
export function prepareEmbeddedEffectCreateData(parent, data) {
  return coerceEffectTransferForParent(parent, sanitizeEffectData(data));
}

/**
 * @param {any} parent
 * @param {Record<string, any>} patch
 */
export function prepareEmbeddedEffectUpdateData(parent, patch) {
  return coerceEffectTransferForParent(parent, sanitizeEffectData(patch ?? {}));
}

/** @param {any} parent */
export function getEmbeddedEffectCollection(parent) {
  return parent?.effects ?? null;
}

/** @param {any} parent */
export function getEmbeddedEffectDocumentClass(parent) {
  return resolveEmbeddedDocumentClass(parent?.effects, "ActiveEffect") ?? null;
}

/**
 * @param {any} parent
 * @param {Record<string, any>} preparedData
 */
export function previewPreparedEmbeddedEffectCreate(parent, preparedData) {
  return previewDocumentCreate(resolveEmbeddedDocumentClass(parent?.effects, "ActiveEffect"), preparedData, {
    parent
  });
}

export async function createEmbeddedEffectMany(parent, payloads) {
  if (typeof parent?.createEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Embedded document create API is not available");
  }
  return parent.createEmbeddedDocuments("ActiveEffect", payloads, { keepId: true, render: true });
}

export async function updateEmbeddedEffectMany(parent, entries) {
  if (typeof parent?.updateEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Embedded document update API is not available");
  }
  return parent.updateEmbeddedDocuments("ActiveEffect", entries, { diff: true, render: true });
}

export async function deleteEmbeddedEffectMany(parent, ids) {
  if (typeof parent?.deleteEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Embedded document delete API is not available");
  }
  return parent.deleteEmbeddedDocuments("ActiveEffect", ids, { render: true });
}

export function getEmbeddedEffect(parent, effectId, details = {}) {
  const effect = parent.effects?.get?.(effectId) ?? null;
  if (!effect) {
    throw createBridgeError(
      ERROR_CODES.EFFECT_NOT_FOUND,
      `Effect ${effectId} was not found; use the matching embedded effect list command (actor.effect.list, actor.item.effect.list, scene.token.effect.list, or scene.token.item.effect.list) to find valid ids`,
      {
        ...details,
        effectId
      }
    );
  }

  return effect;
}

export async function createEmbeddedEffect(parent, data, { dryRun = false } = {}) {
  if (typeof parent.createEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Embedded document create API is not available");
  }

  const prepared = prepareEmbeddedEffectCreateData(parent, data);

  if (dryRun) {
    return prepared;
  }

  const results = await parent.createEmbeddedDocuments("ActiveEffect", [prepared], {
    render: true
  });
  return getCreateResult(results, "Embedded effect creation returned no document");
}

export async function updateEmbeddedEffect(parent, effectId, patch, details = {}, { dryRun = false } = {}) {
  if (typeof parent.updateEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Embedded document update API is not available");
  }

  const current = getEmbeddedEffect(parent, effectId, details);

  if (dryRun) {
    return current;
  }

  await parent.updateEmbeddedDocuments(
    "ActiveEffect",
    [{ ...prepareEmbeddedEffectUpdateData(parent, patch), _id: effectId }],
    { diff: true, render: true }
  );
  return getEmbeddedEffect(parent, effectId, details);
}

export async function deleteEmbeddedEffect(parent, effectId, details = {}, { dryRun = false } = {}) {
  if (typeof parent.deleteEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Embedded document delete API is not available");
  }

  getEmbeddedEffect(parent, effectId, details);

  if (dryRun) {
    return;
  }

  await parent.deleteEmbeddedDocuments("ActiveEffect", [effectId], { render: true });
}

export async function cloneEmbeddedEffect(
  parent,
  effectId,
  patch = {},
  details = {},
  { dryRun = false } = {}
) {
  const effect = getEmbeddedEffect(parent, effectId, details);
  return cloneDocument(effect, prepareEmbeddedEffectUpdateData(parent, patch), { dryRun });
}
