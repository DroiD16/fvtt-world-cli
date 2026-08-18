import { afterEach, describe, expect, it, vi } from "vitest";

import { NORMALIZED_DEFAULT_DAEMON_URL, runCommand } from "./helpers/cli-harness.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fvtt-world-cli commands", () => {
  it.each([
    [["system", "ping"], "system.ping", {}],
    [["system", "info"], "system.info", {}],
    [["scene", "list"], "scene.list", {}],
    [["scene", "get", "--scene-id", "scene-1"], "scene.get", { sceneId: "scene-1" }],
    [
      [
        "scene",
        "update",
        "--scene-id",
        "scene-1",
        "--name",
        "Dungeon Level 2",
        "--active",
        "false",
        "--background-json",
        '{"src":"worlds/world-1/maps/level-2.webp"}'
      ],
      "scene.update",
      {
        sceneId: "scene-1",
        patch: {
          name: "Dungeon Level 2",
          active: false,
          background: {
            src: "worlds/world-1/maps/level-2.webp"
          }
        }
      }
    ],
    [["file", "list"], "file.list", { path: "" }],
    [["file", "stat"], "file.stat", { path: "" }],
    [
      ["file", "read", "--path", "worlds/world-1/readme.txt", "--encoding", "text"],
      "file.read",
      { path: "worlds/world-1/readme.txt", encoding: "text" }
    ],
    [["file", "mkdir", "--path", "worlds/world-1/assets"], "file.mkdir", { path: "worlds/world-1/assets" }],
    [
      ["file", "delete", "--path", "worlds/world-1/assets/x.txt"],
      "file.delete",
      { path: "worlds/world-1/assets/x.txt" }
    ],
    [
      ["file", "move", "--from", "worlds/world-1/assets/a.txt", "--to", "worlds/world-1/assets/b.txt"],
      "file.move",
      { from: "worlds/world-1/assets/a.txt", to: "worlds/world-1/assets/b.txt" }
    ],

    [
      ["file", "rename", "--from", "worlds/world-1/assets/a.txt", "--to-name", "b.txt"],
      "file.move",
      { from: "worlds/world-1/assets/a.txt", to: "worlds/world-1/assets/b.txt" }
    ],
    [["item", "list"], "item.list", {}],
    [["item", "get", "--item-id", "item-1"], "item.get", { itemId: "item-1" }],
    [
      [
        "item",
        "create",
        "--name",
        "Torch",
        "--type",
        "loot",
        "--sort",
        "10",
        "--system-json",
        '{"quantity":1}'
      ],
      "item.create",
      {
        data: {
          name: "Torch",
          type: "loot",
          sort: 10,
          system: {
            quantity: 1
          }
        }
      }
    ],
    [
      [
        "item",
        "update",
        "--item-id",
        "item-1",
        "--name",
        "Renamed Torch",
        "--clear-folder",
        "--system-json",
        '{"quantity":2}'
      ],
      "item.update",
      {
        itemId: "item-1",
        patch: {
          name: "Renamed Torch",
          folder: null,
          system: {
            quantity: 2
          }
        }
      }
    ],
    [["journal", "list"], "journal.list", {}],
    [["journal", "get", "--journal-id", "journal-1"], "journal.get", { journalId: "journal-1" }],
    [
      [
        "journal",
        "create",
        "--name",
        "Session Log",
        "--sort",
        "10",
        "--pages-json",
        '[{"name":"Entry 1","type":"text","text":{"content":"Started the session"}}]'
      ],
      "journal.create",
      {
        data: {
          name: "Session Log",
          sort: 10,
          pages: [
            {
              name: "Entry 1",
              type: "text",
              text: {
                content: "Started the session"
              }
            }
          ]
        }
      }
    ],
    [
      [
        "journal",
        "update",
        "--journal-id",
        "journal-1",
        "--name",
        "GM Notes Revised",
        "--clear-folder",
        "--pages-json",
        '[{"id":"page-1","text":{"content":"Updated secret text"}}]'
      ],
      "journal.update",
      {
        journalId: "journal-1",
        patch: {
          name: "GM Notes Revised",
          folder: null,
          pages: [
            {
              id: "page-1",
              text: {
                content: "Updated secret text"
              }
            }
          ]
        }
      }
    ],
    [["actor", "item", "list", "--actor-id", "actor-1"], "actor.item.list", { actorId: "actor-1" }],
    [
      [
        "actor",
        "item",
        "create",
        "--actor-id",
        "actor-1",
        "--name",
        "Torch",
        "--type",
        "loot",
        "--system-json",
        '{"quantity":2}'
      ],
      "actor.item.create",
      {
        actorId: "actor-1",
        data: {
          name: "Torch",
          type: "loot",
          system: {
            quantity: 2
          }
        }
      }
    ],
    [
      [
        "actor",
        "item",
        "update",
        "--actor-id",
        "actor-1",
        "--item-id",
        "actor-item-1",
        "--name",
        "Steel Shield",
        "--system-json",
        '{"armor":3}'
      ],
      "actor.item.update",
      {
        actorId: "actor-1",
        itemId: "actor-item-1",
        patch: {
          name: "Steel Shield",
          system: {
            armor: 3
          }
        }
      }
    ],
    [
      ["scene", "create", "--name", "New Scene", "--width", "1000", "--height", "800"],
      "scene.create",
      { data: { name: "New Scene", width: 1000, height: 800 } }
    ],
    [
      ["scene", "clone", "--scene-id", "scene-1", "--name", "Dungeon Copy"],
      "scene.clone",
      { sceneId: "scene-1", patch: { name: "Dungeon Copy" } }
    ],
    [["scene", "clone", "--scene-id", "scene-1"], "scene.clone", { sceneId: "scene-1" }],
    [["scene", "delete", "--scene-id", "scene-1"], "scene.delete", { sceneId: "scene-1" }],
    [
      ["scene", "delete", "--scene-id", "scene-1", "--force"],
      "scene.delete",
      { sceneId: "scene-1", force: true }
    ],

    [
      ["scene", "thumbnail", "generate", "--scene-id", "scene-1"],
      "scene.thumbnail.generate",
      { sceneId: "scene-1" }
    ],
    [
      [
        "scene",
        "thumbnail",
        "generate",
        "--scene-id",
        "scene-1",
        "--width",
        "400",
        "--height",
        "300",
        "--include-thumb"
      ],
      "scene.thumbnail.generate",
      { sceneId: "scene-1", width: 400, height: 300, includeThumb: true }
    ],
    [["scene", "fog", "reset", "--scene-id", "scene-1"], "scene.fog.reset", { sceneId: "scene-1" }],
    [["item", "delete", "--item-id", "item-1"], "item.delete", { itemId: "item-1" }],
    [
      ["item", "clone", "--item-id", "item-1", "--name", "Item Copy"],
      "item.clone",
      { itemId: "item-1", patch: { name: "Item Copy" } }
    ],
    [["item", "clone", "--item-id", "item-1"], "item.clone", { itemId: "item-1" }],
    [["journal", "delete", "--journal-id", "journal-1"], "journal.delete", { journalId: "journal-1" }],
    [
      ["journal", "clone", "--journal-id", "journal-1", "--name", "Journal Copy"],
      "journal.clone",
      { journalId: "journal-1", patch: { name: "Journal Copy" } }
    ],
    [
      ["journal", "update", "--journal-id", "journal-1", "--delete-page-ids", "page-1,page-2"],
      "journal.update",
      { journalId: "journal-1", patch: { deletePageIds: ["page-1", "page-2"] } }
    ],

    [["macro", "list"], "macro.list", {}],
    [["macro", "list", "--name", "heal"], "macro.list", { name: "heal" }],
    [["macro", "get", "--macro-id", "macro-1"], "macro.get", { macroId: "macro-1" }],
    [
      [
        "macro",
        "create",
        "--name",
        "Heal",
        "--type",
        "script",
        "--command",
        "console.log(1)",
        "--scope",
        "global"
      ],
      "macro.create",
      { data: { name: "Heal", type: "script", command: "console.log(1)", scope: "global" } }
    ],
    [
      ["macro", "update", "--macro-id", "macro-1", "--name", "Heal v2", "--command", "console.log(2)"],
      "macro.update",
      { macroId: "macro-1", patch: { name: "Heal v2", command: "console.log(2)" } }
    ],
    [
      ["macro", "update", "--macro-id", "macro-1", "--patch-json", '{"flags":{"mymod":{"-=stale":null}}}'],
      "macro.update",
      { macroId: "macro-1", patch: { flags: { mymod: { "-=stale": null } } } }
    ],
    [
      ["macro", "clone", "--macro-id", "macro-1", "--name", "Heal Copy"],
      "macro.clone",
      { macroId: "macro-1", patch: { name: "Heal Copy" } }
    ],
    [["macro", "clone", "--macro-id", "macro-1"], "macro.clone", { macroId: "macro-1" }],
    [["macro", "get-many", "--ids", "macro-1, macro-2 ,"], "macro.get-many", { ids: ["macro-1", "macro-2"] }],
    [["macro", "delete", "--macro-id", "macro-1"], "macro.delete", { macroId: "macro-1" }],
    [["playlist", "get-many", "--ids", "pl-1,pl-2"], "playlist.get-many", { ids: ["pl-1", "pl-2"] }],

    [["table", "list", "--name", "loot"], "table.list", { name: "loot" }],
    [["table", "get", "--table-id", "tbl-1"], "table.get", { tableId: "tbl-1" }],
    [["table", "get-many", "--ids", "tbl-1, tbl-2 ,"], "table.get-many", { ids: ["tbl-1", "tbl-2"] }],
    [
      [
        "table",
        "create",
        "--name",
        "Loot",
        "--formula",
        "1d6",
        "--replacement",
        "false",
        "--display-roll",
        "true",
        "--img",
        "worlds/w/loot.webp",
        "--results-json",
        '[{"name":"Sword","range":[1,3]}]'
      ],
      "table.create",
      {
        data: {
          name: "Loot",
          img: "worlds/w/loot.webp",
          formula: "1d6",
          replacement: false,
          displayRoll: true,
          results: [{ name: "Sword", range: [1, 3] }]
        }
      }
    ],

    [
      ["table", "update", "--table-id", "tbl-1", "--clear-img", "--clear-folder"],
      "table.update",
      { tableId: "tbl-1", patch: { img: null, folder: null } }
    ],

    [["cards", "list", "--name", "deck"], "cards.list", { name: "deck" }],
    [["cards", "get", "--cards-id", "crd-1"], "cards.get", { cardsId: "crd-1" }],
    [["cards", "get-many", "--ids", "crd-1, crd-2 ,"], "cards.get-many", { ids: ["crd-1", "crd-2"] }],
    [
      [
        "cards",
        "create",
        "--name",
        "Poker Deck",
        "--type",
        "deck",
        "--img",
        "worlds/w/deck.webp",
        "--display-count",
        "true",
        "--width",
        "2",
        "--cards-json",
        '[{"name":"Ace of Spades","suit":"S","value":1}]'
      ],
      "cards.create",
      {
        data: {
          name: "Poker Deck",
          type: "deck",
          img: "worlds/w/deck.webp",
          width: 2,
          displayCount: true,
          cards: [{ name: "Ace of Spades", suit: "S", value: 1 }]
        }
      }
    ],

    [
      ["cards", "update", "--cards-id", "crd-1", "--clear-img", "--clear-folder"],
      "cards.update",
      { cardsId: "crd-1", patch: { img: null, folder: null } }
    ],
    [
      ["cards", "clone", "--cards-id", "crd-1", "--name", "Copy"],
      "cards.clone",
      { cardsId: "crd-1", patch: { name: "Copy" } }
    ],
    [["cards", "delete", "--cards-id", "crd-1"], "cards.delete", { cardsId: "crd-1" }],

    [
      ["cards", "shuffle", "--cards-id", "crd-1", "--idempotency-key", "k1"],
      "cards.shuffle",
      { cardsId: "crd-1", idempotencyKey: "k1" }
    ],

    [
      ["cards", "shuffle", "--cards-id", "crd-1", "--no-chat"],
      "cards.shuffle",
      { cardsId: "crd-1", chat: false }
    ],
    [["cards", "reset", "--cards-id", "crd-1"], "cards.reset", { cardsId: "crd-1" }],
    [
      [
        "cards",
        "deal",
        "--cards-id",
        "crd-1",
        "--to",
        "crd-2, crd-3 ,",
        "--count",
        "2",
        "--how",
        "random",
        "--idempotency-key",
        "k2"
      ],
      "cards.deal",
      { cardsId: "crd-1", to: ["crd-2", "crd-3"], count: 2, how: "random", idempotencyKey: "k2" }
    ],
    [
      [
        "cards",
        "draw",
        "--cards-id",
        "crd-hand",
        "--from",
        "crd-deck",
        "--count",
        "3",
        "--idempotency-key",
        "k3"
      ],
      "cards.draw",
      { cardsId: "crd-hand", from: "crd-deck", count: 3, idempotencyKey: "k3" }
    ],
    [
      [
        "cards",
        "pass",
        "--cards-id",
        "crd-1",
        "--to",
        "crd-2",
        "--card-ids",
        "cd-1,cd-2",
        "--idempotency-key",
        "k4"
      ],
      "cards.pass",
      { cardsId: "crd-1", to: "crd-2", cardIds: ["cd-1", "cd-2"], idempotencyKey: "k4" }
    ],

    [
      ["cards", "reset", "--cards-id", "crd-1", "--no-chat"],
      "cards.reset",
      { cardsId: "crd-1", chat: false }
    ],
    [
      ["cards", "deal", "--cards-id", "crd-1", "--to", "crd-2", "--no-chat", "--idempotency-key", "k2b"],
      "cards.deal",
      { cardsId: "crd-1", to: ["crd-2"], chat: false, idempotencyKey: "k2b" }
    ],
    [
      [
        "cards",
        "draw",
        "--cards-id",
        "crd-hand",
        "--from",
        "crd-deck",
        "--no-chat",
        "--idempotency-key",
        "k3b"
      ],
      "cards.draw",
      { cardsId: "crd-hand", from: "crd-deck", chat: false, idempotencyKey: "k3b" }
    ],
    [
      [
        "cards",
        "pass",
        "--cards-id",
        "crd-1",
        "--to",
        "crd-2",
        "--card-ids",
        "cd-1",
        "--no-chat",
        "--idempotency-key",
        "k4b"
      ],
      "cards.pass",
      { cardsId: "crd-1", to: "crd-2", cardIds: ["cd-1"], chat: false, idempotencyKey: "k4b" }
    ],

    [["cards", "card", "list"], "cards.card.list", {}], // --cards-id is OPTIONAL (cross-stack listing)
    [
      ["cards", "card", "list", "--cards-id", "crd-1", "--name", "ace", "--limit", "5"],
      "cards.card.list",
      { cardsId: "crd-1", name: "ace", limit: 5 }
    ],
    [
      ["cards", "card", "get", "--cards-id", "crd-1", "--card-id", "cd-1"],
      "cards.card.get",
      { cardsId: "crd-1", cardId: "cd-1" }
    ],
    [
      [
        "cards",
        "card",
        "create",
        "--cards-id",
        "crd-1",
        "--name",
        "Ace of Spades",
        "--suit",
        "S",
        "--value",
        "1",
        "--face",
        "0",
        "--back-json",
        '{"img":"worlds/w/back.webp"}',
        "--faces-json",
        '[{"name":"Ace","img":"worlds/w/ace.webp"}]'
      ],
      "cards.card.create",
      {
        cardsId: "crd-1",
        data: {
          name: "Ace of Spades",
          suit: "S",
          value: 1,
          face: 0,
          back: { img: "worlds/w/back.webp" },
          faces: [{ name: "Ace", img: "worlds/w/ace.webp" }]
        }
      }
    ],

    [
      [
        "cards",
        "card",
        "update",
        "--cards-id",
        "crd-1",
        "--card-id",
        "cd-1",
        "--clear-face",
        "--clear-value"
      ],
      "cards.card.update",
      { cardsId: "crd-1", cardId: "cd-1", patch: { value: null, face: null } }
    ],
    [
      ["cards", "card", "update", "--cards-id", "crd-1", "--card-id", "cd-1", "--face", "1"],
      "cards.card.update",
      { cardsId: "crd-1", cardId: "cd-1", patch: { face: 1 } }
    ],
    [
      ["cards", "card", "clone", "--cards-id", "crd-1", "--card-id", "cd-1", "--name", "Copy"],
      "cards.card.clone",
      { cardsId: "crd-1", cardId: "cd-1", patch: { name: "Copy" } }
    ],
    [
      ["cards", "card", "clone", "--cards-id", "crd-1", "--card-id", "cd-1"],
      "cards.card.clone",
      { cardsId: "crd-1", cardId: "cd-1" }
    ],
    [
      ["cards", "card", "delete", "--cards-id", "crd-1", "--card-id", "cd-1"],
      "cards.card.delete",
      { cardsId: "crd-1", cardId: "cd-1" }
    ],
    [
      [
        "table",
        "update",
        "--table-id",
        "tbl-1",
        "--name",
        "Loot v2",
        "--patch-json",
        '{"flags":{"mymod":{"x":1}}}'
      ],
      "table.update",
      { tableId: "tbl-1", patch: { name: "Loot v2", flags: { mymod: { x: 1 } } } }
    ],
    [["table", "clone", "--table-id", "tbl-1"], "table.clone", { tableId: "tbl-1" }],
    [
      ["table", "clone", "--table-id", "tbl-1", "--name", "Loot Copy"],
      "table.clone",
      { tableId: "tbl-1", patch: { name: "Loot Copy" } }
    ],
    [["table", "delete", "--table-id", "tbl-1"], "table.delete", { tableId: "tbl-1" }],

    [["combat", "list"], "combat.list", {}],
    [["combat", "list", "--limit", "5", "--offset", "2"], "combat.list", { limit: 5, offset: 2 }],
    [["combat", "get", "--combat-id", "cbt-1"], "combat.get", { combatId: "cbt-1" }],

    [["combat", "create"], "combat.create", { data: {} }],
    [
      [
        "combat",
        "create",
        "--name",
        "Boss fight",
        "--type",
        "base",
        "--scene",
        "scene-1",
        "--sort",
        "3",
        "--system-json",
        '{"phase":"ambush"}'
      ],
      "combat.create",
      { data: { name: "Boss fight", scene: "scene-1", sort: 3, system: { phase: "ambush" }, type: "base" } }
    ],

    [
      ["combat", "update", "--combat-id", "cbt-1", "--clear-scene"],
      "combat.update",
      { combatId: "cbt-1", patch: { scene: null } }
    ],
    [
      [
        "combat",
        "update",
        "--combat-id",
        "cbt-1",
        "--sort",
        "9",
        "--patch-json",
        '{"flags":{"mymod":{"x":1}}}'
      ],
      "combat.update",
      { combatId: "cbt-1", patch: { sort: 9, flags: { mymod: { x: 1 } } } }
    ],
    [["combat", "delete", "--combat-id", "cbt-1"], "combat.delete", { combatId: "cbt-1" }],

    [["combat", "combatant", "list", "--combat-id", "cbt-1"], "combat.combatant.list", { combatId: "cbt-1" }],
    [
      ["combat", "combatant", "list", "--combat-id", "cbt-1", "--limit", "2", "--offset", "1"],
      "combat.combatant.list",
      { combatId: "cbt-1", limit: 2, offset: 1 }
    ],
    [
      ["combat", "combatant", "get", "--combat-id", "cbt-1", "--combatant-id", "cmb-1"],
      "combat.combatant.get",
      { combatId: "cbt-1", combatantId: "cmb-1" }
    ],

    [
      ["combat", "combatant", "create", "--combat-id", "cbt-1"],
      "combat.combatant.create",
      { combatId: "cbt-1", data: {} }
    ],
    [
      [
        "combat",
        "combatant",
        "create",
        "--combat-id",
        "cbt-1",
        "--token-id",
        "tok-1",
        "--scene-id",
        "scn-1",
        "--actor-id",
        "act-1",
        "--name",
        "Orc",
        "--initiative",
        "12",
        "--hidden",
        "true",
        "--group",
        "grp-1",
        "--round-joined",
        "3",
        "--system-json",
        '{"mine":1}'
      ],
      "combat.combatant.create",
      {
        combatId: "cbt-1",
        data: {
          tokenId: "tok-1",
          sceneId: "scn-1",
          actorId: "act-1",
          name: "Orc",
          initiative: 12,
          hidden: true,
          group: "grp-1",
          roundJoined: 3,
          system: { mine: 1 }
        }
      }
    ],

    [
      ["combat", "combatant", "create", "--combat-id", "cbt-1", "--name", ""],
      "combat.combatant.create",
      { combatId: "cbt-1", data: { name: "" } }
    ],

    [
      ["combat", "combatant", "create", "--combat-id", "cbt-1", "--img", ""],
      "combat.combatant.create",
      { combatId: "cbt-1", data: { img: "" } }
    ],
    [
      ["combat", "combatant", "update", "--combat-id", "cbt-1", "--combatant-id", "cmb-1", "--clear-group"],
      "combat.combatant.update",
      { combatId: "cbt-1", combatantId: "cmb-1", patch: { group: null } }
    ],
    [
      [
        "combat",
        "combatant",
        "update",
        "--combat-id",
        "cbt-1",
        "--combatant-id",
        "cmb-1",
        "--clear-img",
        "--clear-token",
        "--clear-actor",
        "--clear-scene",
        "--defeated",
        "true",
        "--patch-json",
        '{"flags":{"mymod":{"x":1}}}'
      ],
      "combat.combatant.update",
      {
        combatId: "cbt-1",
        combatantId: "cmb-1",
        patch: {
          img: null,
          tokenId: null,
          actorId: null,
          sceneId: null,
          defeated: true,
          flags: { mymod: { x: 1 } }
        }
      }
    ],
    [
      ["combat", "combatant", "delete", "--combat-id", "cbt-1", "--combatant-id", "cmb-1"],
      "combat.combatant.delete",
      { combatId: "cbt-1", combatantId: "cmb-1" }
    ],
    [["combat", "group", "list", "--combat-id", "cbt-1"], "combat.group.list", { combatId: "cbt-1" }],
    [
      ["combat", "group", "get", "--combat-id", "cbt-1", "--group-id", "grp-1"],
      "combat.group.get",
      { combatId: "cbt-1", groupId: "grp-1" }
    ],
    [
      ["combat", "group", "create", "--combat-id", "cbt-1"],
      "combat.group.create",
      { combatId: "cbt-1", data: {} }
    ],
    [
      [
        "combat",
        "group",
        "create",
        "--combat-id",
        "cbt-1",
        "--name",
        "Wolves",
        "--img",
        "worlds/w/g.webp",
        "--initiative",
        "9",
        "--type",
        "base"
      ],
      "combat.group.create",
      { combatId: "cbt-1", data: { name: "Wolves", img: "worlds/w/g.webp", initiative: 9, type: "base" } }
    ],

    [
      ["combat", "group", "update", "--combat-id", "cbt-1", "--group-id", "grp-1", "--clear-initiative"],
      "combat.group.update",
      { combatId: "cbt-1", groupId: "grp-1", patch: { initiative: null } }
    ],
    [
      [
        "combat",
        "group",
        "update",
        "--combat-id",
        "cbt-1",
        "--group-id",
        "grp-1",
        "--initiative",
        "4",
        "--clear-img"
      ],
      "combat.group.update",
      { combatId: "cbt-1", groupId: "grp-1", patch: { initiative: 4, img: null } }
    ],
    [
      ["combat", "group", "delete", "--combat-id", "cbt-1", "--group-id", "grp-1"],
      "combat.group.delete",
      { combatId: "cbt-1", groupId: "grp-1" }
    ],

    [["combat", "start", "--combat-id", "cbt-1"], "combat.start", { combatId: "cbt-1" }],
    [["combat", "activate", "--combat-id", "cbt-1"], "combat.activate", { combatId: "cbt-1" }],
    [
      ["combat", "reset-initiative", "--combat-id", "cbt-1"],
      "combat.reset-initiative",
      { combatId: "cbt-1" }
    ],

    [
      ["combat", "next-turn", "--combat-id", "cbt-1", "--idempotency-key", "k"],
      "combat.next-turn",
      { combatId: "cbt-1", idempotencyKey: "k" }
    ],
    [
      ["combat", "previous-turn", "--combat-id", "cbt-1", "--idempotency-key", "k"],
      "combat.previous-turn",
      { combatId: "cbt-1", idempotencyKey: "k" }
    ],
    [
      ["combat", "next-round", "--combat-id", "cbt-1", "--idempotency-key", "k", "--expected-round", "3"],
      "combat.next-round",
      { combatId: "cbt-1", expectedRound: 3, idempotencyKey: "k" }
    ],
    [
      [
        "combat",
        "previous-round",
        "--combat-id",
        "cbt-1",
        "--idempotency-key",
        "k",
        "--expected-round",
        "2",
        "--expected-turn",
        "0"
      ],
      "combat.previous-round",
      { combatId: "cbt-1", expectedRound: 2, expectedTurn: 0, idempotencyKey: "k" }
    ],

    [
      ["combat", "next-turn", "--combat-id", "cbt-1", "--idempotency-key", "k", "--expected-turn-none"],
      "combat.next-turn",
      { combatId: "cbt-1", expectedTurn: null, idempotencyKey: "k" }
    ],

    [
      ["combat", "next-turn", "--combat-id", "cbt-1", "--idempotency-key", "k", "--expected-turn", "0"],
      "combat.next-turn",
      { combatId: "cbt-1", expectedTurn: 0, idempotencyKey: "k" }
    ],
    [
      [
        "combat",
        "roll-initiative",
        "--combat-id",
        "cbt-1",
        "--idempotency-key",
        "k",
        "--combatant-ids",
        "a,b"
      ],
      "combat.roll-initiative",
      { combatId: "cbt-1", combatantIds: ["a", "b"], idempotencyKey: "k" }
    ],

    [
      ["combat", "roll-initiative", "--combat-id", "cbt-1", "--idempotency-key", "k", "--all"],
      "combat.roll-initiative",
      { combatId: "cbt-1", select: "all", idempotencyKey: "k" }
    ],
    [
      [
        "combat",
        "roll-initiative",
        "--combat-id",
        "cbt-1",
        "--idempotency-key",
        "k",
        "--npc",
        "--formula",
        "2d20kh",
        "--roll-mode",
        "gm"
      ],
      "combat.roll-initiative",
      { combatId: "cbt-1", select: "npc", formula: "2d20kh", rollMode: "gm", idempotencyKey: "k" }
    ],
    [
      ["combat", "set-initiative", "--combat-id", "cbt-1", "--combatant-id", "cmb-1", "--initiative", "17"],
      "combat.set-initiative",
      { combatId: "cbt-1", combatantId: "cmb-1", initiative: 17 }
    ],

    [
      ["combat", "set-initiative", "--combat-id", "cbt-1", "--combatant-id", "cmb-1", "--initiative", "0"],
      "combat.set-initiative",
      { combatId: "cbt-1", combatantId: "cmb-1", initiative: 0 }
    ],
    [
      ["combat", "set-initiative", "--combat-id", "cbt-1", "--combatant-id", "cmb-1", "--clear-initiative"],
      "combat.set-initiative",
      { combatId: "cbt-1", combatantId: "cmb-1", initiative: null }
    ],

    [["journal", "category", "list", "--journal-id", "j-1"], "journal.category.list", { journalId: "j-1" }],
    [
      [
        "journal",
        "category",
        "list",
        "--journal-id",
        "j-1",
        "--name",
        "chapter",
        "--limit",
        "5",
        "--offset",
        "2"
      ],
      "journal.category.list",
      { journalId: "j-1", name: "chapter", limit: 5, offset: 2 }
    ],
    [
      ["journal", "category", "get", "--journal-id", "j-1", "--category-id", "cat-1"],
      "journal.category.get",
      { journalId: "j-1", categoryId: "cat-1" }
    ],
    [
      ["journal", "category", "create", "--journal-id", "j-1", "--name", "Chapter One", "--sort", "100"],
      "journal.category.create",
      { journalId: "j-1", data: { name: "Chapter One", sort: 100 } }
    ],

    [
      ["journal", "category", "create", "--journal-id", "j-1", "--name", ""],
      "journal.category.create",
      { journalId: "j-1", data: { name: "" } }
    ],

    [
      ["journal", "category", "create", "--journal-id", "j-1", "--name", "Zero", "--sort", "0"],
      "journal.category.create",
      { journalId: "j-1", data: { name: "Zero", sort: 0 } }
    ],

    [
      [
        "journal",
        "category",
        "create",
        "--journal-id",
        "j-1",
        "--name",
        "Flagged",
        "--data-json",
        '{"flags":{"mymod":{"x":1}}}'
      ],
      "journal.category.create",
      { journalId: "j-1", data: { name: "Flagged", flags: { mymod: { x: 1 } } } }
    ],
    [
      ["journal", "category", "update", "--journal-id", "j-1", "--category-id", "cat-1", "--name", "Renamed"],
      "journal.category.update",
      { journalId: "j-1", categoryId: "cat-1", patch: { name: "Renamed" } }
    ],

    [
      ["journal", "category", "update", "--journal-id", "j-1", "--category-id", "cat-1", "--name", ""],
      "journal.category.update",
      { journalId: "j-1", categoryId: "cat-1", patch: { name: "" } }
    ],
    [
      ["journal", "category", "update", "--journal-id", "j-1", "--category-id", "cat-1", "--sort", "250"],
      "journal.category.update",
      { journalId: "j-1", categoryId: "cat-1", patch: { sort: 250 } }
    ],
    [
      ["journal", "category", "delete", "--journal-id", "j-1", "--category-id", "cat-1"],
      "journal.category.delete",
      { journalId: "j-1", categoryId: "cat-1" }
    ],

    [["table", "result", "list"], "table.result.list", {}],
    [
      ["table", "result", "list", "--table-id", "tbl-1", "--name", "sword", "--limit", "5"],
      "table.result.list",
      { tableId: "tbl-1", name: "sword", limit: 5 }
    ],
    [
      ["table", "result", "get", "--table-id", "tbl-1", "--result-id", "res-1"],
      "table.result.get",
      { tableId: "tbl-1", resultId: "res-1" }
    ],

    [
      [
        "table",
        "result",
        "create",
        "--table-id",
        "tbl-1",
        "--range",
        "1, 3",
        "--type",
        "document",
        "--document-uuid",
        "Actor.abc",
        "--weight",
        "2",
        "--drawn",
        "false",
        "--img",
        "worlds/w/row.webp"
      ],
      "table.result.create",
      {
        tableId: "tbl-1",
        data: {
          range: [1, 3],
          type: "document",
          documentUuid: "Actor.abc",
          img: "worlds/w/row.webp",
          weight: 2,
          drawn: false
        }
      }
    ],

    [
      ["table", "result", "create", "--table-id", "tbl-1", "--range", "4,4", "--name", ""],
      "table.result.create",
      { tableId: "tbl-1", data: { range: [4, 4], name: "" } }
    ],

    [
      [
        "table",
        "result",
        "update",
        "--table-id",
        "tbl-1",
        "--result-id",
        "res-1",
        "--clear-img",
        "--clear-document-uuid",
        "--range",
        "5,6"
      ],
      "table.result.update",
      { tableId: "tbl-1", resultId: "res-1", patch: { img: null, documentUuid: null, range: [5, 6] } }
    ],
    [
      [
        "table",
        "result",
        "update",
        "--table-id",
        "tbl-1",
        "--result-id",
        "res-1",
        "--patch-json",
        '{"flags":{"mymod":{"x":1}}}'
      ],
      "table.result.update",
      { tableId: "tbl-1", resultId: "res-1", patch: { flags: { mymod: { x: 1 } } } }
    ],
    [
      ["table", "result", "clone", "--table-id", "tbl-1", "--result-id", "res-1"],
      "table.result.clone",
      { tableId: "tbl-1", resultId: "res-1" }
    ],
    [
      ["table", "result", "clone", "--table-id", "tbl-1", "--result-id", "res-1", "--name", "Copy"],
      "table.result.clone",
      { tableId: "tbl-1", resultId: "res-1", patch: { name: "Copy" } }
    ],
    [
      ["table", "result", "delete", "--table-id", "tbl-1", "--result-id", "res-1"],
      "table.result.delete",
      { tableId: "tbl-1", resultId: "res-1" }
    ],

    [
      ["table", "draw", "--table-id", "tbl-1", "--idempotency-key", "draw-1"],
      "table.draw",
      { tableId: "tbl-1", idempotencyKey: "draw-1" }
    ],
    [
      [
        "table",
        "draw",
        "--table-id",
        "tbl-1",
        "--idempotency-key",
        "draw-2",
        "--count",
        "3",
        "--roll-mode",
        "gm",
        "--no-chat",
        "--no-recursive"
      ],
      "table.draw",
      { tableId: "tbl-1", idempotencyKey: "draw-2", count: 3, rollMode: "gm", chat: false, recursive: false }
    ],
    [["table", "reset", "--table-id", "tbl-1"], "table.reset", { tableId: "tbl-1" }],
    [["actor", "list"], "actor.list", {}],
    [["actor", "get", "--actor-id", "actor-1"], "actor.get", { actorId: "actor-1" }],

    [["actor", "get-many", "--ids", "actor-1, actor-2 ,"], "actor.get-many", { ids: ["actor-1", "actor-2"] }],
    [
      ["actor", "get-many", "--ids", "actor-1", "--include", "flags,items.flags"],
      "actor.get-many",
      { ids: ["actor-1"], include: ["flags", "items.flags"] }
    ],
    [["item", "get-many", "--ids", "item-1,item-2"], "item.get-many", { ids: ["item-1", "item-2"] }],
    [
      ["item", "get-many", "--ids", "item-1", "--include", "flags"],
      "item.get-many",
      { ids: ["item-1"], include: ["flags"] }
    ],
    [
      ["journal", "get-many", "--ids", "journal-1,journal-2"],
      "journal.get-many",
      { ids: ["journal-1", "journal-2"] }
    ],
    [["scene", "get-many", "--ids", "scene-1,scene-2"], "scene.get-many", { ids: ["scene-1", "scene-2"] }],
    [
      ["actor", "create", "--name", "Goblin", "--type", "npc", "--system-json", '{"hp":7}'],
      "actor.create",
      { data: { name: "Goblin", type: "npc", system: { hp: 7 } } }
    ],
    [
      ["actor", "update", "--actor-id", "actor-1", "--name", "Valeros the Bold"],
      "actor.update",
      { actorId: "actor-1", patch: { name: "Valeros the Bold" } }
    ],
    [
      ["actor", "clone", "--actor-id", "actor-1", "--name", "Valeros Copy"],
      "actor.clone",
      { actorId: "actor-1", patch: { name: "Valeros Copy" } }
    ],
    [["actor", "clone", "--actor-id", "actor-1"], "actor.clone", { actorId: "actor-1" }],
    [["actor", "delete", "--actor-id", "actor-1"], "actor.delete", { actorId: "actor-1" }],
    [
      ["actor", "delete", "--actor-id", "actor-1", "--force"],
      "actor.delete",
      { actorId: "actor-1", force: true }
    ],
    [
      ["actor", "item", "get", "--actor-id", "actor-1", "--item-id", "actor-item-1"],
      "actor.item.get",
      { actorId: "actor-1", itemId: "actor-item-1" }
    ],
    [
      ["actor", "item", "delete", "--actor-id", "actor-1", "--item-id", "actor-item-1"],
      "actor.item.delete",
      { actorId: "actor-1", itemId: "actor-item-1" }
    ],
    [
      [
        "actor",
        "item",
        "clone",
        "--actor-id",
        "actor-1",
        "--item-id",
        "actor-item-1",
        "--name",
        "Shield Copy"
      ],
      "actor.item.clone",
      { actorId: "actor-1", itemId: "actor-item-1", patch: { name: "Shield Copy" } }
    ],

    [["actor", "effect", "list", "--actor-id", "actor-1"], "actor.effect.list", { actorId: "actor-1" }],
    [["actor", "effect", "applied", "--actor-id", "actor-1"], "actor.effect.applied", { actorId: "actor-1" }],
    [
      ["actor", "effect", "get", "--actor-id", "actor-1", "--effect-id", "eff-1"],
      "actor.effect.get",
      { actorId: "actor-1", effectId: "eff-1" }
    ],
    [
      [
        "actor",
        "effect",
        "create",
        "--actor-id",
        "actor-1",
        "--data-json",
        '{"name":"Aura","transfer":true}'
      ],
      "actor.effect.create",
      { actorId: "actor-1", data: { name: "Aura", transfer: true } }
    ],
    [
      ["actor", "effect", "update", "--actor-id", "actor-1", "--effect-id", "eff-1", "--disabled", "true"],
      "actor.effect.update",
      { actorId: "actor-1", effectId: "eff-1", patch: { disabled: true } }
    ],
    [
      [
        "actor",
        "effect",
        "clone",
        "--actor-id",
        "actor-1",
        "--effect-id",
        "eff-1",
        "--patch-json",
        '{"name":"Aura 10ft"}'
      ],
      "actor.effect.clone",
      { actorId: "actor-1", effectId: "eff-1", patch: { name: "Aura 10ft" } }
    ],
    [
      ["actor", "effect", "delete", "--actor-id", "actor-1", "--effect-id", "eff-1"],
      "actor.effect.delete",
      { actorId: "actor-1", effectId: "eff-1" }
    ],

    [["item", "effect", "list", "--item-id", "item-1"], "item.effect.list", { itemId: "item-1" }],
    [
      ["item", "effect", "get", "--item-id", "item-1", "--effect-id", "eff-1"],
      "item.effect.get",
      { itemId: "item-1", effectId: "eff-1" }
    ],
    [
      ["item", "effect", "create", "--item-id", "item-1", "--name", "Aura", "--transfer", "true"],
      "item.effect.create",
      { itemId: "item-1", data: { name: "Aura", transfer: true } }
    ],
    [
      ["item", "effect", "update", "--item-id", "item-1", "--effect-id", "eff-1", "--disabled", "false"],
      "item.effect.update",
      { itemId: "item-1", effectId: "eff-1", patch: { disabled: false } }
    ],
    [
      ["item", "effect", "clone", "--item-id", "item-1", "--effect-id", "eff-1", "--name", "Aura Copy"],
      "item.effect.clone",
      { itemId: "item-1", effectId: "eff-1", patch: { name: "Aura Copy" } }
    ],
    [
      ["item", "effect", "delete", "--item-id", "item-1", "--effect-id", "eff-1"],
      "item.effect.delete",
      { itemId: "item-1", effectId: "eff-1" }
    ],

    [
      ["actor", "item", "effect", "list", "--actor-id", "actor-1", "--item-id", "actor-item-1"],
      "actor.item.effect.list",
      { actorId: "actor-1", itemId: "actor-item-1" }
    ],
    [
      [
        "actor",
        "item",
        "effect",
        "get",
        "--actor-id",
        "actor-1",
        "--item-id",
        "actor-item-1",
        "--effect-id",
        "eff-1"
      ],
      "actor.item.effect.get",
      { actorId: "actor-1", itemId: "actor-item-1", effectId: "eff-1" }
    ],
    [
      [
        "actor",
        "item",
        "effect",
        "create",
        "--actor-id",
        "actor-1",
        "--item-id",
        "actor-item-1",
        "--data-json",
        '{"name":"Aura"}'
      ],
      "actor.item.effect.create",
      { actorId: "actor-1", itemId: "actor-item-1", data: { name: "Aura" } }
    ],
    [
      [
        "actor",
        "item",
        "effect",
        "update",
        "--actor-id",
        "actor-1",
        "--item-id",
        "actor-item-1",
        "--effect-id",
        "eff-1",
        "--name",
        "Aura+"
      ],
      "actor.item.effect.update",
      { actorId: "actor-1", itemId: "actor-item-1", effectId: "eff-1", patch: { name: "Aura+" } }
    ],
    [
      [
        "actor",
        "item",
        "effect",
        "clone",
        "--actor-id",
        "actor-1",
        "--item-id",
        "actor-item-1",
        "--effect-id",
        "eff-1"
      ],
      "actor.item.effect.clone",
      { actorId: "actor-1", itemId: "actor-item-1", effectId: "eff-1" }
    ],
    [
      [
        "actor",
        "item",
        "effect",
        "delete",
        "--actor-id",
        "actor-1",
        "--item-id",
        "actor-item-1",
        "--effect-id",
        "eff-1"
      ],
      "actor.item.effect.delete",
      { actorId: "actor-1", itemId: "actor-item-1", effectId: "eff-1" }
    ],

    [
      ["scene", "token", "effect", "list", "--scene-id", "scene-1", "--token-id", "token-a"],
      "scene.token.effect.list",
      { sceneId: "scene-1", tokenId: "token-a" }
    ],
    [
      ["scene", "token", "effect", "applied", "--scene-id", "scene-1", "--token-id", "token-a"],
      "scene.token.effect.applied",
      { sceneId: "scene-1", tokenId: "token-a" }
    ],
    [
      [
        "scene",
        "token",
        "effect",
        "get",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--effect-id",
        "eff-1"
      ],
      "scene.token.effect.get",
      { sceneId: "scene-1", tokenId: "token-a", effectId: "eff-1" }
    ],
    [
      [
        "scene",
        "token",
        "effect",
        "create",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--data-json",
        '{"name":"Token Buff"}'
      ],
      "scene.token.effect.create",
      { sceneId: "scene-1", tokenId: "token-a", data: { name: "Token Buff" } }
    ],
    [
      [
        "scene",
        "token",
        "effect",
        "update",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--effect-id",
        "eff-1",
        "--disabled",
        "true"
      ],
      "scene.token.effect.update",
      { sceneId: "scene-1", tokenId: "token-a", effectId: "eff-1", patch: { disabled: true } }
    ],
    [
      [
        "scene",
        "token",
        "effect",
        "clone",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--effect-id",
        "eff-1",
        "--name",
        "Token Buff Copy"
      ],
      "scene.token.effect.clone",
      { sceneId: "scene-1", tokenId: "token-a", effectId: "eff-1", patch: { name: "Token Buff Copy" } }
    ],
    [
      [
        "scene",
        "token",
        "effect",
        "delete",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--effect-id",
        "eff-1"
      ],
      "scene.token.effect.delete",
      { sceneId: "scene-1", tokenId: "token-a", effectId: "eff-1" }
    ],

    [
      [
        "scene",
        "token",
        "item",
        "effect",
        "list",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--item-id",
        "delta-item-1"
      ],
      "scene.token.item.effect.list",
      { sceneId: "scene-1", tokenId: "token-a", itemId: "delta-item-1" }
    ],
    [
      [
        "scene",
        "token",
        "item",
        "effect",
        "get",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--item-id",
        "delta-item-1",
        "--effect-id",
        "eff-1"
      ],
      "scene.token.item.effect.get",
      { sceneId: "scene-1", tokenId: "token-a", itemId: "delta-item-1", effectId: "eff-1" }
    ],
    [
      [
        "scene",
        "token",
        "item",
        "effect",
        "create",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--item-id",
        "delta-item-1",
        "--data-json",
        '{"name":"Flaming","transfer":true}'
      ],
      "scene.token.item.effect.create",
      {
        sceneId: "scene-1",
        tokenId: "token-a",
        itemId: "delta-item-1",
        data: { name: "Flaming", transfer: true }
      }
    ],
    [
      [
        "scene",
        "token",
        "item",
        "effect",
        "update",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--item-id",
        "delta-item-1",
        "--effect-id",
        "eff-1",
        "--disabled",
        "true"
      ],
      "scene.token.item.effect.update",
      {
        sceneId: "scene-1",
        tokenId: "token-a",
        itemId: "delta-item-1",
        effectId: "eff-1",
        patch: { disabled: true }
      }
    ],
    [
      [
        "scene",
        "token",
        "item",
        "effect",
        "clone",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--item-id",
        "delta-item-1",
        "--effect-id",
        "eff-1",
        "--name",
        "Flaming Copy"
      ],
      "scene.token.item.effect.clone",
      {
        sceneId: "scene-1",
        tokenId: "token-a",
        itemId: "delta-item-1",
        effectId: "eff-1",
        patch: { name: "Flaming Copy" }
      }
    ],
    [
      [
        "scene",
        "token",
        "item",
        "effect",
        "delete",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--item-id",
        "delta-item-1",
        "--effect-id",
        "eff-1"
      ],
      "scene.token.item.effect.delete",
      { sceneId: "scene-1", tokenId: "token-a", itemId: "delta-item-1", effectId: "eff-1" }
    ],
    [["scene", "token", "list", "--scene-id", "scene-1"], "scene.token.list", { sceneId: "scene-1" }],
    [
      ["scene", "token", "get", "--scene-id", "scene-1", "--token-id", "token-a"],
      "scene.token.get",
      { sceneId: "scene-1", tokenId: "token-a" }
    ],
    [
      [
        "scene",
        "token",
        "create",
        "--scene-id",
        "scene-1",
        "--actor-id",
        "actor-1",
        "--x",
        "100",
        "--y",
        "120"
      ],
      "scene.token.create",
      { sceneId: "scene-1", data: { actorId: "actor-1", x: 100, y: 120 } }
    ],
    [
      ["scene", "token", "create", "--scene-id", "scene-1", "--actor-id", "actor-1", "--linked"],
      "scene.token.create",
      { sceneId: "scene-1", data: { actorId: "actor-1", actorLink: true } }
    ],
    [
      [
        "scene",
        "token",
        "create",
        "--scene-id",
        "scene-1",
        "--unlinked",
        "--data-json",
        '{"texture":{"src":"markers/trap.webp"}}'
      ],
      "scene.token.create",
      { sceneId: "scene-1", data: { actorLink: false, texture: { src: "markers/trap.webp" } } }
    ],
    [
      [
        "scene",
        "token",
        "update",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--x",
        "5",
        "--hidden",
        "true"
      ],
      "scene.token.update",
      { sceneId: "scene-1", tokenId: "token-a", patch: { x: 5, hidden: true } }
    ],
    [
      ["scene", "token", "clone", "--scene-id", "scene-1", "--token-id", "token-a", "--x", "9"],
      "scene.token.clone",
      { sceneId: "scene-1", tokenId: "token-a", patch: { x: 9 } }
    ],
    [
      ["scene", "token", "clone", "--scene-id", "scene-1", "--token-id", "token-a"],
      "scene.token.clone",
      { sceneId: "scene-1", tokenId: "token-a" }
    ],
    [
      ["scene", "token", "delete", "--scene-id", "scene-1", "--token-id", "token-a"],
      "scene.token.delete",
      { sceneId: "scene-1", tokenId: "token-a" }
    ],
    [
      ["scene", "token", "item", "list", "--scene-id", "scene-1", "--token-id", "token-a"],
      "scene.token.item.list",
      { sceneId: "scene-1", tokenId: "token-a" }
    ],
    [
      ["scene", "token", "item", "get", "--scene-id", "scene-1", "--token-id", "token-a", "--item-id", "i1"],
      "scene.token.item.get",
      { sceneId: "scene-1", tokenId: "token-a", itemId: "i1" }
    ],
    [
      [
        "scene",
        "token",
        "item",
        "create",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--name",
        "Flaming Longsword",
        "--type",
        "weapon",
        "--system-json",
        '{"damage":"2d6"}'
      ],
      "scene.token.item.create",
      {
        sceneId: "scene-1",
        tokenId: "token-a",
        data: { name: "Flaming Longsword", type: "weapon", system: { damage: "2d6" } }
      }
    ],
    [
      [
        "scene",
        "token",
        "item",
        "update",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--item-id",
        "i1",
        "--name",
        "Silvered Dagger"
      ],
      "scene.token.item.update",
      { sceneId: "scene-1", tokenId: "token-a", itemId: "i1", patch: { name: "Silvered Dagger" } }
    ],
    [
      [
        "scene",
        "token",
        "item",
        "clone",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--item-id",
        "i1",
        "--name",
        "Dagger Copy"
      ],
      "scene.token.item.clone",
      { sceneId: "scene-1", tokenId: "token-a", itemId: "i1", patch: { name: "Dagger Copy" } }
    ],
    [
      [
        "scene",
        "token",
        "item",
        "delete",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--item-id",
        "i1"
      ],
      "scene.token.item.delete",
      { sceneId: "scene-1", tokenId: "token-a", itemId: "i1" }
    ],
    [["scene", "tile", "list", "--scene-id", "scene-1"], "scene.tile.list", { sceneId: "scene-1" }],
    [
      ["scene", "tile", "get", "--scene-id", "scene-1", "--tile-id", "tile-a"],
      "scene.tile.get",
      { sceneId: "scene-1", tileId: "tile-a" }
    ],
    [
      [
        "scene",
        "tile",
        "create",
        "--scene-id",
        "scene-1",
        "--x",
        "10",
        "--y",
        "20",
        "--width",
        "200",
        "--height",
        "200",
        "--data-json",
        '{"texture":{"src":"tiles/wall.webp"}}'
      ],
      "scene.tile.create",
      {
        sceneId: "scene-1",
        data: { x: 10, y: 20, width: 200, height: 200, texture: { src: "tiles/wall.webp" } }
      }
    ],
    [
      ["scene", "tile", "update", "--scene-id", "scene-1", "--tile-id", "tile-a", "--hidden", "true"],
      "scene.tile.update",
      { sceneId: "scene-1", tileId: "tile-a", patch: { hidden: true } }
    ],
    [
      ["scene", "tile", "clone", "--scene-id", "scene-1", "--tile-id", "tile-a", "--x", "500"],
      "scene.tile.clone",
      { sceneId: "scene-1", tileId: "tile-a", patch: { x: 500 } }
    ],
    [
      ["scene", "tile", "delete", "--scene-id", "scene-1", "--tile-id", "tile-a"],
      "scene.tile.delete",
      { sceneId: "scene-1", tileId: "tile-a" }
    ],
    [["scene", "sound", "list", "--scene-id", "scene-1"], "scene.sound.list", { sceneId: "scene-1" }],
    [
      ["scene", "sound", "get", "--scene-id", "scene-1", "--sound-id", "sound-a"],
      "scene.sound.get",
      { sceneId: "scene-1", soundId: "sound-a" }
    ],
    [
      ["scene", "sound", "create", "--scene-id", "scene-1", "--path", "sounds/rain.ogg", "--radius", "20"],
      "scene.sound.create",
      { sceneId: "scene-1", data: { path: "sounds/rain.ogg", radius: 20 } }
    ],
    [
      ["scene", "sound", "update", "--scene-id", "scene-1", "--sound-id", "sound-a", "--volume", "0.9"],
      "scene.sound.update",
      { sceneId: "scene-1", soundId: "sound-a", patch: { volume: 0.9 } }
    ],
    [
      ["scene", "sound", "clone", "--scene-id", "scene-1", "--sound-id", "sound-a", "--radius", "99"],
      "scene.sound.clone",
      { sceneId: "scene-1", soundId: "sound-a", patch: { radius: 99 } }
    ],
    [
      ["scene", "sound", "delete", "--scene-id", "scene-1", "--sound-id", "sound-a"],
      "scene.sound.delete",
      { sceneId: "scene-1", soundId: "sound-a" }
    ],
    [["scene", "wall", "list", "--scene-id", "scene-1"], "scene.wall.list", { sceneId: "scene-1" }],
    [
      ["scene", "wall", "list", "--scene-id", "scene-1", "--door"],
      "scene.wall.list",
      { sceneId: "scene-1", door: true }
    ],
    [
      ["scene", "wall", "get", "--scene-id", "scene-1", "--wall-id", "wall-a"],
      "scene.wall.get",
      { sceneId: "scene-1", wallId: "wall-a" }
    ],
    [
      [
        "scene",
        "wall",
        "create",
        "--scene-id",
        "scene-1",
        "--data-json",
        '{"c":[0,0,100,0],"door":1,"doorSound":"woodBasic"}'
      ],
      "scene.wall.create",
      { sceneId: "scene-1", data: { c: [0, 0, 100, 0], door: 1, doorSound: "woodBasic" } }
    ],
    [
      [
        "scene",
        "wall",
        "update",
        "--scene-id",
        "scene-1",
        "--wall-id",
        "wall-a",
        "--patch-json",
        '{"doorSound":"stoneBasic"}'
      ],
      "scene.wall.update",
      { sceneId: "scene-1", wallId: "wall-a", patch: { doorSound: "stoneBasic" } }
    ],
    [
      ["scene", "wall", "clone", "--scene-id", "scene-1", "--wall-id", "wall-a", "--patch-json", '{"ds":1}'],
      "scene.wall.clone",
      { sceneId: "scene-1", wallId: "wall-a", patch: { ds: 1 } }
    ],
    [
      ["scene", "wall", "delete", "--scene-id", "scene-1", "--wall-id", "wall-a"],
      "scene.wall.delete",
      { sceneId: "scene-1", wallId: "wall-a" }
    ],

    [
      [
        "scene",
        "wall",
        "create-many",
        "--scene-id",
        "scene-1",
        "--data-json",
        '[{"c":[0,0,100,0]},{"c":[0,0,0,100],"door":1}]'
      ],
      "scene.wall.create-many",
      { sceneId: "scene-1", data: [{ c: [0, 0, 100, 0] }, { c: [0, 0, 0, 100], door: 1 }] }
    ],
    [
      [
        "scene",
        "wall",
        "update-many",
        "--scene-id",
        "scene-1",
        "--patches-json",
        '[{"id":"wall-a","patch":{"door":1}},{"id":"wall-b","patch":{"ds":1}}]'
      ],
      "scene.wall.update-many",
      {
        sceneId: "scene-1",
        patches: [
          { id: "wall-a", patch: { door: 1 } },
          { id: "wall-b", patch: { ds: 1 } }
        ]
      }
    ],
    [
      ["scene", "wall", "delete-many", "--scene-id", "scene-1", "--ids", "wall-a,wall-b"],
      "scene.wall.delete-many",
      { sceneId: "scene-1", ids: ["wall-a", "wall-b"] }
    ],

    [
      [
        "scene",
        "token",
        "create-many",
        "--scene-id",
        "scene-1",
        "--data-json",
        '[{"actorId":"actor-1","x":10,"y":20},{"name":"Trap","x":0,"y":0}]'
      ],
      "scene.token.create-many",
      {
        sceneId: "scene-1",
        data: [
          { actorId: "actor-1", x: 10, y: 20 },
          { name: "Trap", x: 0, y: 0 }
        ]
      }
    ],
    [
      [
        "scene",
        "token",
        "update-many",
        "--scene-id",
        "scene-1",
        "--patches-json",
        '[{"id":"token-a","patch":{"x":42}}]'
      ],
      "scene.token.update-many",
      { sceneId: "scene-1", patches: [{ id: "token-a", patch: { x: 42 } }] }
    ],
    [
      ["scene", "token", "delete-many", "--scene-id", "scene-1", "--ids", "token-a,token-b"],
      "scene.token.delete-many",
      { sceneId: "scene-1", ids: ["token-a", "token-b"] }
    ],
    [
      [
        "scene",
        "tile",
        "create-many",
        "--scene-id",
        "scene-1",
        "--data-json",
        '[{"x":1,"y":2},{"x":3,"y":4}]'
      ],
      "scene.tile.create-many",
      {
        sceneId: "scene-1",
        data: [
          { x: 1, y: 2 },
          { x: 3, y: 4 }
        ]
      }
    ],
    [
      [
        "scene",
        "tile",
        "update-many",
        "--scene-id",
        "scene-1",
        "--patches-json",
        '[{"id":"tile-a","patch":{"x":9}}]'
      ],
      "scene.tile.update-many",
      { sceneId: "scene-1", patches: [{ id: "tile-a", patch: { x: 9 } }] }
    ],
    [
      ["scene", "tile", "delete-many", "--scene-id", "scene-1", "--ids", "tile-a"],
      "scene.tile.delete-many",
      { sceneId: "scene-1", ids: ["tile-a"] }
    ],
    [
      [
        "scene",
        "sound",
        "create-many",
        "--scene-id",
        "scene-1",
        "--data-json",
        '[{"path":"a.ogg"},{"path":"b.ogg","volume":0.2}]'
      ],
      "scene.sound.create-many",
      { sceneId: "scene-1", data: [{ path: "a.ogg" }, { path: "b.ogg", volume: 0.2 }] }
    ],
    [
      [
        "scene",
        "sound",
        "update-many",
        "--scene-id",
        "scene-1",
        "--patches-json",
        '[{"id":"snd-a","patch":{"volume":0.9}}]'
      ],
      "scene.sound.update-many",
      { sceneId: "scene-1", patches: [{ id: "snd-a", patch: { volume: 0.9 } }] }
    ],
    [
      ["scene", "sound", "delete-many", "--scene-id", "scene-1", "--ids", "snd-a,snd-b"],
      "scene.sound.delete-many",
      { sceneId: "scene-1", ids: ["snd-a", "snd-b"] }
    ],
    [
      [
        "scene",
        "note",
        "create-many",
        "--scene-id",
        "scene-1",
        "--data-json",
        '[{"x":1,"y":2,"text":"Pin"}]'
      ],
      "scene.note.create-many",
      { sceneId: "scene-1", data: [{ x: 1, y: 2, text: "Pin" }] }
    ],
    [
      [
        "scene",
        "note",
        "update-many",
        "--scene-id",
        "scene-1",
        "--patches-json",
        '[{"id":"note-a","patch":{"text":"Renamed"}}]'
      ],
      "scene.note.update-many",
      { sceneId: "scene-1", patches: [{ id: "note-a", patch: { text: "Renamed" } }] }
    ],
    [
      ["scene", "note", "delete-many", "--scene-id", "scene-1", "--ids", "note-a"],
      "scene.note.delete-many",
      { sceneId: "scene-1", ids: ["note-a"] }
    ],
    [["scene", "note", "list", "--scene-id", "scene-1"], "scene.note.list", { sceneId: "scene-1" }],
    [
      ["scene", "note", "get", "--scene-id", "scene-1", "--note-id", "note-a"],
      "scene.note.get",
      { sceneId: "scene-1", noteId: "note-a" }
    ],
    [
      [
        "scene",
        "note",
        "create",
        "--scene-id",
        "scene-1",
        "--data-json",
        '{"entryId":"j1","x":10,"y":20,"iconSize":40,"text":"Pin","texture":{"src":"icons/svg/book.svg"}}'
      ],
      "scene.note.create",
      {
        sceneId: "scene-1",
        data: {
          entryId: "j1",
          x: 10,
          y: 20,
          iconSize: 40,
          text: "Pin",
          texture: { src: "icons/svg/book.svg" }
        }
      }
    ],
    [
      [
        "scene",
        "note",
        "update",
        "--scene-id",
        "scene-1",
        "--note-id",
        "note-a",
        "--patch-json",
        '{"texture":{"src":"icons/svg/info.svg"}}'
      ],
      "scene.note.update",
      { sceneId: "scene-1", noteId: "note-a", patch: { texture: { src: "icons/svg/info.svg" } } }
    ],
    [
      ["scene", "note", "clone", "--scene-id", "scene-1", "--note-id", "note-a", "--patch-json", '{"x":99}'],
      "scene.note.clone",
      { sceneId: "scene-1", noteId: "note-a", patch: { x: 99 } }
    ],
    [
      ["scene", "note", "delete", "--scene-id", "scene-1", "--note-id", "note-a"],
      "scene.note.delete",
      { sceneId: "scene-1", noteId: "note-a" }
    ],
    [["scene", "drawing", "list", "--scene-id", "scene-1"], "scene.drawing.list", { sceneId: "scene-1" }],
    [
      ["scene", "drawing", "get", "--scene-id", "scene-1", "--drawing-id", "draw-a"],
      "scene.drawing.get",
      { sceneId: "scene-1", drawingId: "draw-a" }
    ],
    [
      [
        "scene",
        "drawing",
        "create",
        "--scene-id",
        "scene-1",
        "--data-json",
        '{"x":10,"y":20,"text":"Zone","shape":{"type":"r","width":100,"height":80}}'
      ],
      "scene.drawing.create",
      {
        sceneId: "scene-1",
        data: { x: 10, y: 20, text: "Zone", shape: { type: "r", width: 100, height: 80 } }
      }
    ],
    [
      [
        "scene",
        "drawing",
        "update",
        "--scene-id",
        "scene-1",
        "--drawing-id",
        "draw-a",
        "--patch-json",
        '{"text":"Renamed"}'
      ],
      "scene.drawing.update",
      { sceneId: "scene-1", drawingId: "draw-a", patch: { text: "Renamed" } }
    ],
    [
      [
        "scene",
        "drawing",
        "clone",
        "--scene-id",
        "scene-1",
        "--drawing-id",
        "draw-a",
        "--patch-json",
        '{"x":99}'
      ],
      "scene.drawing.clone",
      { sceneId: "scene-1", drawingId: "draw-a", patch: { x: 99 } }
    ],
    [
      ["scene", "drawing", "delete", "--scene-id", "scene-1", "--drawing-id", "draw-a"],
      "scene.drawing.delete",
      { sceneId: "scene-1", drawingId: "draw-a" }
    ],
    [["scene", "light", "list", "--scene-id", "scene-1"], "scene.light.list", { sceneId: "scene-1" }],
    [
      ["scene", "light", "get", "--scene-id", "scene-1", "--light-id", "light-a"],
      "scene.light.get",
      { sceneId: "scene-1", lightId: "light-a" }
    ],
    [
      [
        "scene",
        "light",
        "create",
        "--scene-id",
        "scene-1",
        "--data-json",
        '{"x":50,"y":60,"config":{"dim":40,"bright":20,"color":"#ff9900"}}'
      ],
      "scene.light.create",
      { sceneId: "scene-1", data: { x: 50, y: 60, config: { dim: 40, bright: 20, color: "#ff9900" } } }
    ],
    [
      [
        "scene",
        "light",
        "update",
        "--scene-id",
        "scene-1",
        "--light-id",
        "light-a",
        "--patch-json",
        '{"config":{"dim":10}}'
      ],
      "scene.light.update",
      { sceneId: "scene-1", lightId: "light-a", patch: { config: { dim: 10 } } }
    ],
    [
      [
        "scene",
        "light",
        "clone",
        "--scene-id",
        "scene-1",
        "--light-id",
        "light-a",
        "--patch-json",
        '{"x":11}'
      ],
      "scene.light.clone",
      { sceneId: "scene-1", lightId: "light-a", patch: { x: 11 } }
    ],
    [
      ["scene", "light", "delete", "--scene-id", "scene-1", "--light-id", "light-a"],
      "scene.light.delete",
      { sceneId: "scene-1", lightId: "light-a" }
    ],
    [["scene", "template", "list", "--scene-id", "scene-1"], "scene.template.list", { sceneId: "scene-1" }],
    [
      ["scene", "template", "get", "--scene-id", "scene-1", "--template-id", "tpl-a"],
      "scene.template.get",
      { sceneId: "scene-1", templateId: "tpl-a" }
    ],
    [
      [
        "scene",
        "template",
        "create",
        "--scene-id",
        "scene-1",
        "--data-json",
        '{"t":"circle","x":100,"y":100,"distance":20}'
      ],
      "scene.template.create",
      { sceneId: "scene-1", data: { t: "circle", x: 100, y: 100, distance: 20 } }
    ],
    [
      [
        "scene",
        "template",
        "update",
        "--scene-id",
        "scene-1",
        "--template-id",
        "tpl-a",
        "--patch-json",
        '{"distance":30}'
      ],
      "scene.template.update",
      { sceneId: "scene-1", templateId: "tpl-a", patch: { distance: 30 } }
    ],
    [
      [
        "scene",
        "template",
        "clone",
        "--scene-id",
        "scene-1",
        "--template-id",
        "tpl-a",
        "--patch-json",
        '{"x":7}'
      ],
      "scene.template.clone",
      { sceneId: "scene-1", templateId: "tpl-a", patch: { x: 7 } }
    ],
    [
      ["scene", "template", "delete", "--scene-id", "scene-1", "--template-id", "tpl-a"],
      "scene.template.delete",
      { sceneId: "scene-1", templateId: "tpl-a" }
    ],
    [["scene", "region", "list", "--scene-id", "scene-1"], "scene.region.list", { sceneId: "scene-1" }],
    [
      ["scene", "region", "list", "--scene-id", "scene-1", "--name", "Trap"],
      "scene.region.list",
      { sceneId: "scene-1", name: "Trap" }
    ],
    [
      ["scene", "region", "get", "--scene-id", "scene-1", "--region-id", "reg-a"],
      "scene.region.get",
      { sceneId: "scene-1", regionId: "reg-a" }
    ],
    [
      [
        "scene",
        "region",
        "create",
        "--scene-id",
        "scene-1",
        "--data-json",
        '{"name":"Trap","shapes":[{"type":"rectangle","x":0,"y":0,"width":100,"height":100}]}'
      ],
      "scene.region.create",
      {
        sceneId: "scene-1",
        data: { name: "Trap", shapes: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 100 }] }
      }
    ],
    [
      [
        "scene",
        "region",
        "update",
        "--scene-id",
        "scene-1",
        "--region-id",
        "reg-a",
        "--patch-json",
        '{"color":"#00ff00"}'
      ],
      "scene.region.update",
      { sceneId: "scene-1", regionId: "reg-a", patch: { color: "#00ff00" } }
    ],
    [
      [
        "scene",
        "region",
        "clone",
        "--scene-id",
        "scene-1",
        "--region-id",
        "reg-a",
        "--patch-json",
        '{"name":"Trap 2"}'
      ],
      "scene.region.clone",
      { sceneId: "scene-1", regionId: "reg-a", patch: { name: "Trap 2" } }
    ],
    [
      ["scene", "region", "delete", "--scene-id", "scene-1", "--region-id", "reg-a"],
      "scene.region.delete",
      { sceneId: "scene-1", regionId: "reg-a" }
    ],

    [
      ["scene", "region", "behavior", "list", "--scene-id", "scene-1", "--region-id", "reg-a"],
      "scene.region.behavior.list",
      { sceneId: "scene-1", regionId: "reg-a" }
    ],
    [
      [
        "scene",
        "region",
        "behavior",
        "list",
        "--scene-id",
        "scene-1",
        "--region-id",
        "reg-a",
        "--name",
        "Dim"
      ],
      "scene.region.behavior.list",
      { sceneId: "scene-1", regionId: "reg-a", name: "Dim" }
    ],
    [
      [
        "scene",
        "region",
        "behavior",
        "get",
        "--scene-id",
        "scene-1",
        "--region-id",
        "reg-a",
        "--behavior-id",
        "beh-1"
      ],
      "scene.region.behavior.get",
      { sceneId: "scene-1", regionId: "reg-a", behaviorId: "beh-1" }
    ],
    [
      [
        "scene",
        "region",
        "behavior",
        "create",
        "--scene-id",
        "scene-1",
        "--region-id",
        "reg-a",
        "--type",
        "adjustDarknessLevel",
        "--name",
        "Dim",
        "--system-json",
        '{"darknessLevel":0.5}'
      ],
      "scene.region.behavior.create",
      {
        sceneId: "scene-1",
        regionId: "reg-a",
        data: { type: "adjustDarknessLevel", name: "Dim", system: { darknessLevel: 0.5 } }
      }
    ],

    [
      [
        "scene",
        "region",
        "behavior",
        "create",
        "--scene-id",
        "scene-1",
        "--region-id",
        "reg-a",
        "--type",
        "pauseGame",
        "--name",
        ""
      ],
      "scene.region.behavior.create",
      { sceneId: "scene-1", regionId: "reg-a", data: { type: "pauseGame", name: "" } }
    ],
    [
      [
        "scene",
        "region",
        "behavior",
        "update",
        "--scene-id",
        "scene-1",
        "--region-id",
        "reg-a",
        "--behavior-id",
        "beh-1",
        "--disabled",
        "true"
      ],
      "scene.region.behavior.update",
      { sceneId: "scene-1", regionId: "reg-a", behaviorId: "beh-1", patch: { disabled: true } }
    ],
    [
      [
        "scene",
        "region",
        "behavior",
        "update",
        "--scene-id",
        "scene-1",
        "--region-id",
        "reg-a",
        "--behavior-id",
        "beh-1",
        "--disabled",
        "false"
      ],
      "scene.region.behavior.update",
      { sceneId: "scene-1", regionId: "reg-a", behaviorId: "beh-1", patch: { disabled: false } }
    ],

    [
      [
        "scene",
        "region",
        "behavior",
        "clone",
        "--scene-id",
        "scene-1",
        "--region-id",
        "reg-a",
        "--behavior-id",
        "beh-1"
      ],
      "scene.region.behavior.clone",
      { sceneId: "scene-1", regionId: "reg-a", behaviorId: "beh-1" }
    ],
    [
      [
        "scene",
        "region",
        "behavior",
        "clone",
        "--scene-id",
        "scene-1",
        "--region-id",
        "reg-a",
        "--behavior-id",
        "beh-1",
        "--name",
        "Copy"
      ],
      "scene.region.behavior.clone",
      { sceneId: "scene-1", regionId: "reg-a", behaviorId: "beh-1", patch: { name: "Copy" } }
    ],
    [
      [
        "scene",
        "region",
        "behavior",
        "delete",
        "--scene-id",
        "scene-1",
        "--region-id",
        "reg-a",
        "--behavior-id",
        "beh-1"
      ],
      "scene.region.behavior.delete",
      { sceneId: "scene-1", regionId: "reg-a", behaviorId: "beh-1" }
    ],
    [["compendium", "list"], "compendium.list", {}],
    [["compendium", "index", "--pack", "dnd5e.monsters"], "compendium.index", { pack: "dnd5e.monsters" }],
    [
      ["compendium", "index", "--pack", "dnd5e.monsters", "--name", "Shield", "--exact"],
      "compendium.index",
      { pack: "dnd5e.monsters", name: "Shield", exact: true }
    ],
    [
      [
        "compendium",
        "index",
        "--pack",
        "dnd5e.monsters",
        "--fields",
        "flags.ddbimporter.definitionId, system.source ,"
      ],
      "compendium.index",
      { pack: "dnd5e.monsters", fields: ["flags.ddbimporter.definitionId", "system.source"] }
    ],
    [
      ["compendium", "get", "--pack", "dnd5e.monsters", "--entry-id", "arch1"],
      "compendium.get",
      { pack: "dnd5e.monsters", entryId: "arch1" }
    ],
    [["folder", "list"], "folder.list", {}],
    [["folder", "list", "--type", "Actor"], "folder.list", { type: "Actor" }],
    [
      ["folder", "create", "--name", "Test", "--type", "Actor"],
      "folder.create",
      { data: { name: "Test", type: "Actor" } }
    ],
    [
      [
        "folder",
        "create",
        "--name",
        "Beasts",
        "--type",
        "Actor",
        "--description",
        "<p>x</p>",
        "--color",
        "#ff0000",
        "--sorting",
        "m",
        "--sort",
        "50",
        "--folder",
        "parent-1"
      ],
      "folder.create",
      {
        data: {
          name: "Beasts",
          type: "Actor",
          description: "<p>x</p>",
          color: "#ff0000",
          sorting: "m",
          sort: 50,
          folder: "parent-1"
        }
      }
    ],
    [["folder", "get", "--folder-id", "f1"], "folder.get", { folderId: "f1" }],
    [
      ["folder", "update", "--folder-id", "f1", "--name", "Renamed", "--clear-color"],
      "folder.update",
      { folderId: "f1", patch: { name: "Renamed", color: null } }
    ],
    [
      ["folder", "update", "--folder-id", "f1", "--folder", "p2"],
      "folder.update",
      { folderId: "f1", patch: { folder: "p2" } }
    ],
    [
      ["folder", "update", "--folder-id", "f1", "--clear-folder"],
      "folder.update",
      { folderId: "f1", patch: { folder: null } }
    ],
    [["folder", "delete", "--folder-id", "f1"], "folder.delete", { folderId: "f1" }],
    [
      ["folder", "delete", "--folder-id", "f1", "--delete-subfolders", "--delete-contents", "--force"],
      "folder.delete",
      { folderId: "f1", deleteSubfolders: true, deleteContents: true, force: true }
    ],
    [
      [
        "actor",
        "import-from-compendium",
        "--pack",
        "dnd5e.monsters",
        "--entry-id",
        "arch1",
        "--folder",
        "f1",
        "--img",
        "drag.png",
        "--token-img",
        "drag-tok.webp"
      ],
      "actor.import-from-compendium",
      {
        pack: "dnd5e.monsters",
        entryId: "arch1",
        folder: "f1",
        patch: { img: "drag.png", prototypeToken: { texture: { src: "drag-tok.webp" } } }
      }
    ],
    [
      [
        "actor",
        "import-from-compendium",
        "--pack",
        "dnd5e.monsters",
        "--entry-id",
        "arch1",
        "--clear-folder"
      ],
      "actor.import-from-compendium",
      { pack: "dnd5e.monsters", entryId: "arch1", folder: null }
    ],

    [
      [
        "item",
        "import-from-compendium",
        "--pack",
        "dnd5e.items",
        "--entry-id",
        "it1",
        "--folder",
        "f1",
        "--img",
        "sword.png"
      ],
      "item.import-from-compendium",
      { pack: "dnd5e.items", entryId: "it1", folder: "f1", patch: { img: "sword.png" } }
    ],
    [
      [
        "journal",
        "import-from-compendium",
        "--pack",
        "dnd5e.rules",
        "--entry-id",
        "j1",
        "--name",
        "Lore",
        "--sort",
        "10"
      ],
      "journal.import-from-compendium",
      { pack: "dnd5e.rules", entryId: "j1", patch: { name: "Lore", sort: 10 } }
    ],
    [
      ["scene", "import-from-compendium", "--pack", "dnd5e.scenes", "--entry-id", "s1", "--clear-folder"],
      "scene.import-from-compendium",
      { pack: "dnd5e.scenes", entryId: "s1", folder: null }
    ],
    [
      [
        "macro",
        "import-from-compendium",
        "--pack",
        "mymodule.macros",
        "--entry-id",
        "m1",
        "--img",
        "icons/svg/dice.svg"
      ],
      "macro.import-from-compendium",
      { pack: "mymodule.macros", entryId: "m1", patch: { img: "icons/svg/dice.svg" } }
    ],
    [
      [
        "playlist",
        "import-from-compendium",
        "--pack",
        "mymodule.playlists",
        "--entry-id",
        "p1",
        "--name",
        "Ambience"
      ],
      "playlist.import-from-compendium",
      { pack: "mymodule.playlists", entryId: "p1", patch: { name: "Ambience" } }
    ],
    [
      [
        "table",
        "import-from-compendium",
        "--pack",
        "dnd5e.tables",
        "--entry-id",
        "t1",
        "--patch-json",
        '{"formula":"1d6"}'
      ],
      "table.import-from-compendium",
      { pack: "dnd5e.tables", entryId: "t1", patch: { formula: "1d6" } }
    ],

    [
      [
        "cards",
        "import-from-compendium",
        "--pack",
        "mymodule.decks",
        "--entry-id",
        "c1",
        "--name",
        "typed",
        "--patch-json",
        '{"name":"override","folder":"f2"}'
      ],
      "cards.import-from-compendium",
      { pack: "mymodule.decks", entryId: "c1", patch: { name: "override", folder: "f2" } }
    ],

    [
      [
        "actor",
        "item",
        "import-from-compendium",
        "--actor-id",
        "a1",
        "--pack",
        "dnd5e.items",
        "--entry-id",
        "it1",
        "--name",
        "Renamed",
        "--img",
        "sword.png",
        "--sort",
        "50",
        "--system-json",
        '{"damage":"1d8"}',
        "--include",
        "flags,effects"
      ],
      "actor.item.import-from-compendium",
      {
        actorId: "a1",
        pack: "dnd5e.items",
        entryId: "it1",
        patch: { name: "Renamed", img: "sword.png", sort: 50, system: { damage: "1d8" } },
        include: ["flags", "effects"]
      }
    ],

    [
      [
        "actor",
        "item",
        "import-from-compendium",
        "--actor-id",
        "a1",
        "--pack",
        "dnd5e.items",
        "--entry-id",
        "it1",
        "--img",
        "typed.png",
        "--patch-json",
        '{"img":"override.png","flags":{"mymod":{"tag":1}}}'
      ],
      "actor.item.import-from-compendium",
      {
        actorId: "a1",
        pack: "dnd5e.items",
        entryId: "it1",
        patch: { img: "override.png", flags: { mymod: { tag: 1 } } }
      }
    ],

    [
      [
        "item",
        "create",
        "--name",
        "Torch",
        "--type",
        "loot",
        "--system-json",
        '{"quantity":1}',
        "--data-json",
        '{"flags":{"my-module":{"tag":"x"}}}'
      ],
      "item.create",
      {
        data: {
          name: "Torch",
          type: "loot",
          system: { quantity: 1 },
          flags: { "my-module": { tag: "x" } }
        }
      }
    ],
    [
      ["item", "update", "--item-id", "item-1", "--patch-json", '{"flags":{"m":{"a":1}}}'],
      "item.update",
      { itemId: "item-1", patch: { flags: { m: { a: 1 } } } }
    ],

    [
      ["item", "create", "--name", "Typed", "--type", "loot", "--data-json", '{"name":"FromJson"}'],
      "item.create",
      { data: { type: "loot", name: "FromJson" } }
    ],

    [
      [
        "actor",
        "create",
        "--name",
        "Goblin",
        "--type",
        "npc",
        "--data-json",
        '{"prototypeToken":{"name":"Gob"},"flags":{"core":{"x":1}}}'
      ],
      "actor.create",
      {
        data: {
          name: "Goblin",
          type: "npc",
          prototypeToken: { name: "Gob" },
          flags: { core: { x: 1 } }
        }
      }
    ],
    [
      ["actor", "update", "--actor-id", "actor-1", "--patch-json", '{"prototypeToken":{"name":"P"}}'],
      "actor.update",
      { actorId: "actor-1", patch: { prototypeToken: { name: "P" } } }
    ],
    [
      ["journal", "create", "--name", "Log", "--data-json", '{"flags":{"j":{"k":1}}}'],
      "journal.create",
      { data: { name: "Log", flags: { j: { k: 1 } } } }
    ],
    [
      ["journal", "update", "--journal-id", "journal-1", "--patch-json", '{"flags":{"j":{"k":2}}}'],
      "journal.update",
      { journalId: "journal-1", patch: { flags: { j: { k: 2 } } } }
    ],
    [
      ["scene", "create", "--name", "Cave", "--data-json", '{"flags":{"s":{"k":1}}}'],
      "scene.create",
      { data: { name: "Cave", flags: { s: { k: 1 } } } }
    ],
    [
      ["scene", "update", "--scene-id", "scene-1", "--patch-json", '{"flags":{"s":{"k":2}}}'],
      "scene.update",
      { sceneId: "scene-1", patch: { flags: { s: { k: 2 } } } }
    ],

    [
      [
        "actor",
        "item",
        "create",
        "--actor-id",
        "actor-1",
        "--name",
        "Longsword",
        "--type",
        "weapon",
        "--system-json",
        '{"quantity":1}',
        "--data-json",
        '{"flags":{"ddbimporter":{"id":1}},"effects":[{"name":"Bless","transfer":true,"origin":"Item.abc"}]}'
      ],
      "actor.item.create",
      {
        actorId: "actor-1",
        data: {
          name: "Longsword",
          type: "weapon",
          system: { quantity: 1 },
          flags: { ddbimporter: { id: 1 } },
          effects: [{ name: "Bless", transfer: true, origin: "Item.abc" }]
        }
      }
    ],

    [
      [
        "actor",
        "item",
        "update",
        "--actor-id",
        "actor-1",
        "--item-id",
        "actor-item-1",
        "--patch-json",
        '{"flags":{"mymod":{"-=tag":null}}}'
      ],
      "actor.item.update",
      { actorId: "actor-1", itemId: "actor-item-1", patch: { flags: { mymod: { "-=tag": null } } } }
    ],

    [
      [
        "scene",
        "token",
        "item",
        "create",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-1",
        "--name",
        "Dagger",
        "--type",
        "weapon",
        "--data-json",
        '{"flags":{"midi-qol":{"x":1}},"effects":[{"name":"Poison","transfer":true}]}'
      ],
      "scene.token.item.create",
      {
        sceneId: "scene-1",
        tokenId: "token-1",
        data: {
          name: "Dagger",
          type: "weapon",
          flags: { "midi-qol": { x: 1 } },
          effects: [{ name: "Poison", transfer: true }]
        }
      }
    ],

    [
      [
        "scene",
        "token",
        "item",
        "update",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-1",
        "--item-id",
        "titem-1",
        "--patch-json",
        '{"flags":{"mymod":{"-=tag":null}}}'
      ],
      "scene.token.item.update",
      {
        sceneId: "scene-1",
        tokenId: "token-1",
        itemId: "titem-1",
        patch: { flags: { mymod: { "-=tag": null } } }
      }
    ],
    [["world", "audit-files"], "world.audit-files", {}],
    [
      ["world", "audit-files", "--scope", "scene,playlist,table", "--limit", "5", "--offset", "10"],
      "world.audit-files",
      { scope: ["scene", "playlist", "table"], limit: 5, offset: 10 }
    ],

    [["world", "search", "--query", "goblin"], "world.search", { query: "goblin", mode: "name" }],

    [
      ["world", "search", "--query", "goblin", "--mode", "full"],
      "world.search",
      { query: "goblin", mode: "full" }
    ],
    [
      [
        "world",
        "search",
        "--query",
        "goblin scout",
        "--types",
        "Actor,Token",
        "--include-compendia",
        "--source",
        "pack",
        "--limit",
        "5",
        "--offset",
        "10"
      ],
      "world.search",
      {
        query: "goblin scout",
        mode: "name",
        types: ["Actor", "Token"],
        includeCompendia: true,
        source: "pack",
        limit: 5,
        offset: 10
      }
    ],

    [["setting", "list"], "setting.list", {}],
    [["setting", "list", "--name", "token"], "setting.list", { name: "token" }],
    [["setting", "list", "--limit", "5", "--offset", "10"], "setting.list", { limit: 5, offset: 10 }],
    [
      ["setting", "get", "--namespace", "my-module", "--key", "apiKey"],
      "setting.get",
      { namespace: "my-module", key: "apiKey" }
    ],

    [["user", "list"], "user.list", {}],
    [["user", "list", "--name", "hrel"], "user.list", { name: "hrel" }],
    [["user", "get", "--user-id", "user-1"], "user.get", { userId: "user-1" }],

    [
      ["item", "ownership", "set", "--item-id", "item-1", "--default", "0"],
      "item.ownership.set",
      { itemId: "item-1", default: 0 }
    ],
    [
      ["actor", "ownership", "set", "--actor-id", "actor-1", "--users-json", '{"player-1":3}'],
      "actor.ownership.set",
      { actorId: "actor-1", users: { "player-1": 3 } }
    ],
    [
      [
        "scene",
        "ownership",
        "set",
        "--scene-id",
        "scene-1",
        "--default",
        "2",
        "--users-json",
        '{"player-1":1}'
      ],
      "scene.ownership.set",
      { sceneId: "scene-1", default: 2, users: { "player-1": 1 } }
    ],

    [
      ["table", "ownership", "set", "--table-id", "tbl-1", "--default", "2"],
      "table.ownership.set",
      { tableId: "tbl-1", default: 2 }
    ],

    [
      ["cards", "ownership", "set", "--cards-id", "crd-1", "--default", "2"],
      "cards.ownership.set",
      { cardsId: "crd-1", default: 2 }
    ],

    [
      ["journal", "ownership", "set", "--journal-id", "j-1", "--page-id", "p-1", "--default", "-1"],
      "journal.ownership.set",
      { journalId: "j-1", pageId: "p-1", default: -1 }
    ]
  ])("serializes %j to %s", async (argv, expectedCommand, expectedParams) => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {}
    }));

    const result = await runCommand(argv, sendCommand);

    expect(result.error).toBeNull();
    expect(sendCommand).toHaveBeenCalledWith({
      daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL,
      deviceCredential: expect.any(String),
      command: expectedCommand,
      params: expectedParams
    });
  });
});
