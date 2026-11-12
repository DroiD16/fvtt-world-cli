import { SERIALIZE_OMISSIONS_MAX } from "@fvtt-world-cli/protocol";
import { Option } from "commander";

import { createSettingSetParams, resolveSettingItems } from "../params.js";
import { executeRemoteCommand } from "../exec.js";
import { parseIdList, parseJsonValue, parseSettingItems } from "../parse.js";
import {
  type RegistrationContext,
  addNameFilterOption,
  addPaginationOptions,
  nameFilterParams,
  paginationParams
} from "./shared.js";

export function registerSetting({ program, dependencies }: RegistrationContext) {
  const setting = program.command("setting").description("Foundry game settings");
  setting.addHelpText(
    "after",
    [
      "",
      "Result key (--json): .result.settings[] (list, metadata only; get-many, metadata + value) /",
      ".result.setting (get, metadata + value). A write returns the row's fields directly on .result",
      "(namespace, key, scope, previous, value, requiresReload, changed) — set-many returns .result.outcomes[].",
      "",
      "Only settings REGISTERED IN THIS SESSION are visible: a value still stored in the world by a",
      "disabled/uninstalled module has no registration and reports SETTING_NOT_FOUND.",
      "`--name` matches the namespace, the key, the raw registration name AND the localized label.",
      "Scope caveats: a `client`-scope value is this GM CLIENT's localStorage value, and a `user`-scope",
      "value is resolved for the CURRENT GM USER — neither is ever another player's value.",
      "",
      "`set`/`set-many` always refuse the `fvtt-world-cli` namespace, so the bridge's own",
      "authorization settings stay beyond the CLI's reach. A write whose row reports",
      "requiresReload:true needs `system reload`",
      "(or a manual browser reload) before Foundry acts on it."
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
    .addHelpText(
      "after",
      `\nA value node with no JSON form (an accessor property, a function, a circular reference) comes back as {"$unserializable": "<reason>"} and is listed in .result.setting.valueOmissions (at most ${SERIALIZE_OMISSIONS_MAX} entries; valueOmissionsTruncated marks a longer list). Such a value is incomplete: writing it back with setting set stores the markers as data.`
    )
    .action(async function getSetting(options: { namespace: string; key: string }) {
      await executeRemoteCommand({
        commandName: "setting.get",
        params: { namespace: options.namespace, key: options.key },
        command: this,
        dependencies
      });
    });
  setting
    .command("get-many")
    .description(
      "Read several settings in ONE call (an unknown id reports its own error, not the whole call)"
    )
    .requiredOption(
      "--ids <list>",
      'Comma-separated setting ids in "namespace.key" form (e.g. core.chatBubbles,my-module.apiKey)',
      parseIdList
    )
    .addHelpText("after", "\nEach row reports omissions like setting get, in valueOmissions.")
    .action(async function getManySettings(options: { ids: string[] }) {
      await executeRemoteCommand({
        commandName: "setting.get-many",
        params: { ids: options.ids },
        command: this,
        dependencies
      });
    });
  setting
    .command("set")
    .description("Write one registered setting")
    .requiredOption("--namespace <namespace>", 'Setting namespace (e.g. "core" or a module id)')
    .requiredOption("--key <key>", "Setting key within the namespace")
    .requiredOption(
      "--value-json <json>",
      'New value as a JSON literal — true, 42, "text", [..] or {..}; a quoted string stays distinct from a boolean or a number',
      (value: string) => parseJsonValue(value, "--value-json")
    )
    .addHelpText(
      "after",
      '\nprevious and value report omissions like setting get, in previousOmissions and valueOmissions. {"$unserializable": ...} markers in --value-json are stored as data.'
    )
    .action(async function setSetting(options: { namespace: string; key: string; valueJson: unknown }) {
      await executeRemoteCommand({
        commandName: "setting.set",
        params: createSettingSetParams(options),
        command: this,
        dependencies
      });
    });
  setting
    .command("set-many")
    .description("Write several settings in ONE call (stops at the first element Foundry refuses)")
    .addOption(
      new Option(
        "--items-json <json>",
        'Setting writes as a JSON ARRAY of {"namespace","key","value"} objects'
      ).argParser((value: string) => parseSettingItems(value, "--items-json"))
    )
    .addOption(new Option("--items-stdin", "Read that JSON array from stdin instead").conflicts("itemsJson"))
    .action(async function setManySettings(options: {
      itemsJson?: Record<string, unknown>[];
      itemsStdin?: boolean;
    }) {
      const items = await resolveSettingItems(options, dependencies);
      await executeRemoteCommand({
        commandName: "setting.set-many",
        params: { items },
        command: this,
        dependencies
      });
    });
}
