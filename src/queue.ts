import type { QueuedQuery } from "./types.ts";
import { QueryPriority } from "./types.ts";

type PromotablePriority = 1 | 2 | 3;

const PROMOTION: Readonly<Record<PromotablePriority, QueryPriority>> = {
	1: QueryPriority.CRITICAL,
	2: QueryPriority.HIGH,
	3: QueryPriority.MEDIUM,
};

const PRIORITY_COUNT = 4;
const AGING_CHECK_INTERVAL_MS = 1000;

type Queues = [QueuedQuery[], QueuedQuery[], QueuedQuery[], QueuedQuery[]];
type Heads = [number, number, number, number];
type PriorityIndex = 0 | 1 | 2 | 3;

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
			throw new Error(
				`Queue is full (size: ${this._size}, max: ${this.maxSize})`,
			);
		}
		this.queues[query.priority].push(query);
		this._size++;
	}

	dequeue(): QueuedQuery | null {
		const now = Date.now();
		if (now - this.lastAgingRun > AGING_CHECK_INTERVAL_MS) {
			this.applyAging(now);
			this.lastAgingRun = now;
		}

		for (let p = 0; p < PRIORITY_COUNT; p++) {
			const pi = p as PriorityIndex;
			const queue = this.queues[pi];
			const head = this.heads[pi];
			if (head < queue.length) {
				const item = queue[head] ?? null;
				(queue as (QueuedQuery | null)[])[head] = null;
				this.heads[pi]++;
				this._size--;
				if (this.heads[pi] > queue.length / 2) {
					this.queues[pi] = queue.slice(this.heads[pi]);
					this.heads[pi] = 0;
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
				const query = queue[i];
				if (
					query !== undefined &&
					now - query.enqueuedAt > this.agingThresholdMs
				) {
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
					if (q !== null && q !== undefined) remaining.push(q);
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
		for (let p = 0; p < PRIORITY_COUNT; p++) {
			const pi = p as PriorityIndex;
			const queue = this.queues[pi];
			const head = this.heads[pi];
			for (let i = head; i < queue.length; i++) {
				const item = queue[i];
				if (item !== undefined) all.push(item);
			}
			this.queues[pi] = [];
			this.heads[pi] = 0;
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
