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

export function renderUserDetails(user: any): string {
  return [
    `user: ${user?.name} [${user?.id}]`,
    `role: ${user?.role ?? "?"} (GM=${Boolean(user?.isGM)})`,
    `active: ${Boolean(user?.active)}`,
    `character: ${user?.character ?? "(none)"}`,
    `color: ${user?.color ?? "(none)"}`
  ].join("\n");
}
