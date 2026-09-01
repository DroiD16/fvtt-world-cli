export function renderUserSummaryLine(user: any): string {
  return [
    user?.id,
    user?.name,
    `role=${user?.role ?? "?"}`,
    `GM=${Boolean(user?.isGM)}`,
    `active=${Boolean(user?.active)}`,
    `char=${user?.character ?? "-"}`
  ].join("\t");
}

export function renderUserRoleSetResult(result: any): string {
  const dryRun = Boolean(result?.dryRun);
  return [
    `${dryRun ? "Would set" : "Set"} role for user ${result?.userId}`,
    `role: ${result?.previousRole ?? "?"} → ${result?.role} (${result?.roleName ?? "?"})`,
    `changed: ${Boolean(result?.changed)}`
  ].join("\n");
}

export function renderUserPermissionsSetResult(result: any): string {
  const dryRun = Boolean(result?.dryRun);
  const overrides = Object.entries(result?.overrides ?? {});
  const lines = [
    `${dryRun ? "Would set" : "Set"} permission overrides for user ${result?.userId}`,
    `role: ${result?.role ?? "?"}`
  ];
  if (dryRun) {
    lines.push(
      "requested:",
      ...Object.entries(result?.requested ?? {}).map(
        ([name, value]) =>
          `  ${name}: ${value === null ? "drop the override (role default applies)" : String(value)}`
      )
    );
  }
  lines.push(
    overrides.length ? "overrides:" : "overrides: (none — every permission follows the role default)",
    ...overrides.map(([name, value]) => `  ${name}: ${String(value)}`)
  );
  lines.push(
    result?.permissions
      ? `effective permissions: ${
          Object.entries(result.permissions)
            .filter(([, granted]) => granted)
            .map(([name]) => name)
            .join(", ") || "(none)"
        }`
      : "effective permissions: not reported by this Foundry version"
  );
  return lines.join("\n");
}

export function renderUserDetails(user: any): string {
  return [
    `user: ${user?.name} [${user?.id}]`,
    `role: ${user?.role ?? "?"} (GM=${Boolean(user?.isGM)})`,
    `active: ${Boolean(user?.active)}`,
    `character: ${user?.character ?? "(none)"}`,
    `color: ${user?.color ?? "(none)"}`
  ].join("\n");
}
