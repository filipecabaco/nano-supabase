#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="$PROJECT_DIR/benchmarks"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RESULT_FILE="$RESULTS_DIR/$TIMESTAMP.json"

CLI_HTTP_PORT="${CLI_HTTP_PORT:-54399}"
CLI_TCP_PORT="${CLI_TCP_PORT:-54398}"
SERVICE_PORT="${SERVICE_PORT:-54397}"
SERVICE_TCP_PORT="${SERVICE_TCP_PORT:-54396}"
ADMIN_TOKEN="bench-admin-token"
SECRET="bench-secret-key-for-encryption"
TENANT_COUNT="${TENANT_COUNT:-3}"
ACCOUNTS="${ACCOUNTS:-100}"
TELLERS="${TELLERS:-10}"
BRANCHES="${BRANCHES:-1}"
ITERATIONS="${ITERATIONS:-200}"
CONCURRENT="${CONCURRENT:-4}"

DATA_DIR="$(mktemp -d)"
trap 'cleanup' EXIT

PIDS=()

cleanup() {
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  rm -rf "$DATA_DIR"
}

wait_for_health() {
  local url="$1" deadline=$((SECONDS + 60))
  while [ $SECONDS -lt $deadline ]; do
    if curl -sf "$url/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "ERROR: $url did not become healthy within 60s" >&2
  return 1
}

wait_for_tcp() {
  local port="$1" deadline=$((SECONDS + 60))
  while [ $SECONDS -lt $deadline ]; do
    if pg_isready -h 127.0.0.1 -p "$port" -q 2>/dev/null; then return 0; fi
    sleep 0.5
  done
  echo "ERROR: TCP port $port did not become ready within 60s" >&2
  return 1
}

init_tpcb_schema() {
  local port="$1" password="${2:-}" user="${3:-postgres}"
  local pgenv=""
  [ -n "$password" ] && pgenv="PGPASSWORD=$password"

  env $pgenv psql -h 127.0.0.1 -p "$port" -U "$user" -d postgres -q <<SQL
DROP TABLE IF EXISTS pgbench_history;
DROP TABLE IF EXISTS pgbench_tellers;
DROP TABLE IF EXISTS pgbench_accounts;
DROP TABLE IF EXISTS pgbench_branches;

CREATE TABLE pgbench_branches (bid INT PRIMARY KEY, bbalance INT DEFAULT 0, filler TEXT);
CREATE TABLE pgbench_accounts (aid INT PRIMARY KEY, bid INT REFERENCES pgbench_branches(bid), abalance INT DEFAULT 0, filler TEXT);
CREATE TABLE pgbench_tellers (tid INT PRIMARY KEY, bid INT REFERENCES pgbench_branches(bid), tbalance INT DEFAULT 0, filler TEXT);
CREATE TABLE pgbench_history (tid INT, bid INT, aid INT, delta INT, mtime TIMESTAMP DEFAULT NOW(), filler TEXT);

INSERT INTO pgbench_branches SELECT g, 0, '' FROM generate_series(1, $BRANCHES) g;
INSERT INTO pgbench_tellers SELECT g, ((g-1) % $BRANCHES) + 1, 0, '' FROM generate_series(1, $TELLERS) g;
INSERT INTO pgbench_accounts SELECT g, ((g-1) % $BRANCHES) + 1, 0, '' FROM generate_series(1, $ACCOUNTS) g;
SQL
}

run_tpcb_bench() {
  local port="$1" label="$2" logfile="$3" password="${4:-}" user="${5:-postgres}"
  local pgenv=""
  [ -n "$password" ] && pgenv="PGPASSWORD=$password"

  cat > "$DATA_DIR/tpcb.sql" <<'TPCB'
\set aid random(1, 100)
\set bid random(1, 1)
\set tid random(1, 10)
\set delta random(-5000, 5000)
BEGIN;
UPDATE pgbench_accounts SET abalance = abalance + :delta WHERE aid = :aid;
SELECT abalance FROM pgbench_accounts WHERE aid = :aid;
UPDATE pgbench_tellers SET tbalance = tbalance + :delta WHERE tid = :tid;
UPDATE pgbench_branches SET bbalance = bbalance + :delta WHERE bid = :bid;
INSERT INTO pgbench_history (tid, bid, aid, delta, mtime) VALUES (:tid, :bid, :aid, :delta, CURRENT_TIMESTAMP);
COMMIT;
TPCB

  sed -i "s/random(1, 100)/random(1, $ACCOUNTS)/" "$DATA_DIR/tpcb.sql"
  sed -i "s/random(1, 1)/random(1, $BRANCHES)/" "$DATA_DIR/tpcb.sql"
  sed -i "s/random(1, 10)/random(1, $TELLERS)/" "$DATA_DIR/tpcb.sql"

  env $pgenv pgbench \
    -h 127.0.0.1 -p "$port" -U "$user" -d postgres \
    -f "$DATA_DIR/tpcb.sql" \
    -c "$CONCURRENT" -j "$CONCURRENT" \
    -t "$ITERATIONS" \
    --no-vacuum \
    >"$logfile.run" 2>&1
  grep -E '(tps =|latency|transactions|scaling|clients|threads|query mode)' "$logfile.run" || true
}

parse_pgbench_output() {
  local logfile="$1"
  local tps latency_avg latency_stddev transactions
  tps=$(grep -oP 'tps = \K[0-9.]+' "$logfile.run" | tail -1 || echo "0")
  latency_avg=$(grep -oP 'latency average = \K[0-9.]+' "$logfile.run" || echo "0")
  latency_stddev=$(grep -oP 'latency stddev = \K[0-9.]+' "$logfile.run" || echo "0")
  transactions=$(grep -oP 'number of transactions actually processed: \K[0-9]+' "$logfile.run" || echo "0")
  echo "{\"tps\": $tps, \"latency_avg_ms\": $latency_avg, \"latency_stddev_ms\": $latency_stddev, \"transactions\": $transactions}"
}

echo "============================================"
echo " nano-supabase TPC-B Benchmark"
echo " $(date -u)"
echo "============================================"
echo ""
echo "Config:"
echo "  Accounts:     $ACCOUNTS"
echo "  Tellers:      $TELLERS"
echo "  Branches:     $BRANCHES"
echo "  Iterations:   $ITERATIONS (per client)"
echo "  Concurrent:   $CONCURRENT"
echo "  Tenant count: $TENANT_COUNT"
echo ""

mkdir -p "$RESULTS_DIR"

cd "$PROJECT_DIR"

# ── Phase 1: CLI mode ────────────────────────────────────────────────────────

echo "── Phase 1: CLI mode (single instance) ──"
echo "  Starting server on HTTP=$CLI_HTTP_PORT TCP=$CLI_TCP_PORT..."

node dist/cli.js start \
  --http-port="$CLI_HTTP_PORT" \
  --tcp-port="$CLI_TCP_PORT" \
  --data-dir="$DATA_DIR/cli" \
  >"$DATA_DIR/cli-server.log" 2>&1 &
PIDS+=($!)

wait_for_health "http://127.0.0.1:$CLI_HTTP_PORT"
wait_for_tcp "$CLI_TCP_PORT"
echo "  Server ready."

echo "  Initializing TPC-B schema ($ACCOUNTS accounts, $TELLERS tellers, $BRANCHES branches)..."
init_tpcb_schema "$CLI_TCP_PORT"
echo "  Schema ready."

echo "  Running TPC-B ($CONCURRENT clients x $ITERATIONS transactions)..."
run_tpcb_bench "$CLI_TCP_PORT" "cli" "$DATA_DIR/cli-pgbench"
CLI_RESULT=$(parse_pgbench_output "$DATA_DIR/cli-pgbench")
echo ""
echo "  CLI result: $CLI_RESULT"
echo ""

kill "${PIDS[-1]}" 2>/dev/null || true
wait "${PIDS[-1]}" 2>/dev/null || true
unset 'PIDS[-1]'

# ── Phase 2: Service mode ────────────────────────────────────────────────────

echo "── Phase 2: Service mode ($TENANT_COUNT tenants) ──"
echo "  Starting service on port=$SERVICE_PORT TCP=$SERVICE_TCP_PORT..."

node dist/cli.js service \
  --service-port="$SERVICE_PORT" \
  --tcp-port="$SERVICE_TCP_PORT" \
  --admin-token="$ADMIN_TOKEN" \
  --secret="$SECRET" \
  --data-dir="$DATA_DIR/service" \
  >"$DATA_DIR/service-server.log" 2>&1 &
PIDS+=($!)

wait_for_health "http://127.0.0.1:$SERVICE_PORT"
echo "  Service ready."

declare -A TENANT_PASSWORDS
TENANT_RESULTS="["

for i in $(seq 1 "$TENANT_COUNT"); do
  slug="bench-tenant-$i"
  echo "  Creating tenant: $slug"

  response=$(curl -sf -X POST "http://127.0.0.1:$SERVICE_PORT/admin/tenants" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"slug\": \"$slug\"}")

  password=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('password',''))" 2>/dev/null || echo "")
  TENANT_PASSWORDS[$slug]="$password"
  echo "    Created (password=${password:0:8}...)"
done

echo ""
echo "  Waiting for tenants to be fully initialized..."
sleep 5

for i in $(seq 1 "$TENANT_COUNT"); do
  slug="bench-tenant-$i"
  password="${TENANT_PASSWORDS[$slug]}"
  echo "  Initializing schema for tenant: $slug"
  init_tpcb_schema "$SERVICE_TCP_PORT" "$password" "$slug"
done

echo ""

for i in $(seq 1 "$TENANT_COUNT"); do
  slug="bench-tenant-$i"
  password="${TENANT_PASSWORDS[$slug]}"
  echo "  Benchmarking tenant: $slug"

  run_tpcb_bench "$SERVICE_TCP_PORT" "$slug" "$DATA_DIR/service-$slug" "$password" "$slug"
  tenant_result=$(parse_pgbench_output "$DATA_DIR/service-$slug")
  echo "    Result: $tenant_result"
  echo ""

  if [ "$i" -gt 1 ]; then TENANT_RESULTS+=","; fi
  TENANT_RESULTS+="{\"slug\": \"$slug\", \"results\": $tenant_result}"
done

TENANT_RESULTS+="]"

kill "${PIDS[-1]}" 2>/dev/null || true
wait "${PIDS[-1]}" 2>/dev/null || true
unset 'PIDS[-1]'

# ── Results ───────────────────────────────────────────────────────────────────

SYSTEM_INFO=$(cat <<SYSEOF
{
  "node_version": "$(node --version)",
  "platform": "$(uname -s)",
  "arch": "$(uname -m)",
  "cpus": $(nproc),
  "pgbench_version": "$(pgbench --version | head -1)"
}
SYSEOF
)

cat > "$RESULT_FILE" <<JSONEOF
{
  "timestamp": "$TIMESTAMP",
  "config": {
    "accounts": $ACCOUNTS,
    "tellers": $TELLERS,
    "branches": $BRANCHES,
    "iterations_per_client": $ITERATIONS,
    "concurrent_clients": $CONCURRENT,
    "tenant_count": $TENANT_COUNT
  },
  "system": $SYSTEM_INFO,
  "cli_mode": $CLI_RESULT,
  "service_mode": {
    "tenant_count": $TENANT_COUNT,
    "tenants": $TENANT_RESULTS
  }
}
JSONEOF

echo "============================================"
echo " Results saved to: $RESULT_FILE"
echo "============================================"
echo ""
cat "$RESULT_FILE" | python3 -m json.tool 2>/dev/null || cat "$RESULT_FILE"
