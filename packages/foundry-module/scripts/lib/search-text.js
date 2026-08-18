import {
  SEARCH_DOC_TEXT_MAX_CHARS,
  SEARCH_SNIPPET_FIELDS,
  SEARCH_SNIPPET_MAX_CHARS,
  SEARCH_SNIPPET_MAX_MATCHES,
  SEARCH_SNIPPET_RADIUS,
  SEARCH_SYSTEM_WALK_MAX_BYTES,
  SEARCH_SYSTEM_WALK_MAX_DEPTH,
  SEARCH_SYSTEM_WALK_MAX_NODES
} from "../generated/protocol.js";

const HTML_BLOCK =
  /<!--[\s\S]*?(?:-->|$)|<(script|style)(?=[\t\n\f\r />]|$)[^>]*(?:>|$)[\s\S]*?(?:<\/\1\s*>|$)/gi;

const HTML_TAG = /<\/?[A-Za-z!?][^>]*>/g;

/**
 * @param {string} value
 * @returns {string}
 */
const QUOTED_ATTR_VALUE = /=\s*(?:"(?:[^"<]|<(?![A-Za-z!?/]))*"|'(?:[^'<]|<(?![A-Za-z!?/]))*')/g;

function neutralizeQuotedAttributeBreaks(value) {
  return value.replace(QUOTED_ATTR_VALUE, (whole) =>
    whole.includes(">") ? whole.replace(/>/g, " ") : whole
  );
}

/**
 * @param {string} value
 * @returns {string}
 */
function stripTags(value) {
  const lastGt = value.lastIndexOf(">");
  if (lastGt === -1) {
    return value;
  }
  if (lastGt === value.length - 1) {
    return value.replace(HTML_TAG, " ");
  }
  return value.slice(0, lastGt + 1).replace(HTML_TAG, " ") + value.slice(lastGt + 1);
}

const NAMED_ENTITIES = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  ldquo: '"',
  rdquo: '"',
  lsquo: "'",
  rsquo: "'"
});

const ENTITY = /&(#\d{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g;

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/**
 * @param {string} whole
 * @param {string} body
 */
function decodeEntity(whole, body) {
  if (body.startsWith("#")) {
    const hex = body[1] === "x" || body[1] === "X";
    const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
      return whole;
    }

    if (code >= 0xd800 && code <= 0xdfff) {
      return whole;
    }
    return String.fromCodePoint(code);
  }

  if (Object.hasOwn(NAMED_ENTITIES, body)) {
    return NAMED_ENTITIES[body];
  }
  const lowered = body.toLowerCase();
  return Object.hasOwn(NAMED_ENTITIES, lowered) ? NAMED_ENTITIES[lowered] : whole;
}

/**
 * @param {unknown} value
 * @param {{textLostToUnterminatedBlock?: boolean} | null} [report]
 * @returns {string}
 */
export function stripSearchHtml(value, report = null) {
  if (typeof value !== "string" || value === "") {
    return "";
  }

  const withoutBlocks = value.replace(HTML_BLOCK, (whole, tag, offset, input) => {
    const lost =
      tag === undefined
        ? lostTailToUnterminatedComment(whole, offset, input)
        : lostTailToUnterminatedBlock(whole, tag, offset, input);
    if (report && lost) {
      report.textLostToUnterminatedBlock = true;
    }
    return " ";
  });
  return stripTags(neutralizeQuotedAttributeBreaks(withoutBlocks))
    .replace(ENTITY, decodeEntity)
    .replace(CONTROL_CHARS, " ")
    .replace(LONE_SURROGATE, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .normalize("NFC");
}

/**
 * @param {string} whole
 * @param {string} tag
 * @param {number} offset
 * @param {string} input
 */
function lostTailToUnterminatedBlock(whole, tag, offset, input) {
  if (offset + whole.length !== input.length) {
    return false;
  }
  if (new RegExp(`</${tag}\\s*>$`, "i").test(whole)) {
    return false;
  }
  const openerEnd = whole.indexOf(">");
  const tailStart = openerEnd === -1 ? "<".length + tag.length : openerEnd + 1;
  return /\S/u.test(whole.slice(tailStart));
}

/**
 * @param {string} whole
 * @param {number} offset
 * @param {string} input
 */
function lostTailToUnterminatedComment(whole, offset, input) {
  if (offset + whole.length !== input.length) {
    return false;
  }
  if (whole.endsWith("-->")) {
    return false;
  }
  return /\S/u.test(whole.slice("<!--".length));
}

/**
 * @param {string} value
 * @param {number} cap
 * @returns {string}
 */
export function clipWithoutSplittingPair(value, cap) {
  if (cap <= 0) {
    return "";
  }
  const end = isHighSurrogate(value.charCodeAt(cap - 1)) ? cap - 1 : cap;
  return value.slice(0, end);
}

const FOUNDRY_ID = /^[A-Za-z0-9]{16}$/;

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const ASSET_EXTENSION =
  /\.(?:webp|webm|png|jpe?g|gif|svg|avif|mp4|m4a|ogg|ogv|mp3|wav|flac|pdf|json|hbs|css|js|mjs|txt|md)$/i;

/** @param {string} value */
function looksLikePathOrUrl(value) {
  if (/\s/u.test(value)) {
    return false;
  }
  return URL_SCHEME.test(value) || value.includes("/") || ASSET_EXTENSION.test(value);
}

const SYSTEM_WALK_MIN_STRING = 3;

/** @param {string} stripped */
function isCollectibleSystemString(stripped) {
  return (
    stripped.length >= SYSTEM_WALK_MIN_STRING && !FOUNDRY_ID.test(stripped) && !looksLikePathOrUrl(stripped)
  );
}

/** @param {unknown} value */
function couldContributeText(value) {
  if (typeof value === "string") {
    const report = { textLostToUnterminatedBlock: false };
    const stripped = stripSearchHtml(value, report);
    return report.textLostToUnterminatedBlock || isCollectibleSystemString(stripped);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  return (Array.isArray(value) ? value : Object.values(/** @type {object} */ (value))).length > 0;
}

/**
 * @param {unknown} system
 * @returns {{text: string, truncated: boolean}}
 */
export function walkSystemText(system) {
  /** @type {string[]} */
  const parts = [];
  let chars = 0;
  let nodes = 0;

  let truncated = false;
  let stopped = false;

  /**
   * @param {unknown} value
   * @param {number} depth
   * @param {boolean} dropping
   */
  const visit = (value, depth, dropping) => {
    if (stopped) {
      return;
    }
    if (dropping && truncated) {
      return;
    }
    nodes += 1;
    if (nodes > SEARCH_SYSTEM_WALK_MAX_NODES) {
      stopped = true;

      if (couldContributeText(value)) {
        truncated = true;
      }
      return;
    }
    if (typeof value === "string") {
      const report = { textLostToUnterminatedBlock: false };
      const stripped = stripSearchHtml(value, report);
      if (report.textLostToUnterminatedBlock) {
        truncated = true;
      }
      if (!isCollectibleSystemString(stripped)) {
        return;
      }
      if (dropping) {
        truncated = true;
        return;
      }

      const separator = parts.length > 0 ? 1 : 0;
      const remaining = SEARCH_SYSTEM_WALK_MAX_BYTES - chars - separator;
      if (remaining <= 0) {
        truncated = true;
        stopped = true;
        return;
      }
      if (stripped.length > remaining) {
        const clipped = clipWithoutSplittingPair(stripped, remaining);

        if (clipped !== "") {
          parts.push(clipped);
          chars += separator + clipped.length;
        }
        truncated = true;
        stopped = true;
        return;
      }
      parts.push(stripped);
      chars += separator + stripped.length;
      return;
    }
    if (value === null || typeof value !== "object") {
      return;
    }

    const entries = Array.isArray(value) ? value : Object.values(/** @type {object} */ (value));

    const deeper = dropping || depth >= SEARCH_SYSTEM_WALK_MAX_DEPTH;
    for (let index = 0; index < entries.length; index += 1) {
      visit(entries[index], depth + 1, deeper);
      if (stopped) {
        if (index < entries.length - 1) {
          truncated = true;
        }
        return;
      }
    }
  };

  visit(system, 0, false);
  return { text: parts.join(" "), truncated };
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} field
 * @returns {string[]}
 */
function readTextFieldParts(source, field) {
  const value = source?.[field];
  if (typeof value === "string") {
    return [value];
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const parts = [];
  for (const key of ["content", "markdown"]) {
    const part = /** @type {any} */ (value)[key];
    if (typeof part === "string" && part !== "") {
      parts.push(part);
    }
  }
  return parts;
}

/**
 * @param {any} doc
 * @returns {Record<string, unknown>}
 */
function storedData(doc) {
  const source = doc?._source;
  if (source && typeof source === "object") {
    return source;
  }
  if (typeof doc?.toObject === "function") {
    try {
      const object = doc.toObject();
      if (object && typeof object === "object") {
        return object;
      }
    } catch {
      return {};
    }
  }
  return doc && typeof doc === "object" ? /** @type {any} */ (doc) : {};
}

/**
 * @param {any} doc
 * @param {string[]} fields
 * @returns {{text: string, systemText: string, truncated: boolean}}
 */
export function extractDocumentText(doc, fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    return { text: "", systemText: "", truncated: false };
  }
  const source = storedData(doc);
  /** @type {string[]} */
  const textParts = [];
  let systemText = "";
  let truncated = false;

  for (const field of fields) {
    if (field === "system") {
      const walked = walkSystemText(source?.system);
      systemText = walked.text;

      truncated = truncated || walked.truncated;
      continue;
    }
    for (const part of readTextFieldParts(source, field)) {
      const report = { textLostToUnterminatedBlock: false };
      const stripped = stripSearchHtml(part, report);
      if (report.textLostToUnterminatedBlock) {
        truncated = true;
      }
      if (stripped) {
        textParts.push(stripped);
      }
    }
  }

  let text = textParts.join(" ");
  if (text.length > SEARCH_DOC_TEXT_MAX_CHARS) {
    text = clipWithoutSplittingPair(text, SEARCH_DOC_TEXT_MAX_CHARS);
    truncated = true;
  }
  return { text, systemText, truncated };
}

/**
 * @param {string} value
 * @returns {string}
 */
function foldPreservingLength(value) {
  let folded = "";
  for (const codePoint of value) {
    const lowered = codePoint.toLowerCase().replace(/ё/g, "е");
    folded += lowered.length === codePoint.length ? lowered : codePoint;
  }
  return folded;
}

/**
 * @param {string} query
 * @returns {string[]}
 */
export function foldSearchQueryTerms(query) {
  return String(query ?? "")
    .normalize("NFC")
    .split(/[\n\r\p{Z}\p{P}]+/u)
    .map((term) => foldPreservingLength(term))
    .filter((term) => term.length > 0);
}

/**
 * @param {string} member
 * @returns {string}
 */
export function snippetField(member) {
  if (!SEARCH_SNIPPET_FIELDS.includes(member)) {
    throw new Error(`snippetField: unknown search snippet field ${JSON.stringify(member)}`);
  }
  return member;
}

/**
 * @param {{text: string, systemText: string, truncated: boolean}} extracted
 * @param {string} name
 * @param {string[]} terms
 * @returns {{field: string, text: string, matches: {start: number, length: number}[], truncated: boolean} | null}
 */
export function buildSearchSnippet(extracted, name, terms) {
  if (!terms.length) {
    return null;
  }

  const candidates = {
    text: () => extracted.text,
    systemText: () => extracted.systemText,

    name: () => stripSearchHtml(name)
  };

  for (const field of SEARCH_SNIPPET_FIELDS) {
    const value = Object.hasOwn(candidates, field) ? candidates[field]() : "";
    if (!value) {
      continue;
    }
    const folded = foldPreservingLength(value);
    const first = firstOccurrence(folded, terms);
    if (!first) {
      continue;
    }

    let start = Math.max(0, first.start - SEARCH_SNIPPET_RADIUS);
    let end = Math.min(value.length, first.start + first.length + SEARCH_SNIPPET_RADIUS);
    const lead = start > 0;
    let trail = end < value.length;
    let budget = SEARCH_SNIPPET_MAX_CHARS - (lead ? 1 : 0) - (trail ? 1 : 0);
    if (end - start > budget) {
      end = start + budget;
      trail = end < value.length;
      budget = SEARCH_SNIPPET_MAX_CHARS - (lead ? 1 : 0) - (trail ? 1 : 0);
      if (end - start > budget) {
        end = start + budget;
      }
    }

    if (start > 0 && isLowSurrogate(value.charCodeAt(start))) {
      start += 1;
    }
    if (end < value.length && end > start && isHighSurrogate(value.charCodeAt(end - 1))) {
      end -= 1;
    }

    const body = value.slice(start, end);
    const text = `${lead ? "…" : ""}${body}${trail ? "…" : ""}`;
    const shift = (lead ? 1 : 0) - start;
    const inWindow = occurrencesInWindow(folded, terms, start, end);
    if (inWindow.length === 0 && first.start >= start && first.start < end) {
      inWindow.push({ start: first.start, length: end - first.start });
    }
    return {
      field: snippetField(field),
      text,

      matches: inWindow.map((match) => ({
        start: match.start + shift,
        length: match.length
      })),

      truncated: extracted.truncated === true
    };
  }
  return null;
}

/** @param {number} unit */
function isHighSurrogate(unit) {
  return unit >= 0xd800 && unit <= 0xdbff;
}

/** @param {number} unit */
function isLowSurrogate(unit) {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/**
 * @param {string} folded
 * @param {string[]} terms
 */
function firstOccurrence(folded, terms) {
  /** @type {{start: number, length: number} | null} */
  let best = null;
  for (const term of terms) {
    const index = folded.indexOf(term);
    if (index === -1) {
      continue;
    }
    if (!best || index < best.start || (index === best.start && term.length > best.length)) {
      best = { start: index, length: term.length };
    }
  }
  return best;
}

/**
 * @param {string} folded
 * @param {string[]} terms
 * @param {number} start
 * @param {number} end
 */
function occurrencesInWindow(folded, terms, start, end) {
  /** @type {{start: number, length: number}[]} */
  const found = [];
  for (const term of terms) {
    let index = folded.indexOf(term, start);
    while (index !== -1 && index + term.length <= end) {
      found.push({ start: index, length: term.length });
      index = folded.indexOf(term, index + term.length);
    }
  }
  found.sort((left, right) => left.start - right.start || right.length - left.length);
  /** @type {{start: number, length: number}[]} */
  const kept = [];
  let cursor = -1;
  for (const match of found) {
    if (match.start < cursor) {
      continue;
    }
    kept.push(match);
    cursor = match.start + match.length;
    if (kept.length >= SEARCH_SNIPPET_MAX_MATCHES) {
      break;
    }
  }
  return kept;
}
