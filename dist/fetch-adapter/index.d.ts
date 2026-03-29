import type { PGliteInterface } from "@electric-sql/pglite";
import type { AuthHandler } from "../auth/handler.ts";
import type { PostgrestParser } from "../postgrest-parser.ts";
import type { StorageHandler } from "../storage/handler.ts";
export interface FetchAdapterConfig {
    db: PGliteInterface;
    parser: PostgrestParser;
    authHandler: AuthHandler;
    storageHandler?: StorageHandler;
    supabaseUrl: string;
    originalFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    debug?: boolean;
    serviceRoleKey?: string;
}
export declare function createLocalFetch(config: FetchAdapterConfig): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export declare function extractBearerToken(headers: Headers): string | null;
export declare function parseBody(request: Request): Promise<Record<string, unknown>>;
export { handleAuthRoute } from "./auth-routes.ts";
export { handleDataRoute } from "./data-routes.ts";
export { handleStorageRoute } from "./storage-routes.ts";
//# sourceMappingURL=index.d.ts.map