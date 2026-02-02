/**
 * Val.town Example: AI Chat History API with nano-supabase
 *
 * A local PostgreSQL-powered chat store with persistent storage.
 * Data survives cold starts using Val.town's blob storage.
 *
 * To use:
 * 1. Go to https://val.town and create a new val
 * 2. Copy this code into the editor
 * 3. Set the val type to HTTP
 * 4. Your API is instantly live!
 */

import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { createSupabaseClient } from "https://raw.githubusercontent.com/filipecabaco/nano-supabase/main/dist/index.js";
import { blob } from "https://esm.town/v/std/blob";

const BLOB_KEY = "nano-supabase-chat-db";

let db: PGlite | null = null;
let supabase: Awaited<ReturnType<typeof createSupabaseClient>> | null = null;
let initialized = false;

async function saveDb() {
  if (!db) return;
  try {
    // Export all data as SQL statements
    const conversations = await db.query("SELECT * FROM conversations");
    const messages = await db.query("SELECT * FROM messages");
    await blob.setJSON(BLOB_KEY, {
      conversations: conversations.rows,
      messages: messages.rows,
      savedAt: new Date().toISOString(),
    });
    console.log("Saved database to blob storage");
  } catch (e) {
    console.error("Failed to save:", e);
  }
}

async function restoreFromBlob(db: PGlite) {
  try {
    const saved = await blob.getJSON(BLOB_KEY) as {
      conversations: Array<{ id: string; title: string; created_at: string }>;
      messages: Array<{ id: string; conversation_id: string; role: string; content: string; tokens: number; created_at: string }>;
    } | null;

    if (saved?.conversations) {
      for (const conv of saved.conversations) {
        await db.query(
          `INSERT INTO conversations (id, title, created_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
          [conv.id, conv.title, conv.created_at]
        );
      }
    }
    if (saved?.messages) {
      for (const msg of saved.messages) {
        await db.query(
          `INSERT INTO messages (id, conversation_id, role, content, tokens, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
          [msg.id, msg.conversation_id, msg.role, msg.content, msg.tokens, msg.created_at]
        );
      }
    }
    return saved !== null;
  } catch {
    return false;
  }
}

async function initDb() {
  if (!db || !initialized) {
    db = new PGlite();

    // Create tables first
    await db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        title TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        conversation_id TEXT REFERENCES conversations(id),
        role TEXT CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        tokens INTEGER,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id, created_at);
    `);

    // Then restore data from blob
    const restored = await restoreFromBlob(db);
    console.log(restored ? "Restored from blob storage" : "Starting fresh");

    supabase = await createSupabaseClient(db);
    initialized = true;
  }
  return { db, supabase: supabase! };
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  try {
    const { db, supabase } = await initDb();

    // GET /conversations
    if (req.method === "GET" && path === "/conversations") {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .order("created_at", { ascending: false });
      return Response.json({ data, error: error?.message }, { headers });
    }

    // POST /conversations
    if (req.method === "POST" && path === "/conversations") {
      const body = await req.json();
      const result = await db.query(
        `INSERT INTO conversations (title) VALUES ($1) RETURNING *`,
        [body.title || "New Chat"]
      );
      await saveDb();
      return Response.json({ data: result.rows[0] }, { headers });
    }

    // GET /messages?conversation_id=xxx
    if (req.method === "GET" && path === "/messages") {
      const conversationId = url.searchParams.get("conversation_id");
      if (!conversationId) {
        return Response.json({ error: "conversation_id required" }, { status: 400, headers });
      }
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      return Response.json({ data, error: error?.message }, { headers });
    }

    // POST /messages
    if (req.method === "POST" && path === "/messages") {
      const body = await req.json();
      const result = await db.query(
        `INSERT INTO messages (conversation_id, role, content, tokens)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [body.conversation_id, body.role, body.content, body.tokens || null]
      );
      await saveDb();
      return Response.json({ data: result.rows[0] }, { headers });
    }

    // GET /stats
    if (req.method === "GET" && path === "/stats") {
      const result = await db.query(`
        SELECT COUNT(*) as total_messages,
               COALESCE(SUM(tokens), 0) as total_tokens,
               COUNT(DISTINCT conversation_id) as conversations
        FROM messages
      `);
      return Response.json({ data: result.rows[0] }, { headers });
    }

    return Response.json({
      message: "nano-supabase Chat API (with persistence)",
      github: "https://github.com/filipecabaco/nano-supabase",
      endpoints: [
        "GET  /conversations",
        "POST /conversations { title }",
        "GET  /messages?conversation_id=xxx",
        "POST /messages { conversation_id, role, content, tokens? }",
        "GET  /stats",
      ],
    }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500, headers }
    );
  }
}
