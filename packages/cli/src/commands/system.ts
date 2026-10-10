import type { RegistrationContext } from "./shared.js";
import { executeRemoteCommand } from "../exec.js";
import { parseSystemInfoIncludeFields } from "../parse.js";

interface SystemInfoOptions {
  include?: string[];
}

export function registerSystem({ program, dependencies }: RegistrationContext) {
  const system = program.command("system").description("Foundry bridge system commands");
  system.addHelpText(
    "after",
    "\nResult key (--json): .result.pong + .result.bridge (ping); .result.foundry.* / .result.system.* / .result.world.* / .result.module.* / .result.moduleCount / .result.activeModuleCount / .result.modules[] (with --include modules) / .result.bridge.* / .result.limits.* (info)."
  );
  system.command("ping").action(async function ping() {
    await executeRemoteCommand({
      commandName: "system.ping",
      params: {},
      command: this,
      dependencies
    });
  });
  system
    .command("info")
    .option(
      "--include <fields>",
      "Comma-separated extra fields (modules adds the installed module list)",
      parseSystemInfoIncludeFields
    )
    .action(async function info(options: SystemInfoOptions) {
      await executeRemoteCommand({
        commandName: "system.info",
        params: options.include ? { include: options.include } : {},
        command: this,
        dependencies
      });
    });
  system
    .command("reload")
    .description(
      "Reload the GM browser page. The bridge drops and reconnects on its own; pair it with a setting whose row reports requiresReload"
    )
    .action(async function reload() {
      await executeRemoteCommand({
        commandName: "system.reload",
        params: {},
        command: this,
        dependencies
      });
    });
}
