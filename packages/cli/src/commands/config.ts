import { join } from "node:path";

import { Command } from "commander";

import type { RegistrationContext } from "./shared.js";
import { getStoredConfig, maskConfigForOutput, renderConfigGetHumanOutput } from "../config-io.js";
import { parseUploadLimitBytes, writeCliConfigUpdate } from "../config.js";
import { write } from "../deps.js";

export function registerConfig({ program, dependencies }: RegistrationContext) {
  const config = program.command("config").description("Inspect or update local CLI configuration");
  config
    .command("get")
    .description("Show the persisted local CLI configuration")
    .action(function getConfig(this: Command) {
      const configPath = dependencies.configStore.getConfigPath();
      const persistedConfig = getStoredConfig(dependencies);
      const displayConfig = maskConfigForOutput(persistedConfig);
      const payload = {
        configPath,
        exists: persistedConfig !== null,
        config: displayConfig
      };

      if (Boolean(this.optsWithGlobals().json)) {
        write(dependencies.stdout, `${JSON.stringify(payload, null, 2)}\n`);
        return;
      }

      write(dependencies.stdout, `${renderConfigGetHumanOutput(configPath, displayConfig)}\n`);
    });
  config
    .command("set-upload-limit")
    .description("Persist the file.upload size limit (raw bytes, pre-base64) for the daemon and CLI")
    .argument("<size>", "Upload size limit as bytes or a size like 100MiB (max 512MiB)")
    .action(function setUploadLimit(this: Command, size: string) {
      const uploadLimitBytes = parseUploadLimitBytes(size);
      writeCliConfigUpdate(dependencies.configStore, { uploadLimitBytes });

      const payload = {
        configPath: dependencies.configStore.getConfigPath(),
        uploadLimitBytes,
        daemonRestartRequired: true
      };

      if (Boolean(this.optsWithGlobals().json)) {
        write(dependencies.stdout, `${JSON.stringify(payload, null, 2)}\n`);
        return;
      }

      write(
        dependencies.stdout,
        [
          `Saved upload limit to ${payload.configPath}`,
          `Upload limit: ${uploadLimitBytes} bytes`,
          "Restart any running daemon to apply the new transport limit."
        ].join("\n") + "\n"
      );
    });
}
