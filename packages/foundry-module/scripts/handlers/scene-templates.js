import { ERROR_CODES } from "../generated/protocol.js";
import { assertSceneTemplatesSupported } from "../lib/scene-embedded.js";
import { serializeMeasuredTemplate, serializeMeasuredTemplateSummary } from "../lib/serializers.js";
import { createScenePlaceableHandlers } from "./scene-placeables.js";

export function createSceneTemplateHandlers() {
  return createScenePlaceableHandlers({
    type: "MeasuredTemplate",
    prefix: "scene.template",
    idField: "templateId",
    resultKey: "template",
    pluralKey: "templates",
    notFoundCode: ERROR_CODES.TEMPLATE_NOT_FOUND,
    serialize: (document) => serializeMeasuredTemplate(document),
    serializeSummary: (document) => serializeMeasuredTemplateSummary(document),
    assertSupported: assertSceneTemplatesSupported
  });
}
