import { getScenesCollection } from "./game-collections.js";

export function findActorTokenReferences(actorId) {
  const references = [];
  for (const scene of getScenesCollection()) {
    const tokens = scene.tokens ? Array.from(scene.tokens) : [];
    for (const token of tokens) {
      const tokenActorId = token.actorId ?? token.actor?.id ?? null;
      if (tokenActorId === actorId) {
        references.push({ sceneId: scene.id ?? null, tokenId: token.id ?? null });
      }
    }
  }

  return references;
}
