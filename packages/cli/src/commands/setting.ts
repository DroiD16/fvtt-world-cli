import { join } from "node:path";

import { executeRemoteCommand } from "../exec.js";
import {
  type RegistrationContext,
  addNameFilterOption,
  addPaginationOptions,
  nameFilterParams,
  paginationParams
} from "./shared.js";

export function registerSetting({ program, dependencies }: RegistrationContext) {
  const setting = program.command("setting").description("Foundry game settings (read-only)");
  setting.addHelpText(
    "after",
    [
      "",
      "Result key (--json): .result.settings[] (list, metadata only) / .result.setting (get, metadata + value).",
      "",
      "Only settings REGISTERED IN THIS SESSION are visible: a value still stored in the world by a",
      "disabled/uninstalled module has no registration and reports SETTING_NOT_FOUND.",
      "`--name` matches the namespace, the key, the raw registration name AND the localized label.",
      "Scope caveats: a `client`-scope value is this GM CLIENT's localStorage value, and a `user`-scope",
      "value is resolved for the CURRENT GM USER — neither is ever another player's value."
    ].join("\n")
  );
  addNameFilterOption(addPaginationOptions(setting.command("list"))).action(
    async function listSettings(options: { name?: string; limit?: number; offset?: number }) {
      await executeRemoteCommand({
        commandName: "setting.list",
        params: { ...nameFilterParams(options), ...paginationParams(options) },
        command: this,
        dependencies
      });
    }
  );
  setting
    .command("get")
    .requiredOption("--namespace <namespace>", 'Setting namespace (e.g. "core" or a module id)')
    .requiredOption("--key <key>", "Setting key within the namespace")
    .action(async function getSetting(options: { namespace: string; key: string }) {
      await executeRemoteCommand({
        commandName: "setting.get",
        params: { namespace: options.namespace, key: options.key },
        command: this,
        dependencies
      });
    });
}
