/**
 * TCP Server Integration Tests
 *
 * Tests the Postgres wire protocol TCP server by connecting via a real pg client,
 * exercising simple query, extended query, and error handling flows.
 */

import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { PGlitePooler, PGliteTCPServer } from "../src/index.ts";
import { assertEquals, assertExists, describe, test } from "./compat.ts";

const TEST_PORT = 54399;

async function setup() {
	const db = new PGlite();
	const pooler = await PGlitePooler.create(db);
	const server = new PGliteTCPServer(pooler);
	await server.start(TEST_PORT);

	const pool = new pg.Pool({
		connectionString: `postgresql://postgres@127.0.0.1:${TEST_PORT}/postgres`,
		max: 3,
	});

	return {
		db,
		server,
		pool,
		async teardown() {
			await pool.end();
			await server.stop();
		},
	};
}

describe("PGliteTCPServer", () => {
	test("simple SELECT returns rows", async () => {
		const { pool, teardown } = await setup();
		try {
			const res = await pool.query("SELECT 1 AS num, 'hello' AS str");
			assertEquals(res.rows.length, 1);
			assertEquals(res.rows[0].num, 1);
			assertEquals(res.rows[0].str, "hello");
		} finally {
			await teardown();
		}
	});

	test("CREATE TABLE and INSERT/SELECT round-trip", async () => {
		const { pool, teardown } = await setup();
		try {
			await pool.query("CREATE TABLE items (id SERIAL PRIMARY KEY, name TEXT)");
			await pool.query("INSERT INTO items (name) VALUES ('apple'), ('banana')");
			const res = await pool.query("SELECT name FROM items ORDER BY name");
			assertEquals(res.rows.length, 2);
			assertEquals(res.rows[0].name, "apple");
			assertEquals(res.rows[1].name, "banana");
		} finally {
			await teardown();
		}
	});

	test("parameterized query via extended protocol", async () => {
		const { pool, teardown } = await setup();
		try {
			await pool.query(
				"CREATE TABLE products (id SERIAL PRIMARY KEY, price NUMERIC)",
			);
			await pool.query(
				"INSERT INTO products (price) VALUES (9.99), (19.99), (29.99)",
			);
			const res = await pool.query(
				"SELECT price FROM products WHERE price > $1 ORDER BY price",
				[15],
			);
			assertEquals(res.rows.length, 2);
		} finally {
			await teardown();
		}
	});

	test("multiple concurrent queries are serialized through pooler", async () => {
		const { pool, teardown } = await setup();
		try {
			await pool.query("CREATE TABLE counters (val INT)");
			await pool.query("INSERT INTO counters VALUES (0)");

			await Promise.all(
				Array.from({ length: 10 }, (_, i) =>
					pool.query(`UPDATE counters SET val = val + 1`),
				),
			);

			const res = await pool.query("SELECT val FROM counters");
			assertEquals(res.rows[0].val, 10);
		} finally {
			await teardown();
		}
	});

	test("SQL error returns error to client without crashing server", async () => {
		const { pool, teardown } = await setup();
		try {
			let caught: Error | null = null;
			try {
				await pool.query("SELECT * FROM nonexistent_table_xyz");
			} catch (err) {
				caught = err as Error;
			}
			assertExists(caught);

			// Server still works after error
			const res = await pool.query("SELECT 42 AS val");
			assertEquals(res.rows[0].val, 42);
		} finally {
			await teardown();
		}
	});

	test("NULL values are handled correctly", async () => {
		const { pool, teardown } = await setup();
		try {
			const res = await pool.query("SELECT NULL::text AS n, 'hello' AS s");
			assertEquals(res.rows[0].n, null);
			assertEquals(res.rows[0].s, "hello");
		} finally {
			await teardown();
		}
	});

	test("JSONB columns are returned as parsed objects", async () => {
		const { pool, teardown } = await setup();
		try {
			await pool.query("CREATE TABLE docs (data JSONB)");
			await pool.query(
				`INSERT INTO docs VALUES ('{"key": "value", "num": 42}')`,
			);
			const res = await pool.query("SELECT data FROM docs");
			assertEquals(res.rows[0].data, { key: "value", num: 42 });
		} finally {
			await teardown();
		}
	});

	test("multi-statement simple query returns last result", async () => {
		const { pool, teardown } = await setup();
		try {
			await pool.query("CREATE TABLE things (val INT)");
			await pool.query("INSERT INTO things VALUES (1)");
			// SET + SELECT — two statements in one simple query (mirrors postgres-meta timeout prefix)
			const res = await pool.query(
				"SET statement_timeout = '5s'; SELECT val FROM things",
			);
			assertEquals(res.rows[0].val, 1);
		} finally {
			await teardown();
		}
	});

	test("pg_catalog queries work (needed for postgres-meta)", async () => {
		const { pool, teardown } = await setup();
		try {
			const res = await pool.query(`
        SELECT nspname FROM pg_catalog.pg_namespace
        WHERE nspname NOT LIKE 'pg_%'
        ORDER BY nspname
      `);
			const names = res.rows.map((r: Record<string, unknown>) => r.nspname);
			assertExists(names.find((n: unknown) => n === "public"));
		} finally {
			await teardown();
		}
	});

	test("empty query does not throw", async () => {
		const { pool, teardown } = await setup();
		try {
			const res = await pool.query("");
			assertEquals(res.rows.length, 0);
		} finally {
			await teardown();
		}
	});

	test("SQLSTATE 23505 on unique violation", async () => {
		const { pool, teardown } = await setup();
		try {
			await pool.query("CREATE TABLE uniq_test (id INT PRIMARY KEY)");
			await pool.query("INSERT INTO uniq_test VALUES (1)");
			let err: Error & { code?: string } | null = null;
			try {
				await pool.query("INSERT INTO uniq_test VALUES (1)");
			} catch (e) {
				err = e as Error & { code?: string };
			}
			assertExists(err);
			assertEquals(err!.code, "23505");
		} finally {
			await teardown();
		}
	});

	test("SQLSTATE 42P01 on missing table", async () => {
		const { pool, teardown } = await setup();
		try {
			let err: Error & { code?: string } | null = null;
			try {
				await pool.query("SELECT * FROM totally_missing_xyz");
			} catch (e) {
				err = e as Error & { code?: string };
			}
			assertExists(err);
			assertEquals(err!.code, "42P01");
		} finally {
			await teardown();
		}
	});

	test("res.fields includes column name and dataTypeID", async () => {
		const { pool, teardown } = await setup();
		try {
			const res = await pool.query("SELECT 1::int4 AS num, 'hi'::text AS str");
			assertEquals(res.fields.length, 2);
			assertEquals(res.fields[0].name, "num");
			assertEquals(res.fields[1].name, "str");
			assertExists(res.fields[0].dataTypeID);
		} finally {
			await teardown();
		}
	});

	test("explicit BEGIN/COMMIT transaction works", async () => {
		const { pool, teardown } = await setup();
		try {
			await pool.query("CREATE TABLE tx_test (val INT)");
			await pool.query("BEGIN");
			await pool.query("INSERT INTO tx_test VALUES (42)");
			await pool.query("COMMIT");
			const res = await pool.query("SELECT val FROM tx_test");
			assertEquals(res.rows[0].val, 42);
		} finally {
			await teardown();
		}
	});

	test("explicit BEGIN/ROLLBACK discards changes", async () => {
		const { pool, teardown } = await setup();
		try {
			await pool.query("CREATE TABLE tx_rollback_test (val INT)");
			await pool.query("BEGIN");
			await pool.query("INSERT INTO tx_rollback_test VALUES (99)");
			await pool.query("ROLLBACK");
			const res = await pool.query("SELECT COUNT(*) AS cnt FROM tx_rollback_test");
			assertEquals(Number(res.rows[0].cnt), 0);
		} finally {
			await teardown();
		}
	});

	test("multi-statement with error rolls back prior inserts", async () => {
		const { pool, teardown } = await setup();
		try {
			await pool.query("CREATE TABLE multi_rollback (val INT)");
			let err: Error | null = null;
			try {
				await pool.query("INSERT INTO multi_rollback VALUES (1); SELECT * FROM missing_xyz_table");
			} catch (e) {
				err = e as Error;
			}
			assertExists(err);
			const res = await pool.query("SELECT COUNT(*) AS cnt FROM multi_rollback");
			assertEquals(Number(res.rows[0].cnt), 0);
		} finally {
			await teardown();
		}
	});

	test("real OIDs reported in RowDescription (not all OID 25)", async () => {
		const { pool, teardown } = await setup();
		try {
			const res = await pool.query(
				"SELECT 1::int4 AS a, true AS b, 3.14::float8 AS c, 'x'::text AS d",
			);
			const byName = Object.fromEntries(res.fields.map((f: { name: string; dataTypeID: number }) => [f.name, f.dataTypeID]));
			assertEquals(byName.a, 23);   // int4
			assertEquals(byName.b, 16);   // bool
			assertEquals(byName.c, 701);  // float8
			assertEquals(byName.d, 25);   // text
		} finally {
			await teardown();
		}
	});

	test("binary encoding: common types round-trip via extended protocol", async () => {
		const { teardown } = await setup();
		const client = new pg.Client({
			connectionString: `postgresql://postgres@127.0.0.1:${TEST_PORT}/postgres`,
		});
		await client.connect();
		try {
			const res = await client.query(
				"SELECT 42::int4 AS i4, TRUE AS b, 2.718281828::float8 AS f8, 'hello'::text AS t, '550e8400-e29b-41d4-a716-446655440000'::uuid AS id",
			);
			assertEquals(res.rows[0].i4, 42);
			assertEquals(res.rows[0].b, true);
			assertEquals(res.rows[0].t, "hello");
			assertEquals(res.rows[0].id, "550e8400-e29b-41d4-a716-446655440000");
			assertExists(res.rows[0].f8);
		} finally {
			await client.end();
			await teardown();
		}
	});

	test("binary encoding: jsonb column returns parsed object", async () => {
		const { teardown } = await setup();
		const client = new pg.Client({
			connectionString: `postgresql://postgres@127.0.0.1:${TEST_PORT}/postgres`,
		});
		await client.connect();
		try {
			await client.query("CREATE TABLE jsonb_bin (data JSONB)");
			await client.query("INSERT INTO jsonb_bin VALUES ($1)", ['{"x":1}']);
			const res = await client.query("SELECT data FROM jsonb_bin");
			assertEquals(res.rows[0].data, { x: 1 });
		} finally {
			await client.end();
			await teardown();
		}
	});
});
