# PGlite Workers — Multi-Tab Shared Database

Demonstrates PGlite's **Web Worker** and **multi-tab leader election** features with nano-supabase.

## What this shows

- **Off-main-thread Postgres** — PGlite runs inside a Web Worker, keeping the UI responsive
- **Leader election** — `navigator.locks` elects one tab as leader; only the leader instantiates PGlite
- **Cross-tab sync** — Follower tabs proxy queries to the leader via `BroadcastChannel`
- **Automatic failover** — Close the leader tab and a follower gets promoted automatically
- **IndexedDB persistence** — Data survives page reloads (`idb://pglite-workers-demo`)

## How it works

```
Tab A (Leader)                Tab B (Follower)           Tab C (Follower)
  ┌──────────┐                  ┌──────────┐               ┌──────────┐
  │  React   │                  │  React   │               │  React   │
  └────┬─────┘                  └────┬─────┘               └────┬─────┘
       │                             │                          │
  ┌────┴─────┐   BroadcastChannel   ┌┴──────────┐        ┌────┴─────┐
  │ PGlite   │◄─────────────────────│ PGliteWkr │        │ PGliteWkr│
  │ Worker   │                      │ (proxy)   │        │ (proxy)  │
  │ (actual) │                      └───────────┘        └──────────┘
  └──────────┘
    IndexedDB
```

1. Each tab spawns a Web Worker running `worker.ts`
2. `navigator.locks` elects exactly one tab as the leader
3. The leader's worker instantiates `PGlite` with IndexedDB persistence
4. Follower workers proxy all queries to the leader via `BroadcastChannel`
5. When the leader closes, the lock is released and a follower is promoted

## Running

```bash
cd examples/local/pglite-workers
pnpm install
pnpm run dev
```

Open the app in **two or more browser tabs** to see leader election in action. Add, toggle, and delete todos — changes appear across all tabs.

## Key files

| File | Purpose |
|------|---------|
| `src/worker.ts` | Web Worker — calls `worker()` from `@electric-sql/pglite/worker`, initializes PGlite with schema |
| `src/db.ts` | Main thread — creates `PGliteWorker` instance, exposes CRUD functions |
| `src/App.tsx` | React UI — shows leader/follower status, shared todo list |

## Key APIs used

- **`worker({ init })`** — Worker-side setup from `@electric-sql/pglite/worker`
- **`PGliteWorker.create(worker, options)`** — Main-thread connection to the worker
- **`db.isLeader`** — Check if this tab is the elected leader
- **`db.onLeaderChange(callback)`** — React to leadership changes
