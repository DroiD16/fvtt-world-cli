import { describe, expect, it } from "vitest";

import {
  serializeActiveEffect,
  serializeActiveEffectSummary,
  serializeAmbientLight,
  serializeAmbientLightSummary,
  serializeAppliedEffectSummary,
  serializeActor,
  serializeActorSummary,
  serializeDrawing,
  serializeDrawingSummary,
  serializeCompendiumEffect,
  serializeCompendiumIndexEntry,
  serializeCompendiumPack,
  serializeSettingMetadata,
  serializeFolder,
  serializeFolderSummary,
  serializeItem,
  serializeItemSummary,
  serializeJournal,
  serializeJournalCategory,
  serializeJournalCategorySummary,
  serializeJournalPage,
  serializeJournalSummary,
  storedJournalCategoryName,
  sortJournalCategories,
  serializeChatMessage,
  serializeChatMessageSummary,
  combatOrderedCombatants,
  serializeCombat,
  serializeCombatSummary,
  serializeCombatant,
  serializeCombatantGroup,
  serializeCombatantGroupSummary,
  serializeCard,
  serializeCardSummary,
  serializeCards,
  serializeCardsSummary,
  storedCardName,
  serializeCombatantTurn,
  serializeMacro,
  serializeMacroSummary,
  serializeMeasuredTemplate,
  serializeMeasuredTemplateSummary,
  serializeNote,
  serializeNoteSummary,
  serializeRegion,
  serializeRegionBehavior,
  serializeRegionBehaviorSummary,
  serializeRegionSummary,
  serializePlaylist,
  serializePlaylistSound,
  serializePlaylistSoundSummary,
  serializePlaylistSummary,
  serializeScene,
  serializeTable,
  serializeTableSummary,
  serializeSound,
  serializeSoundSummary,
  serializeTile,
  serializeTileSummary,
  serializeToken,
  serializeTokenSummary,
  placeableName,
  tokenName,
  worldDocumentName,
  effectName,
  serializeUser,
  serializeWall,
  serializeWallSummary
} from "../scripts/lib/serializers.js";
import * as serializers from "../scripts/lib/serializers.js";

class PreparedSystem {
  constructor() {
    this.quantity = 1;
    this.derived = { computed: true };
  }

  prepareDerivedData() {
    return this;
  }
}

function assertStructuredCloneable(value) {
  expect(() => structuredClone(value)).not.toThrow();
}

describe("serializeScene", () => {
  it("prefers the plain source grid from toObject() over a runtime grid object", () => {
    class RuntimeGrid {
      constructor() {
        this.type = 1;
        this.size = 100;
      }

      getOffset() {
        return { i: 0, j: 0 };
      }
    }

    const scene = {
      id: "scene-1",
      name: "Dungeon",

      get grid() {
        throw new Error("serializeScene read the live grid accessor");
      },
      toObject() {
        return {
          _id: "scene-1",
          name: "Dungeon",
          grid: { type: 1, size: 100, distance: 5, units: "ft" }
        };
      }
    };

    const result = serializeScene(scene);

    expect(result.grid).toEqual({ type: 1, size: 100, distance: 5, units: "ft" });
    expect(typeof result.grid.getOffset).toBe("undefined");
    assertStructuredCloneable(result);
  });

  it("serializes the top-level scene fields source-first", () => {
    const scene = {
      id: "scene-1",
      name: "Cavern",

      playlist: { id: "pl-1" },
      toObject() {
        return {
          _id: "scene-1",
          name: "Cavern",
          tokenVision: true,
          weather: "rain",
          padding: 0.25,
          shiftX: 10,
          shiftY: -5,
          navName: "The Cavern",
          thumb: "worlds/w/thumbs/cavern.webp",
          foreground: "worlds/w/fg/cavern.webp",
          foregroundElevation: 20,
          sort: 300,
          initialLevel: null,
          playlist: "pl-1",
          playlistSound: null,
          journal: null,
          journalEntryPage: null,
          environment: { darkness: 0.5 },
          fog: { exploration: true },
          initial: { x: 100, y: 100, scale: 1 },
          transition: { type: "fade" }
        };
      }
    };
    const result = serializeScene(scene);
    expect(result.tokenVision).toBe(true);
    expect(result.weather).toBe("rain");
    expect(result.padding).toBe(0.25);
    expect(result.foreground).toBe("worlds/w/fg/cavern.webp");
    expect(result.foregroundElevation).toBe(20);
    expect(result.playlist).toBe("pl-1");
    expect(result.environment).toEqual({ darkness: 0.5 });
    expect(result.initial).toEqual({ x: 100, y: 100, scale: 1 });
    assertStructuredCloneable(result);
  });

  it("serializes the background texture tint (not the inert `color`) and the top-level backgroundColor from source", () => {
    const scene = {
      id: "scene-1",
      name: "Cavern",
      get backgroundColor() {
        throw new Error("serializeScene read the live backgroundColor accessor");
      },
      get background() {
        throw new Error("serializeScene read the live background accessor");
      },
      toObject() {
        return {
          _id: "scene-1",
          name: "Cavern",
          backgroundColor: "#101010",
          background: {
            src: "worlds/w/maps/cavern.webp",
            tint: "#8080ff",

            color: "#ffffff"
          }
        };
      }
    };

    const result = serializeScene(scene);
    const background = /** @type {any} */ (result.background);

    expect(background).toEqual({
      src: "worlds/w/maps/cavern.webp",
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      tint: "#8080ff"
    });
    expect("color" in background).toBe(false);
    expect(result.backgroundColor).toBe("#101010");
    assertStructuredCloneable(result);
  });

  it("defaults background tint and backgroundColor to null when absent", () => {
    const scene = {
      id: "scene-2",
      name: "Empty",
      toObject() {
        return { _id: "scene-2", name: "Empty", background: { src: "worlds/w/x.webp" } };
      }
    };

    const result = serializeScene(scene);
    const background = /** @type {any} */ (result.background);
    expect(background.tint).toBe(null);
    expect(result.backgroundColor).toBe(null);
  });

  it("reports the v14 levels-relocated fields as null when neither source nor live accessor has them (import-preview shape)", () => {
    const preview = {
      id: null,
      _id: null,
      name: "Sunken Temple",
      levels: { size: 0 },
      toObject() {
        return { _id: null, name: "Sunken Temple", width: 3000, height: 2000, levels: [] };
      }
    };

    const result = serializeScene(preview, { flags: true, provenance: true });

    expect(result.background).toBeNull();
    expect(result.backgroundColor).toBeNull();
    expect(result.foreground).toBeNull();
    expect(result.foregroundElevation).toBeNull();

    expect(result.name).toBe("Sunken Temple");
    expect(result.width).toBe(3000);
    expect(result.id).toBeNull();
    expect(result.compendiumSource).toBeNull();
    assertStructuredCloneable(result);
  });

  it("omits counts by default so scene.list rows stay counts-free", () => {
    const scene = {
      id: "scene-5",
      name: "ListRow",
      tokens: { size: 3 },
      toObject() {
        return { _id: "scene-5", name: "ListRow" };
      }
    };

    const result = serializeScene(scene);
    expect(result).not.toHaveProperty("counts");
  });

  it("omits flags by default (scene.list) but returns them when opted in (scene.get)", () => {
    const scene = {
      id: "scene-flags",
      name: "Flagged",
      toObject() {
        return { _id: "scene-flags", name: "Flagged", flags: { core: { sheetClass: "x" } } };
      }
    };

    expect(serializeScene(scene)).not.toHaveProperty("flags");

    expect(serializeScene(scene, { flags: true }).flags).toEqual({ core: { sheetClass: "x" } });
  });

  it("returns an empty flags object (never omitted) on the single-doc form when none are stored", () => {
    const scene = {
      id: "scene-noflags",
      name: "Plain",
      toObject() {
        return { _id: "scene-noflags", name: "Plain" };
      }
    };

    expect(serializeScene(scene, { flags: true }).flags).toEqual({});
  });

  it("reads embedded-collection counts from live collection sizes for all v13/v14 collections", () => {
    const collection = (size) => ({ size });
    const scene = {
      id: "scene-3",
      name: "Populated",
      tokens: collection(4),
      tiles: collection(3),
      sounds: collection(2),
      walls: collection(10),
      notes: collection(5),
      drawings: collection(1),
      lights: collection(6),
      templates: collection(0),

      levels: collection(2),
      regions: collection(2),
      toObject() {
        return { _id: "scene-3", name: "Populated" };
      }
    };

    const result = serializeScene(scene, { counts: true });
    expect(result.counts).toEqual({
      tokens: 4,
      tiles: 3,
      sounds: 2,
      walls: 10,
      notes: 5,
      drawings: 1,
      lights: 6,
      templates: 0,
      levels: 2,
      regions: 2
    });
    assertStructuredCloneable(result);
  });

  it("falls back to source array length and then 0 for missing collections", () => {
    const scene = {
      id: "scene-4",
      name: "Sparse",

      tokens: { size: 2 },
      toObject() {
        return {
          _id: "scene-4",
          name: "Sparse",
          walls: [{ _id: "w1" }, { _id: "w2" }, { _id: "w3" }]
        };
      }
    };

    const result = serializeScene(scene, { counts: true });
    expect(result.counts).toEqual({
      tokens: 2,
      tiles: 0,
      sounds: 0,
      walls: 3,
      notes: 0,
      drawings: 0,
      lights: 0,
      templates: 0,
      levels: 0,
      regions: 0
    });
  });
});

describe("serializeItem", () => {
  it("prefers the persisted source system from toObject() over the prepared live system", () => {
    const item = {
      id: "item-1",
      name: "Torch",
      type: "loot",

      get system() {
        throw new Error("serializeItem read the live system accessor");
      },
      toObject() {
        return { _id: "item-1", name: "Torch", type: "loot", system: { quantity: 2, marker: "src" } };
      }
    };

    const result = serializeItem(item);

    expect(result.system).toEqual({ quantity: 2, marker: "src" });
    expect(typeof result.system.prepareDerivedData).toBe("undefined");
    assertStructuredCloneable(result);
  });

  it("ALWAYS includes flags (from the toObject source) on the full single-doc form (complete authored state)", () => {
    const item = {
      id: "item-1",
      name: "Torch",
      type: "loot",

      get flags() {
        throw new Error("serializeItem read the live flags accessor");
      },
      toObject() {
        return {
          _id: "item-1",
          name: "Torch",
          type: "loot",
          system: {},
          flags: { dae: { macro: "burning" } }
        };
      }
    };

    const result = serializeItem(item);
    expect(result.flags).toEqual({ dae: { macro: "burning" } });

    expect("effectCount" in result).toBe(false);
    assertStructuredCloneable(result);
  });

  it("returns an empty flags object on the full form when the document has no flags", () => {
    const item = {
      id: "item-2",
      name: "Rock",
      type: "loot",
      toObject() {
        return { _id: "item-2", name: "Rock", type: "loot", system: {} };
      }
    };

    const result = serializeItem(item);
    expect(result.flags).toEqual({});
  });

  it("ALWAYS surfaces the item's OWN effects (serializeActiveEffect-shaped) on the full single-doc form", () => {
    const effect = {
      _id: "effect-1",
      name: "Burning",
      disabled: false,
      transfer: true,
      changes: [{ key: "system.hp", mode: 2, value: "-1" }],
      system: { level: 3 },
      flags: { dae: { specialDuration: [] } }
    };
    const item = {
      id: "item-1",
      name: "Torch",
      type: "loot",

      effects: [effect],
      toObject() {
        return { _id: "item-1", name: "Torch", type: "loot", system: {}, effects: [effect] };
      }
    };

    const result = serializeItem(item);
    expect(Array.isArray(result.effects)).toBe(true);
    expect(result.effects).toHaveLength(1);
    const [serialized] = result.effects;

    expect(serialized.changes).toEqual([{ key: "system.hp", mode: 2, value: "-1" }]);
    expect(serialized.system).toEqual({ level: 3 });
    expect(serialized.flags).toEqual({ dae: { specialDuration: [] } });
    expect(serialized.disabled).toBe(false);
    expect(serialized.transfer).toBe(true);
    assertStructuredCloneable(result);
  });

  it("returns an empty effects array on the full form when the document has no effects", () => {
    const item = {
      id: "item-3",
      name: "Rock",
      type: "loot",
      toObject() {
        return { _id: "item-3", name: "Rock", type: "loot", system: {} };
      }
    };

    const result = serializeItem(item);
    expect(result.effects).toEqual([]);
  });

  it("nested form (nested:true) keeps effects/flags OPT-IN and always carries effectCount", () => {
    const effect = {
      _id: "effect-1",
      name: "Burning",
      changes: [{ key: "system.hp", mode: 2, value: "-1" }]
    };
    const item = {
      id: "item-1",
      name: "Torch",
      type: "loot",
      effects: [effect],
      toObject() {
        return {
          _id: "item-1",
          name: "Torch",
          type: "loot",
          system: {},
          effects: [effect],
          flags: { dae: { x: 1 } }
        };
      }
    };

    const lean = serializeItem(item, { nested: true });
    expect("effects" in lean).toBe(false);
    expect("flags" in lean).toBe(false);
    expect(lean.effectCount).toBe(1);

    const rich = serializeItem(item, { nested: true, include: ["effects", "flags"] });
    expect(rich.effects).toHaveLength(1);
    expect(rich.flags).toEqual({ dae: { x: 1 } });
    expect(rich.effectCount).toBe(1);
  });
});

describe("serializeMacro", () => {
  it("carries the full body (command) and flags, read from the toObject() source", () => {
    const macro = {
      id: "macro-1",
      name: "Heal",
      type: "script",
      scope: "global",
      img: "heal.webp",

      get flags() {
        throw new Error("serializeMacro read the live flags accessor");
      },
      toObject() {
        return {
          _id: "macro-1",
          name: "Heal",
          type: "script",
          command: "console.log('heal');",
          scope: "global",
          img: "heal.webp",
          folder: null,
          flags: { "midi-qol": { onUseMacroName: "heal" } }
        };
      }
    };

    const result = serializeMacro(macro);

    expect(result).toEqual({
      id: "macro-1",
      _id: "macro-1",
      name: "Heal",
      type: "script",
      command: "console.log('heal');",
      img: "heal.webp",
      folder: null,
      scope: "global",
      flags: { "midi-qol": { onUseMacroName: "heal" } },

      compendiumSource: null
    });
    assertStructuredCloneable(result);
  });

  it("defaults flags to an empty object when the macro has none", () => {
    const macro = {
      id: "macro-2",
      name: "Say",
      type: "chat",
      toObject() {
        return { _id: "macro-2", name: "Say", type: "chat", command: "/roll 1d20", scope: "global" };
      }
    };

    const result = serializeMacro(macro);
    expect(result.flags).toEqual({});
    expect(result.command).toBe("/roll 1d20");
  });
});

describe("serializeMacroSummary", () => {
  it("projects identity fields and omits the command body and flags entirely", () => {
    const macro = {
      id: "macro-1",
      name: "Heal",
      type: "script",
      scope: "global",
      img: "heal.webp",

      get command() {
        throw new Error("serializeMacroSummary read the live command accessor");
      },
      get flags() {
        throw new Error("serializeMacroSummary read the live flags accessor");
      },
      toObject() {
        return {
          _id: "macro-1",
          name: "Heal",
          type: "script",
          scope: "global",
          img: "heal.webp",
          folder: null,
          command: "console.log('heal');",
          flags: { mymod: {} }
        };
      }
    };

    const result = serializeMacroSummary(macro);

    expect(result).toEqual({
      id: "macro-1",
      _id: "macro-1",
      name: "Heal",
      type: "script",
      img: "heal.webp",
      folder: null,
      scope: "global"
    });
    expect("command" in result).toBe(false);
    expect("flags" in result).toBe(false);
    assertStructuredCloneable(result);
  });
});

describe("serializeItemSummary", () => {
  it("projects identity fields and omits the system body entirely", () => {
    const item = {
      id: "item-1",
      name: "Torch",
      type: "loot",
      img: "torch.webp",
      sort: 5,

      get system() {
        throw new Error("serializeItemSummary read the live system accessor");
      },
      toObject() {
        return {
          _id: "item-1",
          name: "Torch",
          type: "loot",
          img: "torch.webp",
          sort: 5,
          system: { quantity: 2 }
        };
      }
    };

    const result = serializeItemSummary(item);

    expect(result).toEqual({
      id: "item-1",
      _id: "item-1",
      name: "Torch",
      type: "loot",
      img: "torch.webp",
      folder: null,
      sort: 5,

      effectCount: 0
    });
    expect("system" in result).toBe(false);
    assertStructuredCloneable(result);
  });

  it("adds only the requested include keys (flags/effects), never a system body", () => {
    const effect = {
      _id: "effect-1",
      name: "Bless",
      changes: [{ key: "system.ac", mode: 2, value: "1" }],
      system: {},
      flags: {}
    };
    const item = {
      id: "item-1",
      name: "Torch",
      type: "loot",
      img: "torch.webp",
      sort: 5,
      effects: [effect],
      get system() {
        throw new Error("serializeItemSummary read the live system accessor");
      },
      toObject() {
        return {
          _id: "item-1",
          name: "Torch",
          type: "loot",
          img: "torch.webp",
          sort: 5,
          system: { quantity: 2 },
          flags: { dae: { x: 1 } },
          effects: [effect]
        };
      }
    };

    const withFlags = serializeItemSummary(item, { include: ["flags"] });
    expect(withFlags.flags).toEqual({ dae: { x: 1 } });
    expect("effects" in withFlags).toBe(false);
    expect("system" in withFlags).toBe(false);

    expect(withFlags.effectCount).toBe(1);

    const withEffects = serializeItemSummary(item, { include: ["effects"] });
    expect(withEffects.effects).toHaveLength(1);
    expect(withEffects.effects[0].changes).toEqual([{ key: "system.ac", mode: 2, value: "1" }]);
    expect("flags" in withEffects).toBe(false);
    expect("system" in withEffects).toBe(false);
    expect(withEffects.effectCount).toBe(1);

    const withBoth = serializeItemSummary(item, { include: ["flags", "effects"] });
    expect(withBoth.flags).toEqual({ dae: { x: 1 } });
    expect(withBoth.effects).toHaveLength(1);
    expect("system" in withBoth).toBe(false);
    expect(withBoth.effectCount).toBe(1);
  });
});

describe("serializeJournalPage", () => {
  it("reads the page text from the toObject() source", () => {
    const page = {
      id: "page-1",
      name: "Intro",
      type: "text",
      sort: 0,
      src: null,
      toObject() {
        return {
          _id: "page-1",
          name: "Intro",
          type: "text",
          sort: 0,
          text: { content: "<p>hello</p>", markdown: null, format: 1 }
        };
      }
    };

    const result = serializeJournalPage(page);

    expect(result.text).toEqual({ content: "<p>hello</p>", markdown: null, format: 1 });
    assertStructuredCloneable(result);
  });

  it("round-trips the full page shape (title/image/video/category/flags/system) from source", () => {
    const page = {
      id: "page-2",
      name: "Cover",
      type: "image",
      sort: 100,
      src: "worlds/w/art/cover.webp",
      toObject() {
        return {
          _id: "page-2",
          name: "Cover",
          type: "image",
          sort: 100,
          src: "worlds/w/art/cover.webp",
          title: { show: true, level: 2 },
          image: { caption: "The keep at dusk" },
          video: { controls: true, volume: 0.5 },
          category: "cat-1",
          system: { dnd5e: { subtype: "map" } },
          flags: { mymod: { pinned: true } }
        };
      }
    };

    const result = serializeJournalPage(page);

    expect(result.title).toEqual({ show: true, level: 2 });
    expect(result.image).toEqual({ caption: "The keep at dusk" });
    expect(result.video).toEqual({ controls: true, volume: 0.5 });
    expect(result.category).toBe("cat-1");
    expect(result.system).toEqual({ dnd5e: { subtype: "map" } });
    expect(result.flags).toEqual({ mymod: { pinned: true } });
    assertStructuredCloneable(result);
  });

  it("defaults absent optional objects to null and system/flags to empty objects", () => {
    const page = {
      id: "page-3",
      name: "Plain",
      type: "text",
      toObject() {
        return { _id: "page-3", name: "Plain", type: "text", sort: 0 };
      }
    };

    const result = serializeJournalPage(page);
    expect(result.title).toBeNull();
    expect(result.text).toBeNull();
    expect(result.image).toBeNull();
    expect(result.video).toBeNull();
    expect(result.category).toBeNull();
    expect(result.system).toEqual({});
    expect(result.flags).toEqual({});
  });
});

describe("serializeJournal", () => {
  it("serializes pages from real child documents and stays cloneable", () => {
    const page = {
      id: "page-1",
      name: "Intro",
      type: "text",
      sort: 0,
      toObject() {
        return { _id: "page-1", name: "Intro", type: "text", sort: 0, text: { content: "<p>hi</p>" } };
      }
    };
    const journal = {
      id: "journal-1",
      name: "Lore",
      folder: null,
      sort: 0,
      pages: [page],
      toObject() {
        return { _id: "journal-1", name: "Lore", folder: null, sort: 0 };
      }
    };

    const result = serializeJournal(journal);

    expect(result.id).toBe("journal-1");
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].text).toEqual({ content: "<p>hi</p>" });
    assertStructuredCloneable(result);
  });

  it("surfaces the journal's categories as {id, name, sort?} summaries", () => {
    const journal = {
      id: "journal-2",
      name: "Bestiary",
      folder: null,
      sort: 0,
      pages: [],
      categories: [
        {
          id: "cat-1",
          name: "Beasts",
          toObject() {
            return { _id: "cat-1", name: "Beasts", sort: 10 };
          }
        },
        {
          id: "cat-2",
          name: "Undead",
          toObject() {
            return { _id: "cat-2", name: "Undead" };
          }
        }
      ],
      toObject() {
        return { _id: "journal-2", name: "Bestiary", folder: null, sort: 0 };
      }
    };

    const result = serializeJournal(journal);

    expect(result.categories).toEqual([
      { id: "cat-1", name: "Beasts", sort: 10 },
      { id: "cat-2", name: "Undead" }
    ]);
    assertStructuredCloneable(result);
  });

  it("defaults categories to an empty array when the journal has none", () => {
    const journal = {
      id: "journal-3",
      name: "Notes",
      folder: null,
      sort: 0,
      pages: [],
      toObject() {
        return { _id: "journal-3", name: "Notes", folder: null, sort: 0 };
      }
    };

    expect(serializeJournal(journal).categories).toEqual([]);
  });

  it('reports a BLANK category name as the stored "", not Foundry\'s derived localized name', () => {
    const journal = {
      id: "journal-blank-cat",
      name: "Notes",
      folder: null,
      sort: 0,
      pages: [],
      categories: [
        {
          id: "cat-blank",

          name: "Unnamed Category",
          _source: { _id: "cat-blank", name: "", sort: 5, flags: {} },
          toObject() {
            return { _id: "cat-blank", name: "", sort: 5, flags: {} };
          }
        }
      ],
      toObject() {
        return { _id: "journal-blank-cat", name: "Notes", folder: null, sort: 0 };
      }
    };
    expect(serializeJournal(journal).categories).toEqual([{ id: "cat-blank", name: "", sort: 5 }]);
  });

  it("orders categories[] by `sort` ascending, NOT by collection order, without reordering the source array", () => {
    const rawCategories = [
      { _id: "cat-two", name: "Chapter Two", sort: 200 },
      { _id: "cat-one", name: "Chapter One", sort: 100 },

      { _id: "cat-sortless", name: "Appendix" }
    ];
    const journal = {
      id: "journal-cat-order",
      name: "Ordered",
      folder: null,
      sort: 0,
      pages: [],
      toObject() {
        return {
          _id: "journal-cat-order",
          name: "Ordered",
          folder: null,
          sort: 0,
          categories: rawCategories
        };
      }
    };

    const result = serializeJournal(journal);
    expect(result.categories.map((row) => row.id)).toEqual(["cat-one", "cat-two", "cat-sortless"]);

    expect(rawCategories.map((row) => row._id)).toEqual(["cat-two", "cat-one", "cat-sortless"]);
  });

  it("breaks sortJournalCategories ties on input position: equal sorts AND sortless rows stay stable", () => {
    const rows = [
      { _id: "tie-b", sort: 100 },
      { _id: "tie-a", sort: 100 },
      { _id: "sortless-b" },
      { _id: "sortless-a" },
      { _id: "first", sort: 0 }
    ];

    expect(sortJournalCategories(rows).map((row) => row._id)).toEqual([
      "first",

      "tie-b",
      "tie-a",

      "sortless-b",
      "sortless-a"
    ]);

    expect(rows.map((row) => row._id)).toEqual(["tie-b", "tie-a", "sortless-b", "sortless-a", "first"]);
  });

  it("always returns the entry's own writable flags (complete authored state)", () => {
    const flagged = {
      id: "journal-4",
      name: "Flagged",
      folder: null,
      sort: 0,
      pages: [],
      toObject() {
        return {
          _id: "journal-4",
          name: "Flagged",
          folder: null,
          sort: 0,
          flags: { mymod: { pinned: true } }
        };
      }
    };

    expect(serializeJournal(flagged).flags).toEqual({ mymod: { pinned: true } });

    const plain = {
      id: "journal-5",
      name: "Plain",
      folder: null,
      sort: 0,
      pages: [],
      toObject() {
        return { _id: "journal-5", name: "Plain", folder: null, sort: 0 };
      }
    };

    expect(serializeJournal(plain).flags).toEqual({});
  });
});

describe("serializeJournalSummary", () => {
  it("projects page + category counts and omits the page/category bodies", () => {
    const journal = {
      id: "journal-1",
      name: "Lore",
      folder: null,
      sort: 0,
      pages: [{ id: "p1" }, { id: "p2" }],
      categories: [{ id: "c1" }],
      toObject() {
        return { _id: "journal-1", name: "Lore", folder: null, sort: 0 };
      }
    };

    const result = serializeJournalSummary(journal);

    expect(result).toEqual({
      id: "journal-1",
      _id: "journal-1",
      name: "Lore",
      folder: null,
      sort: 0,
      pageCount: 2,
      categoryCount: 1
    });
    expect("pages" in result).toBe(false);
    expect("categories" in result).toBe(false);
    assertStructuredCloneable(result);
  });
});

describe("journal category projections", () => {
  const makeCategory = (id, stored) => ({
    id,
    get name() {
      return stored.name || "Unnamed Category";
    },
    _source: { _id: id, ...stored },
    toObject() {
      return { _id: id, ...stored };
    }
  });

  it("storedJournalCategoryName returns the STORED name, blank included", () => {
    const blank = makeCategory("cat-blank", { name: "", sort: 5, flags: {} });

    expect(blank.name).toBe("Unnamed Category");
    expect(storedJournalCategoryName(blank)).toBe("");

    const named = makeCategory("cat-named", { name: "Chapter One", sort: 0, flags: {} });
    expect(storedJournalCategoryName(named)).toBe("Chapter One");
  });

  it("storedJournalCategoryName falls back to toObject() then the live accessor for a raw row", () => {
    expect(storedJournalCategoryName({ id: "c", toObject: () => ({ name: "From source" }) })).toBe(
      "From source"
    );
    expect(storedJournalCategoryName({ name: "Raw" })).toBe("Raw");
    expect(storedJournalCategoryName(null)).toBe("");
  });

  it("the FULL projection carries id/_id, the stored name, sort and flags — and NO ownership/_stats", () => {
    const category = makeCategory("cat-1", {
      name: "Chapter One",
      sort: 100,
      flags: { mymod: { colour: "blue" } }
    });
    const result = serializeJournalCategory(category);
    expect(result).toEqual({
      id: "cat-1",
      _id: "cat-1",
      name: "Chapter One",
      sort: 100,
      flags: { mymod: { colour: "blue" } }
    });

    expect(result).not.toHaveProperty("ownership");
    expect(result).not.toHaveProperty("compendiumSource");
    expect(result).not.toHaveProperty("_stats");
    assertStructuredCloneable(result);
  });

  it("the FULL projection defaults sort to 0 and flags to {} (IntegerSortField initial is 0)", () => {
    expect(serializeJournalCategory({ id: "cat-2", toObject: () => ({ _id: "cat-2", name: "X" }) })).toEqual({
      id: "cat-2",
      _id: "cat-2",
      name: "X",
      sort: 0,
      flags: {}
    });
  });

  it("the FULL projection reads the stored name for a BLANK one", () => {
    expect(serializeJournalCategory(makeCategory("cat-blank", { name: "", sort: 0, flags: {} })).name).toBe(
      ""
    );
  });

  it("the LEAN list row drops flags and keeps the id/_id mirror", () => {
    const row = serializeJournalCategorySummary(
      makeCategory("cat-1", { name: "Chapter One", sort: 100, flags: { mymod: { x: 1 } } })
    );
    expect(row).toEqual({ id: "cat-1", _id: "cat-1", name: "Chapter One", sort: 100 });

    expect(row).not.toHaveProperty("flags");
    expect(row).not.toHaveProperty("journalId");
    assertStructuredCloneable(row);
  });

  it("the LEAN list row reads the stored name for a BLANK one", () => {
    expect(
      serializeJournalCategorySummary(makeCategory("cat-blank", { name: "", sort: 3, flags: {} })).name
    ).toBe("");
  });

  it("a create PREVIEW (no _source, null id) projects null ids without fabricating one", () => {
    const preview = {
      id: null,
      name: "Appendix",
      toObject: () => ({ _id: null, name: "Appendix", sort: 0, flags: {} })
    };
    expect(serializeJournalCategory(preview)).toEqual({
      id: null,
      _id: null,
      name: "Appendix",
      sort: 0,
      flags: {}
    });
  });
});

describe("serializePlaylistSound", () => {
  it("reads volume/path source-first and carries the full field set", () => {
    const sound = {
      id: "sound-1",
      name: "Lute",

      get volume() {
        throw new Error("serializePlaylistSound read the live volume accessor");
      },
      toObject() {
        return {
          _id: "sound-1",
          name: "Lute",
          description: "gentle",
          path: "tavern/lute.ogg",
          channel: "music",
          playing: false,
          pausedTime: 0,
          repeat: true,
          volume: 0.5,
          fade: 500,
          sort: 10,
          flags: { mymod: { x: 1 } }
        };
      }
    };

    const result = serializePlaylistSound(sound);
    expect(result).toEqual({
      id: "sound-1",
      _id: "sound-1",
      name: "Lute",
      description: "gentle",
      path: "tavern/lute.ogg",
      channel: "music",
      playing: false,
      pausedTime: 0,
      repeat: true,
      volume: 0.5,
      fade: 500,
      sort: 10,

      duration: null,
      flags: { mymod: { x: 1 } }
    });
    assertStructuredCloneable(result);
  });

  it("derives duration from the live Sound instance when loaded", () => {
    const sound = {
      id: "sound-1",
      name: "Lute",
      sound: { duration: 42.5 },
      toObject() {
        return { _id: "sound-1", name: "Lute", path: "tavern/lute.ogg" };
      }
    };

    expect(serializePlaylistSound(sound).duration).toBe(42.5);
  });
});

describe("serializePlaylistSoundSummary", () => {
  it("projects a lean identity + path/name/playing + duration + playlist context, omitting flags", () => {
    const sound = {
      id: "sound-1",
      name: "Lute",
      toObject() {
        return { _id: "sound-1", name: "Lute", path: "tavern/lute.ogg", playing: true, flags: { mymod: {} } };
      }
    };

    const result = serializePlaylistSoundSummary(sound, { id: "playlist-1", name: "Tavern" });
    expect(result).toEqual({
      id: "sound-1",
      _id: "sound-1",
      name: "Lute",
      path: "tavern/lute.ogg",
      playing: true,
      duration: null,
      playlistId: "playlist-1",
      playlistName: "Tavern"
    });
    expect("flags" in result).toBe(false);
    expect("volume" in result).toBe(false);
    assertStructuredCloneable(result);
  });

  it("falls back to the sound's parent playlist and nulls when neither is present", () => {
    const withParent = {
      id: "sound-2",
      name: "Drum",
      parent: { id: "playlist-9", name: "Battle" },
      sound: { duration: 12 },
      toObject() {
        return { _id: "sound-2", name: "Drum", path: "battle/drum.ogg" };
      }
    };
    const withParentResult = serializePlaylistSoundSummary(withParent);
    expect(withParentResult).toMatchObject({
      playlistId: "playlist-9",
      playlistName: "Battle",
      duration: 12
    });

    const orphan = {
      id: "sound-3",
      name: "Solo",
      toObject() {
        return { _id: "sound-3", name: "Solo", path: "solo.ogg" };
      }
    };
    expect(serializePlaylistSoundSummary(orphan)).toMatchObject({
      playlistId: null,
      playlistName: null,
      duration: null
    });
  });
});

describe("serializePlaylist", () => {
  it("embeds its sounds and reads mode/flags source-first", () => {
    const sound = {
      id: "sound-1",
      name: "Lute",
      toObject() {
        return { _id: "sound-1", name: "Lute", path: "tavern/lute.ogg", volume: 0.5 };
      }
    };
    const playlist = {
      id: "playlist-1",
      name: "Tavern",
      sounds: [sound],
      get flags() {
        throw new Error("serializePlaylist read the live flags accessor");
      },
      toObject() {
        return {
          _id: "playlist-1",
          name: "Tavern",
          description: "cozy",
          mode: 0,
          playing: false,
          fade: 1000,
          channel: "music",
          sorting: "m",
          seed: 3,
          folder: null,
          sort: 5,
          flags: { mymod: { y: 2 } }
        };
      }
    };

    const result = serializePlaylist(playlist);
    expect(result).toMatchObject({
      id: "playlist-1",
      _id: "playlist-1",
      name: "Tavern",
      description: "cozy",
      mode: 0,
      playing: false,
      fade: 1000,
      channel: "music",
      sorting: "m",
      seed: 3,
      folder: null,
      sort: 5,
      flags: { mymod: { y: 2 } }
    });
    expect(result.sounds).toHaveLength(1);
    expect(result.sounds[0]).toMatchObject({ id: "sound-1", path: "tavern/lute.ogg", volume: 0.5 });
    assertStructuredCloneable(result);
  });
});

describe("serializePlaylistSummary", () => {
  it("projects a sound count and omits sound bodies and flags", () => {
    const playlist = {
      id: "playlist-1",
      name: "Tavern",
      sounds: [{ id: "s1" }, { id: "s2" }],
      toObject() {
        return { _id: "playlist-1", name: "Tavern", mode: 0, playing: false, flags: { mymod: {} } };
      }
    };

    const result = serializePlaylistSummary(playlist);
    expect(result).toEqual({
      id: "playlist-1",
      _id: "playlist-1",
      name: "Tavern",
      mode: 0,
      playing: false,
      soundCount: 2
    });
    expect("sounds" in result).toBe(false);
    expect("flags" in result).toBe(false);
    assertStructuredCloneable(result);
  });
});

describe("serializeActor", () => {
  it("prefers the persisted source system and the plain prototypeToken from toObject()", () => {
    const actor = {
      id: "actor-1",
      name: "Valeros",
      type: "character",

      get system() {
        throw new Error("serializeActor read the live system accessor");
      },

      items: [],
      toObject() {
        return {
          _id: "actor-1",
          name: "Valeros",
          type: "character",
          system: { hp: { value: 10, max: 10 }, marker: "src" },
          prototypeToken: { name: "Valeros", actorLink: true, texture: { src: "tok.webp" } },
          _stats: { compendiumSource: "Compendium.world.actors.abc" }
        };
      }
    };

    const result = serializeActor(actor);

    expect(result.system).toEqual({ hp: { value: 10, max: 10 }, marker: "src" });
    expect(typeof result.system.prepareDerivedData).toBe("undefined");

    expect(result.prototypeToken).toEqual({
      name: "Valeros",
      actorLink: true,
      texture: { src: "tok.webp" }
    });
    expect(result.compendiumSource).toBe("Compendium.world.actors.abc");
    assertStructuredCloneable(result);
  });

  it("returns the FULL prototypeToken source (every authored field), not a reduced view", () => {
    const proto = {
      name: "Gob",
      actorLink: false,
      disposition: -1,
      displayName: 20,
      bar1: { attribute: "attributes.hp" },
      sight: { enabled: true, range: 60, angle: 360 },
      texture: { src: "tok.webp", scaleX: 1.2, tint: "#ffffff" },
      flags: { core: { x: 1 } }
    };
    const actor = {
      id: "actor-1",
      name: "Gob",
      type: "npc",
      items: [],
      toObject() {
        return { _id: "actor-1", name: "Gob", type: "npc", system: {}, prototypeToken: proto };
      }
    };

    const result = serializeActor(actor);

    expect(result.prototypeToken).toEqual(proto);
    assertStructuredCloneable(result);
  });

  it("serializes embedded items from the live items collection without reading their live system", () => {
    const childItem = {
      id: "item-1",
      name: "Sword",
      type: "weapon",
      get system() {
        throw new Error("serializeActor->serializeItem read a live child system");
      },
      toObject() {
        return { _id: "item-1", name: "Sword", type: "weapon", system: { damage: "1d8" } };
      }
    };
    const actor = {
      id: "actor-1",
      name: "Valeros",
      type: "character",
      items: [childItem],
      toObject() {
        return { _id: "actor-1", name: "Valeros", type: "character", system: {} };
      }
    };

    const result = serializeActor(actor);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].system).toEqual({ damage: "1d8" });
    assertStructuredCloneable(result);
  });

  it("ALWAYS includes the actor's own flags (complete authored state), read from the source", () => {
    const actor = {
      id: "actor-1",
      name: "Valeros",
      type: "character",
      items: [],
      get flags() {
        throw new Error("serializeActor read the live flags accessor");
      },
      toObject() {
        return {
          _id: "actor-1",
          name: "Valeros",
          type: "character",
          system: {},
          flags: { ActiveAuras: { radius: 10 } }
        };
      }
    };

    const result = serializeActor(actor);
    expect(result.flags).toEqual({ ActiveAuras: { radius: 10 } });
    assertStructuredCloneable(result);
  });

  it("never adds flags/effects bodies to nested items, which instead carry effectCount, while the actor's own flags surface", () => {
    const childItem = {
      id: "item-1",
      name: "Sword",
      type: "weapon",
      toObject() {
        return {
          _id: "item-1",
          name: "Sword",
          type: "weapon",
          system: { damage: "1d8" },
          flags: { dae: { transfer: true } }
        };
      }
    };
    const actor = {
      id: "actor-1",
      name: "Valeros",
      type: "character",
      items: [childItem],
      toObject() {
        return {
          _id: "actor-1",
          name: "Valeros",
          type: "character",
          system: {},
          flags: { ActiveAuras: { radius: 10 } }
        };
      }
    };

    const result = serializeActor(actor);

    expect(result.flags).toEqual({ ActiveAuras: { radius: 10 } });

    expect(result.items).toHaveLength(1);
    expect("flags" in result.items[0]).toBe(false);
    expect("effects" in result.items[0]).toBe(false);
    expect(result.items[0].effectCount).toBe(0);
  });

  it("ALWAYS surfaces the actor's OWN top-level effects (complete authored state); nested items carry only effectCount", () => {
    const actorEffect = {
      _id: "aeffect-1",
      name: "Rage",
      changes: [{ key: "system.bonuses.mwak.damage", mode: 2, value: "2" }],
      system: {},
      flags: {}
    };
    const childItem = {
      id: "item-1",
      name: "Sword",
      type: "weapon",

      effects: [{ _id: "ieffect-1", name: "Flaming", changes: [], system: {}, flags: {} }],
      toObject() {
        return {
          _id: "item-1",
          name: "Sword",
          type: "weapon",
          system: { damage: "1d8" },
          effects: [{ _id: "ieffect-1", name: "Flaming", changes: [], system: {}, flags: {} }]
        };
      }
    };
    const actor = {
      id: "actor-1",
      name: "Valeros",
      type: "character",
      items: [childItem],
      effects: [actorEffect],
      toObject() {
        return {
          _id: "actor-1",
          name: "Valeros",
          type: "character",
          system: {},
          effects: [actorEffect]
        };
      }
    };

    const result = serializeActor(actor);

    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].name).toBe("Rage");
    expect(result.effects[0].changes).toEqual([{ key: "system.bonuses.mwak.damage", mode: 2, value: "2" }]);

    expect(result.items).toHaveLength(1);
    expect("effects" in result.items[0]).toBe(false);
    expect(result.items[0].effectCount).toBe(1);
    assertStructuredCloneable(result);
  });

  const buildNestedActor = () => {
    const childItem = {
      id: "item-1",
      name: "Sword",
      type: "weapon",
      effects: [{ _id: "ieffect-1", name: "Flaming", changes: [], system: {}, flags: {} }],
      toObject() {
        return {
          _id: "item-1",
          name: "Sword",
          type: "weapon",
          system: { damage: "1d8" },
          flags: { dae: { transfer: true } },
          effects: [{ _id: "ieffect-1", name: "Flaming", changes: [], system: {}, flags: {} }]
        };
      }
    };
    return {
      id: "actor-1",
      name: "Valeros",
      type: "character",
      items: [childItem],
      effects: [{ _id: "aeffect-1", name: "Rage", changes: [], system: {}, flags: {} }],
      toObject() {
        return {
          _id: "actor-1",
          name: "Valeros",
          type: "character",
          system: {},
          flags: { ActiveAuras: { radius: 10 } },
          effects: [{ _id: "aeffect-1", name: "Rage", changes: [], system: {}, flags: {} }]
        };
      }
    };
  };

  it("surfaces nested items' flags with include:['items.flags']; the actor's own flags/effects are ALWAYS present", () => {
    const result = serializeActor(buildNestedActor(), { include: ["items.flags"] });

    expect(result.flags).toEqual({ ActiveAuras: { radius: 10 } });
    expect(result.effects).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].flags).toEqual({ dae: { transfer: true } });

    expect("effects" in result.items[0]).toBe(false);
    expect(result.items[0].effectCount).toBe(1);
    assertStructuredCloneable(result);
  });

  it("surfaces nested items' effects (serializeActiveEffect shape) with include:['items.effects'], no nested flags", () => {
    const result = serializeActor(buildNestedActor(), { include: ["items.effects"] });

    expect(result.flags).toEqual({ ActiveAuras: { radius: 10 } });
    expect(result.effects).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    expect("flags" in result.items[0]).toBe(false);
    expect(result.items[0].effects).toHaveLength(1);
    expect(result.items[0].effects[0].name).toBe("Flaming");
    expect(result.items[0].effectCount).toBe(1);
    assertStructuredCloneable(result);
  });

  it("combines the actor's own (always-on) flags/effects with scoped-nested items.* orthogonally", () => {
    const result = serializeActor(buildNestedActor(), {
      include: ["items.flags", "items.effects"]
    });

    expect(result.flags).toEqual({ ActiveAuras: { radius: 10 } });
    expect(result.effects).toHaveLength(1);

    expect(result.items[0].flags).toEqual({ dae: { transfer: true } });
    expect(result.items[0].effects).toHaveLength(1);
    expect(result.items[0].effects[0].name).toBe("Flaming");
    expect(result.items[0].effectCount).toBe(1);
    assertStructuredCloneable(result);
  });

  it("leaves nested items on the default projection when no include is given", () => {
    const result = serializeActor(buildNestedActor());
    expect(result.items).toHaveLength(1);
    expect("flags" in result.items[0]).toBe(false);
    expect("effects" in result.items[0]).toBe(false);
  });

  it("appends a derived prepared subtree only with include:['prepared']", () => {
    const actor = {
      id: "actor-1",
      name: "Valeros",
      type: "character",
      items: [],

      system: {
        toObject(source) {
          return source === false ? { attributes: { senses: { darkvision: 60 } } } : { attributes: {} };
        }
      },
      prototypeToken: {
        toObject(source) {
          return source === false ? { sight: { range: 60 } } : { sight: { range: 0 } };
        }
      },

      detectionModes: null,
      toObject() {
        return { _id: "actor-1", name: "Valeros", type: "character", system: {} };
      }
    };

    const withoutPrepared = serializeActor(actor);
    expect("prepared" in withoutPrepared).toBe(false);

    const withPrepared = serializeActor(actor, { include: ["prepared"] });
    expect(withPrepared.prepared).toEqual({
      system: { attributes: { senses: { darkvision: 60 } } },
      prototypeToken: { sight: { range: 60 } },
      detectionModes: null
    });
    assertStructuredCloneable(withPrepared);
  });

  it("degrades a derived subtree to null when its toObject(false) throws, without crashing", () => {
    const actor = {
      id: "actor-1",
      name: "Valeros",
      type: "character",
      items: [],
      system: {
        toObject() {
          throw new Error("unserializable derived system");
        }
      },
      prototypeToken: null,
      detectionModes: null,
      toObject() {
        return { _id: "actor-1", name: "Valeros", type: "character", system: {} };
      }
    };

    const result = serializeActor(actor, { include: ["prepared"] });
    const prepared = /** @type {any} */ (result.prepared);
    expect(prepared.system).toBeNull();
    expect(prepared.prototypeToken).toBeNull();
    expect(prepared.detectionModes).toBeNull();
  });
});

describe("serializeActorSummary", () => {
  it("projects an item count from the live collection and stays cloneable", () => {
    const actor = {
      id: "actor-1",
      name: "Valeros",
      type: "character",
      img: "val.webp",
      sort: 3,
      items: [{ id: "i1" }, { id: "i2" }],

      get system() {
        throw new Error("serializeActorSummary read the live system accessor");
      },
      toObject() {
        return { _id: "actor-1", name: "Valeros", type: "character", img: "val.webp", sort: 3, system: {} };
      }
    };

    const result = serializeActorSummary(actor);

    expect(result).toEqual({
      id: "actor-1",
      _id: "actor-1",
      name: "Valeros",
      type: "character",
      img: "val.webp",
      folder: null,
      sort: 3,
      itemCount: 2,

      effectCount: 0
    });
    expect("system" in result).toBe(false);
    assertStructuredCloneable(result);
  });

  it("counts the actor's own top-level effects", () => {
    const actor = {
      id: "actor-2",
      name: "Ezren",
      type: "character",
      items: [{ id: "i1" }],
      effects: [{ _id: "e1" }, { _id: "e2" }],
      toObject() {
        return { _id: "actor-2", name: "Ezren", type: "character", system: {} };
      }
    };

    const result = serializeActorSummary(actor);
    expect(result.itemCount).toBe(1);
    expect(result.effectCount).toBe(2);
  });
});

describe("tokenName", () => {
  it("reads the STORED name, never the one Foundry derives from the actor", () => {
    const token = {
      id: "token-1",
      name: "Valeros",
      toObject: () => ({ _id: "token-1", name: "" })
    };
    expect(tokenName(token)).toBe("");
    expect(serializeToken(token).name).toBe("");
    expect(serializeTokenSummary(token).name).toBe("");

    expect(tokenName(token, token.toObject())).toBe("");
  });

  it("falls back to the live accessor only where the source carries NO name key, and answers null for nothing", () => {
    expect(tokenName({ id: "t", name: "Live Only", toObject: () => ({ _id: "t" }) })).toBe("Live Only");
    expect(tokenName({ id: "t", toObject: () => ({ _id: "t" }) })).toBe(null);

    expect(tokenName(null)).toBe(null);
    expect(tokenName(undefined)).toBe(null);
  });
});

describe("placeableName", () => {
  it("reports the STORED name for a drawing and a light (the v14 field), through both projections", () => {
    const drawing = {
      id: "drawing-1",

      name: "Derived Drawing",
      toObject: () => ({ _id: "drawing-1", name: "Stored Drawing", shape: { type: "r" }, x: 1, y: 2 })
    };
    expect(placeableName(drawing)).toBe("Stored Drawing");
    expect(serializeDrawing(drawing).name).toBe("Stored Drawing");
    expect(serializeDrawingSummary(drawing).name).toBe("Stored Drawing");

    expect(placeableName(drawing, drawing.toObject())).toBe("Stored Drawing");

    const light = {
      id: "light-1",
      name: "Derived Light",
      toObject: () => ({ _id: "light-1", name: "Stored Light", x: 1, y: 2 })
    };
    expect(placeableName(light)).toBe("Stored Light");
    expect(serializeAmbientLight(light).name).toBe("Stored Light");
    expect(serializeAmbientLightSummary(light).name).toBe("Stored Light");
    expect(placeableName(light, light.toObject())).toBe("Stored Light");
  });

  it("reports the STORED name for a region too, so all four named families share one answer", () => {
    const region = {
      id: "region-1",
      name: "Derived Region",
      toObject: () => ({ _id: "region-1", name: "Stored Region", shapes: [], behaviors: [] })
    };
    expect(placeableName(region)).toBe("Stored Region");
    expect(serializeRegion(region).name).toBe("Stored Region");
    expect(serializeRegionSummary(region).name).toBe("Stored Region");

    expect(tokenName(region)).toBe("Stored Region");
  });

  it("falls back to the live accessor only where the source carries NO name key, and answers null for nothing", () => {
    const v13Drawing = { id: "d", toObject: () => ({ _id: "d", shape: { type: "r" }, x: 0, y: 0 }) };
    expect(placeableName(v13Drawing)).toBe(null);
    expect(serializeDrawing(v13Drawing).name).toBe(null);
    expect(serializeDrawingSummary(v13Drawing).name).toBe(null);
    expect(placeableName({ id: "d", name: "Live Only", toObject: () => ({ _id: "d" }) })).toBe("Live Only");

    expect(placeableName(null)).toBe(null);
    expect(placeableName(undefined)).toBe(null);
  });
});

describe("worldDocumentName / effectName", () => {
  it("does NOT deep-clone the document when the live accessor answers", () => {
    let clones = 0;
    const item = {
      id: "item-1",
      name: "Longsword",
      toObject: () => {
        clones += 1;
        return { _id: "item-1", name: "Stored Longsword" };
      }
    };
    expect(worldDocumentName(item)).toBe("Longsword");
    expect(clones, "worldDocumentName must not pay for a toObject() it cannot use").toBe(0);

    const effect = {
      id: "effect-1",
      name: "Blessed",
      toObject: () => {
        clones += 1;
        return { _id: "effect-1", name: "Stored Blessed" };
      }
    };
    expect(effectName(effect)).toBe("Blessed");
    expect(clones, "effectName must not pay for a toObject() it cannot use").toBe(0);

    const itemData = item.toObject();
    expect(serializeItem(item).name).toBe("Longsword");
    expect(serializeItemSummary(item).name).toBe("Longsword");
    expect(worldDocumentName(item, itemData), "the pre-read path must not disagree with the bare one").toBe(
      "Longsword"
    );
    const effectData = effect.toObject();
    expect(serializeActiveEffect(effect).name).toBe("Blessed");
    expect(serializeActiveEffectSummary(effect).name).toBe("Blessed");
    expect(effectName(effect, effectData)).toBe("Blessed");
  });

  it("still falls back to the stored source, and the optional pre-read cannot change the answer", () => {
    let clones = 0;
    const source = { _id: "item-2", name: "Stored Only" };
    const item = {
      id: "item-2",
      toObject: () => {
        clones += 1;
        return { ...source };
      }
    };

    expect(worldDocumentName(item)).toBe("Stored Only");
    expect(clones).toBe(1);

    expect(worldDocumentName(item, source)).toBe("Stored Only");
    expect(clones).toBe(1);

    const effectSource = { _id: "effect-2", name: "Stored Effect" };
    let effectClones = 0;
    const effect = {
      id: "effect-2",
      toObject: () => {
        effectClones += 1;
        return { ...effectSource };
      }
    };
    expect(effectName(effect)).toBe("Stored Effect");
    expect(effectClones).toBe(1);
    expect(effectName(effect, effectSource)).toBe("Stored Effect");
    expect(effectClones).toBe(1);

    expect(worldDocumentName({ id: "x", toObject: () => ({ _id: "x" }) })).toBe(null);
    expect(effectName({ id: "x", toObject: () => ({ _id: "x" }) })).toBe(null);
    expect(worldDocumentName(null)).toBe(null);
    expect(worldDocumentName(undefined)).toBe(null);
    expect(effectName(null)).toBe(null);
    expect(effectName(undefined)).toBe(null);
  });
});

describe("serializeToken", () => {
  it("reads nested config (texture/light/sight/bars/flags) from the toObject() source", () => {
    const token = {
      id: "token-1",

      get name() {
        throw new Error("serializeToken read the live name accessor");
      },
      get texture() {
        throw new Error("serializeToken read the live texture accessor");
      },
      get flags() {
        throw new Error("serializeToken read the live flags accessor");
      },
      toObject() {
        return {
          _id: "token-1",
          name: "Goblin",
          actorId: "actor-1",
          actorLink: false,
          x: 100,
          y: 200,
          texture: { src: "gob.webp", scaleX: 1 },
          light: { dim: 20, bright: 10 },
          sight: { enabled: true, range: 30 },
          bar1: { attribute: "attributes.hp" },
          bar2: { attribute: null },
          flags: { mymod: { tag: "x" } }
        };
      }
    };

    const result = serializeToken(token);

    expect(result.name).toBe("Goblin");
    expect(result.texture).toEqual({ src: "gob.webp", scaleX: 1 });
    expect(result.light).toEqual({ dim: 20, bright: 10 });
    expect(result.sight).toEqual({ enabled: true, range: 30 });
    expect(result.bar1).toEqual({ attribute: "attributes.hp" });
    expect(result.flags).toEqual({ mymod: { tag: "x" } });
    assertStructuredCloneable(result);
  });

  it("appends the token's runtime vision + effective actor derived system only with include:['prepared']", () => {
    const token = {
      id: "token-1",
      actor: {
        system: {
          toObject(source) {
            return source === false ? { attributes: { senses: { darkvision: 90 } } } : { attributes: {} };
          }
        }
      },
      toObject(source) {
        if (source === false) {
          return {
            detectionModes: [{ id: "basicSight", range: 90, enabled: true }],
            sight: { enabled: true, range: 90 },
            light: { dim: 30, bright: 10 }
          };
        }
        return {
          _id: "token-1",
          name: "Goblin",
          actorId: "actor-1",
          actorLink: false,
          x: 0,
          y: 0
        };
      }
    };

    const withoutPrepared = serializeToken(token);
    expect("prepared" in withoutPrepared).toBe(false);

    const withPrepared = serializeToken(token, { include: ["prepared"] });
    expect(withPrepared.prepared).toEqual({
      detectionModes: [{ id: "basicSight", range: 90, enabled: true }],
      sight: { enabled: true, range: 90 },
      light: { dim: 30, bright: 10 },
      system: { attributes: { senses: { darkvision: 90 } } }
    });
    assertStructuredCloneable(withPrepared);
  });

  it("degrades prepared token fields to null when the derived read throws, without crashing", () => {
    const token = {
      id: "token-1",
      actor: null,
      toObject(source) {
        if (source === false) {
          throw new Error("unserializable derived token");
        }
        return { _id: "token-1", name: "Goblin", actorId: "actor-1", actorLink: false, x: 0, y: 0 };
      }
    };

    const result = serializeToken(token, { include: ["prepared"] });
    expect(result.prepared).toEqual({
      detectionModes: null,
      sight: null,
      light: null,
      system: null
    });
  });
});

describe("serializeTokenSummary", () => {
  it("projects identity + position from the toObject() source", () => {
    const token = {
      id: "token-1",
      get name() {
        throw new Error("serializeTokenSummary read the live name accessor");
      },
      toObject() {
        return {
          _id: "token-1",
          name: "Goblin",
          actorId: "actor-1",
          actorLink: false,
          x: 1,
          y: 2,
          hidden: true
        };
      }
    };

    const result = serializeTokenSummary(token);

    expect(result).toEqual({
      id: "token-1",
      _id: "token-1",
      name: "Goblin",
      actorId: "actor-1",
      actorLink: false,
      x: 1,
      y: 2,
      hidden: true
    });
    assertStructuredCloneable(result);
  });
});

describe("serializeTile", () => {
  it("reads texture/flags from the toObject() source", () => {
    const tile = {
      id: "tile-1",
      get texture() {
        throw new Error("serializeTile read the live texture accessor");
      },
      get flags() {
        throw new Error("serializeTile read the live flags accessor");
      },
      toObject() {
        return {
          _id: "tile-1",
          texture: { src: "wall.webp", tint: "#fff" },
          x: 10,
          y: 20,
          flags: { mymod: { z: 1 } }
        };
      }
    };

    const result = serializeTile(tile);

    expect(result.texture).toEqual({ src: "wall.webp", tint: "#fff" });
    expect(result.flags).toEqual({ mymod: { z: 1 } });
    expect(result.x).toBe(10);
    assertStructuredCloneable(result);
  });
});

describe("serializeTileSummary", () => {
  it("projects position/size from the toObject() source", () => {
    const tile = {
      id: "tile-1",
      toObject() {
        return { _id: "tile-1", x: 10, y: 20, width: 100, height: 200, hidden: false };
      }
    };

    const result = serializeTileSummary(tile);

    expect(result).toEqual({
      id: "tile-1",
      _id: "tile-1",
      x: 10,
      y: 20,
      width: 100,
      height: 200,
      hidden: false
    });
    assertStructuredCloneable(result);
  });
});

describe("serializeSound", () => {
  it("reads darkness/flags from the toObject() source", () => {
    const sound = {
      id: "sound-1",
      get flags() {
        throw new Error("serializeSound read the live flags accessor");
      },
      toObject() {
        return {
          _id: "sound-1",
          path: "ambient.ogg",
          x: 5,
          y: 6,
          radius: 30,
          darkness: { min: 0, max: 1 },
          flags: { mymod: { loop: true } }
        };
      }
    };

    const result = serializeSound(sound);

    expect(result.path).toBe("ambient.ogg");
    expect(result.darkness).toEqual({ min: 0, max: 1 });
    expect(result.flags).toEqual({ mymod: { loop: true } });
    assertStructuredCloneable(result);
  });
});

describe("serializeSoundSummary", () => {
  it("projects identity + position from the toObject() source", () => {
    const sound = {
      id: "sound-1",
      toObject() {
        return { _id: "sound-1", path: "ambient.ogg", x: 5, y: 6, radius: 30, hidden: false };
      }
    };

    const result = serializeSoundSummary(sound);

    expect(result).toEqual({
      id: "sound-1",
      _id: "sound-1",
      path: "ambient.ogg",
      x: 5,
      y: 6,
      radius: 30,
      hidden: false
    });
    assertStructuredCloneable(result);
  });
});

describe("serializeWall", () => {
  it("reads the full wall field set from the toObject() source, with no name", () => {
    const wall = {
      id: "wall-1",
      get flags() {
        throw new Error("serializeWall read the live flags accessor");
      },
      toObject() {
        return {
          _id: "wall-1",
          c: [0, 0, 100, 0],
          light: 20,
          sight: 20,
          sound: 20,
          move: 20,
          dir: 0,
          door: 1,
          ds: 0,
          doorSound: "woodBasic",
          threshold: { light: null, sight: 5, sound: null, attenuation: false },
          flags: { mymod: { z: 1 } }
        };
      }
    };

    const result = serializeWall(wall);

    expect(result).toEqual({
      id: "wall-1",
      _id: "wall-1",
      c: [0, 0, 100, 0],
      light: 20,
      sight: 20,
      sound: 20,
      move: 20,
      dir: 0,
      door: 1,
      ds: 0,
      doorSound: "woodBasic",
      threshold: { light: null, sight: 5, sound: null, attenuation: false },
      flags: { mymod: { z: 1 } }
    });

    expect(result).not.toHaveProperty("name");
    assertStructuredCloneable(result);
  });
});

describe("serializeWallSummary", () => {
  it("projects identity + the fields you locate a wall by, with no name", () => {
    const wall = {
      id: "wall-1",
      toObject() {
        return { _id: "wall-1", c: [0, 0, 0, 100], door: 2, ds: 2, doorSound: "stoneBasic" };
      }
    };

    const result = serializeWallSummary(wall);

    expect(result).toEqual({
      id: "wall-1",
      _id: "wall-1",
      c: [0, 0, 0, 100],
      door: 2,
      ds: 2,
      doorSound: "stoneBasic"
    });
    expect(result).not.toHaveProperty("name");
    assertStructuredCloneable(result);
  });
});

describe("serializeNote", () => {
  it("reads the full note field set from the toObject() source, incl. the texture object", () => {
    const note = {
      id: "note-1",
      get flags() {
        throw new Error("serializeNote read the live flags accessor");
      },
      toObject() {
        return {
          _id: "note-1",
          entryId: "journal-1",
          pageId: "page-1",
          x: 500,
          y: 400,
          elevation: 0,
          sort: 100,
          texture: { src: "icons/svg/book.svg", tint: "#ffffff", anchorX: 0.5, anchorY: 0.5 },
          iconSize: 40,
          text: "Quest giver",
          fontFamily: "Signika",
          fontSize: 32,
          textAnchor: 1,
          textColor: "#000000",
          global: false,
          flags: { mymod: { z: 1 } }
        };
      }
    };

    const result = serializeNote(note);

    expect(result).toEqual({
      id: "note-1",
      _id: "note-1",
      entryId: "journal-1",
      pageId: "page-1",
      x: 500,
      y: 400,
      elevation: 0,
      sort: 100,
      texture: { src: "icons/svg/book.svg", tint: "#ffffff", anchorX: 0.5, anchorY: 0.5 },
      iconSize: 40,
      text: "Quest giver",
      fontFamily: "Signika",
      fontSize: 32,
      textAnchor: 1,
      textColor: "#000000",
      global: false,
      flags: { mymod: { z: 1 } }
    });
    assertStructuredCloneable(result);
  });
});

describe("serializeNoteSummary", () => {
  it("projects identity + what you locate/style a pin by (text/x/y/entryId/texture.src/iconSize)", () => {
    const note = {
      id: "note-1",
      toObject() {
        return {
          _id: "note-1",
          entryId: "journal-1",
          x: 500,
          y: 400,
          text: "Quest giver",
          iconSize: 40,
          texture: { src: "icons/svg/book.svg", tint: "#ffffff" }
        };
      }
    };

    const result = serializeNoteSummary(note);

    expect(result).toEqual({
      id: "note-1",
      _id: "note-1",
      text: "Quest giver",
      x: 500,
      y: 400,
      entryId: "journal-1",
      texture: { src: "icons/svg/book.svg" },
      iconSize: 40
    });

    expect(result.texture).not.toHaveProperty("tint");
    assertStructuredCloneable(result);
  });
});

describe("serializeDrawing", () => {
  it("reads the full drawing field set from the toObject() source, incl. shape + author", () => {
    const drawing = {
      id: "drawing-1",
      get flags() {
        throw new Error("serializeDrawing read the live flags accessor");
      },
      toObject() {
        return {
          _id: "drawing-1",
          author: "user-1",
          shape: { type: "r", width: 200, height: 100, points: [] },
          x: 300,
          y: 400,
          elevation: 0,
          sort: 5,
          rotation: 45,
          bezierFactor: 0.25,
          fillType: 1,
          fillColor: "#ff0000",
          fillAlpha: 0.5,
          strokeWidth: 8,
          strokeColor: "#000000",
          strokeAlpha: 1,
          texture: "worlds/w/tex.webp",
          text: "Danger zone",
          fontFamily: "Signika",
          fontSize: 48,
          textColor: "#ffffff",
          textAlpha: 1,
          hidden: false,
          locked: true,
          interface: false,
          flags: { mymod: { z: 1 } }
        };
      }
    };

    const result = serializeDrawing(drawing);

    expect(result).toEqual({
      id: "drawing-1",
      _id: "drawing-1",

      name: null,
      author: "user-1",
      shape: { type: "r", width: 200, height: 100, points: [] },
      x: 300,
      y: 400,
      elevation: 0,
      sort: 5,
      rotation: 45,
      bezierFactor: 0.25,
      fillType: 1,
      fillColor: "#ff0000",
      fillAlpha: 0.5,
      strokeWidth: 8,
      strokeColor: "#000000",
      strokeAlpha: 1,
      texture: "worlds/w/tex.webp",
      text: "Danger zone",
      fontFamily: "Signika",
      fontSize: 48,
      textColor: "#ffffff",
      textAlpha: 1,
      hidden: false,
      locked: true,
      interface: false,
      flags: { mymod: { z: 1 } }
    });
    assertStructuredCloneable(result);
  });

  it("reads author from a live User-document accessor when present", () => {
    const drawing = {
      id: "drawing-1",
      author: { id: "user-9" },
      toObject() {
        return { _id: "drawing-1", x: 0, y: 0 };
      }
    };
    expect(serializeDrawing(drawing).author).toBe("user-9");
  });
});

describe("serializeDrawingSummary", () => {
  it("projects identity + what you locate a drawing by (text/x/y/shape.type/hidden)", () => {
    const drawing = {
      id: "drawing-1",
      toObject() {
        return {
          _id: "drawing-1",
          shape: { type: "p", points: [0, 0, 50, 50] },
          x: 700,
          y: 200,
          text: "Path",
          hidden: true
        };
      }
    };

    const result = serializeDrawingSummary(drawing);

    expect(result).toEqual({
      id: "drawing-1",
      _id: "drawing-1",
      name: null,
      text: "Path",
      x: 700,
      y: 200,
      shape: { type: "p" },
      hidden: true
    });

    expect(result.shape).not.toHaveProperty("points");
    expect(result.shape).not.toHaveProperty("width");
    assertStructuredCloneable(result);
  });
});

describe("serializeAmbientLight", () => {
  it("reads the full light field set from the toObject() source, incl. the config object", () => {
    const light = {
      id: "light-1",
      get flags() {
        throw new Error("serializeAmbientLight read the live flags accessor");
      },
      toObject() {
        return {
          _id: "light-1",
          x: 250,
          y: 250,
          elevation: 0,
          rotation: 0,
          walls: true,
          vision: false,
          config: { dim: 40, bright: 20, color: "#ffaa00", animation: { type: "torch" } },
          hidden: false,
          flags: { mymod: { z: 1 } }
        };
      }
    };

    const result = serializeAmbientLight(light);

    expect(result).toEqual({
      id: "light-1",
      _id: "light-1",

      name: null,
      x: 250,
      y: 250,
      elevation: 0,
      rotation: 0,
      walls: true,
      vision: false,
      config: { dim: 40, bright: 20, color: "#ffaa00", animation: { type: "torch" } },
      hidden: false,
      flags: { mymod: { z: 1 } }
    });
    assertStructuredCloneable(result);
  });
});

describe("serializeAmbientLightSummary", () => {
  it("projects identity + x/y/hidden + the config locator subset (dim/bright/color)", () => {
    const light = {
      id: "light-1",
      toObject() {
        return {
          _id: "light-1",
          x: 250,
          y: 250,
          hidden: false,
          config: { dim: 40, bright: 20, color: "#ffaa00", animation: { type: "torch" } }
        };
      }
    };

    const result = serializeAmbientLightSummary(light);

    expect(result).toEqual({
      id: "light-1",
      _id: "light-1",
      name: null,
      x: 250,
      y: 250,
      hidden: false,
      config: { dim: 40, bright: 20, color: "#ffaa00" }
    });

    expect(result.config).not.toHaveProperty("animation");
    assertStructuredCloneable(result);
  });

  it("reads config subset defensively when config is absent", () => {
    const light = {
      id: "light-1",
      toObject() {
        return { _id: "light-1", x: 0, y: 0, hidden: false };
      }
    };
    expect(serializeAmbientLightSummary(light).config).toEqual({
      dim: null,
      bright: null,
      color: null
    });
  });
});

describe("serializeMeasuredTemplate", () => {
  it("reads the full template field set from the toObject() source, incl. author", () => {
    const template = {
      id: "template-1",
      get flags() {
        throw new Error("serializeMeasuredTemplate read the live flags accessor");
      },
      toObject() {
        return {
          _id: "template-1",
          author: "user-1",
          t: "cone",
          x: 500,
          y: 500,
          elevation: 0,
          sort: 3,
          distance: 20,
          direction: 45,
          angle: 53,
          width: 4,
          borderColor: "#000000",
          fillColor: "#ff6600",
          texture: "worlds/w/tex.webp",
          hidden: false,
          flags: { mymod: { z: 1 } }
        };
      }
    };

    const result = serializeMeasuredTemplate(template);

    expect(result).toEqual({
      id: "template-1",
      _id: "template-1",
      author: "user-1",
      t: "cone",
      x: 500,
      y: 500,
      elevation: 0,
      sort: 3,
      distance: 20,
      direction: 45,
      angle: 53,
      width: 4,
      borderColor: "#000000",
      fillColor: "#ff6600",
      texture: "worlds/w/tex.webp",
      hidden: false,
      flags: { mymod: { z: 1 } }
    });
    assertStructuredCloneable(result);
  });

  it("reads author from a live User-document accessor when present", () => {
    const template = {
      id: "template-1",
      author: { id: "user-9" },
      toObject() {
        return { _id: "template-1", t: "circle", x: 0, y: 0 };
      }
    };
    expect(serializeMeasuredTemplate(template).author).toBe("user-9");
  });
});

describe("serializeMeasuredTemplateSummary", () => {
  it("projects identity + what you locate a template by (t/x/y/distance/hidden)", () => {
    const template = {
      id: "template-1",
      toObject() {
        return {
          _id: "template-1",
          t: "circle",
          x: 700,
          y: 200,
          distance: 30,
          direction: 90,
          hidden: true
        };
      }
    };

    const result = serializeMeasuredTemplateSummary(template);

    expect(result).toEqual({
      id: "template-1",
      _id: "template-1",
      t: "circle",
      x: 700,
      y: 200,
      distance: 30,
      hidden: true
    });

    expect(result).not.toHaveProperty("direction");
    assertStructuredCloneable(result);
  });
});

describe("serializeRegion", () => {
  it("reads the full region field set from the toObject() source, incl. shapes + elevation", () => {
    const region = {
      id: "region-1",
      get flags() {
        throw new Error("serializeRegion read the live flags accessor");
      },
      toObject() {
        return {
          _id: "region-1",
          name: "Lava Field",
          color: "#ff0000",
          shapes: [{ type: "rectangle", x: 0, y: 0, width: 500, height: 500 }],
          elevation: { bottom: 0, top: null },
          visibility: 2,
          locked: false,
          behaviors: [{ type: "damage", system: { damage: "2d6" } }],
          flags: { mymod: { z: 1 } }
        };
      }
    };

    const result = serializeRegion(region);

    expect(result).toEqual({
      id: "region-1",
      _id: "region-1",
      name: "Lava Field",
      color: "#ff0000",
      shapes: [{ type: "rectangle", x: 0, y: 0, width: 500, height: 500 }],
      elevation: { bottom: 0, top: null },
      visibility: 2,
      locked: false,

      behaviors: [
        {
          id: null,
          _id: null,
          name: "",
          type: "damage",
          disabled: false,
          system: { damage: "2d6" },
          flags: {}
        }
      ],
      flags: { mymod: { z: 1 } }
    });
    assertStructuredCloneable(result);
  });

  it("serializes behaviors from a live embedded collection through the shared full projection", () => {
    const region = {
      id: "region-1",
      behaviors: [
        {
          id: "b-1",
          toObject() {
            return { _id: "b-1", type: "executeMacro", name: "Trap", system: { uuid: "Macro.abc" } };
          }
        }
      ],
      toObject() {
        return { _id: "region-1", name: "Zone", shapes: [], behaviors: [] };
      }
    };

    const result = serializeRegion(region);
    expect(result.behaviors).toEqual([
      {
        id: "b-1",
        _id: "b-1",
        name: "Trap",
        type: "executeMacro",
        disabled: false,
        system: { uuid: "Macro.abc" },
        flags: {}
      }
    ]);
  });

  it("defensively emits empty shapes/behaviors when both source and collections are absent", () => {
    const region = {
      id: "region-1",
      toObject() {
        return { _id: "region-1", name: "Bare" };
      }
    };

    const result = serializeRegion(region);
    expect(result.shapes).toEqual([]);
    expect(result.behaviors).toEqual([]);
    expect(result.elevation).toBeNull();
    assertStructuredCloneable(result);
  });
});

describe("serializeRegionSummary", () => {
  it("projects identity + name/color/visibility + shapes/behaviors counts", () => {
    const region = {
      id: "region-1",
      toObject() {
        return {
          _id: "region-1",
          name: "Lava Field",
          color: "#ff0000",
          shapes: [{ type: "rectangle" }, { type: "circle" }],
          visibility: 2,
          behaviors: [{ type: "damage" }]
        };
      }
    };

    const result = serializeRegionSummary(region);

    expect(result).toEqual({
      id: "region-1",
      _id: "region-1",
      name: "Lava Field",
      color: "#ff0000",
      visibility: 2,
      shapesCount: 2,
      behaviorsCount: 1
    });

    expect(result).not.toHaveProperty("shapes");
    expect(result).not.toHaveProperty("behaviors");
    assertStructuredCloneable(result);
  });

  it("defensively counts 0 when shapes/behaviors are absent", () => {
    const region = {
      id: "region-1",
      toObject() {
        return { _id: "region-1", name: "Bare" };
      }
    };

    const result = serializeRegionSummary(region);
    expect(result.shapesCount).toBe(0);
    expect(result.behaviorsCount).toBe(0);
  });
});

describe("serializeRegionBehavior", () => {
  const backfilledBehavior = {
    id: "b-1",
    name: "Pause Game",
    get system() {
      throw new Error("serializeRegionBehavior read the live system accessor");
    },
    get flags() {
      throw new Error("serializeRegionBehavior read the live flags accessor");
    },
    _source: { _id: "b-1", name: "", type: "pauseGame", disabled: true, system: {}, flags: {} },
    toObject() {
      return {
        _id: "b-1",
        name: "",
        type: "pauseGame",
        disabled: true,
        system: {},
        flags: {},
        _stats: { coreVersion: "13.351" }
      };
    }
  };

  it("projects the measured field set from stored source and never echoes _stats", () => {
    const result = serializeRegionBehavior({
      id: "b-2",
      toObject() {
        return {
          _id: "b-2",
          name: "Dim The Lights",
          type: "adjustDarknessLevel",
          disabled: false,
          system: { darknessLevel: 0.5 },
          flags: { mymod: { z: 1 } },
          _stats: { coreVersion: "13.351" }
        };
      }
    });

    expect(result).toEqual({
      id: "b-2",
      _id: "b-2",
      name: "Dim The Lights",
      type: "adjustDarknessLevel",
      disabled: false,
      system: { darknessLevel: 0.5 },
      flags: { mymod: { z: 1 } }
    });

    expect(result).not.toHaveProperty("ownership");
    expect(result).not.toHaveProperty("_stats");
    assertStructuredCloneable(result);
  });

  it("reports the STORED name, not the localized type label a blank name derives", () => {
    expect(serializeRegionBehavior(backfilledBehavior).name).toBe("");
    expect(serializeRegionBehaviorSummary(backfilledBehavior).name).toBe("");
  });

  it("defaults an absent disabled/system/flags rather than emitting undefined", () => {
    const result = serializeRegionBehavior({
      id: "b-3",
      toObject() {
        return { _id: "b-3", type: "pauseGame" };
      }
    });
    expect(result).toEqual({
      id: "b-3",
      _id: "b-3",
      name: "",
      type: "pauseGame",
      disabled: false,
      system: {},
      flags: {}
    });
  });

  it("summary projection carries identity + name/type/disabled and NOT system/flags", () => {
    const result = serializeRegionBehaviorSummary({
      id: "b-4",
      toObject() {
        return {
          _id: "b-4",
          name: "Trap",
          type: "executeMacro",
          disabled: false,
          system: { uuid: "Macro.abc" },
          flags: { mymod: { z: 1 } }
        };
      }
    });
    expect(result).toEqual({
      id: "b-4",
      _id: "b-4",
      name: "Trap",
      type: "executeMacro",
      disabled: false
    });
    expect(result).not.toHaveProperty("system");
    expect(result).not.toHaveProperty("flags");
    assertStructuredCloneable(result);
  });

  it("emits a null id for a create PREVIEW (a preview mints no id on either install)", () => {
    const result = serializeRegionBehavior({
      id: null,
      toObject() {
        return {
          _id: null,
          name: "Preview",
          type: "suppressWeather",
          disabled: false,
          system: {},
          flags: {}
        };
      }
    });
    expect(result.id).toBeNull();
    expect(result._id).toBeNull();
  });
});

describe("serializeFolder", () => {
  it("reads the full field set from the toObject() source and defaults counts to 0", () => {
    const folder = {
      id: "folder-1",
      name: "Monsters",
      folder: null,
      toObject() {
        return {
          _id: "folder-1",
          name: "Monsters",
          type: "Actor",
          folder: null,
          color: "#aabbcc",
          description: "<p>Beasts</p>",
          sorting: "m",
          sort: 200,
          flags: { mymod: { pinned: true } }
        };
      }
    };

    const result = serializeFolder(folder);

    expect(result).toEqual({
      id: "folder-1",
      _id: "folder-1",
      name: "Monsters",
      type: "Actor",
      folder: null,
      color: "#aabbcc",
      description: "<p>Beasts</p>",
      sorting: "m",
      sort: 200,
      flags: { mymod: { pinned: true } },
      childFolderCount: 0,
      documentCount: 0
    });
    assertStructuredCloneable(result);
  });

  it("carries handler-supplied children counts and defaults sorting to 'a'", () => {
    const folder = {
      id: "folder-2",
      name: "Empty",
      folder: null,
      toObject() {
        return { _id: "folder-2", name: "Empty", type: "Item", folder: null, color: null };
      }
    };

    const result = serializeFolder(folder, { childFolderCount: 3, documentCount: 7 });

    expect(result.sorting).toBe("a");
    expect(result.sort).toBe(0);
    expect(result.description).toBeNull();
    expect(result.flags).toEqual({});
    expect(result.childFolderCount).toBe(3);
    expect(result.documentCount).toBe(7);
  });
});

describe("serializeFolderSummary", () => {
  it("projects the lean list-row shape (no description/sorting/flags/counts)", () => {
    const folder = {
      id: "folder-1",
      name: "Monsters",
      folder: null,
      toObject() {
        return { _id: "folder-1", name: "Monsters", type: "Actor", folder: null, color: "#aabbcc" };
      }
    };

    const result = serializeFolderSummary(folder);

    expect(result).toEqual({
      id: "folder-1",
      _id: "folder-1",
      name: "Monsters",
      type: "Actor",
      folder: null,
      color: "#aabbcc"
    });
    assertStructuredCloneable(result);
  });
});

describe("serializeCompendiumPack", () => {
  it("projects pack metadata into a plain cloneable object", () => {
    const pack = {
      collection: "world.actors",
      title: "World Actors",
      documentName: "Actor",
      metadata: { system: "dnd5e", packageName: "world", packageType: "world" }
    };

    const result = serializeCompendiumPack(pack);

    expect(result).toEqual({
      id: "world.actors",
      label: "World Actors",
      type: "Actor",
      system: "dnd5e",
      packageName: "world",
      packageType: "world"
    });
    assertStructuredCloneable(result);
  });
});

describe("serializeCompendiumIndexEntry", () => {
  it("projects an index entry into a plain cloneable object", () => {
    const entry = { _id: "abc", name: "Goblin", type: "npc", img: "gob.webp" };

    const result = serializeCompendiumIndexEntry(entry);

    expect(result).toEqual({ id: "abc", _id: "abc", name: "Goblin", type: "npc", img: "gob.webp" });
    assertStructuredCloneable(result);
  });

  it("copies requested `fields` at their dot-paths in addition to the base projection", () => {
    const entry = {
      _id: "abc",
      name: "Goblin",
      type: "npc",
      img: "gob.webp",
      flags: { ddbimporter: { definitionId: 17 } },
      system: { source: { book: "MM" } }
    };

    const result = serializeCompendiumIndexEntry(entry, {
      fields: ["flags.ddbimporter.definitionId", "system.source"]
    });

    expect(result).toEqual({
      id: "abc",
      _id: "abc",
      name: "Goblin",
      type: "npc",
      img: "gob.webp",
      flags: { ddbimporter: { definitionId: 17 } },
      system: { source: { book: "MM" } }
    });

    expect(result.flags).not.toBe(entry.flags);
    assertStructuredCloneable(result);
  });

  it("without `fields` returns the base projection unchanged", () => {
    const entry = { _id: "abc", name: "Goblin", type: "npc", img: "gob.webp", flags: { x: 1 } };

    expect(serializeCompendiumIndexEntry(entry, {})).toEqual({
      id: "abc",
      _id: "abc",
      name: "Goblin",
      type: "npc",
      img: "gob.webp"
    });
  });

  it("omits a requested field absent on the entry (no undefined leak)", () => {
    const entry = { _id: "abc", name: "Goblin", type: "npc", img: "gob.webp" };

    const result = serializeCompendiumIndexEntry(entry, {
      fields: ["flags.ddbimporter.definitionId"]
    });

    expect(result).toEqual({ id: "abc", _id: "abc", name: "Goblin", type: "npc", img: "gob.webp" });
    expect("flags" in result).toBe(false);
  });

  it("does not let a requested field overwrite a base key", () => {
    const entry = {
      _id: "abc",
      id: "REQUESTED_ID_SHOULD_NOT_WIN",
      name: "Goblin",
      type: "npc",
      img: "gob.webp"
    };

    const result = serializeCompendiumIndexEntry(entry, { fields: ["id"] });

    expect(result.id).toBe("abc");
    expect(result._id).toBe("abc");
    expect(result.name).toBe("Goblin");
  });

  it("ignores prototype-polluting `fields` paths without mutating Object.prototype", () => {
    const entry = { _id: "abc", name: "Goblin", type: "npc", img: "gob.webp" };

    const result = serializeCompendiumIndexEntry(entry, {
      fields: ["__proto__.polluted", "constructor.prototype.polluted2", "prototype.polluted3"]
    });

    expect(result).toEqual({ id: "abc", _id: "abc", name: "Goblin", type: "npc", img: "gob.webp" });

    expect({}.polluted).toBeUndefined();
    expect({}.polluted2).toBeUndefined();
    expect({}.polluted3).toBeUndefined();
  });
});

describe("filterByName (exact mode)", () => {
  const entries = [{ name: "Shield" }, { name: "Shield of Faith" }, { name: "shield" }];

  it("exact:true keeps only case-insensitive full-string matches", () => {
    const result = serializers.filterByName(entries, "Shield", { exact: true });
    expect(result.map((e) => e.name)).toEqual(["Shield", "shield"]);
  });

  it("without exact keeps substring superstrings too", () => {
    const result = serializers.filterByName(entries, "Shield");
    expect(result.map((e) => e.name)).toEqual(["Shield", "Shield of Faith", "shield"]);
  });
});

describe("serializeActiveEffect", () => {
  it("reads the nested changes/duration/system/flags/statuses from toObject(), not live accessors", () => {
    const effect = {
      id: "eff-1",
      name: "Aura of Protection",

      get changes() {
        throw new Error("serializeActiveEffect read the live changes accessor");
      },
      get duration() {
        throw new Error("serializeActiveEffect read the live duration accessor");
      },
      get system() {
        throw new Error("serializeActiveEffect read the live system accessor");
      },
      get flags() {
        throw new Error("serializeActiveEffect read the live flags accessor");
      },
      get statuses() {
        throw new Error("serializeActiveEffect read the live statuses accessor");
      },
      toObject() {
        return {
          _id: "eff-1",
          name: "Aura of Protection",
          type: "auraeffects.aura",
          img: "aura.webp",
          origin: "Actor.abc.Item.def",
          disabled: false,
          transfer: true,
          duration: { rounds: 10 },
          changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "2" }],
          statuses: ["blessed"],
          tint: "#ffffff",
          description: "A protective aura.",
          sort: 3,
          system: { radius: 5 },
          flags: { dae: { spellLevel: 1 } }
        };
      }
    };

    const result = serializeActiveEffect(effect);

    expect(result).toEqual({
      id: "eff-1",
      _id: "eff-1",
      name: "Aura of Protection",
      type: "auraeffects.aura",
      img: "aura.webp",
      origin: "Actor.abc.Item.def",
      disabled: false,
      transfer: true,
      duration: { rounds: 10 },
      changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "2" }],
      statuses: ["blessed"],
      tint: "#ffffff",
      description: "A protective aura.",
      sort: 3,
      system: { radius: 5 },
      flags: { dae: { spellLevel: 1 } }
    });
    assertStructuredCloneable(result);
  });
});

describe("serializeCompendiumEffect", () => {
  it("surfaces canonical top-level changes (fallback does not fire)", () => {
    const raw = {
      toObject() {
        return {
          _id: "eff-a",
          name: "Canonical",
          changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "2" }],
          system: {},
          flags: {}
        };
      }
    };
    const result = serializeCompendiumEffect(raw);
    expect(result.changes).toEqual([{ key: "system.attributes.ac.bonus", mode: 2, value: "2" }]);
    assertStructuredCloneable(result);
  });

  it("lifts changes from system.changes when top-level changes is empty (provisional shape)", () => {
    const raw = {
      toObject() {
        return {
          _id: "eff-b",
          name: "Nested",
          changes: [],
          system: { changes: [{ key: "system.traits.dr.value", mode: 0, value: "fire" }] },
          flags: {}
        };
      }
    };
    const result = serializeCompendiumEffect(raw);
    expect(result.changes).toEqual([{ key: "system.traits.dr.value", mode: 0, value: "fire" }]);
    assertStructuredCloneable(result);
  });

  it("preserves top-level changes when BOTH top-level and system.changes are populated", () => {
    const raw = {
      toObject() {
        return {
          _id: "eff-c",
          name: "Both",
          changes: [{ key: "top.level", mode: 2, value: "1" }],
          system: { changes: [{ key: "nested.only", mode: 0, value: "9" }] },
          flags: {}
        };
      }
    };
    const result = serializeCompendiumEffect(raw);
    expect(result.changes).toEqual([{ key: "top.level", mode: 2, value: "1" }]);
    assertStructuredCloneable(result);
  });
});

describe("serializeActiveEffectSummary", () => {
  it("projects identity + disabled/transfer/statuses + changeCount and omits the changes/duration/system bodies", () => {
    const effect = {
      id: "eff-1",
      name: "Aura",

      get statuses() {
        throw new Error("serializeActiveEffectSummary read the live statuses accessor");
      },
      get changes() {
        throw new Error("serializeActiveEffectSummary read the live changes accessor");
      },
      get system() {
        throw new Error("serializeActiveEffectSummary read the live system accessor");
      },
      toObject() {
        return {
          _id: "eff-1",
          name: "Aura",
          disabled: true,
          transfer: false,
          statuses: ["prone"],
          changes: [{ key: "x" }, { key: "y" }],
          duration: { rounds: 1 },
          system: { radius: 10 }
        };
      }
    };

    const result = serializeActiveEffectSummary(effect);

    expect(result).toEqual({
      id: "eff-1",
      _id: "eff-1",
      name: "Aura",
      disabled: true,
      transfer: false,
      changeCount: 2,
      statuses: ["prone"]
    });

    expect(result).not.toHaveProperty("changes");
    expect(result).not.toHaveProperty("duration");
    expect(result).not.toHaveProperty("system");
    assertStructuredCloneable(result);
  });
});

describe("serializeAppliedEffectSummary", () => {
  it("reads active/parent/sourceName from the LIVE resolved instance", () => {
    const effect = {
      id: "eff-1",
      name: "Bless",
      active: true,
      sourceName: "Bless (Cleric)",
      parent: { documentName: "Actor", id: "actor-1" },
      toObject() {
        return { _id: "eff-1", name: "Bless", disabled: false, transfer: true, statuses: ["blessed"] };
      }
    };

    const result = serializeAppliedEffectSummary(effect);

    expect(result).toEqual({
      id: "eff-1",
      _id: "eff-1",
      name: "Bless",
      disabled: false,
      transfer: true,
      changeCount: 0,
      statuses: ["blessed"],
      active: true,
      parentType: "Actor",
      parentId: "actor-1",
      sourceName: "Bless (Cleric)"
    });
    assertStructuredCloneable(result);
  });

  it("falls back to !disabled for active and effect name for sourceName when absent", () => {
    const effect = {
      id: "eff-2",
      name: "Poisoned",
      parent: null,
      toObject() {
        return { _id: "eff-2", name: "Poisoned", disabled: true, transfer: false, statuses: [] };
      }
    };

    const result = serializeAppliedEffectSummary(effect);

    expect(result.active).toBe(false);
    expect(result.parentType).toBeNull();
    expect(result.parentId).toBeNull();
    expect(result.sourceName).toBe("Poisoned");
  });
});

describe("_id mirror on serialized documents", () => {
  it("full-document reads carry equal, non-null id and _id (actor/item)", () => {
    const actor = {
      id: "actor-1",
      name: "Valeros",
      type: "character",
      items: [],
      toObject() {
        return { _id: "actor-1", name: "Valeros", type: "character", system: {} };
      }
    };
    const actorResult = serializeActor(actor);
    expect(actorResult.id).toBe("actor-1");
    expect(actorResult._id).toBe(actorResult.id);
    expect(actorResult._id).not.toBeNull();

    const item = {
      id: "item-1",
      name: "Torch",
      type: "loot",
      toObject() {
        return { _id: "item-1", name: "Torch", type: "loot", system: {} };
      }
    };
    const itemResult = serializeItem(item);
    expect(itemResult.id).toBe("item-1");
    expect(itemResult._id).toBe(itemResult.id);
    expect(itemResult._id).not.toBeNull();
  });

  it("list rows carry equal, non-null id and _id", () => {
    const item = {
      id: "item-1",
      name: "Torch",
      type: "loot",
      toObject() {
        return { _id: "item-1", name: "Torch", type: "loot", system: {} };
      }
    };
    const row = serializeItemSummary(item);
    expect(row.id).toBe("item-1");
    expect(row._id).toBe(row.id);
    expect(row._id).not.toBeNull();
  });

  it("a dry-run preview with a nulled id has id === _id === null", () => {
    const preview = {
      id: null,
      name: "Copy",
      type: "loot",
      toObject() {
        return { _id: null, name: "Copy", type: "loot", system: {} };
      }
    };
    const result = serializeItem(preview);
    expect(result.id).toBeNull();
    expect(result._id).toBeNull();
    expect(result._id).toBe(result.id);
  });

  const MIRROR_SKIP = new Set(["serializeCompendiumPack", "serializeSettingMetadata"]);
  /** @type {Record<string, any>} */
  const MIRROR_SERIALIZERS = Object.fromEntries(
    Object.entries(serializers).filter(
      ([name, fn]) => /^serialize/.test(name) && typeof fn === "function" && !MIRROR_SKIP.has(name)
    )
  );

  function mirrorDoc(id) {
    return {
      id,
      name: "X",
      type: "base",
      items: [],
      pages: [],
      parent: null,
      toObject() {
        return { _id: id, name: "X", type: "base", system: {} };
      }
    };
  }

  for (const [name, serialize] of Object.entries(MIRROR_SERIALIZERS)) {
    it(`${name} mirrors id into _id (non-null and nulled preview)`, () => {
      const live = serialize(mirrorDoc("doc-1"));
      expect(live.id).toBe("doc-1");
      expect(live._id).toBe(live.id);

      const preview = serialize(mirrorDoc(null));
      expect(preview.id).toBeNull();
      expect(preview._id).toBe(preview.id);
    });
  }

  it("mirrors id into _id on a folder (Folder is a document)", () => {
    const folder = {
      id: "folder-1",
      name: "Monsters",
      folder: null,
      toObject() {
        return { _id: "folder-1", name: "Monsters", type: "Actor", folder: null, color: null };
      }
    };
    const result = serializeFolder(folder);
    expect(result._id).toBe("folder-1");
    expect(result._id).toBe(result.id);
  });

  it("does NOT add _id to a setting registration (its `id` is a registration key, not a document _id)", () => {
    const row = serializeSettingMetadata(
      { namespace: "core", key: "time", scope: "world", type: Number },
      { namespace: "core", key: "time", id: "core.time" }
    );
    expect(row).not.toHaveProperty("_id");
    expect(row.id).toBe("core.time");
  });

  it("does NOT add _id to a compendium pack (its `id` is a collection key, not a document _id)", () => {
    const pack = {
      collection: "world.actors",
      title: "World Actors",
      documentName: "Actor",
      metadata: {}
    };
    expect(serializeCompendiumPack(pack)).not.toHaveProperty("_id");
  });
});

describe("serializeCombat", () => {
  /**
   * @param {string} id
   * @param {any} source
   * @param {any} derived
   */
  function derivedCombatant(id, source, derived) {
    return {
      id,
      toObject() {
        return { _id: id, ...source };
      },
      ...derived
    };
  }

  /** @param {{ source: any, combatants?: any[], groups?: any[], turns?: any[], current?: any }} options */
  function combatFixture({ source, combatants = [], groups = [], turns = undefined, current = null }) {
    const combatantList = combatants;
    return {
      id: source._id,

      scene: { id: "scene-live" },
      combatants: { size: combatantList.length, [Symbol.iterator]: () => combatantList[Symbol.iterator]() },
      groups: { size: groups.length, [Symbol.iterator]: () => groups[Symbol.iterator]() },
      turns,
      combatant: current,
      toObject() {
        return { ...source };
      }
    };
  }

  it("projects the full field set source-first, with `scene` as an ID and no ownership/folder keys", () => {
    const combat = combatFixture({
      source: {
        _id: "combat-1",
        type: "base",
        system: { phase: "ambush" },
        scene: "scene-stored",
        active: true,
        round: 3,
        turn: 1,
        sort: 7,
        flags: { mymod: { x: 1 } }
      },
      combatants: [],
      groups: []
    });

    const result = serializeCombat(combat);

    expect(result).toEqual({
      id: "combat-1",
      _id: "combat-1",

      name: null,
      type: "base",
      system: { phase: "ambush" },
      scene: "scene-stored",
      active: true,
      round: 3,
      turn: 1,
      started: true,
      sort: 7,
      flags: { mymod: { x: 1 } },
      combatantCount: 0,
      groupCount: 0,
      currentCombatantId: null,
      turns: []
    });

    expect(Object.hasOwn(result, "ownership")).toBe(false);
    expect(Object.hasOwn(result, "folder")).toBe(false);
    assertStructuredCloneable(result);
  });

  it("reports the v14 `name` (including a stored blank) and derives `started` from the round", () => {
    const named = serializeCombat(combatFixture({ source: { _id: "c-2", name: "Boss fight", round: 0 } }));
    expect(named.name).toBe("Boss fight");
    expect(named.started).toBe(false);
    const blank = serializeCombat(combatFixture({ source: { _id: "c-3", name: "", round: 1 } }));

    expect(blank.name).toBe("");
    expect(blank.started).toBe(true);
  });

  it("reads every derived-over-source combatant field from SOURCE, and `group` as an id", () => {
    const combatant = derivedCombatant(
      "combatant-1",
      {
        name: "",
        img: null,
        initiative: 12,
        actorId: null,
        tokenId: "token-1",
        sceneId: "scene-1",
        hidden: false,
        defeated: true,
        group: "group-1"
      },
      {
        name: "Goblin (from token)",
        img: "tokens/goblin.webp",
        initiative: 99, // the GROUP's initiative, which _prepareGroup writes over the combatant's
        actorId: "actor-derived",
        group: { id: "group-1", name: "Goblins" }
      }
    );

    expect(serializeCombatantTurn(combatant)).toEqual({
      id: "combatant-1",
      _id: "combatant-1",
      name: "",
      img: null,
      initiative: 12,
      hidden: false,
      defeated: true,
      group: "group-1",
      actorId: null,
      tokenId: "token-1",
      sceneId: "scene-1"
    });
  });

  it('reports an ABSENT stored `name` as `""` — the only field whose absent value is not null', () => {
    const nameless = derivedCombatant(
      "nameless",
      { tokenId: "token-1", sceneId: "scene-1", name: undefined, img: null, initiative: null, group: null },
      { name: "Goblin (from token)", img: "tokens/goblin.webp" }
    );
    expect(Object.hasOwn(nameless.toObject(), "name")).toBe(true);
    const row = serializeCombatantTurn(nameless);
    expect(row.name).toBe("");

    expect(row.img).toBeNull();
    expect(row.initiative).toBeNull();
    expect(row.group).toBeNull();
    expect(row.actorId).toBeNull();

    expect(serializeCombatantTurn({ id: "c-0" }).name).toBe("");
    expect(serializeCombatantTurn(derivedCombatant("c-null", { name: null }, {})).name).toBe("");

    expect(serializeCombatantTurn(derivedCombatant("c-blank", { name: "" }, {})).name).toBe("");
    expect(serializeCombatantTurn(derivedCombatant("c-named", { name: "Hero" }, {})).name).toBe("Hero");
  });

  it("keeps Combat's OWN `name` nullable — a v13 core has no such field", () => {
    expect(serializeCombat(combatFixture({ source: { _id: "c-v13" } })).name).toBeNull();
  });

  it("collapses a live `group` DOCUMENT to its id for a raw fixture with no source key", () => {
    expect(serializeCombatantTurn({ id: "c-1", group: { id: "group-9" } }).group).toBe("group-9");
  });

  it("uses Foundry's PREPARED turn order and never re-derives it from initiative", () => {
    const slow = derivedCombatant("slow", { name: "Slow", initiative: 2 }, {});
    const fast = derivedCombatant("fast", { name: "Fast", initiative: 20 }, {});
    const combat = combatFixture({
      source: { _id: "c-4", round: 1, turn: 1 },

      combatants: [slow, fast],
      turns: [fast, slow],
      current: slow
    });

    const result = serializeCombat(combat);
    expect(result.turns.map((turn) => turn.id)).toEqual(["fast", "slow"]);
    expect(result.currentCombatantId).toBe("slow");
    expect(result.combatantCount).toBe(2);
  });

  it("falls back to the collection when nothing has prepared a turn order (create preview)", () => {
    const a = derivedCombatant("a", { name: "A" }, {});
    const b = derivedCombatant("b", { name: "B" }, {});
    const result = serializeCombat(combatFixture({ source: { _id: "c-5" }, combatants: [a, b] }));
    expect(result.turns.map((turn) => turn.id)).toEqual(["a", "b"]);
  });

  it("`turnOrderFrom` projects another document's turn order (the degraded-preparation fallback)", () => {
    const fast = derivedCombatant("fast", { name: "Fast", initiative: 20 }, {});
    const slow = derivedCombatant("slow", { name: "Slow", initiative: 2 }, {});
    const live = combatFixture({
      source: { _id: "c-6", sort: 1, round: 1, turn: 0 },
      combatants: [slow, fast],
      turns: [fast, slow],
      current: fast
    });

    const preview = combatFixture({
      source: { _id: "c-6", sort: 42, round: 1, turn: 0 },
      combatants: [slow, fast]
    });

    const result = serializeCombat(preview, { turnOrderFrom: live });
    expect(result.sort).toBe(42);
    expect(result.turns.map((turn) => turn.id)).toEqual(["fast", "slow"]);

    expect(result.currentCombatantId).toBe("fast");
  });

  it("indexes the REPORTED turn and never reads Foundry's live `combatant` getter", () => {
    const first = derivedCombatant("first", { name: "First", initiative: 12 }, {});
    const second = derivedCombatant("second", { name: "Second", initiative: 4 }, {});

    const drifted = combatFixture({
      source: { _id: "c-8", round: 0, turn: 3 },
      combatants: [first, second],
      turns: [first, second],
      current: first
    });

    const result = serializeCombat(drifted);
    expect(result.turn).toBe(3);
    expect(result.started).toBe(false);
    expect(result.turns).toHaveLength(2);
    expect(result.currentCombatantId).toBeNull();

    const unstarted = combatFixture({
      source: { _id: "c-9", round: 0, turn: null },
      combatants: [first],
      turns: [first],
      current: first
    });
    const idle = serializeCombat(unstarted);
    expect(idle.turns).toHaveLength(1);
    expect(idle.currentCombatantId).toBeNull();
  });

  it("serializeCombatSummary drops the turn bodies and keeps both collection counts", () => {
    const a = derivedCombatant("a", { name: "A" }, {});
    const result = serializeCombatSummary(
      combatFixture({
        source: { _id: "c-7", scene: "scene-stored", active: true, round: 4, turn: 0 },
        combatants: [a],
        groups: [{ id: "g-1" }]
      })
    );
    expect(result).toEqual({
      id: "c-7",
      _id: "c-7",
      name: null,
      scene: "scene-stored",
      active: true,
      round: 4,
      turn: 0,
      started: true,
      combatantCount: 1,
      groupCount: 1
    });
    const summary = /** @type {any} */ (result);
    expect(summary.turns).toBeUndefined();
    expect(summary.flags).toBeUndefined();
  });

  it("serializeCombatant is the turn row PLUS the per-combatant fields, still source-first", () => {
    const combatant = derivedCombatant(
      "cmb-1",
      {
        type: "base",
        system: { mine: 1 },
        actorId: null,
        tokenId: "tok-1",
        sceneId: "scene-stored",
        name: "",
        img: null,
        initiative: 7,
        hidden: false,
        defeated: false,
        group: "grp-1",
        roundJoined: 3,
        flags: { mymod: { a: 1 } }
      },
      {
        name: "Token Goblin",
        img: "worlds/w/tokens/goblin.webp",
        actorId: "actor-live",
        initiative: 20,
        group: { id: "grp-live" }
      }
    );

    const parent = { id: "combat-1" };
    const result = serializeCombatant(combatant, parent);
    expect(result).toEqual({
      id: "cmb-1",
      _id: "cmb-1",
      combatId: "combat-1",
      name: "",
      img: null,
      initiative: 7,
      hidden: false,
      defeated: false,
      group: "grp-1",
      actorId: null,
      tokenId: "tok-1",
      sceneId: "scene-stored",
      type: "base",
      system: { mine: 1 },
      roundJoined: 3,
      flags: { mymod: { a: 1 } }
    });

    expect(result).toMatchObject(serializeCombatantTurn(combatant));
  });

  it("reports `roundJoined` null on a v13 core, where the field does not exist", () => {
    const v13 = derivedCombatant("cmb-13", { name: "Orc", initiative: null }, {});
    expect(serializeCombatant(v13).roundJoined).toBeNull();

    const withParent = derivedCombatant("cmb-p", { name: "Orc" }, { parent: { id: "combat-9" } });
    expect(serializeCombatant(withParent).combatId).toBe("combat-9");
    expect(serializeCombatant(v13).combatId).toBeNull();
  });

  it("serializeCombatantGroup reads stored name/img/initiative and DERIVED hidden/defeated/members", () => {
    const group = {
      id: "grp-1",
      initiative: 999,
      hidden: false,
      defeated: true,
      members: new Set([{ id: "cmb-1" }]),
      toObject: () => ({
        _id: "grp-1",
        type: "base",
        system: { s: 1 },
        name: "Wolf pack",
        img: "worlds/w/groups/pack.webp",
        initiative: 14,
        ownership: { default: 0, aaaaaaaaaa111111: -1 },
        flags: { mymod: { g: 2 } }
      })
    };

    const withOwnership = serializeCombatantGroup(
      group,
      { id: "combat-1" },
      {
        ownership: true,
        memberCombatantIds: ["cmb-1", "cmb-2"]
      }
    );
    expect(withOwnership).toEqual({
      id: "grp-1",
      _id: "grp-1",
      combatId: "combat-1",
      name: "Wolf pack",
      type: "base",
      system: { s: 1 },
      img: "worlds/w/groups/pack.webp",
      initiative: 14, // the STORED value, not the live 999
      flags: { mymod: { g: 2 } },
      hidden: false, // derived-only: reported live because there is no stored counterpart
      defeated: true,

      memberCombatantIds: ["cmb-1", "cmb-2"],

      ownership: { default: 0, aaaaaaaaaa111111: -1 }
    });

    const withoutOwnership = /** @type {any} */ (serializeCombatantGroup(group, { id: "combat-1" }));
    expect("ownership" in withoutOwnership).toBe(false);
    expect(withoutOwnership.memberCombatantIds).toEqual([]);
  });

  it("reports an UNPREPARED group's derived booleans as null rather than inventing false", () => {
    const preview = { id: null, toObject: () => ({ _id: null, name: "Fresh", initiative: null }) };
    const result = serializeCombatantGroup(preview, { id: "combat-1" });
    expect(result.hidden).toBeNull();
    expect(result.defeated).toBeNull();
    expect(result.id).toBeNull();
    expect(result.name).toBe("Fresh");

    const empty = { id: "grp-e", hidden: true, defeated: true, toObject: () => ({ _id: "grp-e", name: "" }) };
    expect(serializeCombatantGroup(empty).hidden).toBe(true);
    expect(serializeCombatantGroup(empty).defeated).toBe(true);
    expect(serializeCombatantGroup(empty).name).toBe("");
  });

  it("projects hidden/defeated from `derivedFrom` when the caller supplies one (the update dry-run)", () => {
    const preview = {
      id: "grp-live",
      hidden: true,
      defeated: true,
      toObject: () => ({ _id: "grp-live", name: "Renamed", initiative: 12 })
    };
    const live = { id: "grp-live", hidden: false, defeated: false };
    const projected = serializeCombatantGroup(preview, { id: "combat-1" }, { derivedFrom: live });
    expect([projected.hidden, projected.defeated]).toEqual([false, false]);

    expect(projected.name).toBe("Renamed");
    expect(projected.initiative).toBe(12);

    expect(serializeCombatantGroup(preview, { id: "combat-1" }).hidden).toBe(true);
  });

  it("serializeCombatantGroupSummary drops the bodies, counts members and never carries ownership", () => {
    const group = {
      id: "grp-2",
      hidden: true,
      defeated: false,
      toObject: () => ({
        _id: "grp-2",
        name: "Cultists",
        img: null,
        initiative: null,
        system: { s: 1 },
        flags: { f: 1 },
        ownership: { default: 3 }
      })
    };
    const result = /** @type {any} */ (
      serializeCombatantGroupSummary(group, { id: "combat-1" }, { memberCombatantIds: ["a", "b", "c"] })
    );
    expect(result).toEqual({
      id: "grp-2",
      _id: "grp-2",
      combatId: "combat-1",
      name: "Cultists",
      img: null,
      initiative: null,
      memberCount: 3,
      hidden: true,
      defeated: false
    });
    expect(result.ownership).toBeUndefined();
    expect(result.system).toBeUndefined();
    expect(result.flags).toBeUndefined();
  });

  it("combatOrderedCombatants IS the turn-order function combat.get uses", () => {
    const fast = derivedCombatant("fast", { name: "Fast", initiative: 20 }, {});
    const slow = derivedCombatant("slow", { name: "Slow", initiative: 2 }, {});

    const combat = combatFixture({ source: { _id: "c-ord" }, combatants: [slow, fast], turns: [fast, slow] });
    expect(combatOrderedCombatants(combat).map((row) => row.id)).toEqual(["fast", "slow"]);
    expect(combatOrderedCombatants(combat).map((row) => row.id)).toEqual(
      serializeCombat(combat).turns.map((turn) => turn.id)
    );

    const raw = combatFixture({ source: { _id: "c-raw" }, combatants: [slow, fast] });
    expect(combatOrderedCombatants(raw).map((row) => row.id)).toEqual(["slow", "fast"]);
    expect(
      combatOrderedCombatants({ toObject: () => ({ _id: "c-src", combatants: [{ _id: "x" }] }) })
    ).toHaveLength(1);
  });
});

describe("serializeChatMessage", () => {
  it("projects the full field set (author id, speaker, whisper, rolls, flags) source-first", () => {
    const message = {
      id: "msg-1",

      get flags() {
        throw new Error("serializeChatMessage read the live flags accessor");
      },

      author: { id: "user-1" },
      toObject() {
        return {
          _id: "msg-1",
          author: "user-1",
          content: "<p>hello</p>",
          speaker: { alias: "GM", actor: "actor-1" },
          whisper: ["u1", "u2"],
          blind: true,
          style: 0,
          flavor: "flavor text",
          sound: "sounds/ding.ogg",
          rolls: [{ formula: "2d6+3", total: 10 }],
          timestamp: 1234,
          flags: { mymod: { x: 1 } }
        };
      }
    };

    const result = serializeChatMessage(message);

    expect(result).toEqual({
      id: "msg-1",
      _id: "msg-1",
      author: "user-1",
      content: "<p>hello</p>",
      speaker: { alias: "GM", actor: "actor-1" },
      whisper: ["u1", "u2"],
      blind: true,
      style: 0,
      flavor: "flavor text",
      sound: "sounds/ding.ogg",
      rolls: [{ formula: "2d6+3", total: 10 }],
      timestamp: 1234,
      flags: { mymod: { x: 1 } }
    });
    assertStructuredCloneable(result);
  });

  it("serializes a plain-object fixture (no toObject) and defaults empties", () => {
    const result = serializeChatMessage({ id: "msg-2", author: "user-9", content: "hi" });
    expect(result).toMatchObject({
      id: "msg-2",
      author: "user-9",
      content: "hi",
      speaker: {},
      whisper: [],
      blind: false,
      rolls: [],
      flags: {}
    });
  });

  it("parses JSONField-encoded rolls (source is a serialized JSON string on real Foundry)", () => {
    const message = {
      id: "msg-3",
      author: "user-1",
      toObject() {
        return {
          _id: "msg-3",
          author: "user-1",
          content: "rolled",
          rolls: ['{"formula":"2d6+3","total":7}']
        };
      }
    };

    const result = serializeChatMessage(message);

    expect(result.rolls).toEqual([{ formula: "2d6+3", total: 7 }]);
    expect(result.rolls[0].total).toBe(7);
    assertStructuredCloneable(result);
  });

  it("leaves an unparseable roll string as-is rather than throwing", () => {
    const message = {
      id: "msg-4",
      author: "user-1",
      toObject() {
        return { _id: "msg-4", author: "user-1", rolls: ["not-json"] };
      }
    };
    expect(serializeChatMessage(message).rolls).toEqual(["not-json"]);
  });
});

describe("serializeChatMessageSummary", () => {
  it("projects identity + author + alias + truncated preview + contentLength + timestamp + whisperCount + rollCount", () => {
    const longContent = "x".repeat(150);
    const message = {
      id: "msg-1",
      author: { id: "user-1" },
      toObject() {
        return {
          _id: "msg-1",
          author: "user-1",
          content: longContent,
          speaker: { alias: "Narrator" },
          whisper: ["u1", "u2", "u3"],
          timestamp: 555,
          flags: { mymod: {} },
          rolls: [{ formula: "1d20", total: 12 }]
        };
      }
    };

    const result = serializeChatMessageSummary(message);

    expect(result).toEqual({
      id: "msg-1",
      _id: "msg-1",
      author: "user-1",
      alias: "Narrator",
      contentPreview: "x".repeat(100),

      contentLength: 150,
      timestamp: 555,
      whisperCount: 3,

      rollCount: 1
    });

    expect("rolls" in result).toBe(false);
    expect("flags" in result).toBe(false);
    assertStructuredCloneable(result);
  });
});

describe("ownership on world-doc reads", () => {
  const withOwnership = (id, extra = {}) => ({
    id,
    name: "Doc",
    type: "base",
    items: [],
    pages: [],
    toObject() {
      return {
        _id: id,
        name: "Doc",
        type: "base",
        system: {},
        ownership: { default: 0, "user-1": 3 },
        ...extra
      };
    }
  });

  it("omits ownership by DEFAULT (opt-in via the ownership option) for each world-doc serializer", () => {
    expect(serializeActor(withOwnership("a"))).not.toHaveProperty("ownership");
    expect(serializeItem(withOwnership("i"))).not.toHaveProperty("ownership");
    expect(serializeScene(withOwnership("s"))).not.toHaveProperty("ownership");
    expect(serializeMacro(withOwnership("m"))).not.toHaveProperty("ownership");
    expect(serializePlaylist(withOwnership("pl"))).not.toHaveProperty("ownership");
    expect(serializeJournal(withOwnership("j"))).not.toHaveProperty("ownership");
  });

  it("surfaces the ownership map when ownership:true is passed", () => {
    const expected = { default: 0, "user-1": 3 };
    expect(serializeActor(withOwnership("a"), { ownership: true }).ownership).toEqual(expected);
    expect(serializeItem(withOwnership("i"), { ownership: true }).ownership).toEqual(expected);
    expect(serializeScene(withOwnership("s"), { ownership: true }).ownership).toEqual(expected);
    expect(serializeMacro(withOwnership("m"), { ownership: true }).ownership).toEqual(expected);
    expect(serializePlaylist(withOwnership("pl"), { ownership: true }).ownership).toEqual(expected);
    expect(serializeJournal(withOwnership("j"), { ownership: true }).ownership).toEqual(expected);
  });

  it("returns {} (not null) when a document has no ownership map", () => {
    const bare = { id: "x", name: "X", toObject: () => ({ _id: "x", name: "X", system: {} }) };
    expect(serializeItem(bare, { ownership: true }).ownership).toEqual({});
  });

  it("threads ownership into journal pages (pages override the entry; INHERIT -1 preserved)", () => {
    const page = {
      id: "page-1",
      name: "GM Secrets",
      type: "text",
      toObject() {
        return { _id: "page-1", name: "GM Secrets", type: "text", ownership: { default: -1, "user-2": 3 } };
      }
    };
    const journal = {
      id: "j-1",
      name: "Handout",
      pages: [page],
      toObject() {
        return { _id: "j-1", name: "Handout", ownership: { default: 2 } };
      }
    };
    const result = serializeJournal(journal, { ownership: true });
    expect(result.ownership).toEqual({ default: 2 });
    expect(result.pages[0].ownership).toEqual({ default: -1, "user-2": 3 });

    const plain = serializeJournal(journal);
    expect(plain).not.toHaveProperty("ownership");
    expect(plain.pages[0]).not.toHaveProperty("ownership");
  });

  it("serializeJournalPage carries ownership only when opted in", () => {
    const page = {
      id: "p",
      name: "P",
      type: "text",
      toObject: () => ({ _id: "p", name: "P", type: "text", ownership: { default: -1 } })
    };
    expect(serializeJournalPage(page)).not.toHaveProperty("ownership");
    expect(serializeJournalPage(page, { ownership: true }).ownership).toEqual({ default: -1 });
  });
});

describe("serializeUser", () => {
  it("projects {id,_id,name,role,isGM,active,character,color,pronouns,avatar,flags}", () => {
    const user = {
      id: "user-1",
      name: "Hrelga",
      role: 1,
      isGM: false,
      active: true,
      character: { id: "actor-9" },
      color: { toString: () => "#ff0000" },
      toObject() {
        return {
          _id: "user-1",
          name: "Hrelga",
          role: 1,
          active: true,
          pronouns: "she/her",
          avatar: "worlds/w/a.png",
          flags: { world: { seat: 3 } }
        };
      }
    };
    const result = serializeUser(user);
    expect(result).toEqual({
      id: "user-1",
      _id: "user-1",
      name: "Hrelga",
      role: 1,
      isGM: false,
      active: true,
      character: "actor-9",
      color: "#ff0000",
      pronouns: "she/her",
      avatar: "worlds/w/a.png",
      flags: { world: { seat: 3 } }
    });
  });

  it("defaults missing fields (unassigned character, no color) to safe values", () => {
    const user = { id: "u", name: "Solo", isGM: true, toObject: () => ({ _id: "u", name: "Solo" }) };
    const result = serializeUser(user);
    expect(result.character).toBeNull();
    expect(result.color).toBeNull();
    expect(result.isGM).toBe(true);
    expect(result.active).toBe(false);
    expect(result.pronouns).toBeNull();
    expect(result.avatar).toBeNull();
    expect(result.flags).toEqual({});
  });
});

describe("serializeCards / serializeCard", () => {
  const previewSource = {
    name: "New Deck",
    type: "deck",
    img: "worlds/w/deck.webp",
    cards: [{ name: "Ace", suit: "S", value: 1, faces: [{ name: "front", img: "worlds/w/a.webp" }] }]
  };

  it("serializes a raw preview source, minting no ids and inventing no ownership", () => {
    const body = serializeCards(previewSource);
    expect(body).toMatchObject({ id: null, _id: null, name: "New Deck", type: "deck" });
    expect(body).not.toHaveProperty("ownership");
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]).toMatchObject({ id: null, _id: null, name: "Ace", suit: "S", value: 1 });

    expect(body.cards[0].drawn).toBe(false);
    expect(body.cards[0].origin).toBeNull();
    expect(body.cards[0].face).toBeNull();
    expect(body.cards[0].rotation).toBe(0);

    expect(body.cards[0]).not.toHaveProperty("img");
  });

  it("appends ownership ONLY when the get-only option asks for it", () => {
    const withOwnership = serializeCards(
      { ...previewSource, ownership: { default: 2 } },
      { ownership: true }
    );
    expect(withOwnership.ownership).toEqual({ default: 2 });
    expect(serializeCards({ ...previewSource, ownership: { default: 2 } })).not.toHaveProperty("ownership");
  });

  it("reports a stored INHERIT (-1) faithfully instead of filtering it out", () => {
    const body = serializeCards({ ...previewSource, ownership: { default: -1 } }, { ownership: true });
    expect(body.ownership).toEqual({ default: -1 });
  });

  it("summary counts use core's TYPE-DEPENDENT availability predicate", () => {
    const rows = [
      { name: "A", drawn: true },
      { name: "B", drawn: false }
    ];

    expect(serializeCardsSummary({ name: "D", type: "deck", cards: rows })).toMatchObject({
      cardCount: 2,
      drawnCount: 1,
      availableCount: 1
    });
    for (const type of ["hand", "pile"]) {
      expect(serializeCardsSummary({ name: "H", type, cards: rows })).toMatchObject({
        cardCount: 2,
        drawnCount: 1,
        availableCount: 2
      });
    }

    expect(serializeCardsSummary({ name: "D", type: "deck", cards: rows })).not.toHaveProperty("cards");
  });

  it("reads the cards COLLECTION live-first so a row the loader rejected is not reported", () => {
    const live = { name: "Kept", _source: { _id: "kept", name: "Kept", drawn: false } };
    live.toObject = () => ({ ...live._source });
    const stack = {
      _source: {
        _id: "deck",
        name: "Deck",
        type: "deck",

        cards: [live._source, { _id: "rejected", name: "Legacy", drawn: false }]
      },
      cards: [live]
    };
    stack.toObject = () => ({ ...stack._source, cards: stack._source.cards.map((row) => ({ ...row })) });
    const body = serializeCards(stack);
    expect(body.cards.map((card) => card.id)).toEqual(["kept"]);

    expect(serializeCardsSummary(stack)).toMatchObject({ cardCount: 1, drawnCount: 0, availableCount: 1 });
  });

  it("counts the STORED drawn flag, not the live one, in the summary counts", () => {
    const lied = { name: "Lied", drawn: true, _source: { _id: "lied", name: "Lied", drawn: false } };
    lied.toObject = () => ({ ...lied._source });
    const honest = { name: "Honest", drawn: true, _source: { _id: "honest", name: "Honest", drawn: true } };
    honest.toObject = () => ({ ...honest._source });
    const stack = {
      _source: { _id: "deck", name: "Deck", type: "deck", cards: [lied._source, honest._source] },
      cards: [lied, honest]
    };
    stack.toObject = () => ({ ...stack._source, cards: stack._source.cards.map((row) => ({ ...row })) });
    expect(serializeCardsSummary(stack)).toMatchObject({ cardCount: 2, drawnCount: 1, availableCount: 1 });
    expect(serializeCards(stack).cards.map((card) => card.drawn)).toEqual([false, true]);
  });

  it("serializeCard clones nested structures rather than handing out references", () => {
    const source = { name: "Ace", back: { text: "b", img: null }, faces: [{ name: "f" }], flags: { x: 1 } };
    const body = serializeCard(source);
    body.back.text = "mutated";
    body.faces[0].name = "mutated";
    body.flags.x = 99;
    expect(source.back.text).toBe("b");
    expect(source.faces[0].name).toBe("f");
    expect(source.flags.x).toBe(1);
  });
});

describe("serializeCardSummary / storedCardName", () => {
  const derivedCard = (overrides = {}) => {
    const source = {
      _id: "card-1",
      name: "Stored Ace",
      type: "base",
      suit: "S",
      value: 1,
      back: { name: "Back", text: "bt", img: null },
      faces: [{ name: "Face One", img: "worlds/w/ace.webp" }],
      face: 0,
      drawn: false,
      origin: "cardsAAAAAAAAAA1",
      sort: 100,
      ...overrides
    };
    const card = {
      id: source._id,
      _source: source,
      toObject: () => structuredClone(source),

      name: "Face One",
      back: { name: "Back", text: "bt", img: "worlds/w/deck.webp" },
      origin: { id: source.origin, name: "Poker Deck" },
      parent: { id: "cardsAAAAAAAAAA9", name: "Player Hand" }
    };
    return card;
  };

  it("names the owning stack on every row and reads name/origin from SOURCE", () => {
    const card = derivedCard();
    const row = serializeCardSummary(card, { id: "cardsAAAAAAAAAA9", name: "Player Hand" });
    expect(row).toEqual({
      id: "card-1",
      _id: "card-1",
      cardsId: "cardsAAAAAAAAAA9",
      cardsName: "Player Hand",
      name: "Stored Ace",
      type: "base",
      suit: "S",
      value: 1,
      face: 0,
      faceCount: 1,
      drawn: false,
      origin: "cardsAAAAAAAAAA1",
      sort: 100
    });

    expect(card.name).toBe("Face One");
    expect(card.origin.id).toBe("cardsAAAAAAAAAA1");

    for (const absent of ["back", "faces", "description", "system", "flags", "ownership", "img"]) {
      expect(row).not.toHaveProperty(absent);
    }
  });

  it("falls back to card.parent when no stack is passed", () => {
    const row = serializeCardSummary(derivedCard());
    expect(row).toMatchObject({ cardsId: "cardsAAAAAAAAAA9", cardsName: "Player Hand" });
  });

  it("reports the PERSISTED drawn flag when the live one diverges", () => {
    const card = derivedCard();
    card.drawn = true;
    expect(serializeCardSummary(card).drawn).toBe(false);

    expect(serializeCard(card).drawn).toBe(false);
  });

  it("tolerates a dangling origin and a raw preview row", () => {
    const dangling = /** @type {any} */ (derivedCard());
    dangling.origin = null;
    expect(serializeCardSummary(dangling).origin).toBe("cardsAAAAAAAAAA1");

    const preview = serializeCardSummary({ name: "Preview", faces: [{ name: "f" }] });
    expect(preview).toMatchObject({
      id: null,
      _id: null,
      cardsId: null,
      cardsName: null,
      name: "Preview",
      faceCount: 1,
      drawn: false,
      origin: null,
      sort: 0
    });
  });

  it("storedCardName is what the list filter must match, per read layer", () => {
    expect(storedCardName(derivedCard())).toBe("Stored Ace");
    const noSource = { name: "Face One", toObject: () => ({ name: "Stored King" }) };
    expect(storedCardName(noSource)).toBe("Stored King");
    expect(storedCardName({ name: "Raw" })).toBe("Raw");
    const blank = derivedCard({ name: "" });
    expect(storedCardName(blank)).toBe("");
    expect(storedCardName(undefined)).toBe("");
  });
});

describe("compendiumSource", () => {
  const UUID = "Compendium.dnd5e.items.Item.abcdefghij123456";

  /** @type {[string, (document: any, options?: any) => any, any][]} */
  const FULL = [
    ["actor", serializeActor, { _id: "a1", name: "A", type: "npc", items: [], effects: [] }],
    ["item", serializeItem, { _id: "i1", name: "I", type: "loot", effects: [] }],
    ["journal", serializeJournal, { _id: "j1", name: "J", pages: [] }],

    ["scene", (document) => serializeScene(document, { provenance: true }), { _id: "s1", name: "S" }],
    ["macro", serializeMacro, { _id: "m1", name: "M", type: "script" }],
    ["playlist", serializePlaylist, { _id: "p1", name: "P", sounds: [] }],
    ["table", serializeTable, { _id: "t1", name: "T", results: [] }],
    ["cards", serializeCards, { _id: "c1", name: "C", type: "deck", cards: [] }]
  ];

  it.each(FULL)(
    "%s FULL projection reports the stored compendiumSource and never raw _stats",
    (_name, serialize, source) => {
      const imported = serialize({
        id: source._id,
        toObject: () => ({ ...source, _stats: { compendiumSource: UUID, coreVersion: "13.351" } })
      });
      expect(imported.compendiumSource).toBe(UUID);

      expect(imported._stats).toBeUndefined();
      expect(imported.coreVersion).toBeUndefined();
    }
  );

  it.each(FULL)(
    "%s FULL projection reports null (a real answer) for a world-authored document",
    (_name, serialize, source) => {
      const authored = serialize({
        id: source._id,
        toObject: () => ({ ...source, _stats: { coreVersion: "13.351" } })
      });

      expect(Object.hasOwn(authored, "compendiumSource")).toBe(true);
      expect(authored.compendiumSource).toBeNull();
    }
  );

  it("stays OFF the lean list projections and OFF actor.get's nested items[] rows", () => {
    const withStats = (source) => ({
      id: source._id,
      toObject: () => ({ ...source, _stats: { compendiumSource: UUID } })
    });
    /** @type {{ name: string, summary: (document: any) => any, source: any }[]} */
    const LEAN = [
      {
        name: "actor",
        summary: serializeActorSummary,
        source: { _id: "a1", name: "A", type: "npc", items: [], effects: [] }
      },
      {
        name: "item",
        summary: serializeItemSummary,
        source: { _id: "i1", name: "I", type: "loot", effects: [] }
      },
      { name: "journal", summary: serializeJournalSummary, source: { _id: "j1", name: "J", pages: [] } },
      { name: "macro", summary: serializeMacroSummary, source: { _id: "m1", name: "M", type: "script" } },
      { name: "playlist", summary: serializePlaylistSummary, source: { _id: "p1", name: "P", sounds: [] } },
      { name: "table", summary: serializeTableSummary, source: { _id: "t1", name: "T", results: [] } },
      {
        name: "cards",
        summary: serializeCardsSummary,
        source: { _id: "c1", name: "C", type: "deck", cards: [] }
      },

      { name: "scene", summary: (document) => serializeScene(document), source: { _id: "s1", name: "S" } }
    ];
    for (const { name, summary, source } of LEAN) {
      expect(Object.hasOwn(summary(withStats(source)), "compendiumSource"), `${name} list row`).toBe(false);
    }

    expect(
      LEAN.map(({ name }) => name).sort(),
      "a family carries compendiumSource on its FULL projection with no lean-row assertion: add it to LEAN"
    ).toEqual(FULL.map(([name]) => name).sort());

    const actor = serializeActor({
      id: "a1",
      toObject: () => ({
        _id: "a1",
        name: "A",
        type: "npc",
        effects: [],
        items: [{ _id: "i1", name: "I", type: "loot", effects: [], _stats: { compendiumSource: UUID } }]
      })
    });
    expect(actor.compendiumSource).toBeNull();
    expect(Object.hasOwn(actor.items[0], "compendiumSource")).toBe(false);
  });
});
