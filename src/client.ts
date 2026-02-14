/**
 * Local Supabase Client Factory
 *
 * Creates a fully local Supabase client that works with @supabase/supabase-js
 * All auth, data, and storage operations are handled in-browser/in-process using PGlite
 */

import type { PGlite } from "@electric-sql/pglite";
import { PostgrestParser } from "./postgrest-parser.ts";
import { AuthHandler } from "./auth/handler.ts";
import { StorageHandler } from "./storage/handler.ts";
import type { StorageBackend } from "./storage/backend.ts";
import { createLocalFetch } from "./fetch-adapter/index.ts";

/**
 * Generic type for the Supabase client
 * This allows users to pass their own SupabaseClient type
 */
type SupabaseJsClient = unknown;

/**
 * Configuration for creating a local Supabase client
 */
export interface LocalSupabaseClientConfig {
  /**
   * The PGlite database instance
   */
  db: PGlite;
  /**
   * URL to use for the local Supabase instance
   * This should be a fake URL that won't conflict with real requests
   * Defaults to 'http://localhost:54321'
   */
  supabaseUrl?: string;
  /**
   * Anon key to use (can be any string for local usage)
   * Defaults to 'local-anon-key'
   */
  supabaseAnonKey?: string;
  /**
   * Enable debug logging
   */
  debug?: boolean;
  /**
   * Original fetch function to use for passthrough requests
   * Defaults to globalThis.fetch
   */
  originalFetch?: typeof fetch;
  /**
   * Custom storage blob backend.
   * Defaults to in-memory storage (MemoryStorageBackend).
   * Set to `false` to disable storage emulation entirely.
   */
  storageBackend?: StorageBackend | false;
}

/**
 * Result from creating a local Supabase client
 */
export interface LocalSupabaseClientResult<T = SupabaseJsClient> {
  /**
   * The Supabase client configured to use local emulation
   */
  client: T;
  /**
   * The auth handler for direct access to auth operations
   */
  authHandler: AuthHandler;
  /**
   * The PostgREST parser for direct SQL parsing
   */
  parser: PostgrestParser;
  /**
   * The storage handler for direct access to storage operations (undefined if disabled)
   */
  storageHandler?: StorageHandler;
  /**
   * The custom fetch function (useful for custom integrations)
   */
  localFetch: typeof fetch;
}

/**
 * Create a local Supabase client with full auth, data, and storage emulation
 *
 * This function initializes PGlite with the auth and storage schemas and creates a
 * custom fetch adapter that intercepts Supabase API calls:
 * - /auth/v1/* endpoints are handled by the local auth handler
 * - /rest/v1/* endpoints are parsed and executed against PGlite
 * - /storage/v1/* endpoints are handled by the local storage handler
 * - All other requests pass through to the original fetch
 *
 * @example
 * ```typescript
 * import { PGlite } from '@electric-sql/pglite'
 * import { createClient } from '@supabase/supabase-js'
 * import { createLocalSupabaseClient } from 'nano-supabase'
 *
 * const db = new PGlite()
 *
 * // Create the local client — auth, data, and storage all work locally
 * const { client: supabase } = await createLocalSupabaseClient({
 *   db,
 *   createClient,
 * })
 *
 * // Use it like a normal Supabase client
 * await supabase.auth.signUp({ email: 'user@example.com', password: 'password' })
 * const { data } = await supabase.from('users').select('*')
 * await supabase.storage.from('avatars').upload('avatar.png', file)
 * ```
 */
export async function createLocalSupabaseClient<T = SupabaseJsClient>(
  config: LocalSupabaseClientConfig,
  createClient: (
    url: string,
    key: string,
    options?: { global?: { fetch?: typeof fetch } },
  ) => T,
): Promise<LocalSupabaseClientResult<T>> {
  const {
    db,
    supabaseUrl = "http://localhost:54321",
    supabaseAnonKey = "local-anon-key",
    debug = false,
    originalFetch,
    storageBackend,
  } = config;

  // Initialize PostgREST parser
  await PostgrestParser.init();
  await PostgrestParser.initSchema(async (sql: string) => {
    const result = await db.query(sql);
    return { rows: result.rows };
  });

  const parser = new PostgrestParser();

  // Initialize auth handler (creates auth schema)
  const authHandler = new AuthHandler(db);
  await authHandler.initialize();

  // Initialize storage handler (creates storage schema) unless disabled
  let storageHandler: StorageHandler | undefined;
  if (storageBackend !== false) {
    storageHandler = new StorageHandler(
      db,
      storageBackend || undefined,
    );
    await storageHandler.initialize();
  }

  // Create the scoped fetch adapter
  const localFetch = createLocalFetch({
    db,
    parser,
    authHandler,
    storageHandler,
    supabaseUrl,
    originalFetch,
    debug,
  });

  // Create the Supabase client with our custom fetch
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: localFetch },
  });

  return {
    client,
    authHandler,
    parser,
    storageHandler,
    localFetch,
  };
}

/**
 * Initialize auth schema in an existing PGlite database
 *
 * Use this if you want to set up auth without creating a full Supabase client
 *
 * @example
 * ```typescript
 * import { PGlite } from '@electric-sql/pglite'
 * import { initializeAuth } from 'nano-supabase'
 *
 * const db = new PGlite()
 * const authHandler = await initializeAuth(db)
 *
 * // Use auth directly
 * const result = await authHandler.signUp('user@example.com', 'password')
 * ```
 */
export async function initializeAuth(db: PGlite): Promise<AuthHandler> {
  const authHandler = new AuthHandler(db);
  await authHandler.initialize();
  return authHandler;
}

/**
 * Create only the fetch adapter without a Supabase client
 *
 * Use this for custom integrations where you want to control client creation
 *
 * @example
 * ```typescript
 * import { PGlite } from '@electric-sql/pglite'
 * import { createClient } from '@supabase/supabase-js'
 * import { createFetchAdapter } from 'nano-supabase'
 *
 * const db = new PGlite()
 * const { localFetch, authHandler, parser, storageHandler } = await createFetchAdapter({ db })
 *
 * // Create client yourself
 * const supabase = createClient('http://localhost:54321', 'key', {
 *   global: { fetch: localFetch }
 * })
 * ```
 */
export async function createFetchAdapter(config: {
  db: PGlite;
  supabaseUrl?: string;
  debug?: boolean;
  originalFetch?: typeof fetch;
  storageBackend?: StorageBackend | false;
}): Promise<{
  localFetch: typeof fetch;
  authHandler: AuthHandler;
  parser: PostgrestParser;
  storageHandler?: StorageHandler;
}> {
  const {
    db,
    supabaseUrl = "http://localhost:54321",
    debug = false,
    originalFetch,
    storageBackend,
  } = config;

  // Initialize PostgREST parser
  await PostgrestParser.init();
  await PostgrestParser.initSchema(async (sql: string) => {
    const result = await db.query(sql);
    return { rows: result.rows };
  });

  const parser = new PostgrestParser();

  // Initialize auth handler
  const authHandler = new AuthHandler(db);
  await authHandler.initialize();

  // Initialize storage handler unless disabled
  let storageHandler: StorageHandler | undefined;
  if (storageBackend !== false) {
    storageHandler = new StorageHandler(
      db,
      storageBackend || undefined,
    );
    await storageHandler.initialize();
  }

  // Create the scoped fetch adapter
  const localFetch = createLocalFetch({
    db,
    parser,
    authHandler,
    storageHandler,
    supabaseUrl,
    originalFetch,
    debug,
  });

  return {
    localFetch,
    authHandler,
    parser,
    storageHandler,
  };
}
