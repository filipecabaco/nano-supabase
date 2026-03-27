import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { nanoSupabase } from "../../../src/index.ts";

const execFileAsync = promisify(execFile);

const SCHEMA_PATH = resolve("examples/orm/prisma/schema.prisma");
const PRISMA_BIN = resolve("node_modules/.bin/prisma");

async function pushSchema(databaseUrl: string): Promise<void> {
	const { stdout } = await execFileAsync(
		PRISMA_BIN,
		["db", "push", `--schema=${SCHEMA_PATH}`, "--skip-generate"],
		{ env: { ...process.env, DATABASE_URL: databaseUrl } },
	);
	process.stdout.write(stdout);
}

async function main(): Promise<void> {
	console.log("=== Prisma + PGlite TCP Example ===\n");

	await using nano = await nanoSupabase({ tcp: { port: 5433 } });
	const connectionString = nano.connectionString!;
	const databaseUrl = `${connectionString}?sslmode=disable`;
	console.log(`[nano-supabase] TCP ready at ${connectionString}\n`);

	console.log("[Prisma] Pushing schema...");
	await pushSchema(databaseUrl);

	const { PrismaClient } = await import("./client/index.js");
	const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

	console.log("\n--- Create users ---");
	const alice = await prisma.user.create({
		data: { name: "Alice", email: "alice@example.com", age: 25 },
	});
	const bob = await prisma.user.create({
		data: { name: "Bob", email: "bob@example.com", age: 30 },
	});
	console.log("Created:", alice, bob);

	console.log("\n--- Create posts ---");
	await prisma.post.create({
		data: {
			title: "Hello World",
			content: "My first post",
			published: true,
			authorId: alice.id,
		},
	});
	await prisma.post.create({
		data: {
			title: "Draft",
			content: "Work in progress",
			published: false,
			authorId: alice.id,
		},
	});

	console.log("\n--- findMany with relation ---");
	const usersWithPosts = await prisma.user.findMany({
		include: { posts: true },
	});
	console.log(JSON.stringify(usersWithPosts, null, 2));

	console.log("\n--- filter + select ---");
	const published = await prisma.post.findMany({
		where: { published: true },
		select: { title: true, author: { select: { name: true } } },
	});
	console.log("Published posts:", published);

	console.log("\n--- update ---");
	const updated = await prisma.user.update({
		where: { email: "alice@example.com" },
		data: { age: 26 },
	});
	console.log("Updated Alice:", updated);

	console.log("\n--- delete ---");
	await prisma.user.delete({ where: { email: "bob@example.com" } });
	const remaining = await prisma.user.findMany({ select: { name: true } });
	console.log("Remaining users:", remaining);

	await prisma.$disconnect();

	console.log("\nDone");
}

main().catch(console.error);
