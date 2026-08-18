import { lstatSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { Command, CommanderError } from "commander";

import type { RegistrationContext } from "./shared.js";
import {
  buildSkillsAddArguments,
  inspectInstalledSkill,
  installSkillIntoRoot,
  knownSkillRoots,
  recordSkillInstalls,
  requireToForJson,
  resolveSkillSourceDirectory,
  SKILL_NAME,
  throwIfSkillsCliFailed,
  updateSkillInRoot
} from "../skill.js";
import { localSuccessEnvelope } from "../errors.js";
import { write } from "../deps.js";

export function registerSkill({ program, dependencies }: RegistrationContext) {
  const skill = program.command("skill").description("Manage the agent skill shipped with the CLI");
  skill
    .command("install")
    .description(`Install the ${SKILL_NAME} Agent Skill into agent skill directories`)
    .option("--to <directory...>", "Copy into this skills directory instead of delegating to the skills CLI")
    .option("--link", "With --to, symlink the skill instead of copying it")
    .option("--force", "With --to, replace an existing installation whose content differs")
    .action(function installSkill(
      this: Command,
      options: { to?: string[]; link?: boolean; force?: boolean }
    ) {
      const sourceDirectory = resolveSkillSourceDirectory();
      if (!sourceDirectory) {
        throw new CommanderError(
          1,
          "fvtt-world-cli.skillUnavailable",
          "The packaged agent skill is not available in this installation."
        );
      }

      if (options.to?.length) {
        const targets = options.to.map((target) => resolve(target));
        const installs = targets.map((skillsRoot) =>
          installSkillIntoRoot({
            sourceDirectory,
            skillsRoot,
            link: Boolean(options.link),
            force: Boolean(options.force)
          })
        );
        recordSkillInstalls(dependencies, targets);

        if (Boolean(this.optsWithGlobals().json)) {
          write(
            dependencies.stdout,
            `${JSON.stringify(localSuccessEnvelope({ skill: SKILL_NAME, source: sourceDirectory, installs }), null, 2)}\n`
          );
        } else {
          write(dependencies.stdout, `source: ${sourceDirectory}\n`);
          write(
            dependencies.stdout,
            `${installs.map((entry) => `${entry.action}\t${entry.path}`).join("\n")}\n`
          );
        }

        if (installs.some((entry) => entry.action === "skipped")) {
          write(
            dependencies.stderr,
            "Some destinations already contain a different skill; re-run with --force to replace them.\n"
          );
        }
        return;
      }

      if (options.link) {
        throw new CommanderError(
          2,
          "fvtt-world-cli.skillLinkRequiresTo",
          "--link requires --to: the delegated installation already keeps one canonical copy that agents reach through symlinks."
        );
      }
      requireToForJson(this);

      const outcome = dependencies.runSkillsCli(buildSkillsAddArguments(dirname(sourceDirectory)));
      throwIfSkillsCliFailed(outcome, "npx skills add");
    });

  skill
    .command("update")
    .description(`Update installed copies of the ${SKILL_NAME} Agent Skill to the packaged version`)
    .option(
      "--to <directory...>",
      "Update only this skills directory instead of delegating to the skills CLI"
    )
    .option("--force", "Replace locally modified installations too")
    .action(function updateSkill(this: Command, options: { to?: string[]; force?: boolean }) {
      const sourceDirectory = resolveSkillSourceDirectory();
      if (!sourceDirectory) {
        throw new CommanderError(
          1,
          "fvtt-world-cli.skillUnavailable",
          "The packaged agent skill is not available in this installation."
        );
      }

      if (options.to?.length) {
        const updates = options.to
          .map((target) => resolve(target))
          .map((skillsRoot) =>
            updateSkillInRoot({ sourceDirectory, skillsRoot, force: Boolean(options.force) })
          );

        if (Boolean(this.optsWithGlobals().json)) {
          write(
            dependencies.stdout,
            `${JSON.stringify(localSuccessEnvelope({ skill: SKILL_NAME, source: sourceDirectory, updates }), null, 2)}\n`
          );
        } else {
          write(dependencies.stdout, `source: ${sourceDirectory}\n`);
          write(
            dependencies.stdout,
            `${updates.map((entry) => `${entry.action}\t${entry.path}`).join("\n")}\n`
          );
        }

        if (updates.some((entry) => entry.action === "skipped")) {
          write(
            dependencies.stderr,
            "Some installations have local modifications; re-run with --force to replace them.\n"
          );
        }
        return;
      }

      requireToForJson(this);

      const knownRoots = knownSkillRoots(dependencies);
      const modifiedCopies = knownRoots
        .map((root) => join(root, SKILL_NAME))
        .filter((destination) => inspectInstalledSkill(destination, sourceDirectory) === "modified");
      if (!options.force && modifiedCopies.length > 0) {
        throw new CommanderError(
          1,
          "fvtt-world-cli.skillModified",
          `Installed copies with local modifications would be overwritten by an update: ${modifiedCopies.join(", ")}. Compare them first, then re-run with --force.`
        );
      }

      const outcome = dependencies.runSkillsCli(buildSkillsAddArguments(dirname(sourceDirectory)));
      throwIfSkillsCliFailed(outcome, "npx skills add");

      const updates = knownRoots
        .map((skillsRoot) =>
          updateSkillInRoot({ sourceDirectory, skillsRoot, force: Boolean(options.force) })
        )
        .filter((entry) => entry.action === "updated");
      if (updates.length > 0) {
        write(
          dependencies.stdout,
          `${updates.map((entry) => `${entry.action}\t${entry.path}`).join("\n")}\n`
        );
      }
    });

  skill
    .command("remove")
    .description(`Remove installed copies of the ${SKILL_NAME} Agent Skill`)
    .option(
      "--to <directory...>",
      "Remove only from this skills directory instead of delegating to the skills CLI"
    )
    .action(function removeSkill(this: Command, options: { to?: string[] }) {
      const removeFromRoot = (skillsRoot: string) => {
        const destination = join(skillsRoot, SKILL_NAME);
        const exists = (() => {
          try {
            lstatSync(destination);
            return true;
          } catch {
            return false;
          }
        })();
        if (exists) rmSync(destination, { recursive: true, force: true });
        return { path: destination, action: exists ? "removed" : "not-installed" };
      };

      if (options.to?.length) {
        const targets = options.to.map((target) => resolve(target));
        const removals = targets.map(removeFromRoot);
        recordSkillInstalls(dependencies, targets, { remove: true });

        if (Boolean(this.optsWithGlobals().json)) {
          write(
            dependencies.stdout,
            `${JSON.stringify(localSuccessEnvelope({ skill: SKILL_NAME, removals }), null, 2)}\n`
          );
        } else {
          write(
            dependencies.stdout,
            `${removals.map((entry) => `${entry.action}\t${entry.path}`).join("\n")}\n`
          );
        }
        return;
      }

      requireToForJson(this);
      const outcome = dependencies.runSkillsCli(["remove", SKILL_NAME, "-g", "-y"]);
      throwIfSkillsCliFailed(outcome, "npx skills remove");

      const recordedRoots = (() => {
        try {
          return dependencies.configStore.readConfig()?.skillInstalls ?? [];
        } catch {
          return [];
        }
      })();
      if (recordedRoots.length > 0) {
        const removals = recordedRoots.map(removeFromRoot).filter((entry) => entry.action === "removed");
        recordSkillInstalls(dependencies, recordedRoots, { remove: true });
        if (removals.length > 0) {
          write(
            dependencies.stdout,
            `${removals.map((entry) => `${entry.action}\t${entry.path}`).join("\n")}\n`
          );
        }
      }
    });
}
