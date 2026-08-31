import { cmd, userIdsProperty } from "./shared.js";

export const imageCommands = {
  "image.show": cmd({
    type: "object",
    required: ["src"],
    properties: {
      src: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1 },
      ...userIdsProperty
    },
    additionalProperties: false
  })
};
