import { createInterface } from "node:readline";

import { ERROR_CODES, isWriteCommand } from "@fvtt-world-cli/protocol";
import { Command, CommanderError } from "commander";

import type { CommandResponseEnvelope } from "./transport-util.js";
import { awaitApprovalOutcome } from "./approval-wait.js";
import { connectDaemonClient, type PersistentDaemonClient } from "./client/send-command.js";
import { clientMaxPayloadOption, getCommandConfig } from "./config-io.js";
import { type CliDependencies, write } from "./deps.js";
import {
  ExecConnectError,
  exitCodeForErrorCode,
  localErrorEnvelope,
  renderProtocolError,
  toTransportErrorEnvelope
} from "./errors.js";
import { humanizeCommandResult } from "./render/registry.js";

function isApprovalPending(response: CommandResponseEnvelope) {
  return !response.ok && response.error?.code === ERROR_CODES.APPROVAL_PENDING;
}

export async function executeRemoteCommand({
  commandName,
  params,
  command,
  dependencies
}: {
  commandName: string;
  params: Record<string, unknown>;
  command: Command;
  dependencies: CliDependencies;
}) {
  const clientConfig = getCommandConfig(command, dependencies);
  const globalOptions = command.optsWithGlobals();
  const outputJson = Boolean(globalOptions.json);

  const withDryRun =
    Boolean(globalOptions.dryRun) && isWriteCommand(commandName) ? { ...params, dryRun: true } : params;

  const idempotencyKey = (command.opts() as { idempotencyKey?: string }).idempotencyKey;
  const requestParams = typeof idempotencyKey === "string" ? { ...withDryRun, idempotencyKey } : withDryRun;

  const timeoutMs = (globalOptions as { timeoutMs?: number }).timeoutMs;

  let response: CommandResponseEnvelope;
  try {
    response = await dependencies.sendCommand({
      daemonUrl: clientConfig.daemonUrl,
      deviceCredential: clientConfig.deviceCredential,
      command: commandName,
      params: requestParams,
      ...clientMaxPayloadOption(dependencies),
      ...(typeof timeoutMs === "number" ? { timeoutMs } : {})
    });
  } catch (error) {
    response = toTransportErrorEnvelope(error);
  }

  if (isApprovalPending(response)) {
    response = await awaitApprovalOutcome({
      pendingResponse: response,
      send: ({ command: awaitCommand, params: awaitParams, timeoutMs: awaitTimeoutMs }) =>
        dependencies.sendCommand({
          daemonUrl: clientConfig.daemonUrl,
          deviceCredential: clientConfig.deviceCredential,
          command: awaitCommand,
          params: awaitParams,
          ...clientMaxPayloadOption(dependencies),
          timeoutMs: awaitTimeoutMs
        }),
      stderr: dependencies.stderr,
      ...(typeof timeoutMs === "number" ? { timeoutMs } : {})
    });
  }

  if (outputJson) {
    write(dependencies.stdout, `${JSON.stringify(response, null, 2)}\n`);
  } else if (response.ok) {
    const requestOffset = typeof requestParams.offset === "number" ? requestParams.offset : 0;
    const humanOutput = humanizeCommandResult(commandName, response.result, requestOffset);

    const prefixed =
      (response.result as { dryRun?: unknown })?.dryRun === true
        ? `DRY RUN (not persisted):\n${humanOutput}`
        : humanOutput;
    write(dependencies.stdout, `${prefixed}\n`);
  } else {
    write(dependencies.stderr, `${renderProtocolError(response.error)}\n`);
  }

  if (!response.ok) {
    throw new CommanderError(
      exitCodeForErrorCode(response.error?.code),
      "fvtt-world-cli.remoteError",
      response.error?.message ?? "Remote command failed"
    );
  }
}

interface ExecBatchSession {
  send: (o: {
    command: string;
    params?: Record<string, unknown>;
    timeoutMs?: number;
  }) => Promise<CommandResponseEnvelope>;
  reconnect: () => Promise<void>;
  stderr: CliDependencies["stderr"];
  timeoutMs?: number;
  onCancelRequested: () => void;
}

async function processExecLine(
  session: ExecBatchSession,
  rawLine: string,
  dryRun: boolean
): Promise<{ id?: string; envelope: CommandResponseEnvelope }> {
  const timeoutMs = session.timeoutMs;
  let parsedLine: unknown;
  try {
    parsedLine = JSON.parse(rawLine);
  } catch (error) {
    return {
      envelope: localErrorEnvelope(
        ERROR_CODES.INVALID_MESSAGE,
        `Input line is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      )
    };
  }

  if (typeof parsedLine !== "object" || parsedLine === null || Array.isArray(parsedLine)) {
    return {
      envelope: localErrorEnvelope(
        ERROR_CODES.INVALID_MESSAGE,
        "Input line must be a JSON object with a `command`"
      )
    };
  }

  const obj = parsedLine as Record<string, unknown>;
  if (obj.id !== undefined && typeof obj.id !== "string") {
    return {
      envelope: localErrorEnvelope(ERROR_CODES.INVALID_PARAMS, "Request `id` must be a string when present")
    };
  }
  const callerId = typeof obj.id === "string" ? obj.id : undefined;

  if (typeof obj.command !== "string") {
    return {
      id: callerId,
      envelope: localErrorEnvelope(ERROR_CODES.INVALID_PARAMS, "Request must include a string `command`")
    };
  }

  const params = obj.params === undefined ? {} : obj.params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return {
      id: callerId,
      envelope: localErrorEnvelope(
        ERROR_CODES.INVALID_PARAMS,
        "Request `params` must be an object when present"
      )
    };
  }

  const requestParams =
    dryRun && isWriteCommand(obj.command)
      ? { ...(params as Record<string, unknown>), dryRun: true }
      : (params as Record<string, unknown>);

  let envelope: CommandResponseEnvelope;
  try {
    envelope = await session.send({
      command: obj.command,
      params: requestParams,
      ...(typeof timeoutMs === "number" ? { timeoutMs } : {})
    });
  } catch (error) {
    return { id: callerId, envelope: toTransportErrorEnvelope(error) };
  }

  if (!isApprovalPending(envelope)) {
    return { id: callerId, envelope };
  }

  return {
    id: callerId,
    envelope: await awaitApprovalOutcome({
      pendingResponse: envelope,
      send: (request) => session.send(request),
      reconnect: session.reconnect,
      onCancelRequested: session.onCancelRequested,
      stderr: session.stderr,
      ...(typeof timeoutMs === "number" ? { timeoutMs } : {})
    })
  };
}

export async function runExecBatch({
  command,
  dependencies
}: {
  command: Command;
  dependencies: CliDependencies;
}) {
  const stdin = dependencies.stdin;

  if (stdin.isTTY) {
    throw new CommanderError(
      1,
      "fvtt-world-cli.execNoStdin",
      "exec --stdin requires NDJSON piped on stdin; refusing to read from an interactive terminal."
    );
  }

  const clientConfig = getCommandConfig(command, dependencies);
  const globalOptions = command.optsWithGlobals() as { timeoutMs?: number; dryRun?: boolean };
  const timeoutMs = typeof globalOptions.timeoutMs === "number" ? globalOptions.timeoutMs : undefined;
  const dryRun = Boolean(globalOptions.dryRun);
  const stopOnError = Boolean((command.opts() as { stopOnError?: boolean }).stopOnError);

  const connectOptions = {
    daemonUrl: clientConfig.daemonUrl,
    deviceCredential: clientConfig.deviceCredential,
    ...clientMaxPayloadOption(dependencies),
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {})
  };

  let client: PersistentDaemonClient;
  try {
    client = await connectDaemonClient(connectOptions);
  } catch (error) {
    throw new ExecConnectError(toTransportErrorEnvelope(error));
  }

  let cancelRequested = false;
  const session: ExecBatchSession = {
    send: (request) => client.send(request),
    reconnect: async () => {
      const replaced = client;
      client = await connectDaemonClient(connectOptions);
      await replaced.close().catch(() => {});
    },
    stderr: dependencies.stderr,
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
    onCancelRequested: () => {
      cancelRequested = true;
    }
  };

  const rl = createInterface({ input: stdin, crlfDelay: Infinity });
  let anyFailed = false;
  let index = 0;

  try {
    for await (const rawLine of rl) {
      const currentIndex = index;
      index += 1;

      if (rawLine.trim() === "") {
        continue;
      }

      const { id, envelope } = await processExecLine(session, rawLine, dryRun);

      const outputLine = { ...envelope, index: currentIndex, ...(id !== undefined ? { id } : {}) };
      write(dependencies.stdout, `${JSON.stringify(outputLine)}\n`);

      if (!envelope.ok) {
        anyFailed = true;
        if (stopOnError) {
          break;
        }
      }

      if (cancelRequested) {
        anyFailed = true;
        break;
      }
    }
  } finally {
    rl.close();

    (stdin as Partial<{ destroy: () => void }>).destroy?.();
    await client.close();
  }

  if (anyFailed) {
    throw new CommanderError(1, "fvtt-world-cli.remoteError", "One or more batch requests failed");
  }
}
