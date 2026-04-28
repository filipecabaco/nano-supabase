import type {
  SupabaseClient,
  SupabaseClientOptions,
} from "@supabase/supabase-js";
import { createClient as supabaseCreateClient } from "@supabase/supabase-js";
import { createComponents } from "./client.ts";
import { createLocalFetch } from "./fetch-adapter/index.ts";
import type {
  NanoSupabaseBaseOptions,
  NanoSupabaseInstance,
} from "./nano-types.ts";
import { createPGlite } from "./pglite-factory.ts";

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
  prepareSandboxConnection,
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
export type {
  NanoSupabaseBaseOptions as NanoSupabaseOptions,
  NanoSupabaseInstance,
} from "./nano-types.ts";
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
  MemoryStorageBackend,
  type StorageBackend,
} from "./storage/backend.ts";
export {
  type CreateBucketOptions,
  type SignedUrlToken,
  type StorageBucket,
  StorageHandler,
  type StorageObject,
} from "./storage/handler.ts";
export { STORAGE_SCHEMA_SQL } from "./storage/schema.ts";
export type { QueryBuilder } from "./supabase-client.ts";
export { createSupabaseClient, SupabaseClient } from "./supabase-client.ts";
export type {
  PoolerConfig,
  QueryResult,
  QueuedQuery,
  QueueMetrics,
} from "./types.ts";
export { QueryPriority } from "./types.ts";

const DEFAULT_SUPABASE_URL = "http://localhost:54321";
const DEFAULT_ANON_KEY = "local-anon-key";

export async function nanoSupabase(
  options: NanoSupabaseBaseOptions = {},
): Promise<NanoSupabaseInstance> {
  const {
    dataDir,
    extensions,
    storageBackend,
    debug = false,
    pgliteWasmModule,
    fsBundle,
    postgrestWasmBytes,
    serviceRoleKey,
    parser: sharedParser,
    schemaId,
    postgresOptions,
  } = options;

  const db = createPGlite(dataDir, {
    extensions,
    pgliteWasmModule,
    fsBundle,
    ...postgresOptions,
  });
  const { parser, authHandler, storageHandler } = await createComponents(
    db,
    storageBackend,
    postgrestWasmBytes,
    sharedParser,
    schemaId,
  );

  const localFetch = createLocalFetch({
    db,
    parser,
    authHandler,
    storageHandler,
    supabaseUrl: DEFAULT_SUPABASE_URL,
    debug,
    serviceRoleKey,
  });

  const stop = async () => {
    await db.close();
  };

  return {
    db,
    localFetch,
    connectionString: null,
    createClient<Database = unknown>(
      options?: SupabaseClientOptions<string> & { url?: string; key?: string },
    ): SupabaseClient<Database> {
      const {
        url = DEFAULT_SUPABASE_URL,
        key = DEFAULT_ANON_KEY,
        global: globalOpts,
        ...rest
      } = options ?? {};
      return supabaseCreateClient<Database>(url, key, {
        ...rest,
        global: {
          ...globalOpts,
          fetch: globalOpts?.fetch ?? (localFetch as typeof fetch),
        },
      } as Parameters<
        typeof supabaseCreateClient
      >[2]) as unknown as SupabaseClient<Database>;
    },
    stop,
    [Symbol.asyncDispose]: stop,
  };
}

export async function createClient<Database = unknown>(
  options?: NanoSupabaseBaseOptions &
    SupabaseClientOptions<string> & { url?: string; key?: string },
): Promise<SupabaseClient<Database>> {
  const {
    dataDir,
    extensions,
    storageBackend,
    debug,
    pgliteWasmModule,
    fsBundle,
    postgrestWasmBytes,
    serviceRoleKey,
    parser,
    schemaId,
    postgresOptions,
    url,
    key,
    ...clientOptions
  } = options ?? {};
  const nano = await nanoSupabase({
    dataDir,
    extensions,
    storageBackend,
    debug,
    pgliteWasmModule,
    fsBundle,
    postgrestWasmBytes,
    serviceRoleKey,
    parser,
    schemaId,
    postgresOptions,
  });
  return nano.createClient<Database>({ url, key, ...clientOptions });
}
