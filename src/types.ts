export enum QueryPriority {
  CRITICAL = 0,
  HIGH = 1,
  MEDIUM = 2,
  LOW = 3,
}

export interface QueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly fields?: readonly { name: string; dataTypeID: number }[];
  readonly affectedRows?: number;
}

export type QueryFn = (sql: string, params?: readonly unknown[]) => Promise<QueryResult>;

interface BaseQueuedQuery {
  readonly id: string;
  priority: QueryPriority;
  readonly enqueuedAt: number;
  readonly reject: (error: Error) => void;
  readonly timeoutMs?: number;
}

interface SqlQueuedQuery extends BaseQueuedQuery {
  readonly kind: "sql";
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly resolve: (result: QueryResult) => void;
}

interface TransactionQueuedQuery extends BaseQueuedQuery {
  readonly kind: "transaction";
  readonly resolve: (result: unknown) => void;
  readonly transactionFn: (query: QueryFn) => Promise<unknown>;
}

export type QueuedQuery = SqlQueuedQuery | TransactionQueuedQuery;

export interface PoolerConfig {
  readonly maxQueueSize: number;
  readonly defaultTimeout: number;
  readonly agingThresholdMs: number;
}

export interface QueueMetrics {
  readonly totalEnqueued: number;
  readonly totalDequeued: number;
  readonly totalTimedOut: number;
  readonly totalErrors: number;
  readonly currentSize: number;
  readonly avgWaitTimeMs: number;
  readonly sizeByPriority: Readonly<Record<QueryPriority, number>>;
}
