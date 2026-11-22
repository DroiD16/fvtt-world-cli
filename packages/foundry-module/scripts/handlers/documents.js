import { resolveDocumentUuid } from "../lib/document-uuid.js";

export function createDocumentHandlers() {
  return {
    async "document.resolve"(params) {
      return resolveDocumentUuid(params.uuid);
    }
  };
}
