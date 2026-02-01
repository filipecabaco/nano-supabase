/**
 * Database initialization for React demo
 * Creates PGlite instance and Supabase-compatible client
 */

import { PGlite } from '@electric-sql/pglite'
import { createSupabaseClient, type SupabaseClient } from 'nano-supabase'

let dbInstance: PGlite | null = null
let supabaseInstance: SupabaseClient | null = null
let initPromise: Promise<SupabaseClient> | null = null

/**
 * Initialize the database with schema
 * Handles multiple calls gracefully (React StrictMode renders twice)
 */
export async function initDatabase(): Promise<SupabaseClient> {
  // If already initialized, return existing instance
  if (supabaseInstance) {
    return supabaseInstance
  }

  // If initialization is in progress, wait for it
  if (initPromise) {
    return initPromise
  }

  // Start new initialization
  initPromise = (async () => {
    console.log('🚀 Initializing PGlite database...')

    // Create PGlite instance (runs entirely in browser)
    dbInstance = new PGlite()

    // Create schema
    await dbInstance.exec(`
      -- Users table
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Tasks table
      CREATE TABLE tasks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        completed BOOLEAN DEFAULT false,
        priority TEXT DEFAULT 'medium',
        due_date DATE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Insert sample data
      INSERT INTO users (name, email) VALUES
        ('Alice Johnson', 'alice@example.com'),
        ('Bob Smith', 'bob@example.com');

      INSERT INTO tasks (user_id, title, description, completed, priority) VALUES
        (1, 'Setup development environment', 'Install all necessary tools', true, 'high'),
        (1, 'Write documentation', 'Document the API endpoints', false, 'medium'),
        (2, 'Review pull requests', 'Check and approve pending PRs', false, 'high'),
        (2, 'Fix bugs', 'Address issues in bug tracker', false, 'low');
    `)

    console.log('✅ Schema created and sample data inserted')

    // Create Supabase-compatible client
    supabaseInstance = await createSupabaseClient(dbInstance)

    console.log('✅ Supabase client initialized')

    return supabaseInstance
  })()

  return initPromise
}

/**
 * Get the current Supabase client instance
 */
export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return supabaseInstance
}

/**
 * Close the database connection
 */
export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close()
    dbInstance = null
    supabaseInstance = null
  }
}
