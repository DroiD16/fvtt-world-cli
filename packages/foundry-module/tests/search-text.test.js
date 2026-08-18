import { describe, expect, it, vi } from "vitest";

import {
  SEARCH_DOC_TEXT_MAX_CHARS,
  SEARCH_SNIPPET_FIELDS,
  SEARCH_SNIPPET_MAX_CHARS,
  SEARCH_SNIPPET_MAX_MATCHES,
  SEARCH_SNIPPET_RADIUS,
  SEARCH_SYSTEM_WALK_MAX_BYTES,
  SEARCH_SYSTEM_WALK_MAX_DEPTH,
  SEARCH_SYSTEM_WALK_MAX_NODES
} from "../scripts/generated/protocol.js";
import {
  buildSearchSnippet,
  extractDocumentText,
  foldSearchQueryTerms,
  snippetField,
  stripSearchHtml,
  walkSystemText
} from "../scripts/lib/search-text.js";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("stripSearchHtml", () => {
  it("turns every tag into a SPACE, never the empty string", () => {
    expect(stripSearchHtml("<b>Fire</b><b>ball</b>")).toBe("Fire ball");
    expect(stripSearchHtml("<p>Docks <em>ledger</em></p>")).toBe("Docks ledger");
    expect(stripSearchHtml('<a href="worlds/x/a.webp">link</a>')).toBe("link");

    expect(stripSearchHtml("line<br/>break")).toBe("line break");
  });

  it("drops <script>/<style> WITH their content, and comments whole", () => {
    expect(stripSearchHtml("a<script>alert('x')</script>b")).toBe("a b");
    expect(stripSearchHtml("a<style>.k{color:red}</style>b")).toBe("a b");
    expect(stripSearchHtml("a<!-- hidden note -->b")).toBe("a b");

    expect(stripSearchHtml('a<SCRIPT type="text/js">\nvar x = 1;\n</SCRIPT>b')).toBe("a b");

    expect(stripSearchHtml("a<script>secret body never closed")).toBe("a");
    expect(stripSearchHtml("a<!-- unterminated comment")).toBe("a");
  });

  it("claims ONLY the tag names `script`/`style`, so a custom element keeps its prose", () => {
    const noteReport = {};
    expect(stripSearchHtml("<script-note>visible prose</script-note> tail here", noteReport)).toBe(
      "visible prose tail here"
    );
    expect(noteReport).toEqual({});
    const guideReport = {};
    expect(stripSearchHtml("<style-guide>see the guide</style-guide> more prose", guideReport)).toBe(
      "see the guide more prose"
    );
    expect(guideReport).toEqual({});

    expect(stripSearchHtml("<script\ttype=x>body</script> ok")).toBe("ok");
    expect(stripSearchHtml("<STYLE>body{}</STYLE>keep")).toBe("keep");
    expect(stripSearchHtml("a<script/>swallowed")).toBe("a");

    expect(stripSearchHtml("<scripting>ordinary</scripting> prose")).toBe("ordinary prose");

    expect(stripSearchHtml("<script\u00a0type=x>alert(1)</script> tail")).toBe("alert(1) tail");
    expect(stripSearchHtml("<script type=x>alert(1)</script> tail")).toBe("tail");
  });

  it("resolves an INTERLEAVED comment/script by which opener comes first in the TEXT", () => {
    expect(stripSearchHtml("<!-- old <script src=x.js> markup --> real prose here")).toBe("real prose here");
    expect(stripSearchHtml("<p>intro</p><!-- TODO restore the <script> block --> five thousand words")).toBe(
      "intro five thousand words"
    );

    expect(stripSearchHtml('<script>var x = "<!--";</script> real prose here')).toBe("real prose here");
    expect(stripSearchHtml('a<style>.k{content:"<!--"}</style>b')).toBe("a b");

    expect(stripSearchHtml("keep<!-- a <script>b")).toBe("keep");
    expect(stripSearchHtml("keep<script>a <!--b")).toBe("keep");

    const flagOf = (value) => {
      const report = { textLostToUnterminatedBlock: false };
      stripSearchHtml(value, report);
      return report.textLostToUnterminatedBlock;
    };

    expect(flagOf("keep<!-- a <script>b")).toBe(true);
    expect(flagOf("keep<script>a <!--b")).toBe(true);

    expect(flagOf("<!-- old <script src=x.js> markup --> real prose here")).toBe(false);
    expect(flagOf('<script>var x = "<!--";</script> real prose here')).toBe(false);
    expect(flagOf("a<!-- x --><script>y</script>b")).toBe(false);
    expect(flagOf("a<script>y</script><!-- x -->b")).toBe(false);

    expect(flagOf("<!--<script")).toBe(true);

    expect(stripSearchHtml("a<!-- x --><script>y</script>b")).toBe("a b");
    expect(stripSearchHtml("a<script>y</script><!-- x -->b")).toBe("a b");
  });

  it("is LINEAR in the field's length, so ONE stored field cannot hold the GM client's main thread", () => {
    const budgetMs = 2_000;
    const hostile = [
      "<a".repeat(256_000), // 500 KB, no `>` at all
      `>${"<a".repeat(256_000)}`, // the same, with the only `>` at the very front
      "<script".repeat(73_142), // 500 KB of unterminated openers
      "<a href=x".repeat(56_888), // attribute-shaped starts, so the failing scan is longer per start

      `${"<a".repeat(255_998)}="${">"}`,

      `${'<a="x>"'.repeat(71_428)}>`,

      `${'<a href="x> y'.repeat(38_461)}>`,

      `${`="${"a".repeat(100)}<3`.repeat(5_000)}>`,
      `${`="${"a".repeat(100)}< 3`.repeat(5_000)}">`,
      `<a="${"x".repeat(500_000)}`,

      "<script-".repeat(62_500),
      "<style-x".repeat(62_500)
    ];
    for (const value of hostile) {
      const started = Date.now();
      stripSearchHtml(value);
      expect(Date.now() - started, `stripping ${value.length} code units`).toBeLessThan(budgetMs);
    }
  });

  it("matches EXACTLY what an unclipped tag scan would, on both sides of the last `>`", () => {
    expect(stripSearchHtml("<a".repeat(3))).toBe("<a<a<a");

    expect(stripSearchHtml("<b>x</b> a<b y")).toBe("x a<b y");
    expect(stripSearchHtml("a<b> tail with no gt")).toBe("a tail with no gt");

    expect(stripSearchHtml("if a<b then")).toBe("if a<b then");
  });

  it("leaves a bare `<` that is not a tag alone, so plain-text descriptions keep their terms", () => {
    expect(stripSearchHtml("5 < 10 > 3")).toBe("5 < 10 > 3");
    expect(stripSearchHtml("a < b and c > d")).toBe("a < b and c > d");

    expect(stripSearchHtml("5 < 10 <b>ten</b>")).toBe("5 < 10 ten");
  });

  it("keeps a QUOTED attribute value's `>` from ending the tag early, so no attribute leaks as prose", () => {
    expect(stripSearchHtml('<a title="private > leaked">Visible</a>')).toBe("Visible");
    expect(stripSearchHtml("<a title='x > y'>Vis</a>")).toBe("Vis");

    expect(stripSearchHtml('<img alt="a > b" src="x.png">text')).toBe("text");

    expect(stripSearchHtml('<a title = "a > b">v</a>')).toBe("v");

    expect(stripSearchHtml('<a "x > y">v</a>')).toBe('y">v');

    expect(stripSearchHtml('note x="a>b" end')).toBe('note x="a b" end');

    expect(stripSearchHtml('<a title="a > b"')).toBe('<a title="a b"');

    expect(stripSearchHtml("5 < 10 > 3")).toBe("5 < 10 > 3");
    expect(stripSearchHtml("if a<b then")).toBe("if a<b then");
    expect(stripSearchHtml('<a class="content-link" data-uuid="Actor.x">Goblin</a>')).toBe("Goblin");

    expect(stripSearchHtml('<a title="private < value > leaked" href="secret.png">Visible</a>')).toBe(
      "Visible"
    );
    expect(stripSearchHtml('<img alt="a < b > c" src="x.png">text')).toBe("text");
    expect(stripSearchHtml("<a title='a < b > c' src='x.png'>text</a>")).toBe("text");

    expect(stripSearchHtml('<a href="a.webp>link</a><p>Big prose paragraph</p><img src="b.png">')).toBe(
      "link Big prose paragraph"
    );

    expect(stripSearchHtml('<a href="a.webp> tail " more>x')).toBe("x");
    expect(stripSearchHtml('<a href="a.webp> tail <3 more "x>y')).toBe("y");

    expect(stripSearchHtml('<a title="x </ y > z">v</a>')).toBe('z">v');
    expect(stripSearchHtml('<a title="x < /y > z">v</a>')).toBe("v");
  });

  it("decodes entities from the fixed table, AFTER tag removal", () => {
    expect(stripSearchHtml("Salt &amp; Marsh")).toBe("Salt & Marsh");
    expect(stripSearchHtml("&quot;quoted&quot; &apos;single&apos;")).toBe("\"quoted\" 'single'");
    expect(stripSearchHtml("&#65;&#x42;C")).toBe("ABC");
    expect(stripSearchHtml("&#1071;&#x44F;")).toBe("Яя");

    expect(stripSearchHtml("A &AMP; B")).toBe("A & B");

    expect(stripSearchHtml("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe("<script>alert(1)</script>");

    expect(stripSearchHtml("a &notarealentity; b")).toBe("a &notarealentity; b");
    expect(stripSearchHtml("a &#1114112; b")).toBe("a &#1114112; b");

    expect(stripSearchHtml("a &#xD800; b")).toBe("a &#xD800; b");
  });

  it("leaves a PROTOTYPE-named reference verbatim, so no phantom text can reach the wire", () => {
    for (const name of [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "isPrototypeOf",
      "propertyIsEnumerable",
      "toLocaleString"
    ]) {
      expect(stripSearchHtml(`The ledger &${name}; entry`)).toBe(`The ledger &${name}; entry`);

      expect(stripSearchHtml(`a &${name.toUpperCase()}; b`)).toBe(`a &${name.toUpperCase()}; b`);
    }
  });

  it("scrubs C0/C1 CONTROL characters, decoded or stored literally", () => {
    expect(stripSearchHtml("a&#0;b")).toBe("a b");
    expect(stripSearchHtml("a&#1;&#31;b")).toBe("a b");

    expect(stripSearchHtml("a&#127;&#155;b")).toBe("a b");
    expect(stripSearchHtml("a&#x85;b")).toBe("a b");

    expect(stripSearchHtml("a\u0001b\u001fc\u009fd")).toBe("a b c d");

    expect(stripSearchHtml("a\tb\r\nc")).toBe("a b c");
    for (const value of [stripSearchHtml("a&#0;b"), stripSearchHtml("a\u0085b")]) {
      expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)).toBe(false);
    }
  });

  it("scrubs an UNPAIRED surrogate stored LITERALLY, while a valid pair survives", () => {
    expect(stripSearchHtml("prose \ud800 ledger")).toBe("prose ledger");

    expect(stripSearchHtml("prose \udc00 ledger")).toBe("prose ledger");
    expect(stripSearchHtml("\ud800prose")).toBe("prose");
    expect(stripSearchHtml("prose\udfff")).toBe("prose");

    expect(stripSearchHtml("fire\ud800ball")).toBe("fire ball");

    expect(stripSearchHtml("roll 🎲 now")).toBe("roll 🎲 now");
    expect(stripSearchHtml("🎲")).toBe("🎲");
    expect(stripSearchHtml("a🎲b\ud800c")).toBe("a🎲b c");
    for (const value of ["prose \ud800 ledger", "a🎲b\ud800c", "\udc00\ud800"]) {
      expect(LONE_SURROGATE.test(stripSearchHtml(value)), value).toBe(false);
    }
  });

  it("collapses whitespace to single spaces and NFC-normalizes, so a snippet is one line", () => {
    expect(stripSearchHtml("  a\n\n\tb   c  ")).toBe("a b c");

    expect(stripSearchHtml("a&nbsp;&nbsp;b")).toBe("a b");

    const decomposed = "й";
    expect(stripSearchHtml(decomposed)).toBe("й");
    expect(stripSearchHtml(decomposed).length).toBe(1);
  });

  it("returns an empty string for anything that is not a non-empty string", () => {
    for (const value of [null, undefined, 42, {}, [], ""]) {
      expect(stripSearchHtml(value)).toBe("");
    }
  });
});

describe("walkSystemText", () => {
  it("collects human strings and drops ids, paths, URLs, numbers and short values", () => {
    const walked = walkSystemText({
      description: { value: "<p>A gleaming blade</p>" },
      identifier: "abcdefghijklmnop",
      img: "icons/svg/sword.webp",
      art: "worlds/mine/assets/token.png",
      link: "https://example.com/page",
      bare: "token-art.webp",
      ab: "no",
      weight: 3,
      equipped: true,
      nothing: null
    });
    expect(walked.text).toContain("A gleaming blade");
    for (const dropped of [
      "abcdefghijklmnop",
      "icons",
      "worlds",
      "example.com",
      "token-art.webp",
      "no",
      "3",
      "true"
    ]) {
      expect(walked.text, `${dropped} must not be collected`).not.toContain(dropped);
    }
    expect(walked.truncated).toBe(false);
  });

  it("keeps PROSE that merely contains a slash — the path test requires no whitespace", () => {
    const walked = walkSystemText({ note: "he/she guards the inner door" });
    expect(walked.text).toBe("he/she guards the inner door");
  });

  it("bounds DEPTH: just inside is collected, just outside is skipped, siblings survive", () => {
    /** @param {number} depth */
    const nest = (depth, marker) => {
      /** @type {any} */
      let node = marker;
      for (let i = 0; i < depth; i += 1) {
        node = { down: node };
      }
      return node;
    };

    const inside = walkSystemText({ a: nest(SEARCH_SYSTEM_WALK_MAX_DEPTH - 2, "zinbound") });
    expect(inside.text).toContain("zinbound");
    expect(inside.truncated).toBe(false);
    const outside = walkSystemText({
      a: nest(SEARCH_SYSTEM_WALK_MAX_DEPTH + 1, "qfaraway"),
      b: "ztailword"
    });
    expect(outside.text).not.toContain("qfaraway");

    expect(outside.truncated).toBe(true);
    expect(outside.text).toContain("ztailword");
  });

  it("reports a DEPTH skip only when it actually cost the document a string", () => {
    /** @param {number} depth */
    const nest = (depth, leaf) => {
      /** @type {any} */
      let node = leaf;
      for (let i = 0; i < depth; i += 1) {
        node = { down: node };
      }
      return node;
    };

    const numbersOnly = walkSystemText({
      deepNumbers: nest(SEARCH_SYSTEM_WALK_MAX_DEPTH + 4, 42),
      note: "a real description"
    });
    expect(numbersOnly.text).toBe("a real description");
    expect(numbersOnly.truncated).toBe(false);

    const unindexableOnly = walkSystemText({
      deepAssets: nest(SEARCH_SYSTEM_WALK_MAX_DEPTH + 1, [
        "icons/svg/mystery-man.svg",
        "abcdefghij123456",
        "ab"
      ]),
      note: "a real description"
    });
    expect(unindexableOnly.truncated).toBe(false);

    const stringLost = walkSystemText({
      deepProse: nest(SEARCH_SYSTEM_WALK_MAX_DEPTH + 1, "a description nobody can find"),
      note: "a real description"
    });
    expect(stringLost.text).toBe("a real description");
    expect(stringLost.truncated).toBe(true);
  });

  it("bounds BYTES, keeping the collected prefix and clipping mid-string", () => {
    const long = "abcdefghij".repeat(1000);
    const walked = walkSystemText({ body: long });
    expect(walked.text).toHaveLength(SEARCH_SYSTEM_WALK_MAX_BYTES);
    expect(walked.truncated).toBe(true);

    expect(long.startsWith(walked.text)).toBe(true);

    const fits = walkSystemText({ body: "x".repeat(SEARCH_SYSTEM_WALK_MAX_BYTES) });
    expect(fits.text).toHaveLength(SEARCH_SYSTEM_WALK_MAX_BYTES);
    expect(fits.truncated).toBe(false);

    const straddling = walkSystemText({
      body: `${"y".repeat(SEARCH_SYSTEM_WALK_MAX_BYTES - 1)}🎲 tail`
    });
    expect(LONE_SURROGATE.test(straddling.text)).toBe(false);
    expect(straddling.text).toHaveLength(SEARCH_SYSTEM_WALK_MAX_BYTES - 1);
    expect(straddling.truncated).toBe(true);
  });

  it("bounds the RETURNED string, separators included, over MANY parts", () => {
    const parts = {};
    for (let index = 0; index < 1_200; index += 1) {
      parts[`k${index}`] = "abcdefghij";
    }
    const walked = walkSystemText(parts);
    expect(walked.text.length).toBeLessThanOrEqual(SEARCH_SYSTEM_WALK_MAX_BYTES);
    expect(walked.truncated).toBe(true);

    expect(walked.text).not.toMatch(/ {2}| $/);

    const fits = walkSystemText({ a: "abc", b: "def" });
    expect(fits).toEqual({ text: "abc def", truncated: false });
  });

  it("bounds NODES, which ends the walk (a global budget, unlike depth)", () => {
    const many = Array.from({ length: SEARCH_SYSTEM_WALK_MAX_NODES + 50 }, (_, i) => `w${String(i % 7)}x`);
    const walked = walkSystemText({ many });
    expect(walked.truncated).toBe(true);
    expect(walked.text.length).toBeLessThan(SEARCH_SYSTEM_WALK_MAX_BYTES);

    expect(walked.text.split(" ").length).toBeLessThanOrEqual(SEARCH_SYSTEM_WALK_MAX_NODES);
    const few = walkSystemText({ many: ["w0x", "w1x"] });
    expect(few.truncated).toBe(false);
  });

  it("judges the NODE budget exactly on its boundary value and conservatively on the work behind it", () => {
    const numbers = (count) => {
      const object = {};
      for (let index = 0; index < count; index += 1) {
        object[`n${index}`] = index;
      }
      return object;
    };

    const numbersOnly = walkSystemText({ note: "a real description", ...numbers(1_999) });
    expect(numbersOnly).toEqual({ text: "a real description", truncated: false });

    expect(walkSystemText(numbers(2_000)).truncated).toBe(false);

    expect(walkSystemText(numbers(2_001)).truncated).toBe(true);
    expect(walkSystemText(numbers(2_500))).toEqual({ text: "", truncated: true });

    expect(walkSystemText({ ...numbers(1_999), note: "a real description" }).truncated).toBe(true);

    expect(walkSystemText({ ...numbers(1_999), note: "<script>secret tail never closed" }).truncated).toBe(
      true
    );

    for (const value of ["ab", "abcdefghij123456", "icons/svg/mystery-man.svg"]) {
      expect(walkSystemText({ ...numbers(1_999), dropped: value }).truncated).toBe(false);
    }

    expect(walkSystemText({ ...numbers(2_000), note: "a real description" }).truncated).toBe(true);

    expect(
      walkSystemText({ ...numbers(1_998), sub: { x: 1, y: 2 }, note: "a real description" }).truncated
    ).toBe(true);

    expect(walkSystemText({ ...numbers(1_999), sub: { deep: 1 } }).truncated).toBe(true);
    expect(walkSystemText({ ...numbers(1_999), sub: {} }).truncated).toBe(false);
  });

  it("strips HTML inside a system string too, and ignores a non-object system", () => {
    expect(walkSystemText({ bio: "<p>Born in <b>Saltmarsh</b></p>" }).text).toBe("Born in Saltmarsh");
    for (const value of [null, undefined, "a string", 42]) {
      const walked = walkSystemText(value);

      expect(typeof walked.text).toBe("string");
      expect(walked.truncated).toBe(false);
    }
  });
});

describe("extractDocumentText", () => {
  /** @param {any} source */
  const doc = (source) => ({ _source: { _id: "x", name: "n", ...source } });

  it("reads a plain string field and strips it", () => {
    const extracted = extractDocumentText(doc({ description: "<p>Ale &amp; song</p>" }), ["description"]);
    expect(extracted).toEqual({ text: "Ale & song", systemText: "", truncated: false });
  });

  it("reads BOTH `text.content` and `text.markdown` from a page's text field", () => {
    const html = extractDocumentText(doc({ text: { content: "<p>html body</p>", format: 1 } }), ["text"]);
    expect(html.text).toBe("html body");
    const markdown = extractDocumentText(doc({ text: { markdown: "## md *body*", format: 2 } }), ["text"]);
    expect(markdown.text).toBe("## md *body*");

    const both = extractDocumentText(
      doc({ text: { content: "<p>rendered</p>", markdown: "raw", format: 1 } }),
      ["text"]
    );
    expect(both.text).toBe("rendered raw");

    expect(both.text).not.toContain("1");
  });

  it("routes the field name `system` to the WALK and nothing else", () => {
    const extracted = extractDocumentText(
      doc({ system: { note: "walked value" }, description: "described" }),
      ["system", "description"]
    );
    expect(extracted.systemText).toBe("walked value");
    expect(extracted.text).toBe("described");

    expect(extractDocumentText(doc({ command: "alert(1)", system: { source: "alert(2)" } }), [])).toEqual({
      text: "",
      systemText: "",
      truncated: false
    });
  });

  it("never reads a field the caller did not name, so flags/ownership cannot leak in", () => {
    const extracted = extractDocumentText(
      doc({ description: "kept", flags: { m: { key: "secret" } }, ownership: { default: 3 } }),
      ["description"]
    );
    expect(extracted.text).toBe("kept");
    expect(JSON.stringify(extracted)).not.toContain("secret");
  });

  it("clips `text` at the per-field cap and reports it, counting the walk's bound the same way", () => {
    const long = `${"a".repeat(SEARCH_DOC_TEXT_MAX_CHARS)}TAILMARKER`;
    const clipped = extractDocumentText(doc({ description: long }), ["description"]);
    expect(clipped.text).toHaveLength(SEARCH_DOC_TEXT_MAX_CHARS);
    expect(clipped.text).not.toContain("TAILMARKER");
    expect(clipped.truncated).toBe(true);

    const exact = extractDocumentText(doc({ description: "a".repeat(SEARCH_DOC_TEXT_MAX_CHARS) }), [
      "description"
    ]);
    expect(exact.truncated).toBe(false);

    const walked = extractDocumentText(doc({ system: { body: "b".repeat(20_000) } }), ["system"]);
    expect(walked.truncated).toBe(true);
    expect(walked.systemText).toHaveLength(SEARCH_SYSTEM_WALK_MAX_BYTES);

    const straddling = extractDocumentText(
      doc({ description: `${"a".repeat(SEARCH_DOC_TEXT_MAX_CHARS - 1)}🎲 TAILMARKER` }),
      ["description"]
    );
    expect(LONE_SURROGATE.test(straddling.text)).toBe(false);
    expect(straddling.text).toHaveLength(SEARCH_DOC_TEXT_MAX_CHARS - 1);
    expect(straddling.truncated).toBe(true);
  });

  it("reports an UNTERMINATED <script>/<style> tail as a clip, in text AND in the walk", () => {
    const tail = extractDocumentText(
      doc({ description: `<p>intro</p><script>x ${"prose ".repeat(2_000)}` }),
      ["description"]
    );
    expect(tail.text).toBe("intro");
    expect(tail.truncated).toBe(true);

    expect(extractDocumentText(doc({ description: "<p>text</p><script>" }), ["description"])).toEqual({
      text: "text",
      systemText: "",
      truncated: false
    });

    expect(
      extractDocumentText(doc({ description: "<p>a</p><script>var x = 1;</script>" }), ["description"])
        .truncated
    ).toBe(false);

    expect(
      extractDocumentText(doc({ description: "a<script>swallowed prose</style>" }), ["description"]).truncated
    ).toBe(true);

    const walked = walkSystemText({ bio: "intro here<script>lost prose tail" });
    expect(walked).toEqual({ text: "intro here", truncated: true });
    expect(walkSystemText({ bio: "intro here<script>" }).truncated).toBe(false);
    expect(walkSystemText({ bio: "<script>only a swallowed tail" })).toEqual({ text: "", truncated: true });
  });

  it("treats an UNTERMINATED OPENER as an unterminated block, and discloses the tail it swallows", () => {
    expect(extractDocumentText(doc({ description: "a<script and prose" }), ["description"])).toEqual({
      text: "a",
      systemText: "",
      truncated: true
    });

    expect(extractDocumentText(doc({ description: "a<script" }), ["description"]).truncated).toBe(false);
    expect(extractDocumentText(doc({ description: "a<script " }), ["description"]).truncated).toBe(false);
    expect(extractDocumentText(doc({ description: "a <STYLE junk" }), ["description"]).truncated).toBe(true);

    expect(extractDocumentText(doc({ description: "a<style=x b" }), ["description"])).toEqual({
      text: "a<style=x b",
      systemText: "",
      truncated: false
    });

    expect(walkSystemText({ bio: "note here<script lost tail" })).toEqual({
      text: "note here",
      truncated: true
    });

    expect(stripSearchHtml("a<scripting b")).toBe("a<scripting b");
  });

  it("reports an UNTERMINATED COMMENT tail as a clip too, on the same flag", () => {
    const prose = "note: <!-- means comment; volume is 0.5";
    expect(stripSearchHtml(prose)).toBe("note:");
    expect(extractDocumentText(doc({ description: prose }), ["description"])).toEqual({
      text: "note:",
      systemText: "",
      truncated: true
    });

    expect(
      extractDocumentText(doc({ description: "a<!-- swallowed prose--" }), ["description"]).truncated
    ).toBe(true);

    expect(extractDocumentText(doc({ description: "a real description <!--" }), ["description"])).toEqual({
      text: "a real description",
      systemText: "",
      truncated: false
    });

    for (const value of ["a<!-- hidden note -->b", "a<!-- hidden note -->"]) {
      expect(extractDocumentText(doc({ description: value }), ["description"]).truncated).toBe(false);
    }

    for (const value of ["a<!-->", "a<!--->"]) {
      expect(extractDocumentText(doc({ description: value }), ["description"]).truncated).toBe(false);
    }

    expect(stripSearchHtml("<!-->after")).toBe("");
    expect(stripSearchHtml("<!--->after")).toBe("");
    expect(stripSearchHtml("a<!-->b")).toBe("a");
    expect(stripSearchHtml("a<!--->b")).toBe("a");
    for (const value of ["a<!-->b", "a<!--->b"]) {
      expect(extractDocumentText(doc({ description: value }), ["description"]).truncated).toBe(true);
    }

    expect(walkSystemText({ bio: "intro here<!--lost prose tail" })).toEqual({
      text: "intro here",
      truncated: true
    });
    expect(walkSystemText({ bio: "intro here<!--" }).truncated).toBe(false);
  });

  it("reads STORED data source-first, falling back to toObject() and surviving a throwing one", () => {
    expect(
      extractDocumentText(
        { _source: { description: "stored" }, description: "live", toObject: () => ({ description: "obj" }) },
        ["description"]
      ).text
    ).toBe("stored");

    expect(
      extractDocumentText({ toObject: () => ({ description: "obj" }), description: "live" }, ["description"])
        .text
    ).toBe("obj");

    expect(
      extractDocumentText(
        {
          toObject: () => {
            throw new Error("nope");
          }
        },
        ["description"]
      )
    ).toEqual({ text: "", systemText: "", truncated: false });
  });
});

describe("buildSearchSnippet", () => {
  /** @param {string} text */
  const extracted = (text, rest = {}) => ({
    text,
    systemText: rest.systemText ?? "",
    truncated: rest.truncated ?? false
  });

  /**
   * @param {{text: string, systemText: string, truncated: boolean}} source
   * @param {string} name
   * @param {string[]} terms
   * @param {string} [label]
   * @returns {{field: string, text: string, matches: {start: number, length: number}[], truncated: boolean}}
   */
  const snippetFor = (source, name, terms, label = "") => {
    const built = buildSearchSnippet(source, name, terms);
    expect(built, label || "a snippet was expected").not.toBeNull();
    return /** @type {any} */ (built);
  };

  it("windows around the first match with offsets into the DELIVERED string", () => {
    const snippet = snippetFor(
      extracted("The smugglers meet at the wharf after dark"),
      "Rumours",
      foldSearchQueryTerms("SMUGGLERS")
    );
    expect(snippet.field).toBe("text");
    expect(snippet.text).toBe("The smugglers meet at the wharf after dark");
    expect(snippet.matches).toEqual([{ start: 4, length: 9 }]);
    expect(snippet.text.slice(4, 4 + 9)).toBe("smugglers");
  });

  it("never exceeds the char cap, in every clipping shape, ellipses INCLUDED", () => {
    const filler = "0123456789".repeat(40);
    const shapes = [
      { name: "both", text: `${filler}MARK${filler}`, lead: true, trail: true },
      { name: "lead only", text: `${filler}MARK`, lead: true, trail: false },
      { name: "trail only", text: `MARK${filler}`, lead: false, trail: true },
      { name: "neither", text: "tiny MARK body", lead: false, trail: false },
      { name: "match at index 0 of a long text", text: `MARK${filler}`, lead: false, trail: true },
      { name: "match at the very end", text: `${filler}MARK`, lead: true, trail: false }
    ];
    for (const shape of shapes) {
      const snippet = snippetFor(extracted(shape.text), "", foldSearchQueryTerms("mark"), shape.name);
      expect(snippet.text.length, `${shape.name} length`).toBeLessThanOrEqual(SEARCH_SNIPPET_MAX_CHARS);
      expect(snippet.text.startsWith("…"), `${shape.name} lead`).toBe(shape.lead);
      expect(snippet.text.endsWith("…"), `${shape.name} trail`).toBe(shape.trail);
      const { start, length } = snippet.matches[0];
      expect(snippet.text.slice(start, start + length), `${shape.name} offsets`).toBe("MARK");
    }
  });

  it("re-budgets when the clip CREATES the need for a trailing ellipsis", () => {
    const term = "m".repeat(200);
    const snippet = snippetFor(extracted(`${"a".repeat(100)}${term}`), "", foldSearchQueryTerms(term));
    expect(snippet.text.length).toBeLessThanOrEqual(SEARCH_SNIPPET_MAX_CHARS);
    expect(snippet.text.startsWith("…")).toBe(true);
    expect(snippet.text.endsWith("…")).toBe(true);
  });

  it("reports a term LONGER than the window as a clipped run rather than an empty match list", () => {
    const term = "z".repeat(250);
    const snippet = snippetFor(extracted(`head ${term} tail`), "", foldSearchQueryTerms(term));
    expect(snippet.matches).toHaveLength(1);
    const { start, length } = snippet.matches[0];
    expect(length).toBeGreaterThan(0);
    expect(snippet.text.slice(start, start + length)).toBe("z".repeat(length));
    expect(snippet.text.length).toBeLessThanOrEqual(SEARCH_SNIPPET_MAX_CHARS);
  });

  it("keeps the radius when the text is longer than the window but the match is central", () => {
    const filler = "x".repeat(500);
    const snippet = snippetFor(extracted(`${filler}MARK${filler}`), "", foldSearchQueryTerms("mark"));

    expect(snippet.text).toHaveLength(SEARCH_SNIPPET_RADIUS * 2 + 4 + 2);
    expect(snippet.matches[0].start).toBe(SEARCH_SNIPPET_RADIUS + 1);
  });

  it("caps the offsets and never emits two that overlap", () => {
    const snippet = snippetFor(
      extracted(Array.from({ length: 9 }, () => "aba").join("")),
      "",
      foldSearchQueryTerms("aba")
    );
    expect(snippet.matches.length).toBeLessThanOrEqual(SEARCH_SNIPPET_MAX_MATCHES);
    let cursor = -1;
    for (const match of snippet.matches) {
      expect(match.start).toBeGreaterThanOrEqual(cursor);
      cursor = match.start + match.length;
    }
  });

  it("drops an offset that OVERLAPS an earlier one, which needs TWO terms to happen at all", () => {
    const snippet = snippetFor(extracted("ababa xyz"), "", foldSearchQueryTerms("aba ba"));
    expect(snippet.matches).toEqual([
      { start: 0, length: 3 },
      { start: 3, length: 2 }
    ]);

    expect(snippet.text.slice(0, 3)).toBe("aba");
    expect(snippet.text.slice(3, 5)).toBe("ba");
  });

  it("locates a term whose fold differs in LENGTH-PRESERVING ways only (case, ё/е, NFC)", () => {
    const snippet = snippetFor(extracted("Тайная аура даёт ёлка бонус"), "", foldSearchQueryTerms("ЕЛКА"));
    const { start, length } = snippet.matches[0];

    expect(snippet.text.slice(start, start + length)).toBe("ёлка");

    const turkish = snippetFor(extracted("İstanbul MARK here"), "", foldSearchQueryTerms("mark"));
    const hit = turkish.matches[0];
    expect(turkish.text.slice(hit.start, hit.start + hit.length)).toBe("MARK");
  });

  it("never splits a surrogate pair at a window edge", () => {
    for (let gap = SEARCH_SNIPPET_RADIUS - 4; gap <= SEARCH_SNIPPET_RADIUS + 2; gap += 1) {
      const text = `${"a".repeat(10)}🎲${"b".repeat(gap)}MARK${"c".repeat(gap)}🎲${"d".repeat(10)}`;
      const snippet = snippetFor(extracted(text), "", foldSearchQueryTerms("mark"));
      expect(LONE_SURROGATE.test(snippet.text), `gap ${gap}`).toBe(false);
      const { start, length } = snippet.matches[0];
      expect(snippet.text.slice(start, start + length), `gap ${gap}`).toBe("MARK");
    }
  });

  it("takes its field priority from the protocol enum's ORDER, not from a second list", async () => {
    expect(SEARCH_SNIPPET_FIELDS).toEqual(["text", "systemText", "name"]);
    const terms = foldSearchQueryTerms("mark");
    const all = { text: "body MARK", systemText: "sys MARK", name: "name MARK" };
    /** @type {Record<string, string>} */
    const remaining = { ...all };
    for (const field of SEARCH_SNIPPET_FIELDS) {
      const snippet = snippetFor(
        extracted(remaining.text ?? "", { systemText: remaining.systemText ?? "" }),
        remaining.name ?? "",
        terms,
        field
      );
      expect(snippet.field, `${field} must win once the earlier fields are empty`).toBe(field);

      delete remaining[field];
    }

    vi.resetModules();
    vi.doMock("../scripts/generated/protocol.js", async (importOriginal) => {
      const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
      return { ...actual, SEARCH_SNIPPET_FIELDS: Object.freeze(["name", "systemText", "text"]) };
    });
    try {
      const reordered = await import("../scripts/lib/search-text.js");
      const snippet = reordered.buildSearchSnippet(
        { text: all.text, systemText: all.systemText, truncated: false },
        all.name,
        reordered.foldSearchQueryTerms("mark")
      );
      expect(snippet?.field, "the reversed enum must move the preference to its own first member").toBe(
        "name"
      );
    } finally {
      vi.doUnmock("../scripts/generated/protocol.js");
      vi.resetModules();
    }
  });

  it("delivers a `name` snippet as PLAIN, single-line text like the other two candidates", () => {
    const snippet = snippetFor(extracted(""), "<b>MARK</b>\nof\tline2", foldSearchQueryTerms("mark"));
    expect(snippet.field).toBe("name");
    expect(snippet.text).toBe("MARK of line2");
    expect(snippet.text).not.toMatch(/[<>\t\n\r]/u);
    const { start, length } = snippet.matches[0];
    expect(snippet.text.slice(start, start + length)).toBe("MARK");

    expect(buildSearchSnippet(extracted(""), "<b>MARK</b>", foldSearchQueryTerms("b"))).toBeNull();
  });

  it("falls back text → systemText → name, and reports which field it used", () => {
    const terms = foldSearchQueryTerms("mark");
    expect(snippetFor(extracted("body MARK", { systemText: "sys MARK" }), "name MARK", terms).field).toBe(
      "text"
    );
    expect(snippetFor(extracted("", { systemText: "sys MARK" }), "name MARK", terms).field).toBe(
      "systemText"
    );
    expect(snippetFor(extracted(""), "name MARK", terms).field).toBe("name");

    for (const field of ["text", "systemText", "name"]) {
      expect(SEARCH_SNIPPET_FIELDS).toContain(field);
    }
  });

  it("returns null when no term occurs LITERALLY, and when there are no terms at all", () => {
    expect(
      buildSearchSnippet(extracted("контрабандистам"), "", foldSearchQueryTerms("контрабандистах"))
    ).toBeNull();
    expect(buildSearchSnippet(extracted("body"), "name", foldSearchQueryTerms("absent"))).toBeNull();
    expect(buildSearchSnippet(extracted("body"), "name", [])).toBeNull();
    expect(buildSearchSnippet(extracted(""), "", foldSearchQueryTerms("mark"))).toBeNull();
  });

  it("passes the SOURCE truncation flag through, which is about the document and not the window", () => {
    const snippet = snippetFor(extracted("MARK body", { truncated: true }), "", foldSearchQueryTerms("mark"));
    expect(snippet.truncated).toBe(true);

    expect(snippet.text).not.toContain("…");
  });
});

describe("foldSearchQueryTerms + snippetField", () => {
  it("tokenizes the query with the engine's own separators and folds each term", () => {
    expect(foldSearchQueryTerms("Сайлас Аспид — главарь")).toEqual(["сайлас", "аспид", "главарь"]);
    expect(foldSearchQueryTerms("Ёлка, ёж")).toEqual(["елка", "еж"]);
    expect(foldSearchQueryTerms("Map 5.3")).toEqual(["map", "5", "3"]);
    expect(foldSearchQueryTerms("   ")).toEqual([]);
    expect(foldSearchQueryTerms(/** @type {any} */ (undefined))).toEqual([]);
  });

  it("refuses a field value outside the protocol enum at the assignment site", () => {
    expect(snippetField("text")).toBe("text");
    expect(() => snippetField("body")).toThrow(/unknown search snippet field/);
  });
});
