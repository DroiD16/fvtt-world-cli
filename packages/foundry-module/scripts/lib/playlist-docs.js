import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";
import { canonicalizeFilePathFields } from "./file-access.js";

import { getPlaylistsCollection } from "./game-collections.js";
import {
  createWorldDocument,
  getCreateResult,
  previewDocumentCreate,
  resolveEmbeddedDocumentClass,
  resolveWorldDocumentClass
} from "./world-docs.js";

export function getPlaylistById(playlistId) {
  const playlist = getPlaylistsCollection().get?.(playlistId) ?? null;
  if (!playlist) {
    throw createBridgeError(
      ERROR_CODES.PLAYLIST_NOT_FOUND,
      `Playlist ${playlistId} was not found; use playlist.list to find valid ids`,
      { playlistId }
    );
  }
  return playlist;
}

export async function createPlaylist(data) {
  return createWorldDocument("Playlist", data);
}

export function previewPlaylistCreate(data) {
  return previewDocumentCreate(resolveWorldDocumentClass("Playlist"), data);
}

export function getPlaylistSoundById(playlistId, soundId) {
  const playlist = getPlaylistById(playlistId);
  const sound = playlist.sounds?.get?.(soundId) ?? null;
  if (!sound) {
    throw createBridgeError(
      ERROR_CODES.PLAYLIST_SOUND_NOT_FOUND,
      `PlaylistSound ${soundId} was not found; use playlist.sound.list to find valid ids`,
      { playlistId, soundId }
    );
  }
  return { playlist, sound };
}

function deriveSoundName(path) {
  const derive = globalThis.foundry?.audio?.AudioHelper?.getDefaultSoundName;
  if (typeof derive === "function") {
    return derive.call(globalThis.foundry.audio.AudioHelper, path);
  }

  return path;
}

export function withDerivedSoundName(data) {
  if (!data || typeof data !== "object") {
    return data;
  }

  const canonicalized = canonicalizeFilePathFields(data, "PlaylistSound");
  const hasName = typeof data.name === "string" && data.name.trim().length > 0;
  if (hasName || typeof data.path !== "string" || data.path.length === 0) {
    return canonicalized;
  }
  return { ...canonicalized, name: deriveSoundName(data.path) };
}

export function withDerivedPlaylistSoundNames(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.sounds)) {
    return data;
  }
  return { ...data, sounds: data.sounds.map((sound) => withDerivedSoundName(sound)) };
}

export async function createPlaylistSound(playlist, data, { dryRun = false } = {}) {
  if (typeof playlist.createEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "PlaylistSound create API is not available");
  }

  if (dryRun) {
    return data;
  }
  const results = await playlist.createEmbeddedDocuments("PlaylistSound", [data], { render: true });
  return getCreateResult(results, "PlaylistSound creation returned no document");
}

export async function updatePlaylistSound(playlistId, soundId, patch, { dryRun = false } = {}) {
  const { playlist } = getPlaylistSoundById(playlistId, soundId);
  if (dryRun) {
    return playlist.sounds.get(soundId);
  }
  await playlist.updateEmbeddedDocuments("PlaylistSound", [{ _id: soundId, ...patch }], {
    diff: true,
    render: true
  });
  return playlist.sounds.get(soundId);
}

export async function deletePlaylistSound(playlistId, soundId, { dryRun = false } = {}) {
  const { playlist } = getPlaylistSoundById(playlistId, soundId);
  if (dryRun) {
    return;
  }
  await playlist.deleteEmbeddedDocuments("PlaylistSound", [soundId], { render: true });
}

export function previewPlaylistSoundCreate(playlist, data) {
  return previewDocumentCreate(resolveEmbeddedDocumentClass(playlist?.sounds, "PlaylistSound"), data, {
    parent: playlist
  });
}

export function assertPlaybackMethod(playlist, method) {
  if (typeof playlist?.[method] !== "function") {
    throw createBridgeError(
      ERROR_CODES.UNSUPPORTED_OPERATION,
      `Playlist#${method} is not available in this Foundry runtime`,
      { method }
    );
  }
}

export async function playPlaylist(playlist) {
  assertPlaybackMethod(playlist, "playAll");
  return playlist.playAll();
}

export async function stopPlaylist(playlist) {
  assertPlaybackMethod(playlist, "stopAll");
  return playlist.stopAll();
}

export async function playlistPlayNext(playlist, soundId, direction) {
  assertPlaybackMethod(playlist, "playNext");

  const options = direction === undefined ? {} : { direction };
  return playlist.playNext(soundId, options);
}

export async function playPlaylistSound(playlist, sound) {
  assertPlaybackMethod(playlist, "playSound");
  return playlist.playSound(sound);
}

export async function stopPlaylistSound(playlist, sound) {
  assertPlaybackMethod(playlist, "stopSound");
  return playlist.stopSound(sound);
}
