/**
 * Deno example using nano-supabase
 *
 * Run with:
 *   deno run --allow-read --allow-env --allow-net index.ts
 *
 * nano-supabase uses Web Crypto API (not Node.js crypto), so it works
 * natively in Deno without compatibility flags.
 */

import { PGlite } from "npm:@electric-sql/pglite";
import { createClient } from "npm:@supabase/supabase-js";
import { createFetchAdapter, createPGlite } from "npm:nano-supabase";

async function main() {
	console.log("=== Deno + nano-supabase Demo ===\n");

	const db = await createPGlite();
	const { localFetch, authHandler } = await createFetchAdapter({
		db,
		supabaseUrl: "http://localhost:54321",
	});

	const supabase = createClient("http://localhost:54321", "local-anon-key", {
		auth: { autoRefreshToken: false },
		global: { fetch: localFetch as typeof fetch },
	});

	console.log("[Schema] Creating tables...");
	await db.exec(`
		CREATE TABLE IF NOT EXISTS notes (
			id SERIAL PRIMARY KEY,
			user_id UUID DEFAULT auth.uid(),
			title TEXT NOT NULL,
			content TEXT DEFAULT '',
			created_at TIMESTAMP DEFAULT NOW()
		);

		ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

		CREATE POLICY "Users see own notes"
			ON notes FOR ALL
			USING (user_id = auth.uid());
	`);
	console.log("  Done\n");

	console.log("--- 1: Auth ---");
	const { data: { user } } = await supabase.auth.signUp({
		email: "deno-user@example.com",
		password: "password123",
	});
	console.log(`  Signed up: ${user?.email}`);

	await supabase.auth.signInWithPassword({
		email: "deno-user@example.com",
		password: "password123",
	});
	console.log("  Signed in");
	console.log();

	console.log("--- 2: CRUD ---");
	await supabase.from("notes").insert({ title: "Deno note", content: "Running on Deno!" });
	await supabase.from("notes").insert({ title: "Web APIs", content: "Deno uses Web Crypto natively" });

	const { data: notes } = await supabase.from("notes").select("title,content");
	console.log("  Notes:", notes);
	console.log();

	console.log("--- 3: Deno-native features ---");
	const encoder = new TextEncoder();
	const data = encoder.encode("Hello from Deno");
	const hash = await crypto.subtle.digest("SHA-256", data);
	const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
	console.log(`  Web Crypto SHA-256: ${hashHex.slice(0, 16)}...`);
	console.log("  (nano-supabase uses the same Web Crypto API for JWT signing)\n");

	console.log("--- 4: Direct SQL ---");
	const { rows } = await db.query("SELECT COUNT(*) AS total FROM notes");
	console.log(`  Total notes via direct SQL: ${rows[0]?.total}`);
	console.log();

	console.log("All Deno examples completed successfully!");
}

main().catch(console.error);
