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
