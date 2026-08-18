import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CommanderError } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { executeCli } from "../src/index.js";
import {
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
  describe("list pagination flags + footer", () => {
    const okEmpty = () =>
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {}
      }));

    it.each([
      [["item", "list", "--limit", "2", "--offset", "4"], "item.list", { limit: 2, offset: 4 }],
      [["journal", "list", "--limit", "3"], "journal.list", { limit: 3 }],
      [["actor", "list", "--offset", "0"], "actor.list", { offset: 0 }],
      [["scene", "list"], "scene.list", {}],
      [
        ["scene", "token", "list", "--scene-id", "s1", "--limit", "5"],
        "scene.token.list",
        { sceneId: "s1", limit: 5 }
      ],
      [
        ["scene", "token", "item", "list", "--scene-id", "s1", "--token-id", "t1", "--offset", "2"],
        "scene.token.item.list",
        { sceneId: "s1", tokenId: "t1", offset: 2 }
      ],
      [
        ["actor", "item", "list", "--actor-id", "a1", "--limit", "1", "--offset", "1"],
        "actor.item.list",
        { actorId: "a1", limit: 1, offset: 1 }
      ],
      [
        ["compendium", "index", "--pack", "dnd5e.monsters", "--limit", "10"],
        "compendium.index",
        { pack: "dnd5e.monsters", limit: 10 }
      ],
      [["folder", "list", "--type", "Actor", "--limit", "2"], "folder.list", { type: "Actor", limit: 2 }],
      [["file", "list", "--limit", "1"], "file.list", { path: "", limit: 1 }]
    ])("threads pagination flags from %j into %s params", async (argv, expectedCommand, expectedParams) => {
      const sendCommand = okEmpty();

      const result = await runCommand(argv as string[], sendCommand);

      expect(result.error).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith({
        daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL,
        deviceCredential: expect.any(String),
        command: expectedCommand,
        params: expectedParams
      });
    });

    it("renders a 'showing X of Y' footer with a next-page hint when more remain", async () => {
      const result = await runCommand(
        ["item", "list", "--limit", "2", "--offset", "0"],
        vi.fn(async () => ({
          protocolVersion: "1.0",
          type: "command.response",
          id: "req-1",
          ok: true,
          result: {
            items: [
              { id: "item-1", name: "A", type: "weapon", img: null, folder: null, sort: 0 },
              { id: "item-2", name: "B", type: "weapon", img: null, folder: null, sort: 0 }
            ],
            total: 5,
            hasMore: true
          }
        })) as unknown as Parameters<typeof runCommand>[1]
      );

      expect(result.error).toBeNull();
      expect(result.stdout).toContain("showing 2 of 5");
      expect(result.stdout).toContain("(more: use --offset 2)");
    });

    it("renders the footer without a hint on the last page and offsets the hint by the request offset", async () => {
      const result = await runCommand(
        ["item", "list", "--limit", "2", "--offset", "2"],
        vi.fn(async () => ({
          protocolVersion: "1.0",
          type: "command.response",
          id: "req-1",
          ok: true,
          result: {
            items: [{ id: "item-3", name: "C", type: "weapon", img: null, folder: null, sort: 0 }],
            total: 3,
            hasMore: false
          }
        })) as unknown as Parameters<typeof runCommand>[1]
      );

      expect(result.error).toBeNull();
      expect(result.stdout).toContain("showing 1 of 3");
      expect(result.stdout).not.toContain("more: use --offset");
    });

    it("renders the footer on an empty page result", async () => {
      const result = await runCommand(
        ["item", "list", "--offset", "99"],
        vi.fn(async () => ({
          protocolVersion: "1.0",
          type: "command.response",
          id: "req-1",
          ok: true,
          result: { items: [], total: 5, hasMore: false }
        })) as unknown as Parameters<typeof runCommand>[1]
      );

      expect(result.error).toBeNull();
      expect(result.stdout).toContain("No items found.");
      expect(result.stdout).toContain("showing 0 of 5");
    });

    it.each([
      [["item", "list", "--limit", "0"]],
      [["item", "list", "--limit", "-1"]],
      [["item", "list", "--limit", "2.5"]],
      [["item", "list", "--offset", "-1"]],
      [["actor", "list", "--offset", "1.5"]],
      [["scene", "token", "list", "--scene-id", "s1", "--limit", "0"]]
    ])("rejects %j with a local INVALID_ARGUMENT before any daemon call", async (argv) => {
      const sendCommand = failIfCalledSendCommand();

      const result = await runCommand(argv as string[], sendCommand);

      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).code).toBe("commander.invalidArgument");
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it("maps a negative --limit to an INVALID_ARGUMENT envelope under --json", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(
        ["node", "fvtt-world-cli", "--json", "item", "list", "--limit", "-1"],
        { stdout, stderr, sendCommand: failIfCalledSendCommand() }
      );

      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stdout.read());
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("INVALID_ARGUMENT");
      expect(stderr.read()).toBe("");
    });
  });

  describe("list name filter flag", () => {
    const okEmpty = () =>
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {}
      }));

    it.each([
      [["scene", "list", "--name", "dungeon"], "scene.list", { name: "dungeon" }],
      [["item", "list", "--name", "sword"], "item.list", { name: "sword" }],
      [["journal", "list", "--name", "notes"], "journal.list", { name: "notes" }],
      [["actor", "list", "--name", "shadow"], "actor.list", { name: "shadow" }],
      [
        ["scene", "token", "list", "--scene-id", "s1", "--name", "valeros"],
        "scene.token.list",
        { sceneId: "s1", name: "valeros" }
      ],
      [
        ["scene", "token", "item", "list", "--scene-id", "s1", "--token-id", "t1", "--name", "dagger"],
        "scene.token.item.list",
        { sceneId: "s1", tokenId: "t1", name: "dagger" }
      ],
      [
        ["actor", "item", "list", "--actor-id", "a1", "--name", "shield"],
        "actor.item.list",
        { actorId: "a1", name: "shield" }
      ],
      [
        ["compendium", "index", "--pack", "dnd5e.monsters", "--name", "dragon"],
        "compendium.index",
        { pack: "dnd5e.monsters", name: "dragon" }
      ],
      [["folder", "list", "--name", "monsters"], "folder.list", { name: "monsters" }]
    ])("threads the --name filter from %j into %s params", async (argv, expectedCommand, expectedParams) => {
      const sendCommand = okEmpty();

      const result = await runCommand(argv as string[], sendCommand);

      expect(result.error).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith({
        daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL,
        deviceCredential: expect.any(String),
        command: expectedCommand,
        params: expectedParams
      });
    });

    it("composes --name with --type (folder.list) and pagination flags", async () => {
      const sendCommand = okEmpty();

      const result = await runCommand(
        ["folder", "list", "--name", "test", "--type", "Actor", "--limit", "2", "--offset", "1"],
        sendCommand
      );

      expect(result.error).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith({
        daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL,
        deviceCredential: expect.any(String),
        command: "folder.list",
        params: { name: "test", type: "Actor", limit: 2, offset: 1 }
      });
    });

    it("omits the name key entirely when --name is not supplied (backward-compatible)", async () => {
      const sendCommand = okEmpty();

      const result = await runCommand(["item", "list"], sendCommand);

      expect(result.error).toBeNull();

      expect(sendCommand).toHaveBeenCalledWith({
        daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL,
        deviceCredential: expect.any(String),
        command: "item.list",
        params: {}
      });
    });
  });

  describe("--include flags opt-in on detailed reads", () => {
    const okEmpty = () =>
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {}
      }));

    it.each([
      [
        ["item", "get", "--item-id", "item-1", "--include", "flags"],
        "item.get",
        { itemId: "item-1", include: ["flags"] }
      ],
      [
        ["actor", "get", "--actor-id", "actor-1", "--include", "flags"],
        "actor.get",
        { actorId: "actor-1", include: ["flags"] }
      ],
      [
        ["actor", "item", "get", "--actor-id", "actor-1", "--item-id", "item-1", "--include", "flags"],
        "actor.item.get",
        { actorId: "actor-1", itemId: "item-1", include: ["flags"] }
      ],
      [
        ["item", "get", "--item-id", "item-1", "--include", "effects"],
        "item.get",
        { itemId: "item-1", include: ["effects"] }
      ],
      [
        ["actor", "get", "--actor-id", "actor-1", "--include", "flags,effects"],
        "actor.get",
        { actorId: "actor-1", include: ["flags", "effects"] }
      ],
      [
        ["actor", "item", "list", "--actor-id", "actor-1", "--include", "flags"],
        "actor.item.list",
        { actorId: "actor-1", include: ["flags"] }
      ],
      [
        ["actor", "item", "list", "--actor-id", "actor-1", "--include", "effects"],
        "actor.item.list",
        { actorId: "actor-1", include: ["effects"] }
      ],

      [
        ["actor", "get", "--actor-id", "actor-1", "--include", "items.flags,items.effects"],
        "actor.get",
        { actorId: "actor-1", include: ["items.flags", "items.effects"] }
      ],
      [
        ["actor", "get", "--actor-id", "actor-1", "--include", "flags,items.flags,items.effects"],
        "actor.get",
        { actorId: "actor-1", include: ["flags", "items.flags", "items.effects"] }
      ],

      [
        ["actor", "get", "--actor-id", "actor-1", "--include", "prepared"],
        "actor.get",
        { actorId: "actor-1", include: ["prepared"] }
      ],
      [
        ["scene", "token", "get", "--scene-id", "scene-1", "--token-id", "token-1", "--include", "prepared"],
        "scene.token.get",
        { sceneId: "scene-1", tokenId: "token-1", include: ["prepared"] }
      ],

      [
        ["item", "create", "--name", "Torch", "--type", "loot", "--include", "flags"],
        "item.create",
        { data: { name: "Torch", type: "loot" }, include: ["flags"] }
      ],
      [
        ["item", "update", "--item-id", "item-1", "--name", "Renamed", "--include", "flags,effects"],
        "item.update",
        { itemId: "item-1", patch: { name: "Renamed" }, include: ["flags", "effects"] }
      ],
      [
        ["actor", "create", "--name", "Goblin", "--type", "npc", "--include", "effects"],
        "actor.create",
        { data: { name: "Goblin", type: "npc" }, include: ["effects"] }
      ],
      [
        ["actor", "update", "--actor-id", "actor-1", "--name", "Renamed", "--include", "flags"],
        "actor.update",
        { actorId: "actor-1", patch: { name: "Renamed" }, include: ["flags"] }
      ],

      [
        [
          "actor",
          "item",
          "create",
          "--actor-id",
          "actor-1",
          "--name",
          "Torch",
          "--type",
          "loot",
          "--include",
          "flags"
        ],
        "actor.item.create",
        { actorId: "actor-1", data: { name: "Torch", type: "loot" }, include: ["flags"] }
      ],
      [
        [
          "actor",
          "item",
          "update",
          "--actor-id",
          "actor-1",
          "--item-id",
          "item-1",
          "--name",
          "Renamed",
          "--include",
          "effects"
        ],
        "actor.item.update",
        { actorId: "actor-1", itemId: "item-1", patch: { name: "Renamed" }, include: ["effects"] }
      ],
      [
        [
          "scene",
          "token",
          "item",
          "create",
          "--scene-id",
          "scene-1",
          "--token-id",
          "token-1",
          "--name",
          "Torch",
          "--type",
          "loot",
          "--include",
          "flags,effects"
        ],
        "scene.token.item.create",
        {
          sceneId: "scene-1",
          tokenId: "token-1",
          data: { name: "Torch", type: "loot" },
          include: ["flags", "effects"]
        }
      ],
      [
        [
          "scene",
          "token",
          "item",
          "update",
          "--scene-id",
          "scene-1",
          "--token-id",
          "token-1",
          "--item-id",
          "item-1",
          "--name",
          "Renamed",
          "--include",
          "flags"
        ],
        "scene.token.item.update",
        {
          sceneId: "scene-1",
          tokenId: "token-1",
          itemId: "item-1",
          patch: { name: "Renamed" },
          include: ["flags"]
        }
      ],

      [
        ["compendium", "get", "--pack", "world.x", "--entry-id", "e-1", "--include", "effects"],
        "compendium.get",
        { pack: "world.x", entryId: "e-1", include: ["effects"] }
      ]
    ])("threads --include flags from %j into %s params", async (argv, expectedCommand, expectedParams) => {
      const sendCommand = okEmpty();

      const result = await runCommand(argv as string[], sendCommand);

      expect(result.error).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith({
        daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL,
        deviceCredential: expect.any(String),
        command: expectedCommand,
        params: expectedParams
      });
    });

    it.each([
      [["item", "get", "--item-id", "item-1"], "item.get", { itemId: "item-1" }],
      [["actor", "get", "--actor-id", "actor-1"], "actor.get", { actorId: "actor-1" }],
      [
        ["scene", "token", "get", "--scene-id", "scene-1", "--token-id", "token-1"],
        "scene.token.get",
        { sceneId: "scene-1", tokenId: "token-1" }
      ],
      [
        ["actor", "item", "get", "--actor-id", "actor-1", "--item-id", "item-1"],
        "actor.item.get",
        { actorId: "actor-1", itemId: "item-1" }
      ],

      [
        ["item", "create", "--name", "Torch", "--type", "loot"],
        "item.create",
        { data: { name: "Torch", type: "loot" } }
      ],
      [
        ["item", "update", "--item-id", "item-1", "--name", "Renamed"],
        "item.update",
        { itemId: "item-1", patch: { name: "Renamed" } }
      ],
      [
        ["actor", "create", "--name", "Goblin", "--type", "npc"],
        "actor.create",
        { data: { name: "Goblin", type: "npc" } }
      ],
      [
        ["actor", "update", "--actor-id", "actor-1", "--name", "Renamed"],
        "actor.update",
        { actorId: "actor-1", patch: { name: "Renamed" } }
      ],
      [
        ["actor", "item", "create", "--actor-id", "actor-1", "--name", "Torch", "--type", "loot"],
        "actor.item.create",
        { actorId: "actor-1", data: { name: "Torch", type: "loot" } }
      ],
      [
        ["actor", "item", "update", "--actor-id", "actor-1", "--item-id", "item-1", "--name", "Renamed"],
        "actor.item.update",
        { actorId: "actor-1", itemId: "item-1", patch: { name: "Renamed" } }
      ],
      [
        [
          "scene",
          "token",
          "item",
          "create",
          "--scene-id",
          "scene-1",
          "--token-id",
          "token-1",
          "--name",
          "Torch",
          "--type",
          "loot"
        ],
        "scene.token.item.create",
        { sceneId: "scene-1", tokenId: "token-1", data: { name: "Torch", type: "loot" } }
      ],
      [
        [
          "scene",
          "token",
          "item",
          "update",
          "--scene-id",
          "scene-1",
          "--token-id",
          "token-1",
          "--item-id",
          "item-1",
          "--name",
          "Renamed"
        ],
        "scene.token.item.update",
        { sceneId: "scene-1", tokenId: "token-1", itemId: "item-1", patch: { name: "Renamed" } }
      ],
      [
        ["compendium", "get", "--pack", "world.x", "--entry-id", "e-1"],
        "compendium.get",
        { pack: "world.x", entryId: "e-1" }
      ]
    ])(
      "omits the include key entirely when --include is not supplied (%s)",
      async (argv, expectedCommand, expectedParams) => {
        const sendCommand = okEmpty();

        const result = await runCommand(argv as string[], sendCommand);

        expect(result.error).toBeNull();
        expect(sendCommand).toHaveBeenCalledWith({
          daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL,
          deviceCredential: expect.any(String),
          command: expectedCommand,
          params: expectedParams
        });
      }
    );

    it.each([
      [["item", "get", "--item-id", "item-1", "--include", "bogus"]],
      [["actor", "get", "--actor-id", "actor-1", "--include", "flags,bogus"]],
      [["actor", "get", "--actor-id", "actor-1", "--include", "items.items.flags"]],
      [["actor", "item", "get", "--actor-id", "actor-1", "--item-id", "item-1", "--include", "system"]],
      [["actor", "item", "list", "--actor-id", "actor-1", "--include", "bogus"]],

      [["item", "get", "--item-id", "item-1", "--include", "items.flags"]],
      [
        ["actor", "item", "get", "--actor-id", "actor-1", "--item-id", "item-1", "--include", "items.effects"]
      ],
      [["actor", "item", "list", "--actor-id", "actor-1", "--include", "items.flags"]],

      [["item", "create", "--name", "Torch", "--type", "loot", "--include", "bogus"]],
      [["item", "update", "--item-id", "item-1", "--name", "Renamed", "--include", "items.flags"]],
      [["actor", "create", "--name", "Goblin", "--type", "npc", "--include", "bogus"]],
      [["actor", "update", "--actor-id", "actor-1", "--name", "Renamed", "--include", "items.effects"]],
      [
        [
          "actor",
          "item",
          "create",
          "--actor-id",
          "actor-1",
          "--name",
          "Torch",
          "--type",
          "loot",
          "--include",
          "bogus"
        ]
      ],
      [
        [
          "actor",
          "item",
          "update",
          "--actor-id",
          "actor-1",
          "--item-id",
          "item-1",
          "--name",
          "Renamed",
          "--include",
          "items.flags"
        ]
      ],
      [
        [
          "scene",
          "token",
          "item",
          "create",
          "--scene-id",
          "scene-1",
          "--token-id",
          "token-1",
          "--name",
          "Torch",
          "--type",
          "loot",
          "--include",
          "bogus"
        ]
      ],
      [
        [
          "scene",
          "token",
          "item",
          "update",
          "--scene-id",
          "scene-1",
          "--token-id",
          "token-1",
          "--item-id",
          "item-1",
          "--name",
          "Renamed",
          "--include",
          "items.effects"
        ]
      ],

      [["scene", "token", "get", "--scene-id", "scene-1", "--token-id", "token-1", "--include", "flags"]],
      [["scene", "token", "get", "--scene-id", "scene-1", "--token-id", "token-1", "--include", "bogus"]],

      [["compendium", "get", "--pack", "world.x", "--entry-id", "e-1", "--include", "flags"]],
      [["compendium", "get", "--pack", "world.x", "--entry-id", "e-1", "--include", "bogus"]]
    ])("rejects %j with a local INVALID_ARGUMENT before any daemon call", async (argv) => {
      const sendCommand = failIfCalledSendCommand();

      const result = await runCommand(argv as string[], sendCommand);

      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).code).toBe("commander.invalidArgument");
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it("renders a flags line in human output only when the returned item carries flags", async () => {
      const withFlags = await runCommand(
        ["item", "get", "--item-id", "item-1", "--include", "flags"],
        vi.fn(async () => ({
          protocolVersion: "1.0",
          type: "command.response",
          id: "req-1",
          ok: true,
          result: {
            item: { id: "item-1", name: "Torch", type: "loot", system: {}, flags: { dae: { macro: "x" } } }
          }
        }))
      );

      expect(withFlags.error).toBeNull();
      expect(withFlags.stdout).toContain("flags:");
      expect(withFlags.stdout).toContain("dae");

      const withoutFlags = await runCommand(
        ["item", "get", "--item-id", "item-1"],
        vi.fn(async () => ({
          protocolVersion: "1.0",
          type: "command.response",
          id: "req-1",
          ok: true,
          result: { item: { id: "item-1", name: "Torch", type: "loot", system: {} } }
        }))
      );

      expect(withoutFlags.error).toBeNull();
      expect(withoutFlags.stdout).not.toContain("flags:");
    });

    it("renders the actor's own flags line only when present, never for the embedded items", async () => {
      const result = await runCommand(
        ["actor", "get", "--actor-id", "actor-1", "--include", "flags"],
        vi.fn(async () => ({
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
              prototypeToken: null,
              flags: { ActiveAuras: { radius: 10 } },
              items: [{ id: "item-1", name: "Shield", type: "armor" }]
            }
          }
        }))
      );

      expect(result.error).toBeNull();
      expect(result.stdout).toContain("flags:");
      expect(result.stdout).toContain("ActiveAuras");
    });

    it("renders an effects line in human output only when the returned item carries effects", async () => {
      const withEffects = await runCommand(
        ["item", "get", "--item-id", "item-1", "--include", "effects"],
        vi.fn(async () => ({
          protocolVersion: "1.0",
          type: "command.response",
          id: "req-1",
          ok: true,
          result: {
            item: {
              id: "item-1",
              name: "Torch",
              type: "loot",
              system: {},
              effects: [{ id: "e1", name: "Burning", changes: [], disabled: false, transfer: true }]
            }
          }
        }))
      );

      expect(withEffects.error).toBeNull();
      expect(withEffects.stdout).toContain("effects:");
      expect(withEffects.stdout).toContain("Burning");

      const withoutEffects = await runCommand(
        ["item", "get", "--item-id", "item-1"],
        vi.fn(async () => ({
          protocolVersion: "1.0",
          type: "command.response",
          id: "req-1",
          ok: true,
          result: { item: { id: "item-1", name: "Torch", type: "loot", system: {} } }
        }))
      );

      expect(withoutEffects.error).toBeNull();
      expect(withoutEffects.stdout).not.toContain("effects:");
    });

    it("renders included flags/effects per row in actor.item.list human output", async () => {
      const withInclude = await runCommand(
        ["actor", "item", "list", "--actor-id", "actor-1", "--include", "flags,effects"],
        vi.fn(async () => ({
          protocolVersion: "1.0",
          type: "command.response",
          id: "req-1",
          ok: true,
          result: {
            actorId: "actor-1",
            items: [
              {
                id: "item-1",
                name: "Torch",
                type: "loot",
                flags: { dae: { stackable: "none" } },
                effects: [{ id: "e1", name: "Burning", changes: [], disabled: false, transfer: true }]
              }
            ],
            total: 1,
            hasMore: false
          }
        }))
      );

      expect(withInclude.error).toBeNull();
      expect(withInclude.stdout).toContain("item-1\tTorch\tloot");
      expect(withInclude.stdout).toContain("flags:");
      expect(withInclude.stdout).toContain("dae");
      expect(withInclude.stdout).toContain("effects:");
      expect(withInclude.stdout).toContain("Burning");

      const withoutInclude = await runCommand(
        ["actor", "item", "list", "--actor-id", "actor-1"],
        vi.fn(async () => ({
          protocolVersion: "1.0",
          type: "command.response",
          id: "req-1",
          ok: true,
          result: {
            actorId: "actor-1",
            items: [{ id: "item-1", name: "Torch", type: "loot" }],
            total: 1,
            hasMore: false
          }
        }))
      );

      expect(withoutInclude.error).toBeNull();
      expect(withoutInclude.stdout).toContain("item-1\tTorch\tloot");
      expect(withoutInclude.stdout).not.toContain("flags:");
      expect(withoutInclude.stdout).not.toContain("effects:");
    });
  });

  describe("dry-run flag", () => {
    const okResult = (result: Record<string, unknown>) =>
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result
      }));

    it("threads dryRun:true into a mutation command's params", async () => {
      const sendCommand = okResult({ item: { id: "item-1", name: "Longsword" }, dryRun: true });

      const result = await runCommand(
        ["--dry-run", "item", "update", "--item-id", "item-1", "--name", "Renamed"],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );

      expect(result.error).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith({
        daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL,
        deviceCredential: expect.any(String),
        command: "item.update",
        params: { itemId: "item-1", patch: { name: "Renamed" }, dryRun: true }
      });
    });

    it("does NOT thread dryRun into a read command (the read schema would reject it)", async () => {
      const sendCommand = okResult({ items: [], total: 0, hasMore: false });

      const result = await runCommand(
        ["--dry-run", "item", "list"],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );

      expect(result.error).toBeNull();

      expect(sendCommand).toHaveBeenCalledWith({
        daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL,
        deviceCredential: expect.any(String),
        command: "item.list",
        params: {}
      });
    });

    it("prefixes human output with the DRY RUN marker when the response is a dry run", async () => {
      const sendCommand = okResult({
        item: { id: "item-1", name: "Longsword", type: "weapon" },
        dryRun: true
      });

      const result = await runCommand(
        ["--dry-run", "item", "update", "--item-id", "item-1", "--name", "Renamed"],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );

      expect(result.error).toBeNull();
      expect(result.stdout.startsWith("DRY RUN (not persisted):\n")).toBe(true);
    });

    it("does NOT prefix output for a normal (non-dry-run) mutation response", async () => {
      const sendCommand = okResult({ item: { id: "item-1", name: "Longsword", type: "weapon" } });

      const result = await runCommand(
        ["item", "update", "--item-id", "item-1", "--name", "Renamed"],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );

      expect(result.error).toBeNull();
      expect(result.stdout.includes("DRY RUN")).toBe(false);
    });

    it("passes the dryRun envelope through unchanged under --json", async () => {
      const sendCommand = okResult({ item: { id: "item-1", name: "Longsword" }, dryRun: true });

      const result = await runCommand(
        ["--json", "--dry-run", "item", "update", "--item-id", "item-1", "--name", "Renamed"],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );

      expect(result.error).toBeNull();
      const parsed = JSON.parse(result.stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.result.dryRun).toBe(true);

      expect(result.stdout.includes("DRY RUN (not persisted):")).toBe(false);
    });
  });

  describe("--idempotency-key flag", () => {
    const okResult = (result: Record<string, unknown>) =>
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result
      }));

    it("threads idempotencyKey into a create command's params when provided", async () => {
      const sendCommand = okResult({ item: { id: "item-1", name: "Sword" } });

      const result = await runCommand(
        ["item", "create", "--name", "Sword", "--type", "weapon", "--idempotency-key", "abc-123"],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );

      expect(result.error).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith({
        daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL,
        deviceCredential: expect.any(String),
        command: "item.create",
        params: { data: { name: "Sword", type: "weapon" }, idempotencyKey: "abc-123" }
      });
    });

    it("threads the key into a clone command (clones are create-like)", async () => {
      const sendCommand = okResult({ item: { id: "item-2", name: "Sword copy" } });

      const result = await runCommand(
        ["item", "clone", "--item-id", "item-1", "--idempotency-key", "clone-key-1"],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );

      expect(result.error).toBeNull();
      const call = (sendCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        command: string;
        params: Record<string, unknown>;
      };
      expect(call.command).toBe("item.clone");
      expect(call.params.idempotencyKey).toBe("clone-key-1");
    });

    it("omits idempotencyKey from params when the flag is absent", async () => {
      const sendCommand = okResult({ item: { id: "item-1", name: "Sword" } });

      const result = await runCommand(
        ["item", "create", "--name", "Sword", "--type", "weapon"],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );

      expect(result.error).toBeNull();
      const call = (sendCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        params: Record<string, unknown>;
      };
      expect(call.params).toEqual({ data: { name: "Sword", type: "weapon" } });
      expect(call.params).not.toHaveProperty("idempotencyKey");
    });

    it("REFUSES a keyless `table draw` locally, before any round-trip (the only required key)", async () => {
      const sendCommand = okResult({});

      const result = await runCommand(
        ["table", "draw", "--table-id", "tbl-1"],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );

      expect(result.error).not.toBeNull();
      expect(sendCommand).not.toHaveBeenCalled();
      expect(result.stderr).toContain("--idempotency-key");

      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();
      const exitCode = await executeCli(
        ["node", "fvtt-world-cli", "--json", "table", "draw", "--table-id", "tbl-1"],
        { stdout, stderr, sendCommand: sendCommand as unknown as SendCommandMock }
      );
      expect(exitCode).toBe(2);
      expect(JSON.parse(stdout.read()).error.code).toBe("MISSING_REQUIRED_OPTION");
    });

    it("still requires the key for a DRY RUN (the validator has no conditional requiredness)", async () => {
      const sendCommand = okResult({ tableId: "tbl-1", dryRun: true });

      const refused = await runCommand(
        ["--dry-run", "table", "draw", "--table-id", "tbl-1"],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );
      expect(refused.error).not.toBeNull();
      expect(sendCommand).not.toHaveBeenCalled();

      const allowed = await runCommand(
        ["--dry-run", "table", "draw", "--table-id", "tbl-1", "--idempotency-key", "preview-1"],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );
      expect(allowed.error).toBeNull();
      const call = (sendCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        params: Record<string, unknown>;
      };
      expect(call.params).toEqual({ tableId: "tbl-1", dryRun: true, idempotencyKey: "preview-1" });
    });

    it("REFUSES a keyless `cards deal|draw|pass` locally, exactly as `table draw` does", async () => {
      for (const argv of [
        ["cards", "deal", "--cards-id", "crd-1", "--to", "crd-2"],
        ["cards", "draw", "--cards-id", "crd-1", "--from", "crd-2"],
        ["cards", "pass", "--cards-id", "crd-1", "--to", "crd-2", "--card-ids", "cd-1"],
        ["--dry-run", "cards", "deal", "--cards-id", "crd-1", "--to", "crd-2"]
      ]) {
        const sendCommand = okResult({});
        const result = await runCommand(argv, sendCommand as unknown as Parameters<typeof runCommand>[1]);
        expect(result.error, argv.join(" ")).not.toBeNull();
        expect(sendCommand, argv.join(" ")).not.toHaveBeenCalled();
        expect(result.stderr, argv.join(" ")).toContain("--idempotency-key");
      }

      const sendCommand = okResult({});
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();
      const exitCode = await executeCli(
        [
          "node",
          "fvtt-world-cli",
          "--json",
          "cards",
          "pass",
          "--cards-id",
          "crd-1",
          "--to",
          "crd-2",
          "--card-ids",
          "cd-1"
        ],
        { stdout, stderr, sendCommand: sendCommand as unknown as SendCommandMock }
      );
      expect(exitCode).toBe(2);
      expect(JSON.parse(stdout.read()).error.code).toBe("MISSING_REQUIRED_OPTION");

      const accepted = okResult({});
      const ok = await runCommand(
        [
          "cards",
          "pass",
          "--cards-id",
          "crd-1",
          "--to",
          "crd-2",
          "--card-ids",
          "cd-1",
          "--idempotency-key",
          "k"
        ],
        accepted as unknown as Parameters<typeof runCommand>[1]
      );
      expect(ok.error).toBeNull();
      const call = (accepted as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
        params: Record<string, unknown>;
      };
      expect(call.params).toEqual({
        cardsId: "crd-1",
        to: "crd-2",
        cardIds: ["cd-1"],
        idempotencyKey: "k"
      });
    });

    it("rejects an out-of-enum --roll-mode locally (never sends v13/v14 wire values)", async () => {
      const sendCommand = okResult({});

      for (const mode of ["roll", "ic", "publicroll"]) {
        const result = await runCommand(
          ["table", "draw", "--table-id", "tbl-1", "--idempotency-key", "k", "--roll-mode", mode],
          sendCommand as unknown as Parameters<typeof runCommand>[1]
        );
        expect(result.error, mode).not.toBeNull();
      }
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it("requires --idempotency-key on all five non-convergent COMBAT action verbs", async () => {
      for (const argv of [
        ["combat", "next-turn", "--combat-id", "cbt-1"],
        ["combat", "previous-turn", "--combat-id", "cbt-1"],
        ["combat", "next-round", "--combat-id", "cbt-1"],
        ["combat", "previous-round", "--combat-id", "cbt-1"],
        ["combat", "roll-initiative", "--combat-id", "cbt-1", "--all"]
      ]) {
        const sendCommand = okResult({});
        const result = await runCommand(argv, sendCommand as unknown as Parameters<typeof runCommand>[1]);
        expect(result.error, argv.join(" ")).not.toBeNull();
        expect(sendCommand).not.toHaveBeenCalled();
        expect(result.stderr).toContain("--idempotency-key");
      }
    });

    it("keeps the key OPTIONAL on the four convergent combat action verbs", async () => {
      for (const [argv, expected] of [
        [["combat", "start", "--combat-id", "cbt-1"], { combatId: "cbt-1" }],
        [
          ["combat", "activate", "--combat-id", "cbt-1", "--idempotency-key", "k"],
          { combatId: "cbt-1", idempotencyKey: "k" }
        ],
        [["combat", "reset-initiative", "--combat-id", "cbt-1"], { combatId: "cbt-1" }],
        [
          [
            "combat",
            "set-initiative",
            "--combat-id",
            "cbt-1",
            "--combatant-id",
            "cmb-1",
            "--initiative",
            "5",
            "--idempotency-key",
            "k"
          ],
          { combatId: "cbt-1", combatantId: "cmb-1", initiative: 5, idempotencyKey: "k" }
        ]
      ] as Array<[string[], Record<string, unknown>]>) {
        const sendCommand = okResult({});
        const result = await runCommand(argv, sendCommand as unknown as Parameters<typeof runCommand>[1]);
        expect(result.error, argv.join(" ")).toBeNull();
        const call = (sendCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
          params: Record<string, unknown>;
        };
        expect(call.params).toEqual(expected);
      }
    });

    it("rejects an out-of-enum combat --roll-mode locally, and conflicting selectors", async () => {
      const sendCommand = okResult({});
      for (const mode of ["roll", "ic", "gmroll"]) {
        const result = await runCommand(
          [
            "combat",
            "roll-initiative",
            "--combat-id",
            "cbt-1",
            "--idempotency-key",
            "k",
            "--all",
            "--roll-mode",
            mode
          ],
          sendCommand as unknown as Parameters<typeof runCommand>[1]
        );
        expect(result.error, mode).not.toBeNull();
      }

      for (const argv of [
        ["combat", "roll-initiative", "--combat-id", "cbt-1", "--idempotency-key", "k", "--all", "--npc"],
        [
          "combat",
          "roll-initiative",
          "--combat-id",
          "cbt-1",
          "--idempotency-key",
          "k",
          "--all",
          "--combatant-ids",
          "a"
        ]
      ]) {
        const result = await runCommand(argv, sendCommand as unknown as Parameters<typeof runCommand>[1]);
        expect(result.error, argv.join(" ")).not.toBeNull();
      }

      const conflict = await runCommand(
        [
          "combat",
          "next-turn",
          "--combat-id",
          "cbt-1",
          "--idempotency-key",
          "k",
          "--expected-turn",
          "1",
          "--expected-turn-none"
        ],
        sendCommand as unknown as Parameters<typeof runCommand>[1]
      );
      expect(conflict.error).not.toBeNull();
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it("threads the key into file.upload alongside the encoded content", async () => {
      const sendCommand = okResult({ file: { path: "worlds/world-1/fvtt-world-cli/a.txt" } });
      const localFile = join(tmpdir(), `fvtt-world-cli-idem-${Date.now()}.txt`);
      writeFileSync(localFile, "hello");

      try {
        const result = await runCommand(
          [
            "file",
            "upload",
            "--path",
            "worlds/world-1/fvtt-world-cli/a.txt",
            "--from-file",
            localFile,
            "--idempotency-key",
            "upload-key-1"
          ],
          sendCommand as unknown as Parameters<typeof runCommand>[1]
        );

        expect(result.error).toBeNull();
        const call = (sendCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
          command: string;
          params: Record<string, unknown>;
        };
        expect(call.command).toBe("file.upload");
        expect(call.params.idempotencyKey).toBe("upload-key-1");
        expect(call.params.path).toBe("worlds/world-1/fvtt-world-cli/a.txt");
      } finally {
        rmSync(localFile, { force: true });
      }
    });

    it("rejects --idempotency-key on a command that does not define it (e.g. item update)", async () => {
      const result = await runCommand(
        ["item", "update", "--item-id", "item-1", "--name", "Renamed", "--idempotency-key", "k"],
        failIfCalledSendCommand()
      );

      expect(result.error).not.toBeNull();
      expect(result.stderr).toContain("unknown option");
    });
  });

  describe("--timeout-ms (client response wait)", () => {
    it("threads a supplied --timeout-ms into sendCommand", async () => {
      const sendCommand = vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {}
      }));

      const result = await runCommandWithBaseArgs(
        ["node", "fvtt-world-cli", "--timeout-ms", "30000", "scene", "get", "--scene-id", "s1"],
        sendCommand as unknown as SendCommandMock
      );

      expect(result.error).toBeNull();
      expect(sendCommand).toHaveBeenCalledWith({
        daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL,
        deviceCredential: expect.any(String),
        command: "scene.get",
        params: { sceneId: "s1" },
        timeoutMs: 30000
      });
    });

    it("omits timeoutMs from the sendCommand call when --timeout-ms is absent (default preserved)", async () => {
      const sendCommand = vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {}
      }));

      const result = await runCommand(
        ["scene", "get", "--scene-id", "s1"],
        sendCommand as unknown as SendCommandMock
      );

      expect(result.error).toBeNull();
      const call = (sendCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(call).not.toHaveProperty("timeoutMs");
    });

    it.each(["0", "-1", "1.5", "abc"])("rejects --timeout-ms %p as INVALID_ARGUMENT", async (badValue) => {
      const result = await runCommandWithBaseArgs(
        ["node", "fvtt-world-cli", "--timeout-ms", badValue, "scene", "get", "--scene-id", "s1"],
        failIfCalledSendCommand()
      );

      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).code).toBe("commander.invalidArgument");
    });
  });
});
