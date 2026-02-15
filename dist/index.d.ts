/**
 * nano-supabase
 *
 * A lightweight Supabase emulator powered by PGlite
 * Provides full auth, PostgREST, and storage API emulation in-browser or in-process
 *
 * @example
 * ```typescript
 * import { PGlite } from '@electric-sql/pglite'
 * import { createSupabaseClient } from 'nano-supabase'
 *
 * const db = new PGlite()
 * const supabase = await createSupabaseClient(db)
 *
 * const { data } = await supabase.from('users').select('*')
 * ```
 */
export { createLocalSupabaseClient, createFetchAdapter, initializeAuth, type LocalSupabaseClientConfig, type LocalSupabaseClientResult, } from "./client.ts";
export { createSupabaseClient, SupabaseClient } from "./supabase-client.ts";
export type { QueryBuilder } from "./supabase-client.ts";
export { createLocalFetch, handleAuthRoute, handleDataRoute, handleStorageRoute, type FetchAdapterConfig, } from "./fetch-adapter/index.ts";
export { setAuthContext, clearAuthContext, type AuthContext, } from "./fetch-adapter/auth-context.ts";
export { extractPostgresError, errorResponse, type PostgresError, type ApiError, } from "./fetch-adapter/error-handler.ts";
export { AuthHandler, AUTH_SCHEMA_SQL, getSetAuthContextSQL, CLEAR_AUTH_CONTEXT_SQL, createAccessToken, verifyAccessToken, generateTokenPair, extractUserIdFromToken, extractSessionIdFromToken, type User, type Session, type AuthResponse, type AuthError, type AuthChangeEvent, type AuthStateChangeCallback, type AuthSubscription, type SignUpCredentials, type SignInCredentials, type TokenPair, } from "./auth/index.ts";
export { signJWT, verifyJWT, decodeJWT, type JWTPayload } from "./auth/jwt.ts";
export { StorageHandler, STORAGE_SCHEMA_SQL, MemoryStorageBackend, type StorageBackend, type BlobMetadata, type StorageBucket, type StorageObject, type CreateBucketOptions, type SignedUrlToken, } from "./storage/index.ts";
export { PostgrestParser } from "./postgrest-parser.ts";
export type { ParsedQuery, QueryExecutor } from "./postgrest-parser.ts";
export { PGlitePooler } from "./pooler.ts";
export { PriorityQueue } from "./queue.ts";
export { QueryPriority } from "./types.ts";
export type { PoolerConfig, QueuedQuery, QueueMetrics, QueryResult, } from "./types.ts";
//# sourceMappingURL=index.d.ts.map