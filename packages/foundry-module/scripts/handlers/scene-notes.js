import { ERROR_CODES } from "../generated/protocol.js";
import { serializeNote, serializeNoteSummary } from "../lib/serializers.js";
import { createScenePlaceableHandlers } from "./scene-placeables.js";

export function createSceneNoteHandlers() {
  return createScenePlaceableHandlers({
    type: "Note",
    prefix: "scene.note",
    idField: "noteId",
    resultKey: "note",
    pluralKey: "notes",
    notFoundCode: ERROR_CODES.NOTE_NOT_FOUND,
    serialize: (document) => serializeNote(document),
    serializeSummary: (document) => serializeNoteSummary(document)
  });
}
