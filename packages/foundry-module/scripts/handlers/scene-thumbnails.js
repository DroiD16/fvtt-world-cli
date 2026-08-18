import {
  ERROR_CODES,
  SCENE_THUMBNAIL_MAX_BYTES,
  SCENE_THUMBNAIL_RESPONSE_MAX_BYTES
} from "../generated/protocol.js";
import { getFoundryGeneration } from "../lib/foundry-capabilities.js";
import { getSceneById } from "../lib/game-collections.js";
import { assertThumbnailSupported, decodedDataUrlBytes, renderSceneThumbnail } from "../lib/canvas.js";
import { BridgeError, createBridgeError, isFoundryValidationError } from "../lib/errors.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";

const DEFAULT_THUMBNAIL_WIDTH = 300;
const DEFAULT_THUMBNAIL_HEIGHT = 100;

/** @param {{ generation: number | null, reportedWidth: number | null, reportedHeight: number | null, requestedWidth: number, requestedHeight: number }} input */
function mapThumbnailDimensions({
  generation,
  reportedWidth,
  reportedHeight,
  requestedWidth,
  requestedHeight
}) {
  if (generation !== null && generation >= 14) {
    return {
      outputWidth: reportedWidth ?? requestedWidth,
      outputHeight: reportedHeight ?? requestedHeight,
      sourceWidth: null,
      sourceHeight: null
    };
  }
  if (generation === 13) {
    return {
      outputWidth: requestedWidth,
      outputHeight: requestedHeight,
      sourceWidth: reportedWidth,
      sourceHeight: reportedHeight
    };
  }
  return {
    outputWidth: requestedWidth,
    outputHeight: requestedHeight,
    sourceWidth: null,
    sourceHeight: null
  };
}

function thumbnailResultBody({
  sceneId,
  thumb,
  storedPath,
  sizeBytes,
  outputWidth,
  outputHeight,
  sourceWidth,
  sourceHeight,
  persisted
}) {
  return {
    sceneId,
    thumbnail: {
      thumb,
      storedPath,
      sizeBytes,
      outputWidth,
      outputHeight,
      sourceWidth,
      sourceHeight,
      persisted
    }
  };
}

export function createSceneThumbnailHandlers() {
  return {
    async "scene.thumbnail.generate"(params) {
      const scene = getSceneById(params.sceneId);
      const requestedWidth = params.width ?? DEFAULT_THUMBNAIL_WIDTH;
      const requestedHeight = params.height ?? DEFAULT_THUMBNAIL_HEIGHT;
      const includeThumb = params.includeThumb === true;
      const generation = getFoundryGeneration();

      assertThumbnailSupported(scene);

      if (isDryRun(params)) {
        const dims = mapThumbnailDimensions({
          generation,
          reportedWidth: null,
          reportedHeight: null,
          requestedWidth,
          requestedHeight
        });
        return dryRunResponse(
          thumbnailResultBody({
            sceneId: scene.id ?? params.sceneId,
            thumb: null,

            storedPath: null,
            sizeBytes: null,
            ...dims,
            persisted: false
          })
        );
      }

      const { thumb, reportedWidth, reportedHeight } = await renderSceneThumbnail(scene, {
        width: requestedWidth,
        height: requestedHeight
      });
      const sizeBytes = decodedDataUrlBytes(thumb);
      const dims = mapThumbnailDimensions({
        generation,
        reportedWidth,
        reportedHeight,
        requestedWidth,
        requestedHeight
      });

      if (sizeBytes > SCENE_THUMBNAIL_MAX_BYTES) {
        throw createBridgeError(
          ERROR_CODES.PAYLOAD_TOO_LARGE,
          `The generated thumbnail is ${sizeBytes} bytes, above the ${SCENE_THUMBNAIL_MAX_BYTES}-byte limit for a scene thumbnail image; nothing was persisted — request a smaller width/height`,
          {
            limit: "thumbnail-bytes",
            sizeBytes,
            limitBytes: SCENE_THUMBNAIL_MAX_BYTES,
            requested: { width: requestedWidth, height: requestedHeight },
            sceneId: scene.id ?? params.sceneId,
            persisted: false
          }
        );
      }
      if (includeThumb && thumb.length > SCENE_THUMBNAIL_RESPONSE_MAX_BYTES) {
        throw createBridgeError(
          ERROR_CODES.PAYLOAD_TOO_LARGE,

          `The generated thumbnail data URL is ${thumb.length} bytes, above the ${SCENE_THUMBNAIL_RESPONSE_MAX_BYTES}-byte limit for echoing it in the response; nothing was persisted — re-run WITHOUT includeThumb and that call will persist the thumbnail (only the echo is refused, never the write), or request a smaller width/height`,
          {
            limit: "response-bytes",
            responseBytes: thumb.length,
            limitBytes: SCENE_THUMBNAIL_RESPONSE_MAX_BYTES,
            sizeBytes,
            requested: { width: requestedWidth, height: requestedHeight },
            sceneId: scene.id ?? params.sceneId,
            persisted: false
          }
        );
      }

      const notPersisted = (/** @type {string} */ observation, /** @type {any} */ extra = {}) =>
        createBridgeError(
          ERROR_CODES.INTERNAL_ERROR,
          `The thumbnail for scene ${scene.id ?? params.sceneId} was generated but not persisted: ${observation} The likely cause is a module's preUpdateScene hook (or a core _preUpdate) refusing the write, a client-side validation error Foundry only surfaced as a UI notification, or — when the write was REJECTED — the server refusing to extract the base64 body (it requires FILES_UPLOAD, which can be revoked between this command's pre-check and the write) or failing to write the extracted file; see details.message for Foundry's own message when there is one, then disable the module that locks this scene (or generate the thumbnail from the Foundry UI) and retry.`,
          {
            sceneId: scene.id ?? params.sceneId,
            sizeBytes,
            requested: { width: requestedWidth, height: requestedHeight },
            persisted: false,
            ...extra
          }
        );

      let updated;
      try {
        updated = await scene.update({ thumb }, { diff: true, render: true });
      } catch (error) {
        if (error instanceof BridgeError || isFoundryValidationError(error)) {
          throw error;
        }
        const raw = /** @type {any} */ (error);
        throw notPersisted("Foundry rejected the update.", {
          message: raw?.message ?? String(error)
        });
      }

      const persistedSource = typeof scene.toObject === "function" ? scene.toObject() : scene;
      const storedPath = persistedSource?.thumb;
      if (!updated) {
        throw notPersisted(
          "Foundry resolved the update without returning an updated document, so the client backend dropped the write before dispatching it."
        );
      }
      if (typeof storedPath !== "string" || storedPath.length === 0) {
        throw notPersisted("the scene carries no stored `thumb` afterwards.");
      }

      return thumbnailResultBody({
        sceneId: scene.id ?? params.sceneId,
        thumb: includeThumb ? thumb : null,
        storedPath,
        sizeBytes,
        ...dims,
        persisted: true
      });
    }
  };
}
