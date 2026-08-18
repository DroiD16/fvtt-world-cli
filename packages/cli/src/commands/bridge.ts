import { DEFAULT_UPLOAD_SIZE_LIMIT_BYTES } from "@fvtt-world-cli/protocol";
import { Command } from "commander";

import type { RegistrationContext } from "./shared.js";
import { createDaemonControlRunner } from "../daemon-control.js";
import { getBridgeDaemonConfig, getStoredConfig } from "../config-io.js";
import { parsePositiveInt } from "../parse.js";
import { parseUploadLimitBytes, resolveEffectiveUploadLimitBytes } from "../config.js";
import { syncInstalledSkillCopies } from "../skill.js";
import { type BridgeDaemonOptions } from "../bridge/daemon.js";
import { write } from "../deps.js";

export function registerBridge({ program, dependencies }: RegistrationContext) {
  const runDaemonControl = createDaemonControlRunner(dependencies);
  const bridge = program.command("bridge").description("Run or manage the local bridge daemon");
  bridge.command("release").action(function releaseBridge(this: Command) {
    return runDaemonControl(this, "bridge.release");
  });
  bridge
    .command("serve")
    .description("Start the local bridge daemon")
    .option("--request-timeout-ms <ms>", "Response timeout for forwarded Foundry requests", parsePositiveInt)
    .option(
      "--upload-limit-bytes <size>",
      "Override the file.upload size limit as bytes or a size like 100MiB (max 512MiB)"
    )
    .action(async function serveBridge(options: { requestTimeoutMs?: number; uploadLimitBytes?: string }) {
      const bridgeConfig = getBridgeDaemonConfig(this, options, dependencies);

      const flagUploadLimitBytes =
        typeof options.uploadLimitBytes === "string"
          ? parseUploadLimitBytes(options.uploadLimitBytes)
          : undefined;
      const uploadLimitBytes = resolveEffectiveUploadLimitBytes({
        flagUploadLimitBytes,
        persistedConfig: getStoredConfig(dependencies)
      });
      const daemonOptions: BridgeDaemonOptions = {
        daemonUrl: bridgeConfig.daemonUrl,

        ...(uploadLimitBytes !== DEFAULT_UPLOAD_SIZE_LIMIT_BYTES ? { uploadLimitBytes } : {}),
        configStore: dependencies.configStore,
        config: getStoredConfig(dependencies),
        ...(typeof options.requestTimeoutMs === "number"
          ? { requestTimeoutMs: options.requestTimeoutMs }
          : {})
      };
      const daemon = dependencies.createBridgeDaemon(daemonOptions);

      await daemon.start();
      syncInstalledSkillCopies(dependencies);
      const info = daemon.getConnectionInfo();
      write(dependencies.stdout, `Listening on ${info.daemonUrl}\n`);
      write(dependencies.stdout, `Upload limit: ${uploadLimitBytes} bytes\n`);

      await new Promise<void>((resolve, reject) => {
        const stop = async () => {
          process.off("SIGINT", onSigInt);
          process.off("SIGTERM", onSigTerm);

          try {
            await daemon.stop();
            resolve();
          } catch (error) {
            reject(error);
          }
        };

        const onSigInt = () => {
          void stop();
        };
        const onSigTerm = () => {
          void stop();
        };

        process.on("SIGINT", onSigInt);
        process.on("SIGTERM", onSigTerm);
      });
    });
}
