/**
 * Prisma + PGlite via TCP Example
 *
 * Prerequisites:
 *   pnpm prisma:generate
 *
 * Then run:
 *   pnpm example:prisma
 */

import { PGlite } from "@electric-sql/pglite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

const HOST = "127.0.0.1";
const PORT = 5433;
const DATABASE_URL = `postgresql://postgres@${HOST}:${PORT}/template1?sslmode=disable`;
const SCHEMA_PATH = resolve("examples/prisma/schema.prisma");
const PRISMA_BIN = resolve("node_modules/.bin/prisma");

interface PGLiteSocketServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

async function pushSchema(): Promise<void> {
  const { stdout } = await execFileAsync(
    PRISMA_BIN,
    ["db", "push", `--schema=${SCHEMA_PATH}`, "--skip-generate"],
    { env: { ...process.env, DATABASE_URL } },
  );
  process.stdout.write(stdout);
}

async function main(): Promise<void> {
  console.log("=== Prisma + PGlite TCP Example ===\n");

  const db = new PGlite();
  const [, { PGLiteSocketServer }] = await Promise.all([
    db.waitReady,
    import("@electric-sql/pglite-socket"),
  ]);
  console.log("[PGlite] Database ready");

  const server: PGLiteSocketServer = new PGLiteSocketServer({ db, host: HOST, port: PORT });
  await server.start();
  console.log(`[Socket] Listening on ${HOST}:${PORT}\n`);

  console.log("[Prisma] Pushing schema...");
  await pushSchema();

  const { PrismaClient } = await import("./prisma/client/index.js");
  const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

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
    data: { title: "Hello World", content: "My first post", published: true, authorId: alice.id },
  });
  await prisma.post.create({
    data: { title: "Draft", content: "Work in progress", published: false, authorId: alice.id },
  });

  console.log("\n--- findMany with relation ---");
  const usersWithPosts = await prisma.user.findMany({ include: { posts: true } });
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
  await server.stop();
  await db.close();

  console.log("\n✓ Done");
}

main().catch(console.error);
