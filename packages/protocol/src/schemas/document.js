import { cmd } from "./shared.js";

export const documentCommands = {
  "document.resolve": cmd({
    type: "object",
    required: ["uuid"],
    properties: {
      uuid: { type: "string", minLength: 1 }
    },
    additionalProperties: false
  })
};
