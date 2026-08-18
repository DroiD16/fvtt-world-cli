const OWNERSHIP_LEVEL_LABELS: Record<string, string> = {
  "-1": "inherit",
  "0": "none",
  "1": "limited",
  "2": "observer",
  "3": "owner"
};

export function renderCompendiumSourceLines(document: any): string[] {
  return document?.compendiumSource ? [`compendiumSource: ${document.compendiumSource}`] : [];
}

export function renderOwnershipLines(ownership: any): string[] {
  if (!ownership || typeof ownership !== "object") {
    return ["ownership: (none)"];
  }
  const entries = Object.entries(ownership);
  if (entries.length === 0) {
    return ["ownership: (none)"];
  }
  return [
    "ownership:",
    ...entries.map(([who, level]) => `  ${who}: ${level} (${OWNERSHIP_LEVEL_LABELS[String(level)] ?? "?"})`)
  ];
}

export function batchOwnershipLines(doc: any): string[] {
  if (!doc || !Object.hasOwn(doc, "ownership")) {
    return [];
  }
  return renderOwnershipLines(doc.ownership).map((line) => `  ${line}`);
}

export function renderOwnershipSetResult(noun: string, doc: any): string {
  const lines = [
    `Ownership updated: ${noun} ${doc?.id ?? ""}${doc?.name ? ` (${doc.name})` : ""}`,
    ...renderOwnershipLines(doc?.ownership)
  ];
  if (Array.isArray(doc?.pages)) {
    for (const page of doc.pages) {
      if (page?.ownership && Object.keys(page.ownership).length > 0) {
        lines.push(`page ${page.id}${page.name ? ` (${page.name})` : ""}:`);
        lines.push(...renderOwnershipLines(page.ownership).map((line) => `  ${line}`));
      }
    }
  }
  return lines.join("\n");
}

export function renderBatchWriteResult(commandName: string, result: any) {
  const outcomes: any[] = Array.isArray(result?.outcomes) ? result.outcomes : [];
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    counts.set(outcome?.status, (counts.get(outcome?.status) ?? 0) + 1);
  }
  const summary = [...counts.entries()].map(([status, count]) => `${status}: ${count}`).join(", ");

  const scope = typeof result?.sceneId === "string" ? ` (scene: ${result.sceneId})` : "";

  const tokenSide: string[] = [];
  if (typeof result?.mutatesWorldActor === "boolean") {
    tokenSide.push(
      `mutatesWorldActor: ${String(result.mutatesWorldActor)} (actorLink: ${String(Boolean(result.actorLink))})`
    );
  }
  if (result?.nonDurable === true && typeof result?.warning === "string") {
    tokenSide.push(`WARNING: ${result.warning}`);
  }
  return [
    `${result?.dryRun ? "[dry-run] " : ""}${commandName} — ${outcomes.length} element(s)${scope}`,
    `complete: ${String(result?.complete)}`,
    ...tokenSide,
    summary ? `outcomes — ${summary}` : "outcomes — (none)",
    ...outcomes.map((outcome: any) => {
      const named = outcome && typeof outcome === "object" && "name" in outcome;
      return (
        `${outcome?.index}\t${outcome?.id ?? "(no id)"}\t${outcome?.status}` +
        (named ? `\t${outcome.name ?? "(no name)"}` : "")
      );
    }),
    ...(result?.failure ? [`failure: ${result.failure.code} — ${result.failure.message}`] : [])
  ].join("\n");
}

export function humanCell(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function listFooterLines(result: any, shown: number, offset = 0): string[] {
  if (typeof result?.total !== "number") {
    return [];
  }

  const lines = [`showing ${shown} of ${result.total}`];
  if (result.hasMore) {
    lines.push(`(more: use --offset ${offset + shown})`);
  }
  return lines;
}
