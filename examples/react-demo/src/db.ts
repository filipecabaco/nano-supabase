import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { createClient } from '@supabase/supabase-js'
import { createFetchAdapter, type AuthHandler } from 'nano-supabase'

const SUPABASE_URL = 'http://localhost:54321'
const SUPABASE_ANON_KEY = 'local-anon-key'

let supabaseInstance: ReturnType<typeof createClient> | null = null
let authHandlerInstance: AuthHandler | null = null
let initPromise: Promise<{ supabase: ReturnType<typeof createClient>; authHandler: AuthHandler }> | null = null

export async function initDatabase(): Promise<{ supabase: ReturnType<typeof createClient>; authHandler: AuthHandler }> {
  if (supabaseInstance && authHandlerInstance) {
    return { supabase: supabaseInstance, authHandler: authHandlerInstance }
  }

  if (initPromise) {
    return initPromise
  }

  initPromise = doInit()
  initPromise.catch(() => { initPromise = null })
  return initPromise
}

async function doInit(): Promise<{ supabase: ReturnType<typeof createClient>; authHandler: AuthHandler }> {
  const db = new PGlite({ extensions: { pgcrypto } })

  const { localFetch, authHandler, storageHandler } = await createFetchAdapter({
    db,
    supabaseUrl: SUPABASE_URL,
  })

  authHandlerInstance = authHandler

  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.profiles (
      id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      email TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Public profiles are viewable by everyone"
      ON public.profiles FOR SELECT
      USING (true);

    CREATE POLICY "Users can update own profile"
      ON public.profiles FOR UPDATE
      USING (auth.uid() = id);

    CREATE OR REPLACE FUNCTION public.handle_new_user()
    RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO public.profiles (id, email)
      VALUES (NEW.id, NEW.email);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;

    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

    CREATE TABLE IF NOT EXISTS public.files (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      bucket_path TEXT NOT NULL,
      size_bytes BIGINT NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      created_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Users can view their own files"
      ON public.files FOR SELECT
      USING (user_id = auth.uid());

    CREATE POLICY "Users can insert their own files"
      ON public.files FOR INSERT
      WITH CHECK (user_id = auth.uid());

    CREATE POLICY "Users can delete their own files"
      ON public.files FOR DELETE
      USING (user_id = auth.uid());
  `)

  // Storage RLS policies - separate exec in case storage schema isn't available
  try {
    await db.exec(`
      CREATE POLICY "Users can upload to their folder"
        ON storage.objects FOR INSERT
        WITH CHECK (
          bucket_id = 'user-files'
          AND (storage.foldername(name))[1] = auth.uid()::text
        );

      CREATE POLICY "Users can view their own objects"
        ON storage.objects FOR SELECT
        USING (
          bucket_id = 'user-files'
          AND (storage.foldername(name))[1] = auth.uid()::text
        );

      CREATE POLICY "Users can delete their own objects"
        ON storage.objects FOR DELETE
        USING (
          bucket_id = 'user-files'
          AND (storage.foldername(name))[1] = auth.uid()::text
        );
    `)
  } catch (e) {
    console.warn('Storage RLS policies could not be created:', e)
  }

  supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false },
    global: { fetch: localFetch },
  })

  if (storageHandler) {
    try {
      await storageHandler.createBucket({
        id: 'user-files',
        name: 'user-files',
        public: false,
        file_size_limit: 10 * 1024 * 1024,
      })
    } catch (e) {
      console.warn('Bucket creation failed (may already exist):', e)
    }
  }

  return { supabase: supabaseInstance, authHandler: authHandlerInstance }
}

export function getSupabase(): ReturnType<typeof createClient> {
  if (!supabaseInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return supabaseInstance
}
