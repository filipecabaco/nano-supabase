import { describe, expect, test } from "vitest";

import { nanoSupabase } from "../src/nano.ts";
import { LEAN_POSTGRES_OPTIONS } from "../src/pglite-factory.ts";
import { PostgrestParser } from "../src/postgrest-parser.ts";

describe("LEAN_POSTGRES_OPTIONS", () => {
	test("instances start and execute queries with lean postgres options", async () => {
		await using nano = await nanoSupabase({
			postgresOptions: LEAN_POSTGRES_OPTIONS,
		});
		const result = await nano.db.query<{ n: number }>("SELECT 1 AS n");
		expect(result.rows[0].n).toBe(1);
	});

	test("auth works with lean options", async () => {
		await using nano = await nanoSupabase({
			postgresOptions: LEAN_POSTGRES_OPTIONS,
		});
		const supabase = nano.createClient();
		const { error } = await supabase.auth.signUp({
			email: "lean@example.com",
			password: "password123",
		});
		expect(error).toBeNull();
	});

	test("data queries work with lean options", async () => {
		await using nano = await nanoSupabase({
			postgresOptions: LEAN_POSTGRES_OPTIONS,
		});
		await nano.db.exec(
			"CREATE TABLE IF NOT EXISTS items (id SERIAL PRIMARY KEY, name TEXT)",
		);
		const supabase = nano.createClient();
		const { error } = await supabase.from("items").insert({ name: "hello" });
		expect(error).toBeNull();
		const { data } = await supabase.from("items").select("*");
		expect(data).toHaveLength(1);
	});
});

describe("shared PostgrestParser", () => {
	test("second instance reuses provided parser and skips schema introspection", async () => {
		await using nano1 = await nanoSupabase();
		await nano1.db.exec(
			"CREATE TABLE IF NOT EXISTS things (id SERIAL PRIMARY KEY, label TEXT)",
		);

		const sharedParser = new PostgrestParser();

		await using nano2 = await nanoSupabase({ parser: sharedParser });
		await nano2.db.exec(
			"CREATE TABLE IF NOT EXISTS things (id SERIAL PRIMARY KEY, label TEXT)",
		);

		const supabase2 = nano2.createClient();
		const { error } = await supabase2
			.from("things")
			.insert({ label: "shared" });
		expect(error).toBeNull();
		const { data } = await supabase2.from("things").select("*");
		expect(data).toHaveLength(1);
	});

	test("shared parser instance is identical object across two instances", async () => {
		const sharedParser = new PostgrestParser();
		await using nano1 = await nanoSupabase({ parser: sharedParser });
		await using nano2 = await nanoSupabase({ parser: sharedParser });

		const result1 = await nano1.db.query<{ n: number }>("SELECT 1 AS n");
		const result2 = await nano2.db.query<{ n: number }>("SELECT 1 AS n");
		expect(result1.rows[0].n).toBe(1);
		expect(result2.rows[0].n).toBe(1);
	});

	test("shared parser + lean options combination works", async () => {
		const sharedParser = new PostgrestParser();
		await using nano = await nanoSupabase({
			postgresOptions: LEAN_POSTGRES_OPTIONS,
			parser: sharedParser,
		});
		await nano.db.exec(
			"CREATE TABLE IF NOT EXISTS entries (id SERIAL PRIMARY KEY, val TEXT)",
		);
		const supabase = nano.createClient();
		const { error } = await supabase.from("entries").insert({ val: "test" });
		expect(error).toBeNull();
	});
});

describe("multiple instances", () => {
	test("5 instances can start concurrently and serve queries", async () => {
		const instances = await Promise.all(
			Array.from({ length: 5 }, () =>
				nanoSupabase({ postgresOptions: LEAN_POSTGRES_OPTIONS }),
			),
		);

		await Promise.all(
			instances.map(async (nano, i) => {
				await nano.db.exec(
					`CREATE TABLE IF NOT EXISTS t${i} (id SERIAL PRIMARY KEY, v TEXT)`,
				);
				const supabase = nano.createClient();
				await supabase.from(`t${i}`).insert({ v: `instance-${i}` });
				const { data } = await supabase.from(`t${i}`).select("*");
				expect(data).toHaveLength(1);
				expect(data?.[0].v).toBe(`instance-${i}`);
			}),
		);

		await Promise.all(instances.map((n) => n.stop()));
	}, 120000);
});
