import { expect, vi } from "vitest";

import {
  COMMAND_NAMES,
  MESSAGE_TYPES,
  MODULE_ID,
  PROTOCOL_VERSION
} from "../../scripts/generated/protocol.js";
import { MODULE_SETTING_KEYS } from "../../scripts/lib/validators.js";

function ensureFilePickerNamespace() {
  globalThis.foundry ??= {};
  globalThis.foundry.applications ??= {};
  globalThis.foundry.applications.apps ??= {};
  globalThis.foundry.applications.apps.FilePicker ??= {};
}

ensureFilePickerNamespace();

export function getParentPath(path) {
  const lastSlashIndex = path.lastIndexOf("/");
  return lastSlashIndex === -1 ? "" : path.slice(0, lastSlashIndex);
}

/** @param {{ ok: boolean; status: number; bytes: Uint8Array; contentType?: string | null; contentLength?: string | null; }} input */
export function createFetchResponse({ ok, status, bytes, contentType = null, contentLength = null }) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        if (name === "content-length") {
          return contentLength ?? (ok ? String(bytes.byteLength) : null);
        }

        if (name === "content-type") {
          return contentType;
        }

        return null;
      }
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

export function applyDocumentMerge(base, patch, options = {}) {
  const performDeletions = options?.performDeletions === true;
  const out = Array.isArray(base) ? [...base] : { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (performDeletions && key.startsWith("-=")) {
      delete out[key.slice(2)];
      continue;
    }
    const target = out[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      target &&
      typeof target === "object" &&
      !Array.isArray(target)
    ) {
      out[key] = applyDocumentMerge(target, value, options);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function toPreviewSource(source) {
  const out = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    if (typeof value === "function") continue;
    out[key] = value;
  }
  return out;
}

export function makeDataModelValidationError(message) {
  const error = /** @type {any} */ (new Error(message));
  error.name = "DataModelValidationError";
  const field = /^([A-Za-z0-9_.[\]]+):\s/.exec(message)?.[1] ?? null;
  error.getAllFailures = () => (field ? { [field]: { message } } : {});
  return error;
}

const STRICT_CONSTRUCTION_STATS = {
  compendiumSource: null,
  coreVersion: "13.351",
  createdTime: null,
  duplicateSource: null,
  exportSource: null,
  lastModifiedBy: null,
  modifiedTime: null,
  systemId: null,
  systemVersion: null
};

function mutateSourceWithStats(source) {
  if (!source || typeof source !== "object") return;
  if (!("_stats" in source)) source._stats = { ...STRICT_CONSTRUCTION_STATS };
}

export function mutateWorldSourceLikeCore(source) {
  if (!source || typeof source !== "object") return;
  mutateSourceWithStats(source);
  if (!("ownership" in source)) source.ownership = { default: 0 };
  if (!("folder" in source)) source.folder = null;
  if (!("sort" in source)) source.sort = 0;
}

function mutateTableSourceLikeCore(source) {
  if (!source || typeof source !== "object") return;
  mutateWorldSourceLikeCore(source);
  if (!Array.isArray(source.results)) return;
  source.results.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    if (!("_id" in entry)) entry._id = `minted-result-${index + 1}`;
    mutateSourceWithStats(entry);
  });
}

function cleanCardFacesLikeCore(source) {
  if (!Array.isArray(source?.faces)) return;
  for (const face of source.faces) {
    if (!face || typeof face !== "object") continue;
    if (!("text" in face)) face.text = "";
    if (!("img" in face)) face.img = "icons/svg/card-joker.svg";
  }
}

function mutateCardSourceLikeCore(source) {
  if (!source || typeof source !== "object") return;
  mutateSourceWithStats(source);
  cleanCardFacesLikeCore(source);
}

function copyCardFacesForPreview(source) {
  if (!Array.isArray(source?.faces)) return source;
  return {
    ...source,
    faces: source.faces.map((face) => (face && typeof face === "object" ? { ...face } : face))
  };
}

function copyCardEntriesForPreview(source) {
  if (!Array.isArray(source?.cards)) return source;
  return {
    ...source,
    cards: source.cards.map((card, index) =>
      card && typeof card === "object"
        ? { ...copyCardFacesForPreview({ ...card }), _id: card._id ?? `minted-card-${index + 1}` }
        : card
    )
  };
}

function mutateCardsSourceLikeCore(source) {
  if (!source || typeof source !== "object") return;
  mutateWorldSourceLikeCore(source);
  if (!Array.isArray(source.cards)) return;
  source.cards.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    if (!("_id" in entry)) entry._id = `minted-card-${index + 1}`;
    mutateSourceWithStats(entry);
    cleanCardFacesLikeCore(entry);
  });
}

function mutateCombatSourceLikeCore(source) {
  if (!source || typeof source !== "object") return;
  const stamped = {
    _id: null,
    type: "base",
    system: {},
    groups: [],
    combatants: [],
    active: false,
    round: 0,
    turn: null,
    sort: 0,
    flags: {}
  };
  for (const [key, value] of Object.entries(stamped)) {
    if (!(key in source)) source[key] = value;
  }
  mutateSourceWithStats(source);
}

function makePreviewConstructor(validatePreview, mutateSource) {
  return function PreviewDocument(source, context = {}) {
    if (context?.strict && typeof validatePreview === "function") {
      const message = validatePreview(source);
      if (message) {
        throw makeDataModelValidationError(message);
      }
    }
    const previewSource = toPreviewSource(source);

    if (context?.strict && typeof mutateSource === "function") {
      mutateSource(source);
    }
    return {
      ...previewSource,
      id: previewSource.id ?? previewSource._id ?? null,
      toObject() {
        return { ...previewSource };
      }
    };
  };
}

/** @param {{ create?: Function, validatePreview?: (source: any, context?: any) => (string | null), applyDefaults?: (source: any) => any, cleanSource?: (source: any) => any, mutateSource?: (source: any) => void, prepareSelf?: (document: any) => void, prepareParent?: (document: any, parent: any) => void, previewUpdateSource?: boolean }} [options] */
export function makeDocumentClass({
  create,
  validatePreview,
  applyDefaults,
  cleanSource,
  mutateSource,
  prepareSelf,
  prepareParent,
  previewUpdateSource
} = {}) {
  function DocumentClass(source, context = {}) {
    if (context?.strict && typeof validatePreview === "function") {
      const message = validatePreview(source, context);
      if (message) {
        throw makeDataModelValidationError(message);
      }
    }
    const base = toPreviewSource(source);

    const merged =
      typeof applyDefaults === "function"
        ? applyDocumentMerge(applyDefaults(base) ?? {}, base, { performDeletions: false })
        : base;
    const withDefaults = typeof cleanSource === "function" ? (cleanSource(merged) ?? merged) : merged;
    if (context?.strict && typeof mutateSource === "function") {
      mutateSource(source);
    }
    let previewSource = withDefaults;
    const preview = {
      ...withDefaults,
      id: null,
      toObject() {
        return { ...previewSource, _id: null };
      }
    };
    if (previewUpdateSource === true) {
      preview.updateSource = (patch = {}) => {
        const patched = applyDocumentMerge(previewSource, patch ?? {}, { performDeletions: false });
        previewSource = typeof cleanSource === "function" ? (cleanSource(patched) ?? patched) : patched;
        Object.assign(preview, previewSource);
        return patch;
      };
    }

    if (typeof prepareSelf === "function") prepareSelf(preview);

    if (typeof prepareParent === "function") prepareParent(preview, context?.parent ?? null);
    return preview;
  }
  if (typeof create === "function") {
    DocumentClass.create = create;
  }
  return DocumentClass;
}

const FOLDER_DOCUMENT_TYPES = [
  "Actor",
  "Adventure",
  "Item",
  "Scene",
  "JournalEntry",
  "Playlist",
  "RollTable",
  "Cards",
  "Macro",
  "Compendium"
];

export function makeFolderDocumentClass(create) {
  return makeDocumentClass({
    create,
    validatePreview: (source) => {
      if (source?.type != null && !FOLDER_DOCUMENT_TYPES.includes(source.type)) {
        return `${source.type} is not a valid Folder type`;
      }
      if (source?.color != null && !/^#[0-9a-fA-F]{6}$/.test(String(source.color))) {
        return `${source.color} is not a valid hexadecimal color string`;
      }
      if (source?.sort != null && !Number.isInteger(source.sort)) {
        return `${source.sort} is not an integer`;
      }
      return null;
    },
    applyDefaults: () => ({ description: "", sorting: "a", sort: 0, color: null, flags: {} })
  });
}

/**
 * @param {string | null} id
 * @param {any} data
 * @param {{ validatePreview?: (source: any) => (string | null), swallowPatchKeys?: (patch: any) => string[] }} [options]
 */
export function createDocument(id, data, { validatePreview, swallowPatchKeys } = {}) {
  const document = {
    ...data,

    id,
    update: vi.fn(async (patch) => {
      Object.assign(document, patch);
      return document;
    }),
    delete: vi.fn(async () => {
      document.deleted = true;
      return document;
    }),

    clone: vi.fn(async (patch = {}, context = {}) =>
      createDocument(
        context.keepId ? id : context.save ? `${id}-clone` : null,
        applyDocumentMerge(data, patch, { performDeletions: true }),

        { validatePreview, swallowPatchKeys }
      )
    ),

    updateSource(rawPatch = {}, context = {}) {
      const swallowed = typeof swallowPatchKeys === "function" ? swallowPatchKeys(rawPatch ?? {}) : [];
      const patch = swallowed.length
        ? Object.fromEntries(Object.entries(rawPatch ?? {}).filter(([key]) => !swallowed.includes(key)))
        : (rawPatch ?? {});
      if (typeof validatePreview === "function") {
        const message = validatePreview(patch ?? {});
        if (message) {
          throw makeDataModelValidationError(message);
        }
      }
      const current = this.toObject();
      const merged = applyDocumentMerge(current, patch ?? {}, { performDeletions: true });
      if (context.dryRun) {
        const diff = {};
        for (const key of Object.keys(patch ?? {})) {
          if (key === "id") continue;
          if (key.startsWith("-=")) {
            if (Object.prototype.hasOwnProperty.call(current, key.slice(2))) diff[key] = patch[key];
            continue;
          }
          if (JSON.stringify(merged[key]) !== JSON.stringify(current[key])) diff[key] = merged[key];
        }
        return diff;
      }
      for (const key of Object.keys(patch ?? {})) {
        if (key === "_id" || key === "id") continue;
        if (key.startsWith("-=")) {
          delete this[key.slice(2)];
          continue;
        }
        this[key] = merged[key];
      }
      return merged;
    },
    toObject() {
      return {
        _id: this.id,
        ...data,
        ...this
      };
    }
  };

  Object.defineProperty(document, "applyStoredWrite", {
    value(patch = {}) {
      const merged = applyDocumentMerge(this.toObject(), patch ?? {}, { performDeletions: true });
      for (const key of Object.keys(patch ?? {})) {
        if (key === "_id" || key === "id") continue;
        if (key.startsWith("-=")) {
          delete this[key.slice(2)];
          delete data[key.slice(2)];
          continue;
        }
        this[key] = merged[key];
        data[key] = merged[key];
      }
      return this;
    },
    enumerable: false,
    configurable: true,
    writable: true
  });

  Object.defineProperty(document, "constructor", {
    value: makePreviewConstructor(validatePreview),
    enumerable: false,
    configurable: true,
    writable: true
  });

  return document;
}

/**
 * @param {any[]} documents
 * @param {{ validatePreview?: (source: any, context?: any) => (string | null), applyDefaults?: (source: any) => any, cleanSource?: (source: any) => any, mutateSource?: (source: any) => void, prepareSelf?: (document: any) => void, prepareParent?: (document: any, parent: any) => void, previewUpdateSource?: boolean }} [options]
 */
export function createCollection(
  documents,
  {
    validatePreview,
    applyDefaults,
    cleanSource,
    mutateSource,
    prepareSelf,
    prepareParent,
    previewUpdateSource
  } = {}
) {
  const byId = new Map(documents.map((document) => [document.id, document]));
  return {
    documentClass: makeDocumentClass({
      validatePreview,
      applyDefaults,
      cleanSource,
      mutateSource,
      prepareSelf,
      prepareParent,
      previewUpdateSource
    }),
    get size() {
      return byId.size;
    },

    get contents() {
      return [...byId.values()];
    },
    get(id) {
      return byId.get(id) ?? null;
    },
    set(document) {
      byId.set(document.id, document);
      return document;
    },
    delete(id) {
      return byId.delete(id);
    },
    values() {
      return byId.values();
    },
    [Symbol.iterator]() {
      return byId.values();
    }
  };
}

function deepMerge(base, updates) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(updates ?? {})) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      out[key] &&
      typeof out[key] === "object"
    ) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function passthroughSourceFields(document) {
  return document?._stats !== undefined ? { _stats: document._stats } : {};
}

function fromCompendiumLikeCore(documentName, source, options = {}) {
  const {
    clearFolder = false,
    clearState = true,
    clearSort = true,
    clearOwnership = true,
    keepId = false
  } = options ?? {};
  const data = deepMerge(source.toObject(), {});
  if (source.pack) {
    data._stats = { ...(data._stats ?? {}), compendiumSource: source.uuid };
  }
  if (!keepId) delete data._id;
  if (clearFolder) delete data.folder;
  if (clearSort) delete data.sort;
  if (clearState) delete data.active;
  if (clearOwnership) {
    data.ownership = { default: 0, [globalThis.game.user.id]: 3 };
  }
  if (documentName === "Scene" && clearSort) {
    data.navigation = false;
    delete data.navOrder;
  }

  if (documentName === "Macro" && options?.clearOwnership) {
    data.author = globalThis.game.user.id;
  }
  return data;
}

function makePackEntry(packId, documentName, source) {
  return {
    documentName,
    pack: packId,
    uuid: `Compendium.${packId}.${documentName}.${source._id}`,
    toObject: () => deepMerge(source, {})
  };
}

/**
 * @param {string} packId
 * @param {string} documentName
 * @param {Record<string, any>} entries
 * @param {{ label?: string }} [options]
 */
function makeCompendiumPack(packId, documentName, entries, { label } = {}) {
  return {
    collection: packId,
    documentName,
    title: label ?? packId,
    metadata: { id: packId, label: label ?? packId, type: documentName },
    getIndex: vi.fn(async () =>
      Object.entries(entries).map(([id, source]) => ({ _id: id, name: source.name }))
    ),
    getDocument: vi.fn(async (id) => (entries[id] ? makePackEntry(packId, documentName, entries[id]) : null))
  };
}

/**
 * @param {string | null} id
 * @param {any} data
 * @param {{ validatePreview?: (source: any) => (string | null) }} [options]
 */
function createJournalPageDocument(id, data, { validatePreview } = {}) {
  return createDocument(
    id,
    {
      name: data.name,
      type: data.type,
      sort: data.sort ?? 0,
      title: data.title ?? { show: true, level: 1 },
      text: data.text ?? { format: 1 },
      image: data.image ?? {},
      video: data.video ?? { controls: true, volume: 0.5 },
      src: data.src ?? null,

      category: data.category ?? null
    },
    { validatePreview }
  );
}

/**
 * @param {string} id
 * @param {{ name?: string, sort?: number, flags?: Record<string, any> }} data
 */
export function createJournalCategoryDocument(id, data = {}) {
  const source = {
    _id: id,

    name: typeof data.name === "string" ? data.name.trim() : "",

    sort: typeof data.sort === "number" ? Math.round(data.sort) : 0,
    flags: data.flags ?? {}
  };
  const LOCALIZED_UNNAMED = "Unnamed Category";
  const category = {
    id,
    _source: source,

    get name() {
      return source.name || LOCALIZED_UNNAMED;
    },
    get sort() {
      return source.sort;
    },
    get flags() {
      return source.flags;
    },
    toObject() {
      return { ...source };
    },
    update: vi.fn(async (patch) => {
      Object.assign(source, patch);
      return category;
    }),
    delete: vi.fn(async () => category),

    clone: vi.fn(async (patch = {}, context = {}) => {
      const merged = { ...source, ...(patch ?? {}) };

      const cloneId = context.keepId ? id : context.save ? `${id}-clone` : "";
      return createJournalCategoryDocument(cloneId, merged);
    }),
    updateSource(rawPatch = {}, context = {}) {
      const patch = rawPatch ?? {};

      const message = validateJournalCategorySource({ ...source, ...patch });
      if (message) {
        throw makeDataModelValidationError(message);
      }
      const merged = { ...source };
      for (const [key, value] of Object.entries(patch)) {
        if (key === "_id" || key === "id") continue;
        if (key === "name") merged.name = typeof value === "string" ? value.trim() : "";
        else if (key === "sort") merged.sort = Math.round(value);
        else merged[key] = value;
      }
      if (context.dryRun) {
        const diff = {};
        for (const key of Object.keys(patch)) {
          if (key === "_id" || key === "id") continue;
          if (JSON.stringify(merged[key]) !== JSON.stringify(source[key])) diff[key] = merged[key];
        }
        return diff;
      }
      Object.assign(source, merged);
      return merged;
    }
  };

  Object.defineProperty(category, "constructor", {
    value: function CategoryPreview(merged) {
      const preview = createJournalCategoryDocument(merged?._id ?? id, merged ?? {});
      return preview;
    },
    enumerable: false,
    configurable: true,
    writable: true
  });
  return category;
}

/** @param {Record<string, any>} source */
function validateJournalCategorySource(source) {
  if (source.sort !== undefined && typeof source.sort !== "number") {
    return "sort: must be a number";
  }
  return null;
}

/**
 * @param {string | null} id
 * @param {any} data
 * @param {{ validatePreview?: (source: any) => (string | null) }} [options]
 */
export function createJournalDocument(id, data, { validatePreview } = {}) {
  const pages = createCollection(
    (data.pages ?? []).map((page, index) =>
      createJournalPageDocument(page.id ?? `${id}-page-${index + 1}`, page, { validatePreview })
    ),

    { validatePreview }
  );

  const categories = createCollection(
    (data.categories ?? []).map((category, index) =>
      createJournalCategoryDocument(category.id ?? `${id}-cat-${index + 1}`, category)
    ),
    {
      validatePreview: (source) => validateJournalCategorySource(source ?? {}),
      applyDefaults: () => ({ sort: 0, flags: {} }),
      mutateSource: (source) => {
        if (source && typeof source === "object") {
          source._id = null;
          source.flags ??= {};
          source._stats = { coreVersion: "13.351" };
        }
      },

      prepareSelf: (preview) => {
        const stored = preview?.name ?? "";
        Object.defineProperty(preview, "_source", {
          value: { ...preview, _id: null, name: stored },
          enumerable: false,
          configurable: true,
          writable: true
        });
        if (!stored) preview.name = "Unnamed Category";
      }
    }
  );

  const journal = createDocument(id, {
    ...(data._stats !== undefined ? { _stats: data._stats } : {}),
    name: data.name,
    folder: data.folder ?? null,
    sort: data.sort ?? 0,
    pages
  });

  journal.pages = pages;
  journal.categories = categories;

  const refuseCategoryWrites = data.refuseCategoryWrites ?? null;
  journal.createEmbeddedDocuments = vi.fn(async (type, entries) => {
    if (type === "JournalEntryCategory") {
      if (refuseCategoryWrites === "create") return [];
      return entries.map((entry, index) => {
        const category = createJournalCategoryDocument(
          entry._id ?? entry.id ?? `${id}-cat-created-${categories.size + index + 1}`,
          entry
        );
        categories.set(category);
        return category;
      });
    }
    expect(type).toBe("JournalEntryPage");
    return entries.map((entry, index) => {
      const page = createJournalPageDocument(
        entry.id ?? `${id}-page-created-${pages.size + index + 1}`,
        entry
      );
      pages.set(page);
      return page;
    });
  });
  journal.updateEmbeddedDocuments = vi.fn(async (type, entries) => {
    if (type === "JournalEntryCategory") {
      if (refuseCategoryWrites === "update") return [];
      return entries
        .map((entry) => {
          const category = categories.get(entry._id);
          if (!category) return null;

          const diff = category.updateSource(
            Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "_id")),
            { dryRun: true }
          );
          if (Object.keys(diff).length === 0) return null;
          category.updateSource(Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "_id")));
          return category;
        })
        .filter((row) => row != null);
    }
    expect(type).toBe("JournalEntryPage");
    return entries.map((entry) => {
      const page = pages.get(entry._id);
      Object.assign(page, Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "_id")));
      return page;
    });
  });
  journal.deleteEmbeddedDocuments = vi.fn(async (type, ids) => {
    if (type === "JournalEntryCategory") {
      if (refuseCategoryWrites === "delete") return [];
      return ids
        .map((categoryId) => {
          const category = categories.get(categoryId);
          categories.delete(categoryId);
          return category;
        })
        .filter((row) => row != null);
    }
    expect(type).toBe("JournalEntryPage");
    return ids.map((pageId) => {
      const page = pages.get(pageId);
      pages.delete(pageId);
      return page;
    });
  });

  journal.clone = vi.fn(async (patch = {}, context = {}) =>
    createJournalDocument(
      context.keepId ? id : context.save ? `${id}-clone` : null,
      {
        name: journal.name,
        folder: journal.folder,
        sort: journal.sort,
        ...patch,
        pages: Array.from(pages.values()).map((page) => ({
          id: page.id,
          name: page.name,
          type: page.type,
          sort: page.sort,
          title: page.title,
          text: page.text,
          image: page.image,
          video: page.video,
          src: page.src
        }))
      },
      { validatePreview }
    )
  );
  journal.toObject = function toObject() {
    return {
      _id: this.id,
      name: this.name,
      folder: this.folder,
      sort: this.sort,
      pages: Array.from(this.pages).map((page) => page.toObject()),
      ...passthroughSourceFields(this)
    };
  };

  return journal;
}

function createPlaylistSoundDocument(id, data) {
  return createDocument(id, {
    name: data.name ?? null,
    description: data.description ?? null,
    path: data.path,
    channel: data.channel ?? null,
    playing: data.playing ?? false,
    pausedTime: data.pausedTime ?? null,
    repeat: data.repeat ?? false,
    volume: data.volume ?? null,
    fade: data.fade ?? null,
    sort: data.sort ?? 0,
    flags: data.flags ?? {}
  });
}

export function createPlaylistDocument(id, data) {
  const sounds = createCollection(
    (data.sounds ?? []).map((sound, index) =>
      createPlaylistSoundDocument(sound.id ?? `${id}-sound-${index + 1}`, sound)
    )
  );

  const playlist = createDocument(id, {
    ...(data._stats !== undefined ? { _stats: data._stats } : {}),
    name: data.name,
    description: data.description ?? null,
    mode: data.mode ?? null,
    playing: data.playing ?? false,
    fade: data.fade ?? null,
    channel: data.channel ?? null,
    sorting: data.sorting ?? null,
    seed: data.seed ?? null,
    folder: data.folder ?? null,
    sort: data.sort ?? 0,
    flags: data.flags ?? {},
    sounds
  });

  playlist.sounds = sounds;
  playlist.createEmbeddedDocuments = vi.fn(async (type, entries) => {
    expect(type).toBe("PlaylistSound");
    return entries.map((entry, index) => {
      const sound = createPlaylistSoundDocument(
        entry.id ?? `${id}-sound-created-${sounds.size + index + 1}`,
        entry
      );
      sounds.set(sound);
      return sound;
    });
  });
  playlist.updateEmbeddedDocuments = vi.fn(async (type, entries) => {
    expect(type).toBe("PlaylistSound");
    return entries.map((entry) => {
      const sound = sounds.get(entry._id);
      Object.assign(sound, Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "_id")));
      return sound;
    });
  });
  playlist.deleteEmbeddedDocuments = vi.fn(async (type, ids) => {
    expect(type).toBe("PlaylistSound");
    return ids.map((soundId) => {
      const sound = sounds.get(soundId);
      sounds.delete(soundId);
      return sound;
    });
  });
  playlist.clone = vi.fn(async (patch = {}, context = {}) =>
    createPlaylistDocument(context.keepId ? id : context.save ? `${id}-clone` : null, {
      name: playlist.name,
      description: playlist.description,
      mode: playlist.mode,
      playing: playlist.playing,
      fade: playlist.fade,
      channel: playlist.channel,
      sorting: playlist.sorting,
      seed: playlist.seed,
      folder: playlist.folder,
      sort: playlist.sort,
      flags: playlist.flags,
      ...patch,
      sounds: Array.from(sounds.values()).map((sound) => ({
        id: sound.id,
        name: sound.name,
        description: sound.description,
        path: sound.path,
        channel: sound.channel,
        playing: sound.playing,
        pausedTime: sound.pausedTime,
        repeat: sound.repeat,
        volume: sound.volume,
        fade: sound.fade,
        sort: sound.sort,
        flags: sound.flags
      }))
    })
  );
  playlist.toObject = function toObject() {
    return {
      _id: this.id,
      name: this.name,
      description: this.description,
      mode: this.mode,
      playing: this.playing,
      fade: this.fade,
      channel: this.channel,
      sorting: this.sorting,
      seed: this.seed,
      folder: this.folder,
      sort: this.sort,
      flags: this.flags ?? {},
      sounds: Array.from(this.sounds).map((sound) => sound.toObject()),
      ...passthroughSourceFields(this)
    };
  };

  playlist.playAll = vi.fn(async () => {
    playlist.playing = true;
    for (const sound of sounds) sound.playing = true;
    return playlist;
  });
  playlist.stopAll = vi.fn(async () => {
    playlist.playing = false;
    for (const sound of sounds) sound.playing = false;
    return playlist;
  });
  playlist.playSound = vi.fn(async (sound) => {
    sound.playing = true;
    playlist.playing = true;
    return playlist;
  });
  playlist.stopSound = vi.fn(async (sound) => {
    sound.playing = false;
    return playlist;
  });
  playlist.playNext = vi.fn(async (_soundId, _options) => {
    playlist.playing = true;
    return playlist;
  });

  return playlist;
}

function createTableResultDocument(id, data) {
  const row = createDocument(
    id,
    {
      type: data.type ?? "text",
      name: data.name ?? "",
      img: data.img ?? null,
      description: data.description ?? "",
      documentUuid: data.documentUuid ?? null,
      weight: data.weight ?? 1,
      range: data.range ?? [1, 1],
      drawn: data.drawn ?? false,
      flags: data.flags ?? {}
    },

    { validatePreview: validateTableResultPreview }
  );

  Object.defineProperty(row, "_source", {
    value: {
      _id: id,
      type: row.type,
      name: row.name,
      img: row.img,
      description: row.description,
      documentUuid: row.documentUuid,
      weight: row.weight,
      range: [...(row.range ?? [])],
      drawn: row.drawn,
      flags: { ...(row.flags ?? {}) }
    },
    writable: true,
    configurable: true,
    enumerable: false
  });
  row.toObject = function toObject() {
    return { ...this._source, range: [...(this._source.range ?? [])] };
  };

  const baseUpdateSource = row.updateSource.bind(row);
  row.updateSource = function updateSource(patch = {}, context = {}) {
    const merged = baseUpdateSource(patch, context);
    if (context.dryRun) return merged;
    for (const key of Object.keys(patch ?? {})) {
      if (key === "_id" || key === "id") continue;
      if (key.startsWith("-=")) {
        delete this._source[key.slice(2)];
        continue;
      }
      this._source[key] = merged[key];
    }
    return merged;
  };

  row.clone = vi.fn(async (patch = {}, context = {}) =>
    createTableResultDocument(
      context.keepId ? id : context.save ? `${id}-clone` : null,
      applyDocumentMerge(row.toObject(), patch, { performDeletions: true })
    )
  );
  return row;
}

function copySettingValue(value) {
  return value !== null && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
}

function isSameStoredValue(current, next) {
  return JSON.stringify(current ?? null) === JSON.stringify(next ?? null);
}

export function validateFilePathFieldPreview(source, field) {
  const value = source?.[field];
  if (typeof value !== "string" || value === "") return null;
  return /\.(apng|avif|bmp|gif|jpeg|jpg|png|svg|tiff|webp)(\?.*)?$/i.test(value)
    ? null
    : `${field}: does not have a valid file extension`;
}

function validateTableImgPreview(source) {
  return validateFilePathFieldPreview(source, "img");
}

const FIXTURE_DOCUMENT_NAMES = [
  "Actor",
  "Cards",
  "ChatMessage",
  "Folder",
  "Item",
  "JournalEntry",
  "Macro",
  "Playlist",
  "RollTable",
  "Scene",
  "User"
];

function validateTableResultPreview(source) {
  const img = validateTableImgPreview(source);
  if (img) return img;
  const uuid = source?.documentUuid;
  if (typeof uuid !== "string" || uuid.trim() === "") return null;
  const parts = uuid.split(".");
  const type = parts[0] === "Compendium" ? parts[3] : parts[0];
  const id = parts[0] === "Compendium" ? parts[4] : parts[1];
  return FIXTURE_DOCUMENT_NAMES.includes(type) && id
    ? null
    : `documentUuid: Invalid document type "${type ?? uuid}"`;
}

export function setRowDrawn(row, drawn) {
  row.drawn = drawn;
  row._source.drawn = drawn;
}

export function createCombatantDocument(id, data) {
  const authored = cleanCombatantSource({
    type: data.type ?? "base",
    system: data.system ?? {},
    actorId: data.actorId ?? null,
    tokenId: data.tokenId ?? null,
    sceneId: data.sceneId ?? null,
    name: data.name,
    img: data.img ?? null,
    initiative: data.initiative ?? null,
    hidden: data.hidden ?? false,
    defeated: data.defeated ?? false,
    group: data.group ?? null,
    ...(data.roundJoined === undefined ? {} : { roundJoined: data.roundJoined }),
    flags: data.flags ?? {}
  });
  const combatant = createDocument(
    id,
    { ...authored },

    { validatePreview: validateCombatantPreview }
  );

  combatant._source = {
    _id: id,

    ...authored
  };

  combatant.toObject = () => ({ ...combatant._source });

  const baseCombatantUpdateSource = combatant.updateSource.bind(combatant);
  combatant.updateSource = function updateSource(patch = {}, context = {}) {
    const merged = cleanCombatantSource(baseCombatantUpdateSource(patch, context));
    if (context.dryRun) return merged;
    for (const key of Object.keys(patch ?? {})) {
      if (key === "_id" || key === "id") continue;
      if (key.startsWith("-=")) {
        delete this._source[key.slice(2)];
        continue;
      }
      this._source[key] = merged[key];
    }

    applyPrepareGroupToParent(this, this.parent);
    return merged;
  };
  combatant.clone = vi.fn(async (patch = {}, context = {}) => {
    const clone = createCombatantDocument(
      context.keepId ? id : context.save ? `${id}-clone` : null,
      applyDocumentMerge(combatant.toObject(), patch, { performDeletions: true })
    );

    clone.parent = combatant.parent;
    applyPrepareGroupToParent(clone, clone.parent);
    return clone;
  });

  combatant.isOwner = data.isOwner ?? true;
  combatant.isNPC = data.isNPC ?? true;
  if (data.derived) {
    Object.assign(combatant, data.derived);
  }
  return combatant;
}

function seedCombatantGroupDerivedData(group) {
  group.hidden = true;
  group.defeated = true;
  group.members = new Set();
}

function createCombatantGroupDocument(id, data) {
  const group = createDocument(
    id,
    {
      type: data.type ?? "base",
      system: data.system ?? {},
      name: data.name,
      img: data.img ?? null,
      initiative: data.initiative ?? null,
      ownership: data.ownership ?? { default: 0 },
      flags: data.flags ?? {}
    },
    { validatePreview: validateCombatantGroupPreview }
  );
  group._source = {
    _id: id,
    type: data.type ?? "base",
    system: data.system ?? {},
    name: data.name,
    img: data.img ?? null,
    initiative: data.initiative ?? null,
    ownership: data.ownership ?? { default: 0 },
    flags: data.flags ?? {}
  };
  group.toObject = () => ({ ...group._source });

  const baseGroupUpdateSource = group.updateSource.bind(group);
  group.updateSource = function updateSource(patch = {}, context = {}) {
    const merged = coerceBlankImgToNull(baseGroupUpdateSource(patch, context));
    if (context.dryRun) return merged;
    for (const key of Object.keys(patch ?? {})) {
      if (key === "_id" || key === "id") continue;
      if (key.startsWith("-=")) {
        delete this._source[key.slice(2)];
        continue;
      }
      this._source[key] = merged[key];
    }
    return merged;
  };
  group.clone = vi.fn(async (patch = {}, context = {}) =>
    createCombatantGroupDocument(
      context.keepId ? id : context.save ? `${id}-clone` : null,
      applyDocumentMerge(group.toObject(), patch, { performDeletions: true })
    )
  );

  seedCombatantGroupDerivedData(group);

  if (data.derived) Object.assign(group, data.derived);
  return group;
}

const FOUNDRY_ID_SHAPE = /^[a-zA-Z0-9]{16}$/;

function coerceBlankImgToNull(source) {
  if (source && typeof source.img === "string" && source.img.trim() === "") {
    return { ...source, img: null };
  }
  return source;
}

function cleanCombatantSource(source) {
  const cleaned = coerceBlankImgToNull(source);
  if (cleaned && typeof cleaned.group === "string") {
    const trimmed = cleaned.group.trim();
    if (trimmed !== cleaned.group || trimmed === "") {
      return { ...cleaned, group: trimmed === "" ? null : trimmed };
    }
  }
  return cleaned;
}

function applyPrepareGroupToParent(combatant, parent) {
  const groupId =
    combatant?._source?.group ?? (typeof combatant?.group === "string" ? combatant.group : null);
  const group = typeof groupId === "string" ? (parent?.groups?.get?.(groupId) ?? null) : null;
  if (!group) return;
  if (!(group.members instanceof Set)) group.members = new Set();
  group.members.add(combatant);
  if (group.hidden) group.hidden = combatant.hidden;
  if (group.defeated) group.defeated = combatant.defeated;
}

function isRejectedImgValue(img) {
  if (typeof img !== "string" || img.trim() === "") return false;
  return !/\.(apng|avif|bmp|gif|jpeg|jpg|png|svg|tiff|webp)(\?.*)?$/i.test(img);
}

function validateCombatantPreview(source) {
  if (isRejectedImgValue(source?.img)) {
    return "img: does not have a valid file extension";
  }

  for (const key of ["actorId", "tokenId", "sceneId", "group"]) {
    const value = source?.[key];
    const cleaned = typeof value === "string" ? value.trim() : value;
    if (typeof cleaned === "string" && cleaned !== "" && !FOUNDRY_ID_SHAPE.test(cleaned)) {
      return `${key}: must be a valid 16-character alphanumeric ID`;
    }
  }
  return null;
}

function validateCombatantGroupPreview(source) {
  return isRejectedImgValue(source?.img) ? "img: does not have a valid file extension" : null;
}

let fixtureEmbeddedIdCounter = 0;

function mintFixtureEmbeddedId(prefix) {
  fixtureEmbeddedIdCounter += 1;
  return `${prefix}${fixtureEmbeddedIdCounter}`
    .replace(/[^a-zA-Z0-9]/g, "")
    .padEnd(16, "z")
    .slice(0, 16);
}

export const COMBAT_GROUP_A = "combatGroupAAA11";

export const COMBAT_SCENE_A = "combatSceneAAAA1";
export const COMBAT_SCENE_B = "combatSceneBBBB2";
export const COMBAT_SCENE_C = "combatSceneCCCC3";

function validateCombatPatch(patch) {
  if (!patch || !Object.prototype.hasOwnProperty.call(patch, "scene")) return null;
  const scene = patch.scene;
  if (scene === null || scene === "") return null;
  if (typeof scene !== "string" || !/^[a-zA-Z0-9]{16}$/.test(scene.trim())) {
    return "scene: must be a valid 16-character alphanumeric ID";
  }
  return null;
}

function hasCardMediaExtension(value) {
  return /\.(apng|avif|bmp|gif|jpeg|jpg|png|svg|tiff|webp|webm|mp4|m4v|ogv)(\?.*)?$/i.test(value);
}

function validateCardMediaField(value, field) {
  if (typeof value !== "string" || value.trim() === "") return null;
  return hasCardMediaExtension(value) ? null : `${field}: does not have a valid file extension`;
}

function validateCardPreview(source) {
  const backError = validateCardMediaField(source?.back?.img, "back.img");
  if (backError) return backError;
  for (const [index, face] of (Array.isArray(source?.faces) ? source.faces : []).entries()) {
    const faceError = validateCardMediaField(face?.img, `faces.${index}.img`);
    if (faceError) return faceError;
  }
  if (source?.value !== undefined && source.value !== null && typeof source.value !== "number") {
    return "value: must be a finite number";
  }
  return null;
}

function swallowInvalidCardFaces(patch) {
  if (!Array.isArray(patch?.faces)) return [];
  return validateCardPreview({ faces: patch.faces }) ? ["faces"] : [];
}

function validateCardsImgPreview(source) {
  return validateCardMediaField(source?.img, "img");
}

function validateCardsCreatePreview(source) {
  const imgError = validateCardsImgPreview(source);
  if (imgError) return imgError;
  for (const card of Array.isArray(source?.cards) ? source.cards : []) {
    const cardError = validateCardPreview(card);
    if (cardError) return `cards: ${cardError}`;
  }
  return null;
}

/**
 * @param {string | null} id
 * @param {any} data
 * @param {{ arrayFieldSwallowsInvalidFaces?: boolean }} [options]
 */
function createCardDocument(id, data, { arrayFieldSwallowsInvalidFaces = false } = {}) {
  const card = createDocument(
    id,
    {
      name: data.name,
      description: data.description ?? "",
      type: data.type ?? "base",
      system: data.system ?? {},
      suit: data.suit ?? "",
      value: data.value ?? null,
      back: data.back ?? { text: "", img: null },
      faces: data.faces ?? [],
      face: data.face ?? null,
      drawn: data.drawn ?? false,
      width: data.width ?? null,
      height: data.height ?? null,
      rotation: data.rotation ?? 0,
      sort: data.sort ?? 0,
      flags: data.flags ?? {}
    },
    {
      validatePreview: validateCardPreview,
      swallowPatchKeys: arrayFieldSwallowsInvalidFaces ? swallowInvalidCardFaces : undefined
    }
  );

  Object.defineProperty(card, "_source", {
    value: {
      _id: id,
      name: card.name,
      description: card.description,
      type: card.type,
      system: { ...(card.system ?? {}) },
      suit: card.suit,
      value: card.value,
      back: { ...(card.back ?? {}) },
      faces: (card.faces ?? []).map((face) => ({ ...face })),
      face: card.face,
      drawn: card.drawn,
      origin: data.origin ?? null,
      width: card.width,
      height: card.height,
      rotation: card.rotation,
      sort: card.sort,
      flags: { ...(card.flags ?? {}) }
    },
    writable: true,
    configurable: true,
    enumerable: false
  });

  if (data.liveDrawn !== undefined) {
    card.drawn = data.liveDrawn;
  }
  card.toObject = function toObject() {
    return {
      ...this._source,
      system: { ...(this._source.system ?? {}) },
      back: { ...(this._source.back ?? {}) },
      faces: (this._source.faces ?? []).map((face) => ({ ...face })),
      flags: { ...(this._source.flags ?? {}) }
    };
  };

  Object.defineProperty(card, "origin", {
    get() {
      const originId = this._source.origin;
      return originId ? (globalThis.game.cards?.get?.(originId) ?? null) : null;
    },
    configurable: true,
    enumerable: false
  });

  Object.defineProperty(card, "isHome", {
    get() {
      return this.parent?.type === "deck" || this.origin === this.parent;
    },
    configurable: true,
    enumerable: false
  });
  const baseCardUpdateSource = card.updateSource.bind(card);
  card.updateSource = function updateSource(patch = {}, context = {}) {
    const merged = baseCardUpdateSource(patch, context);
    if (context.dryRun) return merged;
    for (const key of Object.keys(patch ?? {})) {
      if (key === "_id" || key === "id") continue;
      if (key.startsWith("-=")) {
        delete this._source[key.slice(2)];
        continue;
      }
      this._source[key] = merged[key];
    }
    return merged;
  };

  card.clone = vi.fn(async (patch = {}, context = {}) => {
    if (context.save && card.parent?.vetoRowCreates) {
      return undefined;
    }
    const source = applyDocumentMerge(card.toObject(), patch ?? {}, { performDeletions: true });
    delete source._id;
    delete source._stats;
    const cloneId = context.keepId ? card.id : context.save ? `${card.id}-clone` : null;

    const copy = createCardDocument(cloneId, { ...source, id: cloneId }, { arrayFieldSwallowsInvalidFaces });
    if (context.save && card.parent) {
      copy.parent = card.parent;
      card.parent.cards.set(copy);
      applyCardDerivedData(copy, card.parent);
    }
    return copy;
  });
  return card;
}

function applyCardDerivedData(card, stack) {
  const source = card._source;
  const shownFace = source.face === null || source.face === undefined ? null : source.faces?.[source.face];
  const derivedName = shownFace?.name ?? source.back?.name ?? null;
  if (derivedName) card.name = derivedName;
  const backImg = source.back?.img || stack?.img || "icons/svg/card-joker.svg";
  card.back = { ...(source.back ?? {}), img: backImg };

  Object.defineProperty(card, "img", {
    get() {
      return shownFace?.img || backImg;
    },
    configurable: true,
    enumerable: false
  });
}

/**
 * @param {string | null} id
 * @param {any} data
 * @param {{ arrayFieldSwallowsInvalidFaces?: boolean }} [options]
 */
export function createCardsDocument(id, data, { arrayFieldSwallowsInvalidFaces = false } = {}) {
  const cardDocs = (data.cards ?? []).map((card, index) =>
    createCardDocument(card.id ?? `${id}-card-${index + 1}`, card, { arrayFieldSwallowsInvalidFaces })
  );
  const cards = createCollection(cardDocs, {
    applyDefaults: () => ({
      description: "",
      type: "base",
      system: {},
      suit: "",
      value: null,
      back: { text: "", img: null },
      faces: [],
      face: null,
      drawn: false,
      origin: null,
      rotation: 0,
      sort: 0,
      flags: {}
    }),
    validatePreview: validateCardPreview,

    cleanSource: copyCardFacesForPreview,
    mutateSource: mutateCardSourceLikeCore
  });

  const stack = createDocument(
    id,
    {
      name: data.name,
      type: data.type ?? "deck",
      description: data.description ?? "",
      img: data.img ?? "icons/svg/card-hand.svg",
      width: data.width ?? null,
      height: data.height ?? null,
      rotation: data.rotation ?? 0,
      displayCount: data.displayCount ?? false,
      folder: data.folder ?? null,
      sort: data.sort ?? 0,
      system: data.system ?? {},
      flags: data.flags ?? {},
      ownership: data.ownership ?? { default: 0 },
      cards
    },
    { validatePreview: validateCardsImgPreview }
  );
  stack.cards = cards;
  Object.defineProperty(stack, "_source", {
    value: {
      _id: id,

      ...(data._stats !== undefined ? { _stats: data._stats } : {}),
      name: stack.name,
      type: stack.type,
      description: stack.description,
      img: stack.img,
      width: stack.width,
      height: stack.height,
      rotation: stack.rotation,
      displayCount: stack.displayCount,
      folder: stack.folder,
      sort: stack.sort,
      system: { ...(stack.system ?? {}) },
      flags: { ...(stack.flags ?? {}) },
      ownership: { ...(stack.ownership ?? {}) }
    },
    writable: true,
    configurable: true,
    enumerable: false
  });
  const cardsToObject = () => ({
    ...stack._source,
    system: { ...(stack._source.system ?? {}) },
    flags: { ...(stack._source.flags ?? {}) },
    ownership: { ...(stack._source.ownership ?? {}) },
    cards: [...cards].map((card) => card.toObject())
  });
  stack.toObject = cardsToObject;
  const baseStackUpdateSource = stack.updateSource.bind(stack);
  stack.updateSource = function updateSource(patch = {}, context = {}) {
    const merged = baseStackUpdateSource(patch, context);
    if (context.dryRun) return merged;
    for (const key of Object.keys(patch ?? {})) {
      if (key === "_id" || key === "id" || key === "cards") continue;
      if (key.startsWith("-=")) {
        delete this._source[key.slice(2)];
        continue;
      }
      this._source[key] = merged[key];
    }
    return merged;
  };
  const baseStackUpdate = stack.update.bind(stack);
  stack.update = vi.fn(async (patch = {}, options = {}) => {
    if (stack.vetoUpdate) return undefined;
    const changes = Object.entries(patch).filter(([key]) => key !== "_id");
    if (
      options.diff !== false &&
      changes.every(([key, value]) => isSameStoredValue(stack._source[key], value))
    ) {
      return undefined;
    }
    for (const [key, value] of changes) stack._source[key] = value;
    return baseStackUpdate(patch, options);
  });
  for (const card of cardDocs) {
    card.parent = stack;
  }
  for (const card of cardDocs) {
    applyCardDerivedData(card, stack);
  }

  Object.defineProperty(stack, "availableCards", {
    get() {
      return [...cards].filter((card) => this.type !== "deck" || !card.drawn);
    },
    configurable: true,
    enumerable: false
  });

  stack.clone = vi.fn(async (patch = {}, context = {}) => {
    const rows = [...cards].map((card) => {
      const source = card.toObject();
      delete source._id;
      delete source._stats;
      return context.save
        ? { ...source, id: undefined, drawn: false }
        : { ...source, id: card.id, drawn: source.drawn };
    });
    const merged = applyDocumentMerge(cardsToObject(), patch, { performDeletions: true });
    delete merged._id;
    return createCardsDocument(
      context.keepId ? id : context.save ? `${id}-clone` : null,
      { ...merged, cards: rows },
      { arrayFieldSwallowsInvalidFaces }
    );
  });

  stack.createEmbeddedDocuments = vi.fn(async (type, entries, options = {}) => {
    expect(type).toBe("Card");
    if (stack.vetoRowCreates) {
      return [];
    }

    if (options.keepId) {
      for (const entry of entries) {
        const rowId = entry?.id ?? entry?._id ?? null;
        if (rowId != null && cards.get(rowId)) {
          throw new Error(
            `The _id [${rowId}] already exists within the parent collection: Cards [${id}] cards`
          );
        }
      }
    }
    return entries.map((entry, index) => {
      const created = createCardDocument(entry.id ?? `${id}-card-created-${cards.size + index + 1}`, entry, {
        arrayFieldSwallowsInvalidFaces
      });
      created.parent = stack;
      cards.set(created);
      applyCardDerivedData(created, stack);
      return created;
    });
  });
  stack.updateEmbeddedDocuments = vi.fn(async (type, entries, options = {}) => {
    expect(type).toBe("Card");
    const vetoed = stack.vetoRowUpdates ?? null;
    const applied = [];
    for (const entry of entries) {
      const row = cards.get(entry._id);
      if (!row) continue;
      if (vetoed?.has?.(entry._id)) continue;
      const rawChanges = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "_id"));

      const swallowedKeys = arrayFieldSwallowsInvalidFaces ? swallowInvalidCardFaces(rawChanges) : [];
      const changes = swallowedKeys.length
        ? Object.fromEntries(Object.entries(rawChanges).filter(([key]) => !swallowedKeys.includes(key)))
        : rawChanges;

      const merged = applyDocumentMerge(row.toObject(), changes, { performDeletions: true });
      const changedKeys = Object.keys(changes).filter(
        (key) => !isSameStoredValue(row._source[key], merged[key])
      );
      if (options.diff !== false && changedKeys.length === 0) {
        continue;
      }

      if (validateCardPreview(merged)) continue;
      for (const key of Object.keys(changes)) {
        if (key !== "origin") row[key] = merged[key];
        row._source[key] = merged[key];
      }
      applied.push(row);
    }

    if (applied.length > 0) {
      for (const row of cards) {
        for (const [key, value] of Object.entries(row._source)) {
          if (key === "_id" || key === "origin") continue;
          row[key] = Array.isArray(value)
            ? value.map((entry) => (entry && typeof entry === "object" ? { ...entry } : entry))
            : value;
        }
        applyCardDerivedData(row, stack);
      }
    }
    return applied;
  });
  stack.deleteEmbeddedDocuments = vi.fn(async (type, ids) => {
    expect(type).toBe("Card");
    const vetoed = stack.vetoRowDeletes ?? null;
    const deleted = [];
    for (const cardId of ids) {
      if (vetoed?.has?.(cardId)) continue;
      const row = cards.get(cardId);
      if (!row) continue;
      cards.delete(cardId);
      deleted.push(row);
    }
    return deleted;
  });

  const runRecall = () => {
    if (stack.vetoRecall) return false;
    {
      if (stack.type === "deck") {
        for (const other of globalThis.game.cards ?? []) {
          if (other === stack) continue;
          if (other.vetoCardDeletes) continue;
          for (const card of [...(other.cards ?? [])]) {
            if (card.origin === stack) other.cards.delete(card.id);
          }
        }
        if (!stack.vetoOwnCardUpdates) {
          for (const card of [...cards]) {
            card._source.drawn = false;
            card.drawn = false;
          }
        }
      } else {
        for (const card of [...cards]) {
          if (card.isHome || !card.origin) continue;
          const originRow = card.origin.cards?.get?.(card.id) ?? null;
          if (originRow) {
            if (stack.dropReturnedRowsFromOrigin) card.origin.cards.delete(card.id);
            else {
              originRow._source.drawn = false;
              originRow.drawn = false;
            }
          }
          if (!stack.vetoOwnCardDeletes) cards.delete(card.id);
        }
      }

      for (const goneId of stack.vanishDuringRecall ?? []) {
        globalThis.game.cards?.delete?.(goneId);
      }
    }
    return true;
  };

  stack.documentName = "Cards";

  const postNotification = () => {
    stack.chatPosts = (stack.chatPosts ?? 0) + 1;
  };

  stack.shuffle = vi.fn(async ({ chatNotification = true } = {}) => {
    if (stack.actionThrowsBeforeWrite) throw stack.actionThrowsBeforeWrite;
    const order = stack.shuffleOrder ?? [...cards].map((card) => card.id).reverse();
    await stack.updateEmbeddedDocuments(
      "Card",
      order.map((cardId, index) => ({ _id: cardId, sort: index }))
    );
    if (stack.actionThrowsAfterWrite) throw stack.actionThrowsAfterWrite;
    if (chatNotification) postNotification();
    return stack;
  });

  stack.recall = vi.fn(async ({ chatNotification = true } = {}) => {
    if (stack.actionThrowsBeforeWrite) throw stack.actionThrowsBeforeWrite;
    const ran = runRecall();
    if (stack.actionThrowsAfterWrite) throw stack.actionThrowsAfterWrite;
    if (ran && chatNotification) postNotification();
    return stack;
  });

  const drawCards = (number, how) => {
    const available = stack.availableCards;
    if (available.length < number) {
      throw new Error(`There are not ${number} available cards remaining in Cards [${stack.id}]`);
    }
    const sorted = [...available].sort((a, b) => (a._source.sort ?? 0) - (b._source.sort ?? 0));
    return how === 0 ? sorted.slice(0, number) : sorted.slice(-number);
  };

  stack.deal = vi.fn(async (to, number = 1, { how = 0, chatNotification = true } = {}) => {
    if (!Array.isArray(to) || !to.every((destination) => destination?.documentName === "Cards")) {
      throw new Error(
        "You must provide an array of Cards documents as the destinations for the Cards#deal operation"
      );
    }
    const total = number * to.length;
    const drawn = drawCards(total, how);
    /** @type {any[][]} */
    const toCreate = to.map(() => []);
    /** @type {any[]} */
    const toUpdate = [];
    /** @type {string[]} */
    const toDelete = [];
    for (let index = 0; index < total; index += 1) {
      const card = drawn[index];
      const createData = { ...card.toObject(), id: card.id };
      if (card.isHome || !createData.origin) createData.origin = stack.id;
      createData.drawn = true;
      toCreate[index % to.length].push(createData);
      if (card.isHome) toUpdate.push({ _id: card.id, drawn: true });
      else toDelete.push(card.id);
    }
    stack.mutateActionPlan?.({ action: "deal", toCreate, fromUpdate: toUpdate, fromDelete: toDelete });
    if (stack.vetoActionHook) return stack;
    if (stack.actionThrowsBeforeWrite) throw stack.actionThrowsBeforeWrite;
    await Promise.all([
      ...to.map((destination, index) =>
        destination.createEmbeddedDocuments("Card", toCreate[index], { keepId: true })
      ),
      stack.updateEmbeddedDocuments("Card", toUpdate),
      stack.deleteEmbeddedDocuments("Card", toDelete)
    ]);
    if (stack.actionThrowsAfterWrite) throw stack.actionThrowsAfterWrite;
    if (chatNotification) postNotification();
    return stack;
  });

  stack.pass = vi.fn(async (to, ids, { chatNotification = true } = {}) => {
    if (to?.documentName !== "Cards") {
      throw new Error("You must provide a Cards document as the recipient for the Cards#pass operation");
    }
    /** @type {any[]} */
    const toCreate = [];
    /** @type {any[]} */
    const toUpdate = [];
    /** @type {any[]} */
    const fromUpdate = [];
    /** @type {string[]} */
    const fromDelete = [];
    for (const cardId of ids) {
      const card = cards.get(cardId);
      if (!card)
        throw new Error(`undefined id [${cardId}] does not exist in the EmbeddedCollection collection.`);
      const deletedFromOrigin = Boolean(card.origin) && !card.origin.cards?.get?.(cardId);
      if (stack.type === "deck" && card.isHome && card.drawn) {
        throw new Error(`You may not pass Card ${cardId} which has already been drawn`);
      }
      if (card.origin === to && !deletedFromOrigin) {
        toUpdate.push({ _id: card.id, drawn: false });
      } else {
        const createData = { ...card.toObject(), id: card.id };
        const copyCard = card.isHome && to.type === "deck";
        if (copyCard) createData.origin = to.id;
        else if (card.isHome || !createData.origin) createData.origin = stack.id;
        createData.drawn = !copyCard && !deletedFromOrigin;
        toCreate.push(createData);
      }
      if (card.isHome && to.type !== "deck") fromUpdate.push({ _id: card.id, drawn: true });
      else if (!card.isHome) fromDelete.push(card.id);
    }
    stack.mutateActionPlan?.({ action: "pass", toCreate, toUpdate, fromUpdate, fromDelete });
    if (stack.vetoActionHook) return [];
    if (stack.actionThrowsBeforeWrite) throw stack.actionThrowsBeforeWrite;
    const created = to.createEmbeddedDocuments("Card", toCreate, { keepId: true });
    await Promise.all([
      created,
      to.updateEmbeddedDocuments("Card", toUpdate),
      stack.updateEmbeddedDocuments("Card", fromUpdate),
      stack.deleteEmbeddedDocuments("Card", fromDelete)
    ]);
    if (stack.actionThrowsAfterWrite) throw stack.actionThrowsAfterWrite;
    if (chatNotification) postNotification();
    return created;
  });

  stack.draw = vi.fn(async (from, number = 1, { how = 0, ...options } = {}) => {
    if (from?.documentName !== "Cards" || from === stack) {
      throw new Error(
        "You must provide some other Cards document as the source for the Cards#draw operation"
      );
    }
    const toDraw = from.drawCardsForTest(number, how);
    return from.pass(
      stack,
      toDraw.map((card) => card.id),
      options
    );
  });

  stack.drawCardsForTest = drawCards;

  stack.delete = vi.fn(async () => {
    runRecall();

    if (stack.throwOnDelete) throw stack.throwOnDelete;
    if (stack.vetoDelete) return undefined;
    stack.deleted = true;
    globalThis.game.cards?.delete?.(id);
    return stack;
  });
  return stack;
}

export function createCombatDocument(id, data) {
  const combatants = createCollection(
    (data.combatants ?? []).map((combatant, index) =>
      createCombatantDocument(combatant.id ?? `${id}-combatant-${index + 1}`, combatant)
    ),
    {
      applyDefaults: () => ({
        type: "base",
        system: {},
        actorId: null,
        tokenId: null,
        sceneId: null,
        img: null,
        initiative: null,
        hidden: false,
        defeated: false,
        group: null,
        ...(data.v14Combatants === true ? { roundJoined: 1 } : {}),
        flags: {}
      }),

      previewUpdateSource: true,
      validatePreview: validateCombatantPreview,

      cleanSource: cleanCombatantSource,
      mutateSource: mutateSourceWithStats,

      prepareParent: applyPrepareGroupToParent
    }
  );
  const groups = createCollection(
    (data.groups ?? []).map((group, index) =>
      createCombatantGroupDocument(group.id ?? `${id}-group-${index + 1}`, group)
    ),
    {
      applyDefaults: () => ({
        type: "base",
        system: {},
        img: null,
        initiative: null,
        ownership: { default: 0 },
        flags: {}
      }),
      validatePreview: validateCombatantGroupPreview,
      cleanSource: coerceBlankImgToNull,
      mutateSource: mutateSourceWithStats,

      prepareSelf: seedCombatantGroupDerivedData
    }
  );
  const combat = createDocument(
    id,
    {
      ...(data.name === undefined ? {} : { name: data.name }),
      type: data.type ?? "base",
      system: data.system ?? {},
      scene: data.scene ?? null,
      active: data.active ?? false,
      round: data.round ?? 0,
      turn: data.turn ?? null,
      sort: data.sort ?? 0,
      flags: data.flags ?? {},
      combatants,
      groups
    },

    { validatePreview: validateCombatPatch }
  );
  combat.combatants = combatants;
  combat.groups = groups;

  combat._source = {
    _id: id,
    scene: data.scene ?? null,
    active: data.active ?? false,
    round: data.round ?? 0,
    turn: data.turn ?? null,
    sort: data.sort ?? 0
  };

  if (data.derivedTurn !== undefined) combat.turn = data.derivedTurn;
  if (data.derivedRound !== undefined) combat.round = data.derivedRound;
  const liveToObject = combat.toObject.bind(combat);
  combat.toObject = () => ({ ...liveToObject(), round: combat._source.round, turn: combat._source.turn });

  Object.defineProperty(combat, "schema", {
    value: {
      fields: {
        scene: {
          clean: (value) => {
            if (typeof value !== "string") return value ?? null;
            const trimmed = value.trim();
            return trimmed === "" ? null : trimmed;
          }
        },

        combatants: {
          model: {
            schema: {
              fields: {
                group: {
                  clean: (value) => {
                    if (typeof value !== "string") return value ?? null;
                    const trimmed = value.trim();
                    return trimmed === "" ? null : trimmed;
                  }
                }
              }
            }
          }
        }
      }
    },
    enumerable: false,
    configurable: true,
    writable: true
  });

  combat.turns = data.turnOrder
    ? data.turnOrder.map((turnId) => combatants.get(turnId)).filter(Boolean)
    : [...combatants];
  if (data.withoutPreparedTurns) {
    combat.turns = undefined;
  }
  Object.defineProperty(combat, "combatant", {
    get() {
      if (!Array.isArray(this.turns) || this.turn === null || this.turn === undefined) return null;
      return this.turns[this.turn] ?? null;
    },
    configurable: true
  });

  const cloneEmbeddedRows = (collection, authored) =>
    Array.from(collection).map((row) => {
      const seed = (authored ?? []).find((entry) => entry?.id === row.id);
      return {
        ...row._source,
        id: row.id,
        ...(seed?.derived ? { derived: seed.derived } : {})
      };
    });
  combat.clone = vi.fn(async (patch = {}, context = {}) => {
    const cloneSource = applyDocumentMerge(
      {
        ...data,

        ...(combat.name === undefined ? {} : { name: combat.name }),
        type: combat.type,
        system: combat.system,
        scene: combat.scene,
        active: combat.active,
        round: combat.round,
        turn: combat.turn,
        sort: combat.sort,
        flags: combat.flags,
        combatants: cloneEmbeddedRows(combatants, data.combatants),
        groups: cloneEmbeddedRows(groups, data.groups),

        turnOrder: Array.isArray(combat.turns) ? combat.turns.map((turn) => turn.id) : undefined,
        withoutPreparedTurns: Boolean(data.clonesWithoutPreparedTurns)
      },
      patch,
      { performDeletions: true }
    );
    return createCombatDocument(context.keepId ? id : context.save ? `${id}-clone` : null, cloneSource);
  });

  const embeddedFamilies = {
    Combatant: {
      collection: combatants,
      factory: createCombatantDocument,
      prefix: "combatant",
      vetoes: () => ({
        create: combat.vetoCombatantCreates,
        update: combat.vetoCombatantUpdates,
        delete: combat.vetoCombatantDeletes
      })
    },
    CombatantGroup: {
      collection: groups,
      factory: createCombatantGroupDocument,
      prefix: "group",
      vetoes: () => ({
        create: combat.vetoGroupCreates,
        update: combat.vetoGroupUpdates,
        delete: combat.vetoGroupDeletes
      })
    }
  };

  function applyCombatantParentSideEffects() {
    const offScene =
      combat._source.scene &&
      Array.from(combatants).some((row) => {
        const rowScene = row?._source?.sceneId ?? null;
        return rowScene && rowScene !== combat._source.scene;
      });
    if (offScene) {
      combat._source.scene = null;
      combat.scene = null;
    }
    if (combat._source.round > 0 && typeof data.serverTurnAfterCombatantWrite === "number") {
      combat._source.turn = data.serverTurnAfterCombatantWrite;
      combat.turn = data.serverTurnAfterCombatantWrite;
    }
  }

  function applyConcurrentGroupCreate() {
    const spec = data.concurrentGroupOnCombatantWrite;
    if (!spec) return;
    if (groups.get(spec.id)) return;
    const created = createCombatantGroupDocument(spec.id, spec);
    created.parent = combat;
    groups.set(created);
  }

  function applySystemGroupInitiativePropagation(entry, row) {
    if (!data.systemPropagatesGroupInitiative) return;
    const groupId = row?._source?.group ?? null;
    if (!groupId) return;
    const group = groups.get(groupId);
    if (!group) return;
    const propagated = Object.prototype.hasOwnProperty.call(entry, "initiative")
      ? (entry.initiative ?? null)
      : null;
    group.initiative = propagated;
    group._source.initiative = propagated;
  }

  function applyFixtureCombatantPreCreate(entry) {
    if (data.v14Combatants !== true) return entry;
    const round = Number(combat.round);
    if (!Number.isInteger(round) || round < 1) return entry;
    return { ...entry, roundJoined: round };
  }

  combat.createEmbeddedDocuments = vi.fn(async (type, entries) => {
    const family = embeddedFamilies[type];
    expect(family, `unexpected embedded type ${type}`).toBeDefined();
    const vetoed = family.vetoes().create;
    const created = [];
    for (const [index, entry] of entries.entries()) {
      if (vetoed) continue;
      const row = family.factory(
        entry._id ?? mintFixtureEmbeddedId(family.prefix),
        type === "Combatant" ? applyFixtureCombatantPreCreate(entry) : entry
      );
      row.parent = combat;
      family.collection.set(row);
      created.push(row);
      if (type === "Combatant") applyCombatantParentSideEffects();
    }
    return created;
  });

  combat.updateEmbeddedDocuments = vi.fn(async (type, entries, options = {}) => {
    const family = embeddedFamilies[type];
    expect(family, `unexpected embedded type ${type}`).toBeDefined();
    const vetoed = family.vetoes().update;
    const applied = [];
    for (const entry of entries) {
      const row = family.collection.get(entry._id);
      if (!row) continue;
      if (vetoed?.has?.(entry._id)) continue;

      try {
        row.updateSource(entry, { dryRun: true, fallback: false });
      } catch {
        continue;
      }
      const changes = Object.entries(entry).filter(([key]) => key !== "_id");
      if (
        options.diff !== false &&
        changes.every(([key, value]) => isSameStoredValue(row._source[key], value))
      ) {
        continue;
      }
      for (const [key, value] of changes) {
        let stored = value;
        if (type === "Combatant" && (key === "img" || key === "group")) {
          stored = cleanCombatantSource({ [key]: value })[key];
        } else if (key === "img" && typeof value === "string" && value.trim() === "") {
          stored = null;
        }

        if (
          key === "initiative" &&
          typeof value === "number" &&
          typeof data.systemAdjustsInitiativeBy === "number"
        ) {
          stored = value + data.systemAdjustsInitiativeBy;
        }

        if (key === "initiative" && combat.hookClearsInitiativeIds?.has?.(row.id)) {
          stored = null;
        }
        row[key] = stored;
        row._source[key] = stored;
      }
      applied.push(row);
      if (type === "Combatant") {
        applyCombatantParentSideEffects();

        applySystemGroupInitiativePropagation(entry, row);
        applyConcurrentGroupCreate();
      }
    }
    return applied;
  });

  combat.deleteEmbeddedDocuments = vi.fn(async (type, ids) => {
    const family = embeddedFamilies[type];
    expect(family, `unexpected embedded type ${type}`).toBeDefined();
    const vetoed = family.vetoes().delete;
    const deleted = [];
    for (const rowId of ids) {
      if (vetoed?.has?.(rowId)) continue;
      const row = family.collection.get(rowId);
      family.collection.delete(rowId);
      if (row) deleted.push(row);

      if (
        type === "Combatant" &&
        combat._source.round > 0 &&
        typeof data.serverTurnAfterCombatantWrite === "number"
      ) {
        combat._source.turn = data.serverTurnAfterCombatantWrite;
        combat.turn = data.serverTurnAfterCombatantWrite;
      }
    }
    return deleted;
  });

  for (const row of combatants) row.parent = combat;
  for (const row of groups) row.parent = combat;

  for (const row of groups) {
    const derivedMembers = data.groupMemberIdsDerived?.[row.id];
    if (derivedMembers) {
      row.members = new Set(derivedMembers.map((memberId) => combatants.get(memberId)).filter(Boolean));
    }
  }

  function applyCombatStateWrite(changes) {
    if (combat.vetoCombatUpdates) return null;
    let changed = false;
    for (const [key, value] of Object.entries(changes)) {
      if (combat._source[key] === value) continue;
      changed = true;
      combat._source[key] = value;
      combat[key] = value;
    }

    return changed ? combat : null;
  }
  const turnCount = () => (Array.isArray(combat.turns) ? combat.turns.length : 0);
  combat.startCombat = vi.fn(async () => {
    applyCombatStateWrite({ round: 1, turn: 0 });
    return combat;
  });
  combat.activate = vi.fn(async () => {
    const written = applyCombatStateWrite({ active: true });

    if (!written) return written;
    for (const other of globalThis.game?.combats ?? []) {
      if (!other || other === combat || other.id === combat.id) continue;
      if (!(other._source?.active ?? other.active)) continue;
      if (other._source) other._source.active = false;
      other.active = false;
    }
    return written;
  });

  const liveRound = () => (typeof combat.round === "number" ? combat.round : (combat._source.round ?? 0));
  const liveTurn = () => (combat.turn === undefined ? (combat._source.turn ?? null) : combat.turn);
  combat.nextRound = vi.fn(async () => {
    const turn = liveTurn() === null || turnCount() === 0 ? null : 0;
    applyCombatStateWrite({ round: liveRound() + 1, turn });
    return combat;
  });
  combat.previousRound = vi.fn(async () => {
    if (liveRound() === 0) return combat;
    const turn = liveRound() === 1 || liveTurn() === null || turnCount() === 0 ? null : turnCount() - 1;
    applyCombatStateWrite({ round: liveRound() - 1, turn });
    return combat;
  });
  combat.nextTurn = vi.fn(async () => {
    if (liveRound() === 0) return combat.nextRound();
    const next = (liveTurn() ?? -1) + 1;

    if (next >= turnCount()) return combat.nextRound();
    applyCombatStateWrite({ round: liveRound(), turn: next });
    return combat;
  });
  combat.previousTurn = vi.fn(async () => {
    if (liveRound() === 0) return combat;

    if (liveTurn() === 0 || turnCount() === 0) return combat.previousRound();
    applyCombatStateWrite({ round: liveRound(), turn: (liveTurn() ?? turnCount()) - 1 });
    return combat;
  });
  combat.resetAll = vi.fn(async () => {
    for (const row of combatants) {
      row.initiative = null;
      row._source.initiative = null;
    }
    if (!combat.vetoCombatUpdates) {
      globalThis.Hooks?.callAll?.(
        "updateCombat",
        combat,
        { _id: combat.id, combatants: Array.from(combatants).map((row) => ({ ...row._source })) },
        { turnEvents: false, diff: false },
        globalThis.game?.user?.id ?? null
      );
    }

    const concurrent = data.concurrentInitiativeOnReset;
    if (concurrent) {
      const row = combatants.get(concurrent.combatantId);
      if (row) {
        row.initiative = concurrent.initiative;
        row._source.initiative = concurrent.initiative;
      }
    }
    return undefined;
  });
  combat.setInitiative = vi.fn(async (id, value) => {
    const row = combatants.get(id);
    if (!row) throw new Error(`Combatant id [${id}] does not exist in the EmbeddedCollection collection.`);
    await combat.updateEmbeddedDocuments("Combatant", [{ _id: id, initiative: value }]);
    return undefined;
  });
  combat.rollInitiative = vi.fn(async (ids, options = {}) => {
    const rolledIds = [];
    for (const id of ids ?? []) {
      const row = combatants.get(id);
      if (!row || row.isOwner === false) continue;
      rolledIds.push(id);
    }

    for (const extra of data.systemRollsExtraIds ?? []) if (!rolledIds.includes(extra)) rolledIds.push(extra);
    if (rolledIds.length === 0) return combat;

    await combat.updateEmbeddedDocuments(
      "Combatant",
      rolledIds.map((id, index) => ({ _id: id, initiative: data.combatInitiativeRoll ?? 10 + index })),
      { turnEvents: false }
    );
    if (data.throwAfterInitiativeWrite) throw new Error("chat creation failed");

    const flags = options?.messageOptions?.flags ?? {};
    for (const id of rolledIds) {
      const message = createDocument(mintFixtureEmbeddedId("initiative-msg"), { flags });
      message.getFlag = (scope, key) => message.flags?.[scope]?.[key] ?? null;
      globalThis.Hooks.callAll("createChatMessage", message, {}, globalThis.game.user.id);
    }

    if (data.throwAfterInitiativeChat) throw new Error("system wrapper failed after chat");

    combat.lastRollInitiativeOptions = options;
    return combat;
  });
  const selectRollableIds = (npcOnly) =>
    Array.from(combatants)
      .filter(
        (row) =>
          row.isOwner !== false && (row.initiative ?? null) === null && (!npcOnly || row.isNPC !== false)
      )
      .map((row) => row.id);

  combat.rollAll = vi.fn(async (options) => {
    const ids = selectRollableIds(false);
    return combat.rollInitiative(data.systemRollsFewer ? ids.slice(0, data.systemRollsFewer) : ids, options);
  });
  combat.rollNPC = vi.fn(async (options) => {
    const ids = selectRollableIds(true);
    return combat.rollInitiative(data.systemRollsFewer ? ids.slice(0, data.systemRollsFewer) : ids, options);
  });
  return combat;
}

export function createTableDocument(id, data) {
  const results = createCollection(
    (data.results ?? []).map((result, index) =>
      createTableResultDocument(result.id ?? `${id}-result-${index + 1}`, result)
    ),
    {
      applyDefaults: () => ({
        type: "text",
        weight: 1,
        drawn: false,
        description: "",
        img: null,
        flags: {}
      }),
      validatePreview: (source) =>
        Array.isArray(source?.range) && source.range.length === 2 && source.range[1] < source.range[0]
          ? "range: must be a length-2 array of ascending integers"
          : validateTableResultPreview(source),

      mutateSource: mutateSourceWithStats
    }
  );

  const table = createDocument(
    id,
    {
      ...(data._stats !== undefined ? { _stats: data._stats } : {}),
      name: data.name,
      img: data.img ?? null,
      description: data.description ?? "",
      formula: data.formula ?? "",
      replacement: data.replacement ?? true,
      displayRoll: data.displayRoll ?? true,
      folder: data.folder ?? null,
      sort: data.sort ?? 0,
      flags: data.flags ?? {},
      ownership: data.ownership ?? { default: 0 },
      results
    },
    { validatePreview: validateTableImgPreview }
  );

  table.results = results;

  if (id) {
    table.uuid = `RollTable.${id}`;
  }

  for (const result of results) {
    result.parent = table;
  }
  table.createEmbeddedDocuments = vi.fn(async (type, entries) => {
    expect(type).toBe("TableResult");
    return entries.map((entry, index) => {
      const result = createTableResultDocument(
        entry.id ?? `${id}-result-created-${results.size + index + 1}`,
        entry
      );
      result.parent = table;
      results.set(result);
      return result;
    });
  });

  table.updateEmbeddedDocuments = vi.fn(async (type, entries, options = {}) => {
    expect(type).toBe("TableResult");
    const vetoed = table.vetoResultUpdates ?? null;
    const applied = [];
    for (const entry of entries) {
      const result = results.get(entry._id);
      if (!result) continue;
      if (vetoed?.has?.(entry._id)) continue;
      const changes = Object.entries(entry).filter(([key]) => key !== "_id");
      if (
        options.diff !== false &&
        changes.every(([key, value]) => isSameStoredValue(result._source[key], value))
      ) {
        continue;
      }
      for (const [key, value] of changes) {
        result[key] = value;
        result._source[key] = value;
      }
      applied.push(result);
    }

    if (applied.length > 0) {
      for (const row of results) {
        for (const [key, value] of Object.entries(row._source)) {
          if (key === "_id") continue;
          row[key] = Array.isArray(value) ? [...value] : value;
        }
      }
    }
    return applied;
  });
  table.deleteEmbeddedDocuments = vi.fn(async (type, ids) => {
    expect(type).toBe("TableResult");
    const vetoed = table.vetoResultDeletes ?? null;
    const deleted = [];
    for (const resultId of ids) {
      if (vetoed?.has?.(resultId)) continue;
      const result = results.get(resultId);
      results.delete(resultId);
      deleted.push(result);
    }
    return deleted;
  });
  table.clone = vi.fn(async (patch = {}, context = {}) =>
    createTableDocument(context.keepId ? id : context.save ? `${id}-clone` : null, {
      name: table.name,
      img: table.img,
      description: table.description,
      formula: table.formula,
      replacement: table.replacement,
      displayRoll: table.displayRoll,
      folder: table.folder,
      sort: table.sort,
      flags: table.flags,
      ownership: table.ownership,
      ...patch,
      results: Array.from(results.values()).map((result) => ({
        id: result.id,
        type: result.type,
        name: result.name,
        img: result.img,
        description: result.description,
        documentUuid: result.documentUuid,
        weight: result.weight,
        range: result.range,
        drawn: result.drawn,
        flags: result.flags
      }))
    })
  );
  table.toObject = function toObject() {
    return {
      _id: this.id,
      name: this.name,
      img: this.img,
      description: this.description,
      formula: this.formula,
      replacement: this.replacement,
      displayRoll: this.displayRoll,
      folder: this.folder,
      sort: this.sort,
      flags: this.flags ?? {},
      ownership: this.ownership ?? {},
      results: Array.from(this.results).map((result) => result.toObject()),
      ...passthroughSourceFields(this)
    };
  };

  table.drawCalls = [];

  const isOwnParent = (candidate) =>
    candidate === table || candidate?.id === table.id || (candidate?.uuid && candidate.uuid === table.uuid);
  const resolveNested = async (row, depth = 0) => {
    const uuid = row.documentUuid ?? "";
    const parsed = globalThis.foundry?.utils?.parseUuid?.(uuid);
    if (parsed?.type !== "RollTable") return [row];

    if (depth >= 5) {
      throw new Error(`Maximum recursion depth exceeded when attempting to draw from RollTable ${table.id}`);
    }
    const inner = globalThis.game?.tables?.get?.(parsed.id) ?? null;
    if (!inner) return [row];

    const innerRow =
      Array.from(inner.results).find((candidate) => !candidate.drawn && candidate.id !== row.id) ?? null;
    if (!innerRow) return [];
    await new Promise((resolve) => setTimeout(resolve, 0));
    return resolveNested(innerRow, depth + 1);
  };

  const markNestedRows = async (rows) => {
    for (const row of rows) {
      const parent = row.parent ?? null;
      if (!parent) continue;
      if (isOwnParent(parent) || parent.replacement || parent.pack) continue;
      await parent.updateEmbeddedDocuments("TableResult", [{ _id: row.id, drawn: true }], { diff: false });
    }
  };
  const availableRows = (count) =>
    Array.from(results)
      .filter((row) => !row.drawn)
      .slice(0, count);
  const markDrawn = async (rows) => {
    if (table.replacement || rows.length === 0) return;
    await table.updateEmbeddedDocuments(
      "TableResult",
      rows.map((row) => ({ _id: row.id, drawn: true })),
      { diff: false }
    );
  };
  const postDrawMessage = () => {
    const message = createDocument(`chat-draw-${table.drawMessageCount++}`, {
      author: globalThis.game?.user?.id ?? null,

      flags: { core: { RollTable: table.id } }
    });
    globalThis.Hooks?.callAll?.("createChatMessage", message, {}, globalThis.game?.user?.id);
    return message;
  };

  const postForeignMessages = () => {
    const count = table.foreignChatMessage === true ? 1 : Number(table.foreignChatMessage) || 0;
    for (let index = 0; index < count; index += 1) postDrawMessage();
  };
  table.drawMessageCount = 1;
  table.draw = vi.fn(async (options = {}) => {
    table.drawCalls.push(options);
    if (table.drawFailure) throw table.drawFailure;
    if (table.drawNoPossibleMatch) {
      return { roll: { formula: table.formula || "1d1", total: 1 }, results: [] };
    }
    const picked = availableRows(1);
    const roll = { formula: table.formula || "1d1", total: picked.length ? picked[0].range[0] : 0 };
    if (picked.length === 0) {
      postForeignMessages();
      return { roll, results: [] };
    }
    await markDrawn(picked);
    const rows = options.recursive === false ? picked : await resolveNested(picked[0]);
    await markNestedRows(rows);

    postForeignMessages();
    if (table.chatFailure) throw table.chatFailure;
    if (options.displayChat !== false && rows.length > 0) {
      postDrawMessage();
    }
    return { roll, results: rows };
  });
  table.drawMany = vi.fn(async (count, options = {}) => {
    table.drawCalls.push({ count, ...options });
    if (table.drawFailure) throw table.drawFailure;

    if (table.drawLoopFailure) {
      const first = availableRows(1);
      if (!table.replacement) {
        for (const row of first) row.drawn = true;
      }
      throw table.drawLoopFailure;
    }
    const rows = availableRows(count);

    if (!table.replacement) {
      for (const row of rows) row.drawn = true;
    }
    if (table.drawUpdateFailure) throw table.drawUpdateFailure;
    await markDrawn(rows);
    const roll = rows.length
      ? { formula: `{${rows.map(() => table.formula || "1d1").join(",")}}`, total: rows.length }
      : { formula: "{}", total: 0 };

    postForeignMessages();
    if (table.chatFailure) throw table.chatFailure;
    if (options.displayChat !== false && rows.length > 0) {
      postDrawMessage();
    }
    return { roll, results: rows };
  });
  table.resetResults = vi.fn(async () =>
    table.updateEmbeddedDocuments(
      "TableResult",
      Array.from(results).map((row) => ({ _id: row.id, drawn: false })),
      { diff: false }
    )
  );

  return table;
}

function withEffects(document, effectEntries = []) {
  if (document.effects) {
    return document;
  }

  const effects = createCollection(
    effectEntries.map((effect, index) =>
      createDocument(effect.id ?? `${document.id}-effect-${index + 1}`, effect)
    )
  );
  document.effects = effects;
  attachEmbeddedEffectOps(document, effects, `${document.id}-effect`);
  return document;
}

function attachEmbeddedEffectOps(parent, effects, effectPrefix, itemOps) {
  parent.createEmbeddedDocuments = vi.fn(async (type, entries, options = {}) => {
    if (type === "ActiveEffect") {
      return entries.map((entry, index) => {
        const keptId = options.keepId ? (entry?._id ?? entry?.id ?? null) : (entry?.id ?? null);
        const effect = createDocument(keptId ?? `${effectPrefix}-created-${effects.size + index + 1}`, entry);
        effects.set(effect);
        return effect;
      });
    }
    if (itemOps) {
      return itemOps.create(type, entries);
    }
    throw new Error(`Unexpected embedded create type: ${type}`);
  });
  parent.updateEmbeddedDocuments = vi.fn(async (type, entries) => {
    if (type === "ActiveEffect") {
      return entries.map((entry) => {
        const effect = effects.get(entry._id);

        effect.applyStoredWrite(Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "_id")));
        return effect;
      });
    }
    if (itemOps) {
      return itemOps.update(type, entries);
    }
    throw new Error(`Unexpected embedded update type: ${type}`);
  });
  parent.deleteEmbeddedDocuments = vi.fn(async (type, ids) => {
    if (type === "ActiveEffect") {
      return ids.map((effectId) => {
        const effect = effects.get(effectId);
        effects.delete(effectId);
        return effect;
      });
    }
    if (itemOps) {
      return itemOps.delete(type, ids);
    }
    throw new Error(`Unexpected embedded delete type: ${type}`);
  });
}

export function createActorDocument(id, data) {
  const items = createCollection(
    (data.items ?? []).map((item, index) => createDocument(item.id ?? `${id}-item-${index + 1}`, item))
  );
  const effects = createCollection(
    (data.effects ?? []).map((effect, index) =>
      createDocument(effect.id ?? `${id}-effect-${index + 1}`, effect)
    )
  );

  const actor = createDocument(id, {
    ...data,
    name: data.name,
    type: data.type ?? "character",
    flags: data.flags ?? {},
    items
  });

  actor.documentName = "Actor";
  actor.items = items;
  actor.effects = effects;

  const itemOps = {
    create(type, entries) {
      expect(type).toBe("Item");
      return entries.map((entry, index) => {
        const item = createDocument(entry.id ?? `${id}-item-created-${items.size + index + 1}`, entry);
        items.set(item);
        return item;
      });
    },
    update(type, entries) {
      expect(type).toBe("Item");
      return entries.map((entry) => {
        const item = items.get(entry._id);
        Object.assign(item, Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "_id")));
        return item;
      });
    },
    delete(type, ids) {
      expect(type).toBe("Item");
      return ids.map((itemId) => {
        const item = items.get(itemId);
        items.delete(itemId);
        return item;
      });
    }
  };
  attachEmbeddedEffectOps(actor, effects, `${id}-effect`, itemOps);
  actor.getTokenDocument = vi.fn(async (overrides = {}) => {
    const tokenData = {
      name: actor.name,
      actorId: id,
      actorLink: false,
      texture: { src: "prototype.webp" },
      width: 1,
      height: 1,
      ...overrides
    };
    return { toObject: () => tokenData };
  });
  actor.toObject = function toObject() {
    return {
      _id: this.id,
      name: this.name,
      type: this.type,
      flags: this.flags ?? {},
      items: Array.from(this.items).map((item) => item.toObject()),

      ...(this._stats !== undefined ? { _stats: this._stats } : {}),
      ...(this.img !== undefined ? { img: this.img } : {}),
      ...(this.system !== undefined ? { system: this.system } : {}),
      ...(this.prototypeToken !== undefined ? { prototypeToken: this.prototypeToken } : {}),
      ...(this.folder !== undefined ? { folder: this.folder } : {}),
      ...(this.sort !== undefined ? { sort: this.sort } : {}),
      ...(this.ownership !== undefined ? { ownership: this.ownership } : {})
    };
  };

  return actor;
}

function mutateRegionBehaviorSource(source) {
  if (!source || typeof source !== "object") return;
  source._id = null;
  source._stats = { coreVersion: "13.351" };
  if (source.system && typeof source.system === "object") {
    source.system.__cleaned = true;
  }
}

function validateRegionBehaviorSource(source) {
  if (source?.system?.invalid === true) return "system.invalid: may not be true";
  const id = source?._id;
  if (id != null && !(typeof id === "string" && /^[a-zA-Z0-9]{16}$/.test(id))) {
    return "_id: must be a valid 16-character alphanumeric ID";
  }
  return null;
}

/**
 * @param {any} region
 * @param {any[]} entries
 */

let fabricatedBehaviorIdCounter = 0;
function stampFabricatedBehaviorIds(source) {
  if (!Array.isArray(source?.behaviors)) {
    return source;
  }
  return {
    ...source,
    behaviors: source.behaviors.map((row) =>
      row && typeof row === "object" && !row._id
        ? { ...row, _id: `fabricated-behavior-${++fabricatedBehaviorIdCounter}` }
        : row
    )
  };
}

function attachRegionBehaviors(region, entries) {
  const collection = createCollection([], {
    previewUpdateSource: true,

    mutateSource: mutateRegionBehaviorSource,

    validatePreview: validateRegionBehaviorSource
  });
  const make = (behaviorId, behaviorData) => {
    const behavior = createDocument(behaviorId, behaviorData, {
      validatePreview: validateRegionBehaviorSource
    });
    Object.defineProperty(behavior, "_source", {
      value: { _id: behaviorId, ...behaviorData },
      enumerable: false,
      configurable: true,
      writable: true
    });
    if (!behaviorData.name) {
      behavior.name = `Localized(${behaviorData.type})`;
    }

    const baseUpdateSource = behavior.updateSource.bind(behavior);
    behavior.updateSource = (patch = {}, context = {}) => {
      const result = baseUpdateSource(patch, context);
      if (!context.dryRun) {
        behavior._source = applyDocumentMerge(behavior._source, patch ?? {}, { performDeletions: true });
      }
      return result;
    };
    behavior.clone = vi.fn(async (patch = {}, context = {}) => {
      const merged = applyDocumentMerge(behaviorData, patch, { performDeletions: true });

      if (!context.keepId) delete merged._id;
      const cloneDoc = make(
        context.keepId ? behavior.id : context.save ? `${behavior.id}-clone` : null,
        merged
      );
      if (context.save) {
        collection.set(cloneDoc);
      }
      return cloneDoc;
    });
    return behavior;
  };
  entries.forEach((entry, index) =>
    collection.set(make(entry._id ?? entry.id ?? `${region.id}-behavior-${index + 1}`, entry))
  );
  region.behaviors = collection;

  Object.defineProperty(region, "makeBehavior", { value: make, enumerable: false, configurable: true });
  region.createEmbeddedDocuments = vi.fn(async (type, docs) =>
    docs.map((entry, index) => {
      const behavior = make(
        entry._id ?? entry.id ?? `${region.id}-behavior-created-${collection.size + index + 1}`,
        entry
      );
      collection.set(behavior);
      return behavior;
    })
  );
  region.updateEmbeddedDocuments = vi.fn(async (type, updates) =>
    updates
      .map((entry) => {
        const behavior = collection.get(entry._id);
        if (!behavior) return null;
        const patch = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "_id"));
        Object.assign(behavior, patch);
        behavior._source = applyDocumentMerge(behavior._source, patch, { performDeletions: true });
        return behavior;
      })
      .filter((behavior) => behavior != null)
  );
  region.deleteEmbeddedDocuments = vi.fn(async (type, ids) =>
    ids
      .map((behaviorId) => {
        const behavior = collection.get(behaviorId);
        collection.delete(behaviorId);
        return behavior;
      })
      .filter((behavior) => behavior != null)
  );
  return region;
}

function createSceneDocument(id, data) {
  const {
    tokens = [],
    tiles = [],
    sounds = [],
    walls = [],
    notes = [],
    drawings = [],
    lights = [],
    templates = [],
    regions = [],
    ...rest
  } = data;
  const scene = createDocument(id, rest);
  const collections = {};
  const makers = {};

  for (const [type, prefix, entries] of [
    ["Token", "token", tokens],
    ["Tile", "tile", tiles],
    ["AmbientSound", "sound", sounds],
    ["Wall", "wall", walls],
    ["Note", "note", notes],
    ["Drawing", "drawing", drawings],
    ["AmbientLight", "light", lights],
    ["MeasuredTemplate", "template", templates],
    ["Region", "region", regions]
  ]) {
    const collection = createCollection(
      [],

      type === "Region" ? { cleanSource: stampFabricatedBehaviorIds } : undefined
    );
    const make = (docId, docData) => {
      const doc = createDocument(docId, docData);

      if (type === "Region") {
        attachRegionBehaviors(doc, Array.isArray(docData.behaviors) ? docData.behaviors : []);

        const hasBehaviorCollection = () =>
          !Array.isArray(doc.behaviors) && typeof doc.behaviors?.get === "function";

        const behaviorSources = () => [...doc.behaviors].map((row) => ({ ...(row._source ?? {}) }));

        const mergeBehaviorSources = (entries) => {
          const merged = behaviorSources();
          for (const entry of entries ?? []) {
            const index = merged.findIndex((row) => row._id === entry?._id);
            if (index < 0) merged.push({ ...entry });
            else merged[index] = applyDocumentMerge(merged[index], entry, { performDeletions: true });
          }
          return merged;
        };
        const baseUpdateSource = doc.updateSource.bind(doc);
        doc.updateSource = (patch = {}, context = {}) => {
          const result = baseUpdateSource(patch, context);
          if (!context.dryRun && Array.isArray(doc.behaviors)) {
            doc.behaviors = stampFabricatedBehaviorIds({ behaviors: doc.behaviors }).behaviors;
          }
          if (
            context.dryRun &&
            Array.isArray(patch?.behaviors) &&
            hasBehaviorCollection() &&
            result &&
            Object.hasOwn(result, "behaviors")
          ) {
            const settled =
              JSON.stringify(mergeBehaviorSources(patch.behaviors)) === JSON.stringify(behaviorSources());
            if (settled) delete result.behaviors;
          }
          return result;
        };

        const baseApplyStoredWrite = doc.applyStoredWrite.bind(doc);
        doc.applyStoredWrite = (patch = {}) => {
          if (!Array.isArray(patch?.behaviors) || !hasBehaviorCollection())
            return baseApplyStoredWrite(patch);
          const { behaviors, ...rest } = patch ?? {};
          if (Object.keys(rest).length > 0) baseApplyStoredWrite(rest);
          {
            for (const entry of behaviors) {
              const values = Object.fromEntries(Object.entries(entry ?? {}).filter(([key]) => key !== "_id"));
              const row = entry?._id ? doc.behaviors.get(entry._id) : null;
              if (row) row.updateSource(values);
              else {
                doc.behaviors.set(
                  doc.makeBehavior(
                    entry?._id ?? `${doc.id}-behavior-stored-${doc.behaviors.size + 1}`,
                    values
                  )
                );
              }
            }
            docData.behaviors = behaviorSources();
          }
          return doc;
        };
      }
      doc.clone = vi.fn(async (patch = {}, context = {}) => {
        const merged = applyDocumentMerge(docData, patch, { performDeletions: true });
        const cloneDoc = make(
          context.keepId ? doc.id : context.save ? `${doc.id}-clone` : null,

          type === "Region" ? stampFabricatedBehaviorIds(merged) : merged
        );
        if (context.save) {
          collection.set(cloneDoc);
        }
        return cloneDoc;
      });
      return doc;
    };
    entries.forEach((entry, index) =>
      collection.set(make(entry.id ?? `${id}-${prefix}-${index + 1}`, entry))
    );
    collections[type] = collection;
    makers[type] = make;
  }

  scene.tokens = collections.Token;
  scene.tiles = collections.Tile;
  scene.sounds = collections.AmbientSound;
  scene.walls = collections.Wall;
  scene.notes = collections.Note;
  scene.drawings = collections.Drawing;
  scene.lights = collections.AmbientLight;
  scene.templates = collections.MeasuredTemplate;
  scene.regions = collections.Region;

  scene.createEmbeddedDocuments = vi.fn(async (type, entries) =>
    entries.map((entry, index) => {
      const doc = makers[type](
        entry._id ?? entry.id ?? `${id}-${type}-created-${collections[type].size + index + 1}`,
        entry
      );
      collections[type].set(doc);
      return doc;
    })
  );
  scene.updateEmbeddedDocuments = vi.fn(async (type, entries) =>
    entries.map((entry) => {
      const doc = collections[type].get(entry._id);

      doc.applyStoredWrite(Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "_id")));
      return doc;
    })
  );
  scene.deleteEmbeddedDocuments = vi.fn(async (type, ids) =>
    ids.map((embeddedId) => {
      const doc = collections[type].get(embeddedId);
      collections[type].delete(embeddedId);
      return doc;
    })
  );

  return scene;
}

export function createRequest(command, params = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.COMMAND_REQUEST,
    id: `req_${command}`,
    command,
    params
  };
}

// The GM of a fake world allows every command, so a test about a command's own behavior is answered by
// that command and not by the approval queue the default profile would send its deletions to. A test
// about the policy itself stores the policy it needs instead.
export function allowEveryCommandPolicy() {
  return {
    version: 1,
    overrides: Object.fromEntries(COMMAND_NAMES.map((command) => [command, "allow"]))
  };
}

export function clearStoredCommandPolicy() {
  globalThis.__routerTestState.settingValues.delete(`${MODULE_ID}.${MODULE_SETTING_KEYS.COMMAND_POLICY}`);
}

export function createPermissiveSettings() {
  return {
    get: vi.fn((namespace, key) =>
      namespace === MODULE_ID && key === MODULE_SETTING_KEYS.COMMAND_POLICY ? allowEveryCommandPolicy() : ""
    )
  };
}

export const FAKE_USER_PERMISSIONS = Object.freeze({
  ACTOR_CREATE: { defaultRole: 3 },
  FILES_UPLOAD: { defaultRole: 3 },
  MACRO_SCRIPT: { defaultRole: 1 },
  MESSAGE_WHISPER: { defaultRole: 1 },
  REGION_CREATE: { defaultRole: 2 },
  SETTINGS_MODIFY: { defaultRole: 3 },
  TOKEN_CREATE: { defaultRole: 3 }
});

export const FAKE_USER_ROLES = Object.freeze({
  NONE: 0,
  PLAYER: 1,
  TRUSTED: 2,
  ASSISTANT: 3,
  GAMEMASTER: 4
});

export function createUserDocument(id, data = {}) {
  const user = createDocument(id, {
    name: "Player",
    role: FAKE_USER_ROLES.PLAYER,
    color: "#111111",
    pronouns: "",
    avatar: null,
    character: null,
    active: false,
    permissions: {},
    flags: {},
    ...data
  });

  user.update = vi.fn(async (patch) => user.applyStoredWrite(patch));
  user.delete = vi.fn(async () => {
    globalThis.game.users?.delete?.(user.id);
    user.deleted = true;
    return user;
  });
  user.canUserModify = vi.fn((caller, _action, changes = {}) => {
    if ((caller?.role ?? 0) === FAKE_USER_ROLES.GAMEMASTER) return true;
    return !("permissions" in (changes ?? {}));
  });
  user.hasRole = (role) => (user.role ?? 0) >= role;
  user.hasPermission = (permission) =>
    Object.hasOwn(user.permissions ?? {}, permission)
      ? Boolean(user.permissions[permission])
      : (user.role ?? 0) >= (FAKE_USER_PERMISSIONS[permission]?.defaultRole ?? FAKE_USER_ROLES.GAMEMASTER);
  Object.defineProperty(user, "isGM", {
    get: () => (user.role ?? 0) >= FAKE_USER_ROLES.ASSISTANT,
    enumerable: false,
    configurable: true
  });

  return user;
}

export function installFakeFoundry() {
  ensureFilePickerNamespace();
  const directoryContents = new Map([
    ["", { dirs: ["worlds"], files: [] }],
    ["worlds", { dirs: ["worlds/world-1"], files: [] }],
    [
      "worlds/world-1",
      {
        dirs: ["worlds/world-1/maps"],
        files: [{ path: "worlds/world-1/readme.txt", size: 11, mimeType: "text/plain" }]
      }
    ],
    [
      "worlds/world-1/maps",
      {
        dirs: [],
        files: [{ path: "worlds/world-1/maps/dungeon.webp", size: 4, mimeType: "image/webp" }]
      }
    ]
  ]);
  const fileContents = new Map([
    ["worlds/world-1/readme.txt", new TextEncoder().encode("hello world")],
    ["worlds/world-1/maps/dungeon.webp", Uint8Array.from([1, 2, 3, 4])]
  ]);
  const fetchOverrides = new Map();
  const settingRegistrations = new Map();
  const settingValues = new Map([
    [`${MODULE_ID}.${MODULE_SETTING_KEYS.COMMAND_POLICY}`, allowEveryCommandPolicy()]
  ]);

  const scene = createSceneDocument("scene-1", {
    name: "Dungeon Level 1",
    active: true,
    navigation: true,
    navOrder: 1,
    width: 4000,
    height: 3000,
    grid: 100,
    tokenVision: true,
    weather: "clear",
    padding: 0,
    background: {
      src: "worlds/world-1/maps/dungeon.webp"
    },
    tokens: [
      {
        id: "token-a",
        name: "Valeros Token",
        actorId: "actor-1",
        actorLink: false,
        x: 100,
        y: 120,
        hidden: false,
        texture: { src: "tokens/valeros.webp" }
      },
      {
        id: "token-linked",
        name: "Linked Valeros",
        actorId: "actor-1",
        actorLink: true,
        x: 400,
        y: 400,
        hidden: false
      }
    ],
    tiles: [
      {
        id: "tile-a",
        x: 50,
        y: 60,
        width: 200,
        height: 200,
        rotation: 0,
        hidden: false,
        locked: false,
        texture: { src: "tiles/floor.webp" }
      }
    ],
    sounds: [
      {
        id: "sound-a",
        path: "sounds/wind.ogg",
        x: 10,
        y: 10,
        radius: 30,
        volume: 0.5,
        hidden: false
      }
    ],
    walls: [
      { id: "wall-plain", c: [0, 0, 100, 0], door: 0, ds: 0, doorSound: "" },
      { id: "wall-door", c: [0, 0, 0, 100], door: 1, ds: 0, doorSound: "woodBasic" },
      { id: "wall-secret", c: [100, 0, 100, 100], door: 2, ds: 2, doorSound: "stoneBasic" }
    ],
    notes: [
      {
        id: "note-quest",

        author: "user-1",
        entryId: "journal-1",
        x: 500,
        y: 400,
        iconSize: 40,
        text: "Quest giver",
        texture: { src: "icons/svg/book.svg", tint: "#ffffff" }
      },
      {
        id: "note-trap",
        entryId: null,
        x: 800,
        y: 900,
        iconSize: 32,
        text: "Hidden trap",
        texture: { src: "icons/svg/trap.svg" }
      }
    ],
    drawings: [
      {
        id: "drawing-rect",
        author: "user-1",

        name: "Danger drawing",
        shape: { type: "r", width: 200, height: 100 },
        x: 300,
        y: 400,
        text: "Danger zone",
        fillColor: "#ff0000",
        hidden: false
      },
      {
        id: "drawing-poly",
        author: "user-1",
        shape: { type: "p", points: [0, 0, 50, 50, 0, 100] },
        x: 700,
        y: 200,
        text: "",
        hidden: true
      }
    ],
    lights: [
      {
        id: "light-torch",

        name: "Torch sconce",
        x: 250,
        y: 250,
        walls: true,
        vision: false,
        config: { dim: 40, bright: 20, color: "#ffaa00" },
        hidden: false
      }
    ],
    templates: [
      {
        id: "template-fireball",
        author: "user-1",
        t: "circle",
        x: 500,
        y: 500,
        distance: 20,
        direction: 0,
        angle: 0,
        fillColor: "#ff6600",
        hidden: false
      },
      {
        id: "template-cone",
        author: "user-1",
        t: "cone",
        x: 800,
        y: 300,
        distance: 15,
        direction: 90,
        angle: 53,
        hidden: true
      }
    ],
    regions: [
      {
        id: "region-lava",
        name: "Lava Field",
        color: "#ff0000",
        shapes: [{ type: "rectangle", x: 0, y: 0, width: 500, height: 500 }],
        elevation: { bottom: 0, top: null },
        visibility: 2,
        locked: false,
        behaviors: [{ type: "damage", system: { damage: "2d6" } }]
      },
      {
        id: "region-safe",
        name: "Safe Zone",
        color: "#00ff00",
        shapes: [],
        visibility: 1,
        locked: true,

        behaviors: [
          {
            _id: "behavior-darkness",
            type: "adjustDarknessLevel",
            name: "Dim The Lights",
            disabled: false,
            system: { darknessLevel: 0.5 },
            flags: { mod: { tag: "keep" } }
          },
          { _id: "behavior-blank", type: "pauseGame", name: "", disabled: true, system: {} },
          {
            _id: "behavior-script",
            type: "executeScript",
            name: "Wipe",
            system: { source: "game.actors.forEach(a => a.delete())" }
          },
          { _id: "behavior-macro", type: "executeMacro", name: "Trap", system: { uuid: "Macro.abc" } }
        ]
      }
    ]
  });
  const inactiveScene = createSceneDocument("scene-2", {
    name: "Tavern",
    active: false,
    navigation: false,
    navOrder: 2,
    width: 2000,
    height: 1500,
    grid: 100,
    background: {
      src: "worlds/world-1/maps/tavern.webp"
    },

    tokens: [{ id: "token-1", actorId: "actor-1" }]
  });
  const item = withEffects(
    createDocument("item-1", {
      name: "Longsword",
      type: "weapon",
      img: "icons/svg/sword.svg",
      sort: 10,
      folder: null,
      system: {
        damage: "1d8"
      },
      flags: {
        dae: { macro: "burning" }
      }
    })
  );
  const journal = createJournalDocument("journal-1", {
    name: "GM Notes",
    pages: [
      {
        id: "page-1",
        name: "Overview",
        type: "text",
        text: {
          content: "Secret text"
        }
      }
    ]
  });

  const guardJournal = createJournalDocument("journal-guard", {
    name: "Guard Fixtures",

    categories: [{ id: "cat-lore", name: "Lore" }],
    pages: [
      { id: "gp-text", name: "Overview", type: "text", text: { content: "hi", format: 1 } },
      { id: "gp-empty-text", name: "Blank", type: "text", text: { content: "", format: 1 } },
      { id: "gp-image", name: "Cover", type: "image", src: "worlds/w/art/cover.webp" },
      { id: "gp-video", name: "Intro clip", type: "video", src: "worlds/w/media/intro.webm" },
      { id: "gp-pdf", name: "Handout", type: "pdf", src: "worlds/w/docs/handout.pdf" },
      { id: "gp-md", name: "Markdown notes", type: "text", text: { markdown: "# H", format: 2 } },

      {
        id: "gp-md-derived",
        name: "Markdown with derived content",
        type: "text",
        text: { markdown: "# H", content: "<h1>H</h1>", format: 2 }
      },
      { id: "gp-dnd5e", name: "Rule page", type: "rule" }
    ]
  });

  const previewJournal = createJournalDocument(
    "journal-preview",
    {
      name: "Preview Fixtures",
      pages: [
        { id: "pv-text", name: "Notes", type: "text", text: { content: "Original notes", format: 1 } },
        {
          id: "pv-image",
          name: "Keep",
          type: "image",
          src: "worlds/w/art/keep.webp",
          image: { caption: "The keep at dawn" }
        }
      ]
    },
    {
      validatePreview: (source) =>
        source && Object.prototype.hasOwnProperty.call(source, "badField")
          ? "JournalEntryPage validation failed: badField is not a valid field"
          : null
    }
  );
  const actor = createActorDocument("actor-1", {
    name: "Valeros",
    flags: {
      ActiveAuras: { radius: 10 }
    },
    items: [
      {
        id: "actor-item-1",
        name: "Shield",
        type: "armor",
        system: {
          armor: 2
        },
        flags: {
          dae: { transfer: true }
        }
      }
    ]
  });

  withEffects(actor.items.get("actor-item-1"));
  const macro = createDocument("macro-1", {
    name: "Heal Macro",
    type: "script",
    command: "console.log('heal');",
    img: "icons/svg/heal.svg",
    folder: null,
    scope: "global",
    flags: {
      "midi-qol": { onUseMacroName: "heal" }
    }
  });
  macro.canExecute = true;
  macro.execute = vi.fn(async () => undefined);
  const playlist = createPlaylistDocument("playlist-1", {
    name: "Tavern",
    mode: 0,
    channel: "music",
    sounds: [{ id: "sound-1", name: "Lute", path: "tavern/lute.ogg", volume: 0.8 }]
  });

  const table = createTableDocument("table-1", {
    name: "Loot",
    img: "worlds/test/loot.webp",
    formula: "1d6",
    replacement: false,
    results: [
      { id: "result-1", name: "Sword", range: [1, 3], weight: 2 },
      {
        id: "result-2",
        type: "document",
        name: "Goblin",
        documentUuid: "Actor.abc",
        range: [4, 6],
        drawn: true
      }
    ]
  });

  const categoryJournal = createJournalDocument("journal-categories", {
    name: "Categorised Journal",
    categories: [
      { id: "cat-chapter-two", name: "Chapter Two", sort: 200, flags: { mymod: { colour: "blue" } } },
      { id: "cat-chapter-one", name: "Chapter One", sort: 100 },
      { id: "cat-blank", name: "", sort: 300 }
    ],
    pages: [
      { id: "cj-page-a", name: "A", type: "text", category: "cat-chapter-one" },
      { id: "cj-page-b", name: "B", type: "text", category: "cat-chapter-one" },
      { id: "cj-page-c", name: "C", type: "text", category: "cat-chapter-two" },
      { id: "cj-page-d", name: "D", type: "text", category: null },

      { id: "cj-page-orphan", name: "Orphan", type: "text", category: "cat-long-gone" }
    ]
  });
  const journals = createCollection([journal, guardJournal, previewJournal, categoryJournal]);
  const macros = createCollection([macro]);
  const playlists = createCollection([playlist]);
  const tables = createCollection([table]);

  const combat = createCombatDocument("combat-1", {
    scene: COMBAT_SCENE_A,
    active: true,
    round: 2,
    turn: 0,
    sort: 5,
    flags: { "fvtt-world-cli": { seeded: true } },

    groups: [
      {
        id: COMBAT_GROUP_A,
        name: "Goblins",
        initiative: 15,
        ownership: { default: 0, aaaaaaaaaa111111: 2 },
        derived: { initiative: 777, hidden: false, defeated: false }
      }
    ],

    groupMemberIdsDerived: { [COMBAT_GROUP_A]: ["combatant-1"] },

    serverTurnAfterCombatantWrite: 1,
    combatants: [
      {
        id: "combatant-1",
        name: "Hero",
        tokenId: "token-a",
        sceneId: COMBAT_SCENE_A,
        actorId: "actor-1",
        initiative: 5
      },
      {
        id: "combatant-2",

        name: "",
        tokenId: "token-b",
        sceneId: COMBAT_SCENE_A,
        initiative: 20,
        group: COMBAT_GROUP_A,
        derived: {
          name: "Goblin (from token)",
          img: "tokens/goblin.webp",
          actorId: "actor-derived",
          initiative: 99,
          group: { id: COMBAT_GROUP_A, name: "Goblins" }
        }
      }
    ],
    turnOrder: ["combatant-2", "combatant-1"]
  });
  const emptyCombat = createCombatDocument("combat-2", {});
  const combats = createCollection([combat, emptyCombat]);

  const cardsDeck = createCardsDocument("cards-deck", {
    name: "Poker Deck",
    type: "deck",
    img: "worlds/test/deck.webp",
    description: "A scratch deck",
    folder: null,
    cards: [
      {
        id: "card-ace",
        name: "Stored Ace",
        suit: "S",
        value: 1,
        drawn: true,
        face: 0,
        faces: [{ name: "Face One", img: "worlds/test/ace.webp" }],
        sort: 100
      },
      { id: "card-king", name: "Stored King", suit: "S", value: 13, drawn: true, sort: 200 }
    ]
  });
  const cardsHand = createCardsDocument("cards-hand", {
    name: "Player Hand",
    type: "hand",
    cards: [
      { id: "card-ace", name: "Stored Ace", suit: "S", value: 1, drawn: true, origin: "cards-deck" },

      { id: "card-orphan", name: "Orphan", origin: "cards-deck" },

      { id: "card-own", name: "Hand Own" }
    ]
  });
  const cardsPile = createCardsDocument("cards-pile", {
    name: "Discard Pile",
    type: "pile",
    cards: [{ id: "card-king", name: "Stored King", drawn: true, origin: "cards-deck" }]
  });
  const cardStacks = createCollection([cardsDeck, cardsHand, cardsPile]);
  const actors = createCollection([actor]);

  const messages = createCollection([
    createDocument("msg-1", {
      author: "user-1",
      content: "first",
      speaker: { alias: "GM" },
      whisper: [],
      timestamp: 100
    }),
    createDocument("msg-2", {
      author: "user-1",
      content: "second",
      speaker: { alias: "GM" },
      whisper: [],
      timestamp: 200
    }),
    createDocument("msg-3", {
      author: "user-1",
      content: "third",
      speaker: { alias: "GM" },
      whisper: [],
      timestamp: 300
    })
  ]);

  const archmageSource = {
    _id: "arch1",
    name: "Archmage",
    type: "npc",

    folder: "pack-folder-monsters",
    sort: 7000,
    img: "compendium/archmage.png",
    prototypeToken: {
      name: "Archmage",
      texture: { src: "compendium/archmage-token.webp" },
      actorLink: false
    },
    system: { attributes: { hp: { value: 99, max: 99 } } },
    items: [
      {
        _id: "spell1",
        name: "Fireball",
        type: "spell",
        effects: [{ _id: "nested-item-eff", name: "Nested Item Effect", changes: [] }]
      },
      { _id: "feat1", name: "Magic Resistance", type: "feat" }
    ],
    effects: [
      {
        _id: "arch-eff-1",
        name: "Archmage Aura",
        disabled: false,
        changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "2" }],
        system: {},
        flags: {}
      }
    ]
  };
  const actorsPack = {
    collection: "world.test-monsters",
    documentName: "Actor",
    title: "Test Monsters",
    metadata: {
      id: "world.test-monsters",
      label: "Test Monsters",
      system: "dnd5e",
      packageName: "world",
      packageType: "world",
      type: "Actor"
    },

    getIndex: vi.fn(async (options) => {
      const row = { _id: "arch1", name: "Archmage", type: "npc", img: "compendium/archmage.png" };
      if (Array.isArray(options?.fields) && options.fields.includes("flags.ddbimporter.definitionId")) {
        row.flags = { ddbimporter: { definitionId: 42 } };
      }
      return [row];
    }),
    getDocument: vi.fn(async (id) =>
      id === "arch1" ? makePackEntry("world.test-monsters", "Actor", archmageSource) : null
    )
  };
  const itemsPack = {
    collection: "world.test-items",
    documentName: "Item",
    title: "Test Items",
    metadata: { id: "world.test-items", label: "Test Items", type: "Item" },
    getIndex: vi.fn(async () => [{ _id: "it1", name: "Staff", type: "weapon" }]),

    getDocument: vi.fn(async (id) => {
      if (id === "it1") {
        return makePackEntry("world.test-items", "Item", {
          _id: "it1",
          name: "Staff",
          type: "weapon",
          system: {}
        });
      }
      if (id === "it-full") {
        return makePackEntry("world.test-items", "Item", {
          _id: "it-full",
          name: "Longsword",
          type: "weapon",

          folder: "pack-folder-items",
          system: { damage: "1d8" },
          flags: { mymod: { forged: true } },
          effects: [
            {
              _id: "eff-src",
              name: "Sharpened",
              origin: "Compendium.world.test-items.Item.it-full",
              changes: []
            }
          ]
        });
      }
      return null;
    })
  };

  const worldImportPacks = [
    makeCompendiumPack("world.test-journals", "JournalEntry", {
      "jrn-src": {
        _id: "jrn-src",
        name: "Saltmarsh Lore",
        folder: "pack-folder-journals",
        sort: 3000,
        pages: [
          { _id: "pg-src", name: "Rumours", type: "text", text: { content: "<p>Hooks</p>", format: 1 } }
        ],
        flags: { mymod: { lore: true } }
      }
    }),
    makeCompendiumPack("world.test-scene-pack", "Scene", {
      "scn-src": {
        _id: "scn-src",
        name: "Sunken Temple",
        folder: "pack-folder-scenes",
        sort: 900,

        active: true,
        navigation: true,
        navOrder: 42,
        width: 3000,
        height: 2000,
        background: { src: "packs/temple.webp" },

        backgroundColor: "#101010",
        regions: [
          {
            _id: "rgn-src",
            name: "Trap Zone",

            behaviors: [{ _id: "bhv-src", type: "executeScript", system: { source: "console.log(1)" } }]
          }
        ]
      }
    }),
    makeCompendiumPack("world.test-macro-pack", "Macro", {
      "mac-src": {
        _id: "mac-src",
        name: "Pack Macro",
        type: "script",
        command: "console.log('from the pack');",
        scope: "global",
        folder: "pack-folder-macros",
        sort: 100,

        author: "packauthor000001"
      }
    }),
    makeCompendiumPack("world.test-playlist-pack", "Playlist", {
      "pls-src": {
        _id: "pls-src",
        name: "Temple Ambience",
        folder: "pack-folder-playlists",
        sort: 200,
        sounds: [{ _id: "snd-src", name: "Drips", path: "packs/drips.ogg", volume: 0.4 }]
      }
    }),
    makeCompendiumPack("world.test-table-pack", "RollTable", {
      "tbl-src": {
        _id: "tbl-src",
        name: "Pack Loot",
        formula: "1d2",
        folder: "pack-folder-tables",
        sort: 300,
        results: [{ _id: "res-src", type: "text", text: "A coin", range: [1, 2], weight: 1, drawn: false }]
      }
    }),
    makeCompendiumPack("world.test-cards-pack", "Cards", {
      "crd-src": {
        _id: "crd-src",
        name: "Pack Deck",
        type: "deck",
        folder: "pack-folder-cards",
        sort: 400,

        cards: [{ _id: "card-src", name: "Ace", value: 1, drawn: true, back: {}, faces: [] }]
      }
    })
  ];

  const packs = createCollection([
    { id: actorsPack.collection, ...actorsPack },
    { id: itemsPack.collection, ...itemsPack },
    ...worldImportPacks.map((pack) => ({ id: pack.collection, ...pack }))
  ]);

  actors.importFromCompendium = vi.fn(async () => {
    throw new Error("importFromCompendium must not be used by the bridge");
  });

  const folders = createCollection([
    createDocument("folder-actors-test", { name: "Test", type: "Actor", folder: null }),
    createDocument("folder-items-test", { name: "Test", type: "Item", folder: null })
  ]);

  const users = createCollection([
    createUserDocument("user-1", { name: "GM", role: FAKE_USER_ROLES.GAMEMASTER, active: true }),
    createUserDocument("player-1", {
      name: "Hrelga",
      active: true,
      permissions: { FILES_UPLOAD: true }
    }),
    createUserDocument("player-2", { name: "Kelric" })
  ]);

  const deltaActor = createActorDocument("token-a-delta", {
    name: "Valeros Token",
    items: [{ id: "delta-item-1", name: "Dagger", type: "weapon", system: { damage: "1d4" } }]
  });

  withEffects(deltaActor.items.get("delta-item-1"));
  scene.tokens.get("token-a").actor = deltaActor;
  scene.tokens.get("token-linked").actor = actor;

  globalThis.game = {
    ready: true,
    world: {
      id: "world-1",
      title: "Automation Test World"
    },
    user: {
      id: "user-1",
      name: "GM",
      isGM: true,
      role: FAKE_USER_ROLES.GAMEMASTER
    },

    modules: createCollection([
      {
        id: "fvtt-world-cli",
        title: "World CLI for Foundry VTT",
        version: "0.1.0",
        active: true
      },
      {
        id: "dae",
        title: "Dynamic Active Effects",
        version: "11.0.0",
        active: false
      }
    ]),
    settings: {
      settings: settingRegistrations,
      register: vi.fn((namespace, key, config) => {
        const id = `${namespace}.${key}`;
        settingRegistrations.set(id, { ...config, namespace, key, id });
      }),
      registerMenu: vi.fn(),
      get: vi.fn((namespace, key) => {
        const id = `${namespace}.${key}`;
        if (settingValues.has(id)) {
          return copySettingValue(settingValues.get(id));
        }

        const registration = settingRegistrations.get(id);
        return registration && registration.default !== undefined
          ? copySettingValue(registration.default)
          : "";
      }),
      set: vi.fn(async (namespace, key, value) => {
        const stored = copySettingValue(value);
        settingValues.set(`${namespace}.${key}`, stored);
        return copySettingValue(stored);
      })
    },
    users,
    scenes: createCollection([scene, inactiveScene]),
    items: createCollection([item]),
    journal: journals,
    macros,
    playlists,
    tables,
    combats,
    cards: cardStacks,
    actors,
    messages,
    packs,
    folders
  };

  globalThis.foundry.applications.apps.FilePicker.implementation = {
    browse: vi.fn(async (_source, target) => {
      const key = typeof target === "string" ? target : "";
      const entry = directoryContents.get(key);
      if (entry) {
        return {
          target: key,
          dirs: entry.dirs,
          files: entry.files
        };
      }

      if (fileContents.has(key)) {
        return {
          target: key,
          dirs: [],
          files: []
        };
      }

      throw new Error(`Path not found: ${key}`);
    }),
    createDirectory: vi.fn(async (_source, target) => {
      if (directoryContents.has(target)) {
        throw new Error(`Directory already exists: ${target}`);
      }

      const parentPath = getParentPath(target);
      const parentEntry = directoryContents.get(parentPath);
      if (!parentEntry) {
        throw new Error(`Path not found: ${parentPath}`);
      }

      parentEntry.dirs = [...parentEntry.dirs, target].sort();
      directoryContents.set(target, { dirs: [], files: [] });
    }),
    upload: vi.fn(async (_source, target, file) => {
      const storedPath = target ? `${target}/${file.name}` : file.name;
      const directoryEntry = directoryContents.get(target);
      if (!directoryEntry) {
        throw new Error(`Path not found: ${target}`);
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      fileContents.set(storedPath, bytes);
      directoryEntry.files = [
        ...directoryEntry.files.filter((entry) => entry.path !== storedPath),
        {
          path: storedPath,
          size: bytes.byteLength,
          mimeType: file.type || "application/octet-stream"
        }
      ].sort((left, right) => left.path.localeCompare(right.path));

      return { path: storedPath };
    })
  };

  globalThis.fetch = vi.fn(async (path) => {
    const resolvedPath = String(path)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
    const override = fetchOverrides.get(resolvedPath);
    if (override) {
      return override;
    }

    const bytes = fileContents.get(resolvedPath);
    if (!bytes) {
      return createFetchResponse({ ok: false, status: 404, bytes: new Uint8Array() });
    }

    const contentType = resolvedPath.endsWith(".txt") ? "text/plain" : "image/webp";
    return createFetchResponse({ ok: true, status: 200, bytes, contentType });
  });

  globalThis.__routerTestState = {
    directoryContents,
    fileContents,
    fetchOverrides,
    settingValues
  };

  globalThis.Item = makeDocumentClass({
    validatePreview: (source) => validateFilePathFieldPreview(source, "img"),
    mutateSource: mutateWorldSourceLikeCore,
    create: vi.fn(async (data) => createDocument("item-created", data))
  });

  delete globalThis.Item.fromCompendium;

  globalThis.JournalEntry = makeDocumentClass({
    mutateSource: mutateWorldSourceLikeCore,
    create: vi.fn(async (data) => {
      const journalEntry = createJournalDocument("journal-created", data);
      journals.set(journalEntry);
      return journalEntry;
    })
  });
  globalThis.Macro = makeDocumentClass({
    validatePreview: (source) => validateFilePathFieldPreview(source, "img"),
    mutateSource: mutateWorldSourceLikeCore,
    create: vi.fn(async (data) => {
      const macroDoc = createDocument("macro-created", data);
      macros.set(macroDoc);
      return macroDoc;
    })
  });

  globalThis.Scene = makeDocumentClass({
    validatePreview: (source) => validateFilePathFieldPreview(source, "thumb"),
    mutateSource: mutateWorldSourceLikeCore,
    create: vi.fn(async (data) => {
      const sceneDoc = createDocument("scene-created", data);
      globalThis.game.scenes.set(sceneDoc);
      return sceneDoc;
    })
  });

  globalThis.Playlist = makeDocumentClass({
    mutateSource: mutateWorldSourceLikeCore,
    create: vi.fn(async (data) => {
      const playlistDoc = createPlaylistDocument("playlist-created", data);
      playlists.set(playlistDoc);
      return playlistDoc;
    })
  });

  globalThis.RollTable = makeDocumentClass({
    validatePreview: (source) => {
      const table = validateTableImgPreview(source);
      if (table) return table;
      for (const result of Array.isArray(source?.results) ? source.results : []) {
        const row = validateTableResultPreview(result);
        if (row) return `results: ${row}`;
      }
      return null;
    },

    cleanSource: (source) =>
      Array.isArray(source?.results)
        ? {
            ...source,
            results: source.results.map((result, index) => ({
              ...result,
              _id: result?._id ?? `preview-result-${index + 1}`
            }))
          }
        : source,

    mutateSource: mutateTableSourceLikeCore,
    create: vi.fn(async (data) => {
      const tableDoc = createTableDocument("table-created", data);
      tables.set(tableDoc);
      return tableDoc;
    })
  });

  globalThis.Combat = makeDocumentClass({
    mutateSource: mutateCombatSourceLikeCore,
    applyDefaults: () => ({
      type: "base",
      system: {},
      scene: null,
      active: false,
      round: 0,
      turn: null,
      sort: 0,
      flags: {}
    }),
    create: vi.fn(async (data) => {
      const combatDoc = createCombatDocument("combat-created", data);
      combats.set(combatDoc);
      return combatDoc;
    })
  });

  globalThis.Cards = makeDocumentClass({
    mutateSource: mutateCardsSourceLikeCore,

    cleanSource: copyCardEntriesForPreview,

    validatePreview: validateCardsCreatePreview,
    applyDefaults: () => ({
      description: "",
      img: "icons/svg/card-hand.svg",
      system: {},
      cards: [],
      rotation: 0,
      displayCount: false,
      folder: null,
      sort: 0,
      ownership: { default: 0 },
      flags: {}
    }),
    create: vi.fn(async (data) => {
      const stackDoc = createCardsDocument("cards-created", {
        ...data,

        cards: (data.cards ?? []).map((card) => ({ ...card, id: undefined, _id: undefined, drawn: false }))
      });
      globalThis.game.cards.set(stackDoc);
      return stackDoc;
    })
  });
  globalThis.Actor = makeDocumentClass({
    validatePreview: (source) => validateFilePathFieldPreview(source, "img"),
    mutateSource: mutateWorldSourceLikeCore,
    create: vi.fn(async (data) => {
      const actorDoc = createActorDocument("actor-created", data);
      globalThis.game.actors.set(actorDoc);
      return actorDoc;
    })
  });
  globalThis.ChatMessage = makeDocumentClass({
    create: vi.fn(async (data) => {
      const messageDoc = createDocument("message-created", data);
      messages.set(messageDoc);
      return messageDoc;
    })
  });

  globalThis.ChatMessage.getSpeaker = vi.fn(() => ({ alias: "GM" }));

  const rollConstructSpy = vi.fn();
  const rollEvaluateSpy = vi.fn();
  const rollToMessageSpy = vi.fn();
  globalThis.Roll = class MockRoll {
    constructor(formula) {
      this.formula = formula;
      rollConstructSpy(formula);
    }
    async evaluate(options) {
      rollEvaluateSpy(options);
      if (globalThis.Roll?.shouldThrow) {
        throw new Error("could not parse formula");
      }
      return this;
    }
    toJSON() {
      return { formula: this.formula, total: 7 };
    }
    toMessage(...args) {
      return rollToMessageSpy(...args);
    }
  };
  globalThis.Roll.constructSpy = rollConstructSpy;
  globalThis.Roll.evaluateSpy = rollEvaluateSpy;
  globalThis.Roll.toMessageSpy = rollToMessageSpy;
  globalThis.Roll.shouldThrow = false;

  globalThis.ChatLog = { processMessage: vi.fn() };

  globalThis.Folder = makeFolderDocumentClass(vi.fn(async (data) => createDocument("folder-created", data)));

  globalThis.game.items.documentClass = globalThis.Item;
  globalThis.game.journal.documentClass = globalThis.JournalEntry;
  globalThis.game.macros.documentClass = globalThis.Macro;
  globalThis.game.playlists.documentClass = globalThis.Playlist;
  globalThis.game.tables.documentClass = globalThis.RollTable;
  globalThis.game.combats.documentClass = globalThis.Combat;
  globalThis.game.cards.documentClass = globalThis.Cards;
  globalThis.game.scenes.documentClass = globalThis.Scene;
  globalThis.game.actors.documentClass = globalThis.Actor;
  globalThis.game.folders.documentClass = globalThis.Folder;
  globalThis.game.messages.documentClass = globalThis.ChatMessage;

  for (const [collectionName, documentName] of [
    ["items", "Item"],
    ["actors", "Actor"],
    ["journal", "JournalEntry"]
  ]) {
    const collection = globalThis.game[collectionName];
    const DocumentClass = collection.documentClass;
    expect(DocumentClass, `${documentName} document class stand-in`).toBeTruthy();
    DocumentClass.updateDocuments = vi.fn(async (entries = []) =>
      entries.map((entry) => {
        const document = collection.get(entry._id);
        if (!document) return undefined;

        document.applyStoredWrite(Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "_id")));
        return document;
      })
    );
    DocumentClass.deleteDocuments = vi.fn(async (ids = []) =>
      ids.map((documentId) => {
        const document = collection.get(documentId);
        if (!document) return undefined;
        document.deleted = true;
        collection.delete(documentId);
        return document;
      })
    );
  }

  for (const [collectionName, documentName] of [
    ["items", "Item"],
    ["actors", "Actor"],
    ["journal", "JournalEntry"],
    ["scenes", "Scene"],
    ["macros", "Macro"],
    ["playlists", "Playlist"],
    ["tables", "RollTable"],
    ["cards", "Cards"]
  ]) {
    globalThis.game[collectionName].fromCompendium = vi.fn((source, options = {}) =>
      fromCompendiumLikeCore(documentName, source, options)
    );
  }

  globalThis.foundry = {
    applications: {
      apps: {
        FilePicker: {
          implementation: globalThis.foundry.applications.apps.FilePicker.implementation
        }
      }
    },
    utils: {
      mergeObject: (base, patch, options) => applyDocumentMerge(base, patch, options),

      deepClone: (value) => structuredClone(value),

      randomID: () =>
        `batchid${String((globalThis.__batchIdCounter = (globalThis.__batchIdCounter ?? 0) + 1)).padStart(8, "0")}`,

      parseUuid: (uuid) => {
        if (typeof uuid !== "string" || uuid === "") return null;
        const parts = uuid.split(".");
        if (parts[0] === "Compendium") {
          return parts.length >= 5 ? { type: parts[3], id: parts[4] } : null;
        }
        return parts.length >= 2 ? { type: parts[parts.length - 2], id: parts[parts.length - 1] } : null;
      }
    },

    audio: {
      AudioHelper: {
        getDefaultSoundName: (path) => `derived:${path}`,
        play: vi.fn(() => undefined)
      }
    }
  };

  globalThis.User = makeDocumentClass({
    create: vi.fn(async (data) => {
      const userDoc = createUserDocument("user-created", data);
      users.set(userDoc);
      return userDoc;
    })
  });
  globalThis.game.users.documentClass = globalThis.User;

  globalThis.fromUuidSync = vi.fn((uuid) => {
    const text = String(uuid ?? "");
    if (text.startsWith("Compendium.")) {
      return {
        documentName: "Macro",
        id: text.slice(text.lastIndexOf(".") + 1),
        name: "Packed Macro",
        pack: "world.packed-macros"
      };
    }

    const [documentName, id] = text.split(".");
    const collections = {
      Macro: globalThis.game?.macros,
      Actor: globalThis.game?.actors,
      Item: globalThis.game?.items,
      JournalEntry: globalThis.game?.journal,
      Scene: globalThis.game?.scenes
    };
    const document = collections[documentName]?.get?.(id) ?? null;
    return document ? { documentName, id: document.id, name: document.name, pack: null } : null;
  });

  globalThis.CONST = {
    USER_ROLES: FAKE_USER_ROLES,
    USER_PERMISSIONS: FAKE_USER_PERMISSIONS
  };

  globalThis.CONFIG = {
    sounds: {
      dice: "sounds/dice.wav",
      lock: "sounds/lock.wav",
      notification: "sounds/notify.wav",
      combat: "sounds/drums.wav"
    }
  };

  const hookListeners = new Map();
  globalThis.Hooks = {
    on: vi.fn((event, fn) => {
      const listeners = hookListeners.get(event) ?? [];
      listeners.push(fn);
      hookListeners.set(event, listeners);
      return listeners.length;
    }),
    off: vi.fn((event, fn) => {
      const listeners = hookListeners.get(event) ?? [];
      const index = listeners.indexOf(fn);
      if (index >= 0) listeners.splice(index, 1);
    }),
    callAll: vi.fn((event, ...args) => {
      for (const fn of [...(hookListeners.get(event) ?? [])]) fn(...args);
    }),

    _listeners: hookListeners
  };
}
