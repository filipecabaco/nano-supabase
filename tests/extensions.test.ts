import { describe, test, expect } from "vitest";
import { vector } from "@electric-sql/pglite/vector";
import { nanoSupabase } from "../src/nano.ts";
import { assertEquals, assertExists } from "./compat.ts";

describe("pgvector extension", () => {
  test("enables vector similarity search", async () => {
    const nano = await nanoSupabase({ extensions: { vector } });

    await nano.db.exec("CREATE EXTENSION IF NOT EXISTS vector");
    await nano.db.exec(`
      CREATE TABLE items (
        id SERIAL PRIMARY KEY,
        embedding vector(3)
      )
    `);
    await nano.db.exec(`
      INSERT INTO items (embedding) VALUES
        ('[1,0,0]'),
        ('[0,1,0]'),
        ('[0,0,1]')
    `);

    const result = await nano.db.query<{ id: number; distance: string }>(
      "SELECT id, embedding <-> '[1,0.1,0]' AS distance FROM items ORDER BY distance LIMIT 1",
    );

    assertEquals(result.rows.length, 1);
    assertEquals(result.rows[0].id, 1);

    await nano.stop();
  });

  test("works through the supabase client REST API", async () => {
    const nano = await nanoSupabase({ extensions: { vector } });

    await nano.db.exec("CREATE EXTENSION IF NOT EXISTS vector");
    await nano.db.exec(`
      CREATE TABLE documents (
        id SERIAL PRIMARY KEY,
        content TEXT,
        embedding vector(3)
      )
    `);

    const supabase = nano.createClient();
    await supabase.from("documents").insert([
      { content: "foo", embedding: "[1,0,0]" },
      { content: "bar", embedding: "[0,1,0]" },
    ]);

    const { data, error } = await supabase.from("documents").select("id, content");
    assertExists(data);
    expect(error).toBeNull();
    assertEquals(data.length, 2);

    await nano.stop();
  });
});
