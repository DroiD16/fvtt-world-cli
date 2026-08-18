export function renderDataPath(path: unknown) {
  return String(path || "/");
}

export function renderFileSize(size: unknown) {
  return typeof size === "number" ? String(size) : "-";
}

export function renderFileEntryListLine(entry: any) {
  return `${entry.kind === "directory" ? "dir" : "file"}\t${renderDataPath(entry.path)}\t${entry.mediaCategory ?? "unknown"}\t${renderFileSize(entry.size)}`;
}

export function renderRecursiveFileEntryListLine(entry: any) {
  return `${entry.kind === "directory" ? "dir" : "file"}\td${entry.depth ?? 0}\t${renderDataPath(entry.path)}\t${entry.mediaCategory ?? "unknown"}\t${renderFileSize(entry.size)}`;
}

export function renderFileEntryDetails(entry: any) {
  return [
    `path: ${renderDataPath(entry.path)}`,
    `name: ${entry.name ?? ""}`,
    `kind: ${entry.kind ?? "unknown"}`,
    `extension: ${entry.extension ?? ""}`,
    `media category: ${entry.mediaCategory ?? "unknown"}`,
    `size: ${renderFileSize(entry.size)}`
  ].join("\n");
}
