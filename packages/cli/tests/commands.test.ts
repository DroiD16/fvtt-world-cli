import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
  COMMAND_DEFINITIONS,
  COMMAND_NAMES,
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  validateCommandRequest
} from "@fvtt-world-cli/protocol";
import { CommanderError } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createProgram, executeCli, IMPORT_PATCH_FLAGS, planCliErrorOutput } from "../src/index.js";
import { createEmptyConfig } from "../src/config.js";
import { DaemonTransportError, sendCommand as realSendCommand } from "../src/client/send-command.js";
import {
  createDefaultTestConfig,
  createInMemoryConfigStore,
  createWritableBuffer,
  failIfCalledSendCommand,
  NORMALIZED_DEFAULT_DAEMON_URL,
  runCommand,
  runCommandWithBaseArgs
} from "./helpers/cli-harness.js";
import type { SendCommandMock } from "./helpers/cli-harness.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fvtt-world-cli commands", () => {
  it("renders always-on ownership in the human get output (actor)", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        actor: {
          id: "actor-1",
          name: "Valeros",
          type: "character",
          system: {},
          ownership: { default: 0, "player-1": 3 }
        }
      }
    }));

    const result = await runCommand(["actor", "get", "--actor-id", "actor-1"], sendCommand);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("ownership:");
    expect(result.stdout).toContain("default: 0 (none)");
    expect(result.stdout).toContain("player-1: 3 (owner)");
  });

  it("renders per-page ownership (including inherit) in the human journal get output", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        journal: {
          id: "j-1",
          name: "Secrets",
          ownership: { default: 2 },
          pages: [{ id: "p-1", name: "GM Notes", type: "text", ownership: { default: -1, "gm-1": 3 } }]
        }
      }
    }));

    const result = await runCommand(["journal", "get", "--journal-id", "j-1"], sendCommand);

    expect(result.error).toBeNull();

    expect(result.stdout).toContain("default: 2 (observer)");

    expect(result.stdout).toContain("page 1 ownership:");
    expect(result.stdout).toContain("page 1   default: -1 (inherit)");
  });

  it("omits ownership from human item output when the document carries no ownership key (create/update/clone)", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        item: { id: "item-1", name: "Sword", type: "weapon", system: {} }
      }
    }));

    const result = await runCommand(["item", "get", "--item-id", "item-1"], sendCommand);

    expect(result.error).toBeNull();
    expect(result.stdout).not.toContain("ownership:");
  });

  it("renders a mutating batch response as complete + a status tally + one row per element", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        sceneId: "scene-1",
        complete: false,
        outcomes: [
          { index: 0, id: "wall-a", status: "created" },
          { index: 1, id: "wall-b", status: "dropped" }
        ],
        failure: { code: "BRIDGE_DISCONNECTED", message: "socket closed" }
      }
    }));

    const result = await runCommand(
      [
        "scene",
        "wall",
        "create-many",
        "--scene-id",
        "scene-1",
        "--data-json",
        '[{"c":[0,0,1,1]},{"c":[1,1,2,2]}]'
      ],
      sendCommand
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("scene.wall.create-many — 2 element(s) (scene: scene-1)");
    expect(result.stdout).toContain("complete: false");
    expect(result.stdout).toContain("outcomes — created: 1, dropped: 1");
    expect(result.stdout).toContain("0\twall-a\tcreated");
    expect(result.stdout).toContain("1\twall-b\tdropped");
    expect(result.stdout).toContain("failure: BRIDGE_DISCONNECTED — socket closed");

    expect(result.stdout).toContain("\n0\twall-a\tcreated\n");
  });

  it("prints the name column for a named family, placeholder included, and omits it otherwise", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        sceneId: "scene-1",
        complete: true,
        outcomes: [
          { index: 0, id: "token-a", status: "updated", name: "Goblin (1)" },
          { index: 1, id: "token-b", status: "unchanged", name: null }
        ]
      }
    }));

    const result = await runCommand(
      [
        "scene",
        "token",
        "update-many",
        "--scene-id",
        "scene-1",
        "--patches-json",
        '[{"id":"token-a","patch":{"name":"Goblin (1)"}},{"id":"token-b","patch":{"x":5}}]'
      ],
      sendCommand
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("0\ttoken-a\tupdated\tGoblin (1)");
    expect(result.stdout).toContain("1\ttoken-b\tunchanged\t(no name)");
  });

  it("prints the name column on a create-many DRY RUN, where every name is null", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        sceneId: "scene-1",
        complete: true,
        dryRun: true,
        outcomes: [{ index: 0, id: null, status: "created", name: null }]
      }
    }));

    const result = await runCommand(
      [
        "--dry-run",
        "scene",
        "token",
        "create-many",
        "--scene-id",
        "scene-1",
        "--data-json",
        '[{"x":1,"y":2}]'
      ],
      sendCommand
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("[dry-run] scene.token.create-many");
    expect(result.stdout).toContain("0\t(no id)\tcreated\t(no name)");
  });

  const SCOPE_VALUES: Record<string, string> = {
    sceneId: "scene-1",
    tokenId: "token-1",
    actorId: "actor-1",
    itemId: "item-1"
  };
  const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const scopeKeysOf = (command: string) =>
    (COMMAND_DEFINITIONS[command].paramsSchema.required as string[]).filter(
      (key) => key !== "data" && key !== "patches" && key !== "ids"
    );
  const scopeArgvOf = (command: string) =>
    scopeKeysOf(command).flatMap((key) => [`--${kebab(key)}`, SCOPE_VALUES[key]]);
  const scopeParamsOf = (command: string) =>
    Object.fromEntries(scopeKeysOf(command).map((key) => [key, SCOPE_VALUES[key]]));

  it("wires and renders EVERY batched family's verbs (derived from COMMAND_NAMES)", async () => {
    const batchCommands = COMMAND_NAMES.filter(
      (name) =>
        name.endsWith(".create-many") || name.endsWith(".update-many") || name.endsWith(".delete-many")
    ).filter((name) => COMMAND_DEFINITIONS[name].mutation);
    expect(batchCommands.length).toBeGreaterThanOrEqual(48);

    for (const command of batchCommands) {
      const suffix = command.slice(command.lastIndexOf(".") + 1);
      const group = command.slice(0, command.lastIndexOf(".")).split(".");
      const scopeArgv = scopeArgvOf(command);
      const scopeParams = scopeParamsOf(command);
      const [argv, expectedParams]: [string[], Record<string, unknown>] =
        suffix === "create-many"
          ? [
              [...group, suffix, ...scopeArgv, "--data-json", '[{"x":1,"y":2}]'],
              { ...scopeParams, data: [{ x: 1, y: 2 }] }
            ]
          : suffix === "update-many"
            ? [
                [...group, suffix, ...scopeArgv, "--patches-json", '[{"id":"doc-1","patch":{"x":3}}]'],
                { ...scopeParams, patches: [{ id: "doc-1", patch: { x: 3 } }] }
              ]
            : [
                [...group, suffix, ...scopeArgv, "--ids", "doc-1,doc-2"],
                { ...scopeParams, ids: ["doc-1", "doc-2"] }
              ];

      const sendCommand = vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: { complete: true, outcomes: [{ index: 0, id: "doc-1", status: "created" }] }
      }));
      const result = await runCommand(argv, sendCommand);
      expect(result.error, `${command} must be a registered CLI verb`).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith({
        daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL,
        deviceCredential: expect.any(String),
        command,
        params: expectedParams
      });

      expect(result.stdout, `${command} must render through renderBatchWriteResult`).toContain(
        `${command} — 1 element(s)`
      );
      expect(result.stdout).toContain("complete: true");
    }
  });

  it("accepts --idempotency-key on every batched family's verbs (derived)", async () => {
    for (const command of COMMAND_NAMES.filter(
      (name) =>
        (name.endsWith(".create-many") || name.endsWith(".update-many") || name.endsWith(".delete-many")) &&
        COMMAND_DEFINITIONS[name].mutation
    )) {
      const suffix = command.slice(command.lastIndexOf(".") + 1);
      const group = command.slice(0, command.lastIndexOf(".")).split(".");
      const scopeArgv = scopeArgvOf(command);
      const argv =
        suffix === "create-many"
          ? [...group, suffix, ...scopeArgv, "--data-json", "[{}]", "--idempotency-key", "k"]
          : suffix === "update-many"
            ? [
                ...group,
                suffix,
                ...scopeArgv,
                "--patches-json",
                '[{"id":"d","patch":{}}]',
                "--idempotency-key",
                "k"
              ]
            : [...group, suffix, ...scopeArgv, "--ids", "d", "--idempotency-key", "k"];
      const sendCommand = vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: { complete: true, outcomes: [] }
      }));
      const result = await runCommand(argv, sendCommand);
      expect(result.error, `${argv.join(" ")} should accept --idempotency-key`).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ idempotencyKey: "k" }) })
      );
    }
  });

  it("assembles --force on actor delete-many ONLY, and offers it nowhere else", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: { complete: true, outcomes: [{ index: 0, id: "actor-1", status: "deleted" }] }
    }));
    const forced = await runCommand(["actor", "delete-many", "--ids", "actor-1", "--force"], sendCommand);
    expect(forced.error).toBeNull();
    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ params: { ids: ["actor-1"], force: true } })
    );

    const plain = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: { complete: true, outcomes: [] }
    }));
    expect((await runCommand(["actor", "delete-many", "--ids", "actor-1"], plain)).error).toBeNull();
    expect(plain).toHaveBeenCalledWith(expect.objectContaining({ params: { ids: ["actor-1"] } }));

    for (const group of [["item"], ["journal"]]) {
      const rejected = await runCommand([...group, "delete-many", "--ids", "x", "--force"], vi.fn());
      expect(rejected.error, `${group.join(" ")} delete-many must not accept --force`).not.toBeNull();
    }
  });

  it("prints the token-side honesty fields on a scene.token.item.effect batch body", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        sceneId: "scene-1",
        tokenId: "token-1",
        itemId: "item-1",
        actorLink: false,
        mutatesWorldActor: false,
        nonDurable: true,
        warning: "Item-parented ActiveEffects on an unlinked token are NOT durable",
        complete: true,
        outcomes: [{ index: 0, id: "eff-1", status: "created", name: "Bless" }]
      }
    }));
    const result = await runCommand(
      [
        "scene",
        "token",
        "item",
        "effect",
        "create-many",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-1",
        "--item-id",
        "item-1",
        "--data-json",
        '[{"name":"Bless"}]'
      ],
      sendCommand
    );
    expect(result.error).toBeNull();
    expect(result.stdout).toContain("mutatesWorldActor: false (actorLink: false)");
    expect(result.stdout).toContain(
      "WARNING: Item-parented ActiveEffects on an unlinked token are NOT durable"
    );
    expect(result.stdout).toContain("0\teff-1\tcreated\tBless");
  });

  it("prints the scene scope only when the response carries one (the renderer is family-agnostic)", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        complete: true,
        outcomes: [{ index: 0, id: "wall-a", status: "created" }]
      }
    }));

    const result = await runCommand(
      ["scene", "wall", "create-many", "--scene-id", "scene-1", "--data-json", '[{"c":[0,0,1,1]}]'],
      sendCommand
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("scene.wall.create-many — 1 element(s)");
    expect(result.stdout).not.toContain("(scene:");
    expect(result.stdout).not.toContain("unknown");
  });

  it("marks a batch dry-run in the human output and prints null ids for a create preview", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        sceneId: "scene-1",
        complete: true,
        dryRun: true,
        outcomes: [{ index: 0, id: null, status: "created" }]
      }
    }));

    const result = await runCommand(
      [
        "--dry-run",
        "scene",
        "wall",
        "create-many",
        "--scene-id",
        "scene-1",
        "--data-json",
        '[{"c":[0,0,1,1]}]'
      ],
      sendCommand
    );

    expect(result.error).toBeNull();
    expect((sendCommand as unknown as { mock: { calls: any[][] } }).mock.calls[0][0].params).toEqual({
      sceneId: "scene-1",
      data: [{ c: [0, 0, 1, 1] }],
      dryRun: true
    });
    expect(result.stdout).toContain("[dry-run] scene.wall.create-many");
    expect(result.stdout).toContain("0\t(no id)\tcreated");
  });

  it("threads --idempotency-key into a batch call", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        sceneId: "scene-1",
        complete: true,
        outcomes: [{ index: 0, id: "wall-a", status: "deleted" }]
      }
    }));

    const result = await runCommand(
      [
        "scene",
        "wall",
        "delete-many",
        "--scene-id",
        "scene-1",
        "--ids",
        "wall-a",
        "--idempotency-key",
        "batch-1"
      ],
      sendCommand
    );

    expect(result.error).toBeNull();
    expect((sendCommand as unknown as { mock: { calls: any[][] } }).mock.calls[0][0].params).toEqual({
      sceneId: "scene-1",
      ids: ["wall-a"],
      idempotencyKey: "batch-1"
    });
  });

  it("rejects a non-array --data-json on a batch create before any request", async () => {
    const sendCommand = vi.fn();
    const result = await runCommand(
      ["scene", "wall", "create-many", "--scene-id", "scene-1", "--data-json", '{"c":[0,0,1,1]}'],
      sendCommand
    );
    expect(result.error).not.toBeNull();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("prints `name` in the human drawing/light get and list output, on v14 and absent on v13", async () => {
    const respond = (result: Record<string, unknown>) =>
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result
      }));

    const drawingGet = await runCommand(
      ["scene", "drawing", "get", "--scene-id", "scene-1", "--drawing-id", "draw-a"],
      respond({
        sceneId: "scene-1",
        drawing: { id: "draw-a", name: "Trap zone", text: "Danger", x: 1, y: 2 }
      })
    );
    expect(drawingGet.error).toBeNull();
    expect(drawingGet.stdout).toContain("name: Trap zone");

    const lightGet = await runCommand(
      ["scene", "light", "get", "--scene-id", "scene-1", "--light-id", "light-a"],
      respond({
        sceneId: "scene-1",
        light: { id: "light-a", name: "Sconce", x: 1, y: 2, config: { dim: 20 } }
      })
    );
    expect(lightGet.error).toBeNull();
    expect(lightGet.stdout).toContain("name: Sconce");

    const drawingGetV13 = await runCommand(
      ["scene", "drawing", "get", "--scene-id", "scene-1", "--drawing-id", "draw-a"],
      respond({ sceneId: "scene-1", drawing: { id: "draw-a", name: null, text: "Danger", x: 1, y: 2 } })
    );
    expect(drawingGetV13.stdout).toContain("name: \n");
    const lightGetV13 = await runCommand(
      ["scene", "light", "get", "--scene-id", "scene-1", "--light-id", "light-a"],
      respond({ sceneId: "scene-1", light: { id: "light-a", name: null, x: 1, y: 2, config: { dim: 20 } } })
    );
    expect(lightGetV13.stdout).toContain("name: \n");

    const drawingList = await runCommand(
      ["scene", "drawing", "list", "--scene-id", "scene-1"],
      respond({
        sceneId: "scene-1",
        drawings: [
          {
            id: "draw-a",
            name: "Trap zone",
            text: "Danger",
            x: 1,
            y: 2,
            shape: { type: "r" },
            hidden: false
          },
          { id: "draw-b", name: null, text: "", x: 3, y: 4, shape: { type: "r" }, hidden: false }
        ],
        total: 2,
        hasMore: false
      })
    );
    expect(drawingList.error).toBeNull();
    expect(drawingList.stdout).toContain("draw-a\tDanger\t(1,2)\tr\tfalse\tTrap zone");

    expect(drawingList.stdout).toContain("draw-b\t\t(3,4)\tr\tfalse\t(no name)\n");

    const lightList = await runCommand(
      ["scene", "light", "list", "--scene-id", "scene-1"],
      respond({
        sceneId: "scene-1",
        lights: [
          { id: "light-a", name: "Sconce", x: 1, y: 2, hidden: false, config: { dim: 20, bright: 10 } },
          { id: "light-b", name: null, x: 3, y: 4, hidden: false, config: { dim: 5, bright: 2 } }
        ],
        total: 2,
        hasMore: false
      })
    );
    expect(lightList.error).toBeNull();
    expect(lightList.stdout).toContain("light-a\t(1,2)\t20/10\tfalse\tSconce");
    expect(lightList.stdout).toContain("light-b\t(3,4)\t5/2\tfalse\t(no name)\n");
  });

  it("renders a compact id/name list for a populated *.get-many human response", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        actors: [
          { id: "actor-2", name: "Ezren", type: "character", itemCount: 3 },
          { id: "actor-1", name: "Valeros", type: "character", itemCount: 1 }
        ]
      }
    }));

    const result = await runCommand(["actor", "get-many", "--ids", "actor-2,actor-1"], sendCommand);

    expect(result.error).toBeNull();

    expect(result.stdout).toContain("Actors (2)");
    expect(result.stdout).toContain("actor-2\tEzren\tcharacter\titems=3");
    expect(result.stdout).toContain("actor-1\tValeros\tcharacter\titems=1");
    expect(result.stdout.indexOf("Ezren")).toBeLessThan(result.stdout.indexOf("Valeros"));
  });

  it("surfaces per-doc ownership under each row in human *.get-many output (always-readable)", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        items: [
          { id: "item-1", name: "Sword", type: "weapon", ownership: { default: 0, "user-1": 3 } },
          { id: "item-2", name: "Shield", type: "equipment", ownership: {} }
        ]
      }
    }));

    const result = await runCommand(["item", "get-many", "--ids", "item-1,item-2"], sendCommand);

    expect(result.error).toBeNull();

    expect(result.stdout).toContain("item-1\tSword\tweapon");
    expect(result.stdout).toContain("  ownership:");
    expect(result.stdout).toContain("  default: 0 (none)");
    expect(result.stdout).toContain("  user-1: 3 (owner)");

    expect(result.stdout).toContain("  ownership: (none)");
  });

  it("surfaces entry AND per-page ownership (incl. -1 inherit) in human journal.get-many output", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        journals: [
          {
            id: "journal-1",
            name: "Handout",
            pageCount: 1,
            ownership: { default: 2 },
            pages: [{ id: "page-1", name: "Secrets", type: "text", ownership: { default: -1, "user-2": 3 } }]
          }
        ]
      }
    }));

    const result = await runCommand(["journal", "get-many", "--ids", "journal-1"], sendCommand);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("journal-1\tHandout\tpages=1");

    expect(result.stdout).toContain("  default: 2 (observer)");

    expect(result.stdout).toContain("  page 1 ownership:");
    expect(result.stdout).toContain("  page 1   default: -1 (inherit)");
    expect(result.stdout).toContain("  page 1   user-2: 3 (owner)");
  });

  it("surfaces the effectCount marker on actor.list rows in the default human output", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        actors: [{ id: "actor-1", name: "Valeros", type: "character", itemCount: 2, effectCount: 3 }]
      }
    }));

    const result = await runCommand(["actor", "list"], sendCommand);

    expect(result.error).toBeNull();

    expect(result.stdout).toContain("actor-1\tValeros\tcharacter\titems=2\teffects=3");
  });

  it("surfaces the effectCount marker on actor.get-many rows in the default human output", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        actors: [{ id: "actor-1", name: "Valeros", type: "character", itemCount: 2, effectCount: 3 }]
      }
    }));

    const result = await runCommand(["actor", "get-many", "--ids", "actor-1"], sendCommand);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("actor-1\tValeros\tcharacter\titems=2\teffects=3");
  });

  it("surfaces the categoryCount marker on journal.list rows in the default human output", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        journals: [{ id: "journal-1", name: "Handout", pageCount: 4, categoryCount: 2 }]
      }
    }));

    const result = await runCommand(["journal", "list"], sendCommand);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("journal-1\tHandout\tpages=4\tcategories=2");
  });

  it("surfaces effectCount on item.list rows and changeCount on effect.list rows (default human output)", async () => {
    const itemSend = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: { items: [{ id: "item-1", name: "Sword", type: "weapon", effectCount: 2 }] }
    }));
    const itemResult = await runCommand(["item", "list"], itemSend);
    expect(itemResult.error).toBeNull();
    expect(itemResult.stdout).toContain("item-1\tSword\tweapon\teffects=2");

    const effectSend = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        actorId: "actor-1",
        effects: [{ id: "eff-1", name: "Bless", disabled: false, transfer: true, changeCount: 5 }]
      }
    }));
    const effectResult = await runCommand(["actor", "effect", "list", "--actor-id", "actor-1"], effectSend);
    expect(effectResult.error).toBeNull();
    expect(effectResult.stdout).toContain("eff-1\tBless\tdisabled=false\ttransfer=true\tchanges=5");
  });

  it("surfaces rollCount, whisperCount and contentLength on chat.list rows (default human output)", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        messages: [
          {
            id: "msg-1",
            author: "user-1",
            alias: "GM",
            timestamp: 1000,
            contentPreview: "Attack!",
            contentLength: 250,
            whisperCount: 1,
            rollCount: 2
          }
        ]
      }
    }));

    const result = await runCommand(["chat", "list"], sendCommand);

    expect(result.error).toBeNull();

    expect(result.stdout).toContain("msg-1\tuser-1\tGM\t1000\trolls=2\twhisper=1\tlen=250\tAttack!");
  });

  it("surfaces resultCount and drawnCount on table.list rows in the default human output", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        tables: [{ id: "table-1", name: "Loot", formula: "1d6", resultCount: 2, drawnCount: 1 }]
      }
    }));

    const result = await runCommand(["table", "list"], sendCommand);

    expect(result.error).toBeNull();

    expect(result.stdout).toContain("table-1\tLoot\tformula=1d6\tresults=2\tdrawn=1");
  });

  it("renders a journal category list, marking a BLANK name explicitly", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        journalId: "j-1",
        categories: [
          { id: "cat-1", _id: "cat-1", name: "Chapter One", sort: 100 },

          { id: "cat-blank", _id: "cat-blank", name: "", sort: 300 }
        ],
        total: 2,
        hasMore: false
      }
    }));

    const result = await runCommand(["journal", "category", "list", "--journal-id", "j-1"], sendCommand);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("journal: j-1");
    expect(result.stdout).toContain("cat-1\tChapter One\tsort=100");
    expect(result.stdout).toContain("cat-blank\t(blank)\tsort=300");
  });

  it("renders a journal category detail body, blank name included", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        journalId: "j-1",
        category: { id: "cat-blank", _id: "cat-blank", name: "", sort: 0, flags: {} }
      }
    }));

    const result = await runCommand(
      ["journal", "category", "get", "--journal-id", "j-1", "--category-id", "cat-blank"],
      sendCommand
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("journal: j-1");
    expect(result.stdout).toContain("id: cat-blank");
    expect(result.stdout).toContain("name: (blank)");
    expect(result.stdout).toContain("sort: 0");
  });

  it("renders a journal category delete WITH the dangling-page consequence and the repair path", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        journalId: "j-1",
        id: "cat-1",
        deleted: true,
        danglingPageCount: 2,
        danglingPageIds: ["page-a", "page-b"],
        danglingPageIdsTruncated: false
      }
    }));

    const result = await runCommand(
      ["journal", "category", "delete", "--journal-id", "j-1", "--category-id", "cat-1"],
      sendCommand
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Deleted journal category cat-1 from journal j-1");
    expect(result.stdout).toContain("2 page(s) of this journal now store the deleted category id");

    expect(result.stdout).toContain("uncategorized");
    expect(result.stdout).toContain("journal update --pages-json");
    expect(result.stdout).toContain("page page-a");
    expect(result.stdout).toContain("page page-b");
  });

  it("renders the zero-consequence delete and the CAPPED list distinctly", async () => {
    const clean = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        journalId: "j-1",
        id: "cat-1",
        deleted: true,
        danglingPageCount: 0,
        danglingPageIds: [],
        danglingPageIdsTruncated: false
      }
    }));
    const cleanResult = await runCommand(
      ["journal", "category", "delete", "--journal-id", "j-1", "--category-id", "cat-1"],
      clean
    );
    expect(cleanResult.stdout).toContain("No pages of this journal reference it.");

    const capped = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        journalId: "j-1",
        id: "cat-1",
        deleted: true,
        danglingPageCount: 60,
        danglingPageIds: Array.from({ length: 50 }, (unused, index) => `page-${index}`),
        danglingPageIdsTruncated: true
      }
    }));
    const cappedResult = await runCommand(
      ["journal", "category", "delete", "--journal-id", "j-1", "--category-id", "cat-1"],
      capped
    );

    expect(cappedResult.stdout).toContain("60 page(s) of this journal now store");
    expect(cappedResult.stdout).toContain("list capped; 60 page(s) in total");
  });

  it("renders a journal category delete DRY RUN in the conditional voice", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        journalId: "j-1",
        id: "cat-1",
        deleted: false,
        dryRun: true,
        danglingPageCount: 1,
        danglingPageIds: ["page-a"],
        danglingPageIdsTruncated: false
      }
    }));

    const result = await runCommand(
      ["journal", "category", "delete", "--journal-id", "j-1", "--category-id", "cat-1", "--dry-run"],
      sendCommand
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Would delete journal category cat-1");
    expect(result.stdout).toContain("would be left storing");
  });

  it("renders a region behavior list, marking a BLANK name explicitly", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        sceneId: "scene-1",
        regionId: "reg-a",
        behaviors: [
          { id: "beh-1", _id: "beh-1", name: "Dim The Lights", type: "adjustDarknessLevel", disabled: false },

          { id: "beh-2", _id: "beh-2", name: "", type: "pauseGame", disabled: true }
        ],
        total: 2,
        hasMore: false
      }
    }));

    const result = await runCommand(
      ["scene", "region", "behavior", "list", "--scene-id", "scene-1", "--region-id", "reg-a"],
      sendCommand
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("scene: scene-1");
    expect(result.stdout).toContain("region: reg-a");
    expect(result.stdout).toContain("beh-1\tDim The Lights\tadjustDarknessLevel\tdisabled=false");
    expect(result.stdout).toContain("beh-2\t(blank)\tpauseGame\tdisabled=true");
  });

  it("renders a region behavior detail body, blank name included", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        sceneId: "scene-1",
        regionId: "reg-a",
        behavior: {
          id: "beh-2",
          _id: "beh-2",
          name: "",
          type: "pauseGame",
          disabled: true,
          system: {},
          flags: {}
        }
      }
    }));

    const result = await runCommand(
      [
        "scene",
        "region",
        "behavior",
        "get",
        "--scene-id",
        "scene-1",
        "--region-id",
        "reg-a",
        "--behavior-id",
        "beh-2"
      ],
      sendCommand
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("name: (blank)");
    expect(result.stdout).toContain("type: pauseGame");
    expect(result.stdout).toContain("disabled: true");
  });

  it("renders a region behavior delete in the indicative and the dry run in the conditional voice", async () => {
    const real = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: { sceneId: "scene-1", regionId: "reg-a", id: "beh-1", deleted: true }
    }));
    const realResult = await runCommand(
      [
        "scene",
        "region",
        "behavior",
        "delete",
        "--scene-id",
        "scene-1",
        "--region-id",
        "reg-a",
        "--behavior-id",
        "beh-1"
      ],
      real
    );
    expect(realResult.stdout).toContain("Deleted region behavior beh-1 (scene: scene-1, region: reg-a)");

    const dry = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: { sceneId: "scene-1", regionId: "reg-a", id: "beh-1", deleted: false, dryRun: true }
    }));
    const dryResult = await runCommand(
      [
        "scene",
        "region",
        "behavior",
        "delete",
        "--scene-id",
        "scene-1",
        "--region-id",
        "reg-a",
        "--behavior-id",
        "beh-1",
        "--dry-run"
      ],
      dry
    );
    expect(dryResult.stdout).toContain("Would delete region behavior beh-1");
  });

  it("rejects a region behavior update with no field flags before any round-trip", async () => {
    const sendCommand = vi.fn();
    const result = await runCommand(
      [
        "scene",
        "region",
        "behavior",
        "update",
        "--scene-id",
        "scene-1",
        "--region-id",
        "reg-a",
        "--behavior-id",
        "beh-1"
      ],
      sendCommand
    );
    expect(result.error).not.toBeNull();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("renders table.list counts as ? (never a fabricated 0) when the bridge omits the markers", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: { tables: [{ id: "table-1", name: "Loot", formula: "1d6" }] }
    }));

    const result = await runCommand(["table", "list"], sendCommand);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("table-1\tLoot\tformula=1d6\tresults=?\tdrawn=?");
  });

  it("renders a table draw with both outcomes, the owning table per row, and the exhaustion note", async () => {
    const drawResult = {
      tableId: "table-1",
      complete: true,
      mutation: "committed",
      results: [
        {
          id: "row-1",
          type: "text",
          name: "Sword",
          range: [1, 3],
          weight: 2,
          drawn: true,
          documentUuid: null,
          tableId: "table-1",
          tableName: "Loot"
        }
      ],
      roll: { formula: "1d6", total: 2 },
      availableBefore: 2,
      availableAfter: 1,
      chatMessages: { status: "captured", expectedCount: 1, ids: ["msg-9"] }
    };
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: drawResult
    }));

    const result = await runCommand(
      ["table", "draw", "--table-id", "table-1", "--idempotency-key", "k"],
      sendCommand
    );
    expect(result.error).toBeNull();

    expect(result.stdout).toContain("complete: true");
    expect(result.stdout).toContain("mutation: committed");
    expect(result.stdout).toContain("available: 2 -> 1");
    expect(result.stdout).toContain("roll: 1d6 = 2");
    expect(result.stdout).toContain("chat: captured (expected 1, reported 1)");
    expect(result.stdout).toContain("chat ids: msg-9");

    expect(result.stdout).toContain("row-1\ttable-1\tLoot\ttext\trange=1-3");

    const exhausted = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-2",
      ok: true,
      result: {
        ...drawResult,
        results: [],
        roll: { formula: "{}", total: 0 },
        availableBefore: 0,
        availableAfter: 0,
        chatMessages: { status: "captured", expectedCount: 0, ids: [] }
      }
    }));
    const empty = await runCommand(
      ["table", "draw", "--table-id", "table-1", "--idempotency-key", "k2"],
      exhausted
    );
    expect(empty.error).toBeNull();
    expect(empty.stdout).toContain("no results were drawn");
    expect(empty.stdout).not.toContain("chat ids:");

    expect(empty.stdout).toContain("table reset");
    expect(empty.stdout).toContain("table result create");
    expect(empty.stdout).toContain("table get");

    const dryExhausted = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-2b",
      ok: true,
      result: {
        ...drawResult,
        complete: true,
        mutation: "not-executed",
        results: [],
        roll: null,
        availableBefore: 0,
        availableAfter: 0,
        chatMessages: { status: "not-requested", expectedCount: 0, ids: [] },
        dryRun: true
      }
    }));
    const dryExhaustedRun = await runCommand(
      ["--dry-run", "table", "draw", "--table-id", "table-1", "--idempotency-key", "k2b"],
      dryExhausted
    );
    expect(dryExhaustedRun.error).toBeNull();
    expect(dryExhaustedRun.stdout).toContain("available: 0 -> 0");
    expect(dryExhaustedRun.stdout).not.toContain("no results were drawn");
    expect(dryExhaustedRun.stdout).not.toContain("nothing was drawn although rows remain available");

    const partial = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-3",
      ok: true,
      result: {
        ...drawResult,
        complete: false,
        results: [],
        roll: null,
        availableBefore: 2,
        availableAfter: 1,
        chatMessages: { status: "unknown", expectedCount: 1, ids: [] }
      }
    }));
    const partialRun = await runCommand(
      ["table", "draw", "--table-id", "table-1", "--idempotency-key", "k3"],
      partial
    );
    expect(partialRun.error).toBeNull();
    expect(partialRun.stdout).toContain("complete: false");
    expect(partialRun.stdout).toContain("chat: unknown");
    expect(partialRun.stdout).not.toContain("no results were drawn");

    const unreachable = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-4",
      ok: true,
      result: {
        ...drawResult,
        results: [],
        roll: { formula: "1d6", total: 4 },
        availableBefore: 2,
        availableAfter: 2,
        chatMessages: { status: "captured", expectedCount: 0, ids: [] }
      }
    }));
    const unreachableRun = await runCommand(
      ["table", "draw", "--table-id", "table-1", "--idempotency-key", "k4"],
      unreachable
    );
    expect(unreachableRun.error).toBeNull();
    expect(unreachableRun.stdout).not.toContain("no results were drawn");

    expect(unreachableRun.stdout).toContain("nothing was drawn although rows remain available");
    expect(unreachableRun.stdout).toContain("nested table");

    expect(partialRun.stdout).not.toContain("nothing was drawn although rows remain available");

    const overCapture = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-5",
      ok: true,
      result: {
        ...drawResult,
        chatMessages: { status: "captured", expectedCount: 1, ids: [] }
      }
    }));
    const overCaptureRun = await runCommand(
      ["table", "draw", "--table-id", "table-1", "--idempotency-key", "k5"],
      overCapture
    );
    expect(overCaptureRun.error).toBeNull();
    expect(overCaptureRun.stdout).toContain("chat: captured (expected 1, reported 0)");
    expect(overCaptureRun.stdout).toContain("chat ids: (withheld");
    expect(overCaptureRun.stdout).toContain("concurrent draw of the same table");

    expect(result.stdout).not.toContain("withheld");
  });

  it("renders a table reset with its PRE-reset changedCount and the cleared rows", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        tableId: "table-1",
        reset: true,
        changedCount: 2,
        table: {
          id: "table-1",
          name: "Loot",
          formula: "1d6",
          results: [{ id: "row-1", type: "text", name: "Sword", range: [1, 3], weight: 2, drawn: false }]
        }
      }
    }));

    const result = await runCommand(["table", "reset", "--table-id", "table-1"], sendCommand);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("reset: true");

    expect(result.stdout).toContain("changedCount: 2");
    expect(result.stdout).toContain("drawn=false");
  });

  it("prints a row identically in table.result.list and in table.get's embedded rows", async () => {
    const row = {
      id: "row-1",
      type: "document",
      name: "Goblin",
      range: [1, 5],
      weight: 3,
      drawn: true,
      documentUuid: "Actor.abc",
      tableId: "table-1",
      tableName: "Loot"
    };
    const expectedLine = "row-1\tdocument\trange=1-5\tweight=3\tdrawn=true\tGoblin\tActor.abc";

    const embedded = await runCommand(
      ["table", "get", "--table-id", "table-1"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: { table: { id: "table-1", name: "Loot", formula: "1d6", results: [row] } }
      })) as unknown as Parameters<typeof runCommand>[1]
    );
    expect(embedded.error).toBeNull();

    expect(embedded.stdout).toContain(`  ${expectedLine}`);

    const perTable = await runCommand(
      ["table", "result", "list", "--table-id", "table-1"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: { tableId: "table-1", results: [row], total: 1, hasMore: false }
      })) as unknown as Parameters<typeof runCommand>[1]
    );
    expect(perTable.error).toBeNull();
    expect(perTable.stdout).toContain(`\n${expectedLine}\n`);

    const crossTable = await runCommand(
      ["table", "result", "list"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: { results: [row], total: 1, hasMore: false }
      })) as unknown as Parameters<typeof runCommand>[1]
    );
    expect(crossTable.error).toBeNull();
    expect(crossTable.stdout).toContain("scope: all roll tables");
    expect(crossTable.stdout).toContain(
      "row-1\ttable-1\tLoot\tdocument\trange=1-5\tweight=3\tdrawn=true\tGoblin\tActor.abc"
    );
  });

  it("surfaces the nested effectCount marker on actor.get items in the default human output", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        actor: {
          id: "actor-1",
          name: "Valeros",
          type: "character",
          system: {},
          flags: {},
          effects: [],
          items: [{ id: "item-1", name: "Sword", type: "weapon", effectCount: 4 }]
        }
      }
    }));

    const result = await runCommand(["actor", "get", "--actor-id", "actor-1"], sendCommand);

    expect(result.error).toBeNull();

    expect(result.stdout).toContain("item: item-1\tSword\tweapon\teffects=4");
  });

  it("renders a lean count line (no flags/effects body) on item.get-many rows in the default human output", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        items: [
          {
            id: "item-1",
            name: "Sword",
            type: "weapon",
            img: "icons/svg/sword.svg",
            folder: null,
            sort: 0,
            system: { damage: "1d8" },
            flags: { ddbimporter: { id: 42 } },
            effects: [
              { id: "eff-1", name: "Sharpened" },
              { id: "eff-2", name: "Blessed" }
            ]
          },
          {
            id: "item-2",
            name: "Shield",
            type: "equipment",
            img: "icons/svg/shield.svg",
            folder: null,
            sort: 0,
            system: {},
            flags: {},
            effects: []
          }
        ]
      }
    }));

    const result = await runCommand(["item", "get-many", "--ids", "item-1,item-2"], sendCommand);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("item-1\tSword\tweapon\teffects=2");
    expect(result.stdout).toContain("item-2\tShield\tequipment\teffects=0");

    expect(result.stdout).not.toContain("ddbimporter");
    expect(result.stdout).not.toContain("Sharpened");
    expect(result.stdout).not.toContain("  flags:");
    expect(result.stdout).not.toContain("  effects:");
  });

  it("renders an unknown count as ? (never a fabricated 0) when the bridge omits the additive marker", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,

      result: { actors: [{ id: "actor-1", name: "Valeros", type: "character" }] }
    }));

    const result = await runCommand(["actor", "list"], sendCommand);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("actor-1\tValeros\tcharacter\titems=?\teffects=?");
  });

  it("renders a broken-reference report with a grep-parseable summary for world.audit-files", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        broken: [
          {
            docType: "PlaylistSound",
            id: "s1",
            name: "War Drums",
            field: "path",
            path: "worlds/w/audio/drums-missing.mp3",
            parent: "pl-1"
          }
        ],
        total: 1,
        hasMore: false,
        checkedRefs: 4,
        checkedFiles: 4,
        skipped: [{ path: "icons/svg/mystery-man.svg", reason: "public-or-external", count: 2 }]
      }
    }));

    const result = await runCommand(["world", "audit-files"], sendCommand);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Broken references (1)");
    expect(result.stdout).toContain(
      "PlaylistSound\ts1\tWar Drums\tpath\tworlds/w/audio/drums-missing.mp3\t(in pl-1)"
    );
    expect(result.stdout).toContain("summary: broken=1 checkedRefs=4 checkedFiles=4 skipped=2");
    expect(result.stdout).toContain("skipped\tpublic-or-external\ticons/svg/mystery-man.svg\t(x2)");
  });

  it("renders sectioned search results with a per-corpus index summary for world.search", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        results: [
          {
            refKey: "world:Actor.actor-1.Item.item-1",
            source: "world",
            documentType: "Item",
            id: "item-1",
            parents: [{ documentType: "Actor", id: "actor-1", name: "Valeros" }],
            pack: null,
            name: "Longsword",
            resolved: true,
            score: 4.5,
            snippet: null
          },
          {
            refKey: "world:Folder.gone",
            source: "world",
            documentType: "Folder",
            id: "gone",
            parents: [],
            pack: null,
            name: null,
            resolved: false,
            score: 2.25,
            snippet: null
          },
          {
            refKey: "pack:dnd5e.items:pack-1",
            source: "compendium",
            documentType: "Item",
            id: "pack-1",
            parents: [],
            pack: { id: "dnd5e.items", label: "Items (SRD)" },
            name: "Longsword",
            resolved: true,
            score: 9.75,
            snippet: null
          }
        ],
        total: 3,
        hasMore: false,
        mode: "name",
        includeCompendia: true,
        source: null,
        index: {
          world: {
            status: "ready",
            generation: 2,
            entryCount: 120,
            indexedChars: 3400,
            textTruncatedCount: 0,
            builtThisCall: true,
            stale: false,
            matchCount: 2
          },
          compendium: {
            status: "ready",
            generation: 0,
            entryCount: 900,
            indexedChars: 14000,
            textTruncatedCount: 0,
            builtThisCall: true,
            stale: false,
            matchCount: 1,
            skippedPackCount: 1,
            failedPackCount: 2
          }
        }
      }
    }));

    const result = await runCommand(
      ["world", "search", "--query", "longsword", "--include-compendia"],
      sendCommand
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Search results (3)");

    expect(result.stdout).toContain("world	Item	item-1	Longsword	4.500	in Actor:Valeros");

    expect(result.stdout).toContain("world	Folder	gone	(deleted since indexing)	2.250");
    expect(result.stdout).toContain("compendium	Item	pack-1	Longsword	9.750	pack=dnd5e.items");
    expect(result.stdout).toContain(
      "index.world: status=ready entries=120 matches=2 generation=2 builtThisCall=true stale=false textTruncated=0"
    );

    expect(result.stdout).toContain("skippedPacks=1 failedPacks=2");
  });

  it("holds the positional columns for a world.search row with a blank name or a blank parent name", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        results: [
          {
            refKey: "world:RollTable.t1.TableResult.tr-1",
            source: "world",
            documentType: "TableResult",
            id: "tr-1",
            parents: [{ documentType: "RollTable", id: "t1", name: "Wild Magic" }],
            pack: null,
            name: "",
            resolved: true,
            score: 0.392,
            snippet: null
          },
          {
            refKey: "world:Scene.s1.Token.tok-1",
            source: "world",
            documentType: "Token",
            id: "tok-1",

            parents: [{ documentType: "Actor", id: "actor-9", name: "" }],
            pack: null,
            name: "Goblin Scout",
            resolved: true,
            score: 1.5,
            snippet: null
          }
        ],
        total: 2,
        hasMore: false,
        mode: "name",
        includeCompendia: false,
        source: null,
        index: {
          world: {
            status: "ready",
            generation: 1,
            entryCount: 10,
            indexedChars: 200,
            textTruncatedCount: 0,
            builtThisCall: true,
            stale: false,
            matchCount: 2
          },
          compendium: null
        }
      }
    }));

    const result = await runCommand(["world", "search", "--query", "wild"], sendCommand);

    expect(result.error).toBeNull();

    expect(result.stdout).toContain("world	TableResult	tr-1		0.392	in RollTable:Wild Magic");
    expect(result.stdout).toContain("world	Token	tok-1	Goblin Scout	1.500	in Actor:actor-9");

    const blankNameRow = result.stdout.split("\n").find((line) => line.startsWith("world\tTableResult\t"));
    expect(blankNameRow).toBeDefined();
    const fields = (blankNameRow as string).split("\t");
    expect(fields[3]).toBe("");
    expect(fields[4]).toBe("0.392");
  });

  it("appends a full-mode snippet as a LABELED cell, leaving the five positional columns alone", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        results: [
          {
            refKey: "world:JournalEntry.j1.JournalEntryPage.p1",
            source: "world",
            documentType: "JournalEntryPage",
            id: "p1",
            parents: [{ documentType: "JournalEntry", id: "j1", name: "Saltmarsh Notes" }],
            pack: null,
            name: "Smuggler Rumours",
            resolved: true,
            score: 3.5,
            snippet: {
              field: "text",
              text: "…the smugglers meet at the wharf…",
              matches: [{ start: 4, length: 9 }],
              truncated: false
            }
          },
          {
            refKey: "pack:dnd5e.items:pack-1",
            source: "compendium",
            documentType: "Item",
            id: "pack-1",
            parents: [],
            pack: { id: "dnd5e.items", label: "Items (SRD)" },
            name: "Smuggler's Kit",
            resolved: true,
            score: 1.25,

            snippet: null
          }
        ],
        total: 2,
        hasMore: false,
        mode: "full",
        includeCompendia: true,
        source: null,
        index: {
          world: {
            status: "ready",
            generation: 3,
            entryCount: 120,
            indexedChars: 240_000,

            textTruncatedCount: 9,
            builtThisCall: false,
            stale: false,
            matchCount: 1
          },
          compendium: {
            status: "ready",
            generation: 1,
            entryCount: 900,
            indexedChars: 14_000,
            textTruncatedCount: 0,
            builtThisCall: false,
            stale: false,
            matchCount: 1,
            skippedPackCount: 0,
            failedPackCount: 0
          }
        }
      }
    }));

    const result = await runCommand(
      ["world", "search", "--query", "smugglers", "--mode", "full", "--include-compendia"],
      sendCommand
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain(
      "world	JournalEntryPage	p1	Smuggler Rumours	3.500	in JournalEntry:Saltmarsh Notes	snippet=…the smugglers meet at the wharf…"
    );

    expect(result.stdout).toContain("compendium	Item	pack-1	Smuggler's Kit	1.250	pack=dnd5e.items");
    expect(result.stdout).not.toContain("pack=dnd5e.items	snippet=");

    expect(result.stdout).toContain("textTruncated=9");

    const row = result.stdout.split("\n").find((line) => line.startsWith("world\tJournalEntryPage\t"));
    expect((row as string).split("\t")[4]).toBe("3.500");
  });

  it("keeps a TAB or NEWLINE in a stored name from shifting a column or splitting a world.search row", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        results: [
          {
            refKey: "world:Actor.a1",
            source: "world",
            documentType: "Actor",
            id: "a1",
            parents: [],
            pack: null,
            name: "Goblin\tScout\nSecond line",
            resolved: true,
            score: 2,
            snippet: null
          },
          {
            refKey: "world:Actor.a2.Item.i2",
            source: "world",
            documentType: "Item",
            id: "i2",

            parents: [{ documentType: "Actor", id: "actor-9", name: "\t" }],
            pack: null,
            name: "Dagger",
            resolved: true,
            score: 1,
            snippet: null
          }
        ],
        total: 2,
        hasMore: false,
        mode: "name",
        includeCompendia: false,
        source: null,
        index: {
          world: {
            status: "ready",
            generation: 1,
            entryCount: 4,
            indexedChars: 40,
            textTruncatedCount: 0,
            builtThisCall: true,
            stale: false,
            matchCount: 2
          },
          compendium: null
        }
      }
    }));

    const result = await runCommand(["world", "search", "--query", "goblin"], sendCommand);

    expect(result.error).toBeNull();
    const rows = result.stdout.split("\n");
    const actorRow = rows.find((line) => line.startsWith("world\tActor\t"));
    expect(actorRow).toBeDefined();
    const fields = (actorRow as string).split("\t");

    expect(fields).toHaveLength(5);
    expect(fields[3]).toBe("Goblin Scout Second line");
    expect(fields[4]).toBe("2.000");

    expect(rows.filter((line) => line.includes("Second line"))).toHaveLength(1);

    expect(result.stdout).toContain("world\tItem\ti2\tDagger\t1.000\tin Actor:actor-9");
  });

  it("scrubs C0/C1 CONTROL characters out of a human row, so a stored name cannot drive the terminal", async () => {
    const hostileName = "Gob\u001b[31mlin\u001b]0;pwned\u0007 \u007f\u0085\u009bend";
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        results: [
          {
            refKey: "world:Actor.a1",
            source: "world",
            documentType: "Actor",
            id: "a1",
            parents: [{ documentType: "Folder", id: "f1", name: "Camp\u001b[2Jsite" }],
            pack: null,
            name: hostileName,
            resolved: true,
            score: 2,
            snippet: null
          }
        ],
        total: 1,
        hasMore: false,
        mode: "name",
        includeCompendia: false,
        source: null,
        index: {
          world: {
            status: "ready",
            generation: 1,
            entryCount: 1,
            indexedChars: 10,
            textTruncatedCount: 0,
            builtThisCall: true,
            stale: false,
            matchCount: 1
          },
          compendium: null
        }
      }
    }));

    const result = await runCommand(["world", "search", "--query", "goblin"], sendCommand);

    expect(result.error).toBeNull();

    expect(result.stdout).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u);
    const row = result.stdout.split("\n").find((line) => line.startsWith("world\tActor\t"));
    const fields = (row as string).split("\t");

    expect(fields[3]).toBe("Gob [31mlin ]0;pwned end");
    expect(fields[4]).toBe("2.000");
    expect(fields[5]).toBe("in Folder:Camp [2Jsite");
  });

  it("reports a corpus that was NOT BUILT as such for world.search", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        results: [],
        total: 0,
        hasMore: false,
        mode: "name",
        includeCompendia: false,
        source: "world",
        index: {
          world: {
            status: "ready",
            generation: 0,
            entryCount: 5,
            indexedChars: 60,
            textTruncatedCount: 0,
            builtThisCall: true,
            stale: false,
            matchCount: 0
          },
          compendium: null
        }
      }
    }));

    const result = await runCommand(["world", "search", "--query", "nothing"], sendCommand);

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("No matches found.");
    expect(result.stdout).toContain("index.compendium: not built");
  });

  it("rejects an unknown --mode / --source locally, before any round-trip", async () => {
    const sendCommand = vi.fn(async () => {
      throw new Error("must not reach the daemon");
    });

    const badMode = await runCommand(["world", "search", "--query", "x", "--mode", "text"], sendCommand);
    expect(badMode.error).not.toBeNull();
    expect(sendCommand).not.toHaveBeenCalled();

    const casedMode = await runCommand(["world", "search", "--query", "x", "--mode", "FULL"], sendCommand);
    expect(casedMode.error).not.toBeNull();
    expect(sendCommand).not.toHaveBeenCalled();
    const badSource = await runCommand(
      ["world", "search", "--query", "x", "--source", "compendium"],
      sendCommand
    );
    expect(badSource.error).not.toBeNull();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("rejects an EMPTY --types list locally, and never sends types:[] (which would mean NO filter)", async () => {
    const sendCommand = vi.fn(async () => {
      throw new Error("must not reach the daemon");
    });

    for (const value of ["", " ", ",", " , "]) {
      const result = await runCommand(["world", "search", "--query", "x", "--types", value], sendCommand);
      expect(result.error, `--types ${JSON.stringify(value)} must be refused locally`).not.toBeNull();
      expect(sendCommand).not.toHaveBeenCalled();
    }
  });

  it("reads a local file and serializes file.upload", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "fvtt-world-cli-upload-"));
    const localPath = join(tempDir, "upload.txt");
    writeFileSync(localPath, "upload body", "utf8");

    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {}
    }));

    try {
      const result = await runCommand(
        ["file", "upload", "--path", "worlds/world-1/assets/upload.txt", "--from-file", localPath],
        sendCommand
      );

      expect(result.error).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith({
        daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL,
        deviceCredential: expect.any(String),
        command: "file.upload",
        params: {
          path: "worlds/world-1/assets/upload.txt",
          contentBase64: Buffer.from("upload body", "utf8").toString("base64")
        }
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reads the macro body from --command-file", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "fvtt-world-cli-macro-"));
    const bodyPath = join(tempDir, "macro.js");
    const body = "// multi-line body\nconst x = `${actor?.name}`;\nconsole.log(x);\n";
    writeFileSync(bodyPath, body, "utf8");

    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {}
    }));

    try {
      const result = await runCommand(
        ["macro", "create", "--name", "Big Macro", "--type", "script", "--command-file", bodyPath],
        sendCommand
      );

      expect(result.error).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith({
        daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL,
        deviceCredential: expect.any(String),
        command: "macro.create",
        params: { data: { name: "Big Macro", type: "script", command: body } }
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails with a clear error when --command-file points at a missing file", async () => {
    const sendCommand = failIfCalledSendCommand();
    const result = await runCommand(
      ["macro", "create", "--name", "Broken", "--command-file", "/no/such/macro-body.js"],
      sendCommand
    );

    expect(result.error).toBeInstanceOf(CommanderError);
    expect((result.error as CommanderError).message).toContain(
      "Failed to read --command-file /no/such/macro-body.js"
    );
    expect(sendCommand).not.toHaveBeenCalled();

    expect(planCliErrorOutput(result.error, false).exitCode).toBe(1);
    const envelope = JSON.parse(planCliErrorOutput(result.error, true).stdout ?? "");
    expect(envelope.error.code).toBe("LOCAL_FILE_ERROR");
  });

  it("rejects a file rename whose --to-name contains a path separator (no daemon round-trip)", async () => {
    const sendCommand = failIfCalledSendCommand();
    const result = await runCommand(
      ["file", "rename", "--from", "worlds/world-1/assets/a.txt", "--to-name", "sub/b.txt"],
      sendCommand
    );
    expect(result.error).toBeInstanceOf(CommanderError);
    expect((result.error as CommanderError).message).toContain("bare filename with no path separators");
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range ownership --default locally (no daemon round-trip)", async () => {
    const sendCommand = failIfCalledSendCommand();
    const result = await runCommand(
      ["item", "ownership", "set", "--item-id", "item-1", "--default", "9"],
      sendCommand
    );
    expect(result.error).toBeInstanceOf(CommanderError);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it.each([
    [
      ["table", "result", "create", "--table-id", "t1", "--range", "1"],
      "exactly two comma-separated integers"
    ],
    [
      ["table", "result", "create", "--table-id", "t1", "--range", "1,2,3"],
      "exactly two comma-separated integers"
    ],
    [["table", "result", "create", "--table-id", "t1", "--range", "1,x"], "must be integers"],
    [["table", "result", "create", "--table-id", "t1", "--range", "1.5,2"], "must be integers"]
  ])("rejects a malformed --range locally for %j (no daemon round-trip)", async (argv, message) => {
    const sendCommand = failIfCalledSendCommand();
    const result = await runCommand(argv, sendCommand);
    expect(result.error).toBeInstanceOf(CommanderError);
    expect((result.error as CommanderError).message).toContain(message);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  describe("import-from-compendium typed flags validate against each family's closed patch schema", () => {
    const FLAG_ARGV: Record<string, string[]> = {
      name: ["--name", "Renamed By Flag"],
      img: ["--img", "icons/svg/dice.svg"],
      sort: ["--sort", "42"]
    };

    const registrations = () => Object.entries(IMPORT_PATCH_FLAGS);

    it("covers exactly the verbs the shared helper owns (derived from COMMAND_NAMES)", () => {
      const recorded = registrations()
        .map(([command]) => command)
        .sort();

      const expected = COMMAND_NAMES.filter(
        (name) =>
          name.endsWith(".import-from-compendium") &&
          name !== "actor.import-from-compendium" &&
          name !== "actor.item.import-from-compendium"
      ).sort();
      expect(expected.length).toBeGreaterThan(0);
      expect(
        recorded,
        "registerCompendiumImport must own every world import verb except the two actor ones"
      ).toEqual(expected);
    });

    it("assembles a patch the real validator accepts, for every registered flag of every family", async () => {
      for (const [command, fields] of registrations()) {
        const noun = command.slice(0, command.indexOf("."));
        for (const field of fields) {
          const sendCommand = vi.fn(async () => ({
            protocolVersion: "1.0",
            type: "command.response",
            id: "req-1",
            ok: true,
            result: {}
          })) as unknown as SendCommandMock;

          const result = await runCommand(
            [noun, "import-from-compendium", "--pack", "world.p", "--entry-id", "e1", ...FLAG_ARGV[field]],
            sendCommand
          );

          expect(result.error ?? null, `${command} --${field} was recorded but is not registered`).toBeNull();
          expect(sendCommand, `${command} --${field} never reached the daemon`).toHaveBeenCalled();

          const params = (sendCommand as unknown as { mock: { calls: any[][] } }).mock.calls.at(-1)![0]
            .params;
          expect(params.patch, `${command} --${field} assembled no patch`).toHaveProperty(field);

          const validated = validateCommandRequest({
            protocolVersion: PROTOCOL_VERSION,
            type: MESSAGE_TYPES.COMMAND_REQUEST,
            id: `req_${command}_${field}`,
            command,
            params
          });
          expect(
            validated.errors ?? [],
            `${command} --${field} is a DEAD flag: the family's closed import patch schema rejects it`
          ).toEqual([]);
          expect(validated.ok).toBe(true);
        }
      }
    });

    it("does NOT offer --sort for macro (macroPatchSchema has no sort field)", async () => {
      const sendCommand = failIfCalledSendCommand();
      const result = await runCommand(
        ["macro", "import-from-compendium", "--pack", "world.p", "--entry-id", "e1", "--sort", "5"],
        sendCommand
      );
      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).message).toContain("--sort");
      expect(sendCommand).not.toHaveBeenCalled();

      expect(
        Object.keys(
          COMMAND_DEFINITIONS["macro.import-from-compendium"].paramsSchema.properties.patch.properties
        )
      ).not.toContain("sort");
    });
  });

  it("rejects a bad --users-json level locally (no daemon round-trip)", async () => {
    const sendCommand = failIfCalledSendCommand();
    const result = await runCommand(
      ["actor", "ownership", "set", "--actor-id", "actor-1", "--users-json", '{"u1":7}'],
      sendCommand
    );
    expect(result.error).toBeInstanceOf(CommanderError);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("reads the macro body from --command-stdin", async () => {
    const body = "// piped body\nui.notifications.info('hi');\n";
    const stdin = Readable.from([body]) as Readable & { isTTY?: boolean };
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {}
    })) as unknown as SendCommandMock;

    const program = createProgram({
      stdout,
      stderr,
      stdin,
      sendCommand,
      configStore: createInMemoryConfigStore(createDefaultTestConfig())
    });
    program.exitOverride();
    await program.parseAsync(
      ["node", "fvtt-world-cli", "macro", "create", "--name", "Piped", "--command-stdin"],
      { from: "node" }
    );

    expect(sendCommand).toHaveBeenCalledWith({
      daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL,
      deviceCredential: expect.any(String),
      command: "macro.create",
      params: { data: { name: "Piped", command: body } }
    });
  });

  it("fast-fails --command-stdin on an interactive terminal instead of hanging", async () => {
    const stdin = Readable.from([""]) as Readable & { isTTY?: boolean };
    stdin.isTTY = true;
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();
    const sendCommand = vi.fn() as unknown as SendCommandMock;

    const program = createProgram({
      stdout,
      stderr,
      stdin,
      sendCommand,
      configStore: createInMemoryConfigStore(createDefaultTestConfig())
    });
    program.exitOverride();

    let error: unknown = null;
    try {
      await program.parseAsync(
        ["node", "fvtt-world-cli", "macro", "create", "--name", "Piped", "--command-stdin"],
        { from: "node" }
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CommanderError);

    expect(planCliErrorOutput(error, false).exitCode).toBe(2);
    expect((error as CommanderError).message).toContain("interactive terminal");
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("prefers --command-file over --command-stdin and --command (documented precedence)", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "fvtt-world-cli-macro-prec-"));
    const bodyPath = join(tempDir, "macro.js");
    writeFileSync(bodyPath, "FROM_FILE", "utf8");

    const stdin = Readable.from(["FROM_STDIN"]) as Readable & { isTTY?: boolean };
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {}
    })) as unknown as SendCommandMock;

    try {
      const program = createProgram({
        stdout,
        stderr,
        stdin,
        sendCommand,
        configStore: createInMemoryConfigStore(createDefaultTestConfig())
      });
      program.exitOverride();
      await program.parseAsync(
        [
          "node",
          "fvtt-world-cli",
          "macro",
          "create",
          "--name",
          "Prec",
          "--command",
          "FROM_INLINE",
          "--command-file",
          bodyPath,
          "--command-stdin"
        ],
        { from: "node" }
      );

      const call = (sendCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        params: { data: { command: string } };
      };
      expect(call.params.data.command).toBe("FROM_FILE");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("renders human-readable success output by default", async () => {
    const result = await runCommand(
      ["system", "ping"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          pong: true,
          timestamp: "2026-04-06T12:00:00.000Z",
          bridge: {
            status: "connected"
          }
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("pong: true");
    expect(result.stdout).toContain("bridge status: connected");
    expect(result.stderr).toBe("");
  });

  it("renders the installed module count for system.info in human-readable mode", async () => {
    const result = await runCommand(
      ["system", "info"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          module: { id: "fvtt-world-cli", title: "World CLI for Foundry VTT", version: "0.1.0" },
          world: { id: "world-1", title: "Automation Test World" },
          user: { id: "user-1", name: "GM", isGM: true },
          bridge: { status: "connected" },
          modules: [
            { id: "fvtt-world-cli", title: "World CLI for Foundry VTT", version: "0.1.0", active: true },
            { id: "dae", title: "Dynamic Active Effects", version: "11.0.0", active: false }
          ],
          limits: { uploadBytes: 104857600, wsMaxPayloadBytes: 140858710, uploadSource: "config" },
          commands: ["system.ping", "system.info"]
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("modules: 2");

    expect(result.stdout).toContain("limits.uploadBytes: 104857600 (source: config)");
    expect(result.stdout).toContain("limits.wsMaxPayloadBytes: 140858710");
    expect(result.stderr).toBe("");
  });

  it("renders scene.thumbnail.generate output without dumping the data URL", async () => {
    const thumb = `data:image/webp;base64,${"A".repeat(4000)}`;
    const result = await runCommand(
      ["scene", "thumbnail", "generate", "--scene-id", "scene-1", "--include-thumb"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          sceneId: "scene-1",
          thumbnail: {
            thumb,

            storedPath: "worlds/test/assets/scenes/scene-1-thumb.webp",
            sizeBytes: 3000,
            outputWidth: 300,
            outputHeight: 100,
            sourceWidth: 4000,
            sourceHeight: 3000,
            persisted: true
          }
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Generated thumbnail for scene scene-1");
    expect(result.stdout).toContain("output: 300x100");
    expect(result.stdout).toContain("source: 4000x3000");
    expect(result.stdout).toContain("size: 3000 bytes");
    expect(result.stdout).toContain("persisted: true");

    expect(result.stdout).toContain("stored path: worlds/test/assets/scenes/scene-1-thumb.webp");

    expect(result.stdout).not.toContain("AAAA");
    expect(result.stdout).toContain("data URL — read it with --json");
  });

  it("renders a thumbnail dry run and an unreported source size honestly", async () => {
    const result = await runCommand(
      ["--dry-run", "scene", "thumbnail", "generate", "--scene-id", "scene-1"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          sceneId: "scene-1",
          thumbnail: {
            thumb: null,
            storedPath: null,
            sizeBytes: null,
            outputWidth: 300,
            outputHeight: 100,
            sourceWidth: null,
            sourceHeight: null,
            persisted: false
          },
          dryRun: true
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("[dry-run] would generate a thumbnail for scene scene-1");
    expect(result.stdout).toContain("source: not reported by this Foundry version");
    expect(result.stdout).toContain("size: n/a (dry run)");
    expect(result.stdout).toContain("persisted: false");

    expect(result.stdout).toContain("stored path: n/a (dry run)");
  });

  it("renders scene.fog.reset output for the real and dry-run shapes", async () => {
    const real = await runCommand(
      ["scene", "fog", "reset", "--scene-id", "scene-1"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: { sceneId: "scene-1", reset: true, clearedCount: 2, viewedSceneId: "scene-1" }
      }))
    );

    expect(real.error).toBeNull();
    expect(real.stdout).toContain("Reset fog of war for scene scene-1");
    expect(real.stdout).toContain("cleared: 2 fog exploration document(s)");
    expect(real.stdout).toContain("viewed scene: scene-1");

    const dry = await runCommand(
      ["--dry-run", "scene", "fog", "reset", "--scene-id", "scene-1"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: { sceneId: "scene-1", reset: false, clearedCount: 2, viewedSceneId: "scene-2", dryRun: true }
      }))
    );

    expect(dry.error).toBeNull();
    expect(dry.stdout).toContain("[dry-run] would reset fog of war for scene scene-1");
    expect(dry.stdout).toContain("would clear: 2 fog exploration document(s)");
    expect(dry.stdout).toContain("viewed scene: scene-2");
  });

  it("renders scene update output in human-readable mode", async () => {
    const result = await runCommand(
      [
        "scene",
        "update",
        "--scene-id",
        "scene-1",
        "--background-json",
        '{"src":"worlds/world-1/maps/level-2.webp"}'
      ],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          scene: {
            id: "scene-1",
            name: "Dungeon Level 2",
            active: false,
            navigation: true,
            navOrder: 1,
            width: 4000,
            height: 3000,
            grid: {
              size: 100
            },
            background: {
              src: "worlds/world-1/maps/level-2.webp"
            }
          }
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("name: Dungeon Level 2");
    expect(result.stdout).toContain('background: {"src":"worlds/world-1/maps/level-2.webp"}');
  });

  it("renders file list output in human-readable mode", async () => {
    const result = await runCommand(
      ["file", "list", "--path", "worlds/world-1"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          directory: {
            path: "worlds/world-1"
          },
          entries: [
            {
              path: "worlds/world-1/assets",
              kind: "directory",
              mediaCategory: "directory",
              size: null
            },
            {
              path: "worlds/world-1/assets/map.webp",
              kind: "file",
              mediaCategory: "image",
              size: 2048
            }
          ]
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Directory: worlds/world-1");
    expect(result.stdout).toContain("dir\tworlds/world-1/assets\tdirectory\t-");
    expect(result.stdout).toContain("file\tworlds/world-1/assets/map.webp\timage\t2048");
  });

  it("threads file list --recursive/--max-depth/--max-entries into params", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        directory: { path: "worlds/world-1" },
        entries: [],
        recursive: true,
        truncated: false,
        truncatedAt: null,
        skipped: []
      }
    }));

    const result = await runCommand(
      ["file", "list", "--path", "worlds/world-1", "--recursive", "--max-depth", "2", "--max-entries", "3"],
      sendCommand
    );

    expect(result.error).toBeNull();
    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "file.list",
        params: { path: "worlds/world-1", recursive: true, maxDepth: 2, maxEntries: 3 }
      })
    );
  });

  it("renders recursive file list output with depth column and a loud truncation marker", async () => {
    const result = await runCommand(
      ["file", "list", "--path", "worlds/world-1", "--recursive"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          directory: { path: "worlds/world-1" },
          recursive: true,
          truncated: true,
          truncatedAt: "worlds/world-1/maps",
          skipped: [{ path: "worlds/world-1/secret", reason: "Permission denied" }],
          skippedTruncated: true,
          entries: [
            {
              path: "worlds/world-1/maps",
              kind: "directory",
              mediaCategory: "directory",
              size: null,
              depth: 1
            },
            {
              path: "worlds/world-1/maps/dungeon.webp",
              kind: "file",
              mediaCategory: "image",
              size: 4,
              depth: 2
            }
          ]
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("Directory: worlds/world-1 (recursive)");
    expect(result.stdout).toContain("dir\td1\tworlds/world-1/maps\tdirectory\t-");
    expect(result.stdout).toContain("file\td2\tworlds/world-1/maps/dungeon.webp\timage\t4");
    expect(result.stdout).toContain("skipped\tworlds/world-1/secret\tPermission denied");
    expect(result.stdout).toContain("SKIP LIST TRUNCATED");
    expect(result.stdout).toContain("TRUNCATED at worlds/world-1/maps");
  });

  it("renders journal output in human-readable mode", async () => {
    const result = await runCommand(
      ["journal", "get", "--journal-id", "journal-1"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          journal: {
            id: "journal-1",
            name: "GM Notes",
            folder: null,
            sort: 0,
            pages: [
              {
                id: "page-1",
                name: "Secrets",
                type: "text",
                text: {
                  content: "Secret text"
                },
                src: null
              }
            ]
          }
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("name: GM Notes");
    expect(result.stdout).toContain("pages: 1");
    expect(result.stdout).toContain("page 1 text: Secret text");
  });

  it("renders journal categories, image captions, title config, and page formats in human-readable mode", async () => {
    const longCaption = "x".repeat(75);
    const result = await runCommand(
      ["journal", "get", "--journal-id", "journal-1"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          journal: {
            id: "journal-1",
            name: "Handbook",
            folder: null,
            sort: 0,
            categories: [{ id: "cat-1", name: "Lore" }],
            pages: [
              {
                id: "page-img",
                name: "Map",
                type: "image",
                src: "worlds/world-1/maps/level-2.webp",
                image: { caption: longCaption },
                category: "cat-1"
              },
              {
                id: "page-empty-img",
                name: "Blank",
                type: "image",
                src: null,
                image: {}
              },
              {
                id: "page-md",
                name: "Rules",
                type: "text",
                text: { format: 2, content: "# Heading" },
                title: { show: false, level: 3 }
              },
              {
                id: "page-html",
                name: "Notes",
                type: "text",
                text: { format: 1, content: "<p>Hi</p>" }
              }
            ]
          }
        }
      }))
    );

    expect(result.error).toBeNull();

    expect(result.stdout).toContain("categories: 1");
    expect(result.stdout).toContain("category: cat-1\tLore");

    expect(result.stdout).toContain(`page 1 caption: ${"x".repeat(60)}…`);
    expect(result.stdout).not.toContain("x".repeat(61));

    expect(result.stdout).toContain("page 2 caption: (none)");

    expect(result.stdout).toContain("page 1 category: cat-1");

    expect(result.stdout).toContain("page 3 format: markdown");
    expect(result.stdout).toContain("page 3 title: show=false level=3");

    expect(result.stdout).toContain("page 4 format: html");
  });

  it("marks a BLANK category name in journal.get's categories[] the same way the category reads do", async () => {
    const result = await runCommand(
      ["journal", "get", "--journal-id", "journal-1"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          journal: {
            id: "journal-1",
            name: "Handbook",
            folder: null,
            sort: 0,
            categories: [
              { id: "cat-blank", name: "", sort: 0 },
              { id: "cat-1", name: "Lore", sort: 100 }
            ],
            pages: []
          }
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("categories: 2");
    expect(result.stdout).toContain("category: cat-blank\t(blank)");
    expect(result.stdout).toContain("category: cat-1\tLore");
  });

  it("renders actor item output in human-readable mode", async () => {
    const result = await runCommand(
      ["actor", "item", "create", "--actor-id", "actor-1", "--name", "Torch", "--type", "loot"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          actorId: "actor-1",
          item: {
            id: "actor-item-1",
            name: "Torch",
            type: "loot",
            img: "icons/svg/torch.svg",
            folder: null,
            sort: 0,
            system: {
              quantity: 1
            }
          }
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("actor: actor-1");
    expect(result.stdout).toContain("name: Torch");
    expect(result.stdout).toContain('"quantity": 1');
  });

  it("renders actor effect detail output with transfer and origin surfaced", async () => {
    const result = await runCommand(
      ["actor", "effect", "get", "--actor-id", "actor-1", "--effect-id", "eff-1"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          actorId: "actor-1",
          effect: {
            id: "eff-1",
            name: "Aura of Protection",
            type: "auraeffects.aura",
            img: "aura.webp",
            origin: "Item.def",
            disabled: false,
            transfer: true,
            duration: { rounds: 10 },
            changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "2" }],
            statuses: [],
            system: { radius: 5 },
            flags: {}
          }
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("actor: actor-1");
    expect(result.stdout).toContain("name: Aura of Protection");
    expect(result.stdout).toContain("transfer: true");
    expect(result.stdout).toContain("origin: Item.def");
  });

  it("renders applied effect output with provenance", async () => {
    const result = await runCommand(
      ["actor", "effect", "applied", "--actor-id", "actor-1"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          actorId: "actor-1",
          effects: [
            {
              id: "eff-1",
              name: "Bless",
              disabled: false,
              transfer: true,
              statuses: [],
              changeCount: 3,
              active: true,
              parentType: "Actor",
              parentId: "actor-1",
              sourceName: "Bless (Cleric)"
            }
          ],
          total: 1,
          hasMore: false
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("actor: actor-1");
    expect(result.stdout).toContain("Applied effects (1)");
    expect(result.stdout).toContain("active=true");
    expect(result.stdout).toContain("src=Bless (Cleric)");

    expect(result.stdout).toContain("changes=3");
  });

  it("renders token-item effect detail with the item prefix and linked-token warning", async () => {
    const result = await runCommand(
      [
        "scene",
        "token",
        "item",
        "effect",
        "get",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-linked",
        "--item-id",
        "actor-item-1",
        "--effect-id",
        "eff-1"
      ],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          sceneId: "scene-1",
          tokenId: "token-linked",
          itemId: "actor-item-1",
          actorLink: true,
          mutatesWorldActor: true,
          effect: { id: "eff-1", name: "Flaming", transfer: true, origin: "Item.def" }
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("scene: scene-1");
    expect(result.stdout).toContain("token: token-linked");
    expect(result.stdout).toContain("item: actor-item-1");
    expect(result.stdout).toContain("name: Flaming");
    expect(result.stdout).toContain("WARNING: this token is linked");
  });

  it("prints the non-durable warning when a token-item effect write carries nonDurable/warning", async () => {
    const warning =
      "Item-parented ActiveEffects on an unlinked token are NOT durable: they are dropped by any later mutation of the shared world actor (a Foundry ActorDelta limitation) — use scene.token.effect.* for durable token-local effects, or a linked token.";
    const result = await runCommand(
      [
        "scene",
        "token",
        "item",
        "effect",
        "clone",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-a",
        "--item-id",
        "delta-item-1",
        "--effect-id",
        "eff-1"
      ],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          sceneId: "scene-1",
          tokenId: "token-a",
          itemId: "delta-item-1",
          actorLink: false,
          mutatesWorldActor: false,
          nonDurable: true,
          warning,
          effect: { id: "eff-2", name: "Flaming 2" }
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain(`WARNING (not durable): ${warning}`);

    expect(result.stdout).not.toContain("WARNING: this token is linked");
  });

  it("omits the non-durable warning when a token-item effect write is durable (linked token)", async () => {
    const result = await runCommand(
      [
        "scene",
        "token",
        "item",
        "effect",
        "clone",
        "--scene-id",
        "scene-1",
        "--token-id",
        "token-linked",
        "--item-id",
        "actor-item-1",
        "--effect-id",
        "eff-1"
      ],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          sceneId: "scene-1",
          tokenId: "token-linked",
          itemId: "actor-item-1",
          actorLink: true,
          mutatesWorldActor: true,
          nonDurable: false,
          effect: { id: "eff-2", name: "Flaming 2" }
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).not.toContain("WARNING (not durable)");

    expect(result.stdout).toContain("WARNING: this token is linked");
  });

  it("renders file read output in human-readable mode", async () => {
    const result = await runCommand(
      ["file", "read", "--path", "worlds/world-1/readme.txt", "--encoding", "text"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          file: {
            path: "worlds/world-1/readme.txt"
          },
          encoding: "text",
          content: "hello from file"
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("path: worlds/world-1/readme.txt");
    expect(result.stdout).toContain("encoding: text");
    expect(result.stdout).toContain("hello from file");
  });

  it("renders raw JSON when --json is set", async () => {
    const result = await runCommand(
      ["--json", "scene", "get", "--scene-id", "scene-1"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {
          scene: {
            id: "scene-1",
            name: "Dungeon"
          }
        }
      }))
    );

    expect(result.error).toBeNull();
    expect(JSON.parse(result.stdout)).toEqual({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {
        scene: {
          id: "scene-1",
          name: "Dungeon"
        }
      }
    });
  });

  it("prints protocol errors to stderr and exits non-zero in human mode", async () => {
    const result = await runCommand(
      ["scene", "get", "--scene-id", "missing"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: false,
        error: {
          code: "SCENE_NOT_FOUND",
          message: "Scene missing was not found",
          details: {
            sceneId: "missing"
          }
        }
      }))
    );

    expect(result.error).toBeInstanceOf(CommanderError);
    expect((result.error as CommanderError).exitCode).toBe(1);
    expect(result.stderr).toContain("SCENE_NOT_FOUND: Scene missing was not found");
    expect(result.stderr).toContain('"sceneId": "missing"');
  });

  it("fails before sending file.upload when the local file cannot be read", async () => {
    const sendCommand = vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: true,
      result: {}
    }));

    const result = await runCommand(
      [
        "file",
        "upload",
        "--path",
        "worlds/world-1/assets/missing.txt",
        "--from-file",
        "/tmp/fvtt-world-cli-does-not-exist.txt"
      ],
      sendCommand
    );

    expect(result.error).toBeInstanceOf(CommanderError);
    expect((result.error as CommanderError).message).toContain(
      "Failed to read local file /tmp/fvtt-world-cli-does-not-exist.txt"
    );
    expect(sendCommand).not.toHaveBeenCalled();

    expect(planCliErrorOutput(result.error, false).exitCode).toBe(1);
    const envelope = JSON.parse(planCliErrorOutput(result.error, true).stdout ?? "");
    expect(envelope.error.code).toBe("LOCAL_FILE_ERROR");
  });

  it("prints JSON errors in --json mode and exits non-zero", async () => {
    const result = await runCommand(
      ["--json", "item", "update", "--item-id", "item-1", "--name", "Renamed"],
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: false,
        error: {
          code: "INVALID_PARAMS",
          message: "Invalid params for item.update",
          details: {
            errors: ["$.params.patch.name must be a string"]
          }
        }
      }))
    );

    expect(result.error).toBeInstanceOf(CommanderError);
    expect(JSON.parse(result.stdout)).toEqual({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-1",
      ok: false,
      error: {
        code: "INVALID_PARAMS",
        message: "Invalid params for item.update",
        details: {
          errors: ["$.params.patch.name must be a string"]
        }
      }
    });
  });

  it("emits a structured envelope on stdout when the daemon is unreachable in --json mode", async () => {
    const result = await runCommand(
      ["--json", "system", "ping"],
      vi.fn(async () => {
        throw new DaemonTransportError("DAEMON_UNAVAILABLE", "connect ECONNREFUSED 127.0.0.1:47833", {
          reason: "connect_error"
        });
      }) as unknown as Parameters<typeof runCommand>[1]
    );

    expect(result.error).toBeInstanceOf(CommanderError);

    expect((result.error as CommanderError).exitCode).toBe(3);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("DAEMON_UNAVAILABLE");
    expect(envelope.error.details).toEqual({ reason: "connect_error" });
    expect(result.stderr).toBe("");
  });

  it("renders a transport failure to stderr with its code in human mode and leaves stdout empty", async () => {
    const result = await runCommand(
      ["system", "ping"],
      vi.fn(async () => {
        throw new DaemonTransportError(
          "DAEMON_UNAVAILABLE",
          "Timed out waiting for daemon response to system.ping",
          { reason: "timeout" }
        );
      }) as unknown as Parameters<typeof runCommand>[1]
    );

    expect(result.error).toBeInstanceOf(CommanderError);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "DAEMON_UNAVAILABLE: Timed out waiting for daemon response to system.ping"
    );
  });

  it("normalizes a raw connect_error and suppresses its details in human mode", async () => {
    const result = await runCommand(
      ["system", "ping"],
      vi.fn(async () => {
        throw new DaemonTransportError("DAEMON_UNAVAILABLE", "connect ECONNREFUSED 127.0.0.1:30000", {
          reason: "connect_error"
        });
      }) as unknown as Parameters<typeof runCommand>[1]
    );

    expect(result.error).toBeInstanceOf(CommanderError);
    expect(result.stdout).toBe("");

    expect(result.stderr).toContain(
      "DAEMON_UNAVAILABLE: Could not connect to the daemon (connection refused). Is `fvtt-world-cli bridge serve` running?"
    );

    expect(result.stderr).not.toContain("ECONNREFUSED");

    expect(result.stderr).not.toContain("connect_error");
    expect(result.stderr).not.toContain('"reason"');
  });

  describe("input-handling correctness", () => {
    it.each([
      [["item", "update", "--item-id", "item-1", "--clear-folder", "--folder", "f1"]],
      [["item", "create", "--name", "X", "--type", "loot", "--clear-folder", "--folder", "f1"]],
      [["journal", "update", "--journal-id", "j1", "--clear-folder", "--folder", "f1"]],
      [["actor", "update", "--actor-id", "a1", "--clear-folder", "--folder", "f1"]],
      [
        [
          "actor",
          "import-from-compendium",
          "--pack",
          "p",
          "--entry-id",
          "e",
          "--clear-folder",
          "--folder",
          "f1"
        ]
      ]
    ])("rejects --clear-folder with --folder for %j", async (argv) => {
      const sendCommand = vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {}
      }));

      const result = await runCommand(argv, sendCommand as unknown as Parameters<typeof runCommand>[1]);

      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).code).toBe("commander.conflictingOption");
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it.each([
      [["scene", "token", "create", "--scene-id", "s1", "--linked", "--unlinked"]],
      [["scene", "token", "update", "--scene-id", "s1", "--token-id", "t1", "--linked", "--unlinked"]],
      [["scene", "token", "clone", "--scene-id", "s1", "--token-id", "t1", "--linked", "--unlinked"]]
    ])("rejects --linked with --unlinked for %j", async (argv) => {
      const sendCommand = vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {}
      }));

      const result = await runCommand(argv, sendCommand as unknown as Parameters<typeof runCommand>[1]);

      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).code).toBe("commander.conflictingOption");
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it.each([
      [["actor", "get-many", "--ids", ""]],
      [["item", "get-many", "--ids", " , "]],
      [["journal", "get-many", "--ids", ""]],
      [["scene", "get-many", "--ids", ","]]
    ])("rejects an empty --ids list for %j", async (argv) => {
      const sendCommand = failIfCalledSendCommand();

      const result = await runCommand(argv, sendCommand);

      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).code).toBe("commander.invalidArgument");
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it("renders an INVALID_ARGUMENT envelope for a conflicting flag pair in --json mode", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(
        [
          "node",
          "fvtt-world-cli",
          "--json",
          "item",
          "update",
          "--item-id",
          "item-1",
          "--clear-folder",
          "--folder",
          "f1"
        ],
        { stdout, stderr, sendCommand: failIfCalledSendCommand() }
      );

      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stdout.read());
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("INVALID_ARGUMENT");
      expect(stderr.read()).toBe("");
    });

    it("accepts a legitimate zero for a numeric flag (--sort 0)", async () => {
      const sendCommand = vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {}
      }));

      const result = await runCommand(
        ["item", "create", "--name", "X", "--type", "loot", "--sort", "0"],
        sendCommand
      );

      expect(result.error).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "item.create",
          params: { data: { name: "X", type: "loot", sort: 0 } }
        })
      );
    });

    it("accepts negative and float values where the option allows them", async () => {
      const sendCommand = vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {}
      }));

      const result = await runCommand(
        ["scene", "tile", "update", "--scene-id", "s1", "--tile-id", "t1", "--x", "-5", "--elevation", "1.5"],
        sendCommand
      );

      expect(result.error).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "scene.tile.update",
          params: { sceneId: "s1", tileId: "t1", patch: { x: -5, elevation: 1.5 } }
        })
      );
    });

    it("accepts leading-dot and trailing-dot decimal forms (.5 / 5.)", async () => {
      const sendCommand = vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {}
      }));

      const result = await runCommand(
        ["scene", "tile", "update", "--scene-id", "s1", "--tile-id", "t1", "--elevation", ".5", "--x", "5."],
        sendCommand
      );

      expect(result.error).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "scene.tile.update",
          params: { sceneId: "s1", tileId: "t1", patch: { elevation: 0.5, x: 5 } }
        })
      );
    });

    it.each(["", " ", "0x10", "1e3", "abc", ".", "-.", "1.2.3"])(
      "rejects the non-decimal numeric value %p",
      async (badValue) => {
        const sendCommand = vi.fn(async () => ({
          protocolVersion: "1.0",
          type: "command.response",
          id: "req-1",
          ok: true,
          result: {}
        }));

        const result = await runCommand(
          ["item", "create", "--name", "X", "--type", "loot", "--sort", badValue],
          sendCommand as unknown as Parameters<typeof runCommand>[1]
        );

        expect(result.error).toBeInstanceOf(CommanderError);
        expect((result.error as CommanderError).code).toBe("commander.invalidArgument");
        expect(sendCommand).not.toHaveBeenCalled();
      }
    );

    it.each([
      [["item", "update", "--item-id", "item-1"]],
      [["journal", "update", "--journal-id", "j1"]],
      [["actor", "update", "--actor-id", "a1"]],
      [["scene", "update", "--scene-id", "s1"]],
      [["scene", "token", "update", "--scene-id", "s1", "--token-id", "t1"]],
      [["scene", "tile", "update", "--scene-id", "s1", "--tile-id", "t1"]],
      [["scene", "sound", "update", "--scene-id", "s1", "--sound-id", "snd1"]],
      [["actor", "item", "update", "--actor-id", "a1", "--item-id", "i1"]],
      [["journal", "category", "update", "--journal-id", "j1", "--category-id", "c1"]]
    ])("rejects an empty update for %j with a clear local error", async (argv) => {
      const sendCommand = vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {}
      }));

      const result = await runCommand(argv, sendCommand as unknown as Parameters<typeof runCommand>[1]);

      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).message).toContain("No fields to update");
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it("renders an INVALID_ARGUMENT envelope for an empty update in --json mode", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(
        ["node", "fvtt-world-cli", "--json", "item", "update", "--item-id", "item-1"],
        { stdout, stderr, sendCommand: failIfCalledSendCommand() }
      );

      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stdout.read());
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("INVALID_ARGUMENT");
      expect(envelope.error.message).toContain("No fields to update");
      expect(stderr.read()).toBe("");
    });

    it.each([
      [
        ["journal", "category", "update", "--journal-id", "j1", "--category-id", "c1", "--sort", "1.5"],
        "journal.category.update",
        { journalId: "j1", categoryId: "c1", patch: { sort: 1.5 } }
      ],
      [
        ["journal", "category", "create", "--journal-id", "j1", "--name", "X", "--sort", "2.7"],
        "journal.category.create",
        { journalId: "j1", data: { name: "X", sort: 2.7 } }
      ]
    ])(
      "passes a FLOAT --sort through UNROUNDED for %j so the schema can reject it",
      async (argv, command, params) => {
        const sendCommand = vi.fn(async () => ({
          protocolVersion: "1.0",
          type: "command.response",
          id: "req-1",
          ok: true,
          result: {}
        }));

        await runCommand(argv as string[], sendCommand);

        expect(sendCommand).toHaveBeenCalledWith(expect.objectContaining({ command, params }));
      }
    );

    it("does NOT reject a clone with no overrides (clone omits an empty patch)", async () => {
      const sendCommand = vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {}
      }));

      const result = await runCommand(["item", "clone", "--item-id", "item-1"], sendCommand);

      expect(result.error).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ command: "item.clone", params: { itemId: "item-1" } })
      );
    });

    it.each([
      [["item", "update", "--item-id", "i1", "--patch-json", '{"flags":{"m":{"a":1}}}'], "item.update"],
      [["actor", "update", "--actor-id", "a1", "--patch-json", '{"flags":{"m":{"a":1}}}'], "actor.update"],
      [
        ["journal", "update", "--journal-id", "j1", "--patch-json", '{"flags":{"m":{"a":1}}}'],
        "journal.update"
      ],
      [["scene", "update", "--scene-id", "s1", "--patch-json", '{"flags":{"m":{"a":1}}}'], "scene.update"]
    ])("accepts %j (a non-empty --patch-json satisfies the empty-update guard)", async (argv, command) => {
      const sendCommand = vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {}
      }));

      const result = await runCommand(
        argv as string[],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );

      expect(result.error).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith(expect.objectContaining({ command }));
    });

    it.each([
      [["item", "update", "--item-id", "i1", "--patch-json", "{}"]],
      [["actor", "update", "--actor-id", "a1", "--patch-json", "{}"]],
      [["journal", "update", "--journal-id", "j1", "--patch-json", "{}"]],
      [["scene", "update", "--scene-id", "s1", "--patch-json", "{}"]]
    ])("rejects %j (empty --patch-json behaves like an empty update)", async (argv) => {
      const result = await runCommand(argv, failIfCalledSendCommand());

      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).message).toContain("No fields to update");
    });

    it.each(["0", "-1", "1.5", "abc"])("rejects bridge serve --request-timeout-ms %p", async (badValue) => {
      const result = await runCommandWithBaseArgs(
        ["node", "fvtt-world-cli", "bridge", "serve", "--request-timeout-ms", badValue],
        undefined,
        { configStore: createInMemoryConfigStore(null) }
      );

      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).code).toBe("commander.invalidArgument");
    });

    it("accepts a positive --request-timeout-ms for bridge serve", async () => {
      const configStore = createInMemoryConfigStore(null);
      const daemon = {
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        getConnectionInfo: vi.fn(() => ({
          daemonUrl: "ws://127.0.0.1:47833",
          bridge: { connected: false, session: null }
        }))
      };
      const createBridgeDaemon = vi.fn(() => daemon);

      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();
      const program = createProgram({
        stdout,
        stderr,
        configStore,
        createBridgeDaemon: createBridgeDaemon as unknown as NonNullable<
          Parameters<typeof createProgram>[0]
        >["createBridgeDaemon"]
      });

      const parsePromise = program.parseAsync(
        ["node", "fvtt-world-cli", "bridge", "serve", "--request-timeout-ms", "5000"],
        { from: "node" }
      );

      await new Promise<void>((resolve) => {
        setImmediate(() => {
          process.emit("SIGTERM", "SIGTERM");
          resolve();
        });
      });

      await parsePromise;

      expect(createBridgeDaemon).toHaveBeenCalledWith(expect.objectContaining({ requestTimeoutMs: 5000 }));
    });
  });

  it("creates a device credential automatically and never prints it from config get", async () => {
    const configStore = createInMemoryConfigStore(null);
    const result = await runCommandWithBaseArgs(["node", "fvtt-world-cli", "config", "get"], undefined, {
      configStore
    });
    expect(result.error).toBeNull();
    const config = configStore.readConfig();
    expect(config?.deviceCredential).toHaveLength(43);
    expect(result.stdout).toContain("Pairings: 0");
    expect(result.stdout).not.toContain(config?.deviceCredential);
  });

  it("renders the persisted uploadLimitBytes in human-readable config get output", async () => {
    const result = await runCommandWithBaseArgs(["node", "fvtt-world-cli", "config", "get"], undefined, {
      configStore: createInMemoryConfigStore({
        daemonUrl: "ws://127.0.0.1:49001",
        ...createEmptyConfig(),
        uploadLimitBytes: 200 * 1024 * 1024
      })
    });

    expect(result.error).toBeNull();
    expect(result.stdout).toContain(`Upload limit: ${200 * 1024 * 1024} bytes`);
    expect(result.stdout).not.toContain("(default)");
  });

  it("delegates bound connection persistence to the daemon when bridge serve starts", async () => {
    const configStore = createInMemoryConfigStore(null);
    const daemon = {
      start: vi.fn(async () => {
        configStore.writeConfig({ ...configStore.readConfig(), daemonUrl: "ws://127.0.0.1:49005" });
      }),
      stop: vi.fn(async () => {}),
      getConnectionInfo: vi.fn(() => ({
        daemonUrl: "ws://127.0.0.1:49005",
        bridge: {
          connected: false,
          session: null
        }
      }))
    };
    const createBridgeDaemon = vi.fn(() => daemon);

    const emptyHome = mkdtempSync(join(tmpdir(), "fvtt-home-"));
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();
    const program = createProgram({
      stdout,
      stderr,
      configStore,
      env: { ...process.env, HOME: emptyHome },
      createBridgeDaemon: createBridgeDaemon as unknown as NonNullable<
        Parameters<typeof createProgram>[0]
      >["createBridgeDaemon"]
    });

    const parsePromise = program.parseAsync(["node", "fvtt-world-cli", "bridge", "serve"], {
      from: "node"
    });

    await new Promise<void>((resolve) => {
      setImmediate(() => {
        process.emit("SIGTERM", "SIGTERM");
        resolve();
      });
    });

    await parsePromise;

    expect(createBridgeDaemon).toHaveBeenCalledWith(
      expect.objectContaining({ daemonUrl: "ws://127.0.0.1:47833", configStore })
    );
    expect(configStore.readConfig()?.daemonUrl).toBe("ws://127.0.0.1:49005");
    expect(stdout.read()).not.toContain("token");
    expect(stderr.read()).toContain("skill install");
    expect(stderr.read()).not.toContain("token");
    expect(daemon.stop).toHaveBeenCalledTimes(1);
    rmSync(emptyHome, { recursive: true, force: true });
  });

  it("rejects the removed bridge serve --token flag", async () => {
    const result = await runCommandWithBaseArgs([
      "node",
      "fvtt-world-cli",
      "bridge",
      "serve",
      "--token",
      "old"
    ]);
    expect(result.error).toBeInstanceOf(CommanderError);
  });

  describe("--data-json/--patch-json: closed-schema invariant preserved", () => {
    it.each([
      [["item", "create", "--name", "X", "--type", "loot", "--data-json", '{"bogus":1}']],
      [["item", "update", "--item-id", "i1", "--patch-json", '{"bogus":1}']],
      [["actor", "create", "--name", "X", "--type", "npc", "--data-json", '{"bogus":1}']],
      [["actor", "update", "--actor-id", "a1", "--patch-json", '{"bogus":1}']],
      [["journal", "create", "--name", "X", "--data-json", '{"bogus":1}']],
      [["journal", "update", "--journal-id", "j1", "--patch-json", '{"bogus":1}']],
      [["scene", "create", "--name", "X", "--data-json", '{"bogus":1}']],
      [["scene", "update", "--scene-id", "s1", "--patch-json", '{"bogus":1}']]
    ])("rejects an unknown top-level key for %j as INVALID_PARAMS", async (argv) => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(["node", "fvtt-world-cli", "--json", ...argv], {
        stdout,
        stderr,
        sendCommand: realSendCommand,
        configStore: createInMemoryConfigStore(createDefaultTestConfig())
      });

      expect(exitCode).toBe(1);
      const envelope = JSON.parse(stdout.read());
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("INVALID_PARAMS");
    });
  });
});
