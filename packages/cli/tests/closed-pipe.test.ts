import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { executeCli } from "../src/index.js";
import { ignoreClosedPipe } from "../src/deps.js";
import {
  createDefaultTestConfig,
  createInMemoryConfigStore,
  createWritableBuffer,
  failIfCalledSendCommand
} from "./helpers/cli-harness.js";

function pipeError(code: string) {
  return Object.assign(new Error(`write ${code}`), { code });
}

class ClosedReaderPipe extends EventEmitter {
  chunks: string[] = [];

  write(chunk: string) {
    this.chunks.push(chunk);
    process.nextTick(() => this.emit("error", pipeError("EPIPE")));
    return true;
  }
}

class OpenPipe extends EventEmitter {
  write() {
    return true;
  }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("closed output pipe", () => {
  it("ignores EPIPE on the stream itself and stops listening once released", async () => {
    const pipe = new ClosedReaderPipe();
    const release = ignoreClosedPipe(pipe as unknown as NodeJS.WriteStream);

    pipe.write("first");
    await settle();
    expect(pipe.listenerCount("error")).toBe(1);
    release();
    expect(pipe.listenerCount("error")).toBe(0);
  });

  it("still raises stream errors other than EPIPE", () => {
    const pipe = new ClosedReaderPipe();
    ignoreClosedPipe(pipe as unknown as NodeJS.WriteStream);

    expect(() => pipe.emit("error", pipeError("EIO"))).toThrow("write EIO");
  });

  it("prints help into a closed pipe without failing", async () => {
    const stdout = new ClosedReaderPipe();

    const exitCode = await executeCli(["node", "fvtt-world-cli", "file", "--help"], {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: createWritableBuffer(),
      sendCommand: failIfCalledSendCommand()
    });
    await settle();

    expect(exitCode).toBe(0);
    expect(stdout.chunks.join("")).toContain("Usage: fvtt-world-cli file");
  });

  it("keeps the command's own exit code when its output pipe is closed", async () => {
    const stdout = new ClosedReaderPipe();

    const exitCode = await executeCli(["node", "fvtt-world-cli", "--json", "schema", "bogus.command"], {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: createWritableBuffer(),
      sendCommand: failIfCalledSendCommand()
    });
    await settle();

    expect(exitCode).toBe(2);
  });

  it("leaves the output streams of bridge serve unguarded", async () => {
    const stdout = new OpenPipe();
    const stderr = new OpenPipe();
    const createBridgeDaemon = vi.fn(() => ({
      start: async () => {
        throw new Error("daemon start refused");
      }
    })) as unknown as NonNullable<Parameters<typeof executeCli>[1]>["createBridgeDaemon"];

    await executeCli(["node", "fvtt-world-cli", "bridge", "serve"], {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
      sendCommand: failIfCalledSendCommand(),
      createBridgeDaemon,
      configStore: createInMemoryConfigStore(createDefaultTestConfig())
    });

    expect(createBridgeDaemon).toHaveBeenCalled();
    expect(stdout.listenerCount("error")).toBe(0);
    expect(stderr.listenerCount("error")).toBe(0);
  });
});
