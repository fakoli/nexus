#!/bin/bash
# Quick start Nexus gateway + open UI
cd "$(dirname "$0")/.."
npx tsx packages/cli/src/index.ts gateway run &
GATEWAY_PID=$!
sleep 2
echo "Nexus gateway running on http://localhost:19200/ui/"
echo "Press Ctrl+C to stop"
trap "kill $GATEWAY_PID 2>/dev/null" EXIT
wait $GATEWAY_PID
