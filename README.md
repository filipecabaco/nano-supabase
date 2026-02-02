# Nano Supabase

A TypeScript library that provides a Supabase-compatible API running entirely in the browser using [PGlite](https://github.com/electric-sql/pglite) (PostgreSQL compiled to WebAssembly).

## Demo

See [examples/react-demo](examples/react-demo) for a full-featured task management app running 100% client-side with React and Vite.

The demo uses the GitHub package directly and demonstrates:
- Supabase-compatible API usage
- CRUD operations with PostgREST query parsing
- Type-safe queries with TypeScript
- Zero network calls - everything runs in the browser

```bash
cd examples/react-demo
pnpm install  # Installs from github:filipecabaco/nano-supabase#main
pnpm run dev  # Start development server
pnpm run build  # Build for production
```

## Overview

Nano Supabase provides a Supabase-compatible query builder that executes queries against an embedded PostgreSQL database (PGlite) without any network calls. Queries are parsed using a PostgREST parser and executed locally.

**Use cases:**
- Edge runtimes (Cloudflare Workers, Vercel Edge, Deno Deploy, Val.town)
- Local development and testing
- Offline-first applications
- Low-latency local queries
- Webcontainer environments (StackBlitz, CodeSandbox)

**Features:**
- Supabase-JS compatible API
- N-to-1 connection multiplexing for single PGlite instance
- Priority queue system (CRITICAL, HIGH, MEDIUM, LOW)
- PostgREST query parsing via WASM
- TypeScript with full type safety
- Cross-runtime socket abstraction (WinterCG compatible)
- Schema management via SQL strings or ORMs (Drizzle, Kysely)

## Architecture

```
User Code
    ↓
Supabase-compatible Query Builder
    ↓
PostgREST Parser (WASM) → SQL + params
    ↓
Priority Queue (CRITICAL/HIGH/MEDIUM/LOW)
    ↓
Connection Pooler (N-to-1 multiplexing)
    ↓
PGlite (PostgreSQL in WASM)
```

**Current Status:**
- Core infrastructure complete (priority queue, pooler)
- Supabase compatibility layer complete (PostgREST parser, query builder)
- Cross-runtime compatible (Node.js, Deno, Browser)
- 39 passing tests (Deno)

**Planned:**
- Additional runtime adapters (Deno, Bun, Cloudflare Workers)
- Query aging to prevent starvation
- Queue metrics and monitoring

## Quick Start

### Supabase-Compatible API

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { createClient } from '@supabase/supabase-js'
import { createFetchAdapter } from 'nano-supabase'

// Create PGlite instance with pgcrypto extension (required for auth)
const db = new PGlite({ extensions: { pgcrypto } })

// Create fetch adapter with auth support
const { localFetch, authHandler } = await createFetchAdapter({ db })

// Create Supabase client with custom fetch
const supabase = createClient('http://localhost:54321', 'local-anon-key', {
  global: { fetch: localFetch }
})

// Use like regular Supabase - runs locally with no network calls
const { data, error } = await supabase
  .from('users')
  .select('*')
  .eq('id', 1)
```

> **Note**: The `pgcrypto` extension is required for authentication features (password hashing and UUID generation). Always include it when creating your PGlite instance.

### Direct Pooler Usage (Advanced)

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { PGlitePooler, QueryPriority } from 'nano-supabase'

// Create PGlite with pgcrypto (required for auth features)
const db = new PGlite({ extensions: { pgcrypto } })
const pooler = new PGlitePooler(db, { maxQueueSize: 1000 })

await pooler.start()
const result = await pooler.query(
  'SELECT * FROM users WHERE id = $1',
  [1],
  QueryPriority.HIGH
)
await pooler.stop()
```

## Core Components

### Priority Queue

Array-based queue with 4 priority levels (CRITICAL, HIGH, MEDIUM, LOW). See [src/queue.ts](src/queue.ts).

### Connection Pooler

Multiplexes N connections to a single PGlite instance with background queue processing and timeout protection. Calls `db.query()` directly to avoid deadlock with PGlite's internal mutex. See [src/pooler.ts](src/pooler.ts).

### PostgreSQL Wire Protocol Support

For full PostgreSQL compatibility (psql, pgAdmin, etc.), use PGlite's official `@pglite/socket` package which implements the complete wire protocol. See [examples/tcp-server.ts](examples/tcp-server.ts) for an example.

## Implementation Notes

### PGlite Single-Connection Handling

PGlite uses an internal mutex for query execution. The pooler queues requests and calls `db.query()` directly without additional locking to avoid deadlock.

### Cross-Runtime Socket Compatibility

Uses WinterCG-compatible socket abstraction with runtime detection. Currently supports Node.js via adapter pattern with ReadableStream/WritableStream.

### Priority Queue

Simple array-based implementation. Future optimizations may include query aging to prevent starvation and heap-based structure for better performance.

## API Examples

### Supabase-Compatible Client

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { createClient } from '@supabase/supabase-js'
import { createFetchAdapter } from 'nano-supabase'

// Create PGlite with pgcrypto (required for auth)
const db = new PGlite({ extensions: { pgcrypto } })

// Setup schema
await db.exec(`CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE);`)

// Create Supabase client with fetch adapter
const { localFetch } = await createFetchAdapter({ db })
const supabase = createClient('http://localhost:54321', 'local-anon-key', {
  global: { fetch: localFetch }
})

// Select
const { data } = await supabase.from('users').select('*').eq('id', 1).single()

// Insert
await supabase.from('users').insert({ name: 'Alice', email: 'alice@example.com' })

// Update
await supabase.from('users').update({ name: 'Alice Smith' }).eq('id', 1)

// Delete
await supabase.from('users').delete().eq('id', 1)
```

### Direct Pooler Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { PGlitePooler, QueryPriority } from 'nano-supabase'

const db = new PGlite()
const pooler = new PGlitePooler(db, { maxQueueSize: 1000 })

await pooler.start()
const result = await pooler.query(
  'SELECT * FROM users WHERE id = $1',
  [1],
  QueryPriority.HIGH
)
```

## Project Structure

```
nano-supabase/
├── src/
│   ├── index.ts              # Main exports
│   ├── supabase-client.ts    # Supabase-compatible client
│   ├── postgrest-parser.ts   # PostgREST → SQL parser
│   ├── types.ts              # Type definitions
│   ├── queue.ts              # Priority queue
│   └── pooler.ts             # Connection pooler
├── dist/                     # Built bundles (git-distributable)
├── scripts/build.js          # esbuild bundler
├── examples/
│   ├── basic.ts              # Pooler example
│   ├── tcp-server.ts         # @pglite/socket server example
│   ├── valtown-chat-api.ts   # Val.town HTTP API example
│   └── react-demo/           # Full React application
└── tests/                    # Deno tests
```

## Installation

Install directly from GitHub - no npm/jsr publication needed. All dependencies are bundled into optimized ESM files.

**Package Managers (Node.js/Bun/etc):**
```bash
pnpm add github:filipecabaco/nano-supabase#main
pnpm add @electric-sql/pglite
```

**Deno:**
```typescript
import { createSupabaseClient } from "https://raw.githubusercontent.com/filipecabaco/nano-supabase/main/dist/index.js"
import { PGlite } from "npm:@electric-sql/pglite"
```

**Browser/Vite/Webpack:**
```typescript
// Modern bundlers automatically tree-shake unused code
import { createSupabaseClient } from 'nano-supabase'
import { PGlite } from '@electric-sql/pglite'
```

**Val.town:**
```typescript
import { PGlite } from "npm:@electric-sql/pglite";
import { createSupabaseClient } from "https://raw.githubusercontent.com/filipecabaco/nano-supabase/main/dist/index.js";

const db = new PGlite();
const supabase = await createSupabaseClient(db);
```

See [examples/valtown-chat-api.ts](examples/valtown-chat-api.ts) for a complete HTTP API example, or try the [live demo on Val.town](https://www.val.town/x/filipecabaco/nano-supabase-chat).

### Bundle Information

The package includes a pre-built ESM bundle with all dependencies bundled (except PGlite):

| Bundle | Size | Contents | Use Case |
|--------|------|----------|----------|
| `dist/index.js` | ~21 KB | Full library (pooler + client + parser) | All runtimes (Node.js, Deno, Bun, Browser) |
| `dist/postgrest_parser_bg.wasm` | ~377 KB | PostgREST query parser | Included automatically |

Modern bundlers (Vite, Webpack, esbuild) automatically tree-shake unused exports. If you only import `createSupabaseClient`, the pooler code won't be included in your final bundle.

## Development

```bash
# Install dependencies
pnpm install

# Build bundles (creates dist/ with bundled JS + WASM)
pnpm run build

# Run examples
pnpm run example:basic     # Pooler test
pnpm run example:server    # TCP server

# Run tests (requires read/env permissions for PGlite)
deno test --allow-read --allow-env

# Clean build
pnpm run clean
```

### Build Process

The build script ([scripts/build.js](scripts/build.js)) creates a single-file ESM bundle:
1. Bundles all dependencies using esbuild (except PGlite and Node.js built-ins)
2. Copies the PostgREST parser WASM file to dist/
3. Generates TypeScript declarations
4. Relies on bundler tree-shaking for optimal bundle sizes

## PostgreSQL Wire Protocol Server

To run a full PostgreSQL-compatible server that works with `psql`, install `@pglite/socket`:

```bash
pnpm add @pglite/socket
pnpm run example:server
```

Then connect with any PostgreSQL client:
```bash
psql "host=127.0.0.1 port=5433 user=postgres dbname=template1 sslmode=disable"
```

## Contributing

Contributions welcome. Current focus areas:
- Runtime adapters (Deno, Bun, Cloudflare Workers)
- Documentation and examples
- Performance testing

## License

MIT

## Credits

Built with [PGlite](https://github.com/electric-sql/pglite), [PostgREST](https://postgrest.org/), and [native_postgrest_parser](https://github.com/filipecabaco/native_postgrest_parser).
