import { renderCompendiumSourceLines, renderOwnershipLines } from "./common.js";

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

  lines.push(...renderCompendiumSourceLines(journal));

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
    const pageNumber = index + 1;
    lines.push(`page ${pageNumber}: ${page?.id ?? ""}\t${page?.name ?? ""}\t${page?.type ?? ""}`);

    const type = page?.type;
    if (type === "image") {
      if (page?.src) {
        lines.push(`page ${pageNumber} src: ${page.src}`);
      }
      const caption = page?.image?.caption;
      if (typeof caption === "string" && caption.length > 0) {
        const shown = caption.length > 60 ? `${caption.slice(0, 60)}…` : caption;
        lines.push(`page ${pageNumber} caption: ${shown}`);
      } else {
        lines.push(`page ${pageNumber} caption: (none)`);
      }
    } else if (type === "video") {
      if (page?.src) {
        lines.push(`page ${pageNumber} src: ${page.src}`);
      }
    } else if (type === "pdf") {
      if (page?.src) {
        lines.push(`page ${pageNumber} src: ${page.src}`);
      }
    } else {
      const format = page?.text?.format;
      if (format === 2) {
        lines.push(`page ${pageNumber} format: markdown`);
      } else if (format === 1) {
        lines.push(`page ${pageNumber} format: html`);
      }
      if (page?.text?.content) {
        lines.push(`page ${pageNumber} text: ${page.text.content}`);
      }
      if (page?.src) {
        lines.push(`page ${pageNumber} src: ${page.src}`);
      }
    }

    const title = page?.title;
    if (title && (title.show === false || (typeof title.level === "number" && title.level !== 1))) {
      const bits: string[] = [];
      if (title.show === false) bits.push("show=false");
      if (typeof title.level === "number" && title.level !== 1) bits.push(`level=${title.level}`);
      lines.push(`page ${pageNumber} title: ${bits.join(" ")}`);
    }

    if (page?.category) {
      lines.push(`page ${pageNumber} category: ${page.category}`);
    }

    if (page && Object.hasOwn(page, "ownership")) {
      lines.push(...renderOwnershipLines(page.ownership).map((line) => `page ${pageNumber} ${line}`));
    }
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
