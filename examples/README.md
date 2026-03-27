# Examples

Demos organized by use case. Each folder contains a self-contained example with its own README.

## Browser

| Example | Description |
|---------|-------------|
| [react-file-manager](browser/react-file-manager/) | Dropbox-style file storage app with auth, storage, and RLS — runs entirely in the browser |

## Library

| Example | Description |
|---------|-------------|
| [supabase-client](library/supabase-client/) | Full Supabase-compatible client API (CRUD, filters, ordering, pagination) |
| [postgrest-parser](library/postgrest-parser/) | PostgREST URL-to-SQL query parser |
| [pooler](library/pooler/) | Priority queue connection pooler with metrics |

## CLI

| Example | Description |
|---------|-------------|
| [tcp-server](cli/tcp-server/) | PostgreSQL wire protocol server — connect with psql, pgAdmin, or any Postgres client |

## ORM

| Example | Description |
|---------|-------------|
| [drizzle](orm/drizzle/) | Type-safe queries with Drizzle ORM (direct PGlite connection) |
| [prisma](orm/prisma/) | Prisma ORM via TCP wire protocol |

## Service

| Example | Description |
|---------|-------------|
| [feature-flags](service/feature-flags/) | Feature flag service with rollouts, environment overrides, and app scoping |

## Running examples

Standalone examples (library, cli, orm):

```bash
pnpm run example:pooler
pnpm run example:supabase-client
pnpm run example:postgrest-parser
pnpm run example:tcp-server
pnpm run example:drizzle
pnpm run example:prisma
```

React demo:

```bash
cd examples/browser/react-file-manager
pnpm install
pnpm run dev
```

Feature flags service:

```bash
cd examples/service/feature-flags
bun install
bun run start
```

## Tests

Example tests validate that the core logic of each demo works correctly:

```bash
pnpm vitest run --config vitest.examples.config.ts
```

Tests run in a separate CI workflow triggered by changes to `examples/` or `src/`.

## Missing examples / contribution ideas

The following areas could benefit from examples:

- **Auth + RLS** — standalone example showing signup, signin, and row-level security policies
- **Storage** — file upload/download with signed URLs and bucket policies
- **Service mode** — multi-tenant setup using `nano-supabase service`
- **MCP server** — using the MCP endpoint with Claude Code or other MCP clients
- **Edge/Cloudflare Workers** — deploying nano-supabase at the edge
- **Deno** — using nano-supabase in a Deno project
- **Migrations** — schema management with `nano-supabase migration`
