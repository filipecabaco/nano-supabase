import type { QueuedQuery } from "./types.ts";
import { QueryPriority } from "./types.ts";
export declare class PriorityQueue {
    private readonly queues;
    private readonly heads;
    private readonly maxSize;
    private readonly agingThresholdMs;
    private _size;
    private lastAgingRun;
    constructor(maxSize?: number, agingThresholdMs?: number);
    enqueue(query: QueuedQuery): void;
    dequeue(): QueuedQuery | null;
    private applyAging;
    size(): number;
    clear(): QueuedQuery[];
    sizeByPriority(): Record<QueryPriority, number>;
}
//# sourceMappingURL=queue.d.ts.map