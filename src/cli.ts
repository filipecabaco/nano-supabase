import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Extension } from "@electric-sql/pglite";

import { pgDump } from "@electric-sql/pglite-tools/pg_dump";
import {
  cmdDbDump,
  cmdDbExec,
  cmdDbReset,
  cmdGenTypes,
  cmdMigrationList,
  cmdMigrationNew,
  cmdMigrationUp,
  cmdStatus,
  cmdStop,
  cmdStorageCp,
  cmdStorageCreateBucket,
  cmdStorageListBuckets,
  cmdStorageLs,
  cmdSyncPull,
  cmdSyncPush,
  cmdUsersCreate,
  cmdUsersDelete,
  cmdUsersGet,
  cmdUsersList,
} from "./cli-commands.ts";
import type { McpHandler } from "./mcp-server.ts";
import { createMcpHandler } from "./mcp-server.ts";
import type { NanoSupabaseInstance } from "./nano.ts";
import { nanoSupabase } from "./nano.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pgliteDist = __dirname;

const DEFAULT_HTTP_PORT = 54321;
const DEFAULT_TCP_PORT = 5432;
const DEFAULT_ANON_KEY = "local-anon-key";
const DEFAULT_SERVICE_ROLE_KEY = "local-service-role-key";

const argv = process.argv.slice(2);

function getArgValue(args: string[], flag: string): string | undefined {
  const withEq = args.find((a) => a.startsWith(`${flag}=`));
  if (withEq) return withEq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith("--"))
    return args[idx + 1];
  return undefined;
}

const SUB_COMMANDS = [
  "start",
  "stop",
  "status",
  "db",
  "migration",
  "users",
  "storage",
  "gen",
  "sync",
  "service",
];
const firstArg = argv[0];
const subCommand =
  firstArg && SUB_COMMANDS.includes(firstArg) ? firstArg : "start";
const subArgs =
  subCommand === "start" && firstArg !== "start" ? argv : argv.slice(1);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`nano-supabase — local Supabase-compatible server

Usage: nano-supabase [command] [options]

Commands:
  start                 Start the server (default)
  stop                  Stop a detached server
  status                Check if server is running

  db exec               Execute SQL
  db dump               Dump schema DDL
  db reset              Drop all public tables

  migration new <name>  Create a new migration file
  migration list        List applied/pending migrations
  migration up          Apply pending migrations

  users list            List all users
  users create          Create a user
  users get <id>        Get a user by ID
  users delete <id>     Delete a user

  storage list-buckets       List storage buckets
  storage create-bucket <n>  Create a storage bucket
  storage ls <bucket>        List objects in bucket
  storage cp <src> <dst>     Upload or download files

  gen types             Generate TypeScript types

  sync push             Push local migrations and buckets to a remote Supabase project
  sync pull             Pull remote schema and buckets into local instance

  service               Run as a multi-tenant service (multiple isolated PGlite instances)

Service options:
  --service-port=<port>       HTTP listen port (default: 8080)
  --admin-token=<token>       Admin bearer token (required)
  --registry-db-url=<url>     Postgres URL for tenant registry (required; or NANO_REGISTRY_DB_URL env)
  --routing=<mode>            Routing mode: path (default) or subdomain
  --base-domain=<domain>      Base domain for subdomain routing (e.g. example.com → <slug>.example.com)
  --data-dir=<path>       Base dir for tenant data (default: /tmp/nano-service-data)
  --cold-dir=<path>       Disk offload cold storage dir (default: /tmp/nano-service-cold)
  --s3-bucket=<bucket>    S3 bucket name (enables S3 offload)
  --s3-endpoint=<url>     S3 custom endpoint URL
  --idle-timeout=<ms>     Idle timeout in ms (default: 600000)
  --idle-check=<ms>       Idle check interval in ms (default: 30000)

Sync options:
  --remote-url=<url>               Remote Supabase project URL (or SUPABASE_URL)
  --remote-service-role-key=<k>    Remote service role key (or SUPABASE_SERVICE_ROLE_KEY)
  --remote-db-url=<url>            Remote Postgres connection string (or SUPABASE_DB_URL)
  --no-migrations                  Skip migration sync
  --no-storage                     Skip storage bucket sync
  --dry-run                        Preview without writing

Start options:
  --data-dir=<path>            Persistence directory (default: in-memory)
  --http-port=<port>           HTTP API port (default: ${DEFAULT_HTTP_PORT})
  --tcp-port=<port>            Postgres TCP port (default: ${DEFAULT_TCP_PORT})
  --service-role-key=<key>     Service role key (default: ${DEFAULT_SERVICE_ROLE_KEY})
  --extensions=<names>         Comma-separated list of PGlite extensions to load (e.g. vector,pg_trgm)
  --count=<n>                  Start N instances (ports increment: httpPort+i, tcpPort+i; data dir: dataDir/i+1)
  --detach                     Run in background and print JSON connection info
  --pid-file=<path>            Write PID to additional file (default location: /tmp/nano-supabase-<port>.pid)
  --mcp                        Start MCP server on /mcp endpoint (Streamable HTTP transport)
  --debug                      Enable debug logging

Common options:
  --url=<url>                  Server URL (default: http://localhost:${DEFAULT_HTTP_PORT})
  --json                       Output raw JSON instead of human-readable text
  --help                       Show this help
  --version                    Show version`);
  process.exit(0);
}

if (argv.includes("--version")) {
  console.log("0.1.0");
  process.exit(0);
}

async function runSubCommand(): Promise<void> {
  let result: { exitCode: number; output: string };

  if (subCommand === "status") {
    result = await cmdStatus(subArgs);
  } else if (subCommand === "stop") {
    result = await cmdStop(subArgs);
  } else if (subCommand === "db") {
    const op = subArgs[0];
    const opArgs = subArgs.slice(1);
    if (op === "exec") result = await cmdDbExec(opArgs);
    else if (op === "dump") result = await cmdDbDump(opArgs);
    else if (op === "reset") result = await cmdDbReset(opArgs);
    else {
      process.stderr.write(
        JSON.stringify({
          error: "unknown_command",
          message: `Unknown db command: ${op}`,
        }) + "\n",
      );
      process.exit(1);
    }
  } else if (subCommand === "migration") {
    const op = subArgs[0];
    const opArgs = subArgs.slice(1);
    if (op === "new") result = await cmdMigrationNew(opArgs);
    else if (op === "list") result = await cmdMigrationList(opArgs);
    else if (op === "up") result = await cmdMigrationUp(opArgs);
    else {
      process.stderr.write(
        JSON.stringify({
          error: "unknown_command",
          message: `Unknown migration command: ${op}`,
        }) + "\n",
      );
      process.exit(1);
    }
  } else if (subCommand === "users") {
    const op = subArgs[0];
    const opArgs = subArgs.slice(1);
    if (op === "list") result = await cmdUsersList(opArgs);
    else if (op === "create") result = await cmdUsersCreate(opArgs);
    else if (op === "get") result = await cmdUsersGet(opArgs);
    else if (op === "delete") result = await cmdUsersDelete(opArgs);
    else {
      process.stderr.write(
        JSON.stringify({
          error: "unknown_command",
          message: `Unknown users command: ${op}`,
        }) + "\n",
      );
      process.exit(1);
    }
  } else if (subCommand === "storage") {
    const op = subArgs[0];
    const opArgs = subArgs.slice(1);
    if (op === "list-buckets") result = await cmdStorageListBuckets(opArgs);
    else if (op === "create-bucket")
      result = await cmdStorageCreateBucket(opArgs);
    else if (op === "ls") result = await cmdStorageLs(opArgs);
    else if (op === "cp") result = await cmdStorageCp(opArgs);
    else {
      process.stderr.write(
        JSON.stringify({
          error: "unknown_command",
          message: `Unknown storage command: ${op}`,
        }) + "\n",
      );
      process.exit(1);
    }
  } else if (subCommand === "gen") {
    const op = subArgs[0];
    const opArgs = subArgs.slice(1);
    if (op === "types") result = await cmdGenTypes(opArgs);
    else {
      process.stderr.write(
        JSON.stringify({
          error: "unknown_command",
          message: `Unknown gen command: ${op}`,
        }) + "\n",
      );
      process.exit(1);
    }
  } else if (subCommand === "sync") {
    const op = subArgs[0];
    const opArgs = subArgs.slice(1);
    if (op === "push") result = await cmdSyncPush(opArgs);
    else if (op === "pull") result = await cmdSyncPull(opArgs);
    else {
      process.stderr.write(
        JSON.stringify({
          error: "unknown_command",
          message: `Unknown sync operation: ${op}. Use push or pull.`,
        }) + "\n",
      );
      process.exit(1);
    }
  } else {
    process.stderr.write(
      JSON.stringify({
        error: "unknown_command",
        message: `Unknown command: ${subCommand}`,
      }) + "\n",
    );
    process.exit(1);
  }

  if (result!.exitCode !== 0) {
    process.stderr.write(result!.output + "\n");
  } else {
    process.stdout.write(result!.output + "\n");
  }
  process.exit(result!.exitCode);
}

if (subCommand !== "start" && subCommand !== "service") {
  await runSubCommand();
}

// --- Start command: server mode ---

function parsePort(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    process.stderr.write(`Invalid ${name}: "${raw}" (must be 1–65535)\n`);
    process.exit(1);
  }
  return n;
}

const httpPort = parsePort(
  getArgValue(subArgs, "--http-port"),
  DEFAULT_HTTP_PORT,
  "--http-port",
);
const tcpPort = parsePort(
  getArgValue(subArgs, "--tcp-port"),
  DEFAULT_TCP_PORT,
  "--tcp-port",
);
const dataDir = getArgValue(subArgs, "--data-dir");
const serviceRoleKey =
  getArgValue(subArgs, "--service-role-key") ??
  process.env.NANO_SUPABASE_SERVICE_ROLE_KEY ??
  DEFAULT_SERVICE_ROLE_KEY;
const debug = subArgs.includes("--debug");
const detach = subArgs.includes("--detach");
const mcp = subArgs.includes("--mcp");
const pidFile = getArgValue(subArgs, "--pid-file");
const count = (() => {
  const raw = getArgValue(subArgs, "--count");
  if (raw === undefined) return 1;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1) {
    process.stderr.write(`Invalid --count: "${raw}" (must be >= 1)\n`);
    process.exit(1);
  }
  return n;
})();
const extensionNames = (getArgValue(subArgs, "--extensions") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (detach) {
  const serverArgs = subArgs.filter((a) => a !== "--detach");
  const child = spawn(
    process.execPath,
    [process.argv[1], "start", ...serverArgs],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();

  const serverUrl = `http://localhost:${httpPort}`;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const res = await fetch(`${serverUrl}/health`);
      if (res.ok) {
        const output = {
          url: serverUrl,
          anon_key: DEFAULT_ANON_KEY,
          service_role_key: serviceRoleKey,
          pg: `postgresql://postgres@127.0.0.1:${tcpPort}/postgres`,
          pid: child.pid,
        };
        process.stdout.write(JSON.stringify(output) + "\n");
        process.exit(0);
      }
    } catch {
      // not ready yet
    }
  }
  process.stderr.write(
    JSON.stringify({
      error: "start_timeout",
      message: "Server did not start within 30s",
    }) + "\n",
  );
  process.exit(1);
}

const wasmModule = await WebAssembly.compile(
  await readFile(join(pgliteDist, "pglite.wasm")),
);
const fsBundle = new Blob([await readFile(join(pgliteDist, "pglite.data"))]);
const postgrestWasm = new Uint8Array(
  await readFile(join(__dirname, "postgrest_parser_bg.wasm")),
);

const pgcryptoExt: Extension = {
  name: "pgcrypto",
  setup: async (_pg, _emscriptenOpts) => ({
    bundlePath: new URL(`file://${join(pgliteDist, "pgcrypto.tar.gz")}`),
  }),
};
const uuidOsspExt: Extension = {
  name: "uuid-ossp",
  setup: async (_pg, _emscriptenOpts) => ({
    bundlePath: new URL(`file://${join(pgliteDist, "uuid-ossp.tar.gz")}`),
  }),
};

const _require = createRequire(import.meta.url);
const pglitePackageDist = dirname(_require.resolve("@electric-sql/pglite"));

const extraExtensions: Record<string, Extension> = {};
for (const name of extensionNames) {
  let tarPath = join(pgliteDist, `${name}.tar.gz`);
  try {
    await readFile(tarPath);
  } catch {
    const fallback = join(pglitePackageDist, `${name}.tar.gz`);
    try {
      await readFile(fallback);
      tarPath = fallback;
    } catch {
      process.stderr.write(
        JSON.stringify({
          error: "unknown_extension",
          message: `Extension "${name}" not found. Available extensions are listed at https://pglite.dev/extensions/`,
        }) + "\n",
      );
      process.exit(1);
    }
  }
  const resolvedPath = tarPath;
  extraExtensions[name.replace(/-/g, "_")] = {
    name,
    setup: async (_pg, _emscriptenOpts) => ({
      bundlePath: new URL(`file://${resolvedPath}`),
    }),
  };
}

if (subCommand === "service") {
  const { S3Client, PutObjectCommand, GetObjectCommand } =
    await import("@aws-sdk/client-s3");
  const { mkdir, rm, mkdtemp } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const servicePort = parsePort(
    getArgValue(subArgs, "--service-port"),
    8080,
    "--service-port",
  );
  const tcpBasePort = parsePort(
    getArgValue(subArgs, "--tcp-base-port"),
    54400,
    "--tcp-base-port",
  );
  const serviceRoleKey =
    getArgValue(subArgs, "--service-role-key") ?? DEFAULT_SERVICE_ROLE_KEY;
  const adminToken = getArgValue(subArgs, "--admin-token");
  if (!adminToken) {
    process.stderr.write(
      JSON.stringify({
        error: "missing_admin_token",
        message: "--admin-token is required for service mode",
      }) + "\n",
    );
    process.exit(1);
  }
  const serviceBaseDataDir =
    getArgValue(subArgs, "--data-dir") ?? "/tmp/nano-service-data";
  const coldDir =
    getArgValue(subArgs, "--cold-dir") ?? "/tmp/nano-service-cold";
  const s3Bucket = getArgValue(subArgs, "--s3-bucket");
  const s3Endpoint = getArgValue(subArgs, "--s3-endpoint");
  const routing = getArgValue(subArgs, "--routing") ?? "path";
  const baseDomain = getArgValue(subArgs, "--base-domain") ?? "";
  const idleTimeout = (() => {
    const raw = getArgValue(subArgs, "--idle-timeout");
    if (!raw) return 600000;
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 1000) {
      process.stderr.write(
        `Invalid --idle-timeout: "${raw}" (must be >= 1000ms)\n`,
      );
      process.exit(1);
    }
    return n;
  })();
  const idleCheck = (() => {
    const raw = getArgValue(subArgs, "--idle-check");
    if (!raw) return 30_000;
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 1000) {
      process.stderr.write(
        `Invalid --idle-check: "${raw}" (must be >= 1000ms)\n`,
      );
      process.exit(1);
    }
    return n;
  })();

  const registryDbUrl =
    getArgValue(subArgs, "--registry-db-url") ??
    process.env.NANO_REGISTRY_DB_URL;
  if (!registryDbUrl) {
    process.stderr.write(
      JSON.stringify({
        error: "missing_registry_db_url",
        message:
          "--registry-db-url (or NANO_REGISTRY_DB_URL) is required for service mode",
      }) + "\n",
    );
    process.exit(1);
  }
  await mkdir(serviceBaseDataDir, { recursive: true });
  await mkdir(coldDir, { recursive: true });

  const { Client } = await import("pg");
  const pgClient = new Client({ connectionString: registryDbUrl });
  await pgClient.connect();

  interface RegistryBackend {
    query<T extends Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<{ rows: T[] }>;
    exec(sql: string): Promise<void>;
    close(): Promise<void>;
  }

  const registry: RegistryBackend = {
    query: async <T extends Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ) => {
      const result = await pgClient.query(sql, params);
      return { rows: result.rows as T[] };
    },
    exec: async (sql: string) => {
      await pgClient.query(sql);
    },
    close: async () => pgClient.end(),
  };

  const { runner } = await import("node-pg-migrate");
  await runner({
    databaseUrl: registryDbUrl,
    migrationsTable: "service_migrations",
    dir: join(__dirname, "service-migrations"),
    direction: "up",
    count: Infinity,
    log: () => {},
  });

  const s3Client = s3Bucket
    ? new S3Client({
        region: process.env.AWS_REGION ?? "us-east-1",
        ...(s3Endpoint ? { endpoint: s3Endpoint, forcePathStyle: true } : {}),
        credentials: process.env.AWS_ACCESS_KEY_ID
          ? {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
            }
          : undefined,
      })
    : null;

  function log(event: string, meta: Record<string, unknown> = {}): void {
    process.stdout.write(
      JSON.stringify({ ts: new Date().toISOString(), event, ...meta }) + "\n",
    );
  }

  async function hashToken(token: string): Promise<string> {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest("SHA-256", enc.encode(token));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function offloadTenant(
    tenantDataDir: string,
    tenantId: string,
  ): Promise<void> {
    if (s3Bucket && s3Client) {
      const tmpDir = await mkdtemp("/tmp/nano-offload-");
      const archivePath = join(tmpDir, "data.tar.gz");
      await execFileAsync("tar", [
        "czf",
        archivePath,
        "-C",
        tenantDataDir,
        ".",
      ]);
      const archiveData = await readFile(archivePath);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: `tenants/${tenantId}/data.tar.gz`,
          Body: archiveData,
        }),
      );
      await rm(tmpDir, { recursive: true, force: true });
    } else {
      const archivePath = join(coldDir, `${tenantId}.tar.gz`);
      await execFileAsync("tar", [
        "czf",
        archivePath,
        "-C",
        tenantDataDir,
        ".",
      ]);
    }
    await rm(tenantDataDir, { recursive: true, force: true });
  }

  async function pullTenant(
    tenantDataDir: string,
    tenantId: string,
  ): Promise<void> {
    await mkdir(tenantDataDir, { recursive: true });
    if (s3Bucket && s3Client) {
      const tmpDir = await mkdtemp("/tmp/nano-pull-");
      const archivePath = join(tmpDir, "data.tar.gz");
      const resp = await s3Client.send(
        new GetObjectCommand({
          Bucket: s3Bucket,
          Key: `tenants/${tenantId}/data.tar.gz`,
        }),
      );
      const chunks: Uint8Array[] = [];
      if (resp.Body) {
        for await (const chunk of resp.Body as AsyncIterable<Uint8Array>) {
          chunks.push(chunk);
        }
      }
      await writeFile(archivePath, Buffer.concat(chunks));
      await execFileAsync("tar", ["xzf", archivePath, "-C", tenantDataDir]);
      await rm(tmpDir, { recursive: true, force: true });
    } else {
      const archivePath = join(coldDir, `${tenantId}.tar.gz`);
      await execFileAsync("tar", ["xzf", archivePath, "-C", tenantDataDir]);
    }
  }

  type TenantState = "running" | "sleeping" | "waking" | "pausing";

  interface TenantUsage {
    requests: number;
    errors: number;
    totalLatencyMs: number;
    lastLatencyMs: number;
    bytesIn: number;
    bytesOut: number;
  }

  interface TenantEntry {
    id: string;
    slug: string;
    dataDir: string;
    tokenHash: string;
    state: TenantState;
    lastActive: Date;
    nano: NanoSupabaseInstance | null;
    usage: TenantUsage;
    tcpPort: number;
    anonKey: string;
    serviceRoleKey: string;
  }

  const usageMap = new Map<string, TenantUsage>();

  function getUsage(id: string): TenantUsage {
    if (!usageMap.has(id))
      usageMap.set(id, {
        requests: 0,
        errors: 0,
        totalLatencyMs: 0,
        lastLatencyMs: 0,
        bytesIn: 0,
        bytesOut: 0,
      });
    return usageMap.get(id)!;
  }

  const nanoInstances = new Map<string, NanoSupabaseInstance | null>();
  const tcpServers = new Map<
    string,
    import("./tcp-server.ts").PGliteTCPServer
  >();
  const { PGliteTCPServer } = await import("./tcp-server.ts");

  const maxPortResult = await registry.query<{ max_port: number | null }>(
    "SELECT MAX(tcp_port) as max_port FROM tenants",
  );
  let nextTcpPort = (maxPortResult.rows[0]?.max_port ?? tcpBasePort - 1) + 1;

  interface DbTenantRow {
    id: string;
    slug: string;
    data_dir: string;
    token_hash: string;
    state: string;
    last_active: string;
    tcp_port: number | null;
    anon_key: string;
    service_role_key: string;
  }

  function rowToEntry(row: DbTenantRow): TenantEntry {
    if (!usageMap.has(row.id))
      usageMap.set(row.id, {
        requests: 0,
        errors: 0,
        totalLatencyMs: 0,
        lastLatencyMs: 0,
        bytesIn: 0,
        bytesOut: 0,
      });
    let tcpPort = row.tcp_port;
    if (tcpPort == null) {
      tcpPort = nextTcpPort++;
      registry
        .query("UPDATE tenants SET tcp_port=$1 WHERE id=$2", [tcpPort, row.id])
        .catch(() => {});
    }
    return {
      id: row.id,
      slug: row.slug,
      dataDir: row.data_dir,
      tokenHash: row.token_hash,
      state: row.state as TenantState,
      lastActive: new Date(row.last_active),
      nano: nanoInstances.get(row.id) ?? null,
      usage: usageMap.get(row.id)!,
      tcpPort,
      anonKey: row.anon_key ?? DEFAULT_ANON_KEY,
      serviceRoleKey: row.service_role_key ?? serviceRoleKey,
    };
  }

  async function getTenant(slug: string): Promise<TenantEntry | undefined> {
    const result = await registry.query<DbTenantRow>(
      "SELECT * FROM tenants WHERE slug = $1",
      [slug],
    );
    if (!result.rows.length) return undefined;
    return rowToEntry(result.rows[0]);
  }

  async function listTenants(): Promise<TenantEntry[]> {
    const result = await registry.query<DbTenantRow>(
      "SELECT * FROM tenants ORDER BY slug",
    );
    return result.rows.map(rowToEntry);
  }

  async function createTenantRecord(entry: TenantEntry): Promise<void> {
    await registry.query(
      "INSERT INTO tenants (id, slug, data_dir, token_hash, state, last_active, tcp_port, anon_key, service_role_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        entry.id,
        entry.slug,
        entry.dataDir,
        entry.tokenHash,
        entry.state,
        entry.lastActive.toISOString(),
        entry.tcpPort,
        entry.anonKey,
        entry.serviceRoleKey,
      ],
    );
  }

  async function updateTenantState(
    id: string,
    state: TenantState,
  ): Promise<void> {
    await registry.query("UPDATE tenants SET state = $1 WHERE id = $2", [
      state,
      id,
    ]);
  }

  async function updateLastActive(id: string): Promise<void> {
    await registry.query(
      "UPDATE tenants SET last_active = now() WHERE id = $1",
      [id],
    );
  }

  async function deleteTenantRecord(id: string): Promise<void> {
    await registry.query("DELETE FROM tenants WHERE id = $1", [id]);
  }

  async function updateTokenHash(id: string, hash: string): Promise<void> {
    await registry.query("UPDATE tenants SET token_hash = $1 WHERE id = $2", [
      hash,
      id,
    ]);
  }

  const existingRows = await registry.query<DbTenantRow>(
    "SELECT * FROM tenants",
  );
  for (const row of existingRows.rows) {
    nanoInstances.set(row.id, null);
    if (row.tcp_port == null) {
      const port = nextTcpPort++;
      await registry.query("UPDATE tenants SET tcp_port=$1 WHERE id=$2", [
        port,
        row.id,
      ]);
      row.tcp_port = port;
    }
    if (row.state !== "sleeping") {
      await registry.query(
        "UPDATE tenants SET state = 'sleeping' WHERE id = $1",
        [row.id],
      );
    }
  }

  async function startTenantNano(tenant: TenantEntry): Promise<void> {
    const origLog = console.log;
    console.log = () => {};
    try {
      const nanoInstance = await nanoSupabase({
        dataDir: tenant.dataDir,
        wasmModule,
        fsBundle,
        postgrestWasmBytes: postgrestWasm,
        extensions: {
          pgcrypto: pgcryptoExt,
          uuid_ossp: uuidOsspExt,
        },
      });
      nanoInstances.set(tenant.id, nanoInstance);
      tenant.nano = nanoInstance;
      const tcpServer = await PGliteTCPServer.create(nanoInstance.db);
      await tcpServer.start(tenant.tcpPort, "0.0.0.0");
      tcpServers.set(tenant.id, tcpServer);
    } finally {
      console.log = origLog;
    }
    await updateTenantState(tenant.id, "running");
    tenant.state = "running";
    log("tenant.started", {
      tenant_id: tenant.id,
      slug: tenant.slug,
      data_dir: tenant.dataDir,
      tcp_port: tenant.tcpPort,
    });
  }

  const wakeStubs = new Map<string, import("node:net").Server>();

  function startWakeStub(tenant: TenantEntry): void {
    const stub = createTcpServer((socket) => {
      socket.destroy();
      stub.close();
      wakeStubs.delete(tenant.id);
      log("tenant.wake_on_tcp", {
        tenant_id: tenant.id,
        slug: tenant.slug,
        tcp_port: tenant.tcpPort,
      });
      wakeTenant(tenant).catch(() => {});
    });
    stub.listen(tenant.tcpPort, "0.0.0.0");
    wakeStubs.set(tenant.id, stub);
  }

  async function pauseTenant(tenant: TenantEntry): Promise<void> {
    if (tenant.state !== "running") return;
    log("tenant.pausing", {
      tenant_id: tenant.id,
      slug: tenant.slug,
      offloader: s3Bucket ? "s3" : "disk",
    });
    await updateTenantState(tenant.id, "pausing");
    tenant.state = "pausing";
    const tcpServer = tcpServers.get(tenant.id);
    if (tcpServer) {
      await tcpServer.stop();
      tcpServers.delete(tenant.id);
    }
    nanoInstances.set(tenant.id, null);
    tenant.nano = null;
    await offloadTenant(tenant.dataDir, tenant.id);
    await updateTenantState(tenant.id, "sleeping");
    tenant.state = "sleeping";
    startWakeStub(tenant);
    log("tenant.sleeping", { tenant_id: tenant.id, slug: tenant.slug });
  }

  async function wakeTenant(tenant: TenantEntry): Promise<void> {
    if (tenant.state !== "sleeping") return;
    const stub = wakeStubs.get(tenant.id);
    if (stub) {
      stub.close();
      wakeStubs.delete(tenant.id);
    }
    const { access: statAccess } = await import("node:fs/promises");
    const hasLocalData = await statAccess(tenant.dataDir)
      .then(() => true)
      .catch(() => false);
    log("tenant.waking", {
      tenant_id: tenant.id,
      slug: tenant.slug,
      data_dir: tenant.dataDir,
      offloader: hasLocalData ? "none (local)" : s3Bucket ? "s3" : "disk",
    });
    await updateTenantState(tenant.id, "waking");
    tenant.state = "waking";
    if (!hasLocalData) await pullTenant(tenant.dataDir, tenant.id);
    await startTenantNano(tenant);
  }

  function tenantPublic(t: TenantEntry) {
    const u = t.usage;
    return {
      id: t.id,
      slug: t.slug,
      state: t.state,
      lastActive: t.lastActive.toISOString(),
      tcpPort: t.tcpPort,
      pgUrl: `postgresql://postgres@localhost:${t.tcpPort}/postgres`,
      anonKey: t.anonKey,
      serviceRoleKey: t.serviceRoleKey,
      usage: {
        requests: u.requests,
        errors: u.errors,
        avgLatencyMs:
          u.requests > 0 ? Math.round(u.totalLatencyMs / u.requests) : 0,
        lastLatencyMs: u.lastLatencyMs,
        bytesIn: u.bytesIn,
        bytesOut: u.bytesOut,
      },
    };
  }

  async function requireAdminToken(req: Request): Promise<Response | null> {
    const auth = req.headers.get("Authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) {
      return new Response(
        JSON.stringify({
          error: "unauthorized",
          message: "Missing bearer token",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
    const hash = await hashToken(token);
    const adminHash = await hashToken(adminToken!);
    if (hash !== adminHash) {
      return new Response(
        JSON.stringify({
          error: "unauthorized",
          message: "Invalid admin token",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
    return null;
  }

  async function serviceHandler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const json = { "Content-Type": "application/json" };

    if (url.pathname === "/health" && req.method === "GET") {
      return new Response(JSON.stringify({ ok: true }), { headers: json });
    }

    if (url.pathname.startsWith("/admin/")) {
      const authErr = await requireAdminToken(req);
      if (authErr) return authErr;

      if (url.pathname === "/admin/tenants" && req.method === "GET") {
        return new Response(
          JSON.stringify((await listTenants()).map(tenantPublic)),
          { headers: json },
        );
      }

      if (url.pathname === "/admin/usage" && req.method === "GET") {
        const tenants = await listTenants();
        const rows = tenants.map((t) => ({
          slug: t.slug,
          state: t.state,
          ...tenantPublic(t).usage,
        }));
        const totals = rows.reduce(
          (acc, r) => ({
            requests: acc.requests + r.requests,
            errors: acc.errors + r.errors,
            bytesIn: acc.bytesIn + r.bytesIn,
            bytesOut: acc.bytesOut + r.bytesOut,
            totalLatencyMs: acc.totalLatencyMs + r.avgLatencyMs * r.requests,
          }),
          {
            requests: 0,
            errors: 0,
            bytesIn: 0,
            bytesOut: 0,
            totalLatencyMs: 0,
          },
        );
        return new Response(
          JSON.stringify({
            tenants: rows,
            totals: {
              ...totals,
              avgLatencyMs:
                totals.requests > 0
                  ? Math.round(totals.totalLatencyMs / totals.requests)
                  : 0,
            },
          }),
          { headers: json },
        );
      }

      if (url.pathname === "/admin/tenants" && req.method === "POST") {
        const { slug } = (await req.json()) as { slug: string };
        if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
          return new Response(
            JSON.stringify({
              error: "invalid_slug",
              message: "slug must match [a-z0-9-]+",
            }),
            { status: 400, headers: json },
          );
        }
        if (await getTenant(slug)) {
          return new Response(
            JSON.stringify({
              error: "conflict",
              message: "Tenant slug already exists",
            }),
            { status: 409, headers: json },
          );
        }
        const id = crypto.randomUUID();
        const plainToken = crypto.randomUUID();
        const tokenHash = await hashToken(plainToken);
        const tenantDataDir = join(serviceBaseDataDir, id);
        await mkdir(tenantDataDir, { recursive: true });
        usageMap.set(id, {
          requests: 0,
          errors: 0,
          totalLatencyMs: 0,
          lastLatencyMs: 0,
          bytesIn: 0,
          bytesOut: 0,
        });
        const tenantTcpPort = nextTcpPort++;
        const tenant: TenantEntry = {
          id,
          slug,
          dataDir: tenantDataDir,
          tokenHash,
          state: "sleeping",
          lastActive: new Date(),
          nano: null,
          usage: usageMap.get(id)!,
          tcpPort: tenantTcpPort,
          anonKey: DEFAULT_ANON_KEY,
          serviceRoleKey,
        };
        nanoInstances.set(id, null);
        await createTenantRecord(tenant);
        log("tenant.created", { tenant_id: id, slug, data_dir: tenantDataDir });
        await startTenantNano(tenant);
        return new Response(
          JSON.stringify({ token: plainToken, tenant: tenantPublic(tenant) }),
          { status: 201, headers: json },
        );
      }

      const slugMatch = url.pathname.match(
        /^\/admin\/tenants\/([^/]+)(\/.*)?$/,
      );
      if (slugMatch) {
        const slug = slugMatch[1];
        const subpath = slugMatch[2] ?? "";
        const tenant = await getTenant(slug);
        if (!tenant) {
          return new Response(
            JSON.stringify({ error: "not_found", message: "Tenant not found" }),
            { status: 404, headers: json },
          );
        }

        if (subpath === "" && req.method === "GET") {
          return new Response(JSON.stringify(tenantPublic(tenant)), {
            headers: json,
          });
        }

        if (subpath === "" && req.method === "DELETE") {
          nanoInstances.delete(tenant.id);
          try {
            await rm(tenant.dataDir, { recursive: true, force: true });
          } catch {}
          try {
            if (!s3Bucket || !s3Client) {
              await rm(join(coldDir, `${tenant.id}.tar.gz`), { force: true });
            }
          } catch {}
          await deleteTenantRecord(tenant.id);
          log("tenant.deleted", { tenant_id: tenant.id, slug: tenant.slug });
          return new Response(JSON.stringify({ deleted: true }), {
            headers: json,
          });
        }

        if (subpath === "/pause" && req.method === "POST") {
          if (tenant.state !== "running") {
            return new Response(
              JSON.stringify({
                error: "invalid_state",
                message: `Tenant is ${tenant.state}`,
              }),
              { status: 409, headers: json },
            );
          }
          await pauseTenant(tenant);
          return new Response(JSON.stringify(tenantPublic(tenant)), {
            headers: json,
          });
        }

        if (subpath === "/wake" && req.method === "POST") {
          if (tenant.state !== "sleeping") {
            return new Response(
              JSON.stringify({
                error: "invalid_state",
                message: `Tenant is ${tenant.state}`,
              }),
              { status: 409, headers: json },
            );
          }
          await wakeTenant(tenant);
          return new Response(JSON.stringify(tenantPublic(tenant)), {
            headers: json,
          });
        }

        if (subpath === "/reset-token" && req.method === "POST") {
          const plainToken = crypto.randomUUID();
          const newHash = await hashToken(plainToken);
          await updateTokenHash(tenant.id, newHash);
          return new Response(JSON.stringify({ token: plainToken }), {
            headers: json,
          });
        }

        if (subpath === "/sql" && req.method === "POST") {
          const nano = nanoInstances.get(tenant.id);
          if (!nano)
            return new Response(
              JSON.stringify({ error: "tenant_not_running" }),
              { status: 409, headers: json },
            );
          const { sql, params = [] } = (await req.json()) as {
            sql: string;
            params?: unknown[];
          };
          try {
            try {
              const result = await nano.db.query(sql, params as unknown[]);
              return new Response(
                JSON.stringify({
                  rows: result.rows,
                  rowCount: result.rows.length,
                }),
                { headers: json },
              );
            } catch (inner: unknown) {
              const msg =
                inner instanceof Error ? inner.message : String(inner);
              if (!msg.includes("cannot insert multiple commands")) throw inner;
              await nano.db.exec(sql);
              return new Response(JSON.stringify({ rows: [], rowCount: 0 }), {
                headers: json,
              });
            }
          } catch (e: unknown) {
            return new Response(
              JSON.stringify({
                error: e instanceof Error ? e.message : String(e),
              }),
              { status: 400, headers: json },
            );
          }
        }
      }

      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: json,
      });
    }

    let slug: string;
    let restPath: string;
    if (routing === "subdomain") {
      const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
      const suffix = baseDomain ? `.${baseDomain}` : ".localhost";
      if (!host.endsWith(suffix) || host === suffix.slice(1)) {
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: json,
        });
      }
      slug = host.slice(0, host.length - suffix.length);
      restPath = url.pathname || "/";
    } else {
      const slugMatch = url.pathname.match(/^\/([^/]+)(\/.*)?$/);
      if (!slugMatch) {
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: json,
        });
      }
      slug = slugMatch[1];
      restPath = slugMatch[2] ?? "/";
    }
    const tenant = await getTenant(slug);
    if (!tenant) {
      return new Response(
        JSON.stringify({ error: "not_found", message: "Tenant not found" }),
        { status: 404, headers: json },
      );
    }

    const auth = req.headers.get("Authorization");
    const bearerToken = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!bearerToken) {
      return new Response(
        JSON.stringify({
          error: "unauthorized",
          message: "Missing bearer token",
        }),
        { status: 401, headers: json },
      );
    }
    const incomingHash = await hashToken(bearerToken);
    if (incomingHash !== tenant.tokenHash) {
      return new Response(
        JSON.stringify({
          error: "unauthorized",
          message: "Invalid tenant token",
        }),
        { status: 401, headers: json },
      );
    }

    if (tenant.state === "sleeping") {
      await wakeTenant(tenant);
    } else if (tenant.state === "waking" || tenant.state === "pausing") {
      return new Response(
        JSON.stringify({
          error: "tenant_busy",
          message: `Tenant is ${tenant.state}`,
        }),
        { status: 503, headers: json },
      );
    }

    await updateLastActive(tenant.id);
    tenant.lastActive = new Date();

    const forwardHeaders = new Headers(req.headers);
    forwardHeaders.delete("Authorization");
    forwardHeaders.set("apikey", DEFAULT_ANON_KEY);
    const forwardBody =
      req.method !== "GET" && req.method !== "HEAD"
        ? await req.arrayBuffer()
        : undefined;
    const internalReq = new Request(
      `http://localhost:54321${restPath}${url.search}`,
      {
        method: req.method,
        headers: forwardHeaders,
        body: forwardBody?.byteLength ? forwardBody : undefined,
      },
    );

    const usage = getUsage(tenant.id);
    usage.bytesIn += forwardBody?.byteLength ?? 0;
    const t0 = Date.now();
    const activNano = nanoInstances.get(tenant.id);
    const res = await activNano!.localFetch(internalReq);
    const latency = Date.now() - t0;
    const resBody = await res.arrayBuffer();
    usage.requests++;
    usage.totalLatencyMs += latency;
    usage.lastLatencyMs = latency;
    usage.bytesOut += resBody.byteLength;
    if (res.status >= 500) usage.errors++;
    log("request", {
      tenant_id: tenant.id,
      slug: tenant.slug,
      method: req.method,
      path: restPath,
      status: res.status,
      latency_ms: latency,
    });
    return new Response(resBody, { status: res.status, headers: res.headers });
  }

  const serviceServer = createServer(async (nodeReq, nodeRes) => {
    const url = `http://localhost:${servicePort}${nodeReq.url}`;
    const hasBody = nodeReq.method !== "GET" && nodeReq.method !== "HEAD";
    const chunks: Buffer[] = [];
    if (hasBody) {
      for await (const chunk of nodeReq) chunks.push(chunk as Buffer);
    }
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    const req = new Request(url, {
      method: nodeReq.method,
      headers: nodeReq.headers as HeadersInit,
      body: body?.length ? body : undefined,
    });
    try {
      const res = await serviceHandler(req);
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        resHeaders[k] = v;
      });
      nodeRes.writeHead(res.status, resHeaders);
      nodeRes.end(Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("error", {
        error: msg,
        stack:
          e instanceof Error
            ? e.stack?.split("\n").slice(0, 3).join(" ")
            : undefined,
      });
      if (!nodeRes.headersSent) {
        nodeRes.writeHead(500, { "Content-Type": "application/json" });
        nodeRes.end(JSON.stringify({ error: "internal_error", message: msg }));
      }
    }
  });

  setInterval(async () => {
    const now = Date.now();
    for (const tenant of await listTenants()) {
      if (
        tenant.state === "running" &&
        now - tenant.lastActive.getTime() > idleTimeout
      ) {
        log("tenant.idle", {
          tenant_id: tenant.id,
          slug: tenant.slug,
          idle_ms: now - tenant.lastActive.getTime(),
        });
        await pauseTenant(tenant).catch((e: unknown) => {
          log("error", {
            error: e instanceof Error ? e.message : String(e),
            tenant_id: tenant.id,
            slug: tenant.slug,
          });
        });
      }
    }
  }, idleCheck);

  for (const row of existingRows.rows) {
    startWakeStub(rowToEntry(row));
  }

  serviceServer.listen(servicePort);
  log("service.started", {
    port: servicePort,
    offloader: s3Bucket ? "s3" : "disk",
    registry: "postgres",
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      serviceServer.close();
      for (const [, stub] of wakeStubs) stub.close();
      for (const [id, tcpServer] of tcpServers) {
        await tcpServer.stop().catch(() => {});
        tcpServers.delete(id);
      }
      await registry.close().catch(() => {});
      process.exit(0);
    });
  }
} else {
  const origConsoleLog = console.log;
  console.log = () => {};
  let nano: Awaited<ReturnType<typeof nanoSupabase>>;
  try {
    nano = await nanoSupabase({
      dataDir,
      tcp: { port: tcpPort },
      debug,
      wasmModule,
      fsBundle,
      postgrestWasmBytes: postgrestWasm,
      extensions: {
        pgcrypto: pgcryptoExt,
        uuid_ossp: uuidOsspExt,
        ...extraExtensions,
      },
      serviceRoleKey,
    });
  } finally {
    console.log = origConsoleLog;
  }

  const defaultPidFilePath = `/tmp/nano-supabase-${httpPort}.pid`;
  await writeFile(defaultPidFilePath, String(process.pid));
  if (pidFile) {
    await writeFile(pidFile, String(process.pid));
  }

  async function ensureMigrationsTable(
    db: NanoSupabaseInstance["db"],
  ): Promise<void> {
    await db.exec(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version TEXT PRIMARY KEY,
      statements TEXT[],
      name TEXT
    );
  `);
  }

  function requireServiceRole(req: Request): Response | null {
    const auth = req.headers.get("Authorization");
    if (auth !== `Bearer ${serviceRoleKey}`) {
      return new Response(
        JSON.stringify({
          error: "unauthorized",
          message: "Invalid service role key",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return null;
  }

  async function handleAdminRequest(req: Request): Promise<Response | null> {
    const url = new URL(req.url);

    if (url.pathname === "/health" && req.method === "GET") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!url.pathname.startsWith("/admin/v1/")) return null;

    const authError = requireServiceRole(req);
    if (authError) return authError;

    if (url.pathname === "/admin/v1/sql" && req.method === "POST") {
      const { sql, params = [] } = (await req.json()) as {
        sql: string;
        params?: unknown[];
      };
      try {
        try {
          const result = await nano.db.query(sql, params);
          return new Response(
            JSON.stringify({
              rows: result.rows,
              rowCount: result.rows.length,
              fields: result.fields.map((f: { name: string }) => f.name),
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        } catch (inner: unknown) {
          const msg = inner instanceof Error ? inner.message : String(inner);
          if (
            !msg.includes(
              "cannot insert multiple commands into a prepared statement",
            )
          )
            throw inner;
          await nano.db.exec(sql);
          return new Response(
            JSON.stringify({ rows: [], rowCount: 0, fields: [] }),
            { headers: { "Content-Type": "application/json" } },
          );
        }
      } catch (e: unknown) {
        return new Response(
          JSON.stringify({
            error: "sql_error",
            message: e instanceof Error ? e.message : String(e),
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    if (url.pathname === "/admin/v1/schema" && req.method === "GET") {
      const wantJson = url.searchParams.get("format") === "json";
      const result = await nano.db.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT table_name, column_name, data_type, is_nullable, ordinal_position
       FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position`,
      );

      if (wantJson) {
        return new Response(JSON.stringify(result.rows), {
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const dump = await pgDump({
          pg: nano.db,
          args: ["--schema-only", "--no-owner", "--no-acl"],
        });
        const ddl = await dump.text();
        return new Response(ddl, { headers: { "Content-Type": "text/plain" } });
      } catch {
        return new Response("", { headers: { "Content-Type": "text/plain" } });
      }
    }

    if (url.pathname === "/admin/v1/reset" && req.method === "POST") {
      const tables = await nano.db.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
      );
      const tableNames = tables.rows.map((r) => r.tablename);
      if (tableNames.length > 0) {
        await nano.db.exec(
          `DROP TABLE IF EXISTS ${tableNames.map((t) => `"${t}"`).join(", ")} CASCADE`,
        );
      }
      const migCount = await nano.db
        .query<{
          count: string;
        }>(
          `SELECT COUNT(*)::text as count FROM supabase_migrations.schema_migrations`,
        )
        .catch(() => ({ rows: [{ count: "0" }] }));
      await nano.db
        .exec(`DELETE FROM supabase_migrations.schema_migrations`)
        .catch(() => {});
      return new Response(
        JSON.stringify({
          dropped_tables: tableNames,
          migrations_applied: parseInt(migCount.rows[0]?.count ?? "0", 10),
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.pathname === "/admin/v1/migrations" && req.method === "GET") {
      await ensureMigrationsTable(nano.db);
      const result = await nano.db.query<{ version: string; name: string }>(
        `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version`,
      );
      return new Response(
        JSON.stringify({
          migrations: result.rows.map((r) => ({
            name: r.name,
            version: r.version,
          })),
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (
      url.pathname === "/admin/v1/migrations/applied" &&
      req.method === "POST"
    ) {
      await ensureMigrationsTable(nano.db);
      const { name, statements } = (await req.json()) as {
        name: string;
        statements?: string[];
      };
      const version = name.replace(/\.sql$/, "").split("_")[0];
      await nano.db.query(
        `INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING`,
        [version, name, statements ?? []],
      );
      return new Response(JSON.stringify({ recorded: true, name }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return null;
  }

  async function handleManagementApiRequest(
    req: Request,
  ): Promise<Response | null> {
    const url = new URL(req.url);
    const mgmtMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)(\/.*)?$/);
    if (!mgmtMatch) return null;

    const authError = requireServiceRole(req);
    if (authError) return authError;

    const ref = mgmtMatch[1];
    const subpath = mgmtMatch[2] ?? "";
    const json = { headers: { "Content-Type": "application/json" } };

    if (subpath === "" && req.method === "GET") {
      return new Response(
        JSON.stringify({
          id: ref,
          ref,
          name: "local",
          status: "ACTIVE_HEALTHY",
          region: "local",
          organization_id: "local",
          organization_slug: "local",
          created_at: new Date().toISOString(),
        }),
        json,
      );
    }

    if (subpath === "/database/query" && req.method === "POST") {
      const { query, parameters = [] } = (await req.json()) as {
        query: string;
        parameters?: unknown[];
      };
      try {
        const result = await nano.db.query(query, parameters);
        return new Response(JSON.stringify(result.rows), json);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          msg.includes(
            "cannot insert multiple commands into a prepared statement",
          )
        ) {
          try {
            await nano.db.exec(query);
            return new Response(JSON.stringify([]), json);
          } catch (e2: unknown) {
            return new Response(
              JSON.stringify({
                message: e2 instanceof Error ? e2.message : String(e2),
              }),
              { status: 400, ...json },
            );
          }
        }
        return new Response(JSON.stringify({ message: msg }), {
          status: 400,
          ...json,
        });
      }
    }

    if (subpath === "/database/migrations" && req.method === "GET") {
      await ensureMigrationsTable(nano.db);
      const result = await nano.db.query<{ version: string; name: string }>(
        `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version`,
      );
      return new Response(
        JSON.stringify(
          result.rows.map((r) => ({ version: r.version, name: r.name })),
        ),
        json,
      );
    }

    if (subpath === "/database/migrations" && req.method === "POST") {
      const { name, query } = (await req.json()) as {
        name: string;
        query: string;
      };
      await ensureMigrationsTable(nano.db);
      try {
        await nano.db.exec(query);
        const version = name.replace(/\.sql$/, "").split("_")[0];
        const statements = query
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => s + ";");
        await nano.db.query(
          `INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING`,
          [version, name, statements],
        );
        return new Response(JSON.stringify({ name }), json);
      } catch (e: unknown) {
        return new Response(
          JSON.stringify({
            message: e instanceof Error ? e.message : String(e),
          }),
          { status: 400, ...json },
        );
      }
    }

    if (subpath === "/storage/buckets" && req.method === "GET") {
      const internalReq = new Request(
        `http://localhost:${httpPort}/storage/v1/bucket`,
        {
          headers: { Authorization: `Bearer ${serviceRoleKey}` },
        },
      );
      const res = await nano.localFetch(internalReq);
      return new Response(await res.text(), { status: res.status, ...json });
    }

    if (subpath === "/api-keys" && req.method === "GET") {
      return new Response(
        JSON.stringify([
          { name: "anon", api_key: DEFAULT_ANON_KEY, type: "legacy" },
          { name: "service_role", api_key: serviceRoleKey, type: "legacy" },
        ]),
        json,
      );
    }

    if (
      (subpath === "/advisors/security" ||
        subpath === "/advisors/performance") &&
      req.method === "GET"
    ) {
      const type =
        subpath === "/advisors/security" ? "security" : "performance";
      const lints = await runAdvisors(type);
      return new Response(JSON.stringify({ lints }), json);
    }

    return null;
  }

  const EXCLUDED_SCHEMAS = `'pg_catalog','information_schema','auth','storage','vault','extensions','cron','net','pgmq','realtime','supabase_functions','supabase_migrations','pgsodium','pgsodium_masks','pgtle','pgbouncer','graphql','graphql_public','tiger','topology'`;

  async function runAdvisors(
    type: "security" | "performance",
  ): Promise<unknown[]> {
    const results: unknown[] = [];

    if (type === "security") {
      // rls_disabled_in_public: tables in public schema without RLS
      try {
        const rows = await nano.db.query<{ schema: string; name: string }>(`
        SELECT n.nspname AS schema, c.relname AS name
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_catalog.pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
        WHERE c.relkind = 'r'
          AND n.nspname = 'public'
          AND c.relrowsecurity = false
          AND d.objid IS NULL
        ORDER BY c.relname
      `);
        for (const row of rows.rows) {
          results.push({
            name: "rls_disabled_in_public",
            title: "RLS Disabled in Public",
            level: "ERROR",
            facing: "EXTERNAL",
            categories: ["SECURITY"],
            description:
              "Table is in the public schema and does not have Row Level Security enabled.",
            detail: `Table "${row.schema}"."${row.name}" is publicly accessible without RLS.`,
            remediation:
              "https://supabase.com/docs/guides/database/postgres/row-level-security",
            metadata: { schema: row.schema, name: row.name, type: "table" },
            cache_key: `rls_disabled_in_public_${row.schema}_${row.name}`,
          });
        }
      } catch {
        /* table may not exist */
      }

      // rls_enabled_no_policy: RLS enabled but no policies defined
      try {
        const rows = await nano.db.query<{ schema: string; name: string }>(`
        SELECT n.nspname AS schema, c.relname AS name
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = c.oid
        LEFT JOIN pg_catalog.pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
        WHERE c.relkind = 'r'
          AND c.relrowsecurity = true
          AND n.nspname NOT IN (${EXCLUDED_SCHEMAS})
          AND d.objid IS NULL
        GROUP BY n.nspname, c.relname
        HAVING count(p.oid) = 0
        ORDER BY c.relname
      `);
        for (const row of rows.rows) {
          results.push({
            name: "rls_enabled_no_policy",
            title: "RLS Enabled With No Policies",
            level: "INFO",
            facing: "EXTERNAL",
            categories: ["SECURITY"],
            description:
              "Table has RLS enabled but no policies defined. All non-owner access is blocked.",
            detail: `Table "${row.schema}"."${row.name}" has RLS enabled but no policies exist.`,
            remediation:
              "https://supabase.com/docs/guides/database/postgres/row-level-security",
            metadata: { schema: row.schema, name: row.name, type: "table" },
            cache_key: `rls_enabled_no_policy_${row.schema}_${row.name}`,
          });
        }
      } catch {
        /* table may not exist */
      }

      // policy_exists_rls_disabled: policies exist but RLS is not enabled
      try {
        const rows = await nano.db.query<{ schema: string; name: string }>(`
        SELECT DISTINCT n.nspname AS schema, c.relname AS name
        FROM pg_catalog.pg_policy p
        JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_catalog.pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
        WHERE c.relrowsecurity = false
          AND n.nspname NOT IN (${EXCLUDED_SCHEMAS})
          AND d.objid IS NULL
        ORDER BY c.relname
      `);
        for (const row of rows.rows) {
          results.push({
            name: "policy_exists_rls_disabled",
            title: "Policy Exists but RLS is Disabled",
            level: "ERROR",
            facing: "EXTERNAL",
            categories: ["SECURITY"],
            description:
              "A policy exists on the table but Row Level Security is not enabled, so the policy has no effect.",
            detail: `Table "${row.schema}"."${row.name}" has policies but RLS is disabled — policies are silently ignored.`,
            remediation:
              "https://supabase.com/docs/guides/database/postgres/row-level-security",
            metadata: { schema: row.schema, name: row.name, type: "table" },
            cache_key: `policy_exists_rls_disabled_${row.schema}_${row.name}`,
          });
        }
      } catch {
        /* table may not exist */
      }

      // function_search_path_mutable: security definer functions without fixed search_path
      try {
        const rows = await nano.db.query<{ schema: string; name: string }>(`
        SELECT n.nspname AS schema, p.proname AS name
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON p.pronamespace = n.oid
        LEFT JOIN pg_catalog.pg_depend d ON p.oid = d.objid AND d.deptype = 'e'
        WHERE p.prosecdef = true
          AND n.nspname NOT IN (${EXCLUDED_SCHEMAS})
          AND d.objid IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) AS cfg
            WHERE cfg LIKE 'search_path=%'
          )
        ORDER BY p.proname
      `);
        for (const row of rows.rows) {
          results.push({
            name: "function_search_path_mutable",
            title: "Function with Mutable Search Path",
            level: "WARN",
            facing: "EXTERNAL",
            categories: ["SECURITY"],
            description:
              "Security definer function without a fixed search_path is vulnerable to search_path injection.",
            detail: `Function "${row.schema}"."${row.name}" is SECURITY DEFINER but has no fixed search_path.`,
            remediation:
              "https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker",
            metadata: { schema: row.schema, name: row.name, type: "function" },
            cache_key: `function_search_path_mutable_${row.schema}_${row.name}`,
          });
        }
      } catch {
        /* table may not exist */
      }
    }

    if (type === "performance") {
      // unindexed_foreign_keys
      try {
        const rows = await nano.db.query<{
          schema: string;
          table: string;
          fkey: string;
        }>(`
        WITH foreign_keys AS (
          SELECT
            cl.relnamespace::regnamespace::text AS schema_name,
            cl.relname AS table_name,
            cl.oid AS table_oid,
            ct.conname AS fkey_name,
            ct.conkey AS col_attnums
          FROM pg_catalog.pg_constraint ct
          JOIN pg_catalog.pg_class cl ON ct.conrelid = cl.oid
          LEFT JOIN pg_catalog.pg_depend d ON d.objid = cl.oid AND d.deptype = 'e'
          WHERE ct.contype = 'f'
            AND d.objid IS NULL
            AND cl.relnamespace::regnamespace::text NOT IN (${EXCLUDED_SCHEMAS})
        ),
        indexes AS (
          SELECT
            pi.indrelid AS table_oid,
            string_to_array(pi.indkey::text, ' ')::smallint[] AS col_attnums
          FROM pg_catalog.pg_index pi
          WHERE pi.indisvalid
        )
        SELECT fk.schema_name AS schema, fk.table_name AS table, fk.fkey_name AS fkey
        FROM foreign_keys fk
        LEFT JOIN indexes idx
          ON fk.table_oid = idx.table_oid
          AND fk.col_attnums = idx.col_attnums[1:array_length(fk.col_attnums, 1)]
        WHERE idx.table_oid IS NULL
        ORDER BY fk.table_name
      `);
        for (const row of rows.rows) {
          results.push({
            name: "unindexed_foreign_keys",
            title: "Unindexed Foreign Keys",
            level: "INFO",
            facing: "EXTERNAL",
            categories: ["PERFORMANCE"],
            description:
              "Foreign key constraint without a covering index may cause slow queries on JOIN and cascade operations.",
            detail: `Foreign key "${row.fkey}" on table "${row.schema}"."${row.table}" has no covering index.`,
            remediation:
              "https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys",
            metadata: {
              schema: row.schema,
              name: row.table,
              type: "table",
              fkey_name: row.fkey,
            },
            cache_key: `unindexed_foreign_keys_${row.schema}_${row.table}_${row.fkey}`,
          });
        }
      } catch {
        /* table may not exist */
      }

      // no_primary_key
      try {
        const rows = await nano.db.query<{ schema: string; name: string }>(`
        SELECT n.nspname AS schema, c.relname AS name
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_catalog.pg_index i ON i.indrelid = c.oid AND i.indisprimary
        LEFT JOIN pg_catalog.pg_depend d ON c.oid = d.objid AND d.deptype = 'e'
        WHERE c.relkind = 'r'
          AND n.nspname NOT IN (${EXCLUDED_SCHEMAS})
          AND d.objid IS NULL
        GROUP BY n.nspname, c.relname
        HAVING bool_or(coalesce(i.indisprimary, false)) = false
        ORDER BY c.relname
      `);
        for (const row of rows.rows) {
          results.push({
            name: "no_primary_key",
            title: "No Primary Key",
            level: "INFO",
            facing: "EXTERNAL",
            categories: ["PERFORMANCE"],
            description:
              "Table has no primary key, which degrades performance for large datasets and replication.",
            detail: `Table "${row.schema}"."${row.name}" does not have a primary key.`,
            remediation:
              "https://supabase.com/docs/guides/database/database-linter?lint=0004_no_primary_key",
            metadata: { schema: row.schema, name: row.name, type: "table" },
            cache_key: `no_primary_key_${row.schema}_${row.name}`,
          });
        }
      } catch {
        /* table may not exist */
      }

      // duplicate_index
      try {
        const rows = await nano.db.query<{
          schema: string;
          table: string;
          index: string;
          duplicate_of: string;
        }>(`
        SELECT
          schemaname AS schema,
          tablename AS table,
          indexname AS index,
          min(indexname) OVER (PARTITION BY schemaname, tablename, replace(indexdef, indexname, '')) AS duplicate_of
        FROM pg_indexes
        WHERE schemaname NOT IN (${EXCLUDED_SCHEMAS})
          AND indexname != min(indexname) OVER (PARTITION BY schemaname, tablename, replace(indexdef, indexname, ''))
        ORDER BY tablename, indexname
      `);
        for (const row of rows.rows) {
          results.push({
            name: "duplicate_index",
            title: "Duplicate Index",
            level: "WARN",
            facing: "EXTERNAL",
            categories: ["PERFORMANCE"],
            description:
              "Duplicate indexes waste storage and slow down writes without providing any query benefit.",
            detail: `Index "${row.index}" on "${row.schema}"."${row.table}" is a duplicate of "${row.duplicate_of}".`,
            remediation:
              "https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index",
            metadata: { schema: row.schema, name: row.table, type: "table" },
            cache_key: `duplicate_index_${row.schema}_${row.table}_${row.index}`,
          });
        }
      } catch {
        /* table may not exist */
      }

      // multiple_permissive_policies
      try {
        const rows = await nano.db.query<{
          schema: string;
          table: string;
          command: string;
        }>(`
        SELECT
          n.nspname AS schema,
          c.relname AS table,
          CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END AS command
        FROM pg_catalog.pg_policy p
        JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_catalog.pg_depend d ON c.oid = d.objid AND d.deptype = 'e'
        WHERE p.polpermissive = true
          AND n.nspname NOT IN (${EXCLUDED_SCHEMAS})
          AND d.objid IS NULL
        GROUP BY n.nspname, c.relname, p.polcmd
        HAVING count(*) > 1
        ORDER BY c.relname
      `);
        for (const row of rows.rows) {
          results.push({
            name: "multiple_permissive_policies",
            title: "Multiple Permissive Policies",
            level: "WARN",
            facing: "EXTERNAL",
            categories: ["PERFORMANCE"],
            description:
              "Multiple permissive policies for the same command are OR-ed together, causing each to be evaluated for every row.",
            detail: `Table "${row.schema}"."${row.table}" has multiple permissive policies for ${row.command}.`,
            remediation:
              "https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies",
            metadata: { schema: row.schema, name: row.table, type: "table" },
            cache_key: `multiple_permissive_policies_${row.schema}_${row.table}_${row.command}`,
          });
        }
      } catch {
        /* table may not exist */
      }
    }

    return results;
  }

  const INTERNAL_URL = "http://localhost:54321";

  const mcpHandler: McpHandler | null = mcp
    ? createMcpHandler(nano, {
        httpPort,
        serviceRoleKey,
        anonKey: DEFAULT_ANON_KEY,
      })
    : null;

  const KNOWN_PREFIXES = ["/auth/v1/", "/rest/v1/", "/storage/v1/"];

  async function fetchHandler(req: Request): Promise<Response> {
    const pathname = new URL(req.url).pathname;
    if (pathname === "/mcp" && mcpHandler) {
      return mcpHandler.handleRequest(req);
    }
    const adminResponse = await handleAdminRequest(req);
    if (adminResponse) return adminResponse;
    const mgmtResponse = await handleManagementApiRequest(req);
    if (mgmtResponse) return mgmtResponse;
    if (!KNOWN_PREFIXES.some((p) => pathname.startsWith(p))) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const internalUrl = req.url
      .replace(`http://localhost:${httpPort}`, INTERNAL_URL)
      .replace(`http://127.0.0.1:${httpPort}`, INTERNAL_URL);
    return nano.localFetch(new Request(internalUrl, req));
  }

  function createNodeServer(handler: (req: Request) => Promise<Response>) {
    return createServer(async (nodeReq, nodeRes) => {
      const url = `http://localhost:${httpPort}${nodeReq.url}`;
      const hasBody = nodeReq.method !== "GET" && nodeReq.method !== "HEAD";
      const req = new Request(url, {
        method: nodeReq.method,
        headers: nodeReq.headers as HeadersInit,
        body: hasBody ? (nodeReq as unknown as ReadableStream) : undefined,
        // @ts-ignore — Node.js IncomingMessage is a readable stream accepted by Request
        duplex: "half",
      });
      try {
        const res = await handler(req);
        const resHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          resHeaders[k] = v;
        });
        nodeRes.writeHead(res.status, resHeaders);
        nodeRes.end(Buffer.from(await res.arrayBuffer()));
      } catch (e) {
        if (!nodeRes.headersSent) {
          nodeRes.writeHead(500, { "Content-Type": "application/json" });
          nodeRes.end(JSON.stringify({ error: "internal_error" }));
        }
      }
    });
  }

  const server = createNodeServer(fetchHandler);
  server.listen(httpPort);

  const pgUrl =
    nano.connectionString ??
    `postgresql://postgres@127.0.0.1:${tcpPort}/postgres`;

  function emojiWidth(s: string): number {
    let w = 0;
    for (const ch of s) {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp === 0xfe0e || (cp >= 0x200b && cp <= 0x200f)) continue;
      if (cp === 0xfe0f) {
        w -= 1;
        continue;
      }
      w += cp > 0x2000 ? 2 : 1;
    }
    return w;
  }

  function box(title: string, rows: [string, string][]): string {
    const keyWidth = Math.max(...rows.map(([k]) => k.length));
    const valWidth = Math.max(...rows.map(([, v]) => v.length));
    const innerWidth = keyWidth + 3 + valWidth;
    const titleVisualWidth = emojiWidth(title);
    const titlePad = Math.max(0, innerWidth - titleVisualWidth);
    const top = `\u256d${"─".repeat(innerWidth + 2)}\u256e`;
    const titleLine = `\u2502 ${title}${" ".repeat(titlePad)} \u2502`;
    const sep = `\u251c${"─".repeat(keyWidth + 2)}\u252c${"─".repeat(valWidth + 2)}\u2524`;
    const dataLines = rows.map(
      ([k, v]) =>
        `\u2502 ${k.padEnd(keyWidth)} \u2502 ${v.padEnd(valWidth)} \u2502`,
    );
    const bottom = `\u2570${"─".repeat(keyWidth + 2)}\u2534${"─".repeat(valWidth + 2)}\u256f`;
    return [top, titleLine, sep, ...dataLines, bottom].join("\n");
  }

  const c = {
    light: "\x1b[38;2;62;207;142m",
    mid: "\x1b[38;2;36;180;126m",
    dark: "\x1b[38;2;26;138;92m",
    reset: "\x1b[0m",
  };

  const logo = [
    `        ${c.light}\u2591${c.mid}\u2593\u2593${c.reset}`,
    `       ${c.mid}\u2593${c.dark}\u2588\u2588${c.mid}\u2593${c.reset}`,
    `     ${c.light}\u2591${c.mid}\u2593${c.dark}\u2588\u2588\u2588${c.mid}\u2593\u2593\u2593${c.reset}`,
    `    ${c.mid}\u2593${c.dark}\u2588\u2588\u2588\u2588\u2588\u2588${c.mid}\u2593${c.reset}`,
    `  ${c.light}\u2591${c.mid}\u2593${c.dark}\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588${c.mid}\u2593${c.light}\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591${c.reset}`,
    ` ${c.light}\u2591${c.dark}\u2588\u2588${c.mid}\u2593${c.dark}\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588${c.mid}\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593${c.reset}`,
    `${c.dark}\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588${c.mid}\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593${c.reset}`,
    `${c.light}\u2591${c.mid}\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593\u2593${c.light}\u2591${c.reset}`,
    `           ${c.mid}\u2593\u2593\u2593\u2593\u2593\u2593\u2593${c.reset}`,
    `           ${c.mid}\u2593\u2593\u2593\u2593\u2593${c.light}\u2591${c.reset}`,
    `           ${c.mid}\u2593\u2593\u2593${c.light}\u2591${c.reset}`,
    `           ${c.mid}\u2593\u2593${c.light}\u2591${c.reset}`,
    ``,
    `    nano-supabase  \u2022  local dev server`,
  ].join("\n");

  process.stdout.write(logo + "\n\n");
  process.stdout.write(
    box("\ud83c\udf10 API", [
      ["URL", `http://localhost:${httpPort}`],
      ["REST", `http://localhost:${httpPort}/rest/v1`],
      ["Auth", `http://localhost:${httpPort}/auth/v1`],
      ["Storage", `http://localhost:${httpPort}/storage/v1`],
    ]) + "\n\n",
  );
  process.stdout.write(
    box("\ud83d\uddc4\ufe0f  Database", [["URL", pgUrl]]) + "\n\n",
  );
  process.stdout.write(
    box("\ud83d\udd11 Auth Keys", [
      ["Anon key", DEFAULT_ANON_KEY],
      ["Service role key", serviceRoleKey],
    ]) + "\n\n",
  );

  if (mcp) {
    const mcpUrl = `http://localhost:${httpPort}/mcp`;
    process.stdout.write(
      box("\ud83e\udd16 MCP Server", [
        ["Transport", "Streamable HTTP"],
        ["URL", mcpUrl],
        [
          "Add to Claude Code",
          `claude mcp add --transport http nano-supabase ${mcpUrl}`,
        ],
      ]) + "\n\n",
    );
  }

  function cleanup(): void {
    unlink(defaultPidFilePath).catch(() => {});
    if (pidFile) {
      unlink(pidFile).catch(() => {});
    }
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      server.close();
      await nano.stop();
      cleanup();
      process.exit(0);
    });
  }
}
