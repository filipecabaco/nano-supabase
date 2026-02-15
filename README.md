# Nano Supabase

A TypeScript library that provides a **Supabase-compatible API** running entirely in-process using [PGlite](https://github.com/electric-sql/pglite) (PostgreSQL compiled to WebAssembly). Zero network calls, zero external dependencies.

> **For AI agents and LLMs**: See [AGENTS.md](AGENTS.md) for a structured reference of the API surface, constraints, and integration patterns.

## Installation

```bash
npm install nano-supabase @electric-sql/pglite
```

Or from GitHub:
```bash
pnpm add github:filipecabaco/nano-supabase#main @electric-sql/pglite
```

`@electric-sql/pglite` is a peer dependency and must be installed separately.

## Quick Start

### With `@supabase/supabase-js` (recommended)

nano-supabase works by providing a custom `fetch` that intercepts supabase-js HTTP calls and routes them to a local PGlite database.

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { createClient } from '@supabase/supabase-js'
import { createFetchAdapter } from 'nano-supabase'

const db = new PGlite({ extensions: { pgcrypto } })

// Setup your schema
await db.exec(`CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE);`)

// Create fetch adapter - this intercepts auth, data, and storage routes
const { localFetch } = await createFetchAdapter({ db })

// Create a standard Supabase client pointed at any URL (it never hits the network)
const supabase = createClient('http://localhost:54321', 'local-anon-key', {
  global: { fetch: localFetch }
})

// Use exactly like regular Supabase
const { data } = await supabase.from('users').select('*').eq('id', 1).single()
await supabase.from('users').insert({ name: 'Alice', email: 'alice@example.com' })
await supabase.from('users').update({ name: 'Alice Smith' }).eq('id', 1)
await supabase.from('users').delete().eq('id', 1)
```

> The `pgcrypto` extension is required for auth features (password hashing, UUID generation).

### Without `@supabase/supabase-js`

```typescript
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseClient } from 'nano-supabase'

const db = new PGlite()
const supabase = await createSupabaseClient(db)

const { data } = await supabase.from('users').select('*').eq('id', 1)
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

## Bundle Information

| Bundle | Size | Contents |
|--------|------|----------|
| `dist/index.js` | ~21 KB | Full library (pooler + client + parser) |
| `dist/postgrest_parser_bg.wasm` | ~377 KB | PostgREST query parser |

Modern bundlers tree-shake unused exports automatically.

## Limitations

- **No Realtime** - WebSocket subscriptions are not supported
- **No Edge Functions** - Supabase Edge Functions are not supported
- **Single connection** - PGlite processes one query at a time (the pooler queues concurrent requests)
- **PostgREST subset** - covers the common operations; some advanced PostgREST features may not be implemented

## Runtime Compatibility

Node.js, Deno, Bun, browsers, Cloudflare Workers, Vercel Edge. Uses Web Crypto API only.

## Demo

See [examples/react-demo](examples/react-demo) for a task management app running 100% client-side.

```bash
cd examples/react-demo
pnpm install
pnpm run dev
```

## PostgreSQL Wire Protocol

For `psql`/pgAdmin compatibility, use PGlite's `@pglite/socket` package:

```bash
pnpm add @pglite/socket
pnpm run example:server
psql "host=127.0.0.1 port=5433 user=postgres dbname=template1 sslmode=disable"
```

## Development

```bash
pnpm install
pnpm run build        # esbuild -> dist/
bun test tests/       # run tests
pnpm run example:basic
```

## License

MIT

## Credits

Built with [PGlite](https://github.com/electric-sql/pglite), [PostgREST](https://postgrest.org/), and [native_postgrest_parser](https://github.com/filipecabaco/native_postgrest_parser).
