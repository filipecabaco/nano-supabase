# MCP Server

Demonstrates the Model Context Protocol (MCP) server integration. The MCP endpoint lets AI tools like Claude Code interact with your nano-supabase instance — running SQL, managing migrations, and generating TypeScript types.

## What it shows

- Starting nano-supabase with MCP enabled
- Available MCP tools (execute_sql, list_migrations, apply_migration, etc.)
- Claude Code integration via `.claude/settings.json`
- Sample database with tasks table

## Run

Start with MCP enabled:

```bash
npx nano-supabase start --mcp
```

The MCP endpoint is available at `http://localhost:54321/mcp` (Streamable HTTP transport).

## Claude Code integration

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "nano-supabase": {
      "command": "npx",
      "args": ["nano-supabase", "start", "--mcp", "--detach"]
    }
  }
}
```

## MCP tools

| Tool | Description |
|------|-------------|
| `execute_sql` | Run SQL queries against the database |
| `list_migrations` | Show applied migrations |
| `apply_migration` | Apply a new migration |
| `generate_typescript_types` | Generate TS types from schema |
| `get_project_url` | Get the project URL |
| `get_publishable_keys` | Get anon/service-role keys |
