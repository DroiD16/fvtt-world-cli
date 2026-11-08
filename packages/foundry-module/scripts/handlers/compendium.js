import { BATCH_GET_MAX_IDS, ERROR_CODES } from "../generated/protocol.js";
import {
  getCompendiumDocument,
  getCompendiumDocuments,
  getCompendiumPack,
  getCompendiumPacks
} from "../lib/compendium.js";
import { createBridgeError } from "../lib/errors.js";
import {
  cloneValue,
  filterByName,
  paginate,
  provenanceFields,
  serializeCompendiumEffect,
  serializeCompendiumIndexEntry,
  serializeCompendiumPack
} from "../lib/serializers.js";

/**
 * @param {string} pack
 * @param {string} entryId
 * @param {any} document
 * @param {string[] | undefined} include
 */
function serializeCompendiumEntry(pack, entryId, document, include) {
  const source = typeof document.toObject === "function" ? document.toObject() : document;
  const wantEffects = Array.isArray(include) && include.includes("effects");
  return {
    pack,
    entryId,
    documentName: document.documentName ?? null,
    document: { ...cloneValue(source), id: source._id ?? null, ...provenanceFields(source) },
    ...(wantEffects
      ? { effects: Array.isArray(source.effects) ? source.effects.map(serializeCompendiumEffect) : [] }
      : {})
  };
}

export function createCompendiumHandlers() {
  return {
    async "compendium.list"(params) {
      const packs = Array.from(getCompendiumPacks());
      const { page, total, hasMore } = paginate(packs, params);
      return {
        packs: page.map((pack) => serializeCompendiumPack(pack)),
        total,
        hasMore
      };
    },

    async "compendium.index"(params) {
      const pack = getCompendiumPack(params.pack);

      const index = await pack.getIndex(
        Array.isArray(params.fields) && params.fields.length ? { fields: params.fields } : undefined
      );
      const entries = filterByName(Array.from(index ?? []), params.name, { exact: params.exact });
      const { page, total, hasMore } = paginate(entries, params);
      return {
        pack: params.pack,
        type: pack.documentName ?? null,
        entries: page.map((entry) => serializeCompendiumIndexEntry(entry, { fields: params.fields })),
        total,
        hasMore
      };
    },

    async "compendium.get"(params) {
      const document = await getCompendiumDocument(params.pack, params.entryId);
      return serializeCompendiumEntry(params.pack, params.entryId, document, params.include);
    },

    async "compendium.get-many"(params) {
      if (params.ids.length > BATCH_GET_MAX_IDS) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `compendium.get-many accepts at most ${BATCH_GET_MAX_IDS} ids`,
          { max: BATCH_GET_MAX_IDS, received: params.ids.length }
        );
      }

      const documents = await getCompendiumDocuments(params.pack, [...new Set(params.ids)]);
      return {
        pack: params.pack,
        entries: params.ids.map((id) =>
          serializeCompendiumEntry(params.pack, id, documents.get(id), params.include)
        )
      };
    }
  };
}
