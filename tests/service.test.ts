import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
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
	throw new Error(`Service at ${url} did not become healthy within ${timeout}ms`);
}

function startService(port: number, dataDir: string, coldDir: string, extraArgs: string[] = []): ChildProcess {
	return spawn(
		"node",
		[CLI, "service",
			`--service-port=${port}`,
			`--admin-token=${ADMIN_TOKEN}`,
			`--data-dir=${dataDir}`,
			`--cold-dir=${coldDir}`,
			`--registry-db-url=${registryDbUrl}`,
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

		test("service_migrations table exists and has initial migration applied", async () => {
			const result = await pgClient.query<{ name: string }>(
				"SELECT name FROM service_migrations ORDER BY id",
			);
			expect(result.rows.map((r) => r.name)).toEqual(["1710000000000_initial"]);
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
				expect(result.rows.map((r) => r.name)).toEqual(["1710000000000_initial"]);
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
			headers: { Authorization: "Bearer wrong", "Content-Type": "application/json" },
			body: JSON.stringify({ slug: "x" }),
		});
		expect(res.status).toBe(401);
	});

	test("POST /admin/tenants with invalid slug returns 400", async () => {
		const res = await fetch(`${base}/admin/tenants`, {
			method: "POST",
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
			body: JSON.stringify({ slug: "Invalid Slug!" }),
		});
		expect(res.status).toBe(400);
	});

	test("POST /admin/tenants creates tenant and stores in postgres registry", async () => {
		const res = await fetch(`${base}/admin/tenants`, {
			method: "POST",
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
			body: JSON.stringify({ slug: "alice" }),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.token).toBeTruthy();
		expect(body.tenant.slug).toBe("alice");
		expect(body.tenant.state).toBe("running");
		aliceToken = body.token;
	});

	test("duplicate slug returns 409", async () => {
		const res = await fetch(`${base}/admin/tenants`, {
			method: "POST",
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
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
				headers: { Authorization: `Bearer ${aliceToken}`, "Content-Type": "application/json" },
				body: JSON.stringify({ email: "alice@test.com", password: "password123" }),
			});
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.user?.email).toBe("alice@test.com");
		});

		test("wrong tenant token is rejected at proxy level (401)", async () => {
			const res = await fetch(`${base}/alice/auth/v1/signup`, {
				method: "POST",
				headers: { Authorization: "Bearer wrong-token", "Content-Type": "application/json" },
				body: JSON.stringify({ email: "x@test.com", password: "pw" }),
			});
			expect(res.status).toBe(401);
		});

		test("unknown slug returns 404 at proxy level", async () => {
			const res = await fetch(`${base}/nonexistent/auth/v1/signup`, {
				method: "POST",
				headers: { Authorization: "Bearer any-token", "Content-Type": "application/json" },
				body: JSON.stringify({ email: "x@test.com", password: "pw" }),
			});
			expect(res.status).toBe(404);
		});

		test("slug is stripped from path before forwarding to tenant", async () => {
			const res = await fetch(`${base}/alice/rest/v1/nonexistent_table`, {
				headers: { Authorization: `Bearer ${aliceToken}` },
			});
			const body = await res.json();
			expect(body).toMatchObject({ message: expect.stringContaining("nonexistent_table") });
		});

		test("per-tenant isolation: alice and bob have separate databases", async () => {
			const bobRes = await fetch(`${base}/admin/tenants`, {
				method: "POST",
				headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
				body: JSON.stringify({ slug: "bob" }),
			});
			bobToken = (await bobRes.json()).token;

			await fetch(`${base}/bob/auth/v1/signup`, {
				method: "POST",
				headers: { Authorization: `Bearer ${bobToken}`, "Content-Type": "application/json" },
				body: JSON.stringify({ email: "bob@test.com", password: "password123" }),
			});

			const aliceSignIn = await fetch(`${base}/alice/auth/v1/token?grant_type=password`, {
				method: "POST",
				headers: { Authorization: `Bearer ${aliceToken}`, "Content-Type": "application/json" },
				body: JSON.stringify({ email: "alice@test.com", password: "password123" }),
			});
			const bobSignIn = await fetch(`${base}/bob/auth/v1/token?grant_type=password`, {
				method: "POST",
				headers: { Authorization: `Bearer ${bobToken}`, "Content-Type": "application/json" },
				body: JSON.stringify({ email: "bob@test.com", password: "password123" }),
			});

			const aliceSession = await aliceSignIn.json();
			const bobSession = await bobSignIn.json();
			expect(aliceSession.access_token).toBeTruthy();
			expect(bobSession.access_token).toBeTruthy();
			expect(aliceSession.user?.id).not.toBe(bobSession.user?.id);
		});

		test("cross-tenant token is rejected by proxy (401)", async () => {
			const res = await fetch(`${base}/bob/auth/v1/signup`, {
				method: "POST",
				headers: { Authorization: `Bearer ${aliceToken}`, "Content-Type": "application/json" },
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

			const signIn = await fetch(`${base}/alice/auth/v1/token?grant_type=password`, {
				method: "POST",
				headers: { Authorization: `Bearer ${aliceToken}`, "Content-Type": "application/json" },
				body: JSON.stringify({ email: "alice@test.com", password: "password123" }),
			});
			expect(signIn.status).toBe(200);
			expect((await signIn.json()).access_token).toBeTruthy();
		}, 30_000);

		test("sleeping tenant auto-wakes on first proxy request", async () => {
			await fetch(`${base}/admin/tenants/alice/pause`, {
				method: "POST",
				headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
			});

			const res = await fetch(`${base}/alice/auth/v1/token?grant_type=password`, {
				method: "POST",
				headers: { Authorization: `Bearer ${aliceToken}`, "Content-Type": "application/json" },
				body: JSON.stringify({ email: "alice@test.com", password: "password123" }),
			});
			expect(res.status).toBe(200);
			expect((await res.json()).access_token).toBeTruthy();
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

			const withNew = await fetch(`${base}/alice/auth/v1/token?grant_type=password`, {
				method: "POST",
				headers: { Authorization: `Bearer ${newToken}`, "Content-Type": "application/json" },
				body: JSON.stringify({ email: "alice@test.com", password: "password123" }),
			});
			expect(withNew.status).toBe(200);
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
				expect(tenants.some((t: { slug: string }) => t.slug === "alice")).toBe(true);
				expect(tenants.some((t: { slug: string }) => t.slug === "bob")).toBe(true);
				svcProcess = restartedProcess;
			} catch (e) {
				restartedProcess.kill("SIGTERM");
				throw e;
			}
		}, 60_000);
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

describe("circuit breaker", () => {
	let svcProcess: ChildProcess;
	let dataDir: string;
	let coldDir: string;
	const port = 54475;
	const base = `http://localhost:${port}`;

	beforeAll(async () => {
		dataDir = mkdtempSync(join(tmpdir(), "nano-svc-cb-data-"));
		coldDir = mkdtempSync(join(tmpdir(), "nano-svc-cb-cold-"));
		svcProcess = startService(port, dataDir, coldDir, ["--circuit-breaker-threshold=3"]);
		await waitForHealth(base);
	}, 60_000);

	afterAll(async () => {
		svcProcess?.kill("SIGTERM");
		await new Promise((r) => setTimeout(r, 500));
		rmSync(dataDir, { recursive: true, force: true });
		rmSync(coldDir, { recursive: true, force: true });
	});

	test("tenant is auto-paused after N consecutive 5xx responses", async () => {
		const createRes = await fetch(`${base}/admin/tenants`, {
			method: "POST",
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
			body: JSON.stringify({ slug: "cb-trip" }),
		});
		expect(createRes.status).toBe(201);
		const { token } = await createRes.json();

		await fetch(`${base}/admin/tenants/cb-trip/sql`, {
			method: "POST",
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
			body: JSON.stringify({ sql: "DROP TABLE auth.users CASCADE" }),
		});

		for (let i = 0; i < 3; i++) {
			const res = await fetch(`${base}/cb-trip/auth/v1/signup`, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ email: `user${i}@test.com`, password: "password123" }),
			});
			expect(res.status).toBe(500);
		}

		const tenantRes = await fetch(`${base}/admin/tenants/cb-trip`, {
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		expect(tenantRes.status).toBe(200);
		const tenant = await tenantRes.json();
		expect(tenant.state).toBe("sleeping");
	}, 30_000);

	test("consecutive error counter resets on a successful request before threshold", async () => {
		const createRes = await fetch(`${base}/admin/tenants`, {
			method: "POST",
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
			body: JSON.stringify({ slug: "cb-reset" }),
		});
		expect(createRes.status).toBe(201);
		const { token } = await createRes.json();

		await fetch(`${base}/admin/tenants/cb-reset/sql`, {
			method: "POST",
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
			body: JSON.stringify({ sql: "DROP TABLE auth.users CASCADE" }),
		});

		for (let i = 0; i < 2; i++) {
			const res = await fetch(`${base}/cb-reset/auth/v1/signup`, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ email: `user${i}@test.com`, password: "password123" }),
			});
			expect(res.status).toBe(500);
		}

		await fetch(`${base}/admin/tenants/cb-reset/sql`, {
			method: "POST",
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
			body: JSON.stringify({ sql: "CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE, encrypted_password text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), role text DEFAULT 'authenticated', aud text DEFAULT 'authenticated', confirmation_token text, email_confirmed_at timestamptz, raw_app_meta_data jsonb DEFAULT '{}'::jsonb, raw_user_meta_data jsonb DEFAULT '{}'::jsonb)" }),
		});

		const successRes = await fetch(`${base}/cb-reset/auth/v1/signup`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ email: "success@test.com", password: "password123" }),
		});
		expect(successRes.status).toBe(200);

		await fetch(`${base}/admin/tenants/cb-reset/sql`, {
			method: "POST",
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, "Content-Type": "application/json" },
			body: JSON.stringify({ sql: "DROP TABLE auth.users CASCADE" }),
		});

		for (let i = 0; i < 2; i++) {
			const res = await fetch(`${base}/cb-reset/auth/v1/signup`, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ email: `after${i}@test.com`, password: "password123" }),
			});
			expect(res.status).toBe(500);
		}

		const tenantRes = await fetch(`${base}/admin/tenants/cb-reset`, {
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		expect(tenantRes.status).toBe(200);
		const tenant = await tenantRes.json();
		expect(tenant.state).toBe("running");
	}, 30_000);
});
