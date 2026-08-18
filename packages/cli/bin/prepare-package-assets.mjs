import { cpSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageDirectory, "../..");
const assets = ["LICENSE", "README.md", "docs", "skills"];

const clean = process.argv.includes("--clean");

for (const asset of assets) {
  const destination = join(packageDirectory, asset);
  rmSync(destination, { recursive: true, force: true });
  if (clean) continue;

  const source = join(repositoryRoot, asset);
  if (!statSync(source, { throwIfNoEntry: false })) {
    console.error(`Missing ${source}; cannot package the ${asset} assets.`);
    process.exit(1);
  }
  cpSync(source, destination, { recursive: true });
}
