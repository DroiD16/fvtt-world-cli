import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";

import {
  ERROR_CODES,
  COMBAT_INITIATIVE_MODES,
  COMBAT_MUTATION_OUTCOMES,
  COMBAT_TRANSITIONS
} from "../scripts/generated/protocol.js";

import {
  COMBAT_GROUP_A,
  COMBAT_SCENE_A,
  COMBAT_SCENE_B,
  COMBAT_SCENE_C,
  createCombatDocument,
  createCombatantDocument,
  createRequest,
  installFakeFoundry
} from "./helpers/fake-foundry.js";

describe("command router", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  describe("combat.* world-document CRUD", () => {
    const router = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    it("combat.list returns lean summaries with both collection counts and no turn bodies", async () => {
      const response = await router().route(createRequest("combat.list"));
      expect(response.ok).toBe(true);
      expect(response.result.total).toBe(2);
      const [first, second] = response.result.combats;
      expect(first).toEqual({
        id: "combat-1",
        _id: "combat-1",

        name: null,
        scene: COMBAT_SCENE_A,
        active: true,
        round: 2,
        turn: 0,
        started: true,
        combatantCount: 2,
        groupCount: 1
      });
      expect(second.id).toBe("combat-2");
      expect(second.started).toBe(false);
      expect(second.combatantCount).toBe(0);

      expect(first.turns).toBeUndefined();
    });

    it("combat.get reports Foundry's OWN turn order and never re-sorts by initiative", async () => {
      const response = await router().route(createRequest("combat.get", { combatId: "combat-1" }));
      expect(response.ok).toBe(true);
      const combat = response.result.combat;

      expect(combat.turns.map((turn) => turn.id)).toEqual(["combatant-2", "combatant-1"]);
      expect(combat.currentCombatantId).toBe("combatant-2");
      expect(combat.combatantCount).toBe(2);
      expect(combat.groupCount).toBe(1);
      expect(combat.started).toBe(true);

      expect(combat.scene).toBe(COMBAT_SCENE_A);
      expect(typeof combat.scene).toBe("string");

      expect(Object.hasOwn(combat, "ownership")).toBe(false);
      expect(Object.hasOwn(combat, "folder")).toBe(false);
    });

    it("combat.get keeps a turn order that CONTRADICTS a re-sort by initiative", async () => {
      const tiebreak = createCombatDocument("combat-tiebreak", {
        scene: COMBAT_SCENE_A,
        round: 1,
        turn: 1,
        groups: [{ id: "pack-1", name: "Wolves", initiative: 20 }],
        combatants: [
          {
            id: "tiebreak-a",
            name: "Aarakocra",
            sceneId: COMBAT_SCENE_A,
            initiative: 10,
            group: "pack-1",
            derived: { initiative: 20, group: { id: "pack-1", name: "Wolves" } }
          },
          { id: "tiebreak-b", name: "Bandit", sceneId: COMBAT_SCENE_A, initiative: 20 },
          { id: "tiebreak-c", name: "Cultist", sceneId: COMBAT_SCENE_A, initiative: -3 },
          { id: "tiebreak-d", name: "Drudge", sceneId: COMBAT_SCENE_A }
        ],
        turnOrder: ["tiebreak-a", "tiebreak-b", "tiebreak-c", "tiebreak-d"]
      });
      globalThis.game.combats.set(tiebreak);

      const response = await router().route(createRequest("combat.get", { combatId: "combat-tiebreak" }));
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      const combat = response.result.combat;
      expect(combat.turns.map((turn) => turn.id)).toEqual([
        "tiebreak-a",
        "tiebreak-b",
        "tiebreak-c",
        "tiebreak-d"
      ]);

      expect(combat.turns.map((turn) => turn.initiative)).toEqual([10, 20, -3, null]);
      expect(combat.currentCombatantId).toBe("tiebreak-b");
    });

    it("derives currentCombatantId from the REPORTED turn, not Foundry's live one", async () => {
      const drifted = createCombatDocument("combat-drifted", {
        scene: COMBAT_SCENE_A,
        round: 0,
        turn: 3,

        derivedTurn: 0,
        derivedRound: 1,
        combatants: [
          { id: "drift-1", name: "First", sceneId: COMBAT_SCENE_A, initiative: 12 },
          { id: "drift-2", name: "Second", sceneId: COMBAT_SCENE_A, initiative: 4 }
        ],
        turnOrder: ["drift-1", "drift-2"]
      });
      globalThis.game.combats.set(drifted);

      expect(drifted.turn).toBe(0);
      expect(drifted.combatant.id).toBe("drift-1");
      expect(drifted.toObject().turn).toBe(3);

      const drift = await router().route(createRequest("combat.get", { combatId: "combat-drifted" }));
      expect(drift.ok, JSON.stringify(drift.error ?? {})).toBe(true);
      expect(drift.result.combat.turn).toBe(3);
      expect(drift.result.combat.round).toBe(0);
      expect(drift.result.combat.started).toBe(false);
      expect(drift.result.combat.turns).toHaveLength(2);

      expect(drift.result.combat.currentCombatantId).toBeNull();

      const unstarted = createCombatDocument("combat-unstarted", {
        scene: COMBAT_SCENE_A,
        combatants: [{ id: "waiting-1", name: "Waiting", sceneId: COMBAT_SCENE_A }]
      });
      globalThis.game.combats.set(unstarted);
      const idle = await router().route(createRequest("combat.get", { combatId: "combat-unstarted" }));
      expect(idle.ok).toBe(true);
      expect(idle.result.combat.turn).toBeNull();
      expect(idle.result.combat.turns).toHaveLength(1);
      expect(idle.result.combat.currentCombatantId).toBeNull();
    });

    it("combat.list and combat.get AGREE on a combat whose STORED turn is out of range", async () => {
      const drifted = createCombatDocument("combat-drifted", {
        scene: COMBAT_SCENE_A,
        round: 0,
        turn: 3,

        derivedTurn: 0,
        derivedRound: 1,
        combatants: [
          { id: "drift-1", name: "First", sceneId: COMBAT_SCENE_A, initiative: 12 },
          { id: "drift-2", name: "Second", sceneId: COMBAT_SCENE_A, initiative: 4 }
        ],
        turnOrder: ["drift-1", "drift-2"]
      });
      globalThis.game.combats.set(drifted);

      expect([drifted.round, drifted.turn]).toEqual([1, 0]);
      expect([drifted.toObject().round, drifted.toObject().turn]).toEqual([0, 3]);

      const list = await router().route(createRequest("combat.list"));
      expect(list.ok, JSON.stringify(list.error ?? {})).toBe(true);
      const row = list.result.combats.find((combat) => combat.id === "combat-drifted");

      expect(row).toMatchObject({ round: 0, turn: 3, started: false });

      const got = await router().route(createRequest("combat.get", { combatId: "combat-drifted" }));
      expect(got.ok, JSON.stringify(got.error ?? {})).toBe(true);
      const combat = got.result.combat;
      expect(combat).toMatchObject({ round: 0, turn: 3, started: false });

      expect([row.round, row.turn, row.started]).toEqual([combat.round, combat.turn, combat.started]);
    });

    it("reports the STORED combat `name` on both reads when derived data overwrote the accessor", async () => {
      const labelled = createCombatDocument("combat-labelled", {
        name: "Stored label",
        scene: COMBAT_SCENE_A,
        round: 1,
        turn: 0,
        combatants: [{ id: "label-1", name: "Solo", sceneId: COMBAT_SCENE_A, initiative: 7 }],
        turnOrder: ["label-1"]
      });

      Object.defineProperty(labelled, "name", {
        value: "Derived label",
        enumerable: false,
        configurable: true,
        writable: true
      });

      expect(labelled.name).toBe("Derived label");
      expect(labelled.toObject().name).toBe("Stored label");
      globalThis.game.combats.set(labelled);

      const got = await router().route(createRequest("combat.get", { combatId: "combat-labelled" }));
      expect(got.ok, JSON.stringify(got.error ?? {})).toBe(true);
      expect(got.result.combat.name).toBe("Stored label");

      const list = await router().route(createRequest("combat.list"));
      expect(list.ok).toBe(true);
      expect(list.result.combats.find((combat) => combat.id === "combat-labelled").name).toBe("Stored label");
    });

    it("combat.get reads the five derived-over-source combatant fields from SOURCE", async () => {
      const response = await router().route(createRequest("combat.get", { combatId: "combat-1" }));
      const derived = response.result.combat.turns.find((turn) => turn.id === "combatant-2");

      expect(derived.name).toBe("");
      expect(derived.img).toBeNull();
      expect(derived.actorId).toBeNull();
      expect(derived.initiative).toBe(20);
      expect(derived.group).toBe(COMBAT_GROUP_A);
    });

    it('reports a combatant with NO stored name as `""`, never null (the field is not nullable)', async () => {
      const nameless = createCombatDocument("combat-nameless", {
        combatants: [{ id: "nameless-1", tokenId: "token-z", sceneId: COMBAT_SCENE_A }]
      });
      globalThis.game.combats.set(nameless);

      const source = nameless.combatants.get("nameless-1").toObject();
      expect(Object.hasOwn(source, "name")).toBe(true);
      expect(source.name).toBeUndefined();

      const response = await router().route(createRequest("combat.get", { combatId: "combat-nameless" }));
      expect(response.ok).toBe(true);
      const [row] = response.result.combat.turns;
      expect(row.name).toBe("");

      expect(row.img).toBeNull();
      expect(row.actorId).toBeNull();
      expect(row.initiative).toBeNull();
      expect(row.group).toBeNull();
    });

    it("combat.get returns COMBAT_NOT_FOUND for an unknown id", async () => {
      const response = await router().route(createRequest("combat.get", { combatId: "nope" }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMBAT_NOT_FOUND);
      expect(response.error.message).toContain("combat.list");
    });

    it("combat.create creates an EMPTY unstarted combat and applies Foundry's defaults", async () => {
      const response = await router().route(
        createRequest("combat.create", { data: { scene: COMBAT_SCENE_A, sort: 3 } })
      );
      expect(response.ok).toBe(true);
      expect(globalThis.Combat.create).toHaveBeenCalledTimes(1);
      const combat = response.result.combat;
      expect(combat.id).toBe("combat-created");
      expect(combat.scene).toBe(COMBAT_SCENE_A);
      expect(combat.active).toBe(false);
      expect(combat.round).toBe(0);
      expect(combat.turn).toBeNull();
      expect(combat.started).toBe(false);
      expect(combat.combatantCount).toBe(0);
      expect(combat.turns).toEqual([]);
    });

    it("combat.create --dry-run persists nothing and fabricates no id", async () => {
      const response = await router().route(
        createRequest("combat.create", { data: { scene: COMBAT_SCENE_A }, dryRun: true })
      );
      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(globalThis.Combat.create).not.toHaveBeenCalled();

      expect(response.result.combat.id).toBeNull();
      expect(response.result.combat._id).toBeNull();
      expect(response.result.combat.scene).toBe(COMBAT_SCENE_A);
    });

    it("combat.create validates a COPY of the payload (strict construction mutates its input)", async () => {
      const data = { scene: COMBAT_SCENE_A };
      await router().route(createRequest("combat.create", { data }));

      expect(Object.keys(data)).toEqual(["scene"]);
    });

    it("combat.update writes the patch and re-reads the stored state", async () => {
      const response = await router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { sort: 9 } })
      );
      expect(response.ok).toBe(true);
      expect(response.result.combat.sort).toBe(9);
      expect(globalThis.game.combats.get("combat-1").update).toHaveBeenCalledWith(
        { sort: 9 },
        { diff: true, render: true }
      );
    });

    it("combat.update --dry-run previews the merge without writing", async () => {
      const response = await router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { sort: 42 }, dryRun: true })
      );
      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result.combat.sort).toBe(42);
      expect(globalThis.game.combats.get("combat-1").update).not.toHaveBeenCalled();
      expect(globalThis.game.combats.get("combat-1").sort).toBe(5);
    });

    it("combat.update dry-run returns the SAME body shape as the real call (key parity)", async () => {
      const dry = await router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { sort: 7 }, dryRun: true })
      );
      const real = await router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { sort: 7 } })
      );

      expect(Object.keys(dry.result.combat).sort()).toEqual(Object.keys(real.result.combat).sort());
      expect(Object.keys(dry.result).sort()).toEqual([...Object.keys(real.result), "dryRun"].sort());
      expect(dry.result.combat.turns.map((turn) => turn.id)).toEqual(
        real.result.combat.turns.map((turn) => turn.id)
      );

      expect(dry.result.combat.turns.map((turn) => turn.id)).toEqual(["combatant-2", "combatant-1"]);
    });

    it("combat.update --dry-run keeps the LIVE turn order when the preview's data preparation did not run", async () => {
      const degraded = createCombatDocument("combat-degraded", {
        scene: COMBAT_SCENE_A,
        round: 1,
        turn: 0,
        combatants: [
          { id: "slow-1", name: "Slow", sceneId: COMBAT_SCENE_A, initiative: 3 },
          { id: "fast-2", name: "Fast", sceneId: COMBAT_SCENE_A, initiative: 25 }
        ],

        turnOrder: ["fast-2", "slow-1"],

        clonesWithoutPreparedTurns: true
      });
      globalThis.game.combats.set(degraded);
      const dry = await router().route(
        createRequest("combat.update", { combatId: "combat-degraded", patch: { sort: 3 }, dryRun: true })
      );
      expect(dry.ok, JSON.stringify(dry.error ?? {})).toBe(true);
      expect(dry.result.combat.turns.map((turn) => turn.id)).toEqual(["fast-2", "slow-1"]);
      expect(dry.result.combat.currentCombatantId).toBe("fast-2");
      // Dropping `turnOrderFrom` makes this report COLLECTION order (["slow-1","fast-2"]) — and, since
      // `currentCombatantId` is indexed out of the reported rows, it would name "slow-1" instead.
    });

    it("combat.update REFUSES a scene that does not contain every combatant (both paths)", async () => {
      for (const params of [
        { combatId: "combat-1", patch: { scene: COMBAT_SCENE_B } },
        { combatId: "combat-1", patch: { scene: COMBAT_SCENE_B }, dryRun: true }
      ]) {
        const response = await router().route(createRequest("combat.update", params));
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.COMBAT_SCENE_MISMATCH);

        expect(response.error.details.combatants).toEqual([
          { combatantId: "combatant-1", sceneId: COMBAT_SCENE_A },
          { combatantId: "combatant-2", sceneId: COMBAT_SCENE_A }
        ]);
        expect(response.error.details.scene).toBe(COMBAT_SCENE_B);
      }

      expect(globalThis.game.combats.get("combat-1").update).not.toHaveBeenCalled();
    });

    it("the scene guard does NOT over-refuse: unlink, same-scene, and null-sceneId combatants pass", async () => {
      const unlink = await router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { scene: null } })
      );
      expect(unlink.ok).toBe(true);
      expect(unlink.result.combat.scene).toBeNull();

      const same = await router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { scene: COMBAT_SCENE_A } })
      );
      expect(same.ok).toBe(true);

      const sceneless = createCombatDocument("combat-sceneless", {
        combatants: [{ id: "sceneless-1", name: "Ghost" }]
      });
      globalThis.game.combats.set(sceneless);
      const ok = await router().route(
        createRequest("combat.update", { combatId: "combat-sceneless", patch: { scene: COMBAT_SCENE_B } })
      );
      expect(ok.ok).toBe(true);
      expect(ok.result.combat.scene).toBe(COMBAT_SCENE_B);
    });

    it("leaves a scene id still MALFORMED AFTER CLEANING to FOUNDRY (INVALID_PARAMS), never COMBAT_SCENE_MISMATCH", async () => {
      const combat = globalThis.game.combats.get("combat-1");

      combat.update = vi.fn(async () => undefined);
      for (const params of [
        { combatId: "combat-1", patch: { scene: "short" } },
        { combatId: "combat-1", patch: { scene: "short" }, dryRun: true }
      ]) {
        const response = await router().route(createRequest("combat.update", params));
        expect(response.ok, JSON.stringify(response.result ?? {})).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
        expect(response.error.details.reason).toBe("foundry_validation");
        expect(response.error.details.message).toContain("16-character alphanumeric ID");
      }

      const mismatch = await router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { scene: COMBAT_SCENE_B } })
      );
      expect(mismatch.ok).toBe(false);
      expect(mismatch.error.code).toBe(ERROR_CODES.COMBAT_SCENE_MISMATCH);
    });

    const PADDED_SCENE_B = `  ${COMBAT_SCENE_B}  `;
    const PADDED_SCENE_A = `\t${COMBAT_SCENE_A}\n`;

    it("cleans the scene id before testing it: a PADDED valid id is the named mismatch (both paths)", async () => {
      for (const params of [
        { combatId: "combat-1", patch: { scene: PADDED_SCENE_B } },
        { combatId: "combat-1", patch: { scene: PADDED_SCENE_B }, dryRun: true }
      ]) {
        const response = await router().route(createRequest("combat.update", params));
        expect(response.ok, JSON.stringify(response.result ?? {})).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.COMBAT_SCENE_MISMATCH);

        expect(response.error.details.scene).toBe(COMBAT_SCENE_B);
        expect(response.error.details.combatants).toEqual([
          { combatantId: "combatant-1", sceneId: COMBAT_SCENE_A },
          { combatantId: "combatant-2", sceneId: COMBAT_SCENE_A }
        ]);
      }
      expect(globalThis.game.combats.get("combat-1").update).not.toHaveBeenCalled();
    });

    it("cleaning does NOT over-refuse: a PADDED id every combatant already sits on is allowed", async () => {
      const response = await router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { scene: PADDED_SCENE_A } })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);

      expect(globalThis.game.combats.get("combat-1").update).toHaveBeenCalledWith(
        { scene: PADDED_SCENE_A },
        { diff: true, render: true }
      );
    });

    it("both arms hold on the defensive trim fallback too (a target with no reachable schema field)", async () => {
      const fallback = createCombatDocument("combat-noschema", {
        scene: COMBAT_SCENE_A,
        combatants: [{ id: "noschema-1", name: "Guard", sceneId: COMBAT_SCENE_A }]
      });
      Object.defineProperty(fallback, "schema", { value: undefined, configurable: true });
      globalThis.game.combats.set(fallback);

      const refused = await router().route(
        createRequest("combat.update", { combatId: "combat-noschema", patch: { scene: PADDED_SCENE_B } })
      );
      expect(refused.ok).toBe(false);
      expect(refused.error.code).toBe(ERROR_CODES.COMBAT_SCENE_MISMATCH);
      expect(refused.error.details.scene).toBe(COMBAT_SCENE_B);

      const allowed = await router().route(
        createRequest("combat.update", { combatId: "combat-noschema", patch: { scene: PADDED_SCENE_A } })
      );
      expect(allowed.ok, JSON.stringify(allowed.error ?? {})).toBe(true);
    });

    it("combat.update maps Foundry's OWN _preUpdate throw when the race makes the guard true", async () => {
      const raced = createCombatDocument("combat-raced", {
        combatants: [{ id: "raced-1", name: "Late", sceneId: COMBAT_SCENE_A }]
      });

      raced.update = vi.fn(async () => {
        raced.combatants.set(
          createCombatantDocument("raced-2", { name: "Newcomer", sceneId: COMBAT_SCENE_C })
        );
        throw new Error("You cannot link the Combat to a Scene that doesn't contain all its Combatants.");
      });
      globalThis.game.combats.set(raced);
      const response = await router().route(
        createRequest("combat.update", { combatId: "combat-raced", patch: { scene: COMBAT_SCENE_A } })
      );
      expect(response.ok).toBe(false);

      expect(response.error.code).toBe(ERROR_CODES.COMBAT_SCENE_MISMATCH);
      expect(response.error.details.combatants).toEqual([
        { combatantId: "raced-2", sceneId: COMBAT_SCENE_C }
      ]);
    });

    it("combat.update RETHROWS an unrelated Foundry error instead of blaming the scene guard", async () => {
      const broken = createCombatDocument("combat-broken", {});
      broken.update = vi.fn(async () => {
        throw new Error("something else entirely");
      });
      globalThis.game.combats.set(broken);
      const response = await router().route(
        createRequest("combat.update", { combatId: "combat-broken", patch: { scene: COMBAT_SCENE_A } })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).not.toBe(ERROR_CODES.COMBAT_SCENE_MISMATCH);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    });

    it("combat.update projects from the HELD document when the combat VANISHES before the re-read", async () => {
      const vanishing = createCombatDocument("combat-vanishing", {
        scene: COMBAT_SCENE_A,
        sort: 5,
        round: 1,
        turn: 0,
        combatants: [{ id: "vanish-1", name: "Doomed", sceneId: COMBAT_SCENE_A, initiative: 11 }],
        turnOrder: ["vanish-1"]
      });
      vanishing.update = vi.fn(async (patch) => {
        Object.assign(vanishing, patch);
        globalThis.game.combats.delete("combat-vanishing");

        return vanishing;
      });
      globalThis.game.combats.set(vanishing);

      const response = await router().route(
        createRequest("combat.update", { combatId: "combat-vanishing", patch: { sort: 9 } })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);

      expect(response.result.combat.id).toBe("combat-vanishing");
      expect(response.result.combat.sort).toBe(9);
      expect(response.result.combat.turns.map((turn) => turn.id)).toEqual(["vanish-1"]);

      expect(globalThis.game.combats.get("combat-vanishing")).toBeNull();
    });

    it("still surfaces an UNRELATED Foundry error when the combat is gone by the time the catch runs", async () => {
      const broken = createCombatDocument("combat-vanished-broken", {});
      broken.update = vi.fn(async () => {
        globalThis.game.combats.delete("combat-vanished-broken");
        throw new Error("something else entirely");
      });
      globalThis.game.combats.set(broken);

      const response = await router().route(
        createRequest("combat.update", {
          combatId: "combat-vanished-broken",
          patch: { scene: COMBAT_SCENE_A }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.code).not.toBe(ERROR_CODES.COMBAT_NOT_FOUND);

      expect(response.error.code).not.toBe(ERROR_CODES.COMBAT_SCENE_MISMATCH);
    });

    it("combat.update REFUSES to report a vetoed write as success (falsy resolve + non-empty diff)", async () => {
      const vetoed = globalThis.game.combats.get("combat-1");
      vetoed.update = vi.fn(async () => undefined);
      const response = await router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { sort: 99 } })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("preUpdateCombat");

      expect(response.error.message).toContain("Combat Tracker");
      expect(response.error.details.fields).toEqual(["sort"]);
    });

    it("combat.update accepts a NO-OP patch (an empty diff is not a veto)", async () => {
      const combat = globalThis.game.combats.get("combat-1");

      combat.update = vi.fn(async () => undefined);
      const response = await router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { sort: 5 } })
      );
      expect(response.ok).toBe(true);
      expect(response.result.combat.sort).toBe(5);
    });

    it("combat.delete's activation report is a LOWER BOUND: Foundry's activation lands after the response", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const other = globalThis.game.combats.get("combat-2");
      let activationLanded = () => {};
      const activated = new Promise((resolve) => {
        activationLanded = () => resolve(undefined);
      });
      combat.delete = vi.fn(async () => {
        globalThis.game.combats.delete("combat-1");

        setTimeout(() => {
          other.active = true;
          other._source.active = true;
          activationLanded();
        }, 0);
        return combat;
      });
      const response = await router().route(createRequest("combat.delete", { combatId: "combat-1" }));
      expect(response.ok).toBe(true);

      expect(globalThis.game.combats.get("combat-1")).toBeNull();
      expect(response.result).toEqual({
        id: "combat-1",
        deleted: true,
        otherActiveCombatIdsBefore: [],

        otherActiveCombatIdsAfter: [],
        activatedCombatIds: [],
        activationObservation: "not-observable-at-return-time"
      });

      await activated;
      expect(globalThis.game.combats.get("combat-2").active).toBe(true);
    });

    it("combat.delete DOES report an activation that is already visible when the delete resolves", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const other = globalThis.game.combats.get("combat-2");
      combat.delete = vi.fn(async () => {
        globalThis.game.combats.delete("combat-1");
        await new Promise((resolve) => setTimeout(resolve, 0));
        other.active = true;
        other._source.active = true;
        return combat;
      });
      const response = await router().route(createRequest("combat.delete", { combatId: "combat-1" }));
      expect(response.ok).toBe(true);
      expect(response.result.otherActiveCombatIdsAfter).toEqual(["combat-2"]);
      expect(response.result.activatedCombatIds).toEqual(["combat-2"]);

      expect(response.result.activationObservation).toBe("not-observable-at-return-time");
    });

    it("combat.delete --dry-run deletes nothing and predicts no activation", async () => {
      const response = await router().route(
        createRequest("combat.delete", { combatId: "combat-1", dryRun: true })
      );
      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result.deleted).toBe(false);

      expect(response.result.activatedCombatIds).toEqual([]);
      expect(response.result.otherActiveCombatIdsAfter).toEqual(response.result.otherActiveCombatIdsBefore);

      expect(response.result.activationObservation).toBe("not-observable-at-return-time");
      expect(globalThis.game.combats.get("combat-1").delete).not.toHaveBeenCalled();

      const real = await router().route(createRequest("combat.delete", { combatId: "combat-1" }));
      expect(real.ok).toBe(true);
      expect(Object.keys(response.result).sort()).toEqual(
        [...Object.keys(real.result), "dryRun", "approvalRequired"].sort()
      );
    });

    it("combat.delete REFUSES to report a vetoed delete as success", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      combat.delete = vi.fn(async () => undefined);
      const response = await router().route(createRequest("combat.delete", { combatId: "combat-1" }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("preDeleteCombat");
      expect(response.error.message).toContain("Combat Tracker");
      expect(globalThis.game.combats.get("combat-1")).toBeTruthy();
    });

    it("REJECTS a supplied `name` on a v13 core, on create AND update, real AND dry-run", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      for (const request of [
        createRequest("combat.create", { data: { name: "Boss fight" } }),
        createRequest("combat.create", { data: { name: "Boss fight" }, dryRun: true }),
        createRequest("combat.update", { combatId: "combat-1", patch: { name: "Boss fight" } }),
        createRequest("combat.update", { combatId: "combat-1", patch: { name: "Boss fight" }, dryRun: true })
      ]) {
        const response = await router().route(request);
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
        expect(response.error.details.fields).toEqual(["name"]);
        expect(response.error.details.generation).toBe(13);
        expect(response.error.message).toContain("v14");
      }
      expect(globalThis.Combat.create).not.toHaveBeenCalled();
      expect(globalThis.game.combats.get("combat-1").update).not.toHaveBeenCalled();
    });

    it("REJECTS a supplied `name` when the generation is UNKNOWN (a v14-only key is dropped silently)", async () => {
      expect(globalThis.game.release).toBeUndefined();
      const response = await router().route(createRequest("combat.create", { data: { name: "Boss fight" } }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.details.generation).toBeNull();
      expect(globalThis.Combat.create).not.toHaveBeenCalled();
    });

    it("rejects a BLANK `name` on v13 too (the gate keys on PRESENCE, not truthiness)", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      const response = await router().route(createRequest("combat.create", { data: { name: "" } }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
    });

    it("ACCEPTS `name` on a v14 core and round-trips it through create and update", async () => {
      globalThis.game.release = { version: "14.365", generation: 14 };
      const created = await router().route(createRequest("combat.create", { data: { name: "Boss fight" } }));
      expect(created.ok).toBe(true);
      expect(created.result.combat.name).toBe("Boss fight");
      const updated = await router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { name: "Renamed" } })
      );
      expect(updated.ok).toBe(true);
      expect(updated.result.combat.name).toBe("Renamed");
    });

    it("leaves every OTHER combat field writable on a v13 core (the gate is name-only)", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      const response = await router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { sort: 8, flags: { x: 1 } } })
      );
      expect(response.ok).toBe(true);
      expect(response.result.combat.sort).toBe(8);
    });

    it("REFUSES a whitespace-only `scene` rather than silently unlinking (create + update, both paths)", async () => {
      for (const request of [
        createRequest("combat.create", { data: { scene: "   " } }),
        createRequest("combat.create", { data: { scene: "   " }, dryRun: true }),
        createRequest("combat.update", { combatId: "combat-1", patch: { scene: "\t\n" } }),
        createRequest("combat.update", { combatId: "combat-1", patch: { scene: "\t\n" }, dryRun: true })
      ]) {
        const response = await router().route(request);
        expect(response.ok, JSON.stringify(response.result ?? {})).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
        expect(response.error.details.fields).toEqual(["scene"]);

        expect(response.error.message).toContain("`scene: null`");
        expect(response.error.message).toContain("--clear-scene");
      }
      expect(globalThis.Combat.create).not.toHaveBeenCalled();
      expect(globalThis.game.combats.get("combat-1").update).not.toHaveBeenCalled();
    });

    it("the blank refusal does NOT swallow the two legitimate shapes (null, and a padded valid id)", async () => {
      const created = await router().route(createRequest("combat.create", { data: { scene: null } }));
      expect(created.ok, JSON.stringify(created.error ?? {})).toBe(true);
      expect(created.result.combat.scene).toBeNull();

      const padded = await router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { scene: PADDED_SCENE_A } })
      );
      expect(padded.ok, JSON.stringify(padded.error ?? {})).toBe(true);
    });

    it("runs the version gate BEFORE the blank-reference refusal (both are INVALID_PARAMS)", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      const response = await router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { name: "X", scene: "   " } })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.details.fields).toEqual(["name"]);
      expect(response.error.details.generation).toBe(13);
    });

    it("runs the version gate BEFORE the scene guard (guard precedence is contract)", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };

      const response = await router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { name: "X", scene: COMBAT_SCENE_B } })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.details.fields).toEqual(["name"]);
    });

    it("serializes concurrent combat mutations (no interleaving between read and write)", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const events = [];
      /** @type {() => void} */
      let release = () => {};
      const gate = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      combat.update = vi.fn(async (patch) => {
        events.push(`update-start:${patch.sort}`);
        if (patch.sort === 1) await gate;
        events.push(`update-end:${patch.sort}`);
        Object.assign(combat, patch);
        return combat;
      });
      const first = router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { sort: 1 } })
      );
      const second = router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { sort: 2 } })
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(events).toEqual(["update-start:1"]);
      release();
      await Promise.all([first, second]);
      expect(events).toEqual(["update-start:1", "update-end:1", "update-start:2", "update-end:2"]);
    });

    it("serializes a delete against an in-flight update of the same combat", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const events = [];
      /** @type {() => void} */
      let release = () => {};
      const gate = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      combat.update = vi.fn(async (patch) => {
        events.push("update-start");
        await gate;
        events.push("update-end");
        Object.assign(combat, patch);
        return combat;
      });
      combat.delete = vi.fn(async () => {
        events.push("delete");
        globalThis.game.combats.delete("combat-1");
        return combat;
      });
      const updating = router().route(
        createRequest("combat.update", { combatId: "combat-1", patch: { sort: 3 } })
      );
      const deleting = router().route(createRequest("combat.delete", { combatId: "combat-1" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(events).toEqual(["update-start"]);
      release();
      const [updateResponse, deleteResponse] = await Promise.all([updating, deleting]);
      expect(events).toEqual(["update-start", "update-end", "delete"]);
      expect(updateResponse.ok).toBe(true);
      expect(deleteResponse.ok).toBe(true);
    });

    it("gates every combat write behind the GM permission check", async () => {
      globalThis.game.user.isGM = false;
      for (const request of [
        createRequest("combat.create", { data: {} }),
        createRequest("combat.update", { combatId: "combat-1", patch: { sort: 1 } }),
        createRequest("combat.delete", { combatId: "combat-1" })
      ]) {
        const response = await router().route(request);
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
      }

      expect((await router().route(createRequest("combat.list"))).error.code).toBe(
        ERROR_CODES.PERMISSION_DENIED
      );
    });
  });

  describe("combat.combatant.* embedded family", () => {
    const router = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const VALID_ID = "aaaaaaaaaa111111";
    const OTHER_ID = "bbbbbbbbbb222222";

    it("combat.combatant.list returns the SAME rows, in the SAME order, as combat.get's turns[]", async () => {
      const list = await router().route(createRequest("combat.combatant.list", { combatId: "combat-1" }));
      const get = await router().route(createRequest("combat.get", { combatId: "combat-1" }));
      expect(list.ok).toBe(true);
      expect(list.result.combatId).toBe("combat-1");
      expect(list.result.total).toBe(2);
      expect(list.result.hasMore).toBe(false);

      expect(list.result.combatants).toEqual(get.result.combat.turns);
      expect(list.result.combatants.map((row) => row.id)).toEqual(["combatant-2", "combatant-1"]);
    });

    it("keeps a NON-MONOTONE turn order on the list too, never a re-sort by initiative", async () => {
      const ordered = createCombatDocument("combat-list-order", {
        scene: COMBAT_SCENE_A,
        round: 1,
        turn: 0,
        groups: [{ id: "listGroupAAAA111", name: "Wolves", initiative: 20 }],
        combatants: [
          { id: "list-c", name: "Cultist", sceneId: COMBAT_SCENE_A, initiative: -3 },
          {
            id: "list-a",
            name: "Aarakocra",
            sceneId: COMBAT_SCENE_A,
            initiative: 10,
            group: "listGroupAAAA111",
            derived: { initiative: 20, group: { id: "listGroupAAAA111", name: "Wolves" } }
          },
          { id: "list-d", name: "Drudge", sceneId: COMBAT_SCENE_A },
          { id: "list-b", name: "Bandit", sceneId: COMBAT_SCENE_A, initiative: 20 }
        ],
        turnOrder: ["list-a", "list-b", "list-c", "list-d"]
      });
      globalThis.game.combats.set(ordered);

      const list = await router().route(
        createRequest("combat.combatant.list", { combatId: "combat-list-order" })
      );
      const get = await router().route(createRequest("combat.get", { combatId: "combat-list-order" }));
      expect(list.ok, JSON.stringify(list.error ?? {})).toBe(true);
      expect(list.result.combatants.map((row) => row.id)).toEqual(["list-a", "list-b", "list-c", "list-d"]);

      expect(list.result.combatants.map((row) => row.initiative)).toEqual([10, 20, -3, null]);

      expect(list.result.combatants).toEqual(get.result.combat.turns);
    });

    it("paginates the combatant list and reports COMBAT_NOT_FOUND for an unknown parent", async () => {
      const page = await router().route(
        createRequest("combat.combatant.list", { combatId: "combat-1", limit: 1 })
      );
      expect(page.result.combatants).toHaveLength(1);
      expect(page.result.total).toBe(2);
      expect(page.result.hasMore).toBe(true);

      const missing = await router().route(createRequest("combat.combatant.list", { combatId: "nope" }));
      expect(missing.ok).toBe(false);
      expect(missing.error.code).toBe(ERROR_CODES.COMBAT_NOT_FOUND);
    });

    it("combat.combatant.get projects the full field set SOURCE-first (the five derived accessors lose)", async () => {
      const response = await router().route(
        createRequest("combat.combatant.get", { combatId: "combat-1", combatantId: "combatant-2" })
      );
      expect(response.ok).toBe(true);
      expect(response.result.combatId).toBe("combat-1");
      expect(response.result.combatant).toEqual({
        id: "combatant-2",
        _id: "combatant-2",
        combatId: "combat-1",

        name: "",
        img: null, // stored null beats the derived token texture
        initiative: 20, // stored 20 beats the GROUP's 99
        hidden: false,
        defeated: false,
        group: COMBAT_GROUP_A, // the stored ID beats the live CombatantGroup DOCUMENT
        actorId: null, // stored null beats the token-derived "actor-derived"
        tokenId: "token-b",
        sceneId: COMBAT_SCENE_A,
        type: "base",
        system: {},

        roundJoined: null,
        flags: {}
      });
    });

    it("resolves the PARENT first: a bad combatant id on a good combat is COMBATANT_NOT_FOUND", async () => {
      const badRow = await router().route(
        createRequest("combat.combatant.get", { combatId: "combat-1", combatantId: "ghost" })
      );
      expect(badRow.ok).toBe(false);
      expect(badRow.error.code).toBe(ERROR_CODES.COMBATANT_NOT_FOUND);
      expect(badRow.error.details).toEqual({ combatId: "combat-1", combatantId: "ghost" });
      expect(badRow.error.message).toContain("combat.combatant.list");

      const badParent = await router().route(
        createRequest("combat.combatant.get", { combatId: "ghost-combat", combatantId: "ghost" })
      );
      expect(badParent.error.code).toBe(ERROR_CODES.COMBAT_NOT_FOUND);
    });

    it("creates a combatant and reports the re-read PARENT state the write moved", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const response = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-1",
          data: { tokenId: VALID_ID, sceneId: COMBAT_SCENE_A, name: "Orc", initiative: 11 }
        })
      );
      expect(response.ok).toBe(true);
      expect(response.result.combatant.name).toBe("Orc");
      expect(response.result.combatant.initiative).toBe(11);
      expect(response.result.combatant.combatId).toBe("combat-1");
      expect(combat.combatants.size).toBe(3);

      expect(response.result.combat).toEqual({
        id: "combat-1",
        _id: "combat-1",
        name: null,
        scene: COMBAT_SCENE_A,
        active: true,
        round: 2,
        turn: 1,
        started: true,
        combatantCount: 3,
        groupCount: 1
      });
      expect(response.result.combatSceneUnlinked).toBe(false);
    });

    it("REPORTS the scene unlink Foundry's server performs for a cross-scene combatant", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const response = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-1",
          data: { tokenId: VALID_ID, sceneId: COMBAT_SCENE_B }
        })
      );
      expect(response.ok).toBe(true);

      expect(response.result.combatSceneUnlinked).toBe(true);
      expect(response.result.combat.scene).toBeNull();
      expect(combat._source.scene).toBeNull();
    });

    it("REPORTS the same unlink on the UPDATE path (its own copy of the transition check)", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const response = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { sceneId: COMBAT_SCENE_B }
        })
      );
      expect(response.ok).toBe(true);
      expect(response.result.combatant.sceneId).toBe(COMBAT_SCENE_B);
      expect(response.result.combatSceneUnlinked).toBe(true);
      expect(response.result.combat.scene).toBeNull();
      expect(combat._source.scene).toBeNull();
    });

    it("unlinks on a write to an ON-SCENE combatant when ANOTHER row sits elsewhere, and not otherwise", async () => {
      const mixed = createCombatDocument("combat-mixed-scenes", {
        scene: COMBAT_SCENE_A,
        combatants: [
          { id: "mixed-here", name: "Here", sceneId: COMBAT_SCENE_A, initiative: 9 },
          { id: "mixed-elsewhere", name: "Elsewhere", sceneId: COMBAT_SCENE_B, initiative: 3 }
        ],
        turnOrder: ["mixed-here", "mixed-elsewhere"]
      });
      globalThis.game.combats.set(mixed);

      const unlinked = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-mixed-scenes",
          combatantId: "mixed-here",
          patch: { hidden: true }
        })
      );
      expect(unlinked.ok).toBe(true);
      expect(unlinked.result.combatant.sceneId).toBe(COMBAT_SCENE_A);
      expect(unlinked.result.combatSceneUnlinked).toBe(true);
      expect(mixed._source.scene).toBeNull();

      const uniform = createCombatDocument("combat-uniform-scene", {
        scene: COMBAT_SCENE_A,
        combatants: [
          { id: "uniform-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 9 },
          { id: "uniform-b", name: "B", sceneId: COMBAT_SCENE_A, initiative: 3 }
        ],
        turnOrder: ["uniform-a", "uniform-b"]
      });
      globalThis.game.combats.set(uniform);
      const untouched = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-uniform-scene",
          combatantId: "uniform-a",
          patch: { hidden: true }
        })
      );
      expect(untouched.ok).toBe(true);
      expect(untouched.result.combatSceneUnlinked).toBe(false);
      expect(untouched.result.combat.scene).toBe(COMBAT_SCENE_A);
      expect(uniform._source.scene).toBe(COMBAT_SCENE_A);
    });

    it("never reports an unlink on a combat that was ALREADY scene-less (the over-report arm)", async () => {
      const sceneless = globalThis.game.combats.get("combat-2");
      expect(sceneless._source.scene).toBeNull();
      const data = { tokenId: VALID_ID, sceneId: COMBAT_SCENE_B };

      const previewCreate = await router().route(
        createRequest("combat.combatant.create", { combatId: "combat-2", data, dryRun: true })
      );
      expect(previewCreate.ok).toBe(true);
      expect(previewCreate.result.combatSceneUnlinked).toBe(false);

      const created = await router().route(
        createRequest("combat.combatant.create", { combatId: "combat-2", data })
      );
      expect(created.ok).toBe(true);
      expect(created.result.combatSceneUnlinked).toBe(false);
      expect(created.result.combat.scene).toBeNull();
      const combatantId = created.result.combatant.id;

      const previewUpdate = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-2",
          combatantId,
          patch: { hidden: true },
          dryRun: true
        })
      );
      expect(previewUpdate.ok).toBe(true);
      expect(previewUpdate.result.combatSceneUnlinked).toBe(false);

      const updated = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-2",
          combatantId,
          patch: { hidden: true }
        })
      );
      expect(updated.ok).toBe(true);
      expect(updated.result.combatSceneUnlinked).toBe(false);
      expect(updated.result.combat.scene).toBeNull();
    });

    it("measures the unlink from the STORED scene id, not the live Scene accessor", async () => {
      const ghostScene = createCombatDocument("combat-ghost-scene", {
        scene: COMBAT_SCENE_C,
        combatants: [{ id: "ghost-a", name: "A", sceneId: COMBAT_SCENE_C, initiative: 4 }],
        turnOrder: ["ghost-a"]
      });

      ghostScene.scene = null;
      expect(ghostScene._source.scene).toBe(COMBAT_SCENE_C);
      globalThis.game.combats.set(ghostScene);

      const response = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-ghost-scene",
          data: { tokenId: VALID_ID, sceneId: COMBAT_SCENE_B }
        })
      );
      expect(response.ok).toBe(true);
      expect(response.result.combatSceneUnlinked).toBe(true);
      expect(ghostScene._source.scene).toBeNull();
    });

    it("REPORTS the group initiative a game SYSTEM cleared on a combatant update", async () => {
      const combat = createCombatDocument("combat-sys-propagate", {
        scene: COMBAT_SCENE_A,
        groups: [{ id: COMBAT_GROUP_A, name: "Wolves", initiative: 15 }],
        combatants: [{ id: "syspropagate-1", name: "Wolf", sceneId: COMBAT_SCENE_A, initiative: 7 }],
        turnOrder: ["syspropagate-1"],
        systemPropagatesGroupInitiative: true
      });
      globalThis.game.combats.set(combat);

      const response = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-sys-propagate",
          combatantId: "syspropagate-1",
          patch: { group: COMBAT_GROUP_A }
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.combatant.group).toBe(COMBAT_GROUP_A);

      expect(response.result.combatant.initiative).toBe(7);
      expect(response.result.groupInitiativeChanges).toEqual([
        { groupId: COMBAT_GROUP_A, initiativeBefore: 15, initiativeAfter: null }
      ]);

      expect(combat.groups.get(COMBAT_GROUP_A)._source.initiative).toBeNull();
    });

    it("reports NO group initiative change when nothing propagated (the over-report arm)", async () => {
      const quiet = createCombatDocument("combat-sys-quiet", {
        scene: COMBAT_SCENE_A,
        groups: [{ id: COMBAT_GROUP_A, name: "Wolves", initiative: 15 }],
        combatants: [
          { id: "quiet-1", name: "Wolf", sceneId: COMBAT_SCENE_A, initiative: 7, group: COMBAT_GROUP_A }
        ],
        turnOrder: ["quiet-1"]
      });
      globalThis.game.combats.set(quiet);

      const preview = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-sys-quiet",
          combatantId: "quiet-1",
          patch: { hidden: true },
          dryRun: true
        })
      );
      expect(preview.ok).toBe(true);
      expect(preview.result.groupInitiativeChanges).toEqual([]);

      const response = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-sys-quiet",
          combatantId: "quiet-1",
          patch: { hidden: true }
        })
      );
      expect(response.ok).toBe(true);
      expect(response.result.groupInitiativeChanges).toEqual([]);
      expect(quiet.groups.get(COMBAT_GROUP_A)._source.initiative).toBe(15);

      const leaving = createCombatDocument("combat-sys-leaving", {
        scene: COMBAT_SCENE_A,
        groups: [{ id: COMBAT_GROUP_A, name: "Wolves", initiative: 15 }],
        combatants: [
          { id: "leaving-1", name: "Wolf", sceneId: COMBAT_SCENE_A, initiative: 7, group: COMBAT_GROUP_A }
        ],
        turnOrder: ["leaving-1"],
        systemPropagatesGroupInitiative: true
      });
      globalThis.game.combats.set(leaving);
      const left = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-sys-leaving",
          combatantId: "leaving-1",
          patch: { group: null }
        })
      );
      expect(left.ok).toBe(true);
      expect(left.result.combatant.group).toBeNull();
      expect(left.result.groupInitiativeChanges).toEqual([]);
      expect(leaving.groups.get(COMBAT_GROUP_A)._source.initiative).toBe(15);
    });

    it("reports a 0 -> null group initiative change (`0` is a legal initiative, not an absence)", async () => {
      const zeroed = createCombatDocument("combat-sys-zero", {
        scene: COMBAT_SCENE_A,
        groups: [{ id: COMBAT_GROUP_A, name: "Wolves", initiative: 0 }],
        combatants: [{ id: "zero-1", name: "Wolf", sceneId: COMBAT_SCENE_A, initiative: 7 }],
        turnOrder: ["zero-1"],
        systemPropagatesGroupInitiative: true
      });
      globalThis.game.combats.set(zeroed);

      const response = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-sys-zero",
          combatantId: "zero-1",
          patch: { group: COMBAT_GROUP_A }
        })
      );
      expect(response.ok).toBe(true);
      expect(response.result.groupInitiativeChanges).toEqual([
        { groupId: COMBAT_GROUP_A, initiativeBefore: 0, initiativeAfter: null }
      ]);
    });

    it("never attributes a group that only APPEARED across the write to this update", async () => {
      const racy = createCombatDocument("combat-sys-racy", {
        scene: COMBAT_SCENE_A,
        groups: [{ id: COMBAT_GROUP_A, name: "Wolves", initiative: 15 }],
        combatants: [{ id: "racy-1", name: "Wolf", sceneId: COMBAT_SCENE_A, initiative: 7 }],
        turnOrder: ["racy-1"],
        concurrentGroupOnCombatantWrite: { id: "combatGroupBBB22", name: "Latecomer", initiative: 4 }
      });
      globalThis.game.combats.set(racy);

      const response = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-sys-racy",
          combatantId: "racy-1",
          patch: { hidden: true }
        })
      );
      expect(response.ok).toBe(true);

      expect(racy.groups.get("combatGroupBBB22")).toBeTruthy();

      expect(response.result.groupInitiativeChanges).toEqual([]);
    });

    it("ALLOWS duplicate combatants for one token (Foundry does — probed live on both versions)", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const data = { tokenId: VALID_ID, sceneId: COMBAT_SCENE_A };
      const first = await router().route(
        createRequest("combat.combatant.create", { combatId: "combat-1", data })
      );
      const second = await router().route(
        createRequest("combat.combatant.create", { combatId: "combat-1", data })
      );
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(first.result.combatant.id).not.toBe(second.result.combatant.id);
      expect(combat.combatants.size).toBe(4);

      const rows = Array.from(combat.combatants).filter((row) => row._source.tokenId === VALID_ID);
      expect(rows).toHaveLength(2);
    });

    it("refuses to report a VETOED combatant create as created, and still creates when nothing vetoes", async () => {
      const combat = globalThis.game.combats.get("combat-1");

      combat.vetoCombatantCreates = true;
      const vetoed = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-1",
          data: { tokenId: VALID_ID, sceneId: COMBAT_SCENE_A, name: "Refused" }
        })
      );
      expect(vetoed.ok).toBe(false);
      expect(vetoed.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(vetoed.error.message).toContain("Combatant creation returned no document");

      expect(combat.combatants.size).toBe(2);
      expect(Array.from(combat.combatants).some((row) => row._source.name === "Refused")).toBe(false);

      expect(combat.createEmbeddedDocuments).toHaveBeenCalledTimes(1);

      combat.vetoCombatantCreates = false;
      const allowed = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-1",
          data: { tokenId: VALID_ID, sceneId: COMBAT_SCENE_A, name: "Allowed" }
        })
      );
      expect(allowed.ok, JSON.stringify(allowed.error ?? {})).toBe(true);
      expect(allowed.result.combatant.name).toBe("Allowed");
      expect(combat.combatants.size).toBe(3);
      expect(combat.combatants.get(allowed.result.combatant.id)._source.name).toBe("Allowed");
    });

    it("combat.combatant.create dry-run previews Foundry's defaults, persists nothing and mints no id", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const response = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-1",
          data: { tokenId: VALID_ID, sceneId: COMBAT_SCENE_A },
          dryRun: true
        })
      );
      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(combat.combatants.size).toBe(2);
      expect(combat.createEmbeddedDocuments).not.toHaveBeenCalled();

      expect(response.result.combatant.id).toBeNull();
      expect(response.result.combatant._id).toBeNull();
      expect(response.result.combatant.initiative).toBeNull();
      expect(response.result.combatant.hidden).toBe(false);
      expect(response.result.combatant.group).toBeNull();

      expect(response.result.combat.turn).toBe(0);
      expect(response.result.combatSceneUnlinked).toBe(false);
    });

    const seedV14Combat = (id, overrides = {}) => {
      const seeded = createCombatDocument(id, { v14Combatants: true, scene: COMBAT_SCENE_A, ...overrides });
      globalThis.game.combats.set(seeded);
      return seeded;
    };

    it("previews v14's `roundJoined` overwrite on a STARTED encounter, and agrees with the real write", async () => {
      globalThis.game.release = { version: "14.365", generation: 14 };
      const combat = seedV14Combat("cbt-rj-started", { round: 3, turn: 0 });

      const supplied = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "cbt-rj-started",
          data: { roundJoined: 5 },
          dryRun: true
        })
      );
      expect(supplied.ok, JSON.stringify(supplied.error ?? {})).toBe(true);
      expect(supplied.result.combatant.roundJoined).toBe(3);

      const omitted = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "cbt-rj-started",
          data: { name: "Late" },
          dryRun: true
        })
      );
      expect(omitted.result.combatant.roundJoined).toBe(3);
      expect(combat.createEmbeddedDocuments).not.toHaveBeenCalled();

      const real = await router().route(
        createRequest("combat.combatant.create", { combatId: "cbt-rj-started", data: { roundJoined: 5 } })
      );
      expect(real.ok, JSON.stringify(real.error ?? {})).toBe(true);
      expect(real.result.combatant.roundJoined).toBe(supplied.result.combatant.roundJoined);
    });

    it("leaves `roundJoined` alone on an UNSTARTED encounter and on a core without the field", async () => {
      globalThis.game.release = { version: "14.365", generation: 14 };
      const unstarted = seedV14Combat("cbt-rj-unstarted", { round: 0, turn: null });
      const supplied = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "cbt-rj-unstarted",
          data: { roundJoined: 5 },
          dryRun: true
        })
      );
      expect(supplied.ok, JSON.stringify(supplied.error ?? {})).toBe(true);
      expect(supplied.result.combatant.roundJoined).toBe(5);
      const omitted = await router().route(
        createRequest("combat.combatant.create", { combatId: "cbt-rj-unstarted", data: {}, dryRun: true })
      );
      expect(omitted.result.combatant.roundJoined).toBe(1);
      expect(unstarted.createEmbeddedDocuments).not.toHaveBeenCalled();

      globalThis.game.release = { version: "13.351", generation: 13 };
      const v13 = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-1",
          data: { name: "v13" },
          dryRun: true
        })
      );
      expect(v13.ok, JSON.stringify(v13.error ?? {})).toBe(true);
      expect(v13.result.combatant.roundJoined).toBeNull();
    });

    it("reads the round LIVE for that preview, like core's `_preCreate`, not the source-first stored value", async () => {
      globalThis.game.release = { version: "14.365", generation: 14 };

      seedV14Combat("cbt-rj-live", { round: 3, turn: 0, derivedRound: 4, derivedTurn: 0 });
      const preview = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "cbt-rj-live",
          data: { roundJoined: 9 },
          dryRun: true
        })
      );
      expect(preview.ok, JSON.stringify(preview.error ?? {})).toBe(true);
      expect(preview.result.combatant.roundJoined).toBe(4);
      expect(preview.result.combat.round).toBe(3);
    });

    it("every mutating combatant/group verb answers the SAME key set on the dry-run and real paths", async () => {
      const cases = [
        {
          command: "combat.combatant.create",
          bodyKey: "combatant",
          dry: {
            combatId: "combat-1",
            data: { tokenId: VALID_ID, sceneId: COMBAT_SCENE_A, name: "Shape Preview" },
            dryRun: true
          },
          real: {
            combatId: "combat-1",
            data: { tokenId: OTHER_ID, sceneId: COMBAT_SCENE_A, name: "Shape Real" }
          }
        },
        {
          command: "combat.combatant.update",
          bodyKey: "combatant",
          dry: {
            combatId: "combat-1",
            combatantId: "combatant-1",
            patch: { name: "Shape Preview" },
            dryRun: true
          },
          real: { combatId: "combat-1", combatantId: "combatant-1", patch: { name: "Shape Real" } }
        },
        {
          command: "combat.group.create",
          bodyKey: "group",
          dry: { combatId: "combat-1", data: { name: "Shape Preview" }, dryRun: true },
          real: { combatId: "combat-1", data: { name: "Shape Real" } }
        },
        {
          command: "combat.group.update",
          bodyKey: "group",
          dry: {
            combatId: "combat-1",
            groupId: COMBAT_GROUP_A,
            patch: { name: "Shape Preview" },
            dryRun: true
          },
          real: { combatId: "combat-1", groupId: COMBAT_GROUP_A, patch: { name: "Shape Real" } }
        }
      ];
      for (const { command, bodyKey, dry, real } of cases) {
        const shared = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
        const dryResponse = await shared.route(createRequest(command, dry));
        const realResponse = await shared.route(createRequest(command, real));
        expect(dryResponse.ok, `${command} dry: ${JSON.stringify(dryResponse.error ?? {})}`).toBe(true);
        expect(realResponse.ok, `${command} real: ${JSON.stringify(realResponse.error ?? {})}`).toBe(true);
        expect(Object.keys(dryResponse.result).sort(), command).toEqual(
          [...Object.keys(realResponse.result), "dryRun"].sort()
        );
        expect(Object.keys(dryResponse.result[bodyKey]).sort(), `${command}.${bodyKey}`).toEqual(
          Object.keys(realResponse.result[bodyKey]).sort()
        );

        expect(dryResponse.result.dryRun, command).toBe(true);
        expect(realResponse.result.dryRun, command).toBeUndefined();
      }
    });

    it("validates the create payload IDENTICALLY on the real and dry-run paths (one construction)", async () => {
      for (const dryRun of [true, false]) {
        const response = await router().route(
          createRequest("combat.combatant.create", {
            combatId: "combat-1",

            data: { tokenId: `Token.${VALID_ID}`, ...(dryRun ? {} : {}) },
            dryRun
          })
        );
        expect(response.ok, `dryRun=${dryRun}`).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);

        expect(response.error.details.message).toContain("16-character");
      }
    });

    const GROUP_HD = "combatGroupHD111";
    function seedHiddenDefeatedGroupCombat(combatId) {
      const seeded = createCombatDocument(combatId, {
        scene: COMBAT_SCENE_A,
        groups: [
          {
            id: GROUP_HD,
            name: "Ambushers",
            initiative: 15,

            derived: { hidden: true, defeated: true }
          }
        ],
        combatants: [
          {
            id: `${combatId}-a`,
            name: "A",
            sceneId: COMBAT_SCENE_A,
            group: GROUP_HD,
            hidden: true,
            defeated: true,
            initiative: 9
          },
          {
            id: `${combatId}-b`,
            name: "B",
            sceneId: COMBAT_SCENE_A,
            group: GROUP_HD,
            hidden: true,
            defeated: true,
            initiative: 3
          }
        ],
        groupMemberIdsDerived: { [GROUP_HD]: [`${combatId}-a`, `${combatId}-b`] },
        turnOrder: [`${combatId}-a`, `${combatId}-b`]
      });
      globalThis.game.combats.set(seeded);
      return seeded;
    }
    const readGroupDerivedState = (combat) => {
      const group = combat.groups.get(GROUP_HD);
      return {
        hidden: group.hidden,
        defeated: group.defeated,
        memberIds: Array.from(group.members ?? []).map((member) => member?.id ?? null)
      };
    };

    it("a combatant CREATE never lets its preview mutate the LIVE group (dry-run AND real)", async () => {
      for (const dryRun of [true, false]) {
        const combatId = `combat-hd-create-${dryRun}`;
        const combat = seedHiddenDefeatedGroupCombat(combatId);
        const before = readGroupDerivedState(combat);
        expect(before, "the fixture must start in the state where a flip is observable").toEqual({
          hidden: true,
          defeated: true,
          memberIds: [`${combatId}-a`, `${combatId}-b`]
        });
        const response = await router().route(
          createRequest("combat.combatant.create", {
            combatId,

            data: { tokenId: VALID_ID, sceneId: COMBAT_SCENE_A, group: GROUP_HD },
            ...(dryRun ? { dryRun: true } : {})
          })
        );
        expect(response.ok, `dryRun=${dryRun}: ${JSON.stringify(response.error ?? {})}`).toBe(true);
        expect(readGroupDerivedState(combat), `dryRun=${dryRun}`).toEqual(before);

        expect(response.result.combatant.group, `dryRun=${dryRun}`).toBe(GROUP_HD);
      }
    });

    it("a combatant UPDATE never lets its preview mutate the LIVE group either", async () => {
      const combat = seedHiddenDefeatedGroupCombat("combat-hd-update");
      const before = readGroupDerivedState(combat);
      expect(before.hidden).toBe(true);
      const response = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-hd-update",
          combatantId: "combat-hd-update-a",
          patch: { hidden: false },
          dryRun: true
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.dryRun).toBe(true);

      expect(response.result.combatant.hidden).toBe(false);
      expect(readGroupDerivedState(combat)).toEqual(before);

      expect(combat.combatants.get("combat-hd-update-a")._source.hidden).toBe(true);
    });

    it("refuses an update preview whose detached parent lost the row instead of falling back to the live one", async () => {
      const combat = seedHiddenDefeatedGroupCombat("combat-hd-detach-loss");
      const before = readGroupDerivedState(combat);
      const intact = combat.clone;
      combat.clone = vi.fn(async (patch, context) => {
        const detached = await intact(patch, context);
        detached.combatants.delete("combat-hd-detach-loss-a");
        return detached;
      });
      const response = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-hd-detach-loss",
          combatantId: "combat-hd-detach-loss-a",
          patch: { hidden: false },
          dryRun: true
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("preview copy");
      expect(response.error.details).toMatchObject({
        combatId: "combat-hd-detach-loss",
        combatantId: "combat-hd-detach-loss-a"
      });
      expect(readGroupDerivedState(combat)).toEqual(before);
    });

    it("keeps the WRITE-CONFIRMATION diff probe off the live group too, in BOTH verdict arms", async () => {
      const combat = seedHiddenDefeatedGroupCombat("combat-hd-probe");
      const before = readGroupDerivedState(combat);
      expect(before, "the fixture must start where a probe leak is observable").toEqual({
        hidden: true,
        defeated: true,
        memberIds: ["combat-hd-probe-a", "combat-hd-probe-b"]
      });

      const noop = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-hd-probe",
          combatantId: "combat-hd-probe-a",
          patch: { hidden: true }
        })
      );
      expect(noop.ok, JSON.stringify(noop.error ?? {})).toBe(true);
      expect(noop.result.combatant.hidden).toBe(true);
      expect(readGroupDerivedState(combat), "the no-op probe must not touch the live group").toEqual(before);

      combat.vetoCombatantUpdates = new Set(["combat-hd-probe-a"]);
      const vetoed = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-hd-probe",
          combatantId: "combat-hd-probe-a",
          patch: { hidden: false }
        })
      );
      expect(vetoed.ok).toBe(false);
      expect(vetoed.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(vetoed.error.message).toContain("preUpdateCombatant");
      expect(vetoed.error.details.fields).toEqual(["hidden"]);
      expect(readGroupDerivedState(combat), "the veto probe must not touch the live group either").toEqual(
        before
      );
      expect(combat.combatants.get("combat-hd-probe-a")._source.hidden).toBe(true);
    });

    it("canonicalizes `img` so a WHITESPACE-only value is rejected instead of silently clearing it", async () => {
      for (const params of [
        { combatId: "combat-1", data: { img: "   " } },
        { combatId: "combat-1", combatantId: "combatant-1", patch: { img: "   " } }
      ]) {
        const command = "combatantId" in params ? "combat.combatant.update" : "combat.combatant.create";
        const response = await router().route(createRequest(command, params));
        expect(response.ok, command).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
        expect(response.error.details.message).toContain("file extension");
      }

      const empty = await router().route(
        createRequest("combat.combatant.create", { combatId: "combat-1", data: { img: "" } })
      );
      expect(empty.ok).toBe(false);
      expect(empty.error.code).toBe(ERROR_CODES.INVALID_PARAMS);

      const cleared = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { img: null }
        })
      );
      expect(cleared.ok).toBe(true);
      expect(cleared.result.combatant.img).toBeNull();
    });

    it("does not hand the real create a payload the strict PREVIEW construction mutated", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const response = await router().route(
        createRequest("combat.combatant.create", { combatId: "combat-1", data: { name: "Copy check" } })
      );
      expect(response.ok).toBe(true);
      const [, [entry]] = combat.createEmbeddedDocuments.mock.calls[0];
      expect(Object.hasOwn(entry, "_stats")).toBe(false);
      expect(Object.hasOwn(entry, "_id")).toBe(false);
    });

    it("REFUSES a `group` id that names no group of THIS combat, and lists the valid ones", async () => {
      const response = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-1",
          data: { tokenId: VALID_ID, group: OTHER_ID }
        })
      );
      expect(response.ok).toBe(false);

      expect(response.error.code).toBe(ERROR_CODES.COMBATANT_GROUP_NOT_FOUND);
      expect(response.error.details).toEqual({
        combatId: "combat-1",
        group: OTHER_ID,
        knownGroupIds: [COMBAT_GROUP_A]
      });
      expect(response.error.message).toContain(COMBAT_GROUP_A);
      expect(globalThis.game.combats.get("combat-1").combatants.size).toBe(2);

      const patched = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { group: OTHER_ID }
        })
      );
      expect(patched.error.code).toBe(ERROR_CODES.COMBATANT_GROUP_NOT_FOUND);
      expect(patched.error.details.combatantId).toBe("combatant-1");

      const preview = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { group: OTHER_ID },
          dryRun: true
        })
      );
      expect(preview.error.code).toBe(ERROR_CODES.COMBATANT_GROUP_NOT_FOUND);
    });

    it("judges the group id Foundry would STORE, so a padded id naming a real group is accepted", async () => {
      const padded = `  ${COMBAT_GROUP_A}  `;
      const created = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-1",
          data: { name: "Padded", group: padded }
        })
      );
      expect(created.ok, JSON.stringify(created.error ?? {})).toBe(true);

      expect(created.result.combatant.group).toBe(COMBAT_GROUP_A);

      const patched = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { group: padded }
        })
      );
      expect(patched.ok, JSON.stringify(patched.error ?? {})).toBe(true);
      expect(patched.result.combatant.group).toBe(COMBAT_GROUP_A);

      const blanked = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { group: "   " }
        })
      );
      expect(blanked.ok).toBe(false);
      expect(blanked.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(blanked.error.details.fields).toEqual(["group"]);
      expect(blanked.error.message).toContain("--clear-group");

      const after = await router().route(
        createRequest("combat.combatant.get", { combatId: "combat-1", combatantId: "combatant-1" })
      );
      expect(after.result.combatant.group).toBe(COMBAT_GROUP_A);
    });

    it("REFUSES a whitespace-only actorId/tokenId/sceneId too (create + update, both paths)", async () => {
      for (const field of ["actorId", "tokenId", "sceneId"]) {
        for (const request of [
          createRequest("combat.combatant.create", { combatId: "combat-1", data: { [field]: "   " } }),
          createRequest("combat.combatant.create", {
            combatId: "combat-1",
            data: { [field]: "   " },
            dryRun: true
          }),
          createRequest("combat.combatant.update", {
            combatId: "combat-1",
            combatantId: "combatant-1",
            patch: { [field]: "   " }
          }),
          createRequest("combat.combatant.update", {
            combatId: "combat-1",
            combatantId: "combatant-1",
            patch: { [field]: "   " },
            dryRun: true
          })
        ]) {
          const response = await router().route(request);
          expect(response.ok, `${field}: ${JSON.stringify(response.result ?? {})}`).toBe(false);
          expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
          expect(response.error.details.fields).toEqual([field]);
        }
      }

      const sceneless = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { sceneId: " " }
        })
      );
      expect(sceneless.error.message).toContain("--clear-scene");
      expect(sceneless.error.message).toContain("cross-scene check");

      const many = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-1",
          data: { actorId: " ", tokenId: "  ", name: "Nobody" }
        })
      );
      expect(many.error.details.fields).toEqual(["actorId", "tokenId"]);

      const cleared = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { tokenId: null }
        })
      );
      expect(cleared.ok, JSON.stringify(cleared.error ?? {})).toBe(true);
      expect(cleared.result.combatant.tokenId).toBeNull();
    });

    it("runs the blank-reference refusal BEFORE the group-existence check (precedence is contract)", async () => {
      const response = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { sceneId: "   ", group: OTHER_ID }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.details.fields).toEqual(["sceneId"]);

      const groupOnly = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { group: OTHER_ID }
        })
      );
      expect(groupOnly.error.code).toBe(ERROR_CODES.COMBATANT_GROUP_NOT_FOUND);
    });

    it("a padded id naming NO group is still refused, and the message echoes the CLEANED id", async () => {
      const response = await router().route(
        createRequest("combat.combatant.create", { combatId: "combat-1", data: { group: `  ${OTHER_ID}  ` } })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMBATANT_GROUP_NOT_FOUND);
      expect(response.error.details.group).toBe(OTHER_ID);
      expect(response.error.message).toContain(`group ${OTHER_ID} was not found`);
    });

    it("refuses a group that belongs to ANOTHER combat (the guard is per-combat, not global)", async () => {
      const other = await router().route(
        createRequest("combat.group.create", { combatId: "combat-2", data: { name: "Other combat's group" } })
      );
      expect(other.ok).toBe(true);
      const foreignGroupId = other.result.group.id;

      const response = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { group: foreignGroupId }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMBATANT_GROUP_NOT_FOUND);
      expect(response.error.details.knownGroupIds).toEqual([COMBAT_GROUP_A]);

      const accepted = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-2",
          data: { name: "Member", group: foreignGroupId }
        })
      );
      expect(accepted.ok).toBe(true);
      expect(accepted.result.combatant.group).toBe(foreignGroupId);
    });

    it("names a MALFORMED group id with the same prescriptive code (deliberately unlike the scene guard)", async () => {
      const response = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { group: "not-an-id" }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMBATANT_GROUP_NOT_FOUND);
      expect(response.error.message).toContain(COMBAT_GROUP_A);
    });

    it("keeps the group guard SUPPLY-ONLY: an existing group joins, `null` leaves, an untouched patch is never asked", async () => {
      const joined = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { group: COMBAT_GROUP_A }
        })
      );
      expect(joined.ok).toBe(true);
      expect(joined.result.combatant.group).toBe(COMBAT_GROUP_A);

      const left = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-2",
          patch: { group: null }
        })
      );
      expect(left.ok).toBe(true);
      expect(left.result.combatant.group).toBeNull();

      const untouched = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-2",
          patch: { hidden: true }
        })
      );
      expect(untouched.ok).toBe(true);
      const groupless = globalThis.game.combats.get("combat-2");
      const created = await router().route(
        createRequest("combat.combatant.create", { combatId: "combat-2", data: { name: "No groups here" } })
      );
      expect(created.ok).toBe(true);
      expect(groupless.combatants.size).toBe(1);
    });

    it("gates v14-only `roundJoined` on the core generation, and the VERSION gate runs FIRST", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      for (const params of [
        { combatId: "combat-1", data: { roundJoined: 2 } },
        { combatId: "combat-1", combatantId: "combatant-1", patch: { roundJoined: 2 } }
      ]) {
        const command = "combatantId" in params ? "combat.combatant.update" : "combat.combatant.create";
        const response = await router().route(createRequest(command, params));
        expect(response.ok, command).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
        expect(response.error.details.fields).toEqual(["roundJoined"]);
        expect(response.error.details.generation).toBe(13);
      }

      const both = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-1",
          data: { roundJoined: 2, group: OTHER_ID }
        })
      );
      expect(both.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(both.error.details.fields).toEqual(["roundJoined"]);

      delete globalThis.game.release;
      const unknown = await router().route(
        createRequest("combat.combatant.create", { combatId: "combat-1", data: { roundJoined: 2 } })
      );
      expect(unknown.ok).toBe(false);
      expect(unknown.error.details.generation).toBeNull();

      globalThis.game.release = { version: "14.365", generation: 14 };
      const v14 = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-1",
          data: { roundJoined: 3, name: "Late" }
        })
      );
      expect(v14.ok).toBe(true);
      expect(v14.result.combatant.roundJoined).toBe(3);
    });

    it("runs BOTH create guards on the DRY-RUN path, so a preview cannot pass what the real call refuses", async () => {
      const combat = globalThis.game.combats.get("combat-1");

      const group = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-1",
          data: { tokenId: VALID_ID, group: OTHER_ID },
          dryRun: true
        })
      );
      expect(group.ok).toBe(false);
      expect(group.error.code).toBe(ERROR_CODES.COMBATANT_GROUP_NOT_FOUND);
      expect(group.error.details.knownGroupIds).toEqual([COMBAT_GROUP_A]);

      globalThis.game.release = { version: "13.351", generation: 13 };
      const version = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-1",
          data: { roundJoined: 3 },
          dryRun: true
        })
      );
      expect(version.ok).toBe(false);
      expect(version.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(version.error.details.fields).toEqual(["roundJoined"]);
      expect(version.error.details.generation).toBe(13);

      expect(combat.combatants.size).toBe(2);
      expect(combat.createEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("puts the group guard AHEAD of Foundry's own validation, so the prescriptive code survives", async () => {
      const response = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-1",

          data: { tokenId: "Token.aaaaaaaaaa111111", group: OTHER_ID }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMBATANT_GROUP_NOT_FOUND);
      expect(response.error.details.knownGroupIds).toEqual([COMBAT_GROUP_A]);

      const preview = await router().route(
        createRequest("combat.combatant.create", {
          combatId: "combat-1",
          data: { tokenId: "Token.aaaaaaaaaa111111", group: OTHER_ID },
          dryRun: true
        })
      );
      expect(preview.error.code).toBe(ERROR_CODES.COMBATANT_GROUP_NOT_FOUND);
    });

    it("confirms a combatant UPDATE against stored state and separates a veto from a no-op", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const row = combat.combatants.get("combatant-1");

      const ok = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { defeated: true }
        })
      );
      expect(ok.ok).toBe(true);
      expect(ok.result.combatant.defeated).toBe(true);
      expect(row._source.defeated).toBe(true);

      expect(ok.result.combat.turn).toBe(1);
      expect(ok.result.combatSceneUnlinked).toBe(false);

      const noop = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { defeated: true }
        })
      );
      expect(noop.ok).toBe(true);
      expect(noop.result.combatant.defeated).toBe(true);

      combat.vetoCombatantUpdates = new Set(["combatant-1"]);
      const vetoed = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { hidden: true }
        })
      );
      expect(vetoed.ok).toBe(false);
      expect(vetoed.error.message).toContain("preUpdateCombatant");
      expect(vetoed.error.message).toContain("disable the module");
      expect(row._source.hidden).toBe(false);
    });

    it("combat.combatant.update dry-run previews without persisting", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const response = await router().route(
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { name: "Renamed" },
          dryRun: true
        })
      );
      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result.combatant.name).toBe("Renamed");
      expect(response.result.combatant.id).toBe("combatant-1");
      expect(combat.combatants.get("combatant-1")._source.name).toBe("Hero");
      expect(combat.updateEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("deletes a combatant, confirms it against stored state, and reports NO unlink flag", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const response = await router().route(
        createRequest("combat.combatant.delete", { combatId: "combat-1", combatantId: "combatant-1" })
      );
      expect(response.ok).toBe(true);
      expect(response.result).toEqual({
        combatId: "combat-1",
        id: "combatant-1",
        deleted: true,
        combat: {
          id: "combat-1",
          _id: "combat-1",
          name: null,
          scene: COMBAT_SCENE_A,
          active: true,
          round: 2,
          turn: 1, // the server's parent `turn` write on a started combat
          started: true,
          combatantCount: 1,
          groupCount: 1
        }
      });

      expect(Object.hasOwn(response.result, "combatSceneUnlinked")).toBe(false);
      expect(combat.combatants.get("combatant-1")).toBeNull();
    });

    it("refuses to report a VETOED combatant delete as deleted, and dry-run deletes nothing", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      combat.vetoCombatantDeletes = new Set(["combatant-1"]);
      const vetoed = await router().route(
        createRequest("combat.combatant.delete", { combatId: "combat-1", combatantId: "combatant-1" })
      );
      expect(vetoed.ok).toBe(false);
      expect(vetoed.error.message).toContain("preDeleteCombatant");
      expect(combat.combatants.get("combatant-1")).not.toBeNull();

      combat.vetoCombatantDeletes = null;

      const callsBeforePreview = combat.deleteEmbeddedDocuments.mock.calls.length;
      const preview = await router().route(
        createRequest("combat.combatant.delete", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          dryRun: true
        })
      );
      expect(preview.result).toEqual({
        combatId: "combat-1",
        id: "combatant-1",
        deleted: false,
        combat: expect.objectContaining({ id: "combat-1", combatantCount: 2, turn: 0 }),
        dryRun: true,
        approvalRequired: true
      });
      expect(combat.deleteEmbeddedDocuments.mock.calls.length).toBe(callsBeforePreview);
    });

    it("rejects `initiative` and every meta field in the combatant PATCH at the protocol layer", async () => {
      for (const patch of [
        { initiative: 5 },
        { _id: "spoof" },
        { _stats: {} },
        { ownership: { default: 3 } },
        { type: "base" },
        {}
      ]) {
        const response = await router().route(
          createRequest("combat.combatant.update", {
            combatId: "combat-1",
            combatantId: "combatant-1",
            patch
          })
        );
        expect(response.ok, JSON.stringify(patch)).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      }

      const created = await router().route(
        createRequest("combat.combatant.create", { combatId: "combat-1", data: { initiative: 5 } })
      );
      expect(created.ok).toBe(true);
      expect(created.result.combatant.initiative).toBe(5);
    });
  });

  describe("combat.group.* embedded family", () => {
    const router = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    it("combat.group.get exposes stored fields, DERIVED booleans, stored membership and READ-ONLY ownership", async () => {
      const response = await router().route(
        createRequest("combat.group.get", { combatId: "combat-1", groupId: COMBAT_GROUP_A })
      );
      expect(response.ok).toBe(true);
      expect(response.result.group).toEqual({
        id: COMBAT_GROUP_A,
        _id: COMBAT_GROUP_A,
        combatId: "combat-1",
        name: "Goblins",
        type: "base",
        system: {},
        img: null,

        initiative: 15,
        flags: {},

        hidden: false,
        defeated: false,

        memberCombatantIds: ["combatant-2"],

        ownership: { default: 0, aaaaaaaaaa111111: 2 }
      });
    });

    it("combat.group.get round-trips a stored `-1` INHERIT verbatim (which resolves to NONE, not to the Combat)", async () => {
      const combat = createCombatDocument("combat-group-inherit", {
        scene: COMBAT_SCENE_A,
        groups: [
          {
            id: COMBAT_GROUP_A,
            name: "Inheritors",
            ownership: { default: -1, aaaaaaaaaa111111: -1 }
          }
        ]
      });
      globalThis.game.combats.set(combat);

      const response = await router().route(
        createRequest("combat.group.get", { combatId: "combat-group-inherit", groupId: COMBAT_GROUP_A })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.group.ownership).toEqual({ default: -1, aaaaaaaaaa111111: -1 });

      expect(response.result.group.ownership.default).toBe(-1);
    });

    it("combat.group.list keeps ownership OUT of the rows and counts stored members", async () => {
      const response = await router().route(createRequest("combat.group.list", { combatId: "combat-1" }));
      expect(response.ok).toBe(true);
      expect(response.result.total).toBe(1);
      expect(response.result.groups).toEqual([
        {
          id: COMBAT_GROUP_A,
          _id: COMBAT_GROUP_A,
          combatId: "combat-1",
          name: "Goblins",
          img: null,
          initiative: 15,
          memberCount: 1,
          hidden: false,
          defeated: false
        }
      ]);

      expect(Object.hasOwn(response.result.groups[0], "ownership")).toBe(false);
    });

    it("reports COMBATANT_GROUP_NOT_FOUND for a bad group id and COMBAT_NOT_FOUND for a bad parent", async () => {
      const badGroup = await router().route(
        createRequest("combat.group.get", { combatId: "combat-1", groupId: "ghost" })
      );
      expect(badGroup.error.code).toBe(ERROR_CODES.COMBATANT_GROUP_NOT_FOUND);
      expect(badGroup.error.details).toEqual({ combatId: "combat-1", groupId: "ghost" });
      expect(badGroup.error.message).toContain("combat.group.list");

      const badParent = await router().route(
        createRequest("combat.group.get", { combatId: "ghost", groupId: COMBAT_GROUP_A })
      );
      expect(badParent.error.code).toBe(ERROR_CODES.COMBAT_NOT_FOUND);
    });

    it("creates a group (defaults applied, no members yet) and previews the same shape on a dry run", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const created = await router().route(
        createRequest("combat.group.create", {
          combatId: "combat-1",
          data: { name: "Wolves", initiative: 9 }
        })
      );
      expect(created.ok).toBe(true);
      expect(created.result.group.name).toBe("Wolves");
      expect(created.result.group.initiative).toBe(9);

      expect(created.result.group.memberCombatantIds).toEqual([]);
      expect(combat.groups.size).toBe(2);

      expect(Object.hasOwn(created.result.group, "ownership")).toBe(false);

      expect([created.result.group.hidden, created.result.group.defeated]).toEqual([true, true]);

      const preview = await router().route(
        createRequest("combat.group.create", { combatId: "combat-1", data: { name: "Bats" }, dryRun: true })
      );
      expect(preview.result.dryRun).toBe(true);
      expect(preview.result.group.id).toBeNull();
      expect(preview.result.group.initiative).toBeNull();

      expect([preview.result.group.hidden, preview.result.group.defeated]).toEqual([true, true]);
      expect(combat.groups.size).toBe(2);
    });

    it("refuses to report a VETOED group create as created, and still creates when nothing vetoes", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      combat.vetoGroupCreates = true;
      const vetoed = await router().route(
        createRequest("combat.group.create", { combatId: "combat-1", data: { name: "Refused pack" } })
      );
      expect(vetoed.ok).toBe(false);
      expect(vetoed.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(vetoed.error.message).toContain("CombatantGroup creation returned no document");
      expect(combat.groups.size).toBe(1);
      expect(Array.from(combat.groups).some((row) => row._source.name === "Refused pack")).toBe(false);

      expect(combat.createEmbeddedDocuments).toHaveBeenCalledTimes(1);

      combat.vetoGroupCreates = false;
      const allowed = await router().route(
        createRequest("combat.group.create", { combatId: "combat-1", data: { name: "Allowed pack" } })
      );
      expect(allowed.ok, JSON.stringify(allowed.error ?? {})).toBe(true);
      expect(allowed.result.group.name).toBe("Allowed pack");
      expect(combat.groups.size).toBe(2);
      expect(combat.groups.get(allowed.result.group.id)._source.name).toBe("Allowed pack");
    });

    it("group.update's dry run reports the LIVE derived booleans, not the preview's reseeded pair", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const live = combat.groups.get(COMBAT_GROUP_A);
      expect([live.hidden, live.defeated]).toEqual([false, false]);

      const preview = await router().route(
        createRequest("combat.group.update", {
          combatId: "combat-1",
          groupId: COMBAT_GROUP_A,
          patch: { name: "Previewed" },
          dryRun: true
        })
      );
      expect(preview.ok).toBe(true);
      expect(preview.result.dryRun).toBe(true);
      expect(preview.result.group.name).toBe("Previewed");
      expect([preview.result.group.hidden, preview.result.group.defeated]).toEqual([false, false]);

      const real = await router().route(
        createRequest("combat.group.update", {
          combatId: "combat-1",
          groupId: COMBAT_GROUP_A,
          patch: { name: "Renamed" }
        })
      );
      expect(real.ok).toBe(true);
      expect([real.result.group.hidden, real.result.group.defeated]).toEqual([false, false]);
    });

    it("canonicalizes a group `img` too, so a WHITESPACE-only value is rejected not silently cleared", async () => {
      for (const params of [
        { combatId: "combat-1", data: { img: "   " } },
        { combatId: "combat-1", groupId: COMBAT_GROUP_A, patch: { img: "   " } }
      ]) {
        const command = "groupId" in params ? "combat.group.update" : "combat.group.create";
        const response = await router().route(createRequest(command, params));
        expect(response.ok, command).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
        expect(response.error.details.message).toContain("file extension");
      }

      const cleared = await router().route(
        createRequest("combat.group.update", {
          combatId: "combat-1",
          groupId: COMBAT_GROUP_A,
          patch: { img: null }
        })
      );
      expect(cleared.ok).toBe(true);
      expect(cleared.result.group.img).toBeNull();
    });

    it("rejects a raw `ownership` write and every meta field on both group write verbs", async () => {
      for (const payload of [{ ownership: { default: 3 } }, { _id: "spoof" }, { _stats: {} }, { img: "" }]) {
        const created = await router().route(
          createRequest("combat.group.create", { combatId: "combat-1", data: payload })
        );
        expect(created.ok, `create ${JSON.stringify(payload)}`).toBe(false);
        expect(created.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
        const updated = await router().route(
          createRequest("combat.group.update", {
            combatId: "combat-1",
            groupId: COMBAT_GROUP_A,
            patch: payload
          })
        );
        expect(updated.ok, `update ${JSON.stringify(payload)}`).toBe(false);
        expect(updated.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      }

      expect(globalThis.game.combats.get("combat-1").groups.get(COMBAT_GROUP_A)._source.ownership).toEqual({
        default: 0,
        aaaaaaaaaa111111: 2
      });
    });

    it("updates a group, keeps `initiative` writable, confirms against stored state and previews without writing", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const group = combat.groups.get(COMBAT_GROUP_A);

      const ok = await router().route(
        createRequest("combat.group.update", {
          combatId: "combat-1",
          groupId: COMBAT_GROUP_A,
          patch: { initiative: 21 }
        })
      );
      expect(ok.ok).toBe(true);
      expect(ok.result.group.initiative).toBe(21);
      expect(group._source.initiative).toBe(21);

      const cleared = await router().route(
        createRequest("combat.group.update", {
          combatId: "combat-1",
          groupId: COMBAT_GROUP_A,
          patch: { initiative: null }
        })
      );
      expect(cleared.result.group.initiative).toBeNull();

      const preview = await router().route(
        createRequest("combat.group.update", {
          combatId: "combat-1",
          groupId: COMBAT_GROUP_A,
          patch: { name: "Renamed" },
          dryRun: true
        })
      );
      expect(preview.result.dryRun).toBe(true);
      expect(preview.result.group.name).toBe("Renamed");
      expect(group._source.name).toBe("Goblins");

      combat.vetoGroupUpdates = new Set([COMBAT_GROUP_A]);
      const vetoed = await router().route(
        createRequest("combat.group.update", {
          combatId: "combat-1",
          groupId: COMBAT_GROUP_A,
          patch: { name: "Nope" }
        })
      );
      expect(vetoed.ok).toBe(false);
      expect(vetoed.error.message).toContain("preUpdateCombatantGroup");
      expect(group._source.name).toBe("Goblins");
    });

    it("group delete REPORTS the members left holding a dangling group id (Foundry clears nothing)", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const preview = await router().route(
        createRequest("combat.group.delete", { combatId: "combat-1", groupId: COMBAT_GROUP_A, dryRun: true })
      );
      expect(preview.result).toEqual({
        combatId: "combat-1",
        id: COMBAT_GROUP_A,
        deleted: false,

        danglingCombatantIds: ["combatant-2"],
        dryRun: true,
        approvalRequired: true
      });
      expect(combat.groups.size).toBe(1);

      const response = await router().route(
        createRequest("combat.group.delete", { combatId: "combat-1", groupId: COMBAT_GROUP_A })
      );
      expect(response.result).toEqual({
        combatId: "combat-1",
        id: COMBAT_GROUP_A,
        deleted: true,
        danglingCombatantIds: ["combatant-2"]
      });
      expect(combat.groups.get(COMBAT_GROUP_A)).toBeNull();

      expect(combat.combatants.get("combatant-2")._source.group).toBe(COMBAT_GROUP_A);
    });

    it("refuses to report a VETOED group delete as deleted", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      combat.vetoGroupDeletes = new Set([COMBAT_GROUP_A]);
      const response = await router().route(
        createRequest("combat.group.delete", { combatId: "combat-1", groupId: COMBAT_GROUP_A })
      );
      expect(response.ok).toBe(false);
      expect(response.error.message).toContain("preDeleteCombatantGroup");
      expect(combat.groups.get(COMBAT_GROUP_A)).not.toBeNull();
    });

    it("serializes ALL SIX mutating combatant/group writes on the SAME queue as combat.update", async () => {
      const combat = globalThis.game.combats.get("combat-1");
      const events = [];
      /** @type {() => void} */
      let release = () => {};
      const gate = new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      combat.update = vi.fn(async (patch) => {
        events.push("combat.update-start");
        await gate;
        events.push("combat.update-end");
        Object.assign(combat, patch);
        return combat;
      });
      const originalCreate = combat.createEmbeddedDocuments;
      combat.createEmbeddedDocuments = vi.fn(async (...args) => {
        events.push(`create:${args[0]}`);
        return originalCreate(...args);
      });
      const originalUpdate = combat.updateEmbeddedDocuments;
      combat.updateEmbeddedDocuments = vi.fn(async (...args) => {
        events.push(`update:${args[0]}`);
        return originalUpdate(...args);
      });
      const originalDelete = combat.deleteEmbeddedDocuments;
      combat.deleteEmbeddedDocuments = vi.fn(async (...args) => {
        events.push(`delete:${args[0]}`);
        return originalDelete(...args);
      });

      const pending = [
        router().route(createRequest("combat.update", { combatId: "combat-1", patch: { sort: 9 } })),
        router().route(
          createRequest("combat.combatant.create", { combatId: "combat-1", data: { name: "Queued" } })
        ),
        router().route(
          createRequest("combat.combatant.update", {
            combatId: "combat-1",
            combatantId: "combatant-1",
            patch: { hidden: true }
          })
        ),
        router().route(
          createRequest("combat.combatant.delete", { combatId: "combat-1", combatantId: "combatant-1" })
        ),
        router().route(
          createRequest("combat.group.create", { combatId: "combat-1", data: { name: "Queued pack" } })
        ),
        router().route(
          createRequest("combat.group.update", {
            combatId: "combat-1",
            groupId: COMBAT_GROUP_A,
            patch: { name: "Queued name" }
          })
        ),
        router().route(
          createRequest("combat.group.delete", { combatId: "combat-1", groupId: COMBAT_GROUP_A })
        )
      ];
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(events).toEqual(["combat.update-start"]);
      release();
      const responses = await Promise.all(pending);
      expect(
        responses.map((response) => response.ok),
        JSON.stringify(responses.map((response) => response.error ?? null))
      ).toEqual([true, true, true, true, true, true, true]);

      expect(events).toEqual([
        "combat.update-start",
        "combat.update-end",
        "create:Combatant",
        "update:Combatant",
        "delete:Combatant",
        "create:CombatantGroup",
        "update:CombatantGroup",
        "delete:CombatantGroup"
      ]);
    });

    it("gates every combatant/group write behind the GM permission check, reads stay open", async () => {
      globalThis.game.user.isGM = false;
      for (const request of [
        createRequest("combat.combatant.create", { combatId: "combat-1", data: {} }),
        createRequest("combat.combatant.update", {
          combatId: "combat-1",
          combatantId: "combatant-1",
          patch: { hidden: true }
        }),
        createRequest("combat.combatant.delete", { combatId: "combat-1", combatantId: "combatant-1" }),
        createRequest("combat.group.create", { combatId: "combat-1", data: {} }),
        createRequest("combat.group.update", {
          combatId: "combat-1",
          groupId: COMBAT_GROUP_A,
          patch: { name: "x" }
        }),
        createRequest("combat.group.delete", { combatId: "combat-1", groupId: COMBAT_GROUP_A })
      ]) {
        const response = await router().route(request);
        expect(response.ok, request.command).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.PERMISSION_DENIED);
      }
      expect(
        (await router().route(createRequest("combat.combatant.list", { combatId: "combat-1" }))).error.code
      ).toBe(ERROR_CODES.PERMISSION_DENIED);
      expect(
        (await router().route(createRequest("combat.group.list", { combatId: "combat-1" }))).error.code
      ).toBe(ERROR_CODES.PERMISSION_DENIED);
    });
  });

  describe("combat ACTION verbs", () => {
    const router = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const KEY = { idempotencyKey: "adv-key" };
    /**
     * @param {string} id
     * @param {Record<string, any>} [overrides]
     */
    const seedCombat = (id, overrides = {}) => {
      const combat = createCombatDocument(id, {
        scene: COMBAT_SCENE_A,
        combatants: [
          { id: `${id}-a`, name: "A", sceneId: COMBAT_SCENE_A },
          { id: `${id}-b`, name: "B", sceneId: COMBAT_SCENE_A },
          { id: `${id}-c`, name: "C", sceneId: COMBAT_SCENE_A }
        ],
        ...overrides
      });
      globalThis.game.combats.set(combat);
      return combat;
    };
    const stored = (combat) => ({ round: combat._source.round, turn: combat._source.turn });

    it("combat.start begins an unstarted encounter and reports the OBSERVED transition", async () => {
      const combat = seedCombat("cbt-start");
      const response = await router().route(createRequest("combat.start", { combatId: "cbt-start" }));
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result).toMatchObject({
        combatId: "cbt-start",
        started: true,
        alreadyStarted: false,
        transition: "round",
        roundBefore: 0,
        turnBefore: null
      });
      expect(stored(combat)).toEqual({ round: 1, turn: 0 });
      expect(response.result.combat.round).toBe(1);
      expect(response.result.combat.turn).toBe(0);
      expect(response.result.combat.started).toBe(true);

      expect(combat._source.active).toBe(false);
    });

    it("combat.start on an ALREADY-STARTED combat calls NOTHING (the rewind guard)", async () => {
      const combat = seedCombat("cbt-started", { round: 3, turn: 1 });
      const response = await router().route(createRequest("combat.start", { combatId: "cbt-started" }));
      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({
        alreadyStarted: true,
        started: true,
        transition: "none",
        roundBefore: 3,
        turnBefore: 1
      });
      expect(combat.startCombat).not.toHaveBeenCalled();
      expect(stored(combat)).toEqual({ round: 3, turn: 1 });
    });

    it("combat.start reads the guard from the STORED round, not the live one setupTurns corrupts", async () => {
      const combat = seedCombat("cbt-live-round", { derivedRound: 4, derivedTurn: 0 });
      const response = await router().route(createRequest("combat.start", { combatId: "cbt-live-round" }));
      expect(response.ok).toBe(true);
      expect(response.result.alreadyStarted).toBe(false);
      expect(combat.startCombat).toHaveBeenCalledTimes(1);
    });

    it("combat.start dry-run calls nothing and reports current state", async () => {
      const combat = seedCombat("cbt-start-dry");
      const response = await router().route(
        createRequest("combat.start", { combatId: "cbt-start-dry", dryRun: true })
      );
      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);

      expect(Object.keys(response.result).sort()).toEqual(
        [
          "alreadyStarted",
          "combat",
          "combatId",
          "dryRun",
          "roundBefore",
          "started",
          "transition",
          "turnBefore"
        ].sort()
      );
      expect(combat.startCombat).not.toHaveBeenCalled();
      expect(stored(combat)).toEqual({ round: 0, turn: null });
    });

    it("combat.start raises INTERNAL_ERROR when a hook keeps round 0 (a write that landed as something else)", async () => {
      const combat = seedCombat("cbt-start-rewritten");
      combat.startCombat = vi.fn(async () => {
        combat._source.turn = 0;
        combat.turn = 0;
        return combat;
      });
      const response = await router().route(
        createRequest("combat.start", { combatId: "cbt-start-rewritten" })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("was NOT started");
      expect(response.error.details).toMatchObject({ combatId: "cbt-start-rewritten", round: 0, turn: 0 });
      expect(stored(combat)).toEqual({ round: 0, turn: 0 });
    });

    it("combat.start raises INTERNAL_ERROR when the write is vetoed (a resolved call is not evidence)", async () => {
      const combat = seedCombat("cbt-start-veto");
      combat.vetoCombatUpdates = true;
      const response = await router().route(createRequest("combat.start", { combatId: "cbt-start-veto" }));
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("did not change combat");
      expect(stored(combat)).toEqual({ round: 0, turn: null });
    });

    it("combat.activate reports the combats Foundry deactivated WORLD-wide", async () => {
      const combat = seedCombat("cbt-activate");
      const response = await router().route(createRequest("combat.activate", { combatId: "cbt-activate" }));
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result).toMatchObject({
        combatId: "cbt-activate",
        active: true,
        alreadyActive: false,
        otherActiveCombatIdsBefore: ["combat-1"]
      });
      expect(combat._source.active).toBe(true);

      expect(response.result.deactivatedCombatIds).toEqual(["combat-1"]);
      expect(response.result.otherActiveCombatIdsAfter).toEqual([]);
      expect(globalThis.game.combats.get("combat-1")._source.active).toBe(false);

      expect(response.result.activationObservation).toBeUndefined();
    });

    it("combat.activate treats the EMPTY DIFF of an already-active combat as success, not failure", async () => {
      const response = await router().route(createRequest("combat.activate", { combatId: "combat-1" }));
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.active).toBe(true);
      expect(response.result.alreadyActive).toBe(true);
    });

    it("combat.activate dry-run activates nothing and PREDICTS the world-wide deactivation", async () => {
      const combat = seedCombat("cbt-activate-dry");
      const response = await router().route(
        createRequest("combat.activate", { combatId: "cbt-activate-dry", dryRun: true })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.dryRun).toBe(true);

      expect(Object.keys(response.result).sort()).toEqual(
        [
          "active",
          "alreadyActive",
          "combat",
          "combatId",
          "deactivatedCombatIds",
          "dryRun",
          "otherActiveCombatIdsAfter",
          "otherActiveCombatIdsBefore"
        ].sort()
      );
      expect(response.result.otherActiveCombatIdsBefore).toEqual(["combat-1"]);
      expect(response.result.deactivatedCombatIds).toEqual(["combat-1"]);
      expect(response.result.otherActiveCombatIdsAfter).toEqual([]);

      expect(response.result.active).toBe(false);
      expect(response.result.alreadyActive).toBe(false);
      expect(response.result.combat.active).toBe(false);

      expect(combat.activate).not.toHaveBeenCalled();
      expect(combat._source.active).toBe(false);
      expect(globalThis.game.combats.get("combat-1")._source.active).toBe(true);
    });

    it("the activate dry-run predicts NO deactivation for an already-active target (empty diff)", async () => {
      const combat = seedCombat("cbt-activate-dry-active", { active: true });
      const response = await router().route(
        createRequest("combat.activate", { combatId: "cbt-activate-dry-active", dryRun: true })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(combat.activate).not.toHaveBeenCalled();
      expect(response.result.alreadyActive).toBe(true);
      expect(response.result.deactivatedCombatIds).toEqual([]);
      expect(response.result.otherActiveCombatIdsAfter).toEqual(["combat-1"]);
    });

    it("combat.activate confirms from STORED state, not from a truthy resolution", async () => {
      const combat = seedCombat("cbt-activate-rewritten");
      combat.activate = vi.fn(async () => combat);
      const response = await router().route(
        createRequest("combat.activate", { combatId: "cbt-activate-rewritten" })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("is NOT active");
      expect(combat._source.active).toBe(false);
    });

    it("combat.activate raises INTERNAL_ERROR when the activation is vetoed", async () => {
      const combat = seedCombat("cbt-activate-veto");
      combat.vetoCombatUpdates = true;
      const response = await router().route(
        createRequest("combat.activate", { combatId: "cbt-activate-veto" })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(combat._source.active).toBe(false);
    });

    it("combat.next-turn advances the turn inside the round", async () => {
      const combat = seedCombat("cbt-next-turn", { round: 2, turn: 0 });
      const response = await router().route(
        createRequest("combat.next-turn", { combatId: "cbt-next-turn", ...KEY })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result).toMatchObject({ transition: "turn", roundBefore: 2, turnBefore: 0 });
      expect(stored(combat)).toEqual({ round: 2, turn: 1 });
    });

    it("combat.next-turn on the LAST combatant reports a ROUND transition (Foundry delegates)", async () => {
      const combat = seedCombat("cbt-last-turn", { round: 2, turn: 2 });
      const response = await router().route(
        createRequest("combat.next-turn", { combatId: "cbt-last-turn", ...KEY })
      );
      expect(response.ok).toBe(true);
      expect(response.result.transition).toBe("round");
      expect(stored(combat)).toEqual({ round: 3, turn: 0 });
    });

    it("combat.previous-turn at round 1 turn 0 UN-STARTS the encounter, and the body shows it", async () => {
      const combat = seedCombat("cbt-unstart", { round: 1, turn: 0 });
      const response = await router().route(
        createRequest("combat.previous-turn", { combatId: "cbt-unstart", ...KEY })
      );
      expect(response.ok).toBe(true);
      expect(response.result.transition).toBe("round");
      expect(stored(combat)).toEqual({ round: 0, turn: null });
      expect(response.result.combat.started).toBe(false);
      expect(response.result.combat.currentCombatantId).toBeNull();
    });

    it("combat.next-round from round 0 is ALLOWED and lands turn null (no started gate)", async () => {
      const combat = seedCombat("cbt-next-round-0");
      const response = await router().route(
        createRequest("combat.next-round", { combatId: "cbt-next-round-0", ...KEY })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.transition).toBe("round");
      expect(stored(combat)).toEqual({ round: 1, turn: null });

      expect(response.result.combat.started).toBe(true);
      expect(response.result.combat.currentCombatantId).toBeNull();
    });

    it("refuses the three rewind/turn verbs on an UNSTARTED combat with COMBAT_NOT_STARTED", async () => {
      const combat = seedCombat("cbt-unstarted");
      for (const command of ["combat.next-turn", "combat.previous-turn", "combat.previous-round"]) {
        const response = await router().route(createRequest(command, { combatId: "cbt-unstarted", ...KEY }));
        expect(response.ok, command).toBe(false);
        expect(response.error.code, command).toBe(ERROR_CODES.COMBAT_NOT_STARTED);
        expect(response.error.message).toContain("combat start");
        expect(response.error.details).toMatchObject({ combatId: "cbt-unstarted", round: 0 });
      }
      expect(response_none(combat)).toBe(true);
    });

    function response_none(combat) {
      return (
        !combat.nextTurn.mock.calls.length &&
        !combat.previousTurn.mock.calls.length &&
        !combat.previousRound.mock.calls.length
      );
    }

    it("the COMBAT_NOT_STARTED gate fires on the DRY-RUN path too", async () => {
      seedCombat("cbt-unstarted-dry");
      const response = await router().route(
        createRequest("combat.previous-turn", { combatId: "cbt-unstarted-dry", dryRun: true, ...KEY })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMBAT_NOT_STARTED);
    });

    it("an advancement dry-run calls nothing and does NOT predict the resulting round/turn", async () => {
      const combat = seedCombat("cbt-adv-dry", { round: 2, turn: 1 });
      const response = await router().route(
        createRequest("combat.next-turn", { combatId: "cbt-adv-dry", dryRun: true, ...KEY })
      );
      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(Object.keys(response.result).sort()).toEqual(
        ["combat", "combatId", "dryRun", "roundBefore", "transition", "turnBefore"].sort()
      );
      expect(response.result.transition).toBe("none");

      expect(response.result.combat.round).toBe(2);
      expect(response.result.combat.turn).toBe(1);
      expect(combat.nextTurn).not.toHaveBeenCalled();
      expect(stored(combat)).toEqual({ round: 2, turn: 1 });
    });

    it("an advancement raises INTERNAL_ERROR when the write is vetoed (transition would be 'none')", async () => {
      const combat = seedCombat("cbt-adv-veto", { round: 2, turn: 0 });
      combat.vetoCombatUpdates = true;
      const response = await router().route(
        createRequest("combat.next-turn", { combatId: "cbt-adv-veto", ...KEY })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("did not change combat");
      expect(stored(combat)).toEqual({ round: 2, turn: 0 });
    });

    it("PRECONDITION_FAILED when the caller's expected round/turn does not match STORED state", async () => {
      const combat = seedCombat("cbt-precondition", { round: 2, turn: 1 });
      const response = await router().route(
        createRequest("combat.next-turn", { combatId: "cbt-precondition", expectedRound: 5, ...KEY })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.PRECONDITION_FAILED);
      expect(response.error.details).toEqual({
        combatId: "cbt-precondition",
        expectedRound: 5,
        round: 2,
        turn: 1
      });
      expect(combat.nextTurn).not.toHaveBeenCalled();
    });

    it("a MATCHING expectation lets the advance through, and expectedTurn:null is a real expectation", async () => {
      const matching = seedCombat("cbt-precondition-ok", { round: 2, turn: 1 });
      expect(
        (
          await router().route(
            createRequest("combat.next-turn", {
              combatId: "cbt-precondition-ok",
              expectedRound: 2,
              expectedTurn: 1,
              ...KEY
            })
          )
        ).ok
      ).toBe(true);
      expect(stored(matching)).toEqual({ round: 2, turn: 2 });

      const nullTurn = seedCombat("cbt-precondition-null", { round: 2, turn: null });
      expect(
        (
          await router().route(
            createRequest("combat.next-round", {
              combatId: "cbt-precondition-null",
              expectedTurn: null,
              ...KEY
            })
          )
        ).ok
      ).toBe(true);
      const mismatch = await router().route(
        createRequest("combat.next-round", { combatId: "cbt-precondition-ok", expectedTurn: null, ...KEY })
      );
      expect(mismatch.ok).toBe(false);
      expect(mismatch.error.code).toBe(ERROR_CODES.PRECONDITION_FAILED);
      expect(mismatch.error.details).toMatchObject({ expectedTurn: null, turn: 2 });
    });

    const seedDivergedCombat = (id) =>
      seedCombat(id, {
        round: 1,
        turn: 5,

        derivedRound: 2,
        derivedTurn: 0
      });

    it("refuses all four advancement verbs when the LIVE pair has DRIFTED from the stored one", async () => {
      for (const command of [
        "combat.next-turn",
        "combat.previous-turn",
        "combat.next-round",
        "combat.previous-round"
      ]) {
        const combat = seedDivergedCombat(`cbt-diverged-${command}`);
        const response = await router().route(
          createRequest(command, { combatId: `cbt-diverged-${command}`, ...KEY })
        );
        expect(response.ok, command).toBe(false);
        expect(response.error.code, command).toBe(ERROR_CODES.COMBAT_STATE_DIVERGED);

        expect(response.error.details).toEqual({
          combatId: `cbt-diverged-${command}`,
          round: 1,
          turn: 5,
          liveRound: 2,
          liveTurn: 0
        });

        expect(response.error.message).toContain("combat start");
        expect(response.error.message).toContain("combat reset-initiative");

        expect(combat.nextTurn).not.toHaveBeenCalled();
        expect(combat.previousTurn).not.toHaveBeenCalled();
        expect(combat.nextRound).not.toHaveBeenCalled();
        expect(combat.previousRound).not.toHaveBeenCalled();
        expect(stored(combat)).toEqual({ round: 1, turn: 5 });
      }
    });

    it("the divergence the gate refuses really would move the encounter somewhere else", async () => {
      const combat = seedDivergedCombat("cbt-diverged-proof");
      await combat.nextRound();
      expect(stored(combat)).toEqual({ round: 3, turn: 0 });
    });

    it("the convergence gate fires on the DRY-RUN path too", async () => {
      const combat = seedDivergedCombat("cbt-diverged-dry");
      const response = await router().route(
        createRequest("combat.next-turn", { combatId: "cbt-diverged-dry", dryRun: true, ...KEY })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMBAT_STATE_DIVERGED);
      expect(combat.nextTurn).not.toHaveBeenCalled();
    });

    it("the convergence gate does NOT fire on a normal encounter, or at round 0 (over-refusal arm)", async () => {
      const inRange = seedCombat("cbt-converged", { round: 1, turn: 0 });
      const advanced = await router().route(
        createRequest("combat.next-turn", { combatId: "cbt-converged", ...KEY })
      );
      expect(advanced.ok, JSON.stringify(advanced.error ?? {})).toBe(true);
      expect(stored(inRange)).toEqual({ round: 1, turn: 1 });

      const unstarted = seedCombat("cbt-converged-zero");
      const roundAdvance = await router().route(
        createRequest("combat.next-round", { combatId: "cbt-converged-zero", ...KEY })
      );
      expect(roundAdvance.ok, JSON.stringify(roundAdvance.error ?? {})).toBe(true);
      expect(stored(unstarted)).toEqual({ round: 1, turn: null });
    });

    it("the convergence gate is the LAST state check: a stale expectation and an unstarted combat win", async () => {
      seedDivergedCombat("cbt-diverged-order");
      const staleExpectation = await router().route(
        createRequest("combat.next-turn", { combatId: "cbt-diverged-order", expectedRound: 9, ...KEY })
      );
      expect(staleExpectation.ok).toBe(false);
      expect(staleExpectation.error.code).toBe(ERROR_CODES.PRECONDITION_FAILED);

      seedCombat("cbt-diverged-unstarted", { round: 0, turn: 3, derivedRound: 1, derivedTurn: 0 });
      const unstarted = await router().route(
        createRequest("combat.previous-turn", { combatId: "cbt-diverged-unstarted", ...KEY })
      );
      expect(unstarted.ok).toBe(false);
      expect(unstarted.error.code).toBe(ERROR_CODES.COMBAT_NOT_STARTED);
    });

    it("the precondition fires on the DRY-RUN path and BEFORE the started gate (guard order)", async () => {
      seedCombat("cbt-precondition-order");
      const dry = await router().route(
        createRequest("combat.next-turn", {
          combatId: "cbt-precondition-order",
          expectedRound: 9,
          dryRun: true,
          ...KEY
        })
      );
      expect(dry.ok).toBe(false);
      expect(dry.error.code).toBe(ERROR_CODES.PRECONDITION_FAILED);

      const both = await router().route(
        createRequest("combat.previous-turn", {
          combatId: "cbt-precondition-order",
          expectedRound: 9,
          ...KEY
        })
      );
      expect(both.ok).toBe(false);
      expect(both.error.code).toBe(ERROR_CODES.PRECONDITION_FAILED);
    });

    it("combat.reset-initiative clears every initiative and counts the rows that HELD one", async () => {
      const combat = seedCombat("cbt-reset", {
        round: 1,
        turn: 0,
        combatants: [
          { id: "reset-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 12 },
          { id: "reset-b", name: "B", sceneId: COMBAT_SCENE_A, initiative: 3 },
          { id: "reset-c", name: "C", sceneId: COMBAT_SCENE_A }
        ]
      });
      const response = await router().route(
        createRequest("combat.reset-initiative", { combatId: "cbt-reset" })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);

      expect(response.result).toMatchObject({ combatId: "cbt-reset", reset: true, changedCount: 2 });
      expect(combat.resetAll).toHaveBeenCalledTimes(1);
      expect(response.result.combat.turns.map((turn) => turn.initiative)).toEqual([null, null, null]);
    });

    it("combat.reset-initiative counts STORED initiative, not a group's live override", async () => {
      seedCombat("cbt-reset-group", {
        round: 1,
        turn: 0,
        groups: [{ id: "reset-grp-000000", name: "Pack", initiative: 15 }],
        combatants: [
          {
            id: "reset-grp-a",
            name: "A",
            sceneId: COMBAT_SCENE_A,
            group: "reset-grp-000000",
            derived: { initiative: 15 }
          }
        ]
      });
      const response = await router().route(
        createRequest("combat.reset-initiative", { combatId: "cbt-reset-group" })
      );
      expect(response.ok).toBe(true);
      expect(response.result.changedCount).toBe(0);
    });

    it("combat.reset-initiative dry-run projects the MERGED post-state and writes nothing", async () => {
      const combat = seedCombat("cbt-reset-dry", {
        round: 1,
        turn: 0,
        combatants: [{ id: "reset-dry-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 9 }]
      });
      const response = await router().route(
        createRequest("combat.reset-initiative", { combatId: "cbt-reset-dry", dryRun: true })
      );
      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(Object.keys(response.result).sort()).toEqual(
        ["changedCount", "combat", "combatId", "dryRun", "reset"].sort()
      );
      expect(response.result.reset).toBe(false);
      expect(response.result.changedCount).toBe(1);

      expect(response.result.combat.turns[0].initiative).toBeNull();

      expect(response.result.combat.turn).toBe(0);
      expect(response.result.combat.currentCombatantId).toBe("reset-dry-a");
      expect(combat.resetAll).not.toHaveBeenCalled();

      expect(combat.combatants.get("reset-dry-a")._source.initiative).toBe(9);
    });

    it("combat.reset-initiative raises INTERNAL_ERROR when the WHOLE update is refused", async () => {
      const combat = seedCombat("cbt-reset-veto", {
        round: 1,
        turn: 0,
        combatants: [
          { id: "reset-veto-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 12 },
          { id: "reset-veto-b", name: "B", sceneId: COMBAT_SCENE_A, initiative: 4 }
        ]
      });
      combat.vetoCombatUpdates = true;
      const response = await router().route(
        createRequest("combat.reset-initiative", { combatId: "cbt-reset-veto" })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);

      expect(response.error.details).toMatchObject({ combatId: "cbt-reset-veto", changedCount: 2 });
      expect(response.error.details.combatantIds).toBeUndefined();
      expect(response.error.message).toContain("preUpdateCombat hook");
      expect(response.error.message).toContain("RELOADED");
      expect(combat.resetAll).toHaveBeenCalledTimes(1);

      expect(globalThis.Hooks._listeners.get("updateCombat") ?? []).toEqual([]);
    });

    it("combat.reset-initiative SKIPS the dispatch confirmation when no Hooks API is available", async () => {
      seedCombat("cbt-reset-nohooks", {
        round: 1,
        turn: 0,
        combatants: [{ id: "reset-nohooks-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 8 }]
      });
      const previousHooks = globalThis.Hooks;
      globalThis.Hooks = undefined;
      try {
        const response = await router().route(
          createRequest("combat.reset-initiative", { combatId: "cbt-reset-nohooks" })
        );
        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        expect(response.result).toMatchObject({ reset: true, changedCount: 1 });
      } finally {
        globalThis.Hooks = previousHooks;
      }
    });

    it("combat.reset-initiative with NOTHING set skips the confirmation (no spurious failure)", async () => {
      const combat = seedCombat("cbt-reset-noop", { round: 1, turn: 0 });
      combat.vetoCombatUpdates = true;
      const response = await router().route(
        createRequest("combat.reset-initiative", { combatId: "cbt-reset-noop" })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result).toMatchObject({ reset: true, changedCount: 0 });
    });

    it("combat.reset-initiative does NOT blame a CONCURRENT roll when nothing was set", async () => {
      const combat = seedCombat("cbt-reset-concurrent", {
        round: 1,
        turn: 0,
        combatants: [{ id: "reset-conc-a", name: "A", sceneId: COMBAT_SCENE_A }],
        concurrentInitiativeOnReset: { combatantId: "reset-conc-a", initiative: 19 }
      });
      const response = await router().route(
        createRequest("combat.reset-initiative", { combatId: "cbt-reset-concurrent" })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result).toMatchObject({ reset: true, changedCount: 0 });

      expect(combat.combatants.get("reset-conc-a")._source.initiative).toBe(19);
    });

    it("combat.reset-initiative DOES raise when a row that HELD an initiative holds one again", async () => {
      const combat = seedCombat("cbt-reset-relanded", {
        round: 1,
        turn: 0,
        combatants: [
          { id: "reset-relanded-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 11 },
          { id: "reset-relanded-b", name: "B", sceneId: COMBAT_SCENE_A, initiative: 6 }
        ],
        concurrentInitiativeOnReset: { combatantId: "reset-relanded-b", initiative: 20 }
      });
      const response = await router().route(
        createRequest("combat.reset-initiative", { combatId: "cbt-reset-relanded" })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details).toMatchObject({
        combatId: "cbt-reset-relanded",
        changedCount: 2,
        combatantIds: ["reset-relanded-b"]
      });

      expect(combat.combatants.get("reset-relanded-a")._source.initiative).toBeNull();
      expect(response.error.message).toContain("DID dispatch");
    });

    it("combat.reset-initiative reports the DISPATCH failure first when both checks apply", async () => {
      const combat = seedCombat("cbt-reset-order", {
        round: 1,
        turn: 0,
        combatants: [{ id: "reset-order-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 14 }],
        concurrentInitiativeOnReset: { combatantId: "reset-order-a", initiative: 21 }
      });
      combat.vetoCombatUpdates = true;
      const response = await router().route(
        createRequest("combat.reset-initiative", { combatId: "cbt-reset-order" })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details.combatantIds).toBeUndefined();
      expect(response.error.message).toContain("never dispatched");
    });

    it("combat.roll-initiative rolls the requested ids and reports the STORED result per row", async () => {
      const combat = seedCombat("cbt-roll", { round: 1, turn: 0 });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll",
          combatantIds: ["cbt-roll-a", "cbt-roll-b"],
          idempotencyKey: "roll-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result).toMatchObject({
        combatId: "cbt-roll",
        complete: true,
        mutation: "committed",
        select: "ids",
        targetedCombatantIds: ["cbt-roll-a", "cbt-roll-b"],
        unconfirmedCombatantIds: []
      });
      expect(response.result.rolled).toEqual([
        { combatantId: "cbt-roll-a", initiativeBefore: null, initiative: 10 },
        { combatantId: "cbt-roll-b", initiativeBefore: null, initiative: 11 }
      ]);

      expect(response.result.chatMessages.status).toBe("captured");
      expect(response.result.chatMessages.expectedCount).toBe(2);
      expect(response.result.chatMessages.ids).toHaveLength(2);
      expect(combat.combatants.get("cbt-roll-c")._source.initiative).toBeNull();
    });

    it("combat.roll-initiative sends an explicit roll mode in the PER-VERSION placement", async () => {
      const combat = seedCombat("cbt-roll-mode", { round: 1, turn: 0 });
      const rollGm = (idempotencyKey) =>
        router().route(
          createRequest("combat.roll-initiative", {
            combatId: "cbt-roll-mode",
            combatantIds: ["cbt-roll-mode-a"],
            rollMode: "gm",
            idempotencyKey
          })
        );
      const v13Response = await rollGm("roll-mode-1");

      expect(combat.lastRollInitiativeOptions.messageMode).toBeUndefined();
      expect(combat.lastRollInitiativeOptions.messageOptions.rollMode).toBe("gmroll");

      const flags = combat.lastRollInitiativeOptions.messageOptions.flags;
      expect(Object.keys(flags)).toEqual(["fvtt-world-cli"]);
      expect(typeof flags["fvtt-world-cli"].correlationId).toBe("string");
      expect(v13Response.result.chatMessages.status).toBe("captured");
      expect(v13Response.result.chatMessages.ids).toHaveLength(1);

      const v13ExplicitCorrelation = flags["fvtt-world-cli"].correlationId;
      globalThis.game.release = { version: "13.351", generation: 13 };
      try {
        combat.combatants.get("cbt-roll-mode-a")._source.initiative = null;
        combat.combatants.get("cbt-roll-mode-a").initiative = null;
        const v13ExplicitResponse = await rollGm("roll-mode-13");
        expect(combat.lastRollInitiativeOptions.messageMode).toBeUndefined();
        expect(combat.lastRollInitiativeOptions.messageOptions.rollMode).toBe("gmroll");
        const explicitFlags = combat.lastRollInitiativeOptions.messageOptions.flags;
        expect(explicitFlags["fvtt-world-cli"].correlationId).not.toBe(v13ExplicitCorrelation);
        expect(v13ExplicitResponse.result.chatMessages.status).toBe("captured");
        expect(v13ExplicitResponse.result.chatMessages.ids).toHaveLength(1);
      } finally {
        delete globalThis.game.release;
      }

      globalThis.game.release = { version: "14.365", generation: 14 };
      try {
        combat.combatants.get("cbt-roll-mode-a")._source.initiative = null;
        combat.combatants.get("cbt-roll-mode-a").initiative = null;
        const v14Response = await rollGm("roll-mode-2");
        expect(combat.lastRollInitiativeOptions.messageMode).toBe("gm");
        expect(combat.lastRollInitiativeOptions.messageOptions.rollMode).toBeUndefined();
        const v14Flags = combat.lastRollInitiativeOptions.messageOptions.flags;
        expect(Object.keys(v14Flags)).toEqual(["fvtt-world-cli"]);
        expect(typeof v14Flags["fvtt-world-cli"].correlationId).toBe("string");
        expect(v14Response.result.chatMessages.status).toBe("captured");
        expect(v14Response.result.chatMessages.ids).toHaveLength(1);
      } finally {
        delete globalThis.game.release;
      }
    });

    it("combat.roll-initiative defaults the mode to public rather than the GM client's setting", async () => {
      const combat = seedCombat("cbt-roll-default", { round: 1, turn: 0 });
      await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-default",
          combatantIds: ["cbt-roll-default-a"],
          idempotencyKey: "roll-default-1"
        })
      );
      expect(combat.lastRollInitiativeOptions.messageOptions.rollMode).toBe("publicroll");
    });

    it("combat.roll-initiative forwards Foundry's own formula override", async () => {
      const combat = seedCombat("cbt-roll-formula", { round: 1, turn: 0 });
      await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-formula",
          combatantIds: ["cbt-roll-formula-a"],
          formula: "2d20kh",
          idempotencyKey: "roll-formula-1"
        })
      );
      expect(combat.lastRollInitiativeOptions.formula).toBe("2d20kh");
    });

    it("combat.roll-initiative REFUSES an unknown id instead of letting Foundry skip it silently", async () => {
      const combat = seedCombat("cbt-roll-unknown", { round: 1, turn: 0 });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-unknown",
          combatantIds: ["cbt-roll-unknown-a", "nope"],
          idempotencyKey: "roll-unknown-1"
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMBATANT_NOT_FOUND);
      expect(response.error.details.combatantIds).toEqual(["nope"]);

      expect(combat.rollInitiative).not.toHaveBeenCalled();
      expect(combat.combatants.get("cbt-roll-unknown-a")._source.initiative).toBeNull();
    });

    it("combat.roll-initiative REFUSES an UNOWNED id, which Foundry skips just as silently", async () => {
      const combat = seedCombat("cbt-roll-unowned", {
        round: 1,
        turn: 0,
        combatants: [
          { id: "roll-unowned-a", name: "A", sceneId: COMBAT_SCENE_A },
          { id: "roll-unowned-b", name: "B", sceneId: COMBAT_SCENE_A, isOwner: false }
        ]
      });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-unowned",
          combatantIds: ["roll-unowned-a", "roll-unowned-b"],
          idempotencyKey: "roll-unowned-1"
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.message).toContain("not owned by this Foundry session");

      expect(response.error.details.combatantIds).toEqual(["roll-unowned-b"]);

      expect(combat.rollInitiative).not.toHaveBeenCalled();
      expect(combat.combatants.get("roll-unowned-a")._source.initiative).toBeNull();
    });

    it("the roll-initiative unowned refusal fires on the DRY-RUN path too", async () => {
      const combat = seedCombat("cbt-roll-dry-unowned", {
        round: 1,
        turn: 0,
        combatants: [{ id: "roll-dry-unowned-a", name: "A", sceneId: COMBAT_SCENE_A, isOwner: false }]
      });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-dry-unowned",
          combatantIds: ["roll-dry-unowned-a"],
          dryRun: true,
          idempotencyKey: "roll-dry-unowned-1"
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.details.combatantIds).toEqual(["roll-dry-unowned-a"]);
      expect(combat.rollInitiative).not.toHaveBeenCalled();
    });

    it("the UNKNOWN-id refusal PRECEDES the unowned one when both apply", async () => {
      seedCombat("cbt-roll-both", {
        round: 1,
        turn: 0,
        combatants: [{ id: "roll-both-a", name: "A", sceneId: COMBAT_SCENE_A, isOwner: false }]
      });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-both",
          combatantIds: ["roll-both-a", "nope"],
          idempotencyKey: "roll-both-1"
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMBATANT_NOT_FOUND);
      expect(response.error.details.combatantIds).toEqual(["nope"]);
    });

    it("combat.roll-initiative REFUSES a REPEATED id, which core would roll (and announce) twice", async () => {
      const combat = seedCombat("cbt-roll-dup", { round: 1, turn: 0 });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-dup",
          combatantIds: ["cbt-roll-dup-a", "cbt-roll-dup-b", "cbt-roll-dup-a"],
          idempotencyKey: "roll-dup-1"
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.message).toContain("listed more than once");

      expect(response.error.details.combatantIds).toEqual(["cbt-roll-dup-a"]);

      expect(combat.rollInitiative).not.toHaveBeenCalled();
      expect(combat.combatants.get("cbt-roll-dup-b")._source.initiative).toBeNull();

      const ok = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-dup",
          combatantIds: ["cbt-roll-dup-a", "cbt-roll-dup-b"],
          idempotencyKey: "roll-dup-2"
        })
      );
      expect(ok.ok, JSON.stringify(ok.error ?? {})).toBe(true);
      expect(ok.result.mutation).toBe("committed");
      expect(ok.result.rolled).toHaveLength(2);
    });

    it("the roll-initiative DUPLICATE refusal precedes the unknown-id one and the dry-run branch", async () => {
      const combat = seedCombat("cbt-roll-dup-order", { round: 1, turn: 0 });
      const unknownTwice = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-dup-order",
          combatantIds: ["nope", "nope"],
          idempotencyKey: "roll-dup-order-1"
        })
      );
      expect(unknownTwice.ok).toBe(false);
      expect(unknownTwice.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(unknownTwice.error.details.combatantIds).toEqual(["nope"]);
      const dry = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-dup-order",
          combatantIds: ["cbt-roll-dup-order-a", "cbt-roll-dup-order-a"],
          dryRun: true,
          idempotencyKey: "roll-dup-order-2"
        })
      );
      expect(dry.ok).toBe(false);
      expect(dry.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(dry.error.details.combatantIds).toEqual(["cbt-roll-dup-order-a"]);
      expect(combat.rollInitiative).not.toHaveBeenCalled();
    });

    it("combat.roll-initiative requires EXACTLY ONE of combatantIds / select", async () => {
      seedCombat("cbt-roll-select", { round: 1, turn: 0 });
      for (const params of [
        { combatId: "cbt-roll-select", idempotencyKey: "k1" },
        {
          combatId: "cbt-roll-select",
          combatantIds: ["cbt-roll-select-a"],
          select: "all",
          idempotencyKey: "k2"
        }
      ]) {
        const response = await router().route(createRequest("combat.roll-initiative", params));
        expect(response.ok, JSON.stringify(params)).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
        expect(response.error.message).toContain("EXACTLY ONE");
      }
    });

    it("select:all/npc use core's own filters and derive expectedCount by OBSERVATION", async () => {
      const combat = seedCombat("cbt-roll-all", {
        round: 1,
        turn: 0,
        combatants: [
          { id: "roll-all-a", name: "A", sceneId: COMBAT_SCENE_A },
          { id: "roll-all-b", name: "B", sceneId: COMBAT_SCENE_A },
          { id: "roll-all-c", name: "C", sceneId: COMBAT_SCENE_A, initiative: 7 }
        ],

        systemRollsFewer: 1
      });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-all",
          select: "all",
          idempotencyKey: "roll-all-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.select).toBe("all");

      expect(response.result.targetedCombatantIds).toEqual(["roll-all-a", "roll-all-b"]);
      expect(response.result.rolled.map((row) => row.combatantId)).toEqual(["roll-all-a"]);
      expect(response.result.chatMessages).toMatchObject({ status: "captured", expectedCount: 1 });
      expect(response.result.complete).toBe(true);
      expect(response.result.mutation).toBe("committed");
      expect(combat.rollAll).toHaveBeenCalledTimes(1);
    });

    it("select:npc targets only NPC combatants without an initiative", async () => {
      seedCombat("cbt-roll-npc", {
        round: 1,
        turn: 0,
        combatants: [
          { id: "roll-npc-a", name: "A", sceneId: COMBAT_SCENE_A, isNPC: true },
          { id: "roll-npc-b", name: "B", sceneId: COMBAT_SCENE_A, isNPC: false }
        ]
      });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-npc",
          select: "npc",
          idempotencyKey: "npc-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.targetedCombatantIds).toEqual(["roll-npc-a"]);
    });

    it("select mode EXCLUDES an unowned combatant, the way core's own id collection does", async () => {
      const combat = seedCombat("cbt-roll-all-unowned", {
        round: 1,
        turn: 0,
        combatants: [
          { id: "roll-all-unowned-a", name: "A", sceneId: COMBAT_SCENE_A },
          { id: "roll-all-unowned-b", name: "B", sceneId: COMBAT_SCENE_A, isOwner: false }
        ]
      });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-all-unowned",
          select: "all",
          idempotencyKey: "roll-all-unowned-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.targetedCombatantIds).toEqual(["roll-all-unowned-a"]);

      expect(combat.combatants.get("roll-all-unowned-b")._source.initiative).toBeNull();
    });

    it("select:all names NO row for a vetoed write but reports the chat/stored COUNT gap", async () => {
      const combat = seedCombat("cbt-roll-all-veto", { round: 1, turn: 0 });
      combat.vetoCombatantUpdates = new Set(["cbt-roll-all-veto-b", "cbt-roll-all-veto-c"]);
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-all-veto",
          select: "all",
          idempotencyKey: "roll-all-veto-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.targetedCombatantIds).toHaveLength(3);
      expect(response.result.rolled.map((row) => row.combatantId)).toEqual(["cbt-roll-all-veto-a"]);

      expect(response.result.unconfirmedCombatantIds).toEqual([]);
      expect(response.result.unconfirmableCombatantIds).toEqual([]);

      expect(response.result.mutation).toBe("unknown");
      expect(response.result.complete).toBe(false);
      expect(response.result.chatMessages.ids).toHaveLength(3);
      expect(response.result.failure.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.result.failure.message).toContain("3 initiative chat message(s) for select:all");
      expect(response.result.failure.message).toContain(
        "only 1 combatant(s) show a stored initiative change"
      );
      expect(response.result.failure.message).toContain("--combatant-ids");

      expect(response.result.failure.message).not.toContain("are gone from the combat");
    });

    it("a WHOLLY refused select:all roll is reported as unknown, not as a clean no-op", async () => {
      const combat = seedCombat("cbt-roll-all-veto-total", { round: 1, turn: 0 });
      combat.vetoCombatantUpdates = new Set([
        "cbt-roll-all-veto-total-a",
        "cbt-roll-all-veto-total-b",
        "cbt-roll-all-veto-total-c"
      ]);
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-all-veto-total",
          select: "all",
          idempotencyKey: "roll-all-veto-total-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.rolled).toEqual([]);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.complete).toBe(false);

      expect(response.result.chatMessages).toMatchObject({ status: "captured", expectedCount: 0 });
      expect(response.result.chatMessages.ids).toHaveLength(3);
      expect(response.result.failure.message).toContain("at least 3 roll(s) were announced");
    });

    it("with NO chat capture a select-mode roll reports mutation UNKNOWN, and invents no failure", async () => {
      const combat = seedCombat("cbt-roll-all-nohooks", { round: 1, turn: 0 });
      combat.vetoCombatantUpdates = new Set(["cbt-roll-all-nohooks-b", "cbt-roll-all-nohooks-c"]);

      const hooks = globalThis.Hooks;
      globalThis.Hooks = { callAll: hooks.callAll.bind(hooks) };
      let response;
      try {
        response = await router().route(
          createRequest("combat.roll-initiative", {
            combatId: "cbt-roll-all-nohooks",
            select: "all",
            idempotencyKey: "roll-all-nohooks-1"
          })
        );
      } finally {
        globalThis.Hooks = hooks;
      }
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.chatMessages.status).toBe("unknown");
      expect(response.result.chatMessages.ids).toEqual([]);

      expect(response.result.rolled).toHaveLength(1);
      expect(response.result.failure).toBeUndefined();
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.complete).toBe(false);
    });

    it("with NO chat capture a select-mode roll that landed NOTHING never reports committed", async () => {
      const combat = seedCombat("cbt-roll-all-nohooks-none", { round: 1, turn: 0 });
      combat.vetoCombatantUpdates = new Set([
        "cbt-roll-all-nohooks-none-a",
        "cbt-roll-all-nohooks-none-b",
        "cbt-roll-all-nohooks-none-c"
      ]);
      const hooks = globalThis.Hooks;
      globalThis.Hooks = { callAll: hooks.callAll.bind(hooks) };
      let response;
      try {
        response = await router().route(
          createRequest("combat.roll-initiative", {
            combatId: "cbt-roll-all-nohooks-none",
            select: "all",
            idempotencyKey: "roll-all-nohooks-none-1"
          })
        );
      } finally {
        globalThis.Hooks = hooks;
      }
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.rolled).toEqual([]);
      expect(response.result.unconfirmedCombatantIds).toEqual([]);
      expect(response.result.unconfirmableCombatantIds).toEqual([]);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.complete).toBe(false);
      expect(response.result.failure).toBeUndefined();
    });

    it("with NO chat capture an --combatant-ids roll still reports COMMITTED (row identity, not chat)", async () => {
      seedCombat("cbt-roll-ids-nohooks", { round: 1, turn: 0 });
      const hooks = globalThis.Hooks;
      globalThis.Hooks = { callAll: hooks.callAll.bind(hooks) };
      let response;
      try {
        response = await router().route(
          createRequest("combat.roll-initiative", {
            combatId: "cbt-roll-ids-nohooks",
            combatantIds: ["cbt-roll-ids-nohooks-a"],
            idempotencyKey: "roll-ids-nohooks-1"
          })
        );
      } finally {
        globalThis.Hooks = hooks;
      }
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.chatMessages.status).toBe("unknown");
      expect(response.result.rolled).toHaveLength(1);
      expect(response.result.mutation).toBe("committed");

      expect(response.result.complete).toBe(false);
    });

    it("a combatant DELETED inside a select:all roll is named as the consistent cause", async () => {
      const combat = seedCombat("cbt-roll-all-vanish", { round: 1, turn: 0 });
      const realRollInitiative = combat.rollInitiative;
      combat.rollInitiative = vi.fn(async (ids, options) => {
        const result = await realRollInitiative(ids, options);

        combat.combatants.delete("cbt-roll-all-vanish-c");
        return result;
      });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-all-vanish",
          select: "all",
          idempotencyKey: "roll-all-vanish-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.rolled).toHaveLength(2);
      expect(response.result.chatMessages.ids).toHaveLength(3);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.failure.message).toContain("cbt-roll-all-vanish-c are gone from the combat");
    });

    it("combat.roll-initiative reports the SAME two unrequested writes combat.set-initiative does", async () => {
      const combat = seedCombat("cbt-roll-side-effects", {
        round: 1,
        turn: 0,
        groups: [{ id: "rollgrp000000000", name: "Pack", initiative: 15 }],
        combatants: [
          { id: "roll-se-a", name: "A", sceneId: COMBAT_SCENE_A, group: "rollgrp000000000" },

          { id: "roll-se-b", name: "B", sceneId: COMBAT_SCENE_B, initiative: 4 }
        ],
        systemPropagatesGroupInitiative: true
      });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-side-effects",
          combatantIds: ["roll-se-a"],
          idempotencyKey: "roll-se-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.combatSceneUnlinked).toBe(true);
      expect(combat._source.scene).toBeNull();
      expect(response.result.groupInitiativeChanges).toEqual([
        { groupId: "rollgrp000000000", initiativeBefore: 15, initiativeAfter: 10 }
      ]);
    });

    it("combat.roll-initiative reports NEITHER side effect when neither fired (the over-report arm)", async () => {
      const combat = seedCombat("cbt-roll-no-side-effects", { round: 1, turn: 0 });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-no-side-effects",
          combatantIds: ["cbt-roll-no-side-effects-a"],
          idempotencyKey: "roll-no-se-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.combatSceneUnlinked).toBe(false);
      expect(response.result.groupInitiativeChanges).toEqual([]);
      expect(combat._source.scene).toBe(COMBAT_SCENE_A);

      const sceneless = seedCombat("cbt-roll-sceneless", {
        scene: null,
        combatants: [
          { id: "roll-sceneless-a", name: "A", sceneId: COMBAT_SCENE_B },
          { id: "roll-sceneless-b", name: "B", sceneId: COMBAT_SCENE_C }
        ],
        round: 1,
        turn: 0
      });
      expect(sceneless._source.scene).toBeNull();
      const scenelessRoll = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-sceneless",
          combatantIds: ["roll-sceneless-a"],
          idempotencyKey: "roll-sceneless-1"
        })
      );
      expect(scenelessRoll.ok, JSON.stringify(scenelessRoll.error ?? {})).toBe(true);
      expect(scenelessRoll.result.combatSceneUnlinked).toBe(false);
      expect(scenelessRoll.result.combat.scene).toBeNull();
    });

    it("combat.roll-initiative answers UNKNOWN for a RE-roll whose stored number did not move", async () => {
      seedCombat("cbt-reroll", {
        round: 1,
        turn: 0,
        combatInitiativeRoll: 10,
        combatants: [{ id: "reroll-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 10 }]
      });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-reroll",
          combatantIds: ["reroll-a"],
          idempotencyKey: "reroll-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);

      expect(response.result.rolled).toEqual([]);
      expect(response.result.unconfirmedCombatantIds).toEqual([]);
      expect(response.result.unconfirmableCombatantIds).toEqual(["reroll-a"]);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.complete).toBe(false);
      expect(response.result.failure.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.result.failure.message).toContain("cannot be CONFIRMED");
      expect(response.result.failure.message).toContain("already held an initiative");

      expect(response.result.failure.message).toContain("NOT a report that the roll failed");
      expect(response.result.failure.message).not.toContain("did not land");
      expect(response.result.failure.message).toContain("combat.reset-initiative");

      expect(response.result.chatMessages).toMatchObject({ status: "captured", expectedCount: 1 });
      expect(response.result.chatMessages.ids).toHaveLength(1);
    });

    it("a REFUSED re-roll of a row that already had an initiative is indistinguishable — and is not called committed", async () => {
      const combat = seedCombat("cbt-reroll-veto", {
        round: 1,
        turn: 0,
        combatInitiativeRoll: 17,
        combatants: [{ id: "reroll-veto-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 10 }]
      });
      combat.vetoCombatantUpdates = new Set(["reroll-veto-a"]);
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-reroll-veto",
          combatantIds: ["reroll-veto-a"],
          idempotencyKey: "reroll-veto-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.combat.turns[0].initiative).toBe(10);
      expect(response.result.rolled).toEqual([]);
      expect(response.result.unconfirmableCombatantIds).toEqual(["reroll-veto-a"]);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.complete).toBe(false);

      expect(response.result.unconfirmedCombatantIds).toEqual([]);
      expect(response.result.chatMessages.ids).toHaveLength(1);
    });

    it("a re-roll whose stored number DID move is confirmed and stays committed", async () => {
      seedCombat("cbt-reroll-moved", {
        round: 1,
        turn: 0,
        combatInitiativeRoll: 18,
        combatants: [{ id: "reroll-moved-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 10 }]
      });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-reroll-moved",
          combatantIds: ["reroll-moved-a"],
          idempotencyKey: "reroll-moved-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.rolled).toEqual([
        { combatantId: "reroll-moved-a", initiativeBefore: 10, initiative: 18 }
      ]);
      expect(response.result.unconfirmableCombatantIds).toEqual([]);
      expect(response.result.mutation).toBe("committed");
      expect(response.result.complete).toBe(true);
      expect(response.result.failure).toBeUndefined();
    });

    it("a targeted combatant DELETED inside an --combatant-ids roll is named, not dropped from the body", async () => {
      const combat = seedCombat("cbt-roll-ids-vanish", { round: 1, turn: 0 });
      const realRollInitiative = combat.rollInitiative;
      combat.rollInitiative = vi.fn(async (ids, options) => {
        const result = await realRollInitiative(ids, options);
        combat.combatants.delete("cbt-roll-ids-vanish-b");
        return result;
      });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-ids-vanish",
          combatantIds: ["cbt-roll-ids-vanish-a", "cbt-roll-ids-vanish-b"],
          idempotencyKey: "roll-ids-vanish-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.rolled.map((row) => row.combatantId)).toEqual(["cbt-roll-ids-vanish-a"]);
      expect(response.result.unconfirmedCombatantIds).toEqual([]);
      expect(response.result.unconfirmableCombatantIds).toEqual(["cbt-roll-ids-vanish-b"]);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.failure.message).toContain("no longer in the combat");
    });

    it("a row CLEARED to no initiative is not a completed roll — it is unconfirmable", async () => {
      const combat = seedCombat("cbt-roll-cleared", {
        round: 1,
        turn: 0,
        combatInitiativeRoll: 18,
        combatants: [{ id: "cleared-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 15 }]
      });
      combat.hookClearsInitiativeIds = new Set(["cleared-a"]);
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-cleared",
          combatantIds: ["cleared-a"],
          idempotencyKey: "roll-cleared-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);

      expect(response.result.combat.turns[0].initiative).toBeNull();
      expect(response.result.rolled).toEqual([]);

      expect(response.result.unconfirmedCombatantIds).toEqual([]);
      expect(response.result.unconfirmableCombatantIds).toEqual(["cleared-a"]);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.complete).toBe(false);

      expect(response.result.failure.message).toContain("cannot be CONFIRMED");
      expect(response.result.failure.message).toContain("now store NONE at all");
      expect(response.result.failure.message).not.toContain("hold the SAME stored value");
      expect(response.result.failure.message).toContain("NOT a report that the roll failed");
      expect(response.result.chatMessages).toMatchObject({ status: "captured", expectedCount: 1 });
    });

    it("a cleared row keeps the partial-commit envelope when rollInitiative THROWS, instead of a bare re-throw", async () => {
      const combat = seedCombat("cbt-roll-cleared-throw", {
        round: 1,
        turn: 0,
        combatInitiativeRoll: 18,
        throwAfterInitiativeWrite: true,
        combatants: [{ id: "cleared-throw-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 15 }]
      });
      combat.hookClearsInitiativeIds = new Set(["cleared-throw-a"]);
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-cleared-throw",
          combatantIds: ["cleared-throw-a"],
          idempotencyKey: "roll-cleared-throw-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.rolled).toEqual([]);
      expect(response.result.unconfirmableCombatantIds).toEqual(["cleared-throw-a"]);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.complete).toBe(false);
      expect(response.result.chatMessages.status).toBe("unknown");
      expect(response.result.failure.message).toContain("chat creation failed");
    });

    it("the nothing-landed refusal NAMES a cleared row instead of reading as though nothing moved", async () => {
      const combat = seedCombat("cbt-roll-cleared-refused", {
        round: 1,
        turn: 0,
        combatInitiativeRoll: 18,
        combatants: [
          { id: "cleared-refused-null", name: "Null", sceneId: COMBAT_SCENE_A },
          { id: "cleared-refused-had", name: "Had", sceneId: COMBAT_SCENE_A, initiative: 15 }
        ]
      });
      combat.vetoCombatantUpdates = new Set(["cleared-refused-null"]);
      combat.hookClearsInitiativeIds = new Set(["cleared-refused-had"]);
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-cleared-refused",
          combatantIds: ["cleared-refused-null", "cleared-refused-had"],
          idempotencyKey: "roll-cleared-refused-1"
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("still have no initiative");
      expect(response.error.message).toContain("cleared-refused-had additionally LOST");
      expect(response.error.details.combatantIds).toEqual(["cleared-refused-null"]);
      expect(response.error.details.clearedCombatantIds).toEqual(["cleared-refused-had"]);
    });

    it("an UNTARGETED row cleared inside an --all roll is not credited, so it cannot mask the chat gap", async () => {
      const combat = seedCombat("cbt-roll-all-cleared", {
        round: 1,
        turn: 0,
        combatInitiativeRoll: 12,
        systemRollsExtraIds: ["all-cleared-had"],
        combatants: [
          { id: "all-cleared-null", name: "Null", sceneId: COMBAT_SCENE_A },
          { id: "all-cleared-had", name: "Had", sceneId: COMBAT_SCENE_A, initiative: 15 }
        ]
      });
      combat.hookClearsInitiativeIds = new Set(["all-cleared-had"]);
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-all-cleared",
          select: "all",
          idempotencyKey: "roll-all-cleared-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.targetedCombatantIds).toEqual(["all-cleared-null"]);
      expect(response.result.rolled).toEqual([
        { combatantId: "all-cleared-null", initiativeBefore: null, initiative: 12 }
      ]);

      expect(response.result.unconfirmableCombatantIds).toEqual([]);
      expect(response.result.chatMessages.ids).toHaveLength(2);
      expect(response.result.chatMessages.expectedCount).toBe(1);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.complete).toBe(false);
      expect(response.result.failure.message).toContain("were announced without being recorded");
    });

    it("a PROVABLE drop outranks an unconfirmable row in the same call", async () => {
      const combat = seedCombat("cbt-roll-precedence", {
        round: 1,
        turn: 0,
        combatInitiativeRoll: 10,
        combatants: [
          { id: "prec-null", name: "Null", sceneId: COMBAT_SCENE_A },
          { id: "prec-same", name: "Same", sceneId: COMBAT_SCENE_A, initiative: 10 },
          { id: "prec-ok", name: "Ok", sceneId: COMBAT_SCENE_A }
        ]
      });
      combat.vetoCombatantUpdates = new Set(["prec-null"]);
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-precedence",
          combatantIds: ["prec-null", "prec-same", "prec-ok"],
          idempotencyKey: "roll-precedence-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.rolled.map((row) => row.combatantId)).toEqual(["prec-ok"]);
      expect(response.result.unconfirmedCombatantIds).toEqual(["prec-null"]);
      expect(response.result.unconfirmableCombatantIds).toEqual(["prec-same"]);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.failure.message).toContain("Initiative did not land for combatant(s) prec-null");
    });

    it("an OVER-capture keeps every id, because the correlation flag makes attribution STRICT", async () => {
      seedCombat("cbt-roll-over", { round: 1, turn: 0, systemRollsExtraIds: ["cbt-roll-over-b"] });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-over",
          combatantIds: ["cbt-roll-over-a"],
          idempotencyKey: "roll-over-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.chatMessages.expectedCount).toBe(1);
      expect(response.result.chatMessages.ids).toHaveLength(2);
      expect(response.result.chatMessages.status).toBe("captured");
      expect(response.result.complete).toBe(true);

      expect(response.result.rolled.map((row) => row.combatantId)).toEqual(["cbt-roll-over-a"]);
    });

    it("in ids mode a NON-TARGETED row's concurrent change is neither credited nor allowed to mask a refusal", async () => {
      const combat = seedCombat("cbt-roll-foreign", {
        round: 1,
        turn: 0,
        combatants: [
          { id: "foreign-target", name: "Target", sceneId: COMBAT_SCENE_A },
          { id: "foreign-other", name: "Other", sceneId: COMBAT_SCENE_A }
        ]
      });
      combat.vetoCombatantUpdates = new Set(["foreign-target"]);

      const rollInitiative = combat.rollInitiative;
      combat.rollInitiative = vi.fn(async (...args) => {
        const result = await rollInitiative(...args);
        combat.combatants.get("foreign-other").updateSource({ initiative: 17 });
        return result;
      });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-foreign",
          combatantIds: ["foreign-target"],
          idempotencyKey: "roll-foreign-1"
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.message).toContain("No initiative was stored");
      expect(response.error.details.combatantIds).toEqual(["foreign-target"]);

      expect(combat.combatants.get("foreign-other")._source.initiative).toBe(17);
    });

    it("combat.roll-initiative reports a PARTIAL commit when a targeted row's write was refused", async () => {
      const combat = seedCombat("cbt-roll-partial", { round: 1, turn: 0 });
      combat.vetoCombatantUpdates = new Set(["cbt-roll-partial-b"]);
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-partial",
          combatantIds: ["cbt-roll-partial-a", "cbt-roll-partial-b"],
          idempotencyKey: "roll-partial-1"
        })
      );

      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.complete).toBe(false);
      expect(response.result.unconfirmedCombatantIds).toEqual(["cbt-roll-partial-b"]);
      expect(response.result.rolled.map((row) => row.combatantId)).toEqual(["cbt-roll-partial-a"]);
      expect(response.result.failure.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    });

    it("combat.roll-initiative raises INTERNAL_ERROR when NOTHING landed at all", async () => {
      const combat = seedCombat("cbt-roll-veto", { round: 1, turn: 0 });
      combat.vetoCombatantUpdates = new Set(["cbt-roll-veto-a"]);
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-veto",
          combatantIds: ["cbt-roll-veto-a"],
          idempotencyKey: "roll-veto-1"
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details.combatantIds).toEqual(["cbt-roll-veto-a"]);

      expect(response.error.details.chatMessageIds).toHaveLength(1);
      expect(response.error.message).toContain("chat delete");
      expect(response.error.message).toContain(response.error.details.chatMessageIds[0]);
    });

    it("combat.roll-initiative names the orphaned chat cards when the THROW left nothing stored", async () => {
      const combat = seedCombat("cbt-roll-throw-orphan", {
        round: 1,
        turn: 0,
        throwAfterInitiativeChat: true
      });
      combat.vetoCombatantUpdates = new Set(["cbt-roll-throw-orphan-a"]);
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-throw-orphan",
          combatantIds: ["cbt-roll-throw-orphan-a"],
          idempotencyKey: "roll-throw-orphan-1"
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(response.error.details.chatMessageIds).toHaveLength(1);
      expect(response.error.details.failure.message).toContain("system wrapper failed after chat");
      expect(response.error.message).toContain("chat delete");

      expect(response.error.message).toContain(response.error.details.chatMessageIds[0]);
      expect(combat.combatants.get("cbt-roll-throw-orphan-a")._source.initiative ?? null).toBeNull();
    });

    it("combat.roll-initiative reports the partial-commit envelope when chat creation THROWS", async () => {
      seedCombat("cbt-roll-throw", { round: 1, turn: 0, throwAfterInitiativeWrite: true });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-throw",
          combatantIds: ["cbt-roll-throw-a"],
          idempotencyKey: "roll-throw-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.complete).toBe(false);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.chatMessages.status).toBe("unknown");
      expect(response.result.rolled).toHaveLength(1);
      expect(response.result.failure.message).toContain("chat creation failed");
    });

    it("combat.roll-initiative re-throws when the throw left NOTHING stored", async () => {
      const combat = seedCombat("cbt-roll-throw-clean", {
        round: 1,
        turn: 0,
        throwAfterInitiativeWrite: true
      });
      combat.vetoCombatantUpdates = new Set(["cbt-roll-throw-clean-a"]);
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-throw-clean",
          combatantIds: ["cbt-roll-throw-clean-a"],
          idempotencyKey: "roll-throw-clean-1"
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.message).toContain("chat creation failed");

      expect(combat.combatants.get("cbt-roll-throw-clean-a")._source.initiative ?? null).toBeNull();
    });

    it("does NOT call a throw clean when a targeted row's RE-ROLL cannot be confirmed", async () => {
      const combat = seedCombat("cbt-roll-throw-unconfirmable", {
        round: 1,
        turn: 0,
        combatInitiativeRoll: 10, // the number the row already stores
        throwAfterInitiativeWrite: true,
        combatants: [{ id: "throw-unconf-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 10 }]
      });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-throw-unconfirmable",
          combatantIds: ["throw-unconf-a"],
          idempotencyKey: "roll-throw-unconf-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.rolled).toEqual([]);
      expect(response.result.unconfirmableCombatantIds).toEqual(["throw-unconf-a"]);
      expect(response.result.mutation).toBe("unknown");
      expect(response.result.complete).toBe(false);

      expect(response.result.failure.message).toContain("chat creation failed");

      expect(response.result.chatMessages).toMatchObject({ status: "unknown", expectedCount: 0, ids: [] });
      expect(combat.combatants.get("throw-unconf-a")._source.initiative).toBe(10);
    });

    it("stops claiming the world recorded NOTHING when an unconfirmable row may hold the roll", async () => {
      const combat = seedCombat("cbt-roll-throw-unconf-chat", {
        round: 1,
        turn: 0,
        combatInitiativeRoll: 10,
        throwAfterInitiativeChat: true,
        combatants: [{ id: "throw-unconf-chat-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 10 }]
      });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-throw-unconf-chat",
          combatantIds: ["throw-unconf-chat-a"],
          idempotencyKey: "roll-throw-unconf-chat-1"
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.unconfirmableCombatantIds).toEqual(["throw-unconf-chat-a"]);
      expect(response.result.mutation).toBe("unknown");

      expect(response.result.chatMessages.ids).toHaveLength(1);
      expect(response.result.chatMessages.status).toBe("unknown");
      expect(response.result.failure.message).toContain("system wrapper failed after chat");
      expect(combat.combatants.get("throw-unconf-chat-a")._source.initiative).toBe(10);
    });

    it("combat.roll-initiative dry-run rolls nothing and reports the computed target set", async () => {
      const combat = seedCombat("cbt-roll-dry", { round: 1, turn: 0 });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-dry",
          select: "all",
          dryRun: true,
          idempotencyKey: "roll-dry-1"
        })
      );
      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(Object.keys(response.result).sort()).toEqual(
        [
          "chatMessages",
          "combat",
          "combatId",
          "combatSceneUnlinked",
          "complete",
          "dryRun",
          "groupInitiativeChanges",
          "mutation",
          "rolled",
          "select",
          "targetedCombatantIds",
          "unconfirmableCombatantIds",
          "unconfirmedCombatantIds"
        ].sort()
      );
      expect(response.result.mutation).toBe("not-executed");
      expect(response.result.complete).toBe(true);
      expect(response.result.chatMessages).toEqual({ status: "not-requested", expectedCount: 0, ids: [] });

      expect(response.result.combatSceneUnlinked).toBe(false);
      expect(response.result.groupInitiativeChanges).toEqual([]);
      expect(combat.rollAll).not.toHaveBeenCalled();
      expect(combat.combatants.get("cbt-roll-dry-a")._source.initiative).toBeNull();
    });

    it("the roll-initiative unknown-id refusal fires on the DRY-RUN path too", async () => {
      seedCombat("cbt-roll-dry-unknown", { round: 1, turn: 0 });
      const response = await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-dry-unknown",
          combatantIds: ["nope"],
          dryRun: true,
          idempotencyKey: "roll-dry-unknown-1"
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMBATANT_NOT_FOUND);
    });

    it("combat.roll-initiative deregisters its chat listener after the call", async () => {
      seedCombat("cbt-roll-listener", { round: 1, turn: 0 });
      await router().route(
        createRequest("combat.roll-initiative", {
          combatId: "cbt-roll-listener",
          combatantIds: ["cbt-roll-listener-a"],
          idempotencyKey: "roll-listener-1"
        })
      );
      expect(globalThis.Hooks._listeners.get("createChatMessage") ?? []).toHaveLength(0);
    });

    it("combat.set-initiative writes one row and reports the STORED value", async () => {
      const combat = seedCombat("cbt-set", { round: 1, turn: 0 });
      const response = await router().route(
        createRequest("combat.set-initiative", {
          combatId: "cbt-set",
          combatantId: "cbt-set-a",
          initiative: 17
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result).toMatchObject({
        combatId: "cbt-set",
        combatantId: "cbt-set-a",
        initiativeBefore: null,
        initiative: 17,
        changed: true,
        combatSceneUnlinked: false,
        groupInitiativeChanges: []
      });
      expect(combat.combatants.get("cbt-set-a")._source.initiative).toBe(17);
      expect(response.result.combatant.initiative).toBe(17);
    });

    it("combat.set-initiative accepts null as the per-combatant clear", async () => {
      const combat = seedCombat("cbt-set-null", {
        round: 1,
        turn: 0,
        combatants: [{ id: "set-null-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 8 }]
      });
      const response = await router().route(
        createRequest("combat.set-initiative", {
          combatId: "cbt-set-null",
          combatantId: "set-null-a",
          initiative: null
        })
      );
      expect(response.ok).toBe(true);
      expect(response.result).toMatchObject({ initiativeBefore: 8, initiative: null, changed: true });
      expect(combat.combatants.get("set-null-a")._source.initiative).toBeNull();
    });

    it("combat.set-initiative answers COMBATANT_NOT_FOUND, never Foundry's strict-collection prose", async () => {
      const combat = seedCombat("cbt-set-missing", { round: 1, turn: 0 });
      const response = await router().route(
        createRequest("combat.set-initiative", {
          combatId: "cbt-set-missing",
          combatantId: "nope",
          initiative: 1
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.COMBATANT_NOT_FOUND);
      expect(response.error.message).not.toContain("EmbeddedCollection");
      expect(combat.setInitiative).not.toHaveBeenCalled();
    });

    it("combat.set-initiative on the SAME value is a convergent no-op, not a failure", async () => {
      seedCombat("cbt-set-noop", {
        round: 1,
        turn: 0,
        combatants: [{ id: "set-noop-a", name: "A", sceneId: COMBAT_SCENE_A, initiative: 5 }]
      });
      const response = await router().route(
        createRequest("combat.set-initiative", {
          combatId: "cbt-set-noop",
          combatantId: "set-noop-a",
          initiative: 5
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result).toMatchObject({ initiativeBefore: 5, initiative: 5, changed: false });
    });

    it("combat.set-initiative reports the STORED value when a system ADJUSTED it, and does not error", async () => {
      const combat = seedCombat("cbt-set-adjusted", { round: 1, turn: 0, systemAdjustsInitiativeBy: 1 });
      const response = await router().route(
        createRequest("combat.set-initiative", {
          combatId: "cbt-set-adjusted",
          combatantId: "cbt-set-adjusted-a",
          initiative: 12
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.initiative).toBe(13);
      expect(response.result.changed).toBe(true);
      expect(combat.combatants.get("cbt-set-adjusted-a")._source.initiative).toBe(13);
    });

    it("combat.set-initiative raises INTERNAL_ERROR when the row's write is refused", async () => {
      const combat = seedCombat("cbt-set-veto", { round: 1, turn: 0 });
      combat.vetoCombatantUpdates = new Set(["cbt-set-veto-a"]);
      const response = await router().route(
        createRequest("combat.set-initiative", {
          combatId: "cbt-set-veto",
          combatantId: "cbt-set-veto-a",
          initiative: 3
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(combat.combatants.get("cbt-set-veto-a")._source.initiative).toBeNull();
    });

    it("combat.set-initiative dry-run projects the merged row and writes nothing", async () => {
      const combat = seedCombat("cbt-set-dry", { round: 1, turn: 0 });
      const response = await router().route(
        createRequest("combat.set-initiative", {
          combatId: "cbt-set-dry",
          combatantId: "cbt-set-dry-a",
          initiative: 14,
          dryRun: true
        })
      );
      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(Object.keys(response.result).sort()).toEqual(
        [
          "changed",
          "combat",
          "combatId",
          "combatSceneUnlinked",
          "combatant",
          "combatantId",
          "dryRun",
          "groupInitiativeChanges",
          "initiative",
          "initiativeBefore"
        ].sort()
      );
      expect(response.result.initiative).toBe(14);
      expect(response.result.combatant.initiative).toBe(14);
      expect(combat.setInitiative).not.toHaveBeenCalled();
      expect(combat.combatants.get("cbt-set-dry-a")._source.initiative).toBeNull();
    });

    it("combat.set-initiative reports the group initiative a game system propagated", async () => {
      seedCombat("cbt-set-group", {
        round: 1,
        turn: 0,
        groups: [{ id: "setgrp0000000000", name: "Pack", initiative: 15 }],
        combatants: [{ id: "set-group-a", name: "A", sceneId: COMBAT_SCENE_A, group: "setgrp0000000000" }],
        systemPropagatesGroupInitiative: true
      });
      const response = await router().route(
        createRequest("combat.set-initiative", {
          combatId: "cbt-set-group",
          combatantId: "set-group-a",
          initiative: 21
        })
      );
      expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
      expect(response.result.groupInitiativeChanges).toEqual([
        { groupId: "setgrp0000000000", initiativeBefore: 15, initiativeAfter: 21 }
      ]);
    });

    it("every action verb answers COMBAT_NOT_FOUND for an unknown combat", async () => {
      /** @type {Array<[string, Record<string, any>]>} */
      const cases = [
        ["combat.start", {}],
        ["combat.activate", {}],
        ["combat.next-turn", KEY],
        ["combat.previous-turn", KEY],
        ["combat.next-round", KEY],
        ["combat.previous-round", KEY],
        ["combat.reset-initiative", {}],
        ["combat.roll-initiative", { select: "all", idempotencyKey: "k" }],
        ["combat.set-initiative", { combatantId: "x", initiative: 1 }]
      ];
      for (const [command, extra] of cases) {
        const response = await router().route(createRequest(command, { combatId: "missing", ...extra }));
        expect(response.ok, command).toBe(false);
        expect(response.error.code, command).toBe(ERROR_CODES.COMBAT_NOT_FOUND);
      }
    });

    it("gates every action verb behind the GM permission check", async () => {
      globalThis.game.user.isGM = false;
      /** @type {Array<[string, Record<string, any>]>} */
      const cases = [
        ["combat.start", {}],
        ["combat.activate", {}],
        ["combat.next-turn", KEY],
        ["combat.previous-turn", KEY],
        ["combat.next-round", KEY],
        ["combat.previous-round", KEY],
        ["combat.reset-initiative", {}],
        ["combat.roll-initiative", { select: "all", idempotencyKey: "k" }],
        ["combat.set-initiative", { combatantId: "combatant-1", initiative: 1 }]
      ];
      for (const [command, extra] of cases) {
        const response = await router().route(createRequest(command, { combatId: "combat-1", ...extra }));
        expect(response.ok, command).toBe(false);
        expect(response.error.code, command).toBe(ERROR_CODES.PERMISSION_DENIED);
      }
    });

    it("every action verb runs inside the ONE global combat queue (no interleaving)", async () => {
      const combat = seedCombat("cbt-queue", { round: 1, turn: 0 });
      const order = [];
      const slowStart = combat.startCombat;
      combat.startCombat = vi.fn(async () => {
        order.push("start:begin");
        await new Promise((resolve) => setTimeout(resolve, 15));
        order.push("start:end");
        return slowStart();
      });
      const originalNextTurn = combat.nextTurn;
      combat.nextTurn = vi.fn(async () => {
        order.push("next-turn");
        return originalNextTurn();
      });
      combat._source.round = 0;
      combat._source.turn = null;
      const started = router().route(createRequest("combat.start", { combatId: "cbt-queue" }));
      const advanced = router().route(createRequest("combat.next-turn", { combatId: "cbt-queue", ...KEY }));
      const [a, b] = await Promise.all([started, advanced]);
      expect(a.ok, JSON.stringify(a.error ?? {})).toBe(true);
      expect(b.ok, JSON.stringify(b.error ?? {})).toBe(true);
      expect(order).toEqual(["start:begin", "start:end", "next-turn"]);
    });

    it("every reported transition and mutation comes from the pinned protocol enums", () => {
      expect(COMBAT_TRANSITIONS).toContain("none");
      expect(COMBAT_TRANSITIONS).toContain("turn");
      expect(COMBAT_TRANSITIONS).toContain("round");
      expect(COMBAT_MUTATION_OUTCOMES).toContain("committed");
      expect(COMBAT_MUTATION_OUTCOMES).toContain("unknown");
      expect(COMBAT_MUTATION_OUTCOMES).toContain("not-executed");

      expect(COMBAT_INITIATIVE_MODES).toContain("ids");
      expect(COMBAT_INITIATIVE_MODES).toContain("all");
      expect(COMBAT_INITIATIVE_MODES).toContain("npc");
    });

    it("reports only enum members for `transition` and `mutation` across every action-verb path", async () => {
      const combat = seedCombat("cbt-enum");
      const bodies = [];
      for (const params of [
        { command: "combat.start", params: { combatId: "cbt-enum" } },
        { command: "combat.next-turn", params: { combatId: "cbt-enum", ...KEY } },
        { command: "combat.next-turn", params: { combatId: "cbt-enum", dryRun: true, ...KEY } },
        { command: "combat.next-round", params: { combatId: "cbt-enum", ...KEY } },
        {
          command: "combat.roll-initiative",
          params: { combatId: "cbt-enum", combatantIds: ["cbt-enum-a"], idempotencyKey: "enum-roll" }
        },
        {
          command: "combat.roll-initiative",
          params: { combatId: "cbt-enum", select: "all", dryRun: true, idempotencyKey: "enum-roll-dry" }
        }
      ]) {
        const response = await router().route(createRequest(params.command, params.params));
        expect(response.ok, `${params.command} ${JSON.stringify(response.error ?? {})}`).toBe(true);
        bodies.push(response.result);
      }
      expect(combat.startCombat).toHaveBeenCalled();
      for (const body of bodies) {
        if (body.transition !== undefined) expect(COMBAT_TRANSITIONS).toContain(body.transition);
        if (body.mutation !== undefined) expect(COMBAT_MUTATION_OUTCOMES).toContain(body.mutation);
        if (body.select !== undefined) expect(COMBAT_INITIATIVE_MODES).toContain(body.select);
      }

      expect(bodies.some((body) => body.select === "ids")).toBe(true);
      expect(bodies.some((body) => body.select === "all")).toBe(true);

      expect(bodies.some((body) => body.transition === "turn")).toBe(true);
      expect(bodies.some((body) => body.transition === "round")).toBe(true);
      expect(bodies.some((body) => body.transition === "none")).toBe(true);
      expect(bodies.some((body) => body.mutation === "committed")).toBe(true);
      expect(bodies.some((body) => body.mutation === "not-executed")).toBe(true);
    });

    it("SERIALIZES activate against next-turn and against delete of the same combat", async () => {
      const combat = seedCombat("cbt-queue-activate", { round: 1, turn: 0 });
      const order = [];
      const realActivate = combat.activate;
      combat.activate = vi.fn(async () => {
        order.push("activate:begin");
        await new Promise((resolve) => setTimeout(resolve, 15));
        order.push("activate:end");
        return realActivate();
      });
      const realNextTurn = combat.nextTurn;
      combat.nextTurn = vi.fn(async () => {
        order.push("next-turn");
        return realNextTurn();
      });
      const [a, b] = await Promise.all([
        router().route(createRequest("combat.activate", { combatId: "cbt-queue-activate" })),
        router().route(createRequest("combat.next-turn", { combatId: "cbt-queue-activate", ...KEY }))
      ]);
      expect(a.ok, JSON.stringify(a.error ?? {})).toBe(true);
      expect(b.ok, JSON.stringify(b.error ?? {})).toBe(true);
      expect(order).toEqual(["activate:begin", "activate:end", "next-turn"]);

      const target = seedCombat("cbt-queue-delete", { round: 1, turn: 0 });
      const deleteOrder = [];
      const targetActivate = target.activate;
      target.activate = vi.fn(async () => {
        deleteOrder.push("activate:begin");
        await new Promise((resolve) => setTimeout(resolve, 15));
        deleteOrder.push("activate:end");
        return targetActivate();
      });
      const targetDelete = target.delete;
      target.delete = vi.fn(async () => {
        deleteOrder.push("delete");
        return targetDelete();
      });
      const [activated, deleted] = await Promise.all([
        router().route(createRequest("combat.activate", { combatId: "cbt-queue-delete" })),
        router().route(createRequest("combat.delete", { combatId: "cbt-queue-delete" }))
      ]);
      expect(activated.ok, JSON.stringify(activated.error ?? {})).toBe(true);
      expect(deleted.ok, JSON.stringify(deleted.error ?? {})).toBe(true);
      expect(deleteOrder).toEqual(["activate:begin", "activate:end", "delete"]);
    });

    it("SERIALIZES the initiative verbs too (queue membership is not just the transition verbs)", async () => {
      const combat = seedCombat("cbt-queue-init", { round: 1, turn: 0 });
      const order = [];
      const realRoll = combat.rollInitiative;
      combat.rollInitiative = vi.fn(async (ids, options) => {
        order.push("roll:begin");
        await new Promise((resolve) => setTimeout(resolve, 15));
        order.push("roll:end");
        return realRoll(ids, options);
      });
      const realReset = combat.resetAll;
      combat.resetAll = vi.fn(async () => {
        order.push("reset");
        return realReset();
      });
      const realSet = combat.setInitiative;
      combat.setInitiative = vi.fn(async (id, value) => {
        order.push("set");
        return realSet(id, value);
      });
      const [rolled, reset, set] = await Promise.all([
        router().route(
          createRequest("combat.roll-initiative", {
            combatId: "cbt-queue-init",
            combatantIds: ["cbt-queue-init-a"],
            idempotencyKey: "queue-roll"
          })
        ),
        router().route(createRequest("combat.reset-initiative", { combatId: "cbt-queue-init" })),
        router().route(
          createRequest("combat.set-initiative", {
            combatId: "cbt-queue-init",
            combatantId: "cbt-queue-init-b",
            initiative: 4
          })
        )
      ]);
      expect(rolled.ok, JSON.stringify(rolled.error ?? {})).toBe(true);
      expect(reset.ok, JSON.stringify(reset.error ?? {})).toBe(true);
      expect(set.ok, JSON.stringify(set.error ?? {})).toBe(true);
      expect(order).toEqual(["roll:begin", "roll:end", "reset", "set"]);
    });

    it("a capability-gated session answers BRIDGE_NOT_READY on both the real and dry-run paths", async () => {
      const combat = seedCombat("cbt-no-method", { round: 1, turn: 0 });
      delete combat.nextTurn;
      for (const params of [
        { combatId: "cbt-no-method", ...KEY },
        { combatId: "cbt-no-method", dryRun: true, ...KEY }
      ]) {
        const response = await router().route(createRequest("combat.next-turn", params));
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.BRIDGE_NOT_READY);
      }
    });
  });
});
