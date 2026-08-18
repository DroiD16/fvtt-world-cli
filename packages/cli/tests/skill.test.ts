import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CommanderError } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSkillsAddArguments, syncInstalledSkillCopies } from "../src/index.js";
import { createEmptyConfig } from "../src/config.js";
import { createInMemoryConfigStore, createWritableBuffer, runCommand } from "./helpers/cli-harness.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fvtt-world-cli commands", () => {
  describe("skill commands", () => {
    it("skill install copies the packaged skill into an explicit --to root, records it, and is idempotent", async () => {
      const root = mkdtempSync(join(tmpdir(), "fvtt-skill-"));
      const configStore = createInMemoryConfigStore();
      try {
        const first = await runCommand(
          ["--json", "skill", "install", "--to", join(root, "skills")],
          undefined,
          {
            configStore
          }
        );
        expect(first.error).toBeNull();
        const firstEnvelope = JSON.parse(first.stdout);
        expect(firstEnvelope.ok).toBe(true);
        expect(firstEnvelope.result.skill).toBe("foundry-world-editor");
        expect(firstEnvelope.result.installs).toEqual([
          { path: join(root, "skills", "foundry-world-editor"), action: "installed" }
        ]);
        const installed = readFileSync(join(root, "skills", "foundry-world-editor", "SKILL.md"), "utf8");
        expect(installed).toContain("name: foundry-world-editor");
        expect(configStore.readConfig()?.skillInstalls).toEqual([join(root, "skills")]);

        const second = await runCommand(
          ["--json", "skill", "install", "--to", join(root, "skills")],
          undefined,
          {
            configStore
          }
        );
        expect(second.error).toBeNull();
        expect(JSON.parse(second.stdout).result.installs[0].action).toBe("up-to-date");
        expect(configStore.readConfig()?.skillInstalls).toEqual([join(root, "skills")]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("skill install refuses to replace a differing installation without --force", async () => {
      const root = mkdtempSync(join(tmpdir(), "fvtt-skill-"));
      const configStore = createInMemoryConfigStore();
      try {
        await runCommand(["skill", "install", "--to", join(root, "skills")], undefined, { configStore });
        appendFileSync(join(root, "skills", "foundry-world-editor", "SKILL.md"), "local edit\n");

        const skipped = await runCommand(
          ["--json", "skill", "install", "--to", join(root, "skills")],
          undefined,
          {
            configStore
          }
        );
        expect(skipped.error).toBeNull();
        expect(JSON.parse(skipped.stdout).result.installs[0].action).toBe("skipped");
        expect(skipped.stderr).toContain("--force");
        expect(readFileSync(join(root, "skills", "foundry-world-editor", "SKILL.md"), "utf8")).toContain(
          "local edit"
        );

        const forced = await runCommand(
          ["--json", "skill", "install", "--to", join(root, "skills"), "--force"],
          undefined,
          { configStore }
        );
        expect(forced.error).toBeNull();
        expect(JSON.parse(forced.stdout).result.installs[0].action).toBe("replaced");
        expect(readFileSync(join(root, "skills", "foundry-world-editor", "SKILL.md"), "utf8")).not.toContain(
          "local edit"
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("skill install --link symlinks the skill and reports it up to date afterwards", async () => {
      const root = mkdtempSync(join(tmpdir(), "fvtt-skill-"));
      const configStore = createInMemoryConfigStore();
      try {
        const linked = await runCommand(
          ["--json", "skill", "install", "--to", join(root, "skills"), "--link"],
          undefined,
          {
            configStore
          }
        );
        expect(linked.error).toBeNull();
        expect(JSON.parse(linked.stdout).result.installs[0].action).toBe("installed");
        expect(lstatSync(join(root, "skills", "foundry-world-editor")).isSymbolicLink()).toBe(true);

        const again = await runCommand(
          ["--json", "skill", "install", "--to", join(root, "skills"), "--link"],
          undefined,
          {
            configStore
          }
        );
        expect(again.error).toBeNull();
        expect(JSON.parse(again.stdout).result.installs[0].action).toBe("up-to-date");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("skill install without --to delegates to the skills CLI in its native canonical-copy mode", async () => {
      const runSkillsCli = vi.fn((_args: string[]) => ({ status: 0 }));
      const result = await runCommand(["skill", "install"], undefined, { runSkillsCli });

      expect(result.error).toBeNull();
      expect(runSkillsCli).toHaveBeenCalledTimes(1);
      const args = runSkillsCli.mock.calls[0][0];
      expect(args).toEqual(["add", expect.stringMatching(/skills$/), "-g", "-y"]);
      expect(buildSkillsAddArguments("/x/skills")).toEqual(["add", "/x/skills", "-g", "-y"]);
      expect(readFileSync(join(args[1], "foundry-world-editor", "SKILL.md"), "utf8")).toContain(
        "name: foundry-world-editor"
      );
    });

    it("skill install rejects --link without --to", async () => {
      const runSkillsCli = vi.fn((_args: string[]) => ({ status: 0 }));
      const result = await runCommand(["skill", "install", "--link"], undefined, { runSkillsCli });

      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).message).toContain("--link requires --to");
      expect(runSkillsCli).not.toHaveBeenCalled();
    });

    it("skill install surfaces a failed skills CLI delegation with the --to fallback hint", async () => {
      const runSkillsCli = vi.fn(() => ({ status: 7 }));
      const result = await runCommand(["skill", "install"], undefined, { runSkillsCli });

      expect(result.error).toBeInstanceOf(CommanderError);
      expect((result.error as CommanderError).message).toContain("exit 7");
      expect((result.error as CommanderError).message).toContain("--to");
    });

    it("skill install rejects --json without --to", async () => {
      const runSkillsCli = vi.fn(() => ({ status: 0 }));
      const result = await runCommand(["--json", "skill", "install"], undefined, { runSkillsCli });

      expect(result.error).toBeInstanceOf(CommanderError);
      expect(runSkillsCli).not.toHaveBeenCalled();
    });

    it("ships SKILL.md.sha256 matching the packaged SKILL.md", () => {
      const packagedSkillDir = fileURLToPath(
        new URL("../../../skills/foundry-world-editor/", import.meta.url)
      );
      const digest = createHash("sha256")
        .update(readFileSync(join(packagedSkillDir, "SKILL.md")))
        .digest("hex");
      expect(readFileSync(join(packagedSkillDir, "SKILL.md.sha256"), "utf8").trim()).toBe(digest);
    });

    it("skill update --to replaces a pristine outdated copy and guards a modified one", async () => {
      const root = mkdtempSync(join(tmpdir(), "fvtt-skill-"));
      const configStore = createInMemoryConfigStore();
      try {
        const missing = await runCommand(["--json", "skill", "update", "--to", join(root, "skills")]);
        expect(missing.error).toBeNull();
        expect(JSON.parse(missing.stdout).result.updates[0].action).toBe("not-installed");

        await runCommand(["skill", "install", "--to", join(root, "skills")], undefined, { configStore });
        const fresh = await runCommand(["--json", "skill", "update", "--to", join(root, "skills")]);
        expect(JSON.parse(fresh.stdout).result.updates[0].action).toBe("up-to-date");

        const installedSkillMd = join(root, "skills", "foundry-world-editor", "SKILL.md");
        writeFileSync(installedSkillMd, "old pristine version\n");
        writeFileSync(
          join(root, "skills", "foundry-world-editor", "SKILL.md.sha256"),
          `${createHash("sha256").update("old pristine version\n").digest("hex")}\n`
        );
        const pristine = await runCommand(["--json", "skill", "update", "--to", join(root, "skills")]);
        expect(JSON.parse(pristine.stdout).result.updates[0].action).toBe("updated");
        expect(readFileSync(installedSkillMd, "utf8")).toContain("name: foundry-world-editor");

        appendFileSync(installedSkillMd, "user edit\n");
        const modified = await runCommand(["--json", "skill", "update", "--to", join(root, "skills")]);
        expect(JSON.parse(modified.stdout).result.updates[0].action).toBe("skipped");
        expect(modified.stderr).toContain("--force");
        expect(readFileSync(installedSkillMd, "utf8")).toContain("user edit");

        const forced = await runCommand([
          "--json",
          "skill",
          "update",
          "--to",
          join(root, "skills"),
          "--force"
        ]);
        expect(JSON.parse(forced.stdout).result.updates[0].action).toBe("updated");
        expect(readFileSync(installedSkillMd, "utf8")).not.toContain("user edit");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("skill update without --to delegates and sweeps recorded copies, honoring the modification guard", async () => {
      const home = mkdtempSync(join(tmpdir(), "fvtt-home-"));
      const recordedRoot = mkdtempSync(join(tmpdir(), "fvtt-skill-"));
      try {
        const env = { HOME: home } as NodeJS.ProcessEnv;
        const configStore = createInMemoryConfigStore({
          ...createEmptyConfig(),
          skillInstalls: [recordedRoot]
        });
        const cleanRun = vi.fn((_args: string[]) => ({ status: 0 }));
        const clean = await runCommand(["skill", "update"], undefined, {
          runSkillsCli: cleanRun,
          env,
          configStore
        });
        expect(clean.error).toBeNull();
        expect(cleanRun.mock.calls[0][0]).toEqual(["add", expect.stringMatching(/skills$/), "-g", "-y"]);

        mkdirSync(join(recordedRoot, "foundry-world-editor"), { recursive: true });
        writeFileSync(join(recordedRoot, "foundry-world-editor", "SKILL.md"), "old pristine\n");
        writeFileSync(
          join(recordedRoot, "foundry-world-editor", "SKILL.md.sha256"),
          `${createHash("sha256").update("old pristine\n").digest("hex")}\n`
        );
        const sweepRun = vi.fn((_args: string[]) => ({ status: 0 }));
        const swept = await runCommand(["skill", "update"], undefined, {
          runSkillsCli: sweepRun,
          env,
          configStore
        });
        expect(swept.error).toBeNull();
        expect(swept.stdout).toContain(`updated\t${join(recordedRoot, "foundry-world-editor")}`);
        expect(readFileSync(join(recordedRoot, "foundry-world-editor", "SKILL.md"), "utf8")).toContain(
          "name: foundry-world-editor"
        );

        const standardCopy = join(home, ".agents", "skills", "foundry-world-editor");
        mkdirSync(standardCopy, { recursive: true });
        writeFileSync(join(standardCopy, "SKILL.md"), "locally changed\n");
        writeFileSync(join(standardCopy, "SKILL.md.sha256"), "not-the-digest\n");
        const blockedRun = vi.fn((_args: string[]) => ({ status: 0 }));
        const blocked = await runCommand(["skill", "update"], undefined, {
          runSkillsCli: blockedRun,
          env,
          configStore
        });
        expect(blocked.error).toBeInstanceOf(CommanderError);
        expect((blocked.error as CommanderError).message).toContain("--force");
        expect(blockedRun).not.toHaveBeenCalled();

        const forcedRun = vi.fn((_args: string[]) => ({ status: 0 }));
        const forced = await runCommand(["skill", "update", "--force"], undefined, {
          runSkillsCli: forcedRun,
          env,
          configStore
        });
        expect(forced.error).toBeNull();
        expect(forcedRun).toHaveBeenCalledTimes(1);
        expect(readFileSync(join(standardCopy, "SKILL.md"), "utf8")).toContain("name: foundry-world-editor");
      } finally {
        rmSync(home, { recursive: true, force: true });
        rmSync(recordedRoot, { recursive: true, force: true });
      }
    });

    it("skill remove --to deletes that installation and clears its manifest record", async () => {
      const root = mkdtempSync(join(tmpdir(), "fvtt-skill-"));
      const configStore = createInMemoryConfigStore();
      try {
        await runCommand(["skill", "install", "--to", join(root, "skills")], undefined, { configStore });
        expect(configStore.readConfig()?.skillInstalls).toEqual([join(root, "skills")]);

        const removed = await runCommand(
          ["--json", "skill", "remove", "--to", join(root, "skills")],
          undefined,
          {
            configStore
          }
        );
        expect(removed.error).toBeNull();
        expect(JSON.parse(removed.stdout).result.removals[0].action).toBe("removed");
        expect(() => lstatSync(join(root, "skills", "foundry-world-editor"))).toThrow();
        expect(configStore.readConfig()?.skillInstalls).toBeUndefined();

        const again = await runCommand(
          ["--json", "skill", "remove", "--to", join(root, "skills")],
          undefined,
          {
            configStore
          }
        );
        expect(JSON.parse(again.stdout).result.removals[0].action).toBe("not-installed");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("skill remove without --to delegates and also removes recorded copies", async () => {
      const recordedRoot = mkdtempSync(join(tmpdir(), "fvtt-skill-"));
      try {
        const configStore = createInMemoryConfigStore({
          ...createEmptyConfig(),
          skillInstalls: [recordedRoot]
        });
        mkdirSync(join(recordedRoot, "foundry-world-editor"), { recursive: true });
        writeFileSync(join(recordedRoot, "foundry-world-editor", "SKILL.md"), "anything\n");

        const runSkillsCli = vi.fn((_args: string[]) => ({ status: 0 }));
        const result = await runCommand(["skill", "remove"], undefined, { runSkillsCli, configStore });

        expect(result.error).toBeNull();
        expect(runSkillsCli).toHaveBeenCalledWith(["remove", "foundry-world-editor", "-g", "-y"]);
        expect(() => lstatSync(join(recordedRoot, "foundry-world-editor"))).toThrow();
        expect(configStore.readConfig()?.skillInstalls).toBeUndefined();
      } finally {
        rmSync(recordedRoot, { recursive: true, force: true });
      }
    });

    it("the postinstall sync script checks the canonical location plus the recorded manifest roots", () => {
      const home = mkdtempSync(join(tmpdir(), "fvtt-home-"));
      const recordedRoot = mkdtempSync(join(tmpdir(), "fvtt-skill-"));
      try {
        const stale = (destination: string) => {
          mkdirSync(destination, { recursive: true });
          writeFileSync(join(destination, "SKILL.md"), "old pristine\n");
          writeFileSync(
            join(destination, "SKILL.md.sha256"),
            `${createHash("sha256").update("old pristine\n").digest("hex")}\n`
          );
        };
        const canonicalCopy = join(home, ".agents", "skills", "foundry-world-editor");
        const recordedCopy = join(recordedRoot, "foundry-world-editor");
        stale(canonicalCopy);
        stale(recordedCopy);
        mkdirSync(join(home, ".config", "fvtt-world-cli"), { recursive: true });
        writeFileSync(
          join(home, ".config", "fvtt-world-cli", "config.json"),
          JSON.stringify({ skillInstalls: [recordedRoot] })
        );
        const script = fileURLToPath(new URL("../bin/sync-installed-skill.mjs", import.meta.url));
        const environment = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") };

        const first = spawnSync(process.execPath, [script], { env: environment, encoding: "utf8" });
        expect(first.status).toBe(0);
        expect(readFileSync(join(canonicalCopy, "SKILL.md"), "utf8")).toContain("name: foundry-world-editor");
        expect(readFileSync(join(recordedCopy, "SKILL.md"), "utf8")).toContain("name: foundry-world-editor");

        appendFileSync(join(recordedCopy, "SKILL.md"), "user edit\n");
        const second = spawnSync(process.execPath, [script], { env: environment, encoding: "utf8" });
        expect(second.status).toBe(0);
        expect(second.stderr).toContain("NOT updated");
        expect(readFileSync(join(recordedCopy, "SKILL.md"), "utf8")).toContain("user edit");
      } finally {
        rmSync(home, { recursive: true, force: true });
        rmSync(recordedRoot, { recursive: true, force: true });
      }
    });

    it("syncInstalledSkillCopies updates the canonical and recorded pristine copies and warns about modified ones", () => {
      const home = mkdtempSync(join(tmpdir(), "fvtt-home-"));
      const recordedRoot = mkdtempSync(join(tmpdir(), "fvtt-skill-"));
      try {
        const stale = (destination: string) => {
          mkdirSync(destination, { recursive: true });
          writeFileSync(join(destination, "SKILL.md"), "old pristine\n");
          writeFileSync(
            join(destination, "SKILL.md.sha256"),
            `${createHash("sha256").update("old pristine\n").digest("hex")}\n`
          );
        };
        const canonicalCopy = join(home, ".agents", "skills", "foundry-world-editor");
        const recordedCopy = join(recordedRoot, "foundry-world-editor");
        stale(canonicalCopy);
        stale(recordedCopy);
        const configStore = createInMemoryConfigStore({
          ...createEmptyConfig(),
          skillInstalls: [recordedRoot]
        });
        const env = { HOME: home } as NodeJS.ProcessEnv;

        const updatedStderr = createWritableBuffer();
        syncInstalledSkillCopies({ stderr: updatedStderr, env, configStore });
        expect(readFileSync(join(canonicalCopy, "SKILL.md"), "utf8")).toContain("name: foundry-world-editor");
        expect(readFileSync(join(recordedCopy, "SKILL.md"), "utf8")).toContain("name: foundry-world-editor");
        expect(updatedStderr.read()).toContain(recordedCopy);

        appendFileSync(join(recordedCopy, "SKILL.md"), "user edit\n");
        const warnedStderr = createWritableBuffer();
        syncInstalledSkillCopies({ stderr: warnedStderr, env, configStore });
        expect(warnedStderr.read()).toContain("NOT updated");
        expect(readFileSync(join(recordedCopy, "SKILL.md"), "utf8")).toContain("user edit");
      } finally {
        rmSync(home, { recursive: true, force: true });
        rmSync(recordedRoot, { recursive: true, force: true });
      }
    });
  });
});
