import { ERROR_CODES } from "../generated/protocol.js";
import {
  COMBAT_ADVANCE_METHODS,
  COMBAT_VETO_REMEDY,
  activateCombat,
  activeCombatIds,
  advanceCombat,
  assertCombatExpectedState,
  assertCombatLiveStateConverged,
  assertCombatMethodSupported,
  assertCombatReferenceIdsNotBlank,
  assertCombatSceneContainsCombatants,
  assertCombatStarted,
  assertCombatVersionFields,
  assertCombatantGroupReference,
  assertCombatantVersionFields,
  combatStoredSceneId,
  combatStoredState,
  combatTransition,
  combatantGroupInitiativeChanges,
  combatantGroupInitiativeSnapshot,
  combatantIdsInGroup,
  combatantInitiativeSnapshot,
  combatantStoredInitiative,
  createCombat,
  createCombatant,
  createCombatantGroup,
  deleteCombatant,
  deleteCombatantGroup,
  detachedCombatantRow,
  getCombatById,
  getCombatantById,
  getCombatantGroupById,
  prepareCombatantGroupPayload,
  prepareCombatantPayload,
  previewCombatCreate,
  previewCombatantCreate,
  previewCombatantGroupCreate,
  previewCombatantUpdate,
  resetCombatInitiative,
  resolveCombatInitiativeOptions,
  resolveCombatInitiativeTargets,
  rollCombatInitiative,
  setCombatantInitiative,
  startCombat,
  updateCombatant,
  updateCombatantGroup
} from "../lib/combat-docs.js";
import { getCombatsCollection } from "../lib/game-collections.js";
import { assertTableFamilyDeleteCommitted, assertTableFamilyUpdateCommitted } from "../lib/table-docs.js";
import { deleteDocument, previewDocumentUpdate } from "../lib/world-docs.js";
import { createBridgeError, toFailureSummary } from "../lib/errors.js";
import {
  deriveChatCaptureStatus,
  newBridgeCorrelationId,
  startCombatInitiativeChatCapture
} from "../lib/chat-capture.js";
import { createMutationQueue } from "../lib/mutation-queue.js";
import { startCombatUpdateWatch } from "../lib/write-watch.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import {
  cloneValue,
  combatOrderedCombatants,
  paginate,
  serializeCombat,
  serializeCombatSummary,
  serializeCombatant,
  serializeCombatantGroup,
  serializeCombatantGroupSummary,
  serializeCombatantTurn
} from "../lib/serializers.js";

const combatQueue = createMutationQueue();

const COMBATANT_REFERENCE_ID_FIELDS = Object.freeze(["actorId", "tokenId", "sceneId", "group"]);

const ACTIVATION_NOT_OBSERVABLE = "not-observable-at-return-time";

function rereadCombat(combatId, fallback) {
  try {
    return getCombatById(combatId);
  } catch {
    return fallback;
  }
}

/**
 * @param {any} combat
 * @returns {boolean}
 */
function combatStoredActive(combat) {
  const source = combat?._source;
  if (source && typeof source === "object" && Object.hasOwn(source, "active")) return Boolean(source.active);
  if (typeof combat?.toObject === "function") {
    const data = combat.toObject();
    if (data && Object.hasOwn(data, "active")) return Boolean(data.active);
  }
  return Boolean(combat?.active);
}

/**
 * @param {any} combat
 * @returns {number}
 */
function countCombatantsWithInitiative(combat) {
  return countInitiativeEntries(combatantInitiativeSnapshot(combat));
}

/**
 * @param {Map<string, number | null>} snapshot
 * @returns {number}
 */
function countInitiativeEntries(snapshot) {
  let count = 0;
  for (const initiative of snapshot.values()) if (initiative !== null) count += 1;
  return count;
}

/** @param {{combatId: string, verb: string, before: {round: number, turn: number | null}, after: {round: number, turn: number | null}}} args */
function assertCombatTransitionCommitted({ combatId, verb, before, after }) {
  if (combatTransition(before, after) !== "none") return;
  throw createBridgeError(
    ERROR_CODES.INTERNAL_ERROR,
    `${verb} did not change combat ${combatId}: it still stores round ${before.round} and turn ${
      before.turn ?? "null"
    } after Foundry resolved the transition without an error. Every transition write Foundry issues changes the round or the turn, so this means the update was refused — a module's preUpdateCombat hook or a core _preUpdate returning false, or the write failing Foundry's own client-side validation (which Foundry reports only as a UI notification). Two other causes fit the same observation: a concurrent move from the Foundry UI that put the encounter back (the bridge queue serializes bridge commands only), and a game system that overrides this Combat method. Re-read with combat.get. ${COMBAT_VETO_REMEDY}`,
    { combatId, round: before.round, turn: before.turn }
  );
}

/** @returns {Record<string, (params: any) => Promise<any>>} */
function createCombatAdvanceHandlers() {
  /** @type {Record<string, (params: any) => Promise<any>>} */
  const handlers = {};
  for (const verb of /** @type {Array<keyof typeof COMBAT_ADVANCE_METHODS>} */ (
    Object.keys(COMBAT_ADVANCE_METHODS)
  )) {
    handlers[verb] = async (params) =>
      combatQueue.run(async () => {
        const combat = getCombatById(params.combatId);
        const combatId = combat.id ?? params.combatId;

        assertCombatMethodSupported(combat, COMBAT_ADVANCE_METHODS[verb], verb);
        const before = combatStoredState(combat);
        assertCombatExpectedState(params, before, { combatId, verb });
        if (verb !== "combat.next-round") assertCombatStarted(before, { combatId, verb });

        assertCombatLiveStateConverged(combat, before, { combatId, verb });

        if (isDryRun(params)) {
          return dryRunResponse({
            combatId,
            transition: "none",
            roundBefore: before.round,
            turnBefore: before.turn,
            combat: serializeCombat(combat)
          });
        }

        await advanceCombat(combat, verb);
        const parent = rereadCombat(combatId, combat);
        const after = combatStoredState(parent);
        assertCombatTransitionCommitted({ combatId, verb, before, after });
        return {
          combatId,

          transition: combatTransition(before, after),
          roundBefore: before.round,
          turnBefore: before.turn,
          combat: serializeCombat(parent)
        };
      });
  }
  return handlers;
}

export function createCombatHandlers() {
  return {
    async "combat.list"(params) {
      const combats = Array.from(getCombatsCollection());
      const { page, total, hasMore } = paginate(combats, params);
      return {
        combats: page.map((combat) => serializeCombatSummary(combat)),
        total,
        hasMore
      };
    },

    async "combat.get"(params) {
      const combat = getCombatById(params.combatId);
      return {
        combat: serializeCombat(combat)
      };
    },

    async "combat.create"(params) {
      assertCombatVersionFields(params.data, { verb: "combat.create" });
      assertCombatReferenceIdsNotBlank(params.data, ["scene"], { verb: "combat.create" });
      const data = params.data ?? {};

      const preview = previewCombatCreate(cloneValue(data));
      if (isDryRun(params)) {
        return dryRunResponse({ combat: serializeCombat(preview) });
      }

      const combat = await createCombat(data);
      return {
        combat: serializeCombat(combat)
      };
    },

    async "combat.update"(params) {
      return combatQueue.run(async () => {
        const combat = getCombatById(params.combatId);
        const combatId = combat.id ?? params.combatId;
        const patch = params.patch;

        assertCombatVersionFields(patch, { verb: "combat.update" });
        assertCombatReferenceIdsNotBlank(patch, ["scene"], { combatId, verb: "combat.update" });
        assertCombatSceneContainsCombatants(combat, patch, { combatId });
        if (isDryRun(params)) {
          const preview = await previewDocumentUpdate(combat, cloneValue(patch));

          return dryRunResponse({ combat: serializeCombat(preview, { turnOrderFrom: combat }) });
        }

        let updated;
        try {
          updated = await combat.update(patch, { diff: true, render: true });
        } catch (error) {
          assertCombatSceneContainsCombatants(rereadCombat(combatId, combat), patch, { combatId });
          throw error;
        }
        if (!updated) {
          await assertTableFamilyUpdateCommitted({
            document: combat,
            patch,
            subject: `Combat ${combatId}`,
            hookName: "preUpdateCombat",
            details: { combatId },
            remedy: COMBAT_VETO_REMEDY
          });
        }
        return {
          combat: serializeCombat(rereadCombat(combatId, combat))
        };
      });
    },

    async "combat.delete"(params) {
      return combatQueue.run(async () => {
        const combat = getCombatById(params.combatId);
        const id = combat.id ?? params.combatId;

        const activeBefore = activeCombatIds(id);
        if (isDryRun(params)) {
          return dryRunResponse({
            id,
            deleted: false,
            otherActiveCombatIdsBefore: activeBefore,
            otherActiveCombatIdsAfter: activeBefore,
            activatedCombatIds: [],
            activationObservation: ACTIVATION_NOT_OBSERVABLE
          });
        }

        const deletedDocument = await deleteDocument(combat);
        assertTableFamilyDeleteCommitted({
          committed: Boolean(deletedDocument),
          subject: `Combat ${id}`,
          hookName: "preDeleteCombat",
          details: { combatId: id },
          remedy: COMBAT_VETO_REMEDY
        });
        const activeAfter = activeCombatIds(id);
        return {
          id,
          deleted: true,

          otherActiveCombatIdsBefore: activeBefore,

          otherActiveCombatIdsAfter: activeAfter,

          activatedCombatIds: activeAfter.filter((activeId) => !activeBefore.includes(activeId)),
          activationObservation: ACTIVATION_NOT_OBSERVABLE
        };
      });
    },

    async "combat.start"(params) {
      return combatQueue.run(async () => {
        const combat = getCombatById(params.combatId);
        const combatId = combat.id ?? params.combatId;

        assertCombatMethodSupported(combat, "startCombat", "combat.start");
        const before = combatStoredState(combat);

        const alreadyStarted = before.round > 0;
        if (isDryRun(params) || alreadyStarted) {
          const body = {
            combatId,
            started: alreadyStarted,
            alreadyStarted,
            transition: "none",
            roundBefore: before.round,
            turnBefore: before.turn,
            combat: serializeCombat(combat)
          };
          return isDryRun(params) ? dryRunResponse(body) : body;
        }

        await startCombat(combat);
        const parent = rereadCombat(combatId, combat);
        const after = combatStoredState(parent);
        assertCombatTransitionCommitted({ combatId, verb: "combat.start", before, after });

        if (!(after.round > 0)) {
          throw createBridgeError(
            ERROR_CODES.INTERNAL_ERROR,
            `Combat ${combatId} was NOT started: Foundry resolved startCombat() and stored turn ${
              after.turn ?? "null"
            }, but the encounter still stores round ${
              after.round
            } — startCombat() issues \`update({round:1, turn:0})\`, so a module's preUpdateCombat hook (or a core _preUpdate) rewrote the update rather than refusing it outright. Re-read with combat.get. ${COMBAT_VETO_REMEDY}`,
            { combatId, round: after.round, turn: after.turn }
          );
        }
        return {
          combatId,
          started: after.round > 0,

          alreadyStarted: false,
          transition: combatTransition(before, after),
          roundBefore: before.round,
          turnBefore: before.turn,
          combat: serializeCombat(parent)
        };
      });
    },

    async "combat.activate"(params) {
      return combatQueue.run(async () => {
        const combat = getCombatById(params.combatId);
        const combatId = combat.id ?? params.combatId;
        assertCombatMethodSupported(combat, "activate", "combat.activate");

        const activeBefore = activeCombatIds(combatId);
        const alreadyActive = combatStoredActive(combat);
        if (isDryRun(params)) {
          const wouldDeactivate = alreadyActive ? [] : activeBefore;
          return dryRunResponse({
            combatId,
            active: alreadyActive,
            alreadyActive,
            otherActiveCombatIdsBefore: activeBefore,
            otherActiveCombatIdsAfter: activeBefore.filter((id) => !wouldDeactivate.includes(id)),
            deactivatedCombatIds: wouldDeactivate,
            combat: serializeCombat(combat)
          });
        }

        const updated = await activateCombat(combat);
        if (!updated) {
          await assertTableFamilyUpdateCommitted({
            document: combat,
            patch: { active: true },
            subject: `Combat ${combatId}`,
            hookName: "preUpdateCombat",
            details: { combatId },
            remedy: COMBAT_VETO_REMEDY
          });
        }
        const parent = rereadCombat(combatId, combat);
        const activeAfter = activeCombatIds(combatId);

        if (!combatStoredActive(parent)) {
          throw createBridgeError(
            ERROR_CODES.INTERNAL_ERROR,
            `Combat ${combatId} is NOT active: Foundry resolved the activation without storing it, which means a module's preUpdateCombat hook or a core _preUpdate refused the write. ${COMBAT_VETO_REMEDY}`,
            { combatId }
          );
        }
        return {
          combatId,
          active: true,
          alreadyActive,
          otherActiveCombatIdsBefore: activeBefore,
          otherActiveCombatIdsAfter: activeAfter,

          deactivatedCombatIds: activeBefore.filter((id) => !activeAfter.includes(id)),
          combat: serializeCombat(parent)
        };
      });
    },

    ...createCombatAdvanceHandlers(),

    async "combat.reset-initiative"(params) {
      return combatQueue.run(async () => {
        const combat = getCombatById(params.combatId);
        const combatId = combat.id ?? params.combatId;
        assertCombatMethodSupported(combat, "resetAll", "combat.reset-initiative");
        if (isDryRun(params)) {
          const preview = serializeCombat(combat);
          return dryRunResponse({
            combatId,
            reset: false,
            changedCount: countCombatantsWithInitiative(combat),
            combat: {
              ...preview,
              turns: preview.turns.map((turn) => ({ ...turn, initiative: null }))
            }
          });
        }

        const initiativeBefore = combatantInitiativeSnapshot(combat);
        const changedCount = countInitiativeEntries(initiativeBefore);
        const watch = startCombatUpdateWatch(combatId);
        let resetError = null;
        try {
          await resetCombatInitiative(combat);
        } catch (error) {
          resetError = error;
        }
        const dispatched = watch.stop();
        if (resetError) throw resetError;
        const parent = rereadCombat(combatId, combat);

        if (changedCount > 0 && watch.available && !dispatched) {
          throw createBridgeError(
            ERROR_CODES.INTERNAL_ERROR,
            `Combat ${combatId} initiative was NOT reset: Foundry never dispatched resetAll()'s write, so the world still holds every initiative. A top-level Combat update is dropped WHOLE and SILENTLY when a module's preUpdateCombat hook refuses it (or when the change fails Foundry's own client-side validation, which it reports only as a UI notification) — all-or-nothing, never row by row. Note what this does NOT undo: resetAll cleared the rows in the GM client's memory BEFORE writing, so combat.get from this bridge session (and Foundry's own Combat Tracker) will keep showing them cleared until that GM client is RELOADED — the world's true state is the pre-reset one. ${COMBAT_VETO_REMEDY}`,
            { combatId, changedCount }
          );
        }

        const after = combatantInitiativeSnapshot(parent);
        const stillSet = [...initiativeBefore.keys()].filter(
          (id) => initiativeBefore.get(id) !== null && after.has(id) && after.get(id) !== null
        );
        if (stillSet.length > 0) {
          const dispatchEvidence = watch.available
            ? "Its write DID dispatch (Foundry's own updateCombat hook fired), and resetAll issues ONE top-level Combat update, which is refused all-or-nothing — so a mixed outcome like this points at a concurrent initiative write from the Foundry UI or another module landing inside the call rather than at a refused row."
            : "Whether the write dispatched could not be observed (this session exposes no Hooks API), so a refused update is not ruled out — nor is a concurrent initiative write from the Foundry UI or another module landing inside the call.";
          throw createBridgeError(
            ERROR_CODES.INTERNAL_ERROR,
            `Combat ${combatId} initiative was NOT fully reset: combatant(s) ${stillSet.join(
              ", "
            )} still store an initiative after Foundry resolved resetAll() without an error. ${dispatchEvidence} Re-read with combat.get before retrying. ${COMBAT_VETO_REMEDY}`,
            { combatId, changedCount, combatantIds: stillSet }
          );
        }
        return {
          combatId,
          reset: true,

          changedCount,
          combat: serializeCombat(parent)
        };
      });
    },

    async "combat.roll-initiative"(params) {
      return combatQueue.run(async () => {
        const combat = getCombatById(params.combatId);
        const combatId = combat.id ?? params.combatId;
        const rollMode = params.rollMode ?? "public";

        const { mode, targetedCombatantIds } = resolveCombatInitiativeTargets(combat, params, combatId);
        const method = mode === "all" ? "rollAll" : mode === "npc" ? "rollNPC" : "rollInitiative";
        assertCombatMethodSupported(combat, method, "combat.roll-initiative");

        if (isDryRun(params)) {
          return dryRunResponse({
            combatId,
            complete: true,
            mutation: "not-executed",
            select: mode,
            targetedCombatantIds,
            rolled: [],
            unconfirmedCombatantIds: [],
            unconfirmableCombatantIds: [],
            chatMessages: { status: "not-requested", expectedCount: 0, ids: [] },
            combat: serializeCombat(combat),

            combatSceneUnlinked: false,
            groupInitiativeChanges: []
          });
        }

        const initiativeBefore = combatantInitiativeSnapshot(combat);

        const sceneBefore = combatStoredSceneId(combat);
        const groupInitiativeBefore = combatantGroupInitiativeSnapshot(combat);

        const correlationId = newBridgeCorrelationId();
        const capture = startCombatInitiativeChatCapture(correlationId);
        let rollError = null;
        try {
          await rollCombatInitiative(
            combat,
            mode,
            targetedCombatantIds,
            resolveCombatInitiativeOptions(rollMode, correlationId, params.formula ?? null)
          );
        } catch (error) {
          rollError = error;
        }
        const capturedIds = capture.stop();
        const parent = rereadCombat(combatId, combat);
        const initiativeAfter = combatantInitiativeSnapshot(parent);

        const rolledDomain = mode === "ids" ? new Set(targetedCombatantIds) : null;
        const rolled = [];
        for (const [id, before] of initiativeBefore) {
          if (rolledDomain && !rolledDomain.has(id)) continue;
          if (!initiativeAfter.has(id)) continue;
          const after = initiativeAfter.get(id) ?? null;
          if (after === before) continue;
          if (after === null) continue;
          rolled.push({ combatantId: id, initiativeBefore: before, initiative: after });
        }

        const clearedCombatantIds = targetedCombatantIds.filter(
          (id) =>
            initiativeAfter.has(id) &&
            (initiativeBefore.get(id) ?? null) !== null &&
            (initiativeAfter.get(id) ?? null) === null
        );

        const unconfirmedCombatantIds =
          mode === "ids"
            ? targetedCombatantIds.filter(
                (id) =>
                  initiativeAfter.has(id) &&
                  (initiativeBefore.get(id) ?? null) === null &&
                  (initiativeAfter.get(id) ?? null) === null
              )
            : [];

        const unconfirmableCombatantIds = targetedCombatantIds.filter((id) => {
          if (!initiativeAfter.has(id)) return true;
          const before = initiativeBefore.get(id) ?? null;
          if (before === null) return false;
          const after = initiativeAfter.get(id) ?? null;
          return after === before || after === null;
        });

        const unconfirmableVanishedIds = unconfirmableCombatantIds.filter((id) => !initiativeAfter.has(id));
        const unconfirmableUnchangedIds = unconfirmableCombatantIds.filter(
          (id) => initiativeAfter.has(id) && !clearedCombatantIds.includes(id)
        );

        const expectedCount = mode === "ids" ? targetedCombatantIds.length : rolled.length;
        const status = deriveChatCaptureStatus({
          requested: !rollError,
          available: capture.available,
          expectedCount,
          ids: capturedIds
        });

        const selectModeChatGap = mode !== "ids" && capturedIds.length > rolled.length;

        const selectModeUnwatched = mode !== "ids" && !capture.available;

        const vanishedCombatantIds = selectModeChatGap
          ? [...initiativeBefore.keys()].filter((id) => !initiativeAfter.has(id))
          : [];

        if (rollError) {
          if (rolled.length === 0 && unconfirmableCombatantIds.length === 0) {
            if (capturedIds.length === 0) throw rollError;
            throw createBridgeError(
              ERROR_CODES.INTERNAL_ERROR,
              `No initiative was stored for combat ${combatId}: Foundry's rollInitiative() threw and no combatant stored a roll total, but it had ALREADY created ${
                capturedIds.length
              } initiative chat message(s) — ${capturedIds.join(
                ", "
              )} — announcing rolls the world never recorded (initiative is written first, chat second, and neither core offers a suppression option). Those ids carry this call's correlation flag, so they are provably ours: confirm one with chat get and remove it with chat delete, then retry. Underlying failure: ${
                toFailureSummary(rollError).message
              }`,
              {
                combatId,
                combatantIds: targetedCombatantIds,
                chatMessageIds: capturedIds,
                failure: toFailureSummary(rollError)
              }
            );
          }
          return {
            combatId,
            complete: false,
            mutation: "unknown",
            select: mode,
            targetedCombatantIds,
            rolled,
            unconfirmedCombatantIds,
            unconfirmableCombatantIds,
            chatMessages: {
              status: "unknown",
              expectedCount: capturedIds.length,
              ids: capturedIds
            },
            combat: serializeCombat(parent),

            combatSceneUnlinked: sceneBefore !== null && combatStoredSceneId(parent) === null,
            groupInitiativeChanges: combatantGroupInitiativeChanges(
              groupInitiativeBefore,
              combatantGroupInitiativeSnapshot(parent)
            ),

            failure: toFailureSummary(rollError)
          };
        }

        if (unconfirmedCombatantIds.length > 0 && rolled.length === 0) {
          const orphanedChat =
            capturedIds.length > 0
              ? ` Foundry DID post ${capturedIds.length} initiative chat message(s) first — ${capturedIds.join(
                  ", "
                )} — announcing rolls the world never recorded: confirm one with chat get and remove it with chat delete.`
              : " No initiative chat message carrying this call's correlation flag was observed, so there is probably nothing to clean up in chat — but Foundry offers no suppression option, so check chat list if the roll was announced anyway.";
          const clearedRows =
            clearedCombatantIds.length > 0
              ? ` Combatant(s) ${clearedCombatantIds.join(
                  ", "
                )} additionally LOST the initiative they held — their stored value is now null, which no roll total can be, so either a hook rewrote the roll instead of vetoing the row or something cleared it inside the call; those rows are reported as unconfirmable rather than refused, because a concurrent clear may have landed after a good roll.`
              : "";
          throw createBridgeError(
            ERROR_CODES.INTERNAL_ERROR,
            `No initiative was stored for combat ${combatId}: combatant(s) ${unconfirmedCombatantIds.join(
              ", "
            )} still have no initiative after Foundry resolved rollInitiative() without an error. Foundry drops a refused row from the batch SILENTLY (a module's preUpdateCombatant hook, a core _preUpdate, or the row failing client-side validation).${clearedRows}${orphanedChat} ${COMBAT_VETO_REMEDY}`,
            {
              combatId,
              combatantIds: unconfirmedCombatantIds,
              chatMessageIds: capturedIds,
              ...(clearedCombatantIds.length > 0 ? { clearedCombatantIds } : {})
            }
          );
        }
        return {
          combatId,

          complete:
            unconfirmedCombatantIds.length === 0 &&
            unconfirmableCombatantIds.length === 0 &&
            status === "captured" &&
            !selectModeChatGap,

          mutation:
            unconfirmedCombatantIds.length === 0 &&
            unconfirmableCombatantIds.length === 0 &&
            !selectModeChatGap &&
            !selectModeUnwatched
              ? "committed"
              : "unknown",
          select: mode,
          targetedCombatantIds,
          rolled,
          unconfirmedCombatantIds,
          unconfirmableCombatantIds,

          chatMessages: { status, expectedCount, ids: capturedIds },
          combat: serializeCombat(parent),
          combatSceneUnlinked: sceneBefore !== null && combatStoredSceneId(parent) === null,
          groupInitiativeChanges: combatantGroupInitiativeChanges(
            groupInitiativeBefore,
            combatantGroupInitiativeSnapshot(parent)
          ),
          ...(unconfirmedCombatantIds.length > 0
            ? {
                failure: {
                  code: ERROR_CODES.INTERNAL_ERROR,
                  message: `Initiative did not land for combatant(s) ${unconfirmedCombatantIds.join(
                    ", "
                  )}; Foundry dropped those rows from the batch silently. Re-read with combat.get and roll them individually.`
                }
              }
            : selectModeChatGap
              ? {
                  failure: {
                    code: ERROR_CODES.INTERNAL_ERROR,
                    message: `Foundry posted ${capturedIds.length} initiative chat message(s) for select:${mode} but only ${
                      rolled.length
                    } combatant(s) show a stored initiative change, so at least ${
                      capturedIds.length - rolled.length
                    } roll(s) were announced without being recorded. In this mode the bridge cannot say WHICH row — core's selection is overridden by the game system, so only the count is comparable. At least two causes produce this, not an exhaustive list: Foundry dropped a row from the embedded batch silently (a preUpdateCombatant hook, a core _preUpdate, or the row failing client-side validation), or a combatant was DELETED inside the call${
                      vanishedCombatantIds.length > 0
                        ? ` (combatant(s) ${vanishedCombatantIds.join(", ")} are gone from the combat, which is consistent with the second cause)`
                        : ""
                    }. Re-read with combat.get, then roll the rows that still have no initiative with --combatant-ids, which is the mode that can name a refused row. The orphaned card(s) ${capturedIds.join(
                      ", "
                    )} carry this call's correlation flag, so they are provably ours: chat delete removes them.`
                  }
                }
              : unconfirmableCombatantIds.length > 0
                ? {
                    failure: {
                      code: ERROR_CODES.INTERNAL_ERROR,
                      message: `Initiative cannot be CONFIRMED for combatant(s) ${unconfirmableCombatantIds.join(
                        ", "
                      )}${
                        unconfirmableUnchangedIds.length > 0
                          ? ` — ${unconfirmableUnchangedIds.join(
                              ", "
                            )} already held an initiative and hold the SAME stored value afterwards, and a re-roll may legally land on the number that was already there (Foundry's rollInitiative() returns no roll totals, so the bridge cannot tell that apart from a silently dropped row)`
                          : ""
                      }${
                        clearedCombatantIds.length > 0
                          ? ` — ${clearedCombatantIds.join(
                              ", "
                            )} already held an initiative and now store NONE at all, which no roll total can be (it is always a number), so those rows do not hold this call's roll: a hook may have rewritten the roll to null instead of vetoing the row, or the Foundry UI or another module may have cleared it inside the call AFTER a good roll landed — indistinguishable here, so they are not reported as refused and they are deliberately absent from rolled[]`
                          : ""
                      }${
                        unconfirmableVanishedIds.length > 0
                          ? ` — ${unconfirmableVanishedIds.join(
                              ", "
                            )} are no longer in the combat, so nothing can be read back for them (the Foundry UI or another module deleted them inside the call; the queue serializes bridge commands only)`
                          : ""
                      }. This is NOT a report that the roll failed: it is why the verdict is "unknown" instead of "committed", because this family never calls a write committed unless the stored state confirms it. Re-read with combat.get; for a confirmable re-roll, combat.reset-initiative first — a null-to-number transition IS provable.`
                    }
                  }
                : {})
        };
      });
    },

    async "combat.set-initiative"(params) {
      return combatQueue.run(async () => {
        const { combat, combatant } = getCombatantById(params.combatId, params.combatantId);
        const combatId = combat.id ?? params.combatId;
        assertCombatMethodSupported(combat, "setInitiative", "combat.set-initiative");
        const initiativeBefore = combatantStoredInitiative(combatant);
        const sceneBefore = combatStoredSceneId(combat);

        const groupInitiativeBefore = combatantGroupInitiativeSnapshot(combat);
        if (isDryRun(params)) {
          const preview = await previewCombatantUpdate(combat, params.combatantId, {
            initiative: params.initiative
          });
          return dryRunResponse({
            combatId,
            combatantId: params.combatantId,
            initiativeBefore,
            initiative: params.initiative,
            changed: initiativeBefore !== params.initiative,
            combatant: serializeCombatant(preview, combat),
            combat: serializeCombatSummary(combat),
            combatSceneUnlinked: false,
            groupInitiativeChanges: []
          });
        }

        await setCombatantInitiative(combat, params.combatantId, params.initiative);
        const parent = rereadCombat(combatId, combat);
        const updated = parent?.combatants?.get?.(params.combatantId) ?? combatant;
        const initiativeAfter = combatantStoredInitiative(updated);

        if (initiativeBefore !== params.initiative && initiativeAfter === initiativeBefore) {
          throw createBridgeError(
            ERROR_CODES.INTERNAL_ERROR,
            `Combatant ${params.combatantId} of combat ${combatId} still stores initiative ${
              initiativeBefore ?? "null"
            }: Foundry resolved setInitiative() without applying it, which means a module's preUpdateCombatant hook or a core _preUpdate refused the write, or it failed Foundry's own client-side validation (reported only as a UI notification). ${COMBAT_VETO_REMEDY}`,
            { combatId, combatantId: params.combatantId, initiative: params.initiative }
          );
        }
        const sceneAfter = combatStoredSceneId(parent);
        return {
          combatId,
          combatantId: params.combatantId,
          initiativeBefore,

          initiative: initiativeAfter,
          changed: initiativeAfter !== initiativeBefore,
          combatant: serializeCombatant(updated, parent),
          combat: serializeCombatSummary(parent),
          combatSceneUnlinked: sceneBefore !== null && sceneAfter === null,
          groupInitiativeChanges: combatantGroupInitiativeChanges(
            groupInitiativeBefore,
            combatantGroupInitiativeSnapshot(parent)
          )
        };
      });
    },

    async "combat.combatant.list"(params) {
      const combat = getCombatById(params.combatId);

      const ordered = combatOrderedCombatants(combat);
      const { page, total, hasMore } = paginate(ordered, params);
      return {
        combatId: combat.id ?? params.combatId,
        combatants: page.map((combatant) => serializeCombatantTurn(combatant)),
        total,
        hasMore
      };
    },

    async "combat.combatant.get"(params) {
      const { combat, combatant } = getCombatantById(params.combatId, params.combatantId);
      return {
        combatId: combat.id ?? params.combatId,
        combatant: serializeCombatant(combatant, combat)
      };
    },

    async "combat.combatant.create"(params) {
      return combatQueue.run(async () => {
        const combat = getCombatById(params.combatId);
        const combatId = combat.id ?? params.combatId;

        assertCombatantVersionFields(params.data, { verb: "combat.combatant.create" });
        assertCombatReferenceIdsNotBlank(params.data, COMBATANT_REFERENCE_ID_FIELDS, {
          combatId,
          verb: "combat.combatant.create"
        });
        const data = prepareCombatantPayload(params.data ?? {});
        assertCombatantGroupReference(combat, data, { combatId });
        const sceneBefore = combatStoredSceneId(combat);

        const preview = await previewCombatantCreate(combat, cloneValue(data));
        if (isDryRun(params)) {
          return dryRunResponse({
            combatId,
            combatant: serializeCombatant(preview, combat),

            combat: serializeCombatSummary(combat),
            combatSceneUnlinked: false
          });
        }

        const combatant = await createCombatant(combat, data);
        const parent = rereadCombat(combatId, combat);
        const sceneAfter = combatStoredSceneId(parent);
        return {
          combatId,
          combatant: serializeCombatant(combatant, parent),
          combat: serializeCombatSummary(parent),

          combatSceneUnlinked: sceneBefore !== null && sceneAfter === null
        };
      });
    },

    async "combat.combatant.update"(params) {
      return combatQueue.run(async () => {
        const { combat, combatant } = getCombatantById(params.combatId, params.combatantId);
        const combatId = combat.id ?? params.combatId;

        assertCombatantVersionFields(params.patch, { verb: "combat.combatant.update" });
        assertCombatReferenceIdsNotBlank(params.patch, COMBATANT_REFERENCE_ID_FIELDS, {
          combatId,
          combatantId: params.combatantId,
          verb: "combat.combatant.update"
        });
        const patch = prepareCombatantPayload(params.patch);
        assertCombatantGroupReference(combat, patch, { combatId, combatantId: params.combatantId });
        const sceneBefore = combatStoredSceneId(combat);

        const groupInitiativeBefore = combatantGroupInitiativeSnapshot(combat);
        if (isDryRun(params)) {
          const preview = await previewCombatantUpdate(combat, params.combatantId, patch);
          return dryRunResponse({
            combatId,
            combatant: serializeCombatant(preview, combat),
            combat: serializeCombatSummary(combat),
            combatSceneUnlinked: false,

            groupInitiativeChanges: []
          });
        }

        const { combatant: updated, committed } = await updateCombatant(combat, params.combatantId, patch);
        if (!committed) {
          await assertTableFamilyUpdateCommitted({
            document: await detachedCombatantRow(combat, params.combatantId),
            patch,
            subject: `Combatant ${params.combatantId} of combat ${combatId}`,
            hookName: "preUpdateCombatant",
            details: { combatId, combatantId: params.combatantId },
            remedy: COMBAT_VETO_REMEDY
          });
        }
        const parent = rereadCombat(combatId, combat);
        const sceneAfter = combatStoredSceneId(parent);
        return {
          combatId,
          combatant: serializeCombatant(updated ?? combatant, parent),
          combat: serializeCombatSummary(parent),
          combatSceneUnlinked: sceneBefore !== null && sceneAfter === null,

          groupInitiativeChanges: combatantGroupInitiativeChanges(
            groupInitiativeBefore,
            combatantGroupInitiativeSnapshot(parent)
          )
        };
      });
    },

    async "combat.combatant.delete"(params) {
      return combatQueue.run(async () => {
        const { combat } = getCombatantById(params.combatId, params.combatantId);
        const combatId = combat.id ?? params.combatId;

        if (isDryRun(params)) {
          return dryRunResponse({
            combatId,
            id: params.combatantId,
            deleted: false,
            combat: serializeCombatSummary(combat)
          });
        }

        const { committed } = await deleteCombatant(combat, params.combatantId);
        assertTableFamilyDeleteCommitted({
          committed,
          subject: `Combatant ${params.combatantId} of combat ${combatId}`,
          hookName: "preDeleteCombatant",
          details: { combatId, combatantId: params.combatantId },
          remedy: COMBAT_VETO_REMEDY
        });
        return {
          combatId,
          id: params.combatantId,
          deleted: true,
          combat: serializeCombatSummary(rereadCombat(combatId, combat))
        };
      });
    },

    async "combat.group.list"(params) {
      const combat = getCombatById(params.combatId);

      const groups = combat.groups ? Array.from(combat.groups) : [];
      const { page, total, hasMore } = paginate(groups, params);
      return {
        combatId: combat.id ?? params.combatId,
        groups: page.map((group) =>
          serializeCombatantGroupSummary(group, combat, {
            memberCombatantIds: combatantIdsInGroup(combat, group?.id)
          })
        ),
        total,
        hasMore
      };
    },

    async "combat.group.get"(params) {
      const { combat, group } = getCombatantGroupById(params.combatId, params.groupId);
      return {
        combatId: combat.id ?? params.combatId,

        group: serializeCombatantGroup(group, combat, {
          ownership: true,
          memberCombatantIds: combatantIdsInGroup(combat, group?.id ?? params.groupId)
        })
      };
    },

    async "combat.group.create"(params) {
      return combatQueue.run(async () => {
        const combat = getCombatById(params.combatId);
        const combatId = combat.id ?? params.combatId;

        const data = prepareCombatantGroupPayload(params.data ?? {});
        const preview = previewCombatantGroupCreate(combat, cloneValue(data));
        if (isDryRun(params)) {
          return dryRunResponse({
            combatId,

            group: serializeCombatantGroup(preview, combat, { memberCombatantIds: [] })
          });
        }

        const group = await createCombatantGroup(combat, data);
        return {
          combatId,

          group: serializeCombatantGroup(group, combat, {
            memberCombatantIds: combatantIdsInGroup(rereadCombat(combatId, combat), group?.id)
          })
        };
      });
    },

    async "combat.group.update"(params) {
      return combatQueue.run(async () => {
        const { combat, group } = getCombatantGroupById(params.combatId, params.groupId);
        const combatId = combat.id ?? params.combatId;
        const patch = prepareCombatantGroupPayload(params.patch);
        if (isDryRun(params)) {
          const preview = await previewDocumentUpdate(group, patch);
          return dryRunResponse({
            combatId,

            group: serializeCombatantGroup(preview, combat, {
              memberCombatantIds: combatantIdsInGroup(combat, params.groupId),
              derivedFrom: group
            })
          });
        }

        const { group: updated, committed } = await updateCombatantGroup(combat, params.groupId, patch);
        if (!committed) {
          await assertTableFamilyUpdateCommitted({
            document: updated ?? group,
            patch,
            subject: `Combatant group ${params.groupId} of combat ${combatId}`,
            hookName: "preUpdateCombatantGroup",
            details: { combatId, groupId: params.groupId },
            remedy: COMBAT_VETO_REMEDY
          });
        }
        const parent = rereadCombat(combatId, combat);
        return {
          combatId,
          group: serializeCombatantGroup(updated ?? group, parent, {
            memberCombatantIds: combatantIdsInGroup(parent, params.groupId)
          })
        };
      });
    },

    async "combat.group.delete"(params) {
      return combatQueue.run(async () => {
        const { combat } = getCombatantGroupById(params.combatId, params.groupId);
        const combatId = combat.id ?? params.combatId;

        if (isDryRun(params)) {
          return dryRunResponse({
            combatId,
            id: params.groupId,
            deleted: false,

            danglingCombatantIds: combatantIdsInGroup(combat, params.groupId)
          });
        }

        const { committed } = await deleteCombatantGroup(combat, params.groupId);
        assertTableFamilyDeleteCommitted({
          committed,
          subject: `Combatant group ${params.groupId} of combat ${combatId}`,
          hookName: "preDeleteCombatantGroup",
          details: { combatId, groupId: params.groupId },
          remedy: COMBAT_VETO_REMEDY
        });
        const parent = rereadCombat(combatId, combat);
        return {
          combatId,
          id: params.groupId,
          deleted: true,

          danglingCombatantIds: combatantIdsInGroup(parent, params.groupId)
        };
      });
    }
  };
}
