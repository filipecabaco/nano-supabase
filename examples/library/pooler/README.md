# Pooler Priority Queue

Demonstrates the `PGlitePooler` with priority-based query scheduling. Queries are queued and executed in priority order (HIGH > MEDIUM > LOW), ensuring critical operations are processed first even under concurrent load.

## What it shows

- Priority-ordered query execution
- Concurrent query handling (10 parallel inserts)
- Parameterized queries
- Error handling for invalid queries
- Transactions with automatic rollback on failure
- Pooler metrics (enqueued, dequeued, wait time, errors)

## Run

```bash
pnpm run example:pooler
```

## Key APIs

- `PGlitePooler.create(db)` — create a pooler wrapping a PGlite instance
- `pooler.query(sql, params, priority)` — execute a query with priority
- `pooler.transaction(fn)` — run queries in a transaction
- `pooler.metrics()` — get pooler statistics
