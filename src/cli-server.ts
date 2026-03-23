import { timingSafeEqual } from "node:crypto";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import {
	createSecureServer as createSecureHttp2Server,
	type Http2ServerRequest,
	type Http2ServerResponse,
} from "node:http2";
import type { Extension } from "@electric-sql/pglite";
import { pgDump } from "@electric-sql/pglite-tools/pg_dump";
import { printStartupInfo } from "./cli-display.ts";
import type { McpHandler } from "./mcp-server.ts";
import { createMcpHandler } from "./mcp-server.ts";
import type { NanoSupabaseInstance } from "./nano.ts";
import { nanoSupabase } from "./nano.ts";
import { PGliteTCPServer } from "./tcp-server.ts";

export async function runStartMode(opts: {
	wasmModule: WebAssembly.Module;
	fsBundle: Blob;
	postgrestWasm: Uint8Array;
	pgcryptoExt: Extension;
	uuidOsspExt: Extension;
	extraExtensions: Record<string, Extension>;
	subArgs: string[];
	httpPort: number;
	tcpPort: number;
	dataDir: string | undefined;
	serviceRoleKey: string;
	anonKey: string;
	debug: boolean;
	mcp: boolean;
	pidFile: string | undefined;
	count: number;
	tlsCert?: string;
	tlsKey?: string;
}): Promise<void> {
	const {
		wasmModule,
		fsBundle,
		postgrestWasm,
		pgcryptoExt,
		uuidOsspExt,
		extraExtensions,
		httpPort,
		tcpPort,
		dataDir,
		serviceRoleKey,
		anonKey,
		debug,
		mcp,
		pidFile,
		tlsCert,
		tlsKey,
	} = opts;

	let tlsBufs: { cert: Buffer; key: Buffer } | null = null;
	if (tlsCert && tlsKey) {
		const [cert, key] = await Promise.all([
			readFile(tlsCert),
			readFile(tlsKey),
		]);
		const keyStat = await stat(tlsKey);
		if (keyStat.mode & 0o077) {
			process.stderr.write(
				"WARNING: TLS key file is readable by group/others. Set permissions to 600.\n",
			);
		}
		tlsBufs = { cert, key };
	} else if (!tlsCert && !tlsKey) {
		process.stderr.write(
			"WARNING: TLS not configured. All credentials transmitted in cleartext. Do not expose to untrusted networks.\n",
		);
	}

	const origConsoleLog = console.log;
	console.log = () => {};
	let nano: Awaited<ReturnType<typeof nanoSupabase>>;
	let externalTcpServer: PGliteTCPServer | null = null;
	try {
		nano = await nanoSupabase({
			dataDir,
			tcp: tlsBufs ? false : { port: tcpPort, host: "0.0.0.0" },
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
		if (tlsBufs) {
			externalTcpServer = await PGliteTCPServer.create(
				nano.db,
				undefined,
				undefined,
				tlsBufs,
			);
			await externalTcpServer.start(tcpPort, "127.0.0.1");
		}
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

	function safeTokenEqual(a: string, b: string): boolean {
		if (a.length !== b.length) return false;
		return timingSafeEqual(Buffer.from(a), Buffer.from(b));
	}

	async function requireServiceRole(req: Request): Promise<Response | null> {
		const auth = req.headers.get("Authorization") ?? "";
		if (!safeTokenEqual(auth, `Bearer ${serviceRoleKey}`)) {
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

		const authError = await requireServiceRole(req);
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

		const authError = await requireServiceRole(req);
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
					.map((s) => `${s};`);
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
					{ name: "anon", api_key: anonKey, type: "legacy" },
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

		const securityChecks = [
			{
				query: `
          SELECT n.nspname AS schema, c.relname AS name
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_catalog.pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
          WHERE c.relkind = 'r'
            AND n.nspname = 'public'
            AND c.relrowsecurity = false
            AND d.objid IS NULL
          ORDER BY c.relname`,
				map: (row: { schema: string; name: string }) => ({
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
				}),
			},
			{
				query: `
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
          ORDER BY c.relname`,
				map: (row: { schema: string; name: string }) => ({
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
				}),
			},
			{
				query: `
          SELECT DISTINCT n.nspname AS schema, c.relname AS name
          FROM pg_catalog.pg_policy p
          JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_catalog.pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
          WHERE c.relrowsecurity = false
            AND n.nspname NOT IN (${EXCLUDED_SCHEMAS})
            AND d.objid IS NULL
          ORDER BY c.relname`,
				map: (row: { schema: string; name: string }) => ({
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
				}),
			},
			{
				query: `
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
          ORDER BY p.proname`,
				map: (row: { schema: string; name: string }) => ({
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
				}),
			},
		];

		const performanceChecks = [
			{
				query: `
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
          ORDER BY fk.table_name`,
				map: (row: { schema: string; table: string; fkey: string }) => ({
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
				}),
			},
			{
				query: `
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
          ORDER BY c.relname`,
				map: (row: { schema: string; name: string }) => ({
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
				}),
			},
			{
				query: `
          SELECT
            schemaname AS schema,
            tablename AS table,
            indexname AS index,
            min(indexname) OVER (PARTITION BY schemaname, tablename, replace(indexdef, indexname, '')) AS duplicate_of
          FROM pg_indexes
          WHERE schemaname NOT IN (${EXCLUDED_SCHEMAS})
            AND indexname != min(indexname) OVER (PARTITION BY schemaname, tablename, replace(indexdef, indexname, ''))
          ORDER BY tablename, indexname`,
				map: (row: {
					schema: string;
					table: string;
					index: string;
					duplicate_of: string;
				}) => ({
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
				}),
			},
			{
				query: `
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
          ORDER BY c.relname`,
				map: (row: { schema: string; table: string; command: string }) => ({
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
				}),
			},
		];

		const checks = type === "security" ? securityChecks : performanceChecks;
		for (const check of checks) {
			try {
				const rows = await nano.db.query(check.query);
				for (const row of rows.rows) results.push(check.map(row));
			} catch {}
		}

		return results;
	}

	const INTERNAL_URL = "http://localhost:54321";

	const mcpHandler: McpHandler | null = mcp
		? createMcpHandler(nano, {
				httpPort,
				serviceRoleKey,
				anonKey,
			})
		: null;

	const KNOWN_PREFIXES = ["/auth/v1/", "/rest/v1/", "/storage/v1/"];

	async function fetchHandler(req: Request): Promise<Response> {
		if (req.method === "OPTIONS") {
			return new Response(null, { status: 204 });
		}
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
		const CORS = {
			"access-control-allow-origin": "*",
			"access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
			"access-control-allow-headers": "*",
			"access-control-expose-headers": "*",
		};

		async function handleRequest(
			nodeReq: {
				url?: string;
				method?: string;
				headers: Record<string, string | string[] | undefined>;
			},
			nodeRes: {
				headersSent: boolean;
				writeHead: (s: number, h: Record<string, string>) => void;
				end: (b?: string | Buffer) => void;
			},
		) {
			const url = `http://localhost:${httpPort}${nodeReq.url}`;
			const hasBody = nodeReq.method !== "GET" && nodeReq.method !== "HEAD";
			const headers = new Headers();
			for (const [k, v] of Object.entries(nodeReq.headers)) {
				if (k.startsWith(":") || v === undefined) continue;
				headers.set(k, Array.isArray(v) ? v.join(", ") : v);
			}
			const req = new Request(url, {
				method: nodeReq.method,
				headers,
				body: hasBody ? (nodeReq as unknown as ReadableStream) : undefined,
				// @ts-expect-error — IncomingMessage is a readable stream accepted by Request
				duplex: "half",
			});
			try {
				const res = await handler(req);
				const resHeaders: Record<string, string> = { ...CORS };
				res.headers.forEach((v, k) => {
					resHeaders[k] = v;
				});
				nodeRes.writeHead(res.status, resHeaders);
				nodeRes.end(Buffer.from(await res.arrayBuffer()));
			} catch (_e) {
				if (!nodeRes.headersSent) {
					nodeRes.writeHead(500, {
						"Content-Type": "application/json",
						...CORS,
					});
					nodeRes.end(JSON.stringify({ error: "internal_error" }));
				}
			}
		}

		if (tlsBufs) {
			return createSecureHttp2Server(
				{
					cert: tlsBufs.cert,
					key: tlsBufs.key,
					allowHTTP1: true,
					minVersion: "TLSv1.2",
					maxVersion: "TLSv1.3",
					ciphers: [
						"TLS_AES_128_GCM_SHA256",
						"TLS_AES_256_GCM_SHA384",
						"TLS_CHACHA20_POLY1305_SHA256",
						"ECDHE-ECDSA-AES128-GCM-SHA256",
						"ECDHE-RSA-AES128-GCM-SHA256",
						"ECDHE-ECDSA-AES256-GCM-SHA384",
						"ECDHE-RSA-AES256-GCM-SHA384",
						"ECDHE-ECDSA-CHACHA20-POLY1305",
						"ECDHE-RSA-CHACHA20-POLY1305",
						"DHE-RSA-AES128-GCM-SHA256",
						"DHE-RSA-AES256-GCM-SHA384",
						"DHE-RSA-CHACHA20-POLY1305",
					].join(":"),
					honorCipherOrder: false,
				},
				(req: Http2ServerRequest, res: Http2ServerResponse) =>
					handleRequest(req, res),
			);
		}
		return createHttpServer((req, res) => handleRequest(req, res));
	}

	const server = createNodeServer(fetchHandler);
	server.listen(httpPort);

	const scheme = tlsBufs ? "https" : "http";
	const pgUrl = externalTcpServer
		? `postgresql://postgres@127.0.0.1:${tcpPort}/postgres?sslmode=require`
		: (nano.connectionString ??
			`postgresql://postgres@127.0.0.1:${tcpPort}/postgres`);

	printStartupInfo({
		httpPort,
		pgUrl,
		serviceRoleKey,
		anonKey,
		mcp,
		tls: !!tlsBufs,
		scheme,
	});

	function cleanup(): void {
		unlink(defaultPidFilePath).catch(() => {});
		if (pidFile) {
			unlink(pidFile).catch(() => {});
		}
	}

	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, async () => {
			server.close();
			await externalTcpServer?.stop();
			await nano.stop();
			cleanup();
			process.exit(0);
		});
	}
}
