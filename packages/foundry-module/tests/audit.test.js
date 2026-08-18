import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUDIT_FILES_MAX_DIRS } from "../scripts/generated/protocol.js";
import { checkAuditRefs, collectAuditRefs, runFileAudit } from "../scripts/lib/audit.js";

function ensureFilePickerNamespace() {
  globalThis.foundry ??= {};
  globalThis.foundry.applications ??= {};
  globalThis.foundry.applications.apps ??= {};
  globalThis.foundry.applications.apps.FilePicker ??= {};
}

ensureFilePickerNamespace();

function makeDoc(source) {
  return {
    id: source._id,
    name: source.name ?? null,
    toObject: () => source
  };
}

function installFilePicker(dirMap) {
  globalThis.foundry.applications.apps.FilePicker.implementation = {
    browse: vi.fn(async (_source, target) => {
      const key = typeof target === "string" ? target : "";
      if (!Object.prototype.hasOwnProperty.call(dirMap, key)) {
        throw new Error(`Path not found: ${key}`);
      }
      return {
        target: key,
        dirs: [],
        files: dirMap[key].map((path) => ({ path, size: 10, mimeType: "image/webp" }))
      };
    })
  };
}

const originalGame = globalThis.game;
const originalFilePicker = globalThis.foundry.applications.apps.FilePicker.implementation;

afterEach(() => {
  ensureFilePickerNamespace();
  globalThis.game = originalGame;
  globalThis.foundry.applications.apps.FilePicker.implementation = originalFilePicker;
  vi.restoreAllMocks();
});

function installWorld() {
  const scene = makeDoc({
    _id: "scene-1",
    name: "Dungeon",
    background: { src: "worlds/w/scenes/bg-missing.webp" }, // broken
    foreground: "worlds/w/scenes/fg-ok.webp", // present
    tiles: [{ _id: "tile-1", texture: { src: "https://cdn.example/tile.png" } }], // external
    tokens: [{ _id: "tok-1", name: "Goblin", texture: { src: "icons/svg/mystery-man.svg" } }], // core public
    sounds: [{ _id: "snd-1", name: "Ambience", path: "worlds/w/audio/amb-missing.ogg" }], // broken
    notes: [],
    drawings: [],
    templates: []
  });

  const actor = makeDoc({
    _id: "actor-1",
    name: "Hero",
    img: "https://portraits.example/hero.png", // external https -> skipped, not broken
    prototypeToken: { texture: { src: "worlds/w/actors/proto-missing.png" } }, // broken
    items: [{ _id: "item-e1", name: "Sword", img: "worlds/w/actors/sword-ok.png" }]
  });

  const actorEncoded = makeDoc({
    _id: "actor-2",
    name: "Mage",
    img: "worlds/w/actors/my portrait.png", // literal; disk has my%20portrait.png
    prototypeToken: {},
    items: []
  });

  const item = makeDoc({ _id: "item-1", name: "Potion", img: "worlds/w/items/potion-ok.png" });

  const journal = makeDoc({
    _id: "journal-1",
    name: "Lore",
    pages: [
      { _id: "p1", name: "Map", src: "worlds/w/journal/map-missing.png" }, // broken
      { _id: "p2", name: "Text" }
    ]
  });

  const playlist = makeDoc({
    _id: "pl-1",
    name: "Battle",
    sounds: [
      { _id: "s1", name: "War Drums", path: "worlds/w/audio/drums-missing.mp3" }, // broken
      { _id: "s2", name: "Calm", path: "worlds/w/audio/calm-ok.mp3" }
    ]
  });

  const macro = makeDoc({ _id: "macro-1", name: "Roll", img: "worlds/w/macros/roll-ok.png" });

  const table = makeDoc({
    _id: "table-1",
    name: "Loot",
    img: "icons/svg/d20-grey.svg", // Foundry's DEFAULT_ICON → core public, never broken
    results: [
      { _id: "r1", name: "Sword", img: "worlds/w/tables/sword-missing.webp" }, // broken
      { _id: "r2", name: "Coin", img: "worlds/w/tables/coin-ok.webp" }, // present
      { _id: "r3", name: "Nothing", img: null }
    ]
  });

  const combat = makeDoc({
    _id: "combat-1",
    combatants: [
      { _id: "c1", name: "Goblin", img: "worlds/w/combat/goblin-missing.webp" }, // broken
      { _id: "c2", name: "Orc", img: "worlds/w/combat/orc-ok.webp" }, // present
      { _id: "c3", name: "Token-only", img: null }
    ],
    groups: [
      { _id: "g1", name: "Pack", img: "worlds/w/combat/pack-missing.webp" }, // broken
      { _id: "g2", name: "Plain", img: null }
    ]
  });

  const cardStack = makeDoc({
    _id: "cards-1",
    name: "Poker Deck",
    img: "icons/svg/card-hand.svg", // Foundry's DEFAULT_ICON → core public, never broken
    cards: [
      {
        _id: "cd1",
        name: "Ace",
        back: { img: "worlds/w/cards/back-missing.webp" }, // broken
        faces: [
          { name: "front", img: "worlds/w/cards/ace-ok.webp" }, // present
          { name: "alt", img: "worlds/w/cards/ace-alt-missing.webm" }
        ]
      },
      {
        _id: "cd2",
        name: "King",
        back: { img: null }, // no ref at all
        faces: [{ name: "front", img: "icons/svg/card-joker.svg" }]
      },
      { _id: "cd3", name: "Plain", back: {}, faces: [] }
    ]
  });

  globalThis.game = {
    ready: true,
    scenes: [scene],
    actors: [actor, actorEncoded],
    items: [item],
    journal: [journal],
    playlists: [playlist],
    macros: [macro],
    tables: [table],
    combats: [combat],
    cards: [cardStack]
  };

  installFilePicker({
    "worlds/w/scenes": ["worlds/w/scenes/fg-ok.webp"],
    "worlds/w/audio": ["worlds/w/audio/calm-ok.mp3"],
    "worlds/w/actors": ["worlds/w/actors/sword-ok.png", "worlds/w/actors/my%20portrait.png"],
    "worlds/w/items": ["worlds/w/items/potion-ok.png"],
    "worlds/w/journal": [],
    "worlds/w/macros": ["worlds/w/macros/roll-ok.png"],
    "worlds/w/tables": ["worlds/w/tables/coin-ok.webp"],
    "worlds/w/combat": ["worlds/w/combat/orc-ok.webp"],
    "worlds/w/cards": ["worlds/w/cards/ace-ok.webp"]
  });
}

describe("world.audit-files", () => {
  beforeEach(() => {
    installWorld();
  });

  it("reports broken references across scene+embedded, playlist sound, actor img, journal page", async () => {
    const result = await runFileAudit({});

    const key = (ref) => `${ref.docType}:${ref.parent ?? ""}:${ref.field}:${ref.path}`;
    const brokenKeys = result.broken.map(key).sort();

    expect(brokenKeys).toEqual(
      [
        { docType: "Scene", parent: "", field: "background.src", path: "worlds/w/scenes/bg-missing.webp" },
        { docType: "AmbientSound", parent: "scene-1", field: "path", path: "worlds/w/audio/amb-missing.ogg" },
        {
          docType: "Actor",
          parent: "",
          field: "prototypeToken.texture.src",
          path: "worlds/w/actors/proto-missing.png"
        },
        {
          docType: "JournalEntryPage",
          parent: "journal-1",
          field: "src",
          path: "worlds/w/journal/map-missing.png"
        },
        { docType: "PlaylistSound", parent: "pl-1", field: "path", path: "worlds/w/audio/drums-missing.mp3" },
        {
          docType: "TableResult",
          parent: "table-1",
          field: "img",
          path: "worlds/w/tables/sword-missing.webp"
        },
        {
          docType: "Combatant",
          parent: "combat-1",
          field: "img",
          path: "worlds/w/combat/goblin-missing.webp"
        },
        {
          docType: "CombatantGroup",
          parent: "combat-1",
          field: "img",
          path: "worlds/w/combat/pack-missing.webp"
        },
        { docType: "Card", parent: "cards-1", field: "back.img", path: "worlds/w/cards/back-missing.webp" },
        {
          docType: "Card",
          parent: "cards-1",
          field: "faces.1.img",
          path: "worlds/w/cards/ace-alt-missing.webm"
        }
      ]
        .map(key)
        .sort()
    );
    expect(result.total).toBe(10);
    expect(result.hasMore).toBe(false);
  });

  it("reports a missing playlist sound with docType/parent/field per acceptance", async () => {
    const result = await runFileAudit({ scope: ["playlist"] });

    expect(result.broken).toEqual([
      {
        docType: "PlaylistSound",
        id: "s1",
        name: "War Drums",
        field: "path",
        path: "worlds/w/audio/drums-missing.mp3",
        parent: "pl-1"
      }
    ]);

    expect(result.checkedRefs).toBe(2);
    expect(result.total).toBe(1);
  });

  it("lands an https:// actor img in skipped (public-or-external), never broken", async () => {
    const result = await runFileAudit({ scope: ["actor"] });
    const external = result.skipped.find((s) => s.path === "https://portraits.example/hero.png");
    expect(external).toEqual({
      path: "https://portraits.example/hero.png",
      reason: "public-or-external",
      count: 1
    });
    expect(result.broken.some((ref) => ref.path === "https://portraits.example/hero.png")).toBe(false);
  });

  it("treats a core icons/** ref as public-or-external, not broken", async () => {
    const result = await runFileAudit({ scope: ["scene"] });
    const icon = result.skipped.find((s) => s.path === "icons/svg/mystery-man.svg");
    expect(icon).toEqual({ path: "icons/svg/mystery-man.svg", reason: "public-or-external", count: 1 });
  });

  it("audits the table scope: result img refs are walked, the DEFAULT d20 icon is skipped", async () => {
    const result = await runFileAudit({ scope: ["table"] });

    expect(result.skipped.find((s) => s.path === "icons/svg/d20-grey.svg")).toEqual({
      path: "icons/svg/d20-grey.svg",
      reason: "public-or-external",
      count: 1
    });
    expect(result.broken).toEqual([
      {
        docType: "TableResult",
        id: "r1",
        name: "Sword",
        field: "img",
        path: "worlds/w/tables/sword-missing.webp",
        parent: "table-1"
      }
    ]);

    expect(result.checkedRefs).toBe(2);
    expect(result.total).toBe(1);
  });

  it("does NOT false-flag a CACHE-BUSTED table/result img (the query is stripped before the check)", async () => {
    globalThis.game = {
      ready: true,
      scenes: [],
      actors: [],
      items: [],
      journal: [],
      playlists: [],
      macros: [],
      tables: [
        makeDoc({
          _id: "table-q",
          name: "Cache busted",
          img: "worlds/w/tables/cover.webp?1762953012",
          results: [{ _id: "rq", name: "Row", img: "worlds/w/tables/row.webp?v=2" }]
        })
      ]
    };
    installFilePicker({
      "worlds/w/tables": ["worlds/w/tables/cover.webp", "worlds/w/tables/row.webp"]
    });

    const result = await runFileAudit({ scope: ["table"] });
    expect(result.broken).toEqual([]);
    expect(result.skipped).toEqual([]);

    expect(result.checkedRefs).toBe(2);
  });

  it("treats nue/canvas/toolclips public-source roots as public-or-external, never browsed", async () => {
    const refs = [
      {
        docType: "Scene",
        id: "s",
        name: null,
        field: "background.src",
        path: "nue/defaultscene/fvtt-background.webp"
      },
      {
        docType: "Token",
        id: "t",
        name: null,
        field: "texture.src",
        path: "canvas/tokens/rings-bronze.webp"
      },
      {
        docType: "JournalEntryPage",
        id: "p",
        name: null,
        field: "src",
        path: "toolclips/tools/drawing-rect.webm"
      }
    ];
    installFilePicker({});
    const { broken, checkedRefs, skipped } = await checkAuditRefs(refs, {});
    expect(broken).toEqual([]);
    expect(checkedRefs).toBe(0);
    expect(globalThis.foundry.applications.apps.FilePicker.implementation.browse).not.toHaveBeenCalled();
    for (const path of refs.map((r) => r.path)) {
      expect(skipped.find((s) => s.path === path)).toEqual({ path, reason: "public-or-external", count: 1 });
    }
  });

  it("does NOT report an encoded-stored vs decoded-referenced pair as broken", async () => {
    const result = await runFileAudit({ scope: ["actor"] });

    expect(result.broken.some((ref) => ref.path === "worlds/w/actors/my portrait.png")).toBe(false);
  });

  it("canonicalizes the browse entry side too, so a decoded listing entry still matches an encoded ref", async () => {
    const ref = {
      docType: "AmbientSound",
      id: "snd-y",
      name: "Track",
      field: "path",
      path: "worlds/w/misc/report%20final.txt"
    };
    installFilePicker({ "worlds/w/misc": ["worlds/w/misc/report final.txt"] });
    const { broken, checkedRefs } = await checkAuditRefs([ref], {});
    expect(broken).toEqual([]);
    expect(checkedRefs).toBe(1);
  });

  it("reports a genuinely-missing ref as broken even when a differently-encoded sibling exists", async () => {
    const ref = {
      docType: "AmbientSound",
      id: "snd-x",
      name: "Track",
      field: "path",
      path: "worlds/w/misc/report final.txt"
    };
    installFilePicker({ "worlds/w/misc": ["worlds/w/misc/report%2520final.txt"] });
    const { broken, checkedRefs } = await checkAuditRefs([ref], {});
    expect(broken).toEqual([ref]);
    expect(checkedRefs).toBe(1);
  });

  it("keeps the tally invariant: totalRefsWalked == checkedRefs + sum(skipped.count)", async () => {
    const scopeSet = new Set(["scene", "actor", "item", "journal", "playlist", "macro", "table", "combat"]);
    const refs = collectAuditRefs(globalThis.game, scopeSet);
    const { checkedRefs, skipped } = await checkAuditRefs(refs, {});
    const skippedTotal = skipped.reduce((sum, entry) => sum + entry.count, 0);
    expect(checkedRefs + skippedTotal).toBe(refs.length);
  });

  it("audits the combat scope: combatant AND group img refs are walked, img-less rows contribute none", async () => {
    const result = await runFileAudit({ scope: ["combat"] });
    const key = (ref) => `${ref.docType}:${ref.parent ?? ""}:${ref.field}:${ref.path}`;
    expect(result.broken.map(key).sort()).toEqual(
      [
        {
          docType: "Combatant",
          id: "c1",
          name: "Goblin",
          field: "img",
          path: "worlds/w/combat/goblin-missing.webp",
          parent: "combat-1"
        },
        {
          docType: "CombatantGroup",
          id: "g1",
          name: "Pack",
          field: "img",
          path: "worlds/w/combat/pack-missing.webp",
          parent: "combat-1"
        }
      ]
        .map(key)
        .sort()
    );

    expect(result.checkedRefs).toBe(3);
    expect(result.total).toBe(2);

    expect(result.broken.some((ref) => ref.docType === "Combat")).toBe(false);
  });

  it("audits the cards scope: the stack img, back.img AND the DOUBLY-NESTED faces[].img, indexed", async () => {
    const result = await runFileAudit({ scope: ["cards"] });
    expect(result.broken).toEqual([
      {
        docType: "Card",
        id: "cd1",
        name: "Ace",
        field: "back.img",
        path: "worlds/w/cards/back-missing.webp",
        parent: "cards-1"
      },
      {
        docType: "Card",
        id: "cd1",
        name: "Ace",

        field: "faces.1.img",
        path: "worlds/w/cards/ace-alt-missing.webm",
        parent: "cards-1"
      }
    ]);

    expect(result.checkedRefs).toBe(3);
    expect(result.total).toBe(2);

    const skippedPaths = result.skipped
      .filter((entry) => entry.reason === "public-or-external")
      .map((entry) => entry.path)
      .sort();
    expect(skippedPaths).toEqual(["icons/svg/card-hand.svg", "icons/svg/card-joker.svg"]);

    expect(result.broken.some((ref) => ref.field === "img" && ref.docType === "Card")).toBe(false);
  });

  it("collectAuditRefs reports the stack's OWN img under docType Cards, from SOURCE", () => {
    const refs = collectAuditRefs(globalThis.game, new Set(["cards"]));
    const self = refs.filter((ref) => ref.docType === "Cards");
    expect(self).toEqual([
      { docType: "Cards", id: "cards-1", name: "Poker Deck", field: "img", path: "icons/svg/card-hand.svg" }
    ]);

    const backRefs = refs.filter((ref) => ref.field === "back.img");
    expect(backRefs).toHaveLength(1);
    expect(backRefs[0].path).toBe("worlds/w/cards/back-missing.webp");
  });

  it("paginates the broken list only", async () => {
    const page1 = await runFileAudit({ limit: 2, offset: 0 });
    expect(page1.broken.length).toBe(2);
    expect(page1.total).toBe(10);
    expect(page1.hasMore).toBe(true);

    const page2 = await runFileAudit({ limit: 2, offset: 2 });
    expect(page2.broken.length).toBe(2);
    expect(page2.hasMore).toBe(true);

    const page3 = await runFileAudit({ limit: 2, offset: 4 });
    expect(page3.broken.length).toBe(2);
    expect(page3.hasMore).toBe(true);

    const page4 = await runFileAudit({ limit: 2, offset: 6 });
    expect(page4.broken.length).toBe(2);
    expect(page4.hasMore).toBe(true);

    const page5 = await runFileAudit({ limit: 2, offset: 8 });
    expect(page5.broken.length).toBe(2);
    expect(page5.hasMore).toBe(false);
  });

  it("filters by scope (item-only audits only world item img)", async () => {
    const result = await runFileAudit({ scope: ["item"] });

    expect(result.broken).toEqual([]);
    expect(result.checkedRefs).toBe(1);
    expect(result.checkedFiles).toBe(1);
  });

  it("marks refs in an inconclusive (permission-denied) directory as skipped, not broken", async () => {
    globalThis.game.macros = [makeDoc({ _id: "macro-x", name: "Locked", img: "worlds/w/locked/thing.png" })];

    globalThis.foundry.applications.apps.FilePicker.implementation = {
      browse: vi.fn(async () => {
        throw new Error("You do not have permission to browse this directory");
      })
    };
    const result = await runFileAudit({ scope: ["macro"] });
    expect(result.broken).toEqual([]);
    expect(result.skipped).toContainEqual({
      path: "worlds/w/locked/thing.png",
      reason: "unbrowsable",
      count: 1
    });
    expect(result.checkedRefs).toBe(0);
  });

  it("reports refs in a missing (deleted/moved) directory as broken, not skipped", async () => {
    globalThis.game.macros = [makeDoc({ _id: "macro-y", name: "Gone", img: "worlds/w/deleted/thing.png" })];

    const result = await runFileAudit({ scope: ["macro"] });
    expect(result.broken).toEqual([
      {
        docType: "Macro",
        id: "macro-y",
        name: "Gone",
        field: "img",
        path: "worlds/w/deleted/thing.png"
      }
    ]);
    expect(result.skipped.some((s) => s.reason === "unbrowsable")).toBe(false);
    expect(result.checkedRefs).toBe(1);
    expect(result.checkedFiles).toBe(1);
  });

  it("does NOT count a directory at a ref's path as a present file", async () => {
    globalThis.game.macros = [
      makeDoc({ _id: "macro-d", name: "DirRef", img: "worlds/w/macros/roll-ok.png" })
    ];
    globalThis.foundry.applications.apps.FilePicker.implementation = {
      browse: vi.fn(async (_source, target) => ({
        target,

        dirs: ["worlds/w/macros/roll-ok.png"],
        files: []
      }))
    };
    const result = await runFileAudit({ scope: ["macro"] });
    expect(result.broken.map((r) => r.path)).toEqual(["worlds/w/macros/roll-ok.png"]);
  });

  it("reports refs beyond the directory cap as skipped audit-cap", async () => {
    globalThis.game = {
      ready: true,
      scenes: [],
      actors: [],
      items: [
        makeDoc({ _id: "i-a", name: "A", img: "worlds/w/aaa/a.png" }),
        makeDoc({ _id: "i-b", name: "B", img: "worlds/w/bbb/b.png" }),
        makeDoc({ _id: "i-c", name: "C", img: "worlds/w/ccc/c.png" })
      ],
      journal: [],
      playlists: [],
      macros: []
    };
    installFilePicker({
      "worlds/w/aaa": [],
      "worlds/w/bbb": [],
      "worlds/w/ccc": []
    });

    const result = await runFileAudit({ scope: ["item"], maxDirs: 1 });
    const capSkips = result.skipped.filter((s) => s.reason === "audit-cap");
    expect(capSkips.reduce((sum, s) => sum + s.count, 0)).toBe(2);

    expect(result.checkedRefs).toBe(1);
    expect(result.broken.map((r) => r.path)).toEqual(["worlds/w/aaa/a.png"]);
  });

  it("skips a randomImg wildcard `*` ref instead of falsely reporting it broken", async () => {
    globalThis.game = {
      ready: true,
      scenes: [],
      actors: [
        makeDoc({
          _id: "actor-w",
          name: "Goblin",
          prototypeToken: { texture: { src: "worlds/w/tokens/goblin*.webp" } },
          items: []
        })
      ],
      items: [],
      journal: [],
      playlists: [],
      macros: []
    };
    installFilePicker({
      "worlds/w/tokens": ["worlds/w/tokens/goblin1.webp", "worlds/w/tokens/goblin2.webp"]
    });

    const result = await runFileAudit({ scope: ["actor"] });
    expect(result.broken).toEqual([]);
    expect(result.skipped).toContainEqual({
      path: "worlds/w/tokens/goblin*.webp",
      reason: "wildcard",
      count: 1
    });

    expect(result.checkedRefs).toBe(0);
  });

  it("skips a randomImg wildcard `?` ref instead of falsely reporting it broken", async () => {
    globalThis.game = {
      ready: true,
      scenes: [],
      actors: [
        makeDoc({
          _id: "actor-q",
          name: "Goblin",
          prototypeToken: { texture: { src: "worlds/w/tokens/goblin?.webp" } },
          items: []
        })
      ],
      items: [],
      journal: [],
      playlists: [],
      macros: []
    };
    installFilePicker({
      "worlds/w/tokens": ["worlds/w/tokens/goblin1.webp", "worlds/w/tokens/goblin2.webp"]
    });

    const result = await runFileAudit({ scope: ["actor"] });
    expect(result.broken).toEqual([]);
    expect(result.skipped).toContainEqual({
      path: "worlds/w/tokens/goblin?.webp",
      reason: "wildcard",
      count: 1
    });
    expect(result.checkedRefs).toBe(0);
  });

  it("skips a DOTTED randomImg wildcard (`goblin.v2?.webp`) instead of checking a path nothing references", async () => {
    globalThis.game = {
      ready: true,
      scenes: [],
      actors: [
        makeDoc({
          _id: "actor-dotted-q",
          name: "Goblin",
          prototypeToken: { texture: { src: "worlds/w/tokens/goblin.v2?.webp" } },
          items: []
        })
      ],
      items: [],
      journal: [],
      playlists: [],
      macros: []
    };

    installFilePicker({
      "worlds/w/tokens": ["worlds/w/tokens/goblin.v2a.webp", "worlds/w/tokens/goblin.v2b.webp"]
    });

    const result = await runFileAudit({ scope: ["actor"] });
    expect(result.broken).toEqual([]);
    expect(result.skipped).toContainEqual({
      path: "worlds/w/tokens/goblin.v2?.webp",
      reason: "wildcard",
      count: 1
    });
    expect(result.checkedRefs).toBe(0);
  });

  it("strips an UPPERCASE-extension cache-buster (core's matcher is case-insensitive)", async () => {
    globalThis.game = {
      ready: true,
      scenes: [
        makeDoc({
          _id: "scene-upper-q",
          name: "Map",
          background: { src: "worlds/w.v2/maps/MAP.WEBP?v=2" },
          tiles: [],
          tokens: [],
          sounds: [],
          notes: [],
          drawings: [],
          templates: []
        })
      ],
      actors: [],
      items: [],
      journal: [],
      playlists: [],
      macros: []
    };

    installFilePicker({ "worlds/w.v2/maps": ["worlds/w.v2/maps/MAP.WEBP"] });

    const result = await runFileAudit({ scope: ["scene"] });
    expect(result.broken).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.checkedRefs).toBe(1);
  });

  it("treats a trailing `?` cache-buster query as a concrete ref, not a wildcard", async () => {
    globalThis.game = {
      ready: true,
      scenes: [
        makeDoc({
          _id: "scene-q",
          name: "Map",
          background: { src: "worlds/w/maps/map.webp?v=2" },
          tiles: [],
          tokens: [],
          sounds: [],
          notes: [],
          drawings: [],
          templates: []
        })
      ],
      actors: [],
      items: [],
      journal: [],
      playlists: [],
      macros: []
    };
    installFilePicker({ "worlds/w/maps": ["worlds/w/maps/map.webp"] });

    const result = await runFileAudit({ scope: ["scene"] });
    expect(result.broken).toEqual([]);
    expect(result.skipped).toEqual([]);

    expect(result.checkedRefs).toBe(1);
  });

  it("reports a query-string ref broken when its base file is missing", async () => {
    globalThis.game = {
      ready: true,
      scenes: [
        makeDoc({
          _id: "scene-qm",
          name: "Map",
          background: { src: "worlds/w/maps/gone.webp?v=7" },
          tiles: [],
          tokens: [],
          sounds: [],
          notes: [],
          drawings: [],
          templates: []
        })
      ],
      actors: [],
      items: [],
      journal: [],
      playlists: [],
      macros: []
    };
    installFilePicker({ "worlds/w/maps": ["worlds/w/maps/map.webp"] });

    const result = await runFileAudit({ scope: ["scene"] });
    expect(result.broken).toEqual([
      {
        docType: "Scene",
        id: "scene-qm",
        name: "Map",
        field: "background.src",
        path: "worlds/w/maps/gone.webp?v=7"
      }
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.checkedRefs).toBe(1);
  });

  it("strips a query string containing a slash before the existence check", async () => {
    globalThis.game = {
      ready: true,
      scenes: [
        makeDoc({
          _id: "scene-qs",
          name: "Map",
          background: { src: "worlds/w/maps/gone.webp?variant=/v2" },
          tiles: [],
          tokens: [],
          sounds: [],
          notes: [],
          drawings: [],
          templates: []
        })
      ],
      actors: [],
      items: [],
      journal: [],
      playlists: [],
      macros: []
    };
    installFilePicker({ "worlds/w/maps": ["worlds/w/maps/map.webp"] });

    const result = await runFileAudit({ scope: ["scene"] });

    expect(result.broken).toEqual([
      {
        docType: "Scene",
        id: "scene-qs",
        name: "Map",
        field: "background.src",
        path: "worlds/w/maps/gone.webp?variant=/v2"
      }
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.checkedRefs).toBe(1);
  });

  it("strips a query string whose value itself contains a `?` at the FIRST `?`", async () => {
    globalThis.game = {
      ready: true,
      scenes: [
        makeDoc({
          _id: "scene-q2",
          name: "Map",
          background: { src: "worlds/w/maps/gone.webp?fallback=thumb.png?v=2" },
          tiles: [],
          tokens: [],
          sounds: [],
          notes: [],
          drawings: [],
          templates: []
        })
      ],
      actors: [],
      items: [],
      journal: [],
      playlists: [],
      macros: []
    };
    installFilePicker({ "worlds/w/maps": ["worlds/w/maps/map.webp"] });

    const result = await runFileAudit({ scope: ["scene"] });

    expect(result.broken).toEqual([
      {
        docType: "Scene",
        id: "scene-q2",
        name: "Map",
        field: "background.src",
        path: "worlds/w/maps/gone.webp?fallback=thumb.png?v=2"
      }
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.checkedRefs).toBe(1);
  });

  it("pins the shared directory cap constant", () => {
    expect(AUDIT_FILES_MAX_DIRS).toBe(500);
  });
});
