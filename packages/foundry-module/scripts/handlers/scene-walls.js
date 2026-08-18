import { ERROR_CODES } from "../generated/protocol.js";
import { serializeWall, serializeWallSummary } from "../lib/serializers.js";
import { createScenePlaceableHandlers } from "./scene-placeables.js";

export function createSceneWallHandlers() {
  return createScenePlaceableHandlers({
    type: "Wall",
    prefix: "scene.wall",
    idField: "wallId",
    resultKey: "wall",
    pluralKey: "walls",
    notFoundCode: ERROR_CODES.WALL_NOT_FOUND,
    serialize: (document) => serializeWall(document),
    serializeSummary: (document) => serializeWallSummary(document),
    listFilter: (walls, params) =>
      params.door === true ? walls.filter((wall) => Number(wall.door ?? 0) > 0) : walls
  });
}
