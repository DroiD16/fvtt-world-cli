import { renderCompendiumSourceLines, renderOwnershipLines } from "./common.js";

export function renderItemSummaryLine(item: any, { suppressBody = false }: { suppressBody?: boolean } = {}) {
  const lines = [
    `${item.id}\t${item.name}\t${item.type}\teffects=${item.effectCount ?? item.effects?.length ?? "?"}`
  ];

  if (suppressBody) {
    return lines.join("\n");
  }

  if (item && Object.hasOwn(item, "flags")) {
    lines.push(`  flags: ${JSON.stringify(item.flags ?? {})}`);
  }
  if (item && Object.hasOwn(item, "effects")) {
    lines.push(`  effects: ${JSON.stringify(item.effects ?? [])}`);
  }
  return lines.join("\n");
}

export function renderItemDetails(item: any, prefixLines: string[] = []) {
  const lines = [
    ...prefixLines,
    `id: ${item?.id}`,
    `name: ${item?.name}`,
    `type: ${item?.type}`,
    `img: ${item?.img ?? ""}`,
    `folder: ${item?.folder ?? ""}`,
    `sort: ${item?.sort ?? 0}`,
    `system: ${JSON.stringify(item?.system ?? {}, null, 2)}`
  ];

  if (item && Object.hasOwn(item, "flags")) {
    lines.push(`flags: ${JSON.stringify(item.flags ?? {}, null, 2)}`);
  }
  if (item && Object.hasOwn(item, "effects")) {
    lines.push(`effects: ${JSON.stringify(item.effects ?? [], null, 2)}`);
  }
  lines.push(...renderCompendiumSourceLines(item));

  if (item && Object.hasOwn(item, "ownership")) {
    lines.push(...renderOwnershipLines(item.ownership));
  }
  return lines.join("\n");
}
