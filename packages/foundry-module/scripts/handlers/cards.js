import {
  CARDS_VETO_REMEDY,
  assertCardsMethod,
  canonicalizeCardPayload,
  cardIsHome,
  confirmCardsRecall,
  countStoredAvailableCards,
  createCard,
  createCards,
  dealCardsFrom,
  deleteCard,
  describeCardsClone,
  describeCardsRecall,
  drawCardsInto,
  evaluateCardShuffle,
  getCardById,
  getCardsById,
  liveAvailableCards,
  passCardsTo,
  prepareCardsCreateData,
  previewCardCreate,
  previewCardsCreate,
  recallCardStack,
  recallDeletesCardCopy,
  resolveCardDrawMode,
  shuffleCardStack,
  snapshotCardMovementRows,
  snapshotCardRows,
  snapshotCardSorts,
  updateCard
} from "../lib/cards-docs.js";
import { getCardsCollection } from "../lib/game-collections.js";
import { assertTableFamilyDeleteCommitted, assertTableFamilyUpdateCommitted } from "../lib/table-docs.js";
import {
  assertClonePatchValid,
  cloneDocument,
  deleteDocument,
  previewDocumentUpdate
} from "../lib/world-docs.js";
import {
  BATCH_GET_MAX_IDS,
  CARDS_PASS_MAX_IDS,
  CARDS_ACTION_CHAT_STATUSES,
  CARDS_ACTION_MUTATION_OUTCOMES,
  CARDS_ACTION_RECONCILIATIONS,
  CARDS_RECALL_CONSEQUENCE_SCOPES,
  CARDS_RECALL_STATUSES,
  ERROR_CODES
} from "../generated/protocol.js";
import {
  createBridgeError,
  isFoundryValidationError,
  toFailureSummary,
  toFoundryValidationError,
  toProtocolError
} from "../lib/errors.js";
import { createMutationQueue } from "../lib/mutation-queue.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { canonicalizeFilePathFields } from "../lib/file-access.js";
import {
  cloneValue,
  filterByName,
  normalizePreviewCards,
  paginate,
  serializeCard,
  serializeCardSummary,
  serializeCards,
  serializeCardsSummary,
  storedCardName
} from "../lib/serializers.js";

const cardsQueue = createMutationQueue();

function compareCardStacks(a, b) {
  const sortA = Number.isFinite(a?.sort) ? a.sort : Number.POSITIVE_INFINITY;
  const sortB = Number.isFinite(b?.sort) ? b.sort : Number.POSITIVE_INFINITY;
  if (sortA !== sortB) return sortA - sortB;
  return String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
}

const CARD_FACES_PROBE_NAME = "faces validation probe";

/**
 * @param {any} stack
 * @param {any} payload
 */
function assertCardFacesValid(stack, payload) {
  if (!Array.isArray(payload?.faces)) {
    return;
  }

  previewCardCreate(stack, { name: CARD_FACES_PROBE_NAME, faces: cloneValue(payload.faces) });
}

const CARDS_RECALL_ID_CAP = 100;
const CARDS_RECALL_STACK_CAP = 20;

const CARDS_RECALL_NESTED_ID_CAP = 20;

/**
 * @param {string} key
 * @param {Array<string|null>} ids
 * @param {number} cap
 */
function capCardIds(key, ids, cap) {
  return {
    [key]: ids.slice(0, cap),
    [`${key}Count`]: ids.length,
    [`${key}Truncated`]: ids.length > cap
  };
}

/**
 * @param {string} key
 * @param {Array<{cardsId: string|null, cardsName?: string|null, cardIds: Array<string|null>}>} entries
 */
function capStackEntries(key, entries) {
  return {
    [key]: entries.slice(0, CARDS_RECALL_STACK_CAP).map((entry) => ({
      ...entry,
      ...capCardIds("cardIds", entry.cardIds, CARDS_RECALL_NESTED_ID_CAP)
    })),
    [`${key}Count`]: entries.length,
    [`${key}Truncated`]: entries.length > CARDS_RECALL_STACK_CAP
  };
}

/**
 * @param {ReturnType<typeof describeCardsRecall>} plan
 * @param {"applied" | "prospective" | "unknown"} deleteConsequences
 * @param {ReturnType<typeof confirmCardsRecall> | null} confirmation
 */
function danglingOriginsLeft(plan, deleteConsequences, confirmation) {
  if (plan.type !== "deck" || deleteConsequences !== "applied" || !confirmation) {
    return plan.danglingOriginsLeft;
  }
  return (confirmation.reclaimedRemaining ?? []).map((entry) => ({
    cardsId: entry.cardsId,
    cardsName: plan.reclaimed.find((row) => row.cardsId === entry.cardsId)?.cardsName ?? null,
    cardIds: entry.cardIds
  }));
}

/** @param {ReturnType<typeof describeCardsRecall>} plan */
function recallLists(plan) {
  return {
    type: plan.type,
    ...capStackEntries("reclaimed", plan.reclaimed),
    ...capStackEntries("returned", plan.returned),
    ...capCardIds("skippedCardIds", plan.skippedCardIds, CARDS_RECALL_ID_CAP),
    ...capCardIds("destroyedCardIds", plan.destroyedCardIds, CARDS_RECALL_ID_CAP),
    ...capCardIds("ownDrawnResetCardIds", plan.ownDrawnResetCardIds, CARDS_RECALL_ID_CAP)
  };
}

/** @param {ReturnType<typeof confirmCardsRecall> | null} confirmation */
function unconfirmedRecallBody(confirmation) {
  if (!confirmation || confirmation.confirmed) return {};
  return {
    unconfirmed: {
      ...capStackEntries("reclaimedRemaining", confirmation.reclaimedRemaining),
      ...capStackEntries("notReturned", confirmation.notReturned),
      ...capCardIds("ownRowsStillDrawn", confirmation.ownRowsStillDrawn, CARDS_RECALL_ID_CAP),
      ...capCardIds("notRemovedCardIds", confirmation.notRemovedCardIds, CARDS_RECALL_ID_CAP)
    }
  };
}

/**
 * @param {ReturnType<typeof describeCardsRecall>} plan
 * @param {"not-executed" | "confirmed" | "unconfirmed" | "not-verified"} status
 * @param {"applied" | "prospective" | "unknown"} deleteConsequences
 * @param {ReturnType<typeof confirmCardsRecall> | null} [confirmation]
 */
function recallBody(plan, status, deleteConsequences, confirmation = null) {
  if (!CARDS_RECALL_STATUSES.includes(status)) {
    throw new Error(`recallBody: unknown recall status ${JSON.stringify(status)}`);
  }
  if (!CARDS_RECALL_CONSEQUENCE_SCOPES.includes(deleteConsequences)) {
    throw new Error(`recallBody: unknown deleteConsequences scope ${JSON.stringify(deleteConsequences)}`);
  }
  return {
    ...recallLists(plan),
    ...capStackEntries("danglingOriginsLeft", danglingOriginsLeft(plan, deleteConsequences, confirmation)),

    ...capStackEntries("originRowsLeftDrawn", plan.originRowsLeftDrawn),
    status,
    deleteConsequences,

    ...unconfirmedRecallBody(confirmation)
  };
}

/**
 * @param {unknown} error
 * @param {string} id
 * @param {ReturnType<typeof describeCardsRecall>} plan
 * @returns {import("../lib/errors.js").BridgeError}
 */
function deleteFailureError(error, id, plan) {
  const protocolError = isFoundryValidationError(error)
    ? toFoundryValidationError(error)
    : toProtocolError(/** @type {any} */ (error));
  return createBridgeError(protocolError.code, protocolError.message, {
    ...protocolError.details,
    cardsId: id,

    recall: recallBody(plan, "not-verified", "unknown"),
    chatNotification: { requested: true, status: "unknown" }
  });
}

/** @param {any} stack */
function rereadCardStack(stack) {
  const id = stack?.id ?? null;
  if (!id) return stack;
  return getCardsCollection().get?.(id) ?? stack;
}

/**
 * @param {boolean} requested
 * @param {"dispatched"|"not-requested"|"not-dispatched"|"unknown"} status
 */
function actionChatNotification(requested, status) {
  const resolved = requested ? status : "not-requested";
  if (!CARDS_ACTION_CHAT_STATUSES.includes(resolved)) {
    throw new Error(`actionChatNotification: unknown status ${JSON.stringify(resolved)}`);
  }
  return { requested, status: resolved };
}

/**
 * @param {"committed"|"partial"|"unknown"|"not-executed"} mutation
 * @param {"confirmed"|"best-effort"|"not-executed"} reconciliation
 */
function actionMarkers(mutation, reconciliation) {
  if (!CARDS_ACTION_MUTATION_OUTCOMES.includes(mutation)) {
    throw new Error(`actionMarkers: unknown mutation outcome ${JSON.stringify(mutation)}`);
  }
  if (!CARDS_ACTION_RECONCILIATIONS.includes(reconciliation)) {
    throw new Error(`actionMarkers: unknown reconciliation ${JSON.stringify(reconciliation)}`);
  }
  return { mutation, reconciliation };
}

/** @param {Array<{cardsId: string|null, cardsName: string|null, expected: number, receivedCardIds: string[], returnedCardIds: string[], indeterminateCardIds?: string[], invalidStateCardIds?: string[]}>} entries */
function capMovementDestinations(entries) {
  return {
    to: entries.slice(0, CARDS_RECALL_STACK_CAP).map((entry) => ({
      cardsId: entry.cardsId,
      cardsName: entry.cardsName,
      expected: entry.expected,

      ...capCardIds("receivedCardIds", entry.receivedCardIds, CARDS_RECALL_NESTED_ID_CAP),

      ...capCardIds("returnedCardIds", entry.returnedCardIds, CARDS_RECALL_NESTED_ID_CAP),

      ...(entry.indeterminateCardIds?.length
        ? capCardIds("indeterminateCardIds", entry.indeterminateCardIds, CARDS_RECALL_NESTED_ID_CAP)
        : {}),

      ...(entry.invalidStateCardIds?.length
        ? capCardIds("invalidStateCardIds", entry.invalidStateCardIds, CARDS_RECALL_NESTED_ID_CAP)
        : {})
    })),
    toCount: entries.length,
    toTruncated: entries.length > CARDS_RECALL_STACK_CAP
  };
}

/**
 * @param {any} stack
 * @param {string[]} ids
 * @param {{ param: string, role: "destination" | "source" }} context
 */
function resolveCardsActionTargets(stack, ids, context) {
  const stacks = ids.map((id) => getCardsById(id));

  const selfId = stack?.id ?? null;
  if (selfId && ids.includes(selfId)) {
    const mechanism =
      context.role === "source"
        ? "Foundry refuses the call itself: Cards#draw throws on its own source check before it builds any write, so nothing would move."
        : "Foundry has no self-target check here — the write it would build either collides on the moved card's own _id (the server rejects `The _id [x] already exists within the parent collection`) or rewrites the row it was asked to move in place, so nothing would move.";
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `--${context.param} names the stack itself (${selfId}): a card stack cannot be its own ${context.role}. ${mechanism}`,
      { cardsId: selfId, [context.param]: ids }
    );
  }

  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `--${context.param} names the same card stack more than once (${[...new Set(duplicates)].join(", ")}). Foundry allows it, but this command reports one entry per stack, so repeat the call (or double --count) instead.`,
      { [context.param]: ids, duplicates: [...new Set(duplicates)] }
    );
  }

  return stacks;
}

/**
 * @param {any} source
 * @param {number} requested
 * @param {string} command
 */
function assertCardsAvailable(source, requested, command) {
  const available = liveAvailableCards(source).length;
  if (available >= requested) return;
  const type = source?.type ?? null;
  throw createBridgeError(
    ERROR_CODES.INSUFFICIENT_CARDS,
    `Cards ${source?.id ?? "?"} has ${available} available card(s) but ${command} asked for ${requested}.` +
      (type === "deck"
        ? " A deck's drawn cards are unavailable until they come back: recall it with `cards reset`, or ask for fewer."
        : " A hand or pile makes every card it holds available, so it simply does not hold enough — ask for fewer."),
    { cardsId: source?.id ?? null, type, available, requested }
  );
}

/**
 * @param {any} source
 * @param {any[]} destinations
 * @param {number} count
 */
function assertCardsDealCannotCollide(source, destinations, count) {
  const availableIds = liveAvailableCards(source)
    .map((card) => card?.id ?? card?._id ?? null)
    .filter((cardId) => cardId != null);

  for (const target of destinations) {
    const held = snapshotCardRows(target);
    const colliding = availableIds.filter((cardId) => held.has(cardId));
    if (availableIds.length - colliding.length >= count) continue;

    const sampleCap = 10;
    const sample =
      colliding.length > sampleCap
        ? `${colliding.slice(0, sampleCap).join(", ")} … (${sampleCap} of ${colliding.length} shown — see details.collidingCardIds)`
        : colliding.join(", ");
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `cards.deal cannot move ${count} card(s) from Cards ${source?.id ?? "?"} into Cards ${target?.id ?? "?"} without an _id collision: ` +
        `${colliding.length} of its ${availableIds.length} available card(s) already have a row in that stack (${sample}), ` +
        `leaving ${availableIds.length - colliding.length}. Foundry deals with \`keepId:true\`, so the destination's create is REJECTED while the source-side write in the same batch LANDS — ` +
        "a dealt card would be DESTROYED (deleted here, its origin deck's row left stranded drawn=true) or, if it is home in this stack, left flagged drawn=true with nothing arrived. " +
        "To give dealt cards BACK, use `cards pass --card-ids <ids>` or `cards draw` from the origin stack: those take Foundry's return-to-origin branch, which creates no row and cannot collide.",
      {
        cardsId: source?.id ?? null,
        to: target?.id ?? null,
        count,
        available: availableIds.length,
        ...capCardIds("collidingCardIds", colliding, CARDS_RECALL_ID_CAP)
      }
    );
  }
}

/** @param {{ source: any, target: any, cardIds: string[], roleFor: (cardId: string) => "create" | "return", sourceEffectFor: (cardId: string) => "drawn" | "removed" | "none" }} options */
function assertCardsPassCannotCollide({ source, target, cardIds, roleFor, sourceEffectFor }) {
  const held = snapshotCardRows(target);
  const colliding = cardIds.filter((cardId) => roleFor(cardId) === "create" && held.has(cardId));
  if (!colliding.length) return;

  const sourceId = source?.id ?? "?";
  const targetId = target?.id ?? "?";

  /** @type {{ removed: string[], drawn: string[], none: string[] }} */
  const byEffect = { removed: [], drawn: [], none: [] };
  for (const cardId of colliding) byEffect[sourceEffectFor(cardId)].push(cardId);
  const hazards = [];
  if (byEffect.removed.length) {
    hazards.push(
      `${byEffect.removed.join(", ")} would be DELETED from Cards ${sourceId} with nothing arriving, so ${byEffect.removed.length === 1 ? "that card" : "those cards"} would exist nowhere (any origin stack's row stays stranded drawn=true)`
    );
  }
  if (byEffect.drawn.length) {
    hazards.push(
      `${byEffect.drawn.join(", ")} would be left flagged drawn=true in Cards ${sourceId} with nothing arriving`
    );
  }
  if (byEffect.none.length) {
    hazards.push(
      `${byEffect.none.join(", ")} take Foundry's copy-into-a-deck branch, which writes nothing to Cards ${sourceId}, so that failure would be clean`
    );
  }

  const sampleCap = 10;
  const sample =
    colliding.length > sampleCap
      ? `${colliding.slice(0, sampleCap).join(", ")} … (${sampleCap} of ${colliding.length} shown — see details.collidingCardIds)`
      : colliding.join(", ");
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `cards.pass cannot move ${colliding.length} of the named card(s) into Cards ${targetId}: that stack already holds a row with the same _id (${sample}), ` +
      `and their origin is not ${targetId}, so Foundry builds a \`keepId:true\` CREATE rather than its return-to-origin update. ` +
      "The server rejects that create (`The _id [x] already exists within the parent collection`) and the whole pass fails, while the source-side write in the same batch can still LAND — " +
      `${hazards.join("; ")}. ` +
      `List the destination (\`cards card list --cards-id ${targetId}\`) and delete the row you no longer want (\`cards card delete\`), or pass a card that stack does not already hold.`,
    {
      cardsId: sourceId === "?" ? null : sourceId,
      to: targetId === "?" ? null : targetId,
      ...capCardIds("collidingCardIds", colliding, CARDS_RECALL_ID_CAP)
    }
  );
}

/**
 * @param {any} source
 * @param {{ copyIntoDeck: boolean }} options
 */
function cardsSourceEffects(source, { copyIntoDeck }) {
  const homeCardIds = new Set();
  for (const card of source?.cards ? Array.from(source.cards) : []) {
    const cardId = card?.id ?? card?._id ?? null;
    if (cardId != null && cardIsHome(source, card)) homeCardIds.add(cardId);
  }
  return (cardId) => {
    if (!homeCardIds.has(cardId)) return "removed";
    return copyIntoDeck ? "none" : "drawn";
  };
}

/**
 * @param {any} source
 * @param {any} target
 * @param {{deal?: boolean}} [options]
 * @returns {{roleFor: (cardId: string) => "create" | "return", stateFor: (cardId: string) => {drawn:boolean, origin:string|null}|null}}
 */
function cardsDestinationPlan(source, target, { deal = false } = {}) {
  const roles = new Map();
  const expectedStates = new Map();
  const sourceRows = snapshotCardMovementRows(source);
  const targetRows = snapshotCardMovementRows(target);
  for (const card of source?.cards ? Array.from(source.cards) : []) {
    const cardId = card?.id ?? card?._id ?? null;
    if (cardId == null) continue;
    const sourceState = sourceRows.get(cardId);
    const sourceOrigin = sourceState?.origin ?? null;
    const isHome = cardIsHome(source, card);
    if (deal) {
      roles.set(cardId, "create");
      expectedStates.set(cardId, {
        drawn: true,
        origin: isHome || !sourceOrigin ? (source?.id ?? null) : sourceOrigin
      });
      continue;
    }
    const origin = card?.origin ?? null;
    const deletedFromOrigin = Boolean(origin) && !origin.cards?.get?.(cardId);
    if (origin === target && !deletedFromOrigin) {
      roles.set(cardId, "return");
      expectedStates.set(cardId, {
        drawn: false,

        origin: targetRows.get(cardId)?.origin ?? null
      });
      continue;
    }
    const copyCard = isHome && target?.type === "deck";
    roles.set(cardId, "create");
    expectedStates.set(cardId, {
      drawn: !copyCard && !deletedFromOrigin,
      origin: copyCard ? (target?.id ?? null) : isHome || !sourceOrigin ? (source?.id ?? null) : sourceOrigin
    });
  }
  return {
    roleFor: (cardId) => roles.get(cardId) ?? "create",
    stateFor: (cardId) => expectedStates.get(cardId) ?? null
  };
}

/**
 * @param {any} source
 * @param {Map<string, boolean>} sourceRows
 * @returns {string[]}
 */
function cardsMovementCandidateIds(source, sourceRows) {
  return liveAvailableCards(source)
    .map((card) => card?.id ?? card?._id ?? null)
    .filter((cardId) => cardId != null && sourceRows.has(cardId));
}

/** @param {{ candidateIds: string[], sourceEffectFor: (cardId: string) => "drawn" | "removed" | "none", sourceBefore: Map<string, boolean>, sourceAfter: Map<string, boolean>, destinations: Array<{ expected: number, roleFor: ((cardId: string) => "create"|"return")|null, stateFor: (cardId: string) => {drawn:boolean, origin:string|null}|null, before: Map<string, boolean>, after: Map<string, boolean>, beforeState: Map<string, {drawn:boolean, origin:string|null}>, afterState: Map<string, {drawn:boolean, origin:string|null}> }> }} input */
function classifyCardMovements({ candidateIds, sourceEffectFor, sourceBefore, sourceAfter, destinations }) {
  const perDestination = destinations.map(
    () =>
      /** @type {{receivedCardIds: string[], returnedCardIds: string[], indeterminateCardIds: string[], invalidStateCardIds: string[]}} */ ({
        receivedCardIds: [],
        returnedCardIds: [],
        indeterminateCardIds: [],
        invalidStateCardIds: []
      })
  );
  const removedCardIds = [];
  const drawnCardIds = [];
  const strandedCardIds = [];
  const unsourcedCardIds = [];
  /** @type {Array<{cardId: string, index: number, sourceWitness: boolean}>} */
  const weak = [];
  let witnessed = false;

  for (const cardId of candidateIds) {
    const effect = sourceEffectFor(cardId);

    const sourceOk =
      effect === "drawn"
        ? sourceAfter.get(cardId) === true
        : effect === "removed"
          ? !sourceAfter.has(cardId)
          : true;

    const sourceWitness =
      effect === "drawn"
        ? sourceBefore.get(cardId) !== true && sourceAfter.get(cardId) === true
        : effect === "removed"
          ? sourceBefore.has(cardId) && !sourceAfter.has(cardId)
          : false;
    if (sourceWitness) {
      witnessed = true;
      (effect === "removed" ? removedCardIds : drawnCardIds).push(cardId);
    }

    let hit = null;
    let invalidHit = null;
    for (const [index, destination] of destinations.entries()) {
      const role = destination.roleFor?.(cardId) ?? "create";
      const before = destination.before;
      const after = destination.after;
      const expectedState = destination.stateFor(cardId);
      const actualState = destination.afterState.get(cardId) ?? null;
      const stateMatches =
        expectedState !== null &&
        actualState !== null &&
        actualState.drawn === expectedState.drawn &&
        actualState.origin === expectedState.origin;
      const appeared = role === "create" && !before.has(cardId) && after.has(cardId);
      const arrived = role === "create" ? appeared && stateMatches : stateMatches;
      if (!arrived) {
        const beforeState = destination.beforeState.get(cardId) ?? null;
        const stateChanged =
          actualState !== null &&
          (beforeState === null ||
            actualState.drawn !== beforeState.drawn ||
            actualState.origin !== beforeState.origin);
        const invalidWitness =
          role === "create" ? appeared : actualState !== null && (stateChanged || sourceWitness);
        if (invalidWitness && !invalidHit) invalidHit = { index, witness: appeared || stateChanged };
        continue;
      }

      const witness = role === "create" ? true : before.get(cardId) === true;
      if (!hit || (witness && !hit.witness)) hit = { index, role, witness };
      if (witness) break;
    }
    if (hit?.witness || invalidHit?.witness) witnessed = true;

    if (hit?.witness) {
      perDestination[hit.index][hit.role === "return" ? "returnedCardIds" : "receivedCardIds"].push(cardId);
      if (!sourceOk) unsourcedCardIds.push(cardId);
    } else if (hit && sourceOk) {
      weak.push({ cardId, index: hit.index, sourceWitness });
    } else if (invalidHit) {
      perDestination[invalidHit.index].invalidStateCardIds.push(cardId);
      if (invalidHit.witness && !sourceOk) unsourcedCardIds.push(cardId);
    } else if (sourceWitness) {
      strandedCardIds.push(cardId);
    }
    // The remaining cell — no witness anywhere and the post-state NOT what was asked — is untouched:
    // for `deal`/`draw` a card `_drawCards` did not select, and for `pass` a movement that did not
    // happen (the vetoed-return shape), which the shortfall reports.
  }

  for (const [index, destination] of destinations.entries()) {
    const rows = perDestination[index];
    const strong = rows.receivedCardIds.length + rows.returnedCardIds.length;
    let slots = Math.max(0, (destination.expected ?? 0) - strong);
    if (slots === 0) continue;
    for (const entry of weak) {
      if (slots === 0) break;
      if (entry.index !== index) continue;
      slots -= 1;
      if (entry.sourceWitness) rows.returnedCardIds.push(entry.cardId);
      else rows.indeterminateCardIds.push(entry.cardId);
    }
  }

  return {
    perDestination,
    removedCardIds,
    drawnCardIds,
    strandedCardIds,
    unsourcedCardIds,

    witnessed
  };
}

/**
 * @param {any} source
 * @param {string[]} candidateIds
 * @param {(cardId: string) => "drawn" | "removed" | "none"} sourceEffectFor
 * @param {Map<string, boolean>} sourceRows
 * @param {{ roleFor: ((cardId: string) => "create"|"return")|null, before: Map<string, boolean> }} destination
 */
function forecastCardsPass(source, candidateIds, sourceEffectFor, sourceRows, destination) {
  const receivedCardIds = [];
  const returnedCardIds = [];
  const indeterminateCardIds = [];
  const removedCardIds = [];
  const drawnCardIds = [];
  const predicted = new Map(sourceRows);
  for (const cardId of candidateIds) {
    const role = destination.roleFor?.(cardId) ?? "create";
    const effect = sourceEffectFor(cardId);
    if (role === "create") receivedCardIds.push(cardId);
    // The FORECAST of the ledger's `indeterminate` cell, from the same two facts the real path reads —
    // so the operator is warned BEFORE the call that its outcome will not be verifiable, and the
    // preview stops promising a return the verdict cannot confirm.
    else if (effect === "none" && destination.before.get(cardId) === false) {
      indeterminateCardIds.push(cardId);
    } else returnedCardIds.push(cardId);
    if (effect === "removed") {
      removedCardIds.push(cardId);
      predicted.delete(cardId);
    } else if (effect === "drawn") {
      drawnCardIds.push(cardId);
      predicted.set(cardId, true);
    }
    // `none` — the copy-into-a-deck branch writes nothing to the source, so it appears in neither list
    // and moves no count.
  }
  const remaining =
    (source?.type ?? null) === "deck"
      ? Array.from(predicted.values()).filter((drawn) => drawn !== true).length
      : predicted.size;
  return {
    destinations: [{ receivedCardIds, returnedCardIds, indeterminateCardIds }],
    source: { removedCardIds, drawnCardIds, remaining }
  };
}

/** @param {{ params: any, command: string, cardsId: string, source: any, destinations: Array<{ stack: any, expected: number, roleFor?: ((cardId: string) => "create"|"return")|null, stateFor: (cardId: string) => {drawn:boolean, origin:string|null}|null }>, chat: boolean, sourceEffectFor: (cardId: string) => "drawn" | "removed" | "none", candidateIds?: string[]|null, forecast?: boolean, invoke: () => Promise<void> }} options */
async function runCardsMovement({
  params,
  command,
  cardsId,
  source,
  destinations,
  chat,
  sourceEffectFor,
  candidateIds = null,
  forecast = false,
  invoke
}) {
  if (typeof sourceEffectFor !== "function") {
    throw new Error(`runCardsMovement: ${command} passed no sourceEffectFor classifier`);
  }
  if (destinations.some(({ stateFor }) => typeof stateFor !== "function")) {
    throw new Error(`runCardsMovement: ${command} passed a destination with no stateFor classifier`);
  }
  const sourceProjection = (stack, removed, drawnSet, remaining = countStoredAvailableCards(stack)) => ({
    cardsId: stack?.id ?? null,
    cardsName: stack?.name ?? null,

    remaining,

    ...capCardIds("removedCardIds", removed, CARDS_RECALL_ID_CAP),

    ...capCardIds("drawnCardIds", drawnSet, CARDS_RECALL_ID_CAP)
  });

  const sourceBefore = snapshotCardRows(source);
  const candidates = candidateIds ?? cardsMovementCandidateIds(source, sourceBefore);
  const plan = destinations.map(({ stack, expected, roleFor = null, stateFor }) => ({
    stack,
    expected,
    roleFor,
    stateFor,
    before: snapshotCardRows(stack),
    beforeState: snapshotCardMovementRows(stack)
  }));

  if (isDryRun(params)) {
    const preview = forecast
      ? forecastCardsPass(source, candidates, sourceEffectFor, sourceBefore, plan[0])
      : null;
    return dryRunResponse({
      cardsId,
      complete: true,
      ...actionMarkers("not-executed", "not-executed"),
      from: preview
        ? sourceProjection(
            source,
            preview.source.removedCardIds,
            preview.source.drawnCardIds,
            preview.source.remaining
          )
        : sourceProjection(source, [], []),
      ...capMovementDestinations(
        plan.map(({ stack, expected }, index) => ({
          cardsId: stack?.id ?? null,
          cardsName: stack?.name ?? null,
          expected,
          receivedCardIds: preview?.destinations[index]?.receivedCardIds ?? [],
          returnedCardIds: preview?.destinations[index]?.returnedCardIds ?? [],
          indeterminateCardIds: preview?.destinations[index]?.indeterminateCardIds ?? []
        }))
      ),
      chatNotification: actionChatNotification(false, "not-requested")
    });
  }

  let error = null;
  try {
    await invoke();
  } catch (caught) {
    error = caught;
  }

  const sourceAfter = rereadCardStack(source);
  const sourceAfterRows = snapshotCardRows(sourceAfter);
  const ledger = classifyCardMovements({
    candidateIds: candidates,
    sourceEffectFor,
    sourceBefore,
    sourceAfter: sourceAfterRows,
    destinations: plan.map(({ stack, expected, roleFor, stateFor, before, beforeState }) => {
      const afterStack = rereadCardStack(stack);
      return {
        expected,
        roleFor,
        stateFor,
        before,
        beforeState,
        after: snapshotCardRows(afterStack),
        afterState: snapshotCardMovementRows(afterStack)
      };
    })
  });

  const entries = plan.map(({ stack, expected }, index) => {
    const rows = ledger.perDestination[index];
    return {
      cardsId: stack?.id ?? null,
      cardsName: stack?.name ?? null,
      expected,
      ...rows,

      accounted: rows.receivedCardIds.length + rows.returnedCardIds.length + rows.indeterminateCardIds.length
    };
  });
  const expectedTotal = entries.reduce((total, entry) => total + entry.expected, 0);

  const attributableTotal = entries.reduce(
    (total, entry) => total + Math.min(entry.accounted, entry.expected),
    0
  );
  const indeterminateTotal = entries.reduce((total, entry) => total + entry.indeterminateCardIds.length, 0);
  const invalidStateTotal = entries.reduce((total, entry) => total + entry.invalidStateCardIds.length, 0);
  const anythingLanded = ledger.witnessed;
  const body = {
    cardsId,
    from: sourceProjection(sourceAfter, ledger.removedCardIds, ledger.drawnCardIds),
    ...capMovementDestinations(entries)
  };

  if (!error) {
    const shortfall = entries.filter((entry) => entry.accounted < entry.expected);

    if (
      shortfall.length ||
      invalidStateTotal ||
      ledger.unsourcedCardIds.length ||
      ledger.strandedCardIds.length
    ) {
      const missing = [];
      if (shortfall.length) {
        missing.push(
          `only ${attributableTotal} of ${expectedTotal} expected card movement(s) arrived at the destination(s)`
        );
      }
      if (ledger.strandedCardIds.length) {
        missing.push(
          `${ledger.strandedCardIds.length} card(s) carry a SOURCE-side write of this movement that NO destination accounts for (details.from.strandedCardIds) — the source gave the card up and nothing received it`
        );
      }
      if (ledger.unsourcedCardIds.length) {
        missing.push(
          `${ledger.unsourcedCardIds.length} card(s) that DID move show no matching SOURCE-side write (details.from.unconfirmedCardIds) — a moved card must be flagged drawn in the source or deleted from it, so the source is now offering a card that already lives somewhere else and the next movement of it collides on its duplicate _id`
        );
      }
      if (invalidStateTotal) {
        missing.push(
          `${invalidStateTotal} destination card row(s) appeared or changed under the expected _id but stored the WRONG read-only movement state (details.to[].invalidStateCardIds): origin/drawn no longer match the branch Foundry planned before its mutable action/document hooks ran`
        );
      }

      const landed = [];
      if (ledger.removedCardIds.length) {
        const stranded = ledger.strandedCardIds.filter((cardId) => ledger.removedCardIds.includes(cardId));
        const sampleCap = 10;
        const sample =
          stranded.length > sampleCap
            ? `${stranded.slice(0, sampleCap).join(", ")} … (${sampleCap} of ${stranded.length} shown — see details.from.removedCardIds)`
            : stranded.join(", ");
        landed.push(
          `${ledger.removedCardIds.length} card(s) WERE DELETED from the source (details.from.removedCardIds)` +
            (stranded.length
              ? `, and ${stranded.length} of them arrived in NO destination (${sample}) — an embedded Card lives only in its parent stack, so unless another stack still holds that _id (a dealt card's origin deck keeps its own row, left stranded drawn:true), ${stranded.length === 1 ? "that card no longer exists anywhere" : "those cards no longer exist anywhere"}: check with \`cards card list\``
              : "")
        );
      }
      if (ledger.drawnCardIds.length) {
        landed.push(
          `${ledger.drawnCardIds.length} card(s) WERE flagged drawn:true in the source (details.from.drawnCardIds), so the source is holding them unavailable`
        );
      }
      const vetoRuledOut =
        "so a dealCards/passCards hook veto provably did NOT fire (a veto returns before EVERY write) and the chat notification WAS posted";

      const sourceLanded = ledger.removedCardIds.length > 0 || ledger.drawnCardIds.length > 0;
      const hookMutationCause = invalidStateTotal
        ? "A dealCards/passCards hook, a preCreateCard/preUpdateCard hook, or a concurrent writer changed origin/drawn in the movement window; row appearance alone is not a complete movement."
        : null;
      const cause =
        hookMutationCause ??
        (sourceLanded
          ? `Foundry drops a refused document — or a refused ROW of a batch — silently and resolves. The SOURCE side of this movement DID land — ${landed.join(", and ")} — ${vetoRuledOut}.`
          : anythingLanded
            ? `Foundry drops a refused document — or a refused ROW of a batch — silently and resolves. Some cards DID arrive (details.to), ${vetoRuledOut}.`
            : "Foundry drops a refused document — or a refused ROW of a batch — silently and resolves, and a dealCards/passCards hook veto returns BEFORE any write with no error and no chat message at all.");
      throw createBridgeError(
        ERROR_CODES.INTERNAL_ERROR,
        `${command} on Cards ${cardsId} resolved, but a re-read of STORED state shows ${missing.join(", and ")}. ${cause} details.to reports what each destination actually received or had returned to it, details.from what left the source. Re-read them with cards.get / cards.card.list before retrying. ${CARDS_VETO_REMEDY}`,
        {
          ...body,
          from: {
            ...body.from,
            ...capCardIds("unconfirmedCardIds", ledger.unsourcedCardIds, CARDS_RECALL_ID_CAP),

            ...capCardIds("strandedCardIds", ledger.strandedCardIds, CARDS_RECALL_ID_CAP)
          },
          ...actionMarkers(anythingLanded ? "partial" : "unknown", "confirmed"),

          chatNotification: actionChatNotification(chat, anythingLanded ? "dispatched" : "unknown")
        }
      );
    }
    if (indeterminateTotal > 0) {
      return {
        ...body,
        complete: false,
        ...actionMarkers(anythingLanded ? "partial" : "unknown", "confirmed"),
        chatNotification: actionChatNotification(chat, anythingLanded ? "dispatched" : "unknown")
      };
    }
    return {
      ...body,
      complete: true,
      ...actionMarkers("committed", "confirmed"),
      chatNotification: actionChatNotification(chat, "dispatched")
    };
  }

  return {
    ...body,
    from: {
      ...body.from,
      ...(ledger.unsourcedCardIds.length
        ? capCardIds("unconfirmedCardIds", ledger.unsourcedCardIds, CARDS_RECALL_ID_CAP)
        : {}),
      ...(ledger.strandedCardIds.length
        ? capCardIds("strandedCardIds", ledger.strandedCardIds, CARDS_RECALL_ID_CAP)
        : {})
    },
    complete: false,
    ...actionMarkers(anythingLanded ? "partial" : "unknown", "best-effort"),

    chatNotification: actionChatNotification(chat, "not-dispatched"),
    failure: toFailureSummary(error)
  };
}

/**
 * @param {ReturnType<typeof describeCardsRecall>} plan
 * @returns {Map<string|null, Set<string>>}
 */
function snapshotRecallReturnRows(plan) {
  const perOrigin = new Map();
  for (const entry of plan.returned) {
    const origin = getCardsCollection().get?.(entry.cardsId) ?? null;
    const rows = origin ? snapshotCardRows(origin) : new Map();
    perOrigin.set(entry.cardsId, new Set(entry.cardIds.filter((cardId) => rows.get(cardId) === true)));
  }
  return perOrigin;
}

/**
 * @param {ReturnType<typeof describeCardsRecall>} plan
 * @param {ReturnType<typeof confirmCardsRecall>} confirmation
 * @param {Map<string, boolean>} rowsBefore
 * @param {Map<string|null, Set<string>>} returnRowsBefore
 */
function summarizeRecallProgress(plan, confirmation, rowsBefore, returnRowsBefore) {
  const ownDrawnBefore = plan.ownDrawnResetCardIds.filter((cardId) => rowsBefore.get(cardId) === true).length;
  const flat = (entries) => entries.reduce((total, entry) => total + entry.cardIds.length, 0);

  const returnExpected = plan.returned.reduce(
    (total, entry) => total + (returnRowsBefore.get(entry.cardsId)?.size ?? 0),
    0
  );
  const returnRemaining = confirmation.notReturned.reduce((total, entry) => {
    const population = returnRowsBefore.get(entry.cardsId) ?? new Set();
    return total + entry.cardIds.filter((cardId) => population.has(cardId)).length;
  }, 0);

  const expected =
    flat(plan.reclaimed) +
    returnExpected +
    ownDrawnBefore +
    (flat(plan.returned) + plan.destroyedCardIds.length);
  const remaining =
    flat(confirmation.reclaimedRemaining) +
    returnRemaining +
    confirmation.ownRowsStillDrawn.length +
    confirmation.notRemovedCardIds.length;
  return { expected, remaining, landed: Math.max(expected - remaining, 0) };
}

export function createCardsHandlers() {
  return {
    async "cards.list"(params) {
      const stacks = filterByName(Array.from(getCardsCollection()), params.name);
      const { page, total, hasMore } = paginate(stacks, params);
      return {
        cards: page.map((stack) => serializeCardsSummary(stack)),
        total,
        hasMore
      };
    },

    async "cards.get"(params) {
      const stack = getCardsById(params.cardsId);
      return {
        cards: serializeCards(stack, { ownership: true })
      };
    },

    async "cards.get-many"(params) {
      const ids = params.ids;
      if (ids.length > BATCH_GET_MAX_IDS) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `cards.get-many accepts at most ${BATCH_GET_MAX_IDS} ids`,
          { max: BATCH_GET_MAX_IDS, received: ids.length }
        );
      }

      const stacks = ids.map((id) => serializeCards(getCardsById(id), { ownership: true }));
      return { cards: stacks };
    },

    async "cards.create"(params) {
      const data = prepareCardsCreateData(params.data);

      const preview = previewCardsCreate(cloneValue(data));
      if (isDryRun(params)) {
        return dryRunResponse({ cards: normalizePreviewCards(serializeCards(preview)) });
      }

      const stack = await createCards(data);
      return { cards: serializeCards(stack) };
    },

    async "cards.update"(params) {
      return cardsQueue.run(async () => {
        const stack = getCardsById(params.cardsId);

        const patch = canonicalizeFilePathFields(params.patch, "Cards");
        if (isDryRun(params)) {
          const preview = await previewDocumentUpdate(stack, patch);
          return dryRunResponse({ cards: serializeCards(preview) });
        }

        const requestedPatch = cloneValue(patch);
        const updated = await stack.update(patch, { diff: true, render: true });
        if (!updated) {
          await assertTableFamilyUpdateCommitted({
            document: stack,
            patch: requestedPatch,
            subject: `Cards ${stack.id ?? params.cardsId}`,
            hookName: "preUpdateCards",
            details: { cardsId: stack.id ?? params.cardsId },
            remedy: CARDS_VETO_REMEDY
          });
        }
        return { cards: serializeCards(stack) };
      });
    },

    async "cards.clone"(params) {
      return cardsQueue.run(async () => {
        const stack = getCardsById(params.cardsId);
        const patch = canonicalizeFilePathFields(params.patch ?? {}, "Cards");

        await assertClonePatchValid(stack, patch);

        const cardsCopy = describeCardsClone(stack);

        const clone = await cloneDocument(stack, patch, { dryRun: isDryRun(params) });
        if (isDryRun(params)) {
          return dryRunResponse({
            cards: normalizePreviewCards(serializeCards(clone)),
            cardsCopy
          });
        }
        return { cards: serializeCards(clone), cardsCopy };
      });
    },

    async "cards.delete"(params) {
      return cardsQueue.run(async () => {
        const stack = getCardsById(params.cardsId);
        const id = stack.id ?? params.cardsId;
        const plan = describeCardsRecall(stack);

        if (isDryRun(params)) {
          return dryRunResponse({
            id,
            deleted: false,

            recall: recallBody(plan, "not-executed", "prospective"),

            chatNotification: { requested: false, status: "not-requested" }
          });
        }

        let deletedDocument;
        try {
          deletedDocument = await deleteDocument(stack);
        } catch (error) {
          throw deleteFailureError(error, id, plan);
        }
        if (!deletedDocument) {
          const vetoConfirmation = confirmCardsRecall(plan, stack);
          throw createBridgeError(
            ERROR_CODES.INTERNAL_ERROR,
            `Cards ${id} was NOT deleted: Foundry resolved the delete without removing the document, which means a module's preDeleteCards hook or a core _preDelete refused it. The stack still exists — but this is NOT a no-op: Cards#_preDelete awaits this.recall() BEFORE the veto is evaluated, so the recall HAS already run, moving cards between stacks and clearing drawn flags. details.recall enumerates the affected stacks and card ids, and details.recall.status reports whether a re-read of stored state confirms those writes. Re-read them with cards.get before retrying. ${CARDS_VETO_REMEDY}`,
            {
              cardsId: id,

              recall: recallBody(
                plan,
                vetoConfirmation.confirmed ? "confirmed" : "unconfirmed",
                "prospective",
                vetoConfirmation
              ),

              chatNotification: {
                requested: true,
                status: vetoConfirmation.confirmed ? "dispatched" : "unknown"
              }
            }
          );
        }

        const confirmation = confirmCardsRecall(plan, stack);
        return {
          id,
          deleted: true,

          recall: recallBody(
            plan,
            confirmation.confirmed ? "confirmed" : "unconfirmed",
            "applied",
            confirmation
          ),
          chatNotification: {
            requested: true,

            status: confirmation.confirmed ? "dispatched" : "unknown"
          }
        };
      });
    },

    async "cards.card.list"(params) {
      const stacks =
        params.cardsId != null
          ? [getCardsById(params.cardsId)]
          : Array.from(getCardsCollection()).sort(compareCardStacks);

      const ordered = [];
      const parentOf = new Map();
      for (const stack of stacks) {
        for (const card of stack.cards ? Array.from(stack.cards) : []) {
          ordered.push(card);
          parentOf.set(card, stack);
        }
      }

      const filtered = filterByName(ordered, params.name, { nameOf: storedCardName });
      const { page, total, hasMore } = paginate(filtered, params);
      return {
        ...(params.cardsId != null ? { cardsId: params.cardsId } : {}),
        cards: page.map((card) => serializeCardSummary(card, parentOf.get(card))),
        total,
        hasMore
      };
    },

    async "cards.card.get"(params) {
      const { card } = getCardById(params.cardsId, params.cardId);

      return { cardsId: params.cardsId, card: serializeCard(card) };
    },

    async "cards.card.create"(params) {
      return cardsQueue.run(async () => {
        const stack = getCardsById(params.cardsId);

        const data = canonicalizeCardPayload(params.data);

        const preview = previewCardCreate(stack, cloneValue(data));
        if (isDryRun(params)) {
          return dryRunResponse({ cardsId: params.cardsId, card: serializeCard(preview) });
        }

        const card = await createCard(stack, data);
        return { cardsId: params.cardsId, card: serializeCard(card) };
      });
    },

    async "cards.card.update"(params) {
      return cardsQueue.run(async () => {
        const { stack, card } = getCardById(params.cardsId, params.cardId);
        const patch = canonicalizeCardPayload(params.patch);

        assertCardFacesValid(stack, patch);
        if (isDryRun(params)) {
          const preview = await previewDocumentUpdate(card, patch);
          return dryRunResponse({ cardsId: params.cardsId, card: serializeCard(preview) });
        }

        const requestedPatch = cloneValue(patch);
        const { card: updated, committed } = await updateCard(stack, params.cardId, patch);
        if (!committed) {
          await assertTableFamilyUpdateCommitted({
            document: updated ?? card,
            patch: requestedPatch,
            subject: `Card ${params.cardId} of Cards ${params.cardsId}`,
            hookName: "preUpdateCard",
            details: { cardsId: params.cardsId, cardId: params.cardId },
            remedy: CARDS_VETO_REMEDY
          });
        }
        return { cardsId: params.cardsId, card: serializeCard(updated ?? card) };
      });
    },

    async "cards.card.clone"(params) {
      return cardsQueue.run(async () => {
        const { stack, card } = getCardById(params.cardsId, params.cardId);
        const patch = canonicalizeCardPayload(params.patch ?? {});

        assertCardFacesValid(stack, patch);

        await assertClonePatchValid(card, patch);

        const clone = await cloneDocument(card, patch, { dryRun: isDryRun(params) });
        const projection = serializeCard(clone);

        const body = {
          cardsId: params.cardsId,
          card: projection,
          recallDeletesCopy: recallDeletesCardCopy(stack, projection.origin ?? null)
        };
        return isDryRun(params) ? dryRunResponse(body) : body;
      });
    },

    async "cards.card.delete"(params) {
      return cardsQueue.run(async () => {
        const { stack } = getCardById(params.cardsId, params.cardId);
        if (isDryRun(params)) {
          return dryRunResponse({ cardsId: params.cardsId, id: params.cardId, deleted: false });
        }
        const { committed } = await deleteCard(stack, params.cardId);

        assertTableFamilyDeleteCommitted({
          committed,
          subject: `Card ${params.cardId} of Cards ${params.cardsId}`,
          hookName: "preDeleteCard",
          details: { cardsId: params.cardsId, cardId: params.cardId },
          remedy: CARDS_VETO_REMEDY
        });

        return { cardsId: params.cardsId, id: params.cardId, deleted: true };
      });
    },

    async "cards.shuffle"(params) {
      return cardsQueue.run(async () => {
        const stack = getCardsById(params.cardsId);
        const cardsId = stack.id ?? params.cardsId;
        const chat = params.chat ?? true;

        assertCardsMethod(stack, "shuffle", "cards.shuffle");

        if (isDryRun(params)) {
          return dryRunResponse({
            cardsId,
            complete: true,
            ...actionMarkers("not-executed", "not-executed"),
            shuffle: { count: snapshotCardSorts(stack).size, orderChanged: false },
            chatNotification: actionChatNotification(false, "not-requested")
          });
        }

        const before = snapshotCardSorts(stack);
        let error = null;
        try {
          await shuffleCardStack(stack, { chat });
        } catch (caught) {
          error = caught;
        }
        const after = snapshotCardSorts(rereadCardStack(stack));

        const { permutationIntact, changedCardIds, count } = evaluateCardShuffle(before, after);
        const orderChanged = changedCardIds.length > 0;

        const shuffle = { count, orderChanged };

        if (error) {
          if (!orderChanged) {
            throw error;
          }
          return {
            cardsId,
            shuffle,
            complete: false,
            ...actionMarkers(permutationIntact ? "committed" : "partial", "confirmed"),
            chatNotification: actionChatNotification(chat, "not-dispatched"),
            failure: toFailureSummary(error)
          };
        }

        if (!permutationIntact) {
          throw createBridgeError(
            ERROR_CODES.INTERNAL_ERROR,
            `cards.shuffle on Cards ${cardsId} resolved, but the stored sort order is not the 0..${before.size - 1} permutation Cards#shuffle writes over the rows it enumerated — some rows kept their previous sort (${changedCardIds.length} of the ${before.size} enumerated row(s) are witnessed as rewritten), which is how Foundry reports a row of a batch it silently refused. Re-read the stack with cards.card.list and shuffle again. ${CARDS_VETO_REMEDY}`,
            {
              cardsId,
              shuffle,
              ...actionMarkers("partial", "confirmed"),
              chatNotification: actionChatNotification(chat, "dispatched")
            }
          );
        }

        const committed = orderChanged || before.size <= 1;
        return {
          cardsId,
          shuffle,
          complete: committed,
          ...actionMarkers(committed ? "committed" : orderChanged ? "partial" : "unknown", "confirmed"),

          chatNotification: actionChatNotification(chat, "dispatched")
        };
      });
    },

    async "cards.reset"(params) {
      return cardsQueue.run(async () => {
        const stack = getCardsById(params.cardsId);
        const cardsId = stack.id ?? params.cardsId;
        const chat = params.chat ?? true;

        assertCardsMethod(stack, "recall", "cards.reset");

        const plan = describeCardsRecall(stack);

        if (isDryRun(params)) {
          return dryRunResponse({
            cardsId,
            complete: true,
            ...actionMarkers("not-executed", "not-executed"),
            recall: { ...recallLists(plan), status: "not-executed" },
            chatNotification: actionChatNotification(false, "not-requested")
          });
        }

        const rowsBefore = snapshotCardRows(stack);
        const returnRowsBefore = snapshotRecallReturnRows(plan);

        let error = null;
        try {
          await recallCardStack(stack, { chat });
        } catch (caught) {
          error = caught;
        }

        const confirmation = confirmCardsRecall(plan, rereadCardStack(stack));
        const progress = summarizeRecallProgress(plan, confirmation, rowsBefore, returnRowsBefore);

        const nothingLanded = progress.expected > 0 && progress.landed === 0;

        const resolvedChatStatus = plan.type === "deck" || !nothingLanded ? "dispatched" : "unknown";

        if (error) {
          const stable = plan.type === "deck";

          if (progress.landed === 0 && (stable || progress.expected === 0)) {
            throw error;
          }

          const committed = stable && progress.remaining === 0;
          return {
            cardsId,
            complete: false,
            ...actionMarkers(
              committed ? "committed" : progress.landed === 0 ? "unknown" : "partial",
              stable ? "confirmed" : "best-effort"
            ),
            recall: {
              ...recallLists(plan),

              status: stable ? (committed ? "confirmed" : "unconfirmed") : "not-verified",
              ...(stable ? unconfirmedRecallBody(confirmation) : {})
            },
            chatNotification: actionChatNotification(chat, "not-dispatched"),
            failure: toFailureSummary(error)
          };
        }

        if (!confirmation.confirmed && progress.remaining > 0) {
          throw createBridgeError(
            ERROR_CODES.INTERNAL_ERROR,
            `cards.reset on Cards ${cardsId} resolved, but a re-read of STORED state does not show the recall's writes (${progress.remaining} of ${progress.expected} expected change(s) missing). Foundry drops a refused row of a batch silently and resolves, a returnCards hook veto (hand/pile only) returns BEFORE any write with no error and no chat message, and a concurrent writer can remove a planned origin row. details.recall.unconfirmed names the stacks and card ids whose rows are missing or still hold the old state. Re-read them with cards.get / cards.card.list before retrying; disable a vetoing module or stop concurrent Cards mutations as applicable. There is no force flag for this write.`,
            {
              cardsId,
              ...actionMarkers(nothingLanded ? "unknown" : "partial", "confirmed"),
              recall: {
                ...recallLists(plan),
                status: "unconfirmed",
                ...unconfirmedRecallBody(confirmation)
              },
              chatNotification: actionChatNotification(chat, resolvedChatStatus)
            }
          );
        }

        return {
          cardsId,
          complete: true,

          ...actionMarkers("committed", "confirmed"),
          recall: {
            ...recallLists(plan),

            status: confirmation.confirmed ? "confirmed" : "unconfirmed",
            ...unconfirmedRecallBody(confirmation)
          },

          chatNotification: actionChatNotification(chat, resolvedChatStatus)
        };
      });
    },

    async "cards.deal"(params) {
      return cardsQueue.run(async () => {
        const stack = getCardsById(params.cardsId);
        const cardsId = stack.id ?? params.cardsId;
        const count = params.count ?? 1;
        const chat = params.chat ?? true;
        const how = resolveCardDrawMode(params.how);

        assertCardsMethod(stack, "deal", "cards.deal");
        const targets = resolveCardsActionTargets(stack, params.to, {
          param: "to",
          role: "destination"
        });

        assertCardsAvailable(stack, count * targets.length, "cards.deal");
        assertCardsDealCannotCollide(stack, targets, count);

        return runCardsMovement({
          params,
          command: "cards.deal",
          cardsId,
          source: stack,

          destinations: targets.map((target) => {
            const { stateFor } = cardsDestinationPlan(stack, target, { deal: true });
            return { stack: target, expected: count, stateFor };
          }),
          chat,

          sourceEffectFor: cardsSourceEffects(stack, { copyIntoDeck: false }),
          invoke: () => dealCardsFrom(stack, { to: targets, count, how, chat })
        });
      });
    },

    async "cards.draw"(params) {
      return cardsQueue.run(async () => {
        const stack = getCardsById(params.cardsId);
        const cardsId = stack.id ?? params.cardsId;
        const count = params.count ?? 1;
        const chat = params.chat ?? true;
        const how = resolveCardDrawMode(params.how);

        assertCardsMethod(stack, "draw", "cards.draw");
        const [source] = resolveCardsActionTargets(stack, [params.from], {
          param: "from",
          role: "source"
        });

        assertCardsMethod(source, "pass", "cards.draw");

        assertCardsAvailable(source, count, "cards.draw");

        return runCardsMovement({
          params,
          command: "cards.draw",
          cardsId,
          source,

          destinations: [{ stack, expected: count, ...cardsDestinationPlan(source, stack) }],
          chat,

          sourceEffectFor: cardsSourceEffects(source, { copyIntoDeck: stack?.type === "deck" }),
          invoke: () => drawCardsInto(stack, { from: source, count, how, chat })
        });
      });
    },

    async "cards.pass"(params) {
      return cardsQueue.run(async () => {
        const stack = getCardsById(params.cardsId);
        const cardsId = stack.id ?? params.cardsId;
        const chat = params.chat ?? true;

        assertCardsMethod(stack, "pass", "cards.pass");
        const [target] = resolveCardsActionTargets(stack, [params.to], {
          param: "to",
          role: "destination"
        });

        const cardIds = params.cardIds;
        if (cardIds.length > CARDS_PASS_MAX_IDS) {
          throw createBridgeError(
            ERROR_CODES.INVALID_PARAMS,
            `cards.pass accepts at most ${CARDS_PASS_MAX_IDS} card ids`,
            { max: CARDS_PASS_MAX_IDS, received: cardIds.length }
          );
        }

        const seenCardIds = new Set();
        const duplicateCardIds = new Set();
        for (const cardId of cardIds) {
          if (seenCardIds.has(cardId)) duplicateCardIds.add(cardId);
          else seenCardIds.add(cardId);
        }
        const duplicates = [...duplicateCardIds];
        if (duplicates.length) {
          throw createBridgeError(
            ERROR_CODES.INVALID_PARAMS,
            `--card-ids names the same card more than once (${duplicates.join(", ")}). Foundry would try to create that id twice in one batch and the whole pass would fail.`,
            { cardsId, cardIds, duplicates }
          );
        }

        const alreadyDrawn = [];
        const named = [];
        for (const cardId of cardIds) {
          const { card } = getCardById(cardsId, cardId);
          named.push({ cardId, card });

          if (stack.type === "deck" && cardIsHome(stack, card) && card.drawn) {
            alreadyDrawn.push(cardId);
          }
        }
        if (alreadyDrawn.length) {
          throw createBridgeError(
            ERROR_CODES.INVALID_PARAMS,
            `Cards ${cardsId} is a deck and ${alreadyDrawn.length === 1 ? "this card has" : "these cards have"} already been drawn: ${alreadyDrawn.join(", ")}. Foundry refuses to pass a drawn deck card (it is already somewhere else); recall the deck with \`cards reset\` first, or pass a card that is still available.`,
            { cardsId, alreadyDrawnCardIds: alreadyDrawn }
          );
        }

        const sourceEffectFor = cardsSourceEffects(stack, { copyIntoDeck: target?.type === "deck" });

        const destinationPlan = cardsDestinationPlan(stack, target);
        const { roleFor } = destinationPlan;

        assertCardsPassCannotCollide({
          source: stack,
          target,
          cardIds: named.map(({ cardId }) => cardId),
          roleFor,
          sourceEffectFor
        });
        return runCardsMovement({
          params,
          command: "cards.pass",
          cardsId,
          source: stack,
          destinations: [
            {
              stack: target,
              expected: cardIds.length,
              ...destinationPlan
            }
          ],
          chat,
          sourceEffectFor,

          candidateIds: named.map(({ cardId }) => cardId),
          forecast: true,
          invoke: () => passCardsTo(stack, { to: target, cardIds, chat })
        });
      });
    }
  };
}
