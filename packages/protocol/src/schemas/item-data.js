import { effectCreateSchema } from "./effect-data.js";
import { freeformObjectSchema, nullableStringSchema, patchFrom } from "./shared.js";

export const itemDataSchema = {
  type: "object",
  required: ["name", "type"],
  properties: {
    name: { type: "string", minLength: 1 },
    type: { type: "string", minLength: 1 },
    img: { type: "string", minLength: 1 },
    folder: nullableStringSchema,
    sort: { type: "number" },
    system: freeformObjectSchema,
    flags: freeformObjectSchema
  },
  additionalProperties: false
};

export const itemPatchSchema = patchFrom(itemDataSchema, { omit: ["type"] });

export const embeddedItemDataSchema = {
  type: "object",
  required: ["name", "type"],
  properties: {
    ...itemDataSchema.properties,
    effects: { type: "array", items: effectCreateSchema }
  },
  additionalProperties: false
};
