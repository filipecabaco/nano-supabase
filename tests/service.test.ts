import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "../dist/cli.js");

const ADMIN_TOKEN = "test-admin-token-abc123";

let pgContainer: StartedPostgreSqlContainer;
let registryDbUrl: string;

async function waitForHealth(url: string, timeout = 45_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(
    `Service at ${url} did not become healthy within ${timeout}ms`,
  );
}

const TCP_PORT = 54472;

function startService(
  port: number,
  dataDir: string,
  coldDir: string,
  extraArgs: string[] = [],
): ChildProcess {
  return spawn(
    "node",
    [
      CLI,
      "service",
      `--service-port=${port}`,
      `--admin-token=${ADMIN_TOKEN}`,
      `--data-dir=${dataDir}`,
      `--cold-dir=${coldDir}`,
      `--registry-db-url=${registryDbUrl}`,
      `--secret=test-service-secret`,
      `--tcp-port=${TCP_PORT}`,
      ...extraArgs,
    ],
    { stdio: "ignore", detached: false },
  );
}

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer("postgres:16-alpine").start();
  registryDbUrl = pgContainer.getConnectionUri();
}, 60_000);

afterAll(async () => {
  await pgContainer.stop();
});

describe("service with postgres registry", () => {
  let svcProcess: ChildProcess;
  let dataDir: string;
  let coldDir: string;
  const port = 54470;
  const base = `http://localhost:${port}`;
  let aliceToken: string;
  let alicePassword: string;
  let bobToken: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "nano-svc-pg-data-"));
    coldDir = mkdtempSync(join(tmpdir(), "nano-svc-pg-cold-"));
    svcProcess = startService(port, dataDir, coldDir);
    await waitForHealth(base);
  }, 60_000);

  afterAll(async () => {
    svcProcess?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(coldDir, { recursive: true, force: true });
  });

  test("GET /health returns ok", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  describe("migration system", () => {
    let pgClient: Client;

    beforeAll(async () => {
      pgClient = new Client({ connectionString: registryDbUrl });
      await pgClient.connect();
    });

    afterAll(async () => {
      await pgClient.end();
    });

    test("service_migrations table exists and has all migrations applied", async () => {
      const result = await pgClient.query<{ name: string }>(
        "SELECT name FROM service_migrations ORDER BY id",
      );
      expect(result.rows.map((r) => r.name)).toEqual([
        "1710000000000_initial",
        "1710000001000_add_connection_info",
        "1710000002000_add_password",
      ]);
    });

    test("tenants table created by migration (no IF NOT EXISTS — tracking enforces idempotency)", async () => {
      const result = await pgClient.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenants'",
      );
      expect(result.rows).toHaveLength(1);
    });

    test("restarting service does not re-run already applied migrations", async () => {
      svcProcess.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 800));

      const restartedProcess = startService(port, dataDir, coldDir);
      try {
        await waitForHealth(base);
        const result = await pgClient.query<{ name: string }>(
          "SELECT name FROM service_migrations ORDER BY id",
        );
        expect(result.rows.map((r) => r.name)).toEqual([
          "1710000000000_initial",
          "1710000001000_add_connection_info",
          "1710000002000_add_password",
        ]);
        svcProcess = restartedProcess;
      } catch (e) {
        restartedProcess.kill("SIGTERM");
        throw e;
      }
    }, 60_000);
  });

  test("admin endpoint without token returns 401", async () => {
    const res = await fetch(`${base}/admin/tenants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "x" }),
    });
    expect(res.status).toBe(401);
  });

  test("admin endpoint with wrong token returns 401", async () => {
    const res = await fetch(`${base}/admin/tenants`, {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slug: "x" }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /admin/tenants with invalid slug returns 400", async () => {
    const res = await fetch(`${base}/admin/tenants`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slug: "Invalid Slug!" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /admin/tenants creates tenant and stores in postgres registry", async () => {
    const res = await fetch(`${base}/admin/tenants`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slug: "alice" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.tenant.slug).toBe("alice");
    expect(body.tenant.state).toBe("running");
    aliceToken = body.token;
    alicePassword = body.password;
  });

  test("duplicate slug returns 409", async () => {
    const res = await fetch(`${base}/admin/tenants`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slug: "alice" }),
    });
    expect(res.status).toBe(409);
  });

  test("GET /admin/tenants lists tenants from postgres", async () => {
    const res = await fetch(`${base}/admin/tenants`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.some((t: { slug: string }) => t.slug === "alice")).toBe(true);
  });

  test("GET /admin/tenants/:slug returns tenant", async () => {
    const res = await fetch(`${base}/admin/tenants/alice`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).slug).toBe("alice");
  });

  test("GET /admin/tenants/unknown returns 404", async () => {
    const res = await fetch(`${base}/admin/tenants/nobody`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  describe("reverse proxy routing", () => {
    test("/<slug>/auth/v1/signup is proxied to correct tenant nano instance", async () => {
      const res = await fetch(`${base}/alice/auth/v1/signup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "alice@test.com",
          password: "password123",
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user?.email).toBe("alice@test.com");
    });

    test("wrong tenant token is rejected at proxy level (401)", async () => {
      const res = await fetch(`${base}/alice/auth/v1/signup`, {
        method: "POST",
        headers: {
          Authorization: "Bearer wrong-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: "x@test.com", password: "pw" }),
      });
      expect(res.status).toBe(401);
    });

    test("unknown slug returns 404 at proxy level", async () => {
      const res = await fetch(`${base}/nonexistent/auth/v1/signup`, {
        method: "POST",
        headers: {
          Authorization: "Bearer any-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: "x@test.com", password: "pw" }),
      });
      expect(res.status).toBe(404);
    });

    test("slug is stripped from path before forwarding to tenant", async () => {
      const res = await fetch(`${base}/alice/rest/v1/nonexistent_table`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      const body = await res.json();
      expect(body).toMatchObject({
        message: expect.stringContaining("nonexistent_table"),
      });
    });

    test("per-tenant isolation: alice and bob have separate databases", async () => {
      const bobRes = await fetch(`${base}/admin/tenants`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ slug: "bob" }),
      });
      bobToken = (await bobRes.json()).token;

      await fetch(`${base}/bob/auth/v1/signup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bobToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "bob@test.com",
          password: "password123",
        }),
      });

      const aliceSignIn = await fetch(
        `${base}/alice/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${aliceToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: "alice@test.com",
            password: "password123",
          }),
        },
      );
      const bobSignIn = await fetch(
        `${base}/bob/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bobToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: "bob@test.com",
            password: "password123",
          }),
        },
      );

      const aliceSession = await aliceSignIn.json();
      const bobSession = await bobSignIn.json();
      expect(aliceSession.access_token).toBeTruthy();
      expect(bobSession.access_token).toBeTruthy();
      expect(aliceSession.user?.id).not.toBe(bobSession.user?.id);
    });

    test("cross-tenant token is rejected by proxy (401)", async () => {
      const res = await fetch(`${base}/bob/auth/v1/signup`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: "cross@test.com", password: "pw" }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("pause / wake lifecycle", () => {
    test("pause puts tenant to sleep and offloads data to cold dir", async () => {
      const res = await fetch(`${base}/admin/tenants/alice/pause`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).state).toBe("sleeping");
    });

    test("wake restores tenant with all data intact", async () => {
      const wakeRes = await fetch(`${base}/admin/tenants/alice/wake`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(wakeRes.status).toBe(200);
      expect((await wakeRes.json()).state).toBe("running");

      const signIn = await fetch(
        `${base}/alice/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${aliceToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: "alice@test.com",
            password: "password123",
          }),
        },
      );
      expect(signIn.status).toBe(200);
      expect((await signIn.json()).access_token).toBeTruthy();
    }, 30_000);

    test("sleeping tenant auto-wakes on first proxy request", async () => {
      await fetch(`${base}/admin/tenants/alice/pause`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });

      const res = await fetch(
        `${base}/alice/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${aliceToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: "alice@test.com",
            password: "password123",
          }),
        },
      );
      expect(res.status).toBe(200);
      expect((await res.json()).access_token).toBeTruthy();
    }, 30_000);

    test("sleeping tenant auto-wakes on admin /sql request", async () => {
      await fetch(`${base}/admin/tenants/alice/pause`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });

      const res = await fetch(`${base}/admin/tenants/alice/sql`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql: "SELECT 1 AS ok" }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).rows[0].ok).toBe(1);
    }, 30_000);
  });

  describe("token rotation", () => {
    test("reset-token returns new token and invalidates old one", async () => {
      const oldToken = aliceToken;
      const res = await fetch(`${base}/admin/tenants/alice/reset-token`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const { token: newToken } = await res.json();
      expect(newToken).toBeTruthy();
      expect(newToken).not.toBe(oldToken);
      aliceToken = newToken;

      const withOld = await fetch(`${base}/alice/health`, {
        headers: { Authorization: `Bearer ${oldToken}` },
      });
      expect(withOld.status).toBe(401);

      const withNew = await fetch(
        `${base}/alice/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${newToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: "alice@test.com",
            password: "password123",
          }),
        },
      );
      expect(withNew.status).toBe(200);
    });
  });

  describe("password rotation", () => {
    test("reset-password returns a new random password that authenticates via TCP", async () => {
      const res = await fetch(`${base}/admin/tenants/alice/reset-password`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const { password: newPassword } = await res.json();
      expect(newPassword).toBeTruthy();
      expect(newPassword).not.toBe(alicePassword);
      alicePassword = newPassword;

      const client = new Client({
        host: "127.0.0.1",
        port: TCP_PORT,
        user: "alice",
        password: newPassword,
        database: "postgres",
        ssl: false,
      });
      await client.connect();
      const result = await client.query("SELECT 1 AS ok");
      expect(result.rows[0].ok).toBe(1);
      await client.end();
    });

    test("reset-password with custom password accepts that password via TCP", async () => {
      const customPassword = "my-custom-p4ssw0rd";
      const res = await fetch(`${base}/admin/tenants/alice/reset-password`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: customPassword }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).password).toBe(customPassword);
      alicePassword = customPassword;

      const client = new Client({
        host: "127.0.0.1",
        port: TCP_PORT,
        user: "alice",
        password: customPassword,
        database: "postgres",
        ssl: false,
      });
      await client.connect();
      const result = await client.query("SELECT 2 AS ok");
      expect(result.rows[0].ok).toBe(2);
      await client.end();
    });

    test("old password is rejected after reset", async () => {
      const stalePassword = alicePassword;
      const res = await fetch(`${base}/admin/tenants/alice/reset-password`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      const { password: freshPassword } = await res.json();
      alicePassword = freshPassword;

      const client = new Client({
        host: "127.0.0.1",
        port: TCP_PORT,
        user: "alice",
        password: stalePassword,
        database: "postgres",
        ssl: false,
      });
      await expect(client.connect()).rejects.toThrow();
    });
  });

  describe("registry persistence across restarts", () => {
    test("tenants survive service restart — reloaded from postgres on boot", async () => {
      svcProcess.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1000));

      const restartedProcess = startService(port, dataDir, coldDir);
      try {
        await waitForHealth(base);
        const res = await fetch(`${base}/admin/tenants`, {
          headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
        });
        const tenants = await res.json();
        expect(tenants.some((t: { slug: string }) => t.slug === "alice")).toBe(
          true,
        );
        expect(tenants.some((t: { slug: string }) => t.slug === "bob")).toBe(
          true,
        );
        svcProcess = restartedProcess;
      } catch (e) {
        restartedProcess.kill("SIGTERM");
        throw e;
      }
    }, 60_000);
  });

  describe("CLI command functions", () => {
    const cmdArgs = (extra: string[] = []) => [
      `--url=${base}`,
      `--admin-token=${ADMIN_TOKEN}`,
      ...extra,
    ];

    test("cmdServiceList returns tenant list", async () => {
      const { cmdServiceList } = await import("../src/cli-commands.ts");
      const result = await cmdServiceList(cmdArgs());
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("alice");
    });

    test("cmdServiceList returns JSON with --json", async () => {
      const { cmdServiceList } = await import("../src/cli-commands.ts");
      const result = await cmdServiceList(cmdArgs(["--json"]));
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.output);
      expect(Array.isArray(parsed)).toBe(true);
    });

    test("cmdServiceAdd creates a tenant", async () => {
      const { cmdServiceAdd, cmdServiceRemove } = await import(
        "../src/cli-commands.ts"
      );
      const addResult = await cmdServiceAdd(
        cmdArgs(["cli-test-tenant", "--json"]),
      );
      expect(addResult.exitCode).toBe(0);
      const parsed = JSON.parse(addResult.output);
      expect(parsed.tenant.slug).toBe("cli-test-tenant");
      await cmdServiceRemove(cmdArgs(["cli-test-tenant"]));
    });

    test("cmdServiceRemove deletes a tenant", async () => {
      const { cmdServiceAdd, cmdServiceRemove } = await import(
        "../src/cli-commands.ts"
      );
      await cmdServiceAdd(cmdArgs(["cli-remove-tenant"]));
      const result = await cmdServiceRemove(cmdArgs(["cli-remove-tenant"]));
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("deleted");
    });

    test("cmdServicePause and cmdServiceWake cycle", async () => {
      const {
        cmdServiceAdd,
        cmdServicePause,
        cmdServiceWake,
        cmdServiceRemove,
      } = await import("../src/cli-commands.ts");
      await cmdServiceAdd(cmdArgs(["cli-pause-tenant"]));
      const pauseResult = await cmdServicePause(cmdArgs(["cli-pause-tenant"]));
      expect(pauseResult.exitCode).toBe(0);
      expect(pauseResult.output).toContain("paused");
      const wakeResult = await cmdServiceWake(cmdArgs(["cli-pause-tenant"]));
      expect(wakeResult.exitCode).toBe(0);
      expect(wakeResult.output).toContain("woken");
      await cmdServiceRemove(cmdArgs(["cli-pause-tenant"]));
    });

    test("cmdServiceSql executes SQL on a tenant", async () => {
      const { cmdServiceAdd, cmdServiceSql, cmdServiceRemove } = await import(
        "../src/cli-commands.ts"
      );
      await cmdServiceAdd(cmdArgs(["cli-sql-tenant"]));
      const result = await cmdServiceSql(
        cmdArgs(["cli-sql-tenant", "SELECT 42 AS answer"]),
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("42");
      await cmdServiceRemove(cmdArgs(["cli-sql-tenant"]));
    });

    test("cmdServiceResetToken rotates bearer token", async () => {
      const { cmdServiceAdd, cmdServiceResetToken, cmdServiceRemove } =
        await import("../src/cli-commands.ts");
      await cmdServiceAdd(cmdArgs(["cli-token-tenant"]));
      const result = await cmdServiceResetToken(cmdArgs(["cli-token-tenant"]));
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("New token:");
      await cmdServiceRemove(cmdArgs(["cli-token-tenant"]));
    });

    test("cmdServiceResetPassword rotates postgres password", async () => {
      const { cmdServiceAdd, cmdServiceResetPassword, cmdServiceRemove } =
        await import("../src/cli-commands.ts");
      await cmdServiceAdd(cmdArgs(["cli-pass-tenant"]));
      const result = await cmdServiceResetPassword(
        cmdArgs(["cli-pass-tenant"]),
      );
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("New password:");
      await cmdServiceRemove(cmdArgs(["cli-pass-tenant"]));
    });
  });

  test("DELETE /admin/tenants/:slug removes tenant from postgres registry", async () => {
    const res = await fetch(`${base}/admin/tenants/bob`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);

    const check = await fetch(`${base}/admin/tenants/bob`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(check.status).toBe(404);
  });
});

describe("ServiceClient", () => {
  let svcProcess: ChildProcess;
  let dataDir: string;
  let coldDir: string;
  const port = 54480;
  const base = `http://localhost:${port}`;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "nano-svc-client-data-"));
    coldDir = mkdtempSync(join(tmpdir(), "nano-svc-client-cold-"));
    svcProcess = startService(port, dataDir, coldDir);
    await waitForHealth(base);
  }, 60_000);

  afterAll(async () => {
    svcProcess?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(coldDir, { recursive: true, force: true });
  });

  test("createTenant with auto-generated values", async () => {
    const { ServiceClient } = await import("../src/service-client.ts");
    const client = new ServiceClient({ url: base, adminToken: ADMIN_TOKEN });
    const result = await client.createTenant("sc-auto");
    expect(result.token).toBeTruthy();
    expect(result.password).toBeTruthy();
    expect(result.tenant.slug).toBe("sc-auto");
    expect(result.tenant.state).toBe("running");
    expect(result.tenant.anonKey).toBeTruthy();
  });

  test("createTenant with custom token, password, anonKey, serviceRoleKey", async () => {
    const { ServiceClient } = await import("../src/service-client.ts");
    const client = new ServiceClient({ url: base, adminToken: ADMIN_TOKEN });
    const result = await client.createTenant("sc-custom", {
      token: "my-custom-token",
      password: "my-custom-pass",
      anonKey: "my-anon",
      serviceRoleKey: "my-service-role",
    });
    expect(result.token).toBe("my-custom-token");
    expect(result.password).toBe("my-custom-pass");
    expect(result.tenant.anonKey).toBe("my-anon");
    expect(result.tenant.serviceRoleKey).toBe("my-service-role");
  });

  test("listTenants returns created tenants", async () => {
    const { ServiceClient } = await import("../src/service-client.ts");
    const client = new ServiceClient({ url: base, adminToken: ADMIN_TOKEN });
    const tenants = await client.listTenants();
    const slugs = tenants.map((t) => t.slug);
    expect(slugs).toContain("sc-auto");
    expect(slugs).toContain("sc-custom");
  });

  test("getTenant returns tenant", async () => {
    const { ServiceClient } = await import("../src/service-client.ts");
    const client = new ServiceClient({ url: base, adminToken: ADMIN_TOKEN });
    const tenant = await client.getTenant("sc-auto");
    expect(tenant.slug).toBe("sc-auto");
  });

  test("sql executes query on tenant", async () => {
    const { ServiceClient } = await import("../src/service-client.ts");
    const client = new ServiceClient({ url: base, adminToken: ADMIN_TOKEN });
    const result = await client.sql("sc-auto", "SELECT 1 AS n");
    expect(result.rows[0]).toEqual({ n: 1 });
  });

  test("pauseTenant and wakeTenant", async () => {
    const { ServiceClient } = await import("../src/service-client.ts");
    const client = new ServiceClient({ url: base, adminToken: ADMIN_TOKEN });
    const paused = await client.pauseTenant("sc-auto");
    expect(paused.state).toBe("sleeping");
    const woken = await client.wakeTenant("sc-auto");
    expect(woken.state).toBe("running");
  });

  test("resetToken returns new token", async () => {
    const { ServiceClient } = await import("../src/service-client.ts");
    const client = new ServiceClient({ url: base, adminToken: ADMIN_TOKEN });
    const result = await client.resetToken("sc-auto");
    expect(result.token).toBeTruthy();
    expect(result.token).not.toBe("my-custom-token");
  });

  test("resetPassword returns new password", async () => {
    const { ServiceClient } = await import("../src/service-client.ts");
    const client = new ServiceClient({ url: base, adminToken: ADMIN_TOKEN });
    const result = await client.resetPassword("sc-custom");
    expect(result.password).toBeTruthy();
  });

  test("deleteTenant removes it", async () => {
    const { ServiceClient } = await import("../src/service-client.ts");
    const client = new ServiceClient({ url: base, adminToken: ADMIN_TOKEN });
    await client.deleteTenant("sc-auto");
    await expect(client.getTenant("sc-auto")).rejects.toThrow();
  });
});

describe("service with local PGlite registry (no --registry-db-url)", () => {
  let svcProcess: ChildProcess;
  let dataDir: string;
  let coldDir: string;
  const port = 54490;
  const tcpPort = 54491;
  const base = `http://localhost:${port}`;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "nano-svc-pglite-data-"));
    coldDir = mkdtempSync(join(tmpdir(), "nano-svc-pglite-cold-"));
    svcProcess = spawn(
      "node",
      [
        CLI,
        "service",
        `--service-port=${port}`,
        `--tcp-port=${tcpPort}`,
        `--admin-token=${ADMIN_TOKEN}`,
        `--data-dir=${dataDir}`,
        `--cold-dir=${coldDir}`,
        `--secret=test-service-secret`,
      ],
      { stdio: "ignore", detached: false },
    );
    await waitForHealth(base);
  }, 60_000);

  afterAll(async () => {
    svcProcess?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(coldDir, { recursive: true, force: true });
  });

  test("health check passes", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
  });

  test("can create, use, and delete a tenant", async () => {
    const { ServiceClient } = await import("../src/service-client.ts");
    const client = new ServiceClient({ url: base, adminToken: ADMIN_TOKEN });

    const { tenant } = await client.createTenant("local-tenant");
    expect(tenant.slug).toBe("local-tenant");
    expect(tenant.state).toBe("running");

    const { rows } = await client.sql("local-tenant", "SELECT 1 AS ok");
    expect(rows[0]).toEqual({ ok: 1 });

    await client.deleteTenant("local-tenant");
    await expect(client.getTenant("local-tenant")).rejects.toThrow();
  });

  test("registry survives service restart", async () => {
    const { ServiceClient } = await import("../src/service-client.ts");
    const client = new ServiceClient({ url: base, adminToken: ADMIN_TOKEN });
    await client.createTenant("persist-test");

    svcProcess.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 800));

    const restarted = spawn(
      "node",
      [
        CLI,
        "service",
        `--service-port=${port}`,
        `--tcp-port=${tcpPort}`,
        `--admin-token=${ADMIN_TOKEN}`,
        `--data-dir=${dataDir}`,
        `--cold-dir=${coldDir}`,
        `--secret=test-service-secret`,
      ],
      { stdio: "ignore", detached: false },
    );
    try {
      await waitForHealth(base);
      const tenants = await client.listTenants();
      expect(tenants.some((t) => t.slug === "persist-test")).toBe(true);
      svcProcess = restarted;
    } catch (e) {
      restarted.kill("SIGTERM");
      throw e;
    }
  }, 60_000);
});

describe("service migrate", () => {
  let svcProcess: ChildProcess;
  let dataDir: string;
  let coldDir: string;
  const port = 54495;
  const tcpPort = 54496;
  const base = `http://localhost:${port}`;
  let tenantToken: string;
  let remoteDbUrl: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "nano-svc-migrate-data-"));
    coldDir = mkdtempSync(join(tmpdir(), "nano-svc-migrate-cold-"));
    svcProcess = spawn(
      "node",
      [
        CLI,
        "service",
        `--service-port=${port}`,
        `--tcp-port=${tcpPort}`,
        `--admin-token=${ADMIN_TOKEN}`,
        `--data-dir=${dataDir}`,
        `--cold-dir=${coldDir}`,
        `--registry-db-url=${registryDbUrl}`,
        `--secret=test-migrate-secret`,
      ],
      { stdio: "ignore", detached: false },
    );
    await waitForHealth(base);

    const createRes = await fetch(`${base}/admin/tenants`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slug: "migrate-src" }),
    });
    const createBody = await createRes.json();
    tenantToken = createBody.token;

    const remoteClient = new Client({ connectionString: registryDbUrl });
    await remoteClient.connect();
    await remoteClient.query("CREATE SCHEMA IF NOT EXISTS auth");
    await remoteClient.query(`
			CREATE TABLE IF NOT EXISTS auth.users (
				instance_id UUID DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
				id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
				aud VARCHAR(255), role VARCHAR(255), email VARCHAR(255) UNIQUE,
				encrypted_password VARCHAR(255), confirmed_at TIMESTAMPTZ,
				email_confirmed_at TIMESTAMPTZ, invited_at TIMESTAMPTZ,
				confirmation_token VARCHAR(255), confirmation_sent_at TIMESTAMPTZ,
				recovery_token VARCHAR(255), recovery_sent_at TIMESTAMPTZ,
				email_change_token_new VARCHAR(255), email_change VARCHAR(255),
				email_change_sent_at TIMESTAMPTZ, email_change_confirm_status SMALLINT DEFAULT 0,
				last_sign_in_at TIMESTAMPTZ, raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
				raw_user_meta_data JSONB DEFAULT '{}'::jsonb, is_super_admin BOOLEAN DEFAULT FALSE,
				created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
				phone VARCHAR(255) UNIQUE, phone_confirmed_at TIMESTAMPTZ,
				phone_change VARCHAR(255), phone_change_token VARCHAR(255),
				phone_change_sent_at TIMESTAMPTZ, banned_until TIMESTAMPTZ,
				reauthentication_token VARCHAR(255), reauthentication_sent_at TIMESTAMPTZ,
				is_sso_user BOOLEAN DEFAULT FALSE, deleted_at TIMESTAMPTZ,
				is_anonymous BOOLEAN DEFAULT FALSE,
				CONSTRAINT users_pkey PRIMARY KEY (id)
			)
		`);
    await remoteClient.query(`
			CREATE TABLE IF NOT EXISTS auth.identities (
				provider_id TEXT NOT NULL, user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
				identity_data JSONB NOT NULL, provider TEXT NOT NULL,
				last_sign_in_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(),
				updated_at TIMESTAMPTZ DEFAULT NOW(),
				email TEXT GENERATED ALWAYS AS (lower(identity_data->>'email')) STORED,
				id UUID NOT NULL DEFAULT gen_random_uuid(),
				CONSTRAINT identities_pkey PRIMARY KEY (id),
				CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider)
			)
		`);
    await remoteClient.query("CREATE SCHEMA IF NOT EXISTS storage");
    await remoteClient.query(`
			CREATE TABLE IF NOT EXISTS storage.buckets (
				id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, public BOOLEAN DEFAULT FALSE,
				file_size_limit BIGINT, allowed_mime_types TEXT[],
				created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
			)
		`);
    await remoteClient.end();
    remoteDbUrl = registryDbUrl;
  }, 90_000);

  afterAll(async () => {
    svcProcess?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(coldDir, { recursive: true, force: true });
  });

  test("migrate transfers schema, auth users, and data to remote", async () => {
    const adminHeaders = {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      "Content-Type": "application/json",
    };

    await fetch(`${base}/admin/tenants/migrate-src/sql`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        sql: `CREATE TABLE IF NOT EXISTS todos (
					id SERIAL PRIMARY KEY,
					title TEXT NOT NULL,
					done BOOLEAN DEFAULT false
				)`,
      }),
    });

    await fetch(`${base}/admin/tenants/migrate-src/sql`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        sql: "INSERT INTO todos (title, done) VALUES ('Buy milk', false), ('Write tests', true)",
      }),
    });

    await fetch(`${base}/migrate-src/auth/v1/signup`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "migrated@test.com",
        password: "password123",
      }),
    });

    const migrateRes = await fetch(
      `${base}/admin/tenants/migrate-src/migrate`,
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          remoteDbUrl,
          skipStorage: true,
        }),
      },
    );
    const result = await migrateRes.json();
    if (migrateRes.status !== 200) {
      console.error("migrate response:", JSON.stringify(result, null, 2));
    }
    expect(migrateRes.status).toBe(200);

    expect(result.schema.tables).toBeGreaterThanOrEqual(1);
    expect(result.auth.users).toBeGreaterThanOrEqual(1);
    expect(result.data.tables).toBeGreaterThanOrEqual(1);
    expect(result.data.rows).toBeGreaterThanOrEqual(2);

    const remote = new Client({ connectionString: remoteDbUrl });
    await remote.connect();

    const todosRes = await remote.query(
      "SELECT title, done FROM todos ORDER BY id",
    );
    expect(todosRes.rows).toEqual([
      { title: "Buy milk", done: false },
      { title: "Write tests", done: true },
    ]);

    const usersRes = await remote.query(
      "SELECT email FROM auth.users WHERE email = 'migrated@test.com'",
    );
    expect(usersRes.rows).toHaveLength(1);

    await remote.end();
  }, 60_000);

  test("migrate with --dry-run does not write anything", async () => {
    const adminHeaders = {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      "Content-Type": "application/json",
    };

    await fetch(`${base}/admin/tenants/migrate-src/sql`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        sql: "CREATE TABLE IF NOT EXISTS dryrun_test (id SERIAL PRIMARY KEY, val TEXT)",
      }),
    });
    await fetch(`${base}/admin/tenants/migrate-src/sql`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        sql: "INSERT INTO dryrun_test (val) VALUES ('should-not-appear')",
      }),
    });

    const migrateRes = await fetch(
      `${base}/admin/tenants/migrate-src/migrate`,
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          remoteDbUrl,
          skipStorage: true,
          skipAuth: true,
          dryRun: true,
        }),
      },
    );
    const result = await migrateRes.json();
    if (migrateRes.status !== 200) {
      console.error(
        "dry-run migrate response:",
        JSON.stringify(result, null, 2),
      );
    }
    expect(migrateRes.status).toBe(200);
    expect(result.data.rows).toBeGreaterThan(0);

    const remote = new Client({ connectionString: remoteDbUrl });
    await remote.connect();
    const check = await remote
      .query("SELECT 1 FROM dryrun_test LIMIT 1")
      .catch(() => ({ rows: [] as unknown[] }));
    expect(
      check.rows.filter((r: unknown) => {
        const row = r as Record<string, unknown>;
        return row.val === "should-not-appear";
      }),
    ).toHaveLength(0);
    await remote.end();
  }, 30_000);

  test("cmdServiceMigrate CLI wrapper works", async () => {
    const { cmdServiceMigrate } = await import("../src/cli-commands.ts");
    const result = await cmdServiceMigrate([
      `--url=${base}`,
      `--admin-token=${ADMIN_TOKEN}`,
      "migrate-src",
      `--remote-db-url=${remoteDbUrl}`,
      "--no-storage",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.auth.users).toBeGreaterThanOrEqual(1);
    expect(parsed.data.tables).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
