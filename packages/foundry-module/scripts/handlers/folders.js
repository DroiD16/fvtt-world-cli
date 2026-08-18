import { ERROR_CODES } from "../generated/protocol.js";
import { findActorTokenReferences } from "../lib/actor-references.js";
import {
  assertFolderCreateParentValid,
  assertFolderDeleteCascadeSafe,
  assertFolderReparentValid,
  createFolder,
  getFolderById,
  getFolderChildren,
  getFolderDescendants,
  getFolderDirectContents,
  resolveFolderDocumentClass
} from "../lib/folders.js";
import { getFoldersCollection } from "../lib/game-collections.js";
import {
  computeDocumentUpdateDiff,
  previewDocumentCreate,
  previewDocumentUpdate
} from "../lib/world-docs.js";
import { createBridgeError } from "../lib/errors.js";
import { createMutationQueue } from "../lib/mutation-queue.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";

import { runQueuedTableMutation } from "./tables.js";
import { filterByName, paginate, serializeFolder, serializeFolderSummary } from "../lib/serializers.js";

const FOLDER_DELETE_ID_CAP = 100;

const FOLDER_DELETE_TOKEN_REFERENCE_CAP = 20;

const folderQueue = createMutationQueue();

/**
 * @template T
 * @param {{ type: string | null }} plan
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function runFolderContentCascade(plan, task) {
  if (plan.type !== "RollTable") {
    return task();
  }
  return runQueuedTableMutation(task);
}

function folderParentId(folder) {
  return folder?.folder?.id ?? folder?.folder ?? folder?.toObject?.().folder ?? null;
}

function documentFolderId(doc) {
  return doc?.folder?.id ?? doc?.folder ?? null;
}

function folderCounts(folder) {
  const id = folder?.id ?? null;
  const type = folder?.type ?? folder?.toObject?.().type ?? null;
  if (id == null) {
    return { childFolderCount: 0, documentCount: 0 };
  }
  return {
    childFolderCount: getFolderChildren(id).length,
    documentCount: type ? getFolderDirectContents(id, type).length : 0
  };
}

function capIds(ids) {
  return {
    count: ids.length,
    ids: ids.slice(0, FOLDER_DELETE_ID_CAP),
    truncated: ids.length > FOLDER_DELETE_ID_CAP
  };
}

function computeDeletePlan(folder, { deleteSubfolders, deleteContents }) {
  const type = folder.type ?? folder.toObject?.().type ?? null;
  const parentId = folderParentId(folder);
  const descendants = getFolderDescendants(folder.id);
  const descendantIds = descendants.map((d) => d.id);
  const directChildren = getFolderChildren(folder.id);

  const allContentFolderIds = [folder.id, ...descendantIds];
  const allSubtreeContentIds = [];
  for (const fid of allContentFolderIds) {
    allSubtreeContentIds.push(...getFolderDirectContents(fid, type).map((d) => d.id));
  }
  const directContents = getFolderDirectContents(folder.id, type);

  const contentSourceFolderIds = deleteSubfolders ? [folder.id, ...descendantIds] : [folder.id];
  const affectedContentDocs = [];
  for (const fid of contentSourceFolderIds) {
    affectedContentDocs.push(...getFolderDirectContents(fid, type));
  }
  const affectedContentIds = affectedContentDocs.map((d) => d.id);

  const foldersDeletedIds = deleteSubfolders ? descendantIds : [];
  const foldersReparentedIds = deleteSubfolders ? [] : descendantIds;
  const contentsDeletedIds = deleteContents ? affectedContentIds : [];
  const contentsReparentedIds = deleteContents ? [] : affectedContentIds;

  const folderPreviousParents = new Map(
    (deleteSubfolders ? [] : descendants).map((folderDoc) => [folderDoc.id, folderParentId(folderDoc)])
  );
  const contentPreviousParents = new Map(
    (deleteContents ? [] : affectedContentDocs).map((doc) => [doc.id, documentFolderId(doc)])
  );

  return {
    type,
    parentId,
    directChildCount: directChildren.length,
    recursiveSubfolderCount: descendantIds.length,
    directContentCount: directContents.length,
    recursiveContentCount: allSubtreeContentIds.length,
    foldersDeletedIds,
    foldersReparentedIds,
    contentsDeletedIds,
    contentsReparentedIds,
    folderPreviousParents,
    contentPreviousParents,

    deletedDocs: deleteContents ? affectedContentDocs : []
  };
}

function enumerateGuardViolations(plan) {
  /** @type {{ actors: Array<Record<string, unknown>>, actorsCount: number, actorsTruncated: boolean, scenes: Array<Record<string, unknown>>, scenesCount: number, scenesTruncated: boolean, activeScene: boolean }} */
  const violations = {
    actors: [],
    actorsCount: 0,
    actorsTruncated: false,
    scenes: [],
    scenesCount: 0,
    scenesTruncated: false,
    activeScene: false
  };
  if (plan.type === "Actor") {
    for (const doc of plan.deletedDocs) {
      const references = findActorTokenReferences(doc.id);
      if (references.length === 0) {
        continue;
      }
      violations.actorsCount += 1;
      if (violations.actors.length < FOLDER_DELETE_ID_CAP) {
        violations.actors.push({
          actorId: doc.id,
          name: doc.name ?? null,
          tokenReferences: references.slice(0, FOLDER_DELETE_TOKEN_REFERENCE_CAP),
          tokenReferencesCount: references.length,
          tokenReferencesTruncated: references.length > FOLDER_DELETE_TOKEN_REFERENCE_CAP
        });
      }
    }
    violations.actorsTruncated = violations.actorsCount > violations.actors.length;
  } else if (plan.type === "Scene") {
    for (const doc of plan.deletedDocs) {
      if (!doc.active) {
        continue;
      }
      violations.scenesCount += 1;
      if (violations.scenes.length < FOLDER_DELETE_ID_CAP) {
        violations.scenes.push({ sceneId: doc.id, name: doc.name ?? null });
      }
    }
    violations.scenesTruncated = violations.scenesCount > violations.scenes.length;
  }
  violations.activeScene = violations.scenesCount > 0;
  return violations;
}

/**
 * @typedef {object} ReconcileResult
 * @property {boolean} complete
 * @property {boolean} folderGone
 * @property {string[]} foldersDeletedIds
 * @property {string[]} foldersRemainingIds
 * @property {string[]} contentsDeletedIds
 * @property {string[]} contentsRemainingIds
 * @property {string[]} foldersReparentedIds
 * @property {string[]} foldersNotReparentedIds
 * @property {string[]} contentsReparentedIds
 * @property {string[]} contentsNotReparentedIds
 */

/**
 * @param {any} folder
 * @param {any} plan
 * @param {{ deleteSubfolders: boolean, deleteContents: boolean, deleted: boolean, complete: boolean, reconciled?: ReconcileResult | null }} options
 */
function deleteResultBody(
  folder,
  plan,
  { deleteSubfolders, deleteContents, deleted, complete, reconciled = null }
) {
  const foldersDeletedIds = reconciled ? reconciled.foldersDeletedIds : plan.foldersDeletedIds;
  const contentsDeletedIds = reconciled ? reconciled.contentsDeletedIds : plan.contentsDeletedIds;
  const foldersReparentedIds = reconciled ? reconciled.foldersReparentedIds : plan.foldersReparentedIds;
  const contentsReparentedIds = reconciled ? reconciled.contentsReparentedIds : plan.contentsReparentedIds;
  const body = {
    id: folder.id,
    deleted,
    complete,
    deleteSubfolders,
    deleteContents,
    reparentedTo: plan.parentId,
    counts: {
      subfolders: { direct: plan.directChildCount, recursive: plan.recursiveSubfolderCount },
      contents: { direct: plan.directContentCount, recursive: plan.recursiveContentCount }
    },
    folders: {
      deleted: capIds(foldersDeletedIds),
      reparented: capIds(foldersReparentedIds)
    },
    contents: {
      deleted: capIds(contentsDeletedIds),
      reparented: capIds(contentsReparentedIds)
    }
  };

  if (
    reconciled &&
    (reconciled.foldersRemainingIds.length > 0 ||
      reconciled.contentsRemainingIds.length > 0 ||
      reconciled.foldersNotReparentedIds.length > 0 ||
      reconciled.contentsNotReparentedIds.length > 0)
  ) {
    body.remaining = {
      folders: capIds(reconciled.foldersRemainingIds),
      contents: capIds(reconciled.contentsRemainingIds),
      foldersNotReparented: capIds(reconciled.foldersNotReparentedIds),
      contentsNotReparented: capIds(reconciled.contentsNotReparentedIds)
    };
  }

  if (deleteContents) {
    body.guardViolations = enumerateGuardViolations(plan);
  }
  return body;
}

export function createFolderHandlers() {
  return {
    async "folder.list"(params) {
      const folders = Array.from(getFoldersCollection());

      const byType = params.type ? folders.filter((folder) => folder.type === params.type) : folders;
      const filtered = filterByName(byType, params.name);

      const { page, total, hasMore } = paginate(filtered, params);
      return {
        folders: page.map((folder) => serializeFolderSummary(folder)),
        total,
        hasMore
      };
    },

    async "folder.get"(params) {
      const folder = getFolderById(params.folderId);
      return {
        folder: serializeFolder(folder, folderCounts(folder))
      };
    },

    async "folder.create"(params) {
      return folderQueue.run(async () => {
        assertFolderCreateParentValid(params.data?.folder ?? null, params.data?.type ?? null);

        if (isDryRun(params)) {
          const preview = previewDocumentCreate(resolveFolderDocumentClass(), params.data);
          return dryRunResponse({ folder: serializeFolder(preview) });
        }

        const folder = await createFolder(params.data);
        return {
          folder: serializeFolder(folder, folderCounts(folder))
        };
      });
    },

    async "folder.update"(params) {
      return folderQueue.run(async () => {
        const folder = getFolderById(params.folderId);
        const patch = params.patch ?? {};

        if (Object.hasOwn(patch, "folder")) {
          assertFolderReparentValid(folder, patch.folder ?? null);
        }

        if (isDryRun(params)) {
          const preview = await previewDocumentUpdate(folder, patch);
          return dryRunResponse({ folder: serializeFolder(preview, folderCounts(folder)) });
        }

        const updated = await folder.update(patch, { diff: true, render: true });

        if (!updated) {
          let diff;
          let probeError = null;
          try {
            diff = await computeDocumentUpdateDiff(folder, patch);
          } catch (error) {
            probeError = /** @type {any} */ (error)?.message ?? String(error);
            diff = null;
          }
          if (diff === null || Object.keys(diff).length > 0) {
            const fields = (diff ? Object.keys(diff) : Object.keys(patch)).filter((key) => key !== "_id");
            throw createBridgeError(
              ERROR_CODES.INTERNAL_ERROR,
              `Folder ${folder.id} was NOT updated: Foundry resolved the update without applying it, which means a module's preUpdateFolder hook or a core _preUpdate refused the write, or the patch failed Foundry's own client-side validation (which Foundry reports only as a UI notification). The folder still holds its previous values for ${
                fields.join(", ") || "the requested fields"
              }. There is no override for a world-side veto — folder.update takes no force flag, and force would not help: disable the module that locks this folder (or edit it from the Foundry UI) and retry.`,
              {
                folderId: folder.id,
                fields,

                validationError: probeError
              }
            );
          }
        }

        return {
          folder: serializeFolder(folder, folderCounts(folder))
        };
      });
    },

    async "folder.delete"(params) {
      return folderQueue.run(async () => {
        const folder = getFolderById(params.folderId);
        const deleteSubfolders = params.deleteSubfolders === true;
        const deleteContents = params.deleteContents === true;
        const force = params.force === true;

        const plan = computeDeletePlan(folder, { deleteSubfolders, deleteContents });

        assertFolderDeleteCascadeSafe(folder, {
          deletedFolderIds: plan.foldersDeletedIds,
          reparentedFolderIds: plan.foldersReparentedIds,
          reparentedContentIds: plan.contentsReparentedIds
        });

        if (deleteContents) {
          if (plan.type === "Cards" && plan.deletedDocs.length > 0) {
            throw createBridgeError(
              ERROR_CODES.INVALID_PARAMS,
              "Refusing to delete the contents of a Cards folder: the core contents-delete bypasses each stack's card recall (cards would be destroyed instead of returned to their origin decks). Delete the stacks individually via cards.delete first, then delete the folder.",
              { folderId: folder.id, type: plan.type }
            );
          }

          if (!force) {
            const guardViolations = enumerateGuardViolations(plan);
            throw createBridgeError(
              ERROR_CODES.DELETE_FORBIDDEN,
              "Refusing to delete folder contents without force:true; deleting contents mass-deletes documents and bypasses the per-family delete guards (token-used actors, the active scene). Re-run folder.delete with force:true to delete the contents anyway.",
              {
                folderId: folder.id,
                type: plan.type,
                deletedDocumentCount: plan.contentsDeletedIds.length,
                guardViolations
              }
            );
          }
        }

        if (isDryRun(params)) {
          return dryRunResponse(
            deleteResultBody(folder, plan, {
              deleteSubfolders,
              deleteContents,
              deleted: false,
              complete: true
            })
          );
        }

        const folderId = folder.id;
        let deletedDocument = null;
        try {
          if (typeof folder.delete !== "function") {
            throw createBridgeError(
              ERROR_CODES.BRIDGE_NOT_READY,
              "Foundry Folder delete API is not available"
            );
          }

          deletedDocument = await runFolderContentCascade(plan, () =>
            folder.delete({ render: true, deleteSubfolders, deleteContents })
          );
        } catch (error) {
          const reconciled = reconcileDelete(folderId, plan);
          if (!observedAnyCommit(reconciled)) {
            throw error;
          }
          return deleteResultBody(folder, plan, {
            deleteSubfolders,
            deleteContents,
            deleted: reconciled.folderGone,
            complete: reconciled.complete,
            reconciled
          });
        }

        if (!deletedDocument) {
          const reconciled = reconcileDelete(folderId, plan);
          if (!observedAnyCommit(reconciled)) {
            throw createBridgeError(
              ERROR_CODES.INTERNAL_ERROR,
              `Folder ${folderId} was NOT deleted: Foundry resolved the delete without removing the document, which means a module's preDeleteFolder hook or a core _preDelete refused it. Nothing was deleted or re-parented. force:true does NOT override a world-side veto — disable the module that locks this folder (or delete it from the Foundry UI) and retry.`,
              { folderId, type: plan.type }
            );
          }
          return deleteResultBody(folder, plan, {
            deleteSubfolders,
            deleteContents,
            deleted: reconciled.folderGone,
            complete: reconciled.complete,
            reconciled
          });
        }

        return deleteResultBody(folder, plan, {
          deleteSubfolders,
          deleteContents,
          deleted: true,
          complete: true
        });
      });
    }
  };
}

/**
 * @param {string} folderId
 * @param {any} plan
 * @returns {ReconcileResult}
 */
function reconcileDelete(folderId, plan) {
  const folders = getFoldersCollection();
  const folderGone = !folders.get?.(folderId);

  const foldersDeletedIds = [];
  const foldersRemainingIds = [];
  for (const id of plan.foldersDeletedIds) {
    if (folders.get?.(id)) {
      foldersRemainingIds.push(id);
    } else {
      foldersDeletedIds.push(id);
    }
  }

  const contentsDeletedIds = [];
  const contentsRemainingIds = [];
  for (const id of plan.contentsDeletedIds) {
    if (documentStillExists(plan.type, id)) {
      contentsRemainingIds.push(id);
    } else {
      contentsDeletedIds.push(id);
    }
  }

  const foldersReparentedIds = [];
  const foldersNotReparentedIds = [];
  for (const id of plan.foldersReparentedIds) {
    const current = folders.get?.(id) ?? null;
    const landed =
      current != null &&
      folderParentId(current) === plan.parentId &&
      plan.folderPreviousParents?.get(id) !== plan.parentId;
    (landed ? foldersReparentedIds : foldersNotReparentedIds).push(id);
  }

  const contentsReparentedIds = [];
  const contentsNotReparentedIds = [];
  for (const id of plan.contentsReparentedIds) {
    const current = getWorldDocument(plan.type, id);
    const landed =
      current != null &&
      documentFolderId(current) === plan.parentId &&
      plan.contentPreviousParents?.get(id) !== plan.parentId;
    (landed ? contentsReparentedIds : contentsNotReparentedIds).push(id);
  }

  const complete =
    folderGone &&
    foldersRemainingIds.length === 0 &&
    contentsRemainingIds.length === 0 &&
    foldersNotReparentedIds.length === 0 &&
    contentsNotReparentedIds.length === 0;
  return {
    complete,
    folderGone,
    foldersDeletedIds,
    foldersRemainingIds,
    contentsDeletedIds,
    contentsRemainingIds,
    foldersReparentedIds,
    foldersNotReparentedIds,
    contentsReparentedIds,
    contentsNotReparentedIds
  };
}

/** @param {ReconcileResult} reconciled */
function observedAnyCommit(reconciled) {
  return (
    reconciled.folderGone ||
    reconciled.foldersDeletedIds.length > 0 ||
    reconciled.contentsDeletedIds.length > 0 ||
    reconciled.foldersReparentedIds.length > 0 ||
    reconciled.contentsReparentedIds.length > 0
  );
}

function getWorldDocument(type, id) {
  const game = globalThis.game;
  const collection = game?.collections?.get?.(type) ?? null;
  return collection?.get?.(id) ?? null;
}

function documentStillExists(type, id) {
  return Boolean(getWorldDocument(type, id));
}
