import { renderCompendiumSourceLines, renderOwnershipLines } from "./common.js";

function renderCardLine(card: any) {
  return [
    card?.id ?? "",
    card?.name ?? "",
    `suit=${card?.suit ?? ""}`,
    `value=${card?.value ?? ""}`,
    `face=${card?.face ?? ""}`,
    `drawn=${String(Boolean(card?.drawn))}`,
    `origin=${card?.origin ?? ""}`,
    `sort=${card?.sort ?? 0}`
  ].join("\t");
}

export function renderCardsDetails(cards: any) {
  const rows = Array.isArray(cards?.cards) ? cards.cards : [];
  const lines = [
    `id: ${cards?.id}`,
    `name: ${cards?.name}`,
    `type: ${cards?.type ?? ""}`,
    `img: ${cards?.img ?? ""}`,
    `description: ${cards?.description ?? ""}`,
    `width: ${cards?.width ?? ""}`,
    `height: ${cards?.height ?? ""}`,
    `rotation: ${cards?.rotation ?? 0}`,
    `displayCount: ${String(Boolean(cards?.displayCount))}`,
    `folder: ${cards?.folder ?? ""}`,
    `sort: ${cards?.sort ?? 0}`,
    `system: ${JSON.stringify(cards?.system ?? {}, null, 2)}`,
    `flags: ${JSON.stringify(cards?.flags ?? {}, null, 2)}`,
    `cards: ${rows.length}`,
    ...rows.map((card: any) => `  ${renderCardLine(card)}`)
  ];
  lines.push(...renderCompendiumSourceLines(cards));

  if (cards && Object.hasOwn(cards, "ownership")) {
    lines.push(...renderOwnershipLines(cards.ownership));
  }
  return lines.join("\n");
}

function showsCardFace(card: any, faces: any[]) {
  const face = card?.face;
  return typeof face === "number" && faces[face] !== undefined;
}

export function renderCardDetails(cardsId: string, card: any) {
  const faces = Array.isArray(card?.faces) ? card.faces : [];
  return [
    `cards: ${cardsId}`,
    `id: ${card?.id}`,
    `name: ${card?.name ?? ""}`,
    `type: ${card?.type ?? ""}`,
    `description: ${card?.description ?? ""}`,
    `suit: ${card?.suit ?? ""}`,
    `value: ${card?.value ?? ""}`,

    `face: ${card?.face ?? ""} (${showsCardFace(card, faces) ? "showing a face" : "showing the BACK"})`,
    `drawn: ${String(Boolean(card?.drawn))} (read-only — set by cards deal/draw/pass/reset)`,
    `origin: ${card?.origin ?? ""} (read-only)`,
    `back: name=${card?.back?.name ?? ""} img=${card?.back?.img ?? ""} text=${card?.back?.text ?? ""}`,
    `faces: ${faces.length}`,
    ...faces.map(
      (face: any, index: number) =>
        `  [${index}] name=${face?.name ?? ""} img=${face?.img ?? ""} text=${face?.text ?? ""}`
    ),
    `width: ${card?.width ?? ""}`,
    `height: ${card?.height ?? ""}`,
    `rotation: ${card?.rotation ?? 0}`,
    `sort: ${card?.sort ?? 0}`,
    `system: ${JSON.stringify(card?.system ?? {}, null, 2)}`,
    `flags: ${JSON.stringify(card?.flags ?? {}, null, 2)}`
  ].join("\n");
}

export function renderCardSummaryLine(card: any) {
  return [
    card?.cardsId ?? "",
    card?.cardsName ?? "",
    card?.id ?? "",
    card?.name ?? "",
    `suit=${card?.suit ?? ""}`,
    `value=${card?.value ?? ""}`,
    `face=${card?.face ?? ""}`,

    `faces=${card?.faceCount ?? "?"}`,
    `drawn=${String(Boolean(card?.drawn))}`,
    `origin=${card?.origin ?? ""}`,
    `sort=${card?.sort ?? 0}`
  ].join("\t");
}

export function renderCardsCopyLines(copy: any): string[] {
  if (!copy) {
    return [];
  }
  const lines = [
    `cardsCopied: ${copy.count ?? 0} (ids re-minted: ${String(Boolean(copy.idsReminted))}; drawn flags cleared: ${copy.drawnCleared ?? 0})`
  ];
  if (copy.unreturnableCards) {
    lines.push(
      `WARNING: ${copy.unreturnableCards} copied card(s) keep an \`origin\` naming an EXISTING other stack that will NOT hold their NEW ids — a recall (\`cards reset\`) or \`cards delete\` on this clone DELETES those cards and returns nothing anywhere`
    );
  }
  return lines;
}

export function renderCardsActionMarkerLines(result: any): string[] {
  const lines = [
    `complete: ${String(Boolean(result.complete))}\tmutation: ${result.mutation ?? ""}\treconciliation: ${result.reconciliation ?? ""}`,
    `chatNotification: requested=${String(Boolean(result.chatNotification?.requested))} status=${result.chatNotification?.status ?? ""}`
  ];
  if (result.reconciliation === "best-effort") {
    lines.push(
      "  BEST-EFFORT: the typed method REJECTED, and Foundry dispatches every operation of a deal/pass/draw (and of a hand/pile recall) BEFORE its single await — there is no settle point, so the lists above may describe a state that was still being written. Re-read the named stacks with `cards get` / `cards card list` before acting."
    );
  }
  if (result.chatNotification?.status === "dispatched") {
    lines.push(
      "  `dispatched` means Foundry reached its notification call, NOT that a message exists: the call is un-awaited, and its audience follows the GM client's own chat-sidebar setting, which the bridge can neither set nor report (`--no-chat` is the only deterministic choice)."
    );
  }
  if (result.failure) {
    lines.push(`failure: ${result.failure.code ?? ""} ${result.failure.message ?? ""}`);
  }
  return lines;
}

export function renderCardsMovementLines(commandName: string, result: any): string[] {
  const verb = commandName.replace("cards.", "");
  const from = result.from ?? {};
  const destinations = Array.isArray(result.to) ? result.to : [];
  const label = (entry: any) => `${entry.cardsId ?? ""}${entry.cardsName ? ` (${entry.cardsName})` : ""}`;
  const ids = (list: any, count: any, truncated: any) => {
    const shown = Array.isArray(list) ? list : [];
    const exact = typeof count === "number" ? count : shown.length;
    return truncated
      ? `${shown.join(", ")} … (${shown.length} of ${exact} shown)`
      : `${shown.join(", ")} (${exact})`;
  };

  const dryRunHeader =
    verb === "pass"
      ? `[dry-run] cards ${verb}: nothing was moved — the counts and lists below are a FORECAST of the post-state`
      : `[dry-run] cards ${verb}: nothing was moved — the counts below are the CURRENT state, and the empty moved-lists mean the cards are picked INSIDE Foundry and are not predicted here, not "nothing would move"`;
  const lines = [
    result.dryRun ? dryRunHeader : `cards ${verb}: moved cards are listed per stack below`,
    `from ${label(from)} — available remaining: ${from.remaining ?? "?"}`
  ];
  if (from.removedCardIds?.length) {
    lines.push(
      `  left this stack: ${ids(from.removedCardIds, from.removedCardIdsCount, from.removedCardIdsTruncated)}`
    );
  }
  if (from.drawnCardIds?.length) {
    lines.push(
      `  stayed here but flagged drawn (the destination holds a copy under the SAME id): ${ids(from.drawnCardIds, from.drawnCardIdsCount, from.drawnCardIdsTruncated)}`
    );
  }

  if (from.strandedCardIds?.length) {
    lines.push(
      `  WATCH — observed leaving this stack with NO destination holding them (the destructive half; the sibling create may still have been in flight, so re-read with \`cards card list\` before repairing): ${ids(from.strandedCardIds, from.strandedCardIdsCount, from.strandedCardIdsTruncated)}`
    );
  }
  if (from.unconfirmedCardIds?.length) {
    lines.push(
      `  WATCH — observed arriving at a destination while NO source-side write shows here (so this stack may still OFFER a card that already lives elsewhere, and the next movement of it collides on the duplicate _id; re-read with \`cards get\` / \`cards card list\`): ${ids(from.unconfirmedCardIds, from.unconfirmedCardIdsCount, from.unconfirmedCardIdsTruncated)}`
    );
  }
  for (const entry of destinations) {
    lines.push(`to ${label(entry)} — expected ${entry.expected ?? "?"}`);
    lines.push(
      `  received: ${ids(entry.receivedCardIds, entry.receivedCardIdsCount, entry.receivedCardIdsTruncated)}`
    );
    if (entry.returnedCardIds?.length) {
      lines.push(
        `  returned to origin (no new row — the existing one went drawn=false): ${ids(entry.returnedCardIds, entry.returnedCardIdsCount, entry.returnedCardIdsTruncated)}`
      );
    }
    if (entry.indeterminateCardIds?.length) {
      lines.push(
        `  already in the requested state, and NOTHING witnessed this call putting it there (a home card returned to its origin deck that already stored it available — Foundry writes nothing at all on that path, so this is indistinguishable from a hook veto): ${ids(entry.indeterminateCardIds, entry.indeterminateCardIdsCount, entry.indeterminateCardIdsTruncated)}`
      );
    }
    if (entry.invalidStateCardIds?.length) {
      lines.push(
        `  WATCH — destination row appeared or changed with WRONG stored origin/drawn (a hook or concurrent writer altered the movement plan; re-read both stacks before repairing): ${ids(entry.invalidStateCardIds, entry.invalidStateCardIdsCount, entry.invalidStateCardIdsTruncated)}`
      );
    }
  }
  if (result.toTruncated) {
    const exact = typeof result.toCount === "number" ? result.toCount : destinations.length;
    lines.push(`  … ${exact - destinations.length} more destination(s) not shown (${exact} in total)`);
  }
  return [...lines, ...renderCardsActionMarkerLines(result)];
}

export function renderCardsRecallLines(
  recall: any,
  { deleteScoped = true }: { deleteScoped?: boolean } = {}
): string[] {
  if (!recall) {
    return [];
  }

  const scope = recall.deleteConsequences;
  const willOrDid =
    scope === "applied" ? "left" : scope === "prospective" ? "WOULD be left" : "MAY have been left";
  const lines = [
    `recall: ${recall.status ?? ""} (stack type ${recall.type ?? "?"}${
      deleteScoped && scope ? `, delete consequences ${scope}` : ""
    })`
  ];
  if (!deleteScoped) {
    // Nothing to say about removal consequences: the stack survives a reset by definition.
  } else if (scope === "prospective") {
    lines.push(
      "  the stack still EXISTS (nothing was deleted), so the two `left …` lists below are a FORECAST of what a landed delete would leave"
    );
  } else if (scope === "unknown") {
    lines.push(
      "  the delete THREW, so whether the stack was removed is NOT knowable here — read the two `left …` lists below as intent, and re-read the named stacks with `cards get`"
    );
  }

  const idList = (ids: any, count: any, truncated: any) => {
    const shown = Array.isArray(ids) ? ids : [];
    const exact = typeof count === "number" ? count : shown.length;
    return truncated
      ? `${shown.join(", ")} … (${shown.length} of ${exact} shown)`
      : `${shown.join(", ")} (${exact})`;
  };
  const group = (label: string, entries: any, entriesCount: any, entriesTruncated: any) => {
    const shown = Array.isArray(entries) ? entries : [];
    for (const entry of shown) {
      lines.push(
        `  ${label} ${entry.cardsId ?? ""}${entry.cardsName ? ` (${entry.cardsName})` : ""}: ${idList(entry.cardIds, entry.cardIdsCount, entry.cardIdsTruncated)}`
      );
    }
    if (entriesTruncated) {
      const exact = typeof entriesCount === "number" ? entriesCount : shown.length;
      lines.push(`    … ${exact - shown.length} more stack(s) not shown (${exact} affected in total)`);
    }
  };
  group("cards DELETED from", recall.reclaimed, recall.reclaimedCount, recall.reclaimedTruncated);
  group("cards RETURNED to", recall.returned, recall.returnedCount, recall.returnedTruncated);
  if (recall.destroyedCardIds?.length) {
    lines.push(
      `  DESTROYED with nothing returned anywhere (their origin no longer holds them): ${idList(recall.destroyedCardIds, recall.destroyedCardIdsCount, recall.destroyedCardIdsTruncated)}`
    );
  }
  if (recall.skippedCardIds?.length) {
    lines.push(
      deleteScoped
        ? `  skipped (no origin, or a dangling one — a recall can never move these; on a DELETE they stay in the stack and are DESTROYED with it): ${idList(recall.skippedCardIds, recall.skippedCardIdsCount, recall.skippedCardIdsTruncated)}`
        : `  skipped (no origin, or a dangling one — a recall can never move these, so they stay exactly where they are and this stack cannot be emptied by a reset): ${idList(recall.skippedCardIds, recall.skippedCardIdsCount, recall.skippedCardIdsTruncated)}`
    );
  }
  if (recall.ownDrawnResetCardIds?.length) {
    lines.push(
      deleteScoped
        ? `  own rows set drawn=false (they stay in the stack — on a DELETE they are DESTROYED with it, so this write changes nothing that survives): ${idList(recall.ownDrawnResetCardIds, recall.ownDrawnResetCardIdsCount, recall.ownDrawnResetCardIdsTruncated)}`
        : `  own rows set drawn=false (they are available to draw again): ${idList(recall.ownDrawnResetCardIds, recall.ownDrawnResetCardIdsCount, recall.ownDrawnResetCardIdsTruncated)}`
    );
  }

  if (recall.danglingOriginsLeft?.length) {
    group(
      `${willOrDid} with a DANGLING origin in`,
      recall.danglingOriginsLeft,
      recall.danglingOriginsLeftCount,
      recall.danglingOriginsLeftTruncated
    );
    if (recall.type === "deck") {
      lines.push(
        "    these are rows a REFUSED reclaim batch left behind — `cards get` those stacks and either delete the rows or re-point them"
      );
    }
  }

  if (recall.originRowsLeftDrawn?.length) {
    group(
      `${willOrDid} stored drawn=true (the copy in this stack ${scope === "applied" ? "is destroyed" : "would be destroyed"}, nothing is returned) in`,
      recall.originRowsLeftDrawn,
      recall.originRowsLeftDrawnCount,
      recall.originRowsLeftDrawnTruncated
    );
    lines.push(
      "    repair: recall that origin (`cards reset --cards-id <origin>`, or Foundry's Cards sidebar) — a DECK recall rewrites EVERY one of its own rows drawn=false and clears these; a HAND/PILE origin's own rows are `isHome`, so its recall SKIPS them and the row stays drawn=true"
    );
  }
  if (recall.unconfirmed) {
    const wentThrough = deleteScoped
      ? "the delete went through while these rows did not"
      : "the call resolved while these rows do not show it";
    lines.push(
      recall.type === "deck"
        ? `  UNCONFIRMED: a re-read of the stored state does not show the recall as landed — a deck recall fires no \`returnCards\` hook at all, so what dropped these rows is a per-card veto (\`preDeleteCard\`/\`preUpdateCard\`) inside the batch, which Foundry drops SILENTLY and resolves; ${wentThrough}:`
        : `  UNCONFIRMED: a re-read of the stored state does not show the recall as landed — Foundry may have dropped a refused write (a \`returnCards\` hook veto, or a per-card veto inside the batch), or a concurrent writer may have removed an origin row; ${wentThrough}:`
    );

    group(
      `    still holding this stack's cards (their reclaim did not land; ${deleteScoped && scope === "applied" ? "this stack is GONE, so those rows now store a DANGLING origin — see the list above" : "this stack still exists, so their origin still resolves"}):`,
      recall.unconfirmed.reclaimedRemaining,
      recall.unconfirmed.reclaimedRemainingCount,
      recall.unconfirmed.reclaimedRemainingTruncated
    );
    group(
      "    missing OR still stored drawn=true in:",
      recall.unconfirmed.notReturned,
      recall.unconfirmed.notReturnedCount,
      recall.unconfirmed.notReturnedTruncated
    );

    if (recall.unconfirmed.ownRowsStillDrawn?.length) {
      lines.push(
        `    this stack's OWN rows still stored drawn=true (the recall's own-row rewrite was dropped): ${idList(recall.unconfirmed.ownRowsStillDrawn, recall.unconfirmed.ownRowsStillDrawnCount, recall.unconfirmed.ownRowsStillDrawnTruncated)}`
      );
    }
    if (recall.unconfirmed.notRemovedCardIds?.length) {
      lines.push(
        `    still IN this stack though the recall should have removed them — their origin may now call them available, i.e. a DUPLICATE: ${idList(recall.unconfirmed.notRemovedCardIds, recall.unconfirmed.notRemovedCardIdsCount, recall.unconfirmed.notRemovedCardIdsTruncated)}`
      );
    }
  }
  return lines;
}
