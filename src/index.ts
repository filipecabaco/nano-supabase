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

// Main client factories
export {
  createLocalSupabaseClient,
  createFetchAdapter,
  initializeAuth,
  type LocalSupabaseClientConfig,
  type LocalSupabaseClientResult,
} from "./client.ts";

// Original Supabase-compatible client (for direct usage without supabase-js)
export { createSupabaseClient, SupabaseClient } from "./supabase-client.ts";
export type { QueryBuilder } from "./supabase-client.ts";

// Fetch adapter
export {
  createLocalFetch,
  handleAuthRoute,
  handleDataRoute,
  handleStorageRoute,
  type FetchAdapterConfig,
} from "./fetch-adapter/index.ts";

// Fetch adapter utilities
export {
  setAuthContext,
  clearAuthContext,
  type AuthContext,
} from "./fetch-adapter/auth-context.ts";

export {
  extractPostgresError,
  errorResponse,
  type PostgresError,
  type ApiError,
} from "./fetch-adapter/error-handler.ts";

// Auth module
export {
  AuthHandler,
  AUTH_SCHEMA_SQL,
  getSetAuthContextSQL,
  CLEAR_AUTH_CONTEXT_SQL,
  createAccessToken,
  verifyAccessToken,
  generateTokenPair,
  extractUserIdFromToken,
  extractSessionIdFromToken,
  type User,
  type Session,
  type AuthResponse,
  type AuthError,
  type AuthChangeEvent,
  type AuthStateChangeCallback,
  type AuthSubscription,
  type SignUpCredentials,
  type SignInCredentials,
  type TokenPair,
} from "./auth/index.ts";

// JWT utilities (Web Crypto API - browser/edge compatible)
export { signJWT, verifyJWT, decodeJWT, type JWTPayload } from "./auth/jwt.ts";

// Storage module
export {
  StorageHandler,
  STORAGE_SCHEMA_SQL,
  MemoryStorageBackend,
  type StorageBackend,
  type BlobMetadata,
  type StorageBucket,
  type StorageObject,
  type CreateBucketOptions,
  type SignedUrlToken,
} from "./storage/index.ts";

// PostgREST parser
export { PostgrestParser } from "./postgrest-parser.ts";
export type { ParsedQuery, QueryExecutor } from "./postgrest-parser.ts";

// Connection pooler
export { PGlitePooler } from "./pooler.ts";

// Priority queue (internal but exported for advanced use)
export { PriorityQueue } from "./queue.ts";

// Types
export { QueryPriority } from "./types.ts";
export type {
  PoolerConfig,
  QueuedQuery,
  QueueMetrics,
  QueryResult,
} from "./types.ts";
