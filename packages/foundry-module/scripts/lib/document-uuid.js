import { ERROR_CODES } from "../generated/protocol.js";
import { getCompendiumPack } from "./compendium.js";
import { createBridgeError } from "./errors.js";

/** @typedef {{ command: string, idFields: (string | null)[] }} UuidRoute */

/** @type {Readonly<Record<string, UuidRoute>>} */
export const UUID_ROUTES = Object.freeze({
  Actor: { command: "actor.get", idFields: ["actorId"] },
  "Actor.Item": { command: "actor.item.get", idFields: ["actorId", "itemId"] },
  "Actor.ActiveEffect": { command: "actor.effect.get", idFields: ["actorId", "effectId"] },
  "Actor.Item.ActiveEffect": {
    command: "actor.item.effect.get",
    idFields: ["actorId", "itemId", "effectId"]
  },
  Item: { command: "item.get", idFields: ["itemId"] },
  "Item.ActiveEffect": { command: "item.effect.get", idFields: ["itemId", "effectId"] },
  Scene: { command: "scene.get", idFields: ["sceneId"] },
  "Scene.Token": { command: "scene.token.get", idFields: ["sceneId", "tokenId"] },
  "Scene.Token.Actor": { command: "scene.token.get", idFields: ["sceneId", "tokenId", null] },
  "Scene.Token.Actor.Item": {
    command: "scene.token.item.get",
    idFields: ["sceneId", "tokenId", null, "itemId"]
  },
  "Scene.Token.Actor.ActiveEffect": {
    command: "scene.token.effect.get",
    idFields: ["sceneId", "tokenId", null, "effectId"]
  },
  "Scene.Token.Actor.Item.ActiveEffect": {
    command: "scene.token.item.effect.get",
    idFields: ["sceneId", "tokenId", null, "itemId", "effectId"]
  },
  "Scene.Tile": { command: "scene.tile.get", idFields: ["sceneId", "tileId"] },
  "Scene.AmbientSound": { command: "scene.sound.get", idFields: ["sceneId", "soundId"] },
  "Scene.Wall": { command: "scene.wall.get", idFields: ["sceneId", "wallId"] },
  "Scene.Level": { command: "scene.level.get", idFields: ["sceneId", "levelId"] },
  "Scene.Note": { command: "scene.note.get", idFields: ["sceneId", "noteId"] },
  "Scene.Drawing": { command: "scene.drawing.get", idFields: ["sceneId", "drawingId"] },
  "Scene.AmbientLight": { command: "scene.light.get", idFields: ["sceneId", "lightId"] },
  "Scene.MeasuredTemplate": { command: "scene.template.get", idFields: ["sceneId", "templateId"] },
  "Scene.Region": { command: "scene.region.get", idFields: ["sceneId", "regionId"] },
  "Scene.Region.RegionBehavior": {
    command: "scene.region.behavior.get",
    idFields: ["sceneId", "regionId", "behaviorId"]
  },
  JournalEntry: { command: "journal.get", idFields: ["journalId"] },
  "JournalEntry.JournalEntryPage": { command: "journal.page.get", idFields: ["journalId", "pageId"] },
  "JournalEntry.JournalEntryCategory": {
    command: "journal.category.get",
    idFields: ["journalId", "categoryId"]
  },
  Macro: { command: "macro.get", idFields: ["macroId"] },
  Playlist: { command: "playlist.get", idFields: ["playlistId"] },
  "Playlist.PlaylistSound": { command: "playlist.sound.get", idFields: ["playlistId", "soundId"] },
  RollTable: { command: "table.get", idFields: ["tableId"] },
  "RollTable.TableResult": { command: "table.result.get", idFields: ["tableId", "resultId"] },
  Combat: { command: "combat.get", idFields: ["combatId"] },
  "Combat.Combatant": { command: "combat.combatant.get", idFields: ["combatId", "combatantId"] },
  "Combat.CombatantGroup": { command: "combat.group.get", idFields: ["combatId", "groupId"] },
  Cards: { command: "cards.get", idFields: ["cardsId"] },
  "Cards.Card": { command: "cards.card.get", idFields: ["cardsId", "cardId"] },
  ChatMessage: { command: "chat.get", idFields: ["messageId"] },
  Folder: { command: "folder.get", idFields: ["folderId"] },
  User: { command: "user.get", idFields: ["userId"] }
});

const COMPENDIUM_ENTRY_COMMAND = "compendium.get";

/** @type {Readonly<Record<string, string>>} */
const NOT_FOUND_CODES = Object.freeze({
  Actor: ERROR_CODES.ACTOR_NOT_FOUND,
  Item: ERROR_CODES.ITEM_NOT_FOUND,
  ActiveEffect: ERROR_CODES.EFFECT_NOT_FOUND,
  Scene: ERROR_CODES.SCENE_NOT_FOUND,
  Token: ERROR_CODES.TOKEN_NOT_FOUND,
  Tile: ERROR_CODES.TILE_NOT_FOUND,
  AmbientSound: ERROR_CODES.SOUND_NOT_FOUND,
  Wall: ERROR_CODES.WALL_NOT_FOUND,
  Level: ERROR_CODES.LEVEL_NOT_FOUND,
  Note: ERROR_CODES.NOTE_NOT_FOUND,
  Drawing: ERROR_CODES.DRAWING_NOT_FOUND,
  AmbientLight: ERROR_CODES.LIGHT_NOT_FOUND,
  MeasuredTemplate: ERROR_CODES.TEMPLATE_NOT_FOUND,
  Region: ERROR_CODES.REGION_NOT_FOUND,
  RegionBehavior: ERROR_CODES.REGION_BEHAVIOR_NOT_FOUND,
  JournalEntry: ERROR_CODES.JOURNAL_NOT_FOUND,
  JournalEntryPage: ERROR_CODES.JOURNAL_PAGE_NOT_FOUND,
  JournalEntryCategory: ERROR_CODES.JOURNAL_CATEGORY_NOT_FOUND,
  Macro: ERROR_CODES.MACRO_NOT_FOUND,
  Playlist: ERROR_CODES.PLAYLIST_NOT_FOUND,
  PlaylistSound: ERROR_CODES.PLAYLIST_SOUND_NOT_FOUND,
  RollTable: ERROR_CODES.TABLE_NOT_FOUND,
  TableResult: ERROR_CODES.TABLE_RESULT_NOT_FOUND,
  Combat: ERROR_CODES.COMBAT_NOT_FOUND,
  Combatant: ERROR_CODES.COMBATANT_NOT_FOUND,
  CombatantGroup: ERROR_CODES.COMBATANT_GROUP_NOT_FOUND,
  Cards: ERROR_CODES.CARDS_NOT_FOUND,
  Card: ERROR_CODES.CARD_NOT_FOUND,
  ChatMessage: ERROR_CODES.CHAT_MESSAGE_NOT_FOUND,
  Folder: ERROR_CODES.FOLDER_NOT_FOUND,
  User: ERROR_CODES.USER_NOT_FOUND
});

/**
 * @param {string} uuid
 * @param {string} reason
 */
function unsupported(uuid, reason) {
  return createBridgeError(
    ERROR_CODES.UNSUPPORTED_OPERATION,
    `UUID ${uuid} cannot be read through a family get command: ${reason}`,
    { uuid }
  );
}

/**
 * @param {string} uuid
 * @param {string} documentName
 * @param {string} id
 */
function notFound(uuid, documentName, id) {
  return createBridgeError(
    NOT_FOUND_CODES[documentName],
    `${documentName} ${id} of UUID ${uuid} was not found; check the UUID or list the parent's documents to find valid ids`,
    { uuid, documentName, id }
  );
}

/**
 * @param {any} parent
 * @param {string} documentName
 * @param {string} id
 */
function embeddedChild(parent, documentName, id) {
  try {
    return parent?.getEmbeddedDocument?.(documentName, id, { strict: false }) ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {string} uuid
 * @param {any} pack
 * @param {any} parsed
 */
function resolveCompendiumEntry(uuid, pack, parsed) {
  if ((parsed.embedded ?? []).length > 0) {
    throw unsupported(
      uuid,
      "a document embedded in a compendium entry has no get command; read the entry with compendium.get"
    );
  }
  if (parsed.type !== pack.documentName) {
    throw unsupported(uuid, `a compendium ${parsed.type} is not a pack entry`);
  }
  if (!pack.index?.get?.(parsed.id)) {
    throw createBridgeError(
      ERROR_CODES.COMPENDIUM_ENTRY_NOT_FOUND,
      `Compendium entry ${parsed.id} was not found in ${pack.collection}; use compendium.index with pack "${pack.collection}" to list its entry ids`,
      { uuid, pack: pack.collection, entryId: parsed.id }
    );
  }
  return {
    uuid: parsed.uuid,
    documentName: pack.documentName,
    command: COMPENDIUM_ENTRY_COMMAND,
    params: { pack: pack.collection, entryId: parsed.id }
  };
}

/**
 * @param {string} uuid
 */
export function resolveDocumentUuid(uuid) {
  if (uuid.startsWith(".")) {
    throw unsupported(uuid, "a relative UUID needs the document it is relative to; pass the full UUID");
  }

  let parsed = null;
  try {
    parsed = /** @type {any} */ (globalThis).foundry?.utils?.parseUuid?.(uuid) ?? null;
  } catch {
    parsed = null;
  }
  const pack = uuid.startsWith("Compendium.")
    ? (parsed?.collection ?? getCompendiumPack(uuid.split(".").slice(1, 3).join(".")))
    : null;
  if (!parsed?.id || !parsed.documentType) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `${uuid} is not a document UUID; a UUID reads like Actor.<id> or Scene.<id>.Token.<id>`,
      { uuid }
    );
  }

  if (pack) {
    return resolveCompendiumEntry(uuid, pack, parsed);
  }

  const embedded = parsed.embedded ?? [];
  const types = [parsed.documentType, ...embedded.filter((_, index) => index % 2 === 0)];
  const ids = [parsed.documentId, ...embedded.filter((_, index) => index % 2 === 1)];
  const route = UUID_ROUTES[types.join(".")];
  if (!route) {
    throw unsupported(uuid, `no family get command reads a ${types.join(" → ")} document`);
  }

  let document = parsed.collection?.get?.(ids[0]) ?? null;
  if (!document) throw notFound(uuid, types[0], ids[0]);
  for (let index = 1; index < types.length; index += 1) {
    document = embeddedChild(document, types[index], ids[index]);
    if (!document) throw notFound(uuid, types[index], ids[index]);
  }

  return {
    uuid: typeof document.uuid === "string" ? document.uuid : uuid,
    documentName: types[types.length - 1],
    command: route.command,
    params: Object.fromEntries(
      route.idFields.flatMap((field, index) => (field === null ? [] : [[field, ids[index]]]))
    )
  };
}
