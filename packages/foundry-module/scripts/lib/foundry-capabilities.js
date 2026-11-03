/** @returns {number | null} */
export function getFoundryGeneration() {
  const generation = globalThis.game?.release?.generation;
  return typeof generation === "number" ? generation : null;
}

export function hasSceneLevels() {
  const generation = getFoundryGeneration();
  return generation !== null && generation >= 14;
}
