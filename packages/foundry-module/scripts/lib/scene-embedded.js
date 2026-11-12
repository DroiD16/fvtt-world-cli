import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";
import { canonicalizeFilePathFields } from "./file-access.js";
import {
  applyConfirmedUpdate,
  assertDocumentDeleteCommitted,
  assertRequestedWriteStorable,
  writeCommitted
} from "./write-confirmation.js";

import { hasSceneLevels } from "./foundry-capabilities.js";
import { getActorById, getGame, getSceneById } from "./game-collections.js";
import { AUTHOR_BEARING_EMBEDDED_TYPES, payloadKeyField, sanitizeEmbeddedData } from "./sanitize.js";
import {
  assertRegionBehaviorsAllowed,
  assertRegionBehaviorsSuppliedAsArray
} from "./region-behavior-guards.js";
import {
  cloneDocument,
  createReturnedNothingError,
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
  Region: "regions",
  Level: "levels"
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
  Region: "scene.region.list",
  Level: "scene.level.list"
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

/** @param {Record<string, unknown>} details */
export function assertLevelsSupported(details) {
  if (!hasSceneLevels()) {
    throw createBridgeError(
      ERROR_CODES.UNSUPPORTED_OPERATION,
      "Scene levels exist only on Foundry v14 and later: this Foundry version has no Level document and no `initialLevel` field. On v13 a scene has one map, set through the scene's own `background`, `backgroundColor`, `foreground` and `foregroundElevation` fields",
      details
    );
  }
}

export function assertSceneLevelsFieldsSupported(data) {
  if (!data || typeof data !== "object") return;
  const has = (key) => Object.prototype.hasOwnProperty.call(data, key);
  const levelFields = ["levels", "initialLevel"].filter(has);
  if (levelFields.length > 0) {
    assertLevelsSupported({ family: "scene", fields: levelFields });
  }

  const supplied = ["foreground", "foregroundElevation", "background", "backgroundColor"].filter(has);
  if (
    data.fog &&
    typeof data.fog === "object" &&
    (Object.prototype.hasOwnProperty.call(data.fog, "overlay") ||
      Object.prototype.hasOwnProperty.call(data.fog, "-=overlay"))
  ) {
    supplied.push("fog.overlay");
  }
  if (supplied.length === 0) return;
  if (hasSceneLevels()) {
    throw createBridgeError(
      ERROR_CODES.UNSUPPORTED_OPERATION,
      "Foundry v14 stores a scene's background, background color, foreground, foreground elevation and fog overlay on each of its levels, not on the scene, and ignores these scene fields when they are written. Set them on a level instead: through `levels` in scene.create data for a new scene, or with scene.level.update for an existing one (scene.level.list gives the level ids). `fog.mode` and `fog.colors` remain scene fields",
      { family: "scene", fields: supplied }
    );
  }
}

/**
 * @param {string} type
 * @param {Record<string, any>} data
 */
function assertPlaceableLevelFieldsSupported(type, data) {
  if (hasSceneLevels()) return;
  const fields = [
    ...new Set(
      Object.keys(data)
        .map(payloadKeyField)
        .filter((field) => field === "level" || field === "levels")
    )
  ];
  if (fields.length === 0) return;
  throw createBridgeError(
    ERROR_CODES.UNSUPPORTED_OPERATION,
    `Placeable level membership exists only on Foundry v14 and later: ${type} documents on this Foundry version have no \`level\` or \`levels\` field, and Foundry would silently discard the value. Remove ${fields.join(" and ")} from the data; on v13 every placeable belongs to the scene's single map. Nothing was written`,
    { family: SCENE_EMBEDDED_LIST_COMMANDS[type].slice(0, -".list".length), fields }
  );
}

/**
 * @param {Record<string, any> | undefined} patch
 * @param {string[]} levelIds
 * @param {Record<string, unknown>} details
 */
export function assertInitialLevelExists(patch, levelIds, details) {
  const levelId = patch?.initialLevel;
  if (levelId === undefined || levelId === null || levelIds.includes(levelId)) return;
  throw createBridgeError(
    ERROR_CODES.LEVEL_NOT_FOUND,
    `initialLevel ${levelId} is not a level of the target scene; its levels are ${levelIds.join(", ")} (scene.level.list reports them with names). Pass one of these ids or omit initialLevel. To reset a scene to its first level, send initialLevel as JSON null through scene.update (on the CLI: scene update --patch-json '{"initialLevel":null}'). Nothing was written`,
    { ...details, levelId }
  );
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
  assertPlaceableLevelFieldsSupported(type, data);
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
  assertPlaceableLevelFieldsSupported(type, patch);
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
    throw createReturnedNothingError(`${type} creation`);
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
    await assertRequestedWriteStorable({
      document,
      patch: preparedPatch,
      subject: `${type} ${embeddedId} of scene ${sceneId}`,
      details: { sceneId, [idField]: embeddedId }
    });
    return document;
  }

  await applyConfirmedUpdate({
    document,
    patch: preparedPatch,
    write: (payload) =>
      scene.updateEmbeddedDocuments(type, [{ _id: embeddedId, ...payload }], {
        diff: true,
        render: true
      }),
    subject: `${type} ${embeddedId} of scene ${sceneId}`,
    hookName: `preUpdate${type}`,
    details: { sceneId, [idField]: embeddedId }
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

  const results = await scene.deleteEmbeddedDocuments(type, [embeddedId], { render: true });
  assertDocumentDeleteCommitted({
    committed: writeCommitted(results),
    subject: `${type} ${embeddedId} of scene ${sceneId}`,
    hookName: `preDelete${type}`,
    details: { sceneId, [idField]: embeddedId }
  });
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

  assertPlaceableLevelFieldsSupported(type, patch);
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
  assertPlaceableLevelFieldsSupported("Token", data);
  const { actorId, ...fields } = data ?? {};
  const overrides = fields.sort === undefined ? { ...fields, sort: nextTokenSort(scene) } : fields;
  return actorId ? buildTokenDataFromActor(actorId, overrides, scene) : overrides;
}

/**
 * @param {any} scene
 * @param {Record<string, any>} data
 * @param {{ center?: boolean, snap?: boolean } | undefined} placement
 */
export function placeTokenData(scene, data, placement) {
  if (!placement?.center && !placement?.snap) return data;
  const token = previewPreparedSceneEmbeddedCreate(scene, "Token", data);
  const { x, y, elevation, width, height, shape } = token._source;
  let position = { x, y, elevation, width, height, shape };
  if (placement.center) {
    const pivot = token.getCenterPoint({ x: 0, y: 0, elevation: 0, width, height, shape });
    position = { ...position, x: x - pivot.x, y: y - pivot.y };
  }
  if (placement.snap) {
    const snapped = token.getSnappedPosition(position);
    position = { ...position, x: snapped.x, y: snapped.y };
  }
  return { ...data, x: Math.round(position.x), y: Math.round(position.y) };
}

/** @param {any} scene */
function nextTokenSort(scene) {
  let max = -Infinity;
  for (const token of scene?.tokens ?? []) max = Math.max(max, token.sort ?? 0);
  return Math.max(max + 1, 0);
}
