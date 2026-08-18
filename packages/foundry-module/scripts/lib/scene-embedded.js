import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";
import { canonicalizeFilePathFields } from "./file-access.js";

import { getFoundryGeneration } from "./foundry-capabilities.js";
import { getActorById, getGame, getSceneById } from "./game-collections.js";
import { AUTHOR_BEARING_EMBEDDED_TYPES, sanitizeEmbeddedData } from "./sanitize.js";
import {
  assertRegionBehaviorsAllowed,
  assertRegionBehaviorsSuppliedAsArray
} from "./region-behavior-guards.js";
import {
  cloneDocument,
  previewDocumentCreate,
  previewDocumentUpdate,
  resolveEmbeddedDocumentClass
} from "./world-docs.js";

export async function previewSceneEmbeddedUpdate(document, patch) {
  const canonical = canonicalizeFilePathFields(patch ?? {}, document?.documentName);
  return previewDocumentUpdate(
    document,
    sanitizeEmbeddedData(canonical, { preserveNestedBehaviorIds: true })
  );
}

export function previewSceneEmbeddedCreate(scene, type, data) {
  return previewPreparedSceneEmbeddedCreate(scene, type, prepareSceneEmbeddedCreateData(type, data));
}

/**
 * @param {any} scene
 * @param {string} type
 * @param {Record<string, any>} preparedData
 */
export function previewPreparedSceneEmbeddedCreate(scene, type, preparedData) {
  return previewDocumentCreate(
    resolveEmbeddedDocumentClass(sceneEmbeddedCollection(scene, type), type),
    preparedData,
    {
      parent: scene
    }
  );
}

/**
 * @param {any} scene
 * @param {string} type
 */
export function getSceneEmbeddedCollection(scene, type) {
  return sceneEmbeddedCollection(scene, type);
}

export async function createSceneEmbeddedMany(scene, type, payloads) {
  if (typeof scene?.createEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Scene embedded document API is not available");
  }
  return scene.createEmbeddedDocuments(type, payloads, { keepId: true, render: true });
}

export async function updateSceneEmbeddedMany(scene, type, entries) {
  if (typeof scene?.updateEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Scene embedded document API is not available");
  }
  return scene.updateEmbeddedDocuments(type, entries, { diff: true, render: true });
}

export async function deleteSceneEmbeddedMany(scene, type, ids) {
  if (typeof scene?.deleteEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Scene embedded document API is not available");
  }
  return scene.deleteEmbeddedDocuments(type, ids, { render: true });
}

const SCENE_EMBEDDED_COLLECTIONS = Object.freeze({
  Token: "tokens",
  Tile: "tiles",
  AmbientSound: "sounds",
  Wall: "walls",
  Note: "notes",
  Drawing: "drawings",
  AmbientLight: "lights",
  MeasuredTemplate: "templates",
  Region: "regions"
});

const SCENE_EMBEDDED_LIST_COMMANDS = Object.freeze({
  Token: "scene.token.list",
  Tile: "scene.tile.list",
  AmbientSound: "scene.sound.list",
  Wall: "scene.wall.list",
  Note: "scene.note.list",
  Drawing: "scene.drawing.list",
  AmbientLight: "scene.light.list",
  MeasuredTemplate: "scene.template.list",
  Region: "scene.region.list"
});

function sceneEmbeddedCollection(scene, type) {
  const property = SCENE_EMBEDDED_COLLECTIONS[type];
  return property ? (scene[property] ?? null) : null;
}

export function assertSceneTemplatesSupported(scene) {
  const source = typeof scene?.toObject === "function" ? scene.toObject() : scene;
  if (!source || !("templates" in source)) {
    throw createBridgeError(
      ERROR_CODES.UNSUPPORTED_OPERATION,
      "Measured templates are not a Scene embedded collection in this Foundry version (removed from the Scene schema in v14); scene.template.* is supported on v13 only — on v14 place measured templates through the Foundry UI instead",
      { family: "scene.template", collection: "MeasuredTemplate" }
    );
  }
}

export function assertSceneLevelsFieldsSupported(data) {
  if (!data || typeof data !== "object") return;
  const has = (key) => Object.prototype.hasOwnProperty.call(data, key);
  const supplied = [];
  if (has("foreground")) supplied.push("foreground");
  if (has("foregroundElevation")) supplied.push("foregroundElevation");
  if (has("background")) supplied.push("background");
  if (has("backgroundColor")) supplied.push("backgroundColor");

  if (
    data.fog &&
    typeof data.fog === "object" &&
    (Object.prototype.hasOwnProperty.call(data.fog, "overlay") ||
      Object.prototype.hasOwnProperty.call(data.fog, "-=overlay"))
  ) {
    supplied.push("fog.overlay");
  }
  if (supplied.length === 0) return;
  const generation = getFoundryGeneration();
  if (generation !== null && generation >= 14) {
    throw createBridgeError(
      ERROR_CODES.UNSUPPORTED_OPERATION,
      "Scene `foreground`/`foregroundElevation`/`background`/`backgroundColor`/`fog.overlay` are not top-level Scene fields in this Foundry version (v14 moved them into the per-level `levels[]` collection; its top-level compatibility shim is partial on create and discards the mapped delta entirely on update, so a supplied value is not guaranteed to land). They are supported on v13 only — on v14 set the background/foreground/fog-overlay through the per-level `levels[]` config in the Foundry UI instead (`fog.mode`/`fog.colors` remain top-level and are unaffected)",
      { family: "scene", fields: supplied }
    );
  }
}

export function getSceneEmbeddedById(sceneId, type, embeddedId, notFoundCode, idField) {
  const scene = getSceneById(sceneId);
  const document = sceneEmbeddedCollection(scene, type)?.get?.(embeddedId) ?? null;
  if (!document) {
    const listCommand = SCENE_EMBEDDED_LIST_COMMANDS[type];
    const hint = listCommand ? `; use ${listCommand} to find valid ids` : "";
    throw createBridgeError(notFoundCode, `${type} ${embeddedId} was not found${hint}`, {
      sceneId,
      [idField]: embeddedId
    });
  }

  return { scene, document };
}

/**
 * @param {string} type
 * @param {Record<string, any>} data
 */
export function prepareSceneEmbeddedCreateData(type, data) {
  if (type === "Region") {
    assertRegionBehaviorsSuppliedAsArray(data);
    assertRegionBehaviorsAllowed(data?.behaviors);
  }
  return sanitizeEmbeddedData(canonicalizeFilePathFields(data, type));
}

/**
 * @param {string} type
 * @param {Record<string, any>} patch
 * @param {any} [existingDocument]
 */
export function prepareSceneEmbeddedUpdateData(type, patch, existingDocument = null) {
  if (type === "Region") {
    assertRegionBehaviorsSuppliedAsArray(patch);
    assertRegionBehaviorsAllowed(patch?.behaviors, existingDocument);
  }
  return sanitizeEmbeddedData(canonicalizeFilePathFields(patch, type), { preserveNestedBehaviorIds: true });
}

export async function createSceneEmbedded(scene, type, data, { dryRun = false } = {}) {
  if (typeof scene.createEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Scene embedded document API is not available");
  }

  const prepared = prepareSceneEmbeddedCreateData(type, data);

  if (dryRun) {
    return prepared;
  }

  const results = await scene.createEmbeddedDocuments(type, [prepared], {
    render: true
  });
  const document = Array.isArray(results) ? (results[0] ?? null) : results;
  if (!document) {
    throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, `${type} creation returned no document`);
  }

  return document;
}

export async function updateSceneEmbedded(
  sceneId,
  type,
  embeddedId,
  patch,
  notFoundCode,
  idField,
  { dryRun = false } = {}
) {
  const { scene, document } = getSceneEmbeddedById(sceneId, type, embeddedId, notFoundCode, idField);

  const preparedPatch = prepareSceneEmbeddedUpdateData(type, patch, document);

  if (dryRun) {
    return document;
  }

  await scene.updateEmbeddedDocuments(type, [{ _id: embeddedId, ...preparedPatch }], {
    diff: true,
    render: true
  });

  return sceneEmbeddedCollection(scene, type).get(embeddedId);
}

export async function deleteSceneEmbedded(
  sceneId,
  type,
  embeddedId,
  notFoundCode,
  idField,
  { dryRun = false } = {}
) {
  const { scene } = getSceneEmbeddedById(sceneId, type, embeddedId, notFoundCode, idField);

  if (dryRun) {
    return;
  }

  await scene.deleteEmbeddedDocuments(type, [embeddedId], { render: true });
}

export async function cloneSceneEmbedded(
  sceneId,
  type,
  embeddedId,
  patch,
  notFoundCode,
  idField,
  { dryRun = false } = {}
) {
  const { document } = getSceneEmbeddedById(sceneId, type, embeddedId, notFoundCode, idField);

  const overrides = sanitizeEmbeddedData(canonicalizeFilePathFields(patch ?? {}, type));

  if (type === "Region") {
    assertRegionBehaviorsSuppliedAsArray(patch);
    assertRegionBehaviorsAllowed(patch?.behaviors, document);
  }

  if (AUTHOR_BEARING_EMBEDDED_TYPES.has(type)) {
    const userId = getGame().user?.id;
    if (userId) {
      overrides.author = userId;
    }
  }

  return cloneDocument(document, overrides, { dryRun });
}

export async function buildTokenDataFromActor(actorId, overrides, scene) {
  const actor = getActorById(actorId);
  if (typeof actor.getTokenDocument !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Actor.getTokenDocument is not available");
  }
  if (!scene) {
    throw createBridgeError(
      ERROR_CODES.INTERNAL_ERROR,
      "Internal error: the target scene was not passed to the token create resolution; nothing was written"
    );
  }

  const tokenDocument = await actor.getTokenDocument(overrides, { parent: scene });
  return typeof tokenDocument?.toObject === "function" ? tokenDocument.toObject() : tokenDocument;
}

/**
 * @param {Record<string, any>} data
 * @param {any} scene
 */
export async function resolveSceneTokenCreateData(data, scene) {
  const { actorId, ...overrides } = data ?? {};
  if (!actorId) {
    return overrides;
  }

  return buildTokenDataFromActor(actorId, { ...overrides, actorLink: overrides.actorLink ?? false }, scene);
}
