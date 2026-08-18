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
import { filterByName, serializeToken, serializeTokenSummary, tokenName } from "../lib/serializers.js";
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
      serializeSummary: (document) => serializeTokenSummary(document),
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
