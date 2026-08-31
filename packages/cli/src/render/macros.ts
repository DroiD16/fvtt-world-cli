import { renderCompendiumSourceLines, renderOwnershipLines } from "./common.js";

export function renderMacroExecuteResult(result: any) {
  if (result?.dryRun) {
    return [
      `[dry-run] would execute macro ${result?.macroId}`,
      `type: ${result?.type ?? "(unknown)"}`,
      `canExecute: ${Boolean(result?.canExecute)}`,
      `command length: ${result?.commandLength ?? 0} characters`
    ].join("\n");
  }
  const lines = [
    `Executed macro ${result?.macroId}`,
    `type: ${result?.type ?? "(unknown)"}`,
    `returned: ${JSON.stringify(result?.returned ?? null, null, 2)}`
  ];
  if (result?.returnedOmitted) {
    lines.push(`returned omitted: ${result.returnedOmitted.code} — ${result.returnedOmitted.message}`);
  }
  lines.push(
    `chat messages: ${(result?.chatMessageIds ?? []).join(", ") || "(none)"}`,
    result?.chatCapture === "captured"
      ? "chat capture: captured (every message the macro created while the bridge waited)"
      : "chat capture: unknown (the macro may have created messages this call could not observe)",
    "note: Foundry swallows script-macro errors into the GM's own notifications, so verify the effect with reads"
  );
  return lines.join("\n");
}

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
