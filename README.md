# Nano Supabase

A TypeScript library that emulates a local Supabase experience by allowing `supabase-js` connections to be transparently routed to an embedded [PGlite](https://github.com/electric-sql/pglite) instance, featuring N-to-1 connection multiplexing with priority queues.

## Overview

Nano Supabase lets you use the familiar `supabase-js` API locally without any external dependencies or HTTP roundtrips. It intercepts Supabase Data API requests, parses PostgREST queries, and executes them against an embedded PGlite (PostgreSQL in WebAssembly) instance with intelligent query prioritization.

**Perfect for:**
- 🚀 Edge runtimes (Cloudflare Workers, Vercel Edge, Deno Deploy)
- 🧪 Local development and testing
- 📦 Offline-first applications
- ⚡ Lightning-fast local queries (no network overhead)

### Key Features

- **Supabase-JS Compatible**: Use the official `supabase-js` client without modifications
- **N-to-1 Connection Multiplexing**: Multiple connections to a single PGlite instance
- **Priority Queue System**: Configurable priority levels for query execution (CRITICAL → HIGH → MEDIUM → LOW)
- **PostgREST Query Parsing**: Uses `native_postgrest_parser` WASM to parse RESTful queries
- **PGlite Backend**: Embedded PostgreSQL compiled to WebAssembly (3MB gzipped)
- **TypeScript Native**: Full type safety and modern async/await patterns
- **Cross-Runtime Socket Abstraction**: WinterCG-compatible sockets for Node.js, Deno, Bun, Cloudflare Workers
- **Schema Management**: Provide schema as SQL string or via ORM (Drizzle, Kysely)
- **ORM Support**: Direct PGlite or TCP socket connections for your favorite ORMs

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    User Application Code                         │
│             const { data } = await supabase                      │
│               .from('users').select('*').eq('id', 1)             │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Nano Supabase Wrapper (Phase 6 - Future)            │
│  - Intercepts supabase-js HTTP fetch() calls                     │
│  - Detects PostgREST Data API requests                           │
│  - Routes to local parser instead of external HTTP              │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│         PostgREST Parser (native_postgrest_parser WASM)          │
│  Input:  "users?select=id,name&id=eq.1"                         │
│  Output: { sql: "SELECT id, name FROM users WHERE id = $1",     │
│            params: [1] }                                         │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     TCP Server (Current MVP)                     │
│  - Cross-runtime socket abstraction (WinterCG)                   │
│  - Node.js, Deno, Bun, Cloudflare Workers adapters              │
│  - Newline-delimited protocol                                    │
│  - JSON responses                                                │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Priority Queue (Current MVP)                 │
│  ┌───────────┐  ┌────────────┐  ┌────────────┐  ┌───────────┐  │
│  │ CRITICAL  │  │    HIGH    │  │   MEDIUM   │  │    LOW    │  │
│  │  Queue    │  │   Queue    │  │   Queue    │  │   Queue   │  │
│  └─────┬─────┘  └──────┬─────┘  └──────┬─────┘  └─────┬─────┘  │
│        └────────────────┴────────────────┴──────────────┘        │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                Connection Pooler (Current MVP)                   │
│  - N-to-1 connection multiplexing                                │
│  - Background queue processor                                    │
│  - Query timeout protection                                      │
│  - Async query execution                                         │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PGlite Instance                             │
│  - Embedded PostgreSQL (WASM)                                    │
│  - Single-connection with internal mutex                         │
│  - In-memory or persistent (fs/IndexedDB/OPFS)                  │
│  - Full PostgreSQL feature set                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Current Implementation Status

✅ **MVP Complete (Phases 1-4)**
- Priority queue with 4 levels (CRITICAL, HIGH, MEDIUM, LOW)
- N-to-1 connection pooler with timeout support
- TCP server with cross-runtime socket abstraction
- WinterCG-compatible socket interface (Node.js adapter complete)

🚧 **In Progress (Phase 5)**
- Query aging mechanism to prevent starvation
- Queue metrics and monitoring

📋 **Planned (Phase 6)**
- Supabase-js wrapper and HTTP request interception
- PostgREST query parser integration
- Schema management (SQL string or ORM)
- Additional runtime adapters (Deno, Bun, Cloudflare Workers)

## Quick Start

### Current MVP Usage (Phases 1-4 Complete)

```typescript
import { PGlite } from '@electric-sql/pglite'
import { PGlitePooler } from 'nano-supabase'
import { PGliteServer } from 'nano-supabase'

// Create PGlite instance
const db = new PGlite()

// Set up your schema
await db.exec(`
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE
  )
`)

// Create pooler with config
const pooler = new PGlitePooler(db, {
  maxQueueSize: 1000,
  defaultTimeout: 30000
})

// Create TCP server
const server = new PGliteServer({
  hostname: '127.0.0.1',
  port: 5433,
  pooler
})

await server.start()

// Now connect with any PostgreSQL client:
// nc 127.0.0.1 5433
// echo "SELECT * FROM users" | nc 127.0.0.1 5433
```

### Target API (Phase 6 - Future)

```typescript
import { createLocalSupabaseClient } from 'nano-supabase'

// Create a Supabase-compatible client
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

// Use exactly like regular Supabase - all queries run locally!
const { data, error } = await supabase
  .from('users')
  .select('*')
  .eq('id', 1)

// No HTTP roundtrip, no network latency, no external dependencies
console.log(data) // [{ id: 1, name: 'Alice', email: 'alice@example.com', ... }]
```

### With ORM Support (Phase 6 - Future)

```typescript
import { createLocalSupabaseClient } from 'nano-supabase'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from './schema'

// Option 1: Use Drizzle ORM with automatic schema
const supabase = createLocalSupabaseClient({
  drizzle: { schema }
})

// Option 2: Direct ORM access to underlying PGlite
const db = drizzle(supabase.pglite, { schema })

const users = await db.select().from(schema.users).where(eq(schema.users.id, 1))
```

## Core Components (Current Implementation)

### 1. Priority Queue ([src/queue.ts](src/queue.ts))

Simple array-based priority queue with 4 levels.

```typescript
enum QueryPriority {
  CRITICAL = 0,
  HIGH = 1,
  MEDIUM = 2,
  LOW = 3
}

class PriorityQueue {
  enqueue(query: QueuedQuery): void
  dequeue(): QueuedQuery | null  // Returns highest priority query
  size(): number
  isEmpty(): boolean
}
```

### 2. Connection Pooler ([src/pooler.ts](src/pooler.ts))

N-to-1 connection multiplexing with background queue processor.

```typescript
class PGlitePooler {
  constructor(db: PGlite, config?: PoolerConfig)

  async start(): Promise<void>  // Start queue processor
  async stop(): Promise<void>   // Stop gracefully

  async query(
    sql: string,
    params?: unknown[],
    priority?: QueryPriority
  ): Promise<QueryResult>  // Submit query, returns promise
}
```

**Key implementation details:**
- Background queue processor using `while(this.running)` loop
- Timeout protection via `Promise.race()`
- **Critical:** Calls `db.query()` directly (no `runExclusive()` wrapper to avoid deadlock)

### 3. TCP Server ([src/server.ts](src/server.ts))

Simple TCP server with newline-delimited protocol.

```typescript
class PGliteServer {
  constructor(config: ServerConfig)

  async start(): Promise<void>  // Start pooler and TCP server
  async stop(): Promise<void>   // Stop gracefully

  getClients(): readonly string[]  // Get connected client IDs
}
```

**Protocol:**
- Send: SQL query + `\n`
- Receive: JSON response + `\n`
- Response format: `{ status: 'success' | 'error', rows, rowCount, fields }`

### 4. Socket Abstraction ([src/socket/](src/socket/))

WinterCG-compatible socket interface for cross-runtime support.

```typescript
interface UniversalSocket {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>
  readonly opened: Promise<SocketInfo>
  readonly closed: Promise<void>
  close(): Promise<void>
}
```

**Runtime adapters:**
- ✅ Node.js ([src/socket/adapters/node.ts](src/socket/adapters/node.ts)) - Complete
- 📋 Deno - Planned
- 📋 Bun - Planned
- 📋 Cloudflare Workers - Planned

## Implementation Plan

See [PLAN.md](./PLAN.md) for the complete implementation roadmap.

### Phase 1: Project Setup ✅ **COMPLETE**

- TypeScript project with strict mode
- PGlite dependency installed
- ES modules configuration
- Build scripts and examples

### Phase 2: PGlite Experimentation ✅ **COMPLETE**

- Tested PGlite concurrent query behavior
- Verified internal mutex implementation
- Performance baseline measurements
- Transaction testing

### Phase 3: Core Connection Pooler ✅ **COMPLETE**

**Files:**
- `src/types.ts` - Type definitions (avoiding `any`, using `readonly`)
- `src/queue.ts` - Priority queue implementation
- `src/pooler.ts` - N-to-1 connection pooler
- `examples/basic.ts` - Pooler test suite

**Critical fix:** Removed `runExclusive()` wrapper to avoid deadlock (PGlite's `query()` already handles mutex internally)

### Phase 4: TCP Server & Socket Abstraction ✅ **COMPLETE**

**Files:**
- `src/socket/types.ts` - WinterCG socket interface definitions
- `src/socket/runtime.ts` - Runtime detection (Node.js, Deno, Bun, Cloudflare)
- `src/socket/adapters/node.ts` - Node.js socket adapter (net → UniversalSocket)
- `src/socket/index.ts` - Socket factory with runtime selection
- `src/server.ts` - PGliteServer with newline-delimited protocol
- `examples/tcp-server.ts` - TCP server example

**Critical fix:** Server-side socket `opened` promise resolution (check if already connected)

**Protocol:**
- Newline-delimited SQL queries
- JSON responses with status, rows, fields
- Client connection logging

### Phase 5: Enhanced Priority Queue 📋 **PLANNED**

**Goal:** Add smarter priority handling and observability

- Query aging mechanism (prevent starvation)
- Queue metrics and monitoring
- Weighted round-robin scheduling
- Performance benchmarks

### Phase 6: Supabase-JS Compatibility Layer 📋 **PLANNED**

**Goal:** Emulate Supabase experience with `supabase-js` client

**Sub-phases:**
- **6A: PostgREST Parser** - Integrate `native_postgrest_parser` WASM
- **6B: Supabase-JS Wrapper** - HTTP request interception and routing
- **6C: Schema Management** - SQL string or ORM-based schema
- **6D: ORM Integration** - Drizzle, Kysely, Prisma support

**Target API:**
```typescript
const supabase = createLocalSupabaseClient({ schema: '...' })
const { data } = await supabase.from('users').select('*')
// → Runs locally: supabase-js → wrapper → parser → pooler → PGlite
```

See [PLAN.md Phase 6](./PLAN.md#phase-6-supabase-js-compatibility-layer-week-2) for detailed architecture.

## Technical Considerations

### 1. PGlite Single-Connection Constraint ✅ **SOLVED**

**Challenge:** PGlite is single-connection and uses internal mutex.

**Solution:**
- ✅ Application-level N-to-1 connection pooling via priority queue
- ✅ Call `db.query()` directly (it already handles mutex internally)
- ❌ **DO NOT** wrap in `runExclusive()` (causes deadlock!)
- Queue queries from multiple clients and execute serially

### 2. Cross-Runtime Socket Compatibility ✅ **IMPLEMENTED**

**Challenge:** Different runtimes have different socket APIs.

**Solution:**
- ✅ WinterCG-compatible socket abstraction
- ✅ Runtime detection (Node.js, Deno, Bun, Cloudflare Workers)
- ✅ Adapter pattern with `ReadableStream`/`WritableStream`
- 🚧 Node.js adapter complete, others planned

### 3. Priority Queue Fairness 📋 **PLANNED (Phase 5)**

**Challenge:** Prevent starvation of low-priority queries.

**Planned solutions:**
- Aging mechanism (boost priority over time)
- Weighted round-robin scheduling
- Maximum wait time per priority level
- Queue metrics and monitoring

### 4. Supabase-JS Interception 📋 **PLANNED (Phase 6)**

**Challenge:** Intercept HTTP calls without modifying `supabase-js`.

**Planned approaches:**
1. **Custom Fetch Wrapper** - Override `fetch` in client options
2. **Proxy Pattern** - Intercept `.from()`, `.select()`, etc.
3. **Local REST API** - Minimal PostgREST-compatible HTTP server

### 5. PostgREST Query Parsing 📋 **PLANNED (Phase 6)**

**Challenge:** Parse PostgREST query syntax to SQL.

**Solution:**
- Use `native_postgrest_parser` WASM module
- Handle filters, ordering, pagination, joins, aggregations
- Generate parameterized SQL queries
- Return results in Supabase-compatible format

### 6. Performance Considerations

**Current:**
- Simple array-based priority queue (sufficient for MVP)
- Timeout protection via `Promise.race()`
- Configurable queue size and timeouts

**Future optimizations:**
- Heap-based priority queue for O(log n) operations
- Query result caching
- Connection pooling metrics
- Batch query optimization

## API Examples

### Current API (Phases 1-4)

```typescript
import { PGlite } from '@electric-sql/pglite'
import { PGlitePooler, PGliteServer, QueryPriority } from 'nano-supabase'

// Create database and schema
const db = new PGlite()
await db.exec(`CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT)`)

// Create pooler
const pooler = new PGlitePooler(db, {
  maxQueueSize: 1000,
  defaultTimeout: 30000
})

// Direct pooler usage
await pooler.start()
const result = await pooler.query(
  'SELECT * FROM users WHERE id = $1',
  [1],
  QueryPriority.HIGH
)
console.log(result.rows)

// Or create TCP server
const server = new PGliteServer({
  hostname: '127.0.0.1',
  port: 5433,
  pooler
})
await server.start()

// Connect via TCP
// nc 127.0.0.1 5433
// SELECT * FROM users
```

### Future API (Phase 6 - Supabase Compatible)

```typescript
import { createLocalSupabaseClient } from 'nano-supabase'

// Create Supabase-compatible client
const supabase = createLocalSupabaseClient({
  schema: `
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE
    );
  `
})

// Use standard Supabase API - runs locally!
const { data, error } = await supabase
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
```

## Development Roadmap

### ✅ Milestone 1: Core MVP (Complete)
- [x] TypeScript project setup with strict mode
- [x] Priority queue implementation (CRITICAL, HIGH, MEDIUM, LOW)
- [x] N-to-1 connection pooler with timeout support
- [x] Cross-runtime socket abstraction (WinterCG)
- [x] TCP server with Node.js adapter
- [x] Integration tests (pooler + TCP server)

### 🚧 Milestone 2: Enhanced Pooling (In Progress)
- [ ] Query aging mechanism
- [ ] Queue metrics and monitoring
- [ ] Additional runtime adapters (Deno, Bun, Cloudflare Workers)
- [ ] Stress testing and benchmarks

### 📋 Milestone 3: Supabase Compatibility (Planned)
- [ ] PostgREST parser WASM integration
- [ ] Supabase-js wrapper with HTTP interception
- [ ] Schema management (SQL string + ORM)
- [ ] ORM support (Drizzle, Kysely, Prisma)
- [ ] Comprehensive examples

### 📋 Milestone 4: Production Ready (Future)
- [ ] Error recovery and retry logic
- [ ] Performance optimization
- [ ] Security and authentication
- [ ] Comprehensive documentation
- [ ] Deployment guides for edge runtimes

## Testing Strategy

### Unit Tests
- Priority queue operations
- Query parser edge cases
- Wire protocol message parsing
- Session management

### Integration Tests
- End-to-end query flow
- Multi-client scenarios
- Priority queue ordering
- Error recovery

### Performance Tests
- Query throughput benchmarks
- Queue latency measurements
- Connection overhead analysis
- Memory profiling

### Compatibility Tests
- PostgreSQL client compatibility (psql, pg, node-postgres)
- PostgREST query syntax coverage
- PGlite version compatibility

## Project Structure

```
nano-supabase/
├── src/
│   ├── types.ts              # Core type definitions
│   ├── queue.ts              # Priority queue
│   ├── pooler.ts             # N-to-1 connection pooler
│   ├── server.ts             # TCP server
│   ├── socket/
│   │   ├── types.ts          # WinterCG socket interfaces
│   │   ├── runtime.ts        # Runtime detection
│   │   ├── index.ts          # Socket factory
│   │   └── adapters/
│   │       └── node.ts       # Node.js adapter (✅ complete)
│   └── index.ts              # Main exports
├── examples/
│   ├── basic.ts              # Pooler usage example
│   └── tcp-server.ts         # TCP server example
├── PLAN.md                   # Detailed implementation plan
└── README.md                 # This file
```

## Dependencies

### Current
```json
{
  "@electric-sql/pglite": "^0.2.12"
}
```

### Planned (Phase 6)
```json
{
  "@supabase/supabase-js": "^2.x",
  "native_postgrest_parser": "workspace:*",
  "drizzle-orm": "^0.x (optional)",
  "kysely": "^0.x (optional)"
}
```

## Getting Started

### Installation (Future)

```bash
npm install nano-supabase
# or
pnpm add nano-supabase
# or
yarn add nano-supabase
```

### Current Development Setup

```bash
# Clone the repository
git clone <repo-url>
cd nano-supabase

# Install dependencies
npm install

# Run examples
npm run example:basic     # Test pooler
npm run example:server    # Test TCP server

# Build
npm run build
```

## Testing

```bash
# Run basic pooler test
npm run example:basic

# Test TCP server (Terminal 1)
npm run example:server

# Connect with netcat (Terminal 2)
nc 127.0.0.1 5433
SELECT * FROM users
INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')
SELECT COUNT(*) FROM users
```

## Contributing

This project is in active development. Phase 6 (Supabase compatibility) is the next major milestone.

**Areas for contribution:**
- Additional runtime adapters (Deno, Bun, Cloudflare Workers)
- PostgREST parser integration
- Supabase-js wrapper implementation
- Documentation and examples
- Performance testing and optimization

## License

MIT

## Acknowledgments

- [PGlite](https://github.com/electric-sql/pglite) - PostgreSQL in WASM by Electric SQL
- [PostgREST](https://postgrest.org/) - RESTful API for PostgreSQL
- [WinterCG](https://wintercg.org/) - Web-interoperable Runtimes Community Group
- [Supabase](https://supabase.com/) - Open source Firebase alternative
- [pglited](https://github.com/filipecabaco/pglited) - Rust implementation reference
- [native_postgrest_parser](https://github.com/filipecabaco/native_postgrest_parser) - WASM PostgREST parser
