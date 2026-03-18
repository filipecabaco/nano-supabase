/**
 * CLI Behavioural Tests
 *
 * Starts the real server binary and exercises every CLI command end-to-end,
 * from a user's perspective: migrations, users, storage, type generation, etc.
 */

import { describe, test, beforeAll, afterAll } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertEquals,
  assertExists,
} from "./compat.ts";
import {
  cmdStatus,
  cmdDbExec,
  cmdDbDump,
  cmdDbReset,
  cmdMigrationNew,
  cmdMigrationList,
  cmdMigrationUp,
  cmdUsersList,
  cmdUsersCreate,
  cmdUsersGet,
  cmdUsersDelete,
  cmdStorageListBuckets,
  cmdStorageCreateBucket,
  cmdStorageLs,
  cmdGenTypes,
} from "../src/cli-commands.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "../dist/cli.js");
const HTTP_PORT = 54388;
const TCP_PORT = 54389;
const URL = `http://localhost:${HTTP_PORT}`;
const KEY = "local-service-role-key";
const ARGS = [`--url=${URL}`, `--service-role-key=${KEY}`, "--json"];

let server: ChildProcess;
let migrationsDir: string;

async function waitForHealth(timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${URL}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server did not become healthy within timeout");
}

beforeAll(async () => {
  migrationsDir = mkdtempSync(join(tmpdir(), "nano-cli-test-migrations-"));
  server = spawn("node", [CLI, "start", `--http-port=${HTTP_PORT}`, `--tcp-port=${TCP_PORT}`], {
    stdio: "ignore",
    detached: false,
  });
  await waitForHealth();
});

afterAll(() => {
  server.kill("SIGTERM");
  rmSync(migrationsDir, { recursive: true, force: true });
});

describe("status", () => {
  test("reports server as running when it is up", async () => {
    const result = await cmdStatus(ARGS);
    assertEquals(result.exitCode, 0);
    const data = JSON.parse(result.output);
    assertEquals(data.running, true);
    assertEquals(data.url, URL);
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
    const create = await cmdDbExec([...ARGS, "--sql", "CREATE TABLE cli_test (id SERIAL PRIMARY KEY, label TEXT)"]);
    assertEquals(create.exitCode, 0);

    const insert = await cmdDbExec([...ARGS, "--sql", "INSERT INTO cli_test (label) VALUES ('hello')"]);
    assertEquals(insert.exitCode, 0);

    const select = await cmdDbExec([...ARGS, "--sql", "SELECT label FROM cli_test WHERE id = 1"]);
    assertEquals(select.exitCode, 0);
    const data = JSON.parse(select.output);
    assertEquals(data.rows[0].label, "hello");
  });

  test("returns error on invalid SQL", async () => {
    const result = await cmdDbExec([...ARGS, "--sql", "NOT VALID SQL"]);
    assertEquals(result.exitCode, 1);
  });

  test("executes SQL from a file", async () => {
    const sqlFile = join(tmpdir(), "nano-cli-test-from-file.sql");
    writeFileSync(sqlFile, "SELECT 1 + 1 AS sum");
    const result = await cmdDbExec([...ARGS, "--file", sqlFile]);
    assertEquals(result.exitCode, 0);
    const data = JSON.parse(result.output);
    assertEquals(data.rows[0].sum, 2);
  });

  test("fails when neither --sql nor --file provided", async () => {
    const result = await cmdDbExec(ARGS);
    assertEquals(result.exitCode, 1);
    const data = JSON.parse(result.output);
    assertEquals(data.error, "missing_sql");
  });
});

describe("db dump", () => {
  test("returns DDL for existing tables", async () => {
    const result = await cmdDbDump(ARGS);
    assertEquals(result.exitCode, 0);
    assertExists(result.output);
  });
});

describe("db reset", () => {
  test("drops all public tables when --confirm is passed", async () => {
    await cmdDbExec([...ARGS, "--sql", "CREATE TABLE to_be_dropped (id INT)"]);

    const result = await cmdDbReset([...ARGS, "--confirm"]);
    assertEquals(result.exitCode, 0);
    const data = JSON.parse(result.output);
    assertExists(data.dropped_tables);

    const check = await cmdDbExec([...ARGS, "--sql", "SELECT count(*) FROM to_be_dropped"]);
    assertEquals(check.exitCode, 1);
  });

  test("refuses to reset without --confirm", async () => {
    const result = await cmdDbReset(ARGS);
    assertEquals(result.exitCode, 1);
    const data = JSON.parse(result.output);
    assertEquals(data.error, "confirmation_required");
  });
});

describe("migrations", () => {
  test("full workflow: new → list pending → up → list applied", async () => {
    const args = [...ARGS, `--migrations-dir=${migrationsDir}`];

    const create1 = await cmdMigrationNew([...args, "create_products"]);
    assertEquals(create1.exitCode, 0);
    const { file: file1 } = JSON.parse(create1.output);
    assertExists(file1);
    writeFileSync(file1, "CREATE TABLE products (id SERIAL PRIMARY KEY, name TEXT NOT NULL)");

    // Wait 1s so the second migration gets a later timestamp and sorts after the first
    await new Promise((r) => setTimeout(r, 1000));

    const create2 = await cmdMigrationNew([...args, "add_price"]);
    assertEquals(create2.exitCode, 0);
    const { file: file2 } = JSON.parse(create2.output);
    writeFileSync(file2, "ALTER TABLE products ADD COLUMN price NUMERIC DEFAULT 0");

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

    const verify = await cmdDbExec([...ARGS, "--sql", "SELECT name, price FROM products LIMIT 0"]);
    assertEquals(verify.exitCode, 0);
  });

  test("migration new fails without a name", async () => {
    const result = await cmdMigrationNew([...ARGS, `--migrations-dir=${migrationsDir}`]);
    assertEquals(result.exitCode, 1);
    const data = JSON.parse(result.output);
    assertEquals(data.error, "missing_name");
  });

  test("up is a no-op when migrations dir does not exist", async () => {
    const result = await cmdMigrationUp([...ARGS, "--migrations-dir=/nonexistent/path"]);
    assertEquals(result.exitCode, 0);
    const data = JSON.parse(result.output);
    assertEquals(data.results, []);
  });
});

describe("users", () => {
  let userId: string;

  test("creates a user", async () => {
    const result = await cmdUsersCreate([...ARGS, "--email=cli-test@example.com", "--password=secret123"]);
    assertEquals(result.exitCode, 0);
    const user = JSON.parse(result.output);
    assertExists(user.id);
    assertEquals(user.email, "cli-test@example.com");
    userId = user.id;
  });

  test("lists users and finds the created user", async () => {
    const result = await cmdUsersList(ARGS);
    assertEquals(result.exitCode, 0);
    const data = JSON.parse(result.output);
    const users: Array<{ id: string; email: string }> = Array.isArray(data) ? data : data.users ?? [];
    assertExists(users.find((u) => u.email === "cli-test@example.com"));
  });

  test("gets a user by ID", async () => {
    const result = await cmdUsersGet([...ARGS, userId]);
    assertEquals(result.exitCode, 0);
    const user = JSON.parse(result.output);
    assertEquals(user.id, userId);
    assertEquals(user.email, "cli-test@example.com");
  });

  test("deletes the user when --confirm is passed", async () => {
    const result = await cmdUsersDelete([...ARGS, userId, "--confirm"]);
    assertEquals(result.exitCode, 0);

    const check = await cmdUsersGet([...ARGS, userId]);
    assertEquals(check.exitCode, 1);
  });

  test("refuses to delete without --confirm", async () => {
    const result = await cmdUsersDelete([...ARGS, "some-id"]);
    assertEquals(result.exitCode, 1);
    const data = JSON.parse(result.output);
    assertEquals(data.error, "confirmation_required");
  });

  test("create fails without email", async () => {
    const result = await cmdUsersCreate([...ARGS, "--password=secret123"]);
    assertEquals(result.exitCode, 1);
    const data = JSON.parse(result.output);
    assertEquals(data.error, "missing_email");
  });
});

describe("storage", () => {
  test("creates a bucket", async () => {
    const result = await cmdStorageCreateBucket([...ARGS, "cli-test-bucket"]);
    assertEquals(result.exitCode, 0);
    const data = JSON.parse(result.output);
    assertExists(data);
  });

  test("lists buckets and includes the created bucket", async () => {
    const result = await cmdStorageListBuckets(ARGS);
    assertEquals(result.exitCode, 0);
    const buckets: Array<{ name: string }> = JSON.parse(result.output);
    assertExists(buckets.find((b) => b.name === "cli-test-bucket"));
  });

  test("lists objects in a bucket", async () => {
    const result = await cmdStorageLs([...ARGS, "cli-test-bucket"]);
    assertEquals(result.exitCode, 0);
  });

  test("create bucket fails without a name", async () => {
    const result = await cmdStorageCreateBucket(ARGS);
    assertEquals(result.exitCode, 1);
    const data = JSON.parse(result.output);
    assertEquals(data.error, "missing_name");
  });
});

describe("gen types", () => {
  test("generates TypeScript types for existing tables", async () => {
    await cmdDbExec([...ARGS, "--sql", "CREATE TABLE IF NOT EXISTS typed_items (id SERIAL PRIMARY KEY, label TEXT, active BOOLEAN, score NUMERIC)"]);

    const result = await cmdGenTypes(ARGS);
    assertEquals(result.exitCode, 0);
    assertExists(result.output.includes("typed_items"));
    assertExists(result.output.includes("export interface Database"));
    assertExists(result.output.includes("Tables"));
  });

  test("writes types to a file when --output is given", async () => {
    const outFile = join(migrationsDir, "database.types.ts");
    const result = await cmdGenTypes([...ARGS, `--output=${outFile}`]);
    assertEquals(result.exitCode, 0);
    const data = JSON.parse(result.output);
    assertEquals(data.file, outFile);

    const content = await Bun.file(outFile).text();
    assertExists(content.includes("export interface Database"));
  });
});
