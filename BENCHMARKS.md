# Benchmark Results

Performance benchmarks for nano-supabase using standard TPC workloads against PGlite (PostgreSQL in WebAssembly) over the TCP wire protocol.

**Test environment:** Node.js v22.22.0, Linux x86_64, 4 CPUs, pgbench 16.11

## TPC-B — Simple OLTP Transactions

Standard TPC-B workload: BEGIN, UPDATE accounts, SELECT balance, UPDATE tellers, UPDATE branches, INSERT history, COMMIT.

**Config:** 100 accounts, 10 tellers, 1 branch, 4 concurrent clients, 500 transactions/client (2000 total)

### CLI Mode (single instance)

| Metric | Value |
|--------|-------|
| TPS | **320** |
| Avg latency | 12.5ms |
| Transactions | 2000 |

### Service Mode (3 tenants, sequential)

| Tenant | TPS | Avg Latency | Transactions |
|--------|-----|-------------|-------------|
| bench-tenant-1 | **315** | 12.7ms | 2000 |
| bench-tenant-2 | **336** | 11.9ms | 2000 |
| bench-tenant-3 | **337** | 11.9ms | 2000 |

Tenants achieve comparable throughput to CLI mode — the service routing layer adds negligible overhead.

## TPC-C — Complex OLTP Transactions

TPC-C workload split by transaction type: New Order (45%), Payment (43%), Order Status (4%), Stock Level (4%).

**Config:** 1 warehouse, 5 districts, 20 customers, 50 products, 2 concurrent clients (New Order: 1 client), 100 iterations/client

### CLI Mode

| Transaction | TPS | Avg Latency | Transactions |
|------------|-----|-------------|-------------|
| New Order | **243** | 4.1ms | 45 |
| Payment | **251** | 8.0ms | 86 |
| Order Status | **599** | 3.3ms | 8 |
| Stock Level | **962** | 2.1ms | 8 |

### Service Mode (2 tenants)

| Transaction | Tenant 1 TPS | Tenant 2 TPS | Latency Range |
|------------|-------------|-------------|---------------|
| New Order | 228 | **255** | 3.9–4.4ms |
| Payment | 258 | **276** | 7.2–7.7ms |
| Order Status | **677** | 585 | 2.9–3.4ms |
| Stock Level | 893 | **1035** | 1.9–2.2ms |

Read-heavy operations (Order Status, Stock Level) exceed 500–1000 TPS. Write-heavy transactions (New Order, Payment) sustain 230–280 TPS.

### Limitation: Concurrent Explicit Transactions

New Order runs single-client because the TCP server has a known limitation: all TCP connections share one PGlite instance with no per-connection transaction isolation. When two clients both send `BEGIN` and compete for the same row lock, the pooler deadlocks — Client B blocks on the lock held by Client A, while Client A's `COMMIT` is queued behind Client B's blocked query.

## TPC-H — Analytical Queries

8 TPC-H decision-support queries against a star schema with joins and aggregations.

**Config:** 10 suppliers, 50 customers, 200 orders, 50 parts

### CLI Mode

| Query | Description | Latency | Rows |
|-------|-------------|---------|------|
| Q1 | Pricing Summary | 35ms | 6 |
| Q3 | Shipping Priority | 35ms | 10 |
| Q4 | Order Priority Checking | 33ms | 5 |
| Q5 | Local Supplier Volume | 34ms | 1 |
| Q6 | Revenue Forecast | 31ms | 1 |
| Q10 | Returned Item Reporting | 31ms | 4 |
| Q12 | Shipping Modes | 29ms | 0 |
| Q14 | Promotion Effect | 32ms | 1 |

### Service Mode (2 tenants)

| Query | Tenant 1 | Tenant 2 |
|-------|----------|----------|
| Q1 — Pricing Summary | 35ms | 33ms |
| Q3 — Shipping Priority | 34ms | 32ms |
| Q4 — Order Priority | 31ms | 33ms |
| Q5 — Local Supplier Volume | 33ms | 34ms |
| Q6 — Revenue Forecast | 31ms | 32ms |
| Q10 — Returned Item | 34ms | 34ms |
| Q12 — Shipping Modes | 31ms | 33ms |
| Q14 — Promotion Effect | 32ms | 30ms |

All queries complete in **29–35ms** with zero failures. Service mode adds no measurable overhead to analytical query execution.

## Running Benchmarks

```bash
pnpm bench              # TPC-B with defaults
pnpm bench:tpc-b        # TPC-B only
pnpm bench:tpc-c        # TPC-C only
pnpm bench:tpc-h        # TPC-H only
pnpm bench:all          # All three sequentially
```

Override defaults with environment variables:

```bash
# TPC-B
ACCOUNTS=200 ITERATIONS=1000 CONCURRENT=8 TENANT_COUNT=5 pnpm bench:tpc-b

# TPC-C
WAREHOUSES=2 DISTRICTS=10 CUSTOMERS=50 PRODUCTS=200 pnpm bench:tpc-c

# TPC-H
SUPPLIERS=50 CUSTOMERS=500 ORDERS=2000 PARTS=500 pnpm bench:tpc-h
```

Results are saved as timestamped JSON files in `benchmarks/`.

## Key Takeaways

1. **PGlite sustains 250–340 TPS** for standard OLTP workloads over the TCP wire protocol
2. **Read-only queries exceed 500–1000 TPS** (Order Status, Stock Level)
3. **Analytical queries complete in ~30ms** for small-to-medium datasets
4. **Service mode adds negligible overhead** — tenants perform comparably to standalone CLI instances
5. **Concurrent explicit transactions deadlock** when competing for row locks — this is an architectural limitation of sharing one PGlite connection across TCP clients
