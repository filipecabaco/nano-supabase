import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tests/vitest-setup.ts"],
    testTimeout: 120000,
    hookTimeout: 60000,
    include: ["tests/cli.test.ts"],
  },
});
