#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Error: BASE_URL is required"
  echo ""
  echo "Usage: ./test.sh <BASE_URL>"
  echo "Example: ./test.sh https://username-valname.web.val.run"
  exit 1
fi

BASE="$1"
FMT="python3 -m json.tool 2>/dev/null"

pp() { python3 -m json.tool 2>/dev/null || cat; }

echo "=== nano-supabase Feature Flag Service Test ==="
echo "Base URL: $BASE"
echo ""

echo "1. API Info:"
curl -s "$BASE/" | pp
echo ""

echo "2. Creating feature flag 'dark-mode'..."
FLAG_RESPONSE=$(curl -s -X POST "$BASE/flags" \
  -H "Content-Type: application/json" \
  -d '{"name": "dark-mode", "description": "Enable dark mode UI", "enabled": false, "rollout_percentage": 50}')
echo "$FLAG_RESPONSE" | pp
echo ""

echo "3. Creating feature flag 'new-checkout'..."
curl -s -X POST "$BASE/flags" \
  -H "Content-Type: application/json" \
  -d '{"name": "new-checkout", "description": "Redesigned checkout flow", "enabled": true}' | pp
echo ""

echo "4. Listing all flags..."
curl -s "$BASE/flags" | pp
echo ""

echo "5. Getting 'dark-mode' details..."
curl -s "$BASE/flags/dark-mode" | pp
echo ""

echo "6. Toggling 'dark-mode' on..."
curl -s -X POST "$BASE/flags/dark-mode/toggle" | pp
echo ""

echo "7. Adding environment override (production=disabled)..."
curl -s -X POST "$BASE/flags/dark-mode/environments" \
  -H "Content-Type: application/json" \
  -d '{"environment": "production", "enabled": false}' | pp
echo ""

echo "8. Adding environment override (staging=enabled)..."
curl -s -X POST "$BASE/flags/dark-mode/environments" \
  -H "Content-Type: application/json" \
  -d '{"environment": "staging", "enabled": true}' | pp
echo ""

echo "9. Scoping 'dark-mode' to app 'web-app'..."
curl -s -X POST "$BASE/flags/dark-mode/apps" \
  -H "Content-Type: application/json" \
  -d '{"app_name": "web-app"}' | pp
echo ""

echo "10. Evaluating 'dark-mode' for web-app/staging..."
curl -s "$BASE/flags/dark-mode/evaluate?app=web-app&environment=staging&identifier=user-123" | pp
echo ""

echo "11. Evaluating 'dark-mode' for web-app/production (should be disabled)..."
curl -s "$BASE/flags/dark-mode/evaluate?app=web-app&environment=production&identifier=user-123" | pp
echo ""

echo "12. Evaluating 'dark-mode' for mobile-app (not scoped, should fail)..."
curl -s "$BASE/flags/dark-mode/evaluate?app=mobile-app&environment=staging&identifier=user-456" | pp
echo ""

echo "13. Updating 'dark-mode' rollout to 100%..."
curl -s -X PATCH "$BASE/flags/dark-mode" \
  -H "Content-Type: application/json" \
  -d '{"rollout_percentage": 100}' | pp
echo ""

echo "14. Listing enabled flags only..."
curl -s "$BASE/flags?enabled=true" | pp
echo ""

echo "15. Getting full 'dark-mode' details (with environments and apps)..."
curl -s "$BASE/flags/dark-mode" | pp
echo ""

echo "16. Deleting 'new-checkout'..."
curl -s -X DELETE "$BASE/flags/new-checkout" | pp
echo ""

echo "17. Final flag list..."
curl -s "$BASE/flags" | pp
echo ""

echo "=== Test Complete ==="
echo ""
echo "To verify persistence, wait for a cold start and run:"
echo "  curl $BASE/flags"
