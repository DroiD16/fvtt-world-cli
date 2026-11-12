import {
  BATCH_WRITE_MAX_ITEMS,
  BATCH_WRITE_PERSISTED_STATUSES,
  BATCH_WRITE_STATUSES,
  BATCH_WRITE_SUCCESS_STATUSES,
  ERROR_CODES
} from "../generated/protocol.js";
import {
  assertBatchArrayWritesReflected,
  batchEcfResidualEntries,
  batchEmbeddedCreateKeys,
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
import { WORLD_VETO_REMEDY, evaluateRequestedDiff, unverifiableCauseSentence } from "./mismatch-report.js";

export const BATCH_STATUS = Object.freeze({
  CREATED: "created",
  UPDATED: "updated",
  DELETED: "deleted",
  UNCHANGED: "unchanged",
  ALREADY_DELETED: "alreadyDeleted",
  DROPPED: "dropped",
  UNKNOWN: "unknown",
  NOT_ATTEMPTED: "notAttempted"
});

const SUCCESS_STATUSES = new Set(BATCH_WRITE_SUCCESS_STATUSES);
const PERSISTED_STATUSES = new Set(BATCH_WRITE_PERSISTED_STATUSES);

for (const status of Object.values(BATCH_STATUS)) {
  if (!BATCH_WRITE_STATUSES.includes(status)) {
    throw new Error(`batch-write: status "${status}" is not a BATCH_WRITE_STATUSES member`);
  }
}

const BATCH_NO_WRITE_ASSURANCE = "Nothing was written.";
const BATCH_NO_WRITE_ASSURANCE_PATTERN = /Nothing was written\.?$/;

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
  if (!BATCH_NO_WRITE_ASSURANCE_PATTERN.test(stamped)) {
    stamped = `${/[.!?]$/.test(stamped) ? stamped : `${stamped}.`} ${BATCH_NO_WRITE_ASSURANCE}`;
  }
  return stamped;
}

/**
 * @param {unknown} error
 * @param {{ command: string, index: number, id?: string }} coordinates
 */
export function annotateBatchElementFailure(error, { command, index, id }) {
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

/** @param {{ command: string, outcomes: Array<{index:number,id:string|null,status:string}>, verb: "create" | "update" | "delete" }} args */
function assertBatchPersistedSomething({ command, outcomes, verb }) {
  if (persistedCount(outcomes) > 0 || failedCount(outcomes) === 0) {
    return;
  }

  const unestablished = outcomes.filter((outcome) => outcome.status === BATCH_STATUS.UNKNOWN).length;
  const refused = outcomes.filter((outcome) => outcome.status === BATCH_STATUS.DROPPED).length;
  const converged = outcomes.filter((outcome) => SUCCESS_STATUSES.has(outcome.status)).length;
  const notAttempted = outcomes.filter((outcome) => outcome.status === BATCH_STATUS.NOT_ATTEMPTED).length;
  const tally =
    `${refused} ${verb === "update" ? "dropped" : "refused"}, ${unestablished} unestablished` +
    (converged > 0 ? `, ${converged} already converged (never sent to Foundry)` : "") +
    (notAttempted > 0 ? `, ${notAttempted} not attempted after the first failure` : "");
  if (unestablished > 0) {
    throw createBridgeError(
      ERROR_CODES.INTERNAL_ERROR,
      `${command} reported no confirmed write: Foundry accepted the batch call, but the bridge could not ` +
        `establish the post-state of every element it sent (a confirmation re-read failed). Outcomes: ${tally}. ` +
        `Nothing is known to have landed — RE-READ the targets before retrying, and use a NEW idempotency key.`,
      { command, outcomes }
    );
  }
  throw createBridgeError(
    ERROR_CODES.INTERNAL_ERROR,
    verb === "update"
      ? `${command} confirmed no requested write: Foundry accepted the batch call, and a re-read shows stored ` +
          `values that differ from the request for every element it was sent, or cannot confirm an element's ` +
          `embedded creation (details.outcomes[].paths lists the requested and the stored value per path where the ` +
          `stored state was compared). ${unverifiableCauseSentence()} Part of an element's patch may still have ` +
          `landed. Outcomes: ${tally}. Compare the requested and stored values and RE-READ the targets before ` +
          `deciding what remains to apply; any retry needs a NEW idempotency key. ${WORLD_VETO_REMEDY}`
      : `${command} confirmed no requested write: Foundry accepted the batch call and then refused every element ` +
          `it was sent (a ${verb === "create" ? "preCreate" : "preDelete"} hook veto, or a validation failure the ` +
          `client backend reports only through the Foundry notifications area). Stored state was re-read to confirm ` +
          `that none of the requested writes is present. Outcomes: ${tally}. The GM client's console and ` +
          `notifications show the cause. RE-READ the targets before retrying, and use a NEW idempotency key. ` +
          WORLD_VETO_REMEDY,
    { command, outcomes }
  );
}

/** @param {{ command: string, items: any[], dryRun: boolean, sequential?: boolean, prepare: (data: any, index: number) => any | Promise<any>, preview: (prepared: any, index: number) => any, isIdTaken: (id: string) => boolean, create: (payloads: any[]) => Promise<any[]>, readBack: (id: string) => any, summarize?: (document: any) => Record<string, unknown> }} args */
export async function executeBatchCreate({
  command,
  items,
  dryRun,
  sequential = false,
  prepare,
  preview,
  isIdTaken,
  create,
  readBack,
  summarize
}) {
  assertBatchWithinLimit(items, { command, field: "data" });

  const prepared = [];
  const previews = [];
  for (let index = 0; index < items.length; index += 1) {
    let payload;
    try {
      payload = await prepare(items[index], index);
      previews.push(preview(structuredCloneish(payload), index));
    } catch (error) {
      throw annotateBatchElementFailure(error, { command, index });
    }
    prepared.push(payload);
  }

  if (dryRun) {
    return buildBatchResult({
      outcomes: previews.map((previewDocument, index) => ({
        index,
        id: null,
        status: BATCH_STATUS.CREATED,
        ...(summarize ? summarize(previewDocument) : {})
      })),
      dryRun: true
    });
  }

  if (sequential) {
    return createSequentially({ command, items, prepare, isIdTaken, create, readBack, summarize });
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
  assertBatchPersistedSomething({ command, outcomes, verb: "create" });
  return buildBatchResult({ outcomes });
}

/** @param {{ command: string, items: any[], prepare: (data: any, index: number) => any | Promise<any>, isIdTaken: (id: string) => boolean, create: (payloads: any[]) => Promise<any[]>, readBack: (id: string) => any, summarize?: (document: any) => Record<string, unknown> }} args */
async function createSequentially({ command, items, prepare, isIdTaken, create, readBack, summarize }) {
  /** @type {Array<{index:number,id:string|null,status:string}>} */
  const outcomes = [];
  const outcome = (index, id, status, document = null) => ({
    index,
    id,
    status,
    ...(summarize ? summarize(document) : {})
  });
  let failure = null;
  let stopped = false;
  for (let index = 0; index < items.length; index += 1) {
    if (stopped) {
      outcomes.push(outcome(index, null, BATCH_STATUS.NOT_ATTEMPTED));
      continue;
    }

    let payload;
    try {
      payload = await prepare(items[index], index);
    } catch (error) {
      failure = sequentialElementFailure(error, {
        command,
        index,
        nothingWritten: persistedCount(outcomes) === 0
      });
      stopped = true;
      outcomes.push(outcome(index, null, BATCH_STATUS.DROPPED));
      continue;
    }

    const id = generateUnusedDocumentId(isIdTaken);
    let created = null;
    try {
      created = await create([{ ...payload, _id: id }]);
    } catch (error) {
      failure = sequentialElementFailure(error, { command, index, id, nothingWritten: false });
      stopped = true;
    }

    const stored = readBack(id);
    if (stored || (Array.isArray(created) && created.some((document) => document?.id === id))) {
      outcomes.push(outcome(index, id, BATCH_STATUS.CREATED, stored ?? null));
    } else {
      stopped = true;
      outcomes.push(outcome(index, id, failure ? BATCH_STATUS.UNKNOWN : BATCH_STATUS.DROPPED));
    }
  }

  if (failure) {
    return finishThrownBatch({ outcomes, failure, error: failure.error });
  }
  assertBatchPersistedSomething({ command, outcomes, verb: "create" });
  return buildBatchResult({ outcomes });
}

/**
 * @param {unknown} error
 * @param {{ command: string, index: number, id?: string, nothingWritten: boolean }} context
 */
function sequentialElementFailure(error, { command, index, id, nothingWritten }) {
  const mapped = isFoundryValidationError(error) ? toFoundryValidationError(error) : toProtocolError(error);
  const coordinate = `${command} element ${index}${typeof id === "string" ? ` (id ${id})` : ""}`;
  const text = mapped.message.startsWith(`${command} element ${index} `)
    ? mapped.message
    : `${coordinate}: ${mapped.message}`;
  const message =
    nothingWritten && !BATCH_NO_WRITE_ASSURANCE_PATTERN.test(text)
      ? `${/[.!?]$/.test(text) ? text : `${text}.`} ${BATCH_NO_WRITE_ASSURANCE}`
      : text;
  const annotated = createBridgeError(mapped.code, message, {
    ...(mapped.details ?? {}),
    index,
    ...(typeof id === "string" ? { id } : {})
  });
  return { error: annotated, code: mapped.code, message };
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
    let embeddedCreateKeys = [];
    try {
      preparedPatch = await prepare(patch, index, document);
      const elementClass = documentClass ?? document?.constructor;
      const merged = await mergePreview(document, structuredCloneish(preparedPatch));
      assertBatchArrayWritesReflected({
        documentClass: elementClass,
        patch: preparedPatch,
        merged,
        stored: document,
        index,
        command,
        id
      });

      embeddedCreateKeys = batchEmbeddedCreateKeys(elementClass, preparedPatch);
      elementDiff = await diff(document, structuredCloneish(preparedPatch));
    } catch (error) {
      throw annotateBatchElementFailure(error, { command, index, id });
    }
    elements.push({
      index,
      id,
      document,
      patch: preparedPatch,
      embeddedCreateKeys,
      unchanged: evaluateRequestedDiff(elementDiff, () => readDocumentSource(document)).status === "confirmed"
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

  /**
   * @param {any} document
   * @param {Record<string, any>} patch
   * @returns {Promise<import("./mismatch-report.js").RequestedDiffEvaluation>}
   */
  const evaluate = async (document, patch) => {
    try {
      return evaluateRequestedDiff(await diff(document, structuredCloneish(patch)), () =>
        readDocumentSource(document)
      );
    } catch (error) {
      return {
        status: /** @type {const} */ ("unprovable"),
        probeError: /** @type {any} */ (error)?.message ?? String(error)
      };
    }
  };

  for (const element of changed) {
    let evaluation = await evaluate(element.document, element.patch);
    let applied = evaluation.status === "confirmed";
    let probeAnswered = evaluation.status !== "unprovable";
    if (!applied && element.embeddedCreateKeys.length > 0) {
      const residual = { ...element.patch };
      for (const key of element.embeddedCreateKeys) {
        const retained = batchEcfResidualEntries(residual[key]);
        if (retained.length > 0) residual[key] = retained;
        else delete residual[key];
      }
      if (Object.keys(residual).length > 0) {
        evaluation = await evaluate(element.document, residual);
        probeAnswered = probeAnswered && evaluation.status !== "unprovable";
      } else {
        evaluation = { status: "confirmed" };
      }
      applied = evaluation.status === "confirmed" && returned.has(element.id);
    }
    if (applied) {
      outcomes.push({
        index: element.index,
        id: element.id,
        status: BATCH_STATUS.UPDATED,
        ...(summarize ? summarize(element.document) : {})
      });
    } else {
      const status = failure || !probeAnswered ? BATCH_STATUS.UNKNOWN : BATCH_STATUS.DROPPED;
      outcomes.push({
        index: element.index,
        id: element.id,
        status,
        ...(summarize ? summarize(element.document) : {}),
        ...(status === BATCH_STATUS.DROPPED && evaluation.status === "pending"
          ? {
              paths: evaluation.report.paths,
              ...(evaluation.report.pathsTruncated
                ? { pathsTruncated: evaluation.report.pathsTruncated }
                : {})
            }
          : {})
      });
    }
  }

  const ordered = sortByIndex(outcomes);
  if (failure) {
    return finishThrownBatch({ outcomes: ordered, failure, error: failure.error });
  }
  assertBatchPersistedSomething({ command, outcomes: ordered, verb: "update" });
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
  assertBatchPersistedSomething({ command, outcomes: ordered, verb: "delete" });
  return buildBatchResult({ outcomes: ordered });
}

function sortByIndex(outcomes) {
  return [...outcomes].sort((a, b) => a.index - b.index);
}

function describeBatchFailure(error) {
  return { error, ...toFailureSummary(error) };
}

/** @param {{ outcomes: Array<{index:number,id:string|null,status:string}>, failure: {code:string,message:string}, error: unknown }} args */
export function finishThrownBatch({ outcomes, failure, error }) {
  if (persistedCount(outcomes) > 0) {
    return buildBatchResult({ outcomes, failure: { code: failure.code, message: failure.message } });
  }
  const mapped = isFoundryValidationError(error) ? toFoundryValidationError(error) : toProtocolError(error);
  throw createBridgeError(mapped.code, mapped.message, { ...(mapped.details ?? {}), outcomes });
}
