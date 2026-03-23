/**
 * CLI Behavioural Tests
 *
 * Starts the real server binary and exercises every CLI command end-to-end,
 * from a user's perspective: migrations, users, storage, type generation, etc.
 */

import { type ChildProcess, spawn } from "node:child_process";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, test } from "vitest";
import {
	cmdDbDump,
	cmdDbExec,
	cmdDbReset,
	cmdGenTypes,
	cmdMigrationList,
	cmdMigrationNew,
	cmdMigrationUp,
	cmdStatus,
	cmdStorageCreateBucket,
	cmdStorageListBuckets,
	cmdStorageLs,
	cmdSyncPull,
	cmdSyncPush,
	cmdUsersCreate,
	cmdUsersDelete,
	cmdUsersGet,
	cmdUsersList,
} from "../src/cli-commands.ts";
import { assertEquals, assertExists } from "./compat.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "../dist/cli.js");
const KEY = "local-service-role-key";

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.listen(0, () => {
			const { port } = srv.address() as { port: number };
			srv.close((err) => (err ? reject(err) : resolve(port)));
		});
	});
}

async function startServer(
	httpPort: number,
	tcpPort: number,
): Promise<ChildProcess> {
	return spawn(
		"node",
		[CLI, "start", `--http-port=${httpPort}`, `--tcp-port=${tcpPort}`],
		{ stdio: "ignore", detached: false },
	);
}

function tcpProbe(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const sock = connect({ host, port });
		sock.once("connect", () => { sock.destroy(); resolve(true); });
		sock.once("error", () => resolve(false));
	});
}

async function waitForHealth(url: string, timeout = 30_000): Promise<void> {
	const { hostname, port } = new URL(url);
	const deadline = Date.now() + timeout;
	let delay = 100;
	while (Date.now() < deadline) {
		if (await tcpProbe(hostname, Number(port))) return;
		await new Promise((r) => setTimeout(r, delay));
		delay = Math.min(delay * 1.5, 1000);
	}
	throw new Error(`Server at ${url} did not become healthy within timeout`);
}

let server: ChildProcess;
let serverUrl: string;
let serverArgs: string[];

let remoteServer: ChildProcess;
let remoteUrl: string;
let remoteDbUrl: string;
let syncArgs: string[];

let migrationsDir: string;
let migrationCounter = 0;

function nextVersion(): string {
	migrationCounter += 1;
	return String(migrationCounter).padStart(6, "0");
}

beforeAll(async () => {
	const [httpPort, tcpPort, remoteHttpPort, remoteTcpPort] = await Promise.all([
		freePort(),
		freePort(),
		freePort(),
		freePort(),
	]);

	serverUrl = `http://localhost:${httpPort}`;
	remoteUrl = `http://localhost:${remoteHttpPort}`;
	remoteDbUrl = `postgresql://postgres@127.0.0.1:${remoteTcpPort}/postgres`;
	serverArgs = [`--url=${serverUrl}`, `--service-role-key=${KEY}`, "--json"];
	syncArgs = [
		`--url=${serverUrl}`,
		`--service-role-key=${KEY}`,
		`--remote-url=${remoteUrl}`,
		`--remote-service-role-key=${KEY}`,
		`--remote-db-url=${remoteDbUrl}`,
		"--json",
	];

	migrationsDir = mkdtempSync(join(tmpdir(), "nano-cli-test-migrations-"));

	[server, remoteServer] = await Promise.all([
		startServer(httpPort, tcpPort),
		startServer(remoteHttpPort, remoteTcpPort),
	]);

	await Promise.all([waitForHealth(serverUrl), waitForHealth(remoteUrl)]);
});

afterAll(() => {
	server.kill("SIGTERM");
	remoteServer.kill("SIGTERM");
	rmSync(migrationsDir, { recursive: true, force: true });
});

describe("status", () => {
	test("reports server as running when it is up", async () => {
		const result = await cmdStatus(serverArgs);
		assertEquals(result.exitCode, 0);
		const data = JSON.parse(result.output);
		assertEquals(data.running, true);
		assertEquals(data.url, serverUrl);
	});

	test("reports server as not running when nothing is listening", async () => {
		const result = await cmdStatus([`--url=http://localhost:19999`, "--json"]);
		assertEquals(result.exitCode, 0);
		const data = JSON.parse(result.output);
		assertEquals(data.running, false);
	});
});

describe("db exec", () => {
	test("creates a table and inserts a row", async () => {
		const create = await cmdDbExec([
			...serverArgs,
			"--sql",
			"CREATE TABLE cli_test (id SERIAL PRIMARY KEY, label TEXT)",
		]);
		assertEquals(create.exitCode, 0);

		const insert = await cmdDbExec([
			...serverArgs,
			"--sql",
			"INSERT INTO cli_test (label) VALUES ('hello')",
		]);
		assertEquals(insert.exitCode, 0);

		const select = await cmdDbExec([
			...serverArgs,
			"--sql",
			"SELECT label FROM cli_test WHERE id = 1",
		]);
		assertEquals(select.exitCode, 0);
		const data = JSON.parse(select.output);
		assertEquals(data.rows[0].label, "hello");
	});

	test("returns error on invalid SQL", async () => {
		const result = await cmdDbExec([...serverArgs, "--sql", "NOT VALID SQL"]);
		assertEquals(result.exitCode, 1);
	});

	test("executes SQL from a file", async () => {
		const sqlFile = join(tmpdir(), "nano-cli-test-from-file.sql");
		writeFileSync(sqlFile, "SELECT 1 + 1 AS sum");
		const result = await cmdDbExec([...serverArgs, "--file", sqlFile]);
		assertEquals(result.exitCode, 0);
		const data = JSON.parse(result.output);
		assertEquals(data.rows[0].sum, 2);
	});

	test("fails when neither --sql nor --file provided", async () => {
		const result = await cmdDbExec(serverArgs);
		assertEquals(result.exitCode, 1);
		const data = JSON.parse(result.output);
		assertEquals(data.error, "missing_sql");
	});
});

describe("db dump", () => {
	test("returns DDL for existing tables", async () => {
		const result = await cmdDbDump(serverArgs);
		assertEquals(result.exitCode, 0);
		assertExists(result.output);
	});
});

describe("db reset", () => {
	test("drops all public tables when --confirm is passed", async () => {
		await cmdDbExec([
			...serverArgs,
			"--sql",
			"CREATE TABLE to_be_dropped (id INT)",
		]);

		const result = await cmdDbReset([...serverArgs, "--confirm"]);
		assertEquals(result.exitCode, 0);
		const data = JSON.parse(result.output);
		assertExists(data.dropped_tables);

		const check = await cmdDbExec([
			...serverArgs,
			"--sql",
			"SELECT count(*) FROM to_be_dropped",
		]);
		assertEquals(check.exitCode, 1);
	});

	test("refuses to reset without --confirm", async () => {
		const result = await cmdDbReset(serverArgs);
		assertEquals(result.exitCode, 1);
		const data = JSON.parse(result.output);
		assertEquals(data.error, "confirmation_required");
	});
});

describe("migrations", () => {
	test("full workflow: new → list pending → up → list applied", async () => {
		const args = [...serverArgs, `--migrations-dir=${migrationsDir}`];

		const v1 = nextVersion();
		const create1 = await cmdMigrationNew([...args, `--version=${v1}`, "create_products"]);
		assertEquals(create1.exitCode, 0);
		const { file: file1 } = JSON.parse(create1.output);
		assertExists(file1);
		writeFileSync(
			file1,
			"CREATE TABLE products (id SERIAL PRIMARY KEY, name TEXT NOT NULL)",
		);

		const v2 = nextVersion();
		const create2 = await cmdMigrationNew([...args, `--version=${v2}`, "add_price"]);
		assertEquals(create2.exitCode, 0);
		const { file: file2 } = JSON.parse(create2.output);
		writeFileSync(
			file2,
			"ALTER TABLE products ADD COLUMN price NUMERIC DEFAULT 0",
		);

		const listBefore = await cmdMigrationList(args);
		assertEquals(listBefore.exitCode, 0);
		const before = JSON.parse(listBefore.output);
		assertEquals(before.applied.length, 0);
		assertEquals(before.pending.length, 2);

		const up = await cmdMigrationUp(args);
		assertEquals(up.exitCode, 0);
		const upData = JSON.parse(up.output);
		assertEquals(upData.results.length, 2);
		assertEquals(upData.results[0].status, "applied");
		assertEquals(upData.results[1].status, "applied");

		const listAfter = await cmdMigrationList(args);
		const after = JSON.parse(listAfter.output);
		assertEquals(after.applied.length, 2);
		assertEquals(after.pending.length, 0);

		const verify = await cmdDbExec([
			...serverArgs,
			"--sql",
			"SELECT name, price FROM products LIMIT 0",
		]);
		assertEquals(verify.exitCode, 0);

		const tracked = await cmdDbExec([
			...serverArgs,
			"--sql",
			"SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version",
		]);
		assertEquals(tracked.exitCode, 0);
		const trackedData = JSON.parse(tracked.output);
		assertEquals(trackedData.rows.length, 2);
		assertExists(trackedData.rows[0].version);
		assertExists(trackedData.rows[0].name);
	});

	test("migration new fails without a name", async () => {
		const result = await cmdMigrationNew([
			...serverArgs,
			`--migrations-dir=${migrationsDir}`,
		]);
		assertEquals(result.exitCode, 1);
		const data = JSON.parse(result.output);
		assertEquals(data.error, "missing_name");
	});

	test("up is a no-op when migrations dir does not exist", async () => {
		const result = await cmdMigrationUp([
			...serverArgs,
			"--migrations-dir=/nonexistent/path",
		]);
		assertEquals(result.exitCode, 0);
		const data = JSON.parse(result.output);
		assertEquals(data.results, []);
	});

	test("up applies migration with multiple statements", async () => {
		const args = [...serverArgs, `--migrations-dir=${migrationsDir}`];
		const v = nextVersion();
		const create = await cmdMigrationNew([...args, `--version=${v}`, "multi_statement"]);
		assertEquals(create.exitCode, 0);
		const { file } = JSON.parse(create.output);
		writeFileSync(
			file,
			[
				"CREATE TABLE categories (id SERIAL PRIMARY KEY, label TEXT NOT NULL);",
				"CREATE TABLE items (id SERIAL PRIMARY KEY, category_id INT REFERENCES categories(id));",
			].join("\n"),
		);

		const up = await cmdMigrationUp(args);
		assertEquals(up.exitCode, 0);
		const upData = JSON.parse(up.output);
		const result = upData.results.find((r: { file: string }) =>
			r.file.includes("multi_statement"),
		);
		assertEquals(result.status, "applied");

		const verify = await cmdDbExec([
			...serverArgs,
			"--sql",
			"SELECT id FROM categories LIMIT 0",
		]);
		assertEquals(verify.exitCode, 0);
	});
});

describe("users", () => {
	test("full workflow: create → list → get → delete", async () => {
		const createResult = await cmdUsersCreate([
			...serverArgs,
			"--email=cli-test@example.com",
			"--password=secret123",
		]);
		assertEquals(createResult.exitCode, 0);
		const user = JSON.parse(createResult.output);
		assertExists(user.id);
		assertEquals(user.email, "cli-test@example.com");
		const userId = user.id;

		const listResult = await cmdUsersList(serverArgs);
		assertEquals(listResult.exitCode, 0);
		const listData = JSON.parse(listResult.output);
		const users: Array<{ id: string; email: string }> = Array.isArray(listData)
			? listData
			: (listData.users ?? []);
		assertExists(users.find((u) => u.email === "cli-test@example.com"));

		const getResult = await cmdUsersGet([...serverArgs, userId]);
		assertEquals(getResult.exitCode, 0);
		const fetched = JSON.parse(getResult.output);
		assertEquals(fetched.id, userId);
		assertEquals(fetched.email, "cli-test@example.com");

		const deleteResult = await cmdUsersDelete([
			...serverArgs,
			userId,
			"--confirm",
		]);
		assertEquals(deleteResult.exitCode, 0);

		const checkResult = await cmdUsersGet([...serverArgs, userId]);
		assertEquals(checkResult.exitCode, 1);
	});

	test("refuses to delete without --confirm", async () => {
		const result = await cmdUsersDelete([...serverArgs, "some-id"]);
		assertEquals(result.exitCode, 1);
		const data = JSON.parse(result.output);
		assertEquals(data.error, "confirmation_required");
	});

	test("create fails without email", async () => {
		const result = await cmdUsersCreate([
			...serverArgs,
			"--password=secret123",
		]);
		assertEquals(result.exitCode, 1);
		const data = JSON.parse(result.output);
		assertEquals(data.error, "missing_email");
	});
});

describe("storage", () => {
	test("creates a bucket", async () => {
		const result = await cmdStorageCreateBucket([
			...serverArgs,
			"cli-test-bucket",
		]);
		assertEquals(result.exitCode, 0);
		const data = JSON.parse(result.output);
		assertExists(data);
	});

	test("lists buckets and includes the created bucket", async () => {
		const result = await cmdStorageListBuckets(serverArgs);
		assertEquals(result.exitCode, 0);
		const buckets: Array<{ name: string }> = JSON.parse(result.output);
		assertExists(buckets.find((b) => b.name === "cli-test-bucket"));
	});

	test("lists objects in a bucket", async () => {
		const result = await cmdStorageLs([...serverArgs, "cli-test-bucket"]);
		assertEquals(result.exitCode, 0);
	});

	test("create bucket fails without a name", async () => {
		const result = await cmdStorageCreateBucket(serverArgs);
		assertEquals(result.exitCode, 1);
		const data = JSON.parse(result.output);
		assertEquals(data.error, "missing_name");
	});
});

describe("gen types", () => {
	test("generates TypeScript types for existing tables", async () => {
		await cmdDbExec([
			...serverArgs,
			"--sql",
			"CREATE TABLE IF NOT EXISTS typed_items (id SERIAL PRIMARY KEY, label TEXT, active BOOLEAN, score NUMERIC)",
		]);

		const result = await cmdGenTypes(serverArgs);
		assertEquals(result.exitCode, 0);
		assertExists(result.output.includes("typed_items"));
		assertExists(result.output.includes("export interface Database"));
		assertExists(result.output.includes("Tables"));
	});

	test("writes types to a file when --output is given", async () => {
		const outFile = join(migrationsDir, "database.types.ts");
		const result = await cmdGenTypes([...serverArgs, `--output=${outFile}`]);
		assertEquals(result.exitCode, 0);
		const data = JSON.parse(result.output);
		assertEquals(data.file, outFile);

		const content = readFileSync(outFile, "utf-8");
		assertExists(content.includes("export interface Database"));
	});
});

describe("sync", () => {
	let syncMigrationsDir: string;

	beforeAll(() => {
		syncMigrationsDir = mkdtempSync(
			join(tmpdir(), "nano-sync-test-migrations-"),
		);
	});

	afterAll(() => {
		rmSync(syncMigrationsDir, { recursive: true, force: true });
	});

	test("push applies local migrations to remote", async () => {
		const migArgs = [...serverArgs, `--migrations-dir=${syncMigrationsDir}`];
		const v = nextVersion();
		const newResult = await cmdMigrationNew([
			...migArgs,
			`--version=${v}`,
			"sync_push_table",
		]);
		assertEquals(newResult.exitCode, 0);
		const { file } = JSON.parse(newResult.output);
		writeFileSync(
			file,
			"CREATE TABLE sync_push_items (id SERIAL PRIMARY KEY, label TEXT)",
		);

		const localUp = await cmdMigrationUp(migArgs);
		assertEquals(localUp.exitCode, 0);

		const pushResult = await cmdSyncPush([
			...syncArgs,
			`--migrations-dir=${syncMigrationsDir}`,
			"--no-storage",
		]);
		assertEquals(pushResult.exitCode, 0);
		const pushData = JSON.parse(pushResult.output);
		assertEquals(pushData.migrations.applied, 1);

		const remoteCheck = await cmdDbExec([
			`--url=${remoteUrl}`,
			`--service-role-key=${KEY}`,
			"--json",
			"--sql",
			"SELECT count(*) AS c FROM information_schema.tables WHERE table_name = 'sync_push_items'",
		]);
		assertEquals(remoteCheck.exitCode, 0);
		const remoteData = JSON.parse(remoteCheck.output);
		assertEquals(Number(remoteData.rows[0].c), 1);
	});

	test("push skips already-applied migrations", async () => {
		const pushResult = await cmdSyncPush([
			...syncArgs,
			`--migrations-dir=${syncMigrationsDir}`,
			"--no-storage",
		]);
		assertEquals(pushResult.exitCode, 0);
		const pushData = JSON.parse(pushResult.output);
		assertEquals(pushData.migrations.applied, 0);
		assertEquals(pushData.migrations.skipped, 1);
	});

	test("push creates missing buckets on remote", async () => {
		await cmdStorageCreateBucket([...serverArgs, "sync-push-bucket"]);

		const pushResult = await cmdSyncPush([
			...syncArgs,
			`--migrations-dir=${syncMigrationsDir}`,
			"--no-migrations",
		]);
		assertEquals(pushResult.exitCode, 0);
		const pushData = JSON.parse(pushResult.output);
		assertExists(pushData.buckets.upserted >= 1);

		const remoteBuckets = await fetch(`${remoteUrl}/storage/v1/bucket`, {
			headers: { Authorization: `Bearer ${KEY}` },
		});
		const bucketsData = (await remoteBuckets.json()) as Array<{ name: string }>;
		assertExists(bucketsData.find((b) => b.name === "sync-push-bucket"));
	});

	test("pull creates missing buckets on local", async () => {
		await fetch(`${remoteUrl}/storage/v1/bucket`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				id: "sync-pull-bucket",
				name: "sync-pull-bucket",
				public: false,
			}),
		});

		const pullResult = await cmdSyncPull([
			...syncArgs,
			`--migrations-dir=${syncMigrationsDir}`,
			"--no-migrations",
		]);
		assertEquals(pullResult.exitCode, 0);
		const pullData = JSON.parse(pullResult.output);
		assertExists(pullData.buckets.upserted >= 1);

		const localBuckets = await fetch(`${serverUrl}/storage/v1/bucket`, {
			headers: { Authorization: `Bearer ${KEY}` },
		});
		const bucketsData = (await localBuckets.json()) as Array<{ name: string }>;
		assertExists(bucketsData.find((b) => b.name === "sync-pull-bucket"));
	});

	test("dry-run does not apply changes", async () => {
		const dryRunDir = mkdtempSync(join(tmpdir(), "nano-sync-dryrun-"));
		try {
			const v = nextVersion();
			const newResult = await cmdMigrationNew([
				...serverArgs,
				`--migrations-dir=${dryRunDir}`,
				`--version=${v}`,
				"dryrun_table",
			]);
			const { file } = JSON.parse(newResult.output);
			writeFileSync(file, "CREATE TABLE dryrun_items (id SERIAL PRIMARY KEY)");

			const pushResult = await cmdSyncPush([
				...syncArgs,
				`--migrations-dir=${dryRunDir}`,
				"--no-storage",
				"--dry-run",
			]);
			assertEquals(pushResult.exitCode, 0);
			const pushData = JSON.parse(pushResult.output);
			assertEquals(pushData.migrations.applied, 1);

			const remoteCheck = await cmdDbExec([
				`--url=${remoteUrl}`,
				`--service-role-key=${KEY}`,
				"--json",
				"--sql",
				"SELECT count(*) AS c FROM information_schema.tables WHERE table_name = 'dryrun_items'",
			]);
			assertEquals(remoteCheck.exitCode, 0);
			assertEquals(Number(JSON.parse(remoteCheck.output).rows[0].c), 0);
		} finally {
			rmSync(dryRunDir, { recursive: true, force: true });
		}
	});

	test("pull from remote with empty schema_migrations falls back to schema snapshot", async () => {
		const emptyPullDir = mkdtempSync(join(tmpdir(), "nano-sync-empty-pull-"));
		try {
			const remoteReset = await cmdDbReset([
				`--url=${remoteUrl}`,
				`--service-role-key=${KEY}`,
				"--json",
				"--confirm",
			]);
			assertEquals(remoteReset.exitCode, 0);

			await cmdDbExec([
				`--url=${remoteUrl}`,
				`--service-role-key=${KEY}`,
				"--json",
				"--sql",
				"CREATE TABLE pulled_empty_source (id SERIAL PRIMARY KEY, label TEXT)",
			]);

			const pullResult = await cmdSyncPull([
				...syncArgs,
				`--migrations-dir=${emptyPullDir}`,
				"--no-storage",
			]);
			assertEquals(pullResult.exitCode, 0);
			const pullData = JSON.parse(pullResult.output);
			assertEquals(pullData.migrations.written, 1);

			const files = readdirSync(emptyPullDir).filter((f: string) =>
				f.endsWith(".sql"),
			);
			assertEquals(files.length, 1);
			const content = readFileSync(join(emptyPullDir, files[0]), "utf-8");
			assertExists(content.includes("pulled_empty_source"));
		} finally {
			rmSync(emptyPullDir, { recursive: true, force: true });
		}
	});

	test("push to remote without supabase_migrations table creates it and tracks migrations", async () => {
		const noTableDir = mkdtempSync(join(tmpdir(), "nano-sync-notable-"));
		try {
			await cmdDbExec([
				`--url=${remoteUrl}`,
				`--service-role-key=${KEY}`,
				"--json",
				"--sql",
				"DROP SCHEMA IF EXISTS supabase_migrations CASCADE",
			]);

			const v = nextVersion();
			const newResult = await cmdMigrationNew([
				...serverArgs,
				`--migrations-dir=${noTableDir}`,
				`--version=${v}`,
				"notable_items",
			]);
			assertEquals(newResult.exitCode, 0);
			const { file } = JSON.parse(newResult.output);
			writeFileSync(
				file,
				"CREATE TABLE notable_items (id SERIAL PRIMARY KEY, label TEXT)",
			);

			const pushResult = await cmdSyncPush([
				...syncArgs,
				`--migrations-dir=${noTableDir}`,
				"--no-storage",
			]);
			assertEquals(pushResult.exitCode, 0);
			const pushData = JSON.parse(pushResult.output);
			assertEquals(pushData.migrations.applied, 1);

			const tracked = await cmdDbExec([
				`--url=${remoteUrl}`,
				`--service-role-key=${KEY}`,
				"--json",
				"--sql",
				"SELECT version FROM supabase_migrations.schema_migrations",
			]);
			assertEquals(tracked.exitCode, 0);
			const trackedData = JSON.parse(tracked.output);
			assertEquals(trackedData.rows.length, 1);
		} finally {
			rmSync(noTableDir, { recursive: true, force: true });
		}
	});

	test("push fails when --remote-db-url is missing and migrations not skipped", async () => {
		const result = await cmdSyncPush([
			`--url=${serverUrl}`,
			`--service-role-key=${KEY}`,
			`--remote-url=${remoteUrl}`,
			`--remote-service-role-key=${KEY}`,
			"--json",
		]);
		assertEquals(result.exitCode, 1);
		const data = JSON.parse(result.output);
		assertEquals(data.error, "missing_remote_db_url");
	});
});
