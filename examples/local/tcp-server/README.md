# TCP Server (PostgreSQL Wire Protocol)

Runs a PostgreSQL-compatible TCP server backed by PGlite. Connect with any standard Postgres client — psql, pgAdmin, DBeaver, or any application that speaks the Postgres wire protocol.

## What it shows

- Starting a TCP server on a custom port
- Creating tables and inserting sample data
- Accepting connections from standard Postgres clients

## Run

```bash
pnpm run example:tcp-server
```

Then connect:

```bash
psql "host=127.0.0.1 port=5433 user=postgres dbname=postgres sslmode=disable"
```

## Key APIs

- `nanoSupabase({ tcp: { port } })` — start with TCP server enabled
- `nano.connectionString` — get the connection string for clients
