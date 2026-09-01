import type { RegistrationContext } from "./shared.js";
import { executeRemoteCommand } from "../exec.js";
import { parseBoolean } from "../parse.js";

export function registerGame({ program, dependencies }: RegistrationContext) {
  const game = program.command("game").description("Foundry game-state commands");
  game.addHelpText(
    "after",
    "\nResult key (--json): .result.paused, .result.previousPaused and .result.changed (pause)."
  );
  game
    .command("pause")
    .description("Pause or unpause the game for every connected client")
    .requiredOption("--paused <paused>", "Target pause state (true|false)", parseBoolean)
    .action(async function pauseGame(options: { paused: boolean }) {
      await executeRemoteCommand({
        commandName: "game.pause",
        params: { paused: options.paused },
        command: this,
        dependencies
      });
    });
}
