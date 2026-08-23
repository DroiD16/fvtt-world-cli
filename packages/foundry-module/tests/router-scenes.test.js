import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";

import { ERROR_CODES } from "../scripts/generated/protocol.js";

import { createRequest, installFakeFoundry } from "./helpers/fake-foundry.js";

describe("command router", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  it("updates scenes through scene.update", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(
      createRequest("scene.update", {
        sceneId: "scene-1",
        patch: {
          name: "Dungeon Level 2",
          tokenVision: false,
          weather: "storm",
          environment: { darkness: 0.8 },
          background: {
            src: "worlds/world-1/maps/level-2.webp"
          }
        }
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.scene.name).toBe("Dungeon Level 2");
    expect(response.result.scene.background.src).toBe("worlds/world-1/maps/level-2.webp");
    expect(response.result.scene.tokenVision).toBe(false);
    expect(response.result.scene.weather).toBe("storm");
    expect(response.result.scene.environment).toEqual({ darkness: 0.8 });
  });

  it("canonicalizes a literal scene background.src and passes an absolute https:// value through", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.update", {
        sceneId: "scene-1",
        patch: {
          background: { src: "worlds/world-1/maps/level 2 (v3).webp" },
          foreground: "https://cdn.example.com/fg top.webp"
        }
      })
    );
    expect(response.ok).toBe(true);
    expect(response.result.scene.background.src).toBe("worlds/world-1/maps/level%202%20(v3).webp");
    expect(response.result.scene.foreground).toBe("https://cdn.example.com/fg top.webp");
  });

  describe("scene levels-relocated fields v13-only gate", () => {
    const v14 = () => {
      globalThis.game.release = { version: "14.365", generation: 14 };
    };

    it("scene.update with foreground rejects on v14 (UNSUPPORTED_OPERATION), reporting only the supplied field", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.update", { sceneId: "scene-1", patch: { foreground: "worlds/world-1/fg.webp" } })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
      expect(response.error.message).toContain("v13 only");
      expect(response.error.details.fields).toEqual(["foreground"]);
    });

    it("scene.update with foregroundElevation rejects on v14", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.update", { sceneId: "scene-1", patch: { foregroundElevation: 20 } })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
      expect(response.error.details.fields).toEqual(["foregroundElevation"]);
    });

    it("scene.update with background rejects on v14 (the whole key relocated to levels[])", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.update", {
          sceneId: "scene-1",
          patch: { background: { src: "worlds/world-1/bg.webp" } }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
      expect(response.error.details.fields).toEqual(["background"]);
    });

    it("scene.update with backgroundColor rejects on v14", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.update", { sceneId: "scene-1", patch: { backgroundColor: "#112233" } })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
      expect(response.error.details.fields).toEqual(["backgroundColor"]);
    });

    it("scene.update with fog.overlay rejects on v14, but fog.mode/fog.colors do NOT (still top-level)", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const rejected = await router.route(
        createRequest("scene.update", {
          sceneId: "scene-1",
          patch: { fog: { overlay: "worlds/world-1/fog.webp" } }
        })
      );
      expect(rejected.ok).toBe(false);
      expect(rejected.error.code).toBe("UNSUPPORTED_OPERATION");
      expect(rejected.error.details.fields).toEqual(["fog.overlay"]);

      const allowed = await router.route(
        createRequest("scene.update", {
          sceneId: "scene-1",
          patch: { fog: { mode: 0, colors: { explored: "#001122" } } }
        })
      );
      expect(allowed.ok).toBe(true);
    });

    it("scene.update with the fog.overlay DELETION form (-=overlay) rejects on v14", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.update", { sceneId: "scene-1", patch: { fog: { "-=overlay": null } } })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
      expect(response.error.details.fields).toEqual(["fog.overlay"]);
    });

    it("scene.clone with the fog.overlay DELETION form (-=overlay) in the patch rejects on v14", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.clone", { sceneId: "scene-1", patch: { fog: { "-=overlay": null } } })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
      expect(response.error.details.fields).toEqual(["fog.overlay"]);
    });

    it("scene.update with the fog.overlay DELETION form (-=overlay) is allowed on v13", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.update", { sceneId: "scene-1", patch: { fog: { "-=overlay": null } } })
      );
      expect(response.ok).toBe(true);
    });

    it("scene.update reports EVERY supplied gated field in details.fields", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.update", {
          sceneId: "scene-1",
          patch: {
            foreground: "worlds/world-1/fg.webp",
            backgroundColor: "#000000",
            fog: { overlay: "worlds/world-1/o.webp" }
          }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.details.fields).toEqual(["foreground", "backgroundColor", "fog.overlay"]);
    });

    it("scene.update with a foreground:null CLEAR still rejects on v14 (presence, not truthiness)", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.update", { sceneId: "scene-1", patch: { foreground: null } })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
    });

    it("scene.update gate fires under dryRun too (dry-run is not a bypass)", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.update", {
          sceneId: "scene-1",
          patch: { foreground: "worlds/world-1/fg.webp" },
          dryRun: true
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
    });

    it("scene.create with foreground rejects on v14 (partial/asymmetric migration → v13-only)", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.create", { data: { name: "New Scene", foreground: "worlds/world-1/fg.webp" } })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
    });

    it("scene.create with background rejects on v14", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.create", {
          data: { name: "New Scene", background: { src: "worlds/world-1/bg.webp" } }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
    });

    it("scene.create gate fires under dryRun too on v14", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.create", {
          data: { name: "New Scene", backgroundColor: "#334455" },
          dryRun: true
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
    });

    it("scene.clone with a gated field in the patch rejects on v14", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.clone", { sceneId: "scene-1", patch: { foreground: "worlds/world-1/fg.webp" } })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
    });

    it("scene.clone gate fires under dryRun too on v14", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.clone", {
          sceneId: "scene-1",
          patch: { background: { src: "worlds/world-1/bg.webp" } },
          dryRun: true
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
    });

    it("scene.clone WITHOUT a gated field in the patch is allowed on v14 (supply-only)", async () => {
      v14();
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.clone", { sceneId: "scene-1", patch: { name: "Copy" } })
      );
      expect(response.ok).toBe(true);
    });

    it("scene.update with the gated fields is allowed on v13 (generation 13 round-trips)", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
      const response = await router.route(
        createRequest("scene.update", {
          sceneId: "scene-1",
          patch: { foreground: "worlds/world-1/fg.webp", foregroundElevation: 30 }
        })
      );
      expect(response.ok).toBe(true);
      expect(response.result.scene.foreground).toBe("worlds/world-1/fg.webp");
      expect(response.result.scene.foregroundElevation).toBe(30);
    });
  });

  describe("scene action verbs", () => {
    const routerFor = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    function makeThumbDataUrl(bytes) {
      const payloadLength = Math.ceil(bytes / 3) * 4;
      const payload = "A".repeat(payloadLength);

      const remainder = bytes % 3;
      const padded =
        remainder === 0
          ? payload
          : remainder === 1
            ? `${payload.slice(0, -2)}==`
            : `${payload.slice(0, -1)}=`;
      return `data:image/webp;base64,${padded}`;
    }

    function v13ThumbnailResult(thumb, { width, height }) {
      return {
        src: { __pixiContainer: true },
        texture: { __destroyedRenderTexture: true },
        thumb,
        width,
        height
      };
    }

    function v14ThumbnailResult(thumb, { width, height }) {
      const result = { thumb, width, height, format: "image/webp", quality: 0.8 };
      Object.defineProperties(result, {
        src: {
          get() {
            throw new Error("deprecated src getter must not be touched");
          }
        },
        texture: {
          get() {
            throw new Error("deprecated texture getter must not be touched");
          }
        }
      });
      return result;
    }

    /**
     * @param {any} scene
     * @returns {{ storedPathFor: (dataUrl: string) => string }}
     */
    function installServerFilePathModel(scene) {
      const baseToObject = scene.toObject.bind(scene);
      let storedThumb = baseToObject()?.thumb ?? null;
      const generation = globalThis.game?.release?.generation ?? null;

      const digest = (/** @type {string} */ value) => {
        let hash = 0;
        for (let index = 0; index < value.length; index += 1) {
          hash = (hash * 31 + value.charCodeAt(index)) | 0;
        }
        return Math.abs(hash).toString(36);
      };
      const storedPathFor = (/** @type {string} */ dataUrl) =>
        generation !== null && generation >= 14
          ? `worlds/test-world/assets/scenes/thumb-${digest(dataUrl)}.webp`
          : `worlds/test-world/assets/scenes/${scene.id}-thumb.webp`;

      scene.update = vi.fn(async (patch) => {
        for (const [key, value] of Object.entries(patch)) {
          if (key === "thumb") {
            storedThumb =
              typeof value === "string" && value.startsWith("data:") ? storedPathFor(value) : value;

            scene.thumb = storedThumb ? `${String(storedThumb).split("?")[0]}?${Date.now()}` : storedThumb;
          } else {
            scene[key] = value;
          }
        }
        return scene;
      });
      scene.toObject = () => ({ ...baseToObject(), thumb: storedThumb });
      return { storedPathFor };
    }

    /** @param {{ viewedSceneId?: string | null, ids?: any[], reset?: any }} [options] */
    function installFogGlobals({ viewedSceneId = "scene-1", ids = [], reset } = {}) {
      const queue = Array.isArray(ids[0]) ? [...ids] : [ids];

      const get = vi.fn(async (_documentClass, _operation, _user) => {
        const next = queue.length > 1 ? queue.shift() : queue[0];
        return (next ?? []).map((id) => ({ _id: id }));
      });
      globalThis.CONFIG = { FogExploration: { documentClass: { database: { get } } } };
      globalThis.canvas = {
        scene: viewedSceneId ? { id: viewedSceneId } : null,
        fog: { reset: reset ?? vi.fn(async () => {}) }
      };
      return { get, reset: globalThis.canvas.fog.reset };
    }

    afterEach(() => {
      delete globalThis.canvas;
      delete globalThis.CONFIG;
    });

    it("generates + persists a thumbnail on v13, mapping Foundry's reported dims to SOURCE dims", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      const scene = globalThis.game.scenes.get("scene-1");
      const thumb = makeThumbDataUrl(1200);

      scene.createThumbnail = vi.fn(async () => v13ThumbnailResult(thumb, { width: 4000, height: 3000 }));
      installServerFilePathModel(scene);

      const response = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
      );

      expect(response.ok).toBe(true);
      expect(response.result.sceneId).toBe("scene-1");
      expect(response.result.thumbnail).toEqual({
        thumb: null,

        storedPath: "worlds/test-world/assets/scenes/scene-1-thumb.webp",
        sizeBytes: 1200,

        outputWidth: 300,
        outputHeight: 100,
        sourceWidth: 4000,
        sourceHeight: 3000,
        persisted: true
      });
      expect(scene.createThumbnail).toHaveBeenCalledWith({ width: 300, height: 100 });

      expect(scene.update).toHaveBeenCalledWith({ thumb }, { diff: true, render: true });

      expect(JSON.stringify(response)).not.toContain("__pixiContainer");
      expect(JSON.stringify(response)).not.toContain("__destroyedRenderTexture");
    });

    it("maps Foundry's reported dims to OUTPUT dims on v14 (and reports no source dims)", async () => {
      globalThis.game.release = { version: "14.365", generation: 14 };
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn(async () =>
        v14ThumbnailResult(makeThumbDataUrl(900), { width: 400, height: 300 })
      );
      installServerFilePathModel(scene);

      const response = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1", width: 400, height: 300 })
      );

      expect(response.ok).toBe(true);
      expect(response.result.thumbnail).toMatchObject({
        outputWidth: 400,
        outputHeight: 300,

        sourceWidth: null,
        sourceHeight: null,
        persisted: true
      });

      expect(response.result.thumbnail.storedPath).toBe(scene.toObject().thumb);
      expect(response.result.thumbnail.storedPath).not.toContain("data:");
      expect(scene.createThumbnail).toHaveBeenCalledWith({ width: 400, height: 300 });
    });

    it("a v13 repeat generate stays ok:true with the same stored path", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn(async () =>
        v13ThumbnailResult(makeThumbDataUrl(800), { width: 100, height: 100 })
      );
      installServerFilePathModel(scene);

      const first = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
      );
      const second = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
      );

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(second.result.thumbnail.persisted).toBe(true);
      expect(second.result.thumbnail.storedPath).toBe(first.result.thumbnail.storedPath);
    });

    it("reports the freshly stored path on a v14 regenerate at a different size", async () => {
      globalThis.game.release = { version: "14.365", generation: 14 };
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn(async ({ width }) =>
        v14ThumbnailResult(makeThumbDataUrl(width === 300 ? 300 : 900), { width, height: 100 })
      );
      installServerFilePathModel(scene);

      const first = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
      );
      const second = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1", width: 600, height: 100 })
      );

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(second.result.thumbnail.persisted).toBe(true);
      expect(second.result.thumbnail.storedPath).toBe(scene.toObject().thumb);
      expect(second.result.thumbnail.storedPath).not.toContain("data:");
    });

    it("is NOT subject to the v14 scene-levels gate", async () => {
      globalThis.game.release = { version: "14.365", generation: 14 };
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn(async () =>
        v14ThumbnailResult(makeThumbDataUrl(64), { width: 300, height: 100 })
      );
      installServerFilePathModel(scene);

      const response = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
      );

      expect(response.ok).toBe(true);
      expect(response.error).toBeUndefined();
      expect(scene.update).toHaveBeenCalled();
    });

    it("claims no source dims when the Foundry generation is unknown", async () => {
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn(async () => ({ thumb: makeThumbDataUrl(30), width: 4000, height: 3000 }));
      installServerFilePathModel(scene);

      const response = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1", width: 320, height: 240 })
      );

      expect(response.ok).toBe(true);
      expect(response.result.thumbnail).toMatchObject({
        outputWidth: 320,
        outputHeight: 240,
        sourceWidth: null,
        sourceHeight: null
      });
    });

    it("echoes the data URL only when includeThumb is requested", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      const scene = globalThis.game.scenes.get("scene-1");
      const thumb = makeThumbDataUrl(600);
      scene.createThumbnail = vi.fn(async () => v13ThumbnailResult(thumb, { width: 1000, height: 800 }));
      installServerFilePathModel(scene);

      const response = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1", includeThumb: true })
      );

      expect(response.ok).toBe(true);

      expect(response.result.thumbnail.thumb).toBe(thumb);
      expect(response.result.thumbnail.storedPath).toBe("worlds/test-world/assets/scenes/scene-1-thumb.webp");
      expect(response.result.thumbnail.sizeBytes).toBe(600);
    });

    it("a dry-run NEVER echoes a thumb, even with includeThumb (nothing is rendered)", async () => {
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn(async () =>
        v13ThumbnailResult(makeThumbDataUrl(600), { width: 10, height: 10 })
      );

      const response = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1", includeThumb: true, dryRun: true })
      );

      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result.thumbnail.thumb).toBeNull();
      expect(response.result.thumbnail.storedPath).toBeNull();
      expect(response.result.thumbnail.sizeBytes).toBeNull();
      expect(scene.createThumbnail).not.toHaveBeenCalled();
      expect(scene.update).not.toHaveBeenCalled();
    });

    it("scene.get returns the STORED thumb path after a generate, not Foundry's cache-busted live value", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn(async () =>
        v13ThumbnailResult(makeThumbDataUrl(600), { width: 4000, height: 3000 })
      );
      installServerFilePathModel(scene);

      const generated = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
      );
      expect(generated.ok).toBe(true);
      expect(generated.result.thumbnail.persisted).toBe(true);

      expect(scene.thumb).toMatch(/\?\d+$/);

      const read = await routerFor().route(createRequest("scene.get", { sceneId: "scene-1" }));

      expect(read.ok).toBe(true);

      expect(read.result.scene.thumb).toBe(generated.result.thumbnail.storedPath);
      expect(read.result.scene.thumb).toBe("worlds/test-world/assets/scenes/scene-1-thumb.webp");
      expect(read.result.scene.thumb).not.toContain("?");
    });

    it("scene.get reports thumb:null after a clear, never the cache-busted path of a prior generate", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn(async () =>
        v13ThumbnailResult(makeThumbDataUrl(600), { width: 4000, height: 3000 })
      );
      installServerFilePathModel(scene);

      const generated = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
      );
      expect(generated.ok).toBe(true);

      expect(generated.result.thumbnail.storedPath).toBe(
        "worlds/test-world/assets/scenes/scene-1-thumb.webp"
      );
      expect(scene.thumb).toMatch(/\?\d+$/);

      const cleared = await routerFor().route(
        createRequest("scene.update", { sceneId: "scene-1", patch: { thumb: null } })
      );

      expect(cleared.ok).toBe(true);
      expect(cleared.result.scene.thumb).toBeNull();
      expect(scene.update).toHaveBeenLastCalledWith({ thumb: null }, { diff: true, render: true });

      const read = await routerFor().route(createRequest("scene.get", { sceneId: "scene-1" }));

      expect(read.ok).toBe(true);
      expect(read.result.scene.thumb).toBeNull();

      expect(JSON.stringify(read.result.scene)).not.toContain("-thumb.webp");
    });

    it("reports a REJECTED thumb write with a named code and persisted:false, not a raw Foundry throw", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const scene = globalThis.game.scenes.get("scene-1");
        scene.createThumbnail = vi.fn(async () =>
          v13ThumbnailResult(makeThumbDataUrl(600), { width: 1000, height: 800 })
        );
        scene.update = vi.fn(async () => {
          throw new Error(
            "You lack FILES_UPLOAD permission and may not upload base64 data to the thumb field."
          );
        });

        const response = await routerFor().route(
          createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
        );

        expect(response.ok).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
        expect(response.error.message).toMatch(/rejected the update/i);
        expect(response.error.details).toMatchObject({
          sceneId: "scene-1",
          persisted: false,
          sizeBytes: 600,
          requested: { width: 300, height: 100 }
        });

        expect(response.error.details.message).toContain("FILES_UPLOAD");
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it("lets a Foundry validation error on the thumb write keep its INVALID_PARAMS classification", async () => {
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn(async () =>
        v13ThumbnailResult(makeThumbDataUrl(600), { width: 1000, height: 800 })
      );
      const validationError = new Error("thumb: does not have a valid file extension");
      validationError.name = "DataModelValidationError";
      scene.update = vi.fn(async () => {
        throw validationError;
      });

      const response = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe(ERROR_CODES.INVALID_PARAMS);
      expect(response.error.details).toMatchObject({ reason: "foundry_validation" });
      expect(response.error.details.message).toContain("valid file extension");
    });

    it("reports a world-side veto that silently drops the thumb write instead of claiming persisted", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const scene = globalThis.game.scenes.get("scene-1");
        const thumb = makeThumbDataUrl(600);
        scene.createThumbnail = vi.fn(async () => v13ThumbnailResult(thumb, { width: 1000, height: 800 }));
        scene.update = vi.fn(async () => undefined);

        const response = await routerFor().route(
          createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
        );

        expect(response.ok).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
        expect(response.error.message).toMatch(/preUpdateScene|refused/i);
        expect(response.error.details).toMatchObject({
          sceneId: "scene-1",
          persisted: false,
          sizeBytes: 600
        });
        expect(scene.update).toHaveBeenCalledTimes(1);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it("reports a veto on a scene that ALREADY carried a thumb (stale path never reported as fresh)", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const scene = globalThis.game.scenes.get("scene-1");
        const priorPath = "worlds/test-world/assets/scenes/scene-1-thumb.webp";
        const baseToObject = scene.toObject.bind(scene);
        scene.toObject = () => ({ ...baseToObject(), thumb: priorPath });
        scene.createThumbnail = vi.fn(async () =>
          v13ThumbnailResult(makeThumbDataUrl(600), { width: 1000, height: 800 })
        );
        scene.update = vi.fn(async () => undefined);

        const response = await routerFor().route(
          createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
        );

        expect(response.ok).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
        expect(response.error.message).toMatch(/preUpdateScene|refused/i);
        expect(response.error.details).toMatchObject({ sceneId: "scene-1", persisted: false });

        expect(JSON.stringify(response)).not.toContain(priorPath);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it("reports a resolved write that stored no thumb (persistence signal 2 on its own)", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const scene = globalThis.game.scenes.get("scene-1");
        const baseToObject = scene.toObject.bind(scene);
        scene.toObject = () => ({ ...baseToObject(), thumb: null });
        scene.createThumbnail = vi.fn(async () =>
          v13ThumbnailResult(makeThumbDataUrl(600), { width: 1000, height: 800 })
        );

        scene.update = vi.fn(async () => scene);

        const response = await routerFor().route(
          createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
        );

        expect(response.ok).toBe(false);
        expect(response.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);

        expect(response.error.message).toMatch(/carries no stored `thumb` afterwards/);
        expect(response.error.details).toMatchObject({
          sceneId: "scene-1",
          persisted: false,
          sizeBytes: 600,
          requested: { width: 300, height: 100 }
        });
        expect(scene.update).toHaveBeenCalledTimes(1);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it("dry-run returns the same shape without rendering or persisting", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn(async () =>
        v13ThumbnailResult(makeThumbDataUrl(100), { width: 10, height: 10 })
      );

      const response = await routerFor().route(
        createRequest("scene.thumbnail.generate", {
          sceneId: "scene-1",
          width: 512,
          height: 512,
          dryRun: true
        })
      );

      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result.thumbnail).toEqual({
        thumb: null,

        storedPath: null,
        sizeBytes: null,
        outputWidth: 512,
        outputHeight: 512,
        sourceWidth: null,
        sourceHeight: null,
        persisted: false
      });

      expect(Object.keys(response.result.thumbnail).sort()).toEqual([
        "outputHeight",
        "outputWidth",
        "persisted",
        "sizeBytes",
        "sourceHeight",
        "sourceWidth",
        "storedPath",
        "thumb"
      ]);
      expect(scene.createThumbnail).not.toHaveBeenCalled();
      expect(scene.update).not.toHaveBeenCalled();
    });

    it("pins the real success body and the dry-run body to the SAME key set", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn(async () =>
        v13ThumbnailResult(makeThumbDataUrl(200), { width: 40, height: 40 })
      );
      installServerFilePathModel(scene);

      const real = await routerFor().route(createRequest("scene.thumbnail.generate", { sceneId: "scene-1" }));
      const dry = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1", dryRun: true })
      );

      expect(real.ok).toBe(true);
      expect(dry.ok).toBe(true);
      expect(Object.keys(real.result).sort()).toEqual(["sceneId", "thumbnail"]);

      expect(Object.keys(dry.result).sort()).toEqual(["dryRun", "sceneId", "thumbnail"]);
      expect(Object.keys(dry.result.thumbnail).sort()).toEqual(Object.keys(real.result.thumbnail).sort());
      expect(Object.keys(real.result.thumbnail).sort()).toEqual([
        "outputHeight",
        "outputWidth",
        "persisted",
        "sizeBytes",
        "sourceHeight",
        "sourceWidth",
        "storedPath",
        "thumb"
      ]);
    });

    it("rejects an over-cap thumbnail BEFORE persisting (thumbnail-bytes cap, always enforced)", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      const scene = globalThis.game.scenes.get("scene-1");

      scene.createThumbnail = vi.fn(async () =>
        v13ThumbnailResult(makeThumbDataUrl(3 * 1024 * 1024), { width: 4000, height: 3000 })
      );

      const response = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1", width: 1024, height: 1024 })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("PAYLOAD_TOO_LARGE");
      expect(response.error.details.limit).toBe("thumbnail-bytes");
      expect(response.error.details.persisted).toBe(false);
      expect(response.error.details.requested).toEqual({ width: 1024, height: 1024 });
      expect(scene.update).not.toHaveBeenCalled();
    });

    it("rejects an over-cap includeThumb echo BEFORE persisting (response-bytes cap)", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      const scene = globalThis.game.scenes.get("scene-1");

      scene.createThumbnail = vi.fn(async () =>
        v13ThumbnailResult(makeThumbDataUrl(Math.floor(1.5 * 1024 * 1024)), { width: 4000, height: 3000 })
      );

      const response = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1", includeThumb: true })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("PAYLOAD_TOO_LARGE");
      expect(response.error.details.limit).toBe("response-bytes");
      expect(response.error.details.persisted).toBe(false);
      expect(scene.update).not.toHaveBeenCalled();
    });

    it("persists a thumb that is under the persistence cap even when the echo cap would trip", async () => {
      globalThis.game.release = { version: "13.351", generation: 13 };
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn(async () =>
        v13ThumbnailResult(makeThumbDataUrl(Math.floor(1.5 * 1024 * 1024)), { width: 4000, height: 3000 })
      );
      installServerFilePathModel(scene);

      const response = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
      );

      expect(response.ok).toBe(true);
      expect(response.result.thumbnail.persisted).toBe(true);
      expect(response.result.thumbnail.storedPath).toBe("worlds/test-world/assets/scenes/scene-1-thumb.webp");
      expect(scene.update).toHaveBeenCalled();
    });

    it("returns THUMBNAIL_UPLOAD_DENIED from the pre-check, under dry-run too", async () => {
      globalThis.game.user.can = vi.fn((permission) => permission !== "FILES_UPLOAD");
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn(async () =>
        v13ThumbnailResult(makeThumbDataUrl(10), { width: 10, height: 10 })
      );

      const real = await routerFor().route(createRequest("scene.thumbnail.generate", { sceneId: "scene-1" }));
      const dry = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1", dryRun: true })
      );

      expect(real.ok).toBe(false);
      expect(real.error.code).toBe("THUMBNAIL_UPLOAD_DENIED");
      expect(real.error.details.permission).toBe("FILES_UPLOAD");
      expect(dry.ok).toBe(false);
      expect(dry.error.code).toBe("THUMBNAIL_UPLOAD_DENIED");
      expect(scene.createThumbnail).not.toHaveBeenCalled();
    });

    it("maps Foundry's upload-denied throw by its cause flag, not its message", async () => {
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn(async () => {
        throw new Error("Загрузка файлов запрещена", { cause: { thumbUploadDenied: true } });
      });

      const response = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("THUMBNAIL_UPLOAD_DENIED");
      expect(scene.update).not.toHaveBeenCalled();
    });

    it("returns UNSUPPORTED_OPERATION when the core noCanvas setting is enabled (dry-run too)", async () => {
      globalThis.game.settings.get = vi.fn((namespace, key) => namespace === "core" && key === "noCanvas");
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn();

      const real = await routerFor().route(createRequest("scene.thumbnail.generate", { sceneId: "scene-1" }));
      const dry = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1", dryRun: true })
      );

      expect(real.ok).toBe(false);
      expect(real.error.code).toBe("UNSUPPORTED_OPERATION");
      expect(real.error.details.setting).toBe("core.noCanvas");
      expect(dry.ok).toBe(false);
      expect(dry.error.code).toBe("UNSUPPORTED_OPERATION");
      expect(scene.createThumbnail).not.toHaveBeenCalled();
    });

    it("maps a render/composite failure to THUMBNAIL_RENDER_FAILED", async () => {
      const scene = globalThis.game.scenes.get("scene-1");

      scene.createThumbnail = vi.fn(async () => {
        throw new Error("Unable to compose texture because there is no game canvas");
      });

      const response = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("THUMBNAIL_RENDER_FAILED");
      expect(response.error.details.message).toContain("no game canvas");
      expect(scene.update).not.toHaveBeenCalled();
    });

    it("maps a resolved-but-empty createThumbnail to THUMBNAIL_RENDER_FAILED", async () => {
      const scene = globalThis.game.scenes.get("scene-1");
      scene.createThumbnail = vi.fn(async () => ({ thumb: null, width: 10, height: 10 }));

      const response = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1" })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("THUMBNAIL_RENDER_FAILED");
      expect(scene.update).not.toHaveBeenCalled();
    });

    it("returns SCENE_NOT_FOUND for an unknown scene id", async () => {
      const response = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "nope" })
      );

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("SCENE_NOT_FOUND");
    });

    it("reports BRIDGE_NOT_READY on BOTH paths when Scene#createThumbnail is absent (dry-run too)", async () => {
      const scene = globalThis.game.scenes.get("scene-1");
      expect(scene.createThumbnail).toBeUndefined();

      const real = await routerFor().route(createRequest("scene.thumbnail.generate", { sceneId: "scene-1" }));
      const dry = await routerFor().route(
        createRequest("scene.thumbnail.generate", { sceneId: "scene-1", dryRun: true })
      );

      expect(real.ok).toBe(false);
      expect(real.error.code).toBe("BRIDGE_NOT_READY");
      expect(dry.ok).toBe(false);
      expect(dry.error.code).toBe("BRIDGE_NOT_READY");
      expect(scene.update).not.toHaveBeenCalled();
    });

    it("resets fog on the viewed scene and confirms by snapshot-id absence", async () => {
      const { get, reset } = installFogGlobals({ ids: [["fog-1", "fog-2"], ["fog-new"]] });

      vi.useFakeTimers();
      let response;
      try {
        const pending = routerFor().route(createRequest("scene.fog.reset", { sceneId: "scene-1" }));
        await vi.advanceTimersByTimeAsync(300);
        response = await pending;
      } finally {
        vi.useRealTimers();
      }

      expect(response.ok).toBe(true);
      expect(response.result).toEqual({
        sceneId: "scene-1",
        reset: true,
        clearedCount: 2,

        confirmation: "observed",
        viewedSceneId: "scene-1"
      });
      expect(reset).toHaveBeenCalledTimes(1);

      expect(get.mock.calls[0][1]).toEqual({
        query: { scene: "scene-1" },
        index: true,
        indexFields: ["_id"]
      });
    });

    it("returns ok WITHOUT claiming observation when the scene has no fog exploration documents", async () => {
      const { get, reset } = installFogGlobals({ ids: [] });

      const response = await routerFor().route(createRequest("scene.fog.reset", { sceneId: "scene-1" }));

      expect(response.ok).toBe(true);

      expect(response.result).toEqual({
        sceneId: "scene-1",
        reset: true,
        clearedCount: 0,
        confirmation: "nothing-to-observe",
        viewedSceneId: "scene-1"
      });
      expect(response.result.confirmation).not.toBe("observed");
      expect(reset).toHaveBeenCalledTimes(1);

      expect(get).toHaveBeenCalledTimes(1);
    });

    it("dry-run reports the count for a NON-viewed scene without resetting", async () => {
      const { reset } = installFogGlobals({ viewedSceneId: "scene-2", ids: ["fog-1", "fog-2", "fog-3"] });

      const response = await routerFor().route(
        createRequest("scene.fog.reset", { sceneId: "scene-1", dryRun: true })
      );

      expect(response.ok).toBe(true);
      expect(response.result).toEqual({
        sceneId: "scene-1",
        reset: false,
        clearedCount: 3,

        confirmation: "not-dispatched",
        viewedSceneId: "scene-2",
        dryRun: true,
        approvalRequired: true
      });
      expect(reset).not.toHaveBeenCalled();
    });

    it("refuses a real reset of a NON-viewed scene with prescriptive SCENE_NOT_VIEWED", async () => {
      const { reset } = installFogGlobals({ viewedSceneId: "scene-2", ids: ["fog-1"] });

      const response = await routerFor().route(createRequest("scene.fog.reset", { sceneId: "scene-1" }));

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("SCENE_NOT_VIEWED");
      expect(response.error.message).toContain("view the scene in the GM client first");
      expect(response.error.details).toEqual({ sceneId: "scene-1", viewedSceneId: "scene-2" });
      expect(reset).not.toHaveBeenCalled();
    });

    it("refuses a real reset when no scene is viewed at all", async () => {
      installFogGlobals({ viewedSceneId: null, ids: [] });

      const response = await routerFor().route(createRequest("scene.fog.reset", { sceneId: "scene-1" }));

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("SCENE_NOT_VIEWED");
      expect(response.error.details.viewedSceneId).toBeNull();
    });

    it("capability-gates the core noCanvas SETTING with UNSUPPORTED_OPERATION, under dry-run too", async () => {
      globalThis.game.settings.get = vi.fn((namespace, key) => namespace === "core" && key === "noCanvas");
      const { get, reset } = installFogGlobals({ ids: ["fog-1"] });

      const real = await routerFor().route(createRequest("scene.fog.reset", { sceneId: "scene-1" }));
      const dry = await routerFor().route(
        createRequest("scene.fog.reset", { sceneId: "scene-1", dryRun: true })
      );

      expect(real.ok).toBe(false);
      expect(real.error.code).toBe("UNSUPPORTED_OPERATION");
      expect(real.error.details).toEqual({ family: "scene.fog", setting: "core.noCanvas" });
      expect(dry.ok).toBe(false);
      expect(dry.error.code).toBe("UNSUPPORTED_OPERATION");

      expect(get).not.toHaveBeenCalled();
      expect(reset).not.toHaveBeenCalled();
    });

    it("still counts under dry-run when no scene was ever drawn (no canvas.fog, noCanvas OFF)", async () => {
      globalThis.CONFIG = {
        FogExploration: { documentClass: { database: { get: vi.fn(async () => [{ _id: "f1" }]) } } }
      };
      globalThis.canvas = { scene: null };

      const dry = await routerFor().route(
        createRequest("scene.fog.reset", { sceneId: "scene-1", dryRun: true })
      );
      const real = await routerFor().route(createRequest("scene.fog.reset", { sceneId: "scene-1" }));

      expect(dry.ok).toBe(true);
      expect(dry.result).toEqual({
        sceneId: "scene-1",
        reset: false,
        clearedCount: 1,
        confirmation: "not-dispatched",
        viewedSceneId: null,
        dryRun: true,
        approvalRequired: true
      });

      expect(real.ok).toBe(false);
      expect(real.error.code).toBe("SCENE_NOT_VIEWED");
      expect(real.error.message).toContain("view the scene in the GM client first");
      expect(real.error.message).not.toContain("noCanvas");
    });

    it("reports retryable BRIDGE_NOT_READY when the VIEWED scene has no fog manager yet", async () => {
      globalThis.CONFIG = { FogExploration: { documentClass: { database: { get: vi.fn(async () => []) } } } };
      globalThis.canvas = { scene: { id: "scene-1" } };

      const response = await routerFor().route(createRequest("scene.fog.reset", { sceneId: "scene-1" }));

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("BRIDGE_NOT_READY");
      expect(response.error.details.family).toBe("scene.fog");
      expect(response.error.message).toContain("still drawing");
    });

    it("reports BRIDGE_NOT_READY when the FogExploration database API is absent", async () => {
      globalThis.CONFIG = {};
      globalThis.canvas = { scene: { id: "scene-1" }, fog: { reset: vi.fn(async () => {}) } };

      const response = await routerFor().route(createRequest("scene.fog.reset", { sceneId: "scene-1" }));

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("BRIDGE_NOT_READY");
    });

    it("returns FOG_RESET_UNCONFIRMED when the snapshotted ids never disappear", async () => {
      const { get, reset } = installFogGlobals({ ids: ["fog-1"] });
      vi.useFakeTimers();
      try {
        const pending = routerFor().route(createRequest("scene.fog.reset", { sceneId: "scene-1" }));
        await vi.advanceTimersByTimeAsync(6_000);
        const response = await pending;

        expect(response.ok).toBe(false);
        expect(response.error.code).toBe("FOG_RESET_UNCONFIRMED");
        expect(response.error.details.timeoutMs).toBe(5_000);
        expect(response.error.details.snapshotCount).toBe(1);
        expect(response.error.details.queryError).toBeNull();
        expect(response.error.details.remaining).toEqual({
          count: 1,
          ids: ["fog-1"],
          truncated: false,

          observed: true
        });

        expect(reset).toHaveBeenCalledTimes(1);
        expect(get.mock.calls.length).toBeGreaterThan(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("converts a failing confirmation query into FOG_RESET_UNCONFIRMED, never a raw bridge error", async () => {
      const { get, reset } = installFogGlobals({ ids: ["fog-1", "fog-2"] });
      let calls = 0;
      get.mockImplementation(async () => {
        calls += 1;
        if (calls === 1) return [{ _id: "fog-1" }, { _id: "fog-2" }];
        throw new Error("socket disconnected");
      });
      vi.useFakeTimers();
      try {
        const pending = routerFor().route(createRequest("scene.fog.reset", { sceneId: "scene-1" }));
        await vi.advanceTimersByTimeAsync(6_000);
        const response = await pending;

        expect(response.ok).toBe(false);
        expect(response.error.code).toBe("FOG_RESET_UNCONFIRMED");
        expect(response.error.message).toContain("could not be observed at all");
        expect(response.error.details.queryError).toBe("socket disconnected");

        expect(response.error.details.remaining).toEqual({
          count: 2,
          ids: ["fog-1", "fog-2"],
          truncated: false,
          observed: false
        });
        expect(reset).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("returns FOG_RESET_UNCONFIRMED when a confirmation query NEVER settles", async () => {
      const { get, reset } = installFogGlobals({ ids: ["fog-1", "fog-2"] });
      let calls = 0;
      get.mockImplementation(async () => {
        calls += 1;
        if (calls === 1) return [{ _id: "fog-1" }, { _id: "fog-2" }];
        return new Promise(() => {});
      });
      vi.useFakeTimers();
      try {
        const pending = routerFor().route(createRequest("scene.fog.reset", { sceneId: "scene-1" }));

        const marker = { hung: true };
        const settled = Promise.race([
          pending,
          new Promise((resolve) => setTimeout(() => resolve(marker), 60_000))
        ]);
        await vi.advanceTimersByTimeAsync(60_000);
        /** @type {any} */
        const response = await settled;

        expect(response.hung).toBeUndefined();
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe("FOG_RESET_UNCONFIRMED");

        expect(response.error.details.timeoutMs).toBe(5_000);
        expect(response.error.details.elapsedMs).toBeLessThanOrEqual(5_000);

        expect(response.error.message).toContain("could not be observed at all");
        expect(response.error.details.queryError).toContain("no response within the remaining");
        expect(response.error.details.remaining).toEqual({
          count: 2,
          ids: ["fog-1", "fog-2"],
          truncated: false,
          observed: false
        });

        expect(reset).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("distinguishes an observed remainder whose later confirmation queries failed", async () => {
      const { get, reset } = installFogGlobals({ ids: ["fog-1", "fog-2"] });
      let calls = 0;
      get.mockImplementation(async () => {
        calls += 1;
        if (calls <= 2) return [{ _id: "fog-1" }, { _id: "fog-2" }];
        throw new Error("socket disconnected");
      });
      vi.useFakeTimers();
      try {
        const pending = routerFor().route(createRequest("scene.fog.reset", { sceneId: "scene-1" }));
        await vi.advanceTimersByTimeAsync(6_000);
        const response = await pending;

        expect(response.ok).toBe(false);
        expect(response.error.code).toBe("FOG_RESET_UNCONFIRMED");
        expect(response.error.message).toContain("still present at the last SUCCESSFUL check");
        expect(response.error.message).toContain("every later confirmation query failed");
        expect(response.error.message).not.toContain("could not be observed at all");
        expect(response.error.details.queryError).toBe("socket disconnected");

        expect(response.error.details.remaining).toEqual({
          count: 2,
          ids: ["fog-1", "fog-2"],
          truncated: false,
          observed: true
        });
        expect(reset).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("reports a dispatch failure as NOT sent, without running a confirmation poll", async () => {
      const { get, reset } = installFogGlobals({
        ids: ["fog-1"],
        reset: vi.fn(async () => {
          throw new Error("socket unavailable");
        })
      });

      const response = await routerFor().route(createRequest("scene.fog.reset", { sceneId: "scene-1" }));

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INTERNAL_ERROR");
      expect(response.error.message).toContain("was NOT sent");
      expect(response.error.details).toEqual({
        sceneId: "scene-1",
        dispatched: false,
        message: "socket unavailable"
      });
      expect(reset).toHaveBeenCalledTimes(1);

      expect(get).toHaveBeenCalledTimes(1);
    });

    it("retries a transient confirmation-query failure and still confirms within the window", async () => {
      const { get, reset } = installFogGlobals({ ids: ["fog-1"] });
      let calls = 0;
      get.mockImplementation(async () => {
        calls += 1;
        if (calls === 1) return [{ _id: "fog-1" }];
        if (calls === 2) throw new Error("socket blip");
        return [];
      });
      vi.useFakeTimers();
      try {
        const pending = routerFor().route(createRequest("scene.fog.reset", { sceneId: "scene-1" }));
        await vi.advanceTimersByTimeAsync(1_000);
        const response = await pending;

        expect(response.ok).toBe(true);
        expect(response.result).toEqual({
          sceneId: "scene-1",
          reset: true,
          clearedCount: 1,

          confirmation: "observed",
          viewedSceneId: "scene-1"
        });
        expect(reset).toHaveBeenCalledTimes(1);
        expect(calls).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("returns SCENE_NOT_FOUND before touching the canvas", async () => {
      const { reset } = installFogGlobals({ ids: ["fog-1"] });

      const response = await routerFor().route(createRequest("scene.fog.reset", { sceneId: "nope" }));

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("SCENE_NOT_FOUND");
      expect(reset).not.toHaveBeenCalled();
    });
  });

  it("returns a stable not-found error for missing scenes", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(createRequest("scene.get", { sceneId: "missing-scene" }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("SCENE_NOT_FOUND");

    expect(response.error.message).toContain("missing-scene");
    expect(response.error.message).toContain("scene.list");
  });

  it("creates scenes via Foundry document APIs", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.create", { data: { name: "New Scene", width: 1000, height: 800 } })
    );

    expect(response.ok).toBe(true);
    expect(globalThis.Scene.create).toHaveBeenCalledWith(
      { name: "New Scene", width: 1000, height: 800 },
      { render: true }
    );
    expect(response.result.scene.id).toBe("scene-created");
    expect(response.result.scene.name).toBe("New Scene");
  });

  it("clones scenes with an optional patch", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("scene.clone", { sceneId: "scene-1", patch: { name: "Dungeon Copy" } })
    );

    expect(response.ok).toBe(true);
    expect(response.result.scene.id).toBe("scene-1-clone");
    expect(response.result.scene.name).toBe("Dungeon Copy");
  });

  it("refuses to delete the active scene without force", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(createRequest("scene.delete", { sceneId: "scene-1" }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("DELETE_FORBIDDEN");

    expect(response.error.message).toContain("force:true");
  });

  it("deletes the active scene when force is set", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(createRequest("scene.delete", { sceneId: "scene-1", force: true }));

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({ id: "scene-1", deleted: true, wasActive: true });
  });

  it("deletes a non-active scene without force", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(createRequest("scene.delete", { sceneId: "scene-2" }));

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({ id: "scene-2", deleted: true, wasActive: false });
  });

  it("clones the active scene as inactive", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(createRequest("scene.clone", { sceneId: "scene-1" }));

    expect(response.ok).toBe(true);
    expect(response.result.scene.active).toBe(false);
  });

  it("scene.get exposes embedded-collection counts for all v13/v14 placeable collections", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const getResponse = await router.route(createRequest("scene.get", { sceneId: "scene-1" }));
    expect(getResponse.ok).toBe(true);
    const { counts } = getResponse.result.scene;

    expect(counts).toEqual({
      tokens: 2,
      tiles: 1,
      sounds: 1,
      walls: 3,
      notes: 2,
      drawings: 2,
      lights: 1,
      templates: 2,
      levels: 0,
      regions: 2
    });

    expect(getResponse.result.scene).toHaveProperty("flags");
    expect(typeof getResponse.result.scene.flags).toBe("object");

    const listResponse = await router.route(createRequest("scene.list", {}));
    expect(listResponse.ok).toBe(true);
    expect(listResponse.result.scenes.length).toBeGreaterThan(0);
    for (const row of listResponse.result.scenes) {
      expect(row).not.toHaveProperty("counts");
      expect(row).not.toHaveProperty("flags");
    }
  });
});
