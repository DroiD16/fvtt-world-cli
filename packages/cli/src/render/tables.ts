import { renderCompendiumSourceLines, renderOwnershipLines } from "./common.js";

export function renderTableResultLine(result: any, ownerColumns: string[] = []): string {
  const range = Array.isArray(result?.range) ? result.range.join("-") : "";
  return [
    result?.id,
    ...ownerColumns,
    result?.type ?? "",
    `range=${range}`,
    `weight=${result?.weight ?? ""}`,
    `drawn=${String(Boolean(result?.drawn))}`,
    result?.name ?? "",
    result?.documentUuid ?? ""
  ].join("\t");
}

export function renderTableDetails(table: any) {
  const results = Array.isArray(table?.results) ? table.results : [];
  const lines = [
    `id: ${table?.id}`,
    `name: ${table?.name}`,
    `img: ${table?.img ?? ""}`,
    `description: ${table?.description ?? ""}`,
    `formula: ${table?.formula ?? ""}`,
    `replacement: ${String(Boolean(table?.replacement))}`,
    `displayRoll: ${String(Boolean(table?.displayRoll))}`,
    `folder: ${table?.folder ?? ""}`,
    `sort: ${table?.sort ?? 0}`,
    `flags: ${JSON.stringify(table?.flags ?? {}, null, 2)}`,
    `results: ${results.length}`,
    ...results.map((result: any) => `  ${renderTableResultLine(result)}`)
  ];
  lines.push(...renderCompendiumSourceLines(table));

  if (table && Object.hasOwn(table, "ownership")) {
    lines.push(...renderOwnershipLines(table.ownership));
  }
  return lines.join("\n");
}

export function renderTableResultDetails(tableId: string, result: any) {
  return [
    `table: ${tableId}`,
    `id: ${result?.id}`,
    `type: ${result?.type ?? ""}`,
    `name: ${result?.name ?? ""}`,
    `description: ${result?.description ?? ""}`,
    `img: ${result?.img ?? ""}`,
    `documentUuid: ${result?.documentUuid ?? ""}`,
    `weight: ${result?.weight ?? ""}`,
    `range: ${Array.isArray(result?.range) ? result.range.join("-") : ""}`,
    `drawn: ${String(Boolean(result?.drawn))}`,
    `flags: ${JSON.stringify(result?.flags ?? {}, null, 2)}`
  ].join("\n");
}

export function renderTableDrawResult(result: any): string {
  const results = Array.isArray(result?.results) ? result.results : [];
  const chat = result?.chatMessages ?? {};
  const ids = Array.isArray(chat?.ids) ? chat.ids : [];
  const lines = [
    `table: ${result?.tableId ?? ""}`,
    `complete: ${String(Boolean(result?.complete))}`,
    `mutation: ${result?.mutation ?? ""}`,
    `available: ${result?.availableBefore ?? ""} -> ${result?.availableAfter ?? ""}`,
    result?.roll ? `roll: ${result.roll.formula ?? ""} = ${result.roll.total ?? ""}` : "roll: (none)",

    `chat: ${chat?.status ?? ""} (expected ${chat?.expectedCount ?? 0}, reported ${ids.length})`,
    ...(ids.length > 0 ? [`chat ids: ${ids.join(", ")}`] : []),
    ...(chat?.status === "captured" && (chat?.expectedCount ?? 0) > 0 && ids.length === 0
      ? [
          "chat ids: (withheld — more messages matched this table than this call could have created;" +
            " a concurrent draw of the same table is indistinguishable, so no id is reported)"
        ]
      : []),

    ...(result?.failure ? [`failure: ${result.failure.code ?? ""} — ${result.failure.message ?? ""}`] : []),
    `results: ${results.length}`,
    ...results.map(
      (row: any) => `  ${renderTableResultLine(row, [row?.tableId ?? "", row?.tableName ?? ""])}`
    )
  ];

  const notExecuted = result?.mutation === "not-executed";
  if (results.length === 0 && result?.availableBefore === 0 && !notExecuted) {
    lines.push(
      "note: no results were drawn (no rows are available to draw: either every row is already flagged" +
        " drawn — run `table reset` — or this table has no rows at all, which `table result create`" +
        " fixes; `table get` tells the two apart, this response cannot)"
    );
  } else if (
    results.length === 0 &&
    !notExecuted &&
    result?.mutation === "committed" &&
    !result?.failure &&
    typeof result?.availableBefore === "number" &&
    result.availableBefore > 0 &&
    result?.availableAfter === result.availableBefore
  ) {
    lines.push(
      "note: nothing was drawn although rows remain available — either the formula cannot reach any available row's range, or this draw recursed into a nested table (a `type=document` row with a `RollTable.…` uuid) that had nothing available, or an EARLIER `table draw --count > 1` in this session FAILED — whatever its error said — and left these rows drawn in the GM client only (more than one mechanism does this, so do not try to match that earlier error: run `table reset`, then draw again to check — its `changedCount` is 0 either way; reload the Foundry tab only if the re-draw is still empty); see `table get` and docs/commands.md → table.draw"
    );
  }
  return lines.join("\n");
}
