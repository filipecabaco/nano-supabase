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
export declare function createPGlite(dataDir?: string, options?: PGliteOptions & {
    extensions?: PGliteOptions["extensions"];
}): PGlite;
export declare const LEAN_POSTGRES_OPTIONS: Pick<PGliteOptions, "startParams">;
//# sourceMappingURL=pglite-factory.d.ts.map