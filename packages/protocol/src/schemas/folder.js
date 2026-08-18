import {
  cmd,
  dryRunProperty,
  freeformObjectSchema,
  idempotencyKeyProperty,
  nameFilterProperty,
  nullableStringSchema,
  paginationProperties
} from "./shared.js";

const folderListSchema = {
  type: "object",
  required: [],
  properties: {
    type: { type: "string", minLength: 1 },
    ...nameFilterProperty,
    ...paginationProperties
  },
  additionalProperties: false
};

const folderSortingSchema = { type: "string", enum: ["a", "m"] };

const folderColorSchema = { type: ["string", "null"], minLength: 1 };

const folderMutableFields = {
  name: { type: "string", minLength: 1 },
  description: { type: "string" },
  color: folderColorSchema,
  sorting: folderSortingSchema,
  sort: { type: "number" },

  folder: nullableStringSchema,
  flags: freeformObjectSchema
};

const folderCreateSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["name", "type"],
      properties: {
        ...folderMutableFields,
        type: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    },
    ...dryRunProperty,
    ...idempotencyKeyProperty
  },
  additionalProperties: false
};

const folderUpdateSchema = {
  type: "object",
  required: ["folderId", "patch"],
  properties: {
    folderId: { type: "string", minLength: 1 },
    patch: {
      type: "object",
      required: [],
      properties: { ...folderMutableFields },
      additionalProperties: false,
      minProperties: 1
    },
    ...dryRunProperty
  },
  additionalProperties: false
};

const folderDeleteSchema = {
  type: "object",
  required: ["folderId"],
  properties: {
    folderId: { type: "string", minLength: 1 },
    deleteSubfolders: { type: "boolean" },
    deleteContents: { type: "boolean" },
    force: { type: "boolean" },
    ...dryRunProperty,
    ...idempotencyKeyProperty
  },
  additionalProperties: false
};

const folderIdSchema = {
  type: "object",
  required: ["folderId"],
  properties: {
    folderId: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};

export const folderCommands = {
  "folder.list": cmd(folderListSchema),
  "folder.get": cmd(folderIdSchema),
  "folder.create": cmd(folderCreateSchema, { mutation: true }),
  "folder.update": cmd(folderUpdateSchema, { mutation: true }),
  "folder.delete": cmd(folderDeleteSchema, { mutation: true })
};
