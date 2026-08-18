import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";

import {
  createActorDocument,
  createDocument,
  createRequest,
  installFakeFoundry
} from "./helpers/fake-foundry.js";

describe("command router", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  it("lists, creates, and updates actor embedded items", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const listResponse = await router.route(createRequest("actor.item.list", { actorId: "actor-1" }));
    const createResponse = await router.route(
      createRequest("actor.item.create", {
        actorId: "actor-1",
        data: {
          name: "Torch",
          type: "loot",
          system: {
            quantity: 2
          }
        }
      })
    );
    const updateResponse = await router.route(
      createRequest("actor.item.update", {
        actorId: "actor-1",
        itemId: "actor-item-1",
        patch: {
          name: "Steel Shield",
          system: {
            armor: 3
          }
        }
      })
    );

    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.actorId).toBe("actor-1");
    expect(listResponse.result.items[0].name).toBe("Shield");
    expect(createResponse.ok).toBe(true);
    expect(createResponse.result.actorId).toBe("actor-1");
    expect(createResponse.result.item.name).toBe("Torch");
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.item.name).toBe("Steel Shield");
    expect(updateResponse.result.item.system.armor).toBe(3);
  });

  it("creates an actor embedded item carrying flags and nested effects (nested meta stripped, origin kept)", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const actor = globalThis.game.actors.get("actor-1");
    const createResponse = await router.route(
      createRequest("actor.item.create", {
        actorId: "actor-1",
        data: {
          name: "Longsword",
          type: "weapon",
          flags: { ddbimporter: { id: 1 } },
          effects: [
            {
              name: "Bless",
              transfer: true,
              origin: "Item.abc",

              _id: "spoofed",
              _stats: { hacked: true },
              ownership: { default: 3 }
            }
          ]
        }
      })
    );

    expect(createResponse.ok, JSON.stringify(createResponse.error)).toBe(true);

    const itemCall = actor.createEmbeddedDocuments.mock.calls.find(([type]) => type === "Item");
    expect(itemCall).toBeDefined();
    const [, entries] = itemCall;
    const created = entries[0];

    expect(created.flags).toEqual({ ddbimporter: { id: 1 } });

    const nestedEffect = created.effects[0];
    expect(nestedEffect).not.toHaveProperty("_id");
    expect(nestedEffect).not.toHaveProperty("_stats");
    expect(nestedEffect).not.toHaveProperty("ownership");
    expect(nestedEffect.origin).toBe("Item.abc");
    expect(nestedEffect.transfer).toBe(true);
  });

  it("canonicalizes a literal embedded-item img (and nested effect img) on create/update", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const actor = globalThis.game.actors.get("actor-1");
    const createResponse = await router.route(
      createRequest("actor.item.create", {
        actorId: "actor-1",
        data: {
          name: "Enchanted Blade",
          type: "weapon",
          img: "worlds/world-1/art/my sword (v2).png",
          effects: [{ name: "Glow", img: "worlds/world-1/art/glow #1.png" }]
        }
      })
    );
    expect(createResponse.ok, JSON.stringify(createResponse.error)).toBe(true);

    const itemCall = actor.createEmbeddedDocuments.mock.calls.find(([type]) => type === "Item");
    const created = itemCall[1][0];

    expect(created.img).toBe("worlds/world-1/art/my%20sword%20(v2).png");

    expect(created.effects[0].img).toBe("worlds/world-1/art/glow%20%231.png");

    await router.route(
      createRequest("actor.item.update", {
        actorId: "actor-1",
        itemId: "actor-item-1",
        patch: { img: "worlds/world-1/art/shield x.png" }
      })
    );
    const updateCall = actor.updateEmbeddedDocuments.mock.calls.find(([type]) => type === "Item");
    expect(updateCall[1][0]).toMatchObject({ _id: "actor-item-1", img: "worlds/world-1/art/shield%20x.png" });
  });

  it("updates an actor embedded item flags, including a nested -=key deletion patch", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const actor = globalThis.game.actors.get("actor-1");
    const response = await router.route(
      createRequest("actor.item.update", {
        actorId: "actor-1",
        itemId: "actor-item-1",
        patch: { flags: { dae: { "-=transfer": null } } }
      })
    );

    expect(response.ok, JSON.stringify(response.error)).toBe(true);

    const updateCall = actor.updateEmbeddedDocuments.mock.calls.find(([type]) => type === "Item");
    expect(updateCall).toBeDefined();
    const [, entries] = updateCall;
    expect(entries[0]).toMatchObject({ _id: "actor-item-1", flags: { dae: { "-=transfer": null } } });
  });

  it("creates a token embedded item with flags/effects without mutating the world actor", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const worldActor = globalThis.game.actors.get("actor-1");
    const deltaActor = globalThis.game.scenes.get("scene-1").tokens.get("token-a").actor;

    const createResponse = await router.route(
      createRequest("scene.token.item.create", {
        sceneId: "scene-1",
        tokenId: "token-a",
        data: {
          name: "Poisoned Dagger",
          type: "weapon",
          flags: { "midi-qol": { x: 1 } },
          effects: [{ name: "Poison", transfer: true, origin: "Item.def", _stats: { hacked: true } }]
        }
      })
    );

    expect(createResponse.ok, JSON.stringify(createResponse.error)).toBe(true);
    expect(createResponse.result.mutatesWorldActor).toBe(false);

    const deltaCall = deltaActor.createEmbeddedDocuments.mock.calls.find(([type]) => type === "Item");
    expect(deltaCall).toBeDefined();
    const created = deltaCall[1][0];
    expect(created.flags).toEqual({ "midi-qol": { x: 1 } });
    expect(created.effects[0]).not.toHaveProperty("_stats");
    expect(created.effects[0].origin).toBe("Item.def");

    const worldItemNames = Array.from(worldActor.items).map((it) => it.name);
    expect(worldItemNames).not.toContain("Poisoned Dagger");
  });

  it("returns actor-not-found for actor embedded item commands", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(createRequest("actor.item.list", { actorId: "missing-actor" }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("ACTOR_NOT_FOUND");
  });

  it("returns item-not-found when updating a missing actor embedded item", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(
      createRequest("actor.item.update", {
        actorId: "actor-1",
        itemId: "missing-actor-item",
        patch: { name: "Nope" }
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("ITEM_NOT_FOUND");
  });

  it("creates world items via Foundry document APIs", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(
      createRequest("item.create", {
        data: {
          name: "Torch",
          type: "loot",
          system: {
            quantity: 1
          }
        }
      })
    );

    expect(response.ok).toBe(true);
    expect(globalThis.Item.create).toHaveBeenCalledWith(
      {
        name: "Torch",
        type: "loot",
        system: {
          quantity: 1
        }
      },
      { render: true }
    );
    expect(response.result.item.id).toBe("item-created");

    expect(response.result.item._id).toBe("item-created");
  });

  it("prefers collection.documentClass over the deprecated global on create", async () => {
    const preferredCreate = vi.fn(async (data) => createDocument("item-preferred", data));
    globalThis.game.items.documentClass = { create: preferredCreate };
    const deprecatedGlobalCreate = vi.fn(async (data) => createDocument("item-from-global", data));
    globalThis.Item = { create: deprecatedGlobalCreate };

    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("item.create", { data: { name: "Rope", type: "loot" } })
    );

    expect(response.ok).toBe(true);
    expect(response.result.item.id).toBe("item-preferred");
    expect(preferredCreate).toHaveBeenCalledTimes(1);
    expect(deprecatedGlobalCreate).not.toHaveBeenCalled();
  });

  it("falls back to the deprecated global when collection.documentClass is absent", async () => {
    globalThis.game.items.documentClass = undefined;
    const fallbackCreate = vi.fn(async (data) => createDocument("item-fallback", data));
    globalThis.Item = { create: fallbackCreate };

    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("item.create", { data: { name: "Torch", type: "loot" } })
    );

    expect(response.ok).toBe(true);
    expect(response.result.item.id).toBe("item-fallback");
    expect(fallbackCreate).toHaveBeenCalledTimes(1);
  });

  it("clones and deletes world items", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const cloneResponse = await router.route(
      createRequest("item.clone", { itemId: "item-1", patch: { name: "Item Copy" } })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.item.id).toBe("item-1-clone");

    expect(cloneResponse.result.item._id).toBe("item-1-clone");
    expect(cloneResponse.result.item.name).toBe("Item Copy");

    const deleteResponse = await router.route(createRequest("item.delete", { itemId: "item-1" }));
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: "item-1", deleted: true });
  });

  it("lists, gets, creates, updates, and clones actors", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const listResponse = await router.route(createRequest("actor.list"));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.actors.find((actor) => actor.id === "actor-1")).toMatchObject({
      name: "Valeros",
      itemCount: 1
    });

    const getResponse = await router.route(createRequest("actor.get", { actorId: "actor-1" }));
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.actor.items).toHaveLength(1);

    expect(getResponse.result.actor.items[0].system).toEqual({ armor: 2 });

    const createResponse = await router.route(
      createRequest("actor.create", { data: { name: "Goblin", type: "npc" } })
    );
    expect(createResponse.ok).toBe(true);
    expect(globalThis.Actor.create).toHaveBeenCalledWith({ name: "Goblin", type: "npc" }, { render: true });
    expect(createResponse.result.actor.id).toBe("actor-created");

    const updateResponse = await router.route(
      createRequest("actor.update", { actorId: "actor-1", patch: { name: "Valeros the Bold" } })
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.actor.name).toBe("Valeros the Bold");

    const cloneResponse = await router.route(
      createRequest("actor.clone", { actorId: "actor-1", patch: { name: "Valeros Copy" } })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.actor.id).toBe("actor-1-clone");
    expect(cloneResponse.result.actor.name).toBe("Valeros Copy");
  });

  it("guards actor.delete when the actor is referenced by tokens", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const guarded = await router.route(createRequest("actor.delete", { actorId: "actor-1" }));
    expect(guarded.ok).toBe(false);
    expect(guarded.error.code).toBe("DELETE_FORBIDDEN");
    expect(guarded.error.details.tokenReferences).toEqual(
      expect.arrayContaining([
        { sceneId: "scene-1", tokenId: "token-a" },
        { sceneId: "scene-1", tokenId: "token-linked" },
        { sceneId: "scene-2", tokenId: "token-1" }
      ])
    );
    expect(guarded.error.details.tokenReferences).toHaveLength(3);

    const forced = await router.route(createRequest("actor.delete", { actorId: "actor-1", force: true }));
    expect(forced.ok).toBe(true);
    expect(forced.result).toMatchObject({ id: "actor-1", deleted: true });
  });

  it("clones an item on an unlinked token's delta actor without touching the world actor", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const cloneResponse = await router.route(
      createRequest("scene.token.item.clone", {
        sceneId: "scene-1",
        tokenId: "token-a",
        itemId: "delta-item-1",
        patch: { name: "Dagger Copy" }
      })
    );
    expect(cloneResponse.ok, JSON.stringify(cloneResponse.error)).toBe(true);
    expect(cloneResponse.result).toMatchObject({
      sceneId: "scene-1",
      tokenId: "token-a",
      actorLink: false,
      mutatesWorldActor: false
    });
    expect(cloneResponse.result.item.name).toBe("Dagger Copy");
    expect(cloneResponse.result.item.id).not.toBe("delta-item-1");

    const worldItems = await router.route(createRequest("actor.item.list", { actorId: "actor-1" }));
    expect(worldItems.result.items.map((i) => i.id)).not.toContain(cloneResponse.result.item.id);

    const dryRun = await router.route(
      createRequest("scene.token.item.clone", {
        sceneId: "scene-1",
        tokenId: "token-a",
        itemId: "delta-item-1",
        patch: { name: "Preview" },
        dryRun: true
      })
    );
    expect(dryRun.ok, JSON.stringify(dryRun.error)).toBe(true);
    expect(dryRun.result).toMatchObject({ dryRun: true, mutatesWorldActor: false });
    expect(dryRun.result.item.name).toBe("Preview");

    const missing = await router.route(
      createRequest("scene.token.item.clone", {
        sceneId: "scene-1",
        tokenId: "token-a",
        itemId: "ghost-item"
      })
    );
    expect(missing.ok).toBe(false);
    expect(missing.error.code).toBe("ITEM_NOT_FOUND");
    expect(missing.error.message).toContain("ghost-item");
  });

  it("deletes an unreferenced actor without force", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    await router.route(createRequest("actor.create", { data: { name: "Rat", type: "npc" } }));
    const response = await router.route(createRequest("actor.delete", { actorId: "actor-created" }));

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({ id: "actor-created", deleted: true });
    expect(response.result.tokenReferences).toEqual([]);
  });

  it("actor.delete dry-run response shape matches the real response (tokenReferences present)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    await router.route(createRequest("actor.create", { data: { name: "Rat", type: "npc" } }));
    const actor = globalThis.game.actors.get("actor-created");

    const response = await router.route(
      createRequest("actor.delete", { actorId: "actor-created", dryRun: true })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      id: "actor-created",
      deleted: false,
      dryRun: true,
      tokenReferences: []
    });
    expect(actor.delete).not.toHaveBeenCalled();
  });

  it("gets, clones, and deletes actor embedded items", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const getResponse = await router.route(
      createRequest("actor.item.get", { actorId: "actor-1", itemId: "actor-item-1" })
    );
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.item.name).toBe("Shield");

    const cloneResponse = await router.route(
      createRequest("actor.item.clone", {
        actorId: "actor-1",
        itemId: "actor-item-1",
        patch: { name: "Shield Copy" }
      })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.item.id).toBe("actor-item-1-clone");
    expect(cloneResponse.result.item.name).toBe("Shield Copy");

    const deleteResponse = await router.route(
      createRequest("actor.item.delete", { actorId: "actor-1", itemId: "actor-item-1" })
    );
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ actorId: "actor-1", id: "actor-item-1", deleted: true });
  });

  it("returns ITEM_NOT_FOUND when deleting a missing actor embedded item", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("actor.item.delete", { actorId: "actor-1", itemId: "missing" })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("ITEM_NOT_FOUND");
  });

  describe("complete-get: single-doc reads always carry own flags + effects", () => {
    it("item.get ALWAYS returns flags + effects (no --include needed)", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const get = await router.route(createRequest("item.get", { itemId: "item-1" }));
      expect(get.ok).toBe(true);
      expect(get.result.item.flags).toEqual({ dae: { macro: "burning" } });
      expect(Array.isArray(get.result.item.effects)).toBe(true);
    });

    it("actor.get ALWAYS returns the actor's own flags + effects; nested items stay lean with effectCount", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const get = await router.route(createRequest("actor.get", { actorId: "actor-1" }));
      expect(get.ok).toBe(true);
      expect(get.result.actor.flags).toEqual({ ActiveAuras: { radius: 10 } });
      expect(Array.isArray(get.result.actor.effects)).toBe(true);

      expect(get.result.actor.items).toHaveLength(1);
      expect("flags" in get.result.actor.items[0]).toBe(false);
      expect("effects" in get.result.actor.items[0]).toBe(false);
      expect(typeof get.result.actor.items[0].effectCount).toBe("number");

      const withNested = await router.route(
        createRequest("actor.get", { actorId: "actor-1", include: ["items.flags"] })
      );
      expect("flags" in withNested.result.actor.items[0]).toBe(true);
    });

    it("actor.item.get ALWAYS returns flags + effects (the no-effects false negative)", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const get = await router.route(
        createRequest("actor.item.get", { actorId: "actor-1", itemId: "actor-item-1" })
      );
      expect(get.ok).toBe(true);
      expect(get.result.item.flags).toEqual({ dae: { transfer: true } });
      expect(Array.isArray(get.result.item.effects)).toBe(true);
    });

    it("actor.item.list rows carry effectCount always + only the requested include bodies (flags/effects), summaries otherwise", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const defaultList = await router.route(createRequest("actor.item.list", { actorId: "actor-1" }));
      expect(defaultList.ok).toBe(true);
      const defaultRow = defaultList.result.items.find((item) => item.id === "actor-item-1");
      expect("flags" in defaultRow).toBe(false);
      expect("effects" in defaultRow).toBe(false);

      expect(typeof defaultRow.effectCount).toBe("number");
      expect("system" in defaultRow).toBe(false);

      const withFlags = await router.route(
        createRequest("actor.item.list", { actorId: "actor-1", include: ["flags"] })
      );
      const flagsRow = withFlags.result.items.find((item) => item.id === "actor-item-1");
      expect(flagsRow.flags).toEqual({ dae: { transfer: true } });
      expect("effects" in flagsRow).toBe(false);
      expect("system" in flagsRow).toBe(false);

      const withEffects = await router.route(
        createRequest("actor.item.list", { actorId: "actor-1", include: ["effects"] })
      );
      const effectsRow = withEffects.result.items.find((item) => item.id === "actor-item-1");
      expect(Array.isArray(effectsRow.effects)).toBe(true);
      expect("flags" in effectsRow).toBe(false);
      expect("system" in effectsRow).toBe(false);
    });
  });

  describe("include opt-in on world item/actor create+update", () => {
    const connectedRouter = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    it("item.update dry-run: merged item ALWAYS carries flags + effects (no preview field)", async () => {
      const router = connectedRouter();

      const res = await router.route(
        createRequest("item.update", { itemId: "item-1", patch: { name: "Renamed" }, dryRun: true })
      );
      expect(res.ok).toBe(true);
      expect(res.result.item.name).toBe("Renamed");
      expect(res.result.item.flags).toEqual({ dae: { macro: "burning" } });
      expect(Array.isArray(res.result.item.effects)).toBe(true);
      expect(res.result).not.toHaveProperty("preview");
    });

    it("item.update REAL: returned item ALWAYS carries flags + effects", async () => {
      const router = connectedRouter();

      const res = await router.route(
        createRequest("item.update", { itemId: "item-1", patch: { name: "Renamed A" } })
      );
      expect(res.ok).toBe(true);
      expect(res.result.item.flags).toEqual({ dae: { macro: "burning" } });
      expect(Array.isArray(res.result.item.effects)).toBe(true);
    });

    it("item.create dry-run: preview ALWAYS carries flags + effects from the would-be doc", async () => {
      const router = connectedRouter();
      const flags = { ddbimporter: { id: 42 } };

      const res = await router.route(
        createRequest("item.create", {
          data: { name: "Torch", type: "loot", flags },
          dryRun: true
        })
      );
      expect(res.ok, JSON.stringify(res.error)).toBe(true);
      expect(res.result.item.flags).toEqual(flags);
      expect(Array.isArray(res.result.item.effects)).toBe(true);
      expect(res.result).not.toHaveProperty("preview");
    });

    it("actor.update dry-run + REAL: actor ALWAYS carries own flags + effects", async () => {
      const router = connectedRouter();

      const dry = await router.route(
        createRequest("actor.update", { actorId: "actor-1", patch: { name: "Valeros II" }, dryRun: true })
      );
      expect(dry.ok).toBe(true);
      expect(dry.result.actor.name).toBe("Valeros II");
      expect(dry.result.actor.flags).toEqual({ ActiveAuras: { radius: 10 } });
      expect(Array.isArray(dry.result.actor.effects)).toBe(true);
      expect(dry.result).not.toHaveProperty("preview");

      const real = await router.route(
        createRequest("actor.update", { actorId: "actor-1", patch: { name: "Valeros III" } })
      );
      expect(real.ok).toBe(true);
      expect(real.result.actor.flags).toEqual({ ActiveAuras: { radius: 10 } });
      expect(Array.isArray(real.result.actor.effects)).toBe(true);
    });

    it("actor.create dry-run: preview ALWAYS carries flags + effects from the would-be doc", async () => {
      const router = connectedRouter();
      const flags = { ActiveAuras: { radius: 20 } };

      const res = await router.route(
        createRequest("actor.create", {
          data: { name: "Goblin", type: "npc", flags },
          dryRun: true
        })
      );
      expect(res.ok, JSON.stringify(res.error)).toBe(true);
      expect(res.result.actor.flags).toEqual(flags);
      expect(Array.isArray(res.result.actor.effects)).toBe(true);
      expect(res.result).not.toHaveProperty("preview");
    });
  });

  describe("include opt-in on embedded item create+update", () => {
    const connectedRouter = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    it("actor.item.update dry-run: merged item ALWAYS carries flags + effects (no preview field)", async () => {
      const router = connectedRouter();

      const res = await router.route(
        createRequest("actor.item.update", {
          actorId: "actor-1",
          itemId: "actor-item-1",
          patch: { name: "Renamed" },
          dryRun: true
        })
      );
      expect(res.ok, JSON.stringify(res.error)).toBe(true);
      expect(res.result.item.name).toBe("Renamed");
      expect(res.result.item.flags).toEqual({ dae: { transfer: true } });
      expect(Array.isArray(res.result.item.effects)).toBe(true);
      expect(res.result).not.toHaveProperty("preview");
    });

    it("actor.item.create REAL: returned item ALWAYS carries effects (the created effects are visible)", async () => {
      const router = connectedRouter();
      const data = {
        name: "Flaming Sword",
        type: "weapon",
        effects: [{ name: "Ablaze", transfer: true, origin: "Item.src" }]
      };

      const res = await router.route(createRequest("actor.item.create", { actorId: "actor-1", data }));
      expect(res.ok, JSON.stringify(res.error)).toBe(true);
      expect(Array.isArray(res.result.item.effects)).toBe(true);
      expect(res.result.item.effects[0].name).toBe("Ablaze");

      expect(res.result.item.flags).toEqual({});
    });

    it("scene.token.item.create dry-run: merged item ALWAYS carries flags + effects", async () => {
      const router = connectedRouter();
      const flags = { "midi-qol": { x: 7 } };
      const data = { name: "Hexed Dagger", type: "weapon", flags };

      const res = await router.route(
        createRequest("scene.token.item.create", {
          sceneId: "scene-1",
          tokenId: "token-a",
          data,
          dryRun: true
        })
      );
      expect(res.ok, JSON.stringify(res.error)).toBe(true);
      expect(res.result.item.flags).toEqual(flags);
      expect(Array.isArray(res.result.item.effects)).toBe(true);
      expect(res.result).not.toHaveProperty("preview");
    });
  });

  describe("active effects", () => {
    const FAMILIES = [
      {
        label: "actor",
        base: { actorId: "actor-1" },
        getParent: () => globalThis.game.actors.get("actor-1"),

        expectedTransfer: false,
        listCommand: "actor.effect.list",
        getCommand: "actor.effect.get",
        createCommand: "actor.effect.create",
        updateCommand: "actor.effect.update",
        cloneCommand: "actor.effect.clone",
        deleteCommand: "actor.effect.delete"
      },
      {
        label: "world item",
        base: { itemId: "item-1" },
        getParent: () => globalThis.game.items.get("item-1"),

        expectedTransfer: true,
        listCommand: "item.effect.list",
        getCommand: "item.effect.get",
        createCommand: "item.effect.create",
        updateCommand: "item.effect.update",
        cloneCommand: "item.effect.clone",
        deleteCommand: "item.effect.delete"
      },
      {
        label: "actor-embedded item",
        base: { actorId: "actor-1", itemId: "actor-item-1" },
        getParent: () => globalThis.game.actors.get("actor-1").items.get("actor-item-1"),
        expectedTransfer: true,
        listCommand: "actor.item.effect.list",
        getCommand: "actor.item.effect.get",
        createCommand: "actor.item.effect.create",
        updateCommand: "actor.item.effect.update",
        cloneCommand: "actor.item.effect.clone",
        deleteCommand: "actor.item.effect.delete"
      }
    ];

    it.each(FAMILIES)("round-trips CRUD for the $label parent", async (family) => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const createResponse = await router.route(
        createRequest(family.createCommand, {
          ...family.base,
          data: {
            name: "Aura",
            type: "auraeffects.aura",
            transfer: true,
            origin: "Item.def",
            changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "2" }],
            system: { radius: 5 }
          }
        })
      );
      expect(createResponse.ok, JSON.stringify(createResponse.error)).toBe(true);
      const effectId = createResponse.result.effect.id;
      expect(createResponse.result.effect.name).toBe("Aura");

      const listResponse = await router.route(createRequest(family.listCommand, { ...family.base }));
      expect(listResponse.ok).toBe(true);
      const summary = listResponse.result.effects.find((e) => e.id === effectId);
      expect(summary).toMatchObject({ name: "Aura", transfer: family.expectedTransfer });

      expect(summary).not.toHaveProperty("changes");
      expect(summary).not.toHaveProperty("system");

      const getResponse = await router.route(createRequest(family.getCommand, { ...family.base, effectId }));
      expect(getResponse.ok).toBe(true);
      expect(getResponse.result.effect).toMatchObject({
        name: "Aura",
        transfer: family.expectedTransfer,
        origin: "Item.def",
        changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "2" }],
        system: { radius: 5 }
      });

      const updateResponse = await router.route(
        createRequest(family.updateCommand, { ...family.base, effectId, patch: { disabled: true } })
      );
      expect(updateResponse.ok).toBe(true);
      expect(updateResponse.result.effect.disabled).toBe(true);

      const cloneResponse = await router.route(
        createRequest(family.cloneCommand, { ...family.base, effectId, patch: { name: "Aura 10ft" } })
      );
      expect(cloneResponse.ok).toBe(true);
      expect(cloneResponse.result.effect.name).toBe("Aura 10ft");
      expect(cloneResponse.result.effect.id).not.toBe(effectId);

      const deleteResponse = await router.route(
        createRequest(family.deleteCommand, { ...family.base, effectId })
      );
      expect(deleteResponse.ok).toBe(true);
      expect(deleteResponse.result).toMatchObject({ id: effectId, deleted: true });
    });

    it.each(FAMILIES)(
      "dryRun skips the persist call for create/update/delete on the $label parent",
      async (family) => {
        const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

        const parent = family.getParent();
        parent.effects.set(createDocument("dry-effect", { name: "Seeded", disabled: false }));

        const createResponse = await router.route(
          createRequest(family.createCommand, { ...family.base, data: { name: "Preview" }, dryRun: true })
        );
        expect(createResponse.ok, JSON.stringify(createResponse.error)).toBe(true);
        expect(createResponse.result.dryRun).toBe(true);
        expect(parent.createEmbeddedDocuments).not.toHaveBeenCalled();

        const updateResponse = await router.route(
          createRequest(family.updateCommand, {
            ...family.base,
            effectId: "dry-effect",
            patch: { disabled: true },
            dryRun: true
          })
        );
        expect(updateResponse.ok).toBe(true);
        expect(updateResponse.result.dryRun).toBe(true);
        expect(parent.updateEmbeddedDocuments).not.toHaveBeenCalled();

        const deleteResponse = await router.route(
          createRequest(family.deleteCommand, { ...family.base, effectId: "dry-effect", dryRun: true })
        );
        expect(deleteResponse.ok).toBe(true);
        expect(deleteResponse.result.dryRun).toBe(true);
        expect(deleteResponse.result.deleted).toBe(false);
        expect(parent.deleteEmbeddedDocuments).not.toHaveBeenCalled();
      }
    );

    it.each(FAMILIES)(
      "returns EFFECT_NOT_FOUND for a missing effect on the $label parent",
      async (family) => {
        const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

        const response = await router.route(
          createRequest(family.getCommand, { ...family.base, effectId: "missing" })
        );

        expect(response.ok).toBe(false);
        expect(response.error.code).toBe("EFFECT_NOT_FOUND");
      }
    );

    it("strips _id/_stats/ownership from a create/update payload while preserving origin", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const actor = globalThis.game.actors.get("actor-1");
      const createResponse = await router.route(
        createRequest("actor.effect.create", {
          actorId: "actor-1",
          data: {
            name: "Sanitized",
            _id: "bogus",
            _stats: { hacked: true },
            ownership: { default: 3 },
            origin: "Item.keepme"
          }
        })
      );
      expect(createResponse.ok).toBe(true);

      const [, createdEntries] = actor.createEmbeddedDocuments.mock.calls.at(-1);
      expect(createdEntries[0]).not.toHaveProperty("_id");
      expect(createdEntries[0]).not.toHaveProperty("_stats");
      expect(createdEntries[0]).not.toHaveProperty("ownership");
      expect(createdEntries[0].origin).toBe("Item.keepme");
      const effectId = createResponse.result.effect.id;

      await router.route(
        createRequest("actor.effect.update", {
          actorId: "actor-1",
          effectId,
          patch: {
            _id: "spoofed",
            _stats: { hacked: true },
            ownership: { default: 3 },
            origin: "Item.updated"
          }
        })
      );
      const [, updatedEntries] = actor.updateEmbeddedDocuments.mock.calls.at(-1);

      expect(updatedEntries[0]._id).toBe(effectId);
      expect(updatedEntries[0]).not.toHaveProperty("_stats");
      expect(updatedEntries[0]).not.toHaveProperty("ownership");
      expect(updatedEntries[0].origin).toBe("Item.updated");
    });

    it("reports provenance (parentType/parentId/sourceName/active) for actor.effect.applied", async () => {
      const appliedActor = createActorDocument("actor-applied", { name: "Buffed" });
      const transferred = createDocument("applied-eff-1", { name: "Bless", disabled: false, transfer: true });
      transferred.active = true;
      transferred.sourceName = "Bless (Cleric)";
      transferred.parent = { documentName: "Actor", id: "actor-applied" };
      appliedActor.allApplicableEffects = () => [transferred];
      globalThis.game.actors.set(appliedActor);

      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("actor.effect.applied", { actorId: "actor-applied" })
      );

      expect(response.ok).toBe(true);
      expect(response.result.effects[0]).toMatchObject({
        name: "Bless",
        active: true,
        parentType: "Actor",
        parentId: "actor-applied",
        sourceName: "Bless (Cleric)"
      });
    });

    it("reads placed-token effects via scene.token.effect.list and applied", async () => {
      const deltaActor = globalThis.game.scenes.get("scene-1").tokens.get("token-a").actor;
      deltaActor.effects.set(
        createDocument("token-eff-1", { name: "Marked", disabled: false, transfer: false })
      );
      const unionEffect = createDocument("token-eff-applied", { name: "Hasted", disabled: false });
      unionEffect.active = true;
      unionEffect.parent = { documentName: "Actor", id: deltaActor.id };
      deltaActor.allApplicableEffects = () => [unionEffect];

      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const listResponse = await router.route(
        createRequest("scene.token.effect.list", { sceneId: "scene-1", tokenId: "token-a" })
      );
      expect(listResponse.ok).toBe(true);
      expect(listResponse.result).toMatchObject({ sceneId: "scene-1", tokenId: "token-a", actorLink: false });
      expect(listResponse.result.effects.find((e) => e.id === "token-eff-1")).toMatchObject({
        name: "Marked"
      });

      const appliedResponse = await router.route(
        createRequest("scene.token.effect.applied", { sceneId: "scene-1", tokenId: "token-a" })
      );
      expect(appliedResponse.ok).toBe(true);
      expect(appliedResponse.result.effects[0]).toMatchObject({ name: "Hasted", active: true });
    });

    it("writes effects to an unlinked token's delta actor without touching the world actor", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const createResponse = await router.route(
        createRequest("scene.token.effect.create", {
          sceneId: "scene-1",
          tokenId: "token-a",
          data: { name: "Token Buff", disabled: false, changes: [{ key: "system.x", mode: 2, value: "1" }] }
        })
      );
      expect(createResponse.ok, JSON.stringify(createResponse.error)).toBe(true);
      expect(createResponse.result.actorLink).toBe(false);
      expect(createResponse.result.mutatesWorldActor).toBe(false);
      expect(createResponse.result.effect.name).toBe("Token Buff");
      const effectId = createResponse.result.effect.id;

      const getResponse = await router.route(
        createRequest("scene.token.effect.get", { sceneId: "scene-1", tokenId: "token-a", effectId })
      );
      expect(getResponse.ok).toBe(true);
      expect(getResponse.result.effect.name).toBe("Token Buff");

      const worldEffects = await router.route(createRequest("actor.effect.list", { actorId: "actor-1" }));
      expect(worldEffects.result.effects.map((e) => e.id)).not.toContain(effectId);

      const updateResponse = await router.route(
        createRequest("scene.token.effect.update", {
          sceneId: "scene-1",
          tokenId: "token-a",
          effectId,
          patch: { disabled: true }
        })
      );
      expect(updateResponse.ok).toBe(true);
      expect(updateResponse.result.mutatesWorldActor).toBe(false);
      expect(updateResponse.result.effect.disabled).toBe(true);

      const cloneResponse = await router.route(
        createRequest("scene.token.effect.clone", {
          sceneId: "scene-1",
          tokenId: "token-a",
          effectId,
          patch: { name: "Token Buff 2" }
        })
      );
      expect(cloneResponse.ok).toBe(true);
      expect(cloneResponse.result.mutatesWorldActor).toBe(false);
      expect(cloneResponse.result.effect.name).toBe("Token Buff 2");
      expect(cloneResponse.result.effect.id).not.toBe(effectId);

      const deleteResponse = await router.route(
        createRequest("scene.token.effect.delete", { sceneId: "scene-1", tokenId: "token-a", effectId })
      );
      expect(deleteResponse.ok).toBe(true);
      expect(deleteResponse.result).toMatchObject({ id: effectId, deleted: true, mutatesWorldActor: false });

      const missing = await router.route(
        createRequest("scene.token.effect.get", { sceneId: "scene-1", tokenId: "token-a", effectId })
      );
      expect(missing.ok).toBe(false);
      expect(missing.error.code).toBe("EFFECT_NOT_FOUND");
    });

    it("flags mutatesWorldActor when writing effects to a linked token", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const createResponse = await router.route(
        createRequest("scene.token.effect.create", {
          sceneId: "scene-1",
          tokenId: "token-linked",
          data: { name: "Shared Aura", transfer: false }
        })
      );
      expect(createResponse.ok, JSON.stringify(createResponse.error)).toBe(true);
      expect(createResponse.result.actorLink).toBe(true);
      expect(createResponse.result.mutatesWorldActor).toBe(true);

      const worldEffects = await router.route(createRequest("actor.effect.list", { actorId: "actor-1" }));
      expect(worldEffects.result.effects.map((e) => e.name)).toContain("Shared Aura");
    });

    it("coerces transfer:false on scene.token.effect.create (actor parent) — persisted and dryRun", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const persisted = await router.route(
        createRequest("scene.token.effect.create", {
          sceneId: "scene-1",
          tokenId: "token-a",
          data: { name: "Wannabe Aura", transfer: true }
        })
      );
      expect(persisted.ok, JSON.stringify(persisted.error)).toBe(true);
      expect(persisted.result.effect.transfer).toBe(false);

      const deltaActor = globalThis.game.scenes.get("scene-1").tokens.get("token-a").actor;
      const [, createdEntries] = deltaActor.createEmbeddedDocuments.mock.calls.at(-1);
      expect(createdEntries[0].transfer).toBe(false);

      const preview = await router.route(
        createRequest("scene.token.effect.create", {
          sceneId: "scene-1",
          tokenId: "token-a",
          data: { name: "Preview Aura", transfer: true },
          dryRun: true
        })
      );
      expect(preview.ok, JSON.stringify(preview.error)).toBe(true);
      expect(preview.result.dryRun).toBe(true);

      expect(preview.result.effect.transfer).toBe(false);
      expect(preview.result.effect.id).toBeNull();
      expect(preview.result).not.toHaveProperty("preview");
    });

    it("coerces transfer:false on actor.effect.create/update/clone (actor parent)", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const createResponse = await router.route(
        createRequest("actor.effect.create", {
          actorId: "actor-1",
          data: { name: "Actor Aura", transfer: true }
        })
      );
      expect(createResponse.ok, JSON.stringify(createResponse.error)).toBe(true);
      expect(createResponse.result.effect.transfer).toBe(false);
      const effectId = createResponse.result.effect.id;

      const updateResponse = await router.route(
        createRequest("actor.effect.update", { actorId: "actor-1", effectId, patch: { transfer: true } })
      );
      expect(updateResponse.ok, JSON.stringify(updateResponse.error)).toBe(true);
      expect(updateResponse.result.effect.transfer).toBe(false);

      const cloneResponse = await router.route(
        createRequest("actor.effect.clone", { actorId: "actor-1", effectId, patch: { transfer: true } })
      );
      expect(cloneResponse.ok, JSON.stringify(cloneResponse.error)).toBe(true);
      expect(cloneResponse.result.effect.transfer).toBe(false);
    });

    it("drops an operator-spelled `transfer` on an ACTOR parent and keeps it on an ITEM parent", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const actor = globalThis.game.actors.get("actor-1");
      actor.effects.set(createDocument("operator-transfer-eff", { name: "Legacy", transfer: true }));

      for (const patch of [{ "==transfer": true }, { "-=transfer": null }]) {
        actor.updateEmbeddedDocuments.mockClear();
        const response = await router.route(
          createRequest("actor.effect.update", {
            actorId: "actor-1",
            effectId: "operator-transfer-eff",
            patch: { ...patch }
          })
        );
        expect(response.ok, `${JSON.stringify(patch)}: ${JSON.stringify(response.error)}`).toBe(true);
        const call = actor.updateEmbeddedDocuments.mock.calls.find(([type]) => type === "ActiveEffect");
        expect(call, `${JSON.stringify(patch)} must reach Foundry`).toBeDefined();
        const [, entries] = call;

        expect(Object.keys(entries[0]).filter((key) => key.replace(/^(?:==|-=)/, "") === "transfer")).toEqual(
          ["transfer"]
        );
        expect(entries[0].transfer).toBe(false);
        expect(response.result.effect.transfer).toBe(false);
      }

      const item = globalThis.game.items.get("item-1");
      item.effects.set(createDocument("item-operator-eff", { name: "Item Aura", transfer: false }));
      item.updateEmbeddedDocuments.mockClear();
      const itemResponse = await router.route(
        createRequest("item.effect.update", {
          itemId: "item-1",
          effectId: "item-operator-eff",
          patch: { "==transfer": true }
        })
      );
      expect(itemResponse.ok, JSON.stringify(itemResponse.error)).toBe(true);
      const itemCall = item.updateEmbeddedDocuments.mock.calls.find(([type]) => type === "ActiveEffect");
      expect(itemCall).toBeDefined();
      expect(itemCall[1][0]).toHaveProperty("==transfer", true);
      expect(itemCall[1][0]).not.toHaveProperty("transfer");
    });

    it("canonicalizes a literal ActiveEffect img on create/update and passes an https:// value through", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const createResponse = await router.route(
        createRequest("actor.effect.create", {
          actorId: "actor-1",
          data: { name: "Blessed", img: "worlds/world-1/icons/holy light (1).png" }
        })
      );
      expect(createResponse.ok, JSON.stringify(createResponse.error)).toBe(true);
      expect(createResponse.result.effect.img).toBe("worlds/world-1/icons/holy%20light%20(1).png");
      const effectId = createResponse.result.effect.id;

      const updateResponse = await router.route(
        createRequest("actor.effect.update", {
          actorId: "actor-1",
          effectId,
          patch: { img: "worlds/world-1/icons/curse #2.png" }
        })
      );
      expect(updateResponse.ok, JSON.stringify(updateResponse.error)).toBe(true);
      expect(updateResponse.result.effect.img).toBe("worlds/world-1/icons/curse%20%232.png");

      const remoteResponse = await router.route(
        createRequest("actor.effect.update", {
          actorId: "actor-1",
          effectId,
          patch: { img: "https://cdn.example.com/x y.png" }
        })
      );
      expect(remoteResponse.ok, JSON.stringify(remoteResponse.error)).toBe(true);
      expect(remoteResponse.result.effect.img).toBe("https://cdn.example.com/x y.png");
    });

    it("actor.effect.clone dry-run previews the coerced transfer:false and a nulled id", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const parent = globalThis.game.actors.get("actor-1");
      parent.effects.set(createDocument("legacy-transferred", { name: "Legacy", transfer: true }));

      const preview = await router.route(
        createRequest("actor.effect.clone", {
          actorId: "actor-1",
          effectId: "legacy-transferred",
          dryRun: true
        })
      );

      expect(preview.ok, JSON.stringify(preview.error)).toBe(true);
      expect(preview.result.dryRun).toBe(true);

      expect(preview.result.effect.transfer).toBe(false);
      expect(preview.result.effect.id).toBeNull();

      expect(parent.effects.get("legacy-transferred").transfer).toBe(true);
    });

    it("actor.effect.update dry-run preview reflects the coerced transfer:false", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const parent = globalThis.game.actors.get("actor-1");
      parent.effects.set(createDocument("update-preview-effect", { name: "Aura", transfer: false }));

      const preview = await router.route(
        createRequest("actor.effect.update", {
          actorId: "actor-1",
          effectId: "update-preview-effect",
          patch: { transfer: true, disabled: true },
          dryRun: true
        })
      );

      expect(preview.ok, JSON.stringify(preview.error)).toBe(true);
      expect(preview.result.dryRun).toBe(true);
      expect(preview.result.effect.transfer).toBe(false);

      expect(preview.result.effect.disabled).toBe(true);
      expect(preview.result).not.toHaveProperty("preview");

      expect(parent.updateEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("heals a pre-existing transfer:true actor effect on update/clone even when the patch omits transfer", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const parent = globalThis.game.actors.get("actor-1");
      parent.effects.set(createDocument("legacy-transferred", { name: "Legacy", transfer: true }));

      const updateResponse = await router.route(
        createRequest("actor.effect.update", {
          actorId: "actor-1",
          effectId: "legacy-transferred",
          patch: { disabled: true }
        })
      );
      expect(updateResponse.ok, JSON.stringify(updateResponse.error)).toBe(true);
      expect(updateResponse.result.effect.transfer).toBe(false);

      const [, updatedEntries] = parent.updateEmbeddedDocuments.mock.calls.at(-1);
      expect(updatedEntries[0].transfer).toBe(false);

      parent.effects.set(createDocument("legacy-transferred-2", { name: "Legacy2", transfer: true }));
      const cloneResponse = await router.route(
        createRequest("actor.effect.clone", {
          actorId: "actor-1",
          effectId: "legacy-transferred-2",
          patch: { name: "Legacy Copy" }
        })
      );
      expect(cloneResponse.ok, JSON.stringify(cloneResponse.error)).toBe(true);
      expect(cloneResponse.result.effect.transfer).toBe(false);
    });

    it("writes effects to an item on an unlinked token without touching the world actor's item (delta isolation)", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const createResponse = await router.route(
        createRequest("scene.token.item.effect.create", {
          sceneId: "scene-1",
          tokenId: "token-a",
          itemId: "delta-item-1",
          data: { name: "Flaming", transfer: true, changes: [{ key: "system.x", mode: 2, value: "1" }] }
        })
      );
      expect(createResponse.ok, JSON.stringify(createResponse.error)).toBe(true);
      expect(createResponse.result).toMatchObject({
        sceneId: "scene-1",
        tokenId: "token-a",
        itemId: "delta-item-1",
        actorLink: false,
        mutatesWorldActor: false,
        nonDurable: true
      });

      expect(typeof createResponse.result.warning).toBe("string");
      expect(createResponse.result.warning.length).toBeGreaterThan(0);
      expect(createResponse.result.effect.name).toBe("Flaming");
      const effectId = createResponse.result.effect.id;

      const dryRunCreate = await router.route(
        createRequest("scene.token.item.effect.create", {
          sceneId: "scene-1",
          tokenId: "token-a",
          itemId: "delta-item-1",
          data: { name: "Preview Only" },
          dryRun: true
        })
      );
      expect(dryRunCreate.ok, JSON.stringify(dryRunCreate.error)).toBe(true);
      expect(dryRunCreate.result.dryRun).toBe(true);
      expect(dryRunCreate.result.nonDurable).toBe(true);
      expect(typeof dryRunCreate.result.warning).toBe("string");
      expect(dryRunCreate.result.warning.length).toBeGreaterThan(0);

      const getResponse = await router.route(
        createRequest("scene.token.item.effect.get", {
          sceneId: "scene-1",
          tokenId: "token-a",
          itemId: "delta-item-1",
          effectId
        })
      );
      expect(getResponse.ok).toBe(true);
      expect(getResponse.result.effect.name).toBe("Flaming");

      const listResponse = await router.route(
        createRequest("scene.token.item.effect.list", {
          sceneId: "scene-1",
          tokenId: "token-a",
          itemId: "delta-item-1"
        })
      );
      expect(listResponse.ok).toBe(true);
      expect(listResponse.result).toMatchObject({ itemId: "delta-item-1", actorLink: false });
      expect(listResponse.result.effects.map((e) => e.id)).toContain(effectId);

      const worldItemEffects = await router.route(
        createRequest("actor.item.effect.list", { actorId: "actor-1", itemId: "actor-item-1" })
      );
      expect(worldItemEffects.result.effects.map((e) => e.id)).not.toContain(effectId);

      const updateResponse = await router.route(
        createRequest("scene.token.item.effect.update", {
          sceneId: "scene-1",
          tokenId: "token-a",
          itemId: "delta-item-1",
          effectId,
          patch: { disabled: true }
        })
      );
      expect(updateResponse.ok).toBe(true);
      expect(updateResponse.result.mutatesWorldActor).toBe(false);
      expect(updateResponse.result.nonDurable).toBe(true);
      expect(typeof updateResponse.result.warning).toBe("string");
      expect(updateResponse.result.warning.length).toBeGreaterThan(0);
      expect(updateResponse.result.effect.disabled).toBe(true);

      const cloneResponse = await router.route(
        createRequest("scene.token.item.effect.clone", {
          sceneId: "scene-1",
          tokenId: "token-a",
          itemId: "delta-item-1",
          effectId,
          patch: { name: "Flaming 2" }
        })
      );
      expect(cloneResponse.ok).toBe(true);
      expect(cloneResponse.result.mutatesWorldActor).toBe(false);
      expect(cloneResponse.result.nonDurable).toBe(true);
      expect(typeof cloneResponse.result.warning).toBe("string");
      expect(cloneResponse.result.warning.length).toBeGreaterThan(0);
      expect(cloneResponse.result.effect.name).toBe("Flaming 2");
      expect(cloneResponse.result.effect.id).not.toBe(effectId);

      const deleteResponse = await router.route(
        createRequest("scene.token.item.effect.delete", {
          sceneId: "scene-1",
          tokenId: "token-a",
          itemId: "delta-item-1",
          effectId
        })
      );
      expect(deleteResponse.ok).toBe(true);
      expect(deleteResponse.result).toMatchObject({ id: effectId, deleted: true, mutatesWorldActor: false });

      const missing = await router.route(
        createRequest("scene.token.item.effect.get", {
          sceneId: "scene-1",
          tokenId: "token-a",
          itemId: "delta-item-1",
          effectId
        })
      );
      expect(missing.ok).toBe(false);
      expect(missing.error.code).toBe("EFFECT_NOT_FOUND");
    });

    it("flags mutatesWorldActor when writing item effects to a linked token", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

      const createResponse = await router.route(
        createRequest("scene.token.item.effect.create", {
          sceneId: "scene-1",
          tokenId: "token-linked",
          itemId: "actor-item-1",
          data: { name: "Shared Item Aura", transfer: true }
        })
      );
      expect(createResponse.ok, JSON.stringify(createResponse.error)).toBe(true);
      expect(createResponse.result.actorLink).toBe(true);
      expect(createResponse.result.mutatesWorldActor).toBe(true);

      expect(createResponse.result.nonDurable).toBe(false);
      expect(createResponse.result.warning).toBeUndefined();
      const effectId = createResponse.result.effect.id;

      const worldItemEffects = await router.route(
        createRequest("actor.item.effect.list", { actorId: "actor-1", itemId: "actor-item-1" })
      );
      expect(worldItemEffects.result.effects.map((e) => e.name)).toContain("Shared Item Aura");

      const updateResponse = await router.route(
        createRequest("scene.token.item.effect.update", {
          sceneId: "scene-1",
          tokenId: "token-linked",
          itemId: "actor-item-1",
          effectId,
          patch: { disabled: true }
        })
      );
      expect(updateResponse.ok, JSON.stringify(updateResponse.error)).toBe(true);
      expect(updateResponse.result.nonDurable).toBe(false);
      expect(updateResponse.result.warning).toBeUndefined();

      const cloneResponse = await router.route(
        createRequest("scene.token.item.effect.clone", {
          sceneId: "scene-1",
          tokenId: "token-linked",
          itemId: "actor-item-1",
          effectId,
          patch: { name: "Shared Item Aura 2" }
        })
      );
      expect(cloneResponse.ok, JSON.stringify(cloneResponse.error)).toBe(true);
      expect(cloneResponse.result.nonDurable).toBe(false);
      expect(cloneResponse.result.warning).toBeUndefined();
    });
  });
});
