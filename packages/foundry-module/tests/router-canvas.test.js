import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";
import { RENDERED_IMAGE_MAX_BYTES } from "../scripts/generated/protocol.js";
import { createPermissiveSettings, createRequest, installFakeFoundry } from "./helpers/fake-foundry.js";

const globals = /** @type {any} */ (globalThis);

const routerFor = () => createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

/** @param {number} bytes */
function base64DataUrl(bytes, mimeType = "image/webp") {
  return `data:${mimeType};base64,${"A".repeat(Math.ceil(bytes / 3) * 4)}`;
}

/**
 * A 2D context that records every drawing call with its arguments.
 * @param {{ width: number, height: number }} element
 */
function createRecordingContext(element) {
  /** @type {{ name: string, args: unknown[] }[]} */
  const calls = [];
  const context = new Proxy(
    { canvas: element },
    {
      get(target, property) {
        if (property in target) return target[property];
        return (...args) => {
          const call = { name: String(property), args };
          Object.defineProperty(call, "strokeStyle", { value: /** @type {any} */ (target).strokeStyle });
          calls.push(call);
        };
      },
      set(target, property, value) {
        target[property] = value;
        return true;
      }
    }
  );
  return { context, calls };
}

/**
 * @returns {{ canvases: any[], encoded: { value: string }, bitmaps: { close: import("vitest").Mock }[] }}
 */
function installImagePipeline() {
  /** @type {any[]} */
  const canvases = [];
  const encoded = { value: base64DataUrl(3000) };
  globals.document = {
    createElement: vi.fn((tag) => {
      expect(tag).toBe("canvas");
      const element = {
        width: 0,
        height: 0,
        toDataURL: vi.fn((type) => encoded.value.replace("image/webp", type))
      };
      const { context, calls } = createRecordingContext(element);
      element.getContext = () => context;
      element.calls = calls;
      canvases.push(element);
      return element;
    })
  };
  /** @type {{ close: import("vitest").Mock }[]} */
  const bitmaps = [];
  globals.createImageBitmap = vi.fn(async () => {
    const element = canvases[canvases.length - 1];
    const bitmap = { width: element?.width ?? 2, height: element?.height ?? 2, close: vi.fn() };
    bitmaps.push(bitmap);
    return bitmap;
  });
  return { canvases, encoded, bitmaps };
}

/** @param {any} scene */
function prepareSnapshotScene(scene) {
  scene.dimensions = { sceneRect: { x: 500, y: 300, width: 4000, height: 3000 }, distancePixels: 20 };
  scene.backgroundColor = { css: "#202020" };
  scene.createThumbnail = vi.fn(async ({ width, height }) => ({
    thumb: base64DataUrl(1200, "image/png"),
    width: 4000,
    height: 3000,
    requested: { width, height }
  }));
  scene.update = vi.fn();
  scene.grid = { isGridless: true, isHexagonal: false, size: 100, sizeX: 100, sizeY: 100 };
  for (const token of scene.tokens) {
    token.getSize = () => {
      const grid = scene.grid;
      let width = token.width ?? 1;
      let height = token.height ?? 1;
      if (grid.isHexagonal) {
        if (grid.columns) width = 0.75 * Math.floor(width) + 0.5 * (width % 1) + 0.25;
        else height = 0.75 * Math.floor(height) + 0.5 * (height % 1) + 0.25;
      }
      return { width: width * grid.sizeX, height: height * grid.sizeY };
    };
  }
  return scene;
}

/** @param {number} generation */
function setGeneration(generation) {
  globalThis.game.release = { version: `${generation}.0`, generation };
}

/** @param {boolean} noCanvas */
function setNoCanvas(noCanvas) {
  const permissive = createPermissiveSettings();
  globalThis.game.settings.get = vi.fn((namespace, key) =>
    namespace === "core" && key === "noCanvas" ? noCanvas : permissive.get(namespace, key)
  );
}

afterEach(() => {
  delete globals.document;
  delete globals.createImageBitmap;
  delete globals.canvas;
});

describe("scene.snapshot", () => {
  /** @type {ReturnType<typeof installImagePipeline>} */
  let pipeline;
  /** @type {any} */
  let scene;

  beforeEach(() => {
    installFakeFoundry();
    setGeneration(13);
    pipeline = installImagePipeline();
    scene = prepareSnapshotScene(globalThis.game.scenes.get("scene-1"));
  });

  it("renders at the scene's aspect ratio and maps scene coordinates onto the image", async () => {
    const response = await routerFor().route(createRequest("scene.snapshot", { sceneId: "scene-1" }));

    expect(response.ok).toBe(true);
    expect(scene.createThumbnail).toHaveBeenCalledWith({ width: 1024, height: 768, format: "image/png" });
    const { transform, view, image } = response.result;
    expect(transform.scale).toBeCloseTo(0.256);
    const toPixel = (/** @type {number} */ x, /** @type {number} */ y) => [
      x * transform.scale + transform.offsetX,
      y * transform.scale + transform.offsetY
    ];
    expect(toPixel(500, 300)[0]).toBeCloseTo(0);
    expect(toPixel(500, 300)[1]).toBeCloseTo(0);
    expect(toPixel(4500, 3300)[0]).toBeCloseTo(1024);
    expect(toPixel(4500, 3300)[1]).toBeCloseTo(768);
    expect(view.x).toBeCloseTo(500);
    expect(view.y).toBeCloseTo(300);
    expect(view.width).toBeCloseTo(4000);
    expect(view.height).toBeCloseTo(3000);
    expect(image).toMatchObject({ mimeType: "image/webp", width: 1024, height: 768, sizeBytes: 3000 });
    expect(image.dataUrl.startsWith("data:image/webp;base64,")).toBe(true);
    expect(response.result.levelId).toBeNull();
    expect(response.result.partialRender).toBe(false);
    expect(scene.update).not.toHaveBeenCalled();
    expect(pipeline.bitmaps.map((bitmap) => bitmap.close.mock.calls.length)).toEqual([1]);
  });

  it("releases the decoded background when composing the image fails", async () => {
    globals.document.createElement = vi.fn(() => ({ getContext: () => null }));

    const response = await routerFor().route(createRequest("scene.snapshot", { sceneId: "scene-1" }));

    expect(response.error.code).toBe("BRIDGE_NOT_READY");
    expect(pipeline.bitmaps.map((bitmap) => bitmap.close.mock.calls.length)).toEqual([1]);
  });

  it("places a v13 render of less than the whole scene inside a frame of the whole scene", async () => {
    scene.createThumbnail = vi.fn(async () => ({ thumb: base64DataUrl(300), width: 2000, height: 3000 }));

    const response = await routerFor().route(createRequest("scene.snapshot", { sceneId: "scene-1" }));

    const { transform, view } = response.result;
    expect(response.result.partialRender).toBe(true);
    expect(transform.scale).toBeCloseTo(0.256);
    expect(transform.offsetX).toBeCloseTo(-500 * 0.256);
    expect(transform.offsetY).toBeCloseTo(-300 * 0.256);
    expect(view).toEqual({
      x: expect.closeTo(500),
      y: expect.closeTo(300),
      width: expect.closeTo(4000),
      height: expect.closeTo(3000)
    });

    const [, left, top, drawnWidth, drawnHeight] = pipeline.canvases[0].calls.find(
      (call) => call.name === "drawImage"
    ).args;
    expect([left, top, drawnWidth, drawnHeight]).toEqual([0, 192, 512, 384].map((n) => expect.closeTo(n)));
    expect(pipeline.canvases[0].calls[0]).toEqual({ name: "fillRect", args: [0, 0, 1024, 768] });
  });

  it("fits a portrait scene's long side to the requested size", async () => {
    scene.dimensions.sceneRect = { x: 0, y: 0, width: 1000, height: 2000 };
    scene.createThumbnail = vi.fn(async () => ({ thumb: base64DataUrl(300), width: 1000, height: 2000 }));

    const response = await routerFor().route(
      createRequest("scene.snapshot", { sceneId: "scene-1", size: 400, format: "png" })
    );

    expect(scene.createThumbnail).toHaveBeenCalledWith({ width: 200, height: 400, format: "image/png" });
    expect(response.result.image).toMatchObject({ width: 200, height: 400, mimeType: "image/png" });
    expect(response.result.transform.scale).toBeCloseTo(0.2);
  });

  it("draws the overlays from document data at the mapped coordinates", async () => {
    const response = await routerFor().route(createRequest("scene.snapshot", { sceneId: "scene-1" }));

    expect(response.result.layers).toEqual([
      "grid",
      "regions",
      "drawings",
      "templates",
      "walls",
      "lights",
      "sounds",
      "notes",
      "tokens"
    ]);
    const calls = pipeline.canvases[0].calls;
    const { scale, offsetX, offsetY } = response.result.transform;
    const moveTos = calls.filter((call) => call.name === "moveTo").map((call) => call.args);
    expect(moveTos).toContainEqual([0 * scale + offsetX, 0 * scale + offsetY]);
    const arcs = calls.filter((call) => call.name === "arc").map((call) => call.args);
    expect(arcs).toContainEqual([
      250 * scale + offsetX,
      250 * scale + offsetY,
      40 * 20 * scale,
      0,
      Math.PI * 2
    ]);
    const labels = calls.filter((call) => call.name === "fillText").map((call) => call.args[0]);
    expect(labels).toEqual(expect.arrayContaining(["Valeros Token", "Quest giver", "Danger zone"]));
  });

  it("draws a square grid as lines through the cell corners", async () => {
    scene.grid = {
      isGridless: false,
      isSquare: true,
      getOffsetRange: () => [3, 5, 5, 8],
      getTopLeftPoint: ({ i, j }) => ({ x: j * 100, y: i * 100 })
    };

    const response = await routerFor().route(
      createRequest("scene.snapshot", { sceneId: "scene-1", layers: ["grid"] })
    );

    const { scale, offsetX, offsetY } = response.result.transform;
    const moveTos = pipeline.canvases[0].calls
      .filter((call) => call.name === "moveTo")
      .map((call) => call.args);
    expect(moveTos).toEqual([
      ...[5, 6, 7, 8].map((j) => [j * 100 * scale + offsetX, 300 * scale + offsetY]),
      ...[3, 4, 5].map((i) => [500 * scale + offsetX, i * 100 * scale + offsetY])
    ]);
  });

  it("draws a hexagonal grid as one closed outline per cell", async () => {
    const getVertices = vi.fn(({ i, j }) =>
      Array.from({ length: 6 }, (_, k) => ({ x: j * 100 + 50 * Math.cos(k), y: i * 100 + 50 * Math.sin(k) }))
    );
    scene.grid = { isGridless: false, isSquare: false, getOffsetRange: () => [0, 0, 2, 3], getVertices };

    await routerFor().route(createRequest("scene.snapshot", { sceneId: "scene-1", layers: ["grid"] }));

    const calls = pipeline.canvases[0].calls;
    expect(getVertices).toHaveBeenCalledTimes(6);
    expect(calls.filter((call) => call.name === "closePath")).toHaveLength(6);
    expect(calls.filter((call) => call.name === "lineTo")).toHaveLength(6 * 5);
  });

  it.each([
    [true, 2, [1.75 * 100, 2 * 87]],
    [true, 3, [2.5 * 100, 3 * 87]],
    [false, 2, [2 * 87, 1.75 * 100]],
    [false, 3, [3 * 87, 2.5 * 100]]
  ])(
    "sizes a token box on a hex grid as Foundry does (columns %s, %i×%i)",
    async (columns, cells, expected) => {
      scene.grid = {
        isGridless: true,
        isHexagonal: true,
        columns,
        size: 100,
        sizeX: columns ? 100 : 87,
        sizeY: columns ? 87 : 100
      };
      const token = scene.tokens.get("token-a");
      token.width = cells;
      token.height = cells;

      const response = await routerFor().route(
        createRequest("scene.snapshot", { sceneId: "scene-1", layers: ["tokens"] })
      );

      const { scale, offsetX, offsetY } = response.result.transform;
      const boxes = pipeline.canvases[0].calls
        .filter((call) => call.name === "strokeRect")
        .map((call) => call.args);
      const [left, top, width, height] = boxes[0];
      expect(left).toBeCloseTo(token.x * scale + offsetX);
      expect(top).toBeCloseTo(token.y * scale + offsetY);
      expect(width).toBeCloseTo(expected[0] * scale);
      expect(height).toBeCloseTo(expected[1] * scale);
    }
  );

  it("draws a directional light as a cone facing its rotation", async () => {
    const light = scene.lights.get("light-torch");
    light.config = { dim: 40, bright: 20, angle: 90 };
    light.rotation = 0;

    const response = await routerFor().route(
      createRequest("scene.snapshot", { sceneId: "scene-1", layers: ["lights"] })
    );

    const { scale, offsetX, offsetY } = response.result.transform;
    const cones = pipeline.canvases[0].calls.filter((call) => call.name === "arc" && call.args[3] !== 0);
    expect(cones.map((call) => call.args)).toEqual([
      [250 * scale + offsetX, 250 * scale + offsetY, 40 * 20 * scale, Math.PI / 4, (3 * Math.PI) / 4],
      [250 * scale + offsetX, 250 * scale + offsetY, 20 * 20 * scale, Math.PI / 4, (3 * Math.PI) / 4]
    ]);
  });

  it("marks a wall that blocks sight but lets light through", async () => {
    scene.walls.get("wall-plain").sight = 20;
    scene.walls.get("wall-plain").light = 0;
    for (const id of ["wall-door", "wall-secret"]) scene.walls.get(id).light = 20;

    await routerFor().route(createRequest("scene.snapshot", { sceneId: "scene-1", layers: ["walls"] }));

    const strokes = pipeline.canvases[0].calls.filter((call) => call.name === "stroke");
    expect(strokes).toHaveLength(2 + 1 + 2 + 2);
  });

  it("marks a wall whose light restriction differs from its sight restriction, in either direction", async () => {
    const senses = { move: 20, sight: 0, light: 0, sound: 0 };
    Object.assign(scene.walls.get("wall-plain"), senses, { sight: 20 });
    Object.assign(scene.walls.get("wall-door"), senses, { door: 0, light: 20 });
    Object.assign(scene.walls.get("wall-secret"), senses, { door: 0 });

    await routerFor().route(createRequest("scene.snapshot", { sceneId: "scene-1", layers: ["walls"] }));

    const lightMarks = pipeline.canvases[0].calls
      .filter((call) => call.name === "stroke")
      .map((call) => /** @type {any} */ (call).strokeStyle)
      .filter((style) => style === "#ffe14a" || style === "#ff5fa2");
    expect(lightMarks).toEqual(["#ffe14a", "#ff5fa2"]);
  });

  it("marks sound where the wall color does not already tell it", async () => {
    const blocking = { move: 20, sight: 20, light: 20, sound: 20 };
    Object.assign(scene.walls.get("wall-plain"), blocking, { sound: 0 });
    Object.assign(scene.walls.get("wall-door"), blocking, { door: 0 });
    Object.assign(scene.walls.get("wall-secret"), blocking, { door: 1, ds: 0 });
    scene.walls.set({ id: "wall-ethereal", c: [0, 200, 100, 200], move: 0, sight: 0, light: 0, sound: 0 });

    const response = await routerFor().route(
      createRequest("scene.snapshot", { sceneId: "scene-1", layers: ["walls"] })
    );

    const { scale, offsetX, offsetY } = response.result.transform;
    const calls = pipeline.canvases[0].calls;
    const marks = calls
      .map((call, index) => ({ ...call, next: calls[index + 1]?.name }))
      .filter((call) => call.name === "arc");
    expect(marks.map((mark) => [mark.args[0], mark.args[1], mark.next])).toEqual([
      [expect.closeTo(25 * scale + offsetX), expect.closeTo(offsetY), "stroke"],
      [expect.closeTo(100 * scale + offsetX), expect.closeTo(25 * scale + offsetY), "fill"],
      [expect.closeTo(25 * scale + offsetX), expect.closeTo(200 * scale + offsetY), "stroke"]
    ]);
  });

  it.each([
    [0, false],
    [1, true]
  ])("closes a polygon drawing's outline only when it is filled (fillType %i)", async (fillType, closed) => {
    const drawing = Array.from(scene.drawings)[0];
    Object.assign(drawing, {
      x: 0,
      y: 0,
      rotation: 0,
      fillType,
      shape: { type: "p", width: 100, height: 100, points: [0, 0, 100, 0, 100, 100] }
    });

    await routerFor().route(createRequest("scene.snapshot", { sceneId: "scene-1", layers: ["drawings"] }));

    const calls = pipeline.canvases[0].calls.map((call) => call.name);
    const start = calls.indexOf("moveTo");
    const outline = calls.slice(start, calls.indexOf("stroke", start));
    expect(outline.filter((name) => name === "lineTo")).toHaveLength(2);
    expect(outline.includes("closePath")).toBe(closed);
  });

  it.each([
    ["round", "arc"],
    ["flat", "lineTo"]
  ])("draws a %s cone as the core cone template setting selects", async (coneType, edge) => {
    const permissive = createPermissiveSettings();
    globalThis.game.settings.get = vi.fn((namespace, key) =>
      namespace === "core" && key === "coneTemplateType" ? coneType : permissive.get(namespace, key)
    );
    const cone = scene.templates.get("template-cone");
    cone.direction = 0;
    cone.angle = 90;

    const response = await routerFor().route(
      createRequest("scene.snapshot", { sceneId: "scene-1", layers: ["templates"] })
    );

    const { scale, offsetX, offsetY } = response.result.transform;
    const calls = pipeline.canvases[0].calls;
    const start = calls.findIndex(
      (call) =>
        call.name === "moveTo" &&
        Math.abs(call.args[0] - (800 * scale + offsetX)) < 1e-6 &&
        Math.abs(call.args[1] - (300 * scale + offsetY)) < 1e-6
    );
    expect(calls[start + 1].name).toBe(edge);
    const length = 15 * 20 * scale;
    if (coneType === "flat") {
      const corner = length / Math.cos(Math.PI / 4);
      expect(calls[start + 1].args).toEqual([
        expect.closeTo(800 * scale + offsetX + Math.cos(-Math.PI / 4) * corner),
        expect.closeTo(300 * scale + offsetY + Math.sin(-Math.PI / 4) * corner)
      ]);
      expect(calls[start + 2].args).toEqual([
        expect.closeTo(800 * scale + offsetX + length),
        expect.closeTo(300 * scale + offsetY + length)
      ]);
    } else {
      expect(calls[start + 1].args[2]).toBeCloseTo(length);
    }
  });

  describe("token images", () => {
    /** @type {any[]} */
    let images;
    /** @type {(image: any) => Promise<void>} */
    let decode;

    beforeEach(() => {
      images = [];
      globals.Image = class {
        constructor() {
          this.src = "";
          images.push(this);
        }
        decode() {
          return decode(this);
        }
      };
    });

    afterEach(() => {
      delete globals.Image;
      vi.useRealTimers();
    });

    const snapshotTokens = () =>
      routerFor().route(
        createRequest("scene.snapshot", { sceneId: "scene-1", layers: ["tokens"], tokenImages: true })
      );
    const drawnImages = () =>
      pipeline.canvases[0].calls.filter((call) => call.name === "drawImage" && images.includes(call.args[0]));

    it("draws each token's decoded image inside its box", async () => {
      decode = async () => {};

      const response = await snapshotTokens();

      expect(response.ok).toBe(true);
      expect(images.map((image) => image.src)).toEqual(["tokens/valeros.webp"]);
      const { scale, offsetX, offsetY } = response.result.transform;
      expect(drawnImages().map((call) => call.args.slice(1))).toEqual([
        [100 * scale + offsetX, 120 * scale + offsetY, 100 * scale, 100 * scale]
      ]);
      expect(pipeline.canvases[0].calls.filter((call) => call.name === "strokeRect")).toHaveLength(2);
    });

    it("keeps the plain box for an image that fails to decode", async () => {
      decode = async () => {
        throw new Error("decode failed");
      };

      const response = await snapshotTokens();

      expect(response.ok).toBe(true);
      expect(drawnImages()).toEqual([]);
      expect(images[0].src).toBe("");
      expect(pipeline.canvases[0].calls.filter((call) => call.name === "strokeRect")).toHaveLength(2);
    });

    it("keeps the plain box for an image that does not load in time", async () => {
      vi.useFakeTimers();
      decode = () => new Promise(() => {});

      const pending = snapshotTokens();
      await vi.advanceTimersByTimeAsync(5_000);
      const response = await pending;

      expect(response.ok).toBe(true);
      expect(drawnImages()).toEqual([]);
      expect(images[0].src).toBe("");
    });
  });

  it("draws nothing over the rendered background when no layer is requested", async () => {
    const response = await routerFor().route(
      createRequest("scene.snapshot", { sceneId: "scene-1", layers: [] })
    );

    expect(response.result.layers).toEqual([]);
    expect(pipeline.canvases[0].calls.map((call) => call.name)).toEqual(["fillRect", "drawImage"]);
  });

  it("renders the initial level on v14 by default and leaves templates out", async () => {
    setGeneration(14);
    scene.initialLevel = scene.levels.get("level-ground");

    const response = await routerFor().route(createRequest("scene.snapshot", { sceneId: "scene-1" }));

    expect(response.ok).toBe(true);
    expect(response.result.levelId).toBe("level-ground");
    expect(response.result.layers).not.toContain("templates");
    expect(scene.createThumbnail).toHaveBeenCalledWith({
      width: 1024,
      height: 768,
      format: "image/png",
      level: "level-ground"
    });
  });

  it("renders a named level on v14 and refuses one the scene does not have", async () => {
    setGeneration(14);

    const named = await routerFor().route(
      createRequest("scene.snapshot", { sceneId: "scene-1", levelId: "level-upper" })
    );
    const missing = await routerFor().route(
      createRequest("scene.snapshot", { sceneId: "scene-1", levelId: "level-gone" })
    );

    expect(named.result.levelId).toBe("level-upper");
    expect(missing.ok).toBe(false);
    expect(missing.error.code).toBe("LEVEL_NOT_FOUND");
    expect(missing.error.details.levelIds).toEqual(["level-ground", "level-upper"]);
  });

  it("refuses a level on v13 and templates on v14 before rendering", async () => {
    const level = await routerFor().route(
      createRequest("scene.snapshot", { sceneId: "scene-1", levelId: "level-ground" })
    );
    setGeneration(14);
    delete scene.templates;
    scene.toObject = () => ({ _id: "scene-1" });
    const templates = await routerFor().route(
      createRequest("scene.snapshot", { sceneId: "scene-1", layers: ["templates"] })
    );

    expect(level.error.code).toBe("UNSUPPORTED_OPERATION");
    expect(templates.error.code).toBe("UNSUPPORTED_OPERATION");
    expect(scene.createThumbnail).not.toHaveBeenCalled();
  });

  it("refuses to render with the canvas disabled", async () => {
    setNoCanvas(true);

    const response = await routerFor().route(createRequest("scene.snapshot", { sceneId: "scene-1" }));

    expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
    expect(response.error.details.setting).toBe("core.noCanvas");
    expect(scene.createThumbnail).not.toHaveBeenCalled();
  });

  it("refuses an image above the rendered-image byte limit", async () => {
    pipeline.encoded.value = base64DataUrl(RENDERED_IMAGE_MAX_BYTES + 3);

    const response = await routerFor().route(createRequest("scene.snapshot", { sceneId: "scene-1" }));

    expect(response.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(response.error.details).toMatchObject({
      limit: "image-bytes",
      limitBytes: RENDERED_IMAGE_MAX_BYTES
    });
  });
});

/**
 * @param {{ sceneId?: string | null, level?: string | null, loading?: boolean }} [options]
 */
function installGmCanvas({ sceneId = "scene-1", level = null, loading = false } = {}) {
  const frame = { width: 3200, height: 1800 };
  const order = [];
  const board = {
    ready: sceneId !== null,
    loading,
    scene: sceneId ? { id: sceneId } : null,
    level: level ? { id: level } : undefined,
    screenDimensions: [1600, 900],
    dimensions: { sceneRect: { x: 500, y: 300, width: 4000, height: 3000 } },
    stage: { pivot: { x: 2000, y: 1500 }, scale: { x: 0.5 } },
    canvasCoordinatesFromClient: ({ x, y }) => ({
      x: board.stage.pivot.x + (x - 800) / board.stage.scale.x,
      y: board.stage.pivot.y + (y - 450) / board.stage.scale.x
    }),
    pan: vi.fn(({ x, y, scale }) => {
      if (Number.isFinite(x)) board.stage.pivot.x = x;
      if (Number.isFinite(y)) board.stage.pivot.y = y;
      if (Number.isFinite(scale)) board.stage.scale.x = Math.min(scale, 3);
    }),
    app: {
      stage: { stage: true },
      renderer: {
        render: vi.fn(() => order.push("render")),
        extract: {
          canvas: vi.fn(() => {
            order.push("extract");
            return frame;
          })
        }
      }
    }
  };
  globals.canvas = board;
  return { board, frame, order };
}

describe("canvas.capture", () => {
  /** @type {ReturnType<typeof installImagePipeline>} */
  let pipeline;

  beforeEach(() => {
    installFakeFoundry();
    pipeline = installImagePipeline();
  });

  it("reads the frame right after rendering it and maps the visible rectangle onto the image", async () => {
    const { order, frame } = installGmCanvas();

    const response = await routerFor().route(createRequest("canvas.capture", {}));

    expect(response.ok).toBe(true);
    expect(order).toEqual(["render", "extract"]);
    expect(pipeline.canvases[0].calls).toEqual([{ name: "drawImage", args: [frame, 0, 0, 1600, 900] }]);
    expect(response.result).toMatchObject({
      sceneId: "scene-1",
      levelId: null,
      position: { x: 2000, y: 1500, scale: 0.5 },
      view: { x: 400, y: 600, width: 3200, height: 1800 },
      transform: { scale: 0.5, offsetX: -200, offsetY: -300 }
    });
    expect(response.result.image).toMatchObject({ width: 1600, height: 900, mimeType: "image/webp" });
  });

  it("keeps a large screen's capture within the long-side limit by default", async () => {
    const { board } = installGmCanvas();
    board.screenDimensions = [3840, 2160];

    const response = await routerFor().route(createRequest("canvas.capture", {}));

    expect(response.result.image).toMatchObject({ width: 2048, height: 1152 });
  });

  it("scales the image to the requested long side", async () => {
    installGmCanvas();

    const response = await routerFor().route(createRequest("canvas.capture", { size: 800, format: "png" }));

    expect(response.result.image).toMatchObject({ width: 800, height: 450, mimeType: "image/png" });
    expect(response.result.transform).toEqual({ scale: 0.25, offsetX: -100, offsetY: -150 });
  });

  it("reports a GM client that views no scene, one still loading, and a disabled canvas", async () => {
    installGmCanvas({ sceneId: null });
    const none = await routerFor().route(createRequest("canvas.capture", {}));
    installGmCanvas({ loading: true });
    const loading = await routerFor().route(createRequest("canvas.capture", {}));
    installGmCanvas();
    setNoCanvas(true);
    const disabled = await routerFor().route(createRequest("canvas.capture", {}));

    expect(none.error.code).toBe("SCENE_NOT_VIEWED");
    expect(loading.error.code).toBe("BRIDGE_NOT_READY");
    expect(disabled.error.code).toBe("UNSUPPORTED_OPERATION");
  });
});

describe("canvas.pan", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  it("pans to a position and reports the one Foundry applied with the previous one", async () => {
    const { board } = installGmCanvas();

    const response = await routerFor().route(createRequest("canvas.pan", { x: 1000, y: 800, scale: 5 }));

    expect(board.pan).toHaveBeenCalledWith({ x: 1000, y: 800, scale: 5 });
    expect(response.result).toMatchObject({
      sceneId: "scene-1",
      previous: { x: 2000, y: 1500, scale: 0.5 },
      position: { x: 1000, y: 800, scale: 3 }
    });
  });

  it("fits the whole scene rectangle on screen", async () => {
    const { board } = installGmCanvas();

    await routerFor().route(createRequest("canvas.pan", { fit: true }));

    expect(board.pan).toHaveBeenCalledWith({ x: 2500, y: 1800, scale: 0.3 });
  });

  it("refuses fit together with a position before the policy gate and leaves the view alone", async () => {
    const { board } = installGmCanvas();
    const permissive = createPermissiveSettings();
    globalThis.game.settings.get = vi.fn((namespace, key) =>
      key === "commandPolicy" ? { version: 1, overrides: {} } : permissive.get(namespace, key)
    );
    const held = await routerFor().route(createRequest("canvas.pan", { fit: true }));

    const response = await routerFor().route(createRequest("canvas.pan", { fit: true, scale: 2 }));

    expect(held.error.code).toMatch(/^APPROVAL_/);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(board.pan).not.toHaveBeenCalled();
  });
});

describe("canvas.view-scene", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  it("switches the GM client to the scene and reports the one it left", async () => {
    const { board } = installGmCanvas({ sceneId: "scene-other" });
    const scene = globalThis.game.scenes.get("scene-1");
    scene.view = vi.fn(async () => {
      board.scene = { id: "scene-1" };
    });

    const response = await routerFor().route(createRequest("canvas.view-scene", { sceneId: "scene-1" }));

    expect(scene.view).toHaveBeenCalledWith();
    expect(response.result).toEqual({
      sceneId: "scene-1",
      levelId: null,
      previousSceneId: "scene-other",
      previousLevelId: null,
      changed: true
    });
  });

  it("leaves an already viewed scene alone", async () => {
    installGmCanvas();
    const scene = globalThis.game.scenes.get("scene-1");
    scene.view = vi.fn();

    const response = await routerFor().route(createRequest("canvas.view-scene", { sceneId: "scene-1" }));

    expect(scene.view).not.toHaveBeenCalled();
    expect(response.result.changed).toBe(false);
  });

  it("switches to a named level on v14", async () => {
    setGeneration(14);
    const { board } = installGmCanvas({ level: "level-ground" });
    const scene = globalThis.game.scenes.get("scene-1");
    scene.view = vi.fn(async ({ level }) => {
      board.level = { id: level };
    });

    const response = await routerFor().route(
      createRequest("canvas.view-scene", { sceneId: "scene-1", levelId: "level-upper" })
    );

    expect(scene.view).toHaveBeenCalledWith({ level: "level-upper" });
    expect(response.result).toMatchObject({
      levelId: "level-upper",
      previousLevelId: "level-ground",
      changed: true
    });
  });

  it("reports a switch Foundry skipped", async () => {
    installGmCanvas({ sceneId: "scene-other" });
    const scene = globalThis.game.scenes.get("scene-1");
    scene.view = vi.fn(async () => {});

    const response = await routerFor().route(createRequest("canvas.view-scene", { sceneId: "scene-1" }));

    expect(response.error.code).toBe("BRIDGE_NOT_READY");
    expect(response.error.details).toMatchObject({ sceneId: "scene-1", viewedSceneId: "scene-other" });
  });

  it("reports a switch whose canvas did not finish drawing", async () => {
    const { board } = installGmCanvas({ sceneId: "scene-other" });
    const scene = globalThis.game.scenes.get("scene-1");
    scene.view = vi.fn(async () => {
      board.scene = { id: "scene-1" };
      board.ready = false;
    });

    const response = await routerFor().route(createRequest("canvas.view-scene", { sceneId: "scene-1" }));

    expect(response.error.code).toBe("BRIDGE_NOT_READY");
    expect(response.error.details).toMatchObject({
      sceneId: "scene-1",
      viewedSceneId: "scene-1",
      ready: false
    });
  });

  it("reports an already selected scene whose canvas is not ready", async () => {
    const { board } = installGmCanvas();
    board.ready = false;
    const scene = globalThis.game.scenes.get("scene-1");
    scene.view = vi.fn();

    const response = await routerFor().route(createRequest("canvas.view-scene", { sceneId: "scene-1" }));

    expect(scene.view).not.toHaveBeenCalled();
    expect(response.error.code).toBe("BRIDGE_NOT_READY");
    expect(response.error.details).toMatchObject({ viewedSceneId: "scene-1", ready: false });
  });

  it("refuses a level on v13 before switching", async () => {
    setGeneration(13);
    installGmCanvas({ sceneId: "scene-other" });
    const scene = globalThis.game.scenes.get("scene-1");
    scene.view = vi.fn();

    const response = await routerFor().route(
      createRequest("canvas.view-scene", { sceneId: "scene-1", levelId: "level-ground" })
    );

    expect(response.error.code).toBe("UNSUPPORTED_OPERATION");
    expect(scene.view).not.toHaveBeenCalled();
  });
});
