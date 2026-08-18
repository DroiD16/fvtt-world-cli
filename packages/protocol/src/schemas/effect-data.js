import { freeformObjectSchema, nullableStringSchema } from "./shared.js";

const effectWriteProperties = {
  name: { type: "string", minLength: 1 },
  type: { type: "string", minLength: 1 },
  img: { type: "string", minLength: 1 },
  origin: nullableStringSchema,
  disabled: { type: "boolean" },
  transfer: { type: "boolean" },
  duration: freeformObjectSchema,
  changes: { type: "array", items: freeformObjectSchema },
  statuses: { type: "array", items: { type: "string", minLength: 1 } },
  tint: { type: "string", minLength: 1 },
  description: { type: "string" },
  sort: { type: "number" },
  system: freeformObjectSchema,
  flags: freeformObjectSchema
};

export const effectCreateSchema = {
  type: "object",
  required: ["name"],
  properties: effectWriteProperties,
  additionalProperties: true
};

export const effectPatchSchema = {
  type: "object",
  required: [],
  properties: effectWriteProperties,
  additionalProperties: true,
  minProperties: 1
};
