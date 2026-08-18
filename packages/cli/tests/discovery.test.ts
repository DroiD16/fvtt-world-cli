import { CommanderError } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { executeCli } from "../src/index.js";
import { createWritableBuffer, runCommand } from "./helpers/cli-harness.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fvtt-world-cli commands", () => {
  describe("discovery commands", () => {
    it("lists every protocol command with its mutation flag as JSON", async () => {
      const result = await runCommand(["--json", "commands"]);

      expect(result.error).toBeNull();
      const envelope = JSON.parse(result.stdout);

      expect(envelope.ok).toBe(true);
      const list = envelope.result;
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
      expect(list).toContainEqual({ command: "scene.update", mutation: true });
      expect(list).toContainEqual({ command: "scene.get", mutation: false });
    });

    it("prints commands as `name<tab>read|write` in human mode", async () => {
      const result = await runCommand(["commands"]);

      expect(result.error).toBeNull();
      expect(result.stdout).toContain("scene.update\twrite");
      expect(result.stdout).toContain("scene.get\tread");
    });

    it("prints a command's param schema as JSON", async () => {
      const result = await runCommand(["--json", "schema", "scene.update"]);

      expect(result.error).toBeNull();
      const envelope = JSON.parse(result.stdout);

      expect(envelope.ok).toBe(true);
      const payload = envelope.result;
      expect(payload.command).toBe("scene.update");
      expect(payload.mutation).toBe(true);
      expect(payload.paramsSchema.required).toContain("sceneId");
      expect(payload.paramsSchema.properties.patch).toBeDefined();
    });

    it("rejects an unknown command for schema with INVALID_ARGUMENT", async () => {
      const result = await runCommand(["--json", "schema", "bogus.command"]);

      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).code).toBe("commander.invalidArgument");
      expect((result.error as CommanderError).message).toContain("Unknown command: bogus.command");
    });

    it("renders an unknown schema command as a single INVALID_ARGUMENT envelope on stdout (--json)", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(["node", "fvtt-world-cli", "--json", "schema", "bogus.command"], {
        stdout,
        stderr
      });

      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stdout.read());
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("INVALID_ARGUMENT");
      expect(envelope.error.message).toContain("Unknown command: bogus.command");
      expect(stderr.read()).toBe("");
    });

    it.each(["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"])(
      "rejects the reserved prototype key %p for schema with INVALID_ARGUMENT",
      async (reservedKey) => {
        const result = await runCommand(["--json", "schema", reservedKey]);

        expect(result.error).toBeInstanceOf(CommanderError);
        expect((result.error as CommanderError).code).toBe("commander.invalidArgument");
        expect((result.error as CommanderError).message).toContain(`Unknown command: ${reservedKey}`);

        expect(result.stdout).toBe("");
      }
    );

    it("lists the shipped docs with titles in --json mode", async () => {
      const result = await runCommand(["--json", "docs"]);

      expect(result.error).toBeNull();
      const envelope = JSON.parse(result.stdout);
      expect(envelope.ok).toBe(true);
      expect(envelope.result).toContainEqual({ name: "protocol", title: "Protocol" });
      expect(envelope.result).toContainEqual({ name: "commands", title: "Commands" });
      expect(envelope.result).toContainEqual({ name: "getting-started", title: "Getting started" });
      for (const entry of envelope.result) expect(entry.name).not.toMatch(/\.md$/);
    });

    it("prints docs as `name<tab>title` lines in human mode", async () => {
      const result = await runCommand(["docs"]);

      expect(result.error).toBeNull();
      expect(result.stdout).toContain("protocol\tProtocol");
      expect(result.stdout).toContain("security\tSecurity");
    });

    it("prints one document's raw markdown in human mode", async () => {
      const result = await runCommand(["docs", "protocol"]);

      expect(result.error).toBeNull();
      expect(result.stdout).toMatch(/^# Protocol\n/);
      expect(result.stdout.endsWith("\n")).toBe(true);
    });

    it("returns one document's content in the --json envelope", async () => {
      const result = await runCommand(["--json", "docs", "security"]);

      expect(result.error).toBeNull();
      const envelope = JSON.parse(result.stdout);
      expect(envelope.ok).toBe(true);
      expect(envelope.result.name).toBe("security");
      expect(envelope.result.title).toBe("Security");
      expect(envelope.result.content).toContain("# Security");
    });

    it("rejects an unknown document name with INVALID_ARGUMENT and lists the available names", async () => {
      const result = await runCommand(["--json", "docs", "bogus"]);

      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).code).toBe("commander.invalidArgument");
      expect((result.error as CommanderError).message).toContain("Unknown document: bogus");
      expect((result.error as CommanderError).message).toContain("protocol");
    });

    it("never treats the docs name as a path", async () => {
      const result = await runCommand(["--json", "docs", "../AGENTS"]);

      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).code).toBe("commander.invalidArgument");
    });

    it("renders a reserved prototype key as a single INVALID_ARGUMENT envelope on stdout (--json)", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(["node", "fvtt-world-cli", "--json", "schema", "__proto__"], {
        stdout,
        stderr
      });

      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stdout.read());
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("INVALID_ARGUMENT");
      expect(envelope.error.message).toContain("Unknown command: __proto__");
      expect(stderr.read()).toBe("");
    });
  });
});
