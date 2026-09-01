export { paginate, filterByName, filterByPath } from "./pagination.js";

export function cloneValue(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function safeDerived(modelOrDoc) {
  try {
    if (modelOrDoc == null) return null;
    if (typeof modelOrDoc.toObject === "function") return cloneValue(modelOrDoc.toObject(false));
    return cloneValue(modelOrDoc);
  } catch {
    return null;
  }
}

function buildPreparedActor(actor) {
  return {
    system: safeDerived(actor.system),
    prototypeToken: safeDerived(actor.prototypeToken),
    detectionModes: safeDerived(actor.detectionModes)
  };
}

function buildPreparedToken(token) {
  const d = safeDerived(token) ?? {};
  return {
    detectionModes: d.detectionModes ?? null,
    sight: d.sight ?? null,
    light: d.light ?? null,
    system: safeDerived(token.actor?.system)
  };
}

function documentData(document) {
  if (typeof document?.toObject === "function") {
    return document.toObject();
  }

  return document ?? {};
}

function identityFields(document, data) {
  const id = document?.id ?? data?._id ?? null;
  return { id, _id: id };
}

function compendiumSourceField(data) {
  return data?._stats?.compendiumSource ?? null;
}

function serializeOwnership(document, data) {
  const ownership = data?.ownership ?? document?.ownership ?? null;
  return ownership && typeof ownership === "object" ? cloneValue(ownership) : {};
}

function normalizeSceneBackground(scene, data) {
  const source = data.background ?? scene.background ?? null;
  if (!source) {
    return null;
  }

  return {
    src: source.src ?? null,
    offsetX: source.offsetX ?? 0,
    offsetY: source.offsetY ?? 0,
    scaleX: source.scaleX ?? 1,
    scaleY: source.scaleY ?? 1,
    rotation: source.rotation ?? 0,

    tint: source.tint ?? null
  };
}

/**
 * @param {any} page
 * @param {{ ownership?: boolean }} [options]
 */
export function serializeJournalPage(page, { ownership = false } = {}) {
  const data = documentData(page);
  return {
    ...identityFields(page, data),
    name: page.name ?? data.name ?? null,
    type: page.type ?? data.type ?? null,
    sort: page.sort ?? data.sort ?? 0,
    title: data.title ? cloneValue(data.title) : null,
    text: data.text ? cloneValue(data.text) : null,
    image: data.image ? cloneValue(data.image) : null,
    video: data.video ? cloneValue(data.video) : null,
    src: page.src ?? data.src ?? null,
    category: page.category ?? data.category ?? null,
    system: cloneValue(data.system ?? {}),
    flags: cloneValue(data.flags ?? {}),
    ...(ownership ? { ownership: serializeOwnership(page, data) } : {})
  };
}

/** @param {any} category */
export function storedJournalCategoryName(category) {
  return storedDocumentName(category);
}

/**
 * @param {any} document
 * @returns {string}
 */
export function storedDocumentName(document) {
  const source = document?._source;
  if (source && typeof source === "object" && Object.hasOwn(source, "name")) {
    return source.name ?? "";
  }
  if (typeof document?.toObject === "function") {
    return document.toObject()?.name ?? "";
  }
  return document?.name ?? "";
}

function serializeJournalCategorySubSummary(category) {
  const data = documentData(category);
  const summary = {
    id: category.id ?? data._id ?? null,

    name: storedJournalCategoryName(category)
  };
  const sort = data.sort ?? category.sort;
  if (sort !== undefined && sort !== null) {
    summary.sort = sort;
  }
  return summary;
}

function journalCategorySortKey(category) {
  const data = documentData(category);
  const sort = data?.sort ?? category?.sort;
  return Number.isFinite(sort) ? sort : Number.POSITIVE_INFINITY;
}

/**
 * @template T
 * @param {Iterable<T>} categories
 * @returns {T[]}
 */
export function sortJournalCategories(categories) {
  return Array.from(categories, (category, index) => ({
    category,
    index,
    sort: journalCategorySortKey(category)
  }))
    .sort((a, b) => a.sort - b.sort || a.index - b.index)
    .map((entry) => entry.category);
}

/** @param {any} category */
export function serializeJournalCategorySummary(category) {
  const data = documentData(category);
  return {
    ...identityFields(category, data),
    name: storedJournalCategoryName(category),
    sort: data.sort ?? category?.sort ?? 0
  };
}

/** @param {any} category */
export function serializeJournalCategory(category) {
  const data = documentData(category);
  return {
    ...identityFields(category, data),
    name: storedJournalCategoryName(category),
    sort: data.sort ?? category?.sort ?? 0,
    flags: cloneValue(data.flags ?? {})
  };
}

/**
 * @param {any} document
 * @param {Record<string, any>} [data]
 */
export function worldDocumentName(document, data) {
  if (!document) return null;
  return document.name ?? (data ?? documentData(document))?.name ?? null;
}

/**
 * @param {any} journal
 * @param {{ ownership?: boolean }} [options]
 */
export function serializeJournal(journal, { ownership = false } = {}) {
  const data = documentData(journal);
  const pages = journal.pages ? Array.from(journal.pages) : Array.isArray(data.pages) ? data.pages : [];
  const categories = journal.categories
    ? Array.from(journal.categories)
    : Array.isArray(data.categories)
      ? data.categories
      : [];
  return {
    ...identityFields(journal, data),
    name: worldDocumentName(journal, data),
    folder: journal.folder?.id ?? journal.folder ?? data.folder ?? null,
    sort: journal.sort ?? data.sort ?? 0,
    pages: pages.map((page) => serializeJournalPage(page, { ownership })),

    categories: sortJournalCategories(categories).map((category) =>
      serializeJournalCategorySubSummary(category)
    ),

    flags: cloneValue(data.flags ?? {}),

    compendiumSource: compendiumSourceField(data),
    ...(ownership ? { ownership: serializeOwnership(journal, data) } : {})
  };
}

export function serializeJournalSummary(journal) {
  const data = documentData(journal);
  const pages = journal.pages ? Array.from(journal.pages) : Array.isArray(data.pages) ? data.pages : [];
  const categories = journal.categories
    ? Array.from(journal.categories)
    : Array.isArray(data.categories)
      ? data.categories
      : [];
  return {
    ...identityFields(journal, data),
    name: worldDocumentName(journal, data),
    folder: journal.folder?.id ?? journal.folder ?? data.folder ?? null,
    sort: journal.sort ?? data.sort ?? 0,
    pageCount: pages.length,
    categoryCount: categories.length
  };
}

/**
 * @param {any} macro
 * @param {{ ownership?: boolean }} [options]
 */
export function serializeMacro(macro, { ownership = false } = {}) {
  const data = documentData(macro);
  return {
    ...identityFields(macro, data),
    name: macro.name ?? data.name ?? null,
    type: macro.type ?? data.type ?? null,
    command: data.command ?? macro.command ?? null,
    img: macro.img ?? data.img ?? null,
    folder: macro.folder?.id ?? macro.folder ?? data.folder ?? null,
    scope: macro.scope ?? data.scope ?? null,
    flags: cloneValue(data.flags ?? {}),

    compendiumSource: compendiumSourceField(data),
    ...(ownership ? { ownership: serializeOwnership(macro, data) } : {})
  };
}

export function serializeMacroSummary(macro) {
  const data = typeof macro?.toObject === "function" ? macro : (macro ?? {});
  return {
    ...identityFields(macro, data),
    name: macro.name ?? data.name ?? null,
    type: macro.type ?? data.type ?? null,
    img: macro.img ?? data.img ?? null,
    folder: macro.folder?.id ?? macro.folder ?? data.folder ?? null,
    scope: macro.scope ?? data.scope ?? null
  };
}

export function serializePlaylistSound(sound) {
  const data = documentData(sound);
  return {
    ...identityFields(sound, data),
    name: sound.name ?? data.name ?? null,
    description: data.description ?? sound.description ?? null,
    path: data.path ?? sound.path ?? null,
    channel: sound.channel ?? data.channel ?? null,
    playing: data.playing ?? sound.playing ?? false,
    pausedTime: data.pausedTime ?? sound.pausedTime ?? null,
    repeat: data.repeat ?? sound.repeat ?? false,
    volume: data.volume ?? sound.volume ?? null, // linear 0–1 pass-through
    fade: data.fade ?? sound.fade ?? null,
    sort: sound.sort ?? data.sort ?? 0,

    duration: playlistSoundDuration(sound),
    flags: cloneValue(data.flags ?? {})
  };
}

function playlistSoundDuration(sound) {
  return sound?.sound?.duration ?? null;
}

/**
 * @param {any} sound
 * @param {any} [playlist]
 */
export function serializePlaylistSoundSummary(sound, playlist = null) {
  const data = documentData(sound);
  const parent = playlist ?? sound?.parent ?? null;
  return {
    ...identityFields(sound, data),
    name: sound.name ?? data.name ?? null,
    path: data.path ?? sound.path ?? null,
    playing: data.playing ?? sound.playing ?? false,
    duration: playlistSoundDuration(sound),
    playlistId: parent?.id ?? null,
    playlistName: parent?.name ?? null
  };
}

/**
 * @param {any} playlist
 * @param {{ ownership?: boolean }} [options]
 */
export function serializePlaylist(playlist, { ownership = false } = {}) {
  const data = documentData(playlist);
  const sounds = playlist.sounds
    ? Array.from(playlist.sounds)
    : Array.isArray(data.sounds)
      ? data.sounds
      : [];
  return {
    ...identityFields(playlist, data),
    name: playlist.name ?? data.name ?? null,
    description: data.description ?? playlist.description ?? null,
    mode: data.mode ?? playlist.mode ?? null,
    playing: data.playing ?? playlist.playing ?? false,
    fade: data.fade ?? playlist.fade ?? null,
    channel: playlist.channel ?? data.channel ?? null,
    sorting: playlist.sorting ?? data.sorting ?? null,
    seed: data.seed ?? playlist.seed ?? null,
    folder: playlist.folder?.id ?? playlist.folder ?? data.folder ?? null,
    sort: playlist.sort ?? data.sort ?? 0,
    flags: cloneValue(data.flags ?? {}),

    compendiumSource: compendiumSourceField(data),

    sounds: sounds.map((s) => serializePlaylistSound(s)),
    ...(ownership ? { ownership: serializeOwnership(playlist, data) } : {})
  };
}

export function serializePlaylistSummary(playlist) {
  const data = documentData(playlist);
  const sounds = playlist.sounds
    ? Array.from(playlist.sounds)
    : Array.isArray(data.sounds)
      ? data.sounds
      : [];
  return {
    ...identityFields(playlist, data),
    name: playlist.name ?? data.name ?? null,
    mode: data.mode ?? playlist.mode ?? null,
    playing: data.playing ?? playlist.playing ?? false,
    soundCount: sounds.length
  };
}

const DERIVED_RESULT_FIELDS = Object.freeze(["name", "img", "documentUuid"]);

/**
 * @param {any} data
 * @param {any} result
 * @param {string} key
 */
function storedResultField(data, result, key) {
  if (data && Object.hasOwn(data, key)) {
    return data[key] ?? null;
  }
  return result?.[key] ?? null;
}

/**
 * @param {any} result
 * @returns {boolean}
 */
function storedTableResultDrawn(result) {
  const source = result?._source;
  if (source && typeof source === "object" && Object.hasOwn(source, "drawn")) {
    return Boolean(source.drawn);
  }
  if (typeof result?.toObject === "function") {
    return Boolean(result.toObject()?.drawn);
  }
  return Boolean(result?.drawn);
}

/**
 * @param {any} result
 * @returns {string | null}
 */
export function storedTableResultName(result) {
  const source = result?._source;
  if (source && typeof source === "object" && Object.hasOwn(source, "name")) {
    return source.name ?? null;
  }
  return storedResultField(documentData(result), result, "name");
}

export function serializeTableResult(result) {
  const data = documentData(result);
  return {
    ...identityFields(result, data),
    type: data.type ?? result.type ?? null,
    name: storedResultField(data, result, "name"),
    img: storedResultField(data, result, "img"),
    description: data.description ?? result.description ?? null,
    documentUuid: storedResultField(data, result, "documentUuid"),
    weight: data.weight ?? result.weight ?? null,
    range: cloneValue(data.range ?? result.range ?? []),
    drawn: data.drawn ?? result.drawn ?? false,
    flags: cloneValue(data.flags ?? {})
  };
}

/**
 * @param {any} table
 * @param {{ ownership?: boolean }} [options]
 */
export function serializeTable(table, { ownership = false } = {}) {
  const data = documentData(table);
  const results = table.results ? Array.from(table.results) : Array.isArray(data.results) ? data.results : [];
  return {
    ...identityFields(table, data),
    name: table.name ?? data.name ?? null,
    img: data.img ?? table.img ?? null,
    description: data.description ?? table.description ?? null,
    formula: data.formula ?? table.formula ?? null, // SOURCE-first scalar: see the v14 note above
    replacement: data.replacement ?? table.replacement ?? false,
    displayRoll: data.displayRoll ?? table.displayRoll ?? false,
    folder: table.folder?.id ?? table.folder ?? data.folder ?? null,
    sort: table.sort ?? data.sort ?? 0,
    flags: cloneValue(data.flags ?? {}),

    compendiumSource: compendiumSourceField(data),
    results: results.map((result) => serializeTableResult(result)),
    ...(ownership ? { ownership: serializeOwnership(table, data) } : {})
  };
}

export function serializeTableSummary(table) {
  const data = documentData(table);
  const results = table.results ? Array.from(table.results) : Array.isArray(data.results) ? data.results : [];
  return {
    ...identityFields(table, data),
    name: table.name ?? data.name ?? null,
    img: data.img ?? table.img ?? null,
    formula: data.formula ?? table.formula ?? null, // SOURCE-first (v14 derived-formula note)
    replacement: data.replacement ?? table.replacement ?? false,
    folder: table.folder?.id ?? table.folder ?? data.folder ?? null,
    resultCount: results.length,
    drawnCount: results.filter((result) => storedTableResultDrawn(result)).length
  };
}

/**
 * @param {any} result
 * @param {any} [table]
 */
export function serializeTableResultSummary(result, table = null) {
  const data = documentData(result);
  const parent = table ?? result?.parent ?? null;
  return {
    ...identityFields(result, data),
    type: data.type ?? result?.type ?? null,
    name: storedResultField(data, result, "name"),
    img: storedResultField(data, result, "img"),
    documentUuid: storedResultField(data, result, "documentUuid"),
    weight: data.weight ?? result?.weight ?? null,
    range: cloneValue(data.range ?? result?.range ?? []),
    drawn: data.drawn ?? result?.drawn ?? false,
    tableId: parent?.id ?? null,
    tableName: parent?.name ?? null
  };
}

const DERIVED_COMBATANT_FIELDS = Object.freeze(["name", "img", "initiative", "actorId", "group"]);

const COMBATANT_ABSENT_FIELD_VALUES = Object.freeze({ name: "" });

/**
 * @param {any} data
 * @param {any} combatant
 * @param {string} key
 */
function storedCombatantField(data, combatant, key) {
  const absent = Object.hasOwn(COMBATANT_ABSENT_FIELD_VALUES, key)
    ? COMBATANT_ABSENT_FIELD_VALUES[key]
    : null;

  const asId = (value) => (key === "group" ? (value?.id ?? value) : value) ?? absent;
  if (data && Object.hasOwn(data, key)) {
    return asId(data[key]);
  }
  return asId(combatant?.[key]);
}

/** @param {any} combatant */
export function serializeCombatantTurn(combatant) {
  const data = documentData(combatant);
  return {
    ...identityFields(combatant, data),
    name: storedCombatantField(data, combatant, "name"),
    img: storedCombatantField(data, combatant, "img"),
    initiative: storedCombatantField(data, combatant, "initiative"),
    hidden: data.hidden ?? combatant?.hidden ?? false,
    defeated: data.defeated ?? combatant?.defeated ?? false,
    group: storedCombatantField(data, combatant, "group"),
    actorId: storedCombatantField(data, combatant, "actorId"),
    tokenId: data.tokenId ?? combatant?.tokenId ?? null,
    sceneId: data.sceneId ?? combatant?.sceneId ?? null
  };
}

function combatTurnRows(combat, data) {
  const prepared = Array.isArray(combat?.turns) ? combat.turns : [];
  if (prepared.length > 0) return prepared;
  if (combat?.combatants) return Array.from(combat.combatants);
  return Array.isArray(data?.combatants) ? data.combatants : [];
}

/**
 * @param {any} combat
 * @returns {any[]}
 */
export function combatOrderedCombatants(combat) {
  return combatTurnRows(combat, documentData(combat));
}

function embeddedCount(collection, sourceArray) {
  if (typeof collection?.size === "number") return collection.size;
  if (collection) return Array.from(collection).length;
  return Array.isArray(sourceArray) ? sourceArray.length : 0;
}

/**
 * @param {any} combat
 * @param {{ turnOrderFrom?: any }} [options]
 */
export function serializeCombat(combat, { turnOrderFrom } = {}) {
  const data = documentData(combat);
  const turnOrderDocument = turnOrderFrom ?? combat;
  const round = data.round ?? combat?.round ?? 0;
  const turn = data.turn ?? combat?.turn ?? null;
  const turns = combatTurnRows(turnOrderDocument, data).map((combatant) => serializeCombatantTurn(combatant));
  return {
    ...identityFields(combat, data),
    name: data.name ?? combat?.name ?? null, // v14 only; null on v13 (no such field)
    type: data.type ?? combat?.type ?? null,
    system: cloneValue(data.system ?? {}),

    scene: data.scene ?? combat?.scene?.id ?? combat?.scene ?? null,
    active: data.active ?? combat?.active ?? false,
    round,
    turn,
    started: Number(round) > 0,
    sort: data.sort ?? combat?.sort ?? 0,
    flags: cloneValue(data.flags ?? {}),
    combatantCount: embeddedCount(combat?.combatants, data.combatants),
    groupCount: embeddedCount(combat?.groups, data.groups),

    currentCombatantId: turn === null || turn === undefined ? null : (turns[turn]?.id ?? null),
    turns
  };
}

/**
 * @param {any} combatant
 * @param {any} [parent]
 */
export function serializeCombatant(combatant, parent = null) {
  const data = documentData(combatant);
  const owner = parent ?? combatant?.parent ?? null;
  return {
    ...serializeCombatantTurn(combatant),
    combatId: owner?.id ?? null,
    type: data.type ?? combatant?.type ?? null,
    system: cloneValue(data.system ?? {}),

    roundJoined: data.roundJoined ?? combatant?.roundJoined ?? null,
    flags: cloneValue(data.flags ?? {})
  };
}

/**
 * @param {any} group
 * @param {any} [parent]
 * @param {{ ownership?: boolean, memberCombatantIds?: string[], derivedFrom?: any }} [options]
 */
export function serializeCombatantGroup(
  group,
  parent = null,
  { ownership = false, memberCombatantIds, derivedFrom } = {}
) {
  const data = documentData(group);
  const owner = parent ?? group?.parent ?? null;
  const derivedSource = derivedFrom ?? group;
  const derivedBoolean = (value) => (typeof value === "boolean" ? value : null);
  return {
    ...identityFields(group, data),
    combatId: owner?.id ?? null,
    name: data.name ?? group?.name ?? "",
    type: data.type ?? group?.type ?? null,
    system: cloneValue(data.system ?? {}),
    img: data.img ?? group?.img ?? null,
    initiative: data.initiative ?? group?.initiative ?? null,
    flags: cloneValue(data.flags ?? {}),
    hidden: derivedBoolean(derivedSource?.hidden),
    defeated: derivedBoolean(derivedSource?.defeated),
    memberCombatantIds: Array.isArray(memberCombatantIds) ? [...memberCombatantIds] : [],
    ...(ownership ? { ownership: serializeOwnership(group, data) } : {})
  };
}

/**
 * @param {any} group
 * @param {any} [parent]
 * @param {{ memberCombatantIds?: string[] }} [options]
 */
export function serializeCombatantGroupSummary(group, parent = null, { memberCombatantIds } = {}) {
  const data = documentData(group);
  const owner = parent ?? group?.parent ?? null;
  const members = Array.isArray(memberCombatantIds) ? memberCombatantIds : [];
  return {
    ...identityFields(group, data),
    combatId: owner?.id ?? null,
    name: data.name ?? group?.name ?? "",
    img: data.img ?? group?.img ?? null,
    initiative: data.initiative ?? group?.initiative ?? null,
    memberCount: members.length,
    hidden: typeof group?.hidden === "boolean" ? group.hidden : null,
    defeated: typeof group?.defeated === "boolean" ? group.defeated : null
  };
}

/** @param {any} combat */
export function serializeCombatSummary(combat) {
  const data = documentData(combat);
  const round = data.round ?? combat?.round ?? 0;
  return {
    ...identityFields(combat, data),
    name: data.name ?? combat?.name ?? null,
    scene: data.scene ?? combat?.scene?.id ?? combat?.scene ?? null,
    active: data.active ?? combat?.active ?? false,
    round,
    turn: data.turn ?? combat?.turn ?? null,
    started: Number(round) > 0,
    combatantCount: embeddedCount(combat?.combatants, data.combatants),
    groupCount: embeddedCount(combat?.groups, data.groups)
  };
}

const DERIVED_CARD_FIELDS = Object.freeze(["name", "back", "origin"]);

/**
 * @param {any} data
 * @param {any} card
 * @param {string} key
 */
function storedCardField(data, card, key) {
  const stored = data && Object.hasOwn(data, key) ? data[key] : card?.[key];

  if (key === "origin" && stored && typeof stored === "object") {
    return stored.id ?? stored._id ?? null;
  }
  return stored ?? null;
}

export function serializeCard(card) {
  const data = documentData(card);
  const back = storedCardField(data, card, "back");
  return {
    ...identityFields(card, data),
    name: storedCardField(data, card, "name"),
    description: data.description ?? card?.description ?? null,
    type: data.type ?? card?.type ?? null,
    suit: data.suit ?? card?.suit ?? null,
    value: data.value ?? card?.value ?? null,
    back: cloneValue(back ?? {}),
    faces: cloneValue(data.faces ?? card?.faces ?? []),
    face: data.face ?? card?.face ?? null,

    drawn: storedCardDrawn(card),
    origin: storedCardField(data, card, "origin"),
    width: data.width ?? card?.width ?? null,
    height: data.height ?? card?.height ?? null,
    rotation: data.rotation ?? card?.rotation ?? 0,
    sort: data.sort ?? card?.sort ?? 0,
    system: cloneValue(data.system ?? {}),
    flags: cloneValue(data.flags ?? {})
  };
}

/** @param {any} card */
export function storedCardName(card) {
  return storedDocumentName(card);
}

/**
 * @param {any} card
 * @param {any} [stack]
 */
export function serializeCardSummary(card, stack = null) {
  const data = documentData(card);
  const parent = stack ?? card?.parent ?? null;
  return {
    ...identityFields(card, data),
    cardsId: parent?.id ?? null,
    cardsName: parent?.name ?? null,
    name: storedCardName(card),
    type: data.type ?? card?.type ?? null,
    suit: data.suit ?? card?.suit ?? null,
    value: data.value ?? card?.value ?? null,
    face: data.face ?? card?.face ?? null,
    faceCount: (data.faces ?? card?.faces ?? []).length,
    drawn: storedCardDrawn(card),
    origin: storedCardField(data, card, "origin"),
    sort: data.sort ?? card?.sort ?? 0
  };
}

/**
 * @param {any} cards
 * @param {{ ownership?: boolean }} [options]
 */
export function serializeCards(cards, { ownership = false } = {}) {
  const data = documentData(cards);
  const rows = cards?.cards ? Array.from(cards.cards) : Array.isArray(data.cards) ? data.cards : [];
  return {
    ...identityFields(cards, data),
    name: cards?.name ?? data.name ?? null,
    type: data.type ?? cards?.type ?? null,
    description: data.description ?? cards?.description ?? null,
    img: data.img ?? cards?.img ?? null,
    width: data.width ?? cards?.width ?? null,
    height: data.height ?? cards?.height ?? null,
    rotation: data.rotation ?? cards?.rotation ?? 0,
    displayCount: data.displayCount ?? cards?.displayCount ?? false,
    folder: cards?.folder?.id ?? cards?.folder ?? data.folder ?? null,
    sort: cards?.sort ?? data.sort ?? 0,
    system: cloneValue(data.system ?? {}),
    flags: cloneValue(data.flags ?? {}),

    compendiumSource: compendiumSourceField(data),
    cards: rows.map((card) => serializeCard(card)),
    ...(ownership ? { ownership: serializeOwnership(cards, data) } : {})
  };
}

/** @param {any} cards */
export function normalizePreviewCards(cards) {
  if (!Array.isArray(cards?.cards)) {
    return cards;
  }
  return {
    ...cards,
    cards: cards.cards.map((card) => ({ ...card, id: null, _id: null, drawn: false }))
  };
}

export function serializeCardsSummary(cards) {
  const data = documentData(cards);
  const rows = cards?.cards ? Array.from(cards.cards) : Array.isArray(data.cards) ? data.cards : [];
  const type = data.type ?? cards?.type ?? null;
  const drawnCount = rows.filter((card) => storedCardDrawn(card)).length;
  return {
    ...identityFields(cards, data),
    name: cards?.name ?? data.name ?? null,
    type,
    img: data.img ?? cards?.img ?? null,
    folder: cards?.folder?.id ?? cards?.folder ?? data.folder ?? null,
    cardCount: rows.length,
    drawnCount,
    availableCount: type === "deck" ? rows.length - drawnCount : rows.length
  };
}

/** @param {any} card */
export function storedCardDrawn(card) {
  const source = card?._source;
  if (source && typeof source === "object" && Object.hasOwn(source, "drawn")) {
    return Boolean(source.drawn);
  }
  if (typeof card?.toObject === "function") {
    return Boolean(card.toObject()?.drawn);
  }
  return Boolean(card?.drawn);
}

function normalizeRolls(rolls) {
  if (!Array.isArray(rolls)) {
    return [];
  }
  return rolls.map((entry) => {
    if (typeof entry === "string") {
      try {
        return JSON.parse(entry);
      } catch {
        return entry;
      }
    }
    return cloneValue(entry);
  });
}

export function serializeChatMessage(message) {
  const data = documentData(message);
  return {
    ...identityFields(message, data),
    author: message.author?.id ?? message.author ?? data.author ?? null,
    content: data.content ?? message.content ?? null,
    speaker: cloneValue(data.speaker ?? message.speaker ?? {}),
    whisper: cloneValue(data.whisper ?? message.whisper ?? []),
    blind: data.blind ?? message.blind ?? false,
    style: data.style ?? message.style ?? null,
    flavor: data.flavor ?? message.flavor ?? null,
    sound: data.sound ?? message.sound ?? null,
    rolls: normalizeRolls(data.rolls ?? []),
    timestamp: data.timestamp ?? message.timestamp ?? null,
    flags: cloneValue(data.flags ?? {})
  };
}

export function serializeChatMessageSummary(message) {
  const data = documentData(message);
  const content = data.content ?? message.content ?? "";
  const whisper = data.whisper ?? message.whisper ?? [];
  const rolls = data.rolls ?? message.rolls ?? [];
  return {
    ...identityFields(message, data),
    author: message.author?.id ?? message.author ?? data.author ?? null,
    alias: (data.speaker ?? message.speaker ?? {})?.alias ?? null,
    contentPreview: typeof content === "string" ? content.slice(0, 100) : "",
    contentLength: typeof content === "string" ? content.length : 0,
    timestamp: data.timestamp ?? message.timestamp ?? null,
    whisperCount: Array.isArray(whisper) ? whisper.length : 0,
    rollCount: Array.isArray(rolls) ? rolls.length : 0
  };
}

/**
 * @param {any} scene
 * @param {{ counts?: boolean, ownership?: boolean, flags?: boolean, provenance?: boolean }} [options]
 */
export function serializeScene(
  scene,
  { counts = false, ownership = false, flags = false, provenance = false } = {}
) {
  const data = documentData(scene);
  return {
    ...identityFields(scene, data),
    name: scene.name ?? data.name ?? null,
    active: scene.active ?? data.active ?? false,
    navigation: scene.navigation ?? data.navigation ?? false,
    navOrder: scene.navOrder ?? data.navOrder ?? 0,
    width: scene.width ?? data.width ?? null,
    height: scene.height ?? data.height ?? null,

    grid: cloneValue(data.grid ?? scene.grid ?? null),
    background: normalizeSceneBackground(scene, data),

    backgroundColor: data.backgroundColor ?? scene.backgroundColor ?? null,
    tokenVision: scene.tokenVision ?? data.tokenVision ?? false,
    weather: scene.weather ?? data.weather ?? null,
    padding: scene.padding ?? data.padding ?? null,
    shiftX: scene.shiftX ?? data.shiftX ?? 0,
    shiftY: scene.shiftY ?? data.shiftY ?? 0,
    navName: scene.navName ?? data.navName ?? null,

    thumb: data.thumb ?? scene.thumb ?? null,
    foreground: scene.foreground ?? data.foreground ?? null,
    foregroundElevation: data.foregroundElevation ?? scene.foregroundElevation ?? null,
    sort: scene.sort ?? data.sort ?? 0,
    initialLevel: data.initialLevel ?? scene.initialLevel ?? null,

    playlist: scene.playlist?.id ?? data.playlist ?? null,
    playlistSound: scene.playlistSound?.id ?? data.playlistSound ?? null,
    journal: scene.journal?.id ?? data.journal ?? null,
    journalEntryPage: scene.journalEntryPage?.id ?? data.journalEntryPage ?? null,

    environment: cloneValue(data.environment ?? scene.environment ?? null),
    fog: cloneValue(data.fog ?? scene.fog ?? null),
    initial: cloneValue(data.initial ?? scene.initial ?? null),
    transition: cloneValue(data.transition ?? scene.transition ?? null),

    ...(flags ? { flags: cloneValue(data.flags ?? {}) } : {}),

    ...(provenance ? { compendiumSource: compendiumSourceField(data) } : {}),
    ...(counts ? { counts: sceneEmbeddedCounts(scene, data) } : {}),
    ...(ownership ? { ownership: serializeOwnership(scene, data) } : {})
  };
}

const SCENE_EMBEDDED_COLLECTION_NAMES = Object.freeze([
  "tokens",
  "tiles",
  "sounds",
  "walls",
  "notes",
  "drawings",
  "lights",
  "templates",
  "levels",
  "regions"
]);

function sceneEmbeddedCounts(scene, data) {
  const counts = {};
  for (const name of SCENE_EMBEDDED_COLLECTION_NAMES) {
    const source = data?.[name];
    if (Array.isArray(source)) {
      counts[name] = source.length;
    } else {
      const size = scene?.[name]?.size;
      counts[name] = typeof size === "number" ? size : 0;
    }
  }
  return counts;
}

/**
 * @param {any} item
 * @param {{ include?: string[], ownership?: boolean, nested?: boolean }} [options]
 */
export function serializeItem(item, { include, ownership = false, nested = false } = {}) {
  const data = documentData(item);

  const withFlags = nested ? Array.isArray(include) && include.includes("flags") : true;
  const withEffects = nested ? Array.isArray(include) && include.includes("effects") : true;
  const effects = itemEffects(item, data);
  return {
    ...identityFields(item, data),
    name: worldDocumentName(item, data),
    type: item.type ?? data.type ?? null,
    img: item.img ?? data.img ?? null,
    folder: item.folder?.id ?? item.folder ?? data.folder ?? null,
    sort: item.sort ?? data.sort ?? 0,

    system: cloneValue(data.system ?? item.system ?? {}),
    ...(withFlags ? { flags: cloneValue(data.flags ?? {}) } : {}),
    ...(withEffects ? { effects: effects.map(serializeActiveEffect) } : {}),

    ...(nested ? { effectCount: effects.length } : {}),

    ...(nested ? {} : { compendiumSource: compendiumSourceField(data) }),
    ...(ownership ? { ownership: serializeOwnership(item, data) } : {})
  };
}

/**
 * @param {any} item
 * @param {{ include?: string[] }} [options]
 */
export function serializeItemSummary(item, { include } = {}) {
  const data = documentData(item);
  const withFlags = Array.isArray(include) && include.includes("flags");
  const withEffects = Array.isArray(include) && include.includes("effects");
  const effects = itemEffects(item, data);
  return {
    ...identityFields(item, data),
    name: worldDocumentName(item, data),
    type: item.type ?? data.type ?? null,
    img: item.img ?? data.img ?? null,
    folder: item.folder?.id ?? item.folder ?? data.folder ?? null,
    sort: item.sort ?? data.sort ?? 0,
    effectCount: effects.length,
    ...(withFlags ? { flags: cloneValue(data.flags ?? {}) } : {}),
    ...(withEffects ? { effects: effects.map(serializeActiveEffect) } : {})
  };
}

/**
 * @param {any} effect
 * @param {Record<string, any>} [data]
 */
export function effectName(effect, data) {
  if (!effect) return null;
  return effect.name ?? (data ?? documentData(effect))?.name ?? null;
}

export function serializeActiveEffect(effect) {
  const data = documentData(effect);
  return {
    ...identityFields(effect, data),
    name: effectName(effect, data),
    type: data.type ?? effect.type ?? null,
    img: data.img ?? effect.img ?? null,
    origin: data.origin ?? effect.origin ?? null,
    disabled: data.disabled ?? effect.disabled ?? false,

    transfer: data.transfer ?? effect.transfer ?? false,

    duration: cloneValue(data.duration ?? null),
    changes: cloneValue(data.changes ?? []),
    statuses: cloneValue(data.statuses ?? []),
    tint: data.tint ?? effect.tint ?? null,
    description: data.description ?? effect.description ?? null,
    sort: data.sort ?? effect.sort ?? 0,
    system: cloneValue(data.system ?? {}),
    flags: cloneValue(data.flags ?? {})
  };
}

export function serializeCompendiumEffect(rawEffect) {
  const serialized = serializeActiveEffect(rawEffect);

  if (!Array.isArray(serialized.changes) || serialized.changes.length === 0) {
    const data = rawEffect?.toObject ? rawEffect.toObject() : (rawEffect ?? {});
    const nested = data?.system?.changes;
    if (Array.isArray(nested) && nested.length) serialized.changes = cloneValue(nested);
  }
  return serialized;
}

export function serializeActiveEffectSummary(effect) {
  const data = documentData(effect);
  const changes = data.changes ?? effect.changes ?? [];
  return {
    ...identityFields(effect, data),
    name: effectName(effect, data),
    disabled: data.disabled ?? effect.disabled ?? false,
    transfer: data.transfer ?? effect.transfer ?? false,
    changeCount: Array.isArray(changes) ? changes.length : 0,
    statuses: cloneValue(data.statuses ?? [])
  };
}

export function serializeAppliedEffectSummary(effect) {
  const summary = serializeActiveEffectSummary(effect);
  const parent = effect.parent ?? null;
  return {
    ...summary,
    active: effect.active ?? !summary.disabled,
    parentType: parent?.documentName ?? null,
    parentId: parent?.id ?? null,
    sourceName: effect.sourceName ?? effect.name ?? summary.name ?? null
  };
}

function actorItems(actor, data) {
  if (actor.items) {
    return Array.from(actor.items);
  }

  return Array.isArray(data.items) ? data.items : [];
}

function itemEffects(item, data) {
  if (item.effects) {
    return Array.from(item.effects);
  }

  return Array.isArray(data.effects) ? data.effects : [];
}

function actorEffects(actor, data) {
  if (actor.effects) {
    return Array.from(actor.effects);
  }

  return Array.isArray(data.effects) ? data.effects : [];
}

function normalizePrototypeToken(data) {
  return cloneValue(data.prototypeToken ?? null);
}

export function serializeActorSummary(actor) {
  const data = documentData(actor);
  return {
    ...identityFields(actor, data),
    name: worldDocumentName(actor, data),
    type: actor.type ?? data.type ?? null,
    img: actor.img ?? data.img ?? null,
    folder: actor.folder?.id ?? actor.folder ?? data.folder ?? null,
    sort: actor.sort ?? data.sort ?? 0,

    itemCount: actorItems(actor, data).length,
    effectCount: actorEffects(actor, data).length
  };
}

/**
 * @param {any} token
 * @param {any} [data]
 * @returns {string|null}
 */
export function tokenName(token, data) {
  return placeableName(token, data);
}

/**
 * @param {any} document
 * @param {any} [data]
 * @returns {string|null}
 */
export function placeableName(document, data) {
  if (!document) return null;

  const source = data ?? documentData(document);
  return source.name ?? document.name ?? null;
}

/**
 * @param {any} token
 * @param {{ include?: string[] }} [options]
 */
export function serializeToken(token, { include } = {}) {
  const data = documentData(token);
  const withPrepared = Array.isArray(include) && include.includes("prepared");
  return {
    ...identityFields(token, data),
    name: tokenName(token, data),

    actorId: data.actorId ?? token.actorId ?? null,
    actorLink: data.actorLink ?? token.actorLink ?? false,
    x: data.x ?? token.x ?? 0,
    y: data.y ?? token.y ?? 0,
    elevation: data.elevation ?? token.elevation ?? 0,
    rotation: data.rotation ?? token.rotation ?? 0,
    width: data.width ?? token.width ?? null,
    height: data.height ?? token.height ?? null,
    hidden: data.hidden ?? token.hidden ?? false,
    disposition: data.disposition ?? token.disposition ?? null,

    texture: cloneValue(data.texture ?? null),
    light: cloneValue(data.light ?? null),
    sight: cloneValue(data.sight ?? null),
    bar1: cloneValue(data.bar1 ?? null),
    bar2: cloneValue(data.bar2 ?? null),
    flags: cloneValue(data.flags ?? {}),
    ...(withPrepared ? { prepared: buildPreparedToken(token) } : {})
  };
}

export function serializeTokenSummary(token) {
  const data = documentData(token);
  return {
    ...identityFields(token, data),
    name: tokenName(token, data),
    actorId: data.actorId ?? token.actorId ?? null,
    actorLink: data.actorLink ?? token.actorLink ?? false,
    x: data.x ?? token.x ?? 0,
    y: data.y ?? token.y ?? 0,
    hidden: data.hidden ?? token.hidden ?? false
  };
}

export function serializeTile(tile) {
  const data = documentData(tile);
  return {
    ...identityFields(tile, data),
    texture: cloneValue(data.texture ?? null),
    x: data.x ?? tile.x ?? 0,
    y: data.y ?? tile.y ?? 0,
    width: data.width ?? tile.width ?? null,
    height: data.height ?? tile.height ?? null,
    rotation: data.rotation ?? tile.rotation ?? 0,
    elevation: data.elevation ?? tile.elevation ?? 0,
    sort: data.sort ?? tile.sort ?? 0,
    hidden: data.hidden ?? tile.hidden ?? false,
    locked: data.locked ?? tile.locked ?? false,
    flags: cloneValue(data.flags ?? {})
  };
}

export function serializeTileSummary(tile) {
  const data = documentData(tile);
  return {
    ...identityFields(tile, data),
    x: data.x ?? tile.x ?? 0,
    y: data.y ?? tile.y ?? 0,
    width: data.width ?? tile.width ?? null,
    height: data.height ?? tile.height ?? null,
    hidden: data.hidden ?? tile.hidden ?? false
  };
}

export function serializeSound(sound) {
  const data = documentData(sound);
  return {
    ...identityFields(sound, data),
    path: data.path ?? sound.path ?? null,
    x: data.x ?? sound.x ?? 0,
    y: data.y ?? sound.y ?? 0,
    radius: data.radius ?? sound.radius ?? 0,
    elevation: data.elevation ?? sound.elevation ?? 0,
    volume: data.volume ?? sound.volume ?? null,
    walls: data.walls ?? sound.walls ?? false,
    easing: data.easing ?? sound.easing ?? false,
    repeat: data.repeat ?? sound.repeat ?? false,
    hidden: data.hidden ?? sound.hidden ?? false,
    darkness: cloneValue(data.darkness ?? null),
    flags: cloneValue(data.flags ?? {})
  };
}

export function serializeSoundSummary(sound) {
  const data = documentData(sound);
  return {
    ...identityFields(sound, data),
    path: data.path ?? sound.path ?? null,
    x: data.x ?? sound.x ?? 0,
    y: data.y ?? sound.y ?? 0,
    radius: data.radius ?? sound.radius ?? 0,
    hidden: data.hidden ?? sound.hidden ?? false
  };
}

export function serializeWall(wall) {
  const data = documentData(wall);
  return {
    ...identityFields(wall, data),
    c: cloneValue(data.c ?? wall.c ?? null),
    light: data.light ?? wall.light ?? null,
    sight: data.sight ?? wall.sight ?? null,
    sound: data.sound ?? wall.sound ?? null,
    move: data.move ?? wall.move ?? null,
    dir: data.dir ?? wall.dir ?? null,
    door: data.door ?? wall.door ?? null,
    ds: data.ds ?? wall.ds ?? null,
    doorSound: data.doorSound ?? wall.doorSound ?? null,
    threshold: cloneValue(data.threshold ?? null),
    flags: cloneValue(data.flags ?? {})
  };
}

export function serializeWallSummary(wall) {
  const data = documentData(wall);
  return {
    ...identityFields(wall, data),
    c: cloneValue(data.c ?? wall.c ?? null),
    door: data.door ?? wall.door ?? null,
    ds: data.ds ?? wall.ds ?? null,
    doorSound: data.doorSound ?? wall.doorSound ?? null
  };
}

export function serializeNote(note) {
  const data = documentData(note);
  return {
    ...identityFields(note, data),
    entryId: data.entryId ?? note.entryId ?? null,
    pageId: data.pageId ?? note.pageId ?? null,
    x: data.x ?? note.x ?? 0,
    y: data.y ?? note.y ?? 0,
    elevation: data.elevation ?? note.elevation ?? 0,
    sort: data.sort ?? note.sort ?? 0,
    texture: cloneValue(data.texture ?? null),
    iconSize: data.iconSize ?? note.iconSize ?? null,
    text: data.text ?? note.text ?? null,
    fontFamily: data.fontFamily ?? note.fontFamily ?? null,
    fontSize: data.fontSize ?? note.fontSize ?? null,
    textAnchor: data.textAnchor ?? note.textAnchor ?? null,
    textColor: data.textColor ?? note.textColor ?? null,
    global: data.global ?? note.global ?? false,
    flags: cloneValue(data.flags ?? {})
  };
}

export function serializeNoteSummary(note) {
  const data = documentData(note);
  const texture = data.texture ?? note.texture ?? null;
  return {
    ...identityFields(note, data),
    text: data.text ?? note.text ?? null,
    x: data.x ?? note.x ?? 0,
    y: data.y ?? note.y ?? 0,
    entryId: data.entryId ?? note.entryId ?? null,
    texture: { src: texture?.src ?? null },
    iconSize: data.iconSize ?? note.iconSize ?? null
  };
}

export function serializeDrawing(drawing) {
  const data = documentData(drawing);
  return {
    ...identityFields(drawing, data),

    name: placeableName(drawing, data),
    author: drawing.author?.id ?? data.author ?? drawing.author ?? null,
    shape: cloneValue(data.shape ?? null),
    x: data.x ?? drawing.x ?? 0,
    y: data.y ?? drawing.y ?? 0,
    elevation: data.elevation ?? drawing.elevation ?? 0,
    sort: data.sort ?? drawing.sort ?? 0,
    rotation: data.rotation ?? drawing.rotation ?? 0,
    bezierFactor: data.bezierFactor ?? drawing.bezierFactor ?? 0,
    fillType: data.fillType ?? drawing.fillType ?? null,
    fillColor: data.fillColor ?? drawing.fillColor ?? null,
    fillAlpha: data.fillAlpha ?? drawing.fillAlpha ?? null,
    strokeWidth: data.strokeWidth ?? drawing.strokeWidth ?? null,
    strokeColor: data.strokeColor ?? drawing.strokeColor ?? null,
    strokeAlpha: data.strokeAlpha ?? drawing.strokeAlpha ?? null,
    texture: data.texture ?? drawing.texture ?? null,
    text: data.text ?? drawing.text ?? null,
    fontFamily: data.fontFamily ?? drawing.fontFamily ?? null,
    fontSize: data.fontSize ?? drawing.fontSize ?? null,
    textColor: data.textColor ?? drawing.textColor ?? null,
    textAlpha: data.textAlpha ?? drawing.textAlpha ?? null,
    hidden: data.hidden ?? drawing.hidden ?? false,
    locked: data.locked ?? drawing.locked ?? false,
    interface: data.interface ?? drawing.interface ?? false,
    flags: cloneValue(data.flags ?? {})
  };
}

export function serializeDrawingSummary(drawing) {
  const data = documentData(drawing);
  const shape = data.shape ?? drawing.shape ?? null;
  return {
    ...identityFields(drawing, data),
    name: placeableName(drawing, data),
    text: data.text ?? drawing.text ?? null,
    x: data.x ?? drawing.x ?? 0,
    y: data.y ?? drawing.y ?? 0,
    shape: { type: shape?.type ?? null },
    hidden: data.hidden ?? drawing.hidden ?? false
  };
}

export function serializeAmbientLight(light) {
  const data = documentData(light);
  return {
    ...identityFields(light, data),

    name: placeableName(light, data),
    x: data.x ?? light.x ?? 0,
    y: data.y ?? light.y ?? 0,
    elevation: data.elevation ?? light.elevation ?? 0,
    rotation: data.rotation ?? light.rotation ?? 0,
    walls: data.walls ?? light.walls ?? false,
    vision: data.vision ?? light.vision ?? false,
    config: cloneValue(data.config ?? null),
    hidden: data.hidden ?? light.hidden ?? false,
    flags: cloneValue(data.flags ?? {})
  };
}

export function serializeAmbientLightSummary(light) {
  const data = documentData(light);
  const config = data.config ?? light.config ?? null;
  return {
    ...identityFields(light, data),
    name: placeableName(light, data),
    x: data.x ?? light.x ?? 0,
    y: data.y ?? light.y ?? 0,
    hidden: data.hidden ?? light.hidden ?? false,
    config: {
      dim: config?.dim ?? null,
      bright: config?.bright ?? null,
      color: config?.color ?? null
    }
  };
}

export function serializeMeasuredTemplate(template) {
  const data = documentData(template);
  return {
    ...identityFields(template, data),
    author: template.author?.id ?? data.author ?? template.author ?? null,
    t: data.t ?? template.t ?? null,
    x: data.x ?? template.x ?? 0,
    y: data.y ?? template.y ?? 0,
    elevation: data.elevation ?? template.elevation ?? 0,
    sort: data.sort ?? template.sort ?? 0,
    distance: data.distance ?? template.distance ?? 0,
    direction: data.direction ?? template.direction ?? 0,
    angle: data.angle ?? template.angle ?? 0,
    width: data.width ?? template.width ?? 0,
    borderColor: data.borderColor ?? template.borderColor ?? null,
    fillColor: data.fillColor ?? template.fillColor ?? null,
    texture: data.texture ?? template.texture ?? null,
    hidden: data.hidden ?? template.hidden ?? false,
    flags: cloneValue(data.flags ?? {})
  };
}

export function serializeMeasuredTemplateSummary(template) {
  const data = documentData(template);
  return {
    ...identityFields(template, data),
    t: data.t ?? template.t ?? null,
    x: data.x ?? template.x ?? 0,
    y: data.y ?? template.y ?? 0,
    distance: data.distance ?? template.distance ?? 0,
    hidden: data.hidden ?? template.hidden ?? false
  };
}

/**
 * @param {any} behavior
 * @returns {string}
 */
export function storedRegionBehaviorName(behavior) {
  const source =
    behavior?._source ?? (typeof behavior?.toObject === "function" ? behavior.toObject() : behavior);
  const name = source?.name;
  return typeof name === "string" ? name : "";
}

/**
 * @param {any} behavior
 * @param {any} data
 * @param {Set<string> | null} knownBehaviorIds
 */
function regionBehaviorIdentityFields(behavior, data, knownBehaviorIds) {
  const identity = identityFields(behavior, data);
  if (knownBehaviorIds == null) {
    return identity;
  }
  return typeof identity.id === "string" && knownBehaviorIds.has(identity.id)
    ? identity
    : { id: null, _id: null };
}

/**
 * @param {any} behavior
 * @param {{ knownBehaviorIds?: Set<string> | null }} [options]
 */
export function serializeRegionBehavior(behavior, { knownBehaviorIds = null } = {}) {
  const data = documentData(behavior);
  return {
    ...regionBehaviorIdentityFields(behavior, data, knownBehaviorIds),
    name: storedRegionBehaviorName(behavior),
    type: data.type ?? null,
    disabled: data.disabled ?? false,
    system: cloneValue(data.system ?? {}),
    flags: cloneValue(data.flags ?? {})
  };
}

/** @param {any} behavior */
export function serializeRegionBehaviorSummary(behavior) {
  const data = documentData(behavior);
  return {
    ...identityFields(behavior, data),
    name: storedRegionBehaviorName(behavior),
    type: data.type ?? null,
    disabled: data.disabled ?? false
  };
}

/**
 * @param {any} region
 * @param {{ knownBehaviorIds?: Set<string> | null }} [options]
 */
export function serializeRegion(region, { knownBehaviorIds = null } = {}) {
  const data = documentData(region);
  const behaviors = region.behaviors ? Array.from(region.behaviors) : (data.behaviors ?? []);
  return {
    ...identityFields(region, data),
    name: placeableName(region, data),
    color: data.color ?? region.color ?? null,
    shapes: cloneValue(data.shapes ?? region.shapes ?? []),
    elevation: cloneValue(data.elevation ?? region.elevation ?? null),
    visibility: data.visibility ?? region.visibility ?? null,
    locked: data.locked ?? region.locked ?? false,
    behaviors: Array.isArray(behaviors)
      ? behaviors.map((behavior) => serializeRegionBehavior(behavior, { knownBehaviorIds }))
      : [],
    flags: cloneValue(data.flags ?? {})
  };
}

export function serializeRegionSummary(region) {
  const data = documentData(region);
  const shapes = data.shapes ?? region.shapes ?? [];
  const behaviors = region.behaviors ? Array.from(region.behaviors) : (data.behaviors ?? []);
  return {
    ...identityFields(region, data),
    name: placeableName(region, data),
    color: data.color ?? region.color ?? null,
    visibility: data.visibility ?? region.visibility ?? null,
    shapesCount: Array.isArray(shapes) ? shapes.length : 0,
    behaviorsCount: Array.isArray(behaviors) ? behaviors.length : 0
  };
}

/**
 * @param {any} actor
 * @param {{ include?: string[], ownership?: boolean }} [options]
 */
export function serializeActor(actor, { include, ownership = false } = {}) {
  const data = documentData(actor);

  const withPrepared = Array.isArray(include) && include.includes("prepared");

  const nestedInclude = [];
  if (Array.isArray(include) && include.includes("items.flags")) nestedInclude.push("flags");
  if (Array.isArray(include) && include.includes("items.effects")) nestedInclude.push("effects");
  return {
    ...identityFields(actor, data),
    name: worldDocumentName(actor, data),
    type: actor.type ?? data.type ?? null,
    img: actor.img ?? data.img ?? null,
    folder: actor.folder?.id ?? actor.folder ?? data.folder ?? null,
    sort: actor.sort ?? data.sort ?? 0,

    system: cloneValue(data.system ?? actor.system ?? {}),
    prototypeToken: normalizePrototypeToken(data),

    compendiumSource: compendiumSourceField(data),

    items: actorItems(actor, data).map((item) =>
      serializeItem(item, { include: nestedInclude, nested: true })
    ),

    flags: cloneValue(data.flags ?? {}),
    effects: actorEffects(actor, data).map(serializeActiveEffect),
    ...(withPrepared ? { prepared: buildPreparedActor(actor) } : {}),
    ...(ownership ? { ownership: serializeOwnership(actor, data) } : {})
  };
}

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
function localizeSettingText(raw) {
  if (typeof raw !== "string" || raw === "") {
    return null;
  }

  const localize = /** @type {any} */ (globalThis).game?.i18n?.localize;
  if (typeof localize !== "function") {
    return raw;
  }

  try {
    const localized = localize.call(/** @type {any} */ (globalThis).game.i18n, raw);
    return typeof localized === "string" ? localized : raw;
  } catch {
    return raw;
  }
}

/**
 * @param {unknown} type
 * @returns {{ kind: string } | null}
 */
function describeSettingType(type) {
  if (type === null || type === undefined) {
    return null;
  }

  if (typeof type === "function") {
    const name = typeof type.name === "string" ? type.name : "";
    return { kind: name === "" ? "(anonymous)" : name };
  }

  if (typeof type === "object") {
    const constructorName = /** @type {any} */ (type).constructor?.name;
    return {
      kind: typeof constructorName === "string" && constructorName !== "" ? constructorName : "(anonymous)"
    };
  }

  return { kind: typeof type };
}

/**
 * @param {any} config
 * @param {{ namespace: string | null, key: string | null, id: string }} identity
 */
export function serializeSettingMetadata(config, identity) {
  const rawName = typeof config?.name === "string" && config.name !== "" ? config.name : null;
  const rawHint = typeof config?.hint === "string" && config.hint !== "" ? config.hint : null;
  return {
    namespace: identity.namespace,
    key: identity.key,
    id: identity.id,
    name: rawName,
    nameLocalized: localizeSettingText(rawName),
    hint: rawHint,
    hintLocalized: localizeSettingText(rawHint),
    scope: typeof config?.scope === "string" ? config.scope : null,
    type: describeSettingType(config?.type),
    config: Boolean(config?.config),
    requiresReload: Boolean(config?.requiresReload)
  };
}

export function serializeUser(user) {
  const data = documentData(user);
  const color = data.color ?? user.color ?? null;
  return {
    ...identityFields(user, data),
    name: user.name ?? data.name ?? null,
    role: data.role ?? user.role ?? null,
    isGM: Boolean(user.isGM ?? data.isGM ?? false),
    active: Boolean(user.active ?? data.active ?? false),
    character: user.character?.id ?? data.character ?? user.character ?? null,
    color: color == null ? null : String(color),
    pronouns: data.pronouns ?? null,
    avatar: data.avatar ?? null,
    flags: data.flags ?? user.flags ?? {}
  };
}

export function serializeFolderSummary(folder) {
  const data = documentData(folder);
  const id = folder.id ?? data._id ?? null;
  return {
    id,

    _id: id,
    name: folder.name ?? data.name ?? null,
    type: data.type ?? folder.type ?? null,
    folder: folder.folder?.id ?? data.folder ?? null,
    color: data.color ?? null
  };
}

export function serializeFolder(folder, { childFolderCount = 0, documentCount = 0 } = {}) {
  const data = documentData(folder);
  const summary = serializeFolderSummary(folder);
  return {
    ...summary,
    description: data.description ?? folder.description ?? null,
    sorting: data.sorting ?? folder.sorting ?? "a",
    sort: data.sort ?? folder.sort ?? 0,
    flags: data.flags ?? folder.flags ?? {},
    childFolderCount,
    documentCount
  };
}

export function serializeCompendiumPack(pack) {
  const metadata = pack.metadata ?? {};
  return {
    id: pack.collection ?? pack.metadata?.id ?? null,
    label: pack.title ?? metadata.label ?? null,
    type: pack.documentName ?? metadata.type ?? null,
    system: metadata.system ?? null,
    packageName: metadata.packageName ?? metadata.package ?? null,
    packageType: metadata.packageType ?? null
  };
}

function getDotPath(object, path) {
  const util = globalThis.foundry?.utils;
  let value;
  if (util && typeof util.getProperty === "function") {
    value = util.getProperty(object, path);
  } else {
    let current = object;
    for (const key of String(path).split(".")) {
      if (current == null || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = current[key];
    }
    value = current;
  }
  if (
    value === undefined &&
    object != null &&
    typeof object === "object" &&
    Object.prototype.hasOwnProperty.call(object, path)
  ) {
    value = object[path];
  }
  return value;
}

const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
function isSafeDotPath(path) {
  return String(path)
    .split(".")
    .every((segment) => !UNSAFE_PATH_SEGMENTS.has(segment));
}

function setDotPath(object, path, value) {
  const util = globalThis.foundry?.utils;
  if (util && typeof util.setProperty === "function") {
    util.setProperty(object, path, value);
    return;
  }
  const keys = String(path).split(".");
  let current = object;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (current[key] == null || typeof current[key] !== "object") current[key] = {};
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * @param {any} entry
 * @param {{ fields?: string[] }} [options]
 */
export function serializeCompendiumIndexEntry(entry, { fields } = {}) {
  const result = {};

  if (Array.isArray(fields) && fields.length) {
    for (const field of fields) {
      if (!isSafeDotPath(field)) continue;
      const value = getDotPath(entry, field);
      if (value !== undefined) setDotPath(result, field, cloneValue(value));
    }
  }
  result.id = entry._id ?? entry.id ?? null;
  result._id = entry._id ?? entry.id ?? null;
  result.name = entry.name ?? null;
  result.type = entry.type ?? null;
  result.img = entry.img ?? null;
  return result;
}
