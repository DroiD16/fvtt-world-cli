import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";

import { ERROR_CODES } from "../scripts/generated/protocol.js";

import {
  createActorDocument,
  createCollection,
  createDocument,
  createPermissiveSettings,
  createRequest,
  createTableDocument,
  installFakeFoundry,
  makeFolderDocumentClass
} from "./helpers/fake-foundry.js";

describe("command router", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  it("lists folders by type and creates folders", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("folder.list", { type: "Actor" }));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.folders).toEqual([
      {
        id: "folder-actors-test",
        _id: "folder-actors-test",
        name: "Test",
        type: "Actor",
        folder: null,
        color: null
      }
    ]);

    const createResponse = await router.route(
      createRequest("folder.create", { data: { name: "New", type: "Actor" } })
    );
    expect(createResponse.ok).toBe(true);
    expect(globalThis.Folder.create).toHaveBeenCalledWith({ name: "New", type: "Actor" }, { render: true });
    expect(createResponse.result.folder.id).toBe("folder-created");
  });
});

describe("user + ownership axis", () => {
  const OWNERSHIP_SCENE_COMPENDIUM_SOURCE = "Compendium.dnd5e.scenes.Scene.ownscene00000001";
  let router;
  let actor;
  let worldItem;
  let scene;
  let macro;
  let playlist;
  let table;
  let journal;
  let journalPage;

  function makeRouter() {
    return createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
  }

  beforeEach(() => {
    actor = createActorDocument("actor-own", {
      name: "Valeros",
      type: "character",
      items: [{ id: "embed-item-1", name: "Dagger", type: "weapon", system: {} }]
    });
    actor.ownership = { default: 0, "player-1": 2 };

    worldItem = createDocument("item-own", {
      name: "Sword",
      type: "weapon",
      system: {},
      ownership: { default: 0 }
    });

    scene = createDocument("scene-own", {
      name: "Dungeon",
      ownership: { default: 1 },
      flags: { mymod: { note: "keep" } },
      _stats: { compendiumSource: OWNERSHIP_SCENE_COMPENDIUM_SOURCE, coreVersion: "13.351" }
    });
    macro = createDocument("macro-own", {
      name: "Whisper",
      type: "script",
      command: "x",
      ownership: { default: 0 }
    });
    playlist = createDocument("playlist-own", { name: "Ambience", ownership: { default: 0 } });
    table = createTableDocument("table-own", {
      name: "Loot",
      ownership: { default: 0, "player-1": 1 },
      results: [{ id: "result-own-1", name: "Coin", range: [1, 1] }]
    });

    journalPage = createDocument("page-1", { name: "GM Secrets", type: "text", ownership: { default: 0 } });
    journal = createDocument("journal-own", { name: "Handout", ownership: { default: 2 } });
    journal.pages = createCollection([journalPage]);

    globalThis.game = {
      ready: true,
      world: { id: "world-1", title: "Test" },
      user: { id: "gm", name: "GM", isGM: true },
      users: createCollection([
        { id: "gm", name: "GM", role: 4, isGM: true, active: true, character: null, color: "#111111" },
        {
          id: "player-1",
          name: "Hrelga",
          role: 1,
          isGM: false,
          active: true,
          character: { id: "actor-9" },
          color: "#ff0000"
        },
        { id: "player-2", name: "Kelric", role: 1, isGM: false, active: false, character: null }
      ]),
      settings: createPermissiveSettings(),
      actors: createCollection([actor]),
      items: createCollection([worldItem]),
      scenes: createCollection([scene]),
      macros: createCollection([macro]),
      playlists: createCollection([playlist]),
      tables: createCollection([table]),
      journal: createCollection([journal])
    };
    router = makeRouter();
  });

  afterEach(() => {
    delete globalThis.game;
    vi.restoreAllMocks();
  });

  it("user.list projects {id,name,role,isGM,active,character}", async () => {
    const response = await router.route(createRequest("user.list"));
    expect(response.ok).toBe(true);
    expect(response.result.total).toBe(3);
    const hrelga = response.result.users.find((u) => u.id === "player-1");
    expect(hrelga).toMatchObject({
      id: "player-1",
      _id: "player-1",
      name: "Hrelga",
      role: 1,
      isGM: false,
      active: true,
      character: "actor-9"
    });
  });

  it("user.list filters by name substring", async () => {
    const response = await router.route(createRequest("user.list", { name: "hrel" }));
    expect(response.result.users.map((u) => u.id)).toEqual(["player-1"]);
  });

  it("user.get returns one user; unknown id → USER_NOT_FOUND", async () => {
    const ok = await router.route(createRequest("user.get", { userId: "player-2" }));
    expect(ok.result.user).toMatchObject({ id: "player-2", name: "Kelric", active: false, character: null });

    const missing = await router.route(createRequest("user.get", { userId: "nope" }));
    expect(missing.ok).toBe(false);
    expect(missing.error.code).toBe(ERROR_CODES.USER_NOT_FOUND);
    expect(missing.error.message).toContain("user.list");
  });

  it("actor.get / item.get / scene.get / macro.get / playlist.get surface ownership", async () => {
    const actorResult = (await router.route(createRequest("actor.get", { actorId: "actor-own" }))).result;
    expect(actorResult.actor.ownership).toEqual({ default: 0, "player-1": 2 });

    expect(actorResult.actor.items[0]).not.toHaveProperty("ownership");
    expect(
      (await router.route(createRequest("item.get", { itemId: "item-own" }))).result.item.ownership
    ).toEqual({ default: 0 });
    expect(
      (await router.route(createRequest("scene.get", { sceneId: "scene-own" }))).result.scene.ownership
    ).toEqual({ default: 1 });
    expect(
      (await router.route(createRequest("macro.get", { macroId: "macro-own" }))).result.macro.ownership
    ).toEqual({ default: 0 });
    expect(
      (await router.route(createRequest("playlist.get", { playlistId: "playlist-own" }))).result.playlist
        .ownership
    ).toEqual({ default: 0 });

    const tableResult = (await router.route(createRequest("table.get", { tableId: "table-own" }))).result;
    expect(tableResult.table.ownership).toEqual({ default: 0, "player-1": 1 });
    expect(tableResult.table.results[0]).not.toHaveProperty("ownership");

    const tableBatch = (await router.route(createRequest("table.get-many", { ids: ["table-own"] }))).result;
    expect(tableBatch.tables[0].ownership).toEqual({ default: 0, "player-1": 1 });
  });

  it("table.ownership.set MERGES onto the current map, persists, and dry-runs without persisting", async () => {
    const response = await router.route(
      createRequest("table.ownership.set", { tableId: "table-own", default: 2, users: { "player-2": 3 } })
    );
    expect(response.ok).toBe(true);
    const expected = { default: 2, "player-1": 1, "player-2": 3 };
    expect(response.result.table.ownership).toEqual(expected);
    expect(table.update).toHaveBeenCalledWith({ ownership: expected }, { diff: true, render: true });

    table.update.mockClear();
    const dry = await router.route(
      createRequest("table.ownership.set", { tableId: "table-own", default: 3, dryRun: true })
    );
    expect(dry.result.dryRun).toBe(true);
    expect(dry.result.table.ownership).toEqual({ ...expected, default: 3 });
    expect(dry.result).not.toHaveProperty("preview");
    expect(table.update).not.toHaveBeenCalled();
  });

  it("journal.get surfaces entry AND per-page ownership", async () => {
    const response = await router.route(createRequest("journal.get", { journalId: "journal-own" }));
    expect(response.result.journal.ownership).toEqual({ default: 2 });
    expect(response.result.journal.pages[0].ownership).toEqual({ default: 0 });
  });

  it("actor.item.get does NOT surface ownership (the Item HAS the field; core ignores it while parented)", async () => {
    const response = await router.route(
      createRequest("actor.item.get", { actorId: "actor-own", itemId: "embed-item-1" })
    );
    expect(response.ok).toBe(true);
    expect(response.result.item).not.toHaveProperty("ownership");
  });

  it("actor.ownership.set MERGES default + users onto the current map and persists", async () => {
    const response = await router.route(
      createRequest("actor.ownership.set", { actorId: "actor-own", default: 2, users: { "player-2": 3 } })
    );
    expect(response.ok).toBe(true);
    const expected = { default: 2, "player-1": 2, "player-2": 3 };
    expect(response.result.actor.ownership).toEqual(expected);

    expect(actor.update).toHaveBeenCalledWith({ ownership: expected }, expect.anything());
  });

  it("shared ownership.set distinguishes a vetoed falsy update from a legitimate empty diff", async () => {
    worldItem.update = vi.fn(async () => undefined);

    const noOp = await router.route(createRequest("item.ownership.set", { itemId: "item-own", default: 0 }));
    expect(noOp.ok, JSON.stringify(noOp.error ?? {})).toBe(true);
    expect(noOp.result.item.ownership).toEqual({ default: 0 });

    const vetoed = await router.route(
      createRequest("item.ownership.set", { itemId: "item-own", default: 3 })
    );
    expect(vetoed.ok).toBe(false);
    expect(vetoed.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(vetoed.error.message).toContain("preUpdateItem");
    expect(vetoed.error.details).toMatchObject({ itemId: "item-own", fields: ["ownership"] });
    expect(worldItem.ownership).toEqual({ default: 0 });
  });

  it("shared ownership.set confirms the immutable request when a preUpdate hook removes ownership", async () => {
    worldItem.update = vi.fn(async (changed) => {
      changed._id = worldItem.id;
      delete changed.ownership;
      return undefined;
    });

    const response = await router.route(
      createRequest("item.ownership.set", { itemId: "item-own", default: 3 })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(response.error.message).toContain("preUpdateItem");
    expect(response.error.details).toMatchObject({ itemId: "item-own", fields: ["ownership"] });
    expect(worldItem.ownership).toEqual({ default: 0 });
  });

  it("scene.ownership.set returns the COMPLETE scene including flags (serializeScene flags gate is honored)", async () => {
    const response = await router.route(
      createRequest("scene.ownership.set", { sceneId: "scene-own", default: 2 })
    );
    expect(response.ok).toBe(true);
    expect(response.result.scene.ownership).toEqual({ default: 2 });

    expect(response.result.scene.flags).toEqual({ mymod: { note: "keep" } });

    expect(Object.hasOwn(response.result.scene, "compendiumSource")).toBe(true);
    expect(response.result.scene.compendiumSource).toBe(OWNERSHIP_SCENE_COMPENDIUM_SOURCE);

    expect(response.result.scene._stats).toBeUndefined();
  });

  it("ownership.set on a non-scene family reports compendiumSource present-and-null", async () => {
    const response = await router.route(
      createRequest("item.ownership.set", { itemId: "item-own", default: 2 })
    );
    expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
    expect(Object.hasOwn(response.result.item, "compendiumSource")).toBe(true);
    expect(response.result.item.compendiumSource).toBeNull();
  });

  it("scene.ownership.set dry-run preview also carries flags", async () => {
    const response = await router.route(
      createRequest("scene.ownership.set", { sceneId: "scene-own", default: 3, dryRun: true })
    );
    expect(response.ok).toBe(true);
    expect(response.result.dryRun).toBe(true);
    expect(response.result.scene.ownership).toEqual({ default: 3 });
    expect(response.result.scene.flags).toEqual({ mymod: { note: "keep" } });

    expect(Object.hasOwn(response.result.scene, "compendiumSource")).toBe(true);
    expect(response.result.scene.compendiumSource).toBe(OWNERSHIP_SCENE_COMPENDIUM_SOURCE);
  });

  it("ownership.set dry-run returns merged post-state in the SAME key (dryRun:true, no preview/current), does not persist", async () => {
    const response = await router.route(
      createRequest("item.ownership.set", { itemId: "item-own", default: 3, dryRun: true })
    );
    expect(response.ok).toBe(true);
    expect(response.result.dryRun).toBe(true);
    expect(response.result.item.ownership).toEqual({ default: 3 });

    expect(response.result).not.toHaveProperty("preview");
    expect(response.result).not.toHaveProperty("current");
    expect(worldItem.update).not.toHaveBeenCalled();
  });

  it("ownership.set rejects an unknown user id with the valid-id list", async () => {
    const response = await router.route(
      createRequest("actor.ownership.set", { actorId: "actor-own", users: { ghost: 3 } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toContain("ghost");
    expect(response.error.message).toContain("player-1");
    expect(response.error.details.invalidUserIds).toEqual(["ghost"]);
  });

  it("ownership.set with neither default nor users → INVALID_PARAMS", async () => {
    const response = await router.route(createRequest("scene.ownership.set", { sceneId: "scene-own" }));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toContain("at least one");
  });

  it("journal.ownership.set --page-id sets the page ownership (INHERIT -1 allowed) and returns the journal", async () => {
    const response = await router.route(
      createRequest("journal.ownership.set", {
        journalId: "journal-own",
        pageId: "page-1",
        default: -1,
        users: { "player-1": 3 }
      })
    );
    expect(response.ok).toBe(true);
    const expected = { default: -1, "player-1": 3 };
    expect(journalPage.update).toHaveBeenCalledWith({ ownership: expected }, expect.anything());
    const page = response.result.journal.pages.find((p) => p.id === "page-1");
    expect(page.ownership).toEqual(expected);

    expect(journal.update).not.toHaveBeenCalled();
  });

  it("journal.ownership.set entry-level rejects INHERIT (-1)", async () => {
    const response = await router.route(
      createRequest("journal.ownership.set", { journalId: "journal-own", default: -1 })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toContain("INHERIT");
    expect(journal.update).not.toHaveBeenCalled();
  });

  it("journal.ownership.set with an unknown pageId → INVALID_PARAMS naming the id", async () => {
    const response = await router.route(
      createRequest("journal.ownership.set", { journalId: "journal-own", pageId: "nope", default: 0 })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toContain("nope");
  });

  it("ownership.set is GM-gated (non-GM → PERMISSION_DENIED)", async () => {
    globalThis.game.user.isGM = false;
    const response = await router.route(
      createRequest("actor.ownership.set", { actorId: "actor-own", default: 2 })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
  });
});

describe("folder management", () => {
  let router;
  let folders;
  let actors;
  let scenes;
  let cardsCollection;

  function makeRouter() {
    return createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
  }

  /**
   * @param {string} id
   * @param {{ name: string, type: string, folder?: string | null }} attrs
   */
  function makeFolder(id, { name, type, folder = null }) {
    return createDocument(id, { name, type, folder, description: "", sorting: "a", sort: 0, flags: {} });
  }

  function serverGetSubfolders(folder, recursive, visited = new Set()) {
    if (visited.has(folder.id)) {
      return [];
    }
    let children = [...folders].filter((f) => (f.folder ?? null) === folder.id);
    visited.add(folder.id);
    if (recursive && children.length) {
      for (const child of [...children]) {
        children = children.concat(serverGetSubfolders(child, true, visited));
      }
    }
    return children;
  }

  function installCascadeDelete() {
    for (const folder of [...folders]) {
      folder.delete = vi.fn(async ({ deleteSubfolders = false, deleteContents = false } = {}) => {
        const parentId = folder.folder ?? null;
        const descendants = serverGetSubfolders(folder, true);
        const contentFolderIds = deleteSubfolders
          ? [folder.id, ...descendants.map((f) => f.id)]
          : [folder.id];
        const collection = globalThis.game.collections.get(type_of(folder));
        const affectedDocs = collection
          ? [...collection].filter((d) => contentFolderIds.includes(d.folder ?? null))
          : [];

        for (const f of descendants) {
          if (deleteSubfolders) {
            folders.delete(f.id);
          } else {
            f.folder = parentId;
          }
        }

        for (const d of affectedDocs) {
          if (deleteContents) {
            collection.delete(d.id);
          } else {
            d.folder = parentId;
          }
        }
        folders.delete(folder.id);
        return folder;
      });
    }
  }

  function type_of(folder) {
    return folder.type ?? folder.toObject?.().type ?? null;
  }

  beforeEach(() => {
    const fa = makeFolder("fa", { name: "A", type: "Actor" });
    const fb = makeFolder("fb", { name: "B", type: "Actor", folder: "fa" });
    const fc = makeFolder("fc", { name: "C", type: "Actor", folder: "fb" });
    const fd = makeFolder("fd", { name: "D", type: "Actor", folder: "fc" });
    const fx = makeFolder("fx", { name: "X", type: "Actor" });
    const fy = makeFolder("fy", { name: "Y", type: "Actor", folder: "fx" });
    const fz = makeFolder("fz", { name: "Z", type: "Actor", folder: "fy" });
    const fi = makeFolder("fi", { name: "I", type: "Item" });
    const fs = makeFolder("fs", { name: "S", type: "Scene" });
    const fcards = makeFolder("fcards", { name: "Deck box", type: "Cards" });
    const fcardsEmpty = makeFolder("fcards-empty", { name: "Empty deck box", type: "Cards" });

    folders = createCollection([fa, fb, fc, fd, fx, fy, fz, fi, fs, fcards, fcardsEmpty]);

    folders.documentClass = makeFolderDocumentClass(vi.fn(async (data) => createDocument("f-created", data)));

    const actTokenUsed = createDocument("act-token", { name: "Guard", type: "npc", folder: "fa" });
    const actInB = createDocument("act-in-b", { name: "Goblin", type: "npc", folder: "fb" });
    const actInC = createDocument("act-in-c", { name: "Orc", type: "npc", folder: "fc" });
    actors = createCollection([actTokenUsed, actInB, actInC]);

    const activeScene = createDocument("sc-active", {
      name: "Arena",
      type: "Scene",
      folder: "fs",
      active: true
    });
    activeScene.tokens = createCollection([
      createDocument("tok-1", { name: "GuardToken", actorId: "act-token" })
    ]);
    scenes = createCollection([activeScene]);

    const deck = createDocument("deck-1", { name: "Tarot", type: "deck", folder: "fcards" });
    cardsCollection = createCollection([deck]);

    globalThis.game = {
      ready: true,
      world: { id: "world-1", title: "Test" },
      user: { id: "gm", name: "GM", isGM: true },
      settings: createPermissiveSettings(),
      folders,
      actors,
      scenes,
      collections: new Map([
        ["Actor", actors],
        ["Scene", scenes],
        ["Cards", cardsCollection]
      ])
    };
    router = makeRouter();
  });

  afterEach(() => {
    delete globalThis.game;
    vi.restoreAllMocks();
  });

  it("folder.get returns the full projection with children counts", async () => {
    const response = await router.route(createRequest("folder.get", { folderId: "fb" }));
    expect(response.ok).toBe(true);
    expect(response.result.folder).toMatchObject({
      id: "fb",
      _id: "fb",
      name: "B",
      type: "Actor",
      folder: "fa",
      sorting: "a"
    });

    expect(response.result.folder.childFolderCount).toBe(1);
    expect(response.result.folder.documentCount).toBe(1);
  });

  it("folder.get returns FOLDER_NOT_FOUND for a missing id", async () => {
    const response = await router.route(createRequest("folder.get", { folderId: "nope" }));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.FOLDER_NOT_FOUND);
  });

  it("folder.create accepts the extended field set and returns the full projection", async () => {
    folders.documentClass = makeFolderDocumentClass(vi.fn(async (data) => createDocument("f-new", data)));
    globalThis.Folder = makeFolderDocumentClass(vi.fn(async (data) => createDocument("f-new", data)));
    const response = await router.route(
      createRequest("folder.create", {
        data: { name: "New", type: "Actor", description: "<p>x</p>", sorting: "m", sort: 5, color: "#123456" }
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.folder).toMatchObject({
      id: "f-new",
      name: "New",
      sorting: "m",
      sort: 5,
      color: "#123456"
    });
    delete globalThis.Folder;
  });

  it("folder.create rejects a create under a parent already at FOLDER_MAX_DEPTH", async () => {
    const response = await router.route(
      createRequest("folder.create", { data: { name: "TooDeep", type: "Actor", folder: "fd" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/depth|levels deep/i);
  });

  it("folder.create accepts a create under a parent at exactly FOLDER_MAX_DEPTH-1", async () => {
    folders.documentClass = makeFolderDocumentClass(vi.fn(async (data) => createDocument("f-deep", data)));
    const response = await router.route(
      createRequest("folder.create", { data: { name: "Deep", type: "Actor", folder: "fc" } })
    );
    expect(response.ok).toBe(true);
    expect(response.result.folder).toMatchObject({ id: "f-deep", folder: "fc" });
  });

  it("folder.create dry-run rejects a too-deep create (guard not bypassed)", async () => {
    const response = await router.route(
      createRequest("folder.create", { data: { name: "TooDeep", type: "Actor", folder: "fd" }, dryRun: true })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
  });

  it("folder.create rejects a dangling parent id with FOLDER_NOT_FOUND and creates nothing", async () => {
    const response = await router.route(
      createRequest("folder.create", { data: { name: "Orphan", type: "Actor", folder: "ghost" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.FOLDER_NOT_FOUND);
    expect(response.error.message).toMatch(/folder\.list/);
    expect(folders.documentClass.create).not.toHaveBeenCalled();
  });

  it("folder.create rejects a cross-type parent with INVALID_PARAMS (same rule as reparent)", async () => {
    const response = await router.route(
      createRequest("folder.create", { data: { name: "Beasts", type: "Actor", folder: "fi" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/same document type/i);
    expect(folders.documentClass.create).not.toHaveBeenCalled();
  });

  it("folder.create parent guards fire under dry-run too", async () => {
    const dangling = await router.route(
      createRequest("folder.create", {
        data: { name: "Orphan", type: "Actor", folder: "ghost" },
        dryRun: true
      })
    );
    expect(dangling.ok).toBe(false);
    expect(dangling.error.code).toBe(ERROR_CODES.FOLDER_NOT_FOUND);

    const crossType = await router.route(
      createRequest("folder.create", { data: { name: "Beasts", type: "Actor", folder: "fi" }, dryRun: true })
    );
    expect(crossType.ok).toBe(false);
    expect(crossType.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
  });

  it("folder.create refuses a parent sitting in a pre-existing cyclic chain instead of forwarding it", async () => {
    folders.get("fx").folder = "fy";

    const response = await router.route(
      createRequest("folder.create", { data: { name: "Doomed", type: "Actor", folder: "fx" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/cyclic parent chain/i);

    expect(response.error.message).toMatch(/--clear-folder/);
    expect(response.error.details.cycle).toEqual(["fx", "fy", "fx"]);

    expect(folders.documentClass.create).not.toHaveBeenCalled();
  });

  it("folder.create cycle refusal fires under dry-run too", async () => {
    folders.get("fx").folder = "fy";
    const response = await router.route(
      createRequest("folder.create", { data: { name: "Doomed", type: "Actor", folder: "fx" }, dryRun: true })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/cyclic parent chain/i);
  });

  it("folder.create reports the CYCLE, not the depth overflow, when the cyclic chain is also too deep", async () => {
    folders.get("fa").folder = "fd";
    const response = await router.route(
      createRequest("folder.create", { data: { name: "Doomed", type: "Actor", folder: "fd" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/cyclic parent chain/i);
    expect(response.error.message).not.toMatch(/levels deep/i);
    expect(response.error.details.cycle).toEqual(["fd", "fc", "fb", "fa", "fd"]);
    expect(folders.documentClass.create).not.toHaveBeenCalled();
  });

  it("folder.create still COUNTS an unresolvable ancestor exactly as Foundry does (no cycle false-positive)", async () => {
    folders.get("fy").folder = "ghost";
    const ok = await router.route(
      createRequest("folder.create", { data: { name: "UnderDangling", type: "Actor", folder: "fy" } })
    );
    expect(ok.ok).toBe(true);
    expect(folders.documentClass.create).toHaveBeenCalledTimes(1);

    folders.get("fd").folder = "fz";
    const tooDeep = await router.route(
      createRequest("folder.create", { data: { name: "TooDeep", type: "Actor", folder: "fd" } })
    );
    expect(tooDeep.ok).toBe(false);
    expect(tooDeep.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(tooDeep.error.message).toMatch(/levels deep/i);
    expect(folders.documentClass.create).toHaveBeenCalledTimes(1);
  });

  it("folder.create dry-run returns the DataModel-defaulted would-be folder with a null id", async () => {
    const response = await router.route(
      createRequest("folder.create", { data: { name: "Previewed", type: "Actor" }, dryRun: true })
    );
    expect(response.ok).toBe(true);
    expect(response.result.dryRun).toBe(true);

    expect(folders.documentClass.create).not.toHaveBeenCalled();
    expect(response.result.folder).toMatchObject({
      id: null,
      _id: null,
      name: "Previewed",
      type: "Actor",
      description: "",
      sorting: "a",
      sort: 0,
      color: null,

      childFolderCount: 0,
      documentCount: 0
    });
    expect(Object.keys(response.result.folder).sort()).toEqual(
      Object.keys(
        (await router.route(createRequest("folder.create", { data: { name: "Real", type: "Actor" } }))).result
          .folder
      ).sort()
    );
  });

  it("folder.create dry-run FAILS the creates the real call would fail (type/color/sort)", async () => {
    const badType = await router.route(
      createRequest("folder.create", { data: { name: "X", type: "NotAType" }, dryRun: true })
    );
    expect(badType.ok).toBe(false);
    expect(badType.error.code).toBe(ERROR_CODES.INVALID_PARAMS);

    const badColor = await router.route(
      createRequest("folder.create", { data: { name: "X", type: "Actor", color: "not-a-hex" }, dryRun: true })
    );
    expect(badColor.ok).toBe(false);
    expect(badColor.error.code).toBe(ERROR_CODES.INVALID_PARAMS);

    const badSort = await router.route(
      createRequest("folder.create", { data: { name: "X", type: "Actor", sort: 1.5 }, dryRun: true })
    );
    expect(badSort.ok).toBe(false);
    expect(badSort.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(folders.documentClass.create).not.toHaveBeenCalled();
  });

  it("folder.create dry-run resolves the Folder class the same way the real create does (collection documentClass, then the deprecated global)", async () => {
    folders.documentClass = undefined;
    globalThis.Folder = makeFolderDocumentClass(vi.fn(async (data) => createDocument("f-global", data)));
    try {
      const response = await router.route(
        createRequest("folder.create", { data: { name: "Fallback", type: "Actor" }, dryRun: true })
      );
      expect(response.ok).toBe(true);
      expect(response.result.folder).toMatchObject({ id: null, name: "Fallback", description: "" });
    } finally {
      delete globalThis.Folder;
    }
  });

  it("folder.update edits fields and clears color via null", async () => {
    const response = await router.route(
      createRequest("folder.update", { folderId: "fd", patch: { name: "Delta", color: null, sorting: "m" } })
    );
    expect(response.ok).toBe(true);
    expect(response.result.folder).toMatchObject({ name: "Delta", color: null, sorting: "m" });
    expect(folders.get("fd").update).toHaveBeenCalled();
  });

  it("folder.update reports a VETOED update instead of ok:true with the unchanged folder", async () => {
    const fd = folders.get("fd");

    fd.update = vi.fn(async () => undefined);

    const response = await router.route(
      createRequest("folder.update", { folderId: "fd", patch: { name: "Vetoed" } })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(response.error.message).toMatch(/was NOT updated/);
    expect(response.error.message).toMatch(/preUpdateFolder/);

    expect(response.error.message).toMatch(/no override for a world-side veto/);
    expect(response.error.details.folderId).toBe("fd");

    expect(response.error.details.fields).toEqual(["name"]);

    expect(response.error.details.validationError).toBeNull();

    expect(folders.get("fd").name).toBe("D");
  });

  it("folder.update treats a NO-OP patch (empty diff → undefined) as success, not a veto", async () => {
    const fd = folders.get("fd");

    fd.update = vi.fn(async () => undefined);

    const response = await router.route(
      createRequest("folder.update", { folderId: "fd", patch: { sorting: "a", sort: 0 } })
    );

    expect(response.ok).toBe(true);
    expect(response.result.folder).toMatchObject({ id: "fd", name: "D", sorting: "a", sort: 0 });
  });

  it("folder.update dry-run previews without persisting", async () => {
    const response = await router.route(
      createRequest("folder.update", { folderId: "fd", patch: { name: "Preview" }, dryRun: true })
    );
    expect(response.ok).toBe(true);
    expect(response.result.dryRun).toBe(true);
    expect(response.result.folder.name).toBe("Preview");
    expect(folders.get("fd").update).not.toHaveBeenCalled();
  });

  it("folder.update rejects a self-parent reparent", async () => {
    const response = await router.route(
      createRequest("folder.update", { folderId: "fa", patch: { folder: "fa" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/own parent/i);
  });

  it("folder.update rejects a cycle-producing reparent (under own descendant)", async () => {
    const response = await router.route(
      createRequest("folder.update", { folderId: "fa", patch: { folder: "fc" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/cycle/i);
  });

  it("folder.update rejects a reparent that would exceed FOLDER_MAX_DEPTH", async () => {
    const response = await router.route(
      createRequest("folder.update", { folderId: "fb", patch: { folder: "fz" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/depth|levels deep/i);
    expect(folders.get("fb").update).not.toHaveBeenCalled();
  });

  it("folder.update rejects a cross-type reparent", async () => {
    const response = await router.route(
      createRequest("folder.update", { folderId: "fa", patch: { folder: "fi" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/same document type/i);
  });

  it("folder.update returns FOLDER_NOT_FOUND for a missing reparent target", async () => {
    const response = await router.route(
      createRequest("folder.update", { folderId: "fa", patch: { folder: "ghost" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.FOLDER_NOT_FOUND);
  });

  it("folder.update accepts a valid reparent (leaf under a shallow parent) and to root", async () => {
    const ok1 = await router.route(
      createRequest("folder.update", { folderId: "fd", patch: { folder: "fa" } })
    );
    expect(ok1.ok).toBe(true);
    const ok2 = await router.route(
      createRequest("folder.update", { folderId: "fd", patch: { folder: null } })
    );
    expect(ok2.ok).toBe(true);
  });

  it("folder.update accepts a reparent landing at exactly FOLDER_MAX_DEPTH-1 (resulting depth 3)", async () => {
    const response = await router.route(
      createRequest("folder.update", { folderId: "fz", patch: { folder: "fc" } })
    );
    expect(response.ok).toBe(true);
    expect(folders.get("fz").update).toHaveBeenCalled();
  });

  it("folder.update rejects a reparent landing at exactly FOLDER_MAX_DEPTH (resulting depth 4)", async () => {
    const response = await router.route(
      createRequest("folder.update", { folderId: "fz", patch: { folder: "fd" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/depth|levels deep/i);
    expect(folders.get("fz").update).not.toHaveBeenCalled();
  });

  it("folder.update dry-run still rejects a cycle-producing reparent", async () => {
    const response = await router.route(
      createRequest("folder.update", { folderId: "fa", patch: { folder: "fc" }, dryRun: true })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/cycle/i);
    expect(folders.get("fa").update).not.toHaveBeenCalled();
  });

  it("folder.update dry-run still rejects a reparent that would exceed FOLDER_MAX_DEPTH", async () => {
    const response = await router.route(
      createRequest("folder.update", { folderId: "fz", patch: { folder: "fd" }, dryRun: true })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/depth|levels deep/i);
    expect(folders.get("fz").update).not.toHaveBeenCalled();
  });

  it("folder.update refuses a reparent under a parent sitting in a cyclic chain", async () => {
    folders.get("fx").folder = "fy";
    const response = await router.route(
      createRequest("folder.update", { folderId: "fd", patch: { folder: "fx" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/cyclic parent chain/i);
    expect(response.error.details.cycle).toEqual(["fx", "fy", "fx"]);
    expect(folders.get("fd").update).not.toHaveBeenCalled();
  });

  it("folder.update --clear-folder stays available as the documented cycle remedy", async () => {
    folders.get("fx").folder = "fy";
    const response = await router.route(
      createRequest("folder.update", { folderId: "fx", patch: { folder: null } })
    );
    expect(response.ok).toBe(true);
    expect(folders.get("fx").folder).toBeNull();
  });

  it("folder.update --clear-folder repairs a 5-node cycle (depth check exempted for a member)", async () => {
    folders.get("fx").folder = "fd";
    folders.get("fa").folder = "fx";
    const response = await router.route(
      createRequest("folder.update", { folderId: "fd", patch: { folder: null } })
    );
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    expect(folders.get("fd").folder).toBeNull();
    expect(folders.get("fd").update).toHaveBeenCalled();
  });

  it("folder.update --clear-folder repairs a 6-node cycle too", async () => {
    folders.get("fx").folder = "fd";
    folders.get("fa").folder = "fy";
    const response = await router.route(
      createRequest("folder.update", { folderId: "fa", patch: { folder: null } })
    );
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    expect(folders.get("fa").folder).toBeNull();
  });

  it("folder.update dry-run previews the cycle repair the same way (no guard, no persistence)", async () => {
    folders.get("fx").folder = "fd";
    folders.get("fa").folder = "fx";
    const response = await router.route(
      createRequest("folder.update", { folderId: "fd", patch: { folder: null }, dryRun: true })
    );
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    expect(response.result.dryRun).toBe(true);
    expect(response.result.folder.folder).toBeNull();
    expect(folders.get("fd").update).not.toHaveBeenCalled();
    expect(folders.get("fd").folder).toBe("fc");
  });

  it("folder.update still rejects an ordinary too-deep root-clear (exemption is cycle-only)", async () => {
    folders.get("fx").folder = "fd";
    const response = await router.route(
      createRequest("folder.update", { folderId: "fb", patch: { folder: null } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/exceed the maximum folder depth/i);
    expect(folders.get("fb").update).not.toHaveBeenCalled();
  });

  it("folder.create reports only the loop (starting at cycleAt), not the ancestors walked before it", async () => {
    folders.get("fx").folder = "fy";
    const response = await router.route(
      createRequest("folder.create", { data: { name: "Doomed", type: "Actor", folder: "fz" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.details.cycle).toEqual(["fy", "fx", "fy"]);
    expect(response.error.details.cycle).not.toContain("fz");

    expect(response.error.details.cycleAt).toBe("fy");
    expect(response.error.details.cycle[0]).toBe("fy");
    expect(response.error.details.cycleTruncated).toBe(false);

    expect(response.error.details.folder).toBe("fz");

    expect(response.error.message).toMatch(/clearing the parent of fy/);
    expect(folders.documentClass.create).not.toHaveBeenCalled();
  });

  it("folder.create caps the cycle ids in details AND in the message", async () => {
    const total = 120;
    for (let i = 0; i < total; i += 1) {
      folders.set(makeFolder(`n${i}`, { name: `N${i}`, type: "Actor", folder: `n${(i + 1) % total}` }));
    }
    const response = await router.route(
      createRequest("folder.create", { data: { name: "Doomed", type: "Actor", folder: "n0" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.details.cycle).toHaveLength(100);
    expect(response.error.details.cycleTruncated).toBe(true);
    expect(response.error.details.cycle[0]).toBe("n0");
    expect(response.error.details.cycleAt).toBe("n0");

    expect(response.error.message).toMatch(/\(\+111 more\)/);
    expect(response.error.message).not.toContain("n50");
  });

  it("the cycle remedy string is a RUNNABLE CLI invocation", async () => {
    folders.get("fx").folder = "fy";
    const response = await router.route(
      createRequest("folder.create", { data: { name: "Doomed", type: "Actor", folder: "fx" } })
    );
    expect(response.ok).toBe(false);
    expect(response.error.message).toContain("fvtt-world-cli folder update --folder-id fx --clear-folder");
    expect(response.error.message).not.toMatch(/folder\.update\s+--/);

    expect(response.error.message).toMatch(/folder\.update with patch\.folder = null/);
  });

  it("serializes overlapping folder mutations through the global queue (second waits for the first)", async () => {
    const order = [];
    /** @type {(value?: unknown) => void} */
    let releaseFirst = () => {};
    const gate = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    const fd = folders.get("fd");
    const fx = folders.get("fx");
    fd.update = vi.fn(async (patch) => {
      order.push("t1-write");
      await gate;
      order.push("t1-done");
      Object.assign(fd, patch);
      return fd;
    });
    fx.update = vi.fn(async (patch) => {
      order.push("t2-write");
      Object.assign(fx, patch);
      return fx;
    });

    const p1 = router.route(createRequest("folder.update", { folderId: "fd", patch: { folder: "fa" } }));
    const p2 = router.route(createRequest("folder.update", { folderId: "fx", patch: { name: "Renamed" } }));

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["t1-write"]);
    expect(fx.update).not.toHaveBeenCalled();

    releaseFirst();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    expect(order).toEqual(["t1-write", "t1-done", "t2-write"]);
  });

  it("a rejecting folder mutation does not block the next queued folder mutation", async () => {
    const fd = folders.get("fd");
    const fx = folders.get("fx");
    fd.update = vi.fn(async () => {
      throw new Error("simulated update failure");
    });
    fx.update = vi.fn(async (patch) => {
      Object.assign(fx, patch);
      return fx;
    });

    const p1 = router.route(createRequest("folder.update", { folderId: "fd", patch: { name: "Boom" } }));
    const p2 = router.route(createRequest("folder.update", { folderId: "fx", patch: { name: "Survivor" } }));

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(true);
    expect(fx.update).toHaveBeenCalledTimes(1);
  });

  it("folder.delete default dry-run reports reparent consequences with direct/recursive counts", async () => {
    const response = await router.route(createRequest("folder.delete", { folderId: "fb", dryRun: true }));
    expect(response.ok).toBe(true);
    expect(response.result.dryRun).toBe(true);
    expect(response.result.deleted).toBe(false);
    expect(response.result.reparentedTo).toBe("fa");
    expect(response.result.counts.subfolders).toEqual({ direct: 1, recursive: 2 });

    expect(response.result.counts.contents).toEqual({ direct: 1, recursive: 2 });

    expect(response.result.folders.reparented.count).toBe(2);
    expect(response.result.folders.deleted.count).toBe(0);
    expect(response.result.contents.reparented.count).toBe(1);
    expect(response.result.contents.deleted.count).toBe(0);
  });

  it("folder.delete --delete-contents without force is rejected and enumerates token-used actors", async () => {
    const response = await router.route(
      createRequest("folder.delete", { folderId: "fa", deleteContents: true, deleteSubfolders: true })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.DELETE_FORBIDDEN);
    const actorIds = response.error.details.guardViolations.actors.map((a) => a.actorId);
    expect(actorIds).toContain("act-token");
  });

  it("folder.delete --delete-contents force gate fires under dry-run too", async () => {
    const response = await router.route(
      createRequest("folder.delete", { folderId: "fa", deleteContents: true, dryRun: true })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.DELETE_FORBIDDEN);
  });

  it("folder.delete --delete-contents on a Scene folder enumerates WHICH scene is active", async () => {
    const response = await router.route(
      createRequest("folder.delete", { folderId: "fs", deleteContents: true })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.DELETE_FORBIDDEN);
    expect(response.error.details.guardViolations.scenes).toEqual([{ sceneId: "sc-active", name: "Arena" }]);
    expect(response.error.details.guardViolations.activeScene).toBe(true);
  });

  it("folder.delete guardViolations lists NO scenes when no content scene is active", async () => {
    scenes.get("sc-active").active = false;
    const response = await router.route(
      createRequest("folder.delete", { folderId: "fs", deleteContents: true })
    );
    expect(response.ok).toBe(false);
    expect(response.error.details.guardViolations.scenes).toEqual([]);
    expect(response.error.details.guardViolations.activeScene).toBe(false);
  });

  it("folder.delete --delete-contents is forbidden for a Cards folder that holds stacks even with force", async () => {
    const response = await router.route(
      createRequest("folder.delete", { folderId: "fcards", deleteContents: true, force: true })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/cards\.delete/i);
  });

  it("folder.delete Cards prohibition PRECEDES the force gate — no-force reports INVALID_PARAMS, not DELETE_FORBIDDEN", async () => {
    const response = await router.route(
      createRequest("folder.delete", { folderId: "fcards", deleteContents: true })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.code).not.toBe(ERROR_CODES.DELETE_FORBIDDEN);
    expect(response.error.message).toMatch(/cards\.delete/i);
  });

  it("folder.delete --delete-contents on an EMPTY Cards folder is NOT blocked by the recall guard", async () => {
    const response = await router.route(
      createRequest("folder.delete", {
        folderId: "fcards-empty",
        deleteContents: true,
        force: true,
        dryRun: true
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.dryRun).toBe(true);
    expect(response.result.contents.deleted.count).toBe(0);
  });

  it("folder.delete real default path deletes the folder, reparents descendants + contents, complete:true", async () => {
    installCascadeDelete();
    const response = await router.route(createRequest("folder.delete", { folderId: "fb" }));
    expect(response.ok).toBe(true);
    expect(response.result.deleted).toBe(true);
    expect(response.result.complete).toBe(true);

    expect(folders.get("fb")).toBeNull();
    expect(folders.get("fc").folder).toBe("fa");
    expect(actors.get("act-in-b").folder).toBe("fa");
  });

  it("folder.delete real --delete-subfolders --delete-contents --force removes the subtree, complete:true", async () => {
    installCascadeDelete();
    const response = await router.route(
      createRequest("folder.delete", {
        folderId: "fb",
        deleteSubfolders: true,
        deleteContents: true,
        force: true
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(response.result.folders.deleted.count).toBe(2);
    expect(response.result.contents.deleted.count).toBe(2);

    expect(response.result.guardViolations).toEqual({
      actors: [],
      actorsCount: 0,
      actorsTruncated: false,
      scenes: [],
      scenesCount: 0,
      scenesTruncated: false,
      activeScene: false
    });
    expect(folders.get("fb")).toBeNull();
    expect(folders.get("fc")).toBeNull();
    expect(actors.get("act-in-b")).toBeNull();
    expect(actors.get("act-in-c")).toBeNull();
  });

  it("folder.delete dry-run carries guardViolations with the SAME full key set as the real force-accepted path", async () => {
    const response = await router.route(
      createRequest("folder.delete", {
        folderId: "fa",
        deleteContents: true,
        force: true,
        dryRun: true
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.dryRun).toBe(true);

    expect(response.result.guardViolations).toEqual({
      actors: [
        {
          actorId: "act-token",
          name: "Guard",
          tokenReferences: [{ sceneId: "sc-active", tokenId: "tok-1" }],
          tokenReferencesCount: 1,
          tokenReferencesTruncated: false
        }
      ],
      actorsCount: 1,
      actorsTruncated: false,

      scenes: [],
      scenesCount: 0,
      scenesTruncated: false,
      activeScene: false
    });

    expect(folders.get("fa")).not.toBeNull();
    expect(actors.get("act-token")).not.toBeNull();
  });

  it("folder.delete --delete-subfolders WITHOUT --delete-contents deletes the subtree and reparents the WHOLE subtree's documents", async () => {
    installCascadeDelete();
    const response = await router.route(
      createRequest("folder.delete", { folderId: "fb", deleteSubfolders: true })
    );
    expect(response.ok).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(response.result.folders.deleted.count).toBe(2);
    expect(response.result.folders.reparented.count).toBe(0);

    expect(response.result.contents.reparented.count).toBe(2);
    expect(response.result.contents.reparented.ids).toEqual(expect.arrayContaining(["act-in-b", "act-in-c"]));
    expect(response.result.contents.deleted.count).toBe(0);

    expect(folders.get("fb")).toBeNull();
    expect(folders.get("fc")).toBeNull();
    expect(folders.get("fd")).toBeNull();
    expect(actors.get("act-in-b").folder).toBe("fa");
    expect(actors.get("act-in-c").folder).toBe("fa");
  });

  it("folder.delete --delete-contents WITHOUT --delete-subfolders deletes ONLY the direct documents; those in re-parented subfolders survive", async () => {
    installCascadeDelete();
    const response = await router.route(
      createRequest("folder.delete", { folderId: "fb", deleteContents: true, force: true })
    );
    expect(response.ok).toBe(true);
    expect(response.result.complete).toBe(true);

    expect(response.result.contents.deleted.ids).toEqual(["act-in-b"]);
    expect(response.result.contents.deleted.ids).not.toContain("act-in-c");

    expect(response.result.folders.reparented.count).toBe(2);
    expect(response.result.folders.deleted.count).toBe(0);

    expect(actors.get("act-in-b")).toBeNull();
    expect(actors.get("act-in-c")).not.toBeNull();
    expect(actors.get("act-in-c").folder).toBe("fc");
    expect(folders.get("fc").folder).toBe("fa");
  });

  function selfParentedFolderIds() {
    return [...folders].filter((folder) => (folder.folder ?? null) === folder.id).map((folder) => folder.id);
  }

  function danglingParentFolderIds() {
    const ids = new Set([...folders].map((folder) => folder.id));
    return [...folders]
      .filter((folder) => folder.folder != null && !ids.has(folder.folder))
      .map((folder) => folder.id);
  }

  function danglingParentActorIds() {
    const ids = new Set([...folders].map((folder) => folder.id));
    return [...actors].filter((doc) => doc.folder != null && !ids.has(doc.folder)).map((doc) => doc.id);
  }

  it("folder.delete refuses the DEFAULT cascade for a 2-cycle member instead of self-parenting the survivor", async () => {
    installCascadeDelete();

    folders.get("fx").folder = "fy";

    const response = await router.route(createRequest("folder.delete", { folderId: "fx" }));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/cyclic parent chain/i);
    expect(response.error.message).toMatch(/SELF-PARENTED/);
    expect(response.error.message).toMatch(/force:true does NOT override/);

    expect(response.error.details).toMatchObject({
      folderId: "fx",
      reparentedTo: "fy",
      cycleAt: "fy",
      cycleTruncated: false
    });
    expect(response.error.details.cycle).toEqual(["fy", "fx", "fy"]);

    expect(folders.get("fx")).not.toBeNull();
    expect(folders.get("fy").folder).toBe("fx");
    expect(selfParentedFolderIds()).toEqual([]);
  });

  it("folder.delete refuses a 3-cycle member the same way (residue is identical in kind)", async () => {
    installCascadeDelete();

    folders.get("fa").folder = "fc";

    const response = await router.route(createRequest("folder.delete", { folderId: "fa" }));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);

    expect(response.error.details).toMatchObject({ folderId: "fa", reparentedTo: "fc", cycleAt: "fc" });
    expect(response.error.details.cycle).toEqual(["fc", "fb", "fa", "fc"]);
    expect(folders.get("fa")).not.toBeNull();
    expect(selfParentedFolderIds()).toEqual([]);
  });

  it("the cascade cycle refusal fires under dry-run too (a dry run is not a guard bypass)", async () => {
    folders.get("fx").folder = "fy";
    const response = await router.route(createRequest("folder.delete", { folderId: "fx", dryRun: true }));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/cyclic parent chain/i);
  });

  it("the cascade cycle refusal PRECEDES the Cards recall guard and is not overridable by force", async () => {
    installCascadeDelete();
    folders.get("fcards").folder = "fcards-empty";
    folders.get("fcards-empty").folder = "fcards";

    const forced = await router.route(
      createRequest("folder.delete", { folderId: "fcards", deleteContents: true, force: true })
    );
    expect(forced.ok).toBe(false);
    expect(forced.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(forced.error.message).toMatch(/cyclic parent chain/i);
    expect(forced.error.message).not.toMatch(/recall/i);
    expect(forced.error.details.cycleAt).toBe("fcards-empty");

    const unforced = await router.route(
      createRequest("folder.delete", { folderId: "fcards", deleteContents: true })
    );
    expect(unforced.ok).toBe(false);
    expect(unforced.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(unforced.error.message).toMatch(/cyclic parent chain/i);
    expect(folders.get("fcards")).not.toBeNull();
    expect(selfParentedFolderIds()).toEqual([]);
  });

  it("folder.delete --delete-subfolders stays available on a cycle with NOTHING to re-parent", async () => {
    installCascadeDelete();
    folders.get("fx").folder = "fy";

    const response = await router.route(
      createRequest("folder.delete", { folderId: "fx", deleteSubfolders: true })
    );
    expect(response.ok).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(response.result.contents.reparented.count).toBe(0);
    expect(folders.get("fx")).toBeNull();
    expect(folders.get("fy")).toBeNull();
    expect(folders.get("fz")).toBeNull();
    expect(selfParentedFolderIds()).toEqual([]);
    expect(danglingParentFolderIds()).toEqual([]);
    expect(danglingParentActorIds()).toEqual([]);
  });

  it("folder.delete --delete-subfolders REFUSES a loop that still holds documents (they would dangle)", async () => {
    installCascadeDelete();
    folders.get("fx").folder = "fy";
    actors.set(createDocument("act-in-fy", { name: "In Y", type: "npc", folder: "fy" }));

    const response = await router.route(
      createRequest("folder.delete", { folderId: "fx", deleteSubfolders: true })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/cyclic parent chain/i);

    expect(response.error.message).toMatch(/DANGLING/);
    expect(response.error.message).toMatch(/fy is DELETED by this same operation/);
    expect(response.error.message).not.toMatch(/SELF-PARENTED/);
    expect(response.error.details).toMatchObject({
      folderId: "fx",
      reparentedTo: "fy",
      reparentTargetDeleted: true,

      reparentedFolderCount: 0,
      reparentedContentCount: 1,
      cycleAt: "fy",
      cycleTruncated: false
    });
    expect(response.error.details.cycle).toEqual(["fy", "fx", "fy"]);

    expect(folders.get("fx")).not.toBeNull();
    expect(folders.get("fy")).not.toBeNull();
    expect(actors.get("act-in-fy").folder).toBe("fy");
  });

  it("--delete-subfolders is refused for a document in an OFF-LOOP descendant too", async () => {
    installCascadeDelete();
    folders.get("fx").folder = "fy";
    actors.set(createDocument("act-in-fz", { name: "In Z", type: "npc", folder: "fz" }));

    const response = await router.route(
      createRequest("folder.delete", { folderId: "fx", deleteSubfolders: true })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/DANGLING/);
    expect(response.error.details).toMatchObject({
      folderId: "fx",
      reparentedTo: "fy",
      reparentTargetDeleted: true,
      reparentedFolderCount: 0,
      reparentedContentCount: 1
    });
    expect(actors.get("act-in-fz").folder).toBe("fz");
    expect(folders.get("fz")).not.toBeNull();
  });

  it("the dangling-target refusal fires identically under dry-run", async () => {
    installCascadeDelete();
    folders.get("fx").folder = "fy";
    actors.set(createDocument("act-in-fy", { name: "In Y", type: "npc", folder: "fy" }));

    const real = await router.route(
      createRequest("folder.delete", { folderId: "fx", deleteSubfolders: true })
    );
    const dry = await router.route(
      createRequest("folder.delete", { folderId: "fx", deleteSubfolders: true, dryRun: true })
    );
    expect(dry.ok).toBe(false);

    expect(dry.error.code).toBe(real.error.code);
    expect(dry.error.message).toBe(real.error.message);
    expect(dry.error.details).toEqual(real.error.details);
    expect(folders.get("fx")).not.toBeNull();
  });

  it("clearing the cycle member's own parent first makes the DEFAULT delete work (documented repair)", async () => {
    installCascadeDelete();
    folders.get("fx").folder = "fy";

    const repair = await router.route(
      createRequest("folder.update", { folderId: "fx", patch: { folder: null } })
    );
    expect(repair.ok).toBe(true);
    expect(folders.get("fx").folder).toBeNull();

    const deleted = await router.route(createRequest("folder.delete", { folderId: "fx" }));
    expect(deleted.ok).toBe(true);
    expect(deleted.result.complete).toBe(true);
    expect(folders.get("fx")).toBeNull();

    expect(folders.get("fy").folder).toBeNull();
    expect(selfParentedFolderIds()).toEqual([]);
    expect(danglingParentFolderIds()).toEqual([]);
  });

  it("the clear-then-delete repair also works for a loop holding DOCUMENTS (manifestation B)", async () => {
    installCascadeDelete();
    folders.get("fx").folder = "fy";
    actors.set(createDocument("act-in-fy", { name: "In Y", type: "npc", folder: "fy" }));

    const repair = await router.route(
      createRequest("folder.update", { folderId: "fx", patch: { folder: null } })
    );
    expect(repair.ok).toBe(true);

    const deleted = await router.route(
      createRequest("folder.delete", { folderId: "fx", deleteSubfolders: true })
    );
    expect(deleted.ok).toBe(true);
    expect(deleted.result.complete).toBe(true);
    expect(deleted.result.reparentedTo).toBeNull();
    expect(folders.get("fx")).toBeNull();
    expect(folders.get("fy")).toBeNull();
    expect(actors.get("act-in-fy").folder).toBeNull();
    expect(danglingParentActorIds()).toEqual([]);
    expect(danglingParentFolderIds()).toEqual([]);
  });

  it("folder.delete REFUSES a self-parented folder whose subfolders would be left dangling", async () => {
    installCascadeDelete();
    folders.get("fx").folder = "fx";

    const response = await router.route(createRequest("folder.delete", { folderId: "fx" }));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/cyclic parent chain/i);
    expect(response.error.message).toMatch(/DANGLING/);
    expect(response.error.message).toMatch(/That parent IS this folder/);
    expect(response.error.details).toMatchObject({
      folderId: "fx",
      reparentedTo: "fx",
      reparentTargetDeleted: true,

      reparentedFolderCount: 2,
      reparentedContentCount: 0,
      cycleAt: "fx",
      cycleTruncated: false
    });
    expect(response.error.details.cycle).toEqual(["fx", "fx"]);

    expect(folders.get("fx")).not.toBeNull();
    expect(folders.get("fy").folder).toBe("fx");
    expect(folders.get("fz").folder).toBe("fy");
    expect(danglingParentFolderIds()).toEqual([]);
  });

  it("folder.delete REFUSES a self-parented folder whose DOCUMENTS would be left dangling", async () => {
    const fsolo = makeFolder("fsolo", { name: "Solo", type: "Actor", folder: "fsolo" });
    folders.set(fsolo);
    actors.set(createDocument("act-in-solo", { name: "Loner", type: "npc", folder: "fsolo" }));
    installCascadeDelete();

    const response = await router.route(createRequest("folder.delete", { folderId: "fsolo" }));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.details).toMatchObject({
      folderId: "fsolo",
      reparentTargetDeleted: true,
      reparentedFolderCount: 0,
      reparentedContentCount: 1
    });
    expect(folders.get("fsolo")).not.toBeNull();
    expect(actors.get("act-in-solo").folder).toBe("fsolo");
  });

  it("a self-parented folder with NOTHING to re-parent is still deletable", async () => {
    const fsolo = makeFolder("fsolo", { name: "Solo", type: "Actor", folder: "fsolo" });
    folders.set(fsolo);
    installCascadeDelete();

    const response = await router.route(createRequest("folder.delete", { folderId: "fsolo" }));
    expect(response.ok).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(response.result.folders.reparented.count).toBe(0);
    expect(response.result.contents.reparented.count).toBe(0);
    expect(folders.get("fsolo")).toBeNull();
    expect(selfParentedFolderIds()).toEqual([]);
    expect(danglingParentFolderIds()).toEqual([]);
  });

  it("clear-then-delete repairs a self-parented folder that DOES have subfolders (manifestation A)", async () => {
    installCascadeDelete();
    folders.get("fx").folder = "fx";

    const repair = await router.route(
      createRequest("folder.update", { folderId: "fx", patch: { folder: null } })
    );
    expect(repair.ok).toBe(true);
    expect(folders.get("fx").folder).toBeNull();

    const deleted = await router.route(createRequest("folder.delete", { folderId: "fx" }));
    expect(deleted.ok).toBe(true);
    expect(deleted.result.complete).toBe(true);
    expect(deleted.result.reparentedTo).toBeNull();
    expect(folders.get("fx")).toBeNull();

    expect(folders.get("fy").folder).toBeNull();
    expect(folders.get("fz").folder).toBeNull();
    expect(danglingParentFolderIds()).toEqual([]);
  });

  it("--delete-subfolders also clears the refusal for a self-parented folder (subfolder category)", async () => {
    installCascadeDelete();
    folders.get("fx").folder = "fx";

    const response = await router.route(
      createRequest("folder.delete", { folderId: "fx", deleteSubfolders: true })
    );
    expect(response.ok).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(folders.get("fx")).toBeNull();
    expect(folders.get("fy")).toBeNull();
    expect(folders.get("fz")).toBeNull();
    expect(danglingParentFolderIds()).toEqual([]);
  });

  it("--delete-contents --force clears the refusal for a self-parented folder (document category)", async () => {
    const fsolo = makeFolder("fsolo", { name: "Solo", type: "Actor", folder: "fsolo" });
    folders.set(fsolo);
    actors.set(createDocument("act-in-solo", { name: "Loner", type: "npc", folder: "fsolo" }));
    installCascadeDelete();

    const response = await router.route(
      createRequest("folder.delete", { folderId: "fsolo", deleteContents: true, force: true })
    );
    expect(response.ok).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(response.result.contents.deleted.ids).toEqual(["act-in-solo"]);
    expect(folders.get("fsolo")).toBeNull();
    expect(actors.get("act-in-solo")).toBeNull();
    expect(danglingParentActorIds()).toEqual([]);
  });

  it("an ORDINARY delete is never refused by the cascade guard (no over-refusal)", async () => {
    installCascadeDelete();

    const response = await router.route(createRequest("folder.delete", { folderId: "fb" }));
    expect(response.ok).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(response.result.folders.reparented.ids).toEqual(["fc", "fd"]);
    expect(response.result.contents.reparented.ids).toEqual(["act-in-b"]);
    expect(folders.get("fc").folder).toBe("fa");
    expect(actors.get("act-in-b").folder).toBe("fa");
    expect(danglingParentFolderIds()).toEqual([]);
    expect(danglingParentActorIds()).toEqual([]);
  });

  it("a cycle ABOVE the folder is not refused (nothing new is authored there)", async () => {
    folders.get("fx").folder = "fy";
    const fzChild = makeFolder("fz-child", { name: "ZC", type: "Actor", folder: "fz" });
    folders.set(fzChild);
    installCascadeDelete();

    const response = await router.route(createRequest("folder.delete", { folderId: "fz" }));
    expect(response.ok).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(folders.get("fz-child").folder).toBe("fy");
    expect(danglingParentFolderIds()).toEqual([]);
  });

  it("folder.delete caps each consequence id list at 100 and flags truncated", async () => {
    const fbig = makeFolder("fbig", { name: "Big", type: "Actor" });
    const fbigChild = makeFolder("fbig-child", { name: "Big child", type: "Actor", folder: "fbig" });
    folders.set(fbig);
    folders.set(fbigChild);
    for (let i = 0; i < 101; i += 1) {
      actors.set(createDocument(`big-actor-${i}`, { name: `Extra ${i}`, type: "npc", folder: "fbig" }));
    }

    const response = await router.route(createRequest("folder.delete", { folderId: "fbig", dryRun: true }));
    expect(response.ok).toBe(true);

    expect(response.result.counts.contents).toEqual({ direct: 101, recursive: 101 });
    expect(response.result.contents.reparented.count).toBe(101);

    expect(response.result.contents.reparented.ids).toHaveLength(100);
    expect(response.result.contents.reparented.truncated).toBe(true);

    expect(response.result.folders.reparented.count).toBe(1);
    expect(response.result.folders.reparented.ids).toEqual(["fbig-child"]);
    expect(response.result.folders.reparented.truncated).toBe(false);
  });

  it("folder.delete caps guardViolations.actors at 100 (exact count) and the per-actor tokenReferences at 20", async () => {
    const fguard = makeFolder("fguard", { name: "Guarded", type: "Actor" });
    folders.set(fguard);
    const sceneTokens = [];
    for (let i = 0; i < 105; i += 1) {
      actors.set(createDocument(`guard-actor-${i}`, { name: `Placed ${i}`, type: "npc", folder: "fguard" }));

      const placements = i === 0 ? 25 : 1;
      for (let t = 0; t < placements; t += 1) {
        sceneTokens.push(
          createDocument(`gtok-${i}-${t}`, { name: `T${i}-${t}`, actorId: `guard-actor-${i}` })
        );
      }
    }
    scenes.get("sc-active").tokens = createCollection(sceneTokens);

    const response = await router.route(
      createRequest("folder.delete", { folderId: "fguard", deleteContents: true, dryRun: true })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.DELETE_FORBIDDEN);
    const violations = response.error.details.guardViolations;

    expect(violations.actorsCount).toBe(105);

    expect(violations.actors).toHaveLength(100);
    expect(violations.actorsTruncated).toBe(true);

    const heavy = violations.actors.find((a) => a.actorId === "guard-actor-0");
    expect(heavy.tokenReferencesCount).toBe(25);
    expect(heavy.tokenReferences).toHaveLength(20);
    expect(heavy.tokenReferencesTruncated).toBe(true);

    const light = violations.actors.find((a) => a.actorId === "guard-actor-1");
    expect(light.tokenReferences).toEqual([{ sceneId: "sc-active", tokenId: "gtok-1-0" }]);
    expect(light.tokenReferencesCount).toBe(1);
    expect(light.tokenReferencesTruncated).toBe(false);
    expect(violations.scenes).toEqual([]);
    expect(violations.scenesCount).toBe(0);
    expect(violations.scenesTruncated).toBe(false);
  });

  it("folder.delete caps guardViolations.scenes at 100 (exact count) and keeps activeScene derivable from scenesCount", async () => {
    for (let i = 0; i < 100; i += 1) {
      scenes.set(
        createDocument(`sc-extra-${i}`, { name: `Extra ${i}`, type: "Scene", folder: "fs", active: true })
      );
    }

    const response = await router.route(
      createRequest("folder.delete", { folderId: "fs", deleteContents: true, dryRun: true })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.DELETE_FORBIDDEN);
    const violations = response.error.details.guardViolations;
    expect(violations.scenesCount).toBe(101);
    expect(violations.scenes).toHaveLength(100);
    expect(violations.scenesTruncated).toBe(true);

    expect(violations.activeScene).toBe(true);
    expect(violations.actors).toEqual([]);
    expect(violations.actorsCount).toBe(0);
    expect(violations.actorsTruncated).toBe(false);
  });

  it("folder.delete partial commit (folder STILL PRESENT, one content survives) reports deleted:false, complete:false with observed-gone deleted lists + remaining survivor", async () => {
    const fb = folders.get("fb");
    fb.delete = vi.fn(async () => {
      folders.delete("fd");
      folders.delete("fc");
      actors.delete("act-in-b");
      throw new Error("simulated cascade veto on the last content delete");
    });

    const response = await router.route(
      createRequest("folder.delete", {
        folderId: "fb",
        deleteSubfolders: true,
        deleteContents: true,
        force: true
      })
    );
    expect(response.ok).toBe(true);

    expect(response.result.deleted).toBe(false);
    expect(response.result.complete).toBe(false);
    expect(folders.get("fb")).not.toBeNull();

    expect(response.result.folders.deleted.count).toBe(2);
    expect(response.result.folders.deleted.ids).toEqual(expect.arrayContaining(["fc", "fd"]));

    expect(response.result.contents.deleted.count).toBe(1);
    expect(response.result.contents.deleted.ids).toEqual(["act-in-b"]);
    expect(response.result.contents.deleted.ids).not.toContain("act-in-c");

    expect(response.result.remaining.folders.count).toBe(0);
    expect(response.result.remaining.contents.ids).toEqual(["act-in-c"]);
    expect(actors.get("act-in-c")).not.toBeNull();
  });

  it("folder.delete partial commit where the folder row was removed last still reports complete:true", async () => {
    const fb = folders.get("fb");
    fb.delete = vi.fn(async () => {
      folders.delete("fd");
      folders.delete("fc");
      actors.delete("act-in-b");
      actors.delete("act-in-c");
      folders.delete("fb");
      throw new Error("spurious rejection after a fully committed cascade");
    });

    const response = await router.route(
      createRequest("folder.delete", {
        folderId: "fb",
        deleteSubfolders: true,
        deleteContents: true,
        force: true
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.deleted).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(response.result).not.toHaveProperty("remaining");
  });

  it("folder.delete reports a VETOED delete (resolves with nothing, folder still present) as a failure", async () => {
    const fb = folders.get("fb");
    fb.delete = vi.fn(async () => undefined);

    const response = await router.route(createRequest("folder.delete", { folderId: "fb" }));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(response.error.message).toMatch(/preDeleteFolder|refused/i);

    expect(response.error.message).toMatch(/force:true does NOT override/);

    expect(folders.get("fb")).not.toBeNull();
    expect(folders.get("fc").folder).toBe("fb");
    expect(actors.get("act-in-b").folder).toBe("fb");
  });

  it("folder.delete accepts an empty resolved value when the folder IS observably gone", async () => {
    const fb = folders.get("fb");
    fb.delete = vi.fn(async () => {
      folders.get("fc").folder = "fa";
      folders.get("fd").folder = "fa";
      actors.get("act-in-b").folder = "fa";
      folders.delete("fb");
      return undefined;
    });

    const response = await router.route(createRequest("folder.delete", { folderId: "fb" }));
    expect(response.ok).toBe(true);
    expect(response.result.deleted).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(response.result).not.toHaveProperty("remaining");
  });

  it("folder.delete does NOT call an empty resolved value a veto when the cascade demonstrably ran", async () => {
    const fb = folders.get("fb");
    fb.delete = vi.fn(async () => {
      folders.get("fc").folder = "fa";
      folders.get("fd").folder = "fa";
      actors.get("act-in-b").folder = "fa";
      return undefined;
    });

    const response = await router.route(createRequest("folder.delete", { folderId: "fb" }));
    expect(response.ok).toBe(true);
    expect(response.result.deleted).toBe(false);
    expect(response.result.complete).toBe(false);
    expect(response.result.folders.reparented.count).toBe(2);
  });

  it("folder.delete DEFAULT combination reports the reparents that committed instead of rethrowing raw", async () => {
    const fb = folders.get("fb");
    fb.delete = vi.fn(async () => {
      folders.get("fc").folder = "fa";
      folders.get("fd").folder = "fa";
      actors.get("act-in-b").folder = "fa";
      throw new Error("simulated cascade failure after the subtree was flattened");
    });

    const response = await router.route(createRequest("folder.delete", { folderId: "fb" }));
    expect(response.ok).toBe(true);
    expect(response.result.deleted).toBe(false);
    expect(response.result.complete).toBe(false);

    expect(response.result.folders.reparented.count).toBe(2);
    expect(response.result.folders.reparented.ids).toEqual(expect.arrayContaining(["fc", "fd"]));
    expect(response.result.contents.reparented.ids).toEqual(["act-in-b"]);

    expect(response.result).not.toHaveProperty("remaining");
    expect(folders.get("fb")).not.toBeNull();
  });

  it("folder.delete does NOT echo a reparent that never landed — it lists it under remaining", async () => {
    const fb = folders.get("fb");
    fb.delete = vi.fn(async () => {
      folders.get("fc").folder = "fa";
      throw new Error("simulated cascade failure mid-reparent");
    });

    const response = await router.route(createRequest("folder.delete", { folderId: "fb" }));
    expect(response.ok).toBe(true);
    expect(response.result.complete).toBe(false);
    expect(response.result.folders.reparented.ids).toEqual(["fc"]);
    expect(response.result.folders.reparented.ids).not.toContain("fd");
    expect(response.result.remaining.foldersNotReparented.ids).toEqual(["fd"]);
    expect(response.result.remaining.contentsNotReparented.ids).toEqual(["act-in-b"]);

    expect(response.result.remaining.folders.count).toBe(0);
    expect(response.result.remaining.contents.count).toBe(0);
  });

  it("folder.delete refuses the corrupt tree that would have produced a PRE-EXISTING content match", async () => {
    folders.get("fa").folder = "fd";

    const fb = folders.get("fb");
    fb.delete = vi.fn(async () => {
      throw new Error("cascade failed before any write committed");
    });

    const response = await router.route(
      createRequest("folder.delete", { folderId: "fb", deleteSubfolders: true })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/cyclic parent chain/i);
    expect(response.error.message).toMatch(/DANGLING/);
    expect(response.error.details).toMatchObject({
      folderId: "fb",
      reparentedTo: "fa",
      reparentTargetDeleted: true,
      reparentedFolderCount: 0,

      reparentedContentCount: 3,
      cycleAt: "fa"
    });
    expect(response.error.details.cycle).toEqual(["fa", "fd", "fc", "fb", "fa"]);

    expect(fb.delete).not.toHaveBeenCalled();
    expect(actors.get("act-token").folder).toBe("fa");
  });

  it("folder.delete rethrows the raw error when NOTHING committed (clean early failure, uncached)", async () => {
    const fb = folders.get("fb");
    fb.delete = vi.fn(async () => {
      throw new Error("cascade failed before any write committed");
    });

    const response = await router.route(
      createRequest("folder.delete", {
        folderId: "fb",
        deleteSubfolders: true,
        deleteContents: true,
        force: true
      })
    );
    expect(response.ok).toBe(false);

    expect(folders.get("fb")).not.toBeNull();
    expect(folders.get("fc")).not.toBeNull();
    expect(actors.get("act-in-b")).not.toBeNull();
  });
});

describe("user write surface", () => {
  let router;

  beforeEach(() => {
    installFakeFoundry();
    router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
  });

  function users() {
    return globalThis.game.users;
  }

  it("creates a user and confirms it against the world's user list", async () => {
    const response = await router.route(
      createRequest("user.create", { data: { name: "Scratch", role: 2, color: "#123456" } })
    );

    expect(response.ok).toBe(true);
    expect(response.result.user).toMatchObject({ name: "Scratch", role: 2, color: "#123456" });
    expect(users().get(response.result.user.id)).not.toBeNull();
    expect(response.result.user).not.toHaveProperty("password");
    expect(response.result.user).not.toHaveProperty("passwordSalt");
  });

  it("previews a creation without adding a user", async () => {
    const before = users().size;

    const response = await router.route(
      createRequest("user.create", { data: { name: "Ghost" }, dryRun: true })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({ dryRun: true });
    expect(response.result.user.name).toBe("Ghost");
    expect(users().size).toBe(before);
  });

  it("refuses a password or a role on the closed write schemas", async () => {
    const created = await router.route(
      createRequest("user.create", { data: { name: "Sneaky", password: "hunter2" } })
    );
    expect(created.ok).toBe(false);
    expect(created.error.code).toBe(ERROR_CODES.INVALID_PARAMS);

    const patched = await router.route(
      createRequest("user.update", { userId: "player-1", patch: { password: "hunter2" } })
    );
    expect(patched.ok).toBe(false);
    expect(patched.error.code).toBe(ERROR_CODES.INVALID_PARAMS);

    const promoted = await router.route(
      createRequest("user.update", { userId: "player-1", patch: { role: 4 } })
    );
    expect(promoted.ok).toBe(false);
    expect(promoted.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
  });

  it("updates the fields a user may change and previews without writing", async () => {
    const preview = await router.route(
      createRequest("user.update", {
        userId: "player-1",
        patch: { pronouns: "she/her" },
        dryRun: true
      })
    );
    expect(preview.ok).toBe(true);
    expect(preview.result.user).toMatchObject({ id: "player-1" });
    expect(users().get("player-1").pronouns).toBe("");

    const response = await router.route(
      createRequest("user.update", { userId: "player-1", patch: { pronouns: "she/her" } })
    );
    expect(response.ok).toBe(true);
    expect(users().get("player-1").pronouns).toBe("she/her");
  });

  it("deletes another user and confirms the world's user list dropped it", async () => {
    const preview = await router.route(createRequest("user.delete", { userId: "player-2", dryRun: true }));
    expect(preview.result).toMatchObject({ id: "player-2", deleted: false, dryRun: true });
    expect(users().get("player-2")).not.toBeNull();

    const response = await router.route(createRequest("user.delete", { userId: "player-2" }));
    expect(response.result).toMatchObject({ id: "player-2", deleted: true });
    expect(users().get("player-2")).toBeNull();
  });

  it("refuses to delete or demote the user this bridge runs through, preview included", async () => {
    for (const params of [
      { command: "user.delete", params: { userId: "user-1" } },
      { command: "user.delete", params: { userId: "user-1", dryRun: true } },
      { command: "user.role.set", params: { userId: "user-1", role: 1 } },
      { command: "user.role.set", params: { userId: "user-1", role: 1, dryRun: true } }
    ]) {
      const response = await router.route(createRequest(params.command, params.params));

      expect(response.ok, JSON.stringify(params)).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.USER_SELF_PROTECTED);
      expect(response.error.details).toMatchObject({ userId: "user-1", command: params.command });
    }

    expect(users().get("user-1").role).toBe(4);
    expect(users().get("user-1").delete).not.toHaveBeenCalled();
  });

  it("refuses a user write when the client cannot say which account the bridge runs through", async () => {
    globalThis.game.user.id = null;

    const response = await router.route(createRequest("user.delete", { userId: "player-2" }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.BRIDGE_NOT_READY);
    expect(response.error.details).toMatchObject({ userId: "player-2", command: "user.delete" });
    expect(users().get("player-2")).not.toBeNull();
  });

  it("changes another user's role, names it, and reports a request for the stored role as a no-op", async () => {
    const response = await router.route(createRequest("user.role.set", { userId: "player-1", role: 3 }));

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({
      userId: "player-1",
      previousRole: 1,
      role: 3,
      roleName: "ASSISTANT",
      changed: true
    });
    expect(users().get("player-1").role).toBe(3);

    const again = await router.route(createRequest("user.role.set", { userId: "player-1", role: 3 }));
    expect(again.result).toMatchObject({ changed: false, previousRole: 3 });
  });

  it("reports a role change Foundry silently refused", async () => {
    users().get("player-1").update = vi.fn(async () => users().get("player-1"));

    const response = await router.route(createRequest("user.role.set", { userId: "player-1", role: 3 }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(response.error.details).toMatchObject({ requested: 3, stored: 1 });
  });

  it("maps Foundry's own refusal to a permission error", async () => {
    users().get("player-1").update = vi.fn(async () => {
      throw new Error("You are not authorized to perform this role change");
    });

    const response = await router.route(createRequest("user.role.set", { userId: "player-1", role: 3 }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(response.error.details.message).toContain("not authorized");
  });

  it("grants, revokes and clears a permission override and reports the effective map", async () => {
    const granted = await router.route(
      createRequest("user.permissions.set", {
        userId: "player-1",
        permissions: { MACRO_SCRIPT: false, TOKEN_CREATE: true }
      })
    );

    expect(granted.ok).toBe(true);
    expect(granted.result.overrides).toEqual({
      FILES_UPLOAD: true,
      MACRO_SCRIPT: false,
      TOKEN_CREATE: true
    });
    expect(granted.result.permissions).toMatchObject({
      MACRO_SCRIPT: false,
      TOKEN_CREATE: true,
      ACTOR_CREATE: false
    });
    expect(granted.result.role).toBe(1);

    const cleared = await router.route(
      createRequest("user.permissions.set", { userId: "player-1", permissions: { MACRO_SCRIPT: null } })
    );

    expect(cleared.ok).toBe(true);
    expect(cleared.result.overrides).toEqual({ FILES_UPLOAD: true, TOKEN_CREATE: true });
    expect(cleared.result.permissions.MACRO_SCRIPT).toBe(true);
  });

  it("previews a permission write without changing the stored overrides", async () => {
    const response = await router.route(
      createRequest("user.permissions.set", {
        userId: "player-1",
        permissions: { ACTOR_CREATE: true },
        dryRun: true
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({ dryRun: true, requested: { ACTOR_CREATE: true } });
    expect(response.result.overrides).toEqual({ FILES_UPLOAD: true });
    expect(users().get("player-1").permissions).toEqual({ FILES_UPLOAD: true });
  });

  it("refuses a permission name this Foundry version does not define", async () => {
    const response = await router.route(
      createRequest("user.permissions.set", { userId: "player-1", permissions: { FLY_ANYWHERE: true } })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.details.unknown).toEqual(["FLY_ANYWHERE"]);
    expect(response.error.details.known).toContain("MACRO_SCRIPT");
  });

  it("refuses a role Foundry does not let a user hold", async () => {
    globalThis.CONST.USER_ROLES = { NONE: 0, PLAYER: 1, GAMEMASTER: 4 };

    const response = await router.route(createRequest("user.role.set", { userId: "player-1", role: 3 }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.details.assignable).toEqual({ PLAYER: 1, GAMEMASTER: 4 });
  });

  it("reports an unknown user for every write", async () => {
    /** @type {Array<{ command: string, params: any }>} */
    const writes = [
      { command: "user.update", params: { userId: "ghost", patch: { pronouns: "they/them" } } },
      { command: "user.delete", params: { userId: "ghost" } },
      { command: "user.role.set", params: { userId: "ghost", role: 2 } },
      { command: "user.permissions.set", params: { userId: "ghost", permissions: { MACRO_SCRIPT: true } } }
    ];
    for (const { command, params } of writes) {
      const response = await router.route(createRequest(command, params));

      expect(response.ok, command).toBe(false);
      expect(response.error.code, command).toBe(ERROR_CODES.USER_NOT_FOUND);
    }
  });
});
