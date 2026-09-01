import { BATCH_WRITE_MAX_ITEMS } from "../constants.js";
import { batchIdsProperty, cmd, dryRunProperty, nameFilterProperty, paginationProperties } from "./shared.js";

const settingListSchema = {
  type: "object",
  required: [],
  properties: { ...nameFilterProperty, ...paginationProperties },
  additionalProperties: false
};

const settingKeyProperties = {
  namespace: { type: "string", minLength: 1 },
  key: { type: "string", minLength: 1 }
};

const settingGetSchema = {
  type: "object",
  required: ["namespace", "key"],
  properties: { ...settingKeyProperties },
  additionalProperties: false
};

const settingWriteItemSchema = {
  type: "object",
  required: ["namespace", "key", "value"],
  properties: {
    ...settingKeyProperties,
    value: {}
  },
  additionalProperties: false
};

export const settingCommands = {
  "setting.list": cmd(settingListSchema),
  "setting.get": cmd(settingGetSchema),
  "setting.get-many": cmd({
    type: "object",
    required: ["ids"],
    properties: { ...batchIdsProperty },
    additionalProperties: false
  }),
  "setting.set": cmd(
    {
      type: "object",
      required: ["namespace", "key", "value"],
      properties: {
        ...settingWriteItemSchema.properties,
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  ),
  "setting.set-many": cmd(
    {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          minItems: 1,
          maxItems: BATCH_WRITE_MAX_ITEMS,
          items: settingWriteItemSchema
        },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};
