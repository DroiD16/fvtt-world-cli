import {
  RENDERED_IMAGE_FORMATS,
  RENDERED_IMAGE_MAX_DIMENSION,
  RENDERED_IMAGE_MIN_DIMENSION
} from "../constants.js";
import { cmd } from "./shared.js";

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
    properties: {
      x: { type: "number" },
      y: { type: "number" },
      scale: { type: "number" },
      fit: { type: "boolean", const: true }
    },
    additionalProperties: false,
    minProperties: 1
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
