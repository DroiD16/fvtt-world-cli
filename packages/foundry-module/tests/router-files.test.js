import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";

import {
  createFetchResponse,
  createRequest,
  getParentPath,
  installFakeFoundry
} from "./helpers/fake-foundry.js";

describe("command router", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  it("lists and stats data paths through file commands", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const listResponse = await router.route(createRequest("file.list", { path: "worlds/world-1" }));
    const statResponse = await router.route(
      createRequest("file.stat", { path: "worlds/world-1/readme.txt" })
    );

    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.entries.map((entry) => entry.path)).toEqual([
      "worlds/world-1/maps",
      "worlds/world-1/readme.txt"
    ]);
    expect(statResponse.ok).toBe(true);
    expect(statResponse.result.entry).toMatchObject({
      path: "worlds/world-1/readme.txt",
      kind: "file",
      mediaCategory: "text"
    });
  });

  it("walks nested directories through file.list recursive (handler branch + bounds)", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(
      createRequest("file.list", { path: "worlds/world-1", recursive: true, maxDepth: 5 })
    );

    expect(response.ok).toBe(true);
    expect(response.result.recursive).toBe(true);

    expect(response.result.entries.map((entry) => entry.path)).toEqual([
      "worlds/world-1/maps",
      "worlds/world-1/maps/dungeon.webp",
      "worlds/world-1/readme.txt"
    ]);
    expect(response.result.entries.map((entry) => entry.depth)).toEqual([1, 2, 1]);
    expect(response.result.truncated).toBe(false);
    expect(response.result.truncatedAt).toBeNull();
    expect(response.result.skipped).toEqual([]);
  });

  it("caps file.list recursive at maxEntries and reports truncation", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(
      createRequest("file.list", { path: "worlds/world-1", recursive: true, maxEntries: 1 })
    );

    expect(response.ok).toBe(true);
    expect(response.result.entries).toHaveLength(1);
    expect(response.result.entries[0].path).toBe("worlds/world-1/maps");
    expect(response.result.truncated).toBe(true);
    expect(response.result.truncatedAt).toBe("worlds/world-1/maps");
  });

  it("reads text files through file.read", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(
      createRequest("file.read", { path: "worlds/world-1/readme.txt", encoding: "text" })
    );

    expect(response.ok).toBe(true);
    expect(response.result.file.path).toBe("worlds/world-1/readme.txt");
    expect(response.result.encoding).toBe("text");
    expect(response.result.content).toBe("hello world");
  });

  it("reads a file whose name contains '#' (per-segment fetch encoding)", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const target = "worlds/world-1/note#draft?v=1.txt";
    const parent = globalThis.__routerTestState.directoryContents.get("worlds/world-1");
    parent.files = [...parent.files, { path: target, size: 5, mimeType: "text/plain" }];
    globalThis.__routerTestState.fileContents.set(target, new TextEncoder().encode("hi #1"));

    const response = await router.route(createRequest("file.read", { path: target, encoding: "text" }));

    expect(response.ok).toBe(true);
    expect(response.result.content).toBe("hi #1");

    const fetchMock = /** @type {any} */ (globalThis.fetch);
    const fetchedUrl = String(fetchMock.mock.calls.at(-1)[0]);
    expect(fetchedUrl).toContain("%23");
    expect(fetchedUrl).toContain("%3F");
    expect(fetchedUrl).not.toContain("#");
  });

  it("round-trips file.list -> file.read/stat for names with '#', space, and '%' (encoded browse output)", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const literalPath = "worlds/world-1/zz #hash.txt";
    const encodedPath = "worlds/world-1/zz%20%23hash.txt";
    const parent = globalThis.__routerTestState.directoryContents.get("worlds/world-1");

    parent.files = [...parent.files, { path: encodedPath, size: 5, mimeType: "text/plain" }];

    globalThis.__routerTestState.fileContents.set(literalPath, new TextEncoder().encode("hi #1"));

    const listResponse = await router.route(createRequest("file.list", { path: "worlds/world-1" }));
    expect(listResponse.ok).toBe(true);
    const listed = listResponse.result.entries.find((entry) => entry.path === encodedPath);
    expect(listed).toBeTruthy();

    const fetchMock = /** @type {any} */ (globalThis.fetch);

    const literalRead = await router.route(
      createRequest("file.read", { path: literalPath, encoding: "text" })
    );
    expect(literalRead.ok).toBe(true);
    expect(literalRead.result.content).toBe("hi #1");
    let fetchedUrl = String(fetchMock.mock.calls.at(-1)[0]);
    expect(fetchedUrl).toContain("%20");
    expect(fetchedUrl).toContain("%23");

    expect(fetchedUrl).not.toContain("%25");

    const encodedRead = await router.route(
      createRequest("file.read", { path: encodedPath, encoding: "text" })
    );
    expect(encodedRead.ok).toBe(true);
    expect(encodedRead.result.content).toBe("hi #1");
    fetchedUrl = String(fetchMock.mock.calls.at(-1)[0]);
    expect(fetchedUrl).not.toContain("%25");

    const literalStat = await router.route(createRequest("file.stat", { path: literalPath }));
    expect(literalStat.ok).toBe(true);
    expect(literalStat.result.entry.kind).toBe("file");
    const encodedStat = await router.route(createRequest("file.stat", { path: encodedPath }));
    expect(encodedStat.ok).toBe(true);
    expect(encodedStat.result.entry.kind).toBe("file");
  });

  it("does not double-encode a literal '%' in a filename on read (no %2520)", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const literalPath = "worlds/world-1/zz 50% off.txt";
    const encodedPath = "worlds/world-1/zz%2050%25%20off.txt";
    const parent = globalThis.__routerTestState.directoryContents.get("worlds/world-1");
    parent.files = [...parent.files, { path: encodedPath, size: 3, mimeType: "text/plain" }];
    globalThis.__routerTestState.fileContents.set(literalPath, new TextEncoder().encode("hey"));

    const fetchMock = /** @type {any} */ (globalThis.fetch);

    for (const path of [literalPath, encodedPath]) {
      const response = await router.route(createRequest("file.read", { path, encoding: "text" }));
      expect(response.ok).toBe(true);
      expect(response.result.content).toBe("hey");
      const fetchedUrl = String(fetchMock.mock.calls.at(-1)[0]);

      expect(fetchedUrl).not.toContain("%2520");
      expect(fetchedUrl).not.toContain("%2525");
    }
  });

  it("resolves a lone literal filename that contains a VALID escape sequence by its literal path", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const literalPath = "worlds/world-1/report%20final.txt";
    const browsePath = "worlds/world-1/report%2520final.txt";
    const parent = globalThis.__routerTestState.directoryContents.get("worlds/world-1");
    parent.files = [...parent.files, { path: browsePath, size: 3, mimeType: "text/plain" }];
    globalThis.__routerTestState.fileContents.set(literalPath, new TextEncoder().encode("yo!"));

    const fetchMock = /** @type {any} */ (globalThis.fetch);

    const statResponse = await router.route(createRequest("file.stat", { path: literalPath }));
    expect(statResponse.ok).toBe(true);
    expect(statResponse.result.entry.kind).toBe("file");

    const readResponse = await router.route(
      createRequest("file.read", { path: literalPath, encoding: "text" })
    );
    expect(readResponse.ok).toBe(true);
    expect(readResponse.result.content).toBe("yo!");
    const fetchedUrl = String(fetchMock.mock.calls.at(-1)[0]);

    expect(fetchedUrl).toContain("report%2520final.txt");
    expect(fetchedUrl).not.toContain("%252520");

    const encodedRead = await router.route(
      createRequest("file.read", { path: browsePath, encoding: "text" })
    );
    expect(encodedRead.ok).toBe(true);
    expect(encodedRead.result.content).toBe("yo!");
  });

  it("creates directories and uploads files through file mutations", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    await router.route(createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli" }));
    const mkdirResponse = await router.route(
      createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli/assets" })
    );
    const uploadResponse = await router.route(
      createRequest("file.upload", {
        path: "worlds/world-1/fvtt-world-cli/assets/token.txt",
        contentBase64: Buffer.from("token-data", "utf8").toString("base64"),
        mimeType: "text/plain"
      })
    );

    expect(mkdirResponse.ok).toBe(true);
    expect(mkdirResponse.result.directory.path).toBe("worlds/world-1/fvtt-world-cli/assets");
    expect(uploadResponse.ok).toBe(true);
    expect(uploadResponse.result.file).toMatchObject({
      path: "worlds/world-1/fvtt-world-cli/assets/token.txt",
      kind: "file",
      mediaCategory: "text"
    });
  });

  it("canonicalizes the returned path of file.mkdir and a file.upload dry-run to the stored form", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    await router.route(createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli" }));
    const mkdirResponse = await router.route(
      createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli/It's a dir" })
    );
    expect(mkdirResponse.ok).toBe(true);
    expect(mkdirResponse.result.directory.path).toBe("worlds/world-1/fvtt-world-cli/It%27s%20a%20dir");

    const dryUpload = await router.route(
      createRequest("file.upload", {
        path: "worlds/world-1/fvtt-world-cli/a b (x) #1.txt",
        contentBase64: Buffer.from("hi", "utf8").toString("base64"),
        mimeType: "text/plain",
        dryRun: true
      })
    );
    expect(dryUpload.ok).toBe(true);
    expect(dryUpload.result.dryRun).toBe(true);
    expect(dryUpload.result.file.path).toBe("worlds/world-1/fvtt-world-cli/a%20b%20(x)%20%231.txt");
  });

  async function seedDeletableFile(router, path) {
    await router.route(createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli" }));
    await router.route(createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli/assets" }));
    await router.route(
      createRequest("file.upload", {
        path,
        contentBase64: Buffer.from("scratch", "utf8").toString("base64"),
        mimeType: "text/plain"
      })
    );
  }

  function installDeletePrimitive() {
    const { directoryContents, fileContents } = globalThis.__routerTestState;
    const spy = vi.fn(async (_source, target) => {
      fileContents.delete(target);
      const parent = directoryContents.get(getParentPath(target));
      if (parent) {
        parent.files = parent.files.filter((entry) => entry.path !== target);
      }
    });
    globalThis.foundry.applications.apps.FilePicker.implementation.delete = spy;
    return spy;
  }

  it("never auto-invokes an unpinned FilePicker.delete; returns UNSUPPORTED_OPERATION (real and dry-run)", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });
    const deleteSpy = installDeletePrimitive();
    const path = "worlds/world-1/fvtt-world-cli/assets/gone.txt";
    await seedDeletableFile(router, path);

    const real = await router.route(createRequest("file.delete", { path }));
    expect(real.ok).toBe(false);
    expect(real.error.code).toBe("UNSUPPORTED_OPERATION");

    const dry = await router.route(createRequest("file.delete", { path, dryRun: true }));
    expect(dry.ok).toBe(false);
    expect(dry.error.code).toBe("UNSUPPORTED_OPERATION");

    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("returns UNSUPPORTED_OPERATION when no delete primitive exists (real and dry-run)", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const path = "worlds/world-1/fvtt-world-cli/assets/x.txt";
    await seedDeletableFile(router, path);

    const real = await router.route(createRequest("file.delete", { path }));
    expect(real.ok).toBe(false);
    expect(real.error.code).toBe("UNSUPPORTED_OPERATION");

    expect(real.error.message).toContain("FilePicker");
    expect(real.error.message).toContain("no in-app delete control");
    expect(real.error.details.path).toBe(path);

    const dry = await router.route(createRequest("file.delete", { path, dryRun: true }));
    expect(dry.ok).toBe(false);
    expect(dry.error.code).toBe("UNSUPPORTED_OPERATION");
  });

  it("returns UNSUPPORTED_OPERATION for a real delete of a missing file in the write area", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const deleteSpy = installDeletePrimitive();

    const response = await router.route(
      createRequest("file.delete", { path: "worlds/world-1/fvtt-world-cli/assets/absent.txt" })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("returns UNSUPPORTED_OPERATION for a directory target (capability gate precedes the dir guard)", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });
    const deleteSpy = installDeletePrimitive();

    await router.route(createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli" }));
    await router.route(createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli/assets" }));
    const dirPath = "worlds/world-1/fvtt-world-cli/assets";

    const real = await router.route(createRequest("file.delete", { path: dirPath }));
    expect(real.ok).toBe(false);
    expect(real.error.code).toBe("UNSUPPORTED_OPERATION");

    const dry = await router.route(createRequest("file.delete", { path: dirPath, dryRun: true }));
    expect(dry.ok).toBe(false);
    expect(dry.error.code).toBe("UNSUPPORTED_OPERATION");

    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["false", async () => false],
    ["undefined", async () => undefined],
    ["a pathless object", async () => ({ status: "error", message: "delete failed" })]
  ])(
    "never invokes a non-throwing delete primitive; returns UNSUPPORTED_OPERATION (%s)",
    async (_label, badDelete) => {
      const router = createCommandRouter({
        bridgeClient: { getStatus: () => ({ status: "connected" }) }
      });
      const path = "worlds/world-1/fvtt-world-cli/assets/survivor.txt";
      await seedDeletableFile(router, path);

      const spy = vi.fn(badDelete);
      globalThis.foundry.applications.apps.FilePicker.implementation.delete = spy;

      const response = await router.route(createRequest("file.delete", { path }));

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
      expect(spy).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["worlds/world-1/world.json", "world manifest"],
    ["worlds/world-1/data/actors/000001.ldb", "a file in the world data store"],
    ["worlds/world-1/packs/items.db", "a world compendium pack"],
    ["worlds/other-world/fvtt-world-cli/z.txt", "another world"],
    ["worlds/world-1", "the bare world root"],
    ["../secrets", "traversal"],
    ["/etc/passwd", "absolute"]
  ])("hard-denies file.delete with PATH_NOT_ALLOWED before the capability gate (%s)", async (path) => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const deleteSpy = installDeletePrimitive();

    const response = await router.route(createRequest("file.delete", { path }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("PATH_NOT_ALLOWED");
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("hard-denies file.delete with PATH_NOT_ALLOWED before the capability gate on a no-primitive core", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const response = await router.route(createRequest("file.delete", { path: "worlds/world-1/world.json" }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("PATH_NOT_ALLOWED");
  });

  it.each([
    ["false", false],
    ["undefined", undefined],
    ["a pathless object", { status: "error", message: "quota exceeded" }]
  ])(
    "surfaces a failed upload as INTERNAL_ERROR when FilePicker.upload returns %s",
    async (_label, badResponse) => {
      const router = createCommandRouter({
        bridgeClient: { getStatus: () => ({ status: "connected" }) }
      });

      await router.route(createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli" }));
      await router.route(createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli/assets" }));

      globalThis.foundry.applications.apps.FilePicker.implementation.upload = vi.fn(async () => badResponse);

      const uploadResponse = await router.route(
        createRequest("file.upload", {
          path: "worlds/world-1/fvtt-world-cli/assets/ghost.txt",
          contentBase64: Buffer.from("never-written", "utf8").toString("base64"),
          mimeType: "text/plain"
        })
      );

      expect(uploadResponse.ok).toBe(false);
      expect(uploadResponse.error.code).toBe("INTERNAL_ERROR");
      expect(uploadResponse.error.details.path).toBe("worlds/world-1/fvtt-world-cli/assets/ghost.txt");
    }
  );

  function installMovePrimitive() {
    const spy = vi.fn(async (_source, _from, _to) => {});
    globalThis.foundry.applications.apps.FilePicker.implementation.move = spy;
    return spy;
  }

  it("never auto-invokes an unpinned FilePicker.move; returns UNSUPPORTED_OPERATION (real and dry-run)", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });
    const moveSpy = installMovePrimitive();
    await router.route(createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli" }));
    await router.route(createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli/assets" }));
    await router.route(
      createRequest("file.upload", {
        path: "worlds/world-1/fvtt-world-cli/assets/from.txt",
        contentBase64: Buffer.from("scratch", "utf8").toString("base64"),
        mimeType: "text/plain"
      })
    );

    const from = "worlds/world-1/fvtt-world-cli/assets/from.txt";
    const to = "worlds/world-1/fvtt-world-cli/assets/to.txt";

    const real = await router.route(createRequest("file.move", { from, to }));
    expect(real.ok).toBe(false);
    expect(real.error.code).toBe("UNSUPPORTED_OPERATION");
    expect(real.error.message).toContain("FilePicker");
    expect(real.error.message).toContain("no in-app move/rename control");
    expect(real.error.details.from).toBe(from);
    expect(real.error.details.to).toBe(to);

    const dry = await router.route(createRequest("file.move", { from, to, dryRun: true }));
    expect(dry.ok).toBe(false);
    expect(dry.error.code).toBe("UNSUPPORTED_OPERATION");

    expect(moveSpy).not.toHaveBeenCalled();
  });

  it("returns UNSUPPORTED_OPERATION when no move primitive exists (stock core, real and dry-run)", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const from = "worlds/world-1/fvtt-world-cli/assets/a.txt";
    const to = "worlds/world-1/fvtt-world-cli/assets/b.txt";

    const real = await router.route(createRequest("file.move", { from, to }));
    expect(real.ok).toBe(false);
    expect(real.error.code).toBe("UNSUPPORTED_OPERATION");

    const dry = await router.route(createRequest("file.move", { from, to, dryRun: true }));
    expect(dry.ok).toBe(false);
    expect(dry.error.code).toBe("UNSUPPORTED_OPERATION");
  });

  it.each([
    ["worlds/world-1/world.json", "world manifest"],
    ["worlds/world-1/data/actors/000001.ldb", "a file in the world data store"],
    ["worlds/world-1/packs/items.db", "a world compendium pack"],
    ["worlds/other-world/fvtt-world-cli/z.txt", "another world"],
    ["worlds/world-1", "the bare world root"],
    ["../secrets", "traversal"],
    ["/etc/passwd", "absolute"],
    ["worlds/world-1/fvtt-world-cli/%2e%2e/escape.txt", "encoded traversal"]
  ])(
    "hard-denies file.move with PATH_NOT_ALLOWED for a bad SOURCE before the capability gate (%s)",
    async (from) => {
      const router = createCommandRouter({
        bridgeClient: { getStatus: () => ({ status: "connected" }) }
      });
      const moveSpy = installMovePrimitive();

      const response = await router.route(
        createRequest("file.move", { from, to: "worlds/world-1/fvtt-world-cli/assets/ok.txt" })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("PATH_NOT_ALLOWED");
      expect(moveSpy).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["worlds/world-1/world.json", "world manifest"],
    ["worlds/world-1/data/actors/000001.ldb", "a file in the world data store"],
    ["worlds/world-1/packs/items.db", "a world compendium pack"],
    ["worlds/other-world/fvtt-world-cli/z.txt", "another world"],
    ["worlds/world-1", "the bare world root"],
    ["../secrets", "traversal"],
    ["/etc/passwd", "absolute"],
    ["worlds/world-1/fvtt-world-cli/%2e%2e/escape.txt", "encoded traversal"]
  ])(
    "hard-denies file.move with PATH_NOT_ALLOWED for a bad DESTINATION before the capability gate (%s)",
    async (to) => {
      const router = createCommandRouter({
        bridgeClient: { getStatus: () => ({ status: "connected" }) }
      });
      const moveSpy = installMovePrimitive();

      const response = await router.route(
        createRequest("file.move", { from: "worlds/world-1/fvtt-world-cli/assets/ok.txt", to })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("PATH_NOT_ALLOWED");
      expect(moveSpy).not.toHaveBeenCalled();
    }
  );

  it("hard-denies file.move with PATH_NOT_ALLOWED before the capability gate on a no-primitive core", async () => {
    const router = createCommandRouter({
      bridgeClient: { getStatus: () => ({ status: "connected" }) }
    });

    const response = await router.route(
      createRequest("file.move", {
        from: "worlds/world-1/world.json",
        to: "worlds/world-1/fvtt-world-cli/assets/x.txt"
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("PATH_NOT_ALLOWED");
  });

  it("keeps uploaded file metadata consistent across list, stat, and read", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const expectedText = "roundtrip payload";
    const expectedBase64 = Buffer.from(expectedText, "utf8").toString("base64");

    await router.route(createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli" }));
    await router.route(createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli/assets" }));

    const uploadResponse = await router.route(
      createRequest("file.upload", {
        path: "worlds/world-1/fvtt-world-cli/assets/roundtrip.txt",
        contentBase64: expectedBase64,
        mimeType: "text/plain"
      })
    );
    const listResponse = await router.route(
      createRequest("file.list", { path: "worlds/world-1/fvtt-world-cli/assets" })
    );
    const statResponse = await router.route(
      createRequest("file.stat", { path: "worlds/world-1/fvtt-world-cli/assets/roundtrip.txt" })
    );
    const readTextResponse = await router.route(
      createRequest("file.read", {
        path: "worlds/world-1/fvtt-world-cli/assets/roundtrip.txt",
        encoding: "text"
      })
    );
    const readBase64Response = await router.route(
      createRequest("file.read", {
        path: "worlds/world-1/fvtt-world-cli/assets/roundtrip.txt",
        encoding: "base64"
      })
    );

    const listedEntry = listResponse.result.entries.find(
      (entry) => entry.path === "worlds/world-1/fvtt-world-cli/assets/roundtrip.txt"
    );

    expect(uploadResponse.ok).toBe(true);
    expect(listResponse.ok).toBe(true);
    expect(statResponse.ok).toBe(true);
    expect(readTextResponse.ok).toBe(true);
    expect(readBase64Response.ok).toBe(true);
    expect(listedEntry).toMatchObject({
      path: "worlds/world-1/fvtt-world-cli/assets/roundtrip.txt",
      kind: "file",
      mediaCategory: "text"
    });
    expect(statResponse.result.entry).toMatchObject({
      path: "worlds/world-1/fvtt-world-cli/assets/roundtrip.txt",
      kind: "file",
      mediaCategory: "text"
    });
    expect(statResponse.result.entry.kind).toBe(listedEntry.kind);
    expect(statResponse.result.entry.path).toBe(listedEntry.path);
    expect(readTextResponse.result.content).toBe(expectedText);
    expect(readTextResponse.result.file.kind).toBe("file");
    expect(readBase64Response.result.content).toBe(expectedBase64);
  });

  it("allows file mutations at the world write root itself", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const mkdirResponse = await router.route(
      createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli" })
    );

    expect(mkdirResponse.ok).toBe(true);
    expect(mkdirResponse.result.directory.path).toBe("worlds/world-1/fvtt-world-cli");
  });

  it.each([
    ["worlds/world-1/user-assets", "world user-assets directory"],
    ["worlds/world-1/assets", "world assets directory"]
  ])("allows file.mkdir under the world tree outside fvtt-world-cli (%s)", async (path) => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(createRequest("file.mkdir", { path }));

    expect(response.ok).toBe(true);
    expect(response.result.directory.path).toBe(path);
  });

  it("allows file.upload under the world tree outside fvtt-world-cli", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(
      createRequest("file.upload", {
        path: "worlds/world-1/maps/token.txt",
        contentBase64: Buffer.from("hi", "utf8").toString("base64")
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.file.path).toBe("worlds/world-1/maps/token.txt");
  });

  it("allows writes to a data-prefixed sibling that is not the live-data subtree", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(createRequest("file.mkdir", { path: "worlds/world-1/datasets" }));

    expect(response.ok).toBe(true);
    expect(response.result.directory.path).toBe("worlds/world-1/datasets");
  });

  it("rejects file.upload to the bare world write root", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(
      createRequest("file.upload", {
        path: "worlds/world-1",
        contentBase64: Buffer.from("nope", "utf8").toString("base64")
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("PATH_NOT_ALLOWED");
  });

  it.each([
    ["modules/fvtt-world-cli/x.txt", "module directory"],
    ["systems/dnd5e/x.txt", "system directory"],
    ["worlds/other-world/fvtt-world-cli/z.txt", "another world"],
    ["worlds/world-1-evil/z.txt", "sibling that shares the world-dir prefix"]
  ])("rejects file.upload outside the world write root (%s)", async (path) => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(
      createRequest("file.upload", {
        path,
        contentBase64: Buffer.from("nope", "utf8").toString("base64")
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("PATH_NOT_ALLOWED");

    expect(response.error.message).toContain(response.error.details.writeRoot);
    expect(response.error.message).toContain("outside the active world directory");
  });

  it.each([
    ["modules/fvtt-world-cli/dir", "module directory"],
    ["worlds/other-world/fvtt-world-cli/dir", "another world"],
    ["worlds/world-1-evil/dir", "sibling that shares the world-dir prefix"]
  ])("rejects file.mkdir outside the world write root (%s)", async (path) => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(createRequest("file.mkdir", { path }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("PATH_NOT_ALLOWED");
    expect(response.error.message).toContain("outside the active world directory");
  });

  it.each([
    ["worlds/world-1/world.json", "world manifest"],
    ["worlds/world-1/data", "the world data directory itself"],
    ["worlds/world-1/data/actors/000001.ldb", "a file in the world data store"],
    ["worlds/world-1/packs", "the world packs directory itself"],
    ["worlds/world-1/packs/items.db", "a world compendium pack"]
  ])("hard-denies writes to the live world's data/manifest (%s)", async (path) => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const uploadResponse = await router.route(
      createRequest("file.upload", {
        path,
        contentBase64: Buffer.from("nope", "utf8").toString("base64")
      })
    );
    const mkdirResponse = await router.route(createRequest("file.mkdir", { path }));

    for (const response of [uploadResponse, mkdirResponse]) {
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("PATH_NOT_ALLOWED");

      expect(response.error.message).toContain("prevent corruption");
      expect(response.error.details.path).toBe(path);
    }
  });

  it("labels a cross-world data path as outside-the-world, not corruption", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(createRequest("file.mkdir", { path: "worlds/other-world/data/x" }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("PATH_NOT_ALLOWED");
    expect(response.error.message).toContain("outside the active world directory");
    expect(response.error.message).not.toContain("prevent corruption");
  });

  it("keeps read/list/stat broad outside the managed write root", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const listResponse = await router.route(createRequest("file.list", { path: "worlds/world-1" }));
    const statResponse = await router.route(
      createRequest("file.stat", { path: "worlds/world-1/readme.txt" })
    );
    const readResponse = await router.route(
      createRequest("file.read", { path: "worlds/world-1/readme.txt", encoding: "text" })
    );

    expect(listResponse.ok).toBe(true);
    expect(statResponse.ok).toBe(true);
    expect(readResponse.ok).toBe(true);
    expect(readResponse.result.content).toBe("hello world");
  });

  it("blocks file mutations with BRIDGE_NOT_READY when no world is active", async () => {
    globalThis.game.world = undefined;

    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(
      createRequest("file.mkdir", { path: "worlds/world-1/fvtt-world-cli/x" })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("BRIDGE_NOT_READY");

    expect(response.error.message).toMatch(/world is not available/i);
  });

  it("uses the v13 namespaced FilePicker implementation", async () => {
    const namespacedBrowse = vi.fn(async () => ({ target: "", dirs: [], files: [] }));
    const previousFoundry = globalThis.foundry;
    globalThis.foundry = {
      applications: { apps: { FilePicker: { implementation: { browse: namespacedBrowse } } } }
    };

    try {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(createRequest("file.list", { path: "" }));

      expect(response.ok).toBe(true);
      expect(namespacedBrowse).toHaveBeenCalled();
    } finally {
      globalThis.foundry = previousFoundry;
    }
  });

  it("falls back to the namespaced FilePicker class when it has no .implementation", async () => {
    const classBrowse = vi.fn(async () => ({ target: "", dirs: [], files: [] }));
    const previousFoundry = globalThis.foundry;

    globalThis.foundry = {
      applications: { apps: { FilePicker: { browse: classBrowse } } }
    };

    try {
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(createRequest("file.list", { path: "" }));

      expect(response.ok).toBe(true);
      expect(classBrowse).toHaveBeenCalled();
    } finally {
      globalThis.foundry = previousFoundry;
    }
  });

  it("rejects traversal paths for file commands", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(createRequest("file.list", { path: "../secrets" }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("PATH_NOT_ALLOWED");
  });

  it("returns payload-too-large for oversized file reads", async () => {
    globalThis.__routerTestState.fetchOverrides.set(
      "worlds/world-1/readme.txt",
      createFetchResponse({
        ok: true,
        status: 200,
        bytes: new Uint8Array([1]),
        contentType: "text/plain",
        contentLength: String(1024 * 1024 + 1)
      })
    );

    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(
      createRequest("file.read", { path: "worlds/world-1/readme.txt", encoding: "text" })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("PAYLOAD_TOO_LARGE");

    expect(response.error.message).toContain(String(1024 * 1024));
    expect(response.error.message).toContain(String(1024 * 1024 + 1));
    expect(response.error.details.limitBytes).toBe(1024 * 1024);
    expect(response.error.details.sizeBytes).toBe(1024 * 1024 + 1);
  });
});
