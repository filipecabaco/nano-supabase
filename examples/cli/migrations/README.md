# Migrations

Demonstrates schema management with versioned migration files. Migrations are timestamped SQL files applied in order and tracked, ensuring reproducible schemas across environments.

## What it shows

- Creating timestamped migration files
- Applying migrations in order
- Multi-statement migrations (CREATE TABLE, ALTER TABLE, CREATE INDEX)
- Foreign key relationships across migrations
- Verifying schema with sample data
- Sync commands for remote Supabase projects

## Run

```bash
pnpm run example:migrations
```

## CLI workflow (recommended)

```bash
npx nano-supabase migration new create_todos
# Edit supabase/migrations/<timestamp>_create_todos.sql

npx nano-supabase migration up
npx nano-supabase migration list
```

## Sync with remote

```bash
npx nano-supabase sync push --remote-db-url=<postgres-url>
npx nano-supabase sync pull --remote-db-url=<postgres-url>
```

## Migration file format

Files live in `supabase/migrations/` and follow the naming convention:

```
<timestamp>_<description>.sql
```

Example: `20240101000000_create_users.sql`

All DDL should use `IF NOT EXISTS` / `IF NOT EXISTS` for idempotency.
