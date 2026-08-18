import { CommanderError } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { failIfCalledSendCommand, runCommand } from "./helpers/cli-harness.js";
import type { SendCommandMock } from "./helpers/cli-harness.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cards.* human output", () => {
  const respond = (result: Record<string, unknown>) =>
    vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-cards",
      ok: true,
      result
    })) as unknown as SendCommandMock;

  it("cards delete prints the recall consequences per category, on the dry run and the real call", async () => {
    const recall = {
      type: "hand",
      reclaimed: [],
      returned: [{ cardsId: "deck-1", cardsName: "Poker Deck", cardIds: ["card-ace"] }],
      skippedCardIds: ["card-own"],
      destroyedCardIds: ["card-orphan"],
      ownDrawnResetCardIds: [],
      danglingOriginsLeft: [{ cardsId: "pile-1", cardsName: "Discard", cardIds: ["card-x"] }],
      originRowsLeftDrawn: [],
      status: "not-executed",
      deleteConsequences: "prospective"
    };
    const dry = await runCommand(
      ["cards", "delete", "--cards-id", "hand-1", "--dry-run"],
      respond({
        id: "hand-1",
        deleted: false,
        recall,
        chatNotification: { requested: false, status: "not-requested" },
        dryRun: true
      })
    );
    expect(dry.error).toBeNull();

    expect(dry.stdout).toContain("would first RECALL its cards");
    expect(dry.stdout).toContain("cards RETURNED to deck-1 (Poker Deck): card-ace");

    expect(dry.stdout).toContain("DESTROYED with nothing returned anywhere");
    expect(dry.stdout).toContain("card-orphan");
    expect(dry.stdout).toContain("a recall can never move these");

    expect(dry.stdout).toContain("on a DELETE they stay in the stack and are DESTROYED with it");
    expect(dry.stdout).toContain("card-own");

    expect(dry.stdout).toContain("delete consequences prospective");
    expect(dry.stdout).toContain(
      "the stack still EXISTS (nothing was deleted), so the two `left …` lists below are a FORECAST"
    );
    expect(dry.stdout).toContain("WOULD be left with a DANGLING origin in pile-1");

    const real = await runCommand(
      ["cards", "delete", "--cards-id", "hand-1"],
      respond({
        id: "hand-1",
        deleted: true,
        recall: { ...recall, status: "confirmed", deleteConsequences: "applied" },
        chatNotification: { requested: true, status: "dispatched" }
      })
    );
    expect(real.stdout).toContain("Deleted card stack hand-1");
    expect(real.stdout).toContain("recall: confirmed");

    expect(real.stdout).toContain("delete consequences applied");
    expect(real.stdout).toContain("left with a DANGLING origin in pile-1");
    expect(real.stdout).not.toContain("WOULD be left with a DANGLING origin");
    expect(real.stdout).not.toContain("the stack still EXISTS");

    expect(real.stdout).toContain("cannot be suppressed through a delete");
  });

  it("cards delete surfaces an UNCONFIRMED recall without assuming veto versus a missing row", async () => {
    const response = await runCommand(
      ["cards", "delete", "--cards-id", "hand-1"],
      respond({
        id: "hand-1",
        deleted: true,
        recall: {
          type: "hand",
          reclaimed: [],
          returned: [{ cardsId: "deck-1", cardsName: "Poker Deck", cardIds: ["card-ace"] }],
          skippedCardIds: [],
          destroyedCardIds: [],
          ownDrawnResetCardIds: [],
          danglingOriginsLeft: [],
          originRowsLeftDrawn: [],
          status: "unconfirmed",
          unconfirmed: {
            reclaimedRemaining: [],
            notReturned: [{ cardsId: "deck-1", cardIds: ["card-ace"] }]
          }
        },
        chatNotification: { requested: true, status: "unknown" }
      })
    );
    expect(response.error).toBeNull();
    expect(response.stdout).toContain("recall: unconfirmed");
    expect(response.stdout).toContain("UNCONFIRMED");
    expect(response.stdout).toContain("missing OR still stored drawn=true in: deck-1");

    expect(response.stdout).toContain("`returnCards` hook veto");

    expect(response.stdout).toContain("Deleted card stack hand-1");

    expect(response.stdout).toContain("the delete went through while these rows did not");
  });

  it("an UNCONFIRMED DECK recall does NOT blame `returnCards` — a deck recall fires no hook", async () => {
    const response = await runCommand(
      ["cards", "delete", "--cards-id", "deck-1"],
      respond({
        id: "deck-1",
        deleted: true,
        recall: {
          type: "deck",
          reclaimed: [{ cardsId: "hand-1", cardsName: "Hand", cardIds: ["card-ace"] }],
          returned: [],
          skippedCardIds: [],
          destroyedCardIds: [],
          ownDrawnResetCardIds: ["card-ace"],

          danglingOriginsLeft: [{ cardsId: "hand-1", cardsName: "Hand", cardIds: ["card-ace"] }],
          originRowsLeftDrawn: [],
          status: "unconfirmed",
          deleteConsequences: "applied",
          unconfirmed: {
            reclaimedRemaining: [{ cardsId: "hand-1", cardIds: ["card-ace"] }],
            notReturned: []
          }
        },
        chatNotification: { requested: true, status: "unknown" }
      })
    );
    expect(response.error).toBeNull();
    expect(response.stdout).toContain("UNCONFIRMED");
    expect(response.stdout).toContain("a deck recall fires no `returnCards` hook at all");
    expect(response.stdout).toContain("preDeleteCard");
    expect(response.stdout).not.toContain("`returnCards` hook veto");
    expect(response.stdout).toContain("still holding this stack's cards");

    expect(response.stdout).toContain("left with a DANGLING origin in hand-1");
    expect(response.stdout).toContain("this stack is GONE, so those rows now store a DANGLING origin");
    expect(response.stdout).toContain("their reclaim did not land");
  });

  it("cards delete names the ORIGIN rows a DECK recall strands stored drawn=true, and the repair", async () => {
    const response = await runCommand(
      ["cards", "delete", "--cards-id", "deck-2", "--dry-run"],
      respond({
        id: "deck-2",
        deleted: false,
        dryRun: true,
        recall: {
          type: "deck",
          reclaimed: [],
          returned: [],
          skippedCardIds: [],
          destroyedCardIds: [],
          ownDrawnResetCardIds: ["card-ace"],
          danglingOriginsLeft: [],
          originRowsLeftDrawn: [{ cardsId: "deck-1", cardsName: "Poker Deck", cardIds: ["card-ace"] }],
          status: "not-executed",
          deleteConsequences: "prospective"
        },
        chatNotification: { requested: false, status: "not-requested" }
      })
    );
    expect(response.error).toBeNull();

    expect(response.stdout).toContain(
      "WOULD be left stored drawn=true (the copy in this stack would be destroyed, nothing is returned)"
    );

    expect(response.stdout).toContain(
      "repair: recall that origin (`cards reset --cards-id <origin>`, or Foundry's Cards sidebar)"
    );
    expect(response.stdout).not.toContain("a later chunk");
    expect(response.stdout).not.toContain("FOREVER");
    expect(response.stdout).toContain("deck-1 (Poker Deck): card-ace");

    expect(response.stdout).toContain("repair: recall that origin");
    expect(response.stdout).toContain("a DECK recall rewrites EVERY one of its own rows drawn=false");
    expect(response.stdout).toContain("a HAND/PILE origin's own rows are `isHome`");

    const landed = await runCommand(
      ["cards", "delete", "--cards-id", "deck-2"],
      respond({
        id: "deck-2",
        deleted: true,
        recall: {
          type: "deck",
          reclaimed: [],
          returned: [],
          skippedCardIds: [],
          destroyedCardIds: [],
          ownDrawnResetCardIds: ["card-ace"],
          danglingOriginsLeft: [],
          originRowsLeftDrawn: [{ cardsId: "deck-1", cardsName: "Poker Deck", cardIds: ["card-ace"] }],
          status: "confirmed",
          deleteConsequences: "applied"
        },
        chatNotification: { requested: true, status: "dispatched" }
      })
    );
    expect(landed.stdout).toContain(
      "left stored drawn=true (the copy in this stack is destroyed, nothing is returned)"
    );
    expect(landed.stdout).not.toContain("WOULD be left");
  });

  it("cards delete never prints a CAPPED id list as if it were complete", async () => {
    const response = await runCommand(
      ["cards", "delete", "--cards-id", "deck-3", "--dry-run"],
      respond({
        id: "deck-3",
        deleted: false,
        dryRun: true,
        recall: {
          type: "deck",
          reclaimed: [
            {
              cardsId: "hand-1",
              cardsName: "Hand",
              cardIds: ["c1", "c2"],
              cardIdsCount: 30,
              cardIdsTruncated: true
            }
          ],
          reclaimedCount: 25,
          reclaimedTruncated: true,
          returned: [],
          returnedCount: 0,
          returnedTruncated: false,
          skippedCardIds: [],
          skippedCardIdsCount: 0,
          skippedCardIdsTruncated: false,
          destroyedCardIds: [],
          destroyedCardIdsCount: 0,
          destroyedCardIdsTruncated: false,
          ownDrawnResetCardIds: ["c1", "c2"],
          ownDrawnResetCardIdsCount: 120,
          ownDrawnResetCardIdsTruncated: true,
          danglingOriginsLeft: [],
          danglingOriginsLeftCount: 0,
          danglingOriginsLeftTruncated: false,
          originRowsLeftDrawn: [],
          originRowsLeftDrawnCount: 0,
          originRowsLeftDrawnTruncated: false,
          status: "not-executed"
        },
        chatNotification: { requested: false, status: "not-requested" }
      })
    );
    expect(response.error).toBeNull();

    expect(response.stdout).toContain("c1, c2 … (2 of 30 shown)");

    expect(response.stdout).toContain("more stack(s) not shown (25 affected in total)");

    expect(response.stdout).toContain("own rows set drawn=false (");
    expect(response.stdout).toContain(
      "DESTROYED with it, so this write changes nothing that survives): c1, c2 … (2 of 120 shown)"
    );
  });

  it("cards delete prints the TARGET stack's own unconfirmed rows, not just the other stacks'", async () => {
    const response = await runCommand(
      ["cards", "delete", "--cards-id", "hand-4"],
      respond({
        id: "hand-4",
        deleted: true,
        recall: {
          type: "hand",
          reclaimed: [],
          returned: [{ cardsId: "deck-1", cardsName: "Poker Deck", cardIds: ["card-ace"] }],
          skippedCardIds: [],
          destroyedCardIds: [],
          ownDrawnResetCardIds: [],
          danglingOriginsLeft: [],
          originRowsLeftDrawn: [],
          status: "unconfirmed",
          unconfirmed: {
            reclaimedRemaining: [],
            notReturned: [],
            ownRowsStillDrawn: ["card-king"],
            ownRowsStillDrawnCount: 1,
            ownRowsStillDrawnTruncated: false,
            notRemovedCardIds: ["card-ace", "card-orphan"],
            notRemovedCardIdsCount: 2,
            notRemovedCardIdsTruncated: false
          }
        },
        chatNotification: { requested: true, status: "unknown" }
      })
    );
    expect(response.error).toBeNull();
    expect(response.stdout).toContain("UNCONFIRMED");

    expect(response.stdout).toContain("i.e. a DUPLICATE: card-ace, card-orphan (2)");
    expect(response.stdout).toContain("this stack's OWN rows still stored drawn=true");
    expect(response.stdout).toContain("card-king (1)");
  });

  it("cards delete prints NO repair line when no origin row was stranded", async () => {
    const response = await runCommand(
      ["cards", "delete", "--cards-id", "hand-9", "--dry-run"],
      respond({
        id: "hand-9",
        deleted: false,
        dryRun: true,
        recall: {
          type: "hand",
          reclaimed: [],
          returned: [],
          skippedCardIds: ["card-own"],
          destroyedCardIds: [],
          ownDrawnResetCardIds: [],
          danglingOriginsLeft: [],
          originRowsLeftDrawn: [],
          status: "not-executed"
        },
        chatNotification: { requested: false, status: "not-requested" }
      })
    );
    expect(response.error).toBeNull();
    expect(response.stdout).toContain("skipped (no origin, or a dangling one");
    expect(response.stdout).not.toContain("repair: recall that origin");
    expect(response.stdout).not.toContain("left stored drawn=true");
  });

  it("cards clone WARNS when copied cards can never be returned to their origin", async () => {
    const cards = { id: "hand-clone", name: "Copy", type: "hand", cards: [] };
    const warned = await runCommand(
      ["cards", "clone", "--cards-id", "hand-1"],
      respond({ cards, cardsCopy: { count: 3, idsReminted: true, drawnCleared: 1, unreturnableCards: 2 } })
    );
    expect(warned.error).toBeNull();
    expect(warned.stdout).toContain("cardsCopied: 3 (ids re-minted: true; drawn flags cleared: 1)");
    expect(warned.stdout).toContain("WARNING: 2 copied card(s)");

    expect(warned.stdout).toContain("naming an EXISTING other stack");
    expect(warned.stdout).toContain("DELETES those cards");

    const clean = await runCommand(
      ["cards", "clone", "--cards-id", "deck-1"],
      respond({ cards, cardsCopy: { count: 3, idsReminted: true, drawnCleared: 0, unreturnableCards: 0 } })
    );
    expect(clean.stdout).toContain("cardsCopied: 3");
    expect(clean.stdout).not.toContain("WARNING");
  });

  it("cards list prints the type-dependent availability columns", async () => {
    const response = await runCommand(
      ["cards", "list"],
      respond({
        cards: [
          {
            id: "deck-1",
            name: "Poker Deck",
            type: "deck",
            cardCount: 2,
            drawnCount: 2,
            availableCount: 0,
            folder: null
          },
          {
            id: "hand-1",
            name: "Hand",
            type: "hand",
            cardCount: 2,
            drawnCount: 1,
            availableCount: 2,
            folder: null
          }
        ],
        total: 2,
        hasMore: false
      })
    );
    expect(response.error).toBeNull();
    expect(response.stdout).toContain("type=deck\tcards=2\tdrawn=2\tavailable=0");

    expect(response.stdout).toContain("type=hand\tcards=2\tdrawn=1\tavailable=2");
  });

  it("cards card list leads with the OWNING stack, per row, in both scope modes", async () => {
    const rows = [
      {
        id: "card-ace",
        cardsId: "hand-1",
        cardsName: "Player Hand",
        name: "Stored Ace",
        suit: "S",
        value: 1,
        face: 0,
        faceCount: 1,
        drawn: true,
        origin: "deck-1",
        sort: 100
      }
    ];
    const perStack = await runCommand(
      ["cards", "card", "list", "--cards-id", "hand-1"],
      respond({ cardsId: "hand-1", cards: rows, total: 1, hasMore: false })
    );
    expect(perStack.error).toBeNull();
    expect(perStack.stdout).toContain("cards: hand-1");

    expect(perStack.stdout).toContain("hand-1\tPlayer Hand\tcard-ace\tStored Ace");
    expect(perStack.stdout).toContain("drawn=true\torigin=deck-1");
    const crossStack = await runCommand(
      ["cards", "card", "list"],
      respond({ cards: rows, total: 1, hasMore: false })
    );
    expect(crossStack.stdout).toContain("scope: all card stacks");
    expect(crossStack.stdout).toContain("hand-1\tPlayer Hand\tcard-ace");

    const zeroFaces = await runCommand(
      ["cards", "card", "list", "--cards-id", "hand-1"],
      respond({ cardsId: "hand-1", cards: [{ ...rows[0], faceCount: 0 }], total: 1, hasMore: false })
    );
    expect(zeroFaces.stdout).toContain("face=0\tfaces=0");

    const { faceCount: _omitted, ...noFaceCount } = rows[0];
    const unknownFaces = await runCommand(
      ["cards", "card", "list", "--cards-id", "hand-1"],
      respond({ cardsId: "hand-1", cards: [noFaceCount], total: 1, hasMore: false })
    );
    expect(unknownFaces.stdout).toContain("face=0\tfaces=?");
  });

  it("cards card get prints the faces/back art and says which fields are read-only", async () => {
    const card = {
      id: "card-ace",
      name: "Stored Ace",
      type: "base",
      description: "",
      suit: "S",
      value: 1,
      back: { name: "Back", text: "", img: null },
      faces: [{ name: "Ace", img: "worlds/w/ace.webp", text: "" }],
      face: 0,
      drawn: true,
      origin: "deck-1",
      width: null,
      height: null,
      rotation: 0,
      sort: 100,
      system: {},
      flags: {}
    };
    const response = await runCommand(
      ["cards", "card", "get", "--cards-id", "hand-1", "--card-id", "card-ace"],
      respond({ cardsId: "hand-1", card })
    );
    expect(response.error).toBeNull();
    expect(response.stdout).toContain("cards: hand-1");
    expect(response.stdout).toContain("name: Stored Ace");

    expect(response.stdout).toContain("[0] name=Ace img=worlds/w/ace.webp");
    expect(response.stdout).toContain("back: name=Back img= text=");
    expect(response.stdout).not.toMatch(/^img: /m);

    expect(response.stdout).toContain("drawn: true (read-only");
    expect(response.stdout).toContain("origin: deck-1 (read-only)");
    expect(response.stdout).toContain("face: 0 (showing a face)");

    expect(response.stdout).not.toContain("ownership");

    const backUp = await runCommand(
      ["cards", "card", "get", "--cards-id", "hand-1", "--card-id", "card-ace"],
      respond({ cardsId: "hand-1", card: { ...card, face: null } })
    );
    expect(backUp.stdout).toContain("showing the BACK");

    const outOfRange = await runCommand(
      ["cards", "card", "get", "--cards-id", "hand-1", "--card-id", "card-ace"],
      respond({
        cardsId: "hand-1",
        card: { ...card, face: 1, faces: [{ name: "Ace", img: "worlds/w/ace.webp" }] }
      })
    );
    expect(outOfRange.stdout).toContain("face: 1 (showing the BACK)");
  });

  it("cards card clone warns from the module's recallDeletesCopy, NOT from a truthy origin", async () => {
    const card = { id: "card-copy", name: "Ace Copy", faces: [], back: {}, drawn: true, origin: "deck-1" };
    const dealt = await runCommand(
      ["cards", "card", "clone", "--cards-id", "hand-1", "--card-id", "card-ace"],
      respond({ cardsId: "hand-1", card, recallDeletesCopy: true })
    );
    expect(dealt.error).toBeNull();

    expect(dealt.stdout).toContain("WARNING: this copy keeps origin=deck-1");
    expect(dealt.stdout).toContain(
      "of THIS stack when it is a hand or pile, or of the origin stack when that stack is a deck"
    );

    const home = await runCommand(
      ["cards", "card", "clone", "--cards-id", "deck-1", "--card-id", "card-king"],
      respond({ cardsId: "deck-1", card: { ...card, drawn: false, origin: null }, recallDeletesCopy: false })
    );
    expect(home.stdout).not.toContain("WARNING");

    const benign = await runCommand(
      ["cards", "card", "clone", "--cards-id", "hand-1", "--card-id", "card-ace"],
      respond({ cardsId: "hand-1", card: { ...card, origin: "deck-gone-forever" }, recallDeletesCopy: false })
    );
    expect(benign.stdout).toContain("origin: deck-gone-forever");
    expect(benign.stdout).not.toContain("WARNING");
  });

  it("cards deal prints the movement bookkeeping per stack, with every capped list named as a sample", async () => {
    const real = await runCommand(
      [
        "cards",
        "deal",
        "--cards-id",
        "deck-1",
        "--to",
        "hand-1,hand-2",
        "--count",
        "2",
        "--idempotency-key",
        "k1"
      ],
      respond({
        cardsId: "deck-1",
        complete: true,
        mutation: "committed",
        reconciliation: "confirmed",
        from: {
          cardsId: "deck-1",
          cardsName: "Poker Deck",
          remaining: 4,
          removedCardIds: ["card-x"],
          removedCardIdsCount: 1,
          removedCardIdsTruncated: false,
          drawnCardIds: ["card-ace", "card-king"],
          drawnCardIdsCount: 3,
          drawnCardIdsTruncated: true
        },
        to: [
          {
            cardsId: "hand-1",
            cardsName: "Alice",
            expected: 2,
            receivedCardIds: ["card-ace", "card-king"],
            receivedCardIdsCount: 2,
            receivedCardIdsTruncated: false,
            returnedCardIds: [],
            returnedCardIdsCount: 0,
            returnedCardIdsTruncated: false
          }
        ],
        toCount: 3,
        toTruncated: true,
        chatNotification: { requested: true, status: "dispatched" }
      })
    );
    expect(real.error).toBeNull();
    expect(real.stdout).toContain("cards deal: moved cards are listed per stack below");
    expect(real.stdout).toContain("from deck-1 (Poker Deck) — available remaining: 4");
    expect(real.stdout).toContain("left this stack: card-x (1)");

    expect(real.stdout).toContain(
      "stayed here but flagged drawn (the destination holds a copy under the SAME id)"
    );

    expect(real.stdout).toContain("card-ace, card-king … (2 of 3 shown)");
    expect(real.stdout).toContain("to hand-1 (Alice) — expected 2");
    expect(real.stdout).toContain("received: card-ace, card-king (2)");
    expect(real.stdout).toContain("… 2 more destination(s) not shown (3 in total)");
    expect(real.stdout).toContain("complete: true");
    expect(real.stdout).toContain("mutation: committed");
    expect(real.stdout).toContain("`dispatched` means Foundry reached its notification call");

    const dry = await runCommand(
      ["cards", "deal", "--cards-id", "deck-1", "--to", "hand-1", "--dry-run", "--idempotency-key", "k1"],
      respond({
        cardsId: "deck-1",
        complete: true,
        mutation: "not-executed",
        reconciliation: "not-executed",
        from: { cardsId: "deck-1", remaining: 6, removedCardIds: [], drawnCardIds: [] },
        to: [{ cardsId: "hand-1", expected: 1, receivedCardIds: [], returnedCardIds: [] }],
        toCount: 1,
        toTruncated: false,
        chatNotification: { requested: false, status: "not-requested" },
        dryRun: true
      })
    );

    expect(dry.stdout).toContain(
      '[dry-run] cards deal: nothing was moved — the counts below are the CURRENT state, and the empty moved-lists mean the cards are picked INSIDE Foundry and are not predicted here, not "nothing would move"'
    );
    expect(dry.stdout).not.toContain("unknowable");
    expect(dry.stdout).not.toContain("FORECAST");
    expect(dry.stdout).not.toContain("moved cards are listed per stack below");
  });

  it("cards pass prints the rejected movement's per-id hazards, worded as observations rather than verdicts", async () => {
    const rejected = await runCommand(
      [
        "cards",
        "pass",
        "--cards-id",
        "hand-1",
        "--to",
        "hand-2",
        "--card-ids",
        "card-x,card-y",
        "--idempotency-key",
        "k9"
      ],
      respond({
        cardsId: "hand-1",
        complete: false,
        mutation: "partial",
        reconciliation: "best-effort",
        from: {
          cardsId: "hand-1",
          cardsName: "Alice",
          remaining: 3,
          removedCardIds: ["card-x"],
          removedCardIdsCount: 1,
          removedCardIdsTruncated: false,
          drawnCardIds: [],
          drawnCardIdsCount: 0,
          drawnCardIdsTruncated: false,
          strandedCardIds: ["card-x"],
          strandedCardIdsCount: 1,
          strandedCardIdsTruncated: false,
          unconfirmedCardIds: ["card-y"],
          unconfirmedCardIdsCount: 4,
          unconfirmedCardIdsTruncated: true
        },
        to: [
          {
            cardsId: "hand-2",
            cardsName: "Bob",
            expected: 2,
            receivedCardIds: ["card-y"],
            receivedCardIdsCount: 1,
            receivedCardIdsTruncated: false,
            returnedCardIds: [],
            returnedCardIdsCount: 0,
            returnedCardIdsTruncated: false,
            invalidStateCardIds: ["card-z"],
            invalidStateCardIdsCount: 3,
            invalidStateCardIdsTruncated: true
          }
        ],
        toCount: 1,
        toTruncated: false,
        chatNotification: { requested: true, status: "not-dispatched" },
        failure: { code: "INTERNAL_ERROR", message: "destination create rejected" }
      })
    );
    expect(rejected.error).toBeNull();

    expect(rejected.stdout).toContain("observed leaving this stack with NO destination holding them");
    expect(rejected.stdout).toContain("card-x (1)");

    expect(rejected.stdout).toContain("collides on the duplicate _id");

    expect(rejected.stdout).toContain("card-y … (1 of 4 shown)");
    expect(rejected.stdout).toContain("WRONG stored origin/drawn");
    expect(rejected.stdout).toContain("card-z … (1 of 3 shown)");

    expect(rejected.stdout).toContain("BEST-EFFORT");
    expect(rejected.stdout).not.toContain("the source gave the card up and nothing received it");

    const clean = await runCommand(
      [
        "cards",
        "pass",
        "--cards-id",
        "hand-1",
        "--to",
        "hand-2",
        "--card-ids",
        "card-x",
        "--idempotency-key",
        "k10"
      ],
      respond({
        cardsId: "hand-1",
        complete: true,
        mutation: "committed",
        reconciliation: "confirmed",
        from: {
          cardsId: "hand-1",
          remaining: 3,
          removedCardIds: ["card-x"],
          removedCardIdsCount: 1,
          removedCardIdsTruncated: false,
          drawnCardIds: [],
          strandedCardIds: [],
          strandedCardIdsCount: 0,
          strandedCardIdsTruncated: false,
          unconfirmedCardIds: [],
          unconfirmedCardIdsCount: 0,
          unconfirmedCardIdsTruncated: false
        },
        to: [
          {
            cardsId: "hand-2",
            expected: 1,
            receivedCardIds: ["card-x"],
            receivedCardIdsCount: 1,
            receivedCardIdsTruncated: false,
            returnedCardIds: []
          }
        ],
        toCount: 1,
        toTruncated: false,
        chatNotification: { requested: true, status: "dispatched" }
      })
    );
    expect(clean.stdout).not.toContain("WATCH —");

    const resolvedFailure = await runCommand(
      [
        "cards",
        "pass",
        "--cards-id",
        "hand-1",
        "--to",
        "hand-2",
        "--card-ids",
        "card-x",
        "--idempotency-key",
        "k11"
      ],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "cards.pass on Cards hand-1 resolved, but a re-read of STORED state shows …",
          details: {
            cardsId: "hand-1",
            from: { cardsId: "hand-1", strandedCardIds: ["card-x"], unconfirmedCardIds: [] },
            mutation: "partial",
            reconciliation: "confirmed"
          }
        }
      })) as unknown as Parameters<typeof runCommand>[1]
    );
    expect(resolvedFailure.stderr).toContain("INTERNAL_ERROR:");
    expect(resolvedFailure.stderr).toContain('"strandedCardIds"');
    expect(resolvedFailure.stderr).toContain('"card-x"');
  });

  it("cards pass --dry-run labels its counts a FORECAST, not the current state", async () => {
    const dry = await runCommand(
      [
        "cards",
        "pass",
        "--cards-id",
        "hand-1",
        "--to",
        "deck-1",
        "--card-ids",
        "card-ace,card-king",
        "--dry-run",
        "--idempotency-key",
        "k-pass-dry"
      ],
      respond({
        cardsId: "hand-1",
        complete: true,
        mutation: "not-executed",
        reconciliation: "not-executed",

        from: {
          cardsId: "hand-1",
          cardsName: "Alice",
          remaining: 0,
          removedCardIds: ["card-ace", "card-king"],
          removedCardIdsCount: 2,
          removedCardIdsTruncated: false,
          drawnCardIds: []
        },
        to: [
          {
            cardsId: "deck-1",
            cardsName: "Poker Deck",
            expected: 2,
            receivedCardIds: [],
            receivedCardIdsCount: 0,
            receivedCardIdsTruncated: false,
            returnedCardIds: ["card-ace", "card-king"],
            returnedCardIdsCount: 2,
            returnedCardIdsTruncated: false
          }
        ],
        toCount: 1,
        toTruncated: false,
        chatNotification: { requested: false, status: "not-requested" },
        dryRun: true
      })
    );
    expect(dry.error).toBeNull();
    expect(dry.stdout).toContain(
      "[dry-run] cards pass: nothing was moved — the counts and lists below are a FORECAST of the post-state"
    );
    expect(dry.stdout).not.toContain("the counts below are the CURRENT state");

    expect(dry.stdout).toContain("from hand-1 (Alice) — available remaining: 0");
    expect(dry.stdout).toContain("left this stack: card-ace, card-king (2)");
    expect(dry.stdout).toContain("returned to origin (no new row — the existing one went drawn=false)");
  });

  it("cards pass prints returnedCardIds, and cards draw discloses a BEST-EFFORT rejection", async () => {
    const returned = await runCommand(
      [
        "cards",
        "pass",
        "--cards-id",
        "hand-1",
        "--to",
        "deck-1",
        "--card-ids",
        "card-ace",
        "--idempotency-key",
        "k2"
      ],
      respond({
        cardsId: "hand-1",
        complete: true,
        mutation: "committed",
        reconciliation: "confirmed",
        from: {
          cardsId: "hand-1",
          remaining: 0,
          removedCardIds: ["card-ace"],
          removedCardIdsCount: 1,
          drawnCardIds: []
        },
        to: [
          {
            cardsId: "deck-1",
            expected: 1,
            receivedCardIds: [],
            receivedCardIdsCount: 0,
            returnedCardIds: ["card-ace"],
            returnedCardIdsCount: 1,
            returnedCardIdsTruncated: false
          }
        ],
        toCount: 1,
        toTruncated: false,
        chatNotification: { requested: true, status: "dispatched" }
      })
    );
    expect(returned.stdout).toContain(
      "returned to origin (no new row — the existing one went drawn=false): card-ace (1)"
    );

    const rejected = await runCommand(
      ["cards", "draw", "--cards-id", "hand-1", "--from", "deck-1", "--idempotency-key", "k3"],
      respond({
        cardsId: "hand-1",
        complete: false,
        mutation: "unknown",
        reconciliation: "best-effort",
        from: { cardsId: "deck-1", remaining: 5, removedCardIds: [], drawnCardIds: [] },
        to: [{ cardsId: "hand-1", expected: 1, receivedCardIds: [], returnedCardIds: [] }],
        toCount: 1,
        toTruncated: false,
        chatNotification: { requested: true, status: "not-dispatched" },
        failure: { code: "INTERNAL_ERROR", message: "socket closed" }
      })
    );

    expect(rejected.stdout).toContain("BEST-EFFORT: the typed method REJECTED");
    expect(rejected.stdout).toContain("there is no settle point");
    expect(rejected.stdout).toContain("failure: INTERNAL_ERROR socket closed");
    expect(rejected.stdout).not.toContain("`dispatched` means Foundry reached");

    const unwitnessed = await runCommand(
      [
        "cards",
        "pass",
        "--cards-id",
        "deck-a",
        "--to",
        "deck-b",
        "--card-ids",
        "card-ace",
        "--idempotency-key",
        "k4"
      ],
      respond({
        cardsId: "deck-a",
        complete: false,
        mutation: "unknown",
        reconciliation: "confirmed",
        from: { cardsId: "deck-a", remaining: 1, removedCardIds: [], drawnCardIds: [] },
        to: [
          {
            cardsId: "deck-b",
            expected: 1,
            receivedCardIds: [],
            receivedCardIdsCount: 0,
            returnedCardIds: [],
            returnedCardIdsCount: 0,
            indeterminateCardIds: ["card-ace"],
            indeterminateCardIdsCount: 1,
            indeterminateCardIdsTruncated: false
          }
        ],
        toCount: 1,
        toTruncated: false,
        chatNotification: { requested: true, status: "unknown" }
      })
    );
    expect(unwitnessed.stdout).toContain(
      "already in the requested state, and NOTHING witnessed this call putting it there"
    );
    expect(unwitnessed.stdout).toContain("card-ace (1)");

    expect(returned.stdout).not.toContain("NOTHING witnessed this call");
  });

  it("cards shuffle prints the identity-permutation note only when the verdict is undecidable", async () => {
    const undecidable = await runCommand(
      ["cards", "shuffle", "--cards-id", "deck-1"],
      respond({
        cardsId: "deck-1",
        complete: false,
        mutation: "unknown",
        reconciliation: "confirmed",
        shuffle: { count: 3, orderChanged: false },
        chatNotification: { requested: true, status: "dispatched" }
      })
    );
    expect(undecidable.stdout).toContain("Shuffled card stack deck-1 (3 card(s))");
    expect(undecidable.stdout).toContain(
      "the stored order did not change, which a shuffle that happened to reproduce it and a wholly refused one BOTH produce"
    );

    const committed = await runCommand(
      ["cards", "shuffle", "--cards-id", "deck-1"],
      respond({
        cardsId: "deck-1",
        complete: true,
        mutation: "committed",
        reconciliation: "confirmed",
        shuffle: { count: 3, orderChanged: true },
        chatNotification: { requested: true, status: "dispatched" }
      })
    );
    expect(committed.stdout).not.toContain("the stored order did not change");

    const partial = await runCommand(
      ["cards", "shuffle", "--cards-id", "deck-1"],
      respond({
        cardsId: "deck-1",
        complete: false,
        mutation: "partial",
        reconciliation: "confirmed",
        shuffle: { count: 3, orderChanged: true },
        chatNotification: { requested: true, status: "dispatched" }
      })
    );
    expect(partial.stdout).toContain("no longer the 0..n-1 permutation this verb writes");

    expect(committed.stdout).not.toContain("no longer the 0..n-1 permutation");
  });

  it("cards reset prints the RESET-scoped recall labels, never the delete-only consequences", async () => {
    const recall = {
      type: "hand",
      reclaimed: [],
      returned: [{ cardsId: "deck-1", cardsName: "Poker Deck", cardIds: ["card-ace"], cardIdsCount: 1 }],
      skippedCardIds: ["card-own"],
      skippedCardIdsCount: 1,
      ownDrawnResetCardIds: [],
      status: "confirmed"
    };
    const reset = await runCommand(
      ["cards", "reset", "--cards-id", "hand-1"],
      respond({
        cardsId: "hand-1",
        complete: true,
        mutation: "committed",
        reconciliation: "confirmed",
        recall,
        chatNotification: { requested: true, status: "dispatched" }
      })
    );
    expect(reset.error).toBeNull();
    expect(reset.stdout).toContain("Recalled card stack hand-1");
    expect(reset.stdout).toContain("recall: confirmed (stack type hand)");
    expect(reset.stdout).toContain("cards RETURNED to deck-1 (Poker Deck): card-ace (1)");

    expect(reset.stdout).toContain(
      "so they stay exactly where they are and this stack cannot be emptied by a reset"
    );
    expect(reset.stdout).not.toContain("DESTROYED with it");
    expect(reset.stdout).not.toContain("delete consequences");
    expect(reset.stdout).not.toContain("the stack still EXISTS");

    const deck = await runCommand(
      ["cards", "reset", "--cards-id", "deck-1", "--dry-run"],
      respond({
        cardsId: "deck-1",
        complete: true,
        mutation: "not-executed",
        reconciliation: "not-executed",
        recall: {
          type: "deck",
          reclaimed: [{ cardsId: "hand-1", cardsName: "Alice", cardIds: ["card-ace"], cardIdsCount: 1 }],
          returned: [],
          ownDrawnResetCardIds: ["card-ace"],
          ownDrawnResetCardIdsCount: 1,
          status: "not-executed"
        },
        chatNotification: { requested: false, status: "not-requested" },
        dryRun: true
      })
    );
    expect(deck.stdout).toContain("[dry-run] would RECALL card stack deck-1");
    expect(deck.stdout).toContain(
      "own rows set drawn=false (they are available to draw again): card-ace (1)"
    );
    expect(deck.stdout).not.toContain("this write changes nothing that survives");

    expect(deck.stdout).toContain("a DECK recall never looks at its OWN cards' origin");
  });

  it("cards reset prints COMMITTED beside an UNCONFIRMED recall as the non-failure it is", async () => {
    const response = await runCommand(
      ["cards", "reset", "--cards-id", "hand-1"],
      respond({
        cardsId: "hand-1",
        complete: true,
        mutation: "committed",
        reconciliation: "confirmed",
        recall: {
          type: "hand",
          reclaimed: [],
          returned: [{ cardsId: "deck-1", cardsName: "Poker Deck", cardIds: ["card-ace"] }],
          skippedCardIds: [],
          destroyedCardIds: [],
          ownDrawnResetCardIds: [],
          status: "unconfirmed",
          unconfirmed: {
            reclaimedRemaining: [],
            notReturned: [{ cardsId: "deck-1", cardIds: ["card-ace"] }],
            ownRowsStillDrawn: [],
            notRemovedCardIds: []
          }
        },
        chatNotification: { requested: true, status: "dispatched" }
      })
    );
    expect(response.error).toBeNull();
    expect(response.stdout).toContain("UNCONFIRMED");
    expect(response.stdout).toContain("missing OR still stored drawn=true in: deck-1");
    expect(response.stdout).toContain("nothing is MISSING");
    expect(response.stdout).toContain("mutation: committed");

    expect(response.stdout).not.toContain("the delete went through");

    const confirmed = await runCommand(
      ["cards", "reset", "--cards-id", "hand-1"],
      respond({
        cardsId: "hand-1",
        complete: true,
        mutation: "committed",
        reconciliation: "confirmed",
        recall: { type: "hand", reclaimed: [], returned: [], status: "confirmed" },
        chatNotification: { requested: true, status: "dispatched" }
      })
    );
    expect(confirmed.stdout).not.toContain("nothing is MISSING");
  });

  it("refuses a non-positive --count and an off-enum --how BEFORE any round-trip", async () => {
    for (const argv of [
      ["cards", "deal", "--cards-id", "deck-1", "--to", "hand-1", "--count", "0", "--idempotency-key", "k4"],
      ["cards", "deal", "--cards-id", "deck-1", "--to", "hand-1", "--count", "-1", "--idempotency-key", "k4"],
      [
        "cards",
        "draw",
        "--cards-id",
        "hand-1",
        "--from",
        "deck-1",
        "--count",
        "0",
        "--idempotency-key",
        "k4"
      ],
      [
        "cards",
        "deal",
        "--cards-id",
        "deck-1",
        "--to",
        "hand-1",
        "--how",
        "sideways",
        "--idempotency-key",
        "k4"
      ],
      ["cards", "draw", "--cards-id", "hand-1", "--from", "deck-1", "--how", "2", "--idempotency-key", "k4"]
    ]) {
      const sendCommand = failIfCalledSendCommand();
      const result = await runCommand(argv, sendCommand);
      expect(result.error, argv.join(" ")).toBeInstanceOf(CommanderError);
      expect(sendCommand, argv.join(" ")).not.toHaveBeenCalled();
    }

    const sendCommand = respond({
      cardsId: "deck-1",
      complete: true,
      mutation: "committed",
      reconciliation: "confirmed",
      from: { cardsId: "deck-1", remaining: 0, removedCardIds: [], drawnCardIds: [] },
      to: [{ cardsId: "hand-1", expected: 1, receivedCardIds: ["card-ace"], returnedCardIds: [] }],
      toCount: 1,
      toTruncated: false,
      chatNotification: { requested: true, status: "dispatched" }
    });
    const allowed = await runCommand(
      [
        "cards",
        "deal",
        "--cards-id",
        "deck-1",
        "--to",
        "hand-1",
        "--count",
        "1",
        "--how",
        "random",
        "--idempotency-key",
        "k5"
      ],
      sendCommand
    );
    expect(allowed.error).toBeNull();
    const call = (sendCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      params: Record<string, unknown>;
    };
    expect(call.params).toMatchObject({ count: 1, how: "random" });
  });

  it("cards card delete distinguishes the dry run from the real removal", async () => {
    const dry = await runCommand(
      ["cards", "card", "delete", "--cards-id", "hand-1", "--card-id", "card-ace", "--dry-run"],
      respond({ cardsId: "hand-1", id: "card-ace", deleted: false, dryRun: true })
    );
    expect(dry.stdout).toContain("[dry-run] would delete card card-ace from card stack hand-1");
    const real = await runCommand(
      ["cards", "card", "delete", "--cards-id", "hand-1", "--card-id", "card-ace"],
      respond({ cardsId: "hand-1", id: "card-ace", deleted: true })
    );
    expect(real.stdout).toContain("Deleted card card-ace from card stack hand-1");
  });
});
