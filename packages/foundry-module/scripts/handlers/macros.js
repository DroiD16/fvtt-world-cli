import { BATCH_GET_MAX_IDS, ERROR_CODES } from "../generated/protocol.js";
import { getMacroById, getMacrosCollection } from "../lib/game-collections.js";
import {
  cloneDocument,
  createMacro,
  deleteDocument,
  previewDocumentUpdate,
  previewMacroCreate
} from "../lib/world-docs.js";
import { createBridgeError } from "../lib/errors.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { canonicalizeFilePathFields } from "../lib/file-access.js";
import { filterByName, paginate, serializeMacro, serializeMacroSummary } from "../lib/serializers.js";

export function createMacroHandlers() {
  return {
    async "macro.list"(params) {
      const macros = filterByName(Array.from(getMacrosCollection()), params.name);
      const { page, total, hasMore } = paginate(macros, params);
      return {
        macros: page.map((macro) => serializeMacroSummary(macro)),
        total,
        hasMore
      };
    },

    async "macro.get"(params) {
      const macro = getMacroById(params.macroId);
      return {
        macro: serializeMacro(macro, { ownership: true })
      };
    },

    async "macro.get-many"(params) {
      const ids = params.ids;
      if (ids.length > BATCH_GET_MAX_IDS) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `macro.get-many accepts at most ${BATCH_GET_MAX_IDS} ids`,
          { max: BATCH_GET_MAX_IDS, received: ids.length }
        );
      }

      const macros = ids.map((id) => serializeMacro(getMacroById(id), { ownership: true }));
      return { macros };
    },

    async "macro.create"(params) {
      const data = canonicalizeFilePathFields(params.data, "Macro");
      if (isDryRun(params)) {
        const preview = previewMacroCreate(data);
        return dryRunResponse({ macro: serializeMacro(preview) });
      }

      const macro = await createMacro(data);
      return {
        macro: serializeMacro(macro)
      };
    },

    async "macro.update"(params) {
      const macro = getMacroById(params.macroId);
      const patch = canonicalizeFilePathFields(params.patch, "Macro");
      if (isDryRun(params)) {
        const preview = await previewDocumentUpdate(macro, patch);
        return dryRunResponse({ macro: serializeMacro(preview) });
      }

      await macro.update(patch, { diff: true, render: true });
      return {
        macro: serializeMacro(macro)
      };
    },

    async "macro.clone"(params) {
      const macro = getMacroById(params.macroId);
      const patch = canonicalizeFilePathFields(params.patch, "Macro");
      const clone = await cloneDocument(macro, patch ?? {}, { dryRun: isDryRun(params) });
      const result = { macro: serializeMacro(clone) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "macro.delete"(params) {
      const macro = getMacroById(params.macroId);
      const id = macro.id ?? params.macroId;
      if (isDryRun(params)) {
        return dryRunResponse({ id, deleted: false });
      }

      await deleteDocument(macro);
      return {
        id,
        deleted: true
      };
    }
  };
}
