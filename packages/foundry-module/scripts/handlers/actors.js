import { BATCH_GET_MAX_IDS, ERROR_CODES } from "../generated/protocol.js";
import { findActorTokenReferences } from "../lib/actor-references.js";
import { getActorById, getActorsCollection } from "../lib/game-collections.js";
import {
  cloneDocument,
  createActor,
  deleteDocument,
  previewDocumentUpdate,
  previewWorldActorCreate
} from "../lib/world-docs.js";
import { createBridgeError } from "../lib/errors.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { canonicalizeFilePathFields } from "../lib/file-access.js";
import {
  filterByName,
  paginate,
  serializeActor,
  serializeActorSummary,
  worldDocumentName
} from "../lib/serializers.js";
import { createWorldDocumentBatchHandlers } from "./world-doc-batch.js";

function assertActorDeletableForBatch(actor, index, params) {
  const actorId = actor?.id ?? null;
  const references = findActorTokenReferences(actorId);
  if (references.length > 0 && params.force !== true) {
    throw createBridgeError(
      ERROR_CODES.DELETE_FORBIDDEN,
      `actor.delete-many element ${index} (actor ${actorId}) is referenced by tokens (deleting it would orphan them); re-run actor.delete-many with force:true to delete it anyway. Nothing was written.`,
      { index, actorId, tokenReferences: references }
    );
  }
}

export function createActorHandlers() {
  return {
    ...createWorldDocumentBatchHandlers({
      prefix: "actor",
      documentName: "Actor",

      label: "actor",
      resolve: (id) => getActorById(id),

      prepareUpdate: (patch) => canonicalizeFilePathFields(patch, "Actor"),
      assertDeletable: assertActorDeletableForBatch,
      summarize: (document) => ({ name: document ? worldDocumentName(document) : null })
    }),

    async "actor.list"(params) {
      const actors = filterByName(Array.from(getActorsCollection()), params.name);
      const { page, total, hasMore } = paginate(actors, params);
      return {
        actors: page.map((actor) => serializeActorSummary(actor)),
        total,
        hasMore
      };
    },

    async "actor.get"(params) {
      const actor = getActorById(params.actorId);
      return {
        actor: serializeActor(actor, { include: params.include, ownership: true })
      };
    },

    async "actor.get-many"(params) {
      const ids = params.ids;
      if (ids.length > BATCH_GET_MAX_IDS) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `actor.get-many accepts at most ${BATCH_GET_MAX_IDS} ids`,
          { max: BATCH_GET_MAX_IDS, received: ids.length }
        );
      }

      const actors = ids.map((id) =>
        serializeActor(getActorById(id), { include: params.include, ownership: true })
      );
      return { actors };
    },

    async "actor.create"(params) {
      const data = canonicalizeFilePathFields(params.data, "Actor");
      if (isDryRun(params)) {
        const preview = previewWorldActorCreate(data);
        return dryRunResponse({ actor: serializeActor(preview, { include: params.include }) });
      }

      const actor = await createActor(data);
      return {
        actor: serializeActor(actor, { include: params.include })
      };
    },

    async "actor.update"(params) {
      const actor = getActorById(params.actorId);
      const patch = canonicalizeFilePathFields(params.patch, "Actor");
      if (isDryRun(params)) {
        const preview = await previewDocumentUpdate(actor, patch);
        return dryRunResponse({ actor: serializeActor(preview, { include: params.include }) });
      }

      await actor.update(patch, { diff: true, render: true });
      return {
        actor: serializeActor(actor, { include: params.include })
      };
    },

    async "actor.clone"(params) {
      const actor = getActorById(params.actorId);
      const patch = canonicalizeFilePathFields(params.patch, "Actor");
      const clone = await cloneDocument(actor, patch ?? {}, { dryRun: isDryRun(params) });
      const result = { actor: serializeActor(clone) };
      return isDryRun(params) ? dryRunResponse(result) : result;
    },

    async "actor.delete"(params) {
      const actor = getActorById(params.actorId);

      const references = findActorTokenReferences(params.actorId);
      if (references.length > 0 && params.force !== true) {
        throw createBridgeError(
          ERROR_CODES.DELETE_FORBIDDEN,
          "Refusing to delete an actor referenced by tokens (deleting it would orphan them); re-run actor.delete with force:true to delete it anyway",
          { actorId: params.actorId, tokenReferences: references }
        );
      }

      const id = actor.id ?? params.actorId;
      if (isDryRun(params)) {
        return dryRunResponse({ id, deleted: false, tokenReferences: references });
      }

      await deleteDocument(actor);
      return {
        id,
        deleted: true,
        tokenReferences: references
      };
    }
  };
}
