import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { COMMAND_NAMES, WRITE_COMMANDS } from "../scripts/generated/protocol.js";

const MODULE_SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");

const FOUNDRY_GLOBALS = [
  "game", // the active game object (collections, world, user, version, release, system)
  "foundry", // namespaced API root (foundry.applications.apps.FilePicker, foundry.data.validation)
  "Roll"
];

const DEPRECATED_FOUNDRY_API_PATTERNS = [
  "globalThis.FormApplication",
  "globalThis.FilePicker",
  "globalThis.Application",
  "globalThis.Dialog",
  "globalThis.DocumentSheet",
  "foundry.appv1"
];

const GAME_MEMBERS = [
  "scenes",
  "items",
  "journal",
  "actors",
  "folders",
  "collections", // game.collections.get(<documentName>) — folder.delete/get content enumeration
  "packs",
  "modules",
  "world",
  "user",
  "version",
  "release",
  "system",
  "messages", // ChatMessage collection (chat.* family)
  "tables", // RollTable collection (table.* family); BaseRollTable.metadata.collection === "tables"

  "combats",

  "settings",

  "i18n"
];

const DOCUMENT_API = [
  "toObject", // canonical source data read (the structured-clone-safe serializer source)
  "documentClass", // non-deprecated constructor accessor on a collection
  "createEmbeddedDocuments", // scene-embedded token/tile/sound + actor.items/effects embedded create
  "updateEmbeddedDocuments",
  "deleteEmbeddedDocuments",
  "getTokenDocument", // synthetic token actor / ActorDelta access for delta-isolation
  "getDocument", // compendium entry load
  "documentName", // compendium document type discriminator

  "fromCompendium", // WorldCollection INSTANCE method — the normalization step of EVERY import verb (game.<coll>.fromCompendium)
  "effects", // ActiveEffect collection on an Actor OR Item parent (effect CRUD)

  "behaviors",

  "appliedEffects", // fallback runtime union view of applied effects
  "allApplicableEffects", // primary runtime union (own + item-transferred, incl. disabled)

  "playAll", // playlist.play
  "stopAll", // playlist.stop
  "playNext", // playlist.playNext (mode-dependent)
  "playSound", // playlist.sound.play (takes a PlaylistSound instance)
  "stopSound", // playlist.sound.stop (takes a PlaylistSound instance)

  "getSpeaker", // ChatMessage.getSpeaker({ user }) default speaker
  "evaluate", // roll.evaluate() dice-AST evaluation (NEVER JS eval / toMessage)

  "draw", // table.draw --count 1
  "drawMany", // table.draw --count > 1
  "resetResults", // table.reset
  "parseUuid", // foundry.utils.parseUuid — core's OWN nested-RollTable recursion predicate

  "randomID",
  "deepClone",

  "turns",

  "shuffle", // cards.shuffle
  "recall", // cards.reset (NEVER `stack.reset()`, which is DataModel#reset and writes nothing)
  "deal", // cards.deal
  "pass"
];

const GAME_MEMBER_ANCHORS = {
  settings: "game.settings?.settings",

  i18n: ["game?.i18n?.localize", "game?.i18n?.format"]
};

const DOCUMENT_API_CALL_ANCHORS = {
  draw: ["table.draw(", "stack.draw("],
  drawMany: "table.drawMany(",
  resetResults: "table.resetResults(",
  parseUuid: "utils?.parseUuid",

  randomID: "utils?.randomID",
  deepClone: "utils?.deepClone",

  shuffle: "stack.shuffle(",
  recall: "stack.recall(",
  deal: "stack.deal(",
  pass: "stack.pass(",

  turns: "combat?.turns"
};

const FILEPICKER_API = ["browse", "createDirectory", "upload"];

function readModuleSource() {
  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "generated" || entry.name === "vendor") {
          continue;
        }

        walk(full);
        continue;
      }

      if (entry.name.endsWith(".js")) {
        sources.push(readFileSync(full, "utf8"));
      }
    }
  };

  walk(MODULE_SCRIPTS_DIR);
  return sources.join("\n");
}

describe("Foundry API surface the module depends on (v14 migration checklist)", () => {
  const source = readModuleSource();

  it.each(FOUNDRY_GLOBALS)("reads the Foundry global `globalThis.%s`", (name) => {
    const accessed = source.includes(`globalThis.${name}`) || source.includes(`globalThis).${name}`);
    expect(accessed).toBe(true);
  });

  it.each(DEPRECATED_FOUNDRY_API_PATTERNS)("does not use deprecated Foundry API `%s`", (pattern) => {
    expect(source).not.toContain(pattern);
  });

  it.each(GAME_MEMBERS)("references game.%s", (name) => {
    const anchor = GAME_MEMBER_ANCHORS[name];
    if (anchor) {
      for (const literal of Array.isArray(anchor) ? anchor : [anchor]) {
        expect(source.includes(literal), `expected the literal read \`${literal}\``).toBe(true);
      }
      return;
    }

    expect(new RegExp(`game[?.]*\\.${name}\\b`).test(source)).toBe(true);
  });

  it.each(DOCUMENT_API)("references the document/collection API `%s`", (name) => {
    const anchor = DOCUMENT_API_CALL_ANCHORS[name];
    if (anchor) {
      for (const literal of Array.isArray(anchor) ? anchor : [anchor]) {
        expect(source.includes(literal), `expected the literal call \`${literal}\``).toBe(true);
      }
      return;
    }

    expect(new RegExp(`\\.${name}\\b`).test(source)).toBe(true);
  });

  it.each(FILEPICKER_API)("references FilePicker.%s", (name) => {
    expect(new RegExp(`FilePicker\\.${name}\\(`).test(source)).toBe(true);
  });
});

const HANDLERS_DIR = join(MODULE_SCRIPTS_DIR, "handlers");

const OWNERSHIP_READ_COMMANDS = [
  "actor.get",
  "actor.get-many",
  "item.get",
  "item.get-many",
  "journal.get",
  "journal.get-many",
  "scene.get",
  "scene.get-many",
  "macro.get",
  "macro.get-many",
  "playlist.get",
  "playlist.get-many",
  "table.get",
  "table.get-many",

  "cards.get",
  "cards.get-many",
  "combat.group.get"
];

const OWNERSHIP_READBACK_FILE = "ownership.js";

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function scanOwnershipOptionSites() {
  const attributed = new Set();
  const unattributed = [];
  let sawReadbackFile = false;

  for (const entry of readdirSync(HANDLERS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const lines = stripComments(readFileSync(join(HANDLERS_DIR, entry.name), "utf8")).split("\n");

    if (entry.name === OWNERSHIP_READBACK_FILE) {
      sawReadbackFile = lines.some((line) => /\bownership:\s*true\b/.test(line));
      continue;
    }

    let currentCommand = null;
    for (const [index, line] of lines.entries()) {
      const declaration = /async\s+"([^"]+)"\s*\(/.exec(line);
      if (declaration) currentCommand = declaration[1];
      if (!/\bownership:\s*true\b/.test(line)) continue;
      if (currentCommand) attributed.add(currentCommand);
      else unattributed.push(`${entry.name}:${index + 1}`);
    }
  }

  return { attributed: [...attributed], unattributed, sawReadbackFile };
}

describe("ownership READ surface (derived from the handler sources)", () => {
  const FAILURE_HINT =
    "the ownership READ surface changed: update OWNERSHIP_READ_COMMANDS here AND the canonical rule in " +
    'docs/security.md → "Document ownership" (plus the serializeOwnership block in ' +
    "scripts/lib/serializers.js and the ownership rule in skills/foundry-world-editor/SKILL.md)";

  it("is EXACTLY the enumerated commands — an unlisted addition fails here", () => {
    const { attributed } = scanOwnershipOptionSites();
    expect(attributed.slice().sort(), FAILURE_HINT).toEqual(OWNERSHIP_READ_COMMANDS.slice().sort());
  });

  it("attributes every `ownership: true` occurrence to a command (a helper cannot hide one)", () => {
    const { unattributed } = scanOwnershipOptionSites();
    expect(
      unattributed,
      `unattributable \`ownership: true\` outside handlers/${OWNERSHIP_READBACK_FILE}. ${FAILURE_HINT}`
    ).toEqual([]);
  });

  it("keeps the handlers/ownership.js carve-out honest (the read-back really passes the option)", () => {
    const { sawReadbackFile } = scanOwnershipOptionSites();
    expect(sawReadbackFile, `handlers/${OWNERSHIP_READBACK_FILE} no longer passes ownership: true`).toBe(
      true
    );
  });

  it("every derived command is a real, NON-mutating command in the inventory", () => {
    const writes = new Set(WRITE_COMMANDS);
    for (const command of OWNERSHIP_READ_COMMANDS) {
      expect(COMMAND_NAMES, `${command} is not a known command`).toContain(command);
      expect(writes.has(command), `${command} is a write, not a read`).toBe(false);
    }
  });
});
