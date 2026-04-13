import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

function wasmMimePlugin(): Plugin {
	return {
		name: "wasm-mime",
		configureServer(server) {
			server.middlewares.use((_req, res, next) => {
				if (_req.url?.endsWith(".wasm")) {
					res.setHeader("Content-Type", "application/wasm");
				}
				next();
			});
		},
	};
}

export default defineConfig({
	plugins: [react(), wasmMimePlugin()],
	optimizeDeps: {
		exclude: ["@electric-sql/pglite"],
	},
	build: {
		rollupOptions: {
			external: [
				"node:fs/promises",
				"node:path",
				"node:buffer",
				"node:crypto",
				"node:net",
				"node:tls",
			],
		},
	},
	worker: {
		format: "es",
	},
});
