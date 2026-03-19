/**
 * PGlite factory
 *
 * Creates a PGlite instance with all extensions required by nano-supabase
 * pre-registered. Use this instead of `new PGlite()` to avoid missing
 * extension errors at schema initialisation time.
 *
 * Required extensions:
 *  - pgcrypto — needed for password hashing, HMAC, and JWT signing
 *
 * @example
 * ```typescript
 * import { createPGlite } from 'nano-supabase'
 *
 * const db = createPGlite()                    // in-memory
 * const db = createPGlite('./my-db')           // persistent (Node/Bun)
 * const db = createPGlite('idb://my-db')       // persistent (browser IndexedDB)
 *
 * // With extra extensions
 * import { vector } from '@electric-sql/pglite/contrib/vector'
 * const db = createPGlite(undefined, { extensions: { vector } })
 * ```
 */

import { PGlite, type PGliteOptions } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";

export function createPGlite(
	dataDir?: string,
	options?: PGliteOptions & { extensions?: PGliteOptions["extensions"] },
): PGlite {
	const ext = { pgcrypto, uuid_ossp, ...options?.extensions };
	const opts = { ...options, extensions: ext };
	return dataDir ? new PGlite(dataDir, opts) : new PGlite(opts);
}
