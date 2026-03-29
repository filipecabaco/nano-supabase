import type { PGliteInterface } from "@electric-sql/pglite";
import { PostgrestParser } from "./postgrest-parser.ts";
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
export declare class SupabaseClient {
    private readonly db;
    private readonly parser;
    constructor(db: PGliteInterface, parser: PostgrestParser);
    from<T = unknown>(table: string): QueryBuilder<T>;
    rpc<T = unknown>(functionName: string, params?: Record<string, unknown>): Promise<{
        data: T | null;
        error: Error | null;
    }>;
}
export declare function createSupabaseClient(db: PGliteInterface): Promise<SupabaseClient>;
//# sourceMappingURL=supabase-client.d.ts.map