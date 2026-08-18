import { getTablesCollection } from "../lib/game-collections.js";
import {
  assertTableDrawCommitted,
  assertTableDrawCountSupported,
  assertTableDrawSupported,
  assertTableFamilyDeleteCommitted,
  assertTableFamilyUpdateCommitted,
  assertTableResetSupported,
  countDrawnTableResults,
  countPersistedAvailableTableResults,
  createTable,
  createTableResult,
  deleteTableResult,
  drawFromTable,
  evaluateTableDrawEvidence,
  getTableById,
  getTableResultById,
  isTableDrawCleanRefusal,
  prepareTableCreateData,
  prepareTableResultPatch,
  prepareTableResultPayload,
  previewTableCreate,
  previewTableResultCreate,
  resetTableResults,
  resolveTableDrawMessageMode,
  snapshotTableDrawEvidence,
  updateTableResult
} from "../lib/table-docs.js";
import {
  assertClonePatchValid,
  cloneDocument,
  deleteDocument,
  previewDocumentUpdate
} from "../lib/world-docs.js";
import { BATCH_GET_MAX_IDS, ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError, toFailureSummary } from "../lib/errors.js";
import { createMutationQueue } from "../lib/mutation-queue.js";
import {
  deriveChatCaptureStatus,
  selectReportedChatIds,
  startRollTableChatCapture
} from "../lib/chat-capture.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { canonicalizeFilePathFields } from "../lib/file-access.js";
import {
  cloneValue,
  filterByName,
  paginate,
  serializeTable,
  serializeTableResult,
  serializeTableResultSummary,
  serializeTableSummary,
  storedTableResultName
} from "../lib/serializers.js";

const tableQueue = createMutationQueue();

/**
 * @template T
 * @param {() => Promise<T> | T} task
 * @returns {Promise<T>}
 */
export function runQueuedTableMutation(task) {
  return tableQueue.run(task);
}

/**
 * @param {Record<string, (params: any, context: any) => Promise<any>>} ownershipHandlers
 * @returns {Record<string, (params: any, context: any) => Promise<any>>}
 */
export function withQueuedTableOwnership(ownershipHandlers) {
  const base = ownershipHandlers?.["table.ownership.set"];
  if (typeof base !== "function") {
    throw new Error(
      "withQueuedTableOwnership expected a `table.ownership.set` handler to wrap (see handlers/ownership.js)"
    );
  }
  return {
    ...ownershipHandlers,

    "table.ownership.set": (...args) => tableQueue.run(() => base(...args))
  };
}

function rereadTable(tableId, fallback) {
  try {
    return getTableById(tableId);
  } catch {
    return fallback;
  }
}

function serializeDrawnResult(result) {
  const parent = result?.parent ?? null;
  return {
    ...serializeTableResult(result),
    tableId: parent?.id ?? null,
    tableName: parent?.name ?? null
  };
}

function serializeDrawRoll(roll) {
  if (!roll) return null;
  return {
    formula: roll.formula ?? null,
    total: typeof roll.total === "number" ? roll.total : null
  };
}

function compareTables(a, b) {
  const sortA = Number.isFinite(a?.sort) ? a.sort : Number.POSITIVE_INFINITY;
  const sortB = Number.isFinite(b?.sort) ? b.sort : Number.POSITIVE_INFINITY;
  if (sortA !== sortB) return sortA - sortB;
  return String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
}

function nullPreviewResultIds(table) {
  if (!Array.isArray(table?.results)) {
    return table;
  }
  return {
    ...table,
    results: table.results.map((result) => ({ ...result, id: null, _id: null }))
  };
}

export function createTableHandlers() {
  return {
    async "table.list"(params) {
      const tables = filterByName(Array.from(getTablesCollection()), params.name);
      const { page, total, hasMore } = paginate(tables, params);
      return {
        tables: page.map((table) => serializeTableSummary(table)),
        total,
        hasMore
      };
    },

    async "table.get"(params) {
      const table = getTableById(params.tableId);
      return {
        table: serializeTable(table, { ownership: true })
      };
    },

    async "table.get-many"(params) {
      const ids = params.ids;
      if (ids.length > BATCH_GET_MAX_IDS) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `table.get-many accepts at most ${BATCH_GET_MAX_IDS} ids`,
          { max: BATCH_GET_MAX_IDS, received: ids.length }
        );
      }

      const tables = ids.map((id) => serializeTable(getTableById(id), { ownership: true }));
      return { tables };
    },

    async "table.create"(params) {
      const data = prepareTableCreateData(params.data);

      const preview = previewTableCreate(cloneValue(data));
      if (isDryRun(params)) {
        return dryRunResponse({ table: nullPreviewResultIds(serializeTable(preview)) });
      }

      const table = await createTable(data);
      return {
        table: serializeTable(table)
      };
    },

    async "table.update"(params) {
      return tableQueue.run(async () => {
        const table = getTableById(params.tableId);

        const patch = canonicalizeFilePathFields(params.patch, "RollTable");
        if (isDryRun(params)) {
          const preview = await previewDocumentUpdate(table, patch);
          return dryRunResponse({ table: serializeTable(preview) });
        }

        const updated = await table.update(patch, { diff: true, render: true });
        if (!updated) {
          await assertTableFamilyUpdateCommitted({
            document: table,
            patch,
            subject: `Roll table ${table.id ?? params.tableId}`,
            hookName: "preUpdateRollTable",
            details: { tableId: table.id ?? params.tableId }
          });
        }
        return {
          table: serializeTable(table)
        };
      });
    },

    async "table.clone"(params) {
      return tableQueue.run(async () => {
        const table = getTableById(params.tableId);
        const patch = canonicalizeFilePathFields(params.patch ?? {}, "RollTable");

        await assertClonePatchValid(table, patch);

        const clone = await cloneDocument(table, patch, { dryRun: isDryRun(params) });
        const result = { table: serializeTable(clone) };
        return isDryRun(params) ? dryRunResponse(result) : result;
      });
    },

    async "table.delete"(params) {
      return tableQueue.run(async () => {
        const table = getTableById(params.tableId);
        const id = table.id ?? params.tableId;
        if (isDryRun(params)) {
          return dryRunResponse({ id, deleted: false });
        }

        const deletedDocument = await deleteDocument(table);
        assertTableFamilyDeleteCommitted({
          committed: Boolean(deletedDocument),
          subject: `Roll table ${id}`,
          hookName: "preDeleteRollTable",
          details: { tableId: id }
        });
        return {
          id,
          deleted: true
        };
      });
    },

    async "table.draw"(params) {
      return tableQueue.run(async () => {
        const table = getTableById(params.tableId);
        const tableId = table.id ?? params.tableId;
        const count = params.count ?? 1;
        const recursive = params.recursive ?? true;
        const chat = params.chat ?? true;

        const rollMode = params.rollMode ?? "public";

        assertTableDrawSupported(table);
        assertTableDrawCountSupported(table, { count, recursive });

        const persistedAvailableBefore = countPersistedAvailableTableResults(table);

        if (isDryRun(params)) {
          return dryRunResponse({
            tableId,
            complete: true,
            mutation: "not-executed",
            results: [],
            roll: null,
            availableBefore: persistedAvailableBefore,
            availableAfter: persistedAvailableBefore,
            chatMessages: { status: "not-requested", expectedCount: 0, ids: [] }
          });
        }

        const drawEvidence = snapshotTableDrawEvidence(table, { recursive, count });

        const capture = chat ? startRollTableChatCapture(tableId) : { available: false, stop: () => [] };
        let draw = null;
        let drawError = null;
        try {
          draw = await drawFromTable(table, {
            count,
            recursive,
            chat,
            mode: resolveTableDrawMessageMode(rollMode)
          });
        } catch (error) {
          drawError = error;
        }
        const capturedIds = capture.stop();

        const rereadTableDocument = rereadTable(tableId, table);
        const persistedAvailableAfter = countPersistedAvailableTableResults(rereadTableDocument);

        const evidence = evaluateTableDrawEvidence(drawEvidence);

        if (drawError) {
          const replacement = Boolean(table.replacement ?? table.toObject?.().replacement);
          const targetMarksNothing = replacement || Boolean(table.pack);

          const cleanFailure =
            !targetMarksNothing && evidence.marked.length === 0 && isTableDrawCleanRefusal(evidence);
          if (cleanFailure) {
            throw drawError;
          }

          const reportedIds = selectReportedChatIds({
            expectedCount: chat ? 1 : 0,
            ids: capturedIds
          });
          return {
            tableId,
            complete: false,

            mutation: "unknown",

            results: [],
            roll: null,
            availableBefore: persistedAvailableBefore,
            availableAfter: persistedAvailableAfter,
            chatMessages: {
              status: chat ? "unknown" : "not-requested",

              expectedCount: reportedIds.length,
              ids: reportedIds
            },

            failure: toFailureSummary(drawError)
          };
        }

        const results = draw?.results ?? [];

        const unconfirmed = assertTableDrawCommitted({
          table: rereadTableDocument,
          tableId,
          results,
          count,
          recursive,
          evidence,
          persistedAvailableBefore,
          persistedAvailableAfter
        });

        const expectedCount = chat && results.length > 0 ? 1 : 0;

        const reportedIds = selectReportedChatIds({ expectedCount, ids: capturedIds });

        const status = deriveChatCaptureStatus({
          requested: chat,
          available: capture.available,
          expectedCount,
          ids: capturedIds
        });
        return {
          tableId,

          complete: !unconfirmed && (status === "captured" || status === "not-requested"),

          mutation: unconfirmed ? "unknown" : "committed",

          results: results.map((result) => serializeDrawnResult(result)),
          roll: serializeDrawRoll(draw?.roll ?? null),

          availableBefore: persistedAvailableBefore,
          availableAfter: persistedAvailableAfter,
          chatMessages: { status, expectedCount, ids: reportedIds },

          ...(unconfirmed ? { failure: toFailureSummary(unconfirmed) } : {})
        };
      });
    },

    async "table.reset"(params) {
      return tableQueue.run(async () => {
        const table = getTableById(params.tableId);
        const tableId = table.id ?? params.tableId;
        assertTableResetSupported(table);

        const changedCount = countDrawnTableResults(table);

        if (isDryRun(params)) {
          const preview = serializeTable(table);
          return dryRunResponse({
            tableId,
            reset: false,
            changedCount,
            table: {
              ...preview,
              results: preview.results.map((result) => ({ ...result, drawn: false }))
            }
          });
        }

        await resetTableResults(table);

        const rereadTableDocument = rereadTable(tableId, table);

        if (changedCount > 0) {
          const remainingDrawn = countDrawnTableResults(rereadTableDocument);
          if (remainingDrawn > 0) {
            throw createBridgeError(
              ERROR_CODES.INTERNAL_ERROR,
              `Roll table ${tableId} was NOT fully reset: ${remainingDrawn} of ${changedCount} previously-drawn row(s) still hold a stored drawn:true flag after Foundry resolved resetResults() without an error. The likeliest cause is a refused write — a module's preUpdateTableResult hook or a core _preUpdate returning false, or a row failing Foundry's own client-side validation (which Foundry reports only as a UI notification) — and Foundry drops such rows from the batch SILENTLY, one row at a time, so some rows MAY have been cleared and others not: re-read with table get --table-id ${tableId} before retrying. Two other causes fit the same observation: a concurrent draw from the Foundry UI or another module can re-mark rows drawn after this reset landed (the table queue serializes bridge commands only), and if the table was deleted mid-call this count comes from the table instance the bridge still held. There is no force flag for a world-side veto — disable the module that locks this table (or reset it from the Foundry UI) and retry.`,
              { tableId, changedCount, remainingDrawn }
            );
          }
        }

        return {
          tableId,
          reset: true,
          changedCount,
          table: serializeTable(rereadTableDocument)
        };
      });
    },

    async "table.result.list"(params) {
      const tables =
        params.tableId != null
          ? [getTableById(params.tableId)]
          : Array.from(getTablesCollection()).sort(compareTables);

      const ordered = [];
      const parentOf = new Map();
      for (const table of tables) {
        for (const result of table.results ? Array.from(table.results) : []) {
          ordered.push(result);
          parentOf.set(result, table);
        }
      }

      const filtered = filterByName(ordered, params.name, { nameOf: storedTableResultName });
      const { page, total, hasMore } = paginate(filtered, params);
      return {
        ...(params.tableId != null ? { tableId: params.tableId } : {}),
        results: page.map((result) => serializeTableResultSummary(result, parentOf.get(result))),
        total,
        hasMore
      };
    },

    async "table.result.get"(params) {
      const { result } = getTableResultById(params.tableId, params.resultId);
      return { tableId: params.tableId, result: serializeTableResult(result) };
    },

    async "table.result.create"(params) {
      return tableQueue.run(async () => {
        const table = getTableById(params.tableId);

        const data = prepareTableResultPayload(params.data, { label: "data" });

        const preview = previewTableResultCreate(table, cloneValue(data));
        if (isDryRun(params)) {
          return dryRunResponse({ tableId: params.tableId, result: serializeTableResult(preview) });
        }

        const result = await createTableResult(table, data);
        return { tableId: params.tableId, result: serializeTableResult(result) };
      });
    },

    async "table.result.update"(params) {
      return tableQueue.run(async () => {
        const { result } = getTableResultById(params.tableId, params.resultId);

        const patch = prepareTableResultPatch(result, params.patch);
        if (isDryRun(params)) {
          const preview = await previewDocumentUpdate(result, patch);
          return dryRunResponse({ tableId: params.tableId, result: serializeTableResult(preview) });
        }

        const { result: updated, committed } = await updateTableResult(
          params.tableId,
          params.resultId,
          patch
        );
        if (!committed) {
          await assertTableFamilyUpdateCommitted({
            document: updated,
            patch,
            subject: `Table result ${params.resultId} of roll table ${params.tableId}`,
            hookName: "preUpdateTableResult",
            details: { tableId: params.tableId, resultId: params.resultId }
          });
        }
        return { tableId: params.tableId, result: serializeTableResult(updated) };
      });
    },

    async "table.result.clone"(params) {
      return tableQueue.run(async () => {
        const { result } = getTableResultById(params.tableId, params.resultId);
        const patch = prepareTableResultPatch(result, params.patch ?? {});

        await assertClonePatchValid(result, patch);

        const clone = await cloneDocument(result, patch, { dryRun: isDryRun(params) });
        const body = { tableId: params.tableId, result: serializeTableResult(clone) };
        return isDryRun(params) ? dryRunResponse(body) : body;
      });
    },

    async "table.result.delete"(params) {
      return tableQueue.run(async () => {
        const { committed } = await deleteTableResult(params.tableId, params.resultId, {
          dryRun: isDryRun(params)
        });
        if (!isDryRun(params)) {
          assertTableFamilyDeleteCommitted({
            committed,
            subject: `Table result ${params.resultId} of roll table ${params.tableId}`,
            hookName: "preDeleteTableResult",
            details: { tableId: params.tableId, resultId: params.resultId }
          });
        }
        const body = {
          tableId: params.tableId,
          id: params.resultId,
          deleted: !isDryRun(params)
        };
        return isDryRun(params) ? dryRunResponse(body) : body;
      });
    }
  };
}
