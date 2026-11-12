import { ERROR_CODES, REFERENCE_DEFAULT_SCOPES, REFERENCES_MAX_MATCHES } from "../generated/protocol.js";
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
const UUID_LINK = /@UUID\[([^#\]]+)(?:#[^\]]+)?]/g;
const EMBED_LINK = /@Embed\[([^\]]+)]/gi;

const REFERENCE_SCOPE_COLLECTIONS = Object.freeze({
  ...Object.fromEntries(
    Object.entries(SCOPE_COLLECTIONS).map(([scope, key]) => [scope, (/** @type {any} */ game) => game?.[key]])
  ),
  folder: (/** @type {any} */ game) => game?.folders,
  setting: (/** @type {any} */ game) => game?.settings?.storage?.get?.("world"),
  chat: (/** @type {any} */ game) => game?.messages
});

const RELATIVE_LINK_FIELDS = Object.freeze({
  JournalEntryPage: Object.freeze([Object.freeze(["text", "content"])]),
  RollTable: Object.freeze([Object.freeze(["description"])]),
  TableResult: Object.freeze([Object.freeze(["description"])])
});

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
function referenceNeedles(target) {
  const needles = [target.uuid];
  if (target.compendium !== null && target.primary) {
    needles.push(`Compendium.${target.compendium}.${target.id}`);
  }
  return needles;
}

function knownDocumentTypes() {
  const allTypes = /** @type {any} */ (globalThis).CONST?.ALL_DOCUMENT_TYPES;
  return new Set(Array.isArray(allTypes) ? allTypes : []);
}

/**
 * @param {ReturnType<typeof parseReferenceTarget>} target
 */
function createKeyPathMatcher(target) {
  const needles = referenceNeedles(target);
  const documentTypes = knownDocumentTypes();

  /**
   * @param {string[]} path
   */
  return (path) => {
    const joined = path.join(".");
    return needles.some((needle) => {
      if (joined !== needle && !joined.endsWith(`.${needle}`)) return false;
      const before = joined.slice(0, Math.max(0, joined.length - needle.length - 1));
      const segments = before ? before.split(".") : [];
      if (segments.at(-3) === "Compendium") return false;
      return !(
        segments.length >= 2 &&
        documentTypes.has(segments[segments.length - 2]) &&
        DOCUMENT_ID_PATTERN.test(segments[segments.length - 1])
      );
    });
  };
}

/**
 * @param {ReturnType<typeof parseReferenceTarget>} target
 */
function createStringMatcher(target) {
  const needles = referenceNeedles(target);
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

/**
 * @param {string} html
 * @returns {string[]}
 */
function textNodeContents(html) {
  const Parser = /** @type {any} */ (globalThis).DOMParser;
  if (typeof Parser !== "function") return [];
  const parsed = new Parser().parseFromString(html, "text/html");
  const walker = parsed.createTreeWalker(parsed, /** @type {any} */ (globalThis).NodeFilter?.SHOW_TEXT ?? 4);
  const texts = [];
  while (walker.nextNode()) texts.push(String(walker.currentNode.textContent ?? ""));
  return texts;
}

/**
 * @param {string} text
 * @param {string} ownerUuid
 * @returns {string[]}
 */
function resolveRelativeLinks(text, ownerUuid) {
  if (!/[@&]/.test(text)) return [];
  const nodes = textNodeContents(text).filter((node) => /@UUID\[\.|@Embed\[/i.test(node));
  if (nodes.length === 0) return [];
  const parseUuid = /** @type {any} */ (globalThis).foundry?.utils?.parseUuid;
  const resolveDocument = /** @type {any} */ (globalThis).fromUuidSync;
  if (typeof parseUuid !== "function" || typeof resolveDocument !== "function") return [];
  const relative = resolveDocument(ownerUuid, { strict: false });
  if (!relative) return [];
  const textEditor = /** @type {any} */ (globalThis).foundry?.applications?.ux?.TextEditor;
  const candidates = [];
  for (const node of nodes) {
    for (const match of node.matchAll(UUID_LINK)) {
      if (match[1].startsWith(".")) candidates.push(match[1]);
    }
    if (typeof textEditor?._parseEmbedConfig !== "function") continue;
    for (const match of node.matchAll(EMBED_LINK)) {
      let config = null;
      try {
        config = textEditor._parseEmbedConfig(match[1], { relative });
      } catch {
        continue;
      }
      if (typeof config?.uuid === "string" && config.uuid.startsWith(".")) candidates.push(config.uuid);
    }
  }
  const resolved = [];
  for (const candidate of candidates) {
    const uuid = parseUuid(candidate, { relative })?.uuid;
    if (typeof uuid === "string") resolved.push(uuid);
  }
  return resolved;
}

/**
 * @param {string} documentName
 * @param {any} source
 */
function storedSource(documentName, source) {
  if (documentName !== "Setting" || typeof source?.value !== "string") return source;
  try {
    return { ...source, value: JSON.parse(source.value) };
  } catch {
    return source;
  }
}

/**
 * @param {string} documentName
 * @param {any} source
 */
function ownerName(documentName, source) {
  if (typeof source?.name === "string") return source.name;
  if (documentName === "Setting" && typeof source?.key === "string") return source.key;
  return null;
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
  const keyPathNamesTarget = createKeyPathMatcher(target);
  const scopes =
    Array.isArray(scope) && scope.length > 0 ? [...new Set(scope)] : [...REFERENCE_DEFAULT_SCOPES];

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
          "refused rather than answered with an inexact total. " +
          (scopes.length === 1
            ? `The ${scopes[0]} family alone holds that many, so no narrower scope exists`
            : "Narrow it with scope (one document family per call)"),
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
      for (const [key, entry] of Object.entries(value)) {
        const entryPath = [...path, key];
        for (const { matchedUuid } of matchString(key)) {
          record(owner, entryPath, matchedUuid ? { match: "key", matchedUuid } : { match: "key" });
        }
        if (key.endsWith(target.id) && keyPathNamesTarget(entryPath)) {
          record(owner, entryPath, { match: "key" });
        }
        walkValue(entry, entryPath, owner);
      }
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
      // Foundry declares User.hotbar as a plain ObjectField of slot -> Macro id, so the schema walk cannot find it.
      if (documentName === "User" && target.documentName === "Macro" && target.parent === null) {
        for (const [slot, id] of Object.entries(source?.hotbar ?? {})) {
          if (id === target.id) record(owner, [...prefix, "hotbar", slot], { match: "id" });
        }
      }
    }

    if (prefix.length === 0) {
      for (const field of RELATIVE_LINK_FIELDS[
        /** @type {keyof typeof RELATIVE_LINK_FIELDS} */ (documentName)
      ] ?? []) {
        const text = readAt(source, [...field]);
        if (typeof text !== "string") continue;
        for (const resolved of resolveRelativeLinks(text, owner.uuid)) {
          if (resolved === target.uuid || resolved.startsWith(`${target.uuid}.`)) {
            record(owner, [...field], { match: "relative", matchedUuid: resolved });
          }
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
    const owner = { uuid: ownerUuid, documentName, name: ownerName(documentName, source) };
    walkSource(documentName, source, owner, [], container);
  };

  /** @param {any} collection */
  const walkCollection = (collection) => {
    for (const document of Array.from(collection ?? [])) {
      const source = typeof document?.toObject === "function" ? document.toObject() : document;
      const documentName = document?.documentName ?? collection?.documentName;
      const id = document?.id ?? source?._id;
      if (typeof documentName !== "string" || typeof id !== "string") continue;
      walkDocument(documentName, storedSource(documentName, source), `${documentName}.${id}`, null);
    }
  };

  for (const scopeName of scopes) {
    walkCollection(
      REFERENCE_SCOPE_COLLECTIONS[/** @type {keyof typeof REFERENCE_SCOPE_COLLECTIONS} */ (scopeName)]?.(game)
    );
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
