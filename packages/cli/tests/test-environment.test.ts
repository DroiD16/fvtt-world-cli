import { homedir, userInfo } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

it("runs every test with a home and config directory outside the user's real home", () => {
  expect(homedir()).not.toBe(userInfo().homedir);
  expect(process.env.HOME).toBe(homedir());
  expect(process.env.USERPROFILE).toBe(homedir());
  expect(process.env.XDG_CONFIG_HOME).toBe(join(homedir(), ".config"));
});
