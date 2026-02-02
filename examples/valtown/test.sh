#!/bin/bash
# Test script for nano-supabase Val.town API
# Usage: ./test.sh [BASE_URL]

BASE="${1:-https://YOUR_USERNAME-YOUR_VAL_NAME.web.val.run}"

echo "=== nano-supabase Val.town API Test ==="
echo "Base URL: $BASE"
echo ""

# Check API info
echo "1. API Info:"
curl -s "$BASE/" | python3 -m json.tool 2>/dev/null || curl -s "$BASE/"
echo ""

# Get current stats
echo "2. Current Stats:"
curl -s "$BASE/stats" | python3 -m json.tool 2>/dev/null || curl -s "$BASE/stats"
echo ""

# Create a conversation
echo "3. Creating conversation..."
CONV_RESPONSE=$(curl -s -X POST "$BASE/conversations" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Conversation"}')
echo "$CONV_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$CONV_RESPONSE"

# Extract conversation ID
CONV_ID=$(echo "$CONV_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)

if [ -z "$CONV_ID" ]; then
  echo "Failed to create conversation"
  exit 1
fi

echo ""
echo "Conversation ID: $CONV_ID"
echo ""

# Add user message
echo "4. Adding user message..."
curl -s -X POST "$BASE/messages" \
  -H "Content-Type: application/json" \
  -d "{\"conversation_id\": \"$CONV_ID\", \"role\": \"user\", \"content\": \"Hello! How are you?\", \"tokens\": 6}" \
  | python3 -m json.tool 2>/dev/null
echo ""

# Add assistant message
echo "5. Adding assistant message..."
curl -s -X POST "$BASE/messages" \
  -H "Content-Type: application/json" \
  -d "{\"conversation_id\": \"$CONV_ID\", \"role\": \"assistant\", \"content\": \"I'm doing great! How can I help you today?\", \"tokens\": 10}" \
  | python3 -m json.tool 2>/dev/null
echo ""

# Get all messages for conversation
echo "6. Getting conversation messages..."
curl -s "$BASE/messages?conversation_id=$CONV_ID" | python3 -m json.tool 2>/dev/null
echo ""

# List all conversations
echo "7. Listing all conversations..."
curl -s "$BASE/conversations" | python3 -m json.tool 2>/dev/null
echo ""

# Final stats
echo "8. Final Stats:"
curl -s "$BASE/stats" | python3 -m json.tool 2>/dev/null
echo ""

echo "=== Test Complete ==="
echo ""
echo "To verify persistence, wait a few minutes and run:"
echo "  curl $BASE/conversations"
echo "  curl $BASE/stats"
