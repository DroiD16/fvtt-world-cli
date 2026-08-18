import { ERROR_CODES } from "../generated/protocol.js";
import { placeableName, serializeAmbientLight, serializeAmbientLightSummary } from "../lib/serializers.js";
import { createScenePlaceableHandlers } from "./scene-placeables.js";

export function createSceneLightHandlers() {
  return createScenePlaceableHandlers({
    type: "AmbientLight",
    prefix: "scene.light",
    idField: "lightId",
    resultKey: "light",
    pluralKey: "lights",
    notFoundCode: ERROR_CODES.LIGHT_NOT_FOUND,
    serialize: (document) => serializeAmbientLight(document),
    serializeSummary: (document) => serializeAmbientLightSummary(document),
    summarize: (document) => ({ name: placeableName(document) })
  });
}
