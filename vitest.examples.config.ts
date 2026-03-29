import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tests/vitest-setup.ts"],
    testTimeout: 60000,
    include: ["examples/tests/**/*.test.ts"],
    pool: "forks",
    maxForks: 1,
  },
});
