#!/bin/bash
set -e

SPRITE_NAME="${1:-nano-flags}"

echo "=== Deploying to sprites.dev ==="
echo "Sprite name: $SPRITE_NAME"
echo ""

echo "1. Creating sprite (if needed)..."
sprite create "$SPRITE_NAME" 2>/dev/null || echo "   Sprite already exists"

echo "2. Creating directories..."
sprite exec -s "$SPRITE_NAME" mkdir -p /app/data

echo "3. Uploading files..."
cat index.ts | sprite exec -s "$SPRITE_NAME" -dir /app tee index.ts > /dev/null
cat persistence.ts | sprite exec -s "$SPRITE_NAME" -dir /app tee persistence.ts > /dev/null
cat schema.ts | sprite exec -s "$SPRITE_NAME" -dir /app tee schema.ts > /dev/null
cat package.json | sprite exec -s "$SPRITE_NAME" -dir /app tee package.json > /dev/null
echo "   Done"

echo "4. Installing dependencies..."
sprite exec -s "$SPRITE_NAME" -dir /app bun install

echo "5. Creating auto-start service..."
sprite exec -s "$SPRITE_NAME" sprite-env services delete flags-api 2>/dev/null || true
sprite exec -s "$SPRITE_NAME" sprite-env services create flags-api \
  --cmd /bin/bash \
  --args "-c,cd /app && bun run index.ts" \
  --http-port 8080 \
  --no-stream

echo "6. Making URL public..."
sprite url update -s "$SPRITE_NAME" --auth public 2>/dev/null || echo "   Already public"

echo ""
echo "=== Deployment complete ==="
echo ""
echo "The service 'flags-api' will auto-start on HTTP requests."
echo ""
echo "Manage the service with:"
echo "  sprite exec -s $SPRITE_NAME sprite-env services list"
echo "  sprite exec -s $SPRITE_NAME sprite-env services restart flags-api"
echo ""
echo "Your API will be at: https://$SPRITE_NAME-XXXX.sprites.app"
echo "Check exact URL with: sprite list"
