# Cloudflare Worker

Demonstrates deploying nano-supabase as a Cloudflare Worker. PGlite runs via WASM, so the entire database runs at the edge with zero external dependencies.

## What it shows

- nano-supabase running in a Cloudflare Worker
- REST API backed by in-process PGlite
- CRUD operations via Supabase client
- Edge-native execution (no network calls to external databases)

## Setup

```bash
npm install nano-supabase @electric-sql/pglite
```

Create `wrangler.toml`:

```toml
name = "nano-supabase-worker"
main = "index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]
```

## Deploy

```bash
npx wrangler deploy
```

## Local development

```bash
npx wrangler dev
```

## Limitations

- Each Worker invocation may cold-start a new PGlite instance (ephemeral by default)
- For persistence, consider Durable Objects or external storage
- WASM cold start adds ~100ms on first request
