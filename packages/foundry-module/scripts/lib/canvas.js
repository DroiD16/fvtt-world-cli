import {
  ERROR_CODES,
  FOG_RESET_CONFIRM_POLL_INTERVAL_MS,
  FOG_RESET_CONFIRM_TIMEOUT_MS
} from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

/** @returns {boolean} */
export function isCanvasDisabled() {
  try {
    return globalThis.game?.settings?.get?.("core", "noCanvas") === true;
  } catch {
    return false;
  }
}

/** @param {any} scene */
export function assertThumbnailApiAvailable(scene) {
  if (typeof scene?.createThumbnail !== "function") {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      "Foundry Scene#createThumbnail is not available in this client session"
    );
  }
}

/** @param {any} scene */
export function assertThumbnailSupported(scene) {
  assertThumbnailApiAvailable(scene);

  if (isCanvasDisabled()) {
    throw createBridgeError(
      ERROR_CODES.UNSUPPORTED_OPERATION,
      "Thumbnail generation requires a rendered game canvas, but the core `noCanvas` setting is enabled in this GM client session; disable it (Configure Settings → Core → Disable Canvas) and reload the client, then re-run scene.thumbnail.generate",
      { setting: "core.noCanvas" }
    );
  }

  const user = globalThis.game?.user;
  if (typeof user?.can === "function" && !user.can("FILES_UPLOAD")) {
    throw createBridgeError(
      ERROR_CODES.THUMBNAIL_UPLOAD_DENIED,
      "The bridge GM session lacks the core FILES_UPLOAD permission, which Foundry requires to generate a scene thumbnail; grant the GM role File Upload permission (Configure Permissions) and retry",
      { permission: "FILES_UPLOAD" }
    );
  }
}

/**
 * @param {any} scene
 * @param {{ width: number, height: number }} dimensions
 * @returns {Promise<{ thumb: string, reportedWidth: number | null, reportedHeight: number | null }>}
 */
export async function renderSceneThumbnail(scene, { width, height }) {
  assertThumbnailApiAvailable(scene);

  let result;
  try {
    result = await scene.createThumbnail({ width, height });
  } catch (error) {
    const raw = /** @type {any} */ (error);

    if (raw?.cause?.thumbUploadDenied) {
      throw createBridgeError(
        ERROR_CODES.THUMBNAIL_UPLOAD_DENIED,
        "Foundry refused to generate the thumbnail: the bridge GM session lacks the core FILES_UPLOAD permission; grant the GM role File Upload permission (Configure Permissions) and retry",
        { sceneId: scene?.id ?? null, permission: "FILES_UPLOAD" }
      );
    }

    if (isCanvasDisabled()) {
      throw createBridgeError(
        ERROR_CODES.UNSUPPORTED_OPERATION,
        "Thumbnail generation requires a rendered game canvas, but the core `noCanvas` setting is enabled in this GM client session",
        { setting: "core.noCanvas" }
      );
    }
    throw createBridgeError(
      ERROR_CODES.THUMBNAIL_RENDER_FAILED,
      `Foundry could not render a thumbnail for scene ${scene?.id ?? "unknown"}: ${raw?.message ?? String(error)}`,
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
