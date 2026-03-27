# Service Mode (Multi-Tenant)

Demonstrates running nano-supabase as a multi-tenant HTTP gateway. Each tenant gets an isolated PGlite database, managed through an admin API. Tenants can be paused (offloaded to disk) and woken on demand.

## What it shows

- Creating and listing tenants via `ServiceClient`
- Executing SQL on individual tenants
- Tenant isolation — each tenant has its own database
- Pause/wake lifecycle with data persistence
- Token rotation for tenant security
- Tenant deletion and cleanup

## Prerequisites

Start the service first:

```bash
npx nano-supabase service \
  --admin-token=my-admin-token \
  --secret=my-secret \
  --data-dir=./service-data
```

## Run

```bash
pnpm run example:multi-tenant
```

Or with custom config:

```bash
SERVICE_URL=http://localhost:8080 ADMIN_TOKEN=my-token pnpm run example:multi-tenant
```

## Key APIs

- `new ServiceClient({ url, adminToken })` — create admin client
- `client.createTenant(slug, options)` — create a new tenant
- `client.listTenants()` — list all tenants
- `client.sql(slug, query, params)` — execute SQL on a tenant
- `client.pauseTenant(slug)` — pause and offload to disk
- `client.wakeTenant(slug)` — restore from disk
- `client.resetToken(slug)` — rotate tenant bearer token
- `client.deleteTenant(slug)` — delete tenant and data
