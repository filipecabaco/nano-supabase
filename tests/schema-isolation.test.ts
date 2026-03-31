import type { PGliteInterface } from "@electric-sql/pglite";
import { describe, expect, test } from "vitest";

import { createFetchAdapter } from "../src/client.ts";
import { nanoSupabase } from "../src/nano.ts";
import { createPGlite } from "../src/pglite-factory.ts";
import { PostgrestParser } from "../src/postgrest-parser.ts";

const SUPABASE_URL = "http://localhost:54321";

function schemaExecutor(db: PGliteInterface) {
  return async (sql: string) => {
    const result = await db.query(sql);
    return { rows: result.rows };
  };
}

describe("per-schema-id isolation", () => {
  test("PostgrestParser constructor stores schemaId", () => {
    const p1 = new PostgrestParser();
    const p2 = new PostgrestParser("tenant-a");

    expect(p1.schemaId).toBeUndefined();
    expect(p2.schemaId).toBe("tenant-a");
  });

  test("initSchema with schemaId introspects per tenant", async () => {
    const db = createPGlite();
    await db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      )
    `);

    await PostgrestParser.initSchema(schemaExecutor(db), "test-tenant-a");

    const parser = new PostgrestParser("test-tenant-a");
    const parsed = parser.parseSelect("products", "select=*");
    expect(parsed.sql).toContain("products");
    expect(parsed.sql.toLowerCase()).toContain("select");

    PostgrestParser.clearSchema("test-tenant-a");
    await db.close();
  });

  test("two nanoSupabase instances with different schemaIds have isolated schemas", async () => {
    await using nano1 = await nanoSupabase({ schemaId: "iso-tenant-1" });
    await nano1.db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        total INTEGER NOT NULL
      )
    `);
    await PostgrestParser.initSchema(schemaExecutor(nano1.db), "iso-tenant-1");

    await using nano2 = await nanoSupabase({ schemaId: "iso-tenant-2" });
    await nano2.db.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        amount NUMERIC NOT NULL
      )
    `);
    await PostgrestParser.initSchema(schemaExecutor(nano2.db), "iso-tenant-2");

    const supabase1 = nano1.createClient();
    const { error: e1 } = await supabase1.from("orders").insert({ total: 100 });
    expect(e1).toBeNull();
    const { data: d1 } = await supabase1.from("orders").select("*");
    expect(d1).toHaveLength(1);
    expect(d1?.[0].total).toBe(100);

    const supabase2 = nano2.createClient();
    const { error: e2 } = await supabase2
      .from("invoices")
      .insert({ amount: 250 });
    expect(e2).toBeNull();
    const { data: d2 } = await supabase2.from("invoices").select("*");
    expect(d2).toHaveLength(1);
    expect(d2?.[0].amount).toBe("250");

    PostgrestParser.clearSchema("iso-tenant-1");
    PostgrestParser.clearSchema("iso-tenant-2");
  });

  test("clearSchema removes a tenant schema without affecting others", async () => {
    const dbA = createPGlite();
    await dbA.exec(
      "CREATE TABLE IF NOT EXISTS widgets (id SERIAL PRIMARY KEY, label TEXT)",
    );
    await PostgrestParser.initSchema(schemaExecutor(dbA), "clear-a");

    const dbB = createPGlite();
    await dbB.exec(
      "CREATE TABLE IF NOT EXISTS gadgets (id SERIAL PRIMARY KEY, model TEXT)",
    );
    await PostgrestParser.initSchema(schemaExecutor(dbB), "clear-b");

    PostgrestParser.clearSchema("clear-a");

    const parserB = new PostgrestParser("clear-b");
    const parsed = parserB.parseSelect("gadgets", "select=*");
    expect(parsed.sql).toContain("gadgets");

    PostgrestParser.clearSchema("clear-b");
    await dbA.close();
    await dbB.close();
  });

  test("clearAllSchemas clears every cached schema", async () => {
    const db = createPGlite();
    await db.exec(
      "CREATE TABLE IF NOT EXISTS temp (id SERIAL PRIMARY KEY, v TEXT)",
    );

    await PostgrestParser.initSchema(schemaExecutor(db), "all-a");
    await PostgrestParser.initSchema(schemaExecutor(db), "all-b");

    PostgrestParser.clearAllSchemas();

    await db.close();
  });

  test("createFetchAdapter with default schemaId routes queries correctly", async () => {
    const db = createPGlite();
    await db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        done BOOLEAN DEFAULT false
      )
    `);
    await db.exec("INSERT INTO tasks (title) VALUES ('Buy milk')");

    const { localFetch } = await createFetchAdapter({
      db,
      supabaseUrl: SUPABASE_URL,
    });

    const response = await localFetch(
      `${SUPABASE_URL}/rest/v1/tasks?select=*`,
      { method: "GET", headers: { "Content-Type": "application/json" } },
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("Buy milk");

    await db.close();
  });

  test("nanoSupabase with schemaId performs full CRUD", async () => {
    await using nano = await nanoSupabase({ schemaId: "crud-tenant" });
    await nano.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        body TEXT NOT NULL
      )
    `);
    await PostgrestParser.initSchema(schemaExecutor(nano.db), "crud-tenant");

    const supabase = nano.createClient();

    const { error: insertErr } = await supabase
      .from("notes")
      .insert({ body: "hello" });
    expect(insertErr).toBeNull();

    const { data: rows } = await supabase.from("notes").select("*");
    expect(rows).toHaveLength(1);
    expect(rows?.[0].body).toBe("hello");

    const { error: updateErr } = await supabase
      .from("notes")
      .update({ body: "updated" })
      .eq("id", rows?.[0].id);
    expect(updateErr).toBeNull();

    const { data: updated } = await supabase.from("notes").select("*");
    expect(updated?.[0].body).toBe("updated");

    const { error: deleteErr } = await supabase
      .from("notes")
      .delete()
      .eq("id", rows?.[0].id);
    expect(deleteErr).toBeNull();

    const { data: empty } = await supabase.from("notes").select("*");
    expect(empty).toHaveLength(0);

    PostgrestParser.clearSchema("crud-tenant");
  });

  test("default schemaId (no schemaId) still works as before", async () => {
    await using nano = await nanoSupabase();
    await nano.db.exec(
      "CREATE TABLE IF NOT EXISTS legacy (id SERIAL PRIMARY KEY, val TEXT)",
    );
    const supabase = nano.createClient();

    const { error } = await supabase.from("legacy").insert({ val: "compat" });
    expect(error).toBeNull();

    const { data } = await supabase.from("legacy").select("*");
    expect(data).toHaveLength(1);
    expect(data?.[0].val).toBe("compat");
  });
});

describe("service-mode-like multi-tenant pattern", () => {
  test("shared WASM init with per-tenant schema and parser", async () => {
    await PostgrestParser.init();

    const tenants = [
      { slug: "acme", table: "acme_items", column: "sku" },
      { slug: "globex", table: "globex_records", column: "code" },
    ];

    const instances: Awaited<ReturnType<typeof nanoSupabase>>[] = [];

    for (const t of tenants) {
      const nano = await nanoSupabase({ schemaId: t.slug });
      await nano.db.exec(`
        CREATE TABLE IF NOT EXISTS ${t.table} (
          id SERIAL PRIMARY KEY,
          ${t.column} TEXT NOT NULL
        )
      `);
      await PostgrestParser.initSchema(schemaExecutor(nano.db), t.slug);
      instances.push(nano);
    }

    const supabase0 = instances[0].createClient();
    const { error: e0 } = await supabase0
      .from("acme_items")
      .insert({ sku: "ABC-123" });
    expect(e0).toBeNull();
    const { data: d0 } = await supabase0.from("acme_items").select("*");
    expect(d0).toHaveLength(1);
    expect(d0?.[0].sku).toBe("ABC-123");

    const supabase1 = instances[1].createClient();
    const { error: e1 } = await supabase1
      .from("globex_records")
      .insert({ code: "XYZ-789" });
    expect(e1).toBeNull();
    const { data: d1 } = await supabase1.from("globex_records").select("*");
    expect(d1).toHaveLength(1);
    expect(d1?.[0].code).toBe("XYZ-789");

    for (const t of tenants) {
      PostgrestParser.clearSchema(t.slug);
    }
    for (const inst of instances) {
      await inst.stop();
    }
  });

  test("clearSchema then re-init restores functionality (pause/wake)", async () => {
    await using nano = await nanoSupabase({ schemaId: "pausable" });
    await nano.db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        message TEXT NOT NULL
      )
    `);
    await PostgrestParser.initSchema(schemaExecutor(nano.db), "pausable");

    const supabase = nano.createClient();
    const { error: e1 } = await supabase
      .from("logs")
      .insert({ message: "before pause" });
    expect(e1).toBeNull();

    PostgrestParser.clearSchema("pausable");

    await PostgrestParser.initSchema(schemaExecutor(nano.db), "pausable");

    const { error: e2 } = await supabase
      .from("logs")
      .insert({ message: "after wake" });
    expect(e2).toBeNull();

    const { data } = await supabase.from("logs").select("*");
    expect(data).toHaveLength(2);

    PostgrestParser.clearSchema("pausable");
  });
});
