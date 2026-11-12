import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { CommanderError } from "commander";

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = { "image/webp": "webp", "image/png": "png" };

export function saveResultImage(kind: string, outPath: string | undefined) {
  return (result: any) => {
    const image = result?.image;
    if (typeof image?.dataUrl !== "string") {
      return result;
    }

    const { dataUrl, ...described } = image;
    const extension = IMAGE_EXTENSIONS[image.mimeType] ?? "img";
    let path = "";
    try {
      path =
        outPath === undefined
          ? join(mkdtempSync(join(tmpdir(), "fvtt-world-cli-")), `${kind}-${result.sceneId}.${extension}`)
          : resolve(outPath);
      writeFileSync(path, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
    } catch (error) {
      throw new CommanderError(
        1,
        "fvtt-world-cli.localFileWriteError",
        `The ${kind} image was rendered but could not be written to ${path || "a temporary directory"}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    return { ...result, image: { ...described, path } };
  };
}
