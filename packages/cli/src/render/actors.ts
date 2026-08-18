import { renderCompendiumSourceLines, renderOwnershipLines } from "./common.js";
import { renderItemSummaryLine } from "./items.js";

export function renderActorDetails(actor: any) {
  const items = Array.isArray(actor?.items) ? actor.items : [];
  const lines = [
    `id: ${actor?.id}`,
    `name: ${actor?.name}`,
    `type: ${actor?.type}`,
    `img: ${actor?.img ?? ""}`,
    `folder: ${actor?.folder ?? ""}`,
    `sort: ${actor?.sort ?? 0}`,
    `prototype token: ${JSON.stringify(actor?.prototypeToken ?? null)}`,
    `system: ${JSON.stringify(actor?.system ?? {}, null, 2)}`
  ];

  if (actor && Object.hasOwn(actor, "flags")) {
    lines.push(`flags: ${JSON.stringify(actor.flags ?? {}, null, 2)}`);
  }
  if (actor && Object.hasOwn(actor, "effects")) {
    lines.push(`effects: ${JSON.stringify(actor.effects ?? [], null, 2)}`);
  }
  lines.push(...renderCompendiumSourceLines(actor));

  if (actor && Object.hasOwn(actor, "ownership")) {
    lines.push(...renderOwnershipLines(actor.ownership));
  }

  if (actor && Object.hasOwn(actor, "prepared")) {
    lines.push(`prepared: ${Object.keys(actor.prepared ?? {}).join(", ")} (use --json for values)`);
  }

  lines.push(`items: ${items.length}`);

  items.forEach((item: any) => {
    lines.push(`item: ${renderItemSummaryLine(item)}`);
  });

  return lines.join("\n");
}
