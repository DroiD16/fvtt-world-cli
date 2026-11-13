import {
  assertThumbnailSupported,
  createImageCanvas,
  decodeDataUrlImage,
  encodeRenderedImage,
  fitLongSide,
  renderSceneThumbnail
} from "../lib/canvas.js";
import { getFoundryGeneration } from "../lib/foundry-capabilities.js";
import { getSceneById } from "../lib/game-collections.js";
import { resolveSceneLevel } from "../lib/scene-embedded.js";
import { drawSnapshotOverlays, resolveSnapshotLayers } from "../lib/snapshot-overlays.js";

const DEFAULT_SNAPSHOT_SIZE = 1024;

export function createSceneSnapshotHandlers() {
  return {
    async "scene.snapshot"(params) {
      const scene = getSceneById(params.sceneId);
      const level = resolveSceneLevel(scene, params.levelId, "scene.snapshot");
      const layers = resolveSnapshotLayers(scene, params.layers);
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
      // result size; v14 always fits it to the scene rectangle and reports the output size.
      const { reportedWidth, reportedHeight } = rendered;
      const fitsDrawnBounds =
        getFoundryGeneration() === 13 &&
        reportedWidth !== null &&
        reportedHeight !== null &&
        reportedWidth > 0 &&
        reportedHeight > 0;
      const contentWidth = fitsDrawnBounds ? reportedWidth : rect.width;
      const contentHeight = fitsDrawnBounds ? reportedHeight : rect.height;
      const scale =
        contentWidth / contentHeight > width / height ? height / contentHeight : width / contentWidth;
      const offsetX = (width - contentWidth * scale) / 2 - rect.x * scale;
      const offsetY = (height - contentHeight * scale) / 2 - rect.y * scale;
      const transform = { scale, offsetX, offsetY };

      const { element, context } = createImageCanvas(width, height);
      context.fillStyle = String((level ? level.background?.color : scene.backgroundColor)?.css ?? "#000000");
      context.fillRect(0, 0, width, height);
      context.drawImage(background, 0, 0, width, height);
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
        view: { x: -offsetX / scale, y: -offsetY / scale, width: width / scale, height: height / scale },
        transform
      };
    }
  };
}
