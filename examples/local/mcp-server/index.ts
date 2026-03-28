import { nanoSupabase } from "../../../src/index.ts";

async function main() {
	console.log("=== MCP Server Demo ===\n");

	console.log(
		"The MCP (Model Context Protocol) server lets AI tools like Claude Code",
	);
	console.log(
		"interact with your nano-supabase instance — running SQL, managing migrations,",
	);
	console.log("and generating TypeScript types.\n");

	console.log("--- Option 1: CLI with --mcp flag ---");
	console.log("  npx nano-supabase start --mcp");
	console.log("  → MCP server available at http://localhost:54321/mcp\n");

	console.log("--- Option 2: Claude Code integration ---");
	console.log("  Add to .claude/settings.json:\n");
	console.log('  {');
	console.log('    "mcpServers": {');
	console.log('      "nano-supabase": {');
	console.log('        "command": "npx",');
	console.log('        "args": ["nano-supabase", "start", "--mcp", "--detach"]');
	console.log("      }");
	console.log("    }");
	console.log("  }\n");

	console.log("--- Starting MCP-enabled server ---");
	await using nano = await nanoSupabase({
		tcp: { port: 5433 },
	});
	const db = nano.db;

	await db.exec(`
		CREATE TABLE IF NOT EXISTS tasks (
			id SERIAL PRIMARY KEY,
			title TEXT NOT NULL,
			status TEXT DEFAULT 'pending',
			created_at TIMESTAMP DEFAULT NOW()
		)
	`);
	await db.exec(`
		INSERT INTO tasks (title, status) VALUES
			('Set up database', 'done'),
			('Create API endpoints', 'in_progress'),
			('Write tests', 'pending')
	`);

	console.log("\n[Server] nano-supabase running with sample data");
	console.log(`[Server] TCP: ${nano.connectionString}`);
	console.log("[Server] HTTP: http://localhost:54321");
	console.log("[Server] MCP: http://localhost:54321/mcp (when started with --mcp)\n");

	console.log("Available MCP tools:");
	console.log("  - execute_sql: Run SQL queries against the database");
	console.log("  - list_migrations: Show applied migrations");
	console.log("  - apply_migration: Apply a new migration");
	console.log("  - generate_typescript_types: Generate TS types from schema");
	console.log("  - get_project_url: Get the project URL");
	console.log("  - get_publishable_keys: Get anon/service-role keys\n");

	console.log("Press Ctrl+C to stop\n");
	await new Promise(() => {});
}

main().catch(console.error);
