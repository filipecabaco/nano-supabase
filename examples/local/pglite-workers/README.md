# PGlite Workers — Full Supabase Stack in a Web Worker

Demonstrates PGlite's **Web Worker** and **multi-tab leader election** with nano-supabase's full Supabase-compatible API: auth, RLS, PostgREST, and storage — all running off the main thread.

## Why use PGlite Workers?

Running PGlite on the main thread works fine for simple apps, but hits real limitations as complexity grows. The worker approach solves these:

### UI stays responsive

PGlite executes SQL by running a full Postgres engine compiled to WebAssembly. Complex queries, schema initialization, auth password hashing (bcrypt via pgcrypto), and large inserts can block the main thread for tens or hundreds of milliseconds — long enough to cause visible UI jank, dropped frames, and unresponsive inputs. Moving PGlite into a Web Worker isolates all WASM execution on a separate thread. The main thread only sends and receives lightweight messages, so React renders, animations, and user interactions remain smooth even during heavy database work.

### Multi-tab coordination without conflicts

PGlite supports a single connection at a time. If a user opens your app in two browser tabs against the same IndexedDB database, both tabs try to lock the same storage — causing corruption or errors. PGliteWorker solves this with automatic **leader election** via `navigator.locks`. Exactly one tab becomes the leader and runs the actual Postgres instance. All other tabs transparently proxy their queries to the leader through `BroadcastChannel`. When the leader tab is closed, a new election promotes a follower — no data loss, no manual coordination.

### True offline-first architecture

With PGliteWorker + IndexedDB persistence, your app has a fully functional Postgres database that survives page reloads, works offline, and syncs across tabs — without any server. Add nano-supabase's fetch adapter on top and you get the complete Supabase API (auth, RLS, storage) running entirely client-side. This is ideal for:

- **Local-first apps** that work offline and sync later
- **Privacy-sensitive apps** where data never leaves the browser
- **Prototyping** with a real Supabase API before deploying infrastructure
- **Testing** Supabase-backed UIs without spinning up a backend

### Compared to main-thread PGlite

| Aspect | Main thread PGlite | PGliteWorker |
|--------|-------------------|--------------|
| UI responsiveness | Blocks during queries | Never blocks |
| Multi-tab | Fails (storage conflict) | Works (leader election) |
| Tab failover | N/A | Automatic promotion |
| Setup complexity | Simpler | One extra worker file |
| Performance overhead | None | Minimal (message passing) |
| Browser support | All modern browsers | Requires `navigator.locks` + `BroadcastChannel` |

**When to use workers:** Any browser app where you expect multiple tabs, heavy queries, or need a responsive UI during database operations. The extra worker file is minimal setup for significant reliability gains.

**When main-thread is fine:** Single-tab apps with light queries, tests, quick prototypes, or Node.js/Deno/edge runtimes (where workers don't apply).

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
