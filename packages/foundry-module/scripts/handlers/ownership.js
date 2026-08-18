import { ERROR_CODES } from "../generated/protocol.js";
import { getCardsById } from "../lib/cards-docs.js";
import {
  getActorById,
  getItemById,
  getJournalById,
  getMacroById,
  getSceneById
} from "../lib/game-collections.js";
import { assertKnownOwnershipUsers, mergeOwnershipPatch } from "../lib/ownership.js";
import { getPlaylistById } from "../lib/playlist-docs.js";
import { assertTableFamilyUpdateCommitted, getTableById } from "../lib/table-docs.js";
import { createBridgeError } from "../lib/errors.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { cloneValue } from "../lib/serializers.js";
import {
  serializeActor,
  serializeCards,
  serializeItem,
  serializeJournal,
  serializeMacro,
  serializePlaylist,
  serializeScene,
  serializeTable
} from "../lib/serializers.js";

function assertOwnershipPatchPresent(params) {
  if (params.default === undefined && params.users === undefined) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      "ownership.set requires at least one of `default` (a level) or `users` (a userId->level map)",
      {}
    );
  }
}

const OWNERSHIP_VETO_REMEDY =
  "There is no override for a world-side ownership veto — ownership.set takes no force flag, and force would not help: disable the module that locks this document (or edit its ownership from the Foundry UI) and retry.";

function makeOwnershipSetHandler({ idField, getDoc, serialize, resultKey, documentName, hookName }) {
  return async (params) => {
    const doc = getDoc(params[idField]);
    assertOwnershipPatchPresent(params);
    assertKnownOwnershipUsers(params.users);
    const merged = mergeOwnershipPatch(doc, { defaultLevel: params.default, users: params.users });

    if (isDryRun(params)) {
      const preview = serialize(doc, { ownership: true, flags: true, provenance: true });
      preview.ownership = merged;
      return dryRunResponse({ [resultKey]: preview });
    }

    const patch = { ownership: merged };

    const requestedPatch = cloneValue(patch);
    const updated = await doc.update(patch, { diff: true, render: true });
    if (!updated) {
      await assertTableFamilyUpdateCommitted({
        document: doc,
        patch: requestedPatch,
        subject: `${documentName} ${doc.id ?? params[idField]}`,
        hookName,
        details: { [idField]: doc.id ?? params[idField] },
        remedy: OWNERSHIP_VETO_REMEDY
      });
    }
    return { [resultKey]: serialize(doc, { ownership: true, flags: true, provenance: true }) };
  };
}

export function createOwnershipHandlers() {
  return {
    "actor.ownership.set": makeOwnershipSetHandler({
      idField: "actorId",
      getDoc: getActorById,
      serialize: serializeActor,
      resultKey: "actor",
      documentName: "Actor",
      hookName: "preUpdateActor"
    }),
    "item.ownership.set": makeOwnershipSetHandler({
      idField: "itemId",
      getDoc: getItemById,
      serialize: serializeItem,
      resultKey: "item",
      documentName: "Item",
      hookName: "preUpdateItem"
    }),
    "scene.ownership.set": makeOwnershipSetHandler({
      idField: "sceneId",
      getDoc: getSceneById,
      serialize: serializeScene,
      resultKey: "scene",
      documentName: "Scene",
      hookName: "preUpdateScene"
    }),
    "macro.ownership.set": makeOwnershipSetHandler({
      idField: "macroId",
      getDoc: getMacroById,
      serialize: serializeMacro,
      resultKey: "macro",
      documentName: "Macro",
      hookName: "preUpdateMacro"
    }),
    "playlist.ownership.set": makeOwnershipSetHandler({
      idField: "playlistId",
      getDoc: getPlaylistById,
      serialize: serializePlaylist,
      resultKey: "playlist",
      documentName: "Playlist",
      hookName: "preUpdatePlaylist"
    }),

    "table.ownership.set": makeOwnershipSetHandler({
      idField: "tableId",
      getDoc: getTableById,
      serialize: serializeTable,
      resultKey: "table",
      documentName: "RollTable",
      hookName: "preUpdateRollTable"
    }),

    "cards.ownership.set": makeOwnershipSetHandler({
      idField: "cardsId",
      getDoc: getCardsById,
      serialize: serializeCards,
      resultKey: "cards",
      documentName: "Cards",
      hookName: "preUpdateCards"
    }),

    async "journal.ownership.set"(params) {
      const journal = getJournalById(params.journalId);
      assertOwnershipPatchPresent(params);
      assertKnownOwnershipUsers(params.users);

      const usesInherit =
        params.default === -1 || (params.users ? Object.values(params.users).includes(-1) : false);

      let target = journal;
      if (params.pageId !== undefined) {
        const page = journal.pages?.get?.(params.pageId) ?? null;
        if (!page) {
          throw createBridgeError(
            ERROR_CODES.INVALID_PARAMS,
            `Journal page ${params.pageId} was not found on journal ${params.journalId}; use journal.get to see this journal's valid page ids`,
            { journalId: params.journalId, pageId: params.pageId }
          );
        }
        target = page;
      } else if (usesInherit) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          "INHERIT (-1) ownership is only valid for a journal PAGE (pass a pageId); a journal ENTRY cannot inherit — use a level of 0..3",
          { journalId: params.journalId }
        );
      }

      const merged = mergeOwnershipPatch(target, { defaultLevel: params.default, users: params.users });

      if (isDryRun(params)) {
        const preview = serializeJournal(journal, { ownership: true });
        if (params.pageId !== undefined) {
          const previewPage = preview.pages.find(
            (page) => page.id === params.pageId || page._id === params.pageId
          );
          if (previewPage) {
            previewPage.ownership = merged;
          }
        } else {
          preview.ownership = merged;
        }
        return dryRunResponse({ journal: preview });
      }

      await target.update({ ownership: merged }, { diff: true, render: true });
      return {
        journal: serializeJournal(getJournalById(params.journalId), { ownership: true })
      };
    }
  };
}
