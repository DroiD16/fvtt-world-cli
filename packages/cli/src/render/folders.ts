export function renderFolderDetails(folder: any) {
  return [
    `id: ${folder?.id}`,
    `name: ${folder?.name}`,
    `type: ${folder?.type ?? ""}`,
    `folder: ${folder?.folder ?? ""}`,
    `color: ${folder?.color ?? ""}`,
    `sorting: ${folder?.sorting ?? ""}`,
    `sort: ${folder?.sort ?? 0}`,
    `description: ${folder?.description ?? ""}`,
    `childFolderCount: ${folder?.childFolderCount ?? 0}`,
    `documentCount: ${folder?.documentCount ?? 0}`,
    `flags: ${JSON.stringify(folder?.flags ?? {}, null, 2)}`
  ].join("\n");
}
