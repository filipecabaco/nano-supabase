import { assertEquals, assertExists } from "jsr:@std/assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createClient, nanoSupabase } from "../../src/nano.ts";
import { PostgrestParser } from "../../src/postgrest-parser.ts";

const require = createRequire(import.meta.url);

const wasmPath = require.resolve(
  "postgrest-parser/pkg/postgrest_parser_bg.wasm",
);
await PostgrestParser.init(new Uint8Array(readFileSync(wasmPath)));

const testOptions = {
  sanitizeExit: false,
  sanitizeResources: false,
  sanitizeOps: false,
} as const;

Deno.test({
  name: "createClient boots",
  ...testOptions,
  fn: async () => {
    const supabase = await createClient();
    assertExists(supabase);
  },
});

Deno.test({
  name: "insert and select data",
  ...testOptions,
  fn: async () => {
    const nano = await nanoSupabase();
    await nano.db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);
    const supabase = nano.createClient();

    await (supabase.from("items") as ReturnType<typeof supabase.from>).insert({
      name: "deno-item",
    } as never);

    const { data, error: selectError } = await supabase
      .from("items")
      .select("*");

    assertEquals(selectError, null);
    assertExists(data);
    assertEquals((data as { name: string }[]).length, 1);
    assertEquals((data as { name: string }[])[0].name, "deno-item");
  },
});

Deno.test({
  name: "auth signup and signin",
  ...testOptions,
  fn: async () => {
    const supabase = await createClient();

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp(
      {
        email: "deno@example.com",
        password: "password123",
      },
    );

    assertEquals(signUpError, null);
    assertExists(signUpData.user);
    assertExists(signUpData.session);

    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email: "deno@example.com",
        password: "password123",
      });

    assertEquals(signInError, null);
    assertExists(signInData.session?.access_token);
  },
});

Deno.test({
  name: "RLS blocks unauthenticated access",
  ...testOptions,
  fn: async () => {
    const nano = await nanoSupabase();
    await nano.db.exec(`
    CREATE TABLE IF NOT EXISTS private_items (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL,
      value TEXT NOT NULL
    );
    ALTER TABLE private_items ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "owner only" ON private_items
      FOR ALL USING (auth.uid() = user_id);
  `);
    const supabase = nano.createClient();

    const { data, error } = await supabase.from("private_items").select("*");

    assertEquals(error, null);
    assertEquals((data as unknown[]).length, 0);
  },
});
