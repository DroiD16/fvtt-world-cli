import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "../lib/errors.js";
import { assertLevelsSupported } from "../lib/scene-embedded.js";
import { serializeLevel, serializeLevelSummary } from "../lib/serializers.js";
import { createScenePlaceableHandlers } from "./scene-placeables.js";

function assertLevelsRemain(scene, ids) {
  const removed = new Set(ids.filter((id) => scene.levels.get(id)));
  if (removed.size === 0 || removed.size < scene.levels.size) return;
  throw createBridgeError(
    ERROR_CODES.DELETE_FORBIDDEN,
    `Refusing to delete every level of scene ${scene.id}: a Foundry scene must keep at least one level. Create the replacement level first with scene.level.create, or delete the whole scene with scene.delete. Nothing was deleted`,
    { sceneId: scene.id, levelIds: [...removed] }
  );
}

export function createSceneLevelHandlers() {
  return createScenePlaceableHandlers({
    type: "Level",
    prefix: "scene.level",
    idField: "levelId",
    resultKey: "level",
    pluralKey: "levels",
    notFoundCode: ERROR_CODES.LEVEL_NOT_FOUND,
    serialize: (document) => serializeLevel(document),
    serializeSummary: (document) => serializeLevelSummary(document),
    assertSupported: () => assertLevelsSupported({ family: "scene.level" }),
    assertDeleteAllowed: assertLevelsRemain,
    summarize: (document) => ({ name: document?.name ?? null })
  });
}
