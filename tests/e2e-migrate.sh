#!/usr/bin/env bash
set -euo pipefail

ADMIN_TOKEN="e2e-admin-token"
SERVICE_PORT=8090
TCP_PORT=8091
DATA_DIR=$(mktemp -d)
COLD_DIR=$(mktemp -d)

cleanup() {
  kill "$SERVICE_PID" 2>/dev/null || true
  rm -rf "$DATA_DIR" "$COLD_DIR"
}
trap cleanup EXIT

eval "$(supabase status --output env 2>/dev/null | grep -E '^(API_URL|SERVICE_ROLE_KEY|DB_URL)=' | sed 's/^/SUPA_/')"
SUPABASE_API_URL="${SUPA_API_URL:-http://127.0.0.1:54321}"
SUPABASE_SERVICE_KEY="${SUPA_SERVICE_ROLE_KEY:-}"
SUPABASE_DB_URL="${SUPA_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
echo "Supabase API: $SUPABASE_API_URL"
echo "Supabase DB: $SUPABASE_DB_URL"

node dist/cli.js service \
  --service-port="$SERVICE_PORT" \
  --tcp-port="$TCP_PORT" \
  --admin-token="$ADMIN_TOKEN" \
  --data-dir="$DATA_DIR" \
  --cold-dir="$COLD_DIR" \
  --secret=e2e-secret &
SERVICE_PID=$!

BASE="http://localhost:$SERVICE_PORT"
for i in $(seq 1 30); do
  if curl -sf "$BASE/health" > /dev/null 2>&1; then break; fi
  if [ "$i" -eq 30 ]; then echo "FAIL: service did not start"; exit 1; fi
  sleep 1
done
echo "OK: service healthy"

TENANT_TOKEN=$(curl -sf -X POST "$BASE/admin/tenants" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"slug": "e2e-src"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "OK: tenant created (token=$TENANT_TOKEN)"

curl -sf -X POST "$BASE/admin/tenants/e2e-src/sql" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "CREATE TABLE IF NOT EXISTS todos (id SERIAL PRIMARY KEY, title TEXT NOT NULL, done BOOLEAN DEFAULT false, user_id UUID REFERENCES auth.users(id))"
  }' > /dev/null
echo "OK: todos table created"

curl -sf -X POST "$BASE/admin/tenants/e2e-src/sql" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "INSERT INTO todos (title, done) VALUES ('\''Buy milk'\'', false), ('\''Write tests'\'', true), ('\''Ship feature'\'', false)"
  }' > /dev/null
echo "OK: 3 todo rows inserted"

curl -sf -X POST "$BASE/e2e-src/auth/v1/signup" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@test.com", "password": "password123"}' > /dev/null
echo "OK: auth user signed up"

MIGRATE_BODY=$(cat <<ENDJSON
{
  "remoteDbUrl": "$SUPABASE_DB_URL",
  "remoteUrl": "$SUPABASE_API_URL",
  "remoteServiceRoleKey": "$SUPABASE_SERVICE_KEY",
  "skipStorage": true
}
ENDJSON
)

echo "Migrating tenant to Supabase..."
MIGRATE_RESULT=$(curl -sf -X POST "$BASE/admin/tenants/e2e-src/migrate" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$MIGRATE_BODY")

echo "Migrate result: $MIGRATE_RESULT"

SCHEMA_TABLES=$(echo "$MIGRATE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['schema']['tables'])")
AUTH_USERS=$(echo "$MIGRATE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['auth']['users'])")
DATA_ROWS=$(echo "$MIGRATE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['rows'])")
DATA_TABLES=$(echo "$MIGRATE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['tables'])")

echo "Schema tables: $SCHEMA_TABLES, Auth users: $AUTH_USERS, Data rows: $DATA_ROWS, Data tables: $DATA_TABLES"

if [ "$SCHEMA_TABLES" -lt 1 ]; then echo "FAIL: expected at least 1 schema table"; exit 1; fi
if [ "$AUTH_USERS" -lt 1 ]; then echo "FAIL: expected at least 1 auth user"; exit 1; fi
if [ "$DATA_ROWS" -lt 3 ]; then echo "FAIL: expected at least 3 data rows"; exit 1; fi
if [ "$DATA_TABLES" -lt 1 ]; then echo "FAIL: expected at least 1 data table"; exit 1; fi
echo "OK: migrate counts look good"

REMOTE_TODOS=$(psql "$SUPABASE_DB_URL" -t -A -c "SELECT count(*) FROM public.todos")
if [ "$REMOTE_TODOS" -lt 3 ]; then echo "FAIL: expected 3 todos on remote, got $REMOTE_TODOS"; exit 1; fi
echo "OK: $REMOTE_TODOS todos found on Supabase Postgres"

REMOTE_USERS=$(psql "$SUPABASE_DB_URL" -t -A -c "SELECT count(*) FROM auth.users WHERE email = 'alice@test.com'")
if [ "$REMOTE_USERS" -lt 1 ]; then echo "FAIL: auth user not found on remote"; exit 1; fi
echo "OK: auth user alice@test.com found on Supabase Postgres"

REMOTE_IDENTITIES=$(psql "$SUPABASE_DB_URL" -t -A -c "SELECT count(*) FROM auth.identities WHERE user_id IN (SELECT id FROM auth.users WHERE email = 'alice@test.com')")
if [ "$REMOTE_IDENTITIES" -lt 1 ]; then echo "FAIL: identity not found on remote"; exit 1; fi
echo "OK: identity for alice found on Supabase Postgres"

REMOTE_SEQ=$(psql "$SUPABASE_DB_URL" -t -A -c "SELECT last_value FROM todos_id_seq")
if [ "$REMOTE_SEQ" -lt 3 ]; then echo "FAIL: sequence not reset, got $REMOTE_SEQ"; exit 1; fi
echo "OK: sequence todos_id_seq reset to $REMOTE_SEQ"

NEW_TODO_ID=$(psql "$SUPABASE_DB_URL" -t -A -c "INSERT INTO public.todos (title) VALUES ('Post-migrate') RETURNING id")
if [ "$NEW_TODO_ID" -le 3 ]; then echo "FAIL: new row id=$NEW_TODO_ID collides with migrated data"; exit 1; fi
echo "OK: post-migrate insert got id=$NEW_TODO_ID (no collision)"

echo ""
echo "=== ALL E2E MIGRATE TESTS PASSED ==="
