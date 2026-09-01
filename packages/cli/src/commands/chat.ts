import { Option } from "commander";

import { createChatCreateParams } from "../params.js";
import { executeRemoteCommand } from "../exec.js";
import { parseBoolean, parseNumber, parseWhisperIds } from "../parse.js";
import {
  type RegistrationContext,
  addIdempotencyKeyOption,
  addPaginationOptions,
  paginationParams
} from "./shared.js";
import { write } from "../deps.js";

export function registerChat({ program, dependencies }: RegistrationContext) {
  const chat = program.command("chat").description("Foundry chat message commands");
  chat.addHelpText(
    "after",
    "\nResult key (--json): .result.message (single/write) / .result.messages[] (list)."
  );

  addPaginationOptions(chat.command("list")).action(async function listChat(options: {
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "chat.list",
      params: { ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  chat
    .command("get")
    .requiredOption("--message-id <messageId>", "Chat message id")
    .action(async function getChat(options: { messageId: string }) {
      await executeRemoteCommand({
        commandName: "chat.get",
        params: { messageId: options.messageId },
        command: this,
        dependencies
      });
    });
  addIdempotencyKeyOption(chat.command("create"))
    .option("--content <content>", "Message text/HTML")
    .option("--whisper <userIds>", "Comma-separated user ids to whisper to (raw ids)", parseWhisperIds)
    .option("--roll <formula>", "Dice/roll formula (e.g. 2d6+3) evaluated via the Roll API")
    .option("--flavor <flavor>", "Flavor text")
    .addOption(new Option("--blind <blind>", "Blind roll/whisper").argParser(parseBoolean))
    .addOption(
      new Option("--style <style>", "Message style number (advanced; Foundry validates)").argParser(
        parseNumber
      )
    )
    .option("--sound <sound>", "Sound file path to play with the message")
    .option("--speaker-json <json>", "Speaker object as JSON (scene/actor/token/alias)")
    .option("--alias <alias>", "Convenience: sets speaker.alias")
    .action(async function createChatCommand(options: {
      content?: string;
      whisper?: string[];
      roll?: string;
      flavor?: string;
      blind?: boolean;
      style?: number;
      sound?: string;
      speakerJson?: string;
      alias?: string;
    }) {
      await executeRemoteCommand({
        commandName: "chat.create",
        params: createChatCreateParams(options),
        command: this,
        dependencies
      });
    });
  chat
    .command("flush")
    .description(
      "Delete the ENTIRE chat log (irreversible). --dry-run reports the message count without deleting anything"
    )
    .action(async function flushChat() {
      await executeRemoteCommand({
        commandName: "chat.flush",
        params: {},
        command: this,
        dependencies
      });
    });
  chat
    .command("delete")
    .requiredOption("--message-id <messageId>", "Chat message id")
    .action(async function deleteChat(options: { messageId: string }) {
      await executeRemoteCommand({
        commandName: "chat.delete",
        params: { messageId: options.messageId },
        command: this,
        dependencies
      });
    });
}
