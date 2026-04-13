import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { worker } from "@electric-sql/pglite/worker";

worker({
	async init(options) {
		return new PGlite({
			dataDir: options?.dataDir ?? "idb://pglite-fuzzy-search",
			extensions: { pg_trgm, ...options?.extensions },
		});
	},
});
