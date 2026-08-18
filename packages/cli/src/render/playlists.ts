import { renderCompendiumSourceLines, renderOwnershipLines } from "./common.js";

export function renderPlaylistDetails(playlist: any) {
  const lines = [
    `id: ${playlist?.id}`,
    `name: ${playlist?.name}`,
    `mode: ${playlist?.mode ?? ""}`,
    `playing: ${String(Boolean(playlist?.playing))}`,
    `channel: ${playlist?.channel ?? ""}`,
    `sorting: ${playlist?.sorting ?? ""}`,
    `fade: ${playlist?.fade ?? ""}`,
    `seed: ${playlist?.seed ?? ""}`,
    `folder: ${playlist?.folder ?? ""}`,
    `sort: ${playlist?.sort ?? 0}`,
    `flags: ${JSON.stringify(playlist?.flags ?? {}, null, 2)}`,
    `sounds: ${playlist?.sounds?.length ?? 0}`
  ];
  lines.push(...renderCompendiumSourceLines(playlist));

  if (playlist && Object.hasOwn(playlist, "ownership")) {
    lines.push(...renderOwnershipLines(playlist.ownership));
  }
  return lines.join("\n");
}

export function renderPlaylistSoundDetails(sound: any) {
  return [
    `id: ${sound?.id}`,
    `name: ${sound?.name ?? ""}`,
    `path: ${sound?.path ?? ""}`,
    `channel: ${sound?.channel ?? ""}`,
    `playing: ${String(Boolean(sound?.playing))}`,
    `pausedTime: ${sound?.pausedTime ?? ""}`,
    `repeat: ${String(Boolean(sound?.repeat))}`,
    `volume: ${sound?.volume ?? ""}`,
    `fade: ${sound?.fade ?? ""}`,
    `sort: ${sound?.sort ?? 0}`,
    `duration: ${sound?.duration ?? ""}`
  ].join("\n");
}
