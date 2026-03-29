import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

export const DEFAULT_URL = "http://localhost:54321";
export const DEFAULT_HTTP_PORT = 54321;
export const DEFAULT_TCP_PORT = 5432;
export const DEFAULT_SERVICE_ROLE_KEY = "local-service-role-key";
export const DEFAULT_ANON_KEY = "local-anon-key";
const DEFAULT_MIGRATIONS_DIR = "./supabase/migrations";

function defaultPidFile(port: number): string {
  return `/tmp/nano-supabase-${port}.pid`;
}

export function getArgValue(args: string[], flag: string): string | undefined {
  const withEq = args.find((a) => a.startsWith(`${flag}=`));
  if (withEq) return withEq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith("--"))
    return args[idx + 1];
  return undefined;
}

function getUrl(args: string[]): string {
  return getArgValue(args, "--url") ?? DEFAULT_URL;
}

function getServiceRoleKey(args: string[]): string {
  return (
    getArgValue(args, "--service-role-key") ??
    process.env.NANO_SUPABASE_SERVICE_ROLE_KEY ??
    DEFAULT_SERVICE_ROLE_KEY
  );
}

function adminHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function adminRequest<T>(
  url: string,
  key: string,
  options?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; data: T }> {
  const res = await fetch(url, {
    method: options?.method ?? "GET",
    headers: adminHeaders(key),
    body:
      options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json()) as T;
  return { ok: res.ok, data };
}

function ok(
  data: unknown,
  json: boolean,
  text: string,
): { exitCode: number; output: string } {
  return { exitCode: 0, output: json ? JSON.stringify(data) : text };
}

function fail(
  error: string,
  message: string,
  json: boolean,
): { exitCode: number; output: string } {
  return {
    exitCode: 1,
    output: json ? JSON.stringify({ error, message }) : `Error: ${message}`,
  };
}

function apiError(
  data: unknown,
  json: boolean,
): { exitCode: number; output: string } {
  const d = data as Record<string, unknown>;
  const msg = String(
    d.message ?? d.error_description ?? d.error ?? JSON.stringify(data),
  );
  return { exitCode: 1, output: json ? JSON.stringify(data) : `Error: ${msg}` };
}

function renderTable(
  fields: string[],
  rows: Record<string, unknown>[],
): string {
  if (rows.length === 0) return "(0 rows)";
  const widths = fields.map((f) =>
    Math.max(f.length, ...rows.map((r) => String(r[f] ?? "").length)),
  );
  const header = fields.map((f, i) => f.padEnd(widths[i])).join(" | ");
  const hr = widths.map((w) => "-".repeat(w)).join("-+-");
  const dataRows = rows.map((r) =>
    fields.map((f, i) => String(r[f] ?? "").padEnd(widths[i])).join(" | "),
  );
  return [
    header,
    hr,
    ...dataRows,
    `\n(${rows.length} row${rows.length === 1 ? "" : "s"})`,
  ].join("\n");
}

export async function cmdStatus(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  try {
    const res = await fetch(`${url}/health`);
    if (res.ok) {
      const data = {
        running: true,
        url,
        pg: "postgresql://postgres@127.0.0.1:5432/postgres",
        anon_key: DEFAULT_ANON_KEY,
      };
      const text = `Running\n  URL:      ${url}\n  PG:       postgresql://postgres@127.0.0.1:5432/postgres\n  Anon key: ${DEFAULT_ANON_KEY}`;
      return ok(data, json, text);
    }
    return ok({ running: false }, json, "Not running");
  } catch {
    return ok({ running: false }, json, "Not running");
  }
}

export async function cmdStop(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const port = parseInt(
    getArgValue(args, "--http-port") ?? String(DEFAULT_HTTP_PORT),
    10,
  );
  const pidFile = getArgValue(args, "--pid-file") ?? defaultPidFile(port);
  try {
    const pid = parseInt(await readFile(pidFile, "utf8"), 10);
    if (Number.isNaN(pid))
      return fail(
        "invalid_pid",
        "PID file does not contain a valid number",
        json,
      );
    process.kill(pid, "SIGTERM");
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        process.kill(pid, 0);
      } catch {
        return ok({ stopped: true, pid }, json, `Stopped (pid ${pid})`);
      }
    }
    return fail("timeout", "Process did not stop within 5s", json);
  } catch (e: unknown) {
    return fail("stop_failed", toErrorMessage(e), json);
  }
}

export async function cmdDbExec(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const sqlArg = getArgValue(args, "--sql");
  const fileArg = getArgValue(args, "--file");

  let sql: string;
  if (sqlArg) {
    sql = sqlArg;
  } else if (fileArg) {
    try {
      sql = await readFile(fileArg, "utf8");
    } catch {
      return fail("file_not_found", `Cannot read file: ${fileArg}`, json);
    }
  } else {
    return fail("missing_sql", "Provide --sql or --file", json);
  }

  try {
    const { ok: success, data } = await adminRequest<{
      rows: Record<string, unknown>[];
      fields: string[];
    }>(`${url}/admin/v1/sql`, key, { method: "POST", body: { sql } });
    if (!success) return apiError(data, json);
    const text = renderTable(data.fields ?? [], data.rows ?? []);
    return ok(data, json, text);
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdDbDump(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  try {
    const res = await fetch(`${url}/admin/v1/schema`, {
      headers: adminHeaders(key),
    });
    const text = await res.text();
    return { exitCode: res.ok ? 0 : 1, output: text };
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), args.includes("--json"));
  }
}

export async function cmdDbReset(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  if (!args.includes("--confirm"))
    return fail(
      "confirmation_required",
      "Pass --confirm to drop all public schema tables",
      json,
    );
  try {
    const { ok: success, data } = await adminRequest<{
      dropped_tables: string[];
      migrations_applied: number;
    }>(`${url}/admin/v1/reset`, key, { method: "POST", body: {} });
    if (!success) return apiError(data, json);
    const text = `Reset complete: dropped ${data.dropped_tables.length} table(s), cleared ${data.migrations_applied} migration(s)`;
    return ok(data, json, text);
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdMigrationNew(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) return fail("missing_name", "Provide a migration name", json);
  const migrationsDir =
    getArgValue(args, "--migrations-dir") ?? DEFAULT_MIGRATIONS_DIR;
  const version =
    getArgValue(args, "--version") ??
    new Date()
      .toISOString()
      .replace(/[-:T.Z]/g, "")
      .slice(0, 14);
  const filename = `${version}_${name.replace(/\s+/g, "_")}.sql`;
  const filePath = join(migrationsDir, filename);
  try {
    await writeFile(filePath, `-- Migration: ${name}\n`);
    return ok({ file: filePath }, json, `Created: ${filePath}`);
  } catch (e: unknown) {
    return fail("write_failed", toErrorMessage(e), json);
  }
}

export async function cmdMigrationList(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const migrationsDir =
    getArgValue(args, "--migrations-dir") ?? DEFAULT_MIGRATIONS_DIR;

  const localFiles = existsSync(migrationsDir)
    ? readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];

  try {
    const res = await fetch(`${url}/admin/v1/migrations`, {
      headers: adminHeaders(key),
    });
    const data = (await res.json()) as { migrations: Array<{ name: string }> };
    const applied = new Set((data.migrations ?? []).map((m) => m.name));
    const appliedList = localFiles.filter((f) => applied.has(f));
    const pendingList = localFiles.filter((f) => !applied.has(f));
    const result = { applied: appliedList, pending: pendingList };
    const appliedLines =
      appliedList.length > 0
        ? appliedList.map((f) => `  ✓ ${f}`).join("\n")
        : "  (none)";
    const pendingLines =
      pendingList.length > 0
        ? pendingList.map((f) => `  · ${f}`).join("\n")
        : "  (none)";
    const text = `Applied:\n${appliedLines}\n\nPending:\n${pendingLines}`;
    return ok(result, json, text);
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdMigrationUp(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const migrationsDir =
    getArgValue(args, "--migrations-dir") ?? DEFAULT_MIGRATIONS_DIR;

  if (!existsSync(migrationsDir))
    return ok({ results: [] }, json, "No migrations directory found");

  const localFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  try {
    const listRes = await fetch(`${url}/admin/v1/migrations`, {
      headers: adminHeaders(key),
    });
    const listData = (await listRes.json()) as {
      migrations: Array<{ name: string }>;
    };
    const applied = new Set((listData.migrations ?? []).map((m) => m.name));
    const pending = localFiles.filter((f) => !applied.has(f));

    if (pending.length === 0)
      return ok({ results: [] }, json, "No pending migrations");

    const results: Array<{ file: string; status: string; error?: string }> = [];
    for (const file of pending) {
      const sql = await readFile(join(migrationsDir, file), "utf8");
      const sqlRes = await fetch(`${url}/admin/v1/sql`, {
        method: "POST",
        headers: adminHeaders(key),
        body: JSON.stringify({ sql }),
      });
      if (!sqlRes.ok) {
        const err = (await sqlRes.json()) as { message?: string };
        results.push({
          file,
          status: "error",
          error: err.message ?? "unknown",
        });
        break;
      }
      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => `${s};`);
      await fetch(`${url}/admin/v1/migrations/applied`, {
        method: "POST",
        headers: adminHeaders(key),
        body: JSON.stringify({ name: file, statements }),
      });
      results.push({ file, status: "applied" });
    }
    const lines = results.map((r) =>
      r.status === "applied"
        ? `  applied: ${r.file}`
        : `  error:   ${r.file} — ${r.error}`,
    );
    return ok({ results }, json, lines.join("\n"));
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdUsersList(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  try {
    const { ok: success, data } = await adminRequest<{
      users?: Array<{ id: string; email?: string; created_at?: string }>;
    }>(`${url}/auth/v1/admin/users`, key);
    if (!success) return apiError(data, json);
    const users = data.users ?? [];
    const text =
      users.length === 0
        ? "(no users)"
        : renderTable(
            ["id", "email", "created_at"],
            users.map((u) => ({
              id: u.id,
              email: u.email ?? "",
              created_at: u.created_at ?? "",
            })),
          );
    return ok(data, json, text);
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdUsersCreate(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const email = getArgValue(args, "--email");
  const password = getArgValue(args, "--password");
  if (!email) return fail("missing_email", "Provide --email", json);
  if (!password) return fail("missing_password", "Provide --password", json);
  try {
    const { ok: success, data } = await adminRequest<{
      id?: string;
      email?: string;
    }>(`${url}/auth/v1/admin/users`, key, {
      method: "POST",
      body: { email, password },
    });
    if (!success) return apiError(data, json);
    const text = `Created user\n  ID:    ${data.id}\n  Email: ${data.email}`;
    return ok(data, json, text);
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdUsersGet(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const id = args.find((a) => !a.startsWith("--"));
  if (!id) return fail("missing_id", "Provide a user ID", json);
  try {
    const { ok: success, data } = await adminRequest<{
      id?: string;
      email?: string;
      created_at?: string;
    }>(`${url}/auth/v1/admin/users/${id}`, key);
    if (!success) return apiError(data, json);
    const text = `ID:      ${data.id}\n  Email:   ${data.email}\n  Created: ${data.created_at}`;
    return ok(data, json, text);
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdUsersDelete(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const id = args.find((a) => !a.startsWith("--"));
  if (!id) return fail("missing_id", "Provide a user ID", json);
  if (!args.includes("--confirm"))
    return fail(
      "confirmation_required",
      "Pass --confirm to delete the user",
      json,
    );
  try {
    const { ok: success, data } = await adminRequest<unknown>(
      `${url}/auth/v1/admin/users/${id}`,
      key,
      { method: "DELETE" },
    );
    if (!success) return apiError(data, json);
    return ok(data, json, `Deleted user ${id}`);
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdAuthGenerateLink(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const email = getArgValue(args, "--email");
  const type = getArgValue(args, "--type") ?? "magiclink";
  if (!email) return fail("missing_email", "Provide --email", json);
  const validTypes = ["magiclink", "recovery", "signup", "invite"];
  if (!validTypes.includes(type))
    return fail(
      "invalid_type",
      `--type must be one of: ${validTypes.join(", ")}`,
      json,
    );
  try {
    const { ok: success, data } = await adminRequest<{
      action_link?: string;
      email_otp?: string;
      hashed_token?: string;
      email?: string;
    }>(`${url}/auth/v1/admin/generate_link`, key, {
      method: "POST",
      body: { type, email },
    });
    if (!success) return apiError(data, json);
    const text = [
      `Type:         ${type}`,
      `Email:        ${data.email}`,
      `Token (OTP):  ${data.email_otp}`,
      `Action link:  ${data.action_link}`,
    ].join("\n");
    return ok(data, json, text);
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdAuthAuditLog(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const perPage = getArgValue(args, "--per-page") ?? "50";
  const page = getArgValue(args, "--page") ?? "1";
  try {
    const { ok: success, data } = await adminRequest<{
      entries?: Array<{
        id?: string;
        created_at?: string;
        ip_address?: string;
        payload?: {
          action?: string;
          actor_username?: string;
          log_type?: string;
        };
      }>;
    }>(`${url}/auth/v1/admin/audit?page=${page}&per_page=${perPage}`, key);
    if (!success) return apiError(data, json);
    const entries = data.entries ?? [];
    const text =
      entries.length === 0
        ? "(no audit log entries)"
        : renderTable(
            ["created_at", "action", "actor", "ip"],
            entries.map((e) => ({
              created_at: e.created_at?.slice(0, 19) ?? "",
              action: e.payload?.action ?? "",
              actor: e.payload?.actor_username ?? "",
              ip: e.ip_address ?? "",
            })),
          );
    return ok(data, json, text);
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdAuthListFactors(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const userId = args.find((a) => !a.startsWith("--"));
  if (!userId) return fail("missing_id", "Provide a user ID", json);
  try {
    const { ok: success, data } = await adminRequest<{
      factors?: Array<{
        id: string;
        factor_type: string;
        friendly_name?: string;
        status: string;
        created_at?: string;
      }>;
    }>(`${url}/auth/v1/admin/users/${userId}/factors`, key);
    if (!success) return apiError(data, json);
    const factors = data.factors ?? [];
    const text =
      factors.length === 0
        ? "(no MFA factors enrolled)"
        : renderTable(
            ["id", "type", "friendly_name", "status"],
            factors.map((f) => ({
              id: `${f.id.slice(0, 8)}…`,
              type: f.factor_type,
              friendly_name: f.friendly_name ?? "",
              status: f.status,
            })),
          );
    return ok(data, json, text);
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdAuthDeleteFactor(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const positional = args.filter((a) => !a.startsWith("--"));
  const [userId, factorId] = positional;
  if (!userId) return fail("missing_user_id", "Provide a user ID", json);
  if (!factorId) return fail("missing_factor_id", "Provide a factor ID", json);
  try {
    const { ok: success, data } = await adminRequest<unknown>(
      `${url}/auth/v1/admin/users/${userId}/factors/${factorId}`,
      key,
      { method: "DELETE" },
    );
    if (!success) return apiError(data, json);
    return ok(data, json, `Deleted factor ${factorId} from user ${userId}`);
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdAuthBan(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const userId = args.find((a) => !a.startsWith("--"));
  if (!userId) return fail("missing_id", "Provide a user ID", json);
  const duration = getArgValue(args, "--duration") ?? "876000h";
  try {
    const { ok: success, data } = await adminRequest<{
      id?: string;
      banned_until?: string;
    }>(`${url}/auth/v1/admin/users/${userId}`, key, {
      method: "PUT",
      body: { ban_duration: duration },
    });
    if (!success) return apiError(data, json);
    const text =
      duration === "none"
        ? `Unbanned user ${userId}`
        : `Banned user ${userId} until ${data.banned_until ?? "indefinitely"}`;
    return ok(data, json, text);
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdStorageListBuckets(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  try {
    const { ok: success, data } = await adminRequest<
      Array<{
        id: string;
        name: string;
        public: boolean;
      }>
    >(`${url}/storage/v1/bucket`, key);
    if (!success) return apiError(data, json);
    const text =
      data.length === 0
        ? "(no buckets)"
        : renderTable(
            ["name", "public"],
            data.map((b) => ({ name: b.name, public: String(b.public) })),
          );
    return ok(data, json, text);
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdStorageCreateBucket(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) return fail("missing_name", "Provide a bucket name", json);
  const isPublic = args.includes("--public");
  try {
    const { ok: success, data } = await adminRequest<unknown>(
      `${url}/storage/v1/bucket`,
      key,
      { method: "POST", body: { id: name, name, public: isPublic } },
    );
    if (!success) return apiError(data, json);
    return ok(data, json, `Created bucket: ${name}`);
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdStorageLs(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const path = args.find((a) => !a.startsWith("--")) ?? "";
  const [bucket, ...rest] = path.split("/");
  const prefix = rest.join("/");
  if (!bucket) return fail("missing_bucket", "Provide a bucket name", json);
  try {
    const { ok: success, data } = await adminRequest<
      Array<{
        name: string;
        metadata?: { size?: number };
      }>
    >(`${url}/storage/v1/object/list/${bucket}`, key, {
      method: "POST",
      body: { prefix, limit: 100, offset: 0 },
    });
    if (!success) return apiError(data, json);
    const text =
      data.length === 0
        ? "(empty)"
        : data
            .map(
              (o) =>
                `  ${o.name}${o.metadata?.size != null ? `  (${o.metadata.size} bytes)` : ""}`,
            )
            .join("\n");
    return ok(data, json, text);
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdStorageCp(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length < 2)
    return fail("missing_args", "Provide <src> <dst>", json);
  const [src, dst] = positional;

  const isRemote = (p: string) =>
    p.includes("://") && !p.startsWith("./") && !p.startsWith("/");

  try {
    if (!isRemote(src) && isRemote(dst)) {
      const colonSlashSlash = dst.indexOf("://");
      const bucket = dst.slice(0, colonSlashSlash);
      const afterScheme = dst.slice(colonSlashSlash + 3);
      const objectPath = afterScheme || (src.split("/").pop() ?? src);
      const fileBuffer = await readFile(src);
      const res = await fetch(
        `${url}/storage/v1/object/${bucket}/${objectPath}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/octet-stream",
          },
          body: fileBuffer,
        },
      );
      const data = await res.json();
      if (!res.ok) return apiError(data, json);
      return ok(data, json, `Uploaded to ${bucket}://${objectPath}`);
    } else if (isRemote(src) && !isRemote(dst)) {
      const colonSlashSlash = src.indexOf("://");
      const bucket = src.slice(0, colonSlashSlash);
      const objectPath = src.slice(colonSlashSlash + 3);
      const res = await fetch(
        `${url}/storage/v1/object/${bucket}/${objectPath}`,
        {
          headers: { Authorization: `Bearer ${key}` },
        },
      );
      if (!res.ok) return apiError(await res.json(), json);
      await writeFile(dst, Buffer.from(await res.arrayBuffer()));
      return ok({ downloaded: dst }, json, `Downloaded to ${dst}`);
    } else {
      return fail(
        "invalid_paths",
        "One of src or dst must be a storage path (bucket://path)",
        json,
      );
    }
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

export async function cmdGenTypes(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const url = getUrl(args);
  const key = getServiceRoleKey(args);
  const outputFile = getArgValue(args, "--output");

  try {
    const { ok: success, data } = await adminRequest<
      Array<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>
    >(`${url}/admin/v1/schema?format=json`, key);
    if (!success) return apiError(data, json);

    const tables: Record<
      string,
      Array<{ name: string; type: string; nullable: boolean }>
    > = {};
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
        lines.push(
          `          ${col.name}: ${col.type}${col.nullable ? " | null" : ""};`,
        );
      }
      lines.push("        };");
      lines.push("        Insert: {");
      for (const col of cols) {
        lines.push(
          `          ${col.name}?: ${col.type}${col.nullable ? " | null" : ""};`,
        );
      }
      lines.push("        };");
      lines.push("        Update: {");
      for (const col of cols) {
        lines.push(
          `          ${col.name}?: ${col.type}${col.nullable ? " | null" : ""};`,
        );
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
      await writeFile(outputFile, types);
      return ok({ file: outputFile }, json, `Types written to: ${outputFile}`);
    }
    return { exitCode: 0, output: types };
  } catch (e: unknown) {
    return fail("request_failed", toErrorMessage(e), json);
  }
}

async function connectPg(dbUrl: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  return client;
}

const MIGRATION_FILE_PATTERN = /^(\d+)_.*\.sql$/;

export async function cmdSyncPush(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const skipMigrations = args.includes("--no-migrations");
  const skipStorage = args.includes("--no-storage");

  const remoteDbUrl =
    getArgValue(args, "--remote-db-url") ?? process.env.SUPABASE_DB_URL;
  const migrationsDir =
    getArgValue(args, "--migrations-dir") ?? DEFAULT_MIGRATIONS_DIR;

  if (!remoteDbUrl && !(skipMigrations && skipStorage))
    return fail("missing_remote_db_url", "Provide --remote-db-url", json);
  if (skipMigrations && skipStorage)
    return ok(
      { migrations: { applied: 0, skipped: 0 }, buckets: { upserted: 0 } },
      json,
      "Nothing to sync",
    );

  const localUrl = getUrl(args);
  const localKey = getServiceRoleKey(args);
  const result = {
    migrations: { applied: 0, skipped: 0 },
    buckets: { upserted: 0 },
  };

  const localFiles = existsSync(migrationsDir)
    ? readdirSync(migrationsDir)
        .filter((f) => MIGRATION_FILE_PATTERN.test(f))
        .sort()
    : [];

  let client: pg.Client | undefined;
  try {
    if (!skipMigrations || !skipStorage) {
      client = await connectPg(remoteDbUrl ?? "");
      await client.query(`ROLLBACK`).catch(() => {});
      await client.query(`SET search_path = "$user", public`);
    }

    if (!skipMigrations && client) {
      const migTableRes = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
        ) AS exists`,
      );
      const hasMigrationTable = migTableRes.rows[0]?.exists ?? false;

      if (hasMigrationTable) {
        const appliedRes = await client.query<{ version: string }>(
          `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version`,
        );
        const applied = new Set(appliedRes.rows.map((r) => r.version));

        for (const file of localFiles) {
          const match = file.match(MIGRATION_FILE_PATTERN) ?? [];
          const version = match[1] ?? "";
          const name = file.replace(/\.sql$/, "").slice(version.length + 1);

          if (applied.has(version)) {
            result.migrations.skipped++;
            continue;
          }

          const sql = await readFile(join(migrationsDir, file), "utf8");
          const statements = sql
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean);
          if (!dryRun) {
            for (const stmt of statements) await client.query(stmt);
            await client.query(
              `INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES($1, $2, $3)`,
              [version, name, statements],
            );
          }
          result.migrations.applied++;
        }
      } else {
        if (!dryRun) {
          await client.query(`CREATE SCHEMA IF NOT EXISTS supabase_migrations`);
          await client.query(
            `CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version TEXT PRIMARY KEY, statements TEXT[], name TEXT)`,
          );
        }
        for (const file of localFiles) {
          const match = file.match(MIGRATION_FILE_PATTERN) ?? [];
          const version = match[1] ?? "";
          const name = file.replace(/\.sql$/, "").slice(version.length + 1);
          const sql = await readFile(join(migrationsDir, file), "utf8");
          const statements = sql
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean);
          if (!dryRun) {
            for (const stmt of statements) await client.query(stmt);
            await client.query(
              `INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES($1, $2, $3)`,
              [version, name, statements],
            );
          }
          result.migrations.applied++;
        }
      }
    }

    if (!skipStorage && client) {
      const localBucketsRes = await fetch(`${localUrl}/storage/v1/bucket`, {
        headers: adminHeaders(localKey),
      });
      const localBuckets = (await localBucketsRes.json()) as Array<{
        id: string;
        name: string;
        public: boolean;
        file_size_limit: number | null;
        allowed_mime_types: string[] | null;
      }>;

      for (const bucket of localBuckets) {
        if (!dryRun) {
          await client.query(
            `INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
             VALUES($1, $2, ${bucket.public ? "TRUE" : "FALSE"}, $3, $4)
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               public = EXCLUDED.public,
               file_size_limit = EXCLUDED.file_size_limit,
               allowed_mime_types = EXCLUDED.allowed_mime_types,
               updated_at = now()`,
            [
              bucket.id,
              bucket.name,
              bucket.file_size_limit,
              bucket.allowed_mime_types,
            ],
          );
        }
        result.buckets.upserted++;
      }
    }
  } catch (e: unknown) {
    if (client) await client.end().catch(() => {});
    return fail("sync_failed", toErrorMessage(e), json);
  }
  if (client) await client.end().catch(() => {});

  const text = [
    `Sync push to ${remoteDbUrl}${dryRun ? " (dry run)" : ""}`,
    ``,
    `Migrations:  ${result.migrations.applied} applied, ${result.migrations.skipped} skipped`,
    `Buckets:     ${result.buckets.upserted} upserted`,
  ].join("\n");
  return ok(result, json, text);
}

const EXCLUDED_SCHEMAS = [
  "pg_catalog",
  "information_schema",
  "pg_toast",
  "auth",
  "storage",
  "realtime",
  "supabase_functions",
  "supabase_migrations",
  "extensions",
  "pgbouncer",
  "cron",
  "dbdev",
  "graphql",
  "graphql_public",
  "net",
  "pgmq",
  "pgsodium",
  "pgtle",
  "repack",
  "tiger",
  "tiger_data",
  "topology",
  "vault",
  "_analytics",
  "_realtime",
  "_supavisor",
];

async function dumpSchema(
  client: pg.Client,
  remoteDbUrl: string,
  remoteUrl?: string,
  remoteKey?: string,
): Promise<string> {
  if (remoteUrl) {
    try {
      const res = await fetch(`${remoteUrl}/admin/v1/schema`, {
        headers: { Authorization: `Bearer ${remoteKey ?? ""}` },
      });
      if (res.ok) {
        const text = await res.text();
        if (text.trim()) return text;
      }
    } catch {}
  }

  const pgDumpResult = spawnSync(
    "pg_dump",
    ["--schema-only", "--no-owner", "--no-acl", "--schema=public", remoteDbUrl],
    { encoding: "utf8" },
  );
  if (pgDumpResult.status === 0 && pgDumpResult.stdout)
    return pgDumpResult.stdout;
  await client.query(`ROLLBACK`).catch(() => {});
  await client.query(`SET search_path = "$user", public`).catch(() => {});

  const schemaRes = await client.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    `SELECT table_schema, table_name, column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema NOT IN (${EXCLUDED_SCHEMAS.map((_, i) => `$${i + 1}`).join(", ")})
     ORDER BY table_schema, table_name, ordinal_position`,
    EXCLUDED_SCHEMAS,
  );
  const tables: Record<string, string[]> = {};
  for (const row of schemaRes.rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    if (!tables[key]) tables[key] = [];
    tables[key].push(
      `  ${row.column_name} ${row.data_type}${row.is_nullable === "NO" ? " NOT NULL" : ""}`,
    );
  }
  return Object.entries(tables)
    .map(([key, cols]) => {
      const [schema, name] = key.split(".");
      const qualified = schema === "public" ? name : `${schema}.${name}`;
      return `CREATE TABLE IF NOT EXISTS ${qualified} (\n${cols.join(",\n")}\n);`;
    })
    .join("\n\n");
}

export async function cmdSyncPull(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const skipMigrations = args.includes("--no-migrations");
  const skipStorage = args.includes("--no-storage");

  const remoteDbUrl =
    getArgValue(args, "--remote-db-url") ?? process.env.SUPABASE_DB_URL;
  const remoteUrl =
    getArgValue(args, "--remote-url") ?? process.env.SUPABASE_URL;
  const remoteKey =
    getArgValue(args, "--remote-service-role-key") ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  const migrationsDir =
    getArgValue(args, "--migrations-dir") ?? DEFAULT_MIGRATIONS_DIR;

  if (!remoteDbUrl)
    return fail("missing_remote_db_url", "Provide --remote-db-url", json);

  const localUrl = getUrl(args);
  const localKey = getServiceRoleKey(args);
  const result = { migrations: { written: 0 }, buckets: { upserted: 0 } };

  let client: pg.Client | undefined;
  try {
    client = await connectPg(remoteDbUrl);

    if (!skipMigrations) {
      const migTableRes = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
        ) AS exists`,
      );
      const hasMigrationTable = migTableRes.rows[0]?.exists ?? false;

      if (hasMigrationTable) {
        const migrationsRes = await client.query<{
          version: string;
          name: string | null;
          statements: string[] | null;
        }>(
          `SELECT version, name, statements FROM supabase_migrations.schema_migrations ORDER BY version`,
        );

        if (migrationsRes.rows.length > 0) {
          const existingFiles = existsSync(migrationsDir)
            ? readdirSync(migrationsDir)
            : [];
          const existingVersions = new Set(
            existingFiles.map((f) => f.replace(/\.sql$/, "").split("_")[0]),
          );

          for (const row of migrationsRes.rows) {
            if (existingVersions.has(row.version)) continue;
            const safeName = row.name
              ? `_${row.name.replace(/[^a-zA-Z0-9_]/g, "_")}`
              : "";
            const filename = `${row.version}${safeName}.sql`;
            const filePath = join(migrationsDir, filename);
            const sql = (row.statements ?? []).join("\n");
            if (sql && !dryRun) await writeFile(filePath, sql);
            if (sql) result.migrations.written++;
          }
        } else {
          const ddl = await dumpSchema(
            client,
            remoteDbUrl,
            remoteUrl,
            remoteKey,
          );
          if (ddl) {
            const timestamp = new Date()
              .toISOString()
              .replace(/[-:T.Z]/g, "")
              .slice(0, 14);
            if (!dryRun)
              await writeFile(
                join(migrationsDir, `${timestamp}_pulled_schema.sql`),
                ddl,
              );
            result.migrations.written = 1;
          }
        }
      } else {
        const ddl = await dumpSchema(client, remoteDbUrl, remoteUrl, remoteKey);
        if (ddl) {
          const timestamp = new Date()
            .toISOString()
            .replace(/[-:T.Z]/g, "")
            .slice(0, 14);
          if (!dryRun)
            await writeFile(
              join(migrationsDir, `${timestamp}_pulled_schema.sql`),
              ddl,
            );
          result.migrations.written = 1;
        }
      }
    }

    if (!skipStorage) {
      const remoteBucketsRes = await client.query<{
        id: string;
        name: string;
        public: boolean;
        file_size_limit: number | null;
        allowed_mime_types: string[] | null;
      }>(
        `SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets`,
      );

      for (const bucket of remoteBucketsRes.rows) {
        if (!dryRun) {
          await fetch(`${localUrl}/storage/v1/bucket`, {
            method: "POST",
            headers: {
              ...adminHeaders(localKey),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              id: bucket.id,
              name: bucket.name,
              public: bucket.public,
              fileSizeLimit: bucket.file_size_limit,
              allowedMimeTypes: bucket.allowed_mime_types,
            }),
          });
        }
        result.buckets.upserted++;
      }
    }
  } catch (e: unknown) {
    if (client) await client.end().catch(() => {});
    return fail("sync_failed", toErrorMessage(e), json);
  }
  await client.end().catch(() => {});

  const text = [
    `Sync pull from ${remoteDbUrl}${dryRun ? " (dry run)" : ""}`,
    ``,
    `Migrations:  ${result.migrations.written} file(s) written`,
    `Buckets:     ${result.buckets.upserted} upserted`,
  ].join("\n");
  return ok(result, json, text);
}

function pgTypeToTs(pgType: string): string {
  if (
    pgType.includes("int") ||
    pgType.includes("numeric") ||
    pgType.includes("float") ||
    pgType.includes("double") ||
    pgType.includes("real") ||
    pgType.includes("decimal")
  )
    return "number";
  if (pgType.includes("bool")) return "boolean";
  if (pgType === "json" || pgType === "jsonb") return "Json";
  if (
    pgType.includes("timestamp") ||
    pgType.includes("date") ||
    pgType.includes("time")
  )
    return "string";
  return "string";
}

const DEFAULT_SERVICE_URL = "http://localhost:8080";

function getServiceUrl(args: string[]): string {
  return getArgValue(args, "--url") ?? DEFAULT_SERVICE_URL;
}

function getAdminToken(args: string[]): string | undefined {
  return getArgValue(args, "--admin-token") ?? process.env.NANO_ADMIN_TOKEN;
}

async function serviceRequest<T>(
  method: string,
  url: string,
  token: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    method,
    headers: adminHeaders(token),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as T;
  return { ok: res.ok, status: res.status, data };
}

export async function cmdServiceAdd(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const token = getAdminToken(args);
  if (!token)
    return fail(
      "missing_admin_token",
      "--admin-token or NANO_ADMIN_TOKEN is required",
      json,
    );
  const slug = args.find((a) => !a.startsWith("--"));
  if (!slug) return fail("missing_slug", "Usage: service add <slug>", json);
  const serviceUrl = getServiceUrl(args);
  const body: Record<string, string> = { slug };
  const customToken = getArgValue(args, "--token");
  const password = getArgValue(args, "--password");
  const anonKey = getArgValue(args, "--anon-key");
  const serviceRoleKey = getArgValue(args, "--service-role-key");
  if (customToken) body.token = customToken;
  if (password) body.password = password;
  if (anonKey) body.anonKey = anonKey;
  if (serviceRoleKey) body.serviceRoleKey = serviceRoleKey;
  const { ok: success, data } = await serviceRequest<Record<string, unknown>>(
    "POST",
    `${serviceUrl}/admin/tenants`,
    token,
    body,
  );
  if (!success) return apiError(data, json);
  const result = data as {
    token: string;
    password: string;
    tenant: Record<string, unknown>;
  };
  const tenant = result.tenant as Record<string, unknown>;
  if (json) return ok(result, json, "");
  const { printTenantInfo } = await import("./cli-display.ts");
  printTenantInfo({
    slug: String(tenant.slug),
    serviceUrl,
    pgUrl: String(tenant.pgUrl),
    anonKey: String(tenant.anonKey),
    serviceRoleKey: String(tenant.serviceRoleKey),
    token: result.token,
    state: String(tenant.state),
  });
  return { exitCode: 0, output: "" };
}

export async function cmdServiceList(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const token = getAdminToken(args);
  if (!token)
    return fail(
      "missing_admin_token",
      "--admin-token or NANO_ADMIN_TOKEN is required",
      json,
    );
  const { ok: success, data } = await serviceRequest<unknown[]>(
    "GET",
    `${getServiceUrl(args)}/admin/tenants`,
    token,
  );
  if (!success) return apiError(data, json);
  return ok(
    data,
    json,
    renderTable(
      ["slug", "state", "lastActive"],
      data as Record<string, unknown>[],
    ),
  );
}

export async function cmdServiceRemove(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const token = getAdminToken(args);
  if (!token)
    return fail(
      "missing_admin_token",
      "--admin-token or NANO_ADMIN_TOKEN is required",
      json,
    );
  const slug = args.find((a) => !a.startsWith("--"));
  if (!slug) return fail("missing_slug", "Usage: service remove <slug>", json);
  const { ok: success, data } = await serviceRequest<unknown>(
    "DELETE",
    `${getServiceUrl(args)}/admin/tenants/${slug}`,
    token,
  );
  if (!success) return apiError(data, json);
  return ok(data, json, `Tenant "${slug}" deleted.`);
}

export async function cmdServicePause(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const token = getAdminToken(args);
  if (!token)
    return fail(
      "missing_admin_token",
      "--admin-token or NANO_ADMIN_TOKEN is required",
      json,
    );
  const slug = args.find((a) => !a.startsWith("--"));
  if (!slug) return fail("missing_slug", "Usage: service pause <slug>", json);
  const { ok: success, data } = await serviceRequest<unknown>(
    "POST",
    `${getServiceUrl(args)}/admin/tenants/${slug}/pause`,
    token,
  );
  if (!success) return apiError(data, json);
  return ok(data, json, `Tenant "${slug}" paused.`);
}

export async function cmdServiceWake(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const token = getAdminToken(args);
  if (!token)
    return fail(
      "missing_admin_token",
      "--admin-token or NANO_ADMIN_TOKEN is required",
      json,
    );
  const slug = args.find((a) => !a.startsWith("--"));
  if (!slug) return fail("missing_slug", "Usage: service wake <slug>", json);
  const { ok: success, data } = await serviceRequest<unknown>(
    "POST",
    `${getServiceUrl(args)}/admin/tenants/${slug}/wake`,
    token,
  );
  if (!success) return apiError(data, json);
  return ok(data, json, `Tenant "${slug}" woken.`);
}

export async function cmdServiceSql(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const token = getAdminToken(args);
  if (!token)
    return fail(
      "missing_admin_token",
      "--admin-token or NANO_ADMIN_TOKEN is required",
      json,
    );
  const positional = args.filter((a) => !a.startsWith("--"));
  const slug = positional[0];
  const sql = positional[1];
  if (!slug || !sql)
    return fail("missing_args", 'Usage: service sql <slug> "<sql>"', json);
  const { ok: success, data } = await serviceRequest<Record<string, unknown>>(
    "POST",
    `${getServiceUrl(args)}/admin/tenants/${slug}/sql`,
    token,
    { sql },
  );
  if (!success) return apiError(data, json);
  const result = data as { rows: Record<string, unknown>[]; rowCount: number };
  if (json) return ok(result, json, "");
  if (result.rows.length === 0) return ok(result, json, "(0 rows)");
  return ok(
    result,
    json,
    renderTable(Object.keys(result.rows[0]), result.rows),
  );
}

export async function cmdServiceResetToken(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const token = getAdminToken(args);
  if (!token)
    return fail(
      "missing_admin_token",
      "--admin-token or NANO_ADMIN_TOKEN is required",
      json,
    );
  const slug = args.find((a) => !a.startsWith("--"));
  if (!slug)
    return fail("missing_slug", "Usage: service reset-token <slug>", json);
  const { ok: success, data } = await serviceRequest<{ token: string }>(
    "POST",
    `${getServiceUrl(args)}/admin/tenants/${slug}/reset-token`,
    token,
  );
  if (!success) return apiError(data, json);
  return ok(data, json, `New token: ${(data as { token: string }).token}`);
}

export async function cmdServiceResetPassword(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const token = getAdminToken(args);
  if (!token)
    return fail(
      "missing_admin_token",
      "--admin-token or NANO_ADMIN_TOKEN is required",
      json,
    );
  const slug = args.find((a) => !a.startsWith("--"));
  if (!slug)
    return fail("missing_slug", "Usage: service reset-password <slug>", json);
  const body: Record<string, string> = {};
  const newPassword = getArgValue(args, "--password");
  if (newPassword) body.password = newPassword;
  const { ok: success, data } = await serviceRequest<{ password: string }>(
    "POST",
    `${getServiceUrl(args)}/admin/tenants/${slug}/reset-password`,
    token,
    body,
  );
  if (!success) return apiError(data, json);
  return ok(
    data,
    json,
    `New password: ${(data as { password: string }).password}`,
  );
}

export async function cmdServiceMigrate(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const token = getAdminToken(args);
  if (!token)
    return fail(
      "missing_admin_token",
      "--admin-token or NANO_ADMIN_TOKEN is required",
      json,
    );
  const positional = args.filter((a) => !a.startsWith("--"));
  const slug = positional[0];
  if (!slug)
    return fail(
      "missing_slug",
      "Usage: service migrate <slug> --remote-db-url=<url>",
      json,
    );

  const remoteDbUrl =
    getArgValue(args, "--remote-db-url") ?? process.env.SUPABASE_DB_URL;
  if (!remoteDbUrl)
    return fail(
      "missing_remote_db_url",
      "Provide --remote-db-url or set SUPABASE_DB_URL",
      json,
    );

  const remoteUrl =
    getArgValue(args, "--remote-url") ?? process.env.SUPABASE_URL;
  const remoteServiceRoleKey =
    getArgValue(args, "--remote-service-role-key") ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  const body: Record<string, unknown> = {
    remoteDbUrl,
    remoteUrl,
    remoteServiceRoleKey,
    skipSchema: args.includes("--no-schema"),
    skipAuth: args.includes("--no-auth"),
    skipData: args.includes("--no-data"),
    skipStorage: args.includes("--no-storage"),
    dryRun: args.includes("--dry-run"),
  };
  const migrationsDir = getArgValue(args, "--migrations-dir");
  if (migrationsDir) body.migrationsDir = migrationsDir;

  const { ok: success, data } = await serviceRequest<Record<string, unknown>>(
    "POST",
    `${getServiceUrl(args)}/admin/tenants/${slug}/migrate`,
    token,
    body,
  );

  if (!success) return apiError(data, json);

  const r = data as {
    schema: {
      tables: number;
      migrations: number;
      views: number;
      functions: number;
      triggers: number;
      policies: number;
    };
    auth: { users: number; identities: number };
    data: { tables: number; rows: number };
    storage: { buckets: number; objects: number };
  };

  if (json) return ok(r, json, "");
  const dryTag = args.includes("--dry-run") ? " (dry run)" : "";
  const schemaExtra = [
    r.schema.views > 0 ? `${r.schema.views} view(s)` : "",
    r.schema.functions > 0 ? `${r.schema.functions} function(s)` : "",
    r.schema.triggers > 0 ? `${r.schema.triggers} trigger(s)` : "",
    r.schema.policies > 0 ? `${r.schema.policies} RLS policy(ies)` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const lines = [
    `Migrate tenant "${slug}" → ${remoteDbUrl}${dryTag}`,
    ``,
    `Schema:    ${r.schema.migrations} migration(s), ${r.schema.tables} table(s) introspected${schemaExtra ? `, ${schemaExtra}` : ""}`,
    `Auth:      ${r.auth.users} user(s), ${r.auth.identities} identity(ies)`,
    `Data:      ${r.data.rows} row(s) across ${r.data.tables} table(s)`,
    `Storage:   ${r.storage.buckets} bucket(s), ${r.storage.objects} object(s)`,
  ];
  if (!remoteUrl || !remoteServiceRoleKey) {
    lines.push(
      ``,
      `Note: Storage objects skipped (provide --remote-url and --remote-service-role-key to upload files)`,
    );
  }
  return ok(r, json, lines.join("\n"));
}

export interface MigrateCallbacks {
  querySource: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
  executeOnTarget: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
  downloadObject?: (
    bucketId: string,
    objectName: string,
  ) => Promise<{ data: ArrayBuffer; contentType: string } | null>;
  uploadObject?: (
    bucketId: string,
    objectName: string,
    data: ArrayBuffer,
    contentType: string,
  ) => Promise<boolean>;
}

export interface MigrateResult {
  schema: {
    tables: number;
    migrations: number;
    views: number;
    functions: number;
    triggers: number;
    policies: number;
  };
  auth: { users: number; identities: number };
  data: { tables: number; rows: number };
  storage: { buckets: number; objects: number };
}

export async function migrateDatabase(
  cb: MigrateCallbacks,
  opts: {
    skipSchema?: boolean;
    skipAuth?: boolean;
    skipData?: boolean;
    skipStorage?: boolean;
    dryRun?: boolean;
    migrationsDir?: string;
  },
): Promise<MigrateResult> {
  const result: MigrateResult = {
    schema: {
      tables: 0,
      migrations: 0,
      views: 0,
      functions: 0,
      triggers: 0,
      policies: 0,
    },
    auth: { users: 0, identities: 0 },
    data: { tables: 0, rows: 0 },
    storage: { buckets: 0, objects: 0 },
  };

  await cb.executeOnTarget("SET search_path = public").catch(() => {});

  if (!opts.skipSchema) {
    const { existsSync: existsSyncFn, readdirSync: readdirSyncFn } =
      await import("node:fs");
    const { readFile: readFileFn } = await import("node:fs/promises");
    const { join: joinFn } = await import("node:path");
    const migDir = opts.migrationsDir ?? "./supabase/migrations";
    const migPattern = /^(\d+)_.*\.sql$/;

    let usedMigrationFiles = false;
    if (existsSyncFn(migDir)) {
      const files = readdirSyncFn(migDir)
        .filter((f: string) => migPattern.test(f))
        .sort();
      if (files.length > 0) {
        usedMigrationFiles = true;
        await cb
          .executeOnTarget("CREATE SCHEMA IF NOT EXISTS supabase_migrations")
          .catch(() => {});
        await cb
          .executeOnTarget(
            `CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version TEXT PRIMARY KEY, statements TEXT[], name TEXT)`,
          )
          .catch(() => {});
        const appliedRes = await cb
          .executeOnTarget<{ version: string }>(
            "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
          )
          .catch(() => ({ rows: [] }) as { rows: { version: string }[] });
        const applied = new Set(appliedRes.rows.map((r) => r.version));
        for (const file of files) {
          const match = file.match(migPattern) ?? [];
          const version = match[1] ?? "";
          const name = file.replace(/\.sql$/, "").slice(version.length + 1);
          if (applied.has(version)) continue;
          const sql = await readFileFn(joinFn(migDir, file), "utf8");
          const statements = sql
            .split(";")
            .map((s: string) => s.trim())
            .filter(Boolean);
          if (!opts.dryRun) {
            for (const stmt of statements) await cb.executeOnTarget(stmt);
            await cb.executeOnTarget(
              "INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES($1, $2, $3)",
              [version, name, statements],
            );
          }
          result.schema.migrations++;
        }
      }
    }

    if (!usedMigrationFiles) {
      const hasMigTable = await cb
        .querySource<{ exists: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations') AS exists`,
        )
        .then((r) => r.rows[0]?.exists ?? false)
        .catch(() => false);
      if (hasMigTable) {
        const migRows = await cb.querySource<{
          version: string;
          name: string | null;
          statements: string[] | null;
        }>(
          "SELECT version, name, statements FROM supabase_migrations.schema_migrations ORDER BY version",
        );
        if (migRows.rows.length > 0) {
          usedMigrationFiles = true;
          await cb
            .executeOnTarget("CREATE SCHEMA IF NOT EXISTS supabase_migrations")
            .catch(() => {});
          await cb
            .executeOnTarget(
              `CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version TEXT PRIMARY KEY, statements TEXT[], name TEXT)`,
            )
            .catch(() => {});
          const appliedRes = await cb
            .executeOnTarget<{ version: string }>(
              "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
            )
            .catch(
              () => ({ rows: [] }) as { rows: { version: string }[] },
            );
          const applied = new Set(appliedRes.rows.map((r) => r.version));
          for (const row of migRows.rows) {
            if (applied.has(row.version)) continue;
            const stmts = row.statements ?? [];
            if (!opts.dryRun) {
              for (const stmt of stmts) await cb.executeOnTarget(stmt);
              await cb.executeOnTarget(
                "INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES($1, $2, $3)",
                [row.version, row.name, stmts],
              );
            }
            result.schema.migrations++;
          }
        }
      }
    }

    if (!usedMigrationFiles) {
      const enumsRes = await cb.querySource<{
        typname: string;
        labels: string;
      }>(
        `SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) as labels
         FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
         JOIN pg_namespace n ON t.typnamespace = n.oid
         WHERE n.nspname = 'public' GROUP BY t.typname`,
      );
      for (const en of enumsRes.rows) {
        const vals = en.labels
          .split(",")
          .map((l: string) => `'${l.replace(/'/g, "''")}'`)
          .join(", ");
        if (!opts.dryRun)
          await cb
            .executeOnTarget(
              `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${en.typname}') THEN CREATE TYPE "${en.typname}" AS ENUM (${vals}); END IF; END $$`,
            )
            .catch(() => {});
      }

      const seqRes = await cb.querySource<{
        sequence_name: string;
      }>(
        "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'",
      );
      for (const seq of seqRes.rows) {
        if (!opts.dryRun)
          await cb
            .executeOnTarget(
              `CREATE SEQUENCE IF NOT EXISTS "${seq.sequence_name}"`,
            )
            .catch(() => {});
      }

      const tablesRes = await cb.querySource<{
        table_name: string;
      }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
      );

      for (const tbl of tablesRes.rows) {
        const tn = tbl.table_name;
        const colsRes = await cb.querySource<{
          column_name: string;
          data_type: string;
          udt_name: string;
          is_nullable: string;
          column_default: string | null;
          character_maximum_length: number | null;
          numeric_precision: number | null;
          numeric_scale: number | null;
        }>(
          "SELECT column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
          [tn],
        );

        const colDefs: string[] = [];
        for (const c of colsRes.rows) {
          let typeStr =
            c.data_type === "USER-DEFINED" ? `"${c.udt_name}"` : c.data_type;
          if (
            c.character_maximum_length &&
            (c.data_type === "character varying" ||
              c.data_type === "character")
          )
            typeStr += `(${c.character_maximum_length})`;
          if (
            c.numeric_precision &&
            c.numeric_scale &&
            c.data_type === "numeric"
          )
            typeStr += `(${c.numeric_precision}, ${c.numeric_scale})`;
          let def = `"${c.column_name}" ${typeStr}`;
          if (c.column_default !== null) def += ` DEFAULT ${c.column_default}`;
          if (c.is_nullable === "NO") def += " NOT NULL";
          colDefs.push(def);
        }

        const pkRes = await cb.querySource<{
          column_name: string;
        }>(
          `SELECT kcu.column_name FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
           WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
           ORDER BY kcu.ordinal_position`,
          [tn],
        );
        if (pkRes.rows.length > 0)
          colDefs.push(
            `PRIMARY KEY (${pkRes.rows.map((r) => `"${r.column_name}"`).join(", ")})`,
          );

        const uqRes = await cb.querySource<{
          constraint_name: string;
          column_name: string;
        }>(
          `SELECT tc.constraint_name, kcu.column_name FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
           WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'UNIQUE'
           ORDER BY tc.constraint_name, kcu.ordinal_position`,
          [tn],
        );
        const uniqueGroups: Record<string, string[]> = {};
        for (const r of uqRes.rows) {
          if (!uniqueGroups[r.constraint_name])
            uniqueGroups[r.constraint_name] = [];
          uniqueGroups[r.constraint_name].push(`"${r.column_name}"`);
        }
        for (const cols of Object.values(uniqueGroups))
          colDefs.push(`UNIQUE (${cols.join(", ")})`);

        const fkRes = await cb.querySource<{
          constraint_name: string;
          column_name: string;
          foreign_table_schema: string;
          foreign_table_name: string;
          foreign_column_name: string;
        }>(
          `SELECT tc.constraint_name, kcu.column_name,
                  ccu.table_schema AS foreign_table_schema,
                  ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
           JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
           WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'`,
          [tn],
        );
        for (const fk of fkRes.rows) {
          const ref =
            fk.foreign_table_schema !== "public"
              ? `"${fk.foreign_table_schema}"."${fk.foreign_table_name}"`
              : `"${fk.foreign_table_name}"`;
          colDefs.push(
            `FOREIGN KEY ("${fk.column_name}") REFERENCES ${ref}("${fk.foreign_column_name}")`,
          );
        }

        const ddl = `CREATE TABLE IF NOT EXISTS "${tn}" (\n  ${colDefs.join(",\n  ")}\n)`;
        if (!opts.dryRun) await cb.executeOnTarget(ddl);
        result.schema.tables++;
      }

      const idxRes = await cb.querySource<{
        indexname: string;
        indexdef: string;
      }>(
        "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname NOT LIKE '%_pkey'",
      );
      for (const idx of idxRes.rows) {
        if (!opts.dryRun) {
          const safeIdx = idx.indexdef.replace(
            /CREATE INDEX/,
            "CREATE INDEX IF NOT EXISTS",
          );
          await cb.executeOnTarget(safeIdx).catch(() => {});
        }
      }

      const viewsRes = await cb.querySource<{
        viewname: string;
        definition: string;
      }>(
        "SELECT viewname, definition FROM pg_views WHERE schemaname = 'public'",
      );
      for (const v of viewsRes.rows) {
        if (!opts.dryRun)
          await cb
            .executeOnTarget(
              `CREATE OR REPLACE VIEW "${v.viewname}" AS ${v.definition}`,
            )
            .catch(() => {});
        result.schema.views++;
      }

      const funcsRes = await cb.querySource<{
        proname: string;
        func_def: string;
      }>(
        `SELECT p.proname, pg_get_functiondef(p.oid) AS func_def
         FROM pg_proc p
         JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')`,
      );
      for (const fn of funcsRes.rows) {
        if (!opts.dryRun)
          await cb.executeOnTarget(`${fn.func_def};`).catch(() => {});
        result.schema.functions++;
      }

      const triggersRes = await cb.querySource<{
        trigger_def: string;
      }>(
        `SELECT pg_get_triggerdef(t.oid) AS trigger_def
         FROM pg_trigger t
         JOIN pg_class c ON t.tgrelid = c.oid
         JOIN pg_namespace n ON c.relnamespace = n.oid
         WHERE n.nspname = 'public' AND NOT t.tgisinternal`,
      );
      for (const tr of triggersRes.rows) {
        if (!opts.dryRun)
          await cb.executeOnTarget(`${tr.trigger_def};`).catch(() => {});
        result.schema.triggers++;
      }

      for (const tbl of tablesRes.rows) {
        const tn = tbl.table_name;
        const rlsEnabled = await cb
          .querySource<{ rowsecurity: boolean }>(
            `SELECT relrowsecurity AS rowsecurity FROM pg_class c
             JOIN pg_namespace n ON c.relnamespace = n.oid
             WHERE n.nspname = 'public' AND c.relname = $1`,
            [tn],
          )
          .then((r) => r.rows[0]?.rowsecurity ?? false)
          .catch(() => false);
        if (rlsEnabled && !opts.dryRun)
          await cb
            .executeOnTarget(
              `ALTER TABLE "${tn}" ENABLE ROW LEVEL SECURITY`,
            )
            .catch(() => {});

        const policiesRes = await cb.querySource<{
          policyname: string;
          polcmd: string;
          permissive: string;
          roles: string;
          qual: string | null;
          with_check: string | null;
        }>(
          `SELECT pol.polname AS policyname,
                 CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END AS polcmd,
                 CASE pol.polpermissive WHEN true THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END AS permissive,
                 CASE WHEN pol.polroles = '{0}' THEN 'PUBLIC' ELSE (SELECT string_agg(rolname, ', ') FROM pg_roles WHERE oid = ANY(pol.polroles)) END AS roles,
                 pg_get_expr(pol.polqual, pol.polrelid) AS qual,
                 pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check
           FROM pg_policy pol
           JOIN pg_class c ON pol.polrelid = c.oid
           JOIN pg_namespace n ON c.relnamespace = n.oid
           WHERE n.nspname = 'public' AND c.relname = $1`,
          [tn],
        );
        for (const pol of policiesRes.rows) {
          let stmt = `CREATE POLICY "${pol.policyname}" ON "${tn}" AS ${pol.permissive} FOR ${pol.polcmd} TO ${pol.roles}`;
          if (pol.qual) stmt += ` USING (${pol.qual})`;
          if (pol.with_check) stmt += ` WITH CHECK (${pol.with_check})`;
          if (!opts.dryRun) await cb.executeOnTarget(stmt).catch(() => {});
          result.schema.policies++;
        }
      }
    }
  }

  if (!opts.skipAuth) {
    const usersRes = await cb.querySource<Record<string, unknown>>(
      `SELECT id, instance_id, aud, role, email, encrypted_password,
              email_confirmed_at, invited_at, confirmation_token,
              confirmation_sent_at, recovery_token, recovery_sent_at,
              email_change_token_new, email_change, email_change_sent_at,
              email_change_confirm_status, last_sign_in_at,
              raw_app_meta_data, raw_user_meta_data, is_super_admin,
              created_at, updated_at, phone, phone_confirmed_at,
              phone_change, phone_change_token, phone_change_sent_at,
              banned_until, reauthentication_token, reauthentication_sent_at,
              is_sso_user, deleted_at, is_anonymous
       FROM auth.users ORDER BY created_at`,
    );

    for (const u of usersRes.rows) {
      if (!opts.dryRun) {
        await cb.executeOnTarget(
          `INSERT INTO auth.users (
             id, instance_id, aud, role, email, encrypted_password,
             email_confirmed_at, invited_at, confirmation_token,
             confirmation_sent_at, recovery_token, recovery_sent_at,
             email_change_token_new, email_change, email_change_sent_at,
             email_change_confirm_status, last_sign_in_at,
             raw_app_meta_data, raw_user_meta_data, is_super_admin,
             created_at, updated_at, phone, phone_confirmed_at,
             phone_change, phone_change_token, phone_change_sent_at,
             banned_until, reauthentication_token, reauthentication_sent_at,
             is_sso_user, deleted_at, is_anonymous
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33
           ) ON CONFLICT (id) DO NOTHING`,
          [
            u.id,
            u.instance_id,
            u.aud,
            u.role,
            u.email,
            u.encrypted_password,
            u.email_confirmed_at,
            u.invited_at,
            u.confirmation_token,
            u.confirmation_sent_at,
            u.recovery_token,
            u.recovery_sent_at,
            u.email_change_token_new,
            u.email_change,
            u.email_change_sent_at,
            u.email_change_confirm_status,
            u.last_sign_in_at,
            u.raw_app_meta_data
              ? JSON.stringify(u.raw_app_meta_data)
              : "{}",
            u.raw_user_meta_data
              ? JSON.stringify(u.raw_user_meta_data)
              : "{}",
            u.is_super_admin,
            u.created_at,
            u.updated_at,
            u.phone,
            u.phone_confirmed_at,
            u.phone_change,
            u.phone_change_token,
            u.phone_change_sent_at,
            u.banned_until,
            u.reauthentication_token,
            u.reauthentication_sent_at,
            u.is_sso_user,
            u.deleted_at,
            u.is_anonymous,
          ],
        );
      }
      result.auth.users++;
    }

    const identitiesRes = await cb.querySource<Record<string, unknown>>(
      `SELECT id, provider_id, user_id, identity_data, provider,
              last_sign_in_at, created_at, updated_at
       FROM auth.identities ORDER BY created_at`,
    );

    for (const ident of identitiesRes.rows) {
      if (!opts.dryRun) {
        await cb.executeOnTarget(
          `INSERT INTO auth.identities (
             id, provider_id, user_id, identity_data, provider,
             last_sign_in_at, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO NOTHING`,
          [
            ident.id,
            ident.provider_id,
            ident.user_id,
            ident.identity_data
              ? JSON.stringify(ident.identity_data)
              : "{}",
            ident.provider,
            ident.last_sign_in_at,
            ident.created_at,
            ident.updated_at,
          ],
        );
      }
      result.auth.identities++;
    }
  }

  if (!opts.skipData) {
    const tablesRes = await cb.querySource<{
      table_name: string;
    }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
    );

    const fkDeps = await cb.querySource<{
      child: string;
      parent: string;
    }>(
      `SELECT tc.table_name AS child, ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
       WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY' AND tc.table_name != ccu.table_name`,
    );
    const tableNames = tablesRes.rows.map((r) => r.table_name);
    const deps = new Map<string, Set<string>>();
    for (const t of tableNames) deps.set(t, new Set());
    for (const fk of fkDeps.rows) {
      if (deps.has(fk.child) && deps.has(fk.parent))
        deps.get(fk.child)?.add(fk.parent);
    }
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        sorted.push(name);
        visited.add(name);
        return;
      }
      visiting.add(name);
      for (const dep of deps.get(name) ?? []) visit(dep);
      visiting.delete(name);
      visited.add(name);
      sorted.push(name);
    };
    for (const t of tableNames) visit(t);

    if (!opts.dryRun)
      await cb
        .executeOnTarget("SET session_replication_role = 'replica'")
        .catch(() => {});

    for (const tn of sorted) {
      const dataRes = await cb.querySource(`SELECT * FROM "${tn}"`);
      if (dataRes.rows.length === 0) continue;
      const cols = Object.keys(
        dataRes.rows[0] as Record<string, unknown>,
      );
      const colList = cols.map((c) => `"${c}"`).join(", ");
      const batchSize = 100;
      for (let i = 0; i < dataRes.rows.length; i += batchSize) {
        const batch = dataRes.rows.slice(i, i + batchSize) as Record<
          string,
          unknown
        >[];
        const valueSets: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;
        for (const row of batch) {
          const placeholders = cols.map(() => {
            const ph = `$${paramIdx}`;
            paramIdx++;
            return ph;
          });
          valueSets.push(`(${placeholders.join(", ")})`);
          for (const c of cols) {
            const v = row[c];
            params.push(
              v !== null &&
                typeof v === "object" &&
                !Array.isArray(v) &&
                !(v instanceof Date)
                ? JSON.stringify(v)
                : v,
            );
          }
        }
        if (!opts.dryRun) {
          await cb.executeOnTarget(
            `INSERT INTO "${tn}" (${colList}) VALUES ${valueSets.join(", ")} ON CONFLICT DO NOTHING`,
            params,
          );
        }
        result.data.rows += batch.length;
      }
      result.data.tables++;
    }

    if (!opts.dryRun)
      await cb
        .executeOnTarget("SET session_replication_role = 'origin'")
        .catch(() => {});

    for (const tn of sorted) {
      if (opts.dryRun) continue;
      const seqCols = await cb
        .executeOnTarget<{
          attname: string;
          seq: string;
        }>(
          `SELECT a.attname, pg_get_serial_sequence($1, a.attname) AS seq
           FROM pg_attribute a
           JOIN pg_class c ON a.attrelid = c.oid
           JOIN pg_namespace n ON c.relnamespace = n.oid
           WHERE n.nspname = 'public' AND c.relname = $2
             AND a.attnum > 0 AND NOT a.attisdropped
             AND pg_get_serial_sequence($1, a.attname) IS NOT NULL`,
          [`"${tn}"`, tn],
        )
        .catch(
          () =>
            ({ rows: [] }) as {
              rows: { attname: string; seq: string }[];
            },
        );
      for (const { attname, seq } of seqCols.rows) {
        await cb
          .executeOnTarget(
            `SELECT setval('${seq}', COALESCE((SELECT MAX("${attname}") FROM "${tn}"), 1), (SELECT MAX("${attname}") FROM "${tn}") IS NOT NULL)`,
          )
          .catch(() => {});
      }
    }
  }

  if (!opts.skipStorage) {
    const bucketsRes = await cb.querySource<{
      id: string;
      name: string;
      public: boolean;
      file_size_limit: number | null;
      allowed_mime_types: string[] | null;
    }>(
      "SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets",
    );

    for (const bucket of bucketsRes.rows) {
      if (!opts.dryRun) {
        await cb.executeOnTarget(
          `INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
           VALUES($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name, public = EXCLUDED.public,
             file_size_limit = EXCLUDED.file_size_limit,
             allowed_mime_types = EXCLUDED.allowed_mime_types,
             updated_at = now()`,
          [
            bucket.id,
            bucket.name,
            bucket.public,
            bucket.file_size_limit,
            bucket.allowed_mime_types,
          ],
        );
      }
      result.storage.buckets++;
    }

    if (cb.downloadObject && cb.uploadObject) {
      const objectsRes = await cb.querySource<{
        id: string;
        bucket_id: string;
        name: string;
        metadata: Record<string, unknown> | null;
      }>(
        "SELECT id, bucket_id, name, metadata FROM storage.objects ORDER BY bucket_id, name",
      );

      for (const obj of objectsRes.rows) {
        const dl = await cb.downloadObject(obj.bucket_id, obj.name);
        if (!dl) continue;
        if (!opts.dryRun) {
          const uploaded = await cb.uploadObject(
            obj.bucket_id,
            obj.name,
            dl.data,
            dl.contentType,
          );
          if (!uploaded) continue;
        }
        result.storage.objects++;
      }
    }
  }

  return result;
}

export async function cmdLocalToService(
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const json = args.includes("--json");
  const token = getAdminToken(args);
  if (!token)
    return fail(
      "missing_admin_token",
      "--admin-token or NANO_ADMIN_TOKEN is required",
      json,
    );
  const positional = args.filter((a) => !a.startsWith("--"));
  const slug = positional[0];
  if (!slug)
    return fail(
      "missing_slug",
      "Usage: service local-to-service <slug> --data-dir=<path>",
      json,
    );

  const dataDir = getArgValue(args, "--data-dir");
  if (!dataDir)
    return fail(
      "missing_data_dir",
      "Provide --data-dir pointing to the local PGlite data directory",
      json,
    );

  const serviceUrl = getServiceUrl(args);

  const pidFile = `/tmp/nano-supabase-${DEFAULT_HTTP_PORT}.pid`;
  try {
    const { readFile: readFileFn } = await import("node:fs/promises");
    const pidStr = await readFileFn(pidFile, "utf8").catch(() => "");
    if (pidStr) {
      const pid = parseInt(pidStr, 10);
      if (!Number.isNaN(pid)) {
        try {
          process.kill(pid, 0);
          return fail(
            "local_instance_running",
            `A local nano-supabase instance is running (pid ${pid}). Stop it first with 'npx nano-supabase stop' to avoid data corruption.`,
            json,
          );
        } catch {}
      }
    }
  } catch {}

  const { createPGlite: createPGliteFn } = await import(
    "./pglite-factory.ts"
  );
  const db = createPGliteFn(dataDir);
  await db.waitReady;

  try {
    const createBody: Record<string, string> = { slug };
    const customToken = getArgValue(args, "--token");
    const password = getArgValue(args, "--password");
    const anonKey = getArgValue(args, "--anon-key");
    const serviceRoleKey = getArgValue(args, "--service-role-key");
    if (customToken) createBody.token = customToken;
    if (password) createBody.password = password;
    if (anonKey) createBody.anonKey = anonKey;
    if (serviceRoleKey) createBody.serviceRoleKey = serviceRoleKey;

    let tenantToken: string;
    const createRes = await serviceRequest<{
      token?: string;
      error?: string;
      message?: string;
    }>("POST", `${serviceUrl}/admin/tenants`, token, createBody);

    if (!createRes.ok) {
      if (
        createRes.status === 409 ||
        (createRes.data as { error?: string }).error === "slug_taken"
      ) {
        if (!args.includes("--force"))
          return fail(
            "tenant_exists",
            `Tenant "${slug}" already exists. Use --force to migrate into an existing tenant.`,
            json,
          );
        const infoRes = await serviceRequest<{
          token?: string;
          error?: string;
        }>("GET", `${serviceUrl}/admin/tenants/${slug}`, token);
        if (!infoRes.ok) return apiError(infoRes.data, json);
        tenantToken =
          customToken ??
          (infoRes.data as { token?: string }).token ??
          "";
      } else {
        return apiError(createRes.data, json);
      }
    } else {
      tenantToken = createRes.data.token ?? "";
    }

    const { join: joinPath } = await import("node:path");
    const storageDir = joinPath(dataDir, "storage");
    const { existsSync } = await import("node:fs");
    const hasStorageDir = existsSync(storageDir);

    const downloadObject = hasStorageDir
      ? async (
          bucketId: string,
          objectName: string,
        ): Promise<{
          data: ArrayBuffer;
          contentType: string;
        } | null> => {
          const { FileSystemStorageBackend } = await import(
            "./storage/fs-backend.ts"
          );
          const backend = new FileSystemStorageBackend(storageDir);
          const result = await backend.get(`${bucketId}/${objectName}`);
          if (!result) return null;
          return {
            data: result.data.buffer as ArrayBuffer,
            contentType: result.metadata.contentType,
          };
        }
      : undefined;

    const uploadObject = async (
      bucketId: string,
      objectName: string,
      data: ArrayBuffer,
      contentType: string,
    ): Promise<boolean> => {
      const res = await fetch(
        `${serviceUrl}/${slug}/storage/v1/object/${bucketId}/${objectName}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tenantToken}`,
            "Content-Type": contentType,
            "x-upsert": "true",
          },
          body: data,
        },
      );
      if (!res.ok) await res.arrayBuffer().catch(() => {});
      return res.ok;
    };

    const migrateResult = await migrateDatabase(
      {
        querySource: <T = Record<string, unknown>>(
          sql: string,
          params?: unknown[],
        ) => db.query<T>(sql, params),
        executeOnTarget: async <T = Record<string, unknown>>(
          sql: string,
          params?: unknown[],
        ) => {
          const res = await serviceRequest<{
            rows: T[];
            error?: string;
          }>(
            "POST",
            `${serviceUrl}/admin/tenants/${slug}/sql`,
            token,
            { sql, params },
          );
          if (!res.ok)
            throw new Error(
              (res.data as { error?: string }).error ?? "SQL execution failed",
            );
          return { rows: (res.data as { rows: T[] }).rows ?? [] };
        },
        downloadObject,
        uploadObject,
      },
      {
        skipSchema: args.includes("--no-schema"),
        skipAuth: args.includes("--no-auth"),
        skipData: args.includes("--no-data"),
        skipStorage: args.includes("--no-storage"),
        dryRun: args.includes("--dry-run"),
        migrationsDir: getArgValue(args, "--migrations-dir"),
      },
    );

    await db.close();

    if (json) return ok(migrateResult, json, "");
    const dryTag = args.includes("--dry-run") ? " (dry run)" : "";
    const r = migrateResult;
    const schemaExtra = [
      r.schema.views > 0 ? `${r.schema.views} view(s)` : "",
      r.schema.functions > 0 ? `${r.schema.functions} function(s)` : "",
      r.schema.triggers > 0 ? `${r.schema.triggers} trigger(s)` : "",
      r.schema.policies > 0 ? `${r.schema.policies} RLS policy(ies)` : "",
    ]
      .filter(Boolean)
      .join(", ");
    const lines = [
      `Migrated local "${dataDir}" → service tenant "${slug}"${dryTag}`,
      ``,
      `Schema:    ${r.schema.migrations} migration(s), ${r.schema.tables} table(s) introspected${schemaExtra ? `, ${schemaExtra}` : ""}`,
      `Auth:      ${r.auth.users} user(s), ${r.auth.identities} identity(ies)`,
      `Data:      ${r.data.rows} row(s) across ${r.data.tables} table(s)`,
      `Storage:   ${r.storage.buckets} bucket(s), ${r.storage.objects} object(s)`,
    ];
    return ok(migrateResult, json, lines.join("\n"));
  } catch (e: unknown) {
    await db.close().catch(() => {});
    return fail(
      "migrate_failed",
      e instanceof Error ? e.message : String(e),
      json,
    );
  }
}
