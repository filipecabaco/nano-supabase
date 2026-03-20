import type { QueuedQuery } from "./types.ts";
import { QueryPriority } from "./types.ts";

const PROMOTION: Readonly<Record<1 | 2 | 3, QueryPriority>> = {
	1: QueryPriority.CRITICAL,
	2: QueryPriority.HIGH,
	3: QueryPriority.MEDIUM,
};

type Queues = [QueuedQuery[], QueuedQuery[], QueuedQuery[], QueuedQuery[]];
type Heads = [number, number, number, number];

export class PriorityQueue {
	private readonly queues: Queues;
	private readonly heads: Heads;
	private readonly maxSize: number;
	private readonly agingThresholdMs: number;
	private _size = 0;
	private lastAgingRun = 0;

	constructor(maxSize: number = 1000, agingThresholdMs: number = 5000) {
		this.maxSize = maxSize;
		this.agingThresholdMs = agingThresholdMs;
		this.queues = [[], [], [], []];
		this.heads = [0, 0, 0, 0];
	}

	enqueue(query: QueuedQuery): void {
		if (query.priority < 0 || query.priority > 3) {
			throw new Error(`Invalid priority: ${query.priority}`);
		}
		if (this._size >= this.maxSize) {
			throw new Error(`Queue is full (size: ${this._size}, max: ${this.maxSize})`);
		}
		this.queues[query.priority].push(query);
		this._size++;
	}

	dequeue(): QueuedQuery | null {
		const now = Date.now();
		if (now - this.lastAgingRun > 1000) {
			this.applyAging(now);
			this.lastAgingRun = now;
		}

		for (let p = 0; p < 4; p++) {
			const queue = this.queues[p as 0 | 1 | 2 | 3];
			const head = this.heads[p as 0 | 1 | 2 | 3];
			if (head < queue.length) {
				const item = queue[head]!;
				this.heads[p as 0 | 1 | 2 | 3]++;
				this._size--;
				if (this.heads[p as 0 | 1 | 2 | 3] > queue.length / 2) {
					this.queues[p as 0 | 1 | 2 | 3] = queue.slice(this.heads[p as 0 | 1 | 2 | 3]);
					this.heads[p as 0 | 1 | 2 | 3] = 0;
				}
				return item;
			}
		}
		return null;
	}

	private applyAging(now: number): void {
		for (const priority of [1, 2, 3] as const) {
			const queue = this.queues[priority];
			const head = this.heads[priority];
			if (head >= queue.length) continue;

			let hadPromotions = false;
			const upperQueue = this.queues[PROMOTION[priority]];

			for (let i = head; i < queue.length; i++) {
				const query = queue[i]!;
				if (now - query.enqueuedAt > this.agingThresholdMs) {
					query.priority = PROMOTION[priority];
					upperQueue.push(query);
					(queue as (QueuedQuery | null)[])[i] = null;
					hadPromotions = true;
				}
			}

			if (hadPromotions) {
				const remaining: QueuedQuery[] = [];
				for (let i = head; i < queue.length; i++) {
					const q = (queue as (QueuedQuery | null)[])[i];
					if (q !== null) remaining.push(q!);
				}
				this.queues[priority] = remaining;
				this.heads[priority] = 0;
			}
		}
	}

	size(): number {
		return this._size;
	}

	clear(): QueuedQuery[] {
		const all: QueuedQuery[] = [];
		for (let p = 0; p < 4; p++) {
			const queue = this.queues[p as 0 | 1 | 2 | 3];
			const head = this.heads[p as 0 | 1 | 2 | 3];
			for (let i = head; i < queue.length; i++) all.push(queue[i]!);
			this.queues[p as 0 | 1 | 2 | 3] = [];
			this.heads[p as 0 | 1 | 2 | 3] = 0;
		}
		this._size = 0;
		return all;
	}

	sizeByPriority(): Record<QueryPriority, number> {
		return {
			0: Math.max(0, this.queues[0].length - this.heads[0]),
			1: Math.max(0, this.queues[1].length - this.heads[1]),
			2: Math.max(0, this.queues[2].length - this.heads[2]),
			3: Math.max(0, this.queues[3].length - this.heads[3]),
		};
	}
}
