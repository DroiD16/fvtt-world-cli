import { Option } from "commander";

import type { RegistrationContext } from "./shared.js";
import { executeRemoteCommand } from "../exec.js";
import { saveResultImage } from "../image-output.js";
import { parseNumber, parsePositiveInt } from "../parse.js";

export function registerCanvas({ program, dependencies }: RegistrationContext) {
  const canvas = program.command("canvas").description("GM client canvas view commands");
  canvas.addHelpText(
    "after",
    [
      "",
      "These commands act on the view of the GM client that holds the bridge: the scene it shows, where",
      "it is scrolled to and how far it is zoomed. Players' views stay where they are. They write no",
      "document themselves; a scene switch runs Foundry's own teardown and redraw, which can save the",
      "GM's fog exploration and tells other clients which scene the GM is on. A position is the canvas",
      "point at the center of the screen plus the zoom scale, in the same coordinates as document x and y.",
      "",
      "Result keys (--json): .result.sceneId, .result.levelId (v14), .result.position {x, y, scale},",
      ".result.view {x, y, width, height} (the canvas rectangle on screen); capture adds .result.image",
      "{path, mimeType, width, height, sizeBytes} and .result.transform {scale, offsetX, offsetY}",
      "(image pixel = coordinate * scale + offset); pan adds .result.previous; view-scene reports",
      ".result.previousSceneId, .result.previousLevelId and .result.changed."
    ].join("\n")
  );

  canvas
    .command("capture")
    .description(
      "Capture the GM client's current view as an image, with lighting, darkness and vision as the GM sees them"
    )
    .addOption(
      new Option(
        "--size <px>",
        "Long side of the image in px (16–2048, default: the GM screen's, at most 2048)"
      ).argParser(parsePositiveInt)
    )
    .addOption(new Option("--format <format>", "Image format (default webp)").choices(["webp", "png"]))
    .option(
      "--out <file>",
      "Write the image to this file (default: <command>-<sceneId>[-<levelId>].<format> in a private fvtt-world-cli directory under the system temp directory, replaced by the next image of the same scene)"
    )
    .action(async function captureCanvas(options: { size?: number; format?: string; out?: string }) {
      await executeRemoteCommand({
        commandName: "canvas.capture",
        params: {
          ...(options.size === undefined ? {} : { size: options.size }),
          ...(options.format === undefined ? {} : { format: options.format })
        },
        command: this,
        dependencies,
        prepareResult: saveResultImage("capture", options.out)
      });
    });

  canvas
    .command("pan")
    .description("Scroll and zoom the GM client's view of its current scene")
    .addOption(
      new Option(
        "--x <x>",
        "Canvas x at the center of the screen; Foundry keeps it within the canvas plus a margin of 40% of the screen"
      ).argParser(parseNumber)
    )
    .addOption(
      new Option(
        "--y <y>",
        "Canvas y at the center of the screen; Foundry keeps it within the canvas plus a margin of 40% of the screen"
      ).argParser(parseNumber)
    )
    .addOption(
      new Option("--scale <scale>", "Zoom scale; Foundry clamps it to the scene's zoom limits").argParser(
        parseNumber
      )
    )
    .addOption(
      new Option(
        "--fit",
        "Center the scene and zoom so all of it fits on the screen (instead of --x/--y/--scale)"
      ).conflicts(["x", "y", "scale"])
    )
    .action(async function panCanvas(options: { x?: number; y?: number; scale?: number; fit?: boolean }) {
      await executeRemoteCommand({
        commandName: "canvas.pan",
        params: {
          ...(options.x === undefined ? {} : { x: options.x }),
          ...(options.y === undefined ? {} : { y: options.y }),
          ...(options.scale === undefined ? {} : { scale: options.scale }),
          ...(options.fit ? { fit: true } : {})
        },
        command: this,
        dependencies
      });
    });

  canvas
    .command("view-scene")
    .description("Switch the scene the GM client views, without activating it for players")
    .requiredOption("--scene-id <sceneId>", "Scene id")
    .option("--level-id <levelId>", "Level to view (Foundry v14)")
    .action(async function viewScene(options: { sceneId: string; levelId?: string }) {
      await executeRemoteCommand({
        commandName: "canvas.view-scene",
        params: {
          sceneId: options.sceneId,
          ...(options.levelId === undefined ? {} : { levelId: options.levelId })
        },
        command: this,
        dependencies
      });
    });
}
