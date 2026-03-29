#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="$PROJECT_DIR/benchmarks"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RESULT_FILE="$RESULTS_DIR/tpcc-$TIMESTAMP.json"

CLI_HTTP_PORT="${CLI_HTTP_PORT:-54389}"
CLI_TCP_PORT="${CLI_TCP_PORT:-54388}"
SERVICE_PORT="${SERVICE_PORT:-54387}"
SERVICE_TCP_PORT="${SERVICE_TCP_PORT:-54386}"
ADMIN_TOKEN="bench-admin-token"
SECRET="bench-secret-key-for-encryption"
TENANT_COUNT="${TENANT_COUNT:-3}"
WAREHOUSES="${WAREHOUSES:-1}"
DISTRICTS="${DISTRICTS:-5}"
CUSTOMERS="${CUSTOMERS:-30}"
PRODUCTS="${PRODUCTS:-100}"
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

init_tpcc_schema() {
  local port="$1" password="${2:-}" user="${3:-postgres}"
  local pgenv=""
  [ -n "$password" ] && pgenv="PGPASSWORD=$password"

  env $pgenv psql -h 127.0.0.1 -p "$port" -U "$user" -d postgres -q <<SQL
DROP TABLE IF EXISTS tpcc_order_line CASCADE;
DROP TABLE IF EXISTS tpcc_new_order CASCADE;
DROP TABLE IF EXISTS tpcc_orders CASCADE;
DROP TABLE IF EXISTS tpcc_history CASCADE;
DROP TABLE IF EXISTS tpcc_stock CASCADE;
DROP TABLE IF EXISTS tpcc_customer CASCADE;
DROP TABLE IF EXISTS tpcc_district CASCADE;
DROP TABLE IF EXISTS tpcc_warehouse CASCADE;
DROP TABLE IF EXISTS tpcc_item CASCADE;

CREATE TABLE tpcc_warehouse (
  w_id INT PRIMARY KEY,
  w_name TEXT NOT NULL,
  w_ytd NUMERIC(12,2) DEFAULT 0
);

CREATE TABLE tpcc_district (
  d_id INT NOT NULL,
  d_w_id INT NOT NULL REFERENCES tpcc_warehouse(w_id),
  d_name TEXT NOT NULL,
  d_ytd NUMERIC(12,2) DEFAULT 0,
  d_next_o_id INT DEFAULT 1,
  PRIMARY KEY (d_w_id, d_id)
);

CREATE TABLE tpcc_customer (
  c_id INT NOT NULL,
  c_d_id INT NOT NULL,
  c_w_id INT NOT NULL,
  c_first TEXT NOT NULL,
  c_last TEXT NOT NULL,
  c_balance NUMERIC(12,2) DEFAULT 0,
  c_ytd_payment NUMERIC(12,2) DEFAULT 0,
  c_payment_cnt INT DEFAULT 0,
  c_delivery_cnt INT DEFAULT 0,
  PRIMARY KEY (c_w_id, c_d_id, c_id),
  FOREIGN KEY (c_w_id, c_d_id) REFERENCES tpcc_district(d_w_id, d_id)
);

CREATE TABLE tpcc_item (
  i_id INT PRIMARY KEY,
  i_name TEXT NOT NULL,
  i_price NUMERIC(5,2) NOT NULL
);

CREATE TABLE tpcc_stock (
  s_i_id INT NOT NULL REFERENCES tpcc_item(i_id),
  s_w_id INT NOT NULL REFERENCES tpcc_warehouse(w_id),
  s_quantity INT DEFAULT 100,
  s_ytd INT DEFAULT 0,
  s_order_cnt INT DEFAULT 0,
  PRIMARY KEY (s_i_id, s_w_id)
);

CREATE TABLE tpcc_orders (
  o_id INT NOT NULL,
  o_d_id INT NOT NULL,
  o_w_id INT NOT NULL,
  o_c_id INT NOT NULL,
  o_entry_d TIMESTAMP DEFAULT NOW(),
  o_ol_cnt INT DEFAULT 0,
  o_all_local INT DEFAULT 1,
  PRIMARY KEY (o_w_id, o_d_id, o_id),
  FOREIGN KEY (o_w_id, o_d_id, o_c_id) REFERENCES tpcc_customer(c_w_id, c_d_id, c_id)
);

CREATE TABLE tpcc_new_order (
  no_o_id INT NOT NULL,
  no_d_id INT NOT NULL,
  no_w_id INT NOT NULL,
  PRIMARY KEY (no_w_id, no_d_id, no_o_id),
  FOREIGN KEY (no_w_id, no_d_id, no_o_id) REFERENCES tpcc_orders(o_w_id, o_d_id, o_id)
);

CREATE TABLE tpcc_order_line (
  ol_o_id INT NOT NULL,
  ol_d_id INT NOT NULL,
  ol_w_id INT NOT NULL,
  ol_number INT NOT NULL,
  ol_i_id INT NOT NULL REFERENCES tpcc_item(i_id),
  ol_supply_w_id INT NOT NULL,
  ol_quantity INT DEFAULT 5,
  ol_amount NUMERIC(6,2) DEFAULT 0,
  ol_delivery_d TIMESTAMP,
  PRIMARY KEY (ol_w_id, ol_d_id, ol_o_id, ol_number),
  FOREIGN KEY (ol_w_id, ol_d_id, ol_o_id) REFERENCES tpcc_orders(o_w_id, o_d_id, o_id)
);

CREATE INDEX idx_tpcc_customer_last ON tpcc_customer (c_w_id, c_d_id, c_last);
CREATE INDEX idx_tpcc_orders_customer ON tpcc_orders (o_w_id, o_d_id, o_c_id);

INSERT INTO tpcc_warehouse SELECT g, 'Warehouse ' || g, 300000.00 FROM generate_series(1, $WAREHOUSES) g;
INSERT INTO tpcc_district SELECT d, w, 'District ' || d, 30000.00, 1 FROM generate_series(1, $WAREHOUSES) w, generate_series(1, $DISTRICTS) d;
INSERT INTO tpcc_customer SELECT c, d, w, 'First' || c, 'Last' || c, -10.00, 10.00, 1, 0 FROM generate_series(1, $WAREHOUSES) w, generate_series(1, $DISTRICTS) d, generate_series(1, $CUSTOMERS) c;
INSERT INTO tpcc_item SELECT g, 'Item ' || g, (random() * 99 + 1)::NUMERIC(5,2) FROM generate_series(1, $PRODUCTS) g;
INSERT INTO tpcc_stock SELECT i, w, (random() * 90 + 10)::INT, 0, 0 FROM generate_series(1, $WAREHOUSES) w, generate_series(1, $PRODUCTS) i;
SQL
}

write_pgbench_scripts() {
  cat > "$DATA_DIR/tpcc_new_order.sql" <<TPCCSQL
\\set w_id random(1, $WAREHOUSES)
\\set d_id random(1, $DISTRICTS)
\\set c_id random(1, $CUSTOMERS)
\\set ol_cnt random(5, 10)
\\set i_id random(1, $PRODUCTS)
BEGIN;
UPDATE tpcc_district SET d_next_o_id = d_next_o_id + 1 WHERE d_w_id = :w_id AND d_id = :d_id RETURNING d_next_o_id - 1 AS o_id;
SELECT i_price FROM tpcc_item WHERE i_id = :i_id;
UPDATE tpcc_stock SET s_quantity = CASE WHEN s_quantity > :ol_cnt THEN s_quantity - :ol_cnt ELSE s_quantity + 91 - :ol_cnt END, s_ytd = s_ytd + :ol_cnt, s_order_cnt = s_order_cnt + 1 WHERE s_i_id = :i_id AND s_w_id = :w_id;
UPDATE tpcc_warehouse SET w_ytd = w_ytd + 1 WHERE w_id = :w_id;
COMMIT;
TPCCSQL

  cat > "$DATA_DIR/tpcc_payment.sql" <<TPCCSQL
\\set w_id random(1, $WAREHOUSES)
\\set d_id random(1, $DISTRICTS)
\\set c_id random(1, $CUSTOMERS)
\\set amount random(1, 5000)
BEGIN;
UPDATE tpcc_warehouse SET w_ytd = w_ytd + :amount WHERE w_id = :w_id;
UPDATE tpcc_district SET d_ytd = d_ytd + :amount WHERE d_w_id = :w_id AND d_id = :d_id;
UPDATE tpcc_customer SET c_balance = c_balance - :amount, c_ytd_payment = c_ytd_payment + :amount, c_payment_cnt = c_payment_cnt + 1 WHERE c_w_id = :w_id AND c_d_id = :d_id AND c_id = :c_id;
SELECT c_first, c_last, c_balance FROM tpcc_customer WHERE c_w_id = :w_id AND c_d_id = :d_id AND c_id = :c_id;
COMMIT;
TPCCSQL

  cat > "$DATA_DIR/tpcc_order_status.sql" <<TPCCSQL
\\set w_id random(1, $WAREHOUSES)
\\set d_id random(1, $DISTRICTS)
\\set c_id random(1, $CUSTOMERS)
SELECT c_first, c_last, c_balance FROM tpcc_customer WHERE c_w_id = :w_id AND c_d_id = :d_id AND c_id = :c_id;
SELECT o_id, o_entry_d, o_ol_cnt FROM tpcc_orders WHERE o_w_id = :w_id AND o_d_id = :d_id AND o_c_id = :c_id ORDER BY o_id DESC LIMIT 1;
TPCCSQL

  cat > "$DATA_DIR/tpcc_stock_level.sql" <<TPCCSQL
\\set w_id random(1, $WAREHOUSES)
\\set d_id random(1, $DISTRICTS)
\\set threshold random(10, 20)
SELECT COUNT(DISTINCT s_i_id) FROM tpcc_order_line ol JOIN tpcc_stock s ON s.s_i_id = ol.ol_i_id AND s.s_w_id = ol.ol_w_id WHERE ol.ol_w_id = :w_id AND ol.ol_d_id = :d_id AND s.s_quantity < :threshold;
TPCCSQL
}

run_tpcc_bench() {
  local port="$1" label="$2" logfile="$3" password="${4:-}" user="${5:-postgres}"
  local pgenv=""
  [ -n "$password" ] && pgenv="PGPASSWORD=$password"

  write_pgbench_scripts

  local new_order_weight=45
  local payment_weight=43
  local order_status_weight=4
  local stock_level_weight=4

  local new_order_iters=$(( ITERATIONS * new_order_weight / 100 ))
  local payment_iters=$(( ITERATIONS * payment_weight / 100 ))
  local order_status_iters=$(( ITERATIONS * order_status_weight / 100 ))
  local stock_level_iters=$(( ITERATIONS * stock_level_weight / 100 ))

  echo "    New Order:    $new_order_weight% ($new_order_iters iters)"
  echo "    Payment:      $payment_weight% ($payment_iters iters)"
  echo "    Order Status: $order_status_weight% ($order_status_iters iters)"
  echo "    Stock Level:  $stock_level_weight% ($stock_level_iters iters)"

  echo "    Running New Order (single client — serialized district update)..."
  env $pgenv pgbench \
    -h 127.0.0.1 -p "$port" -U "$user" -d postgres \
    -f "$DATA_DIR/tpcc_new_order.sql" \
    -c 1 -j 1 \
    -t "$new_order_iters" \
    --no-vacuum \
    >"$logfile.new_order.run" 2>&1
  grep -E '(tps =|latency|transactions)' "$logfile.new_order.run" | head -5 || true

  echo "    Running Payment..."
  env $pgenv pgbench \
    -h 127.0.0.1 -p "$port" -U "$user" -d postgres \
    -f "$DATA_DIR/tpcc_payment.sql" \
    -c "$CONCURRENT" -j "$CONCURRENT" \
    -t "$payment_iters" \
    --no-vacuum \
    >"$logfile.payment.run" 2>&1
  grep -E '(tps =|latency|transactions)' "$logfile.payment.run" | head -5 || true

  echo "    Running Order Status..."
  env $pgenv pgbench \
    -h 127.0.0.1 -p "$port" -U "$user" -d postgres \
    -f "$DATA_DIR/tpcc_order_status.sql" \
    -c "$CONCURRENT" -j "$CONCURRENT" \
    -t "$order_status_iters" \
    --no-vacuum \
    >"$logfile.order_status.run" 2>&1
  grep -E '(tps =|latency|transactions)' "$logfile.order_status.run" | head -5 || true

  echo "    Running Stock Level..."
  env $pgenv pgbench \
    -h 127.0.0.1 -p "$port" -U "$user" -d postgres \
    -f "$DATA_DIR/tpcc_stock_level.sql" \
    -c "$CONCURRENT" -j "$CONCURRENT" \
    -t "$stock_level_iters" \
    --no-vacuum \
    >"$logfile.stock_level.run" 2>&1
  grep -E '(tps =|latency|transactions)' "$logfile.stock_level.run" | head -5 || true
}

parse_pgbench_output() {
  local logfile="$1"
  local tps latency_avg transactions
  tps=$(grep -oP 'tps = \K[0-9.]+' "$logfile" | tail -1 || echo "0")
  latency_avg=$(grep -oP 'latency average = \K[0-9.]+' "$logfile" || echo "0")
  transactions=$(grep -oP 'number of transactions actually processed: \K[0-9]+' "$logfile" || echo "0")
  echo "{\"tps\": $tps, \"latency_avg_ms\": $latency_avg, \"transactions\": $transactions}"
}

parse_tpcc_results() {
  local logfile="$1"
  local no_result pay_result os_result sl_result
  no_result=$(parse_pgbench_output "$logfile.new_order.run")
  pay_result=$(parse_pgbench_output "$logfile.payment.run")
  os_result=$(parse_pgbench_output "$logfile.order_status.run")
  sl_result=$(parse_pgbench_output "$logfile.stock_level.run")
  echo "{\"new_order\": $no_result, \"payment\": $pay_result, \"order_status\": $os_result, \"stock_level\": $sl_result}"
}

echo "============================================"
echo " nano-supabase TPC-C Benchmark"
echo " $(date -u)"
echo "============================================"
echo ""
echo "Config:"
echo "  Warehouses:   $WAREHOUSES"
echo "  Districts:    $DISTRICTS"
echo "  Customers:    $CUSTOMERS"
echo "  Products:     $PRODUCTS"
echo "  Iterations:   $ITERATIONS (per client, split by tx type)"
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

echo "  Initializing TPC-C schema..."
init_tpcc_schema "$CLI_TCP_PORT"
echo "  Schema ready."

echo "  Running TPC-C benchmark..."
run_tpcc_bench "$CLI_TCP_PORT" "cli" "$DATA_DIR/cli-tpcc"
CLI_RESULT=$(parse_tpcc_results "$DATA_DIR/cli-tpcc")
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
echo "  Waiting for tenants to initialize..."
sleep 5

for i in $(seq 1 "$TENANT_COUNT"); do
  slug="bench-tenant-$i"
  password="${TENANT_PASSWORDS[$slug]}"
  echo "  Initializing TPC-C schema for tenant: $slug"
  init_tpcc_schema "$SERVICE_TCP_PORT" "$password" "$slug"
done

echo ""

for i in $(seq 1 "$TENANT_COUNT"); do
  slug="bench-tenant-$i"
  password="${TENANT_PASSWORDS[$slug]}"
  echo "  Benchmarking tenant: $slug"

  run_tpcc_bench "$SERVICE_TCP_PORT" "$slug" "$DATA_DIR/service-$slug" "$password" "$slug"
  tenant_result=$(parse_tpcc_results "$DATA_DIR/service-$slug")
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
  "benchmark": "tpc-c",
  "timestamp": "$TIMESTAMP",
  "config": {
    "warehouses": $WAREHOUSES,
    "districts": $DISTRICTS,
    "customers": $CUSTOMERS,
    "products": $PRODUCTS,
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
