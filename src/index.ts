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
export { createSupabaseClient, SupabaseClient } from './supabase-client.js'
export type { QueryBuilder } from './supabase-client.js'

// PostgREST parser
export { PostgrestParser } from './postgrest-parser.js'
export type { ParsedQuery, QueryExecutor } from './postgrest-parser.js'

// Connection pooler
export { PGlitePooler } from './pooler.js'

// TCP server
export { PGliteServer } from './server.js'
export type { ServerConfig } from './server.js'

// Priority queue (internal but exported for advanced use)
export { PriorityQueue } from './queue.js'

// Types
export { QueryPriority } from './types.js'
export type {
  PoolerConfig,
  QueuedQuery,
  QueueMetrics,
  QueryResult,
} from './types.js'

// Socket abstraction
export { connect, listen, RUNTIME, detectRuntime, isNode, isDeno, isBun, isWorkerd } from './socket/index.js'
export type {
  ServerOptions,
  SocketAddress,
  SocketHandler,
  SocketInfo,
  SocketOptions,
  UniversalSocket,
} from './socket/types.js'
