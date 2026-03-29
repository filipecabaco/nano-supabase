import { PostgresMeta } from "@supabase/postgres-meta";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PGlitePooler } from "../src/index.ts";
import { nanoSupabase } from "../src/nano.ts";
import { PGliteTCPServer } from "../src/tcp.ts";

const TEST_PORT = 54445;
const CONNECTION_STRING = `postgresql://postgres@127.0.0.1:${TEST_PORT}/postgres?sslmode=disable`;

let server: PGliteTCPServer;
let pgMeta: InstanceType<typeof PostgresMeta>;

beforeAll(async () => {
  const nano = await nanoSupabase();
  const pooler = await PGlitePooler.create(nano.db);
  server = new PGliteTCPServer(pooler);
  await server.start(TEST_PORT);

  await nano.db.exec(`
		CREATE TABLE IF NOT EXISTS products (
			id SERIAL PRIMARY KEY,
			name TEXT NOT NULL,
			price NUMERIC(10,2) DEFAULT 0.00,
			in_stock BOOLEAN DEFAULT true,
			created_at TIMESTAMPTZ DEFAULT now()
		);
		CREATE TABLE IF NOT EXISTS orders (
			id SERIAL PRIMARY KEY,
			product_id INTEGER REFERENCES products(id),
			quantity INTEGER NOT NULL,
			ordered_at TIMESTAMPTZ DEFAULT now()
		);
		CREATE INDEX IF NOT EXISTS orders_product_idx ON orders(product_id);
		CREATE OR REPLACE FUNCTION add_numbers(a INTEGER, b INTEGER)
		RETURNS INTEGER LANGUAGE sql AS $$ SELECT a + b $$;
	`);

  pgMeta = new PostgresMeta({
    connectionString: CONNECTION_STRING,
    maxConnections: 1,
  });
}, 30_000);

afterAll(async () => {
  await pgMeta.end();
  await server.stop();
});

describe("postgres-meta compatibility", () => {
  describe("schemas", () => {
    test("lists public schema", async () => {
      const { data, error } = await pgMeta.schemas.list();
      expect(error).toBeNull();
      expect(data).toBeDefined();
      const publicSchema = data?.find((s) => s.name === "public");
      expect(publicSchema).toBeDefined();
      expect(publicSchema).toMatchObject({ name: "public" });
    });

    test("lists auth schema", async () => {
      const { data, error } = await pgMeta.schemas.list();
      expect(error).toBeNull();
      const authSchema = data?.find((s) => s.name === "auth");
      expect(authSchema).toBeDefined();
    });
  });

  describe("tables", () => {
    test("lists user tables", async () => {
      const { data, error } = await pgMeta.tables.list();
      expect(error).toBeNull();
      expect(data).toBeDefined();
      const names = data?.map((t) => t.name);
      expect(names).toContain("products");
      expect(names).toContain("orders");
    });

    test("products table has expected shape", async () => {
      const { data, error } = await pgMeta.tables.list();
      expect(error).toBeNull();
      const products = data?.find(
        (t) => t.name === "products" && t.schema === "public",
      );
      expect(products).toBeDefined();
      expect(products).toMatchObject({
        name: "products",
        schema: "public",
      });
      expect(typeof products?.id).toBe("number");
    });

    test("orders table references products via foreign key", async () => {
      const { data, error } = await pgMeta.tables.list({
        includeColumns: true,
      });
      expect(error).toBeNull();
      const orders = data?.find(
        (t) => t.name === "orders" && t.schema === "public",
      );
      expect(orders).toBeDefined();
      expect(orders?.relationships.length).toBeGreaterThan(0);
    });
  });

  describe("columns", () => {
    test("lists columns for products table", async () => {
      const { data, error } = await pgMeta.columns.list();
      expect(error).toBeNull();
      const productCols = data?.filter(
        (c) => c.table === "products" && c.schema === "public",
      );
      const colNames = productCols.map((c) => c.name);
      expect(colNames).toContain("id");
      expect(colNames).toContain("name");
      expect(colNames).toContain("price");
      expect(colNames).toContain("in_stock");
      expect(colNames).toContain("created_at");
    });

    test("id column is non-nullable with serial default", async () => {
      const { data, error } = await pgMeta.columns.list();
      expect(error).toBeNull();
      const idCol = data?.find(
        (c) => c.table === "products" && c.name === "id",
      );
      expect(idCol).toBeDefined();
      expect(idCol?.is_nullable).toBe(false);
      expect(idCol?.default_value).toMatch(/nextval/);
    });

    test("name column is non-nullable text", async () => {
      const { data, error } = await pgMeta.columns.list();
      expect(error).toBeNull();
      const nameCol = data?.find(
        (c) => c.table === "products" && c.name === "name",
      );
      expect(nameCol).toBeDefined();
      expect(nameCol?.is_nullable).toBe(false);
      expect(nameCol?.data_type).toBe("text");
    });

    test("price column is numeric with default", async () => {
      const { data, error } = await pgMeta.columns.list();
      expect(error).toBeNull();
      const priceCol = data?.find(
        (c) => c.table === "products" && c.name === "price",
      );
      expect(priceCol).toBeDefined();
      expect(priceCol?.data_type).toBe("numeric");
      expect(priceCol?.default_value).toBe("0.00");
    });
  });

  describe("functions", () => {
    test("lists user-defined functions", async () => {
      const { data, error } = await pgMeta.functions.list();
      expect(error).toBeNull();
      expect(data).toBeDefined();
      const addNumbers = data?.find(
        (f) => f.name === "add_numbers" && f.schema === "public",
      );
      expect(addNumbers).toBeDefined();
      expect(addNumbers?.language).toBe("sql");
    });
  });

  describe("query execution", () => {
    test("executes a simple SELECT", async () => {
      const { data, error } = await pgMeta.query("SELECT 1 + 1 AS result");
      expect(error).toBeNull();
      expect(data).toEqual([{ result: 2 }]);
    });

    test("executes INSERT and SELECT roundtrip", async () => {
      await pgMeta.query("DELETE FROM products WHERE name = 'test-item'");
      const { error: insertErr } = await pgMeta.query(
        "INSERT INTO products (name, price) VALUES ('test-item', 9.99)",
      );
      expect(insertErr).toBeNull();
      const { data, error } = await pgMeta.query(
        "SELECT name, price FROM products WHERE name = 'test-item'",
      );
      expect(error).toBeNull();
      expect(data).toEqual([{ name: "test-item", price: "9.99" }]);
    });

    test("returns structured error for invalid SQL", async () => {
      const { data, error } = await pgMeta.query(
        "SELECT * FROM nonexistent_table_xyz",
      );
      expect(data).toBeNull();
      expect(error).toBeDefined();
    });
  });
});
