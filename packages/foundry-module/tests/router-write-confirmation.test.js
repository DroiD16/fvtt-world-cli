import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";
import { ERROR_CODES, MODULE_ID, PATCH_MAX_DEPTH } from "../scripts/generated/protocol.js";
import { MODULE_SETTING_KEYS } from "../scripts/lib/validators.js";

import {
  COMBAT_GROUP_A,
  createRequest,
  installFakeFoundry,
  makeDataModelValidationError
} from "./helpers/fake-foundry.js";

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
 * @param {string} path
 */
function expectUpdateVetoError(response, path) {
  expect(response.ok).toBe(false);
  expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
  expect(response.error.message).toContain("cannot verify");
  expect(response.error.details).toMatchObject({ changedFields: [] });
  expect(response.error.details.partial).toBeUndefined();
  expect(response.error.details.paths.map((/** @type {any} */ entry) => entry.path)).toContain(path);
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

    expectUpdateVetoError(response, "name");
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

    expectUpdateVetoError(response, "name");
  });

  it("macro.update", async () => {
    vetoUpdate(globalThis.game.macros.get("macro-1"));

    const response = await send("macro.update", { macroId: "macro-1", patch: { name: "Renamed" } });

    expectUpdateVetoError(response, "name");
  });

  it("scene.update", async () => {
    vetoUpdate(globalThis.game.scenes.get("scene-2"));

    const response = await send("scene.update", { sceneId: "scene-2", patch: { name: "Renamed" } });

    expectUpdateVetoError(response, "name");
  });

  it("playlist.update", async () => {
    vetoUpdate(globalThis.game.playlists.get("playlist-1"));

    const response = await send("playlist.update", { playlistId: "playlist-1", patch: { name: "Renamed" } });

    expectUpdateVetoError(response, "name");
  });

  it("journal.update on the entry's own fields", async () => {
    vetoUpdate(globalThis.game.journal.get("journal-1"));

    const response = await send("journal.update", { journalId: "journal-1", patch: { name: "Renamed" } });

    expectUpdateVetoError(response, "name");
  });

  it("user.update", async () => {
    vetoUpdate(globalThis.game.users.get("player-1"));

    const response = await send("user.update", { userId: "player-1", patch: { color: "#ff0000" } });

    expectUpdateVetoError(response, "color");
  });

  it("journal.ownership.set", async () => {
    vetoUpdate(globalThis.game.journal.get("journal-1"));

    const response = await send("journal.ownership.set", { journalId: "journal-1", default: 2 });

    expectUpdateVetoError(response, "ownership.default");
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

    expectUpdateVetoError(response, "name");
    expect(actor.name).toBe("Valeros");
  });
});

describe("a write that landed only in part is reported as partial, not as success", () => {
  it("reports a stored leaf even when another leaf under the same root was stripped", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    actor.update = vi.fn(async () => {
      actor.applyStoredWrite({ flags: { review: { a: 1 } } });
      return actor;
    });

    const response = await send("actor.update", {
      actorId: "actor-1",
      patch: { flags: { review: { a: 1, b: 2 } } }
    });

    expect(actor.toObject().flags.review).toEqual({ a: 1 });
    expect(response.ok).toBe(false);
    expect(response.error.details).toMatchObject({
      fields: ["flags"],
      changedFields: ["flags"],
      appliedFields: [],
      partial: true
    });
  });

  it("reports a hook's replacement value as a change without crediting the requested value", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    actor.update = vi.fn(async () => actor.applyStoredWrite({ name: "Hook replacement" }));

    const response = await send("actor.update", { actorId: "actor-1", patch: { name: "Requested" } });

    expect(response.ok).toBe(false);
    expect(response.error.details).toMatchObject({
      fields: ["name"],
      changedFields: ["name"],
      appliedFields: [],
      partial: true
    });
    expect(actor.name).toBe("Hook replacement");
  });

  it.each([
    {
      command: "table.result.update",
      params: { tableId: "table-1", resultId: "result-1" },
      parent: () => globalThis.game.tables.get("table-1"),
      row: (parent) => parent.results.get("result-1")
    },
    {
      command: "cards.card.update",
      params: { cardsId: "cards-deck", cardId: "card-ace" },
      parent: () => globalThis.game.cards.get("cards-deck"),
      row: (parent) => parent.cards.get("card-ace")
    },
    {
      command: "combat.combatant.update",
      params: { combatId: "combat-1", combatantId: "combatant-1" },
      parent: () => globalThis.game.combats.get("combat-1"),
      row: (parent) => parent.combatants.get("combatant-1")
    },
    {
      command: "combat.group.update",
      params: { combatId: "combat-1", groupId: COMBAT_GROUP_A },
      parent: () => globalThis.game.combats.get("combat-1"),
      row: (parent) => parent.groups.get(COMBAT_GROUP_A)
    },
    {
      command: "journal.category.update",
      params: { journalId: "journal-categories", categoryId: "cat-chapter-one" },
      parent: () => globalThis.game.journal.get("journal-categories"),
      row: (parent) => parent.categories.get("cat-chapter-one")
    },
    {
      command: "scene.region.behavior.update",
      params: { sceneId: "scene-1", regionId: "region-safe", behaviorId: "behavior-darkness" },
      parent: () => globalThis.game.scenes.get("scene-1").regions.get("region-safe"),
      row: (parent) => parent.behaviors.get("behavior-darkness")
    }
  ])("$command checks the patch even when Foundry returns an updated document", async (fixture) => {
    const parent = fixture.parent();
    const row = fixture.row(parent);
    const name = row.toObject().name;
    const update = parent.updateEmbeddedDocuments.bind(parent);
    parent.updateEmbeddedDocuments = vi.fn(async (type, entries, options) => {
      for (const entry of entries) delete entry.name;
      return update(type, entries, options);
    });

    const response = await send(fixture.command, {
      ...fixture.params,
      patch: { name: "Requested", flags: { review: { applied: true } } }
    });

    expect(row.toObject().name).toBe(name);
    expect(row.toObject().flags.review.applied).toBe(true);
    expect(response.ok).toBe(false);
    expect(response.error.details).toMatchObject({
      fields: ["name"],
      changedFields: ["flags"],
      appliedFields: ["flags"],
      partial: true
    });
  });

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
    expect(response.error.message).toContain("cannot verify");
    expect(response.error.details).toMatchObject({
      fields: ["name"],
      paths: [{ path: "name", requested: "Renamed", stored: "Valeros" }],
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
    expect(response.error.message).toContain("cannot verify");
    expect(response.error.details).toMatchObject({
      fields: ["name"],
      paths: [{ path: "name", requested: "Renamed" }],
      appliedFields: ["alpha"]
    });
  });
});

describe("a dotted key inside an embedded-collection entry is judged in the expanded form the bridge sends", () => {
  it("lands through scene.region.update and scene.region.update-many, real and dry run, with a v13-like preview", async () => {
    const scene = globalThis.game.scenes.get("scene-1");
    const region = scene.regions.get("region-lava");
    const behavior = Array.from(region.behaviors)[0];
    const behaviorId = behavior._id ?? behavior.id;
    const regionSchema = region.constructor.schema;
    region.constructor.schema = {
      get: (root) => {
        const field = regionSchema.get(root);
        return (
          field && {
            ...field,
            schema: { get: (key) => (key === "flags" ? { clean: (value) => value } : {}) }
          }
        );
      }
    };
    const innerClone = region.clone.bind(region);
    region.clone = async (...args) => {
      const preview = await innerClone(...args);
      const innerUpdateSource = preview.updateSource.bind(preview);
      preview.updateSource = (patch = {}, options) => {
        const behaviors = Array.isArray(patch.behaviors)
          ? patch.behaviors.map((entry) =>
              Object.fromEntries(Object.entries(entry).filter(([key]) => !key.includes(".")))
            )
          : patch.behaviors;
        return innerUpdateSource(behaviors === undefined ? patch : { ...patch, behaviors }, options);
      };
      return preview;
    };
    const sent = vi.spyOn(scene, "updateEmbeddedDocuments");
    for (const [command, params] of /** @type {Array<[string, Record<string, any>]>} */ ([
      [
        "scene.region.update",
        {
          sceneId: "scene-1",
          regionId: "region-lava",
          patch: { behaviors: [{ _id: behaviorId, "flags.mod.k": 1 }] }
        }
      ],
      [
        "scene.region.update-many",
        {
          sceneId: "scene-1",
          patches: [{ id: "region-lava", patch: { behaviors: [{ _id: behaviorId, "flags.mod.j": 2 }] } }]
        }
      ]
    ])) {
      const dry = await send(command, { ...params, dryRun: true });
      expect(dry.ok, `${command} dry run: ${JSON.stringify(dry.error)}`).toBe(true);
      sent.mockClear();
      const real = await send(command, params);
      expect(real.ok, `${command}: ${JSON.stringify(real.error)}`).toBe(true);
      const regionEntry = sent.mock.calls.find((call) => call[0] === "Region")?.[1]?.[0];
      expect(Object.keys(regionEntry.behaviors[0]).every((key) => !key.includes("."))).toBe(true);
    }
    const stored = Array.from(region.behaviors).find((entry) => (entry._id ?? entry.id) === behaviorId);
    expect(stored.toObject().flags.mod).toMatchObject({ k: 1, j: 2 });
  });
});

describe("an embedded creation without a requested id needs independent confirmation", () => {
  it.each([false, true])("reports an indeterminate result when the creation lands: %s", async (lands) => {
    const scene = globalThis.game.scenes.get("scene-1");
    const region = scene.regions.get("region-lava");
    const count = region.behaviors.size;
    const update = scene.updateEmbeddedDocuments.bind(scene);
    scene.updateEmbeddedDocuments = vi.fn(async (type, entries, options) => {
      if (!lands) {
        for (const entry of entries) delete entry.behaviors;
      }
      return update(type, entries, options);
    });

    const response = await send("scene.region.update", {
      sceneId: "scene-1",
      regionId: "region-lava",
      patch: { name: "Renamed", behaviors: [{ type: "damage", system: { damage: "4d6" } }] }
    });

    expect(region.name).toBe("Renamed");
    expect(region.behaviors.size).toBe(count + Number(lands));
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(response.error.details).toMatchObject({ fields: ["behaviors"], indeterminate: true });
    expect(response.error.message).toMatch(/Re-read/);
    expect(response.error.message).not.toContain("cannot verify");
  });

  it("lists at most the path limit on an indeterminate result and counts the rest", async () => {
    const scene = globalThis.game.scenes.get("scene-1");
    const update = scene.updateEmbeddedDocuments.bind(scene);
    scene.updateEmbeddedDocuments = vi.fn(async (type, entries, options) => {
      for (const entry of entries) delete entry.flags;
      return update(type, entries, options);
    });
    const mod = Object.fromEntries(Array.from({ length: 22 }, (_unused, index) => [`k${index}`, index]));

    const response = await send("scene.region.update", {
      sceneId: "scene-1",
      regionId: "region-lava",
      patch: { flags: { mod }, behaviors: [{ type: "damage", system: { damage: "4d6" } }] }
    });

    expect(response.ok).toBe(false);
    expect(response.error.details).toMatchObject({ indeterminate: true });
    expect(response.error.details.paths).toHaveLength(20);
    expect(response.error.details.pathsTruncated).toBe(3);
  });
});

describe("a key segment naming an object internal is refused before anything reads or writes the patch", () => {
  const prototypeNames = () => Object.getOwnPropertyNames(Object.prototype).sort();

  /**
   * @param {string} command
   * @param {string} paramsJson
   * @param {string} field
   * @param {string} segment
   */
  async function expectRefused(command, paramsJson, field, segment) {
    const before = prototypeNames();
    const response = await send(command, JSON.parse(paramsJson));
    expect(response.ok, paramsJson).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.details).toMatchObject({ command, reservedSegment: segment });
    expect(response.error.details.field).toBe(field);
    expect(prototypeNames()).toEqual(before);
    expect(/** @type {any} */ ({}).isGM).toBeUndefined();
    expect(/** @type {any} */ ({}).a).toBeUndefined();
  }

  it("refuses dotted and own-key spellings at the top level and nested, on real writes and dry runs", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    const update = vi.spyOn(actor, "update");
    for (const dryRun of [false, true]) {
      await expectRefused(
        "actor.update",
        `{"actorId":"actor-1","dryRun":${dryRun},"patch":{"system":{"__proto__.a":99}}}`,
        "patch.system.__proto__.a",
        "__proto__"
      );
      await expectRefused(
        "actor.update",
        `{"actorId":"actor-1","dryRun":${dryRun},"patch":{"system":{"__proto__":{"isGM":true}}}}`,
        "patch.system.__proto__",
        "__proto__"
      );
      await expectRefused(
        "actor.update",
        `{"actorId":"actor-1","dryRun":${dryRun},"patch":{"flags":{"constructor.prototype.isGM":true}}}`,
        "patch.flags.constructor.prototype.isGM",
        "constructor"
      );
      await expectRefused(
        "actor.update",
        `{"actorId":"actor-1","dryRun":${dryRun},"patch":{"flags":{"mod":{"==prototype":{"isGM":true}}}}}`,
        "patch.flags.mod.==prototype",
        "prototype"
      );
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses them at the top level of an open-schema patch that protocol validation lets through", async () => {
    const scene = globalThis.game.scenes.get("scene-1");
    const updateEmbedded = vi.spyOn(scene, "updateEmbeddedDocuments");
    for (const dryRun of [false, true]) {
      await expectRefused(
        "scene.token.update",
        `{"sceneId":"scene-1","tokenId":"token-a","dryRun":${dryRun},"patch":{"__proto__":{"isGM":true}}}`,
        "patch.__proto__",
        "__proto__"
      );
      await expectRefused(
        "scene.token.update",
        `{"sceneId":"scene-1","tokenId":"token-a","dryRun":${dryRun},"patch":{"__proto__.isGM":true}}`,
        "patch.__proto__.isGM",
        "__proto__"
      );
    }
    expect(updateEmbedded).not.toHaveBeenCalled();
  });

  it("refuses them before a command the policy holds for approval reaches the approval queue", async () => {
    await globalThis.game.settings.set(MODULE_ID, MODULE_SETTING_KEYS.COMMAND_POLICY, {
      version: 1,
      overrides: { "actor.update": "approve" }
    });
    const before = prototypeNames();
    const response = await router.route(
      createRequest(
        "actor.update",
        JSON.parse('{"actorId":"actor-1","patch":{"system":{"__proto__":{"isGM":true}}}}')
      ),
      { measureRequestBytes: () => 512 }
    );
    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.details).toMatchObject({ command: "actor.update", reservedSegment: "__proto__" });
    expect(router.approvalStore.getQueueView()).toMatchObject({ current: null, waitingCount: 0 });
    expect(prototypeNames()).toEqual(before);
    expect(/** @type {any} */ ({}).isGM).toBeUndefined();
  });

  it("refuses Foundry 14's serialized operator key, alone or beside other keys, on single and bulk updates", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    const update = vi.spyOn(actor, "update");
    for (const flags of [
      { "mod.k": 9, mod: { __$OPERATOR$__: "ForcedReplacement", value: { j: 1 } } },
      { mod: { __$OPERATOR$__: "ForcedDeletion", k: 9 } },
      { mod: { __$OPERATOR$__: "ForcedDeletion" } }
    ]) {
      for (const dryRun of [false, true]) {
        const response = await send("actor.update", { actorId: "actor-1", patch: { flags }, dryRun });
        expect(response.ok, JSON.stringify(flags)).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
        expect(response.error.details).toMatchObject({ reservedSegment: "__$OPERATOR$__" });
        expect(response.error.message).toContain('"==key" replacement');
      }
      const bulk = await send("actor.update-many", { patches: [{ id: "actor-1", patch: { flags } }] });
      expect(bulk.ok).toBe(false);
      expect(bulk.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(bulk.error.details).toMatchObject({ reservedSegment: "__$OPERATOR$__" });
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses them in bulk elements and inside embedded-collection entries", async () => {
    const item = globalThis.game.items.get("item-1");
    const update = vi.spyOn(item, "update");
    await expectRefused(
      "item.update-many",
      '{"patches":[{"id":"item-1","patch":{"system":{"__proto__":{"isGM":true}}}}]}',
      "patches.0.patch.system.__proto__",
      "__proto__"
    );
    expect(update).not.toHaveBeenCalled();

    const scene = globalThis.game.scenes.get("scene-1");
    const region = scene.regions.get("region-lava");
    const behavior = Array.from(region.behaviors)[0];
    const behaviorId = behavior._id ?? behavior.id;
    const regionUpdate = vi.spyOn(region, "update");
    for (const entry of [
      `{"_id":"${behaviorId}","system.__proto__.a":1}`,
      `{"_id":"${behaviorId}","flags":{"__proto__":{"a":1}}}`
    ]) {
      await expectRefused(
        "scene.region.update-many",
        `{"sceneId":"scene-1","patches":[{"id":"region-lava","patch":{"behaviors":[${entry}]}}]}`,
        entry.includes("flags")
          ? "patches.0.patch.behaviors.0.flags.__proto__"
          : "patches.0.patch.behaviors.0.system.__proto__.a",
        "__proto__"
      );
    }
    expect(regionUpdate).not.toHaveBeenCalled();
  });
});

describe("clone and import overrides reach Foundry expanded", () => {
  it("hands document.clone the expanded patch on the dry run and on the real clone", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    for (const dryRun of [true, false]) {
      actor.clone.mockClear();
      const response = await send("actor.clone", {
        actorId: "actor-1",
        patch: { flags: { "mod.k": 5, mod: { j: 20 } } },
        dryRun
      });
      expect(response.ok, JSON.stringify(response.error)).toBe(true);
      expect(actor.clone.mock.calls[0][0]).toEqual({ flags: { mod: { k: 5, j: 20 } } });
    }
  });

  it("refuses a clone patch that writes into a stored array or pairs an operator with another key", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    actor.flags = { mod: { list: ["a", "b", "c"] } };
    for (const dryRun of [true, false]) {
      actor.clone.mockClear();
      const descent = await send("actor.clone", {
        actorId: "actor-1",
        patch: { flags: { "mod.list.1": "z" } },
        dryRun
      });
      expect(descent.ok).toBe(false);
      expect(descent.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(descent.error.details).toMatchObject({
        field: "flags.mod.list.1",
        arrayField: "flags.mod.list"
      });
      const conflict = await send("actor.clone", {
        actorId: "actor-1",
        patch: { flags: { "-=mod": null, mod: { k: 1 } } },
        dryRun
      });
      expect(conflict.ok).toBe(false);
      expect(conflict.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(conflict.error.details).toMatchObject({ field: "flags.mod", ambiguityRule: 2 });
      expect(actor.clone).not.toHaveBeenCalled();
    }
  });

  it("refuses import overrides that write into an array of the imported data or pair an operator with another key", async () => {
    const fromCompendium = globalThis.game.actors.fromCompendium;
    const original = fromCompendium.getMockImplementation();
    fromCompendium.mockImplementation((...args) => ({
      ...original(...args),
      flags: { mod: { list: ["a", "b"] } }
    }));
    const descent = await send("actor.import-from-compendium", {
      pack: "world.test-monsters",
      entryId: "arch1",
      patch: { flags: { "mod.list.0": "z" } }
    });
    expect(descent.ok).toBe(false);
    expect(descent.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(descent.error.details).toMatchObject({ field: "flags.mod.list.0", arrayField: "flags.mod.list" });
    const conflict = await send("actor.import-from-compendium", {
      pack: "world.test-monsters",
      entryId: "arch1",
      patch: { prototypeToken: { "-=texture": null, texture: { src: "x.webp" } } }
    });
    expect(conflict.ok).toBe(false);
    expect(conflict.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(conflict.error.details).toMatchObject({ field: "prototypeToken.texture" });
    fromCompendium.mockImplementation(original);

    const embedded = await send("actor.item.import-from-compendium", {
      actorId: "actor-1",
      pack: "world.test-items",
      entryId: "it-full",
      patch: { system: { "-=description": null, description: { value: "x" } } }
    });
    expect(embedded.ok).toBe(false);
    expect(embedded.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(embedded.error.details).toMatchObject({ field: "system.description" });
  });

  it("hands mergeObject expanded import overrides, so no leaf is lost", async () => {
    const mergeObject = vi.spyOn(globalThis.foundry.utils, "mergeObject");
    const response = await send("actor.import-from-compendium", {
      pack: "world.test-monsters",
      entryId: "arch1",
      patch: { prototypeToken: { "texture.src": "compendium/a.webp", texture: { tint: "#ff0000" } } }
    });
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    expect(response.result.actor.prototypeToken.texture).toMatchObject({
      src: "compendium/a.webp",
      tint: "#ff0000"
    });
    expect(mergeObject.mock.calls.at(-1)?.[1]).toEqual({
      prototypeToken: { texture: { src: "compendium/a.webp", tint: "#ff0000" } }
    });

    mergeObject.mockClear();
    const embedded = await send("actor.item.import-from-compendium", {
      actorId: "actor-1",
      pack: "world.test-items",
      entryId: "it-full",
      patch: { system: { "description.value": "<p>x</p>", description: { chat: "c" } } }
    });
    expect(embedded.ok, JSON.stringify(embedded.error)).toBe(true);
    expect(mergeObject.mock.calls.at(-1)?.[1]).toEqual({
      system: { description: { value: "<p>x</p>", chat: "c" } }
    });
  });
});

describe("a write into a stored array is refused before anything is written", () => {
  it("refuses all three spellings on single updates, dry runs and bulk updates", async () => {
    const actor = globalThis.game.actors.get("actor-1");
    actor.flags = { mod: { list: ["a", "b", "c"] } };
    const update = vi.spyOn(actor, "update");
    for (const [flags, field] of /** @type {Array<[Record<string, unknown>, string]>} */ ([
      [{ "mod.list.1": "z" }, "flags.mod.list.1"],
      [{ mod: { "list.1": "z" } }, "flags.mod.list.1"],
      [{ mod: { list: { 1: "z" } } }, "flags.mod.list.1"],
      [{ "mod.list.length": 0 }, "flags.mod.list.length"],
      [{ mod: { list: { foo: "z" } } }, "flags.mod.list.foo"]
    ])) {
      for (const dryRun of [false, true]) {
        const response = await send("actor.update", { actorId: "actor-1", patch: { flags }, dryRun });
        expect(response.ok, JSON.stringify(flags)).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
        expect(response.error.details).toMatchObject({ field, arrayField: "flags.mod.list" });
      }
      const bulk = await send("actor.update-many", { patches: [{ id: "actor-1", patch: { flags } }] });
      expect(bulk.ok).toBe(false);
      expect(bulk.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(bulk.error.details).toMatchObject({ index: 0, id: "actor-1", field });
    }
    expect(update).not.toHaveBeenCalled();
    expect(actor.flags.mod.list).toEqual(["a", "b", "c"]);
  });
});

describe("a patch nested beyond the depth limit is refused as invalid", () => {
  it("refuses deep nesting, a long dotted key and deep arrays, and accepts the limit itself", async () => {
    /** @type {any} */
    let nested = 1;
    for (let level = 0; level < 3000; level += 1) nested = { v: nested };
    /** @type {any} */
    let arrays = 1;
    for (let level = 0; level < 3000; level += 1) arrays = [arrays];
    for (const patch of [
      { flags: nested },
      { flags: { [Array.from({ length: 5000 }, () => "a").join(".")]: 1 } },
      { flags: { list: arrays } }
    ]) {
      const response = await send("actor.update", { actorId: "actor-1", patch, dryRun: true });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.details, JSON.stringify(response.error).slice(0, 400)).toMatchObject({
        limit: "patch-depth",
        max: PATCH_MAX_DEPTH
      });
    }
    const atLimit = Array.from({ length: PATCH_MAX_DEPTH - 1 }, () => "a").join(".");
    const accepted = await send("actor.update", {
      actorId: "actor-1",
      patch: { flags: { [atLimit]: 1 } },
      dryRun: true
    });
    expect(accepted.ok, JSON.stringify(accepted.error)).toBe(true);
  });

  it("refuses a request nested about 100 000 levels deep promptly, without a stack overflow", async () => {
    /** @type {any} */
    let nested = 1;
    for (let level = 0; level < 100_000; level += 1) nested = { v: nested };
    /** @type {any} */
    let arrays = 1;
    for (let level = 0; level < 100_000; level += 1) arrays = [arrays];
    for (const [command, params, code] of /** @type {Array<[string, Record<string, any>, string]>} */ ([
      [
        "actor.update",
        { actorId: "actor-1", patch: { flags: nested }, dryRun: true },
        ERROR_CODES.INVALID_PARAMS
      ],
      ["actor.update", { actorId: "actor-1", patch: { flags: nested } }, ERROR_CODES.INVALID_PARAMS],
      [
        "actor.update-many",
        { patches: [{ id: "actor-1", patch: { flags: nested } }] },
        ERROR_CODES.INVALID_PARAMS
      ],
      ["actor.update", { actorId: "actor-1", patch: { flags: { list: arrays } } }, ERROR_CODES.INVALID_PARAMS]
    ])) {
      const started = performance.now();
      const response = await send(command, params);
      const elapsed = performance.now() - started;
      expect(response.ok).toBe(false);
      expect(response.error.code, JSON.stringify(response.error).slice(0, 300)).toBe(code);
      expect(elapsed).toBeLessThan(500);
    }
  });
});

describe("a nested deletion beside a plain key of the same path is refused before any write", () => {
  const patch = { flags: { "-=zz": null, zz: { k: 1 } } };

  it("journal page patches inside journal.update and its dry run refuse it before any write", async () => {
    const journal = globalThis.game.journal.get("journal-1");
    const updatePages = vi.spyOn(journal, "updateEmbeddedDocuments");
    for (const [pagePatch, field] of /** @type {Array<[Record<string, unknown>, string]>} */ ([
      [{ flags: { "-=mod": null, mod: { k: 1 } } }, "flags.mod"],
      [{ flags: { "mod.-=k": null, mod: { k: 2 } } }, "flags.mod.k"]
    ])) {
      for (const dryRun of [false, true]) {
        const response = await send("journal.update", {
          journalId: "journal-1",
          patch: { pages: [{ id: "page-1", ...pagePatch }] },
          dryRun
        });
        expect(response.ok, JSON.stringify(pagePatch)).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
        expect(response.error.details).toMatchObject({
          journalId: "journal-1",
          pageId: "page-1",
          field
        });
      }
    }
    expect(updatePages).not.toHaveBeenCalled();
  });

  it("item.update, its dry run and item.update-many refuse it alike", async () => {
    const item = globalThis.game.items.get("item-1");
    const update = vi.spyOn(item, "update");

    for (const dryRun of [false, true]) {
      const response = await send("item.update", { itemId: "item-1", patch, dryRun });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.details).toMatchObject({ field: "flags.zz" });
    }

    const bulk = await send("item.update-many", { patches: [{ id: "item-1", patch }] });
    expect(bulk.ok).toBe(false);
    expect(bulk.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(bulk.error.details).toMatchObject({ index: 0, id: "item-1", field: "flags.zz" });
    expect(update).not.toHaveBeenCalled();
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

    expectUpdateVetoError(response, "name");
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

    expectUpdateVetoError(response, "name");
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

    expectUpdateVetoError(response, "volume");
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

    expectUpdateVetoError(response, "name");
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
    expect(response.error.message).toMatch(/DESTROYED/);
    expect(response.error.message).toMatch(/Nothing was written/);
    expect(response.error.details).toMatchObject({ sceneId: "scene-1", wallId: "wall-plain" });
    expect(scene.walls.get("wall-plain").c).toEqual(stored);
    expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("refuses a dotted key under a forced replacement into the wall's coordinate array on every path", async () => {
    const scene = globalThis.game.scenes.get("scene-1");
    const wall = scene.walls.get("wall-plain");
    const stored = [...wall.c];
    const cloneSpy = vi.spyOn(wall, "clone");
    for (const [command, params] of /** @type {Array<[string, Record<string, any>]>} */ ([
      ["scene.wall.update", { sceneId: "scene-1", wallId: "wall-plain", patch: { "==c.foo": 1 } }],
      [
        "scene.wall.update",
        { sceneId: "scene-1", wallId: "wall-plain", patch: { "==c.foo": 1 }, dryRun: true }
      ],
      [
        "scene.wall.update-many",
        { sceneId: "scene-1", patches: [{ id: "wall-plain", patch: { "==c.foo": 1 } }] }
      ],
      ["scene.wall.clone", { sceneId: "scene-1", wallId: "wall-plain", patch: { "==c.foo": 1 } }],
      [
        "scene.wall.clone",
        { sceneId: "scene-1", wallId: "wall-plain", patch: { "==c.foo": 1 }, dryRun: true }
      ]
    ])) {
      const response = await send(command, params);
      expect(response.ok, `${command} ${JSON.stringify(params)}`).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.message).toContain('dotted path "==c.foo"');
      expect(response.error.details).toMatchObject({ field: "==c.foo", arrayField: "c" });
    }
    expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
    expect(cloneSpy).not.toHaveBeenCalled();
    expect(wall.c).toEqual(stored);
  });

  it("a dry run refuses the same shape the real write refuses", async () => {
    const scene = globalThis.game.scenes.get("scene-1");

    const response = await send("scene.wall.update", {
      sceneId: "scene-1",
      wallId: "wall-plain",
      patch: { "c.0": 999 },
      dryRun: true
    });

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    expect(response.error.message).toMatch(/DESTROYED/);
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

describe("an operator-key patch confirms against stored state, not the raw diff", () => {
  it("a forced-replacement flag write succeeds and lands the value", async () => {
    const response = await send("scene.token.update", {
      sceneId: "scene-1",
      tokenId: "token-a",
      patch: { "flags.==scope": { only: 1 } }
    });

    expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
    expect(globalThis.game.scenes.get("scene-1").tokens.get("token-a").toObject().flags).toMatchObject({
      scope: { only: 1 }
    });
  });

  it("a total veto beside a trivially reflected operator key is NOT reported as partial", async () => {
    const scene = globalThis.game.scenes.get("scene-1");
    const token = scene.tokens.get("token-a");
    const currentName = token.name;
    scene.updateEmbeddedDocuments = vi.fn(async () => []);

    const response = await send("scene.token.update", {
      sceneId: "scene-1",
      tokenId: "token-a",
      patch: { "==name": currentName, alpha: 0.25 }
    });

    expect(response.ok).toBe(false);
    expect(response.error.message).toContain("cannot verify");
    expect(response.error.details).toMatchObject({ fields: ["alpha"], changedFields: [] });
    expect(response.error.details.paths.map((/** @type {any} */ entry) => entry.path)).toEqual(["alpha"]);
    expect(response.error.details.partial).toBeUndefined();
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
    expect(response.error.message).toContain("cannot verify");
    expect(response.error.details).toMatchObject({
      fields: ["name"],
      paths: [{ path: "name", requested: "Renamed" }],
      appliedFields: ["flags"],
      partial: true
    });
    expect(token.name).not.toBe("Renamed");
    expect(token.toObject().flags).toMatchObject({ scope: { only: 1 } });
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

    expectUpdateVetoError(response, "name");
    expect(response.error.details).toMatchObject({
      journalId: "journal-1",
      pageId: "page-1",
      updatedPageIds: []
    });
  });

  it("page update with a rejected re-probe after the page changed is indeterminate", async () => {
    const journal = globalThis.game.journal.get("journal-1");
    const page = journal.pages.get("page-1");
    journal.updateEmbeddedDocuments = vi.fn(async () => {
      page.applyStoredWrite({ name: "Rewritten Page" });
      page.clone = vi.fn(async () => ({
        updateSource() {
          throw makeDataModelValidationError("name: may not be set");
        }
      }));
      return [page];
    });

    const response = await send("journal.update", {
      journalId: "journal-1",
      patch: { pages: [{ id: "page-1", name: "Renamed Page" }] }
    });

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(response.error.details).toMatchObject({
      pageId: "page-1",
      changedFields: ["name"],
      indeterminate: true
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

    expectUpdateVetoError(response, "name");
    expect(response.error.details).toMatchObject({
      journalId: "journal-1",
      pageId: "page-1",
      updatedPageIds: [secondId]
    });
    expect(response.error.message).toContain("details.updatedPageIds");
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
