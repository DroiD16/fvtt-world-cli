import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";
import { canonicalizeFilePathFields } from "./file-access.js";
import { BRIDGE_FLAG_SCOPE } from "./chat-capture.js";

import { getFoundryGeneration } from "./foundry-capabilities.js";
import { getCombatsCollection } from "./game-collections.js";
import {
  createWorldDocument,
  getCreateResult,
  previewDocumentCreate,
  previewDocumentUpdate,
  resolveEmbeddedDocumentClass,
  resolveWorldDocumentClass
} from "./world-docs.js";

export const COMBAT_VETO_REMEDY =
  "There is no force flag for a world-side veto — disable the module that vetoes this combat write (or make the change from Foundry's Combat Tracker) and retry.";

export function getCombatById(combatId) {
  const combat = getCombatsCollection().get?.(combatId) ?? null;
  if (!combat) {
    throw createBridgeError(
      ERROR_CODES.COMBAT_NOT_FOUND,
      `Combat ${combatId} was not found; use combat.list to find valid ids`,
      { combatId }
    );
  }
  return combat;
}

export async function createCombat(data) {
  return createWorldDocument("Combat", data);
}

export function previewCombatCreate(data) {
  return previewDocumentCreate(resolveWorldDocumentClass("Combat"), data);
}

/**
 * @param {any} data
 * @param {{ verb?: string }} [options]
 */
export function assertCombatVersionFields(data, { verb = "combat.create" } = {}) {
  if (!data || typeof data !== "object") return;
  if (!Object.prototype.hasOwnProperty.call(data, "name")) return;
  const generation = getFoundryGeneration();
  if (generation !== null && generation >= 14) return;
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `Combat \`name\` is not a field of the Combat document in this Foundry version (added in v14; this core reports generation ${
      generation ?? "unknown"
    }). A v14-only key handed to a v13 core is silently DROPPED with no error, so ${verb} refuses it rather than reporting a write that never landed: omit \`name\` (combats are identified by id and by their linked scene on v13), or set it from Foundry's Combat Tracker on a v14 world`,
    { family: "combat", fields: ["name"], generation }
  );
}

const FOUNDRY_DOCUMENT_ID_PATTERN = /^[a-zA-Z0-9]{16}$/;

/**
 * @param {any} combat
 * @param {string} raw
 * @returns {string | null}
 */
function cleanCombatSceneId(combat, raw) {
  const field = combat?.schema?.fields?.scene;
  let cleaned = null;
  if (typeof field?.clean === "function") {
    try {
      cleaned = field.clean(raw);
    } catch {
      cleaned = null;
    }
  }
  if (typeof cleaned !== "string") {
    cleaned = raw.trim();
  }
  return cleaned || null;
}

/**
 * @param {any} combatant
 * @returns {string | null}
 */
function combatantSceneId(combatant) {
  const source = combatant?._source;
  if (source && typeof source === "object" && Object.hasOwn(source, "sceneId")) {
    return source.sceneId ?? null;
  }
  if (typeof combatant?.toObject === "function") {
    return combatant.toObject()?.sceneId ?? null;
  }
  return combatant?.sceneId ?? null;
}

/**
 * @param {any} combat
 * @param {Record<string, any>} patch
 * @param {{ combatId?: string }} [details]
 * @returns {void}
 */
export function assertCombatSceneContainsCombatants(combat, patch, details = {}) {
  if (!patch || typeof patch !== "object") return;
  if (!Object.prototype.hasOwnProperty.call(patch, "scene")) return;
  if (patch.scene === null || typeof patch.scene !== "string" || !patch.scene) return;

  const sceneId = cleanCombatSceneId(combat, patch.scene);
  if (sceneId === null) return;

  if (!FOUNDRY_DOCUMENT_ID_PATTERN.test(sceneId)) return;
  const combatants = combat?.combatants ? Array.from(combat.combatants) : [];
  const offenders = combatants
    .map((combatant) => ({ combatantId: combatant?.id ?? null, sceneId: combatantSceneId(combatant) }))
    .filter((entry) => entry.sceneId && entry.sceneId !== sceneId);
  if (offenders.length === 0) return;
  throw createBridgeError(
    ERROR_CODES.COMBAT_SCENE_MISMATCH,
    `Combat ${
      details.combatId ?? combat?.id ?? "?"
    } cannot be linked to scene ${sceneId}: Foundry refuses a scene that does not contain all of the combat's combatants, and ${
      offenders.length
    } combatant(s) sit on another scene (${offenders
      .map((entry) => `${entry.combatantId ?? "?"}→${entry.sceneId}`)
      .join(
        ", "
      )}). Move or remove those combatants first (combat.combatant.delete), or send \`scene: null\` to unlink the combat from any scene`,
    { ...details, scene: sceneId, combatants: offenders }
  );
}

const COMBAT_REFERENCE_CLEAR_FLAGS = Object.freeze({
  scene: "--clear-scene",
  actorId: "--clear-actor",
  tokenId: "--clear-token",
  sceneId: "--clear-scene",
  group: "--clear-group"
});

/**
 * @param {Record<string, any>} payload
 * @param {readonly string[]} fields
 * @param {{ combatId?: string, combatantId?: string, verb?: string }} [details]
 * @returns {void}
 */
export function assertCombatReferenceIdsNotBlank(payload, fields, details = {}) {
  if (!payload || typeof payload !== "object") return;
  const blank = fields.filter(
    (field) =>
      Object.prototype.hasOwnProperty.call(payload, field) &&
      typeof payload[field] === "string" &&
      payload[field].trim() === ""
  );
  if (blank.length === 0) return;
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `${blank.length === 1 ? "Field" : "Fields"} ${blank.map((field) => `\`${field}\``).join(", ")} ${
      blank.length === 1 ? "was" : "were"
    } sent as a BLANK string. Foundry trims these reference ids and cleans an empty result to \`null\` — verified by execution on v13.351 and v14.365, on create and on both update arms — so the write would SILENTLY DROP the link (a scene-less combat, a combatant with no actor/token/scene, or a combatant left ungrouped) and the response would report that as success. Nothing was written. Send the id, or clear the link deliberately with ${blank
      .map(
        (field) =>
          `\`${field}: null\`${
            COMBAT_REFERENCE_CLEAR_FLAGS[field] ? ` (CLI \`${COMBAT_REFERENCE_CLEAR_FLAGS[field]}\`)` : ""
          }`
      )
      .join(", ")}${
      blank.includes("sceneId")
        ? ". Note for `sceneId` in particular: a null one is not merely a missing link — Foundry's own cross-scene check reads each combatant's stored `sceneId` and skips a falsy one, so a blanked row can no longer TRIP it and can no longer force the parent combat's `scene` to null"
        : ""
    }`,
    { ...details, fields: blank }
  );
}

/**
 * @param {string | null} [excludeId]
 * @returns {string[]}
 */
export function activeCombatIds(excludeId = null) {
  const ids = [];
  for (const combat of getCombatsCollection()) {
    const source = combat?._source;
    const isActive = Boolean(
      source && typeof source === "object" && Object.hasOwn(source, "active") ? source.active : combat?.active
    );
    const id = combat?.id ?? source?._id ?? null;
    if (isActive && id && id !== excludeId) ids.push(id);
  }
  return ids;
}

/**
 * @param {any} combat
 * @returns {string | null}
 */
export function combatStoredSceneId(combat) {
  const source = combat?._source;
  if (source && typeof source === "object" && Object.hasOwn(source, "scene")) {
    return source.scene ?? null;
  }
  if (typeof combat?.toObject === "function") {
    return combat.toObject()?.scene ?? null;
  }
  const live = combat?.scene;
  return (typeof live === "object" && live !== null ? live.id : live) ?? null;
}

/**
 * @param {any} combatant
 * @returns {string | null}
 */
function combatantGroupId(combatant) {
  const source = combatant?._source;
  if (source && typeof source === "object" && Object.hasOwn(source, "group")) {
    return source.group ?? null;
  }
  if (typeof combatant?.toObject === "function") {
    return combatant.toObject()?.group ?? null;
  }
  const live = combatant?.group;
  return (typeof live === "object" && live !== null ? live.id : live) ?? null;
}

/**
 * @param {any} combat
 * @param {string} groupId
 * @returns {string[]}
 */
export function combatantIdsInGroup(combat, groupId) {
  if (!groupId) return [];
  const combatants = combat?.combatants ? Array.from(combat.combatants) : [];
  return combatants
    .filter((combatant) => combatantGroupId(combatant) === groupId)
    .map((combatant) => combatant?.id ?? combatant?._source?._id ?? null)
    .filter((id) => id !== null);
}

/**
 * @param {any} group
 * @returns {number | null}
 */
function combatantGroupStoredInitiative(group) {
  const source = group?._source;
  if (source && typeof source === "object" && Object.hasOwn(source, "initiative")) {
    return source.initiative ?? null;
  }
  if (typeof group?.toObject === "function") {
    return group.toObject()?.initiative ?? null;
  }
  return group?.initiative ?? null;
}

/**
 * @param {any} combat
 * @returns {Map<string, number | null>}
 */
export function combatantGroupInitiativeSnapshot(combat) {
  const snapshot = new Map();
  const groups = combat?.groups ? Array.from(combat.groups) : [];
  for (const group of groups) {
    const groupId = group?.id ?? group?._source?._id ?? null;
    if (!groupId) continue;
    snapshot.set(groupId, combatantGroupStoredInitiative(group));
  }
  return snapshot;
}

/**
 * @param {Map<string, number | null>} before
 * @param {Map<string, number | null>} after
 * @returns {Array<{groupId: string, initiativeBefore: number | null, initiativeAfter: number | null}>}
 */
export function combatantGroupInitiativeChanges(before, after) {
  const changes = [];
  for (const [groupId, initiativeAfter] of after) {
    if (!before.has(groupId)) continue;

    const initiativeBefore = /** @type {number | null} */ (before.get(groupId));
    if (initiativeBefore === initiativeAfter) continue;
    changes.push({ groupId, initiativeBefore, initiativeAfter });
  }
  return changes;
}

export function getCombatantById(combatId, combatantId) {
  const combat = getCombatById(combatId);
  const combatant = combat.combatants?.get?.(combatantId) ?? null;
  if (!combatant) {
    throw createBridgeError(
      ERROR_CODES.COMBATANT_NOT_FOUND,
      `Combatant ${combatantId} was not found on Combat ${combatId}; use combat.combatant.list to find valid ids`,
      { combatId, combatantId }
    );
  }
  return { combat, combatant };
}

export function getCombatantGroupById(combatId, groupId) {
  const combat = getCombatById(combatId);
  const group = combat.groups?.get?.(groupId) ?? null;
  if (!group) {
    throw createBridgeError(
      ERROR_CODES.COMBATANT_GROUP_NOT_FOUND,
      `Combatant group ${groupId} was not found on Combat ${combatId}; use combat.group.list to find valid ids`,
      { combatId, groupId }
    );
  }
  return { combat, group };
}

/**
 * @param {any} data
 * @param {{ verb?: string }} [options]
 */
export function assertCombatantVersionFields(data, { verb = "combat.combatant.create" } = {}) {
  if (!data || typeof data !== "object") return;
  if (!Object.prototype.hasOwnProperty.call(data, "roundJoined")) return;
  const generation = getFoundryGeneration();
  if (generation !== null && generation >= 14) return;
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `Combatant \`roundJoined\` is not a field of the Combatant document in this Foundry version (added in v14; this core reports generation ${
      generation ?? "unknown"
    }). A v14-only key handed to a v13 core is silently DROPPED with no error, so ${verb} refuses it rather than reporting a write that never landed: omit \`roundJoined\``,
    { family: "combat.combatant", fields: ["roundJoined"], generation }
  );
}

/**
 * @param {any} combat
 * @param {Record<string, any>} payload
 * @param {{ combatId?: string, combatantId?: string }} [details]
 */
export function assertCombatantGroupReference(combat, payload, details = {}) {
  if (!payload || typeof payload !== "object") return;
  if (!Object.prototype.hasOwnProperty.call(payload, "group")) return;
  if (payload.group === null || typeof payload.group !== "string") return;
  const groupId = cleanCombatantGroupId(combat, payload.group);
  if (groupId === null) return;
  if (combat?.groups?.get?.(groupId)) return;
  const known = combat?.groups ? Array.from(combat.groups).map((group) => group?.id ?? null) : [];
  throw createBridgeError(
    ERROR_CODES.COMBATANT_GROUP_NOT_FOUND,
    `Combatant group ${groupId} was not found on Combat ${
      details.combatId ?? combat?.id ?? "?"
    }: Foundry does not check that a combatant's \`group\` exists, so a well-formed id naming no group would be STORED as a dangling reference and silently ignored (the combatant would stay ungrouped). ${
      known.length > 0
        ? `Valid group ids on this combat: ${known.filter(Boolean).join(", ")}`
        : "This combat has no groups yet — create one with combat.group.create"
    }, or send \`group: null\` to leave the group`,
    { ...details, group: groupId, knownGroupIds: known.filter(Boolean) }
  );
}

/**
 * @param {any} combat
 * @param {string} raw
 * @returns {string | null}
 */
function cleanCombatantGroupId(combat, raw) {
  const collectionField = combat?.schema?.fields?.combatants;
  const field =
    collectionField?.model?.schema?.fields?.group ?? collectionField?.element?.schema?.fields?.group;
  let cleaned = null;
  if (typeof field?.clean === "function") {
    try {
      cleaned = field.clean(raw);
    } catch {
      cleaned = null;
    }
  }
  if (typeof cleaned !== "string") {
    cleaned = raw.trim();
  }
  return cleaned || null;
}

export function prepareCombatantPayload(data) {
  return canonicalizeFilePathFields(data ?? {}, "Combatant");
}

export function prepareCombatantGroupPayload(data) {
  return canonicalizeFilePathFields(data ?? {}, "CombatantGroup");
}

export async function createCombatant(combat, data) {
  if (typeof combat?.createEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Combatant create API is not available");
  }
  const created = await combat.createEmbeddedDocuments("Combatant", [data], { render: true });
  return getCreateResult(created, "Combatant creation returned no document");
}

export async function createCombatantGroup(combat, data) {
  if (typeof combat?.createEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "CombatantGroup create API is not available");
  }
  const created = await combat.createEmbeddedDocuments("CombatantGroup", [data], { render: true });
  return getCreateResult(created, "CombatantGroup creation returned no document");
}

export async function updateCombatant(combat, combatantId, patch) {
  const updated = await combat.updateEmbeddedDocuments("Combatant", [{ _id: combatantId, ...patch }], {
    diff: true,
    render: true
  });
  return {
    combatant: combat.combatants?.get?.(combatantId) ?? null,
    committed: Array.isArray(updated) ? updated.length > 0 : Boolean(updated)
  };
}

export async function updateCombatantGroup(combat, groupId, patch) {
  const updated = await combat.updateEmbeddedDocuments("CombatantGroup", [{ _id: groupId, ...patch }], {
    diff: true,
    render: true
  });
  return {
    group: combat.groups?.get?.(groupId) ?? null,
    committed: Array.isArray(updated) ? updated.length > 0 : Boolean(updated)
  };
}

export async function deleteCombatant(combat, combatantId) {
  const deleted = await combat.deleteEmbeddedDocuments("Combatant", [combatantId], { render: true });
  return { committed: Array.isArray(deleted) ? deleted.length > 0 : Boolean(deleted) };
}

export async function deleteCombatantGroup(combat, groupId) {
  const deleted = await combat.deleteEmbeddedDocuments("CombatantGroup", [groupId], { render: true });
  return { committed: Array.isArray(deleted) ? deleted.length > 0 : Boolean(deleted) };
}

/**
 * @param {any} combat
 * @returns {Promise<any>}
 */
async function detachCombatForPreview(combat) {
  if (typeof combat?.clone !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Foundry document clone API is not available");
  }

  const detached = await combat.clone({}, { save: false });
  if (!detached) {
    throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, "Combat clone returned no preview parent");
  }

  return detached;
}

export async function previewCombatantCreate(combat, data) {
  const preview = previewDocumentCreate(resolveEmbeddedDocumentClass(combat?.combatants, "Combatant"), data, {
    parent: await detachCombatForPreview(combat)
  });
  applyCombatantRoundJoinedPreCreate(preview, combat);
  return preview;
}

/**
 * @param {any} preview
 * @param {any} combat
 */
function applyCombatantRoundJoinedPreCreate(preview, combat) {
  if (typeof preview?.updateSource !== "function") return;
  const source = typeof preview.toObject === "function" ? preview.toObject() : preview;
  if (!source || typeof source !== "object" || !Object.hasOwn(source, "roundJoined")) return;
  const round = Number(combat?.round);
  if (!Number.isInteger(round) || round < 1) return;
  if (source.roundJoined === round) return;
  preview.updateSource({ roundJoined: round });
}

export function previewCombatantGroupCreate(combat, data) {
  return previewDocumentCreate(resolveEmbeddedDocumentClass(combat?.groups, "CombatantGroup"), data, {
    parent: combat
  });
}

/**
 * @param {any} combat
 * @param {string} combatantId
 * @returns {Promise<any>}
 */
export async function detachedCombatantRow(combat, combatantId) {
  const detached = await detachCombatForPreview(combat);
  const row = detached.combatants?.get?.(combatantId) ?? null;
  if (!row) {
    throw createBridgeError(
      ERROR_CODES.INTERNAL_ERROR,
      `Combatant ${combatantId} was not present in the non-persisted preview copy of combat ${combat?.id ?? "?"}`,
      { combatId: combat?.id ?? null, combatantId }
    );
  }

  return row;
}

/**
 * @param {any} combat
 * @param {string} combatantId
 * @param {Record<string, any>} [patch]
 */
export async function previewCombatantUpdate(combat, combatantId, patch = {}) {
  return previewDocumentUpdate(await detachedCombatantRow(combat, combatantId), patch);
}

/**
 * @param {any} combat
 * @param {string} method
 * @param {string} verb
 */
export function assertCombatMethodSupported(combat, method, verb) {
  if (typeof combat?.[method] === "function") return;
  throw createBridgeError(
    ERROR_CODES.BRIDGE_NOT_READY,
    `${verb} needs Foundry's Combat#${method}() method, which is not available in this session`,
    { combatId: combat?.id ?? null, method }
  );
}

/**
 * @param {any} combat
 * @returns {{round: number, turn: number | null}}
 */
export function combatStoredState(combat) {
  const source = combat?._source;
  const read = (key, fallback) => {
    if (source && typeof source === "object" && Object.hasOwn(source, key)) return source[key] ?? fallback;
    if (typeof combat?.toObject === "function") {
      const data = combat.toObject();
      if (data && Object.hasOwn(data, key)) return data[key] ?? fallback;
    }
    return combat?.[key] ?? fallback;
  };
  const round = Number(read("round", 0)) || 0;
  const rawTurn = read("turn", null);
  return { round, turn: rawTurn === null || rawTurn === undefined ? null : Number(rawTurn) };
}

/**
 * @param {{round: number, turn: number | null}} before
 * @param {{round: number, turn: number | null}} after
 * @returns {"none"|"turn"|"round"}
 */
export function combatTransition(before, after) {
  if (before.round !== after.round) return "round";
  if (before.turn !== after.turn) return "turn";
  return "none";
}

/**
 * @param {any} params
 * @param {{round: number, turn: number | null}} state
 * @param {{combatId: string, verb: string}} context
 */
export function assertCombatExpectedState(params, state, { combatId, verb }) {
  const wantsRound = Object.prototype.hasOwnProperty.call(params ?? {}, "expectedRound");
  const wantsTurn = Object.prototype.hasOwnProperty.call(params ?? {}, "expectedTurn");
  if (!wantsRound && !wantsTurn) return;
  const roundMismatch = wantsRound && params.expectedRound !== state.round;
  const turnMismatch = wantsTurn && (params.expectedTurn ?? null) !== state.turn;
  if (!roundMismatch && !turnMismatch) return;
  const expectations = [
    ...(wantsRound ? [`round ${params.expectedRound}`] : []),
    ...(wantsTurn ? [`turn ${params.expectedTurn ?? "null"}`] : [])
  ].join(" and ");
  throw createBridgeError(
    ERROR_CODES.PRECONDITION_FAILED,
    `${verb} expected combat ${combatId} to be at ${expectations}, but it stores round ${
      state.round
    } and turn ${state.turn ?? "null"}. Nothing was called. Re-read the encounter with combat.get and retry with the observed values (or omit the expectations to advance from wherever it is).`,
    {
      combatId,
      ...(wantsRound ? { expectedRound: params.expectedRound } : {}),
      ...(wantsTurn ? { expectedTurn: params.expectedTurn ?? null } : {}),
      round: state.round,
      turn: state.turn
    }
  );
}

/**
 * @param {{round: number, turn: number | null}} state
 * @param {{combatId: string, verb: string}} context
 */
export function assertCombatStarted(state, { combatId, verb }) {
  if (state.round > 0) return;
  const rewinds = verb !== "combat.next-turn";
  throw createBridgeError(
    ERROR_CODES.COMBAT_NOT_STARTED,
    `${verb} refuses combat ${combatId}: it has not been started (stored round 0). ${
      rewinds
        ? "Foundry's own previousTurn/previousRound write NOTHING at round 0 and still resolve, so running it would report a transition that never happened."
        : "Foundry's own nextTurn silently delegates to nextRound at round 0, landing round 1 with NO current combatant — which is not the state combat.start produces."
    } Use \`combat start --combat-id ${combatId}\` to begin the encounter${
      rewinds ? "" : ", or `combat next-round` for a deliberate round advance"
    }.`,
    { combatId, round: state.round, turn: state.turn }
  );
}

/**
 * @param {any} combat
 * @param {{round: number, turn: number | null}} stored
 * @param {{combatId: string, verb: string}} context
 */
export function assertCombatLiveStateConverged(combat, stored, { combatId, verb }) {
  const liveRound = typeof combat?.round === "number" ? combat.round : null;
  const rawLiveTurn = combat?.turn;
  const liveTurn = rawLiveTurn === null ? null : typeof rawLiveTurn === "number" ? rawLiveTurn : undefined;
  const roundDiverged = liveRound !== null && liveRound !== stored.round;
  const turnDiverged = liveTurn !== undefined && liveTurn !== stored.turn;
  if (!roundDiverged && !turnDiverged) return;
  throw createBridgeError(
    ERROR_CODES.COMBAT_STATE_DIVERGED,
    `${verb} refuses combat ${combatId}: this GM client's live encounter has DRIFTED from what the world stores. It stores round ${
      stored.round
    } and turn ${stored.turn ?? "null"}, while the live Combat Foundry would act on is at round ${
      liveRound ?? "unknown"
    } and turn ${
      liveTurn === undefined ? "unknown" : (liveTurn ?? "null")
    }. Foundry's nextTurn/nextRound/previousTurn/previousRound compute their write from the LIVE pair, so the encounter would move from a position this response does not describe — EXECUTED on both supported cores, a next-round from stored round 1 with a live round 2 lands round 3. The cause is a stored \`turn\` outside the current turn order: Combat#setupTurns() clamps the live turn to 0 and INCREMENTS the live round in memory, leaving the stored pair untouched. Nothing was called. Repair the stored turn first — \`combat start --combat-id ${combatId}\` re-bases the encounter to round 1 turn 0 (it discards the round progress), or \`combat reset-initiative --combat-id ${combatId}\` writes a valid turn back (it clears every combatant's initiative) — then re-read with \`combat get\` and retry.`,
    {
      combatId,
      round: stored.round,
      turn: stored.turn,
      liveRound,
      liveTurn: liveTurn === undefined ? null : liveTurn
    }
  );
}

/** @param {any} combat */
export async function startCombat(combat) {
  assertCombatMethodSupported(combat, "startCombat", "combat.start");
  await combat.startCombat();
}

/**
 * @param {any} combat
 * @returns {Promise<any>}
 */
export async function activateCombat(combat) {
  assertCombatMethodSupported(combat, "activate", "combat.activate");
  return combat.activate();
}

export const COMBAT_ADVANCE_METHODS = Object.freeze({
  "combat.next-turn": "nextTurn",
  "combat.previous-turn": "previousTurn",
  "combat.next-round": "nextRound",
  "combat.previous-round": "previousRound"
});

/**
 * @param {any} combat
 * @param {keyof typeof COMBAT_ADVANCE_METHODS} verb
 */
export async function advanceCombat(combat, verb) {
  const method = COMBAT_ADVANCE_METHODS[verb];
  assertCombatMethodSupported(combat, method, verb);
  await combat[method]();
}

/**
 * @param {any} combatant
 * @returns {number | null}
 */
export function combatantStoredInitiative(combatant) {
  const source = combatant?._source;
  if (source && typeof source === "object" && Object.hasOwn(source, "initiative")) {
    return source.initiative ?? null;
  }
  if (typeof combatant?.toObject === "function") {
    const data = combatant.toObject();
    if (data && Object.hasOwn(data, "initiative")) return data.initiative ?? null;
  }
  return combatant?.initiative ?? null;
}

/**
 * @param {any} combat
 * @returns {Map<string, number | null>}
 */
export function combatantInitiativeSnapshot(combat) {
  const snapshot = new Map();
  for (const combatant of combat?.combatants ? Array.from(combat.combatants) : []) {
    const id = combatant?.id ?? combatant?._source?._id ?? null;
    if (typeof id === "string" && id !== "") snapshot.set(id, combatantStoredInitiative(combatant));
  }
  return snapshot;
}

/** @param {any} combat */
export async function resetCombatInitiative(combat) {
  assertCombatMethodSupported(combat, "resetAll", "combat.reset-initiative");
  await combat.resetAll();
}

/**
 * @param {"public"|"gm"|"blind"|"self"} rollMode
 * @param {string} correlationId
 * @param {string | null} [formula]
 * @returns {Record<string, any>}
 */
export function resolveCombatInitiativeOptions(rollMode, correlationId, formula = null) {
  const flags = { [BRIDGE_FLAG_SCOPE]: { correlationId } };
  const generation = getFoundryGeneration();
  const base = formula ? { formula } : {};
  if (generation !== null && generation >= 14) {
    return { ...base, messageMode: rollMode, messageOptions: { flags } };
  }
  const legacy = { public: "publicroll", gm: "gmroll", blind: "blindroll", self: "selfroll" };
  return { ...base, messageOptions: { rollMode: legacy[rollMode], flags } };
}

/**
 * @param {any} combat
 * @param {any} params
 * @param {string} combatId
 * @returns {{mode: "ids"|"all"|"npc", targetedCombatantIds: string[]}}
 */
export function resolveCombatInitiativeTargets(combat, params, combatId) {
  const hasIds = Array.isArray(params?.combatantIds) && params.combatantIds.length > 0;
  const hasSelect = typeof params?.select === "string" && params.select !== "";
  if (hasIds === hasSelect) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      'combat.roll-initiative needs EXACTLY ONE of `combatantIds` (roll these combatants) or `select` ("all" → Combat#rollAll, "npc" → Combat#rollNPC, both of which roll only combatants that have no initiative yet)',
      { combatId }
    );
  }

  if (hasSelect) {
    const wantsNpc = params.select === "npc";
    const targeted = [];
    for (const combatant of combat?.combatants ? Array.from(combat.combatants) : []) {
      if (!combatant?.isOwner) continue;
      if (wantsNpc && !combatant?.isNPC) continue;
      if ((combatant?.initiative ?? null) !== null) continue;
      const id = combatant?.id ?? null;
      if (typeof id === "string" && id !== "") targeted.push(id);
    }
    return { mode: wantsNpc ? "npc" : "all", targetedCombatantIds: targeted };
  }

  const seenIds = new Set();
  const repeated = [];
  for (const id of params.combatantIds) {
    if (seenIds.has(id)) {
      if (!repeated.includes(id)) repeated.push(id);
      continue;
    }
    seenIds.add(id);
  }
  if (repeated.length > 0) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `Combatant id(s) ${repeated.join(
        ", "
      )} are listed more than once in combatantIds. Foundry's rollInitiative rolls ONCE PER ARRAY ENTRY and posts one chat message per entry — it de-duplicates nothing — while a combatant row stores ONE initiative and the batch is keyed by id, so a repeated id would announce two totals in chat and keep at most one of them, and the bridge could confirm neither (its confirmation reads one stored value per combatant). Nothing was rolled. List each combatant once; to deliberately roll a row again, issue a second combat.roll-initiative for it with a NEW idempotencyKey.`,
      { combatId, combatantIds: repeated }
    );
  }

  const unknown = [];
  const unowned = [];
  for (const id of params.combatantIds) {
    const combatant = combat?.combatants?.get?.(id) ?? null;
    if (!combatant) unknown.push(id);
    else if (!combatant.isOwner) unowned.push(id);
  }
  if (unknown.length > 0) {
    throw createBridgeError(
      ERROR_CODES.COMBATANT_NOT_FOUND,
      `Combatant(s) ${unknown.join(", ")} were not found on combat ${combatId}. Foundry's rollInitiative SKIPS an unknown id silently — it would roll fewer combatants and post fewer chat messages than requested and still resolve — so nothing was rolled. Use combat.combatant.list to find valid ids.`,
      { combatId, combatantIds: unknown }
    );
  }
  if (unowned.length > 0) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `Combatant(s) ${unowned.join(", ")} are not owned by this Foundry session, and Foundry's rollInitiative SKIPS an unowned combatant silently. Nothing was rolled. A GM session owns every combatant, so this normally means the bridge session is not a GM.`,
      { combatId, combatantIds: unowned }
    );
  }
  return { mode: "ids", targetedCombatantIds: [...params.combatantIds] };
}

/**
 * @param {any} combat
 * @param {"ids"|"all"|"npc"} mode
 * @param {string[]} combatantIds
 * @param {Record<string, any>} options
 */
export async function rollCombatInitiative(combat, mode, combatantIds, options) {
  const method = mode === "all" ? "rollAll" : mode === "npc" ? "rollNPC" : "rollInitiative";
  assertCombatMethodSupported(combat, method, "combat.roll-initiative");
  if (mode === "ids") await combat.rollInitiative(combatantIds, options);
  else await combat[method](options);
}

/**
 * @param {any} combat
 * @param {string} combatantId
 * @param {number | null} initiative
 */
export async function setCombatantInitiative(combat, combatantId, initiative) {
  assertCombatMethodSupported(combat, "setInitiative", "combat.set-initiative");
  await combat.setInitiative(combatantId, initiative);
}
