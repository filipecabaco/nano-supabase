# Nano Supabase

A TypeScript library that provides a Supabase-compatible API running entirely in the browser using [PGlite](https://github.com/electric-sql/pglite) (PostgreSQL compiled to WebAssembly).

## Demo

See [examples/react-demo](examples/react-demo) for a task management app running 100% client-side with full CRUD operations.

```bash
cd examples/react-demo
npm install && npm run dev
```

## Overview

Nano Supabase provides a Supabase-compatible query builder that executes queries against an embedded PostgreSQL database (PGlite) without any network calls. Queries are parsed using a PostgREST parser and executed locally.

**Use cases:**
- Edge runtimes (Cloudflare Workers, Vercel Edge, Deno Deploy)
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
- Core infrastructure complete (priority queue, pooler, TCP server)
- Supabase compatibility layer complete (PostgREST parser, query builder)
- Node.js runtime adapter complete
- 23 passing tests (Deno)

**Planned:**
- Additional runtime adapters (Deno, Bun, Cloudflare Workers)
- Query aging to prevent starvation
- Queue metrics and monitoring

## Quick Start

### Supabase-Compatible API

```typescript
import { createLocalSupabaseClient } from 'nano-supabase'

const supabase = createLocalSupabaseClient({
  schema: `
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `
})

// Use like regular Supabase - runs locally with no network calls
const { data, error } = await supabase
  .from('users')
  .select('*')
  .eq('id', 1)
```

### Lower-Level API (Pooler + TCP Server)

```typescript
import { PGlite } from '@electric-sql/pglite'
import { PGlitePooler, PGliteServer } from 'nano-supabase'

const db = new PGlite()
await db.exec(`CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT)`)

const pooler = new PGlitePooler(db, {
  maxQueueSize: 1000,
  defaultTimeout: 30000
})

const server = new PGliteServer({
  hostname: '127.0.0.1',
  port: 5433,
  pooler
})

await server.start()
// Connect via: nc 127.0.0.1 5433
```

## Core Components

### Priority Queue

Array-based queue with 4 priority levels (CRITICAL, HIGH, MEDIUM, LOW). See [src/queue.ts](src/queue.ts).

### Connection Pooler

Multiplexes N connections to a single PGlite instance with background queue processing and timeout protection. Calls `db.query()` directly to avoid deadlock with PGlite's internal mutex. See [src/pooler.ts](src/pooler.ts).

### TCP Server

Newline-delimited TCP protocol for SQL queries. Send query + `\n`, receive JSON response. See [src/server.ts](src/server.ts).

### Socket Abstraction

WinterCG-compatible socket interface with runtime adapters. Currently supports Node.js. See [src/socket/](src/socket/).

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
import { createLocalSupabaseClient } from 'nano-supabase'

const supabase = createLocalSupabaseClient({
  schema: `CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE);`
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
│   ├── types.ts              # Type definitions
│   ├── queue.ts              # Priority queue
│   ├── pooler.ts             # Connection pooler
│   ├── server.ts             # TCP server
│   ├── socket/               # Socket abstraction
│   │   ├── types.ts
│   │   ├── runtime.ts
│   │   ├── index.ts
│   │   └── adapters/node.ts
│   └── index.ts
├── examples/
│   ├── basic.ts
│   ├── tcp-server.ts
│   └── react-demo/
└── tests/                    # Deno tests
```

## Installation

Not yet published to npm. For development:

```bash
git clone <repo-url>
cd nano-supabase
npm install
npm run build
```

## Development

```bash
# Run examples
npm run example:basic     # Pooler test
npm run example:server    # TCP server

# Run tests
deno test

# Build
npm run build
```

## Testing TCP Server

Terminal 1:
```bash
npm run example:server
```

Terminal 2:
```bash
nc 127.0.0.1 5433
SELECT * FROM users
INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')
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
