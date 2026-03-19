# Nano Supabase

A TypeScript library that provides a **Supabase-compatible API** running entirely in-process using [PGlite](https://github.com/electric-sql/pglite) (PostgreSQL compiled to WebAssembly). Zero network calls, zero external dependencies.

> **For AI agents and LLMs**: See [AGENTS.md](AGENTS.md) for a structured reference of the API surface, constraints, and integration patterns.

## Installation

### As a library

```bash
bun add github:filipecabaco/nano-supabase @electric-sql/pglite
```

`@electric-sql/pglite` is a peer dependency and must be installed separately.

### As a CLI

Install globally:

```bash
npm install -g nano-supabase
nano-supabase start
```

Or run without installing:

```bash
npx nano-supabase start
```

## Quick Start

### Simplest usage

```typescript
import { createClient } from 'nano-supabase'

const supabase = await createClient()

await supabase.from('users').insert({ name: 'Alice', email: 'alice@example.com' })
const { data } = await supabase.from('users').select('*').eq('id', 1).single()
```

`createClient` is a drop-in replacement for `@supabase/supabase-js`'s `createClient` — no URL, no project, no network.

### With an existing PGlite instance

If you need to share a PGlite instance or configure it yourself:

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { createClient } from '@supabase/supabase-js'
import { nanoSupabase } from 'nano-supabase'

const nano = await nanoSupabase({
  extensions: { pgcrypto },
})

// Run schema setup
await nano.db.exec(`CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE);`)

// Use with @supabase/supabase-js
const supabase = createClient('http://localhost:54321', 'local-anon-key', {
  global: { fetch: nano.localFetch }
})

const { data } = await supabase.from('users').select('*').eq('id', 1).single()
await supabase.from('users').insert({ name: 'Alice', email: 'alice@example.com' })
await supabase.from('users').update({ name: 'Alice Smith' }).eq('id', 1)
await supabase.from('users').delete().eq('id', 1)
```

## What Gets Intercepted

The fetch adapter routes by URL path:

| Path | Handler | What it does |
|------|---------|-------------|
| `/auth/v1/*` | AuthHandler | signup, signin, signout, token refresh, JWT sessions |
| `/rest/v1/*` | PostgREST Parser | select, insert, update, delete, upsert with full filter support |
| `/storage/v1/*` | StorageHandler | bucket CRUD, object upload/download, signed URLs |

## Use Cases

- **AI agents** that need a local database without running a server
- **Edge runtimes** (Cloudflare Workers, Vercel Edge, Deno Deploy, Val.town)
- **Local development and testing** against a real Postgres engine
- **Offline-first applications** with zero latency
- **Webcontainer environments** (StackBlitz, CodeSandbox)

## Auth

```typescript
await supabase.auth.signUp({ email: 'user@example.com', password: 'password' })
const { data: { session } } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password'
})
// JWT now in session, RLS policies are enforced
```

RLS functions `auth.uid()`, `auth.role()`, and `auth.email()` work as expected.

## Storage

```typescript
await supabase.storage.from('avatars').upload('photo.png', blob)
const { data } = await supabase.storage.from('avatars').download('photo.png')
const { data: { signedUrl } } = await supabase.storage
  .from('avatars')
  .createSignedUrl('photo.png', 3600)
```

Default backend is in-memory. Implement the `StorageBackend` interface for persistence.

## CLI

The CLI starts a full Supabase-compatible server locally and provides tooling to manage it.

```bash
nano-supabase start                    # start server (HTTP + Postgres TCP)
nano-supabase start --data-dir=./data  # persist to disk
nano-supabase start --mcp              # also expose MCP server on /mcp
nano-supabase start --detach           # run in background
nano-supabase stop                     # stop detached server
nano-supabase status                   # check if server is running
```

### Database

```bash
nano-supabase db exec --sql "SELECT * FROM users"
nano-supabase db exec --file migration.sql
nano-supabase db dump
nano-supabase db reset --confirm
```

### Migrations

```bash
nano-supabase migration new add_users_table
nano-supabase migration list
nano-supabase migration up
```

Migration files live in `./supabase/migrations/` by default. Compatible with the Supabase CLI migration format.

### Users

```bash
nano-supabase users list
nano-supabase users create --email user@example.com --password secret
nano-supabase users get <id>
nano-supabase users delete <id> --confirm
```

### Storage

```bash
nano-supabase storage list-buckets
nano-supabase storage create-bucket avatars
nano-supabase storage ls avatars
nano-supabase storage cp ./photo.png avatars://photo.png
nano-supabase storage cp avatars://photo.png ./photo.png
```

### Type Generation

```bash
nano-supabase gen types
nano-supabase gen types --output types.ts
```

Generates TypeScript types from the current database schema, compatible with `@supabase/supabase-js` typed clients.

### Sync

Sync migrations between a local nano-supabase instance and a remote Supabase project (hosted or Supabase CLI local stack).

```bash
# Push local migrations to a remote project
nano-supabase sync push --remote-db-url=postgresql://postgres:password@db.project.supabase.co:5432/postgres

# Pull remote schema into local instance
nano-supabase sync pull --remote-db-url=postgresql://postgres:password@db.project.supabase.co:5432/postgres

# Preview without applying
nano-supabase sync push --dry-run --remote-db-url=<url>
```

**Push** applies local migration files to the remote via a direct Postgres connection. It detects or creates `supabase_migrations.schema_migrations` on the remote and records each applied migration. Also syncs local storage buckets to `storage.buckets`.

**Pull** reads remote migrations from `supabase_migrations.schema_migrations` (writing each as a separate file) or falls back to a full schema dump via `pg_dump` if that table is absent or empty. Also pulls remote storage buckets into the local instance. Pull only writes files to `supabase/migrations/` — run `nano-supabase migration up` afterwards to apply them locally.

Environment variable: `SUPABASE_DB_URL` (substitutes `--remote-db-url`).

### MCP Server

```bash
nano-supabase start --mcp
```

Starts an MCP (Model Context Protocol) server on `/mcp` using Streamable HTTP transport. Powered by `@supabase/mcp-server-supabase`, it exposes database operations to MCP-compatible AI clients (Claude, Cursor, etc.) with no network round-trips.

### Start Options

| Flag | Default | Description |
|------|---------|-------------|
| `--data-dir=<path>` | in-memory | Persistence directory |
| `--http-port=<port>` | `54321` | HTTP API port |
| `--tcp-port=<port>` | `5432` | Postgres wire protocol port |
| `--service-role-key=<key>` | `local-service-role-key` | Admin key |
| `--detach` | — | Run in background |
| `--mcp` | — | Enable MCP server on `/mcp` |
| `--json` | — | Output JSON instead of human-readable text |

## Architecture

```
@supabase/supabase-js (or standalone client)
  -> Fetch Adapter (routes by URL path)
     /auth/v1/*    -> AuthHandler (JWT via Web Crypto)
     /rest/v1/*    -> PostgREST Parser (WASM) -> SQL
     /storage/v1/* -> StorageHandler
  -> Priority Queue (CRITICAL / HIGH / MEDIUM / LOW)
  -> Connection Pooler (N-to-1 multiplexing)
  -> PGlite (PostgreSQL in WebAssembly)

CLI Server (nano-supabase start)
  -> HTTP on --http-port
     /auth/v1/*          -> AuthHandler
     /rest/v1/*          -> PostgREST Parser
     /storage/v1/*       -> StorageHandler
     /admin/v1/*         -> Admin API (SQL, migrations, reset)
     /v1/projects/:ref/* -> Supabase Management API shim
     /mcp                -> MCP server (Streamable HTTP)
  -> TCP server (Postgres wire protocol)
```

## Advanced: Direct Pooler Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { PGlitePooler, QueryPriority } from 'nano-supabase'

const db = new PGlite()
const pooler = new PGlitePooler(db, { maxQueueSize: 1000 })

await pooler.start()
const result = await pooler.query('SELECT * FROM users WHERE id = $1', [1], QueryPriority.HIGH)
await pooler.stop()
```

## Persistence

By default PGlite runs in-memory — all data is lost when the process exits. Pass a path to `PGlite` to persist to disk or IndexedDB:

```typescript
// Ephemeral (default)
const db = new PGlite()

// Filesystem persistence — Node.js / Bun
const db = new PGlite('./my-local-db')

// IndexedDB persistence — Browser
const db = new PGlite('idb://my-local-db')
```

Schemas created by nano-supabase use `IF NOT EXISTS`, so persistent databases are safe to reuse across restarts.

## PostgreSQL Wire Protocol (Prisma, psql, pgAdmin)

The CLI exposes a Postgres TCP server on port `5432` by default. Any PostgreSQL client can connect without driver changes.

```bash
psql "host=127.0.0.1 port=5432 user=postgres dbname=postgres sslmode=disable"
```

Set `DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres?sslmode=disable` for Prisma and run `prisma generate` as normal. See `examples/prisma-tcp.ts` for a full example.

## Bundle Information

| Bundle | Size | Contents |
|--------|------|----------|
| `dist/index.js` | ~21 KB | Full library (pooler + client + parser) |
| `dist/postgrest_parser_bg.wasm` | ~377 KB | PostgREST query parser |

Modern bundlers tree-shake unused exports automatically.

## Vite Configuration

When using nano-supabase in a Vite project, exclude PGlite from dependency pre-bundling:

```typescript
// vite.config.ts
export default defineConfig({
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
})
```

Vite's dev server pre-bundles dependencies with esbuild, which breaks PGlite's WASM asset resolution via `import.meta.url`. This only affects the dev server — production builds work without this config.

## Limitations

- **No Realtime** — WebSocket subscriptions are not supported
- **No Edge Functions** — Supabase Edge Functions are not supported
- **Single connection** — PGlite processes one query at a time (the pooler queues concurrent requests)
- **PostgREST subset** — covers common operations; some advanced PostgREST features may not be implemented

## Runtime Compatibility

**Library**: Node.js, Deno, Bun, browsers, Cloudflare Workers, Vercel Edge. Uses Web Crypto API only.

**CLI**: Node.js 18+ required (Bun also supported). Works anywhere `npm install -g` runs, including Claude Code cloud containers.

## Demo

See [examples/react-demo](examples/react-demo) for a task management app running 100% client-side.

```bash
cd examples/react-demo
npm install
npm run dev
```

> Note: The demo uses Vite and standard npm scripts. In Claude Code cloud environments, use `npm install` rather than `bun install` — Bun's package manager does not work correctly behind the cloud security proxy.

## Development

```bash
bun install
node scripts/build.js
bun test tests/
bun run example:basic
bun run example:server
bun run prisma:generate
bun run example:prisma
```

## License

MIT

## Credits

Built with [PGlite](https://github.com/electric-sql/pglite), [PostgREST](https://postgrest.org/), and [native_postgrest_parser](https://github.com/filipecabaco/native_postgrest_parser).
