import { getCompendiumDocument, getCompendiumPack, getCompendiumPacks } from "../lib/compendium.js";
import {
  cloneValue,
  filterByName,
  paginate,
  serializeCompendiumEffect,
  serializeCompendiumIndexEntry,
  serializeCompendiumPack
} from "../lib/serializers.js";

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

      const source = typeof document.toObject === "function" ? document.toObject() : document;

      const wantEffects = Array.isArray(params.include) && params.include.includes("effects");
      const effects = wantEffects
        ? Array.isArray(source.effects)
          ? source.effects.map(serializeCompendiumEffect)
          : []
        : undefined;
      return {
        pack: params.pack,
        entryId: params.entryId,
        documentName: document.documentName ?? null,
        document: cloneValue(source),
        ...(wantEffects ? { effects } : {})
      };
    }
  };
}
