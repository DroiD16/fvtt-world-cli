import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const dryRun = process.argv.includes("--dry-run");
const token = process.env.FOUNDRY_RELEASE_TOKEN;
if (!token) {
  fail("FOUNDRY_RELEASE_TOKEN is not set.");
}

const version = readJson(join(repositoryRoot, "package.json")).version;
const moduleManifest = readJson(join(repositoryRoot, "packages", "foundry-module", "module.json"));
if (moduleManifest.version !== version) {
  fail(`module.json version is ${moduleManifest.version}, expected ${version}.`);
}

const expectedDownloadUrl = `${moduleManifest.url}/releases/download/${version}/fvtt-world-cli.zip`;
if (moduleManifest.download !== expectedDownloadUrl) {
  fail(`module.json download is ${moduleManifest.download}, expected ${expectedDownloadUrl}.`);
}

const requestBody = {
  id: moduleManifest.id,
  ...(dryRun ? { "dry-run": true } : {}),
  release: {
    version,
    manifest: `${moduleManifest.url}/releases/download/${version}/module.json`,
    notes: `${moduleManifest.url}/releases/tag/${version}`,
    compatibility: moduleManifest.compatibility
  }
};

const response = await fetch("https://foundryvtt.com/_api/packages/release_version/", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: token },
  body: JSON.stringify(requestBody)
});
const responseText = await response.text();
if (!response.ok) {
  fail(`Foundry release API responded ${response.status}:\n${responseText}`);
}
console.log(
  `${dryRun ? "Dry run accepted for" : "Published"} ${moduleManifest.id} ${version}.\n${responseText}`
);
