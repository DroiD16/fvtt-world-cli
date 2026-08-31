import { journalOwnershipLevelSchema, ownershipSetSchema } from "./ownership-users.js";
import {
  batchIdsProperty,
  batchWriteCommands,
  cmd,
  compendiumImportSchema,
  dryRunProperty,
  emptyScopeProperties,
  freeformObjectSchema,
  idempotencyKeyProperty,
  nameFilterProperty,
  nameFilteredListSchema,
  nullableStringSchema,
  paginationProperties,
  patchFrom,
  userIdsProperty
} from "./shared.js";

const journalIdSchema = {
  type: "object",
  required: ["journalId"],
  properties: {
    journalId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};

const journalPageTextSchema = {
  type: "object",
  required: [],
  properties: {
    content: { type: "string" },

    markdown: { type: "string" },

    format: { type: "number", enum: [1, 2] }
  },
  additionalProperties: false,
  minProperties: 1
};

const journalPageTitleSchema = {
  type: "object",
  required: [],
  properties: {
    show: { type: "boolean" },
    level: { type: "integer", minimum: 1, maximum: 6 }
  },
  additionalProperties: false,
  minProperties: 1
};

const journalPageImageSchema = {
  type: "object",
  required: [],
  properties: {
    caption: { type: "string" }
  },
  additionalProperties: false,
  minProperties: 1
};

const journalPageVideoSchema = {
  type: "object",
  required: [],
  properties: {
    controls: { type: "boolean" },
    loop: { type: "boolean" },
    autoplay: { type: "boolean" },

    volume: { type: "number", minimum: 0, maximum: 1 },

    timestamp: { type: ["number", "null"], minimum: 0 },
    width: { type: ["integer", "null"], exclusiveMinimum: 0 },
    height: { type: ["integer", "null"], exclusiveMinimum: 0 }
  },
  additionalProperties: false,
  minProperties: 1
};

const journalPageCreateSchema = {
  type: "object",
  required: ["name", "type"],
  properties: {
    name: { type: "string", minLength: 1 },
    type: { type: "string", minLength: 1 },
    sort: { type: "number" },
    text: journalPageTextSchema,
    title: journalPageTitleSchema,
    image: journalPageImageSchema,
    video: journalPageVideoSchema,
    src: { type: "string", minLength: 1 },

    category: nullableStringSchema,

    system: freeformObjectSchema,
    flags: freeformObjectSchema
  },
  additionalProperties: false
};

const journalPagePatchSchema = patchFrom(journalPageCreateSchema, {
  prepend: { id: { type: "string", minLength: 1 } }
});

const journalDataSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1 },
    folder: nullableStringSchema,
    sort: { type: "number" },
    pages: {
      type: "array",
      items: journalPageCreateSchema
    },
    flags: freeformObjectSchema
  },
  additionalProperties: false
};

const journalPatchSchema = {
  type: "object",
  required: [],
  properties: {
    name: { type: "string", minLength: 1 },
    folder: nullableStringSchema,
    sort: { type: "number" },
    pages: {
      type: "array",
      items: journalPagePatchSchema,
      minItems: 1
    },
    deletePageIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1
    },
    flags: freeformObjectSchema
  },
  additionalProperties: false,
  minProperties: 1
};

const journalCategoryCreateSchema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string" },

    sort: { type: "integer" },
    flags: freeformObjectSchema
  },
  additionalProperties: false
};

const journalCategoryPatchSchema = patchFrom(journalCategoryCreateSchema);

const journalCategoryIdSchema = {
  type: "object",
  required: ["journalId", "categoryId"],
  properties: {
    journalId: { type: "string", minLength: 1 },
    categoryId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};

const journalDocumentPatchSchema = {
  type: "object",
  required: [],
  properties: {
    name: { type: "string", minLength: 1 },
    folder: nullableStringSchema,
    sort: { type: "number" },
    flags: freeformObjectSchema
    // NO `pages` / `deletePageIds` — see the note above.
  },
  additionalProperties: false,
  minProperties: 1
};

const journalClonePatchSchema = {
  type: "object",
  required: [],
  properties: {
    name: { type: "string", minLength: 1 },
    folder: nullableStringSchema,
    sort: { type: "number" }
  },
  additionalProperties: false,
  minProperties: 1
};

export const journalCommands = {
  "journal.list": cmd(nameFilteredListSchema),
  "journal.get": cmd(journalIdSchema),
  "journal.get-many": cmd({
    type: "object",
    required: ["ids"],
    properties: { ...batchIdsProperty },
    additionalProperties: false
  }),
  "journal.create": cmd(
    {
      type: "object",
      required: ["data"],
      properties: {
        data: journalDataSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "journal.update": cmd(
    {
      type: "object",
      required: ["journalId", "patch"],
      properties: {
        journalId: { type: "string", minLength: 1 },
        patch: journalPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "journal.delete": cmd(
    {
      type: "object",
      required: ["journalId"],
      properties: {
        journalId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "journal.clone": cmd(
    {
      type: "object",
      required: ["journalId"],
      properties: {
        journalId: { type: "string", minLength: 1 },
        patch: journalClonePatchSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "journal.import-from-compendium": cmd(compendiumImportSchema(journalDocumentPatchSchema), {
    mutation: true
  }),
  "journal.show": cmd({
    type: "object",
    required: ["journalId"],
    properties: {
      journalId: { type: "string", minLength: 1 },
      force: { type: "boolean" },
      ...userIdsProperty
    },
    additionalProperties: false
  }),
  "journal.ownership.set": cmd(
    ownershipSetSchema("journalId", {
      levelSchema: journalOwnershipLevelSchema,
      extraProperties: { pageId: { type: "string", minLength: 1 } }
    }),
    { mutation: true }
  ),
  ...batchWriteCommands("journal", {
    scopeProperties: emptyScopeProperties,
    patchSchema: journalDocumentPatchSchema,
    verbs: ["update-many", "delete-many"]
  }),
  "journal.category.list": cmd({
    type: "object",
    required: ["journalId"],
    properties: {
      journalId: { type: "string", minLength: 1 },
      ...nameFilterProperty,
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "journal.category.get": cmd(journalCategoryIdSchema),
  "journal.category.create": cmd(
    {
      type: "object",
      required: ["journalId", "data"],
      properties: {
        journalId: { type: "string", minLength: 1 },
        data: journalCategoryCreateSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "journal.category.update": cmd(
    {
      type: "object",
      required: ["journalId", "categoryId", "patch"],
      properties: {
        journalId: { type: "string", minLength: 1 },
        categoryId: { type: "string", minLength: 1 },
        patch: journalCategoryPatchSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "journal.category.delete": cmd(
    {
      type: "object",
      required: ["journalId", "categoryId"],
      properties: {
        journalId: { type: "string", minLength: 1 },
        categoryId: { type: "string", minLength: 1 },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};
