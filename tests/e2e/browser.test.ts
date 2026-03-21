import { describe, expect, test } from "vitest";
import { createClient, nanoSupabase } from "../../src/nano.ts";

type ItemsDB = {
	public: {
		Tables: {
			items: {
				Row: { id: number; name: string };
				Insert: { name: string };
				Update: { name?: string };
			};
		};
		Views: Record<string, never>;
		Functions: Record<string, never>;
		Enums: Record<string, never>;
	};
};

type PrivateItemsDB = {
	public: {
		Tables: {
			private_items: {
				Row: { id: number; user_id: string; value: string };
				Insert: { user_id: string; value: string };
				Update: { user_id?: string; value?: string };
			};
		};
		Views: Record<string, never>;
		Functions: Record<string, never>;
		Enums: Record<string, never>;
	};
};

describe("Browser e2e", () => {
	test("createClient boots without node: module errors", async () => {
		const supabase = await createClient();
		expect(supabase).toBeDefined();
	});

	test("insert and select data", async () => {
		const nano = await nanoSupabase();
		await nano.db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      )
    `);
		const supabase = nano.createClient<ItemsDB>();

		const { error: insertError } = await supabase
			.from("items")
			.insert({ name: "browser-item" });

		expect(insertError).toBeNull();

		const { data, error: selectError } = await supabase
			.from("items")
			.select("*");

		expect(selectError).toBeNull();
		expect(data).toHaveLength(1);
		expect(data![0].name).toBe("browser-item");
	});

	test("auth signup and signin", async () => {
		const supabase = await createClient();

		const { data: signUpData, error: signUpError } =
			await supabase.auth.signUp({
				email: "browser@example.com",
				password: "password123",
			});

		expect(signUpError).toBeNull();
		expect(signUpData.user).toBeDefined();
		expect(signUpData.session).toBeDefined();

		const { data: signInData, error: signInError } =
			await supabase.auth.signInWithPassword({
				email: "browser@example.com",
				password: "password123",
			});

		expect(signInError).toBeNull();
		expect(signInData.session?.access_token).toBeDefined();
	});

	test("RLS blocks unauthenticated access", async () => {
		const nano = await nanoSupabase();
		await nano.db.exec(`
      CREATE TABLE IF NOT EXISTS private_items (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL,
        value TEXT NOT NULL
      );
      ALTER TABLE private_items ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "owner only" ON private_items
        FOR ALL USING (auth.uid() = user_id);
    `);
		const supabase = nano.createClient<PrivateItemsDB>();

		const { data, error } = await supabase.from("private_items").select("*");

		expect(error).toBeNull();
		expect(data).toHaveLength(0);
	});
});
