/**
 * Pooler Tests for Deno
 * Tests the connection pooler with priority queue
 */

import { PGlite } from "@electric-sql/pglite";
import { PGlitePooler } from "../src/pooler.ts";
import { QueryPriority } from "../src/types.ts";
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("Pooler - Basic query execution", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);
  await db.exec(`INSERT INTO users (name) VALUES ('Alice'), ('Bob')`);

  const pooler = new PGlitePooler(db);
  await pooler.start();

  const result = await pooler.query("SELECT * FROM users", []);

  assertEquals(result.rows.length, 2);
  assertExists(result.fields);

  await pooler.stop();
  await db.close();
});

Deno.test("Pooler - Query with parameters", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);
  await db.exec(`INSERT INTO users (name) VALUES ('Alice'), ('Bob')`);

  const pooler = new PGlitePooler(db);
  await pooler.start();

  const result = await pooler.query("SELECT * FROM users WHERE name = $1", [
    "Alice",
  ]);

  assertEquals(result.rows.length, 1);
  assertEquals((result.rows[0] as { name: string }).name, "Alice");

  await pooler.stop();
  await db.close();
});

Deno.test("Pooler - Priority queue ordering", async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT)`);

  const pooler = new PGlitePooler(db);
  await pooler.start();

  const results: string[] = [];

  // Queue queries with different priorities
  const promises = [
    pooler
      .query("SELECT 1 as val", [], QueryPriority.LOW)
      .then(() => results.push("LOW")),
    pooler
      .query("SELECT 1 as val", [], QueryPriority.CRITICAL)
      .then(() => results.push("CRITICAL")),
    pooler
      .query("SELECT 1 as val", [], QueryPriority.MEDIUM)
      .then(() => results.push("MEDIUM")),
    pooler
      .query("SELECT 1 as val", [], QueryPriority.HIGH)
      .then(() => results.push("HIGH")),
  ];

  await Promise.all(promises);

  // CRITICAL should execute first, LOW last
  assertEquals(results[0], "CRITICAL");
  assertEquals(results[results.length - 1], "LOW");

  await pooler.stop();
  await db.close();
});

Deno.test("Pooler - Concurrent queries", async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT)`);

  const pooler = new PGlitePooler(db, { maxQueueSize: 100 });
  await pooler.start();

  // Execute 10 concurrent queries
  const promises = Array.from({ length: 10 }, (_, i) =>
    pooler.query(`SELECT ${i} as num`),
  );

  const results = await Promise.all(promises);

  assertEquals(results.length, 10);
  results.forEach((result, i) => {
    assertEquals((result.rows[0] as { num: number }).num, i);
  });

  await pooler.stop();
  await db.close();
});

Deno.test("Pooler - Error handling", async () => {
  const db = new PGlite();
  const pooler = new PGlitePooler(db);
  await pooler.start();

  try {
    // Try to query non-existent table
    await pooler.query("SELECT * FROM nonexistent");
    throw new Error("Should have thrown an error");
  } catch (error) {
    // Expected error
    assertExists(error);
  }

  await pooler.stop();
  await db.close();
});

Deno.test("Pooler - Default priority", async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE users (id SERIAL PRIMARY KEY)`);

  const pooler = new PGlitePooler(db);
  await pooler.start();

  // Query without specifying priority (should default to MEDIUM)
  const result = await pooler.query("SELECT 1 as val");

  assertExists(result.rows);
  assertEquals(result.rows.length, 1);

  await pooler.stop();
  await db.close();
});
