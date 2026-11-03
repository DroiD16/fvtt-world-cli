import { cmd, emptyObjectSchema } from "./shared.js";

export const systemCommands = {
  "system.ping": cmd(emptyObjectSchema),
  "system.info": cmd({
    type: "object",
    required: [],
    properties: {
      include: { type: "array", items: { type: "string", enum: ["modules"] } }
    },
    additionalProperties: false
  }),
  "system.reload": cmd(emptyObjectSchema)
};
