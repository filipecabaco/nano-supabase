import type { PGlite } from "@electric-sql/pglite";
import { QueryPriority } from "./types.ts";
import type { PoolerConfig, QueryFn, QueueMetrics, QueryResult } from "./types.ts";
export declare class PGlitePooler {
    private readonly db;
    private readonly queue;
    private running;
    private readonly config;
    private wakeUp;
    private processQueueDone;
    private resolveProcessQueueDone;
    private totalEnqueued;
    private totalDequeued;
    private totalTimedOut;
    private totalErrors;
    private waitTimeSum;
    private waitTimeCount;
    get pglite(): PGlite;
    constructor(db: PGlite, config?: Partial<PoolerConfig>);
    static create(db: PGlite, config?: Partial<PoolerConfig>): Promise<PGlitePooler>;
    start(): Promise<void>;
    stop(): Promise<void>;
    query(sql: string, params?: readonly unknown[], priority?: QueryPriority, timeoutMs?: number): Promise<QueryResult>;
    transaction<T>(fn: (query: QueryFn) => Promise<T>, priority?: QueryPriority): Promise<T>;
    metrics(): QueueMetrics;
    [Symbol.asyncDispose](): Promise<void>;
    private processQueue;
    private runTransaction;
    private executeWithTimeout;
}
//# sourceMappingURL=pooler.d.ts.map