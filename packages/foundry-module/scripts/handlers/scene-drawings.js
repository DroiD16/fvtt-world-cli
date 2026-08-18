import { ERROR_CODES } from "../generated/protocol.js";
import { placeableName, serializeDrawing, serializeDrawingSummary } from "../lib/serializers.js";
import { createScenePlaceableHandlers } from "./scene-placeables.js";

export function createSceneDrawingHandlers() {
  return createScenePlaceableHandlers({
    type: "Drawing",
    prefix: "scene.drawing",
    idField: "drawingId",
    resultKey: "drawing",
    pluralKey: "drawings",
    notFoundCode: ERROR_CODES.DRAWING_NOT_FOUND,
    serialize: (document) => serializeDrawing(document),
    serializeSummary: (document) => serializeDrawingSummary(document),
    summarize: (document) => ({ name: placeableName(document) })
  });
}
