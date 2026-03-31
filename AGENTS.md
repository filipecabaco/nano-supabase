# nano-supabase

A TypeScript library that provides a Supabase-compatible API backed by PGlite (PostgreSQL in WebAssembly). Zero network calls, zero external processes — everything runs in-process.

## What This Is

nano-supabase intercepts `fetch` calls from `@supabase/supabase-js` and routes them to a local PGlite instance instead of a remote Supabase server:

- Auth (`/auth/v1/*`) — signup, signin, signout, JWT sessions, RLS
- Data (`/rest/v1/*`) — PostgREST-compatible queries parsed via WASM
- Storage (`/storage/v1/*`) — bucket/object CRUD with pluggable backends

It also ships a CLI (`nano-supabase`) that runs a full HTTP + Postgres TCP server locally.

## Installation

```bash
npm install nano-supabase @electric-sql/pglite
```

`@electric-sql/pglite` is a peer dependency — install it separately.

## Simplest Setup

```typescript
import { createClient } from 'nano-supabase'

const supabase = await createClient()
await supabase.from('todos').insert({ title: 'Hello' })
const { data } = await supabase.from('todos').select('*')
```

`createClient` is a drop-in replacement for `@supabase/supabase-js`'s `createClient`. No URL, no project, no network.

## Setup With Existing PGlite Instance

```typescript
import { PGlite } from '@electric-sql/pglite'
import { createClient } from '@supabase/supabase-js'
import { nanoSupabase } from 'nano-supabase'

const nano = await nanoSupabase()

// Prefer migrations (npx nano-supabase migration new / migration up) for schema changes.
// Direct db access is for tests and ad-hoc queries only.
await nano.db.query('SELECT 1')

const supabase = createClient('http://localhost:54321', 'local-anon-key', {
  global: { fetch: nano.localFetch }
})
```

## Public API

All exports from `nano-supabase`:

| Export | Purpose |
|--------|---------|
| `createClient(options?)` | Drop-in replacement for supabase-js `createClient`. Returns a wired-up `SupabaseClient`. |
| `nanoSupabase(options?)` | Full factory — returns `{ db, localFetch, createClient, [AsyncDispose] }` |
| `createFetchAdapter({ db, ... })` | Low-level: returns `{ localFetch, authHandler, parser, storageHandler }` |
| `createLocalSupabaseClient(config, createClientFn)` | Wire a custom supabase-js `createClient` call to a PGlite instance |
| `createSupabaseClient(db)` | Standalone query builder (no supabase-js dependency) |
| `createPGlite(options?)` | PGlite factory with all required extensions pre-registered |
| `initializeAuth(db)` | Initialize auth schema only, returns `AuthHandler` |
| `PGlitePooler` | Priority-queue connection pooler |
| `PostgrestParser` | PostgREST URL → SQL converter (WASM) |
| `AuthHandler` | Auth operations (signup, signin, JWT, sessions) |
| `StorageHandler` | Storage operations (buckets, objects, signed URLs) |
| `FileSystemStorageBackend` | Persistent blob storage on disk (Node.js-only) |
| `S3StorageBackend` | Persistent blob storage in S3/R2/MinIO |
| `QueryPriority` | `CRITICAL / HIGH / MEDIUM / LOW` enum for pooler |

## Schema Setup

**Always use migrations to modify the schema.** Migrations are versioned SQL files applied in order and tracked — ensuring your schema is reproducible and stays in sync with any remote Supabase project.

```bash
# Create a new migration file
npx nano-supabase migration new create_todos

# Edit the generated file at supabase/migrations/<timestamp>_create_todos.sql, then apply:
npx nano-supabase migration up

# Check status
npx nano-supabase migration list
```

Example migration (`supabase/migrations/<timestamp>_create_todos.sql`):

```sql
CREATE TABLE IF NOT EXISTS todos (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  done BOOLEAN DEFAULT false,
  user_id UUID REFERENCES auth.users(id)
);
```

Using `nano.db` directly is an escape hatch for ad-hoc queries and tests — **do not use it to define schema that should persist or be synced**.

## Extensions

`pgcrypto` and `uuid-ossp` are always loaded. Add others via the `extensions` option:

```typescript
import { vector } from '@electric-sql/pglite/vector'
import { nanoSupabase } from 'nano-supabase'

const nano = await nanoSupabase({ extensions: { vector } })
await nano.db.exec('CREATE EXTENSION IF NOT EXISTS vector')
```

CLI: pass `--extensions=name1,name2` when starting the server. Each name maps to a `name.tar.gz` bundle from PGlite's dist. After starting, enable with `CREATE EXTENSION IF NOT EXISTS name`.

Some extensions have dependencies that must also be listed — e.g. `earthdistance` requires `cube`:

```bash
npx nano-supabase start --extensions=cube,earthdistance
```

Full list: https://pglite.dev/extensions/

## Key Constraints

- **`@electric-sql/pglite` is a peer dependency** — must be installed separately
- **`pgcrypto` required for auth** — password hashing and UUID generation need this extension
- **Single connection** — PGlite runs one query at a time; the built-in pooler queues concurrent requests
- **No Realtime** — WebSocket subscriptions are not supported
- **No Edge Functions** — Supabase Edge Functions are not supported
- **PostgREST subset** — covers select, insert, update, delete, upsert with filters, ordering, pagination, and embedded resources

## PGlite Workers (Browser)

All public APIs (`createFetchAdapter`, `createLocalSupabaseClient`, `AuthHandler`, `StorageHandler`, etc.) accept `PGliteInterface` — the shared interface implemented by both `PGlite` and `PGliteWorker`. This means `PGliteWorker` from `@electric-sql/pglite/worker` works as a drop-in replacement.

**Why use workers in the browser:**

- **Non-blocking UI** — PGlite WASM execution (queries, bcrypt hashing, schema init) moves to a background thread
- **Multi-tab safety** — `navigator.locks` elects one tab as leader; others proxy via `BroadcastChannel`; no IndexedDB storage conflicts
- **Automatic failover** — closing the leader tab promotes a follower with no data loss

**Setup — worker file (`worker.ts`):**

```typescript
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { worker } from '@electric-sql/pglite/worker'

worker({
  async init(options) {
    return new PGlite({
      dataDir: options?.dataDir ?? 'idb://my-app',
      extensions: { pgcrypto, uuid_ossp },
    })
  },
})
```

**Setup — main thread:**

```typescript
import { PGliteWorker } from '@electric-sql/pglite/worker'
import { createClient } from '@supabase/supabase-js'
import { createFetchAdapter } from 'nano-supabase'

const pg = await PGliteWorker.create(
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  { dataDir: 'idb://my-app' },
)

const { localFetch } = await createFetchAdapter({ db: pg })

const supabase = createClient('http://localhost:54321', 'local-anon-key', {
  global: { fetch: localFetch },
})

// Full Supabase API — auth, PostgREST, storage — all running off-main-thread
await supabase.auth.signUp({ email: 'user@example.com', password: 'password' })
const { data } = await supabase.from('todos').select('*')
```

**Leader election awareness:**

```typescript
console.log(pg.isLeader) // true if this tab runs Postgres
pg.onLeaderChange(() => console.log('Leader changed:', pg.isLeader))
```

**Limitations:** Browser-only (requires `navigator.locks`, `BroadcastChannel`, `Worker`). Does not apply to Node.js, Deno, or edge runtimes. Extension namespaces from the worker are not exposed on the main-thread `PGliteWorker` instance.

See `examples/local/pglite-workers/` for a complete React demo with auth, RLS, storage, multi-tab sync, and leader election UI.

## Persistence

```typescript
const supabase = await createClient()                        // ephemeral (default)
const supabase = await createClient({ dataDir: './my-db' }) // filesystem (Node.js / Bun)
// Browser: pass dataDir: 'idb://my-db' for IndexedDB
```

All schemas use `IF NOT EXISTS` — persistent databases are safe to reuse across restarts.

## Storage Persistence

By default, uploaded files are stored in memory and lost on restart. To persist storage blobs, use a storage backend:

**Filesystem (Node.js-only):**

```typescript
import { nanoSupabase, FileSystemStorageBackend } from 'nano-supabase'

const nano = await nanoSupabase({
  dataDir: './my-db',
  storageBackend: new FileSystemStorageBackend('./my-db/storage'),
})
```

**S3 / R2 / MinIO:**

```typescript
import { nanoSupabase, S3StorageBackend } from 'nano-supabase'

const nano = await nanoSupabase({
  storageBackend: new S3StorageBackend({
    bucket: 'my-bucket',
    endpoint: 'https://minio.example.com',  // optional, for S3-compatible services
    prefix: 'storage/',                       // optional, default: 'storage/'
  }),
})
```

S3 credentials are read from `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` environment variables, or passed via the `credentials` option.

**CLI:** When `--data-dir` is set, the CLI automatically uses filesystem storage at `<data-dir>/storage`. Override with:

```bash
npx nano-supabase start --data-dir=./data                              # auto: fs at ./data/storage
npx nano-supabase start --storage-backend=memory                       # force in-memory
npx nano-supabase start --storage-backend=s3 --s3-bucket=my-bucket     # S3
npx nano-supabase start --storage-backend=s3 --s3-bucket=my-bucket --s3-endpoint=http://localhost:9000  # MinIO
```

**Service mode:** Each tenant gets its own storage backend. With `--s3-bucket`, all tenants use S3 (prefix: `tenants/<id>/storage/`). Without it, each tenant uses filesystem storage at `<data-dir>/<tenant>/storage`.

## Auth & RLS

```typescript
await supabase.auth.signUp({ email: 'user@example.com', password: 'password' })
const { data: { session } } = await supabase.auth.signInWithPassword({ email: 'user@example.com', password: 'password' })
```

RLS functions `auth.uid()`, `auth.role()`, and `auth.email()` work as expected once a session is active.

## CLI (nano-supabase)

```bash
npx nano-supabase start                          # HTTP on :54321, Postgres TCP on :5432
npx nano-supabase start --data-dir=./data        # persist to disk
npx nano-supabase start --mcp                    # MCP server on /mcp
npx nano-supabase start --detach                 # background mode
npx nano-supabase start --count=3                # start 3 instances (ports increment per instance)
npx nano-supabase start --tls-cert=cert.pem --tls-key=key.pem  # TLS/HTTPS

# Load extensions at startup
npx nano-supabase start --extensions=vector
npx nano-supabase start --extensions=vector,pg_trgm,bloom
npx nano-supabase start --extensions=cube,earthdistance  # earthdistance requires cube

npx nano-supabase db exec --sql "SELECT * FROM todos"
npx nano-supabase migration new add_todos
npx nano-supabase migration up
npx nano-supabase gen types --output types.ts

# Sync migrations with hosted Supabase project (only --remote-db-url required)
npx nano-supabase sync push --remote-db-url=<postgres-url>
npx nano-supabase sync pull --remote-db-url=<postgres-url>

# Optional flags
npx nano-supabase sync push --remote-db-url=<url> --dry-run       # preview without writing
npx nano-supabase sync push --remote-db-url=<url> --no-migrations # skip migrations
npx nano-supabase sync push --remote-db-url=<url> --no-storage    # skip storage buckets
```

Environment variables: `SUPABASE_DB_URL` (substitutes `--remote-db-url`).

## Sync Push behavior

`sync push` applies local migration files to the remote database via a direct Postgres connection:

- Reads files from `supabase/migrations/` matching `<timestamp>_<name>.sql`.
- If `supabase_migrations.schema_migrations` exists on the remote, skips already-applied versions (matched by timestamp prefix).
- If that table is absent, creates it (`supabase_migrations.schema_migrations`) then applies all local migrations.
- Records each applied migration with its `version`, `name`, and `statements`.
- Also upserts local storage buckets into `storage.buckets` on the remote (unless `--no-storage`).
- Only `--remote-db-url` is required — `--remote-url` and `--remote-service-role-key` are not used.

## Sync Pull behavior

`sync pull` brings the remote schema into local migration files via a direct Postgres connection:

- If `supabase_migrations.schema_migrations` exists and has rows, writes each missing migration as a separate `<version>_<name>.sql` file (skips versions already present locally).
- If that table is absent or empty, falls back to a full schema dump:
  - Prefers the local nano-supabase admin API (`/admin/v1/schema`) if `--url` points to a running instance.
  - Otherwise runs `pg_dump --schema-only --no-owner --no-acl --schema=public` (requires `pg_dump` installed).
  - Writes a single timestamped `<timestamp>_pulled_schema.sql` file.
- Also upserts remote storage buckets into the local instance (unless `--no-storage`).
- No file is written if the resulting DDL is empty.
- Pull only writes files — it does not apply them. Run `npx nano-supabase migration up` after pulling to apply migrations to the local database.

## Service Mode

Service mode runs nano-supabase as a multi-tenant HTTP gateway. Each tenant gets an isolated PGlite instance, managed by a persistent registry.

```bash
# Local dev — no external Postgres needed (PGlite registry at <data-dir>/.registry)
npx nano-supabase service \
  --admin-token=<secret> \
  --secret=<encryption-secret> \
  --data-dir=./service-data

# Multi-node / production — shared external Postgres registry
npx nano-supabase service \
  --admin-token=<secret> \
  --secret=<encryption-secret> \
  --registry-db-url=<postgres-url> \
  --service-port=8080 \
  --data-dir=./service-data \
  --cold-dir=./service-cold \
  --idle-timeout=600000

# Subdomain routing — <slug>.example.com instead of example.com/<slug>
npx nano-supabase service \
  --admin-token=<secret> \
  --secret=<encryption-secret> \
  --routing=subdomain \
  --base-domain=example.com
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--admin-token` | required | Bearer token for admin API |
| `--secret` | required | Master encryption secret for tenant passwords at rest (AES-256-GCM). Also via `NANO_SECRET` env var. |
| `--registry-db-url` | local PGlite | Postgres connection URL for tenant registry (or `NANO_REGISTRY_DB_URL` env). Omit for local dev — defaults to a PGlite instance at `<data-dir>/.registry`. Use an external Postgres for multi-node deployments. |
| `--service-port` | `8080` | HTTP port |
| `--data-dir` | `/tmp/nano-service-data` | Base directory for tenant data directories |
| `--cold-dir` | `/tmp/nano-service-cold` | Directory for offloaded tenant archives (disk mode) |
| `--idle-timeout` | `600000` | Milliseconds before idle tenant is auto-paused |
| `--s3-bucket` | — | S3 bucket name for offload storage |
| `--s3-endpoint` | — | Custom S3 endpoint (for MinIO, R2, etc.) |
| `--routing` | `path` | Routing mode: `path` (default) or `subdomain` |
| `--base-domain` | — | Base domain for subdomain routing (e.g. `example.com` → `<slug>.example.com`) |
| `--idle-check` | `30000` | Idle check interval in milliseconds |
| `--circuit-breaker-threshold` | `10` | Auto-pause tenant after N consecutive 5xx responses |
| `--mcp` | false | Expose MCP server on `/<slug>/mcp` for each tenant (requires tenant bearer token) |

**Tenant routing:** requests are dispatched as `/<slug>/...` — the slug identifies the tenant, the remainder is forwarded to its local nano instance. Every tenant request requires `Authorization: Bearer <tenant-token>`.

**Admin API** (all require `Authorization: Bearer <admin-token>`):

```
GET  /health                              # liveness check
GET  /admin/tenants                       # list all tenants
POST /admin/tenants                       # create tenant (see body fields below)
GET  /admin/tenants/:slug                 # get tenant info
DELETE /admin/tenants/:slug               # delete tenant (stops instance, removes data)
POST /admin/tenants/:slug/pause           # pause running tenant (offload to disk/S3)
POST /admin/tenants/:slug/wake            # wake sleeping tenant (restore from disk/S3)
POST /admin/tenants/:slug/reset-token     # rotate tenant bearer token
POST /admin/tenants/:slug/reset-password  # rotate tenant postgres password (body: { "password": "..." } optional, generates random if omitted)
POST /admin/tenants/:slug/sql             # execute SQL on tenant (body: { "sql": "...", "params": [] })
```

`POST /admin/tenants` body fields — all optional except `slug`:

| Field | Default | Description |
|-------|---------|-------------|
| `slug` | required | Tenant identifier (`[a-z0-9-]+`) |
| `token` | random UUID | Bearer token for tenant requests |
| `password` | random hex | Postgres password for TCP connections |
| `anonKey` | `local-anon-key` | Anon JWT key |
| `serviceRoleKey` | `local-service-role-key` | Service role JWT key |

**CLI management commands** (all share `--url`, `--admin-token`/`NANO_ADMIN_TOKEN`, and `--json` flags):

```bash
# Start the service (long-running process)
# Local dev — PGlite registry (no external Postgres needed)
npx nano-supabase service --admin-token=<token> --secret=<secret> --data-dir=./data

# Multi-node / production — shared external Postgres registry
npx nano-supabase service --admin-token=<token> --secret=<secret> --registry-db-url=<url>

# Tenant management (connects to a running service)
npx nano-supabase service add <slug> [--token=...] [--password=...] [--anon-key=...] [--service-role-key=...]
npx nano-supabase service list
npx nano-supabase service remove <slug>
npx nano-supabase service pause <slug>
npx nano-supabase service wake <slug>
npx nano-supabase service sql <slug> "<sql>"
npx nano-supabase service reset-token <slug>
npx nano-supabase service reset-password <slug> [--password=...]

# All commands accept --json for machine-readable output
npx nano-supabase service list --json | jq '.[].slug'
npx nano-supabase service add acme --json | jq '.token'
```

Shared flags for all management commands:

| Flag | Default | Description |
|------|---------|-------------|
| `--url` | `http://localhost:8080` | Service base URL |
| `--admin-token` | `NANO_ADMIN_TOKEN` env | Admin bearer token |
| `--json` | false | Output JSON instead of human-readable text |

**`service add` output** (human-readable) shows connection info in the same box layout as `nano-supabase start`:
- API endpoints (URL, REST, Auth, Storage) scoped to `/<slug>/`
- Database URL for direct Postgres TCP connection
- Auth keys (anon key, service role key)
- Tenant token and state

**Examples:**

```bash
# Create tenant with all defaults (random token + password)
curl -X POST http://localhost:8080/admin/tenants \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"slug": "acme"}'
# → { "token": "<tenant-token>", "password": "<postgres-password>", "tenant": { ... } }

# Create tenant with explicit values
curl -X POST http://localhost:8080/admin/tenants \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"slug": "acme", "token": "my-token", "password": "my-pass", "anonKey": "my-anon", "serviceRoleKey": "my-svc"}'

# Use tenant (supabase-compatible endpoint)
curl -X POST http://localhost:8080/acme/auth/v1/signup \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password"}'

# Pause tenant to free memory
curl -X POST http://localhost:8080/admin/tenants/acme/pause \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Wake tenant (auto-wakes on first request too)
curl -X POST http://localhost:8080/admin/tenants/acme/wake \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**`ServiceClient` — TypeScript API:**

```typescript
import { ServiceClient } from 'nano-supabase'

const client = new ServiceClient({ url: 'http://localhost:8080', adminToken: process.env.NANO_ADMIN_TOKEN })

const { token, password, tenant } = await client.createTenant('acme', {
  token: 'my-token',       // optional — random if omitted
  password: 'my-pass',     // optional — random if omitted
  anonKey: 'my-anon',      // optional — 'local-anon-key' if omitted
  serviceRoleKey: 'my-svc' // optional — 'local-service-role-key' if omitted
})

await client.sql('acme', 'SELECT count(*) FROM auth.users')
await client.pauseTenant('acme')
await client.wakeTenant('acme')
await client.deleteTenant('acme')
```

| Method | Returns | Description |
|--------|---------|-------------|
| `createTenant(slug, options?)` | `{ token, password, tenant }` | Create tenant |
| `deleteTenant(slug)` | `void` | Delete tenant |
| `listTenants()` | `Tenant[]` | List all tenants |
| `getTenant(slug)` | `Tenant` | Get tenant info |
| `pauseTenant(slug)` | `Tenant` | Pause tenant |
| `wakeTenant(slug)` | `Tenant` | Wake tenant |
| `resetToken(slug)` | `{ token }` | Rotate bearer token |
| `resetPassword(slug, password?)` | `{ password }` | Rotate Postgres password |
| `sql(slug, query, params?)` | `{ rows, rowCount }` | Execute SQL on tenant |

**Offload behavior:**
- **Disk (default):** paused tenant data is archived as `<cold-dir>/<tenant-id>.tar.gz` using `tar czf`. On wake, the archive is extracted back.
- **S3:** when `--s3-bucket` is set, archives are uploaded to `tenants/<tenant-id>/data.tar.gz` in the bucket. Credentials read from `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION`.

**Registry persistence:** tenant metadata (slug, token hash, data dir, state) is stored in the registry database. By default this is a local PGlite instance at `<data-dir>/.registry` — no external Postgres needed for local dev. Pass `--registry-db-url` to use a shared external Postgres for multi-node deployments. On restart, all tenants are loaded from the registry as sleeping and auto-wake on first request.

**Memory advantage:** tenants share a single process and wake/sleep on demand, using far less memory than running a separate Node.js process per tenant.

## MCP Server

The CLI exposes an MCP server on `/mcp` (Streamable HTTP transport) when started with `--mcp`. Powered by `@supabase/mcp-server-supabase`.

To use in Claude Code:

```json
{
  "mcpServers": {
    "nano-supabase": {
      "command": "npx",
      "args": ["nano-supabase", "start", "--mcp", "--detach"]
    }
  }
}
```

Or add to `.claude/settings.json` for project-level MCP access.

## Using in Claude Code Cloud Sessions

When running tasks via Claude Code on the web:

- Use `npx nano-supabase` — Bun's package manager does not work behind the cloud security proxy
- The cloud environment has Node.js LTS and npm pre-installed
- `@electric-sql/pglite` and `nano-supabase` are available via npm
- No external Supabase project is needed — everything runs in-process
- Start the server in **detached mode** so it keeps running in the background while Claude works on the task

Example setup script for a cloud environment (`.claude/setup.sh`):

```bash
#!/bin/bash
pnpm install
npx nano-supabase start --detach --mcp --data-dir=./.nano-supabase-data
```

`--detach` forks the process and writes a PID file so the server survives beyond the script. `--mcp` exposes the MCP endpoint on `/mcp`. Check status with `npx nano-supabase status`.

## PostgreSQL Wire Protocol

The CLI exposes a Postgres TCP server (port `5432` by default). Connect with any standard Postgres client:

```bash
psql "host=127.0.0.1 port=5432 user=postgres dbname=postgres sslmode=disable"
```

Prisma: `DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres?sslmode=disable`

## Runtimes

**Library**: Node.js, Deno, Bun, browsers, Cloudflare Workers, Vercel Edge. Uses Web Crypto API only.

**CLI**: Node.js 18+ (Bun also supported for local use).

## Known Limitations

- `PostgrestParser` uses a static `initPromise` for WASM initialization. In service mode, each tenant gets its own schema cache keyed by `schemaId` (tenant slug). Schema is introspected per-tenant on wake and cleared on pause/delete via `clearSchema()`.
- `PGlitePooler` timeout does not cancel the underlying PGlite query (PGlite has no query cancellation API). A timed-out query continues running and blocks the queue until it finishes.
- `TcpServer` (exported from the library) uses `node:net` and `node:buffer` — it is Node.js-only and will not work in browser, Deno, or edge runtimes.
