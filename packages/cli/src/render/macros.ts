import { renderCompendiumSourceLines, renderOwnershipLines } from "./common.js";

export function renderMacroDetails(macro: any) {
  const lines = [
    `id: ${macro?.id}`,
    `name: ${macro?.name}`,
    `type: ${macro?.type ?? ""}`,
    `scope: ${macro?.scope ?? ""}`,
    `img: ${macro?.img ?? ""}`,
    `folder: ${macro?.folder ?? ""}`,
    `flags: ${JSON.stringify(macro?.flags ?? {}, null, 2)}`,
    `command: ${macro?.command ?? ""}`
  ];
  lines.push(...renderCompendiumSourceLines(macro));

  if (macro && Object.hasOwn(macro, "ownership")) {
    lines.push(...renderOwnershipLines(macro.ownership));
  }
  return lines.join("\n");
}
