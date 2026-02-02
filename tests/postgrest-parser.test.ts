/**
 * PostgREST Parser Tests for Deno
 * Compatible with webcontainers and edge workers
 */

import { PostgrestParser } from "../src/postgrest-parser.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("PostgREST Parser - Initialization", async () => {
  await PostgrestParser.init();
  console.log("✓ WASM module initialized");
});

Deno.test("PostgREST Parser - Simple SELECT", async () => {
  await PostgrestParser.init();
  const parser = new PostgrestParser();

  const result = parser.parseSelect("users", "select=id,name,email");

  assertEquals(result.sql, 'SELECT "id", "name", "email" FROM "users"');
  assertEquals(result.params, []);
  assertEquals(result.tables, ["users"]);
});

Deno.test("PostgREST Parser - SELECT with filters", async () => {
  await PostgrestParser.init();
  const parser = new PostgrestParser();

  const result = parser.parseSelect("users", "id=eq.1&select=id,name");

  assertEquals(result.sql, 'SELECT "id", "name" FROM "users" WHERE "id" = $1');
  assertEquals(result.params, ["1"]);
});

Deno.test("PostgREST Parser - SELECT with multiple filters", async () => {
  await PostgrestParser.init();
  const parser = new PostgrestParser();

  const result = parser.parseSelect(
    "users",
    "age=gte.18&status=eq.active&select=id,name",
  );

  assertEquals(
    result.sql,
    'SELECT "id", "name" FROM "users" WHERE "age" >= $1 AND "status" = $2',
  );
  assertEquals(result.params, ["18", "active"]);
});

Deno.test("PostgREST Parser - INSERT", async () => {
  await PostgrestParser.init();
  const parser = new PostgrestParser();

  const result = parser.parseInsert("users", {
    name: "Alice",
    email: "alice@example.com",
    age: 25,
  });

  assertEquals(
    result.sql,
    'INSERT INTO "public"."users" ("age", "email", "name") VALUES ($1, $2, $3)',
  );
  assertEquals(result.params, [25, "alice@example.com", "Alice"]);
});

Deno.test("PostgREST Parser - UPDATE", async () => {
  await PostgrestParser.init();
  const parser = new PostgrestParser();

  const result = parser.parseUpdate(
    "users",
    { name: "Alice Smith", age: 26 },
    "id=eq.1",
  );

  assertEquals(
    result.sql,
    'UPDATE "public"."users" SET "age" = $1, "name" = $2 WHERE "id" = $3',
  );
  assertEquals(result.params, [26, "Alice Smith", "1"]);
});

Deno.test("PostgREST Parser - DELETE", async () => {
  await PostgrestParser.init();
  const parser = new PostgrestParser();

  const result = parser.parseDelete("users", "id=eq.1");

  assertEquals(result.sql, 'DELETE FROM "public"."users" WHERE "id" = $1');
  assertEquals(result.params, ["1"]);
});

Deno.test("PostgREST Parser - RPC function call", async () => {
  await PostgrestParser.init();
  const parser = new PostgrestParser();

  const result = parser.parseRpc("calculate_total", { order_id: 123 });

  assertEquals(
    result.sql,
    'SELECT * FROM "public"."calculate_total"("order_id" := $1)',
  );
  assertEquals(result.params, [123]);
});

Deno.test("PostgREST Parser - Generic HTTP request (GET)", async () => {
  await PostgrestParser.init();
  const parser = new PostgrestParser();

  const result = parser.parseRequest(
    "GET",
    "users",
    "age=gte.18&select=id,name",
  );

  assertEquals(
    result.sql,
    'SELECT "id", "name" FROM "users" WHERE "age" >= $1',
  );
  assertEquals(result.params, ["18"]);
});

Deno.test("PostgREST Parser - parseRequest for POST (INSERT)", async () => {
  await PostgrestParser.init();
  const parser = new PostgrestParser();

  const result = parser.parseRequest("POST", "users", "", {
    name: "Bob",
    email: "bob@example.com",
  });

  assertEquals(result.sql.includes('INSERT INTO "public"."users"'), true);
  assertEquals(result.params.includes("Bob"), true);
  assertEquals(result.params.includes("bob@example.com"), true);
});

Deno.test("PostgREST Parser - parseRequest for PATCH (UPDATE)", async () => {
  await PostgrestParser.init();
  const parser = new PostgrestParser();

  const result = parser.parseRequest("PATCH", "users", "id=eq.1", {
    status: "active",
  });

  assertEquals(result.sql.includes('UPDATE "public"."users"'), true);
  assertEquals(result.sql.includes('WHERE "id" = $'), true);
  assertEquals(result.params.includes("active"), true);
  assertEquals(result.params.includes("1"), true);
});

Deno.test("PostgREST Parser - parseRequest for DELETE", async () => {
  await PostgrestParser.init();
  const parser = new PostgrestParser();

  const result = parser.parseRequest("DELETE", "users", "id=eq.1");

  assertEquals(result.sql, 'DELETE FROM "public"."users" WHERE "id" = $1');
  assertEquals(result.params, ["1"]);
});
