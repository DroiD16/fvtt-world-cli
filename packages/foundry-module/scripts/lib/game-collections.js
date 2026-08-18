import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";
import { getGame } from "./validators.js";

export { getGame };

export function getScenesCollection() {
  const game = getGame();
  return game.scenes ?? [];
}

export function getItemsCollection() {
  const game = getGame();
  return game.items ?? [];
}

export function getJournalsCollection() {
  const game = getGame();
  return game.journal ?? [];
}

export function getActorsCollection() {
  const game = getGame();
  return game.actors ?? [];
}

export function getMacrosCollection() {
  const game = getGame();
  return game.macros ?? [];
}

export function getPlaylistsCollection() {
  const game = getGame();
  return game.playlists ?? [];
}

export function getMessagesCollection() {
  const game = getGame();
  return game.messages ?? [];
}

export function getTablesCollection() {
  const game = getGame();
  return game.tables ?? [];
}

export function getFoldersCollection() {
  const game = getGame();
  return game.folders ?? [];
}

export function getSceneById(sceneId) {
  const scene = getScenesCollection().get?.(sceneId) ?? null;
  if (!scene) {
    throw createBridgeError(
      ERROR_CODES.SCENE_NOT_FOUND,
      `Scene ${sceneId} was not found; use scene.list to find valid ids`,
      { sceneId }
    );
  }

  return scene;
}

export function getItemById(itemId) {
  const item = getItemsCollection().get?.(itemId) ?? null;
  if (!item) {
    throw createBridgeError(
      ERROR_CODES.ITEM_NOT_FOUND,
      `Item ${itemId} was not found; use item.list to find valid ids`,
      { itemId }
    );
  }

  return item;
}

export function getJournalById(journalId) {
  const journal = getJournalsCollection().get?.(journalId) ?? null;
  if (!journal) {
    throw createBridgeError(
      ERROR_CODES.JOURNAL_NOT_FOUND,
      `Journal ${journalId} was not found; use journal.list to find valid ids`,
      { journalId }
    );
  }

  return journal;
}

export function getMacroById(macroId) {
  const macro = getMacrosCollection().get?.(macroId) ?? null;
  if (!macro) {
    throw createBridgeError(
      ERROR_CODES.MACRO_NOT_FOUND,
      `Macro ${macroId} was not found; use macro.list to find valid ids`,
      { macroId }
    );
  }

  return macro;
}

export function getActorById(actorId) {
  const actor = getActorsCollection().get?.(actorId) ?? null;
  if (!actor) {
    throw createBridgeError(
      ERROR_CODES.ACTOR_NOT_FOUND,
      `Actor ${actorId} was not found; use actor.list to find valid ids`,
      { actorId }
    );
  }

  return actor;
}

export function getUsersCollection() {
  const game = getGame();
  return game.users ?? [];
}

export function getUserById(userId) {
  const user = getUsersCollection().get?.(userId) ?? null;
  if (!user) {
    throw createBridgeError(
      ERROR_CODES.USER_NOT_FOUND,
      `User ${userId} was not found; use user.list to find valid ids`,
      { userId }
    );
  }

  return user;
}

export function getCombatsCollection() {
  const game = getGame();
  return game.combats ?? [];
}

export function getCardsCollection() {
  const game = getGame();
  return game.cards ?? [];
}
