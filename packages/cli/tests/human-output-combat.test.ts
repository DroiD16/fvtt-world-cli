import { CommanderError } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCommand } from "./helpers/cli-harness.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fvtt-world-cli commands", () => {
  describe("combat human output", () => {
    const respond = (result: any) =>
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result
      })) as unknown as Parameters<typeof runCommand>[1];

    it("prints the turn rows in the ORDER RECEIVED (Foundry's own, never re-sorted locally)", async () => {
      const result = await runCommand(
        ["combat", "get", "--combat-id", "combat-1"],
        respond({
          combat: {
            id: "combat-1",
            name: null,
            type: "base",
            scene: "scene-1",
            active: true,
            round: 2,
            turn: 0,
            started: true,
            currentCombatantId: "combatant-2",
            sort: 0,
            system: {},
            flags: {},
            combatantCount: 2,
            groupCount: 1,

            turns: [
              {
                id: "combatant-2",
                name: "Goblin",
                initiative: 20,
                hidden: false,
                defeated: false,
                group: "group-1",
                tokenId: "token-b",
                actorId: null
              },
              {
                id: "combatant-1",
                name: "Hero",
                initiative: 5,
                hidden: false,
                defeated: false,
                group: null,
                tokenId: "token-a",
                actorId: "actor-1"
              }
            ]
          }
        })
      );
      expect(result.error).toBeNull();
      const lines = result.stdout.split("\n");
      const first = lines.findIndex((line) => line.includes("combatant-2"));
      const second = lines.findIndex((line) => line.includes("combatant-1"));
      expect(first).toBeGreaterThan(-1);
      expect(second).toBeGreaterThan(first);
      expect(result.stdout).toContain("currentCombatantId: combatant-2");
      expect(result.stdout).toContain("started: true");
      expect(result.stdout).toContain("groups: 1");

      expect(result.stdout).toContain("init=20");
    });

    it("prints an empty initiative cell rather than a fabricated 0", async () => {
      const result = await runCommand(
        ["combat", "get", "--combat-id", "combat-1"],
        respond({
          combat: {
            id: "combat-1",
            combatantCount: 1,
            groupCount: 0,
            turns: [{ id: "c-1", name: "Unrolled", initiative: null }]
          }
        })
      );
      expect(result.stdout).toContain("init=\t");
    });

    it('prints the activation side effect of a delete, and the EMPTY case as unsettled — not as "none"', async () => {
      const quiet = await runCommand(
        ["combat", "delete", "--combat-id", "combat-1"],
        respond({
          id: "combat-1",
          deleted: true,
          otherActiveCombatIdsBefore: [],
          otherActiveCombatIdsAfter: [],
          activatedCombatIds: [],
          activationObservation: "not-observable-at-return-time"
        })
      );
      expect(quiet.stdout).toContain("Deleted combat combat-1");

      expect(quiet.stdout).toContain("none observed yet");
      expect(quiet.stdout).toContain("combat list");
      expect(quiet.stdout).not.toContain("activated by this delete: (none)");

      expect(quiet.stdout).toContain("otherActiveBefore: (none)");

      const noisy = await runCommand(
        ["combat", "delete", "--combat-id", "combat-1"],
        respond({
          id: "combat-1",
          deleted: true,
          otherActiveCombatIdsBefore: [],
          otherActiveCombatIdsAfter: ["combat-2"],
          activatedCombatIds: ["combat-2"],
          activationObservation: "not-observable-at-return-time"
        })
      );

      expect(noisy.stdout).toContain("activated by this delete (observed so far): combat-2");
      expect(noisy.stdout).toContain("Combat Tracker");
    });

    it("prints a v13 combat's absent name as empty, not as the string null", async () => {
      const result = await runCommand(
        ["combat", "get", "--combat-id", "combat-1"],
        respond({ combat: { id: "combat-1", name: null, combatantCount: 0, groupCount: 0, turns: [] } })
      );
      expect(result.stdout).toContain("name: \n");
      expect(result.stdout).not.toContain("name: null");
    });

    it("prints a combatant WRITE with the parent state it moved, and calls out the scene unlink", async () => {
      const quiet = await runCommand(
        ["combat", "combatant", "create", "--combat-id", "combat-1", "--token-id", "tok-1"],
        respond({
          combatId: "combat-1",
          combatant: {
            id: "cmb-9",
            combatId: "combat-1",
            name: "",
            img: null,
            initiative: null,
            group: null
          },
          combat: {
            id: "combat-1",
            round: 2,
            turn: 1,
            started: true,
            scene: "scene-1",
            combatantCount: 3,
            groupCount: 1
          },
          combatSceneUnlinked: false
        })
      );

      expect(quiet.stdout).toContain(
        "combat: round=2 turn=1 started=true scene=scene-1 combatants=3 groups=1"
      );
      expect(quiet.stdout).not.toContain("unlinked the combat");

      expect(quiet.stdout).toContain("name: \n");
      expect(quiet.stdout).not.toContain("name: null");

      const unlinked = await runCommand(
        [
          "combat",
          "combatant",
          "create",
          "--combat-id",
          "combat-1",
          "--token-id",
          "tok-1",
          "--scene-id",
          "scn-other"
        ],
        respond({
          combatId: "combat-1",
          combatant: { id: "cmb-9", combatId: "combat-1", name: "Orc" },
          combat: {
            id: "combat-1",
            round: 2,
            turn: 1,
            started: true,
            scene: null,
            combatantCount: 3,
            groupCount: 1
          },
          combatSceneUnlinked: true
        })
      );

      expect(unlinked.stdout).toContain("unlinked the combat from its scene");
      expect(unlinked.stdout).toContain("combat.scene -> null");
    });

    it("calls out the group initiative a SYSTEM changed on a combatant update, and prints nothing when none did", async () => {
      const changed = await runCommand(
        [
          "combat",
          "combatant",
          "update",
          "--combat-id",
          "combat-1",
          "--combatant-id",
          "cmb-9",
          "--group",
          "grp-1"
        ],
        respond({
          combatId: "combat-1",
          combatant: { id: "cmb-9", combatId: "combat-1", name: "Wolf", group: "grp-1", initiative: 7 },
          combat: {
            id: "combat-1",
            round: 2,
            turn: 1,
            started: true,
            scene: "scene-1",
            combatantCount: 3,
            groupCount: 1
          },
          combatSceneUnlinked: false,
          groupInitiativeChanges: [{ groupId: "grp-1", initiativeBefore: 0, initiativeAfter: null }]
        })
      );
      expect(changed.stdout).toContain("changed group grp-1's initiative: 0 -> null");
      expect(changed.stdout).toContain("combat group update --initiative");

      const untouched = await runCommand(
        [
          "combat",
          "combatant",
          "update",
          "--combat-id",
          "combat-1",
          "--combatant-id",
          "cmb-9",
          "--hidden",
          "true"
        ],
        respond({
          combatId: "combat-1",
          combatant: { id: "cmb-9", combatId: "combat-1", name: "Wolf", group: "grp-1", initiative: 7 },
          combat: {
            id: "combat-1",
            round: 2,
            turn: 1,
            started: true,
            scene: "scene-1",
            combatantCount: 3,
            groupCount: 1
          },
          combatSceneUnlinked: false,
          groupInitiativeChanges: []
        })
      );

      expect(untouched.stdout).toContain("initiative: 7");
      expect(untouched.stdout).not.toContain("changed group");
    });

    it("prints a group with its DERIVED booleans, member ids and read-only ownership", async () => {
      const result = await runCommand(
        ["combat", "group", "get", "--combat-id", "combat-1", "--group-id", "grp-1"],
        respond({
          combatId: "combat-1",
          group: {
            id: "grp-1",
            combatId: "combat-1",
            name: "Goblins",
            type: "base",
            img: null,
            initiative: 15,
            hidden: false,
            defeated: false,
            memberCombatantIds: ["cmb-1", "cmb-2"],
            system: {},
            flags: {},
            ownership: { default: 0, someuserid0000001: -1 }
          }
        })
      );
      expect(result.stdout).toContain("hidden (derived): false");
      expect(result.stdout).toContain("members: 2 (cmb-1, cmb-2)");
      expect(result.stdout).toContain("ownership (read-only)");

      const preview = await runCommand(
        ["combat", "group", "create", "--combat-id", "combat-1", "--name", "Fresh"],
        respond({
          combatId: "combat-1",
          group: {
            id: null,
            combatId: "combat-1",
            name: "Fresh",
            hidden: null,
            defeated: null,
            memberCombatantIds: [],
            system: {},
            flags: {}
          },
          dryRun: true
        })
      );
      expect(preview.stdout).toContain("hidden (derived): \n");
      expect(preview.stdout).not.toContain("hidden (derived): false");
      expect(preview.stdout).toContain("members: 0");

      expect(preview.stdout).not.toContain("ownership");
    });

    it("prints the dangling members a group delete leaves behind, and the empty case plainly", async () => {
      const dangling = await runCommand(
        ["combat", "group", "delete", "--combat-id", "combat-1", "--group-id", "grp-1"],
        respond({ combatId: "combat-1", id: "grp-1", deleted: true, danglingCombatantIds: ["cmb-2"] })
      );
      expect(dangling.stdout).toContain("Deleted combatant group grp-1 of combat combat-1");

      expect(dangling.stdout).toContain("combatants left pointing at this group: cmb-2");
      expect(dangling.stdout).toContain("--clear-group");

      const clean = await runCommand(
        ["combat", "group", "delete", "--combat-id", "combat-1", "--group-id", "grp-1"],
        respond({ combatId: "combat-1", id: "grp-1", deleted: true, danglingCombatantIds: [] })
      );
      expect(clean.stdout).toContain("combatants left pointing at this group: (none)");
    });

    it("prints combatant list rows in the ORDER RECEIVED (Foundry's own turn order)", async () => {
      const result = await runCommand(
        ["combat", "combatant", "list", "--combat-id", "combat-1"],
        respond({
          combatId: "combat-1",
          combatants: [
            {
              id: "cmb-2",
              name: "Goblin",
              initiative: 20,
              hidden: false,
              defeated: false,
              group: "grp-1",
              tokenId: "tok-b",
              actorId: null
            },
            {
              id: "cmb-1",
              name: "Hero",
              initiative: 5,
              hidden: false,
              defeated: false,
              group: null,
              tokenId: "tok-a",
              actorId: "act-1"
            }
          ],
          total: 2,
          hasMore: false
        })
      );
      const lines = result.stdout.split("\n");
      expect(lines.findIndex((line) => line.includes("cmb-2"))).toBeLessThan(
        lines.findIndex((line) => line.includes("cmb-1"))
      );
      expect(result.stdout).toContain("turn order");
    });

    it("rejects an empty combatant/group update and the conflicting clear flags before the round-trip", async () => {
      for (const argv of [
        ["combat", "combatant", "update", "--combat-id", "c-1", "--combatant-id", "cmb-1"],
        ["combat", "group", "update", "--combat-id", "c-1", "--group-id", "grp-1"]
      ]) {
        const sendCommand = vi.fn();
        const result = await runCommand(argv, sendCommand as unknown as Parameters<typeof runCommand>[1]);
        expect((result.error as Error)?.message).toContain("No fields to update");
        expect(sendCommand).not.toHaveBeenCalled();
      }
      for (const argv of [
        [
          "combat",
          "combatant",
          "update",
          "--combat-id",
          "c-1",
          "--combatant-id",
          "cmb-1",
          "--group",
          "g",
          "--clear-group"
        ],
        [
          "combat",
          "combatant",
          "update",
          "--combat-id",
          "c-1",
          "--combatant-id",
          "cmb-1",
          "--img",
          "a.webp",
          "--clear-img"
        ],
        [
          "combat",
          "group",
          "update",
          "--combat-id",
          "c-1",
          "--group-id",
          "grp-1",
          "--initiative",
          "2",
          "--clear-initiative"
        ]
      ]) {
        const sendCommand = vi.fn();
        const result = await runCommand(argv, sendCommand as unknown as Parameters<typeof runCommand>[1]);
        expect(result.error).toBeInstanceOf(CommanderError);
        expect((result.error as CommanderError).code).toBe("commander.conflictingOption");
        expect(sendCommand).not.toHaveBeenCalled();
      }
    });

    it("has no --initiative on `combat combatant update` (initiative is the initiative verbs' field)", async () => {
      const sendCommand = vi.fn();
      const result = await runCommand(
        [
          "combat",
          "combatant",
          "update",
          "--combat-id",
          "c-1",
          "--combatant-id",
          "cmb-1",
          "--initiative",
          "5"
        ],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );
      expect(result.error).not.toBeNull();
      expect(sendCommand).not.toHaveBeenCalled();

      const created = vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          combatId: "c-1",
          combatant: { id: "cmb-9", initiative: 5 },
          combat: {},
          combatSceneUnlinked: false
        }
      })) as unknown as Parameters<typeof runCommand>[1];
      const ok = await runCommand(
        ["combat", "combatant", "create", "--combat-id", "c-1", "--initiative", "5"],
        created
      );
      expect(ok.error).toBeNull();
    });

    it("has no --name filter on either embedded list (stored names are commonly blank)", async () => {
      for (const argv of [
        ["combat", "combatant", "list", "--combat-id", "c-1", "--name", "goblin"],
        ["combat", "group", "list", "--combat-id", "c-1", "--name", "wolves"]
      ]) {
        const sendCommand = vi.fn();
        const result = await runCommand(argv, sendCommand as unknown as Parameters<typeof runCommand>[1]);
        expect(result.error).not.toBeNull();
        expect(sendCommand).not.toHaveBeenCalled();
      }
    });

    it("rejects an empty combat update before the round-trip", async () => {
      const sendCommand = vi.fn();
      const result = await runCommand(
        ["combat", "update", "--combat-id", "combat-1"],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );
      expect(result.error).not.toBeNull();
      expect((result.error as Error).message).toContain("No fields to update");
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it("rejects --clear-scene together with --scene", async () => {
      const sendCommand = vi.fn();
      const result = await runCommand(
        ["combat", "update", "--combat-id", "combat-1", "--scene", "scene-1", "--clear-scene"],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );
      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).code).toBe("commander.conflictingOption");
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it("has no --name filter on combat list (v13 Combat has no name field)", async () => {
      const sendCommand = vi.fn();
      const result = await runCommand(
        ["combat", "list", "--name", "boss"],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );
      expect(result.error).not.toBeNull();
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it("prints a combat.start DRY RUN with no before/after arrow, and the already-started case WITH one", async () => {
      const preview = await runCommand(
        ["--dry-run", "combat", "start", "--combat-id", "combat-1"],
        respond({
          combatId: "combat-1",
          started: false,
          alreadyStarted: false,
          transition: "none",
          roundBefore: 0,
          turnBefore: null,
          combat: {
            id: "combat-1",
            round: 0,
            turn: null,
            started: false,
            combatantCount: 2,
            groupCount: 0,
            turns: []
          },
          dryRun: true
        })
      );

      expect(preview.stdout).toContain("round (pre-action): 0");
      expect(preview.stdout).toContain("turn (pre-action): null");
      expect(preview.stdout).toContain("transition: none (nothing was called)");
      expect(preview.stdout).not.toContain("round: 0 -> 0");
      expect(preview.stdout).not.toContain("turn: 0 -> ");
      expect(preview.stdout).toContain("NOT the ones a start would apply");

      const already = await runCommand(
        ["combat", "start", "--combat-id", "combat-1"],
        respond({
          combatId: "combat-1",
          started: true,
          alreadyStarted: true,
          transition: "none",
          roundBefore: 3,
          turnBefore: 1,
          combat: {
            id: "combat-1",
            round: 3,
            turn: 1,
            started: true,
            combatantCount: 2,
            groupCount: 0,
            turns: []
          }
        })
      );

      expect(already.stdout).toContain("was ALREADY started");
      expect(already.stdout).toContain("round: 3 -> 3");
      expect(already.stdout).toContain("turn: 1 -> 1");
      expect(already.stdout).not.toContain("pre-action");

      expect(already.stdout).toContain("transition: none");
      expect(already.stdout).not.toContain("nothing was called)");

      const alreadyPreview = await runCommand(
        ["--dry-run", "combat", "start", "--combat-id", "combat-1"],
        respond({
          combatId: "combat-1",
          started: true,
          alreadyStarted: true,
          transition: "none",
          roundBefore: 3,
          turnBefore: 1,
          combat: {
            id: "combat-1",
            round: 3,
            turn: 1,
            started: true,
            combatantCount: 2,
            groupCount: 0,
            turns: []
          },
          dryRun: true
        })
      );
      expect(alreadyPreview.stdout).toContain("is ALREADY started");
      expect(alreadyPreview.stdout).toContain("would call NOTHING and report alreadyStarted: true");
      expect(alreadyPreview.stdout).toContain("exactly what it would leave");

      expect(alreadyPreview.stdout).not.toContain("NOT the ones a start would apply");
      expect(alreadyPreview.stdout).toContain("round (pre-action): 3");
      expect(alreadyPreview.stdout).toContain("turn (pre-action): 1");
      expect(alreadyPreview.stdout).toContain("transition: none (nothing was called)");

      const started = await runCommand(
        ["combat", "start", "--combat-id", "combat-1"],
        respond({
          combatId: "combat-1",
          started: true,
          alreadyStarted: false,
          transition: "round",
          roundBefore: 0,
          turnBefore: null,
          combat: {
            id: "combat-1",
            round: 1,
            turn: 0,
            started: true,
            combatantCount: 2,
            groupCount: 0,
            turns: []
          }
        })
      );
      expect(started.stdout).toContain("Started combat combat-1");

      expect(started.stdout).toContain("transition: round");
      expect(started.stdout).toContain("round: 0 -> 1");

      expect(started.stdout).toContain("turn: null -> 0");
      expect(started.stdout).toContain("does NOT make it the active encounter");
    });

    it('prints a NULL turn as "null", never as an empty cell (an un-start is a normal outcome)', async () => {
      const unstarted = await runCommand(
        ["combat", "previous-turn", "--combat-id", "combat-1", "--idempotency-key", "k"],
        respond({
          combatId: "combat-1",
          transition: "round",
          roundBefore: 1,
          turnBefore: 0,
          combat: {
            id: "combat-1",
            round: 0,
            turn: null,
            started: false,
            combatantCount: 2,
            groupCount: 0,
            turns: []
          }
        })
      );

      expect(unstarted.stdout).toContain("turn: 0 -> null");
      expect(unstarted.stdout).not.toMatch(/turn: 0 -> \n/);

      const nobodysTurn = await runCommand(
        ["combat", "next-round", "--combat-id", "combat-1", "--idempotency-key", "k"],
        respond({
          combatId: "combat-1",
          transition: "round",
          roundBefore: 0,
          turnBefore: null,
          combat: {
            id: "combat-1",
            round: 1,
            turn: null,
            started: true,
            combatantCount: 2,
            groupCount: 0,
            turns: []
          }
        })
      );
      expect(nobodysTurn.stdout).toContain("turn: null -> null");

      const missing = await runCommand(
        ["combat", "next-round", "--combat-id", "combat-1", "--idempotency-key", "k"],
        respond({
          combatId: "combat-1",
          transition: "round",
          combat: { id: "combat-1", combatantCount: 0, groupCount: 0, turns: [] }
        })
      );
      expect(missing.stdout).toContain("round:  -> ");
      expect(missing.stdout).not.toContain("round: 0 -> ");
    });

    it("prints the DELEGATION note only for a turn verb that OBSERVED a round move", async () => {
      const delegated = await runCommand(
        ["combat", "next-turn", "--combat-id", "combat-1", "--idempotency-key", "k"],
        respond({
          combatId: "combat-1",
          transition: "round",
          roundBefore: 2,
          turnBefore: 1,
          combat: {
            id: "combat-1",
            round: 3,
            turn: 0,
            started: true,
            combatantCount: 2,
            groupCount: 0,
            turns: []
          }
        })
      );
      expect(delegated.stdout).toContain("delegated this TURN move to a ROUND move");

      const plainRound = await runCommand(
        ["combat", "next-round", "--combat-id", "combat-1", "--idempotency-key", "k"],
        respond({
          combatId: "combat-1",
          transition: "round",
          roundBefore: 2,
          turnBefore: 1,
          combat: {
            id: "combat-1",
            round: 3,
            turn: 0,
            started: true,
            combatantCount: 2,
            groupCount: 0,
            turns: []
          }
        })
      );
      expect(plainRound.stdout).not.toContain("delegated this TURN move");

      const plainTurn = await runCommand(
        ["combat", "next-turn", "--combat-id", "combat-1", "--idempotency-key", "k"],
        respond({
          combatId: "combat-1",
          transition: "turn",
          roundBefore: 2,
          turnBefore: 0,
          combat: {
            id: "combat-1",
            round: 2,
            turn: 1,
            started: true,
            combatantCount: 2,
            groupCount: 0,
            turns: []
          }
        })
      );
      expect(plainTurn.stdout).not.toContain("delegated this TURN move");

      const preview = await runCommand(
        ["--dry-run", "combat", "next-turn", "--combat-id", "combat-1", "--idempotency-key", "k"],
        respond({
          combatId: "combat-1",
          transition: "round",
          roundBefore: 2,
          turnBefore: 1,
          combat: {
            id: "combat-1",
            round: 2,
            turn: 1,
            started: true,
            combatantCount: 2,
            groupCount: 0,
            turns: []
          },
          dryRun: true
        })
      );
      expect(preview.stdout).not.toContain("delegated this TURN move");
      expect(preview.stdout).toContain("round (pre-action): 2");
      expect(preview.stdout).toContain("the resulting round/turn is NOT predicted");
    });

    it("prints the UN-STARTED note only for a rewind that came from a started round", async () => {
      const unstarted = await runCommand(
        ["combat", "previous-round", "--combat-id", "combat-1", "--idempotency-key", "k"],
        respond({
          combatId: "combat-1",
          transition: "round",
          roundBefore: 1,
          turnBefore: 0,
          combat: {
            id: "combat-1",
            round: 0,
            turn: null,
            started: false,
            combatantCount: 2,
            groupCount: 0,
            turns: []
          }
        })
      );
      expect(unstarted.stdout).toContain("UN-STARTED the encounter");

      const wasAlreadyUnstarted = await runCommand(
        ["combat", "next-round", "--combat-id", "combat-1", "--idempotency-key", "k"],
        respond({
          combatId: "combat-1",
          transition: "round",
          roundBefore: 0,
          turnBefore: null,
          combat: {
            id: "combat-1",
            round: 1,
            turn: null,
            started: false,
            combatantCount: 2,
            groupCount: 0,
            turns: []
          }
        })
      );
      expect(wasAlreadyUnstarted.stdout).not.toContain("UN-STARTED the encounter");

      const stillStarted = await runCommand(
        ["combat", "previous-round", "--combat-id", "combat-1", "--idempotency-key", "k"],
        respond({
          combatId: "combat-1",
          transition: "round",
          roundBefore: 3,
          turnBefore: 0,
          combat: {
            id: "combat-1",
            round: 2,
            turn: 0,
            started: true,
            combatantCount: 2,
            groupCount: 0,
            turns: []
          }
        })
      );
      expect(stillStarted.stdout).not.toContain("UN-STARTED the encounter");
    });

    it("prints the world-wide deactivation of an activate, and labels the DRY RUN's as a prediction", async () => {
      const preview = await runCommand(
        ["--dry-run", "combat", "activate", "--combat-id", "combat-1"],
        respond({
          combatId: "combat-1",
          active: false,
          alreadyActive: false,
          otherActiveCombatIdsBefore: ["combat-2"],
          otherActiveCombatIdsAfter: [],
          deactivatedCombatIds: ["combat-2"],
          combat: {
            id: "combat-1",
            round: 0,
            turn: null,
            started: false,
            combatantCount: 0,
            groupCount: 0,
            turns: []
          },
          dryRun: true
        })
      );

      expect(preview.stdout).toContain("would be deactivated by this activation: combat-2");
      expect(preview.stdout).toContain("otherActiveAfter (predicted): (none)");

      const real = await runCommand(
        ["combat", "activate", "--combat-id", "combat-1"],
        respond({
          combatId: "combat-1",
          active: true,
          alreadyActive: false,
          otherActiveCombatIdsBefore: ["combat-2"],
          otherActiveCombatIdsAfter: [],
          deactivatedCombatIds: ["combat-2"],
          combat: {
            id: "combat-1",
            round: 0,
            turn: null,
            started: false,
            combatantCount: 0,
            groupCount: 0,
            turns: []
          }
        })
      );
      expect(real.stdout).toContain("Activated combat combat-1");
      expect(real.stdout).toContain("deactivated by this activation: combat-2");
      expect(real.stdout).toContain("one active encounter WORLD-wide");
      expect(real.stdout).not.toContain("would be deactivated");
      expect(real.stdout).not.toContain("(predicted)");

      const nothingElse = await runCommand(
        ["combat", "activate", "--combat-id", "combat-1"],
        respond({
          combatId: "combat-1",
          active: true,
          alreadyActive: true,
          otherActiveCombatIdsBefore: [],
          otherActiveCombatIdsAfter: [],
          deactivatedCombatIds: [],
          combat: {
            id: "combat-1",
            round: 0,
            turn: null,
            started: false,
            combatantCount: 0,
            groupCount: 0,
            turns: []
          }
        })
      );
      expect(nothingElse.stdout).toContain("was already active");

      expect(nothingElse.stdout).toContain("EMPTY DIFF, dropped client-side before dispatch");
      expect(nothingElse.stdout).toContain("nothing reached the server");
      expect(nothingElse.stdout).not.toContain("issued the update");
      expect(nothingElse.stdout).toContain("otherActiveBefore: (none)");
      expect(nothingElse.stdout).toContain("deactivated by this activation: (none)");
    });

    it("prints reset-initiative's pre-read count and set-initiative's null clear", async () => {
      const reset = await runCommand(
        ["combat", "reset-initiative", "--combat-id", "combat-1"],
        respond({
          combatId: "combat-1",
          reset: true,
          changedCount: 2,
          combat: {
            id: "combat-1",
            round: 2,
            turn: 0,
            started: true,
            combatantCount: 3,
            groupCount: 0,
            turns: []
          }
        })
      );
      expect(reset.stdout).toContain("Cleared initiative on combat combat-1");
      expect(reset.stdout).toContain("reset: true");

      expect(reset.stdout).toContain("changedCount: 2");

      const cleared = await runCommand(
        [
          "combat",
          "set-initiative",
          "--combat-id",
          "combat-1",
          "--combatant-id",
          "cmb-1",
          "--clear-initiative"
        ],
        respond({
          combatId: "combat-1",
          combatantId: "cmb-1",
          initiativeBefore: 17,
          initiative: null,
          changed: true,
          combatant: { id: "cmb-1", combatId: "combat-1", name: "Hero", initiative: null },
          combat: { id: "combat-1", round: 2, turn: 0, started: true, combatantCount: 3, groupCount: 0 },
          combatSceneUnlinked: false,
          groupInitiativeChanges: []
        })
      );
      expect(cleared.stdout).toContain("Set initiative of combatant cmb-1 to null");
      expect(cleared.stdout).toContain("initiativeBefore: 17");
      expect(cleared.stdout).toContain("changed: true");
    });

    it("prints the UNCONFIRMABLE rows on their own line even when a provable drop won the failure ladder", async () => {
      const mixed = await runCommand(
        [
          "combat",
          "roll-initiative",
          "--combat-id",
          "combat-1",
          "--idempotency-key",
          "k",
          "--combatant-ids",
          "a,b"
        ],
        respond({
          combatId: "combat-1",
          complete: false,
          mutation: "unknown",
          select: "ids",
          targetedCombatantIds: ["a", "b"],
          rolled: [],
          unconfirmedCombatantIds: ["a"],
          unconfirmableCombatantIds: ["b"],
          chatMessages: { status: "captured", expectedCount: 2, ids: ["msg-1", "msg-2"] },

          failure: {
            code: "INTERNAL_ERROR",
            message:
              "Initiative did not land for combatant(s) a; Foundry dropped those rows from the batch silently."
          },
          combat: {
            id: "combat-1",
            round: 1,
            turn: 0,
            started: true,
            combatantCount: 2,
            groupCount: 0,
            turns: []
          },
          combatSceneUnlinked: false,
          groupInitiativeChanges: []
        })
      );
      expect(mixed.stdout).toContain("NOT stored for: a");
      expect(mixed.stdout).toContain("cannot be CONFIRMED for: b");

      expect(mixed.stdout).toContain("NOT a report that the roll failed");
      expect(mixed.stdout).toContain("combat reset-initiative");
      expect(mixed.stdout).toContain("mutation: unknown");

      const clean = await runCommand(
        [
          "combat",
          "roll-initiative",
          "--combat-id",
          "combat-1",
          "--idempotency-key",
          "k",
          "--combatant-ids",
          "a"
        ],
        respond({
          combatId: "combat-1",
          complete: true,
          mutation: "committed",
          select: "ids",
          targetedCombatantIds: ["a"],
          rolled: [{ combatantId: "a", initiativeBefore: null, initiative: 14 }],
          unconfirmedCombatantIds: [],
          unconfirmableCombatantIds: [],
          chatMessages: { status: "captured", expectedCount: 1, ids: ["msg-1"] },
          combat: {
            id: "combat-1",
            round: 1,
            turn: 0,
            started: true,
            combatantCount: 1,
            groupCount: 0,
            turns: []
          },
          combatSceneUnlinked: false,
          groupInitiativeChanges: []
        })
      );
      expect(clean.stdout).toContain("mutation: committed");

      expect(clean.stdout).toContain("a\t -> 14");
      expect(clean.stdout).not.toContain("cannot be CONFIRMED");
      expect(clean.stdout).not.toContain("NOT stored for");

      expect(clean.stdout).not.toContain("is the bridge's approximation");
      expect(clean.stdout).not.toContain("are SKIPPED by `--all`/`--npc`");
    });

    it("prints the --all/--npc approximation notes on the real path only", async () => {
      const all = await runCommand(
        ["combat", "roll-initiative", "--combat-id", "combat-1", "--idempotency-key", "k", "--all"],
        respond({
          combatId: "combat-1",
          complete: true,
          mutation: "committed",
          select: "all",
          targetedCombatantIds: ["a", "b"],
          rolled: [{ combatantId: "a", initiativeBefore: null, initiative: 9 }],
          unconfirmedCombatantIds: [],
          unconfirmableCombatantIds: [],
          chatMessages: { status: "captured", expectedCount: 1, ids: ["msg-1"] },
          combat: {
            id: "combat-1",
            round: 1,
            turn: 0,
            started: true,
            combatantCount: 2,
            groupCount: 1,
            turns: []
          },
          combatSceneUnlinked: false,
          groupInitiativeChanges: []
        })
      );
      expect(all.stdout).toContain("is the bridge's approximation");
      expect(all.stdout).toContain("are SKIPPED by `--all`/`--npc`");

      const preview = await runCommand(
        [
          "--dry-run",
          "combat",
          "roll-initiative",
          "--combat-id",
          "combat-1",
          "--idempotency-key",
          "k",
          "--all"
        ],
        respond({
          combatId: "combat-1",
          complete: true,
          mutation: "not-executed",
          select: "all",
          targetedCombatantIds: ["a", "b"],
          rolled: [],
          unconfirmedCombatantIds: [],
          unconfirmableCombatantIds: [],
          chatMessages: { status: "not-executed", expectedCount: 0, ids: [] },
          combat: {
            id: "combat-1",
            round: 1,
            turn: 0,
            started: true,
            combatantCount: 2,
            groupCount: 1,
            turns: []
          },
          combatSceneUnlinked: false,
          groupInitiativeChanges: [],
          dryRun: true
        })
      );
      expect(preview.stdout).toContain("no dice were rolled");
      expect(preview.stdout).not.toContain("is the bridge's approximation");
      expect(preview.stdout).not.toContain("are SKIPPED by `--all`/`--npc`");
    });

    it("prints EVERY row of the roll-initiative report, and its parent-state footer", async () => {
      const rolled = await runCommand(
        [
          "combat",
          "roll-initiative",
          "--combat-id",
          "combat-1",
          "--idempotency-key",
          "k",
          "--combatant-ids",
          "a,b"
        ],
        respond({
          combatId: "combat-1",
          complete: false,
          mutation: "unknown",
          select: "ids",
          targetedCombatantIds: ["a", "b"],
          rolled: [{ combatantId: "a", initiativeBefore: null, initiative: 14 }],
          unconfirmedCombatantIds: ["b"],
          unconfirmableCombatantIds: [],
          chatMessages: { status: "captured", expectedCount: 2, ids: ["msg-1", "msg-2"] },
          failure: {
            code: "INTERNAL_ERROR",
            message: "Initiative did not land for combatant(s) b; Foundry dropped those rows silently."
          },

          combat: {
            id: "combat-1",
            round: 4,
            turn: 2,
            started: true,
            scene: null,
            combatantCount: 2,
            groupCount: 1,
            turns: []
          },
          combatSceneUnlinked: true,
          groupInitiativeChanges: [{ groupId: "grp-1", initiativeBefore: null, initiativeAfter: 14 }]
        })
      );

      expect(rolled.stdout).toContain("combat combat-1: rolled initiative");
      expect(rolled.stdout).toContain("complete: false");
      expect(rolled.stdout).toContain("mutation: unknown");
      expect(rolled.stdout).toContain("select: ids");
      expect(rolled.stdout).toContain("targeted (2): a, b");
      expect(rolled.stdout).toContain("chat: captured (expected 2, captured 2)");

      expect(rolled.stdout).toContain("chat ids: msg-1, msg-2");
      expect(rolled.stdout).toContain(
        "failure: INTERNAL_ERROR — Initiative did not land for combatant(s) b; Foundry dropped those rows silently."
      );
      expect(rolled.stdout).toContain("rolled (1):");
      expect(rolled.stdout).toContain("a\t -> 14");

      expect(rolled.stdout).toContain("combat: round=4 turn=2 started=true scene= combatants=2 groups=1");
      expect(rolled.stdout).toContain("unlinked the combat from its scene");
      expect(rolled.stdout).toContain("changed group grp-1's initiative: null -> 14");
    });

    it("prints set-initiative's combatant projection AND its parent-state footer", async () => {
      const set = await runCommand(
        [
          "combat",
          "set-initiative",
          "--combat-id",
          "combat-1",
          "--combatant-id",
          "cmb-set",
          "--initiative",
          "12"
        ],
        respond({
          combatId: "combat-1",
          combatantId: "cmb-set",
          initiativeBefore: null,
          initiative: 12,
          changed: true,
          combatant: {
            id: "cmb-set",
            combatId: "combat-1",
            name: "Hero",
            type: "base",
            img: null,
            initiative: 12,
            hidden: false,
            defeated: false,
            group: "grp-set",
            actorId: "act-set",
            tokenId: "tok-set",
            sceneId: "scn-set",
            roundJoined: 2
          },
          combat: {
            id: "combat-1",
            round: 5,
            turn: 1,
            started: true,
            scene: null,
            combatantCount: 3,
            groupCount: 2
          },
          combatSceneUnlinked: true,
          groupInitiativeChanges: [{ groupId: "grp-set", initiativeBefore: 3, initiativeAfter: 12 }]
        })
      );
      expect(set.stdout).toContain("Set initiative of combatant cmb-set to 12");

      expect(set.stdout).toContain("tokenId: tok-set");
      expect(set.stdout).toContain("sceneId: scn-set");
      expect(set.stdout).toContain("roundJoined: 2");

      expect(set.stdout).toContain("combat: round=5 turn=1 started=true scene= combatants=3 groups=2");
      expect(set.stdout).toContain("unlinked the combat from its scene");
      expect(set.stdout).toContain("changed group grp-set's initiative: 3 -> 12");
    });

    it("prints the full combat projection at EACH of the four verbs that return one", async () => {
      const body = (currentCombatantId: string) => ({
        id: "combat-1",
        name: "Boss",
        type: "base",
        scene: "scn-1",
        active: true,
        round: 6,
        turn: 1,
        started: true,
        currentCombatantId,
        sort: 100,
        combatantCount: 3,
        groupCount: 1,
        turns: []
      });

      const start = await runCommand(
        ["combat", "start", "--combat-id", "combat-1"],
        respond({
          combatId: "combat-1",
          started: true,
          alreadyStarted: false,
          transition: "round",
          roundBefore: 0,
          turnBefore: null,
          combat: body("cur-start")
        })
      );
      expect(start.stdout).toContain("currentCombatantId: cur-start");
      expect(start.stdout).toContain("turns: 3");

      const activate = await runCommand(
        ["combat", "activate", "--combat-id", "combat-1"],
        respond({
          combatId: "combat-1",
          active: true,
          alreadyActive: false,
          otherActiveCombatIdsBefore: [],
          otherActiveCombatIdsAfter: [],
          deactivatedCombatIds: [],
          combat: body("cur-activate")
        })
      );
      expect(activate.stdout).toContain("currentCombatantId: cur-activate");
      expect(activate.stdout).toContain("turns: 3");

      const advanced = await runCommand(
        ["combat", "next-turn", "--combat-id", "combat-1", "--idempotency-key", "k"],
        respond({
          combatId: "combat-1",
          transition: "turn",
          roundBefore: 6,
          turnBefore: 0,
          combat: body("cur-advance")
        })
      );
      expect(advanced.stdout).toContain("currentCombatantId: cur-advance");
      expect(advanced.stdout).toContain("turns: 3");

      const reset = await runCommand(
        ["combat", "reset-initiative", "--combat-id", "combat-1"],
        respond({
          combatId: "combat-1",
          reset: true,
          changedCount: 2,
          combat: body("cur-reset")
        })
      );
      expect(reset.stdout).toContain("currentCombatantId: cur-reset");
      expect(reset.stdout).toContain("turns: 3");
    });
  });
});
