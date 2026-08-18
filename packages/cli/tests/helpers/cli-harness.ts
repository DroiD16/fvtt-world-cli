import { DEFAULT_DAEMON_URL, PROTOCOL_VERSION } from "@fvtt-world-cli/protocol";
import { vi } from "vitest";

import { createProgram } from "../../src/index.js";
import { createEmptyConfig } from "../../src/config.js";
import type { CliConfigStore, PersistedCliConfig } from "../../src/config.js";
import type { sendCommand as sendCommandType } from "../../src/client/send-command.js";

export function createWritableBuffer() {
  let value = "";
  return {
    write(chunk: string) {
      value += chunk;
    },
    read() {
      return value;
    }
  };
}

export type SendCommandMock = typeof sendCommandType;

export function failIfCalledSendCommand(): SendCommandMock {
  return vi.fn(async () => {
    throw new Error("sendCommand should not be called: a local guard must short-circuit first");
  }) as unknown as SendCommandMock;
}

export const NORMALIZED_DEFAULT_DAEMON_URL = new URL(DEFAULT_DAEMON_URL).toString();

export function createDefaultTestConfig(): PersistedCliConfig {
  return { ...createEmptyConfig(), daemonUrl: NORMALIZED_DEFAULT_DAEMON_URL };
}

export function createInMemoryConfigStore(
  initialConfig: PersistedCliConfig | null = createEmptyConfig()
): CliConfigStore {
  let config = initialConfig;

  return {
    getConfigPath() {
      return "/tmp/fvtt-world-cli-test-config.json";
    },
    readConfig() {
      return config;
    },
    writeConfig(nextConfig) {
      config = nextConfig;
    }
  };
}

export async function runCommand(
  argv: string[],
  sendCommand: SendCommandMock = vi.fn(async () => ({
    protocolVersion: PROTOCOL_VERSION,
    type: "command.response",
    id: "req-1",
    ok: true,
    result: {}
  })) as unknown as SendCommandMock,
  dependencyOverrides: Parameters<typeof runCommandWithBaseArgs>[2] = {}
) {
  return await runCommandWithBaseArgs(["node", "fvtt-world-cli", ...argv], sendCommand, dependencyOverrides);
}

export async function runCommandWithBaseArgs(
  argv: string[],
  sendCommand: SendCommandMock = vi.fn(async () => ({
    protocolVersion: PROTOCOL_VERSION,
    type: "command.response",
    id: "req-1",
    ok: true,
    result: {}
  })) as unknown as SendCommandMock,
  dependencyOverrides: Partial<Parameters<typeof createProgram>[0]> = {}
) {
  const stdout = createWritableBuffer();
  const stderr = createWritableBuffer();
  const program = createProgram({
    stdout,
    stderr,
    sendCommand,
    configStore: dependencyOverrides.configStore ?? createInMemoryConfigStore(createDefaultTestConfig()),
    createBridgeDaemon: dependencyOverrides.createBridgeDaemon,
    env: dependencyOverrides.env,
    runSkillsCli: dependencyOverrides.runSkillsCli
  });

  program.exitOverride();

  let thrownError: unknown = null;

  try {
    await program.parseAsync(argv, {
      from: "node"
    });
  } catch (error) {
    thrownError = error;
  }

  return {
    stdout: stdout.read(),
    stderr: stderr.read(),
    sendCommand,
    error: thrownError
  };
}
