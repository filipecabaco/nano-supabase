import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PGliteWorker } from "@electric-sql/pglite/worker";
import { createFetchAdapter, type AuthHandler } from "nano-supabase";

const SUPABASE_URL = "http://localhost:54321";
const SUPABASE_ANON_KEY = "local-anon-key";

let pgWorker: PGliteWorker | null = null;
let supabaseInstance: SupabaseClient | null = null;
let authHandlerInstance: AuthHandler | null = null;
let initPromise: Promise<{
	pg: PGliteWorker;
	supabase: SupabaseClient;
	authHandler: AuthHandler;
}> | null = null;

export async function initDatabase(): Promise<{
	pg: PGliteWorker;
	supabase: SupabaseClient;
	authHandler: AuthHandler;
}> {
	if (pgWorker && supabaseInstance && authHandlerInstance) {
		return { pg: pgWorker, supabase: supabaseInstance, authHandler: authHandlerInstance };
	}

	if (initPromise) return initPromise;

	initPromise = doInit();
	initPromise.catch(() => {
		initPromise = null;
	});
	return initPromise;
}

async function doInit(): Promise<{
	pg: PGliteWorker;
	supabase: SupabaseClient;
	authHandler: AuthHandler;
}> {
	const pg = await PGliteWorker.create(
		new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
		{ dataDir: "idb://pglite-workers-demo" },
	);

	const { localFetch, authHandler, storageHandler } = await createFetchAdapter({
		db: pg,
		supabaseUrl: SUPABASE_URL,
	});

	authHandlerInstance = authHandler;
	pgWorker = pg;

	await pg.exec(`
		CREATE TABLE IF NOT EXISTS public.notes (
			id SERIAL PRIMARY KEY,
			user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
			title TEXT NOT NULL,
			done BOOLEAN NOT NULL DEFAULT false,
			created_at TIMESTAMP NOT NULL DEFAULT NOW()
		);

		ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

		DO $$ BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_policies WHERE tablename = 'notes' AND policyname = 'Users see own notes'
			) THEN
				CREATE POLICY "Users see own notes" ON public.notes
					FOR SELECT USING (user_id = auth.uid());
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM pg_policies WHERE tablename = 'notes' AND policyname = 'Users insert own notes'
			) THEN
				CREATE POLICY "Users insert own notes" ON public.notes
					FOR INSERT WITH CHECK (user_id = auth.uid());
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM pg_policies WHERE tablename = 'notes' AND policyname = 'Users update own notes'
			) THEN
				CREATE POLICY "Users update own notes" ON public.notes
					FOR UPDATE USING (user_id = auth.uid());
			END IF;

			IF NOT EXISTS (
				SELECT 1 FROM pg_policies WHERE tablename = 'notes' AND policyname = 'Users delete own notes'
			) THEN
				CREATE POLICY "Users delete own notes" ON public.notes
					FOR DELETE USING (user_id = auth.uid());
			END IF;
		END $$;
	`);

	if (storageHandler) {
		try {
			await storageHandler.createBucket({
				id: "attachments",
				name: "attachments",
				public: false,
				file_size_limit: 5 * 1024 * 1024,
			});
		} catch (_e) {}
	}

	supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
		auth: { autoRefreshToken: false },
		global: { fetch: localFetch as typeof fetch },
	});

	return { pg, supabase: supabaseInstance, authHandler };
}
