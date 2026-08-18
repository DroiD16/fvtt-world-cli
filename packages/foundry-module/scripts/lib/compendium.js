import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";
import { canonicalizeFilePathFields } from "./file-access.js";
import { cloneValue } from "./serializers.js";

import { getGame } from "./game-collections.js";
import {
  WORLD_DOCUMENT_COLLECTIONS,
  createWorldDocument,
  previewDocumentCreate,
  resolveWorldDocumentClass
} from "./world-docs.js";

export function getCompendiumPacks() {
  const game = getGame();
  return game.packs ?? [];
}

export function getCompendiumPack(packId) {
  const pack = getCompendiumPacks().get?.(packId) ?? null;
  if (!pack) {
    throw createBridgeError(
      ERROR_CODES.COMPENDIUM_NOT_FOUND,
      `Compendium ${packId} was not found; use compendium.list to find valid pack ids`,
      {
        pack: packId
      }
    );
  }

  return pack;
}

export async function getCompendiumDocument(packId, entryId) {
  const pack = getCompendiumPack(packId);
  if (typeof pack.getDocument !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Compendium getDocument API is not available");
  }

  const document = await pack.getDocument(entryId);
  if (!document) {
    throw createBridgeError(
      ERROR_CODES.COMPENDIUM_ENTRY_NOT_FOUND,
      `Compendium entry ${entryId} was not found in ${packId}; use compendium.index with pack "${packId}" to list its entry ids`,
      { pack: packId, entryId }
    );
  }

  return document;
}

/**
 * @param {any} params
 * @param {string} command
 */
export function assertImportFolderChannelUnambiguous(params, command) {
  const folderProvided = Object.prototype.hasOwnProperty.call(params ?? {}, "folder");
  const patchFolderProvided = Object.prototype.hasOwnProperty.call(params?.patch ?? {}, "folder");
  if (!folderProvided || !patchFolderProvided) {
    return;
  }

  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `${command} received the destination folder through BOTH channels (\`folder\` = ${JSON.stringify(
      params.folder
    )} and \`patch.folder\` = ${JSON.stringify(
      params.patch.folder
    )}); they write the same field and this command applies no precedence rule. Supply exactly one: ` +
      "the top-level `folder` param (CLI `--folder <id>` / `--clear-folder`) OR `folder` inside `patch`",
    { command, folder: params.folder, patchFolder: params.patch.folder }
  );
}

/**
 * @param {string} documentName
 * @param {string} packId
 * @param {string} entryId
 * @param {{ folder?: any, folderProvided?: boolean, patch?: any, dryRun?: boolean, normalizeSource?: ((importData: any) => any) | null }} [options]
 */
export async function importWorldDocumentFromCompendium(
  documentName,
  packId,
  entryId,
  { folder = null, folderProvided = false, patch = null, dryRun = false, normalizeSource = null } = {}
) {
  const pack = getCompendiumPack(packId);
  if (pack.documentName !== documentName) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `Compendium ${packId} holds ${pack.documentName} documents, not ${documentName}`,
      { pack: packId, documentName: pack.documentName }
    );
  }

  const source = await getCompendiumDocument(packId, entryId);

  const collection = WORLD_DOCUMENT_COLLECTIONS[documentName]?.();
  if (typeof collection?.fromCompendium !== "function") {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      `${documentName} fromCompendium API is not available`
    );
  }

  const normalized = collection.fromCompendium(source, {
    keepId: false,
    clearFolder: true,
    clearOwnership: true
  });

  const importData = typeof normalizeSource === "function" ? normalizeSource(normalized) : normalized;

  const compendiumSource = importData?._stats?.compendiumSource ?? null;

  const overrides = {
    ...canonicalizeFilePathFields(patch ?? {}, documentName),
    ...(folderProvided ? { folder } : {})
  };
  const merged = mergeImportOverrides(importData, overrides);
  if (compendiumSource !== null) {
    const stats = { ...(merged._stats ?? {}), compendiumSource };
    merged._stats = stats;
  }

  const preview = previewDocumentCreate(resolveWorldDocumentClass(documentName), cloneValue(merged));

  if (dryRun) {
    return preview;
  }

  return createWorldDocument(documentName, merged);
}

function mergeImportOverrides(importData, overrides) {
  const mergeObject = globalThis.foundry?.utils?.mergeObject;
  if (typeof mergeObject === "function") {
    return mergeObject(importData, overrides, { inplace: false, insertKeys: true, insertValues: true });
  }

  return { ...importData, ...overrides };
}
