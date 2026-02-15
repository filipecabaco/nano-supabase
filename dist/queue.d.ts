import type { QueuedQuery } from "./types.ts";
/**
 * Priority-based queue for managing query execution order
 * Uses separate queues for each priority level
 */
export declare class PriorityQueue {
    private readonly queues;
    private readonly maxSize;
    constructor(maxSize?: number);
    /**
     * Add a query to the appropriate priority queue
     * @throws {Error} if queue is full
     */
    enqueue(query: QueuedQuery): void;
    /**
     * Remove and return the highest priority query
     * Returns null if queue is empty
     */
    dequeue(): QueuedQuery | null;
    /**
     * Get total number of queued queries across all priorities
     */
    size(): number;
    /**
     * Check if queue is empty
     */
    isEmpty(): boolean;
    /**
     * Clear all queued queries
     */
    clear(): void;
}
//# sourceMappingURL=queue.d.ts.map