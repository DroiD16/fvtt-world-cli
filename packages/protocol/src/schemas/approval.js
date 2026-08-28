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

export const APPROVAL_AWAIT_COMMAND = "approval.await";
export const APPROVAL_CANCEL_COMMAND = "approval.cancel";
export const POLICY_SNAPSHOT_COMMAND = "policy.snapshot";

export const approvalCommands = {
  [APPROVAL_AWAIT_COMMAND]: cmd(approvalAwaitSchema, { discovery: false }),
  [APPROVAL_CANCEL_COMMAND]: cmd(approvalCancelSchema, { discovery: false }),
  [POLICY_SNAPSHOT_COMMAND]: cmd(emptyObjectSchema, { discovery: false })
};
