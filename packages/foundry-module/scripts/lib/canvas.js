import {
  ERROR_CODES,
  FOG_RESET_CONFIRM_POLL_INTERVAL_MS,
  FOG_RESET_CONFIRM_TIMEOUT_MS,
  RENDERED_IMAGE_MAX_BYTES
} from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

const RENDERED_IMAGE_QUALITY = 0.85;

/** @returns {boolean} */
export function isCanvasDisabled() {
  try {
    return globalThis.game?.settings?.get?.("core", "noCanvas") === true;
  } catch {
    return false;
  }
}

/** @param {any} scene */
function assertThumbnailApiAvailable(scene) {
  if (typeof scene?.createThumbnail !== "function") {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      "Foundry Scene#createThumbnail is not available in this client session"
    );
  }
}

/** @param {string} command */
export function assertCanvasEnabled(command) {
  if (isCanvasDisabled()) {
    throw createBridgeError(
      ERROR_CODES.UNSUPPORTED_OPERATION,
      `${command} requires a rendered game canvas, but the core \`noCanvas\` setting is enabled in this GM client session; disable it (Configure Settings → Core → Disable Canvas) and reload the client, then re-run ${command}`,
      { setting: "core.noCanvas" }
    );
  }
}

/**
 * @param {any} scene
 * @param {string} command
 */
export function assertThumbnailSupported(scene, command) {
  assertThumbnailApiAvailable(scene);
  assertCanvasEnabled(command);

  const user = globalThis.game?.user;
  if (typeof user?.can === "function" && !user.can("FILES_UPLOAD")) {
    throw createBridgeError(
      ERROR_CODES.THUMBNAIL_UPLOAD_DENIED,
      `${command} renders through Foundry's Scene#createThumbnail, which refuses to run unless the user holds the core FILES_UPLOAD permission, and the bridge GM session lacks it; grant the GM role File Upload permission (Configure Permissions) and retry`,
      { permission: "FILES_UPLOAD" }
    );
  }
}

/**
 * @param {any} scene
 * @param {Record<string, unknown>} options
 * @returns {Promise<{ thumb: string, reportedWidth: number | null, reportedHeight: number | null }>}
 */
export async function renderSceneThumbnail(scene, options) {
  assertThumbnailApiAvailable(scene);

  let result;
  try {
    result = await scene.createThumbnail(options);
  } catch (error) {
    const raw = /** @type {any} */ (error);

    if (raw?.cause?.thumbUploadDenied) {
      throw createBridgeError(
        ERROR_CODES.THUMBNAIL_UPLOAD_DENIED,
        "Foundry refused to render the scene: Scene#createThumbnail requires the core FILES_UPLOAD permission, which the bridge GM session lacks; grant the GM role File Upload permission (Configure Permissions) and retry",
        { sceneId: scene?.id ?? null, permission: "FILES_UPLOAD" }
      );
    }

    if (isCanvasDisabled()) {
      throw createBridgeError(
        ERROR_CODES.UNSUPPORTED_OPERATION,
        "Rendering a scene requires a rendered game canvas, but the core `noCanvas` setting is enabled in this GM client session",
        { setting: "core.noCanvas" }
      );
    }
    throw createBridgeError(
      ERROR_CODES.THUMBNAIL_RENDER_FAILED,
      `Foundry could not render scene ${scene?.id ?? "unknown"}: ${raw?.message ?? String(error)}`,
      { sceneId: scene?.id ?? null, message: raw?.message ?? String(error) }
    );
  }

  const thumb = typeof result?.thumb === "string" && result.thumb ? result.thumb : null;
  if (!thumb) {
    throw createBridgeError(
      ERROR_CODES.THUMBNAIL_RENDER_FAILED,
      `Foundry resolved Scene#createThumbnail for scene ${scene?.id ?? "unknown"} without returning image data`,
      { sceneId: scene?.id ?? null }
    );
  }

  return {
    thumb,
    reportedWidth: Number.isFinite(result?.width) ? Number(result.width) : null,
    reportedHeight: Number.isFinite(result?.height) ? Number(result.height) : null
  };
}

/**
 * @param {string} dataUrl
 * @returns {number}
 */
export function decodedDataUrlBytes(dataUrl) {
  const commaIndex = typeof dataUrl === "string" ? dataUrl.indexOf(",") : -1;
  const payload = commaIndex === -1 ? "" : dataUrl.slice(commaIndex + 1).replace(/\s+/g, "");
  if (!payload) {
    return 0;
  }
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

/**
 * @param {string} dataUrl
 * @returns {Promise<ImageBitmap>}
 */
export async function decodeDataUrlImage(dataUrl) {
  try {
    const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return await createImageBitmap(new Blob([bytes]));
  } catch (error) {
    const raw = /** @type {any} */ (error);
    throw createBridgeError(
      ERROR_CODES.THUMBNAIL_RENDER_FAILED,
      `The GM client could not decode the image Foundry rendered: ${raw?.message ?? String(error)}`,
      { message: raw?.message ?? String(error) }
    );
  }
}

/**
 * @param {number} longSide
 * @param {number} width
 * @param {number} height
 * @returns {{ width: number, height: number }}
 */
export function fitLongSide(longSide, width, height) {
  return width >= height
    ? { width: longSide, height: Math.max(1, Math.round((longSide * height) / width)) }
    : { width: Math.max(1, Math.round((longSide * width) / height)), height: longSide };
}

/**
 * @param {number} width
 * @param {number} height
 * @returns {{ element: HTMLCanvasElement, context: CanvasRenderingContext2D }}
 */
export function createImageCanvas(width, height) {
  const element = globalThis.document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d");
  if (!context) {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      "The GM client could not create a 2D canvas context to compose the image"
    );
  }
  return { element, context };
}

/**
 * @param {HTMLCanvasElement} element
 * @param {string} format
 * @param {Record<string, unknown>} details
 * @returns {Promise<{ dataUrl: string, mimeType: string, width: number, height: number, sizeBytes: number }>}
 */
export async function encodeRenderedImage(element, format, details) {
  const dataUrl = element.toDataURL(`image/${format}`, RENDERED_IMAGE_QUALITY);
  const sizeBytes = decodedDataUrlBytes(dataUrl);
  if (sizeBytes > RENDERED_IMAGE_MAX_BYTES) {
    throw createBridgeError(
      ERROR_CODES.PAYLOAD_TOO_LARGE,
      `The rendered image is ${sizeBytes} bytes, above the ${RENDERED_IMAGE_MAX_BYTES}-byte limit for a rendered image; request a smaller size, or webp instead of png`,
      { ...details, limit: "image-bytes", sizeBytes, limitBytes: RENDERED_IMAGE_MAX_BYTES }
    );
  }
  const decoded = await decodeDataUrlImage(dataUrl);
  return {
    dataUrl,
    mimeType: dataUrl.slice("data:".length, dataUrl.indexOf(";")),
    width: decoded.width,
    height: decoded.height,
    sizeBytes
  };
}

export function assertFogResetSupported() {
  if (isCanvasDisabled()) {
    throw createBridgeError(
      ERROR_CODES.UNSUPPORTED_OPERATION,
      "Fog of war reset requires a rendered game canvas, but the core `noCanvas` setting is enabled in this GM client session; disable it (Configure Settings → Core → Disable Canvas) and reload the client, then re-run scene.fog.reset",
      { family: "scene.fog", setting: "core.noCanvas" }
    );
  }
}

/** @returns {any} */
export function resolveFogManager() {
  const fog = globalThis.canvas?.fog;
  if (typeof fog?.reset === "function") {
    return fog;
  }
  assertFogResetSupported();
  throw createBridgeError(
    ERROR_CODES.BRIDGE_NOT_READY,
    "The GM client exposes no fog manager (`canvas.fog`) yet: the canvas is still drawing this scene for the first time in this session (Foundry creates the fog manager late in `Canvas#draw`). Wait for the canvas to finish drawing and re-run scene.fog.reset",
    { family: "scene.fog" }
  );
}

/** @returns {string | null} */
export function getViewedSceneId() {
  return globalThis.canvas?.scene?.id ?? null;
}

/** @param {string} sceneId */
export function assertSceneViewed(sceneId) {
  const viewedSceneId = getViewedSceneId();
  if (viewedSceneId !== sceneId) {
    throw createBridgeError(
      ERROR_CODES.SCENE_NOT_VIEWED,
      `Scene ${sceneId} is not the scene currently viewed by the GM client (${
        viewedSceneId ? `currently viewing ${viewedSceneId}` : "no scene is being viewed"
      }); Foundry resets fog only for the viewed scene, so view the scene in the GM client first (activate it, or open it on the canvas), then re-run scene.fog.reset`,
      { sceneId, viewedSceneId }
    );
  }
}

/** @returns {any} */
function resolveFogExplorationClass() {
  return globalThis.CONFIG?.FogExploration?.documentClass ?? globalThis.FogExploration ?? null;
}

/**
 * @param {string} sceneId
 * @returns {Promise<string[]>}
 */
export async function queryFogExplorationIds(sceneId) {
  const documentClass = resolveFogExplorationClass();
  const database = documentClass?.database;
  if (!documentClass || typeof database?.get !== "function") {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      "Foundry FogExploration database API is not available in this client session"
    );
  }

  const rows = await database.get(
    documentClass,
    { query: { scene: sceneId }, index: true, indexFields: ["_id"] },
    globalThis.game?.user
  );
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .map((row) => (typeof row?._id === "string" ? row._id : typeof row?.id === "string" ? row.id : null))
    .filter((id) => typeof id === "string" && id.length > 0);
}

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @template T
 * @param {Promise<T>} query
 * @param {number} remainingMs
 * @returns {Promise<T>}
 */
function raceQueryAgainstDeadline(query, remainingMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `no response within the remaining ${remainingMs}ms of the confirmation window (Foundry socket requests carry no timeout of their own)`
          )
        ),
      remainingMs
    );
    query.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * @param {string} sceneId
 * @param {string[]} snapshotIds
 * @returns {Promise<{ confirmed: boolean, confirmation: "observed" | "nothing-to-observe" | null, remainingIds: string[], elapsedMs: number, observedRemaining: boolean, queryError: string | null }>}
 */
export async function confirmFogReset(sceneId, snapshotIds) {
  const startedAt = Date.now();
  if (snapshotIds.length === 0) {
    return {
      confirmed: true,
      confirmation: "nothing-to-observe",

      remainingIds: [],
      elapsedMs: 0,
      observedRemaining: true,
      queryError: null
    };
  }

  const deadline = startedAt + FOG_RESET_CONFIRM_TIMEOUT_MS;

  let remainingIds = [...snapshotIds];
  let observedRemaining = false;
  let queryError = null;
  for (;;) {
    await delay(FOG_RESET_CONFIRM_POLL_INTERVAL_MS);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return {
        confirmed: false,
        confirmation: null,
        remainingIds,
        elapsedMs: Date.now() - startedAt,
        observedRemaining,
        queryError
      };
    }
    let present;
    try {
      present = new Set(await raceQueryAgainstDeadline(queryFogExplorationIds(sceneId), remainingMs));
      queryError = null;
    } catch (error) {
      const raw = /** @type {any} */ (error);
      queryError = raw?.message ?? String(error);
      if (Date.now() >= deadline) {
        return {
          confirmed: false,
          confirmation: null,
          remainingIds,
          elapsedMs: Date.now() - startedAt,
          observedRemaining,
          queryError
        };
      }
      continue;
    }
    remainingIds = snapshotIds.filter((id) => present.has(id));
    observedRemaining = true;
    if (remainingIds.length === 0) {
      return {
        confirmed: true,
        confirmation: "observed",
        remainingIds: [],
        elapsedMs: Date.now() - startedAt,
        observedRemaining: true,
        queryError: null
      };
    }
    if (Date.now() >= deadline) {
      return {
        confirmed: false,
        confirmation: null,
        remainingIds,
        elapsedMs: Date.now() - startedAt,
        observedRemaining: true,
        queryError: null
      };
    }
  }
}
