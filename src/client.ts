import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import { AuthHandler } from "./auth/handler.ts";
import { createLocalFetch } from "./fetch-adapter/index.ts";
import { PostgrestParser } from "./postgrest-parser.ts";
import type { StorageBackend } from "./storage/backend.ts";
import { StorageHandler } from "./storage/handler.ts";

export interface LocalSupabaseClientConfig {
  db: PGlite | PGliteInterface;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  debug?: boolean;
  originalFetch?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  storageBackend?: StorageBackend | false;
}

export interface LocalSupabaseClientResult<T = unknown> {
  client: T;
  authHandler: AuthHandler;
  parser: PostgrestParser;
  storageHandler?: StorageHandler;
  localFetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
}

export async function createComponents(
  db: PGlite | PGliteInterface,
  storageBackend: StorageBackend | false | undefined,
  postgrestWasmBytes?: Uint8Array,
  sharedParser?: PostgrestParser,
  schemaId?: string,
): Promise<{
  parser: PostgrestParser;
  authHandler: AuthHandler;
  storageHandler: StorageHandler | undefined;
}> {
  const authHandler = new AuthHandler(db);

  if (sharedParser && !schemaId) {
    await authHandler.initialize();
  } else {
    await Promise.all([
      PostgrestParser.init(postgrestWasmBytes),
      authHandler.initialize(),
    ]);
  }

  let storageHandler: StorageHandler | undefined;
  if (storageBackend !== false) {
    storageHandler = new StorageHandler(db, storageBackend || undefined);
    await storageHandler.initialize();
  }

  if (!sharedParser || schemaId) {
    await PostgrestParser.initSchema(async (sql: string) => {
      const result = await db.query(sql);
      return { rows: result.rows };
    }, schemaId);
  }

  return {
    parser: schemaId
      ? new PostgrestParser(schemaId)
      : (sharedParser ?? new PostgrestParser()),
    authHandler,
    storageHandler,
  };
}

export async function createLocalSupabaseClient<T = unknown>(
  config: LocalSupabaseClientConfig,
  createClient: (
    url: string,
    key: string,
    options?: {
      global?: {
        fetch?: (
          input: RequestInfo | URL,
          init?: RequestInit,
        ) => Promise<Response>;
      };
    },
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

  const { localFetch, authHandler, parser, storageHandler } =
    await createFetchAdapter({
      db,
      supabaseUrl,
      debug,
      originalFetch,
      storageBackend,
    });

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: localFetch },
  });

  return { client, authHandler, parser, storageHandler, localFetch };
}

export async function initializeAuth(
  db: PGlite | PGliteInterface,
): Promise<AuthHandler> {
  const authHandler = new AuthHandler(db);
  await authHandler.initialize();
  return authHandler;
}

export async function createFetchAdapter(config: {
  db: PGlite | PGliteInterface;
  supabaseUrl?: string;
  serviceRoleKey?: string;
  debug?: boolean;
  originalFetch?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  storageBackend?: StorageBackend | false;
}): Promise<{
  localFetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  authHandler: AuthHandler;
  parser: PostgrestParser;
  storageHandler?: StorageHandler;
}> {
  const {
    db,
    supabaseUrl = "http://localhost:54321",
    serviceRoleKey,
    debug = false,
    originalFetch,
    storageBackend,
  } = config;

  const { parser, authHandler, storageHandler } = await createComponents(
    db,
    storageBackend,
  );

  const localFetch = createLocalFetch({
    db,
    parser,
    authHandler,
    storageHandler,
    supabaseUrl,
    serviceRoleKey,
    originalFetch,
    debug,
  });

  return { localFetch, authHandler, parser, storageHandler };
}
