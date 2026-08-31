import { ERROR_CODES } from "../generated/protocol.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { createBridgeError } from "../lib/errors.js";
import { assertFoundryReady } from "../lib/validators.js";

export function createGameHandlers() {
  return {
    async "game.pause"(params) {
      const game = assertFoundryReady();
      const previousPaused = Boolean(game.paused);
      const requested = params.paused;

      if (isDryRun(params)) {
        return dryRunResponse({
          paused: requested,
          previousPaused,
          changed: previousPaused !== requested
        });
      }

      if (typeof game.togglePause !== "function") {
        throw createBridgeError(
          ERROR_CODES.BRIDGE_NOT_READY,
          "Foundry pause API (Game#togglePause) is not available; reload the GM client"
        );
      }

      game.togglePause(requested, { broadcast: true });
      const paused = Boolean(game.paused);
      if (paused !== requested) {
        throw createBridgeError(
          ERROR_CODES.INTERNAL_ERROR,
          `Foundry reports the game as ${paused ? "paused" : "running"} after being asked to ${
            requested ? "pause" : "resume"
          } it, so the request did not take effect. Re-read the state before retrying`,
          { requested, paused }
        );
      }

      return { paused, previousPaused, changed: previousPaused !== paused };
    }
  };
}
