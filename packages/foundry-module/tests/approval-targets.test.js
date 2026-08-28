import { beforeEach, describe, expect, it } from "vitest";

import { COMMAND_DEFINITIONS, COMMAND_NAMES } from "../scripts/generated/protocol.js";
import {
  APPROVAL_TARGET_DISPLAY_MAX,
  APPROVAL_TARGET_FILE_TYPE,
  APPROVAL_TARGET_KINDS,
  APPROVAL_TARGET_NODES,
  APPROVAL_TARGET_STATES,
  getApprovalTargetStrategy,
  resolveApprovalTargets
} from "../scripts/lib/approval-targets.js";
import { createCollection, createDocument, installFakeFoundry } from "./helpers/fake-foundry.js";

// An id-suffixed property, plus the two names a command uses for the counterpart document or path
// of a move, which carry no suffix.
const ID_PARAMETER_PATTERN = /^(?:.+Ids?|from|to)$/;

// The ids a summary carries as descriptor text instead of as a resolved document target: an entry in
// a compendium, which lies outside the world document graph, and the opaque approval correlation id.
// A new command whose id is missing here has no resolved target.
const UNRESOLVED_ID_PARAMETERS = [
  "actor.import-from-compendium entryId",
  "actor.item.import-from-compendium entryId",
  "approval.await approvalId",
  "approval.cancel approvalId",
  "cards.import-from-compendium entryId",
  "compendium.get entryId",
  "item.import-from-compendium entryId",
  "journal.import-from-compendium entryId",
  "macro.import-from-compendium entryId",
  "playlist.import-from-compendium entryId",
  "scene.import-from-compendium entryId",
  "table.import-from-compendium entryId"
];

// Families whose commands address no world document: the approval plumbing, compendium sources,
// managed files, the policy layer, world settings, and world-wide queries. A family in neither this
// set nor the resolver's node map would reach the GM with no target summary at all.
const DOCUMENT_FREE_FAMILIES = ["approval", "compendium", "file", "policy", "setting", "system", "world"];

/** @param {string} command */
function idParameters(command) {
  return Object.keys(COMMAND_DEFINITIONS[command].paramsSchema.properties ?? {}).filter((property) =>
    ID_PARAMETER_PATTERN.test(property)
  );
}

/** @param {string} command */
function resolvedIdParameters(command) {
  const strategy = getApprovalTargetStrategy(command);
  return new Set(
    [
      ...(strategy?.chain ?? []).map((link) => link.node.idField),
      ...(strategy?.pathProperties ?? []),
      ...(strategy?.references ?? []).map((reference) => reference.property),
      strategy?.elementProperty
    ].filter((property) => typeof property === "string")
  );
}

describe("approval target strategies", () => {
  it("gives every command the registry defines one recognized strategy over the documents of its family", () => {
    const documentFree = new Set(DOCUMENT_FREE_FAMILIES);
    const misplaced = COMMAND_NAMES.filter((command) => {
      const strategy = getApprovalTargetStrategy(command);
      if (!strategy || !APPROVAL_TARGET_KINDS.includes(strategy.kind)) {
        return true;
      }

      const namesDocuments = strategy.chain.length > 0 || strategy.collection !== null;
      return namesDocuments === documentFree.has(command.split(".")[0]);
    });

    expect(misplaced).toEqual([]);
    expect(
      DOCUMENT_FREE_FAMILIES.filter(
        (family) => !COMMAND_NAMES.some((command) => command.startsWith(`${family}.`))
      )
    ).toEqual([]);
  });

  it("names a document collection for every command that changes the world", () => {
    const undescribed = COMMAND_NAMES.filter((command) => {
      if (!COMMAND_DEFINITIONS[command].mutation) {
        return false;
      }

      const strategy = getApprovalTargetStrategy(command);
      return (
        !strategy ||
        strategy.kind === "none" ||
        (strategy.chain.length === 0 && strategy.collection === null && strategy.pathProperties.length === 0)
      );
    });

    expect(undescribed).toEqual([]);
  });

  it("names the document type of every command that describes a collection of them", () => {
    const untyped = COMMAND_NAMES.filter((command) => {
      const strategy = getApprovalTargetStrategy(command);
      return (
        (strategy?.kind === "create" || strategy?.kind === "bulk") && (strategy?.collection ?? null) === null
      );
    });

    expect(untyped).toEqual([]);
  });

  it("resolves every id a command declares, or names it as one only the parameters carry", () => {
    const unresolved = COMMAND_NAMES.flatMap((command) => {
      const resolved = resolvedIdParameters(command);
      return idParameters(command)
        .filter((property) => !resolved.has(property))
        .map((property) => `${command} ${property}`);
    });

    expect(unresolved.sort()).toEqual([...UNRESOLVED_ID_PARAMETERS].sort());
  });

  it("describes no command through the upload payload", () => {
    const describing = COMMAND_NAMES.filter((command) =>
      getApprovalTargetStrategy(command)?.descriptorProperties.includes("contentBase64")
    );

    expect(describing).toEqual([]);
  });

  it("has no strategy for a name outside the registry", () => {
    expect(getApprovalTargetStrategy("not-a-family.not-a-verb")).toBeNull();
    expect(resolveApprovalTargets("not-a-family.not-a-verb", { widgetId: "w1" })).toEqual({
      kind: "none",
      collection: null,
      targets: [],
      totalCount: 0,
      omittedCount: 0,
      descriptor: []
    });
  });
});

// The ids of a seeded document for every node the resolver can address, parents first. A node whose
// entry is missing, or whose resolver stops reaching its document, fails the exhaustiveness test
// instead of reporting an addressed document as missing.
const NODE_FIXTURE_IDS = {
  scene: ["scene-1"],
  "scene.token": ["scene-1", "token-a"],
  "scene.tile": ["scene-1", "tile-a"],
  "scene.sound": ["scene-1", "sound-a"],
  "scene.wall": ["scene-1", "wall-plain"],
  "scene.note": ["scene-1", "note-quest"],
  "scene.drawing": ["scene-1", "drawing-rect"],
  "scene.light": ["scene-1", "light-torch"],
  "scene.template": ["scene-1", "template-fireball"],
  "scene.region": ["scene-1", "region-lava"],
  "scene.region.behavior": ["scene-1", "region-lava", "region-lava-behavior-1"],
  "scene.token.item": ["scene-1", "token-a", "delta-item-1"],
  "scene.token.item.effect": ["scene-1", "token-a", "delta-item-1", "delta-item-effect-1"],
  "scene.token.effect": ["scene-1", "token-a", "delta-effect-1"],
  actor: ["actor-1"],
  "actor.item": ["actor-1", "actor-item-1"],
  "actor.effect": ["actor-1", "actor-effect-1"],
  "actor.item.effect": ["actor-1", "actor-item-1", "actor-item-effect-1"],
  item: ["item-1"],
  "item.effect": ["item-1", "item-effect-1"],
  journal: ["journal-1"],
  "journal.category": ["journal-categories", "cat-chapter-one"],
  "journal.page": ["journal-1", "page-1"],
  macro: ["macro-1"],
  playlist: ["playlist-1"],
  "playlist.sound": ["playlist-1", "sound-1"],
  table: ["table-1"],
  "table.result": ["table-1", "result-1"],
  combat: ["combat-1"],
  "combat.combatant": ["combat-1", "combatant-1"],
  "combat.group": ["combat-1", "combatGroupAAA11"],
  cards: ["cards-deck"],
  "cards.card": ["cards-deck", "card-ace"],
  chat: ["msg-1"],
  folder: ["folder-actors-test"],
  user: ["user-1"]
};

function seedRemainingTargetFixtures() {
  const game = globalThis.game;
  game.users = createCollection([createDocument("user-1", { name: "Ada" })]);

  const tokenActor = game.scenes.get("scene-1").tokens.get("token-a").actor;
  const owners = [
    [tokenActor.items.get("delta-item-1"), "delta-item-effect-1"],
    [tokenActor, "delta-effect-1"],
    [game.actors.get("actor-1"), "actor-effect-1"],
    [game.actors.get("actor-1").items.get("actor-item-1"), "actor-item-effect-1"],
    [game.items.get("item-1"), "item-effect-1"]
  ];

  for (const [owner, effectId] of owners) {
    owner.effects.set(createDocument(effectId, { name: "Flaming" }));
  }
}

/**
 * @param {string} path
 * @param {{ idField: string, type: string }} node
 */
function commandAddressing(path, node) {
  for (const command of COMMAND_NAMES) {
    const strategy = getApprovalTargetStrategy(command);
    if (!strategy) {
      continue;
    }

    const terminal = strategy.chain[strategy.chain.length - 1];
    if (terminal?.path === path) {
      return { command, parents: strategy.chain.slice(0, -1), property: terminal.node.idField };
    }

    const reference = strategy.references.find((entry) => entry.node === node);
    if (reference) {
      return { command, parents: strategy.chain, property: reference.property };
    }
  }

  return null;
}

describe("approval target document resolution", () => {
  beforeEach(() => {
    installFakeFoundry();
    seedRemainingTargetFixtures();
  });

  it("resolves a seeded document for every node a command can address", () => {
    expect(Object.keys(NODE_FIXTURE_IDS).sort()).toEqual(Object.keys(APPROVAL_TARGET_NODES).sort());

    const unresolved = Object.entries(APPROVAL_TARGET_NODES).filter(([path, node]) => {
      const addressing = commandAddressing(path, node);
      const ids = NODE_FIXTURE_IDS[path];
      if (!addressing || ids.length !== addressing.parents.length + 1) {
        return true;
      }

      const params = Object.fromEntries([
        ...addressing.parents.map((link, index) => [link.node.idField, ids[index]]),
        [addressing.property, ids[ids.length - 1]]
      ]);

      return !resolveApprovalTargets(addressing.command, params).targets.some(
        (target) =>
          target.role === addressing.property && target.type === node.type && target.state === "resolved"
      );
    });

    expect(unresolved.map(([path]) => path)).toEqual([]);
  });
});

describe("approval target resolution", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  it("names the world document an update addresses", () => {
    const summary = resolveApprovalTargets("actor.update", { actorId: "actor-1", patch: { name: "x" } });

    expect(summary.kind).toBe("world-document");
    expect(summary.totalCount).toBe(1);
    expect(summary.targets).toEqual([
      { role: "actorId", type: "Actor", id: "actor-1", name: "Valeros", state: "resolved", parents: [] }
    ]);
  });

  it("names the world document a delete addresses", () => {
    const summary = resolveApprovalTargets("item.delete", { itemId: "item-1" });

    expect(summary.kind).toBe("world-document");
    expect(summary.targets[0]).toMatchObject({ type: "Item", name: "Longsword", state: "resolved" });
  });

  it("carries the parent scene of a scene-embedded update", () => {
    const summary = resolveApprovalTargets("scene.token.update", {
      sceneId: "scene-1",
      tokenId: "token-a",
      patch: { hidden: true }
    });

    expect(summary.kind).toBe("embedded-document");
    expect(summary.targets).toHaveLength(2);
    expect(summary.targets[1]).toEqual({
      role: "tokenId",
      type: "Token",
      id: "token-a",
      name: "Valeros Token",
      state: "resolved",
      parents: [{ type: "Scene", id: "scene-1", name: "Dungeon Level 1", state: "resolved" }]
    });
  });

  it("carries the whole parent chain of a token item effect", () => {
    const effect = createDocument("delta-effect-1", { name: "Flaming" });
    globalThis.game.scenes
      .get("scene-1")
      .tokens.get("token-a")
      .actor.items.get("delta-item-1")
      .effects.set(effect);

    const summary = resolveApprovalTargets("scene.token.item.effect.update", {
      sceneId: "scene-1",
      tokenId: "token-a",
      itemId: "delta-item-1",
      effectId: "delta-effect-1",
      patch: { disabled: true }
    });

    expect(summary.kind).toBe("embedded-document");
    expect(summary.targets.map((target) => [target.type, target.name, target.state])).toEqual([
      ["Scene", "Dungeon Level 1", "resolved"],
      ["Token", "Valeros Token", "resolved"],
      ["Item", "Dagger", "resolved"],
      ["ActiveEffect", "Flaming", "resolved"]
    ]);
    expect(summary.targets[3].parents.map((parent) => parent.id)).toEqual([
      "scene-1",
      "token-a",
      "delta-item-1"
    ]);
  });

  it("counts a bulk envelope and lists its elements under the shared parent", () => {
    const summary = resolveApprovalTargets("scene.token.delete-many", {
      sceneId: "scene-1",
      ids: ["token-a", "token-linked", "token-gone"]
    });

    expect(summary.kind).toBe("bulk");
    expect(summary.collection).toBe("Token");
    expect(summary.totalCount).toBe(3);
    expect(summary.omittedCount).toBe(0);
    expect(summary.targets.map((target) => [target.id, target.name, target.state])).toEqual([
      ["token-a", "Valeros Token", "resolved"],
      ["token-linked", "Linked Valeros", "resolved"],
      ["token-gone", null, "not-found"]
    ]);
    expect(summary.targets[0].parents).toEqual([
      { type: "Scene", id: "scene-1", name: "Dungeon Level 1", state: "resolved" }
    ]);
  });

  it("reports how many bulk elements the list leaves out", () => {
    const ids = Array.from({ length: APPROVAL_TARGET_DISPLAY_MAX + 6 }, (_, index) => `token-${index}`);
    const summary = resolveApprovalTargets("scene.token.delete-many", { sceneId: "scene-1", ids });

    expect(summary.totalCount).toBe(ids.length);
    expect(summary.targets).toHaveLength(APPROVAL_TARGET_DISPLAY_MAX);
    expect(summary.omittedCount).toBe(6);
    expect(summary.totalCount - summary.omittedCount).toBe(summary.targets.length);
  });

  it("names both stacks a card movement addresses", () => {
    const deal = resolveApprovalTargets("cards.deal", {
      cardsId: "cards-deck",
      to: ["cards-hand", "cards-gone"],
      count: 2
    });

    expect(deal.kind).toBe("world-document");
    expect(deal.targets.map((target) => [target.role, target.name, target.state])).toEqual([
      ["cardsId", "Poker Deck", "resolved"],
      ["to", "Player Hand", "resolved"],
      ["to", null, "not-found"]
    ]);
    expect(deal.totalCount - deal.omittedCount).toBe(deal.targets.length);
    expect(deal.descriptor).toEqual([]);

    const draw = resolveApprovalTargets("cards.draw", { cardsId: "cards-hand", from: "cards-deck" });

    expect(draw.targets.map((target) => [target.role, target.type, target.name])).toEqual([
      ["cardsId", "Cards", "Player Hand"],
      ["from", "Cards", "Poker Deck"]
    ]);
    expect(draw.descriptor).toEqual([]);
  });

  it("reports how many counterpart stacks the list leaves out", () => {
    const to = Array.from({ length: APPROVAL_TARGET_DISPLAY_MAX + 3 }, () => "cards-hand");
    const summary = resolveApprovalTargets("cards.deal", { cardsId: "cards-deck", to });

    expect(summary.totalCount).toBe(to.length + 1);
    expect(summary.omittedCount).toBe(3);
    expect(summary.totalCount - summary.omittedCount).toBe(summary.targets.length);
  });

  it("reads no more counterpart stacks than the list shows", () => {
    const collection = globalThis.game.cards;
    const lookUp = collection.get.bind(collection);
    let lookups = 0;
    collection.get = (id) => {
      lookups += 1;
      return lookUp(id);
    };

    const to = Array.from({ length: 5000 }, (_, index) => `cards-hand-${index}`);
    const summary = resolveApprovalTargets("cards.deal", { cardsId: "cards-deck", to });

    expect(lookups).toBe(APPROVAL_TARGET_DISPLAY_MAX + 1);
    expect(summary.totalCount).toBe(to.length + 1);
    expect(summary.totalCount - summary.omittedCount).toBe(summary.targets.length);
  });

  it("names the cards a pass moves out of the stack that holds them", () => {
    const summary = resolveApprovalTargets("cards.pass", {
      cardsId: "cards-deck",
      to: "cards-hand",
      cardIds: ["card-ace"]
    });

    expect(summary.targets.map((target) => [target.role, target.type, target.name, target.state])).toEqual([
      ["cardsId", "Cards", "Poker Deck", "resolved"],
      ["to", "Cards", "Player Hand", "resolved"],
      ["cardIds", "Card", "Face One", "resolved"]
    ]);
    expect(summary.targets[2].parents).toEqual([
      { type: "Cards", id: "cards-deck", name: "Poker Deck", state: "resolved" }
    ]);
  });

  it("names the journal page an ownership change addresses", () => {
    const page = resolveApprovalTargets("journal.ownership.set", {
      journalId: "journal-1",
      pageId: "page-1",
      default: 3
    });

    expect(page.targets.map((target) => [target.role, target.type, target.name, target.state])).toEqual([
      ["journalId", "JournalEntry", "GM Notes", "resolved"],
      ["pageId", "JournalEntryPage", "Overview", "resolved"]
    ]);
    expect(page.targets[1].parents).toEqual([
      { type: "JournalEntry", id: "journal-1", name: "GM Notes", state: "resolved" }
    ]);
    expect(page.descriptor).toEqual([]);

    const entry = resolveApprovalTargets("journal.ownership.set", { journalId: "journal-1", default: 3 });

    expect(entry.targets.map((target) => target.type)).toEqual(["JournalEntry"]);
  });

  it("names the combatants an initiative change addresses", () => {
    const one = resolveApprovalTargets("combat.set-initiative", {
      combatId: "combat-1",
      combatantId: "combatant-1",
      initiative: 12
    });

    expect(one.targets.map((target) => [target.role, target.type, target.name, target.state])).toEqual([
      ["combatId", "Combat", null, "resolved"],
      ["combatantId", "Combatant", "Hero", "resolved"]
    ]);
    expect(one.descriptor).toEqual([]);

    const several = resolveApprovalTargets("combat.roll-initiative", {
      combatId: "combat-1",
      combatantIds: ["combatant-1", "combatant-gone"]
    });

    expect(several.targets.map((target) => [target.id, target.name, target.state])).toEqual([
      ["combat-1", null, "resolved"],
      ["combatant-1", "Hero", "resolved"],
      ["combatant-gone", null, "not-found"]
    ]);
    expect(several.totalCount).toBe(3);
  });

  it("takes the proposed names of a bulk create from its payload", () => {
    const summary = resolveApprovalTargets("actor.effect.create-many", {
      actorId: "actor-1",
      data: [{ name: "Blessed" }, { label: "unnamed" }]
    });

    expect(summary.targets.map((target) => [target.name, target.state])).toEqual([
      ["Blessed", "proposed"],
      [null, "proposed"]
    ]);
  });

  it("reads the ids a bulk update patches", () => {
    const summary = resolveApprovalTargets("item.update-many", {
      patches: [{ id: "item-1", patch: { name: "x" } }]
    });

    expect(summary.targets[0]).toMatchObject({ id: "item-1", name: "Longsword", state: "resolved" });
  });

  it("shows the managed paths a file command addresses", () => {
    const upload = resolveApprovalTargets("file.upload", {
      path: "worlds/world-1/notes.txt",
      contentBase64: "AAAA"
    });

    expect(upload.kind).toBe("file-path");
    expect(upload.targets).toEqual([
      {
        role: "path",
        type: APPROVAL_TARGET_FILE_TYPE,
        id: null,
        name: "worlds/world-1/notes.txt",
        state: "path",
        parents: []
      }
    ]);
    expect(upload.descriptor).toEqual([]);

    const move = resolveApprovalTargets("file.move", {
      from: "worlds/world-1/a.txt",
      to: "worlds/world-1/b.txt"
    });

    expect(move.targets.map((target) => [target.role, target.name])).toEqual([
      ["from", "worlds/world-1/a.txt"],
      ["to", "worlds/world-1/b.txt"]
    ]);
  });

  it("shows the managed root a listing addresses", () => {
    const summary = resolveApprovalTargets("file.list", { path: "" });

    expect(summary.targets).toEqual([
      { role: "path", type: APPROVAL_TARGET_FILE_TYPE, id: null, name: "", state: "path", parents: [] }
    ]);
  });

  it("never reads the upload payload while describing a file target", () => {
    let reads = 0;
    const params = { path: "worlds/world-1/notes.txt" };
    Object.defineProperty(params, "contentBase64", {
      enumerable: true,
      get: () => {
        reads += 1;
        return "AAAA";
      }
    });

    const summary = resolveApprovalTargets("file.upload", params);

    expect(reads).toBe(0);
    expect(summary.targets[0].name).toBe("worlds/world-1/notes.txt");
  });

  it("shows the proposed name and parent of a create", () => {
    const summary = resolveApprovalTargets("actor.item.create", {
      actorId: "actor-1",
      data: { name: "Rope", type: "gear" }
    });

    expect(summary.kind).toBe("create");
    expect(summary.collection).toBe("Item");
    expect(summary.targets).toEqual([
      {
        role: "data",
        type: "Item",
        id: null,
        name: "Rope",
        state: "proposed",
        parents: [{ type: "Actor", id: "actor-1", name: "Valeros", state: "resolved" }]
      }
    ]);
  });

  it("shows the compendium source of an import", () => {
    const summary = resolveApprovalTargets("actor.import-from-compendium", {
      pack: "world.test-actors-pack",
      entryId: "arch1"
    });

    expect(summary.kind).toBe("create");
    expect(summary.targets[0]).toMatchObject({ type: "Actor", name: null, state: "proposed" });
    expect(summary.descriptor).toEqual([
      { key: "pack", value: "world.test-actors-pack" },
      { key: "entryId", value: "arch1" }
    ]);
  });

  it("shows the meaningful keys of a command with no document target", () => {
    expect(resolveApprovalTargets("world.search", { query: "goblin" })).toMatchObject({
      kind: "none",
      targets: [],
      descriptor: [{ key: "query", value: "goblin" }]
    });

    expect(resolveApprovalTargets("setting.get", { namespace: "core", key: "language" }).descriptor).toEqual([
      { key: "namespace", value: "core" },
      { key: "key", value: "language" }
    ]);

    expect(resolveApprovalTargets("system.info", {})).toMatchObject({
      kind: "none",
      collection: null,
      targets: [],
      descriptor: []
    });
  });

  it("shows an unresolvable id as the raw id marked not found", () => {
    const summary = resolveApprovalTargets("scene.token.update", {
      sceneId: "scene-1",
      tokenId: "token-gone",
      patch: {}
    });

    expect(summary.targets[1]).toMatchObject({ id: "token-gone", name: null, state: "not-found" });
  });

  it("summarizes a command whose optional scope property is absent", () => {
    const summary = resolveApprovalTargets("playlist.sound.list", {});

    expect(summary.kind).toBe("world-document");
    expect(summary.collection).toBe("PlaylistSound");
    expect(summary.targets).toEqual([
      { role: "playlistId", type: "Playlist", id: null, name: null, state: "unspecified", parents: [] }
    ]);
  });

  it("marks a target with one of the states it declares, and declares no state it never marks", () => {
    const summaries = [
      resolveApprovalTargets("actor.update", { actorId: "actor-1", patch: {} }),
      resolveApprovalTargets("scene.token.update", {
        sceneId: "scene-1",
        tokenId: "token-gone",
        patch: {}
      }),
      resolveApprovalTargets("playlist.sound.list", {}),
      resolveApprovalTargets("actor.item.create", { actorId: "actor-1", data: { name: "Rope" } }),
      resolveApprovalTargets("file.upload", { path: "worlds/world-1/notes.txt" })
    ];

    const marked = summaries.flatMap((summary) =>
      summary.targets.flatMap((target) => [target.state, ...target.parents.map((parent) => parent.state)])
    );

    expect([...new Set(marked)].sort()).toEqual([...APPROVAL_TARGET_STATES].sort());
  });

  it("answers without a game rather than raising the readiness error", () => {
    delete globalThis.game;

    const summary = resolveApprovalTargets("actor.update", { actorId: "actor-1", patch: {} });

    expect(summary.targets[0]).toMatchObject({ id: "actor-1", state: "not-found" });
  });

  it("leaves the documents it reads unchanged", () => {
    const effect = createDocument("delta-effect-1", { name: "Flaming" });
    const item = globalThis.game.scenes.get("scene-1").tokens.get("token-a").actor.items.get("delta-item-1");
    item.effects.set(effect);

    const scene = globalThis.game.scenes.get("scene-1");
    const before = JSON.stringify([scene.toObject(), item.toObject(), effect.toObject()]);

    resolveApprovalTargets("scene.token.item.effect.delete", {
      sceneId: "scene-1",
      tokenId: "token-a",
      itemId: "delta-item-1",
      effectId: "delta-effect-1"
    });

    expect(JSON.stringify([scene.toObject(), item.toObject(), effect.toObject()])).toBe(before);
  });
});
