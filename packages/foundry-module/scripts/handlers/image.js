import { ERROR_CODES } from "../generated/protocol.js";
import { resolveBroadcastUsers } from "../lib/broadcast-targets.js";
import { createBridgeError } from "../lib/errors.js";
import { canonicalizeDataPath, normalizeFilePath } from "../lib/file-access.js";
import { resolveJournalCollection } from "../lib/journal-docs.js";

const WEB_IMAGE_SOURCE = /^https?:\/\//i;

/**
 * @param {string} src
 * @returns {string}
 */
function resolveImageSource(src) {
  if (WEB_IMAGE_SOURCE.test(src)) {
    return src;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) {
    throw createBridgeError(
      ERROR_CODES.PATH_NOT_ALLOWED,
      `Image source ${src} uses a scheme the bridge does not share: only an http(s) URL or a path relative to ` +
        `Foundry's managed data source is accepted, so a local file, a data URI or another scheme is refused. ` +
        `Nothing was shown`,
      { src }
    );
  }

  return canonicalizeDataPath(normalizeFilePath(src));
}

export function createImageHandlers() {
  return {
    async "image.show"(params) {
      const src = resolveImageSource(params.src);
      const users = resolveBroadcastUsers(params.userIds);
      const Journal = resolveJournalCollection();
      if (typeof Journal?.showImage !== "function") {
        throw createBridgeError(
          ERROR_CODES.UNSUPPORTED_OPERATION,
          "This Foundry version exposes no image-sharing API (Journal.showImage); nothing was shown"
        );
      }

      Journal.showImage(src, {
        users: users.requested ?? [],
        ...(params.title ? { title: params.title } : null)
      });

      return {
        src,
        title: params.title ?? null,
        userIds: users.requested,
        activeUserIds: users.active,
        inactiveUserIds: users.inactive,
        dispatched: users.active.length > 0
      };
    }
  };
}
