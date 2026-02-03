import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { createSupabaseClient } from "https://raw.githubusercontent.com/filipecabaco/nano-supabase/main/dist/index.js";
import { blob } from "https://esm.town/v/std/blob";
import { createSchema } from "./schema.ts";

const BLOB_KEY = "nano-supabase-flags-db";

let db: PGlite | null = null;
let supabase: Awaited<ReturnType<typeof createSupabaseClient>> | null = null;
let initialized = false;

async function loadSnapshot(): Promise<Blob | null> {
  try {
    const response = await blob.get(BLOB_KEY);
    if (!response) return null;
    const data = await response.arrayBuffer();
    if (data.byteLength === 0) return null;
    return new Blob([data]);
  } catch {
    return null;
  }
}

export async function saveSnapshot() {
  if (!db) return;
  try {
    const backup = await db.dumpDataDir("gzip");
    await blob.set(BLOB_KEY, backup);
  } catch (e) {
    console.error("Failed to save snapshot:", e);
  }
}

export async function initDb() {
  if (db && initialized) return { db, supabase: supabase! };

  const snapshot = await loadSnapshot();

  if (snapshot) {
    db = new PGlite({ loadDataDir: snapshot });
  } else {
    db = new PGlite();
    await createSchema(db);
  }

  supabase = await createSupabaseClient(db);
  initialized = true;
  return { db, supabase: supabase! };
}
