import { APPROVAL_AWAIT_PARK_CAP_MS } from "../constants.js";
import { cmd, emptyObjectSchema } from "./shared.js";

const approvalIdProperty = {
  approvalId: { type: "string", minLength: 22, maxLength: 22, pattern: "^[A-Za-z0-9_-]{22}$" }
};

const approvalAwaitSchema = {
  type: "object",
  required: ["approvalId"],
  properties: {
    ...approvalIdProperty,
    waitMs: { type: "integer", minimum: 0, maximum: APPROVAL_AWAIT_PARK_CAP_MS }
  },
  additionalProperties: false
};

const approvalCancelSchema = {
  type: "object",
  required: ["approvalId"],
  properties: { ...approvalIdProperty },
  additionalProperties: false
};

export const approvalCommands = {
  "approval.await": cmd(approvalAwaitSchema, { discovery: false }),
  "approval.cancel": cmd(approvalCancelSchema, { discovery: false }),
  "policy.snapshot": cmd(emptyObjectSchema, { discovery: false })
};
