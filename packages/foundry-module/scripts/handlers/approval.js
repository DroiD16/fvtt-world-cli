import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "../lib/errors.js";

/**
 * @param {{ approvalStore: import("../lib/approval-store.js").ApprovalStore }} runtime
 */
export function createApprovalHandlers({ approvalStore }) {
  return {
    /**
     * @param {{ approvalId: string, waitMs?: number }} params
     */
    async "approval.await"({ approvalId, waitMs }) {
      const report = await approvalStore.awaitOutcome({ approvalId, waitMs });

      if (report.status === "unknown") {
        throw createBridgeError(
          ERROR_CODES.APPROVAL_UNKNOWN,
          `The GM client holding this bridge has no approval state for approvalId ${approvalId}. Approval ` +
            "state is runtime state: it does not survive a reload of that client or the end of its bridge " +
            "session, and a retained outcome expires. The outcome is therefore indeterminate — the " +
            "command may never have started, may be running now, or may have completed and changed the " +
            "world. Read the documents the command would have written before anything else, report what you " +
            "found, and if you decide to send the command again, send it under a fresh idempotency key.",
          { approvalId, ...(report.reason ? { reason: report.reason } : {}) }
        );
      }

      return report;
    },

    /**
     * @param {{ approvalId: string }} params
     */
    async "approval.cancel"({ approvalId }) {
      return { approvalId, status: approvalStore.cancel(approvalId) };
    }
  };
}
