import { timingSafeEqual } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import type { Extension } from "@electric-sql/pglite";
import type { McpHandler } from "./mcp-server.ts";
import { createMcpHandler } from "./mcp-server.ts";
import type { NanoSupabaseInstance } from "./nano.ts";
import { nanoSupabase } from "./nano.ts";
import { PostgrestParser } from "./postgrest-parser.ts";

export async function runServiceMode(opts: {
	pgliteWasmModule: WebAssembly.Module;
	fsBundle: Blob;
	postgrestWasm: Uint8Array;
	pgcryptoExt: Extension;
	uuidOsspExt: Extension;
	subArgs: string[];
	parsePort: (
		raw: string | undefined,
		fallback: number,
		name: string,
	) => number;
	getArgValue: (args: string[], flag: string) => string | undefined;
	DEFAULT_SERVICE_ROLE_KEY: string;
	DEFAULT_ANON_KEY: string;
	pgliteDist: string;
	mcp?: boolean;
}): Promise<void> {
	process.on("unhandledRejection", (err) => {
		process.stderr.write(
			`${JSON.stringify({
				ts: new Date().toISOString(),
				event: "unhandled_rejection",
				error: err instanceof Error ? err.message : String(err),
			})}\n`,
		);
	});

	const {
		pgliteWasmModule,
		fsBundle,
		postgrestWasm,
		pgcryptoExt,
		uuidOsspExt,
		subArgs,
		parsePort,
		getArgValue,
		DEFAULT_SERVICE_ROLE_KEY,
		DEFAULT_ANON_KEY,
		pgliteDist,
		mcp = false,
	} = opts;

	const { AwsClient } = await import("aws4fetch");
	const { mkdir, rm, mkdtemp } = await import("node:fs/promises");
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const execFileAsync = promisify(execFile);

	function randomBase62(bytes = 18): string {
		const chars =
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
		return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
			.map((b) => chars[b % chars.length])
			.join("");
	}
	const generatePublishableKey = () => `sb_publishable_${randomBase62()}`;
	const generateSecretKey = () => `sb_secret_${randomBase62()}`;

	const servicePort = parsePort(
		getArgValue(subArgs, "--service-port"),
		8080,
		"--service-port",
	);
	const tcpMuxPort = parsePort(
		getArgValue(subArgs, "--tcp-port"),
		5432,
		"--tcp-port",
	);
	const serviceRoleKey =
		getArgValue(subArgs, "--service-role-key") ?? DEFAULT_SERVICE_ROLE_KEY;
	const adminToken = getArgValue(subArgs, "--admin-token");
	if (!adminToken) {
		process.stderr.write(
			`${JSON.stringify({
				error: "missing_admin_token",
				message: "--admin-token is required for service mode",
			})}\n`,
		);
		process.exit(1);
	}
	const serviceBaseDataDir =
		getArgValue(subArgs, "--data-dir") ?? "/tmp/nano-service-data";
	const coldDir =
		getArgValue(subArgs, "--cold-dir") ?? "/tmp/nano-service-cold";
	const s3Bucket = getArgValue(subArgs, "--s3-bucket");
	const s3Endpoint = getArgValue(subArgs, "--s3-endpoint");
	const storageBackendType =
		getArgValue(subArgs, "--storage-backend") ?? (s3Bucket ? "s3" : "fs");
	const s3StoragePrefix = getArgValue(subArgs, "--s3-prefix");
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
	const circuitBreakerThreshold = (() => {
		const raw = getArgValue(subArgs, "--circuit-breaker-threshold");
		if (!raw) return 10;
		const n = parseInt(raw, 10);
		if (!Number.isInteger(n) || n < 1) {
			process.stderr.write(
				`Invalid --circuit-breaker-threshold: "${raw}" (must be >= 1)\n`,
			);
			process.exit(1);
		}
		return n;
	})();

	const tlsCertPath =
		getArgValue(subArgs, "--tls-cert") ?? process.env.NANO_TLS_CERT;
	const tlsKeyPath =
		getArgValue(subArgs, "--tls-key") ?? process.env.NANO_TLS_KEY;
	if ((tlsCertPath && !tlsKeyPath) || (!tlsCertPath && tlsKeyPath)) {
		process.stderr.write(
			`${JSON.stringify({
				error: "invalid_tls_config",
				message: "--tls-cert and --tls-key must both be provided together",
			})}\n`,
		);
		process.exit(1);
	}
	const allowInsecure = subArgs.includes("--allow-insecure");
	if (!tlsCertPath && !allowInsecure) {
		process.stderr.write(
			"WARNING: TLS not configured. All credentials transmitted in cleartext. Use --allow-insecure to suppress this warning.\n",
		);
	}
	let tlsBufs: { cert: Buffer; key: Buffer } | null = null;
	if (tlsCertPath && tlsKeyPath) {
		const [cert, key] = await Promise.all([
			readFile(tlsCertPath),
			readFile(tlsKeyPath),
		]);
		const keyStat = await stat(tlsKeyPath);
		if (keyStat.mode & 0o077) {
			process.stderr.write(
				"WARNING: TLS key file is readable by group/others. Set permissions to 600.\n",
			);
		}
		tlsBufs = { cert, key };
	}

	const secret = getArgValue(subArgs, "--secret") ?? process.env.NANO_SECRET;
	if (!secret) {
		process.stderr.write(
			`${JSON.stringify({
				error: "missing_secret",
				message: "--secret (or NANO_SECRET) is required for service mode",
			})}\n`,
		);
		process.exit(1);
	}

	let cachedKey: CryptoKey | null = null;
	async function getKey(): Promise<CryptoKey> {
		if (!cachedKey) {
			const enc = new TextEncoder();
			const keyMaterial = await crypto.subtle.importKey(
				"raw",
				enc.encode(secret),
				"PBKDF2",
				false,
				["deriveKey"],
			);
			cachedKey = await crypto.subtle.deriveKey(
				{
					name: "PBKDF2",
					salt: enc.encode("nano-supabase-v1"),
					iterations: 100000,
					hash: "SHA-256",
				},
				keyMaterial,
				{ name: "AES-GCM", length: 256 },
				false,
				["encrypt", "decrypt"],
			);
		}
		return cachedKey;
	}

	async function encryptPassword(password: string): Promise<string> {
		const key = await getKey();
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const enc = new TextEncoder();
		const ciphertext = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv },
			key,
			enc.encode(password),
		);
		const ivB64 = Buffer.from(iv).toString("base64");
		const ctB64 = Buffer.from(ciphertext).toString("base64");
		return `${ivB64}:${ctB64}`;
	}

	async function decryptPassword(encrypted: string): Promise<string> {
		const key = await getKey();
		const [ivB64, ctB64] = encrypted.split(":");
		const iv = Buffer.from(ivB64, "base64");
		const ciphertext = Buffer.from(ctB64, "base64");
		const plain = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv },
			key,
			ciphertext,
		);
		return new TextDecoder().decode(plain);
	}

	const registryDbUrl =
		getArgValue(subArgs, "--registry-db-url") ??
		process.env.NANO_REGISTRY_DB_URL;
	await mkdir(serviceBaseDataDir, { recursive: true });
	await mkdir(coldDir, { recursive: true });

	interface RegistryBackend {
		query<T extends Record<string, unknown>>(
			sql: string,
			params?: unknown[],
		): Promise<{ rows: T[] }>;
		exec(sql: string): Promise<void>;
		close(): Promise<void>;
	}

	let registry: RegistryBackend;

	if (registryDbUrl) {
		const { Pool } = await import("pg");
		const pgPool = new Pool({ connectionString: registryDbUrl });
		registry = {
			query: async <T extends Record<string, unknown>>(
				sql: string,
				params?: unknown[],
			) => {
				const result = await pgPool.query(sql, params);
				return { rows: result.rows as T[] };
			},
			exec: async (sql: string) => {
				await pgPool.query(sql);
			},
			close: async () => pgPool.end(),
		};
		const { runner } = await import("node-pg-migrate");
		await runner({
			databaseUrl: registryDbUrl,
			migrationsTable: "service_migrations",
			dir: join(pgliteDist, "service-migrations"),
			direction: "up",
			count: Infinity,
			log: () => {},
		});
	} else {
		const registryDir = join(serviceBaseDataDir, ".registry");
		await mkdir(registryDir, { recursive: true });
		const { PGlite } = await import("@electric-sql/pglite");
		const registryDb = new PGlite(registryDir, {
			pgliteWasmModule,
			fsBundle,
		});
		await registryDb.waitReady;
		await registryDb.exec(`
			CREATE TABLE IF NOT EXISTS service_migrations (
				id SERIAL PRIMARY KEY,
				name TEXT UNIQUE NOT NULL,
				run_on TIMESTAMPTZ NOT NULL DEFAULT now()
			);
			CREATE TABLE IF NOT EXISTS tenants (
				id TEXT PRIMARY KEY,
				slug TEXT UNIQUE NOT NULL,
				data_dir TEXT NOT NULL,
				token_hash TEXT NOT NULL,
				state TEXT NOT NULL DEFAULT 'sleeping',
				last_active TIMESTAMPTZ NOT NULL DEFAULT now(),
				tcp_port INTEGER,
				anon_key TEXT NOT NULL DEFAULT 'local-anon-key',
				service_role_key TEXT NOT NULL DEFAULT 'local-service-role-key',
				encrypted_password TEXT
			);
		`);
		registry = {
			query: async <T extends Record<string, unknown>>(
				sql: string,
				params?: unknown[],
			) => {
				const result = await registryDb.query<T>(sql, params as unknown[]);
				return { rows: result.rows };
			},
			exec: async (sql: string) => {
				await registryDb.exec(sql);
			},
			close: async () => {
				await registryDb.close();
			},
		};
	}

	const s3Region = process.env.AWS_REGION ?? "us-east-1";
	const s3BaseUrl = s3Bucket
		? s3Endpoint
			? `${s3Endpoint.replace(/\/$/, "")}/${s3Bucket}`
			: `https://${s3Bucket}.s3.${s3Region}.amazonaws.com`
		: null;
	const s3Client = s3Bucket
		? new AwsClient({
				accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
				secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
				region: s3Region,
				service: "s3",
			})
		: null;

	function log(event: string, meta: Record<string, unknown> = {}): void {
		process.stdout.write(
			`${JSON.stringify({ ts: new Date().toISOString(), event, ...meta })}\n`,
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
		if (s3Bucket && s3Client && s3BaseUrl) {
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
			const resp = await s3Client.fetch(
				`${s3BaseUrl}/tenants/${tenantId}/data.tar.gz`,
				{
					method: "PUT",
					body: archiveData,
					headers: { "Content-Type": "application/gzip" },
				},
			);
			if (!resp.ok) {
				throw new Error(`S3 offload PUT failed: ${resp.status}`);
			}
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
		if (s3Bucket && s3Client && s3BaseUrl) {
			const tmpDir = await mkdtemp("/tmp/nano-pull-");
			const archivePath = join(tmpDir, "data.tar.gz");
			const resp = await s3Client.fetch(
				`${s3BaseUrl}/tenants/${tenantId}/data.tar.gz`,
			);
			if (!resp.ok) {
				throw new Error(`S3 pull GET failed: ${resp.status}`);
			}
			const data = new Uint8Array(await resp.arrayBuffer());
			await writeFile(archivePath, data);
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
		encryptedPassword: string | null;
		state: TenantState;
		lastActive: Date;
		nano: NanoSupabaseInstance | null;
		usage: TenantUsage;
		anonKey: string;
		serviceRoleKey: string;
	}

	const usageMap = new Map<string, TenantUsage>();

	function getUsage(id: string): TenantUsage {
		const existing = usageMap.get(id);
		if (existing) return existing;
		const usage: TenantUsage = {
			requests: 0,
			errors: 0,
			totalLatencyMs: 0,
			lastLatencyMs: 0,
			bytesIn: 0,
			bytesOut: 0,
		};
		usageMap.set(id, usage);
		return usage;
	}

	const consecutiveErrors = new Map<string, number>();
	await PostgrestParser.init(postgrestWasm);
	const sharedParser = new PostgrestParser();
	const nanoInstances = new Map<string, NanoSupabaseInstance | null>();
	const tenantPoolers = new Map<string, import("./pooler.ts").PGlitePooler>();
	const tenantMcpHandlers = new Map<string, McpHandler>();
	const wakingPromises = new Map<string, Promise<void>>();
	const tenantCache = new Map<string, TenantEntry>();
	const dirtyLastActive = new Set<string>();
	const { PGlitePooler } = await import("./pooler.ts");
	const { PGliteTCPMuxServer } = await import("./tcp-server.ts");

	interface DbTenantRow {
		id: string;
		slug: string;
		data_dir: string;
		token_hash: string;
		encrypted_password: string | null;
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
		const existing = tenantCache.get(row.slug);
		if (existing) {
			existing.state = row.state as TenantState;
			existing.tokenHash = row.token_hash;
			existing.encryptedPassword = row.encrypted_password ?? null;
			existing.lastActive = new Date(row.last_active);
			existing.nano = nanoInstances.get(row.id) ?? null;
			return existing;
		}
		const entry: TenantEntry = {
			id: row.id,
			slug: row.slug,
			dataDir: row.data_dir,
			tokenHash: row.token_hash,
			encryptedPassword: row.encrypted_password ?? null,
			state: row.state as TenantState,
			lastActive: new Date(row.last_active),
			nano: nanoInstances.get(row.id) ?? null,
			usage: getUsage(row.id),
			anonKey: row.anon_key ?? DEFAULT_ANON_KEY,
			serviceRoleKey: row.service_role_key ?? serviceRoleKey,
		};
		tenantCache.set(row.slug, entry);
		return entry;
	}

	function getTenant(slug: string): TenantEntry | undefined {
		return tenantCache.get(slug);
	}

	async function listTenants(): Promise<TenantEntry[]> {
		return Array.from(tenantCache.values()).sort((a, b) =>
			a.slug.localeCompare(b.slug),
		);
	}

	async function createTenantRecord(entry: TenantEntry): Promise<void> {
		await registry.query(
			"INSERT INTO tenants (id, slug, data_dir, token_hash, encrypted_password, state, last_active, anon_key, service_role_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
			[
				entry.id,
				entry.slug,
				entry.dataDir,
				entry.tokenHash,
				entry.encryptedPassword,
				entry.state,
				entry.lastActive.toISOString(),
				entry.anonKey,
				entry.serviceRoleKey,
			],
		);
		tenantCache.set(entry.slug, entry);
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

	function markLastActive(id: string): void {
		dirtyLastActive.add(id);
	}

	async function flushLastActive(): Promise<void> {
		if (dirtyLastActive.size === 0) return;
		const ids = Array.from(dirtyLastActive);
		dirtyLastActive.clear();
		await registry.query(
			`UPDATE tenants SET last_active = now() WHERE id = ANY($1::text[])`,
			[ids],
		);
	}

	async function deleteTenantRecord(id: string, slug: string): Promise<void> {
		await registry.query("DELETE FROM tenants WHERE id = $1", [id]);
		tenantCache.delete(slug);
		dirtyLastActive.delete(id);
	}

	async function updateTokenHash(
		id: string,
		slug: string,
		hash: string,
	): Promise<void> {
		await registry.query("UPDATE tenants SET token_hash = $1 WHERE id = $2", [
			hash,
			id,
		]);
		const cached = tenantCache.get(slug);
		if (cached) cached.tokenHash = hash;
	}

	const adminTokenHash = await hashToken(adminToken ?? "");

	const existingRows = await registry.query<DbTenantRow>(
		"SELECT * FROM tenants",
	);
	for (const row of existingRows.rows) {
		nanoInstances.set(row.id, null);
		if (row.state !== "sleeping") {
			await registry.query(
				"UPDATE tenants SET state = 'sleeping' WHERE id = $1",
				[row.id],
			);
			row.state = "sleeping";
		}
		rowToEntry(row);
	}

	async function createTenantStorageBackend(
		tenant: TenantEntry,
	): Promise<import("./storage/backend.ts").StorageBackend | undefined> {
		if (storageBackendType === "s3" && s3Bucket) {
			const { S3StorageBackend } = await import("./storage/s3-backend.ts");
			return new S3StorageBackend({
				bucket: s3Bucket,
				endpoint: s3Endpoint,
				prefix: s3StoragePrefix ?? `tenants/${tenant.id}/storage/`,
			});
		}
		if (storageBackendType === "fs") {
			const { FileSystemStorageBackend } = await import(
				"./storage/fs-backend.ts"
			);
			return new FileSystemStorageBackend(join(tenant.dataDir, "storage"));
		}
		return undefined;
	}

	async function startTenantNano(tenant: TenantEntry): Promise<void> {
		log("tenant.nano_initializing", {
			tenant_id: tenant.id,
			slug: tenant.slug,
		});
		const tenantStorageBackend = await createTenantStorageBackend(tenant);
		const nanoInstance = await nanoSupabase({
			dataDir: tenant.dataDir,
			pgliteWasmModule,
			fsBundle,
			postgrestWasmBytes: postgrestWasm,
			parser: sharedParser,
			extensions: {
				pgcrypto: pgcryptoExt,
				uuid_ossp: uuidOsspExt,
			},
			storageBackend: tenantStorageBackend,
		});
		log("tenant.pooler_creating", { tenant_id: tenant.id, slug: tenant.slug });
		nanoInstances.set(tenant.id, nanoInstance);
		tenant.nano = nanoInstance;
		const pooler = await PGlitePooler.create(nanoInstance.db);
		tenantPoolers.set(tenant.id, pooler);
		tenant.lastActive = new Date();
		markLastActive(tenant.id);
		await updateTenantState(tenant.id, "running");
		tenant.state = "running";
		log("tenant.started", {
			tenant_id: tenant.id,
			slug: tenant.slug,
			data_dir: tenant.dataDir,
		});
	}

	async function pauseTenant(tenant: TenantEntry): Promise<void> {
		if (tenant.state !== "running") return;
		consecutiveErrors.delete(tenant.id);
		log("tenant.pausing", {
			tenant_id: tenant.id,
			slug: tenant.slug,
			offloader: s3Bucket ? "s3" : "disk",
		});
		await updateTenantState(tenant.id, "pausing");
		tenant.state = "pausing";
		const pooler = tenantPoolers.get(tenant.id);
		if (pooler) {
			await pooler.stop();
			tenantPoolers.delete(tenant.id);
		}
		const inst = nanoInstances.get(tenant.id);
		if (inst && typeof inst[Symbol.asyncDispose] === "function") {
			await inst[Symbol.asyncDispose]().catch(() => {});
		}
		nanoInstances.set(tenant.id, null);
		tenantMcpHandlers.delete(tenant.id);
		tenant.nano = null;
		try {
			await offloadTenant(tenant.dataDir, tenant.id);
			await updateTenantState(tenant.id, "sleeping");
			tenant.state = "sleeping";
			log("tenant.sleeping", { tenant_id: tenant.id, slug: tenant.slug });
		} catch (e) {
			await updateTenantState(tenant.id, "running");
			tenant.state = "running";
			throw e;
		}
	}

	async function wakeTenant(tenant: TenantEntry): Promise<void> {
		if (tenant.state !== "sleeping") return;
		consecutiveErrors.delete(tenant.id);
		const { access: statAccess } = await import("node:fs/promises");
		const hasLocalData = await statAccess(tenant.dataDir)
			.then(() => true)
			.catch(() => false);
		const offloader = hasLocalData ? "none (local)" : s3Bucket ? "s3" : "disk";
		log("tenant.waking", {
			tenant_id: tenant.id,
			slug: tenant.slug,
			data_dir: tenant.dataDir,
			offloader,
		});
		await updateTenantState(tenant.id, "waking");
		tenant.state = "waking";
		try {
			if (!hasLocalData) {
				log("tenant.pull_started", {
					tenant_id: tenant.id,
					slug: tenant.slug,
					offloader,
				});
				await pullTenant(tenant.dataDir, tenant.id);
				log("tenant.pull_done", { tenant_id: tenant.id, slug: tenant.slug });
			}
			await startTenantNano(tenant);
		} catch (e) {
			log("tenant.wake_failed", {
				tenant_id: tenant.id,
				slug: tenant.slug,
				error: e instanceof Error ? e.message : String(e),
			});
			await updateTenantState(tenant.id, "sleeping");
			tenant.state = "sleeping";
			throw e;
		}
	}

	function tenantPublic(t: TenantEntry) {
		const u = t.usage;
		return {
			id: t.id,
			slug: t.slug,
			state: t.state,
			lastActive: t.lastActive.toISOString(),
			tcpPort: tcpMuxPort,
			pgUrl: `postgresql://${t.slug}:<password>@localhost:${tcpMuxPort}/postgres`,
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
		if (
			hash.length !== adminTokenHash.length ||
			!timingSafeEqual(Buffer.from(hash), Buffer.from(adminTokenHash))
		) {
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

	const CORS = {
		"access-control-allow-origin": "*",
		"access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
		"access-control-allow-headers": "*",
		"access-control-expose-headers": "*",
	};

	async function serviceHandler(req: Request): Promise<Response> {
		const url = new URL(req.url);
		const json = { "Content-Type": "application/json" };

		if (req.method === "OPTIONS") {
			return new Response(null, { status: 204 });
		}

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
				const body = (await req.json()) as {
					slug: string;
					token?: string;
					password?: string;
					anonKey?: string;
					serviceRoleKey?: string;
				};
				const { slug } = body;
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
				const plainToken = body.token ?? crypto.randomUUID();
				const tokenHash = await hashToken(plainToken);
				const plainPassword =
					body.password ??
					Array.from(crypto.getRandomValues(new Uint8Array(18)))
						.map((b) => b.toString(16).padStart(2, "0"))
						.join("");
				const encryptedPassword = await encryptPassword(plainPassword);
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
				const tenant: TenantEntry = {
					id,
					slug,
					dataDir: tenantDataDir,
					tokenHash,
					encryptedPassword,
					state: "sleeping",
					lastActive: new Date(),
					nano: null,
					usage: getUsage(id),
					anonKey: body.anonKey ?? generatePublishableKey(),
					serviceRoleKey: body.serviceRoleKey ?? generateSecretKey(),
				};
				nanoInstances.set(id, null);
				await createTenantRecord(tenant);
				log("tenant.created", { tenant_id: id, slug, data_dir: tenantDataDir });
				await startTenantNano(tenant);
				return new Response(
					JSON.stringify({
						token: plainToken,
						password: plainPassword,
						tenant: tenantPublic(tenant),
					}),
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
					if (tenant.state === "running") {
						const pooler = tenantPoolers.get(tenant.id);
						if (pooler) {
							await pooler.stop().catch(() => {});
							tenantPoolers.delete(tenant.id);
						}
						const inst = nanoInstances.get(tenant.id);
						if (inst && typeof inst[Symbol.asyncDispose] === "function") {
							await inst[Symbol.asyncDispose]().catch(() => {});
						}
					}
					nanoInstances.delete(tenant.id);
					consecutiveErrors.delete(tenant.id);
					usageMap.delete(tenant.id);
					tenantCache.delete(tenant.id);
					tenantMcpHandlers.delete(tenant.id);
					try {
						await rm(tenant.dataDir, { recursive: true, force: true });
					} catch {}
					try {
						if (!s3Bucket || !s3BaseUrl) {
							await rm(join(coldDir, `${tenant.id}.tar.gz`), { force: true });
						}
					} catch {}
					await deleteTenantRecord(tenant.id, tenant.slug);
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
					await updateTokenHash(tenant.id, tenant.slug, newHash);
					return new Response(JSON.stringify({ token: plainToken }), {
						headers: json,
					});
				}

				if (subpath === "/reset-password" && req.method === "POST") {
					const body = (await req.json().catch(() => ({}))) as {
						password?: string;
					};
					const plainPassword =
						body.password ??
						Array.from(crypto.getRandomValues(new Uint8Array(18)))
							.map((b) => b.toString(16).padStart(2, "0"))
							.join("");
					const encryptedPassword = await encryptPassword(plainPassword);
					await registry.query(
						"UPDATE tenants SET encrypted_password = $1 WHERE id = $2",
						[encryptedPassword, tenant.id],
					);
					tenant.encryptedPassword = encryptedPassword;
					return new Response(JSON.stringify({ password: plainPassword }), {
						headers: json,
					});
				}

				if (subpath === "/sql" && req.method === "POST") {
					if (tenant.state === "sleeping" || tenant.state === "waking") {
						if (!wakingPromises.has(tenant.id)) {
							const p = wakeTenant(tenant).finally(() =>
								wakingPromises.delete(tenant.id),
							);
							wakingPromises.set(tenant.id, p);
						}
						await wakingPromises.get(tenant.id);
					}
					const nano = nanoInstances.get(tenant.id);
					if (!nano)
						return new Response(JSON.stringify({ error: "nano_unavailable" }), {
							status: 503,
							headers: json,
						});
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

				if (subpath === "/migrate" && req.method === "POST") {
					if (tenant.state === "sleeping" || tenant.state === "waking") {
						if (!wakingPromises.has(tenant.id)) {
							const p = wakeTenant(tenant).finally(() =>
								wakingPromises.delete(tenant.id),
							);
							wakingPromises.set(tenant.id, p);
						}
						await wakingPromises.get(tenant.id);
					}
					const nano = nanoInstances.get(tenant.id);
					if (!nano)
						return new Response(JSON.stringify({ error: "nano_unavailable" }), {
							status: 503,
							headers: json,
						});

					const body = (await req.json()) as {
						remoteDbUrl: string;
						remoteUrl?: string;
						remoteServiceRoleKey?: string;
						skipSchema?: boolean;
						skipAuth?: boolean;
						skipData?: boolean;
						skipStorage?: boolean;
						dryRun?: boolean;
						migrationsDir?: string;
					};

					if (!body.remoteDbUrl) {
						return new Response(
							JSON.stringify({
								error: "missing_remote_db_url",
								message: "remoteDbUrl is required",
							}),
							{ status: 400, headers: json },
						);
					}

					const result = {
						schema: { tables: 0, migrations: 0 },
						auth: { users: 0, identities: 0 },
						data: { tables: 0, rows: 0 },
						storage: { buckets: 0, objects: 0 },
					};

					const pg = await import("pg");
					const remote = new pg.default.Client({
						connectionString: body.remoteDbUrl,
					});

					try {
						await remote.connect();
						await remote.query("SET search_path = public");

						if (!body.skipSchema) {
							const { existsSync, readdirSync } = await import("node:fs");
							const { readFile: readFileFn } = await import("node:fs/promises");
							const migDir = body.migrationsDir ?? "./supabase/migrations";
							const migPattern = /^(\d+)_.*\.sql$/;

							let usedMigrationFiles = false;
							if (existsSync(migDir)) {
								const files = readdirSync(migDir)
									.filter((f: string) => migPattern.test(f))
									.sort();
								if (files.length > 0) {
									usedMigrationFiles = true;
									await remote
										.query("CREATE SCHEMA IF NOT EXISTS supabase_migrations")
										.catch(() => {});
									await remote
										.query(
											`CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version TEXT PRIMARY KEY, statements TEXT[], name TEXT)`,
										)
										.catch(() => {});
									const appliedRes = await remote
										.query<{ version: string }>(
											"SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
										)
										.catch(
											() => ({ rows: [] }) as { rows: { version: string }[] },
										);
									const applied = new Set(
										appliedRes.rows.map((r) => r.version),
									);
									for (const file of files) {
										const match = file.match(migPattern) ?? [];
										const version = match[1] ?? "";
										const name = file
											.replace(/\.sql$/, "")
											.slice(version.length + 1);
										if (applied.has(version)) continue;
										const sql = await readFileFn(join(migDir, file), "utf8");
										const statements = sql
											.split(";")
											.map((s: string) => s.trim())
											.filter(Boolean);
										if (!body.dryRun) {
											for (const stmt of statements) await remote.query(stmt);
											await remote.query(
												"INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES($1, $2, $3)",
												[version, name, statements],
											);
										}
										result.schema.migrations++;
									}
								}
							}

							if (!usedMigrationFiles) {
								const hasMigTable = await nano.db
									.query<{ exists: boolean }>(
										`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations') AS exists`,
									)
									.then((r) => r.rows[0]?.exists ?? false)
									.catch(() => false);
								if (hasMigTable) {
									const migRows = await nano.db.query<{
										version: string;
										name: string | null;
										statements: string[] | null;
									}>(
										"SELECT version, name, statements FROM supabase_migrations.schema_migrations ORDER BY version",
									);
									if (migRows.rows.length > 0) {
										usedMigrationFiles = true;
										await remote
											.query("CREATE SCHEMA IF NOT EXISTS supabase_migrations")
											.catch(() => {});
										await remote
											.query(
												`CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version TEXT PRIMARY KEY, statements TEXT[], name TEXT)`,
											)
											.catch(() => {});
										const appliedRes = await remote
											.query<{ version: string }>(
												"SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
											)
											.catch(
												() =>
													({
														rows: [],
													}) as { rows: { version: string }[] },
											);
										const applied = new Set(
											appliedRes.rows.map((r) => r.version),
										);
										for (const row of migRows.rows) {
											if (applied.has(row.version)) continue;
											const stmts = row.statements ?? [];
											if (!body.dryRun) {
												for (const stmt of stmts) await remote.query(stmt);
												await remote.query(
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
								const enumsRes = await nano.db.query<{
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
									if (!body.dryRun)
										await remote
											.query(
												`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${en.typname}') THEN CREATE TYPE "${en.typname}" AS ENUM (${vals}); END IF; END $$`,
											)
											.catch(() => {});
								}

								const seqRes = await nano.db.query<{
									sequence_name: string;
								}>(
									"SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'",
								);
								for (const seq of seqRes.rows) {
									if (!body.dryRun)
										await remote
											.query(
												`CREATE SEQUENCE IF NOT EXISTS "${seq.sequence_name}"`,
											)
											.catch(() => {});
								}

								const tablesRes = await nano.db.query<{
									table_name: string;
								}>(
									"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
								);

								for (const tbl of tablesRes.rows) {
									const tn = tbl.table_name;
									const colsRes = await nano.db.query<{
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
											c.data_type === "USER-DEFINED"
												? `"${c.udt_name}"`
												: c.data_type;
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
										if (c.column_default !== null)
											def += ` DEFAULT ${c.column_default}`;
										if (c.is_nullable === "NO") def += " NOT NULL";
										colDefs.push(def);
									}

									const pkRes = await nano.db.query<{
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

									const uqRes = await nano.db.query<{
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

									const fkRes = await nano.db.query<{
										constraint_name: string;
										column_name: string;
										foreign_table_name: string;
										foreign_column_name: string;
									}>(
										`SELECT tc.constraint_name, kcu.column_name,
										        ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
										 FROM information_schema.table_constraints tc
										 JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
										 JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
										 WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'`,
										[tn],
									);
									for (const fk of fkRes.rows)
										colDefs.push(
											`FOREIGN KEY ("${fk.column_name}") REFERENCES "${fk.foreign_table_name}"("${fk.foreign_column_name}")`,
										);

									const ddl = `CREATE TABLE IF NOT EXISTS "${tn}" (\n  ${colDefs.join(",\n  ")}\n)`;
									if (!body.dryRun) await remote.query(ddl);
									result.schema.tables++;
								}

								const idxRes = await nano.db.query<{
									indexname: string;
									indexdef: string;
								}>(
									"SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname NOT LIKE '%_pkey'",
								);
								for (const idx of idxRes.rows) {
									if (!body.dryRun) {
										const safeIdx = idx.indexdef.replace(
											/CREATE INDEX/,
											"CREATE INDEX IF NOT EXISTS",
										);
										await remote.query(safeIdx).catch(() => {});
									}
								}
							}
						}

						if (!body.skipAuth) {
							const usersRes = await nano.db.query<Record<string, unknown>>(
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
								if (!body.dryRun) {
									await remote.query(
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

							const identitiesRes = await nano.db.query<
								Record<string, unknown>
							>(
								`SELECT id, provider_id, user_id, identity_data, provider,
								        last_sign_in_at, created_at, updated_at
								 FROM auth.identities ORDER BY created_at`,
							);

							for (const ident of identitiesRes.rows) {
								if (!body.dryRun) {
									await remote.query(
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

						if (!body.skipData) {
							const tablesRes = await nano.db.query<{
								table_name: string;
							}>(
								"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
							);

							const fkDeps = await nano.db.query<{
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

							if (!body.dryRun)
								await remote
									.query("SET session_replication_role = 'replica'")
									.catch(() => {});

							for (const tn of sorted) {
								const dataRes = await nano.db.query(`SELECT * FROM "${tn}"`);
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
									if (!body.dryRun) {
										await remote.query(
											`INSERT INTO "${tn}" (${colList}) VALUES ${valueSets.join(", ")} ON CONFLICT DO NOTHING`,
											params,
										);
									}
									result.data.rows += batch.length;
								}
								result.data.tables++;
							}

							if (!body.dryRun)
								await remote
									.query("SET session_replication_role = 'origin'")
									.catch(() => {});

							for (const tn of sorted) {
								if (body.dryRun) continue;
								const seqCols = await remote
									.query<{
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
											({
												rows: [],
											}) as {
												rows: {
													attname: string;
													seq: string;
												}[];
											},
									);
								for (const { attname, seq } of seqCols.rows) {
									await remote
										.query(
											`SELECT setval('${seq}', COALESCE((SELECT MAX("${attname}") FROM "${tn}"), 1), (SELECT MAX("${attname}") FROM "${tn}") IS NOT NULL)`,
										)
										.catch(() => {});
								}
							}
						}

						if (!body.skipStorage) {
							const bucketsRes = await nano.db.query<{
								id: string;
								name: string;
								public: boolean;
								file_size_limit: number | null;
								allowed_mime_types: string[] | null;
							}>(
								"SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets",
							);

							for (const bucket of bucketsRes.rows) {
								if (!body.dryRun) {
									await remote.query(
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

							if (body.remoteUrl && body.remoteServiceRoleKey) {
								const objectsRes = await nano.db.query<{
									id: string;
									bucket_id: string;
									name: string;
									metadata: Record<string, unknown> | null;
								}>(
									"SELECT id, bucket_id, name, metadata FROM storage.objects ORDER BY bucket_id, name",
								);

								for (const obj of objectsRes.rows) {
									const dlRes = await nano.localFetch(
										new Request(
											`http://localhost:54321/storage/v1/object/${obj.bucket_id}/${obj.name}`,
											{
												headers: {
													Authorization: `Bearer ${tenant.serviceRoleKey}`,
													apikey: tenant.anonKey,
												},
											},
										),
									);
									if (!dlRes.ok) continue;
									const blobData = await dlRes.arrayBuffer();
									const contentType =
										dlRes.headers.get("Content-Type") ??
										"application/octet-stream";

									if (!body.dryRun) {
										const uploadRes = await fetch(
											`${body.remoteUrl}/storage/v1/object/${obj.bucket_id}/${obj.name}`,
											{
												method: "POST",
												headers: {
													Authorization: `Bearer ${body.remoteServiceRoleKey}`,
													apikey: body.remoteServiceRoleKey,
													"Content-Type": contentType,
													"x-upsert": "true",
												},
												body: blobData,
											},
										);
										if (!uploadRes.ok) {
											await uploadRes.arrayBuffer().catch(() => {});
											continue;
										}
									}
									result.storage.objects++;
								}
							}
						}

						await remote.end().catch(() => {});
						return new Response(JSON.stringify(result), {
							headers: json,
						});
					} catch (e: unknown) {
						await remote.end().catch(() => {});
						return new Response(
							JSON.stringify({
								error: "migrate_failed",
								message: e instanceof Error ? e.message : String(e),
								partial: result,
							}),
							{ status: 500, headers: json },
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

		if (tenant.state === "sleeping" || tenant.state === "waking") {
			if (tenant.state === "sleeping") {
				log("tenant.auto_waking", {
					tenant_id: tenant.id,
					slug: tenant.slug,
					trigger: "http",
				});
			}
			if (!wakingPromises.has(tenant.id)) {
				const p = wakeTenant(tenant).finally(() =>
					wakingPromises.delete(tenant.id),
				);
				wakingPromises.set(tenant.id, p);
			}
			await wakingPromises.get(tenant.id);
		} else if (tenant.state === "pausing") {
			log("tenant.busy", {
				tenant_id: tenant.id,
				slug: tenant.slug,
				state: tenant.state,
			});
			return new Response(
				JSON.stringify({
					error: "tenant_busy",
					message: `Tenant is ${tenant.state}`,
				}),
				{ status: 503, headers: json },
			);
		}

		markLastActive(tenant.id);
		tenant.lastActive = new Date();

		if (mcp && (restPath === "/mcp" || restPath.startsWith("/mcp/"))) {
			const nano = nanoInstances.get(tenant.id);
			if (!nano)
				return new Response(JSON.stringify({ error: "nano_unavailable" }), {
					status: 503,
					headers: json,
				});
			let mcpHandler = tenantMcpHandlers.get(tenant.id);
			if (!mcpHandler) {
				const tenantUrl =
					routing === "subdomain"
						? `${url.protocol}//${tenant.slug}.${baseDomain || "localhost"}:${servicePort}`
						: `${url.protocol}//${url.host}/${tenant.slug}`;
				mcpHandler = createMcpHandler(nano, {
					httpPort: servicePort,
					serviceRoleKey: tenant.serviceRoleKey,
					anonKey: tenant.anonKey,
					projectUrl: tenantUrl,
				});
				tenantMcpHandlers.set(tenant.id, mcpHandler);
			}
			const mcpReq = new Request(
				`http://localhost:${servicePort}${restPath}${url.search}`,
				{
					method: req.method,
					headers: req.headers,
					body:
						req.method !== "GET" && req.method !== "HEAD"
							? req.body
							: undefined,
				},
			);
			return mcpHandler.handleRequest(mcpReq);
		}

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
		const res = await activNano?.localFetch(internalReq);
		const latency = Date.now() - t0;
		const resBody = await res.arrayBuffer();
		usage.requests++;
		usage.totalLatencyMs += latency;
		usage.lastLatencyMs = latency;
		usage.bytesOut += resBody.byteLength;
		if (res.status >= 500) {
			usage.errors++;
			const count = (consecutiveErrors.get(tenant.id) ?? 0) + 1;
			consecutiveErrors.set(tenant.id, count);
			if (count >= circuitBreakerThreshold) {
				consecutiveErrors.delete(tenant.id);
				log("tenant.circuit_open", {
					tenant_id: tenant.id,
					slug: tenant.slug,
					consecutive_errors: count,
				});
				pauseTenant(tenant).catch((e: unknown) => {
					log("error", {
						event: "circuit_pause_failed",
						tenant_id: tenant.id,
						error: e instanceof Error ? e.message : String(e),
					});
				});
			}
		} else {
			consecutiveErrors.delete(tenant.id);
		}
		const routeType = restPath.startsWith("/auth/v1/")
			? "auth"
			: restPath.startsWith("/rest/v1/")
				? "rest"
				: restPath.startsWith("/storage/v1/")
					? "storage"
					: "other";
		const authAction =
			routeType === "auth"
				? (restPath.replace("/auth/v1/", "").split("/")[0] ?? "unknown")
				: undefined;
		log("request", {
			tenant_id: tenant.id,
			slug: tenant.slug,
			method: req.method,
			route: routeType,
			...(authAction ? { auth_action: authAction } : {}),
			status: res.status,
			latency_ms: latency,
		});
		return new Response(resBody, { status: res.status, headers: res.headers });
	}

	const serviceServerHandler = async (
		nodeReq: import("node:http").IncomingMessage,
		nodeRes: import("node:http").ServerResponse,
	) => {
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
			const resHeaders: Record<string, string> = { ...CORS };
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
				nodeRes.writeHead(500, { "Content-Type": "application/json", ...CORS });
				nodeRes.end(JSON.stringify({ error: "internal_error", message: msg }));
			}
		}
	};
	const serviceServer = createHttpServer(serviceServerHandler);

	let idleCheckRunning = false;
	const idleCheckInterval = setInterval(async () => {
		if (idleCheckRunning) return;
		idleCheckRunning = true;
		try {
			await flushLastActive().catch((e: unknown) => {
				log("error", {
					event: "flush_last_active_failed",
					error: e instanceof Error ? e.message : String(e),
				});
			});
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
		} finally {
			idleCheckRunning = false;
		}
	}, idleCheck);

	const muxServer = new PGliteTCPMuxServer(
		async (user) => {
			const tenant = await getTenant(user);
			if (!tenant) {
				log("tcp.connection.unknown_tenant", { user });
				return null;
			}
			log("tcp.connection", {
				tenant_id: tenant.id,
				slug: tenant.slug,
				state: tenant.state,
			});
			if (tenant.state === "sleeping") {
				log("tenant.auto_waking", {
					tenant_id: tenant.id,
					slug: tenant.slug,
					trigger: "tcp",
				});
				if (!wakingPromises.has(tenant.id)) {
					const p = wakeTenant(tenant).finally(() =>
						wakingPromises.delete(tenant.id),
					);
					wakingPromises.set(tenant.id, p);
				}
				await wakingPromises.get(tenant.id);
			}
			if (tenant.state !== "running") {
				log("tcp.connection.rejected", {
					tenant_id: tenant.id,
					slug: tenant.slug,
					state: tenant.state,
				});
				return null;
			}
			const pooler = tenantPoolers.get(tenant.id);
			if (!pooler) {
				log("tcp.connection.no_pooler", {
					tenant_id: tenant.id,
					slug: tenant.slug,
				});
				return null;
			}
			const password = tenant.encryptedPassword
				? await decryptPassword(tenant.encryptedPassword)
				: "";
			log("tcp.connection.ready", { tenant_id: tenant.id, slug: tenant.slug });
			return { pooler, password };
		},
		tlsBufs ? { tls: tlsBufs } : undefined,
	);
	await muxServer.start(tcpMuxPort, "0.0.0.0");
	log("tcp_mux.started", { port: tcpMuxPort });

	await new Promise<void>((resolve, reject) => {
		serviceServer.once("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "EADDRINUSE") {
				process.stderr.write(
					`${JSON.stringify({
						error: "EADDRINUSE",
						message: `Port ${servicePort} is already in use`,
					})}\n`,
				);
				process.exit(1);
			}
			reject(err);
		});
		serviceServer.listen(servicePort, () => resolve());
	});
	log("service.started", {
		port: servicePort,
		offloader: s3Bucket ? "s3" : "disk",
		registry: "postgres",
	});

	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, async () => {
			clearInterval(idleCheckInterval);
			serviceServer.close();
			await muxServer.stop().catch(() => {});
			for (const [id, pooler] of tenantPoolers) {
				await pooler.stop().catch(() => {});
				tenantPoolers.delete(id);
			}
			await registry.close().catch(() => {});
			process.exit(0);
		});
	}
}
