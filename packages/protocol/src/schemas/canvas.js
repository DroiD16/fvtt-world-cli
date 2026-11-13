import {
  RENDERED_IMAGE_FORMATS,
  RENDERED_IMAGE_MAX_DIMENSION,
  RENDERED_IMAGE_MIN_DIMENSION
} from "../constants.js";
import { cmd } from "./shared.js";

const panPositionProperties = {
  x: { type: "number" },
  y: { type: "number" },
  scale: { type: "number" }
};

const panFitProperty = { fit: { type: "boolean", const: true } };

export const canvasCommands = {
  "canvas.capture": cmd({
    type: "object",
    required: [],
    properties: {
      size: { type: "integer", minimum: RENDERED_IMAGE_MIN_DIMENSION, maximum: RENDERED_IMAGE_MAX_DIMENSION },
      format: { type: "string", enum: RENDERED_IMAGE_FORMATS }
    },
    additionalProperties: false
  }),
  "canvas.pan": cmd({
    type: "object",
    required: [],
    properties: { ...panPositionProperties, ...panFitProperty },
    additionalProperties: false,
    minProperties: 1,
    oneOf: [
      { type: "object", required: ["fit"], properties: panFitProperty, additionalProperties: false },
      { type: "object", required: [], properties: panPositionProperties, additionalProperties: false }
    ]
  }),
  "canvas.view-scene": cmd({
    type: "object",
    required: ["sceneId"],
    properties: {
      sceneId: { type: "string", minLength: 1 },
      levelId: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  })
};
