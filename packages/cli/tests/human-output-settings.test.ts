import { CommanderError } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { failIfCalledSendCommand, runCommand } from "./helpers/cli-harness.js";
import type { SendCommandMock } from "./helpers/cli-harness.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("setting.* CLI surface", () => {
  const respond = (result: Record<string, unknown>) =>
    vi.fn(async () => ({
      protocolVersion: "1.0",
      type: "command.response",
      id: "req-setting",
      ok: true,
      result
    })) as unknown as SendCommandMock;

  const ROW = {
    namespace: "core",
    key: "tokenDragPreview",
    id: "core.tokenDragPreview",
    name: "SETTINGS.TokenDragPreview",
    nameLocalized: "Перетаскивание токена",
    hint: null,
    hintLocalized: null,
    scope: "client",
    type: { kind: "Boolean" },
    config: true,
    requiresReload: false
  };

  it("takes a write value as a JSON literal, so a quoted string stays distinct from a boolean", async () => {
    const sendCommand = respond({});
    await runCommand(
      ["setting", "set", "--namespace", "core", "--key", "chatBubbles", "--value-json", '"true"'],
      sendCommand
    );
    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "setting.set",
        params: { namespace: "core", key: "chatBubbles", value: "true" }
      })
    );
  });

  it("refuses a write value that is not JSON instead of sending it as a bare string", async () => {
    const result = await runCommand(
      ["setting", "set", "--namespace", "core", "--key", "chatBubbles", "--value-json", "yes"],
      failIfCalledSendCommand()
    );
    expect(result.error).toBeInstanceOf(CommanderError);
    expect(String((result.error as CommanderError).message)).toMatch(/--value-json must be a JSON literal/);
  });

  it("needs either --items-json or --items-stdin for a batch write", async () => {
    const result = await runCommand(["setting", "set-many"], failIfCalledSendCommand());
    expect(result.error).toBeInstanceOf(CommanderError);
    expect(String((result.error as CommanderError).message)).toMatch(/--items-json|--items-stdin/);
  });

  it("prints list rows as METADATA ONLY, with both the localized label and the raw key", async () => {
    const result = await runCommand(
      ["setting", "list"],
      respond({ settings: [ROW], total: 1, hasMore: false })
    );
    expect(result.error).toBeNull();

    expect(result.stdout).toContain("metadata only");
    expect(result.stdout).toContain("core.tokenDragPreview");
    expect(result.stdout).toContain("Перетаскивание токена [SETTINGS.TokenDragPreview]");
    expect(result.stdout).toContain("scope=client");
    expect(result.stdout).toContain("type=Boolean");

    const row = result.stdout.split("\n").find((line) => line.startsWith("core.tokenDragPreview")) ?? "";
    expect(row).not.toMatch(/value/i);
  });

  it("marks a row whose registration could not be read, and stays silent otherwise", async () => {
    const broken = await runCommand(
      ["setting", "list"],
      respond({
        settings: [{ ...ROW, name: null, nameLocalized: null, type: null, metadataReadFailed: true }],
        total: 1,
        hasMore: false
      })
    );
    expect(broken.stdout).toContain("metadata=UNREADABLE");

    const healthy = await runCommand(
      ["setting", "list"],
      respond({ settings: [ROW], total: 1, hasMore: false })
    );
    expect(healthy.stdout).not.toContain("UNREADABLE");
  });

  it("prints the value on get, and a null value with the same shape as a real one", async () => {
    const real = await runCommand(
      ["setting", "get", "--namespace", "core", "--key", "tokenDragPreview"],
      respond({ setting: { ...ROW, value: { enabled: true, tags: ["a"] } } })
    );
    expect(real.stdout).toContain("setting: core.tokenDragPreview");
    expect(real.stdout).toContain("scope: client");
    expect(real.stdout).toContain('"enabled": true');
    expect(real.stdout).toContain("(raw: SETTINGS.TokenDragPreview)");

    const absent = await runCommand(
      ["setting", "get", "--namespace", "core", "--key", "tokenDragPreview"],
      respond({ setting: { ...ROW, value: null } })
    );
    expect(absent.stdout).toContain("value: null");

    expect(absent.stdout.split("\n").slice(0, 6)).toEqual(real.stdout.split("\n").slice(0, 6));
  });

  it("marks an UNADDRESSABLE row by its id instead of printing a `null` pair half as an address", async () => {
    const result = await runCommand(
      ["setting", "list"],
      respond({
        settings: [{ ...ROW, namespace: "weird", key: null, id: "weird", unaddressable: true }],
        total: 1,
        hasMore: false
      })
    );
    expect(result.stdout).toContain("address=UNADDRESSABLE");
    expect(result.stdout).not.toContain("weird.null");
    const healthy = await runCommand(
      ["setting", "list"],
      respond({ settings: [ROW], total: 1, hasMore: false })
    );
    expect(healthy.stdout).not.toContain("UNADDRESSABLE");
  });

  it("says a REDACTED value is redacted rather than letting it read as unset", async () => {
    const listed = await runCommand(
      ["setting", "list"],
      respond({
        settings: [
          {
            ...ROW,
            namespace: "fvtt-world-cli",
            key: "authToken",
            id: "fvtt-world-cli.authToken",
            valueRedacted: true
          }
        ],
        total: 1,
        hasMore: false
      })
    );
    expect(listed.stdout).toContain("value=REDACTED");

    const got = await runCommand(
      ["setting", "get", "--namespace", "fvtt-world-cli", "--key", "authToken"],
      respond({
        setting: {
          ...ROW,
          namespace: "fvtt-world-cli",
          key: "authToken",
          id: "fvtt-world-cli.authToken",
          value: null,
          valueRedacted: true
        }
      })
    );
    expect(got.stdout).toContain("REDACTED");
    expect(got.stdout).toContain("never exposed through setting commands");

    const plainNull = await runCommand(
      ["setting", "get", "--namespace", "core", "--key", "tokenDragPreview"],
      respond({ setting: { ...ROW, value: null } })
    );
    expect(plainNull.stdout).toContain("value: null");
    expect(plainNull.stdout).not.toContain("REDACTED");
  });

  it("requires both --namespace and --key on get", async () => {
    for (const argv of [
      ["setting", "get", "--namespace", "core"],
      ["setting", "get", "--key", "time"]
    ]) {
      const result = await runCommand(argv, failIfCalledSendCommand());
      expect(result.error).toBeInstanceOf(CommanderError);
      expect(String((result.error as CommanderError).message)).toMatch(/required option/i);
    }
  });
});
