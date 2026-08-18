import { ERROR_CODES, FOG_RESET_CONFIRM_TIMEOUT_MS } from "../generated/protocol.js";
import { getSceneById } from "../lib/game-collections.js";
import {
  assertFogResetSupported,
  assertSceneViewed,
  confirmFogReset,
  getViewedSceneId,
  queryFogExplorationIds,
  resolveFogManager
} from "../lib/canvas.js";
import { createBridgeError } from "../lib/errors.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";

const FOG_RESET_ID_CAP = 100;

export function createSceneFogHandlers() {
  return {
    async "scene.fog.reset"(params) {
      const scene = getSceneById(params.sceneId);
      const sceneId = scene.id ?? params.sceneId;
      assertFogResetSupported();

      const snapshotIds = await queryFogExplorationIds(sceneId);

      if (isDryRun(params)) {
        return dryRunResponse({
          sceneId,
          reset: false,
          clearedCount: snapshotIds.length,

          confirmation: "not-dispatched",
          viewedSceneId: getViewedSceneId()
        });
      }

      assertSceneViewed(sceneId);
      const fog = resolveFogManager();

      const viewedSceneId = getViewedSceneId();

      try {
        await fog.reset();
      } catch (error) {
        const raw = /** @type {any} */ (error);
        throw createBridgeError(
          ERROR_CODES.INTERNAL_ERROR,
          `Foundry could not dispatch the fog reset for scene ${sceneId}: ${raw?.message ?? String(error)}. The reset request was NOT sent (Foundry's reset does nothing but emit the socket event), so nothing changed — retry once the GM client's socket is healthy`,
          { sceneId, dispatched: false, message: raw?.message ?? String(error) }
        );
      }

      const { confirmed, confirmation, remainingIds, elapsedMs, observedRemaining, queryError } =
        await confirmFogReset(sceneId, snapshotIds);
      if (!confirmed) {
        const observation = !observedRemaining
          ? `the confirmation query kept failing (${queryError}), so the fog state could not be observed at all — the ${snapshotIds.length} ids below are the PRE-RESET snapshot, not a measurement`
          : queryError
            ? `${remainingIds.length} of ${snapshotIds.length} FogExploration documents were still present at the last SUCCESSFUL check, and every later confirmation query failed (${queryError}), so the final state was never observed`
            : `${remainingIds.length} of ${snapshotIds.length} FogExploration documents were still present at the last check`;
        throw createBridgeError(
          ERROR_CODES.FOG_RESET_UNCONFIRMED,
          `The fog reset for scene ${sceneId} was dispatched but could not be confirmed within ${FOG_RESET_CONFIRM_TIMEOUT_MS}ms: ${observation}. The reset request WAS sent (Foundry's reset is an unacked socket event), so re-read the scene's fog state before retrying`,
          {
            sceneId,
            timeoutMs: FOG_RESET_CONFIRM_TIMEOUT_MS,
            elapsedMs,
            snapshotCount: snapshotIds.length,

            queryError: queryError ?? null,
            remaining: {
              count: remainingIds.length,
              ids: remainingIds.slice(0, FOG_RESET_ID_CAP),
              truncated: remainingIds.length > FOG_RESET_ID_CAP,

              observed: observedRemaining
            }
          }
        );
      }

      return {
        sceneId,

        reset: true,

        clearedCount: snapshotIds.length,

        confirmation,
        viewedSceneId
      };
    }
  };
}
