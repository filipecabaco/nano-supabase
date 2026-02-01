/**
 * nano-supabase
 * A lightweight Supabase-compatible client for PGlite
 *
 * @example
 * ```typescript
 * import { PGlite } from '@electric-sql/pglite'
 * import { createSupabaseClient } from 'nano-supabase'
 *
 * const db = new PGlite()
 * const supabase = await createSupabaseClient(db)
 *
 * const { data } = await supabase.from('users').select('*')
 * ```
 */

// Main Supabase client
export { createSupabaseClient, SupabaseClient } from './supabase-client.ts'
export type { QueryBuilder } from './supabase-client.ts'

// PostgREST parser
export { PostgrestParser } from './postgrest-parser.ts'
export type { ParsedQuery, QueryExecutor } from './postgrest-parser.ts'

// Connection pooler
export { PGlitePooler } from './pooler.ts'

// Priority queue (internal but exported for advanced use)
export { PriorityQueue } from './queue.ts'

// Types
export { QueryPriority } from './types.ts'
export type {
  PoolerConfig,
  QueuedQuery,
  QueueMetrics,
  QueryResult,
} from './types.ts'
