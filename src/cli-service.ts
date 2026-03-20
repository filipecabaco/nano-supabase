import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { join } from "node:path";
import type { Extension } from "@electric-sql/pglite";
import type { NanoSupabaseInstance } from "./nano.ts";
import { nanoSupabase } from "./nano.ts";

export async function runServiceMode(opts: {
  wasmModule: WebAssembly.Module;
  fsBundle: Blob;
  postgrestWasm: Uint8Array;
  pgcryptoExt: Extension;
  uuidOsspExt: Extension;
  subArgs: string[];
  parsePort: (raw: string | undefined, fallback: number, name: string) => number;
  getArgValue: (args: string[], flag: string) => string | undefined;
  DEFAULT_SERVICE_ROLE_KEY: string;
  DEFAULT_ANON_KEY: string;
  pgliteDist: string;
}): Promise<void> {
  process.on("unhandledRejection", (err) => {
    process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), event: "unhandled_rejection", error: err instanceof Error ? err.message : String(err) }) + "\n");
  });

  const {
    wasmModule,
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
  } = opts;

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
  const circuitBreakerThreshold = (() => {
    const raw = getArgValue(subArgs, "--circuit-breaker-threshold");
    if (!raw) return 10;
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 1) {
      process.stderr.write(`Invalid --circuit-breaker-threshold: "${raw}" (must be >= 1)\n`);
      process.exit(1);
    }
    return n;
  })();

  const secret = getArgValue(subArgs, "--secret") ?? process.env.NANO_SECRET;
  if (!secret) {
    process.stderr.write(
      JSON.stringify({
        error: "missing_secret",
        message: "--secret (or NANO_SECRET) is required for service mode",
      }) + "\n",
    );
    process.exit(1);
  }

  let cachedKey: CryptoKey | null = null;
  async function getKey(): Promise<CryptoKey> {
    if (!cachedKey) {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
      cachedKey = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: enc.encode("nano-supabase-v1"), iterations: 100000, hash: "SHA-256" },
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
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(password));
    const ivB64 = Buffer.from(iv).toString("base64");
    const ctB64 = Buffer.from(ciphertext).toString("base64");
    return `${ivB64}:${ctB64}`;
  }

  async function decryptPassword(encrypted: string): Promise<string> {
    const key = await getKey();
    const [ivB64, ctB64] = encrypted.split(":");
    const iv = Buffer.from(ivB64, "base64");
    const ciphertext = Buffer.from(ctB64, "base64");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(plain);
  }

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
    dir: join(pgliteDist, "service-migrations"),
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
    encryptedPassword: string | null;
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

  const consecutiveErrors = new Map<string, number>();
  const wakingSet = new Set<string>();
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
      encryptedPassword: row.encrypted_password ?? null,
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
      "INSERT INTO tenants (id, slug, data_dir, token_hash, encrypted_password, state, last_active, tcp_port, anon_key, service_role_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [
        entry.id,
        entry.slug,
        entry.dataDir,
        entry.tokenHash,
        entry.encryptedPassword,
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
    const plainPassword = tenant.encryptedPassword ? await decryptPassword(tenant.encryptedPassword) : undefined;
    const tcpServer = await PGliteTCPServer.create(nanoInstance.db, undefined, plainPassword);
    try {
      await tcpServer.start(tenant.tcpPort, "0.0.0.0");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("EADDRINUSE")) {
        tenant.tcpPort = nextTcpPort++;
        await registry.query("UPDATE tenants SET tcp_port=$1 WHERE id=$2", [tenant.tcpPort, tenant.id]);
        await tcpServer.start(tenant.tcpPort, "0.0.0.0");
      } else {
        throw e;
      }
    }
    tcpServers.set(tenant.id, tcpServer);
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
    stub.on("error", (err: NodeJS.ErrnoException) => {
      log("wake_stub.error", { tenant_id: tenant.id, slug: tenant.slug, error: err.message });
      wakeStubs.delete(tenant.id);
    });
    stub.listen(tenant.tcpPort, "0.0.0.0");
    wakeStubs.set(tenant.id, stub);
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
    const tcpServer = tcpServers.get(tenant.id);
    if (tcpServer) {
      await tcpServer.stop();
      tcpServers.delete(tenant.id);
    }
    nanoInstances.set(tenant.id, null);
    tenant.nano = null;
    try {
      await offloadTenant(tenant.dataDir, tenant.id);
      await updateTenantState(tenant.id, "sleeping");
      tenant.state = "sleeping";
      startWakeStub(tenant);
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
    try {
      if (!hasLocalData) await pullTenant(tenant.dataDir, tenant.id);
      await startTenantNano(tenant);
    } catch (e) {
      await updateTenantState(tenant.id, "sleeping");
      tenant.state = "sleeping";
      startWakeStub(tenant);
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
      tcpPort: t.tcpPort,
      pgUrl: `postgresql://postgres:<password>@localhost:${t.tcpPort}/postgres`,
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
        const body = (await req.json()) as { slug: string; password?: string };
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
        const plainToken = crypto.randomUUID();
        const tokenHash = await hashToken(plainToken);
        const plainPassword = body.password ?? Array.from(crypto.getRandomValues(new Uint8Array(18))).map(b => b.toString(16).padStart(2, "0")).join("");
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
        const tenantTcpPort = nextTcpPort++;
        const tenant: TenantEntry = {
          id,
          slug,
          dataDir: tenantDataDir,
          tokenHash,
          encryptedPassword,
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
          JSON.stringify({ token: plainToken, password: plainPassword, tenant: tenantPublic(tenant) }),
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
            await tcpServers.get(tenant.id)?.stop().catch(() => {});
            tcpServers.delete(tenant.id);
            const inst = nanoInstances.get(tenant.id);
            if (inst && typeof inst[Symbol.asyncDispose] === "function") {
              await inst[Symbol.asyncDispose]().catch(() => {});
            }
          }
          const stub = wakeStubs.get(tenant.id);
          if (stub) {
            stub.close();
            wakeStubs.delete(tenant.id);
          }
          nanoInstances.delete(tenant.id);
          consecutiveErrors.delete(tenant.id);
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
      if (wakingSet.has(tenant.id)) {
        return new Response(JSON.stringify({ error: "tenant_busy", message: "Tenant is waking" }), { status: 503, headers: json });
      }
      wakingSet.add(tenant.id);
      try {
        await wakeTenant(tenant);
      } finally {
        wakingSet.delete(tenant.id);
      }
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
    if (res.status >= 500) {
      usage.errors++;
      const count = (consecutiveErrors.get(tenant.id) ?? 0) + 1;
      consecutiveErrors.set(tenant.id, count);
      if (count >= circuitBreakerThreshold) {
        consecutiveErrors.delete(tenant.id);
        log("tenant.circuit_open", { tenant_id: tenant.id, slug: tenant.slug, consecutive_errors: count });
        pauseTenant(tenant).catch((e: unknown) => {
          log("error", { event: "circuit_pause_failed", tenant_id: tenant.id, error: e instanceof Error ? e.message : String(e) });
        });
      }
    } else {
      consecutiveErrors.delete(tenant.id);
    }
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

  await new Promise<void>((resolve, reject) => {
    serviceServer.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        process.stderr.write(JSON.stringify({ error: "EADDRINUSE", message: `Port ${servicePort} is already in use` }) + "\n");
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
}
