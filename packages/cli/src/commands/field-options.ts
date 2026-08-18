import { Command, Option } from "commander";

import {
  parseActorIncludeFields,
  parseBoolean,
  parseIncludeFields,
  parseNumber,
  parsePositiveInt
} from "../parse.js";

export type FieldVerb = "create" | "update" | "clone";

interface FieldSpec {
  flag: string;
  help: string | Partial<Record<FieldVerb, string>>;
  parser?: (value: string) => unknown;
  conflicts?: string;
}

function addFieldOptions(command: Command, verb: FieldVerb, specs: readonly FieldSpec[]): Command {
  for (const spec of specs) {
    const help = typeof spec.help === "string" ? spec.help : spec.help[verb];
    if (help === undefined) {
      throw new Error(`No ${verb} help text is declared for ${spec.flag}`);
    }
    const option = new Option(spec.flag, help);
    if (spec.parser) {
      option.argParser(spec.parser);
    }
    if (spec.conflicts) {
      option.conflicts(spec.conflicts);
    }
    command.addOption(option);
  }
  return command;
}

const FOLDER_ID_FIELD: FieldSpec = {
  flag: "--folder <folder>",
  help: { create: "Folder id", update: "New folder id", clone: "Folder id override" }
};

const CLEAR_FOLDER_FIELD: FieldSpec = {
  flag: "--clear-folder",
  help: "Explicitly set folder to null",
  conflicts: "folder"
};

const CLEAR_IMG_FIELD: FieldSpec = {
  flag: "--clear-img",
  help: "Explicitly set img to null",
  conflicts: "img"
};

const IMAGE_FIELD: FieldSpec = {
  flag: "--img <img>",
  help: { create: "Image path", update: "New image path", clone: "Image override" }
};

const SORT_ORDER_FIELD: FieldSpec = {
  flag: "--sort <sort>",
  help: { create: "Sort order", update: "Sort order", clone: "Sort order override" },
  parser: parseNumber
};

const SUBTYPE_SYSTEM_JSON_FIELD: FieldSpec = {
  flag: "--system-json <json>",
  help: "Subtype system data as a JSON object"
};

const CARD_ROTATION_HELP = "Card display rotation, 0 to under 360 (360 is rejected: Foundry stores it as 0)";

export function addReservedIncludeOption(
  command: Command,
  presence: "in the result" | "on this command"
): Command {
  return command.option(
    "--include <fields>",
    `Reserved (allowed: flags, effects) — both are always present ${presence}, so this option currently has no effect`,
    parseIncludeFields
  );
}

export function addActorIncludeOption(command: Command): Command {
  return command.option(
    "--include <fields>",
    "Comma-separated extra fields (items.flags, items.effects, prepared add output; flags/effects are always present, so those two have no effect)",
    parseActorIncludeFields
  );
}

const SCENE_FIELDS: readonly FieldSpec[] = [
  { flag: "--active <active>", help: "Scene active state", parser: parseBoolean },
  { flag: "--navigation <navigation>", help: "Scene navigation visibility", parser: parseBoolean },
  { flag: "--nav-order <navOrder>", help: "Scene navigation order", parser: parseNumber },
  { flag: "--width <width>", help: "Scene width", parser: parseNumber },
  { flag: "--height <height>", help: "Scene height", parser: parseNumber },
  { flag: "--token-vision <tokenVision>", help: "Token vision enabled", parser: parseBoolean },
  { flag: "--weather <weather>", help: "Weather effect id" },
  { flag: "--padding <padding>", help: "Scene padding (0–0.5)", parser: parseNumber },
  { flag: "--shift-x <shiftX>", help: "Background X shift", parser: parseNumber },
  { flag: "--shift-y <shiftY>", help: "Background Y shift", parser: parseNumber },
  { flag: "--nav-name <navName>", help: "Navigation label" },
  { flag: "--thumb <thumb>", help: "Thumbnail image path" },
  { flag: "--foreground <foreground>", help: "Foreground image path" },
  {
    flag: "--foreground-elevation <foregroundElevation>",
    help: "Foreground image elevation",
    parser: parseNumber
  },
  { flag: "--sort <sort>", help: "Sort order", parser: parseNumber },
  { flag: "--initial-level <initialLevel>", help: "Initial elevation level id" },
  { flag: "--playlist <playlistId>", help: "Linked playlist id" },
  { flag: "--playlist-sound <playlistSoundId>", help: "Linked playlist sound id" },
  { flag: "--journal <journalId>", help: "Linked journal id" },
  { flag: "--journal-entry-page <journalEntryPageId>", help: "Linked journal page id" },
  { flag: "--environment-json <json>", help: "Scene environment (darkness/globalLight) as JSON object" },
  { flag: "--fog-json <json>", help: "Scene fog config as JSON object" },
  { flag: "--initial-json <json>", help: "Scene initial view position as JSON object" },
  { flag: "--transition-json <json>", help: "Scene transition config as JSON object" },
  {
    flag: "--grid-json <json>",
    help: {
      create: "Scene grid as JSON object",
      update: "Scene grid patch as JSON object",
      clone: "Scene grid override as JSON object"
    }
  },
  {
    flag: "--background-json <json>",
    help: {
      create: "Scene background as JSON object",
      update: "Scene background patch as JSON object",
      clone: "Scene background override as JSON object"
    }
  }
];

export function addSceneFieldOptions(command: Command, verb: FieldVerb): Command {
  return addFieldOptions(command, verb, SCENE_FIELDS);
}

const TOKEN_NAME_FIELD: FieldSpec = {
  flag: "--name <name>",
  help: { create: "Token name override", update: "Token name", clone: "Name override for the clone" }
};

const TOKEN_POSITION_FIELDS: readonly FieldSpec[] = [
  { flag: "--x <x>", help: "Token x position", parser: parseNumber },
  { flag: "--y <y>", help: "Token y position", parser: parseNumber }
];

const TOKEN_BODY_FIELDS: readonly FieldSpec[] = [
  { flag: "--hidden <hidden>", help: "Token hidden state", parser: parseBoolean },
  { flag: "--rotation <rotation>", help: "Token rotation", parser: parseNumber },
  { flag: "--elevation <elevation>", help: "Token elevation", parser: parseNumber },
  { flag: "--disposition <disposition>", help: "Token disposition", parser: parseNumber },
  {
    flag: "--linked",
    help: {
      create: "Link the token to the world actor",
      update: "Link the token to the world actor",
      clone: "Link the clone to the world actor"
    }
  },
  {
    flag: "--unlinked",
    help: {
      create: "Keep the token unlinked (per-token actor delta)",
      update: "Unlink the token (per-token actor delta)",
      clone: "Unlink the clone (per-token actor delta)"
    },
    conflicts: "linked"
  }
];

export function addTokenFieldOptions(command: Command, verb: FieldVerb): Command {
  const ordered =
    verb === "create"
      ? [...TOKEN_POSITION_FIELDS, TOKEN_NAME_FIELD, ...TOKEN_BODY_FIELDS]
      : [TOKEN_NAME_FIELD, ...TOKEN_POSITION_FIELDS, ...TOKEN_BODY_FIELDS];
  return addFieldOptions(command, verb, ordered);
}

const TILE_FIELDS: readonly FieldSpec[] = [
  { flag: "--x <x>", help: "Tile x position", parser: parseNumber },
  { flag: "--y <y>", help: "Tile y position", parser: parseNumber },
  { flag: "--width <width>", help: "Tile width", parser: parseNumber },
  { flag: "--height <height>", help: "Tile height", parser: parseNumber },
  { flag: "--rotation <rotation>", help: "Tile rotation", parser: parseNumber },
  { flag: "--elevation <elevation>", help: "Tile elevation", parser: parseNumber },
  { flag: "--hidden <hidden>", help: "Tile hidden state", parser: parseBoolean },
  { flag: "--locked <locked>", help: "Tile locked state", parser: parseBoolean }
];

export function addTileFieldOptions(command: Command, verb: FieldVerb): Command {
  return addFieldOptions(command, verb, TILE_FIELDS);
}

const SCENE_SOUND_FIELDS: readonly FieldSpec[] = [
  { flag: "--path <path>", help: "Sound file path" },
  { flag: "--x <x>", help: "Sound x position", parser: parseNumber },
  { flag: "--y <y>", help: "Sound y position", parser: parseNumber },
  { flag: "--radius <radius>", help: "Sound radius", parser: parseNumber },
  { flag: "--volume <volume>", help: "Sound volume", parser: parseNumber },
  { flag: "--hidden <hidden>", help: "Sound hidden state", parser: parseBoolean }
];

export function addSceneSoundFieldOptions(command: Command, verb: FieldVerb): Command {
  return addFieldOptions(command, verb, SCENE_SOUND_FIELDS);
}

const REGION_BEHAVIOR_FIELDS: readonly FieldSpec[] = [
  {
    flag: "--name <name>",
    help: {
      create: 'Behavior name (may be blank: --name "")',
      update: 'Behavior name (may be blank: --name "")',
      clone: 'Behavior name for the clone (may be blank: --name "")'
    }
  },
  // Explicit-value boolean (`--disabled true|false`), matching the `*.effect.*` families' own
  // `--disabled`/`--transfer` convention rather than a negatable pair, so the flag reads the same
  // way on create, update and clone and an omitted flag is unambiguously "do not touch it".
  {
    flag: "--disabled <disabled>",
    help: {
      create: "Disabled state (true|false)",
      update: "Disabled state (true|false)",
      clone: "Disabled state for the clone (true|false)"
    },
    parser: parseBoolean
  },
  {
    flag: "--system-json <json>",
    help: {
      create: "Per-type behavior data as a JSON object (e.g. teleportToken destination)",
      update: "Per-type behavior data as a JSON object",
      clone: "Per-type behavior data as a JSON object"
    }
  }
];

export function addRegionBehaviorFieldOptions(command: Command, verb: FieldVerb): Command {
  return addFieldOptions(command, verb, REGION_BEHAVIOR_FIELDS);
}

function effectFields(transferNote: string): readonly FieldSpec[] {
  return [
    {
      flag: "--name <name>",
      help: { create: "Effect name", update: "New effect name", clone: "Name override for the clone" }
    },
    {
      flag: "--img <img>",
      help: { create: "Icon/image path", update: "New icon/image path", clone: "Icon/image override" }
    },
    {
      flag: "--disabled <disabled>",
      help: {
        create: "Effect disabled state",
        update: "Effect disabled state",
        clone: "Disabled override"
      },
      parser: parseBoolean
    },
    {
      flag: "--transfer <transfer>",
      help: {
        create: `Transfer effect to the owning actor${transferNote}`,
        update: `Transfer effect to the owning actor${transferNote}`,
        clone: `Transfer override${transferNote}`
      },
      parser: parseBoolean
    }
  ];
}

export function addEffectFieldOptions(command: Command, verb: FieldVerb, transferNote = ""): Command {
  return addFieldOptions(command, verb, effectFields(transferNote));
}

const ITEM_SORT_FIELD: FieldSpec = {
  flag: "--sort <sort>",
  help: { create: "Item sort value", update: "New item sort value", clone: "Sort override" },
  parser: parseNumber
};

const ITEM_SYSTEM_JSON_FIELD: FieldSpec = {
  flag: "--system-json <json>",
  help: {
    create: "Item system payload as JSON object",
    update: "Item system patch as JSON object",
    clone: "Item system override as JSON object"
  }
};

export function addItemFieldOptions(command: Command, verb: FieldVerb): Command {
  return addFieldOptions(command, verb, [
    IMAGE_FIELD,
    FOLDER_ID_FIELD,
    CLEAR_FOLDER_FIELD,
    ITEM_SORT_FIELD,
    ITEM_SYSTEM_JSON_FIELD
  ]);
}

export function addEmbeddedItemFieldOptions(command: Command, verb: FieldVerb): Command {
  return addFieldOptions(command, verb, [IMAGE_FIELD, ITEM_SORT_FIELD, ITEM_SYSTEM_JSON_FIELD]);
}

const ACTOR_FIELDS: readonly FieldSpec[] = [
  IMAGE_FIELD,
  FOLDER_ID_FIELD,
  CLEAR_FOLDER_FIELD,
  {
    flag: "--sort <sort>",
    help: { create: "Actor sort value", update: "New actor sort value", clone: "Sort override" },
    parser: parseNumber
  },
  {
    flag: "--system-json <json>",
    help: {
      create: "Actor system payload as JSON object",
      update: "Actor system patch as JSON object",
      clone: "Actor system override as JSON object"
    }
  }
];

export function addActorFieldOptions(command: Command, verb: FieldVerb): Command {
  return addFieldOptions(command, verb, ACTOR_FIELDS);
}

const JOURNAL_FIELDS: readonly FieldSpec[] = [
  FOLDER_ID_FIELD,
  CLEAR_FOLDER_FIELD,
  {
    flag: "--sort <sort>",
    help: { create: "Journal sort value", update: "New journal sort value", clone: "Sort override" },
    parser: parseNumber
  }
];

export function addJournalFieldOptions(command: Command, verb: FieldVerb): Command {
  return addFieldOptions(command, verb, JOURNAL_FIELDS);
}

export const JOURNAL_CATEGORY_NAME_HELP = 'Category name (may be blank: --name "")';

const JOURNAL_CATEGORY_NAME_FIELD: FieldSpec = {
  flag: "--name <name>",
  help: JOURNAL_CATEGORY_NAME_HELP
};

const JOURNAL_CATEGORY_SORT_FIELD: FieldSpec = {
  flag: "--sort <sort>",
  help: "Sort order (integer)",
  parser: parseNumber
};

export function addJournalCategoryFieldOptions(command: Command, verb: "create" | "update"): Command {
  const ordered =
    verb === "create"
      ? [JOURNAL_CATEGORY_SORT_FIELD]
      : [JOURNAL_CATEGORY_NAME_FIELD, JOURNAL_CATEGORY_SORT_FIELD];
  return addFieldOptions(command, verb, ordered);
}

const PLAYLIST_FIELDS: readonly FieldSpec[] = [
  {
    flag: "--description <description>",
    help: { create: "Playlist description", update: "New description", clone: "Description override" }
  },
  {
    flag: "--mode <mode>",
    help: {
      create: "Playlist mode (numeric; see CONST.PLAYLIST_MODES)",
      update: "New mode (numeric; see CONST.PLAYLIST_MODES)",
      clone: "Mode override"
    },
    parser: parseNumber
  },
  {
    flag: "--playing <playing>",
    help: { create: "Playing state", update: "Playing state", clone: "Playing state override" },
    parser: parseBoolean
  },
  {
    flag: "--fade <fade>",
    help: { create: "Crossfade duration (ms)", update: "Crossfade duration (ms)", clone: "Fade override" },
    parser: parseNumber
  },
  {
    flag: "--channel <channel>",
    help: {
      create: "Audio channel (e.g. music | environment | interface)",
      update: "Audio channel",
      clone: "Channel override"
    }
  },
  {
    flag: "--sorting <sorting>",
    help: { create: "Sort mode (e.g. a | m)", update: "Sort mode", clone: "Sort mode override" }
  },
  {
    flag: "--seed <seed>",
    help: { create: "Shuffle seed", update: "Shuffle seed", clone: "Seed override" },
    parser: parseNumber
  },
  FOLDER_ID_FIELD,
  CLEAR_FOLDER_FIELD,
  SORT_ORDER_FIELD
];

export function addPlaylistFieldOptions(command: Command, verb: FieldVerb): Command {
  return addFieldOptions(command, verb, PLAYLIST_FIELDS);
}

const PLAYLIST_SOUND_PATH_FIELD: FieldSpec = {
  flag: "--path <path>",
  help: { update: "Audio file path", clone: "Audio file path override" }
};

const PLAYLIST_SOUND_FIELDS: readonly FieldSpec[] = [
  {
    flag: "--name <name>",
    help: {
      create: "Track name (Foundry derives from path if omitted)",
      update: "Track name",
      clone: "Track name override"
    }
  },
  {
    flag: "--description <description>",
    help: { create: "Track description", update: "Track description", clone: "Description override" }
  },
  {
    flag: "--channel <channel>",
    help: { create: "Audio channel", update: "Audio channel", clone: "Audio channel override" }
  },
  {
    flag: "--playing <playing>",
    help: { create: "Playing state", update: "Playing state", clone: "Playing state override" },
    parser: parseBoolean
  },
  {
    flag: "--paused-time <pausedTime>",
    help: { create: "Paused time (seconds)", update: "Paused time (seconds)", clone: "Paused time override" },
    parser: parseNumber
  },
  {
    flag: "--repeat <repeat>",
    help: { create: "Repeat state", update: "Repeat state", clone: "Repeat state override" },
    parser: parseBoolean
  },
  {
    flag: "--volume <volume>",
    help: {
      create: "Volume (linear 0–1)",
      update: "Volume (linear 0–1)",
      clone: "Volume override (linear 0–1)"
    },
    parser: parseNumber
  },
  {
    flag: "--fade <fade>",
    help: { create: "Fade duration (ms)", update: "Fade duration (ms)", clone: "Fade override" },
    parser: parseNumber
  },
  SORT_ORDER_FIELD
];

export function addPlaylistSoundFieldOptions(command: Command, verb: FieldVerb): Command {
  return addFieldOptions(
    command,
    verb,
    verb === "create" ? PLAYLIST_SOUND_FIELDS : [PLAYLIST_SOUND_PATH_FIELD, ...PLAYLIST_SOUND_FIELDS]
  );
}

const TABLE_FIELDS: readonly FieldSpec[] = [
  {
    flag: "--description <description>",
    help: {
      create: "Roll table description (HTML allowed)",
      update: "New description",
      clone: "Description override"
    }
  },
  {
    flag: "--img <img>",
    help: {
      create: "Table image path (data-relative)",
      update: "New image path",
      clone: "Image override"
    }
  },
  CLEAR_IMG_FIELD,
  {
    flag: "--formula <formula>",
    help: {
      create: 'Roll formula, e.g. "1d20" (empty = Foundry normalizes on first draw)',
      update: "New roll formula",
      clone: "Formula override"
    }
  },
  {
    flag: "--replacement <replacement>",
    help: {
      create: "Draw with replacement (true) or mark results drawn (false)",
      update: "Draw with replacement",
      clone: "Replacement override"
    },
    parser: parseBoolean
  },
  {
    flag: "--display-roll <displayRoll>",
    help: {
      create: "Show the roll in chat",
      update: "Show the roll in chat",
      clone: "Display-roll override"
    },
    parser: parseBoolean
  },
  FOLDER_ID_FIELD,
  CLEAR_FOLDER_FIELD,
  SORT_ORDER_FIELD
];

export function addTableFieldOptions(command: Command, verb: FieldVerb): Command {
  return addFieldOptions(command, verb, TABLE_FIELDS);
}

const TABLE_RESULT_FIELDS: readonly FieldSpec[] = [
  {
    flag: "--type <type>",
    help: {
      create: 'Result type: "text" (default) or "document"',
      update: 'New result type: "text" or "document"',
      clone: "Result type override"
    }
  },
  {
    flag: "--name <name>",
    help: { create: "Row name (may be blank)", update: "New row name", clone: "Row name override" }
  },
  {
    flag: "--description <description>",
    help: {
      create: "Row description (HTML allowed)",
      update: "New row description",
      clone: "Description override"
    }
  },
  {
    flag: "--img <img>",
    help: { create: "Row image path (data-relative)", update: "New row image path", clone: "Image override" }
  },
  CLEAR_IMG_FIELD,
  {
    flag: "--document-uuid <uuid>",
    help: {
      create: 'Referenced document uuid (required with --type document), e.g. "Actor.<id>"',
      update: "New referenced document uuid",
      clone: "Document uuid override"
    }
  },
  {
    flag: "--clear-document-uuid",
    help: "Explicitly set documentUuid to null",
    conflicts: "documentUuid"
  },
  {
    flag: "--weight <weight>",
    help: {
      create: "Relative draw weight (integer >= 1)",
      update: "Relative draw weight (integer >= 1)",
      clone: "Weight override"
    },
    parser: parseNumber
  },
  {
    flag: "--drawn <drawn>",
    help: { create: "Mark the row already drawn", update: "Drawn state", clone: "Drawn state override" },
    parser: parseBoolean
  }
];

export function addTableResultFieldOptions(command: Command, verb: FieldVerb): Command {
  return addFieldOptions(command, verb, TABLE_RESULT_FIELDS);
}

const CARDS_FIELDS: readonly FieldSpec[] = [
  {
    flag: "--description <description>",
    help: {
      create: "Stack description (HTML allowed)",
      update: "New description",
      clone: "Description override"
    }
  },
  {
    flag: "--img <img>",
    help: {
      create: "Stack image or video path (data-relative)",
      update: "New image or video path",
      clone: "Image override"
    }
  },
  CLEAR_IMG_FIELD,
  {
    flag: "--width <width>",
    help: {
      create: "Card display width (integer >= 1)",
      update: "Card display width (integer >= 1)",
      clone: "Card display width override"
    },
    parser: parsePositiveInt
  },
  {
    flag: "--height <height>",
    help: {
      create: "Card display height (integer >= 1)",
      update: "Card display height (integer >= 1)",
      clone: "Card display height override"
    },
    parser: parsePositiveInt
  },
  {
    flag: "--rotation <rotation>",
    help: {
      create: CARD_ROTATION_HELP,
      update: CARD_ROTATION_HELP,
      clone: "Rotation override (0 to under 360)"
    },
    parser: parseNumber
  },
  {
    flag: "--display-count <displayCount>",
    help: {
      create: "Show the card count in the sidebar",
      update: "Show the card count in the sidebar",
      clone: "Display-count override"
    },
    parser: parseBoolean
  },
  FOLDER_ID_FIELD,
  CLEAR_FOLDER_FIELD,
  SORT_ORDER_FIELD,
  {
    flag: "--system-json <json>",
    help: {
      create: "System-specific data as a JSON object",
      update: "System-specific data as a JSON object",
      clone: "System-specific data override as a JSON object"
    }
  }
];

export function addCardsFieldOptions(command: Command, verb: FieldVerb): Command {
  return addFieldOptions(command, verb, CARDS_FIELDS);
}

const CARD_FIELDS: readonly FieldSpec[] = [
  {
    flag: "--description <description>",
    help: {
      create: "Card description (HTML allowed)",
      update: "New description",
      clone: "Description override"
    }
  },
  {
    flag: "--suit <suit>",
    help: {
      create: "Card suit (may be blank — Foundry allows it)",
      update: "New suit (may be blank)",
      clone: "Suit override"
    }
  },
  {
    flag: "--value <value>",
    help: {
      create: 'Card value (a NUMBER — Foundry rejects a rank like "K")',
      update: "New value (a NUMBER)",
      clone: "Value override (a NUMBER)"
    },
    parser: parseNumber
  },
  { flag: "--clear-value", help: "Explicitly set value to null", conflicts: "value" },
  {
    flag: "--face <face>",
    help: {
      create: "Shown face index (integer >= 0)",
      update: "Flip to this face index (integer >= 0)",
      clone: "Shown face override"
    },
    parser: parseNumber
  },
  {
    flag: "--clear-face",
    help: {
      create: "Show the card BACK (face = null)",
      update: "Flip to the card BACK (face = null)",
      clone: "Show the card BACK (face = null)"
    },
    conflicts: "face"
  },
  {
    flag: "--back-json <json>",
    help: {
      create: 'Card back as a JSON object: {"name":"…","text":"…","img":"path"}',
      update: "Card back fields as a JSON object (MERGES into the existing back)",
      clone: "Card back override as a JSON object (merges into the copied back)"
    }
  },
  {
    flag: "--faces-json <json>",
    help: {
      create: 'Card faces as a JSON array, e.g. [{"name":"Ace of Spades","img":"worlds/w/ace.webp"}]',
      update: "Card faces as a JSON array (REPLACES the whole array)",
      clone: "Card faces override as a JSON array (replaces the whole array)"
    }
  },
  {
    flag: "--width <width>",
    help: {
      create: "Card display width (integer >= 1)",
      update: "Card display width (integer >= 1)",
      clone: "Width override"
    },
    parser: parsePositiveInt
  },
  {
    flag: "--height <height>",
    help: {
      create: "Card display height (integer >= 1)",
      update: "Card display height (integer >= 1)",
      clone: "Height override"
    },
    parser: parsePositiveInt
  },
  {
    flag: "--rotation <rotation>",
    help: {
      create: CARD_ROTATION_HELP,
      update: CARD_ROTATION_HELP,
      clone: "Rotation override (0 to under 360)"
    },
    parser: parseNumber
  },
  SORT_ORDER_FIELD,
  {
    flag: "--system-json <json>",
    help: {
      create: "System-specific data as a JSON object",
      update: "System-specific data as a JSON object",
      clone: "System data override as a JSON object"
    }
  }
];

export function addCardFieldOptions(command: Command, verb: FieldVerb): Command {
  return addFieldOptions(command, verb, CARD_FIELDS);
}

const COMBAT_FIELDS: readonly FieldSpec[] = [
  {
    flag: "--scene <sceneId>",
    help: {
      create: "Scene id to link the combat to",
      update: "New linked scene id (must contain every combatant)"
    }
  },
  {
    flag: "--clear-scene",
    help: {
      create: "Explicitly set scene to null (no linked scene)",
      update: "Explicitly set scene to null (unlink)"
    },
    conflicts: "scene"
  },
  { flag: "--sort <sort>", help: "Sort order", parser: parseNumber },
  SUBTYPE_SYSTEM_JSON_FIELD
];

export function addCombatFieldOptions(command: Command, verb: "create" | "update"): Command {
  return addFieldOptions(command, verb, COMBAT_FIELDS);
}

const COMBATANT_FIELDS: readonly FieldSpec[] = [
  {
    flag: "--hidden <hidden>",
    help: { create: "Hide the combatant from players", update: "Hidden state" },
    parser: parseBoolean
  },
  {
    flag: "--defeated <defeated>",
    help: { create: "Mark the combatant defeated", update: "Defeated state" },
    parser: parseBoolean
  },
  {
    flag: "--group <groupId>",
    help: {
      create: "Combatant group id to join (must be a group of THIS combat)",
      update: "Join this combatant group (must be a group of THIS combat)"
    }
  },
  {
    flag: "--clear-group",
    help: {
      create: "Explicitly set group to null (no group)",
      update: "Leave the current group (group -> null)"
    },
    conflicts: "group"
  },
  {
    flag: "--round-joined <roundJoined>",
    help: {
      create: "Round the combatant joined (v14 only, integer >= 1)",
      update: "Round the combatant joined (v14 only)"
    },
    parser: parseNumber
  },
  SUBTYPE_SYSTEM_JSON_FIELD
];

export function addCombatantFieldOptions(command: Command, verb: "create" | "update"): Command {
  return addFieldOptions(command, verb, COMBATANT_FIELDS);
}

const COMBATANT_GROUP_FIELDS: readonly FieldSpec[] = [
  {
    flag: "--img <img>",
    help: {
      create: "Group image path (data-relative; blank is rejected, use --clear-img)",
      update: "New image path (blank is rejected, use --clear-img)"
    }
  },
  CLEAR_IMG_FIELD,
  {
    flag: "--initiative <initiative>",
    help: {
      create: "Group initiative (overrides its members' initiative)",
      update: "New group initiative"
    },
    parser: parseNumber
  },
  { flag: "--clear-initiative", help: "Explicitly set initiative to null", conflicts: "initiative" },
  SUBTYPE_SYSTEM_JSON_FIELD
];

export function addCombatantGroupFieldOptions(command: Command, verb: "create" | "update"): Command {
  return addFieldOptions(command, verb, COMBATANT_GROUP_FIELDS);
}

const MACRO_FIELDS: readonly FieldSpec[] = [
  {
    flag: "--type <type>",
    help: {
      create: "Macro type (script | chat)",
      update: "New macro type (script | chat)",
      clone: "Type override (script | chat)"
    }
  },
  {
    flag: "--command <command>",
    help: {
      create: "Macro body inline (short bodies only)",
      update: "New macro body inline (short bodies only)",
      clone: "Macro body override inline (short bodies only)"
    }
  },
  {
    flag: "--command-file <path>",
    help: {
      create: "Read the macro body from a local file",
      update: "Read the new macro body from a local file",
      clone: "Read the macro body override from a local file"
    }
  },
  {
    flag: "--command-stdin",
    help: {
      create: "Read the macro body from stdin",
      update: "Read the new macro body from stdin",
      clone: "Read the macro body override from stdin"
    }
  },
  IMAGE_FIELD,
  FOLDER_ID_FIELD,
  CLEAR_FOLDER_FIELD,
  {
    flag: "--scope <scope>",
    help: {
      create: "Macro scope (global | actors | actor)",
      update: "New macro scope (global | actors | actor)",
      clone: "Scope override (global | actors | actor)"
    }
  }
];

export function addMacroFieldOptions(command: Command, verb: FieldVerb): Command {
  return addFieldOptions(command, verb, MACRO_FIELDS);
}

const FOLDER_DESCRIPTION_FIELD: FieldSpec = {
  flag: "--description <description>",
  help: { create: "Folder description (HTML)", update: "New description (HTML)" }
};

const FOLDER_COLOR_FIELD: FieldSpec = {
  flag: "--color <color>",
  help: { create: "Folder color (hex, e.g. #ff0000)", update: "New folder color (hex)" }
};

const FOLDER_CLEAR_COLOR_FIELD: FieldSpec = {
  flag: "--clear-color",
  help: "Clear the folder color (set to null)",
  conflicts: "color"
};

const FOLDER_SORTING_FIELD: FieldSpec = { flag: "--sorting <sorting>", help: "Sort mode (a | m)" };

const FOLDER_PARENT_FIELD: FieldSpec = {
  flag: "--folder <folder>",
  help: { create: "Parent folder id", update: "New parent folder id (reparent/move)" }
};

const FOLDER_CLEAR_PARENT_FIELD: FieldSpec = {
  flag: "--clear-folder",
  help: "Move to the folder root (folder = null)",
  conflicts: "folder"
};

export function addFolderFieldOptions(command: Command, verb: "create" | "update"): Command {
  const ordered =
    verb === "create"
      ? [
          FOLDER_DESCRIPTION_FIELD,
          FOLDER_PARENT_FIELD,
          FOLDER_COLOR_FIELD,
          FOLDER_SORTING_FIELD,
          SORT_ORDER_FIELD
        ]
      : [
          FOLDER_DESCRIPTION_FIELD,
          FOLDER_COLOR_FIELD,
          FOLDER_CLEAR_COLOR_FIELD,
          FOLDER_SORTING_FIELD,
          SORT_ORDER_FIELD,
          FOLDER_PARENT_FIELD,
          FOLDER_CLEAR_PARENT_FIELD
        ];
  return addFieldOptions(command, verb, ordered);
}
