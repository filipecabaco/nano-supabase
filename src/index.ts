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

// Auth module
export {
	AUTH_SCHEMA_SQL,
	type AuthChangeEvent,
	type AuthError,
	AuthHandler,
	type AuthResponse,
	type AuthStateChangeCallback,
	type AuthSubscription,
	CLEAR_AUTH_CONTEXT_SQL,
	createAccessToken,
	extractSessionIdFromToken,
	extractUserIdFromToken,
	generateTokenPair,
	getSetAuthContextSQL,
	type Session,
	type SignInCredentials,
	type SignUpCredentials,
	type TokenPair,
	type User,
	verifyAccessToken,
} from "./auth/index.ts";
// JWT utilities (Web Crypto API - browser/edge compatible)
export { decodeJWT, type JWTPayload, signJWT, verifyJWT } from "./auth/jwt.ts";

// Main client factories
export {
	createFetchAdapter,
	createLocalSupabaseClient,
	initializeAuth,
	type LocalSupabaseClientConfig,
	type LocalSupabaseClientResult,
} from "./client.ts";
// Fetch adapter utilities
export {
	type AuthContext,
	clearAuthContext,
	setAuthContext,
} from "./fetch-adapter/auth-context.ts";
export {
	type ApiError,
	extractPostgresError,
	type PostgresError,
	postgresErrorResponse,
} from "./fetch-adapter/error-handler.ts";

// Fetch adapter
export {
	createLocalFetch,
	type FetchAdapterConfig,
	handleAuthRoute,
	handleDataRoute,
	handleStorageRoute,
} from "./fetch-adapter/index.ts";
// Primary entry point
export {
	createClient,
	type NanoSupabaseInstance,
	type NanoSupabaseOptions,
	nanoSupabase,
} from "./nano.ts";
// PGlite factory — creates a PGlite instance with all required extensions pre-registered
export { createPGlite, LEAN_POSTGRES_OPTIONS } from "./pglite-factory.ts";
// Connection pooler
export { PGlitePooler } from "./pooler.ts";
export type { ParsedQuery, QueryExecutor } from "./postgrest-parser.ts";
// PostgREST parser
export { PostgrestParser } from "./postgrest-parser.ts";
// Priority queue (internal but exported for advanced use)
export { PriorityQueue } from "./queue.ts";
// Storage module
export {
	type BlobMetadata,
	type CreateBucketOptions,
	MemoryStorageBackend,
	type SignedUrlToken,
	STORAGE_SCHEMA_SQL,
	type StorageBackend,
	type StorageBucket,
	StorageHandler,
	type StorageObject,
} from "./storage/index.ts";
export type { QueryBuilder } from "./supabase-client.ts";
// Original Supabase-compatible client (for direct usage without supabase-js)
export { createSupabaseClient, SupabaseClient } from "./supabase-client.ts";
// TCP server (Postgres wire protocol — exposes PGlite as a real Postgres endpoint)
export {
	type MuxRoute,
	PGliteTCPMuxServer,
	PGliteTCPServer,
	type TCPServerOptions,
} from "./tcp-server.ts";
export type {
	PoolerConfig,
	QueryResult,
	QueuedQuery,
	QueueMetrics,
} from "./types.ts";
// Types
export { QueryPriority } from "./types.ts";
