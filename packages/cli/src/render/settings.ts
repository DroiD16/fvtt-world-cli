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
