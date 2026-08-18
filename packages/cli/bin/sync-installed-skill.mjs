import { createHash } from "node:crypto";
import { cpSync, lstatSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "foundry-world-editor";

try {
  const binDirectory = dirname(fileURLToPath(import.meta.url));
  const sourceDirectory = [resolve(binDirectory, "../skills"), resolve(binDirectory, "../../../skills")]
    .map((candidate) => resolve(candidate, SKILL_NAME))
    .find((candidate) => {
      try {
        return statSync(join(candidate, "SKILL.md")).isFile();
      } catch {
        return false;
      }
    });
  if (!sourceDirectory) process.exit(0);
  const packaged = readFileSync(join(sourceDirectory, "SKILL.md"), "utf8");

  const home = process.env.HOME?.trim() || homedir();
  const xdgHome = process.env.XDG_CONFIG_HOME?.trim();
  const configPath = xdgHome
    ? join(xdgHome, "fvtt-world-cli", "config.json")
    : platform() === "darwin"
      ? join(home, "Library", "Application Support", "fvtt-world-cli", "config.json")
      : platform() === "win32"
        ? join(
            process.env.APPDATA?.trim() || join(home, "AppData", "Roaming"),
            "fvtt-world-cli",
            "config.json"
          )
        : join(home, ".config", "fvtt-world-cli", "config.json");

  const roots = new Set([join(home, ".agents", "skills")]);
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    if (Array.isArray(config?.skillInstalls)) {
      for (const root of config.skillInstalls) {
        if (typeof root === "string" && root.length > 0) roots.add(root);
      }
    }
  } catch {
    // no or unreadable config: the standard location is still checked
  }

  for (const root of roots) {
    try {
      const destination = join(root, SKILL_NAME);
      const existing = (() => {
        try {
          return lstatSync(destination);
        } catch {
          return null;
        }
      })();
      if (!existing || existing.isSymbolicLink()) continue;

      const installed = readFileSync(join(destination, "SKILL.md"), "utf8");
      if (installed === packaged) continue;

      const recorded = (() => {
        try {
          return readFileSync(join(destination, "SKILL.md.sha256"), "utf8").trim();
        } catch {
          return null;
        }
      })();

      if (recorded === createHash("sha256").update(installed).digest("hex")) {
        rmSync(destination, { recursive: true, force: true });
        cpSync(sourceDirectory, destination, { recursive: true });
        console.error(
          `fvtt-world-cli: updated the installed agent skill at ${destination} to the packaged version.`
        );
      } else {
        console.error(
          `fvtt-world-cli: the installed agent skill at ${destination} has local modifications and was NOT updated. Compare them, then run \`fvtt-world-cli skill update --force\` to replace it.`
        );
      }
    } catch {
      continue;
    }
  }
} catch {
  process.exit(0);
}
