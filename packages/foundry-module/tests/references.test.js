import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REFERENCES_MAX_MATCHES } from "../scripts/generated/protocol.js";
import { parseReferenceTarget, runReferenceLookup } from "../scripts/lib/references.js";

class DataField {}
class SchemaField extends DataField {
  constructor(fields) {
    super();
    this.fields = fields;
  }
}
class ArrayField extends DataField {
  constructor(element) {
    super();
    this.element = element;
  }
}
class EmbeddedCollectionField extends ArrayField {}
class ForeignDocumentField extends DataField {
  constructor(documentName) {
    super();
    this.model = { documentName };
  }
}
class StringField extends DataField {}

const fields = {
  DataField,
  SchemaField,
  ArrayField,
  EmbeddedCollectionField,
  ForeignDocumentField,
  StringField
};

function documentClass(embedded, schemaFields) {
  return { metadata: { embedded }, schema: new SchemaField(schemaFields) };
}

const CONFIG = {
  Actor: {
    documentClass: documentClass(
      { Item: "items", ActiveEffect: "effects" },
      { folder: new ForeignDocumentField("Folder") }
    )
  },
  Item: {
    documentClass: documentClass(
      { ActiveEffect: "effects" },
      {
        folder: new ForeignDocumentField("Folder"),
        _stats: new SchemaField({ lastModifiedBy: new ForeignDocumentField("User") })
      }
    )
  },
  ActiveEffect: { documentClass: documentClass({}, { origin: new StringField() }) },
  Scene: {
    documentClass: documentClass(
      { Token: "tokens", Note: "notes" },
      {
        journal: new ForeignDocumentField("JournalEntry"),
        journalEntryPage: new ForeignDocumentField("JournalEntryPage")
      }
    )
  },
  Token: {
    documentClass: documentClass({ ActorDelta: "delta" }, { actorId: new ForeignDocumentField("Actor") })
  },
  Note: {
    documentClass: documentClass(
      {},
      {
        entryId: new ForeignDocumentField("JournalEntry"),
        pageId: new ForeignDocumentField("JournalEntryPage")
      }
    )
  },
  JournalEntry: { documentClass: documentClass({ JournalEntryPage: "pages" }, {}) },
  JournalEntryPage: { documentClass: documentClass({}, {}) },
  Combat: {
    documentClass: documentClass({ Combatant: "combatants" }, { scene: new ForeignDocumentField("Scene") })
  },
  Combatant: {
    documentClass: documentClass(
      {},
      {
        actorId: new ForeignDocumentField("Actor"),
        tokenId: new ForeignDocumentField("Token"),
        sceneId: new ForeignDocumentField("Scene")
      }
    )
  },
  ChatMessage: {
    documentClass: documentClass({}, { whisper: new ArrayField(new ForeignDocumentField("User")) })
  }
};

function collection(documentName, sources) {
  const documents = sources.map((source) => ({
    id: source._id,
    name: source.name,
    documentName,
    toObject: () => structuredClone(source)
  }));
  return Object.assign(documents, { documentName });
}

const ACTOR_ID = "aaaaaaaaaaaaaaaa";

function installWorld() {
  globalThis.game = {
    actors: collection("Actor", [
      {
        _id: ACTOR_ID,
        name: "Goblin Boss",
        items: [
          {
            _id: "itemaaaaaaaaaaaa",
            name: "Scimitar",
            effects: [
              { _id: "effaaaaaaaaaaaaa", name: "Edge", origin: `Actor.${ACTOR_ID}.Item.itemaaaaaaaaaaaa` }
            ]
          }
        ],
        effects: []
      },
      {
        _id: "bbbbbbbbbbbbbbbb",
        name: "Summoner",
        flags: { dnd5e: { summon: { uuid: `Actor.${ACTOR_ID}` } } },
        items: [],
        effects: [
          { _id: "effbbbbbbbbbbbbb", name: "Curse", origin: `Actor.${ACTOR_ID}.Item.itemaaaaaaaaaaaa` }
        ],
        system: { notes: `Actor.${ACTOR_ID}x is not it; Compendium.world.monsters.Actor.${ACTOR_ID} neither` }
      }
    ]),
    items: collection("Item", [
      {
        _id: "cccccccccccccccc",
        name: "Totem",
        _stats: { compendiumSource: `Actor.${ACTOR_ID}` },
        effects: []
      }
    ]),
    scenes: collection("Scene", [
      {
        _id: "scene00000000001",
        name: "Cave",
        journal: "journal000000001",
        tokens: [
          { _id: "token00000000001", name: "Goblin Boss", actorId: ACTOR_ID, delta: { items: [] } },
          { _id: "token00000000002", name: "Wolf", actorId: "wolf000000000001", delta: null }
        ],
        notes: [{ _id: "note000000000001", entryId: "journal000000001", pageId: "page000000000001" }]
      }
    ]),
    journal: collection("JournalEntry", [
      {
        _id: "journal000000001",
        name: "Lore",
        pages: [
          {
            _id: "page000000000001",
            name: "Boss",
            text: {
              content: `<p>@UUID[Actor.${ACTOR_ID}]{Boss} and @Actor[${ACTOR_ID}]{old} and @UUID[Compendium.dnd5e.monsters.Actor.zzzzzzzzzzzzzzzz]</p>`
            }
          }
        ]
      }
    ]),
    playlists: collection("Playlist", []),
    macros: collection("Macro", []),
    tables: collection("RollTable", []),
    combats: collection("Combat", []),
    cards: collection("Cards", [])
  };
}

beforeEach(() => {
  globalThis.foundry = { ...(globalThis.foundry ?? {}), data: { fields } };
  globalThis.CONFIG = CONFIG;
  globalThis.CONST = {
    DOCUMENT_LINK_TYPES: [
      "Actor",
      "Cards",
      "Item",
      "Scene",
      "JournalEntry",
      "Macro",
      "RollTable",
      "PlaylistSound"
    ],
    WORLD_DOCUMENT_TYPES: [
      "Actor",
      "Cards",
      "Item",
      "Scene",
      "JournalEntry",
      "Macro",
      "RollTable",
      "Playlist"
    ]
  };
  globalThis.fromUuidSync = vi.fn((uuid) => (uuid === `Actor.${ACTOR_ID}` ? { name: "Goblin Boss" } : null));
  installWorld();
});

afterEach(() => {
  delete globalThis.fromUuidSync;
  delete globalThis.CONST;
  vi.restoreAllMocks();
});

const rows = (result) =>
  result.references.map((ref) => [ref.uuid, ref.field, ref.match, ref.matchedUuid ?? null]);

describe("world.references lookup", () => {
  it("finds UUID strings, links, embedded UUIDs and foreign-key ids outside the target", () => {
    const result = runReferenceLookup({ uuid: `Actor.${ACTOR_ID}` });

    expect(result.target).toEqual({
      uuid: `Actor.${ACTOR_ID}`,
      documentName: "Actor",
      id: ACTOR_ID,
      exists: true,
      name: "Goblin Boss"
    });
    expect(rows(result)).toEqual([
      ["Actor.bbbbbbbbbbbbbbbb", "flags.dnd5e.summon.uuid", "uuid", null],
      [
        "Actor.bbbbbbbbbbbbbbbb.ActiveEffect.effbbbbbbbbbbbbb",
        "origin",
        "embedded",
        `Actor.${ACTOR_ID}.Item.itemaaaaaaaaaaaa`
      ],
      ["Item.cccccccccccccccc", "_stats.compendiumSource", "uuid", null],
      ["JournalEntry.journal000000001.JournalEntryPage.page000000000001", "text.content", "link", null],
      ["Scene.scene00000000001.Token.token00000000001", "actorId", "id", null]
    ]);
    expect(result.total).toBe(5);
    expect(result.selfReferences).toBe(1);
    expect(result.scannedDocuments).toBe(12);
    expect(result.scopes).toEqual([
      "scene",
      "actor",
      "item",
      "journal",
      "playlist",
      "macro",
      "table",
      "combat",
      "cards"
    ]);
  });

  it("never matches a world UUID inside a longer id or a compendium UUID", () => {
    const result = runReferenceLookup({ uuid: `Actor.${ACTOR_ID}` });
    expect(result.references.some((ref) => ref.field === "system.notes")).toBe(false);
  });

  it("matches compendium UUIDs only as themselves and reports existence as unknown", () => {
    const result = runReferenceLookup({ uuid: "Compendium.dnd5e.monsters.Actor.zzzzzzzzzzzzzzzz" });
    expect(rows(result)).toEqual([
      ["JournalEntry.journal000000001.JournalEntryPage.page000000000001", "text.content", "link", null]
    ]);
    expect(result.target.exists).toBeNull();
  });

  it("matches foreign-key ids of an embedded target type and of a journal target", () => {
    expect(
      rows(runReferenceLookup({ uuid: "JournalEntry.journal000000001.JournalEntryPage.page000000000001" }))
    ).toEqual([["Scene.scene00000000001.Note.note000000000001", "pageId", "id", null]]);
    expect(rows(runReferenceLookup({ uuid: "JournalEntry.journal000000001" }))).toEqual([
      ["Scene.scene00000000001", "journal", "id", null],
      ["Scene.scene00000000001.Note.note000000000001", "entryId", "id", null]
    ]);
  });

  it("matches an id of an embedded target only where the record also names the target's parent", () => {
    globalThis.game.journal = collection("JournalEntry", [
      { _id: "journal000000001", name: "Lore", pages: [{ _id: "page000000000001", name: "Boss" }] },
      { _id: "journal000000002", name: "Lore copy", pages: [{ _id: "page000000000001", name: "Boss" }] }
    ]);
    globalThis.game.scenes = collection("Scene", [
      {
        _id: "scene00000000001",
        name: "Cave",
        journal: "journal000000002",
        journalEntryPage: "page000000000001",
        tokens: [{ _id: "token00000000001", name: "Boss", actorId: ACTOR_ID }],
        notes: [{ _id: "note000000000001", entryId: "journal000000002", pageId: "page000000000001" }]
      },
      {
        _id: "scene00000000002",
        name: "Cave copy",
        tokens: [{ _id: "token00000000001", name: "Boss", actorId: ACTOR_ID }],
        notes: []
      }
    ]);
    globalThis.game.combats = collection("Combat", [
      {
        _id: "combat0000000001",
        scene: "scene00000000002",
        combatants: [
          {
            _id: "combatant0000001",
            actorId: ACTOR_ID,
            sceneId: "scene00000000002",
            tokenId: "token00000000001"
          }
        ]
      }
    ]);

    expect(
      rows(runReferenceLookup({ uuid: "JournalEntry.journal000000001.JournalEntryPage.page000000000001" }))
    ).toEqual([]);
    expect(
      rows(runReferenceLookup({ uuid: "JournalEntry.journal000000002.JournalEntryPage.page000000000001" }))
    ).toEqual([
      ["Scene.scene00000000001", "journalEntryPage", "id", null],
      ["Scene.scene00000000001.Note.note000000000001", "pageId", "id", null]
    ]);
    expect(rows(runReferenceLookup({ uuid: "Scene.scene00000000001.Token.token00000000001" }))).toEqual([]);
    expect(rows(runReferenceLookup({ uuid: "Scene.scene00000000002.Token.token00000000001" }))).toEqual([
      ["Combat.combat0000000001.Combatant.combatant0000001", "tokenId", "id", null]
    ]);
  });

  it("resolves a combatant without a sceneId through its combat's scene, as Foundry does", () => {
    globalThis.game.combats = collection("Combat", [
      {
        _id: "combat0000000001",
        scene: "scene00000000001",
        combatants: [
          { _id: "combatant0000001", actorId: ACTOR_ID, sceneId: null, tokenId: "token00000000001" }
        ]
      },
      {
        _id: "combat0000000002",
        scene: "scene00000000002",
        combatants: [
          { _id: "combatant0000002", actorId: ACTOR_ID, sceneId: null, tokenId: "token00000000001" }
        ]
      }
    ]);

    expect(
      rows(runReferenceLookup({ uuid: "Scene.scene00000000001.Token.token00000000001", scope: ["combat"] }))
    ).toEqual([["Combat.combat0000000001.Combatant.combatant0000001", "tokenId", "id", null]]);
  });

  it("leaves Foundry-maintained underscore fields out of id matching", () => {
    globalThis.game.items = collection("Item", [
      { _id: "dddddddddddddddd", name: "Edited", _stats: { lastModifiedBy: "user000000000001" }, effects: [] }
    ]);

    expect(runReferenceLookup({ uuid: "User.user000000000001", scope: ["item"] }).total).toBe(0);
  });

  it("scans each requested scope once", () => {
    const single = runReferenceLookup({ uuid: `Actor.${ACTOR_ID}`, scope: ["item"] });
    const doubled = runReferenceLookup({ uuid: `Actor.${ACTOR_ID}`, scope: ["item", "item"] });
    expect(doubled.scopes).toEqual(["item"]);
    expect(doubled.scannedDocuments).toBe(single.scannedDocuments);
    expect(doubled.total).toBe(single.total);
  });

  it("restricts the walk to the requested scopes and paginates the sorted rows", () => {
    const scoped = runReferenceLookup({ uuid: `Actor.${ACTOR_ID}`, scope: ["scene"] });
    expect(rows(scoped)).toEqual([["Scene.scene00000000001.Token.token00000000001", "actorId", "id", null]]);

    const paged = runReferenceLookup({ uuid: `Actor.${ACTOR_ID}`, limit: 2, offset: 1 });
    expect(paged.references.map((ref) => ref.uuid)).toEqual([
      "Actor.bbbbbbbbbbbbbbbb.ActiveEffect.effbbbbbbbbbbbbb",
      "Item.cccccccccccccccc"
    ]);
    expect(paged.total).toBe(5);
    expect(paged.hasMore).toBe(true);
  });

  it("rejects a string that is not a document UUID", () => {
    for (const uuid of ["Actor", "actor.abc", "Actor.abc.Item", "Compendium.dnd5e.Actor.abc", "Actor.a-b"]) {
      expect(() => parseReferenceTarget(uuid), uuid).toThrow(
        expect.objectContaining({ code: "INVALID_PARAMS" })
      );
    }
  });

  it("refuses a lookup above the match cap", () => {
    const many = Array.from({ length: REFERENCES_MAX_MATCHES + 1 }, (_, index) => ({
      _id: `item${String(index).padStart(12, "0")}`,
      name: "Copy",
      flags: { link: `Actor.${ACTOR_ID}` },
      effects: []
    }));
    globalThis.game.items = collection("Item", many);

    expect(() => runReferenceLookup({ uuid: `Actor.${ACTOR_ID}`, scope: ["item"] })).toThrow(
      expect.objectContaining({ code: "QUERY_TOO_BROAD" })
    );
  });
});
