import { COMMAND_NAMES } from "@fvtt-world-cli/protocol";

import { renderActorDetails } from "./actors.js";
import {
  renderCardDetails,
  renderCardSummaryLine,
  renderCardsActionMarkerLines,
  renderCardsCopyLines,
  renderCardsDetails,
  renderCardsMovementLines,
  renderCardsRecallLines
} from "./cards.js";
import { renderChatDetails } from "./chat.js";
import {
  renderCombatDetails,
  renderCombatParentLines,
  renderCombatRollInitiativeResult,
  renderCombatTransitionLines,
  renderCombatTurnLine,
  renderCombatantDetails,
  renderCombatantGroupDetails
} from "./combat.js";
import {
  batchOwnershipLines,
  humanCell,
  listFooterLines,
  renderBatchWriteResult,
  renderOwnershipLines,
  renderOwnershipSetResult
} from "./common.js";
import {
  effectListPrefix,
  renderAppliedEffectLine,
  renderEffectDetails,
  renderEffectSummaryLine
} from "./effects.js";
import {
  renderDataPath,
  renderFileEntryDetails,
  renderFileEntryListLine,
  renderFileSize,
  renderRecursiveFileEntryListLine
} from "./files.js";
import { renderFolderDetails } from "./folders.js";
import { renderItemDetails, renderItemSummaryLine } from "./items.js";
import { renderJournalCategoryDetails, renderJournalDetails } from "./journals.js";
import { renderMacroDetails } from "./macros.js";
import { renderPlaylistDetails, renderPlaylistSoundDetails } from "./playlists.js";
import {
  renderDrawingDetails,
  renderLightDetails,
  renderNoteDetails,
  renderRegionBehaviorDetails,
  renderRegionDetails,
  renderSceneDetails,
  renderSoundDetails,
  renderTemplateDetails,
  renderTileDetails,
  renderTokenDetails,
  renderWallDetails,
  tokenItemEffectPrefix,
  tokenItemPrefix
} from "./scenes.js";
import { renderSettingDetails, renderSettingSummaryLine } from "./settings.js";
import {
  renderTableDetails,
  renderTableDrawResult,
  renderTableResultDetails,
  renderTableResultLine
} from "./tables.js";
import { renderUserDetails, renderUserSummaryLine } from "./users.js";

type ResultRenderer = (result: any, offset: number) => string;
type RendererEntry = [string, ResultRenderer];

interface ListRendererSpec {
  key: string;
  empty: string;
  heading: string | ((count: number, result: any) => string);
  row: (entry: any, result: any) => string;
  prefix?: (result: any, command: string) => string[];
}

interface GetManyRendererSpec {
  key: string;
  heading: string;
  rows: (entry: any) => string[];
}

interface DeleteRendererSpec {
  prefix?: (result: any) => string[];
  suffix?: (result: any) => string;
}

function toCommandList(names: string | string[]): string[] {
  return typeof names === "string" ? [names] : names;
}

function customRenderer(
  names: string | string[],
  render: (result: any, offset: number, command: string) => string
): RendererEntry[] {
  return toCommandList(names).map((command) => [
    command,
    (result: any, offset: number) => render(result, offset, command)
  ]);
}

function listRenderer(names: string | string[], spec: ListRendererSpec): RendererEntry[] {
  return customRenderer(names, (result, offset, command) => {
    const prefix = spec.prefix ? spec.prefix(result, command) : [];
    const entries = result[spec.key];
    if (!entries?.length) {
      return [...prefix, spec.empty, ...listFooterLines(result, 0, offset)].join("\n");
    }
    return [
      ...prefix,
      typeof spec.heading === "function"
        ? spec.heading(entries.length, result)
        : `${spec.heading} (${entries.length})`,
      ...entries.map((entry: any) => spec.row(entry, result)),
      ...listFooterLines(result, entries.length, offset)
    ].join("\n");
  });
}

function getManyRenderer(names: string | string[], spec: GetManyRendererSpec): RendererEntry[] {
  return customRenderer(names, (result) => {
    const entries = result[spec.key] ?? [];
    return [`${spec.heading} (${entries.length})`, ...entries.flatMap((entry: any) => spec.rows(entry))].join(
      "\n"
    );
  });
}

function detailRenderer(
  names: string | string[],
  render: (result: any, command: string) => string
): RendererEntry[] {
  return customRenderer(names, (result, _offset, command) => render(result, command));
}

function deleteRenderer(
  names: string | string[],
  noun: string,
  spec: DeleteRendererSpec = {}
): RendererEntry[] {
  return customRenderer(names, (result) =>
    [
      ...(spec.prefix ? spec.prefix(result) : []),
      `Deleted ${noun} ${result.id}${spec.suffix ? spec.suffix(result) : ""}`
    ].join("\n")
  );
}

export function registerRenderers(groups: RendererEntry[][]): Record<string, ResultRenderer> {
  const renderers: Record<string, ResultRenderer> = Object.create(null);
  for (const group of groups) {
    for (const [command, renderer] of group) {
      if (Object.hasOwn(renderers, command)) {
        throw new Error(`duplicate human-output renderer registered for ${command}`);
      }
      renderers[command] = renderer;
    }
  }
  return renderers;
}

const scenePrefix = (result: any) => [`scene: ${result.sceneId}`];
const actorPrefixLines = (result: any) => [`actor: ${result.actorId ?? "unknown"}`];
const sceneSuffix = (result: any) => ` (scene: ${result.sceneId})`;

export const BATCH_WRITE_COMMANDS = COMMAND_NAMES.filter((name) =>
  /\.(create|update|delete)-many$/.test(name)
);

export const RENDERERS = registerRenderers([
  detailRenderer("system.ping", (result) =>
    [
      `pong: ${String(result.pong)}`,
      `timestamp: ${result.timestamp}`,
      `bridge status: ${result.bridge?.status ?? "unknown"}`
    ].join("\n")
  ),
  detailRenderer("system.info", (result) =>
    [
      `module: ${result.module?.title ?? result.module?.id} (${result.module?.version ?? "unknown"})`,
      `world: ${result.world?.title ?? "Unknown World"} [${result.world?.id ?? "unknown-world"}]`,
      `user: ${result.user?.name ?? "Unknown User"} [${result.user?.id ?? "unknown-user"}] GM=${String(Boolean(result.user?.isGM))}`,
      `bridge: ${result.bridge?.status ?? "unknown"}`,
      `modules: ${(result.modules ?? []).length}`,
      `limits.uploadBytes: ${result.limits?.uploadBytes ?? "unknown"} (source: ${result.limits?.uploadSource ?? "unknown"})`,
      `limits.wsMaxPayloadBytes: ${result.limits?.wsMaxPayloadBytes ?? "unknown"}`,
      `commands: ${(result.commands ?? []).join(", ")}`
    ].join("\n")
  ),
  customRenderer("world.search", (result, offset) => {
    const results = result.results ?? [];
    const lines = results.length
      ? [
          `Search results (${results.length})`,

          ...results.map((ref: any) => {
            const cells = [
              ref.source ?? "",
              ref.documentType ?? "",
              ref.id ?? "",

              ref.resolved === false ? "(deleted since indexing)" : humanCell(ref.name),
              typeof ref.score === "number" ? ref.score.toFixed(3) : ""
            ];
            if (ref.pack?.id) {
              cells.push(`pack=${ref.pack.id}`);
            }
            if ((ref.parents ?? []).length) {
              cells.push(
                `in ${(ref.parents ?? []).map((parent: any) => `${parent.documentType}:${humanCell(parent.name) || parent.id}`).join(" / ")}`
              );
            }
            if (ref.snippet?.text) {
              cells.push(`snippet=${humanCell(ref.snippet.text)}`);
            }
            return cells.join("\t");
          })
        ]
      : ["No matches found."];
    lines.push(...listFooterLines(result, results.length, offset));

    for (const corpus of ["world", "compendium"] as const) {
      const block = result.index?.[corpus];
      if (!block) {
        lines.push(`index.${corpus}: not built`);
        continue;
      }
      lines.push(
        `index.${corpus}: status=${block.status} entries=${block.entryCount} matches=${block.matchCount} generation=${block.generation} builtThisCall=${Boolean(block.builtThisCall)} stale=${Boolean(block.stale)} textTruncated=${block.textTruncatedCount}${
          corpus === "compendium"
            ? ` skippedPacks=${block.skippedPackCount} failedPacks=${block.failedPackCount ?? 0}`
            : ""
        }`
      );
    }
    return lines.join("\n");
  }),
  customRenderer("world.audit-files", (result, offset) => {
    const broken = result.broken ?? [];
    const skipped = result.skipped ?? [];
    const skippedTotal = skipped.reduce((sum: number, entry: any) => sum + (entry.count ?? 0), 0);
    const lines = broken.length
      ? [
          `Broken references (${broken.length})`,

          ...broken.map(
            (ref: any) =>
              `${ref.docType}\t${ref.id ?? ""}\t${humanCell(ref.name)}\t${ref.field}\t${ref.path}${
                ref.parent ? `\t(in ${humanCell(ref.parent)})` : ""
              }`
          )
        ]
      : ["No broken file references found."];
    lines.push(...listFooterLines(result, broken.length, offset));

    lines.push(
      `summary: broken=${result.total ?? broken.length} checkedRefs=${result.checkedRefs ?? 0} checkedFiles=${result.checkedFiles ?? 0} skipped=${skippedTotal}`
    );
    for (const entry of skipped) {
      lines.push(`skipped\t${entry.reason}\t${entry.path}\t(x${entry.count})`);
    }
    return lines.join("\n");
  }),

  listRenderer("scene.list", {
    key: "scenes",
    empty: "No scenes found.",
    heading: "Scenes",
    row: (scene) => `${scene.id}\t${scene.name}`
  }),
  detailRenderer(
    ["scene.get", "scene.update", "scene.create", "scene.clone", "scene.import-from-compendium"],
    (result) => renderSceneDetails(result.scene)
  ),
  getManyRenderer("scene.get-many", {
    key: "scenes",
    heading: "Scenes",
    rows: (scene) => [`${scene.id}\t${scene.name}`, ...batchOwnershipLines(scene)]
  }),
  deleteRenderer("scene.delete", "scene", {
    suffix: (result) => (result.wasActive ? " (was active)" : "")
  }),
  detailRenderer("scene.thumbnail.generate", (result) => {
    const thumbnail = result.thumbnail ?? {};
    const lines = [
      `${
        result.dryRun ? "[dry-run] would generate a thumbnail for scene" : "Generated thumbnail for scene"
      } ${result.sceneId}`,
      `output: ${thumbnail.outputWidth ?? "?"}x${thumbnail.outputHeight ?? "?"}`,
      `source: ${
        thumbnail.sourceWidth == null || thumbnail.sourceHeight == null
          ? "not reported by this Foundry version"
          : `${thumbnail.sourceWidth}x${thumbnail.sourceHeight}`
      }`,
      `size: ${thumbnail.sizeBytes == null ? "n/a (dry run)" : `${thumbnail.sizeBytes} bytes`}`,
      `persisted: ${String(Boolean(thumbnail.persisted))}`,

      `stored path: ${
        typeof thumbnail.storedPath === "string" && thumbnail.storedPath
          ? thumbnail.storedPath
          : "n/a (dry run)"
      }`
    ];

    if (typeof thumbnail.thumb === "string") {
      lines.push(`thumb: <${thumbnail.thumb.length}-byte data URL — read it with --json>`);
    }
    return lines.join("\n");
  }),
  detailRenderer("scene.fog.reset", (result) =>
    [
      `${
        result.dryRun ? "[dry-run] would reset fog of war for scene" : "Reset fog of war for scene"
      } ${result.sceneId}`,

      `${result.dryRun ? "would clear" : "cleared"}: ${
        result.clearedCount ?? 0
      } fog exploration document(s) (counted before the reset)`,

      `confirmation: ${
        result.confirmation === "observed"
          ? "observed (the pre-reset documents are confirmed gone)"
          : result.confirmation === "nothing-to-observe"
            ? "NOT observable — the scene had no persisted fog exploration, so the dispatched reset had nothing to confirm against"
            : result.confirmation === "not-dispatched"
              ? "n/a (dry run — nothing was dispatched)"
              : String(result.confirmation ?? "unknown")
      }`,
      `viewed scene: ${result.viewedSceneId ?? "none"}`
    ].join("\n")
  ),

  listRenderer("item.list", {
    key: "items",
    empty: "No items found.",
    heading: "Items",
    row: (item) => renderItemSummaryLine(item)
  }),
  detailRenderer(
    ["item.get", "item.create", "item.update", "item.clone", "item.import-from-compendium"],
    (result) => renderItemDetails(result.item)
  ),
  getManyRenderer("item.get-many", {
    key: "items",
    heading: "Items",
    rows: (item) => [renderItemSummaryLine(item, { suppressBody: true }), ...batchOwnershipLines(item)]
  }),
  deleteRenderer("item.delete", "item"),

  listRenderer("user.list", {
    key: "users",
    empty: "No users found.",
    heading: "Users",
    row: (user) => renderUserSummaryLine(user)
  }),
  detailRenderer("user.get", (result) => renderUserDetails(result.user)),

  listRenderer("setting.list", {
    key: "settings",
    empty: "No registered settings found.",
    heading: (count) => `Settings (${count}) — metadata only; read a value with \`setting get\``,
    row: (setting) => renderSettingSummaryLine(setting)
  }),
  detailRenderer("setting.get", (result) => renderSettingDetails(result.setting)),

  detailRenderer("actor.ownership.set", (result) => renderOwnershipSetResult("actor", result.actor)),
  detailRenderer("item.ownership.set", (result) => renderOwnershipSetResult("item", result.item)),
  detailRenderer("scene.ownership.set", (result) => renderOwnershipSetResult("scene", result.scene)),
  detailRenderer("macro.ownership.set", (result) => renderOwnershipSetResult("macro", result.macro)),
  detailRenderer("playlist.ownership.set", (result) => renderOwnershipSetResult("playlist", result.playlist)),
  detailRenderer("table.ownership.set", (result) => renderOwnershipSetResult("table", result.table)),
  detailRenderer("journal.ownership.set", (result) => renderOwnershipSetResult("journal", result.journal)),
  detailRenderer("cards.ownership.set", (result) => renderOwnershipSetResult("cards", result.cards)),

  listRenderer("table.list", {
    key: "tables",
    empty: "No roll tables found.",
    heading: "Roll tables",
    row: (table) =>
      `${table.id}\t${table.name}\tformula=${table.formula ?? ""}\tresults=${table.resultCount ?? "?"}\tdrawn=${table.drawnCount ?? "?"}`
  }),
  detailRenderer(
    ["table.get", "table.create", "table.update", "table.clone", "table.import-from-compendium"],
    (result) => renderTableDetails(result.table)
  ),
  getManyRenderer("table.get-many", {
    key: "tables",
    heading: "Roll tables",
    rows: (table) => [
      `${table.id}\t${table.name}\tformula=${table.formula ?? ""}\tresults=${table.results?.length ?? 0}`,
      ...batchOwnershipLines(table)
    ]
  }),
  deleteRenderer("table.delete", "roll table"),
  detailRenderer("table.draw", (result) => renderTableDrawResult(result)),
  detailRenderer("table.reset", (result) =>
    [
      `table: ${result.tableId}`,
      `reset: ${String(Boolean(result.reset))}`,

      `changedCount: ${result.changedCount ?? 0}`,
      renderTableDetails(result.table)
    ].join("\n")
  ),
  listRenderer("table.result.list", {
    key: "results",
    empty: "No table results found.",
    heading: "Results",
    prefix: (result) => (result.tableId ? [`table: ${result.tableId}`] : ["scope: all roll tables"]),
    row: (row, result) =>
      renderTableResultLine(row, !result.tableId ? [row.tableId ?? "", row.tableName ?? ""] : [])
  }),
  detailRenderer(
    ["table.result.get", "table.result.create", "table.result.update", "table.result.clone"],
    (result) => renderTableResultDetails(result.tableId, result.result)
  ),
  deleteRenderer("table.result.delete", "table result"),

  listRenderer("cards.list", {
    key: "cards",
    empty: "No card stacks found.",
    heading: "Card stacks",
    row: (stack) =>
      `${stack.id}\t${stack.name}\ttype=${stack.type ?? ""}\tcards=${stack.cardCount ?? "?"}\tdrawn=${stack.drawnCount ?? "?"}\tavailable=${stack.availableCount ?? "?"}\tfolder=${stack.folder ?? ""}`
  }),
  detailRenderer(["cards.get", "cards.create", "cards.update", "cards.import-from-compendium"], (result) =>
    renderCardsDetails(result.cards)
  ),
  detailRenderer("cards.clone", (result) =>
    [renderCardsDetails(result.cards), ...renderCardsCopyLines(result.cardsCopy)].join("\n")
  ),
  getManyRenderer("cards.get-many", {
    key: "cards",
    heading: "Card stacks",
    rows: (stack) => [
      `${stack.id}\t${stack.name}\ttype=${stack.type ?? ""}\tcards=${stack.cards?.length ?? 0}`,
      ...batchOwnershipLines(stack)
    ]
  }),
  listRenderer("cards.card.list", {
    key: "cards",
    empty: "No cards found.",
    heading: "Cards",
    prefix: (result) => (result.cardsId ? [`cards: ${result.cardsId}`] : ["scope: all card stacks"]),
    row: (card) => renderCardSummaryLine(card)
  }),
  detailRenderer(["cards.card.get", "cards.card.create", "cards.card.update"], (result) =>
    renderCardDetails(result.cardsId, result.card)
  ),
  detailRenderer("cards.card.clone", (result) =>
    [
      renderCardDetails(result.cardsId, result.card),

      ...(result.recallDeletesCopy === true
        ? [
            `WARNING: this copy keeps origin=${result.card?.origin} while carrying a NEW id, so that stack does not hold it — a later \`cards reset\`/\`cards delete\` of THIS stack when it is a hand or pile, or of the origin stack when that stack is a deck, DELETES this copy and returns nothing anywhere`
          ]
        : [])
    ].join("\n")
  ),
  detailRenderer("cards.card.delete", (result) =>
    result.dryRun
      ? `[dry-run] would delete card ${result.id} from card stack ${result.cardsId}`
      : `Deleted card ${result.id} from card stack ${result.cardsId}`
  ),
  detailRenderer("cards.shuffle", (result) => {
    const prefix = result.dryRun ? "[dry-run] would shuffle" : "Shuffled";
    return [
      `${prefix} card stack ${result.cardsId} (${result.shuffle?.count ?? 0} card(s))`,
      ...renderCardsActionMarkerLines(result),

      ...(result.mutation === "unknown"
        ? [
            "  the stored order did not change, which a shuffle that happened to reproduce it and a wholly refused one BOTH produce (Foundry drops the empty diffs either way) — shuffle again if you need a different order"
          ]
        : []),
      ...(result.mutation === "partial"
        ? [
            "  the stored sorts are no longer the 0..n-1 permutation this verb writes, so at least one row of the batch did not land — inspect `cards card list` and shuffle again"
          ]
        : [])
    ].join("\n");
  }),
  detailRenderer("cards.reset", (result) =>
    [
      result.dryRun
        ? `[dry-run] would RECALL card stack ${result.cardsId} — the stacks below would be mutated`
        : `Recalled card stack ${result.cardsId}`,

      ...renderCardsRecallLines(result.recall, { deleteScoped: false }),
      ...renderCardsActionMarkerLines(result),

      ...(result.mutation === "committed" && result.recall?.status === "unconfirmed"
        ? [
            "  …but nothing is MISSING from this call's expected changes: every write this recall could have changed IS in stored state (mutation: committed). Those rows were already stored drawn=false, so Foundry would have dropped the recall's write to them as an empty diff — their origin stack or individual origin row then vanished mid-call, or something else drew the card while this ran. Nothing here to retry; re-read the named stack with `cards get` if it still exists."
          ]
        : []),
      ...(result.recall?.type === "deck"
        ? [
            "  note: a DECK recall never looks at its OWN cards' origin, so cards dealt INTO this deck from elsewhere stay put and their origin stacks' rows stay drawn=true — send them back with `cards pass`"
          ]
        : [])
    ].join("\n")
  ),
  detailRenderer(["cards.deal", "cards.draw", "cards.pass"], (result, command) =>
    renderCardsMovementLines(command, result).join("\n")
  ),
  detailRenderer("cards.delete", (result) =>
    [
      result.dryRun
        ? `[dry-run] would delete card stack ${result.id} — and would first RECALL its cards (Foundry's Cards#_preDelete), which mutates the stacks below`
        : `Deleted card stack ${result.id}`,
      ...renderCardsRecallLines(result.recall),
      `chatNotification: requested=${String(Boolean(result.chatNotification?.requested))} status=${result.chatNotification?.status ?? ""}${
        result.chatNotification?.status === "dispatched"
          ? " (Foundry posts ONE recall notification per deleted stack, even an empty one; it cannot be suppressed through a delete, and its audience follows the GM client's own chat-sidebar setting)"
          : ""
      }`
    ].join("\n")
  ),

  listRenderer("combat.list", {
    key: "combats",
    empty: "No combats found.",
    heading: "Combats",
    row: (combat) =>
      `${combat.id}\t${combat.name ?? ""}\tscene=${combat.scene ?? ""}\tactive=${String(
        Boolean(combat.active)
      )}\tround=${combat.round ?? 0}\tturn=${combat.turn ?? ""}\tstarted=${String(
        Boolean(combat.started)
      )}\tcombatants=${combat.combatantCount ?? "?"}\tgroups=${combat.groupCount ?? "?"}`
  }),
  detailRenderer(["combat.get", "combat.create", "combat.update"], (result) =>
    renderCombatDetails(result.combat)
  ),
  detailRenderer("combat.delete", (result) => {
    const activated = result.activatedCombatIds ?? [];
    return [
      result.dryRun ? `[dry-run] would delete combat ${result.id}` : `Deleted combat ${result.id}`,

      `otherActiveBefore: ${(result.otherActiveCombatIdsBefore ?? []).join(", ") || "(none)"}`,
      `otherActiveAfter: ${(result.otherActiveCombatIdsAfter ?? []).join(", ") || "(none)"}`,

      activated.length
        ? `activated by this delete (observed so far): ${activated.join(", ")} (Foundry activates the Combat Tracker's currently-viewed encounter on delete; the bridge cannot suppress it)`
        : "activated by this delete: none observed yet — Foundry dispatches that activation without awaiting it, so it usually lands AFTER this response; re-read `fvtt-world-cli combat list` for the settled state"
    ].join("\n");
  }),
  listRenderer("combat.combatant.list", {
    key: "combatants",
    empty: "No combatants found.",
    heading: (count, result) => `Combatants of ${result.combatId} (${count}, turn order)`,
    row: (combatant) => renderCombatTurnLine(combatant)
  }),
  detailRenderer("combat.combatant.get", (result) => renderCombatantDetails(result.combatant)),
  detailRenderer(["combat.combatant.create", "combat.combatant.update"], (result) =>
    [renderCombatantDetails(result.combatant), ...renderCombatParentLines(result)].join("\n")
  ),
  detailRenderer("combat.combatant.delete", (result) =>
    [
      result.dryRun
        ? `[dry-run] would delete combatant ${result.id} of combat ${result.combatId}`
        : `Deleted combatant ${result.id} of combat ${result.combatId}`,
      ...renderCombatParentLines(result)
    ].join("\n")
  ),
  listRenderer("combat.group.list", {
    key: "groups",
    empty: "No combatant groups found.",
    heading: (count, result) => `Combatant groups of ${result.combatId} (${count})`,
    row: (group) =>
      `${group.id}\t${group.name ?? ""}\tinit=${group.initiative ?? ""}\tmembers=${
        group.memberCount ?? 0
      }\thidden=${group.hidden === null || group.hidden === undefined ? "" : String(group.hidden)}\tdefeated=${
        group.defeated === null || group.defeated === undefined ? "" : String(group.defeated)
      }`
  }),
  detailRenderer(["combat.group.get", "combat.group.create", "combat.group.update"], (result) =>
    renderCombatantGroupDetails(result.group)
  ),
  detailRenderer("combat.group.delete", (result) => {
    const dangling = result.danglingCombatantIds ?? [];
    return [
      result.dryRun
        ? `[dry-run] would delete combatant group ${result.id} of combat ${result.combatId}`
        : `Deleted combatant group ${result.id} of combat ${result.combatId}`,
      dangling.length
        ? `combatants left pointing at this group: ${dangling.join(
            ", "
          )} — Foundry clears nothing on a group delete, so their stored \`group\` id no longer resolves (they render ungrouped). Clear one with \`combat combatant update --clear-group\`.`
        : "combatants left pointing at this group: (none)"
    ].join("\n");
  }),
  detailRenderer("combat.start", (result) =>
    [
      result.dryRun
        ? result.alreadyStarted
          ? `[dry-run] combat ${result.combatId} is ALREADY started — a real call would call NOTHING and report alreadyStarted: true, so the round/turn below are exactly what it would leave (Foundry's startCombat would REWIND it to round 1, turn 0, which is why the bridge refuses)`
          : `[dry-run] would start combat ${result.combatId} — nothing was called, so the round/turn below are the CURRENT pre-action values, NOT the ones a start would apply`
        : result.alreadyStarted
          ? `combat ${result.combatId} was ALREADY started — nothing was called (Foundry's startCombat would REWIND it to round 1, turn 0)`
          : `Started combat ${result.combatId}`,
      ...renderCombatTransitionLines(result),

      "note: starting a combat does NOT make it the active encounter — use `fvtt-world-cli combat activate`",
      renderCombatDetails(result.combat)
    ].join("\n")
  ),
  detailRenderer("combat.activate", (result) => {
    const deactivated = result.deactivatedCombatIds ?? [];
    const deactivatedLabel = result.dryRun
      ? "would be deactivated by this activation"
      : "deactivated by this activation";
    return [
      result.dryRun
        ? `[dry-run] would activate combat ${result.combatId}`
        : result.alreadyActive
          ? `combat ${result.combatId} was already active — Foundry's update({active:true}) was an EMPTY DIFF, dropped client-side before dispatch, so nothing reached the server and no other encounter was deactivated (a success, not a failure)`
          : `Activated combat ${result.combatId}`,

      `otherActiveBefore: ${(result.otherActiveCombatIdsBefore ?? []).join(", ") || "(none)"}`,
      `otherActiveAfter${result.dryRun ? " (predicted)" : ""}: ${
        (result.otherActiveCombatIdsAfter ?? []).join(", ") || "(none)"
      }`,

      deactivated.length
        ? `${deactivatedLabel}: ${deactivated.join(
            ", "
          )} (Foundry's server allows one active encounter WORLD-wide — no scene filter)`
        : `${deactivatedLabel}: (none)`,
      renderCombatDetails(result.combat)
    ].join("\n");
  }),
  detailRenderer(
    ["combat.next-turn", "combat.previous-turn", "combat.next-round", "combat.previous-round"],
    (result, command) =>
      [
        result.dryRun
          ? `[dry-run] would run ${command} on combat ${result.combatId} — the resulting round/turn is NOT predicted (Foundry's own boundary logic and the game system's turn comparator decide it)`
          : `${command} on combat ${result.combatId}`,
        ...renderCombatTransitionLines(result),

        ...(!result.dryRun && command.endsWith("-turn") && result.transition === "round"
          ? [
              "note: Foundry delegated this TURN move to a ROUND move (the turn ran past the end of the order, or back past its start)"
            ]
          : []),
        ...(!result.dryRun && result.combat?.started === false && result.roundBefore > 0
          ? [
              "note: this rewind UN-STARTED the encounter (round 0, no current combatant) — `fvtt-world-cli combat start` begins it again"
            ]
          : []),
        renderCombatDetails(result.combat)
      ].join("\n")
  ),
  detailRenderer("combat.reset-initiative", (result) =>
    [
      result.dryRun
        ? `[dry-run] would clear initiative on combat ${result.combatId}`
        : `Cleared initiative on combat ${result.combatId}`,
      `reset: ${String(Boolean(result.reset))}`,

      `changedCount: ${result.changedCount ?? 0}`,
      renderCombatDetails(result.combat)
    ].join("\n")
  ),
  detailRenderer("combat.roll-initiative", (result) => renderCombatRollInitiativeResult(result)),
  detailRenderer("combat.set-initiative", (result) =>
    [
      result.dryRun
        ? `[dry-run] would set initiative of combatant ${result.combatantId} to ${
            result.initiative ?? "null"
          }`
        : `Set initiative of combatant ${result.combatantId} to ${result.initiative ?? "null"}`,
      `initiativeBefore: ${result.initiativeBefore ?? ""}`,
      `changed: ${String(Boolean(result.changed))}`,
      renderCombatantDetails(result.combatant),
      ...renderCombatParentLines(result)
    ].join("\n")
  ),

  listRenderer("journal.list", {
    key: "journals",
    empty: "No journals found.",
    heading: "Journals",
    row: (journal) =>
      `${journal.id}\t${journal.name}\tpages=${journal.pageCount ?? "?"}\tcategories=${journal.categoryCount ?? "?"}`
  }),
  detailRenderer(
    ["journal.get", "journal.create", "journal.update", "journal.clone", "journal.import-from-compendium"],
    (result) => renderJournalDetails(result.journal)
  ),
  getManyRenderer("journal.get-many", {
    key: "journals",
    heading: "Journals",
    rows: (journal) => {
      const lines = [
        `${journal.id}\t${journal.name}\tpages=${journal.pageCount ?? journal.pages?.length ?? "?"}\tcategories=${journal.categoryCount ?? journal.categories?.length ?? "?"}`,
        ...batchOwnershipLines(journal)
      ];

      if (Array.isArray(journal.pages)) {
        journal.pages.forEach((page: any, index: number) => {
          if (page && Object.hasOwn(page, "ownership")) {
            lines.push(...renderOwnershipLines(page.ownership).map((line) => `  page ${index + 1} ${line}`));
          }
        });
      }
      return lines;
    }
  }),
  deleteRenderer("journal.delete", "journal"),
  listRenderer("journal.category.list", {
    key: "categories",
    empty: "No categories found.",
    heading: "Categories",
    prefix: (result) => [`journal: ${result.journalId}`],
    row: (category) =>
      `${category.id}\t${category.name === "" ? "(blank)" : (category.name ?? "")}\tsort=${category.sort ?? 0}`
  }),
  detailRenderer(["journal.category.get", "journal.category.create", "journal.category.update"], (result) =>
    renderJournalCategoryDetails(result.journalId, result.category)
  ),
  detailRenderer("journal.category.delete", (result) => {
    const count = result.danglingPageCount ?? 0;
    const lines = [
      result.deleted
        ? `Deleted journal category ${result.id} from journal ${result.journalId}`
        : `Would delete journal category ${result.id} from journal ${result.journalId}`
    ];
    if (count === 0) {
      lines.push("No pages of this journal reference it.");
    } else {
      lines.push(
        `${count} page(s) of this journal ${result.deleted ? "now store" : "would be left storing"} the deleted category id (Foundry renders them as uncategorized; re-point them with journal update --pages-json).`,
        ...(result.danglingPageIds ?? []).map((pageId: string) => `  page ${pageId}`)
      );
      if (result.danglingPageIdsTruncated) {
        lines.push(`  … list capped; ${count} page(s) in total — use journal get to enumerate the rest`);
      }
    }
    return lines.join("\n");
  }),

  listRenderer("macro.list", {
    key: "macros",
    empty: "No macros found.",
    heading: "Macros",
    row: (m) => `${m.id}\t${m.name}\t${m.type ?? ""}\t${m.scope ?? ""}`
  }),
  detailRenderer(
    ["macro.get", "macro.create", "macro.update", "macro.clone", "macro.import-from-compendium"],
    (result) => renderMacroDetails(result.macro)
  ),
  getManyRenderer("macro.get-many", {
    key: "macros",
    heading: "Macros",
    rows: (m) => [`${m.id}\t${m.name}\t${m.type ?? ""}\t${m.scope ?? ""}`, ...batchOwnershipLines(m)]
  }),
  deleteRenderer("macro.delete", "macro"),

  listRenderer("playlist.list", {
    key: "playlists",
    empty: "No playlists found.",
    heading: "Playlists",
    row: (p) => `${p.id}\t${p.name}\tmode=${p.mode ?? ""}\tsounds=${p.soundCount ?? 0}`
  }),
  detailRenderer(
    [
      "playlist.get",
      "playlist.create",
      "playlist.update",
      "playlist.clone",
      "playlist.import-from-compendium",
      "playlist.play",
      "playlist.stop",
      "playlist.playNext"
    ],
    (result) => renderPlaylistDetails(result.playlist)
  ),
  getManyRenderer("playlist.get-many", {
    key: "playlists",
    heading: "Playlists",
    rows: (p) => [
      `${p.id}\t${p.name}\tmode=${p.mode ?? ""}\tsounds=${p.soundCount ?? p.sounds?.length ?? 0}`,
      ...batchOwnershipLines(p)
    ]
  }),
  deleteRenderer("playlist.delete", "playlist"),
  listRenderer("playlist.sound.list", {
    key: "sounds",
    empty: "No sounds found.",
    heading: "Sounds",
    prefix: (result) => (result.playlistId ? [`playlist: ${result.playlistId}`] : ["scope: all playlists"]),
    row: (s, result) => {
      const owner = !result.playlistId ? `${s.playlistId ?? ""}\t${s.playlistName ?? ""}\t` : "";
      return `${s.id}\t${owner}${s.name ?? ""}\t${s.path ?? ""}\tplaying=${String(Boolean(s.playing))}\tduration=${s.duration ?? ""}`;
    }
  }),
  detailRenderer(
    [
      "playlist.sound.get",
      "playlist.sound.create",
      "playlist.sound.update",
      "playlist.sound.clone",
      "playlist.sound.play",
      "playlist.sound.stop"
    ],
    (result) => renderPlaylistSoundDetails(result.sound)
  ),
  deleteRenderer("playlist.sound.delete", "playlist sound"),

  listRenderer("chat.list", {
    key: "messages",
    empty: "No chat messages found.",
    heading: (count) => `Chat messages (${count}, newest first)`,
    row: (m) =>
      `${m.id}\t${m.author ?? ""}\t${m.alias ?? ""}\t${m.timestamp ?? ""}\trolls=${m.rollCount ?? "?"}\twhisper=${m.whisperCount ?? m.whisper?.length ?? "?"}\tlen=${m.contentLength ?? "?"}\t${m.contentPreview ?? ""}`
  }),
  detailRenderer(["chat.get", "chat.create"], (result) => renderChatDetails(result.message)),
  deleteRenderer("chat.delete", "chat message"),

  listRenderer("actor.list", {
    key: "actors",
    empty: "No actors found.",
    heading: "Actors",
    row: (actor) =>
      `${actor.id}\t${actor.name}\t${actor.type}\titems=${actor.itemCount ?? "?"}\teffects=${actor.effectCount ?? "?"}`
  }),
  detailRenderer(
    ["actor.get", "actor.create", "actor.update", "actor.clone", "actor.import-from-compendium"],
    (result) => renderActorDetails(result.actor)
  ),
  getManyRenderer("actor.get-many", {
    key: "actors",
    heading: "Actors",
    rows: (actor) => [
      `${actor.id}\t${actor.name}\t${actor.type ?? ""}\titems=${actor.itemCount ?? actor.items?.length ?? "?"}\teffects=${actor.effectCount ?? actor.effects?.length ?? "?"}`,
      ...batchOwnershipLines(actor)
    ]
  }),
  deleteRenderer("actor.delete", "actor"),

  listRenderer("compendium.list", {
    key: "packs",
    empty: "No compendium packs found.",
    heading: "Packs",
    row: (p) => `${p.id}\t${p.type}\t${p.label}`
  }),
  customRenderer("compendium.index", (result, offset) => {
    if (!result.entries?.length) {
      return [`pack: ${result.pack}`, "No entries found.", ...listFooterLines(result, 0, offset)].join("\n");
    }

    return [
      `pack: ${result.pack} (${result.type ?? "?"})`,
      `Entries (${result.entries.length})`,
      ...result.entries.map((e: any) => `${e.id}\t${e.type ?? ""}\t${e.name}`),
      ...listFooterLines(result, result.entries.length, offset)
    ].join("\n");
  }),
  detailRenderer("compendium.get", (result) =>
    [
      `pack: ${result.pack}`,
      `entryId: ${result.entryId}`,
      `documentName: ${result.documentName}`,
      ...(Array.isArray(result.effects) ? [`effects: ${result.effects.length} (see --json)`] : []),
      `document: ${JSON.stringify(result.document ?? null, null, 2)}`
    ].join("\n")
  ),

  listRenderer("folder.list", {
    key: "folders",
    empty: "No folders found.",
    heading: "Folders",
    row: (f) => `${f.id}\t${f.type}\t${f.name}`
  }),
  detailRenderer("folder.get", (result) => renderFolderDetails(result.folder)),
  detailRenderer(
    "folder.create",
    (result) =>
      `${result.dryRun ? "[dry-run] would create" : "Created"} folder ${result.folder?.id ?? ""} (${result.folder?.name})`
  ),
  detailRenderer("folder.update", (result) =>
    [
      `${result.dryRun ? "[dry-run] would update" : "Updated"} folder ${result.folder?.id ?? ""}`,
      renderFolderDetails(result.folder)
    ].join("\n")
  ),
  detailRenderer("folder.delete", (result) => {
    const f = result.folders ?? {};
    const c = result.contents ?? {};
    const deleteVerb = result.dryRun
      ? "[dry-run] would delete"
      : result.deleted
        ? "Deleted"
        : "Partially deleted (folder still present)";
    return [
      `${deleteVerb} folder ${result.id}`,
      `complete: ${String(result.complete)}`,
      `reparentedTo: ${result.reparentedTo ?? "(root)"}`,
      `subfolders: ${result.counts?.subfolders?.direct ?? 0} direct / ${result.counts?.subfolders?.recursive ?? 0} recursive` +
        ` — ${f.deleted?.count ?? 0} deleted, ${f.reparented?.count ?? 0} reparented`,
      `contents: ${result.counts?.contents?.direct ?? 0} direct / ${result.counts?.contents?.recursive ?? 0} recursive` +
        ` — ${c.deleted?.count ?? 0} deleted, ${c.reparented?.count ?? 0} reparented`,
      ...(result.remaining
        ? [
            `remaining (planned but NOT observed applied): not deleted — ${result.remaining.folders?.count ?? 0} folders, ${result.remaining.contents?.count ?? 0} documents;` +
              ` not reparented — ${result.remaining.foldersNotReparented?.count ?? 0} folders, ${result.remaining.contentsNotReparented?.count ?? 0} documents`
          ]
        : []),
      ...(result.guardViolations ? [`guardViolations: ${JSON.stringify(result.guardViolations)}`] : [])
    ].join("\n");
  }),

  listRenderer("actor.item.list", {
    key: "items",
    empty: "No items found.",
    heading: "Items",
    prefix: actorPrefixLines,
    row: (item) => renderItemSummaryLine(item)
  }),
  detailRenderer(
    [
      "actor.item.get",
      "actor.item.create",
      "actor.item.update",
      "actor.item.clone",
      "actor.item.import-from-compendium"
    ],
    (result) => renderItemDetails(result.item, [`actor: ${result.actorId ?? "unknown"}`])
  ),
  deleteRenderer("actor.item.delete", "actor item", {
    suffix: (result) => ` (actor: ${result.actorId ?? "unknown"})`
  }),

  listRenderer(
    [
      "actor.effect.list",
      "item.effect.list",
      "actor.item.effect.list",
      "scene.token.item.effect.list",
      "scene.token.effect.list"
    ],
    {
      key: "effects",
      empty: "No effects found.",
      heading: "Effects",
      prefix: (result, command) => effectListPrefix(command, result),
      row: (effect) => renderEffectSummaryLine(effect)
    }
  ),
  listRenderer(["actor.effect.applied", "scene.token.effect.applied"], {
    key: "effects",
    empty: "No applied effects.",
    heading: "Applied effects",
    prefix: (result, command) => effectListPrefix(command, result),
    row: (effect) => renderAppliedEffectLine(effect)
  }),
  detailRenderer(
    ["actor.effect.get", "actor.effect.create", "actor.effect.update", "actor.effect.clone"],
    (result) => renderEffectDetails(result.effect, [`actor: ${result.actorId ?? "unknown"}`])
  ),
  detailRenderer(
    ["item.effect.get", "item.effect.create", "item.effect.update", "item.effect.clone"],
    (result) => renderEffectDetails(result.effect, [`item: ${result.itemId ?? "unknown"}`])
  ),
  detailRenderer(
    [
      "actor.item.effect.get",
      "actor.item.effect.create",
      "actor.item.effect.update",
      "actor.item.effect.clone"
    ],
    (result) =>
      renderEffectDetails(result.effect, [
        `actor: ${result.actorId ?? "unknown"}`,
        `item: ${result.itemId ?? "unknown"}`
      ])
  ),
  deleteRenderer("actor.effect.delete", "actor effect", {
    suffix: (result) => ` (actor: ${result.actorId ?? "unknown"})`
  }),
  deleteRenderer("item.effect.delete", "item effect", {
    suffix: (result) => ` (item: ${result.itemId ?? "unknown"})`
  }),
  deleteRenderer("actor.item.effect.delete", "actor-item effect", {
    suffix: (result) => ` (actor: ${result.actorId ?? "unknown"}, item: ${result.itemId ?? "unknown"})`
  }),
  detailRenderer(
    [
      "scene.token.effect.get",
      "scene.token.effect.create",
      "scene.token.effect.update",
      "scene.token.effect.clone"
    ],
    (result) => renderEffectDetails(result.effect, tokenItemPrefix(result))
  ),
  deleteRenderer("scene.token.effect.delete", "token effect", { prefix: tokenItemPrefix }),
  detailRenderer(
    [
      "scene.token.item.effect.get",
      "scene.token.item.effect.create",
      "scene.token.item.effect.update",
      "scene.token.item.effect.clone"
    ],
    (result) => renderEffectDetails(result.effect, tokenItemEffectPrefix(result))
  ),
  deleteRenderer("scene.token.item.effect.delete", "token-item effect", {
    prefix: tokenItemEffectPrefix
  }),

  listRenderer("scene.token.list", {
    key: "tokens",
    empty: "No tokens found.",
    heading: "Tokens",
    prefix: scenePrefix,
    row: (token) =>
      `${token.id}\t${token.name}\tactor=${token.actorId ?? "-"}\tlinked=${String(Boolean(token.actorLink))}\t(${token.x},${token.y})`
  }),
  detailRenderer(
    ["scene.token.get", "scene.token.create", "scene.token.update", "scene.token.clone"],
    (result) => renderTokenDetails(result.sceneId, result.token)
  ),
  deleteRenderer("scene.token.delete", "token", { suffix: sceneSuffix }),
  listRenderer("scene.token.item.list", {
    key: "items",
    empty: "No items found.",
    heading: "Items",
    prefix: tokenItemPrefix,
    row: (item) => renderItemSummaryLine(item)
  }),
  detailRenderer(
    ["scene.token.item.get", "scene.token.item.create", "scene.token.item.update", "scene.token.item.clone"],
    (result) => renderItemDetails(result.item, tokenItemPrefix(result))
  ),
  deleteRenderer("scene.token.item.delete", "token item", { prefix: tokenItemPrefix }),

  listRenderer("scene.tile.list", {
    key: "tiles",
    empty: "No tiles found.",
    heading: "Tiles",
    prefix: scenePrefix,
    row: (tile) =>
      `${tile.id}\t(${tile.x},${tile.y})\t${tile.width}x${tile.height}\thidden=${String(Boolean(tile.hidden))}`
  }),
  detailRenderer(["scene.tile.get", "scene.tile.create", "scene.tile.update", "scene.tile.clone"], (result) =>
    renderTileDetails(result.sceneId, result.tile)
  ),
  deleteRenderer("scene.tile.delete", "tile", { suffix: sceneSuffix }),

  listRenderer("scene.sound.list", {
    key: "sounds",
    empty: "No sounds found.",
    heading: "Sounds",
    prefix: scenePrefix,
    row: (sound) =>
      `${sound.id}\t${sound.path ?? ""}\t(${sound.x},${sound.y})\tr=${sound.radius}\thidden=${String(Boolean(sound.hidden))}`
  }),
  detailRenderer(
    ["scene.sound.get", "scene.sound.create", "scene.sound.update", "scene.sound.clone"],
    (result) => renderSoundDetails(result.sceneId, result.sound)
  ),
  deleteRenderer("scene.sound.delete", "sound", { suffix: sceneSuffix }),

  listRenderer("scene.wall.list", {
    key: "walls",
    empty: "No walls found.",
    heading: "Walls",
    prefix: scenePrefix,
    row: (wall) =>
      `${wall.id}\t${wall.door ?? 0}/${wall.ds ?? 0}/${wall.doorSound ?? ""}\tc=[${(wall.c ?? []).join(",")}]`
  }),
  detailRenderer(["scene.wall.get", "scene.wall.create", "scene.wall.update", "scene.wall.clone"], (result) =>
    renderWallDetails(result.sceneId, result.wall)
  ),
  deleteRenderer("scene.wall.delete", "wall", { suffix: sceneSuffix }),

  detailRenderer(BATCH_WRITE_COMMANDS, (result, command) => renderBatchWriteResult(command, result)),

  listRenderer("scene.note.list", {
    key: "notes",
    empty: "No notes found.",
    heading: "Notes",
    prefix: scenePrefix,
    row: (note) =>
      `${note.id}\t${note.text ?? ""}\t(${note.x},${note.y})\t${note.texture?.src ?? ""}\t${note.iconSize ?? ""}`
  }),
  detailRenderer(["scene.note.get", "scene.note.create", "scene.note.update", "scene.note.clone"], (result) =>
    renderNoteDetails(result.sceneId, result.note)
  ),
  deleteRenderer("scene.note.delete", "note", { suffix: sceneSuffix }),

  listRenderer("scene.drawing.list", {
    key: "drawings",
    empty: "No drawings found.",
    heading: "Drawings",
    prefix: scenePrefix,
    row: (drawing) =>
      `${drawing.id}\t${drawing.text ?? ""}\t(${drawing.x},${drawing.y})\t${drawing.shape?.type ?? ""}\t${String(Boolean(drawing.hidden))}\t${drawing.name ?? "(no name)"}`
  }),
  detailRenderer(
    ["scene.drawing.get", "scene.drawing.create", "scene.drawing.update", "scene.drawing.clone"],
    (result) => renderDrawingDetails(result.sceneId, result.drawing)
  ),
  deleteRenderer("scene.drawing.delete", "drawing", { suffix: sceneSuffix }),

  listRenderer("scene.light.list", {
    key: "lights",
    empty: "No lights found.",
    heading: "Lights",
    prefix: scenePrefix,
    row: (light) =>
      `${light.id}\t(${light.x},${light.y})\t${light.config?.dim ?? ""}/${light.config?.bright ?? ""}\t${String(Boolean(light.hidden))}\t${light.name ?? "(no name)"}`
  }),
  detailRenderer(
    ["scene.light.get", "scene.light.create", "scene.light.update", "scene.light.clone"],
    (result) => renderLightDetails(result.sceneId, result.light)
  ),
  deleteRenderer("scene.light.delete", "light", { suffix: sceneSuffix }),

  listRenderer("scene.template.list", {
    key: "templates",
    empty: "No templates found.",
    heading: "Templates",
    prefix: scenePrefix,
    row: (template) =>
      `${template.id}\t${template.t ?? ""}\t(${template.x},${template.y})\t${template.distance ?? 0}\t${String(Boolean(template.hidden))}`
  }),
  detailRenderer(
    ["scene.template.get", "scene.template.create", "scene.template.update", "scene.template.clone"],
    (result) => renderTemplateDetails(result.sceneId, result.template)
  ),
  deleteRenderer("scene.template.delete", "template", { suffix: sceneSuffix }),

  listRenderer("scene.region.list", {
    key: "regions",
    empty: "No regions found.",
    heading: "Regions",
    prefix: scenePrefix,
    row: (region) =>
      `${region.id}\t${region.name ?? ""}\t${region.visibility ?? ""}\tshapes=${region.shapesCount ?? 0}\tbehaviors=${region.behaviorsCount ?? 0}`
  }),
  detailRenderer(
    ["scene.region.get", "scene.region.create", "scene.region.update", "scene.region.clone"],
    (result) => renderRegionDetails(result.sceneId, result.region)
  ),
  deleteRenderer("scene.region.delete", "region", { suffix: sceneSuffix }),

  listRenderer("scene.region.behavior.list", {
    key: "behaviors",
    empty: "No behaviors found.",
    heading: "Behaviors",
    prefix: (result) => [`scene: ${result.sceneId}`, `region: ${result.regionId}`],
    row: (behavior) =>
      `${behavior.id}\t${behavior.name === "" ? "(blank)" : (behavior.name ?? "")}\t${behavior.type ?? ""}\tdisabled=${String(
        Boolean(behavior.disabled)
      )}`
  }),
  detailRenderer(
    [
      "scene.region.behavior.get",
      "scene.region.behavior.create",
      "scene.region.behavior.update",
      "scene.region.behavior.clone"
    ],
    (result) => renderRegionBehaviorDetails(result.sceneId, result.regionId, result.behavior)
  ),
  detailRenderer("scene.region.behavior.delete", (result) =>
    result.deleted
      ? `Deleted region behavior ${result.id} (scene: ${result.sceneId}, region: ${result.regionId})`
      : `Would delete region behavior ${result.id} (scene: ${result.sceneId}, region: ${result.regionId})`
  ),

  customRenderer("file.list", (result, offset) => {
    if (result.recursive) {
      const lines = [`Directory: ${renderDataPath(result.directory?.path)} (recursive)`];
      if (!result.entries?.length) {
        lines.push("No entries found.");
      } else {
        for (const entry of result.entries) {
          lines.push(renderRecursiveFileEntryListLine(entry));
        }
      }
      for (const skip of result.skipped ?? []) {
        lines.push(`skipped\t${renderDataPath(skip.path)}\t${skip.reason ?? "browse failed"}`);
      }
      if (result.skippedTruncated) {
        lines.push(
          `!! SKIP LIST TRUNCATED — more unreadable subdirectories than the ${result.skipped?.length ?? 0}-entry cap; narrow --path to see the rest`
        );
      }
      lines.push(`showing ${result.entries?.length ?? 0} entries`);
      if (result.truncated) {
        lines.push(
          `!! TRUNCATED at ${renderDataPath(result.truncatedAt)} — maxEntries cap reached; raise --max-entries or narrow --path`
        );
      }
      return lines.join("\n");
    }

    if (!result.entries?.length) {
      return [
        `Directory: ${renderDataPath(result.directory?.path)}`,
        "No entries found.",
        ...listFooterLines(result, 0, offset)
      ].join("\n");
    }

    return [
      `Directory: ${renderDataPath(result.directory?.path)}`,
      ...result.entries.map((entry: any) => renderFileEntryListLine(entry)),
      ...listFooterLines(result, result.entries.length, offset)
    ].join("\n");
  }),
  detailRenderer("file.stat", (result) => renderFileEntryDetails(result.entry ?? {})),
  detailRenderer("file.read", (result) =>
    [
      `path: ${renderDataPath(result.file?.path)}`,
      `encoding: ${result.encoding ?? "unknown"}`,
      "",
      `${result.content ?? ""}`
    ].join("\n")
  ),
  detailRenderer("file.mkdir", (result) =>
    [
      `created: ${renderDataPath(result.directory?.path)}`,
      `kind: ${result.directory?.kind ?? "directory"}`
    ].join("\n")
  ),
  detailRenderer("file.upload", (result) =>
    [
      `uploaded: ${renderDataPath(result.file?.path)}`,
      `media category: ${result.file?.mediaCategory ?? "unknown"}`,
      `size: ${renderFileSize(result.file?.size)}`
    ].join("\n")
  ),
  detailRenderer("file.delete", (result) => {
    if (result.dryRun) {
      return [`would delete: ${renderDataPath(result.file?.path)}`, `exists: ${result.exists === true}`].join(
        "\n"
      );
    }

    return `deleted: ${renderDataPath(result.file?.path)}`;
  }),
  detailRenderer("file.move", (result) =>
    [
      `${result.dryRun ? "would move" : "moved"}: ${renderDataPath(result.from)} -> ${renderDataPath(result.file?.path)}`,
      `size: ${renderFileSize(result.file?.size)}`
    ].join("\n")
  )
]);

export function humanizeCommandResult(command: string, result: any, offset = 0) {
  const renderer = RENDERERS[command];
  return renderer ? renderer(result, offset) : JSON.stringify(result, null, 2);
}
