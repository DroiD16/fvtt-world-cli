import { createInterface } from "node:readline";

import {
  AUTH_AWAIT_PARK_CAP_MS,
  AUTH_PRUNE_DEFAULT_DAYS,
  ERROR_CODES,
  pairingPruneCutoffAt
} from "@fvtt-world-cli/protocol";
import { Command, CommanderError } from "commander";

import type { RegistrationContext } from "./shared.js";
import type { ProtocolErrorShape } from "../transport-util.js";
import { connectDaemonClient } from "../client/send-command.js";
import { createDaemonControlRunner, requestDaemonControl } from "../daemon-control.js";
import { clientMaxPayloadOption, getCommandConfig } from "../config-io.js";
import { type CliDependencies, write } from "../deps.js";
import { parseNonNegativeInt } from "../parse.js";

type PendingPairing = Record<string, unknown>;

type StoredPairing = Record<string, unknown>;

interface AuthPruneOptions {
  olderThan: number;
  yes?: boolean;
}

type CommandReportingUnknownSubcommand = Command & { unknownCommand: () => never };

export const AWAIT_CLIENT_TIMEOUT_FLOOR_MS = AUTH_AWAIT_PARK_CAP_MS + 5_000;
export const AWAIT_EMPTY_POLL_DELAY_MS = 250;

const INTERACTIVE_WAIT_GUIDANCE =
  "Waiting for a pairing request needs an interactive terminal. Use auth pending and auth approve --yes instead.";

const PRUNE_INTERACTIVE_GUIDANCE = "Non-interactive pairing prune requires --yes";

const PRUNE_JSON_GUIDANCE =
  "Pairing prune with --json requires --yes, because the confirmation prompt is never mixed into JSON output";

function describeUnshowableIdentity(code: string | undefined, candidates: PendingPairing[]) {
  if (candidates.length === 0) return "No pairing request is pending";
  const codes = candidates.map((entry) => String(entry.code)).join(", ");
  if (code) return `No pending pairing request matches code ${code}. Pending codes: ${codes}`;
  return `Multiple pairing requests are pending. Re-run auth approve with one of these codes: ${codes}`;
}

function describeWaitFailure(error: ProtocolErrorShape | undefined) {
  const reason = error?.message ?? "the daemon returned an error";
  const unserved = error?.code === ERROR_CODES.INVALID_MESSAGE || error?.code === ERROR_CODES.UNKNOWN_COMMAND;
  if (!unserved) return `Waiting for a pairing request failed: ${reason}`;
  return `Waiting for a pairing request failed: ${reason}. The running daemon is a different build than this CLI and does not serve the pairing wait: restart bridge serve, or approve with auth pending and auth approve.`;
}

function renderPairingIdentity(candidate: PendingPairing) {
  return [
    `Origin: ${candidate.origin}`,
    `World: ${candidate.worldTitle} (${candidate.worldId})`,
    `GM: ${candidate.userName} (${candidate.userId})`,
    `Client: ${candidate.label} (${candidate.clientId})`
  ].join("\n");
}

async function confirm(dependencies: CliDependencies, question: string, abortedMessage: string) {
  const rl = createInterface({
    input: dependencies.stdin,
    output: dependencies.stdout as NodeJS.WriteStream
  });
  try {
    // readline answers Ctrl+C and end-of-input by closing without calling back, so the close event
    // is the only signal that the operator left the prompt: without it this promise never settles
    // and the command ends silently with a success exit code.
    const answer = await new Promise<string | null>((resolve) => {
      rl.once("close", () => resolve(null));
      rl.question(`${question} [y/N] `, resolve);
    });
    if (answer === null) throw new CommanderError(1, "fvtt-world-cli.pairingPromptAborted", abortedMessage);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function confirmPairing(dependencies: CliDependencies, code: string) {
  return confirm(
    dependencies,
    `Approve pairing request ${code}?`,
    `Approval of pairing request ${code} was interrupted; the request is untouched and stays pending until it expires`
  );
}

function confirmPrune(dependencies: CliDependencies, count: number) {
  return confirm(
    dependencies,
    `Remove ${describeProfileCount(count)}?`,
    "Pruning pairing profiles was interrupted; every profile is untouched"
  );
}

function describeProfileCount(count: number) {
  return `${count} pairing profile${count === 1 ? "" : "s"}`;
}

function isPruneCandidate(pairing: StoredPairing, cutoff: number) {
  return String(pairing.status) !== "active" && Date.parse(String(pairing.lastSeenAt)) < cutoff;
}

function renderPruneCandidates(candidates: StoredPairing[], olderThanDays: number) {
  if (candidates.length === 0) {
    return `No pairing profile has been idle for more than ${olderThanDays} days`;
  }
  return [
    `${describeProfileCount(candidates.length)} idle for more than ${olderThanDays} days:`,
    ...candidates.map(
      (entry) =>
        `- ${entry.label} (${entry.clientId}) in ${entry.worldTitle} as ${entry.userName}, last seen ${entry.lastSeenAt} [${entry.pairingId}]`
    )
  ].join("\n");
}

export function registerAuth({ program, dependencies }: RegistrationContext) {
  const runDaemonControl = createDaemonControlRunner(dependencies);
  const auth = program
    .command("auth")
    .description("Manage Foundry browser pairings, or wait for one to approve with no subcommand")
    .action(async function authWait(this: Command) {
      if (this.args.length > 0) (this as CommandReportingUnknownSubcommand).unknownCommand();
      const globalOptions = this.optsWithGlobals() as { json?: boolean; timeoutMs?: number };
      if (globalOptions.json)
        throw new CommanderError(2, "fvtt-world-cli.pairingWaitInteractiveOnly", INTERACTIVE_WAIT_GUIDANCE);
      if (!dependencies.stdin.isTTY)
        throw new CommanderError(2, "fvtt-world-cli.pairingWaitInteractiveOnly", INTERACTIVE_WAIT_GUIDANCE);
      const clientConfig = getCommandConfig(this, dependencies);
      const client = await connectDaemonClient({
        daemonUrl: clientConfig.daemonUrl,
        deviceCredential: clientConfig.deviceCredential,
        ...clientMaxPayloadOption(dependencies)
      });
      let request: PendingPairing | null = null;
      try {
        write(
          dependencies.stdout,
          "Waiting for a pairing request — open the world in Foundry and click Pair in World CLI → Authorization.\nPress Ctrl+C to stop waiting.\n"
        );
        while (!request) {
          const response = await client.requestControl({
            operation: "auth.await",
            timeoutMs: Math.max(globalOptions.timeoutMs ?? 0, AWAIT_CLIENT_TIMEOUT_FLOOR_MS)
          });
          if (!response.ok)
            throw new CommanderError(
              1,
              "fvtt-world-cli.pairingWaitUnavailable",
              describeWaitFailure(response.error)
            );
          request = (response.result as { request?: PendingPairing | null })?.request ?? null;
          // A daemon that answers an empty long poll instantly — a shorter park than this build
          // expects — would spin this loop at full speed without a floor between re-issues.
          if (!request) await new Promise((resolve) => setTimeout(resolve, AWAIT_EMPTY_POLL_DELAY_MS));
        }
      } finally {
        await client.close();
      }
      const code = String(request.code);
      write(
        dependencies.stdout,
        `${renderPairingIdentity(request)}\nCode: ${code} (expires ${request.expiresAt})\n`
      );
      if (await confirmPairing(dependencies, code)) {
        await runDaemonControl(this, "auth.approve", { code });
        return;
      }
      await runDaemonControl(this, "auth.deny", { code });
      throw new CommanderError(1, "fvtt-world-cli.pairingDeclined", `Pairing request ${code} denied`);
    });
  // Commander omits its implicit help subcommand from any command that carries an action handler, so
  // the wait on the parent command silently removes `auth help` unless it is asked for explicitly.
  auth.helpCommand(true);
  for (const name of ["status", "pending", "list"] as const) {
    auth.command(name).action(function authRead(this: Command) {
      return runDaemonControl(this, `auth.${name}`);
    });
  }
  auth
    .command("deny")
    .argument("<code>")
    .action(function authDeny(this: Command, code: string) {
      return runDaemonControl(this, "auth.deny", { code });
    });
  auth
    .command("revoke")
    .argument("<pairingId>")
    .action(function authRevoke(this: Command, pairingId: string) {
      return runDaemonControl(this, "auth.revoke", { pairingId });
    });
  auth
    .command("rotate-client")
    .requiredOption("--yes", "Confirm credential rotation")
    .action(function rotateClient(this: Command) {
      return runDaemonControl(this, "auth.rotate-client");
    });
  auth
    .command("approve")
    .argument("[code]")
    .option("--yes", "Approve without an interactive prompt")
    .action(async function authApprove(this: Command, code: string | undefined, options: { yes?: boolean }) {
      let approvedCode = code;
      if (!options.yes) {
        if (!dependencies.stdin.isTTY)
          throw new CommanderError(
            2,
            "fvtt-world-cli.approvalRequired",
            "Non-interactive pairing approval requires --yes"
          );
        const pendingResponse = await requestDaemonControl(dependencies, this, "auth.pending");
        if (!pendingResponse.ok)
          throw new CommanderError(
            1,
            "fvtt-world-cli.approvalPendingUnavailable",
            `Listing pending pairing requests failed: ${pendingResponse.error?.message ?? "the daemon returned an error"}`
          );
        const candidates = (pendingResponse.result as { pending?: PendingPairing[] })?.pending ?? [];
        const candidate = code
          ? candidates.find((entry) => entry.code === code)
          : candidates.length === 1
            ? candidates[0]
            : null;
        if (!candidate)
          throw new CommanderError(
            2,
            "fvtt-world-cli.approvalIdentityUnavailable",
            describeUnshowableIdentity(code, candidates)
          );
        approvedCode = String(candidate.code);
        write(dependencies.stdout, `${renderPairingIdentity(candidate)}\n`);
        if (!(await confirmPairing(dependencies, approvedCode)))
          throw new CommanderError(1, "fvtt-world-cli.approvalDenied", "Pairing approval cancelled");
      }
      return runDaemonControl(this, "auth.approve", { ...(approvedCode ? { code: approvedCode } : {}) });
    });
  auth
    .command("prune")
    .option(
      "--older-than <days>",
      "Remove pairing profiles idle for more than this many days",
      parseNonNegativeInt,
      AUTH_PRUNE_DEFAULT_DAYS
    )
    .option("--yes", "Prune without an interactive prompt")
    .action(async function authPrune(this: Command, options: AuthPruneOptions) {
      const olderThanDays = options.olderThan;
      if (!options.yes) {
        if (Boolean(this.optsWithGlobals().json))
          throw new CommanderError(2, "fvtt-world-cli.approvalRequired", PRUNE_JSON_GUIDANCE);
        if (!dependencies.stdin.isTTY)
          throw new CommanderError(2, "fvtt-world-cli.approvalRequired", PRUNE_INTERACTIVE_GUIDANCE);
        const listResponse = await requestDaemonControl(dependencies, this, "auth.list");
        if (!listResponse.ok)
          throw new CommanderError(
            1,
            "fvtt-world-cli.pruneCandidatesUnavailable",
            `Listing pairing profiles failed: ${listResponse.error?.message ?? "the daemon returned an error"}`
          );
        const cutoff = pairingPruneCutoffAt(olderThanDays);
        const candidates = ((listResponse.result as { pairings?: StoredPairing[] })?.pairings ?? []).filter(
          (entry) => isPruneCandidate(entry, cutoff)
        );
        write(dependencies.stdout, `${renderPruneCandidates(candidates, olderThanDays)}\n`);
        if (candidates.length > 0 && !(await confirmPrune(dependencies, candidates.length)))
          throw new CommanderError(1, "fvtt-world-cli.pruneDeclined", "Pairing prune cancelled");
      }
      return runDaemonControl(this, "auth.prune", { olderThanDays });
    });
  // Commander copies allowExcessArguments into a subcommand when that subcommand is created, so the
  // wait's own operand check must be enabled after every auth subcommand exists; enabling it earlier
  // makes each of them silently accept extra arguments.
  auth.allowExcessArguments();
}
