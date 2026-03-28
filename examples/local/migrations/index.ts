import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nanoSupabase } from "../../../src/index.ts";

async function main() {
	console.log("=== Migrations Demo ===\n");

	console.log(
		"Migrations are versioned SQL files that track schema changes.",
	);
	console.log(
		"They live in supabase/migrations/ and are applied in order.\n",
	);

	console.log("--- CLI workflow (recommended) ---");
	console.log("  npx nano-supabase migration new create_todos");
	console.log("  # Edit supabase/migrations/<timestamp>_create_todos.sql");
	console.log("  npx nano-supabase migration up");
	console.log("  npx nano-supabase migration list\n");

	console.log("--- Programmatic demo ---\n");

	const migrationsDir = join(import.meta.dirname ?? ".", "supabase/migrations");
	mkdirSync(migrationsDir, { recursive: true });

	console.log("[1] Creating migration files...");

	writeFileSync(
		join(migrationsDir, "20240101000000_create_users.sql"),
		`CREATE TABLE IF NOT EXISTS users (
	id SERIAL PRIMARY KEY,
	name TEXT NOT NULL,
	email TEXT UNIQUE NOT NULL,
	created_at TIMESTAMP DEFAULT NOW()
);`,
	);
	console.log("  Created: 20240101000000_create_users.sql");

	writeFileSync(
		join(migrationsDir, "20240102000000_create_posts.sql"),
		`CREATE TABLE IF NOT EXISTS posts (
	id SERIAL PRIMARY KEY,
	user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
	title TEXT NOT NULL,
	body TEXT,
	published BOOLEAN DEFAULT false,
	created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);`,
	);
	console.log("  Created: 20240102000000_create_posts.sql");

	writeFileSync(
		join(migrationsDir, "20240103000000_add_user_role.sql"),
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';

CREATE TABLE IF NOT EXISTS user_settings (
	user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	theme TEXT DEFAULT 'light',
	notifications BOOLEAN DEFAULT true
);`,
	);
	console.log("  Created: 20240103000000_add_user_role.sql");
	console.log();

	console.log("[2] Applying migrations...");

	await using nano = await nanoSupabase();
	const db = nano.db;

	const files = readdirSync(migrationsDir)
		.filter((f) => f.endsWith(".sql"))
		.sort();

	for (const file of files) {
		const sql = readFileSync(join(migrationsDir, file), "utf-8");
		await db.exec(sql);
		console.log(`  Applied: ${file}`);
	}
	console.log();

	console.log("[3] Verifying schema...");

	await db.exec(`
		INSERT INTO users (name, email, role) VALUES
			('Alice', 'alice@example.com', 'admin'),
			('Bob', 'bob@example.com', 'user')
	`);

	await db.exec(`
		INSERT INTO posts (user_id, title, body, published) VALUES
			(1, 'Hello World', 'First post!', true),
			(1, 'Draft', 'Work in progress', false)
	`);

	await db.exec(`
		INSERT INTO user_settings (user_id, theme, notifications) VALUES
			(1, 'dark', true),
			(2, 'light', false)
	`);

	const { rows: users } = await db.query("SELECT name, email, role FROM users ORDER BY id");
	console.log("  Users:", users);

	const { rows: posts } = await db.query("SELECT title, published FROM posts ORDER BY id");
	console.log("  Posts:", posts);

	const { rows: settings } = await db.query(
		"SELECT u.name, s.theme, s.notifications FROM user_settings s JOIN users u ON u.id = s.user_id ORDER BY s.user_id",
	);
	console.log("  Settings:", settings);
	console.log();

	console.log("[4] Migration file listing:");
	for (const file of files) {
		const match = file.match(/^(\d+)_(.+)\.sql$/);
		if (match) {
			console.log(`  ${match[1]}  ${match[2].replace(/_/g, " ")}`);
		}
	}
	console.log();

	console.log("--- Sync commands ---");
	console.log("  npx nano-supabase sync push --remote-db-url=<url>   # push migrations to remote");
	console.log("  npx nano-supabase sync pull --remote-db-url=<url>   # pull schema from remote\n");

	console.log("All migration examples completed successfully!");
}

main().catch(console.error);
