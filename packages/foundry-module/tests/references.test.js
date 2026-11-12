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
  ActiveEffect: {
    documentClass: documentClass(
      {},
      { origin: new StringField(), duration: new SchemaField({ combat: new ForeignDocumentField("Combat") }) }
    )
  },
  ActorDelta: { documentClass: documentClass({ Item: "items", ActiveEffect: "effects" }, {}) },
  User: { documentClass: documentClass({}, { character: new ForeignDocumentField("Actor") }) },
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
    documentClass: documentClass(
      {},
      {
        whisper: new ArrayField(new ForeignDocumentField("User")),
        speaker: new SchemaField({
          scene: new ForeignDocumentField("Scene"),
          actor: new ForeignDocumentField("Actor"),
          token: new ForeignDocumentField("Token")
        })
      }
    )
  },
  Folder: { documentClass: documentClass({}, { folder: new ForeignDocumentField("Folder") }) },
  Setting: { documentClass: documentClass({}, { user: new ForeignDocumentField("User") }) },
  Macro: { documentClass: documentClass({}, { folder: new ForeignDocumentField("Folder") }) },
  RollTable: { documentClass: documentClass({ TableResult: "results" }, {}) },
  TableResult: { documentClass: documentClass({}, {}) }
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
    ALL_DOCUMENT_TYPES: [
      "ActiveEffect",
      "Actor",
      "ActorDelta",
      "Cards",
      "ChatMessage",
      "Combat",
      "Combatant",
      "Folder",
      "Item",
      "JournalEntry",
      "JournalEntryPage",
      "Macro",
      "Note",
      "Playlist",
      "RollTable",
      "Scene",
      "Setting",
      "TableResult",
      "Token",
      "User"
    ],
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
    EMBEDDED_DOCUMENT_TYPES: [
      "ActiveEffect",
      "ActorDelta",
      "Combatant",
      "Item",
      "JournalEntryPage",
      "Note",
      "TableResult",
      "Token"
    ],
    WORLD_DOCUMENT_TYPES: [
      "Actor",
      "Cards",
      "ChatMessage",
      "Combat",
      "Folder",
      "Item",
      "JournalEntry",
      "Macro",
      "Playlist",
      "RollTable",
      "Scene",
      "Setting",
      "User"
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

function settings(sources) {
  const world = collection("Setting", sources);
  const client = new Map([["mod.client", JSON.stringify({ [`Actor.${ACTOR_ID}`]: true })]]);
  return {
    storage: new Map([
      ["world", world],
      ["client", client],
      ["user", world]
    ])
  };
}

function relativeDocument(uuid) {
  const parts = uuid.split(".");
  return {
    uuid,
    documentName: parts.at(-2),
    parentUuid: parts.length > 2 ? parts.slice(0, -2).join(".") : null
  };
}

/**
 * @param {string} uuid
 * @param {{ relative: { uuid: string, documentName: string, parentUuid: string | null } }} options
 */
function parseRelativeUuid(uuid, { relative }) {
  if (!uuid.startsWith(".")) {
    const parts = uuid.split(".");
    return { uuid, documentId: parts.length >= 2 ? parts[1] : undefined };
  }
  const parts = uuid.slice(1).split(".");
  if (parts.length % 2 === 0) {
    return { uuid: `${relative.uuid}.${parts.join(".")}`, documentId: parts.at(-1) };
  }
  if (relative.parentUuid) {
    return {
      uuid: `${relative.parentUuid}.${relative.documentName}.${parts.join(".")}`,
      documentId: parts.at(-1)
    };
  }
  return { uuid: `${relative.documentName}.${parts.at(-1)}`, documentId: parts.at(-1) };
}

/**
 * @param {string} raw
 * @param {{ relative: { uuid: string, documentName: string, parentUuid: string | null } }} options
 */
function parseEmbedConfig(raw, options) {
  const values = [];
  let uuid;
  for (const part of raw.split(/\s+/)) {
    const [key, value] = part.split("=");
    if (value === undefined) values.push(key);
    else if (key === "uuid") uuid = value;
  }
  uuid ??= values.find((value) => parseRelativeUuid(value, options)?.documentId);
  return { values, uuid };
}

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
      "cards",
      "folder",
      "setting"
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

  it("reads foreign keys inside a token's delta and reports them on the token", () => {
    globalThis.game.scenes = collection("Scene", [
      {
        _id: "scene00000000001",
        name: "Cave",
        tokens: [
          {
            _id: "token00000000001",
            name: "Boss",
            actorId: ACTOR_ID,
            delta: {
              _id: "token00000000001",
              effects: [{ _id: "deltaeffect00001", name: "Hex", duration: { combat: "combat0000000001" } }],
              items: []
            }
          }
        ],
        notes: []
      }
    ]);

    expect(rows(runReferenceLookup({ uuid: "Combat.combat0000000001", scope: ["scene"] }))).toEqual([
      ["Scene.scene00000000001.Token.token00000000001", "delta.effects.0.duration.combat", "id", null]
    ]);
  });

  it("always scans users, so an assigned character is found", () => {
    globalThis.game.users = collection("User", [
      { _id: "user000000000001", name: "Player", character: ACTOR_ID }
    ]);

    const result = runReferenceLookup({ uuid: `Actor.${ACTOR_ID}`, scope: ["scene"] });
    expect(rows(result)).toContainEqual(["User.user000000000001", "character", "id", null]);
  });

  it("refuses an embedded document type addressed without its parent", () => {
    expect(() => runReferenceLookup({ uuid: "JournalEntryPage.page000000000001" })).toThrow(
      expect.objectContaining({
        code: "INVALID_PARAMS",
        details: expect.objectContaining({ documentName: "JournalEntryPage" })
      })
    );
  });

  it("refuses an unknown two-segment type as a malformed UUID, not as a parentless embedded one", () => {
    for (const uuid of ["Actors.aaaaaaaaaaaaaaaa", "Adventure.aaaaaaaaaaaaaaaa"]) {
      expect(() => runReferenceLookup({ uuid }), uuid).toThrow(
        expect.objectContaining({ code: "INVALID_PARAMS", details: { uuid } })
      );
    }
  });

  it("matches no bare id for a document embedded below an embedded parent, such as a token's actor", () => {
    globalThis.game.scenes = collection("Scene", [
      {
        _id: "scene00000000001",
        name: "Cave",
        tokens: [{ _id: "token00000000001", name: "Boss", actorId: ACTOR_ID, delta: null }],
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

    const result = runReferenceLookup({
      uuid: `Scene.scene00000000001.Token.token00000000001.Actor.${ACTOR_ID}`
    });
    expect(result.references.filter((ref) => ref.match === "id")).toEqual([]);
  });

  it("fails loudly when a document schema cannot be read instead of skipping id matching", () => {
    globalThis.CONFIG = {
      ...CONFIG,
      Token: {
        documentClass: {
          metadata: { embedded: {} },
          get schema() {
            throw new Error("schema unavailable");
          }
        }
      }
    };

    expect(() => runReferenceLookup({ uuid: "Actor.zzzzzzzzzzzzzzzz", scope: ["scene"] })).toThrow(
      "schema unavailable"
    );
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

  it("finds a UUID used as an object key, both as Foundry stores dotted keys and as a literal key", () => {
    globalThis.game.items = collection("Item", [
      {
        _id: "dddddddddddddddd",
        name: "Tracker",
        flags: { world: { Actor: { [ACTOR_ID]: { seen: true } } } },
        effects: []
      }
    ]);
    globalThis.game.settings = settings([
      {
        _id: "setting000000001",
        key: "mod.links",
        value: JSON.stringify({
          [`Actor.${ACTOR_ID}`]: ["note"],
          [`Actor.${ACTOR_ID}.Item.itemaaaaaaaaaaaa`]: 1
        })
      }
    ]);

    const result = runReferenceLookup({ uuid: `Actor.${ACTOR_ID}`, scope: ["item", "setting"] });
    expect(rows(result)).toEqual([
      ["Item.dddddddddddddddd", `flags.world.Actor.${ACTOR_ID}`, "key", null],
      ["Setting.setting000000001", `value.Actor.${ACTOR_ID}`, "key", null],
      [
        "Setting.setting000000001",
        `value.Actor.${ACTOR_ID}.Item.itemaaaaaaaaaaaa`,
        "key",
        `Actor.${ACTOR_ID}.Item.itemaaaaaaaaaaaa`
      ]
    ]);
  });

  it("matches no key that only contains the id or spells a longer UUID", () => {
    globalThis.game.items = collection("Item", [
      {
        _id: "dddddddddddddddd",
        name: "Noise",
        flags: {
          world: {
            [ACTOR_ID]: 1,
            [`${ACTOR_ID}x`]: 1,
            [`note ${ACTOR_ID}`]: 1,
            Actor: { [`${ACTOR_ID}x`]: 1 },
            Compendium: { world: { monsters: { Actor: { [ACTOR_ID]: 1 } } } },
            Scene: { scene00000000001: { Token: { token00000000001: { Actor: { [ACTOR_ID]: 1 } } } } },
            [`Compendium.world.monsters.Actor.${ACTOR_ID}`]: 1
          }
        },
        effects: []
      }
    ]);

    expect(runReferenceLookup({ uuid: `Actor.${ACTOR_ID}`, scope: ["item"] }).total).toBe(0);
  });

  it("scans folders by default, so a child folder's parent link is found", () => {
    globalThis.game.folders = collection("Folder", [
      { _id: "folder0000000001", name: "Parent", folder: null },
      { _id: "folder0000000002", name: "Child", folder: "folder0000000001" }
    ]);

    const result = runReferenceLookup({ uuid: "Folder.folder0000000001" });
    expect(rows(result)).toEqual([["Folder.folder0000000002", "folder", "id", null]]);
    expect(runReferenceLookup({ uuid: "Folder.folder0000000001", scope: ["actor"] }).total).toBe(0);
    expect(runReferenceLookup({ uuid: "Folder.folder0000000001", scope: ["folder"] }).scannedDocuments).toBe(
      2
    );
  });

  it("finds a user's hotbar slot that holds the target macro and no other slot", () => {
    globalThis.game.users = collection("User", [
      { _id: "user000000000001", name: "Player", hotbar: { 1: "macro00000000001", 2: "macro00000000002" } }
    ]);

    expect(rows(runReferenceLookup({ uuid: "Macro.macro00000000001", scope: ["macro"] }))).toEqual([
      ["User.user000000000001", "hotbar.1", "id", null]
    ]);
    expect(
      runReferenceLookup({ uuid: "Compendium.world.macros.Macro.macro00000000001", scope: ["macro"] }).total
    ).toBe(0);
  });

  it("scans world and user settings by their stored text, named by key, and never client settings", () => {
    globalThis.game.settings = settings([
      { _id: "setting000000001", key: "mod.boss", value: JSON.stringify({ boss: `Actor.${ACTOR_ID}` }) },
      { _id: "setting000000002", key: "mod.raw", value: `not json @UUID[Actor.${ACTOR_ID}]` },
      { _id: "setting000000003", key: "mod.mine", user: "user000000000001", value: "null" }
    ]);

    const result = runReferenceLookup({ uuid: `Actor.${ACTOR_ID}`, scope: ["setting"] });
    expect(result.references.map((ref) => [ref.uuid, ref.name, ref.field, ref.match])).toEqual([
      ["Setting.setting000000001", "mod.boss", "value.boss", "uuid"],
      ["Setting.setting000000002", "mod.raw", "value", "link"]
    ]);
    expect(result.scannedDocuments).toBe(3);
    expect(rows(runReferenceLookup({ uuid: "User.user000000000001", scope: ["setting"] }))).toEqual([
      ["Setting.setting000000003", "user", "id", null]
    ]);
  });

  it("scans chat messages only when the chat scope is requested", () => {
    globalThis.game.messages = collection("ChatMessage", [
      {
        _id: "message000000001",
        content: `<p>@UUID[Actor.${ACTOR_ID}]{Boss}</p>`,
        speaker: { scene: null, actor: ACTOR_ID, token: null }
      }
    ]);

    const byDefault = runReferenceLookup({ uuid: `Actor.${ACTOR_ID}` });
    expect(byDefault.scopes).not.toContain("chat");
    expect(byDefault.references.some((ref) => ref.documentName === "ChatMessage")).toBe(false);
    const chat = runReferenceLookup({ uuid: `Actor.${ACTOR_ID}`, scope: ["chat"] });
    expect(chat.scopes).toEqual(["chat"]);
    expect(rows(chat)).toEqual([
      ["ChatMessage.message000000001", "content", "link", null],
      ["ChatMessage.message000000001", "speaker.actor", "id", null]
    ]);
  });

  describe("relative links", () => {
    beforeEach(() => {
      globalThis.foundry = {
        ...globalThis.foundry,
        utils: { parseUuid: vi.fn(parseRelativeUuid) },
        applications: { ux: { TextEditor: { _parseEmbedConfig: vi.fn(parseEmbedConfig) } } }
      };
      globalThis.fromUuidSync = vi.fn((uuid) => relativeDocument(uuid));
      globalThis.game.journal = collection("JournalEntry", [
        {
          _id: "journal000000001",
          name: "Lore",
          pages: [
            {
              _id: "page000000000001",
              name: "Index",
              text: {
                content:
                  "<p>@UUID[.page000000000002#lair]{Lair} and @Embed[.page000000000003 inline] and " +
                  "@Embed[caption=false uuid=.page000000000004]</p>"
              },
              flags: { world: { note: "@UUID[.page000000000002]" } }
            },
            { _id: "page000000000002", name: "Lair" },
            { _id: "page000000000003", name: "Map" },
            { _id: "page000000000004", name: "Hall" }
          ]
        },
        {
          _id: "journal000000002",
          name: "Other",
          pages: [{ _id: "page000000000001", name: "Index", text: { content: "@UUID[.page000000000002]" } }]
        }
      ]);
      globalThis.game.tables = collection("RollTable", [
        {
          _id: "table00000000001",
          name: "Loot",
          description: "@UUID[.TableResult.result0000000002]",
          results: [
            { _id: "result0000000001", description: "@UUID[.result0000000002]{Next}" },
            { _id: "result0000000002", description: "" }
          ]
        }
      ]);
    });

    it("resolves relative links against the document that stores them, in the fields Foundry enriches that way", () => {
      const lair = runReferenceLookup({
        uuid: "JournalEntry.journal000000001.JournalEntryPage.page000000000002"
      });
      expect(rows(lair)).toEqual([
        [
          "JournalEntry.journal000000001.JournalEntryPage.page000000000001",
          "text.content",
          "relative",
          "JournalEntry.journal000000001.JournalEntryPage.page000000000002"
        ]
      ]);
      expect(globalThis.foundry.utils.parseUuid).toHaveBeenCalledWith(".page000000000002", {
        relative: expect.objectContaining({
          uuid: "JournalEntry.journal000000001.JournalEntryPage.page000000000001"
        })
      });

      for (const pageId of ["page000000000003", "page000000000004"]) {
        expect(
          rows(runReferenceLookup({ uuid: `JournalEntry.journal000000001.JournalEntryPage.${pageId}` })).map(
            (row) => row.slice(1, 3)
          ),
          pageId
        ).toEqual([["text.content", "relative"]]);
      }

      const result = rows(
        runReferenceLookup({ uuid: "RollTable.table00000000001.TableResult.result0000000002" })
      );
      expect(result).toEqual([
        [
          "RollTable.table00000000001",
          "description",
          "relative",
          "RollTable.table00000000001.TableResult.result0000000002"
        ],
        [
          "RollTable.table00000000001.TableResult.result0000000001",
          "description",
          "relative",
          "RollTable.table00000000001.TableResult.result0000000002"
        ]
      ]);
    });

    it("reads embed configs through Foundry's own parser and skips one it refuses", () => {
      globalThis.foundry.applications.ux.TextEditor._parseEmbedConfig = vi.fn((raw, options) => {
        if (raw.startsWith("broken")) throw new Error("unparsable");
        return parseEmbedConfig(raw, options);
      });
      globalThis.game.journal = collection("JournalEntry", [
        {
          _id: "journal000000001",
          name: "Lore",
          pages: [
            {
              _id: "page000000000001",
              name: "Index",
              text: {
                content: "@Embed[broken .page000000000002] @Embed[.page000000000004] @UUID[.page000000000003]"
              }
            },
            { _id: "page000000000002", name: "Lair" },
            { _id: "page000000000003", name: "Map" },
            { _id: "page000000000004", name: "Hall" }
          ]
        }
      ]);

      const total = (pageId) =>
        runReferenceLookup({ uuid: `JournalEntry.journal000000001.JournalEntryPage.${pageId}` }).total;
      expect(total("page000000000002")).toBe(0);
      expect(total("page000000000003")).toBe(1);
      expect(total("page000000000004")).toBe(1);
      expect(globalThis.foundry.applications.ux.TextEditor._parseEmbedConfig).toHaveBeenCalledWith(
        ".page000000000004",
        {
          relative: expect.objectContaining({
            uuid: "JournalEntry.journal000000001.JournalEntryPage.page000000000001"
          })
        }
      );
    });

    it("matches no relative link of another journal or outside an enriched field, and counts one inside the target as self", () => {
      const lair = runReferenceLookup({
        uuid: "JournalEntry.journal000000001.JournalEntryPage.page000000000002"
      });
      expect(lair.references.map((ref) => ref.uuid)).not.toContain(
        "JournalEntry.journal000000002.JournalEntryPage.page000000000001"
      );
      expect(lair.references.some((ref) => ref.field.startsWith("flags."))).toBe(false);

      const journal = runReferenceLookup({ uuid: "JournalEntry.journal000000001", scope: ["journal"] });
      expect(journal.total).toBe(0);
      expect(journal.selfReferences).toBe(3);
    });
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
