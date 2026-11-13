import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { RENDERED_IMAGE_FORMATS } from "@fvtt-world-cli/protocol";
import { CommanderError } from "commander";

const SAFE_ID = /^[A-Za-z0-9]{1,32}$/;

function defaultImagePath(kind: string, result: any, extension: string) {
  const uid = process.getuid?.();
  const directory = join(tmpdir(), uid === undefined ? "fvtt-world-cli" : `fvtt-world-cli-${uid}`);
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stats = lstatSync(directory);
  if (!stats.isDirectory() || (uid !== undefined && (stats.uid !== uid || (stats.mode & 0o077) !== 0))) {
    throw new Error(
      `${directory} is not a directory that only this user can access (owned by this user, mode 700); remove it, or pass --out`
    );
  }
  const ids = [result?.sceneId, result?.levelId].filter((id) => typeof id === "string" && SAFE_ID.test(id));
  return join(directory, `${[kind, ...ids].join("-")}.${extension}`);
}

export function saveResultImage(kind: string, outPath: string | undefined) {
  return (result: any) => {
    const image = result?.image;
    if (typeof image?.dataUrl !== "string") {
      return result;
    }

    const { dataUrl, ...described } = image;
    const format = String(image.mimeType).replace(/^image\//, "");
    const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
    let path = "";
    try {
      if (outPath === undefined) {
        path = defaultImagePath(kind, result, RENDERED_IMAGE_FORMATS.includes(format) ? format : "img");
        const staging = `${path}.${randomBytes(6).toString("hex")}.tmp`;
        try {
          writeFileSync(staging, bytes, { flag: "wx", mode: 0o600 });
          renameSync(staging, path);
        } finally {
          rmSync(staging, { force: true });
        }
      } else {
        path = resolve(outPath);
        writeFileSync(path, bytes);
      }
    } catch (error) {
      throw new CommanderError(
        1,
        "fvtt-world-cli.localFileWriteError",
        `The ${kind} image was rendered but could not be written to ${path || "the temporary image directory"}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    return { ...result, image: { ...described, path } };
  };
}
