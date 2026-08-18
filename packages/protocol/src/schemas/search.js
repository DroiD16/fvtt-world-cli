import {
  SEARCH_INDEXED_TYPES,
  SEARCH_MODES,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
  SEARCH_RESULT_MAX_LIMIT,
  SEARCH_SOURCES
} from "../constants.js";
import { cmd } from "./shared.js";

const worldSearchSchema = {
  type: "object",
  required: ["query"],
  properties: {
    query: { type: "string", minLength: SEARCH_QUERY_MIN_LENGTH, maxLength: SEARCH_QUERY_MAX_LENGTH },
    mode: { type: "string", enum: [...SEARCH_MODES] },

    types: { type: "array", minItems: 1, items: { type: "string", enum: [...SEARCH_INDEXED_TYPES] } },
    includeCompendia: { type: "boolean" },
    source: { type: "string", enum: [...SEARCH_SOURCES] },

    limit: { type: "integer", minimum: 1, maximum: SEARCH_RESULT_MAX_LIMIT },
    offset: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
};

export const worldSearchCommands = {
  "world.search": cmd(worldSearchSchema)
};
