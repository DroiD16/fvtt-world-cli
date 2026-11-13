const SENSE_NONE = 0;
const SENSE_LIMITED = 10;
const SENSE_PROXIMITY = 30;
const DOOR_NONE = 0;
const DOOR_SECRET = 2;
const DOOR_OPEN = 1;
const DOOR_LOCKED = 2;
const DIRECTION_LEFT = 1;
const DIRECTION_RIGHT = 2;

const WALL_COLORS = Object.freeze({
  normal: "#f2f2f2",
  ethereal: "#9a9a9a",
  invisible: "#36d6e7",
  terrain: "#c6e04a",
  proximity: "#ffa53a",
  door: "#4f7dff",
  secretDoor: "#b24bff",
  openDoor: "#3fdc4f",
  lockedDoor: "#ff3b3b"
});

/** @type {Readonly<Record<string, string>>} */
const DISPOSITION_COLORS = Object.freeze({ "-2": "#b24bff", "-1": "#ff4040", 0: "#ffd23f", 1: "#3fdc4f" });

const LIGHT_COLOR = "#ffd36b";
const DARKNESS_COLOR = "#a04bff";
const DISABLED_COLOR = "#8a8a8a";
const SOUND_COLOR = "#3fd1c4";
const REGION_COLOR = "#ff7f50";
const LIGHT_PASSES_COLOR = "#ffe14a";
const TOKEN_IMAGE_TIMEOUT_MS = 5_000;

/**
 * @typedef {{ scale: number, offsetX: number, offsetY: number }} SnapshotTransform
 * @typedef {{
 *   context: CanvasRenderingContext2D,
 *   scene: any,
 *   level: any,
 *   x: (value: number) => number,
 *   y: (value: number) => number,
 *   scale: number,
 *   unit: number,
 *   distancePixels: number
 * }} OverlayFrame
 */

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function cssColor(value, fallback) {
  const css = /** @type {any} */ (value)?.css;
  if (typeof css === "string" && css) return css;
  return typeof value === "string" && value ? value : fallback;
}

/** @param {number} degrees */
function radians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * @param {any} collection
 * @param {any} level
 * @returns {any[]}
 */
function documentsOnLevel(collection, level) {
  const documents = Array.from(collection ?? []);
  if (!level) return documents;
  return documents.filter(
    (document) => typeof document.includedInLevel !== "function" || document.includedInLevel(level.id)
  );
}

/**
 * @param {OverlayFrame} frame
 * @param {string} text
 * @param {number} x
 * @param {number} y
 */
function drawLabel({ context, unit }, text, x, y) {
  if (!text) return;
  context.save();
  context.setLineDash([]);
  context.font = `${Math.round(12 * unit)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.lineJoin = "round";
  context.lineWidth = 3 * unit;
  context.strokeStyle = "rgba(0, 0, 0, 0.85)";
  context.strokeText(text, x, y);
  context.fillStyle = "#ffffff";
  context.fillText(text, x, y);
  context.restore();
}

/**
 * @param {OverlayFrame} frame
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {string} color
 */
function drawMarker({ context, unit }, cx, cy, radius, color) {
  context.setLineDash([]);
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.lineWidth = unit;
  context.strokeStyle = "#000000";
  context.stroke();
}

/** @param {OverlayFrame} frame */
function drawGrid(frame) {
  const { context, scene, x, y, unit } = frame;
  const grid = scene.grid;
  if (!grid || grid.isGridless || typeof grid.getOffsetRange !== "function") return;
  const rect = scene.dimensions.sceneRect;
  const [i0, j0, i1, j1] = grid.getOffsetRange(rect);

  context.save();
  context.setLineDash([]);
  context.lineWidth = Math.max(0.5, 0.75 * unit);
  context.strokeStyle = "rgba(255, 255, 255, 0.45)";
  context.beginPath();
  if (grid.isSquare) {
    for (let j = j0; j <= j1; j += 1) {
      const left = grid.getTopLeftPoint({ i: i0, j }).x;
      context.moveTo(x(left), y(rect.y));
      context.lineTo(x(left), y(rect.y + rect.height));
    }
    for (let i = i0; i <= i1; i += 1) {
      const top = grid.getTopLeftPoint({ i, j: j0 }).y;
      context.moveTo(x(rect.x), y(top));
      context.lineTo(x(rect.x + rect.width), y(top));
    }
  } else {
    for (let i = i0; i < i1; i += 1) {
      for (let j = j0; j < j1; j += 1) {
        const vertices = grid.getVertices({ i, j });
        vertices.forEach((/** @type {{ x: number, y: number }} */ vertex, /** @type {number} */ index) =>
          index === 0 ? context.moveTo(x(vertex.x), y(vertex.y)) : context.lineTo(x(vertex.x), y(vertex.y))
        );
        context.closePath();
      }
    }
  }
  context.stroke();
  context.restore();
}

/** @param {OverlayFrame} frame */
function drawRegions(frame) {
  const { context, scene, level, x, y, unit } = frame;
  for (const region of documentsOnLevel(scene.regions, level)) {
    let polygons;
    try {
      polygons = Array.from(region.polygons ?? []);
    } catch {
      continue;
    }
    if (polygons.length === 0) continue;
    const color = cssColor(region.color, REGION_COLOR);
    let top = Infinity;
    let left = Infinity;
    let right = -Infinity;

    context.save();
    context.setLineDash([]);
    context.beginPath();
    for (const polygon of polygons) {
      const points = polygon.points ?? [];
      for (let index = 0; index + 1 < points.length; index += 2) {
        const px = x(points[index]);
        const py = y(points[index + 1]);
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
        top = Math.min(top, py);
        left = Math.min(left, px);
        right = Math.max(right, px);
      }
      context.closePath();
    }
    context.globalAlpha = 0.18;
    context.fillStyle = color;
    context.fill("evenodd");
    context.globalAlpha = 1;
    context.lineWidth = 2 * unit;
    context.strokeStyle = color;
    context.stroke();
    context.restore();
    drawLabel(frame, region.name ?? "", (left + right) / 2, top + 2 * unit);
  }
}

/** @param {OverlayFrame} frame */
function drawDrawings(frame) {
  const { context, scene, level, x, y, scale, unit } = frame;
  for (const drawing of documentsOnLevel(scene.drawings, level)) {
    const shape = drawing.shape ?? {};
    const width = Number(shape.width) || 0;
    const height = Number(shape.height) || 0;
    const points = Array.isArray(shape.points) ? shape.points : [];
    const centerX = x(drawing.x + width / 2);
    const centerY = y(drawing.y + height / 2);

    context.save();
    context.translate(centerX, centerY);
    context.rotate(radians(drawing.rotation ?? 0));
    context.setLineDash([]);
    context.beginPath();
    if (shape.type === "e") {
      context.ellipse(0, 0, (width * scale) / 2, (height * scale) / 2, 0, 0, Math.PI * 2);
    } else if (points.length >= 4) {
      for (let index = 0; index + 1 < points.length; index += 2) {
        const px = (points[index] - width / 2) * scale;
        const py = (points[index + 1] - height / 2) * scale;
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      if (Number(drawing.fillType) > 0) context.closePath();
    } else {
      context.rect((-width * scale) / 2, (-height * scale) / 2, width * scale, height * scale);
    }
    if (Number(drawing.fillType) > 0) {
      context.globalAlpha = Math.min(1, Number(drawing.fillAlpha ?? 0.5));
      context.fillStyle = cssColor(drawing.fillColor, "#ffffff");
      context.fill();
      context.globalAlpha = 1;
    }
    context.lineWidth = Math.max(unit, Number(drawing.strokeWidth ?? 0) * scale);
    context.strokeStyle = cssColor(drawing.strokeColor, "#ffffff");
    context.stroke();
    context.restore();
    if (typeof drawing.text === "string") drawLabel(frame, drawing.text, centerX, centerY);
  }
}

/** @param {OverlayFrame} frame */
function drawTemplates(frame) {
  const { context, scene, x, y, scale, unit, distancePixels } = frame;
  const flatCones = globalThis.game.settings.get("core", "coneTemplateType") === "flat";
  for (const template of Array.from(scene.templates ?? [])) {
    const originX = x(template.x);
    const originY = y(template.y);
    const length = (Number(template.distance) || 0) * distancePixels * scale;
    const direction = radians(template.direction ?? 0);
    const endX = originX + Math.cos(direction) * length;
    const endY = originY + Math.sin(direction) * length;

    context.save();
    context.setLineDash([]);
    context.beginPath();
    if (template.t === "circle") {
      context.arc(originX, originY, length, 0, Math.PI * 2);
    } else if (template.t === "cone" && flatCones) {
      const half = radians(Math.min(Number(template.angle) || 0, 179)) / 2;
      const reach = length / Math.cos(half);
      context.moveTo(originX, originY);
      context.lineTo(
        originX + Math.cos(direction - half) * reach,
        originY + Math.sin(direction - half) * reach
      );
      context.lineTo(
        originX + Math.cos(direction + half) * reach,
        originY + Math.sin(direction + half) * reach
      );
      context.closePath();
    } else if (template.t === "cone") {
      const half = radians(template.angle ?? 0) / 2;
      context.moveTo(originX, originY);
      context.arc(originX, originY, length, direction - half, direction + half);
      context.closePath();
    } else if (template.t === "rect") {
      context.rect(originX, originY, endX - originX, endY - originY);
    } else {
      const half = ((Number(template.width) || 0) * distancePixels * scale) / 2;
      const normalX = -Math.sin(direction) * half;
      const normalY = Math.cos(direction) * half;
      context.moveTo(originX + normalX, originY + normalY);
      context.lineTo(endX + normalX, endY + normalY);
      context.lineTo(endX - normalX, endY - normalY);
      context.lineTo(originX - normalX, originY - normalY);
      context.closePath();
    }
    context.globalAlpha = 0.2;
    context.fillStyle = cssColor(template.fillColor, "#ff6400");
    context.fill();
    context.globalAlpha = 1;
    context.lineWidth = 2 * unit;
    context.strokeStyle = cssColor(template.borderColor, "#000000");
    context.stroke();
    context.restore();
  }
}

/** @param {OverlayFrame} frame */
function drawWalls(frame) {
  const { context, scene, level, x, y, unit } = frame;
  for (const wall of documentsOnLevel(scene.walls, level)) {
    const [x0, y0, x1, y1] = (wall.c ?? []).map(Number);
    if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
    const ax = x(x0);
    const ay = y(y0);
    const bx = x(x1);
    const by = y(y1);
    const door = Number(wall.door ?? DOOR_NONE);
    const doorState = Number(wall.ds ?? 0);
    const sight = Number(wall.sight);
    const color =
      door !== DOOR_NONE
        ? doorState === DOOR_OPEN
          ? WALL_COLORS.openDoor
          : doorState === DOOR_LOCKED
            ? WALL_COLORS.lockedDoor
            : door === DOOR_SECRET
              ? WALL_COLORS.secretDoor
              : WALL_COLORS.door
        : Number(wall.move) === SENSE_NONE
          ? WALL_COLORS.ethereal
          : sight === SENSE_NONE
            ? WALL_COLORS.invisible
            : sight === SENSE_LIMITED
              ? WALL_COLORS.terrain
              : sight >= SENSE_PROXIMITY
                ? WALL_COLORS.proximity
                : WALL_COLORS.normal;
    const dashed = color === WALL_COLORS.openDoor || color === WALL_COLORS.ethereal;

    context.save();
    context.lineCap = "round";
    context.setLineDash(dashed ? [6 * unit, 4 * unit] : []);
    context.beginPath();
    context.moveTo(ax, ay);
    context.lineTo(bx, by);
    context.lineWidth = 4 * unit;
    context.strokeStyle = "rgba(0, 0, 0, 0.8)";
    context.stroke();
    context.lineWidth = 2 * unit;
    context.strokeStyle = color;
    context.stroke();
    if (sight !== SENSE_NONE && Number(wall.light) === SENSE_NONE) {
      context.setLineDash([2 * unit, 2 * unit]);
      context.lineWidth = unit;
      context.strokeStyle = LIGHT_PASSES_COLOR;
      context.stroke();
    }

    if (wall.sound !== wall.sight) {
      context.setLineDash([]);
      context.beginPath();
      context.arc(ax + (bx - ax) / 4, ay + (by - ay) / 4, 3 * unit, 0, Math.PI * 2);
      context.lineWidth = 1.5 * unit;
      context.strokeStyle = SOUND_COLOR;
      if (Number(wall.sound) === SENSE_NONE) {
        context.stroke();
      } else {
        context.fillStyle = SOUND_COLOR;
        context.fill();
      }
    }

    const midX = (ax + bx) / 2;
    const midY = (ay + by) / 2;
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const direction = Number(wall.dir ?? 0);
    if (direction === DIRECTION_LEFT || direction === DIRECTION_RIGHT) {
      const sign = direction === DIRECTION_LEFT ? 1 : -1;
      const tipX = midX + (sign * -(by - ay) * 8 * unit) / length;
      const tipY = midY + (sign * (bx - ax) * 8 * unit) / length;
      context.setLineDash([]);
      context.beginPath();
      context.moveTo(midX, midY);
      context.lineTo(tipX, tipY);
      context.stroke();
    }
    if (door !== DOOR_NONE) {
      context.setLineDash([]);
      context.fillStyle = color;
      context.strokeStyle = "#000000";
      context.lineWidth = unit;
      context.fillRect(midX - 4 * unit, midY - 4 * unit, 8 * unit, 8 * unit);
      context.strokeRect(midX - 4 * unit, midY - 4 * unit, 8 * unit, 8 * unit);
    }
    context.restore();
  }
}

/** @param {OverlayFrame} frame */
function drawLights(frame) {
  const { context, scene, level, x, y, scale, unit, distancePixels } = frame;
  for (const light of documentsOnLevel(scene.lights, level)) {
    const config = light.config ?? {};
    const disabled = light.hidden === true;
    const color = disabled
      ? DISABLED_COLOR
      : config.negative === true
        ? DARKNESS_COLOR
        : cssColor(config.color, LIGHT_COLOR);
    const cx = x(light.x);
    const cy = y(light.y);

    context.save();
    context.strokeStyle = color;
    context.lineWidth = 1.5 * unit;
    const angle = Number(config.angle ?? 360);
    const facing = radians(Number(light.rotation ?? 0) + 90);
    for (const [radius, dash] of /** @type {[number, number[]][]} */ ([
      [Number(config.dim) || 0, [6 * unit, 4 * unit]],
      [Number(config.bright) || 0, []]
    ])) {
      if (radius <= 0) continue;
      context.setLineDash(dash);
      context.beginPath();
      if (angle >= 360) {
        context.arc(cx, cy, radius * distancePixels * scale, 0, Math.PI * 2);
      } else {
        context.moveTo(cx, cy);
        context.arc(
          cx,
          cy,
          radius * distancePixels * scale,
          facing - radians(angle) / 2,
          facing + radians(angle) / 2
        );
        context.closePath();
      }
      context.stroke();
    }
    drawMarker(frame, cx, cy, 5 * unit, color);
    if (disabled) {
      context.strokeStyle = "#000000";
      context.lineWidth = 1.5 * unit;
      context.beginPath();
      context.moveTo(cx - 4 * unit, cy - 4 * unit);
      context.lineTo(cx + 4 * unit, cy + 4 * unit);
      context.moveTo(cx + 4 * unit, cy - 4 * unit);
      context.lineTo(cx - 4 * unit, cy + 4 * unit);
      context.stroke();
    }
    context.restore();
  }
}

/** @param {OverlayFrame} frame */
function drawSounds(frame) {
  const { context, scene, level, x, y, scale, unit, distancePixels } = frame;
  for (const sound of documentsOnLevel(scene.sounds, level)) {
    const cx = x(sound.x);
    const cy = y(sound.y);
    context.save();
    context.strokeStyle = SOUND_COLOR;
    context.lineWidth = 1.5 * unit;
    context.setLineDash([2 * unit, 3 * unit]);
    context.beginPath();
    context.arc(cx, cy, (Number(sound.radius) || 0) * distancePixels * scale, 0, Math.PI * 2);
    context.stroke();
    drawMarker(frame, cx, cy, 4 * unit, SOUND_COLOR);
    context.restore();
  }
}

/** @param {OverlayFrame} frame */
function drawNotes(frame) {
  const { context, scene, level, x, y, unit } = frame;
  for (const note of documentsOnLevel(scene.notes, level)) {
    const cx = x(note.x);
    const cy = y(note.y);
    context.save();
    drawMarker(frame, cx, cy, 6 * unit, "#ffffff");
    context.restore();
    const text = typeof note.text === "string" && note.text ? note.text : (note.entry?.name ?? "");
    drawLabel(frame, text, cx, cy + 8 * unit);
  }
}

/**
 * @param {OverlayFrame} frame
 * @param {boolean} tokenImages
 */
async function drawTokens(frame, tokenImages) {
  const { context, scene, level, x, y, scale, unit } = frame;
  const tokens = documentsOnLevel(scene.tokens, level);
  /** @type {Map<string, HTMLImageElement>} */
  const images = new Map();
  if (tokenImages) {
    const sources = new Set(
      tokens.map((token) => token.texture?.src).filter((src) => typeof src === "string" && src)
    );
    await Promise.all(
      [...sources].map(async (source) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.src = source;
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let timer;
        try {
          await Promise.race([
            image.decode(),
            new Promise((_, reject) => {
              timer = setTimeout(reject, TOKEN_IMAGE_TIMEOUT_MS);
            })
          ]);
          images.set(source, image);
        } catch {
          image.src = "";
        } finally {
          clearTimeout(timer);
        }
      })
    );
  }

  for (const token of tokens) {
    const left = x(token.x);
    const top = y(token.y);
    const size = token.getSize();
    const width = size.width * scale;
    const height = size.height * scale;
    const image = images.get(token.texture?.src);
    const hidden = token.hidden === true;

    context.save();
    if (image) {
      context.globalAlpha = hidden ? 0.5 : 1;
      context.drawImage(image, left, top, width, height);
      context.globalAlpha = 1;
    }
    context.setLineDash(hidden ? [4 * unit, 3 * unit] : []);
    context.lineWidth = 2 * unit;
    context.strokeStyle = DISPOSITION_COLORS[String(token.disposition)] ?? "#ffffff";
    context.strokeRect(left, top, width, height);
    context.restore();
    drawLabel(
      frame,
      `${token.name ?? ""}${hidden ? " (hidden)" : ""}`,
      left + width / 2,
      top + height + 2 * unit
    );
  }
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {any} scene
 * @param {{ layers: string[], level: any, transform: SnapshotTransform, tokenImages: boolean }} options
 */
export async function drawSnapshotOverlays(context, scene, { layers, level, transform, tokenImages }) {
  const { scale, offsetX, offsetY } = transform;
  /** @type {OverlayFrame} */
  const frame = {
    context,
    scene,
    level,
    x: (value) => value * scale + offsetX,
    y: (value) => value * scale + offsetY,
    scale,
    unit: Math.max(1, Math.max(context.canvas.width, context.canvas.height) / 1024),
    distancePixels: Number(scene.dimensions?.distancePixels) || 0
  };

  /** @type {Record<string, () => void | Promise<void>>} */
  const drawers = {
    grid: () => drawGrid(frame),
    regions: () => drawRegions(frame),
    drawings: () => drawDrawings(frame),
    templates: () => drawTemplates(frame),
    walls: () => drawWalls(frame),
    lights: () => drawLights(frame),
    sounds: () => drawSounds(frame),
    notes: () => drawNotes(frame),
    tokens: () => drawTokens(frame, tokenImages)
  };
  for (const layer of layers) {
    await drawers[layer]();
  }
}
