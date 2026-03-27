# Sprites.dev Example: Feature Flag Service

Deploy a feature flag service on [sprites.dev](https://sprites.dev) powered by nano-supabase with **persistent storage**.

## Features

- Full PostgreSQL database running via PGlite
- Supabase-compatible query API
- Per-environment overrides and app scoping
- Percentage-based rollouts with deterministic hashing
- **Persistent storage** via sprites.dev's persistent filesystem
- CORS enabled for browser access

## Quick Start

### 1. Install the Sprites CLI

```bash
npm install -g @anthropic/sprites
```

### 2. Login and Deploy

```bash
sprite login

cd examples/sprites
./deploy.sh nano-flags
```

### 3. Test It

Your API is now live at `https://nano-flags-XXXX.sprites.app` (check your sprite's URL).

```bash
# Check API info
curl https://nano-flags-XXXX.sprites.app/

# Run full test suite
./test.sh https://nano-flags-XXXX.sprites.app
```

## Running Locally

```bash
bun install
bun run index.ts
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
./test.sh https://nano-flags-XXXX.sprites.app
```

Or test manually:

```bash
# Create a flag with 50% rollout
curl -X POST https://nano-flags-XXXX.sprites.app/flags \
  -H "Content-Type: application/json" \
  -d '{"name": "dark-mode", "enabled": true, "rollout_percentage": 50}'

# Add a production override (disabled)
curl -X POST https://nano-flags-XXXX.sprites.app/flags/dark-mode/environments \
  -H "Content-Type: application/json" \
  -d '{"environment": "production", "enabled": false}'

# Scope to a specific app
curl -X POST https://nano-flags-XXXX.sprites.app/flags/dark-mode/apps \
  -H "Content-Type: application/json" \
  -d '{"app_name": "web-app"}'

# Evaluate: is this flag active for web-app in staging?
curl "https://nano-flags-XXXX.sprites.app/flags/dark-mode/evaluate?app=web-app&environment=staging&identifier=user-123"

# Toggle a flag
curl -X POST https://nano-flags-XXXX.sprites.app/flags/dark-mode/toggle
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

The database is stored on sprites.dev's persistent filesystem at `./data/pglite`. This filesystem survives sprite hibernation - when your sprite wakes from sleep, all data is intact.

## File Structure

- `index.ts` - HTTP server with all feature flag endpoints
- `persistence.ts` - Database initialization with filesystem persistence
- `schema.ts` - Table definitions (feature_flags, flag_environments, flag_apps)
- `package.json` - Dependencies (@electric-sql/pglite, nano-supabase from GitHub)
- `deploy.sh` - Deployment script for sprites.dev
- `test.sh` - API test script

## Sprites Lifecycle

Sprites automatically hibernate when idle and wake on incoming requests:

- **Warm resume**: ~100-500ms when sprite was recently active
- **Cold resume**: 1-2s for longer hibernation periods

### How Auto-Wake Works

1. Sprite goes to sleep when idle (no active connections)
2. HTTP request arrives at `https://your-sprite.sprites.app`
3. Sprite wakes up automatically
4. The `flags-api` service starts (configured with `--http-port 8080`)
5. Request is processed and response returned

Running processes stop during hibernation, but:
- **Database files persist** on the filesystem
- **Service configuration persists** and auto-restarts on wake
- **No manual intervention needed** - just send requests!

## Managing the Service

```bash
# List services
sprite exec -s nano-flags sprite-env services list

# View service status
sprite exec -s nano-flags sprite-env services get flags-api

# View logs
sprite exec -s nano-flags cat /.sprite/logs/services/flags-api.log

# Restart the service
sprite exec -s nano-flags sprite-env services restart flags-api

# Stop the service
sprite exec -s nano-flags sprite-env services stop flags-api
```
