import { and, desc, eq, gte, lte } from "drizzle-orm";
import {
	boolean,
	integer,
	pgTable,
	serial,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { nanoSupabase } from "../../../src/index.ts";

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

type User = typeof users.$inferSelect;
type Post = typeof posts.$inferSelect;

async function main() {
	console.log("=== Drizzle + PGlite Demo ===\n");

	await using nano = await nanoSupabase({ tcp: true });
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

	const db = drizzle(pglite);

	console.log("--- 1: INSERT ---");
	await db.insert(users).values([
		{ name: "Alice", email: "alice@example.com", age: 25 },
		{ name: "Bob", email: "bob@example.com", age: 30 },
		{ name: "Charlie", email: "charlie@example.com", age: 35 },
		{ name: "Diana", email: "diana@example.com", age: 28 },
	]);
	console.log("  Inserted 4 users\n");

	console.log("--- 2: SELECT all ---");
	const allUsers: User[] = await db.select().from(users);
	console.log(
		"  All users:",
		allUsers.map((u) => u.name),
	);
	console.log();

	console.log("--- 3: SELECT with eq filter ---");
	const alice = await db.select().from(users).where(eq(users.name, "Alice"));
	console.log("  User named Alice:", alice[0]);
	console.log();

	console.log("--- 4: SELECT with age range ---");
	const ageRange = await db
		.select({ name: users.name, age: users.age })
		.from(users)
		.where(and(gte(users.age, 25), lte(users.age, 30)));
	console.log("  Users aged 25-30:", ageRange);
	console.log();

	console.log("--- 5: SELECT with ORDER and LIMIT ---");
	const ordered = await db
		.select({ name: users.name, age: users.age })
		.from(users)
		.orderBy(desc(users.age))
		.limit(2);
	console.log("  Top 2 oldest users:", ordered);
	console.log();

	console.log("--- 6: INSERT posts ---");
	await db.insert(posts).values([
		{
			userId: 1,
			title: "My First Post",
			content: "Hello, world!",
			published: true,
		},
		{
			userId: 1,
			title: "Draft Post",
			content: "Work in progress...",
			published: false,
		},
		{
			userId: 2,
			title: "Bob's Post",
			content: "Hi from Bob!",
			published: true,
		},
	]);
	console.log("  Inserted 3 posts\n");

	console.log("--- 7: JOIN users and posts ---");
	const usersWithPosts = await db
		.select({
			userName: users.name,
			postTitle: posts.title,
			published: posts.published,
		})
		.from(posts)
		.leftJoin(users, eq(posts.userId, users.id))
		.where(eq(posts.published, true));
	console.log("  Published posts with authors:", usersWithPosts);
	console.log();

	console.log("--- 8: UPDATE ---");
	await db.update(users).set({ age: 26 }).where(eq(users.name, "Alice"));
	const updatedAlice: User[] = await db
		.select()
		.from(users)
		.where(eq(users.name, "Alice"));
	console.log("  Updated Alice age:", updatedAlice[0]?.age);
	console.log();

	console.log("--- 9: DELETE ---");
	await db.delete(users).where(eq(users.name, "Diana"));
	const remaining = await db.select({ name: users.name }).from(users);
	console.log(
		"  Remaining users:",
		remaining.map((u) => u.name),
	);
	console.log();

	console.log("--- 10: $inferSelect / $inferInsert types ---");
	const newPost: typeof posts.$inferInsert = {
		userId: 2,
		title: "Type-safe insert",
		content: "Drizzle infers this type from the schema",
		published: true,
	};
	const [inserted]: Post[] = await db.insert(posts).values(newPost).returning();
	console.log("  Typed insert result:", {
		id: inserted.id,
		title: inserted.title,
	});
	console.log();

	console.log("All examples completed successfully!");
}

main().catch(console.error);
