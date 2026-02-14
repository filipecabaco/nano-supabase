/**
 * Priority Queue Tests
 * Tests the priority queue implementation
 */

import { PriorityQueue } from "../src/queue.ts";
import { QueryPriority, type QueuedQuery } from "../src/types.ts";
import { test, describe, assertEquals, assertExists } from "./compat.ts";

function createMockQuery(sql: string, priority: QueryPriority): QueuedQuery {
  return {
    id: crypto.randomUUID(),
    sql,
    params: [],
    priority,
    enqueuedAt: Date.now(),
    resolve: () => {},
    reject: () => {},
    timeoutMs: 30000,
  };
}

describe("Queue", () => {
  test("Enqueue and dequeue", () => {
    const queue = new PriorityQueue();

    const query1 = createMockQuery("SELECT 1", QueryPriority.MEDIUM);
    const query2 = createMockQuery("SELECT 2", QueryPriority.HIGH);
    const query3 = createMockQuery("SELECT 3", QueryPriority.LOW);

    queue.enqueue(query1);
    queue.enqueue(query2);
    queue.enqueue(query3);

    assertEquals(queue.size(), 3);

    const first = queue.dequeue();
    assertEquals(first?.sql, "SELECT 2"); // HIGH first

    const second = queue.dequeue();
    assertEquals(second?.sql, "SELECT 1"); // MEDIUM second

    const third = queue.dequeue();
    assertEquals(third?.sql, "SELECT 3"); // LOW last

    assertEquals(queue.size(), 0);
  });

  test("Critical priority", () => {
    const queue = new PriorityQueue();

    queue.enqueue(createMockQuery("normal", QueryPriority.MEDIUM));
    queue.enqueue(createMockQuery("urgent", QueryPriority.CRITICAL));
    queue.enqueue(createMockQuery("low", QueryPriority.LOW));

    const first = queue.dequeue();
    assertEquals(first?.sql, "urgent"); // CRITICAL always first

    const second = queue.dequeue();
    assertEquals(second?.sql, "normal");

    const third = queue.dequeue();
    assertEquals(third?.sql, "low");
  });

  test("FIFO within same priority", () => {
    const queue = new PriorityQueue();

    queue.enqueue(createMockQuery("first", QueryPriority.MEDIUM));
    queue.enqueue(createMockQuery("second", QueryPriority.MEDIUM));
    queue.enqueue(createMockQuery("third", QueryPriority.MEDIUM));

    // Should maintain FIFO order within same priority
    assertEquals(queue.dequeue()?.sql, "first");
    assertEquals(queue.dequeue()?.sql, "second");
    assertEquals(queue.dequeue()?.sql, "third");
  });

  test("isEmpty", () => {
    const queue = new PriorityQueue();

    assertEquals(queue.isEmpty(), true);

    queue.enqueue(createMockQuery("task", QueryPriority.MEDIUM));
    assertEquals(queue.isEmpty(), false);

    queue.dequeue();
    assertEquals(queue.isEmpty(), true);
  });

  test("Mixed priorities", () => {
    const queue = new PriorityQueue();

    // Add items in random priority order
    queue.enqueue(createMockQuery("q1", QueryPriority.MEDIUM));
    queue.enqueue(createMockQuery("q2", QueryPriority.CRITICAL));
    queue.enqueue(createMockQuery("q3", QueryPriority.LOW));
    queue.enqueue(createMockQuery("q4", QueryPriority.HIGH));
    queue.enqueue(createMockQuery("q5", QueryPriority.MEDIUM));
    queue.enqueue(createMockQuery("q6", QueryPriority.CRITICAL));

    // Should dequeue in priority order: CRITICAL, HIGH, MEDIUM, LOW
    assertEquals(queue.dequeue()?.sql, "q2"); // CRITICAL (first)
    assertEquals(queue.dequeue()?.sql, "q6"); // CRITICAL (second)
    assertEquals(queue.dequeue()?.sql, "q4"); // HIGH
    assertEquals(queue.dequeue()?.sql, "q1"); // MEDIUM (first)
    assertEquals(queue.dequeue()?.sql, "q5"); // MEDIUM (second)
    assertEquals(queue.dequeue()?.sql, "q3"); // LOW
  });

  test("Clear", () => {
    const queue = new PriorityQueue();

    queue.enqueue(createMockQuery("task1", QueryPriority.MEDIUM));
    queue.enqueue(createMockQuery("task2", QueryPriority.HIGH));
    queue.enqueue(createMockQuery("task3", QueryPriority.LOW));

    assertEquals(queue.size(), 3);

    queue.clear();

    assertEquals(queue.size(), 0);
    assertEquals(queue.isEmpty(), true);
    assertEquals(queue.dequeue(), null);
  });

  test("All priorities represented", () => {
    const queue = new PriorityQueue();

    queue.enqueue(createMockQuery("critical", QueryPriority.CRITICAL)); // 0
    queue.enqueue(createMockQuery("high", QueryPriority.HIGH)); // 1
    queue.enqueue(createMockQuery("medium", QueryPriority.MEDIUM)); // 2
    queue.enqueue(createMockQuery("low", QueryPriority.LOW)); // 3

    assertEquals(queue.dequeue()?.sql, "critical");
    assertEquals(queue.dequeue()?.sql, "high");
    assertEquals(queue.dequeue()?.sql, "medium");
    assertEquals(queue.dequeue()?.sql, "low");
  });

  test("Max size limit", () => {
    const queue = new PriorityQueue(5); // Max 5 items

    // Add 5 items (should succeed)
    for (let i = 0; i < 5; i++) {
      queue.enqueue(createMockQuery(`q${i}`, QueryPriority.MEDIUM));
    }

    assertEquals(queue.size(), 5);

    // Try to add 6th item (should throw)
    try {
      queue.enqueue(createMockQuery("q6", QueryPriority.MEDIUM));
      throw new Error("Should have thrown an error");
    } catch (error) {
      assertExists(error);
    }
  });

  test("Empty dequeue returns null", () => {
    const queue = new PriorityQueue();

    assertEquals(queue.dequeue(), null);
    assertEquals(queue.isEmpty(), true);
  });

  test("Query metadata preserved", () => {
    const queue = new PriorityQueue();

    const mockQuery: QueuedQuery = {
      id: crypto.randomUUID(),
      sql: "SELECT * FROM users",
      params: [1, "test"],
      priority: QueryPriority.HIGH,
      enqueuedAt: Date.now(),
      resolve: () => {},
      reject: () => {},
      timeoutMs: 5000,
    };

    queue.enqueue(mockQuery);

    const dequeued = queue.dequeue();
    assertExists(dequeued);
    assertEquals(dequeued.sql, "SELECT * FROM users");
    assertEquals(dequeued.params, [1, "test"]);
    assertEquals(dequeued.timeoutMs, 5000);
    assertEquals(dequeued.priority, QueryPriority.HIGH);
  });
});
