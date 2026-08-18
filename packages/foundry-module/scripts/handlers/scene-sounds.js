import { ERROR_CODES } from "../generated/protocol.js";
import { serializeSound, serializeSoundSummary } from "../lib/serializers.js";
import { createScenePlaceableHandlers } from "./scene-placeables.js";

export function createSceneSoundHandlers() {
  return createScenePlaceableHandlers({
    type: "AmbientSound",
    prefix: "scene.sound",
    idField: "soundId",
    resultKey: "sound",
    pluralKey: "sounds",
    notFoundCode: ERROR_CODES.SOUND_NOT_FOUND,
    serialize: (document) => serializeSound(document),
    serializeSummary: (document) => serializeSoundSummary(document)
  });
}
