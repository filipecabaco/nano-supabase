import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		setupFiles: ["./tests/vitest-setup.ts"],
		testTimeout: 60000,
		include: ["tests/**/*.test.ts"],
		exclude: ["tests/cli.test.ts"],
		pool: "forks",
		maxForks: 1,
	},
});
