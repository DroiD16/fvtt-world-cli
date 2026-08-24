import { createServer, type Server as NetServer, type Socket as NetSocket } from "node:net";
import type { AddressInfo } from "node:net";

import {
  ERROR_CODES,
  MESSAGE_TYPES,
  PROTOCOL_COMPONENTS,
  PROTOCOL_HANDSHAKES,
  PROTOCOL_VERSION
} from "@fvtt-world-cli/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import {
  DaemonTransportError,
  connectDaemonClient,
  resetUnsafeClientTimeoutWarningForTests,
  sendCommand
} from "../src/client/send-command.js";

const LEGACY_PROTOCOL_VERSION = "3.0";

const CREDENTIAL = "a".repeat(43);

const wsServers: WebSocketServer[] = [];
const netServers: NetServer[] = [];
const rawSockets: NetSocket[] = [];

interface ScriptedServer {
  url: string;
  connections: WebSocket[];
  frames: unknown[];
}

async function startScriptedServer(onConnection: (socket: WebSocket) => void): Promise<ScriptedServer> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  wsServers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  const scripted: ScriptedServer = {
    url: `ws://127.0.0.1:${address.port}`,
    connections: [],
    frames: []
  };
  server.on("connection", (socket) => {
    scripted.connections.push(socket);
    socket.on("message", (data) => scripted.frames.push(JSON.parse(data.toString())));
    onConnection(socket);
  });
  return scripted;
}

async function startDeafServer(onConnection: (socket: NetSocket) => void = () => {}) {
  const server = createServer((socket) => {
    rawSockets.push(socket);
    socket.on("error", () => {});
    onConnection(socket);
  });
  netServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { url: `ws://127.0.0.1:${address.port}` };
}

async function unusedUrl() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `ws://127.0.0.1:${address.port}`;
}

function afterHello(socket: WebSocket, reply: (hello: Record<string, unknown>) => void) {
  socket.once("message", (data) => reply(JSON.parse(data.toString())));
}

function helloAck(body: Record<string, unknown>) {
  return JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.CLIENT_HELLO_ACK,
    ...body
  });
}

function commandResponse(id: string, result: Record<string, unknown> = {}) {
  return JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.COMMAND_RESPONSE,
    id,
    ok: true,
    result
  });
}

function bridgeGoodbye() {
  return JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: MESSAGE_TYPES.BRIDGE_GOODBYE });
}

function acceptThen(socket: WebSocket, script: (request: Record<string, unknown>) => void) {
  afterHello(socket, () => {
    socket.send(helloAck({ ok: true }));
    socket.once("message", (data) => script(JSON.parse(data.toString())));
  });
}

async function closedOnServer(socket: WebSocket) {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }
  await new Promise<void>((resolve) => socket.once("close", () => resolve()));
}

async function expectTransportRejection(promise: Promise<unknown>) {
  const error = await promise.then(
    (value) => {
      throw new Error(`Expected a rejection, received ${JSON.stringify(value)}`);
    },
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(DaemonTransportError);
  return error as DaemonTransportError;
}

let stderr: string[] = [];

beforeEach(() => {
  resetUnsafeClientTimeoutWarningForTests();
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of rawSockets.splice(0)) socket.destroy();
  for (const server of wsServers.splice(0)) {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const server of netServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("one-shot sendCommand transport", () => {
  it("resolves a matching command response after the hello handshake", async () => {
    const server = await startScriptedServer((socket) => {
      acceptThen(socket, (request) => socket.send(commandResponse(String(request.id), { pong: true })));
    });

    const envelope = await sendCommand({
      daemonUrl: server.url,
      deviceCredential: CREDENTIAL,
      command: "system.ping",
      params: {},
      timeoutMs: 2_000
    });

    expect(envelope).toMatchObject({
      type: MESSAGE_TYPES.COMMAND_RESPONSE,
      ok: true,
      result: { pong: true }
    });
    expect(server.frames[0]).toMatchObject({
      type: MESSAGE_TYPES.CLIENT_HELLO,
      credential: CREDENTIAL,
      client: "cli"
    });
    expect(server.frames[1]).toMatchObject({
      type: MESSAGE_TYPES.COMMAND_REQUEST,
      command: "system.ping",
      params: {}
    });
    expect((server.frames[1] as { id: string }).id).toBe((envelope as { id: string }).id);
    await closedOnServer(server.connections[0]);
    expect(server.connections[0].readyState).toBe(WebSocket.CLOSED);
  });

  it("resolves a local INVALID_PARAMS envelope without opening a socket when validation fails", async () => {
    const server = await startScriptedServer(() => {});

    const envelope = await sendCommand({
      daemonUrl: server.url,
      deviceCredential: CREDENTIAL,
      command: "actor.get",
      params: {},
      timeoutMs: 2_000
    });

    expect(envelope).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      type: MESSAGE_TYPES.COMMAND_RESPONSE,
      ok: false,
      error: { code: ERROR_CODES.INVALID_PARAMS, message: "Invalid params for actor.get" }
    });
    expect((envelope.error?.details as { errors: string[] }).errors).toContain(
      "$.params.actorId is required"
    );
    expect(server.connections).toHaveLength(0);
  });

  it("warns once on stderr when the client timeout is not below the daemon forward timeout", async () => {
    const server = await startScriptedServer((socket) => {
      acceptThen(socket, (request) => socket.send(commandResponse(String(request.id))));
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await sendCommand({
        daemonUrl: server.url,
        deviceCredential: CREDENTIAL,
        command: "system.ping",
        timeoutMs: 200_000
      });
    }

    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain("--timeout-ms (200000)");
  });

  describe("hello-ack phase", () => {
    it("rejects with the daemon's own error when the hello ack reports failure", async () => {
      const server = await startScriptedServer((socket) => {
        afterHello(socket, () =>
          socket.send(
            helloAck({
              ok: false,
              error: {
                code: ERROR_CODES.UNAUTHORIZED,
                message: "Unknown client credential",
                details: { reason: "unpaired" }
              }
            })
          )
        );
      });

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000
        })
      );

      expect(error.code).toBe(ERROR_CODES.UNAUTHORIZED);
      expect(error.message).toBe("Unknown client credential");
      expect(error.details).toEqual({ reason: "unpaired" });
    });

    it("omits details when a failing hello ack carries none", async () => {
      const server = await startScriptedServer((socket) => {
        afterHello(socket, () =>
          socket.send(
            helloAck({ ok: false, error: { code: ERROR_CODES.UNAUTHORIZED, message: "Pair this client" } })
          )
        );
      });

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000
        })
      );

      expect(error.code).toBe(ERROR_CODES.UNAUTHORIZED);
      expect(error.message).toBe("Pair this client");
      expect(error.details).toBeUndefined();
    });

    it("rejects a failing hello ack that omits its error as an invalid transport message", async () => {
      const server = await startScriptedServer((socket) => {
        afterHello(socket, () => socket.send(helloAck({ ok: false })));
      });

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000
        })
      );

      expect(error.code).toBe(ERROR_CODES.INVALID_MESSAGE);
      expect(error.details?.reason).toBe("invalid_message");
      expect(error.details?.errors).toContain("$.error is required when $.ok is false");
    });

    it("names the version skew when a daemon from another release answers the hello", async () => {
      const server = await startScriptedServer((socket) => {
        afterHello(socket, () =>
          socket.send(
            JSON.stringify({
              protocolVersion: LEGACY_PROTOCOL_VERSION,
              type: MESSAGE_TYPES.CLIENT_HELLO_ACK,
              ok: false,
              error: {
                code: ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION,
                message: `Unsupported protocol version: ${PROTOCOL_VERSION}`,
                details: {}
              }
            })
          )
        );
      });

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000
        })
      );

      expect(error.code).toBe(ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION);
      expect(error.details).toEqual({
        expectedVersion: PROTOCOL_VERSION,
        actualVersion: LEGACY_PROTOCOL_VERSION,
        staleComponent: PROTOCOL_COMPONENTS.CLI_DAEMON,
        handshake: PROTOCOL_HANDSHAKES.CLI_DAEMON
      });
      expect(error.message).toContain("restart the daemon");
    });

    it("names the version skew on a persistent connection too", async () => {
      const server = await startScriptedServer((socket) => {
        afterHello(socket, () =>
          socket.send(
            JSON.stringify({
              protocolVersion: LEGACY_PROTOCOL_VERSION,
              type: MESSAGE_TYPES.CLIENT_HELLO_ACK,
              ok: false,
              error: {
                code: ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION,
                message: `Unsupported protocol version: ${PROTOCOL_VERSION}`,
                details: {}
              }
            })
          )
        );
      });

      const error = await expectTransportRejection(
        connectDaemonClient({ daemonUrl: server.url, deviceCredential: CREDENTIAL, timeoutMs: 2_000 })
      );

      expect(error.code).toBe(ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION);
      expect(error.details).toMatchObject({
        actualVersion: LEGACY_PROTOCOL_VERSION,
        staleComponent: PROTOCOL_COMPONENTS.CLI_DAEMON
      });
    });

    it("rejects a malformed hello ack as an invalid transport message", async () => {
      const server = await startScriptedServer((socket) => {
        afterHello(socket, () => socket.send(helloAck({})));
      });

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000
        })
      );

      expect(error.code).toBe(ERROR_CODES.INVALID_MESSAGE);
      expect(error.message).toBe("Daemon returned an invalid transport message");
      expect(error.details?.reason).toBe("invalid_message");
      expect(error.details?.errors).toContain("$.ok is required");
    });

    it("rejects an invalid JSON frame received before the hello ack", async () => {
      const server = await startScriptedServer((socket) => {
        afterHello(socket, () => socket.send("{not json"));
      });

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000
        })
      );

      expect(error.code).toBe(ERROR_CODES.INVALID_MESSAGE);
      expect(error.details?.reason).toBe("invalid_json");
    });

    it("rejects an unknown message type received before the hello ack", async () => {
      const server = await startScriptedServer((socket) => {
        afterHello(socket, () =>
          socket.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: "daemon.gossip" }))
        );
      });

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000
        })
      );

      expect(error.code).toBe(ERROR_CODES.INVALID_MESSAGE);
      expect(error.details?.reason).toBe("invalid_message");
      expect(String((error.details?.errors as string[])[0])).toContain("$.type must be one of");
    });

    it("rejects a well-formed non-response frame received before the hello ack", async () => {
      const server = await startScriptedServer((socket) => {
        afterHello(socket, () => socket.send(bridgeGoodbye()));
      });

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000
        })
      );

      expect(error.code).toBe(ERROR_CODES.INVALID_MESSAGE);
      expect(error.message).toBe("Daemon returned an unexpected message type");
      expect(error.details?.reason).toBe("unexpected_type");
    });
  });

  describe("response phase", () => {
    it("rejects an invalid JSON frame received after the hello ack", async () => {
      const server = await startScriptedServer((socket) => {
        acceptThen(socket, () => socket.send("{not json"));
      });

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000
        })
      );

      expect(error.code).toBe(ERROR_CODES.INVALID_MESSAGE);
      expect(error.details?.reason).toBe("invalid_json");
    });

    it("rejects an invalid transport message received after the hello ack", async () => {
      const server = await startScriptedServer((socket) => {
        acceptThen(socket, (request) =>
          socket.send(
            JSON.stringify({
              protocolVersion: PROTOCOL_VERSION,
              type: MESSAGE_TYPES.COMMAND_RESPONSE,
              id: request.id
            })
          )
        );
      });

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000
        })
      );

      expect(error.code).toBe(ERROR_CODES.INVALID_MESSAGE);
      expect(error.details?.reason).toBe("invalid_message");
      expect(error.details?.errors).toContain("$.ok is required");
    });

    it("rejects an unexpected message type after the hello ack even though nothing addresses the request", async () => {
      const server = await startScriptedServer((socket) => {
        acceptThen(socket, () => socket.send(bridgeGoodbye()));
      });

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000
        })
      );

      expect(error.code).toBe(ERROR_CODES.INVALID_MESSAGE);
      expect(error.details?.reason).toBe("unexpected_type");
    });

    it("ignores a response carrying another request id and keeps waiting for its own", async () => {
      const server = await startScriptedServer((socket) => {
        acceptThen(socket, (request) => {
          socket.send(commandResponse("some-other-request", { stray: true }));
          setTimeout(() => socket.send(commandResponse(String(request.id), { mine: true })), 20);
        });
      });

      const envelope = await sendCommand({
        daemonUrl: server.url,
        deviceCredential: CREDENTIAL,
        command: "system.ping",
        timeoutMs: 2_000
      });

      expect(envelope).toMatchObject({ ok: true, result: { mine: true } });
      expect(envelope.id).toBe((server.frames[1] as { id: string }).id);
    });
  });

  describe("socket close and error", () => {
    it("rejects when the daemon closes the connection after the hello ack", async () => {
      const server = await startScriptedServer((socket) => {
        acceptThen(socket, () => socket.close(1011, "daemon exploded"));
      });

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000
        })
      );

      expect(error.code).toBe(ERROR_CODES.DAEMON_UNAVAILABLE);
      expect(error.message).toBe("Daemon connection closed (1011): daemon exploded");
      expect(error.details).toEqual({ reason: "closed", closeCode: 1011 });
    });

    it("reports a close with no reason phrase", async () => {
      const server = await startScriptedServer((socket) => {
        acceptThen(socket, () => socket.close(1000));
      });

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000
        })
      );

      expect(error.message).toBe("Daemon connection closed (1000): no reason");
      expect(error.details).toEqual({ reason: "closed", closeCode: 1000 });
    });

    it("rejects with connect_error when nothing is listening on the daemon URL", async () => {
      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: await unusedUrl(),
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000
        })
      );

      expect(error.code).toBe(ERROR_CODES.DAEMON_UNAVAILABLE);
      expect(error.details).toEqual({ reason: "connect_error" });
    });

    it("rejects with connect_error when the daemon drops the connection during the handshake", async () => {
      const server = await startDeafServer((socket) => socket.destroy());

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000
        })
      );

      expect(error.code).toBe(ERROR_CODES.DAEMON_UNAVAILABLE);
      expect(error.details).toEqual({ reason: "connect_error" });
    });

    it("reports a socket error raised after open but before the hello ack as closed", async () => {
      const server = await startScriptedServer((socket) => {
        afterHello(socket, () => socket.send("x".repeat(4096)));
      });

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000,
          maxPayloadBytes: 1024
        })
      );

      expect(error.code).toBe(ERROR_CODES.DAEMON_UNAVAILABLE);
      expect(error.details).toEqual({ reason: "closed" });
    });

    it("reports a socket error raised after the hello ack as closed", async () => {
      const server = await startScriptedServer((socket) => {
        acceptThen(socket, () => socket.send("x".repeat(4096)));
      });

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 2_000,
          maxPayloadBytes: 1024
        })
      );

      expect(error.code).toBe(ERROR_CODES.DAEMON_UNAVAILABLE);
      expect(error.details).toEqual({ reason: "closed" });
    });
  });

  describe("timeout budget", () => {
    it("times out with the response-wait message when the handshake never completes", async () => {
      const server = await startDeafServer();
      const startedAt = Date.now();

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 500
        })
      );

      expect(error.code).toBe(ERROR_CODES.DAEMON_UNAVAILABLE);
      expect(error.message).toBe("Timed out waiting for daemon response to system.ping after 500ms");
      expect(error.details).toEqual({ reason: "timeout", command: "system.ping", timeoutMs: 500 });
      expect(Date.now() - startedAt).toBeLessThan(900);
    });

    it("spends one timeout budget across connect, hello, and the response wait", async () => {
      const server = await startScriptedServer((socket) => {
        afterHello(socket, () => setTimeout(() => socket.send(helloAck({ ok: true })), 300));
      });
      const startedAt = Date.now();

      const error = await expectTransportRejection(
        sendCommand({
          daemonUrl: server.url,
          deviceCredential: CREDENTIAL,
          command: "system.ping",
          timeoutMs: 500
        })
      );

      expect(error.message).toBe("Timed out waiting for daemon response to system.ping after 500ms");
      expect(error.details).toEqual({ reason: "timeout", command: "system.ping", timeoutMs: 500 });
      expect(server.frames[1]).toMatchObject({ type: MESSAGE_TYPES.COMMAND_REQUEST });
      expect(Date.now() - startedAt).toBeLessThan(700);
    });
  });
});

describe("persistent daemon client transport", () => {
  it("resolves a control request from the daemon.response frame the daemon replies with", async () => {
    const server = await startScriptedServer((socket) => {
      acceptThen(socket, (request) =>
        socket.send(
          JSON.stringify({
            protocolVersion: PROTOCOL_VERSION,
            type: MESSAGE_TYPES.DAEMON_RESPONSE,
            id: String(request.id),
            operation: String(request.operation),
            ok: true,
            result: { pairings: [] }
          })
        )
      );
    });

    const client = await connectDaemonClient({
      daemonUrl: server.url,
      deviceCredential: CREDENTIAL,
      timeoutMs: 2_000
    });

    try {
      const envelope = await client.requestControl({ operation: "auth.list", timeoutMs: 2_000 });

      expect(envelope).toMatchObject({
        type: MESSAGE_TYPES.DAEMON_RESPONSE,
        ok: true,
        result: { pairings: [] }
      });
      expect(server.frames[1]).toMatchObject({
        type: MESSAGE_TYPES.DAEMON_REQUEST,
        operation: "auth.list"
      });
    } finally {
      await client.close();
    }
  });

  it("resolves a command request from the command.response frame the daemon relays", async () => {
    const server = await startScriptedServer((socket) => {
      acceptThen(socket, (request) => socket.send(commandResponse(String(request.id), { pong: true })));
    });

    const client = await connectDaemonClient({
      daemonUrl: server.url,
      deviceCredential: CREDENTIAL,
      timeoutMs: 2_000
    });

    try {
      const envelope = await client.send({ command: "system.ping", timeoutMs: 2_000 });

      expect(envelope).toMatchObject({
        type: MESSAGE_TYPES.COMMAND_RESPONSE,
        ok: true,
        result: { pong: true }
      });
    } finally {
      await client.close();
    }
  });
});
