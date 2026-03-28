import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { worker } from "@electric-sql/pglite/worker";

worker({
	async init(options) {
		const db = new PGlite({
			dataDir: options?.dataDir ?? "idb://pglite-workers-demo",
			extensions: { pgcrypto, uuid_ossp, ...options?.extensions },
		});

		await db.waitReady;

		await db.exec(`
			CREATE TABLE IF NOT EXISTS todos (
				id SERIAL PRIMARY KEY,
				title TEXT NOT NULL,
				done BOOLEAN NOT NULL DEFAULT false,
				created_at TIMESTAMP NOT NULL DEFAULT NOW()
			)
		`);

		return db;
	},
});
