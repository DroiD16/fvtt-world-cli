import { COMMAND_DEFINITIONS } from "../generated/protocol.js";
import { getCardById, getCardsById } from "./cards-docs.js";
import { getChatMessageById } from "./chat-docs.js";
import { getCombatById, getCombatantById, getCombatantGroupById } from "./combat-docs.js";
import { getEmbeddedEffect } from "./effects.js";
import { getActorItemById, getEmbeddedItem, getSceneTokenActor } from "./embedded-items.js";
import { getFolderById } from "./folders.js";
import {
  getActorById,
  getItemById,
  getJournalById,
  getMacroById,
  getSceneById,
  getUserById
} from "./game-collections.js";
import { getJournalCategoryById } from "./journal-docs.js";
import { getPlaylistById, getPlaylistSoundById } from "./playlist-docs.js";
import { getSceneRegionBehaviorById } from "./region-behaviors.js";
import { getSceneEmbeddedCollection } from "./scene-embedded.js";
import { getTableById, getTableResultById } from "./table-docs.js";

/** @typedef {"world-document" | "embedded-document" | "bulk" | "create" | "file-path" | "none"} ApprovalTargetKind */
/** @typedef {"resolved" | "not-found" | "unspecified" | "proposed" | "path"} ApprovalTargetState */
/** @typedef {{ idField: string, type: string, resolve: (ids: string[]) => any }} ApprovalTargetNode */
/** @typedef {{ path: string, node: ApprovalTargetNode }} ApprovalTargetLink */
/** @typedef {{ property: string, node: ApprovalTargetNode, chain: ApprovalTargetLink[] }} ApprovalTargetReference */
/**
 * @typedef {{
 *   kind: ApprovalTargetKind,
 *   chain: ApprovalTargetLink[],
 *   collection: ApprovalTargetLink | null,
 *   elementProperty: string | null,
 *   payloadProperty: string | null,
 *   pathProperties: string[],
 *   references: ApprovalTargetReference[],
 *   descriptorProperties: string[]
 * }} ApprovalTargetStrategy
 */
/** @typedef {{ type: string | null, id: string | null, name: string | null, state: ApprovalTargetState }} ApprovalTargetParent */
/**
 * @typedef {{
 *   role: string,
 *   type: string | null,
 *   id: string | null,
 *   name: string | null,
 *   state: ApprovalTargetState,
 *   parents: ApprovalTargetParent[]
 * }} ApprovalTarget
 */
/**
 * @typedef {{
 *   kind: ApprovalTargetKind,
 *   collection: string | null,
 *   targets: ApprovalTarget[],
 *   totalCount: number,
 *   omittedCount: number,
 *   descriptor: { key: string, value: string }[]
 * }} ApprovalTargetSummary
 */

export const APPROVAL_TARGET_KINDS = Object.freeze([
  "world-document",
  "embedded-document",
  "bulk",
  "create",
  "file-path",
  "none"
]);

export const APPROVAL_TARGET_STATES = Object.freeze([
  "resolved",
  "not-found",
  "unspecified",
  "proposed",
  "path"
]);

export const APPROVAL_TARGET_DISPLAY_MAX = 25;

export const APPROVAL_TARGET_FILE_TYPE = "File";

const FILE_PATH_PROPERTIES = Object.freeze(["path", "from", "to"]);

// `contentBase64` carries an entire upload payload; reading it here would defeat the redaction the
// parameter renderer applies, so no summary may ever describe it.
const DESCRIPTOR_EXCLUDED_PROPERTIES = new Set(["dryRun", "idempotencyKey", "contentBase64"]);

const CREATE_VERBS = new Set(["create", "import-from-compendium"]);

// A card movement command writes to a counterpart stack of its own family that no segment of the
// command name declares; without this the summary would omit a document the command changes.
/** @type {Readonly<Record<string, string>>} */
const COUNTERPART_PROPERTIES = Object.freeze({
  "cards.deal": "to",
  "cards.draw": "from",
  "cards.pass": "to"
});

/**
 * @param {string} idField
 * @param {string} type
 * @returns {ApprovalTargetNode}
 */
function scenePlaceableNode(idField, type) {
  return {
    idField,
    type,
    resolve: (ids) => getSceneEmbeddedCollection(getSceneById(ids[0]), type)?.get?.(ids[1]) ?? null
  };
}

/** @type {Readonly<Record<string, ApprovalTargetNode>>} */
const TARGET_NODES = Object.freeze({
  scene: { idField: "sceneId", type: "Scene", resolve: (ids) => getSceneById(ids[0]) },
  "scene.token": scenePlaceableNode("tokenId", "Token"),
  "scene.tile": scenePlaceableNode("tileId", "Tile"),
  "scene.sound": scenePlaceableNode("soundId", "AmbientSound"),
  "scene.wall": scenePlaceableNode("wallId", "Wall"),
  "scene.note": scenePlaceableNode("noteId", "Note"),
  "scene.drawing": scenePlaceableNode("drawingId", "Drawing"),
  "scene.light": scenePlaceableNode("lightId", "AmbientLight"),
  "scene.template": scenePlaceableNode("templateId", "MeasuredTemplate"),
  "scene.region": scenePlaceableNode("regionId", "Region"),
  "scene.region.behavior": {
    idField: "behaviorId",
    type: "RegionBehavior",
    resolve: (ids) => getSceneRegionBehaviorById(ids[0], ids[1], ids[2]).behavior
  },
  "scene.token.item": {
    idField: "itemId",
    type: "Item",
    resolve: (ids) => getEmbeddedItem(getSceneTokenActor(ids[0], ids[1]).actor, ids[2])
  },
  "scene.token.item.effect": {
    idField: "effectId",
    type: "ActiveEffect",
    resolve: (ids) =>
      getEmbeddedEffect(getEmbeddedItem(getSceneTokenActor(ids[0], ids[1]).actor, ids[2]), ids[3])
  },
  "scene.token.effect": {
    idField: "effectId",
    type: "ActiveEffect",
    resolve: (ids) => getEmbeddedEffect(getSceneTokenActor(ids[0], ids[1]).actor, ids[2])
  },
  actor: { idField: "actorId", type: "Actor", resolve: (ids) => getActorById(ids[0]) },
  "actor.item": { idField: "itemId", type: "Item", resolve: (ids) => getActorItemById(ids[0], ids[1]) },
  "actor.effect": {
    idField: "effectId",
    type: "ActiveEffect",
    resolve: (ids) => getEmbeddedEffect(getActorById(ids[0]), ids[1])
  },
  "actor.item.effect": {
    idField: "effectId",
    type: "ActiveEffect",
    resolve: (ids) => getEmbeddedEffect(getActorItemById(ids[0], ids[1]), ids[2])
  },
  item: { idField: "itemId", type: "Item", resolve: (ids) => getItemById(ids[0]) },
  "item.effect": {
    idField: "effectId",
    type: "ActiveEffect",
    resolve: (ids) => getEmbeddedEffect(getItemById(ids[0]), ids[1])
  },
  journal: { idField: "journalId", type: "JournalEntry", resolve: (ids) => getJournalById(ids[0]) },
  "journal.category": {
    idField: "categoryId",
    type: "JournalEntryCategory",
    resolve: (ids) => getJournalCategoryById(ids[0], ids[1]).category
  },
  "journal.page": {
    idField: "pageId",
    type: "JournalEntryPage",
    resolve: (ids) => getJournalById(ids[0]).pages?.get?.(ids[1]) ?? null
  },
  macro: { idField: "macroId", type: "Macro", resolve: (ids) => getMacroById(ids[0]) },
  playlist: { idField: "playlistId", type: "Playlist", resolve: (ids) => getPlaylistById(ids[0]) },
  "playlist.sound": {
    idField: "soundId",
    type: "PlaylistSound",
    resolve: (ids) => getPlaylistSoundById(ids[0], ids[1]).sound
  },
  table: { idField: "tableId", type: "RollTable", resolve: (ids) => getTableById(ids[0]) },
  "table.result": {
    idField: "resultId",
    type: "TableResult",
    resolve: (ids) => getTableResultById(ids[0], ids[1]).result
  },
  combat: { idField: "combatId", type: "Combat", resolve: (ids) => getCombatById(ids[0]) },
  "combat.combatant": {
    idField: "combatantId",
    type: "Combatant",
    resolve: (ids) => getCombatantById(ids[0], ids[1]).combatant
  },
  "combat.group": {
    idField: "groupId",
    type: "CombatantGroup",
    resolve: (ids) => getCombatantGroupById(ids[0], ids[1]).group
  },
  cards: { idField: "cardsId", type: "Cards", resolve: (ids) => getCardsById(ids[0]) },
  "cards.card": {
    idField: "cardId",
    type: "Card",
    resolve: (ids) => getCardById(ids[0], ids[1]).card
  },
  chat: { idField: "messageId", type: "ChatMessage", resolve: (ids) => getChatMessageById(ids[0]) },
  folder: { idField: "folderId", type: "Folder", resolve: (ids) => getFolderById(ids[0]) },
  user: { idField: "userId", type: "User", resolve: (ids) => getUserById(ids[0]) }
});

/** @type {Map<string, ApprovalTargetLink>} */
const CHILD_NODES = new Map(
  Object.entries(TARGET_NODES)
    .filter(([path]) => path.includes("."))
    .map(([path, node]) => [
      `${path.slice(0, path.lastIndexOf("."))}/${node.idField}`,
      Object.freeze({ path, node })
    ])
);

/**
 * @param {string} property
 * @returns {string}
 */
function singularIdProperty(property) {
  return property.endsWith("Ids") ? property.slice(0, -1) : property;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function readId(value) {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * @param {unknown} document
 * @returns {string | null}
 */
function readDisplayName(document) {
  const name = isRecord(document) ? document.name : null;
  return typeof name === "string" && name.trim() !== "" ? name : null;
}

/**
 * @param {ApprovalTargetNode} node
 * @param {string[]} ids
 * @returns {unknown}
 */
function resolveDocument(node, ids) {
  try {
    return node.resolve(ids) ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {string} command
 * @returns {ApprovalTargetStrategy}
 */
function buildStrategy(command) {
  const schema = COMMAND_DEFINITIONS[command].paramsSchema ?? {};
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const declares = (/** @type {string} */ property) => Object.hasOwn(properties, property);

  const segments = command.split(".");
  const verb = segments[segments.length - 1];

  /** @type {ApprovalTargetLink[]} */
  const chain = [];
  /** @type {ApprovalTargetLink | null} */
  let collection = null;
  let path = "";

  for (const segment of segments.slice(0, -1)) {
    path = path === "" ? segment : `${path}.${segment}`;
    const node = TARGET_NODES[path];
    if (!node) {
      break;
    }

    if (!declares(node.idField)) {
      collection = { path, node };
      break;
    }

    chain.push({ path, node });
  }

  const chainFields = new Set(chain.map((link) => link.node.idField));

  const elementProperty = verb.endsWith("-many")
    ? (["patches", "data", "ids"].find((property) => declares(property)) ?? null)
    : null;

  const payloadProperty = CREATE_VERBS.has(verb)
    ? (["data", "patch"].find((property) => declares(property)) ?? null)
    : null;

  const pathProperties =
    chain.length === 0 && collection === null
      ? FILE_PATH_PROPERTIES.filter((property) => declares(property))
      : [];

  const counterpartProperty = COUNTERPART_PROPERTIES[command] ?? null;
  /** @type {ApprovalTargetReference[]} */
  const references = counterpartProperty
    ? [{ property: counterpartProperty, node: TARGET_NODES[segments[0]], chain: [] }]
    : [];

  const parentPath = chain.length > 0 ? chain[chain.length - 1].path : null;
  if (parentPath !== null) {
    for (const property of Object.keys(properties)) {
      if (chainFields.has(property) || property === elementProperty || property === counterpartProperty) {
        continue;
      }

      const child = CHILD_NODES.get(`${parentPath}/${singularIdProperty(property)}`);
      if (child) {
        references.push({ property, node: child.node, chain });
      }
    }
  }

  const referenceProperties = new Set(references.map((reference) => reference.property));

  const descriptorProperties = required.filter(
    (property) =>
      properties[property]?.type === "string" &&
      !chainFields.has(property) &&
      property !== elementProperty &&
      !pathProperties.includes(property) &&
      !referenceProperties.has(property) &&
      !DESCRIPTOR_EXCLUDED_PROPERTIES.has(property)
  );

  /** @type {ApprovalTargetKind} */
  const kind = elementProperty
    ? "bulk"
    : CREATE_VERBS.has(verb)
      ? "create"
      : chain.length > 1
        ? "embedded-document"
        : chain.length === 1
          ? "world-document"
          : pathProperties.length > 0
            ? "file-path"
            : "none";

  return Object.freeze({
    kind,
    chain,
    collection,
    elementProperty,
    payloadProperty,
    pathProperties,
    references,
    descriptorProperties
  });
}

/** @type {Readonly<Record<string, ApprovalTargetStrategy>>} */
const STRATEGIES = Object.freeze(
  Object.fromEntries(Object.keys(COMMAND_DEFINITIONS).map((command) => [command, buildStrategy(command)]))
);

/**
 * @param {string} command
 * @returns {ApprovalTargetStrategy | null}
 */
export function getApprovalTargetStrategy(command) {
  return STRATEGIES[command] ?? null;
}

/**
 * @param {ApprovalTargetLink[]} chain
 * @param {Record<string, unknown>} params
 * @returns {ApprovalTarget[]}
 */
function resolveChainTargets(chain, params) {
  /** @type {ApprovalTarget[]} */
  const targets = [];
  /** @type {string[]} */
  const ids = [];
  let broken = false;

  for (const link of chain) {
    const id = readId(params[link.node.idField]);
    if (id === null) {
      broken = true;
    } else {
      ids.push(id);
    }

    const document = id === null || broken ? null : resolveDocument(link.node, ids);
    targets.push({
      role: link.node.idField,
      type: link.node.type,
      id,
      name: readDisplayName(document),
      state: id === null ? "unspecified" : document ? "resolved" : "not-found",
      parents: targets.map(toParent)
    });
  }

  return targets;
}

/**
 * @param {ApprovalTarget} target
 * @returns {ApprovalTargetParent}
 */
function toParent(target) {
  return { type: target.type, id: target.id, name: target.name, state: target.state };
}

/**
 * @param {ApprovalTargetLink[]} chain
 * @param {Record<string, unknown>} params
 * @returns {string[] | null}
 */
function collectChainIds(chain, params) {
  /** @type {string[]} */
  const ids = [];
  for (const link of chain) {
    const id = readId(params[link.node.idField]);
    if (id === null) {
      return null;
    }

    ids.push(id);
  }

  return ids;
}

/**
 * @param {unknown[]} elements
 * @param {string} elementProperty
 * @returns {{ id: string | null, name: string | null }[]}
 */
function readElements(elements, elementProperty) {
  return elements.map((element) => {
    if (elementProperty === "patches") {
      return { id: isRecord(element) ? readId(element.id) : null, name: null };
    }

    if (elementProperty === "data") {
      return { id: null, name: readDisplayName(element) };
    }

    return { id: readId(element), name: null };
  });
}

/**
 * @param {ApprovalTargetStrategy} strategy
 * @param {Record<string, unknown>} params
 * @param {ApprovalTargetParent[]} parents
 * @returns {{ targets: ApprovalTarget[], totalCount: number, omittedCount: number }}
 */
function resolveBulkTargets(strategy, params, parents) {
  const elementProperty = strategy.elementProperty ?? "ids";
  const raw = params[elementProperty];
  const elements = Array.isArray(raw) ? raw : [];
  const shown = readElements(elements.slice(0, APPROVAL_TARGET_DISPLAY_MAX), elementProperty);
  const node = strategy.collection?.node ?? null;
  const chainIds = collectChainIds(strategy.chain, params);

  const targets = shown.map(({ id, name }) => {
    if (id === null) {
      return {
        role: elementProperty,
        type: node?.type ?? null,
        id: null,
        name,
        state: /** @type {ApprovalTargetState} */ (elementProperty === "data" ? "proposed" : "unspecified"),
        parents
      };
    }

    const document = node && chainIds ? resolveDocument(node, [...chainIds, id]) : null;
    return {
      role: elementProperty,
      type: node?.type ?? null,
      id,
      name: readDisplayName(document),
      state: /** @type {ApprovalTargetState} */ (document ? "resolved" : "not-found"),
      parents
    };
  });

  return {
    targets,
    totalCount: elements.length,
    omittedCount: Math.max(0, elements.length - targets.length)
  };
}

/**
 * @param {ApprovalTargetStrategy} strategy
 * @param {Record<string, unknown>} params
 * @returns {ApprovalTarget[]}
 */
function resolveFileTargets(strategy, params) {
  return strategy.pathProperties.map((property) => {
    const value = params[property];
    const path = typeof value === "string" && value !== "" ? value : null;
    return {
      role: property,
      type: APPROVAL_TARGET_FILE_TYPE,
      id: null,
      name: path,
      state: /** @type {ApprovalTargetState} */ (path === null ? "unspecified" : "path"),
      parents: []
    };
  });
}

/**
 * @param {ApprovalTargetReference[]} references
 * @param {Record<string, unknown>} params
 * @param {ApprovalTarget[]} chainTargets
 * @returns {ApprovalTarget[]}
 */
function resolveReferenceTargets(references, params, chainTargets) {
  return references.flatMap((reference) => {
    const raw = params[reference.property];
    const values = Array.isArray(raw) ? raw : [raw];
    const parentIds = collectChainIds(reference.chain, params);
    const parents = chainTargets.slice(0, reference.chain.length).map(toParent);
    /** @type {ApprovalTarget[]} */
    const targets = [];
    for (const value of values) {
      const id = readId(value);
      if (id === null) {
        continue;
      }

      const document = parentIds === null ? null : resolveDocument(reference.node, [...parentIds, id]);
      targets.push({
        role: reference.property,
        type: reference.node.type,
        id,
        name: readDisplayName(document),
        state: document ? "resolved" : "not-found",
        parents
      });
    }

    return targets;
  });
}

/**
 * @param {ApprovalTargetStrategy} strategy
 * @param {Record<string, unknown>} params
 * @returns {{ key: string, value: string }[]}
 */
function resolveDescriptor(strategy, params) {
  /** @type {{ key: string, value: string }[]} */
  const descriptor = [];
  for (const key of strategy.descriptorProperties) {
    const value = params[key];
    if (typeof value === "string" && value !== "") {
      descriptor.push({ key, value });
    }
  }

  return descriptor;
}

/**
 * @param {ApprovalTargetStrategy} strategy
 * @param {Record<string, unknown>} params
 * @param {ApprovalTarget[]} chainTargets
 * @param {string | null} collection
 * @returns {{ targets: ApprovalTarget[], totalCount: number, omittedCount: number }}
 */
function resolveKindTargets(strategy, params, chainTargets, collection) {
  if (strategy.kind === "bulk") {
    return resolveBulkTargets(strategy, params, chainTargets.map(toParent));
  }

  if (strategy.kind === "create") {
    const payload = strategy.payloadProperty ? params[strategy.payloadProperty] : null;
    const targets = [
      {
        role: strategy.payloadProperty ?? "data",
        type: collection,
        id: null,
        name: readDisplayName(payload),
        state: /** @type {ApprovalTargetState} */ ("proposed"),
        parents: chainTargets.map(toParent)
      }
    ];
    return { targets, totalCount: 1, omittedCount: 0 };
  }

  const targets = strategy.kind === "file-path" ? resolveFileTargets(strategy, params) : chainTargets;

  return { targets, totalCount: targets.length, omittedCount: 0 };
}

/**
 * @param {string} command
 * @param {unknown} params
 * @returns {ApprovalTargetSummary}
 */
export function resolveApprovalTargets(command, params) {
  const strategy = getApprovalTargetStrategy(command);
  const source = isRecord(params) ? params : {};

  if (!strategy) {
    return {
      kind: "none",
      collection: null,
      targets: [],
      totalCount: 0,
      omittedCount: 0,
      descriptor: []
    };
  }

  const chainTargets = resolveChainTargets(strategy.chain, source);
  const collection = strategy.collection?.node.type ?? null;
  const descriptor = resolveDescriptor(strategy, source);
  const base = resolveKindTargets(strategy, source, chainTargets, collection);

  const references = resolveReferenceTargets(strategy.references, source, chainTargets);
  const shownReferences = references.slice(0, APPROVAL_TARGET_DISPLAY_MAX);

  return {
    kind: strategy.kind,
    collection,
    targets: [...base.targets, ...shownReferences],
    totalCount: base.totalCount + references.length,
    omittedCount: base.omittedCount + (references.length - shownReferences.length),
    descriptor
  };
}
