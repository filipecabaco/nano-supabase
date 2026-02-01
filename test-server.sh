#!/bin/bash

# Start server in background
npm run example:server &
SERVER_PID=$!

# Wait for server to start
sleep 2

# Test query
echo "Testing server..."
echo "SELECT * FROM users" | nc 127.0.0.1 5433

# Cleanup
kill $SERVER_PID 2>/dev/null
echo "Test complete"
