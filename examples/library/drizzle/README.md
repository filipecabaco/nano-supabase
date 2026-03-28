# Drizzle ORM Integration

Demonstrates using [Drizzle ORM](https://orm.drizzle.team/) with PGlite for type-safe database operations. Drizzle connects directly to the PGlite instance — no TCP server needed.

## What it shows

- Drizzle schema definitions (users + posts tables)
- Type-safe INSERT, SELECT, UPDATE, DELETE
- Filter operators (`eq`, `gte`, `lte`, `and`)
- Ordering and limits
- LEFT JOIN between tables
- Type inference with `$inferSelect` / `$inferInsert`

## Run

```bash
pnpm run example:drizzle
```

## Key APIs

- `drizzle(pglite)` — wrap a PGlite instance with Drizzle
- `db.insert(table).values(...)` — type-safe insert
- `db.select().from(table).where(...)` — type-safe queries
- `db.update(table).set(...).where(...)` — type-safe updates
