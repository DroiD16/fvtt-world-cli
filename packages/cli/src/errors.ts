import { ERROR_CODES, MESSAGE_TYPES, PROTOCOL_VERSION } from "@fvtt-world-cli/protocol";
import { CommanderError } from "commander";
import { z } from "zod";

import type { CommandResponseEnvelope } from "./transport-util.js";
import { DaemonTransportError } from "./client/send-command.js";
import { CliConfigError } from "./config.js";

const CLI_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  MISSING_REQUIRED_OPTION: "MISSING_REQUIRED_OPTION",
  UNKNOWN_OPTION: "UNKNOWN_OPTION",
  INVALID_CONFIGURATION: "INVALID_CONFIGURATION",

  LOCAL_FILE_ERROR: "LOCAL_FILE_ERROR",
  PAIRING_DECLINED: "PAIRING_DECLINED",
  PAIRING_PROMPT_ABORTED: "PAIRING_PROMPT_ABORTED"
});

const EXIT_CODES = Object.freeze({
  OK: 0, // success
  FAILURE: 1, // a valid command ran (or was forwarded) and returned an error
  USAGE: 2, // bad invocation: unknown/missing option, invalid config
  UNAVAILABLE: 3
});

export function exitCodeForErrorCode(code: string | undefined): number {
  switch (code) {
    case CLI_ERROR_CODES.INVALID_ARGUMENT:
    case CLI_ERROR_CODES.MISSING_REQUIRED_OPTION:
    case CLI_ERROR_CODES.UNKNOWN_OPTION:
    case CLI_ERROR_CODES.INVALID_CONFIGURATION:
      return EXIT_CODES.USAGE;
    case ERROR_CODES.DAEMON_UNAVAILABLE:
    case ERROR_CODES.UNAUTHORIZED:
      return EXIT_CODES.UNAVAILABLE;
    default:
      return EXIT_CODES.FAILURE;
  }
}

export class LocalPayloadTooLargeError extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = "LocalPayloadTooLargeError";
    this.details = details;
  }
}

export class ExecConnectError extends CommanderError {
  readonly transportCode: string;
  readonly transportDetails?: Record<string, unknown>;

  constructor(envelope: CommandResponseEnvelope) {
    super(
      1,
      "fvtt-world-cli.execConnectFailed",
      `Could not open a daemon connection for exec: ${envelope.error?.message ?? "unknown error"}`
    );
    this.name = "ExecConnectError";
    this.transportCode = envelope.error?.code ?? ERROR_CODES.INTERNAL_ERROR;
    this.transportDetails = envelope.error?.details;
  }
}

export function localErrorEnvelope(
  code: string,
  message: string,
  details?: Record<string, unknown>
): CommandResponseEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.COMMAND_RESPONSE,
    id: "",
    ok: false,
    error: { code, message, ...(details ? { details } : {}) }
  };
}

export function localSuccessEnvelope(result: unknown): CommandResponseEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: MESSAGE_TYPES.COMMAND_RESPONSE,
    id: "",
    ok: true,
    result
  };
}

export function toTransportErrorEnvelope(error: unknown): CommandResponseEnvelope {
  if (error instanceof DaemonTransportError) {
    return localErrorEnvelope(error.code, error.message, error.details);
  }

  return localErrorEnvelope(
    ERROR_CODES.INTERNAL_ERROR,
    error instanceof Error ? error.message : String(error)
  );
}

export function planLocalError(
  error: unknown
): { code: string; message: string; details?: Record<string, unknown> } | null {
  if (error instanceof ExecConnectError) {
    return {
      code: error.transportCode,
      message: error.message.replace(/^error:\s+/i, ""),
      ...(error.transportDetails ? { details: error.transportDetails } : {})
    };
  }

  if (error instanceof DaemonTransportError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {})
    };
  }

  if (error instanceof CommanderError) {
    const code = error.code ?? "";

    if (
      code === "commander.helpDisplayed" ||
      (code === "commander.help" && (error.exitCode ?? 1) === 0) ||
      code === "commander.version" ||
      code === "fvtt-world-cli.remoteError"
    ) {
      return null;
    }

    if (code === "commander.help") {
      return {
        code: CLI_ERROR_CODES.INVALID_ARGUMENT,
        message: "No runnable command resolved; run with --help for usage.",
        details: { commanderCode: code }
      };
    }

    let mapped: string = CLI_ERROR_CODES.INVALID_ARGUMENT;
    if (/missingMandatory|missingRequired|optionMissing|missingArgument/i.test(code)) {
      mapped = CLI_ERROR_CODES.MISSING_REQUIRED_OPTION;
    } else if (/unknownOption/i.test(code)) {
      mapped = CLI_ERROR_CODES.UNKNOWN_OPTION;
    } else if (
      code === "fvtt-world-cli.localFileReadError" ||
      code === "fvtt-world-cli.commandFileReadError"
    ) {
      mapped = CLI_ERROR_CODES.LOCAL_FILE_ERROR;
    } else if (
      code === "fvtt-world-cli.approvalPendingUnavailable" ||
      code === "fvtt-world-cli.pairingWaitUnavailable" ||
      code === "fvtt-world-cli.pruneCandidatesUnavailable"
    ) {
      mapped = ERROR_CODES.INTERNAL_ERROR;
    } else if (
      code === "fvtt-world-cli.pairingDeclined" ||
      code === "fvtt-world-cli.approvalDenied" ||
      code === "fvtt-world-cli.pruneDeclined"
    ) {
      mapped = CLI_ERROR_CODES.PAIRING_DECLINED;
    } else if (code === "fvtt-world-cli.pairingPromptAborted") {
      mapped = CLI_ERROR_CODES.PAIRING_PROMPT_ABORTED;
    }

    const message = error.message.replace(/^error:\s+/i, "");
    return { code: mapped, message, details: { commanderCode: code } };
  }

  if (error instanceof LocalPayloadTooLargeError) {
    return { code: ERROR_CODES.PAYLOAD_TOO_LARGE, message: error.message, details: error.details };
  }

  if (error instanceof CliConfigError) {
    return { code: CLI_ERROR_CODES.INVALID_CONFIGURATION, message: error.message };
  }

  if (error instanceof z.ZodError) {
    return {
      code: CLI_ERROR_CODES.INVALID_CONFIGURATION,
      message: error.issues[0]?.message ?? "Invalid CLI configuration"
    };
  }

  return {
    code: ERROR_CODES.INTERNAL_ERROR,
    message: error instanceof Error ? error.message : String(error)
  };
}

export function planCliErrorOutput(
  error: unknown,
  jsonMode: boolean,
  options: { commanderAlreadyPrinted?: boolean } = {}
): { exitCode: number; stdout?: string; stderr?: string } {
  const commanderAlreadyPrinted = options.commanderAlreadyPrinted ?? true;
  const plan = planLocalError(error);

  const exitCode = plan
    ? exitCodeForErrorCode(plan.code)
    : error instanceof CommanderError
      ? (error.exitCode ?? 1)
      : 1;
  if (!plan) {
    return { exitCode };
  }

  if (jsonMode) {
    return {
      exitCode,
      stdout: `${JSON.stringify(localErrorEnvelope(plan.code, plan.message, plan.details), null, 2)}\n`
    };
  }

  const commanderPrinted = error instanceof CommanderError && commanderAlreadyPrinted;
  if (!commanderPrinted) {
    return { exitCode, stderr: `${plan.code}: ${plan.message}\n` };
  }

  return { exitCode };
}
