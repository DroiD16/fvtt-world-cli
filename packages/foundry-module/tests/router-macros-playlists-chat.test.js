import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";

import { ERROR_CODES } from "../scripts/generated/protocol.js";

import { createPlaylistDocument, createRequest, installFakeFoundry } from "./helpers/fake-foundry.js";

describe("command router", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  it("lists, gets, creates, and updates macros", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("macro.list"));
    const getResponse = await router.route(createRequest("macro.get", { macroId: "macro-1" }));
    const createResponse = await router.route(
      createRequest("macro.create", {
        data: {
          name: "Buff Macro",
          type: "script",
          command: "console.log('buff');",
          scope: "global"
        }
      })
    );
    const updateResponse = await router.route(
      createRequest("macro.update", {
        macroId: "macro-1",
        patch: { name: "Heal Macro v2", command: "console.log('heal v2');" }
      })
    );

    expect(listResponse.ok).toBe(true);

    expect(listResponse.result.macros).toHaveLength(1);
    expect(listResponse.result.macros[0]).toMatchObject({
      id: "macro-1",
      name: "Heal Macro",
      type: "script",
      scope: "global"
    });
    expect(listResponse.result.macros[0].command).toBeUndefined();
    expect(listResponse.result.macros[0].flags).toBeUndefined();

    expect(getResponse.ok).toBe(true);

    expect(getResponse.result.macro.command).toBe("console.log('heal');");
    expect(getResponse.result.macro.flags).toEqual({ "midi-qol": { onUseMacroName: "heal" } });

    expect(createResponse.ok).toBe(true);
    expect(globalThis.Macro.create).toHaveBeenCalledWith(
      { name: "Buff Macro", type: "script", command: "console.log('buff');", scope: "global" },
      { render: true }
    );
    expect(createResponse.result.macro.id).toBe("macro-created");
    expect(createResponse.result.macro._id).toBe("macro-created");

    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.macro.name).toBe("Heal Macro v2");
    expect(updateResponse.result.macro.command).toBe("console.log('heal v2');");
  });

  it("canonicalizes a literal macro img on create/update and passes an absolute https:// value through", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const createResponse = await router.route(
      createRequest("macro.create", {
        data: { name: "Art Macro", type: "script", img: "worlds/world-1/icons/big spell (v2).png" }
      })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.macro.img).toBe("worlds/world-1/icons/big%20spell%20(v2).png");

    const updateResponse = await router.route(
      createRequest("macro.update", { macroId: "macro-1", patch: { img: "https://cdn.example.com/x y.png" } })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.macro.img).toBe("https://cdn.example.com/x y.png");
  });

  it("clones and deletes macros", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const cloneResponse = await router.route(
      createRequest("macro.clone", { macroId: "macro-1", patch: { name: "Heal Copy" } })
    );
    expect(cloneResponse.ok).toBe(true);

    expect(cloneResponse.result.macro.id).toBe("macro-1-clone");
    expect(cloneResponse.result.macro._id).toBe("macro-1-clone");
    expect(cloneResponse.result.macro.name).toBe("Heal Copy");

    const deleteResponse = await router.route(createRequest("macro.delete", { macroId: "macro-1" }));
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: "macro-1", deleted: true });
  });

  it("returns a stable not-found error for missing macros", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(createRequest("macro.get", { macroId: "missing-macro" }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("MACRO_NOT_FOUND");
    expect(response.error.message).toContain("missing-macro");
    expect(response.error.message).toContain("macro.list");
  });

  it("macro.create/update dry-run returns a preview without persisting", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const createResponse = await router.route(
      createRequest("macro.create", { data: { name: "Preview Macro", type: "script" }, dryRun: true })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.dryRun).toBe(true);

    expect(createResponse.result.macro.name).toBe("Preview Macro");
    expect(createResponse.result).not.toHaveProperty("preview");

    expect(globalThis.Macro.create).not.toHaveBeenCalled();

    const macroDoc = globalThis.game.macros.get("macro-1");
    const updateResponse = await router.route(
      createRequest("macro.update", { macroId: "macro-1", patch: { name: "Would Rename" }, dryRun: true })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.dryRun).toBe(true);
    expect(updateResponse.result.macro.name).toBe("Would Rename");
    expect(updateResponse.result).not.toHaveProperty("preview");

    expect(macroDoc.update).not.toHaveBeenCalled();
  });

  it("rejects macro writes for non-GM sessions", async () => {
    globalThis.game.user.isGM = false;
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("macro.update", { macroId: "macro-1", patch: { name: "No" } })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("PERMISSION_DENIED");
  });

  it("lists, gets, creates, updates, clones, and deletes playlists", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("playlist.list"));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.playlists).toHaveLength(1);

    expect(listResponse.result.playlists[0]).toMatchObject({
      id: "playlist-1",
      name: "Tavern",
      soundCount: 1
    });
    expect(listResponse.result.playlists[0].sounds).toBeUndefined();

    const getResponse = await router.route(createRequest("playlist.get", { playlistId: "playlist-1" }));
    expect(getResponse.ok).toBe(true);

    expect(getResponse.result.playlist.sounds).toHaveLength(1);
    expect(getResponse.result.playlist.sounds[0]).toMatchObject({ id: "sound-1", path: "tavern/lute.ogg" });

    const createResponse = await router.route(
      createRequest("playlist.create", { data: { name: "Combat", mode: 1 } })
    );
    expect(createResponse.ok).toBe(true);
    expect(globalThis.Playlist.create).toHaveBeenCalled();
    expect(createResponse.result.playlist.id).toBe("playlist-created");

    const createWithSounds = await router.route(
      createRequest("playlist.create", {
        data: { name: "Bundle", sounds: [{ path: "a.ogg" }, { path: "b.ogg" }] }
      })
    );
    expect(createWithSounds.ok).toBe(true);
    expect(createWithSounds.result.playlist.sounds).toHaveLength(2);

    expect(createWithSounds.result.playlist.sounds.map((sound) => sound.name)).toEqual([
      "derived:a.ogg",
      "derived:b.ogg"
    ]);

    const updateResponse = await router.route(
      createRequest("playlist.update", { playlistId: "playlist-1", patch: { name: "Tavern v2", mode: 2 } })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.playlist.name).toBe("Tavern v2");
    expect(updateResponse.result.playlist.mode).toBe(2);

    const cloneResponse = await router.route(
      createRequest("playlist.clone", { playlistId: "playlist-1", patch: { name: "Tavern Copy" } })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.playlist.id).toBe("playlist-1-clone");
    expect(cloneResponse.result.playlist.name).toBe("Tavern Copy");

    const deleteResponse = await router.route(createRequest("playlist.delete", { playlistId: "playlist-1" }));
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: "playlist-1", deleted: true });
  });

  it("creates, lists, gets, updates, clones, and deletes playlist sounds", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const createResponse = await router.route(
      createRequest("playlist.sound.create", {
        playlistId: "playlist-1",
        data: { name: "Drum", path: "tavern/drum.ogg", volume: 0.5 }
      })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.playlistId).toBe("playlist-1");
    const newSoundId = createResponse.result.sound.id;

    const listResponse = await router.route(
      createRequest("playlist.sound.list", { playlistId: "playlist-1" })
    );
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.sounds).toHaveLength(2);

    expect(listResponse.result.sounds[0].flags).toBeUndefined();

    const getResponse = await router.route(
      createRequest("playlist.sound.get", { playlistId: "playlist-1", soundId: newSoundId })
    );
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.sound).toMatchObject({ path: "tavern/drum.ogg", volume: 0.5 });

    const updateResponse = await router.route(
      createRequest("playlist.sound.update", {
        playlistId: "playlist-1",
        soundId: newSoundId,
        patch: { volume: 0.25 }
      })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.sound.volume).toBe(0.25);

    const cloneResponse = await router.route(
      createRequest("playlist.sound.clone", { playlistId: "playlist-1", soundId: "sound-1" })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.sound.id).toBe("sound-1-clone");

    const deleteResponse = await router.route(
      createRequest("playlist.sound.delete", { playlistId: "playlist-1", soundId: newSoundId })
    );
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: newSoundId, deleted: true });
  });

  it("derives a PlaylistSound name from path when name is omitted", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const createResponse = await router.route(
      createRequest("playlist.sound.create", { playlistId: "playlist-1", data: { path: "tavern/gong.ogg" } })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.sound.name).toBe("derived:tavern/gong.ogg");

    const previewResponse = await router.route(
      createRequest("playlist.sound.create", {
        playlistId: "playlist-1",
        data: { path: "tavern/bell.ogg" },
        dryRun: true
      })
    );
    expect(previewResponse.ok).toBe(true);
    expect(previewResponse.result.sound.name).toBe("derived:tavern/bell.ogg");
  });

  it("canonicalizes a literal PlaylistSound path to Foundry's stored form on create", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const literalPath = "worlds/w/fvtt-world-cli/smoke/It's a (test) #1.ogg";
    const canonicalPath = "worlds/w/fvtt-world-cli/smoke/It%27s%20a%20(test)%20%231.ogg";

    const createResponse = await router.route(
      createRequest("playlist.sound.create", { playlistId: "playlist-1", data: { path: literalPath } })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.sound.path).toBe(canonicalPath);

    expect(createResponse.result.sound.name).toBe(`derived:${literalPath}`);

    const getResponse = await router.route(
      createRequest("playlist.sound.get", {
        playlistId: "playlist-1",
        soundId: createResponse.result.sound.id
      })
    );
    expect(getResponse.result.sound.path).toBe(canonicalPath);

    const updateResponse = await router.route(
      createRequest("playlist.sound.update", {
        playlistId: "playlist-1",
        soundId: createResponse.result.sound.id,
        patch: { path: canonicalPath }
      })
    );
    expect(updateResponse.result.sound.path).toBe(canonicalPath);
  });

  it("playlist / playlist.sound create + delete dry-run does not persist", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const createResponse = await router.route(
      createRequest("playlist.create", { data: { name: "Preview" }, dryRun: true })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.dryRun).toBe(true);
    expect(createResponse.result.playlist.name).toBe("Preview");
    expect(createResponse.result).not.toHaveProperty("preview");
    expect(globalThis.Playlist.create).not.toHaveBeenCalled();

    const playlistDoc = globalThis.game.playlists.get("playlist-1");
    const soundCreate = await router.route(
      createRequest("playlist.sound.create", {
        playlistId: "playlist-1",
        data: { path: "x.ogg" },
        dryRun: true
      })
    );
    expect(soundCreate.ok).toBe(true);
    expect(soundCreate.result.dryRun).toBe(true);
    expect(soundCreate.result.sound.path).toBe("x.ogg");
    expect(playlistDoc.createEmbeddedDocuments).not.toHaveBeenCalled();

    const soundDelete = await router.route(
      createRequest("playlist.sound.delete", { playlistId: "playlist-1", soundId: "sound-1", dryRun: true })
    );
    expect(soundDelete.ok).toBe(true);
    expect(soundDelete.result.dryRun).toBe(true);
    expect(soundDelete.result.deleted).toBe(false);
    expect(playlistDoc.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("paginates and name-filters both playlist lists", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const nameFiltered = await router.route(createRequest("playlist.list", { name: "tav" }));
    expect(nameFiltered.ok).toBe(true);
    expect(nameFiltered.result.playlists).toHaveLength(1);
    const noMatch = await router.route(createRequest("playlist.list", { name: "zzz" }));
    expect(noMatch.result.playlists).toHaveLength(0);

    const paged = await router.route(
      createRequest("playlist.sound.list", { playlistId: "playlist-1", limit: 1, offset: 0 })
    );
    expect(paged.ok).toBe(true);
    expect(paged.result.sounds).toHaveLength(1);
    expect(paged.result.total).toBe(1);

    expect(paged.result.playlistId).toBe("playlist-1");
    expect(paged.result.sounds[0]).toMatchObject({
      playlistId: "playlist-1",
      playlistName: "Tavern",
      duration: null
    });
  });

  it("lists sounds across ALL playlists when playlistId is omitted, flattened with playlist context", async () => {
    globalThis.game.playlists.set(
      createPlaylistDocument("playlist-2", {
        name: "Battle",
        sort: 5,
        sounds: [
          { id: "battle-horn", name: "Horn", path: "battle/horn-extended.ogg", sort: 10 },
          { id: "battle-drum", name: "Drum", path: "battle/drum.ogg", sort: 0 }
        ]
      })
    );
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const all = await router.route(createRequest("playlist.sound.list", {}));
    expect(all.ok).toBe(true);

    expect("playlistId" in all.result).toBe(false);
    expect(all.result.total).toBe(3);
    expect(all.result.sounds.map((s) => [s.playlistName, s.name])).toEqual([
      ["Tavern", "Lute"],
      ["Battle", "Drum"],
      ["Battle", "Horn"]
    ]);
    expect(all.result.sounds[0]).toMatchObject({ playlistId: "playlist-1", duration: null });

    const filtered = await router.route(createRequest("playlist.sound.list", { path: "EXTENDED" }));
    expect(filtered.ok).toBe(true);
    expect(filtered.result.total).toBe(1);
    expect(filtered.result.sounds[0]).toMatchObject({ name: "Horn", playlistName: "Battle" });
  });

  it("returns stable not-found errors for missing playlists and playlist sounds", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const missingPlaylist = await router.route(createRequest("playlist.get", { playlistId: "missing-pl" }));
    expect(missingPlaylist.ok).toBe(false);
    expect(missingPlaylist.error.code).toBe("PLAYLIST_NOT_FOUND");
    expect(missingPlaylist.error.message).toContain("playlist.list");

    const missingSoundPlaylist = await router.route(
      createRequest("playlist.sound.get", { playlistId: "missing-pl", soundId: "s-1" })
    );
    expect(missingSoundPlaylist.ok).toBe(false);
    expect(missingSoundPlaylist.error.code).toBe("PLAYLIST_NOT_FOUND");

    const missingSound = await router.route(
      createRequest("playlist.sound.get", { playlistId: "playlist-1", soundId: "missing-sound" })
    );
    expect(missingSound.ok).toBe(false);
    expect(missingSound.error.code).toBe("PLAYLIST_SOUND_NOT_FOUND");
    expect(missingSound.error.message).toContain("playlist.sound.list");
  });

  it("playlist.play calls playAll once and returns playing post-state", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const playlist = globalThis.game.playlists.get("playlist-1");

    const response = await router.route(createRequest("playlist.play", { playlistId: "playlist-1" }));
    expect(response.ok).toBe(true);
    expect(playlist.playAll).toHaveBeenCalledTimes(1);
    expect(response.result.playlist.playing).toBe(true);
  });

  it("playlist.stop calls stopAll and returns playing:false post-state", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const playlist = globalThis.game.playlists.get("playlist-1");
    await router.route(createRequest("playlist.play", { playlistId: "playlist-1" }));

    const response = await router.route(createRequest("playlist.stop", { playlistId: "playlist-1" }));
    expect(response.ok).toBe(true);
    expect(playlist.stopAll).toHaveBeenCalledTimes(1);
    expect(response.result.playlist.playing).toBe(false);
  });

  it("playlist.play dryRun is silent (no playAll, current state, no preview)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const playlist = globalThis.game.playlists.get("playlist-1");

    const response = await router.route(
      createRequest("playlist.play", { playlistId: "playlist-1", dryRun: true })
    );
    expect(response.ok).toBe(true);
    expect(response.result.dryRun).toBe(true);
    expect(playlist.playAll).not.toHaveBeenCalled();
    expect(response.result.playlist.playing).toBe(false);
    expect(response.result.preview).toBeUndefined();
  });

  it("playlist.playNext calls playNext on real run and NOT on dryRun", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const playlist = globalThis.game.playlists.get("playlist-1");

    const dry = await router.route(
      createRequest("playlist.playNext", { playlistId: "playlist-1", dryRun: true })
    );
    expect(dry.ok).toBe(true);
    expect(playlist.playNext).not.toHaveBeenCalled();

    const response = await router.route(
      createRequest("playlist.playNext", { playlistId: "playlist-1", direction: 1 })
    );
    expect(response.ok).toBe(true);
    expect(playlist.playNext).toHaveBeenCalledTimes(1);
  });

  it("playlist.playNext validates a provided soundId (unknown id → PLAYLIST_SOUND_NOT_FOUND, playNext NOT called)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const playlist = globalThis.game.playlists.get("playlist-1");

    const response = await router.route(
      createRequest("playlist.playNext", { playlistId: "playlist-1", soundId: "missing-sound" })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("PLAYLIST_SOUND_NOT_FOUND");

    expect(playlist.playNext).not.toHaveBeenCalled();
  });

  it("playlist.sound.play calls playSound with the sound INSTANCE and flips playing", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const playlist = globalThis.game.playlists.get("playlist-1");
    const sound = playlist.sounds.get("sound-1");

    const response = await router.route(
      createRequest("playlist.sound.play", { playlistId: "playlist-1", soundId: "sound-1" })
    );
    expect(response.ok).toBe(true);
    expect(playlist.playSound).toHaveBeenCalledWith(sound);
    expect(response.result.playlistId).toBe("playlist-1");
    expect(response.result.sound.playing).toBe(true);
  });

  it("playlist.sound.stop dryRun does not call stopSound and returns current state", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const playlist = globalThis.game.playlists.get("playlist-1");

    const response = await router.route(
      createRequest("playlist.sound.stop", { playlistId: "playlist-1", soundId: "sound-1", dryRun: true })
    );
    expect(response.ok).toBe(true);
    expect(response.result.dryRun).toBe(true);
    expect(playlist.stopSound).not.toHaveBeenCalled();
    expect(response.result.sound.id).toBe("sound-1");
  });

  it("playback not-found paths reuse PLAYLIST_NOT_FOUND / PLAYLIST_SOUND_NOT_FOUND", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const missingPlaylist = await router.route(createRequest("playlist.play", { playlistId: "missing-pl" }));
    expect(missingPlaylist.ok).toBe(false);
    expect(missingPlaylist.error.code).toBe("PLAYLIST_NOT_FOUND");

    const missingSound = await router.route(
      createRequest("playlist.sound.play", { playlistId: "playlist-1", soundId: "missing-sound" })
    );
    expect(missingSound.ok).toBe(false);
    expect(missingSound.error.code).toBe("PLAYLIST_SOUND_NOT_FOUND");

    const missingSoundPlaylist = await router.route(
      createRequest("playlist.sound.play", { playlistId: "missing-pl", soundId: "s-1" })
    );
    expect(missingSoundPlaylist.ok).toBe(false);
    expect(missingSoundPlaylist.error.code).toBe("PLAYLIST_NOT_FOUND");
  });

  it("chat.list returns messages NEWEST-FIRST with total/hasMore and paginates the reversed order", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("chat.list"));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.total).toBe(3);

    expect(listResponse.result.messages.map((m) => m.id)).toEqual(["msg-3", "msg-2", "msg-1"]);

    expect(listResponse.result.messages[0].flags).toBeUndefined();
    expect(listResponse.result.messages[0]).toMatchObject({
      id: "msg-3",
      author: "user-1",
      alias: "GM",
      whisperCount: 0
    });

    const paged = await router.route(createRequest("chat.list", { limit: 1, offset: 1 }));
    expect(paged.result.messages.map((m) => m.id)).toEqual(["msg-2"]);
    expect(paged.result.total).toBe(3);
    expect(paged.result.hasMore).toBe(true);
  });

  it("chat.get returns a full message; a missing id yields CHAT_MESSAGE_NOT_FOUND with a repair hint", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const getResponse = await router.route(createRequest("chat.get", { messageId: "msg-2" }));
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.message).toMatchObject({ id: "msg-2", content: "second", author: "user-1" });

    const missing = await router.route(createRequest("chat.get", { messageId: "nope" }));
    expect(missing.ok).toBe(false);
    expect(missing.error.code).toBe("CHAT_MESSAGE_NOT_FOUND");
    expect(missing.error.message).toContain("chat.list");
  });

  it("chat.create (plain) posts a message, defaults author to game.user.id and speaker via getSpeaker", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(createRequest("chat.create", { data: { content: "hello world" } }));
    expect(response.ok).toBe(true);
    expect(globalThis.ChatMessage.create).toHaveBeenCalledTimes(1);
    const created = globalThis.ChatMessage.create.mock.calls[0][0];
    expect(created.author).toBe("user-1");
    expect(created.speaker).toEqual({ alias: "GM" });
    expect(globalThis.ChatMessage.getSpeaker).toHaveBeenCalled();

    expect(globalThis.ChatLog.processMessage).not.toHaveBeenCalled();
  });

  it("chat.create canonicalizes a literal `sound` FilePath and passes an absolute https:// value through", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const created = await router.route(
      createRequest("chat.create", {
        data: { content: "ding", sound: "worlds/world-1/fvtt-world-cli/It's a (test) #1.ogg" }
      })
    );
    expect(created.ok).toBe(true);
    expect(globalThis.ChatMessage.create.mock.calls[0][0].sound).toBe(
      "worlds/world-1/fvtt-world-cli/It%27s%20a%20(test)%20%231.ogg"
    );

    const remote = await router.route(
      createRequest("chat.create", { data: { content: "ding", sound: "https://cdn.example.com/a b.ogg" } })
    );
    expect(remote.ok).toBe(true);
    expect(globalThis.ChatMessage.create.mock.calls[1][0].sound).toBe("https://cdn.example.com/a b.ogg");
  });

  it("chat.create (whisper) sets the whisper array and keeps an operator-supplied speaker", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("chat.create", {
        data: { content: "psst", whisper: ["u1", "u2"], speaker: { alias: "Narrator" } }
      })
    );
    expect(response.ok).toBe(true);
    const created = globalThis.ChatMessage.create.mock.calls[0][0];
    expect(created.whisper).toEqual(["u1", "u2"]);

    expect(created.speaker).toEqual({ alias: "Narrator" });
    expect(globalThis.ChatMessage.getSpeaker).not.toHaveBeenCalled();
  });

  it("chat.create (roll) evaluates the formula via the Roll API and attaches rolls[]; NEVER calls toMessage", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("chat.create", { data: { content: "attack" }, roll: { formula: "2d6+3" } })
    );
    expect(response.ok).toBe(true);
    expect(globalThis.Roll.constructSpy).toHaveBeenCalledWith("2d6+3");
    expect(globalThis.Roll.evaluateSpy).toHaveBeenCalled();
    expect(globalThis.Roll.toMessageSpy).not.toHaveBeenCalled();
    expect(globalThis.ChatLog.processMessage).not.toHaveBeenCalled();
    const created = globalThis.ChatMessage.create.mock.calls[0][0];
    expect(created.rolls).toEqual([{ formula: "2d6+3", total: 7 }]);
  });

  it("chat.create with a bad roll formula returns INVALID_PARAMS (invalid_roll_formula) and posts nothing", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    globalThis.Roll.shouldThrow = true;

    const response = await router.route(
      createRequest("chat.create", { data: {}, roll: { formula: "not-a-formula" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details.reason).toBe("invalid_roll_formula");
    expect(globalThis.ChatMessage.create).not.toHaveBeenCalled();
  });

  it("chat.create with neither content nor roll returns INVALID_PARAMS (empty_message) and posts nothing", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(createRequest("chat.create", { data: {} }));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details.reason).toBe("empty_message");
    expect(globalThis.ChatMessage.create).not.toHaveBeenCalled();
  });

  it("chat.create dryRun evaluates the roll but persists nothing and returns the message", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("chat.create", { data: { content: "preview" }, roll: { formula: "1d20" }, dryRun: true })
    );
    expect(response.ok).toBe(true);
    expect(response.result.dryRun).toBe(true);

    expect(response.result.message).toBeDefined();
    expect(response.result).not.toHaveProperty("preview");

    expect(globalThis.Roll.evaluateSpy).toHaveBeenCalled();

    expect(globalThis.ChatMessage.create).not.toHaveBeenCalled();
  });

  it("chat.delete removes the message; dryRun delete reports deleted:false and does not remove it", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const dryResponse = await router.route(
      createRequest("chat.delete", { messageId: "msg-1", dryRun: true })
    );
    expect(dryResponse.ok).toBe(true);
    expect(dryResponse.result).toMatchObject({ id: "msg-1", deleted: false });
    expect(globalThis.game.messages.get("msg-1")).not.toBeNull();

    const deleteResponse = await router.route(createRequest("chat.delete", { messageId: "msg-1" }));
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: "msg-1", deleted: true });
  });
});

describe("macro execution", () => {
  let router;

  beforeEach(() => {
    installFakeFoundry();
    router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
  });

  function macroDoc() {
    return globalThis.game.macros.get("macro-1");
  }

  function chatListenerCount() {
    return (globalThis.Hooks._listeners.get("createChatMessage") ?? []).length;
  }

  it("runs the macro, reports its return value and the messages it created", async () => {
    macroDoc().execute = vi.fn(async () => {
      globalThis.Hooks.callAll("createChatMessage", { id: "msg-from-macro" }, {}, "user-1");
      return { healed: 4 };
    });

    const response = await router.route(createRequest("macro.execute", { macroId: "macro-1" }));

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({
      macroId: "macro-1",
      type: "script",
      returned: { healed: 4 },
      chatMessageIds: ["msg-from-macro"],
      chatCapture: "captured"
    });
    expect(chatListenerCount()).toBe(0);
  });

  it("ignores a message another user created while the macro ran", async () => {
    macroDoc().execute = vi.fn(async () => {
      globalThis.Hooks.callAll("createChatMessage", { id: "msg-elsewhere" }, {}, "player-9");
      return null;
    });

    const response = await router.route(createRequest("macro.execute", { macroId: "macro-1" }));

    expect(response.result.chatMessageIds).toEqual([]);
  });

  it("hands Foundry the resolved actor, token and speaker plus the caller's arguments", async () => {
    const execute = vi.fn(async () => undefined);
    macroDoc().execute = execute;

    const response = await router.route(
      createRequest("macro.execute", {
        macroId: "macro-1",
        scope: { sceneId: "scene-1", tokenId: "token-a", args: { rounds: 2 } }
      })
    );

    expect(response.ok).toBe(true);
    const scope = /** @type {any} */ (execute.mock.calls[0])[0];
    expect(scope.rounds).toBe(2);
    expect(scope.speaker).toEqual({ alias: "GM" });
    expect(scope.token.id).toBe("token-a");
    expect(scope.actor.id).toBe(globalThis.game.scenes.get("scene-1").tokens.get("token-a").actor.id);
  });

  it("requires a scene for a token and reports an unknown token", async () => {
    const withoutScene = await router.route(
      createRequest("macro.execute", { macroId: "macro-1", scope: { tokenId: "token-a" } })
    );
    expect(withoutScene.ok).toBe(false);
    expect(withoutScene.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(withoutScene.error.message).toContain("scope.sceneId");

    const unknownToken = await router.route(
      createRequest("macro.execute", { macroId: "macro-1", scope: { sceneId: "scene-1", tokenId: "ghost" } })
    );
    expect(unknownToken.ok).toBe(false);
    expect(unknownToken.error.code).toBe(ERROR_CODES.TOKEN_NOT_FOUND);
    expect(macroDoc().execute).not.toHaveBeenCalled();
  });

  it("refuses an argument name Foundry binds itself", async () => {
    const response = await router.route(
      createRequest("macro.execute", { macroId: "macro-1", scope: { args: { actor: "actor-1" } } })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.details).toMatchObject({ argument: "actor" });
    expect(macroDoc().execute).not.toHaveBeenCalled();
  });

  it("previews without running the macro", async () => {
    const response = await router.route(createRequest("macro.execute", { macroId: "macro-1", dryRun: true }));

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({
      macroId: "macro-1",
      type: "script",
      canExecute: true,
      commandLength: "console.log('heal');".length,
      dryRun: true
    });
    expect(macroDoc().execute).not.toHaveBeenCalled();
  });

  it("reports a macro this user may not execute and previews it as unexecutable", async () => {
    macroDoc().canExecute = false;

    const response = await router.route(createRequest("macro.execute", { macroId: "macro-1" }));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(response.error.message).toContain("ownership");
    expect(macroDoc().execute).not.toHaveBeenCalled();

    const preview = await router.route(createRequest("macro.execute", { macroId: "macro-1", dryRun: true }));
    expect(preview.result).toMatchObject({ canExecute: false });
  });

  it("stops waiting for a macro that never finishes and calls the outcome indeterminate", async () => {
    macroDoc().execute = vi.fn(() => new Promise(() => {}));

    const response = await router.route(createRequest("macro.execute", { macroId: "macro-1", timeoutMs: 5 }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.MACRO_TIMEOUT);
    expect(response.error.details).toMatchObject({
      macroId: "macro-1",
      timeoutMs: 5,
      indeterminate: true
    });
    expect(response.error.message).toContain("keeps running");
    expect(chatListenerCount()).toBe(0);
  });

  it("maps a scope Foundry itself refuses to a validation failure", async () => {
    macroDoc().execute = vi.fn(() => {
      throw new Error("Invalid scope parameter passed to Macro#execute which must be an object");
    });

    const response = await router.route(createRequest("macro.execute", { macroId: "macro-1" }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.details).toMatchObject({ reason: "foundry_validation" });
    expect(response.error.details.message).toContain("Invalid scope parameter");
    expect(chatListenerCount()).toBe(0);
  });

  it("omits a return value it cannot serialize within the bridge's bounds", async () => {
    macroDoc().execute = vi.fn(async () => ({ run: () => true }));

    const response = await router.route(createRequest("macro.execute", { macroId: "macro-1" }));

    expect(response.ok).toBe(true);
    expect(response.result.returned).toBeNull();
    expect(response.result.returnedOmitted.code).toBe(ERROR_CODES.SETTING_VALUE_NOT_SERIALIZABLE);
  });

  it("reports an unknown macro", async () => {
    const response = await router.route(createRequest("macro.execute", { macroId: "ghost" }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.MACRO_NOT_FOUND);
  });
});
