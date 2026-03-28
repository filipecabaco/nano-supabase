import { createClient } from "@supabase/supabase-js";
import { createFetchAdapter } from "../../../src/index.ts";
import { createPGlite } from "../../../src/pglite-factory.ts";

async function main() {
	console.log("=== Auth + Row Level Security Demo ===\n");

	const db = await createPGlite();
	const { localFetch, authHandler } = await createFetchAdapter({
		db,
		supabaseUrl: "http://localhost:54321",
	});

	const supabase = createClient("http://localhost:54321", "local-anon-key", {
		auth: { autoRefreshToken: false },
		global: { fetch: localFetch as typeof fetch },
	});

	console.log("[Schema] Creating todos table with RLS policies...");
	await db.exec(`
		CREATE TABLE IF NOT EXISTS todos (
			id SERIAL PRIMARY KEY,
			user_id UUID NOT NULL DEFAULT auth.uid(),
			title TEXT NOT NULL,
			done BOOLEAN DEFAULT false,
			created_at TIMESTAMP DEFAULT NOW()
		);

		ALTER TABLE todos ENABLE ROW LEVEL SECURITY;

		CREATE POLICY "Users can view their own todos"
			ON todos FOR SELECT
			USING (user_id = auth.uid());

		CREATE POLICY "Users can insert their own todos"
			ON todos FOR INSERT
			WITH CHECK (user_id = auth.uid());

		CREATE POLICY "Users can update their own todos"
			ON todos FOR UPDATE
			USING (user_id = auth.uid());

		CREATE POLICY "Users can delete their own todos"
			ON todos FOR DELETE
			USING (user_id = auth.uid());
	`);
	console.log("  Done\n");

	console.log("--- 1: Sign up two users ---");
	const { data: alice } = await supabase.auth.signUp({
		email: "alice@example.com",
		password: "password123",
	});
	console.log(`  Alice signed up: ${alice.user?.id}`);

	const { data: bob } = await supabase.auth.signUp({
		email: "bob@example.com",
		password: "password456",
	});
	console.log(`  Bob signed up: ${bob.user?.id}`);
	console.log();

	console.log("--- 2: Alice signs in and creates todos ---");
	await supabase.auth.signInWithPassword({
		email: "alice@example.com",
		password: "password123",
	});

	await supabase.from("todos").insert({ title: "Buy groceries" });
	await supabase.from("todos").insert({ title: "Walk the dog" });
	await supabase.from("todos").insert({ title: "Read a book" });

	const { data: aliceTodos } = await supabase.from("todos").select("*");
	console.log(`  Alice sees ${aliceTodos?.length} todos:`, aliceTodos?.map((t) => t.title));
	console.log();

	console.log("--- 3: Bob signs in — cannot see Alice's todos ---");
	await supabase.auth.signInWithPassword({
		email: "bob@example.com",
		password: "password456",
	});

	const { data: bobTodos } = await supabase.from("todos").select("*");
	console.log(`  Bob sees ${bobTodos?.length} todos (RLS blocks Alice's data)`);

	await supabase.from("todos").insert({ title: "Practice guitar" });
	const { data: bobTodosAfter } = await supabase.from("todos").select("*");
	console.log(`  After insert, Bob sees ${bobTodosAfter?.length} todo:`, bobTodosAfter?.map((t) => t.title));
	console.log();

	console.log("--- 4: Anonymous access — sees nothing ---");
	await supabase.auth.signOut();

	const { data: anonTodos } = await supabase.from("todos").select("*");
	console.log(`  Anonymous sees ${anonTodos?.length ?? 0} todos`);
	console.log();

	console.log("--- 5: Alice signs back in — still sees only her data ---");
	await supabase.auth.signInWithPassword({
		email: "alice@example.com",
		password: "password123",
	});

	const { data: aliceFinal } = await supabase.from("todos").select("*");
	console.log(`  Alice sees ${aliceFinal?.length} todos:`, aliceFinal?.map((t) => t.title));

	await supabase.from("todos").update({ done: true }).eq("title", "Buy groceries");
	const { data: updated } = await supabase.from("todos").select("title,done").eq("done", true);
	console.log(`  Completed:`, updated?.map((t) => t.title));
	console.log();

	console.log("--- 6: Admin can see all users ---");
	const { users } = await authHandler.adminListUsers();
	console.log(`  Admin sees ${users.length} users:`, users.map((u) => u.email));
	console.log();

	console.log("All auth + RLS examples completed successfully!");
}

main().catch(console.error);
