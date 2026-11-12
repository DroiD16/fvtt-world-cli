import { renderBroadcastLines, renderProvenanceLines, renderOwnershipLines } from "./common.js";

export function renderJournalShowResult(result: any) {
  return [
    `Showed journal entry ${result?.journalId} to other users`,
    `force: ${Boolean(result?.force)}`,
    ...renderBroadcastLines(result)
  ].join("\n");
}

export function renderJournalDetails(journal: any) {
  const pages = Array.isArray(journal?.pages) ? journal.pages : [];
  const categories = Array.isArray(journal?.categories) ? journal.categories : [];
  const lines = [
    `id: ${journal?.id}`,
    `name: ${journal?.name}`,
    `folder: ${journal?.folder ?? ""}`,
    `sort: ${journal?.sort ?? 0}`,
    `pages: ${pages.length}`
  ];

  lines.push(...renderProvenanceLines(journal));

  if (journal && Object.hasOwn(journal, "ownership")) {
    lines.push(...renderOwnershipLines(journal.ownership));
  }

  if (categories.length > 0) {
    lines.push(`categories: ${categories.length}`);
    categories.forEach((category: any) => {
      const name = category?.name;
      lines.push(`category: ${category?.id ?? ""}\t${name === "" ? "(blank)" : (name ?? "")}`);
    });
  }

  pages.forEach((page: any, index: number) => {
    lines.push(...renderJournalPageLines(page, `page ${index + 1}`));
  });

  return lines.join("\n");
}

export function renderJournalCategoryDetails(journalId: string, category: any) {
  const name = category?.name;
  return [
    `journal: ${journalId}`,
    `id: ${category?.id}`,
    `name: ${name === "" ? "(blank)" : (name ?? "")}`,
    `sort: ${category?.sort ?? 0}`
  ].join("\n");
}

function renderJournalPageLines(page: any, label: string) {
  const lines: string[] = [];
  lines.push(`${label}: ${page?.id ?? ""}\t${page?.name ?? ""}\t${page?.type ?? ""}`);

  const type = page?.type;
  if (type === "image") {
    if (page?.src) {
      lines.push(`${label} src: ${page.src}`);
    }
    const caption = page?.image?.caption;
    if (typeof caption === "string" && caption.length > 0) {
      const shown = caption.length > 60 ? `${caption.slice(0, 60)}…` : caption;
      lines.push(`${label} caption: ${shown}`);
    } else {
      lines.push(`${label} caption: (none)`);
    }
  } else if (type === "video") {
    if (page?.src) {
      lines.push(`${label} src: ${page.src}`);
    }
  } else if (type === "pdf") {
    if (page?.src) {
      lines.push(`${label} src: ${page.src}`);
    }
  } else {
    const format = page?.text?.format;
    if (format === 2) {
      lines.push(`${label} format: markdown`);
    } else if (format === 1) {
      lines.push(`${label} format: html`);
    }
    if (page?.text?.content) {
      lines.push(`${label} text: ${page.text.content}`);
    }
    if (page?.src) {
      lines.push(`${label} src: ${page.src}`);
    }
  }

  const title = page?.title;
  if (title && (title.show === false || (typeof title.level === "number" && title.level !== 1))) {
    const bits: string[] = [];
    if (title.show === false) bits.push("show=false");
    if (typeof title.level === "number" && title.level !== 1) bits.push(`level=${title.level}`);
    lines.push(`${label} title: ${bits.join(" ")}`);
  }

  if (page?.category) {
    lines.push(`${label} category: ${page.category}`);
  }

  if (page && Object.hasOwn(page, "ownership")) {
    lines.push(...renderOwnershipLines(page.ownership).map((line) => `${label} ${line}`));
  }
  return lines;
}

export function renderJournalPageDetails(journalId: string, page: any) {
  return [`journal: ${journalId}`, ...renderJournalPageLines(page, "page")].join("\n");
}
