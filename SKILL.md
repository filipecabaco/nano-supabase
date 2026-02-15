---
name: nano-supabase
description: >
  Skill for working with the nano-supabase codebase: a lightweight TypeScript library that emulates
  Supabase entirely in-browser/edge using PGlite (Postgres via WASM). Covers architecture, fetch
  adapter routing, auth/storage/data flows, PostgREST WASM parser, connection pooling, cross-runtime
  compatibility, build system, and testing conventions. Use when implementing features, fixing bugs,
  writing tests, or reviewing code in this project.
---

# nano-supabase

Lightweight Supabase emulation running entirely in-browser/edge. Zero network calls. Full auth (JWT + RLS), storage (pluggable backends), PostgREST query parsing (WASM), priority-queue connection pooling over PGlite.

## Architecture

```
@supabase/supabase-js
  -> Fetch Adapter (routes by URL path)
     /auth/v1/*    -> AuthHandler (signup, signin, signout, refresh)
     /rest/v1/*    -> PostgREST Parser (WASM) -> SQL
     /storage/v1/* -> StorageHandler (buckets, objects, signed URLs)
  -> Priority Queue (CRITICAL / HIGH / MEDIUM / LOW)
  -> Connection Pooler (N-to-1 multiplexing)
  -> PGlite (PostgreSQL in WebAssembly)
```

## Project Layout

```
src/
  index.ts              # Public exports
  client.ts             # createLocalSupabaseClient, createFetchAdapter
  supabase-client.ts    # Supabase-compatible client wrapper
  postgrest-parser.ts   # PostgREST -> SQL (WASM binding)
  pooler.ts             # N-to-1 connection pooler
  queue.ts              # Priority queue (4 levels)
  types.ts              # QueryPriority, QueryResult, PoolerConfig
  auth/                 # JWT via Web Crypto, sessions, refresh tokens
    handler.ts          # signUp, signIn, signOut, refreshToken
    crypto.ts           # Web Crypto API helpers
    jwt.ts              # signJWT, verifyJWT, decodeJWT
    schema.ts           # Auth SQL schema (CREATE IF NOT EXISTS)
    types.ts            # User, Session, AuthResponse
  storage/              # Storage API emulation
    handler.ts          # Bucket/object CRUD
    backend.ts          # StorageBackend interface + MemoryStorageBackend
    schema.ts           # Storage SQL schema
  fetch-adapter/        # Intercepts supabase-js fetch calls
    index.ts            # createLocalFetch: URL routing
    auth-routes.ts      # /auth/v1/* dispatch
    data-routes.ts      # /rest/v1/* dispatch
    storage-routes.ts   # /storage/v1/* dispatch
    auth-context.ts     # JWT claims extraction for RLS
    error-handler.ts    # Error -> Response conversion
tests/
  compat.ts             # Deno/Bun test shim (runtime-agnostic)
  *.test.ts             # Split by concern: auth, data, storage, fetch-adapter, applications, full-user-flow
```

## Key Technical Details

- **TypeScript strict mode**, ESNext modules, ES2022 target
- **Cross-runtime**: Node.js, Deno, Bun, Browser, Cloudflare Workers. Use Web Crypto API only (no Node crypto)
- **PGlite is a peer dependency** - users provide their own instance
- **postgrest-parser** bundled as WASM in dist/
- **esbuild** bundles to dist/index.js (~21KB) + WASM (~377KB)
- **SQL schemas** use `CREATE IF NOT EXISTS` for idempotent initialization
- **RLS functions**: `auth.uid()`, `auth.role()`, `auth.email()` backed by PostgreSQL roles (`anon`, `authenticated`, `service_role`)

## Common Patterns

Create a client:
```typescript
const client = createLocalSupabaseClient(db);
// or manually:
const client = createClient(url, key, { global: { fetch: createLocalFetch(db, key) } });
```

Auth flow:
```typescript
await supabase.auth.signUp({ email, password });
const { data: { session } } = await supabase.auth.signInWithPassword({ email, password });
// JWT now in session, RLS active
```

Data with RLS:
```typescript
// Create table + RLS policy, then query as authenticated user
const { data } = await supabase.from('todos').select('*');
// Only returns rows matching RLS policy
```

Storage:
```typescript
await supabase.storage.from('avatars').upload('path/file.png', blob);
const { data } = await supabase.storage.from('avatars').download('path/file.png');
const { data: { signedUrl } } = await supabase.storage.from('avatars').createSignedUrl('path/file.png', 3600);
```

## Testing

- **Behavior over implementation**: Test real user workflows, not internals
- **No helper files**: Inline all setup for full context at each test
- **No excessive mocking**: Use real PGlite instances
- **Each test** creates its own PGlite instance + client (isolated)
- **Full workflows**: signup -> insert -> query -> verify RLS -> cleanup
- Runtime-agnostic via `compat.ts` shim

Run tests:
```bash
deno test --allow-read --allow-env tests/
bun test tests/
```

## Build

```bash
npm run build          # esbuild -> dist/
npm run build:dev      # tsc only
npm run build:types    # declarations
```

CI: GitHub Actions matrix (Bun + Deno), tests split by concern.

## Rules

- No comments in code
- No helper/utility files
- No Node.js-specific APIs
- Test behavior, not implementation
- Do not test what the compiler verifies
