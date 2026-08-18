import { cmd, deepFreeze, dryRunProperty, idempotencyKeyProperty, paginationProperties } from "./shared.js";

const dataPathSchema = {
  type: "string",
  minLength: 0
};

const nonEmptyDataPathSchema = {
  type: "string",
  minLength: 1
};

const fileEncodingSchema = {
  type: "string",
  enum: ["text", "base64"]
};

export const AUDIT_FILE_SCOPES = deepFreeze([
  "scene",
  "actor",
  "item",
  "journal",
  "playlist",
  "macro",

  "table",

  "combat",

  "cards"
]);

const auditFilesSchema = {
  type: "object",
  required: [],
  properties: {
    scope: {
      type: "array",
      minItems: 1,
      items: { type: "string", enum: [...AUDIT_FILE_SCOPES] }
    },
    ...paginationProperties
  },
  additionalProperties: false
};

export const fileCommands = {
  "file.list": cmd({
    type: "object",
    description:
      "List a data-source directory. Default: the single named directory (paginated via " +
      "limit/offset). With recursive:true it walks subdirectories depth-first (pre-order) " +
      "bounded by maxDepth (dirs at the boundary are listed but not descended) and maxEntries " +
      "(a hard cap on returned entries; hitting it sets truncated:true + truncatedAt). In " +
      "recursive mode limit/offset are ignored — maxEntries is the cap.",
    required: ["path"],
    properties: {
      path: dataPathSchema,
      recursive: { type: "boolean" },
      maxDepth: { type: "integer", minimum: 1, maximum: 10 },
      maxEntries: { type: "integer", minimum: 1, maximum: 2000 },
      ...paginationProperties
    },
    additionalProperties: false
  }),
  "file.stat": cmd({
    type: "object",
    required: ["path"],
    properties: {
      path: dataPathSchema
    },
    additionalProperties: false
  }),
  "file.read": cmd({
    type: "object",
    required: ["path", "encoding"],
    properties: {
      path: nonEmptyDataPathSchema,
      encoding: fileEncodingSchema
    },
    additionalProperties: false
  }),
  "file.mkdir": cmd(
    {
      type: "object",
      required: ["path"],
      properties: {
        path: nonEmptyDataPathSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "file.upload": cmd(
    {
      type: "object",
      description:
        "Upload a file to the Foundry data source. Size-capped: default 100 MiB raw " +
        "(before base64), configurable up to 512 MiB via the daemon's uploadLimitBytes " +
        "config key. An over-limit payload returns PAYLOAD_TOO_LARGE. Read the effective " +
        "limit before a large upload via system.info result.limits.uploadBytes.",
      required: ["path", "contentBase64"],
      properties: {
        path: nonEmptyDataPathSchema,
        contentBase64: { type: "string", minLength: 1 },
        mimeType: { type: "string", minLength: 1 },
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "file.delete": cmd(
    {
      type: "object",
      required: ["path"],
      properties: {
        path: nonEmptyDataPathSchema,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "file.move": cmd(
    {
      type: "object",
      required: ["from", "to"],
      properties: {
        from: nonEmptyDataPathSchema,
        to: nonEmptyDataPathSchema,
        ...dryRunProperty,
        ...idempotencyKeyProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};

export const worldAuditCommands = {
  "world.audit-files": cmd(auditFilesSchema)
};
