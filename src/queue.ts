import { QueryPriority } from "./types.ts";
import type { QueuedQuery } from "./types.ts";

const PROMOTION: Readonly<Record<1 | 2 | 3, QueryPriority>> = {
  1: QueryPriority.CRITICAL,
  2: QueryPriority.HIGH,
  3: QueryPriority.MEDIUM,
};

export class PriorityQueue {
  private readonly queues: Map<QueryPriority, QueuedQuery[]>;
  private readonly maxSize: number;
  private readonly agingThresholdMs: number;

  constructor(maxSize: number = 1000, agingThresholdMs: number = 5000) {
    this.maxSize = maxSize;
    this.agingThresholdMs = agingThresholdMs;
    this.queues = new Map([
      [0, []],
      [1, []],
      [2, []],
      [3, []],
    ]);
  }

  enqueue(query: QueuedQuery): void {
    const queue = this.queues.get(query.priority);
    if (!queue) {
      throw new Error(`Invalid priority: ${query.priority}`);
    }

    const currentSize = this.size();
    if (currentSize >= this.maxSize) {
      throw new Error(`Queue is full (size: ${currentSize}, max: ${this.maxSize})`);
    }

    queue.push(query);
  }

  dequeue(): QueuedQuery | null {
    this.applyAging();

    for (const priority of [0, 1, 2, 3] as const) {
      const queue = this.queues.get(priority);
      if (queue && queue.length > 0) {
        return queue.shift() ?? null;
      }
    }
    return null;
  }

  private applyAging(): void {
    const now = Date.now();
    for (const priority of [1, 2, 3] as const) {
      const queue = this.queues.get(priority);
      if (!queue || queue.length === 0) continue;

      const promoted: QueuedQuery[] = [];
      const remaining: QueuedQuery[] = [];

      for (const query of queue) {
        if (now - query.enqueuedAt > this.agingThresholdMs) {
          promoted.push({ ...query, priority: PROMOTION[priority] });
        } else {
          remaining.push(query);
        }
      }

      if (promoted.length > 0) {
        queue.length = 0;
        for (const q of remaining) queue.push(q);
        const upperQueue = this.queues.get(PROMOTION[priority])!;
        for (const q of promoted) upperQueue.push(q);
      }
    }
  }

  size(): number {
    return Array.from(this.queues.values()).reduce(
      (sum, q) => sum + q.length,
      0,
    );
  }

  clear(): QueuedQuery[] {
    const all: QueuedQuery[] = [];
    for (const queue of this.queues.values()) {
      for (const q of queue) all.push(q);
      queue.length = 0;
    }
    return all;
  }

  sizeByPriority(): Record<QueryPriority, number> {
    return {
      0: this.queues.get(0)!.length,
      1: this.queues.get(1)!.length,
      2: this.queues.get(2)!.length,
      3: this.queues.get(3)!.length,
    };
  }
}
