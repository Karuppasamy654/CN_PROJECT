#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Building NetCode-RFT ==="
echo "Building C Engine..."
cd "$DIR/engine"
make all

echo "Building Frontend..."
cd "$DIR/ui"
if command -v node > /dev/null 2>&1 && node -e 'process.exit(0)' > /dev/null 2>&1; then
    npm run build
else
    echo "Notice: Linux Node environment not found in WSL; frontend is built via host Windows Node ('npm run build' in ui/)."
fi

echo "Build complete."
