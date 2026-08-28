import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const binPath = fileURLToPath(new URL("../bin/fvtt-world-cli.js", import.meta.url));

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function listenSilently() {
  return new Promise<{ port: number; close: () => void; connected: Promise<void> }>((resolve) => {
    const sockets: import("node:net").Socket[] = [];
    let announceConnection: () => void = () => {};
    const connected = new Promise<void>((resolveConnected) => {
      announceConnection = resolveConnected;
    });

    const server = createServer((socket) => {
      sockets.push(socket);
      announceConnection();
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: typeof address === "object" && address ? address.port : 0,
        close: () => {
          for (const socket of sockets) {
            socket.destroy();
          }

          server.close();
        },
        connected
      });
    });
  });
}

it("relays SIGINT to the source-run child and leaves no process holding the streams", async () => {
  const server = await listenSilently();
  const configHome = await mkdtemp(join(tmpdir(), "fvtt-world-cli-signal-"));
  const child = spawn(
    process.execPath,
    [
      binPath,
      "system",
      "info",
      "--json",
      "--timeout-ms",
      "100000",
      "--daemon-url",
      `ws://127.0.0.1:${server.port}`
    ],
    {
      env: { ...process.env, FVTT_WORLD_CLI_FORCE_SRC: "1", XDG_CONFIG_HOME: configHome },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  cleanup = () => {
    child.kill("SIGKILL");
    server.close();
  };

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  const stdoutClosed = new Promise<void>((resolve) => child.stdout.on("close", () => resolve()));
  const stderrClosed = new Promise<void>((resolve) => child.stderr.on("close", () => resolve()));
  child.stdout.resume();
  child.stderr.resume();

  await server.connected;
  child.kill("SIGINT");

  const [exit] = await Promise.all([exited, stdoutClosed, stderrClosed]);

  expect(exit.signal).toBe("SIGINT");
}, 30000);
