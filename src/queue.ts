import type { QueuedQuery } from './types.js'
import type { QueryPriority } from './types.js'

/**
 * Priority-based queue for managing query execution order
 * Uses separate queues for each priority level
 */
export class PriorityQueue {
  private readonly queues: Map<QueryPriority, QueuedQuery[]>
  private readonly maxSize: number

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize
    this.queues = new Map([
      [0, []], // QueryPriority.CRITICAL
      [1, []], // QueryPriority.HIGH
      [2, []], // QueryPriority.MEDIUM
      [3, []], // QueryPriority.LOW
    ])
  }

  /**
   * Add a query to the appropriate priority queue
   * @throws {Error} if queue is full
   */
  enqueue(query: QueuedQuery): void {
    const queue = this.queues.get(query.priority)
    if (!queue) {
      throw new Error(`Invalid priority: ${query.priority}`)
    }

    if (this.size() >= this.maxSize) {
      throw new Error('Queue is full')
    }

    queue.push(query)
  }

  /**
   * Remove and return the highest priority query
   * Returns null if queue is empty
   */
  dequeue(): QueuedQuery | null {
    // Check queues in priority order (CRITICAL = 0 to LOW = 3)
    for (const priority of [0, 1, 2, 3] as const) {
      const queue = this.queues.get(priority)
      if (queue && queue.length > 0) {
        return queue.shift() ?? null
      }
    }
    return null
  }

  /**
   * Get total number of queued queries across all priorities
   */
  size(): number {
    return Array.from(this.queues.values())
      .reduce((sum, q) => sum + q.length, 0)
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.size() === 0
  }

  /**
   * Clear all queued queries
   */
  clear(): void {
    for (const queue of this.queues.values()) {
      queue.length = 0
    }
  }
}
