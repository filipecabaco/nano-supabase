/**
 * Val.town Example: AI Chat History API with nano-supabase
 *
 * A local PostgreSQL-powered chat store - no external database needed!
 * Deploy this on Val.town to get an instant API for storing chat conversations.
 *
 * Live example: https://www.val.town/x/filipecabaco/nano-supabase-chat
 *
 * To use:
 * 1. Go to https://val.town and create a new HTTP val
 * 2. Copy this code into the editor
 * 3. Your API is instantly live!
 *
 * Note: Each request gets a fresh database (stateless).
 * For persistence, combine with Val.town's blob storage.
 */

import { PGlite } from "npm:@electric-sql/pglite";
import { createSupabaseClient } from "https://raw.githubusercontent.com/filipecabaco/nano-supabase/main/dist/index.js";

// Initialize PGlite (runs PostgreSQL in WebAssembly)
const db = new PGlite();

// Create schema for chat messages
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

// Create Supabase-compatible client
const supabase = await createSupabaseClient(db);

// HTTP handler for Val.town
export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS headers for API access
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  // GET /conversations - list all conversations
  if (req.method === "GET" && path === "/conversations") {
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .order("created_at", { ascending: false });

    return Response.json({ data, error: error?.message }, { headers });
  }

  // POST /conversations - create new conversation
  if (req.method === "POST" && path === "/conversations") {
    const body = await req.json();
    const { data, error } = await supabase
      .from("conversations")
      .insert({ title: body.title || "New Chat" })
      .select("*")
      .single();

    return Response.json({ data, error: error?.message }, { headers });
  }

  // GET /messages?conversation_id=xxx - get messages for a conversation
  if (req.method === "GET" && path === "/messages") {
    const conversationId = url.searchParams.get("conversation_id");
    if (!conversationId) {
      return Response.json(
        { error: "conversation_id required" },
        { status: 400, headers }
      );
    }

    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    return Response.json({ data, error: error?.message }, { headers });
  }

  // POST /messages - add a message
  if (req.method === "POST" && path === "/messages") {
    const body = await req.json();
    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: body.conversation_id,
        role: body.role,
        content: body.content,
        tokens: body.tokens,
      })
      .select("*")
      .single();

    return Response.json({ data, error: error?.message }, { headers });
  }

  // GET /stats - token usage stats
  if (req.method === "GET" && path === "/stats") {
    const result = await db.query(`
      SELECT
        COUNT(*) as total_messages,
        COALESCE(SUM(tokens), 0) as total_tokens,
        COUNT(DISTINCT conversation_id) as conversations
      FROM messages
    `);

    return Response.json({ data: result.rows[0] }, { headers });
  }

  return Response.json(
    {
      message: "nano-supabase Chat API",
      description:
        "A local PostgreSQL-powered chat store running entirely in WebAssembly",
      github: "https://github.com/filipecabaco/nano-supabase",
      endpoints: [
        "GET  /conversations - List all conversations",
        "POST /conversations - Create new conversation { title: string }",
        "GET  /messages?conversation_id=xxx - Get messages for a conversation",
        "POST /messages - Add a message { conversation_id, role, content, tokens? }",
        "GET  /stats - Get token usage statistics",
      ],
    },
    { headers }
  );
}
