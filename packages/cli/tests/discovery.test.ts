import {
  COMMAND_NAMES,
  DISCOVERABLE_COMMAND_NAMES,
  ERROR_CODES,
  POLICY_DISCOVERY_TIMEOUT_MS,
  createCommandResponse,
  createErrorResponse,
  createProtocolError
} from "@fvtt-world-cli/protocol";
import { CommanderError } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { executeCli } from "../src/index.js";
import { DaemonTransportError } from "../src/transport-util.js";
import { createWritableBuffer, runCommand, type SendCommandMock } from "./helpers/cli-harness.js";

function policySnapshot(snapshot: { approve?: string[]; deny?: string[] }) {
  const calls: Array<{ command: string; timeoutMs?: number }> = [];
  const sendCommand = (async (options: { command: string; timeoutMs?: number }) => {
    calls.push({ command: options.command, timeoutMs: options.timeoutMs });
    return createCommandResponse({
      id: "snapshot",
      result: { approve: snapshot.approve ?? [], deny: snapshot.deny ?? [] }
    });
  }) as unknown as SendCommandMock;
  return { sendCommand, calls };
}

function policyFailure(failure: Error | { code: string; message: string }) {
  return (async () => {
    if (failure instanceof Error) throw failure;
    return createErrorResponse({
      id: "snapshot",
      error: createProtocolError({ code: failure.code, message: failure.message })
    });
  }) as unknown as SendCommandMock;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fvtt-world-cli commands", () => {
  describe("discovery commands", () => {
    it("lists each discoverable command with its mutation flag as JSON", async () => {
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

    it("omits internal plumbing commands from the list in both output modes", async () => {
      const hidden = COMMAND_NAMES.filter((name) => !DISCOVERABLE_COMMAND_NAMES.includes(name));
      expect(hidden.length).toBeGreaterThan(0);

      const json = await runCommand(["--json", "commands"]);
      const listed = JSON.parse(json.stdout).result.map((entry: { command: string }) => entry.command);
      expect(listed).toEqual([...DISCOVERABLE_COMMAND_NAMES]);

      const human = await runCommand(["commands"]);
      expect(human.error).toBeNull();
      for (const command of hidden) {
        expect(listed, `${command} must not be discoverable`).not.toContain(command);
        expect(human.stdout, `${command} must not be discoverable`).not.toContain(command);
      }
    });

    it("hides denied commands and marks the ones that need an approval", async () => {
      const { sendCommand, calls } = policySnapshot({
        approve: ["scene.delete"],
        deny: ["file.delete"]
      });

      const result = await runCommand(["--json", "commands"], sendCommand);

      expect(result.error).toBeNull();
      const envelope = JSON.parse(result.stdout);
      expect(envelope.policy).toEqual({ applied: true, source: "bridge" });
      const listed = envelope.result as Array<{ command: string; approval?: boolean }>;
      expect(listed.map((entry) => entry.command)).not.toContain("file.delete");
      expect(listed).toContainEqual({ command: "scene.delete", mutation: true, approval: true });
      expect(listed).toContainEqual({ command: "scene.get", mutation: false });
      expect(listed.filter((entry) => entry.approval === true)).toHaveLength(1);
      expect(calls).toEqual([{ command: "policy.snapshot", timeoutMs: POLICY_DISCOVERY_TIMEOUT_MS }]);
    });

    it("tags commands that need an approval in human output", async () => {
      const { sendCommand } = policySnapshot({ approve: ["scene.delete"], deny: ["file.delete"] });

      const result = await runCommand(["commands"], sendCommand);

      expect(result.stdout).toContain("scene.delete\twrite\tapproval");
      expect(result.stdout).toContain("scene.get\tread\n");
      expect(result.stdout).not.toContain("file.delete");
      expect(result.stderr).toBe("");
    });

    it.each([ERROR_CODES.DAEMON_UNAVAILABLE, ERROR_CODES.BRIDGE_NOT_READY, ERROR_CODES.BRIDGE_DISCONNECTED])(
      "falls back to the static registry and says so when the bridge answers %s",
      async (code) => {
        const result = await runCommand(
          ["--json", "commands"],
          policyFailure({ code, message: "not available" })
        );

        expect(result.error).toBeNull();
        const envelope = JSON.parse(result.stdout);
        expect(envelope.policy).toEqual({ applied: false, source: "static", reason: code });
        expect(envelope.result.map((entry: { command: string }) => entry.command)).toEqual([
          ...DISCOVERABLE_COMMAND_NAMES
        ]);
        expect(envelope.result.every((entry: { approval?: boolean }) => entry.approval === undefined)).toBe(
          true
        );
      }
    );

    it("falls back to the static registry when reading the policy times out", async () => {
      const result = await runCommand(
        ["commands"],
        policyFailure(
          new DaemonTransportError(ERROR_CODES.DAEMON_UNAVAILABLE, "Timed out waiting for daemon response", {
            reason: "timeout"
          })
        )
      );

      expect(result.error).toBeNull();
      expect(result.stderr).toContain("warning: the command policy");
      expect(result.stderr).toContain(ERROR_CODES.DAEMON_UNAVAILABLE);
      expect(result.stdout).toContain("scene.delete\twrite\n");
    });

    it.each([ERROR_CODES.UNAUTHORIZED, ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION, ERROR_CODES.INVALID_PARAMS])(
      "fails with %s instead of pretending there is no bridge",
      async (code) => {
        const result = await runCommand(
          ["--json", "commands"],
          policyFailure({ code, message: "policy read refused" })
        );

        expect(result.error).toBeInstanceOf(CommanderError);
        const envelope = JSON.parse(result.stdout);
        expect(envelope.ok).toBe(false);
        expect(envelope.error.code).toBe(code);
        expect(envelope.result).toBeUndefined();
      }
    );

    it("never lists a policy-plumbing command, whatever the policy says", async () => {
      const { sendCommand } = policySnapshot({ approve: ["approval.await"], deny: [] });

      const result = await runCommand(["--json", "commands"], sendCommand);

      const listed = JSON.parse(result.stdout).result.map((entry: { command: string }) => entry.command);
      expect(listed).not.toContain("approval.await");
      expect(listed).not.toContain("policy.snapshot");
    });

    it("prints the schema of a command that discovery omits", async () => {
      const result = await runCommand(["--json", "schema", "approval.await"]);

      expect(result.error).toBeNull();
      const payload = JSON.parse(result.stdout).result;
      expect(payload.command).toBe("approval.await");
      expect(payload.mutation).toBe(false);
      expect(payload.paramsSchema.required).toEqual(["approvalId"]);
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
