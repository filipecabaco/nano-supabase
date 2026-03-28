import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createFetchAdapter, nanoSupabase } from "../../src/index.ts";
import { createPGlite } from "../../src/pglite-factory.ts";
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

describe("local/tcp-server", () => {
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

describe.skipIf(!hasDrizzle)("library/drizzle", () => {
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

describe("library/auth-rls", () => {
	it("enforces row-level security per user", async () => {
		const db = await createPGlite();
		const { localFetch, authHandler } = await createFetchAdapter({
			db,
			supabaseUrl: "http://localhost:54321",
		});

		const supabase = createClient("http://localhost:54321", "local-anon-key", {
			auth: { autoRefreshToken: false },
			global: { fetch: localFetch as typeof fetch },
		});

		await db.exec(`
			CREATE TABLE IF NOT EXISTS todos (
				id SERIAL PRIMARY KEY,
				user_id UUID NOT NULL DEFAULT auth.uid(),
				title TEXT NOT NULL,
				done BOOLEAN DEFAULT false
			);
			ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
			CREATE POLICY "Users see own" ON todos FOR SELECT USING (user_id = auth.uid());
			CREATE POLICY "Users insert own" ON todos FOR INSERT WITH CHECK (user_id = auth.uid());
			CREATE POLICY "Users delete own" ON todos FOR DELETE USING (user_id = auth.uid());
		`);

		await supabase.auth.signUp({ email: "alice@test.com", password: "password123" });
		await supabase.auth.signUp({ email: "bob@test.com", password: "password456" });

		await supabase.auth.signInWithPassword({ email: "alice@test.com", password: "password123" });
		await supabase.from("todos").insert({ title: "Alice todo 1" });
		await supabase.from("todos").insert({ title: "Alice todo 2" });

		const { data: aliceTodos } = await supabase.from("todos").select("*");
		expect(aliceTodos).toHaveLength(2);

		await supabase.auth.signInWithPassword({ email: "bob@test.com", password: "password456" });
		const { data: bobTodos } = await supabase.from("todos").select("*");
		expect(bobTodos).toHaveLength(0);

		await supabase.from("todos").insert({ title: "Bob todo 1" });
		const { data: bobTodosAfter } = await supabase.from("todos").select("*");
		expect(bobTodosAfter).toHaveLength(1);

		await supabase.auth.signOut();
		const { data: anonTodos } = await supabase.from("todos").select("*");
		expect(anonTodos).toHaveLength(0);

		await supabase.auth.signInWithPassword({ email: "alice@test.com", password: "password123" });
		const { data: aliceFinal } = await supabase.from("todos").select("*");
		expect(aliceFinal).toHaveLength(2);
	});
});

describe("library/storage", () => {
	it("uploads, downloads, lists, and deletes files", async () => {
		const db = await createPGlite();
		const { localFetch, storageHandler } = await createFetchAdapter({
			db,
			supabaseUrl: "http://localhost:54321",
		});

		const supabase = createClient("http://localhost:54321", "local-anon-key", {
			auth: { autoRefreshToken: false },
			global: { fetch: localFetch as typeof fetch },
		});

		await storageHandler!.createBucket({
			name: "docs",
			public: false,
		});
		await storageHandler!.createBucket({
			name: "public-files",
			public: true,
		});

		const { data: buckets } = await supabase.storage.listBuckets();
		expect(buckets!.length).toBeGreaterThanOrEqual(2);

		const content = new TextEncoder().encode("Hello, storage!");
		const { data: uploaded, error: uploadErr } = await supabase.storage
			.from("docs")
			.upload("notes/hello.txt", content, { contentType: "text/plain" });
		expect(uploadErr).toBeNull();
		expect(uploaded?.path).toBe("notes/hello.txt");

		const { data: downloaded } = await supabase.storage
			.from("docs")
			.download("notes/hello.txt");
		expect(downloaded).toBeTruthy();
		const text = await downloaded!.text();
		expect(text).toBe("Hello, storage!");

		const { data: files } = await supabase.storage
			.from("docs")
			.list("notes");
		expect(files!.length).toBeGreaterThanOrEqual(1);

		const { data: signedUrl } = await supabase.storage
			.from("docs")
			.createSignedUrl("notes/hello.txt", 3600);
		expect(signedUrl?.signedUrl).toBeTruthy();

		const { data: publicUrl } = supabase.storage
			.from("public-files")
			.getPublicUrl("test.txt");
		expect(publicUrl.publicUrl).toContain("test.txt");

		await supabase.storage
			.from("docs")
			.copy("notes/hello.txt", "notes/hello-copy.txt");
		const { data: afterCopy } = await supabase.storage
			.from("docs")
			.list("notes");
		expect(afterCopy!.length).toBeGreaterThanOrEqual(2);

		await supabase.storage
			.from("docs")
			.remove(["notes/hello-copy.txt"]);
		const { data: afterRemove } = await supabase.storage
			.from("docs")
			.list("notes");
		expect(afterRemove!.length).toBe(afterCopy!.length - 1);
	});
});

describe("local/migrations", () => {
	it("applies migration files in order", async () => {
		await using nano = await nanoSupabase();
		const db = nano.db;

		await db.exec(`
			CREATE TABLE IF NOT EXISTS users (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				email TEXT UNIQUE NOT NULL,
				created_at TIMESTAMP DEFAULT NOW()
			)
		`);

		await db.exec(`
			CREATE TABLE IF NOT EXISTS posts (
				id SERIAL PRIMARY KEY,
				user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
				title TEXT NOT NULL,
				body TEXT,
				published BOOLEAN DEFAULT false,
				created_at TIMESTAMP DEFAULT NOW()
			);
			CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id)
		`);

		await db.exec(`
			ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
			CREATE TABLE IF NOT EXISTS user_settings (
				user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
				theme TEXT DEFAULT 'light',
				notifications BOOLEAN DEFAULT true
			)
		`);

		await db.exec(`
			INSERT INTO users (name, email, role) VALUES ('Alice', 'alice@test.com', 'admin');
			INSERT INTO posts (user_id, title, published) VALUES (1, 'Hello', true);
			INSERT INTO user_settings (user_id, theme) VALUES (1, 'dark')
		`);

		const { rows: users } = await db.query("SELECT name, role FROM users");
		expect(users).toHaveLength(1);
		expect(users[0].role).toBe("admin");

		const { rows: posts } = await db.query("SELECT title FROM posts");
		expect(posts).toHaveLength(1);

		const { rows: settings } = await db.query("SELECT theme FROM user_settings");
		expect(settings[0].theme).toBe("dark");

		await db.exec("DELETE FROM users WHERE name = 'Alice'");
		const { rows: cascadedPosts } = await db.query("SELECT * FROM posts");
		expect(cascadedPosts).toHaveLength(0);

		const { rows: cascadedSettings } = await db.query("SELECT * FROM user_settings");
		expect(cascadedSettings).toHaveLength(0);
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

describe("cloud/claude-code", () => {
	it("applies todo migration and enforces RLS", async () => {
		const db = await createPGlite();
		const { localFetch } = await createFetchAdapter({
			db,
			supabaseUrl: "http://localhost:54321",
		});

		const supabase = createClient("http://localhost:54321", "local-anon-key", {
			auth: { autoRefreshToken: false },
			global: { fetch: localFetch as typeof fetch },
		});

		await db.exec(`
			CREATE TABLE IF NOT EXISTS todos (
				id SERIAL PRIMARY KEY,
				user_id UUID DEFAULT auth.uid(),
				title TEXT NOT NULL,
				done BOOLEAN DEFAULT false,
				created_at TIMESTAMPTZ DEFAULT now()
			);
			ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
			CREATE POLICY "Users can view their own todos"
				ON todos FOR SELECT USING (user_id = auth.uid());
			CREATE POLICY "Users can insert their own todos"
				ON todos FOR INSERT WITH CHECK (user_id = auth.uid());
			CREATE POLICY "Users can update their own todos"
				ON todos FOR UPDATE USING (user_id = auth.uid());
			CREATE POLICY "Users can delete their own todos"
				ON todos FOR DELETE USING (user_id = auth.uid());
		`);

		await supabase.auth.signUp({
			email: "dev@example.com",
			password: "password123",
		});
		await supabase.auth.signInWithPassword({
			email: "dev@example.com",
			password: "password123",
		});

		await supabase.from("todos").insert({ title: "Set up database" });
		await supabase.from("todos").insert({ title: "Create API endpoints" });
		await supabase.from("todos").insert({ title: "Write tests" });

		const { data: todos } = await supabase
			.from("todos")
			.select("*")
			.order("created_at");
		expect(todos).toHaveLength(3);
		expect(todos![0].title).toBe("Set up database");
		expect(todos![0].done).toBe(false);

		await supabase
			.from("todos")
			.update({ done: true })
			.eq("id", todos![0].id);

		const { data: updated } = await supabase
			.from("todos")
			.select("title,done")
			.eq("id", todos![0].id);
		expect(updated![0].done).toBe(true);

		await supabase.auth.signOut();
		const { data: anonTodos } = await supabase.from("todos").select("*");
		expect(anonTodos).toHaveLength(0);

		await supabase.auth.signInWithPassword({
			email: "dev@example.com",
			password: "password123",
		});
		const { data: afterReauth } = await supabase.from("todos").select("*");
		expect(afterReauth).toHaveLength(3);
	});
});

let hasPostgis = false;
try {
	await import("@electric-sql/pglite-postgis");
	hasPostgis = true;
} catch {}

describe.skipIf(!hasPostgis)("local/postgis-map", () => {
	it("creates spatial table and performs geospatial queries", async () => {
		const { postgis } = await import("@electric-sql/pglite-postgis");
		const nano = await nanoSupabase({ extensions: { postgis } });
		const db = nano.db;

		await db.exec("CREATE EXTENSION IF NOT EXISTS postgis");

		await db.exec(`
			CREATE TABLE IF NOT EXISTS places (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL,
				category TEXT NOT NULL DEFAULT 'other',
				location GEOMETRY(Point, 4326) NOT NULL,
				created_at TIMESTAMP DEFAULT NOW()
			);
			CREATE INDEX IF NOT EXISTS places_location_idx ON places USING GIST (location);
		`);

		await db.exec(`
			CREATE OR REPLACE FUNCTION add_place(p_name TEXT, p_category TEXT, p_lng FLOAT, p_lat FLOAT)
			RETURNS TABLE(id INT, name TEXT, category TEXT, lat FLOAT, lng FLOAT, created_at TEXT) AS $$
				INSERT INTO places (name, category, location)
				VALUES (p_name, p_category, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326))
				RETURNING
					places.id,
					places.name,
					places.category,
					ST_Y(places.location)::float AS lat,
					ST_X(places.location)::float AS lng,
					places.created_at::text;
			$$ LANGUAGE sql;
		`);

		await db.exec(`
			CREATE OR REPLACE FUNCTION get_all_places()
			RETURNS TABLE(id INT, name TEXT, category TEXT, lat FLOAT, lng FLOAT, created_at TEXT) AS $$
				SELECT
					places.id, places.name, places.category,
					ST_Y(places.location)::float AS lat,
					ST_X(places.location)::float AS lng,
					places.created_at::text
				FROM places ORDER BY created_at DESC;
			$$ LANGUAGE sql;
		`);

		await db.exec(`
			CREATE OR REPLACE FUNCTION find_nearby(center_lng FLOAT, center_lat FLOAT, radius_km FLOAT)
			RETURNS TABLE(id INT, name TEXT, category TEXT, lat FLOAT, lng FLOAT, created_at TEXT, distance_km FLOAT) AS $$
				SELECT
					places.id, places.name, places.category,
					ST_Y(places.location)::float AS lat,
					ST_X(places.location)::float AS lng,
					places.created_at::text,
					(ST_Distance(
						places.location::geography,
						ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography
					) / 1000.0)::float AS distance_km
				FROM places
				WHERE ST_DWithin(
					places.location::geography,
					ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography,
					radius_km * 1000
				)
				ORDER BY distance_km;
			$$ LANGUAGE sql;
		`);

		await db.exec(`
			CREATE OR REPLACE FUNCTION get_place_stats()
			RETURNS TABLE(count BIGINT, bbox TEXT) AS $$
				SELECT
					COUNT(*),
					CASE WHEN COUNT(*) > 0
						THEN ST_AsText(ST_Extent(location))
						ELSE NULL
					END AS bbox
				FROM places;
			$$ LANGUAGE sql;
		`);

		const { rows: lisbon } = await db.query<{ id: number; name: string; lat: number; lng: number }>(
			"SELECT * FROM add_place($1, $2, $3, $4)",
			["Lisbon Tower", "landmark", -9.1399, 38.7223],
		);
		expect(lisbon).toHaveLength(1);
		expect(lisbon[0].name).toBe("Lisbon Tower");
		expect(lisbon[0].lat).toBeCloseTo(38.7223, 3);
		expect(lisbon[0].lng).toBeCloseTo(-9.1399, 3);

		await db.query("SELECT * FROM add_place($1, $2, $3, $4)", [
			"Lisbon Cafe", "restaurant", -9.1370, 38.7200,
		]);
		await db.query("SELECT * FROM add_place($1, $2, $3, $4)", [
			"Porto Station", "transit", -8.6100, 41.1496,
		]);

		const { rows: allPlaces } = await db.query<{ name: string }>(
			"SELECT * FROM get_all_places()",
		);
		expect(allPlaces).toHaveLength(3);

		const { rows: nearby } = await db.query<{ name: string; distance_km: number }>(
			"SELECT * FROM find_nearby($1, $2, $3)",
			[-9.1399, 38.7223, 5],
		);
		expect(nearby.length).toBeGreaterThanOrEqual(1);
		expect(nearby.length).toBeLessThanOrEqual(2);
		expect(nearby.every((p) => p.distance_km <= 5)).toBe(true);
		expect(nearby.some((p) => p.name === "Lisbon Tower")).toBe(true);

		const { rows: farAway } = await db.query<{ name: string }>(
			"SELECT * FROM find_nearby($1, $2, $3)",
			[-9.1399, 38.7223, 1000],
		);
		expect(farAway).toHaveLength(3);

		const { rows: stats } = await db.query<{ count: number; bbox: string | null }>(
			"SELECT * FROM get_place_stats()",
		);
		expect(Number(stats[0].count)).toBe(3);
		expect(stats[0].bbox).toBeTruthy();
		expect(stats[0].bbox).toContain("POLYGON");

		await nano.stop();
	});
});
