#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildSync } from "esbuild";

import { COMMAND_NAMES } from "../packages/protocol/src/commands.js";
import { isDestructiveCommand } from "../packages/protocol/src/destructive-commands.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const ENTRY_POINT = join("packages", "protocol", "src", "index.js");
const PROFILE_PATH = join(
  REPO_ROOT,
  "packages",
  "protocol",
  "src",
  "generated",
  "default-command-profile.js"
);
const OUTPUT_PATH = join(REPO_ROOT, "packages", "foundry-module", "scripts", "generated", "protocol.js");

const BANNER = [
  "// @ts-nocheck",
  "// Generated from packages/protocol/src by scripts/generate-protocol.mjs. Do not edit.",
  "// The bundler strips the JSDoc that types the canonical source, so this copy is not type-checked."
].join("\n");

const PROFILE_BANNER = [
  "// Generated from the command registry by scripts/generate-protocol.mjs. Do not edit.",
  "// Every registry command maps to the baseline behavior: approve when destructive, otherwise allow."
].join("\n");

export function buildDefaultCommandProfileSource() {
  const entries = COMMAND_NAMES.map(
    (command) => `  ${JSON.stringify(command)}: ${isDestructiveCommand(command) ? '"approve"' : '"allow"'}`
  );

  return [
    PROFILE_BANNER,
    "",
    'import { deepFreeze } from "../schemas/shared.js";',
    "",
    '/** @type {Readonly<Record<string, "allow" | "approve" | "deny">>} */',
    "export const DEFAULT_COMMAND_PROFILE = deepFreeze({",
    entries.join(",\n"),
    "});",
    ""
  ].join("\n");
}

export function buildGeneratedSource() {
  const { outputFiles } = buildSync({
    absWorkingDir: REPO_ROOT,
    entryPoints: [ENTRY_POINT],
    bundle: true,
    format: "esm",
    write: false,
    banner: { js: BANNER }
  });

  return outputFiles[0].text;
}

function readArtifact(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function reportStale(path) {
  process.stderr.write(`${relative(REPO_ROOT, path)} out of date. Run \`npm run generate:protocol\`.\n`);
  process.exit(1);
}

function main() {
  const check = process.argv.includes("--check");
  const profile = buildDefaultCommandProfileSource();

  if (check) {
    // The mirror bundle resolves the profile from disk, so the profile verdict comes first.
    if (readArtifact(PROFILE_PATH) !== profile) reportStale(PROFILE_PATH);
    if (readArtifact(OUTPUT_PATH) !== buildGeneratedSource()) reportStale(OUTPUT_PATH);

    process.stdout.write("Generated protocol artifacts are up to date.\n");
    return;
  }

  // The mirror bundle reads the profile from disk, so the profile is written first.
  writeFileSync(PROFILE_PATH, profile);
  writeFileSync(OUTPUT_PATH, buildGeneratedSource());
  process.stdout.write(`Wrote ${PROFILE_PATH}\nWrote ${OUTPUT_PATH}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { OUTPUT_PATH, PROFILE_PATH };
