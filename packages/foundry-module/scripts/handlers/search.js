import {
  ERROR_CODES,
  SEARCH_MODES,
  SEARCH_QUERY_MIN_LENGTH,
  SEARCH_RESULT_DEFAULT_LIMIT
} from "../generated/protocol.js";
import { createBridgeError } from "../lib/errors.js";
import { paginate } from "../lib/pagination.js";
import { storedDocumentName } from "../lib/serializers.js";
import {
  SEARCH_DEFAULT_CAPS,
  SEARCH_TYPE_TEXT_FIELDS,
  buildCompendiumCorpus,
  buildSearchQueryOptions,
  buildWorldCorpus,
  compareSearchHits,
  createSearchState,
  ensureCorpus,
  invalidateOnPackSetChange,
  registerSearchInvalidation,
  resolvePackRef,
  resolveWorldRef,
  resultSource
} from "../lib/search-index.js";
import { buildSearchSnippet, extractDocumentText, foldSearchQueryTerms } from "../lib/search-text.js";
import { assertFoundryReady } from "../lib/validators.js";

const UNRESOLVED_REF = Object.freeze({ name: null, parents: Object.freeze([]), resolved: false });

/** @param {{ caps?: typeof SEARCH_DEFAULT_CAPS, hooks?: any }} [options] */
export function createSearchHandlers({ caps = SEARCH_DEFAULT_CAPS, hooks } = {}) {
  const state = createSearchState({ caps });

  let invalidationRegistered = false;
  const ensureInvalidationRegistered = () => {
    if (invalidationRegistered) {
      return;
    }
    invalidationRegistered = true;
    registerSearchInvalidation(state, { hooks });
  };

  return {
    async "world.search"(params) {
      const game = assertFoundryReady();
      ensureInvalidationRegistered();
      const mode = params.mode ?? SEARCH_MODES[0];
      const limit = params.limit ?? SEARCH_RESULT_DEFAULT_LIMIT;
      const offset = params.offset ?? 0;
      const includeCompendia = params.includeCompendia === true;
      const source = params.source ?? null;

      const types = Array.isArray(params.types) && params.types.length > 0 ? params.types : null;

      const queryTerms = foldSearchQueryTerms(params.query);

      const effectiveLength = queryTerms.reduce((total, term) => total + [...term].length, 0);
      if (effectiveLength < SEARCH_QUERY_MIN_LENGTH) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `query carries ${effectiveLength} searchable character(s) but at least ${SEARCH_QUERY_MIN_LENGTH} are required — separators and punctuation are not searchable content (they are what the query is split on), and a decomposed character counts once after NFC normalization; lengthen the query`,
          { effectiveLength, minimum: SEARCH_QUERY_MIN_LENGTH, terms: queryTerms.length }
        );
      }

      if (source === "pack" && !includeCompendia) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          'source:"pack" requires includeCompendia:true — the compendium corpus is explicit opt-in and this param will not enable it for you; pass both, or drop `source` to search the world',
          { source, includeCompendia }
        );
      }

      const queryWorld = source !== "pack";
      const queryPack = includeCompendia && source !== "world";

      const worldBuild = queryWorld
        ? await ensureCorpus(state.world, async () => buildWorldCorpus(game, state.world.caps))
        : null;

      if (queryPack) {
        invalidateOnPackSetChange(state.compendium, game);
      }
      const packBuild = queryPack
        ? await ensureCorpus(state.compendium, async () => buildCompendiumCorpus(game, state.compendium.caps))
        : null;

      const worldBlock = queryWorld ? corpusBlock(state.world, worldBuild) : null;
      const packBlock = queryPack ? corpusBlock(state.compendium, packBuild, { pack: true }) : null;
      const blocks = { world: worldBlock, compendium: packBlock };

      for (const [corpusName, corpus] of orderedCorpora(state, { queryWorld, queryPack })) {
        if (corpus.status === "overflow") {
          throw overflowError(corpusName, corpus, blocks);
        }
      }

      const queryOptions = buildSearchQueryOptions({ mode, types });
      const sections = [];
      if (worldBlock) {
        const hits = searchCorpus(state.world, params.query, queryOptions, "world");
        worldBlock.matchCount = hits.length;
        sections.push({ corpusName: "world", hits });
      }
      if (packBlock) {
        const hits = searchCorpus(state.compendium, params.query, queryOptions, "compendium");
        packBlock.matchCount = hits.length;
        sections.push({ corpusName: "compendium", hits });
      }

      for (const section of sections) {
        if (section.hits.length > state.maxMatches) {
          throw tooBroadError(section.corpusName, section.hits.length, state.maxMatches, blocks);
        }
      }

      const ordered = [];
      for (const section of sections) {
        ordered.push(...[...section.hits].sort(compareSearchHits));
      }

      const { page, total, hasMore } = paginate(ordered, { limit, offset });

      const snippetTerms = mode === "full" ? queryTerms : null;
      const result = {
        results: page.map((hit) => projectRef(game, hit, snippetTerms)),
        total,
        hasMore,
        mode,
        includeCompendia,

        source,
        index: blocks
      };

      const responseBytes = measureResponseBytes(result);
      if (responseBytes > state.maxResponseBytes) {
        throw createBridgeError(
          ERROR_CODES.PAYLOAD_TOO_LARGE,
          `world.search response is ${responseBytes} bytes, above the ${state.maxResponseBytes}-byte cap; lower --limit (or narrow the query with --types) and page through the results`,
          {
            limit: "response-bytes",
            cap: state.maxResponseBytes,
            observed: responseBytes,

            index: blocks
          }
        );
      }

      return result;
    }
  };
}

function orderedCorpora(state, { queryWorld, queryPack }) {
  const ordered = [];
  if (queryWorld) {
    ordered.push(["world", state.world]);
  }
  if (queryPack) {
    ordered.push(["compendium", state.compendium]);
  }
  return ordered;
}

function searchCorpus(corpus, query, queryOptions, corpusName) {
  if (!corpus.index) {
    throw createBridgeError(
      ERROR_CODES.INTERNAL_ERROR,
      `The ${corpusName} search corpus is not built; retry the search (the index rebuilds on demand)`,
      { corpus: corpusName }
    );
  }
  return corpus.index.search(query, queryOptions).map((hit) => ({
    refKey: hit.id,
    documentType: hit.documentType,
    score: hit.score,

    source: resultSource(corpusName)
  }));
}

function corpusBlock(corpus, build, { pack = false } = {}) {
  const block = {
    status: corpus.status,
    generation: corpus.builtGeneration,
    entryCount: corpus.stats.entryCount,
    indexedChars: corpus.stats.indexedChars,

    textTruncatedCount: corpus.stats.textTruncatedCount,
    builtThisCall: build?.builtThisCall === true,
    stale: corpus.builtGeneration !== corpus.dirtyGeneration,
    matchCount: 0
  };
  if (pack) {
    block.skippedPackCount = corpus.stats.skippedPackCount ?? 0;

    block.failedPackCount = corpus.stats.failedPackCount ?? 0;
  }
  return block;
}

function sourceEscapeFor(corpusName) {
  return corpusName === "compendium"
    ? 'exclude the compendium corpus with source:"world" (it is then not built and not queried, so the same query succeeds)'
    : 'exclude the world corpus with source:"pack" together with includeCompendia:true';
}

function overflowError(corpusName, corpus, blocks) {
  const { limit, basis, cap, observed } = corpus.overflow ?? {
    limit: "index-bytes",
    basis: "estimated",
    cap: 0,
    observed: 0
  };

  const outcome =
    basis === "measured"
      ? `so the completed index was discarded rather than published`
      : `so the build stopped rather than index part of the ${corpusName} corpus and report an exact total over it`;
  return createBridgeError(
    ERROR_CODES.SEARCH_INDEX_OVERFLOW,
    `The ${corpusName} search index exceeded its ${limit} cap (${cap}; observed ${observed}, ${basis}), ${outcome}. This state is cached until the next change to that corpus. Remedies: ${sourceEscapeFor(corpusName)}, or reduce the amount of indexable content`,
    {
      corpus: corpusName,
      limit,
      basis,
      cap,
      observed,

      index: blocks
    }
  );
}

function tooBroadError(corpusName, matchCount, cap, blocks) {
  return createBridgeError(
    ERROR_CODES.QUERY_TOO_BROAD,
    `The query matched ${matchCount} ${corpusName} entries, above the ${cap} cap; it is refused rather than answered with an inexact total. Remedies: add another term, narrow with --types (the filter is applied while matches are collected, so it really lowers this count), or ${sourceEscapeFor(corpusName)}`,
    {
      corpus: corpusName,
      matchCount,
      cap,
      limit: "match-count",
      index: blocks
    }
  );
}

function projectRef(game, hit, snippetTerms) {
  if (hit.source === "compendium") {
    const resolved = resolvePackRef(game, hit.refKey);
    const row = resolved?.row ?? null;
    return {
      refKey: hit.refKey,
      source: resultSource("compendium"),
      documentType: hit.documentType,
      id: resolved?.entryId ?? null,

      parents: [],
      pack: { id: resolved?.packId ?? null, label: resolved?.label ?? null },
      name: row ? (row.name ?? null) : null,
      resolved: Boolean(row),
      score: hit.score,
      snippet: null
    };
  }

  const resolved = resolveWorldRef(game, hit.refKey);
  if (!resolved) {
    return {
      refKey: hit.refKey,
      source: resultSource("world"),
      documentType: hit.documentType,

      id: hit.refKey.split(".").pop() ?? null,
      ...UNRESOLVED_REF,
      parents: [],
      pack: null,
      score: hit.score,
      snippet: null
    };
  }

  const name = storedDocumentName(resolved.document);
  return {
    refKey: hit.refKey,
    source: resultSource("world"),
    documentType: resolved.documentType,
    id: resolved.id,
    parents: resolved.parents,

    pack: null,
    name,
    resolved: true,
    score: hit.score,
    snippet: snippetTerms
      ? buildSearchSnippet(
          extractDocumentText(resolved.document, SEARCH_TYPE_TEXT_FIELDS[resolved.documentType] ?? []),
          name,
          snippetTerms
        )
      : null
  };
}

function measureResponseBytes(result) {
  const json = JSON.stringify(result);
  return typeof json === "string" ? new TextEncoder().encode(json).length : 0;
}
