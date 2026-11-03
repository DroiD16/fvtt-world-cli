import { beforeEach, describe, expect, it } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";
import { createDocument, createRequest, installFakeFoundry } from "./helpers/fake-foundry.js";

const V13 = { version: "13.351", generation: 13 };
const V14 = { version: "14.369", generation: 14 };

function router() {
  return createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
}

function scene() {
  return globalThis.game.scenes.get("scene-1");
}

describe("scene levels", () => {
  beforeEach(() => {
    installFakeFoundry();
    globalThis.game.release = V14;
  });

  describe("on v13", () => {
    beforeEach(() => {
      globalThis.game.release = V13;
    });

    it("refuses every scene.level command", async () => {
      for (const [command, params] of Object.entries({
        "scene.level.list": { sceneId: "scene-1" },
        "scene.level.get": { sceneId: "scene-1", levelId: "level-ground" },
        "scene.level.create": { sceneId: "scene-1", data: { name: "Attic" } },
        "scene.level.delete-many": { sceneId: "scene-1", ids: ["level-ground"], dryRun: true }
      })) {
        const response = await router().route(createRequest(command, params));
        expect(response.error?.code, command).toBe("UNSUPPORTED_OPERATION");
        expect(response.error.details.family).toBe("scene.level");
      }
    });

    it("refuses levels and initialLevel on scene writes", async () => {
      const created = await router().route(
        createRequest("scene.create", { data: { name: "Tower", levels: [{ name: "Ground" }] } })
      );
      expect(created.error.code).toBe("UNSUPPORTED_OPERATION");
      expect(created.error.details).toEqual({ family: "scene", fields: ["levels"] });

      for (const command of ["scene.update", "scene.clone"]) {
        const response = await router().route(
          createRequest(command, { sceneId: "scene-1", patch: { initialLevel: "level-upper" } })
        );
        expect(response.error.code, command).toBe("UNSUPPORTED_OPERATION");
        expect(response.error.details.fields).toEqual(["initialLevel"]);
      }
      expect(globalThis.Scene.create).not.toHaveBeenCalled();
    });

    it("keeps the scene result in its v13 shape", async () => {
      const response = await router().route(createRequest("scene.get", { sceneId: "scene-1" }));

      expect(response.result.scene.background.src).toBe("worlds/world-1/maps/dungeon.webp");
      expect(response.result.scene).toHaveProperty("foreground");
      expect(response.result.scene).not.toHaveProperty("levels");
      expect(response.result.scene).not.toHaveProperty("initialLevel");
    });
  });

  describe("scene results on v14", () => {
    it("carry the stored levels in stored order and omit the per-level legacy fields", async () => {
      const response = await router().route(createRequest("scene.get", { sceneId: "scene-1" }));
      const result = response.result.scene;

      expect(result.levels.map((level) => [level.id, level.name])).toEqual([
        ["level-ground", "Ground Floor"],
        ["level-upper", "Upper Floor"]
      ]);
      expect(result.levels[0].background).toEqual({ src: "worlds/world-1/maps/dungeon.webp" });
      expect(result.initialLevel).toBeNull();
      for (const field of ["background", "backgroundColor", "foreground", "foregroundElevation"]) {
        expect(result, field).not.toHaveProperty(field);
      }
    });

    it("leave levels out of scene.list rows", async () => {
      const response = await router().route(createRequest("scene.list", {}));
      expect(response.result.scenes[0]).not.toHaveProperty("levels");
    });
  });

  describe("scene.create with levels", () => {
    it("canonicalizes each level's image paths and returns the created levels", async () => {
      const response = await router().route(
        createRequest("scene.create", {
          data: {
            name: "Tower",
            levels: [
              { name: "Ground", background: { src: "worlds/world-1/maps/ground floor.webp" } },
              {
                name: "Roof",
                foreground: { src: "worlds/world-1/maps/roof top.webp" },
                fog: { src: "worlds/world-1/fog 1.webp" }
              }
            ]
          }
        })
      );

      expect(response.ok, JSON.stringify(response.error ?? null)).toBe(true);
      const sent = globalThis.Scene.create.mock.calls.at(-1)[0].levels;
      expect(sent[0].background.src).toBe("worlds/world-1/maps/ground%20floor.webp");
      expect(sent[1].foreground.src).toBe("worlds/world-1/maps/roof%20top.webp");
      expect(sent[1].fog.src).toBe("worlds/world-1/fog%201.webp");
      expect(response.result.scene.levels.map((level) => level.name)).toEqual(["Ground", "Roof"]);
    });

    it("reports an error when the created scene holds a different number of levels", async () => {
      globalThis.Scene.create.mockImplementationOnce(async (data) =>
        createDocument("scene-short", { ...data, levels: data.levels.slice(0, 1) })
      );

      const response = await router().route(
        createRequest("scene.create", {
          data: { name: "Tower", levels: [{ name: "Ground" }, { name: "Roof" }] }
        })
      );

      expect(response.error.code).toBe("INTERNAL_ERROR");
      expect(response.error.details).toMatchObject({ sceneId: "scene-short", requested: 2, created: 1 });
    });

    it("previews the levels without creating the scene", async () => {
      const response = await router().route(
        createRequest("scene.create", { data: { name: "Tower", levels: [{ name: "Ground" }] }, dryRun: true })
      );

      expect(response.result.dryRun).toBe(true);
      expect(response.result.scene.levels.map((level) => level.name)).toEqual(["Ground"]);
      expect(globalThis.Scene.create).not.toHaveBeenCalled();
    });

    it("refuses initialLevel, real and dry-run", async () => {
      for (const extra of [{}, { dryRun: true }]) {
        const response = await router().route(
          createRequest("scene.create", {
            data: { name: "Tower", levels: [{ name: "Ground" }], initialLevel: null },
            ...extra
          })
        );
        expect(response.error.code).toBe("INVALID_PARAMS");
        expect(response.error.details).toEqual({ field: "initialLevel" });
      }
      expect(globalThis.Scene.create).not.toHaveBeenCalled();
    });
  });

  describe("initialLevel on existing scenes", () => {
    it("accepts a level of the scene and null", async () => {
      for (const initialLevel of ["level-upper", null]) {
        const response = await router().route(
          createRequest("scene.update", { sceneId: "scene-1", patch: { initialLevel } })
        );
        expect(response.ok, JSON.stringify(response.error ?? null)).toBe(true);
        expect(response.result.scene.initialLevel).toBe(initialLevel);
      }
    });

    it("refuses an unknown level on update and clone, real and dry-run", async () => {
      for (const command of ["scene.update", "scene.clone"]) {
        for (const extra of [{}, { dryRun: true }]) {
          const response = await router().route(
            createRequest(command, { sceneId: "scene-1", patch: { initialLevel: "level-gone" }, ...extra })
          );
          expect(response.error.code, command).toBe("LEVEL_NOT_FOUND");
          expect(response.error.details).toEqual({ sceneId: "scene-1", levelId: "level-gone" });
        }
      }
      expect(scene().update).not.toHaveBeenCalled();
      expect(scene().clone).not.toHaveBeenCalled();
    });

    it("checks a compendium import against the levels of the packed scene", async () => {
      const importParams = { pack: "world.test-scene-pack", entryId: "scn-src" };

      const unknown = await router().route(
        createRequest("scene.import-from-compendium", {
          ...importParams,
          patch: { initialLevel: "level-gone" }
        })
      );
      expect(unknown.error.code).toBe("LEVEL_NOT_FOUND");
      expect(unknown.error.details).toEqual({ ...importParams, levelId: "level-gone" });

      for (const initialLevel of ["lvl-src-1", null]) {
        const response = await router().route(
          createRequest("scene.import-from-compendium", {
            ...importParams,
            patch: { initialLevel },
            dryRun: true
          })
        );
        expect(response.ok, JSON.stringify(response.error ?? null)).toBe(true);
      }
      expect(globalThis.Scene.create).not.toHaveBeenCalled();
    });
  });

  describe("scene.level commands", () => {
    it("lists level summaries and reads one level", async () => {
      const list = await router().route(createRequest("scene.level.list", { sceneId: "scene-1" }));
      expect(list.result.levels[0]).toEqual({
        id: "level-ground",
        _id: "level-ground",
        name: "Ground Floor",
        elevation: { bottom: 0, top: 20 },
        sort: 0
      });

      const missing = await router().route(
        createRequest("scene.level.get", { sceneId: "scene-1", levelId: "level-gone" })
      );
      expect(missing.error.code).toBe("LEVEL_NOT_FOUND");
      expect(missing.error.message).toContain("scene.level.list");
    });

    it("creates and updates a level with canonical image paths", async () => {
      const created = await router().route(
        createRequest("scene.level.create", {
          sceneId: "scene-1",
          data: { name: "Attic", background: { src: "worlds/world-1/maps/attic 1.webp" } }
        })
      );
      expect(created.ok, JSON.stringify(created.error ?? null)).toBe(true);
      expect(created.result.level.background.src).toBe("worlds/world-1/maps/attic%201.webp");

      const updated = await router().route(
        createRequest("scene.level.update", {
          sceneId: "scene-1",
          levelId: "level-upper",
          patch: { foreground: { src: "worlds/world-1/maps/upper fg.webp" } }
        })
      );
      expect(updated.ok, JSON.stringify(updated.error ?? null)).toBe(true);
      expect(updated.result.level.foreground.src).toBe("worlds/world-1/maps/upper%20fg.webp");
    });

    it("refuses to delete the last remaining level, real and dry-run", async () => {
      const first = await router().route(
        createRequest("scene.level.delete", { sceneId: "scene-1", levelId: "level-ground" })
      );
      expect(first.ok).toBe(true);

      for (const extra of [{}, { dryRun: true }]) {
        const response = await router().route(
          createRequest("scene.level.delete", { sceneId: "scene-1", levelId: "level-upper", ...extra })
        );
        expect(response.error.code).toBe("DELETE_FORBIDDEN");
        expect(response.error.details).toEqual({ sceneId: "scene-1", levelIds: ["level-upper"] });
      }
      expect(scene().levels.get("level-upper")).toBeTruthy();
    });

    it("refuses a batch that would delete every level, counting only distinct existing ids", async () => {
      for (const ids of [
        ["level-ground", "level-upper"],
        ["level-gone", "level-ground", "level-upper"]
      ]) {
        for (const extra of [{}, { dryRun: true }]) {
          const response = await router().route(
            createRequest("scene.level.delete-many", { sceneId: "scene-1", ids, ...extra })
          );
          expect(response.error?.code, JSON.stringify(ids)).toBe("DELETE_FORBIDDEN");
          expect(response.error.details.levelIds).toEqual(["level-ground", "level-upper"]);
        }
      }
      expect(scene().deleteEmbeddedDocuments).not.toHaveBeenCalled();

      const duplicate = await router().route(
        createRequest("scene.level.delete-many", {
          sceneId: "scene-1",
          ids: ["level-ground", "level-ground"]
        })
      );
      expect(duplicate.error.code).toBe("INVALID_PARAMS");

      const partial = await router().route(
        createRequest("scene.level.delete-many", { sceneId: "scene-1", ids: ["level-gone", "level-ground"] })
      );
      expect(partial.result.outcomes.map((outcome) => outcome.status)).toEqual(["alreadyDeleted", "deleted"]);
      expect(scene().levels.size).toBe(1);
    });
  });
});
