# Deno

Demonstrates using nano-supabase in a Deno project. nano-supabase uses Web Crypto API (not Node.js crypto), so it works natively in Deno without compatibility flags.

## What it shows

- Importing nano-supabase via `npm:` specifiers
- Auth (signup, signin) with RLS policies
- CRUD operations through the Supabase client
- Direct SQL access via PGlite
- Deno's native Web Crypto API (same API nano-supabase uses internally)

## Run

```bash
deno run --allow-read --allow-env --allow-net index.ts
```

## Dependencies

Deno imports npm packages directly — no `package.json` needed:

```typescript
import { PGlite } from "npm:@electric-sql/pglite";
import { createClient } from "npm:@supabase/supabase-js";
import { createFetchAdapter, createPGlite } from "npm:nano-supabase";
```

## Cross-runtime compatibility

nano-supabase works across runtimes because it:

- Uses **Web Crypto API** for JWT signing (available in Deno, browsers, Workers)
- Uses **WebAssembly** for PGlite and PostgREST parser
- Avoids Node.js-specific APIs in library code (only CLI uses `node:` modules)

The only exception is the TCP server (`nano-supabase/tcp`), which requires `node:net`.
