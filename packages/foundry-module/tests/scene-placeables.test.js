import { beforeEach, describe, expect, it } from "vitest";
import { COMMAND_NAMES } from "../scripts/generated/protocol.js";
import { installFakeFoundry } from "./helpers/fake-foundry.js";
import { createScenePlaceableHandlers } from "../scripts/handlers/scene-placeables.js";
import { createSceneDrawingHandlers } from "../scripts/handlers/scene-drawings.js";
import { createSceneLightHandlers } from "../scripts/handlers/scene-lights.js";
import { createSceneNoteHandlers } from "../scripts/handlers/scene-notes.js";
import { createSceneRegionHandlers } from "../scripts/handlers/scene-regions.js";
import { createSceneSoundHandlers } from "../scripts/handlers/scene-sounds.js";
import { createSceneTemplateHandlers } from "../scripts/handlers/scene-templates.js";
import { createSceneTileHandlers } from "../scripts/handlers/scene-tiles.js";
import { createSceneTokenHandlers } from "../scripts/handlers/scene-tokens.js";
import { createSceneWallHandlers } from "../scripts/handlers/scene-walls.js";

const FAMILY_FACTORIES = {
  "scene.drawing": createSceneDrawingHandlers,
  "scene.light": createSceneLightHandlers,
  "scene.note": createSceneNoteHandlers,
  "scene.region": createSceneRegionHandlers,
  "scene.sound": createSceneSoundHandlers,
  "scene.template": createSceneTemplateHandlers,
  "scene.tile": createSceneTileHandlers,
  "scene.token": createSceneTokenHandlers,
  "scene.wall": createSceneWallHandlers
};

const BATCH_CREATE_SUFFIX = ".create-many";

const registryPlaceablePrefixes = /** @type {string[]} */ (
  COMMAND_NAMES.filter((name) => name.endsWith(BATCH_CREATE_SUFFIX))
    .map((name) => name.slice(0, -BATCH_CREATE_SUFFIX.length))
    .filter((prefix) => prefix.startsWith("scene.") && prefix.split(".").length === 2)
    .sort()
);

function directVerbs(names, prefix) {
  return names
    .filter((name) => name.startsWith(`${prefix}.`) && !name.slice(prefix.length + 1).includes("."))
    .sort();
}

const probeConfig = {
  type: "Wall",
  prefix: "scene.wall",
  idField: "wallId",
  resultKey: "wall",
  pluralKey: "walls",
  notFoundCode: "WALL_NOT_FOUND",
  serialize: (document) => document,
  serializeSummary: (document) => document
};

describe("scene placeable handler factory", () => {
  it("covers every scene placeable family the protocol registry declares", () => {
    expect(registryPlaceablePrefixes).toEqual(Object.keys(FAMILY_FACTORIES).sort());
  });

  it.each(registryPlaceablePrefixes)("registers exactly the verbs %s declares", (prefix) => {
    const handlers = FAMILY_FACTORIES[prefix]();
    expect(directVerbs(Object.keys(handlers), prefix)).toEqual(directVerbs(COMMAND_NAMES, prefix));
  });

  it("registers the CRUD and batch verbs for a family that overrides nothing", () => {
    expect(Object.keys(createScenePlaceableHandlers(probeConfig)).sort()).toEqual(
      directVerbs(COMMAND_NAMES, "scene.wall")
    );
  });

  it("leaves omitted verbs to the family so it can implement them itself", () => {
    const omitted = ["create", "update"];
    const generated = Object.keys(createScenePlaceableHandlers({ ...probeConfig, omitVerbs: omitted }));
    expect(generated).not.toContain("scene.wall.create");
    expect(generated).not.toContain("scene.wall.update");
    expect(generated.sort()).toEqual(
      directVerbs(COMMAND_NAMES, "scene.wall").filter(
        (name) => !omitted.some((verb) => name === `scene.wall.${verb}`)
      )
    );
  });
});

describe("scene placeable capability gate", () => {
  beforeEach(() => {
    installFakeFoundry();
    const scene = /** @type {any} */ (globalThis.game.scenes.get("scene-1"));
    delete scene.templates;
  });

  it.each([
    [
      "scene.template.update",
      { sceneId: "scene-1", templateId: "template-fireball", patch: { distance: 9 } }
    ],
    ["scene.template.clone", { sceneId: "scene-1", templateId: "template-fireball", patch: {} }],
    ["scene.template.delete", { sceneId: "scene-1", templateId: "template-fireball" }]
  ])("refuses %s when the Scene schema has no templates collection", async (command, params) => {
    const handlers = createSceneTemplateHandlers();
    await expect(handlers[command](params)).rejects.toMatchObject({ code: "UNSUPPORTED_OPERATION" });
  });
});
