import { beforeEach, describe, expect, it } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";
import { COMMAND_DEFINITIONS, COMMAND_NAMES, ERROR_CODES } from "../scripts/generated/protocol.js";
import { COMPENDIUM_ENTRY_COMMAND, UUID_ROUTES } from "../scripts/lib/document-uuid.js";

import { createRequest, installFakeFoundry } from "./helpers/fake-foundry.js";

// The get commands no UUID reaches: a setting is a key-value store whose UUID names no family document.
const UNROUTED_GET_COMMANDS = ["setting.get"];

// Mirrors foundry.utils.parseUuid for absolute UUIDs: a world UUID names its collection, a compendium
// UUID its pack, and the remaining parts come in type/id pairs.
function fakeParseUuid(uuid) {
  const parts = uuid.split(".");
  const game = /** @type {any} */ (globalThis).game;
  let collection;
  let primary;
  if (parts[0] === "Compendium") {
    collection = game.packs.get(`${parts[1]}.${parts[2]}`);
    primary = parts.slice(3, 5);
    parts.splice(0, 5);
  } else {
    collection = { Actor: game.actors, Scene: game.scenes, Setting: { get: () => ({}) } }[parts[0]];
    primary = parts.splice(0, 2);
  }
  if (parts.length % 2) return null;
  const [documentType, documentId] = primary;
  const embedded = parts;
  return {
    uuid,
    type: embedded.length ? embedded.at(-2) : documentType,
    id: embedded.length ? embedded.at(-1) : documentId,
    collection,
    embedded,
    documentType,
    documentId
  };
}

describe("document.resolve", () => {
  let router;
  let actor;
  let token;

  beforeEach(() => {
    installFakeFoundry();
    globalThis.foundry.utils.parseUuid = fakeParseUuid;
    actor = globalThis.game.actors.get("actor-1");
    actor.uuid = "Actor.actor-1";
    actor.getEmbeddedDocument = (name, id) => (name === "Item" ? actor.items.get(id) : null);
    const item = actor.items.get("actor-item-1");
    item.uuid = "Actor.actor-1.Item.actor-item-1";

    token = globalThis.game.scenes.get("scene-1").tokens.get("token-a");
    token.getEmbeddedDocument = (name, id) => (name === "Actor" && id === token.actorId ? token.actor : null);
    const synthetic = token.actor;
    synthetic.getEmbeddedDocument = (name, id) => (name === "Item" ? synthetic.items.get(id) : null);
    globalThis.game.scenes.get("scene-1").getEmbeddedDocument = (name, id) =>
      name === "Token" ? globalThis.game.scenes.get("scene-1").tokens.get(id) : null;

    const pack = globalThis.game.packs.get("world.test-monsters");
    pack.index = new Map([["entry-1", { _id: "entry-1", name: "Goblin" }]]);

    router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
  });

  const resolve = (uuid) => router.route(createRequest("document.resolve", { uuid }));

  it("maps a world document and an embedded one to their family get command", async () => {
    const world = await resolve("Actor.actor-1");
    const embedded = await resolve("Actor.actor-1.Item.actor-item-1");

    expect(world.result).toEqual({
      uuid: "Actor.actor-1",
      documentName: "Actor",
      command: "actor.get",
      params: { actorId: "actor-1" }
    });
    expect(embedded.result).toEqual({
      uuid: "Actor.actor-1.Item.actor-item-1",
      documentName: "Item",
      command: "actor.item.get",
      params: { actorId: "actor-1", itemId: "actor-item-1" }
    });
  });

  it("maps an item of a token's synthetic actor to scene.token.item.get", async () => {
    const response = await resolve("Scene.scene-1.Token.token-a.Actor.actor-1.Item.delta-item-1");

    expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
    expect(response.result).toMatchObject({
      documentName: "Item",
      command: "scene.token.item.get",
      params: { sceneId: "scene-1", tokenId: "token-a", itemId: "delta-item-1" }
    });
  });

  it("maps a compendium entry, after Foundry's own parsing, to compendium.get", async () => {
    const response = await resolve("Compendium.world.test-monsters.Actor.entry-1");

    expect(response.result).toEqual({
      uuid: "Compendium.world.test-monsters.Actor.entry-1",
      documentName: "Actor",
      command: COMPENDIUM_ENTRY_COMMAND,
      params: { pack: "world.test-monsters", entryId: "entry-1" }
    });
  });

  it("reports the first missing document with its family's not-found code", async () => {
    const cases = [
      {
        uuid: "Actor.nope",
        code: ERROR_CODES.ACTOR_NOT_FOUND,
        details: { documentName: "Actor", id: "nope" }
      },
      {
        uuid: "Actor.actor-1.Item.nope",
        code: ERROR_CODES.ITEM_NOT_FOUND,
        details: { documentName: "Item", id: "nope" }
      },
      {
        uuid: "Scene.scene-1.Token.nope.Actor.actor-1.Item.x",
        code: ERROR_CODES.TOKEN_NOT_FOUND,
        details: { id: "nope" }
      },
      {
        uuid: "Scene.scene-1.Token.token-a.Actor.other.Item.x",
        code: ERROR_CODES.ACTOR_NOT_FOUND,
        details: { id: "other" }
      },
      {
        uuid: "Compendium.world.test-monsters.Actor.nope",
        code: ERROR_CODES.COMPENDIUM_ENTRY_NOT_FOUND,
        details: { entryId: "nope" }
      },
      {
        uuid: "Compendium.world.no-pack.Actor.x",
        code: ERROR_CODES.COMPENDIUM_NOT_FOUND,
        details: { pack: "world.no-pack" }
      }
    ];
    for (const { uuid, code, details } of cases) {
      const response = await resolve(uuid);
      expect(response.ok, uuid).toBe(false);
      expect(response.error.code, uuid).toBe(code);
      expect(response.error.details, uuid).toMatchObject(details);
    }
  });

  it("refuses what no family get command reads with UNSUPPORTED_OPERATION", async () => {
    for (const uuid of [
      "Setting.abc",
      ".Item.actor-item-1",
      "Compendium.world.test-monsters.Actor.entry-1.Item.x",
      "Scene.scene-1.Token.token-a.Actor.actor-1",
      "FogExploration.abc"
    ]) {
      const response = await resolve(uuid);
      expect(response.ok, uuid).toBe(false);
      expect(response.error.code, uuid).toBe(ERROR_CODES.UNSUPPORTED_OPERATION);
      expect(response.error.details).toEqual({ uuid });
    }
  });

  it("refuses a string that is not a UUID", async () => {
    const response = await resolve("Actor.a.Item");

    expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
  });

  it("routes every family get command in the registry, with exactly the parameters it requires", () => {
    const routed = new Set([
      ...Object.values(UUID_ROUTES).map((route) => route.command),
      COMPENDIUM_ENTRY_COMMAND
    ]);
    const getCommands = COMMAND_NAMES.filter((command) => command.endsWith(".get"));

    expect(
      getCommands.filter((command) => !routed.has(command) && !UNROUTED_GET_COMMANDS.includes(command))
    ).toEqual([]);
    for (const route of Object.values(UUID_ROUTES)) {
      const required = COMMAND_DEFINITIONS[route.command].paramsSchema.required;
      expect(route.idFields.filter((field) => field !== null).sort(), route.command).toEqual(
        [...required].sort()
      );
    }
    expect([...COMMAND_DEFINITIONS[COMPENDIUM_ENTRY_COMMAND].paramsSchema.required].sort()).toEqual([
      "entryId",
      "pack"
    ]);
  });
});
