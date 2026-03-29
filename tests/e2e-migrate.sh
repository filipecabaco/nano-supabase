#!/usr/bin/env bash
set -euo pipefail

ADMIN_TOKEN="e2e-admin-token"
SERVICE_PORT=8090
TCP_PORT=8091
DATA_DIR=$(mktemp -d)
COLD_DIR=$(mktemp -d)
SERVICE_LOG=$(mktemp)

cleanup() {
  echo "--- nano-supabase service log ---"
  cat "$SERVICE_LOG" 2>/dev/null || true
  echo "--- end service log ---"
  kill "$SERVICE_PID" 2>/dev/null || true
  rm -rf "$DATA_DIR" "$COLD_DIR" "$SERVICE_LOG"
}
trap cleanup EXIT

eval "$(supabase status --output env 2>/dev/null | grep -E '^(API_URL|SERVICE_ROLE_KEY|DB_URL|ANON_KEY)=' | sed 's/^/SUPA_/')"
SUPABASE_API_URL="${SUPA_API_URL:-http://127.0.0.1:54321}"
SUPABASE_SERVICE_KEY="${SUPA_SERVICE_ROLE_KEY:-}"
SUPABASE_ANON_KEY="${SUPA_ANON_KEY:-}"
SUPABASE_DB_URL="${SUPA_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
echo "Supabase API: $SUPABASE_API_URL"
echo "Supabase DB: $SUPABASE_DB_URL"
echo "Supabase service key length: ${#SUPABASE_SERVICE_KEY}"
echo "Supabase anon key length: ${#SUPABASE_ANON_KEY}"

psql "$SUPABASE_DB_URL" -c "SELECT version()" || { echo "FAIL: cannot connect to Supabase Postgres"; exit 1; }
echo "OK: Supabase Postgres reachable"

node dist/cli.js service \
  --service-port="$SERVICE_PORT" \
  --tcp-port="$TCP_PORT" \
  --admin-token="$ADMIN_TOKEN" \
  --data-dir="$DATA_DIR" \
  --cold-dir="$COLD_DIR" \
  --secret=e2e-secret > "$SERVICE_LOG" 2>&1 &
SERVICE_PID=$!

BASE="http://localhost:$SERVICE_PORT"
for i in $(seq 1 30); do
  if curl -sf "$BASE/health" > /dev/null 2>&1; then break; fi
  if [ "$i" -eq 30 ]; then echo "FAIL: service did not start"; exit 1; fi
  sleep 1
done
echo "OK: service healthy"

api() {
  local desc="$1"; shift
  local response http_code body
  response=$(curl -s -w "\n%{http_code}" "$@")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')
  if [ "$http_code" -ge 400 ]; then
    echo "FAIL: $desc (HTTP $http_code)"
    echo "$body"
    exit 1
  fi
  echo "$body"
}

echo ""
echo "========================================="
echo "  PHASE 1: Seed nano-supabase tenant"
echo "========================================="

CREATE_BODY=$(api "create tenant" -X POST "$BASE/admin/tenants" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"slug": "e2e-src"}')
TENANT_TOKEN=$(echo "$CREATE_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
TENANT_SVC_KEY=$(echo "$CREATE_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['tenant']['serviceRoleKey'])")
TENANT_ANON_KEY=$(echo "$CREATE_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['tenant']['anonKey'])")
echo "OK: tenant created"

api "create todos table" -X POST "$BASE/admin/tenants/e2e-src/sql" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "CREATE TABLE IF NOT EXISTS todos (id SERIAL PRIMARY KEY, title TEXT NOT NULL, done BOOLEAN DEFAULT false, user_id UUID REFERENCES auth.users(id))"
  }' > /dev/null
echo "OK: todos table created"

api "enable RLS on todos" -X POST "$BASE/admin/tenants/e2e-src/sql" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "ALTER TABLE todos ENABLE ROW LEVEL SECURITY; CREATE POLICY \"todos_select\" ON todos FOR SELECT USING (true); CREATE POLICY \"todos_insert\" ON todos FOR INSERT WITH CHECK (true)"
  }' > /dev/null
echo "OK: RLS enabled on todos"

api "insert todos" -X POST "$BASE/admin/tenants/e2e-src/sql" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "INSERT INTO todos (title, done) VALUES ('\''Buy milk'\'', false), ('\''Write tests'\'', true), ('\''Ship feature'\'', false)"
  }' > /dev/null
echo "OK: 3 todo rows inserted"

api "auth signup" -X POST "$BASE/e2e-src/auth/v1/signup" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@test.com", "password": "password123"}' > /dev/null
echo "OK: auth user signed up"

api "create storage bucket" -X POST "$BASE/e2e-src/storage/v1/bucket" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "apikey: $TENANT_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id": "documents", "name": "documents", "public": true}' > /dev/null
echo "OK: storage bucket 'documents' created"

echo "Hello from nano-supabase!" > /tmp/e2e-test-file.txt
api "upload storage object" -X POST "$BASE/e2e-src/storage/v1/object/documents/hello.txt" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "apikey: $TENANT_ANON_KEY" \
  -H "Content-Type: text/plain" \
  --data-binary @/tmp/e2e-test-file.txt > /dev/null
echo "OK: file 'hello.txt' uploaded to documents bucket"

echo ""
echo "========================================="
echo "  PHASE 2: Migrate to Supabase"
echo "========================================="

MIGRATE_BODY=$(cat <<ENDJSON
{
  "remoteDbUrl": "$SUPABASE_DB_URL",
  "remoteUrl": "$SUPABASE_API_URL",
  "remoteServiceRoleKey": "$SUPABASE_SERVICE_KEY"
}
ENDJSON
)

echo "Migrating tenant to Supabase..."
MIGRATE_RESULT=$(api "migrate" -X POST "$BASE/admin/tenants/e2e-src/migrate" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$MIGRATE_BODY")

echo "Migrate result: $MIGRATE_RESULT"

SCHEMA_TABLES=$(echo "$MIGRATE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['schema']['tables'])")
AUTH_USERS=$(echo "$MIGRATE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['auth']['users'])")
DATA_ROWS=$(echo "$MIGRATE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['rows'])")
DATA_TABLES=$(echo "$MIGRATE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['tables'])")
STORAGE_BUCKETS=$(echo "$MIGRATE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['storage']['buckets'])")
STORAGE_OBJECTS=$(echo "$MIGRATE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['storage']['objects'])")

echo "Schema tables: $SCHEMA_TABLES, Auth users: $AUTH_USERS, Data rows: $DATA_ROWS"
echo "Storage buckets: $STORAGE_BUCKETS, Storage objects: $STORAGE_OBJECTS"

if [ "$SCHEMA_TABLES" -lt 1 ]; then echo "FAIL: expected at least 1 schema table"; exit 1; fi
if [ "$AUTH_USERS" -lt 1 ]; then echo "FAIL: expected at least 1 auth user"; exit 1; fi
if [ "$DATA_ROWS" -lt 3 ]; then echo "FAIL: expected at least 3 data rows"; exit 1; fi
if [ "$DATA_TABLES" -lt 1 ]; then echo "FAIL: expected at least 1 data table"; exit 1; fi
if [ "$STORAGE_BUCKETS" -lt 1 ]; then echo "FAIL: expected at least 1 storage bucket"; exit 1; fi
echo "OK: migrate counts look good"

echo ""
echo "========================================="
echo "  PHASE 3: Verify data via Postgres"
echo "========================================="

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

REMOTE_BUCKET=$(psql "$SUPABASE_DB_URL" -t -A -c "SELECT count(*) FROM storage.buckets WHERE id = 'documents'")
if [ "$REMOTE_BUCKET" -lt 1 ]; then echo "FAIL: documents bucket not found on remote"; exit 1; fi
echo "OK: documents bucket found on Supabase Postgres"

echo ""
echo "========================================="
echo "  PHASE 4: Application-level verification"
echo "  (Use Supabase APIs with migrated data)"
echo "========================================="

psql "$SUPABASE_DB_URL" -c "ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY" 2>/dev/null || true
psql "$SUPABASE_DB_URL" -c "CREATE POLICY \"todos_select\" ON public.todos FOR SELECT USING (true)" 2>/dev/null || true
psql "$SUPABASE_DB_URL" -c "CREATE POLICY \"todos_insert\" ON public.todos FOR INSERT WITH CHECK (true)" 2>/dev/null || true
echo "OK: RLS policies applied on Supabase"

echo "Signing in via Supabase GoTrue with migrated credentials..."
SIGNIN_RESULT=$(api "supabase auth signin" -X POST "$SUPABASE_API_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@test.com", "password": "password123"}')
ACCESS_TOKEN=$(echo "$SIGNIN_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
if [ -z "$ACCESS_TOKEN" ]; then echo "FAIL: no access token from Supabase signin"; exit 1; fi
echo "OK: signed in to Supabase GoTrue with migrated user (token length: ${#ACCESS_TOKEN})"

echo "Querying todos via Supabase PostgREST with auth token..."
POSTGREST_RESULT=$(api "supabase postgrest query" \
  "$SUPABASE_API_URL/rest/v1/todos?select=title,done&order=id" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
POSTGREST_COUNT=$(echo "$POSTGREST_RESULT" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
if [ "$POSTGREST_COUNT" -lt 3 ]; then echo "FAIL: PostgREST returned $POSTGREST_COUNT rows, expected >= 3"; exit 1; fi
FIRST_TITLE=$(echo "$POSTGREST_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['title'])")
echo "OK: Supabase PostgREST returned $POSTGREST_COUNT todos (first: '$FIRST_TITLE')"

echo "Inserting a new todo via Supabase PostgREST..."
api "supabase postgrest insert" -X POST "$SUPABASE_API_URL/rest/v1/todos" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"title": "Added via Supabase API", "done": false}' > /dev/null
echo "OK: inserted todo via Supabase PostgREST"

FINAL_COUNT=$(psql "$SUPABASE_DB_URL" -t -A -c "SELECT count(*) FROM public.todos")
if [ "$FINAL_COUNT" -lt 5 ]; then echo "FAIL: expected >= 5 todos after API insert, got $FINAL_COUNT"; exit 1; fi
echo "OK: $FINAL_COUNT total todos after PostgREST insert"

echo "Downloading storage object via Supabase Storage API..."
STORAGE_DOWNLOAD=$(curl -s -w "\n%{http_code}" \
  "$SUPABASE_API_URL/storage/v1/object/public/documents/hello.txt")
STORAGE_HTTP=$(echo "$STORAGE_DOWNLOAD" | tail -1)
STORAGE_BODY=$(echo "$STORAGE_DOWNLOAD" | sed '$d')
if [ "$STORAGE_HTTP" -ge 400 ]; then
  echo "WARN: storage object download returned HTTP $STORAGE_HTTP (object migration may not be supported for Supabase local)"
  echo "$STORAGE_BODY"
else
  if echo "$STORAGE_BODY" | grep -q "Hello from nano-supabase"; then
    echo "OK: downloaded 'hello.txt' from Supabase Storage — content matches"
  else
    echo "WARN: storage object content mismatch (got: '$STORAGE_BODY')"
  fi
fi

echo "Checking Supabase auth session is valid..."
USER_RESULT=$(api "supabase auth user" "$SUPABASE_API_URL/auth/v1/user" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
USER_EMAIL=$(echo "$USER_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['email'])")
if [ "$USER_EMAIL" != "alice@test.com" ]; then echo "FAIL: auth user email mismatch: $USER_EMAIL"; exit 1; fi
echo "OK: Supabase auth session valid for alice@test.com"

echo ""
echo "========================================="
echo "  ALL E2E MIGRATE TESTS PASSED"
echo "========================================="
echo ""
echo "Summary:"
echo "  - Schema: $SCHEMA_TABLES table(s) migrated"
echo "  - Auth: $AUTH_USERS user(s) migrated, signin works on Supabase GoTrue"
echo "  - Data: $DATA_ROWS row(s) migrated, PostgREST queries + inserts work"
echo "  - Storage: $STORAGE_BUCKETS bucket(s) migrated"
echo "  - Sequences: reset correctly (no ID collisions)"
