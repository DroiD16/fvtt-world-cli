#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const binDirectory = dirname(fileURLToPath(import.meta.url));
const compiledEntry = resolve(binDirectory, "../dist/index.js");
const sourceEntry = resolve(binDirectory, "../src/index.ts");

if (existsSync(compiledEntry) && process.env.FVTT_WORLD_CLI_FORCE_SRC !== "1") {
  try {
    const cli = await import(pathToFileURL(compiledEntry).href);
    process.exitCode = await cli.executeCli(process.argv);
  } catch (error) {
    console.error("Failed to launch fvtt-world-cli", error);
    process.exit(1);
  }
} else {
  const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
  const supportsDisableWarning =
    (nodeMajor === 20 && nodeMinor >= 11) || (nodeMajor === 21 && nodeMinor >= 3) || nodeMajor >= 22;
  const nodeArgs = supportsDisableWarning
    ? ["--disable-warning=DEP0205", "--import", "tsx/esm", sourceEntry]
    : ["--import", "tsx/esm", sourceEntry];

  const child = spawn(process.execPath, [...nodeArgs, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });

  /** @type {NodeJS.Signals[]} */
  const relayedSignals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of relayedSignals) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }

  child.on("exit", (code, signal) => {
    for (const relayed of relayedSignals) {
      process.removeAllListeners(relayed);
    }

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error("Failed to launch fvtt-world-cli", error);
    process.exit(1);
  });
}
