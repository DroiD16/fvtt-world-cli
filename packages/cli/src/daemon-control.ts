import { Command, CommanderError } from "commander";

import { connectDaemonClient } from "./client/send-command.js";
import { clientMaxPayloadOption, getCommandConfig } from "./config-io.js";
import { type CliDependencies, write } from "./deps.js";
import { exitCodeForErrorCode } from "./errors.js";

function clientTimeoutOption(command: Command) {
  const { timeoutMs } = command.optsWithGlobals() as { timeoutMs?: number };
  return typeof timeoutMs === "number" ? { timeoutMs } : {};
}

export async function requestDaemonControl(
  dependencies: CliDependencies,
  command: Command,
  operation: string,
  params: Record<string, unknown> = {}
) {
  const clientConfig = getCommandConfig(command, dependencies);
  const clientTimeout = clientTimeoutOption(command);
  const client = await connectDaemonClient({
    daemonUrl: clientConfig.daemonUrl,
    deviceCredential: clientConfig.deviceCredential,
    ...clientMaxPayloadOption(dependencies),
    ...clientTimeout
  });
  try {
    return await client.requestControl({ operation, params, ...clientTimeout });
  } finally {
    await client.close();
  }
}

export function createDaemonControlRunner(dependencies: CliDependencies) {
  async function runDaemonControl(command: Command, operation: string, params: Record<string, unknown> = {}) {
    const response = await requestDaemonControl(dependencies, command, operation, params);
    if (Boolean(command.optsWithGlobals().json))
      write(dependencies.stdout, `${JSON.stringify(response, null, 2)}\n`);
    else if (response.ok) write(dependencies.stdout, `${JSON.stringify(response.result, null, 2)}\n`);
    else
      throw new CommanderError(
        exitCodeForErrorCode(response.error?.code),
        "fvtt-world-cli.remoteError",
        response.error?.message ?? "Daemon control request failed"
      );
  }

  return runDaemonControl;
}
