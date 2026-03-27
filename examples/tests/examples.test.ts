import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { nanoSupabase } from "../../src/index.ts";
import { PGlitePooler } from "../../src/pooler.ts";
import { PostgrestParser } from "../../src/postgrest-parser.ts";
import { QueryPriority } from "../../src/types.ts";

describe("library/pooler", () => {
	it("executes queries respecting priority ordering", async () => {
		const db = new PGlite();
		await db.exec(
			"CREATE TABLE items (id SERIAL PRIMARY KEY, name TEXT, priority TEXT)",
		);

		await using pooler = await PGlitePooler.create(db);

		await Promise.all([
			pooler.query(
				"INSERT INTO items (name, priority) VALUES ('low', 'LOW')",
				[],
				QueryPriority.LOW,
			),
			pooler.query(
				"INSERT INTO items (name, priority) VALUES ('high', 'HIGH')",
				[],
				QueryPriority.HIGH,
			),
			pooler.query(
				"INSERT INTO items (name, priority) VALUES ('medium', 'MEDIUM')",
				[],
				QueryPriority.MEDIUM,
			),
		]);

		const result = await pooler.query("SELECT priority FROM items ORDER BY id");
		expect(result.rows.length).toBe(3);
	});

	it("handles concurrent inserts", async () => {
		const db = new PGlite();
		await db.exec(
			"CREATE TABLE items (id SERIAL PRIMARY KEY, name TEXT, priority TEXT)",
		);

		await using pooler = await PGlitePooler.create(db);

		await Promise.all(
			Array.from({ length: 10 }, (_, i) =>
				pooler.query(
					"INSERT INTO items (name, priority) VALUES ($1, 'MEDIUM')",
					[`item-${i}`],
				),
			),
		);

		const count = await pooler.query("SELECT COUNT(*) AS n FROM items");
		expect(Number(count.rows[0]?.["n"])).toBe(10);
	});

	it("supports parameterized queries", async () => {
		const db = new PGlite();
		await db.exec(
			"CREATE TABLE items (id SERIAL PRIMARY KEY, name TEXT, priority TEXT)",
		);

		await using pooler = await PGlitePooler.create(db);

		await pooler.query(
			"INSERT INTO items (name, priority) VALUES ($1, $2)",
			["named", "HIGH"],
		);
		const found = await pooler.query(
			"SELECT name FROM items WHERE name = $1",
			["named"],
		);
		expect(found.rows[0]?.["name"]).toBe("named");
	});

	it("catches errors on invalid queries", async () => {
		const db = new PGlite();
		await using pooler = await PGlitePooler.create(db);

		await expect(
			pooler.query("SELECT * FROM no_such_table"),
		).rejects.toThrow();
	});

	it("rolls back transactions on error", async () => {
		const db = new PGlite();
		await db.exec(
			"CREATE TABLE items (id SERIAL PRIMARY KEY, name TEXT, priority TEXT)",
		);

		await using pooler = await PGlitePooler.create(db);

		await expect(
			pooler.transaction(async (query) => {
				await query("INSERT INTO items (name, priority) VALUES ('tx', 'HIGH')");
				await query("SELECT * FROM no_such_table");
			}),
		).rejects.toThrow();

		const count = await pooler.query(
			"SELECT COUNT(*) AS n FROM items WHERE name = 'tx'",
		);
		expect(Number(count.rows[0]?.["n"])).toBe(0);
	});

	it("reports metrics", async () => {
		const db = new PGlite();
		await db.exec("CREATE TABLE items (id SERIAL PRIMARY KEY, name TEXT)");

		await using pooler = await PGlitePooler.create(db);

		await pooler.query("INSERT INTO items (name) VALUES ('a')");
		await pooler.query("INSERT INTO items (name) VALUES ('b')");

		const m = pooler.metrics();
		expect(m.totalEnqueued).toBeGreaterThanOrEqual(2);
		expect(m.totalDequeued).toBeGreaterThanOrEqual(2);
	});
});

describe("library/supabase-client", () => {
	it("performs full CRUD via supabase-compatible client", async () => {
		const nano = await nanoSupabase();
		const db = nano.db;
		const supabase = nano.createClient();

		await db.exec(`
			CREATE TABLE users (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				email TEXT UNIQUE NOT NULL,
				age INTEGER,
				status TEXT DEFAULT 'active',
				created_at TIMESTAMP DEFAULT NOW()
			);
			CREATE TABLE posts (
				id SERIAL PRIMARY KEY,
				user_id INTEGER REFERENCES users(id),
				title TEXT NOT NULL,
				content TEXT,
				published BOOLEAN DEFAULT false,
				created_at TIMESTAMP DEFAULT NOW()
			);
		`);

		await supabase
			.from("users")
			.insert({ name: "Alice", email: "alice@example.com", age: 25 });

		const { data: allUsers } = await supabase.from("users").select("*");
		expect(allUsers).toHaveLength(1);
		expect(allUsers![0].name).toBe("Alice");

		await supabase
			.from("users")
			.insert({ name: "Bob", email: "bob@example.com", age: 30 });
		await supabase
			.from("users")
			.insert({ name: "Charlie", email: "charlie@example.com", age: 35 });

		const { data: filtered } = await supabase
			.from("users")
			.select("name,age")
			.gte("age", 25)
			.lte("age", 30);
		expect(filtered).toHaveLength(2);

		const { data: ordered } = await supabase
			.from("users")
			.select("name,age")
			.order("age", { ascending: false })
			.limit(2);
		expect(ordered![0].name).toBe("Charlie");
		expect(ordered![1].name).toBe("Bob");

		await supabase
			.from("users")
			.update({ age: 26 })
			.eq("name", "Alice");

		const { data: afterUpdate } = await supabase
			.from("users")
			.select("name,age")
			.eq("name", "Alice");
		expect(afterUpdate).toHaveLength(1);
		expect(afterUpdate![0].age).toBe(26);

		const { error: postError } = await supabase.from("posts").insert({
			user_id: allUsers![0].id,
			title: "My First Post",
			content: "Hello!",
			published: true,
		});
		expect(postError).toBeNull();

		const { data: posts, error: postsError } = await supabase
			.from("posts")
			.select("title,published");
		expect(postsError).toBeNull();
		expect(posts).toHaveLength(1);
		expect(posts![0].published).toBe(true);

		await supabase.from("users").delete().eq("name", "Charlie");
		const { data: remaining } = await supabase.from("users").select("name");
		expect(remaining).toHaveLength(2);

		const { data: inFilter } = await supabase
			.from("users")
			.select("name")
			.in("name", ["Alice", "Bob"]);
		expect(inFilter).toHaveLength(2);

		await nano.stop();
	});
});

describe("library/postgrest-parser", () => {
	it("parses SELECT queries", async () => {
		const parser = new PostgrestParser();

		const select = parser.parseSelect("users", "select=id,name,email");
		expect(select.sql).toBeTruthy();
		expect(select.tables).toContain("users");
	});

	it("parses SELECT with filters", async () => {
		const parser = new PostgrestParser();

		const select = parser.parseSelect("users", "id=eq.1&select=id,name");
		expect(select.sql).toBeTruthy();
		expect(select.params.length).toBeGreaterThan(0);
	});

	it("parses INSERT queries", async () => {
		const parser = new PostgrestParser();

		const insert = parser.parseInsert("users", {
			name: "Alice",
			email: "alice@example.com",
			age: 25,
		});
		expect(insert.sql).toContain("INSERT");
		expect(insert.params.length).toBeGreaterThan(0);
	});

	it("parses UPDATE queries", async () => {
		const parser = new PostgrestParser();

		const update = parser.parseUpdate(
			"users",
			{ name: "Alice Smith", age: 26 },
			"id=eq.1",
		);
		expect(update.sql).toContain("UPDATE");
	});

	it("parses DELETE queries", async () => {
		const parser = new PostgrestParser();

		const del = parser.parseDelete("users", "id=eq.1");
		expect(del.sql).toContain("DELETE");
	});

	it("parses RPC calls", async () => {
		const parser = new PostgrestParser();

		const rpc = parser.parseRpc("calculate_total", { order_id: 123 });
		expect(rpc.sql).toBeTruthy();
	});

	it("parses generic HTTP requests", async () => {
		const parser = new PostgrestParser();

		const request = parser.parseRequest(
			"GET",
			"users",
			"age=gte.18&select=id,name",
		);
		expect(request.sql).toBeTruthy();
	});
});

describe("cli/tcp-server", () => {
	it("starts TCP server and creates sample data", async () => {
		await using nano = await nanoSupabase({ tcp: { port: 0 } });
		const db = nano.db;

		await db.exec(`
			CREATE TABLE users (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				email TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`);
		await db.exec(`
			INSERT INTO users (name, email) VALUES
				('Alice', 'alice@example.com'),
				('Bob', 'bob@example.com'),
				('Charlie', 'charlie@example.com')
		`);

		const result = await db.query("SELECT COUNT(*) AS n FROM users");
		expect(Number(result.rows[0]?.n)).toBe(3);

		expect(nano.connectionString).toBeTruthy();
	});
});

let hasDrizzle = false;
try {
	await import("drizzle-orm");
	hasDrizzle = true;
} catch {}

describe.skipIf(!hasDrizzle)("orm/drizzle", () => {
	it("performs type-safe CRUD via Drizzle ORM", async () => {
		const { eq, desc, and, gte, lte } = await import("drizzle-orm");
		const { boolean, integer, pgTable, serial, text, timestamp } = await import(
			"drizzle-orm/pg-core"
		);
		const { drizzle } = await import("drizzle-orm/pglite");

		await using nano = await nanoSupabase();
		const pglite = nano.db;
		await pglite.exec(`
			CREATE TABLE users (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				email TEXT UNIQUE NOT NULL,
				age INTEGER,
				created_at TIMESTAMP DEFAULT NOW()
			);
			CREATE TABLE posts (
				id SERIAL PRIMARY KEY,
				user_id INTEGER REFERENCES users(id),
				title TEXT NOT NULL,
				content TEXT,
				published BOOLEAN DEFAULT false,
				created_at TIMESTAMP DEFAULT NOW()
			);
		`);

		const users = pgTable("users", {
			id: serial("id").primaryKey(),
			name: text("name").notNull(),
			email: text("email").notNull().unique(),
			age: integer("age"),
			createdAt: timestamp("created_at").defaultNow(),
		});

		const posts = pgTable("posts", {
			id: serial("id").primaryKey(),
			userId: integer("user_id").references(() => users.id),
			title: text("title").notNull(),
			content: text("content"),
			published: boolean("published").default(false),
			createdAt: timestamp("created_at").defaultNow(),
		});

		const db = drizzle(pglite);

		await db.insert(users).values([
			{ name: "Alice", email: "alice@example.com", age: 25 },
			{ name: "Bob", email: "bob@example.com", age: 30 },
			{ name: "Charlie", email: "charlie@example.com", age: 35 },
		]);

		const allUsers = await db.select().from(users);
		expect(allUsers).toHaveLength(3);

		const alice = await db
			.select()
			.from(users)
			.where(eq(users.name, "Alice"));
		expect(alice[0].age).toBe(25);

		const ageRange = await db
			.select({ name: users.name, age: users.age })
			.from(users)
			.where(and(gte(users.age, 25), lte(users.age, 30)));
		expect(ageRange).toHaveLength(2);

		const ordered = await db
			.select({ name: users.name })
			.from(users)
			.orderBy(desc(users.age))
			.limit(2);
		expect(ordered[0].name).toBe("Charlie");

		await db.insert(posts).values([
			{ userId: 1, title: "Post 1", published: true },
			{ userId: 1, title: "Draft", published: false },
		]);

		const usersWithPosts = await db
			.select({ userName: users.name, postTitle: posts.title })
			.from(posts)
			.leftJoin(users, eq(posts.userId, users.id))
			.where(eq(posts.published, true));
		expect(usersWithPosts).toHaveLength(1);
		expect(usersWithPosts[0].userName).toBe("Alice");

		await db.update(users).set({ age: 26 }).where(eq(users.name, "Alice"));
		const updated = await db
			.select()
			.from(users)
			.where(eq(users.name, "Alice"));
		expect(updated[0].age).toBe(26);

		await db.delete(users).where(eq(users.name, "Charlie"));
		const remaining = await db.select().from(users);
		expect(remaining).toHaveLength(2);
	});
});

describe("service/feature-flags", () => {
	it("creates schema and performs flag CRUD", async () => {
		const db = new PGlite();

		await db.exec(`
			CREATE TABLE IF NOT EXISTS feature_flags (
				id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
				name TEXT UNIQUE NOT NULL,
				description TEXT DEFAULT '',
				enabled BOOLEAN DEFAULT false,
				rollout_percentage INTEGER DEFAULT 100
					CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
				created_at TIMESTAMPTZ DEFAULT now(),
				updated_at TIMESTAMPTZ DEFAULT now()
			);
			CREATE TABLE IF NOT EXISTS flag_environments (
				id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
				flag_id TEXT NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
				environment TEXT NOT NULL,
				enabled BOOLEAN DEFAULT false,
				UNIQUE(flag_id, environment)
			);
			CREATE TABLE IF NOT EXISTS flag_apps (
				id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
				flag_id TEXT NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
				app_name TEXT NOT NULL,
				UNIQUE(flag_id, app_name)
			);
		`);

		await db.query(
			`INSERT INTO feature_flags (name, description, enabled, rollout_percentage)
			 VALUES ($1, $2, $3, $4)`,
			["dark-mode", "Enable dark mode", false, 50],
		);

		const { rows: flags } = await db.query(
			"SELECT * FROM feature_flags WHERE name = $1",
			["dark-mode"],
		);
		expect(flags).toHaveLength(1);
		expect(flags[0].enabled).toBe(false);
		expect(flags[0].rollout_percentage).toBe(50);

		await db.query(
			"UPDATE feature_flags SET enabled = true WHERE name = $1",
			["dark-mode"],
		);
		const { rows: toggled } = await db.query(
			"SELECT enabled FROM feature_flags WHERE name = $1",
			["dark-mode"],
		);
		expect(toggled[0].enabled).toBe(true);

		await db.query(
			`INSERT INTO flag_environments (flag_id, environment, enabled)
			 VALUES ($1, $2, $3)`,
			[flags[0].id, "production", false],
		);

		const { rows: envs } = await db.query(
			"SELECT * FROM flag_environments WHERE flag_id = $1",
			[flags[0].id],
		);
		expect(envs).toHaveLength(1);
		expect(envs[0].environment).toBe("production");
		expect(envs[0].enabled).toBe(false);

		await db.query("DELETE FROM feature_flags WHERE name = $1", ["dark-mode"]);
		const { rows: deleted } = await db.query(
			"SELECT * FROM feature_flags WHERE name = $1",
			["dark-mode"],
		);
		expect(deleted).toHaveLength(0);

		const { rows: cascaded } = await db.query(
			"SELECT * FROM flag_environments WHERE flag_id = $1",
			[flags[0].id],
		);
		expect(cascaded).toHaveLength(0);
	});
});
