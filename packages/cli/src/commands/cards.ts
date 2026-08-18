import { CARDS_DRAW_MODES, CARDS_PASS_MAX_IDS } from "@fvtt-world-cli/protocol";
import { Option } from "commander";

import { executeRemoteCommand } from "../exec.js";
import { parseIdList, parsePositiveInt } from "../parse.js";
import {
  type CardFieldOptions,
  type CardsFieldOptions,
  createCardCloneParams,
  createCardCreateParams,
  createCardsCloneParams,
  createCardsCreateParams,
  createCardsUpdateParams,
  createCardUpdateParams
} from "../params.js";
import { addCardFieldOptions, addCardsFieldOptions } from "./field-options.js";
import {
  type RegistrationContext,
  createSharedRegistrars,
  addIdempotencyKeyOption,
  addNameFilterOption,
  addPaginationOptions,
  nameFilterParams,
  paginationParams
} from "./shared.js";
import { write } from "../deps.js";

export function registerCards({ program, dependencies }: RegistrationContext) {
  const { registerOwnershipSet, registerCompendiumImport } = createSharedRegistrars(dependencies);
  const cards = program.command("cards").description("Foundry card stack (Cards) commands");
  cards.addHelpText(
    "after",
    "\nResult key (--json): .result.cards (a SINGLE stack on get/create/update/clone) /" +
      " .result.cards[] (list, get-many). The stack's own card rows are .result.cards.cards[]." +
      "\n`cards delete` is NOT a plain delete: Foundry's Cards#_preDelete RECALLS the stack first, so" +
      " it mutates OTHER stacks — a DECK pulls its cards back out of every other stack (deleting them" +
      " there, and since the deck goes too they cease to exist), a HAND/PILE pushes its cards back to" +
      " their origin decks. Read .result.recall for every affected stack and card id; `--dry-run`" +
      " reports the same enumeration without writing." +
      "\nTwo recall fates have no repair, and BOTH end in a destroyed card on a delete: a card whose" +
      " origin is missing or dangling is SKIPPED — the recall leaves it in the stack, so the delete" +
      " destroys it with the stack (every inline-authored hand/pile card has origin=null, so this is" +
      " the ordinary case, and it is also why such a stack can never be emptied by a recall alone) —" +
      " and a card whose origin still exists but no longer holds it is DELETED with nothing returned" +
      " anywhere." +
      "\nThere is no `--no-chat` on `cards delete`: the recall posts exactly ONE chat notification per" +
      " deleted stack — even an empty one — and the delete path cannot pass Foundry's suppression" +
      " option. Its audience follows the GM client's own chat-sidebar setting, which the bridge cannot" +
      " override or report." +
      "\n`--type` is CREATE-ONLY and required: a stack's kind cannot be changed in place (Foundry" +
      " throws), so change it by create + move + delete." +
      "\n`cards update` is fields-only — embedded card writes go through `cards card` (chunk 4.3)." +
      "\n`cards clone` re-mints every copied card's id and clears its `drawn` flag while KEEPING its" +
      " `origin`, so a cloned hand's cards can never be returned to their origin deck: read" +
      " .result.cardsCopy." +
      "\n`cards create` takes no PRESET: Foundry's CONFIG.Cards.presets (the poker decks its" +
      " create-dialog offers) are a UI affordance the bridge does not expose — seed a deck with" +
      " `--cards-json` or `cards card create`."
  );
  registerOwnershipSet(cards, {
    idFlag: "--cards-id <cardsId>",
    idKey: "cardsId",
    commandName: "cards.ownership.set",
    noun: "cards"
  });
  addNameFilterOption(addPaginationOptions(cards.command("list"))).action(async function listCards(options: {
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "cards.list",
      params: { ...nameFilterParams(options), ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  cards
    .command("get")
    .requiredOption("--cards-id <cardsId>", "Card stack id")
    .action(async function getCards(options: { cardsId: string }) {
      await executeRemoteCommand({
        commandName: "cards.get",
        params: { cardsId: options.cardsId },
        command: this,
        dependencies
      });
    });
  cards
    .command("get-many")
    .requiredOption("--ids <list>", "Comma-separated card stack ids (atomic: all must exist)", parseIdList)
    .action(async function getManyCards(options: { ids: string[] }) {
      await executeRemoteCommand({
        commandName: "cards.get-many",
        params: { ids: options.ids },
        command: this,
        dependencies
      });
    });
  addCardsFieldOptions(
    addIdempotencyKeyOption(cards.command("create"))
      .requiredOption("--name <name>", "Card stack name")
      .addOption(
        new Option("--type <type>", "Stack kind (CREATE-ONLY — it cannot be changed later)")
          .choices(["deck", "hand", "pile"])
          .makeOptionMandatory()
      ),
    "create"
  )
    .option(
      "--cards-json <json>",
      'Inline cards as a JSON array; each entry REQUIRES `name`, e.g. [{"name":"Ace of Spades","suit":"S","value":1}]. Supplied card ids are NOT kept (Foundry re-mints them). `drawn`/`origin` are NOT accepted at all — the closed card schema rejects them, because card movement state belongs to the action verbs (a real create would also have forced `drawn:false`).'
    )
    .option("--data-json <json>", "Extra stack fields (e.g. flags) as a JSON object (merged last)")
    .action(async function createCardsCommand(
      options: CardsFieldOptions & { name: string; type: string; cardsJson?: string; dataJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "cards.create",
        params: createCardsCreateParams(options),
        command: this,
        dependencies
      });
    });
  addCardsFieldOptions(
    cards
      .command("update")
      .requiredOption("--cards-id <cardsId>", "Card stack id")
      .option("--name <name>", "New stack name"),
    "update"
  )
    .option("--patch-json <json>", "Extra stack patch fields (e.g. flags) as a JSON object (merged last)")
    .action(async function updateCardsCommand(
      options: CardsFieldOptions & { cardsId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "cards.update",
        params: createCardsUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addCardsFieldOptions(
    addIdempotencyKeyOption(cards.command("clone"))
      .description(
        "Copy a card stack. The copied CARDS get NEW ids and arrive drawn=false while keeping their `origin`, so a cloned hand's cards can never be returned to their origin deck — see .result.cardsCopy."
      )
      .requiredOption("--cards-id <cardsId>", "Source card stack id")
      .option("--name <name>", "Name override for the clone"),
    "clone"
  )
    .option("--patch-json <json>", "Override fields for the clone as a JSON object (merged last)")
    .action(async function cloneCardsCommand(
      options: CardsFieldOptions & { cardsId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "cards.clone",
        params: createCardsCloneParams(options),
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(cards.command("delete"))
    .description(
      "Delete a card stack. Foundry RECALLS it first (Cards#_preDelete), so this also mutates OTHER stacks and posts one unsuppressible chat notification — run with --dry-run to see the full affected set."
    )
    .requiredOption("--cards-id <cardsId>", "Card stack id")
    .action(async function deleteCards(options: { cardsId: string }) {
      await executeRemoteCommand({
        commandName: "cards.delete",
        params: { cardsId: options.cardsId },
        command: this,
        dependencies
      });
    });

  const cardsActionHelp =
    "\nEvery action verb returns four markers: `complete`, `mutation` (committed/partial/unknown/" +
    "not-executed), `reconciliation` (confirmed/best-effort/not-executed) and `chatNotification`." +
    " They answer different questions — what landed, how much weight the post-call read carries, and" +
    " whether Foundry reached its notification call." +
    "\nA verb that RESOLVED with its writes missing is an ERROR, never an ok:true body: Foundry drops" +
    " a refused row of a batch silently and resolves, and a hook veto returns before any write at all." +
    " MISSING is the predicate, not merely unconfirmed: a row Foundry would have written as an empty" +
    " diff was owed no change, so `cards reset` reports that cell as ok:true with" +
    " recall.status=unconfirmed rather than as a failure." +
    " A verb that REJECTED returns the partial-commit envelope (ok:true, complete:false, `failure`)," +
    " which is cached under the idempotency key so a retry cannot move MORE cards." +
    "\n--idempotency-key is REQUIRED on deal/draw/pass (a retry moves another batch) and optional on" +
    " shuffle/reset. It is required UNCONDITIONALLY, so a --dry-run needs one too (the daemon skips" +
    " both the cache lookup and the store for a dry run, so a preview key never collides with its" +
    " commit)." +
    "\nThere is no --roll-mode anywhere on `cards`: Foundry's notification takes no options and its" +
    " audience follows the GM client's own chat-sidebar setting. --no-chat is the only deterministic" +
    " choice, and it is the repeat-safe path for `cards reset` (which is state-idempotent but re-posts" +
    " its notification).";
  cards.addHelpText("after", cardsActionHelp);

  addIdempotencyKeyOption(cards.command("shuffle"))
    .description("Randomize the sort order of every card in a stack (Foundry's Cards#shuffle).")
    .requiredOption("--cards-id <cardsId>", "Card stack id")
    .option("--no-chat", "Suppress Foundry's chat notification")
    .action(async function shuffleCards(options: {
      cardsId: string;
      chat?: boolean;
      idempotencyKey?: string;
    }) {
      await executeRemoteCommand({
        commandName: "cards.shuffle",
        params: {
          cardsId: options.cardsId,
          ...(options.chat === false ? { chat: false } : {}),
          ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {})
        },
        command: this,
        dependencies
      });
    });

  addIdempotencyKeyOption(cards.command("reset"))
    .description(
      "Recall a stack (Foundry's Cards#recall). A DECK pulls its cards back out of EVERY other stack; a HAND/PILE pushes its cards back to their origin decks. Run with --dry-run to see every affected stack first."
    )
    .requiredOption("--cards-id <cardsId>", "Card stack id")
    .option("--no-chat", "Suppress Foundry's chat notification")
    .action(async function resetCards(options: { cardsId: string; chat?: boolean; idempotencyKey?: string }) {
      await executeRemoteCommand({
        commandName: "cards.reset",
        params: {
          cardsId: options.cardsId,
          ...(options.chat === false ? { chat: false } : {}),
          ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {})
        },
        command: this,
        dependencies
      });
    });

  cards
    .command("deal")
    .description(
      "Deal cards FROM --cards-id TO each --to stack (each receives --count). Requires --idempotency-key: a retry deals ANOTHER batch." +
        " NEVER use this to give dealt cards BACK: `deal` has no return-to-origin branch, so dealing a card into a stack that already holds its id" +
        " DESTROYS it (Foundry rejects the destination's create while the source-side delete in the same batch lands) — use `cards pass --card-ids`" +
        " or `cards draw` from the origin stack instead. An UNAVOIDABLE collision is refused with INVALID_PARAMS; an avoidable one is left to Foundry."
    )
    .requiredOption("--cards-id <cardsId>", "SOURCE card stack id (the stack dealt FROM)")
    .requiredOption(
      "--idempotency-key <key>",
      "REQUIRED: client-supplied key so a retried move returns the original result instead of moving ANOTHER batch of cards. Reuse the SAME key across retries of one move."
    )
    .requiredOption("--to <list>", "Comma-separated DESTINATION card stack ids", parseIdList)
    .addOption(
      new Option("--count <count>", "Cards per destination (integer >= 1)").argParser(parsePositiveInt)
    )
    .addOption(
      new Option(
        "--how <how>",
        "Which cards to take: top (Foundry's FIRST/TOP=0), bottom (LAST/BOTTOM=1) or random (2)"
      ).choices([...CARDS_DRAW_MODES])
    )
    .option("--no-chat", "Suppress Foundry's chat notification")
    .action(async function dealCards(options: {
      cardsId: string;
      to: string[];
      count?: number;
      how?: string;
      chat?: boolean;
      idempotencyKey?: string;
    }) {
      await executeRemoteCommand({
        commandName: "cards.deal",
        params: {
          cardsId: options.cardsId,
          to: options.to,
          ...(options.count !== undefined ? { count: options.count } : {}),
          ...(options.how !== undefined ? { how: options.how } : {}),
          ...(options.chat === false ? { chat: false } : {}),
          ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {})
        },
        command: this,
        dependencies
      });
    });

  cards
    .command("draw")
    .description(
      "Draw cards INTO --cards-id FROM --from. NOTE THE INVERSION: here --cards-id is the DESTINATION. Requires --idempotency-key."
    )
    .requiredOption("--cards-id <cardsId>", "DESTINATION card stack id (the stack drawn INTO)")
    .requiredOption(
      "--idempotency-key <key>",
      "REQUIRED: client-supplied key so a retried move returns the original result instead of moving ANOTHER batch of cards. Reuse the SAME key across retries of one move."
    )
    .requiredOption("--from <from>", "SOURCE card stack id (the stack drawn FROM)")
    .addOption(new Option("--count <count>", "Cards to draw (integer >= 1)").argParser(parsePositiveInt))
    .addOption(
      new Option(
        "--how <how>",
        "Which cards to take: top (Foundry's FIRST/TOP=0), bottom (LAST/BOTTOM=1) or random (2)"
      ).choices([...CARDS_DRAW_MODES])
    )
    .option("--no-chat", "Suppress Foundry's chat notification")
    .action(async function drawCards(options: {
      cardsId: string;
      from: string;
      count?: number;
      how?: string;
      chat?: boolean;
      idempotencyKey?: string;
    }) {
      await executeRemoteCommand({
        commandName: "cards.draw",
        params: {
          cardsId: options.cardsId,
          from: options.from,
          ...(options.count !== undefined ? { count: options.count } : {}),
          ...(options.how !== undefined ? { how: options.how } : {}),
          ...(options.chat === false ? { chat: false } : {}),
          ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {})
        },
        command: this,
        dependencies
      });
    });

  cards
    .command("pass")
    .description(
      "Pass NAMED cards FROM --cards-id TO --to. No --how (you name the cards) and no availability check. Requires --idempotency-key."
    )
    .requiredOption("--cards-id <cardsId>", "SOURCE card stack id (the stack passed FROM)")
    .requiredOption(
      "--idempotency-key <key>",
      "REQUIRED: client-supplied key so a retried move returns the original result instead of moving ANOTHER batch of cards. Reuse the SAME key across retries of one move."
    )
    .requiredOption("--to <to>", "DESTINATION card stack id")
    .requiredOption(
      "--card-ids <list>",
      `Comma-separated card ids to pass (maximum ${CARDS_PASS_MAX_IDS})`,
      parseIdList
    )
    .option("--no-chat", "Suppress Foundry's chat notification")
    .action(async function passCards(options: {
      cardsId: string;
      to: string;
      cardIds: string[];
      chat?: boolean;
      idempotencyKey?: string;
    }) {
      await executeRemoteCommand({
        commandName: "cards.pass",
        params: {
          cardsId: options.cardsId,
          to: options.to,
          cardIds: options.cardIds,
          ...(options.chat === false ? { chat: false } : {}),
          ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {})
        },
        command: this,
        dependencies
      });
    });

  const card = cards.command("card").description("Card (single card inside a stack) commands");
  card.addHelpText(
    "after",
    "\nResult key (--json): .result.card (a SINGLE card on get/create/update/clone) /" +
      " .result.cards[] (list — CARD rows, not stacks; `cards list` is the stack listing)." +
      "\nEvery verb takes the PAIR --cards-id + --card-id, and every list row carries its owning" +
      " cardsId, because a card id is NOT world-unique: a dealt card keeps its id in the destination" +
      " stack while the source deck still holds a row with the SAME id flagged drawn." +
      "\n`drawn` and `origin` are READ-ONLY: card movement is written only by `cards deal/draw/pass/" +
      "reset`, so a plain edit here can never desynchronize a stack from its origin decks." +
      "\n`--face` IS the flip mechanism (there is no flip verb): `--face 0` shows the first face," +
      " `--clear-face` shows the back. Foundry silently clamps -1 to face 0, so -1 is refused here." +
      "\nThere is no `--img`: a Card has no img FIELD at all (Foundry derives it from the shown face" +
      " or the back), so set the art with `--back-json`/`--faces-json`." +
      "\n`--back-json` MERGES into the existing back (untouched name/text/img survive) while" +
      " `--faces-json` REPLACES the whole faces array — a shorter array drops faces, and any entry" +
      " that omits `img` gets Foundry's joker default icon. A shorter array can also leave `face`" +
      " pointing past the end, which Foundry treats as showing the back (it is not an error)." +
      "\nA card's visibility is its STACK's ownership: a Card has no ownership field, so there is no" +
      " `cards card ownership set` and no ownership block in these results." +
      "\n`cards card clone` copies `drawn` and `origin` verbatim onto a NEW id, so cloning a card that" +
      " was dealt in from another stack produces a copy that stack does not hold — a later" +
      " `cards reset`/`cards delete` DELETES that copy and returns nothing anywhere. The result's" +
      " `recallDeletesCopy` boolean says whether that is REALLY true of the copy (a truthy `origin`" +
      " is not the test: a dangling origin, an origin that IS this stack, and a deck holding a" +
      " hand's card are all benign), and the CLI warning is printed from that flag."
  );
  addNameFilterOption(
    addPaginationOptions(
      card
        .command("list")
        // --cards-id is OPTIONAL: omit it to list cards across ALL stacks.
        .option("--cards-id <cardsId>", "Card stack id (omit to list across all card stacks)")
    )
  ).action(async function listCards2(options: {
    cardsId?: string;
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "cards.card.list",
      params: {
        ...(options.cardsId !== undefined ? { cardsId: options.cardsId } : {}),
        ...nameFilterParams(options),
        ...paginationParams(options)
      },
      command: this,
      dependencies
    });
  });
  card
    .command("get")
    .requiredOption("--cards-id <cardsId>", "Card stack id")
    .requiredOption("--card-id <cardId>", "Card id")
    .action(async function getCard(options: { cardsId: string; cardId: string }) {
      await executeRemoteCommand({
        commandName: "cards.card.get",
        params: { cardsId: options.cardsId, cardId: options.cardId },
        command: this,
        dependencies
      });
    });
  addCardFieldOptions(
    addIdempotencyKeyOption(card.command("create"))
      .requiredOption("--cards-id <cardsId>", "Card stack id")
      .requiredOption(
        "--name <name>",
        "Card name (the authored name; Foundry displays the shown face's name)"
      )
      .option("--type <type>", "Card document subtype (default `base`; a system/module may register others)"),
    "create"
  )
    .option("--data-json <json>", "Extra card fields (e.g. flags) as a JSON object (merged last)")
    .action(async function createCardCommand(
      options: CardFieldOptions & { cardsId: string; name: string; type?: string; dataJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "cards.card.create",
        params: createCardCreateParams(options),
        command: this,
        dependencies
      });
    });
  addCardFieldOptions(
    card
      .command("update")
      .requiredOption("--cards-id <cardsId>", "Card stack id")
      .requiredOption("--card-id <cardId>", "Card id")
      .option("--name <name>", "New card name"),
    "update"
  )
    .option("--patch-json <json>", "Extra card patch fields (e.g. flags) as a JSON object (merged last)")
    .action(async function updateCardCommand(
      options: CardFieldOptions & { cardsId: string; cardId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "cards.card.update",
        params: createCardUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addCardFieldOptions(
    addIdempotencyKeyOption(card.command("clone"))
      .description(
        "Copy a card inside its stack. The copy gets a NEW id but keeps `drawn` and `origin` verbatim, so a copy of a card dealt in from a deck can never be returned to that deck."
      )
      .requiredOption("--cards-id <cardsId>", "Card stack id")
      .requiredOption("--card-id <cardId>", "Source card id")
      .option("--name <name>", "Name override for the copy"),
    "clone"
  )
    .option("--patch-json <json>", "Override fields for the copy as a JSON object (merged last)")
    .action(async function cloneCardCommand(
      options: CardFieldOptions & { cardsId: string; cardId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "cards.card.clone",
        params: createCardCloneParams(options),
        command: this,
        dependencies
      });
    });
  card
    .command("delete")
    .requiredOption("--cards-id <cardsId>", "Card stack id")
    .requiredOption("--card-id <cardId>", "Card id")
    .action(async function deleteCard2(options: { cardsId: string; cardId: string }) {
      await executeRemoteCommand({
        commandName: "cards.card.delete",
        params: { cardsId: options.cardsId, cardId: options.cardId },
        command: this,
        dependencies
      });
    });

  registerCompendiumImport(cards, {
    commandName: "cards.import-from-compendium",
    noun: "card stack",
    packExample: "mymodule.decks"
  });
}
