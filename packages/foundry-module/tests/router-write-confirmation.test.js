import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";
import { ERROR_CODES } from "../scripts/generated/protocol.js";

import { createRequest, installFakeFoundry } from "./helpers/fake-foundry.js";

/** @type {any} */
let router;

beforeEach(() => {
  installFakeFoundry();
  router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
});

/**
 * @param {string} command
 * @param {Record<string, any>} params
 */
function send(command, params) {
  return router.route(createRequest(command, params));
}

/** @param {any} document */
function vetoUpdate(document) {
  document.update = vi.fn(async () => undefined);
}

/** @param {any} document */
function vetoDelete(document) {
  document.delete = vi.fn(async () => undefined);
}

/**
 * @param {any} response
 * @param {RegExp} hookPattern
 */
function expectUpdateVetoError(response, hookPattern) {
  expect(response.ok).toBe(false);
  expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
  expect(response.error.message).toMatch(/was NOT updated/);
  expect(response.error.message).toMatch(hookPattern);
}

/**
 * @param {any} response
 * @param {RegExp} hookPattern
 */
function expectDeleteVetoError(response, hookPattern) {
  expect(response.ok).toBe(false);
  expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
  expect(response.error.message).toMatch(/NOT deleted/);
  expect(response.error.message).toMatch(hookPattern);
}

describe("a vetoed single world-document update is reported instead of a false success", () => {
  it("actor.update", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    vetoUpdate(actor);

    const response = await send("actor.update", { actorId: "actor-1", patch: { name: "Renamed" } });

    expectUpdateVetoError(response, /preUpdateActor/);
    expect(actor.name).toBe("Valeros");
  });

  it("actor.update still reports a no-op patch as success", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    vetoUpdate(actor);

    const response = await send("actor.update", { actorId: "actor-1", patch: { name: "Valeros" } });

    expect(response.ok).toBe(true);
    expect(response.result.actor.name).toBe("Valeros");
  });

  it("item.update", async () => {
    vetoUpdate(globalThis.game.items.get("item-1"));

    const response = await send("item.update", { itemId: "item-1", patch: { name: "Renamed" } });

    expectUpdateVetoError(response, /preUpdateItem/);
  });

  it("macro.update", async () => {
    vetoUpdate(globalThis.game.macros.get("macro-1"));

    const response = await send("macro.update", { macroId: "macro-1", patch: { name: "Renamed" } });

    expectUpdateVetoError(response, /preUpdateMacro/);
  });

  it("scene.update", async () => {
    vetoUpdate(globalThis.game.scenes.get("scene-2"));

    const response = await send("scene.update", { sceneId: "scene-2", patch: { name: "Renamed" } });

    expectUpdateVetoError(response, /preUpdateScene/);
  });

  it("playlist.update", async () => {
    vetoUpdate(globalThis.game.playlists.get("playlist-1"));

    const response = await send("playlist.update", { playlistId: "playlist-1", patch: { name: "Renamed" } });

    expectUpdateVetoError(response, /preUpdatePlaylist/);
  });

  it("journal.update on the entry's own fields", async () => {
    vetoUpdate(globalThis.game.journal.get("journal-1"));

    const response = await send("journal.update", { journalId: "journal-1", patch: { name: "Renamed" } });

    expectUpdateVetoError(response, /preUpdateJournalEntry/);
  });

  it("user.update", async () => {
    vetoUpdate(globalThis.game.users.get("player-1"));

    const response = await send("user.update", { userId: "player-1", patch: { color: "#ff0000" } });

    expectUpdateVetoError(response, /preUpdateUser/);
  });

  it("journal.ownership.set", async () => {
    vetoUpdate(globalThis.game.journal.get("journal-1"));

    const response = await send("journal.ownership.set", { journalId: "journal-1", default: 2 });

    expectUpdateVetoError(response, /preUpdateJournalEntry/);
  });
});

describe("a hook that rewrites the payload it is handed cannot fake the confirmation", () => {
  it("a veto that resets the sent patch to the stored values is still reported", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    actor.update = vi.fn(async (payload) => {
      payload.name = "Valeros";
      return undefined;
    });

    const response = await send("actor.update", { actorId: "actor-1", patch: { name: "Renamed" } });

    expectUpdateVetoError(response, /preUpdateActor/);
    expect(actor.name).toBe("Valeros");
  });
});

describe("a write that landed only in part is reported as partial, not as success", () => {
  it("actor.update", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    actor.update = vi.fn(async (payload) => {
      const { name: _stripped, ...rest } = payload;
      actor.applyStoredWrite(rest);
      return actor;
    });

    const response = await send("actor.update", {
      actorId: "actor-1",
      patch: { name: "Renamed", img: "icons/updated.webp" }
    });

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(response.error.message).toMatch(/updated only in PART/);
    expect(response.error.details).toMatchObject({
      fields: ["name"],
      appliedFields: ["img"],
      partial: true
    });
    expect(actor.img).toBe("icons/updated.webp");
    expect(actor.name).toBe("Valeros");
  });

  it("scene.token.update", async () => {
    const scene = globalThis.game.scenes.get("scene-1");
    const token = scene.tokens.get("token-a");
    scene.updateEmbeddedDocuments = vi.fn(async (type, entries) => {
      const { _id: _ignored, name: _stripped, ...rest } = entries[0];
      token.applyStoredWrite(rest);
      return [token];
    });

    const response = await send("scene.token.update", {
      sceneId: "scene-1",
      tokenId: "token-a",
      patch: { name: "Renamed", alpha: 0.5 }
    });

    expect(response.ok).toBe(false);
    expect(response.error.message).toMatch(/updated only in PART/);
    expect(response.error.details).toMatchObject({ fields: ["name"], appliedFields: ["alpha"] });
  });
});

describe("a vetoed single world-document delete is reported instead of deleted: true", () => {
  it("actor.delete", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    vetoDelete(actor);

    const response = await send("actor.delete", { actorId: "actor-1", force: true });

    expectDeleteVetoError(response, /preDeleteActor/);
    expect(globalThis.game.actors.get("actor-1")).toBe(actor);
  });

  it("item.delete", async () => {
    vetoDelete(globalThis.game.items.get("item-1"));

    const response = await send("item.delete", { itemId: "item-1" });

    expectDeleteVetoError(response, /preDeleteItem/);
  });

  it("macro.delete", async () => {
    vetoDelete(globalThis.game.macros.get("macro-1"));

    const response = await send("macro.delete", { macroId: "macro-1" });

    expectDeleteVetoError(response, /preDeleteMacro/);
  });

  it("scene.delete", async () => {
    vetoDelete(globalThis.game.scenes.get("scene-2"));

    const response = await send("scene.delete", { sceneId: "scene-2" });

    expectDeleteVetoError(response, /preDeleteScene/);
  });

  it("playlist.delete", async () => {
    vetoDelete(globalThis.game.playlists.get("playlist-1"));

    const response = await send("playlist.delete", { playlistId: "playlist-1" });

    expectDeleteVetoError(response, /preDeletePlaylist/);
  });

  it("journal.delete", async () => {
    vetoDelete(globalThis.game.journal.get("journal-1"));

    const response = await send("journal.delete", { journalId: "journal-1" });

    expectDeleteVetoError(response, /preDeleteJournalEntry/);
  });

  it("chat.delete", async () => {
    vetoDelete(globalThis.game.messages.get("msg-1"));

    const response = await send("chat.delete", { messageId: "msg-1" });

    expectDeleteVetoError(response, /preDeleteChatMessage/);
  });
});

describe("a vetoed embedded-document write is reported instead of a false success", () => {
  it("actor.item.update", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    actor.updateEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("actor.item.update", {
      actorId: "actor-1",
      itemId: "actor-item-1",
      patch: { name: "Renamed" }
    });

    expectUpdateVetoError(response, /preUpdateItem/);
  });

  it("actor.item.delete", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    actor.deleteEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("actor.item.delete", { actorId: "actor-1", itemId: "actor-item-1" });

    expectDeleteVetoError(response, /preDeleteItem/);
    expect(actor.items.get("actor-item-1")).toBeTruthy();
  });

  it("actor.item.effect.update", async () => {
    const created = await send("actor.item.effect.create", {
      actorId: "actor-1",
      itemId: "actor-item-1",
      data: { name: "Glow" }
    });
    expect(created.ok).toBe(true);
    const effectId = created.result.effect.id ?? created.result.effect._id;

    const item = globalThis.game.actors.get("actor-1").items.get("actor-item-1");
    item.updateEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("actor.item.effect.update", {
      actorId: "actor-1",
      itemId: "actor-item-1",
      effectId,
      patch: { name: "Dimmed" }
    });

    expectUpdateVetoError(response, /preUpdateActiveEffect/);
  });

  it("actor.item.effect.delete", async () => {
    const created = await send("actor.item.effect.create", {
      actorId: "actor-1",
      itemId: "actor-item-1",
      data: { name: "Glow" }
    });
    const effectId = created.result.effect.id ?? created.result.effect._id;

    const item = globalThis.game.actors.get("actor-1").items.get("actor-item-1");
    item.deleteEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("actor.item.effect.delete", {
      actorId: "actor-1",
      itemId: "actor-item-1",
      effectId
    });

    expectDeleteVetoError(response, /preDeleteActiveEffect/);
  });

  it("playlist.sound.update", async () => {
    const playlist = globalThis.game.playlists.get("playlist-1");
    playlist.updateEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("playlist.sound.update", {
      playlistId: "playlist-1",
      soundId: "sound-1",
      patch: { volume: 0.25 }
    });

    expectUpdateVetoError(response, /preUpdatePlaylistSound/);
  });

  it("playlist.sound.delete", async () => {
    const playlist = globalThis.game.playlists.get("playlist-1");
    playlist.deleteEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("playlist.sound.delete", { playlistId: "playlist-1", soundId: "sound-1" });

    expectDeleteVetoError(response, /preDeletePlaylistSound/);
  });

  it("scene.token.update", async () => {
    const scene = globalThis.game.scenes.get("scene-1");
    scene.updateEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("scene.token.update", {
      sceneId: "scene-1",
      tokenId: "token-a",
      patch: { name: "Renamed" }
    });

    expectUpdateVetoError(response, /preUpdateToken/);
  });

  it("scene.token.delete", async () => {
    const scene = globalThis.game.scenes.get("scene-1");
    scene.deleteEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("scene.token.delete", { sceneId: "scene-1", tokenId: "token-a" });

    expectDeleteVetoError(response, /preDeleteToken/);
  });
});

describe("an embedded write that changes nothing keeps reporting success", () => {
  it("actor.item.update", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    const storedName = actor.items.get("actor-item-1").name;
    actor.updateEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("actor.item.update", {
      actorId: "actor-1",
      itemId: "actor-item-1",
      patch: { name: storedName }
    });

    expect(response.ok).toBe(true);
  });

  it("playlist.sound.update", async () => {
    const playlist = globalThis.game.playlists.get("playlist-1");
    const storedVolume = playlist.sounds.get("sound-1").volume;
    playlist.updateEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("playlist.sound.update", {
      playlistId: "playlist-1",
      soundId: "sound-1",
      patch: { volume: storedVolume }
    });

    expect(response.ok).toBe(true);
  });

  it("scene.token.update", async () => {
    const scene = globalThis.game.scenes.get("scene-1");
    const storedName = scene.tokens.get("token-a").name;
    scene.updateEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("scene.token.update", {
      sceneId: "scene-1",
      tokenId: "token-a",
      patch: { name: storedName }
    });

    expect(response.ok).toBe(true);
  });

  it("journal.update page patch", async () => {
    const journal = globalThis.game.journal.get("journal-1");
    const storedName = journal.pages.get("page-1").name;
    journal.updateEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("journal.update", {
      journalId: "journal-1",
      patch: { pages: [{ id: "page-1", name: storedName }] }
    });

    expect(response.ok).toBe(true);
  });

  it("actor.item.effect.update", async () => {
    const created = await send("actor.item.effect.create", {
      actorId: "actor-1",
      itemId: "actor-item-1",
      data: { name: "Glow" }
    });
    const effectId = created.result.effect.id ?? created.result.effect._id;

    const item = globalThis.game.actors.get("actor-1").items.get("actor-item-1");
    item.updateEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("actor.item.effect.update", {
      actorId: "actor-1",
      itemId: "actor-item-1",
      effectId,
      patch: { name: "Glow" }
    });

    expect(response.ok).toBe(true);
  });
});

describe("a patch shape Foundry stores nothing for is refused before the write", () => {
  it("scene.wall.update with a dotted path into the wall's coordinate array", async () => {
    const scene = globalThis.game.scenes.get("scene-1");
    const stored = [...scene.walls.get("wall-plain").c];

    const response = await send("scene.wall.update", {
      sceneId: "scene-1",
      wallId: "wall-plain",
      patch: { "c.0": 999 }
    });

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/SILENTLY DISCARDS/);
    expect(response.error.message).toMatch(/Nothing was written/);
    expect(scene.walls.get("wall-plain").c).toEqual(stored);
    expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("scene.wall.update with the whole coordinate array still succeeds", async () => {
    const response = await send("scene.wall.update", {
      sceneId: "scene-1",
      wallId: "wall-plain",
      patch: { c: [1, 2, 3, 4] }
    });

    expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
    expect(globalThis.game.scenes.get("scene-1").walls.get("wall-plain").c).toEqual([1, 2, 3, 4]);
  });
});

describe("an operator-key patch confirms through the merged preview, not the raw diff", () => {
  it("a forced-replacement flag write succeeds", async () => {
    const response = await send("scene.token.update", {
      sceneId: "scene-1",
      tokenId: "token-a",
      patch: { "flags.==scope": { only: 1 } }
    });

    expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
  });

  it("a stripped plain field beside an applied operator key is reported as partial", async () => {
    const scene = globalThis.game.scenes.get("scene-1");
    const token = scene.tokens.get("token-a");
    scene.updateEmbeddedDocuments = vi.fn(async (type, entries) => {
      const { _id: _ignored, name: _stripped, ...rest } = entries[0];
      token.applyStoredWrite(rest);
      return [token];
    });

    const response = await send("scene.token.update", {
      sceneId: "scene-1",
      tokenId: "token-a",
      patch: { name: "Renamed", "flags.==scope": { only: 1 } }
    });

    expect(response.ok).toBe(false);
    expect(response.error.message).toMatch(/updated only in PART/);
    expect(response.error.details).toMatchObject({
      fields: ["name"],
      appliedFields: ["flags"],
      partial: true
    });
    expect(token.name).not.toBe("Renamed");
  });
});

describe("a vetoed journal page write inside journal.update is reported per page", () => {
  it("page update", async () => {
    const journal = globalThis.game.journal.get("journal-1");
    journal.updateEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("journal.update", {
      journalId: "journal-1",
      patch: { pages: [{ id: "page-1", name: "Renamed Page" }] }
    });

    expectUpdateVetoError(response, /preUpdateJournalEntryPage/);
    expect(response.error.details).toMatchObject({
      journalId: "journal-1",
      pageId: "page-1",
      updatedPageIds: []
    });
  });

  it("page update names the pages that did land when another page's write was refused", async () => {
    const created = await send("journal.update", {
      journalId: "journal-1",
      patch: { pages: [{ name: "Second", type: "text" }] }
    });
    expect(created.ok).toBe(true);
    const secondId = created.result.journal.pages.find((page) => page.name === "Second").id;

    const journal = globalThis.game.journal.get("journal-1");
    journal.updateEmbeddedDocuments = vi.fn(async () => {
      const second = journal.pages.get(secondId);
      second.name = "Second Renamed";
      return [second];
    });

    const response = await send("journal.update", {
      journalId: "journal-1",
      patch: {
        pages: [
          { id: "page-1", name: "Renamed Page" },
          { id: secondId, name: "Second Renamed" }
        ]
      }
    });

    expectUpdateVetoError(response, /preUpdateJournalEntryPage/);
    expect(response.error.details).toMatchObject({
      journalId: "journal-1",
      pageId: "page-1",
      updatedPageIds: [secondId]
    });
  });

  it("page create", async () => {
    const journal = globalThis.game.journal.get("journal-1");
    journal.createEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("journal.update", {
      journalId: "journal-1",
      patch: { pages: [{ name: "New Page", type: "text" }] }
    });

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(response.error.message).toMatch(/NOT all created/);
    expect(response.error.message).toMatch(/preCreateJournalEntryPage/);
    expect(response.error.details).toMatchObject({
      journalId: "journal-1",
      requested: 1,
      createdPageIds: []
    });
  });

  it("page update whose page vanished while the write resolved", async () => {
    const journal = globalThis.game.journal.get("journal-1");
    journal.updateEmbeddedDocuments = vi.fn(async () => {
      journal.pages.delete("page-1");
      return [];
    });

    const response = await send("journal.update", {
      journalId: "journal-1",
      patch: { pages: [{ id: "page-1", name: "Renamed Page" }] }
    });

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(response.error.message).toMatch(/no longer exists/);
    expect(response.error.details).toMatchObject({ journalId: "journal-1", pageId: "page-1" });
  });

  it("page delete", async () => {
    const journal = globalThis.game.journal.get("journal-1");
    journal.deleteEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("journal.update", {
      journalId: "journal-1",
      patch: { deletePageIds: ["page-1"] }
    });

    expectDeleteVetoError(response, /preDeleteJournalEntryPage/);
    expect(response.error.details).toMatchObject({
      journalId: "journal-1",
      undeletedPageIds: ["page-1"],
      deletedPageIds: []
    });
  });
});
