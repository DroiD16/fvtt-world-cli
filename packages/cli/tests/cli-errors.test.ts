import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_UPLOAD_SIZE_LIMIT_BYTES } from "@fvtt-world-cli/protocol";
import { CommanderError } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { executeCli, exitCodeForErrorCode, planCliErrorOutput } from "../src/index.js";
import { CliConfigError, createEmptyConfig } from "../src/config.js";
import { DaemonTransportError, type sendCommand as sendCommandType } from "../src/client/send-command.js";
import {
  createDefaultTestConfig,
  createInMemoryConfigStore,
  createWritableBuffer,
  failIfCalledSendCommand
} from "./helpers/cli-harness.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fvtt-world-cli commands", () => {
  describe("--version", () => {
    it("prints a parseable name + version to stdout and exits 0", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(["node", "fvtt-world-cli", "--version"], {
        stdout,
        stderr,
        sendCommand: failIfCalledSendCommand(),
        configStore: createInMemoryConfigStore()
      });

      expect(exitCode).toBe(0);

      expect(stdout.read()).toMatch(/^fvtt-world-cli \d+\.\d+\.\d+/);

      expect(stderr.read()).toBe("");
    });
  });

  describe("planCliErrorOutput", () => {
    it("maps a missing required option to MISSING_REQUIRED_OPTION under --json", () => {
      const error = new CommanderError(
        1,
        "commander.missingMandatoryOptionValue",
        "error: required option '--scene-id <sceneId>' not specified"
      );
      const output = planCliErrorOutput(error, true);

      expect(output.exitCode).toBe(2);
      expect(output.stderr).toBeUndefined();
      const envelope = JSON.parse(output.stdout ?? "");
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("MISSING_REQUIRED_OPTION");
      expect(envelope.error.details).toEqual({
        commanderCode: "commander.missingMandatoryOptionValue"
      });
    });

    it("maps an invalid argument to INVALID_ARGUMENT under --json", () => {
      const error = new CommanderError(
        1,
        "commander.invalidArgument",
        "error: option '--system-json <json>' argument is invalid"
      );
      const envelope = JSON.parse(planCliErrorOutput(error, true).stdout ?? "");
      expect(envelope.error.code).toBe("INVALID_ARGUMENT");
    });

    it("emits nothing for help display and preserves its exit code", () => {
      const error = new CommanderError(0, "commander.helpDisplayed", "(outputHelp)");
      expect(planCliErrorOutput(error, true)).toEqual({ exitCode: 0 });
    });

    it("does not re-emit a remote error the command already rendered", () => {
      const error = new CommanderError(1, "fvtt-world-cli.remoteError", "Scene missing was not found");
      expect(planCliErrorOutput(error, true)).toEqual({ exitCode: 1 });
      expect(planCliErrorOutput(error, false)).toEqual({ exitCode: 1 });
    });

    it("maps a declined pairing to PAIRING_DECLINED and an interrupted prompt to PAIRING_PROMPT_ABORTED", () => {
      for (const [commanderCode, code] of [
        ["fvtt-world-cli.pairingDeclined", "PAIRING_DECLINED"],
        ["fvtt-world-cli.approvalDenied", "PAIRING_DECLINED"],
        ["fvtt-world-cli.pruneDeclined", "PAIRING_DECLINED"],
        ["fvtt-world-cli.pairingPromptAborted", "PAIRING_PROMPT_ABORTED"]
      ]) {
        const error = new CommanderError(1, commanderCode, "Pairing request ABCDEFGH denied");
        const output = planCliErrorOutput(error, true);

        expect(output.exitCode, commanderCode).toBe(1);
        const envelope = JSON.parse(output.stdout ?? "");
        expect(envelope.error.code, commanderCode).toBe(code);
        expect(envelope.error.details).toEqual({ commanderCode });
      }
    });

    it("keeps a transport failure's own code and exit status instead of reporting it as internal", () => {
      const error = new DaemonTransportError("DAEMON_UNAVAILABLE", "Daemon connection closed (1006)", {
        reason: "closed"
      });

      const output = planCliErrorOutput(error, true);

      expect(output.exitCode).toBe(3);
      const envelope = JSON.parse(output.stdout ?? "");
      expect(envelope.error.code).toBe("DAEMON_UNAVAILABLE");
      expect(envelope.error.details).toEqual({ reason: "closed" });
      expect(planCliErrorOutput(error, false).stderr).toContain(
        "DAEMON_UNAVAILABLE: Daemon connection closed (1006)"
      );
    });

    it("maps a corrupt config file (CliConfigError) to INVALID_CONFIGURATION", () => {
      const error = new CliConfigError("Invalid CLI config at /x/config.json: bad json");
      const envelope = JSON.parse(planCliErrorOutput(error, true).stdout ?? "");
      expect(envelope.error.code).toBe("INVALID_CONFIGURATION");
      expect(envelope.error.message).toContain("Invalid CLI config at");
      expect(planCliErrorOutput(error, false).stderr).toContain("Invalid CLI config at");
    });

    it("emits a config error to stderr in human mode and to stdout in --json mode", () => {
      const parsed = z.object({ token: z.string() }).safeParse({});
      expect(parsed.success).toBe(false);
      const error = parsed.success ? new Error("unreachable") : parsed.error;

      expect(planCliErrorOutput(error, false).stderr).toBeDefined();
      const envelope = JSON.parse(planCliErrorOutput(error, true).stdout ?? "");
      expect(envelope.error.code).toBe("INVALID_CONFIGURATION");
    });

    it("emits an action-thrown CommanderError in human mode only when commander did not print it", () => {
      const error = new CommanderError(
        1,
        "commander.invalidArgument",
        "error: --system-json must be valid JSON for an object: bad"
      );

      expect(planCliErrorOutput(error, false, { commanderAlreadyPrinted: false }).stderr).toContain(
        "INVALID_ARGUMENT: --system-json must be valid JSON for an object"
      );

      expect(planCliErrorOutput(error, false, { commanderAlreadyPrinted: true }).stderr).toBeUndefined();
    });
  });

  describe("exitCodeForErrorCode (coarse exit classes)", () => {
    it("maps connectivity/auth codes to 3 (daemon unavailable / unauthorized)", () => {
      expect(exitCodeForErrorCode("DAEMON_UNAVAILABLE")).toBe(3);
      expect(exitCodeForErrorCode("UNAUTHORIZED")).toBe(3);
    });

    it("maps CLI usage codes to 2", () => {
      expect(exitCodeForErrorCode("INVALID_ARGUMENT")).toBe(2);
      expect(exitCodeForErrorCode("MISSING_REQUIRED_OPTION")).toBe(2);
      expect(exitCodeForErrorCode("UNKNOWN_OPTION")).toBe(2);
      expect(exitCodeForErrorCode("INVALID_CONFIGURATION")).toBe(2);
    });

    it("maps every other command-level failure (including all BRIDGE_* codes) to 1", () => {
      for (const code of [
        "ACTOR_NOT_FOUND",
        "INVALID_PARAMS",
        "BRIDGE_NOT_READY",
        "BRIDGE_TIMEOUT",
        "BRIDGE_DISCONNECTED",
        "PATH_NOT_ALLOWED",
        "PAYLOAD_TOO_LARGE",
        "UNSUPPORTED_OPERATION",
        "INTERNAL_ERROR",

        "LOCAL_FILE_ERROR",
        "PAIRING_DECLINED",
        "PAIRING_PROMPT_ABORTED"
      ]) {
        expect(exitCodeForErrorCode(code)).toBe(1);
      }
    });

    it("maps an unknown or undefined code to 1", () => {
      expect(exitCodeForErrorCode("SOME_FUTURE_CODE")).toBe(1);
      expect(exitCodeForErrorCode(undefined)).toBe(1);
    });
  });

  describe("executeCli (production wiring)", () => {
    const okMock = () =>
      vi.fn(async () => ({
        protocolVersion: "1.0",
        type: "command.response",
        id: "req-1",
        ok: true,
        result: {}
      })) as unknown as typeof sendCommandType;

    it("emits a single JSON envelope on stdout and suppresses commander stderr in --json mode", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(["node", "fvtt-world-cli", "--json", "scene", "get"], {
        stdout,
        stderr,
        sendCommand: okMock()
      });

      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stdout.read());
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("MISSING_REQUIRED_OPTION");
      expect(stderr.read()).toBe("");
    });

    it("routes commander parse errors to stderr with empty stdout in human mode", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(["node", "fvtt-world-cli", "scene", "get"], {
        stdout,
        stderr,
        sendCommand: okMock()
      });

      expect(exitCode).toBe(2);
      expect(stdout.read()).toBe("");
      const errText = stderr.read();
      expect(errText).toContain("required option '--scene-id <sceneId>' not specified");

      expect(errText.match(/required option/g)?.length).toBe(1);
    });

    it("exits 2 (USAGE) for an unknown dotted command in human mode", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(["node", "fvtt-world-cli", "playlist.sound.get", "foo"], {
        stdout,
        stderr,
        sendCommand: okMock()
      });

      expect(exitCode).toBe(2);
      expect(stdout.read()).toBe("");
      expect(stderr.read()).toContain("unknown command 'playlist.sound.get'");
    });

    it("exits 2 (USAGE) for an unknown dotted command in --json mode", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(["node", "fvtt-world-cli", "--json", "playlist.sound.get", "foo"], {
        stdout,
        stderr,
        sendCommand: okMock()
      });

      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stdout.read());
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("INVALID_ARGUMENT");
      expect(envelope.error.details.commanderCode).toBe("commander.unknownCommand");
      expect(stderr.read()).toBe("");
    });

    it("exits 2 (USAGE) for an unknown option", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(["node", "fvtt-world-cli", "system", "info", "--bogus"], {
        stdout,
        stderr,
        sendCommand: okMock()
      });

      expect(exitCode).toBe(2);
    });

    it("surfaces an action-thrown validation error in human mode (was silently swallowed)", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(
        [
          "node",
          "fvtt-world-cli",
          "item",
          "create",
          "--name",
          "X",
          "--type",
          "loot",
          "--system-json",
          "{bad"
        ],
        { stdout, stderr, sendCommand: okMock() }
      );

      expect(exitCode).toBe(2);
      expect(stdout.read()).toBe("");
      expect(stderr.read()).toContain("INVALID_ARGUMENT: --system-json must be valid JSON for an object");
    });

    it("emits an INVALID_ARGUMENT envelope for an action-thrown validation error in --json mode", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(
        [
          "node",
          "fvtt-world-cli",
          "--json",
          "item",
          "create",
          "--name",
          "X",
          "--type",
          "loot",
          "--system-json",
          "{bad"
        ],
        { stdout, stderr, sendCommand: okMock() }
      );

      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stdout.read());
      expect(envelope.error.code).toBe("INVALID_ARGUMENT");
      expect(stderr.read()).toBe("");
    });

    it("emits a PAYLOAD_TOO_LARGE envelope (and never forwards) for an oversized upload in --json mode", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();
      const tempDir = mkdtempSync(join(tmpdir(), "fvtt-world-cli-oversize-"));
      const localFile = join(tempDir, "big.bin");

      const uploadLimitBytes = 1024;
      writeFileSync(localFile, Buffer.alloc(uploadLimitBytes + 1));
      const sendCommand = failIfCalledSendCommand();

      try {
        const exitCode = await executeCli(
          [
            "node",
            "fvtt-world-cli",
            "--json",
            "file",
            "upload",
            "--path",
            "worlds/world-1/fvtt-world-cli/big.bin",
            "--from-file",
            localFile
          ],
          {
            stdout,
            stderr,
            sendCommand,
            configStore: createInMemoryConfigStore({ ...createEmptyConfig(), uploadLimitBytes })
          }
        );

        expect(exitCode).toBe(1);
        const envelope = JSON.parse(stdout.read());
        expect(envelope.error.code).toBe("PAYLOAD_TOO_LARGE");

        expect(envelope.error.message).toContain(String(uploadLimitBytes));
        expect(envelope.error.message).toContain(String(uploadLimitBytes + 1));
        expect(envelope.error.message).toContain("uploadLimitBytes");
        expect(envelope.error.message).toContain("effective upload limit");

        expect(envelope.error.message).toBe(
          `Upload payload for ${localFile} is ${uploadLimitBytes + 1} bytes ` +
            `but the effective upload limit is ${uploadLimitBytes} bytes; raise uploadLimitBytes in ` +
            `the daemon config (max ${512 * 1024 * 1024} bytes) and restart the daemon, or shrink the asset`
        );
        expect(envelope.error.details).toMatchObject({
          path: localFile,
          limitBytes: uploadLimitBytes,
          actualBytes: uploadLimitBytes + 1
        });
        expect(stderr.read()).toBe("");
        expect(sendCommand).not.toHaveBeenCalled();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("uses the default limit when no upload limit is configured (no maxPayloadBytes threaded)", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();
      const tempDir = mkdtempSync(join(tmpdir(), "fvtt-world-cli-oversize-"));
      const localFile = join(tempDir, "big.bin");

      writeFileSync(localFile, Buffer.alloc(16));
      const sendCommand = okMock();

      try {
        const exitCode = await executeCli(
          [
            "node",
            "fvtt-world-cli",
            "--json",
            "file",
            "upload",
            "--path",
            "worlds/world-1/fvtt-world-cli/small.bin",
            "--from-file",
            localFile
          ],
          { stdout, stderr, sendCommand, configStore: createInMemoryConfigStore() }
        );

        expect(exitCode).toBe(0);
        expect(sendCommand).toHaveBeenCalledTimes(1);
        const call = (sendCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(call.maxPayloadBytes).toBeUndefined();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("threads the derived frame cap into sendCommand when a non-default upload limit is configured", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();
      const tempDir = mkdtempSync(join(tmpdir(), "fvtt-world-cli-cap-"));
      const localFile = join(tempDir, "small.bin");
      writeFileSync(localFile, Buffer.alloc(16));
      const sendCommand = okMock();
      const uploadLimitBytes = 200 * 1024 * 1024;

      try {
        const exitCode = await executeCli(
          [
            "node",
            "fvtt-world-cli",
            "--json",
            "file",
            "upload",
            "--path",
            "worlds/world-1/fvtt-world-cli/small.bin",
            "--from-file",
            localFile
          ],
          {
            stdout,
            stderr,
            sendCommand,
            configStore: createInMemoryConfigStore({ ...createEmptyConfig(), uploadLimitBytes })
          }
        );

        expect(exitCode).toBe(0);
        const call = (sendCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];

        expect(call.maxPayloadBytes).toBe(Math.ceil((uploadLimitBytes * 4) / 3) + 1024 * 1024);
        expect(call.maxPayloadBytes).toBeGreaterThan(DEFAULT_UPLOAD_SIZE_LIMIT_BYTES);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("emits PAYLOAD_TOO_LARGE on stderr for an oversized upload in human mode", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();
      const tempDir = mkdtempSync(join(tmpdir(), "fvtt-world-cli-oversize-"));
      const localFile = join(tempDir, "big.bin");
      const uploadLimitBytes = 1024;
      writeFileSync(localFile, Buffer.alloc(uploadLimitBytes + 1));

      try {
        const exitCode = await executeCli(
          [
            "node",
            "fvtt-world-cli",
            "file",
            "upload",
            "--path",
            "worlds/world-1/fvtt-world-cli/big.bin",
            "--from-file",
            localFile
          ],
          {
            stdout,
            stderr,
            sendCommand: failIfCalledSendCommand(),
            configStore: createInMemoryConfigStore({ uploadLimitBytes })
          }
        );

        expect(exitCode).toBe(1);
        expect(stdout.read()).toBe("");
        expect(stderr.read()).toContain("PAYLOAD_TOO_LARGE:");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("maps a malformed --daemon-url to INVALID_CONFIGURATION in --json mode", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(
        ["node", "fvtt-world-cli", "--daemon-url", "not-a-url", "--json", "system", "ping"],
        {
          stdout,
          stderr,
          sendCommand: okMock(),
          configStore: createInMemoryConfigStore(createDefaultTestConfig())
        }
      );

      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stdout.read());
      expect(envelope.error.code).toBe("INVALID_CONFIGURATION");
    });

    it("config set-upload-limit persists a valid uploadLimitBytes", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();
      const configStore = createInMemoryConfigStore(null);

      const exitCode = await executeCli(
        ["node", "fvtt-world-cli", "--json", "config", "set-upload-limit", "200MiB"],
        { stdout, stderr, sendCommand: okMock(), configStore }
      );

      expect(exitCode).toBe(0);
      const payload = JSON.parse(stdout.read());
      expect(payload.uploadLimitBytes).toBe(200 * 1024 * 1024);
      expect(payload.daemonRestartRequired).toBe(true);

      expect(configStore.readConfig()?.uploadLimitBytes).toBe(200 * 1024 * 1024);
    });

    it("config set-upload-limit rejects an over-ceiling value with INVALID_CONFIGURATION", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();
      const configStore = createInMemoryConfigStore(null);

      const exitCode = await executeCli(
        ["node", "fvtt-world-cli", "--json", "config", "set-upload-limit", "600MiB"],
        { stdout, stderr, sendCommand: okMock(), configStore }
      );

      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stdout.read());
      expect(envelope.error.code).toBe("INVALID_CONFIGURATION");

      expect(configStore.readConfig()).toBeNull();
    });

    it("prints help for the `help` subcommand without appending an error envelope in --json mode", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(["node", "fvtt-world-cli", "--json", "help"], {
        stdout,
        stderr,
        sendCommand: okMock()
      });

      const out = stdout.read();
      expect(exitCode).toBe(0);
      expect(out).toContain("Usage:");
      expect(out).not.toContain('"ok": false');
    });

    it("emits an error envelope (exit 2) when no command is given in --json mode", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(["node", "fvtt-world-cli", "--json"], {
        stdout,
        stderr,
        sendCommand: okMock()
      });

      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stdout.read());
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("INVALID_ARGUMENT");
      expect(envelope.error.message).not.toContain("(outputHelp)");
    });

    it("emits an error envelope (exit 2) for `help <unknown>` in --json mode", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();

      const exitCode = await executeCli(["node", "fvtt-world-cli", "--json", "help", "bogus"], {
        stdout,
        stderr,
        sendCommand: okMock()
      });

      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stdout.read());
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe("INVALID_ARGUMENT");
    });

    it("maps a malformed bridge serve --daemon-url to INVALID_CONFIGURATION before starting", async () => {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();
      const createBridgeDaemon = vi.fn(() => {
        throw new Error("daemon must not start on a malformed URL");
      }) as unknown as NonNullable<Parameters<typeof executeCli>[1]>["createBridgeDaemon"];

      const exitCode = await executeCli(
        ["node", "fvtt-world-cli", "--json", "--daemon-url", "not-a-url", "bridge", "serve"],
        {
          stdout,
          stderr,
          sendCommand: okMock(),
          createBridgeDaemon,
          configStore: createInMemoryConfigStore(createDefaultTestConfig())
        }
      );

      expect(exitCode).toBe(2);
      const envelope = JSON.parse(stdout.read());
      expect(envelope.error.code).toBe("INVALID_CONFIGURATION");
      expect(createBridgeDaemon).not.toHaveBeenCalled();
    });
  });
});
