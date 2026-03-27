# Prisma ORM Integration

Demonstrates using [Prisma](https://www.prisma.io/) with PGlite via the TCP wire protocol server. Prisma connects over a standard PostgreSQL connection string, just like it would with a real Postgres database.

## What it shows

- Starting nano-supabase with TCP server
- Applying Prisma schema via `prisma db push`
- CRUD operations through Prisma Client
- Relation queries with `include`
- Filtered queries and field selection

## Run

```bash
pnpm run example:prisma
```

## Prerequisites

Prisma client must be generated first:

```bash
pnpm prisma:generate
```

## Key APIs

- `nanoSupabase({ tcp: { port } })` — start with TCP enabled
- `nano.connectionString` — used as Prisma's `DATABASE_URL`
- Standard Prisma Client operations (create, findMany, update, delete)
