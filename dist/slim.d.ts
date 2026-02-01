/**
 * nano-supabase/slim
 * Minimal Supabase-compatible client for PGlite
 * Use this for edge workers where you only need the client (no server/pooler)
 *
 * @example
 * ```typescript
 * import { PGlite } from '@electric-sql/pglite'
 * import { createSupabaseClient } from 'nano-supabase/slim'
 *
 * const db = new PGlite()
 * const supabase = await createSupabaseClient(db)
 *
 * const { data } = await supabase.from('users').select('*')
 * ```
 */
export { createSupabaseClient, SupabaseClient } from './supabase-client.js';
export type { QueryBuilder } from './supabase-client.js';
export { PostgrestParser } from './postgrest-parser.js';
export type { ParsedQuery, QueryExecutor } from './postgrest-parser.js';
//# sourceMappingURL=slim.d.ts.map