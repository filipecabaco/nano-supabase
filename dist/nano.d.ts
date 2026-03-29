import type { PGliteOptions } from "@electric-sql/pglite";
import type { SupabaseClient, SupabaseClientOptions } from "@supabase/supabase-js";
import { createPGlite } from "./pglite-factory.ts";
import type { PostgrestParser } from "./postgrest-parser.ts";
import type { StorageBackend } from "./storage/backend.ts";
export interface NanoSupabaseOptions {
    dataDir?: string;
    extensions?: PGliteOptions["extensions"];
    tcp?: boolean | {
        port?: number;
        host?: string;
    };
    storageBackend?: StorageBackend | false;
    debug?: boolean;
    pgliteWasmModule?: WebAssembly.Module;
    fsBundle?: Blob | File;
    postgrestWasmBytes?: Uint8Array;
    serviceRoleKey?: string;
    parser?: PostgrestParser;
    postgresOptions?: Pick<PGliteOptions, "startParams">;
}
export interface NanoSupabaseInstance {
    db: ReturnType<typeof createPGlite>;
    localFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    createClient<Database = unknown>(options?: SupabaseClientOptions<string> & {
        url?: string;
        key?: string;
    }): SupabaseClient<Database>;
    connectionString: string | null;
    stop(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
}
export declare function createClient<Database = unknown>(options?: NanoSupabaseOptions & SupabaseClientOptions<string> & {
    url?: string;
    key?: string;
}): Promise<SupabaseClient<Database>>;
export declare function nanoSupabase(options?: NanoSupabaseOptions): Promise<NanoSupabaseInstance>;
//# sourceMappingURL=nano.d.ts.map