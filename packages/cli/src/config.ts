import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

import {
  CLIENT_ID_MAX_LENGTH,
  CLIENT_ID_MIN_LENGTH,
  CLIENT_ID_PATTERN,
  CLIENT_LABEL_MAX_LENGTH,
  CLIENT_LABEL_PATTERN,
  DEFAULT_DAEMON_URL,
  DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
  UPLOAD_SIZE_LIMIT_MAX_BYTES
} from "@fvtt-world-cli/protocol";
import { z } from "zod";

const CONFIG_DIRECTORY_MODE = 0o700;
const CONFIG_FILE_MODE = 0o600;

export const CONFIG_VERSION = 3;

const ClientIdSchema = z
  .string()
  .min(CLIENT_ID_MIN_LENGTH)
  .max(CLIENT_ID_MAX_LENGTH)
  .regex(new RegExp(CLIENT_ID_PATTERN, "u"));

const ClientLabelSchema = z
  .string()
  .min(1)
  .regex(new RegExp(CLIENT_LABEL_PATTERN, "u"))
  .refine((value) => [...value].length <= CLIENT_LABEL_MAX_LENGTH, {
    message: `label must be at most ${CLIENT_LABEL_MAX_LENGTH} characters long`
  });

export const PairingSchema = z
  .object({
    pairingId: z.string().min(1),
    clientId: ClientIdSchema,
    label: ClientLabelSchema,
    origin: z.string().url(),
    worldId: z.string().min(1),
    worldTitle: z.string().min(1),
    userId: z.string().min(1),
    userName: z.string().min(1),
    createdAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    credentialDigest: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();

export class CliConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliConfigError";
  }
}

export const PersistedCliConfigSchema = z
  .object({
    version: z.literal(CONFIG_VERSION),
    daemonUrl: z.string().min(1).optional(),
    deviceCredential: z.string().min(43),
    pairings: z.array(PairingSchema),
    skillInstalls: z.array(z.string().min(1)).optional(),

    uploadLimitBytes: z
      .number()
      .int({
        message: `uploadLimitBytes must be a positive integer no greater than ${UPLOAD_SIZE_LIMIT_MAX_BYTES}`
      })
      .positive({
        message: `uploadLimitBytes must be a positive integer no greater than ${UPLOAD_SIZE_LIMIT_MAX_BYTES}`
      })
      .max(UPLOAD_SIZE_LIMIT_MAX_BYTES, {
        message: `uploadLimitBytes must be a positive integer no greater than ${UPLOAD_SIZE_LIMIT_MAX_BYTES}`
      })
      .optional()
  })
  .strict();

const UPLOAD_LIMIT_PATTERN = /^(\d+)\s*(B|KB|MB|GB|KIB|MIB|GIB)?$/i;
const UPLOAD_LIMIT_UNIT_BYTES: Record<string, number> = {
  B: 1,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3
};

export function parseUploadLimitBytes(raw: string): number {
  const value = raw.trim();
  const match = UPLOAD_LIMIT_PATTERN.exec(value);
  if (!match) {
    throw new CliConfigError(
      `Invalid upload limit "${raw}". Use a positive integer of bytes or a size like 100MiB.`
    );
  }

  const unit = (match[2] ?? "B").toUpperCase();
  const bytes = Number(match[1]) * UPLOAD_LIMIT_UNIT_BYTES[unit];
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new CliConfigError(`Invalid upload limit "${raw}". Must resolve to a positive integer of bytes.`);
  }
  if (bytes > UPLOAD_SIZE_LIMIT_MAX_BYTES) {
    throw new CliConfigError(
      `Upload limit ${bytes} bytes exceeds the maximum of ${UPLOAD_SIZE_LIMIT_MAX_BYTES} bytes.`
    );
  }

  return bytes;
}

export function resolveEffectiveUploadLimitBytes({
  flagUploadLimitBytes,
  persistedConfig
}: {
  flagUploadLimitBytes?: number;
  persistedConfig: Pick<PersistedCliConfig, "uploadLimitBytes"> | null;
}): number {
  return flagUploadLimitBytes ?? persistedConfig?.uploadLimitBytes ?? DEFAULT_UPLOAD_SIZE_LIMIT_BYTES;
}

function isWebSocketUrl(value: string, { allowSecure }: { allowSecure: boolean }): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "ws:" || (allowSecure && url.protocol === "wss:");
  } catch {
    return false;
  }
}

const ClientDaemonUrlSchema = z
  .string()
  .min(1)
  .refine((value) => isWebSocketUrl(value, { allowSecure: true }), {
    message: "Daemon URL must be a valid ws:// or wss:// URL"
  });

const ServeDaemonUrlSchema = z
  .string()
  .min(1)
  .refine((value) => isWebSocketUrl(value, { allowSecure: false }), {
    message: "Daemon URL must be a valid ws:// URL"
  });

const ResolvedRemoteCommandConfigSchema = z.object({
  daemonUrl: ClientDaemonUrlSchema,
  deviceCredential: z.string().min(43)
});

const ResolvedBridgeServeConfigSchema = z.object({
  daemonUrl: ServeDaemonUrlSchema
});

export type PersistedCliConfigV3 = z.infer<typeof PersistedCliConfigSchema>;
export type PersistedCliConfig = Partial<PersistedCliConfigV3>;
export type ResolvedRemoteCommandConfig = z.infer<typeof ResolvedRemoteCommandConfigSchema>;
export type ResolvedBridgeServeConfig = z.infer<typeof ResolvedBridgeServeConfigSchema>;

export interface CliConfigStore {
  getConfigPath(): string;
  readConfig(): PersistedCliConfig | null;
  writeConfig(config: any): void;
}

export function createEmptyConfig(): PersistedCliConfigV3 {
  return {
    version: CONFIG_VERSION,
    daemonUrl: DEFAULT_DAEMON_URL,
    deviceCredential: randomBytes(32).toString("base64url"),
    pairings: []
  };
}

export function getDefaultCliConfigPath({
  env = process.env,
  platformName = platform(),
  homeDirectory = homedir()
}: { env?: NodeJS.ProcessEnv; platformName?: NodeJS.Platform; homeDirectory?: string } = {}) {
  const xdgHome = env.XDG_CONFIG_HOME?.trim();
  if (xdgHome) return join(xdgHome, "fvtt-world-cli", "config.json");
  if (platformName === "darwin")
    return join(homeDirectory, "Library", "Application Support", "fvtt-world-cli", "config.json");
  if (platformName === "win32")
    return join(
      env.APPDATA?.trim() || join(homeDirectory, "AppData", "Roaming"),
      "fvtt-world-cli",
      "config.json"
    );
  return join(homeDirectory, ".config", "fvtt-world-cli", "config.json");
}

function formatConfigError(configPath: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return `Invalid CLI config at ${configPath}: ${message}`;
}

export function createCliConfigStore(configPath = getDefaultCliConfigPath()): CliConfigStore {
  return {
    getConfigPath() {
      return configPath;
    },
    readConfig() {
      if (!existsSync(configPath)) {
        return null;
      }

      try {
        const rawConfig = readFileSync(configPath, "utf8");
        const parsed = JSON.parse(rawConfig) as Record<string, unknown>;
        if (parsed.version === CONFIG_VERSION) {
          return PersistedCliConfigSchema.parse(parsed);
        }
        const versionLabel = Object.hasOwn(parsed, "version")
          ? `Unsupported CLI config version ${JSON.stringify(parsed.version)}`
          : "Missing CLI config version";
        throw new CliConfigError(
          `${versionLabel}; this binary supports version ${CONFIG_VERSION}. Use a matching fvtt-world-cli build or delete the config to re-initialize.`
        );
      } catch (error) {
        throw new CliConfigError(formatConfigError(configPath, error));
      }
    },
    writeConfig(config) {
      const validatedConfig = PersistedCliConfigSchema.parse(config);
      const configDirectory = dirname(configPath);

      mkdirSync(configDirectory, {
        recursive: true,
        mode: CONFIG_DIRECTORY_MODE
      });
      chmodSync(configDirectory, CONFIG_DIRECTORY_MODE);
      const temporaryPath = join(configDirectory, `.config-${process.pid}-${randomUUID()}.tmp`);
      writeFileSync(temporaryPath, `${JSON.stringify(validatedConfig, null, 2)}\n`, {
        encoding: "utf8",
        mode: CONFIG_FILE_MODE
      });
      chmodSync(temporaryPath, CONFIG_FILE_MODE);
      renameSync(temporaryPath, configPath);
      chmodSync(configPath, CONFIG_FILE_MODE);
    }
  };
}

export function mergePersistedCliConfig(
  existingConfig: PersistedCliConfig | null,
  updates: PersistedCliConfig
) {
  return PersistedCliConfigSchema.parse({
    ...(existingConfig ?? createEmptyConfig()),
    ...updates
  });
}

export function resolveRemoteCommandConfig({
  flagDaemonUrl,
  env,
  persistedConfig
}: {
  flagDaemonUrl?: string;
  env: NodeJS.ProcessEnv;
  persistedConfig: PersistedCliConfig | null;
}) {
  return ResolvedRemoteCommandConfigSchema.parse({
    daemonUrl:
      flagDaemonUrl ??
      env.FVTT_WORLD_CLI_DAEMON_URL ??
      persistedConfig?.daemonUrl ??
      new URL(DEFAULT_DAEMON_URL).toString(),
    deviceCredential: persistedConfig?.deviceCredential
  });
}

export function resolveBridgeServeConfig({
  flagDaemonUrl,
  env,
  persistedConfig
}: {
  flagDaemonUrl?: string;
  env: NodeJS.ProcessEnv;
  persistedConfig: PersistedCliConfig | null;
}) {
  return ResolvedBridgeServeConfigSchema.parse({
    daemonUrl:
      flagDaemonUrl ?? env.FVTT_WORLD_CLI_DAEMON_URL ?? persistedConfig?.daemonUrl ?? DEFAULT_DAEMON_URL
  });
}
