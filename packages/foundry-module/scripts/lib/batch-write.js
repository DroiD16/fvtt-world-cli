import {
  BATCH_WRITE_MAX_ITEMS,
  BATCH_WRITE_PERSISTED_STATUSES,
  BATCH_WRITE_STATUSES,
  BATCH_WRITE_SUCCESS_STATUSES,
  ERROR_CODES
} from "../generated/protocol.js";
import {
  assertBatchArrayWritesReflected,
  assertNoAmbiguousBatchKeySpellings,
  batchEcfResidualEntries,
  batchEmbeddedCreateKeys,
  batchMergedConfirmationKeys,
  mergedPreviewReflected,
  readDocumentSource,
  structuredCloneish
} from "./batch-guards.js";
import {
  BridgeError,
  createBridgeError,
  isFoundryValidationError,
  toFailureSummary,
  toFoundryValidationError,
  toProtocolError
} from "./errors.js";

export const BATCH_STATUS = Object.freeze({
  CREATED: "created",
  UPDATED: "updated",
  DELETED: "deleted",
  UNCHANGED: "unchanged",
  ALREADY_DELETED: "alreadyDeleted",
  DROPPED: "dropped",
  UNKNOWN: "unknown"
});

const SUCCESS_STATUSES = new Set(BATCH_WRITE_SUCCESS_STATUSES);
const PERSISTED_STATUSES = new Set(BATCH_WRITE_PERSISTED_STATUSES);

for (const status of Object.values(BATCH_STATUS)) {
  if (!BATCH_WRITE_STATUSES.includes(status)) {
    throw new Error(`batch-write: status "${status}" is not a BATCH_WRITE_STATUSES member`);
  }
}

const BATCH_NO_WRITE_ASSURANCE = "Nothing was written.";

/**
 * @param {unknown[]} items
 * @param {{ command: string, field: string }} context
 */
export function assertBatchWithinLimit(items, { command, field }) {
  const length = Array.isArray(items) ? items.length : 0;
  if (length > BATCH_WRITE_MAX_ITEMS) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `${command} accepts at most ${BATCH_WRITE_MAX_ITEMS} ${field} per call (received ${length}); split the batch. ` +
        BATCH_NO_WRITE_ASSURANCE,
      { max: BATCH_WRITE_MAX_ITEMS, received: length, field }
    );
  }
}

/**
 * @param {string[]} ids
 * @param {{ command: string, field: string }} context
 */
export function assertNoDuplicateBatchIds(ids, { command, field }) {
  const seen = new Map();
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    if (seen.has(id)) {
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        `${command} lists ${field} ${id} twice (indices ${seen.get(id)} and ${index}); each document may appear ` +
          `at most once per call. ${BATCH_NO_WRITE_ASSURANCE}`,
        { index, duplicateOfIndex: seen.get(id), id, field }
      );
    }
    seen.set(id, index);
  }
}

/**
 * @param {(id: string) => boolean} isTaken
 * @returns {string}
 */
export function generateUnusedDocumentId(isTaken) {
  const randomID = /** @type {any} */ (globalThis).foundry?.utils?.randomID;
  if (typeof randomID !== "function") {
    throw createBridgeError(
      ERROR_CODES.BRIDGE_NOT_READY,
      "Foundry id generation API (foundry.utils.randomID) is not available"
    );
  }

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const id = randomID();
    if (!isTaken(id)) {
      return id;
    }
  }
  throw createBridgeError(
    ERROR_CODES.INTERNAL_ERROR,
    "Could not generate an unused document id for a batch create after 64 attempts"
  );
}

/**
 * @param {string} message
 * @param {{ command: string, index: number, id?: string }} coordinates
 */
function stampBatchRefusalMessage(message, { command, index, id }) {
  const text = typeof message === "string" ? message.trim() : "";
  const coordinate = `${command} element ${index}${typeof id === "string" ? ` (id ${id})` : ""}`;
  let stamped = text.startsWith(`${command} element ${index} `)
    ? text
    : text
      ? `${coordinate}: ${text}`
      : `${coordinate} was refused.`;
  if (!stamped.endsWith(BATCH_NO_WRITE_ASSURANCE)) {
    stamped = `${/[.!?]$/.test(stamped) ? stamped : `${stamped}.`} ${BATCH_NO_WRITE_ASSURANCE}`;
  }
  return stamped;
}

/**
 * @param {unknown} error
 * @param {{ command: string, index: number, id?: string }} coordinates
 */
function annotateBatchElementFailure(error, { command, index, id }) {
  const coordinates = typeof id === "string" ? { index, id } : { index };
  if (error instanceof BridgeError) {
    return createBridgeError(error.code, stampBatchRefusalMessage(error.message, { command, index, id }), {
      ...coordinates,
      ...(error.details ?? {})
    });
  }
  if (isFoundryValidationError(error)) {
    const mapped = toFoundryValidationError(error);
    return createBridgeError(mapped.code, stampBatchRefusalMessage(mapped.message, { command, index, id }), {
      ...coordinates,
      ...mapped.details
    });
  }
  return error;
}

/** @param {{ outcomes: Array<{index:number,id:string|null,status:string}>, dryRun?: boolean, failure?: {code:string,message:string}|null }} args */
export function buildBatchResult({ outcomes, dryRun = false, failure = null }) {
  const complete = outcomes.every((outcome) => SUCCESS_STATUSES.has(outcome.status));
  const body = { complete, outcomes };
  if (failure) {
    body.failure = failure;
  }
  if (dryRun) {
    body.dryRun = true;
  }
  return body;
}

function persistedCount(outcomes) {
  return outcomes.filter((outcome) => PERSISTED_STATUSES.has(outcome.status)).length;
}

function failedCount(outcomes) {
  return outcomes.filter((outcome) => !SUCCESS_STATUSES.has(outcome.status)).length;
}

/** @param {{ command: string, outcomes: Array<{index:number,id:string|null,status:string}> }} args */
function assertBatchPersistedSomething({ command, outcomes }) {
  if (persistedCount(outcomes) > 0 || failedCount(outcomes) === 0) {
    return;
  }

  const unestablished = outcomes.filter((outcome) => outcome.status === BATCH_STATUS.UNKNOWN).length;
  const refused = outcomes.filter((outcome) => outcome.status === BATCH_STATUS.DROPPED).length;
  const converged = outcomes.filter((outcome) => SUCCESS_STATUSES.has(outcome.status)).length;
  const tally =
    `${refused} refused, ${unestablished} unestablished` +
    (converged > 0 ? `, ${converged} already converged (never sent to Foundry)` : "");
  throw createBridgeError(
    ERROR_CODES.INTERNAL_ERROR,
    unestablished > 0
      ? `${command} reported no confirmed write: Foundry accepted the batch call, but the bridge could not ` +
          `establish the post-state of every element it sent (a confirmation re-read failed). Outcomes: ${tally}. ` +
          `Nothing is known to have landed — RE-READ the targets before retrying, and use a NEW idempotency key.`
      : `${command} confirmed no requested write: Foundry accepted the batch call and then refused every element ` +
          `it was sent (a preUpdate/preCreate/preDelete hook veto, or a validation failure the client backend reports ` +
          `only through the Foundry notifications area) — or, on an update, a hook stripped or rewrote the requested ` +
          `change while letting another one through, so a write for that id may still have landed. Stored state was ` +
          `re-read to confirm that none of the requested writes is present. Outcomes: ${tally}. ` +
          `Check the GM client's console/notifications for the cause, or disable the module that vetoes these writes, ` +
          `then RE-READ the targets and retry with a NEW idempotency key.`,
    { command, outcomes }
  );
}

/** @param {{ command: string, items: any[], dryRun: boolean, prepare: (data: any, index: number) => any | Promise<any>, preview: (prepared: any, index: number) => any, isIdTaken: (id: string) => boolean, create: (payloads: any[]) => Promise<any[]>, readBack: (id: string) => any, summarize?: (document: any) => Record<string, unknown> }} args */
export async function executeBatchCreate({
  command,
  items,
  dryRun,
  prepare,
  preview,
  isIdTaken,
  create,
  readBack,
  summarize
}) {
  assertBatchWithinLimit(items, { command, field: "data" });

  const prepared = [];
  for (let index = 0; index < items.length; index += 1) {
    let payload;
    try {
      payload = await prepare(items[index], index);
      preview(structuredCloneish(payload), index);
    } catch (error) {
      throw annotateBatchElementFailure(error, { command, index });
    }
    prepared.push(payload);
  }

  if (dryRun) {
    return buildBatchResult({
      outcomes: prepared.map((_payload, index) => ({
        index,
        id: null,
        status: BATCH_STATUS.CREATED,
        ...(summarize ? summarize(null) : {})
      })),
      dryRun: true
    });
  }

  const minted = new Set();
  const payloads = prepared.map((payload) => {
    const id = generateUnusedDocumentId((candidate) => minted.has(candidate) || isIdTaken(candidate));
    minted.add(id);
    return { ...payload, _id: id };
  });
  const ids = payloads.map((payload) => payload._id);

  let created = null;
  let failure = null;
  try {
    created = await create(payloads);
  } catch (error) {
    failure = describeBatchFailure(error);
  }

  const returned = new Set();
  if (Array.isArray(created)) {
    for (const document of created) {
      if (document?.id) returned.add(document.id);
    }
  }

  const outcomes = ids.map((id, index) => {
    const stored = readBack(id);
    if (stored || returned.has(id)) {
      return { index, id, status: BATCH_STATUS.CREATED, ...(summarize ? summarize(stored ?? null) : {}) };
    }

    return {
      index,
      id,
      status: failure ? BATCH_STATUS.UNKNOWN : BATCH_STATUS.DROPPED,
      ...(summarize ? summarize(null) : {})
    };
  });

  if (failure) {
    return finishThrownBatch({ outcomes, failure, error: failure.error });
  }
  assertBatchPersistedSomething({ command, outcomes });
  return buildBatchResult({ outcomes });
}

/** @param {{ command: string, patches: Array<{ id: string, patch: any }>, dryRun: boolean, resolve: (id: string, index: number) => any, prepare: (patch: any, index: number, document: any) => any | Promise<any>, diff: (document: any, patch: any) => Promise<Record<string, any>>, mergePreview: (document: any, patch: any) => Promise<any>, documentClass?: any, update: (entries: Array<Record<string, any>>) => Promise<any[]>, summarize?: (document: any) => Record<string, unknown> }} args */
export async function executeBatchUpdate({
  command,
  patches,
  dryRun,
  resolve,
  prepare,
  diff,
  mergePreview,
  documentClass,
  update,
  summarize
}) {
  assertBatchWithinLimit(patches, { command, field: "patches" });
  assertNoDuplicateBatchIds(
    patches.map((entry) => entry.id),
    { command, field: "id" }
  );

  const elements = [];
  for (let index = 0; index < patches.length; index += 1) {
    const { id, patch } = patches[index];
    const document = resolve(id, index);
    let preparedPatch;
    let elementDiff;
    let mergedSource = null;
    let mergedConfirmationKeys = [];
    let embeddedCreateKeys = [];
    try {
      preparedPatch = await prepare(patch, index, document);

      assertNoAmbiguousBatchKeySpellings({
        documentClass: documentClass ?? document?.constructor,
        patch: preparedPatch,
        index,
        command,
        id
      });

      const merged = await mergePreview(document, structuredCloneish(preparedPatch));
      assertBatchArrayWritesReflected({
        documentClass: documentClass ?? document?.constructor,
        patch: preparedPatch,
        merged,

        stored: document,
        index,
        command,
        id
      });

      mergedConfirmationKeys = batchMergedConfirmationKeys(preparedPatch);
      if (mergedConfirmationKeys.length > 0) {
        mergedSource = readDocumentSource(merged);
      }

      embeddedCreateKeys = batchEmbeddedCreateKeys(documentClass ?? document?.constructor, preparedPatch);
      elementDiff = await diff(document, structuredCloneish(preparedPatch));
    } catch (error) {
      throw annotateBatchElementFailure(error, { command, index, id });
    }
    elements.push({
      index,
      id,
      document,
      patch: preparedPatch,
      mergedSource,
      mergedConfirmationKeys,
      embeddedCreateKeys,
      unchanged: Object.keys(elementDiff).length === 0
    });
  }

  if (dryRun) {
    return buildBatchResult({
      outcomes: elements.map((element) => ({
        index: element.index,
        id: element.id,
        status: element.unchanged ? BATCH_STATUS.UNCHANGED : BATCH_STATUS.UPDATED,
        ...(summarize ? summarize(element.document) : {})
      })),
      dryRun: true
    });
  }

  const changed = elements.filter((element) => !element.unchanged);
  /** @type {Array<{index:number,id:string|null,status:string}>} */
  const outcomes = elements
    .filter((element) => element.unchanged)
    .map((element) => ({
      index: element.index,
      id: element.id,
      status: BATCH_STATUS.UNCHANGED,
      ...(summarize ? summarize(element.document) : {})
    }));

  if (changed.length === 0) {
    return buildBatchResult({ outcomes: sortByIndex(outcomes) });
  }

  let updated = null;
  let failure = null;
  try {
    updated = await update(changed.map((element) => ({ ...element.patch, _id: element.id })));
  } catch (error) {
    failure = describeBatchFailure(error);
  }

  const returned = new Set();
  if (Array.isArray(updated)) {
    for (const document of updated) {
      if (document?.id) returned.add(document.id);
    }
  }

  for (const element of changed) {
    let applied = false;
    let probeAnswered = true;
    try {
      const postDiff = await diff(element.document, structuredCloneish(element.patch));
      applied = Object.keys(postDiff).length === 0;
    } catch {
      probeAnswered = false;
    }
    if (!applied && element.mergedConfirmationKeys.length > 0) {
      const reflected = mergedPreviewReflected(element);
      applied = reflected === true;
      probeAnswered = reflected !== null;
    }
    if (!applied && element.embeddedCreateKeys.length > 0) {
      const residual = { ...element.patch };
      for (const key of element.embeddedCreateKeys) {
        const retained = batchEcfResidualEntries(residual[key]);
        if (retained.length > 0) residual[key] = retained;
        else delete residual[key];
      }
      let residualConfirmed = Object.keys(residual).length === 0;
      if (!residualConfirmed) {
        try {
          const residualDiff = await diff(element.document, structuredCloneish(residual));
          residualConfirmed = Object.keys(residualDiff).length === 0;
        } catch {
          probeAnswered = false;
        }
      }

      applied = residualConfirmed && returned.has(element.id);
    }
    if (applied) {
      outcomes.push({
        index: element.index,
        id: element.id,
        status: BATCH_STATUS.UPDATED,
        ...(summarize ? summarize(element.document) : {})
      });
    } else {
      outcomes.push({
        index: element.index,
        id: element.id,
        status: failure || !probeAnswered ? BATCH_STATUS.UNKNOWN : BATCH_STATUS.DROPPED,
        ...(summarize ? summarize(element.document) : {})
      });
    }
  }

  const ordered = sortByIndex(outcomes);
  if (failure) {
    return finishThrownBatch({ outcomes: ordered, failure, error: failure.error });
  }
  assertBatchPersistedSomething({ command, outcomes: ordered });
  return buildBatchResult({ outcomes: ordered });
}

/** @param {{ command: string, ids: string[], dryRun: boolean, resolve: (id: string) => any, assertDeletable?: (document: any, index: number) => void, remove: (ids: string[]) => Promise<any>, exists: (id: string) => boolean }} args */
export async function executeBatchDelete({ command, ids, dryRun, resolve, assertDeletable, remove, exists }) {
  assertBatchWithinLimit(ids, { command, field: "ids" });
  assertNoDuplicateBatchIds(ids, { command, field: "id" });

  const elements = ids.map((id, index) => {
    const document = resolve(id);
    if (document && assertDeletable) {
      try {
        assertDeletable(document, index);
      } catch (error) {
        throw annotateBatchElementFailure(error, { command, index, id });
      }
    }
    return { index, id, document };
  });

  const present = elements.filter((element) => element.document);
  /** @type {Array<{index:number,id:string|null,status:string}>} */
  const outcomes = elements
    .filter((element) => !element.document)
    .map((element) => ({ index: element.index, id: element.id, status: BATCH_STATUS.ALREADY_DELETED }));

  if (dryRun) {
    return buildBatchResult({
      outcomes: sortByIndex([
        ...outcomes,
        ...present.map((element) => ({ index: element.index, id: element.id, status: BATCH_STATUS.DELETED }))
      ]),
      dryRun: true
    });
  }

  if (present.length === 0) {
    return buildBatchResult({ outcomes: sortByIndex(outcomes) });
  }

  let failure = null;
  try {
    await remove(present.map((element) => element.id));
  } catch (error) {
    failure = describeBatchFailure(error);
  }

  for (const element of present) {
    if (!exists(element.id)) {
      outcomes.push({ index: element.index, id: element.id, status: BATCH_STATUS.DELETED });
    } else {
      outcomes.push({
        index: element.index,
        id: element.id,
        status: failure ? BATCH_STATUS.UNKNOWN : BATCH_STATUS.DROPPED
      });
    }
  }

  const ordered = sortByIndex(outcomes);
  if (failure) {
    return finishThrownBatch({ outcomes: ordered, failure, error: failure.error });
  }
  assertBatchPersistedSomething({ command, outcomes: ordered });
  return buildBatchResult({ outcomes: ordered });
}

function sortByIndex(outcomes) {
  return [...outcomes].sort((a, b) => a.index - b.index);
}

function describeBatchFailure(error) {
  return { error, ...toFailureSummary(error) };
}

function finishThrownBatch({ outcomes, failure, error }) {
  if (persistedCount(outcomes) > 0) {
    return buildBatchResult({ outcomes, failure: { code: failure.code, message: failure.message } });
  }
  const mapped = isFoundryValidationError(error) ? toFoundryValidationError(error) : toProtocolError(error);
  throw createBridgeError(mapped.code, mapped.message, { ...(mapped.details ?? {}), outcomes });
}
