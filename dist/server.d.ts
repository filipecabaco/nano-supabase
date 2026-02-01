/**
 * TCP Server for PGlite
 * Accepts TCP connections and routes SQL queries through the pooler
 */
import type { PGlitePooler } from './pooler.js';
/**
 * Server configuration
 */
export interface ServerConfig {
    readonly hostname?: string;
    readonly port: number;
    readonly pooler: PGlitePooler;
}
/**
 * Simple TCP server for PGlite queries
 * Protocol: Newline-delimited SQL queries
 * Response: JSON with status and results
 */
export declare class PGliteServer {
    private readonly config;
    private readonly clients;
    constructor(config: ServerConfig);
    /**
     * Start the TCP server
     */
    start(): Promise<void>;
    /**
     * Stop the server
     */
    stop(): Promise<void>;
    /**
     * Handle incoming connection
     */
    private handleConnection;
    /**
     * Process queries from a client
     */
    private processQueries;
    /**
     * Handle a single query
     */
    private handleQuery;
    /**
     * Get connected clients
     */
    getClients(): readonly string[];
}
//# sourceMappingURL=server.d.ts.map