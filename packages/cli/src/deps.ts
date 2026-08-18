import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { Command } from "commander";

import { createBridgeDaemon } from "./bridge/daemon.js";
import { sendCommand } from "./client/send-command.js";
import { type CliConfigStore, createCliConfigStore } from "./config.js";

interface IoStreams {
  stdout: NodeJS.WriteStream | { write(chunk: string): void };
  stderr: NodeJS.WriteStream | { write(chunk: string): void };

  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
}

export interface CliDependencies extends IoStreams {
  sendCommand: typeof sendCommand;
  createBridgeDaemon: typeof createBridgeDaemon;
  configStore: CliConfigStore;
  env: NodeJS.ProcessEnv;
  runSkillsCli: (args: string[]) => { status: number | null; error?: Error };
}

export function resolveCliVersion(): string {
  // ../package.json is relative to this module's directory: keep this module directly under src/.
  try {
    const manifestUrl = new URL("../package.json", import.meta.url);
    const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as { version?: unknown };
    if (typeof manifest.version === "string" && manifest.version.length > 0) {
      return manifest.version;
    }
  } catch {
    // fall through to the unknown sentinel
  }
  return "0.0.0";
}

export function write(stream: IoStreams["stdout"], value: string) {
  stream.write(value);
}

export function applyExitOverride(command: Command) {
  command.exitOverride();
  for (const sub of command.commands) {
    applyExitOverride(sub);
  }
}

export function suppressCommanderStderr(command: Command) {
  command.configureOutput({ writeErr: () => {} });
  for (const sub of command.commands) {
    suppressCommanderStderr(sub);
  }
}

export function resolveDependencies(partial: Partial<CliDependencies> = {}): CliDependencies {
  return {
    stdout: partial.stdout ?? process.stdout,
    stderr: partial.stderr ?? process.stderr,
    stdin: partial.stdin ?? process.stdin,
    sendCommand: partial.sendCommand ?? sendCommand,
    createBridgeDaemon: partial.createBridgeDaemon ?? createBridgeDaemon,
    configStore: partial.configStore ?? createCliConfigStore(),
    env: partial.env ?? process.env,
    runSkillsCli:
      partial.runSkillsCli ??
      ((args) => {
        const result = spawnSync("npx", ["-y", "skills", ...args], { stdio: "inherit" });
        return { status: result.status, ...(result.error ? { error: result.error } : {}) };
      })
  };
}

export function applyOutputRouting(command: Command, dependencies: CliDependencies) {
  command.configureOutput({
    writeOut: (str) => dependencies.stdout.write(str),
    writeErr: (str) => dependencies.stderr.write(str)
  });
  for (const sub of command.commands) {
    applyOutputRouting(sub, dependencies);
  }
}
