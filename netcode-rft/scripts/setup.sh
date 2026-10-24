#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "Setting up NetCode-RFT environment in $DIR..."

# Engine build
echo "1. Building C Networking Engine..."
cd "$DIR/engine"
make clean && make all

# Backend setup
echo "2. Installing Backend dependencies..."
cd "$DIR/backend"
npm install

# UI setup
echo "3. Installing Frontend dependencies and building..."
cd "$DIR/ui"
npm install && npm run build

# Storage
mkdir -p "$DIR/storage" "$DIR/uploads" "$DIR/downloads"

echo "NetCode-RFT setup completed successfully!"
