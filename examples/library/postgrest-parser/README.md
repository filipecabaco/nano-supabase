# PostgREST Parser

Demonstrates the PostgREST query parser that converts Supabase-style URL parameters into SQL queries. This is the core engine that makes `supabase-js` queries work against PGlite.

## What it shows

- SELECT with column selection and filters
- Multiple filter operators (`eq`, `gte`)
- Ordering and pagination
- INSERT, UPDATE, DELETE query generation
- RPC function calls
- Generic HTTP request parsing

## Run

```bash
pnpm run example:postgrest-parser
```

## Key APIs

- `PostgrestParser.init()` — initialize the WASM parser
- `parser.parseSelect(table, query)` — parse a SELECT query
- `parser.parseInsert(table, body)` — parse an INSERT
- `parser.parseUpdate(table, body, filters)` — parse an UPDATE
- `parser.parseDelete(table, filters)` — parse a DELETE
- `parser.parseRpc(fn, params)` — parse an RPC call
- `parser.parseRequest(method, table, query)` — parse a generic request
