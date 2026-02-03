# Val.town Example: Feature Flag Service

Deploy a feature flag service on [Val.town](https://val.town) powered by nano-supabase with **persistent storage**.

## Features

- Full PostgreSQL database running in WebAssembly
- Supabase-compatible query API
- Per-environment overrides and app scoping
- Percentage-based rollouts with deterministic hashing
- **Persistent storage** via PGlite's `dumpDataDir`/`loadDataDir` (data survives cold starts)
- CORS enabled for browser access

## Quick Start (Web UI)

1. Go to [val.town](https://val.town) and create a new val
2. Copy the contents of all `.ts` files (`index.ts`, `persistence.ts`, `schema.ts`) into the editor
3. **Important**: Set the val type to **HTTP** using the dropdown near the val name
4. Your API is instantly live at `https://YOUR_USERNAME-YOUR_VAL_NAME.web.val.run`

## Using the vt CLI

```bash
npm install -g @valtown/vt

vt login

cd examples/valtown
vt create my-flags . --no-editor-files --upload-if-exists --public

# Set the val type to HTTP on the web page
vt browse
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | API info and available endpoints |
| GET | `/flags` | List all flags (`?enabled`, `?app`, `?environment`) |
| POST | `/flags` | Create flag `{ name, description?, enabled?, rollout_percentage? }` |
| GET | `/flags/:name` | Get flag details with environments and apps |
| PATCH | `/flags/:name` | Update flag `{ description?, enabled?, rollout_percentage? }` |
| DELETE | `/flags/:name` | Delete flag (cascades to environments and apps) |
| POST | `/flags/:name/toggle` | Toggle flag enabled/disabled |
| GET | `/flags/:name/evaluate` | Evaluate flag `?app=x&environment=y&identifier=z` |
| POST | `/flags/:name/environments` | Add environment override `{ environment, enabled }` |
| POST | `/flags/:name/apps` | Add app scope `{ app_name }` |

## Testing

```bash
./test.sh https://YOUR_USERNAME-YOUR_VAL_NAME.web.val.run
```

Or test manually:

```bash
# Create a flag with 50% rollout
curl -X POST https://YOUR_URL/flags \
  -H "Content-Type: application/json" \
  -d '{"name": "dark-mode", "enabled": true, "rollout_percentage": 50}'

# Add a production override (disabled)
curl -X POST https://YOUR_URL/flags/dark-mode/environments \
  -H "Content-Type: application/json" \
  -d '{"environment": "production", "enabled": false}'

# Scope to a specific app
curl -X POST https://YOUR_URL/flags/dark-mode/apps \
  -H "Content-Type: application/json" \
  -d '{"app_name": "web-app"}'

# Evaluate: is this flag active for web-app in staging?
curl "https://YOUR_URL/flags/dark-mode/evaluate?app=web-app&environment=staging&identifier=user-123"

# Toggle a flag
curl -X POST https://YOUR_URL/flags/dark-mode/toggle
```

## Evaluation Logic

When evaluating a flag (`GET /flags/:name/evaluate?app=x&environment=y`):

1. If the flag doesn't exist -> `active: false` (`flag_not_found`)
2. If the flag has app scopes and the requested app isn't listed -> `active: false` (`app_not_scoped`)
3. If an environment override exists, its `enabled` value takes precedence over the global flag `enabled`
4. If resolved `enabled` is false -> `active: false` (`disabled`)
5. If `rollout_percentage < 100`, a deterministic hash of the `identifier` param decides inclusion. Without an identifier, it uses random selection -> `active: false` (`rollout_excluded`)
6. Otherwise -> `active: true`

## Persistence

The database is persisted using PGlite's built-in `dumpDataDir`/`loadDataDir`. On each write operation, the entire database is serialized as a gzipped tarball and stored in Val.town's blob storage. On cold start, the snapshot is loaded back, restoring all tables, indexes, and data atomically.

The blob key is `nano-supabase-flags-db`.

## File Structure

- `index.ts` - HTTP handler with all feature flag endpoints
- `persistence.ts` - Database initialization and snapshot persistence
- `schema.ts` - Table definitions (feature_flags, flag_environments, flag_apps)

## Troubleshooting

**"Not found" response**: The val type isn't set to HTTP. Go to the val's page and change the type dropdown to "HTTP".

**"Invalid version provided" error**: Try deleting the val and creating a new one with a different name, or clear Val.town's module cache by changing the import URL (add `?v=2`).

**Import errors**: Make sure you're using the exact versions specified in the import statements.
