# Val.town Example

Deploy nano-supabase as a serverless API on [Val.town](https://val.town).

## Quick Start (Web UI)

1. Go to [val.town](https://val.town) and create a new val
2. Copy the contents of `index.ts` into the editor
3. **Important**: Set the val type to **HTTP** using the dropdown near the val name
4. Your API is instantly live at `https://YOUR_USERNAME-YOUR_VAL_NAME.web.val.run`

## Using the vt CLI

```bash
# Install vt CLI
npm install -g @valtown/vt

# Login
vt login

# Create the val from this folder
cd examples/valtown
vt create my-chat-api . --no-editor-files --upload-if-exists --public

# IMPORTANT: After creating, go to the val's web page and set type to "HTTP"
# The CLI doesn't have an option to set the val type
vt browse
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | API info and available endpoints |
| GET | `/conversations` | List all conversations |
| POST | `/conversations` | Create conversation `{ title: string }` |
| GET | `/messages?conversation_id=xxx` | Get messages for a conversation |
| POST | `/messages` | Add message `{ conversation_id, role, content, tokens? }` |
| GET | `/stats` | Get usage statistics |

## Testing

```bash
# Get API info
curl https://YOUR_USERNAME-YOUR_VAL_NAME.web.val.run/

# Create a conversation
curl -X POST https://YOUR_USERNAME-YOUR_VAL_NAME.web.val.run/conversations \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Chat"}'

# Add a message
curl -X POST https://YOUR_USERNAME-YOUR_VAL_NAME.web.val.run/messages \
  -H "Content-Type: application/json" \
  -d '{"conversation_id": "YOUR_ID", "role": "user", "content": "Hello!"}'
```

## Adding Persistence

Val.town workers are stateless - the database resets on cold starts. For persistence, use Val.town's blob storage:

```typescript
import { blob } from "https://esm.town/v/std/blob";

// Save state periodically
async function saveState() {
  const dump = await db.dumpDataDir();
  await blob.setJSON("chat-db-state", dump);
}

// Restore on startup (in getDb function)
const saved = await blob.getJSON("chat-db-state");
if (saved) {
  db = new PGlite();
  await db.loadDataDir(saved);
}
```

## Customization

The example uses a chat schema, but you can modify `index.ts` to:
- Add your own tables and schemas
- Implement different API endpoints
- Add authentication
- Connect to AI APIs for chat completions

## Troubleshooting

**"Not found" response**: The val type isn't set to HTTP. Go to the val's page and change the type dropdown to "HTTP".

**"Invalid version provided" error**: This usually means there's a caching issue. Try:
1. Delete the val and create a new one with a different name
2. Clear Val.town's module cache by changing the import URL (add `?v=2`)

**Import errors**: Make sure you're using the exact versions specified:
- PGlite: `npm:@electric-sql/pglite@0.2.17`
- nano-supabase: `https://raw.githubusercontent.com/filipecabaco/nano-supabase/main/dist/index.js`
