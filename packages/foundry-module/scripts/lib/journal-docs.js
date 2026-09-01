import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

import { getJournalById } from "./game-collections.js";
import { previewDocumentCreate, previewDocumentUpdate, resolveEmbeddedDocumentClass } from "./world-docs.js";

/**
 * The Journal world collection carries Foundry's two sharing entry points. Foundry 14 keeps the bare
 * global only as a deprecated alias, so the namespaced path is read first.
 * @returns {any}
 */
export function resolveJournalCollection() {
  const namespaced = /** @type {any} */ (globalThis).foundry?.documents?.collections?.Journal;
  return namespaced ?? /** @type {any} */ (globalThis).Journal ?? null;
}

const CORE_JOURNAL_PAGE_TYPES = new Set(["text", "image", "pdf", "video"]);

const MEANINGFUL_VIDEO_FIELDS = ["loop", "autoplay", "timestamp", "width", "height"];

const DEFAULT_BEARING_VIDEO_FIELDS = Object.freeze({ controls: true, volume: 0.5 });

const DEFAULT_BEARING_TEXT_FIELDS = Object.freeze({ format: 1 });

function changesDefaultBearingField(payload, current, defaults) {
  if (payload == null || typeof payload !== "object") return false;
  return Object.keys(defaults).some((field) => {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) return false;
    const currentValue = current?.[field] ?? defaults[field];
    return payload[field] !== currentValue;
  });
}

function writesTextSource(text) {
  if (text == null || typeof text !== "object") return false;
  return (
    Object.prototype.hasOwnProperty.call(text, "content") ||
    Object.prototype.hasOwnProperty.call(text, "markdown")
  );
}

function writesImageCaption(image) {
  if (image == null || typeof image !== "object") return false;
  return Object.prototype.hasOwnProperty.call(image, "caption");
}

function hasRenderableVideo(video) {
  if (video == null || typeof video !== "object") return false;
  return MEANINGFUL_VIDEO_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(video, field));
}

/**
 * @param {Record<string, any>} payload
 * @param {any} [currentPage]
 */
export function assertJournalPageRenderable(payload, currentPage = null) {
  const effectiveType = payload.type ?? currentPage?.type ?? "text";

  if (!CORE_JOURNAL_PAGE_TYPES.has(effectiveType)) {
    return;
  }

  const writesText = writesTextSource(payload.text);
  const hasImage = writesImageCaption(payload.image);

  const textIsInertOnNonText =
    writesText || changesDefaultBearingField(payload.text, currentPage?.text, DEFAULT_BEARING_TEXT_FIELDS);
  if (textIsInertOnNonText && effectiveType !== "text") {
    const article = effectiveType === "image" ? "an" : "a";
    const hint = effectiveType === "image" ? "; set image.caption instead" : "";
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `text fields are not rendered on ${article} ${effectiveType}-type page${hint}`,
      { pageType: effectiveType, field: "text" }
    );
  }

  if (hasImage && effectiveType !== "image") {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      "image.caption is only rendered on image-type pages",
      { pageType: effectiveType, field: "image" }
    );
  }

  const videoIsInertOnNonVideo =
    hasRenderableVideo(payload.video) ||
    changesDefaultBearingField(payload.video, currentPage?.video, DEFAULT_BEARING_VIDEO_FIELDS);
  if (videoIsInertOnNonVideo && effectiveType !== "video") {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      "video settings are only rendered on video-type pages",
      { pageType: effectiveType, field: "video" }
    );
  }

  if (effectiveType === "text" && Object.prototype.hasOwnProperty.call(payload, "src")) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      "src is not rendered on a text-type page (only image/pdf/video pages consume src)",
      { pageType: effectiveType, field: "src" }
    );
  }

  if (effectiveType === "text" && payload.text != null && typeof payload.text === "object") {
    const effectiveFormat = payload.text.format ?? currentPage?.text?.format ?? 1;
    const writesContent = Object.prototype.hasOwnProperty.call(payload.text, "content");
    const writesMarkdown = Object.prototype.hasOwnProperty.call(payload.text, "markdown");

    if (effectiveFormat === 2) {
      const isConversionToText = currentPage != null && currentPage.type !== "text";
      if (isConversionToText && writesMarkdown) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `Converting a ${currentPage.type}-type page to text with text.markdown in one step leaves the rendered content blank (Foundry only converts markdown to content when the page is already text); change the page type to text first, then in a SECOND update set text.format:2 together with text.markdown`,
          { field: "text.markdown", format: 2, fromType: currentPage.type }
        );
      }

      const isFormatSwitchToMarkdown =
        currentPage != null && currentPage.type === "text" && currentPage.text?.format !== 2;
      if (
        isFormatSwitchToMarkdown &&
        !writesMarkdown &&
        !currentPage.text?.markdown &&
        currentPage.text?.content
      ) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          "Switching a text page to markdown (text.format 2) makes Foundry regenerate text.content from text.markdown, which is empty on an HTML page — the existing content would be blanked on save; supply text.markdown with the markdown source in the same update",
          { field: "text.markdown", format: 2, fromFormat: currentPage.text?.format ?? 1 }
        );
      }

      if (writesContent && payload.text.content !== currentPage?.text?.content) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          "On a markdown page (text.format 2) the rendered source is text.markdown, not text.content; text.content is server-derived from text.markdown and your change would be silently discarded — write text.markdown instead",
          { field: "text.markdown", format: 2 }
        );
      }
    } else if (
      effectiveFormat === 1 &&
      writesMarkdown &&
      payload.text.markdown !== currentPage?.text?.markdown
    ) {
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        "text.markdown is not stored on an HTML page (text.format 1): Foundry clears it on save, so your markdown would be silently dropped — set text.format 2 to render markdown, or write text.content instead",
        { field: "text.markdown", format: 1 }
      );
    }
  }
}

export async function createJournalPages(journalId, pages) {
  const journal = getJournalById(journalId);
  if (typeof journal.createEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Journal page creation API is not available");
  }

  return journal.createEmbeddedDocuments("JournalEntryPage", pages, { render: true });
}

export async function updateJournalPages(journalId, pages) {
  const journal = getJournalById(journalId);
  if (typeof journal.updateEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Journal page update API is not available");
  }

  return journal.updateEmbeddedDocuments("JournalEntryPage", pages, { diff: true, render: true });
}

/**
 * @param {any} journal
 * @param {{ createPagesPayload?: any[], updatePagesPayload?: any[] }} [split]
 */
export function assertJournalPageOpsValid(
  journal,
  { createPagesPayload = [], updatePagesPayload = [] } = {}
) {
  for (const { _id, ...patch } of updatePagesPayload) {
    const page = journal.pages?.get?.(_id) ?? null;
    if (!page || typeof page.updateSource !== "function") {
      throw createBridgeError(
        ERROR_CODES.INTERNAL_ERROR,
        `journal.update lost page ${_id} before page validation`,
        { pageId: _id }
      );
    }
    page.updateSource(patch, { dryRun: true, fallback: false });
  }

  if (createPagesPayload.length > 0) {
    const PageClass = resolveEmbeddedDocumentClass(journal.pages, "JournalEntryPage");
    for (const data of createPagesPayload) {
      previewDocumentCreate(PageClass, data, { parent: journal });
    }
  }
}

/**
 * @param {string} journalId
 * @param {string[]} pageIds
 */
export function assertJournalPagesExist(journalId, pageIds) {
  const journal = getJournalById(journalId);

  const missing = pageIds.filter((pageId) => !journal.pages?.get?.(pageId));
  if (missing.length > 0) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      "One or more journal pages were not found; use journal.get to see this journal's valid page ids",
      {
        journalId,
        missingPageIds: missing
      }
    );
  }
}

export async function deleteJournalPages(journalId, pageIds) {
  const journal = getJournalById(journalId);
  if (typeof journal.deleteEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Journal page delete API is not available");
  }

  assertJournalPagesExist(journalId, pageIds);

  return journal.deleteEmbeddedDocuments("JournalEntryPage", pageIds, { render: true });
}

export const JOURNAL_CATEGORY_VETO_REMEDY =
  "There is no force flag for a world-side veto — disable the module that locks this journal (or make the change from the Foundry UI) and retry.";

/**
 * @param {string} journalId
 * @param {string} categoryId
 */
export function getJournalCategoryById(journalId, categoryId) {
  const journal = getJournalById(journalId);
  const category = journal.categories?.get?.(categoryId) ?? null;
  if (!category) {
    throw createBridgeError(
      ERROR_CODES.JOURNAL_CATEGORY_NOT_FOUND,
      `JournalEntryCategory ${categoryId} was not found on journal ${journalId}; use journal.category.list to find valid ids`,
      { journalId, categoryId }
    );
  }
  return { journal, category };
}

/**
 * @param {any} journal
 * @param {Record<string, any>} data
 */
export async function createJournalCategory(journal, data) {
  if (typeof journal.createEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "JournalEntryCategory create API is not available");
  }
  const created = await journal.createEmbeddedDocuments("JournalEntryCategory", [data], {
    render: true
  });
  const category = Array.isArray(created) ? (created[0] ?? null) : created;
  if (!category) {
    throw createBridgeError(
      ERROR_CODES.INTERNAL_ERROR,
      `Journal category was NOT created on journal ${journal?.id ?? "(unknown)"}: JournalEntryCategory creation returned no document, which means a module's preCreateJournalEntryCategory hook or a core _preCreate refused the write, or the payload failed Foundry's own client-side validation (which Foundry reports only as a UI notification). Nothing was created. ${JOURNAL_CATEGORY_VETO_REMEDY}`,
      { journalId: journal?.id ?? null }
    );
  }
  return category;
}

/**
 * @param {any} journal
 * @param {Record<string, any>} data
 */
export function previewJournalCategoryCreate(journal, data) {
  return previewDocumentCreate(
    resolveEmbeddedDocumentClass(journal?.categories, "JournalEntryCategory"),
    data,
    { parent: journal }
  );
}

/**
 * @param {string} journalId
 * @param {string} categoryId
 * @param {Record<string, any>} patch
 */
export async function updateJournalCategory(journalId, categoryId, patch) {
  const { journal } = getJournalCategoryById(journalId, categoryId);
  if (typeof journal.updateEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "JournalEntryCategory update API is not available");
  }

  const updated = await journal.updateEmbeddedDocuments(
    "JournalEntryCategory",
    [{ _id: categoryId, ...patch }],
    { diff: true, render: true }
  );
  return {
    category: journal.categories?.get?.(categoryId) ?? null,
    committed: Array.isArray(updated) ? updated.length > 0 : Boolean(updated)
  };
}

/**
 * @param {string} journalId
 * @param {string} categoryId
 */
export async function deleteJournalCategory(journalId, categoryId) {
  const { journal } = getJournalCategoryById(journalId, categoryId);
  if (typeof journal.deleteEmbeddedDocuments !== "function") {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "JournalEntryCategory delete API is not available");
  }
  const deleted = await journal.deleteEmbeddedDocuments("JournalEntryCategory", [categoryId], {
    render: true
  });
  return {
    journal,
    committed: Array.isArray(deleted) ? deleted.length > 0 : Boolean(deleted)
  };
}

export const JOURNAL_CATEGORY_DANGLING_PAGE_ID_CAP = 50;

/**
 * @param {any} journal
 * @param {string} categoryId
 * @returns {string[]}
 */
export function journalPagesReferencingCategory(journal, categoryId) {
  const pages = journal?.pages ? Array.from(journal.pages) : [];
  const ids = [];
  for (const page of pages) {
    const stored = typeof page?.toObject === "function" ? page.toObject() : page;
    if (stored?.category === categoryId) {
      ids.push(page?.id ?? stored?._id ?? null);
    }
  }
  return ids.filter((id) => id != null);
}

/**
 * @param {any} journal
 * @param {{ documentPatch?: Record<string, any>, createPagesPayload?: any[], updatePagesPayload?: any[], deletePageIds?: string[] }} [split]
 */
export async function previewJournalUpdate(
  journal,
  { documentPatch = {}, createPagesPayload = [], updatePagesPayload = [], deletePageIds = [] } = {}
) {
  const preview = await previewDocumentUpdate(journal, documentPatch);

  const winningUpdates = new Map();
  for (const { _id, ...patch } of updatePagesPayload) {
    const page = preview.pages?.get?.(_id) ?? null;

    if (!page || typeof page.updateSource !== "function") {
      throw createBridgeError(
        ERROR_CODES.INTERNAL_ERROR,
        `journal.update preview lost page ${_id} on the in-memory clone`,
        { pageId: _id }
      );
    }

    const diff = page.updateSource(patch, { dryRun: true, fallback: false });
    if (Object.keys(diff ?? {}).length === 0) {
      continue;
    }
    winningUpdates.set(_id, patch);
  }

  for (const [_id, patch] of winningUpdates) {
    preview.pages.get(_id).updateSource(patch);
  }

  const PageClass = resolveEmbeddedDocumentClass(preview.pages, "JournalEntryPage");
  const createdPages = createPagesPayload.map((data) =>
    previewDocumentCreate(PageClass, data, { parent: preview })
  );

  const deleted = new Set(deletePageIds);
  const survivingPages = Array.from(preview.pages ?? []).filter((page) => !deleted.has(page.id));

  return { preview, pages: [...survivingPages, ...createdPages] };
}
