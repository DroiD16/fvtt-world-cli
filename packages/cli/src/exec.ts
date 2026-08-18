import { createInterface } from "node:readline";

import { ERROR_CODES, isWriteCommand } from "@fvtt-world-cli/protocol";
import { Command, CommanderError } from "commander";

import type { CommandResponseEnvelope } from "./transport-util.js";
import { connectDaemonClient } from "./client/send-command.js";
import { clientMaxPayloadOption, getCommandConfig } from "./config-io.js";
import { type CliDependencies, write } from "./deps.js";
import {
  ExecConnectError,
  exitCodeForErrorCode,
  localErrorEnvelope,
  toTransportErrorEnvelope
} from "./errors.js";
import { humanizeCommandResult } from "./render/registry.js";

const TRANSPORT_DETAIL_REASONS = new Set([
  "timeout",
  "disconnected",
  "invalid_json",
  "unexpected_type",
  "closed",
  "connect_error"
]);

function normalizeTransportMessage(message: string): string {
  if (/ECONNREFUSED/.test(message)) {
    return "Could not connect to the daemon (connection refused). Is `fvtt-world-cli bridge serve` running?";
  }
  if (/ETIMEDOUT/.test(message)) {
    return "Could not connect to the daemon (connection timed out).";
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) {
    return "Could not resolve the daemon host.";
  }
  if (/ECONNRESET/.test(message)) {
    return "The daemon connection was reset.";
  }
  return message;
}

function renderProtocolError(error: any) {
  const code = error?.code ?? "UNKNOWN_ERROR";
  const message = normalizeTransportMessage(String(error?.message ?? "Unknown error"));
  const reason = error?.details?.reason;
  const showDetails =
    Boolean(error?.details) && !(typeof reason === "string" && TRANSPORT_DETAIL_REASONS.has(reason));
  const details = showDetails ? `\n${JSON.stringify(error.details, null, 2)}` : "";
  return `${code}: ${message}${details}`;
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

async function processExecLine(
  client: {
    send: (o: {
      command: string;
      params?: Record<string, unknown>;
      timeoutMs?: number;
    }) => Promise<CommandResponseEnvelope>;
  },
  rawLine: string,
  timeoutMs: number | undefined,
  dryRun: boolean
): Promise<{ id?: string; envelope: CommandResponseEnvelope }> {
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

  try {
    const envelope = await client.send({
      command: obj.command,
      params: requestParams,
      ...(typeof timeoutMs === "number" ? { timeoutMs } : {})
    });
    return { id: callerId, envelope };
  } catch (error) {
    return { id: callerId, envelope: toTransportErrorEnvelope(error) };
  }
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

  let client: Awaited<ReturnType<typeof connectDaemonClient>>;
  try {
    client = await connectDaemonClient({
      daemonUrl: clientConfig.daemonUrl,
      deviceCredential: clientConfig.deviceCredential,
      ...clientMaxPayloadOption(dependencies),
      ...(typeof timeoutMs === "number" ? { timeoutMs } : {})
    });
  } catch (error) {
    throw new ExecConnectError(toTransportErrorEnvelope(error));
  }

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

      const { id, envelope } = await processExecLine(client, rawLine, timeoutMs, dryRun);

      const outputLine = { ...envelope, index: currentIndex, ...(id !== undefined ? { id } : {}) };
      write(dependencies.stdout, `${JSON.stringify(outputLine)}\n`);

      if (!envelope.ok) {
        anyFailed = true;
        if (stopOnError) {
          break;
        }
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
