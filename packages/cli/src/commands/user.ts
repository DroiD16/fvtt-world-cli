import { Option } from "commander";

import { createUserCreateParams, createUserUpdateParams, type UserFieldOptions } from "../params.js";
import { executeRemoteCommand } from "../exec.js";
import { parseUserPermissions, parseUserRole } from "../parse.js";
import { addUserFieldOptions } from "./field-options.js";
import {
  type RegistrationContext,
  addIdempotencyKeyOption,
  addNameFilterOption,
  addPaginationOptions,
  nameFilterParams,
  paginationParams
} from "./shared.js";

export function registerUser({ program, dependencies }: RegistrationContext) {
  const user = program.command("user").description("Foundry user commands");
  user.addHelpText(
    "after",
    [
      "",
      "Result key (--json): .result.user (get, create, update) / .result.users[] (list). `delete`,",
      "`role set` and `permissions set` return their fields directly on .result.",
      "",
      "No user command accepts a password: Foundry sends passwords in the clear and hashes them",
      "server-side, so account credentials stay outside the bridge. `role set` and `permissions set`",
      "are OFF by default (a GM enables them); `create` and `delete` ask the GM for approval. Neither",
      "`role set` nor `delete` accepts the GM user the bridge itself runs through — the agent cannot",
      "demote or remove its own account.",
      "Roles are integers: 1=player, 2=trusted player, 3=assistant GM, 4=gamemaster."
    ].join("\n")
  );
  addNameFilterOption(addPaginationOptions(user.command("list"))).action(async function listUsers(options: {
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "user.list",
      params: { ...nameFilterParams(options), ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  user
    .command("get")
    .requiredOption("--user-id <userId>", "User id")
    .action(async function getUser(options: { userId: string }) {
      await executeRemoteCommand({
        commandName: "user.get",
        params: { userId: options.userId },
        command: this,
        dependencies
      });
    });
  addUserFieldOptions(
    addIdempotencyKeyOption(user.command("create"))
      .description("Create a player account (needs GM approval; no password is set)")
      .requiredOption("--name <name>", "User name")
      .addOption(
        new Option(
          "--role <role>",
          "Role for the new user (1=player, 2=trusted player, 3=assistant GM, 4=gamemaster; default player)"
        ).argParser(parseUserRole)
      ),
    "create"
  )
    .option("--data-json <json>", "Extra user fields (e.g. flags) as a JSON object (merged last)")
    .action(async function createUser(options: UserFieldOptions & { name: string; role?: number }) {
      await executeRemoteCommand({
        commandName: "user.create",
        params: createUserCreateParams(options),
        command: this,
        dependencies
      });
    });
  addUserFieldOptions(
    user
      .command("update")
      .description("Edit a user's presentation fields (the role has its own command)")
      .requiredOption("--user-id <userId>", "User id")
      .option("--name <name>", "New user name"),
    "update"
  )
    .option("--patch-json <json>", "Extra user patch fields (e.g. flags) as a JSON object (merged last)")
    .action(async function updateUser(options: UserFieldOptions & { userId: string; name?: string }) {
      await executeRemoteCommand({
        commandName: "user.update",
        params: createUserUpdateParams(options),
        command: this,
        dependencies
      });
    });
  user
    .command("delete")
    .description("Delete a user account (needs GM approval; refuses the bridge's own GM user)")
    .requiredOption("--user-id <userId>", "User id")
    .action(async function deleteUser(options: { userId: string }) {
      await executeRemoteCommand({
        commandName: "user.delete",
        params: { userId: options.userId },
        command: this,
        dependencies
      });
    });
  const userRole = user.command("role").description("User role (which capabilities the role grants)");
  userRole
    .command("set")
    .description("Set a user's role (OFF by default; refuses the bridge's own GM user)")
    .requiredOption("--user-id <userId>", "User id")
    .requiredOption(
      "--role <role>",
      "New role (1=player, 2=trusted player, 3=assistant GM, 4=gamemaster)",
      parseUserRole
    )
    .action(async function setUserRole(options: { userId: string; role: number }) {
      await executeRemoteCommand({
        commandName: "user.role.set",
        params: { userId: options.userId, role: options.role },
        command: this,
        dependencies
      });
    });
  const userPermissions = user
    .command("permissions")
    .description("Per-user permission overrides on top of the role defaults");
  userPermissions
    .command("set")
    .description("Grant, revoke or drop per-user permission overrides (OFF by default)")
    .requiredOption("--user-id <userId>", "User id")
    .requiredOption(
      "--permissions-json <json>",
      'Overrides as a JSON object, e.g. {"FILES_UPLOAD":true,"MACRO_SCRIPT":false,"BROADCAST_AUDIO":null} — true grants, false revokes, null drops the override so the role default applies again. Names are validated against the installed Foundry version.',
      parseUserPermissions
    )
    .action(async function setUserPermissions(options: {
      userId: string;
      permissionsJson: Record<string, unknown>;
    }) {
      await executeRemoteCommand({
        commandName: "user.permissions.set",
        params: { userId: options.userId, permissions: options.permissionsJson },
        command: this,
        dependencies
      });
    });
}
