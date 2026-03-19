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
});
