import { getPlaylistsCollection } from "../lib/game-collections.js";
import {
  assertPlaybackMethod,
  createPlaylist,
  createPlaylistSound,
  deletePlaylistSound,
  getPlaylistById,
  getPlaylistSoundById,
  playPlaylist,
  playPlaylistSound,
  playlistPlayNext,
  previewPlaylistCreate,
  previewPlaylistSoundCreate,
  stopPlaylist,
  stopPlaylistSound,
  updatePlaylistSound,
  withDerivedPlaylistSoundNames,
  withDerivedSoundName
} from "../lib/playlist-docs.js";
import { cloneDocument, deleteDocument, previewDocumentUpdate } from "../lib/world-docs.js";
import { BATCH_GET_MAX_IDS, ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "../lib/errors.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { canonicalizeFilePathFields } from "../lib/file-access.js";
import {
  filterByName,
  filterByPath,
  paginate,
  serializePlaylist,
  serializePlaylistSound,
  serializePlaylistSoundSummary,
  serializePlaylistSummary
} from "../lib/serializers.js";

function comparePlaylists(a, b) {
  const sortA = Number.isFinite(a?.sort) ? a.sort : Number.POSITIVE_INFINITY;
  const sortB = Number.isFinite(b?.sort) ? b.sort : Number.POSITIVE_INFINITY;
  if (sortA !== sortB) return sortA - sortB;
  return String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
}

function compareSounds(a, b) {
  const sortA = Number.isFinite(a?.sort) ? a.sort : Number.POSITIVE_INFINITY;
  const sortB = Number.isFinite(b?.sort) ? b.sort : Number.POSITIVE_INFINITY;
  return sortA - sortB;
}

export function createPlaylistHandlers() {
  return {
    async "playlist.list"(params) {
      const playlists = filterByName(Array.from(getPlaylistsCollection()), params.name);
      const { page, total, hasMore } = paginate(playlists, params);
      return {
        playlists: page.map((playlist) => serializePlaylistSummary(playlist)),
        total,
        hasMore
      };
    },

    async "playlist.get"(params) {
      const playlist = getPlaylistById(params.playlistId);
      return {
        playlist: serializePlaylist(playlist, { ownership: true })
      };
    },

    async "playlist.get-many"(params) {
      const ids = params.ids;
      if (ids.length > BATCH_GET_MAX_IDS) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `playlist.get-many accepts at most ${BATCH_GET_MAX_IDS} ids`,
          { max: BATCH_GET_MAX_IDS, received: ids.length }
        );
      }

      const playlists = ids.map((id) => serializePlaylist(getPlaylistById(id), { ownership: true }));
      return { playlists };
    },

    async "playlist.create"(params) {
      const data = withDerivedPlaylistSoundNames(params.data);
      if (isDryRun(params)) {
        const preview = previewPlaylistCreate(data);
        return dryRunResponse({ playlist: serializePlaylist(preview) });
      }

      const playlist = await createPlaylist(data);
      return {
        playlist: serializePlaylist(playlist)
      };
    },

    async "playlist.update"(params) {
      const playlist = getPlaylistById(params.playlistId);
      if (isDryRun(params)) {
        const preview = await previewDocumentUpdate(playlist, params.patch);
        return dryRunResponse({ playlist: serializePlaylist(preview) });
      }

      await playlist.update(params.patch, { diff: true, render: true });
      return {
        playlist: serializePlaylist(playlist)
      };
    },

    async "playlist.clone"(params) {
      const playlist = getPlaylistById(params.playlistId);
      const clone = await cloneDocument(playlist, params.patch ?? {}, { dryRun: isDryRun(params) });
      const result = { playlist: serializePlaylist(clone) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "playlist.delete"(params) {
      const playlist = getPlaylistById(params.playlistId);
      const id = playlist.id ?? params.playlistId;
      if (isDryRun(params)) {
        return dryRunResponse({ id, deleted: false });
      }

      await deleteDocument(playlist);
      return {
        id,
        deleted: true
      };
    },

    async "playlist.sound.list"(params) {
      const playlists =
        params.playlistId != null
          ? [getPlaylistById(params.playlistId)]
          : Array.from(getPlaylistsCollection()).sort(comparePlaylists);

      const ordered = [];
      const parentOf = new Map();
      for (const playlist of playlists) {
        const sounds = (playlist.sounds ? Array.from(playlist.sounds) : []).sort(compareSounds);
        for (const sound of sounds) {
          ordered.push(sound);
          parentOf.set(sound, playlist);
        }
      }

      const filtered = filterByPath(filterByName(ordered, params.name), params.path);
      const { page, total, hasMore } = paginate(filtered, params);
      return {
        ...(params.playlistId != null ? { playlistId: params.playlistId } : {}),
        sounds: page.map((sound) => serializePlaylistSoundSummary(sound, parentOf.get(sound))),
        total,
        hasMore
      };
    },

    async "playlist.sound.get"(params) {
      const { sound } = getPlaylistSoundById(params.playlistId, params.soundId);
      return { playlistId: params.playlistId, sound: serializePlaylistSound(sound) };
    },

    async "playlist.sound.create"(params) {
      const playlist = getPlaylistById(params.playlistId);

      const data = withDerivedSoundName(params.data);
      const sound = await createPlaylistSound(playlist, data, { dryRun: isDryRun(params) });
      const result = { playlistId: params.playlistId, sound: serializePlaylistSound(sound) };
      if (isDryRun(params)) {
        const preview = previewPlaylistSoundCreate(playlist, data);
        return dryRunResponse({ ...result, sound: serializePlaylistSound(preview) });
      }
      return result;
    },

    async "playlist.sound.update"(params) {
      const patch = canonicalizeFilePathFields(params.patch, "PlaylistSound");
      const sound = await updatePlaylistSound(params.playlistId, params.soundId, patch, {
        dryRun: isDryRun(params)
      });
      const result = { playlistId: params.playlistId, sound: serializePlaylistSound(sound) };
      if (isDryRun(params)) {
        const preview = await previewDocumentUpdate(sound, patch);
        return dryRunResponse({ ...result, sound: serializePlaylistSound(preview) });
      }
      return result;
    },

    async "playlist.sound.clone"(params) {
      const { sound } = getPlaylistSoundById(params.playlistId, params.soundId);
      const patch = canonicalizeFilePathFields(params.patch, "PlaylistSound");
      const clone = await cloneDocument(sound, patch ?? {}, { dryRun: isDryRun(params) });
      const result = { playlistId: params.playlistId, sound: serializePlaylistSound(clone) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "playlist.sound.delete"(params) {
      await deletePlaylistSound(params.playlistId, params.soundId, { dryRun: isDryRun(params) });
      const result = { playlistId: params.playlistId, id: params.soundId, deleted: !isDryRun(params) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "playlist.play"(params) {
      const playlist = getPlaylistById(params.playlistId);
      assertPlaybackMethod(playlist, "playAll");
      if (isDryRun(params)) {
        return dryRunResponse({ playlist: serializePlaylist(playlist) });
      }
      await playPlaylist(playlist);
      return { playlist: serializePlaylist(getPlaylistById(params.playlistId)) };
    },

    async "playlist.stop"(params) {
      const playlist = getPlaylistById(params.playlistId);
      assertPlaybackMethod(playlist, "stopAll");
      if (isDryRun(params)) {
        return dryRunResponse({ playlist: serializePlaylist(playlist) });
      }
      await stopPlaylist(playlist);
      return { playlist: serializePlaylist(getPlaylistById(params.playlistId)) };
    },

    async "playlist.playNext"(params) {
      const playlist = getPlaylistById(params.playlistId);

      if (params.soundId !== undefined) {
        getPlaylistSoundById(params.playlistId, params.soundId);
      }
      assertPlaybackMethod(playlist, "playNext");
      if (isDryRun(params)) {
        return dryRunResponse({ playlist: serializePlaylist(playlist) });
      }
      await playlistPlayNext(playlist, params.soundId, params.direction);
      return { playlist: serializePlaylist(getPlaylistById(params.playlistId)) };
    },

    async "playlist.sound.play"(params) {
      const { playlist, sound } = getPlaylistSoundById(params.playlistId, params.soundId);
      assertPlaybackMethod(playlist, "playSound");
      if (isDryRun(params)) {
        return dryRunResponse({ playlistId: params.playlistId, sound: serializePlaylistSound(sound) });
      }
      await playPlaylistSound(playlist, sound);
      const { sound: post } = getPlaylistSoundById(params.playlistId, params.soundId);
      return { playlistId: params.playlistId, sound: serializePlaylistSound(post) };
    },

    async "playlist.sound.stop"(params) {
      const { playlist, sound } = getPlaylistSoundById(params.playlistId, params.soundId);
      assertPlaybackMethod(playlist, "stopSound");
      if (isDryRun(params)) {
        return dryRunResponse({ playlistId: params.playlistId, sound: serializePlaylistSound(sound) });
      }
      await stopPlaylistSound(playlist, sound);
      const { sound: post } = getPlaylistSoundById(params.playlistId, params.soundId);
      return { playlistId: params.playlistId, sound: serializePlaylistSound(post) };
    }
  };
}
