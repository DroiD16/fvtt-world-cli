import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";

import { WORLD_IMPORT_COMMANDS } from "../scripts/handlers/compendium-imports.js";

import { COMMAND_NAMES } from "../scripts/generated/protocol.js";

import {
  applyDocumentMerge,
  createRequest,
  installFakeFoundry,
  makeDocumentClass,
  mutateWorldSourceLikeCore,
  validateFilePathFieldPreview
} from "./helpers/fake-foundry.js";

describe("command router", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  it("lists, indexes, and reads compendium packs", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("compendium.list"));
    expect(listResponse.ok).toBe(true);
    const actorsPack = listResponse.result.packs.find((p) => p.id === "world.test-monsters");
    expect(actorsPack).toMatchObject({ label: "Test Monsters", type: "Actor" });

    const indexResponse = await router.route(
      createRequest("compendium.index", { pack: "world.test-monsters" })
    );
    expect(indexResponse.ok).toBe(true);
    expect(indexResponse.result.entries).toEqual([
      { id: "arch1", _id: "arch1", name: "Archmage", type: "npc", img: "compendium/archmage.png" }
    ]);

    const getResponse = await router.route(
      createRequest("compendium.get", { pack: "world.test-monsters", entryId: "arch1" })
    );
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.documentName).toBe("Actor");
    expect(getResponse.result.document.name).toBe("Archmage");
    expect(getResponse.result.document.items).toHaveLength(2);

    expect(getResponse.result).not.toHaveProperty("effects");
  });

  it("adds a serialized top-level effects array with include:['effects'] (raw document unchanged)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("compendium.get", { pack: "world.test-monsters", entryId: "arch1", include: ["effects"] })
    );
    expect(response.ok).toBe(true);

    expect(response.result.document.effects).toHaveLength(1);

    expect(response.result.effects).toHaveLength(1);
    expect(response.result.effects[0]).toMatchObject({
      id: "arch-eff-1",
      name: "Archmage Aura",
      changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "2" }]
    });

    expect(response.result.effects.map((e) => e.id)).not.toContain("nested-item-eff");
  });

  it("returns effects: [] with include:['effects'] on an entry whose source has no effects collection", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("compendium.get", { pack: "world.test-items", entryId: "it1", include: ["effects"] })
    );
    expect(response.ok).toBe(true);
    expect(response.result.effects).toEqual([]);
  });

  it("returns stable errors for missing compendium packs and entries", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const missingPack = await router.route(createRequest("compendium.index", { pack: "world.nope" }));
    expect(missingPack.ok).toBe(false);
    expect(missingPack.error.code).toBe("COMPENDIUM_NOT_FOUND");

    expect(missingPack.error.message).toContain("compendium.list");
    expect(missingPack.error.details.pack).toBe("world.nope");

    const missingEntry = await router.route(
      createRequest("compendium.get", { pack: "world.test-monsters", entryId: "ghost" })
    );
    expect(missingEntry.ok).toBe(false);
    expect(missingEntry.error.code).toBe("COMPENDIUM_ENTRY_NOT_FOUND");
    expect(missingEntry.error.message).toContain("compendium.index");
    expect(missingEntry.error.details).toMatchObject({ pack: "world.test-monsters", entryId: "ghost" });
  });

  it("imports an actor from a compendium with source link and overrides", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("actor.import-from-compendium", {
        pack: "world.test-monsters",
        entryId: "arch1",
        folder: "folder-actors-test",
        patch: {
          img: "compendium/dragon.png",
          prototypeToken: { texture: { src: "compendium/dragon-token.webp" } }
        }
      })
    );

    expect(response.ok).toBe(true);
    const a = response.result.actor;

    expect(a.id).toBe("actor-created");
    expect(a._id).toBe("actor-created");

    expect(a.items.map((i) => i.name)).toEqual(["Fireball", "Magic Resistance"]);
    expect(a.compendiumSource).toBe("Compendium.world.test-monsters.Actor.arch1");

    expect(a.img).toBe("compendium/dragon.png");
    expect(a.prototypeToken.texture.src).toBe("compendium/dragon-token.webp");

    expect(a.prototypeToken.name).toBe("Archmage");
    expect(a.prototypeToken.actorLink).toBe(false);

    expect(globalThis.game.actors.importFromCompendium).not.toHaveBeenCalled();

    expect(globalThis.game.actors.fromCompendium).toHaveBeenCalledWith(
      expect.objectContaining({ documentName: "Actor" }),
      { keepId: false, clearFolder: true, clearOwnership: true }
    );

    const created = globalThis.Actor.create.mock.calls.at(-1)[0];
    expect(created.folder).toBe("folder-actors-test");
    expect(created._id).toBeUndefined();
    expect(created._stats.compendiumSource).toBe("Compendium.world.test-monsters.Actor.arch1");

    expect(created.sort).toBeUndefined();
  });

  it("clears the pack entry's own folder so an import cannot land on a dangling compendium folder", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("actor.import-from-compendium", { pack: "world.test-monsters", entryId: "arch1" })
    );

    expect(response.ok).toBe(true);
    expect(response.result.actor.folder).toBeNull();
    const created = globalThis.Actor.create.mock.calls.at(-1)[0];
    expect(created.folder).toBeUndefined();
  });

  it("forces keepId:false so a repeated import mints a fresh id (no silent replace)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    await router.route(
      createRequest("actor.import-from-compendium", { pack: "world.test-monsters", entryId: "arch1" })
    );

    const options = globalThis.game.actors.fromCompendium.mock.calls.at(-1)[1];
    expect(options).toMatchObject({ keepId: false });

    expect(globalThis.Actor.create.mock.calls.at(-1)[0]._id).toBeUndefined();
  });

  it("rejects a patch carrying protected meta at the PROTOCOL layer (the closed import patch)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    for (const patch of [
      { _stats: { compendiumSource: "Compendium.fake.Actor.spoof" } },
      { _id: "evil" },
      { ownership: { default: 3 } },

      { madeUpField: 1 }
    ]) {
      const response = await router.route(
        createRequest("actor.import-from-compendium", {
          pack: "world.test-monsters",
          entryId: "arch1",
          patch
        })
      );
      expect(response.ok, JSON.stringify(patch)).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
    }

    expect(globalThis.Actor.create).not.toHaveBeenCalled();

    const ok = await router.route(
      createRequest("actor.import-from-compendium", {
        pack: "world.test-monsters",
        entryId: "arch1",
        patch: { name: "Renamed Archmage" }
      })
    );
    expect(ok.ok).toBe(true);
    expect(ok.result.actor.name).toBe("Renamed Archmage");
    expect(ok.result.actor.compendiumSource).toBe("Compendium.world.test-monsters.Actor.arch1");
  });

  it("rejects importing from a non-Actor compendium with INVALID_PARAMS", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("actor.import-from-compendium", { pack: "world.test-items", entryId: "it1" })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
  });

  const WORLD_IMPORT_FIXTURES = {
    "actor.import-from-compendium": {
      resultKey: "actor",
      pack: "world.test-monsters",
      entryId: "arch1",
      createSpy: () => globalThis.Actor.create,
      collection: () => globalThis.game.actors,
      foundryRejectedPatch: { img: "notes.txt" }
    },
    "item.import-from-compendium": {
      resultKey: "item",
      pack: "world.test-items",
      entryId: "it-full",
      createSpy: () => globalThis.Item.create,
      collection: () => globalThis.game.items,
      foundryRejectedPatch: { img: "notes.txt" }
    },
    "journal.import-from-compendium": {
      resultKey: "journal",
      pack: "world.test-journals",
      entryId: "jrn-src",
      createSpy: () => globalThis.JournalEntry.create,
      collection: () => globalThis.game.journal
    },
    "scene.import-from-compendium": {
      resultKey: "scene",
      pack: "world.test-scene-pack",
      entryId: "scn-src",
      createSpy: () => globalThis.Scene.create,
      collection: () => globalThis.game.scenes,

      folderReadable: false,
      patchFolderSupported: false,

      foundryRejectedPatch: { thumb: "notes.txt" }
    },
    "macro.import-from-compendium": {
      resultKey: "macro",
      pack: "world.test-macro-pack",
      entryId: "mac-src",
      createSpy: () => globalThis.Macro.create,
      collection: () => globalThis.game.macros,
      foundryRejectedPatch: { img: "notes.txt" }
    },
    "playlist.import-from-compendium": {
      resultKey: "playlist",
      pack: "world.test-playlist-pack",
      entryId: "pls-src",
      createSpy: () => globalThis.Playlist.create,
      collection: () => globalThis.game.playlists
    },
    "table.import-from-compendium": {
      resultKey: "table",
      pack: "world.test-table-pack",
      entryId: "tbl-src",
      createSpy: () => globalThis.RollTable.create,
      collection: () => globalThis.game.tables,
      foundryRejectedPatch: { img: "notes.txt" }
    },
    "cards.import-from-compendium": {
      resultKey: "cards",
      pack: "world.test-cards-pack",
      entryId: "crd-src",
      createSpy: () => globalThis.Cards.create,
      collection: () => globalThis.game.cards,
      foundryRejectedPatch: { img: "notes.txt" }
    }
  };

  const worldImportCommands = () =>
    COMMAND_NAMES.filter(
      (name) => name.endsWith(".import-from-compendium") && name !== "actor.item.import-from-compendium"
    );

  it("covers EVERY protocol *.import-from-compendium world verb with a handler AND a fixture (derived)", () => {
    const derived = worldImportCommands().sort();

    expect(
      [...WORLD_IMPORT_COMMANDS].sort(),
      "a world import verb exists in the protocol with no handler (or vice versa): update IMPORT_FAMILIES in handlers/compendium-imports.js"
    ).toEqual(derived);

    expect(
      Object.keys(WORLD_IMPORT_FIXTURES).sort(),
      "a world import verb has no fixture in this suite: add a pack + entry to WORLD_IMPORT_FIXTURES"
    ).toEqual(derived);

    expect(WORLD_IMPORT_COMMANDS).not.toContain("actor.item.import-from-compendium");
  });

  const worldImportModelableRejections = () =>
    Object.keys(WORLD_IMPORT_FIXTURES)
      .filter((command) => WORLD_IMPORT_FIXTURES[command].foundryRejectedPatch)
      .sort();

  it("names the import families whose Foundry rejection is modelable here — and the two that are not", () => {
    expect(worldImportModelableRejections()).toEqual([
      "actor.import-from-compendium",
      "cards.import-from-compendium",
      "item.import-from-compendium",
      "macro.import-from-compendium",
      "scene.import-from-compendium",
      "table.import-from-compendium"
    ]);

    expect(
      Object.keys(WORLD_IMPORT_FIXTURES).filter(
        (command) => !WORLD_IMPORT_FIXTURES[command].foundryRejectedPatch
      )
    ).toEqual(["journal.import-from-compendium", "playlist.import-from-compendium"]);
  });

  it.each(worldImportModelableRejections())(
    "%s answers the SAME argument error on the real path as on the dry run (one construction, both paths)",
    async (command) => {
      const fixture = WORLD_IMPORT_FIXTURES[command];
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const params = { pack: fixture.pack, entryId: fixture.entryId, patch: fixture.foundryRejectedPatch };
      const field = Object.keys(fixture.foundryRejectedPatch)[0];

      for (const extra of [{ dryRun: true }, {}]) {
        const mode = extra.dryRun ? "dry run" : "real call";
        const response = await router.route(createRequest(command, { ...params, ...extra }));
        expect(
          response.ok,
          `${mode} should have been refused: ${JSON.stringify(response.result ?? null)}`
        ).toBe(false);

        expect(response.error.code, mode).toBe("INVALID_PARAMS");
        expect(response.error.details.reason, mode).toBe("foundry_validation");

        expect(response.error.details.message, mode).toContain(
          `${field}: does not have a valid file extension`
        );

        expect(response.error.details.errors, mode).toContain(field);
        expect(fixture.createSpy(), mode).not.toHaveBeenCalled();
      }

      const ok = await router.route(
        createRequest(command, {
          pack: fixture.pack,
          entryId: fixture.entryId,
          patch: { [field]: "art/ok.webp" }
        })
      );
      expect(ok.ok, JSON.stringify(ok.error ?? null)).toBe(true);
      expect(fixture.createSpy().mock.calls.at(-1)[0][field]).toBe("art/ok.webp");
    }
  );

  it("a nested patch DEEP-merges into the pack entry's system block instead of replacing it", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("item.import-from-compendium", {
        pack: "world.test-items",
        entryId: "it-full",
        patch: { system: { quantity: 2 } }
      })
    );

    expect(response.ok, JSON.stringify(response.error ?? null)).toBe(true);

    expect(response.result.item.system.quantity).toBe(2);

    expect(response.result.item.system.damage).toBe("1d8");

    const created = globalThis.Item.create.mock.calls.at(-1)[0];
    expect(created.system).toEqual({ damage: "1d8", quantity: 2 });

    expect(created.flags).toEqual({ mymod: { forged: true } });
  });

  it.each(Object.keys(WORLD_IMPORT_FIXTURES))(
    "%s imports the pack entry, preserves provenance, mints a fresh id and clears the pack folder/sort",
    async (command) => {
      const fixture = WORLD_IMPORT_FIXTURES[command];
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const response = await router.route(
        createRequest(command, { pack: fixture.pack, entryId: fixture.entryId })
      );

      expect(response.ok, JSON.stringify(response.error ?? null)).toBe(true);
      const document = response.result[fixture.resultKey];

      expect(document).toBeDefined();
      expect(document.id).toBeTruthy();
      expect(document._id).toBe(document.id);

      expect(document.compendiumSource).toBe(
        `Compendium.${fixture.pack}.${
          command === "journal.import-from-compendium"
            ? "JournalEntry"
            : command === "table.import-from-compendium"
              ? "RollTable"
              : command.split(".")[0].replace(/^./, (c) => c.toUpperCase())
        }.${fixture.entryId}`
      );
      expect(document._stats, "raw _stats must never be exposed").toBeUndefined();

      expect(fixture.collection().fromCompendium).toHaveBeenCalledWith(expect.anything(), {
        keepId: false,
        clearFolder: true,
        clearOwnership: true
      });

      const created = fixture.createSpy().mock.calls.at(-1)[0];
      expect(created._id).toBeUndefined();
      expect(created.folder).toBeUndefined();
      expect(created.sort).toBeUndefined();
      expect(created._stats.compendiumSource).toBe(document.compendiumSource);
    }
  );

  it.each(Object.keys(WORLD_IMPORT_FIXTURES))(
    "%s applies the folder param and the patch, and a dry run previews the REAL merge with a null id",
    async (command) => {
      const fixture = WORLD_IMPORT_FIXTURES[command];
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const folderId = "folder-items-test";

      const preview = await router.route(
        createRequest(command, {
          pack: fixture.pack,
          entryId: fixture.entryId,
          folder: folderId,
          patch: { name: "Renamed By Patch" },
          dryRun: true
        })
      );
      expect(preview.ok, JSON.stringify(preview.error ?? null)).toBe(true);
      expect(preview.result.dryRun).toBe(true);
      const previewDoc = preview.result[fixture.resultKey];
      expect(previewDoc.id, "a dry run must never fabricate (or echo) an id").toBeNull();
      expect(previewDoc._id).toBeNull();
      expect(previewDoc.name).toBe("Renamed By Patch");
      if (fixture.folderReadable !== false) {
        expect(previewDoc.folder).toBe(folderId);
      }
      expect(previewDoc.compendiumSource).toBe(
        `Compendium.${fixture.pack}.${previewDoc.compendiumSource.split(".")[3]}.${fixture.entryId}`
      );

      expect(fixture.createSpy()).not.toHaveBeenCalled();

      const real = await router.route(
        createRequest(command, {
          pack: fixture.pack,
          entryId: fixture.entryId,
          folder: folderId,
          patch: { name: "Renamed By Patch" }
        })
      );
      expect(real.ok, JSON.stringify(real.error ?? null)).toBe(true);
      expect(real.result.dryRun).toBeUndefined();
      const realDoc = real.result[fixture.resultKey];
      expect(realDoc.id).toBeTruthy();
      expect(realDoc.name).toBe("Renamed By Patch");
      if (fixture.folderReadable !== false) {
        expect(realDoc.folder).toBe(folderId);
      }

      expect(fixture.createSpy().mock.calls.at(-1)[0].folder).toBe(folderId);
      expect(Object.keys(previewDoc).sort()).toEqual(
        Object.keys(realDoc)
          .filter((key) => key !== "counts")
          .sort()
      );
    }
  );

  it.each(Object.keys(WORLD_IMPORT_FIXTURES))(
    "%s refuses a destination folder supplied through BOTH channels, BEFORE resolving the pack",
    async (command) => {
      const fixture = WORLD_IMPORT_FIXTURES[command];
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      for (const extra of [{}, { dryRun: true }]) {
        const response = await router.route(
          createRequest(command, {
            pack: fixture.pack,
            entryId: fixture.entryId,
            folder: "folder-items-test",
            patch: { folder: "folder-actors-test" },
            ...extra
          })
        );
        const mode = extra.dryRun ? "dry run" : "real call";
        expect(response.ok, `${mode} should have been refused`).toBe(false);
        expect(response.error.code, mode).toBe("INVALID_PARAMS");
        if (fixture.patchFolderSupported === false) {
          expect(response.error.message).toMatch(/Invalid params/);
        } else {
          expect(response.error.message).toMatch(/BOTH channels/);
          expect(response.error.details).toMatchObject({
            folder: "folder-items-test",
            patchFolder: "folder-actors-test"
          });
        }
        expect(fixture.createSpy()).not.toHaveBeenCalled();
      }

      const channels =
        fixture.patchFolderSupported === false
          ? [{ folder: "folder-items-test" }]
          : [{ folder: "folder-items-test" }, { patch: { folder: "folder-items-test" } }];
      for (const params of channels) {
        const ok = await router.route(
          createRequest(command, { pack: fixture.pack, entryId: fixture.entryId, ...params })
        );
        expect(ok.ok, JSON.stringify(ok.error ?? null)).toBe(true);
        expect(fixture.createSpy().mock.calls.at(-1)[0].folder).toBe("folder-items-test");
      }
    }
  );

  it.each(Object.keys(WORLD_IMPORT_FIXTURES))(
    "%s reports COMPENDIUM_NOT_FOUND / COMPENDIUM_ENTRY_NOT_FOUND / a type mismatch without creating anything",
    async (command) => {
      const fixture = WORLD_IMPORT_FIXTURES[command];
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const wrongPack =
        command === "item.import-from-compendium" ? "world.test-monsters" : "world.test-items";

      for (const extra of [{}, { dryRun: true }]) {
        const mode = extra.dryRun ? "dry run" : "real call";

        const missingPack = await router.route(
          createRequest(command, { pack: "world.nope", entryId: fixture.entryId, ...extra })
        );
        expect(missingPack.ok, mode).toBe(false);
        expect(missingPack.error.code, mode).toBe("COMPENDIUM_NOT_FOUND");

        const missingEntry = await router.route(
          createRequest(command, { pack: fixture.pack, entryId: "no-such-entry", ...extra })
        );
        expect(missingEntry.ok, mode).toBe(false);
        expect(missingEntry.error.code, mode).toBe("COMPENDIUM_ENTRY_NOT_FOUND");

        const mismatch = await router.route(
          createRequest(command, { pack: wrongPack, entryId: "it1", ...extra })
        );
        expect(mismatch.ok, mode).toBe(false);
        expect(mismatch.error.code, mode).toBe("INVALID_PARAMS");

        expect(fixture.createSpy(), mode).not.toHaveBeenCalled();
      }
    }
  );

  it("reports a VETOED create as INTERNAL_ERROR, never an ok:true body (the confirmed create seam)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const realClass = globalThis.game.items.documentClass;
    const vetoed = vi.fn(async () => undefined);

    globalThis.game.items.documentClass = makeDocumentClass({
      validatePreview: (source) => validateFilePathFieldPreview(source, "img"),
      mutateSource: mutateWorldSourceLikeCore,
      create: vetoed
    });
    try {
      const response = await router.route(
        createRequest("item.import-from-compendium", { pack: "world.test-items", entryId: "it-full" })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INTERNAL_ERROR");

      expect(vetoed).toHaveBeenCalledTimes(1);
      expect(response.result).toBeUndefined();
    } finally {
      globalThis.game.items.documentClass = realClass;
    }

    const previewRouter = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });
    const preview = await previewRouter.route(
      createRequest("item.import-from-compendium", {
        pack: "world.test-items",
        entryId: "it-full",
        dryRun: true
      })
    );
    expect(preview.ok).toBe(true);
    expect(preview.result.dryRun).toBe(true);
  });

  it("preserves the Foundry-generated compendiumSource independently of the merge step", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const realMerge = globalThis.foundry.utils.mergeObject;
    globalThis.foundry.utils.mergeObject = (base, patch, options) => {
      const { _stats, ...rest } = applyDocumentMerge(base, patch, options);
      return rest;
    };
    try {
      const response = await router.route(
        createRequest("item.import-from-compendium", {
          pack: "world.test-items",
          entryId: "it-full",
          patch: { name: "Merged Without Stats" }
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? null)).toBe(true);
      expect(response.result.item.name).toBe("Merged Without Stats");
      expect(response.result.item.compendiumSource).toBe("Compendium.world.test-items.Item.it-full");
    } finally {
      globalThis.foundry.utils.mergeObject = realMerge;
    }
  });

  it("the folder-channel conflict is decided BEFORE the pack lookup (guard order is contract)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("item.import-from-compendium", {
        pack: "world.does-not-exist",
        entryId: "nope",
        folder: null,
        patch: { folder: "folder-items-test" }
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.message).toMatch(/BOTH channels/);
    expect(response.error.code).not.toBe("COMPENDIUM_NOT_FOUND");

    const packOnly = await router.route(
      createRequest("item.import-from-compendium", { pack: "world.does-not-exist", entryId: "nope" })
    );
    expect(packOnly.ok).toBe(false);
    expect(packOnly.error.code).toBe("COMPENDIUM_NOT_FOUND");
  });

  it("macro.import-from-compendium resets the macro author to the GM (the raw-clearOwnership trap)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("macro.import-from-compendium", {
        pack: "world.test-macro-pack",
        entryId: "mac-src"
      })
    );

    expect(response.ok).toBe(true);

    const created = globalThis.Macro.create.mock.calls.at(-1)[0];
    expect(created.author).toBe(globalThis.game.user.id);
    expect(created.author).not.toBe("packauthor000001");

    expect(created.command).toBe("console.log('from the pack');");
  });

  it("scene.import-from-compendium clears activation/navigation and keeps the pack's own executable region behaviour", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.import-from-compendium", { pack: "world.test-scene-pack", entryId: "scn-src" })
    );

    expect(response.ok).toBe(true);
    const created = globalThis.Scene.create.mock.calls.at(-1)[0];

    expect(created.navigation).toBe(false);
    expect(created.navOrder).toBeUndefined();

    expect(created).toHaveProperty("active", false);

    expect(created.regions[0].behaviors[0].type).toBe("executeScript");
  });

  it("scene.import-from-compendium injects active:false on the SOURCE, so patch.active still wins", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.import-from-compendium", {
        pack: "world.test-scene-pack",
        entryId: "scn-src",
        patch: { active: true }
      })
    );

    expect(response.ok, JSON.stringify(response.error ?? null)).toBe(true);
    expect(globalThis.Scene.create.mock.calls.at(-1)[0].active).toBe(true);
  });

  it("cards.import-from-compendium nulls the preview's card ids and clears drawn (keepEmbeddedIds:false)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const preview = await router.route(
      createRequest("cards.import-from-compendium", {
        pack: "world.test-cards-pack",
        entryId: "crd-src",
        dryRun: true
      })
    );
    expect(preview.ok, JSON.stringify(preview.error ?? null)).toBe(true);
    expect(preview.result.dryRun).toBe(true);
    const previewCards = preview.result.cards.cards;
    expect(previewCards).toHaveLength(1);
    expect(previewCards[0].id, "a preview must not hand out a card id the create re-mints").toBeNull();
    expect(previewCards[0]._id).toBeNull();
    expect(previewCards[0].drawn, "_preCreate clears drawn on every card of a created stack").toBe(false);

    expect(previewCards[0].name).toBe("Ace");
    expect(previewCards[0].value).toBe(1);
    expect(globalThis.Cards.create).not.toHaveBeenCalled();

    const real = await router.route(
      createRequest("cards.import-from-compendium", { pack: "world.test-cards-pack", entryId: "crd-src" })
    );
    expect(real.ok, JSON.stringify(real.error ?? null)).toBe(true);
    const realCards = real.result.cards.cards;
    expect(realCards).toHaveLength(1);
    expect(realCards[0].id).toBeTruthy();
    expect(realCards[0].id, "the created card id is NOT the pack's").not.toBe("card-src");
    expect(realCards[0].drawn).toBe(false);

    expect(Object.keys(previewCards[0]).sort()).toEqual(Object.keys(realCards[0]).sort());
  });

  it("scene.import-from-compendium gates the v14 levels-relocated fields on the PATCH ONLY (supply-only)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const release = globalThis.game.release;
    globalThis.game.release = { generation: 14, version: "14.365" };
    try {
      for (const extra of [{}, { dryRun: true }]) {
        const mode = extra.dryRun ? "dry run" : "real call";
        const supplied = await router.route(
          createRequest("scene.import-from-compendium", {
            pack: "world.test-scene-pack",
            entryId: "scn-src",
            patch: { backgroundColor: "#ffffff" },
            ...extra
          })
        );
        expect(supplied.ok, mode).toBe(false);
        expect(supplied.error.code, mode).toBe("UNSUPPORTED_OPERATION");
        expect(supplied.error.details, mode).toMatchObject({ family: "scene", fields: ["backgroundColor"] });
        expect(globalThis.Scene.create, mode).not.toHaveBeenCalled();
      }

      const notSupplied = await router.route(
        createRequest("scene.import-from-compendium", {
          pack: "world.test-scene-pack",
          entryId: "scn-src",
          patch: { name: "Temple (v14)" }
        })
      );
      expect(notSupplied.ok, JSON.stringify(notSupplied.error ?? null)).toBe(true);
      expect(globalThis.Scene.create.mock.calls.at(-1)[0].backgroundColor).toBe("#101010");
    } finally {
      globalThis.game.release = release;
    }
  });

  it("no world import verb enters a family mutation queue (DERIVED from the sources, not probed)", () => {
    const importHandlerSource = readFileSync(
      new URL("../scripts/handlers/compendium-imports.js", import.meta.url),
      "utf8"
    );
    expect(importHandlerSource).not.toMatch(/createMutationQueue/);
    expect(importHandlerSource).not.toMatch(/Queue\.run\(/);

    const derived = worldImportCommands();
    expect(derived.length).toBeGreaterThan(0);
    for (const file of ["cards.js", "tables.js", "combats.js", "folders.js"]) {
      const source = readFileSync(new URL(`../scripts/handlers/${file}`, import.meta.url), "utf8");
      for (const command of derived) {
        expect(
          new RegExp(`"${command.replace(/\./g, "\\.")}"\\s*[(:]`).test(source),
          `${file} must not define a handler for ${command} (it would inherit that file's mutation queue)`
        ).toBe(false);
      }
    }

    const cardsSource = readFileSync(new URL("../scripts/handlers/cards.js", import.meta.url), "utf8");
    expect(/"cards\.delete"\s*[(:]/.test(cardsSource)).toBe(true);
  });

  it("two imports run concurrently without either being refused", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const [a, b] = await Promise.all([
      router.route(
        createRequest("table.import-from-compendium", { pack: "world.test-table-pack", entryId: "tbl-src" })
      ),
      router.route(
        createRequest("cards.import-from-compendium", { pack: "world.test-cards-pack", entryId: "crd-src" })
      )
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it("imports a compendium item onto an actor intact with a fresh id and applied override", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("actor.item.import-from-compendium", {
        actorId: "actor-1",
        pack: "world.test-items",
        entryId: "it-full",
        patch: { img: "compendium/longsword.png" },
        include: ["flags", "effects"]
      })
    );

    expect(response.ok).toBe(true);
    const item = response.result.item;

    expect(item.id).toBeTruthy();
    expect(item.id).not.toBe("it-full");

    expect(item.system).toEqual({ damage: "1d8" });
    expect(item.flags).toEqual({ mymod: { forged: true } });
    expect(item.effects.map((e) => e.name)).toEqual(["Sharpened"]);

    expect(item.img).toBe("compendium/longsword.png");

    expect(globalThis.game.items.fromCompendium).toHaveBeenCalledWith(
      expect.objectContaining({ documentName: "Item" }),
      { keepId: false, clearFolder: true, clearOwnership: true }
    );

    expect(item.folder).toBeNull();

    expect(item.compendiumSource).toBe("Compendium.world.test-items.Item.it-full");
  });

  it("ALWAYS surfaces flags + effects on the imported item (complete-get contract)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const result = await router.route(
      createRequest("actor.item.import-from-compendium", {
        actorId: "actor-1",
        pack: "world.test-items",
        entryId: "it-full"
      })
    );
    expect(result.ok).toBe(true);

    expect(result.result.item.flags).toEqual({ mymod: { forged: true } });
    expect(Array.isArray(result.result.item.effects)).toBe(true);
  });

  it("rejects importing an item from a non-Item compendium with INVALID_PARAMS", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("actor.item.import-from-compendium", {
        actorId: "actor-1",
        pack: "world.test-monsters",
        entryId: "arch1"
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
  });

  it("returns COMPENDIUM_ENTRY_NOT_FOUND for a missing item import entry", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("actor.item.import-from-compendium", {
        actorId: "actor-1",
        pack: "world.test-items",
        entryId: "nope"
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("COMPENDIUM_ENTRY_NOT_FOUND");
  });

  it("returns ACTOR_NOT_FOUND when importing onto a missing actor", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("actor.item.import-from-compendium", {
        actorId: "missing-actor",
        pack: "world.test-items",
        entryId: "it-full"
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("ACTOR_NOT_FOUND");
  });

  it("dry-run item import returns a preview and persists nothing", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const actor = globalThis.game.actors.get("actor-1");

    const response = await router.route(
      createRequest("actor.item.import-from-compendium", {
        actorId: "actor-1",
        pack: "world.test-items",
        entryId: "it-full",
        dryRun: true
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.dryRun).toBe(true);

    expect(response.result.item).toBeTruthy();
    expect(response.result).not.toHaveProperty("preview");
    const itemCreate = actor.createEmbeddedDocuments.mock.calls.find(([type]) => type === "Item");
    expect(itemCreate).toBeUndefined();
  });
});
