import { executeRemoteCommand } from "../exec.js";
import {
  type RegistrationContext,
  addNameFilterOption,
  addPaginationOptions,
  nameFilterParams,
  paginationParams
} from "./shared.js";

export function registerUser({ program, dependencies }: RegistrationContext) {
  const user = program.command("user").description("Foundry user commands (read-only)");
  user.addHelpText("after", "\nResult key (--json): .result.user (get) / .result.users[] (list).");
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
}
