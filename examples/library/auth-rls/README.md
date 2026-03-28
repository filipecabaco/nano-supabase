# Auth + Row Level Security

Demonstrates user authentication and Row Level Security (RLS) — the same security model used by hosted Supabase. Each user can only see and modify their own data, enforced at the database level.

## What it shows

- User signup and signin via `supabase.auth`
- RLS policies on a `todos` table (SELECT, INSERT, UPDATE, DELETE)
- `auth.uid()` in policies to restrict access per user
- Multi-user isolation — Alice cannot see Bob's data
- Anonymous access returns empty results (not errors)
- Admin user management via `authHandler.adminListUsers()`

## Run

```bash
pnpm run example:auth-rls
```

## Key APIs

- `supabase.auth.signUp({ email, password })` — create a new user
- `supabase.auth.signInWithPassword({ email, password })` — authenticate
- `supabase.auth.signOut()` — end session
- `auth.uid()` — PostgreSQL function returning current user's UUID (for RLS policies)
- `authHandler.adminListUsers()` — list all users (admin only)

## RLS policy pattern

```sql
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own todos"
  ON todos FOR SELECT
  USING (user_id = auth.uid());
```
