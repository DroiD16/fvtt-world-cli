import { runFileAudit } from "../lib/audit.js";

export function createAuditHandlers() {
  return {
    async "world.audit-files"(params) {
      return runFileAudit({
        scope: params.scope,
        limit: params.limit,
        offset: params.offset
      });
    }
  };
}
