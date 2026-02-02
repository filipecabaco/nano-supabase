/**
 * Supabase-compatible client for PGlite
 * Intercepts PostgREST-style API calls and converts them to SQL
 */
import type { PGlite } from '@electric-sql/pglite';
import { PostgrestParser } from './postgrest-parser.ts';
/**
 * Query builder interface compatible with Supabase-js
 */
export interface QueryBuilder<T = unknown> {
    select(columns?: string): QueryBuilder<T>;
    insert(data: Record<string, unknown> | Record<string, unknown>[]): QueryBuilder<T>;
    update(data: Record<string, unknown>): QueryBuilder<T>;
    delete(): QueryBuilder<T>;
    eq(column: string, value: unknown): QueryBuilder<T>;
    neq(column: string, value: unknown): QueryBuilder<T>;
    gt(column: string, value: unknown): QueryBuilder<T>;
    gte(column: string, value: unknown): QueryBuilder<T>;
    lt(column: string, value: unknown): QueryBuilder<T>;
    lte(column: string, value: unknown): QueryBuilder<T>;
    like(column: string, pattern: string): QueryBuilder<T>;
    ilike(column: string, pattern: string): QueryBuilder<T>;
    in(column: string, values: unknown[]): QueryBuilder<T>;
    is(column: string, value: null | boolean): QueryBuilder<T>;
    order(column: string, options?: {
        ascending?: boolean;
        nullsFirst?: boolean;
    }): QueryBuilder<T>;
    limit(count: number): QueryBuilder<T>;
    range(from: number, to: number): QueryBuilder<T>;
    single(): QueryBuilder<T>;
    maybeSingle(): QueryBuilder<T>;
    then<TResult>(onfulfilled?: ((value: {
        data: T | null;
        error: Error | null;
    }) => TResult) | null): Promise<TResult>;
}
/**
 * Supabase-compatible database client
 */
export declare class SupabaseClient {
    private readonly db;
    private readonly parser;
    constructor(db: PGlite, parser: PostgrestParser);
    /**
     * Access a table for querying
     */
    from<T = unknown>(table: string): QueryBuilder<T>;
    /**
     * Call a stored procedure
     */
    rpc<T = unknown>(functionName: string, params?: Record<string, unknown>): Promise<{
        data: T | null;
        error: Error | null;
    }>;
}
/**
 * Create a Supabase-compatible client with schema introspection
 */
export declare function createSupabaseClient(db: PGlite): Promise<SupabaseClient>;
//# sourceMappingURL=supabase-client.d.ts.map