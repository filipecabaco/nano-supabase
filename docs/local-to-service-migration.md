# Feature: `migrate local-to-service`

## What it does

Migrates a standalone local nano-supabase instance (started with `npx nano-supabase start --data-dir=./mydb`) into a tenant on a running service mode instance. The reverse direction of `service migrate` (which goes service tenant → hosted Supabase).

## Why it's useful

- Developer starts locally, iterates on schema/data, then wants to deploy into a multi-tenant service
- Avoids manually recreating schema, seeding data, re-signing up users
- Enables a "develop locally, push to shared environment" workflow similar to `sync push` but for **everything** (schema + auth + data + storage), not just migrations

## What gets migrated

| Component | Source (local) | Destination (service tenant) |
|-----------|---------------|------------------------------|
| Schema | PGlite at `--data-dir` | New tenant's PGlite |
| Auth | `auth.users` + `auth.identities` | Tenant's auth schema |
| Data | All public tables (FK-ordered) | Tenant's public schema |
| Storage | Buckets + objects (fs/memory backend) | Tenant's storage backend |
| RLS | `pg_class.relrowsecurity` + `pg_policy` | Tenant tables |
| Views | `pg_views` (public schema) | Tenant |
| Functions | `pg_proc` (public, f/p kinds) | Tenant |
| Triggers | `pg_trigger` (non-internal, public) | Tenant |
| Sequences | Reset to max values | Tenant |
| Migrations | `supabase_migrations.schema_migrations` or `./supabase/migrations/` files | Tenant |

## CLI interface

```bash
npx nano-supabase migrate local-to-service \
  --data-dir=./mydb \
  --url=http://localhost:8080 \
  --admin-token=<token> \
  --slug=my-tenant \
  [--dry-run] [--skip-auth] [--skip-data] [--skip-storage]
```

## Implementation strategy

**SQL-level replay** (recommended over filesystem copy):

1. Open a read-only local PGlite from `--data-dir`
2. Create the tenant via `POST /admin/tenants` with the slug
3. Replay schema/data/auth/storage to the tenant via the admin SQL endpoint (`POST /admin/tenants/:slug/sql`) and storage API (`POST /:slug/storage/v1/object/...`)

This reuses all the introspection queries already written in `cli-service.ts` and works across PGlite versions without coupling to internal storage format.

## Implementation details

### Entry point

Add `cmdMigrateLocalToService()` in `src/cli-commands.ts`.

### Refactor: extract shared migrate logic

The migrate logic in `cli-service.ts` (lines 1154-1864) currently operates on `nano.db` (source PGlite) and `remote` (pg.Client target). Extract the core into a reusable function:

```typescript
async function migrateDatabase(opts: {
  source: PGliteInterface
  executeOnTarget: (sql: string, params?: any[]) => Promise<any>
  fetchStorageObject?: (bucket: string, path: string) => Promise<Blob>
  uploadStorageObject?: (bucket: string, path: string, blob: Blob) => Promise<void>
  skipSchema?: boolean
  skipAuth?: boolean
  skipData?: boolean
  skipStorage?: boolean
  dryRun?: boolean
}): Promise<MigrateResult>
```

- `service migrate` (existing) passes `remote.query` as `executeOnTarget`
- `local-to-service` (new) passes a function that calls `POST /admin/tenants/:slug/sql`

### Step-by-step flow

1. **Open local PGlite**: `createPGlite({ dataDir })` — same as `nanoSupabase()` does
2. **Create tenant**: `POST /admin/tenants` with slug, receive token + password
3. **Schema replay**: Enums → sequences → tables (with PKs, FKs, uniques) → indexes → views → functions → triggers → RLS + policies. Uses the existing introspection queries from `cli-service.ts`
4. **Auth replay**: Query local `auth.users` + `auth.identities`, INSERT via admin SQL endpoint with `ON CONFLICT (id) DO NOTHING`
5. **Data replay**: Topologically sort tables by FK dependencies, batch INSERT (100 rows/batch) via admin SQL endpoint. Set `session_replication_role = 'replica'` during bulk load to disable triggers
6. **Storage replay**: Query local `storage.buckets` + `storage.objects`, download blobs from local storage backend, upload to tenant's storage API
7. **Sequence reset**: After data insert, reset all sequences to `max(pk_column)` to avoid ID collisions

### Key source locations

| File | What to use |
|------|-------------|
| `src/cli-service.ts:1154-1517` | Schema introspection (tables, FKs, indexes, views, functions, triggers, RLS) |
| `src/cli-service.ts:1521-1628` | Auth migration (users + identities) |
| `src/cli-service.ts:1631-1780` | Data migration (FK ordering, batched inserts, sequence reset) |
| `src/cli-service.ts:1782-1860` | Storage migration (buckets + objects) |
| `src/cli-commands.ts:1328-1376` | `service add` command (tenant creation via admin API) |
| `src/nano.ts` | `nanoSupabase()` factory for opening local PGlite |

## Edge cases

- **Local instance still running**: Warn or error if PGlite lock file exists (another process has it open)
- **Tenant already exists**: Option to `--overwrite` (reset + re-migrate) or error by default
- **Large datasets**: Batch inserts in 100-row chunks (already implemented in existing migrate)
- **Storage backend mismatch**: Local may use fs-backend, service may use memory — objects transfer via HTTP regardless
- **Extensions**: Local may use extensions not available on the service tenant — detect and warn
- **Cross-schema FKs**: Already handled — FK introspection includes `ccu.table_schema` to generate `REFERENCES "auth"."users"(...)` correctly

## Testing

### E2E test (`tests/e2e-local-to-service.sh`)

1. Start a local nano-supabase with `--data-dir`, seed it (table with RLS + policies, view, function, trigger, auth user, storage bucket + object, data rows)
2. Start a service mode instance
3. Run `npx nano-supabase migrate local-to-service --data-dir=... --url=... --admin-token=... --slug=migrated`
4. Verify via tenant APIs: PostgREST queries return data, auth signin works, storage objects downloadable, view queryable, function callable, RLS enforced, sequences don't collide

### Unit test

Mock the admin API endpoints, verify the correct SQL statements are sent in the right order (schema before data, FK-ordered inserts, sequence resets after data).
