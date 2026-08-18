import {
  cmd,
  compendiumIncludeProperty,
  nameFilterProperty,
  paginatedListSchema,
  paginationProperties
} from "./shared.js";

export const compendiumCommands = {
  "compendium.list": cmd(paginatedListSchema),
  "compendium.index": cmd({
    type: "object",
    required: ["pack"],
    properties: {
      pack: { type: "string", minLength: 1 },
      ...nameFilterProperty,

      exact: { type: "boolean" },
      fields: { type: "array", items: { type: "string" } },
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "compendium.get": cmd({
    type: "object",
    required: ["pack", "entryId"],
    properties: {
      pack: { type: "string", minLength: 1 },
      entryId: { type: "string", minLength: 1 },
      ...compendiumIncludeProperty
    },
    additionalProperties: false
  })
};
