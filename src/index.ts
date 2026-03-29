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
export { decodeJWT, type JWTPayload, signJWT, verifyJWT } from "./auth/jwt.ts";

export {
  createFetchAdapter,
  createLocalSupabaseClient,
  initializeAuth,
  type LocalSupabaseClientConfig,
  type LocalSupabaseClientResult,
} from "./client.ts";
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

export {
  createLocalFetch,
  type FetchAdapterConfig,
  handleAuthRoute,
  handleDataRoute,
  handleStorageRoute,
} from "./fetch-adapter/index.ts";
export {
  createClient,
  type NanoSupabaseInstance,
  type NanoSupabaseOptions,
  nanoSupabase,
} from "./nano.ts";
export { createPGlite, LEAN_POSTGRES_OPTIONS } from "./pglite-factory.ts";
export { PGlitePooler } from "./pooler.ts";
export type { ParsedQuery, QueryExecutor } from "./postgrest-parser.ts";
export { PostgrestParser } from "./postgrest-parser.ts";
export { PriorityQueue } from "./queue.ts";
export {
  type CreateTenantOptions,
  type CreateTenantResult,
  ServiceClient,
  type ServiceClientOptions,
  type SqlResult,
  type Tenant,
  type TenantUsage,
} from "./service-client.ts";
export {
  type BlobMetadata,
  type CreateBucketOptions,
  FileSystemStorageBackend,
  MemoryStorageBackend,
  S3StorageBackend,
  type S3StorageBackendOptions,
  type SignedUrlToken,
  STORAGE_SCHEMA_SQL,
  type StorageBackend,
  type StorageBucket,
  StorageHandler,
  type StorageObject,
} from "./storage/index.ts";
export type { QueryBuilder } from "./supabase-client.ts";
export { createSupabaseClient, SupabaseClient } from "./supabase-client.ts";
export type {
  PoolerConfig,
  QueryResult,
  QueuedQuery,
  QueueMetrics,
} from "./types.ts";
export { QueryPriority } from "./types.ts";
