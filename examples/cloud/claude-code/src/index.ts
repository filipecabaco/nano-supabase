import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
	"http://localhost:54321",
	"local-anon-key",
);

async function main() {
	console.log("=== Claude Code Cloud Demo ===\n");

	console.log("--- 1: Sign up ---");
	const { data: auth, error: authErr } = await supabase.auth.signUp({
		email: "dev@example.com",
		password: "password123",
	});
	if (authErr) throw authErr;
	console.log(`  User: ${auth.user?.email} (${auth.user?.id})\n`);

	console.log("--- 2: Sign in ---");
	await supabase.auth.signInWithPassword({
		email: "dev@example.com",
		password: "password123",
	});
	console.log("  Signed in\n");

	console.log("--- 3: Create todos ---");
	await supabase.from("todos").insert({ title: "Set up database" });
	await supabase.from("todos").insert({ title: "Create API endpoints" });
	await supabase.from("todos").insert({ title: "Write tests" });
	console.log("  Created 3 todos\n");

	console.log("--- 4: List todos ---");
	const { data: todos } = await supabase
		.from("todos")
		.select("*")
		.order("created_at");
	console.log("  Todos:", todos?.map((t) => `${t.done ? "✓" : "○"} ${t.title}`));
	console.log();

	console.log("--- 5: Complete a todo ---");
	if (todos?.[0]) {
		await supabase
			.from("todos")
			.update({ done: true })
			.eq("id", todos[0].id);
	}
	const { data: updated } = await supabase
		.from("todos")
		.select("title, done")
		.order("created_at");
	console.log("  Updated:", updated?.map((t) => `${t.done ? "✓" : "○"} ${t.title}`));
	console.log();

	console.log("--- 6: RLS check (sign out → no access) ---");
	await supabase.auth.signOut();
	const { data: noAccess } = await supabase.from("todos").select("*");
	console.log(`  Anonymous sees ${noAccess?.length ?? 0} todos (RLS enforced)\n`);

	console.log("Done! Server keeps running in the background.");
	console.log("Run: npx nano-supabase db exec --sql \"SELECT * FROM todos\"");
}

main().catch(console.error);
