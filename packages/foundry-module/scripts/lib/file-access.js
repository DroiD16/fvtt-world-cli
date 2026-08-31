import {
  DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
  ERROR_CODES,
  UPLOAD_SIZE_LIMIT_MAX_BYTES
} from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";
import { paginate } from "./pagination.js";

const DATA_SOURCE = "data";
const READ_SIZE_LIMIT_BYTES = 1024 * 1024;

const MIME_BY_EXTENSION = Object.freeze({
  css: "text/css",
  gif: "image/gif",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  md: "text/markdown",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  xml: "application/xml",
  yml: "text/yaml",
  yaml: "text/yaml"
});

function getFilePicker() {
  const namespaced = globalThis.foundry?.applications?.apps?.FilePicker;
  const FilePicker = namespaced?.implementation ?? namespaced;
  if (!FilePicker) {
    throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, "Foundry FilePicker API is not available");
  }

  return FilePicker;
}

function createInvalidParamsError(message) {
  return createBridgeError(ERROR_CODES.INVALID_PARAMS, "Invalid file command params", {
    errors: [message]
  });
}

/** @returns {string} */
function getWriteRoot() {
  const worldId = /** @type {any} */ (globalThis).game?.world?.id;
  if (typeof worldId !== "string" || !worldId) {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      "Active Foundry world is not available; file writes are blocked"
    );
  }

  return `worlds/${worldId}`;
}

/**
 * @param {string} normalizedPath
 * @param {string} root
 */
function isLiveWorldDataPath(normalizedPath, root) {
  const prefix = `${root}/`;
  if (!normalizedPath.startsWith(prefix)) {
    return false;
  }

  const relative = normalizedPath.slice(prefix.length).toLowerCase();
  if (relative === "world.json") {
    return true;
  }

  for (const subtree of ["data", "packs"]) {
    if (relative === subtree || relative.startsWith(`${subtree}/`)) {
      return true;
    }
  }

  return false;
}

/**
 * @param {string} normalizedPath
 * @param {{ allowRoot?: boolean }} [options]
 */
function assertWithinWriteRoot(normalizedPath, { allowRoot = true } = {}) {
  const root = getWriteRoot();

  const isRoot = normalizedPath === root;
  const isWithin = isRoot || normalizedPath.startsWith(`${root}/`);
  if (!isWithin) {
    throw createBridgeError(
      ERROR_CODES.PATH_NOT_ALLOWED,
      `File writes are not allowed outside the active world directory ${root}/; write under it, or use file.list to discover valid paths`,
      { path: normalizedPath, writeRoot: root }
    );
  }
  if (isRoot && !allowRoot) {
    throw createBridgeError(
      ERROR_CODES.PATH_NOT_ALLOWED,
      `The file operation must target a file beneath the active world directory ${root}/, not the world directory itself; append a filename such as ${root}/assets/<file>`,
      { path: normalizedPath, writeRoot: root }
    );
  }

  if (isLiveWorldDataPath(normalizedPath, root)) {
    throw createBridgeError(
      ERROR_CODES.PATH_NOT_ALLOWED,
      `Writes to the live world's data/manifest (world.json, data/, packs/) under ${root} are not allowed to prevent corruption; write world assets under another subpath such as ${root}/assets`,
      { path: normalizedPath, writeRoot: root }
    );
  }
}

function isControlCharacter(charCode) {
  return charCode < 32 || charCode === 127;
}

function normalizePath(path, { allowEmpty = false } = {}) {
  if (typeof path !== "string") {
    throw createInvalidParamsError("$.params.path must be a string");
  }

  const candidate = path.replaceAll("\\", "/");
  if (!candidate && allowEmpty) {
    return "";
  }

  if (!candidate) {
    throw createBridgeError(ERROR_CODES.PATH_NOT_ALLOWED, "Path cannot be empty", { path });
  }

  if (candidate.startsWith("/") || /^[A-Za-z]:/.test(candidate)) {
    throw createBridgeError(ERROR_CODES.PATH_NOT_ALLOWED, "Absolute paths are not allowed", {
      path
    });
  }

  for (let index = 0; index < candidate.length; index += 1) {
    if (isControlCharacter(candidate.charCodeAt(index))) {
      throw createBridgeError(ERROR_CODES.PATH_NOT_ALLOWED, "Path contains control characters", {
        path
      });
    }
  }

  const segments = candidate.split("/");
  for (const segment of segments) {
    if (!segment) {
      throw createBridgeError(ERROR_CODES.PATH_NOT_ALLOWED, "Path contains empty segments", {
        path
      });
    }

    const decoded = decodePathSegment(segment);
    if (segment === "." || segment === ".." || decoded === "." || decoded === "..") {
      throw createBridgeError(ERROR_CODES.PATH_NOT_ALLOWED, "Path traversal is not allowed", {
        path
      });
    }
  }

  return segments.join("/");
}

function getParentPath(path) {
  if (!path) {
    return "";
  }

  const lastSlashIndex = path.lastIndexOf("/");
  return lastSlashIndex === -1 ? "" : path.slice(0, lastSlashIndex);
}

function getName(path) {
  if (!path) {
    return "";
  }

  const lastSlashIndex = path.lastIndexOf("/");
  return lastSlashIndex === -1 ? path : path.slice(lastSlashIndex + 1);
}

function getExtension(name) {
  const lastDotIndex = name.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === name.length - 1) {
    return "";
  }

  return name.slice(lastDotIndex + 1).toLowerCase();
}

function inferMimeType(path, mimeType) {
  if (typeof mimeType === "string" && mimeType) {
    return mimeType;
  }

  return MIME_BY_EXTENSION[getExtension(getName(path))] ?? null;
}

/**
 * @param {string} path
 * @param {"file" | "directory"} kind
 * @param {string | null} [mimeType]
 */
function getMediaCategory(path, kind, mimeType = null) {
  if (kind === "directory") {
    return "directory";
  }

  const resolvedMimeType = inferMimeType(path, mimeType);
  if (resolvedMimeType?.startsWith("image/")) {
    return "image";
  }

  if (resolvedMimeType?.startsWith("audio/")) {
    return "audio";
  }

  if (resolvedMimeType?.startsWith("video/")) {
    return "video";
  }

  if (
    resolvedMimeType?.startsWith("text/") ||
    resolvedMimeType === "application/json" ||
    resolvedMimeType === "application/xml"
  ) {
    return "text";
  }

  return "binary";
}

/**
 * @param {string} path
 * @param {"file" | "directory"} kind
 * @param {number | null} [size]
 * @param {string | null} [mimeType]
 */
function createEntry(path, kind, size = null, mimeType = null) {
  const name = getName(path);
  return {
    path,
    name,
    extension: kind === "file" ? getExtension(name) : "",
    kind,
    size: Number.isFinite(size) ? size : null,
    mediaCategory: getMediaCategory(path, kind, mimeType)
  };
}

function isNotFoundError(error) {
  return /not found|does not exist|missing|enoent/i.test(String(error?.message ?? ""));
}

function isPathDeniedError(error) {
  return /not allowed|forbidden|permission|invalid path|cannot upload/i.test(String(error?.message ?? ""));
}

/**
 * @param {any} error
 * @param {string} path
 * @param {string} action
 */
function toFileError(error, path, action) {
  const rawMessage = error instanceof Error ? error.message : String(error?.message ?? "");

  if (isPathDeniedError(error)) {
    return createBridgeError(
      ERROR_CODES.PATH_NOT_ALLOWED,
      `Path is not allowed for ${action}; use file.list to discover valid paths`,
      {
        path,
        message: rawMessage
      }
    );
  }

  if (isNotFoundError(error)) {
    return createBridgeError(
      ERROR_CODES.FILE_NOT_FOUND,
      `Path ${path || "/"} was not found; use file.list to discover valid paths`,
      {
        path,
        message: rawMessage
      }
    );
  }

  return createBridgeError(
    ERROR_CODES.INTERNAL_ERROR,
    rawMessage || `Unexpected file error during ${action}`,
    { path, message: rawMessage || `Unexpected file error during ${action}` }
  );
}

function resolveListedPath(entry, directoryPath) {
  const rawPath =
    typeof entry === "string"
      ? entry
      : typeof entry?.path === "string"
        ? entry.path
        : typeof entry?.url === "string"
          ? entry.url
          : null;

  if (!rawPath) {
    return null;
  }

  const candidate = rawPath.replaceAll("\\", "/").replace(/\/+$/u, "");
  if (!candidate) {
    return null;
  }

  const joinedPath = directoryPath && !candidate.includes("/") ? `${directoryPath}/${candidate}` : candidate;

  return normalizePath(joinedPath, { allowEmpty: false });
}

function normalizeBrowseEntries(result, directoryPath) {
  const directories = Array.isArray(result?.dirs) ? result.dirs : [];
  const files = Array.isArray(result?.files) ? result.files : [];

  const entries = [];
  for (const directory of directories) {
    const path = resolveListedPath(directory, directoryPath);
    if (path) {
      entries.push(createEntry(path, "directory"));
    }
  }

  for (const file of files) {
    const path = resolveListedPath(file, directoryPath);
    if (path) {
      entries.push(
        createEntry(
          path,
          "file",
          typeof file?.size === "number" ? file.size : null,
          typeof file?.mimeType === "string" ? file.mimeType : null
        )
      );
    }
  }

  entries.sort((left, right) => left.path.localeCompare(right.path));
  return entries;
}

async function browseDirectory(path) {
  const FilePicker = getFilePicker();
  try {
    return await FilePicker.browse(DATA_SOURCE, path);
  } catch (error) {
    throw toFileError(error, path, "browse");
  }
}

export async function browseDataPathEntries(path) {
  const normalizedPath = normalizeListPath(path);
  const result = await browseDirectory(normalizedPath);
  return normalizeBrowseEntries(result, normalizedPath);
}

function decodePathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function encodeDataPathSegment(segment) {
  return encodeURIComponent(decodePathSegment(segment)).replace(/'/g, "%27");
}

function hasUrlSchemeOrAbsolute(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("/");
}

const CORE_PUBLIC_ROOTS = Object.freeze(
  new Set(["icons", "sounds", "cards", "ui", "fonts", "canvas", "nue", "toolclips"])
);

export function isExternalFileRef(value) {
  if (typeof value !== "string" || !value) {
    return false;
  }
  if (value.startsWith("#") || hasUrlSchemeOrAbsolute(value)) {
    return true;
  }
  const firstSegment = value.split("/", 1)[0];
  return CORE_PUBLIC_ROOTS.has(firstSegment);
}

export function canonicalizeDataPath(value) {
  if (typeof value !== "string" || !value) {
    return value;
  }
  if (value.startsWith("#") || hasUrlSchemeOrAbsolute(value)) {
    return value;
  }
  return value.split("/").map(encodeDataPathSegment).join("/");
}

const FOUNDRY_FILE_EXTENSIONS = Object.freeze([
  "aac",
  "apng",
  "avif",
  "basis",
  "bmp",
  "csv",
  "fbx",
  "flac",
  "gif",
  "glb",
  "gltf",
  "handlebars",
  "hbs",
  "html",
  "jpeg",
  "jpg",
  "json",
  "ktx2",
  "m4a",
  "m4v",
  "md",
  "mid",
  "mp3",
  "mp4",
  "mtl",
  "obj",
  "ogg",
  "ogv",
  "opus",
  "otf",
  "pdf",
  "png",
  "stl",
  "svg",
  "tiff",
  "tsv",
  "ttf",
  "txt",
  "usdz",
  "wav",
  "webm",
  "webp",
  "woff",
  "woff2",
  "xml",
  "yaml",
  "yml"
]);

export function splitFilePathQuery(value) {
  if (typeof value !== "string" || !value) {
    return { base: value, query: "" };
  }
  const match = FILE_PATH_QUERY_PATTERN.exec(value);
  if (!match) {
    return { base: value, query: "" };
  }
  return { base: match[1], query: match[2] };
}

const FILE_PATH_QUERY_PATTERN = new RegExp(
  `^(.*?\\.(?:${FOUNDRY_FILE_EXTENSIONS.join("|")}))(\\?[\\s\\S]*)$`,
  "i"
);

function canonicalizeDocumentFilePath(value) {
  if (typeof value !== "string" || !value) {
    return value;
  }
  const { base, query } = splitFilePathQuery(value);
  if (!query) {
    return canonicalizeDataPath(value);
  }

  return `${canonicalizeDataPath(base)}${query}`;
}

const FILE_PATH_FIELDS_BY_TYPE = Object.freeze({
  Item: ["img"],
  Actor: [
    "img",
    "prototypeToken.texture.src",
    "prototypeToken.ring.subject.texture",
    "prototypeToken.turnMarker.src"
  ],
  Scene: ["background.src", "foreground", "thumb", "fog.overlay"],
  Token: ["texture.src", "ring.subject.texture", "turnMarker.src"],
  Tile: ["texture.src"],
  Note: ["texture.src"],
  Wall: ["animation.texture"],
  Drawing: ["texture"],
  MeasuredTemplate: ["texture"],
  AmbientSound: ["path"],
  PlaylistSound: ["path"],
  JournalEntryPage: ["src"],
  Macro: ["img"],
  User: ["avatar"],

  RollTable: ["img"],
  TableResult: ["img"],

  Combatant: ["img"],
  CombatantGroup: ["img"],

  Cards: ["img"],
  Card: ["back.img"],

  CardFace: ["img"],
  ChatMessage: ["sound"],
  ActiveEffect: ["img"]
});

function getDeepValue(object, parts) {
  return parts.reduce((current, key) => (current == null ? undefined : current[key]), object);
}

function setDeepValue(object, parts, value) {
  const [head, ...rest] = parts;
  if (rest.length === 0) {
    return { ...object, [head]: value };
  }
  const child = object?.[head];
  if (child == null || typeof child !== "object") {
    return object;
  }
  return { ...object, [head]: setDeepValue(child, rest, value) };
}

export function canonicalizeFilePathFields(payload, type) {
  const fields = FILE_PATH_FIELDS_BY_TYPE[type];
  if (!fields || payload == null || typeof payload !== "object") {
    return payload;
  }
  let result = payload;
  for (const field of fields) {
    const flat = result[field];
    if (typeof flat === "string" && flat) {
      const canonical = canonicalizeDocumentFilePath(flat);
      if (canonical !== flat) {
        result = { ...result, [field]: canonical };
      }
    }

    const parts = field.split(".");
    if (parts.length > 1) {
      const current = getDeepValue(result, parts);
      if (typeof current === "string" && current) {
        const canonical = canonicalizeDocumentFilePath(current);
        if (canonical !== current) {
          result = setDeepValue(result, parts, canonical);
        }
      }
    }
  }
  return result;
}

function decodeDataPath(path) {
  return path.split("/").map(decodePathSegment).join("/");
}

function findEntry(entries, path) {
  const exact = entries.find((entry) => entry.path === path);
  if (exact) {
    return exact;
  }

  const literalMatch = entries.find((entry) => decodeDataPath(entry.path) === path);
  if (literalMatch) {
    return literalMatch;
  }

  const target = decodeDataPath(path);
  return entries.find((entry) => decodeDataPath(entry.path) === target) ?? null;
}

function toBase64(bytes) {
  const BufferCtor = /** @type {any} */ (globalThis).Buffer;
  if (typeof BufferCtor?.from === "function") {
    return BufferCtor.from(bytes).toString("base64");
  }

  const browserBtoa = /** @type {any} */ (globalThis).btoa;
  if (typeof browserBtoa !== "function") {
    throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, "No base64 encoder is available");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return browserBtoa(binary);
}

function fromBase64(contentBase64) {
  try {
    const BufferCtor = /** @type {any} */ (globalThis).Buffer;
    if (typeof BufferCtor?.from === "function") {
      return new Uint8Array(BufferCtor.from(contentBase64, "base64"));
    }

    const browserAtob = /** @type {any} */ (globalThis).atob;
    if (typeof browserAtob !== "function") {
      throw new Error("No base64 decoder is available");
    }

    const decoded = browserAtob(contentBase64);
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  } catch {
    throw createInvalidParamsError("$.params.contentBase64 must be valid base64");
  }
}

function ensureUploadSize(bytesLength, path, uploadLimitBytes = DEFAULT_UPLOAD_SIZE_LIMIT_BYTES) {
  if (bytesLength > uploadLimitBytes) {
    throw createBridgeError(
      ERROR_CODES.PAYLOAD_TOO_LARGE,

      `Upload payload for ${path} is ${bytesLength} bytes but the effective upload limit is ${uploadLimitBytes} bytes; raise uploadLimitBytes in the daemon config (max ${UPLOAD_SIZE_LIMIT_MAX_BYTES} bytes) and restart the daemon, or shrink the asset`,
      {
        path,
        limitBytes: uploadLimitBytes,
        actualBytes: bytesLength
      }
    );
  }
}

function ensureReadSize(bytesLength, path) {
  if (bytesLength > READ_SIZE_LIMIT_BYTES) {
    throw createBridgeError(
      ERROR_CODES.PAYLOAD_TOO_LARGE,
      `Read payload for ${path} is ${bytesLength} bytes, over the ${READ_SIZE_LIMIT_BYTES}-byte read limit`,
      {
        path,
        limitBytes: READ_SIZE_LIMIT_BYTES,
        sizeBytes: bytesLength
      }
    );
  }
}

function createUploadFile(path, bytes, mimeType) {
  const FileCtor = /** @type {any} */ (globalThis).File;
  const BlobCtor = /** @type {any} */ (globalThis).Blob;
  const name = getName(path);
  const type = inferMimeType(path, mimeType) ?? "application/octet-stream";

  if (typeof FileCtor === "function") {
    return new FileCtor([bytes], name, { type });
  }

  if (typeof BlobCtor === "function") {
    const blob = new BlobCtor([bytes], { type });
    blob.name = name;
    return blob;
  }

  throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, "No upload file constructor is available", {
    path
  });
}

export function normalizeListPath(path) {
  return normalizePath(path, { allowEmpty: true });
}

export function normalizeFilePath(path) {
  return normalizePath(path, { allowEmpty: false });
}

export async function listDataPath(path, pagination = {}) {
  const normalizedPath = normalizeListPath(path);
  const result = await browseDirectory(normalizedPath);

  const entries = normalizeBrowseEntries(result, normalizedPath);
  const { page, total, hasMore } = paginate(entries, pagination);
  return {
    directory: createEntry(normalizedPath, "directory"),
    entries: page,
    total,
    hasMore
  };
}

const RECURSIVE_LIST_DEFAULT_MAX_DEPTH = 5;
const RECURSIVE_LIST_DEFAULT_MAX_ENTRIES = 500;
const RECURSIVE_LIST_MAX_SKIPPED = 20;

/**
 * @param {string} path
 * @param {{ maxDepth?: number; maxEntries?: number }} [options]
 */
export async function listDataPathRecursive(path, { maxDepth, maxEntries } = {}) {
  const rootPath = normalizeListPath(path);
  const depthLimit = typeof maxDepth === "number" ? maxDepth : RECURSIVE_LIST_DEFAULT_MAX_DEPTH;
  const entryLimit = typeof maxEntries === "number" ? maxEntries : RECURSIVE_LIST_DEFAULT_MAX_ENTRIES;

  const collected = [];
  const skipped = [];
  let skippedTruncated = false;
  let truncated = false;
  let truncatedAt = null;

  /**
   * @param {string} dirPath
   * @param {number} depth
   * @param {boolean} isRoot
   */
  async function walk(dirPath, depth, isRoot) {
    if (truncated) {
      return;
    }

    let entries;
    try {
      const result = await browseDirectory(normalizeListPath(dirPath));
      entries = normalizeBrowseEntries(result, dirPath);
    } catch (error) {
      if (isRoot) {
        throw error;
      }
      if (skipped.length < RECURSIVE_LIST_MAX_SKIPPED) {
        const bridgeError = /** @type {any} */ (error);

        skipped.push({
          path: dirPath,
          reason: String(
            bridgeError?.details?.message ?? bridgeError?.message ?? bridgeError ?? "browse failed"
          )
        });
      } else {
        skippedTruncated = true;
      }
      return;
    }

    for (const entry of entries) {
      if (collected.length >= entryLimit) {
        truncated = true;
        truncatedAt = collected.length > 0 ? collected[collected.length - 1].path : null;
        return;
      }

      collected.push({ ...entry, depth });

      if (entry.kind === "directory" && depth < depthLimit) {
        await walk(entry.path, depth + 1, false);
        if (truncated) {
          return;
        }
      }
    }
  }

  await walk(rootPath, 1, true);

  return {
    directory: createEntry(rootPath, "directory"),
    entries: collected,
    recursive: true,
    truncated,
    truncatedAt,
    skipped,
    skippedTruncated
  };
}

export async function statDataPath(path) {
  const normalizedPath = normalizeListPath(path);
  if (!normalizedPath) {
    return createEntry("", "directory");
  }

  let capturedMessage;

  try {
    const parentPath = getParentPath(normalizedPath);
    const parentResult = await browseDirectory(parentPath);
    const entry = findEntry(normalizeBrowseEntries(parentResult, parentPath), normalizedPath);
    if (entry) {
      return entry;
    }
  } catch (error) {
    const bridgeError = /** @type {any} */ (error);
    if (bridgeError?.code && bridgeError.code !== ERROR_CODES.FILE_NOT_FOUND) {
      throw bridgeError;
    }
    capturedMessage = bridgeError?.details?.message ?? capturedMessage;
  }

  try {
    await browseDirectory(normalizedPath);
    return createEntry(normalizedPath, "directory");
  } catch (error) {
    const bridgeError = /** @type {any} */ (error);
    if (bridgeError?.code && bridgeError.code !== ERROR_CODES.FILE_NOT_FOUND) {
      throw bridgeError;
    }
    capturedMessage = bridgeError?.details?.message ?? capturedMessage;
  }

  throw createBridgeError(
    ERROR_CODES.FILE_NOT_FOUND,
    `Path ${normalizedPath} was not found; use file.list to discover valid paths`,
    {
      path: normalizedPath,
      ...(capturedMessage === undefined ? {} : { message: capturedMessage })
    }
  );
}

async function statFileIfExists(path) {
  try {
    return await statDataPath(path);
  } catch (error) {
    const bridgeError = /** @type {any} */ (error);
    if (bridgeError?.code && bridgeError.code !== ERROR_CODES.FILE_NOT_FOUND) {
      throw bridgeError;
    }
    return null;
  }
}

function encodeDataPathForFetch(path) {
  return path.split("/").map(encodeDataPathSegment).join("/");
}

export async function readDataFile(path, encoding) {
  const normalizedPath = normalizeFilePath(path);
  const entry = await statDataPath(normalizedPath);
  if (entry.kind !== "file") {
    throw createInvalidParamsError("$.params.path must reference a file");
  }

  if (typeof globalThis.fetch !== "function") {
    throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, "Fetch API is not available", {
      path: normalizedPath
    });
  }

  const response = await globalThis.fetch(encodeDataPathForFetch(entry.path));
  if (!response.ok) {
    if (response.status === 404) {
      throw createBridgeError(
        ERROR_CODES.FILE_NOT_FOUND,
        `Path ${normalizedPath} was not found; use file.list to discover valid paths`,
        {
          path: normalizedPath,
          message: `HTTP 404 while fetching ${normalizedPath}`
        }
      );
    }

    throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, `Failed to read ${normalizedPath}`, {
      path: normalizedPath,
      status: response.status,
      message: `HTTP ${response.status} while fetching ${normalizedPath}`
    });
  }

  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize)) {
    ensureReadSize(declaredSize, normalizedPath);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  ensureReadSize(bytes.byteLength, normalizedPath);

  return {
    file: createEntry(normalizedPath, "file", bytes.byteLength, response.headers.get("content-type")),
    encoding,
    content: encoding === "text" ? new TextDecoder().decode(bytes) : toBase64(bytes)
  };
}

export async function mkdirDataPath(path, { dryRun = false } = {}) {
  const normalizedPath = normalizeFilePath(path);

  assertWithinWriteRoot(normalizeFilePath(decodeDataPath(normalizedPath)));
  assertWithinWriteRoot(normalizedPath);

  const canonicalPath = canonicalizeDataPath(normalizedPath);
  if (dryRun) {
    return {
      directory: createEntry(canonicalPath, "directory"),
      dryRun: true
    };
  }

  const FilePicker = getFilePicker();
  try {
    await FilePicker.createDirectory(DATA_SOURCE, normalizedPath);
  } catch (error) {
    const directoryError = /** @type {any} */ (error);
    if (!/already exists/i.test(String(directoryError?.message ?? ""))) {
      throw toFileError(error, normalizedPath, "mkdir");
    }
  }

  return {
    directory: createEntry(canonicalPath, "directory")
  };
}

export async function uploadDataFile(
  path,
  contentBase64,
  mimeType = null,
  { dryRun = false, uploadLimitBytes = DEFAULT_UPLOAD_SIZE_LIMIT_BYTES } = {}
) {
  const normalizedPath = normalizeFilePath(path);

  const literalPath = normalizeFilePath(decodeDataPath(normalizedPath));

  assertWithinWriteRoot(literalPath, { allowRoot: false });
  const bytes = fromBase64(contentBase64);
  ensureUploadSize(bytes.byteLength, literalPath, uploadLimitBytes);

  const canonicalPath = canonicalizeDataPath(literalPath);
  if (dryRun) {
    return {
      file: createEntry(canonicalPath, "file", bytes.byteLength, inferMimeType(canonicalPath, mimeType)),
      dryRun: true
    };
  }

  const FilePicker = getFilePicker();

  const directoryPath = getParentPath(literalPath);
  const uploadFile = createUploadFile(literalPath, bytes, mimeType);

  let response;
  try {
    response = await FilePicker.upload(DATA_SOURCE, directoryPath, uploadFile);
  } catch (error) {
    throw toFileError(error, normalizedPath, "upload");
  }

  if (typeof response?.path !== "string" || !response.path) {
    throw createBridgeError(
      ERROR_CODES.INTERNAL_ERROR,
      `Upload of ${normalizedPath} did not return a stored path`,
      { path: normalizedPath, response: summarizeUploadResponse(response) }
    );
  }

  const storedPath = normalizeFilePath(response.path);
  return {
    file: createEntry(storedPath, "file", bytes.byteLength, inferMimeType(storedPath, mimeType))
  };
}

/**
 * @param {any} FilePicker
 * @returns {((source: string, target: string) => Promise<any>) | null}
 */

function resolveDeletePrimitive(FilePicker) {
  return null;
}

/**
 * @param {string} path
 * @param {{ dryRun?: boolean }} [options]
 */
export async function deleteDataFile(path, { dryRun = false } = {}) {
  const normalizedPath = normalizeFilePath(path);

  assertWithinWriteRoot(normalizeFilePath(decodeDataPath(normalizedPath)), { allowRoot: false });
  assertWithinWriteRoot(normalizedPath, { allowRoot: false });

  const FilePicker = getFilePicker();
  const deleteFile = resolveDeletePrimitive(FilePicker);
  if (!deleteFile) {
    throw createBridgeError(
      ERROR_CODES.UNSUPPORTED_OPERATION,
      `file.delete is not supported: this Foundry version (v13/v14) exposes no public file-delete primitive, so the bridge cannot delete ${normalizedPath}; the Foundry FilePicker offers only browse/createDirectory/upload (no in-app delete control), so remove the file manually from the Foundry user data directory on the server instead`,
      { path: normalizedPath }
    );
  }

  if (dryRun) {
    const entry = await statFileIfExists(normalizedPath);
    if (entry && entry.kind !== "file") {
      throw createInvalidParamsError("$.params.path must reference a file, not a directory");
    }

    return {
      file: createEntry(normalizedPath, "file"),
      exists: entry !== null,
      dryRun: true
    };
  }

  const entry = await statDataPath(normalizedPath);
  if (entry.kind !== "file") {
    throw createInvalidParamsError("$.params.path must reference a file, not a directory");
  }

  let response;
  try {
    response = await deleteFile(DATA_SOURCE, normalizedPath);
  } catch (error) {
    throw toFileError(error, normalizedPath, "delete");
  }

  let stillExists = false;
  try {
    const parentPath = getParentPath(normalizedPath);
    const parentResult = await browseDirectory(parentPath);
    stillExists = Boolean(findEntry(normalizeBrowseEntries(parentResult, parentPath), normalizedPath));
  } catch (error) {
    const bridgeError = /** @type {any} */ (error);
    if (bridgeError?.code && bridgeError.code !== ERROR_CODES.FILE_NOT_FOUND) {
      throw bridgeError;
    }
  }

  if (stillExists) {
    throw createBridgeError(
      ERROR_CODES.INTERNAL_ERROR,
      `Delete of ${normalizedPath} did not remove the file`,
      { path: normalizedPath, response: summarizeUploadResponse(response) }
    );
  }

  return {
    file: createEntry(normalizedPath, "file"),
    deleted: true
  };
}

/**
 * @param {any} FilePicker
 * @returns {((source: string, from: string, to: string) => Promise<any>) | null}
 */

function resolveMovePrimitive(FilePicker) {
  return null;
}

/**
 * @param {string} from
 * @param {string} to
 * @param {{ dryRun?: boolean }} [options]
 */
export async function moveDataFile(from, to, { dryRun = false } = {}) {
  const normalizedFrom = normalizeFilePath(from);
  const normalizedTo = normalizeFilePath(to);

  assertWithinWriteRoot(normalizeFilePath(decodeDataPath(normalizedFrom)), { allowRoot: false });
  assertWithinWriteRoot(normalizedFrom, { allowRoot: false });
  assertWithinWriteRoot(normalizeFilePath(decodeDataPath(normalizedTo)), { allowRoot: false });
  assertWithinWriteRoot(normalizedTo, { allowRoot: false });

  const FilePicker = getFilePicker();
  const moveFile = resolveMovePrimitive(FilePicker);
  if (!moveFile) {
    throw createBridgeError(
      ERROR_CODES.UNSUPPORTED_OPERATION,
      `file.move is not supported: this Foundry version (v13/v14) exposes no public file-move primitive, so the bridge cannot move ${normalizedFrom} to ${normalizedTo}; the Foundry FilePicker offers only browse/createDirectory/upload (no in-app move/rename control), so move the file manually in the Foundry user data directory on the server instead`,
      { from: normalizedFrom, to: normalizedTo }
    );
  }

  const canonicalTo = canonicalizeDataPath(normalizeFilePath(decodeDataPath(normalizedTo)));
  const canonicalFrom = canonicalizeDataPath(normalizeFilePath(decodeDataPath(normalizedFrom)));

  const sourceEntry = await statDataPath(normalizedFrom);
  if (sourceEntry.kind !== "file") {
    throw createInvalidParamsError("$.params.from must reference a file, not a directory");
  }

  const destinationParent = getParentPath(normalizeFilePath(decodeDataPath(normalizedTo)));
  const parentEntry = await statFileIfExists(destinationParent);
  if (!parentEntry || parentEntry.kind !== "directory") {
    throw createBridgeError(
      ERROR_CODES.FILE_NOT_FOUND,
      `Destination parent directory ${destinationParent || "/"} was not found; create it with file.mkdir first (file.move does not create directories)`,
      { from: normalizedFrom, to: normalizedTo, target: "destination-parent" }
    );
  }

  const existingDestination = await statFileIfExists(normalizedTo);
  if (existingDestination) {
    throw createBridgeError(
      ERROR_CODES.FILE_ALREADY_EXISTS,
      `Destination ${normalizedTo} already exists; file.move will not overwrite — choose a new name or delete the destination first`,
      { from: normalizedFrom, to: normalizedTo }
    );
  }

  if (dryRun) {
    return {
      file: createEntry(canonicalTo, "file", sourceEntry.size, inferMimeType(canonicalTo, null)),
      from: canonicalFrom,
      dryRun: true
    };
  }

  let response;
  try {
    response = await moveFile(DATA_SOURCE, normalizedFrom, normalizedTo);
  } catch (error) {
    throw toFileError(error, normalizedTo, "move");
  }

  const landedEntry = await statFileIfExists(normalizedTo);
  const sourceStillExists = await statFileIfExists(normalizedFrom);
  if (!landedEntry || sourceStillExists) {
    throw createBridgeError(
      ERROR_CODES.INTERNAL_ERROR,
      `Move of ${normalizedFrom} to ${normalizedTo} did not complete`,
      { from: normalizedFrom, to: normalizedTo, response: summarizeUploadResponse(response) }
    );
  }

  return {
    file: landedEntry,
    from: canonicalFrom
  };
}

function summarizeUploadResponse(response) {
  if (response === null) {
    return { type: "null" };
  }

  if (typeof response !== "object") {
    return { type: typeof response, value: String(response) };
  }

  const summary = { type: "object" };
  for (const key of ["status", "message", "error"]) {
    if (typeof response[key] === "string" && response[key]) {
      summary[key] = response[key];
    }
  }

  return summary;
}

export const FILE_LIMITS = Object.freeze({
  readBytes: READ_SIZE_LIMIT_BYTES,
  uploadBytes: DEFAULT_UPLOAD_SIZE_LIMIT_BYTES
});
