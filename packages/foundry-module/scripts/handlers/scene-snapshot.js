import { ERROR_CODES, SCENE_SNAPSHOT_DEFAULT_SIZE, SCENE_SNAPSHOT_LAYERS } from "../generated/protocol.js";
import {
  assertThumbnailSupported,
  createImageCanvas,
  decodeDataUrlImage,
  encodeRenderedImage,
  fitLongSide,
  renderSceneThumbnail
} from "../lib/canvas.js";
import { getFoundryGeneration, hasSceneLevels } from "../lib/foundry-capabilities.js";
import { getSceneById } from "../lib/game-collections.js";
import { createBridgeError } from "../lib/errors.js";
import { resolveSceneLevel } from "../lib/scene-embedded.js";
import { drawSnapshotOverlays } from "../lib/snapshot-overlays.js";

/**
 * @param {{ x: number, y: number }} rect
 * @param {number} contentWidth
 * @param {number} contentHeight
 * @param {number} width
 * @param {number} height
 */
function fitTransform(rect, contentWidth, contentHeight, width, height) {
  const scale = contentWidth / contentHeight > width / height ? height / contentHeight : width / contentWidth;
  return {
    scale,
    offsetX: (width - contentWidth * scale) / 2 - rect.x * scale,
    offsetY: (height - contentHeight * scale) / 2 - rect.y * scale
  };
}

export function createSceneSnapshotHandlers() {
  return {
    async "scene.snapshot"(params) {
      const scene = getSceneById(params.sceneId);
      const level = resolveSceneLevel(scene, params.levelId, "scene.snapshot");
      const templatesSupported = !hasSceneLevels();
      if (!templatesSupported && params.layers?.includes("templates")) {
        throw createBridgeError(
          ERROR_CODES.UNSUPPORTED_OPERATION,
          "scene.snapshot has no templates layer in this Foundry version: measured templates were removed from scenes in v14. Request the other layers, or omit layers to draw all of them",
          { layer: "templates" }
        );
      }
      const layers = SCENE_SNAPSHOT_LAYERS.filter((layer) =>
        params.layers === undefined
          ? layer !== "templates" || templatesSupported
          : params.layers.includes(layer)
      );
      assertThumbnailSupported(scene, "scene.snapshot");

      const rect = scene.dimensions.sceneRect;
      const { width, height } = fitLongSide(
        params.size ?? SCENE_SNAPSHOT_DEFAULT_SIZE,
        rect.width,
        rect.height
      );
      const rendered = await renderSceneThumbnail(scene, {
        width,
        height,
        format: "image/png",
        ...(level ? { level: level.id } : {})
      });
      // Foundry v13 fits the thumbnail to the bounds of what it drew, which it reports as the
      // result size; v14 always fits it to the scene rectangle and reports the output size. The
      // snapshot always covers the whole scene, so a v13 thumbnail is placed at its own fit.
      const { reportedWidth, reportedHeight } = rendered;
      const fitsDrawnBounds =
        getFoundryGeneration() === 13 &&
        reportedWidth !== null &&
        reportedHeight !== null &&
        reportedWidth > 0 &&
        reportedHeight > 0;
      const transform = fitTransform(rect, rect.width, rect.height, width, height);
      const drawn = fitsDrawnBounds
        ? fitTransform(rect, reportedWidth, reportedHeight, width, height)
        : transform;
      const ratio = transform.scale / drawn.scale;

      const background = await decodeDataUrlImage(rendered.thumb);
      try {
        const { element, context } = createImageCanvas(width, height);
        context.fillStyle = String(
          (level ? level.background?.color : scene.backgroundColor)?.css ?? "#000000"
        );
        context.fillRect(0, 0, width, height);
        context.drawImage(
          background,
          transform.offsetX - drawn.offsetX * ratio,
          transform.offsetY - drawn.offsetY * ratio,
          width * ratio,
          height * ratio
        );

        await drawSnapshotOverlays(context, scene, {
          layers,
          level,
          transform,
          tokenImages: params.tokenImages === true
        });

        return {
          sceneId: scene.id,
          levelId: level?.id ?? null,
          layers,
          image: encodeRenderedImage(element, params.format ?? "webp", {
            sceneId: scene.id,
            size: Math.max(width, height)
          }),
          partialRender:
            fitsDrawnBounds &&
            (Math.round(reportedWidth) < rect.width || Math.round(reportedHeight) < rect.height),
          view: {
            x: -transform.offsetX / transform.scale,
            y: -transform.offsetY / transform.scale,
            width: width / transform.scale,
            height: height / transform.scale
          },
          transform
        };
      } finally {
        background.close();
      }
    }
  };
}
