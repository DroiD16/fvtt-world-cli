import {
  APPROVAL_AWAIT_COMMAND,
  ERROR_CODES,
  createCommandResponse,
  createErrorResponse,
  createProtocolError
} from "@fvtt-world-cli/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCommand } from "./helpers/cli-harness.js";
import type { SendCommandMock } from "./helpers/cli-harness.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const APPROVAL_ID = "DDDDDDDDDDDDDDDDDDDDDD";

function respond(result: Record<string, unknown>) {
  return vi.fn(async () => createCommandResponse({ id: "req-1", result })) as unknown as SendCommandMock;
}

describe("policy-gated command output", () => {
  it("prints a setting write as a previous → value diff and names the reload requirement", async () => {
    const result = await runCommand(
      ["setting", "set", "--namespace", "core", "--key", "chatBubbles", "--value-json", "false"],
      respond({
        namespace: "core",
        key: "chatBubbles",
        id: "core.chatBubbles",
        scope: "client",
        previous: true,
        value: false,
        requiresReload: true,
        validated: true,
        changed: true
      })
    );

    expect(result.error).toBeNull();
    expect(result.stdout).toContain("wrote: core.chatBubbles (scope: client)");
    expect(result.stdout).toContain("previous: true");
    expect(result.stdout).toContain("value: false");
    expect(result.stdout).toContain("requiresReload: true");
    expect(result.stdout).toContain("system reload");
  });

  it("says a no-op setting write changed nothing instead of claiming a write", async () => {
    const result = await runCommand(
      ["setting", "set", "--namespace", "core", "--key", "chatBubbles", "--value-json", "true"],
      respond({
        namespace: "core",
        key: "chatBubbles",
        id: "core.chatBubbles",
        scope: "client",
        previous: true,
        value: true,
        requiresReload: false,
        validated: true,
        changed: false
      })
    );

    expect(result.stdout).toContain("left unchanged: core.chatBubbles");
    expect(result.stdout).toContain("changed: false");
  });

  it("prints per-element outcomes for a batch write, including the elements it dropped", async () => {
    const result = await runCommand(
      ["setting", "set-many", "--items-json", '[{"namespace":"core","key":"a","value":1}]'],
      respond({
        complete: false,
        outcomes: [
          {
            index: 0,
            status: "updated",
            namespace: "core",
            key: "a",
            id: "core.a",
            scope: "world",
            previous: 0,
            value: 1,
            requiresReload: false,
            validated: true,
            changed: true
          },
          { index: 1, id: "core.b", status: "dropped" }
        ],
        failure: { code: "SETTING_UNREGISTERED", message: "core.b is not registered" }
      })
    );

    expect(result.stdout).toContain("Wrote settings (2) — complete: false");
    expect(result.stdout).toContain("[0] updated");
    expect(result.stdout).toContain("[1] dropped");
    expect(result.stdout).toContain("failure: SETTING_UNREGISTERED");
  });

  it("reports a read batch element error next to the row instead of failing the whole call", async () => {
    const result = await runCommand(
      ["setting", "get-many", "--ids", "core.a,ghost.b"],
      respond({
        settings: [
          { namespace: "core", key: "a", id: "core.a", scope: "world", value: 3 },
          {
            namespace: "ghost",
            key: "b",
            id: "ghost.b",
            error: { code: "SETTING_NOT_FOUND", message: "gone" }
          }
        ]
      })
    );

    expect(result.stdout).toContain("value: 3");
    expect(result.stdout).toContain("error: SETTING_NOT_FOUND — gone");
  });

  it("prints a macro run with its return value and warns that Foundry swallows script errors", async () => {
    const result = await runCommand(
      ["macro", "execute", "--macro-id", "macro-1"],
      respond({
        macroId: "macro-1",
        type: "script",
        returned: 42,
        chatMessageIds: ["msg-1"],
        chatCapture: "captured"
      })
    );

    expect(result.stdout).toContain("Executed macro macro-1");
    expect(result.stdout).toContain("returned: 42");
    expect(result.stdout).toContain("chat messages: msg-1");
    expect(result.stdout).toMatch(/swallows script-macro errors/);
  });

  it("reports a macro preview as what it could check without running anything", async () => {
    const result = await runCommand(
      ["--dry-run", "macro", "execute", "--macro-id", "macro-1"],
      respond({ macroId: "macro-1", type: "chat", canExecute: true, commandLength: 12, dryRun: true })
    );

    expect(result.stdout).toContain("[dry-run] would execute macro macro-1");
    expect(result.stdout).toContain("canExecute: true");
    expect(result.stdout).toContain("command length: 12 characters");
  });

  it("prints a role change as a current → requested diff with the role name", async () => {
    const result = await runCommand(
      ["user", "role", "set", "--user-id", "user-1", "--role", "3"],
      respond({ userId: "user-1", previousRole: 1, role: 3, roleName: "Assistant GM", changed: true })
    );

    expect(result.stdout).toContain("Set role for user user-1");
    expect(result.stdout).toContain("role: 1 → 3 (Assistant GM)");
  });

  it("prints permission overrides and what the role still decides", async () => {
    const result = await runCommand(
      ["user", "permissions", "set", "--user-id", "user-1", "--permissions-json", '{"FILES_UPLOAD":true}'],
      respond({
        userId: "user-1",
        role: 1,
        overrides: { FILES_UPLOAD: true },
        permissions: { FILES_UPLOAD: true, MACRO_SCRIPT: false }
      })
    );

    expect(result.stdout).toContain("overrides:");
    expect(result.stdout).toContain("FILES_UPLOAD: true");
    expect(result.stdout).toContain("effective permissions: FILES_UPLOAD");
  });

  it("says a Foundry version that cannot report effective permissions did not report them", async () => {
    const result = await runCommand(
      ["user", "permissions", "set", "--user-id", "user-1", "--permissions-json", '{"FILES_UPLOAD":true}'],
      respond({ userId: "user-1", role: 1, overrides: {}, permissions: null })
    );

    expect(result.stdout).toContain("effective permissions: not reported by this Foundry version");
    expect(result.stdout).toContain("overrides: (none");
  });

  it("prints a scene activation, including a no-op that changed nothing", async () => {
    const result = await runCommand(
      ["scene", "activate", "--scene-id", "scene-1"],
      respond({ sceneId: "scene-1", active: true, wasActive: true, changed: false })
    );

    expect(result.stdout).toContain("Activated scene scene-1");
    expect(result.stdout).toContain("changed: false");
  });

  it("separates the users a pull reached from the offline ones it skipped", async () => {
    const result = await runCommand(
      ["scene", "pull-users", "--scene-id", "scene-1", "--user-ids", "user-1,user-2"],
      respond({
        sceneId: "scene-1",
        userIds: ["user-1"],
        skippedUserIds: ["user-2"],
        dispatched: true
      })
    );

    expect(result.stdout).toContain("pulled: user-1");
    expect(result.stdout).toContain("skipped (offline): user-2");
    expect(result.stdout).toContain("dispatched: true");
  });

  it("names an armed behavior's macro trigger so a reader sees it runs code", async () => {
    const result = await runCommand(
      [
        "scene",
        "region",
        "behavior",
        "executable",
        "create",
        "--scene-id",
        "scene-1",
        "--region-id",
        "region-1",
        "--macro-uuid",
        "Macro.abc123"
      ],
      respond({
        sceneId: "scene-1",
        regionId: "region-1",
        behavior: {
          id: "behavior-1",
          name: "Spring Trap",
          type: "executeMacro",
          disabled: false,
          system: { uuid: "Macro.abc123", events: ["tokenEnter"], everyone: true },
          flags: {}
        }
      })
    );

    expect(result.stdout).toContain("executeMacro");
    expect(result.stdout).toContain("RUNS A MACRO");
  });

  it("reports a broadcast as dispatched-with-nothing-to-confirm", async () => {
    const result = await runCommand(
      ["journal", "show", "--journal-id", "journal-1"],
      respond({
        journalId: "journal-1",
        force: false,
        userIds: null,
        activeUserIds: ["user-1"],
        inactiveUserIds: [],
        dispatched: true
      })
    );

    expect(result.stdout).toContain("requested: every user");
    expect(result.stdout).toContain("reached: user-1");
    expect(result.stdout).toContain("no state to confirm");
  });

  it("prints the image source and title it broadcast", async () => {
    const result = await runCommand(
      ["image", "show", "--src", "worlds/w/art/map.webp", "--title", "The Vault"],
      respond({
        src: "worlds/w/art/map.webp",
        title: "The Vault",
        userIds: ["user-1"],
        activeUserIds: ["user-1"],
        inactiveUserIds: [],
        dispatched: true
      })
    );

    expect(result.stdout).toContain('Showed image worlds/w/art/map.webp as "The Vault"');
  });

  it("counts the chat log a flush preview would destroy without destroying it", async () => {
    const result = await runCommand(
      ["--dry-run", "chat", "flush"],
      respond({ deleted: 0, count: 137, remaining: 137, dryRun: true })
    );

    expect(result.stdout).toContain("[dry-run] would delete the entire chat log: 137 message(s)");
  });

  it("prints a pause as the state every client now sees", async () => {
    const result = await runCommand(
      ["game", "pause", "--paused", "true"],
      respond({ paused: true, previousPaused: false, changed: true })
    );

    expect(result.stdout).toContain("Set the game to PAUSED for every client");
    expect(result.stdout).toContain("previous: running");
  });

  it("tells the caller a reload drops the bridge and that it comes back on its own", async () => {
    const result = await runCommand(["system", "reload"], respond({ reloading: true }));

    expect(result.stdout).toContain("Reload requested");
    expect(result.stdout).toContain("reconnects on its own");
  });
});

describe("approve-listed commands keep the approval wait loop", () => {
  function approvalThenResult(command: string, result: Record<string, unknown>) {
    const send = vi.fn(async ({ command: sent }: { command: string }) => {
      if (sent === command) {
        return createErrorResponse({
          id: "req-1",
          error: createProtocolError({
            code: ERROR_CODES.APPROVAL_PENDING,
            message: `Command ${command} needs an approval from the GM of this bridge.`,
            details: { approvalId: APPROVAL_ID, expiresAt: Date.now() + 600_000, command }
          })
        });
      }
      return createCommandResponse({
        id: "poll-1",
        result: {
          approvalId: APPROVAL_ID,
          status: "resolved",
          outcome: "approved",
          response: createCommandResponse({ id: APPROVAL_ID, result })
        }
      });
    });
    return send as unknown as SendCommandMock;
  }

  it.each([
    [["chat", "flush"], "chat.flush", { deleted: 3, count: 3, remaining: 0 }, "Flushed the chat log"],
    [["system", "reload"], "system.reload", { reloading: true }, "Reload requested"],
    [
      ["user", "delete", "--user-id", "user-1"],
      "user.delete",
      { id: "user-1", deleted: true },
      "Deleted user user-1"
    ],
    [
      ["user", "create", "--name", "Hrel"],
      "user.create",
      { user: { id: "user-9", name: "Hrel", role: 1, isGM: false, active: false, character: null } },
      "user: Hrel [user-9]"
    ]
  ])(
    "waits for the GM decision on %j and then prints the delivered result",
    async (argv, command, result, expected) => {
      const send = approvalThenResult(command as string, result as Record<string, unknown>);

      const run = await runCommand(argv as string[], send);

      expect(run.error).toBeNull();
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ command }));
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          command: APPROVAL_AWAIT_COMMAND,
          params: expect.objectContaining({ approvalId: APPROVAL_ID })
        })
      );
      expect(run.stdout).toContain(expected as string);
    }
  );
});
