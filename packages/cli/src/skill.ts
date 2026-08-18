import { createHash } from "node:crypto";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Command, CommanderError } from "commander";

import { mergePersistedCliConfig } from "./config.js";
import { type CliDependencies, write } from "./deps.js";

export const SKILL_NAME = "foundry-world-editor";

export function resolveSkillSourceDirectory(): string | null {
  // The candidates below are relative to this module's directory: keep this module directly under src/.
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    resolve(moduleDirectory, "../skills"),
    resolve(moduleDirectory, "../../../skills")
  ]) {
    try {
      if (statSync(resolve(candidate, SKILL_NAME, "SKILL.md")).isFile())
        return resolve(candidate, SKILL_NAME);
    } catch {
      continue;
    }
  }
  return null;
}

export function buildSkillsAddArguments(skillsRootDirectory: string): string[] {
  return ["add", skillsRootDirectory, "-g", "-y"];
}

export function requireToForJson(command: Command) {
  if (Boolean(command.optsWithGlobals().json)) {
    throw new CommanderError(
      2,
      "fvtt-world-cli.skillJsonRequiresTo",
      "--json is available only with explicit --to targets; the default path delegates to the skills CLI, whose output is not enveloped."
    );
  }
}

export function throwIfSkillsCliFailed(outcome: { status: number | null; error?: Error }, operation: string) {
  if (outcome.error || outcome.status !== 0) {
    const reason = outcome.error
      ? ` (${outcome.error.message})`
      : outcome.status === null
        ? ""
        : ` (exit ${outcome.status})`;
    throw new CommanderError(
      1,
      "fvtt-world-cli.skillsCliFailed",
      `Delegated operation via \`${operation}\` failed${reason}. Pass --to <directory> to operate directly without the skills CLI.`
    );
  }
}

function skillDigest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function standardAgentsSkillsRoot(env: NodeJS.ProcessEnv): string {
  return join(env.HOME?.trim() || homedir(), ".agents", "skills");
}

type InstalledSkillState = "missing" | "linked" | "identical" | "pristine" | "modified";

export function inspectInstalledSkill(destination: string, sourceDirectory: string): InstalledSkillState {
  const existing = (() => {
    try {
      return lstatSync(destination);
    } catch {
      return null;
    }
  })();
  if (!existing) return "missing";
  if (existing.isSymbolicLink()) return "linked";

  let installed: string;
  try {
    installed = readFileSync(join(destination, "SKILL.md"), "utf8");
  } catch {
    return "modified";
  }
  if (installed === readFileSync(join(sourceDirectory, "SKILL.md"), "utf8")) return "identical";

  const recorded = (() => {
    try {
      return readFileSync(join(destination, "SKILL.md.sha256"), "utf8").trim();
    } catch {
      return null;
    }
  })();
  return recorded === skillDigest(installed) ? "pristine" : "modified";
}

export function updateSkillInRoot({
  sourceDirectory,
  skillsRoot,
  force
}: {
  sourceDirectory: string;
  skillsRoot: string;
  force: boolean;
}): { path: string; action: "updated" | "up-to-date" | "skipped" | "not-installed" } {
  const destination = join(skillsRoot, SKILL_NAME);
  const state = inspectInstalledSkill(destination, sourceDirectory);
  if (state === "missing") return { path: destination, action: "not-installed" };
  if (state === "linked" || state === "identical") return { path: destination, action: "up-to-date" };
  if (state === "modified" && !force) return { path: destination, action: "skipped" };
  rmSync(destination, { recursive: true, force: true });
  cpSync(sourceDirectory, destination, { recursive: true });
  return { path: destination, action: "updated" };
}

export function knownSkillRoots(dependencies: Pick<CliDependencies, "env" | "configStore">): string[] {
  const roots = new Set<string>([standardAgentsSkillsRoot(dependencies.env)]);
  try {
    for (const root of dependencies.configStore.readConfig()?.skillInstalls ?? []) {
      roots.add(root);
    }
  } catch {
    // an unreadable config must not disable the sync of the standard location
  }
  return [...roots];
}

export function recordSkillInstalls(
  dependencies: Pick<CliDependencies, "stderr" | "configStore">,
  roots: string[],
  { remove = false }: { remove?: boolean } = {}
): void {
  try {
    const existing = dependencies.configStore.readConfig();
    const current = new Set(existing?.skillInstalls ?? []);
    for (const root of roots) {
      if (remove) current.delete(root);
      else current.add(root);
    }
    const skillInstalls = [...current].sort();
    dependencies.configStore.writeConfig(
      mergePersistedCliConfig(
        existing,
        skillInstalls.length > 0 ? { skillInstalls } : { skillInstalls: undefined }
      )
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(dependencies.stderr, `Could not record the skill installation in the CLI config: ${message}\n`);
  }
}

export function syncInstalledSkillCopies(
  dependencies: Pick<CliDependencies, "stderr" | "env" | "configStore">
): void {
  try {
    const sourceDirectory = resolveSkillSourceDirectory();
    if (!sourceDirectory) return;
    for (const root of knownSkillRoots(dependencies)) {
      try {
        const destination = join(root, SKILL_NAME);
        const state = inspectInstalledSkill(destination, sourceDirectory);
        if (state === "pristine") {
          rmSync(destination, { recursive: true, force: true });
          cpSync(sourceDirectory, destination, { recursive: true });
          write(
            dependencies.stderr,
            `Updated the installed agent skill at ${destination} to the packaged version.\n`
          );
        } else if (state === "modified") {
          write(
            dependencies.stderr,
            `The installed agent skill at ${destination} has local modifications and was NOT updated to the packaged version. Compare them, then run \`fvtt-world-cli skill update --force\` to replace it.\n`
          );
        }
      } catch {
        continue;
      }
    }
  } catch {
    return;
  }
}

type SkillInstallAction = "installed" | "replaced" | "up-to-date" | "skipped";

export function installSkillIntoRoot({
  sourceDirectory,
  skillsRoot,
  link,
  force
}: {
  sourceDirectory: string;
  skillsRoot: string;
  link: boolean;
  force: boolean;
}): { path: string; action: SkillInstallAction } {
  const destination = join(skillsRoot, SKILL_NAME);

  const existing = (() => {
    try {
      return lstatSync(destination);
    } catch {
      return null;
    }
  })();

  if (existing) {
    const sameLink = existing.isSymbolicLink() && realpathSync(destination) === realpathSync(sourceDirectory);
    const sameCopy =
      !existing.isSymbolicLink() &&
      existing.isDirectory() &&
      (() => {
        try {
          return (
            readFileSync(join(destination, "SKILL.md"), "utf8") ===
            readFileSync(join(sourceDirectory, "SKILL.md"), "utf8")
          );
        } catch {
          return false;
        }
      })();

    if (link ? sameLink : sameCopy) {
      return { path: destination, action: "up-to-date" };
    }
    if (!force) {
      return { path: destination, action: "skipped" };
    }
    rmSync(destination, { recursive: true, force: true });
  }

  mkdirSync(skillsRoot, { recursive: true });
  if (link) {
    symlinkSync(sourceDirectory, destination, "dir");
  } else {
    cpSync(sourceDirectory, destination, { recursive: true });
  }
  return { path: destination, action: existing ? "replaced" : "installed" };
}
