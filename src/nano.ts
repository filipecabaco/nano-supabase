import type { PGliteOptions } from "@electric-sql/pglite";
import type {
  SupabaseClient,
  SupabaseClientOptions,
} from "@supabase/supabase-js";
import { createClient as supabaseCreateClient } from "@supabase/supabase-js";
import { createComponents } from "./client.ts";
import { createLocalFetch } from "./fetch-adapter/index.ts";
import { createPGlite } from "./pglite-factory.ts";
import type { PostgrestParser } from "./postgrest-parser.ts";
import type { StorageBackend } from "./storage/backend.ts";
import type { PGliteTCPServer } from "./tcp-server.ts";

export interface NanoSupabaseOptions {
  dataDir?: string;
  extensions?: PGliteOptions["extensions"];
  tcp?: boolean | { port?: number; host?: string };
  storageBackend?: StorageBackend | false;
  debug?: boolean;
  pgliteWasmModule?: WebAssembly.Module;
  fsBundle?: Blob | File;
  postgrestWasmBytes?: Uint8Array;
  serviceRoleKey?: string;
  parser?: PostgrestParser;
  postgresOptions?: Pick<PGliteOptions, "startParams">;
}

export interface NanoSupabaseInstance {
  db: ReturnType<typeof createPGlite>;
  localFetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  createClient<Database = unknown>(
    options?: SupabaseClientOptions<string> & { url?: string; key?: string },
  ): SupabaseClient<Database>;
  connectionString: string | null;
  stop(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

const DEFAULT_SUPABASE_URL = "http://localhost:54321";
const DEFAULT_ANON_KEY = "local-anon-key";

export async function createClient<Database = unknown>(
  options?: NanoSupabaseOptions &
    SupabaseClientOptions<string> & { url?: string; key?: string },
): Promise<SupabaseClient<Database>> {
  const {
    dataDir,
    extensions,
    tcp,
    storageBackend,
    debug,
    pgliteWasmModule,
    fsBundle,
    postgrestWasmBytes,
    serviceRoleKey,
    parser,
    postgresOptions,
    url,
    key,
    ...clientOptions
  } = options ?? {};
  const nano = await nanoSupabase({
    dataDir,
    extensions,
    tcp,
    storageBackend,
    debug,
    pgliteWasmModule,
    fsBundle,
    postgrestWasmBytes,
    serviceRoleKey,
    parser,
    postgresOptions,
  });
  return nano.createClient<Database>({ url, key, ...clientOptions });
}

export async function nanoSupabase(
  options: NanoSupabaseOptions = {},
): Promise<NanoSupabaseInstance> {
  const {
    dataDir,
    extensions,
    tcp,
    storageBackend,
    debug = false,
    pgliteWasmModule,
    fsBundle,
    postgrestWasmBytes,
    serviceRoleKey,
    parser: sharedParser,
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

  let tcpServer: PGliteTCPServer | null = null;
  let connectionString: string | null = null;

  if (tcp) {
    const DEFAULT_TCP_PORT = 5432;
    const DEFAULT_TCP_HOST = "127.0.0.1";
    const port =
      typeof tcp === "object"
        ? (tcp.port ?? DEFAULT_TCP_PORT)
        : DEFAULT_TCP_PORT;
    const host =
      typeof tcp === "object"
        ? (tcp.host ?? DEFAULT_TCP_HOST)
        : DEFAULT_TCP_HOST;
    const { PGliteTCPServer } = await import("./tcp-server.ts");
    tcpServer = await PGliteTCPServer.create(db);
    await tcpServer.start(port, host);
    connectionString = `postgresql://postgres@${host}:${port}/postgres`;
  }

  const stop = async () => {
    await Promise.all([tcpServer?.stop(), db.close()]);
  };

  return {
    db,
    localFetch,
    connectionString,
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
