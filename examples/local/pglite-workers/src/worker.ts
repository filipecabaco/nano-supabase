import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { worker } from "@electric-sql/pglite/worker";

worker({
	async init(options) {
		return new PGlite({
			dataDir: options?.dataDir ?? "idb://pglite-workers-demo",
			extensions: { pgcrypto, uuid_ossp, ...options?.extensions },
		});
	},
});
