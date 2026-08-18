import {
  DEFAULT_DAEMON_URL,
  DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
  DEFAULT_WS_MAX_PAYLOAD_BYTES,
  resolveEffectiveLimits
} from "@fvtt-world-cli/protocol";
import { Command } from "commander";

import {
  type CliConfigStore,
  createEmptyConfig,
  resolveBridgeServeConfig,
  resolveEffectiveUploadLimitBytes,
  resolveRemoteCommandConfig
} from "./config.js";
import type { CliDependencies } from "./deps.js";

export function getStoredConfig(dependencies: CliDependencies) {
  const existing = dependencies.configStore.readConfig();
  if (existing) return existing;
  const created = createEmptyConfig();
  dependencies.configStore.writeConfig(created);
  return created;
}

export function getEffectiveUploadLimitBytes(dependencies: CliDependencies): number {
  return resolveEffectiveUploadLimitBytes({ persistedConfig: getStoredConfig(dependencies) });
}

export function clientMaxPayloadOption(dependencies: CliDependencies): { maxPayloadBytes?: number } {
  const maxPayloadBytes = resolveEffectiveLimits(
    getEffectiveUploadLimitBytes(dependencies)
  ).wsMaxPayloadBytes;
  return maxPayloadBytes === DEFAULT_WS_MAX_PAYLOAD_BYTES ? {} : { maxPayloadBytes };
}

export function getCommandConfig(command: Command, dependencies: CliDependencies) {
  const options = command.optsWithGlobals() as {
    daemonUrl?: string;
  };

  return resolveRemoteCommandConfig({
    flagDaemonUrl: options.daemonUrl,
    env: dependencies.env,
    persistedConfig: getStoredConfig(dependencies)
  });
}

export function getBridgeDaemonConfig(command: Command, _options: object, dependencies: CliDependencies) {
  const globalOptions = command.optsWithGlobals() as {
    daemonUrl?: string;
  };

  return resolveBridgeServeConfig({
    flagDaemonUrl: globalOptions.daemonUrl,

    env: dependencies.env,
    persistedConfig: getStoredConfig(dependencies)
  });
}

interface DisplayConfig {
  version?: number;
  daemonUrl?: string;
  uploadLimitBytes?: number;
  pairingCount: number;
}

export function maskConfigForOutput(config: ReturnType<CliConfigStore["readConfig"]>): DisplayConfig | null {
  if (!config) {
    return config;
  }

  return {
    version: config.version,
    daemonUrl: config.daemonUrl,
    uploadLimitBytes: config.uploadLimitBytes,
    pairingCount: config.pairings?.length ?? 0
  };
}

export function renderConfigGetHumanOutput(configPath: string, displayConfig: DisplayConfig | null) {
  if (!displayConfig) {
    return `No persisted config found at ${configPath}`;
  }

  return [
    `Config file: ${configPath}`,
    `Daemon URL: ${displayConfig.daemonUrl ?? DEFAULT_DAEMON_URL}`,

    `Upload limit: ${
      typeof displayConfig.uploadLimitBytes === "number"
        ? `${displayConfig.uploadLimitBytes} bytes`
        : `${DEFAULT_UPLOAD_SIZE_LIMIT_BYTES} bytes (default)`
    }`,
    `Pairings: ${displayConfig.pairingCount}`
  ].join("\n");
}
