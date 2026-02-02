/**
 * Database initialization for React demo with Auth
 * Creates PGlite instance with auth emulation and Supabase-compatible client
 */

import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { createClient } from '@supabase/supabase-js'
import { createFetchAdapter, type AuthHandler } from 'nano-supabase'

// Fake Supabase URL for local emulation
const SUPABASE_URL = 'http://localhost:54321'
const SUPABASE_ANON_KEY = 'local-anon-key'

let dbInstance: PGlite | null = null
let supabaseInstance: ReturnType<typeof createClient> | null = null
let authHandlerInstance: AuthHandler | null = null
let initPromise: Promise<{ supabase: ReturnType<typeof createClient>; authHandler: AuthHandler }> | null = null

/**
 * Initialize the database with schema and auth
 */
export async function initDatabase(): Promise<{ supabase: ReturnType<typeof createClient>; authHandler: AuthHandler }> {
  // If already initialized, return existing instance
  if (supabaseInstance && authHandlerInstance) {
    return { supabase: supabaseInstance, authHandler: authHandlerInstance }
  }

  // If initialization is in progress, wait for it
  if (initPromise) {
    return initPromise
  }

  // Start new initialization
  initPromise = (async () => {
    console.log('Initializing PGlite database with auth...')

    // Create PGlite instance (runs entirely in browser) with pgcrypto extension
    dbInstance = new PGlite({
      extensions: { pgcrypto }
    })

    // Create fetch adapter with auth
    const { localFetch, authHandler } = await createFetchAdapter({
      db: dbInstance,
      supabaseUrl: SUPABASE_URL,
    })

    authHandlerInstance = authHandler

    // Create application schema following Supabase best practices
    // https://supabase.com/docs/guides/auth/managing-user-data
    await dbInstance.exec(`
      -- Public profiles table (exposes user_id from auth.users)
      CREATE TABLE IF NOT EXISTS public.profiles (
        id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        email TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Enable RLS on profiles
      ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

      -- Profiles are viewable by everyone (or restrict as needed)
      CREATE POLICY "Public profiles are viewable by everyone"
        ON public.profiles FOR SELECT
        USING (true);

      -- Users can update their own profile
      CREATE POLICY "Users can update own profile"
        ON public.profiles FOR UPDATE
        USING (auth.uid() = id);

      -- Function to create profile on user signup
      CREATE OR REPLACE FUNCTION public.handle_new_user()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO public.profiles (id, email)
        VALUES (NEW.id, NEW.email);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;

      -- Trigger to automatically create profile
      DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
      CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

      -- Tasks table (linked to public.profiles)
      CREATE TABLE IF NOT EXISTS public.tasks (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        completed BOOLEAN DEFAULT false,
        priority TEXT DEFAULT 'medium',
        due_date DATE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Enable RLS on tasks
      ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

      -- Restrictive RLS policies: users can only access their own tasks
      CREATE POLICY "Users can only view their own tasks"
        ON public.tasks FOR SELECT
        USING (user_id = auth.uid());

      CREATE POLICY "Users can only insert tasks as themselves"
        ON public.tasks FOR INSERT
        WITH CHECK (user_id = auth.uid());

      CREATE POLICY "Users can only update their own tasks"
        ON public.tasks FOR UPDATE
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());

      CREATE POLICY "Users can only delete their own tasks"
        ON public.tasks FOR DELETE
        USING (user_id = auth.uid());
    `)

    console.log('Schema created with RLS policies')

    // Create Supabase client with custom fetch
    // Use default localStorage-based storage for session persistence
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
      },
      global: {
        fetch: localFetch,
      },
    })

    console.log('Supabase client initialized with auth emulation')

    return { supabase: supabaseInstance, authHandler: authHandlerInstance }
  })()

  return initPromise
}

/**
 * Get the current Supabase client instance
 */
export function getSupabase(): ReturnType<typeof createClient> {
  if (!supabaseInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return supabaseInstance
}

/**
 * Get the auth handler instance
 */
export function getAuthHandler(): AuthHandler {
  if (!authHandlerInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return authHandlerInstance
}

/**
 * Close the database connection
 */
export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close()
    dbInstance = null
    supabaseInstance = null
    authHandlerInstance = null
    initPromise = null
  }
}
