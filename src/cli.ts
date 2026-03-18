import { readFile, writeFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { Extension } from "@electric-sql/pglite";

import { nanoSupabase } from "./nano.ts";
import type { NanoSupabaseInstance } from "./nano.ts";
import {
  cmdStatus,
  cmdStop,
  cmdDbExec,
  cmdDbDump,
  cmdDbReset,
  cmdMigrationNew,
  cmdMigrationList,
  cmdMigrationUp,
  cmdUsersList,
  cmdUsersCreate,
  cmdUsersGet,
  cmdUsersDelete,
  cmdStorageListBuckets,
  cmdStorageCreateBucket,
  cmdStorageLs,
  cmdStorageCp,
  cmdGenTypes,
} from "./cli-commands.ts";
import { createMcpHandler } from "./mcp-server.ts";
import type { McpHandler } from "./mcp-server.ts";

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

Start options:
  --data-dir=<path>            Persistence directory (default: in-memory)
  --http-port=<port>           HTTP API port (default: ${DEFAULT_HTTP_PORT})
  --tcp-port=<port>            Postgres TCP port (default: ${DEFAULT_TCP_PORT})
  --service-role-key=<key>     Service role key (default: ${DEFAULT_SERVICE_ROLE_KEY})
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

if (subCommand !== "start") {
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

if (detach) {
  const serverArgs = subArgs.filter((a) => a !== "--detach");
  const child = spawn(process.execPath, [process.argv[1], "start", ...serverArgs], {
    detached: true,
    stdio: "ignore",
  });
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

const wasmBytes = await readFile(join(pgliteDist, "pglite.wasm"));
const wasmModule = await WebAssembly.compile(wasmBytes);
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

const origConsoleLog = console.log;
console.log = () => {};
const nano = await nanoSupabase({
  dataDir,
  tcp: { port: tcpPort },
  debug,
  wasmModule,
  fsBundle,
  postgrestWasmBytes: postgrestWasm,
  extensions: { pgcrypto: pgcryptoExt, uuid_ossp: uuidOsspExt },
});
console.log = origConsoleLog;

const defaultPidFilePath = `/tmp/nano-supabase-${httpPort}.pid`;
await writeFile(defaultPidFilePath, String(process.pid));
if (pidFile) {
  await writeFile(pidFile, String(process.pid));
}

async function ensureMigrationsTable(
  db: NanoSupabaseInstance["db"],
): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _nano_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
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
      const result = await nano.db.query(sql, params);
      return new Response(
        JSON.stringify({
          rows: result.rows,
          rowCount: result.rows.length,
          fields: result.fields.map((f: { name: string }) => f.name),
        }),
        { headers: { "Content-Type": "application/json" } },
      );
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

    const tables: Record<string, string[]> = {};
    for (const row of result.rows) {
      if (!tables[row.table_name]) tables[row.table_name] = [];
      tables[row.table_name].push(
        `  ${row.column_name} ${row.data_type}${row.is_nullable === "NO" ? " NOT NULL" : ""}`,
      );
    }
    const ddl = Object.entries(tables)
      .map(([name, cols]) => `CREATE TABLE ${name} (\n${cols.join(",\n")}\n);`)
      .join("\n\n");
    return new Response(ddl, { headers: { "Content-Type": "text/plain" } });
  }

  if (url.pathname === "/admin/v1/reset" && req.method === "POST") {
    const tables = await nano.db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_nano_migrations'`,
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
      }>(`SELECT COUNT(*)::text as count FROM _nano_migrations`)
      .catch(() => ({ rows: [{ count: "0" }] }));
    await nano.db.exec(`DELETE FROM _nano_migrations`).catch(() => {});
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
    const result = await nano.db.query<{ name: string; applied_at: string }>(
      `SELECT name, applied_at FROM _nano_migrations ORDER BY applied_at`,
    );
    return new Response(JSON.stringify({ migrations: result.rows }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (
    url.pathname === "/admin/v1/migrations/applied" &&
    req.method === "POST"
  ) {
    await ensureMigrationsTable(nano.db);
    const { name } = (await req.json()) as { name: string };
    await nano.db.query(
      `INSERT INTO _nano_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [name],
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
      JSON.stringify({ id: ref, ref, name: "local", status: "ACTIVE_HEALTHY", region: "local", organization_id: "local", organization_slug: "local", created_at: new Date().toISOString() }),
      json,
    );
  }

  if (subpath === "/database/query" && req.method === "POST") {
    const { query, parameters = [] } = (await req.json()) as { query: string; parameters?: unknown[] };
    try {
      const result = await nano.db.query(query, parameters);
      return new Response(JSON.stringify(result.rows), json);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("cannot insert multiple commands into a prepared statement")) {
        try {
          await nano.db.exec(query);
          return new Response(JSON.stringify([]), json);
        } catch (e2: unknown) {
          return new Response(
            JSON.stringify({ message: e2 instanceof Error ? e2.message : String(e2) }),
            { status: 400, ...json },
          );
        }
      }
      return new Response(JSON.stringify({ message: msg }), { status: 400, ...json });
    }
  }

  if (subpath === "/database/migrations" && req.method === "GET") {
    await ensureMigrationsTable(nano.db);
    const result = await nano.db.query<{ name: string; applied_at: string }>(
      `SELECT name, applied_at FROM _nano_migrations ORDER BY applied_at`,
    );
    return new Response(
      JSON.stringify(result.rows.map((r) => ({ version: r.applied_at, name: r.name }))),
      json,
    );
  }

  if (subpath === "/database/migrations" && req.method === "POST") {
    const { name, query } = (await req.json()) as { name: string; query: string };
    await ensureMigrationsTable(nano.db);
    try {
      await nano.db.exec(query);
      await nano.db.query(
        `INSERT INTO _nano_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [name],
      );
      return new Response(JSON.stringify({ name }), json);
    } catch (e: unknown) {
      return new Response(
        JSON.stringify({ message: e instanceof Error ? e.message : String(e) }),
        { status: 400, ...json },
      );
    }
  }

  if (subpath === "/storage/buckets" && req.method === "GET") {
    const internalReq = new Request(`http://localhost:${httpPort}/storage/v1/bucket`, {
      headers: { Authorization: `Bearer ${serviceRoleKey}` },
    });
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

  if ((subpath === "/advisors/security" || subpath === "/advisors/performance") && req.method === "GET") {
    const type = subpath === "/advisors/security" ? "security" : "performance";
    const lints = await runAdvisors(type);
    return new Response(JSON.stringify({ lints }), json);
  }

  return null;
}

const EXCLUDED_SCHEMAS = `'pg_catalog','information_schema','auth','storage','vault','extensions','cron','net','pgmq','realtime','supabase_functions','supabase_migrations','pgsodium','pgsodium_masks','pgtle','pgbouncer','graphql','graphql_public','tiger','topology'`;

async function runAdvisors(type: "security" | "performance"): Promise<unknown[]> {
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
          description: "Table is in the public schema and does not have Row Level Security enabled.",
          detail: `Table "${row.schema}"."${row.name}" is publicly accessible without RLS.`,
          remediation: "https://supabase.com/docs/guides/database/postgres/row-level-security",
          metadata: { schema: row.schema, name: row.name, type: "table" },
          cache_key: `rls_disabled_in_public_${row.schema}_${row.name}`,
        });
      }
    } catch { /* table may not exist */ }

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
          description: "Table has RLS enabled but no policies defined. All non-owner access is blocked.",
          detail: `Table "${row.schema}"."${row.name}" has RLS enabled but no policies exist.`,
          remediation: "https://supabase.com/docs/guides/database/postgres/row-level-security",
          metadata: { schema: row.schema, name: row.name, type: "table" },
          cache_key: `rls_enabled_no_policy_${row.schema}_${row.name}`,
        });
      }
    } catch { /* table may not exist */ }

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
          description: "A policy exists on the table but Row Level Security is not enabled, so the policy has no effect.",
          detail: `Table "${row.schema}"."${row.name}" has policies but RLS is disabled — policies are silently ignored.`,
          remediation: "https://supabase.com/docs/guides/database/postgres/row-level-security",
          metadata: { schema: row.schema, name: row.name, type: "table" },
          cache_key: `policy_exists_rls_disabled_${row.schema}_${row.name}`,
        });
      }
    } catch { /* table may not exist */ }

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
          description: "Security definer function without a fixed search_path is vulnerable to search_path injection.",
          detail: `Function "${row.schema}"."${row.name}" is SECURITY DEFINER but has no fixed search_path.`,
          remediation: "https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker",
          metadata: { schema: row.schema, name: row.name, type: "function" },
          cache_key: `function_search_path_mutable_${row.schema}_${row.name}`,
        });
      }
    } catch { /* table may not exist */ }
  }

  if (type === "performance") {
    // unindexed_foreign_keys
    try {
      const rows = await nano.db.query<{ schema: string; table: string; fkey: string }>(`
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
          description: "Foreign key constraint without a covering index may cause slow queries on JOIN and cascade operations.",
          detail: `Foreign key "${row.fkey}" on table "${row.schema}"."${row.table}" has no covering index.`,
          remediation: "https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys",
          metadata: { schema: row.schema, name: row.table, type: "table", fkey_name: row.fkey },
          cache_key: `unindexed_foreign_keys_${row.schema}_${row.table}_${row.fkey}`,
        });
      }
    } catch { /* table may not exist */ }

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
          description: "Table has no primary key, which degrades performance for large datasets and replication.",
          detail: `Table "${row.schema}"."${row.name}" does not have a primary key.`,
          remediation: "https://supabase.com/docs/guides/database/database-linter?lint=0004_no_primary_key",
          metadata: { schema: row.schema, name: row.name, type: "table" },
          cache_key: `no_primary_key_${row.schema}_${row.name}`,
        });
      }
    } catch { /* table may not exist */ }

    // duplicate_index
    try {
      const rows = await nano.db.query<{ schema: string; table: string; index: string; duplicate_of: string }>(`
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
          description: "Duplicate indexes waste storage and slow down writes without providing any query benefit.",
          detail: `Index "${row.index}" on "${row.schema}"."${row.table}" is a duplicate of "${row.duplicate_of}".`,
          remediation: "https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index",
          metadata: { schema: row.schema, name: row.table, type: "table" },
          cache_key: `duplicate_index_${row.schema}_${row.table}_${row.index}`,
        });
      }
    } catch { /* table may not exist */ }

    // multiple_permissive_policies
    try {
      const rows = await nano.db.query<{ schema: string; table: string; command: string }>(`
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
          description: "Multiple permissive policies for the same command are OR-ed together, causing each to be evaluated for every row.",
          detail: `Table "${row.schema}"."${row.table}" has multiple permissive policies for ${row.command}.`,
          remediation: "https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies",
          metadata: { schema: row.schema, name: row.table, type: "table" },
          cache_key: `multiple_permissive_policies_${row.schema}_${row.table}_${row.command}`,
        });
      }
    } catch { /* table may not exist */ }
  }

  return results;
}

const INTERNAL_URL = "http://localhost:54321";

const mcpHandler: McpHandler | null = mcp
  ? createMcpHandler(nano, { httpPort, serviceRoleKey, anonKey: DEFAULT_ANON_KEY })
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
    const chunks: Buffer[] = [];
    for await (const chunk of nodeReq) chunks.push(chunk as Buffer);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    const req = new Request(url, {
      method: nodeReq.method,
      headers: nodeReq.headers as HeadersInit,
      body: body?.length ? body : undefined,
    });
    try {
      const res = await handler(req);
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { resHeaders[k] = v; });
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
    if (cp === 0xfe0f) { w -= 1; continue; }
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
    ([k, v]) => `\u2502 ${k.padEnd(keyWidth)} \u2502 ${v.padEnd(valWidth)} \u2502`,
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
process.stdout.write(box("\ud83d\uddc4\ufe0f  Database", [["URL", pgUrl]]) + "\n\n");
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
      ["Add to Claude Code", `claude mcp add --transport http nano-supabase ${mcpUrl}`],
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
