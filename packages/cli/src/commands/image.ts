import type { RegistrationContext } from "./shared.js";
import { executeRemoteCommand } from "../exec.js";
import { parseCsvList } from "../parse.js";

export function registerImage({ program, dependencies }: RegistrationContext) {
  const image = program.command("image").description("Foundry image popout commands");
  image.addHelpText(
    "after",
    [
      "",
      "Result key (--json): .result.src, .result.title, .result.userIds, .result.activeUserIds,",
      ".result.inactiveUserIds and .result.dispatched (show).",
      "",
      "`--src` takes a path inside Foundry's managed `data` source (e.g. worlds/<worldId>/art/map.webp)",
      "or an http(s) URL. A host filesystem path is refused. Showing an image is a broadcast, not a",
      "mutation: nothing is written and nothing can be confirmed afterwards."
    ].join("\n")
  );
  image
    .command("show")
    .description("Pop an image out in other users' browsers")
    .requiredOption("--src <src>", "Managed data-relative image path or http(s) URL")
    .option("--title <title>", "Window title (default: derived by Foundry from the source)")
    .option(
      "--user-ids <list>",
      "Comma-separated user ids to show it to (default: every user); offline users are reported as skipped",
      (value: string) => parseCsvList(value, "--user-ids")
    )
    .action(async function showImage(options: { src: string; title?: string; userIds?: string[] }) {
      await executeRemoteCommand({
        commandName: "image.show",
        params: {
          src: options.src,
          ...(options.title !== undefined ? { title: options.title } : {}),
          ...(options.userIds ? { userIds: options.userIds } : {})
        },
        command: this,
        dependencies
      });
    });
}
