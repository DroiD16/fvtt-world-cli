import { runFileAudit } from "../lib/audit.js";
import { runReferenceLookup } from "../lib/references.js";

export function createAuditHandlers() {
  return {
    async "world.audit-files"(params) {
      return runFileAudit({
        scope: params.scope,
        limit: params.limit,
        offset: params.offset
      });
    },

    async "world.references"(params) {
      return runReferenceLookup({
        uuid: params.uuid,
        scope: params.scope,
        limit: params.limit,
        offset: params.offset
      });
    }
  };
}
