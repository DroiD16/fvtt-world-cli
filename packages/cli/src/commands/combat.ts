import { join } from "node:path";

import { COMBAT_ROLL_MODES } from "@fvtt-world-cli/protocol";
import { Option } from "commander";

import { executeRemoteCommand } from "../exec.js";
import { parseIdList, parseNumber } from "../parse.js";
import {
  type CombatantFieldOptions,
  type CombatantGroupFieldOptions,
  type CombatFieldOptions,
  createCombatantCreateParams,
  createCombatantGroupCreateParams,
  createCombatantGroupUpdateParams,
  createCombatantUpdateParams,
  createCombatCreateParams,
  createCombatUpdateParams
} from "../params.js";
import {
  addCombatantFieldOptions,
  addCombatantGroupFieldOptions,
  addCombatFieldOptions
} from "./field-options.js";
import {
  type RegistrationContext,
  addIdempotencyKeyOption,
  addPaginationOptions,
  paginationParams
} from "./shared.js";
import { write } from "../deps.js";

export function registerCombat({ program, dependencies }: RegistrationContext) {
  const combat = program.command("combat").description("Foundry combat (encounter) commands");
  combat.addHelpText(
    "after",
    "\nResult key (--json): .result.combat / .result.combats[] (list); `combat delete` returns" +
      " .result.id/.result.deleted plus .result.otherActiveCombatIdsBefore/" +
      '.otherActiveCombatIdsAfter (both EXCLUDE the combat being deleted — they answer "what ELSE' +
      ' was/is active") and .activatedCombatIds.' +
      "\nThat activation report is a LOWER BOUND, not a settled answer (.result.activationObservation" +
      ' = "not-observable-at-return-time"): Foundry dispatches its post-delete activation without' +
      " awaiting it, so an empty .activatedCombatIds does NOT mean nothing was activated — re-read" +
      " `combat list` for the settled state." +
      "\n`combat update --scene` refuses a WELL-FORMED scene id that some combatant does not sit on" +
      " (COMBAT_SCENE_MISMATCH); an id still MALFORMED after Foundry's own field cleaning (which" +
      " trims surrounding whitespace) is Foundry's validation error instead (INVALID_PARAMS)." +
      "\nThe turn ORDER is Foundry's own (.result.combat.turns[], sorted by the game system —" +
      " dnd5e overrides the comparator — so never re-sort it by initiative)." +
      "\nCRUD cannot change `active`/`round`/`turn` or the combatant/group collections: activation" +
      " and turn/round transitions are separate verbs, and combatants are added with" +
      " `combat combatant create`. There is no `combat clone`, no `combat get-many` and no" +
      " `combat ownership set` (a Combat has no ownership field)." +
      "\n`--name` is v14-ONLY: on a v13 core the Combat document has no `name` field at all and the" +
      " bridge rejects the flag (INVALID_PARAMS) rather than let Foundry drop it silently."
  );
  addPaginationOptions(combat.command("list")).action(async function listCombats(options: {
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "combat.list",
      params: { ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  combat
    .command("get")
    .requiredOption("--combat-id <combatId>", "Combat id")
    .action(async function getCombat(options: { combatId: string }) {
      await executeRemoteCommand({
        commandName: "combat.get",
        params: { combatId: options.combatId },
        command: this,
        dependencies
      });
    });
  addCombatFieldOptions(
    addIdempotencyKeyOption(combat.command("create"))
      .option("--name <name>", "Combat name (v14 only — rejected on v13, where Combat has no name field)")
      .option(
        "--type <type>",
        "Combat document subtype (default `base`; a system/module may register others)"
      ),
    "create"
  )
    .option("--data-json <json>", "Extra combat fields (e.g. flags) as a JSON object (merged last)")
    .action(async function createCombatCommand(
      options: CombatFieldOptions & { type?: string; dataJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "combat.create",
        params: createCombatCreateParams(options),
        command: this,
        dependencies
      });
    });
  addCombatFieldOptions(
    combat
      .command("update")
      .requiredOption("--combat-id <combatId>", "Combat id")
      .option("--name <name>", "New combat name (v14 only — rejected on v13)"),
    "update"
  )
    .option("--patch-json <json>", "Extra combat patch fields (e.g. flags) as a JSON object (merged last)")
    .action(async function updateCombatCommand(
      options: CombatFieldOptions & { combatId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "combat.update",
        params: createCombatUpdateParams(options),
        command: this,
        dependencies
      });
    });
  combat
    .command("delete")
    .requiredOption("--combat-id <combatId>", "Combat id")
    .action(async function deleteCombat(options: { combatId: string }) {
      await executeRemoteCommand({
        commandName: "combat.delete",
        params: { combatId: options.combatId },
        command: this,
        dependencies
      });
    });

  combat.addHelpText(
    "after",
    "\nACTION verbs: `start`, `activate`, `next-turn`, `previous-turn`, `next-round`," +
      " `previous-round`, `reset-initiative`, `roll-initiative`, `set-initiative`. All of them are" +
      " serialized against other bridge COMBAT commands (one global queue) — never against the" +
      " Foundry UI or other modules." +
      "\nSIDE EFFECTS THE BRIDGE CANNOT SUPPRESS OR REPORT, on every turn/round move: Foundry runs" +
      " its turn-event cascade WITHOUT awaiting it, so REGION BEHAVIORS containing a combatant's" +
      " token auto-fire AFTER the command has already answered — including `executeScript` and" +
      " `executeMacro`, i.e. GM-authored JavaScript. World time also advances (6s per round in both" +
      " dnd5e test worlds, 0s per turn), `combatRound`/`combatTurn` hooks fire, ActiveEffect" +
      " durations are processed, and token movement history is cleared (ALL combatants' tokens on" +
      " v14, one on v13). `combat start` and `roll-initiative` additionally trigger the game" +
      " system's own writes (dnd5e recovers per-encounter item uses)." +
      "\nThere is no `combat end`: Foundry's endCombat opens a modal dialog on both cores — use" +
      " `combat delete`."
  );
  addIdempotencyKeyOption(combat.command("start"))
    .description("Begin the encounter: round 0 -> round 1, turn 0 (Foundry's Combat#startCombat)")
    .requiredOption("--combat-id <combatId>", "Combat id")
    .action(async function startCombatCommand(options: { combatId: string }) {
      await executeRemoteCommand({
        commandName: "combat.start",
        params: { combatId: options.combatId },
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(combat.command("activate"))
    .description(
      "Make this the world's active encounter (Foundry's Combat#activate). Activation is WORLD-wide: Foundry's server deactivates EVERY other active encounter in the same operation, with no scene filter. A --dry-run PREDICTS which ones (`deactivatedCombatIds`) rather than reporting none"
    )
    .requiredOption("--combat-id <combatId>", "Combat id")
    .action(async function activateCombatCommand(options: { combatId: string }) {
      await executeRemoteCommand({
        commandName: "combat.activate",
        params: { combatId: options.combatId },
        command: this,
        dependencies
      });
    });

  const combatAdvanceVerbs: Array<{ name: string; command: string; description: string }> = [
    {
      name: "next-turn",
      command: "combat.next-turn",
      description:
        "Advance to the next combatant's turn (Foundry delegates to a ROUND advance at the end of the order)"
    },
    {
      name: "previous-turn",
      command: "combat.previous-turn",
      description:
        "Rewind to the previous combatant's turn (from turn 0 Foundry rewinds the ROUND, which at round 1 UN-STARTS the encounter)"
    },
    { name: "next-round", command: "combat.next-round", description: "Advance to the next round" },
    {
      name: "previous-round",
      command: "combat.previous-round",
      description: "Rewind to the previous round (from round 1 this UN-STARTS the encounter)"
    }
  ];
  for (const verb of combatAdvanceVerbs) {
    combat
      .command(verb.name)
      .description(verb.description)
      .requiredOption("--combat-id <combatId>", "Combat id")
      .requiredOption(
        "--idempotency-key <key>",
        "REQUIRED: client-supplied key so a retried advance returns the original result instead of moving the encounter again. Reuse the SAME key across retries of one advance."
      )
      .addOption(
        new Option(
          "--expected-round <round>",
          "Compare-and-set: refuse (PRECONDITION_FAILED) unless the STORED round is this value"
        ).argParser(parseNumber)
      )
      .addOption(
        new Option(
          "--expected-turn <turn>",
          "Compare-and-set: refuse unless the STORED turn is this value"
        ).argParser(parseNumber)
      )
      .addOption(
        new Option(
          "--expected-turn-none",
          "Compare-and-set: refuse unless the STORED turn is null"
        ).conflicts("expectedTurn")
      )
      .action(async function advanceCombatCommand(options: {
        combatId: string;
        expectedRound?: number;
        expectedTurn?: number;
        expectedTurnNone?: boolean;
      }) {
        await executeRemoteCommand({
          commandName: verb.command,
          params: {
            combatId: options.combatId,
            ...(options.expectedRound !== undefined ? { expectedRound: options.expectedRound } : {}),

            ...(options.expectedTurnNone
              ? { expectedTurn: null }
              : options.expectedTurn !== undefined
                ? { expectedTurn: options.expectedTurn }
                : {})
          },
          command: this,
          dependencies
        });
      });
  }

  addIdempotencyKeyOption(combat.command("reset-initiative"))
    .description("Clear initiative on every combatant of the encounter (Foundry's Combat#resetAll)")
    .requiredOption("--combat-id <combatId>", "Combat id")
    .action(async function resetCombatInitiativeCommand(options: { combatId: string }) {
      await executeRemoteCommand({
        commandName: "combat.reset-initiative",
        params: { combatId: options.combatId },
        command: this,
        dependencies
      });
    });
  combat
    .command("roll-initiative")
    .description("Roll initiative through Foundry's own Combat#rollInitiative / rollAll / rollNPC")
    .requiredOption("--combat-id <combatId>", "Combat id")
    .requiredOption(
      "--idempotency-key <key>",
      "REQUIRED: client-supplied key so a retried roll returns the original result instead of re-rolling and posting more chat. Reuse the SAME key across retries of one roll."
    )
    .addOption(
      new Option(
        "--combatant-ids <ids>",
        "Comma-separated combatant ids to roll (exact: an unknown or unowned id is REFUSED, because Foundry would silently skip it; a REPEATED id is refused too, because Foundry rolls and announces once per entry while the row stores one initiative)"
      ).argParser(parseIdList)
    )
    .addOption(
      new Option("--all", "Roll every combatant that has no initiative yet (Combat#rollAll)").conflicts([
        "combatantIds",
        "npc"
      ])
    )
    .addOption(
      new Option("--npc", "Roll every NPC combatant that has no initiative yet (Combat#rollNPC)").conflicts([
        "combatantIds"
      ])
    )
    .option(
      "--formula <formula>",
      "Initiative formula override, evaluated by Foundry's own dice parser. THE GAME SYSTEM MAY IGNORE IT: core honours it, but dnd5e drops it for any combatant that HAS an actor (the normal case) and rolls that actor's own initiative instead. `rolled[].initiative` is read from stored state, so check it against the formula you asked for."
    )
    .addOption(
      new Option(
        "--roll-mode <mode>",
        "Chat visibility of the initiative messages (translated per Foundry version; default public). An EXPLICIT mode OVERRIDES Foundry's hidden-combatant privacy default, so `--roll-mode public` PUBLICLY reveals a hidden combatant's initiative."
      ).choices([...COMBAT_ROLL_MODES])
    )
    .action(async function rollCombatInitiativeCommand(options: {
      combatId: string;
      combatantIds?: string[];
      all?: boolean;
      npc?: boolean;
      formula?: string;
      rollMode?: string;
    }) {
      await executeRemoteCommand({
        commandName: "combat.roll-initiative",
        params: {
          combatId: options.combatId,
          ...(options.combatantIds ? { combatantIds: options.combatantIds } : {}),
          ...(options.all ? { select: "all" } : {}),
          ...(options.npc ? { select: "npc" } : {}),
          ...(options.formula !== undefined ? { formula: options.formula } : {}),
          ...(options.rollMode !== undefined ? { rollMode: options.rollMode } : {})
        },
        command: this,
        dependencies
      });
    })
    // The chat half stated where an operator looks for it. Without this, the only place the
    // no-suppression fact lived was a source comment and docs/commands.md, so somebody reading
    // `--help` (and finding no `--no-chat`, which `table draw` does have) could not tell whether chat
    // is suppressible or why the response carries a `chatMessages` block at all.
    .addHelpText(
      "after",
      "\nCHAT: Foundry ALWAYS posts one message per rolled combatant and exposes NO suppression" +
        " option on either supported core, so there is deliberately no `--no-chat` here (unlike" +
        " `table draw`) and the partial-commit window — initiative stored, chat missing — is" +
        " unavoidable. The response reports both halves separately, and every id in" +
        " `.result.chatMessages.ids` carries this call's unique correlation flag, so it is provably" +
        " this roll's: `chat delete` those ids to clean up." +
        "\nCONFIRMATION: `--combatant-ids` is the only mode that can name a row. A row that had NO" +
        " initiative and still has none is a provably dropped write" +
        " (`.result.unconfirmedCombatantIds`); a RE-roll of a row that already had one, a row that" +
        " held one and now stores NONE, or a row deleted inside the call, cannot be confirmed either" +
        " way and is reported in `.result.unconfirmableCombatantIds` with `.result.mutation:" +
        ' "unknown"` — reset initiative first if you need a provable roll. Every' +
        " `.result.rolled[].initiative` is a NUMBER: a row whose stored value moved to null is not a" +
        " roll (a roll total never is), so it is left out of `rolled` rather than listed with a null."
    );
  addIdempotencyKeyOption(combat.command("set-initiative"))
    .description("Set one combatant's initiative (deterministic, no chat, convergent)")
    .requiredOption("--combat-id <combatId>", "Combat id")
    .requiredOption("--combatant-id <combatantId>", "Combatant id")
    .addOption(
      new Option("--initiative <initiative>", "Initiative value")
        .argParser(parseNumber)
        .conflicts("clearInitiative")
    )
    .addOption(new Option("--clear-initiative", "Set initiative to null (clear it)").conflicts("initiative"))
    .action(async function setCombatantInitiativeCommand(options: {
      combatId: string;
      combatantId: string;
      initiative?: number;
      clearInitiative?: boolean;
    }) {
      await executeRemoteCommand({
        commandName: "combat.set-initiative",
        params: {
          combatId: options.combatId,
          combatantId: options.combatantId,
          ...(options.clearInitiative
            ? { initiative: null }
            : options.initiative !== undefined
              ? { initiative: options.initiative }
              : {})
        },
        command: this,
        dependencies
      });
    });

  const combatant = combat.command("combatant").description("Combatant (encounter participant) commands");
  combatant.addHelpText(
    "after",
    "\nResult key (--json): .result.combatant / .result.combatants[] (list, in Foundry's own TURN" +
      " order — never re-sort it by initiative, the comparator belongs to the game system)." +
      "\nEvery WRITE also returns .result.combat (the parent encounter's summary, re-read after the" +
      " write) and .result.combatSceneUnlinked, because a combatant write is also a PARENT write:" +
      " it moves `combat.turn` on a STARTED encounter, and Foundry's server silently sets" +
      " `combat.scene` to null whenever ANY of that combat's combatants sits on a different scene" +
      " (confirmed live on v13 and v14) — so a write to a perfectly on-scene combatant can unlink" +
      " the encounter too, because the server checks the whole collection, not the row you wrote." +
      "\n`update` additionally returns .result.groupInitiativeChanges — the groups whose STORED" +
      " initiative CHANGED across the write, `[{groupId, initiativeBefore, initiativeAfter}]`, measured" +
      " before/after and empty when nothing moved. A game SYSTEM can propagate the written" +
      " combatant's initiative onto its group: dnd5e (both test worlds) does it on EVERY combatant" +
      " update, and because this patch never carries `initiative` the propagated value is undefined —" +
      " which a v13 core commits as null (v14 drops it, both measured on the real installs). So on" +
      " v13+dnd5e `--group <id>` CLEARS that group's initiative override, and since a group's" +
      " initiative OVERRIDES its members', the whole turn order moves. Restore it with `combat group" +
      " update --initiative <n>`." +
      "\nDuplicate combatants for the same token are ALLOWED — Foundry itself permits them (probed" +
      " live on both versions: no guard, no warning), and a creature acting twice per round is a" +
      " real table pattern. A double-add is visible in `combat get`." +
      "\nIds are BARE 16-character Foundry ids, never uuids (`--token-id abc…`, not `Token.abc…`)." +
      '\n`--name ""` is legal and MEANINGFUL: a blank stored name is how Foundry is told to display' +
      " the token's/actor's name. `--img \"\"` is rejected instead (it would silently clear the" +
      " image) — use `--clear-img`." +
      "\n`--initiative` exists on `create` only: initiative CHANGES belong to the dedicated" +
      " initiative verbs. Omitting it stores null, which is the state `roll-initiative`'s" +
      " roll-all/roll-npc modes select on." +
      "\n`--round-joined` is v14-ONLY (rejected on v13, where the field does not exist). On CREATE," +
      " and only on create, Foundry may replace what you send: v14's `Combatant#_preCreate` does" +
      " `if (this.parent?.started) this.updateSource({roundJoined: this.parent.round})` — so on a" +
      " STARTED encounter the stored value is the current round, and the response reports what was" +
      " stored. A `--dry-run` create previews that same overwrite (it applies the one deterministic" +
      " `_preCreate` adjustment a constructor never runs) rather than echoing what you sent. An UPDATE" +
      " stores exactly what you send (v14 has no update-path counterpart, and v13 has no `_preCreate`" +
      " at all)." +
      "\nSIDE EFFECTS FOUNDRY PERFORMS THAT NO RESPONSE FIELD REPORTS (core's own writes, dispatched" +
      " without an await, so they land AFTER the command has answered; read in v13.351 + v14.365, not" +
      " an exhaustive list — a system or module can add more):" +
      "\n  · `delete` of a TOKEN-LINKED combatant CLEARS that token's movement history (a Token" +
      " document write via Combat#_onExit -> TokenDocument#clearMovementHistory; skipped when the" +
      " token has no recorded movement). Removing a combatant to undo a double-add takes the" +
      " token's movement history with it." +
      "\n  · `delete` of the CURRENT combatant of a STARTED encounter can fire Foundry's turn" +
      " lifecycle — combatTurnChange, _onStartTurn/_onEndTurn, another movement-history clear, and" +
      " the TOKEN_TURN_START/TOKEN_TURN_END region events, which RUN GM-authored" +
      " executeScript/executeMacro RegionBehaviors. Deleting any other combatant skips it, and an" +
      " unstarted combat fires none of it." +
      "\n  · `create` on a STARTED encounter refreshes ActiveEffect durations for the added" +
      " combatant's ACTOR — v14 ONLY (absent on v13) — which can WRITE ActiveEffects on that actor:" +
      " `duration.expired: true` on a stock v14, or a delete where CONFIG.ActiveEffect.expiryAction" +
      ' is set to "delete".' +
      "\nThere is no `combat combatant clone` (a clone is a create with a copied payload)."
  );
  addPaginationOptions(
    combatant.command("list").requiredOption("--combat-id <combatId>", "Combat id")
  ).action(async function listCombatants(options: { combatId: string; limit?: number; offset?: number }) {
    await executeRemoteCommand({
      commandName: "combat.combatant.list",
      params: { combatId: options.combatId, ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  combatant
    .command("get")
    .requiredOption("--combat-id <combatId>", "Combat id")
    .requiredOption("--combatant-id <combatantId>", "Combatant id")
    .action(async function getCombatant(options: { combatId: string; combatantId: string }) {
      await executeRemoteCommand({
        commandName: "combat.combatant.get",
        params: { combatId: options.combatId, combatantId: options.combatantId },
        command: this,
        dependencies
      });
    });
  addCombatantFieldOptions(
    addIdempotencyKeyOption(combatant.command("create"))
      .requiredOption("--combat-id <combatId>", "Combat id")
      .option("--token-id <tokenId>", "Scene token id this combatant represents (bare 16-char id)")
      .option("--scene-id <sceneId>", "Scene id the token lives on (bare 16-char id)")
      .option("--actor-id <actorId>", "Actor id this combatant represents (bare 16-char id)")
      .option("--name <name>", 'Combatant name (blank means "display the token/actor name")')
      .option(
        "--type <type>",
        "Combatant document subtype (default `base`; a system/module may register others)"
      )
      .option("--img <img>", "Combatant image path (data-relative; blank is rejected, use --clear-img)")
      .addOption(
        new Option("--clear-img", "Explicitly set img to null (show the token texture)").conflicts("img")
      )
      .addOption(
        new Option("--initiative <initiative>", "Initiative value (omit to leave it unrolled)").argParser(
          parseNumber
        )
      ),
    "create"
  )
    .option("--data-json <json>", "Extra combatant fields (e.g. flags) as a JSON object (merged last)")
    .action(async function createCombatantCommand(
      options: CombatantFieldOptions & {
        combatId: string;
        type?: string;
        initiative?: number;
        dataJson?: string;
      }
    ) {
      await executeRemoteCommand({
        commandName: "combat.combatant.create",
        params: createCombatantCreateParams(options),
        command: this,
        dependencies
      });
    });
  addCombatantFieldOptions(
    combatant
      .command("update")
      .requiredOption("--combat-id <combatId>", "Combat id")
      .requiredOption("--combatant-id <combatantId>", "Combatant id")
      .option("--name <name>", 'New name (blank means "display the token/actor name")')
      .option("--img <img>", "New image path (blank is rejected, use --clear-img)")
      .addOption(new Option("--clear-img", "Explicitly set img to null").conflicts("img"))
      .option("--token-id <tokenId>", "New token id (bare 16-char id)")
      .addOption(new Option("--clear-token", "Explicitly set tokenId to null").conflicts("tokenId"))
      .option("--scene-id <sceneId>", "New scene id (bare 16-char id)")
      .addOption(new Option("--clear-scene", "Explicitly set sceneId to null").conflicts("sceneId"))
      .option("--actor-id <actorId>", "New actor id (bare 16-char id)")
      .addOption(new Option("--clear-actor", "Explicitly set actorId to null").conflicts("actorId")),
    "update"
  )
    .option("--patch-json <json>", "Extra combatant patch fields (e.g. flags) as a JSON object (merged last)")
    .action(async function updateCombatantCommand(
      options: CombatantFieldOptions & { combatId: string; combatantId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "combat.combatant.update",
        params: createCombatantUpdateParams(options),
        command: this,
        dependencies
      });
    });
  combatant
    .command("delete")
    .requiredOption("--combat-id <combatId>", "Combat id")
    .requiredOption("--combatant-id <combatantId>", "Combatant id")
    .action(async function deleteCombatant(options: { combatId: string; combatantId: string }) {
      await executeRemoteCommand({
        commandName: "combat.combatant.delete",
        params: { combatId: options.combatId, combatantId: options.combatantId },
        command: this,
        dependencies
      });
    });

  const combatGroup = combat.command("group").description("Combatant group commands");
  combatGroup.addHelpText(
    "after",
    "\nResult key (--json): .result.group / .result.groups[] (list)." +
      "\nCombatants JOIN or LEAVE a group with `combat combatant update --group <id>` /" +
      " `--clear-group`: membership is stored on the COMBATANT, so there is no membership verb here." +
      "\n`hidden`/`defeated` on a group are DERIVED from its members (Foundry seeds both true and" +
      " each member ANDs them down, so an EMPTY group reads true/true). A `create --dry-run` therefore" +
      " reports true/true — the would-be group has no members — and an `update --dry-run` reports the" +
      " LIVE group's pair, which is what the real update returns too (a group patch cannot change" +
      " either value: they derive from the members, and membership lives on the combatant). They read" +
      " `null` only where Foundry's data preparation did not run at all (a system's prepareData threw" +
      " and core swallowed it)." +
      "\nA group's `initiative` OVERRIDES each member's live initiative, which is why it stays" +
      " writable here while the combatant patch omits initiative entirely." +
      "\nTURN ORDER DOES NOT REFRESH ON A GROUP WRITE. Writing (or clearing, or deleting) a group's" +
      " initiative changes every member's LIVE initiative immediately, but Foundry rebuilds the turn" +
      " order for COMBATANT-collection changes and for a token rename while that token is in combat" +
      " (its descendant handlers return early for any other collection, and the prepared order is" +
      " re-sorted only when it is empty) — so" +
      " `combat get`'s turns[]/currentCombatantId and `combat combatant list`'s ordering keep" +
      " reporting the order from BEFORE this write until Foundry next rebuilds it (a combatant" +
      " create/update/delete does; a token rename while that token is in combat does; so does a" +
      " client reload — not an exhaustive list). Read on v13.351 and v14.365. The bridge deliberately does not call `setupTurns()` itself: that" +
      " mutates the encounter's in-memory round/turn, a write nobody asked for." +
      "\nA game system may also propagate a COMBATANT's initiative back onto its group — on v13+dnd5e" +
      " a `combat combatant update` CLEARS the group's initiative. That one IS reported, as" +
      " .result.groupInitiativeChanges on the combatant update." +
      "\n`ownership` is returned by `combat group get` only and is READ-ONLY: CombatantGroup is the" +
      " one combat document that carries the field, and there is no `combat group ownership set` verb" +
      " (a raw `ownership` key is rejected). A stored `-1` (INHERIT) is echoed as-is but INHERITS" +
      " NOTHING: the parent Combat has no `ownership` field and no parent of its own, so Foundry" +
      " resolves it to NONE — for every non-GM a group's `-1` behaves exactly like `0`. Do NOT read it" +
      " as 'visibility follows the encounter'. (A journal PAGE is the opposite case: its entry HAS the" +
      " field, so `-1` there really does inherit.) Measured on v13.351 and v14.365." +
      "\nDeleting a group clears NOTHING: its members keep a stored `group` id that no longer" +
      " resolves (they render ungrouped), and the delete result lists them as" +
      " .result.danglingCombatantIds." +
      "\nThere is no `combat group clone`."
  );
  addPaginationOptions(
    combatGroup.command("list").requiredOption("--combat-id <combatId>", "Combat id")
  ).action(async function listCombatantGroups(options: {
    combatId: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "combat.group.list",
      params: { combatId: options.combatId, ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  combatGroup
    .command("get")
    .requiredOption("--combat-id <combatId>", "Combat id")
    .requiredOption("--group-id <groupId>", "Combatant group id")
    .action(async function getCombatantGroup(options: { combatId: string; groupId: string }) {
      await executeRemoteCommand({
        commandName: "combat.group.get",
        params: { combatId: options.combatId, groupId: options.groupId },
        command: this,
        dependencies
      });
    });
  addCombatantGroupFieldOptions(
    addIdempotencyKeyOption(combatGroup.command("create"))
      .requiredOption("--combat-id <combatId>", "Combat id")
      .option("--name <name>", "Group name (may be blank)")
      .option("--type <type>", "CombatantGroup subtype (default `base`)"),
    "create"
  )
    .option("--data-json <json>", "Extra group fields (e.g. flags) as a JSON object (merged last)")
    .action(async function createCombatantGroupCommand(
      options: CombatantGroupFieldOptions & { combatId: string; type?: string; dataJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "combat.group.create",
        params: createCombatantGroupCreateParams(options),
        command: this,
        dependencies
      });
    });
  addCombatantGroupFieldOptions(
    combatGroup
      .command("update")
      .requiredOption("--combat-id <combatId>", "Combat id")
      .requiredOption("--group-id <groupId>", "Combatant group id")
      .option("--name <name>", "New group name"),
    "update"
  )
    .option("--patch-json <json>", "Extra group patch fields (e.g. flags) as a JSON object (merged last)")
    .action(async function updateCombatantGroupCommand(
      options: CombatantGroupFieldOptions & { combatId: string; groupId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "combat.group.update",
        params: createCombatantGroupUpdateParams(options),
        command: this,
        dependencies
      });
    });
  combatGroup
    .command("delete")
    .requiredOption("--combat-id <combatId>", "Combat id")
    .requiredOption("--group-id <groupId>", "Combatant group id")
    .action(async function deleteCombatantGroup(options: { combatId: string; groupId: string }) {
      await executeRemoteCommand({
        commandName: "combat.group.delete",
        params: { combatId: options.combatId, groupId: options.groupId },
        command: this,
        dependencies
      });
    });
}
