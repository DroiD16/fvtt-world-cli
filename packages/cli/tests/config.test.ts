import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CLIENT_LABEL_SCHEMA,
  DEFAULT_UPLOAD_SIZE_LIMIT_BYTES,
  UPLOAD_SIZE_LIMIT_MAX_BYTES,
  validateSchema
} from "@fvtt-world-cli/protocol";

import {
  CliConfigError,
  createEmptyConfig,
  createCliConfigStore,
  getDefaultCliConfigPath,
  parseUploadLimitBytes,
  resolveEffectiveUploadLimitBytes
} from "../src/config.js";

const tempDirectories: string[] = [];

function createTempConfigPath() {
  const tempDirectory = mkdtempSync(join(tmpdir(), "fvtt-world-cli-config-"));
  tempDirectories.push(tempDirectory);
  return join(tempDirectory, "fvtt-world-cli", "config.json");
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    const tempDirectory = tempDirectories.pop();
    if (tempDirectory) {
      rmSync(tempDirectory, {
        force: true,
        recursive: true
      });
    }
  }
});

describe("CLI config store", () => {
  it("writes persisted config with user-only permissions", () => {
    const configPath = createTempConfigPath();
    const configStore = createCliConfigStore(configPath);

    const config = {
      ...createEmptyConfig(),
      daemonUrl: "ws://127.0.0.1:49001"
    };
    configStore.writeConfig(config);

    expect(configStore.readConfig()).toEqual(config);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(configPath)).mode & 0o777).toBe(0o700);
  });

  it("throws a readable error for malformed config files", () => {
    const configPath = createTempConfigPath();
    mkdirSync(dirname(configPath), {
      recursive: true
    });
    writeFileSync(configPath, "{ invalid json\n", "utf8");

    const configStore = createCliConfigStore(configPath);

    expect(() => configStore.readConfig()).toThrowError(`Invalid CLI config at ${configPath}:`);
  });

  it("persists and reads back a valid uploadLimitBytes", () => {
    const configPath = createTempConfigPath();
    const configStore = createCliConfigStore(configPath);

    const config = { ...createEmptyConfig(), uploadLimitBytes: 200 * 1024 * 1024 };
    configStore.writeConfig(config);

    expect(configStore.readConfig()).toEqual(config);
  });

  it("rejects an over-ceiling uploadLimitBytes in the config file (INVALID_CONFIGURATION)", () => {
    const configPath = createTempConfigPath();
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ uploadLimitBytes: 600 * 1024 * 1024 }), "utf8");

    const configStore = createCliConfigStore(configPath);

    expect(() => configStore.readConfig()).toThrowError(CliConfigError);
  });

  it("rejects an unversioned legacy config without rewriting the file", () => {
    const configPath = createTempConfigPath();
    mkdirSync(dirname(configPath), { recursive: true });
    const original = JSON.stringify({
      daemonUrl: "ws://127.0.0.1:49001",
      token: "legacy-secret",
      uploadLimitBytes: 1234
    });
    writeFileSync(configPath, original, "utf8");
    expect(() => createCliConfigStore(configPath).readConfig()).toThrowError(CliConfigError);
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expect(readdirSync(dirname(configPath))).toEqual(["config.json"]);
  });

  it("rejects an unknown future config version without rewriting the file", () => {
    const configPath = createTempConfigPath();
    mkdirSync(dirname(configPath), { recursive: true });
    const future = { version: 4, daemonUrl: "ws://127.0.0.1:49001", futureField: { keep: true } };
    const original = `${JSON.stringify(future, null, 2)}\n`;
    writeFileSync(configPath, original, "utf8");

    expect(() => createCliConfigStore(configPath).readConfig()).toThrowError(
      "Unsupported CLI config version 4"
    );
    expect(readFileSync(configPath, "utf8")).toBe(original);
  });

  it("rejects a config from the previous version without rewriting the file", () => {
    const configPath = createTempConfigPath();
    mkdirSync(dirname(configPath), { recursive: true });
    const previous = {
      version: 2,
      daemonUrl: "ws://127.0.0.1:49001",
      deviceCredential: "d".repeat(43),
      pairings: [
        {
          pairingId: "pair-1",
          name: "World",
          origin: "http://localhost:30000",
          worldId: "world-1",
          worldTitle: "World",
          userId: "gm-1",
          userName: "GM",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastSeenAt: "2026-01-01T00:00:00.000Z",
          credentialDigest: "a".repeat(64)
        }
      ]
    };
    const original = `${JSON.stringify(previous, null, 2)}\n`;
    writeFileSync(configPath, original, "utf8");

    expect(() => createCliConfigStore(configPath).readConfig()).toThrowError(
      "delete the config to re-initialize"
    );
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expect(readdirSync(dirname(configPath))).toEqual(["config.json"]);
  });

  it("accepts a current-version pairing record carrying a client id and label", () => {
    const configPath = createTempConfigPath();
    const configStore = createCliConfigStore(configPath);
    const config = {
      ...createEmptyConfig(),
      pairings: [
        {
          pairingId: "pair-1",
          clientId: "a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5",
          label: "Зен 🎲",
          origin: "http://localhost:30000",
          worldId: "world-1",
          worldTitle: "World",
          userId: "gm-1",
          userName: "GM",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastSeenAt: "2026-01-01T00:00:00.000Z",
          credentialDigest: "a".repeat(64)
        }
      ]
    };

    configStore.writeConfig(config);

    expect(configStore.readConfig()).toEqual(config);
  });

  it("rejects a persisted client id outside the hex-and-dash charset or length range", () => {
    const configPath = createTempConfigPath();
    const configStore = createCliConfigStore(configPath);
    const pairing = {
      pairingId: "pair-1",
      label: "Zen Browser",
      origin: "http://localhost:30000",
      worldId: "world-1",
      worldTitle: "World",
      userId: "gm-1",
      userName: "GM",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      credentialDigest: "a".repeat(64)
    };

    for (const clientId of ["abcdef0", "a".repeat(65), "client id", "zzzzzzzz", ""]) {
      expect(() =>
        configStore.writeConfig({ ...createEmptyConfig(), pairings: [{ ...pairing, clientId }] })
      ).toThrowError();
    }
  });

  it("rejects a persisted label that is whitespace-only or carries control or invisible characters", () => {
    const configPath = createTempConfigPath();
    const configStore = createCliConfigStore(configPath);
    const pairing = {
      pairingId: "pair-1",
      clientId: "a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5",
      origin: "http://localhost:30000",
      worldId: "world-1",
      worldTitle: "World",
      userId: "gm-1",
      userName: "GM",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      credentialDigest: "a".repeat(64)
    };

    for (const label of [
      `${String.fromCodePoint(0x1b)}[31mZen`,
      `Zen${String.fromCodePoint(0x200b)}Browser`,
      "",
      "   ",
      String.fromCodePoint(0x00a0)
    ]) {
      expect(() =>
        configStore.writeConfig({ ...createEmptyConfig(), pairings: [{ ...pairing, label }] })
      ).toThrowError();
    }
  });

  it("persists a label the wire schema accepts at the astral-character cap", () => {
    const configPath = createTempConfigPath();
    const configStore = createCliConfigStore(configPath);
    const label = String.fromCodePoint(0x1f3b2).repeat(64);
    const config = {
      ...createEmptyConfig(),
      pairings: [
        {
          pairingId: "pair-1",
          clientId: "a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5",
          label,
          origin: "http://localhost:30000",
          worldId: "world-1",
          worldTitle: "World",
          userId: "gm-1",
          userName: "GM",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastSeenAt: "2026-01-01T00:00:00.000Z",
          credentialDigest: "a".repeat(64)
        }
      ]
    };

    expect(validateSchema(CLIENT_LABEL_SCHEMA, label, "$.label")).toEqual([]);
    configStore.writeConfig(config);

    expect(configStore.readConfig()).toEqual(config);
  });

  it("rejects an unrecognized unversioned shape", () => {
    const configPath = createTempConfigPath();
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ daemonUrl: "ws://127.0.0.1:49001", futureField: true }),
      "utf8"
    );

    expect(() => createCliConfigStore(configPath).readConfig()).toThrowError("Missing CLI config version");
  });

  it("resolves Linux, macOS, Windows, and XDG config locations", () => {
    expect(getDefaultCliConfigPath({ platformName: "linux", homeDirectory: "/home/test", env: {} })).toBe(
      "/home/test/.config/fvtt-world-cli/config.json"
    );
    expect(getDefaultCliConfigPath({ platformName: "darwin", homeDirectory: "/Users/test", env: {} })).toBe(
      "/Users/test/Library/Application Support/fvtt-world-cli/config.json"
    );
    expect(
      getDefaultCliConfigPath({
        platformName: "win32",
        homeDirectory: "C:\\Users\\test",
        env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" }
      })
    ).toContain("fvtt-world-cli/config.json");
    expect(
      getDefaultCliConfigPath({
        platformName: "linux",
        homeDirectory: "/home/test",
        env: { XDG_CONFIG_HOME: "/custom" }
      })
    ).toBe("/custom/fvtt-world-cli/config.json");
  });
});

describe("parseUploadLimitBytes", () => {
  it("parses a plain byte count", () => {
    expect(parseUploadLimitBytes("104857600")).toBe(100 * 1024 * 1024);
  });

  it("parses binary size suffixes (case-insensitive)", () => {
    expect(parseUploadLimitBytes("100MiB")).toBe(100 * 1024 * 1024);
    expect(parseUploadLimitBytes("256mib")).toBe(256 * 1024 * 1024);
    expect(parseUploadLimitBytes("2KiB")).toBe(2 * 1024);
  });

  it("parses decimal size suffixes", () => {
    expect(parseUploadLimitBytes("100MB")).toBe(100 * 1000 * 1000);
    expect(parseUploadLimitBytes("500 KB")).toBe(500 * 1000);
  });

  it("accepts exactly the ceiling but rejects a value above it", () => {
    expect(parseUploadLimitBytes(String(UPLOAD_SIZE_LIMIT_MAX_BYTES))).toBe(UPLOAD_SIZE_LIMIT_MAX_BYTES);
    expect(() => parseUploadLimitBytes("600MiB")).toThrowError(CliConfigError);
  });

  it("rejects non-positive and garbage values", () => {
    expect(() => parseUploadLimitBytes("0")).toThrowError(CliConfigError);
    expect(() => parseUploadLimitBytes("-5")).toThrowError(CliConfigError);
    expect(() => parseUploadLimitBytes("abc")).toThrowError(CliConfigError);
    expect(() => parseUploadLimitBytes("10.5MiB")).toThrowError(CliConfigError);
  });
});

describe("resolveEffectiveUploadLimitBytes", () => {
  it("prefers the flag, then config, then the default", () => {
    expect(
      resolveEffectiveUploadLimitBytes({ flagUploadLimitBytes: 7, persistedConfig: { uploadLimitBytes: 9 } })
    ).toBe(7);
    expect(resolveEffectiveUploadLimitBytes({ persistedConfig: { uploadLimitBytes: 9 } })).toBe(9);
    expect(resolveEffectiveUploadLimitBytes({ persistedConfig: null })).toBe(DEFAULT_UPLOAD_SIZE_LIMIT_BYTES);
    expect(resolveEffectiveUploadLimitBytes({ persistedConfig: {} })).toBe(DEFAULT_UPLOAD_SIZE_LIMIT_BYTES);
  });
});
