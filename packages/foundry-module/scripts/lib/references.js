import { AUDIT_FILE_SCOPES, ERROR_CODES, REFERENCES_MAX_MATCHES } from "../generated/protocol.js";
import { SCOPE_COLLECTIONS } from "./audit.js";
import { createBridgeError } from "./errors.js";
import { paginate } from "./pagination.js";
import { getGame } from "./validators.js";

const DOCUMENT_TYPE_PATTERN = /^[A-Z][A-Za-z]*$/;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9]+$/;
const PACK_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const EMBEDDED_CONTINUATION = /^(?:\.[A-Z][A-Za-z]*\.[A-Za-z0-9]+)+/;
const BEFORE_BOUNDARY = /[A-Za-z0-9.]/;
const AFTER_BOUNDARY = /[A-Za-z0-9]/;
const LINK_PREFIX = /@[A-Za-z]+\[$/;

/**
 * @param {string} documentName
 */
function isLegacyLinkType(documentName) {
  const constants = /** @type {any} */ (globalThis).CONST ?? {};
  const linkTypes = Array.isArray(constants.DOCUMENT_LINK_TYPES) ? constants.DOCUMENT_LINK_TYPES : [];
  const worldTypes = Array.isArray(constants.WORLD_DOCUMENT_TYPES) ? constants.WORLD_DOCUMENT_TYPES : [];
  return linkTypes.includes(documentName) && worldTypes.includes(documentName);
}

/**
 * @param {string} uuid
 */
function invalidUuid(uuid) {
  return createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `${JSON.stringify(uuid)} is not a document UUID. A world UUID is <Type>.<id> with optional embedded ` +
      "<Type>.<id> pairs (Actor.abc, Scene.abc.Token.def); a compendium UUID is " +
      "Compendium.<package>.<pack>.<Type>.<id>",
    { uuid }
  );
}

/**
 * @param {string[]} parts
 */
function isTypeIdChain(parts) {
  if (parts.length === 0 || parts.length % 2 !== 0) return false;
  for (let index = 0; index < parts.length; index += 2) {
    if (!DOCUMENT_TYPE_PATTERN.test(parts[index]) || !DOCUMENT_ID_PATTERN.test(parts[index + 1]))
      return false;
  }
  return true;
}

/**
 * @param {string[]} prefix
 * @param {string[]} chain
 */
function describeParent(prefix, chain) {
  if (chain.length <= 2) return null;
  return {
    uuid: [...prefix, ...chain.slice(0, -2)].join("."),
    documentName: chain[chain.length - 4],
    id: chain[chain.length - 3],
    embedded: chain.length > 4
  };
}

/**
 * @param {string} uuid
 */
export function parseReferenceTarget(uuid) {
  const parts = uuid.split(".");
  if (parts[0] === "Compendium") {
    const [, scope, pack, ...chain] = parts;
    if (!scope || !pack || !PACK_SEGMENT_PATTERN.test(scope) || !PACK_SEGMENT_PATTERN.test(pack)) {
      throw invalidUuid(uuid);
    }
    if (!isTypeIdChain(chain)) throw invalidUuid(uuid);
    return {
      uuid,
      compendium: `${scope}.${pack}`,
      documentName: chain[chain.length - 2],
      id: chain[chain.length - 1],
      primary: chain.length === 2,
      parent: describeParent(["Compendium", scope, pack], chain)
    };
  }
  if (!isTypeIdChain(parts)) throw invalidUuid(uuid);
  const constants = /** @type {any} */ (globalThis).CONST ?? {};
  const worldTypes = Array.isArray(constants.WORLD_DOCUMENT_TYPES) ? constants.WORLD_DOCUMENT_TYPES : null;
  const embeddedTypes = Array.isArray(constants.EMBEDDED_DOCUMENT_TYPES)
    ? constants.EMBEDDED_DOCUMENT_TYPES
    : [];
  if (parts.length === 2 && worldTypes !== null && !worldTypes.includes(parts[0])) {
    if (!embeddedTypes.includes(parts[0])) throw invalidUuid(uuid);
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `${parts[0]} is an embedded document type, so ${uuid} names no single document: its id is unique only ` +
        "within its parent. Pass the full UUID with the parent chain, such as " +
        "JournalEntry.<journalId>.JournalEntryPage.<pageId> or Scene.<sceneId>.Token.<tokenId>",
      { uuid, documentName: parts[0] }
    );
  }
  return {
    uuid,
    compendium: null,
    documentName: parts[parts.length - 2],
    id: parts[parts.length - 1],
    primary: parts.length === 2,
    parent: describeParent([], parts)
  };
}

/**
 * @param {ReturnType<typeof parseReferenceTarget>} target
 */
function describeTarget(target) {
  let document = null;
  try {
    const resolve = /** @type {any} */ (globalThis).fromUuidSync;
    document = typeof resolve === "function" ? resolve(target.uuid, { strict: false }) : null;
  } catch {
    document = null;
  }
  const name = typeof document?.name === "string" ? document.name : null;
  return {
    uuid: target.uuid,
    documentName: target.documentName,
    id: target.id,
    exists: document ? true : target.compendium ? null : false,
    name
  };
}

/**
 * @param {string} text
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {ReturnType<typeof parseReferenceTarget>} target
 */
function buildLegacyLinkPatterns(target) {
  if (!target.primary) return [];
  if (target.compendium === null) {
    return isLegacyLinkType(target.documentName)
      ? [new RegExp(`@${target.documentName}\\[${escapeRegExp(target.id)}(?:#[^\\]]*)?\\]`)]
      : [];
  }
  return [
    new RegExp(
      `@Compendium\\[${escapeRegExp(target.compendium)}\\.${escapeRegExp(target.id)}(?:#[^\\]]*)?\\]`
    )
  ];
}

/**
 * @param {ReturnType<typeof parseReferenceTarget>} target
 */
function createStringMatcher(target) {
  const needles = [target.uuid];
  if (target.compendium !== null && target.primary) {
    needles.push(`Compendium.${target.compendium}.${target.id}`);
  }
  const legacy = buildLegacyLinkPatterns(target);

  /**
   * @param {string} text
   * @returns {Array<{ match: string, matchedUuid?: string }>}
   */
  return (text) => {
    const found = [];
    for (const needle of needles) {
      let index = text.indexOf(needle);
      while (index !== -1) {
        const before = index > 0 ? text[index - 1] : "";
        const end = index + needle.length;
        const after = end < text.length ? text[end] : "";
        if (!BEFORE_BOUNDARY.test(before) && !AFTER_BOUNDARY.test(after)) {
          const continuation = EMBEDDED_CONTINUATION.exec(text.slice(end));
          if (continuation) {
            found.push({ match: "embedded", matchedUuid: `${needle}${continuation[0]}` });
          } else {
            found.push({
              match: LINK_PREFIX.test(text.slice(Math.max(0, index - 32), index)) ? "link" : "uuid"
            });
          }
        }
        index = text.indexOf(needle, index + 1);
      }
    }
    for (const pattern of legacy) {
      if (pattern.test(text)) found.push({ match: "link" });
    }
    return found;
  };
}

/** @type {WeakMap<object, Array<{ segments: string[], documentName: string }>>} */
const foreignKeyCache = new WeakMap();

/**
 * @param {string} documentName
 */
function resolveDocumentClass(documentName) {
  const config = /** @type {any} */ (globalThis).CONFIG?.[documentName];
  return config?.documentClass ?? null;
}

/**
 * @param {any} field
 * @param {string[]} segments
 * @param {Array<{ segments: string[], documentName: string }>} out
 * @param {any} fields
 */
function collectForeignKeys(field, segments, out, fields) {
  if (!field || typeof field !== "object") return;
  if (fields.ForeignDocumentField && field instanceof fields.ForeignDocumentField) {
    const documentName = field.model?.documentName;
    if (typeof documentName === "string") out.push({ segments, documentName });
    return;
  }
  if (fields.EmbeddedCollectionField && field instanceof fields.EmbeddedCollectionField) return;
  if (fields.EmbeddedDocumentField && field instanceof fields.EmbeddedDocumentField) return;
  if (fields.SchemaField && field instanceof fields.SchemaField) {
    for (const [key, child] of Object.entries(field.fields ?? {})) {
      collectForeignKeys(child, [...segments, key], out, fields);
    }
  }
}

/**
 * @param {string} documentName
 */
function foreignKeysOf(documentName) {
  const documentClass = resolveDocumentClass(documentName);
  if (!documentClass) return [];
  const cached = foreignKeyCache.get(documentClass);
  if (cached) return cached;
  /** @type {Array<{ segments: string[], documentName: string }>} */
  const out = [];
  const fields = /** @type {any} */ (globalThis).foundry?.data?.fields ?? {};
  collectForeignKeys(documentClass.schema, [], out, fields);
  foreignKeyCache.set(documentClass, out);
  return out;
}

/**
 * @param {string} documentName
 * @returns {Record<string, string>}
 */
function embeddedCollectionsOf(documentName) {
  const embedded = resolveDocumentClass(documentName)?.metadata?.embedded;
  return embedded && typeof embedded === "object" ? embedded : {};
}

/**
 * @param {unknown} value
 * @param {string[]} path
 */
function readAt(value, path) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key)) return undefined;
    current = /** @type {any} */ (current)[key];
  }
  return current;
}

// Foundry resolves a Combatant whose sceneId is null through its Combat's scene (Combatant#token).
const NULL_PARENT_CONTAINER_FIELDS = Object.freeze({ "Combatant.sceneId": "scene" });

/**
 * @typedef {{ documentName: string, source: Record<string, any>, uuid: string }} ReferenceOwner
 */

/**
 * @param {ReturnType<typeof parseReferenceTarget>} target
 * @param {ReferenceOwner & { container: ReferenceOwner | null }} owner
 * @param {{ segments: string[] }} foreignKey
 * @param {string[]} path
 */
function foreignKeyNamesTargetParent(target, owner, foreignKey, path) {
  const parent = target.parent;
  if (parent === null) return true;
  if (parent.embedded) return false;
  const prefix = foreignKey.segments.slice(0, -1);
  const sibling = foreignKeysOf(owner.documentName).find(
    (candidate) =>
      candidate.documentName === parent.documentName &&
      candidate.segments.length === foreignKey.segments.length &&
      prefix.every((segment, index) => candidate.segments[index] === segment)
  );
  if (sibling) {
    const siblingField = sibling.segments[sibling.segments.length - 1];
    const siblingValue = readAt(owner.source, [...path.slice(0, -1), siblingField]);
    const containerField = NULL_PARENT_CONTAINER_FIELDS[`${owner.documentName}.${siblingField}`];
    if (siblingValue == null && containerField && owner.container !== null) {
      return readAt(owner.container.source, [containerField]) === parent.id;
    }
    return siblingValue === parent.id;
  }
  return owner.uuid === parent.uuid || owner.uuid.startsWith(`${parent.uuid}.`);
}

/**
 * @param {{ uuid: string, scope?: string[], limit?: number, offset?: number }} params
 */
export function runReferenceLookup({ uuid, scope, limit, offset }) {
  const game = getGame();
  const target = parseReferenceTarget(uuid);
  const matchString = createStringMatcher(target);
  const scopes = Array.isArray(scope) && scope.length > 0 ? [...new Set(scope)] : [...AUDIT_FILE_SCOPES];

  /** @type {Map<string, { uuid: string, documentName: string, name: string | null, field: string, match: string, matchedUuid?: string }>} */
  const references = new Map();
  let scannedDocuments = 0;
  let selfReferences = 0;

  const isInsideTarget = (/** @type {string} */ ownerUuid) =>
    target.compendium === null && (ownerUuid === target.uuid || ownerUuid.startsWith(`${target.uuid}.`));

  /**
   * @param {{ uuid: string, documentName: string, name: string | null }} owner
   * @param {string[]} path
   * @param {{ match: string, matchedUuid?: string }} hit
   */
  const record = (owner, path, hit) => {
    if (isInsideTarget(owner.uuid)) {
      selfReferences += 1;
      return;
    }
    const field = path.join(".");
    const key = `${owner.uuid}\u0000${field}\u0000${hit.match}\u0000${hit.matchedUuid ?? ""}`;
    if (references.has(key)) return;
    references.set(key, { ...owner, field, ...hit });
    if (references.size > REFERENCES_MAX_MATCHES) {
      throw createBridgeError(
        ERROR_CODES.QUERY_TOO_BROAD,
        `More than ${REFERENCES_MAX_MATCHES} stored references to ${target.uuid} were found; the lookup is ` +
          "refused rather than answered with an inexact total. Narrow it with scope (one document family per call)",
        { uuid: target.uuid, cap: REFERENCES_MAX_MATCHES, scope: scopes }
      );
    }
  };

  /**
   * @param {unknown} value
   * @param {string[]} path
   * @param {{ uuid: string, documentName: string, name: string | null }} owner
   */
  const walkValue = (value, path, owner) => {
    if (typeof value === "string") {
      for (const hit of matchString(value)) record(owner, path, hit);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walkValue(entry, [...path, String(index)], owner));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) walkValue(entry, [...path, key], owner);
    }
  };

  /**
   * @param {string} documentName
   * @param {Record<string, any>} source
   * @param {{ uuid: string, documentName: string, name: string | null }} owner
   * @param {string[]} prefix
   * @param {ReferenceOwner | null} container
   */
  const walkSource = (documentName, source, owner, prefix, container) => {
    if (target.compendium === null) {
      for (const foreignKey of foreignKeysOf(documentName)) {
        if (foreignKey.documentName !== target.documentName) continue;
        if (foreignKey.segments.some((segment) => segment.startsWith("_"))) continue;
        if (readAt(source, foreignKey.segments) !== target.id) continue;
        if (
          foreignKeyNamesTargetParent(
            target,
            { documentName, source, uuid: owner.uuid, container },
            foreignKey,
            foreignKey.segments
          )
        ) {
          record(owner, [...prefix, ...foreignKey.segments], { match: "id" });
        }
      }
    }

    const embeddedFields = new Map(
      Object.entries(embeddedCollectionsOf(documentName)).map(([name, field]) => [field, name])
    );
    const self = { documentName, source, uuid: owner.uuid };
    for (const [key, value] of Object.entries(source ?? {})) {
      const embeddedName = embeddedFields.get(key);
      if (embeddedName && Array.isArray(value)) {
        value.forEach((child, index) => {
          if (!child || typeof child !== "object" || typeof child._id !== "string") return;
          if (prefix.length > 0) {
            walkSource(embeddedName, child, owner, [...prefix, key, String(index)], self);
          } else {
            walkDocument(embeddedName, child, `${owner.uuid}.${embeddedName}.${child._id}`, self);
          }
        });
        continue;
      }
      if (embeddedName && value && typeof value === "object") {
        walkSource(embeddedName, value, owner, [...prefix, key], self);
        continue;
      }
      walkValue(value, [...prefix, key], owner);
    }
  };

  /**
   * @param {string} documentName
   * @param {Record<string, any>} source
   * @param {string} ownerUuid
   * @param {ReferenceOwner | null} container
   */
  const walkDocument = (documentName, source, ownerUuid, container) => {
    scannedDocuments += 1;
    const owner = {
      uuid: ownerUuid,
      documentName,
      name: typeof source?.name === "string" ? source.name : null
    };
    walkSource(documentName, source, owner, [], container);
  };

  /** @param {any} collection */
  const walkCollection = (collection) => {
    for (const document of Array.from(collection ?? [])) {
      const source = typeof document?.toObject === "function" ? document.toObject() : document;
      const documentName = document?.documentName ?? collection?.documentName;
      const id = document?.id ?? source?._id;
      if (typeof documentName !== "string" || typeof id !== "string") continue;
      walkDocument(documentName, source, `${documentName}.${id}`, null);
    }
  };

  for (const scopeName of scopes) {
    walkCollection(/** @type {any} */ (game)?.[SCOPE_COLLECTIONS[scopeName]]);
  }
  walkCollection(/** @type {any} */ (game)?.users);

  const compare = (/** @type {string} */ left, /** @type {string} */ right) =>
    left < right ? -1 : left > right ? 1 : 0;
  const sorted = Array.from(references.values()).sort(
    (left, right) =>
      compare(left.uuid, right.uuid) || compare(left.field, right.field) || compare(left.match, right.match)
  );

  const { page, total, hasMore } = paginate(sorted, { limit, offset });
  return {
    target: describeTarget(target),
    references: page,
    total,
    hasMore,
    scannedDocuments,
    selfReferences,
    scopes
  };
}
