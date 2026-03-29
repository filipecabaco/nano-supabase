#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="$PROJECT_DIR/benchmarks"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RESULT_FILE="$RESULTS_DIR/tpch-$TIMESTAMP.json"

CLI_HTTP_PORT="${CLI_HTTP_PORT:-54379}"
CLI_TCP_PORT="${CLI_TCP_PORT:-54378}"
SERVICE_PORT="${SERVICE_PORT:-54377}"
SERVICE_TCP_PORT="${SERVICE_TCP_PORT:-54376}"
ADMIN_TOKEN="bench-admin-token"
SECRET="bench-secret-key-for-encryption"
TENANT_COUNT="${TENANT_COUNT:-3}"
SCALE="${SCALE:-1}"
SUPPLIERS="${SUPPLIERS:-20}"
CUSTOMERS="${CUSTOMERS:-150}"
ORDERS="${ORDERS:-500}"
PARTS="${PARTS:-200}"

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

init_tpch_schema() {
  local port="$1" password="${2:-}" user="${3:-postgres}"
  local pgenv=""
  [ -n "$password" ] && pgenv="PGPASSWORD=$password"

  env $pgenv psql -h 127.0.0.1 -p "$port" -U "$user" -d postgres -q <<SQL
DROP TABLE IF EXISTS tpch_lineitem CASCADE;
DROP TABLE IF EXISTS tpch_orders CASCADE;
DROP TABLE IF EXISTS tpch_partsupp CASCADE;
DROP TABLE IF EXISTS tpch_customer CASCADE;
DROP TABLE IF EXISTS tpch_supplier CASCADE;
DROP TABLE IF EXISTS tpch_part CASCADE;
DROP TABLE IF EXISTS tpch_nation CASCADE;
DROP TABLE IF EXISTS tpch_region CASCADE;

CREATE TABLE tpch_region (
  r_regionkey INT PRIMARY KEY,
  r_name TEXT NOT NULL
);

CREATE TABLE tpch_nation (
  n_nationkey INT PRIMARY KEY,
  n_name TEXT NOT NULL,
  n_regionkey INT REFERENCES tpch_region(r_regionkey)
);

CREATE TABLE tpch_supplier (
  s_suppkey INT PRIMARY KEY,
  s_name TEXT NOT NULL,
  s_nationkey INT REFERENCES tpch_nation(n_nationkey),
  s_acctbal NUMERIC(12,2) DEFAULT 0
);

CREATE TABLE tpch_part (
  p_partkey INT PRIMARY KEY,
  p_name TEXT NOT NULL,
  p_brand TEXT,
  p_type TEXT,
  p_size INT,
  p_retailprice NUMERIC(12,2)
);

CREATE TABLE tpch_partsupp (
  ps_partkey INT NOT NULL REFERENCES tpch_part(p_partkey),
  ps_suppkey INT NOT NULL REFERENCES tpch_supplier(s_suppkey),
  ps_availqty INT DEFAULT 100,
  ps_supplycost NUMERIC(12,2) DEFAULT 10.00,
  PRIMARY KEY (ps_partkey, ps_suppkey)
);

CREATE TABLE tpch_customer (
  c_custkey INT PRIMARY KEY,
  c_name TEXT NOT NULL,
  c_nationkey INT REFERENCES tpch_nation(n_nationkey),
  c_acctbal NUMERIC(12,2) DEFAULT 0,
  c_mktsegment TEXT
);

CREATE TABLE tpch_orders (
  o_orderkey INT PRIMARY KEY,
  o_custkey INT REFERENCES tpch_customer(c_custkey),
  o_orderstatus TEXT,
  o_totalprice NUMERIC(12,2) DEFAULT 0,
  o_orderdate DATE NOT NULL,
  o_orderpriority TEXT,
  o_shippriority INT DEFAULT 0
);

CREATE TABLE tpch_lineitem (
  l_orderkey INT NOT NULL REFERENCES tpch_orders(o_orderkey),
  l_linenumber INT NOT NULL,
  l_partkey INT REFERENCES tpch_part(p_partkey),
  l_suppkey INT REFERENCES tpch_supplier(s_suppkey),
  l_quantity NUMERIC(12,2),
  l_extendedprice NUMERIC(12,2),
  l_discount NUMERIC(12,2),
  l_tax NUMERIC(12,2),
  l_returnflag TEXT,
  l_linestatus TEXT,
  l_shipdate DATE,
  l_commitdate DATE,
  l_receiptdate DATE,
  l_shipmode TEXT,
  PRIMARY KEY (l_orderkey, l_linenumber)
);

CREATE INDEX idx_tpch_lineitem_shipdate ON tpch_lineitem(l_shipdate);
CREATE INDEX idx_tpch_orders_orderdate ON tpch_orders(o_orderdate);
CREATE INDEX idx_tpch_orders_custkey ON tpch_orders(o_custkey);
CREATE INDEX idx_tpch_customer_nation ON tpch_customer(c_nationkey);
CREATE INDEX idx_tpch_supplier_nation ON tpch_supplier(s_nationkey);
CREATE INDEX idx_tpch_lineitem_suppkey ON tpch_lineitem(l_suppkey);
CREATE INDEX idx_tpch_lineitem_partkey ON tpch_lineitem(l_partkey);

INSERT INTO tpch_region VALUES (0,'AFRICA'),(1,'AMERICA'),(2,'ASIA'),(3,'EUROPE'),(4,'MIDDLE EAST');

INSERT INTO tpch_nation VALUES
  (0,'ALGERIA',0),(1,'ARGENTINA',1),(2,'BRAZIL',1),(3,'CANADA',1),
  (4,'EGYPT',4),(5,'ETHIOPIA',0),(6,'FRANCE',3),(7,'GERMANY',3),
  (8,'INDIA',2),(9,'INDONESIA',2),(10,'IRAN',4),(11,'IRAQ',4),
  (12,'JAPAN',2),(13,'JORDAN',4),(14,'KENYA',0),(15,'MOROCCO',0),
  (16,'MOZAMBIQUE',0),(17,'PERU',1),(18,'CHINA',2),(19,'ROMANIA',3),
  (20,'SAUDI ARABIA',4),(21,'VIETNAM',2),(22,'RUSSIA',3),(23,'UK',3),
  (24,'USA',1);

INSERT INTO tpch_supplier
  SELECT g, 'Supplier#' || LPAD(g::TEXT, 4, '0'), (g % 25), (random() * 9999)::NUMERIC(12,2)
  FROM generate_series(1, $SUPPLIERS) g;

INSERT INTO tpch_part
  SELECT g, 'Part ' || g,
    'Brand#' || ((g % 5) + 1) || ((g % 5) + 1),
    CASE g % 5 WHEN 0 THEN 'STANDARD' WHEN 1 THEN 'SMALL' WHEN 2 THEN 'MEDIUM' WHEN 3 THEN 'LARGE' ELSE 'ECONOMY' END,
    (g % 50) + 1,
    (random() * 2000)::NUMERIC(12,2)
  FROM generate_series(1, $PARTS) g;

INSERT INTO tpch_partsupp
  SELECT p, ((p + s - 2) % $SUPPLIERS) + 1, (random() * 9999)::INT, (random() * 999)::NUMERIC(12,2)
  FROM generate_series(1, $PARTS) p, generate_series(1, LEAST(4, $SUPPLIERS)) s;

INSERT INTO tpch_customer
  SELECT g, 'Customer#' || LPAD(g::TEXT, 6, '0'), (g % 25), (random() * 9999 - 999)::NUMERIC(12,2),
    CASE g % 5 WHEN 0 THEN 'AUTOMOBILE' WHEN 1 THEN 'BUILDING' WHEN 2 THEN 'FURNITURE' WHEN 3 THEN 'MACHINERY' ELSE 'HOUSEHOLD' END
  FROM generate_series(1, $CUSTOMERS) g;

INSERT INTO tpch_orders
  SELECT g, ((g - 1) % $CUSTOMERS) + 1,
    CASE g % 3 WHEN 0 THEN 'F' WHEN 1 THEN 'O' ELSE 'P' END,
    0,
    DATE '1992-01-01' + (random() * 2556)::INT,
    CASE g % 5 WHEN 0 THEN '1-URGENT' WHEN 1 THEN '2-HIGH' WHEN 2 THEN '3-MEDIUM' WHEN 3 THEN '4-NOT SPECIFIED' ELSE '5-LOW' END,
    0
  FROM generate_series(1, $ORDERS) g;

INSERT INTO tpch_lineitem
  SELECT o, ln,
    ((o + ln - 2) % $PARTS) + 1,
    ((o + ln - 2) % $SUPPLIERS) + 1,
    (random() * 49 + 1)::NUMERIC(12,2),
    (random() * 99999)::NUMERIC(12,2),
    (random() * 0.1)::NUMERIC(12,2),
    (random() * 0.08)::NUMERIC(12,2),
    CASE (o + ln) % 3 WHEN 0 THEN 'R' WHEN 1 THEN 'A' ELSE 'N' END,
    CASE (o + ln) % 2 WHEN 0 THEN 'F' ELSE 'O' END,
    DATE '1992-01-01' + (random() * 2556)::INT,
    DATE '1992-01-01' + (random() * 2556)::INT,
    DATE '1992-01-01' + (random() * 2556)::INT,
    CASE (o + ln) % 7 WHEN 0 THEN 'TRUCK' WHEN 1 THEN 'MAIL' WHEN 2 THEN 'SHIP' WHEN 3 THEN 'AIR' WHEN 4 THEN 'RAIL' WHEN 5 THEN 'REG AIR' ELSE 'FOB' END
  FROM generate_series(1, $ORDERS) o, generate_series(1, LEAST(4, GREATEST(1, (o % 7) + 1))) ln;

UPDATE tpch_orders o SET o_totalprice = (SELECT COALESCE(SUM(l_extendedprice * (1 - l_discount) * (1 + l_tax)), 0) FROM tpch_lineitem l WHERE l.l_orderkey = o.o_orderkey);

ANALYZE;
SQL
}

write_tpch_queries() {
  cat > "$DATA_DIR/q1_pricing_summary.sql" <<'SQL'
SELECT l_returnflag, l_linestatus, SUM(l_quantity) AS sum_qty, SUM(l_extendedprice) AS sum_base_price, SUM(l_extendedprice * (1 - l_discount)) AS sum_disc_price, SUM(l_extendedprice * (1 - l_discount) * (1 + l_tax)) AS sum_charge, AVG(l_quantity) AS avg_qty, AVG(l_extendedprice) AS avg_price, AVG(l_discount) AS avg_disc, COUNT(*) AS count_order FROM tpch_lineitem WHERE l_shipdate <= DATE '1998-12-01' - INTERVAL '90 days' GROUP BY l_returnflag, l_linestatus ORDER BY l_returnflag, l_linestatus;
SQL

  cat > "$DATA_DIR/q3_shipping_priority.sql" <<'SQL'
SELECT l_orderkey, SUM(l_extendedprice * (1 - l_discount)) AS revenue, o_orderdate, o_shippriority FROM tpch_customer c JOIN tpch_orders o ON c.c_custkey = o.o_custkey JOIN tpch_lineitem l ON l.l_orderkey = o.o_orderkey WHERE c_mktsegment = 'BUILDING' AND o_orderdate < DATE '1995-03-15' AND l_shipdate > DATE '1995-03-15' GROUP BY l_orderkey, o_orderdate, o_shippriority ORDER BY revenue DESC, o_orderdate LIMIT 10;
SQL

  cat > "$DATA_DIR/q4_order_priority.sql" <<'SQL'
SELECT o_orderpriority, COUNT(*) AS order_count FROM tpch_orders WHERE o_orderdate >= DATE '1993-07-01' AND o_orderdate < DATE '1993-10-01' AND EXISTS (SELECT 1 FROM tpch_lineitem WHERE l_orderkey = o_orderkey AND l_commitdate < l_receiptdate) GROUP BY o_orderpriority ORDER BY o_orderpriority;
SQL

  cat > "$DATA_DIR/q5_local_supplier_volume.sql" <<'SQL'
SELECT n_name, SUM(l_extendedprice * (1 - l_discount)) AS revenue FROM tpch_customer c JOIN tpch_orders o ON c.c_custkey = o.o_custkey JOIN tpch_lineitem l ON l.l_orderkey = o.o_orderkey JOIN tpch_supplier s ON l.l_suppkey = s.s_suppkey JOIN tpch_nation n ON c.c_nationkey = n.n_nationkey AND s.s_nationkey = n.n_nationkey JOIN tpch_region r ON n.n_regionkey = r.r_regionkey WHERE r_name = 'ASIA' AND o_orderdate >= DATE '1994-01-01' AND o_orderdate < DATE '1995-01-01' GROUP BY n_name ORDER BY revenue DESC;
SQL

  cat > "$DATA_DIR/q6_revenue_forecast.sql" <<'SQL'
SELECT SUM(l_extendedprice * l_discount) AS revenue FROM tpch_lineitem WHERE l_shipdate >= DATE '1994-01-01' AND l_shipdate < DATE '1995-01-01' AND l_discount BETWEEN 0.05 AND 0.07 AND l_quantity < 24;
SQL

  cat > "$DATA_DIR/q10_returned_item.sql" <<'SQL'
SELECT c_custkey, c_name, SUM(l_extendedprice * (1 - l_discount)) AS revenue, c_acctbal, n_name FROM tpch_customer c JOIN tpch_orders o ON c.c_custkey = o.o_custkey JOIN tpch_lineitem l ON l.l_orderkey = o.o_orderkey JOIN tpch_nation n ON c.c_nationkey = n.n_nationkey WHERE o_orderdate >= DATE '1993-10-01' AND o_orderdate < DATE '1994-01-01' AND l_returnflag = 'R' GROUP BY c_custkey, c_name, c_acctbal, n_name ORDER BY revenue DESC LIMIT 20;
SQL

  cat > "$DATA_DIR/q12_ship_mode.sql" <<'SQL'
SELECT l_shipmode, SUM(CASE WHEN o_orderpriority = '1-URGENT' OR o_orderpriority = '2-HIGH' THEN 1 ELSE 0 END) AS high_line_count, SUM(CASE WHEN o_orderpriority <> '1-URGENT' AND o_orderpriority <> '2-HIGH' THEN 1 ELSE 0 END) AS low_line_count FROM tpch_orders o JOIN tpch_lineitem l ON o.o_orderkey = l.l_orderkey WHERE l_shipmode IN ('MAIL', 'SHIP') AND l_commitdate < l_receiptdate AND l_shipdate < l_commitdate AND l_receiptdate >= DATE '1994-01-01' AND l_receiptdate < DATE '1995-01-01' GROUP BY l_shipmode ORDER BY l_shipmode;
SQL

  cat > "$DATA_DIR/q14_promotion_effect.sql" <<'SQL'
SELECT 100.00 * SUM(CASE WHEN p_type LIKE 'PROMO%' THEN l_extendedprice * (1 - l_discount) ELSE 0 END) / SUM(l_extendedprice * (1 - l_discount)) AS promo_revenue FROM tpch_lineitem l JOIN tpch_part p ON l.l_partkey = p.p_partkey WHERE l_shipdate >= DATE '1995-09-01' AND l_shipdate < DATE '1995-10-01';
SQL
}

run_tpch_bench() {
  local port="$1" label="$2" logfile="$3" password="${4:-}" user="${5:-postgres}"
  local pgenv=""
  [ -n "$password" ] && pgenv="PGPASSWORD=$password"

  write_tpch_queries

  local queries=(q1_pricing_summary q3_shipping_priority q4_order_priority q5_local_supplier_volume q6_revenue_forecast q10_returned_item q12_ship_mode q14_promotion_effect)
  local query_results="{"
  local first=true

  for q in "${queries[@]}"; do
    echo "    Running $q..."
    local start_ms=$(($(date +%s%N) / 1000000))

    env $pgenv psql -h 127.0.0.1 -p "$port" -U "$user" -d postgres \
      -f "$DATA_DIR/$q.sql" \
      -q --no-align --tuples-only \
      >"$logfile.$q.out" 2>"$logfile.$q.err"
    local exit_code=$?

    local end_ms=$(($(date +%s%N) / 1000000))
    local elapsed_ms=$((end_ms - start_ms))

    local rows=$(wc -l < "$logfile.$q.out" | tr -d ' ')
    local status="ok"
    if [ $exit_code -ne 0 ]; then
      status="error"
      echo "      ERROR: $(head -1 "$logfile.$q.err")"
    fi

    echo "      ${elapsed_ms}ms, ${rows} rows"

    if [ "$first" = true ]; then first=false; else query_results+=","; fi
    query_results+="\"$q\": {\"elapsed_ms\": $elapsed_ms, \"rows\": $rows, \"status\": \"$status\"}"
  done

  query_results+="}"
  echo "$query_results" > "$logfile.results.json"
}

parse_tpch_results() {
  local logfile="$1"
  cat "$logfile.results.json"
}

echo "============================================"
echo " nano-supabase TPC-H Benchmark"
echo " $(date -u)"
echo "============================================"
echo ""
echo "Config:"
echo "  Suppliers:    $SUPPLIERS"
echo "  Customers:    $CUSTOMERS"
echo "  Orders:       $ORDERS"
echo "  Parts:        $PARTS"
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

echo "  Initializing TPC-H schema..."
init_tpch_schema "$CLI_TCP_PORT"
echo "  Schema ready."

echo "  Running TPC-H queries..."
run_tpch_bench "$CLI_TCP_PORT" "cli" "$DATA_DIR/cli-tpch"
CLI_RESULT=$(parse_tpch_results "$DATA_DIR/cli-tpch")
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
  echo "  Initializing TPC-H schema for tenant: $slug"
  init_tpch_schema "$SERVICE_TCP_PORT" "$password" "$slug"
done

echo ""

for i in $(seq 1 "$TENANT_COUNT"); do
  slug="bench-tenant-$i"
  password="${TENANT_PASSWORDS[$slug]}"
  echo "  Benchmarking tenant: $slug"

  run_tpch_bench "$SERVICE_TCP_PORT" "$slug" "$DATA_DIR/service-$slug" "$password" "$slug"
  tenant_result=$(parse_tpch_results "$DATA_DIR/service-$slug")
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
  "psql_version": "$(psql --version | head -1)"
}
SYSEOF
)

cat > "$RESULT_FILE" <<JSONEOF
{
  "benchmark": "tpc-h",
  "timestamp": "$TIMESTAMP",
  "config": {
    "suppliers": $SUPPLIERS,
    "customers": $CUSTOMERS,
    "orders": $ORDERS,
    "parts": $PARTS,
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
