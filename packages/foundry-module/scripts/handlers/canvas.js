import { ERROR_CODES, RENDERED_IMAGE_MAX_DIMENSION } from "../generated/protocol.js";
import { assertCanvasEnabled, createImageCanvas, encodeRenderedImage, fitLongSide } from "../lib/canvas.js";
import { createBridgeError } from "../lib/errors.js";
import { getSceneById } from "../lib/game-collections.js";
import { resolveSceneLevel } from "../lib/scene-embedded.js";

/** @param {string} command */
function assertCanvasNotLoading(command) {
  if (globalThis.canvas?.loading) {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      `The GM client's canvas is still loading a scene, and Foundry refuses to change or read the view until it finishes; wait a moment and re-run ${command}`,
      { command }
    );
  }
}

/**
 * @param {string} command
 * @returns {any}
 */
function viewingCanvas(command) {
  assertCanvasEnabled(command);
  assertCanvasNotLoading(command);
  const board = /** @type {any} */ (globalThis.canvas);
  if (!board?.ready || !board.scene) {
    throw createBridgeError(
      ERROR_CODES.SCENE_NOT_VIEWED,
      `The GM client is not viewing any scene, so there is no view for ${command} to work on; open a scene in the GM client first, for example with canvas.view-scene, then re-run ${command}`,
      { command, viewedSceneId: null }
    );
  }
  return board;
}

/** @param {any} board */
function readView(board) {
  const [screenWidth, screenHeight] = board.screenDimensions;
  const topLeft = board.canvasCoordinatesFromClient({ x: 0, y: 0 });
  const bottomRight = board.canvasCoordinatesFromClient({ x: screenWidth, y: screenHeight });
  return {
    sceneId: board.scene.id,
    levelId: board.level?.id ?? null,
    position: { x: board.stage.pivot.x, y: board.stage.pivot.y, scale: board.stage.scale.x },
    view: {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y
    },
    screen: { width: screenWidth, height: screenHeight }
  };
}

export function createCanvasHandlers() {
  return {
    async "canvas.capture"(params) {
      const board = viewingCanvas("canvas.capture");
      const { sceneId, levelId, position, view, screen } = readView(board);
      const renderer = board.app.renderer;

      // The drawing buffer is cleared once the frame is presented, so the read must follow the
      // render in the same task.
      renderer.render(board.app.stage);
      const frame = renderer.extract.canvas();

      const { width, height } = fitLongSide(
        params.size ?? Math.min(Math.max(screen.width, screen.height), RENDERED_IMAGE_MAX_DIMENSION),
        screen.width,
        screen.height
      );
      const { element, context } = createImageCanvas(width, height);
      context.drawImage(frame, 0, 0, width, height);

      const image = await encodeRenderedImage(element, params.format ?? "webp", {
        sceneId,
        size: Math.max(width, height)
      });
      const scale = (position.scale * width) / screen.width;

      return {
        sceneId,
        levelId,
        position,
        image,
        view,
        transform: { scale, offsetX: -view.x * scale, offsetY: -view.y * scale }
      };
    },

    async "canvas.pan"(params) {
      const board = viewingCanvas("canvas.pan");
      if (params.fit === true && ["x", "y", "scale"].some((key) => params[key] !== undefined)) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          "canvas.pan takes either fit or a position (x, y, scale), not both: fit computes the whole position from the scene's size. Nothing was changed",
          { fit: true, x: params.x ?? null, y: params.y ?? null, scale: params.scale ?? null }
        );
      }
      const previous = readView(board).position;

      if (params.fit === true) {
        const rect = board.dimensions.sceneRect;
        const [screenWidth, screenHeight] = board.screenDimensions;
        board.pan({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          scale: Math.min(screenWidth / rect.width, screenHeight / rect.height)
        });
      } else {
        board.pan({ x: params.x, y: params.y, scale: params.scale });
      }

      const { sceneId, levelId, position, view } = readView(board);
      return { sceneId, levelId, previous, position, view };
    },

    async "canvas.view-scene"(params) {
      const scene = getSceneById(params.sceneId);
      const level =
        params.levelId === undefined ? null : resolveSceneLevel(scene, params.levelId, "canvas.view-scene");
      assertCanvasEnabled("canvas.view-scene");
      assertCanvasNotLoading("canvas.view-scene");

      const board = /** @type {any} */ (globalThis.canvas);
      const previousSceneId = board?.scene?.id ?? null;
      const previousLevelId = board?.level?.id ?? null;
      const changed = previousSceneId !== scene.id || (level !== null && previousLevelId !== level.id);

      if (changed) {
        await scene.view(...(level ? [{ level: level.id }] : []));
      }

      const sceneId = board?.scene?.id ?? null;
      const levelId = board?.level?.id ?? null;
      if (sceneId !== scene.id || (level !== null && levelId !== level.id)) {
        throw createBridgeError(
          ERROR_CODES.BRIDGE_NOT_READY,
          `Foundry did not switch the GM client's view to scene ${scene.id}${level ? ` level ${level.id}` : ""}: it is viewing ${sceneId ?? "no scene"}. Foundry skips a switch while the canvas is still loading resources and shows a warning in the GM client instead; wait for the canvas to finish and re-run canvas.view-scene`,
          { sceneId: scene.id, levelId: level?.id ?? null, viewedSceneId: sceneId, viewedLevelId: levelId }
        );
      }

      return { sceneId, levelId, previousSceneId, previousLevelId, changed };
    }
  };
}
