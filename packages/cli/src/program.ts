import { Command, Option } from "commander";

import { registerActor } from "./commands/actor.js";
import { registerAuth } from "./commands/auth.js";
import { registerBridge } from "./commands/bridge.js";
import { registerCards } from "./commands/cards.js";
import { registerChat } from "./commands/chat.js";
import { registerCombat } from "./commands/combat.js";
import { registerCompendium } from "./commands/compendium.js";
import { registerConfig } from "./commands/config.js";
import { registerDiscovery } from "./commands/discovery.js";
import { registerExec } from "./commands/exec.js";
import { registerFile } from "./commands/file.js";
import { registerFolder } from "./commands/folder.js";
import { registerItem } from "./commands/item.js";
import { registerJournal } from "./commands/journal.js";
import { registerMacro } from "./commands/macro.js";
import { registerPlaylist } from "./commands/playlist.js";
import { registerScene } from "./commands/scene.js";
import { registerSetting } from "./commands/setting.js";
import { registerSkill } from "./commands/skill.js";
import { registerSystem } from "./commands/system.js";
import { registerTable } from "./commands/table.js";
import { registerUser } from "./commands/user.js";
import { registerWorld } from "./commands/world.js";
import {
  type CliDependencies,
  applyExitOverride,
  applyOutputRouting,
  resolveCliVersion,
  resolveDependencies
} from "./deps.js";
import { parsePositiveInt } from "./parse.js";

export function createProgram(partialDependencies: Partial<CliDependencies> = {}) {
  const dependencies = resolveDependencies(partialDependencies);
  const program = new Command();

  program
    .name("fvtt-world-cli")
    // Print "fvtt-world-cli <version>" (name + version, parseable) on --version, then exit 0
    // via commander's version handling. stdout only; routed through applyOutputRouting.
    .version(`fvtt-world-cli ${resolveCliVersion()}`, "--version", "Print the CLI version and exit")
    .showHelpAfterError()
    .option("--daemon-url <url>", "Daemon WebSocket URL")
    .option("--json", "Print raw protocol responses as JSON", false)
    .option(
      "--dry-run",
      "Preview a mutation without persisting it (validates, resolves the target, runs all guards). Ignored for read commands.",
      false
    )
    .addOption(
      new Option(
        "--timeout-ms <ms>",
        "Client wait for the daemon response, in ms (default 60000). Distinct from bridge serve --request-timeout-ms."
      ).argParser(parsePositiveInt)
    );

  program.addHelpText(
    "after",
    [
      "",
      "Output contract (--json):",
      "  Every command response is wrapped in { ok, result } (or { ok:false, error }) — including the",
      "  local `commands`/`schema` discovery commands. (The local `config` commands print a raw config",
      "  payload directly, not the envelope.) The document(s) live under a TYPE-NAMED key inside .result",
      "  — e.g. .result.actor, .result.item, .result.journal, .result.scene, .result.foundry.* (system",
      "  info) — not directly on .result. Lists use the plural key (.result.actors[], .result.items[])",
      "  plus total/hasMore. A --dry-run returns the merged/would-be document under the SAME key, with",
      "  .result.dryRun:true (no separate `preview`, no current-state echo). Full key map:",
      "  docs/commands.md#json-output."
    ].join("\n")
  );

  registerConfig({ program, dependencies });
  registerAuth({ program, dependencies });
  registerBridge({ program, dependencies });
  registerDiscovery({ program, dependencies });
  registerSkill({ program, dependencies });
  registerExec({ program, dependencies });
  registerSystem({ program, dependencies });
  registerWorld({ program, dependencies });
  registerScene({ program, dependencies });
  registerItem({ program, dependencies });
  registerJournal({ program, dependencies });
  registerMacro({ program, dependencies });
  registerPlaylist({ program, dependencies });
  registerTable({ program, dependencies });
  registerCards({ program, dependencies });
  registerCombat({ program, dependencies });
  registerChat({ program, dependencies });
  registerActor({ program, dependencies });
  registerUser({ program, dependencies });
  registerSetting({ program, dependencies });
  registerCompendium({ program, dependencies });
  registerFolder({ program, dependencies });
  registerFile({ program, dependencies });

  applyOutputRouting(program, dependencies);
  applyExitOverride(program);

  return program;
}
