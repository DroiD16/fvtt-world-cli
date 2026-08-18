import {
  deleteDataFile,
  listDataPath,
  listDataPathRecursive,
  mkdirDataPath,
  moveDataFile,
  readDataFile,
  statDataPath,
  uploadDataFile
} from "../lib/file-access.js";

export function createFileHandlers() {
  return {
    async "file.list"(params) {
      if (params.recursive === true) {
        return listDataPathRecursive(params.path, {
          maxDepth: params.maxDepth,
          maxEntries: params.maxEntries
        });
      }

      return listDataPath(params.path, { limit: params.limit, offset: params.offset });
    },

    async "file.stat"(params) {
      return {
        entry: await statDataPath(params.path)
      };
    },

    async "file.read"(params) {
      return readDataFile(params.path, params.encoding);
    },

    async "file.mkdir"(params) {
      return mkdirDataPath(params.path, { dryRun: params.dryRun === true });
    },

    async "file.upload"(params, context) {
      const uploadLimitBytes = context?.bridgeClient?.getEffectiveLimits?.()?.uploadBytes;
      return uploadDataFile(params.path, params.contentBase64, params.mimeType ?? null, {
        dryRun: params.dryRun === true,
        ...(typeof uploadLimitBytes === "number" ? { uploadLimitBytes } : {})
      });
    },

    async "file.delete"(params) {
      return deleteDataFile(params.path, { dryRun: params.dryRun === true });
    },

    async "file.move"(params) {
      return moveDataFile(params.from, params.to, { dryRun: params.dryRun === true });
    }
  };
}
