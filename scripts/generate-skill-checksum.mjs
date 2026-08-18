import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const skillDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "foundry-world-editor");
const digest = createHash("sha256")
  .update(readFileSync(join(skillDirectory, "SKILL.md")))
  .digest("hex");
const checksumPath = join(skillDirectory, "SKILL.md.sha256");

if (process.argv.includes("--check")) {
  const stored = readFileSync(checksumPath, "utf8").trim();
  if (stored !== digest) {
    console.error(`SKILL.md.sha256 is stale: run \`npm run generate:skill-checksum\`.`);
    process.exit(1);
  }
  console.log("SKILL.md.sha256 is up to date.");
} else {
  writeFileSync(checksumPath, `${digest}\n`);
  console.log(`Wrote ${checksumPath}`);
}
