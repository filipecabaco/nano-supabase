# PGlite Workers — Full Supabase Stack in a Web Worker

Demonstrates PGlite's **Web Worker** and **multi-tab leader election** with nano-supabase's full Supabase-compatible API: auth, RLS, PostgREST, and storage — all running off the main thread.

## What this shows

- **Off-main-thread Postgres** — PGlite runs inside a Web Worker, keeping the UI responsive
- **Full Supabase API** — `supabase-js` client backed by `PGliteWorker` via `createFetchAdapter`
- **Auth + RLS** — Sign up/sign in, with Row Level Security enforcing per-user data isolation
- **Storage** — File uploads via Supabase Storage API through the worker
- **Leader election** — `navigator.locks` elects one tab as leader; followers proxy via `BroadcastChannel`
- **Automatic failover** — Close the leader tab and a follower gets promoted automatically
- **IndexedDB persistence** — Data survives page reloads

## How it works

```
Tab A (Leader)                Tab B (Follower)
  ┌──────────────┐              ┌──────────────┐
  │  React UI    │              │  React UI    │
  │  supabase-js │              │  supabase-js │
  └──────┬───────┘              └──────┬───────┘
         │ localFetch                  │ localFetch
  ┌──────┴───────┐              ┌──────┴───────┐
  │  nano-supabase│              │ nano-supabase│
  │  fetchAdapter │              │ fetchAdapter │
  └──────┬───────┘              └──────┬───────┘
         │                             │
  ┌──────┴───────┐   BroadcastChannel ┌┴─────────┐
  │ PGliteWorker │◄────────────────── │PGliteWkr │
  │   (leader)   │                    │ (proxy)   │
  └──────────────┘                    └───────────┘
    IndexedDB
```

1. Each tab spawns a Web Worker running `worker.ts` which initializes PGlite
2. `navigator.locks` elects exactly one tab as the leader
3. nano-supabase's `createFetchAdapter` wires auth, PostgREST, and storage to the `PGliteWorker` instance
4. `supabase-js` calls go through `localFetch` → nano-supabase → PGliteWorker → Postgres (in worker)
5. RLS policies enforce that each user only sees their own data

## Running

```bash
cd examples/local/pglite-workers
pnpm install
pnpm run dev
```

Open the app in **two or more browser tabs**:
1. Sign up as `alice@example.com` in Tab A — add some notes
2. Sign up as `bob@example.com` in Tab B — add different notes
3. Each user only sees their own notes (RLS enforcement)
4. Close the leader tab — the follower seamlessly takes over

## Key files

| File | Purpose |
|------|---------|
| `src/worker.ts` | Web Worker — calls `worker()` from `@electric-sql/pglite/worker`, initializes PGlite |
| `src/db.ts` | Main thread — creates `PGliteWorker`, wires it to nano-supabase's `createFetchAdapter` |
| `src/App.tsx` | React UI — auth flow, RLS-protected notes, storage uploads, leader/follower status |

## Key APIs used

- **`worker({ init })`** — Worker-side setup from `@electric-sql/pglite/worker`
- **`PGliteWorker.create(worker, options)`** — Main-thread connection to the worker
- **`createFetchAdapter({ db })`** — nano-supabase wiring that accepts `PGliteWorker` (via `PGliteInterface`)
- **`supabase-js` client** — Standard Supabase client with `localFetch` injected
- **`db.isLeader`** / **`db.onLeaderChange()`** — Leader election awareness
