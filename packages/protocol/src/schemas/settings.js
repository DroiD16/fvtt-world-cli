import { cmd, nameFilterProperty, paginationProperties } from "./shared.js";

const settingListSchema = {
  type: "object",
  required: [],
  properties: { ...nameFilterProperty, ...paginationProperties },
  additionalProperties: false
};

const settingGetSchema = {
  type: "object",
  required: ["namespace", "key"],
  properties: {
    namespace: { type: "string", minLength: 1 },
    key: { type: "string", minLength: 1 }
  },
  additionalProperties: false
};

export const settingCommands = {
  "setting.list": cmd(settingListSchema),
  "setting.get": cmd(settingGetSchema)
};
