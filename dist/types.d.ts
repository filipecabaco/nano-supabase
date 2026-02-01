/**
 * Priority levels for query execution
 * Lower number = higher priority
 */
export declare enum QueryPriority {
    CRITICAL = 0,
    HIGH = 1,
    MEDIUM = 2,
    LOW = 3
}
/**
 * Result from PGlite query execution
 */
export interface QueryResult {
    readonly rows: readonly Record<string, unknown>[];
    readonly fields?: readonly {
        name: string;
        dataTypeID: number;
    }[];
    readonly affectedRows?: number;
}
/**
 * Query queued for execution
 */
export interface QueuedQuery {
    readonly id: string;
    readonly sql: string;
    readonly params?: readonly unknown[];
    priority: QueryPriority;
    readonly enqueuedAt: number;
    readonly resolve: (result: QueryResult) => void;
    readonly reject: (error: Error) => void;
    readonly timeoutMs?: number;
}
/**
 * Configuration for the connection pooler
 */
export interface PoolerConfig {
    readonly maxQueueSize: number;
    readonly defaultTimeout: number;
}
/**
 * Queue metrics for monitoring
 */
export interface QueueMetrics {
    readonly totalEnqueued: number;
    readonly totalDequeued: number;
    readonly currentSize: number;
    readonly avgWaitTimeMs: number;
    readonly sizeByPriority: Readonly<Record<QueryPriority, number>>;
}
//# sourceMappingURL=types.d.ts.map