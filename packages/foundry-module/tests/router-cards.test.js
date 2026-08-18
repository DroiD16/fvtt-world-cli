import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";

import {
  BATCH_GET_MAX_IDS,
  CARDS_PASS_MAX_IDS,
  CARDS_DELETE_CHAT_STATUSES,
  CARDS_RECALL_CONSEQUENCE_SCOPES,
  CARDS_RECALL_STATUSES,
  ERROR_CODES
} from "../scripts/generated/protocol.js";

import { createCardsDocument, createRequest, installFakeFoundry } from "./helpers/fake-foundry.js";

describe("command router", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  describe("cards.* world-document CRUD", () => {
    const router = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    it("cards.list returns lean rows whose counts use core's TYPE-DEPENDENT availability predicate", async () => {
      const response = await router().route(createRequest("cards.list", {}));
      expect(response.ok).toBe(true);
      const rows = response.result.cards;
      expect(rows.map((row) => row.id)).toEqual(["cards-deck", "cards-hand", "cards-pile"]);

      expect(rows[0]).not.toHaveProperty("cards");

      expect(rows[0]).toMatchObject({ type: "deck", cardCount: 2, drawnCount: 2, availableCount: 0 });

      expect(rows[1]).toMatchObject({ type: "hand", cardCount: 3, drawnCount: 1, availableCount: 3 });
      expect(rows[2]).toMatchObject({ type: "pile", cardCount: 1, drawnCount: 1, availableCount: 1 });
    });

    it("cards.get carries always-on ownership and reads name/back/origin STRICTLY from source", async () => {
      const response = await router().route(createRequest("cards.get", { cardsId: "cards-deck" }));
      expect(response.ok).toBe(true);
      const stack = response.result.cards;
      expect(stack).toMatchObject({ id: "cards-deck", name: "Poker Deck", type: "deck" });
      expect(stack.ownership).toEqual({ default: 0 });
      const ace = stack.cards.find((card) => card.id === "card-ace");

      expect(globalThis.game.cards.get("cards-deck").cards.get("card-ace").name).toBe("Face One");
      expect(globalThis.game.cards.get("cards-deck").cards.get("card-ace").back.img).toBe(
        "worlds/test/deck.webp"
      );
      expect(ace.name).toBe("Stored Ace");
      expect(ace.back).toEqual({ text: "", img: null });

      expect(ace).not.toHaveProperty("img");

      expect(ace).not.toHaveProperty("ownership");
    });

    it("cards.get emits a card's STORED origin id even when it dangles, and never the live document", async () => {
      const stack = createCardsDocument("cards-dangle", {
        name: "Orphaned Hand",
        type: "hand",
        cards: [{ id: "card-lost", name: "Lost", origin: "cardsGoneAAAAAA1" }]
      });
      globalThis.game.cards.set(stack);
      const response = await router().route(createRequest("cards.get", { cardsId: "cards-dangle" }));
      expect(response.ok).toBe(true);

      expect(globalThis.game.cards.get("cards-dangle").cards.get("card-lost").origin).toBeNull();
      expect(response.result.cards.cards[0].origin).toBe("cardsGoneAAAAAA1");
    });

    it("cards.get-many is atomic + order-preserving and carries ownership per stack", async () => {
      const response = await router().route(
        createRequest("cards.get-many", { ids: ["cards-pile", "cards-deck"] })
      );
      expect(response.ok).toBe(true);
      expect(response.result.cards.map((stack) => stack.id)).toEqual(["cards-pile", "cards-deck"]);
      for (const stack of response.result.cards) expect(stack.ownership).toEqual({ default: 0 });

      const missing = await router().route(
        createRequest("cards.get-many", { ids: ["cards-deck", "cards-nope"] })
      );
      expect(missing.ok).toBe(false);
      expect(missing.error.code).toBe(ERROR_CODES.CARDS_NOT_FOUND);
    });

    it("cards.create accepts an inline cards[] array and its dry-run mints no ids", async () => {
      const params = {
        data: {
          name: "New Deck",
          type: "deck",
          img: "worlds/test/new-deck.webp",
          cards: [{ name: "Ace", suit: "S", value: 1 }]
        }
      };
      const dryRun = await router().route(createRequest("cards.create", { ...params, dryRun: true }));
      expect(dryRun.ok).toBe(true);
      expect(dryRun.result.dryRun).toBe(true);
      expect(dryRun.result.cards.id).toBeNull();

      expect(dryRun.result.cards.cards[0].id).toBeNull();
      expect(dryRun.result.cards.cards[0]._id).toBeNull();
      expect(globalThis.Cards.create).not.toHaveBeenCalled();

      const created = await router().route(createRequest("cards.create", params));
      expect(created.ok).toBe(true);
      expect(created.result.cards).toMatchObject({ name: "New Deck", type: "deck" });
      expect(created.result.cards.cards).toHaveLength(1);
      expect(created.result.cards.cards[0].name).toBe("Ace");

      expect(created.result.cards).not.toHaveProperty("ownership");

      expect(params.data).not.toHaveProperty("_stats");
      expect(globalThis.Cards.create.mock.calls.at(-1)[0]).not.toHaveProperty("_stats");
    });

    it("cards.create rejects a payload Foundry would reject, identically on both paths", async () => {
      const params = { data: { name: "Bad", type: "deck", img: "worlds/test/notes.txt" } };
      for (const extra of [{ dryRun: true }, {}]) {
        const response = await router().route(createRequest("cards.create", { ...params, ...extra }));
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      }
    });

    it("cards.update is fields-only and confirms the write against a diff probe", async () => {
      const dryRun = await router().route(
        createRequest("cards.update", { cardsId: "cards-deck", patch: { name: "Renamed" }, dryRun: true })
      );
      expect(dryRun.ok).toBe(true);
      expect(dryRun.result.cards.name).toBe("Renamed");
      expect(globalThis.game.cards.get("cards-deck").name).toBe("Poker Deck");

      const updated = await router().route(
        createRequest("cards.update", { cardsId: "cards-deck", patch: { name: "Renamed", sort: 7 } })
      );
      expect(updated.ok).toBe(true);
      expect(updated.result.cards).toMatchObject({ name: "Renamed", sort: 7 });

      const noop = await router().route(
        createRequest("cards.update", { cardsId: "cards-deck", patch: { name: "Renamed" } })
      );
      expect(noop.ok).toBe(true);

      globalThis.game.cards.get("cards-deck").vetoUpdate = true;
      const vetoed = await router().route(
        createRequest("cards.update", { cardsId: "cards-deck", patch: { name: "Vetoed" } })
      );
      expect(vetoed.ok).toBe(false);
      expect(vetoed.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(vetoed.error.message).toContain("preUpdateCards");
    });

    it("cards.update confirms the immutable request when a preUpdateCards hook removes the field", async () => {
      const stack = globalThis.game.cards.get("cards-deck");
      stack.update = vi.fn(async (changed) => {
        changed._id = stack.id;
        delete changed.name;
        return undefined;
      });

      const response = await router().route(
        createRequest("cards.update", { cardsId: "cards-deck", patch: { name: "Hook removed me" } })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("preUpdateCards");
      expect(response.error.details).toMatchObject({ cardsId: "cards-deck", fields: ["name"] });
      expect(stack._source.name).toBe("Poker Deck");
    });

    it("cards.clone reports what the copy did to the cards, and its preview matches the real call", async () => {
      const dryRun = await router().route(
        createRequest("cards.clone", { cardsId: "cards-hand", dryRun: true })
      );
      expect(dryRun.ok).toBe(true);
      expect(dryRun.result.dryRun).toBe(true);
      expect(dryRun.result.cards.id).toBeNull();

      for (const card of dryRun.result.cards.cards) {
        expect(card.id).toBeNull();
        expect(card._id).toBeNull();
        expect(card.drawn).toBe(false);
      }

      expect(dryRun.result.cardsCopy).toEqual({
        count: 3,
        idsReminted: true,
        drawnCleared: 1,
        unreturnableCards: 2
      });

      const cloned = await router().route(createRequest("cards.clone", { cardsId: "cards-hand" }));
      expect(cloned.ok).toBe(true);
      expect(cloned.result.cardsCopy).toEqual(dryRun.result.cardsCopy);

      const clonedCards = cloned.result.cards.cards;
      expect(clonedCards.map((card) => card.id)).not.toContain("card-ace");
      expect(clonedCards.every((card) => card.drawn === false)).toBe(true);
      expect(clonedCards.filter((card) => card.origin === "cards-deck")).toHaveLength(2);
    });

    it("cards.delete DRY RUN enumerates the recall consequences of a DECK without writing", async () => {
      const response = await router().route(
        createRequest("cards.delete", { cardsId: "cards-deck", dryRun: true })
      );
      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({ id: "cards-deck", deleted: false, dryRun: true });
      expect(response.result.recall).toMatchObject({ type: "deck", status: "not-executed" });

      expect(CARDS_RECALL_STATUSES).toContain(response.result.recall.status);

      expect(response.result.recall.reclaimed).toEqual([
        {
          cardsId: "cards-hand",
          cardsName: "Player Hand",
          cardIds: ["card-ace", "card-orphan"],
          cardIdsCount: 2,
          cardIdsTruncated: false
        },
        {
          cardsId: "cards-pile",
          cardsName: "Discard Pile",
          cardIds: ["card-king"],
          cardIdsCount: 1,
          cardIdsTruncated: false
        }
      ]);
      expect(response.result.recall.reclaimedCount).toBe(2);
      expect(response.result.recall.reclaimedTruncated).toBe(false);
      expect(response.result.recall.ownDrawnResetCardIds).toEqual(["card-ace", "card-king"]);
      expect(response.result.recall.ownDrawnResetCardIdsCount).toBe(2);
      expect(response.result.recall.ownDrawnResetCardIdsTruncated).toBe(false);

      expect(response.result.recall.danglingOriginsLeft).toEqual([]);
      expect(response.result.recall.danglingOriginsLeftCount).toBe(0);

      expect(response.result.chatNotification).toEqual({ requested: false, status: "not-requested" });
      expect(CARDS_DELETE_CHAT_STATUSES).toContain(response.result.chatNotification.status);
      expect(globalThis.game.cards.get("cards-deck").delete).not.toHaveBeenCalled();
      expect(globalThis.game.cards.get("cards-hand").cards.get("card-ace")).toBeTruthy();
    });

    it("cards.delete of a DECK reclaims its cards from every other stack and confirms it", async () => {
      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-deck" }));
      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({ id: "cards-deck", deleted: true });
      expect(response.result.recall.status).toBe("confirmed");
      expect(CARDS_RECALL_STATUSES).toContain(response.result.recall.status);
      expect(response.result.recall).not.toHaveProperty("unconfirmed");
      expect(response.result.chatNotification).toEqual({ requested: true, status: "dispatched" });
      expect(CARDS_DELETE_CHAT_STATUSES).toContain(response.result.chatNotification.status);

      expect(globalThis.game.cards.get("cards-hand").cards.get("card-ace")).toBeNull();
      expect(globalThis.game.cards.get("cards-pile").cards.get("card-king")).toBeNull();
    });

    it("cards.delete of a DECK reports a PARTIALLY refused reclaim as unconfirmed, per stack", async () => {
      globalThis.game.cards.get("cards-pile").vetoCardDeletes = true;
      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-deck" }));
      expect(response.ok).toBe(true);
      expect(response.result.deleted).toBe(true);
      expect(response.result.recall.status).toBe("unconfirmed");
      expect(CARDS_RECALL_STATUSES).toContain(response.result.recall.status);
      expect(response.result.recall.unconfirmed.reclaimedRemaining).toEqual([
        { cardsId: "cards-pile", cardIds: ["card-king"], cardIdsCount: 1, cardIdsTruncated: false }
      ]);

      expect(response.result.recall.unconfirmed.notReturned).toEqual([]);

      expect(response.result.recall.unconfirmed.ownRowsStillDrawn).toEqual([]);
      expect(response.result.recall.unconfirmed.notRemovedCardIds).toEqual([]);

      expect(response.result.chatNotification).toEqual({ requested: true, status: "unknown" });
      expect(CARDS_DELETE_CHAT_STATUSES).toContain(response.result.chatNotification.status);

      expect(globalThis.game.cards.get("cards-hand").cards.get("card-ace")).toBeNull();
      expect(globalThis.game.cards.get("cards-pile").cards.get("card-king")).toBeTruthy();
    });

    it("cards.delete of a HAND separates returned / destroyed / skipped cards and the dangling leftovers", async () => {
      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-hand" }));
      expect(response.ok).toBe(true);
      expect(response.result.recall).toMatchObject({ type: "hand", status: "confirmed" });

      expect(response.result.recall.returned).toEqual([
        {
          cardsId: "cards-deck",
          cardsName: "Poker Deck",
          cardIds: ["card-ace"],
          cardIdsCount: 1,
          cardIdsTruncated: false
        }
      ]);
      expect(response.result.recall.returnedCount).toBe(1);

      expect(response.result.recall.destroyedCardIds).toEqual(["card-orphan"]);
      expect(response.result.recall.destroyedCardIdsCount).toBe(1);

      expect(response.result.recall.skippedCardIds).toEqual(["card-own"]);
      expect(response.result.recall.skippedCardIdsCount).toBe(1);

      expect(globalThis.game.cards.get("cards-deck").cards.get("card-ace")._source.drawn).toBe(false);

      expect(globalThis.game.cards.get("cards-hand")).toBeNull();
      expect(response.result.recall.status).toBe("confirmed");
      expect(response.result.recall).not.toHaveProperty("unconfirmed");
    });

    it("cards.delete of a HAND names the stacks left holding cards whose origin was this hand", async () => {
      const holder = createCardsDocument("cards-holder", {
        name: "Holder Pile",
        type: "pile",
        cards: [{ id: "card-from-hand", name: "From The Hand", drawn: true, origin: "cards-hand" }]
      });
      globalThis.game.cards.set(holder);

      const dryRun = await router().route(
        createRequest("cards.delete", { cardsId: "cards-hand", dryRun: true })
      );
      expect(dryRun.ok).toBe(true);
      expect(dryRun.result.recall.danglingOriginsLeft).toEqual([
        {
          cardsId: "cards-holder",
          cardsName: "Holder Pile",
          cardIds: ["card-from-hand"],
          cardIdsCount: 1,
          cardIdsTruncated: false
        }
      ]);

      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-hand" }));
      expect(response.ok).toBe(true);

      expect(response.result.recall.danglingOriginsLeft).toEqual([
        {
          cardsId: "cards-holder",
          cardsName: "Holder Pile",
          cardIds: ["card-from-hand"],
          cardIdsCount: 1,
          cardIdsTruncated: false
        }
      ]);

      expect(globalThis.game.cards.get("cards-hand")).toBeNull();
      const stranded = globalThis.game.cards.get("cards-holder").cards.get("card-from-hand");
      expect(stranded._source.origin).toBe("cards-hand");
      expect(stranded.origin).toBeNull();
      expect(response.result.recall.status).toBe("confirmed");
    });

    it("cards.delete reports a VETOED recall as unconfirmed while the delete still went through", async () => {
      globalThis.game.cards.get("cards-hand").vetoRecall = true;
      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-hand" }));

      expect(response.ok).toBe(true);
      expect(response.result.deleted).toBe(true);
      expect(response.result.recall.status).toBe("unconfirmed");
      expect(response.result.recall.unconfirmed.notReturned).toEqual([
        { cardsId: "cards-deck", cardIds: ["card-ace"], cardIdsCount: 1, cardIdsTruncated: false }
      ]);

      expect(response.result.chatNotification).toEqual({ requested: true, status: "unknown" });
      expect(CARDS_DELETE_CHAT_STATUSES).toContain(response.result.chatNotification.status);

      expect(globalThis.game.cards.get("cards-deck").cards.get("card-ace")._source.drawn).toBe(true);
    });

    it("cards.delete refuses to report a VETOED delete as done, and says the recall already ran", async () => {
      globalThis.game.cards.get("cards-hand").vetoDelete = true;
      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-hand" }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("preDeleteCards");
      expect(response.error.message).toContain("the recall HAS already run");
      expect(response.error.details.recall.returned).toEqual([
        {
          cardsId: "cards-deck",
          cardsName: "Poker Deck",
          cardIds: ["card-ace"],
          cardIdsCount: 1,
          cardIdsTruncated: false
        }
      ]);

      expect(globalThis.game.cards.get("cards-hand")).toBeTruthy();
      expect(globalThis.game.cards.get("cards-deck").cards.get("card-ace")._source.drawn).toBe(false);

      expect(response.error.details.recall.status).toBe("confirmed");
      expect(CARDS_RECALL_STATUSES).toContain(response.error.details.recall.status);
      expect(response.error.details.recall).not.toHaveProperty("unconfirmed");

      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "dispatched" });
      expect(CARDS_DELETE_CHAT_STATUSES).toContain(response.error.details.chatNotification.status);
    });

    it("a VETOED delete of a DECK confirms the reclaim its recall performed", async () => {
      globalThis.game.cards.get("cards-deck").vetoDelete = true;
      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-deck" }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details.recall.status).toBe("confirmed");
      expect(response.error.details.recall).not.toHaveProperty("unconfirmed");

      expect(globalThis.game.cards.get("cards-deck")).toBeTruthy();
      expect(globalThis.game.cards.get("cards-hand").cards.get("card-ace")).toBeNull();
      expect(globalThis.game.cards.get("cards-pile").cards.get("card-king")).toBeNull();
    });

    it("a VETOED delete whose RECALL was also vetoed reports the recall as unconfirmed WITH its rows", async () => {
      globalThis.game.cards.get("cards-hand").vetoRecall = true;
      globalThis.game.cards.get("cards-hand").vetoDelete = true;
      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-hand" }));
      expect(response.ok).toBe(false);
      expect(response.error.details.recall.status).toBe("unconfirmed");
      expect(CARDS_RECALL_STATUSES).toContain(response.error.details.recall.status);
      expect(response.error.details.recall.unconfirmed.notReturned).toEqual([
        { cardsId: "cards-deck", cardIds: ["card-ace"], cardIdsCount: 1, cardIdsTruncated: false }
      ]);

      expect(response.error.details.recall.unconfirmed.notRemovedCardIds).toEqual([
        "card-ace",
        "card-orphan"
      ]);
      expect(response.error.details.recall.unconfirmed.notRemovedCardIdsCount).toBe(2);
      expect(response.error.details.recall.unconfirmed.ownRowsStillDrawn).toEqual([]);
      expect(globalThis.game.cards.get("cards-deck").cards.get("card-ace")._source.drawn).toBe(true);

      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "unknown" });
      expect(CARDS_DELETE_CHAT_STATUSES).toContain(response.error.details.chatNotification.status);
    });

    it("a VETOED delete of a DECK whose OWN-row batch was refused reports ownRowsStillDrawn", async () => {
      globalThis.game.cards.get("cards-deck").vetoDelete = true;
      globalThis.game.cards.get("cards-deck").vetoOwnCardUpdates = true;
      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-deck" }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details.recall.status).toBe("unconfirmed");
      expect(response.error.details.recall.unconfirmed.ownRowsStillDrawn).toEqual(["card-ace", "card-king"]);
      expect(response.error.details.recall.unconfirmed.ownRowsStillDrawnCount).toBe(2);

      expect(response.error.details.recall.unconfirmed.reclaimedRemaining).toEqual([]);
      expect(globalThis.game.cards.get("cards-hand").cards.get("card-ace")).toBeNull();
      expect(globalThis.game.cards.get("cards-deck").cards.get("card-ace")._source.drawn).toBe(true);

      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "unknown" });
    });

    it("a VETOED delete of a HAND whose OWN delete batch was refused reports notRemovedCardIds", async () => {
      globalThis.game.cards.get("cards-hand").vetoDelete = true;
      globalThis.game.cards.get("cards-hand").vetoOwnCardDeletes = true;
      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-hand" }));
      expect(response.ok).toBe(false);
      expect(response.error.details.recall.status).toBe("unconfirmed");

      expect(response.error.details.recall.unconfirmed.notRemovedCardIds).toEqual([
        "card-ace",
        "card-orphan"
      ]);

      expect(response.error.details.recall.unconfirmed.notReturned).toEqual([]);
      expect(globalThis.game.cards.get("cards-deck").cards.get("card-ace")._source.drawn).toBe(false);
      expect(globalThis.game.cards.get("cards-hand").cards.get("card-ace")).toBeTruthy();

      expect(response.error.details.recall.unconfirmed.notRemovedCardIds).not.toContain("card-own");
    });

    it("a THROWING delete of a HAND carries the recall enumeration and keeps the raw error", async () => {
      globalThis.game.cards.get("cards-hand").throwOnDelete = new Error("socket closed mid-delete");
      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-hand" }));
      expect(response.ok).toBe(false);

      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toBe("socket closed mid-delete");
      expect(response.error.details.message).toBe("socket closed mid-delete");
      expect(response.error.details.cardsId).toBe("cards-hand");

      expect(response.error.details.recall.returned).toEqual([
        {
          cardsId: "cards-deck",
          cardsName: "Poker Deck",
          cardIds: ["card-ace"],
          cardIdsCount: 1,
          cardIdsTruncated: false
        }
      ]);
      expect(response.error.details.recall.destroyedCardIds).toEqual(["card-orphan"]);
      expect(response.error.details.recall.skippedCardIds).toEqual(["card-own"]);

      expect(response.error.details.recall.status).toBe("not-verified");
      expect(CARDS_RECALL_STATUSES).toContain(response.error.details.recall.status);
      expect(response.error.details.recall).not.toHaveProperty("unconfirmed");

      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "unknown" });
      expect(CARDS_DELETE_CHAT_STATUSES).toContain(response.error.details.chatNotification.status);

      expect(globalThis.game.cards.get("cards-deck").cards.get("card-ace")._source.drawn).toBe(false);
      expect(globalThis.game.cards.get("cards-hand")).toBeTruthy();
    });

    it("a THROWING delete keeps a Foundry VALIDATION failure classified as INVALID_PARAMS", async () => {
      const validationError = new Error("Card validation failed");
      validationError.name = "DataModelValidationError";
      globalThis.game.cards.get("cards-deck").throwOnDelete = validationError;
      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-deck" }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.details.reason).toBe("foundry_validation");
      expect(response.error.details.message).toBe("Card validation failed");

      expect(response.error.details.recall.reclaimed).toEqual([
        {
          cardsId: "cards-hand",
          cardsName: "Player Hand",

          cardIds: ["card-ace", "card-orphan"],
          cardIdsCount: 2,
          cardIdsTruncated: false
        },
        {
          cardsId: "cards-pile",
          cardsName: "Discard Pile",
          cardIds: ["card-king"],
          cardIdsCount: 1,
          cardIdsTruncated: false
        }
      ]);
      expect(response.error.details.recall.status).toBe("not-verified");
      expect(response.error.details.recall).not.toHaveProperty("unconfirmed");
      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "unknown" });
    });

    it("caps every recall id list (20 stacks / 20 nested ids / 100 flat ids) with exact counts", async () => {
      const deck = createCardsDocument("cards-big-deck", {
        name: "Big Deck",
        type: "deck",

        cards: Array.from({ length: 120 }, (_, index) => ({
          id: `big-card-${index}`,
          name: `Card ${index}`,
          drawn: true
        }))
      });
      globalThis.game.cards.set(deck);

      for (let holder = 0; holder < 25; holder += 1) {
        globalThis.game.cards.set(
          createCardsDocument(`cards-holder-${holder}`, {
            name: `Holder ${holder}`,
            type: "hand",
            cards: Array.from({ length: holder === 0 ? 30 : 1 }, (_, index) => ({
              id: `big-card-${holder * 30 + index}`,
              name: "Copy",
              origin: "cards-big-deck"
            }))
          })
        );
      }

      const response = await router().route(
        createRequest("cards.delete", { cardsId: "cards-big-deck", dryRun: true })
      );
      expect(response.ok).toBe(true);
      const recall = response.result.recall;

      expect(recall.reclaimed).toHaveLength(20);
      expect(recall.reclaimedCount).toBe(25);
      expect(recall.reclaimedTruncated).toBe(true);

      expect(recall.reclaimed[0].cardIds).toHaveLength(20);
      expect(recall.reclaimed[0].cardIdsCount).toBe(30);
      expect(recall.reclaimed[0].cardIdsTruncated).toBe(true);

      expect(recall.reclaimed[1].cardIdsTruncated).toBe(false);

      expect(recall.ownDrawnResetCardIds).toHaveLength(100);
      expect(recall.ownDrawnResetCardIdsCount).toBe(120);
      expect(recall.ownDrawnResetCardIdsTruncated).toBe(true);

      expect(recall.skippedCardIds).toEqual([]);
      expect(recall.skippedCardIdsCount).toBe(0);
      expect(recall.skippedCardIdsTruncated).toBe(false);
    });

    it("marks the two DELETE-CONSEQUENCE lists applied / prospective / unknown, per path", async () => {
      const holder = createCardsDocument("cards-holder", {
        name: "Holder Pile",
        type: "pile",
        cards: [{ id: "card-from-hand", name: "From The Hand", drawn: true, origin: "cards-hand" }]
      });
      globalThis.game.cards.set(holder);

      const dry = await router().route(
        createRequest("cards.delete", { cardsId: "cards-hand", dryRun: true })
      );
      expect(dry.result.recall.deleteConsequences).toBe("prospective");
      expect(CARDS_RECALL_CONSEQUENCE_SCOPES).toContain(dry.result.recall.deleteConsequences);
      expect(dry.result.recall.danglingOriginsLeftCount).toBe(1);

      expect(globalThis.game.cards.get("cards-holder").cards.get("card-from-hand").origin).toBeTruthy();

      globalThis.game.cards.get("cards-hand").vetoDelete = true;
      const vetoed = await router().route(createRequest("cards.delete", { cardsId: "cards-hand" }));
      expect(vetoed.ok).toBe(false);
      expect(vetoed.error.details.recall.deleteConsequences).toBe("prospective");
      expect(globalThis.game.cards.get("cards-hand")).toBeTruthy();
      expect(globalThis.game.cards.get("cards-holder").cards.get("card-from-hand").origin).toBeTruthy();

      globalThis.game.cards.get("cards-hand").vetoDelete = false;
      globalThis.game.cards.get("cards-hand").throwOnDelete = new Error("socket closed");
      const threw = await router().route(createRequest("cards.delete", { cardsId: "cards-hand" }));
      expect(threw.ok).toBe(false);
      expect(threw.error.details.recall.deleteConsequences).toBe("unknown");
      expect(threw.error.details.recall.status).toBe("not-verified");

      globalThis.game.cards.get("cards-hand").throwOnDelete = null;
      const landed = await router().route(createRequest("cards.delete", { cardsId: "cards-hand" }));
      expect(landed.ok).toBe(true);
      expect(landed.result.recall.deleteConsequences).toBe("applied");
      expect(CARDS_RECALL_CONSEQUENCE_SCOPES).toContain(landed.result.recall.deleteConsequences);
      const stranded = globalThis.game.cards.get("cards-holder").cards.get("card-from-hand");
      expect(stranded._source.origin).toBe("cards-hand");
      expect(stranded.origin).toBeNull();
    });

    it("MEASURES a DECK's danglingOriginsLeft from the reclaim shortfall instead of assuming none", async () => {
      globalThis.game.cards.get("cards-pile").vetoCardDeletes = true;
      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-deck" }));
      expect(response.ok).toBe(true);
      expect(response.result.recall.deleteConsequences).toBe("applied");
      expect(response.result.recall.danglingOriginsLeft).toEqual([
        {
          cardsId: "cards-pile",
          cardsName: "Discard Pile",
          cardIds: ["card-king"],
          cardIdsCount: 1,
          cardIdsTruncated: false
        }
      ]);
      expect(response.result.recall.danglingOriginsLeftCount).toBe(1);

      expect(response.result.recall.unconfirmed.reclaimedRemaining).toEqual([
        { cardsId: "cards-pile", cardIds: ["card-king"], cardIdsCount: 1, cardIdsTruncated: false }
      ]);

      const stranded = globalThis.game.cards.get("cards-pile").cards.get("card-king");
      expect(stranded._source.origin).toBe("cards-deck");
      expect(stranded.origin).toBeNull();
    });

    it("leaves a DECK's danglingOriginsLeft empty while the deck SURVIVES, even with a refused reclaim", async () => {
      globalThis.game.cards.get("cards-pile").vetoCardDeletes = true;
      globalThis.game.cards.get("cards-deck").vetoDelete = true;
      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-deck" }));
      expect(response.ok).toBe(false);
      expect(response.error.details.recall.deleteConsequences).toBe("prospective");
      expect(response.error.details.recall.status).toBe("unconfirmed");
      expect(response.error.details.recall.unconfirmed.reclaimedRemainingCount).toBe(1);
      expect(response.error.details.recall.danglingOriginsLeft).toEqual([]);
      expect(response.error.details.recall.danglingOriginsLeftCount).toBe(0);

      const kept = globalThis.game.cards.get("cards-pile").cards.get("card-king");
      expect(kept).toBeTruthy();
      expect(kept.origin).toBe(globalThis.game.cards.get("cards-deck"));
    });

    it("originRowsLeftDrawn lists ONLY a foreign origin that still holds the id and stores it drawn", async () => {
      const origin = createCardsDocument("cards-origin", {
        name: "Origin Deck",
        type: "deck",
        cards: [
          { id: "card-stranded", name: "Stranded", drawn: true },
          { id: "card-available", name: "Available", drawn: false }
        ]
      });
      globalThis.game.cards.set(origin);
      const subject = createCardsDocument("cards-subject", {
        name: "Subject Deck",
        type: "deck",
        cards: [
          { id: "card-home", name: "Home", drawn: true, origin: "cards-subject" },

          { id: "card-dangle", name: "Dangling", origin: "cardsGoneAAAAAA1" },

          { id: "card-unheld", name: "Unheld", origin: "cards-origin" },

          { id: "card-available", name: "Available", origin: "cards-origin" },

          { id: "card-stranded", name: "Stranded", origin: "cards-origin" }
        ]
      });
      globalThis.game.cards.set(subject);

      const response = await router().route(
        createRequest("cards.delete", { cardsId: "cards-subject", dryRun: true })
      );
      expect(response.ok).toBe(true);
      expect(response.result.recall.originRowsLeftDrawn).toEqual([
        {
          cardsId: "cards-origin",
          cardsName: "Origin Deck",
          cardIds: ["card-stranded"],
          cardIdsCount: 1,
          cardIdsTruncated: false
        }
      ]);
      expect(response.result.recall.originRowsLeftDrawnCount).toBe(1);

      expect(response.result.recall.ownDrawnResetCardIds).toEqual([
        "card-home",
        "card-dangle",
        "card-unheld",
        "card-available",
        "card-stranded"
      ]);
    });

    it("SKIPS a hand/pile card that is isHome even though it HAS a resolvable origin", async () => {
      const pile = createCardsDocument("cards-selforigin", {
        name: "Self Pile",
        type: "pile",
        cards: [
          { id: "card-self", name: "Own", drawn: true, origin: "cards-selforigin" },
          { id: "card-foreign", name: "Foreign", drawn: true, origin: "cards-deck" }
        ]
      });
      globalThis.game.cards.set(pile);
      const response = await router().route(
        createRequest("cards.delete", { cardsId: "cards-selforigin", dryRun: true })
      );
      expect(response.ok).toBe(true);
      expect(response.result.recall.skippedCardIds).toEqual(["card-self"]);

      expect(globalThis.game.cards.get("cards-selforigin").cards.get("card-self").origin).toBe(pile);
      expect(globalThis.game.cards.get("cards-selforigin").cards.get("card-self").isHome).toBe(true);
      expect(response.result.recall.destroyedCardIds).toEqual(["card-foreign"]);
      expect(response.result.recall.returned).toEqual([]);
    });

    it("does not call a VANISHED reclaim target unconfirmed, but does call a vanished ORIGIN so", async () => {
      globalThis.game.cards.get("cards-deck").vanishDuringRecall = ["cards-hand"];
      const deck = await router().route(createRequest("cards.delete", { cardsId: "cards-deck" }));
      expect(deck.ok).toBe(true);
      expect(globalThis.game.cards.get("cards-hand")).toBeNull();
      expect(deck.result.recall.reclaimedCount).toBe(2);
      expect(deck.result.recall.status).toBe("confirmed");
      expect(deck.result.recall).not.toHaveProperty("unconfirmed");

      const origin = createCardsDocument("cards-origin2", {
        name: "Origin Deck 2",
        type: "deck",
        cards: [{ id: "card-borrowed", name: "Borrowed", drawn: true }]
      });
      globalThis.game.cards.set(origin);
      const hand = createCardsDocument("cards-hand2", {
        name: "Hand 2",
        type: "hand",
        cards: [{ id: "card-borrowed", name: "Borrowed", drawn: true, origin: "cards-origin2" }]
      });
      hand.vanishDuringRecall = ["cards-origin2"];
      globalThis.game.cards.set(hand);
      const handDelete = await router().route(createRequest("cards.delete", { cardsId: "cards-hand2" }));
      expect(handDelete.ok).toBe(true);
      expect(globalThis.game.cards.get("cards-origin2")).toBeNull();
      expect(handDelete.result.recall.status).toBe("unconfirmed");
      expect(handDelete.result.recall.unconfirmed.notReturned).toEqual([
        { cardsId: "cards-origin2", cardIds: ["card-borrowed"], cardIdsCount: 1, cardIdsTruncated: false }
      ]);
    });

    it("does not confirm a return when the individual origin row disappeared concurrently", async () => {
      globalThis.game.cards.get("cards-hand").dropReturnedRowsFromOrigin = true;
      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-hand" }));
      expect(response.ok).toBe(true);
      expect(response.result.recall.returnedCount).toBe(1);
      expect(response.result.recall.status).toBe("unconfirmed");
      expect(response.result.recall.unconfirmed.notReturned).toEqual([
        { cardsId: "cards-deck", cardIds: ["card-ace"], cardIdsCount: 1, cardIdsTruncated: false }
      ]);

      expect(globalThis.game.cards.get("cards-deck")).toBeTruthy();
      expect(globalThis.game.cards.get("cards-deck").cards.get("card-ace")).toBeNull();
      expect(globalThis.game.cards.get("cards-hand")).toBeNull();
    });

    it("re-resolves the recall's TARGET through game.cards rather than trusting the handle", async () => {
      globalThis.game.cards.get("cards-hand").vetoOwnCardDeletes = true;
      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-hand" }));
      expect(response.ok).toBe(true);
      expect(response.result.deleted).toBe(true);
      expect(response.result.recall.status).toBe("confirmed");
      expect(response.result.recall).not.toHaveProperty("unconfirmed");

      expect(globalThis.game.cards.get("cards-hand")).toBeNull();
      expect(response.result.recall.returnedCount + response.result.recall.destroyedCardIdsCount).toBe(2);
    });

    it("counts the PERSISTED drawn flag everywhere, even when the live flag disagrees", async () => {
      const stack = createCardsDocument("cards-divergent", {
        name: "Optimistic Hand",
        type: "hand",
        cards: [
          { id: "card-lied", name: "Lied About", drawn: false, liveDrawn: true, origin: "cards-deck" },
          { id: "card-honest", name: "Honest", drawn: true, origin: "cards-deck" }
        ]
      });
      globalThis.game.cards.set(stack);
      const live = globalThis.game.cards.get("cards-divergent").cards.get("card-lied");
      expect(live.drawn).toBe(true);
      expect(live._source.drawn).toBe(false);

      const list = await router().route(createRequest("cards.list", { name: "Optimistic" }));
      const row = list.result.cards[0];
      expect(row).toMatchObject({ cardCount: 2, drawnCount: 1, availableCount: 2 });

      const read = await router().route(createRequest("cards.get", { cardsId: "cards-divergent" }));
      expect(read.result.cards.cards.find((card) => card.id === "card-lied").drawn).toBe(false);

      const cloned = await router().route(
        createRequest("cards.clone", { cardsId: "cards-divergent", dryRun: true })
      );
      expect(cloned.result.cardsCopy.drawnCleared).toBe(1);
    });

    it("cards.clone canonicalizes its patch, so a whitespace img is refused not silently reset", async () => {
      for (const extra of [{ dryRun: true }, {}]) {
        const response = await router().route(
          createRequest("cards.clone", { cardsId: "cards-deck", patch: { img: "   " }, ...extra })
        );
        expect(response.ok, JSON.stringify(extra)).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
        expect(response.error.details.message).toContain("file extension");
      }
    });

    it("cards.get-many caps the batch at BATCH_GET_MAX_IDS in the handler", async () => {
      const ids = Array.from({ length: BATCH_GET_MAX_IDS + 1 }, () => "cards-deck");
      const response = await router().route(createRequest("cards.get-many", { ids }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.details).toEqual({ max: BATCH_GET_MAX_IDS, received: ids.length });

      const atCap = await router().route(
        createRequest("cards.get-many", {
          ids: Array.from({ length: BATCH_GET_MAX_IDS }, () => "cards-deck")
        })
      );
      expect(atCap.ok).toBe(true);
    });

    it("returns CARDS_NOT_FOUND for every verb that resolves a stack", async () => {
      for (const [command, params] of [
        ["cards.get", { cardsId: "nope" }],
        ["cards.update", { cardsId: "nope", patch: { name: "X" } }],
        ["cards.clone", { cardsId: "nope" }],
        ["cards.delete", { cardsId: "nope" }],
        ["cards.ownership.set", { cardsId: "nope", default: 2 }]
      ]) {
        const response = await router().route(createRequest(command, params));
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.CARDS_NOT_FOUND);
      }
    });

    it("cards.ownership.set is the EIGHTH family: merges, rejects -1, and a stored -1 still READS back", async () => {
      const response = await router().route(
        createRequest("cards.ownership.set", { cardsId: "cards-deck", default: 2 })
      );
      expect(response.ok).toBe(true);
      expect(response.result.cards.ownership).toEqual({ default: 2 });

      const stackUnderVeto = globalThis.game.cards.get("cards-deck");
      stackUnderVeto.vetoUpdate = true;
      const noOp = await router().route(
        createRequest("cards.ownership.set", { cardsId: "cards-deck", default: 2 })
      );
      expect(noOp.ok, JSON.stringify(noOp.error ?? {})).toBe(true);
      const vetoed = await router().route(
        createRequest("cards.ownership.set", { cardsId: "cards-deck", default: 3 })
      );
      expect(vetoed.ok).toBe(false);
      expect(vetoed.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(vetoed.error.message).toContain("preUpdateCards");
      expect(vetoed.error.details).toMatchObject({ cardsId: "cards-deck", fields: ["ownership"] });
      expect(stackUnderVeto._source.ownership).toEqual({ default: 2 });
      delete stackUnderVeto.vetoUpdate;

      const inherit = await router().route(
        createRequest("cards.ownership.set", { cardsId: "cards-deck", default: -1 })
      );
      expect(inherit.ok).toBe(false);
      expect(inherit.error.code).toBe(ERROR_CODES.INVALID_PARAMS);

      const stack = createCardsDocument("cards-inherit", { name: "UI-authored", type: "pile" });
      stack._source.ownership = { default: -1 };
      stack.ownership = { default: -1 };
      globalThis.game.cards.set(stack);
      const read = await router().route(createRequest("cards.get", { cardsId: "cards-inherit" }));
      expect(read.ok).toBe(true);
      expect(read.result.cards.ownership).toEqual({ default: -1 });
    });

    it("serializes ALL THREE mutating cards writes on the SAME queue", async () => {
      const stack = globalThis.game.cards.get("cards-deck");
      const events = [];
      /** @type {() => void} */
      let release = () => {};
      const gate = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      const originalUpdate = stack.update;
      stack.update = vi.fn(async (...args) => {
        events.push("update-start");
        await gate;
        events.push("update-end");
        return originalUpdate(...args);
      });
      const originalClone = stack.clone;
      stack.clone = vi.fn(async (patch, context = {}) => {
        events.push(context.save ? "clone-save" : "clone-probe");
        return originalClone(patch, context);
      });
      const originalDelete = stack.delete;
      stack.delete = vi.fn(async (...args) => {
        events.push("delete");
        return originalDelete(...args);
      });

      const pending = [
        router().route(createRequest("cards.update", { cardsId: "cards-deck", patch: { sort: 9 } })),
        router().route(createRequest("cards.clone", { cardsId: "cards-deck" })),
        router().route(createRequest("cards.delete", { cardsId: "cards-deck" }))
      ];
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(events).toEqual(["update-start"]);
      release();
      const responses = await Promise.all(pending);
      expect(
        responses.map((response) => response.ok),
        JSON.stringify(responses.map((response) => response.error ?? null))
      ).toEqual([true, true, true]);
      expect(events).toEqual(["update-start", "update-end", "clone-probe", "clone-save", "delete"]);
    });

    it("canonicalizes all THREE FilePath leaves so a WHITESPACE-only value is rejected, not silently reset", async () => {
      for (const [label, data] of [
        ["stack img", { name: "Blankish", type: "deck", img: "   " }],
        ["card back.img", { name: "Blankish", type: "deck", cards: [{ name: "A", back: { img: "   " } }] }],
        [
          "card faces[].img",
          { name: "Blankish", type: "deck", cards: [{ name: "A", faces: [{ name: "F", img: "   " }] }] }
        ]
      ]) {
        for (const extra of [{ dryRun: true }, {}]) {
          const response = await router().route(createRequest("cards.create", { data, ...extra }));
          expect(response.ok, `${label} ${JSON.stringify(extra)}`).toBe(false);
          expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
          expect(response.error.details.message).toContain("file extension");
        }
      }

      for (const data of [
        { name: "Blank", type: "deck", img: "" },
        { name: "Blank", type: "deck", cards: [{ name: "A", back: { img: "" } }] },
        { name: "Blank", type: "deck", cards: [{ name: "A", faces: [{ img: "" }] }] }
      ]) {
        const empty = await router().route(createRequest("cards.create", { data }));
        expect(empty.ok, JSON.stringify(data)).toBe(false);
        expect(empty.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      }

      const cleared = await router().route(
        createRequest("cards.update", { cardsId: "cards-deck", patch: { img: null } })
      );
      expect(cleared.ok, JSON.stringify(cleared.error ?? {})).toBe(true);
      expect(cleared.result.cards.img).toBeNull();
    });

    it("cards.update answers INVALID_PARAMS for a whitespace img instead of accusing a module veto", async () => {
      const stack = globalThis.game.cards.get("cards-deck");
      stack.update = vi.fn(async () => undefined);
      const response = await router().route(
        createRequest("cards.update", { cardsId: "cards-deck", patch: { img: "   " } })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.details).toMatchObject({ cardsId: "cards-deck", reason: "foundry_validation" });
      expect(response.error.details.message).toContain("file extension");
      expect(response.error.message).toMatch(/NOT a module veto/);
      expect(globalThis.game.cards.get("cards-deck").img).not.toBe("%20%20%20");
    });

    it("cards.clone validates the SUPPLIED patch identically on the real and the dry-run path", async () => {
      const responses = [];
      for (const extra of [{}, { dryRun: true }]) {
        responses.push(
          await router().route(
            createRequest("cards.clone", {
              cardsId: "cards-deck",
              patch: { img: "worlds/test/notes.txt" },
              ...extra
            })
          )
        );
      }
      for (const response of responses) {
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
        expect(response.error.details.message).toContain("file extension");
      }

      expect(responses[0].error.code).toBe(responses[1].error.code);
      expect(responses[0].error.details.message).toBe(responses[1].error.details.message);
      expect(globalThis.Cards.create).not.toHaveBeenCalled();
    });

    it("every `drawn` read follows the STORED flag when the live one diverges", async () => {
      const deck = createCardsDocument("cards-live-divergence", {
        name: "Live Divergence",
        type: "deck",
        cards: [{ id: "card-live", name: "Live Only" }]
      });
      globalThis.game.cards.set(deck);
      const card = deck.cards.get("card-live");
      expect(card._source.drawn).toBe(false);
      card.drawn = true;

      const list = await router().route(createRequest("cards.list", { name: "Live Divergence" }));
      expect(list.ok).toBe(true);
      const row = list.result.cards.find((entry) => entry.id === "cards-live-divergence");

      expect(row).toMatchObject({ cardCount: 1, drawnCount: 0, availableCount: 1 });
      expect(card.drawn).toBe(true);
      const read = await router().route(createRequest("cards.get", { cardsId: "cards-live-divergence" }));
      expect(read.result.cards.cards[0].drawn).toBe(false);

      const origin = createCardsDocument("cards-origin-live", {
        name: "Origin Live",
        type: "deck",
        cards: [{ id: "card-shared", name: "Shared", drawn: true }]
      });
      const hand = createCardsDocument("cards-hand-live", {
        name: "Hand Live",
        type: "hand",
        cards: [{ id: "card-shared", name: "Shared", drawn: true, origin: "cards-origin-live" }]
      });
      globalThis.game.cards.set(origin);
      globalThis.game.cards.set(hand);
      const originRow = origin.cards.get("card-shared");

      const originalDelete = hand.delete;
      hand.delete = vi.fn(async (...args) => {
        const result = await originalDelete(...args);
        originRow.drawn = true;
        return result;
      });
      const deleted = await router().route(createRequest("cards.delete", { cardsId: "cards-hand-live" }));
      expect(deleted.ok).toBe(true);
      expect(originRow._source.drawn).toBe(false);
      expect(originRow.drawn).toBe(true);
      expect(deleted.result.recall.status).toBe("confirmed");
      expect(deleted.result.recall).not.toHaveProperty("unconfirmed");
    });

    it("cards.delete of a DECK reports the ORIGIN rows its recall strands stored drawn=true", async () => {
      const holder = createCardsDocument("cards-deck-holder", {
        name: "Holder Deck",
        type: "deck",
        cards: [
          { id: "card-ace", name: "Ace copy", origin: "cards-deck" },

          { id: "card-home", name: "Home", origin: "cards-deck-holder" },

          { id: "card-own", name: "Available elsewhere", origin: "cards-hand" }
        ]
      });
      globalThis.game.cards.set(holder);
      expect(globalThis.game.cards.get("cards-deck").cards.get("card-ace")._source.drawn).toBe(true);
      expect(globalThis.game.cards.get("cards-hand").cards.get("card-own")._source.drawn).toBe(false);

      const dryRun = await router().route(
        createRequest("cards.delete", { cardsId: "cards-deck-holder", dryRun: true })
      );
      expect(dryRun.ok).toBe(true);
      expect(dryRun.result.recall.originRowsLeftDrawn).toEqual([
        {
          cardsId: "cards-deck",
          cardsName: "Poker Deck",
          cardIds: ["card-ace"],
          cardIdsCount: 1,
          cardIdsTruncated: false
        }
      ]);

      const response = await router().route(createRequest("cards.delete", { cardsId: "cards-deck-holder" }));
      expect(response.ok).toBe(true);
      expect(response.result.recall.originRowsLeftDrawn).toEqual(dryRun.result.recall.originRowsLeftDrawn);
      expect(globalThis.game.cards.get("cards-deck").cards.get("card-ace")._source.drawn).toBe(true);

      const handDelete = await router().route(
        createRequest("cards.delete", { cardsId: "cards-hand", dryRun: true })
      );
      expect(handDelete.result.recall.originRowsLeftDrawn).toEqual([]);
    });

    it("cardsCopy.unreturnableCards is a HAND/PILE hazard: a DECK clone reports 0", async () => {
      const deckWithForeign = createCardsDocument("cards-deck-foreign", {
        name: "Deck With Foreign",
        type: "deck",
        cards: [{ id: "card-foreign", name: "Foreign", origin: "cards-hand" }]
      });
      const handWithForeign = createCardsDocument("cards-hand-foreign", {
        name: "Hand With Foreign",
        type: "hand",
        cards: [{ id: "card-foreign", name: "Foreign", origin: "cards-hand" }]
      });
      globalThis.game.cards.set(deckWithForeign);
      globalThis.game.cards.set(handWithForeign);

      const deckClone = await router().route(createRequest("cards.clone", { cardsId: "cards-deck-foreign" }));
      expect(deckClone.ok, JSON.stringify(deckClone.error ?? {})).toBe(true);
      expect(deckClone.result.cardsCopy).toEqual({
        count: 1,
        idsReminted: true,
        drawnCleared: 0,
        unreturnableCards: 0
      });
      const handClone = await router().route(createRequest("cards.clone", { cardsId: "cards-hand-foreign" }));
      expect(handClone.ok, JSON.stringify(handClone.error ?? {})).toBe(true);
      expect(handClone.result.cardsCopy.unreturnableCards).toBe(1);
    });

    it("cardsCopy.unreturnableCards excludes a card whose origin no longer RESOLVES", async () => {
      const dangling = createCardsDocument("cards-clone-dangle", {
        name: "Hand With Dangling Origin",
        type: "hand",
        cards: [{ id: "card-dangling", name: "Dangling", origin: "cards-gone-forever" }]
      });
      const resolvable = createCardsDocument("cards-clone-resolvable", {
        name: "Hand With Resolvable Origin",
        type: "hand",
        cards: [{ id: "card-resolvable", name: "Resolvable", origin: "cards-deck" }]
      });
      globalThis.game.cards.set(dangling);
      globalThis.game.cards.set(resolvable);

      expect(globalThis.game.cards.get("cards-clone-dangle").cards.get("card-dangling").origin).toBeNull();
      expect(
        globalThis.game.cards.get("cards-clone-resolvable").cards.get("card-resolvable").origin
      ).toBeTruthy();

      const danglingClone = await router().route(
        createRequest("cards.clone", { cardsId: "cards-clone-dangle" })
      );
      expect(danglingClone.ok, JSON.stringify(danglingClone.error ?? {})).toBe(true);
      expect(danglingClone.result.cardsCopy).toEqual({
        count: 1,
        idsReminted: true,
        drawnCleared: 0,
        unreturnableCards: 0
      });
      const resolvableClone = await router().route(
        createRequest("cards.clone", { cardsId: "cards-clone-resolvable" })
      );
      expect(resolvableClone.ok, JSON.stringify(resolvableClone.error ?? {})).toBe(true);
      expect(resolvableClone.result.cardsCopy.unreturnableCards).toBe(1);
    });
  });

  describe("cards.card.* embedded family", () => {
    const router = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    it("cards.card.list returns lean rows that ALWAYS name their owning stack", async () => {
      const response = await router().route(createRequest("cards.card.list", { cardsId: "cards-deck" }));
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);

      expect(response.result.cardsId).toBe("cards-deck");
      expect(response.result.cards.map((row) => row.id)).toEqual(["card-ace", "card-king"]);
      expect(response.result.cards[0]).toEqual({
        id: "card-ace",
        _id: "card-ace",
        cardsId: "cards-deck",
        cardsName: "Poker Deck",
        name: "Stored Ace",
        type: "base",
        suit: "S",
        value: 1,
        face: 0,
        faceCount: 1,
        drawn: true,
        origin: null,
        sort: 100
      });

      for (const absent of ["back", "faces", "description", "system", "flags", "ownership", "img"]) {
        expect(response.result.cards[0]).not.toHaveProperty(absent);
      }
    });

    it("cards.card.list across ALL stacks shows the SAME card id under two different stacks", async () => {
      const response = await router().route(createRequest("cards.card.list", {}));
      expect(response.ok).toBe(true);

      expect(response.result).not.toHaveProperty("cardsId");

      const aces = response.result.cards.filter((row) => row.id === "card-ace");
      expect(aces.map((row) => row.cardsId)).toEqual(["cards-hand", "cards-deck"]);

      expect(aces[0].origin).toBe("cards-deck");
      expect(aces[1].origin).toBeNull();

      expect(response.result.cards.map((row) => `${row.cardsId}/${row.id}`)).toEqual([
        "cards-pile/card-king",
        "cards-hand/card-ace",
        "cards-hand/card-orphan",
        "cards-hand/card-own",
        "cards-deck/card-ace",
        "cards-deck/card-king"
      ]);
      expect(response.result.total).toBe(6);
    });

    it("cards.card.list orders stacks by SORT first, with non-finite sorts last", async () => {
      for (const [id, name, sort] of /** @type {Array<[string, string, any]>} */ ([
        ["cards-sort-late", "Aaa Sorted Late", 50],
        ["cards-sort-early", "Zzz Sorted Early", -10],
        ["cards-sort-broken", "Mmm Non Finite", "-99"]
      ])) {
        const stack = createCardsDocument(id, {
          name,
          type: "pile",
          sort,
          cards: [{ id: `${id}-card`, name: `${name} Card` }]
        });
        globalThis.game.cards.set(stack);
      }
      const response = await router().route(createRequest("cards.card.list", {}));
      expect(response.ok).toBe(true);

      expect(response.result.cards.map((row) => row.cardsId)).toEqual([
        "cards-sort-early",
        "cards-pile",
        "cards-hand",
        "cards-hand",
        "cards-hand",
        "cards-deck",
        "cards-deck",
        "cards-sort-late",
        "cards-sort-broken"
      ]);
    });

    it("cards.card.list paginates the CROSS-STACK read", async () => {
      const page = await router().route(createRequest("cards.card.list", { limit: 2, offset: 1 }));
      expect(page.ok).toBe(true);
      expect(page.result.cards.map((row) => `${row.cardsId}/${row.id}`)).toEqual([
        "cards-hand/card-ace",
        "cards-hand/card-orphan"
      ]);

      expect(page.result.total).toBe(6);
      expect(page.result.hasMore).toBe(true);

      const past = await router().route(createRequest("cards.card.list", { limit: 2, offset: 99 }));
      expect(past.ok).toBe(true);
      expect(past.result.cards).toEqual([]);
      expect(past.result.total).toBe(6);
      expect(past.result.hasMore).toBe(false);

      const scoped = await router().route(
        createRequest("cards.card.list", { cardsId: "cards-hand", limit: 1, offset: 2 })
      );
      expect(scoped.ok).toBe(true);
      expect(scoped.result.cards.map((row) => row.id)).toEqual(["card-own"]);
      expect(scoped.result.total).toBe(3);
      expect(scoped.result.hasMore).toBe(false);
    });

    it("the cards.card.list name filter matches the STORED name, NOT Foundry's derived one", async () => {
      expect(globalThis.game.cards.get("cards-deck").cards.get("card-ace").name).toBe("Face One");
      const stored = await router().route(
        createRequest("cards.card.list", { cardsId: "cards-deck", name: "stored ace" })
      );
      expect(stored.ok).toBe(true);
      expect(stored.result.cards.map((row) => row.id)).toEqual(["card-ace"]);
      expect(stored.result.cards[0].name).toBe("Stored Ace");
      const derived = await router().route(
        createRequest("cards.card.list", { cardsId: "cards-deck", name: "Face One" })
      );
      expect(derived.ok).toBe(true);
      expect(derived.result.cards).toEqual([]);
    });

    it("cards.card.list reports the PERSISTED drawn flag when the live one diverges", async () => {
      const stack = createCardsDocument("cards-row-divergence", {
        name: "Row Divergence",
        type: "deck",
        cards: [{ id: "card-live-row", name: "Live Row", liveDrawn: true }]
      });
      globalThis.game.cards.set(stack);
      expect(stack.cards.get("card-live-row").drawn).toBe(true);
      expect(stack.cards.get("card-live-row")._source.drawn).toBe(false);
      const list = await router().route(
        createRequest("cards.card.list", { cardsId: "cards-row-divergence" })
      );
      expect(list.result.cards[0].drawn).toBe(false);
      const read = await router().route(
        createRequest("cards.card.get", { cardsId: "cards-row-divergence", cardId: "card-live-row" })
      );
      expect(read.result.card.drawn).toBe(false);
    });

    it("cards.card.get is source-first, carries no img and no ownership", async () => {
      const response = await router().route(
        createRequest("cards.card.get", { cardsId: "cards-deck", cardId: "card-ace" })
      );
      expect(response.ok).toBe(true);
      expect(response.result.cardsId).toBe("cards-deck");
      const card = response.result.card;

      expect(card.name).toBe("Stored Ace");
      expect(card.back).toEqual({ text: "", img: null });
      expect(globalThis.game.cards.get("cards-deck").cards.get("card-ace").back.img).toBe(
        "worlds/test/deck.webp"
      );
      expect(card.faces).toEqual([{ name: "Face One", img: "worlds/test/ace.webp" }]);

      expect(card).not.toHaveProperty("img");

      expect(card).not.toHaveProperty("ownership");
      expect(card.drawn).toBe(true);
      expect(card.origin).toBeNull();
    });

    it("resolves the PARENT first: a bad cardsId is CARDS_NOT_FOUND, a bad cardId is CARD_NOT_FOUND", async () => {
      for (const [command, params] of /** @type {Array<[string, any]>} */ ([
        ["cards.card.get", { cardsId: "nope", cardId: "card-ace" }],
        ["cards.card.create", { cardsId: "nope", data: { name: "X" } }],
        ["cards.card.update", { cardsId: "nope", cardId: "card-ace", patch: { sort: 1 } }],
        ["cards.card.clone", { cardsId: "nope", cardId: "card-ace" }],
        ["cards.card.delete", { cardsId: "nope", cardId: "card-ace" }],
        ["cards.card.list", { cardsId: "nope" }]
      ])) {
        const response = await router().route(createRequest(command, params));
        expect(response.ok, command).toBe(false);
        expect(response.error.code, command).toBe(ERROR_CODES.CARDS_NOT_FOUND);
      }
      for (const [command, params] of /** @type {Array<[string, any]>} */ ([
        ["cards.card.get", { cardsId: "cards-deck", cardId: "nope" }],
        ["cards.card.update", { cardsId: "cards-deck", cardId: "nope", patch: { sort: 1 } }],
        ["cards.card.clone", { cardsId: "cards-deck", cardId: "nope" }],
        ["cards.card.delete", { cardsId: "cards-deck", cardId: "nope" }]
      ])) {
        const response = await router().route(createRequest(command, params));
        expect(response.ok, command).toBe(false);
        expect(response.error.code, command).toBe(ERROR_CODES.CARD_NOT_FOUND);
        expect(response.error.details).toEqual({ cardsId: "cards-deck", cardId: "nope" });
      }

      const crossed = await router().route(
        createRequest("cards.card.get", { cardsId: "cards-deck", cardId: "card-own" })
      );
      expect(crossed.ok).toBe(false);
      expect(crossed.error.code).toBe(ERROR_CODES.CARD_NOT_FOUND);
    });

    it("cards.card.create round-trips, and its dry run mints NO id and persists nothing", async () => {
      const stack = globalThis.game.cards.get("cards-hand");
      const before = stack.cards.size;
      const preview = await router().route(
        createRequest("cards.card.create", {
          cardsId: "cards-hand",
          data: {
            name: "Queen of Cups",
            suit: "C",
            value: 12,
            faces: [{ name: "Queen", img: "worlds/test/q.webp" }]
          },
          dryRun: true
        })
      );
      expect(preview.ok, JSON.stringify(preview.error ?? {})).toBe(true);
      expect(preview.result.dryRun).toBe(true);
      expect(preview.result.cardsId).toBe("cards-hand");

      expect(preview.result.card.id).toBeNull();
      expect(preview.result.card._id).toBeNull();
      expect(preview.result.card).toMatchObject({
        name: "Queen of Cups",
        suit: "C",
        value: 12,
        drawn: false,
        origin: null
      });
      expect(stack.cards.size).toBe(before);
      expect(stack.createEmbeddedDocuments).not.toHaveBeenCalled();

      const createParams = {
        cardsId: "cards-hand",
        data: { name: "Queen of Cups", suit: "C", value: 12 }
      };
      const created = await router().route(createRequest("cards.card.create", createParams));
      expect(created.ok, JSON.stringify(created.error ?? {})).toBe(true);
      expect(created.result.card.id).toBeTruthy();
      expect(created.result.card).toMatchObject({ name: "Queen of Cups", drawn: false, origin: null });
      expect(stack.cards.size).toBe(before + 1);

      expect(Object.keys(created.result.card).sort()).toEqual(Object.keys(preview.result.card).sort());

      expect(createParams.data).not.toHaveProperty("_stats");
      expect(createParams.data).not.toHaveProperty("_id");
      const cardCreateCall = stack.createEmbeddedDocuments.mock.calls.at(-1);
      expect(cardCreateCall[1][0]).not.toHaveProperty("_stats");
      expect(cardCreateCall[1][0]).not.toHaveProperty("_id");
    });

    it("cards.card.create reports a REFUSED create instead of serializing nothing", async () => {
      const stack = createCardsDocument("cards-create-veto", {
        name: "Create Veto",
        type: "pile",
        cards: []
      });
      globalThis.game.cards.set(stack);
      stack.vetoRowCreates = true;
      const refused = await router().route(
        createRequest("cards.card.create", { cardsId: "cards-create-veto", data: { name: "Never Lands" } })
      );
      expect(refused.ok).toBe(false);
      expect(refused.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);

      expect(refused.error.message).toContain("Card creation returned no document");
      expect(stack.cards.size).toBe(0);
      delete stack.vetoRowCreates;
    });

    it("a faces-bearing create agrees between the dry run and the real call, on the card AND the stack", async () => {
      const stack = createCardsDocument("cards-faces-parity", {
        name: "Faces Parity",
        type: "pile",
        cards: []
      });
      globalThis.game.cards.set(stack);
      const face = { name: "Front", img: "worlds/test/front.webp" };

      const cardDry = await router().route(
        createRequest("cards.card.create", {
          cardsId: "cards-faces-parity",
          data: { name: "Parity", faces: [{ ...face }] },
          dryRun: true
        })
      );
      const cardReal = await router().route(
        createRequest("cards.card.create", {
          cardsId: "cards-faces-parity",
          data: { name: "Parity", faces: [{ ...face }] }
        })
      );
      expect(cardDry.ok && cardReal.ok).toBe(true);
      expect(cardDry.result.card.faces).toEqual([face]);
      expect(cardReal.result.card.faces).toEqual(cardDry.result.card.faces);

      const inline = { name: "Inline", faces: [{ ...face }] };
      const stackDry = await router().route(
        createRequest("cards.create", {
          data: { name: "Parity Stack", type: "pile", cards: [{ ...inline, faces: [{ ...face }] }] },
          dryRun: true
        })
      );
      const stackReal = await router().route(
        createRequest("cards.create", {
          data: { name: "Parity Stack", type: "pile", cards: [{ ...inline, faces: [{ ...face }] }] }
        })
      );
      expect(stackDry.ok && stackReal.ok).toBe(true);
      expect(stackDry.result.cards.cards[0].faces).toEqual([face]);
      expect(stackReal.result.cards.cards[0].faces).toEqual(stackDry.result.cards.cards[0].faces);
    });

    it("cards.card.clone reports a REFUSED clone instead of serializing nothing", async () => {
      const stack = createCardsDocument("cards-clone-veto", {
        name: "Clone Veto",
        type: "pile",
        cards: [{ id: "card-original", name: "Original" }]
      });
      globalThis.game.cards.set(stack);
      stack.vetoRowCreates = true;
      const refused = await router().route(
        createRequest("cards.card.clone", { cardsId: "cards-clone-veto", cardId: "card-original" })
      );
      expect(refused.ok).toBe(false);
      expect(refused.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);

      expect(refused.error.message).toContain("Document clone returned no document");
      expect(stack.cards.size).toBe(1);

      delete stack.vetoRowCreates;
      const cloned = await router().route(
        createRequest("cards.card.clone", { cardsId: "cards-clone-veto", cardId: "card-original" })
      );
      expect(cloned.ok).toBe(true);
      expect(cloned.result.card.id).toBe("card-original-clone");
      expect(stack.cards.size).toBe(2);
    });

    it("canonicalizes back.img and faces[].img on create AND update AND clone", async () => {
      for (const [command, params] of /** @type {Array<[string, any]>} */ ([
        ["cards.card.create", { cardsId: "cards-deck", data: { name: "Blankish", back: { img: "   " } } }],
        ["cards.card.create", { cardsId: "cards-deck", data: { name: "Blankish", faces: [{ img: "   " }] } }],
        ["cards.card.update", { cardsId: "cards-deck", cardId: "card-ace", patch: { back: { img: "   " } } }],
        [
          "cards.card.update",
          { cardsId: "cards-deck", cardId: "card-ace", patch: { faces: [{ img: "   " }] } }
        ],
        ["cards.card.clone", { cardsId: "cards-deck", cardId: "card-ace", patch: { back: { img: "   " } } }],
        [
          "cards.card.clone",
          { cardsId: "cards-deck", cardId: "card-ace", patch: { faces: [{ img: "   " }] } }
        ]
      ])) {
        for (const extra of [{ dryRun: true }, {}]) {
          const response = await router().route(createRequest(command, { ...params, ...extra }));
          expect(response.ok, `${command} ${JSON.stringify({ ...params, ...extra })}`).toBe(false);
          expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
          expect(response.error.details.message).toContain("file extension");
        }
      }

      const empty = await router().route(
        createRequest("cards.card.create", {
          cardsId: "cards-deck",
          data: { name: "Blank", back: { img: "" } }
        })
      );
      expect(empty.ok).toBe(false);
      expect(empty.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    });

    it("cards.card.update MERGES a partial back and REPLACES the whole faces array", async () => {
      const stack = createCardsDocument("cards-patch-shapes", {
        name: "Patch Shapes",
        type: "pile",
        cards: [
          {
            id: "card-shapes",
            name: "Shapes",
            back: { name: "Back Name", text: "Back Text", img: "worlds/test/back.webp" },
            faces: [
              { name: "f1", text: "t1", img: "worlds/test/1.webp" },
              { name: "f2", text: "t2", img: "worlds/test/2.webp" }
            ],
            face: 1
          }
        ]
      });
      globalThis.game.cards.set(stack);

      const merged = await router().route(
        createRequest("cards.card.update", {
          cardsId: "cards-patch-shapes",
          cardId: "card-shapes",
          patch: { back: { img: "worlds/test/other.webp" } }
        })
      );
      expect(merged.ok, JSON.stringify(merged.error ?? {})).toBe(true);
      expect(merged.result.card.back).toEqual({
        name: "Back Name",
        text: "Back Text",
        img: "worlds/test/other.webp"
      });

      const replaced = await router().route(
        createRequest("cards.card.update", {
          cardsId: "cards-patch-shapes",
          cardId: "card-shapes",
          patch: { faces: [{ name: "only" }] }
        })
      );
      expect(replaced.ok, JSON.stringify(replaced.error ?? {})).toBe(true);
      expect(replaced.result.card.faces).toEqual([{ name: "only" }]);

      expect(replaced.result.card.face).toBe(1);
    });

    it("cards.card.update distinguishes a legitimate NO-OP from a vetoed write", async () => {
      const stack = createCardsDocument("cards-update-veto", {
        name: "Update Veto",
        type: "pile",
        cards: [{ id: "card-veto", name: "Vetoed", sort: 5 }]
      });
      globalThis.game.cards.set(stack);

      const noop = await router().route(
        createRequest("cards.card.update", {
          cardsId: "cards-update-veto",
          cardId: "card-veto",
          patch: { sort: 5 }
        })
      );
      expect(noop.ok, JSON.stringify(noop.error ?? {})).toBe(true);
      expect(noop.result.card.sort).toBe(5);

      stack.vetoRowUpdates = new Set(["card-veto"]);
      const vetoed = await router().route(
        createRequest("cards.card.update", {
          cardsId: "cards-update-veto",
          cardId: "card-veto",
          patch: { sort: 9 }
        })
      );
      expect(vetoed.ok).toBe(false);
      expect(vetoed.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(vetoed.error.message).toContain("preUpdateCard");
      expect(vetoed.error.details).toMatchObject({ cardsId: "cards-update-veto", cardId: "card-veto" });
      expect(stack.cards.get("card-veto")._source.sort).toBe(5);
      delete stack.vetoRowUpdates;

      const preview = await router().route(
        createRequest("cards.card.update", {
          cardsId: "cards-update-veto",
          cardId: "card-veto",
          patch: { name: "Renamed" },
          dryRun: true
        })
      );
      expect(preview.result.dryRun).toBe(true);
      expect(preview.result.card.name).toBe("Renamed");
      expect(stack.cards.get("card-veto")._source.name).toBe("Vetoed");
    });

    it("cards.card.update confirms an immutable nested request when preUpdateCard removes a leaf", async () => {
      const stack = createCardsDocument("cards-update-hook-mutation", {
        name: "Update Hook Mutation",
        type: "pile",
        cards: [
          {
            id: "card-hook-mutation",
            name: "Hook Mutation",
            back: { name: "Back", img: "worlds/test/original.webp" }
          }
        ]
      });
      globalThis.game.cards.set(stack);
      stack.updateEmbeddedDocuments = vi.fn(async (_type, entries) => {
        delete entries[0].back.img;
        return [];
      });

      const response = await router().route(
        createRequest("cards.card.update", {
          cardsId: "cards-update-hook-mutation",
          cardId: "card-hook-mutation",
          patch: { back: { img: "worlds/test/requested.webp" } }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("preUpdateCard");
      expect(response.error.details).toMatchObject({
        cardsId: "cards-update-hook-mutation",
        cardId: "card-hook-mutation",
        fields: ["back"]
      });
      expect(stack.cards.get("card-hook-mutation")._source.back.img).toBe("worlds/test/original.webp");
    });

    it("cards.card.clone keeps drawn AND origin verbatim on a NEW id", async () => {
      const hand = globalThis.game.cards.get("cards-hand");
      const before = hand.cards.size;
      const preview = await router().route(
        createRequest("cards.card.clone", { cardsId: "cards-hand", cardId: "card-ace", dryRun: true })
      );
      expect(preview.ok, JSON.stringify(preview.error ?? {})).toBe(true);
      expect(preview.result.dryRun).toBe(true);
      expect(preview.result.card.id).toBeNull();
      expect(hand.cards.size).toBe(before);

      const clone = await router().route(
        createRequest("cards.card.clone", {
          cardsId: "cards-hand",
          cardId: "card-ace",
          patch: { name: "Ace Copy" }
        })
      );
      expect(clone.ok, JSON.stringify(clone.error ?? {})).toBe(true);
      expect(clone.result.card.id).not.toBe("card-ace");
      expect(clone.result.card).toMatchObject({ name: "Ace Copy", drawn: true, origin: "cards-deck" });

      expect(globalThis.game.cards.get("cards-deck").cards.get(clone.result.card.id)).toBeNull();
      expect(hand.cards.size).toBe(before + 1);

      expect(preview.result.recallDeletesCopy).toBe(true);
      expect(clone.result.recallDeletesCopy).toBe(true);
    });

    it("recallDeletesCopy is the RECALL predicate, not `origin` being truthy — every cell", async () => {
      const dangling = createCardsDocument("cards-copy-dangle", {
        name: "Dangling Origin Hand",
        type: "hand",
        cards: [{ id: "card-dangle", name: "Dangling", origin: "cards-gone-forever" }]
      });
      const selfOrigin = createCardsDocument("cards-copy-self", {
        name: "Self Origin Hand",
        type: "hand",
        cards: [{ id: "card-self", name: "Self", origin: "cards-copy-self" }]
      });
      const deckFromDeck = createCardsDocument("cards-copy-deck-from-deck", {
        name: "Deck Holding A Deck's Card",
        type: "deck",
        cards: [{ id: "card-from-deck", name: "From Deck", origin: "cards-deck" }]
      });
      const deckFromHand = createCardsDocument("cards-copy-deck-from-hand", {
        name: "Deck Holding A Hand's Card",
        type: "deck",
        cards: [{ id: "card-from-hand", name: "From Hand", origin: "cards-hand" }]
      });

      const handFromHand = createCardsDocument("cards-copy-hand-from-hand", {
        name: "Hand Holding A Hand's Card",
        type: "hand",
        cards: [{ id: "card-from-hand-2", name: "From Hand", origin: "cards-hand" }]
      });
      for (const stack of [dangling, selfOrigin, deckFromDeck, deckFromHand, handFromHand]) {
        globalThis.game.cards.set(stack);
      }

      expect(globalThis.game.cards.get("cards-gone-forever")).toBeNull();
      expect(globalThis.game.cards.get("cards-deck").type).toBe("deck");
      expect(globalThis.game.cards.get("cards-hand").type).toBe("hand");

      for (const [
        cardsId,
        cardId,
        expected,
        why
      ] of /** @type {Array<[string, string, boolean, string]>} */ ([
        ["cards-hand", "card-ace", true, "hand parent, resolvable foreign origin"],

        ["cards-hand", "card-own", false, "no origin"],

        ["cards-copy-dangle", "card-dangle", false, "dangling origin"],

        ["cards-copy-self", "card-self", false, "self origin"],

        ["cards-copy-deck-from-deck", "card-from-deck", true, "deck parent, DECK origin"],

        ["cards-copy-deck-from-hand", "card-from-hand", false, "deck parent, HAND origin"],

        ["cards-copy-hand-from-hand", "card-from-hand-2", true, "hand parent, HAND origin"]
      ])) {
        const response = await router().route(createRequest("cards.card.clone", { cardsId, cardId }));
        expect(response.ok, `${why}: ${JSON.stringify(response.error ?? {})}`).toBe(true);
        expect(response.result.recallDeletesCopy, why).toBe(expected);

        if (why !== "no origin") expect(response.result.card.origin, why).toBeTruthy();
      }
    });

    it("cards.card.clone validates the SUPPLIED patch on both paths", async () => {
      for (const extra of [{ dryRun: true }, {}]) {
        const response = await router().route(
          createRequest("cards.card.clone", {
            cardsId: "cards-deck",
            cardId: "card-ace",
            patch: { back: { img: "notanimage.txt" } },
            ...extra
          })
        );
        expect(response.ok, JSON.stringify(extra)).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      }
    });

    it("an invalid faces[] entry is refused on update AND clone — on the v13 arm AND the v14 one", async () => {
      const v13 = createCardsDocument("cards-faces-v13", {
        name: "Faces v13",
        type: "pile",
        cards: [
          { id: "card-faces", name: "Facey", faces: [{ name: "Front", img: "worlds/test/front.webp" }] }
        ]
      });
      const v14 = createCardsDocument(
        "cards-faces-v14",
        {
          name: "Faces v14",
          type: "pile",
          cards: [
            { id: "card-faces", name: "Facey", faces: [{ name: "Front", img: "worlds/test/front.webp" }] }
          ]
        },
        { arrayFieldSwallowsInvalidFaces: true }
      );
      globalThis.game.cards.set(v13);
      globalThis.game.cards.set(v14);

      const badFaces = [{ name: "Ace", img: "worlds/test/ace.txt" }];
      for (const stack of [v13, v14]) {
        for (const command of ["cards.card.update", "cards.card.clone"]) {
          for (const extra of [{ dryRun: true }, {}]) {
            const label = `${stack.id} ${command} ${JSON.stringify(extra)}`;
            const response = await router().route(
              createRequest(command, {
                cardsId: stack.id,
                cardId: "card-faces",
                patch: { faces: badFaces },
                ...extra
              })
            );
            expect(response.ok, label).toBe(false);
            expect(response.error.code, label).toBe(ERROR_CODES.INVALID_PARAMS);

            expect(response.error.details.message, label).toContain("file extension");
          }
        }

        expect(stack.cards.get("card-faces").toObject().faces, stack.id).toEqual([
          { name: "Front", img: "worlds/test/front.webp" }
        ]);
        expect(stack.cards.size, stack.id).toBe(1);
      }

      expect(badFaces).toEqual([{ name: "Ace", img: "worlds/test/ace.txt" }]);

      const goodFaces = [{ name: "Two", img: "worlds/test/two.webp" }];
      const ok = await router().route(
        createRequest("cards.card.update", {
          cardsId: "cards-faces-v14",
          cardId: "card-faces",
          patch: { faces: goodFaces }
        })
      );
      expect(ok.ok).toBe(true);
      expect(ok.result.card.faces).toEqual([{ name: "Two", img: "worlds/test/two.webp" }]);

      expect(goodFaces).toEqual([{ name: "Two", img: "worlds/test/two.webp" }]);
      const cleared = await router().route(
        createRequest("cards.card.update", {
          cardsId: "cards-faces-v14",
          cardId: "card-faces",
          patch: { faces: [] }
        })
      );
      expect(cleared.ok).toBe(true);
      expect(cleared.result.card.faces).toEqual([]);
    });

    it("cards.card.delete confirms the removal against Foundry's own answer", async () => {
      const stack = createCardsDocument("cards-delete-row", {
        name: "Delete Row",
        type: "pile",
        cards: [
          { id: "card-doomed", name: "Doomed" },
          { id: "card-safe", name: "Safe" }
        ]
      });
      globalThis.game.cards.set(stack);
      const preview = await router().route(
        createRequest("cards.card.delete", {
          cardsId: "cards-delete-row",
          cardId: "card-doomed",
          dryRun: true
        })
      );
      expect(preview.ok).toBe(true);
      expect(preview.result).toMatchObject({
        cardsId: "cards-delete-row",
        id: "card-doomed",
        deleted: false,
        dryRun: true
      });
      expect(stack.cards.get("card-doomed")).toBeTruthy();
      expect(stack.deleteEmbeddedDocuments).not.toHaveBeenCalled();

      stack.vetoRowDeletes = new Set(["card-doomed"]);
      const vetoed = await router().route(
        createRequest("cards.card.delete", { cardsId: "cards-delete-row", cardId: "card-doomed" })
      );
      expect(vetoed.ok).toBe(false);
      expect(vetoed.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(vetoed.error.message).toContain("preDeleteCard");
      expect(stack.cards.get("card-doomed")).toBeTruthy();
      delete stack.vetoRowDeletes;

      const deleted = await router().route(
        createRequest("cards.card.delete", { cardsId: "cards-delete-row", cardId: "card-doomed" })
      );
      expect(deleted.ok, JSON.stringify(deleted.error ?? {})).toBe(true);
      expect(deleted.result).toEqual({ cardsId: "cards-delete-row", id: "card-doomed", deleted: true });
      expect(stack.cards.get("card-doomed")).toBeNull();

      const gone = await router().route(
        createRequest("cards.card.get", { cardsId: "cards-delete-row", cardId: "card-doomed" })
      );
      expect(gone.error.code).toBe(ERROR_CODES.CARD_NOT_FOUND);
      const safe = await router().route(
        createRequest("cards.card.get", { cardsId: "cards-delete-row", cardId: "card-safe" })
      );
      expect(safe.ok).toBe(true);
    });

    it("serializes ALL FOUR mutating cards.card.* writes on the SAME queue as the stack verbs", async () => {
      const stack = createCardsDocument("cards-queue-rows", {
        name: "Queue Rows",
        type: "pile",
        cards: [
          { id: "card-q1", name: "Q1", sort: 1 },
          { id: "card-q2", name: "Q2", sort: 2 }
        ]
      });
      globalThis.game.cards.set(stack);
      const events = [];
      /** @type {() => void} */
      let release = () => {};
      const gate = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      const originalStackUpdate = stack.update;
      stack.update = vi.fn(async (...args) => {
        events.push("stack-update-start");
        await gate;
        events.push("stack-update-end");
        return originalStackUpdate(...args);
      });
      const originalCreate = stack.createEmbeddedDocuments;
      stack.createEmbeddedDocuments = vi.fn(async (...args) => {
        events.push("row-create");
        return originalCreate(...args);
      });
      const originalUpdate = stack.updateEmbeddedDocuments;
      stack.updateEmbeddedDocuments = vi.fn(async (...args) => {
        events.push("row-update");
        return originalUpdate(...args);
      });
      const originalDelete = stack.deleteEmbeddedDocuments;
      stack.deleteEmbeddedDocuments = vi.fn(async (...args) => {
        events.push("row-delete");
        return originalDelete(...args);
      });
      const originalCardClone = stack.cards.get("card-q1").clone;
      stack.cards.get("card-q1").clone = vi.fn(async (patch, context = {}) => {
        events.push(context.save ? "row-clone-save" : "row-clone-probe");
        return originalCardClone(patch, context);
      });

      const pending = [
        router().route(createRequest("cards.update", { cardsId: "cards-queue-rows", patch: { sort: 7 } })),
        router().route(
          createRequest("cards.card.create", { cardsId: "cards-queue-rows", data: { name: "Q3" } })
        ),
        router().route(
          createRequest("cards.card.update", {
            cardsId: "cards-queue-rows",
            cardId: "card-q1",
            patch: { sort: 9 }
          })
        ),
        router().route(createRequest("cards.card.clone", { cardsId: "cards-queue-rows", cardId: "card-q1" })),
        router().route(createRequest("cards.card.delete", { cardsId: "cards-queue-rows", cardId: "card-q2" }))
      ];
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(events).toEqual(["stack-update-start"]);
      release();
      const responses = await Promise.all(pending);
      expect(
        responses.map((response) => response.ok),
        JSON.stringify(responses.map((response) => response.error ?? null))
      ).toEqual([true, true, true, true, true]);
      expect(events).toEqual([
        "stack-update-start",
        "stack-update-end",
        "row-create",
        "row-update",
        "row-clone-probe",
        "row-clone-save",
        "row-delete"
      ]);
    });
  });

  describe("cards ACTION verbs", () => {
    const router = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const KEY = { idempotencyKey: "cards-action-key" };

    /**
     * @param {string} id
     * @param {{ cards?: any[], type?: string }} [overrides]
     */
    const seedStack = (id, overrides = {}) => {
      const stack = createCardsDocument(id, {
        name: `Stack ${id}`,
        type: overrides.type ?? "deck",
        cards: overrides.cards ?? []
      });
      globalThis.game.cards.set(stack);
      return stack;
    };

    const deckOf = (id, count) =>
      seedStack(id, {
        type: "deck",
        cards: Array.from({ length: count }, (_, index) => ({
          id: `${id}-c${index + 1}`,
          name: `C${index + 1}`,
          sort: (index + 1) * 100
        }))
      });

    it("every action verb reports a MISSING typed method as BRIDGE_NOT_READY, never as a partial commit", async () => {
      const deck = deckOf("nocap-deck", 3);
      const hand = seedStack("nocap-hand", { type: "hand" });

      const handWithCards = seedStack("nocap-hand2", {
        type: "hand",
        cards: [{ id: "nocap-deck-c1", name: "C1", origin: "nocap-deck", drawn: true }]
      });
      for (const method of ["deal", "draw", "pass", "shuffle", "recall"]) {
        delete deck[method];
        delete hand[method];
        delete handWithCards[method];
      }

      for (const { command, params } of [
        { command: "cards.deal", params: { cardsId: "nocap-deck", to: ["nocap-hand"], ...KEY } },
        {
          command: "cards.deal",
          params: { cardsId: "nocap-deck", to: ["nocap-hand"], dryRun: true, ...KEY }
        },
        { command: "cards.draw", params: { cardsId: "nocap-hand", from: "nocap-deck", ...KEY } },
        {
          command: "cards.draw",
          params: { cardsId: "nocap-hand", from: "nocap-deck", dryRun: true, ...KEY }
        },
        {
          command: "cards.pass",
          params: { cardsId: "nocap-hand2", to: "nocap-hand", cardIds: ["nocap-deck-c1"], ...KEY }
        },
        {
          command: "cards.pass",
          params: {
            cardsId: "nocap-hand2",
            to: "nocap-hand",
            cardIds: ["nocap-deck-c1"],
            dryRun: true,
            ...KEY
          }
        },
        { command: "cards.shuffle", params: { cardsId: "nocap-deck" } },
        { command: "cards.shuffle", params: { cardsId: "nocap-deck", dryRun: true } },

        { command: "cards.reset", params: { cardsId: "nocap-deck" } },
        { command: "cards.reset", params: { cardsId: "nocap-deck", dryRun: true } },
        { command: "cards.reset", params: { cardsId: "nocap-hand2" } },
        { command: "cards.reset", params: { cardsId: "nocap-hand2", dryRun: true } }
      ]) {
        const response = await router().route(createRequest(command, params));
        const label = `${command} ${JSON.stringify(params)}`;

        expect(response.ok, label).toBe(false);
        expect(response.error.code, label).toBe("BRIDGE_NOT_READY");
      }

      for (const { command, params } of [
        { command: "cards.shuffle", params: { cardsId: "no-such-stack" } },
        { command: "cards.reset", params: { cardsId: "no-such-stack" } },
        { command: "cards.deal", params: { cardsId: "no-such-stack", to: ["nocap-hand"], ...KEY } },
        { command: "cards.draw", params: { cardsId: "no-such-stack", from: "nocap-deck", ...KEY } },
        {
          command: "cards.pass",
          params: { cardsId: "no-such-stack", to: "nocap-hand", cardIds: ["x"], ...KEY }
        }
      ]) {
        const response = await router().route(createRequest(command, params));
        expect(response.ok, command).toBe(false);
        expect(response.error.code, command).toBe("CARDS_NOT_FOUND");
      }
    });

    it("cards.draw gates the SOURCE's `pass` too — `draw` is one line of delegation into it", async () => {
      deckOf("draw-nopass-src", 2);
      const hand = seedStack("draw-nopass-hand", { type: "hand" });
      delete globalThis.game.cards.get("draw-nopass-src").pass;
      for (const dryRun of [false, true]) {
        const response = await router().route(
          createRequest("cards.draw", {
            cardsId: "draw-nopass-hand",
            from: "draw-nopass-src",
            ...(dryRun ? { dryRun: true } : {}),
            ...KEY
          })
        );
        expect(response.ok, String(dryRun)).toBe(false);
        expect(response.error.code, String(dryRun)).toBe("BRIDGE_NOT_READY");
        expect(response.error.message).toContain("cards.draw");
      }
      expect(hand.cards.size).toBe(0);
    });

    it("cards.shuffle dry run calls no method and reports the surface-wide not-executed markers", async () => {
      const deck = deckOf("shuffle-dry", 3);
      const response = await router().route(
        createRequest("cards.shuffle", { cardsId: "shuffle-dry", dryRun: true })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result).toEqual({
        cardsId: "shuffle-dry",
        complete: true,
        mutation: "not-executed",
        reconciliation: "not-executed",
        shuffle: { count: 3, orderChanged: false },
        chatNotification: { requested: false, status: "not-requested" },
        dryRun: true
      });
      expect(deck.shuffle).not.toHaveBeenCalled();
      expect(deck.chatPosts ?? 0).toBe(0);
    });

    it("cards.shuffle confirms the DELTA — a permutation that changes nothing is `unknown`, not committed", async () => {
      const deck = deckOf("shuffle-real", 3);
      const response = await router().route(createRequest("cards.shuffle", { cardsId: "shuffle-real" }));
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.mutation).toBe("committed");
      expect(response.result.reconciliation).toBe("confirmed");
      expect(response.result.complete).toBe(true);
      expect(response.result.shuffle).toEqual({ count: 3, orderChanged: true });

      expect(response.result.chatNotification).toEqual({ requested: true, status: "dispatched" });
      expect(deck.chatPosts).toBe(1);
      expect([...deck.cards].map((card) => card._source.sort).sort()).toEqual([0, 1, 2]);

      deck.shuffleOrder = [...deck.cards]
        .sort((a, b) => (a._source.sort ?? 0) - (b._source.sort ?? 0))
        .map((card) => card.id);
      const identity = await router().route(createRequest("cards.shuffle", { cardsId: "shuffle-real" }));
      expect(identity.ok).toBe(true);
      expect(identity.result.mutation).toBe("unknown");
      expect(identity.result.complete).toBe(false);
      expect(identity.result.shuffle.orderChanged).toBe(false);

      expect(identity.result.reconciliation).toBe("confirmed");
    });

    it("cards.shuffle of a PRE-CALL empty or single-card stack is committed, not `unknown`", async () => {
      seedStack("shuffle-empty", { type: "pile", cards: [] });
      const empty = await router().route(createRequest("cards.shuffle", { cardsId: "shuffle-empty" }));
      expect(empty.ok, JSON.stringify(empty.error ?? {})).toBe(true);
      expect(empty.result.shuffle).toEqual({ count: 0, orderChanged: false });
      expect(empty.result.mutation).toBe("committed");
      expect(empty.result.complete).toBe(true);

      seedStack("shuffle-single", {
        type: "pile",
        cards: [{ id: "shuffle-single-c1", name: "C1", sort: 0 }]
      });
      const single = await router().route(createRequest("cards.shuffle", { cardsId: "shuffle-single" }));
      expect(single.ok, JSON.stringify(single.error ?? {})).toBe(true);
      expect(single.result.shuffle).toEqual({ count: 1, orderChanged: false });
      expect(single.result.mutation).toBe("committed");
      expect(single.result.complete).toBe(true);
    });

    it("cards.shuffle --no-chat reports not-requested and posts nothing", async () => {
      const deck = deckOf("shuffle-quiet", 2);
      const response = await router().route(
        createRequest("cards.shuffle", { cardsId: "shuffle-quiet", chat: false })
      );
      expect(response.ok).toBe(true);
      expect(response.result.chatNotification).toEqual({ requested: false, status: "not-requested" });
      expect(response.result.complete).toBe(true);
      expect(deck.chatPosts ?? 0).toBe(0);
    });

    it("--no-chat is FORWARDED by every action verb, not merely echoed back", async () => {
      const resetDeck = deckOf("quiet-reset", 1);
      resetDeck.cards.get("quiet-reset-c1")._source.drawn = true;
      seedStack("quiet-reset-hand", {
        type: "hand",
        cards: [{ id: "quiet-reset-c1", name: "C1", drawn: true, origin: "quiet-reset" }]
      });
      const loudReset = await router().route(createRequest("cards.reset", { cardsId: "quiet-reset" }));
      expect(loudReset.ok, JSON.stringify(loudReset.error ?? {})).toBe(true);
      expect(resetDeck.chatPosts).toBe(1);
      const quietReset = await router().route(
        createRequest("cards.reset", { cardsId: "quiet-reset", chat: false })
      );
      expect(quietReset.ok, JSON.stringify(quietReset.error ?? {})).toBe(true);
      expect(quietReset.result.chatNotification).toEqual({ requested: false, status: "not-requested" });
      expect(resetDeck.chatPosts).toBe(1);

      const dealDeck = deckOf("quiet-deal", 2);
      seedStack("quiet-deal-hand", { type: "hand" });
      const loudDeal = await router().route(
        createRequest("cards.deal", { cardsId: "quiet-deal", to: ["quiet-deal-hand"], ...KEY })
      );
      expect(loudDeal.ok, JSON.stringify(loudDeal.error ?? {})).toBe(true);
      expect(dealDeck.chatPosts).toBe(1);
      const quietDeal = await router().route(
        createRequest("cards.deal", { cardsId: "quiet-deal", to: ["quiet-deal-hand"], chat: false, ...KEY })
      );
      expect(quietDeal.ok, JSON.stringify(quietDeal.error ?? {})).toBe(true);
      expect(quietDeal.result.chatNotification).toEqual({ requested: false, status: "not-requested" });
      expect(dealDeck.chatPosts).toBe(1);

      const drawDeck = deckOf("quiet-draw-src", 2);
      seedStack("quiet-draw-hand", { type: "hand" });
      const loudDraw = await router().route(
        createRequest("cards.draw", { cardsId: "quiet-draw-hand", from: "quiet-draw-src", ...KEY })
      );
      expect(loudDraw.ok, JSON.stringify(loudDraw.error ?? {})).toBe(true);
      expect(drawDeck.chatPosts).toBe(1);
      const quietDraw = await router().route(
        createRequest("cards.draw", {
          cardsId: "quiet-draw-hand",
          from: "quiet-draw-src",
          chat: false,
          ...KEY
        })
      );
      expect(quietDraw.ok, JSON.stringify(quietDraw.error ?? {})).toBe(true);
      expect(quietDraw.result.chatNotification).toEqual({ requested: false, status: "not-requested" });
      expect(drawDeck.chatPosts).toBe(1);

      const passHand = seedStack("quiet-pass-hand", {
        type: "hand",
        cards: [
          { id: "quiet-pass-a", name: "A", origin: null },
          { id: "quiet-pass-b", name: "B", origin: null }
        ]
      });
      seedStack("quiet-pass-pile", { type: "pile" });
      const loudPass = await router().route(
        createRequest("cards.pass", {
          cardsId: "quiet-pass-hand",
          to: "quiet-pass-pile",
          cardIds: ["quiet-pass-a"],
          ...KEY
        })
      );
      expect(loudPass.ok, JSON.stringify(loudPass.error ?? {})).toBe(true);
      expect(passHand.chatPosts).toBe(1);
      const quietPass = await router().route(
        createRequest("cards.pass", {
          cardsId: "quiet-pass-hand",
          to: "quiet-pass-pile",
          cardIds: ["quiet-pass-b"],
          chat: false,
          ...KEY
        })
      );
      expect(quietPass.ok, JSON.stringify(quietPass.error ?? {})).toBe(true);
      expect(quietPass.result.chatNotification).toEqual({ requested: false, status: "not-requested" });
      expect(passHand.chatPosts).toBe(1);
    });

    it("cards.shuffle RE-THROWS a rejection that changed nothing (clean failure, uncached) and reports one that did", async () => {
      const deck = deckOf("shuffle-fail", 3);
      deck.actionThrowsBeforeWrite = new Error("socket down");
      const clean = await router().route(createRequest("cards.shuffle", { cardsId: "shuffle-fail" }));
      expect(clean.ok).toBe(false);
      expect(clean.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(clean.error.details.message).toContain("socket down");
      delete deck.actionThrowsBeforeWrite;

      deck.actionThrowsAfterWrite = new Error("socket died mid-flight");
      const partial = await router().route(createRequest("cards.shuffle", { cardsId: "shuffle-fail" }));
      expect(partial.ok).toBe(true);
      expect(partial.result.complete).toBe(false);
      expect(partial.result.mutation).toBe("committed");

      expect(partial.result.reconciliation).toBe("confirmed");
      expect(partial.result.chatNotification).toEqual({ requested: true, status: "not-dispatched" });
      expect(partial.result.failure.message).toContain("socket died mid-flight");
      expect(deck.chatPosts ?? 0).toBe(0);
    });

    it("cards.shuffle reports a PARTIALLY refused batch as INTERNAL_ERROR (the sorts are no longer a permutation)", async () => {
      const deck = deckOf("shuffle-veto", 3);
      deck.vetoRowUpdates = new Set(["shuffle-veto-c1"]);
      const response = await router().route(createRequest("cards.shuffle", { cardsId: "shuffle-veto" }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("permutation");
      expect(response.error.details.mutation).toBe("partial");
    });

    it("cards.shuffle reports the ACCEPTED residual — a refused subset leaving a valid permutation — as committed", async () => {
      const deck = deckOf("shuffle-valid-partial", 4);

      for (const [index, card] of [...deck.cards].entries()) {
        card._source.sort = index;
        card.sort = index;
      }
      deck.shuffleOrder = [
        "shuffle-valid-partial-c2",
        "shuffle-valid-partial-c1",
        "shuffle-valid-partial-c4",
        "shuffle-valid-partial-c3"
      ];
      deck.vetoRowUpdates = new Set(["shuffle-valid-partial-c1", "shuffle-valid-partial-c2"]);

      const response = await router().route(
        createRequest("cards.shuffle", { cardsId: "shuffle-valid-partial" })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.shuffle).toEqual({ count: 4, orderChanged: true });
      expect(response.result.complete).toBe(true);
      expect(response.result.mutation).toBe("committed");
      expect(response.result.reconciliation).toBe("confirmed");
      expect(response.result.chatNotification).toEqual({ requested: true, status: "dispatched" });
      expect([...deck.cards].map((card) => card._source.sort).sort()).toEqual([0, 1, 2, 3]);
    });

    it("a HEALTHY shuffle that leaves a FIXED POINT is committed, not partial", async () => {
      const deck = deckOf("shuffle-fixed-point", 6);
      for (const [index, card] of [...deck.cards].entries()) {
        card._source.sort = index;
        card.sort = index;
      }
      deck.shuffleOrder = [
        "shuffle-fixed-point-c2",
        "shuffle-fixed-point-c1",
        "shuffle-fixed-point-c3",
        "shuffle-fixed-point-c5",
        "shuffle-fixed-point-c6",
        "shuffle-fixed-point-c4"
      ];

      const response = await router().route(
        createRequest("cards.shuffle", { cardsId: "shuffle-fixed-point", chat: false })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.shuffle).toEqual({ count: 6, orderChanged: true });
      expect(response.result.complete).toBe(true);
      expect(response.result.mutation).toBe("committed");
      expect(response.result.reconciliation).toBe("confirmed");

      const sorts = new Map([...deck.cards].map((card) => [card.id, card._source.sort]));
      expect(sorts.get("shuffle-fixed-point-c3")).toBe(2);
      expect([...sorts.values()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it("a WHOLLY refused shuffle is not made a commit by a concurrent card REMOVAL", async () => {
      const deck = deckOf("shuffle-shrink", 3);

      for (const [index, card] of [...deck.cards].entries()) {
        card._source.sort = index;
        card.sort = index;
      }
      deck.vetoRowUpdates = new Set(["shuffle-shrink-c1", "shuffle-shrink-c2", "shuffle-shrink-c3"]);
      const shuffled = deck.shuffle;
      deck.shuffle = vi.fn(async (options) => {
        const result = await shuffled(options);
        deck.cards.delete("shuffle-shrink-c3");
        return result;
      });
      const response = await router().route(createRequest("cards.shuffle", { cardsId: "shuffle-shrink" }));
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.shuffle).toEqual({ count: 2, orderChanged: false });
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.complete).toBe(false);
      expect(deck.cards.get("shuffle-shrink-c1")._source.sort).toBe(0);
      expect(deck.cards.get("shuffle-shrink-c2")._source.sort).toBe(1);
    });

    it("a refused NONTRIVIAL shuffle is not made trivial by concurrent removals", async () => {
      const deck = deckOf("shuffle-shrink-to-one", 3);
      for (const [index, card] of [...deck.cards].entries()) {
        card._source.sort = index;
        card.sort = index;
      }
      deck.vetoRowUpdates = new Set([
        "shuffle-shrink-to-one-c1",
        "shuffle-shrink-to-one-c2",
        "shuffle-shrink-to-one-c3"
      ]);
      const shuffled = deck.shuffle;
      deck.shuffle = vi.fn(async (options) => {
        const result = await shuffled(options);
        deck.cards.delete("shuffle-shrink-to-one-c2");
        deck.cards.delete("shuffle-shrink-to-one-c3");
        return result;
      });

      const response = await router().route(
        createRequest("cards.shuffle", { cardsId: "shuffle-shrink-to-one" })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.shuffle).toEqual({ count: 1, orderChanged: false });
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.complete).toBe(false);
      expect(deck.cards.get("shuffle-shrink-to-one-c1")._source.sort).toBe(0);
    });

    it("a WHOLLY refused shuffle is not made a commit by a concurrent card CREATE either", async () => {
      const deck = deckOf("shuffle-refused-added", 3);

      for (const [index, card] of [...deck.cards].entries()) {
        card._source.sort = index;
        card.sort = index;
      }
      deck.vetoRowUpdates = new Set([
        "shuffle-refused-added-c1",
        "shuffle-refused-added-c2",
        "shuffle-refused-added-c3"
      ]);
      const shuffled = deck.shuffle;
      deck.shuffle = vi.fn(async (options) => {
        const result = await shuffled(options);
        await deck.createEmbeddedDocuments("Card", [{ id: "shuffle-refused-late", name: "Late", sort: 300 }]);
        return result;
      });
      const response = await router().route(
        createRequest("cards.shuffle", { cardsId: "shuffle-refused-added" })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.shuffle).toEqual({ count: 4, orderChanged: false });
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.complete).toBe(false);

      for (const [index, cardId] of [
        "shuffle-refused-added-c1",
        "shuffle-refused-added-c2",
        "shuffle-refused-added-c3"
      ].entries()) {
        expect(deck.cards.get(cardId)._source.sort).toBe(index);
      }
    });

    it("a LANDED shuffle is not called a refused batch by a concurrent card REMOVAL", async () => {
      const deck = deckOf("shuffle-grow", 3);
      const shuffled = deck.shuffle;
      deck.shuffle = vi.fn(async (options) => {
        const result = await shuffled(options);
        deck.cards.delete("shuffle-grow-c2");
        return result;
      });
      const response = await router().route(createRequest("cards.shuffle", { cardsId: "shuffle-grow" }));
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);

      expect(response.result.shuffle).toEqual({ count: 2, orderChanged: true });
      expect(response.result.mutation).toBe("committed");
      expect(response.result.complete).toBe(true);
      expect(deck.cards.get("shuffle-grow-c1")._source.sort).toBe(2);
      expect(deck.cards.get("shuffle-grow-c3")._source.sort).toBe(0);
    });

    it("a LANDED shuffle is not called a refused batch by a concurrent card CREATE either", async () => {
      const deck = deckOf("shuffle-added", 2);
      const shuffled = deck.shuffle;
      deck.shuffle = vi.fn(async (options) => {
        const result = await shuffled(options);
        await deck.createEmbeddedDocuments("Card", [{ id: "shuffle-added-late", name: "Late", sort: 300 }]);
        return result;
      });
      const response = await router().route(createRequest("cards.shuffle", { cardsId: "shuffle-added" }));
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.shuffle).toEqual({ count: 3, orderChanged: true });
      expect(response.result.mutation).toBe("committed");
      expect(deck.cards.get("shuffle-added-c2")._source.sort).toBe(0);
      expect(deck.cards.get("shuffle-added-late")._source.sort).toBe(300);
    });

    it("cards.reset calls Cards#recall — NOT stack.reset() — and confirms the recall's DELTA", async () => {
      const deck = deckOf("reset-deck", 2);
      for (const card of deck.cards) {
        card._source.drawn = true;
        card.drawn = true;
      }
      const hand = seedStack("reset-hand", {
        type: "hand",
        cards: [{ id: "reset-deck-c1", name: "C1", drawn: true, origin: "reset-deck" }]
      });

      const response = await router().route(createRequest("cards.reset", { cardsId: "reset-deck" }));
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);

      expect(deck.recall).toHaveBeenCalledTimes(1);
      expect(response.result.mutation).toBe("committed");
      expect(response.result.reconciliation).toBe("confirmed");
      expect(response.result.complete).toBe(true);
      expect(response.result.recall.status).toBe("confirmed");
      expect(response.result.recall.type).toBe("deck");
      expect(response.result.recall.reclaimed).toEqual([
        {
          cardsId: "reset-hand",
          cardsName: "Stack reset-hand",
          cardIds: ["reset-deck-c1"],
          cardIdsCount: 1,
          cardIdsTruncated: false
        }
      ]);

      expect(response.result.recall).not.toHaveProperty("danglingOriginsLeft");
      expect(response.result.recall).not.toHaveProperty("originRowsLeftDrawn");
      expect(response.result.recall).not.toHaveProperty("deleteConsequences");

      expect(hand.cards.get("reset-deck-c1")).toBeNull();
      expect([...deck.cards].every((card) => card._source.drawn === false)).toBe(true);
      expect(deck.chatPosts).toBe(1);
    });

    it("cards.reset THROWS when a resolved recall's writes are not in stored state (the veto shape)", async () => {
      const deck = deckOf("reset-vetoed", 2);
      for (const card of deck.cards) {
        card._source.drawn = true;
        card.drawn = true;
      }
      seedStack("reset-vetoed-hand", {
        type: "hand",
        cards: [{ id: "reset-vetoed-c1", name: "C1", drawn: true, origin: "reset-vetoed" }]
      });

      deck.vetoOwnCardUpdates = true;
      const response = await router().route(createRequest("cards.reset", { cardsId: "reset-vetoed" }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details.recall.status).toBe("unconfirmed");
      expect(response.error.details.recall.unconfirmed.ownRowsStillDrawn).toEqual([
        "reset-vetoed-c1",
        "reset-vetoed-c2"
      ]);

      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "dispatched" });
      expect(response.error.details.mutation).toBe("partial");
    });

    it("a DECK reset where NOTHING landed still reports the chat as dispatched (the type arm is load-bearing)", async () => {
      const deck = deckOf("reset-deck-nothing", 2);
      for (const card of deck.cards) {
        card._source.drawn = true;
        card.drawn = true;
      }
      deck.vetoOwnCardUpdates = true;
      const response = await router().route(createRequest("cards.reset", { cardsId: "reset-deck-nothing" }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details.recall.status).toBe("unconfirmed");

      expect(response.error.details.mutation).toBe("unknown");

      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "dispatched" });
      expect(deck.chatPosts).toBe(1);
    });

    it("cards.reset on a HAND reports `unknown` chat when a returnCards veto left nothing written", async () => {
      const deck = deckOf("reset-hand-origin", 1);
      deck.cards.get("reset-hand-origin-c1")._source.drawn = true;
      deck.cards.get("reset-hand-origin-c1").drawn = true;
      const hand = seedStack("reset-hand-veto", {
        type: "hand",
        cards: [{ id: "reset-hand-origin-c1", name: "C1", drawn: true, origin: "reset-hand-origin" }]
      });
      hand.vetoRecall = true;
      const response = await router().route(createRequest("cards.reset", { cardsId: "reset-hand-veto" }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details.mutation).toBe("unknown");

      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "unknown" });
      expect(hand.chatPosts ?? 0).toBe(0);

      expect(response.error.message).toContain("(2 of 2 expected change(s) missing)");
    });

    it("cards.reset does not count an ALREADY-AVAILABLE origin row as a landed write", async () => {
      const deck = deckOf("reset-avail-origin", 1);
      deck.cards.get("reset-avail-origin-c1")._source.drawn = false;
      deck.cards.get("reset-avail-origin-c1").drawn = false;
      const hand = seedStack("reset-avail-hand", {
        type: "hand",
        cards: [{ id: "reset-avail-origin-c1", name: "C1", drawn: true, origin: "reset-avail-origin" }]
      });
      hand.vetoRecall = true;
      const response = await router().route(createRequest("cards.reset", { cardsId: "reset-avail-hand" }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details.mutation).toBe("unknown");
      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "unknown" });

      expect(response.error.message).toContain("(1 of 1 expected change(s) missing)");
      expect(hand.chatPosts ?? 0).toBe(0);
    });

    it("cards.reset reports the ORDINARY silent row drop as `unknown` when the origin row was already available", async () => {
      const deck = deckOf("reset-avail2-origin", 1);
      deck.cards.get("reset-avail2-origin-c1")._source.drawn = false;
      deck.cards.get("reset-avail2-origin-c1").drawn = false;
      const hand = seedStack("reset-avail2-hand", {
        type: "hand",
        cards: [{ id: "reset-avail2-origin-c1", name: "C1", drawn: true, origin: "reset-avail2-origin" }]
      });
      hand.vetoOwnCardDeletes = true;
      const response = await router().route(createRequest("cards.reset", { cardsId: "reset-avail2-hand" }));
      expect(response.ok).toBe(false);
      expect(response.error.details.mutation).toBe("unknown");
      expect(response.error.details.recall.unconfirmed.notRemovedCardIds).toEqual(["reset-avail2-origin-c1"]);
      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "unknown" });
      expect(hand.chatPosts).toBe(1);

      expect(hand.cards.get("reset-avail2-origin-c1")).toBeTruthy();
    });

    it("cards.reset keeps `remaining` within `expected` when an origin STACK vanishes mid-call", async () => {
      const deck = deckOf("reset-gone-origin", 1);
      deck.cards.get("reset-gone-origin-c1")._source.drawn = false;
      deck.cards.get("reset-gone-origin-c1").drawn = false;
      const hand = seedStack("reset-gone-hand", {
        type: "hand",
        cards: [{ id: "reset-gone-origin-c1", name: "C1", drawn: true, origin: "reset-gone-origin" }]
      });
      hand.vanishDuringRecall = ["reset-gone-origin"];
      hand.vetoOwnCardDeletes = true;
      const response = await router().route(createRequest("cards.reset", { cardsId: "reset-gone-hand" }));
      expect(response.ok).toBe(false);
      expect(response.error.message).toContain("(1 of 1 expected change(s) missing)");
      expect(response.error.details.recall.unconfirmed.notReturned).toMatchObject([
        { cardsId: "reset-gone-origin", cardIds: ["reset-gone-origin-c1"] }
      ]);
    });

    it("cards.reset rejects a resolved recall when the individual origin row disappeared", async () => {
      const deck = deckOf("reset-row-gone-origin", 1);
      deck.cards.get("reset-row-gone-origin-c1")._source.drawn = true;
      deck.cards.get("reset-row-gone-origin-c1").drawn = true;
      const hand = seedStack("reset-row-gone-hand", {
        type: "hand",
        cards: [{ id: "reset-row-gone-origin-c1", name: "C1", drawn: true, origin: "reset-row-gone-origin" }]
      });
      hand.dropReturnedRowsFromOrigin = true;

      const response = await router().route(createRequest("cards.reset", { cardsId: "reset-row-gone-hand" }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("(1 of 2 expected change(s) missing)");
      expect(response.error.message).toContain("rows are missing or still hold the old state");
      expect(response.error.details.mutation).toBe("partial");
      expect(response.error.details.recall.status).toBe("unconfirmed");
      expect(response.error.details.recall.unconfirmed.notReturned).toMatchObject([
        { cardsId: "reset-row-gone-origin", cardIds: ["reset-row-gone-origin-c1"] }
      ]);

      expect(deck.cards.get("reset-row-gone-origin-c1")).toBeNull();
      expect(hand.cards.get("reset-row-gone-origin-c1")).toBeNull();
    });

    it("cards.reset reports a vanished origin that owed NOTHING as committed-but-unconfirmed", async () => {
      const deck = deckOf("reset-gone-noop-origin", 1);
      deck.cards.get("reset-gone-noop-origin-c1")._source.drawn = false;
      deck.cards.get("reset-gone-noop-origin-c1").drawn = false;
      const hand = seedStack("reset-gone-noop-hand", {
        type: "hand",
        cards: [
          { id: "reset-gone-noop-origin-c1", name: "C1", drawn: true, origin: "reset-gone-noop-origin" }
        ]
      });
      hand.vanishDuringRecall = ["reset-gone-noop-origin"];
      const response = await router().route(
        createRequest("cards.reset", { cardsId: "reset-gone-noop-hand" })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.complete).toBe(true);
      expect(response.result.mutation).toBe("committed");
      expect(response.result.reconciliation).toBe("confirmed");

      expect(response.result.recall.status).toBe("unconfirmed");
      expect(response.result.recall.unconfirmed.notReturned).toMatchObject([
        { cardsId: "reset-gone-noop-origin", cardIds: ["reset-gone-noop-origin-c1"] }
      ]);
      expect(response.result.recall.unconfirmed.notRemovedCardIds).toEqual([]);
      expect(response.result.chatNotification).toEqual({ requested: true, status: "dispatched" });

      expect(hand.cards.get("reset-gone-noop-origin-c1")).toBeFalsy();
    });

    it("cards.reset on a HAND whose every card is SKIPPED still reports the chat as dispatched", async () => {
      const hand = seedStack("reset-hand-skipped", {
        type: "hand",
        cards: [{ id: "reset-hand-skipped-c1", name: "C1" }]
      });
      const response = await router().route(createRequest("cards.reset", { cardsId: "reset-hand-skipped" }));
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.chatNotification).toEqual({ requested: true, status: "dispatched" });
      expect(response.result.recall.status).toBe("confirmed");
      expect(response.result.recall.skippedCardIds).toEqual(["reset-hand-skipped-c1"]);
      expect(response.result.mutation).toBe("committed");

      expect(hand.cards.get("reset-hand-skipped-c1")).toBeTruthy();
      expect(hand.chatPosts).toBe(1);
    });

    it("cards.reset dry run enumerates the recall without calling it", async () => {
      const deck = deckOf("reset-preview", 1);
      deck.cards.get("reset-preview-c1")._source.drawn = true;
      const hand = seedStack("reset-preview-hand", {
        type: "hand",
        cards: [{ id: "reset-preview-c1", name: "C1", drawn: true, origin: "reset-preview" }]
      });
      const response = await router().route(
        createRequest("cards.reset", { cardsId: "reset-preview", dryRun: true })
      );
      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result.mutation).toBe("not-executed");
      expect(response.result.reconciliation).toBe("not-executed");
      expect(response.result.recall.status).toBe("not-executed");
      expect(response.result.recall.reclaimed[0].cardIds).toEqual(["reset-preview-c1"]);
      expect(deck.recall).not.toHaveBeenCalled();
      expect(hand.cards.get("reset-preview-c1")).toBeTruthy();
    });

    it("cards.reset on a DECK re-throws a rejection that landed nothing, and reports a stopped walk", async () => {
      const deck = deckOf("reset-throw", 1);
      deck.cards.get("reset-throw-c1")._source.drawn = true;
      seedStack("reset-throw-hand", {
        type: "hand",
        cards: [{ id: "reset-throw-c1", name: "C1", drawn: true, origin: "reset-throw" }]
      });
      const stuck = seedStack("reset-throw-hand-b", {
        type: "hand",
        cards: [{ id: "reset-throw-c1", name: "C1", drawn: true, origin: "reset-throw" }]
      });
      deck.actionThrowsBeforeWrite = new Error("walk never started");
      const clean = await router().route(createRequest("cards.reset", { cardsId: "reset-throw" }));
      expect(clean.ok).toBe(false);
      expect(clean.error.details.message).toContain("walk never started");
      delete deck.actionThrowsBeforeWrite;

      stuck.vetoCardDeletes = true;
      deck.actionThrowsAfterWrite = new Error("walk stopped");
      const partial = await router().route(createRequest("cards.reset", { cardsId: "reset-throw" }));
      expect(partial.ok).toBe(true);
      expect(partial.result.complete).toBe(false);
      expect(partial.result.mutation).toBe("partial");

      expect(partial.result.reconciliation).toBe("confirmed");
      expect(partial.result.recall.status).toBe("unconfirmed");

      expect(partial.result.recall.unconfirmed.reclaimedRemaining).toEqual([
        {
          cardsId: "reset-throw-hand-b",
          cardIds: ["reset-throw-c1"],
          cardIdsCount: 1,
          cardIdsTruncated: false
        }
      ]);
      expect(partial.result.chatNotification).toEqual({ requested: true, status: "not-dispatched" });
    });

    it("cards.reset on a DECK reports a rejection whose every write landed as COMMITTED, not partial", async () => {
      const deck = deckOf("reset-landed", 1);
      deck.cards.get("reset-landed-c1")._source.drawn = true;
      seedStack("reset-landed-hand", {
        type: "hand",
        cards: [{ id: "reset-landed-c1", name: "C1", drawn: true, origin: "reset-landed" }]
      });
      deck.actionThrowsAfterWrite = new Error("notification blew up");
      const response = await router().route(createRequest("cards.reset", { cardsId: "reset-landed" }));
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.mutation).toBe("committed");
      expect(response.result.reconciliation).toBe("confirmed");
      expect(response.result.recall.status).toBe("confirmed");
      expect(response.result.recall).not.toHaveProperty("unconfirmed");

      expect(response.result.complete).toBe(false);
      expect(response.result.failure.message).toContain("notification blew up");

      expect(deck.cards.get("reset-landed-c1")._source.drawn).toBe(false);
      expect(globalThis.game.cards.get("reset-landed-hand").cards.get("reset-landed-c1")).toBeFalsy();
    });

    it("cards.reset re-throws a rejection when there was NOTHING to recall, on either branch", async () => {
      const deck = deckOf("reset-empty-deck", 2);
      deck.actionThrowsAfterWrite = new Error("deck reset failed");
      const deckResponse = await router().route(
        createRequest("cards.reset", { cardsId: "reset-empty-deck" })
      );
      expect(deckResponse.ok).toBe(false);
      expect(deckResponse.error.details.message).toContain("deck reset failed");

      const hand = seedStack("reset-empty-hand", {
        type: "hand",
        cards: [{ id: "reset-empty-own", name: "Own", origin: null }]
      });
      hand.actionThrowsAfterWrite = new Error("hand reset failed");
      const handResponse = await router().route(
        createRequest("cards.reset", { cardsId: "reset-empty-hand" })
      );
      expect(handResponse.ok).toBe(false);
      expect(handResponse.error.details.message).toContain("hand reset failed");
    });

    it("cards.reset on a HAND labels a rejected reconciliation BEST-EFFORT and reports intent, not a verdict", async () => {
      const deck = deckOf("reset-hand-src", 1);
      deck.cards.get("reset-hand-src-c1")._source.drawn = true;
      const hand = seedStack("reset-hand-unstable", {
        type: "hand",
        cards: [{ id: "reset-hand-src-c1", name: "C1", drawn: true, origin: "reset-hand-src" }]
      });
      hand.actionThrowsAfterWrite = new Error("promise.all rejected");
      const response = await router().route(createRequest("cards.reset", { cardsId: "reset-hand-unstable" }));
      expect(response.ok).toBe(true);

      expect(response.result.reconciliation).toBe("best-effort");
      expect(response.result.recall.status).toBe("not-verified");
      expect(response.result.recall).not.toHaveProperty("unconfirmed");
      expect(response.result.failure.message).toContain("promise.all rejected");

      expect(response.result.mutation).toBe("partial");
    });

    it("cards.reset on a HAND does NOT re-throw when nothing landed but the plan was non-empty", async () => {
      const deck = deckOf("reset-hand-nothing-src", 1);
      deck.cards.get("reset-hand-nothing-src-c1")._source.drawn = true;
      const hand = seedStack("reset-hand-nothing", {
        type: "hand",
        cards: [
          { id: "reset-hand-nothing-src-c1", name: "C1", drawn: true, origin: "reset-hand-nothing-src" }
        ]
      });
      hand.actionThrowsBeforeWrite = new Error("rejected before dispatch");
      const response = await router().route(createRequest("cards.reset", { cardsId: "reset-hand-nothing" }));
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.reconciliation).toBe("best-effort");
      expect(response.result.recall.status).toBe("not-verified");
      expect(response.result.recall).not.toHaveProperty("unconfirmed");
      expect(response.result.failure.message).toContain("rejected before dispatch");
    });

    it("cards.deal moves cards and reports the (stackId, cardId) bookkeeping per destination", async () => {
      const deck = deckOf("deal-deck", 4);
      const handA = seedStack("deal-hand-a", { type: "hand" });
      const handB = seedStack("deal-hand-b", { type: "hand" });
      const response = await router().route(
        createRequest("cards.deal", {
          cardsId: "deal-deck",
          to: ["deal-hand-a", "deal-hand-b"],
          count: 2,
          how: "top",
          ...KEY
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.mutation).toBe("committed");
      expect(response.result.reconciliation).toBe("confirmed");
      expect(response.result.complete).toBe(true);
      expect(response.result.cardsId).toBe("deal-deck");
      expect(response.result.toCount).toBe(2);
      expect(response.result.to.map((entry) => entry.cardsId)).toEqual(["deal-hand-a", "deal-hand-b"]);
      for (const entry of response.result.to) {
        expect(entry.expected).toBe(2);
        expect(entry.receivedCardIds).toHaveLength(2);
        expect(entry.returnedCardIds).toEqual([]);
      }

      const dealt = response.result.to.flatMap((entry) => entry.receivedCardIds);
      expect(response.result.from.drawnCardIds.sort()).toEqual([...dealt].sort());
      expect(response.result.from.removedCardIds).toEqual([]);
      expect(response.result.from.remaining).toBe(0);
      for (const cardId of dealt) {
        expect(deck.cards.get(cardId)._source.drawn).toBe(true);
      }
      expect(handA.cards.size + handB.cards.size).toBe(4);
      expect(deck.chatPosts).toBe(1);
    });

    it.each([
      [
        "origin",
        (row) => {
          row.origin = null;
        }
      ],
      [
        "drawn",
        (row) => {
          row.drawn = false;
        }
      ]
    ])("cards.deal does not credit a destination row whose %s was hook-mutated", async (field, mutate) => {
      const prefix = `deal-hook-${field}`;
      const deck = deckOf(`${prefix}-deck`, 1);
      const hand = seedStack(`${prefix}-hand`, { type: "hand" });
      deck.mutateActionPlan = ({ toCreate }) => mutate(toCreate[0][0]);

      const response = await router().route(
        createRequest("cards.deal", {
          cardsId: `${prefix}-deck`,
          to: [`${prefix}-hand`],
          count: 1,
          how: "top",
          idempotencyKey: `${prefix}-key`
        })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details.to[0].invalidStateCardIds).toEqual([`${prefix}-deck-c1`]);
      expect(response.error.details.to[0].receivedCardIds).toEqual([]);
      expect(response.error.details.mutation).toBe("partial");
      expect(response.error.details.complete).toBeUndefined();
      expect(deck.cards.get(`${prefix}-deck-c1`)._source.drawn).toBe(true);
      expect(hand.cards.get(`${prefix}-deck-c1`)._source[field]).toBe(field === "origin" ? null : false);
    });

    it("cards.deal dry run reports the same shape with empty moved-lists, current counts and no method call", async () => {
      const deck = deckOf("deal-dry", 3);
      const hand = seedStack("deal-dry-hand", { type: "hand" });
      const response = await router().route(
        createRequest("cards.deal", {
          cardsId: "deal-dry",
          to: ["deal-dry-hand"],
          count: 2,
          dryRun: true,
          ...KEY
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result).toEqual({
        cardsId: "deal-dry",
        complete: true,
        mutation: "not-executed",
        reconciliation: "not-executed",
        from: {
          cardsId: "deal-dry",
          cardsName: "Stack deal-dry",
          remaining: 3,
          removedCardIds: [],
          removedCardIdsCount: 0,
          removedCardIdsTruncated: false,
          drawnCardIds: [],
          drawnCardIdsCount: 0,
          drawnCardIdsTruncated: false
        },
        to: [
          {
            cardsId: "deal-dry-hand",
            cardsName: "Stack deal-dry-hand",
            expected: 2,
            receivedCardIds: [],
            receivedCardIdsCount: 0,
            receivedCardIdsTruncated: false,
            returnedCardIds: [],
            returnedCardIdsCount: 0,
            returnedCardIdsTruncated: false
          }
        ],
        toCount: 1,
        toTruncated: false,
        chatNotification: { requested: false, status: "not-requested" },
        dryRun: true
      });
      expect(deck.deal).not.toHaveBeenCalled();
      expect(hand.cards.size).toBe(0);
    });

    it("cards.deal refuses INSUFFICIENT_CARDS against the TOTAL (count × destinations), before any write", async () => {
      const deck = deckOf("deal-short", 3);
      seedStack("deal-short-a", { type: "hand" });
      seedStack("deal-short-b", { type: "hand" });
      const response = await router().route(
        createRequest("cards.deal", {
          cardsId: "deal-short",
          to: ["deal-short-a", "deal-short-b"],
          count: 2,
          ...KEY
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INSUFFICIENT_CARDS);
      expect(response.error.details).toMatchObject({ available: 3, requested: 4, type: "deck" });
      expect(deck.deal).not.toHaveBeenCalled();

      const hand = seedStack("deal-short-hand", {
        type: "hand",
        cards: [{ id: "deal-short-hand-c1", name: "C1", drawn: true }]
      });
      const handShort = await router().route(
        createRequest("cards.deal", { cardsId: "deal-short-hand", to: ["deal-short-a"], count: 2, ...KEY })
      );
      expect(handShort.error.code).toBe(ERROR_CODES.INSUFFICIENT_CARDS);
      expect(handShort.error.details.available).toBe(1);
      expect(handShort.error.message).not.toContain("cards reset");
      expect(hand.deal).not.toHaveBeenCalled();
    });

    it("cards.deal refuses an UNAVOIDABLE _id collision (dealing dealt cards BACK to their origin)", async () => {
      const deck = seedStack("deal-back-deck", {
        type: "deck",
        cards: [
          { id: "deal-back-c1", name: "C1", drawn: true },
          { id: "deal-back-c2", name: "C2" }
        ]
      });
      const hand = seedStack("deal-back-hand", {
        type: "hand",
        cards: [{ id: "deal-back-c1", name: "C1", origin: "deal-back-deck", drawn: true }]
      });
      const refused = await router().route(
        createRequest("cards.deal", { cardsId: "deal-back-hand", to: ["deal-back-deck"], ...KEY })
      );
      expect(refused.ok).toBe(false);
      expect(refused.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(refused.error.message).toContain("_id collision");
      expect(refused.error.message).toContain("cards pass");
      expect(refused.error.details.collidingCardIds).toEqual(["deal-back-c1"]);
      expect(refused.error.details).toMatchObject({
        cardsId: "deal-back-hand",
        to: "deal-back-deck",
        available: 1
      });
      expect(hand.deal).not.toHaveBeenCalled();

      const dry = await router().route(
        createRequest("cards.deal", {
          cardsId: "deal-back-hand",
          to: ["deal-back-deck"],
          dryRun: true,
          ...KEY
        })
      );
      expect(dry.error.code).toBe(ERROR_CODES.INVALID_PARAMS);

      const manyRows = Array.from({ length: 12 }, (_, index) => ({
        id: `deal-many-c${index + 1}`,
        name: `M${index + 1}`
      }));
      seedStack("deal-many-deck", { type: "deck", cards: manyRows.map((row) => ({ ...row, drawn: true })) });
      seedStack("deal-many-hand", {
        type: "hand",
        cards: manyRows.map((row) => ({ ...row, origin: "deal-many-deck", drawn: true }))
      });
      const many = await router().route(
        createRequest("cards.deal", { cardsId: "deal-many-hand", to: ["deal-many-deck"], ...KEY })
      );
      expect(many.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(many.error.message).toContain("(10 of 12 shown — see details.collidingCardIds)");
      expect(many.error.details.collidingCardIdsCount).toBe(12);

      expect(refused.error.message).not.toContain("shown");

      const mixed = seedStack("deal-mixed-hand", {
        type: "hand",
        cards: [
          { id: "deal-back-c1", name: "C1", origin: "deal-back-deck", drawn: true, sort: 300 },
          { id: "deal-mixed-x", name: "X", sort: 100 },
          { id: "deal-mixed-y", name: "Y", sort: 200 }
        ]
      });
      const allowed = await router().route(
        createRequest("cards.deal", { cardsId: "deal-mixed-hand", to: ["deal-back-deck"], count: 1, ...KEY })
      );
      expect(allowed.ok, JSON.stringify(allowed.error ?? {})).toBe(true);
      expect(mixed.deal).toHaveBeenCalledTimes(1);

      seedStack("deal-order-hand", {
        type: "hand",
        cards: [{ id: "deal-back-c1", name: "C1", origin: "deal-back-deck", drawn: true }]
      });
      const both = await router().route(
        createRequest("cards.deal", { cardsId: "deal-order-hand", to: ["deal-back-deck"], count: 2, ...KEY })
      );
      expect(both.error.code).toBe(ERROR_CODES.INSUFFICIENT_CARDS);
      expect(deck.deal).not.toHaveBeenCalled();

      seedStack("deal-scan-hand", {
        type: "hand",
        cards: [{ id: "deal-scan-a", name: "A", origin: "deal-scan-deck", drawn: true }]
      });
      const scanDeck = seedStack("deal-scan-deck", {
        type: "deck",
        cards: [
          { id: "deal-scan-a", name: "A" }, // available, and the destination already holds this id
          { id: "deal-scan-b", name: "B", drawn: true }
        ]
      });
      const scan = await router().route(
        createRequest("cards.deal", { cardsId: "deal-scan-deck", to: ["deal-scan-hand"], count: 1, ...KEY })
      );
      expect(scan.ok, JSON.stringify(scan.result ?? {})).toBe(false);
      expect(scan.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(scan.error.message).toContain("_id collision");
      expect(scan.error.details.collidingCardIds).toEqual(["deal-scan-a"]);

      expect(scan.error.details).toMatchObject({
        cardsId: "deal-scan-deck",
        to: "deal-scan-hand",
        available: 1
      });
      expect(scanDeck.deal).not.toHaveBeenCalled();
    });

    it("cards.pass refuses an _id collision EXACTLY — role `create` into a destination that already holds the id", async () => {
      deckOf("pass-collide-origin", 1);
      const hand = seedStack("pass-collide-hand", {
        type: "hand",
        cards: [{ id: "pass-collide-c1", name: "Borrowed", drawn: true, origin: "pass-collide-origin" }]
      });
      const pile = seedStack("pass-collide-pile", {
        type: "pile",
        cards: [{ id: "pass-collide-c1", name: "Squatter" }]
      });
      const destructive = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-collide-hand",
          to: "pass-collide-pile",
          cardIds: ["pass-collide-c1"],
          ...KEY
        })
      );
      expect(destructive.ok).toBe(false);
      expect(destructive.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(destructive.error.message).toContain("already holds a row with the same _id");

      expect(destructive.error.message).toContain("pass-collide-c1 would be DELETED");
      expect(destructive.error.message).toContain("cards card delete");
      expect(destructive.error.details).toMatchObject({
        cardsId: "pass-collide-hand",
        to: "pass-collide-pile"
      });
      expect(destructive.error.details.collidingCardIds).toEqual(["pass-collide-c1"]);
      expect(hand.pass).not.toHaveBeenCalled();

      const dry = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-collide-hand",
          to: "pass-collide-pile",
          cardIds: ["pass-collide-c1"],
          dryRun: true,
          ...KEY
        })
      );
      expect(dry.ok).toBe(false);
      expect(dry.error.code).toBe(ERROR_CODES.INVALID_PARAMS);

      const deck = seedStack("pass-copy-deck", {
        type: "deck",
        cards: [{ id: "pass-copy-c1", name: "Seed" }]
      });
      seedStack("pass-copy-target", {
        type: "deck",
        cards: [{ id: "pass-copy-c1", name: "Seed", origin: "pass-copy-target" }]
      });
      const clean = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-copy-deck",
          to: "pass-copy-target",
          cardIds: ["pass-copy-c1"],
          ...KEY
        })
      );
      expect(clean.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(clean.error.message).toContain("copy-into-a-deck branch");
      expect(clean.error.message).toContain("would be clean");
      expect(clean.error.message).not.toContain("DELETED");
      expect(deck.pass).not.toHaveBeenCalled();

      seedStack("pass-home-deck", {
        type: "deck",
        cards: [{ id: "pass-home-c1", name: "Home" }]
      });
      seedStack("pass-home-hand", {
        type: "hand",
        cards: [{ id: "pass-home-c1", name: "Copy", origin: "pass-home-deck", drawn: true }]
      });
      const stranded = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-home-deck",
          to: "pass-home-hand",
          cardIds: ["pass-home-c1"],
          ...KEY
        })
      );
      expect(stranded.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(stranded.error.message).toContain("would be left flagged drawn=true");

      const originDeck = seedStack("pass-return-deck", {
        type: "deck",
        cards: [{ id: "pass-return-c1", name: "Away", drawn: true }]
      });
      const holder = seedStack("pass-return-hand", {
        type: "hand",
        cards: [{ id: "pass-return-c1", name: "Away", origin: "pass-return-deck", drawn: true }]
      });
      const returned = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-return-hand",
          to: "pass-return-deck",
          cardIds: ["pass-return-c1"],
          ...KEY
        })
      );
      expect(returned.ok, JSON.stringify(returned.error ?? {})).toBe(true);
      expect(returned.result.to[0].returnedCardIds).toEqual(["pass-return-c1"]);
      expect(holder.pass).toHaveBeenCalledTimes(1);
      expect(originDeck.cards.get("pass-return-c1")._source.drawn).toBe(false);

      seedStack("pass-orphan-deck", { type: "deck", cards: [{ id: "pass-orphan-other", name: "Other" }] });
      const orphanHand = seedStack("pass-orphan-hand", {
        type: "hand",
        cards: [{ id: "pass-orphan-c1", name: "Orphan", origin: "pass-orphan-deck" }]
      });
      const orphan = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-orphan-hand",
          to: "pass-orphan-deck",
          cardIds: ["pass-orphan-c1"],
          ...KEY
        })
      );
      expect(orphan.ok, JSON.stringify(orphan.error ?? {})).toBe(true);
      expect(orphan.result.to[0].receivedCardIds).toEqual(["pass-orphan-c1"]);
      expect(orphanHand.pass).toHaveBeenCalledTimes(1);

      const drawnDeck = seedStack("pass-order-deck", {
        type: "deck",
        cards: [{ id: "pass-order-c1", name: "Gone", drawn: true }]
      });
      seedStack("pass-order-pile", { type: "pile", cards: [{ id: "pass-order-c1", name: "Squatter" }] });
      const ordered = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-order-deck",
          to: "pass-order-pile",
          cardIds: ["pass-order-c1"],
          ...KEY
        })
      );
      expect(ordered.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(ordered.error.message).toContain("already been drawn");
      expect(drawnDeck.pass).not.toHaveBeenCalled();
    });

    it("the SERVER's duplicate-_id rejection is what the guard pre-empts — cards.draw still hits it", async () => {
      const deck = seedStack("draw-collide-deck", {
        type: "deck",
        cards: [{ id: "draw-collide-c1", name: "Seed" }]
      });
      const target = seedStack("draw-collide-target", {
        type: "deck",
        cards: [{ id: "draw-collide-c1", name: "Seed", origin: "draw-collide-target" }]
      });
      const response = await router().route(
        createRequest("cards.draw", {
          cardsId: "draw-collide-target",
          from: "draw-collide-deck",
          count: 1,
          how: "top",
          idempotencyKey: "draw-collide-key"
        })
      );

      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.complete).toBe(false);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.reconciliation).toBe("best-effort");
      expect(response.result.failure.message).toContain("already exists within the parent collection");

      expect(deck.cards.get("draw-collide-c1")._source.drawn).toBe(false);
      expect(target.cards.get("draw-collide-c1").name).toBe("Seed");
      expect(target.cards.size).toBe(1);
    });

    it("cards.deal/pass/draw refuse a SELF-TARGET and a DUPLICATE target with INVALID_PARAMS", async () => {
      const deck = deckOf("self-deck", 2);
      seedStack("self-hand", { type: "hand" });
      const selfDeal = await router().route(
        createRequest("cards.deal", { cardsId: "self-deck", to: ["self-deck"], ...KEY })
      );
      expect(selfDeal.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(selfDeal.error.message).toContain("cannot be its own destination");

      expect(selfDeal.error.message).toContain("_id");
      const selfDraw = await router().route(
        createRequest("cards.draw", { cardsId: "self-deck", from: "self-deck", ...KEY })
      );
      expect(selfDraw.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(selfDraw.error.message).toContain("cannot be its own source");

      expect(selfDraw.error.message).toContain("Cards#draw throws on its own source check");
      expect(selfDraw.error.message).not.toContain("_id");
      const selfPass = await router().route(
        createRequest("cards.pass", {
          cardsId: "self-deck",
          to: "self-deck",
          cardIds: ["self-deck-c1"],
          ...KEY
        })
      );
      expect(selfPass.error.code).toBe(ERROR_CODES.INVALID_PARAMS);

      const duplicate = await router().route(
        createRequest("cards.deal", { cardsId: "self-deck", to: ["self-hand", "self-hand"], ...KEY })
      );
      expect(duplicate.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(duplicate.error.message).toContain("more than once");

      seedStack("self-hand-2", { type: "hand" });
      const ok = await router().route(
        createRequest("cards.deal", { cardsId: "self-deck", to: ["self-hand", "self-hand-2"], ...KEY })
      );
      expect(ok.ok, JSON.stringify(ok.error ?? {})).toBe(true);
      expect(deck.deal).toHaveBeenCalledTimes(1);
    });

    it("cards.deal resolves a bad target id to CARDS_NOT_FOUND before any other guard", async () => {
      deckOf("deal-badtarget", 2);
      const response = await router().route(
        createRequest("cards.deal", { cardsId: "deal-badtarget", to: ["nope"], ...KEY })
      );
      expect(response.error.code).toBe(ERROR_CODES.CARDS_NOT_FOUND);
      expect(response.error.details.cardsId).toBe("nope");

      const selfAndBad = await router().route(
        createRequest("cards.deal", {
          cardsId: "deal-badtarget",
          to: ["deal-badtarget", "nope"],
          ...KEY
        })
      );
      expect(selfAndBad.error.code).toBe(ERROR_CODES.CARDS_NOT_FOUND);
      expect(selfAndBad.error.details.cardsId).toBe("nope");

      const selfTwice = await router().route(
        createRequest("cards.deal", {
          cardsId: "deal-badtarget",
          to: ["deal-badtarget", "deal-badtarget"],
          ...KEY
        })
      );
      expect(selfTwice.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(selfTwice.error.message).toContain("cannot be its own destination");
    });

    it("cards.deal THROWS when a resolved deal wrote nothing (hook veto) and reports chat as unknown", async () => {
      const deck = deckOf("deal-veto", 2);
      seedStack("deal-veto-hand", { type: "hand" });
      deck.vetoActionHook = true;
      const response = await router().route(
        createRequest("cards.deal", { cardsId: "deal-veto", to: ["deal-veto-hand"], ...KEY })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("0 of 1 expected card movement");
      expect(response.error.details.mutation).toBe("unknown");
      expect(response.error.details.reconciliation).toBe("confirmed");
      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "unknown" });
      expect(deck.chatPosts ?? 0).toBe(0);
    });

    it("cards.deal reports a PARTIAL destination refusal as INTERNAL_ERROR naming what did arrive", async () => {
      const deck = deckOf("deal-partial", 2);
      const good = seedStack("deal-partial-good", { type: "hand" });
      const bad = seedStack("deal-partial-bad", { type: "hand" });
      bad.vetoRowCreates = true;
      const response = await router().route(
        createRequest("cards.deal", {
          cardsId: "deal-partial",
          to: ["deal-partial-good", "deal-partial-bad"],
          ...KEY
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.details.mutation).toBe("partial");

      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "dispatched" });
      const entries = response.error.details.to;
      expect(entries.find((entry) => entry.cardsId === "deal-partial-good").receivedCardIds).toHaveLength(1);
      expect(entries.find((entry) => entry.cardsId === "deal-partial-bad").receivedCardIds).toEqual([]);
      expect(good.cards.size).toBe(1);
      expect(bad.cards.size).toBe(0);
    });

    it("a concurrent CREATE in the destination does not turn a LANDED movement into a shortfall", async () => {
      const deck = deckOf("dest-added-deck", 2);
      const hand = seedStack("dest-added-hand", { type: "hand" });
      const created = hand.createEmbeddedDocuments;
      hand.createEmbeddedDocuments = vi.fn(async (type, entries, options) => {
        const result = await created(type, entries, options);

        await created(
          "Card",
          [{ id: "dest-added-deck-c2", name: "C2", sort: 500, origin: deck.id, drawn: true }],
          { keepId: true }
        );
        const row = deck.cards.get("dest-added-deck-c2");
        row.drawn = true;
        row._source.drawn = true;
        return result;
      });
      const response = await router().route(
        createRequest("cards.deal", {
          cardsId: "dest-added-deck",
          to: ["dest-added-hand"],
          count: 1,
          how: "top",
          ...KEY
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.mutation).toBe("committed");
      expect(response.result.complete).toBe(true);

      expect(response.result.to[0].receivedCardIds).toContain("dest-added-deck-c1");

      expect(response.result.to[0].receivedCardIds).toHaveLength(2);
      expect(response.result.to[0].expected).toBe(1);
      expect(response.result.from.drawnCardIds).toContain("dest-added-deck-c1");
      expect(hand.cards.get("dest-added-deck-c2")).not.toBeNull();
    });

    it("an arrival the SOURCE NEVER HELD is not credited — a refused deal is not `committed`", async () => {
      const deck = deckOf("dest-outsider-deck", 2);
      const hand = seedStack("dest-outsider-hand", { type: "hand" });
      const created = hand.createEmbeddedDocuments;
      hand.createEmbeddedDocuments = vi.fn(async () => {
        await created("Card", [{ id: "dest-outsider-foreign", name: "Outsider", sort: 500 }], {
          keepId: true
        });
        return [];
      });
      const response = await router().route(
        createRequest("cards.deal", {
          cardsId: "dest-outsider-deck",
          to: ["dest-outsider-hand"],
          count: 1,
          how: "top",
          ...KEY
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("only 0 of 1 expected card movement(s) arrived");
      expect(response.error.details.to[0].receivedCardIds).toEqual([]);

      expect(response.error.details.mutation).toBe("partial");
      expect(response.error.details.from.drawnCardIds).toEqual(["dest-outsider-deck-c1"]);
      expect(hand.cards.get("dest-outsider-deck-c1") ?? null).toBeNull();
    });

    it("an un-sourced arrival is not evidence that ANYTHING landed — both batches dropped stays `unknown`", async () => {
      const deck = deckOf("dest-nothing-deck", 2);
      const hand = seedStack("dest-nothing-hand", { type: "hand" });

      deck.vetoRowUpdates = new Set(["dest-nothing-deck-c1"]);
      const created = hand.createEmbeddedDocuments;
      hand.createEmbeddedDocuments = vi.fn(async () => {
        await created("Card", [{ id: "dest-nothing-foreign", name: "Outsider", sort: 500 }], {
          keepId: true
        });
        return [];
      });
      const response = await router().route(
        createRequest("cards.deal", {
          cardsId: "dest-nothing-deck",
          to: ["dest-nothing-hand"],
          count: 1,
          how: "top",
          ...KEY
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details.mutation).toBe("unknown");
      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "unknown" });
      expect(response.error.details.to[0].receivedCardIds).toEqual([]);
      expect(response.error.details.from.drawnCardIds).toEqual([]);
      expect(response.error.details.from.removedCardIds).toEqual([]);
    });

    it("`cards.deal` can take NO return credit — a foreign `drawn` clear in the destination is not a return", async () => {
      const deck = deckOf("dest-cleared-deck", 2);
      const pile = seedStack("dest-cleared-pile", {
        type: "pile",
        cards: [{ id: "dest-cleared-pile-c1", name: "Held", sort: 100, drawn: true }]
      });
      const created = pile.createEmbeddedDocuments;
      pile.createEmbeddedDocuments = vi.fn(async () => {
        const row = pile.cards.get("dest-cleared-pile-c1");
        row.drawn = false;
        row._source.drawn = false;
        return [];
      });
      expect(created).toBeTypeOf("function");
      const response = await router().route(
        createRequest("cards.deal", {
          cardsId: "dest-cleared-deck",
          to: ["dest-cleared-pile"],
          count: 1,
          how: "top",
          ...KEY
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("only 0 of 1 expected card movement(s) arrived");
      expect(response.error.details.to[0].returnedCardIds).toEqual([]);
      expect(response.error.details.to[0].receivedCardIds).toEqual([]);
      expect(response.error.details.mutation).toBe("partial");
      expect(response.error.details.from.drawnCardIds).toEqual(["dest-cleared-deck-c1"]);
    });

    it("an over-counted destination cannot mask a REAL shortfall, and the numbers stay honest", async () => {
      const deck = deckOf("dest-mixed-deck", 4);
      const good = seedStack("dest-mixed-good", { type: "hand" });
      const bad = seedStack("dest-mixed-bad", { type: "hand" });
      bad.vetoRowCreates = true;
      const created = good.createEmbeddedDocuments;
      good.createEmbeddedDocuments = vi.fn(async (type, entries, options) => {
        const result = await created(type, entries, options);

        await created("Card", [{ id: "dest-mixed-deck-c3", name: "C3", sort: 500 }], { keepId: true });
        const row = deck.cards.get("dest-mixed-deck-c3");
        row.drawn = true;
        row._source.drawn = true;
        return result;
      });
      const response = await router().route(
        createRequest("cards.deal", {
          cardsId: "dest-mixed-deck",
          to: ["dest-mixed-good", "dest-mixed-bad"],
          count: 1,
          how: "top",
          ...KEY
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("only 1 of 2 expected card movement(s) arrived");
      expect(response.error.details.mutation).toBe("partial");
      expect(
        response.error.details.to.find((entry) => entry.cardsId === "dest-mixed-bad").receivedCardIds
      ).toEqual([]);
      expect(bad.cards.size).toBe(0);
    });

    it("a SINGLE-destination refusal whose SOURCE side landed is `partial`, never `unknown`", async () => {
      const origin = seedStack("single-origin", { type: "deck" });
      const hand = seedStack("single-hand", {
        type: "hand",
        cards: [{ id: "single-c1", name: "C1", origin: "single-origin", drawn: true }]
      });
      const pile = seedStack("single-pile", { type: "pile" });
      pile.vetoRowCreates = true;
      const passed = await router().route(
        createRequest("cards.pass", {
          cardsId: "single-hand",
          to: "single-pile",
          cardIds: ["single-c1"],
          idempotencyKey: "single-pass-key"
        })
      );
      expect(passed.ok).toBe(false);
      expect(passed.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(passed.error.details.mutation).toBe("partial");

      expect(passed.error.details.chatNotification).toEqual({ requested: true, status: "dispatched" });
      expect(hand.chatPosts).toBe(1);
      expect(passed.error.details.from.removedCardIds).toEqual(["single-c1"]);
      expect(passed.error.message).toContain("The SOURCE side of this movement DID land");
      expect(passed.error.message).toContain("arrived in NO destination (single-c1)");
      expect(passed.error.message).not.toContain("no chat message at all");

      expect(hand.cards.get("single-c1")).toBeNull();
      expect(pile.cards.get("single-c1")).toBeNull();
      expect(origin.cards.get("single-c1")).toBeNull();

      const deck = deckOf("single-deck", 3);
      const dealDest = seedStack("single-deal-dest", { type: "hand" });
      dealDest.vetoRowCreates = true;
      const dealt = await router().route(
        createRequest("cards.deal", {
          cardsId: "single-deck",
          to: ["single-deal-dest"],
          how: "top",
          idempotencyKey: "single-deal-key"
        })
      );
      expect(dealt.ok).toBe(false);
      expect(dealt.error.details.mutation).toBe("partial");
      expect(dealt.error.details.chatNotification).toEqual({ requested: true, status: "dispatched" });
      expect(dealt.error.details.from.drawnCardIds).toEqual(["single-deck-c1"]);
      expect(dealt.error.message).toContain("WERE flagged drawn:true in the source");

      expect(deck.cards.get("single-deck-c1")._source.drawn).toBe(true);
      expect(dealDest.cards.size).toBe(0);

      const drawSource = deckOf("single-draw-src", 2);
      const drawDest = seedStack("single-draw-dest", { type: "hand" });
      drawDest.vetoRowCreates = true;
      const drawn = await router().route(
        createRequest("cards.draw", {
          cardsId: "single-draw-dest",
          from: "single-draw-src",
          how: "top",
          idempotencyKey: "single-draw-key"
        })
      );
      expect(drawn.ok).toBe(false);
      expect(drawn.error.details.mutation).toBe("partial");
      expect(drawn.error.details.from.cardsId).toBe("single-draw-src");
      expect(drawn.error.details.from.drawnCardIds).toEqual(["single-draw-src-c1"]);
      expect(drawSource.cards.get("single-draw-src-c1")._source.drawn).toBe(true);
    });

    it("cards.deal reports a refused SOURCE update as INTERNAL_ERROR even though the destination landed", async () => {
      const deck = deckOf("deal-src-veto", 2);
      const hand = seedStack("deal-src-veto-hand", { type: "hand" });
      deck.vetoRowUpdates = new Set(["deal-src-veto-c1"]);
      const response = await router().route(
        createRequest("cards.deal", {
          cardsId: "deal-src-veto",
          to: ["deal-src-veto-hand"],
          how: "top",
          ...KEY
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("no matching SOURCE-side write");
      expect(response.error.details.mutation).toBe("partial");
      expect(response.error.details.reconciliation).toBe("confirmed");

      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "dispatched" });
      expect(response.error.details.to[0].receivedCardIds).toEqual(["deal-src-veto-c1"]);
      expect(response.error.details.from.unconfirmedCardIds).toEqual(["deal-src-veto-c1"]);
      expect(response.error.details.from.drawnCardIds).toEqual([]);

      expect(deck.cards.get("deal-src-veto-c1")._source.drawn).toBe(false);
      expect(response.error.details.from.remaining).toBe(2);
      expect(hand.cards.get("deal-src-veto-c1")).toBeTruthy();
    });

    it("cards.pass reports a refused SOURCE delete as INTERNAL_ERROR — the card would sit in both stacks", async () => {
      const hand = seedStack("pass-src-veto", {
        type: "hand",
        cards: [{ id: "pass-src-veto-c1", name: "C1" }]
      });
      const pile = seedStack("pass-src-veto-pile", { type: "pile" });
      hand.vetoRowDeletes = new Set(["pass-src-veto-c1"]);
      const response = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-src-veto",
          to: "pass-src-veto-pile",
          cardIds: ["pass-src-veto-c1"],
          ...KEY
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details.mutation).toBe("partial");
      expect(response.error.details.from.unconfirmedCardIds).toEqual(["pass-src-veto-c1"]);
      expect(response.error.details.from.removedCardIds).toEqual([]);
      expect(hand.cards.get("pass-src-veto-c1")).toBeTruthy();
      expect(pile.cards.get("pass-src-veto-c1")).toBeTruthy();

      const deck = deckOf("pass-src-drawn", 2);
      seedStack("pass-src-drawn-hand", { type: "hand" });
      deck.vetoRowUpdates = new Set(["pass-src-drawn-c1"]);
      const passed = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-src-drawn",
          to: "pass-src-drawn-hand",
          cardIds: ["pass-src-drawn-c1"],
          idempotencyKey: "pass-src-drawn-key"
        })
      );
      expect(passed.ok).toBe(false);
      expect(passed.error.details.from.unconfirmedCardIds).toEqual(["pass-src-drawn-c1"]);

      const drawSource = deckOf("draw-src-veto", 2);
      seedStack("draw-src-veto-hand", { type: "hand" });
      drawSource.vetoRowUpdates = new Set(["draw-src-veto-c1"]);
      const drawn = await router().route(
        createRequest("cards.draw", {
          cardsId: "draw-src-veto-hand",
          from: "draw-src-veto",
          how: "top",
          idempotencyKey: "draw-src-veto-key"
        })
      );
      expect(drawn.ok).toBe(false);

      expect(drawn.error.details.from.cardsId).toBe("draw-src-veto");
      expect(drawn.error.details.from.unconfirmedCardIds).toEqual(["draw-src-veto-c1"]);
    });

    it("cards.pass COPIES a deck's home card into another DECK and reports the untouched source honestly", async () => {
      const from = deckOf("copy-src", 2);
      const into = seedStack("copy-dest", { type: "deck" });
      const response = await router().route(
        createRequest("cards.pass", {
          cardsId: "copy-src",
          to: "copy-dest",
          cardIds: ["copy-src-c1"],
          ...KEY
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.mutation).toBe("committed");
      expect(response.result.complete).toBe(true);
      expect(response.result.to[0].receivedCardIds).toEqual(["copy-src-c1"]);

      expect(response.result.from.removedCardIds).toEqual([]);
      expect(response.result.from.drawnCardIds).toEqual([]);
      expect(response.result.from.remaining).toBe(2);
      expect(from.cards.get("copy-src-c1")._source.drawn).toBe(false);

      expect(into.cards.get("copy-src-c1")._source.origin).toBe("copy-dest");
      expect(into.cards.get("copy-src-c1")._source.drawn).toBe(false);
    });

    it("a REFUSED copy-into-a-deck is a shortfall with nothing stranded — the source really was not written", async () => {
      const from = deckOf("copy-refused-src", 2);
      const into = seedStack("copy-refused-dest", { type: "deck" });
      into.vetoRowCreates = true;
      const response = await router().route(
        createRequest("cards.pass", {
          cardsId: "copy-refused-src",
          to: "copy-refused-dest",
          cardIds: ["copy-refused-src-c1"],
          ...KEY
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("only 0 of 1 expected card movement(s) arrived");

      expect(response.error.details.from.strandedCardIds).toEqual([]);
      expect(response.error.details.from.unconfirmedCardIds).toEqual([]);
      expect(response.error.details.from.removedCardIds).toEqual([]);
      expect(response.error.details.from.drawnCardIds).toEqual([]);
      expect(response.error.details.mutation).toBe("unknown");
      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "unknown" });

      expect(from.cards.get("copy-refused-src-c1")._source.drawn).toBe(false);
      expect(into.cards.size).toBe(0);
    });

    it("cards.draw INTO a deck copies too — the verb's own copyIntoDeck arm", async () => {
      const from = deckOf("draw-copy-src", 2);
      const into = seedStack("draw-copy-dest", { type: "deck" });
      const response = await router().route(
        createRequest("cards.draw", {
          cardsId: "draw-copy-dest",
          from: "draw-copy-src",
          how: "top",
          idempotencyKey: "draw-copy-key"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.mutation).toBe("committed");
      expect(response.result.complete).toBe(true);
      expect(response.result.to[0].receivedCardIds).toEqual(["draw-copy-src-c1"]);

      expect(response.result.from.removedCardIds).toEqual([]);
      expect(response.result.from.drawnCardIds).toEqual([]);
      expect(response.result.from.remaining).toBe(2);
      expect(from.cards.get("draw-copy-src-c1")._source.drawn).toBe(false);
      expect(into.cards.get("draw-copy-src-c1")._source.origin).toBe("draw-copy-dest");

      expect(from.cards.get("draw-copy-src-c1")).toBeTruthy();
    });

    it("cards.deal returns the BEST-EFFORT partial-commit envelope on a rejection", async () => {
      const deck = deckOf("deal-reject", 2);
      const hand = seedStack("deal-reject-hand", { type: "hand" });
      deck.actionThrowsAfterWrite = new Error("socket closed mid-deal");
      const response = await router().route(
        createRequest("cards.deal", { cardsId: "deal-reject", to: ["deal-reject-hand"], ...KEY })
      );
      expect(response.ok).toBe(true);
      expect(response.result.complete).toBe(false);
      expect(response.result.mutation).toBe("partial");

      expect(response.result.reconciliation).toBe("best-effort");
      expect(response.result.chatNotification).toEqual({ requested: true, status: "not-dispatched" });
      expect(response.result.failure.message).toContain("socket closed mid-deal");
      expect(hand.cards.size).toBe(1);
      expect(deck.chatPosts ?? 0).toBe(0);

      expect(response.result.from).not.toHaveProperty("strandedCardIds");
      expect(response.result.from).not.toHaveProperty("unconfirmedCardIds");
    });

    it("a REJECTED movement that observed nothing is `unknown`, never `partial`", async () => {
      const deck = deckOf("deal-reject-nothing", 2);
      const hand = seedStack("deal-reject-nothing-hand", { type: "hand" });
      deck.actionThrowsBeforeWrite = new Error("socket closed before dispatch");
      const response = await router().route(
        createRequest("cards.deal", {
          cardsId: "deal-reject-nothing",
          to: ["deal-reject-nothing-hand"],
          ...KEY
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.complete).toBe(false);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.reconciliation).toBe("best-effort");
      expect(response.result.to[0].receivedCardIds).toEqual([]);
      expect(response.result.failure.message).toContain("before dispatch");
      expect(hand.cards.size).toBe(0);

      const wrote = deckOf("deal-reject-source-landed", 2);
      const refused = seedStack("deal-reject-source-landed-hand", { type: "hand" });
      refused.vetoRowCreates = true;
      wrote.actionThrowsAfterWrite = new Error("socket closed after dispatch");
      const partial = await router().route(
        createRequest("cards.deal", {
          cardsId: "deal-reject-source-landed",
          to: ["deal-reject-source-landed-hand"],
          how: "top",
          idempotencyKey: "deal-reject-source-landed-key"
        })
      );
      expect(partial.ok, JSON.stringify(partial.error ?? {})).toBe(true);
      expect(partial.result.mutation).toBe("partial");
      expect(partial.result.reconciliation).toBe("best-effort");
      expect(partial.result.to[0].receivedCardIds).toEqual([]);
      expect(partial.result.from.drawnCardIds).toEqual(["deal-reject-source-landed-c1"]);

      expect(partial.result.from.strandedCardIds).toEqual(["deal-reject-source-landed-c1"]);
      expect(partial.result.from.strandedCardIdsCount).toBe(1);
      expect(partial.result.from.strandedCardIdsTruncated).toBe(false);

      expect(partial.result.from).not.toHaveProperty("unconfirmedCardIds");
      expect(wrote.cards.get("deal-reject-source-landed-c1")._source.drawn).toBe(true);
      expect(refused.cards.size).toBe(0);

      expect(partial.result.chatNotification).toEqual({ requested: true, status: "not-dispatched" });

      const leaky = seedStack("pass-reject-unsourced", {
        type: "hand",
        cards: [{ id: "pass-reject-unsourced-c1", name: "C1" }]
      });
      const pile = seedStack("pass-reject-unsourced-pile", { type: "pile" });
      leaky.vetoRowDeletes = new Set(["pass-reject-unsourced-c1"]);
      leaky.actionThrowsAfterWrite = new Error("socket closed after the create");
      const unsourced = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-reject-unsourced",
          to: "pass-reject-unsourced-pile",
          cardIds: ["pass-reject-unsourced-c1"],
          idempotencyKey: "pass-reject-unsourced-key"
        })
      );
      expect(unsourced.ok, JSON.stringify(unsourced.error ?? {})).toBe(true);
      expect(unsourced.result.mutation).toBe("partial");
      expect(unsourced.result.reconciliation).toBe("best-effort");
      expect(unsourced.result.to[0].receivedCardIds).toEqual(["pass-reject-unsourced-c1"]);
      expect(unsourced.result.from.unconfirmedCardIds).toEqual(["pass-reject-unsourced-c1"]);
      expect(unsourced.result.from.unconfirmedCardIdsCount).toBe(1);
      expect(unsourced.result.from).not.toHaveProperty("strandedCardIds");

      expect(leaky.cards.get("pass-reject-unsourced-c1")).toBeTruthy();
      expect(pile.cards.get("pass-reject-unsourced-c1")).toBeTruthy();
    });

    it("cards.draw treats cardsId as the DESTINATION and `from` as the source", async () => {
      const deck = deckOf("draw-src", 3);
      const hand = seedStack("draw-dest", { type: "hand" });
      const response = await router().route(
        createRequest("cards.draw", {
          cardsId: "draw-dest",
          from: "draw-src",
          count: 2,
          how: "bottom",
          ...KEY
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.cardsId).toBe("draw-dest");

      expect(response.result.from.cardsId).toBe("draw-src");
      expect(response.result.from.remaining).toBe(1);
      expect(response.result.to).toHaveLength(1);
      expect(response.result.to[0].cardsId).toBe("draw-dest");
      expect(response.result.to[0].receivedCardIds).toHaveLength(2);
      expect(hand.cards.size).toBe(2);
      expect(response.result.mutation).toBe("committed");

      expect(deck.chatPosts).toBe(1);
    });

    it("cards.draw refuses INSUFFICIENT_CARDS against the SOURCE", async () => {
      const deck = deckOf("draw-short", 1);
      seedStack("draw-short-dest", { type: "hand" });
      const response = await router().route(
        createRequest("cards.draw", { cardsId: "draw-short-dest", from: "draw-short", count: 2, ...KEY })
      );
      expect(response.error.code).toBe(ERROR_CODES.INSUFFICIENT_CARDS);
      expect(response.error.details.cardsId).toBe("draw-short");
      expect(deck.drawCardsForTest).toBeTypeOf("function");
    });

    it("cards.pass moves named cards and reports a RETURN-to-origin as returnedCardIds, not a no-op", async () => {
      const deck = deckOf("pass-deck", 2);
      const hand = seedStack("pass-hand", { type: "hand" });

      await router().route(
        createRequest("cards.deal", {
          cardsId: "pass-deck",
          to: ["pass-hand"],
          count: 1,
          chat: false,
          ...KEY
        })
      );
      const held = [...hand.cards][0].id;
      expect(deck.cards.get(held)._source.drawn).toBe(true);

      const response = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-hand",
          to: "pass-deck",
          cardIds: [held],
          idempotencyKey: "pass-back"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.mutation).toBe("committed");

      expect(response.result.to[0].receivedCardIds).toEqual([]);
      expect(response.result.to[0].returnedCardIds).toEqual([held]);
      expect(response.result.from.removedCardIds).toEqual([held]);
      expect(deck.cards.get(held)._source.drawn).toBe(false);
      expect(hand.cards.get(held)).toBeNull();
    });

    /** @param {string} prefix */
    const mixedPassFixture = (prefix) => {
      const home = deckOf(`${prefix}-home`, 1);
      const third = deckOf(`${prefix}-third`, 1);
      for (const stack of [home, third]) {
        for (const card of stack.cards) {
          card._source.drawn = true;
          card.drawn = true;
        }
      }
      const hand = seedStack(`${prefix}-hand`, {
        type: "hand",
        cards: [
          { id: `${prefix}-home-c1`, name: "X", drawn: true, origin: `${prefix}-home` },
          { id: `${prefix}-third-c1`, name: "Y", drawn: true, origin: `${prefix}-third` }
        ]
      });
      return { home, third, hand };
    };

    it("cards.pass accounts for a MIXED multi-card set — one returned home, one moved", async () => {
      const { home, hand } = mixedPassFixture("pass-mixed");
      const response = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-mixed-hand",
          to: "pass-mixed-home",
          cardIds: ["pass-mixed-home-c1", "pass-mixed-third-c1"],
          idempotencyKey: "pass-mixed"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.mutation).toBe("committed");
      expect(response.result.complete).toBe(true);

      expect(response.result.to[0].expected).toBe(2);
      expect(response.result.to[0].returnedCardIds).toEqual(["pass-mixed-home-c1"]);
      expect(response.result.to[0].receivedCardIds).toEqual(["pass-mixed-third-c1"]);

      expect(response.result.from.removedCardIds.sort()).toEqual(
        ["pass-mixed-home-c1", "pass-mixed-third-c1"].sort()
      );
      expect(response.result.from.drawnCardIds).toEqual([]);
      expect(response.result.from.remaining).toBe(0);
      expect(hand.cards.size).toBe(0);
      expect(home.cards.get("pass-mixed-home-c1")._source.drawn).toBe(false);

      expect(home.cards.get("pass-mixed-third-c1")._source.origin).toBe("pass-mixed-third");
      expect(home.cards.get("pass-mixed-third-c1")._source.drawn).toBe(true);
    });

    it("cards.pass reports a SHORTFALL when only one card of a two-card set arrives", async () => {
      const { home, hand } = mixedPassFixture("pass-short");
      home.vetoRowCreates = true;
      const response = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-short-hand",
          to: "pass-short-home",
          cardIds: ["pass-short-home-c1", "pass-short-third-c1"],
          idempotencyKey: "pass-short"
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("1 of 2 expected card movement");
      expect(response.error.details.mutation).toBe("partial");
      expect(response.error.details.to[0].returnedCardIds).toEqual(["pass-short-home-c1"]);
      expect(response.error.details.to[0].receivedCardIds).toEqual([]);

      expect(hand.cards.get("pass-short-third-c1")).toBeNull();
      expect(home.cards.get("pass-short-third-c1")).toBeNull();
    });

    /** @param {string} prefix */
    const alreadyAvailableOriginFixture = (prefix) => {
      const deck = deckOf(`${prefix}-deck`, 1);
      const hand = seedStack(`${prefix}-hand`, {
        type: "hand",

        cards: [{ id: `${prefix}-deck-c1`, name: "X", drawn: true, origin: `${prefix}-deck` }]
      });
      return { deck, hand };
    };

    it("a RETURN over a destination row already stored drawn:false is a COMMIT, not a shortfall", async () => {
      const { deck, hand } = alreadyAvailableOriginFixture("return-noop");
      const dry = await router().route(
        createRequest("cards.pass", {
          cardsId: "return-noop-hand",
          to: "return-noop-deck",
          cardIds: ["return-noop-deck-c1"],
          dryRun: true,
          idempotencyKey: "return-noop-dry"
        })
      );
      expect(dry.ok, JSON.stringify(dry.error ?? {})).toBe(true);
      expect(dry.result.to[0].returnedCardIds).toEqual(["return-noop-deck-c1"]);
      expect(hand.pass).not.toHaveBeenCalled();

      const real = await router().route(
        createRequest("cards.pass", {
          cardsId: "return-noop-hand",
          to: "return-noop-deck",
          cardIds: ["return-noop-deck-c1"],
          idempotencyKey: "return-noop-real"
        })
      );
      expect(real.ok, JSON.stringify(real.error ?? {})).toBe(true);
      expect(real.result.mutation).toBe("committed");
      expect(real.result.complete).toBe(true);

      expect(real.result.to[0].returnedCardIds).toEqual(dry.result.to[0].returnedCardIds);
      expect(real.result.from.removedCardIds).toEqual(["return-noop-deck-c1"]);

      expect(deck.cards.get("return-noop-deck-c1")._source.drawn).toBe(false);
      expect(hand.cards.size).toBe(0);
    });

    it("that credit needs the SOURCE diff — a VETOED return of the same card is still a shortfall", async () => {
      const { deck, hand } = alreadyAvailableOriginFixture("return-veto");
      hand.vetoActionHook = true;
      const response = await router().route(
        createRequest("cards.pass", {
          cardsId: "return-veto-hand",
          to: "return-veto-deck",
          cardIds: ["return-veto-deck-c1"],
          idempotencyKey: "return-veto"
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details.to[0].returnedCardIds).toEqual([]);

      expect(response.error.details.mutation).toBe("unknown");
      expect(response.error.details.chatNotification).toEqual({ requested: true, status: "unknown" });
      expect(hand.cards.size).toBe(1);
      expect(deck.chatPosts ?? 0).toBe(0);
    });

    it("cards.pass does not credit a return whose destination origin was hook-mutated", async () => {
      const deck = seedStack("return-hook-deck", {
        type: "deck",
        cards: [{ id: "return-hook-c1", name: "Away", drawn: true }]
      });
      const hand = seedStack("return-hook-hand", {
        type: "hand",
        cards: [{ id: "return-hook-c1", name: "Away", origin: "return-hook-deck", drawn: true }]
      });
      hand.mutateActionPlan = ({ action, toUpdate }) => {
        if (action === "pass") toUpdate[0].origin = "return-hook-wrong-origin";
      };

      const response = await router().route(
        createRequest("cards.pass", {
          cardsId: "return-hook-hand",
          to: "return-hook-deck",
          cardIds: ["return-hook-c1"],
          idempotencyKey: "return-hook-key"
        })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details.to[0].invalidStateCardIds).toEqual(["return-hook-c1"]);
      expect(response.error.details.to[0].returnedCardIds).toEqual([]);
      expect(response.error.details.from.removedCardIds).toEqual(["return-hook-c1"]);
      expect(deck.cards.get("return-hook-c1")._source).toMatchObject({
        drawn: false,
        origin: "return-hook-wrong-origin"
      });
      expect(hand.cards.get("return-hook-c1") ?? null).toBeNull();
    });

    it("a return NOTHING can witness is `indeterminate` — neither a commit nor a failure", async () => {
      const originDeck = deckOf("indet-origin", 1);
      const holderDeck = seedStack("indet-holder", {
        type: "deck",
        cards: [{ id: "indet-origin-c1", name: "X", sort: 100, origin: "indet-origin" }]
      });
      const dry = await router().route(
        createRequest("cards.pass", {
          cardsId: "indet-holder",
          to: "indet-origin",
          cardIds: ["indet-origin-c1"],
          dryRun: true,
          idempotencyKey: "indet-dry"
        })
      );
      expect(dry.ok, JSON.stringify(dry.error ?? {})).toBe(true);

      expect(dry.result.to[0].indeterminateCardIds).toEqual(["indet-origin-c1"]);
      expect(dry.result.to[0].returnedCardIds).toEqual([]);
      expect(holderDeck.pass).not.toHaveBeenCalled();

      const real = await router().route(
        createRequest("cards.pass", {
          cardsId: "indet-holder",
          to: "indet-origin",
          cardIds: ["indet-origin-c1"],
          idempotencyKey: "indet-real"
        })
      );
      expect(real.ok, JSON.stringify(real.error ?? {})).toBe(true);

      expect(real.result.mutation).toBe("unknown");
      expect(real.result.reconciliation).toBe("confirmed");
      expect(real.result.complete).toBe(false);
      expect(real.result.to[0].indeterminateCardIds).toEqual(["indet-origin-c1"]);
      expect(real.result.to[0].returnedCardIds).toEqual([]);
      expect(real.result.to[0].receivedCardIds).toEqual([]);

      expect(real.result.chatNotification).toEqual({ requested: true, status: "unknown" });

      expect(real.result.to[0].indeterminateCardIds).toEqual(dry.result.to[0].indeterminateCardIds);

      expect(holderDeck.cards.get("indet-origin-c1")).toBeTruthy();
      expect(originDeck.cards.get("indet-origin-c1")._source.drawn).toBe(false);
    });

    it("a stranded SOURCE-side write is caught even when the destination count is satisfied", async () => {
      const deck = deckOf("strand-deck", 2);
      const hand = seedStack("strand-hand", { type: "hand" });
      const created = hand.createEmbeddedDocuments;
      hand.createEmbeddedDocuments = vi.fn(async () => {
        await created(
          "Card",
          [{ id: "strand-deck-c2", name: "C2", sort: 500, origin: deck.id, drawn: true }],
          { keepId: true }
        );
        const row = deck.cards.get("strand-deck-c2");
        row.drawn = true;
        row._source.drawn = true;
        return [];
      });
      const response = await router().route(
        createRequest("cards.deal", {
          cardsId: "strand-deck",
          to: ["strand-hand"],
          count: 1,
          how: "top",
          ...KEY
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);

      expect(response.error.message).toContain("NO destination accounts for");
      expect(response.error.details.from.strandedCardIds).toEqual(["strand-deck-c1"]);
      expect(response.error.details.to[0].receivedCardIds).toEqual(["strand-deck-c2"]);
      expect(response.error.details.to[0].expected).toBe(1);
      expect(response.error.details.mutation).toBe("partial");

      expect(deck.cards.get("strand-deck-c1")._source.drawn).toBe(true);
      expect(hand.cards.get("strand-deck-c1") ?? null).toBeNull();
    });

    it("a destination row that was ALREADY THERE is not an arrival — the create witness needs the absence", async () => {
      const origin = deckOf("dup-origin", 1);
      expect(origin.cards.size).toBe(1);
      const hand = seedStack("dup-hand", {
        type: "hand",
        cards: [{ id: "dup-shared", name: "Moving", drawn: true, origin: "dup-origin" }]
      });
      const pile = seedStack("dup-pile", {
        type: "pile",

        cards: [{ id: "dup-shared", name: "Squatter", drawn: false }]
      });
      pile.vetoRowCreates = true;
      const response = await router().route(
        createRequest("cards.draw", {
          cardsId: "dup-pile",
          from: "dup-hand",
          count: 1,
          ...KEY
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details.to[0].receivedCardIds).toEqual([]);
      expect(response.error.details.from.strandedCardIds).toEqual(["dup-shared"]);
      expect(response.error.details.mutation).toBe("partial");

      expect(hand.cards.get("dup-shared") ?? null).toBeNull();
      expect(pile.cards.get("dup-shared").name).toBe("Squatter");
    });

    it("an arrival of a source row that was NOT AVAILABLE is not credited — the candidate universe bound", async () => {
      const deck = deckOf("pool-deck", 2);
      const stale = deck.cards.get("pool-deck-c2");
      stale.drawn = true;
      stale._source.drawn = true;
      const hand = seedStack("pool-hand", { type: "hand" });
      const created = hand.createEmbeddedDocuments;
      hand.createEmbeddedDocuments = vi.fn(async (type, entries, options) => {
        const result = await created(type, entries, options);
        await created("Card", [{ id: "pool-deck-c2", name: "C2", sort: 500 }], { keepId: true });
        return result;
      });
      const response = await router().route(
        createRequest("cards.deal", { cardsId: "pool-deck", to: ["pool-hand"], count: 1, how: "top", ...KEY })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.mutation).toBe("committed");
      expect(response.result.to[0].receivedCardIds).toEqual(["pool-deck-c1"]);
      expect(response.result.from.drawnCardIds).toEqual(["pool-deck-c1"]);

      expect(hand.cards.get("pool-deck-c2")).toBeTruthy();
    });

    it("a weak return is credited to the card the SOURCE witnessed, and an unmoved candidate is not eligible at all", async () => {
      const deck = deckOf("weak-order-deck", 2);
      const hand = seedStack("weak-order-hand", {
        type: "hand",
        cards: [
          { id: "weak-order-deck-c1", name: "Moved", sort: 100, drawn: true, origin: "weak-order-deck" },
          { id: "weak-order-deck-c2", name: "Stays", sort: 200, drawn: true, origin: "weak-order-deck" }
        ]
      });
      const response = await router().route(
        createRequest("cards.draw", {
          cardsId: "weak-order-deck",
          from: "weak-order-hand",
          count: 1,
          how: "top",
          ...KEY
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.mutation).toBe("committed");
      expect(response.result.complete).toBe(true);
      expect(response.result.to[0].returnedCardIds).toEqual(["weak-order-deck-c1"]);
      expect(response.result.to[0].indeterminateCardIds).toBeUndefined();
      expect(response.result.from.removedCardIds).toEqual(["weak-order-deck-c1"]);

      expect(hand.cards.get("weak-order-deck-c1") ?? null).toBeNull();
      expect(hand.cards.get("weak-order-deck-c2")).toBeTruthy();
    });

    it("the no-op-return credit is CAPPED, so a concurrently removed candidate cannot inflate it", async () => {
      const deck = deckOf("credit-cap-deck", 1);
      const third = deckOf("credit-cap-third", 1);
      for (const card of third.cards) {
        card._source.drawn = true;
        card.drawn = true;
      }
      const hand = seedStack("credit-cap-hand", {
        type: "hand",
        cards: [
          { id: "credit-cap-third-c1", name: "Y", sort: 100, drawn: true, origin: "credit-cap-third" },
          { id: "credit-cap-deck-c1", name: "X", sort: 200, drawn: true, origin: "credit-cap-deck" }
        ]
      });
      const passed = hand.pass;
      hand.pass = vi.fn(async (...args) => {
        const result = await passed(...args);
        hand.cards.delete("credit-cap-deck-c1");
        return result;
      });
      const response = await router().route(
        createRequest("cards.draw", {
          cardsId: "credit-cap-deck",
          from: "credit-cap-hand",
          count: 1,
          how: "top",
          idempotencyKey: "credit-cap"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.mutation).toBe("committed");
      expect(response.result.to[0].receivedCardIds).toEqual(["credit-cap-third-c1"]);

      expect(response.result.to[0].returnedCardIds).toEqual([]);
      expect(deck.cards.size).toBe(2);
    });

    it("cards.draw takes the same credit, and an UNSELECTED candidate does not inflate it", async () => {
      const deck = deckOf("draw-noop-deck", 1);
      const third = deckOf("draw-noop-third", 1);
      for (const card of third.cards) {
        card._source.drawn = true;
        card.drawn = true;
      }
      const hand = seedStack("draw-noop-hand", {
        type: "hand",
        cards: [
          { id: "draw-noop-third-c1", name: "Y", sort: 100, drawn: true, origin: "draw-noop-third" },
          { id: "draw-noop-deck-c1", name: "X", sort: 200, drawn: true, origin: "draw-noop-deck" }
        ]
      });
      const drawn = await router().route(
        createRequest("cards.draw", {
          cardsId: "draw-noop-deck",
          from: "draw-noop-hand",
          count: 1,
          how: "top",
          idempotencyKey: "draw-noop-other"
        })
      );
      expect(drawn.ok, JSON.stringify(drawn.error ?? {})).toBe(true);
      expect(drawn.result.mutation).toBe("committed");
      expect(drawn.result.to[0].receivedCardIds).toEqual(["draw-noop-third-c1"]);
      expect(drawn.result.to[0].returnedCardIds).toEqual([]);

      const home = await router().route(
        createRequest("cards.draw", {
          cardsId: "draw-noop-deck",
          from: "draw-noop-hand",
          count: 1,
          how: "top",
          idempotencyKey: "draw-noop-home"
        })
      );
      expect(home.ok, JSON.stringify(home.error ?? {})).toBe(true);
      expect(home.result.mutation).toBe("committed");
      expect(home.result.to[0].returnedCardIds).toEqual(["draw-noop-deck-c1"]);
      expect(home.result.to[0].receivedCardIds).toEqual([]);
      expect(deck.cards.get("draw-noop-deck-c1")._source.drawn).toBe(false);
      expect(hand.cards.size).toBe(0);
    });

    it("cards.pass DRY RUN forecasts the whole movement, and the forecast matches what the real call reports", async () => {
      const sortIds = (entry) => {
        const sorted = { ...entry };
        for (const key of ["receivedCardIds", "returnedCardIds", "removedCardIds", "drawnCardIds"]) {
          if (Array.isArray(sorted[key])) sorted[key] = [...sorted[key]].sort();
        }
        return sorted;
      };
      const shapeOf = (body) => ({ from: sortIds(body.from), to: body.to.map(sortIds) });

      const copySource = seedStack("intent-copy-src", {
        type: "pile",
        cards: [{ id: "intent-copy-c1", name: "C1", origin: "intent-copy-src" }]
      });
      seedStack("intent-copy-dest", { type: "deck", cards: [] });
      const copyDry = await router().route(
        createRequest("cards.pass", {
          cardsId: "intent-copy-src",
          to: "intent-copy-dest",
          cardIds: ["intent-copy-c1"],
          dryRun: true,
          idempotencyKey: "intent-copy"
        })
      );
      expect(copyDry.ok, JSON.stringify(copyDry.error ?? {})).toBe(true);
      expect(copyDry.result.to[0].receivedCardIds).toEqual(["intent-copy-c1"]);

      expect(copyDry.result.from.removedCardIds).toEqual([]);
      expect(copyDry.result.from.drawnCardIds).toEqual([]);
      expect(copyDry.result.from.remaining).toBe(1);
      expect(copySource.pass).not.toHaveBeenCalled();
      const copyReal = await router().route(
        createRequest("cards.pass", {
          cardsId: "intent-copy-src",
          to: "intent-copy-dest",
          cardIds: ["intent-copy-c1"],
          idempotencyKey: "intent-copy-real"
        })
      );
      expect(copyReal.ok, JSON.stringify(copyReal.error ?? {})).toBe(true);
      expect(shapeOf(copyReal.result)).toEqual(shapeOf(copyDry.result));

      seedStack("intent-move-origin", { type: "deck", cards: [] });
      const moveSource = seedStack("intent-move-src", {
        type: "pile",
        cards: [
          { id: "intent-move-c1", name: "C1", origin: "intent-move-origin" },
          { id: "intent-move-c2", name: "C2", origin: "intent-move-src" }
        ]
      });
      seedStack("intent-move-dest", { type: "deck", cards: [] });
      const moveDry = await router().route(
        createRequest("cards.pass", {
          cardsId: "intent-move-src",
          to: "intent-move-dest",
          cardIds: ["intent-move-c1"],
          dryRun: true,
          idempotencyKey: "intent-move"
        })
      );
      expect(moveDry.ok, JSON.stringify(moveDry.error ?? {})).toBe(true);

      expect(moveDry.result.from.removedCardIds).toEqual(["intent-move-c1"]);
      expect(moveDry.result.from.remaining).toBe(1);
      expect(moveDry.result.to[0].receivedCardIds).toEqual(["intent-move-c1"]);
      expect(moveDry.result.from).not.toEqual(copyDry.result.from);
      expect(moveSource.pass).not.toHaveBeenCalled();
      expect(moveSource.cards.size).toBe(2);
      const moveReal = await router().route(
        createRequest("cards.pass", {
          cardsId: "intent-move-src",
          to: "intent-move-dest",
          cardIds: ["intent-move-c1"],
          idempotencyKey: "intent-move-real"
        })
      );
      expect(moveReal.ok, JSON.stringify(moveReal.error ?? {})).toBe(true);
      expect(shapeOf(moveReal.result)).toEqual(shapeOf(moveDry.result));

      const pile = seedStack("intent-drawn-pile", {
        type: "pile",
        cards: [
          { id: "intent-drawn-p1", name: "P1", origin: "intent-drawn-pile" },
          { id: "intent-drawn-p2", name: "P2", origin: "intent-drawn-pile" }
        ]
      });
      seedStack("intent-drawn-hand", { type: "hand", cards: [] });
      const pileDry = await router().route(
        createRequest("cards.pass", {
          cardsId: "intent-drawn-pile",
          to: "intent-drawn-hand",
          cardIds: ["intent-drawn-p1"],
          dryRun: true,
          idempotencyKey: "intent-pile"
        })
      );
      expect(pileDry.ok, JSON.stringify(pileDry.error ?? {})).toBe(true);
      expect(pileDry.result.from.drawnCardIds).toEqual(["intent-drawn-p1"]);
      expect(pileDry.result.from.removedCardIds).toEqual([]);
      expect(pileDry.result.from.remaining).toBe(2);
      expect(pile.pass).not.toHaveBeenCalled();
      const pileReal = await router().route(
        createRequest("cards.pass", {
          cardsId: "intent-drawn-pile",
          to: "intent-drawn-hand",
          cardIds: ["intent-drawn-p1"],
          idempotencyKey: "intent-pile-real"
        })
      );
      expect(pileReal.ok, JSON.stringify(pileReal.error ?? {})).toBe(true);
      expect(shapeOf(pileReal.result)).toEqual(shapeOf(pileDry.result));

      const deck = deckOf("intent-drawn-deck", 2);
      seedStack("intent-drawn-deck-hand", { type: "hand", cards: [] });
      const deckDry = await router().route(
        createRequest("cards.pass", {
          cardsId: "intent-drawn-deck",
          to: "intent-drawn-deck-hand",
          cardIds: ["intent-drawn-deck-c1"],
          dryRun: true,
          idempotencyKey: "intent-deck"
        })
      );
      expect(deckDry.ok, JSON.stringify(deckDry.error ?? {})).toBe(true);
      expect(deckDry.result.from.drawnCardIds).toEqual(["intent-drawn-deck-c1"]);
      expect(deckDry.result.from.remaining).toBe(1);
      const deckReal = await router().route(
        createRequest("cards.pass", {
          cardsId: "intent-drawn-deck",
          to: "intent-drawn-deck-hand",
          cardIds: ["intent-drawn-deck-c1"],
          idempotencyKey: "intent-deck-real"
        })
      );
      expect(deckReal.ok, JSON.stringify(deckReal.error ?? {})).toBe(true);
      expect(shapeOf(deckReal.result)).toEqual(shapeOf(deckDry.result));
      expect(deck.cards.get("intent-drawn-deck-c1")._source.drawn).toBe(true);

      const multiSource = seedStack("intent-multi-src", {
        type: "pile",
        cards: [
          { id: "intent-multi-a", name: "A", origin: "intent-multi-origin" },
          { id: "intent-multi-b", name: "B", origin: "intent-multi-origin" }
        ]
      });
      seedStack("intent-multi-origin", { type: "deck", cards: [] });
      seedStack("intent-multi-dest", { type: "deck", cards: [] });
      const multiDry = await router().route(
        createRequest("cards.pass", {
          cardsId: "intent-multi-src",
          to: "intent-multi-dest",
          cardIds: ["intent-multi-b", "intent-multi-a"], // deliberately NOT the collection's order
          dryRun: true,
          idempotencyKey: "intent-multi"
        })
      );
      expect(multiDry.ok, JSON.stringify(multiDry.error ?? {})).toBe(true);
      expect(multiDry.result.to[0].receivedCardIds).toHaveLength(2);
      expect(multiDry.result.from.remaining).toBe(0);
      expect(multiSource.pass).not.toHaveBeenCalled();
      const multiReal = await router().route(
        createRequest("cards.pass", {
          cardsId: "intent-multi-src",
          to: "intent-multi-dest",
          cardIds: ["intent-multi-b", "intent-multi-a"],
          idempotencyKey: "intent-multi-real"
        })
      );
      expect(multiReal.ok, JSON.stringify(multiReal.error ?? {})).toBe(true);
      expect(shapeOf(multiReal.result)).toEqual(shapeOf(multiDry.result));

      const originDeck = deckOf("intent-return-deck", 1);
      originDeck.cards.get("intent-return-deck-c1")._source.drawn = true;
      originDeck.cards.get("intent-return-deck-c1").drawn = true;
      seedStack("intent-return-hand", {
        type: "hand",
        cards: [{ id: "intent-return-deck-c1", name: "C1", drawn: true, origin: "intent-return-deck" }]
      });
      const returnDry = await router().route(
        createRequest("cards.pass", {
          cardsId: "intent-return-hand",
          to: "intent-return-deck",
          cardIds: ["intent-return-deck-c1"],
          dryRun: true,
          idempotencyKey: "intent-return"
        })
      );
      expect(returnDry.ok, JSON.stringify(returnDry.error ?? {})).toBe(true);
      expect(returnDry.result.to[0].returnedCardIds).toEqual(["intent-return-deck-c1"]);
      expect(returnDry.result.to[0].receivedCardIds).toEqual([]);
      expect(returnDry.result.from.removedCardIds).toEqual(["intent-return-deck-c1"]);
      const returnReal = await router().route(
        createRequest("cards.pass", {
          cardsId: "intent-return-hand",
          to: "intent-return-deck",
          cardIds: ["intent-return-deck-c1"],
          idempotencyKey: "intent-return-real"
        })
      );
      expect(returnReal.ok, JSON.stringify(returnReal.error ?? {})).toBe(true);
      expect(shapeOf(returnReal.result)).toEqual(shapeOf(returnDry.result));

      const cloneOrigin = deckOf("intent-orphan-deck", 1);
      expect(cloneOrigin.cards.get("intent-orphan-clone")).toBeNull();
      const cloneHand = seedStack("intent-orphan-hand", {
        type: "hand",
        cards: [{ id: "intent-orphan-clone", name: "C1 copy", drawn: true, origin: "intent-orphan-deck" }]
      });
      const orphanDry = await router().route(
        createRequest("cards.pass", {
          cardsId: "intent-orphan-hand",
          to: "intent-orphan-deck",
          cardIds: ["intent-orphan-clone"],
          dryRun: true,
          idempotencyKey: "intent-orphan"
        })
      );
      expect(orphanDry.ok, JSON.stringify(orphanDry.error ?? {})).toBe(true);

      expect(orphanDry.result.to[0].receivedCardIds).toEqual(["intent-orphan-clone"]);
      expect(orphanDry.result.to[0].returnedCardIds).toEqual([]);

      expect(orphanDry.result.to[0].expected).toBe(1);
      expect(orphanDry.result.from.removedCardIds).toEqual(["intent-orphan-clone"]);
      expect(orphanDry.result.from.remaining).toBe(0);
      expect(cloneHand.pass).not.toHaveBeenCalled();
      const orphanReal = await router().route(
        createRequest("cards.pass", {
          cardsId: "intent-orphan-hand",
          to: "intent-orphan-deck",
          cardIds: ["intent-orphan-clone"],
          idempotencyKey: "intent-orphan-real"
        })
      );
      expect(orphanReal.ok, JSON.stringify(orphanReal.error ?? {})).toBe(true);
      expect(shapeOf(orphanReal.result)).toEqual(shapeOf(orphanDry.result));

      expect(cloneOrigin.cards.get("intent-orphan-clone")).not.toBeNull();
      expect(cloneHand.cards.get("intent-orphan-clone")).toBeNull();
    });

    it("cards.pass dry run still refuses the shapes the real call refuses (the guards precede the preview)", async () => {
      const deck = deckOf("intent-guard-deck", 1);
      deck.cards.get("intent-guard-deck-c1")._source.drawn = true;
      deck.cards.get("intent-guard-deck-c1").drawn = true;
      seedStack("intent-guard-hand", { type: "hand", cards: [] });
      const cases = [
        { cardIds: ["nope"], code: "CARD_NOT_FOUND" },
        { cardIds: ["intent-guard-deck-c1", "intent-guard-deck-c1"], code: "INVALID_PARAMS" },

        { cardIds: ["intent-guard-deck-c1"], code: "INVALID_PARAMS" }
      ];
      for (const { cardIds, code } of cases) {
        const response = await router().route(
          createRequest("cards.pass", {
            cardsId: "intent-guard-deck",
            to: "intent-guard-hand",
            dryRun: true,
            idempotencyKey: "intent-guard",
            cardIds
          })
        );
        expect(response.ok, JSON.stringify(cardIds)).toBe(false);
        expect(response.error.code, JSON.stringify(cardIds)).toBe(code);
      }
    });

    it("action-verb counts and diffs follow the STORED `drawn` flag when the live one diverges", async () => {
      const deck = deckOf("divergent-deal", 2);
      deck.cards.get("divergent-deal-c2").drawn = true;
      expect(deck.cards.get("divergent-deal-c2")._source.drawn).toBe(false);
      seedStack("divergent-deal-hand", { type: "hand" });
      const preview = await router().route(
        createRequest("cards.deal", {
          cardsId: "divergent-deal",
          to: ["divergent-deal-hand"],
          dryRun: true,
          ...KEY
        })
      );
      expect(preview.ok, JSON.stringify(preview.error ?? {})).toBe(true);

      expect(preview.result.from.remaining).toBe(2);
      expect(deck.cards.get("divergent-deal-c2").drawn).toBe(true);

      const drawShort = await router().route(
        createRequest("cards.draw", {
          cardsId: "divergent-deal-hand",
          from: "divergent-deal",
          count: 2,
          ...KEY
        })
      );
      expect(drawShort.ok).toBe(false);
      expect(drawShort.error.code).toBe(ERROR_CODES.INSUFFICIENT_CARDS);
      expect(drawShort.error.details).toMatchObject({ available: 1, requested: 2, type: "deck" });

      const shortfall = await router().route(
        createRequest("cards.deal", {
          cardsId: "divergent-deal",
          to: ["divergent-deal-hand"],
          count: 2,
          ...KEY
        })
      );
      expect(shortfall.ok).toBe(false);
      expect(shortfall.error.code).toBe(ERROR_CODES.INSUFFICIENT_CARDS);
      expect(shortfall.error.details).toMatchObject({ available: 1, requested: 2, type: "deck" });
      expect(deck.deal).not.toHaveBeenCalled();

      const origin = deckOf("divergent-origin", 1);
      const originRow = origin.cards.get("divergent-origin-c1");
      originRow._source.drawn = true;
      originRow.drawn = false;
      const hand = seedStack("divergent-pass-hand", {
        type: "hand",
        cards: [{ id: "divergent-origin-c1", name: "C1", drawn: true, origin: "divergent-origin" }]
      });
      const passed = await router().route(
        createRequest("cards.pass", {
          cardsId: "divergent-pass-hand",
          to: "divergent-origin",
          cardIds: ["divergent-origin-c1"],
          idempotencyKey: "divergent-pass"
        })
      );
      expect(passed.ok, JSON.stringify(passed.error ?? {})).toBe(true);
      expect(passed.result.mutation).toBe("committed");
      expect(passed.result.to[0].returnedCardIds).toEqual(["divergent-origin-c1"]);
      expect(passed.result.from.removedCardIds).toEqual(["divergent-origin-c1"]);
      expect(originRow._source.drawn).toBe(false);
      expect(hand.cards.get("divergent-origin-c1")).toBeNull();
    });

    it("cards.pass refuses an unknown card id (CARD_NOT_FOUND), a duplicate id and an already-drawn DECK card", async () => {
      const deck = deckOf("pass-guard", 2);
      seedStack("pass-guard-hand", { type: "hand" });
      const missing = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-guard",
          to: "pass-guard-hand",
          cardIds: ["nope"],
          ...KEY
        })
      );
      expect(missing.error.code).toBe(ERROR_CODES.CARD_NOT_FOUND);

      const duplicate = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-guard",
          to: "pass-guard-hand",
          cardIds: ["pass-guard-c1", "pass-guard-c1"],
          ...KEY
        })
      );
      expect(duplicate.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(duplicate.error.message).toContain("same card more than once");
      expect(duplicate.error.details.duplicates).toEqual(["pass-guard-c1"]);

      deck.cards.get("pass-guard-c1").drawn = true;
      deck.cards.get("pass-guard-c1")._source.drawn = true;
      const drawn = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-guard",
          to: "pass-guard-hand",
          cardIds: ["pass-guard-c1"],
          ...KEY
        })
      );
      expect(drawn.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(drawn.error.details.alreadyDrawnCardIds).toEqual(["pass-guard-c1"]);
      expect(deck.pass).not.toHaveBeenCalled();

      const hand = seedStack("pass-guard-src", {
        type: "hand",
        cards: [{ id: "pass-guard-src-c1", name: "C1", drawn: true }]
      });
      const allowed = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-guard-src",
          to: "pass-guard-hand",
          cardIds: ["pass-guard-src-c1"],
          idempotencyKey: "pass-hand-drawn"
        })
      );
      expect(allowed.ok, JSON.stringify(allowed.error ?? {})).toBe(true);
      expect(hand.pass).toHaveBeenCalledTimes(1);
    });

    it("cards.pass bounds cardIds before linear duplicate detection and card resolution", async () => {
      const deck = deckOf("pass-bound", CARDS_PASS_MAX_IDS);
      seedStack("pass-bound-hand", { type: "hand" });
      const atCapIds = Array.from({ length: CARDS_PASS_MAX_IDS }, (_, index) => `pass-bound-c${index + 1}`);

      const atCap = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-bound",
          to: "pass-bound-hand",
          cardIds: atCapIds,
          idempotencyKey: "pass-at-bound",
          dryRun: true
        })
      );
      expect(atCap.ok, JSON.stringify(atCap.error ?? {})).toBe(true);
      expect(atCap.result.to[0].expected).toBe(CARDS_PASS_MAX_IDS);
      expect(deck.pass).not.toHaveBeenCalled();

      const overCap = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-bound",
          to: "pass-bound-hand",
          cardIds: Array.from({ length: CARDS_PASS_MAX_IDS + 1 }, () => "pass-bound-c1"),
          idempotencyKey: "pass-over-bound"
        })
      );
      expect(overCap.ok).toBe(false);
      expect(overCap.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(overCap.error.details).toEqual({
        max: CARDS_PASS_MAX_IDS,
        received: CARDS_PASS_MAX_IDS + 1
      });
      expect(deck.pass).not.toHaveBeenCalled();
    });

    it("cards.pass moves a DRAWN card out of a pile (the drawn flag gates nothing off a deck)", async () => {
      const pile = seedStack("pass-no-avail", {
        type: "pile",
        cards: [{ id: "pass-no-avail-c1", name: "C1", drawn: true }]
      });
      seedStack("pass-no-avail-dest", { type: "hand" });
      const response = await router().route(
        createRequest("cards.pass", {
          cardsId: "pass-no-avail",
          to: "pass-no-avail-dest",
          cardIds: ["pass-no-avail-c1"],
          ...KEY
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(pile.pass).toHaveBeenCalledTimes(1);
    });

    it("maps `how` to Foundry's numeric CARD_DRAW_MODES and never forwards a raw number", async () => {
      const deck = deckOf("how-deck", 3);
      seedStack("how-hand", { type: "hand" });
      for (const [how, expected] of [
        ["top", 0],
        ["bottom", 1],
        ["random", 2]
      ]) {
        deck.deal.mockClear();
        await router().route(
          createRequest("cards.deal", { cardsId: "how-deck", to: ["how-hand"], how, chat: false, ...KEY })
        );
        expect(deck.deal.mock.calls[0][2].how).toBe(expected);
      }

      deck.deal.mockClear();
      const deck2 = deckOf("how-deck-2", 1);
      await router().route(
        createRequest("cards.deal", { cardsId: "how-deck-2", to: ["how-hand"], chat: false, ...KEY })
      );
      expect(deck2.deal.mock.calls[0][2].how).toBe(0);

      expect(deck2.deal.mock.calls[0][2]).not.toHaveProperty("action");
    });

    it("CAPS the movement body's id and destination lists while keeping every count EXACT", async () => {
      const deck = deckOf("cap-deck", 21);
      seedStack("cap-hand", { type: "hand" });
      const oneDestination = await router().route(
        createRequest("cards.deal", {
          cardsId: "cap-deck",
          to: ["cap-hand"],
          count: 21,
          chat: false,
          idempotencyKey: "cap-1"
        })
      );
      expect(oneDestination.ok, JSON.stringify(oneDestination.error ?? {})).toBe(true);
      expect(oneDestination.result.mutation).toBe("committed");
      expect(oneDestination.result.to[0].receivedCardIds).toHaveLength(20);
      expect(oneDestination.result.to[0].receivedCardIdsCount).toBe(21);
      expect(oneDestination.result.to[0].receivedCardIdsTruncated).toBe(true);

      expect(oneDestination.result.from.drawnCardIds).toHaveLength(21);
      expect(oneDestination.result.from.drawnCardIdsTruncated).toBe(false);
      expect(deck.cards.size).toBe(21);

      const wide = deckOf("cap-wide-deck", 21);
      const targets = Array.from({ length: 21 }, (_, index) => {
        seedStack(`cap-target-${index}`, { type: "hand" });
        return `cap-target-${index}`;
      });
      const manyDestinations = await router().route(
        createRequest("cards.deal", {
          cardsId: "cap-wide-deck",
          to: targets,
          count: 1,
          chat: false,
          idempotencyKey: "cap-2"
        })
      );
      expect(manyDestinations.ok, JSON.stringify(manyDestinations.error ?? {})).toBe(true);
      expect(manyDestinations.result.mutation).toBe("committed");
      expect(manyDestinations.result.to).toHaveLength(20);
      expect(manyDestinations.result.toCount).toBe(21);
      expect(manyDestinations.result.toTruncated).toBe(true);
      expect(wide.cards.size).toBe(21);
    });

    it("serializes CONCURRENT deals against one deck so no card is selected twice", async () => {
      const deck = deckOf("queue-deck", 1);
      const handA = seedStack("queue-hand-a", { type: "hand" });
      const handB = seedStack("queue-hand-b", { type: "hand" });
      const events = [];
      /** @type {() => void} */
      let release = () => {};
      const gate = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      let gated = true;
      const originalDeal = deck.deal;
      deck.deal = vi.fn(async (...args) => {
        events.push("deal-start");
        if (gated) {
          gated = false;
          await gate;
        }
        const result = await originalDeal(...args);
        events.push("deal-end");
        return result;
      });

      const pending = [
        router().route(
          createRequest("cards.deal", {
            cardsId: "queue-deck",
            to: ["queue-hand-a"],
            chat: false,
            idempotencyKey: "q-a"
          })
        ),
        router().route(
          createRequest("cards.deal", {
            cardsId: "queue-deck",
            to: ["queue-hand-b"],
            chat: false,
            idempotencyKey: "q-b"
          })
        )
      ];
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(events).toEqual(["deal-start"]);
      release();
      const [first, second] = await Promise.all(pending);

      expect(events).toEqual(["deal-start", "deal-end"]);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(false);
      expect(second.error.code).toBe(ERROR_CODES.INSUFFICIENT_CARDS);
      expect(handA.cards.size + handB.cards.size).toBe(1);
      expect([...deck.cards].filter((card) => card._source.drawn)).toHaveLength(1);
    });

    it("serializes a shuffle/reset/draw/pass against another cards write on the SAME queue", async () => {
      const deck = deckOf("queue-mixed", 2);
      seedStack("queue-mixed-hand", { type: "hand" });

      const pile = seedStack("queue-mixed-pile", {
        type: "pile",
        cards: [{ id: "queue-mixed-p1", name: "P1" }]
      });
      const events = [];
      /** @type {() => void} */
      let release = () => {};
      const gate = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      const originalUpdate = deck.update;
      deck.update = vi.fn(async (...args) => {
        events.push("stack-update-start");
        await gate;
        events.push("stack-update-end");
        return originalUpdate(...args);
      });

      const drawHand = seedStack("queue-mixed-draw-hand", { type: "hand" });
      for (const [holder, method] of [
        [deck, "shuffle"],
        [deck, "recall"],
        [deck, "deal"],
        [drawHand, "draw"],
        [pile, "pass"]
      ]) {
        const original = holder[method];
        holder[method] = vi.fn(async (...args) => {
          events.push(method);
          return original(...args);
        });
      }

      const pending = [
        router().route(createRequest("cards.update", { cardsId: "queue-mixed", patch: { sort: 4 } })),
        router().route(createRequest("cards.shuffle", { cardsId: "queue-mixed", chat: false })),
        router().route(createRequest("cards.reset", { cardsId: "queue-mixed", chat: false })),
        router().route(
          createRequest("cards.deal", {
            cardsId: "queue-mixed",
            to: ["queue-mixed-hand"],
            chat: false,
            idempotencyKey: "qm-deal"
          })
        ),
        router().route(
          createRequest("cards.draw", {
            cardsId: "queue-mixed-draw-hand",
            from: "queue-mixed",
            chat: false,
            idempotencyKey: "qm-draw"
          })
        ),
        router().route(
          createRequest("cards.pass", {
            cardsId: "queue-mixed-pile",
            to: "queue-mixed-hand",
            cardIds: ["queue-mixed-p1"],
            chat: false,
            idempotencyKey: "qm-pass"
          })
        )
      ];
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(events).toEqual(["stack-update-start"]);
      release();
      const responses = await Promise.all(pending);
      expect(
        responses.map((response) => response.ok),
        JSON.stringify(responses.map((response) => response.error ?? null))
      ).toEqual([true, true, true, true, true, true]);
      expect(events).toEqual([
        "stack-update-start",
        "stack-update-end",
        "shuffle",
        "recall",
        "deal",
        "draw",
        "pass"
      ]);
    });
  });
});
