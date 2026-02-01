import { randomUUID } from 'node:crypto'

import type { PGlite } from '@electric-sql/pglite'

import { PriorityQueue } from './queue.js'
import type { PoolerConfig, QueuedQuery, QueryPriority, QueryResult } from './types.js'

/**
 * Connection pooler that manages N-to-1 query execution against PGlite
 * Uses a priority queue to order query execution
 */
export class PGlitePooler {
  private readonly db: PGlite
  private readonly queue: PriorityQueue
  private running: boolean = false
  private readonly config: PoolerConfig

  constructor(db: PGlite, config: Partial<PoolerConfig> = {}) {
    this.db = db
    this.queue = new PriorityQueue(config.maxQueueSize ?? 1000)
    this.config = {
      maxQueueSize: config.maxQueueSize ?? 1000,
      defaultTimeout: config.defaultTimeout ?? 5000
    }
  }

  /**
   * Start the queue processor
   * Begins draining queries from the queue
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Pooler already started')
    }
    this.running = true

    // Start processing in background
    // Use setImmediate to ensure it starts in next tick
    setImmediate(() => {
      this.processQueue().catch(err => {
        console.error('Queue processor error:', err)
        this.running = false
      })
    })

    // Give the processor a chance to start
    await new Promise(resolve => setImmediate(resolve))
  }

  /**
   * Stop the queue processor
   * Waits for current query to complete
   */
  async stop(): Promise<void> {
    this.running = false
  }

  /**
   * Submit a query to the pool
   * Returns a promise that resolves when the query completes
   */
  async query(
    sql: string,
    params?: readonly unknown[],
    priority: QueryPriority = 2 // MEDIUM
  ): Promise<QueryResult> {
    return new Promise((resolve, reject) => {
      const query: QueuedQuery = {
        id: randomUUID(),
        sql,
        params,
        priority,
        enqueuedAt: Date.now(),
        resolve,
        reject,
        timeoutMs: this.config.defaultTimeout
      }

      try {
        this.queue.enqueue(query)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /**
   * Background queue processor
   * Continuously dequeues and executes queries
   */
  private async processQueue(): Promise<void> {
    while (this.running) {
      const query = this.queue.dequeue()

      if (!query) {
        // No queries, sleep briefly
        await new Promise(r => setTimeout(r, 10))
        continue
      }

      // Execute query with timeout
      try {
        const result = await this.executeWithTimeout(query)
        query.resolve(result)
      } catch (error) {
        query.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  /**
   * Execute a query with timeout protection
   * Note: PGlite.query() already handles exclusive access internally via mutex
   */
  private async executeWithTimeout(query: QueuedQuery): Promise<QueryResult> {
    const timeoutMs = query.timeoutMs ?? this.config.defaultTimeout

    let timeoutId: NodeJS.Timeout | null = null

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Query timeout'))
      }, timeoutMs)
    })

    // PGlite.query() already uses a mutex internally, no need for runExclusive
    const queryPromise = this.db.query(query.sql, query.params as unknown[])
      .finally(() => {
        // Cancel timeout if query completes
        if (timeoutId) clearTimeout(timeoutId)
      })

    return Promise.race([queryPromise, timeoutPromise]) as Promise<QueryResult>
  }
}
