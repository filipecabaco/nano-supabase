import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_URL = "http://localhost:54321";
const DEFAULT_SERVICE_ROLE_KEY = "local-service-role-key";
const DEFAULT_ANON_KEY = "local-anon-key";
const DEFAULT_MIGRATIONS_DIR = "./supabase/migrations";

function getArgValue(args: string[], flag: string): string | undefined {
  const withEq = args.find((a) => a.startsWith(`${flag}=`));
  if (withEq) return withEq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) return args[idx + 1];
  return undefined;
}

function getUrl(args: string[]): string {
  return getArgValue(args, "--url") ?? DEFAULT_URL;
}

function getServiceRoleKey(args: string[]): string {
  return getArgValue(args, "--service-role-key") ?? process.env.NANO_SUPABASE_SERVICE_ROLE_KEY ?? DEFAULT_SERVICE_ROLE_KEY;
}

function adminHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function ok(data: unknown): { exitCode: number; output: string } {
  return { exitCode: 0, output: JSON.stringify(data) };
}

function fail(error: string, message: string): { exitCode: number; output: string } {
  return { exitCode: 1, output: JSON.stringify({ error, message }) };
}

async function adminFetch(
  url: string,
  path: string,
  key: string,
  method = "GET",
  body?: unknown,
): Promise<{ exitCode: number; output: string }> {
  try {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: adminHeaders(key),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    return res.ok ? ok(data) : { exitCode: 1, output: JSON.stringify(data) };
  } catch (e: unknown) {
    return fail("request_failed", e instanceof Error ? e.message : String(e));
  }
}

export async function cmdStatus(args: string[]): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  try {
    const res = await fetch(`${url}/health`);
    if (res.ok) {
      return ok({ running: true, url, pg: "postgresql://postgres@127.0.0.1:5432/postgres", anon_key: DEFAULT_ANON_KEY });
    }
    return ok({ running: false });
  } catch {
    return ok({ running: false });
  }
}

export async function cmdStop(args: string[]): Promise<{ exitCode: number; output: string }> {
  const pidFile = getArgValue(args, "--pid-file");
  if (!pidFile) return fail("missing_pid_file", "Provide --pid-file");
  try {
    const pid = parseInt(await Bun.file(pidFile).text(), 10);
    if (Number.isNaN(pid)) return fail("invalid_pid", "PID file does not contain a valid number");
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        process.kill(pid, 0);
      } catch {
        return ok({ stopped: true, pid });
      }
    }
    return fail("timeout", "Process did not stop within 5s");
  } catch (e: unknown) {
    return fail("stop_failed", e instanceof Error ? e.message : String(e));
  }
}

export async function cmdDbExec(args: string[]): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const sqlArg = getArgValue(args, "--sql");
  const fileArg = getArgValue(args, "--file");

  let sql: string;
  if (sqlArg) {
    sql = sqlArg;
  } else if (fileArg) {
    try {
      sql = await Bun.file(fileArg).text();
    } catch {
      return fail("file_not_found", `Cannot read file: ${fileArg}`);
    }
  } else {
    return fail("missing_sql", "Provide --sql or --file");
  }

  return adminFetch(url, "/admin/v1/sql", key, "POST", { sql });
}

export async function cmdDbDump(args: string[]): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  try {
    const res = await fetch(`${url}/admin/v1/schema`, { headers: adminHeaders(key) });
    const text = await res.text();
    return res.ok ? { exitCode: 0, output: text } : { exitCode: 1, output: text };
  } catch (e: unknown) {
    return fail("request_failed", e instanceof Error ? e.message : String(e));
  }
}

export async function cmdDbReset(args: string[]): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  if (!args.includes("--confirm")) return fail("confirmation_required", "Pass --confirm to drop all public schema tables");
  return adminFetch(url, "/admin/v1/reset", key, "POST", {});
}

export function cmdMigrationNew(args: string[]): { exitCode: number; output: string } {
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) return fail("missing_name", "Provide a migration name");
  const migrationsDir = getArgValue(args, "--migrations-dir") ?? DEFAULT_MIGRATIONS_DIR;
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  const filename = `${timestamp}_${name.replace(/\s+/g, "_")}.sql`;
  const filePath = join(migrationsDir, filename);
  try {
    Bun.write(filePath, `-- Migration: ${name}\n`);
    return ok({ file: filePath });
  } catch (e: unknown) {
    return fail("write_failed", e instanceof Error ? e.message : String(e));
  }
}

export async function cmdMigrationList(args: string[]): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const migrationsDir = getArgValue(args, "--migrations-dir") ?? DEFAULT_MIGRATIONS_DIR;

  const localFiles = existsSync(migrationsDir)
    ? readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];

  try {
    const res = await fetch(`${url}/admin/v1/migrations`, { headers: adminHeaders(key) });
    const data = (await res.json()) as { migrations: Array<{ name: string }> };
    const applied = new Set((data.migrations ?? []).map((m) => m.name));
    const appliedList = localFiles.filter((f) => applied.has(f));
    const pendingList = localFiles.filter((f) => !applied.has(f));
    return ok({ applied: appliedList, pending: pendingList });
  } catch (e: unknown) {
    return fail("request_failed", e instanceof Error ? e.message : String(e));
  }
}

export async function cmdMigrationUp(args: string[]): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const migrationsDir = getArgValue(args, "--migrations-dir") ?? DEFAULT_MIGRATIONS_DIR;

  if (!existsSync(migrationsDir)) return ok({ applied: [], pending: [] });

  const localFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  try {
    const listRes = await fetch(`${url}/admin/v1/migrations`, { headers: adminHeaders(key) });
    const listData = (await listRes.json()) as { migrations: Array<{ name: string }> };
    const applied = new Set((listData.migrations ?? []).map((m) => m.name));
    const pending = localFiles.filter((f) => !applied.has(f));

    const results: Array<{ file: string; status: string; error?: string }> = [];
    for (const file of pending) {
      const sql = await Bun.file(join(migrationsDir, file)).text();
      const sqlRes = await fetch(`${url}/admin/v1/sql`, {
        method: "POST",
        headers: adminHeaders(key),
        body: JSON.stringify({ sql }),
      });
      if (!sqlRes.ok) {
        const err = (await sqlRes.json()) as { message?: string };
        results.push({ file, status: "error", error: err.message ?? "unknown" });
        break;
      }
      await fetch(`${url}/admin/v1/migrations/applied`, {
        method: "POST",
        headers: adminHeaders(key),
        body: JSON.stringify({ name: file }),
      });
      results.push({ file, status: "applied" });
    }
    return ok({ results });
  } catch (e: unknown) {
    return fail("request_failed", e instanceof Error ? e.message : String(e));
  }
}

export async function cmdUsersList(args: string[]): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  try {
    const res = await fetch(`${url}/auth/v1/admin/users`, { headers: adminHeaders(key) });
    const data = await res.json();
    return res.ok ? ok(data) : { exitCode: 1, output: JSON.stringify(data) };
  } catch (e: unknown) {
    return fail("request_failed", e instanceof Error ? e.message : String(e));
  }
}

export async function cmdUsersCreate(args: string[]): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const email = getArgValue(args, "--email");
  const password = getArgValue(args, "--password");
  if (!email) return fail("missing_email", "Provide --email");
  if (!password) return fail("missing_password", "Provide --password");
  try {
    const res = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: adminHeaders(key),
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    return res.ok ? ok(data) : { exitCode: 1, output: JSON.stringify(data) };
  } catch (e: unknown) {
    return fail("request_failed", e instanceof Error ? e.message : String(e));
  }
}

export async function cmdUsersGet(args: string[]): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const id = args.find((a) => !a.startsWith("--"));
  if (!id) return fail("missing_id", "Provide a user ID");
  try {
    const res = await fetch(`${url}/auth/v1/admin/users/${id}`, { headers: adminHeaders(key) });
    const data = await res.json();
    return res.ok ? ok(data) : { exitCode: 1, output: JSON.stringify(data) };
  } catch (e: unknown) {
    return fail("request_failed", e instanceof Error ? e.message : String(e));
  }
}

export async function cmdUsersDelete(args: string[]): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const id = args.find((a) => !a.startsWith("--"));
  if (!id) return fail("missing_id", "Provide a user ID");
  if (!args.includes("--confirm")) return fail("confirmation_required", "Pass --confirm to delete the user");
  try {
    const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: adminHeaders(key),
    });
    const data = await res.json();
    return res.ok ? ok(data) : { exitCode: 1, output: JSON.stringify(data) };
  } catch (e: unknown) {
    return fail("request_failed", e instanceof Error ? e.message : String(e));
  }
}

export async function cmdStorageListBuckets(args: string[]): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  try {
    const res = await fetch(`${url}/storage/v1/bucket`, { headers: adminHeaders(key) });
    const data = await res.json();
    return res.ok ? ok(data) : { exitCode: 1, output: JSON.stringify(data) };
  } catch (e: unknown) {
    return fail("request_failed", e instanceof Error ? e.message : String(e));
  }
}

export async function cmdStorageCreateBucket(args: string[]): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) return fail("missing_name", "Provide a bucket name");
  const isPublic = args.includes("--public");
  try {
    const res = await fetch(`${url}/storage/v1/bucket`, {
      method: "POST",
      headers: adminHeaders(key),
      body: JSON.stringify({ id: name, name, public: isPublic }),
    });
    const data = await res.json();
    return res.ok ? ok(data) : { exitCode: 1, output: JSON.stringify(data) };
  } catch (e: unknown) {
    return fail("request_failed", e instanceof Error ? e.message : String(e));
  }
}

export async function cmdStorageLs(args: string[]): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const path = args.find((a) => !a.startsWith("--")) ?? "";
  const [bucket, ...rest] = path.split("/");
  const prefix = rest.join("/");
  if (!bucket) return fail("missing_bucket", "Provide a bucket name");
  try {
    const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: adminHeaders(key),
      body: JSON.stringify({ prefix, limit: 100, offset: 0 }),
    });
    const data = await res.json();
    return res.ok ? ok(data) : { exitCode: 1, output: JSON.stringify(data) };
  } catch (e: unknown) {
    return fail("request_failed", e instanceof Error ? e.message : String(e));
  }
}

export async function cmdStorageCp(args: string[]): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length < 2) return fail("missing_args", "Provide <src> <dst>");
  const [src, dst] = positional;

  const isRemote = (p: string) => p.includes("://") && !p.startsWith("./") && !p.startsWith("/");

  try {
    if (!isRemote(src) && isRemote(dst)) {
      // Upload: local → storage
      const [bucket, ...rest] = dst.replace(/^[^/]+:\/\//, "").split("/");
      const objectPath = rest.join("/") || src.split("/").pop()!;
      const file = Bun.file(src);
      const res = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const data = await res.json();
      return res.ok ? ok(data) : { exitCode: 1, output: JSON.stringify(data) };
    } else if (isRemote(src) && !isRemote(dst)) {
      // Download: storage → local
      const [bucket, ...rest] = src.replace(/^[^/]+:\/\//, "").split("/");
      const objectPath = rest.join("/");
      const res = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return { exitCode: 1, output: JSON.stringify(await res.json()) };
      await Bun.write(dst, res);
      return ok({ downloaded: dst });
    } else {
      return fail("invalid_paths", "One of src or dst must be a storage path (bucket://path)");
    }
  } catch (e: unknown) {
    return fail("request_failed", e instanceof Error ? e.message : String(e));
  }
}

export async function cmdGenTypes(args: string[]): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const outputFile = getArgValue(args, "--output");

  try {
    const res = await fetch(`${url}/admin/v1/schema?format=json`, { headers: adminHeaders(key) });
    const data = (await res.json()) as Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>;
    if (!res.ok) return { exitCode: 1, output: JSON.stringify(data) };

    const tables: Record<string, Array<{ name: string; type: string; nullable: boolean }>> = {};
    for (const row of data) {
      if (!tables[row.table_name]) tables[row.table_name] = [];
      tables[row.table_name].push({
        name: row.column_name,
        type: pgTypeToTs(row.data_type),
        nullable: row.is_nullable === "YES",
      });
    }

    const lines: string[] = [
      "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];",
      "",
      "export interface Database {",
      "  public: {",
      "    Tables: {",
    ];

    for (const [tableName, cols] of Object.entries(tables)) {
      lines.push(`      ${tableName}: {`);
      lines.push("        Row: {");
      for (const col of cols) {
        lines.push(`          ${col.name}: ${col.type}${col.nullable ? " | null" : ""};`);
      }
      lines.push("        };");
      lines.push("        Insert: {");
      for (const col of cols) {
        lines.push(`          ${col.name}?: ${col.type}${col.nullable ? " | null" : ""};`);
      }
      lines.push("        };");
      lines.push("        Update: {");
      for (const col of cols) {
        lines.push(`          ${col.name}?: ${col.type}${col.nullable ? " | null" : ""};`);
      }
      lines.push("        };");
      lines.push("      };");
    }

    lines.push("    };");
    lines.push("    Views: {};");
    lines.push("    Functions: {};");
    lines.push("    Enums: {};");
    lines.push("  };");
    lines.push("}");

    const types = lines.join("\n");
    if (outputFile) {
      await Bun.write(outputFile, types);
      return ok({ file: outputFile });
    }
    return { exitCode: 0, output: types };
  } catch (e: unknown) {
    return fail("request_failed", e instanceof Error ? e.message : String(e));
  }
}

function pgTypeToTs(pgType: string): string {
  if (pgType.includes("int") || pgType.includes("numeric") || pgType.includes("float") || pgType.includes("double") || pgType.includes("real") || pgType.includes("decimal")) return "number";
  if (pgType.includes("bool")) return "boolean";
  if (pgType === "json" || pgType === "jsonb") return "Json";
  if (pgType.includes("timestamp") || pgType.includes("date") || pgType.includes("time")) return "string";
  return "string";
}
