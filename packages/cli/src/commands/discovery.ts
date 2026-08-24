import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  COMMAND_DEFINITIONS,
  DISCOVERABLE_COMMAND_NAMES,
  ERROR_CODES,
  POLICY_DISCOVERY_TIMEOUT_MS,
  getCommandDefinition,
  isKnownCommand
} from "@fvtt-world-cli/protocol";
import { Command, CommanderError, InvalidArgumentError } from "commander";

import type { RegistrationContext } from "./shared.js";
import type { CommandResponseEnvelope } from "../transport-util.js";
import { clientMaxPayloadOption, getCommandConfig } from "../config-io.js";
import { listDocEntries, resolveDocsDirectory } from "../docs.js";
import {
  exitCodeForErrorCode,
  localSuccessEnvelope,
  renderProtocolError,
  toTransportErrorEnvelope
} from "../errors.js";
import { type CliDependencies, write } from "../deps.js";

const POLICY_SNAPSHOT_COMMAND = "policy.snapshot";

const POLICY_AVAILABILITY_CODES: ReadonlySet<string> = new Set([
  ERROR_CODES.DAEMON_UNAVAILABLE,
  ERROR_CODES.BRIDGE_NOT_READY,
  ERROR_CODES.BRIDGE_DISCONNECTED
]);

type PolicyDiscovery =
  | { status: "applied"; approve: ReadonlySet<string>; deny: ReadonlySet<string> }
  | { status: "fallback"; reason: string; detail: string }
  | { status: "failed"; envelope: CommandResponseEnvelope };

function commandNameSet(value: unknown): ReadonlySet<string> {
  return new Set(
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
  );
}

async function discoverPolicy(command: Command, dependencies: CliDependencies): Promise<PolicyDiscovery> {
  const clientConfig = getCommandConfig(command, dependencies);

  let response: CommandResponseEnvelope;
  try {
    response = await dependencies.sendCommand({
      daemonUrl: clientConfig.daemonUrl,
      deviceCredential: clientConfig.deviceCredential,
      command: POLICY_SNAPSHOT_COMMAND,
      params: {},
      ...clientMaxPayloadOption(dependencies),
      timeoutMs: POLICY_DISCOVERY_TIMEOUT_MS
    });
  } catch (error) {
    response = toTransportErrorEnvelope(error);
  }

  if (response.ok) {
    const snapshot = (response.result ?? {}) as { approve?: unknown; deny?: unknown };
    return {
      status: "applied",
      approve: commandNameSet(snapshot.approve),
      deny: commandNameSet(snapshot.deny)
    };
  }

  const code = response.error?.code ?? ERROR_CODES.INTERNAL_ERROR;
  if (!POLICY_AVAILABILITY_CODES.has(code)) {
    return { status: "failed", envelope: response };
  }

  return { status: "fallback", reason: code, detail: response.error?.message ?? "no reason reported" };
}

export function registerDiscovery({ program, dependencies }: RegistrationContext) {
  program
    .command("commands")
    .description("List discoverable protocol commands and whether each mutates world state")
    .action(async function listCommands(this: Command) {
      const json = Boolean(this.optsWithGlobals().json);
      const discovery = await discoverPolicy(this, dependencies);

      if (discovery.status === "failed") {
        const error = discovery.envelope.error;
        if (json) {
          write(dependencies.stdout, `${JSON.stringify(discovery.envelope, null, 2)}\n`);
        } else {
          write(dependencies.stderr, `${renderProtocolError(error)}\n`);
        }
        throw new CommanderError(
          exitCodeForErrorCode(error?.code),
          "fvtt-world-cli.remoteError",
          error?.message ?? "Reading the command policy failed"
        );
      }

      const applied = discovery.status === "applied";
      const payload = DISCOVERABLE_COMMAND_NAMES.filter((name) => !applied || !discovery.deny.has(name)).map(
        (name) => ({
          command: name,
          mutation: COMMAND_DEFINITIONS[name].mutation,
          ...(applied && discovery.approve.has(name) ? { approval: true } : {})
        })
      );

      const policy = applied
        ? { applied: true, source: "bridge" }
        : { applied: false, source: "static", reason: discovery.reason };

      if (json) {
        write(
          dependencies.stdout,
          `${JSON.stringify({ ...localSuccessEnvelope(payload), policy }, null, 2)}\n`
        );
        return;
      }

      if (!applied) {
        write(
          dependencies.stderr,
          `warning: the command policy of the GM client holding the bridge could not be read (${discovery.reason}: ${discovery.detail}); this is the full static command registry, so denied commands are still listed and commands needing approval are not marked.\n`
        );
      }

      write(
        dependencies.stdout,
        `${payload
          .map(
            (entry) =>
              `${entry.command}\t${entry.mutation ? "write" : "read"}${entry.approval ? "\tapproval" : ""}`
          )
          .join("\n")}\n`
      );
    });
  program
    .command("schema")
    .description("Print the parameter JSON schema for a protocol command")
    .argument("<command>", "Protocol command name, e.g. scene.update")
    .action(function commandSchema(commandName: string) {
      if (!isKnownCommand(commandName)) {
        throw new InvalidArgumentError(`Unknown command: ${commandName}`);
      }

      const definition = getCommandDefinition(commandName);

      const payload = {
        command: commandName,
        mutation: definition.mutation,
        paramsSchema: definition.paramsSchema
      };

      if (Boolean(this.optsWithGlobals().json)) {
        write(dependencies.stdout, `${JSON.stringify(localSuccessEnvelope(payload), null, 2)}\n`);
        return;
      }

      write(
        dependencies.stdout,
        `${[
          `command: ${payload.command}`,
          `mutation: ${payload.mutation ? "write" : "read"}`,
          "paramsSchema:",
          JSON.stringify(payload.paramsSchema, null, 2)
        ].join("\n")}\n`
      );
    });

  program
    .command("docs")
    .description("List or print the documentation shipped with the CLI")
    .argument("[name]", "Document name from the list, e.g. protocol")
    .action(function printDocs(this: Command, name?: string) {
      const docsDirectory = resolveDocsDirectory();
      if (!docsDirectory) {
        throw new CommanderError(
          1,
          "fvtt-world-cli.docsUnavailable",
          "Documentation files are not available in this installation. Use `commands --json` and `schema <command>` for runtime discovery."
        );
      }

      const entries = listDocEntries(docsDirectory);
      const json = Boolean(this.optsWithGlobals().json);

      if (!name) {
        const payload = entries.map((entry) => ({ name: entry.name, title: entry.title }));
        if (json) {
          write(dependencies.stdout, `${JSON.stringify(localSuccessEnvelope(payload), null, 2)}\n`);
          return;
        }
        write(dependencies.stdout, `${entries.map((entry) => `${entry.name}\t${entry.title}`).join("\n")}\n`);
        return;
      }

      const entry = entries.find((candidate) => candidate.name === name.toLowerCase());
      if (!entry) {
        throw new InvalidArgumentError(
          `Unknown document: ${name}. Available: ${entries.map((candidate) => candidate.name).join(", ")}`
        );
      }

      const content = readFileSync(resolve(docsDirectory, entry.file), "utf8");
      if (json) {
        write(
          dependencies.stdout,
          `${JSON.stringify(localSuccessEnvelope({ name: entry.name, title: entry.title, content }), null, 2)}\n`
        );
        return;
      }
      write(dependencies.stdout, content.endsWith("\n") ? content : `${content}\n`);
    });
}
