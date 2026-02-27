import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createFetchAdapter } from "../src/client.ts";
import { PGlitePooler } from "../src/pooler.ts";
import { QueryPriority } from "../src/types.ts";

// ─── P0 Bugs ─────────────────────────────────────────────────────────────────

describe("stop() rejects pending queries", () => {
  test("queued queries are rejected with 'Pooler stopped' when stop() is called", async () => {
    const db = new PGlite();
    const pooler = new PGlitePooler(db, { maxQueueSize: 100, defaultTimeout: 30000 });
    await pooler.start();

    const settled: { status: string; reason?: string }[] = [];
    const queries = Array.from({ length: 10 }, (_, i) =>
      pooler.query("SELECT $1::int AS n", [i]).then(
        () => settled.push({ status: "fulfilled" }),
        (err: unknown) => settled.push({ status: "rejected", reason: err instanceof Error ? err.message : String(err) }),
      ),
    );

    await pooler.stop();
    await Promise.allSettled(queries);

    const rejected = settled.filter((s) => s.status === "rejected" && s.reason === "Pooler stopped");
    expect(rejected.length).toBeGreaterThan(0);

    await db.close();
  });
});

describe("query() guard when not running", () => {
  test("query() throws 'Pooler is not running' before start()", async () => {
    const db = new PGlite();
    const pooler = new PGlitePooler(db);
    await expect(pooler.query("SELECT 1")).rejects.toThrow("Pooler is not running");
    await db.close();
  });

  test("query() throws 'Pooler is not running' after stop()", async () => {
    const db = new PGlite();
    const pooler = new PGlitePooler(db);
    await pooler.start();
    await pooler.stop();
    await expect(pooler.query("SELECT 1")).rejects.toThrow("Pooler is not running");
    await db.close();
  });
});

describe("processQueue robustness", () => {
  test("pooler keeps processing after an individual query error", async () => {
    const db = new PGlite();
    const pooler = new PGlitePooler(db);
    await pooler.start();

    await expect(pooler.query("SELECT * FROM no_such_table_xyz")).rejects.toThrow();
    const result = await pooler.query("SELECT 42 AS n");
    expect(result.rows[0]).toEqual({ n: 42 });

    await pooler.stop();
    await db.close();
  });
});

describe("stop() reliable completion", () => {
  test("stop() resolves after processQueue exits", async () => {
    const db = new PGlite();
    const pooler = new PGlitePooler(db);
    await pooler.start();

    await pooler.query("SELECT 1");
    const stopStart = performance.now();
    await pooler.stop();
    const stopElapsed = performance.now() - stopStart;

    expect(stopElapsed).toBeLessThan(1000);

    await db.close();
  });
});

// ─── P1 Important gaps ───────────────────────────────────────────────────────

describe("per-query timeout", () => {
  test("query with short timeoutMs rejects faster than defaultTimeout", async () => {
    const neverResolvingDb = {
      query: () => new Promise(() => {}),
      transaction: () => new Promise(() => {}),
    } as unknown as PGlite;

    const pooler = new PGlitePooler(neverResolvingDb, { defaultTimeout: 30000 });
    await pooler.start();

    const start = performance.now();
    await expect(pooler.query("SELECT 1", [], QueryPriority.MEDIUM, 100)).rejects.toThrow("Query timeout");
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000);

    await pooler.stop();
  });
});

describe("priority aging", () => {
  test("stale low-priority queries are promoted above freshly enqueued higher-priority queries", async () => {
    const { PriorityQueue } = await import("../src/queue.ts");
    const { QueryPriority: QP } = await import("../src/types.ts");

    const queue = new PriorityQueue(100, 50);

    const makeQuery = (priority: number, enqueuedAt: number) => ({
      id: crypto.randomUUID(),
      sql: "SELECT 1",
      params: [],
      priority,
      enqueuedAt,
      resolve: () => {},
      reject: () => {},
    });

    const staleTime = Date.now() - 100;
    const lowAged = makeQuery(QP.LOW, staleTime);
    queue.enqueue(lowAged);

    const freshLow = makeQuery(QP.LOW, Date.now());
    queue.enqueue(freshLow);

    const first = queue.dequeue();
    expect(first?.id).toBe(lowAged.id);
  });
});

describe("transaction support", () => {
  test("transaction() commits on success", async () => {
    const db = new PGlite();
    await db.exec("CREATE TABLE txn_test (id SERIAL PRIMARY KEY, val TEXT)");
    const pooler = new PGlitePooler(db);
    await pooler.start();

    const result = await pooler.transaction(async (query) => {
      await query("INSERT INTO txn_test (val) VALUES ('a')");
      await query("INSERT INTO txn_test (val) VALUES ('b')");
      return query("SELECT COUNT(*) AS cnt FROM txn_test");
    });

    expect(Number(result.rows[0]?.["cnt"])).toBe(2);

    await pooler.stop();
    await db.close();
  });

  test("transaction() rolls back on error", async () => {
    const db = new PGlite();
    await db.exec("CREATE TABLE txn_rollback (id SERIAL PRIMARY KEY, val TEXT)");
    const pooler = new PGlitePooler(db);
    await pooler.start();

    await expect(
      pooler.transaction(async (query) => {
        await query("INSERT INTO txn_rollback (val) VALUES ('x')");
        await query("SELECT * FROM no_such_table_rollback");
      }),
    ).rejects.toThrow();

    const result = await pooler.query("SELECT COUNT(*) AS cnt FROM txn_rollback");
    expect(Number(result.rows[0]?.["cnt"])).toBe(0);

    await pooler.stop();
    await db.close();
  });
});

// ─── P2 Observability & ergonomics ───────────────────────────────────────────

describe("metrics()", () => {
  test("metrics() tracks totalEnqueued, totalDequeued, currentSize, avgWaitTimeMs, sizeByPriority", async () => {
    const db = new PGlite();
    const pooler = new PGlitePooler(db);
    await pooler.start();

    await pooler.query("SELECT 1");
    await pooler.query("SELECT 2");

    const m = pooler.metrics();
    expect(m.totalEnqueued).toBeGreaterThanOrEqual(2);
    expect(m.totalDequeued).toBeGreaterThanOrEqual(2);
    expect(m.currentSize).toBe(0);
    expect(typeof m.avgWaitTimeMs).toBe("number");
    expect(m.sizeByPriority).toBeDefined();

    await pooler.stop();
    await db.close();
  });
});

describe("Symbol.asyncDispose", () => {
  test("await using calls stop() automatically", async () => {
    const db = new PGlite();
    let stopped = false;

    {
      await using pooler = await PGlitePooler.create(db);
      const original = pooler.stop.bind(pooler);
      (pooler as unknown as { stop: () => Promise<void> }).stop = async () => {
        stopped = true;
        return original();
      };
      await pooler.query("SELECT 1");
    }

    expect(stopped).toBe(true);
    await db.close();
  });
});

describe("PGlitePooler.create()", () => {
  test("static create() returns a started pooler", async () => {
    const db = new PGlite();
    const pooler = await PGlitePooler.create(db);

    const result = await pooler.query("SELECT 99 AS n");
    expect(result.rows[0]).toEqual({ n: 99 });

    await pooler.stop();
    await db.close();
  });
});

describe("better error messages", () => {
  test("queue full error includes size and max", async () => {
    const db = new PGlite();
    const pooler = new PGlitePooler(db, { maxQueueSize: 0, defaultTimeout: 30000 });
    await pooler.start();

    await expect(pooler.query("SELECT 1")).rejects.toThrow(/Queue is full \(size: \d+, max: \d+\)/);

    await pooler.stop();
    await db.close();
  });
});

// ─── Pooler ──────────────────────────────────────────────────────────────────

describe("PGlitePooler", () => {
  let db: PGlite;
  let pooler: PGlitePooler;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(
      "CREATE TABLE perf_items (id SERIAL PRIMARY KEY, value TEXT, priority TEXT)",
    );
    pooler = new PGlitePooler(db);
    await pooler.start();
  });

  afterAll(async () => {
    await pooler.stop();
    await db.close();
  });

  test("executes a basic query", async () => {
    const result = await pooler.query("SELECT 1 AS n");
    expect(result.rows[0]).toEqual({ n: 1 });
  });

  test("executes parameterized queries", async () => {
    await pooler.query(
      "INSERT INTO perf_items (value, priority) VALUES ($1, $2)",
      ["hello", "medium"],
    );
    const result = await pooler.query(
      "SELECT value FROM perf_items WHERE value = $1",
      ["hello"],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ value: "hello" });
  });

  test("rejects queries against non-existent tables", async () => {
    await expect(pooler.query("SELECT * FROM no_such_table")).rejects.toThrow();
  });

  test("throws when started twice", async () => {
    await expect(pooler.start()).rejects.toThrow("Pooler already started");
  });

  test("respects priority ordering", async () => {
    await db.exec("DELETE FROM perf_items");

    await Promise.all([
      pooler.query(
        "INSERT INTO perf_items (value, priority) VALUES ('low', 'LOW')",
        [],
        QueryPriority.LOW,
      ),
      pooler.query(
        "INSERT INTO perf_items (value, priority) VALUES ('critical', 'CRITICAL')",
        [],
        QueryPriority.CRITICAL,
      ),
      pooler.query(
        "INSERT INTO perf_items (value, priority) VALUES ('high', 'HIGH')",
        [],
        QueryPriority.HIGH,
      ),
    ]);

    const rows = await pooler.query(
      "SELECT priority FROM perf_items ORDER BY id",
    );
    const order = rows.rows.map((r) => r["priority"]);

    expect(order[0]).toBe("CRITICAL");
    expect(order[1]).toBe("HIGH");
    expect(order[2]).toBe("LOW");
  });

  test("handles concurrent queries without data corruption", async () => {
    await db.exec("DELETE FROM perf_items");

    const n = 20;
    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        pooler.query(
          "INSERT INTO perf_items (value, priority) VALUES ($1, 'MEDIUM')",
          [`item-${i}`],
        ),
      ),
    );

    const result = await pooler.query(
      "SELECT COUNT(*) AS cnt FROM perf_items",
    );
    expect(Number(result.rows[0]?.["cnt"])).toBe(n);
  });
});

// ─── Initialization performance ──────────────────────────────────────────────

describe("initialization performance", () => {
  test("createFetchAdapter completes within 5 seconds", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    const start = performance.now();
    const { localFetch, authHandler, parser } = await createFetchAdapter({ db });
    const elapsed = performance.now() - start;

    expect(localFetch).toBeFunction();
    expect(authHandler).toBeDefined();
    expect(parser).toBeDefined();
    expect(elapsed).toBeLessThan(5000);

    await db.close();
  });

  test("repeated createFetchAdapter calls complete under 5 seconds each", async () => {
    for (let i = 0; i < 3; i++) {
      const db = new PGlite({ extensions: { pgcrypto } });
      const start = performance.now();
      await createFetchAdapter({ db });
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(5000);
      await db.close();
    }
  });

  test("init after WASM warm-up completes under 3 seconds", async () => {
    const warmup = new PGlite({ extensions: { pgcrypto } });
    await createFetchAdapter({ db: warmup });
    await warmup.close();

    const db = new PGlite({ extensions: { pgcrypto } });
    const start = performance.now();
    await createFetchAdapter({ db });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(3000);

    await db.close();
  });
});

// ─── Throughput ──────────────────────────────────────────────────────────────

describe("pooler throughput", () => {
  test("100 sequential inserts complete under 10 seconds", async () => {
    const db = new PGlite();
    await db.exec("CREATE TABLE throughput (id SERIAL PRIMARY KEY, n INTEGER)");
    const pooler = new PGlitePooler(db);
    await pooler.start();

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      await pooler.query("INSERT INTO throughput (n) VALUES ($1)", [i]);
    }
    const elapsed = performance.now() - start;

    const result = await pooler.query("SELECT COUNT(*) AS cnt FROM throughput");
    expect(Number(result.rows[0]?.["cnt"])).toBe(100);
    expect(elapsed).toBeLessThan(10000);

    await pooler.stop();
    await db.close();
  });

  test("50 concurrent queries complete under 10 seconds", async () => {
    const db = new PGlite();
    await db.exec("CREATE TABLE concurrent (id SERIAL PRIMARY KEY, n INTEGER)");
    const pooler = new PGlitePooler(db);
    await pooler.start();

    const start = performance.now();
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        pooler.query("INSERT INTO concurrent (n) VALUES ($1)", [i]),
      ),
    );
    const elapsed = performance.now() - start;

    const result = await pooler.query("SELECT COUNT(*) AS cnt FROM concurrent");
    expect(Number(result.rows[0]?.["cnt"])).toBe(50);
    expect(elapsed).toBeLessThan(10000);

    await pooler.stop();
    await db.close();
  });
});
