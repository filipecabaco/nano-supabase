/**
 * nanoSupabase — single entry point
 *
 * Creates a fully local Supabase emulator with auth, PostgREST, and storage.
 * Optionally exposes a Postgres TCP socket for tools like Drizzle, Prisma, and psql.
 *
 * @example
 * ```typescript
 * import { nanoSupabase } from "nano-supabase";
 * import { createClient } from "@supabase/supabase-js";
 *
 * const nano = await nanoSupabase();
 * const supabase = createClient("http://localhost:54321", "local-anon-key", {
 *   global: { fetch: nano.localFetch },
 * });
 * ```
 *
 * @example TCP socket (Drizzle, Prisma, psql)
 * ```typescript
 * const nano = await nanoSupabase({ tcp: true });
 * // nano.connectionString === "postgresql://postgres@127.0.0.1:5432/postgres"
 * ```
 *
 * @example Custom port and extensions
 * ```typescript
 * import { vector } from "@electric-sql/pglite/contrib/vector";
 *
 * const nano = await nanoSupabase({
 *   dataDir: "./my-db",
 *   tcp: { port: 5433 },
 *   extensions: { vector },
 * });
 * ```
 *
 * @example Automatic cleanup
 * ```typescript
 * await using nano = await nanoSupabase({ tcp: true });
 * // nano.stop() is called automatically on scope exit
 * ```
 *
 * For the simplest possible usage, use the top-level `createClient`:
 *
 * ```typescript
 * import { createClient } from "nano-supabase";
 *
 * const supabase = await createClient();
 * await supabase.auth.signUp({ email: "...", password: "..." });
 * ```
 */
import type { PGliteOptions } from "@electric-sql/pglite";
import type { SupabaseClient, SupabaseClientOptions } from "@supabase/supabase-js";
import type { StorageBackend } from "./storage/backend.ts";
import { createPGlite } from "./pglite-factory.ts";
export interface NanoSupabaseOptions {
    /** Persistence path. Omit for in-memory. `"idb://name"` for browser IndexedDB. */
    dataDir?: string;
    /** Additional PGlite extensions (pgcrypto and uuid_ossp are always included). */
    extensions?: PGliteOptions["extensions"];
    /**
     * Expose a Postgres TCP socket.
     * `true` uses defaults (port 5432, host 127.0.0.1).
     * Pass `{ port, host }` to customise.
     */
    tcp?: boolean | {
        port?: number;
        host?: string;
    };
    /** Custom storage blob backend. `false` disables storage emulation. */
    storageBackend?: StorageBackend | false;
    /** Enable debug logging. */
    debug?: boolean;
    /**
     * Pre-compiled PGlite WebAssembly module. When provided, bypasses filesystem loading.
     * Used by the CLI binary to embed assets at compile time.
     */
    wasmModule?: WebAssembly.Module;
    /**
     * PGlite filesystem bundle (pglite.data). When provided, bypasses filesystem loading.
     * Used by the CLI binary to embed assets at compile time.
     */
    fsBundle?: Blob | File;
    /**
     * Pre-loaded PostgREST parser WASM bytes. When provided, bypasses fetch-based loading.
     * Used by the CLI binary to embed assets at compile time.
     */
    postgrestWasmBytes?: Uint8Array;
}
export interface NanoSupabaseInstance {
    /** The underlying PGlite instance — use for raw SQL or schema setup. */
    db: ReturnType<typeof createPGlite>;
    /**
     * Drop-in fetch replacement for `@supabase/supabase-js`.
     *
     * ```ts
     * const supabase = createClient(url, key, { global: { fetch: nano.localFetch } });
     * ```
     */
    localFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    /**
     * Create a Supabase client pre-wired to this emulator.
     * `localFetch` is injected automatically; `url` and `key` default to local values.
     * Any option can be overridden.
     *
     * ```ts
     * const supabase = nano.createClient();
     * const supabase = nano.createClient({ auth: { persistSession: false } });
     * const typed = nano.createClient<Database>();
     * ```
     */
    createClient<Database = unknown>(options?: SupabaseClientOptions<string> & {
        url?: string;
        key?: string;
    }): SupabaseClient<Database>;
    /**
     * Postgres connection string for the TCP socket.
     * `null` when TCP is not enabled.
     *
     * ```ts
     * const db = drizzle(nano.connectionString!);
     * ```
     */
    connectionString: string | null;
    /** Shut down the TCP server (if running) and close the database. */
    stop(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
}
/**
 * Drop-in replacement for `createClient` from `@supabase/supabase-js`.
 *
 * Returns a fully-local Supabase client with auth, PostgREST, and storage —
 * no Supabase project or network required.
 *
 * @example
 * ```typescript
 * import { createClient } from "nano-supabase";
 *
 * const supabase = await createClient();
 * await supabase.auth.signUp({ email: "user@example.com", password: "password" });
 * const { data } = await supabase.from("todos").select("*");
 * ```
 *
 * @example With a typed schema and persistence
 * ```typescript
 * import { createClient } from "nano-supabase";
 * import type { Database } from "./database.types";
 *
 * const supabase = await createClient<Database>({ dataDir: "./my-db" });
 * ```
 */
export declare function createClient<Database = unknown>(options?: NanoSupabaseOptions & SupabaseClientOptions<string> & {
    url?: string;
    key?: string;
}): Promise<SupabaseClient<Database>>;
export declare function nanoSupabase(options?: NanoSupabaseOptions): Promise<NanoSupabaseInstance>;
//# sourceMappingURL=nano.d.ts.map