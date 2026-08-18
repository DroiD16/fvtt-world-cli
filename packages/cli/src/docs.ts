import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveDocsDirectory(): string | null {
  // The candidates below are relative to this module's directory: keep this module directly under src/.
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(moduleDirectory, "../docs"), resolve(moduleDirectory, "../../../docs")]) {
    try {
      if (statSync(resolve(candidate, "commands.md")).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export function listDocEntries(docsDirectory: string) {
  return readdirSync(docsDirectory)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => {
      const title =
        readFileSync(resolve(docsDirectory, file), "utf8")
          .match(/^#\s+(.+)$/m)?.[1]
          ?.trim() ?? "";
      return { name: file.slice(0, -".md".length).toLowerCase(), file, title };
    });
}
