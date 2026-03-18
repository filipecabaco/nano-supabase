# nano-supabase

A TypeScript library that provides a Supabase-compatible API backed by PGlite (PostgreSQL in WebAssembly). Zero network calls, zero external processes — everything runs in-process.

## What This Is

nano-supabase intercepts `fetch` calls from `@supabase/supabase-js` and routes them to a local PGlite instance instead of a remote Supabase server:

- Auth (`/auth/v1/*`) — signup, signin, signout, JWT sessions, RLS
- Data (`/rest/v1/*`) — PostgREST-compatible queries parsed via WASM
- Storage (`/storage/v1/*`) — bucket/object CRUD with pluggable backends

It also ships a CLI (`nano-supabase`) that runs a full HTTP + Postgres TCP server locally.

## Installation

```bash
npm install nano-supabase @electric-sql/pglite
```

`@electric-sql/pglite` is a peer dependency — install it separately.

## Simplest Setup

```typescript
import { createClient } from 'nano-supabase'

const supabase = await createClient()
await supabase.from('todos').insert({ title: 'Hello' })
const { data } = await supabase.from('todos').select('*')
```

`createClient` is a drop-in replacement for `@supabase/supabase-js`'s `createClient`. No URL, no project, no network.

## Setup With Existing PGlite Instance

```typescript
import { PGlite } from '@electric-sql/pglite'
import { createClient } from '@supabase/supabase-js'
import { nanoSupabase } from 'nano-supabase'

const nano = await nanoSupabase()

await nano.db.exec(`CREATE TABLE todos (id SERIAL PRIMARY KEY, title TEXT NOT NULL);`)

const supabase = createClient('http://localhost:54321', 'local-anon-key', {
  global: { fetch: nano.localFetch }
})
```

## Public API

All exports from `nano-supabase`:

| Export | Purpose |
|--------|---------|
| `createClient(options?)` | Drop-in replacement for supabase-js `createClient`. Returns a wired-up `SupabaseClient`. |
| `nanoSupabase(options?)` | Full factory — returns `{ db, localFetch, createClient, [AsyncDispose] }` |
| `createFetchAdapter({ db, ... })` | Low-level: returns `{ localFetch, authHandler, parser, storageHandler }` |
| `createLocalSupabaseClient(config, createClientFn)` | Wire a custom supabase-js `createClient` call to a PGlite instance |
| `createSupabaseClient(db)` | Standalone query builder (no supabase-js dependency) |
| `createPGlite(options?)` | PGlite factory with all required extensions pre-registered |
| `initializeAuth(db)` | Initialize auth schema only, returns `AuthHandler` |
| `PGlitePooler` | Priority-queue connection pooler |
| `PostgrestParser` | PostgREST URL → SQL converter (WASM) |
| `AuthHandler` | Auth operations (signup, signin, JWT, sessions) |
| `StorageHandler` | Storage operations (buckets, objects, signed URLs) |
| `QueryPriority` | `CRITICAL / HIGH / MEDIUM / LOW` enum for pooler |

## Schema Setup

You are responsible for creating tables before querying them. Auth and storage schemas are initialized automatically.

```typescript
const nano = await nanoSupabase()
await nano.db.exec(`
  CREATE TABLE todos (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    done BOOLEAN DEFAULT false,
    user_id UUID REFERENCES auth.users(id)
  );
`)
```

## Key Constraints

- **`@electric-sql/pglite` is a peer dependency** — must be installed separately
- **`pgcrypto` required for auth** — password hashing and UUID generation need this extension
- **Single connection** — PGlite runs one query at a time; the built-in pooler queues concurrent requests
- **No Realtime** — WebSocket subscriptions are not supported
- **No Edge Functions** — Supabase Edge Functions are not supported
- **PostgREST subset** — covers select, insert, update, delete, upsert with filters, ordering, pagination, and embedded resources

## Persistence

```typescript
const supabase = await createClient()                        // ephemeral (default)
const supabase = await createClient({ dataDir: './my-db' }) // filesystem (Node.js / Bun)
// Browser: pass dataDir: 'idb://my-db' for IndexedDB
```

All schemas use `IF NOT EXISTS` — persistent databases are safe to reuse across restarts.

## Auth & RLS

```typescript
await supabase.auth.signUp({ email: 'user@example.com', password: 'password' })
const { data: { session } } = await supabase.auth.signInWithPassword({ email: 'user@example.com', password: 'password' })
```

RLS functions `auth.uid()`, `auth.role()`, and `auth.email()` work as expected once a session is active.

## CLI (nano-supabase)

```bash
npx nano-supabase start                     # HTTP on :54321, Postgres TCP on :5432
npx nano-supabase start --data-dir=./data   # persist to disk
npx nano-supabase start --mcp               # MCP server on /mcp
npx nano-supabase start --detach            # background mode

npx nano-supabase db exec --sql "SELECT * FROM todos"
npx nano-supabase migration new add_todos
npx nano-supabase migration up
npx nano-supabase gen types --output types.ts

# Sync with hosted Supabase project
npx nano-supabase sync push --remote-db-url=<url> --remote-url=<url> --remote-service-role-key=<key>
npx nano-supabase sync pull --remote-db-url=<url> --remote-url=<url> --remote-service-role-key=<key>
```

Environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`.

## MCP Server

The CLI exposes an MCP server on `/mcp` (Streamable HTTP transport) when started with `--mcp`. Powered by `@supabase/mcp-server-supabase`.

To use in Claude Code:

```json
{
  "mcpServers": {
    "nano-supabase": {
      "command": "npx",
      "args": ["nano-supabase", "start", "--mcp", "--detach"]
    }
  }
}
```

Or add to `.claude/settings.json` for project-level MCP access.

## Using in Claude Code Cloud Sessions

When running tasks via Claude Code on the web:

- Use `npx nano-supabase` — Bun's package manager does not work behind the cloud security proxy
- The cloud environment has Node.js LTS and npm pre-installed
- `@electric-sql/pglite` and `nano-supabase` are available via npm
- No external Supabase project is needed — everything runs in-process
- Start the server in **detached mode** so it keeps running in the background while Claude works on the task

Example setup script for a cloud environment (`.claude/setup.sh`):

```bash
#!/bin/bash
npm install
npx nano-supabase start --detach --mcp --data-dir=./.nano-supabase-data
```

`--detach` forks the process and writes a PID file so the server survives beyond the script. `--mcp` exposes the MCP endpoint on `/mcp`. Check status with `npx nano-supabase status`.

## PostgreSQL Wire Protocol

The CLI exposes a Postgres TCP server (port `5432` by default). Connect with any standard Postgres client:

```bash
psql "host=127.0.0.1 port=5432 user=postgres dbname=postgres sslmode=disable"
```

Prisma: `DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres?sslmode=disable`

## Runtimes

**Library**: Node.js, Deno, Bun, browsers, Cloudflare Workers, Vercel Edge. Uses Web Crypto API only.

**CLI**: Node.js 18+ (Bun also supported for local use).
