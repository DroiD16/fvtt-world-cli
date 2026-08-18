import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

import {
  getActorsCollection,
  getCardsCollection,
  getCombatsCollection,
  getItemsCollection,
  getJournalsCollection,
  getMacrosCollection,
  getMessagesCollection,
  getPlaylistsCollection,
  getScenesCollection,
  getTablesCollection
} from "./game-collections.js";

export function getCreateResult(results, errorMessage) {
  const document = Array.isArray(results) ? (results[0] ?? null) : results;
  if (!document) {
    throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, errorMessage);
  }

  return document;
}

export const WORLD_DOCUMENT_COLLECTIONS = Object.freeze({
  Item: getItemsCollection,
  Actor: getActorsCollection,
  JournalEntry: getJournalsCollection,
  Macro: getMacrosCollection,
  Scene: getScenesCollection,
  Playlist: getPlaylistsCollection,
  ChatMessage: getMessagesCollection,
  RollTable: getTablesCollection,

  Combat: getCombatsCollection,

  Cards: getCardsCollection
});

export function resolveWorldDocumentClass(type) {
  return WORLD_DOCUMENT_COLLECTIONS[type]().documentClass ?? globalThis[type];
}

export async function createWorldDocument(type, data) {
  const DocumentClass = resolveWorldDocumentClass(type);
  if (!DocumentClass?.create) {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, `Foundry ${type} document class is not available`);
  }

  const document = await DocumentClass.create(data, { render: true });
  if (!document) {
    throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, `${type}.create returned no document`);
  }

  return document;
}

export async function updateWorldDocumentMany(type, entries) {
  const DocumentClass = resolveWorldDocumentClass(type);
  if (typeof DocumentClass?.updateDocuments !== "function") {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      `Foundry ${type} batch update API is not available`
    );
  }
  return DocumentClass.updateDocuments(entries, { diff: true, render: true });
}

export async function deleteWorldDocumentMany(type, ids) {
  const DocumentClass = resolveWorldDocumentClass(type);
  if (typeof DocumentClass?.deleteDocuments !== "function") {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      `Foundry ${type} batch delete API is not available`
    );
  }
  return DocumentClass.deleteDocuments(ids, { render: true });
}

/** @param {"Item"|"Actor"|"JournalEntry"} type */
export function getWorldDocumentCollection(type) {
  return WORLD_DOCUMENT_COLLECTIONS[type]?.() ?? null;
}

/** @param {"Item"|"Actor"|"JournalEntry"} type */
export function getWorldDocumentClass(type) {
  return (WORLD_DOCUMENT_COLLECTIONS[type] ? resolveWorldDocumentClass(type) : null) ?? null;
}

export async function createWorldItem(data) {
  return createWorldDocument("Item", data);
}

export async function createMacro(data) {
  return createWorldDocument("Macro", data);
}

export async function createJournalEntry(data) {
  return createWorldDocument("JournalEntry", data);
}

export async function createScene(data) {
  return createWorldDocument("Scene", data);
}

export async function deleteDocument(document, { dryRun = false } = {}) {
  if (typeof document?.delete !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Foundry document delete API is not available");
  }

  if (dryRun) {
    return undefined;
  }

  return document.delete({ render: true });
}

export async function cloneDocument(document, patch = {}, { dryRun = false } = {}) {
  if (typeof document?.clone !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Foundry document clone API is not available");
  }

  if (dryRun) {
    const preview = await document.clone(patch ?? {}, { save: false });
    if (!preview) {
      throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, "Document clone returned no preview");
    }
    return preview;
  }

  const result = await document.clone(patch, { save: true, render: true });
  const clone = Array.isArray(result) ? (result[0] ?? null) : result;
  if (!clone) {
    throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, "Document clone returned no document");
  }

  return clone;
}

/**
 * @param {any} document
 * @param {Record<string, any>} [patch]
 * @returns {Promise<void>}
 */
export async function assertClonePatchValid(document, patch = {}) {
  await computeDocumentUpdateDiff(document, patch ?? {});
}

export async function previewDocumentUpdate(document, patch = {}) {
  if (typeof document?.clone !== "function" || typeof document?.updateSource !== "function") {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      "Foundry document construction API is not available"
    );
  }

  const preview = await document.clone({}, { keepId: true, save: false });
  if (!preview || typeof preview.updateSource !== "function") {
    throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, "Document clone returned no update preview");
  }

  preview.updateSource(patch ?? {});
  return preview;
}

/**
 * @param {any} document
 * @param {Record<string, any>} [patch]
 * @returns {Promise<Record<string, any>>}
 */
export async function computeDocumentUpdateDiff(document, patch = {}) {
  if (typeof document?.clone !== "function" || typeof document?.updateSource !== "function") {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      "Foundry document construction API is not available"
    );
  }
  const probe = await document.clone({}, { keepId: true, save: false });
  if (!probe || typeof probe.updateSource !== "function") {
    throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, "Document clone returned no update probe");
  }
  const diff = probe.updateSource(patch ?? {}, { dryRun: true, fallback: false, clean: { partial: true } });
  return diff && typeof diff === "object" ? diff : {};
}

export function previewDocumentCreate(DocumentClass, data, { parent = null } = {}) {
  if (typeof DocumentClass !== "function") {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      "Foundry document construction API is not available"
    );
  }

  const preview = new DocumentClass(data ?? {}, { parent, strict: true });
  if (!preview) {
    throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, "Document construction returned no create preview");
  }

  return preview;
}

export function previewWorldItemCreate(data) {
  return previewDocumentCreate(resolveWorldDocumentClass("Item"), data);
}

export function previewWorldActorCreate(data) {
  return previewDocumentCreate(resolveWorldDocumentClass("Actor"), data);
}

export function previewJournalEntryCreate(data) {
  return previewDocumentCreate(resolveWorldDocumentClass("JournalEntry"), data);
}

export function previewMacroCreate(data) {
  return previewDocumentCreate(resolveWorldDocumentClass("Macro"), data);
}

export function previewSceneCreate(data) {
  return previewDocumentCreate(resolveWorldDocumentClass("Scene"), data);
}

export function resolveEmbeddedDocumentClass(collection, documentName) {
  return collection?.documentClass ?? globalThis.CONFIG?.[documentName]?.documentClass;
}

export async function createActor(data) {
  return createWorldDocument("Actor", data);
}
