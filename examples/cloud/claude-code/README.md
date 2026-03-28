# Claude Code Cloud Development

Complete setup for using nano-supabase in Claude Code cloud sessions. Includes automated setup scripts, MCP integration, and a full-stack project template that Claude can use as a starting point.

## What this provides

- **`.claude/setup.sh`** — auto-runs when a cloud session starts; installs deps and starts the server in background
- **`.claude/settings.json`** — registers nano-supabase as an MCP server so Claude can run SQL, manage migrations, and generate types
- **Project template** — a todo-app scaffold with migrations, RLS policies, and type generation that Claude can extend

## Quick start

Copy the `.claude/` directory and `supabase/` directory into your project root:

```bash
cp -r examples/cloud/claude-code/.claude/ .claude/
cp -r examples/cloud/claude-code/supabase/ supabase/
```

Then start a Claude Code cloud session. The setup script will:

1. Install `nano-supabase` and `@electric-sql/pglite`
2. Start the server in detached mode with MCP enabled
3. Apply any migrations in `supabase/migrations/`
4. Print connection info

## Cloud environment constraints

| Constraint | Solution |
|------------|----------|
| Must use `npx` (not `bun`) | Cloud proxy blocks Bun's package manager |
| Server must survive script exit | `--detach` forks the process and writes a PID file |
| No external database needed | PGlite runs entirely in-process via WASM |
| Data should persist across restarts | `--data-dir` stores data on the filesystem |
| MCP for AI tool access | `--mcp` exposes tools on `/mcp` endpoint |

## Project structure

```
your-project/
├── .claude/
│   ├── setup.sh              # Auto-setup on session start
│   └── settings.json         # MCP server config
├── supabase/
│   └── migrations/
│       └── 00001_create_todos.sql
├── src/
│   └── index.ts              # Your app code
└── package.json
```

## What Claude can do via MCP

Once the MCP server is running, Claude Code can:

- **Run SQL**: `execute_sql` — query or modify the database
- **Manage migrations**: `list_migrations`, `apply_migration`
- **Generate types**: `generate_typescript_types` — TypeScript types from your schema
- **Inspect keys**: `get_publishable_keys` — get anon/service-role keys

## Manual setup (if not using setup.sh)

```bash
npm install nano-supabase @electric-sql/pglite
npx nano-supabase start --detach --mcp --data-dir=./.nano-supabase-data
npx nano-supabase migration up
npx nano-supabase status
```

## Connecting from your app

```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'http://localhost:54321',
  'local-anon-key'
)

// Works exactly like hosted Supabase
const { data } = await supabase.from('todos').select('*')
```

## CLI commands available in cloud

```bash
npx nano-supabase status                              # Check server status
npx nano-supabase db exec --sql "SELECT * FROM todos" # Run SQL
npx nano-supabase migration new add_users             # Create migration
npx nano-supabase migration up                        # Apply migrations
npx nano-supabase migration list                      # List migrations
npx nano-supabase gen types --output types.ts          # Generate TS types
npx nano-supabase stop                                # Stop server
```

## Persistence

Data is stored at `.nano-supabase-data/` (gitignored). It survives server restarts but not session teardowns. For permanent data, use `sync push` to push migrations to a hosted Supabase project:

```bash
npx nano-supabase sync push --remote-db-url=postgresql://...
```
