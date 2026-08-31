import { cmd, dryRunProperty } from "./shared.js";

export const gameCommands = {
  "game.pause": cmd(
    {
      type: "object",
      required: ["paused"],
      properties: {
        paused: { type: "boolean" },
        ...dryRunProperty
      },
      additionalProperties: false
    },
    { mutation: true }
  )
};
