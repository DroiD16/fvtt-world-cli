import { ERROR_CODES } from "../generated/protocol.js";
import { getSceneById } from "../lib/game-collections.js";
import {
  createSceneEmbedded,
  getSceneEmbeddedById,
  prepareSceneEmbeddedCreateData,
  previewSceneEmbeddedCreate,
  resolveSceneTokenCreateData
} from "../lib/scene-embedded.js";
import { dryRunResponse, isDryRun } from "../lib/dry-run.js";
import { getSceneTokenActor } from "../lib/embedded-items.js";
import { createBridgeError } from "../lib/errors.js";
import { buildMismatchReport, createMismatchError } from "../lib/mismatch-report.js";
import {
  filterByName,
  serializeToken,
  serializeTokenSummary,
  storedTokenDelta,
  summarizeTokenDelta,
  tokenName
} from "../lib/serializers.js";
import { createScenePlaceableHandlers } from "./scene-placeables.js";

const TOKEN = "Token";

export function createSceneTokenHandlers() {
  return {
    ...createScenePlaceableHandlers({
      type: TOKEN,
      prefix: "scene.token",
      idField: "tokenId",
      resultKey: "token",
      pluralKey: "tokens",
      notFoundCode: ERROR_CODES.TOKEN_NOT_FOUND,
      serialize: (document) => serializeToken(document),
      serializeSummary: (document, params) => serializeTokenSummary(document, { include: params?.include }),
      listFilter: (tokens, params) => filterByName(tokens, params.name),

      prepareCreate: async (data, scene) =>
        prepareSceneEmbeddedCreateData(TOKEN, await resolveSceneTokenCreateData(data, scene)),

      summarize: (document) => ({ name: tokenName(document) }),
      omitVerbs: ["get", "create"]
    }),

    async "scene.token.get"(params) {
      const { document } = getSceneEmbeddedById(
        params.sceneId,
        TOKEN,
        params.tokenId,
        ERROR_CODES.TOKEN_NOT_FOUND,
        "tokenId"
      );
      return {
        sceneId: params.sceneId,
        token: serializeToken(document, { include: params.include })
      };
    },

    async "scene.token.restore-delta"(params) {
      const { token } = getSceneTokenActor(params.sceneId, params.tokenId);
      const tokenId = params.tokenId;
      if (token.actorLink) {
        throw createBridgeError(
          ERROR_CODES.INVALID_PARAMS,
          `Token ${tokenId} is linked to its actor, so it holds no token-level overrides to restore; edits to a linked token's items and data already go to the world actor`,
          { sceneId: params.sceneId, tokenId, actorLink: true }
        );
      }

      const discarded = summarizeTokenDelta(storedTokenDelta(token));
      if (!discarded) {
        const result = { sceneId: params.sceneId, tokenId, changed: false, discarded: null };
        return isDryRun(params) ? dryRunResponse(result) : result;
      }

      if (isDryRun(params)) {
        return dryRunResponse({ sceneId: params.sceneId, tokenId, changed: true, discarded });
      }

      await token.delta.restore();
      const { document: stored } = getSceneEmbeddedById(
        params.sceneId,
        TOKEN,
        tokenId,
        ERROR_CODES.TOKEN_NOT_FOUND,
        "tokenId"
      );
      const remaining = storedTokenDelta(stored);
      const left = summarizeTokenDelta(remaining);
      if (left) {
        throw createMismatchError({
          subject: `Token ${tokenId}`,
          report: buildMismatchReport(
            left.overriddenKeys.map((key) => {
              const value = remaining?.[key];
              return {
                segments: ["delta", key],
                requested: Array.isArray(value) ? [] : value !== null && typeof value === "object" ? {} : null
              };
            }),
            { delta: remaining }
          ),
          details: { sceneId: params.sceneId, tokenId }
        });
      }

      return { sceneId: params.sceneId, tokenId, changed: true, discarded };
    },

    async "scene.token.create"(params) {
      const scene = getSceneById(params.sceneId);

      const tokenData = await resolveSceneTokenCreateData(params.data, scene);

      const token = await createSceneEmbedded(scene, TOKEN, tokenData, { dryRun: isDryRun(params) });
      const result = { sceneId: params.sceneId, token: serializeToken(token) };
      if (isDryRun(params)) {
        const preview = previewSceneEmbeddedCreate(scene, TOKEN, tokenData);
        return dryRunResponse({ ...result, token: serializeToken(preview) });
      }
      return result;
    }
  };
}
