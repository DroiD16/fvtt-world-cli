import type { RegistrationContext } from "./shared.js";
import { executeRemoteCommand } from "../exec.js";

export function registerSystem({ program, dependencies }: RegistrationContext) {
  const system = program.command("system").description("Foundry bridge system commands");
  system.addHelpText(
    "after",
    "\nResult key (--json): .result.pong + .result.bridge (ping); .result.foundry.* / .result.system.* / .result.world.* / .result.module.* / .result.modules[] / .result.bridge.* / .result.limits.* / .result.commands[] (info)."
  );
  system.command("ping").action(async function ping() {
    await executeRemoteCommand({
      commandName: "system.ping",
      params: {},
      command: this,
      dependencies
    });
  });
  system.command("info").action(async function info() {
    await executeRemoteCommand({
      commandName: "system.info",
      params: {},
      command: this,
      dependencies
    });
  });
  system
    .command("reload")
    .description(
      "Reload the GM browser page (needs GM approval). The bridge drops and reconnects on its own; pair it with a setting whose row reports requiresReload"
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
