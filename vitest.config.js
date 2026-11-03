import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/tests/**/*.test.{js,ts}"],
    environment: "node",
    setupFiles: ["./vitest.setup.js"]
  }
});
