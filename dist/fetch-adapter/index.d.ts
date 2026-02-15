/**
 * Scoped Fetch Adapter
 *
 * Creates a custom fetch function that intercepts Supabase API calls:
 * - /auth/v1/*     -> Local auth handler
 * - /rest/v1/*     -> Local PostgREST parser + PGlite
 * - /storage/v1/*  -> Local storage handler (blobs + metadata)
 * - Everything else -> Passthrough to original fetch
 *
 * This allows using the standard @supabase/supabase-js client with local emulation
 * while still being able to interact with other APIs and Supabase products
 * (Realtime, Edge Functions, etc.)
 */
import type { PGlite } from "@electric-sql/pglite";
import type { PostgrestParser } from "../postgrest-parser.ts";
import type { AuthHandler } from "../auth/handler.ts";
import type { StorageHandler } from "../storage/handler.ts";
export interface FetchAdapterConfig {
    /** The PGlite database instance */
    db: PGlite;
    /** The PostgREST parser instance */
    parser: PostgrestParser;
    /** The auth handler instance */
    authHandler: AuthHandler;
    /** The storage handler instance (optional — enables /storage/v1/* interception) */
    storageHandler?: StorageHandler;
    /** The Supabase URL to intercept (used to match requests) */
    supabaseUrl: string;
    /**
     * Original fetch function to use for passthrough requests
     * Defaults to globalThis.fetch
     */
    originalFetch?: typeof fetch;
    /**
     * Enable debug logging
     */
    debug?: boolean;
}
/**
 * Create a scoped fetch adapter that intercepts Supabase requests
 *
 * @example
 * ```typescript
 * import { createClient } from '@supabase/supabase-js'
 * import { createLocalFetch } from 'nano-supabase'
 *
 * const db = new PGlite()
 * const { fetch: localFetch, authHandler } = await createLocalFetch({
 *   db,
 *   parser,
 *   authHandler,
 *   supabaseUrl: 'http://localhost:54321',
 * })
 *
 * const supabase = createClient('http://localhost:54321', 'your-anon-key', {
 *   global: { fetch: localFetch }
 * })
 *
 * // Now auth, data, and storage calls are handled locally
 * await supabase.auth.signUp({ email: 'user@example.com', password: 'password' })
 * await supabase.from('users').select('*')
 * await supabase.storage.from('avatars').upload('avatar.png', file)
 *
 * // Other calls (realtime, edge functions) pass through to the network
 * ```
 */
export declare function createLocalFetch(config: FetchAdapterConfig): typeof fetch;
export { handleAuthRoute } from "./auth-routes.ts";
export { handleDataRoute } from "./data-routes.ts";
export { handleStorageRoute } from "./storage-routes.ts";
//# sourceMappingURL=index.d.ts.map