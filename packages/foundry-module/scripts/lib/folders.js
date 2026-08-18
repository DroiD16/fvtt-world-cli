import { ERROR_CODES } from "../generated/protocol.js";
import { createBridgeError } from "./errors.js";

import { getFoldersCollection, getGame } from "./game-collections.js";

export function resolveFolderDocumentClass() {
  return getFoldersCollection().documentClass ?? globalThis.Folder;
}

export async function createFolder(data) {
  const FolderCtor = resolveFolderDocumentClass();
  if (!FolderCtor?.create) {
    throw createBridgeError(ERROR_CODES.BRIDGE_NOT_READY, "Foundry Folder document class is not available");
  }

  const folder = await FolderCtor.create(data, { render: true });
  if (!folder) {
    throw createBridgeError(ERROR_CODES.INTERNAL_ERROR, "Folder.create returned no document");
  }

  return folder;
}

export const FOLDER_MAX_DEPTH = 4;

export function getFolderById(folderId) {
  const folder = getFoldersCollection().get?.(folderId) ?? null;
  if (!folder) {
    throw createBridgeError(
      ERROR_CODES.FOLDER_NOT_FOUND,
      `Folder ${folderId} was not found; use folder.list to find valid ids`,
      { folderId }
    );
  }

  return folder;
}

function folderParentId(folder) {
  return folder?.folder?.id ?? folder?.folder ?? folder?.toObject?.().folder ?? null;
}

export function getFolderChildren(folderId) {
  const children = [];
  for (const folder of getFoldersCollection()) {
    if (folderParentId(folder) === folderId) {
      children.push(folder);
    }
  }
  return children;
}

export function getFolderDescendants(folderId) {
  const descendants = [];
  const visited = new Set([folderId]);
  let frontier = getFolderChildren(folderId);
  while (frontier.length) {
    const next = [];
    for (const folder of frontier) {
      const id = folder.id ?? folderParentId(folder);
      if (id != null && visited.has(id)) {
        continue;
      }
      if (id != null) {
        visited.add(id);
      }
      descendants.push(folder);
      next.push(...getFolderChildren(folder.id));
    }
    frontier = next;
  }
  return descendants;
}

export function getFolderTypeCollection(type) {
  const game = getGame();
  return game.collections?.get?.(type) ?? null;
}

export function getFolderDirectContents(folderId, type) {
  const collection = getFolderTypeCollection(type);
  if (!collection) {
    return [];
  }
  const contents = [];
  for (const doc of collection) {
    const docFolderId = doc.folder?.id ?? doc.folder ?? null;
    if (docFolderId === folderId) {
      contents.push(doc);
    }
  }
  return contents;
}

function parentChainWalk(newParentId) {
  if (newParentId == null) {
    return { count: 0, chain: [], cycleAt: null };
  }
  let count = 1;
  const chain = [newParentId];
  const visited = new Set([newParentId]);
  let current = getFoldersCollection().get?.(newParentId) ?? null;
  let parentId = current ? folderParentId(current) : null;
  while (parentId != null) {
    if (visited.has(parentId)) {
      return { count, chain, cycleAt: parentId };
    }
    visited.add(parentId);
    chain.push(parentId);
    count += 1;
    current = getFoldersCollection().get?.(parentId) ?? null;
    parentId = current ? folderParentId(current) : null;
  }
  return { count, chain, cycleAt: null };
}

function isFolderCycleMember(folder) {
  const selfId = folder?.id ?? null;
  if (selfId == null) {
    return false;
  }
  const visited = new Set([selfId]);
  let parentId = folderParentId(folder);
  while (parentId != null) {
    if (parentId === selfId) {
      return true;
    }
    if (visited.has(parentId)) {
      return false;
    }
    visited.add(parentId);
    const current = getFoldersCollection().get?.(parentId) ?? null;
    parentId = current ? folderParentId(current) : null;
  }
  return false;
}

const FOLDER_CYCLE_ID_CAP = 100;

const FOLDER_CYCLE_MESSAGE_ID_CAP = 10;

/**
 * @param {{ count: number, chain: string[], cycleAt: string | null }} walk
 * @returns {{ cycleAt: string, cycle: string[], cycleTruncated: boolean, cycleLabel: string }}
 */
function describeParentChainCycle(walk) {
  const cycleAt = /** @type {string} */ (walk.cycleAt);
  const fullCycle = [...walk.chain.slice(walk.chain.indexOf(cycleAt)), cycleAt];
  const cycle = fullCycle.slice(0, FOLDER_CYCLE_ID_CAP);
  const shown = fullCycle.slice(0, FOLDER_CYCLE_MESSAGE_ID_CAP);
  return {
    cycleAt,
    cycle,
    cycleTruncated: fullCycle.length > cycle.length,
    cycleLabel:
      shown.join(" -> ") +
      (fullCycle.length > shown.length ? ` -> … (+${fullCycle.length - shown.length} more)` : "")
  };
}

function assertParentChainAcyclic(parentId, details = {}) {
  const walk = parentChainWalk(parentId);
  if (walk.cycleAt == null) {
    return walk.count;
  }
  const { cycle, cycleAt, cycleTruncated, cycleLabel } = describeParentChainCycle(walk);
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `Folder ${parentId} sits in a CYCLIC parent chain (${cycleLabel}); refusing to nest anything under it. ` +
      `Foundry's server-side folder create walks the parent chain without a cycle guard, so this request would loop ` +
      `over the folder store indefinitely and never return a result. Break the cycle first by clearing the parent of ` +
      `${cycleAt} (protocol: folder.update with patch.folder = null; CLI: ` +
      `fvtt-world-cli folder update --folder-id ${cycleAt} --clear-folder), then retry. That move is exempt from the ` +
      `folder-depth limit precisely so it always remains available.`,
    { ...details, folder: parentId, cycleAt, cycle, cycleTruncated }
  );
}

function subtreeHeight(folder) {
  const rootId = folder.id;
  const byId = new Map();
  for (const d of getFolderDescendants(rootId)) {
    byId.set(d.id, d);
  }
  let height = 0;
  for (const d of byId.values()) {
    let depth = 0;
    let cursor = d;
    const visited = new Set();
    while (cursor && cursor.id !== rootId) {
      if (visited.has(cursor.id)) {
        depth = -1;
        break;
      }
      visited.add(cursor.id);
      depth += 1;
      const pid = folderParentId(cursor);
      cursor = pid != null ? (getFoldersCollection().get?.(pid) ?? null) : null;
      if (!cursor) {
        depth = -1;
        break;
      }
    }
    if (depth > height) {
      height = depth;
    }
  }
  return height;
}

export function assertFolderCreateParentValid(parentId, folderType = null) {
  if (parentId == null) {
    return;
  }

  const parent = getFoldersCollection().get?.(parentId) ?? null;
  if (!parent) {
    throw createBridgeError(
      ERROR_CODES.FOLDER_NOT_FOUND,
      `Parent folder ${parentId} was not found; use folder.list to find valid ids`,
      { folder: parentId }
    );
  }

  const parentType = parent.type ?? parent.toObject?.().type ?? null;
  if (folderType != null && parentType !== folderType) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `Cannot create a ${folderType} folder under a ${parentType} folder; a folder's parent must hold the same document type`,
      { folder: parentId, folderType, parentType }
    );
  }

  if (assertParentChainAcyclic(parentId, { folderType, parentType }) >= FOLDER_MAX_DEPTH) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `Creating a folder under ${parentId} would nest folders more than ${FOLDER_MAX_DEPTH} levels deep`,
      { folder: parentId, maxDepth: FOLDER_MAX_DEPTH }
    );
  }
}

export function assertFolderReparentValid(folder, newParentId) {
  if (newParentId == null) {
    if (isFolderCycleMember(folder)) {
      return;
    }

    if (subtreeHeight(folder) >= FOLDER_MAX_DEPTH) {
      throw createBridgeError(
        ERROR_CODES.INVALID_PARAMS,
        `Reparenting folder ${folder.id} to the root would exceed the maximum folder depth of ${FOLDER_MAX_DEPTH}`,
        { folderId: folder.id, folder: null, maxDepth: FOLDER_MAX_DEPTH }
      );
    }
    return;
  }

  if (newParentId === folder.id) {
    throw createBridgeError(ERROR_CODES.INVALID_PARAMS, "A folder cannot be its own parent", {
      folderId: folder.id,
      folder: newParentId
    });
  }

  const newParent = getFoldersCollection().get?.(newParentId) ?? null;
  if (!newParent) {
    throw createBridgeError(
      ERROR_CODES.FOLDER_NOT_FOUND,
      `Parent folder ${newParentId} was not found; use folder.list to find valid ids`,
      { folderId: folder.id, folder: newParentId }
    );
  }

  const folderType = folder.type ?? folder.toObject?.().type ?? null;
  const parentType = newParent.type ?? newParent.toObject?.().type ?? null;
  if (folderType !== parentType) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `Cannot reparent a ${folderType} folder under a ${parentType} folder; a folder's parent must hold the same document type`,
      { folderId: folder.id, folder: newParentId, folderType, parentType }
    );
  }

  const descendantIds = new Set(getFolderDescendants(folder.id).map((d) => d.id));
  if (descendantIds.has(newParentId)) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `Cannot reparent folder ${folder.id} under its own descendant ${newParentId}; that would create a cycle`,
      { folderId: folder.id, folder: newParentId }
    );
  }

  const resultingDepth =
    assertParentChainAcyclic(newParentId, { folderId: folder.id }) + subtreeHeight(folder);
  if (resultingDepth >= FOLDER_MAX_DEPTH) {
    throw createBridgeError(
      ERROR_CODES.INVALID_PARAMS,
      `Reparenting folder ${folder.id} under ${newParentId} would nest folders more than ${FOLDER_MAX_DEPTH} levels deep`,
      { folderId: folder.id, folder: newParentId, maxDepth: FOLDER_MAX_DEPTH }
    );
  }
}

/**
 * @param {any} folder
 * @param {{ deletedFolderIds?: string[], reparentedFolderIds?: string[], reparentedContentIds?: string[] }} plan
 */
export function assertFolderDeleteCascadeSafe(
  folder,
  { deletedFolderIds = [], reparentedFolderIds = [], reparentedContentIds = [] } = {}
) {
  if (!isFolderCycleMember(folder)) {
    return;
  }
  const parentId = folderParentId(folder);
  if (parentId == null) {
    return;
  }
  const reparentedFolderCount = reparentedFolderIds.length;
  const reparentedContentCount = reparentedContentIds.length;
  if (reparentedFolderCount + reparentedContentCount === 0) {
    return;
  }

  const reparentTargetDeleted = parentId === folder.id || deletedFolderIds.includes(parentId);

  const reparentedLabel = [
    reparentedFolderCount > 0 ? `${reparentedFolderCount} subfolder(s)` : null,
    reparentedContentCount > 0 ? `${reparentedContentCount} document(s)` : null
  ]
    .filter((part) => part != null)
    .join(" and ");

  const { cycle, cycleAt, cycleTruncated, cycleLabel } = describeParentChainCycle(parentChainWalk(parentId));
  throw createBridgeError(
    ERROR_CODES.INVALID_PARAMS,
    `Folder ${folder.id} sits in a CYCLIC parent chain (${cycleLabel}); refusing to delete it with this cascade. ` +
      `Foundry re-parents everything this cascade does not delete onto this folder's own parent ${cycleAt} — and ` +
      `${cycleAt} is itself inside the loop. ` +
      (reparentTargetDeleted
        ? `${
            parentId === folder.id
              ? "That parent IS this folder"
              : `${cycleAt} is DELETED by this same operation`
          }, so the ${reparentedLabel} it re-parents would be left pointing at a folder id that no longer exists — a ` +
          `DANGLING reference this delete would report as a successful re-parent. `
        : `That would leave ${cycleAt} SELF-PARENTED, i.e. trading one corrupt chain for another while the delete ` +
          `reports success. `) +
      `Break the loop first by clearing this folder's parent (protocol: folder.update with patch.folder = null; ` +
      `CLI: fvtt-world-cli folder update --folder-id ${folder.id} --clear-folder — exempt from the folder-depth limit ` +
      `precisely so it always remains available) and then re-run this delete, which re-parents everything to the ` +
      `ROOT. Turning a re-parented category into a DELETED one also clears this refusal ` +
      `(deleteSubfolders:true / --delete-subfolders for the subfolders, deleteContents:true + force:true / ` +
      `--delete-contents --force for the documents), but only when it leaves NOTHING to re-parent at all — the ` +
      `clear-folder repair above always works. force:true does NOT override this — it is a data-integrity guard, ` +
      `not a permission gate.`,
    {
      folderId: folder.id,
      reparentedTo: parentId,
      reparentTargetDeleted,
      reparentedFolderCount,
      reparentedContentCount,
      cycleAt,
      cycle,
      cycleTruncated
    }
  );
}
