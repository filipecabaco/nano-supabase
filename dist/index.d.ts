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
export { AUTH_SCHEMA_SQL, type AuthChangeEvent, type AuthError, AuthHandler, type AuthResponse, type AuthStateChangeCallback, type AuthSubscription, CLEAR_AUTH_CONTEXT_SQL, createAccessToken, extractSessionIdFromToken, extractUserIdFromToken, generateTokenPair, getSetAuthContextSQL, type Session, type SignInCredentials, type SignUpCredentials, type TokenPair, type User, verifyAccessToken, } from "./auth/index.ts";
export { decodeJWT, type JWTPayload, signJWT, verifyJWT } from "./auth/jwt.ts";
export { createFetchAdapter, createLocalSupabaseClient, initializeAuth, type LocalSupabaseClientConfig, type LocalSupabaseClientResult, } from "./client.ts";
export { type AuthContext, clearAuthContext, setAuthContext, } from "./fetch-adapter/auth-context.ts";
export { type ApiError, errorResponse, extractPostgresError, type PostgresError, } from "./fetch-adapter/error-handler.ts";
export { createLocalFetch, type FetchAdapterConfig, handleAuthRoute, handleDataRoute, handleStorageRoute, } from "./fetch-adapter/index.ts";
export { createClient, type NanoSupabaseInstance, type NanoSupabaseOptions, nanoSupabase, } from "./nano.ts";
export { createPGlite } from "./pglite-factory.ts";
export { PGlitePooler } from "./pooler.ts";
export type { ParsedQuery, QueryExecutor } from "./postgrest-parser.ts";
export { PostgrestParser } from "./postgrest-parser.ts";
export { PriorityQueue } from "./queue.ts";
export { type BlobMetadata, type CreateBucketOptions, MemoryStorageBackend, type SignedUrlToken, STORAGE_SCHEMA_SQL, type StorageBackend, type StorageBucket, StorageHandler, type StorageObject, } from "./storage/index.ts";
export type { QueryBuilder } from "./supabase-client.ts";
export { createSupabaseClient, SupabaseClient } from "./supabase-client.ts";
export { PGliteTCPServer, type TCPServerOptions } from "./tcp-server.ts";
export type { PoolerConfig, QueryResult, QueuedQuery, QueueMetrics, } from "./types.ts";
export { QueryPriority } from "./types.ts";
//# sourceMappingURL=index.d.ts.map