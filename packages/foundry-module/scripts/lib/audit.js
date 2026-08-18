import { AUDIT_FILES_MAX_DIRS, ERROR_CODES } from "../generated/protocol.js";
import {
  browseDataPathEntries,
  canonicalizeDataPath,
  isExternalFileRef,
  splitFilePathQuery
} from "./file-access.js";
import { paginate } from "./pagination.js";
import { getGame } from "./validators.js";

const AUDIT_BROWSE_CONCURRENCY = 8;

async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  const pool = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(pool);
}

const AUDIT_FIELD_TABLE = Object.freeze({
  scene: {
    self: { docType: "Scene", fields: ["background.src", "foreground"] },
    embedded: [
      { collection: "tiles", docType: "Tile", fields: ["texture.src"] },
      { collection: "tokens", docType: "Token", fields: ["texture.src"] },
      { collection: "sounds", docType: "AmbientSound", fields: ["path"] },
      { collection: "notes", docType: "Note", fields: ["texture.src"] },
      { collection: "drawings", docType: "Drawing", fields: ["texture"] },
      { collection: "templates", docType: "MeasuredTemplate", fields: ["texture"] }
    ]
  },
  actor: {
    self: { docType: "Actor", fields: ["img", "prototypeToken.texture.src"] },
    embedded: [{ collection: "items", docType: "Item", fields: ["img"] }]
  },
  item: {
    self: { docType: "Item", fields: ["img"] }
  },
  journal: {
    embedded: [{ collection: "pages", docType: "JournalEntryPage", fields: ["src"] }]
  },
  playlist: {
    embedded: [{ collection: "sounds", docType: "PlaylistSound", fields: ["path"] }]
  },
  macro: {
    self: { docType: "Macro", fields: ["img"] }
  },

  table: {
    self: { docType: "RollTable", fields: ["img"] },
    embedded: [{ collection: "results", docType: "TableResult", fields: ["img"] }]
  },

  combat: {
    embedded: [
      { collection: "combatants", docType: "Combatant", fields: ["img"] },
      { collection: "groups", docType: "CombatantGroup", fields: ["img"] }
    ]
  },

  cards: {
    self: { docType: "Cards", fields: ["img"] },
    embedded: [
      {
        collection: "cards",
        docType: "Card",
        fields: ["back.img"],
        arrayFields: [{ array: "faces", fields: ["img"] }]
      }
    ]
  }
});

const SCOPE_COLLECTIONS = Object.freeze({
  scene: "scenes",
  actor: "actors",
  item: "items",
  journal: "journal",
  playlist: "playlists",
  macro: "macros",

  table: "tables",

  combat: "combats",

  cards: "cards"
});

function stripFilePathQuery(path) {
  return splitFilePathQuery(path).base;
}

function getDeep(source, dotPath) {
  return dotPath.split(".").reduce((current, key) => (current == null ? undefined : current[key]), source);
}

function toSource(document) {
  return typeof document?.toObject === "function" ? document.toObject() : (document ?? {});
}

/**
 * @param {Array<Record<string, any>>} records
 * @param {any} source
 * @param {string[]} fields
 * @param {{ docType: string; id?: any; name?: any; parent?: any; fieldPrefix?: string }} meta
 */
function collectFieldRefs(records, source, fields, { docType, id, name, parent, fieldPrefix = "" }) {
  for (const field of fields) {
    const value = getDeep(source, field);
    if (typeof value !== "string" || !value) {
      continue;
    }
    const record = {
      docType,
      id: id ?? null,
      name: name ?? null,
      field: `${fieldPrefix}${field}`,
      path: value
    };
    if (parent != null) {
      record.parent = parent;
    }
    records.push(record);
  }
}

export function collectAuditRefs(game, scopeSet) {
  const records = [];

  for (const scope of Object.keys(AUDIT_FIELD_TABLE)) {
    if (!scopeSet.has(scope)) {
      continue;
    }
    const spec = AUDIT_FIELD_TABLE[scope];
    const collectionName = SCOPE_COLLECTIONS[scope];
    const documents = Array.from(game?.[collectionName] ?? []);

    for (const document of documents) {
      const source = toSource(document);
      const docId = document?.id ?? source?._id ?? null;
      const docName = document?.name ?? source?.name ?? null;

      if (spec.self) {
        collectFieldRefs(records, source, spec.self.fields, {
          docType: spec.self.docType,
          id: docId,
          name: docName
        });
      }

      for (const embedded of spec.embedded ?? []) {
        const entries = Array.isArray(source?.[embedded.collection]) ? source[embedded.collection] : [];
        for (const entry of entries) {
          const meta = {
            docType: embedded.docType,
            id: entry?._id ?? null,
            name: entry?.name ?? null,
            parent: docId
          };
          collectFieldRefs(records, entry, embedded.fields ?? [], meta);

          for (const nested of embedded.arrayFields ?? []) {
            const items = Array.isArray(entry?.[nested.array]) ? entry[nested.array] : [];
            for (const [index, item] of items.entries()) {
              for (const field of nested.fields) {
                collectFieldRefs(records, item, [field], {
                  ...meta,
                  fieldPrefix: `${nested.array}.${index}.`
                });
              }
            }
          }
        }
      }
    }
  }

  return records;
}

function addSkipped(skippedMap, path, reason) {
  const key = `${reason}\u0000${path}`;
  const existing = skippedMap.get(key);
  if (existing) {
    existing.count += 1;
  } else {
    skippedMap.set(key, { path, reason, count: 1 });
  }
}

export async function checkAuditRefs(refs, { maxDirs = AUDIT_FILES_MAX_DIRS } = {}) {
  const skippedMap = new Map();
  const broken = [];
  let checkedRefs = 0;
  const checkedFiles = new Set();

  const byDir = new Map();
  for (const ref of refs) {
    if (isExternalFileRef(ref.path)) {
      addSkipped(skippedMap, ref.path, "public-or-external");
      continue;
    }

    const basePath = stripFilePathQuery(ref.path);
    if (basePath.includes("*") || basePath.includes("?")) {
      addSkipped(skippedMap, ref.path, "wildcard");
      continue;
    }
    const canonical = canonicalizeDataPath(basePath);
    const lastSlash = canonical.lastIndexOf("/");
    const dir = lastSlash === -1 ? "" : canonical.slice(0, lastSlash);
    const group = byDir.get(dir);
    if (group) {
      group.push({ ref, canonical });
    } else {
      byDir.set(dir, [{ ref, canonical }]);
    }
  }

  const dirs = Array.from(byDir.keys()).sort();
  const inCap = dirs.slice(0, maxDirs);
  const overCap = dirs.slice(maxDirs);

  for (const dir of overCap) {
    for (const { ref } of byDir.get(dir)) {
      addSkipped(skippedMap, ref.path, "audit-cap");
    }
  }

  const checkDir = async (dir) => {
    const group = byDir.get(dir);

    let entries;
    try {
      entries = await browseDataPathEntries(dir);
    } catch (error) {
      const isMissingDir = /** @type {any} */ (error)?.code === ERROR_CODES.FILE_NOT_FOUND;
      for (const { ref, canonical } of group) {
        if (isMissingDir) {
          checkedRefs += 1;
          checkedFiles.add(canonical);
          broken.push(ref);
        } else {
          addSkipped(skippedMap, ref.path, "unbrowsable");
        }
      }
      return;
    }

    const fileEntries = new Set(
      entries.filter((entry) => entry.kind === "file").map((entry) => canonicalizeDataPath(entry.path))
    );
    for (const { ref, canonical } of group) {
      checkedRefs += 1;
      checkedFiles.add(canonical);
      if (!fileEntries.has(canonical)) {
        broken.push(ref);
      }
    }
  };

  await runWithConcurrency(inCap, AUDIT_BROWSE_CONCURRENCY, checkDir);

  broken.sort((left, right) => {
    const byType = left.docType.localeCompare(right.docType);
    if (byType !== 0) return byType;
    const byParent = String(left.parent ?? "").localeCompare(String(right.parent ?? ""));
    if (byParent !== 0) return byParent;
    const byId = String(left.id ?? "").localeCompare(String(right.id ?? ""));
    if (byId !== 0) return byId;
    return left.field.localeCompare(right.field);
  });

  return {
    broken,
    checkedRefs,
    checkedFiles: checkedFiles.size,

    skipped: Array.from(skippedMap.values()).sort(
      (left, right) => left.reason.localeCompare(right.reason) || left.path.localeCompare(right.path)
    )
  };
}

/** @param {{ scope?: string[]; limit?: number; offset?: number; maxDirs?: number }} [params] */
export async function runFileAudit({ scope, limit, offset, maxDirs } = {}) {
  const game = getGame();
  const scopeSet = new Set(Array.isArray(scope) && scope.length > 0 ? scope : Object.keys(AUDIT_FIELD_TABLE));

  const refs = collectAuditRefs(game, scopeSet);
  const { broken, checkedRefs, checkedFiles, skipped } = await checkAuditRefs(refs, { maxDirs });

  const { page, total, hasMore } = paginate(broken, { limit, offset });
  return {
    broken: page,
    total,
    hasMore,
    checkedRefs,
    checkedFiles,
    skipped
  };
}
