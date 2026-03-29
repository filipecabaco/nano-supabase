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
		schema: { tables: number; migrations: number };
		auth: { users: number; identities: number };
		data: { tables: number; rows: number };
		storage: { buckets: number; objects: number };
	};

	if (json) return ok(r, json, "");
	const dryTag = args.includes("--dry-run") ? " (dry run)" : "";
	const lines = [
		`Migrate tenant "${slug}" → ${remoteDbUrl}${dryTag}`,
		``,
		`Schema:    ${r.schema.migrations} migration(s), ${r.schema.tables} table(s) introspected`,
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
