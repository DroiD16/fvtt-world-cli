import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canonicalizeDataPath,
  canonicalizeFilePathFields,
  deleteDataFile,
  listDataPathRecursive,
  mkdirDataPath,
  normalizeFilePath,
  normalizeListPath,
  splitFilePathQuery,
  uploadDataFile
} from "../scripts/lib/file-access.js";

function ensureFilePickerNamespace() {
  globalThis.foundry ??= {};
  globalThis.foundry.applications ??= {};
  globalThis.foundry.applications.apps ??= {};
  globalThis.foundry.applications.apps.FilePicker ??= {};
}

beforeEach(() => ensureFilePickerNamespace());

const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);
const VTAB = String.fromCharCode(11);

function expectCode(fn, code) {
  try {
    fn();
  } catch (error) {
    expect(/** @type {{ code?: string }} */ (error).code).toBe(code);
    return;
  }

  throw new Error(`Expected the call to throw with code ${code}, but it did not throw`);
}

describe("normalizeFilePath rejection branches", () => {
  it.each([
    ["a POSIX absolute path", "/etc/passwd"],
    ["a nested POSIX absolute path", "/var/lib/foundry"],
    ["a Windows drive path", "C:\\Windows\\system32"],
    ["a Windows drive path with forward slashes", "C:/Windows"],
    ["a lowercase Windows drive path", "d:data/file.txt"],
    ["a parent traversal segment", "../secrets"],
    ["a mid-path parent traversal", "worlds/../../etc"],
    ["a single-dot segment", "worlds/./file.txt"],
    ["a bare single-dot path", "."],
    ["a bare double-dot path", ".."],
    ["a percent-encoded parent traversal", "%2e%2e/%2e%2e/worlds/w/data/x.png"],
    ["an uppercase percent-encoded parent traversal", "%2E%2E/worlds/w/data/x.png"],
    ["a mid-path percent-encoded parent traversal", "a/%2e%2e/b.png"],
    ["a percent-encoded single-dot segment", "assets/%2e/x.png"],
    ["a percent-encoded separator hiding a traversal", "..%2f..%2fx.png"],
    ["a wholly percent-encoded traversal in one segment", "%2e%2e%2f%2e%2e"],
    ["a percent-encoded separator between names", "a%2fb.png"],
    ["a backslash-encoded separator", "a%5c..%5cb.png"],
    ["a doubled slash (empty segment)", "a//b"],
    ["a trailing slash (empty segment)", "worlds/world-1/"],
    ["a leading slash (absolute)", "/a/b"]
  ])("rejects %s with PATH_NOT_ALLOWED", (_label, path) => {
    expectCode(() => normalizeFilePath(path), "PATH_NOT_ALLOWED");
  });

  it("rejects an empty string with PATH_NOT_ALLOWED (allowEmpty is false)", () => {
    expectCode(() => normalizeFilePath(""), "PATH_NOT_ALLOWED");
  });

  it.each([
    ["a NUL byte", `worlds/${NUL}file.txt`],
    ["a DEL byte", `worlds/${DEL}file.txt`],
    ["a tab control char", "worlds/fi\tle.txt"],
    ["a newline control char", "worlds/file\n.txt"],
    ["a vertical-tab control char", `worlds/${VTAB}.txt`]
  ])("rejects %s with PATH_NOT_ALLOWED", (_label, path) => {
    expectCode(() => normalizeFilePath(path), "PATH_NOT_ALLOWED");
  });

  it("rejects a non-string path with INVALID_PARAMS (the code discriminates from PATH_NOT_ALLOWED)", () => {
    expectCode(() => normalizeFilePath(42), "INVALID_PARAMS");
    expectCode(() => normalizeFilePath(null), "INVALID_PARAMS");
    expectCode(() => normalizeFilePath(undefined), "INVALID_PARAMS");
  });

  it("accepts a clean nested data-relative path and normalizes backslashes", () => {
    expect(normalizeFilePath("worlds/world-1/fvtt-world-cli/x.txt")).toBe(
      "worlds/world-1/fvtt-world-cli/x.txt"
    );
    expect(normalizeFilePath("worlds\\world-1\\file.txt")).toBe("worlds/world-1/file.txt");
  });

  it("accepts a doubly-encoded dot segment as a literal name, not a traversal", () => {
    expect(normalizeFilePath("%252e%252e/x.png")).toBe("%252e%252e/x.png");
  });

  it("never yields a `.` or `..` segment out of canonicalizeDataPath for an accepted path", () => {
    for (const path of ["%2e%2e/x.png", "a/%2E%2E/b.png", "assets/%2e/c.png", "worlds/../x"]) {
      let canonical = null;
      try {
        canonical = canonicalizeDataPath(normalizeFilePath(path));
      } catch {
        canonical = null;
      }
      if (canonical !== null) {
        expect(canonical.split("/")).not.toContain("..");
        expect(canonical.split("/")).not.toContain(".");
      }
    }
  });
});

describe("normalizeListPath allowEmpty split", () => {
  it("accepts an empty string (the data root) where the file path normalizer rejects it", () => {
    expect(normalizeListPath("")).toBe("");

    expectCode(() => normalizeFilePath(""), "PATH_NOT_ALLOWED");
  });

  it("still rejects traversal and absolute paths even when empty is allowed", () => {
    expectCode(() => normalizeListPath("../secrets"), "PATH_NOT_ALLOWED");
    expectCode(() => normalizeListPath("/etc"), "PATH_NOT_ALLOWED");
    expectCode(() => normalizeListPath("C:\\x"), "PATH_NOT_ALLOWED");
  });
});

describe("listDataPathRecursive (bounded depth-first walk)", () => {
  function installBrowse(tree, { throwOn = new Set() } = {}) {
    const browse = vi.fn(async (_source, target) => {
      const key = typeof target === "string" ? target : "";
      if (throwOn.has(key)) {
        throw new Error(`Permission denied: ${key}`);
      }
      const node = tree.get(key);
      if (!node) {
        throw new Error(`Path not found: ${key}`);
      }
      return { target: key, dirs: node.dirs ?? [], files: node.files ?? [] };
    });
    globalThis.foundry.applications.apps.FilePicker.implementation = { browse };
    return browse;
  }

  afterEach(() => {
    delete globalThis.foundry.applications.apps.FilePicker.implementation;
    vi.restoreAllMocks();
  });

  function buildTree() {
    return new Map([
      [
        "root",
        { dirs: ["root/a", "root/c"], files: [{ path: "root/b.txt", size: 3, mimeType: "text/plain" }] }
      ],
      [
        "root/a",
        { dirs: ["root/a/deep"], files: [{ path: "root/a/a1.txt", size: 1, mimeType: "text/plain" }] }
      ],
      ["root/a/deep", { dirs: [], files: [{ path: "root/a/deep/d1.txt", size: 2, mimeType: "text/plain" }] }],
      ["root/c", { dirs: [], files: [{ path: "root/c/c1.txt", size: 4, mimeType: "text/plain" }] }]
    ]);
  }

  it("walks depth-first pre-order: a subtree follows its directory, before siblings", async () => {
    installBrowse(buildTree());

    const result = await listDataPathRecursive("root", { maxDepth: 5, maxEntries: 500 });

    expect(result.recursive).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.truncatedAt).toBeNull();
    expect(result.skipped).toEqual([]);

    expect(result.skippedTruncated).toBe(false);

    expect(result.entries.map((entry) => entry.path)).toEqual([
      "root/a",
      "root/a/a1.txt",
      "root/a/deep",
      "root/a/deep/d1.txt",
      "root/b.txt",
      "root/c",
      "root/c/c1.txt"
    ]);

    expect(result.entries.map((entry) => entry.depth)).toEqual([1, 2, 2, 3, 1, 1, 2]);
  });

  it("does not descend past maxDepth (boundary dirs are listed, not walked)", async () => {
    installBrowse(buildTree());

    const result = await listDataPathRecursive("root", { maxDepth: 1 });

    expect(result.entries.map((entry) => entry.path)).toEqual(["root/a", "root/b.txt", "root/c"]);
    expect(result.entries.every((entry) => entry.depth === 1)).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it("stops at maxEntries and reports truncated + truncatedAt (last included entry)", async () => {
    installBrowse(buildTree());

    const result = await listDataPathRecursive("root", { maxDepth: 2, maxEntries: 3 });

    expect(result.entries).toHaveLength(3);
    expect(result.entries.map((entry) => entry.path)).toEqual(["root/a", "root/a/a1.txt", "root/a/deep"]);
    expect(result.truncated).toBe(true);
    expect(result.truncatedAt).toBe("root/a/deep");
  });

  it("skips a subdirectory whose browse fails and keeps walking (bounded skipped list)", async () => {
    installBrowse(buildTree(), { throwOn: new Set(["root/a"]) });

    const result = await listDataPathRecursive("root", { maxDepth: 5 });

    expect(result.entries.map((entry) => entry.path)).toEqual([
      "root/a",
      "root/b.txt",
      "root/c",
      "root/c/c1.txt"
    ]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].path).toBe("root/a");
    expect(result.skipped[0].reason).toMatch(/Permission denied/);
    expect(result.truncated).toBe(false);

    expect(result.skippedTruncated).toBe(false);
  });

  it("caps the skipped list and flips skippedTruncated when more subdirs fail than the cap holds", async () => {
    const failingDirs = Array.from({ length: 25 }, (_index, i) => `root/d${String(i).padStart(2, "0")}`);
    installBrowse(new Map([["root", { dirs: failingDirs, files: [] }]]));

    const result = await listDataPathRecursive("root", { maxDepth: 5 });

    expect(result.entries).toHaveLength(25);

    expect(result.skipped).toHaveLength(20);

    expect(result.skippedTruncated).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it("enforces the path allowlist per level: an escaping browse entry is dropped, never followed, without losing its siblings", async () => {
    const tree = new Map([
      ["root", { dirs: ["root/x"], files: [{ path: "root/ok.txt", size: 1, mimeType: "text/plain" }] }],
      [
        "root/x",
        { dirs: ["/etc/passwd"], files: [{ path: "root/x/keep.txt", size: 2, mimeType: "text/plain" }] }
      ]
    ]);
    installBrowse(tree);

    const result = await listDataPathRecursive("root", { maxDepth: 5 });

    expect(result.entries.map((entry) => entry.path)).toEqual(["root/ok.txt", "root/x", "root/x/keep.txt"]);

    expect(result.entries.some((entry) => entry.path.includes("etc/passwd"))).toBe(false);
    expect(result.skipped).toHaveLength(0);
  });

  it("drops a browse entry whose name hides an encoded separator without failing the directory listing", async () => {
    const tree = new Map([
      [
        "root",
        {
          dirs: [],
          files: [
            { path: "root/good.png", size: 1, mimeType: "image/png" },
            { path: "root/a%5c..%5cb.png", size: 2, mimeType: "image/png" }
          ]
        }
      ]
    ]);
    installBrowse(tree);

    const result = await listDataPathRecursive("root", { maxDepth: 1 });

    expect(result.entries.map((entry) => entry.path)).toEqual(["root/good.png"]);
    expect(result.skipped).toHaveLength(0);
  });

  it("throws when the ROOT path itself cannot be browsed (matches flat-list behavior)", async () => {
    installBrowse(buildTree());

    await expect(listDataPathRecursive("does/not/exist")).rejects.toMatchObject({
      code: "FILE_NOT_FOUND"
    });
  });

  it("applies default maxDepth (5) and maxEntries (500) when omitted", async () => {
    installBrowse(buildTree());

    const result = await listDataPathRecursive("root");

    expect(result.entries).toHaveLength(7);
    expect(result.truncated).toBe(false);
  });
});

describe("canonicalizeDataPath (Foundry stored-convention encoder)", () => {
  it("encodes a literal name to Foundry's stored form (space/apostrophe/parens/hash)", () => {
    expect(canonicalizeDataPath("worlds/w/fvtt-world-cli/smoke/It's a (test) #1.ogg")).toBe(
      "worlds/w/fvtt-world-cli/smoke/It%27s%20a%20(test)%20%231.ogg"
    );
  });

  it("encodes each special char to the exact Foundry escape", () => {
    expect(canonicalizeDataPath("a b.png")).toBe("a%20b.png");
    expect(canonicalizeDataPath("a#b.png")).toBe("a%23b.png");
    expect(canonicalizeDataPath("a?b.png")).toBe("a%3Fb.png");
    expect(canonicalizeDataPath("a'b.png")).toBe("a%27b.png");

    expect(canonicalizeDataPath("a(b).png")).toBe("a(b).png");
  });

  it("preserves `/` separators (encodes per segment, not the whole string)", () => {
    expect(canonicalizeDataPath("worlds/my world/a b.png")).toBe("worlds/my%20world/a%20b.png");
  });

  it("is idempotent: re-canonicalizing an already-encoded value is a no-op", () => {
    const once = canonicalizeDataPath("It's a (test) #1.ogg");
    expect(canonicalizeDataPath(once)).toBe(once);

    expect(canonicalizeDataPath("It%27s%20a%20(test)%20%231.ogg")).toBe(once);
  });

  it("is a no-op for special-char-free paths (existing plain paths unchanged)", () => {
    const plain = "worlds/world-1/assets/sword.png";
    expect(canonicalizeDataPath(plain)).toBe(plain);

    expect(canonicalizeDataPath("icons/svg/mystery-man.svg")).toBe("icons/svg/mystery-man.svg");
  });

  it("passes absolute URLs, data URIs, and host-absolute paths through untouched", () => {
    expect(canonicalizeDataPath("https://cdn.example.com/a b.png")).toBe("https://cdn.example.com/a b.png");
    expect(canonicalizeDataPath("http://host/x y.png")).toBe("http://host/x y.png");
    expect(canonicalizeDataPath("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(canonicalizeDataPath("//cdn/x y.png")).toBe("//cdn/x y.png");
    expect(canonicalizeDataPath("/abs/x y.png")).toBe("/abs/x y.png");
  });

  it("passes a leading-`#` virtual file path through untouched (never %23-encodes it)", () => {
    expect(canonicalizeDataPath("#texture-id")).toBe("#texture-id");
    expect(canonicalizeDataPath("#tex")).toBe("#tex");

    expect(canonicalizeDataPath("a#b.png")).toBe("a%23b.png");
  });

  it("returns non-string / empty input unchanged", () => {
    expect(canonicalizeDataPath("")).toBe("");
    expect(canonicalizeDataPath(null)).toBe(null);
    expect(canonicalizeDataPath(undefined)).toBe(undefined);
    expect(canonicalizeDataPath(42)).toBe(42);
  });
});

describe("canonicalizeFilePathFields (document FilePath fields)", () => {
  it("canonicalizes a nested TextureData src without mutating the input", () => {
    const input = { texture: { src: "worlds/w/a b (x).png", scaleX: 1 }, hidden: false };
    const out = canonicalizeFilePathFields(input, "Tile");
    expect(out.texture.src).toBe("worlds/w/a%20b%20(x).png");

    expect(input.texture.src).toBe("worlds/w/a b (x).png");

    expect(out.texture.scaleX).toBe(1);
    expect(out.hidden).toBe(false);
  });

  it("canonicalizes item img and returns the SAME reference when nothing changed", () => {
    const plain = { img: "worlds/w/sword.png", name: "Sword" };
    expect(canonicalizeFilePathFields(plain, "Item")).toBe(plain);
    const special = { img: "worlds/w/big sword.png" };
    expect(canonicalizeFilePathFields(special, "Item").img).toBe("worlds/w/big%20sword.png");
  });

  it("PRESERVES a cache-busting query after the extension, on every family, while still encoding the path", () => {
    expect(canonicalizeFilePathFields({ img: "worlds/w/map.webp?v=2" }, "RollTable").img).toBe(
      "worlds/w/map.webp?v=2"
    );
    expect(canonicalizeFilePathFields({ img: "worlds/w/map.webp?v=2" }, "TableResult").img).toBe(
      "worlds/w/map.webp?v=2"
    );

    expect(canonicalizeFilePathFields({ img: "worlds/w/my map.webp?1762953012" }, "RollTable").img).toBe(
      "worlds/w/my%20map.webp?1762953012"
    );

    expect(canonicalizeFilePathFields({ img: "worlds/w/map.webp?a=/v2" }, "Item").img).toBe(
      "worlds/w/map.webp?a=/v2"
    );

    expect(canonicalizeFilePathFields({ thumb: "worlds/w/scene-thumb.webp?1762953012" }, "Scene").thumb).toBe(
      "worlds/w/scene-thumb.webp?1762953012"
    );
    expect(
      canonicalizeFilePathFields({ texture: { src: "worlds/w/t a.png?v=3" } }, "Token").texture.src
    ).toBe("worlds/w/t%20a.png?v=3");
    expect(canonicalizeFilePathFields({ path: "worlds/w/song a.ogg?v=1" }, "PlaylistSound").path).toBe(
      "worlds/w/song%20a.ogg?v=1"
    );

    const once = canonicalizeFilePathFields({ img: "worlds/w/my map.webp?v=2" }, "Item").img;
    expect(canonicalizeFilePathFields({ img: once }, "Item").img).toBe(once);

    expect(canonicalizeFilePathFields({ img: "worlds/w/a?b.png" }, "Item").img).toBe("worlds/w/a%3Fb.png");

    expect(canonicalizeFilePathFields({ img: "https://cdn/x.png?v=2" }, "Item").img).toBe(
      "https://cdn/x.png?v=2"
    );
    expect(canonicalizeFilePathFields({ foreground: "#tex.webp?v=2" }, "Scene").foreground).toBe(
      "#tex.webp?v=2"
    );
  });

  it("splits a query ONLY after a recognized Foundry extension, across the whole shape space", () => {
    const cases = [
      ["tokens/goblin.v2?.webp", "tokens/goblin.v2?.webp", ""],
      ["goblin?.webp", "goblin?.webp", ""],
      ["tokens/goblin.*?.webp", "tokens/goblin.*?.webp", ""],
      ["tokens/*.webp", "tokens/*.webp", ""],
      ["tokens/goblin?", "tokens/goblin?", ""],
      ["tokens/goblin", "tokens/goblin", ""],
      ["a.b.c.webp", "a.b.c.webp", ""],
      ["a?b.png", "a?b.png", ""],

      ["map.webp?v=2", "map.webp", "?v=2"],
      ["MAP.WEBP?v=2", "MAP.WEBP", "?v=2"],
      ["Map.WebP", "Map.WebP", ""],

      ["map.webp?", "map.webp", "?"],

      ["map.webp?variant=/v2", "map.webp", "?variant=/v2"],

      ["map.webp?fallback=thumb.png?v=2", "map.webp", "?fallback=thumb.png?v=2"],

      ["worlds/w.v2/map.webp", "worlds/w.v2/map.webp", ""],
      ["worlds/w.v2/map.webp?v=2", "worlds/w.v2/map.webp", "?v=2"],
      [".hidden.webp", ".hidden.webp", ""],
      ["карта.webp?v=2", "карта.webp", "?v=2"],

      ["sound.woff2?v=1", "sound.woff2", "?v=1"],

      ["map.foo?v=2", "map.foo?v=2", ""],
      ["archive.tar.gz?v=2", "archive.tar.gz?v=2", ""],

      ["#tex.webp?v=2", "#tex.webp", "?v=2"],
      ["https://cdn/x.webp?v=2", "https://cdn/x.webp", "?v=2"],
      ["data:image/png;base64,AAA", "data:image/png;base64,AAA", ""],
      ["", "", ""]
    ];
    for (const [value, base, query] of cases) {
      expect(splitFilePathQuery(value), `split of ${JSON.stringify(value)}`).toEqual({ base, query });
    }
  });

  it("ENCODES a `?` that is not a query on a document write, dotted wildcards included", () => {
    expect(canonicalizeFilePathFields({ img: "worlds/w/goblin.v2?.webp" }, "Item").img).toBe(
      "worlds/w/goblin.v2%3F.webp"
    );
    expect(canonicalizeFilePathFields({ img: "worlds/w/map.foo?v=2" }, "Item").img).toBe(
      "worlds/w/map.foo%3Fv%3D2"
    );

    expect(canonicalizeFilePathFields({ img: "worlds/w/MAP.WEBP?v=2" }, "Item").img).toBe(
      "worlds/w/MAP.WEBP?v=2"
    );

    expect(canonicalizeFilePathFields({ img: "worlds/w.v2/my map.webp?v=2" }, "Item").img).toBe(
      "worlds/w.v2/my%20map.webp?v=2"
    );
  });

  it("canonicalizes actor img and prototypeToken.texture.src", () => {
    const out = canonicalizeFilePathFields(
      { img: "worlds/w/a b.png", prototypeToken: { texture: { src: "worlds/w/c d.png" } } },
      "Actor"
    );
    expect(out.img).toBe("worlds/w/a%20b.png");
    expect(out.prototypeToken.texture.src).toBe("worlds/w/c%20d.png");
  });

  it("canonicalizes scene background.src/foreground/thumb and passes an https bg through", () => {
    const out = canonicalizeFilePathFields(
      {
        background: { src: "worlds/w/map v2.webp" },
        foreground: "worlds/w/fg (top).webp",
        thumb: "https://cdn/x y.png"
      },
      "Scene"
    );
    expect(out.background.src).toBe("worlds/w/map%20v2.webp");
    expect(out.foreground).toBe("worlds/w/fg%20(top).webp");

    expect(out.thumb).toBe("https://cdn/x y.png");
  });

  it("canonicalizes drawing/template bare `texture` (not `.src`) and sound/playlist `path`", () => {
    expect(canonicalizeFilePathFields({ texture: "worlds/w/fill x.png" }, "Drawing").texture).toBe(
      "worlds/w/fill%20x.png"
    );
    expect(canonicalizeFilePathFields({ texture: "worlds/w/tpl x.png" }, "MeasuredTemplate").texture).toBe(
      "worlds/w/tpl%20x.png"
    );
    expect(canonicalizeFilePathFields({ path: "worlds/w/song a.ogg" }, "PlaylistSound").path).toBe(
      "worlds/w/song%20a.ogg"
    );
    expect(canonicalizeFilePathFields({ path: "worlds/w/amb b.ogg" }, "AmbientSound").path).toBe(
      "worlds/w/amb%20b.ogg"
    );
  });

  it("canonicalizes macro `img`, chatMessage `sound`, and ActiveEffect `img`", () => {
    expect(canonicalizeFilePathFields({ img: "worlds/w/big spell (v2).png" }, "Macro").img).toBe(
      "worlds/w/big%20spell%20(v2).png"
    );

    expect(canonicalizeFilePathFields({ sound: "worlds/w/It's a (test) #1.ogg" }, "ChatMessage").sound).toBe(
      "worlds/w/It%27s%20a%20(test)%20%231.ogg"
    );

    expect(canonicalizeFilePathFields({ img: "worlds/w/glow #1.png" }, "ActiveEffect").img).toBe(
      "worlds/w/glow%20%231.png"
    );

    expect(
      canonicalizeFilePathFields({ sound: "https://cdn.example.com/a b.ogg" }, "ChatMessage").sound
    ).toBe("https://cdn.example.com/a b.ogg");
  });

  it("canonicalizes a fully-flattened dot-notation key (open passthrough --patch-json shape)", () => {
    const out = canonicalizeFilePathFields({ "texture.src": "worlds/w/my map (v2).png" }, "Tile");
    expect(out["texture.src"]).toBe("worlds/w/my%20map%20(v2).png");

    const plain = { "texture.src": "worlds/w/floor.webp" };
    expect(canonicalizeFilePathFields(plain, "Note")).toBe(plain);
  });

  it("leaves a scene `foreground` virtual path (leading `#`) untouched", () => {
    const virtualFg = { foreground: "#some-virtual-texture", background: { src: "worlds/w/m.webp" } };
    const out = canonicalizeFilePathFields(virtualFg, "Scene");
    expect(out.foreground).toBe("#some-virtual-texture");

    expect(out.background.src).toBe("worlds/w/m.webp");
  });

  it("canonicalizes v13 nested texture leaves: token ring/turnMarker, scene fog.overlay, wall animation", () => {
    const token = canonicalizeFilePathFields(
      {
        texture: { src: "worlds/w/tok a.png" },
        ring: { subject: { texture: "worlds/w/ring b.png" } },
        turnMarker: { src: "worlds/w/mark c.webp" }
      },
      "Token"
    );
    expect(token.texture.src).toBe("worlds/w/tok%20a.png");
    expect(token.ring.subject.texture).toBe("worlds/w/ring%20b.png");
    expect(token.turnMarker.src).toBe("worlds/w/mark%20c.webp");

    const actor = canonicalizeFilePathFields(
      {
        prototypeToken: {
          ring: { subject: { texture: "worlds/w/pt ring.png" } },
          turnMarker: { src: "worlds/w/pt mark.png" }
        }
      },
      "Actor"
    );
    expect(actor.prototypeToken.ring.subject.texture).toBe("worlds/w/pt%20ring.png");
    expect(actor.prototypeToken.turnMarker.src).toBe("worlds/w/pt%20mark.png");

    expect(canonicalizeFilePathFields({ fog: { overlay: "worlds/w/fog a.webp" } }, "Scene").fog.overlay).toBe(
      "worlds/w/fog%20a.webp"
    );
    const virtualFog = { fog: { overlay: "#some-virtual" } };
    expect(canonicalizeFilePathFields(virtualFog, "Scene")).toBe(virtualFog);

    expect(
      canonicalizeFilePathFields({ animation: { texture: "worlds/w/door x.png" } }, "Wall").animation.texture
    ).toBe("worlds/w/door%20x.png");
  });

  it("leaves an unknown type and a missing field untouched", () => {
    const alien = { c: [0, 0, 1, 1] };
    expect(canonicalizeFilePathFields(alien, "NotADocument")).toBe(alien);

    const wall = { c: [0, 0, 1, 1] };
    expect(canonicalizeFilePathFields(wall, "Wall")).toBe(wall);

    const noImg = { name: "x" };
    expect(canonicalizeFilePathFields(noImg, "Item")).toBe(noImg);
  });
});

describe("uploadDataFile write-boundary (post-decode target)", () => {
  function installFilePicker() {
    const upload = vi.fn(async (_source, directory, file) => ({
      path: canonicalizeDataPath(`${directory}/${file.name}`)
    }));
    globalThis.game = { world: { id: "world-1" } };
    globalThis.foundry.applications.apps.FilePicker.implementation = { upload };
    return upload;
  }

  afterEach(() => {
    delete globalThis.foundry.applications.apps.FilePicker.implementation;
    delete globalThis.game;
    vi.restoreAllMocks();
  });

  const CONTENT = "aGk=";

  it.each([
    ["a percent-encoded lowercase `..` segment", "worlds/world-1/%2e%2e/evil.png"],
    ["a percent-encoded uppercase `..` segment", "worlds/world-1/%2E%2E/evil.png"],
    ["a climbing chain of encoded `..` segments", "worlds/world-1/%2e%2e/%2e%2e/evil.png"],
    ["an encoded `..` produced via an encoded slash", "worlds/world-1/%2e%2e%2fevil.png"]
  ])("rejects %s with PATH_NOT_ALLOWED and never calls FilePicker.upload", async (_label, path) => {
    const upload = installFilePicker();
    await expect(uploadDataFile(path, CONTENT)).rejects.toMatchObject({
      code: "PATH_NOT_ALLOWED"
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it("also rejects an encoded-traversal dry run so the dry run predicts the real refusal", async () => {
    const upload = installFilePicker();
    await expect(
      uploadDataFile("worlds/world-1/%2e%2e/evil.png", CONTENT, null, { dryRun: true })
    ).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("still accepts a legit percent-encoded name and writes the DECODED literal file", async () => {
    const upload = installFilePicker();
    const result = await uploadDataFile("worlds/world-1/assets/my%20art.png", CONTENT);

    expect(upload).toHaveBeenCalledTimes(1);
    const [, directory, file] = upload.mock.calls[0];
    expect(directory).toBe("worlds/world-1/assets");
    expect(file.name).toBe("my art.png");

    expect(result.file.path).toBe("worlds/world-1/assets/my%20art.png");
  });
});

describe("mkdirDataPath write-boundary (post-decode target)", () => {
  function installFilePicker() {
    const createDirectory = vi.fn(async (_source, _target) => undefined);
    globalThis.game = { world: { id: "world-1" } };
    globalThis.foundry.applications.apps.FilePicker.implementation = { createDirectory };
    return createDirectory;
  }

  afterEach(() => {
    delete globalThis.foundry.applications.apps.FilePicker.implementation;
    delete globalThis.game;
    vi.restoreAllMocks();
  });

  it.each([
    ["a percent-encoded lowercase `..` segment", "worlds/world-1/%2e%2e"],
    ["a percent-encoded uppercase `..` segment", "worlds/world-1/%2E%2E/child"],
    ["an encoded `..` produced via an encoded slash", "worlds/world-1/%2e%2e%2fchild"]
  ])("rejects %s with PATH_NOT_ALLOWED and never calls FilePicker.createDirectory", async (_label, path) => {
    const createDirectory = installFilePicker();
    await expect(mkdirDataPath(path)).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });
    expect(createDirectory).not.toHaveBeenCalled();
  });

  it("still accepts a legit percent-encoded directory name", async () => {
    const createDirectory = installFilePicker();
    const result = await mkdirDataPath("worlds/world-1/my%20folder");
    expect(createDirectory).toHaveBeenCalledTimes(1);

    expect(createDirectory.mock.calls[0][1]).toBe("worlds/world-1/my%20folder");

    expect(result.directory.path).toBe("worlds/world-1/my%20folder");
  });
});

describe("deleteDataFile write-boundary (post-decode target)", () => {
  afterEach(() => {
    delete globalThis.foundry.applications.apps.FilePicker.implementation;
    delete globalThis.game;
    vi.restoreAllMocks();
  });

  it.each([
    ["a percent-encoded lowercase `..` segment", "worlds/world-1/%2e%2e/%2e%2e/modules/x.js"],
    ["a percent-encoded uppercase `..` segment", "worlds/world-1/%2E%2E/evil.png"],
    ["an encoded `..` produced via an encoded slash", "worlds/world-1/%2e%2e%2fevil.png"]
  ])("rejects %s with PATH_NOT_ALLOWED (not UNSUPPORTED_OPERATION)", async (_label, path) => {
    globalThis.game = { world: { id: "world-1" } };
    globalThis.foundry.applications.apps.FilePicker.implementation = {};
    await expect(deleteDataFile(path)).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });

    await expect(deleteDataFile(path, { dryRun: true })).rejects.toMatchObject({
      code: "PATH_NOT_ALLOWED"
    });
  });
});
