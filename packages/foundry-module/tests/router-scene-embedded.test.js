import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";

import {
  prepareSceneEmbeddedCreateData,
  prepareSceneEmbeddedUpdateData
} from "../scripts/lib/scene-embedded.js";

import { createRequest, installFakeFoundry, makeDataModelValidationError } from "./helpers/fake-foundry.js";

describe("command router", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  it("lists and gets scene tokens", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("scene.token.list", { sceneId: "scene-1" }));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.tokens).toHaveLength(2);
    expect(listResponse.result.tokens.find((token) => token.id === "token-a")).toMatchObject({
      actorId: "actor-1",
      actorLink: false
    });

    const getResponse = await router.route(
      createRequest("scene.token.get", { sceneId: "scene-1", tokenId: "token-a" })
    );
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.token.name).toBe("Valeros Token");
    expect(getResponse.result.token.texture).toEqual({ src: "tokens/valeros.webp" });
  });

  it("scene.token.get passes include:['prepared'] to the serializer, and omits the key without it", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const plainResponse = await router.route(
      createRequest("scene.token.get", { sceneId: "scene-1", tokenId: "token-a" })
    );
    expect(plainResponse.ok).toBe(true);
    expect("prepared" in plainResponse.result.token).toBe(false);

    const preparedResponse = await router.route(
      createRequest("scene.token.get", { sceneId: "scene-1", tokenId: "token-a", include: ["prepared"] })
    );
    expect(preparedResponse.ok).toBe(true);
    expect(preparedResponse.result.token.prepared).toEqual({
      detectionModes: null,
      sight: null,
      light: null,
      system: null
    });
  });

  it("creates a token from an actor, defaulting to unlinked", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.token.create", {
        sceneId: "scene-1",
        data: { actorId: "actor-1", x: 200, y: 240 }
      })
    );

    expect(response.ok).toBe(true);

    expect(response.result.token.texture).toEqual({ src: "prototype.webp" });
    expect(response.result.token.actorId).toBe("actor-1");
    expect(response.result.token.actorLink).toBe(false);
    expect(response.result.token).toMatchObject({ x: 200, y: 240 });
  });

  it("creates a linked token when actorLink is requested", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.token.create", {
        sceneId: "scene-1",
        data: { actorId: "actor-1", x: 10, y: 10, actorLink: true }
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.token.actorLink).toBe(true);
  });

  it("creates a raw token without an actor", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.token.create", {
        sceneId: "scene-1",
        data: { name: "Trap Marker", x: 5, y: 5, texture: { src: "markers/trap.webp" } }
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.token.actorId).toBe(null);
    expect(response.result.token.name).toBe("Trap Marker");
  });

  it("updates, clones, and deletes scene tokens", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const updateResponse = await router.route(
      createRequest("scene.token.update", {
        sceneId: "scene-1",
        tokenId: "token-a",
        patch: { x: 999, hidden: true }
      })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.token).toMatchObject({ x: 999, hidden: true });

    const cloneResponse = await router.route(
      createRequest("scene.token.clone", {
        sceneId: "scene-1",
        tokenId: "token-a",
        patch: { x: 300 }
      })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.token.id).toBe("token-a-clone");

    expect(cloneResponse.result.token.actorLink).toBe(false);
    expect(cloneResponse.result.token.x).toBe(300);

    const afterClone = await router.route(
      createRequest("scene.token.get", { sceneId: "scene-1", tokenId: "token-a-clone" })
    );
    expect(afterClone.ok).toBe(true);
    expect(afterClone.result.token.id).toBe("token-a-clone");

    const deleteResponse = await router.route(
      createRequest("scene.token.delete", { sceneId: "scene-1", tokenId: "token-a" })
    );
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ sceneId: "scene-1", id: "token-a", deleted: true });
  });

  it("returns TOKEN_NOT_FOUND for a missing token", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.token.get", { sceneId: "scene-1", tokenId: "missing" })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("TOKEN_NOT_FOUND");
  });

  it("manages items on an unlinked token's delta actor without touching the world actor", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(
      createRequest("scene.token.item.list", { sceneId: "scene-1", tokenId: "token-a" })
    );
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.actorLink).toBe(false);
    expect(listResponse.result.items).toHaveLength(1);
    expect(listResponse.result.items[0].name).toBe("Dagger");

    const createResponse = await router.route(
      createRequest("scene.token.item.create", {
        sceneId: "scene-1",
        tokenId: "token-a",
        data: { name: "Flaming Longsword", type: "weapon", system: { damage: "2d6" } }
      })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.actorLink).toBe(false);
    expect(createResponse.result.mutatesWorldActor).toBe(false);
    expect(createResponse.result.item.name).toBe("Flaming Longsword");

    const afterList = await router.route(
      createRequest("scene.token.item.list", { sceneId: "scene-1", tokenId: "token-a" })
    );
    expect(afterList.result.items.map((item) => item.name)).toContain("Flaming Longsword");

    const worldItems = await router.route(createRequest("actor.item.list", { actorId: "actor-1" }));
    expect(worldItems.result.items.map((item) => item.name)).not.toContain("Flaming Longsword");
  });

  it("flags mutatesWorldActor when editing a linked token's items", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const createResponse = await router.route(
      createRequest("scene.token.item.create", {
        sceneId: "scene-1",
        tokenId: "token-linked",
        data: { name: "Shared Potion", type: "consumable" }
      })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.actorLink).toBe(true);
    expect(createResponse.result.mutatesWorldActor).toBe(true);

    const worldItems = await router.route(createRequest("actor.item.list", { actorId: "actor-1" }));
    expect(worldItems.result.items.map((item) => item.name)).toContain("Shared Potion");
  });

  it("gets, updates, and deletes token items, and reports ITEM_NOT_FOUND for a missing one", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const getResponse = await router.route(
      createRequest("scene.token.item.get", {
        sceneId: "scene-1",
        tokenId: "token-a",
        itemId: "delta-item-1"
      })
    );
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.item.name).toBe("Dagger");

    const updateResponse = await router.route(
      createRequest("scene.token.item.update", {
        sceneId: "scene-1",
        tokenId: "token-a",
        itemId: "delta-item-1",
        patch: { name: "Silvered Dagger" }
      })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.item.name).toBe("Silvered Dagger");

    const deleteResponse = await router.route(
      createRequest("scene.token.item.delete", {
        sceneId: "scene-1",
        tokenId: "token-a",
        itemId: "delta-item-1"
      })
    );
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: "delta-item-1", deleted: true });

    const missing = await router.route(
      createRequest("scene.token.item.get", {
        sceneId: "scene-1",
        tokenId: "token-a",
        itemId: "delta-item-1"
      })
    );
    expect(missing.ok).toBe(false);
    expect(missing.error.code).toBe("ITEM_NOT_FOUND");
  });

  it("lists, gets, creates, updates, clones, and deletes scene tiles", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("scene.tile.list", { sceneId: "scene-1" }));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.tiles).toHaveLength(1);

    const getResponse = await router.route(
      createRequest("scene.tile.get", { sceneId: "scene-1", tileId: "tile-a" })
    );
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.tile.texture).toEqual({ src: "tiles/floor.webp" });

    const createResponse = await router.route(
      createRequest("scene.tile.create", {
        sceneId: "scene-1",
        data: { x: 0, y: 0, width: 100, height: 100, texture: { src: "tiles/wall.webp" } }
      })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.tile.texture).toEqual({ src: "tiles/wall.webp" });

    const updateResponse = await router.route(
      createRequest("scene.tile.update", { sceneId: "scene-1", tileId: "tile-a", patch: { hidden: true } })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.tile.hidden).toBe(true);

    const cloneResponse = await router.route(
      createRequest("scene.tile.clone", { sceneId: "scene-1", tileId: "tile-a", patch: { x: 500 } })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.tile.id).toBe("tile-a-clone");
    expect(cloneResponse.result.tile.x).toBe(500);

    const deleteResponse = await router.route(
      createRequest("scene.tile.delete", { sceneId: "scene-1", tileId: "tile-a" })
    );
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: "tile-a", deleted: true });

    const missing = await router.route(
      createRequest("scene.tile.get", { sceneId: "scene-1", tileId: "tile-a" })
    );
    expect(missing.error.code).toBe("TILE_NOT_FOUND");
  });

  it("canonicalizes a flattened texture.src dot-key patch before handing it to Foundry", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.tile.update", {
        sceneId: "scene-1",
        tileId: "tile-a",
        patch: { "texture.src": "worlds/world-1/maps/my map (v2).webp" }
      })
    );
    expect(response.ok).toBe(true);

    const updateCall = scene.updateEmbeddedDocuments.mock.calls.find(([type]) => type === "Tile");
    expect(updateCall).toBeDefined();
    const [, entries] = updateCall;
    expect(entries[0]["texture.src"]).toBe("worlds/world-1/maps/my%20map%20(v2).webp");
  });

  it("lists, gets, creates, updates, clones, and deletes scene walls", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("scene.wall.list", { sceneId: "scene-1" }));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.walls).toHaveLength(3);

    expect(listResponse.result.walls[0]).toEqual({
      id: "wall-plain",
      _id: "wall-plain",
      c: [0, 0, 100, 0],
      door: 0,
      ds: 0,
      doorSound: ""
    });

    const doorList = await router.route(createRequest("scene.wall.list", { sceneId: "scene-1", door: true }));
    expect(doorList.ok).toBe(true);
    expect(doorList.result.walls.map((w) => w.id)).toEqual(["wall-door", "wall-secret"]);
    expect(doorList.result.total).toBe(2);

    const getResponse = await router.route(
      createRequest("scene.wall.get", { sceneId: "scene-1", wallId: "wall-door" })
    );
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.wall.doorSound).toBe("woodBasic");
    expect(getResponse.result.wall.c).toEqual([0, 0, 0, 100]);

    expect(getResponse.result.wall).not.toHaveProperty("name");

    const createResponse = await router.route(
      createRequest("scene.wall.create", {
        sceneId: "scene-1",
        data: { c: [200, 200, 300, 200], door: 1, ds: 0 }
      })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.wall.c).toEqual([200, 200, 300, 200]);

    const updateResponse = await router.route(
      createRequest("scene.wall.update", {
        sceneId: "scene-1",
        wallId: "wall-door",
        patch: { doorSound: "metalBasic" }
      })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.wall.doorSound).toBe("metalBasic");

    const cloneResponse = await router.route(
      createRequest("scene.wall.clone", { sceneId: "scene-1", wallId: "wall-door", patch: { ds: 1 } })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.wall.id).toBe("wall-door-clone");
    expect(cloneResponse.result.wall.ds).toBe(1);

    const deleteResponse = await router.route(
      createRequest("scene.wall.delete", { sceneId: "scene-1", wallId: "wall-door" })
    );
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: "wall-door", deleted: true });

    const missing = await router.route(
      createRequest("scene.wall.get", { sceneId: "scene-1", wallId: "wall-door" })
    );
    expect(missing.error.code).toBe("WALL_NOT_FOUND");
    expect(missing.error.message).toContain("scene.wall.list");
  });

  it("scene.wall create/update dry-run previews without persisting", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const createPreview = await router.route(
      createRequest("scene.wall.create", {
        sceneId: "scene-1",
        data: { c: [1, 2, 3, 4], door: 1 },
        dryRun: true
      })
    );
    expect(createPreview.ok).toBe(true);
    expect(createPreview.result.dryRun).toBe(true);
    expect(createPreview.result.wall.c).toEqual([1, 2, 3, 4]);

    const afterCreate = await router.route(createRequest("scene.wall.list", { sceneId: "scene-1" }));
    expect(afterCreate.result.walls).toHaveLength(3);

    const updatePreview = await router.route(
      createRequest("scene.wall.update", {
        sceneId: "scene-1",
        wallId: "wall-door",
        patch: { doorSound: "metalHeavy" },
        dryRun: true
      })
    );
    expect(updatePreview.ok).toBe(true);
    expect(updatePreview.result.dryRun).toBe(true);

    expect(updatePreview.result.wall.doorSound).toBe("metalHeavy");
    expect(updatePreview.result).not.toHaveProperty("preview");

    const afterUpdate = await router.route(
      createRequest("scene.wall.get", { sceneId: "scene-1", wallId: "wall-door" })
    );
    expect(afterUpdate.result.wall.doorSound).toBe("woodBasic");
  });

  it("scene.wall.create strips protected meta (_id/_stats/ownership) from the payload", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.wall.create", {
        sceneId: "scene-1",
        data: {
          _id: "spoofed",
          _stats: { createdTime: 1 },
          ownership: { default: 3 },
          c: [5, 5, 6, 6],
          door: 0
        }
      })
    );
    expect(response.ok).toBe(true);

    expect(response.result.wall.id).not.toBe("spoofed");
    expect(response.result.wall.c).toEqual([5, 5, 6, 6]);
  });

  it("scene.wall.create-many creates every element in ONE keepId call and reports per-element outcomes", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.wall.create-many", {
        sceneId: "scene-1",
        data: [
          { c: [10, 10, 20, 20] },
          { c: [20, 20, 30, 30], door: 1 },
          { c: [30, 30, 40, 40], doorSound: "woodBasic" }
        ]
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.sceneId).toBe("scene-1");
    expect(response.result.complete).toBe(true);
    expect(response.result.outcomes.map((outcome) => [outcome.index, outcome.status])).toEqual([
      [0, "created"],
      [1, "created"],
      [2, "created"]
    ]);

    const createCalls = scene.createEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall");
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0][1]).toHaveLength(3);
    expect(createCalls[0][2]).toEqual({ keepId: true, render: true });

    for (const outcome of response.result.outcomes) {
      expect(scene.walls.get(outcome.id)).toBeTruthy();
    }
    expect(scene.walls.size).toBe(6);
  });

  it("scene.wall.create-many strips a CALLER _id/_stats/ownership but keeps the bridge's own id", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.wall.create-many", {
        sceneId: "scene-1",
        data: [
          {
            _id: "spoofedwallid001",
            "==_stats": { systemId: "hacked" },
            "ownership.user-1": 3,
            c: [1, 1, 2, 2]
          }
        ]
      })
    );

    expect(response.ok).toBe(true);
    const [id] = response.result.outcomes.map((outcome) => outcome.id);
    expect(id).not.toBe("spoofedwallid001");
    const payload = scene.createEmbeddedDocuments.mock.calls
      .filter((call) => call[0] === "Wall")
      .at(-1)[1][0];
    expect(payload._id).toBe(id);
    expect(payload).not.toHaveProperty("==_stats");
    expect(payload).not.toHaveProperty("ownership.user-1");
  });

  it("scene.wall.create-many rejects the WHOLE call for one invalid element and writes nothing", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    const before = scene.walls.size;

    const response = await router.route(
      createRequest("scene.wall.create-many", {
        sceneId: "scene-1",
        data: [{ c: [1, 1, 2, 2] }, { c: [2, 2, 3, 3], door: "invalid-preview" }]
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(scene.createEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")).toHaveLength(0);
    expect(scene.walls.size).toBe(before);
  });

  const rejectWallCreateValue = (scene, value) => {
    const RealClass = scene.walls.documentClass;
    scene.walls.documentClass = function WallPreview(source, context) {
      if (source?.doorSound === value) {
        throw makeDataModelValidationError(`doorSound: ${value} is not a valid choice`);
      }
      return new RealClass(source, context);
    };
  };

  it("scene.wall.create-many names the ELEMENT INDEX when the DataModel refuses one element", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    rejectWallCreateValue(scene, "not-a-registered-sound");

    const response = await router.route(
      createRequest("scene.wall.create-many", {
        sceneId: "scene-1",
        data: [{ c: [1, 1, 2, 2] }, { c: [2, 2, 3, 3], doorSound: "not-a-registered-sound" }]
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");

    expect(response.error.details).toEqual({
      index: 1,
      reason: "foundry_validation",
      message: "doorSound: not-a-registered-sound is not a valid choice",
      errors: ["doorSound"]
    });

    expect(response.error.details).not.toHaveProperty("id");
    expect(scene.createEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")).toHaveLength(0);
  });

  it("scene.wall.create-many --dry-run names the same ELEMENT INDEX the real call would", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    rejectWallCreateValue(scene, "not-a-registered-sound");

    const response = await router.route(
      createRequest("scene.wall.create-many", {
        sceneId: "scene-1",
        data: [{ c: [1, 1, 2, 2] }, { c: [2, 2, 3, 3], doorSound: "not-a-registered-sound" }],
        dryRun: true
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details).toMatchObject({ index: 1, reason: "foundry_validation" });
    expect(scene.createEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")).toHaveLength(0);
  });

  it("scene.wall.create-many refuses more than BATCH_WRITE_MAX_ITEMS elements", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const response = await router.route(
      createRequest("scene.wall.create-many", {
        sceneId: "scene-1",
        data: Array.from({ length: 101 }, (_unused, index) => ({ c: [index, 0, index, 10] }))
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.message).toContain("at most 100 data per call");
    expect(response.error.details).toEqual({ max: 100, received: 101, field: "data" });
  });

  it("scene.wall.create-many dry-run mints NO ids and persists nothing", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    const before = scene.walls.size;

    const response = await router.route(
      createRequest("scene.wall.create-many", {
        sceneId: "scene-1",
        data: [{ c: [1, 1, 2, 2] }, { c: [3, 3, 4, 4] }],
        dryRun: true
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({
      sceneId: "scene-1",
      complete: true,
      dryRun: true,
      outcomes: [
        { index: 0, id: null, status: "created" },
        { index: 1, id: null, status: "created" }
      ]
    });
    expect(scene.walls.size).toBe(before);
    expect(scene.createEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")).toHaveLength(0);
  });

  it("scene.wall.create-many rejects an unknown scene with SCENE_NOT_FOUND before any element work", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const response = await router.route(
      createRequest("scene.wall.create-many", { sceneId: "nope", data: [{ c: [1, 1, 2, 2] }] })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("SCENE_NOT_FOUND");

    expect(response.error.message).not.toContain("element ");
    expect(response.error.message).not.toContain("Nothing was written");
    expect(response.error.details).not.toHaveProperty("index");
  });

  it("scene.wall.update-many patches every element in ONE diff:true call and reports input order", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [
          { id: "wall-plain", patch: { door: 1 } },
          { id: "wall-secret", patch: { doorSound: "metalBasic" } }
        ]
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(response.result.outcomes).toEqual([
      { index: 0, id: "wall-plain", status: "updated" },
      { index: 1, id: "wall-secret", status: "updated" }
    ]);
    const updateCalls = scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][1]).toEqual([
      { _id: "wall-plain", door: 1 },
      { _id: "wall-secret", doorSound: "metalBasic" }
    ]);
    expect(updateCalls[0][2]).toEqual({ diff: true, render: true });
    expect(scene.walls.get("wall-plain").door).toBe(1);
  });

  it("scene.wall.update-many reports a NO-OP element as `unchanged` and does not send it", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [
          { id: "wall-door", patch: { door: 1 } },
          { id: "wall-plain", patch: { ds: 1 } }
        ]
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(response.result.outcomes).toEqual([
      { index: 0, id: "wall-door", status: "unchanged" },
      { index: 1, id: "wall-plain", status: "updated" }
    ]);
    expect(scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")[0][1]).toEqual([
      { _id: "wall-plain", ds: 1 }
    ]);
  });

  it("scene.wall.update-many with EVERY element a no-op never calls Foundry and stays complete", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [
          { id: "wall-door", patch: { door: 1 } },
          { id: "wall-secret", patch: { door: 2 } }
        ]
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(response.result.outcomes.map((outcome) => outcome.status)).toEqual(["unchanged", "unchanged"]);
    expect(scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")).toHaveLength(0);
  });

  it("scene.wall.update-many reports WALL_NOT_FOUND naming the INDEX and writes nothing", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [
          { id: "wall-plain", patch: { door: 1 } },
          { id: "wall-missing", patch: { door: 1 } }
        ]
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("WALL_NOT_FOUND");
    expect(response.error.details).toEqual({ sceneId: "scene-1", wallId: "wall-missing", index: 1 });
    expect(response.error.message).toContain("scene.wall.list");
    expect(response.error.message).toContain("Nothing was written");
    expect(scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")).toHaveLength(0);
    expect(scene.walls.get("wall-plain").door).toBe(0);
  });

  const rejectWallPatchKey = (wall, key) => {
    const realClone = wall.clone;
    wall.clone = vi.fn(async (patch, context) => {
      const copy = await realClone(patch, context);
      const baseUpdateSource = copy.updateSource.bind(copy);
      copy.updateSource = (raw = {}, ctx = {}) => {
        if (Object.hasOwn(raw ?? {}, key)) {
          throw makeDataModelValidationError(`${key}: ${raw[key]} is not a valid choice`);
        }
        return baseUpdateSource(raw, ctx);
      };
      return copy;
    });
  };

  it("scene.wall.update-many names the ELEMENT INDEX and ID when the DataModel refuses a patch", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    rejectWallPatchKey(scene.walls.get("wall-plain"), "doorSound");

    const response = await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [
          { id: "wall-door", patch: { ds: 1 } },
          { id: "wall-plain", patch: { doorSound: "not-a-registered-sound" } }
        ]
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details).toEqual({
      index: 1,
      id: "wall-plain",
      reason: "foundry_validation",
      message: "doorSound: not-a-registered-sound is not a valid choice",
      errors: ["doorSound"]
    });
    expect(scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")).toHaveLength(0);
    expect(scene.walls.get("wall-door").ds).toBe(0);
  });

  it("scene.wall.update-many reports the FIRST OFFENDING ELEMENT, whichever gate it trips", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    rejectWallPatchKey(scene.walls.get("wall-plain"), "doorSound");

    const badPatchFirst = await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [
          { id: "wall-plain", patch: { doorSound: "not-a-registered-sound" } },
          { id: "wall-missing", patch: { ds: 1 } }
        ]
      })
    );
    expect(badPatchFirst.ok).toBe(false);
    expect(badPatchFirst.error.code).toBe("INVALID_PARAMS");
    expect(badPatchFirst.error.details).toMatchObject({ index: 0, id: "wall-plain" });

    const missingFirst = await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [
          { id: "wall-missing", patch: { ds: 1 } },
          { id: "wall-plain", patch: { doorSound: "not-a-registered-sound" } }
        ]
      })
    );
    expect(missingFirst.ok).toBe(false);
    expect(missingFirst.error.code).toBe("WALL_NOT_FOUND");
    expect(missingFirst.error.details).toMatchObject({ index: 0, wallId: "wall-missing" });

    expect(scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")).toHaveLength(0);
  });

  it("scene.wall.update-many rejects the same id twice, naming both indices", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [
          { id: "wall-plain", patch: { door: 1 } },
          { id: "wall-plain", patch: { ds: 1 } }
        ]
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.message).toContain("twice (indices 0 and 1)");
    expect(scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")).toHaveLength(0);
  });

  it("scene.wall.update-many ignores a patch `_id` — the element's `id` is the only address", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [{ id: "wall-plain", patch: { _id: "wall-secret", door: 1 } }]
      })
    );

    expect(response.ok).toBe(true);
    expect(scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")[0][1]).toEqual([
      { _id: "wall-plain", door: 1 }
    ]);
    expect(scene.walls.get("wall-secret").door).toBe(2);
  });

  it("scene.wall.update-many dry-run previews per-element statuses and persists nothing", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [
          { id: "wall-door", patch: { door: 1 } },
          { id: "wall-plain", patch: { door: 1 } }
        ],
        dryRun: true
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({
      sceneId: "scene-1",
      complete: true,
      dryRun: true,
      outcomes: [
        { index: 0, id: "wall-door", status: "unchanged" },
        { index: 1, id: "wall-plain", status: "updated" }
      ]
    });
    expect(scene.walls.get("wall-plain").door).toBe(0);
    expect(scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")).toHaveLength(0);
  });

  it("scene.wall.update-many refuses an array write this core would SILENTLY DISCARD", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    const wall = scene.walls.get("wall-plain");
    wall.constructor.schema = { get: (key) => (key === "c" ? { clean: (value) => value } : null) };
    const realClone = wall.clone;
    wall.clone = vi.fn(async (patch, context) => {
      const copy = await realClone(patch, context);
      const baseUpdateSource = copy.updateSource.bind(copy);
      copy.updateSource = (raw = {}, ctx = {}) =>
        baseUpdateSource(Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "c")), ctx);
      return copy;
    });

    const response = await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [{ id: "wall-plain", patch: { c: [1, 2] } }]
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.message).toContain("SILENTLY DISCARDS");
    expect(response.error.details.field).toBe("c");
    expect(response.error.details.index).toBe(0);
    expect(scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")).toHaveLength(0);
  });

  const modelV14ArrayDrop = (wall) => {
    wall.constructor.schema = { get: (key) => (key === "c" ? { clean: (value) => value } : null) };
    const realClone = wall.clone;
    wall.clone = vi.fn(async (patch, context) => {
      const copy = await realClone(patch, context);
      const baseUpdateSource = copy.updateSource.bind(copy);
      copy.updateSource = (raw = {}, ctx = {}) =>
        baseUpdateSource(
          Object.fromEntries(
            Object.entries(raw).filter(([key]) => key.split(".")[0].replace(/^==/, "") !== "c")
          ),
          ctx
        );
      return copy;
    });
  };

  it("scene.wall.update-many refuses a DOTTED write into an array field", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    modelV14ArrayDrop(scene.walls.get("wall-plain"));

    const response = await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [{ id: "wall-plain", patch: { "c.0": 5 } }]
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.message).toContain('dotted path "c.0"');
    expect(response.error.details).toMatchObject({ index: 0, field: "c.0", arrayField: "c", requested: 5 });
    expect(scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")).toHaveLength(0);
  });

  it("scene.wall.update-many fires the silently-discarded-array guard under --dry-run too", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    modelV14ArrayDrop(scene.walls.get("wall-plain"));

    for (const [patch, expected] of [
      [{ c: [1, 2] }, { field: "c", arrayField: "c" }],
      [{ "c.0": 5 }, { field: "c.0", arrayField: "c" }]
    ]) {
      const response = await router.route(
        createRequest("scene.wall.update-many", {
          sceneId: "scene-1",
          patches: [{ id: "wall-plain", patch }],
          dryRun: true
        })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("SILENTLY DISCARDS");
      expect(response.error.details).toMatchObject({ index: 0, ...expected });
    }
    expect(scene.updateEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")).toHaveLength(0);
  });

  it("scene.wall.delete-many deletes in ONE call and confirms each id by ABSENCE", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.wall.delete-many", { sceneId: "scene-1", ids: ["wall-plain", "wall-secret"] })
    );

    expect(response.ok).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(response.result.outcomes).toEqual([
      { index: 0, id: "wall-plain", status: "deleted" },
      { index: 1, id: "wall-secret", status: "deleted" }
    ]);
    const deleteCalls = scene.deleteEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall");
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][1]).toEqual(["wall-plain", "wall-secret"]);
    expect(scene.walls.get("wall-plain")).toBeFalsy();
  });

  it("scene.wall.delete-many reports an unknown id as `alreadyDeleted` and keeps it OUT of the call", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.wall.delete-many", { sceneId: "scene-1", ids: ["gone-wall-id-01", "wall-plain"] })
    );

    expect(response.ok).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(response.result.outcomes).toEqual([
      { index: 0, id: "gone-wall-id-01", status: "alreadyDeleted" },
      { index: 1, id: "wall-plain", status: "deleted" }
    ]);
    expect(scene.deleteEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")[0][1]).toEqual([
      "wall-plain"
    ]);
  });

  it("scene.wall.delete-many dry-run reports the would-be statuses and deletes nothing", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.wall.delete-many", {
        sceneId: "scene-1",
        ids: ["wall-plain", "gone-wall-id-01"],
        dryRun: true
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({
      sceneId: "scene-1",
      complete: true,
      dryRun: true,
      outcomes: [
        { index: 0, id: "wall-plain", status: "deleted" },
        { index: 1, id: "gone-wall-id-01", status: "alreadyDeleted" }
      ]
    });
    expect(scene.walls.get("wall-plain")).toBeTruthy();
    expect(scene.deleteEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")).toHaveLength(0);
  });

  it("scene.wall.create-many --dry-run FAILS an invalid element exactly as the real call would", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.wall.create-many", {
        sceneId: "scene-1",
        data: [{ c: [1, 1, 2, 2] }, { c: [2, 2, 3, 3], door: "invalid-preview" }],
        dryRun: true
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(scene.createEmbeddedDocuments.mock.calls.filter((call) => call[0] === "Wall")).toHaveLength(0);
  });

  it("scene.wall.create-many --dry-run enforces the element cap", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const response = await router.route(
      createRequest("scene.wall.create-many", {
        sceneId: "scene-1",
        data: Array.from({ length: 101 }, (_unused, index) => ({ c: [index, 0, index, 10] })),
        dryRun: true
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.message).toContain("at most 100 data per call");
  });

  it("scene.wall.update-many --dry-run reports WALL_NOT_FOUND with the index", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const response = await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [
          { id: "wall-plain", patch: { door: 1 } },
          { id: "wall-missing", patch: { door: 1 } }
        ],
        dryRun: true
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("WALL_NOT_FOUND");
    expect(response.error.details).toEqual({ sceneId: "scene-1", wallId: "wall-missing", index: 1 });
  });

  it("scene.wall.delete-many --dry-run rejects a duplicate id", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const response = await router.route(
      createRequest("scene.wall.delete-many", {
        sceneId: "scene-1",
        ids: ["wall-plain", "wall-plain"],
        dryRun: true
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.message).toContain("twice (indices 0 and 1)");
  });

  it("scene.wall.delete-many reports the SIZE error when the batch is both oversized and duplicated", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const response = await router.route(
      createRequest("scene.wall.delete-many", {
        sceneId: "scene-1",
        ids: [...Array.from({ length: 100 }, (_unused, index) => `wall-${index}`), "wall-0"]
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.message).toContain("at most 100 ids per call");
    expect(response.error.message).not.toContain("twice");
  });

  it("scene.wall.update-many reports the DUPLICATE error when a duplicate sits beside a missing target", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const response = await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [
          { id: "wall-plain", patch: { door: 1 } },
          { id: "wall-plain", patch: { ds: 1 } },
          { id: "wall-missing", patch: { door: 1 } }
        ]
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.message).toContain("twice (indices 0 and 1)");
  });

  it("scene.wall.create-many prepares each element EXACTLY as scene.wall.create prepares its one", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    const data = {
      _id: "spoofedwallid002",
      _stats: { createdTime: 1 },
      ownership: { default: 3 },
      author: "someone-else",
      c: [7, 7, 8, 8],
      door: 1,
      threshold: { light: 10 },
      flags: { mymod: { note: "keep me" } }
    };

    await router.route(createRequest("scene.wall.create", { sceneId: "scene-1", data: { ...data } }));
    const singlePayload = scene.createEmbeddedDocuments.mock.calls
      .filter((call) => call[0] === "Wall")
      .at(-1)[1][0];

    await router.route(createRequest("scene.wall.create-many", { sceneId: "scene-1", data: [{ ...data }] }));
    const batchPayload = scene.createEmbeddedDocuments.mock.calls
      .filter((call) => call[0] === "Wall")
      .at(-1)[1][0];

    const { _id: batchId, ...batchRest } = batchPayload;
    expect(batchId).toMatch(/^batchid\d{8}$/);
    expect(batchRest).toEqual(singlePayload);

    expect(singlePayload).not.toHaveProperty("_stats");
    expect(singlePayload).not.toHaveProperty("ownership");
    expect(singlePayload).not.toHaveProperty("author");
    expect(singlePayload.flags).toEqual({ mymod: { note: "keep me" } });
  });

  it("scene.wall.update-many prepares each element EXACTLY as scene.wall.update prepares its one", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    const patch = { _stats: { createdTime: 1 }, "ownership.user-1": 3, doorSound: "metalBasic", ds: 1 };

    await router.route(
      createRequest("scene.wall.update", { sceneId: "scene-1", wallId: "wall-plain", patch: { ...patch } })
    );
    const singleEntry = scene.updateEmbeddedDocuments.mock.calls
      .filter((call) => call[0] === "Wall")
      .at(-1)[1][0];

    await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [{ id: "wall-secret", patch: { ...patch } }]
      })
    );
    const batchEntry = scene.updateEmbeddedDocuments.mock.calls
      .filter((call) => call[0] === "Wall")
      .at(-1)[1][0];

    expect({ ...batchEntry, _id: "X" }).toEqual({ ...singleEntry, _id: "X" });
    expect(singleEntry).not.toHaveProperty("_stats");
    expect(singleEntry).not.toHaveProperty("ownership.user-1");
    expect(singleEntry.doorSound).toBe("metalBasic");
  });

  it("scene.wall.update-many keeps the payload identical even when the core MUTATES the probed patch", async () => {
    const declaredWallFields = new Set([
      "c",
      "door",
      "ds",
      "doorSound",
      "dir",
      "move",
      "sight",
      "sound",
      "threshold",
      "light",
      "animation",
      "flags",
      "_id"
    ]);

    const expandDottedKeys = (patch) => {
      const out = {};
      for (const [key, value] of Object.entries(patch ?? {})) {
        if (!key.includes(".")) {
          out[key] = value;
          continue;
        }
        const [root, ...rest] = key.split(".");
        out[root] = { ...(out[root] ?? {}), [rest.join(".")]: value };
      }
      return out;
    };
    const modelV13PatchMutation = (wall) => {
      const realClone = wall.clone;
      wall.clone = vi.fn(async (patch, context) => {
        const copy = await realClone(patch, context);
        const baseUpdateSource = copy.updateSource.bind(copy);
        copy.updateSource = (raw = {}, ctx = {}) => {
          for (const key of Object.keys(raw)) {
            if (key.includes(".")) {
              const [root, ...rest] = key.split(".");
              const value = raw[key];
              delete raw[key];
              raw[root] = { ...(raw[root] ?? {}), [rest.join(".")]: value };
            } else if (!declaredWallFields.has(key)) {
              delete raw[key];
            }
          }
          return baseUpdateSource(raw, ctx);
        };
        return copy;
      });
      const baseApplyStoredWrite = wall.applyStoredWrite.bind(wall);
      wall.applyStoredWrite = (patch = {}) => baseApplyStoredWrite(expandDottedKeys(patch));
    };

    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");
    modelV13PatchMutation(scene.walls.get("wall-plain"));
    modelV13PatchMutation(scene.walls.get("wall-secret"));
    const patch = { someModuleKey: 1, "threshold.light": 12, ds: 1 };

    await router.route(
      createRequest("scene.wall.update", { sceneId: "scene-1", wallId: "wall-plain", patch: { ...patch } })
    );
    const singleEntry = scene.updateEmbeddedDocuments.mock.calls
      .filter((call) => call[0] === "Wall")
      .at(-1)[1][0];

    const response = await router.route(
      createRequest("scene.wall.update-many", {
        sceneId: "scene-1",
        patches: [{ id: "wall-secret", patch: { ...patch } }]
      })
    );

    expect(response.ok).toBe(true);
    const batchEntry = scene.updateEmbeddedDocuments.mock.calls
      .filter((call) => call[0] === "Wall")
      .at(-1)[1][0];
    expect({ ...batchEntry, _id: "X" }).toEqual({ ...singleEntry, _id: "X" });

    expect(singleEntry).toMatchObject({ someModuleKey: 1, "threshold.light": 12, ds: 1 });
    expect(batchEntry).toMatchObject({ someModuleKey: 1, "threshold.light": 12, ds: 1 });
  });

  it("the shared preparation pipeline canonicalizes FilePath fields (the limb Wall cannot reach)", () => {
    const prepared = prepareSceneEmbeddedCreateData("Tile", {
      _id: "spoofedtileid001",
      texture: { src: "worlds/world-1/maps/dungeon 1.webp" }
    });
    expect(prepared).not.toHaveProperty("_id");

    expect(prepared.texture.src).toBe("worlds/world-1/maps/dungeon%201.webp");

    expect(
      prepareSceneEmbeddedCreateData("Tile", { texture: { src: "worlds/world-1/maps/dungeon%201.webp" } })
        .texture.src
    ).toBe("worlds/world-1/maps/dungeon%201.webp");

    const patched = prepareSceneEmbeddedUpdateData("AmbientSound", {
      path: "worlds/world-1/audio/bell ring.ogg"
    });
    expect(patched.path).toBe("worlds/world-1/audio/bell%20ring.ogg");
  });

  it("scene.wall.delete-many rejects a duplicate id and deletes nothing", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await router.route(
      createRequest("scene.wall.delete-many", { sceneId: "scene-1", ids: ["wall-plain", "wall-plain"] })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.message).toContain("twice (indices 0 and 1)");
    expect(scene.walls.get("wall-plain")).toBeTruthy();
  });

  it("lists, gets, creates, updates, clones, and deletes scene notes", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("scene.note.list", { sceneId: "scene-1" }));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.notes).toHaveLength(2);

    expect(listResponse.result.notes[0]).toEqual({
      id: "note-quest",
      _id: "note-quest",
      text: "Quest giver",
      x: 500,
      y: 400,
      entryId: "journal-1",
      texture: { src: "icons/svg/book.svg" },
      iconSize: 40
    });

    const getResponse = await router.route(
      createRequest("scene.note.get", { sceneId: "scene-1", noteId: "note-quest" })
    );
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.note.text).toBe("Quest giver");
    expect(getResponse.result.note.entryId).toBe("journal-1");

    expect(getResponse.result.note.texture).toEqual({ src: "icons/svg/book.svg", tint: "#ffffff" });
    expect(getResponse.result.note.iconSize).toBe(40);

    const createResponse = await router.route(
      createRequest("scene.note.create", {
        sceneId: "scene-1",
        data: { x: 100, y: 100, text: "New pin", texture: { src: "icons/svg/info.svg" } }
      })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.note.text).toBe("New pin");
    expect(createResponse.result.note.texture).toEqual({ src: "icons/svg/info.svg" });

    const updateResponse = await router.route(
      createRequest("scene.note.update", {
        sceneId: "scene-1",
        noteId: "note-trap",
        patch: { texture: { src: "icons/svg/hazard.svg" } }
      })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.note.texture).toEqual({ src: "icons/svg/hazard.svg" });

    const cloneResponse = await router.route(
      createRequest("scene.note.clone", { sceneId: "scene-1", noteId: "note-quest", patch: { x: 999 } })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.note.id).toBe("note-quest-clone");
    expect(cloneResponse.result.note.x).toBe(999);

    const deleteResponse = await router.route(
      createRequest("scene.note.delete", { sceneId: "scene-1", noteId: "note-quest" })
    );
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: "note-quest", deleted: true });

    const missing = await router.route(
      createRequest("scene.note.get", { sceneId: "scene-1", noteId: "note-quest" })
    );
    expect(missing.error.code).toBe("NOTE_NOT_FOUND");
    expect(missing.error.message).toContain("scene.note.list");
  });

  it("scene.note.clone reassigns author to the current GM session user (v14 Note has the field)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const originalUserId = globalThis.game.user.id;
    globalThis.game.user.id = "gm-current";
    try {
      const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
      const note = scene.notes.get("note-quest");

      expect(note.author).toBe("user-1");
      const cloneSpy = vi.spyOn(note, "clone");

      const response = await router.route(
        createRequest("scene.note.clone", { sceneId: "scene-1", noteId: "note-quest", patch: { x: 5 } })
      );
      expect(response.ok).toBe(true);
      const overrides = /** @type {any} */ (cloneSpy.mock.calls[0][0]);
      expect(overrides.author).toBe("gm-current");
      cloneSpy.mockRestore();
    } finally {
      globalThis.game.user.id = originalUserId;
    }
  });

  it("scene.note create/update dry-run previews without persisting", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const createPreview = await router.route(
      createRequest("scene.note.create", {
        sceneId: "scene-1",
        data: { x: 1, y: 2, text: "Preview" },
        dryRun: true
      })
    );
    expect(createPreview.ok).toBe(true);
    expect(createPreview.result.dryRun).toBe(true);
    expect(createPreview.result.note.text).toBe("Preview");

    const afterCreate = await router.route(createRequest("scene.note.list", { sceneId: "scene-1" }));
    expect(afterCreate.result.notes).toHaveLength(2);

    const updatePreview = await router.route(
      createRequest("scene.note.update", {
        sceneId: "scene-1",
        noteId: "note-quest",
        patch: { text: "Renamed" },
        dryRun: true
      })
    );
    expect(updatePreview.ok).toBe(true);
    expect(updatePreview.result.dryRun).toBe(true);
    expect(updatePreview.result.note.text).toBe("Renamed");
    expect(updatePreview.result).not.toHaveProperty("preview");
  });

  it("scene.note.create strips protected meta (_id/_stats/ownership) from the payload", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.note.create", {
        sceneId: "scene-1",
        data: {
          _id: "spoofed",
          _stats: { createdTime: 1 },
          ownership: { default: 3 },
          x: 5,
          y: 5,
          text: "Guarded"
        }
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.note.id).not.toBe("spoofed");
    expect(response.result.note.text).toBe("Guarded");
  });

  it("lists, gets, creates, updates, clones, and deletes scene drawings", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("scene.drawing.list", { sceneId: "scene-1" }));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.drawings).toHaveLength(2);

    expect(listResponse.result.drawings[0]).toEqual({
      id: "drawing-rect",
      _id: "drawing-rect",
      name: "Danger drawing",
      text: "Danger zone",
      x: 300,
      y: 400,
      shape: { type: "r" },
      hidden: false
    });
    expect(listResponse.result.drawings[1].name).toBe(null);

    const getResponse = await router.route(
      createRequest("scene.drawing.get", { sceneId: "scene-1", drawingId: "drawing-rect" })
    );
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.drawing.text).toBe("Danger zone");

    expect(getResponse.result.drawing.name).toBe("Danger drawing");
    expect(getResponse.result.drawing.shape).toEqual({ type: "r", width: 200, height: 100 });
    expect(getResponse.result.drawing.author).toBe("user-1");

    const createResponse = await router.route(
      createRequest("scene.drawing.create", {
        sceneId: "scene-1",
        data: { shape: { type: "r", width: 50, height: 50 }, x: 10, y: 20, text: "New" }
      })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.drawing.text).toBe("New");

    const updateResponse = await router.route(
      createRequest("scene.drawing.update", {
        sceneId: "scene-1",
        drawingId: "drawing-rect",
        patch: { fillColor: "#00ff00" }
      })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.drawing.fillColor).toBe("#00ff00");

    const cloneResponse = await router.route(
      createRequest("scene.drawing.clone", {
        sceneId: "scene-1",
        drawingId: "drawing-rect",
        patch: { x: 999 }
      })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.drawing.id).toBe("drawing-rect-clone");
    expect(cloneResponse.result.drawing.x).toBe(999);

    const deleteResponse = await router.route(
      createRequest("scene.drawing.delete", { sceneId: "scene-1", drawingId: "drawing-rect" })
    );
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: "drawing-rect", deleted: true });

    const missing = await router.route(
      createRequest("scene.drawing.get", { sceneId: "scene-1", drawingId: "drawing-rect" })
    );
    expect(missing.error.code).toBe("DRAWING_NOT_FOUND");
    expect(missing.error.message).toContain("scene.drawing.list");
  });

  it("scene.drawing create/update dry-run previews without persisting", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const createPreview = await router.route(
      createRequest("scene.drawing.create", {
        sceneId: "scene-1",
        data: { shape: { type: "r", width: 5, height: 5 }, x: 1, y: 2, text: "Preview" },
        dryRun: true
      })
    );
    expect(createPreview.ok).toBe(true);
    expect(createPreview.result.dryRun).toBe(true);
    expect(createPreview.result.drawing.text).toBe("Preview");

    const afterCreate = await router.route(createRequest("scene.drawing.list", { sceneId: "scene-1" }));
    expect(afterCreate.result.drawings).toHaveLength(2);

    const updatePreview = await router.route(
      createRequest("scene.drawing.update", {
        sceneId: "scene-1",
        drawingId: "drawing-rect",
        patch: { text: "Renamed" },
        dryRun: true
      })
    );
    expect(updatePreview.ok).toBe(true);
    expect(updatePreview.result.dryRun).toBe(true);
    expect(updatePreview.result.drawing.text).toBe("Renamed");
    expect(updatePreview.result).not.toHaveProperty("preview");
  });

  it("scene.drawing.create strips protected meta (_id/_stats/ownership) AND author from the payload", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const createSpy = vi.spyOn(scene, "createEmbeddedDocuments");

    const response = await router.route(
      createRequest("scene.drawing.create", {
        sceneId: "scene-1",
        data: {
          _id: "spoofed",
          _stats: { createdTime: 1 },
          ownership: { default: 3 },
          author: "spoof",
          shape: { type: "r", width: 5, height: 5 },
          x: 5,
          y: 5,
          text: "Guarded"
        }
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.drawing.id).not.toBe("spoofed");
    expect(response.result.drawing.text).toBe("Guarded");

    const sentData = /** @type {any} */ (createSpy.mock.calls[0][1])[0];
    expect(sentData).not.toHaveProperty("author");
    expect(sentData).not.toHaveProperty("_id");
    expect(sentData).not.toHaveProperty("_stats");
    expect(sentData).not.toHaveProperty("ownership");
    createSpy.mockRestore();
  });

  it("scene.drawing.clone reassigns author to the current GM session user (not the source author)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const originalUserId = globalThis.game.user.id;
    globalThis.game.user.id = "gm-current";
    try {
      const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
      const drawing = scene.drawings.get("drawing-rect");
      const cloneSpy = vi.spyOn(drawing, "clone");

      const response = await router.route(
        createRequest("scene.drawing.clone", {
          sceneId: "scene-1",
          drawingId: "drawing-rect",
          patch: { x: 5 }
        })
      );
      expect(response.ok).toBe(true);

      const overrides = /** @type {any} */ (cloneSpy.mock.calls[0][0]);
      expect(overrides.author).toBe("gm-current");

      expect(response.result.drawing.author).toBe("gm-current");
      cloneSpy.mockRestore();
    } finally {
      globalThis.game.user.id = originalUserId;
    }
  });

  it("lists, gets, creates, updates, clones, and deletes scene lights", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("scene.light.list", { sceneId: "scene-1" }));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.lights).toHaveLength(1);

    expect(listResponse.result.lights[0]).toEqual({
      id: "light-torch",
      _id: "light-torch",
      name: "Torch sconce",
      x: 250,
      y: 250,
      hidden: false,
      config: { dim: 40, bright: 20, color: "#ffaa00" }
    });

    const getResponse = await router.route(
      createRequest("scene.light.get", { sceneId: "scene-1", lightId: "light-torch" })
    );
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.light.walls).toBe(true);

    expect(getResponse.result.light.name).toBe("Torch sconce");
    expect(getResponse.result.light.config).toEqual({ dim: 40, bright: 20, color: "#ffaa00" });

    const createResponse = await router.route(
      createRequest("scene.light.create", {
        sceneId: "scene-1",
        data: { x: 600, y: 600, config: { dim: 30, bright: 15 } }
      })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.light.config).toEqual({ dim: 30, bright: 15 });

    const updateResponse = await router.route(
      createRequest("scene.light.update", {
        sceneId: "scene-1",
        lightId: "light-torch",
        patch: { config: { dim: 30, bright: 15 } }
      })
    );
    expect(updateResponse.ok).toBe(true);

    expect(updateResponse.result.light.config).toEqual({ dim: 30, bright: 15, color: "#ffaa00" });

    const cloneResponse = await router.route(
      createRequest("scene.light.clone", { sceneId: "scene-1", lightId: "light-torch", patch: { x: 999 } })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.light.id).toBe("light-torch-clone");
    expect(cloneResponse.result.light.x).toBe(999);

    const deleteResponse = await router.route(
      createRequest("scene.light.delete", { sceneId: "scene-1", lightId: "light-torch" })
    );
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: "light-torch", deleted: true });

    const missing = await router.route(
      createRequest("scene.light.get", { sceneId: "scene-1", lightId: "light-torch" })
    );
    expect(missing.error.code).toBe("LIGHT_NOT_FOUND");
    expect(missing.error.message).toContain("scene.light.list");
  });

  it("scene.light create/update dry-run previews without persisting", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const createPreview = await router.route(
      createRequest("scene.light.create", {
        sceneId: "scene-1",
        data: { x: 1, y: 2, config: { dim: 10 } },
        dryRun: true
      })
    );
    expect(createPreview.ok).toBe(true);
    expect(createPreview.result.dryRun).toBe(true);
    expect(createPreview.result.light.config).toEqual({ dim: 10 });

    const afterCreate = await router.route(createRequest("scene.light.list", { sceneId: "scene-1" }));
    expect(afterCreate.result.lights).toHaveLength(1);

    const updatePreview = await router.route(
      createRequest("scene.light.update", {
        sceneId: "scene-1",
        lightId: "light-torch",
        patch: { config: { dim: 99 } },
        dryRun: true
      })
    );
    expect(updatePreview.ok).toBe(true);
    expect(updatePreview.result.dryRun).toBe(true);
    expect(updatePreview.result.light.config.dim).toBe(99);
    expect(updatePreview.result).not.toHaveProperty("preview");
  });

  it("scene.light.create strips protected meta (_id/_stats/ownership) from the payload", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.light.create", {
        sceneId: "scene-1",
        data: {
          _id: "spoofed",
          _stats: { createdTime: 1 },
          ownership: { default: 3 },
          x: 5,
          y: 5,
          config: { dim: 5 }
        }
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.light.id).not.toBe("spoofed");
    expect(response.result.light.config).toEqual({ dim: 5 });
  });

  it("lists, gets, creates, updates, clones, and deletes scene templates", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("scene.template.list", { sceneId: "scene-1" }));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.templates).toHaveLength(2);

    expect(listResponse.result.templates[0]).toEqual({
      id: "template-fireball",
      _id: "template-fireball",
      t: "circle",
      x: 500,
      y: 500,
      distance: 20,
      hidden: false
    });

    const getResponse = await router.route(
      createRequest("scene.template.get", { sceneId: "scene-1", templateId: "template-fireball" })
    );
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.template.t).toBe("circle");
    expect(getResponse.result.template.distance).toBe(20);
    expect(getResponse.result.template.author).toBe("user-1");

    const createResponse = await router.route(
      createRequest("scene.template.create", {
        sceneId: "scene-1",
        data: { t: "ray", x: 10, y: 20, distance: 30, width: 5 }
      })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.template.t).toBe("ray");
    expect(createResponse.result.template.width).toBe(5);

    const updateResponse = await router.route(
      createRequest("scene.template.update", {
        sceneId: "scene-1",
        templateId: "template-fireball",
        patch: { distance: 40 }
      })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.template.distance).toBe(40);

    const cloneResponse = await router.route(
      createRequest("scene.template.clone", {
        sceneId: "scene-1",
        templateId: "template-fireball",
        patch: { x: 999 }
      })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.template.id).toBe("template-fireball-clone");
    expect(cloneResponse.result.template.x).toBe(999);

    const deleteResponse = await router.route(
      createRequest("scene.template.delete", { sceneId: "scene-1", templateId: "template-fireball" })
    );
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: "template-fireball", deleted: true });

    const missing = await router.route(
      createRequest("scene.template.get", { sceneId: "scene-1", templateId: "template-fireball" })
    );
    expect(missing.error.code).toBe("TEMPLATE_NOT_FOUND");
    expect(missing.error.message).toContain("scene.template.list");
  });

  it("scene.template create/update dry-run previews without persisting", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const createPreview = await router.route(
      createRequest("scene.template.create", {
        sceneId: "scene-1",
        data: { t: "circle", x: 1, y: 2, distance: 5 },
        dryRun: true
      })
    );
    expect(createPreview.ok).toBe(true);
    expect(createPreview.result.dryRun).toBe(true);
    expect(createPreview.result.template.distance).toBe(5);

    const afterCreate = await router.route(createRequest("scene.template.list", { sceneId: "scene-1" }));
    expect(afterCreate.result.templates).toHaveLength(2);

    const updatePreview = await router.route(
      createRequest("scene.template.update", {
        sceneId: "scene-1",
        templateId: "template-fireball",
        patch: { distance: 99 },
        dryRun: true
      })
    );
    expect(updatePreview.ok).toBe(true);
    expect(updatePreview.result.dryRun).toBe(true);
    expect(updatePreview.result.template.distance).toBe(99);
    expect(updatePreview.result).not.toHaveProperty("preview");
  });

  it("scene.template.create strips protected meta (_id/_stats/ownership) AND author (both spellings, incl. the `user` alias)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const createSpy = vi.spyOn(scene, "createEmbeddedDocuments");

    const response = await router.route(
      createRequest("scene.template.create", {
        sceneId: "scene-1",
        data: {
          _id: "spoofed",
          _stats: { createdTime: 1 },
          ownership: { default: 3 },
          author: "spoof",
          user: "spoof",
          t: "circle",
          x: 5,
          y: 5,
          distance: 10
        }
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.template.id).not.toBe("spoofed");
    expect(response.result.template.distance).toBe(10);

    const sentData = /** @type {any} */ (createSpy.mock.calls[0][1])[0];
    expect(sentData).not.toHaveProperty("author");
    expect(sentData).not.toHaveProperty("user");
    expect(sentData).not.toHaveProperty("_id");
    expect(sentData).not.toHaveProperty("_stats");
    expect(sentData).not.toHaveProperty("ownership");
    createSpy.mockRestore();
  });

  it("scene.template.clone reassigns author to the current GM session user (not the source author)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const originalUserId = globalThis.game.user.id;
    globalThis.game.user.id = "gm-current";
    try {
      const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
      const template = scene.templates.get("template-fireball");
      const cloneSpy = vi.spyOn(template, "clone");

      const response = await router.route(
        createRequest("scene.template.clone", {
          sceneId: "scene-1",
          templateId: "template-fireball",
          patch: { x: 5 }
        })
      );
      expect(response.ok).toBe(true);
      const overrides = /** @type {any} */ (cloneSpy.mock.calls[0][0]);
      expect(overrides.author).toBe("gm-current");
      expect(response.result.template.author).toBe("gm-current");
      cloneSpy.mockRestore();
    } finally {
      globalThis.game.user.id = originalUserId;
    }
  });

  it("lists, gets, creates, updates, clones, and deletes scene regions", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("scene.region.list", { sceneId: "scene-1" }));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.regions).toHaveLength(2);

    expect(listResponse.result.regions[0]).toEqual({
      id: "region-lava",
      _id: "region-lava",
      name: "Lava Field",
      color: "#ff0000",
      visibility: 2,
      shapesCount: 1,
      behaviorsCount: 1
    });

    const getResponse = await router.route(
      createRequest("scene.region.get", { sceneId: "scene-1", regionId: "region-lava" })
    );
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.region.name).toBe("Lava Field");
    expect(getResponse.result.region.shapes).toEqual([
      { type: "rectangle", x: 0, y: 0, width: 500, height: 500 }
    ]);

    expect(getResponse.result.region.behaviors).toEqual([
      {
        id: "region-lava-behavior-1",
        _id: "region-lava-behavior-1",
        name: "",
        type: "damage",
        disabled: false,
        system: { damage: "2d6" },
        flags: {}
      }
    ]);

    const createResponse = await router.route(
      createRequest("scene.region.create", {
        sceneId: "scene-1",
        data: { name: "New Zone", shapes: [{ type: "circle", x: 1, y: 1, radius: 50 }] }
      })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.region.name).toBe("New Zone");

    const updateResponse = await router.route(
      createRequest("scene.region.update", {
        sceneId: "scene-1",
        regionId: "region-lava",
        patch: { color: "#0000ff" }
      })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.region.color).toBe("#0000ff");

    const cloneResponse = await router.route(
      createRequest("scene.region.clone", {
        sceneId: "scene-1",
        regionId: "region-lava",
        patch: { name: "Copy" }
      })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.region.id).toBe("region-lava-clone");
    expect(cloneResponse.result.region.name).toBe("Copy");

    const deleteResponse = await router.route(
      createRequest("scene.region.delete", { sceneId: "scene-1", regionId: "region-lava" })
    );
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: "region-lava", deleted: true });

    const missing = await router.route(
      createRequest("scene.region.get", { sceneId: "scene-1", regionId: "region-lava" })
    );
    expect(missing.error.code).toBe("REGION_NOT_FOUND");
    expect(missing.error.message).toContain("scene.region.list");
  });

  it("scene.region.list applies the standard name substring filter", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const filtered = await router.route(
      createRequest("scene.region.list", { sceneId: "scene-1", name: "safe" })
    );
    expect(filtered.ok).toBe(true);
    expect(filtered.result.regions).toHaveLength(1);
    expect(filtered.result.regions[0].name).toBe("Safe Zone");
  });

  it("scene.region.create routes shapes AND inline behaviors intact (minus protected meta)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const createSpy = vi.spyOn(scene, "createEmbeddedDocuments");

    const response = await router.route(
      createRequest("scene.region.create", {
        sceneId: "scene-1",
        data: {
          _id: "spoofed",
          _stats: { createdTime: 1 },
          ownership: { default: 3 },
          name: "Trap Zone",
          shapes: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 100 }],

          behaviors: [{ type: "adjustDarknessLevel", system: { darknessLevel: 0.5 } }]
        }
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.region.id).not.toBe("spoofed");

    const sentData = /** @type {any} */ (createSpy.mock.calls[0][1])[0];
    expect(sentData.shapes).toEqual([{ type: "rectangle", x: 0, y: 0, width: 100, height: 100 }]);
    expect(sentData.behaviors).toEqual([{ type: "adjustDarknessLevel", system: { darknessLevel: 0.5 } }]);
    expect(sentData).not.toHaveProperty("_id");
    expect(sentData).not.toHaveProperty("_stats");
    expect(sentData).not.toHaveProperty("ownership");
    createSpy.mockRestore();
  });

  it("strips protected meta from nested RegionBehavior entries on create", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const createSpy = vi.spyOn(scene, "createEmbeddedDocuments");

    await router.route(
      createRequest("scene.region.create", {
        sceneId: "scene-1",
        data: {
          name: "Nested Meta Zone",
          behaviors: [
            {
              type: "adjustDarknessLevel",

              _id: "spoofed-behavior",
              _stats: { createdTime: 1 },
              ownership: { default: 3 },
              system: { darknessLevel: 0.25 }
            }
          ]
        }
      })
    );

    const sentData = /** @type {any} */ (createSpy.mock.calls[0][1])[0];
    expect(sentData.behaviors[0]).toEqual({
      type: "adjustDarknessLevel",
      system: { darknessLevel: 0.25 }
    });
    expect(sentData.behaviors[0]).not.toHaveProperty("_id");
    expect(sentData.behaviors[0]).not.toHaveProperty("_stats");
    expect(sentData.behaviors[0]).not.toHaveProperty("ownership");
    createSpy.mockRestore();
  });

  it("rejects code-executing RegionBehavior types (executeScript/executeMacro) on create/update/clone", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const scriptCreate = await router.route(
      createRequest("scene.region.create", {
        sceneId: "scene-1",
        data: {
          name: "Script Trap",
          behaviors: [{ type: "executeScript", system: { source: "game.actors.forEach(a => a.delete())" } }]
        }
      })
    );
    expect(scriptCreate.ok).toBe(false);
    expect(scriptCreate.error.code).toBe("INVALID_PARAMS");
    expect(scriptCreate.error.details).toMatchObject({ behaviorType: "executeScript" });

    const macroCreate = await router.route(
      createRequest("scene.region.create", {
        sceneId: "scene-1",
        data: { name: "Macro Trap", behaviors: [{ type: "executeMacro", system: { uuid: "Macro.abc" } }] }
      })
    );
    expect(macroCreate.ok).toBe(false);
    expect(macroCreate.error.code).toBe("INVALID_PARAMS");
    expect(macroCreate.error.details).toMatchObject({ behaviorType: "executeMacro" });

    const scriptDryRun = await router.route(
      createRequest("scene.region.create", {
        sceneId: "scene-1",
        dryRun: true,
        data: { name: "Dry Script Trap", behaviors: [{ type: "executeScript", system: { source: "1" } }] }
      })
    );
    expect(scriptDryRun.ok).toBe(false);
    expect(scriptDryRun.error.code).toBe("INVALID_PARAMS");

    const scriptUpdate = await router.route(
      createRequest("scene.region.update", {
        sceneId: "scene-1",
        regionId: "region-lava",
        patch: { behaviors: [{ type: "executeScript", system: { source: "2" } }] }
      })
    );
    expect(scriptUpdate.ok).toBe(false);
    expect(scriptUpdate.error.code).toBe("INVALID_PARAMS");

    const okUpdate = await router.route(
      createRequest("scene.region.update", {
        sceneId: "scene-1",
        regionId: "region-lava",
        patch: { behaviors: [{ type: "pauseGame" }] }
      })
    );
    expect(okUpdate.ok).toBe(true);
  });

  it("scene.region.clone: rejects a PATCH-supplied executable behavior but allows duplicating a GM-authored source (supply-only boundary)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const patchSupplied = await router.route(
      createRequest("scene.region.clone", {
        sceneId: "scene-1",
        regionId: "region-lava",
        patch: { name: "Script Copy", behaviors: [{ type: "executeScript", system: { source: "3" } }] }
      })
    );
    expect(patchSupplied.ok).toBe(false);
    expect(patchSupplied.error.code).toBe("INVALID_PARAMS");
    expect(patchSupplied.error.details).toMatchObject({ behaviorType: "executeScript" });

    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-lava");
    region.behaviors = [{ type: "executeScript", system: { source: "4" } }];
    const sourceOnly = await router.route(
      createRequest("scene.region.clone", {
        sceneId: "scene-1",
        regionId: "region-lava",
        patch: { name: "Copy" }
      })
    );
    expect(sourceOnly.ok).toBe(true);
  });

  it("scene.region.clone rejects a typeless _id-addressed patch that targets an existing executeScript behavior on the source (guard receives the source region)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-lava");

    region.behaviors = [{ _id: "beh-script", type: "executeScript", system: { source: "1" } }];

    const response = await router.route(
      createRequest("scene.region.clone", {
        sceneId: "scene-1",
        regionId: "region-lava",
        patch: { name: "Sneaky", behaviors: [{ _id: "beh-script", system: { source: "evil" } }] }
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details).toMatchObject({ behaviorType: "executeScript" });
  });

  it("scene.region.update preserves a nested behavior's _id (addressing) while still stripping _stats/ownership", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-lava");

    region.behaviors = [{ _id: "beh-1", type: "adjustDarknessLevel", system: { darknessLevel: 0.1 } }];
    const updateSpy = vi.spyOn(scene, "updateEmbeddedDocuments");

    const response = await router.route(
      createRequest("scene.region.update", {
        sceneId: "scene-1",
        regionId: "region-lava",
        patch: {
          behaviors: [
            {
              _id: "beh-1",
              _stats: { createdTime: 1 },
              ownership: { default: 3 },
              system: { darknessLevel: 0.9 }
            }
          ]
        }
      })
    );
    expect(response.ok).toBe(true);

    const sentPatch = /** @type {any} */ (updateSpy.mock.calls[0][1])[0];
    expect(sentPatch.behaviors[0]._id).toBe("beh-1");
    expect(sentPatch.behaviors[0].system).toEqual({ darknessLevel: 0.9 });
    expect(sentPatch.behaviors[0]).not.toHaveProperty("_stats");
    expect(sentPatch.behaviors[0]).not.toHaveProperty("ownership");
    updateSpy.mockRestore();
  });

  it("scene.region.update rejects a typeless _id-addressed patch targeting an existing executeScript behavior (no type-key bypass)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-lava");

    region.behaviors = [{ _id: "beh-script", type: "executeScript", system: { source: "1" } }];
    const updateSpy = vi.spyOn(scene, "updateEmbeddedDocuments");

    const response = await router.route(
      createRequest("scene.region.update", {
        sceneId: "scene-1",
        regionId: "region-lava",
        patch: {
          behaviors: [{ _id: "beh-script", system: { source: "game.actors.forEach(a => a.delete())" } }]
        }
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details).toMatchObject({ behaviorType: "executeScript" });
    expect(updateSpy).not.toHaveBeenCalled();
    updateSpy.mockRestore();
  });

  it("scene.region.create --dry-run reports NULL ids for inline behaviors (a preview never fabricates an address)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const createSpy = vi.spyOn(scene, "createEmbeddedDocuments");

    const response = await router.route(
      createRequest("scene.region.create", {
        sceneId: "scene-1",
        data: { name: "Preview Zone", shapes: [], behaviors: [{ type: "pauseGame", name: "Halt" }] },
        dryRun: true
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.dryRun).toBe(true);
    expect(createSpy).not.toHaveBeenCalled();

    expect(response.result.region.id).toBeNull();
    expect(response.result.region.behaviors).toHaveLength(1);
    expect(response.result.region.behaviors[0]).toMatchObject({
      id: null,
      _id: null,
      name: "Halt",
      type: "pauseGame"
    });
    createSpy.mockRestore();
  });

  it("scene.region.update --dry-run nulls a NEW inline behavior's id but keeps the id it ADDRESSES", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const updateSpy = vi.spyOn(scene, "updateEmbeddedDocuments");

    const response = await router.route(
      createRequest("scene.region.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        patch: {
          behaviors: [
            { _id: "behavior-darkness", name: "Renamed" },

            { type: "pauseGame", name: "Fresh" },

            { _id: "newIdAaaaaaaaaa1", type: "suppressWeather", name: "Adopted" }
          ]
        },
        dryRun: true
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.dryRun).toBe(true);
    expect(updateSpy).not.toHaveBeenCalled();
    const previewed = response.result.region.behaviors;
    expect(previewed.map((behavior) => [behavior.name, behavior.id])).toEqual([
      ["Renamed", "behavior-darkness"],
      ["Fresh", null],
      ["Adopted", null]
    ]);
    expect(previewed.every((behavior) => behavior.id === behavior._id)).toBe(true);
    updateSpy.mockRestore();
  });

  it("scene.region.clone --dry-run keeps the SOURCE's nested ids (the real clone does too) and nulls a patch-supplied row's", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const plain = await router.route(
      createRequest("scene.region.clone", { sceneId: "scene-1", regionId: "region-safe", dryRun: true })
    );
    expect(plain.ok).toBe(true);
    expect(plain.result.region.id).toBeNull();
    expect(plain.result.region.behaviors.map((behavior) => behavior.id)).toEqual([
      "behavior-darkness",
      "behavior-blank",
      "behavior-script",
      "behavior-macro"
    ]);

    const patched = await router.route(
      createRequest("scene.region.clone", {
        sceneId: "scene-1",
        regionId: "region-safe",
        patch: { behaviors: [{ type: "pauseGame", name: "Fresh" }] },
        dryRun: true
      })
    );
    expect(patched.ok).toBe(true);
    expect(patched.result.region.behaviors).toEqual([
      { id: null, _id: null, name: "Fresh", type: "pauseGame", disabled: false, system: {}, flags: {} }
    ]);
  });

  it("lists, gets, creates, updates, clones, and deletes region behaviors", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(
      createRequest("scene.region.behavior.list", { sceneId: "scene-1", regionId: "region-safe" })
    );
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result).toMatchObject({ sceneId: "scene-1", regionId: "region-safe", total: 4 });

    expect(listResponse.result.behaviors[0]).toEqual({
      id: "behavior-darkness",
      _id: "behavior-darkness",
      name: "Dim The Lights",
      type: "adjustDarknessLevel",
      disabled: false
    });

    expect(listResponse.result.behaviors.map((behavior) => behavior.id)).toEqual([
      "behavior-darkness",
      "behavior-blank",
      "behavior-script",
      "behavior-macro"
    ]);

    const getResponse = await router.route(
      createRequest("scene.region.behavior.get", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-darkness"
      })
    );
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.behavior).toEqual({
      id: "behavior-darkness",
      _id: "behavior-darkness",
      name: "Dim The Lights",
      type: "adjustDarknessLevel",
      disabled: false,
      system: { darknessLevel: 0.5 },
      flags: { mod: { tag: "keep" } }
    });

    expect(getResponse.result.behavior).not.toHaveProperty("ownership");
    expect(getResponse.result.behavior).not.toHaveProperty("_stats");

    const createResponse = await router.route(
      createRequest("scene.region.behavior.create", {
        sceneId: "scene-1",
        regionId: "region-safe",
        data: { type: "displayScrollingText", name: "Shout", system: { text: "Boo" } }
      })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.behavior).toMatchObject({
      name: "Shout",
      type: "displayScrollingText",
      disabled: false,
      system: { text: "Boo" }
    });
    const createdId = createResponse.result.behavior.id;

    const updateResponse = await router.route(
      createRequest("scene.region.behavior.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: createdId,
        patch: { name: "Whisper", disabled: true }
      })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.behavior).toMatchObject({ name: "Whisper", disabled: true });

    const cloneResponse = await router.route(
      createRequest("scene.region.behavior.clone", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: createdId,
        patch: { name: "Echo" }
      })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.behavior.id).toBe(`${createdId}-clone`);
    expect(cloneResponse.result.behavior.name).toBe("Echo");

    const deleteResponse = await router.route(
      createRequest("scene.region.behavior.delete", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: createdId
      })
    );
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toEqual({
      sceneId: "scene-1",
      regionId: "region-safe",
      id: createdId,
      deleted: true
    });

    const missing = await router.route(
      createRequest("scene.region.behavior.get", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: createdId
      })
    );
    expect(missing.error.code).toBe("REGION_BEHAVIOR_NOT_FOUND");
    expect(missing.error.message).toContain("scene.region.behavior.list");
  });

  it("scene.region.behavior reads report the STORED name, not the localized type label a blank name derives", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));

    expect(scene.regions.get("region-safe").behaviors.get("behavior-blank").name).toBe(
      "Localized(pauseGame)"
    );

    const get = await router.route(
      createRequest("scene.region.behavior.get", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-blank"
      })
    );
    expect(get.ok).toBe(true);
    expect(get.result.behavior.name).toBe("");

    const list = await router.route(
      createRequest("scene.region.behavior.list", { sceneId: "scene-1", regionId: "region-safe" })
    );
    expect(list.result.behaviors.find((behavior) => behavior.id === "behavior-blank").name).toBe("");

    const region = await router.route(
      createRequest("scene.region.get", { sceneId: "scene-1", regionId: "region-safe" })
    );
    expect(region.result.region.behaviors.find((behavior) => behavior.id === "behavior-blank").name).toBe("");
  });

  it("scene.region.behavior.list filters on the STORED name (so filter and projection cannot disagree)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const matched = await router.route(
      createRequest("scene.region.behavior.list", {
        sceneId: "scene-1",
        regionId: "region-safe",
        name: "dim"
      })
    );
    expect(matched.ok).toBe(true);
    expect(matched.result.behaviors.map((behavior) => behavior.id)).toEqual(["behavior-darkness"]);

    const live = await router.route(
      createRequest("scene.region.behavior.list", {
        sceneId: "scene-1",
        regionId: "region-safe",
        name: "pausegame"
      })
    );
    expect(live.result.behaviors).toEqual([]);
  });

  it("scene.region.behavior.list paginates, and FILTERS BEFORE paginating", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const first = await router.route(
      createRequest("scene.region.behavior.list", { sceneId: "scene-1", regionId: "region-safe", limit: 2 })
    );
    expect(first.ok).toBe(true);
    expect(first.result.behaviors.map((behavior) => behavior.id)).toEqual([
      "behavior-darkness",
      "behavior-blank"
    ]);
    expect(first.result).toMatchObject({ total: 4, hasMore: true });

    const second = await router.route(
      createRequest("scene.region.behavior.list", {
        sceneId: "scene-1",
        regionId: "region-safe",
        limit: 2,
        offset: 2
      })
    );
    expect(second.result.behaviors.map((behavior) => behavior.id)).toEqual([
      "behavior-script",
      "behavior-macro"
    ]);
    expect(second.result).toMatchObject({ total: 4, hasMore: false });

    const past = await router.route(
      createRequest("scene.region.behavior.list", { sceneId: "scene-1", regionId: "region-safe", offset: 9 })
    );
    expect(past.result.behaviors).toEqual([]);
    expect(past.result).toMatchObject({ total: 4, hasMore: false });

    const filtered = await router.route(
      createRequest("scene.region.behavior.list", {
        sceneId: "scene-1",
        regionId: "region-safe",
        name: "t",
        limit: 1
      })
    );
    expect(filtered.result.behaviors.map((behavior) => behavior.id)).toEqual(["behavior-darkness"]);
    expect(filtered.result).toMatchObject({ total: 2, hasMore: true });
  });

  it("scene.region.behavior.* resolves its three ids OUTSIDE-IN (scene, then region, then behavior)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const badScene = await router.route(
      createRequest("scene.region.behavior.get", {
        sceneId: "nope",
        regionId: "region-safe",
        behaviorId: "behavior-darkness"
      })
    );
    expect(badScene.error.code).toBe("SCENE_NOT_FOUND");

    const badRegion = await router.route(
      createRequest("scene.region.behavior.get", {
        sceneId: "scene-1",
        regionId: "nope",
        behaviorId: "behavior-darkness"
      })
    );
    expect(badRegion.error.code).toBe("REGION_NOT_FOUND");

    const badBehavior = await router.route(
      createRequest("scene.region.behavior.get", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "nope"
      })
    );
    expect(badBehavior.error.code).toBe("REGION_BEHAVIOR_NOT_FOUND");
    expect(badBehavior.error.details).toMatchObject({
      sceneId: "scene-1",
      regionId: "region-safe",
      behaviorId: "nope"
    });

    const write = await router.route(
      createRequest("scene.region.behavior.create", {
        sceneId: "scene-1",
        regionId: "nope",
        data: { type: "pauseGame" }
      })
    );
    expect(write.error.code).toBe("REGION_NOT_FOUND");
  });

  it("scene.region.behavior.create strips protected meta from the payload (open passthrough)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-safe");
    const createSpy = vi.spyOn(region, "createEmbeddedDocuments");

    const response = await router.route(
      createRequest("scene.region.behavior.create", {
        sceneId: "scene-1",
        regionId: "region-safe",
        data: {
          _id: "spoofed",
          _stats: { createdTime: 1 },
          ownership: { default: 3 },
          type: "pauseGame",
          name: "Halt",
          flags: { mod: { a: 1 } }
        }
      })
    );
    expect(response.ok).toBe(true);
    const sent = /** @type {any} */ (createSpy.mock.calls[0][1])[0];
    expect(sent).toEqual({ type: "pauseGame", name: "Halt", flags: { mod: { a: 1 } } });
    expect(sent).not.toHaveProperty("_id");
    expect(sent).not.toHaveProperty("_stats");
    expect(sent).not.toHaveProperty("ownership");
    createSpy.mockRestore();
  });

  it("scene.region.behavior.update strips a CLI-supplied _id and addresses the row by the behaviorId PARAM", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-safe");
    const updateSpy = vi.spyOn(region, "updateEmbeddedDocuments");

    const response = await router.route(
      createRequest("scene.region.behavior.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-darkness",
        patch: { _id: "hijacked", _stats: { createdTime: 9 }, ownership: { default: 3 }, name: "Renamed" }
      })
    );
    expect(response.ok).toBe(true);
    const sent = /** @type {any} */ (updateSpy.mock.calls[0][1])[0];

    expect(sent._id).toBe("behavior-darkness");
    expect(sent.name).toBe("Renamed");
    expect(sent).not.toHaveProperty("_stats");
    expect(sent).not.toHaveProperty("ownership");
    updateSpy.mockRestore();
  });

  for (const { key, value } of /** @type {{ key: string, value: any }[]} */ ([
    { key: "==_id", value: "bbbbbbbbbbbbbbb2" },
    { key: "-=_id", value: null },
    { key: "_id.foo", value: "x" },
    { key: "==_stats", value: { systemId: "hacked" } },
    { key: "-=_stats", value: null },
    { key: "_stats.systemId", value: "hacked" },
    { key: "==_stats.systemId", value: "hacked" },
    { key: "==ownership", value: { default: 3 } },
    { key: "-=ownership", value: null },
    { key: "ownership.user-1", value: 3 }
  ])) {
    {
      it(`scene.region.behavior.update strips the non-literal spelling "${key}"`, async () => {
        const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
        const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
        const region = scene.regions.get("region-safe");
        const updateSpy = vi.spyOn(region, "updateEmbeddedDocuments");

        const response = await router.route(
          createRequest("scene.region.behavior.update", {
            sceneId: "scene-1",
            regionId: "region-safe",
            behaviorId: "behavior-darkness",
            patch: { [key]: value, name: "Renamed" }
          })
        );
        expect(response.ok).toBe(true);
        const sent = /** @type {any} */ (updateSpy.mock.calls[0][1])[0];

        expect(sent).toEqual({ _id: "behavior-darkness", name: "Renamed" });
        expect(sent).not.toHaveProperty(key);

        expect(response.result.behavior.id).toBe("behavior-darkness");
        updateSpy.mockRestore();

        const previewSpy = vi.spyOn(region, "updateEmbeddedDocuments");
        const dry = await router.route(
          createRequest("scene.region.behavior.update", {
            sceneId: "scene-1",
            regionId: "region-safe",
            behaviorId: "behavior-darkness",
            patch: { [key]: value, name: "Renamed" },
            dryRun: true
          })
        );
        expect(dry.ok).toBe(true);
        expect(dry.result.dryRun).toBe(true);
        expect(dry.result.behavior.id).toBe("behavior-darkness");
        expect(previewSpy).not.toHaveBeenCalled();
        previewSpy.mockRestore();
      });

      it(`scene.region.behavior.create strips the non-literal spelling "${key}"`, async () => {
        const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
        const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
        const region = scene.regions.get("region-safe");
        const createSpy = vi.spyOn(region, "createEmbeddedDocuments");

        const response = await router.route(
          createRequest("scene.region.behavior.create", {
            sceneId: "scene-1",
            regionId: "region-safe",
            data: { [key]: value, type: "pauseGame", name: "Halt" }
          })
        );
        expect(response.ok).toBe(true);
        const sent = /** @type {any} */ (createSpy.mock.calls[0][1])[0];
        expect(sent).toEqual({ type: "pauseGame", name: "Halt" });
        expect(sent).not.toHaveProperty(key);
        createSpy.mockRestore();
      });

      it(`scene.region.behavior.clone strips the non-literal spelling "${key}"`, async () => {
        const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
        const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
        const region = scene.regions.get("region-safe");
        const behavior = region.behaviors.get("behavior-darkness");
        const cloneSpy = vi.spyOn(behavior, "clone");

        const response = await router.route(
          createRequest("scene.region.behavior.clone", {
            sceneId: "scene-1",
            regionId: "region-safe",
            behaviorId: "behavior-darkness",
            patch: { [key]: value, name: "Copy" }
          })
        );
        expect(response.ok).toBe(true);
        const overrides = /** @type {any} */ (cloneSpy.mock.calls.at(-1)?.[0]);
        expect(overrides).toEqual({ name: "Copy" });
        expect(overrides).not.toHaveProperty(key);
        cloneSpy.mockRestore();
      });
    }
  }

  for (const key of [
    "==_id",
    "-=_id",
    "==_stats",
    "-=_stats",
    "_stats.systemId",
    "==ownership",
    "-=ownership",
    "ownership.user-1",
    "==author",
    "-=author",
    "author.id"
  ]) {
    it(`scene.drawing.update strips the non-literal spelling "${key}"`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
      const updateSpy = vi.spyOn(scene, "updateEmbeddedDocuments");

      const response = await router.route(
        createRequest("scene.drawing.update", {
          sceneId: "scene-1",
          drawingId: "drawing-rect",
          patch: { [key]: key.startsWith("-=") ? null : "hahahahahahahaha", text: "Guarded" }
        })
      );
      expect(response.ok).toBe(true);
      const sent = /** @type {any} */ (updateSpy.mock.calls[0][1])[0];
      expect(sent).toEqual({ _id: "drawing-rect", text: "Guarded" });
      expect(sent).not.toHaveProperty(key);
      updateSpy.mockRestore();
    });
  }

  for (const key of ["user", "==user", "-=user", "user.id"]) {
    it(`scene.template.update strips the author alias "${key}"`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
      const updateSpy = vi.spyOn(scene, "updateEmbeddedDocuments");

      const response = await router.route(
        createRequest("scene.template.update", {
          sceneId: "scene-1",
          templateId: "template-fireball",
          patch: { [key]: key.startsWith("-=") ? null : "hahahahahahahaha", distance: 9 }
        })
      );
      expect(response.ok, JSON.stringify(response.error)).toBe(true);
      const sent = /** @type {any} */ (updateSpy.mock.calls[0][1])[0];
      expect(sent).toEqual({ _id: "template-fireball", distance: 9 });
      expect(sent).not.toHaveProperty(key);

      expect(sent).not.toHaveProperty("author");
      updateSpy.mockRestore();
    });
  }

  it("scene.template.update with ONLY the author alias is a legal no-op, not an error", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const updateSpy = vi.spyOn(scene, "updateEmbeddedDocuments");

    const response = await router.route(
      createRequest("scene.template.update", {
        sceneId: "scene-1",
        templateId: "template-fireball",
        patch: { user: "hahahahahahahaha" }
      })
    );
    expect(response.ok, JSON.stringify(response.error)).toBe(true);

    const sent = /** @type {any} */ (updateSpy.mock.calls[0][1])[0];
    expect(sent).toEqual({ _id: "template-fireball" });
    updateSpy.mockRestore();
  });

  it("scene.template.update-many with ONLY the author alias reports unchanged", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const updateSpy = vi.spyOn(scene, "updateEmbeddedDocuments");

    const response = await router.route(
      createRequest("scene.template.update-many", {
        sceneId: "scene-1",
        patches: [{ id: "template-fireball", patch: { user: "hahahahahahahaha" } }]
      })
    );
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    expect(response.result.complete).toBe(true);
    expect(response.result.outcomes).toEqual([{ index: 0, id: "template-fireball", status: "unchanged" }]);

    expect(updateSpy).not.toHaveBeenCalled();
    updateSpy.mockRestore();
  });

  it("scene.template.update-many strips the author alias per element", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const updateSpy = vi.spyOn(scene, "updateEmbeddedDocuments");

    const response = await router.route(
      createRequest("scene.template.update-many", {
        sceneId: "scene-1",
        patches: [{ id: "template-fireball", patch: { user: "hahahahahahahaha", distance: 11 } }]
      })
    );
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    const sent = /** @type {any} */ (updateSpy.mock.calls.at(-1)?.[1])[0];
    expect(sent).toEqual({ _id: "template-fireball", distance: 11 });
    expect(sent).not.toHaveProperty("user");
    expect(sent).not.toHaveProperty("author");
    updateSpy.mockRestore();
  });

  for (const key of ["ownership", "==ownership", "-=ownership", "ownership.user-1"]) {
    it(`scene.region.update strips "${key}" — the family where ownership is a REAL v14 field`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
      const updateSpy = vi.spyOn(scene, "updateEmbeddedDocuments");

      const response = await router.route(
        createRequest("scene.region.update", {
          sceneId: "scene-1",
          regionId: "region-safe",
          patch: {
            [key]: key.startsWith("-=") ? null : key.includes(".") ? 3 : { default: 0, "user-1": 3 },
            name: "Guarded"
          }
        })
      );
      expect(response.ok, JSON.stringify(response.error)).toBe(true);
      const sent = /** @type {any} */ (updateSpy.mock.calls[0][1])[0];
      expect(sent).toEqual({ _id: "region-safe", name: "Guarded" });
      expect(sent).not.toHaveProperty(key);
      updateSpy.mockRestore();
    });
  }

  for (const key of [
    "==_id",
    "-=_id",
    "==_stats",
    "-=_stats",
    "_stats.systemId",
    "==ownership",
    "-=ownership",
    "ownership.user-1"
  ]) {
    it(`actor.effect.update strips the non-literal spelling "${key}"`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const actor = /** @type {any} */ (globalThis.game.actors.get("actor-1"));
      const created = await router.route(
        createRequest("actor.effect.create", { actorId: "actor-1", data: { name: "Seeded" } })
      );
      expect(created.ok, JSON.stringify(created.error)).toBe(true);
      const effectId = created.result.effect.id;
      const updateSpy = vi.spyOn(actor, "updateEmbeddedDocuments");

      const response = await router.route(
        createRequest("actor.effect.update", {
          actorId: "actor-1",
          effectId,
          patch: { [key]: key.startsWith("-=") ? null : "hahahahahahahaha", name: "Guarded" }
        })
      );
      expect(response.ok, JSON.stringify(response.error)).toBe(true);
      const sent = /** @type {any} */ (updateSpy.mock.calls.at(-1)?.[1])[0];
      expect(sent).toEqual({ _id: effectId, name: "Guarded", transfer: false });
      expect(sent).not.toHaveProperty(key);
      updateSpy.mockRestore();
    });
  }

  for (const { label, patch, expected } of [
    {
      label: "a dotted flag path whose LEAF is a protected name",
      patch: { "flags.mymod._id": "keepme", "flags.mymod.ownership": 3 },
      expected: { "flags.mymod._id": "keepme", "flags.mymod.ownership": 3 }
    },
    {
      label: "a dotted system path whose LEAF is a protected name",
      patch: { "system._stats": { note: "subtype data" } },
      expected: { "system._stats": { note: "subtype data" } }
    },
    {
      label: "a plain field whose name merely STARTS WITH a protected one",
      patch: { _identifier: "not-meta", ownershipNote: "not-meta" },
      expected: { _identifier: "not-meta", ownershipNote: "not-meta" }
    }
  ]) {
    it(`scene.region.behavior.update PASSES THROUGH ${label}`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
      const region = scene.regions.get("region-safe");
      const updateSpy = vi.spyOn(region, "updateEmbeddedDocuments");

      const response = await router.route(
        createRequest("scene.region.behavior.update", {
          sceneId: "scene-1",
          regionId: "region-safe",
          behaviorId: "behavior-darkness",
          patch: { ...patch, name: "Renamed" }
        })
      );
      expect(response.ok, JSON.stringify(response.error)).toBe(true);
      const sent = /** @type {any} */ (updateSpy.mock.calls[0][1])[0];
      expect(sent).toEqual({ _id: "behavior-darkness", name: "Renamed", ...expected });
      updateSpy.mockRestore();
    });
  }

  for (const { label, key, value } of [
    { label: "a dotted APPEND of an executeScript row", key: "behaviors.0.type", value: "executeScript" },
    { label: "a dotted APPEND of a declarative row", key: "behaviors.0.type", value: "pauseGame" },
    {
      label: "a dotted patch of an EXISTING row (a silent no-op on both cores)",
      key: "behaviors.behavior-darkness.disabled",
      value: true
    },
    {
      label: "a forced-replacement array",
      key: "==behaviors",
      value: [{ type: "executeScript", system: { source: "x" } }]
    },
    { label: "a forced-deletion of the whole collection", key: "-=behaviors", value: null }
  ]) {
    it(`scene.region.update REFUSES ${label} ("${key}")`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
      const updateSpy = vi.spyOn(scene, "updateEmbeddedDocuments");

      for (const dryRun of [false, true]) {
        const response = await router.route(
          createRequest("scene.region.update", {
            sceneId: "scene-1",
            regionId: "region-safe",
            patch: { [key]: value, name: "Renamed" },
            ...(dryRun ? { dryRun: true } : {})
          })
        );
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe("INVALID_PARAMS");

        expect(response.error.message).toContain(
          "only be supplied as the plain 'behaviors' key carrying an ARRAY"
        );
        expect(response.error.message).toContain("no arbitrary JavaScript execution from the CLI");

        expect(response.error.message).toContain("scene.region.behavior.update");
        expect(response.error.message).toContain("scene.region.behavior.delete");
        expect(response.error.details).toMatchObject({ field: "behaviors", suppliedKeys: [key] });
      }

      expect(updateSpy).not.toHaveBeenCalled();
      updateSpy.mockRestore();
    });

    it(`scene.region.create REFUSES ${label} ("${key}")`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
      const createSpy = vi.spyOn(scene, "createEmbeddedDocuments");

      for (const dryRun of [false, true]) {
        const response = await router.route(
          createRequest("scene.region.create", {
            sceneId: "scene-1",
            data: { name: "Armed", [key]: value },
            ...(dryRun ? { dryRun: true } : {})
          })
        );
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe("INVALID_PARAMS");
        expect(response.error.details).toMatchObject({ field: "behaviors", suppliedKeys: [key] });
      }
      expect(createSpy).not.toHaveBeenCalled();
      createSpy.mockRestore();
    });

    it(`scene.region.clone REFUSES ${label} ("${key}")`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
      const region = scene.regions.get("region-safe");
      const cloneSpy = vi.spyOn(region, "clone");

      const response = await router.route(
        createRequest("scene.region.clone", {
          sceneId: "scene-1",
          regionId: "region-safe",
          patch: { [key]: value }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.details).toMatchObject({ field: "behaviors", suppliedKeys: [key] });
      expect(cloneSpy).not.toHaveBeenCalled();
      cloneSpy.mockRestore();
    });
  }

  for (const command of ["scene.region.create", "scene.region.update", "scene.region.clone"]) {
    it(`${command} refuses an OBJECT-valued behaviors key at the PROTOCOL layer`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const payload = { behaviors: { 0: { type: "executeScript", system: { source: "x" } } } };
      const response = await router.route(
        createRequest(command, {
          sceneId: "scene-1",
          ...(command === "scene.region.create"
            ? { data: { name: "Armed", ...payload } }
            : { regionId: "region-safe", patch: payload })
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(JSON.stringify(response.error.details)).toContain("behaviors");
    });
  }

  it("scene.region.update reports the SHAPE refusal (not the seam refusal) for a dotted executable type", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const response = await router.route(
      createRequest("scene.region.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        patch: {
          "behaviors.0.type": "executeScript",
          "behaviors.0.system.source": "game.actors.forEach(a => a.delete())",
          "behaviors.0.system.events": ["tokenEnter"]
        }
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details).toMatchObject({
      field: "behaviors",
      suppliedKeys: ["behaviors.0.type", "behaviors.0.system.source", "behaviors.0.system.events"]
    });

    expect(response.error.details).not.toHaveProperty("behaviorType");
  });

  it("scene.region.update ACCEPTS the plain behaviors ARRAY (no over-refusal)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const updateSpy = vi.spyOn(scene, "updateEmbeddedDocuments");

    const response = await router.route(
      createRequest("scene.region.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        patch: {
          behaviors: [
            {
              _id: "behavior-darkness",
              name: "Dimmer",
              _stats: { systemId: "spoof" },

              "_stats.systemId": "spoof",
              "ownership.user-1": 3,

              "flags.mymod._id": "keepme"
            }
          ]
        }
      })
    );
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    const sent = /** @type {any} */ (updateSpy.mock.calls[0][1])[0];

    expect(sent.behaviors).toEqual([
      { _id: "behavior-darkness", name: "Dimmer", "flags.mymod._id": "keepme" }
    ]);
    updateSpy.mockRestore();
  });

  it("scene.region.create strips a DOTTED protected-meta key inside an inline behaviors row", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const createSpy = vi.spyOn(scene, "createEmbeddedDocuments");

    const response = await router.route(
      createRequest("scene.region.create", {
        sceneId: "scene-1",
        data: {
          name: "Fresh",
          behaviors: [
            {
              type: "pauseGame",
              name: "Halt",

              "_stats.systemId": "spoof",
              "ownership.user-1": 3,
              "flags.mymod.ownership": 3
            }
          ]
        }
      })
    );
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    const sent = /** @type {any} */ (createSpy.mock.calls[0][1])[0];

    expect(sent.behaviors).toEqual([{ type: "pauseGame", name: "Halt", "flags.mymod.ownership": 3 }]);
    createSpy.mockRestore();
  });

  for (const { label, patch } of [
    { label: "a foreign 16-char _id", patch: { _id: "sp00000000000001" } },
    { label: "a malformed _id", patch: { _id: "hijacked" } },
    { label: "_stats", patch: { _stats: { createdTime: 9 } } },
    {
      label: "ownership (a real core cleans it away; this fixture does not)",
      patch: { ownership: { default: 3 } }
    }
  ]) {
    it(`scene.region.behavior.update judges the SANITIZED patch, so a patch of only ${label} is a no-op success`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
      const region = scene.regions.get("region-safe");

      const updateSpy = vi.spyOn(region, "updateEmbeddedDocuments").mockResolvedValue([]);

      const response = await router.route(
        createRequest("scene.region.behavior.update", {
          sceneId: "scene-1",
          regionId: "region-safe",
          behaviorId: "behavior-darkness",
          patch: { ...patch }
        })
      );
      expect(response.ok).toBe(true);
      expect(response.result.behavior.name).toBe("Dim The Lights");

      expect(/** @type {any} */ (updateSpy.mock.calls[0][1])[0]).toEqual({ _id: "behavior-darkness" });
      updateSpy.mockRestore();

      const dry = await router.route(
        createRequest("scene.region.behavior.update", {
          sceneId: "scene-1",
          regionId: "region-safe",
          behaviorId: "behavior-darkness",
          patch: { ...patch },
          dryRun: true
        })
      );
      expect(dry.ok).toBe(true);
      expect(dry.result.dryRun).toBe(true);
      expect(dry.result.behavior).toEqual(response.result.behavior);
    });
  }

  for (const [label, behaviorId, type] of [
    [
      "a CHANGED type (Foundry cannot flip it and the update path swallows the throw)",
      "behavior-darkness",
      "pauseGame"
    ],
    [
      "an UNCHANGED type (a get → edit → update round-trip carries it; a no-op for Foundry)",
      "behavior-blank",
      "pauseGame"
    ]
  ]) {
    it(`scene.region.behavior.update REFUSES ${label}`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
      const region = scene.regions.get("region-safe");
      const updateSpy = vi.spyOn(region, "updateEmbeddedDocuments");

      const response = await router.route(
        createRequest("scene.region.behavior.update", {
          sceneId: "scene-1",
          regionId: "region-safe",
          behaviorId,
          patch: { type }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");

      expect(response.error.message).toContain("DROP the 'type' key and resend");
      expect(response.error.message).toContain("Only an ACTUAL type change is impossible");
      expect(response.error.details).toMatchObject({ field: "type", behaviorId });
      expect(updateSpy).not.toHaveBeenCalled();
      updateSpy.mockRestore();

      const dry = await router.route(
        createRequest("scene.region.behavior.update", {
          sceneId: "scene-1",
          regionId: "region-safe",
          behaviorId,
          patch: { type },
          dryRun: true
        })
      );
      expect(dry.error.code).toBe("INVALID_PARAMS");
    });
  }

  it("scene.region.behavior.create REJECTS the two code-executing types (real AND dry-run)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-safe");
    const createSpy = vi.spyOn(region, "createEmbeddedDocuments");

    for (const [type, payload] of [
      [
        "executeScript",
        { type: "executeScript", system: { source: "game.actors.forEach(a => a.delete())" } }
      ],
      ["executeMacro", { type: "executeMacro", system: { uuid: "Macro.abc" } }]
    ]) {
      const response = await router.route(
        createRequest("scene.region.behavior.create", {
          sceneId: "scene-1",
          regionId: "region-safe",
          data: payload
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("no arbitrary JavaScript execution from the CLI");
      expect(response.error.details).toMatchObject({ field: "type", behaviorType: type });

      const dry = await router.route(
        createRequest("scene.region.behavior.create", {
          sceneId: "scene-1",
          regionId: "region-safe",
          data: payload,
          dryRun: true
        })
      );
      expect(dry.ok).toBe(false);
      expect(dry.error.code).toBe("INVALID_PARAMS");
    }
    expect(createSpy).not.toHaveBeenCalled();
    createSpy.mockRestore();
  });

  it("scene.region.behavior.update refuses EVERY patch on an executable behavior — including a bare disabled:true", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-safe");
    const updateSpy = vi.spyOn(region, "updateEmbeddedDocuments");

    for (const behaviorId of ["behavior-script", "behavior-macro"]) {
      for (const patch of [{ disabled: true }, { name: "Renamed" }, { system: { source: "evil" } }]) {
        const response = await router.route(
          createRequest("scene.region.behavior.update", {
            sceneId: "scene-1",
            regionId: "region-safe",
            behaviorId,
            patch
          })
        );
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe("INVALID_PARAMS");
        expect(response.error.message).toContain("executes code when the region fires");

        expect(response.error.message).toContain("scene.region.behavior.delete");
      }
    }
    expect(updateSpy).not.toHaveBeenCalled();
    updateSpy.mockRestore();
  });

  it("scene.region.behavior.delete IS allowed on an executable behavior (it supplies no data and removes the execution)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const dry = await router.route(
      createRequest("scene.region.behavior.delete", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-script",
        dryRun: true
      })
    );
    expect(dry.ok).toBe(true);
    expect(dry.result).toEqual({
      sceneId: "scene-1",
      regionId: "region-safe",
      id: "behavior-script",
      deleted: false,
      dryRun: true
    });

    const response = await router.route(
      createRequest("scene.region.behavior.delete", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-script"
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.deleted).toBe(true);
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    expect(scene.regions.get("region-safe").behaviors.get("behavior-script")).toBeNull();
  });

  it("scene.region.behavior.clone with NO patch is ALLOWED on an executable behavior, and ANY patch on one is refused", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const allowed = await router.route(
      createRequest("scene.region.behavior.clone", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-script"
      })
    );
    expect(allowed.ok).toBe(true);
    expect(allowed.result.behavior.type).toBe("executeScript");
    expect(allowed.result.behavior.id).toBe("behavior-script-clone");

    for (const patch of [{ name: "Copy" }, { disabled: true }, { system: { source: "evil" } }]) {
      const refused = await router.route(
        createRequest("scene.region.behavior.clone", {
          sceneId: "scene-1",
          regionId: "region-safe",
          behaviorId: "behavior-script",
          patch
        })
      );
      expect(refused.ok).toBe(false);
      expect(refused.error.code).toBe("INVALID_PARAMS");
      expect(refused.error.message).toContain("clone it with NO --patch");
      expect(refused.error.details).toMatchObject({ behaviorType: "executeScript", field: "patch" });
    }
  });

  it("scene.region.behavior.clone of a DECLARATIVE behavior accepts a patch, and rejects a supplied executable type", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const cloned = await router.route(
      createRequest("scene.region.behavior.clone", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-darkness",
        patch: { name: "Dimmer" }
      })
    );
    expect(cloned.ok).toBe(true);
    expect(cloned.result.behavior.name).toBe("Dimmer");

    const refused = await router.route(
      createRequest("scene.region.behavior.clone", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-darkness",
        patch: { type: "executeScript" }
      })
    );
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("INVALID_PARAMS");
    expect(refused.error.details).toMatchObject({ field: "type", behaviorType: "executeScript" });
  });

  it("scene.region.behavior.update reports the JS refusal (not the type-immutability one) for a supplied executable type — guard ORDER is contract", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.region.behavior.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-darkness",
        patch: { type: "executeScript" }
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.message).toContain("no arbitrary JavaScript execution from the CLI");
    expect(response.error.details).toMatchObject({ field: "type", behaviorType: "executeScript" });
  });

  it("scene.region.behavior dry runs return the same shape as the real call and persist nothing", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-safe");
    const createSpy = vi.spyOn(region, "createEmbeddedDocuments");
    const updateSpy = vi.spyOn(region, "updateEmbeddedDocuments");
    const deleteSpy = vi.spyOn(region, "deleteEmbeddedDocuments");
    const before = region.behaviors.size;

    const create = await router.route(
      createRequest("scene.region.behavior.create", {
        sceneId: "scene-1",
        regionId: "region-safe",
        data: { type: "suppressWeather", name: "Calm" },
        dryRun: true
      })
    );
    expect(create.ok).toBe(true);
    expect(create.result.dryRun).toBe(true);

    expect(create.result.behavior.id).toBeNull();
    expect(create.result.behavior).toMatchObject({ name: "Calm", type: "suppressWeather" });

    const update = await router.route(
      createRequest("scene.region.behavior.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-darkness",
        patch: { name: "Previewed" },
        dryRun: true
      })
    );
    expect(update.ok).toBe(true);
    expect(update.result.dryRun).toBe(true);

    expect(update.result.behavior).toMatchObject({ id: "behavior-darkness", name: "Previewed" });
    expect(region.behaviors.get("behavior-darkness").name).toBe("Dim The Lights");

    const clone = await router.route(
      createRequest("scene.region.behavior.clone", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-darkness",
        patch: { name: "Previewed Clone" },
        dryRun: true
      })
    );
    expect(clone.ok).toBe(true);
    expect(clone.result.dryRun).toBe(true);
    expect(clone.result.behavior.id).toBeNull();
    expect(clone.result.behavior.name).toBe("Previewed Clone");

    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(region.behaviors.size).toBe(before);
    createSpy.mockRestore();
    updateSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  it("scene.region.behavior.create previews on a COPY, so the strict construction cannot leak into the real payload", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-safe");
    const createSpy = vi.spyOn(region, "createEmbeddedDocuments");

    const response = await router.route(
      createRequest("scene.region.behavior.create", {
        sceneId: "scene-1",
        regionId: "region-safe",
        data: { type: "displayScrollingText", name: "Shout", system: { text: "Boo" } }
      })
    );
    expect(response.ok).toBe(true);
    const sent = /** @type {any} */ (createSpy.mock.calls[0][1])[0];
    expect(sent).toEqual({ type: "displayScrollingText", name: "Shout", system: { text: "Boo" } });
    expect(sent.system).not.toHaveProperty("__cleaned");
    expect(sent).not.toHaveProperty("_stats");
    createSpy.mockRestore();
  });

  it("scene.region.behavior.clone REFUSES a supplied `type` too (bridge policy, and it keeps the probe from being the gate)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-safe");
    const before = region.behaviors.size;

    for (const dryRun of [false, true]) {
      const response = await router.route(
        createRequest("scene.region.behavior.clone", {
          sceneId: "scene-1",
          regionId: "region-safe",
          behaviorId: "behavior-darkness",
          patch: { type: "displayScrollingText" },
          ...(dryRun ? { dryRun: true } : {})
        })
      );
      expect(response.ok, `dryRun:${dryRun} must be rejected`).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("cannot change 'type'");
      expect(response.error.details).toMatchObject({ field: "type", behaviorId: "behavior-darkness" });
    }
    expect(region.behaviors.size).toBe(before);

    const executable = await router.route(
      createRequest("scene.region.behavior.clone", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-darkness",
        patch: { type: "executeMacro" }
      })
    );
    expect(executable.error.code).toBe("INVALID_PARAMS");
    expect(executable.error.message).toContain("no arbitrary JavaScript execution from the CLI");
  });

  for (const { spelling, patchValue } of /** @type {{ spelling: string, patchValue: any }[]} */ ([
    { spelling: "==type", patchValue: "displayScrollingText" },
    { spelling: "-=type", patchValue: null },
    { spelling: "type.value", patchValue: "displayScrollingText" },
    { spelling: "type.anything", patchValue: 1 }
  ])) {
    it(`scene.region.behavior.* refuse the '${spelling}' spelling of type on create/update/clone (real AND dry-run)`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
      const region = scene.regions.get("region-safe");
      const createSpy = vi.spyOn(region, "createEmbeddedDocuments");
      const updateSpy = vi.spyOn(region, "updateEmbeddedDocuments");
      const before = region.behaviors.size;

      for (const dryRun of [false, true]) {
        const created = await router.route(
          createRequest("scene.region.behavior.create", {
            sceneId: "scene-1",
            regionId: "region-safe",
            data: { type: "pauseGame", name: "Sneaky", [spelling]: patchValue },
            ...(dryRun ? { dryRun: true } : {})
          })
        );
        expect(created.ok, `create dryRun:${dryRun} must be rejected`).toBe(false);
        expect(created.error.code).toBe("INVALID_PARAMS");
        expect(created.error.message).toContain("may spell 'type' ONLY as the plain 'type' key");
        expect(created.error.details).toMatchObject({ field: "type", suppliedKeys: [spelling] });

        const updated = await router.route(
          createRequest("scene.region.behavior.update", {
            sceneId: "scene-1",
            regionId: "region-safe",
            behaviorId: "behavior-darkness",
            patch: { [spelling]: patchValue },
            ...(dryRun ? { dryRun: true } : {})
          })
        );
        expect(updated.ok, `update dryRun:${dryRun} must be rejected`).toBe(false);
        expect(updated.error.code).toBe("INVALID_PARAMS");
        expect(updated.error.message).toContain("create-only");

        expect(updated.error.message).not.toContain("preUpdateRegionBehavior");
        expect(updated.error.message).not.toContain("disable the module that locks");
        expect(updated.error.details).toMatchObject({
          field: "type",
          suppliedKeys: [spelling],
          behaviorId: "behavior-darkness"
        });

        const cloned = await router.route(
          createRequest("scene.region.behavior.clone", {
            sceneId: "scene-1",
            regionId: "region-safe",
            behaviorId: "behavior-darkness",
            patch: { [spelling]: patchValue },
            ...(dryRun ? { dryRun: true } : {})
          })
        );
        expect(cloned.ok, `clone dryRun:${dryRun} must be rejected`).toBe(false);
        expect(cloned.error.code).toBe("INVALID_PARAMS");
        expect(cloned.error.message).toContain("create-only");
        expect(cloned.error.message).not.toContain("preUpdateRegionBehavior");
        expect(cloned.error.details).toMatchObject({ field: "type", suppliedKeys: [spelling] });
      }

      expect(createSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(region.behaviors.size).toBe(before);
      createSpy.mockRestore();
      updateSpy.mockRestore();
    });
  }

  it("scene.region.behavior.* report the JS refusal for an executable '==type' — guard ORDER survives the new spelling", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    for (const [command, params] of [
      [
        "scene.region.behavior.create",
        {
          sceneId: "scene-1",
          regionId: "region-safe",
          data: { type: "pauseGame", "==type": "executeScript" }
        }
      ],
      [
        "scene.region.behavior.update",
        {
          sceneId: "scene-1",
          regionId: "region-safe",
          behaviorId: "behavior-darkness",
          patch: { "==type": "executeMacro" }
        }
      ],
      [
        "scene.region.behavior.clone",
        {
          sceneId: "scene-1",
          regionId: "region-safe",
          behaviorId: "behavior-darkness",
          patch: { "==type": "executeScript" }
        }
      ]
    ]) {
      const response = await router.route(
        createRequest(/** @type {any} */ (command), /** @type {any} */ (params))
      );
      expect(response.ok, `${command} must be rejected`).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("no arbitrary JavaScript execution from the CLI");
      expect(response.error.details).toMatchObject({ field: "type", suppliedKey: "==type" });
    }
  });

  for (const padded of [" executeScript", "executeScript ", "\n executeScript\t", " executeMacro"]) {
    it(`the no-arbitrary-JS seam classifies the TRIMMED type on both routes (${JSON.stringify(padded)})`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
      const region = scene.regions.get("region-safe");
      const stored = padded.trim();
      const behaviorCreateSpy = vi.spyOn(region, "createEmbeddedDocuments");
      const regionCreateSpy = vi.spyOn(scene, "createEmbeddedDocuments");
      const regionUpdateSpy = vi.spyOn(scene, "updateEmbeddedDocuments");

      for (const dryRun of [false, true]) {
        const suffix = ` dryRun:${dryRun}`;

        for (const key of ["type", "==type"]) {
          const created = await router.route(
            createRequest("scene.region.behavior.create", {
              sceneId: "scene-1",
              regionId: "region-safe",
              data: { type: "pauseGame", [key]: padded, system: { source: "1" } },
              ...(dryRun ? { dryRun: true } : {})
            })
          );
          expect(created.ok, `behavior.create ${key}${suffix} must be rejected`).toBe(false);
          expect(created.error.code).toBe("INVALID_PARAMS");
          expect(created.error.message).toContain("no arbitrary JavaScript execution from the CLI");

          expect(created.error.details).toMatchObject({
            field: "type",
            suppliedKey: key,
            behaviorType: stored
          });
        }

        const inlineCreate = await router.route(
          createRequest("scene.region.create", {
            sceneId: "scene-1",
            data: { name: "Padded", behaviors: [{ type: padded, system: { source: "1" } }] },
            ...(dryRun ? { dryRun: true } : {})
          })
        );
        expect(inlineCreate.ok, `region.create${suffix} must be rejected`).toBe(false);
        expect(inlineCreate.error.code).toBe("INVALID_PARAMS");
        expect(inlineCreate.error.details).toMatchObject({ field: "behaviors", behaviorType: stored });

        const inlineUpdate = await router.route(
          createRequest("scene.region.update", {
            sceneId: "scene-1",
            regionId: "region-safe",
            patch: { behaviors: [{ type: padded, system: { source: "1" } }] },
            ...(dryRun ? { dryRun: true } : {})
          })
        );
        expect(inlineUpdate.ok, `region.update${suffix} must be rejected`).toBe(false);
        expect(inlineUpdate.error.code).toBe("INVALID_PARAMS");
        expect(inlineUpdate.error.details).toMatchObject({ field: "behaviors", behaviorType: stored });
      }

      expect(behaviorCreateSpy).not.toHaveBeenCalled();
      expect(regionCreateSpy).not.toHaveBeenCalled();
      expect(regionUpdateSpy).not.toHaveBeenCalled();
      behaviorCreateSpy.mockRestore();
      regionCreateSpy.mockRestore();
      regionUpdateSpy.mockRestore();
    });
  }

  for (const { label, entry, expected, storedType } of /** @type {any[]} */ ([
    {
      label: "a forced-replacement '==type' inside an entry",
      entry: { "==type": "executeScript", system: { source: "alert(1)" } },
      expected: "seam",
      storedType: "executeScript"
    },
    {
      label: "a forced-replacement '==type' beside a valid plain type",
      entry: { type: "pauseGame", "==type": "executeMacro", system: { uuid: "Macro.aaaaaaaaaaaaaaaa" } },
      expected: "seam",
      storedType: "executeMacro"
    },
    {
      label: "a v14 ForcedReplacement operator OBJECT in a plain type",
      entry: {
        type: { __$OPERATOR$__: "ForcedReplacement", value: "executeScript" },
        system: { source: "alert(1)" }
      },
      expected: "shape"
    },
    {
      label: "an array-wrapped executable type",
      entry: { type: ["executeScript"], system: { source: "alert(1)" } },
      expected: "shape"
    },
    {
      label: "an array-wrapped DECLARATIVE type (the named over-refusal)",
      entry: { type: ["pauseGame"] },
      expected: "shape"
    },
    {
      label: "a dotted 'type.value' sub-path inside an entry",
      entry: { "type.value": "executeScript", system: { source: "alert(1)" } },
      expected: "shape"
    },
    {
      label: "a forced-deletion '-=type' inside an entry",
      entry: { "-=type": null, name: "Nameless" },
      expected: "shape"
    },
    {
      label: "a numeric type",
      entry: { type: 123 },
      expected: "shape"
    }
  ])) {
    it(`the inline behaviors route REFUSES ${label}`, async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
      const region = scene.regions.get("region-safe");
      const createSpy = vi.spyOn(scene, "createEmbeddedDocuments");
      const updateSpy = vi.spyOn(scene, "updateEmbeddedDocuments");
      const cloneSpy = vi.spyOn(region, "clone");

      for (const dryRun of [false, true]) {
        for (const [command, params] of /** @type {any[]} */ ([
          ["scene.region.create", { sceneId: "scene-1", data: { name: "Armed", behaviors: [entry] } }],
          [
            "scene.region.update",
            { sceneId: "scene-1", regionId: "region-safe", patch: { behaviors: [entry] } }
          ],
          [
            "scene.region.clone",
            { sceneId: "scene-1", regionId: "region-safe", patch: { behaviors: [entry] } }
          ]
        ])) {
          const response = await router.route(
            createRequest(command, { ...params, ...(dryRun ? { dryRun: true } : {}) })
          );
          expect(response.ok, `${command} dryRun:${dryRun} must be rejected`).toBe(false);
          expect(response.error.code).toBe("INVALID_PARAMS");
          if (expected === "seam") {
            expect(response.error.message).toContain("no arbitrary JavaScript execution from the CLI");
            expect(response.error.details).toMatchObject({ field: "behaviors", behaviorType: storedType });
          } else {
            expect(response.error.message).toContain(
              "must spell its type as the plain 'type' key carrying a STRING"
            );
            expect(response.error.message).toContain("no arbitrary JavaScript execution from the CLI");
            expect(response.error.details).toMatchObject({ field: "behaviors", behaviorIndex: 0 });
          }
        }
      }

      expect(createSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(cloneSpy).not.toHaveBeenCalled();
      createSpy.mockRestore();
      updateSpy.mockRestore();
      cloneSpy.mockRestore();
    });
  }

  it("the inline behaviors route reports the SEAM refusal when a later entry arms a trigger (pass order)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const response = await router.route(
      createRequest("scene.region.create", {
        sceneId: "scene-1",
        data: {
          name: "Mixed",
          behaviors: [{ type: 123 }, { type: "executeScript", system: { source: "alert(1)" } }]
        }
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.message).toContain("no arbitrary JavaScript execution from the CLI");
    expect(response.error.details).toMatchObject({ field: "behaviors", behaviorType: "executeScript" });
  });

  it("the inline behaviors route reports the SEAM refusal for an unreadable type beside an _id addressing an armed behavior", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-lava");
    region.behaviors = [{ _id: "beh-script", type: "executeScript", system: { source: "1" } }];
    const updateSpy = vi.spyOn(scene, "updateEmbeddedDocuments");

    const armed = await router.route(
      createRequest("scene.region.update", {
        sceneId: "scene-1",
        regionId: "region-lava",
        patch: { behaviors: [{ _id: "beh-script", type: 123, system: { source: "alert(1)" } }] }
      })
    );
    expect(armed.ok).toBe(false);
    expect(armed.error.code).toBe("INVALID_PARAMS");
    expect(armed.error.message).toContain("no arbitrary JavaScript execution from the CLI");
    expect(armed.error.details).toMatchObject({ field: "behaviors", behaviorType: "executeScript" });

    region.behaviors = [{ _id: "beh-pause", type: "pauseGame" }];
    const declarative = await router.route(
      createRequest("scene.region.update", {
        sceneId: "scene-1",
        regionId: "region-lava",
        patch: { behaviors: [{ _id: "beh-pause", type: ["executeScript"] }] }
      })
    );
    expect(declarative.ok).toBe(false);
    expect(declarative.error.code).toBe("INVALID_PARAMS");
    expect(declarative.error.message).toContain(
      "must spell its type as the plain 'type' key carrying a STRING"
    );
    expect(declarative.error.details).toMatchObject({ field: "behaviors", behaviorIndex: 0 });

    expect(updateSpy).not.toHaveBeenCalled();
    updateSpy.mockRestore();
  });

  it("scene.region.behavior.clone answers INVALID_PARAMS for an invalid patch on BOTH paths (no cleaned-preview divergence)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    for (const dryRun of [true, false]) {
      const response = await router.route(
        createRequest("scene.region.behavior.clone", {
          sceneId: "scene-1",
          regionId: "region-safe",
          behaviorId: "behavior-darkness",
          patch: { system: { invalid: true } },
          ...(dryRun ? { dryRun: true } : {})
        })
      );
      expect(response.ok, `dryRun:${dryRun} must be rejected`).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
    }
  });

  it("scene.region.behavior.create answers INVALID_PARAMS for a payload Foundry rejects on BOTH paths (the strict construction serves both)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    for (const dryRun of [true, false]) {
      const response = await router.route(
        createRequest("scene.region.behavior.create", {
          sceneId: "scene-1",
          regionId: "region-safe",
          data: { type: "pauseGame", system: { invalid: true } },
          ...(dryRun ? { dryRun: true } : {})
        })
      );
      expect(response.ok, `dryRun:${dryRun} must be rejected`).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
    }
  });

  it("scene.region.behavior.update reports a VETOED write as an error instead of echoing the row", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-safe");

    const updateSpy = vi.spyOn(region, "updateEmbeddedDocuments").mockResolvedValue([]);

    const response = await router.route(
      createRequest("scene.region.behavior.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-darkness",
        patch: { name: "Vetoed" }
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INTERNAL_ERROR");
    expect(response.error.message).toContain("preUpdateRegionBehavior");
    expect(response.error.message).toContain("no force flag");
    expect(response.error.details).toMatchObject({
      sceneId: "scene-1",
      regionId: "region-safe",
      behaviorId: "behavior-darkness",
      fields: ["name"]
    });
    updateSpy.mockRestore();
  });

  it("scene.region.behavior.update accepts a NO-OP patch (an empty diff is dropped exactly like a veto)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-safe");
    const updateSpy = vi.spyOn(region, "updateEmbeddedDocuments").mockResolvedValue([]);

    const response = await router.route(
      createRequest("scene.region.behavior.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-darkness",
        patch: { name: "Dim The Lights" }
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.behavior.name).toBe("Dim The Lights");
    updateSpy.mockRestore();
  });

  it("scene.region.behavior.update answers REGION_BEHAVIOR_NOT_FOUND when the row vanished mid-write", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-safe");

    const updateSpy = vi.spyOn(region, "updateEmbeddedDocuments").mockImplementation(async () => {
      region.behaviors.delete("behavior-darkness");
      return [];
    });

    const response = await router.route(
      createRequest("scene.region.behavior.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-darkness",
        patch: { name: "Gone" }
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("REGION_BEHAVIOR_NOT_FOUND");
    expect(response.error.details).toMatchObject({ removedDuringUpdate: true });

    expect(response.error.message).toContain("REMOVED while this update was in flight");
    updateSpy.mockRestore();
  });

  it("scene.region.behavior.delete reports a VETOED delete instead of deleted:true", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-safe");
    const deleteSpy = vi.spyOn(region, "deleteEmbeddedDocuments").mockResolvedValue([]);

    const response = await router.route(
      createRequest("scene.region.behavior.delete", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-darkness"
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INTERNAL_ERROR");
    expect(response.error.message).toContain("preDeleteRegionBehavior");
    expect(response.error.details).toMatchObject({ behaviorId: "behavior-darkness" });
    deleteSpy.mockRestore();
  });

  it("scene.region.behavior.create reports a REFUSED create instead of an unhelpful bare message", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    const region = scene.regions.get("region-safe");
    const createSpy = vi.spyOn(region, "createEmbeddedDocuments").mockResolvedValue([]);

    const response = await router.route(
      createRequest("scene.region.behavior.create", {
        sceneId: "scene-1",
        regionId: "region-safe",
        data: { type: "pauseGame" }
      })
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INTERNAL_ERROR");
    expect(response.error.message).toContain("preCreateRegionBehavior");
    expect(response.error.details).toMatchObject({ regionId: "region-safe" });
    createSpy.mockRestore();
  });

  it("scene.template.* returns UNSUPPORTED_OPERATION when the Scene schema has no templates collection (v14)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));

    delete scene.templates;

    const list = await router.route(createRequest("scene.template.list", { sceneId: "scene-1" }));
    expect(list.ok).toBe(false);
    expect(list.error.code).toBe("UNSUPPORTED_OPERATION");

    const create = await router.route(
      createRequest("scene.template.create", {
        sceneId: "scene-1",
        data: { t: "circle", x: 1, y: 1, distance: 5 }
      })
    );
    expect(create.ok).toBe(false);
    expect(create.error.code).toBe("UNSUPPORTED_OPERATION");

    const get = await router.route(
      createRequest("scene.template.get", { sceneId: "scene-1", templateId: "template-fireball" })
    );
    expect(get.ok).toBe(false);
    expect(get.error.code).toBe("UNSUPPORTED_OPERATION");
  });

  it("scene.region create/update dry-run previews without persisting", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const createPreview = await router.route(
      createRequest("scene.region.create", {
        sceneId: "scene-1",
        data: { name: "Preview Zone", shapes: [] },
        dryRun: true
      })
    );
    expect(createPreview.ok).toBe(true);
    expect(createPreview.result.dryRun).toBe(true);
    expect(createPreview.result.region.name).toBe("Preview Zone");

    const afterCreate = await router.route(createRequest("scene.region.list", { sceneId: "scene-1" }));
    expect(afterCreate.result.regions).toHaveLength(2);

    const updatePreview = await router.route(
      createRequest("scene.region.update", {
        sceneId: "scene-1",
        regionId: "region-lava",
        patch: { name: "Renamed" },
        dryRun: true
      })
    );
    expect(updatePreview.ok).toBe(true);
    expect(updatePreview.result.dryRun).toBe(true);
    expect(updatePreview.result.region.name).toBe("Renamed");
    expect(updatePreview.result).not.toHaveProperty("preview");
  });

  it("lists, gets, creates, updates, clones, and deletes scene sounds", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("scene.sound.list", { sceneId: "scene-1" }));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.sounds).toHaveLength(1);
    expect(listResponse.result.sounds[0].path).toBe("sounds/wind.ogg");

    const getResponse = await router.route(
      createRequest("scene.sound.get", { sceneId: "scene-1", soundId: "sound-a" })
    );
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.sound.radius).toBe(30);

    const createResponse = await router.route(
      createRequest("scene.sound.create", {
        sceneId: "scene-1",
        data: { path: "sounds/rain.ogg", x: 5, y: 5, radius: 20 }
      })
    );
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.sound.path).toBe("sounds/rain.ogg");

    const updateResponse = await router.route(
      createRequest("scene.sound.update", { sceneId: "scene-1", soundId: "sound-a", patch: { volume: 0.9 } })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.sound.volume).toBe(0.9);

    const cloneResponse = await router.route(
      createRequest("scene.sound.clone", { sceneId: "scene-1", soundId: "sound-a", patch: { radius: 99 } })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.sound.id).toBe("sound-a-clone");
    expect(cloneResponse.result.sound.radius).toBe(99);

    const deleteResponse = await router.route(
      createRequest("scene.sound.delete", { sceneId: "scene-1", soundId: "sound-a" })
    );
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: "sound-a", deleted: true });

    const missing = await router.route(
      createRequest("scene.sound.get", { sceneId: "scene-1", soundId: "sound-a" })
    );
    expect(missing.error.code).toBe("SOUND_NOT_FOUND");
  });
});

describe("executable region behaviors", () => {
  let router;

  beforeEach(() => {
    installFakeFoundry();
    router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
  });

  const MACRO_UUID = "Macro.macro-1";

  function behaviors() {
    return globalThis.game.scenes.get("scene-1").regions.get("region-safe").behaviors;
  }

  it("arms an executeMacro behavior the ordinary create refuses", async () => {
    const refused = await router.route(
      createRequest("scene.region.behavior.create", {
        sceneId: "scene-1",
        regionId: "region-lava",
        data: { type: "executeMacro", system: { uuid: MACRO_UUID } }
      })
    );
    expect(refused.ok).toBe(false);
    expect(refused.error.details).toMatchObject({ behaviorType: "executeMacro" });

    const armed = await router.route(
      createRequest("scene.region.behavior.executable.create", {
        sceneId: "scene-1",
        regionId: "region-lava",
        data: { type: "executeMacro", name: "Spring Trap", system: { uuid: MACRO_UUID } }
      })
    );
    expect(armed.ok).toBe(true);
    expect(armed.result.behavior).toMatchObject({ type: "executeMacro", name: "Spring Trap" });
  });

  it("refuses executeScript on the executable family too", async () => {
    const response = await router.route(
      createRequest("scene.region.behavior.executable.create", {
        sceneId: "scene-1",
        regionId: "region-lava",
        data: { type: "executeScript", system: { source: "game.actors.forEach((a) => a.delete())" } }
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
  });

  it("requires a macro uuid that names a macro in this world", async () => {
    const cases = [
      { system: {}, reason: "missing" },
      { system: { uuid: "Macro.ghost" }, reason: "unknown" },
      { system: { uuid: "Actor.actor-1" }, reason: "wrong type" },
      { system: { uuid: "Compendium.world.packed-macros.Macro.abc" }, reason: "compendium" }
    ];

    for (const { system, reason } of cases) {
      const response = await router.route(
        createRequest("scene.region.behavior.executable.create", {
          sceneId: "scene-1",
          regionId: "region-lava",
          data: { type: "executeMacro", system }
        })
      );

      expect(response.ok, reason).toBe(false);
      expect(response.error.code, reason).toBe("INVALID_PARAMS");
      expect(response.error.details.field, reason).toBe("system.uuid");
    }
  });

  it("previews an armed behavior without writing it", async () => {
    const before = behaviors().size;

    const response = await router.route(
      createRequest("scene.region.behavior.executable.create", {
        sceneId: "scene-1",
        regionId: "region-safe",
        data: { type: "executeMacro", system: { uuid: MACRO_UUID } },
        dryRun: true
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({ dryRun: true });
    expect(behaviors().size).toBe(before);
  });

  it("edits an existing executeMacro behavior the ordinary update refuses in full", async () => {
    const refused = await router.route(
      createRequest("scene.region.behavior.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-macro",
        patch: { disabled: true }
      })
    );
    expect(refused.ok).toBe(false);
    expect(refused.error.details).toMatchObject({ behaviorType: "executeMacro" });

    const response = await router.route(
      createRequest("scene.region.behavior.executable.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-macro",
        patch: { disabled: true, system: { uuid: MACRO_UUID } }
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.behavior).toMatchObject({ disabled: true });
  });

  it("accepts the executeMacro type on its own update patch, which the ordinary update rejects", async () => {
    const refused = await router.route(
      createRequest("scene.region.behavior.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-darkness",
        patch: { type: "adjustDarknessLevel" }
      })
    );
    expect(refused.ok).toBe(false);
    expect(refused.error.details).toMatchObject({ field: "type" });

    const response = await router.route(
      createRequest("scene.region.behavior.executable.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-darkness",
        patch: { type: "executeMacro", system: { uuid: MACRO_UUID } },
        dryRun: true
      })
    );
    expect(response.ok).toBe(true);
  });

  it("requires a macro when an update is what arms the behavior", async () => {
    const unarmed = await router.route(
      createRequest("scene.region.behavior.executable.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-darkness",
        patch: { type: "executeMacro" }
      })
    );
    expect(unarmed.ok).toBe(false);
    expect(unarmed.error.details).toMatchObject({ field: "system.uuid" });

    const alreadyArmed = await router.route(
      createRequest("scene.region.behavior.executable.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-macro",
        patch: { disabled: true }
      })
    );
    expect(alreadyArmed.ok).toBe(true);
  });

  it("refuses an executeScript target on every verb of the executable family", async () => {
    const update = await router.route(
      createRequest("scene.region.behavior.executable.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-script",
        patch: { disabled: true }
      })
    );
    expect(update.ok).toBe(false);
    expect(update.error.details).toMatchObject({ behaviorType: "executeScript" });

    const clone = await router.route(
      createRequest("scene.region.behavior.executable.clone", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-script",
        patch: { name: "Copy" }
      })
    );
    expect(clone.ok).toBe(false);
    expect(clone.error.details).toMatchObject({ behaviorType: "executeScript" });

    const unpatchedClone = await router.route(
      createRequest("scene.region.behavior.executable.clone", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-script"
      })
    );
    expect(unpatchedClone.ok).toBe(false);
    expect(unpatchedClone.error.details).toMatchObject({ behaviorType: "executeScript" });
    expect(unpatchedClone.error.message).not.toContain("clone it with NO --patch");
  });

  it("still duplicates an unpatched executeScript behavior on the ordinary clone route", async () => {
    const response = await router.route(
      createRequest("scene.region.behavior.clone", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-script"
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.behavior).toMatchObject({ type: "executeScript" });
  });

  it("clones an executeMacro behavior with a patch the ordinary clone refuses", async () => {
    const refused = await router.route(
      createRequest("scene.region.behavior.clone", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-macro",
        patch: { name: "Second Trap" }
      })
    );
    expect(refused.ok).toBe(false);
    expect(refused.error.details).toMatchObject({ behaviorType: "executeMacro" });

    const response = await router.route(
      createRequest("scene.region.behavior.executable.clone", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-macro",
        patch: { name: "Second Trap" }
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.behavior).toMatchObject({ name: "Second Trap", type: "executeMacro" });
  });

  it("refuses every operator spelling of 'system' on all three verbs, so no decoy can hide the macro", async () => {
    const spellings = [
      {
        label: "whole-object replacement",
        payload: { "==system": { uuid: MACRO_UUID } },
        keys: ["==system"]
      },
      {
        label: "whole-object replacement beside a decoy plain system",
        payload: { system: { uuid: MACRO_UUID }, "==system": { uuid: MACRO_UUID } },
        keys: ["==system"]
      },
      { label: "one replaced field", payload: { "==system.uuid": MACRO_UUID }, keys: ["==system.uuid"] },
      { label: "whole-object deletion", payload: { "-=system": null }, keys: ["-=system"] },
      { label: "one deleted field", payload: { "-=system.uuid": null }, keys: ["-=system.uuid"] },
      {
        label: "an operator on the dotted field itself",
        payload: { "system.==uuid": MACRO_UUID },
        keys: ["system.==uuid"]
      },
      {
        label: "a deletion of the dotted field itself",
        payload: { "system.-=uuid": null },
        keys: ["system.-=uuid"]
      },
      {
        label: "an operator inside the plain system object",
        payload: { system: { "==uuid": MACRO_UUID } },
        keys: ["system.==uuid"]
      },
      {
        label: "a deletion inside the plain system object",
        payload: { system: { "-=uuid": null } },
        keys: ["system.-=uuid"]
      }
    ];

    const before = behaviors().size;
    for (const { label, payload, keys } of spellings) {
      const requests = [
        createRequest("scene.region.behavior.executable.create", {
          sceneId: "scene-1",
          regionId: "region-safe",
          data: { type: "executeMacro", ...payload }
        }),
        createRequest("scene.region.behavior.executable.update", {
          sceneId: "scene-1",
          regionId: "region-safe",
          behaviorId: "behavior-macro",
          patch: payload
        }),
        createRequest("scene.region.behavior.executable.clone", {
          sceneId: "scene-1",
          regionId: "region-safe",
          behaviorId: "behavior-macro",
          patch: payload
        })
      ];

      for (const request of requests) {
        const reason = `${request.command} with ${label}`;
        const response = await router.route(request);

        expect(response.ok, reason).toBe(false);
        expect(response.error.code, reason).toBe("INVALID_PARAMS");
        expect(response.error.details, reason).toMatchObject({ field: "system", suppliedKeys: keys });
        expect(response.error.message, reason).toContain("ONLY as the plain 'system' object");
      }
    }

    expect(behaviors().size).toBe(before);
  });

  it("refuses a payload that mixes the plain 'system' object with a dotted 'system.<field>' path", async () => {
    const response = await router.route(
      createRequest("scene.region.behavior.executable.update", {
        sceneId: "scene-1",
        regionId: "region-safe",
        behaviorId: "behavior-macro",
        patch: { system: { uuid: MACRO_UUID }, "system.uuid": "Macro.ghost" }
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(response.error.details).toMatchObject({
      field: "system",
      suppliedKeys: ["system", "system.uuid"]
    });
    expect(response.error.message).toContain("not both");
  });

  it("reads a dotted plain 'system.uuid' as the macro the behavior would run", async () => {
    const refused = await router.route(
      createRequest("scene.region.behavior.executable.create", {
        sceneId: "scene-1",
        regionId: "region-safe",
        data: { type: "executeMacro", "system.uuid": "Macro.ghost" }
      })
    );
    expect(refused.ok).toBe(false);
    expect(refused.error.details).toMatchObject({ field: "system.uuid" });

    const armed = await router.route(
      createRequest("scene.region.behavior.executable.create", {
        sceneId: "scene-1",
        regionId: "region-safe",
        data: { type: "executeMacro", "system.uuid": MACRO_UUID }
      })
    );
    expect(armed.ok).toBe(true);
  });

  it("keeps the nested behaviors array closed to executable types on the executable family's own scene", async () => {
    for (const type of ["executeMacro", "executeScript"]) {
      const response = await router.route(
        createRequest("scene.region.update", {
          sceneId: "scene-1",
          regionId: "region-lava",
          patch: { behaviors: [{ type, system: { uuid: MACRO_UUID } }] }
        })
      );

      expect(response.ok, type).toBe(false);
      expect(response.error.details, type).toMatchObject({ field: "behaviors", behaviorType: type });
    }
  });
});
