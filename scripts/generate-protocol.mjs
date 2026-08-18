#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildSync } from "esbuild";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const ENTRY_POINT = join("packages", "protocol", "src", "index.js");
const OUTPUT_PATH = join(REPO_ROOT, "packages", "foundry-module", "scripts", "generated", "protocol.js");

const BANNER = [
  "// @ts-nocheck",
  "// Generated from packages/protocol/src by scripts/generate-protocol.mjs. Do not edit.",
  "// The bundler strips the JSDoc that types the canonical source, so this copy is not type-checked."
].join("\n");

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

function main() {
  const check = process.argv.includes("--check");
  const generated = buildGeneratedSource();

  if (check) {
    let current = "";
    try {
      current = readFileSync(OUTPUT_PATH, "utf8");
    } catch {
      current = "";
    }

    if (current !== generated) {
      process.stderr.write("generated/protocol.js is out of date. Run `npm run generate:protocol`.\n");
      process.exit(1);
    }

    process.stdout.write("generated/protocol.js is up to date.\n");
    return;
  }

  writeFileSync(OUTPUT_PATH, generated);
  process.stdout.write(`Wrote ${OUTPUT_PATH}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { OUTPUT_PATH };
