import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";
import { canonicalizeFilePathFields } from "./file-access.js";
import { storedCardDrawn } from "./serializers.js";

import { getCardsCollection } from "./game-collections.js";
import {
  createWorldDocument,
  getCreateResult,
  previewDocumentCreate,
  resolveEmbeddedDocumentClass,
  resolveWorldDocumentClass
} from "./world-docs.js";

export const CARDS_VETO_REMEDY =
  "There is no force flag for a world-side veto — disable the module that vetoes this cards write (or make the change from Foundry's Cards sidebar) and retry.";

export function getCardsById(cardsId) {
  const cards = getCardsCollection().get?.(cardsId) ?? null;
  if (!cards) {
    throw createBridgeError(
      ERROR_CODES.CARDS_NOT_FOUND,
      `Cards ${cardsId} was not found; use cards.list to find valid ids`,
      { cardsId }
    );
  }
  return cards;
}

export async function createCards(data) {
  return createWorldDocument("Cards", data);
}

export function previewCardsCreate(data) {
  return previewDocumentCreate(resolveWorldDocumentClass("Cards"), data);
}

/** @param {any} data */
export function canonicalizeCardPayload(data) {
  if (!data || typeof data !== "object") {
    return data;
  }
  const canonical = canonicalizeFilePathFields(data, "Card");
  if (!Array.isArray(canonical.faces)) {
    return canonical;
  }
  const faces = canonical.faces.map((face) => canonicalizeFilePathFields(face, "CardFace"));
  const facesChanged = faces.some((face, index) => face !== canonical.faces[index]);
  return facesChanged ? { ...canonical, faces } : canonical;
}

export function prepareCardsCreateData(data) {
  if (!data || typeof data !== "object") {
    return data;
  }
  const canonical = canonicalizeFilePathFields(data, "Cards");
  if (!Array.isArray(canonical.cards)) {
    return canonical;
  }
  return { ...canonical, cards: canonical.cards.map((card) => canonicalizeCardPayload(card)) };
}

export function getCardById(cardsId, cardId) {
  const stack = getCardsById(cardsId);
  const card = stack.cards?.get?.(cardId) ?? null;
  if (!card) {
    throw createBridgeError(
      ERROR_CODES.CARD_NOT_FOUND,
      `Card ${cardId} was not found on Cards ${cardsId}; use cards.card.list to find valid ids`,
      { cardsId, cardId }
    );
  }
  return { stack, card };
}

export async function createCard(stack, data) {
  if (typeof stack?.createEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Card create API is not available");
  }
  const cards = await stack.createEmbeddedDocuments("Card", [data], { render: true });
  return getCreateResult(cards, "Card creation returned no document");
}

export async function updateCard(stack, cardId, patch) {
  if (typeof stack?.updateEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Card update API is not available");
  }

  const updated = await stack.updateEmbeddedDocuments("Card", [{ _id: cardId, ...patch }], {
    diff: true,
    render: true
  });
  return {
    card: stack.cards?.get?.(cardId) ?? null,
    committed: Array.isArray(updated) ? updated.length > 0 : Boolean(updated)
  };
}

export async function deleteCard(stack, cardId) {
  if (typeof stack?.deleteEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Card delete API is not available");
  }
  const deleted = await stack.deleteEmbeddedDocuments("Card", [cardId], { render: true });
  return { committed: Array.isArray(deleted) ? deleted.length > 0 : Boolean(deleted) };
}

export function previewCardCreate(stack, data) {
  return previewDocumentCreate(resolveEmbeddedDocumentClass(stack?.cards, "Card"), data, {
    parent: stack
  });
}

function storedCardOrigin(card) {
  const source = card?._source;
  if (source && typeof source === "object" && Object.hasOwn(source, "origin")) {
    return source.origin ?? null;
  }
  if (typeof card?.toObject === "function") {
    return card.toObject()?.origin ?? null;
  }
  const live = card?.origin;
  return live && typeof live === "object" ? (live.id ?? null) : (live ?? null);
}

/**
 * @param {any} stack
 * @returns {{ type: string|null, reclaimed: Array<{cardsId: string|null, cardsName: string|null, cardIds: string[]}>, returned: Array<{cardsId: string|null, cardsName: string|null, cardIds: string[]}>, skippedCardIds: string[], destroyedCardIds: string[], ownDrawnResetCardIds: string[], danglingOriginsLeft: Array<{cardsId: string|null, cardsName: string|null, cardIds: string[]}>, originRowsLeftDrawn: Array<{cardsId: string|null, cardsName: string|null, cardIds: string[]}> }}
 */
export function describeCardsRecall(stack) {
  const type = stack?.type ?? null;
  const reclaimed = [];
  const returned = [];
  const skippedCardIds = [];
  const destroyedCardIds = [];
  const ownDrawnResetCardIds = [];
  const danglingOriginsLeft = [];
  const originRowsLeftDrawn = [];
  const ownCards = stack?.cards ? Array.from(stack.cards) : [];

  if (type === "deck") {
    for (const other of getCardsCollection()) {
      if (other === stack) continue;
      const cardIds = [];
      for (const card of other.cards ? Array.from(other.cards) : []) {
        if (card.origin === stack) cardIds.push(card.id ?? card._id ?? null);
      }
      if (cardIds.length) {
        reclaimed.push({ cardsId: other.id ?? null, cardsName: other.name ?? null, cardIds });
      }
    }
    for (const card of ownCards) ownDrawnResetCardIds.push(card.id ?? card._id ?? null);

    const byOriginLeftDrawn = new Map();
    const stackId = stack?.id ?? null;
    for (const card of ownCards) {
      const originId = storedCardOrigin(card);
      if (!originId || originId === stackId) continue;
      const origin = getCardsCollection().get?.(originId) ?? null;
      if (!origin) continue;
      const cardId = card.id ?? card._id ?? null;
      const row = origin.cards?.get?.(cardId) ?? null;
      if (!row) continue;
      const source = typeof row.toObject === "function" ? row.toObject() : row;
      if (!source?.drawn) continue;
      if (!byOriginLeftDrawn.has(originId)) {
        byOriginLeftDrawn.set(originId, {
          cardsId: originId,
          cardsName: origin.name ?? null,
          cardIds: []
        });
      }
      byOriginLeftDrawn.get(originId).cardIds.push(cardId);
    }
    originRowsLeftDrawn.push(...byOriginLeftDrawn.values());
  } else {
    const byOrigin = new Map();
    for (const card of ownCards) {
      const cardId = card.id ?? card._id ?? null;
      if (card.isHome || !card.origin) {
        skippedCardIds.push(cardId);
        continue;
      }
      if (card.origin.cards?.get?.(cardId)) {
        const originId = card.origin.id ?? null;
        if (!byOrigin.has(originId)) {
          byOrigin.set(originId, {
            cardsId: originId,
            cardsName: card.origin.name ?? null,
            cardIds: []
          });
        }
        byOrigin.get(originId).cardIds.push(cardId);
      } else {
        destroyedCardIds.push(cardId);
      }
    }
    returned.push(...byOrigin.values());

    const stackId = stack?.id ?? null;
    for (const other of getCardsCollection()) {
      if (other === stack) continue;
      const cardIds = [];
      for (const card of other.cards ? Array.from(other.cards) : []) {
        if (storedCardOrigin(card) === stackId) cardIds.push(card.id ?? card._id ?? null);
      }
      if (cardIds.length) {
        danglingOriginsLeft.push({
          cardsId: other.id ?? null,
          cardsName: other.name ?? null,
          cardIds
        });
      }
    }
  }

  return {
    type,
    reclaimed,
    returned,
    skippedCardIds,
    destroyedCardIds,
    ownDrawnResetCardIds,

    danglingOriginsLeft,

    originRowsLeftDrawn
  };
}

/**
 * @param {ReturnType<typeof describeCardsRecall>} plan
 * @param {any} [stack]
 * @returns {{ confirmed: boolean, reclaimedRemaining: Array<{cardsId: string|null, cardIds: string[]}>, notReturned: Array<{cardsId: string|null, cardIds: string[]}>, ownRowsStillDrawn: string[], notRemovedCardIds: string[] }}
 */
export function confirmCardsRecall(plan, stack = null) {
  const reclaimedRemaining = [];
  const notReturned = [];
  const ownRowsStillDrawn = [];
  const notRemovedCardIds = [];

  for (const entry of plan.reclaimed) {
    const other = getCardsCollection().get?.(entry.cardsId) ?? null;
    if (!other) continue;
    const remaining = entry.cardIds.filter((cardId) => Boolean(other.cards?.get?.(cardId)));
    if (remaining.length) reclaimedRemaining.push({ cardsId: entry.cardsId, cardIds: remaining });
  }

  for (const entry of plan.returned) {
    const origin = getCardsCollection().get?.(entry.cardsId) ?? null;
    if (!origin) {
      notReturned.push({ cardsId: entry.cardsId, cardIds: [...entry.cardIds] });
      continue;
    }
    const stuck = entry.cardIds.filter((cardId) => {
      const row = origin.cards?.get?.(cardId) ?? null;

      if (!row) return true;
      const source = typeof row.toObject === "function" ? row.toObject() : row;
      return Boolean(source?.drawn);
    });
    if (stuck.length) notReturned.push({ cardsId: entry.cardsId, cardIds: stuck });
  }

  const targetId = stack?.id ?? null;
  const target = targetId ? (getCardsCollection().get?.(targetId) ?? null) : null;
  if (target) {
    for (const cardId of plan.ownDrawnResetCardIds) {
      const row = target.cards?.get?.(cardId) ?? null;
      if (!row) continue;
      const source = typeof row.toObject === "function" ? row.toObject() : row;
      if (source?.drawn) ownRowsStillDrawn.push(cardId);
    }
    for (const cardId of [...plan.returned.flatMap((entry) => entry.cardIds), ...plan.destroyedCardIds]) {
      if (target.cards?.get?.(cardId)) notRemovedCardIds.push(cardId);
    }
  }

  return {
    confirmed:
      reclaimedRemaining.length === 0 &&
      notReturned.length === 0 &&
      ownRowsStillDrawn.length === 0 &&
      notRemovedCardIds.length === 0,
    reclaimedRemaining,
    notReturned,
    ownRowsStillDrawn,
    notRemovedCardIds
  };
}

export function describeCardsClone(stack) {
  const cards = stack?.cards ? Array.from(stack.cards) : [];
  const countsUnreturnable = (stack?.type ?? null) !== "deck";
  let drawnCleared = 0;
  let unreturnableCards = 0;
  for (const card of cards) {
    const source = typeof card.toObject === "function" ? card.toObject() : card;
    if (source?.drawn) drawnCleared += 1;
    if (!countsUnreturnable) continue;
    const originId = storedCardOrigin(card);

    if (originId && getCardsCollection().get?.(originId)) unreturnableCards += 1;
  }
  return {
    count: cards.length,

    idsReminted: true,
    drawnCleared,
    unreturnableCards
  };
}

/**
 * @param {any} stack
 * @param {string|null} originId
 * @returns {boolean}
 */
export function recallDeletesCardCopy(stack, originId) {
  if (!originId) return false;
  if (stack?.id && originId === stack.id) return false;
  const origin = getCardsCollection().get?.(originId) ?? null;
  if (!origin) return false;
  return (stack?.type ?? null) !== "deck" || (origin?.type ?? null) === "deck";
}

const CARD_DRAW_MODE_BY_NAME = Object.freeze({ top: 0, bottom: 1, random: 2 });

/**
 * @param {string|undefined} how
 * @returns {number}
 */
export function resolveCardDrawMode(how) {
  const mode = CARD_DRAW_MODE_BY_NAME[how ?? "top"];
  if (mode === undefined) {
    throw new Error(`resolveCardDrawMode: unknown draw mode ${JSON.stringify(how)}`);
  }
  return mode;
}

/**
 * @param {any} stack
 * @returns {any[]}
 */
export function liveAvailableCards(stack) {
  const rows = stack?.cards ? Array.from(stack.cards) : [];
  return (stack?.type ?? null) === "deck" ? rows.filter((card) => !card?.drawn) : rows;
}

/** @param {any} stack */
export function countStoredAvailableCards(stack) {
  const rows = stack?.cards ? Array.from(stack.cards) : [];
  if ((stack?.type ?? null) !== "deck") return rows.length;
  return rows.filter((card) => !storedCardDrawn(card)).length;
}

/**
 * @param {any} stack
 * @param {any} card
 */
export function cardIsHome(stack, card) {
  if (typeof card?.isHome === "boolean") return card.isHome;
  if ((stack?.type ?? null) === "deck") return true;
  const origin = card?.origin ?? null;
  return Boolean(origin) && origin === stack;
}

/**
 * @param {any} stack
 * @returns {Map<string, boolean>}
 */
export function snapshotCardRows(stack) {
  const rows = new Map();
  for (const card of stack?.cards ? Array.from(stack.cards) : []) {
    const cardId = card?.id ?? card?._id ?? null;
    if (cardId == null) continue;
    rows.set(cardId, storedCardDrawn(card));
  }
  return rows;
}

/**
 * @param {any} stack
 * @returns {Map<string, {drawn: boolean, origin: string|null}>}
 */
export function snapshotCardMovementRows(stack) {
  const rows = new Map();
  for (const card of stack?.cards ? Array.from(stack.cards) : []) {
    const cardId = card?.id ?? card?._id ?? null;
    if (cardId == null) continue;
    rows.set(cardId, {
      drawn: storedCardDrawn(card),
      origin: storedCardOrigin(card)
    });
  }
  return rows;
}

/**
 * @param {any} stack
 * @returns {Map<string, number|null>}
 */
export function snapshotCardSorts(stack) {
  const sorts = new Map();
  for (const card of stack?.cards ? Array.from(stack.cards) : []) {
    const cardId = card?.id ?? card?._id ?? null;
    if (cardId == null) continue;
    const source = card?._source;
    const stored =
      source && typeof source === "object" && Object.hasOwn(source, "sort")
        ? source.sort
        : typeof card?.toObject === "function"
          ? card.toObject()?.sort
          : card?.sort;
    sorts.set(cardId, typeof stored === "number" ? stored : null);
  }
  return sorts;
}

/**
 * @param {Map<string, number|null>} before
 * @param {Map<string, number|null>} after
 * @returns {{permutationIntact: boolean, changedCardIds: string[], count: number}}
 */
export function evaluateCardShuffle(before, after) {
  const count = after.size;

  const bound = before.size;
  const seen = new Set();
  let permutationIntact = true;
  for (const [cardId, sort] of after) {
    if (!before.has(cardId)) continue;
    if (
      !Number.isInteger(sort) ||
      /** @type {number} */ (sort) < 0 ||
      /** @type {number} */ (sort) >= bound ||
      seen.has(sort)
    ) {
      permutationIntact = false;
      continue;
    }
    seen.add(sort);
  }

  const changedCardIds = [];
  for (const [cardId, sort] of after) {
    if (before.has(cardId) && before.get(cardId) !== sort) changedCardIds.push(cardId);
  }
  return { permutationIntact, changedCardIds, count };
}

/**
 * @param {any} stack
 * @param {string} method
 * @param {string} command
 */
export function assertCardsMethod(stack, method, command) {
  if (typeof stack?.[method] !== "function") {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      `Cards#${method} is not available on this Foundry client, so ${command} cannot run`,
      { method, command }
    );
  }
}

export async function shuffleCardStack(stack, { chat }) {
  assertCardsMethod(stack, "shuffle", "cards.shuffle");
  await stack.shuffle({ chatNotification: chat });
}

export async function recallCardStack(stack, { chat }) {
  assertCardsMethod(stack, "recall", "cards.reset");
  await stack.recall({ chatNotification: chat });
}

export async function dealCardsFrom(stack, { to, count, how, chat }) {
  assertCardsMethod(stack, "deal", "cards.deal");
  await stack.deal(to, count, { how, chatNotification: chat });
}

export async function drawCardsInto(stack, { from, count, how, chat }) {
  assertCardsMethod(stack, "draw", "cards.draw");
  await stack.draw(from, count, { how, chatNotification: chat });
}

export async function passCardsTo(stack, { to, cardIds, chat }) {
  assertCardsMethod(stack, "pass", "cards.pass");
  await stack.pass(to, cardIds, { chatNotification: chat });
}
