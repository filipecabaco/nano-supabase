#!/bin/bash
set -e

echo "=== nano-supabase cloud setup ==="

if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is required but not installed"
  exit 1
fi

echo "[1/4] Installing dependencies..."
npm install --no-fund --no-audit nano-supabase @electric-sql/pglite @supabase/supabase-js 2>&1 | tail -1

echo "[2/4] Starting nano-supabase (detached + MCP)..."
if npx nano-supabase status &>/dev/null; then
  echo "  Server already running"
else
  OUTPUT=$(npx nano-supabase start \
    --detach \
    --mcp \
    --data-dir=./.nano-supabase-data \
    2>&1)
  echo "  $OUTPUT"
fi

echo "[3/4] Applying migrations..."
if [ -d "supabase/migrations" ] && [ "$(ls -A supabase/migrations/*.sql 2>/dev/null)" ]; then
  npx nano-supabase migration up 2>&1 | tail -3
else
  echo "  No migrations found (supabase/migrations/ is empty)"
fi

echo "[4/4] Verifying..."
npx nano-supabase status

echo ""
echo "=== Ready ==="
echo "  HTTP:  http://localhost:54321"
echo "  MCP:   http://localhost:54321/mcp"
echo "  TCP:   postgresql://postgres@127.0.0.1:5432/postgres"
echo ""
echo "  Run SQL:        npx nano-supabase db exec --sql \"SELECT 1\""
echo "  New migration:  npx nano-supabase migration new <name>"
echo "  Apply:          npx nano-supabase migration up"
echo "  Gen types:      npx nano-supabase gen types --output types.ts"
