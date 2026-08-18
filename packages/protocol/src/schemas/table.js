import { TABLE_DRAW_MAX_COUNT } from "../constants.js";
import { ownershipLevelSchema, ownershipSetSchema } from "./ownership-users.js";
import {
  batchIdsProperty,
  cmd,
  compendiumImportSchema,
  deepFreeze,
  dryRunProperty,
  freeformObjectSchema,
  idempotencyKeyProperty,
  nameFilterProperty,
  nameFilteredListSchema,
  nullableStringSchema,
  paginationProperties,
  patchFrom
} from "./shared.js";

const tableResultCreateSchema = {
  type: "object",
  required: ["range"], // Foundry's own `initial: []` fails its min:2 — see the note above
  properties: {
    type: { type: "string", enum: ["text", "document"] }, // TABLE_RESULT_TYPES (executed, v13+v14)
    name: { type: "string" }, // blank:true, initial "" → NO minLength, not required
    img: { type: ["string", "null"], minLength: 1 }, // nullable but not blankable (see above)
    description: { type: "string" },
    documentUuid: { type: ["string", "null"], minLength: 1 }, // ditto — "" is silently DROPPED
    weight: { type: "integer", minimum: 1 },
    range: {
      type: "array",
      minItems: 2,
      maxItems: 2, // advisory (validator ignores maxItems) — module-gated to exactly 2, ascending
      items: { type: "integer" }
    },
    drawn: { type: "boolean" },
    flags: freeformObjectSchema
  },
  additionalProperties: false
};

const tableResultPatchSchema = patchFrom(tableResultCreateSchema);

const tableResultIdSchema = {
  type: "object",
  required: ["tableId", "resultId"],
  properties: {
    tableId: { type: "string", minLength: 1 },
    resultId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};

const tableDataSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 }, // StringField blank:false (executed: "" is rejected)
    img: { type: ["string", "null"], minLength: 1 }, // nullable, NOT blankable (--clear-img → null)
    description: { type: "string" },
    formula: { type: "string" }, // NOT nullable
    replacement: { type: "boolean" },
    displayRoll: { type: "boolean" },
    folder: nullableStringSchema,
    sort: { type: "number" },
    flags: freeformObjectSchema,
    results: { type: "array", items: tableResultCreateSchema }
  },
  additionalProperties: false
};

// NO `results` on patch (fields-only update; embedded result writes → table.result.*)
const tablePatchSchema = patchFrom(tableDataSchema, { omit: ["results"] });

const tableIdSchema = {
  type: "object",
  required: ["tableId"],
  properties: { tableId: { type: "string", minLength: 1 } },
  additionalProperties: false
};

export const TABLE_ROLL_MODES = deepFreeze(["public", "gm", "blind", "self"]);

const tableDrawSchema = {
  type: "object",

  required: ["tableId", "idempotencyKey"],
  properties: {
    tableId: { type: "string", minLength: 1 },

    count: { type: "integer", minimum: 1, maximum: TABLE_DRAW_MAX_COUNT },
    rollMode: { type: "string", enum: [...TABLE_ROLL_MODES] },
    chat: { type: "boolean" }, // false = `displayChat:false` (CLI `--no-chat`)
    recursive: { type: "boolean" }, // false = `recursive:false` (CLI `--no-recursive`)
    ...dryRunProperty,
    ...idempotencyKeyProperty
  },
  additionalProperties: false
};

export const TABLE_MUTATION_OUTCOMES = deepFreeze(["committed", "unknown", "not-executed"]);

export const tableCommands = {
  "table.list": cmd(nameFilteredListSchema),
  "table.get": cmd(tableIdSchema),
  "table.get-many": cmd({
    type: "object",
    required: ["ids"],
    properties: { ...batchIdsProperty },
    additionalProperties: false
  }),
  "table.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: tableDataSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.update": cmd(
    {
      type: "object",
      required: ["tableId", "patch"],
      properties: {
        tableId: { type: "string", minLength: 1 },
        patch: tablePatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.delete": cmd(
    {
      type: "object",
      required: ["tableId"],
      properties: {
        tableId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.clone": cmd(
    {
      type: "object",
      required: ["tableId"],
      properties: {
        tableId: { type: "string", minLength: 1 },
        patch: tablePatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.import-from-compendium": cmd(compendiumImportSchema(tablePatchSchema), { mutation: true }),
  "table.draw": cmd(tableDrawSchema, { mutation: true }),
  "table.reset": cmd(
    {
      type: "object",
      required: ["tableId"],
      properties: {
        tableId: { type: "string", minLength: 1 },
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.ownership.set": cmd(ownershipSetSchema("tableId", { levelSchema: ownershipLevelSchema }), {
    mutation: true
  }),
  "table.result.list": cmd({
    type: "object",
    required: [],
    properties: {
      tableId: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "table.result.get": cmd(tableResultIdSchema),
  "table.result.create": cmd(
    {
      type: "object",
      required: ["tableId", "data"],
      properties: {
        tableId: { type: "string", minLength: 1 },

        data: tableResultCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.result.update": cmd(
    {
      type: "object",
      required: ["tableId", "resultId", "patch"],
      properties: {
        tableId: { type: "string", minLength: 1 },
        resultId: { type: "string", minLength: 1 },
        patch: tableResultPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.result.delete": cmd(
    {
      type: "object",
      required: ["tableId", "resultId"],
      properties: {
        tableId: { type: "string", minLength: 1 },
        resultId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "table.result.clone": cmd(
    {
      type: "object",
      required: ["tableId", "resultId"],
      properties: {
        tableId: { type: "string", minLength: 1 },
        resultId: { type: "string", minLength: 1 },
        patch: tableResultPatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};
