import { BATCH_GET_MAX_IDS, ERROR_CODES } from "../generated/protocol.js";
import { getJournalById, getJournalsCollection } from "../lib/game-collections.js";
import {
  JOURNAL_CATEGORY_DANGLING_PAGE_ID_CAP,
  JOURNAL_CATEGORY_VETO_REMEDY,
  assertJournalPageOpsValid,
  assertJournalPageRenderable,
  assertJournalPagesExist,
  createJournalCategory,
  createJournalPages,
  deleteJournalCategory,
  deleteJournalPages,
  getJournalCategoryById,
  journalPagesReferencingCategory,
  previewJournalCategoryCreate,
  previewJournalUpdate,
  resolveJournalCollection,
  updateJournalCategory,
  updateJournalPages
} from "../lib/journal-docs.js";
import { resolveBroadcastUsers } from "../lib/broadcast-targets.js";
import { assertTableFamilyDeleteCommitted, assertTableFamilyUpdateCommitted } from "../lib/table-docs.js";
import {
  cloneDocument,
  createJournalEntry,
  deleteDocument,
  previewDocumentUpdate,
  previewJournalEntryCreate
} from "../lib/world-docs.js";
import { createBridgeError } from "../lib/errors.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { canonicalizeFilePathFields } from "../lib/file-access.js";
import { createWorldDocumentBatchHandlers } from "./world-doc-batch.js";
import {
  cloneValue,
  filterByName,
  paginate,
  serializeJournal,
  serializeJournalCategory,
  serializeJournalCategorySummary,
  serializeJournalPage,
  serializeJournalSummary,
  sortJournalCategories,
  storedJournalCategoryName,
  worldDocumentName
} from "../lib/serializers.js";

function canonicalizePageSrc(page) {
  if (page && typeof page.src === "string" && page.src) {
    const canonical = canonicalizeFilePathFields(page, "JournalEntryPage");
    page.src = canonical.src;
  }
  return page;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function normalizePageCategory(payload) {
  if (payload && payload.category === "") {
    payload.category = null;
  }
  return payload;
}

function assertJournalCategoryMember(journal, category) {
  if (category == null || category === "") {
    return;
  }
  if (!journal?.categories?.get?.(category)) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `Journal category ${category} does not exist on this journal; a page 'category' must reference an id from journal.category.list (or journal.get 'categories'), or be created with journal.category.create (use null to leave the page uncategorized)`,
      { journalId: journal?.id ?? null, category }
    );
  }
}

function assertInlineCreateCategory(page) {
  if (page?.category != null && page.category !== "") {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `Inline journal.create pages cannot set 'category' (${page.category}): a newly created journal has no categories to reference; create the journal first, then create the category with journal.category.create, then set a page's category via journal.update`,
      { category: page.category }
    );
  }
}

function splitJournalPatch(patch, journal) {
  const { pages = [], deletePageIds = [], ...documentPatch } = patch;
  const createPagesPayload = [];
  const updatePagesPayload = [];

  for (const page of pages) {
    const { id, ...pagePatch } = page;
    const payload = normalizePageCategory(compactObject(pagePatch));

    assertJournalCategoryMember(journal, payload.category);
    if (id) {
      const currentPage = journal?.pages?.get?.(id) ?? null;
      if (!currentPage) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          "One or more journal pages were not found; use journal.get to see this journal's valid page ids",
          {
            journalId: journal?.id ?? null,
            missingPageIds: [id]
          }
        );
      }

      assertJournalPageRenderable(payload, currentPage);
      updatePagesPayload.push({ _id: id, ...payload });
      continue;
    }

    if (typeof payload.name !== "string" || typeof payload.type !== "string") {
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        "New journal pages (entries without an id) require name and type",
        { page: payload }
      );
    }

    assertJournalPageRenderable(payload, null);
    createPagesPayload.push(payload);
  }

  return {
    documentPatch: compactObject(documentPatch),
    createPagesPayload,
    updatePagesPayload,
    deletePageIds
  };
}

/**
 * @param {any} journal
 * @param {string} categoryId
 */
function danglingPageReport(journal, categoryId) {
  const ids = journalPagesReferencingCategory(journal, categoryId);
  return {
    danglingPageCount: ids.length,
    danglingPageIds: ids.slice(0, JOURNAL_CATEGORY_DANGLING_PAGE_ID_CAP),
    danglingPageIdsTruncated: ids.length > JOURNAL_CATEGORY_DANGLING_PAGE_ID_CAP
  };
}

export function createJournalHandlers() {
  return {
    ...createWorldDocumentBatchHandlers({
      prefix: "journal",
      documentName: "JournalEntry",

      label: "journal entry",
      resolve: (id) => getJournalById(id),
      summarize: (document) => ({ name: document ? worldDocumentName(document) : null })
    }),

    async "journal.list"(params) {
      const journals = filterByName(Array.from(getJournalsCollection()), params.name);
      const { page, total, hasMore } = paginate(journals, params);
      return {
        journals: page.map((journal) => serializeJournalSummary(journal)),
        total,
        hasMore
      };
    },

    async "journal.get"(params) {
      const journal = getJournalById(params.journalId);
      return {
        journal: serializeJournal(journal, { ownership: true })
      };
    },

    async "journal.get-many"(params) {
      const ids = params.ids;
      if (ids.length > BATCH_GET_MAX_IDS) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `journal.get-many accepts at most ${BATCH_GET_MAX_IDS} ids`,
          { max: BATCH_GET_MAX_IDS, received: ids.length }
        );
      }

      const journals = ids.map((id) => serializeJournal(getJournalById(id), { ownership: true }));
      return { journals };
    },

    async "journal.create"(params) {
      for (const page of params.data?.pages ?? []) {
        normalizePageCategory(page);
        canonicalizePageSrc(page);
        assertJournalPageRenderable(page, null);
        assertInlineCreateCategory(page);
      }

      if (isDryRun(params)) {
        const preview = previewJournalEntryCreate(params.data);
        return dryRunResponse({ journal: serializeJournal(preview) });
      }

      const journal = await createJournalEntry(params.data);
      return {
        journal: serializeJournal(journal)
      };
    },

    async "journal.update"(params) {
      const journal = getJournalById(params.journalId);

      const { documentPatch, createPagesPayload, updatePagesPayload, deletePageIds } = splitJournalPatch(
        params.patch,
        journal
      );

      for (const page of [...createPagesPayload, ...updatePagesPayload]) {
        canonicalizePageSrc(page);
      }

      if (isDryRun(params)) {
        if (deletePageIds.length > 0) {
          assertJournalPagesExist(params.journalId, deletePageIds);
        }

        const { preview, pages } = await previewJournalUpdate(journal, {
          documentPatch,
          createPagesPayload,
          updatePagesPayload,
          deletePageIds
        });
        const previewJournal = serializeJournal(preview);
        previewJournal.pages = pages.map((page) => serializeJournalPage(page));
        return dryRunResponse({ journal: previewJournal });
      }

      assertJournalPageOpsValid(journal, { createPagesPayload, updatePagesPayload });

      if (Object.keys(documentPatch).length > 0) {
        await journal.update(documentPatch, { diff: true, render: true });
      }

      if (createPagesPayload.length > 0) {
        await createJournalPages(params.journalId, createPagesPayload);
      }

      if (updatePagesPayload.length > 0) {
        await updateJournalPages(params.journalId, updatePagesPayload);
      }

      if (deletePageIds.length > 0) {
        await deleteJournalPages(params.journalId, deletePageIds);
      }

      return {
        journal: serializeJournal(getJournalById(params.journalId))
      };
    },

    async "journal.clone"(params) {
      const journal = getJournalById(params.journalId);
      const clone = await cloneDocument(journal, params.patch ?? {}, { dryRun: isDryRun(params) });
      const result = { journal: serializeJournal(clone) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "journal.delete"(params) {
      const journal = getJournalById(params.journalId);
      const id = journal.id ?? params.journalId;
      if (isDryRun(params)) {
        return dryRunResponse({ id, deleted: false });
      }

      await deleteDocument(journal);
      return {
        id,
        deleted: true
      };
    },

    async "journal.show"(params) {
      const journal = getJournalById(params.journalId);
      const journalId = journal.id ?? params.journalId;
      const force = params.force === true;
      const users = resolveBroadcastUsers(params.userIds);

      if (journal.isOwner === false) {
        throw createBridgeError(
          ERROR_CODES.PERMISSION_DENIED,
          `Foundry only lets an OWNER of journal ${journalId} show it to players, and this GM user is not one. ` +
            `Grant ownership with \`journal ownership set\`. Nothing was shown`,
          { journalId }
        );
      }

      const Journal = resolveJournalCollection();
      if (typeof Journal?.show !== "function") {
        throw createBridgeError(
          ERROR_CODES.UNSUPPORTED_OPERATION,
          "This Foundry version exposes no journal-sharing API (Journal.show); nothing was shown",
          { journalId }
        );
      }

      await Journal.show(journal, { force, users: users.requested ?? [] });

      return {
        journalId,
        force,
        userIds: users.requested,
        activeUserIds: users.active,
        inactiveUserIds: users.inactive,
        dispatched: true
      };
    },

    async "journal.category.list"(params) {
      const journal = getJournalById(params.journalId);
      const categories = journal.categories ? Array.from(journal.categories) : [];

      const ordered = sortJournalCategories(categories);

      const filtered = filterByName(ordered, params.name, { nameOf: storedJournalCategoryName });
      const { page, total, hasMore } = paginate(filtered, params);
      return {
        journalId: params.journalId,

        categories: page.map((category) => serializeJournalCategorySummary(category)),
        total,
        hasMore
      };
    },

    async "journal.category.get"(params) {
      const { category } = getJournalCategoryById(params.journalId, params.categoryId);
      return { journalId: params.journalId, category: serializeJournalCategory(category) };
    },

    async "journal.category.create"(params) {
      const journal = getJournalById(params.journalId);

      const preview = previewJournalCategoryCreate(journal, cloneValue(params.data));
      if (isDryRun(params)) {
        return dryRunResponse({ journalId: params.journalId, category: serializeJournalCategory(preview) });
      }

      const category = await createJournalCategory(journal, params.data);
      return { journalId: params.journalId, category: serializeJournalCategory(category) };
    },

    async "journal.category.update"(params) {
      const { category } = getJournalCategoryById(params.journalId, params.categoryId);
      if (isDryRun(params)) {
        const preview = await previewDocumentUpdate(category, params.patch);
        return dryRunResponse({ journalId: params.journalId, category: serializeJournalCategory(preview) });
      }

      const { category: updated, committed } = await updateJournalCategory(
        params.journalId,
        params.categoryId,
        params.patch
      );

      if (!updated) {
        throw createBridgeError(
          ERROR_CODES.JOURNAL_CATEGORY_NOT_FOUND,
          `JournalEntryCategory ${params.categoryId} is no longer on journal ${params.journalId}: the row was REMOVED while this update was in flight (a concurrent journal.category.delete — this family takes no mutation queue — or a category removed from Foundry's own Categories dialog), so the update's outcome cannot be confirmed and the category no longer exists. This is NOT a module veto: no preUpdateJournalEntryCategory hook was involved. Re-read the journal's categories with journal.category.list before retrying.`,

          { journalId: params.journalId, categoryId: params.categoryId, removedDuringUpdate: true }
        );
      }
      if (!committed) {
        await assertTableFamilyUpdateCommitted({
          document: updated,
          patch: params.patch,
          subject: `Journal category ${params.categoryId} of journal ${params.journalId}`,
          hookName: "preUpdateJournalEntryCategory",
          details: { journalId: params.journalId, categoryId: params.categoryId },
          remedy: JOURNAL_CATEGORY_VETO_REMEDY
        });
      }
      return { journalId: params.journalId, category: serializeJournalCategory(updated) };
    },

    async "journal.category.delete"(params) {
      const { journal } = getJournalCategoryById(params.journalId, params.categoryId);
      if (isDryRun(params)) {
        return dryRunResponse({
          journalId: params.journalId,
          id: params.categoryId,
          deleted: false,
          ...danglingPageReport(journal, params.categoryId)
        });
      }

      const { journal: parent, committed } = await deleteJournalCategory(params.journalId, params.categoryId);

      assertTableFamilyDeleteCommitted({
        committed,
        subject: `Journal category ${params.categoryId} of journal ${params.journalId}`,
        hookName: "preDeleteJournalEntryCategory",
        details: { journalId: params.journalId, categoryId: params.categoryId },
        remedy: JOURNAL_CATEGORY_VETO_REMEDY
      });
      return {
        journalId: params.journalId,
        id: params.categoryId,
        deleted: true,

        ...danglingPageReport(parent, params.categoryId)
      };
    }
  };
}
