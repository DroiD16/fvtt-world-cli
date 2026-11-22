import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";
import { ERROR_CODES } from "../scripts/generated/protocol.js";

import { createRequest, installFakeFoundry } from "./helpers/fake-foundry.js";

/**
 * @param {any} actor
 * @param {{ removable?: boolean }} [options]
 */
function installStatusToggle(actor, { removable = true } = {}) {
  actor.statuses = new Set();
  actor.toggleStatusEffect = vi.fn(async (statusId, { active }) => {
    if (active) {
      actor.statuses.add(statusId);
      return { id: `status-${statusId}` };
    }
    if (removable) actor.statuses.delete(statusId);
    return false;
  });
}

describe("status effect commands", () => {
  let router;
  let actor;
  let tokenActor;

  beforeEach(() => {
    installFakeFoundry();
    globalThis.CONFIG.statusEffects = [
      { id: "prone", name: "Prone" },
      { id: "dead", name: "Dead", _id: "statusdead000000" },
      { id: "prone", name: "Prone (duplicate)" }
    ];
    actor = globalThis.game.actors.get("actor-1");
    installStatusToggle(actor);
    tokenActor = globalThis.game.scenes.get("scene-1").tokens.get("token-a").actor;
    installStatusToggle(tokenActor);
    router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
  });

  it("turns a status on through Actor#toggleStatusEffect and confirms it", async () => {
    const response = await router.route(
      createRequest("actor.status.set", { actorId: "actor-1", statusId: "dead", active: true, overlay: true })
    );

    expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
    expect(response.result).toEqual({
      actorId: "actor-1",
      statusId: "dead",
      active: true,
      previous: false,
      changed: true
    });
    expect(actor.toggleStatusEffect).toHaveBeenCalledWith("dead", { active: true, overlay: true });
  });

  it("returns a no-op without calling Foundry when the status is already in the requested state", async () => {
    actor.statuses.add("prone");

    const on = await router.route(
      createRequest("actor.status.set", { actorId: "actor-1", statusId: "prone", active: true })
    );
    const off = await router.route(
      createRequest("actor.status.set", { actorId: "actor-1", statusId: "dead", active: false })
    );

    expect(on.result).toMatchObject({ previous: true, changed: false });
    expect(off.result).toMatchObject({ previous: false, changed: false });
    expect(actor.toggleStatusEffect).not.toHaveBeenCalled();
  });

  it("previews the current state and the change without calling Foundry", async () => {
    actor.statuses.add("prone");

    const response = await router.route(
      createRequest("actor.status.set", {
        actorId: "actor-1",
        statusId: "prone",
        active: false,
        dryRun: true
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({ dryRun: true, previous: true, changed: true, active: false });
    expect(actor.toggleStatusEffect).not.toHaveBeenCalled();
    expect(actor.statuses.has("prone")).toBe(true);
  });

  it("refuses an unknown status id in a real call and a preview, listing each configured id once", async () => {
    for (const dryRun of [false, true]) {
      const response = await router.route(
        createRequest("actor.status.set", { actorId: "actor-1", statusId: "nope", active: true, dryRun })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.details).toEqual({ statusId: "nope", validStatusIds: ["prone", "dead"] });
    }
    expect(actor.toggleStatusEffect).not.toHaveBeenCalled();
  });

  it("reads the configured ids from Foundry 14's keyed status map as well", async () => {
    globalThis.CONFIG.statusEffects = { prone: { id: "prone" }, blinded: { id: "blinded" } };

    const response = await router.route(
      createRequest("actor.status.set", { actorId: "actor-1", statusId: "dead", active: true })
    );

    expect(response.error.details.validStatusIds).toEqual(["prone", "blinded"]);
  });

  it("reports a status the toggle could not remove with the effects that still carry it", async () => {
    installStatusToggle(actor, { removable: false });
    actor.statuses.add("prone");
    actor.allApplicableEffects = () => [
      { id: "multi", name: "Pinned", parent: actor, statuses: new Set(["prone", "restrained"]) },
      { id: "other", name: "Other", parent: actor, statuses: new Set(["blinded"]) }
    ];

    const response = await router.route(
      createRequest("actor.status.set", { actorId: "actor-1", statusId: "prone", active: false })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(response.error.details).toMatchObject({
      actorId: "actor-1",
      statusId: "prone",
      active: false,
      effects: [
        {
          id: "multi",
          name: "Pinned",
          parentType: actor.documentName ?? null,
          parentId: "actor-1",
          statuses: ["prone", "restrained"]
        }
      ]
    });
  });

  it("sets a placed token's status on the token's actor and says whether it is the world actor", async () => {
    const response = await router.route(
      createRequest("scene.token.status.set", {
        sceneId: "scene-1",
        tokenId: "token-a",
        statusId: "prone",
        active: true
      })
    );

    expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
    expect(response.result).toEqual({
      sceneId: "scene-1",
      tokenId: "token-a",
      actorLink: false,
      mutatesWorldActor: false,
      statusId: "prone",
      active: true,
      previous: false,
      changed: true
    });
    expect(tokenActor.toggleStatusEffect).toHaveBeenCalledWith("prone", { active: true, overlay: false });
    expect(actor.toggleStatusEffect).not.toHaveBeenCalled();
  });

  it("reports an unknown token and an unknown actor as for the other token and actor commands", async () => {
    const token = await router.route(
      createRequest("scene.token.status.set", {
        sceneId: "scene-1",
        tokenId: "nope",
        statusId: "prone",
        active: true
      })
    );
    const missingActor = await router.route(
      createRequest("actor.status.set", { actorId: "nope", statusId: "prone", active: true })
    );

    expect(token.error.code).toBe(ERROR_CODES.TOKEN_NOT_FOUND);
    expect(missingActor.error.code).toBe(ERROR_CODES.ACTOR_NOT_FOUND);
  });
});
