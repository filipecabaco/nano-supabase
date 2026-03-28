# Examples

Demos organized by use case. Each folder contains a self-contained example with its own README.

## Browser

| Example | Description |
|---------|-------------|
| [react-file-manager](browser/react-file-manager/) | Dropbox-style file storage app with auth, storage, and RLS — runs entirely in the browser |
| [postgis-map](browser/postgis-map/) | Interactive map with PostGIS spatial queries, OpenStreetMap tiles, and Leaflet |

## Library

| Example | Description |
|---------|-------------|
| [supabase-client](library/supabase-client/) | Full Supabase-compatible client API (CRUD, filters, ordering, pagination) |
| [auth-rls](library/auth-rls/) | User authentication and Row Level Security — multi-user isolation |
| [storage](library/storage/) | File upload/download, signed URLs, bucket management |
| [postgrest-parser](library/postgrest-parser/) | PostgREST URL-to-SQL query parser |
| [pooler](library/pooler/) | Priority queue connection pooler with metrics |

## CLI

| Example | Description |
|---------|-------------|
| [tcp-server](cli/tcp-server/) | PostgreSQL wire protocol server — connect with psql, pgAdmin, or any Postgres client |
| [migrations](cli/migrations/) | Schema management with versioned migration files |
| [mcp-server](cli/mcp-server/) | MCP server for AI tool integration (Claude Code, etc.) |

## ORM

| Example | Description |
|---------|-------------|
| [drizzle](orm/drizzle/) | Type-safe queries with Drizzle ORM (direct PGlite connection) |
| [prisma](orm/prisma/) | Prisma ORM via TCP wire protocol |

## Service

| Example | Description |
|---------|-------------|
| [feature-flags](service/feature-flags/) | Feature flag service with rollouts, environment overrides, and app scoping |
| [multi-tenant](service/multi-tenant/) | Multi-tenant HTTP gateway with pause/wake lifecycle |

## Edge

| Example | Description |
|---------|-------------|
| [cloudflare-worker](edge/cloudflare-worker/) | nano-supabase running as a Cloudflare Worker |
| [deno](edge/deno/) | nano-supabase in a Deno project using Web Crypto API |

## Cloud

| Example | Description |
|---------|-------------|
| [claude-code](cloud/claude-code/) | Complete Claude Code cloud session setup — auto-setup, MCP integration, migrations, and project template |

## Running examples

Standalone examples (library, cli, orm):

```bash
pnpm run example:pooler
pnpm run example:supabase-client
pnpm run example:auth-rls
pnpm run example:storage
pnpm run example:postgrest-parser
pnpm run example:tcp-server
pnpm run example:migrations
pnpm run example:drizzle
pnpm run example:prisma
```

Service examples (require a running service):

```bash
# Start the service first
npx nano-supabase service --admin-token=my-token --secret=my-secret --data-dir=./data
# Then in another terminal
pnpm run example:multi-tenant
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

Claude Code cloud:

```bash
# Copy into your project root
cp -r examples/cloud/claude-code/.claude/ .claude/
cp -r examples/cloud/claude-code/supabase/ supabase/
# Session setup runs automatically, or manually:
bash .claude/setup.sh
```

Edge examples:

```bash
# Deno
cd examples/edge/deno
deno run --allow-read --allow-env --allow-net index.ts

# Cloudflare Worker
cd examples/edge/cloudflare-worker
npx wrangler dev
```

## Tests

Example tests validate that the core logic of each demo works correctly:

```bash
pnpm run test:examples
```

Tests run in a separate CI workflow triggered by changes to `examples/` or `src/`.
