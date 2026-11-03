import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll } from "vitest";

const home = mkdtempSync(join(tmpdir(), "fvtt-world-cli-test-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, ".config");

process.on("exit", () => rmSync(home, { recursive: true, force: true }));

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});
