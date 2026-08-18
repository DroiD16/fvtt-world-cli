import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";

import { createSearchHandlers } from "../scripts/handlers/search.js";
import {
  SEARCH_EMBEDDED_CHILDREN,
  SEARCH_TYPE_TEXT_FIELDS,
  SEARCH_WORLD_COLLECTIONS,
  buildSearchQueryOptions,
  buildWorldCorpus,
  buildWorldRefKey,
  compareSearchHits,
  createSearchEngine,
  invalidateOnPackSetChange,
  measureSearchIndexBytes,
  packSetSignature,
  parsePackRefKey,
  resolveWorldRef,
  searchUpdateKeysFor
} from "../scripts/lib/search-index.js";
import { extractDocumentText } from "../scripts/lib/search-text.js";
import {
  ERROR_CODES,
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  SEARCH_CORPUS_STATUSES,
  SEARCH_INDEXED_TYPES,
  SEARCH_RESULT_DEFAULT_LIMIT,
  SEARCH_RESULT_SOURCES,
  estimateSearchIndexBytes
} from "../scripts/generated/protocol.js";

/**
 * @param {string} documentType
 * @param {string} id
 * @param {string} name
 * @param {{ live?: string, liveData?: Record<string, unknown>, pack?: string, children?: Record<string, any[]>, source?: Record<string, unknown> }} [options]
 */
function makeDoc(documentType, id, name, { live, liveData, pack, children = {}, source: extra } = {}) {
  const source = { _id: id, name, ...(extra ?? {}) };
  const doc = {
    documentName: documentType,
    id,
    _source: source,

    name: live ?? name,
    toObject: () => ({ ...source }),
    ...(liveData ?? {}),
    ...(pack ? { pack } : {})
  };
  for (const [collection, docs] of Object.entries(children)) {
    doc[collection] = makeCollection(docs);
  }
  return doc;
}

function makeCollection(docs = []) {
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  return {
    get size() {
      return byId.size;
    },
    get contents() {
      return [...byId.values()];
    },
    get(id) {
      return byId.get(id) ?? null;
    },
    delete(id) {
      byId.delete(id);
    },
    set(id, doc) {
      byId.set(id, doc);
    },
    [Symbol.iterator]() {
      return byId.values()[Symbol.iterator]();
    }
  };
}

/**
 * @param {string} collection
 * @param {string} documentName
 * @param {{_id: string, name: string}[]} rows
 * @param {{label?: string}} [options]
 */
function makePack(collection, documentName, rows, { label } = {}) {
  const index = makeCollection(rows.map((row) => ({ ...row, id: row._id })));
  const pack = {
    id: collection,
    collection,
    documentName,
    metadata: { id: collection, label: label ?? collection },
    index,
    getIndex: vi.fn(async () => index)
  };
  return pack;
}

function makeGame() {
  const actor = makeDoc("Actor", "actor-1", "Veldrin Shadowstep", {
    children: {
      items: [
        makeDoc("Item", "item-embed-1", "Shadow Dagger", {
          children: { effects: [makeDoc("ActiveEffect", "fx-1", "Shadow Cloak")] }
        })
      ],
      effects: [
        makeDoc("ActiveEffect", "fx-actor-1", "Sneaky Aura", {
          source: {
            description:
              "<p>Тайная аура даёт ёлка бонус 🎲 контрабандистам, zcyrbody держится до рассвета.</p>"
          },

          liveData: { description: "<p>zliveonlydesc enriched by the system</p>" }
        })
      ]
    }
  });
  const journal = makeDoc("JournalEntry", "journal-1", "Saltmarsh Notes", {
    children: {
      pages: [
        makeDoc("JournalEntryPage", "page-1", "Smuggler Rumours", {
          source: {
            text: {
              content:
                "<p>Docks <b>zbodyword</b>ledger &amp; ink, 5 &lt; 10 &gt; 3.</p><script>alert('zscriptbody')</script><style>.a{color:red}/*zstylebody*/</style><!-- zcommentbody -->",
              format: 1
            }
          }
        }),

        makeDoc("JournalEntryPage", "page-md", "Markdown Notes", {
          source: { text: { markdown: "## Ledger\n\nthe *zmarkdownonly* entry", format: 2 } }
        })
      ],
      categories: [makeDoc("JournalEntryCategory", "cat-1", "Handouts", { live: "Unnamed Category" })]
    }
  });
  const scene = makeDoc("Scene", "scene-1", "Dungeon Level 2", {
    children: {
      tokens: [makeDoc("Token", "token-1", "Goblin Scout")],
      regions: [
        makeDoc("Region", "region-1", "Trap Hall", {
          children: {
            behaviors: [
              makeDoc("RegionBehavior", "beh-1", "Pause Game", {
                source: { type: "executeScript", system: { source: "console.log('zbehaviorsource')" } }
              })
            ]
          }
        })
      ],

      sounds: [makeDoc("AmbientSound", "ambient-1", "Waterfall")]
    }
  });
  const playlist = makeDoc("Playlist", "playlist-1", "Tavern Ambience", {
    children: { sounds: [makeDoc("PlaylistSound", "sound-1", "Lute Loop")] }
  });
  const table = makeDoc("RollTable", "table-1", "Loot Table", {
    children: {
      results: [
        makeDoc("TableResult", "result-1", "Coin Hoard", { live: "Longsword" }),
        makeDoc("TableResult", "result-blank", "", { live: "Backfilled Name" }),

        makeDoc("TableResult", "result-text", "", {
          live: "Another Backfill",
          source: { description: "<p>zblankrowtext: a purse of coins</p>" }
        })
      ]
    }
  });

  const cards = makeDoc("Cards", "cards-1", "Winter Deck", {
    live: "Winter Deck (derived)",
    children: { cards: [makeDoc("Card", "card-1", "Ace of Winter", { live: "Flipped Face" })] }
  });

  const macro = makeDoc("Macro", "macro-1", "Whisper Party", {
    source: { command: "console.log('zmacrobody')", type: "script" }
  });

  for (const doc of [actor, journal, scene, macro]) {
    Object.defineProperty(doc, "flags", {
      get() {
        throw new Error("world.search must never read a document's flags");
      }
    });
    Object.defineProperty(doc, "ownership", {
      get() {
        throw new Error("world.search must never read a document's ownership");
      }
    });
  }

  return {
    ready: true,
    world: { id: "world-1", title: "Search Test World" },
    user: { id: "gm", name: "GM", isGM: true },
    actors: makeCollection([actor]),
    items: makeCollection([
      makeDoc("Item", "item-world-1", "Longsword of Dawn", {
        source: {
          system: {
            description: { value: "<p>A gleaming zsystemword blade forged at dawn</p>" },
            identifier: "abcdefghijklmnop",
            img: "icons/svg/sword.webp",
            link: "https://example.com/zurlword",
            properties: { rarity: { label: "zdeepword rarity" } },

            weight: 3
          },

          flags: { mymod: { apiKey: "zflagsecret" } },
          ownership: { default: 3 }
        },

        liveData: {
          system: {
            description: { value: "<p>A zlivesystemword blade, derived at prepare time</p>" },
            properties: { rarity: { label: "zlivedeepword rarity" } }
          }
        }
      })
    ]),
    journal: makeCollection([journal]),
    scenes: makeCollection([scene]),
    macros: makeCollection([macro]),
    playlists: makeCollection([playlist]),
    tables: makeCollection([table]),
    cards: makeCollection([cards]),
    folders: makeCollection([
      makeDoc("Folder", "folder-1", "Shared Folder Name"),
      makeDoc("Folder", "folder-2", "Shared Folder Name"),
      makeDoc("Folder", "folder-3", "Shared Folder Name")
    ]),
    packs: makeCollection([]),

    get settings() {
      throw new Error("world.search must never read game.settings");
    },
    get users() {
      throw new Error("world.search must never read game.users");
    },
    get messages() {
      throw new Error("world.search must never read game.messages");
    }
  };
}

const MEASURED_DOCUMENT_NAMES = Object.freeze({
  BaseActiveEffect: "ActiveEffect",
  BaseActor: "Actor",
  BaseCard: "Card",
  BaseCards: "Cards",
  BaseFolder: "Folder",
  BaseItem: "Item",
  BaseJournalEntry: "JournalEntry",
  BaseJournalEntryCategory: "JournalEntryCategory",
  BaseJournalEntryPage: "JournalEntryPage",
  BaseMacro: "Macro",
  BasePlaylist: "Playlist",
  BasePlaylistSound: "PlaylistSound",
  BaseRegion: "Region",
  BaseRegionBehavior: "RegionBehavior",
  BaseRollTable: "RollTable",
  BaseScene: "Scene",
  BaseTableResult: "TableResult",
  BaseToken: "Token"
});

/**
 * @param {any} doc
 * @param {string} parentUuid
 */
function stampFixtureUuids(doc, parentUuid = "") {
  const own = `${doc.documentName}.${doc.id}`;
  doc.uuid = parentUuid ? `${parentUuid}.${own}` : own;
  const stamped = [doc];
  for (const child of SEARCH_EMBEDDED_CHILDREN[doc.documentName] ?? []) {
    for (const childDoc of doc[child.collection]?.contents ?? []) {
      stamped.push(...stampFixtureUuids(childDoc, doc.uuid));
    }
  }
  return stamped;
}

/** @param {any} doc */
function isIndexableFixtureDoc(doc) {
  if (String(doc?._source?.name ?? "").trim() !== "") {
    return true;
  }
  const extracted = extractDocumentText(doc, SEARCH_TYPE_TEXT_FIELDS[doc.documentName] ?? []);
  return extracted.text !== "" || extracted.systemText !== "";
}

function makeHooks() {
  const listeners = new Map();
  return {
    on: vi.fn((event, callback) => {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event).push(callback);
    }),
    fire(event, ...args) {
      for (const callback of listeners.get(event) ?? []) {
        callback(...args);
      }
    },
    get events() {
      return [...listeners.keys()];
    }
  };
}

/** @param {{caps?: any, hooks?: any}} [options] */
function makeSearch({ caps, hooks } = {}) {
  const handlers = createSearchHandlers({ ...(caps ? { caps } : {}), ...(hooks ? { hooks } : {}) });
  return handlers["world.search"];
}

/**
 * @param {(params: any) => Promise<any>} handler
 * @param {any} params
 * @returns {Promise<any>}
 */
async function search(handler, params) {
  return handler({ query: "xx", ...params });
}

/**
 * @param {(params: any) => Promise<any>} handler
 * @param {any} params
 * @returns {Promise<any>}
 */
async function searchError(handler, params) {
  try {
    await handler(params);
  } catch (error) {
    return /** @type {any} */ (error);
  }
  throw new Error("expected world.search to throw");
}

describe("world.search index core", () => {
  beforeEach(() => {
    globalThis.game = makeGame();
  });

  afterEach(() => {
    delete globalThis.game;
    vi.restoreAllMocks();
  });

  it("vendors MiniSearch 7.2.0 BYTE-FAITHFULLY apart from the header", () => {
    const SENTINEL = "// --- BEGIN VENDORED minisearch@7.2.0 dist/es/index.js ---\n";
    const file = readFileSync(new URL("../scripts/vendor/minisearch.mjs", import.meta.url), "utf8");
    const start = file.indexOf(SENTINEL);
    expect(start, "the vendor sentinel line must be present").toBeGreaterThan(-1);
    const body = file.slice(start + SENTINEL.length);
    expect(createHash("sha256").update(body, "utf8").digest("hex")).toBe(
      "0393b3ba253b809d5e55707c7b0875ef9b518a296a006c6739b28876e154edb3"
    );
    expect(Buffer.byteLength(body, "utf8")).toBe(78014);

    expect(body.match(/^import[\s{]/gm)).toBeNull();
    expect(body.includes("require(")).toBe(false);
    expect(body.match(/^export /gm)).toHaveLength(1);
  });

  it("derives the indexed set from the enumeration tables — both directions", () => {
    const enumerated = new Set(Object.keys(SEARCH_WORLD_COLLECTIONS));
    for (const children of Object.values(SEARCH_EMBEDDED_CHILDREN)) {
      for (const child of children) {
        enumerated.add(child.documentType);
      }
    }
    expect([...enumerated].sort()).toEqual([...SEARCH_INDEXED_TYPES].sort());

    for (const parent of Object.keys(SEARCH_EMBEDDED_CHILDREN)) {
      expect(SEARCH_INDEXED_TYPES, `${parent} must be an indexed type`).toContain(parent);
    }

    expect(Object.keys(SEARCH_TYPE_TEXT_FIELDS).sort()).toEqual([...SEARCH_INDEXED_TYPES].sort());
  });

  it("derives the invalidation keys from BOTH tables (name + text fields + embedded collections)", () => {
    expect(searchUpdateKeysFor("JournalEntryPage")).toEqual(["name", "text"]);
    expect(searchUpdateKeysFor("TableResult")).toEqual(["name", "description"]);
    expect(searchUpdateKeysFor("Macro")).toEqual(["name"]);

    expect(searchUpdateKeysFor("Card")).toEqual(["name", "description"]);

    for (const [parentType, children] of Object.entries(SEARCH_EMBEDDED_CHILDREN)) {
      const keys = searchUpdateKeysFor(parentType);
      expect(keys[0], `${parentType} must always dirty on name`).toBe("name");
      for (const field of SEARCH_TYPE_TEXT_FIELDS[parentType]) {
        expect(keys, `${parentType} must dirty on its own text field ${field}`).toContain(field);
      }
      for (const child of children) {
        expect(
          keys,
          `${parentType} must dirty on its ${child.collection} collection key (a parent-routed ${child.documentType} write raises no ${child.documentType} hook)`
        ).toContain(child.collection);
      }
    }

    expect(searchUpdateKeysFor("Actor")).toEqual(["name", "system", "items", "effects"]);
    expect(searchUpdateKeysFor("Scene")).toEqual(["name", "tokens", "regions"]);
  });

  it("never touches the excluded collections or per-document flags/ownership while building", async () => {
    const handler = makeSearch();
    const result = await search(handler, { query: "veldrin" });
    expect(result.results).toHaveLength(1);
    expect(result.index.world.status).toBe("ready");

    const nested = await search(handler, { query: "cloak" });
    expect(nested.results[0].name).toBe("Shadow Cloak");
    expect(nested.results[0].parents[0].name).toBe("Veldrin Shadowstep");
  });

  it("constructs a world refKey exactly as Foundry builds a uuid, for every nesting depth", () => {
    expect(buildWorldRefKey([{ documentType: "Scene", id: "s1" }])).toBe("world:Scene.s1");
    expect(
      buildWorldRefKey([
        { documentType: "Scene", id: "s1" },
        { documentType: "Token", id: "t1" }
      ])
    ).toBe("world:Scene.s1.Token.t1");
    expect(
      buildWorldRefKey([
        { documentType: "Actor", id: "a1" },
        { documentType: "Item", id: "i1" },
        { documentType: "ActiveEffect", id: "e1" }
      ])
    ).toBe("world:Actor.a1.Item.i1.ActiveEffect.e1");
    expect(
      buildWorldRefKey([
        { documentType: "JournalEntry", id: "j1" },
        { documentType: "JournalEntryPage", id: "p1" }
      ])
    ).toBe("world:JournalEntry.j1.JournalEntryPage.p1");
  });

  it("builds every world refKey as `world:` + the document's own uuid, for every indexed type", () => {
    const measured = new Set(/** @type {string[]} */ (Object.values(MEASURED_DOCUMENT_NAMES)));
    expect(/** @type {string[]} */ ([...SEARCH_INDEXED_TYPES]).filter((type) => !measured.has(type))).toEqual(
      []
    );

    const game = globalThis.game;
    const documents = [];
    for (const collectionName of Object.values(SEARCH_WORLD_COLLECTIONS)) {
      for (const doc of game[collectionName].contents) {
        documents.push(...stampFixtureUuids(doc));
      }
    }

    expect(documents.filter((doc) => !measured.has(doc.documentName))).toEqual([]);
    expect(new Set(documents.map((doc) => doc.documentName))).toEqual(new Set(SEARCH_INDEXED_TYPES));

    const corpus = buildWorldCorpus(game, { maxBytes: 32 * 1024 * 1024, maxEntries: 100_000 });

    expect(corpus.overflow ?? null, "the fixture corpus must not overflow").toBeNull();
    const builtRefKeys = new Set(
      /** @type {string[]} */ (Object.values(/** @type {any} */ (corpus.index).toJSON().documentIds))
    );

    const expectedRefKeys = new Set(
      documents.filter(isIndexableFixtureDoc).map((doc) => `world:${doc.uuid}`)
    );

    expect(expectedRefKeys.size, "the §6 predicate must admit exactly the 24 fixture entries").toBe(24);
    expect(builtRefKeys.size).toBe(24);
    expect([...builtRefKeys].sort()).toEqual([...expectedRefKeys].sort());

    for (const type of SEARCH_INDEXED_TYPES) {
      const uuids = documents
        .filter((doc) => doc.documentName === type && isIndexableFixtureDoc(doc))
        .map((doc) => `world:${doc.uuid}`);
      expect(uuids.length, `no indexable ${type} fixture`).toBeGreaterThan(0);
      expect(
        uuids.some((refKey) => builtRefKeys.has(refKey)),
        `${type} refKey is not its uuid`
      ).toBe(true);
    }
  });

  it("resolves a refKey only through the SAME parent/child pairings the enumeration used", () => {
    const game = globalThis.game;
    expect(resolveWorldRef(game, "world:Actor.actor-1")?.documentType).toBe("Actor");
    expect(resolveWorldRef(game, "world:Actor.actor-1.Item.item-embed-1")?.id).toBe("item-embed-1");

    expect(resolveWorldRef(game, "world:Actor.actor-1.PlaylistSound.sound-1")).toBeNull();

    expect(game.scenes.get("scene-1").sounds.get("ambient-1")?.name).toBe("Waterfall");
    expect(resolveWorldRef(game, "world:Scene.scene-1.PlaylistSound.ambient-1")).toBeNull();

    expect(resolveWorldRef(game, "world:Playlist.playlist-1.PlaylistSound.sound-1")?.id).toBe("sound-1");

    expect(resolveWorldRef(game, "world:Token.token-1")).toBeNull();

    expect(resolveWorldRef(game, "Actor.actor-1")).toBeNull();
    expect(resolveWorldRef(game, "world:Actor")).toBeNull();
    expect(resolveWorldRef(game, "world:Actor.")).toBeNull();
    expect(resolveWorldRef(game, "world:Actor.nope")).toBeNull();
  });

  it("does NOT enumerate a Scene's AmbientSound collection, even though Playlist uses the same name", async () => {
    const handler = makeSearch();
    const result = await search(handler, { query: "waterfall" });
    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);

    expect(result.index.world.entryCount).toBe(24);
  });

  it("parses a pack refKey at the FIRST colon, since a pack id cannot contain one", () => {
    expect(parsePackRefKey("pack:world.monsters:abc123")).toEqual({
      packId: "world.monsters",
      entryId: "abc123"
    });
    expect(parsePackRefKey("world:Actor.actor-1")).toBeNull();
    expect(parsePackRefKey("pack:world.monsters")).toBeNull();
    expect(parsePackRefKey("pack::abc")).toBeNull();
    expect(parsePackRefKey("pack:world.monsters:")).toBeNull();
  });

  it("indexes every indexed type present in the fixture and addresses each by its refKey", async () => {
    const handler = makeSearch();

    const probes = {
      Actor: "veldrin",
      Item: "dagger",
      ActiveEffect: "cloak",
      JournalEntry: "saltmarsh",
      JournalEntryPage: "rumours",
      JournalEntryCategory: "handouts",
      Scene: "dungeon",
      Token: "goblin",
      Region: "trap",
      RegionBehavior: "pause",
      Macro: "whisper",
      Playlist: "tavern",
      PlaylistSound: "lute",
      RollTable: "loot",
      TableResult: "hoard",
      Cards: "winter deck",
      Card: "ace",
      Folder: "shared"
    };
    for (const [documentType, query] of Object.entries(probes)) {
      const result = await search(handler, { query, limit: 5 });
      expect(
        result.results.map((ref) => ref.documentType),
        `${documentType} must be findable by ${query}`
      ).toContain(documentType);
    }
    const nested = await search(handler, { query: "cloak" });
    expect(nested.results[0].refKey).toBe("world:Actor.actor-1.Item.item-embed-1.ActiveEffect.fx-1");
    expect(nested.results[0].parents).toEqual([
      { documentType: "Actor", id: "actor-1", name: "Veldrin Shadowstep" },
      { documentType: "Item", id: "item-embed-1", name: "Shadow Dagger" }
    ]);
  });

  it("projects a world ref with every pinned key, snippet null in name mode", async () => {
    const handler = makeSearch();
    const result = await search(handler, { query: "goblin" });
    expect(result.results).toHaveLength(1);
    const ref = result.results[0];
    expect(Object.keys(ref).sort()).toEqual([
      "documentType",
      "id",
      "name",
      "pack",
      "parents",
      "refKey",
      "resolved",
      "score",
      "snippet",
      "source"
    ]);
    expect(ref).toMatchObject({
      refKey: "world:Scene.scene-1.Token.token-1",
      source: "world",
      documentType: "Token",
      id: "token-1",
      name: "Goblin Scout",
      resolved: true,
      pack: null,

      snippet: null
    });
    expect(typeof ref.score).toBe("number");
    expect(ref.parents).toEqual([{ documentType: "Scene", id: "scene-1", name: "Dungeon Level 2" }]);
  });

  it("echoes mode / includeCompendia / source, with source null when absent", async () => {
    const handler = makeSearch();
    const plain = await search(handler, { query: "goblin" });
    expect(plain.mode).toBe("name");
    expect(plain.includeCompendia).toBe(false);
    expect(plain.source).toBeNull();
    const scoped = await search(handler, { query: "goblin", source: "world" });
    expect(scoped.source).toBe("world");
  });

  it("reports the STORED name, never the derived one — and a flip dirties nothing", async () => {
    const handler = makeSearch({ hooks: makeHooks() });

    const card = await search(handler, { query: "ace" });
    expect(card.results[0].name).toBe("Ace of Winter");

    const face = await search(handler, { query: "flipped" });
    expect(face.results).toHaveLength(0);

    const row = await search(handler, { query: "hoard" });
    expect(row.results[0].name).toBe("Coin Hoard");

    const category = await search(handler, { query: "handouts" });
    expect(category.results[0].name).toBe("Handouts");

    expect(card.results[0].parents).toEqual([{ documentType: "Cards", id: "cards-1", name: "Winter Deck" }]);
  });

  it("indexes and WINDOWS full-mode text from `_source`, never from a live accessor", async () => {
    const handler = makeSearch();

    const stored = await search(handler, { query: "zsystemword", mode: "full" });
    expect(stored.results.map((ref) => ref.refKey)).toEqual(["world:Item.item-world-1"]);
    expect(stored.results[0].snippet.field).toBe("systemText");
    expect(stored.results[0].snippet.text).toContain("gleaming zsystemword blade forged at dawn");

    expect(stored.results[0].snippet.text).not.toContain("zlivesystemword");
    const storedDesc = await search(handler, { query: "zcyrbody", mode: "full" });
    expect(storedDesc.results.map((ref) => ref.refKey)).toEqual([
      "world:Actor.actor-1.ActiveEffect.fx-actor-1"
    ]);
    expect(storedDesc.results[0].snippet.text).toContain("контрабандистам");
    expect(storedDesc.results[0].snippet.text).not.toContain("zliveonlydesc");

    for (const marker of ["zlivesystemword", "zlivedeepword", "zliveonlydesc"]) {
      expect((await search(handler, { query: marker, mode: "full" })).total, marker).toBe(0);
    }
  });

  it("does NOT rebuild when a card is flipped (face is not an invalidation key)", async () => {
    const hooks = makeHooks();
    const handler = makeSearch({ hooks });
    await search(handler, { query: "ace" });

    hooks.fire("updateCard", globalThis.game.cards.get("cards-1").cards.get("card-1"), { face: 1 });
    const after = await search(handler, { query: "ace" });
    expect(after.index.world.builtThisCall).toBe(false);
    expect(after.results[0].name).toBe("Ace of Winter");
  });

  it("drops a blank-named document only when it has NO full-mode text either", async () => {
    const handler = makeSearch();
    const result = await search(handler, { query: "loot" });
    expect(result.results.map((ref) => ref.refKey)).toEqual(["world:RollTable.table-1"]);

    const byBackfill = await search(handler, { query: "backfilled" });
    expect(byBackfill.results).toHaveLength(0);
    expect((await search(handler, { query: "zblankrowtext" })).results).toHaveLength(0);

    const full = await search(handler, { query: "zblankrowtext", mode: "full" });
    expect(full.results.map((ref) => ref.refKey)).toEqual([
      "world:RollTable.table-1.TableResult.result-text"
    ]);

    expect(full.results[0].name).toBe("");

    expect(result.index.world.entryCount).toBe(24);
    expect(result.index.world.indexedChars).toBeGreaterThan(0);

    globalThis.game.folders.set("folder-extra", makeDoc("Folder", "folder-extra", "Extra Folder"));
    globalThis.game.folders.set("folder-blank", makeDoc("Folder", "folder-blank", "   "));
    const fresh = makeSearch();
    expect((await search(fresh, { query: "loot" })).index.world.entryCount).toBe(25);
  });

  it("applies `types` as the engine's own filter, so `total` counts filtered-in matches only", async () => {
    const handler = makeSearch();
    const unfiltered = await search(handler, { query: "longsword" });

    expect(unfiltered.total).toBe(1);
    const filtered = await search(handler, { query: "longsword", types: ["Actor"] });
    expect(filtered.total).toBe(0);
    expect(filtered.results).toEqual([]);
    expect(filtered.index.world.matchCount).toBe(0);
    const kept = await search(handler, { query: "longsword", types: ["Item", "Actor"] });
    expect(kept.total).toBe(1);
    expect(kept.results[0].documentType).toBe("Item");
  });

  it("combines terms with AND, not the library default OR", async () => {
    globalThis.game.folders.set("folder-scout", makeDoc("Folder", "folder-scout", "Scout Camp"));
    const handler = makeSearch();
    const both = await search(handler, { query: "goblin scout", limit: 10 });
    expect(both.results.map((ref) => ref.refKey)).toEqual(["world:Scene.scene-1.Token.token-1"]);
    expect(both.total).toBe(1);

    expect((await search(handler, { query: "scout", limit: 10 })).total).toBe(2);
  });

  it("matches every term as a PREFIX, the one channel a short query has", async () => {
    globalThis.game.folders.set("folder-prefix-ru", makeDoc("Folder", "folder-prefix-ru", "Манисенто"));
    const handler = makeSearch();
    const refKeys = async (term) =>
      (await search(handler, { query: term, limit: 10 })).results.map((ref) => ref.refKey);

    expect(await refKeys("dagg")).toEqual(["world:Actor.actor-1.Item.item-embed-1"]);

    expect(await refKeys("longsw")).toEqual(["world:Item.item-world-1"]);

    expect(await refKeys("Манис")).toEqual(["world:Folder.folder-prefix-ru"]);
  });

  it("tokenizes and folds NON-ASCII text: \\p{P} separators, ё↔е, NFC normalization", async () => {
    const nfdName = "Йоль";

    expect(nfdName.normalize("NFC")).not.toBe(nfdName);
    expect(nfdName.normalize("NFC")).toBe("Йоль");

    globalThis.game.folders.set("ru-hyphen", makeDoc("Folder", "ru-hyphen", "Гоблин-разведчик"));
    globalThis.game.folders.set("ru-dash", makeDoc("Folder", "ru-dash", "Сайлас Аспид — главарь"));
    globalThis.game.folders.set("ru-yo", makeDoc("Folder", "ru-yo", "Ёлка"));
    globalThis.game.folders.set("ru-ye", makeDoc("Folder", "ru-ye", "Елка"));
    globalThis.game.folders.set("ru-nfd", makeDoc("Folder", "ru-nfd", nfdName));
    const handler = makeSearch();
    const refKeys = async (term) =>
      (await search(handler, { query: term, limit: 10 })).results.map((ref) => ref.refKey).sort();

    expect(await refKeys("разведчик")).toEqual(["world:Folder.ru-hyphen"]);
    expect(await refKeys("гоблин")).toContain("world:Folder.ru-hyphen");

    const engine = createSearchEngine();
    engine.add({
      refKey: "probe:dash",
      documentType: "Folder",
      name: "Сайлас Аспид — главарь",
      text: "",
      systemText: ""
    });
    expect(engine.search("—", buildSearchQueryOptions({ mode: "name" }))).toEqual([]);

    expect(engine.search("главарь", buildSearchQueryOptions({ mode: "name" })).map((hit) => hit.id)).toEqual([
      "probe:dash"
    ]);
    expect(await refKeys("главарь")).toEqual(["world:Folder.ru-dash"]);

    expect(await refKeys("ёлка")).toEqual(["world:Folder.ru-ye", "world:Folder.ru-yo"]);
    expect(await refKeys("елка")).toEqual(["world:Folder.ru-ye", "world:Folder.ru-yo"]);

    expect(await refKeys("Йоль")).toEqual(["world:Folder.ru-nfd"]);
    expect(await refKeys(nfdName)).toEqual(["world:Folder.ru-nfd"]);
  });

  it("bounds fuzzy matching at min(6, round(0.2 × term code points)) — both boundaries", async () => {
    const base40 = "abcdefghijklmnopqrstuvwxyzabcdefghijklmn";
    const base22 = "abcdefghijklmnopqrstuv";
    expect([base40.length, base22.length]).toEqual([40, 22]);
    const substituteTail = (term, count) => term.slice(0, term.length - count) + "0123456789".slice(0, count);
    globalThis.game.folders.set("folder-40", makeDoc("Folder", "folder-40", base40));
    globalThis.game.folders.set("folder-22", makeDoc("Folder", "folder-22", base22));
    const handler = makeSearch();
    const hits = async (term) =>
      (await search(handler, { query: term, limit: 10 })).results.map((ref) => ref.id);

    expect(await hits(substituteTail(base40, 6))).toEqual(["folder-40"]);
    expect(await hits(substituteTail(base40, 7))).toEqual([]);

    expect(await hits(substituteTail(base22, 4))).toEqual(["folder-22"]);
    expect(await hits(substituteTail(base22, 5))).toEqual([]);

    globalThis.game.folders.set("folder-floor-4", makeDoc("Folder", "folder-floor-4", "vzqp"));
    globalThis.game.folders.set("folder-floor-5", makeDoc("Folder", "folder-floor-5", "vvqqp"));
    const withFloors = makeSearch();
    const floorHits = async (term) =>
      (await search(withFloors, { query: term, limit: 10 })).results.map((ref) => ref.id);
    expect(await floorHits("vzqz")).toEqual([]);
    expect(await floorHits("vvqqz")).toEqual(["folder-floor-5"]);

    const options = buildSearchQueryOptions({ mode: "name" });
    expect(options.fuzzy("abcd")).toBe(false);
    expect(options.fuzzy("abcde")).toBe(1);
    expect(options.fuzzy(base22)).toBe(4);
    expect(options.fuzzy(base40)).toBe(6);
    expect("maxFuzzy" in options).toBe(false);
  });

  it("counts the fuzzy floor and budget in CODE POINTS, so an astral character counts ONCE", async () => {
    globalThis.game.folders.set("astral-three", makeDoc("Folder", "astral-three", "🎯🎯🎲"));
    globalThis.game.folders.set("astral-one-edit", makeDoc("Folder", "astral-one-edit", "🎲🎲🎲🎲🎯"));
    globalThis.game.folders.set("astral-two-edits", makeDoc("Folder", "astral-two-edits", "🎲🎲🎲🎲😀"));
    const handler = makeSearch();
    const hits = async (term) =>
      (await search(handler, { query: term, limit: 10 })).results.map((ref) => ref.id);

    expect(["🎯🎯🎲".length, [..."🎯🎯🎲"].length]).toEqual([6, 3]);
    expect("🎯🎯🎲".startsWith("🎯🎯🎯")).toBe(false);

    expect(await hits("🎯🎯🎯")).toEqual([]);

    expect(await hits("🎯🎯🎲")).toEqual(["astral-three"]);

    expect(await hits("🎲🎲🎲🎲🎲")).toEqual(["astral-one-edit"]);
  });

  it("clamps a term at 64 code units WITHOUT splitting a surrogate pair", () => {
    const engine = createSearchEngine();
    engine.add({
      refKey: "probe:clamp",
      documentType: "Folder",

      name: `${"a".repeat(63)}\u{1F600}`,

      text: `${"b".repeat(62)}\u{1F600}`,
      systemText: ""
    });
    const terms = /** @type {any[]} */ (engine.toJSON().index).map(([term]) => term);
    const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
    expect(terms.filter((term) => LONE.test(term))).toEqual([]);

    expect(terms).toContain("a".repeat(63));
    expect(terms).toContain(`${"b".repeat(62)}\u{1F600}`);
  });

  it("orders a tie group by documentType then refKey, and pages it deterministically", async () => {
    globalThis.game.macros.set("macro-shared", makeDoc("Macro", "macro-shared", "Shared Folder Name"));
    const handler = makeSearch();
    const all = await search(handler, { query: "shared folder name", limit: 10 });
    expect(all.total).toBe(4);
    expect(all.results.map((ref) => ref.refKey)).toEqual([
      "world:Folder.folder-1",
      "world:Folder.folder-2",
      "world:Folder.folder-3",
      "world:Macro.macro-shared"
    ]);

    expect(new Set(all.results.map((ref) => ref.score)).size).toBe(1);

    const first = await search(handler, { query: "shared folder name", limit: 2, offset: 0 });
    const second = await search(handler, { query: "shared folder name", limit: 2, offset: 2 });
    expect(first.results.map((ref) => ref.refKey)).toEqual([
      "world:Folder.folder-1",
      "world:Folder.folder-2"
    ]);
    expect(second.results.map((ref) => ref.refKey)).toEqual([
      "world:Folder.folder-3",
      "world:Macro.macro-shared"
    ]);
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(false);
  });

  it("compareSearchHits is a total order: score DESC, then documentType ASC, then refKey ASC", () => {
    const rows = [
      { score: 1, documentType: "Item", refKey: "world:Item.b" },
      { score: 2, documentType: "Item", refKey: "world:Item.a" },
      { score: 1, documentType: "Actor", refKey: "world:Actor.z" },
      { score: 1, documentType: "Item", refKey: "world:Item.a" }
    ];
    expect([...rows].sort(compareSearchHits).map((row) => row.refKey)).toEqual([
      "world:Item.a",
      "world:Actor.z",
      "world:Item.a",
      "world:Item.b"
    ]);
  });

  it("defaults `limit` to 20 rather than returning every match", async () => {
    for (let i = 0; i < 25; i += 1) {
      globalThis.game.folders.set(`bulk-${i}`, makeDoc("Folder", `bulk-${i}`, `Bulkname Folder ${i}`));
    }
    const handler = makeSearch();
    const result = await search(handler, { query: "bulkname" });
    expect(result.total).toBe(25);
    expect(result.results).toHaveLength(SEARCH_RESULT_DEFAULT_LIMIT);
    expect(result.hasMore).toBe(true);
  });

  it("KEEPS a ref whose document was deleted after the build, so total stays coherent", async () => {
    globalThis.game.folders.set("folder-doomed", makeDoc("Folder", "folder-doomed", "Doomed Folder"));
    const handler = makeSearch();
    const built = await search(handler, { query: "doomed" });
    expect(built.total).toBe(1);
    expect(built.results[0].resolved).toBe(true);

    globalThis.game.folders.delete("folder-doomed");
    const after = await search(handler, { query: "doomed" });
    expect(after.total).toBe(1);

    expect(after.total).toBe(after.results.length + 0);
    expect(after.results[0]).toMatchObject({
      refKey: "world:Folder.folder-doomed",
      resolved: false,
      name: null,
      parents: [],
      snippet: null,

      id: "folder-doomed"
    });
    expect(typeof after.results[0].score).toBe("number");
  });

  describe("field-aware invalidation", () => {
    it("registers create/update/delete for every indexed type plus updateCompendium — on first search, not at construction", async () => {
      const hooks = makeHooks();
      const handler = makeSearch({ hooks });

      expect(hooks.on).not.toHaveBeenCalled();
      await search(handler, { query: "goblin" });
      expect(hooks.events.sort()).toEqual(
        [
          ...SEARCH_INDEXED_TYPES.flatMap((type) => [`create${type}`, `update${type}`, `delete${type}`]),
          "updateCompendium"
        ].sort()
      );

      const callsAfterFirst = hooks.on.mock.calls.length;
      await search(handler, { query: "goblin" });
      expect(hooks.on.mock.calls.length).toBe(callsAfterFirst);
    });

    it("does NOT dirty the corpus for a diff with no indexed key (a token x/y move)", async () => {
      const hooks = makeHooks();
      const handler = makeSearch({ hooks });
      const first = await search(handler, { query: "goblin" });
      expect(first.index.world.builtThisCall).toBe(true);
      const token = globalThis.game.scenes.get("scene-1").tokens.get("token-1");

      hooks.fire("updateToken", token, { x: 350, y: 425 });

      hooks.fire("updateToken", token, {});
      hooks.fire("updateScene", globalThis.game.scenes.get("scene-1"), { navName: "L2" });
      const second = await search(handler, { query: "goblin" });
      expect(second.index.world.builtThisCall).toBe(false);
      expect(second.index.world.generation).toBe(first.index.world.generation);
      expect(second.index.world.stale).toBe(false);
    });

    it("DOES dirty the corpus for name / text / system diffs, and for create + delete", async () => {
      const hooks = makeHooks();
      const handler = makeSearch({ hooks });
      const actor = globalThis.game.actors.get("actor-1");
      let generation = (await search(handler, { query: "goblin" })).index.world.generation;
      for (const [event, doc, diff] of [
        ["updateToken", globalThis.game.scenes.get("scene-1").tokens.get("token-1"), { name: "Goblin Boss" }],
        ["updateActor", actor, { system: { hp: 5 } }],
        [
          "updateJournalEntryPage",
          globalThis.game.journal.get("journal-1").pages.get("page-1"),
          { text: { content: "x" } }
        ],
        [
          "updateTableResult",
          globalThis.game.tables.get("table-1").results.get("result-1"),
          { description: "x" }
        ],
        ["createActor", actor, undefined],
        ["deleteActor", actor, undefined]
      ]) {
        hooks.fire(/** @type {string} */ (event), doc, diff);
        const result = await search(handler, { query: "goblin" });
        expect(result.index.world.builtThisCall, `${event} must dirty the world corpus`).toBe(true);
        expect(result.index.world.generation).toBeGreaterThan(generation);
        generation = result.index.world.generation;
      }
    });

    it("DOES dirty when an embedded row is written through its PARENT's update (collection key)", async () => {
      const hooks = makeHooks();
      const handler = makeSearch({ hooks });
      const actor = globalThis.game.actors.get("actor-1");
      const journal = globalThis.game.journal.get("journal-1");

      let generation = (await search(handler, { query: "dagger" })).index.world.generation;
      for (const [event, doc, diff] of [
        ["updateActor", actor, { items: [{ _id: "item-embed-1", name: "Renamed Dagger" }] }],
        ["updateActor", actor, { effects: [{ _id: "fx-actor-1", name: "Renamed Aura" }] }],
        ["updateJournalEntry", journal, { pages: [{ _id: "page-1", name: "Newpagename" }] }],
        ["updateJournalEntry", journal, { categories: [{ _id: "cat-1", name: "Renamed Category" }] }],
        [
          "updateScene",
          globalThis.game.scenes.get("scene-1"),
          { tokens: [{ _id: "token-1", name: "Renamed Token" }] }
        ],
        [
          "updateScene",
          globalThis.game.scenes.get("scene-1"),
          { regions: [{ _id: "region-1", name: "Renamed" }] }
        ],
        [
          "updateRegion",
          globalThis.game.scenes.get("scene-1").regions.get("region-1"),
          { behaviors: [{ _id: "beh-1", name: "Renamed Behavior" }] }
        ],
        [
          "updatePlaylist",
          globalThis.game.playlists.get("playlist-1"),
          { sounds: [{ _id: "sound-1", name: "X" }] }
        ],
        [
          "updateRollTable",
          globalThis.game.tables.get("table-1"),
          { results: [{ _id: "result-1", name: "X" }] }
        ],
        ["updateCards", globalThis.game.cards.get("cards-1"), { cards: [{ _id: "card-1", name: "X" }] }]
      ]) {
        hooks.fire(/** @type {string} */ (event), doc, diff);
        const result = await search(handler, { query: "dagger" });
        expect(
          result.index.world.builtThisCall,
          `${event} with a ${Object.keys(/** @type {object} */ (diff)).join("/")} diff must dirty the world corpus`
        ).toBe(true);
        expect(result.index.world.generation).toBeGreaterThan(generation);
        generation = result.index.world.generation;
      }
    });

    it("finds a child renamed through its PARENT's update, end to end", async () => {
      const hooks = makeHooks();
      const handler = makeSearch({ hooks });
      const first = await search(handler, { query: "halberd" });
      expect(first.results).toHaveLength(0);

      const item = globalThis.game.actors.get("actor-1").items.get("item-embed-1");
      item._source.name = "Brandnew Halberd";
      item.name = "Brandnew Halberd";
      hooks.fire("updateActor", globalThis.game.actors.get("actor-1"), {
        items: [{ _id: "item-embed-1", name: "Brandnew Halberd" }]
      });
      const second = await search(handler, { query: "halberd" });
      expect(second.results.map((ref) => ref.refKey)).toEqual(["world:Actor.actor-1.Item.item-embed-1"]);
      expect(second.results[0].name).toBe("Brandnew Halberd");
      expect(second.index.world.builtThisCall).toBe(true);
      expect(second.index.world.stale).toBe(false);
    });

    it("treats an UNREADABLE diff as dirty (fail-safe direction)", async () => {
      const hooks = makeHooks();
      const handler = makeSearch({ hooks });
      await search(handler, { query: "goblin" });
      hooks.fire("updateActor", globalThis.game.actors.get("actor-1"), undefined);
      expect((await search(handler, { query: "goblin" })).index.world.builtThisCall).toBe(true);
    });

    it("routes a PACK document's event to the compendium corpus, not the world one", async () => {
      globalThis.game.packs = makeCollection([
        makePack("world.monsters", "Actor", [{ _id: "pack-actor-1", name: "Bullywug Chief" }])
      ]);
      const hooks = makeHooks();
      const handler = makeSearch({ hooks });
      const first = await search(handler, { query: "bullywug", includeCompendia: true });
      expect(first.results.map((ref) => ref.refKey)).toEqual(["pack:world.monsters:pack-actor-1"]);

      hooks.fire("updateActor", { pack: "world.monsters", name: "x" }, { name: "Bullywug Boss" });
      const second = await search(handler, { query: "bullywug", includeCompendia: true });
      expect(second.index.world.builtThisCall).toBe(false);
      expect(second.index.world.generation).toBe(first.index.world.generation);
      expect(second.index.compendium.builtThisCall).toBe(true);

      hooks.fire("updateCompendium");
      const third = await search(handler, { query: "bullywug", includeCompendia: true });
      expect(third.index.compendium.builtThisCall).toBe(true);
      expect(third.index.world.builtThisCall).toBe(false);
    });
  });

  describe("build serialization", () => {
    function makeGatedPack() {
      let release = () => {};
      const gate = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      const rows = [{ _id: "pack-entry-1", name: "Gated Chief" }];
      const index = makeCollection(rows.map((row) => ({ ...row, id: row._id })));
      const pack = {
        collection: "world.gated",
        documentName: "Actor",
        metadata: { id: "world.gated", label: "Gated" },
        index,
        getIndex: vi.fn(async () => {
          await gate;
          return index;
        })
      };
      return { pack, release: () => release() };
    }

    it("serializes two concurrent searches onto ONE build and never reads a half-built index", async () => {
      const { pack, release } = makeGatedPack();
      globalThis.game.packs = makeCollection([pack]);
      const handler = makeSearch();
      const first = handler({ query: "gated", includeCompendia: true });
      const second = handler({ query: "gated", includeCompendia: true });
      release();
      const [a, b] = /** @type {any[]} */ (await Promise.all([first, second]));

      expect(pack.getIndex).toHaveBeenCalledTimes(1);
      expect(a.results.map((ref) => ref.refKey)).toEqual(["pack:world.gated:pack-entry-1"]);
      expect(b.results).toEqual(a.results);
      expect(a.index.compendium.builtThisCall).toBe(true);
      expect(b.index.compendium.builtThisCall).toBe(true);
    });

    it("reports stale:true when a write lands DURING the build, and rebuilds on the next search", async () => {
      const { pack, release } = makeGatedPack();
      globalThis.game.packs = makeCollection([pack]);
      const hooks = makeHooks();
      const handler = makeSearch({ hooks });
      const pending = handler({ query: "gated", includeCompendia: true });

      while (pack.getIndex.mock.calls.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      hooks.fire("updateCompendium");
      release();
      const result = /** @type {any} */ (await pending);
      expect(result.index.compendium.builtThisCall).toBe(true);
      expect(result.index.compendium.stale).toBe(true);

      const next = await search(handler, { query: "gated", includeCompendia: true });
      expect(pack.getIndex).toHaveBeenCalledTimes(2);
      expect(next.index.compendium.builtThisCall).toBe(true);
      expect(next.index.compendium.stale).toBe(false);
    });

    it("a build that THROWS is not cached: the next search retries it", async () => {
      let attempts = 0;
      const items = makeCollection([makeDoc("Item", "item-flaky-1", "Flaky Blade")]);
      globalThis.game.items = {
        get contents() {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("world items unavailable");
          }
          return items.contents;
        },
        get: (id) => items.get(id)
      };
      const handler = makeSearch();
      const failed = await searchError(handler, { query: "flaky" });
      expect(failed.message).toContain("world items unavailable");
      const recovered = await search(handler, { query: "flaky" });
      expect(attempts).toBe(2);
      expect(recovered.results.map((ref) => ref.refKey)).toEqual(["world:Item.item-flaky-1"]);
      expect(recovered.index.world.status).toBe("ready");
    });

    it("ISOLATES a persistently failing pack index: its rows are lost, the corpus is not", async () => {
      const healthy = makePack("world.monsters", "Actor", [{ _id: "pack-actor-1", name: "Bullywug Chief" }]);
      const broken = makePack("world.corrupt", "Actor", [{ _id: "pack-actor-2", name: "Bullywug Shaman" }]);
      broken.getIndex = vi.fn(async () => {
        throw new Error("pack database is corrupt");
      });
      globalThis.game.packs = makeCollection([healthy, broken]);
      const handler = makeSearch();
      const result = await search(handler, { query: "bullywug", includeCompendia: true });
      expect(result.index.compendium.status).toBe("ready");

      expect(result.results.map((ref) => ref.refKey)).toEqual(["pack:world.monsters:pack-actor-1"]);
      expect(result.index.compendium.failedPackCount).toBe(1);

      expect(result.index.compendium.skippedPackCount).toBe(0);

      const again = await search(handler, { query: "bullywug", includeCompendia: true });
      expect(again.results).toHaveLength(1);
      expect(again.index.compendium.failedPackCount).toBe(1);
    });
  });

  describe("pack-set invalidation (no hook exists)", () => {
    beforeEach(() => {
      globalThis.game.packs = makeCollection([
        makePack("world.monsters", "Actor", [{ _id: "pack-actor-1", name: "Bullywug Chief" }])
      ]);
    });

    it("rebuilds when a pack is ADDED with no hook fired (the Duplicate Compendium case)", async () => {
      const hooks = makeHooks();
      const handler = makeSearch({ hooks });
      const first = await search(handler, { query: "bullywug", includeCompendia: true });
      expect(first.results.map((ref) => ref.refKey)).toEqual(["pack:world.monsters:pack-actor-1"]);

      const added = makePack("world.monsters-copy", "Actor", [
        { _id: "pack-actor-9", name: "Bullywug Chieftain" }
      ]);
      globalThis.game.packs.set("world.monsters-copy", added);

      const second = await search(handler, { query: "bullywug", includeCompendia: true });
      expect(second.index.compendium.builtThisCall).toBe(true);
      expect(second.results.map((ref) => ref.refKey)).toEqual([
        "pack:world.monsters-copy:pack-actor-9",
        "pack:world.monsters:pack-actor-1"
      ]);
      expect(second.index.compendium.entryCount).toBe(2);

      expect(second.index.compendium.generation).toBeGreaterThan(first.index.compendium.generation);

      expect(hooks.events).not.toContain("createCompendium");
    });

    it("rebuilds when a pack is DELETED with no hook fired, so its rows stop being reported", async () => {
      const handler = makeSearch();
      const doomed = makePack("world.doomed", "Actor", [{ _id: "pack-actor-2", name: "Bullywug Shaman" }]);
      globalThis.game.packs.set("world.doomed", doomed);
      const first = await search(handler, { query: "bullywug", includeCompendia: true });
      expect(first.results).toHaveLength(2);

      globalThis.game.packs.delete("world.doomed");
      const second = await search(handler, { query: "bullywug", includeCompendia: true });
      expect(second.index.compendium.builtThisCall).toBe(true);

      expect(second.results.map((ref) => ref.refKey)).toEqual(["pack:world.monsters:pack-actor-1"]);
      expect(second.index.compendium.entryCount).toBe(1);
    });

    it("rebuilds when a pack is REPLACED under the SAME id, which the id set alone cannot see", async () => {
      const hooks = makeHooks();
      const handler = makeSearch({ hooks });
      const first = await search(handler, { query: "bullywug", includeCompendia: true });
      expect(first.results.map((ref) => ref.refKey)).toEqual(["pack:world.monsters:pack-actor-1"]);
      const signatureBefore = packSetSignature(globalThis.game);

      globalThis.game.packs.delete("world.monsters");
      globalThis.game.packs.set(
        "world.monsters",
        makePack("world.monsters", "Actor", [{ _id: "pack-actor-7", name: "Bullywug Warlord" }], {
          label: "Saltmarsh Monsters"
        })
      );

      expect(packSetSignature(globalThis.game)).toBe(signatureBefore);

      const second = await search(handler, { query: "bullywug", includeCompendia: true });
      expect(second.index.compendium.builtThisCall).toBe(true);
      expect(second.results.map((ref) => ref.refKey)).toEqual(["pack:world.monsters:pack-actor-7"]);
      expect(second.index.compendium.generation).toBeGreaterThan(first.index.compendium.generation);
      expect(hooks.events).not.toContain("createCompendium");
    });

    it("reports a same-id replacement from invalidateOnPackSetChange, and only ONCE", () => {
      const corpus = { packSignature: null, packIdentities: null, dirtyGeneration: 0 };
      const original = { collection: "world.loot" };
      const game = { packs: [original] };
      expect(invalidateOnPackSetChange(corpus, game)).toBe(false);
      expect(invalidateOnPackSetChange(corpus, game)).toBe(false);
      expect(corpus.dirtyGeneration).toBe(0);

      game.packs = [{ collection: "world.loot" }];
      expect(invalidateOnPackSetChange(corpus, game)).toBe(true);
      expect(corpus.dirtyGeneration).toBe(1);
      expect(invalidateOnPackSetChange(corpus, game)).toBe(false);
      expect(corpus.dirtyGeneration).toBe(1);
    });

    it("does not call an id-less pack a replacement (it cannot be tracked, and the count still moves)", () => {
      const corpus = { packSignature: null, packIdentities: null, dirtyGeneration: 0 };
      const game = { packs: [{ documentName: "Actor" }] };
      expect(invalidateOnPackSetChange(corpus, game)).toBe(false);
      game.packs = [{ documentName: "Actor" }];
      expect(invalidateOnPackSetChange(corpus, game)).toBe(false);
      expect(corpus.dirtyGeneration).toBe(0);

      game.packs = [{ documentName: "Actor" }, { documentName: "Item" }];
      expect(invalidateOnPackSetChange(corpus, game)).toBe(true);
    });

    it("does NOT rebuild when the pack set is unchanged (the poll is not a per-search rebuild)", async () => {
      const handler = makeSearch();
      const pack = globalThis.game.packs.get("world.monsters");
      await search(handler, { query: "bullywug", includeCompendia: true });
      const second = await search(handler, { query: "bullywug", includeCompendia: true });
      expect(second.index.compendium.builtThisCall).toBe(false);
      expect(pack.getIndex).toHaveBeenCalledTimes(1);
    });

    it("busts a CACHED overflow when the pack set changed, since the cache is per generation", async () => {
      const handler = makeSearch({
        caps: {
          world: { maxBytes: 32 * 1024 * 1024, maxEntries: 100_000 },
          compendium: { maxBytes: 32 * 1024 * 1024, maxEntries: 1 }
        }
      });
      globalThis.game.packs.set(
        "world.extra",
        makePack("world.extra", "Actor", [{ _id: "pack-actor-3", name: "Bullywug Brute" }])
      );
      const pack = globalThis.game.packs.get("world.monsters");
      await searchError(handler, { query: "bullywug", includeCompendia: true });
      await searchError(handler, { query: "bullywug", includeCompendia: true });

      expect(pack.getIndex).toHaveBeenCalledTimes(1);

      globalThis.game.packs.delete("world.extra");
      const recovered = await search(handler, { query: "bullywug", includeCompendia: true });
      expect(pack.getIndex).toHaveBeenCalledTimes(2);
      expect(recovered.index.compendium.status).toBe("ready");
    });

    it('does not touch pack state at all for a call that will not query it (source:"world")', async () => {
      const handler = makeSearch();
      await search(handler, { query: "bullywug", includeCompendia: true });

      globalThis.game.packs.set(
        "world.extra",
        makePack("world.extra", "Actor", [{ _id: "pack-actor-3", name: "Bullywug Brute" }])
      );
      const worldOnly = await search(handler, {
        query: "goblin",
        includeCompendia: true,
        source: "world"
      });
      expect(worldOnly.index.compendium).toBeNull();

      const packSide = await search(handler, { query: "bullywug", includeCompendia: true });
      expect(packSide.index.compendium.builtThisCall).toBe(true);
      expect(packSide.index.compendium.entryCount).toBe(2);
    });

    it("moves the signature when the pack COUNT moves even with no readable pack id", () => {
      const one = packSetSignature({ packs: [{ documentName: "Actor" }] });
      const two = packSetSignature({ packs: [{ documentName: "Actor" }, { documentName: "Item" }] });
      expect(one).not.toBe(two);

      const ab = packSetSignature({ packs: [{ collection: "a.x" }, { collection: "b.y" }] });
      const ba = packSetSignature({ packs: [{ collection: "b.y" }, { collection: "a.x" }] });
      expect(ab).toBe(ba);
    });
  });

  describe("compendium corpus", () => {
    beforeEach(() => {
      globalThis.game.packs = makeCollection([
        makePack("world.monsters", "Actor", [{ _id: "pack-actor-1", name: "Bullywug Chief" }], {
          label: "Saltmarsh Monsters"
        }),

        makePack("world.adventures", "Adventure", [{ _id: "adv-1", name: "Bullywug Adventure" }])
      ]);
    });

    it("builds nothing unless the search will query it (includeCompendia:false)", async () => {
      const handler = makeSearch();
      const result = await search(handler, { query: "bullywug" });
      expect(result.index.compendium).toBeNull();
      expect(result.total).toBe(0);
      for (const pack of globalThis.game.packs) {
        expect(pack.getIndex).not.toHaveBeenCalled();
      }
    });

    it("SECTIONS world rows before pack rows and reports per-corpus matchCounts", async () => {
      globalThis.game.actors.set("actor-bully", makeDoc("Actor", "actor-bully", "Bullywug Scout"));
      const handler = makeSearch();
      const result = await search(handler, { query: "bullywug", includeCompendia: true, limit: 10 });
      expect(result.results.map((ref) => ref.source)).toEqual(["world", "compendium"]);
      expect(result.total).toBe(2);
      expect(result.index.world.matchCount).toBe(1);
      expect(result.index.compendium.matchCount).toBe(1);
      expect(result.index.compendium.skippedPackCount).toBe(1);
    });

    it("projects a compendium ref through pack.id + id (its refKey is NOT a uuid) with a null snippet", async () => {
      const handler = makeSearch();
      const result = await search(handler, { query: "bullywug", includeCompendia: true });
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({
        refKey: "pack:world.monsters:pack-actor-1",
        source: "compendium",
        documentType: "Actor",
        id: "pack-actor-1",
        parents: [],
        pack: { id: "world.monsters", label: "Saltmarsh Monsters" },
        name: "Bullywug Chief",
        resolved: true,
        score: result.results[0].score,

        snippet: null
      });
    });

    it("gives TOKEN an empty pack section (a pack index holds primaries only)", async () => {
      globalThis.game.scenes
        .get("scene-1")
        .tokens.set("token-bully", makeDoc("Token", "token-bully", "Bullywug Token"));
      const handler = makeSearch();
      const result = await search(handler, {
        query: "bullywug",
        includeCompendia: true,
        types: ["Token"],
        limit: 10
      });
      expect(result.results.map((ref) => ref.source)).toEqual(["world"]);
      expect(result.index.compendium.matchCount).toBe(0);
    });

    it("INDEXES a v14 pack-level ActiveEffect pack instead of skipping it", async () => {
      globalThis.game.packs = makeCollection([
        makePack("world.conditions", "ActiveEffect", [{ _id: "pack-effect-1", name: "Bullywug Curse" }], {
          label: "Saltmarsh Conditions"
        })
      ]);
      const handler = makeSearch();
      const result = await search(handler, {
        query: "bullywug",
        includeCompendia: true,
        types: ["ActiveEffect"],
        limit: 10
      });
      expect(result.index.compendium.matchCount).toBe(1);
      expect(result.index.compendium.skippedPackCount).toBe(0);
      expect(result.index.compendium.failedPackCount).toBe(0);
      expect(result.results).toEqual([
        {
          refKey: "pack:world.conditions:pack-effect-1",
          source: "compendium",
          documentType: "ActiveEffect",
          id: "pack-effect-1",
          parents: [],
          pack: { id: "world.conditions", label: "Saltmarsh Conditions" },
          name: "Bullywug Curse",
          resolved: true,
          score: result.results[0]?.score,
          snippet: null
        }
      ]);
    });

    it("does not interleave sections even when the pack corpus out-scores the world corpus", async () => {
      for (let i = 0; i < 5; i += 1) {
        globalThis.game.folders.set(
          `liz-${i}`,
          makeDoc("Folder", `liz-${i}`, `Lizardfolk Camp ${i} of the Marsh`)
        );
      }
      globalThis.game.packs = makeCollection([
        makePack("world.rare", "Actor", [
          { _id: "rare-1", name: "Lizardfolk" },
          ...Array.from({ length: 10 }, (_, i) => ({ _id: `filler-${i}`, name: `Bullywug Warrior ${i}` }))
        ])
      ]);
      const handler = makeSearch();
      const worldOnly = await search(handler, { query: "lizardfolk", source: "world", limit: 10 });
      const packOnly = await search(handler, {
        query: "lizardfolk",
        includeCompendia: true,
        source: "pack",
        limit: 10
      });
      expect(
        packOnly.results[0].score,
        "fixture no longer reproduces the measured shape: the pack row must out-score every world row, or this test cannot detect interleaving"
      ).toBeGreaterThan(worldOnly.results[0].score);

      const result = await search(handler, { query: "lizardfolk", includeCompendia: true, limit: 3 });
      expect(result.index.compendium.matchCount).toBe(1);
      expect(result.results.map((ref) => ref.source)).toEqual(["world", "world", "world"]);
      expect(result.total).toBe(6);

      const straddle = await search(handler, {
        query: "lizardfolk",
        includeCompendia: true,
        limit: 3,
        offset: 3
      });
      expect(straddle.results.map((ref) => ref.source)).toEqual(["world", "world", "compendium"]);
      expect(straddle.hasMore).toBe(false);
    });
  });

  describe("the query's effective-length floor", () => {
    beforeEach(() => {
      globalThis.game.packs = makeCollection([
        makePack("world.monsters", "Actor", [{ _id: "pack-actor-1", name: "Bullywug Chief" }])
      ]);
    });

    it("refuses a query whose SEARCHABLE CONTENT is under the minimum, however it was padded", async () => {
      const handler = makeSearch();
      const padded = {
        "a ": 1, // trailing separator
        "a,": 1, // trailing punctuation, which the tokenizer splits on
        " a": 1,
        é: 1, // DECOMPOSED "é": two code points, one after the NFC both tokenizers apply
        "  ,, ": 0, // no term at all
        ",": 0
      };
      for (const [query, effectiveLength] of Object.entries(padded)) {
        const error = await searchError(handler, { query });
        expect(error.code, `query ${JSON.stringify(query)}`).toBe(ERROR_CODES.INVALID_PARAMS);
        expect(error.message).toContain("searchable character(s)");
        expect(error.details).toMatchObject({ effectiveLength, minimum: 2 });
      }
    });

    it("is NOT a per-term rule: a one-character TERM beside a longer one is legal", async () => {
      const handler = makeSearch();
      globalThis.game.actors.set("actor-a", makeDoc("Actor", "actor-a", "Sword Aspect"));
      const twoTerms = await search(handler, { query: "sword a" });
      expect(twoTerms.results.map((ref) => ref.id)).toContain("actor-a");

      expect(typeof (await search(handler, { query: "a b" })).total).toBe("number");
      expect(typeof (await search(handler, { query: "火剑" })).total).toBe("number");
    });

    it("is evaluated BEFORE any corpus is built, and before the source/includeCompendia refusal", async () => {
      const handler = makeSearch({
        caps: {
          world: { maxBytes: 32 * 1024 * 1024, maxEntries: 100_000 },
          compendium: { maxBytes: 32 * 1024 * 1024, maxEntries: 0 }
        }
      });

      Object.defineProperty(globalThis.game, "actors", {
        get() {
          throw new Error("the effective-length floor must run before the world build");
        }
      });
      const overflowed = await searchError(handler, { query: "a,", includeCompendia: true });
      expect(overflowed.code).toBe(ERROR_CODES.INVALID_PARAMS);
      for (const pack of globalThis.game.packs) {
        expect(pack.getIndex).not.toHaveBeenCalled();
      }

      const bothWrong = await searchError(handler, { query: "a,", source: "pack" });
      expect(bothWrong.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(bothWrong.message).toContain("searchable character(s)");
      expect(bothWrong.message).not.toContain("includeCompendia:true");
    });
  });

  describe("the source selector", () => {
    beforeEach(() => {
      globalThis.game.packs = makeCollection([
        makePack("world.monsters", "Actor", [{ _id: "pack-actor-1", name: "Bullywug Chief" }])
      ]);
      globalThis.game.actors.set("actor-bully", makeDoc("Actor", "actor-bully", "Bullywug Scout"));
    });

    it('refuses source:"pack" without includeCompendia:true, naming the pair verbatim', async () => {
      const handler = makeSearch();
      const error = await searchError(handler, { query: "bullywug", source: "pack" });
      expect(error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(error.message).toContain('source:"pack" requires includeCompendia:true');

      for (const pack of globalThis.game.packs) {
        expect(pack.getIndex).not.toHaveBeenCalled();
      }
    });

    it('source:"world" + includeCompendia:true must NOT BUILD the pack corpus', async () => {
      const handler = makeSearch();
      const result = await search(handler, {
        query: "bullywug",
        includeCompendia: true,
        source: "world",
        limit: 10
      });
      expect(result.index.compendium).toBeNull();
      expect(result.results.map((ref) => ref.source)).toEqual(["world"]);
      expect(result.total).toBe(1);

      for (const pack of globalThis.game.packs) {
        expect(pack.getIndex).not.toHaveBeenCalled();
      }
    });

    it('source:"pack" must NOT BUILD the world corpus', async () => {
      Object.defineProperty(globalThis.game, "actors", {
        get() {
          throw new Error('source:"pack" must not build the world corpus');
        }
      });
      const handler = makeSearch();
      const result = await search(handler, {
        query: "bullywug",
        includeCompendia: true,
        source: "pack",
        limit: 10
      });
      expect(result.index.world).toBeNull();
      expect(result.results.map((ref) => ref.source)).toEqual(["compendium"]);
      expect(result.total).toBe(1);
    });
  });

  describe("caps and their evaluation order", () => {
    const tinyCompendium = {
      world: { maxBytes: 32 * 1024 * 1024, maxEntries: 100_000 },
      compendium: { maxBytes: 32 * 1024 * 1024, maxEntries: 1 }
    };

    beforeEach(() => {
      globalThis.game.packs = makeCollection([
        makePack("world.monsters", "Actor", [
          { _id: "pack-actor-1", name: "Bullywug Chief" },
          { _id: "pack-actor-2", name: "Bullywug Shaman" }
        ])
      ]);
    });

    it("CORPUS ISOLATION: a compendium overflow refuses the compendium query and leaves world-only queries working", async () => {
      const handler = makeSearch({ caps: tinyCompendium });
      const worldOnly = await search(handler, { query: "goblin" });
      expect(worldOnly.index.compendium).toBeNull();
      expect(worldOnly.results).toHaveLength(1);

      const error = await searchError(handler, { query: "bullywug", includeCompendia: true });
      expect(error.code).toBe(ERROR_CODES.SEARCH_INDEX_OVERFLOW);
      expect(error.details).toMatchObject({
        corpus: "compendium",
        limit: "entry-count",
        cap: 1,
        observed: 2
      });

      expect(error.details.index.world.status).toBe("ready");
      expect(error.details.index.compendium.status).toBe("overflow");

      expect(error.message).toContain('source:"world"');

      const after = await search(handler, { query: "goblin" });
      expect(after.results).toHaveLength(1);
      expect(after.index.compendium).toBeNull();
    });

    it("CACHES the overflow state until the next invalidation generation", async () => {
      const hooks = makeHooks();
      const handler = makeSearch({ caps: tinyCompendium, hooks });
      const pack = globalThis.game.packs.get("world.monsters");
      await searchError(handler, { query: "bullywug", includeCompendia: true });
      expect(pack.getIndex).toHaveBeenCalledTimes(1);

      await searchError(handler, { query: "bullywug", includeCompendia: true });
      expect(pack.getIndex).toHaveBeenCalledTimes(1);

      hooks.fire("updateCompendium");
      await searchError(handler, { query: "bullywug", includeCompendia: true });
      expect(pack.getIndex).toHaveBeenCalledTimes(2);
    });

    it('makes a cached compendium overflow UNREACHABLE under source:"world" (cell 16)', async () => {
      const handler = makeSearch({ caps: tinyCompendium });
      await searchError(handler, { query: "bullywug", includeCompendia: true });

      const result = await search(handler, { query: "goblin", includeCompendia: true, source: "world" });
      expect(result.index.compendium).toBeNull();
      expect(result.index.world.status).toBe("ready");
      expect(result.results).toHaveLength(1);
    });

    it('mirrors that for a WORLD overflow under source:"pack" (cell 16b)', async () => {
      const handler = makeSearch({
        caps: { world: { maxBytes: 32 * 1024 * 1024, maxEntries: 1 }, compendium: tinyCompendium.world }
      });
      const worldFailure = await searchError(handler, { query: "goblin" });
      expect(worldFailure.code).toBe(ERROR_CODES.SEARCH_INDEX_OVERFLOW);
      expect(worldFailure.details.corpus).toBe("world");

      expect(worldFailure.message).toContain('source:"pack"');
      const result = await search(handler, {
        query: "bullywug",
        includeCompendia: true,
        source: "pack",
        limit: 10
      });
      expect(result.index.world).toBeNull();
      expect(result.results.map((ref) => ref.source)).toEqual(["compendium", "compendium"]);
    });

    it("reports an index-BYTES overflow distinctly from an entry-count one", async () => {
      const handler = makeSearch({
        caps: { world: { maxBytes: 200, maxEntries: 100_000 }, compendium: tinyCompendium.compendium }
      });
      const error = await searchError(handler, { query: "goblin" });

      expect(error.details).toMatchObject({
        corpus: "world",
        limit: "index-bytes",
        basis: "estimated",
        cap: 200
      });
      expect(error.details.observed).toBeGreaterThan(200);
    });

    it("MEASURES the finished index against the byte cap, because the estimate is not a bound", async () => {
      const denseTokens = [];
      for (let i = 0; i < 400; i += 1) {
        denseTokens.push(
          String.fromCharCode(97 + (i % 26), 97 + (Math.floor(i / 26) % 26), 97 + (Math.floor(i / 676) % 26))
        );
      }
      globalThis.game.tables.set(
        "dense-table",
        makeDoc("RollTable", "dense-table", "Dense Table", {
          source: { description: denseTokens.join(" ") }
        })
      );

      const corpus = buildWorldCorpus(globalThis.game, {
        maxBytes: 32 * 1024 * 1024,
        maxEntries: 100_000
      });
      expect(corpus.overflow ?? null, "the generous caps must not overflow").toBeNull();
      const estimated = estimateSearchIndexBytes(corpus.stats.entryCount, corpus.stats.indexedChars);
      const measured = measureSearchIndexBytes(corpus.index);
      expect(measured, "the estimate must be shown NOT to bound this corpus").toBeGreaterThan(estimated);

      const cap = measured - 1;
      expect(estimated).toBeLessThanOrEqual(cap);
      const handler = makeSearch({
        caps: { world: { maxBytes: cap, maxEntries: 100_000 }, compendium: tinyCompendium.compendium }
      });
      const error = await searchError(handler, { query: "goblin" });
      expect(error.code).toBe(ERROR_CODES.SEARCH_INDEX_OVERFLOW);
      expect(error.details).toMatchObject({
        corpus: "world",
        limit: "index-bytes",
        basis: "measured",
        cap,
        observed: measured
      });

      expect(error.details.index.world.status).toBe("overflow");
      expect(error.message).toContain("the completed index was discarded rather than published");
    });

    it("measures the finished index in UTF-8 BYTES, not UTF-16 code units", async () => {
      const engine = createSearchEngine();

      const cjk = "剑火山水風雷光闇龍虎";
      const ru = "абвгдежзийклмнопрстуфхцчшщыэюя";
      const word = (n, length, alphabet) => {
        let out = "";
        let x = n;
        for (let k = 0; k < length; k += 1) {
          out += alphabet[x % alphabet.length];
          x = Math.floor(x / alphabet.length) + 7 * k + 1;
        }
        return out;
      };
      for (let i = 0; i < 40; i += 1) {
        engine.add({
          refKey: `world:Item.item-${i}`,
          documentType: "Item",
          name: word(i, 12, cjk),
          text: Array.from({ length: 20 }, (_, j) => word(i * 20 + j, 14, ru)).join(" "),
          systemText: ""
        });
      }
      const json = JSON.stringify(engine.toJSON());
      const measured = measureSearchIndexBytes(engine);
      expect(measured).toBe(new TextEncoder().encode(json).length);
      expect(measured, "a non-ASCII corpus must cost MORE bytes than code units").toBeGreaterThan(
        json.length
      );

      const ascii = createSearchEngine();
      ascii.add({
        refKey: "world:Item.ascii",
        documentType: "Item",
        name: "Broadsword",
        text: "a plain english body",
        systemText: ""
      });
      expect(measureSearchIndexBytes(ascii)).toBe(JSON.stringify(ascii.toJSON()).length);
    });

    it("refuses an over-broad query PER CORPUS, with the escapes in the message", async () => {
      for (let i = 0; i < 4; i += 1) {
        globalThis.game.folders.set(`broad-${i}`, makeDoc("Folder", `broad-${i}`, `Broadterm Folder ${i}`));
      }
      const handler = makeSearch({
        caps: { ...tinyCompendium, compendium: tinyCompendium.world, maxMatches: 3 }
      });
      const error = await searchError(handler, { query: "broadterm" });
      expect(error.code).toBe(ERROR_CODES.QUERY_TOO_BROAD);
      expect(error.details).toMatchObject({
        corpus: "world",
        matchCount: 4,
        cap: 3,
        limit: "match-count"
      });

      expect(error.details.index.world.status).toBe("ready");
      expect(error.message).toContain("--types");
      expect(error.message).toContain('source:"pack"');

      const narrowed = await search(handler, { query: "broadterm", types: ["Actor"] });
      expect(narrowed.total).toBe(0);
    });

    it("reports a PACK-side too-broad trip as corpus:compendium beside a healthy world block (cell 15)", async () => {
      globalThis.game.packs = makeCollection([
        makePack("world.monsters", "Actor", [
          { _id: "p1", name: "Broadterm One" },
          { _id: "p2", name: "Broadterm Two" }
        ])
      ]);
      const handler = makeSearch({
        caps: { ...tinyCompendium, compendium: tinyCompendium.world, maxMatches: 1 }
      });
      const error = await searchError(handler, { query: "broadterm", includeCompendia: true });
      expect(error.code).toBe(ERROR_CODES.QUERY_TOO_BROAD);
      expect(error.details.corpus).toBe("compendium");
      expect(error.details.index.world.status).toBe("ready");
      expect(error.details.index.world.matchCount).toBe(0);
      expect(error.message).toContain('source:"world"');

      const escaped = await search(handler, { query: "broadterm", includeCompendia: true, source: "world" });
      expect(escaped.total).toBe(0);
    });

    it("PRECEDENCE: a world build overflow beats a pack too-broad count in the same call", async () => {
      globalThis.game.packs = makeCollection([
        makePack("world.monsters", "Actor", [
          { _id: "p1", name: "Broadterm One" },
          { _id: "p2", name: "Broadterm Two" }
        ])
      ]);
      const handler = makeSearch({
        caps: {
          world: { maxBytes: 32 * 1024 * 1024, maxEntries: 1 },
          compendium: { maxBytes: 32 * 1024 * 1024, maxEntries: 100_000 },
          maxMatches: 1
        }
      });
      const error = await searchError(handler, { query: "broadterm", includeCompendia: true });
      expect(error.code).toBe(ERROR_CODES.SEARCH_INDEX_OVERFLOW);
      expect(error.details.corpus).toBe("world");

      expect(error.details.index.compendium.status).toBe("ready");
    });

    it('PRECEDENCE: when BOTH corpora overflow, details.corpus is always "world"', async () => {
      globalThis.game.packs = makeCollection([
        makePack("world.monsters", "Actor", [
          { _id: "p1", name: "Broadterm One" },
          { _id: "p2", name: "Broadterm Two" }
        ])
      ]);
      const handler = makeSearch({
        caps: {
          world: { maxBytes: 32 * 1024 * 1024, maxEntries: 1 },
          compendium: { maxBytes: 32 * 1024 * 1024, maxEntries: 1 }
        }
      });
      const error = await searchError(handler, { query: "broadterm", includeCompendia: true });
      expect(error.code).toBe(ERROR_CODES.SEARCH_INDEX_OVERFLOW);
      expect(error.details.corpus).toBe("world");

      expect(error.details.index.world.status).toBe("overflow");
      expect(error.details.index.compendium.status).toBe("overflow");
    });

    it("PRECEDENCE: a too-broad count beats the response-byte cap", async () => {
      for (let i = 0; i < 4; i += 1) {
        globalThis.game.folders.set(`broad-${i}`, makeDoc("Folder", `broad-${i}`, `Broadterm Folder ${i}`));
      }
      const handler = makeSearch({
        caps: { ...tinyCompendium, compendium: tinyCompendium.world, maxMatches: 3, maxResponseBytes: 10 }
      });
      const error = await searchError(handler, { query: "broadterm" });
      expect(error.code).toBe(ERROR_CODES.QUERY_TOO_BROAD);
    });

    it("bounds the assembled response and says how to shrink it", async () => {
      const handler = makeSearch({
        caps: { ...tinyCompendium, compendium: tinyCompendium.world, maxResponseBytes: 200 }
      });
      const error = await searchError(handler, { query: "goblin" });
      expect(error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
      expect(error.details).toMatchObject({ limit: "response-bytes", cap: 200 });
      expect(error.details.observed).toBeGreaterThan(200);

      expect(error.details.index.world.status).toBe("ready");
      expect(error.message).toContain("--limit");
    });
  });

  describe("full-mode text and snippets", () => {
    /**
     * @param {any} handler
     * @param {string} query
     * @param {any} [extra]
     */
    async function full(handler, query, extra = {}) {
      return search(handler, { query, mode: "full", ...extra });
    }

    it("finds page BODY text in full mode and NOT in name mode (the mode-isolation arm)", async () => {
      const handler = makeSearch();
      const byBody = await full(handler, "zbodyword");
      expect(byBody.results.map((ref) => ref.refKey)).toEqual([
        "world:JournalEntry.journal-1.JournalEntryPage.page-1"
      ]);
      expect(byBody.total).toBe(1);
      expect(byBody.hasMore).toBe(false);

      const byName = await search(handler, { query: "zbodyword" });
      expect(byName.total).toBe(0);

      expect((await search(handler, { query: "rumours" })).total).toBe(1);
      expect((await full(handler, "rumours")).total).toBe(1);
    });

    it("indexes a MARKDOWN-only page body, which a `text.content`-only extractor loses silently", async () => {
      const handler = makeSearch();
      const result = await full(handler, "zmarkdownonly");
      expect(result.results.map((ref) => ref.refKey)).toEqual([
        "world:JournalEntry.journal-1.JournalEntryPage.page-md"
      ]);
      expect(result.results[0].snippet.text).toContain("zmarkdownonly");
    });

    it("drops <script>/<style>/comment content and turns every other tag into a SPACE", async () => {
      const handler = makeSearch();

      for (const marker of ["zscriptbody", "zstylebody", "zcommentbody"]) {
        expect((await full(handler, marker)).total, `${marker} must not be indexed`).toBe(0);
      }

      expect((await full(handler, "zbodyword ledger")).total).toBe(1);
      expect((await full(handler, "zbodywordledger")).total).toBe(0);

      expect((await full(handler, "docks ink")).total).toBe(1);
      expect((await full(handler, "10")).total).toBe(1);
    });

    it("walks a stored `system` object, dropping ids, paths, URLs and numbers", async () => {
      const handler = makeSearch();
      const walked = await full(handler, "zsystemword");
      expect(walked.results.map((ref) => ref.refKey)).toEqual(["world:Item.item-world-1"]);
      expect(walked.results[0].snippet.field).toBe("systemText");

      expect((await full(handler, "zdeepword")).total).toBe(1);

      for (const marker of ["abcdefghijklmnop", "zurlword", "icons", "1234"]) {
        expect((await full(handler, marker)).total, `${marker} must not be indexed`).toBe(0);
      }
    });

    it("never indexes flags, a Macro command body or a RegionBehavior's system.source", async () => {
      const handler = makeSearch();
      for (const marker of ["zflagsecret", "zmacrobody", "zbehaviorsource"]) {
        expect((await full(handler, marker)).total, `${marker} must never be indexed`).toBe(0);
      }

      expect((await full(handler, "whisper party")).total).toBe(1);
      expect((await full(handler, "pause game")).total).toBe(1);
    });

    it("boosts a NAME hit over a body hit for the same term", async () => {
      globalThis.game.folders.set("folder-body", makeDoc("Folder", "folder-body", "Zbodyword Folder"));
      const handler = makeSearch();
      const result = await full(handler, "zbodyword", { limit: 10 });
      expect(result.total).toBe(2);

      expect(result.results[0].refKey).toBe("world:Folder.folder-body");
      expect(result.results[0].score).toBeGreaterThan(result.results[1].score);
      expect(result.results[0].snippet.field).toBe("name");
      expect(result.results[1].snippet.field).toBe("text");
    });

    it("returns a PLAIN-TEXT snippet whose offsets index the delivered string", async () => {
      const handler = makeSearch();
      const ref = (await full(handler, "zbodyword")).results[0];
      expect(Object.keys(ref.snippet).sort()).toEqual(["field", "matches", "text", "truncated"]);
      expect(ref.snippet.field).toBe("text");

      expect(ref.snippet.text).not.toMatch(/<\/?[A-Za-z!?]/);
      expect(ref.snippet.text).not.toContain("&amp;");
      expect(ref.snippet.text).toContain("&");
      expect(ref.snippet.text).toContain("5 < 10 > 3");
      expect(ref.snippet.text.length).toBeLessThanOrEqual(240);
      expect(ref.snippet.truncated).toBe(false);

      expect(ref.snippet.matches).toHaveLength(1);
      const { start, length } = ref.snippet.matches[0];
      expect(ref.snippet.text.slice(start, start + length)).toBe("zbodyword");
    });

    it("delivers an AUTHOR's entity-encoded tag as literal text in the snippet", async () => {
      globalThis.game.playlists.set(
        "entity-text",
        makeDoc("Playlist", "entity-text", "Entity Notes", {
          source: {
            description: "<p>zentityword &lt;script&gt;alert(1)&lt;/script&gt; kept as text</p>"
          }
        })
      );
      const handler = makeSearch();
      const ref = (await full(handler, "zentityword")).results[0];
      expect(ref.refKey).toBe("world:Playlist.entity-text");
      expect(ref.snippet.field).toBe("text");
      expect(ref.snippet.text).toContain("<script>alert(1)</script>");

      expect(ref.snippet.text).not.toContain("<p>");
      expect(ref.snippet.truncated).toBe(false);
    });

    it("windows around the FIRST match, never exceeding the snippet cap, in every clipping shape", async () => {
      const filler = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ";
      const long = filler.repeat(20);
      const cases = [
        { id: "clip-mid", description: `${long}zwindowmid ${long}`, lead: true, trail: true },
        { id: "clip-head", description: `zwindowhead ${long}`, lead: false, trail: true },
        { id: "clip-tail", description: `${long}zwindowtail`, lead: true, trail: false },
        { id: "clip-none", description: "short zwindownone body", lead: false, trail: false }
      ];
      for (const entry of cases) {
        globalThis.game.playlists.set(
          entry.id,
          makeDoc("Playlist", entry.id, `Window ${entry.id}`, {
            source: { description: entry.description }
          })
        );
      }
      const handler = makeSearch();
      for (const entry of cases) {
        const term = /** @type {RegExpMatchArray} */ (entry.description.match(/zwindow\w+/))[0];
        const ref = (await full(handler, term)).results[0];
        expect(ref.refKey, `${entry.id} must match`).toBe(`world:Playlist.${entry.id}`);
        const snippet = ref.snippet;

        expect(snippet.text.length, `${entry.id} snippet length`).toBeLessThanOrEqual(240);
        expect(snippet.text.startsWith("…"), `${entry.id} lead`).toBe(entry.lead);
        expect(snippet.text.endsWith("…"), `${entry.id} trail`).toBe(entry.trail);
        const { start, length } = snippet.matches[0];
        expect(snippet.text.slice(start, start + length), `${entry.id} offsets`).toBe(term);
      }
    });

    it("caps the offset list at SEARCH_SNIPPET_MAX_MATCHES and never overlaps two of them", async () => {
      globalThis.game.playlists.set(
        "many",
        makeDoc("Playlist", "many", "Many Matches", {
          source: { description: Array.from({ length: 9 }, () => "zrepeatword").join(" ") }
        })
      );
      const handler = makeSearch();
      const snippet = (await full(handler, "zrepeatword")).results[0].snippet;
      expect(snippet.matches).toHaveLength(5);
      let cursor = -1;
      for (const match of snippet.matches) {
        expect(match.start).toBeGreaterThanOrEqual(cursor);
        expect(snippet.text.slice(match.start, match.start + match.length)).toBe("zrepeatword");
        cursor = match.start + match.length;
      }
    });

    it("matches Cyrillic body text, folds ё/е, and keeps a surrogate pair whole in the window", async () => {
      const handler = makeSearch();

      const cyrillic = await full(handler, "zcyrbody");
      expect(cyrillic.results.map((ref) => ref.refKey)).toEqual([
        "world:Actor.actor-1.ActiveEffect.fx-actor-1"
      ]);
      expect((await search(handler, { query: "zcyrbody" })).total).toBe(0);

      const folded = await full(handler, "елка");
      expect(folded.results.map((ref) => ref.refKey)).toEqual([
        "world:Actor.actor-1.ActiveEffect.fx-actor-1"
      ]);
      const snippet = folded.results[0].snippet;
      const { start, length } = snippet.matches[0];
      expect(snippet.text.slice(start, start + length)).toBe("ёлка");

      expect(snippet.text).toContain("🎲");
      expect(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(snippet.text)
      ).toBe(false);
    });

    it("returns snippet:null for a FUZZY-only hit, in name mode, and for a compendium row", async () => {
      globalThis.game.packs = makeCollection([
        makePack("world.items", "Item", [{ _id: "pack-item-1", name: "Zpackword Blade" }])
      ]);
      const handler = makeSearch();

      const fuzzy = await full(handler, "контрабандистах");
      expect(fuzzy.results.map((ref) => ref.refKey)).toEqual(["world:Actor.actor-1.ActiveEffect.fx-actor-1"]);
      expect(fuzzy.results[0].snippet).toBeNull();

      const named = await search(handler, { query: "sneaky" });
      expect(named.results[0].snippet).toBeNull();
      expect((await full(handler, "sneaky")).results[0].snippet).not.toBeNull();

      const pack = await full(handler, "zpackword", { includeCompendia: true, source: "pack" });
      expect(pack.results).toHaveLength(1);
      expect(pack.results[0].source).toBe("compendium");
      expect(pack.results[0].snippet).toBeNull();
    });

    it("clips one document's text at the per-field cap, disclosing it as textTruncatedCount", async () => {
      const head = "zcappedhead ";
      const filler = "filler ".repeat(6000);
      globalThis.game.playlists.set(
        "capped",
        makeDoc("Playlist", "capped", "Capped Playlist", {
          source: { description: `${head}${filler}zcappedtail` }
        })
      );
      const handler = makeSearch();
      const found = await full(handler, "zcappedhead");
      expect(found.results.map((ref) => ref.refKey)).toEqual(["world:Playlist.capped"]);

      expect(found.index.world.textTruncatedCount).toBe(1);

      expect(found.results[0].snippet.truncated).toBe(true);

      expect((await full(handler, "zcappedtail")).total).toBe(0);

      expect((await search(handler, { query: "capped" })).index.world.textTruncatedCount).toBe(1);
    });

    it("discloses an UNTERMINATED <script> tail through the same counter and the ref's snippet", async () => {
      globalThis.game.playlists.set(
        "swallowed",
        makeDoc("Playlist", "swallowed", "Swallowed Playlist", {
          source: { description: `<p>zswallowedhead</p><script>x ${"prose ".repeat(2000)}zswallowedtail` }
        })
      );
      const handler = makeSearch();
      const found = await full(handler, "zswallowedhead");
      expect(found.results.map((ref) => ref.refKey)).toEqual(["world:Playlist.swallowed"]);
      expect(found.index.world.textTruncatedCount).toBe(1);
      expect(found.results[0].snippet.truncated).toBe(true);

      expect((await full(handler, "zswallowedtail")).total).toBe(0);
    });

    it("discloses an UNTERMINATED COMMENT tail the same way, on the same counter", async () => {
      globalThis.game.playlists.set(
        "commented",
        makeDoc("Playlist", "commented", "Commented Playlist", {
          source: { description: "zcommentedhead: <!-- means comment; volume is zcommentedtail" }
        })
      );
      const handler = makeSearch();
      const found = await full(handler, "zcommentedhead");
      expect(found.results.map((ref) => ref.refKey)).toEqual(["world:Playlist.commented"]);
      expect(found.index.world.textTruncatedCount).toBe(1);
      expect(found.results[0].snippet.truncated).toBe(true);
      expect((await full(handler, "zcommentedtail")).total).toBe(0);
    });

    it("discloses a clip on a document the inclusion rule then DROPPED, so no loss is silent", async () => {
      globalThis.game.tables.get("table-1").results.set(
        "result-swallowed",
        makeDoc("TableResult", "result-swallowed", "", {
          live: "Backfilled Name",
          source: { description: "<!-- roll for the zdroppedrow contact" }
        })
      );
      const handler = makeSearch();
      const found = await full(handler, "zdroppedrow");

      expect(found.total).toBe(0);
      expect(found.index.world.entryCount).toBe(24);
      expect(found.index.world.textTruncatedCount).toBe(1);

      expect((await search(handler, { query: "loot" })).index.world.textTruncatedCount).toBe(1);

      expect(found.index.world.textTruncatedCount).toBeLessThan(found.index.world.entryCount);
    });

    it("bounds the system walk's DEPTH, keeping the shallower siblings", async () => {
      /** @param {number} depth */
      const nest = (depth, marker) => {
        /** @type {any} */
        let node = marker;
        for (let i = 0; i < depth; i += 1) {
          node = { down: node };
        }
        return node;
      };
      globalThis.game.items.set(
        "item-deep",
        makeDoc("Item", "item-deep", "Deep Item", {
          source: {
            system: { shallow: nest(6, "zinbound"), buried: nest(9, "qfaraway"), tail: "ztailword" }
          }
        })
      );
      const handler = makeSearch();
      expect((await full(handler, "zinbound")).total).toBe(1);
      expect((await full(handler, "qfaraway")).total).toBe(0);

      expect((await full(handler, "ztailword")).total).toBe(1);
    });

    it("invalidates on a TEXT-field diff and answers from the rebuilt corpus", async () => {
      const hooks = makeHooks();
      const handler = makeSearch({ hooks });
      expect((await full(handler, "zeditedbody")).total).toBe(0);
      const page = globalThis.game.journal.get("journal-1").pages.get("page-1");
      page._source.text = { content: "<p>zeditedbody now</p>", format: 1 };

      hooks.fire("updateJournalEntryPage", page, { sort: 200 });
      const stale = await full(handler, "zeditedbody");
      expect(stale.index.world.builtThisCall).toBe(false);
      expect(stale.total).toBe(0);

      hooks.fire("updateJournalEntryPage", page, { text: { content: "<p>zeditedbody now</p>" } });
      const fresh = await full(handler, "zeditedbody");
      expect(fresh.index.world.builtThisCall).toBe(true);
      expect(fresh.results.map((ref) => ref.refKey)).toEqual([
        "world:JournalEntry.journal-1.JournalEntryPage.page-1"
      ]);

      page._source.text = { content: "<p>zparentedited body</p>", format: 1 };
      hooks.fire("updateJournalEntry", globalThis.game.journal.get("journal-1"), {
        pages: [{ _id: "page-1" }]
      });
      expect((await full(handler, "zparentedited")).total).toBe(1);
    });

    it("CORPUS ISOLATION holds in full mode too: a world-only query survives a doomed pack corpus", async () => {
      globalThis.game.packs = makeCollection([
        makePack("world.items", "Item", [
          { _id: "pack-item-1", name: "Zpackword Blade" },
          { _id: "pack-item-2", name: "Zpackword Axe" }
        ])
      ]);
      const handler = makeSearch({
        caps: {
          world: { maxBytes: 32 * 1024 * 1024, maxEntries: 100_000 },
          compendium: { maxBytes: 32 * 1024 * 1024, maxEntries: 1 }
        }
      });
      const worldOnly = await full(handler, "zbodyword");
      expect(worldOnly.results).toHaveLength(1);
      expect(worldOnly.index.compendium).toBeNull();
      const withPacks = await searchError(handler, {
        query: "zbodyword",
        mode: "full",
        includeCompendia: true
      });
      expect(withPacks.code).toBe(ERROR_CODES.SEARCH_INDEX_OVERFLOW);
      expect(withPacks.details.corpus).toBe("compendium");
      expect(withPacks.details.index.world.status).toBe("ready");

      expect((await full(handler, "zbodyword")).results).toHaveLength(1);
    });
  });

  describe("through the command router", () => {
    /** @param {any} params */
    function request(params) {
      return {
        protocolVersion: PROTOCOL_VERSION,
        type: MESSAGE_TYPES.COMMAND_REQUEST,
        id: "req-search",
        command: "world.search",
        params
      };
    }

    it("routes world.search as a read (no GM write gate) and answers the pinned envelope", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(request({ query: "goblin" }));
      expect(response.ok).toBe(true);
      expect(Object.keys(response.result).sort()).toEqual([
        "hasMore",
        "includeCompendia",
        "index",
        "mode",
        "results",
        "source",
        "total"
      ]);
      expect(Object.keys(response.result.index.world).sort()).toEqual([
        "builtThisCall",
        "entryCount",
        "generation",
        "indexedChars",
        "matchCount",
        "stale",
        "status",
        "textTruncatedCount"
      ]);
      expect(response.result.index.world.textTruncatedCount).toBe(0);
      expect(response.result.index.world.entryCount).toBeGreaterThan(0);
    });

    it("pins the COMPENDIUM block's key set too, including both pack counters", async () => {
      globalThis.game.packs = makeCollection([
        makePack("world.monsters", "Actor", [{ _id: "pack-actor-1", name: "Goblin Chief" }])
      ]);
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(request({ query: "goblin", includeCompendia: true }));
      expect(response.ok).toBe(true);
      expect(Object.keys(response.result.index.compendium).sort()).toEqual([
        "builtThisCall",
        "entryCount",
        "failedPackCount",
        "generation",
        "indexedChars",
        "matchCount",
        "skippedPackCount",
        "stale",
        "status",
        "textTruncatedCount"
      ]);

      expect(response.result.index.world).not.toHaveProperty("skippedPackCount");
      expect(response.result.index.world).not.toHaveProperty("failedPackCount");
    });

    it("emits only MEMBERS of the two wire enums for status and ref.source", async () => {
      globalThis.game.packs = makeCollection([
        makePack("world.monsters", "Actor", [{ _id: "pack-actor-1", name: "Goblin Chief" }])
      ]);
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(request({ query: "goblin", includeCompendia: true, limit: 100 }));
      expect(response.ok).toBe(true);

      expect(new Set(response.result.results.map((ref) => ref.source))).toEqual(
        new Set(["world", "compendium"])
      );
      for (const ref of response.result.results) {
        expect(SEARCH_RESULT_SOURCES).toContain(ref.source);
      }
      for (const corpus of ["world", "compendium"]) {
        expect(SEARCH_CORPUS_STATUSES).toContain(response.result.index[corpus].status);
      }

      const overflowed = await searchError(
        makeSearch({
          caps: {
            world: { maxBytes: 32 * 1024 * 1024, maxEntries: 1 },
            compendium: { maxBytes: 32 * 1024 * 1024, maxEntries: 100_000 }
          }
        }),
        { query: "goblin" }
      );
      expect(SEARCH_CORPUS_STATUSES).toContain(overflowed.details.index.world.status);
      expect(overflowed.details.index.world.status).toBe("overflow");
    });

    it('ANSWERS mode:"full" now that the enum is widened, and still rejects any other value', async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const answered = await router.route(request({ query: "zbodyword", mode: "full" }));
      expect(answered.ok).toBe(true);
      expect(answered.result.mode).toBe("full");
      expect(answered.result.results.map((ref) => ref.refKey)).toEqual([
        "world:JournalEntry.journal-1.JournalEntryPage.page-1"
      ]);

      const nameMode = await router.route(request({ query: "zbodyword" }));
      expect(nameMode.ok).toBe(true);
      expect(nameMode.result.total).toBe(0);

      const rejected = await router.route(request({ query: "goblin", mode: "text" }));
      expect(rejected.ok).toBe(false);
      expect(rejected.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(rejected.error.details.errors.join(" ")).toContain("must be one of name, full");
      expect(rejected.error.code).not.toBe(ERROR_CODES.UNSUPPORTED_OPERATION);

      const cased = await router.route(request({ query: "goblin", mode: "FULL" }));
      expect(cased.ok).toBe(false);
      expect(cased.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    });

    it("rejects an unknown types member and a too-short query at the protocol layer", async () => {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const badType = await router.route(request({ query: "goblin", types: ["Setting"] }));
      expect(badType.ok).toBe(false);
      expect(badType.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      const shortQuery = await router.route(request({ query: "g" }));
      expect(shortQuery.ok).toBe(false);
      expect(shortQuery.error.details.errors.join(" ")).toContain("at least 2 characters");
    });

    it("keeps each router's corpora independent (per-factory state, not a module singleton)", async () => {
      const first = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const second = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const a = await first.route(request({ query: "goblin" }));
      const b = await second.route(request({ query: "goblin" }));
      expect(a.result.index.world.builtThisCall).toBe(true);
      expect(b.result.index.world.builtThisCall).toBe(true);
      const again = await first.route(request({ query: "goblin" }));
      expect(again.result.index.world.builtThisCall).toBe(false);
    });
  });
});
