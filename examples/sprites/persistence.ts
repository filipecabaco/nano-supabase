import { PGlite } from "@electric-sql/pglite";
import { createSupabaseClient } from "nano-supabase";
import { createSchema } from "./schema.ts";

const DB_PATH = "./data/pglite";

let db: PGlite | null = null;
let supabase: Awaited<ReturnType<typeof createSupabaseClient>> | null = null;
let initialized = false;

export async function initDb() {
  if (db && initialized) return { db, supabase: supabase! };

  db = new PGlite(DB_PATH);

  const { rows } = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT FROM pg_tables WHERE tablename = 'feature_flags')`
  );

  if (!rows[0]?.exists) {
    await createSchema(db);
  }

  supabase = await createSupabaseClient(db);
  initialized = true;
  return { db, supabase: supabase! };
}
