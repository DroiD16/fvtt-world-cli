import { Option } from "commander";

import {
  createPlaylistCloneParams,
  createPlaylistCreateParams,
  createPlaylistSoundCloneParams,
  createPlaylistSoundCreateParams,
  createPlaylistSoundUpdateParams,
  createPlaylistUpdateParams,
  type PlaylistFieldOptions,
  type PlaylistSoundFieldOptions
} from "../params.js";
import { executeRemoteCommand } from "../exec.js";
import { parseIdList, parseNumber } from "../parse.js";
import { addPlaylistFieldOptions, addPlaylistSoundFieldOptions } from "./field-options.js";
import {
  type RegistrationContext,
  createSharedRegistrars,
  addIdempotencyKeyOption,
  addNameFilterOption,
  addPaginationOptions,
  nameFilterParams,
  paginationParams
} from "./shared.js";

export function registerPlaylist({ program, dependencies }: RegistrationContext) {
  const { registerOwnershipSet, registerCompendiumImport } = createSharedRegistrars(dependencies);
  const playlist = program.command("playlist").description("Foundry playlist commands");
  playlist.addHelpText(
    "after",
    "\nResult key (--json): .result.playlist / .result.playlists[] (list, get-many); sounds at .result.sound / .result.sounds[] (+ .result.playlistId)."
  );
  registerOwnershipSet(playlist, {
    idFlag: "--playlist-id <playlistId>",
    idKey: "playlistId",
    commandName: "playlist.ownership.set",
    noun: "playlist"
  });
  addNameFilterOption(addPaginationOptions(playlist.command("list"))).action(
    async function listPlaylists(options: { name?: string; limit?: number; offset?: number }) {
      await executeRemoteCommand({
        commandName: "playlist.list",
        params: { ...nameFilterParams(options), ...paginationParams(options) },
        command: this,
        dependencies
      });
    }
  );
  playlist
    .command("get")
    .requiredOption("--playlist-id <playlistId>", "Playlist id")
    .action(async function getPlaylist(options: { playlistId: string }) {
      await executeRemoteCommand({
        commandName: "playlist.get",
        params: { playlistId: options.playlistId },
        command: this,
        dependencies
      });
    });
  playlist
    .command("get-many")
    .requiredOption("--ids <list>", "Comma-separated playlist ids (atomic: all must exist)", parseIdList)
    .action(async function getManyPlaylists(options: { ids: string[] }) {
      await executeRemoteCommand({
        commandName: "playlist.get-many",
        params: { ids: options.ids },
        command: this,
        dependencies
      });
    });
  addPlaylistFieldOptions(
    addIdempotencyKeyOption(playlist.command("create")).requiredOption("--name <name>", "Playlist name"),
    "create"
  )
    .option("--sounds-json <json>", "Inline PlaylistSounds as a JSON array (each requires path)")
    .option("--data-json <json>", "Extra playlist fields (e.g. flags) as a JSON object (merged last)")
    .action(async function createPlaylistCommand(
      options: PlaylistFieldOptions & { name: string; soundsJson?: string; dataJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "playlist.create",
        params: createPlaylistCreateParams(options),
        command: this,
        dependencies
      });
    });
  addPlaylistFieldOptions(
    playlist
      .command("update")
      .requiredOption("--playlist-id <playlistId>", "Playlist id")
      .option("--name <name>", "New playlist name"),
    "update"
  )
    .option("--patch-json <json>", "Extra playlist patch fields (e.g. flags) as a JSON object (merged last)")
    .action(async function updatePlaylistCommand(
      options: PlaylistFieldOptions & { playlistId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "playlist.update",
        params: createPlaylistUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addPlaylistFieldOptions(
    addIdempotencyKeyOption(playlist.command("clone"))
      .requiredOption("--playlist-id <playlistId>", "Source playlist id")
      .option("--name <name>", "Name override for the clone"),
    "clone"
  )
    .option("--patch-json <json>", "Override fields for the clone as a JSON object (merged last)")
    .action(async function clonePlaylistCommand(
      options: PlaylistFieldOptions & { playlistId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "playlist.clone",
        params: createPlaylistCloneParams(options),
        command: this,
        dependencies
      });
    });
  playlist
    .command("delete")
    .requiredOption("--playlist-id <playlistId>", "Playlist id")
    .action(async function deletePlaylist(options: { playlistId: string }) {
      await executeRemoteCommand({
        commandName: "playlist.delete",
        params: { playlistId: options.playlistId },
        command: this,
        dependencies
      });
    });

  playlist
    .command("play")
    .requiredOption("--playlist-id <playlistId>", "Playlist id")
    .action(async function playPlaylistCommand(options: { playlistId: string }) {
      await executeRemoteCommand({
        commandName: "playlist.play",
        params: { playlistId: options.playlistId },
        command: this,
        dependencies
      });
    });
  playlist
    .command("stop")
    .requiredOption("--playlist-id <playlistId>", "Playlist id")
    .action(async function stopPlaylistCommand(options: { playlistId: string }) {
      await executeRemoteCommand({
        commandName: "playlist.stop",
        params: { playlistId: options.playlistId },
        command: this,
        dependencies
      });
    });
  playlist
    .command("play-next")
    .requiredOption("--playlist-id <playlistId>", "Playlist id")
    .option("--sound-id <soundId>", "Current sound id to advance from")
    .addOption(new Option("--direction <direction>", "1 (forward) or -1 (backward)").argParser(parseNumber))
    .action(async function playNextPlaylistCommand(options: {
      playlistId: string;
      soundId?: string;
      direction?: number;
    }) {
      await executeRemoteCommand({
        commandName: "playlist.playNext",
        params: {
          playlistId: options.playlistId,
          ...(options.soundId ? { soundId: options.soundId } : {}),
          ...(options.direction !== undefined ? { direction: options.direction } : {})
        },
        command: this,
        dependencies
      });
    });

  const playlistSound = playlist.command("sound").description("Playlist-embedded sound (track) commands");
  addNameFilterOption(
    addPaginationOptions(
      playlistSound
        .command("list")
        // --playlist-id is OPTIONAL: omit it to list sounds across ALL playlists.
        .option("--playlist-id <playlistId>", "Playlist id (omit to list across all playlists)")
        .option("--path <substring>", "Case-insensitive substring filter on the sound path")
    )
  ).action(async function listPlaylistSounds(options: {
    playlistId?: string;
    name?: string;
    path?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "playlist.sound.list",
      params: {
        ...(options.playlistId !== undefined ? { playlistId: options.playlistId } : {}),
        ...nameFilterParams(options),
        ...(options.path !== undefined ? { path: options.path } : {}),
        ...paginationParams(options)
      },
      command: this,
      dependencies
    });
  });
  playlistSound
    .command("get")
    .requiredOption("--playlist-id <playlistId>", "Playlist id")
    .requiredOption("--sound-id <soundId>", "Sound id")
    .action(async function getPlaylistSound(options: { playlistId: string; soundId: string }) {
      await executeRemoteCommand({
        commandName: "playlist.sound.get",
        params: { playlistId: options.playlistId, soundId: options.soundId },
        command: this,
        dependencies
      });
    });
  addPlaylistSoundFieldOptions(
    addIdempotencyKeyOption(playlistSound.command("create"))
      .requiredOption("--playlist-id <playlistId>", "Playlist id")
      .requiredOption("--path <path>", "Audio file path"),
    "create"
  )
    .option("--data-json <json>", "Full/extra sound data as a JSON object (merged last)")
    .action(async function createPlaylistSoundCommand(
      options: PlaylistSoundFieldOptions & { playlistId: string; path: string; dataJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "playlist.sound.create",
        params: createPlaylistSoundCreateParams(options),
        command: this,
        dependencies
      });
    });
  addPlaylistSoundFieldOptions(
    playlistSound
      .command("update")
      .requiredOption("--playlist-id <playlistId>", "Playlist id")
      .requiredOption("--sound-id <soundId>", "Sound id"),
    "update"
  )
    .option("--patch-json <json>", "Full/extra sound patch as a JSON object (merged last)")
    .action(async function updatePlaylistSoundCommand(
      options: PlaylistSoundFieldOptions & { playlistId: string; soundId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "playlist.sound.update",
        params: createPlaylistSoundUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addPlaylistSoundFieldOptions(
    addIdempotencyKeyOption(playlistSound.command("clone"))
      .requiredOption("--playlist-id <playlistId>", "Playlist id")
      .requiredOption("--sound-id <soundId>", "Source sound id"),
    "clone"
  )
    .option("--patch-json <json>", "Override fields for the clone as a JSON object (merged last)")
    .action(async function clonePlaylistSoundCommand(
      options: PlaylistSoundFieldOptions & { playlistId: string; soundId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "playlist.sound.clone",
        params: createPlaylistSoundCloneParams(options),
        command: this,
        dependencies
      });
    });
  playlistSound
    .command("delete")
    .requiredOption("--playlist-id <playlistId>", "Playlist id")
    .requiredOption("--sound-id <soundId>", "Sound id")
    .action(async function deletePlaylistSound(options: { playlistId: string; soundId: string }) {
      await executeRemoteCommand({
        commandName: "playlist.sound.delete",
        params: { playlistId: options.playlistId, soundId: options.soundId },
        command: this,
        dependencies
      });
    });

  playlistSound
    .command("play")
    .requiredOption("--playlist-id <playlistId>", "Playlist id")
    .requiredOption("--sound-id <soundId>", "Sound id")
    .action(async function playPlaylistSoundCommand(options: { playlistId: string; soundId: string }) {
      await executeRemoteCommand({
        commandName: "playlist.sound.play",
        params: { playlistId: options.playlistId, soundId: options.soundId },
        command: this,
        dependencies
      });
    });
  playlistSound
    .command("stop")
    .requiredOption("--playlist-id <playlistId>", "Playlist id")
    .requiredOption("--sound-id <soundId>", "Sound id")
    .action(async function stopPlaylistSoundCommand(options: { playlistId: string; soundId: string }) {
      await executeRemoteCommand({
        commandName: "playlist.sound.stop",
        params: { playlistId: options.playlistId, soundId: options.soundId },
        command: this,
        dependencies
      });
    });

  registerCompendiumImport(playlist, {
    commandName: "playlist.import-from-compendium",
    noun: "playlist",
    packExample: "mymodule.playlists"
  });
}
