#!/usr/bin/env bun

import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Extension } from "@electric-sql/pglite";

import { pgliteWasm, pgliteData, pgcryptoBundle, uuidOsspBundle, postgrestWasm } from "./cli-assets.ts";
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

const DEFAULT_HTTP_PORT = 54321;
const DEFAULT_TCP_PORT = 5432;
const DEFAULT_ANON_KEY = "local-anon-key";
const DEFAULT_SERVICE_ROLE_KEY = "local-service-role-key";

const argv = process.argv.slice(2);

function getArgValue(args: string[], flag: string): string | undefined {
  const withEq = args.find((a) => a.startsWith(`${flag}=`));
  if (withEq) return withEq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) return args[idx + 1];
  return undefined;
}

const SUB_COMMANDS = ["start", "stop", "status", "db", "migration", "users", "storage", "gen"];
const firstArg = argv[0];
const subCommand = firstArg && SUB_COMMANDS.includes(firstArg) ? firstArg : "start";
const subArgs = subCommand === "start" && firstArg !== "start" ? argv : argv.slice(1);

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
  --pid-file=<path>            Write PID to file (useful with --detach)
  --debug                      Enable debug logging

Common options:
  --url=<url>                  Server URL (default: http://localhost:${DEFAULT_HTTP_PORT})
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
      process.stderr.write(JSON.stringify({ error: "unknown_command", message: `Unknown db command: ${op}` }) + "\n");
      process.exit(1);
    }
  } else if (subCommand === "migration") {
    const op = subArgs[0];
    const opArgs = subArgs.slice(1);
    if (op === "new") result = cmdMigrationNew(opArgs);
    else if (op === "list") result = await cmdMigrationList(opArgs);
    else if (op === "up") result = await cmdMigrationUp(opArgs);
    else {
      process.stderr.write(JSON.stringify({ error: "unknown_command", message: `Unknown migration command: ${op}` }) + "\n");
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
      process.stderr.write(JSON.stringify({ error: "unknown_command", message: `Unknown users command: ${op}` }) + "\n");
      process.exit(1);
    }
  } else if (subCommand === "storage") {
    const op = subArgs[0];
    const opArgs = subArgs.slice(1);
    if (op === "list-buckets") result = await cmdStorageListBuckets(opArgs);
    else if (op === "create-bucket") result = await cmdStorageCreateBucket(opArgs);
    else if (op === "ls") result = await cmdStorageLs(opArgs);
    else if (op === "cp") result = await cmdStorageCp(opArgs);
    else {
      process.stderr.write(JSON.stringify({ error: "unknown_command", message: `Unknown storage command: ${op}` }) + "\n");
      process.exit(1);
    }
  } else if (subCommand === "gen") {
    const op = subArgs[0];
    const opArgs = subArgs.slice(1);
    if (op === "types") result = await cmdGenTypes(opArgs);
    else {
      process.stderr.write(JSON.stringify({ error: "unknown_command", message: `Unknown gen command: ${op}` }) + "\n");
      process.exit(1);
    }
  } else {
    process.stderr.write(JSON.stringify({ error: "unknown_command", message: `Unknown command: ${subCommand}` }) + "\n");
    process.exit(1);
  }

  if (result.exitCode !== 0) {
    process.stderr.write(result.output + "\n");
  } else {
    process.stdout.write(result.output + "\n");
  }
  process.exit(result.exitCode);
}

if (subCommand !== "start") {
  await runSubCommand();
}

// --- Start command: server mode ---

function parsePort(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    process.stderr.write(`Invalid ${name}: "${raw}" (must be 1–65535)\n`);
    process.exit(1);
  }
  return n;
}

const httpPort = parsePort(getArgValue(subArgs, "--http-port"), DEFAULT_HTTP_PORT, "--http-port");
const tcpPort = parsePort(getArgValue(subArgs, "--tcp-port"), DEFAULT_TCP_PORT, "--tcp-port");
const dataDir = getArgValue(subArgs, "--data-dir");
const serviceRoleKey =
  getArgValue(subArgs, "--service-role-key") ?? process.env.NANO_SUPABASE_SERVICE_ROLE_KEY ?? DEFAULT_SERVICE_ROLE_KEY;
const debug = subArgs.includes("--debug");
const detach = subArgs.includes("--detach");
const pidFile = getArgValue(subArgs, "--pid-file");

if (detach) {
  const serverArgs = subArgs.filter((a) => a !== "--detach");
  // In compiled binaries, argv[1] is a virtual /$bunfs path; execPath is the real binary
  const isCompiledBinary = process.argv[1]?.startsWith("/$bunfs") ?? true;
  const cmd = isCompiledBinary
    ? [process.execPath, "start", ...serverArgs]
    : [process.argv[0], process.argv[1], "start", ...serverArgs];

  const child = Bun.spawn({ cmd, detached: true, stdout: Bun.file("/dev/null"), stderr: Bun.file("/dev/null") });
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
  process.stderr.write(JSON.stringify({ error: "start_timeout", message: "Server did not start within 30s" }) + "\n");
  process.exit(1);
}

const tmpDir = mkdtempSync(join(tmpdir(), "nano-supabase-"));
writeFileSync(join(tmpDir, "pgcrypto.tar.gz"), Buffer.from(pgcryptoBundle));
writeFileSync(join(tmpDir, "uuid-ossp.tar.gz"), Buffer.from(uuidOsspBundle));

const pgcryptoExt: Extension = {
  name: "pgcrypto",
  setup: async (_pg, _emscriptenOpts) => ({
    bundlePath: new URL(`file://${join(tmpDir, "pgcrypto.tar.gz")}`),
  }),
};
const uuidOsspExt: Extension = {
  name: "uuid-ossp",
  setup: async (_pg, _emscriptenOpts) => ({
    bundlePath: new URL(`file://${join(tmpDir, "uuid-ossp.tar.gz")}`),
  }),
};

const wasmModule = await WebAssembly.compile(pgliteWasm.buffer as ArrayBuffer);
const fsBundle = new Blob([pgliteData]);

const nano = await nanoSupabase({
  dataDir,
  tcp: { port: tcpPort },
  debug,
  wasmModule,
  fsBundle,
  postgrestWasmBytes: postgrestWasm,
  extensions: { pgcrypto: pgcryptoExt, uuid_ossp: uuidOsspExt },
});

if (pidFile) {
  await Bun.write(pidFile, String(process.pid));
}

async function ensureMigrationsTable(db: NanoSupabaseInstance["db"]): Promise<void> {
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
    return new Response(JSON.stringify({ error: "unauthorized", message: "Invalid service role key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

async function handleAdminRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url);

  if (url.pathname === "/health" && req.method === "GET") {
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  if (!url.pathname.startsWith("/admin/v1/")) return null;

  const authError = requireServiceRole(req);
  if (authError) return authError;

  if (url.pathname === "/admin/v1/sql" && req.method === "POST") {
    const { sql, params = [] } = (await req.json()) as { sql: string; params?: unknown[] };
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
        JSON.stringify({ error: "sql_error", message: e instanceof Error ? e.message : String(e) }),
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
      return new Response(JSON.stringify(result.rows), { headers: { "Content-Type": "application/json" } });
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
      await nano.db.exec(`DROP TABLE IF EXISTS ${tableNames.map((t) => `"${t}"`).join(", ")} CASCADE`);
    }
    const migCount = await nano.db
      .query<{ count: string }>(`SELECT COUNT(*)::text as count FROM _nano_migrations`)
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
    return new Response(JSON.stringify({ migrations: result.rows }), { headers: { "Content-Type": "application/json" } });
  }

  if (url.pathname === "/admin/v1/migrations/applied" && req.method === "POST") {
    await ensureMigrationsTable(nano.db);
    const { name } = (await req.json()) as { name: string };
    await nano.db.query(`INSERT INTO _nano_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [name]);
    return new Response(JSON.stringify({ recorded: true, name }), { headers: { "Content-Type": "application/json" } });
  }

  return null;
}

const server = Bun.serve({
  port: httpPort,
  fetch: async (req: Request) => {
    const adminResponse = await handleAdminRequest(req);
    if (adminResponse) return adminResponse;
    return nano.localFetch(req);
  },
});

const startupInfo = {
  url: `http://localhost:${httpPort}`,
  anon_key: DEFAULT_ANON_KEY,
  service_role_key: serviceRoleKey,
  pg: nano.connectionString ?? `postgresql://postgres@127.0.0.1:${tcpPort}/postgres`,
  pid: process.pid,
};

process.stdout.write(JSON.stringify(startupInfo) + "\n");

function cleanup(): void {
  if (pidFile) {
    try { unlinkSync(pidFile); } catch {}
  }
  try {
    unlinkSync(join(tmpDir, "pgcrypto.tar.gz"));
    unlinkSync(join(tmpDir, "uuid-ossp.tar.gz"));
    rmdirSync(tmpDir);
  } catch {
    // best-effort cleanup
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    server.stop();
    await nano.stop();
    cleanup();
    process.exit(0);
  });
}
