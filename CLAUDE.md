# CLAUDE.md

> API surface and integration patterns for AI agents: @AGENTS.md

## What is this?

nano-supabase — lightweight Supabase emulation running entirely in-process using PGlite (Postgres via WASM). Auth (JWT + RLS), storage (pluggable backends), PostgREST parsing (WASM), connection pooling. Zero network calls, cross-runtime (Node, Deno, browser, edge).

## Architecture

```
@supabase/supabase-js
  → Fetch Adapter (URL path routing)
     /auth/v1/*    → AuthHandler
     /rest/v1/*    → PostgREST Parser (WASM) → SQL
     /storage/v1/* → StorageHandler
  → Priority Queue → Connection Pooler → PGlite

CLI Server (src/cli.ts)
  → Node.js HTTP server on --http-port (default 54321)
  → /admin/v1/*  Admin API (SQL, schema, migrations, reset)
  → /v1/projects/:ref/*  Supabase Management API shim
  → /mcp  MCP server (Streamable HTTP, @supabase/mcp-server-supabase)
  → TCP server (Postgres wire protocol for Prisma/Drizzle/psql)
```

## Key files

- `src/nano.ts` — `NanoSupabaseInstance` factory, the main public API
- `src/client.ts` — `initComponents()` wiring (AuthHandler, StorageHandler, PostgrestParser)
- `src/cli.ts` — CLI server with HTTP/TCP/MCP, admin API, management API shim
- `src/cli-commands.ts` — CLI subcommands (db, migration, users, storage, gen)
- `src/mcp-server.ts` — Native MCP server (SupabasePlatform impl + Streamable HTTP)
- `src/fetch-adapter/index.ts` — `createLocalFetch` URL routing dispatcher
- `src/auth/handler.ts` — Auth operations (signup, signin, signout, JWT, admin CRUD)
- `src/storage/handler.ts` — Storage operations (buckets, objects, signed URLs)
- `src/storage/backend.ts` — StorageBackend interface + MemoryStorageBackend (cross-runtime)
- `src/storage/fs-backend.ts` — FileSystemStorageBackend (Node.js-only, persists blobs to disk)
- `src/storage/s3-backend.ts` — S3StorageBackend (S3/R2/MinIO, dynamically imports @aws-sdk/client-s3)
- `src/postgrest-parser.ts` — PostgREST → SQL (WASM binding)
- `src/pglite-factory.ts` — PGlite factory, always registers pgcrypto + uuid-ossp

## PGliteInterface typing

All public APIs that accept a database instance use `PGliteInterface` (from `@electric-sql/pglite`) rather than the concrete `PGlite` class. This means `PGliteWorker` from `@electric-sql/pglite/worker` works as a drop-in replacement — enabling off-main-thread Postgres and multi-tab leader election in the browser. The `PGlite` concrete type is only used in server-side code (`pglite-factory.ts`, `pooler.ts`, `tcp-server.ts`) and in `nano.ts` which creates its own instance via `createPGlite()`.

## Commands

```bash
pnpm test                                     # Run all tests (vitest)
pnpm vitest run tests/mcp-server.test.ts      # Run specific test file
node dist/cli.js start --mcp                  # Start built server with MCP on /mcp
pnpm run build                                # esbuild bundle + tsc declarations
npx tsc --noEmit                              # Type-check (cli.ts is excluded from tsconfig)
```

## Extensions

`pgcrypto` and `uuid-ossp` are always registered. Additional extensions are passed via the `extensions` option and come from PGlite's dist as `<name>.tar.gz` bundles:

```typescript
import { vector } from '@electric-sql/pglite/vector'
const nano = await nanoSupabase({ extensions: { vector } })
await nano.db.exec('CREATE EXTENSION IF NOT EXISTS vector')
```

CLI: `--extensions=vector,pg_trgm,bloom` (comma-separated). Names map directly to PGlite bundle filenames. Extensions with dependencies must all be listed (e.g. `cube,earthdistance`). Full list: https://pglite.dev/extensions/

## Code rules

- No comments in code — code is self-documenting
- No helper/utility files — inline all logic
- No Node.js-specific APIs in library code — Web Crypto API only, for cross-runtime compat
- SQL schemas use `CREATE IF NOT EXISTS` for idempotency
- PGlite's `db.query()` for single statements, `db.exec()` for multi-statement DDL
- Multi-statement fallback pattern: try `db.query()`, catch "cannot insert multiple commands", fall back to `db.exec()`

## Testing rules

- Test behavior, not implementation
- No excessive mocking — use real PGlite instances
- Each test creates its own isolated PGlite instance + client
- No helper files — inline all setup for full context
- Tests use vitest; imports come from `vitest` or `./compat.ts` (which re-exports vitest)
- WASM is pre-loaded in `tests/vitest-setup.ts` via `readFileSync` for Node.js compatibility
- Do not test what the compiler verifies

## MCP server details

- Served on `/mcp` endpoint of the main HTTP server (no separate port)
- Uses `@supabase/mcp-server-supabase` as a library via `createSupabaseMcpServer()`
- Transport: `WebStandardStreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`
- Per-session server instances (SDK's `connect()` is one-shot)
- Unknown session IDs get 404, not a new session
- Platform operations call PGlite directly (no HTTP round-trips)
- Debugging ops (getLogs, advisors) are stubs returning empty arrays

## tsconfig notes

- `src/cli.ts`, `src/cli-commands.ts` are excluded from tsconfig (CLI-only, Node.js-specific)
- `src/mcp-server.ts` is included in tsconfig and must type-check clean
- `skipLibCheck: true` — dependency types have known issues
- `moduleResolution: "bundler"` with `allowImportingTsExtensions: true`
