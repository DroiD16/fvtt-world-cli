import MiniSearch from "../vendor/minisearch.mjs";
import {
  SEARCH_COMPENDIUM_INDEX_MAX_BYTES,
  SEARCH_COMPENDIUM_INDEX_MAX_ENTRIES,
  SEARCH_CORPUS_STATUSES,
  SEARCH_INDEXED_TYPES,
  SEARCH_MAX_MATCHES,
  SEARCH_RESPONSE_MAX_BYTES,
  SEARCH_RESULT_SOURCES,
  SEARCH_WORLD_INDEX_MAX_BYTES,
  SEARCH_WORLD_INDEX_MAX_ENTRIES,
  estimateSearchIndexBytes
} from "../generated/protocol.js";
import { clipWithoutSplittingPair, extractDocumentText } from "./search-text.js";
import { storedDocumentName } from "./serializers.js";

import { utf8ByteLength } from "./setting-values.js";

export const SEARCH_WORLD_COLLECTIONS = Object.freeze({
  Actor: "actors",
  Item: "items",
  JournalEntry: "journal",
  Scene: "scenes",
  Macro: "macros",
  Playlist: "playlists",
  RollTable: "tables",
  Cards: "cards",
  Folder: "folders"
});

export const SEARCH_EMBEDDED_CHILDREN = Object.freeze({
  Actor: Object.freeze([
    Object.freeze({ documentType: "Item", collection: "items" }),
    Object.freeze({ documentType: "ActiveEffect", collection: "effects" })
  ]),
  Item: Object.freeze([Object.freeze({ documentType: "ActiveEffect", collection: "effects" })]),
  JournalEntry: Object.freeze([
    Object.freeze({ documentType: "JournalEntryPage", collection: "pages" }),
    Object.freeze({ documentType: "JournalEntryCategory", collection: "categories" })
  ]),
  Scene: Object.freeze([
    Object.freeze({ documentType: "Token", collection: "tokens" }),
    Object.freeze({ documentType: "Region", collection: "regions" })
  ]),
  Region: Object.freeze([Object.freeze({ documentType: "RegionBehavior", collection: "behaviors" })]),
  Playlist: Object.freeze([Object.freeze({ documentType: "PlaylistSound", collection: "sounds" })]),
  RollTable: Object.freeze([Object.freeze({ documentType: "TableResult", collection: "results" })]),
  Cards: Object.freeze([Object.freeze({ documentType: "Card", collection: "cards" })])
});

export const SEARCH_TYPE_TEXT_FIELDS = Object.freeze({
  Actor: Object.freeze(["system"]),
  Item: Object.freeze(["system"]),
  ActiveEffect: Object.freeze(["description"]),
  JournalEntry: Object.freeze([]),
  JournalEntryPage: Object.freeze(["text"]),
  JournalEntryCategory: Object.freeze([]),
  Scene: Object.freeze([]),
  Token: Object.freeze([]),
  Region: Object.freeze([]),
  RegionBehavior: Object.freeze([]),
  Macro: Object.freeze([]),
  Playlist: Object.freeze(["description"]),
  PlaylistSound: Object.freeze(["description"]),
  RollTable: Object.freeze(["description"]),
  TableResult: Object.freeze(["description"]),
  Cards: Object.freeze(["description"]),
  Card: Object.freeze(["description"]),
  Folder: Object.freeze([])
});

/**
 * @param {string} documentType
 * @returns {string[]}
 */
export function searchUpdateKeysFor(documentType) {
  return [
    "name",
    ...(SEARCH_TYPE_TEXT_FIELDS[documentType] ?? []),
    ...(SEARCH_EMBEDDED_CHILDREN[documentType] ?? []).map((child) => child.collection)
  ];
}

export const SEARCH_INDEX_FIELDS = Object.freeze(["name", "text", "systemText"]);

export function createSearchEngine() {
  return new MiniSearch({
    idField: "refKey",
    fields: [...SEARCH_INDEX_FIELDS],

    storeFields: ["documentType"],
    tokenize: (text) => String(text ?? "").split(/[\n\r\p{Z}\p{P}]+/u),
    processTerm: (term) => {
      const normalized = String(term ?? "")
        .normalize("NFC")
        .toLowerCase()
        .replace(/ё/g, "е");
      if (!normalized) {
        return null;
      }

      return normalized.length > 64 ? clipWithoutSplittingPair(normalized, 64) : normalized;
    },
    autoVacuum: true
  });
}

const SEARCH_FUZZY_MIN_CODE_POINTS = 4;
const SEARCH_FUZZY_RATE = 0.2;
const SEARCH_FUZZY_MAX_DISTANCE = 6;

/**
 * @param {string} term
 * @returns {number|false}
 */
function searchFuzzyDistance(term) {
  const codePoints = [...String(term ?? "")].length;
  if (codePoints <= SEARCH_FUZZY_MIN_CODE_POINTS) {
    return false;
  }
  return Math.min(SEARCH_FUZZY_MAX_DISTANCE, Math.round(codePoints * SEARCH_FUZZY_RATE));
}

/** @param {{ mode: string, types?: string[] | null }} options */
export function buildSearchQueryOptions({ mode, types }) {
  const fields = mode === "name" ? ["name"] : [...SEARCH_INDEX_FIELDS];
  const filterTypes = Array.isArray(types) && types.length > 0 ? new Set(types) : null;
  return {
    fields,
    combineWith: "AND",
    prefix: true,

    fuzzy: searchFuzzyDistance,
    weights: { fuzzy: 0.45, prefix: 0.375 },
    boost: { name: 3, text: 1, systemText: 0.5 },
    bm25: { k: 1.2, b: 0.7, d: 0.5 },
    ...(filterTypes ? { filter: (result) => filterTypes.has(result.documentType) } : {})
  };
}

export function compareSearchHits(left, right) {
  if (left.score !== right.score) {
    return left.score > right.score ? -1 : 1;
  }
  if (left.documentType !== right.documentType) {
    return left.documentType < right.documentType ? -1 : 1;
  }
  return left.refKey < right.refKey ? -1 : left.refKey > right.refKey ? 1 : 0;
}

/**
 * @param {string} member
 * @returns {string}
 */
export function corpusStatus(member) {
  if (!SEARCH_CORPUS_STATUSES.includes(member)) {
    throw new Error(`corpusStatus: unknown search corpus status ${JSON.stringify(member)}`);
  }
  return member;
}

/**
 * @param {string} member
 * @returns {string}
 */
export function resultSource(member) {
  if (!SEARCH_RESULT_SOURCES.includes(member)) {
    throw new Error(`resultSource: unknown search result source ${JSON.stringify(member)}`);
  }
  return member;
}

export const SEARCH_DEFAULT_CAPS = Object.freeze({
  world: Object.freeze({
    maxBytes: SEARCH_WORLD_INDEX_MAX_BYTES,
    maxEntries: SEARCH_WORLD_INDEX_MAX_ENTRIES
  }),
  compendium: Object.freeze({
    maxBytes: SEARCH_COMPENDIUM_INDEX_MAX_BYTES,
    maxEntries: SEARCH_COMPENDIUM_INDEX_MAX_ENTRIES
  }),
  maxMatches: SEARCH_MAX_MATCHES,
  maxResponseBytes: SEARCH_RESPONSE_MAX_BYTES
});

/** @param {{ caps?: typeof SEARCH_DEFAULT_CAPS }} [options] */
export function createSearchState({ caps = SEARCH_DEFAULT_CAPS } = {}) {
  return {
    world: createCorpus("world", caps.world ?? SEARCH_DEFAULT_CAPS.world),
    compendium: createCorpus("compendium", caps.compendium ?? SEARCH_DEFAULT_CAPS.compendium),

    maxMatches: caps.maxMatches ?? SEARCH_DEFAULT_CAPS.maxMatches,
    maxResponseBytes: caps.maxResponseBytes ?? SEARCH_DEFAULT_CAPS.maxResponseBytes
  };
}

function createCorpus(kind, caps) {
  return {
    kind,
    caps,
    /** @type {any} */ index: null,
    /** @type {string | null} */ status: null,
    /** @type {{limit: string, basis: string, cap: number, observed: number} | null} */ overflow: null,
    stats: {
      entryCount: 0,
      indexedChars: 0,
      textTruncatedCount: 0,
      skippedPackCount: 0,
      failedPackCount: 0
    },

    builtGeneration: -1,
    dirtyGeneration: 0,

    /** @type {string | null} */ packSignature: null,

    /** @type {Map<string, WeakRef<object>> | null} */ packIdentities: null,
    /** @type {Promise<void> | null} */ building: null
  };
}

/** @param {{ dirtyGeneration: number }} corpus */
export function markCorpusDirty(corpus) {
  corpus.dirtyGeneration += 1;
}

/**
 * @param {ReturnType<typeof createSearchState>} state
 * @param {{ hooks?: any }} [options]
 * @returns {number}
 */
export function registerSearchInvalidation(state, { hooks } = {}) {
  const api = hooks ?? /** @type {any} */ (globalThis).Hooks;

  if (!api || typeof api.on !== "function") {
    return 0;
  }

  let registered = 0;
  for (const documentType of SEARCH_INDEXED_TYPES) {
    const updateKeys = searchUpdateKeysFor(documentType);
    api.on(`create${documentType}`, (doc) => markCorpusDirty(corpusForDocument(state, doc)));
    api.on(`delete${documentType}`, (doc) => markCorpusDirty(corpusForDocument(state, doc)));
    api.on(`update${documentType}`, (doc, change) => {
      if (diffTouchesKeys(change, updateKeys)) {
        markCorpusDirty(corpusForDocument(state, doc));
      }
    });
    registered += 3;
  }

  api.on("updateCompendium", () => markCorpusDirty(state.compendium));
  registered += 1;
  return registered;
}

/**
 * @param {any} pack
 * @returns {string | null}
 */
function packIdOf(pack) {
  const packId = typeof pack?.collection === "string" ? pack.collection : pack?.metadata?.id;
  return typeof packId === "string" && packId ? packId : null;
}

/**
 * @param {any} game
 * @returns {string}
 */
export function packSetSignature(game) {
  return packSetSignatureFor(collectionDocuments(game?.packs));
}

/**
 * @param {any[]} packs
 * @returns {string}
 */
function packSetSignatureFor(packs) {
  const ids = packs.map((pack) => packIdOf(pack) ?? "?");
  ids.sort();
  return `${ids.length}:${ids.join(",")}`;
}

/**
 * @param {{packIdentities: Map<string, WeakRef<object>> | null}} corpus
 * @param {any[]} packs
 * @returns {boolean}
 */
function refreshPackIdentities(corpus, packs) {
  const previous = corpus.packIdentities;
  /** @type {Map<string, WeakRef<object>>} */
  const next = new Map();
  let replaced = false;
  for (const pack of packs) {
    const packId = packIdOf(pack);
    if (!packId || typeof pack !== "object" || pack === null) {
      continue;
    }
    next.set(packId, new WeakRef(pack));
    const prior = previous?.get(packId);
    if (prior && prior.deref() !== pack) {
      replaced = true;
    }
  }
  corpus.packIdentities = next;
  return replaced;
}

/**
 * @param {{packSignature: string | null, packIdentities: Map<string, WeakRef<object>> | null, dirtyGeneration: number}} corpus
 * @param {any} game
 * @returns {boolean}
 */
export function invalidateOnPackSetChange(corpus, game) {
  const packs = collectionDocuments(game?.packs);
  const signature = packSetSignatureFor(packs);

  const replaced = refreshPackIdentities(corpus, packs);

  const changed = corpus.packSignature !== null && (corpus.packSignature !== signature || replaced);
  corpus.packSignature = signature;
  if (changed) {
    markCorpusDirty(corpus);
  }
  return changed;
}

function corpusForDocument(state, doc) {
  return /** @type {any} */ (doc)?.pack ? state.compendium : state.world;
}

/**
 * @param {unknown} change
 * @param {string[]} keys
 */
function diffTouchesKeys(change, keys) {
  if (change === null || typeof change !== "object" || Array.isArray(change)) {
    return true;
  }
  return keys.some((key) => Object.hasOwn(/** @type {object} */ (change), key));
}

/**
 * @param {any} corpus
 * @param {() => Promise<{index: any, stats: any} | {overflow: any, stats: any}>} build
 * @returns {Promise<{builtThisCall: boolean}>}
 */
export async function ensureCorpus(corpus, build) {
  if (corpus.building) {
    await corpus.building;

    return { builtThisCall: true };
  }

  const clean = corpus.builtGeneration === corpus.dirtyGeneration;
  if (clean && (corpus.index || corpus.status === "overflow")) {
    return { builtThisCall: false };
  }

  const generation = corpus.dirtyGeneration;
  const promise = (async () => {
    const outcome = await build();
    if (/** @type {any} */ (outcome).overflow) {
      corpus.index = null;
      corpus.status = corpusStatus("overflow");
      corpus.overflow = /** @type {any} */ (outcome).overflow;
    } else {
      corpus.index = /** @type {any} */ (outcome).index;
      corpus.status = corpusStatus("ready");
      corpus.overflow = null;
    }
    corpus.stats = outcome.stats;
    corpus.builtGeneration = generation;
  })();
  corpus.building = promise;
  try {
    await promise;
  } finally {
    corpus.building = null;
  }
  return { builtThisCall: true };
}

/**
 * @param {any} index
 * @returns {number}
 */
export function measureSearchIndexBytes(index) {
  return utf8ByteLength(JSON.stringify(index.toJSON()));
}

/** @param {{maxBytes: number, maxEntries: number}} caps */
function createEntryCollector(caps) {
  const entries = [];
  let indexedChars = 0;
  let textTruncatedCount = 0;
  /** @type {{limit: string, basis: string, cap: number, observed: number} | null} */
  let overflow = null;

  return {
    get overflowed() {
      return overflow !== null;
    },
    /** @param {{refKey: string, documentType: string, name: string, text: string, systemText: string, truncated?: boolean}} entry */
    add(entry) {
      if (overflow) {
        return false;
      }
      const nextEntries = entries.length + 1;
      const nextChars = indexedChars + entry.name.length + entry.text.length + entry.systemText.length;
      if (nextEntries > caps.maxEntries) {
        overflow = {
          limit: "entry-count",
          basis: "counted",
          cap: caps.maxEntries,
          observed: nextEntries
        };
        return false;
      }
      const estimated = estimateSearchIndexBytes(nextEntries, nextChars);
      if (estimated > caps.maxBytes) {
        overflow = {
          limit: "index-bytes",
          basis: "estimated",
          cap: caps.maxBytes,
          observed: Math.round(estimated)
        };
        return false;
      }
      entries.push(entry);
      indexedChars = nextChars;
      if (entry.truncated) {
        textTruncatedCount += 1;
      }
      return true;
    },

    noteTruncatedWithoutEntry() {
      if (overflow) {
        return;
      }
      textTruncatedCount += 1;
    },
    result(extraStats = {}) {
      const stats = {
        entryCount: entries.length,
        indexedChars,
        textTruncatedCount,
        skippedPackCount: 0,
        failedPackCount: 0,
        ...extraStats
      };
      if (overflow) {
        return { overflow, stats };
      }
      const index = createSearchEngine();
      index.addAll(entries);

      const measured = measureSearchIndexBytes(index);
      if (measured > caps.maxBytes) {
        overflow = {
          limit: "index-bytes",
          basis: "measured",
          cap: caps.maxBytes,
          observed: measured
        };
        return { overflow, stats };
      }
      return { index, stats };
    }
  };
}

/**
 * @param {unknown} collection
 * @returns {any[]}
 */
function collectionDocuments(collection) {
  if (!collection) {
    return [];
  }
  if (Array.isArray(collection)) {
    return collection;
  }
  const contents = /** @type {any} */ (collection).contents;
  if (Array.isArray(contents)) {
    return contents;
  }
  if (typeof (/** @type {any} */ (collection)[Symbol.iterator]) === "function") {
    return Array.from(/** @type {any} */ (collection));
  }
  return [];
}

/** @param {any} doc */
function documentId(doc) {
  const source = doc?._source;
  if (source && typeof source === "object" && typeof source._id === "string" && source._id) {
    return source._id;
  }
  return typeof doc?.id === "string" && doc.id ? doc.id : null;
}

/** @param {{documentType: string, id: string}[]} chain */
export function buildWorldRefKey(chain) {
  return `world:${chain.map((link) => `${link.documentType}.${link.id}`).join(".")}`;
}

/**
 * @param {string} packId
 * @param {string} entryId
 */
export function buildPackRefKey(packId, entryId) {
  return `pack:${packId}:${entryId}`;
}

/** @param {{name: string, text: string, systemText: string}} entry */
function isIndexableEntry(entry) {
  return entry.name.trim() !== "" || entry.text !== "" || entry.systemText !== "";
}

/**
 * @param {any} game
 * @param {{maxBytes: number, maxEntries: number}} caps
 */
export function buildWorldCorpus(game, caps) {
  const collector = createEntryCollector(caps);
  for (const [documentType, collectionName] of Object.entries(SEARCH_WORLD_COLLECTIONS)) {
    for (const doc of collectionDocuments(game?.[collectionName])) {
      addDocumentTree(collector, doc, documentType, []);
      if (collector.overflowed) {
        return collector.result();
      }
    }
  }
  return collector.result();
}

/**
 * @param {ReturnType<typeof createEntryCollector>} collector
 * @param {any} doc
 * @param {string} documentType
 * @param {{documentType: string, id: string}[]} ancestors
 */
function addDocumentTree(collector, doc, documentType, ancestors) {
  const id = documentId(doc);
  if (!id) {
    return;
  }
  const chain = [...ancestors, { documentType, id }];

  const extracted = extractDocumentText(doc, SEARCH_TYPE_TEXT_FIELDS[documentType] ?? []);
  const entry = {
    refKey: buildWorldRefKey(chain),
    documentType,

    name: String(storedDocumentName(doc) ?? ""),
    text: extracted.text,
    systemText: extracted.systemText,

    truncated: extracted.truncated
  };
  if (isIndexableEntry(entry)) {
    if (!collector.add(entry)) {
      return;
    }
  } else if (entry.truncated) {
    collector.noteTruncatedWithoutEntry();
  }

  for (const child of SEARCH_EMBEDDED_CHILDREN[documentType] ?? []) {
    for (const childDoc of collectionDocuments(doc?.[child.collection])) {
      addDocumentTree(collector, childDoc, child.documentType, chain);
      if (collector.overflowed) {
        return;
      }
    }
  }
}

/**
 * @param {any} game
 * @param {{maxBytes: number, maxEntries: number}} caps
 */
export async function buildCompendiumCorpus(game, caps) {
  const collector = createEntryCollector(caps);
  const indexedTypes = new Set(SEARCH_INDEXED_TYPES);
  let skippedPackCount = 0;
  let failedPackCount = 0;
  for (const pack of collectionDocuments(game?.packs)) {
    const documentType = pack?.documentName;
    if (typeof documentType !== "string" || !indexedTypes.has(documentType)) {
      skippedPackCount += 1;
      continue;
    }
    const packId = packIdOf(pack);
    if (!packId) {
      skippedPackCount += 1;
      continue;
    }

    let index;
    try {
      index = typeof pack.getIndex === "function" ? await pack.getIndex() : pack.index;
    } catch {
      failedPackCount += 1;
      continue;
    }
    for (const row of collectionDocuments(index)) {
      const entryId = typeof row?._id === "string" ? row._id : row?.id;
      if (typeof entryId !== "string" || !entryId) {
        continue;
      }
      const entry = {
        refKey: buildPackRefKey(packId, entryId),
        documentType,

        name: String(row?.name ?? ""),
        text: "",
        systemText: ""
      };
      if (isIndexableEntry(entry) && !collector.add(entry)) {
        return collector.result({ skippedPackCount, failedPackCount });
      }
    }
  }
  return collector.result({ skippedPackCount, failedPackCount });
}

/**
 * @param {any} game
 * @param {string} refKey
 * @returns {{document: any, documentType: string, id: string, parents: {documentType: string, id: string, name: string | null}[]} | null}
 */
export function resolveWorldRef(game, refKey) {
  if (typeof refKey !== "string" || !refKey.startsWith("world:")) {
    return null;
  }
  const segments = refKey.slice("world:".length).split(".");
  if (segments.length < 2 || segments.length % 2 !== 0) {
    return null;
  }

  /** @type {{document: any, documentType: string, id: string}[]} */
  const chain = [];
  for (let i = 0; i < segments.length; i += 2) {
    const documentType = segments[i];
    const id = segments[i + 1];
    if (!documentType || !id) {
      return null;
    }
    let doc = null;
    if (i === 0) {
      const collectionName = SEARCH_WORLD_COLLECTIONS[documentType];
      if (!collectionName) {
        return null;
      }
      doc = game?.[collectionName]?.get?.(id) ?? null;
    } else {
      const parent = chain[chain.length - 1];
      const child = (SEARCH_EMBEDDED_CHILDREN[parent.documentType] ?? []).find(
        (candidate) => candidate.documentType === documentType
      );
      if (!child) {
        return null;
      }
      doc = parent.document?.[child.collection]?.get?.(id) ?? null;
    }
    if (!doc) {
      return null;
    }
    chain.push({ document: doc, documentType, id });
  }

  const leaf = chain[chain.length - 1];
  return {
    document: leaf.document,
    documentType: leaf.documentType,
    id: leaf.id,

    parents: chain.slice(0, -1).map((link) => ({
      documentType: link.documentType,
      id: link.id,
      name: storedDocumentName(link.document) ?? null
    }))
  };
}

/**
 * @param {string} refKey
 * @returns {{packId: string, entryId: string} | null}
 */
export function parsePackRefKey(refKey) {
  if (typeof refKey !== "string" || !refKey.startsWith("pack:")) {
    return null;
  }
  const rest = refKey.slice("pack:".length);
  const separator = rest.indexOf(":");
  if (separator <= 0 || separator === rest.length - 1) {
    return null;
  }
  return { packId: rest.slice(0, separator), entryId: rest.slice(separator + 1) };
}

/**
 * @param {any} game
 * @param {string} refKey
 */
export function resolvePackRef(game, refKey) {
  const parsed = parsePackRefKey(refKey);
  if (!parsed) {
    return null;
  }
  const pack = game?.packs?.get?.(parsed.packId) ?? null;
  const row = pack?.index?.get?.(parsed.entryId) ?? null;
  return {
    packId: parsed.packId,
    entryId: parsed.entryId,
    label: typeof pack?.metadata?.label === "string" ? pack.metadata.label : (pack?.title ?? null),
    row
  };
}
