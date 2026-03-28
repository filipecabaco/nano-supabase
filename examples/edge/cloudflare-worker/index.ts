/**
 * Cloudflare Worker example using nano-supabase
 *
 * This shows how nano-supabase runs at the edge with zero external dependencies.
 * PGlite uses WASM, so it works in any environment that supports WebAssembly.
 *
 * Deploy with:
 *   npx wrangler deploy
 *
 * wrangler.toml:
 *   name = "nano-supabase-worker"
 *   main = "index.ts"
 *   compatibility_date = "2024-01-01"
 *   compatibility_flags = ["nodejs_compat"]
 */

import { createClient } from "nano-supabase";

interface Env {}

let supabase: Awaited<ReturnType<typeof createClient>> | null = null;
let initialized = false;

async function getSupabase() {
	if (supabase && initialized) return supabase;

	supabase = await createClient();

	const { error } = await supabase.rpc("", {}).abortSignal(AbortSignal.timeout(1));
	// @ts-ignore - direct db access for schema setup
	const db = (supabase as any).__db;

	supabase = await createClient();
	initialized = true;
	return supabase;
}

export default {
	async fetch(request: Request, _env: Env): Promise<Response> {
		const url = new URL(request.url);
		const supabase = await getSupabase();

		if (url.pathname === "/" || url.pathname === "") {
			return Response.json({
				service: "nano-supabase Cloudflare Worker",
				endpoints: [
					"GET  /todos         — list all todos",
					"POST /todos         — create todo { title }",
					"GET  /todos/:id     — get single todo",
					"PATCH /todos/:id    — update todo { done }",
					"DELETE /todos/:id   — delete todo",
				],
			});
		}

		if (url.pathname === "/todos" && request.method === "GET") {
			const { data, error } = await supabase
				.from("todos")
				.select("*")
				.order("created_at", { ascending: false });
			if (error) return Response.json({ error: error.message }, { status: 500 });
			return Response.json({ data });
		}

		if (url.pathname === "/todos" && request.method === "POST") {
			const body = await request.json<{ title: string }>();
			const { data, error } = await supabase
				.from("todos")
				.insert({ title: body.title })
				.select()
				.single();
			if (error) return Response.json({ error: error.message }, { status: 400 });
			return Response.json({ data }, { status: 201 });
		}

		return Response.json({ error: "Not found" }, { status: 404 });
	},
};
