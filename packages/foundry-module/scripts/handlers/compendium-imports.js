import {
  assertImportFolderChannelUnambiguous,
  importWorldDocumentFromCompendium
} from "../lib/compendium.js";
import { assertSceneLevelsFieldsSupported } from "../lib/scene-embedded.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import {
  normalizePreviewCards,
  serializeActor,
  serializeCards,
  serializeItem,
  serializeJournal,
  serializeMacro,
  serializePlaylist,
  serializeScene,
  serializeTable
} from "../lib/serializers.js";

const IMPORT_FAMILIES = Object.freeze({
  "actor.import-from-compendium": Object.freeze({
    documentName: "Actor",
    resultKey: "actor",
    serialize: (document) => serializeActor(document)
  }),
  "item.import-from-compendium": Object.freeze({
    documentName: "Item",
    resultKey: "item",
    serialize: (document) => serializeItem(document)
  }),
  "journal.import-from-compendium": Object.freeze({
    documentName: "JournalEntry",
    resultKey: "journal",
    serialize: (document) => serializeJournal(document)
  }),
  "scene.import-from-compendium": Object.freeze({
    documentName: "Scene",
    resultKey: "scene",
    serialize: (document) => serializeScene(document, { flags: true, provenance: true }),
    assertSupplied: (params) => assertSceneLevelsFieldsSupported(params.patch),
    normalizeSource: (importData) => ({ active: false, ...importData })
  }),
  "macro.import-from-compendium": Object.freeze({
    documentName: "Macro",
    resultKey: "macro",
    serialize: (document) => serializeMacro(document)
  }),
  "playlist.import-from-compendium": Object.freeze({
    documentName: "Playlist",
    resultKey: "playlist",
    serialize: (document) => serializePlaylist(document)
  }),
  "table.import-from-compendium": Object.freeze({
    documentName: "RollTable",
    resultKey: "table",
    serialize: (document) => serializeTable(document)
  }),
  "cards.import-from-compendium": Object.freeze({
    documentName: "Cards",
    resultKey: "cards",
    serialize: (document) => serializeCards(document),
    normalizePreview: (body) => normalizePreviewCards(body)
  })
});

export const WORLD_IMPORT_COMMANDS = Object.freeze(Object.keys(IMPORT_FAMILIES));

async function handleWorldImport(command, family, params) {
  assertImportFolderChannelUnambiguous(params, command);
  family.assertSupplied?.(params);

  const dryRun = isDryRun(params);
  const document = await importWorldDocumentFromCompendium(family.documentName, params.pack, params.entryId, {
    folder: params.folder,
    normalizeSource: family.normalizeSource,

    folderProvided: Object.prototype.hasOwnProperty.call(params, "folder"),
    patch: params.patch,
    dryRun
  });

  const body = family.serialize(document);

  const result = {
    [family.resultKey]: dryRun && family.normalizePreview ? family.normalizePreview(body) : body
  };
  return dryRun ? dryRunResponse(result) : result;
}

export function createCompendiumImportHandlers() {
  /** @type {Record<string, (params: any) => Promise<any>>} */
  const handlers = {};
  for (const [command, family] of Object.entries(IMPORT_FAMILIES)) {
    handlers[command] = (params) => handleWorldImport(command, family, params);
  }
  return handlers;
}
