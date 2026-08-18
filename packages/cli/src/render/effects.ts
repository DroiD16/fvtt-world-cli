export function renderEffectSummaryLine(effect: any) {
  return `${effect.id}\t${effect.name}\tdisabled=${String(Boolean(effect.disabled))}\ttransfer=${String(Boolean(effect.transfer))}\tchanges=${effect.changeCount ?? "?"}`;
}

export function renderEffectDetails(effect: any, prefixLines: string[] = []) {
  return [
    ...prefixLines,
    `id: ${effect?.id}`,
    `name: ${effect?.name}`,
    `type: ${effect?.type ?? ""}`,
    `img: ${effect?.img ?? ""}`,

    `transfer: ${String(Boolean(effect?.transfer))}`,
    `origin: ${effect?.origin ?? ""}`,
    `disabled: ${String(Boolean(effect?.disabled))}`,
    `statuses: ${JSON.stringify(effect?.statuses ?? [])}`,
    `duration: ${JSON.stringify(effect?.duration ?? null)}`,
    `changes: ${JSON.stringify(effect?.changes ?? [], null, 2)}`,
    `system: ${JSON.stringify(effect?.system ?? {}, null, 2)}`
  ].join("\n");
}

export function renderAppliedEffectLine(effect: any) {
  return `${effect.id}\t${effect.name}\tactive=${String(Boolean(effect.active))}\t${effect.parentType ?? "?"}:${effect.parentId ?? "-"}\tsrc=${effect.sourceName ?? ""}\tchanges=${effect.changeCount ?? "?"}`;
}

export function effectListPrefix(command: string, result: any): string[] {
  if (command.startsWith("scene.token.item.effect.")) {
    return [
      `scene: ${result.sceneId ?? "unknown"}`,
      `token: ${result.tokenId ?? "unknown"}`,
      `item: ${result.itemId ?? "unknown"}`
    ];
  }
  if (command.startsWith("scene.token.effect.")) {
    return [`scene: ${result.sceneId ?? "unknown"}`, `token: ${result.tokenId ?? "unknown"}`];
  }
  if (command.startsWith("actor.item.effect.")) {
    return [`actor: ${result.actorId ?? "unknown"}`, `item: ${result.itemId ?? "unknown"}`];
  }
  if (command.startsWith("item.effect.")) {
    return [`item: ${result.itemId ?? "unknown"}`];
  }
  return [`actor: ${result.actorId ?? "unknown"}`];
}
