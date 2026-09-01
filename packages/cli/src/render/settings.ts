export function renderSettingSummaryLine(setting: any): string {
  const label =
    setting?.nameLocalized && setting.nameLocalized !== setting.name
      ? `${setting.nameLocalized} [${setting.name}]`
      : (setting?.nameLocalized ?? setting?.name ?? "(unnamed)");
  return [
    setting?.id ?? `${setting?.namespace ?? "?"}.${setting?.key ?? "?"}`,
    label,
    `scope=${setting?.scope ?? "?"}`,
    `type=${setting?.type?.kind ?? "-"}`,
    `config=${Boolean(setting?.config)}`,
    `reload=${Boolean(setting?.requiresReload)}`,

    ...(setting?.metadataReadFailed ? ["metadata=UNREADABLE"] : []),
    ...(setting?.unaddressable ? ["address=UNADDRESSABLE"] : []),
    ...(setting?.valueRedacted ? ["value=REDACTED"] : [])
  ].join("\t");
}

function renderSettingValue(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

export function renderSettingWriteLines(row: any, dryRun: boolean): string[] {
  const verb = dryRun ? "would write" : row?.changed ? "wrote" : "left unchanged";
  return [
    `${verb}: ${row?.id ?? `${row?.namespace}.${row?.key}`} (scope: ${row?.scope ?? "?"})`,
    `previous: ${renderSettingValue(row?.previous)}`,
    `${dryRun ? "requested" : "value"}: ${renderSettingValue(row?.value)}`,
    `changed: ${Boolean(row?.changed)} / validated: ${Boolean(row?.validated)}`,
    ...(row?.requiresReload
      ? ["requiresReload: true — Foundry acts on this only after `system reload` or a manual browser reload"]
      : ["requiresReload: false"])
  ];
}

export function renderSettingWriteResult(result: any): string {
  return renderSettingWriteLines(result, Boolean(result?.dryRun)).join("\n");
}

export function renderSettingWriteOutcomes(result: any): string {
  const outcomes = result?.outcomes ?? [];
  const dryRun = Boolean(result?.dryRun);
  const lines = [
    `${dryRun ? "Would write" : "Wrote"} settings (${outcomes.length}) — complete: ${Boolean(result?.complete)}`,
    ...outcomes.flatMap((outcome: any) =>
      outcome?.status === "updated" || outcome?.status === "unchanged"
        ? [
            `[${outcome.index}] ${outcome.status}`,
            ...renderSettingWriteLines(outcome, dryRun).map((line) => `  ${line}`)
          ]
        : [`[${outcome?.index}] ${outcome?.status}\t${outcome?.id ?? ""}`]
    )
  ];
  if (result?.failure) {
    lines.push(`failure: ${result.failure.code} — ${result.failure.message}`);
  }
  return lines.join("\n");
}

export function renderSettingBatchRows(setting: any): string[] {
  return [
    renderSettingSummaryLine(setting),
    ...(setting?.error
      ? [`  error: ${setting.error.code} — ${setting.error.message}`]
      : [`  value: ${renderSettingValue(setting?.value)}`])
  ];
}

export function renderSettingDetails(setting: any): string {
  return [
    `setting: ${setting?.id ?? `${setting?.namespace}.${setting?.key}`}`,
    `name: ${setting?.nameLocalized ?? "(none)"}${
      setting?.name && setting.name !== setting.nameLocalized ? ` (raw: ${setting.name})` : ""
    }`,
    `hint: ${setting?.hintLocalized ?? "(none)"}${
      setting?.hint && setting.hint !== setting.hintLocalized ? ` (raw: ${setting.hint})` : ""
    }`,
    `scope: ${setting?.scope ?? "?"}`,
    `type: ${setting?.type?.kind ?? "(untyped)"}`,
    `config: ${Boolean(setting?.config)} / requiresReload: ${Boolean(setting?.requiresReload)}`,
    ...(setting?.metadataReadFailed
      ? [`metadata: UNREADABLE (${setting.metadataReadError ?? "unknown error"})`]
      : []),

    setting?.valueRedacted
      ? "value: null (REDACTED — authorization settings are never exposed through setting commands)"
      : `value: ${JSON.stringify(setting?.value ?? null, null, 2)}`
  ].join("\n");
}
