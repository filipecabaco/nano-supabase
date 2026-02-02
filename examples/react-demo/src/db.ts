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

    // Create application schema
    await dbInstance.exec(`
      -- Tasks table (linked to auth.users)
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        completed BOOLEAN DEFAULT false,
        priority TEXT DEFAULT 'medium',
        due_date DATE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Enable RLS
      ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

      -- RLS policies for tasks
      CREATE POLICY "Users can view their own tasks"
        ON tasks FOR SELECT
        USING (user_id = auth.uid());

      CREATE POLICY "Users can insert their own tasks"
        ON tasks FOR INSERT
        WITH CHECK (user_id = auth.uid());

      CREATE POLICY "Users can update their own tasks"
        ON tasks FOR UPDATE
        USING (user_id = auth.uid());

      CREATE POLICY "Users can delete their own tasks"
        ON tasks FOR DELETE
        USING (user_id = auth.uid());
    `)

    console.log('Schema created with RLS policies')

    // Create Supabase client with custom fetch
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
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
