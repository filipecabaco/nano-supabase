import type { PGlite } from "@electric-sql/pglite";

import { PriorityQueue } from "./queue.ts";
import { QueryPriority } from "./types.ts";
import type {
  PoolerConfig,
  QueuedQuery,
  QueryFn,
  QueueMetrics,
  QueryResult,
} from "./types.ts";

export class PGlitePooler {
  private readonly db: PGlite;
  private readonly queue: PriorityQueue;
  private running: boolean = false;
  private readonly config: PoolerConfig;
  private wakeUp: (() => void) | null = null;
  private processQueueDone: Promise<void> = Promise.resolve();
  private resolveProcessQueueDone: (() => void) | null = null;

  private totalEnqueued = 0;
  private totalDequeued = 0;
  private totalTimedOut = 0;
  private totalErrors = 0;
  private waitTimeSum = 0;
  private waitTimeCount = 0;

  constructor(db: PGlite, config: Partial<PoolerConfig> = {}) {
    this.db = db;
    const maxQueueSize = config.maxQueueSize ?? 1000;
    const agingThresholdMs = config.agingThresholdMs ?? 5000;
    this.queue = new PriorityQueue(maxQueueSize, agingThresholdMs);
    this.config = {
      maxQueueSize,
      defaultTimeout: config.defaultTimeout ?? 5000,
      agingThresholdMs,
    };
  }

  static async create(db: PGlite, config?: Partial<PoolerConfig>): Promise<PGlitePooler> {
    const pooler = new PGlitePooler(db, config);
    await pooler.start();
    return pooler;
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Pooler already started");
    }
    this.running = true;

    this.processQueueDone = new Promise<void>((resolve) => {
      this.resolveProcessQueueDone = resolve;
    });

    setTimeout(() => {
      this.processQueue().catch((err) => {
        console.error("Queue processor error:", err);
        this.running = false;
        this.resolveProcessQueueDone?.();
      });
    }, 0);

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.wakeUp?.();

    const drained = this.queue.clear();
    for (const query of drained) {
      query.reject(new Error("Pooler stopped"));
    }

    await this.processQueueDone;
  }

  async query(
    sql: string,
    params?: readonly unknown[],
    priority: QueryPriority = QueryPriority.MEDIUM,
    timeoutMs?: number,
  ): Promise<QueryResult> {
    if (!this.running) {
      throw new Error("Pooler is not running");
    }

    return new Promise((resolve, reject) => {
      const query: QueuedQuery = {
        kind: "sql",
        id: crypto.randomUUID(),
        sql,
        params: params ?? [],
        priority,
        enqueuedAt: Date.now(),
        resolve,
        reject,
        timeoutMs: timeoutMs ?? this.config.defaultTimeout,
      };

      try {
        this.queue.enqueue(query);
        this.totalEnqueued++;
        this.wakeUp?.();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async transaction<T>(
    fn: (query: QueryFn) => Promise<T>,
    priority: QueryPriority = QueryPriority.MEDIUM,
  ): Promise<T> {
    if (!this.running) {
      throw new Error("Pooler is not running");
    }

    return new Promise((resolve, reject) => {
      const transactionQuery: QueuedQuery = {
        kind: "transaction",
        id: crypto.randomUUID(),
        priority,
        enqueuedAt: Date.now(),
        resolve: resolve as (result: unknown) => void,
        reject,
        timeoutMs: this.config.defaultTimeout,
        transactionFn: fn as (query: QueryFn) => Promise<unknown>,
      };

      try {
        this.queue.enqueue(transactionQuery);
        this.totalEnqueued++;
        this.wakeUp?.();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }) as Promise<T>;
  }

  metrics(): QueueMetrics {
    const avgWaitTimeMs =
      this.waitTimeCount > 0 ? this.waitTimeSum / this.waitTimeCount : 0;

    return {
      totalEnqueued: this.totalEnqueued,
      totalDequeued: this.totalDequeued,
      totalTimedOut: this.totalTimedOut,
      totalErrors: this.totalErrors,
      currentSize: this.queue.size(),
      avgWaitTimeMs,
      sizeByPriority: this.queue.sizeByPriority(),
    };
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }

  private async processQueue(): Promise<void> {
    while (this.running) {
      const query = this.queue.dequeue();

      if (!query) {
        await new Promise<void>((resolve) => {
          this.wakeUp = resolve;
          setTimeout(() => resolve(), 10);
        });
        this.wakeUp = null;
        continue;
      }

      this.totalDequeued++;
      this.waitTimeSum += Date.now() - query.enqueuedAt;
      this.waitTimeCount++;

      try {
        if (query.kind === "transaction") {
          const result = await this.runTransaction(query.transactionFn);
          query.resolve(result);
        } else {
          const result = await this.executeWithTimeout(query);
          query.resolve(result);
        }
      } catch (error) {
        this.totalErrors++;
        const err = error instanceof Error ? error : new Error(String(error));
        if (err.message === "Query timeout") {
          this.totalTimedOut++;
        }
        query.reject(err);
      }
    }

    this.resolveProcessQueueDone?.();
  }

  private async runTransaction<T>(fn: (query: QueryFn) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const queryFn: QueryFn = (sql, params) =>
        tx.query(sql, params as unknown[]) as Promise<QueryResult>;
      return fn(queryFn);
    }) as Promise<T>;
  }

  private async executeWithTimeout(query: { sql: string; params: readonly unknown[]; timeoutMs?: number }): Promise<QueryResult> {
    const timeoutMs = query.timeoutMs ?? this.config.defaultTimeout;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Query timeout"));
      }, timeoutMs);
    });

    const queryPromise = this.db
      .query(query.sql, [...(query.params ?? [])])
      .finally(() => {
        if (timeoutId !== null) clearTimeout(timeoutId);
      });

    return Promise.race([queryPromise, timeoutPromise]) as Promise<QueryResult>;
  }
}
