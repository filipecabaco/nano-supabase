# Supabase-Compatible Client

Demonstrates the full Supabase-compatible client API backed by PGlite. Uses the same `supabase-js` query builder syntax you'd use with a hosted Supabase project — but everything runs in-process with zero network calls.

## What it shows

- Schema creation (users + posts tables)
- INSERT, SELECT, UPDATE, DELETE operations
- Filtering with `eq`, `gte`, `lte`, `in`
- Ordering and pagination (`order`, `limit`)
- Single-row selection (`.single()`)
- Foreign key relationships

## Run

```bash
pnpm run example:supabase-client
```

## Key APIs

- `nanoSupabase()` — create a nano-supabase instance
- `nano.createClient()` — get a Supabase-compatible client
- `nano.db` — direct PGlite access for schema setup
