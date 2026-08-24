import { createServer } from "node:net";
import { Readable } from "node:stream";

import {
  ERROR_CODES,
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  createCommandResponse,
  createErrorResponse,
  createProtocolError
} from "@fvtt-world-cli/protocol";
import { CommanderError } from "commander";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";

import { createProgram, planCliErrorOutput } from "../src/index.js";
import { createEmptyConfig } from "../src/config.js";
import { runCommand, type SendCommandMock } from "./helpers/cli-harness.js";

function createTestConfigStore(daemonUrl?: string) {
  const config = createEmptyConfig();
  if (daemonUrl) config.daemonUrl = daemonUrl;
  return {
    getConfigPath: () => "/tmp/test-config.json",
    readConfig: () => config,
    writeConfig: () => {}
  };
}

async function getFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to acquire a free TCP port"));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

type RequestHandler = (
  request: { id: string; command: string; params: Record<string, unknown> },
  socket: WebSocket
) => unknown;

interface FakeDaemon {
  url: string;
  connectionCount: number;
  close: () => Promise<void>;
}

async function createFakeDaemon(handler: RequestHandler): Promise<FakeDaemon> {
  const port = await getFreePort();
  const server = new WebSocketServer({ host: "127.0.0.1", port });
  const daemon: FakeDaemon = {
    url: `ws://127.0.0.1:${port}`,
    connectionCount: 0,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };

  server.on("connection", (socket) => {
    daemon.connectionCount += 1;
    socket.on("message", (data) => {
      const request = JSON.parse(data.toString()) as {
        type?: string;
        id: string;
        command: string;
        params?: Record<string, unknown>;
      };
      if (request.type === MESSAGE_TYPES.CLIENT_HELLO) {
        socket.send(
          JSON.stringify({
            protocolVersion: PROTOCOL_VERSION,
            type: MESSAGE_TYPES.CLIENT_HELLO_ACK,
            ok: true
          })
        );
        return;
      }
      const response = handler(
        { id: request.id, command: request.command, params: request.params ?? {} },
        socket
      );

      if (response !== undefined) {
        socket.send(JSON.stringify(response));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", (error) => reject(error));
  });

  return daemon;
}

function okResponse(id: string, command: string) {
  return createCommandResponse({ id, result: { echoedCommand: command } });
}

function errorResponse(id: string) {
  return createErrorResponse({
    id,
    error: createProtocolError({ code: "SCENE_NOT_FOUND", message: "nope" })
  });
}

function createWritableBuffer() {
  let value = "";
  return {
    write(chunk: string) {
      value += chunk;
    },
    read() {
      return value;
    }
  };
}

async function runExec(
  daemonUrl: string,
  input: string,
  extraArgs: string[] = [],
  stdinOverrides: { isTTY?: boolean } = {},
  globalArgs: string[] = []
) {
  const stdout = createWritableBuffer();
  const stderr = createWritableBuffer();
  const stdin = Readable.from([input]) as Readable & { isTTY?: boolean };
  if (stdinOverrides.isTTY !== undefined) {
    stdin.isTTY = stdinOverrides.isTTY;
  }

  const program = createProgram({
    stdout,
    stderr,
    stdin,
    configStore: createTestConfigStore(daemonUrl)
  });
  program.exitOverride();

  let error: unknown = null;
  try {
    await program.parseAsync(
      ["node", "fvtt-world-cli", "--daemon-url", daemonUrl, ...globalArgs, "exec", "--stdin", ...extraArgs],
      { from: "node" }
    );
  } catch (thrown) {
    error = thrown;
  }

  const lines = stdout
    .read()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, any>);

  return { stdout: stdout.read(), stderr: stderr.read(), lines, error };
}

describe("fvtt-world-cli exec --stdin", () => {
  let daemons: FakeDaemon[] = [];

  afterEach(async () => {
    await Promise.all(daemons.map((d) => d.close()));
    daemons = [];
  });

  async function fakeDaemon(handler: RequestHandler) {
    const daemon = await createFakeDaemon(handler);
    daemons.push(daemon);
    return daemon;
  }

  it("maps N input lines to N ordered output lines over ONE connection", async () => {
    const daemon = await fakeDaemon(({ id, command }) => okResponse(id, command));
    const input =
      ["system.ping", "system.info", "system.ping"].map((command) => JSON.stringify({ command })).join("\n") +
      "\n";

    const { lines, error } = await runExec(daemon.url, input);

    expect(error).toBeNull();
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.index)).toEqual([0, 1, 2]);
    expect(lines.map((line) => line.result.echoedCommand)).toEqual([
      "system.ping",
      "system.info",
      "system.ping"
    ]);
    expect(lines.every((line) => line.ok === true)).toBe(true);
    expect(daemon.connectionCount).toBe(1);
  });

  it("echoes a caller id when present and uses index otherwise", async () => {
    const daemon = await fakeDaemon(({ id, command }) => okResponse(id, command));
    const input =
      [
        JSON.stringify({ id: "abc", command: "system.ping" }),
        JSON.stringify({ command: "system.info" })
      ].join("\n") + "\n";

    const { lines } = await runExec(daemon.url, input);

    expect(lines[0].id).toBe("abc");
    expect(lines[0].index).toBe(0);
    expect(lines[1].index).toBe(1);
  });

  it("continues past a mid-batch failure by default and exits non-zero", async () => {
    const daemon = await fakeDaemon(({ id, command }) =>
      command === "scene.get" ? errorResponse(id) : okResponse(id, command)
    );
    const input =
      [
        JSON.stringify({ command: "system.ping" }),
        JSON.stringify({ command: "scene.get", params: { sceneId: "missing" } }),
        JSON.stringify({ command: "system.info" })
      ].join("\n") + "\n";

    const { lines, error } = await runExec(daemon.url, input);

    expect(lines).toHaveLength(3);
    expect(lines[0].ok).toBe(true);
    expect(lines[1].ok).toBe(false);
    expect(lines[1].error.code).toBe("SCENE_NOT_FOUND");
    expect(lines[2].ok).toBe(true);
    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).exitCode).toBe(1);
    expect(daemon.connectionCount).toBe(1);
  });

  it("threads the global --dry-run into write lines but not read lines", async () => {
    const seen: Array<{ command: string; params: Record<string, unknown> }> = [];
    const daemon = await fakeDaemon(({ id, command, params }) => {
      seen.push({ command, params });
      return okResponse(id, command);
    });
    const input =
      [
        JSON.stringify({ command: "scene.update", params: { sceneId: "s1", patch: { name: "X" } } }),

        JSON.stringify({ command: "scene.get", params: { sceneId: "s1" } })
      ].join("\n") + "\n";

    const { error } = await runExec(daemon.url, input, [], {}, ["--dry-run"]);

    expect(error).toBeNull();
    const write = seen.find((r) => r.command === "scene.update");
    const read = seen.find((r) => r.command === "scene.get");
    expect(write?.params.dryRun).toBe(true);
    expect(read?.params.dryRun).toBeUndefined();
  });

  it("does not inject dryRun without the global --dry-run flag", async () => {
    const seen: Array<{ command: string; params: Record<string, unknown> }> = [];
    const daemon = await fakeDaemon(({ id, command, params }) => {
      seen.push({ command, params });
      return okResponse(id, command);
    });
    const input =
      JSON.stringify({ command: "scene.update", params: { sceneId: "s1", patch: { name: "X" } } }) + "\n";

    const { error } = await runExec(daemon.url, input);

    expect(error).toBeNull();
    expect(seen[0]?.params.dryRun).toBeUndefined();
  });

  it("aborts after the first failure with --stop-on-error (still emitting that line)", async () => {
    const daemon = await fakeDaemon(({ id, command }) =>
      command === "scene.get" ? errorResponse(id) : okResponse(id, command)
    );
    const input =
      [
        JSON.stringify({ command: "system.ping" }),
        JSON.stringify({ command: "scene.get", params: { sceneId: "missing" } }),
        JSON.stringify({ command: "system.info" })
      ].join("\n") + "\n";

    const { lines, error } = await runExec(daemon.url, input, ["--stop-on-error"]);

    expect(lines).toHaveLength(2);
    expect(lines[0].ok).toBe(true);
    expect(lines[1].ok).toBe(false);
    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).exitCode).toBe(1);
  });

  it("skips blank/whitespace-only lines (trailing + interleaved) and exits 0 when all requests succeed", async () => {
    const daemon = await fakeDaemon(({ id, command }) => okResponse(id, command));

    const input =
      [
        JSON.stringify({ command: "system.ping" }),
        "",
        "   ",
        JSON.stringify({ command: "system.info" }),
        "",
        ""
      ].join("\n") + "\n";

    const { lines, error } = await runExec(daemon.url, input);

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.ok === true)).toBe(true);
    expect(lines.map((line) => line.result.echoedCommand)).toEqual(["system.ping", "system.info"]);

    expect(lines.map((line) => line.index)).toEqual([0, 3]);

    expect(error).toBeNull();
  });

  it("emits an error line for a malformed input line and continues", async () => {
    const daemon = await fakeDaemon(({ id, command }) => okResponse(id, command));
    const input = ["not json at all", JSON.stringify({ command: "system.ping" })].join("\n") + "\n";

    const { lines, error } = await runExec(daemon.url, input);

    expect(lines).toHaveLength(2);
    expect(lines[0].ok).toBe(false);
    expect(lines[0].error.code).toBe("INVALID_MESSAGE");
    expect(lines[0].index).toBe(0);
    expect(lines[1].ok).toBe(true);

    expect(error).toBeInstanceOf(CommanderError);
  });

  it("emits an error line for a line missing a command", async () => {
    const daemon = await fakeDaemon(({ id, command }) => okResponse(id, command));
    const input = [JSON.stringify({ params: { a: 1 } })].join("\n") + "\n";

    const { lines } = await runExec(daemon.url, input);

    expect(lines).toHaveLength(1);
    expect(lines[0].ok).toBe(false);
    expect(lines[0].error.code).toBe("INVALID_PARAMS");
  });

  it("produces pure NDJSON (one parseable JSON object per line, no pretty-print)", async () => {
    const daemon = await fakeDaemon(({ id, command }) => okResponse(id, command));
    const input =
      [JSON.stringify({ command: "system.ping" }), JSON.stringify({ command: "system.info" })].join("\n") +
      "\n";

    const { stdout } = await runExec(daemon.url, input);

    const rawLines = stdout.split("\n").filter((line) => line.length > 0);
    expect(rawLines).toHaveLength(2);
    for (const rawLine of rawLines) {
      expect(() => JSON.parse(rawLine)).not.toThrow();
      expect(rawLine).not.toMatch(/^\s/);
    }
  });

  it("times out a wedged request per-request and continues on the same connection", async () => {
    const daemon = await fakeDaemon(({ id, command }) =>
      command === "scene.get" ? undefined : okResponse(id, command)
    );
    const input =
      [
        JSON.stringify({ command: "scene.get", params: { sceneId: "x" } }),
        JSON.stringify({ command: "system.ping" })
      ].join("\n") + "\n";

    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();
    const stdin = Readable.from([input]) as Readable & { isTTY?: boolean };
    const program = createProgram({
      stdout,
      stderr,
      stdin,
      configStore: createTestConfigStore()
    });
    program.exitOverride();

    let error: unknown = null;
    try {
      await program.parseAsync(
        ["node", "fvtt-world-cli", "--daemon-url", daemon.url, "--timeout-ms", "50", "exec", "--stdin"],
        { from: "node" }
      );
    } catch (thrown) {
      error = thrown;
    }

    const lines = stdout
      .read()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, any>);

    expect(lines).toHaveLength(2);
    expect(lines[0].ok).toBe(false);
    expect(lines[0].error.code).toBe("DAEMON_UNAVAILABLE");
    expect(lines[1].ok).toBe(true);
    expect(error).toBeInstanceOf(CommanderError);
    expect(daemon.connectionCount).toBe(1);
  });

  it("rejects the in-flight request with INVALID_MESSAGE on a malformed daemon frame and continues on the same connection", async () => {
    let connectionCount = 0;
    const port = await getFreePort();
    const server = new WebSocketServer({ host: "127.0.0.1", port });
    server.on("connection", (socket) => {
      connectionCount += 1;
      socket.on("message", (data) => {
        const request = JSON.parse(data.toString()) as { id: string; command: string };
        if ((request as any).type === MESSAGE_TYPES.CLIENT_HELLO) {
          socket.send(
            JSON.stringify({
              protocolVersion: PROTOCOL_VERSION,
              type: MESSAGE_TYPES.CLIENT_HELLO_ACK,
              ok: true
            })
          );
          return;
        }
        if (request.command === "scene.get") {
          socket.send("this is not a json envelope");
          return;
        }
        socket.send(JSON.stringify(okResponse(request.id, request.command)));
      });
    });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));

    try {
      const input =
        [
          JSON.stringify({ command: "scene.get", params: { sceneId: "x" } }),
          JSON.stringify({ command: "system.ping" })
        ].join("\n") + "\n";
      const { lines, error } = await runExec(`ws://127.0.0.1:${port}`, input);

      expect(lines).toHaveLength(2);
      expect(lines[0].ok).toBe(false);
      expect(lines[0].error.code).toBe("INVALID_MESSAGE");
      expect(lines[0].error.details.reason).toBe("invalid_json");

      expect(lines[1].ok).toBe(true);
      expect(error).toBeInstanceOf(CommanderError);
      expect((error as CommanderError).exitCode).toBe(1);
      expect(connectionCount).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("fails fast (no NDJSON) when stdin is an interactive TTY", async () => {
    const daemon = await fakeDaemon(({ id, command }) => okResponse(id, command));

    const { stdout, error } = await runExec(daemon.url, "", [], { isTTY: true });

    expect(stdout).toBe("");
    expect(error).toBeInstanceOf(CommanderError);

    expect(planCliErrorOutput(error, false).exitCode).toBe(2);
    expect(daemon.connectionCount).toBe(0);
  });

  it("requires --stdin", async () => {
    const daemon = await fakeDaemon(({ id, command }) => okResponse(id, command));

    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();
    const stdin = Readable.from([""]) as Readable & { isTTY?: boolean };
    const program = createProgram({
      stdout,
      stderr,
      stdin,
      configStore: createTestConfigStore()
    });
    program.exitOverride();

    let error: unknown = null;
    try {
      await program.parseAsync(["node", "fvtt-world-cli", "--daemon-url", daemon.url, "exec"], {
        from: "node"
      });
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(CommanderError);

    expect(planCliErrorOutput(error, false).exitCode).toBe(2);
    expect(stdout.read()).toBe("");
  });

  it("fails fast (no NDJSON) when the daemon is unreachable", async () => {
    const port = await getFreePort();
    const { stdout, error } = await runExec(
      `ws://127.0.0.1:${port}`,
      JSON.stringify({ command: "system.ping" }) + "\n"
    );

    expect(stdout).toBe("");
    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).exitCode).toBe(1);

    const jsonPlan = planCliErrorOutput(error, true);
    const envelope = JSON.parse(jsonPlan.stdout ?? "{}") as { error?: { code?: string } };
    expect(envelope.error?.code).toBe("DAEMON_UNAVAILABLE");

    expect(jsonPlan.exitCode).toBe(3);
  });

  it("waits out an approval on one line without reordering the batch", async () => {
    const daemon = await fakeDaemon(({ id, command }) => {
      if (command === "scene.delete") return approvalPending(command, id);
      if (command === "approval.await")
        return createCommandResponse({
          id,
          result: approvalReport("approved", createCommandResponse({ id: "delivered", result: { id: "s1" } }))
        });
      return okResponse(id, command);
    });
    const input =
      [
        JSON.stringify({ id: "first", command: "system.ping" }),
        JSON.stringify({ id: "second", command: "scene.delete", params: { sceneId: "s1" } }),
        JSON.stringify({ id: "third", command: "system.info" })
      ].join("\n") + "\n";

    const { lines, stderr, error } = await runExec(daemon.url, input);

    expect(error).toBeNull();
    expect(lines.map((line) => line.index)).toEqual([0, 1, 2]);
    expect(lines.map((line) => line.id)).toEqual(["first", "second", "third"]);
    expect(lines[1].ok).toBe(true);
    expect(lines[1].result.id).toBe("s1");
    expect(stderr).toContain("Waiting for GM approval in Foundry (command scene.delete");
    expect(daemon.connectionCount).toBe(1);
  });

  it("replaces a persistent connection that died while the approval was pending", async () => {
    let polls = 0;
    const daemon = await fakeDaemon(({ id, command }, socket) => {
      if (command === "scene.delete") return approvalPending(command, id);
      if (command === "approval.await") {
        polls += 1;
        if (polls === 1) {
          socket.close();
          return undefined;
        }
        return createCommandResponse({
          id,
          result: approvalReport("approved", createCommandResponse({ id: "delivered", result: { id: "s1" } }))
        });
      }
      return okResponse(id, command);
    });
    const input = JSON.stringify({ command: "scene.delete", params: { sceneId: "s1" } }) + "\n";

    const { lines, error } = await runExec(daemon.url, input);

    expect(error).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0].ok).toBe(true);
    expect(polls).toBe(2);
    expect(daemon.connectionCount).toBe(2);
  });

  it("stops the batch on a terminal approval failure with --stop-on-error", async () => {
    const seen: string[] = [];
    const daemon = await fakeDaemon(({ id, command }) => {
      seen.push(command);
      if (command === "scene.delete") return approvalPending(command, id);
      if (command === "approval.await")
        return createCommandResponse({ id, result: approvalReport("denied") });
      return okResponse(id, command);
    });
    const input =
      [
        JSON.stringify({ command: "scene.delete", params: { sceneId: "s1" } }),
        JSON.stringify({ command: "system.ping" })
      ].join("\n") + "\n";

    const { lines, error } = await runExec(daemon.url, input, ["--stop-on-error"]);

    expect(lines).toHaveLength(1);
    expect(lines[0].error.code).toBe(ERROR_CODES.APPROVAL_DENIED);
    expect(seen).not.toContain("system.ping");
    expect((error as CommanderError).exitCode).toBe(1);
  });

  it("stops the batch and leaves no signal listener after an interrupted approval", async () => {
    const daemon = await fakeDaemon(({ id, command }) => {
      if (command === "scene.delete") return approvalPending(command, id);
      if (command === "approval.cancel")
        return createCommandResponse({ id, result: { approvalId: APPROVAL_ID, status: "cancelled" } });
      if (command === "approval.await") return undefined;
      return okResponse(id, command);
    });
    const input =
      [
        JSON.stringify({ command: "scene.delete", params: { sceneId: "s1" } }),
        JSON.stringify({ command: "system.ping" })
      ].join("\n") + "\n";
    const baseline = process.listenerCount("SIGINT");
    const interrupt = (async () => {
      while (process.listenerCount("SIGINT") === baseline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      process.emit("SIGINT");
    })();

    const { lines, error } = await runExec(daemon.url, input);
    await interrupt;

    expect(lines).toHaveLength(1);
    expect(lines[0].error.code).toBe(ERROR_CODES.APPROVAL_CANCELLED);
    expect((error as CommanderError).exitCode).toBe(1);
    expect(process.listenerCount("SIGINT")).toBe(baseline);
  });

  it("fails fast within --timeout-ms when the TCP peer accepts but never completes the WS upgrade", async () => {
    const held: import("node:net").Socket[] = [];
    const server = createServer((socket) => {
      held.push(socket);
    });
    const port = await getFreePort();
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));

    try {
      const stdout = createWritableBuffer();
      const stderr = createWritableBuffer();
      const stdin = Readable.from([JSON.stringify({ command: "system.ping" }) + "\n"]) as Readable & {
        isTTY?: boolean;
      };
      const program = createProgram({
        stdout,
        stderr,
        stdin,
        configStore: createTestConfigStore()
      });
      program.exitOverride();

      let error: unknown = null;
      try {
        await program.parseAsync(
          [
            "node",
            "fvtt-world-cli",
            "--daemon-url",
            `ws://127.0.0.1:${port}`,
            "--timeout-ms",
            "50",
            "exec",
            "--stdin"
          ],
          { from: "node" }
        );
      } catch (thrown) {
        error = thrown;
      }

      expect(stdout.read()).toBe("");
      expect(error).toBeInstanceOf(CommanderError);
      const jsonPlan = planCliErrorOutput(error, true);
      const envelope = JSON.parse(jsonPlan.stdout ?? "{}") as { error?: { code?: string } };
      expect(envelope.error?.code).toBe("DAEMON_UNAVAILABLE");

      expect(jsonPlan.exitCode).toBe(3);
    } finally {
      for (const socket of held) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

const APPROVAL_ID = "BBBBBBBBBBBBBBBBBBBBBB";

function approvalPending(command: string, id = "req-1") {
  return createErrorResponse({
    id,
    error: createProtocolError({
      code: ERROR_CODES.APPROVAL_PENDING,
      message: `Command ${command} needs an approval from the GM of this bridge.`,
      details: { approvalId: APPROVAL_ID, expiresAt: Date.now() + 600_000, command }
    })
  });
}

function approvalReport(outcome: string, response?: unknown) {
  return {
    approvalId: APPROVAL_ID,
    status: "resolved",
    outcome,
    ...(response === undefined ? {} : { response })
  };
}

function deletedScene(id = "res-1") {
  return createCommandResponse({ id, result: { id: "s1" } });
}

function createApprovalSendCommand(reports: Array<Record<string, unknown>>) {
  const calls: Array<{ command: string; params: Record<string, unknown> }> = [];
  const queue = [...reports];
  const sendCommand = (async (options: { command: string; params?: Record<string, unknown> }) => {
    calls.push({ command: options.command, params: options.params ?? {} });
    if (options.command === "approval.await") {
      return createCommandResponse({ id: "poll", result: queue.shift() });
    }
    return approvalPending(options.command);
  }) as unknown as SendCommandMock;
  return { sendCommand, calls };
}

describe("fvtt-world-cli approval wait on a single command", () => {
  it("renders an allowed command exactly like a direct call", async () => {
    const direct = await runCommand(["scene", "delete", "--scene-id", "s1"], (async () =>
      deletedScene()) as unknown as SendCommandMock);
    const { sendCommand, calls } = createApprovalSendCommand([approvalReport("approved", deletedScene())]);

    const waited = await runCommand(["scene", "delete", "--scene-id", "s1"], sendCommand);

    expect(waited.error).toBeNull();
    expect(waited.stdout).toBe(direct.stdout);
    expect(calls.map((call) => call.command)).toEqual(["scene.delete", "approval.await"]);
    expect(waited.stderr).toContain("Waiting for GM approval in Foundry (command scene.delete");
  });

  it("prints exactly one envelope on stdout and the waiting notice on stderr with --json", async () => {
    const { sendCommand } = createApprovalSendCommand([approvalReport("approved", deletedScene())]);

    const result = await runCommand(["--json", "scene", "delete", "--scene-id", "s1"], sendCommand);

    expect(result.error).toBeNull();
    const envelope = JSON.parse(result.stdout) as { ok: boolean; result: { id: string } };
    expect(envelope.ok).toBe(true);
    expect(envelope.result.id).toBe("s1");
    expect(result.stderr).toContain("Press Ctrl+C to request cancellation.");
  });

  it("renders a handler error that ran after the approval as that handler error", async () => {
    const handlerError = createErrorResponse({
      id: "res-1",
      error: createProtocolError({ code: "SCENE_NOT_FOUND", message: "nope" })
    });
    const { sendCommand } = createApprovalSendCommand([approvalReport("approved", handlerError)]);

    const result = await runCommand(["scene", "delete", "--scene-id", "s1"], sendCommand);

    expect(result.stderr).toContain("SCENE_NOT_FOUND: nope");
    expect(result.stderr).not.toContain("APPROVAL_");
    expect((result.error as CommanderError).exitCode).toBe(1);
  });

  it.each([
    ["denied", ERROR_CODES.APPROVAL_DENIED],
    ["timeout", ERROR_CODES.APPROVAL_TIMEOUT],
    ["cancelled", ERROR_CODES.APPROVAL_CANCELLED]
  ])("fails with a terminal code when the approval ends as %s", async (outcome, code) => {
    const { sendCommand } = createApprovalSendCommand([approvalReport(outcome)]);

    const result = await runCommand(["scene", "delete", "--scene-id", "s1"], sendCommand);

    expect(result.stderr).toContain(`${code}: `);
    expect(result.stdout).toBe("");
    expect((result.error as CommanderError).exitCode).toBe(1);
  });

  it("keeps the module's indeterminate answer for an unknown approval", async () => {
    const unknown = createErrorResponse({
      id: "poll",
      error: createProtocolError({
        code: ERROR_CODES.APPROVAL_UNKNOWN,
        message: "no approval state for this id",
        details: { approvalId: APPROVAL_ID }
      })
    });
    const sendCommand = (async (options: { command: string }) =>
      options.command === "approval.await"
        ? unknown
        : approvalPending(options.command)) as unknown as SendCommandMock;

    const result = await runCommand(["--json", "scene", "delete", "--scene-id", "s1"], sendCommand);

    const envelope = JSON.parse(result.stdout) as { ok: boolean; error: { code: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe(ERROR_CODES.APPROVAL_UNKNOWN);
    expect((result.error as CommanderError).exitCode).toBe(1);
  });

  it("never polls for an approval when the call is a dry run", async () => {
    const calls: string[] = [];
    const sendCommand = (async (options: { command: string; params: Record<string, unknown> }) => {
      calls.push(options.command);
      return createCommandResponse({
        id: "res-1",
        result: { id: "s1", dryRun: true, approvalRequired: true }
      });
    }) as unknown as SendCommandMock;

    const result = await runCommand(["--dry-run", "scene", "delete", "--scene-id", "s1"], sendCommand);

    expect(result.error).toBeNull();
    expect(calls).toEqual(["scene.delete"]);
    expect(result.stdout).toContain("DRY RUN (not persisted):");
    expect(result.stderr).toBe("");
  });
});
