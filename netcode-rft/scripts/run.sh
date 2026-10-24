#!/bin/bash

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Starting NetCode-RFT Services..."
echo "Backend:  http://localhost:5000"
echo "Frontend: http://localhost:3000"

# Trap SIGINT to kill background jobs cleanly
trap 'kill $(jobs -p)' SIGINT SIGTERM EXIT

cd "$DIR/backend" && node src/server.js &
cd "$DIR/ui" && npx vite --host &

wait
