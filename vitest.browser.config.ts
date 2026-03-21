import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		setupFiles: ["./tests/e2e/browser-setup.ts"],
		testTimeout: 60000,
		include: ["tests/e2e/browser.test.ts"],
		browser: {
			enabled: true,
			provider: playwright(),
			instances: [{ browser: "chromium" }],
		},
	},
	assetsInclude: ["**/*.wasm"],
});
