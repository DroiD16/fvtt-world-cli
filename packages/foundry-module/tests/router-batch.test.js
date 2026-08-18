import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";

import { buildTokenDataFromActor } from "../scripts/lib/scene-embedded.js";

import { COMMAND_NAMES, ERROR_CODES } from "../scripts/generated/protocol.js";

import {
  createActorDocument,
  createDocument,
  createJournalDocument,
  createPlaylistDocument,
  createRequest,
  createTableDocument,
  installFakeFoundry,
  makeDataModelValidationError
} from "./helpers/fake-foundry.js";

describe("command router", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  describe("batched reads (*.get-many, atomic + order-preserving)", () => {
    it("actor.get-many returns an order-preserving array; missing id fails the whole batch (atomic)", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      globalThis.game.actors.set(
        createActorDocument("actor-2", { name: "Ezren", flags: { school: { arcane: true } } })
      );

      const ok = await router.route(createRequest("actor.get-many", { ids: ["actor-2", "actor-1"] }));
      expect(ok.ok).toBe(true);
      expect(ok.result.actors.map((a) => a.id)).toEqual(["actor-2", "actor-1"]);

      const missing = await router.route(
        createRequest("actor.get-many", { ids: ["actor-1", "does-not-exist"] })
      );
      expect(missing.ok).toBe(false);
      expect(missing.error.code).toBe("ACTOR_NOT_FOUND");
      expect(missing.error.message).toContain("does-not-exist");
      expect(missing.result).toBeUndefined();
    });

    it("actor.get-many returns COMPLETE authored state (own flags + effects always present)", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const result = await router.route(createRequest("actor.get-many", { ids: ["actor-1"] }));
      expect(result.result.actors[0].flags).toEqual({ ActiveAuras: { radius: 10 } });
      expect(Array.isArray(result.result.actors[0].effects)).toBe(true);
    });

    it("actor.get-many rejects an over-cap batch with INVALID_PARAMS (details.max/received)", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const ids = Array.from({ length: 101 }, (_, index) => `id-${index}`);

      const response = await router.route(createRequest("actor.get-many", { ids }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.details).toMatchObject({ max: 100, received: 101 });
    });

    it("item.get-many returns an order-preserving array, honors include, and is atomic", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      globalThis.game.items.set(
        createDocument("item-2", { name: "Dagger", type: "weapon", flags: { x: { y: 1 } } })
      );

      const ok = await router.route(createRequest("item.get-many", { ids: ["item-2", "item-1"] }));
      expect(ok.ok).toBe(true);
      expect(ok.result.items.map((i) => i.id)).toEqual(["item-2", "item-1"]);

      expect(ok.result.items[0].flags).toEqual({ x: { y: 1 } });
      expect(Array.isArray(ok.result.items[0].effects)).toBe(true);

      const missing = await router.route(createRequest("item.get-many", { ids: ["item-1", "nope"] }));
      expect(missing.ok).toBe(false);
      expect(missing.error.code).toBe("ITEM_NOT_FOUND");
      expect(missing.error.message).toContain("nope");
    });

    it("journal.get-many and scene.get-many return order-preserving arrays and are atomic", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      globalThis.game.journal.set(createJournalDocument("journal-2", { name: "Secrets", pages: [] }));

      const journals = await router.route(
        createRequest("journal.get-many", { ids: ["journal-2", "journal-1"] })
      );
      expect(journals.ok).toBe(true);
      expect(journals.result.journals.map((j) => j.id)).toEqual(["journal-2", "journal-1"]);

      const journalMissing = await router.route(
        createRequest("journal.get-many", { ids: ["journal-1", "ghost"] })
      );
      expect(journalMissing.ok).toBe(false);
      expect(journalMissing.error.code).toBe("JOURNAL_NOT_FOUND");
      expect(journalMissing.error.message).toContain("ghost");

      const scenes = await router.route(createRequest("scene.get-many", { ids: ["scene-2", "scene-1"] }));
      expect(scenes.ok).toBe(true);
      expect(scenes.result.scenes.map((s) => s.id)).toEqual(["scene-2", "scene-1"]);

      const sceneMissing = await router.route(
        createRequest("scene.get-many", { ids: ["scene-1", "nowhere"] })
      );
      expect(sceneMissing.ok).toBe(false);
      expect(sceneMissing.error.code).toBe("SCENE_NOT_FOUND");
      expect(sceneMissing.error.message).toContain("nowhere");
    });

    it("macro.get-many is order-preserving, atomic, cap-enforced, and carries ownership", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      globalThis.game.macros.set(createDocument("macro-2", { name: "Damage", type: "script", command: "1" }));

      const ok = await router.route(createRequest("macro.get-many", { ids: ["macro-2", "macro-1"] }));
      expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
      expect(ok.result.macros.map((m) => m.id)).toEqual(["macro-2", "macro-1"]);

      expect(ok.result.macros[0].ownership).toBeDefined();

      const missing = await router.route(
        createRequest("macro.get-many", { ids: ["macro-1", "ghost-macro"] })
      );
      expect(missing.ok).toBe(false);
      expect(missing.error.code).toBe("MACRO_NOT_FOUND");
      expect(missing.error.message).toContain("ghost-macro");
      expect(missing.result).toBeUndefined();

      const overCap = await router.route(
        createRequest("macro.get-many", { ids: Array.from({ length: 101 }, (_, i) => `m-${i}`) })
      );
      expect(overCap.ok).toBe(false);
      expect(overCap.error.code).toBe("INVALID_PARAMS");
      expect(overCap.error.details).toMatchObject({ max: 100, received: 101 });
    });

    it("playlist.get-many is order-preserving, atomic, cap-enforced, and carries ownership", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      globalThis.game.playlists.set(
        createPlaylistDocument("playlist-2", { name: "Combat", mode: 0, sounds: [] })
      );

      const ok = await router.route(
        createRequest("playlist.get-many", { ids: ["playlist-2", "playlist-1"] })
      );
      expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
      expect(ok.result.playlists.map((p) => p.id)).toEqual(["playlist-2", "playlist-1"]);
      expect(ok.result.playlists[0].ownership).toBeDefined();

      const missing = await router.route(
        createRequest("playlist.get-many", { ids: ["playlist-1", "ghost-pl"] })
      );
      expect(missing.ok).toBe(false);
      expect(missing.error.code).toBe("PLAYLIST_NOT_FOUND");
      expect(missing.error.message).toContain("ghost-pl");
      expect(missing.result).toBeUndefined();

      const overCap = await router.route(
        createRequest("playlist.get-many", { ids: Array.from({ length: 101 }, (_, i) => `p-${i}`) })
      );
      expect(overCap.ok).toBe(false);
      expect(overCap.error.code).toBe("INVALID_PARAMS");
      expect(overCap.error.details).toMatchObject({ max: 100, received: 101 });
    });

    it("table.get-many is order-preserving, atomic, cap-enforced, and carries ownership", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      globalThis.game.tables.set(
        createTableDocument("table-2", {
          name: "Rumors",
          formula: "1d4",
          results: [{ id: "rumor-1", name: "Whisper", range: [1, 4] }]
        })
      );

      const ok = await router.route(createRequest("table.get-many", { ids: ["table-2", "table-1"] }));
      expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
      expect(ok.result.tables.map((t) => t.id)).toEqual(["table-2", "table-1"]);

      expect(ok.result.tables[0].ownership).toBeDefined();
      expect(ok.result.tables[1].results).toHaveLength(2);

      const missing = await router.route(
        createRequest("table.get-many", { ids: ["table-1", "ghost-table"] })
      );
      expect(missing.ok).toBe(false);
      expect(missing.error.code).toBe("TABLE_NOT_FOUND");
      expect(missing.error.message).toContain("ghost-table");
      expect(missing.result).toBeUndefined();

      const overCap = await router.route(
        createRequest("table.get-many", { ids: Array.from({ length: 101 }, (_, i) => `t-${i}`) })
      );
      expect(overCap.ok).toBe(false);
      expect(overCap.error.code).toBe("INVALID_PARAMS");
      expect(overCap.error.details).toMatchObject({ max: 100, received: 101 });
    });
  });

  const declaredBatchCreateFamilies = () =>
    COMMAND_NAMES.filter((name) => name.endsWith(".create-many"))
      .map((name) => name.slice(0, -".create-many".length))
      .sort();

  const EFFECT_BATCH_FAMILIES = [
    "actor.effect",
    "item.effect",
    "actor.item.effect",
    "scene.token.effect",
    "scene.token.item.effect"
  ].sort();

  const declaredPlaceableBatchFamilies = () =>
    declaredBatchCreateFamilies().filter((family) => !EFFECT_BATCH_FAMILIES.includes(family));

  const declaredWorldBatchFamilies = () =>
    COMMAND_NAMES.filter((name) => name.endsWith(".update-many"))
      .map((name) => name.slice(0, -".update-many".length))
      .filter((family) => !declaredBatchCreateFamilies().includes(family))
      .sort();

  const allDeclaredBatchFamilies = () =>
    [...declaredBatchCreateFamilies(), ...declaredWorldBatchFamilies()].sort();

  const BATCH_FAMILY_FIXTURES = {
    "scene.tile": {
      type: "Tile",
      collection: (scene) => scene.tiles,
      existingId: "tile-a",
      idField: "tileId",
      getKey: "tile",

      summarized: false,
      create: [
        { x: 10, y: 20 },
        { x: 30, y: 40, hidden: true }
      ],
      patch: { x: 999 },
      readPatched: (doc) => doc.x,
      patchedValue: 999,
      notFound: "TILE_NOT_FOUND"
    },
    "scene.sound": {
      type: "AmbientSound",
      collection: (scene) => scene.sounds,
      existingId: "sound-a",
      idField: "soundId",
      getKey: "sound",
      summarized: false,
      create: [{ path: "sounds/a.ogg" }, { path: "sounds/b.ogg", volume: 0.2 }],
      patch: { volume: 0.9 },
      readPatched: (doc) => doc.volume,
      patchedValue: 0.9,
      notFound: "SOUND_NOT_FOUND"
    },
    "scene.note": {
      type: "Note",
      collection: (scene) => scene.notes,
      existingId: "note-quest",
      idField: "noteId",
      getKey: "note",
      summarized: false,
      create: [
        { x: 1, y: 2, text: "A" },
        { x: 3, y: 4, text: "B" }
      ],
      patch: { text: "Renamed" },
      readPatched: (doc) => doc.text,
      patchedValue: "Renamed",
      notFound: "NOTE_NOT_FOUND"
    },
    "scene.token": {
      type: "Token",
      collection: (scene) => scene.tokens,
      existingId: "token-a",
      idField: "tokenId",
      getKey: "token",
      summarized: true,
      create: [
        { name: "Trap Marker", x: 5, y: 5 },
        { actorId: "actor-1", x: 200, y: 240 }
      ],
      patch: { x: 777 },
      readPatched: (doc) => doc.x,
      patchedValue: 777,
      notFound: "TOKEN_NOT_FOUND"
    },

    "scene.drawing": {
      type: "Drawing",
      collection: (scene) => scene.drawings,
      existingId: "drawing-rect",
      idField: "drawingId",
      getKey: "drawing",

      summarized: true,
      create: [
        { shape: { type: "r", width: 20, height: 20 }, x: 10, y: 20 },
        { shape: { type: "r", width: 30, height: 30 }, x: 30, y: 40, text: "B" }
      ],
      patch: { x: 999 },
      readPatched: (doc) => doc.x,
      patchedValue: 999,
      notFound: "DRAWING_NOT_FOUND"
    },
    "scene.light": {
      type: "AmbientLight",
      collection: (scene) => scene.lights,
      existingId: "light-torch",
      idField: "lightId",
      getKey: "light",
      summarized: true,
      create: [
        { x: 10, y: 20 },
        { x: 30, y: 40, walls: false }
      ],
      patch: { x: 999 },
      readPatched: (doc) => doc.x,
      patchedValue: 999,
      notFound: "LIGHT_NOT_FOUND"
    },

    "scene.template": {
      type: "MeasuredTemplate",
      collection: (scene) => scene.templates,
      existingId: "template-fireball",
      idField: "templateId",
      getKey: "template",
      summarized: false,
      create: [
        { t: "circle", x: 10, y: 20, distance: 5 },
        { t: "cone", x: 30, y: 40, distance: 10, direction: 90, angle: 53 }
      ],
      patch: { distance: 42 },
      readPatched: (doc) => doc.distance,
      patchedValue: 42,
      notFound: "TEMPLATE_NOT_FOUND"
    },
    "scene.region": {
      type: "Region",
      collection: (scene) => scene.regions,
      existingId: "region-lava",
      idField: "regionId",
      getKey: "region",
      summarized: true,
      create: [
        { name: "Bulk Zone A", shapes: [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }] },
        { name: "Bulk Zone B", shapes: [] }
      ],
      patch: { name: "Renamed Zone" },
      readPatched: (doc) => doc.name,
      patchedValue: "Renamed Zone",
      notFound: "REGION_NOT_FOUND"
    }
  };

  it("covers every batched placeable family the protocol declares with a fixture (derived)", () => {
    expect(declaredPlaceableBatchFamilies()).toEqual([
      "scene.drawing",
      "scene.light",
      "scene.note",
      "scene.region",
      "scene.sound",
      "scene.template",
      "scene.tile",
      "scene.token",
      "scene.wall"
    ]);
    expect(EFFECT_BATCH_FAMILIES).toEqual([
      "actor.effect",
      "actor.item.effect",
      "item.effect",
      "scene.token.effect",
      "scene.token.item.effect"
    ]);
    expect([...declaredPlaceableBatchFamilies(), ...EFFECT_BATCH_FAMILIES].sort()).toEqual(
      declaredBatchCreateFamilies()
    );

    expect(Object.keys(BATCH_FAMILY_FIXTURES).sort()).toEqual(
      declaredPlaceableBatchFamilies().filter((family) => family !== "scene.wall")
    );
  });

  const BATCH_NAME_PARITY_FIXTURES = {
    ...BATCH_FAMILY_FIXTURES,
    "scene.wall": {
      idField: "wallId",
      getKey: "wall",
      existingId: "wall-plain",
      create: [{ c: [10, 10, 20, 20] }],
      summarized: false
    }
  };

  const PLACEABLE_NAME_FIELD = {
    "scene.wall": { 13.351: false, 14.365: false },
    "scene.tile": { 13.351: false, 14.365: true },
    "scene.sound": { 13.351: false, 14.365: true },
    "scene.note": { 13.351: false, 14.365: false },
    "scene.token": { 13.351: true, 14.365: true },

    "scene.drawing": { 13.351: false, 14.365: true },
    "scene.light": { 13.351: false, 14.365: true },

    "scene.template": { 13.351: false, 14.365: null },
    "scene.region": { 13.351: true, 14.365: true },

    "actor.effect": { 13.351: true, 14.365: true },
    "item.effect": { 13.351: true, 14.365: true },
    "actor.item.effect": { 13.351: true, 14.365: true },
    "scene.token.effect": { 13.351: true, 14.365: true },
    "scene.token.item.effect": { 13.351: true, 14.365: true },

    item: { 13.351: true, 14.365: true },
    actor: { 13.351: true, 14.365: true },
    journal: { 13.351: true, 14.365: true }
  };

  const KNOWN_NAME_READ_GAPS = {
    "scene.tile":
      "v14-only `name` StringField; serializeTile emits no `name`, so `scene.tile.get`/`list` AND the batch outcome all omit it",
    "scene.sound":
      "v14-only `name` StringField; serializeSound emits no `name`, so `scene.sound.get`/`list` AND the batch outcome all omit it"
  };

  it("declares a per-version `name` field for every batched family, with every read gap listed (derived)", () => {
    const declared = allDeclaredBatchFamilies();

    expect(Object.keys(PLACEABLE_NAME_FIELD).sort()).toEqual(declared);
    expect(Object.keys(BATCH_NAME_PARITY_FIXTURES).sort()).toEqual(declaredPlaceableBatchFamilies());

    for (const family of [...EFFECT_BATCH_FAMILIES, ...declaredWorldBatchFamilies()]) {
      expect(PLACEABLE_NAME_FIELD[family], `${family} name table row`).toEqual({
        13.351: true,
        14.365: true
      });
    }

    for (const [family, fixture] of Object.entries(BATCH_NAME_PARITY_FIXTURES)) {
      const cells = PLACEABLE_NAME_FIELD[family];
      expect(Object.keys(cells).sort(), `${family} name table versions`).toEqual(["13.351", "14.365"]);
      for (const [version, cell] of Object.entries(cells)) {
        expect([true, false, null], `${family} @ ${version} name cell`).toContain(cell);
      }

      const declaresName = Object.values(cells).some((cell) => cell === true);
      if (!declaresName) {
        expect(
          fixture.summarized,
          `${family}: no supported version declares a \`name\` field, so no outcome may report one`
        ).toBe(false);
        expect(
          KNOWN_NAME_READ_GAPS,
          `${family} is not a read gap — it has no \`name\` field to read`
        ).not.toHaveProperty(family);
      } else if (fixture.summarized) {
        expect(
          KNOWN_NAME_READ_GAPS,
          `${family} carries \`name\` in its outcomes — not a gap`
        ).not.toHaveProperty(family);
      } else {
        expect(
          Object.keys(KNOWN_NAME_READ_GAPS),
          `${family}'s document declares \`name\` on a supported version but no batch outcome carries it: ` +
            `either wire the \`summarize\` seam (and that family's own projection) or record the gap in ` +
            `KNOWN_NAME_READ_GAPS with the reason`
        ).toContain(family);
      }
    }

    expect(Object.keys(KNOWN_NAME_READ_GAPS).sort()).toEqual(
      declaredPlaceableBatchFamilies().filter(
        (family) =>
          !BATCH_NAME_PARITY_FIXTURES[family].summarized &&
          Object.values(PLACEABLE_NAME_FIELD[family]).includes(true)
      )
    );
    for (const family of [...EFFECT_BATCH_FAMILIES, ...declaredWorldBatchFamilies()]) {
      expect(
        KNOWN_NAME_READ_GAPS,
        `${family} declares a name on both versions and reports it`
      ).not.toHaveProperty(family);
    }
  });

  it("carries `name` in a batch outcome exactly when the family's own `get` projection has one", async () => {
    for (const [family, fixture] of Object.entries(BATCH_NAME_PARITY_FIXTURES)) {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const read = await router.route(
        createRequest(`${family}.get`, { sceneId: "scene-1", [fixture.idField]: fixture.existingId })
      );
      expect(read.ok, `${family}.get`).toBe(true);
      const hasName = "name" in read.result[fixture.getKey];
      expect(hasName, `${family} fixture declares the wrong summary shape`).toBe(fixture.summarized);

      const preview = await router.route(
        createRequest(`${family}.create-many`, { sceneId: "scene-1", data: fixture.create, dryRun: true })
      );
      expect(preview.ok, `${family}.create-many`).toBe(true);
      for (const outcome of preview.result.outcomes) {
        expect("name" in outcome, `${family} outcome name-key presence`).toBe(hasName);
      }

      const update = await router.route(
        createRequest(`${family}.update-many`, {
          sceneId: "scene-1",
          patches: [{ id: fixture.existingId, patch: fixture.patch ?? { c: [1, 2, 3, 4] } }],
          dryRun: true
        })
      );
      expect(update.ok, `${family}.update-many`).toBe(true);
      for (const outcome of update.result.outcomes) {
        expect("name" in outcome, `${family} update outcome name-key presence`).toBe(hasName);

        if (hasName) expect(outcome.name).toBe(read.result[fixture.getKey].name);
      }
    }
  });

  for (const [family, fixture] of Object.entries(BATCH_FAMILY_FIXTURES)) {
    it(`${family}.create-many creates every element in ONE keepId call`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = globalThis.game.scenes.get("scene-1");
      const before = fixture.collection(scene).size;

      const response = await router.route(
        createRequest(`${family}.create-many`, { sceneId: "scene-1", data: fixture.create })
      );

      expect(response.ok).toBe(true);
      expect(response.result.sceneId).toBe("scene-1");
      expect(response.result.complete).toBe(true);
      expect(response.result.outcomes.map((outcome) => [outcome.index, outcome.status])).toEqual([
        [0, "created"],
        [1, "created"]
      ]);
      const calls = scene.createEmbeddedDocuments.mock.calls.filter((call) => call[0] === fixture.type);
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toHaveLength(2);
      expect(calls[0][2]).toEqual({ keepId: true, render: true });

      for (const outcome of response.result.outcomes) {
        expect(fixture.collection(scene).get(outcome.id)).toBeTruthy();
      }
      expect(fixture.collection(scene).size).toBe(before + 2);
    });

    it(`${family}.create-many strips a CALLER _id and mints the bridge's own`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = globalThis.game.scenes.get("scene-1");

      const response = await router.route(
        createRequest(`${family}.create-many`, {
          sceneId: "scene-1",
          data: [
            {
              ...fixture.create[0],
              _id: "spoofedid00000001",
              _stats: { createdTime: 1 },
              ownership: { default: 3 }
            }
          ]
        })
      );

      expect(response.ok).toBe(true);
      expect(response.result.outcomes[0].id).not.toBe("spoofedid00000001");
      expect(fixture.collection(scene).get("spoofedid00000001")).toBeFalsy();
    });

    it(`${family}.create-many --dry-run mints NO id and writes nothing`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = globalThis.game.scenes.get("scene-1");
      const before = fixture.collection(scene).size;

      const response = await router.route(
        createRequest(`${family}.create-many`, { sceneId: "scene-1", data: fixture.create, dryRun: true })
      );

      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result.complete).toBe(true);

      const summary = fixture.summarized ? { name: null } : {};
      expect(response.result.outcomes).toEqual([
        { index: 0, id: null, status: "created", ...summary },
        { index: 1, id: null, status: "created", ...summary }
      ]);
      expect(scene.createEmbeddedDocuments).not.toHaveBeenCalledWith(
        fixture.type,
        expect.anything(),
        expect.anything()
      );
      expect(fixture.collection(scene).size).toBe(before);
    });

    it(`${family}.update-many patches in ONE diff:true call and reports input order`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = globalThis.game.scenes.get("scene-1");

      const response = await router.route(
        createRequest(`${family}.update-many`, {
          sceneId: "scene-1",
          patches: [{ id: fixture.existingId, patch: fixture.patch }]
        })
      );

      expect(response.ok).toBe(true);
      expect(response.result.complete).toBe(true);

      const summary = fixture.summarized
        ? { name: fixture.collection(scene).get(fixture.existingId).name ?? null }
        : {};
      expect(response.result.outcomes).toEqual([
        { index: 0, id: fixture.existingId, status: "updated", ...summary }
      ]);
      const calls = scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === fixture.type);
      expect(calls).toHaveLength(1);
      expect(calls[0][2]).toEqual({ diff: true, render: true });
      expect(fixture.readPatched(fixture.collection(scene).get(fixture.existingId))).toEqual(
        fixture.patchedValue
      );
    });

    it(`${family}.update-many reports ${fixture.notFound} naming the INDEX and writes nothing`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = globalThis.game.scenes.get("scene-1");

      const response = await router.route(
        createRequest(`${family}.update-many`, {
          sceneId: "scene-1",
          patches: [
            { id: fixture.existingId, patch: fixture.patch },
            { id: "missingid00000001", patch: fixture.patch }
          ]
        })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(fixture.notFound);
      expect(response.error.details.index).toBe(1);
      expect(
        scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === fixture.type)
      ).toHaveLength(0);
    });

    it(`${family}.delete-many deletes in ONE call and converges on a missing id`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = globalThis.game.scenes.get("scene-1");

      const response = await router.route(
        createRequest(`${family}.delete-many`, {
          sceneId: "scene-1",
          ids: ["goneid0000000001", fixture.existingId]
        })
      );

      expect(response.ok).toBe(true);
      expect(response.result.complete).toBe(true);
      expect(response.result.outcomes).toEqual([
        { index: 0, id: "goneid0000000001", status: "alreadyDeleted" },
        { index: 1, id: fixture.existingId, status: "deleted" }
      ]);

      const calls = scene.deleteEmbeddedDocuments.mock.calls.filter((call) => call[0] === fixture.type);
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toEqual([fixture.existingId]);
      expect(fixture.collection(scene).get(fixture.existingId)).toBeFalsy();
    });
  }

  it("scene.token.create-many resolves EACH element's actor, defaulting each to UNLINKED", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    const actor = globalThis.game.actors.get("actor-1");

    const response = await router.route(
      createRequest("scene.token.create-many", {
        sceneId: "scene-1",
        data: [
          { actorId: "actor-1", x: 10, y: 10 },
          { actorId: "actor-1", x: 20, y: 20, actorLink: true },
          { name: "Trap Marker", x: 30, y: 30, texture: { src: "markers/trap.webp" } }
        ]
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.outcomes.map((outcome) => outcome.status)).toEqual([
      "created",
      "created",
      "created"
    ]);

    expect(actor.getTokenDocument).toHaveBeenCalledTimes(2);
    expect(actor.getTokenDocument.mock.calls[0][0]).toMatchObject({ x: 10, y: 10, actorLink: false });
    expect(actor.getTokenDocument.mock.calls[1][0]).toMatchObject({ x: 20, y: 20, actorLink: true });
    const [placed, linked, raw] = response.result.outcomes.map((outcome) => scene.tokens.get(outcome.id));

    expect(placed.texture).toEqual({ src: "prototype.webp" });
    expect(placed.actorLink).toBe(false);

    expect(linked.actorLink).toBe(true);

    expect(raw.actorId ?? null).toBe(null);
    expect(raw.texture).toEqual({ src: "markers/trap.webp" });
  });

  it("both token create verbs build against the TARGET scene, never the viewed one", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const target = globalThis.game.scenes.get("scene-2");
    const actor = globalThis.game.actors.get("actor-1");
    const previousCanvas = globalThis.canvas;
    globalThis.canvas = { scene: globalThis.game.scenes.get("scene-1") };

    try {
      actor.getTokenDocument.mockClear();
      const single = await router.route(
        createRequest("scene.token.create", {
          sceneId: "scene-2",
          data: { actorId: "actor-1", x: 10, y: 10 }
        })
      );
      expect(single.ok).toBe(true);
      expect(actor.getTokenDocument).toHaveBeenCalledTimes(1);
      expect(actor.getTokenDocument.mock.calls[0][1].parent).toBe(target);

      actor.getTokenDocument.mockClear();
      const batch = await router.route(
        createRequest("scene.token.create-many", {
          sceneId: "scene-2",
          data: [
            { actorId: "actor-1", x: 20, y: 20 },
            { actorId: "actor-1", x: 30, y: 30 }
          ]
        })
      );
      expect(batch.ok).toBe(true);
      expect(actor.getTokenDocument).toHaveBeenCalledTimes(2);
      for (const call of actor.getTokenDocument.mock.calls) {
        expect(call[1].parent).toBe(target);

        expect(call[1].parent).not.toBe(globalThis.canvas.scene);
      }

      actor.getTokenDocument.mockClear();
      const dry = await router.route(
        createRequest("scene.token.create-many", {
          sceneId: "scene-2",
          data: [{ actorId: "actor-1", x: 40, y: 40 }],
          dryRun: true
        })
      );
      expect(dry.ok).toBe(true);
      expect(actor.getTokenDocument.mock.calls[0][1].parent).toBe(target);
    } finally {
      if (previousCanvas === undefined) delete globalThis.canvas;
      else globalThis.canvas = previousCanvas;
    }
  });

  it("the token resolution REFUSES a missing target scene instead of letting core default it", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    actor.getTokenDocument.mockClear();
    await expect(buildTokenDataFromActor("actor-1", { x: 1, y: 1 }, null)).rejects.toMatchObject({
      code: "INTERNAL_ERROR"
    });
    expect(actor.getTokenDocument).not.toHaveBeenCalled();
  });

  it("scene.token.create-many outcomes carry each token's NAME, read the way scene.token.get reads it", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.token.create-many", {
        sceneId: "scene-1",
        data: [
          { name: "Trap Marker", x: 5, y: 5 },
          { actorId: "actor-1", x: 60, y: 60 }
        ]
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.outcomes.map((outcome) => outcome.name)).toEqual(["Trap Marker", "Valeros"]);
    for (const outcome of response.result.outcomes) {
      const read = await router.route(
        createRequest("scene.token.get", { sceneId: "scene-1", tokenId: outcome.id })
      );
      expect(read.ok).toBe(true);
      expect(outcome.name).toBe(read.result.token.name);
    }

    expect(Object.keys(response.result.outcomes[0]).sort()).toEqual(["id", "index", "name", "status"]);
  });

  it("scene.token.update-many reports the NEW name on an applied rename and the current one on a no-op", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    const current = scene.tokens.get("token-linked").name;

    const response = await router.route(
      createRequest("scene.token.update-many", {
        sceneId: "scene-1",
        patches: [
          { id: "token-a", patch: { name: "Renamed Valeros" } },
          { id: "token-linked", patch: { name: current } }
        ]
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.outcomes).toEqual([
      { index: 0, id: "token-a", status: "updated", name: "Renamed Valeros" },
      { index: 1, id: "token-linked", status: "unchanged", name: current }
    ]);
  });

  it("scene.token.create-many rejects a missing actor with ACTOR_NOT_FOUND naming the INDEX, writing nothing", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    const before = scene.tokens.size;

    const response = await router.route(
      createRequest("scene.token.create-many", {
        sceneId: "scene-1",
        data: [
          { actorId: "actor-1", x: 1, y: 1 },
          { actorId: "no-such-actor", x: 2, y: 2 }
        ]
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("ACTOR_NOT_FOUND");
    expect(response.error.details.index).toBe(1);

    expect(response.error.message.startsWith("scene.token.create-many element 1: ")).toBe(true);
    expect(response.error.message.endsWith("Nothing was written.")).toBe(true);
    expect(scene.tokens.size).toBe(before);
    expect(scene.createEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Token")).toHaveLength(0);
  });

  it("scene.token.create-many --dry-run refuses the missing actor the real call would refuse", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.token.create-many", {
        sceneId: "scene-1",
        data: [{ actorId: "no-such-actor" }],
        dryRun: true
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("ACTOR_NOT_FOUND");
    expect(response.error.details.index).toBe(0);
  });

  it("scene.token.create-many reports the FIRST OFFENDING ELEMENT even when the EARLIER one needs an await", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    const RealTokenClass = scene.tokens.documentClass;
    scene.tokens.documentClass = function TokenPreview(source, context) {
      if (source?.name === "refuse-me") {
        throw makeDataModelValidationError("name: refuse-me is not a valid choice");
      }
      return new RealTokenClass(source, context);
    };

    const response = await router.route(
      createRequest("scene.token.create-many", {
        sceneId: "scene-1",
        data: [{ actorId: "no-such-actor" }, { name: "refuse-me", x: 1, y: 1 }]
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("ACTOR_NOT_FOUND");
    expect(response.error.details.index).toBe(0);
    expect(response.error.code).not.toBe("INVALID_PARAMS");
    expect(scene.createEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Token")).toHaveLength(0);
  });

  it("scene.token.create-many still reports a LATER element's missing actor when the earlier ones are fine", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    const RealTokenClass = scene.tokens.documentClass;
    scene.tokens.documentClass = function TokenPreview(source, context) {
      if (source?.name === "refuse-me") {
        throw makeDataModelValidationError("name: refuse-me is not a valid choice");
      }
      return new RealTokenClass(source, context);
    };

    const response = await router.route(
      createRequest("scene.token.create-many", {
        sceneId: "scene-1",
        data: [{ name: "fine", x: 1, y: 1 }, { actorId: "no-such-actor" }, { name: "refuse-me" }]
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("ACTOR_NOT_FOUND");
    expect(response.error.details.index).toBe(1);
  });

  it("scene.token.update-many does NOT re-resolve the actor — actorId/actorLink are plain fields", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    const actor = globalThis.game.actors.get("actor-1");
    actor.getTokenDocument.mockClear();

    const response = await router.route(
      createRequest("scene.token.update-many", {
        sceneId: "scene-1",
        patches: [{ id: "token-a", patch: { actorLink: true, x: 42 } }]
      })
    );

    expect(response.ok).toBe(true);

    expect(response.result.outcomes).toEqual([
      { index: 0, id: "token-a", status: "updated", name: "Valeros Token" }
    ]);
    expect(actor.getTokenDocument).not.toHaveBeenCalled();
    expect(scene.tokens.get("token-a").actorLink).toBe(true);
    expect(scene.tokens.get("token-a").x).toBe(42);
  });

  it("scene.region.create-many refuses an executeScript element, naming the INDEX, writing nothing", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    const before = scene.regions.size;

    const response = await router.route(
      createRequest("scene.region.create-many", {
        sceneId: "scene-1",
        data: [
          { name: "Fine Zone", shapes: [] },
          {
            name: "Armed Zone",
            behaviors: [{ type: "executeScript", system: { source: "game.user.delete()" } }]
          }
        ]
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details.index).toBe(1);
    expect(response.error.details.behaviorType).toBe("executeScript");
    expect(response.error.message).toContain("no arbitrary JavaScript execution");

    expect(response.error.message.startsWith("scene.region.create-many element 1: ")).toBe(true);
    expect(response.error.message.endsWith("Nothing was written.")).toBe(true);

    expect(scene.regions.size).toBe(before);
    expect(scene.createEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Region")).toHaveLength(0);
  });

  it("scene.region.create-many refuses an executeMacro element under --dry-run too", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.region.create-many", {
        sceneId: "scene-1",
        data: [{ name: "Armed Zone", behaviors: [{ type: "executeMacro", system: { uuid: "Macro.abc" } }] }],
        dryRun: true
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details.index).toBe(0);
    expect(response.error.details.behaviorType).toBe("executeMacro");
  });

  it("scene.region.update-many refuses a TYPELESS _id-addressed patch that arms an existing behavior", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.region.update-many", {
        sceneId: "scene-1",
        patches: [
          { id: "region-lava", patch: { name: "Fine" } },
          {
            id: "region-safe",
            patch: { behaviors: [{ _id: "behavior-script", system: { source: "game.user.delete()" } }] }
          }
        ]
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details.index).toBe(1);
    expect(response.error.details.behaviorType).toBe("executeScript");
    expect(scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Region")).toHaveLength(0);
  });

  it("scene.region.update-many resolves the typeless patch against the ELEMENT's OWN region", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const behavior = Array.from(scene.regions.get("region-lava").behaviors)[0];
    const behaviorId = behavior._id ?? behavior.id;
    expect(typeof behaviorId).toBe("string");

    const response = await router.route(
      createRequest("scene.region.update-many", {
        sceneId: "scene-1",
        patches: [{ id: "region-lava", patch: { behaviors: [{ _id: behaviorId, disabled: true }] } }]
      })
    );

    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    expect(response.result.outcomes[0].status).toBe("updated");
  });

  it("scene.region.update-many refuses a non-array `behaviors` spelling before anything is written", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.region.update-many", {
        sceneId: "scene-1",
        patches: [{ id: "region-lava", patch: { "behaviors.0.type": "executeScript" } }]
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details.index).toBe(0);
    expect(scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Region")).toHaveLength(0);
  });

  it("scene.region.update-many refuses the typeless _id-addressed arming under --dry-run too", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.region.update-many", {
        sceneId: "scene-1",
        patches: [
          {
            id: "region-safe",
            patch: { behaviors: [{ _id: "behavior-script", system: { source: "game.user.delete()" } }] }
          }
        ],
        dryRun: true
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details.index).toBe(0);
    expect(response.error.details.behaviorType).toBe("executeScript");
    expect(response.error.message).toContain("no arbitrary JavaScript execution");
    expect(scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Region")).toHaveLength(0);
  });

  it("scene.region.update-many refuses a non-array `behaviors` spelling under --dry-run too", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.region.update-many", {
        sceneId: "scene-1",
        patches: [{ id: "region-lava", patch: { "behaviors.0.type": "executeScript" } }],
        dryRun: true
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details.index).toBe(0);
    expect(scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Region")).toHaveLength(0);
  });

  it("scene.region.create-many outcomes carry the name scene.region.get reports", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.region.create-many", {
        sceneId: "scene-1",
        data: [
          { name: "Bulk Zone A", shapes: [] },
          { name: "Bulk Zone B", shapes: [] }
        ]
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.outcomes.map((outcome) => outcome.name)).toEqual(["Bulk Zone A", "Bulk Zone B"]);
    for (const outcome of response.result.outcomes) {
      const read = await router.route(
        createRequest("scene.region.get", { sceneId: "scene-1", regionId: outcome.id })
      );
      expect(read.ok).toBe(true);
      expect(outcome.name).toBe(read.result.region.name);
    }
  });

  it("scene.template.*-many return UNSUPPORTED_OPERATION when the Scene schema has no templates collection", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));

    delete scene.templates;

    const create = await router.route(
      createRequest("scene.template.create-many", {
        sceneId: "scene-1",
        data: [{ t: "circle", x: 1, y: 1, distance: 5 }]
      })
    );
    expect(create.ok).toBe(false);
    expect(create.error.code).toBe("UNSUPPORTED_OPERATION");
    expect(create.error.details.family).toBe("scene.template");

    const update = await router.route(
      createRequest("scene.template.update-many", {
        sceneId: "scene-1",
        patches: [{ id: "template-fireball", patch: { distance: 9 } }]
      })
    );
    expect(update.ok).toBe(false);
    expect(update.error.code).toBe("UNSUPPORTED_OPERATION");

    const remove = await router.route(
      createRequest("scene.template.delete-many", { sceneId: "scene-1", ids: ["template-fireball"] })
    );
    expect(remove.ok).toBe(false);
    expect(remove.error.code).toBe("UNSUPPORTED_OPERATION");
  });

  it("the template capability gate BEATS the size cap and the duplicate-id gate", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    delete scene.templates;

    const oversized = await router.route(
      createRequest("scene.template.delete-many", {
        sceneId: "scene-1",

        ids: Array.from({ length: 101 }, (_value, index) => `templateid${String(index).padStart(6, "0")}`)
      })
    );
    expect(oversized.ok).toBe(false);
    expect(oversized.error.code).toBe("UNSUPPORTED_OPERATION");

    const duplicated = await router.route(
      createRequest("scene.template.delete-many", {
        sceneId: "scene-1",
        ids: ["template-fireball", "template-fireball"]
      })
    );
    expect(duplicated.ok).toBe(false);
    expect(duplicated.error.code).toBe("UNSUPPORTED_OPERATION");
  });

  it("an unknown SCENE still wins over the template capability gate", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const response = await router.route(
      createRequest("scene.template.create-many", {
        sceneId: "nope",
        data: [{ t: "circle", x: 1, y: 1, distance: 5 }]
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("SCENE_NOT_FOUND");
  });

  it("prepares a batch create element EXACTLY as the single create verb does (every batched family)", async () => {
    const families = {
      "scene.token": { type: "Token", data: { actorId: "actor-1", x: 15, y: 25 } },
      "scene.tile": {
        type: "Tile",
        data: { x: 15, y: 25, texture: { src: "worlds/world-1/maps/dungeon 1.webp" } }
      },
      "scene.sound": {
        type: "AmbientSound",
        data: { path: "worlds/world-1/audio/bell ring.ogg", volume: 0.3 }
      },
      "scene.note": {
        type: "Note",
        data: { x: 15, y: 25, text: "Pin", texture: { src: "icons/svg/book 1.svg" } }
      },
      "scene.wall": { type: "Wall", data: { c: [1, 2, 3, 4], door: 1 } },

      "scene.drawing": {
        type: "Drawing",
        data: { shape: { type: "r", width: 10, height: 10 }, x: 15, y: 25, author: "user-9", text: "G" }
      },
      "scene.light": { type: "AmbientLight", data: { x: 15, y: 25, config: { dim: 10, bright: 5 } } },

      "scene.template": {
        type: "MeasuredTemplate",
        data: { t: "circle", x: 15, y: 25, distance: 7, author: "user-9", user: "user-9" }
      },

      "scene.region": {
        type: "Region",
        data: {
          name: "Golden Zone",
          shapes: [{ type: "rectangle", x: 0, y: 0, width: 5, height: 5 }],
          behaviors: [{ type: "pauseGame", name: "Pause" }]
        }
      }
    };

    expect(Object.keys(families).sort()).toEqual(declaredPlaceableBatchFamilies());

    for (const [family, { type, data }] of Object.entries(families)) {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = globalThis.game.scenes.get("scene-1");
      const payloadsFor = (mock) => mock.calls.filter((call) => call[0] === type).flatMap((call) => call[1]);

      scene.createEmbeddedDocuments.mockClear();
      const single = await router.route(createRequest(`${family}.create`, { sceneId: "scene-1", data }));
      expect(single.ok, `${family}.create should succeed`).toBe(true);
      const singlePayloads = payloadsFor(scene.createEmbeddedDocuments.mock);
      expect(singlePayloads, `${family}.create should issue exactly one payload`).toHaveLength(1);

      scene.createEmbeddedDocuments.mockClear();
      const batch = await router.route(
        createRequest(`${family}.create-many`, { sceneId: "scene-1", data: [data] })
      );
      expect(batch.ok, `${family}.create-many should succeed`).toBe(true);
      const batchPayloads = payloadsFor(scene.createEmbeddedDocuments.mock);
      expect(batchPayloads).toHaveLength(1);

      const { _id, ...batchPayload } = batchPayloads[0];
      expect(typeof _id, `${family}.create-many must pre-generate an id`).toBe("string");
      expect(batchPayload, `${family} batch element preparation diverged from the single verb`).toEqual(
        singlePayloads[0]
      );

      for (const spelling of ["author", "user"]) {
        if (!(spelling in data)) continue;
        for (const [label, payload] of [
          [`${family}.create-many`, batchPayload],
          [`${family}.create`, singlePayloads[0]]
        ]) {
          expect(payload, `${label} must strip the server-assigned "${spelling}"`).not.toHaveProperty(
            spelling
          );
          expect(payload, `${label} must not migrate "${spelling}" onto author`).not.toHaveProperty("author");
        }
      }
    }
  });

  const EFFECT_BATCH_FIXTURES = {
    "actor.effect": {
      scope: { actorId: "actor-1" },
      getParent: () => globalThis.game.actors.get("actor-1"),

      expectedTransfer: false,
      extraKeys: []
    },
    "item.effect": {
      scope: { itemId: "item-1" },
      getParent: () => globalThis.game.items.get("item-1"),

      expectedTransfer: true,
      extraKeys: []
    },
    "actor.item.effect": {
      scope: { actorId: "actor-1", itemId: "actor-item-1" },
      getParent: () => globalThis.game.actors.get("actor-1").items.get("actor-item-1"),
      expectedTransfer: true,
      extraKeys: []
    },
    "scene.token.effect": {
      scope: { sceneId: "scene-1", tokenId: "token-a" },
      getParent: () => globalThis.game.scenes.get("scene-1").tokens.get("token-a").actor,
      expectedTransfer: false,

      extraKeys: ["actorLink", "mutatesWorldActor"]
    },
    "scene.token.item.effect": {
      scope: { sceneId: "scene-1", tokenId: "token-a", itemId: "delta-item-1" },
      getParent: () =>
        globalThis.game.scenes.get("scene-1").tokens.get("token-a").actor.items.get("delta-item-1"),
      expectedTransfer: true,

      extraKeys: ["actorLink", "mutatesWorldActor", "nonDurable", "warning"]
    }
  };

  it("covers every batched EFFECT family the protocol declares with a fixture (derived)", () => {
    expect(Object.keys(EFFECT_BATCH_FIXTURES).sort()).toEqual(EFFECT_BATCH_FAMILIES);
  });

  it("round-trips create-many / update-many / delete-many for every effect family", async () => {
    for (const [family, fixture] of Object.entries(EFFECT_BATCH_FIXTURES)) {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const parent = fixture.getParent();

      const created = await router.route(
        createRequest(`${family}.create-many`, {
          ...fixture.scope,
          data: [
            { name: "Bulk Bless", transfer: true, changes: [{ key: "system.a", mode: 2, value: "1" }] },
            { name: "Bulk Bane", disabled: true }
          ]
        })
      );
      expect(created.ok, `${family}.create-many: ${JSON.stringify(created.error)}`).toBe(true);
      expect(created.result.complete).toBe(true);
      expect(created.result.outcomes.map((outcome) => outcome.status)).toEqual(["created", "created"]);

      expect(created.result).toMatchObject(fixture.scope);
      for (const key of fixture.extraKeys) {
        expect(created.result, `${family}.create-many must echo ${key}`).toHaveProperty(key);
      }

      expect(created.result.outcomes[0]).toEqual({
        index: 0,
        id: expect.any(String),
        status: "created",
        name: "Bulk Bless"
      });
      const parityRead = await router.route(
        createRequest(`${family}.get`, { ...fixture.scope, effectId: created.result.outcomes[0].id })
      );
      expect(parityRead.ok, `${family}.get: ${JSON.stringify(parityRead.error)}`).toBe(true);
      expect(parityRead.result.effect.name, `${family} outcome name must equal what get reports`).toBe(
        created.result.outcomes[0].name
      );

      const createCalls = parent.createEmbeddedDocuments.mock.calls.filter(
        (call) => call[0] === "ActiveEffect"
      );
      expect(createCalls).toHaveLength(1);
      expect(createCalls[0][1]).toHaveLength(2);
      expect(createCalls[0][2]).toMatchObject({ keepId: true, render: true });

      expect(createCalls[0][1][0].transfer).toBe(fixture.expectedTransfer);

      const ids = created.result.outcomes.map((outcome) => outcome.id);
      const updated = await router.route(
        createRequest(`${family}.update-many`, {
          ...fixture.scope,
          patches: [
            { id: ids[0], patch: { disabled: true } },

            { id: ids[1], patch: { disabled: true } }
          ]
        })
      );
      expect(updated.ok, `${family}.update-many: ${JSON.stringify(updated.error)}`).toBe(true);
      expect(updated.result.complete).toBe(true);
      expect(updated.result.outcomes.map((outcome) => outcome.status)).toEqual(["updated", "unchanged"]);
      const updateCalls = parent.updateEmbeddedDocuments.mock.calls.filter(
        (call) => call[0] === "ActiveEffect"
      );
      expect(updateCalls).toHaveLength(1);

      expect(updateCalls[0][1]).toEqual([
        { _id: ids[0], disabled: true, ...(fixture.expectedTransfer ? {} : { transfer: false }) }
      ]);
      expect(updateCalls[0][2]).toMatchObject({ diff: true, render: true });

      const deleted = await router.route(
        createRequest(`${family}.delete-many`, { ...fixture.scope, ids: [...ids, "effect-does-not-exist"] })
      );
      expect(deleted.ok, `${family}.delete-many: ${JSON.stringify(deleted.error)}`).toBe(true);
      expect(deleted.result.complete).toBe(true);
      expect(deleted.result.outcomes.map((outcome) => outcome.status)).toEqual([
        "deleted",
        "deleted",

        "alreadyDeleted"
      ]);
      const deleteCalls = parent.deleteEmbeddedDocuments.mock.calls.filter(
        (call) => call[0] === "ActiveEffect"
      );

      expect(deleteCalls.at(-1)[1]).toEqual(ids);
    }
  });

  it("previews all three batch verbs without writing, for every effect family", async () => {
    for (const [family, fixture] of Object.entries(EFFECT_BATCH_FIXTURES)) {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const parent = fixture.getParent();

      const anchor = await router.route(
        createRequest(`${family}.create-many`, {
          ...fixture.scope,
          data: [{ name: "Preview Anchor" }, { name: "Preview Second" }]
        })
      );
      expect(anchor.ok, `${family}.create-many anchor: ${JSON.stringify(anchor.error)}`).toBe(true);
      const [anchorId, secondId] = anchor.result.outcomes.map((outcome) => outcome.id);
      const listIds = async () => {
        const list = await router.route(createRequest(`${family}.list`, { ...fixture.scope }));
        expect(list.ok, `${family}.list: ${JSON.stringify(list.error)}`).toBe(true);
        return list.result.effects.map((effect) => effect.id).sort();
      };
      const before = await listIds();
      expect(before).toContain(anchorId);
      parent.createEmbeddedDocuments.mockClear();
      parent.updateEmbeddedDocuments.mockClear();
      parent.deleteEmbeddedDocuments.mockClear();
      const writeCalls = () =>
        [
          parent.createEmbeddedDocuments,
          parent.updateEmbeddedDocuments,
          parent.deleteEmbeddedDocuments
        ].flatMap((mock) => mock.mock.calls.filter((call) => call[0] === "ActiveEffect"));

      const created = await router.route(
        createRequest(`${family}.create-many`, {
          ...fixture.scope,
          data: [{ name: "Preview Bless" }, { name: "Preview Bane", disabled: true }],
          dryRun: true
        })
      );
      expect(created.ok, `${family}.create-many --dry-run: ${JSON.stringify(created.error)}`).toBe(true);
      expect(created.result.dryRun).toBe(true);
      expect(created.result.complete).toBe(true);
      expect(created.result.outcomes).toEqual([
        { index: 0, id: null, status: "created", name: null },
        { index: 1, id: null, status: "created", name: null }
      ]);

      expect(created.result).toMatchObject(fixture.scope);
      for (const key of fixture.extraKeys) {
        expect(created.result, `${family}.create-many --dry-run must echo ${key}`).toHaveProperty(key);
      }

      const updated = await router.route(
        createRequest(`${family}.update-many`, {
          ...fixture.scope,
          patches: [
            { id: anchorId, patch: { name: "Renamed By Preview", disabled: true } },
            { id: secondId, patch: { name: "Preview Second" } }
          ],
          dryRun: true
        })
      );
      expect(updated.ok, `${family}.update-many --dry-run: ${JSON.stringify(updated.error)}`).toBe(true);
      expect(updated.result.dryRun).toBe(true);
      expect(updated.result.complete).toBe(true);
      expect(updated.result.outcomes).toEqual([
        { index: 0, id: anchorId, status: "updated", name: "Preview Anchor" },

        { index: 1, id: secondId, status: "unchanged", name: "Preview Second" }
      ]);

      const deleted = await router.route(
        createRequest(`${family}.delete-many`, {
          ...fixture.scope,
          ids: [anchorId, secondId, "effect-does-not-exist"],
          dryRun: true
        })
      );
      expect(deleted.ok, `${family}.delete-many --dry-run: ${JSON.stringify(deleted.error)}`).toBe(true);
      expect(deleted.result.dryRun).toBe(true);
      expect(deleted.result.complete).toBe(true);
      expect(deleted.result.outcomes).toEqual([
        { index: 0, id: anchorId, status: "deleted" },
        { index: 1, id: secondId, status: "deleted" },
        { index: 2, id: "effect-does-not-exist", status: "alreadyDeleted" }
      ]);

      expect(writeCalls(), `${family}: a dry run must not call any Foundry write method`).toHaveLength(0);
      expect(await listIds(), `${family}: a dry run must not change stored state`).toEqual(before);
      const read = await router.route(
        createRequest(`${family}.get`, { ...fixture.scope, effectId: anchorId })
      );
      expect(read.ok, `${family}.get: ${JSON.stringify(read.error)}`).toBe(true);
      expect(read.result.effect.name).toBe("Preview Anchor");
      expect(read.result.effect.disabled).toBe(false);
    }
  });

  it("rejects the WHOLE effect update-many naming the index when an element id does not resolve", async () => {
    for (const [family, fixture] of Object.entries(EFFECT_BATCH_FIXTURES)) {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const parent = fixture.getParent();
      const created = await router.route(
        createRequest(`${family}.create-many`, { ...fixture.scope, data: [{ name: "Anchor" }] })
      );
      expect(created.ok).toBe(true);
      parent.updateEmbeddedDocuments.mockClear();

      const response = await router.route(
        createRequest(`${family}.update-many`, {
          ...fixture.scope,
          patches: [
            { id: created.result.outcomes[0].id, patch: { disabled: true } },
            { id: "effect-nope", patch: { disabled: true } }
          ]
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.EFFECT_NOT_FOUND);

      expect(response.error.details).toMatchObject({ index: 1, effectId: "effect-nope", ...fixture.scope });
      expect(response.error.message).toContain("element 1");
      expect(response.error.message).toContain("Nothing was written");

      expect(
        parent.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "ActiveEffect")
      ).toHaveLength(0);
    }
  });

  it("REACHES the v14 `system.changes` arm through actor.effect.update-many (not just in the unit test)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const actor = globalThis.game.actors.get("actor-1");

    actor.effects.documentClass.schema = {
      get: (key) =>
        key === "system"
          ? { clean: (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {}) }
          : null
    };
    actor.effects.documentClass.migrateData = (source) => {
      const migrated = { ...source };
      if (Array.isArray(migrated.changes)) {
        migrated.system = {
          ...(migrated.system ?? {}),
          changes: migrated.changes.map((change) => ({ ...change }))
        };
        delete migrated.changes;
      }
      return migrated;
    };

    const validChangeType = (type) =>
      typeof type === "string" &&
      type.length >= 3 &&
      (/^custom\.-?\d+$/.test(type) || type.split(".").every((segment) => /^[a-z0-9]+$/i.test(segment)));

    const changesField = {
      clean: (entries) =>
        (Array.isArray(entries) ? entries : []).map((entry) => ({
          key: entry?.key ?? "",
          type: entry?.type || "add",
          value: entry?.value ?? "",
          phase: entry?.phase ?? "initial"
        }))
    };

    const modelSystem = (document) => {
      const system = document.system;
      if (system && typeof system === "object" && !Object.prototype.hasOwnProperty.call(system, "schema")) {
        Object.defineProperty(system, "schema", {
          value: { get: (key) => (key === "changes" ? changesField : null) },
          enumerable: false,
          configurable: true
        });
      }
      return document;
    };

    const modelV14Patch = (patch = {}) => {
      const migrated = actor.effects.documentClass.migrateData(patch ?? {});

      if (Object.hasOwn(migrated, "system.changes")) {
        const direct = migrated["system.changes"];
        delete migrated["system.changes"];
        migrated.system = { ...(migrated.system ?? {}), changes: direct };
      }
      const changes = migrated?.system?.changes;
      if (Array.isArray(changes)) {
        if (changes.some((change) => !validChangeType(change?.type || "add"))) {
          delete migrated.system.changes;
          if (Object.keys(migrated.system).length === 0) delete migrated.system;
        } else {
          migrated.system.changes = changesField.clean(changes);
        }
      }
      return migrated;
    };

    const modelV14Merge = (document) => {
      const innerClone = document.clone;
      document.clone = vi.fn(async (patch = {}, context = {}) =>
        modelV14Merge(await innerClone(patch, context))
      );
      const innerApplyStoredWrite = document.applyStoredWrite.bind(document);
      document.applyStoredWrite = function applyStoredWrite(patch = {}) {
        const stored = innerApplyStoredWrite(modelV14Patch(patch));
        modelSystem(document);
        return stored;
      };
      const innerUpdateSource = document.updateSource.bind(document);
      document.updateSource = function updateSource(patch = {}, context = {}) {
        const result = innerUpdateSource(modelV14Patch(patch), context);
        modelSystem(document);
        return result;
      };
      return modelSystem(document);
    };

    const created = await router.route(
      createRequest("actor.effect.create-many", { actorId: "actor-1", data: [{ name: "Reach" }] })
    );
    expect(created.ok, JSON.stringify(created.error)).toBe(true);
    const effectId = created.result.outcomes[0].id;
    modelV14Merge(actor.effects.get(effectId));

    /** @type {Array<{patch: Record<string, any>, needle: RegExp}>} */
    const droppedSpellings = [
      { patch: { "changes.0.value": 9 }, needle: /dotted path into the field is not migrated/ },
      {
        patch: { "==changes": [{ key: "a", value: "1" }] },
        needle: /legacy "==" operator key is not migrated/
      },
      { patch: { "-=changes": null }, needle: /legacy "-=" operator key is not migrated/ }
    ];
    for (const { patch, needle } of droppedSpellings) {
      const refused = await router.route(
        createRequest("actor.effect.update-many", { actorId: "actor-1", patches: [{ id: effectId, patch }] })
      );
      expect(refused.ok, `${JSON.stringify(patch)} must be refused`).toBe(false);
      expect(refused.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(refused.error.message).toMatch(needle);
      expect(refused.error.message).toContain('MOVED to "system.changes"');
      expect(refused.error.details).toMatchObject({ index: 0, id: effectId, movedTo: "system.changes" });
    }

    actor.updateEmbeddedDocuments.mockClear();
    const badValue = await router.route(
      createRequest("actor.effect.update-many", {
        actorId: "actor-1",
        patches: [
          { id: effectId, patch: { changes: [{ key: "system.a", type: "my-module.bonus", value: 2 }] } }
        ]
      })
    );
    expect(badValue.ok, "a value the moved field rejects must not answer ok").toBe(false);
    expect(badValue.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(badValue.error.message).toContain("dot-delimited alphanumeric");
    expect(badValue.error.details).toMatchObject({ index: 0, id: effectId, movedTo: "system.changes" });

    expect(
      actor.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "ActiveEffect")
    ).toHaveLength(0);

    const previewed = await router.route(
      createRequest("actor.effect.update-many", {
        actorId: "actor-1",
        patches: [
          { id: effectId, patch: { changes: [{ key: "system.a", type: "my-module.bonus", value: 2 }] } }
        ],
        dryRun: true
      })
    );
    expect(previewed.ok, "the same refusal must fire on the preview path").toBe(false);
    expect(previewed.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(previewed.error.message).toContain("does NOT accept");

    const allowed = await router.route(
      createRequest("actor.effect.update-many", {
        actorId: "actor-1",
        patches: [{ id: effectId, patch: { changes: [{ key: "system.a", value: "1" }] } }]
      })
    );
    expect(allowed.ok, JSON.stringify(allowed.error)).toBe(true);
    expect(allowed.result.outcomes).toEqual([{ index: 0, id: effectId, status: "updated", name: "Reach" }]);

    for (const patch of [
      { "system.changes": [{ key: "system.a", type: "my-module.bonus", value: 2 }] },
      { system: { changes: [{ key: "system.a", type: "my-module.bonus", value: 2 }] } }
    ]) {
      actor.updateEmbeddedDocuments.mockClear();
      const refusedDirect = await router.route(
        createRequest("actor.effect.update-many", { actorId: "actor-1", patches: [{ id: effectId, patch }] })
      );
      expect(refusedDirect.ok, `${JSON.stringify(patch)} must be refused`).toBe(false);
      expect(refusedDirect.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(refusedDirect.error.message).toContain('sets "system.changes"');
      expect(refusedDirect.error.message).toContain("does NOT accept");

      expect(refusedDirect.error.message).not.toContain("has MOVED to");
      expect(refusedDirect.error.details).toMatchObject({
        index: 0,
        id: effectId,
        movedTo: "system.changes"
      });

      expect(
        actor.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "ActiveEffect")
      ).toHaveLength(0);
    }

    const allowedDirect = await router.route(
      createRequest("actor.effect.update-many", {
        actorId: "actor-1",
        patches: [
          { id: effectId, patch: { "system.changes": [{ key: "system.b", type: "add", value: "2" }] } }
        ]
      })
    );
    expect(allowedDirect.ok, JSON.stringify(allowedDirect.error)).toBe(true);
    expect(allowedDirect.result.outcomes).toEqual([
      { index: 0, id: effectId, status: "updated", name: "Reach" }
    ]);
  });

  it("prepares an effect batch element EXACTLY as the single effect create verb does (all five families)", async () => {
    const data = {
      _id: "spoofedeffect001",
      _stats: { createdTime: 1 },
      ownership: { "user-1": 3 },
      name: "Golden Aura",
      transfer: true,

      origin: "Item.def",
      img: "worlds/world-1/icons/aura 1.svg",
      changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "2" }],
      flags: { mymod: { keep: true } }
    };
    for (const [family, fixture] of Object.entries(EFFECT_BATCH_FIXTURES)) {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const parent = fixture.getParent();
      const payloadsFor = (mock) =>
        mock.calls.filter((call) => call[0] === "ActiveEffect").flatMap((call) => call[1]);

      parent.createEmbeddedDocuments.mockClear();
      const single = await router.route(
        createRequest(`${family}.create`, { ...fixture.scope, data: { ...data } })
      );
      expect(single.ok, `${family}.create: ${JSON.stringify(single.error)}`).toBe(true);
      const singlePayloads = payloadsFor(parent.createEmbeddedDocuments.mock);
      expect(singlePayloads).toHaveLength(1);

      parent.createEmbeddedDocuments.mockClear();
      const batch = await router.route(
        createRequest(`${family}.create-many`, { ...fixture.scope, data: [{ ...data }] })
      );
      expect(batch.ok, `${family}.create-many: ${JSON.stringify(batch.error)}`).toBe(true);
      const batchPayloads = payloadsFor(parent.createEmbeddedDocuments.mock);
      expect(batchPayloads).toHaveLength(1);

      const { _id, ...batchPayload } = batchPayloads[0];
      expect(typeof _id, `${family}.create-many must pre-generate an id`).toBe("string");
      expect(_id).not.toBe("spoofedeffect001");
      expect(batchPayload, `${family} batch element preparation diverged from the single verb`).toEqual(
        singlePayloads[0]
      );

      for (const [label, payload] of [
        [`${family}.create`, singlePayloads[0]],
        [`${family}.create-many`, batchPayload]
      ]) {
        expect(payload, `${label} must strip _id`).not.toHaveProperty("_id");
        expect(payload, `${label} must strip _stats`).not.toHaveProperty("_stats");
        expect(payload, `${label} must strip ownership`).not.toHaveProperty("ownership");
        expect(payload.origin, `${label} must PRESERVE the authored origin`).toBe("Item.def");
        expect(payload.img, `${label} must canonicalize the img FilePath`).toBe(
          "worlds/world-1/icons/aura%201.svg"
        );
        expect(payload.transfer, `${label} transfer coercion`).toBe(fixture.expectedTransfer);
        expect(payload.flags).toEqual({ mymod: { keep: true } });
      }
    }
  });

  const WORLD_BATCH_FIXTURES = {
    item: {
      documentClass: () => globalThis.game.items.documentClass,
      existingIds: ["item-1"],
      patch: { name: "Bulk Renamed Item" },
      notFound: "ITEM_NOT_FOUND",
      label: "item",
      name: "Bulk Renamed Item"
    },
    actor: {
      documentClass: () => globalThis.game.actors.documentClass,
      existingIds: ["actor-1"],
      patch: { name: "Bulk Renamed Actor" },
      notFound: "ACTOR_NOT_FOUND",
      label: "actor",
      name: "Bulk Renamed Actor"
    },
    journal: {
      documentClass: () => globalThis.game.journal.documentClass,
      existingIds: ["journal-1"],
      patch: { name: "Bulk Renamed Journal" },
      notFound: "JOURNAL_NOT_FOUND",
      label: "journal entry",
      name: "Bulk Renamed Journal"
    }
  };

  it("declares NO create-many for any world-document family (bulk world-doc create is out of scope)", () => {
    for (const family of Object.keys(WORLD_BATCH_FIXTURES)) {
      expect(COMMAND_NAMES, `${family}.create-many must not exist`).not.toContain(`${family}.create-many`);
      expect(COMMAND_NAMES).toContain(`${family}.update-many`);
      expect(COMMAND_NAMES).toContain(`${family}.delete-many`);
    }
  });

  it("round-trips update-many / delete-many for every world-document family", async () => {
    for (const [family, fixture] of Object.entries(WORLD_BATCH_FIXTURES)) {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const DocumentClass = fixture.documentClass();
      DocumentClass.updateDocuments.mockClear();

      const updated = await router.route(
        createRequest(`${family}.update-many`, {
          patches: [{ id: fixture.existingIds[0], patch: { ...fixture.patch } }]
        })
      );
      expect(updated.ok, `${family}.update-many: ${JSON.stringify(updated.error)}`).toBe(true);
      expect(updated.result.complete).toBe(true);
      expect(updated.result.outcomes).toEqual([
        { index: 0, id: fixture.existingIds[0], status: "updated", name: fixture.name }
      ]);

      expect(updated.result).not.toHaveProperty("sceneId");

      expect(DocumentClass.updateDocuments).toHaveBeenCalledTimes(1);
      expect(DocumentClass.updateDocuments.mock.calls[0][0]).toEqual([
        { _id: fixture.existingIds[0], ...fixture.patch }
      ]);
      expect(DocumentClass.updateDocuments.mock.calls[0][1]).toMatchObject({ diff: true, render: true });

      DocumentClass.deleteDocuments.mockClear();
      const deleted = await router.route(
        createRequest(`${family}.delete-many`, {
          ids: [...fixture.existingIds, `${family}-does-not-exist`],
          ...(family === "actor" ? { force: true } : {})
        })
      );
      expect(deleted.ok, `${family}.delete-many: ${JSON.stringify(deleted.error)}`).toBe(true);
      expect(deleted.result.outcomes.map((outcome) => outcome.status)).toEqual(["deleted", "alreadyDeleted"]);

      expect(deleted.result.outcomes[0]).toEqual({ index: 0, id: fixture.existingIds[0], status: "deleted" });
      expect(DocumentClass.deleteDocuments).toHaveBeenCalledTimes(1);
      expect(DocumentClass.deleteDocuments.mock.calls[0][0]).toEqual(fixture.existingIds);
      expect(DocumentClass.deleteDocuments.mock.calls[0][1]).toMatchObject({ render: true });
    }
  });

  it("previews update-many / delete-many without writing, for every world-document family", async () => {
    globalThis.game.items.set(createDocument("item-preview-twin", { name: "Preview Second", type: "loot" }));
    globalThis.game.actors.set(createActorDocument("actor-preview-twin", { name: "Preview Second" }));
    globalThis.game.journal.set(
      createJournalDocument("journal-preview-twin", { name: "Preview Second", pages: [] })
    );
    const secondIds = {
      item: "item-preview-twin",
      actor: "actor-preview-twin",
      journal: "journal-preview-twin"
    };
    const idKeys = { item: "itemId", actor: "actorId", journal: "journalId" };
    const getKeys = { item: "item", actor: "actor", journal: "journal" };

    for (const [family, fixture] of Object.entries(WORLD_BATCH_FIXTURES)) {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const DocumentClass = fixture.documentClass();
      const targetId = fixture.existingIds[0];
      const secondId = secondIds[family];
      const storedName = async (id) => {
        const read = await router.route(createRequest(`${family}.get`, { [idKeys[family]]: id }));
        expect(read.ok, `${family}.get ${id}: ${JSON.stringify(read.error)}`).toBe(true);
        return read.result[getKeys[family]].name;
      };
      const nameBefore = await storedName(targetId);
      DocumentClass.updateDocuments.mockClear();
      DocumentClass.deleteDocuments.mockClear();

      const updated = await router.route(
        createRequest(`${family}.update-many`, {
          patches: [
            { id: targetId, patch: { name: "Renamed By Preview" } },

            { id: secondId, patch: { name: "Preview Second" } }
          ],
          dryRun: true
        })
      );
      expect(updated.ok, `${family}.update-many --dry-run: ${JSON.stringify(updated.error)}`).toBe(true);
      expect(updated.result.dryRun).toBe(true);
      expect(updated.result.complete).toBe(true);
      expect(updated.result.outcomes).toEqual([
        { index: 0, id: targetId, status: "updated", name: nameBefore },
        { index: 1, id: secondId, status: "unchanged", name: "Preview Second" }
      ]);

      expect(updated.result).not.toHaveProperty("sceneId");

      const deleted = await router.route(
        createRequest(`${family}.delete-many`, {
          ids: [targetId, secondId, `${family}-does-not-exist`],
          ...(family === "actor" ? { force: true } : {}),
          dryRun: true
        })
      );
      expect(deleted.ok, `${family}.delete-many --dry-run: ${JSON.stringify(deleted.error)}`).toBe(true);
      expect(deleted.result.dryRun).toBe(true);
      expect(deleted.result.complete).toBe(true);
      expect(deleted.result.outcomes).toEqual([
        { index: 0, id: targetId, status: "deleted" },
        { index: 1, id: secondId, status: "deleted" },
        { index: 2, id: `${family}-does-not-exist`, status: "alreadyDeleted" }
      ]);

      expect(
        DocumentClass.updateDocuments,
        `${family}: an update preview must not dispatch`
      ).not.toHaveBeenCalled();
      expect(
        DocumentClass.deleteDocuments,
        `${family}: a delete preview must not dispatch`
      ).not.toHaveBeenCalled();
      expect(await storedName(targetId)).toBe(nameBefore);
      expect(await storedName(secondId)).toBe("Preview Second");
    }
  });

  it("rejects the WHOLE world-doc update-many naming the index when an element id does not resolve", async () => {
    for (const [family, fixture] of Object.entries(WORLD_BATCH_FIXTURES)) {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const DocumentClass = fixture.documentClass();
      DocumentClass.updateDocuments.mockClear();

      const response = await router.route(
        createRequest(`${family}.update-many`, {
          patches: [
            { id: fixture.existingIds[0], patch: { ...fixture.patch } },
            { id: `${family}-nope`, patch: { ...fixture.patch } }
          ]
        })
      );
      expect(response.ok).toBe(false);

      expect(response.error.code).toBe(ERROR_CODES[fixture.notFound]);
      expect(response.error.details).toMatchObject({ index: 1 });
      expect(response.error.message).toBe(
        `${family}.update-many element 1 names ${fixture.label} ${family}-nope, which was not found; ` +
          `use ${family}.list to find valid ids. Nothing was written.`
      );

      const single = await router.route(
        createRequest(`${family}.update`, {
          [`${family === "journal" ? "journal" : family}Id`]: `${family}-nope`,
          patch: { ...fixture.patch }
        })
      );
      expect(single.ok).toBe(false);
      expect(single.error.code).toBe(ERROR_CODES[fixture.notFound]);
      expect(single.error.message).not.toContain("Nothing was written");
      expect(single.error.details).not.toHaveProperty("index");
      expect(DocumentClass.updateDocuments).not.toHaveBeenCalled();
    }
  });

  it("prepares a world-doc update element EXACTLY as the single update verb does (FilePath included)", async () => {
    const cases = {
      item: {
        patch: { name: "Golden", img: "worlds/world-1/icons/sword 1.svg" },
        canonical: "worlds/world-1/icons/sword%201.svg"
      },
      actor: {
        patch: { name: "Golden", img: "worlds/world-1/icons/hero 1.svg" },
        canonical: "worlds/world-1/icons/hero%201.svg"
      },
      journal: { patch: { name: "Golden" }, canonical: null }
    };

    const singleTargets = { item: "item-1", actor: "actor-1", journal: "journal-1" };
    globalThis.game.items.set(createDocument("item-golden-twin", { name: "Twin", type: "loot" }));
    globalThis.game.actors.set(createActorDocument("actor-golden-twin", { name: "Twin" }));
    globalThis.game.journal.set(createJournalDocument("journal-golden-twin", { name: "Twin", pages: [] }));
    const batchTargets = {
      item: "item-golden-twin",
      actor: "actor-golden-twin",
      journal: "journal-golden-twin"
    };
    const idKeys = { item: "itemId", actor: "actorId", journal: "journalId" };
    for (const [family, { patch, canonical }] of Object.entries(cases)) {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const DocumentClass = WORLD_BATCH_FIXTURES[family].documentClass();
      const targetId = singleTargets[family];
      const batchTargetId = batchTargets[family];
      const target =
        family === "item"
          ? globalThis.game.items.get(targetId)
          : family === "actor"
            ? globalThis.game.actors.get(targetId)
            : globalThis.game.journal.get(targetId);

      target.update.mockClear();
      const single = await router.route(
        createRequest(`${family}.update`, { [idKeys[family]]: targetId, patch: { ...patch } })
      );
      expect(single.ok, `${family}.update: ${JSON.stringify(single.error)}`).toBe(true);
      const singlePatch = target.update.mock.calls.at(-1)[0];

      DocumentClass.updateDocuments.mockClear();
      const batch = await router.route(
        createRequest(`${family}.update-many`, { patches: [{ id: batchTargetId, patch: { ...patch } }] })
      );
      expect(batch.ok, `${family}.update-many: ${JSON.stringify(batch.error)}`).toBe(true);
      expect(DocumentClass.updateDocuments, `${family}.update-many must dispatch`).toHaveBeenCalledTimes(1);
      const { _id, ...batchPatch } = DocumentClass.updateDocuments.mock.calls[0][0][0];
      expect(_id).toBe(batchTargetId);
      expect(batchPatch, `${family} batch element preparation diverged from the single verb`).toEqual(
        singlePatch
      );
      if (canonical) {
        expect(singlePatch.img).toBe(canonical);
        expect(batchPatch.img).toBe(canonical);
      } else {
        expect(batchPatch).toEqual({ name: "Golden" });
      }
    }
  });

  it("runs the single verb's delete guard PER ELEMENT on actor.delete-many, naming the index", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const DocumentClass = globalThis.game.actors.documentClass;
    DocumentClass.deleteDocuments.mockClear();

    globalThis.game.actors.set(createActorDocument("actor-2", { name: "Ezren" }));

    const refused = await router.route(createRequest("actor.delete-many", { ids: ["actor-2", "actor-1"] }));
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe(ERROR_CODES.DELETE_FORBIDDEN);
    expect(refused.error.details).toMatchObject({ index: 1, actorId: "actor-1" });
    expect(refused.error.details.tokenReferences.length).toBeGreaterThan(0);
    expect(refused.error.message).toContain("element 1");
    expect(refused.error.message).toContain("Nothing was written");

    expect(DocumentClass.deleteDocuments).not.toHaveBeenCalled();

    const preview = await router.route(
      createRequest("actor.delete-many", { ids: ["actor-2", "actor-1"], dryRun: true })
    );
    expect(preview.ok).toBe(false);
    expect(preview.error.code).toBe(ERROR_CODES.DELETE_FORBIDDEN);
    expect(preview.error.details).toMatchObject({ index: 1 });

    const forced = await router.route(
      createRequest("actor.delete-many", { ids: ["actor-2", "actor-1"], force: true })
    );
    expect(forced.ok, JSON.stringify(forced.error)).toBe(true);
    expect(forced.result.outcomes.map((outcome) => outcome.status)).toEqual(["deleted", "deleted"]);
  });

  it("pins guard ORDER on actor.delete-many: the size cap and duplicate-id refusal beat the delete guard", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const duplicate = await router.route(createRequest("actor.delete-many", { ids: ["actor-1", "actor-1"] }));
    expect(duplicate.ok).toBe(false);
    expect(duplicate.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(duplicate.error.message).toContain("twice");

    const oversized = await router.route(
      createRequest("actor.delete-many", {
        ids: ["actor-1", ...Array.from({ length: 100 }, (_unused, index) => `filler-${index}`)]
      })
    );
    expect(oversized.ok).toBe(false);
    expect(oversized.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(oversized.error.message).toContain("at most");
  });

  it("REACHES the array guard's migrated arms through actor.update-many (documentClass is passed)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const DocumentClass = globalThis.game.actors.documentClass;

    DocumentClass.schema = {
      get: (key) =>
        key === "system"
          ? { clean: (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {}) }
          : null
    };
    DocumentClass.migrateData = (source) => {
      const migrated = { ...source };
      if (Array.isArray(migrated.resistances)) {
        migrated.system = { ...(migrated.system ?? {}), resistances: [...migrated.resistances] };
        delete migrated.resistances;
      }
      return migrated;
    };

    const isValidEntry = (entry) => typeof entry === "string" && entry.length > 0;
    const resistancesField = {
      clean: (entries) => (Array.isArray(entries) ? entries.map((entry) => entry) : [])
    };
    const modelSystem = (document) => {
      const system = document.system;
      if (system && typeof system === "object" && !Object.prototype.hasOwnProperty.call(system, "schema")) {
        Object.defineProperty(system, "schema", {
          value: { get: (key) => (key === "resistances" ? resistancesField : null) },
          enumerable: false,
          configurable: true
        });
      }
      return document;
    };

    const modelSystemMerge = (document) => {
      const innerClone = document.clone;
      document.clone = vi.fn(async (patch = {}, context = {}) =>
        modelSystemMerge(await innerClone(patch, context))
      );
      const innerUpdateSource = document.updateSource.bind(document);
      document.updateSource = function updateSource(patch = {}, context = {}) {
        const migrated = DocumentClass.migrateData(patch ?? {});

        if (Object.hasOwn(migrated, "system.resistances")) {
          const direct = migrated["system.resistances"];
          delete migrated["system.resistances"];
          migrated.system = { ...(migrated.system ?? {}), resistances: direct };
        }
        const entries = migrated?.system?.resistances;
        if (Array.isArray(entries)) {
          if (entries.some((entry) => !isValidEntry(entry))) {
            delete migrated.system.resistances;
            if (Object.keys(migrated.system).length === 0) delete migrated.system;
          } else {
            migrated.system.resistances = resistancesField.clean(entries);
          }
        }
        const result = innerUpdateSource(migrated, context);
        modelSystem(document);
        return result;
      };
      return modelSystem(document);
    };
    modelSystemMerge(globalThis.game.actors.get("actor-1"));
    DocumentClass.updateDocuments.mockClear();

    for (const patch of [
      { resistances: ["fire"] },
      { "resistances.0": "fire" },
      { "==resistances": ["fire"] },
      { "system.resistances": ["fire"] }
    ]) {
      const rejected = await router.route(
        createRequest("actor.update-many", { patches: [{ id: "actor-1", patch }] })
      );
      expect(rejected.ok, `${JSON.stringify(patch)} must be rejected`).toBe(false);
      expect(rejected.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(rejected.error.details ?? {}).not.toHaveProperty("movedTo");
    }

    const refused = await router.route(
      createRequest("actor.update-many", {
        patches: [{ id: "actor-1", patch: { system: { resistances: ["fire", 7] } } }]
      })
    );
    expect(refused.ok, "a silently-discarded array must not answer ok").toBe(false);
    expect(refused.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(refused.error.message).toContain("SILENTLY DISCARDS");
    expect(refused.error.details).toMatchObject({
      index: 0,
      id: "actor-1",
      arrayField: "resistances",
      movedTo: "system.resistances"
    });

    expect(DocumentClass.updateDocuments).not.toHaveBeenCalled();

    const previewed = await router.route(
      createRequest("actor.update-many", {
        patches: [{ id: "actor-1", patch: { system: { resistances: ["fire", 7] } } }],
        dryRun: true
      })
    );
    expect(previewed.ok, "the same refusal must fire on the preview path").toBe(false);
    expect(previewed.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(previewed.error.message).toContain("SILENTLY DISCARDS");

    const allowed = await router.route(
      createRequest("actor.update-many", {
        patches: [{ id: "actor-1", patch: { system: { resistances: ["fire"] } } }]
      })
    );
    expect(allowed.ok, JSON.stringify(allowed.error)).toBe(true);
    expect(allowed.result.outcomes[0]).toMatchObject({ index: 0, id: "actor-1", status: "updated" });
    expect(DocumentClass.updateDocuments).toHaveBeenCalledTimes(1);
  });
});
