import { SCENE_SNAPSHOT_LAYERS } from "../generated/protocol.js";
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
import { assertSceneTemplatesSupported, resolveSceneLevel } from "../lib/scene-embedded.js";
import { drawSnapshotOverlays } from "../lib/snapshot-overlays.js";

const DEFAULT_SNAPSHOT_SIZE = 1024;

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
      if (params.layers?.includes("templates")) assertSceneTemplatesSupported(scene);
      const layers = SCENE_SNAPSHOT_LAYERS.filter((layer) =>
        params.layers === undefined
          ? layer !== "templates" || !hasSceneLevels()
          : params.layers.includes(layer)
      );
      assertThumbnailSupported(scene, "scene.snapshot");

      const rect = scene.dimensions.sceneRect;
      const { width, height } = fitLongSide(params.size ?? DEFAULT_SNAPSHOT_SIZE, rect.width, rect.height);
      const rendered = await renderSceneThumbnail(scene, {
        width,
        height,
        format: "image/png",
        ...(level ? { level: level.id } : {})
      });
      const background = await decodeDataUrlImage(rendered.thumb);

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

      const { element, context } = createImageCanvas(width, height);
      context.fillStyle = String((level ? level.background?.color : scene.backgroundColor)?.css ?? "#000000");
      context.fillRect(0, 0, width, height);
      context.drawImage(
        background,
        transform.offsetX - drawn.offsetX * ratio,
        transform.offsetY - drawn.offsetY * ratio,
        width * ratio,
        height * ratio
      );
      background.close();

      await drawSnapshotOverlays(context, scene, {
        layers,
        level,
        transform,
        tokenImages: params.tokenImages === true
      });

      const image = encodeRenderedImage(element, params.format ?? "webp", {
        sceneId: scene.id,
        size: Math.max(width, height)
      });

      return {
        sceneId: scene.id,
        levelId: level?.id ?? null,
        layers,
        image,
        view: {
          x: -transform.offsetX / transform.scale,
          y: -transform.offsetY / transform.scale,
          width: width / transform.scale,
          height: height / transform.scale
        },
        transform
      };
    }
  };
}
