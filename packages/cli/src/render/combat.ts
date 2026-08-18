export function renderCombatTurnLine(turn: any) {
  return [
    turn?.id ?? "",
    turn?.name ?? "",
    `init=${turn?.initiative ?? ""}`,
    `hidden=${String(Boolean(turn?.hidden))}`,
    `defeated=${String(Boolean(turn?.defeated))}`,
    `group=${turn?.group ?? ""}`,
    `token=${turn?.tokenId ?? ""}`,
    `actor=${turn?.actorId ?? ""}`
  ].join("\t");
}

export function renderCombatDetails(combat: any) {
  const turns = Array.isArray(combat?.turns) ? combat.turns : [];
  return [
    `id: ${combat?.id}`,
    `name: ${combat?.name ?? ""}`,
    `type: ${combat?.type ?? ""}`,
    `scene: ${combat?.scene ?? ""}`,
    `active: ${String(Boolean(combat?.active))}`,
    `round: ${combat?.round ?? 0}`,
    `turn: ${combat?.turn ?? ""}`,
    `started: ${String(Boolean(combat?.started))}`,
    `currentCombatantId: ${combat?.currentCombatantId ?? ""}`,
    `sort: ${combat?.sort ?? 0}`,
    `groups: ${combat?.groupCount ?? "?"}`,
    `system: ${JSON.stringify(combat?.system ?? {}, null, 2)}`,
    `flags: ${JSON.stringify(combat?.flags ?? {}, null, 2)}`,
    `turns: ${combat?.combatantCount ?? turns.length}`,
    ...turns.map((turn: any) => `  ${renderCombatTurnLine(turn)}`)
  ].join("\n");
}

export function renderCombatantDetails(combatant: any) {
  return [
    `id: ${combatant?.id}`,
    `combat: ${combatant?.combatId ?? ""}`,
    `name: ${combatant?.name ?? ""}`,
    `type: ${combatant?.type ?? ""}`,
    `img: ${combatant?.img ?? ""}`,
    `initiative: ${combatant?.initiative ?? ""}`,
    `hidden: ${String(Boolean(combatant?.hidden))}`,
    `defeated: ${String(Boolean(combatant?.defeated))}`,
    `group: ${combatant?.group ?? ""}`,
    `actorId: ${combatant?.actorId ?? ""}`,
    `tokenId: ${combatant?.tokenId ?? ""}`,
    `sceneId: ${combatant?.sceneId ?? ""}`,
    `roundJoined: ${combatant?.roundJoined ?? ""}`,
    `system: ${JSON.stringify(combatant?.system ?? {}, null, 2)}`,
    `flags: ${JSON.stringify(combatant?.flags ?? {}, null, 2)}`
  ].join("\n");
}

export function renderCombatParentLines(result: any) {
  const parent = result?.combat ?? null;
  const lines = [
    `combat: round=${parent?.round ?? 0} turn=${parent?.turn ?? ""} started=${String(
      Boolean(parent?.started)
    )} scene=${parent?.scene ?? ""} combatants=${parent?.combatantCount ?? "?"} groups=${
      parent?.groupCount ?? "?"
    }`
  ];
  if (result?.combatSceneUnlinked) {
    lines.push(
      "NOTE: this write unlinked the combat from its scene (combat.scene -> null). Foundry's server does that when a combatant sits on a different scene than the encounter."
    );
  }

  for (const change of result?.groupInitiativeChanges ?? []) {
    lines.push(
      `NOTE: this write changed group ${change?.groupId}'s initiative: ${
        change?.initiativeBefore ?? "null"
      } -> ${change?.initiativeAfter ?? "null"}. A game system propagated it (dnd5e does on every combatant update); the group's initiative OVERRIDES its members', so restore it with \`combat group update --initiative <n>\` if that was not intended.`
    );
  }
  return lines;
}

export function renderCombatTransitionLines(result: any) {
  const roundBefore = result?.roundBefore ?? "";
  const turnBefore = result?.turnBefore ?? "null";
  if (result?.dryRun) {
    return [
      `transition: ${result?.transition ?? ""} (nothing was called)`,
      `round (pre-action): ${roundBefore}`,
      `turn (pre-action): ${turnBefore}`
    ];
  }
  return [
    `transition: ${result?.transition ?? ""}`,
    `round: ${roundBefore} -> ${result?.combat?.round ?? ""}`,
    `turn: ${turnBefore} -> ${result?.combat?.turn ?? "null"}`
  ];
}

export function renderCombatRollInitiativeResult(result: any): string {
  const rolled = Array.isArray(result?.rolled) ? result.rolled : [];
  const targeted = Array.isArray(result?.targetedCombatantIds) ? result.targetedCombatantIds : [];
  const unconfirmed = Array.isArray(result?.unconfirmedCombatantIds) ? result.unconfirmedCombatantIds : [];
  const unconfirmable = Array.isArray(result?.unconfirmableCombatantIds)
    ? result.unconfirmableCombatantIds
    : [];
  const chat = result?.chatMessages ?? {};
  const ids = Array.isArray(chat?.ids) ? chat.ids : [];
  const lines = [
    result?.dryRun
      ? `[dry-run] would roll initiative on combat ${result?.combatId ?? ""} — no dice were rolled`
      : `combat ${result?.combatId ?? ""}: rolled initiative`,
    `complete: ${String(Boolean(result?.complete))}`,
    `mutation: ${result?.mutation ?? ""}`,
    `select: ${result?.select ?? ""}`,
    `targeted (${targeted.length}): ${targeted.join(", ") || "(none)"}`,

    `chat: ${chat?.status ?? ""} (expected ${chat?.expectedCount ?? 0}, captured ${ids.length})`,
    ...(ids.length > 0 ? [`chat ids: ${ids.join(", ")}`] : []),
    ...(result?.failure ? [`failure: ${result.failure.code ?? ""} — ${result.failure.message ?? ""}`] : []),
    `rolled (${rolled.length}):`,
    ...rolled.map(
      (row: any) => `  ${row?.combatantId}\t${row?.initiativeBefore ?? ""} -> ${row?.initiative ?? ""}`
    )
  ];
  if (unconfirmed.length > 0) {
    lines.push(
      `NOT stored for: ${unconfirmed.join(
        ", "
      )} — those combatants still have NO initiative, so Foundry dropped their rows from the batch silently (a module veto, or client-side validation). Roll them individually with \`combat roll-initiative --combatant-ids <id>\`.`
    );
  }

  if (unconfirmable.length > 0) {
    lines.push(
      `cannot be CONFIRMED for: ${unconfirmable.join(
        ", "
      )} — this is NOT a report that the roll failed: stored state cannot decide it either way, which is why \`mutation\` is "unknown" instead of "committed". Either the row already held an initiative and holds the SAME number afterwards (a re-roll may legally land on it, and Foundry returns no roll totals), or it held one and now stores NONE (no roll total is null, so that row does not hold your roll — a hook may have rewritten it, or something cleared it inside the call after a good roll; such a row is deliberately absent from \`rolled\`), or the row is no longer in the combat. Re-read with \`combat get\`; for a re-roll that CAN be confirmed, run \`combat reset-initiative\` first — a null-to-number transition is provable.`
    );
  }
  if (result?.select !== "ids" && !result?.dryRun) {
    lines.push(
      "note: `--all`/`--npc` roll only combatants that have NO initiative yet, and the game system may narrow that further (dnd5e rolls one combatant per group), so `targeted` is the bridge's approximation while `rolled` is what the world stored",

      "note: a combatant group's own initiative OVERRIDES its members' live initiative, so grouped combatants are SKIPPED by `--all`/`--npc` even after `combat reset-initiative` (that clears combatant rows only). Clear the group's with `combat group update --combat-id <id> --group-id <id> --clear-initiative`, or roll the members explicitly with `--combatant-ids`"
    );
  }

  lines.push(...renderCombatParentLines(result));
  return lines.join("\n");
}

export function renderCombatantGroupDetails(group: any) {
  const members: string[] = Array.isArray(group?.memberCombatantIds) ? group.memberCombatantIds : [];
  const lines = [
    `id: ${group?.id}`,
    `combat: ${group?.combatId ?? ""}`,
    `name: ${group?.name ?? ""}`,
    `type: ${group?.type ?? ""}`,
    `img: ${group?.img ?? ""}`,
    `initiative: ${group?.initiative ?? ""}`,
    `hidden (derived): ${group?.hidden === null || group?.hidden === undefined ? "" : String(group.hidden)}`,
    `defeated (derived): ${
      group?.defeated === null || group?.defeated === undefined ? "" : String(group.defeated)
    }`,
    `members: ${members.length}${members.length > 0 ? ` (${members.join(", ")})` : ""}`,
    `system: ${JSON.stringify(group?.system ?? {}, null, 2)}`,
    `flags: ${JSON.stringify(group?.flags ?? {}, null, 2)}`
  ];
  if (group?.ownership !== undefined) {
    lines.push(`ownership (read-only): ${JSON.stringify(group.ownership ?? {}, null, 2)}`);
  }
  return lines.join("\n");
}
