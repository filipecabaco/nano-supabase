export type QueryExecutor = (sql: string) => Promise<{
    rows: unknown[];
}>;
export interface ParsedQuery {
    readonly sql: string;
    readonly params: readonly unknown[];
    readonly tables: readonly string[];
}
export declare class PostgrestParser {
    private readonly client;
    private static initPromise;
    constructor();
    static init(wasmBytes?: Uint8Array): Promise<void>;
    static initSchema(queryExecutor: QueryExecutor): Promise<void>;
    parseSelect(table: string, queryString?: string): ParsedQuery;
    parseInsert(table: string, data: Record<string, unknown>, queryString?: string): ParsedQuery;
    parseUpdate(table: string, data: Record<string, unknown>, queryString: string): ParsedQuery;
    parseDelete(table: string, queryString: string): ParsedQuery;
    parseRpc(functionName: string, args?: Record<string, unknown>, queryString?: string): ParsedQuery;
    parseRequest(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, queryString?: string, body?: Record<string, unknown>): ParsedQuery;
    private convertResult;
}
//# sourceMappingURL=postgrest-parser.d.ts.map