import type { SupabaseClient, SupabaseClientOptions } from "@supabase/supabase-js";
import type { NanoSupabaseBaseOptions, NanoSupabaseInstance } from "./nano-types.ts";
export { AUTH_SCHEMA_SQL, type AuthChangeEvent, type AuthError, AuthHandler, type AuthResponse, type AuthStateChangeCallback, type AuthSubscription, CLEAR_AUTH_CONTEXT_SQL, createAccessToken, extractSessionIdFromToken, extractUserIdFromToken, generateTokenPair, getSetAuthContextSQL, prepareSandboxConnection, type Session, type SignInCredentials, type SignUpCredentials, type TokenPair, type User, verifyAccessToken, } from "./auth/index.ts";
export { decodeJWT, type JWTPayload, signJWT, verifyJWT } from "./auth/jwt.ts";
export { createFetchAdapter, createLocalSupabaseClient, initializeAuth, type LocalSupabaseClientConfig, type LocalSupabaseClientResult, } from "./client.ts";
export { type AuthContext, clearAuthContext, setAuthContext, } from "./fetch-adapter/auth-context.ts";
export { type ApiError, extractPostgresError, type PostgresError, postgresErrorResponse, } from "./fetch-adapter/error-handler.ts";
export { createLocalFetch, type FetchAdapterConfig, handleAuthRoute, handleDataRoute, handleStorageRoute, } from "./fetch-adapter/index.ts";
export type { NanoSupabaseBaseOptions as NanoSupabaseOptions, NanoSupabaseInstance, } from "./nano-types.ts";
export { createPGlite, LEAN_POSTGRES_OPTIONS } from "./pglite-factory.ts";
export { PGlitePooler } from "./pooler.ts";
export type { ParsedQuery, QueryExecutor } from "./postgrest-parser.ts";
export { PostgrestParser } from "./postgrest-parser.ts";
export { PriorityQueue } from "./queue.ts";
export { type CreateTenantOptions, type CreateTenantResult, ServiceClient, type ServiceClientOptions, type SqlResult, type Tenant, type TenantUsage, } from "./service-client.ts";
export { type BlobMetadata, MemoryStorageBackend, type StorageBackend, } from "./storage/backend.ts";
export { type CreateBucketOptions, type SignedUrlToken, type StorageBucket, StorageHandler, type StorageObject, } from "./storage/handler.ts";
export { STORAGE_SCHEMA_SQL } from "./storage/schema.ts";
export type { QueryBuilder } from "./supabase-client.ts";
export { createSupabaseClient, SupabaseClient } from "./supabase-client.ts";
export type { PoolerConfig, QueryResult, QueuedQuery, QueueMetrics, } from "./types.ts";
export { QueryPriority } from "./types.ts";
export declare function nanoSupabase(options?: NanoSupabaseBaseOptions): Promise<NanoSupabaseInstance>;
export declare function createClient<Database = unknown>(options?: NanoSupabaseBaseOptions & SupabaseClientOptions<string> & {
    url?: string;
    key?: string;
}): Promise<SupabaseClient<Database>>;
//# sourceMappingURL=browser.d.ts.map