# Nano Supabase

A lightweight Supabase-compatible client for [PGlite](https://github.com/electric-sql/pglite) - run PostgreSQL entirely in the browser/edge with zero network calls.

## Installation

Import directly from git - no npm/jsr publication needed:

**Deno:**
```typescript
import { createSupabaseClient } from "https://raw.githubusercontent.com/filipecabaco/nano-supabase/main/dist/index.js"
import { PGlite } from "npm:@electric-sql/pglite"
```

**Bun:**
```typescript
import { createSupabaseClient } from "github:filipecabaco/nano-supabase/dist/index.js"
import { PGlite } from "@electric-sql/pglite"
```

**Node.js / Cloudflare Workers:**
```bash
# Clone and import locally, or use a git dependency
pnpm add github:filipecabaco/nano-supabase
pnpm add @electric-sql/pglite
```

### Bundle Sizes

| Bundle | Size | Use Case |
|--------|------|----------|
| `dist/index.js` | **~26 KB** | Full library (client, pooler, server, sockets) |
| `dist/slim.js` | **~20 KB** | Minimal (Supabase client + parser only) |

All dependencies bundled except PGlite (you provide as peer dependency).

## Quick Start

```typescript
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseClient } from 'nano-supabase'

// Create PGlite instance
const db = new PGlite()

// Initialize schema
await db.exec(`
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT NOW()
  );
`)

// Create Supabase-compatible client
const supabase = await createSupabaseClient(db)

// Use like regular Supabase - runs locally with no network calls
const { data, error } = await supabase
  .from('users')
  .select('*')
  .eq('id', 1)
```

## Demo

See [examples/react-demo](examples/react-demo) for a task management app running 100% client-side.

```bash
cd examples/react-demo
pnpm install && pnpm run dev
```

## Overview

Nano Supabase provides a Supabase-compatible query builder that executes queries against an embedded PostgreSQL database (PGlite) without any network calls. Queries are parsed using a PostgREST parser (WASM) and executed locally.

**Use cases:**
- Edge runtimes (Cloudflare Workers, Vercel Edge, Deno Deploy)
- WebContainers (StackBlitz, CodeSandbox)
- Offline-first applications
- Local development and testing
- Low-latency local queries

**Features:**
- Supabase-JS compatible API (`from`, `select`, `insert`, `update`, `delete`, `eq`, `order`, etc.)
- N-to-1 connection multiplexing for single PGlite instance
- Priority queue system (CRITICAL, HIGH, MEDIUM, LOW)
- PostgREST query parsing via WASM
- TypeScript with full type safety
- Cross-runtime socket abstraction (WinterCG compatible)

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

## API Examples

### CRUD Operations

```typescript
import { PGlite } from '@electric-sql/pglite'
import { createSupabaseClient } from 'nano-supabase'

const db = new PGlite()
await db.exec(`CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE)`)

const supabase = await createSupabaseClient(db)

// Select with filters
const { data } = await supabase
  .from('users')
  .select('id, name, email')
  .eq('id', 1)
  .single()

// Insert
await supabase
  .from('users')
  .insert({ name: 'Alice', email: 'alice@example.com' })

// Update
await supabase
  .from('users')
  .update({ name: 'Alice Smith' })
  .eq('id', 1)

// Delete
await supabase
  .from('users')
  .delete()
  .eq('id', 1)

// Order and limit
const { data: recent } = await supabase
  .from('users')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(10)
```

### Direct Pooler Usage

For advanced use cases with priority control:

```typescript
import { PGlite } from '@electric-sql/pglite'
import { PGlitePooler, QueryPriority } from 'nano-supabase'

const db = new PGlite()
const pooler = new PGlitePooler(db, { maxQueueSize: 1000 })

await pooler.start()

// Execute with priority
const result = await pooler.query(
  'SELECT * FROM users WHERE id = $1',
  [1],
  QueryPriority.HIGH  // CRITICAL=0, HIGH=1, MEDIUM=2, LOW=3
)

await pooler.stop()
```

### TCP Server

Expose PGlite over TCP for external connections:

```typescript
import { PGlite } from '@electric-sql/pglite'
import { PGlitePooler, PGliteServer } from 'nano-supabase'

const db = new PGlite()
await db.exec(`CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT)`)

const pooler = new PGlitePooler(db)
const server = new PGliteServer({
  hostname: '127.0.0.1',
  port: 5433,
  pooler
})

await server.start()
// Connect via: nc 127.0.0.1 5433
// Send: SELECT * FROM users
// Receive: JSON response
```

## Project Structure

```
nano-supabase/
├── src/
│   ├── index.ts              # Main exports
│   ├── slim.ts               # Minimal exports (client only)
│   ├── supabase-client.ts    # Supabase-compatible client
│   ├── postgrest-parser.ts   # PostgREST → SQL parser
│   ├── types.ts              # Type definitions
│   ├── queue.ts              # Priority queue
│   ├── pooler.ts             # Connection pooler
│   ├── server.ts             # TCP server
│   └── socket/               # Cross-runtime socket abstraction
├── dist/                     # Built bundles (git-distributable)
├── scripts/build.js          # esbuild bundler
├── examples/
│   ├── basic.ts
│   ├── tcp-server.ts
│   └── react-demo/
└── tests/                    # Deno tests
```

## Development

```bash
# Install dependencies
pnpm install

# Build (creates dist/)
pnpm run build

# Run examples
pnpm run example:basic     # Pooler test
pnpm run example:server    # TCP server

# Run tests
deno test

# Clean build
pnpm run clean
```

## Exports

### Main (`nano-supabase`)

```typescript
// Supabase client
export { createSupabaseClient, SupabaseClient, QueryBuilder }

// PostgREST parser
export { PostgrestParser, ParsedQuery }

// Pooler & Server
export { PGlitePooler, PGliteServer, PriorityQueue }
export { QueryPriority, PoolerConfig, QueryResult }

// Socket abstraction
export { connect, listen, RUNTIME, detectRuntime }
export { isNode, isDeno, isBun, isWorkerd }
```

### Slim (`nano-supabase/slim`)

```typescript
// Client only - smaller bundle for edge
export { createSupabaseClient, SupabaseClient, QueryBuilder }
export { PostgrestParser, ParsedQuery }
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
