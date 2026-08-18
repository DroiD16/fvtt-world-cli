import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError, isFoundryValidationError, toFoundryValidationError } from "./errors.js";
import { canonicalizeFilePathFields } from "./file-access.js";

import { getFoundryGeneration } from "./foundry-capabilities.js";
import { getTablesCollection } from "./game-collections.js";
import {
  computeDocumentUpdateDiff,
  createWorldDocument,
  getCreateResult,
  previewDocumentCreate,
  resolveEmbeddedDocumentClass,
  resolveWorldDocumentClass
} from "./world-docs.js";

export function getTableById(tableId) {
  const table = getTablesCollection().get?.(tableId) ?? null;
  if (!table) {
    throw createBridgeError(
      ERROR_CODES.TABLE_NOT_FOUND,
      `RollTable ${tableId} was not found; use table.list to find valid ids`,
      { tableId }
    );
  }
  return table;
}

export async function createTable(data) {
  return createWorldDocument("RollTable", data);
}

export function previewTableCreate(data) {
  return previewDocumentCreate(resolveWorldDocumentClass("RollTable"), data);
}

/**
 * @param {any} data
 * @param {{ label?: string, checkDocumentUuid?: boolean }} [options]
 */
export function assertTableResultPayload(data, { label = "results", checkDocumentUuid = true } = {}) {
  if (!data || typeof data !== "object") {
    return data;
  }
  if (Array.isArray(data.range)) {
    if (data.range.length !== 2) {
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        `${label}: \`range\` must hold exactly two integers [low, high] (received ${data.range.length}); a single-value result uses the same number twice, e.g. [3, 3]`,
        { field: "range", received: data.range.length, target: label }
      );
    }
    const [low, high] = data.range;
    if (typeof low === "number" && typeof high === "number" && high < low) {
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        `${label}: \`range\` must ascend — its high bound must be >= its low bound (received [${low}, ${high}]); a single-value result uses the same number twice, e.g. [3, 3]`,
        { field: "range", target: label, low, high }
      );
    }
  }
  const uuidIsBlank = typeof data.documentUuid === "string" && data.documentUuid.trim() === "";
  if (
    checkDocumentUuid &&
    data.type === "document" &&
    (data.documentUuid === undefined || data.documentUuid === null || uuidIsBlank)
  ) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `${label}: a result with \`type: "document"\` requires a non-blank \`documentUuid\` (e.g. "Actor.<id>" or "Compendium.<pack>.Item.<id>"); Foundry itself accepts the dangling reference — it drops a blank uuid entirely — so the bridge rejects it instead`,
      { field: "documentUuid", target: label, blank: uuidIsBlank }
    );
  }
  return data;
}

export function prepareTableResultPayload(data, { label = "results" } = {}) {
  if (!data || typeof data !== "object") {
    return data;
  }
  const canonical = canonicalizeFilePathFields(data, "TableResult");
  assertTableResultPayload(canonical, { label });
  return canonical;
}

export function prepareTableCreateData(data) {
  if (!data || typeof data !== "object") {
    return data;
  }
  const canonical = canonicalizeFilePathFields(data, "RollTable");
  if (!Array.isArray(canonical.results)) {
    return canonical;
  }
  return {
    ...canonical,
    results: canonical.results.map((result, index) =>
      prepareTableResultPayload(result, { label: `results[${index}]` })
    )
  };
}

export function getTableResultById(tableId, resultId) {
  const table = getTableById(tableId);
  const result = table.results?.get?.(resultId) ?? null;
  if (!result) {
    throw createBridgeError(
      ERROR_CODES.TABLE_RESULT_NOT_FOUND,
      `TableResult ${resultId} was not found on RollTable ${tableId}; use table.result.list to find valid ids`,
      { tableId, resultId }
    );
  }
  return { table, result };
}

export function prepareTableResultPatch(result, patch, { label = "patch" } = {}) {
  const canonical = canonicalizeFilePathFields(patch ?? {}, "TableResult");
  const current = typeof result?.toObject === "function" ? result.toObject() : (result ?? {});
  const suppliesTypeOrUuid = Object.hasOwn(canonical, "type") || Object.hasOwn(canonical, "documentUuid");
  assertTableResultPayload({ ...current, ...canonical }, { label, checkDocumentUuid: suppliesTypeOrUuid });
  return canonical;
}

export async function createTableResult(table, data, { dryRun = false } = {}) {
  if (typeof table.createEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "TableResult create API is not available");
  }

  if (dryRun) {
    return data;
  }
  const results = await table.createEmbeddedDocuments("TableResult", [data], { render: true });
  return getCreateResult(results, "TableResult creation returned no document");
}

export async function updateTableResult(tableId, resultId, patch, { dryRun = false } = {}) {
  const { table } = getTableResultById(tableId, resultId);
  if (dryRun) {
    return { result: table.results.get(resultId), committed: false };
  }

  const updated = await table.updateEmbeddedDocuments("TableResult", [{ _id: resultId, ...patch }], {
    diff: true,
    render: true
  });
  return {
    result: table.results.get(resultId),
    committed: Array.isArray(updated) ? updated.length > 0 : Boolean(updated)
  };
}

export async function deleteTableResult(tableId, resultId, { dryRun = false } = {}) {
  const { table } = getTableResultById(tableId, resultId);
  if (dryRun) {
    return { committed: false };
  }
  const deleted = await table.deleteEmbeddedDocuments("TableResult", [resultId], { render: true });
  return {
    committed: Array.isArray(deleted) ? deleted.length > 0 : Boolean(deleted)
  };
}

export function previewTableResultCreate(table, data) {
  return previewDocumentCreate(resolveEmbeddedDocumentClass(table?.results, "TableResult"), data, {
    parent: table
  });
}

/**
 * @param {any} table
 * @returns {any[]}
 */
function liveTableResults(table) {
  if (table?.results) {
    return Array.from(table.results);
  }
  const source = typeof table?.toObject === "function" ? table.toObject() : table;
  return Array.isArray(source?.results) ? source.results : [];
}

/**
 * @param {any} result
 * @returns {boolean}
 */
export function persistedTableResultDrawn(result) {
  const source = result?._source;
  if (source && typeof source === "object" && Object.hasOwn(source, "drawn")) {
    return Boolean(source.drawn);
  }
  if (typeof result?.toObject === "function") {
    return Boolean(result.toObject()?.drawn);
  }
  return Boolean(result?.drawn);
}

/**
 * @param {any} table
 * @returns {number}
 */
export function countPersistedAvailableTableResults(table) {
  return liveTableResults(table).filter((result) => !persistedTableResultDrawn(result)).length;
}

/**
 * @param {any} table
 * @returns {number}
 */
export function countDrawnTableResults(table) {
  return liveTableResults(table).filter((result) => persistedTableResultDrawn(result)).length;
}

const TABLE_VETO_REMEDY =
  "There is no force flag for a world-side veto — disable the module that locks this table (or make the change from the Foundry UI) and retry.";

/**
 * @typedef {object} TableDrawEvidenceEntry
 * @property {string} tableId
 * @property {any} table
 * @property {Set<string>} undrawnIds
 * @property {Set<string>} drawnIds
 */

/**
 * @param {any} table
 * @returns {boolean}
 */
function hasDocumentTypedRow(table) {
  for (const row of liveTableResults(table)) {
    const source = typeof row?.toObject === "function" ? row.toObject() : row;
    if ((source?.type ?? row?.type ?? null) === "document") return true;
  }
  return false;
}

/**
 * @param {any} table
 * @param {{recursive?: boolean, count?: number}} options
 * @returns {{tables: TableDrawEvidenceEntry[], complete: boolean}}
 */
export function snapshotTableDrawEvidence(table, { recursive = true, count = 1 } = {}) {
  /** @type {TableDrawEvidenceEntry[]} */
  const tables = [];
  const seen = new Set();
  let complete = true;

  const add = (document) => {
    const tableId = document?.id ?? null;
    if (!tableId || seen.has(tableId)) return false;
    seen.add(tableId);
    const undrawnIds = new Set();
    const drawnIds = new Set();
    for (const row of liveTableResults(document)) {
      const rowId = row?._id ?? row?.id ?? null;

      if (!rowId) continue;
      (persistedTableResultDrawn(row) ? drawnIds : undrawnIds).add(rowId);
    }
    tables.push({ tableId, table: document, undrawnIds, drawnIds });
    return true;
  };

  add(table);

  if (!recursive || (count ?? 1) > 1) {
    return { tables, complete };
  }

  const collection = getTablesCollection();
  const parseUuid = globalThis.foundry?.utils?.parseUuid;
  if (typeof parseUuid !== "function" || typeof collection?.get !== "function") {
    return { tables, complete: complete && !hasDocumentTypedRow(table) };
  }

  let frontier = [table];
  for (let hop = 0; hop < TABLE_RECURSION_MAX_HOPS && frontier.length > 0; hop += 1) {
    const next = [];
    for (const node of frontier) {
      for (const { parsed, documentUuid } of iterateNestedTableRows(node)) {
        if (isCompendiumUuid(parsed, documentUuid)) {
          complete = false;
          continue;
        }
        const nextId = parsed?.id ?? null;
        if (!nextId || seen.has(nextId)) continue;

        const nested = collection.get(nextId) ?? null;
        if (!nested) continue;
        if (add(nested)) next.push(nested);
      }
    }
    frontier = next;
  }

  return { tables, complete };
}

/**
 * @param {{tables?: TableDrawEvidenceEntry[], complete?: boolean} | null | undefined} snapshot
 * @returns {{marked: {tableId: string, resultId: string}[], disturbed: boolean, complete: boolean}}
 */
export function evaluateTableDrawEvidence(snapshot) {
  const marked = [];
  let disturbed = false;
  const collection = getTablesCollection();
  for (const entry of snapshot?.tables ?? []) {
    const current =
      (typeof collection?.get === "function" ? collection.get(entry.tableId) : null) ?? entry.table;
    const stored = new Map();
    for (const row of liveTableResults(current)) {
      const rowId = row?._id ?? row?.id ?? null;
      if (rowId) stored.set(rowId, persistedTableResultDrawn(row));
    }
    for (const rowId of entry.undrawnIds) {
      if (!stored.has(rowId)) {
        disturbed = true;
        continue;
      }
      if (stored.get(rowId)) marked.push({ tableId: entry.tableId, resultId: rowId });
    }
    for (const rowId of entry.drawnIds) {
      if (!stored.has(rowId) || !stored.get(rowId)) disturbed = true;
    }
  }

  return { marked, disturbed, complete: snapshot?.complete === true };
}

/**
 * @param {any[]} results
 * @param {{ exemptParentTableId?: string|null, judgeOnlyParentTableId?: string|null }} [options]
 * @returns {{ tableId: string|null, resultId: string|null }[]}
 */
export function findUnpersistedDrawnResults(
  results,
  { exemptParentTableId = null, judgeOnlyParentTableId = null } = {}
) {
  const offenders = [];
  for (const result of Array.isArray(results) ? results : []) {
    const parent = result?.parent ?? null;

    if (!parent) continue;
    if (parent.replacement || parent.pack) continue;
    if (judgeOnlyParentTableId && parent.id !== judgeOnlyParentTableId) continue;
    if (exemptParentTableId && parent.id === exemptParentTableId) continue;
    if (persistedTableResultDrawn(result)) continue;
    offenders.push({ tableId: parent.id ?? null, resultId: result?.id ?? null });
  }
  return offenders;
}

/**
 * @param {{disturbed?: boolean, complete?: boolean} | null | undefined} evidence
 * @returns {boolean}
 */
export function isTableDrawCleanRefusal(evidence) {
  return evidence?.complete === true && evidence?.disturbed !== true;
}

/**
 * @param {{disturbed?: boolean, complete?: boolean} | null | undefined} evidence
 * @returns {string}
 */
function describeUnprovableTableDrawRefusal(evidence) {
  const reasons = [];
  if (evidence?.complete !== true) {
    reasons.push(
      "the pre-call snapshot could NOT enumerate every table this draw could write — typically a COMPENDIUM-pack link row, which Foundry resolves with an async pack load and recurses into, so that pack table may have marked rows on WORLD tables the bridge never snapshotted; and equally a GM session whose uuid parser or tables collection the bridge could not read while this table holds a nested-table row"
    );
  }
  if (evidence?.disturbed === true) {
    reasons.push(
      "the evidence was DISTURBED — a row this call could have consumed VANISHED, or a row the world held as drawn came back undrawn, which is the signature of a concurrent resetResults()/delete (the table queue serializes bridge commands only) and can HIDE a mark this draw made"
    );
  }
  return reasons.join("; and ");
}

/**
 * @param {object} args
 * @param {any} args.table
 * @param {string} args.tableId
 * @param {any[]} args.results
 * @param {number} args.count
 * @param {boolean} args.recursive
 * @param {{marked: {tableId: string, resultId: string}[], disturbed: boolean, complete: boolean}} args.evidence
 * @param {number} args.persistedAvailableBefore
 * @param {number} args.persistedAvailableAfter
 * @returns {import("./errors.js").BridgeError | null}
 */
export function assertTableDrawCommitted({
  table,
  tableId,
  results,
  count,
  recursive,
  evidence,
  persistedAvailableBefore,
  persistedAvailableAfter
}) {
  const exemptParentTableId =
    recursive && (count ?? 1) <= 1 && isTableReachableFromItself(table) ? (table?.id ?? tableId) : null;

  const judgeOnlyParentTableId = (count ?? 1) > 1 ? (table?.id ?? tableId) : null;
  const unpersisted = findUnpersistedDrawnResults(results, { exemptParentTableId, judgeOnlyParentTableId });
  if (unpersisted.length > 0) {
    const rowList = unpersisted.map((entry) => `${entry.tableId}/${entry.resultId}`).join(", ");
    const landed = evidence?.marked ?? [];
    const cause = `Roll table ${tableId} drew ${results.length} row(s) but ${unpersisted.length} of them is/are still stored as drawn:false (${rowList}), so Foundry did NOT record the draw for those rows even though it resolved without an error. The likeliest cause is a refused write — a module's preUpdateTableResult hook or a core _preUpdate returning false, or a row failing Foundry's own client-side validation (which Foundry reports only as a UI notification) — and Foundry drops such rows from the batch SILENTLY, one row at a time, so the draw MAY have been recorded for some rows and not others. Foundry's own draw card may ALSO already have been posted to chat — both typed methods call toMessage AFTER their drawn-marking writes — announcing rows the world did not record: find it with chat list and remove it with chat delete.`;
    const details = {
      tableId,
      drawnCount: Array.isArray(results) ? results.length : 0,
      unpersisted,
      landed,

      snapshotComplete: evidence?.complete === true,
      snapshotDisturbed: evidence?.disturbed === true
    };

    if (landed.length > 0) {
      return createBridgeError(
        ERROR_CODES.INTERNAL_ERROR,
        `${cause} Rows that DID commit: ${landed
          .map((entry) => `${entry.tableId}/${entry.resultId}`)
          .join(
            ", "
          )} — so this draw committed in PART. Re-read the tables named here with table get before deciding what to do; this outcome IS stored under the request's idempotencyKey, so re-sending the same key returns it instead of drawing again. ${TABLE_VETO_REMEDY}`,
        details
      );
    }

    if (!isTableDrawCleanRefusal(evidence)) {
      return createBridgeError(
        ERROR_CODES.INTERNAL_ERROR,
        `${cause} No row the bridge could observe is stored as drawn, but a commit CANNOT be ruled out: ${describeUnprovableTableDrawRefusal(
          evidence
        )}. Re-read this table — and any table it links to, compendium packs included — with table get before deciding what to do; this outcome IS stored under the request's idempotencyKey, so re-sending the same key returns it instead of drawing again. ${TABLE_VETO_REMEDY}`,
        details
      );
    }
    throw createBridgeError(
      ERROR_CODES.INTERNAL_ERROR,
      `${cause} No row the bridge could observe is stored as drawn, and the pre-call snapshot covered every table this draw could write and was undisturbed, so nothing was consumed. Re-read with table get --table-id ${tableId} before deciding what to do: this error is NOT stored under the request's idempotencyKey, so re-sending the same key will draw AGAIN rather than returning this outcome — which is safe precisely because nothing was consumed. ${TABLE_VETO_REMEDY}`,
      details
    );
  }

  const replacement = Boolean(table?.replacement ?? table?.toObject?.().replacement);
  const rowCount = Array.isArray(results) ? results.length : 0;
  if (replacement || table?.pack || rowCount === 0) return null;

  const marked = evidence?.marked ?? [];

  if (marked.some((entry) => entry.tableId === tableId)) return null;

  const landedElsewhere = marked.filter((entry) => entry.tableId !== tableId);
  const details = {
    tableId,
    drawnCount: rowCount,
    unconfirmedTargetRow: true,
    landed: landedElsewhere,
    snapshotComplete: evidence?.complete === true,
    snapshotDisturbed: evidence?.disturbed === true,

    persistedAvailableBefore,
    persistedAvailableAfter
  };
  const sharedCause = `Foundry did NOT record this replacement:false table's own consumed row as drawn even though the draw resolved without an error: not one of THIS table's rows that the world held as undrawn before the call is stored as drawn now. On a recursive draw the consumed row is the LINK row, which Foundry never returns, so this is the only signal that its drawn-marking write was refused — a module's preUpdateTableResult hook or a core _preUpdate returning false, or the row failing Foundry's own client-side validation (reported only as a UI notification). Foundry's own draw card may ALSO already have been posted to chat — toMessage runs AFTER both of a draw's marking writes — announcing a row the world did not consume: find it with chat list and remove it with chat delete. One other cause fits the same observation, since the table queue serializes bridge commands only: a concurrent change that UN-DREW the row this draw marked (a resetResults() from the Foundry UI or another module, or that row being deleted).`;

  if (landedElsewhere.length > 0) {
    return createBridgeError(
      ERROR_CODES.INTERNAL_ERROR,
      `Roll table ${tableId} drew ${rowCount} row(s), and ${landedElsewhere.length} row(s) of OTHER table(s) is/are now stored as drawn (${landedElsewhere
        .map((entry) => `${entry.tableId}/${entry.resultId}`)
        .join(
          ", "
        )}) — so part of this draw DID commit — but ${sharedCause} Re-read the tables named above with table get before deciding what to do; this outcome IS stored under the request's idempotencyKey, so re-sending the same key returns it instead of drawing again. ${TABLE_VETO_REMEDY}`,
      details
    );
  }

  if (!isTableDrawCleanRefusal(evidence)) {
    return createBridgeError(
      ERROR_CODES.INTERNAL_ERROR,
      `Roll table ${tableId} drew ${rowCount} row(s) and no row the bridge could observe is stored as drawn, but a commit CANNOT be ruled out: ${describeUnprovableTableDrawRefusal(
        evidence
      )}. ${sharedCause} Re-read this table — and any table it links to, compendium packs included — with table get before deciding what to do; this outcome IS stored under the request's idempotencyKey, so re-sending the same key returns it instead of drawing again. ${TABLE_VETO_REMEDY}`,
      details
    );
  }

  throw createBridgeError(
    ERROR_CODES.INTERNAL_ERROR,
    `Roll table ${tableId} drew ${rowCount} row(s) but no row the bridge could observe is stored as drawn, and the pre-call snapshot covered every table this draw could write and was undisturbed, so nothing was consumed: ${sharedCause} Re-read with table get --table-id ${tableId} before deciding what to do: this error is NOT stored under the request's idempotencyKey, so re-sending the same key will draw AGAIN rather than returning this outcome — which is safe precisely because nothing was consumed. ${TABLE_VETO_REMEDY}`,
    details
  );
}

/**
 * @param {object} args
 * @param {any} args.document
 * @param {Record<string, any>} args.patch
 * @param {string} args.subject
 * @param {string} args.hookName
 * @param {Record<string, any>} args.details
 * @param {string} [args.remedy]
 * @returns {Promise<void>}
 */
export async function assertTableFamilyUpdateCommitted({
  document,
  patch,
  subject,
  hookName,
  details,
  remedy = TABLE_VETO_REMEDY
}) {
  let diff;
  let probeError = null;
  try {
    diff = await computeDocumentUpdateDiff(document, patch);
  } catch (error) {
    if (isFoundryValidationError(error)) {
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        `${subject} was NOT updated: Foundry REJECTED the patch. Foundry's client backend reports such a validation failure only as a UI notification and resolves the update without writing, so the bridge re-ran the same validation to recover the cause — see details.message for the raw validation error (and details.errors, when Foundry exposes the offending field paths), fix the offending field and resend. This is NOT a module veto: no ${hookName} hook was involved.`,
        {
          ...details,
          ...toFoundryValidationError(error).details
        }
      );
    }
    probeError = /** @type {any} */ (error)?.message ?? String(error);
    diff = null;
  }
  if (diff !== null && Object.keys(diff).length === 0) return;

  const fields = (diff ? Object.keys(diff) : Object.keys(patch ?? {})).filter((key) => key !== "_id");
  throw createBridgeError(
    ERROR_CODES.INTERNAL_ERROR,
    `${subject} was NOT updated: Foundry resolved the update without applying it, which means a module's ${hookName} hook or a core _preUpdate refused the write, or the patch failed Foundry's own client-side validation (which Foundry reports only as a UI notification). It still holds its previous values for ${
      fields.join(", ") || "the requested fields"
    }. ${remedy}`,
    { ...details, fields, validationError: probeError }
  );
}

/**
 * @param {object} args
 * @param {boolean} args.committed
 * @param {string} args.subject
 * @param {string} args.hookName
 * @param {Record<string, any>} args.details
 * @param {string} [args.remedy]
 * @returns {void}
 */
export function assertTableFamilyDeleteCommitted({
  committed,
  subject,
  hookName,
  details,
  remedy = TABLE_VETO_REMEDY
}) {
  if (committed) return;
  throw createBridgeError(
    ERROR_CODES.INTERNAL_ERROR,
    `${subject} was NOT deleted: Foundry resolved the delete without removing the document, which means a module's ${hookName} hook or a core _preDelete refused it. Nothing was deleted. ${remedy}`,
    details
  );
}

/**
 * @param {"public"|"gm"|"blind"|"self"} rollMode
 * @returns {{rollMode: string} | {messageMode: string}}
 */
export function resolveTableDrawMessageMode(rollMode) {
  const generation = getFoundryGeneration();
  if (generation !== null && generation >= 14) {
    return { messageMode: rollMode };
  }
  const legacy = { public: "publicroll", gm: "gmroll", blind: "blindroll", self: "selfroll" };
  return { rollMode: legacy[rollMode] };
}

/**
 * @param {any} table
 * @returns {any|null}
 */
function findNestedTableResult(table) {
  for (const { result, parsed, documentUuid } of iterateNestedTableRows(table)) {
    if (isSelfTableReference(table, parsed, documentUuid)) continue;
    return result;
  }
  return null;
}

/**
 * @param {any} table
 * @returns {Generator<{ result: any, parsed: any, documentUuid: string }>}
 */
function* iterateNestedTableRows(table) {
  const parseUuid = globalThis.foundry?.utils?.parseUuid;
  if (typeof parseUuid !== "function") return;
  for (const result of liveTableResults(table)) {
    const source = typeof result?.toObject === "function" ? result.toObject() : result;
    const type = source?.type ?? result?.type ?? null;
    const documentUuid = source?.documentUuid ?? result?.documentUuid ?? null;
    if (type !== "document") continue;
    if (typeof documentUuid !== "string" || documentUuid.trim() === "") continue;
    let parsed = null;
    try {
      parsed = parseUuid(documentUuid);
    } catch {
      parsed = null;
    }
    if (parsed?.type === "RollTable") {
      yield { result, parsed, documentUuid };
    }
  }
}

/**
 * @param {any} table
 * @param {any} parsed
 * @param {string} documentUuid
 * @returns {boolean}
 */
function isSelfTableReference(table, parsed, documentUuid) {
  const tableId = table?.id ?? null;
  const parsedId = parsed?.id ?? null;
  if (!tableId || !parsedId) return false;
  if (isCompendiumUuid(parsed, documentUuid)) return false;
  return parsedId === tableId;
}

/**
 * @param {any} parsed
 * @param {string} documentUuid
 * @returns {boolean}
 */
function isCompendiumUuid(parsed, documentUuid) {
  const uuid = typeof parsed?.uuid === "string" && parsed.uuid ? parsed.uuid : (documentUuid ?? "");
  return typeof uuid === "string" && uuid.startsWith("Compendium.");
}

const TABLE_RECURSION_MAX_HOPS = 5;

/**
 * @param {any} table
 * @returns {boolean}
 */
export function isTableReachableFromItself(table) {
  const startId = table?.id ?? null;
  if (!startId) return false;
  const collection = getTablesCollection();
  if (typeof collection?.get !== "function") return false;

  const visited = new Set([startId]);
  let frontier = [table];
  for (let hop = 0; hop < TABLE_RECURSION_MAX_HOPS && frontier.length > 0; hop += 1) {
    const next = [];
    for (const node of frontier) {
      for (const { parsed, documentUuid } of iterateNestedTableRows(node)) {
        const nextId = parsed?.id ?? null;

        if (!nextId || isCompendiumUuid(parsed, documentUuid)) continue;
        if (nextId === startId) return true;
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        const nested = collection.get(nextId) ?? null;
        if (nested) next.push(nested);
      }
    }
    frontier = next;
  }
  return false;
}

/**
 * @param {any} table
 * @param {{count: number, recursive: boolean}} options
 */
export function assertTableDrawCountSupported(table, { count, recursive }) {
  if (count <= 1 || !recursive) return;
  if (table?.replacement || table?.pack) return;
  const nested = findNestedTableResult(table);
  if (!nested) return;
  const source = typeof nested?.toObject === "function" ? nested.toObject() : nested;
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `Roll table ${table?.id ?? "?"} holds a nested-RollTable result (${nested?.id ?? "?"}${source?.name ? ` "${source.name}"` : ""} → ${source?.documentUuid}), and Foundry's multi-draw path cannot mark nested results drawn: RollTable#drawMany applies the inner table's result ids to THIS table's embedded collection, which throws on both v13 and v14. Draw one result at a time with --count 1 (the singular draw path is unaffected), or pass --no-recursive to draw the nested-table row itself without rolling into it`,
    {
      tableId: table?.id ?? null,
      resultId: nested?.id ?? null,
      documentUuid: source?.documentUuid ?? null,
      count
    }
  );
}

/** @param {any} table */
export function assertTableDrawSupported(table) {
  if (typeof table?.draw !== "function" || typeof table?.drawMany !== "function") {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      "RollTable draw API is not available in this Foundry session (RollTable#draw / #drawMany)"
    );
  }
}

/** @param {any} table */
export function assertTableResetSupported(table) {
  if (typeof table?.resetResults !== "function") {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      "RollTable reset API is not available in this Foundry session (RollTable#resetResults)"
    );
  }
}

/**
 * @param {any} table
 * @param {{count: number, recursive: boolean, chat: boolean, mode: object}} options
 * @returns {Promise<{roll: any, results: any[]}>}
 */
export async function drawFromTable(table, { count, recursive, chat, mode }) {
  assertTableDrawSupported(table);
  const options = { recursive, displayChat: chat, ...mode };
  const draw = count > 1 ? await table.drawMany(count, options) : await table.draw(options);
  return {
    roll: draw?.roll ?? null,
    results: Array.isArray(draw?.results) ? draw.results : []
  };
}

/** @param {any} table */
export async function resetTableResults(table) {
  assertTableResetSupported(table);
  await table.resetResults();
}
