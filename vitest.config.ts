import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		setupFiles: ["./tests/vitest-setup.ts"],
		testTimeout: 60000,
		include: ["tests/**/*.test.ts"],
		exclude: ["tests/cli.test.ts", "tests/e2e/**"],
		pool: "forks",
		maxForks: 1,
	},
});
