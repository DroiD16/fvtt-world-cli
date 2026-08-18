import { cmd, emptyObjectSchema } from "./shared.js";

export const systemCommands = {
  "system.ping": cmd(emptyObjectSchema),
  "system.info": cmd(emptyObjectSchema)
};
