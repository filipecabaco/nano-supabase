# Claude Code Cloud Project

This project uses nano-supabase as a local Supabase replacement. Everything runs in-process — no external database or Supabase project needed.

## Setup

The server starts automatically via `.claude/setup.sh`. If it's not running:

```bash
npx nano-supabase start --detach --mcp --data-dir=./.nano-supabase-data
```

## Database

- **HTTP API**: http://localhost:54321 (Supabase-compatible)
- **TCP**: postgresql://postgres@127.0.0.1:5432/postgres
- **MCP**: http://localhost:54321/mcp (for AI tool access)

## Schema changes

Always use migrations, never modify the database directly:

```bash
npx nano-supabase migration new <description>
# Edit supabase/migrations/<timestamp>_<description>.sql
npx nano-supabase migration up
```

## Connecting from code

```typescript
import { createClient } from '@supabase/supabase-js'
const supabase = createClient('http://localhost:54321', 'local-anon-key')
```

## Commands

```bash
npx nano-supabase db exec --sql "SELECT * FROM todos"
npx nano-supabase gen types --output src/types.ts
npx nano-supabase status
npx nano-supabase stop
```
