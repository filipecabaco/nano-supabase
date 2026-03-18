# CLAUDE.md

## What is this?

nano-supabase — lightweight Supabase emulation running entirely in-process using PGlite (Postgres via WASM). Auth (JWT + RLS), storage (pluggable backends), PostgREST parsing (WASM), connection pooling. Zero network calls, cross-runtime (Node, Deno, Bun, browser, edge).

## Architecture

```
@supabase/supabase-js
  → Fetch Adapter (URL path routing)
     /auth/v1/*    → AuthHandler
     /rest/v1/*    → PostgREST Parser (WASM) → SQL
     /storage/v1/* → StorageHandler
  → Priority Queue → Connection Pooler → PGlite

CLI Server (src/cli.ts)
  → Bun.serve on --http-port (default 54321)
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
- `src/postgrest-parser.ts` — PostgREST → SQL (WASM binding)

## Commands

```bash
bun test tests/                    # Run all tests
bun test tests/mcp-server.test.ts  # Run MCP tests only
bun run src/cli.ts start --mcp     # Start server with MCP on /mcp
npm run build                      # esbuild bundle + tsc declarations
bun run build:cli                  # Compile standalone CLI binary
npx tsc --noEmit                   # Type-check (cli.ts is excluded from tsconfig)
```

## Code rules

- No comments in code — code is self-documenting
- No helper/utility files — inline all logic
- No Node.js-specific APIs — Web Crypto API only, for cross-runtime compat
- SQL schemas use `CREATE IF NOT EXISTS` for idempotency
- PGlite's `db.query()` for single statements, `db.exec()` for multi-statement DDL
- Multi-statement fallback pattern: try `db.query()`, catch "cannot insert multiple commands", fall back to `db.exec()`

## Testing rules

- Test behavior, not implementation
- No excessive mocking — use real PGlite instances
- Each test creates its own isolated PGlite instance + client
- No helper files — inline all setup for full context
- Runtime-agnostic via `tests/compat.ts` shim (Bun + Deno)
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

- `src/cli.ts`, `src/cli-commands.ts` are excluded from tsconfig (CLI-only, Bun-specific)
- `src/mcp-server.ts` is included in tsconfig and must type-check clean
- `skipLibCheck: true` — dependency types have known issues
- `moduleResolution: "bundler"` with `allowImportingTsExtensions: true`
