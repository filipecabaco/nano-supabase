import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import { AuthHandler } from "./auth/handler.ts";
import { PostgrestParser } from "./postgrest-parser.ts";
import type { StorageBackend } from "./storage/backend.ts";
import { StorageHandler } from "./storage/handler.ts";
export interface LocalSupabaseClientConfig {
    db: PGlite | PGliteInterface;
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    debug?: boolean;
    originalFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    storageBackend?: StorageBackend | false;
}
export interface LocalSupabaseClientResult<T = unknown> {
    client: T;
    authHandler: AuthHandler;
    parser: PostgrestParser;
    storageHandler?: StorageHandler;
    localFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}
export declare function createComponents(db: PGlite | PGliteInterface, storageBackend: StorageBackend | false | undefined, postgrestWasmBytes?: Uint8Array, sharedParser?: PostgrestParser): Promise<{
    parser: PostgrestParser;
    authHandler: AuthHandler;
    storageHandler: StorageHandler | undefined;
}>;
export declare function createLocalSupabaseClient<T = unknown>(config: LocalSupabaseClientConfig, createClient: (url: string, key: string, options?: {
    global?: {
        fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    };
}) => T): Promise<LocalSupabaseClientResult<T>>;
export declare function initializeAuth(db: PGlite | PGliteInterface): Promise<AuthHandler>;
export declare function createFetchAdapter(config: {
    db: PGlite | PGliteInterface;
    supabaseUrl?: string;
    serviceRoleKey?: string;
    debug?: boolean;
    originalFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    storageBackend?: StorageBackend | false;
}): Promise<{
    localFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    authHandler: AuthHandler;
    parser: PostgrestParser;
    storageHandler?: StorageHandler;
}>;
//# sourceMappingURL=client.d.ts.map