import type { PGlite } from '@electric-sql/pglite';
import type { PoolerConfig, QueryPriority, QueryResult } from './types.js';
/**
 * Connection pooler that manages N-to-1 query execution against PGlite
 * Uses a priority queue to order query execution
 */
export declare class PGlitePooler {
    private readonly db;
    private readonly queue;
    private running;
    private readonly config;
    constructor(db: PGlite, config?: Partial<PoolerConfig>);
    /**
     * Start the queue processor
     * Begins draining queries from the queue
     */
    start(): Promise<void>;
    /**
     * Stop the queue processor
     * Waits for current query to complete
     */
    stop(): Promise<void>;
    /**
     * Submit a query to the pool
     * Returns a promise that resolves when the query completes
     */
    query(sql: string, params?: readonly unknown[], priority?: QueryPriority): Promise<QueryResult>;
    /**
     * Background queue processor
     * Continuously dequeues and executes queries
     */
    private processQueue;
    /**
     * Execute a query with timeout protection
     * Note: PGlite.query() already handles exclusive access internally via mutex
     */
    private executeWithTimeout;
}
//# sourceMappingURL=pooler.d.ts.map