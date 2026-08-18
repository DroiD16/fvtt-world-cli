import { ERROR_CODES } from "../generated/protocol.js";
import { serializeTile, serializeTileSummary } from "../lib/serializers.js";
import { createScenePlaceableHandlers } from "./scene-placeables.js";

export function createSceneTileHandlers() {
  return createScenePlaceableHandlers({
    type: "Tile",
    prefix: "scene.tile",
    idField: "tileId",
    resultKey: "tile",
    pluralKey: "tiles",
    notFoundCode: ERROR_CODES.TILE_NOT_FOUND,
    serialize: (document) => serializeTile(document),
    serializeSummary: (document) => serializeTileSummary(document)
  });
}
