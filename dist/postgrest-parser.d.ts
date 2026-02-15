/**
 * PostgREST Query Parser Wrapper
 * Uses native_postgrest_parser WASM to convert PostgREST queries to SQL
 */
/**
 * Query executor function type for schema introspection
 */
export type QueryExecutor = (sql: string) => Promise<{
    rows: unknown[];
}>;
/**
 * Parsed SQL query with parameters
 */
export interface ParsedQuery {
    readonly sql: string;
    readonly params: readonly unknown[];
    readonly tables: readonly string[];
}
/**
 * PostgREST parser for converting REST queries to SQL
 */
export declare class PostgrestParser {
    private readonly client;
    private static initPromise;
    constructor();
    /**
     * Initialize the WASM module (must be called before first use)
     * Safe to call multiple times - initialization happens only once
     *
     * Note: This uses the web target build which works in webcontainers and edge workers.
     * For Node.js, the native_postgrest_parser package needs to be built with --target nodejs.
     */
    static init(): Promise<void>;
    /**
     * Initialize schema introspection from a database connection
     * This enables the parser to validate queries against the actual database schema
     *
     * @param queryExecutor - Function that executes SQL queries and returns rows
     *
     * @example
     * ```typescript
     * import { PGlite } from '@electric-sql/pglite'
     * import { PostgrestParser } from './postgrest-parser'
     *
     * const db = new PGlite()
     * await PostgrestParser.init()
     *
     * // Initialize schema introspection
     * await PostgrestParser.initSchema(async (sql) => {
     *   const result = await db.query(sql)
     *   return { rows: result.rows }
     * })
     * ```
     */
    static initSchema(queryExecutor: QueryExecutor): Promise<void>;
    /**
     * Parse a SELECT query from PostgREST format
     *
     * @example
     * parseSelect('users', 'id=eq.1&select=id,name')
     * // => { sql: 'SELECT "id", "name" FROM "users" WHERE "id" = $1', params: [1] }
     */
    parseSelect(table: string, queryString?: string): ParsedQuery;
    /**
     * Parse an INSERT query from PostgREST format
     *
     * @example
     * parseInsert('users', { name: 'Alice', email: 'alice@example.com' })
     * // => { sql: 'INSERT INTO "users" ("name", "email") VALUES ($1, $2)', params: ['Alice', 'alice@example.com'] }
     */
    parseInsert(table: string, data: Record<string, unknown>, queryString?: string): ParsedQuery;
    /**
     * Parse an UPDATE query from PostgREST format
     *
     * @example
     * parseUpdate('users', { name: 'Alice' }, 'id=eq.1')
     * // => { sql: 'UPDATE "users" SET "name" = $1 WHERE "id" = $2', params: ['Alice', 1] }
     */
    parseUpdate(table: string, data: Record<string, unknown>, queryString: string): ParsedQuery;
    /**
     * Parse a DELETE query from PostgREST format
     *
     * @example
     * parseDelete('users', 'id=eq.1')
     * // => { sql: 'DELETE FROM "users" WHERE "id" = $1', params: [1] }
     */
    parseDelete(table: string, queryString: string): ParsedQuery;
    /**
     * Parse an RPC (function call) from PostgREST format
     *
     * @example
     * parseRpc('calculate_total', { order_id: 123 })
     * // => { sql: 'SELECT * FROM "calculate_total"($1)', params: [123] }
     */
    parseRpc(functionName: string, args?: Record<string, unknown>, queryString?: string): ParsedQuery;
    /**
     * Parse a generic HTTP request to SQL
     *
     * @param method - HTTP method (GET, POST, PATCH, DELETE)
     * @param path - Path without leading slash (e.g., 'users' or 'rpc/function_name')
     * @param queryString - URL query parameters
     * @param body - Request body (for POST/PATCH)
     */
    parseRequest(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, queryString?: string, body?: Record<string, unknown>): ParsedQuery;
    /**
     * Convert WASM result to our ParsedQuery format
     */
    private convertResult;
}
//# sourceMappingURL=postgrest-parser.d.ts.map