import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PROTOCOL_VERSION } from "../packages/protocol/src/index.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleDirectory = join(repositoryRoot, "packages", "foundry-module");
const cliDirectory = join(repositoryRoot, "packages", "cli");
const outputDirectory = join(repositoryRoot, "dist", "release");
const moduleZipAssets = ["module.json", "LICENSE", "languages", "scripts", "styles", "templates"];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const version = readJson(join(repositoryRoot, "package.json")).version;
const cliManifest = readJson(join(cliDirectory, "package.json"));
const moduleManifest = readJson(join(moduleDirectory, "module.json"));
const expectedDownloadUrl = `https://github.com/DroiD16/fvtt-world-cli/releases/download/${version}/fvtt-world-cli.zip`;

const versionFields = [
  ["packages/cli version", cliManifest.version],
  [
    "packages/protocol version",
    readJson(join(repositoryRoot, "packages", "protocol", "package.json")).version
  ],
  ["packages/foundry-module version", readJson(join(moduleDirectory, "package.json")).version],
  ["packages/cli @fvtt-world-cli/protocol pin", cliManifest.devDependencies["@fvtt-world-cli/protocol"]],
  ["module.json version", moduleManifest.version],
  ["shared protocol version", PROTOCOL_VERSION]
];
const mismatches = versionFields
  .filter(([, actual]) => actual !== version)
  .map(([label, actual]) => `${label} is ${actual}, expected ${version}`);
if (moduleManifest.download !== expectedDownloadUrl) {
  mismatches.push(`module.json download is ${moduleManifest.download}, expected ${expectedDownloadUrl}`);
}
if (mismatches.length > 0) {
  fail(`Version metadata is inconsistent:\n${mismatches.map((line) => `  - ${line}`).join("\n")}`);
}

const changelog = readFileSync(join(repositoryRoot, "CHANGELOG.md"), "utf8");
const escapedVersion = version.replaceAll(".", "\\.");
const headingMatch = changelog.match(new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m"));
if (!headingMatch) {
  fail(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section.`);
}
const bodyStart = headingMatch.index + headingMatch[0].length;
const nextHeading = changelog.indexOf("\n## [", bodyStart);
const releaseNotes = `${changelog.slice(bodyStart, nextHeading === -1 ? changelog.length : nextHeading).trim()}\n`;
if (releaseNotes === "\n") {
  fail(`CHANGELOG.md section for ${version} is empty.`);
}

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const stagingDirectory = mkdtempSync(join(tmpdir(), "fvtt-world-cli-release-"));
try {
  for (const asset of moduleZipAssets) {
    cpSync(join(moduleDirectory, asset), join(stagingDirectory, asset), { recursive: true });
  }
  try {
    execFileSync("zip", ["-q", "-r", "-X", join(outputDirectory, "fvtt-world-cli.zip"), ...moduleZipAssets], {
      cwd: stagingDirectory
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      fail("The zip utility is required to build the module archive.");
    }
    throw error;
  }
} finally {
  rmSync(stagingDirectory, { recursive: true, force: true });
}

copyFileSync(join(moduleDirectory, "module.json"), join(outputDirectory, "module.json"));
writeFileSync(join(outputDirectory, "release-notes.md"), releaseNotes);

execFileSync("npm", ["pack", "--pack-destination", outputDirectory], {
  cwd: cliDirectory,
  stdio: ["ignore", "ignore", "inherit"]
});
const tarballName = `fvtt-world-cli-${version}.tgz`;
if (!existsSync(join(outputDirectory, tarballName))) {
  fail(`npm pack did not produce ${tarballName}.`);
}

for (const name of ["fvtt-world-cli.zip", "module.json", tarballName, "release-notes.md"]) {
  const filePath = join(outputDirectory, name);
  const digest = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  console.log(`${digest}  ${name} (${statSync(filePath).size} bytes)`);
}
console.log(`Release ${version} artifacts written to ${outputDirectory}`);
