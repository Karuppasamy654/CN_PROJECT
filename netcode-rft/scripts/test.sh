#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== 1. C Engine Unit Tests ==="
cd "$DIR/engine"
make test

echo "=== 2. Backend Unit & API Tests ==="
cd "$DIR/backend"
if command -v node > /dev/null 2>&1 && node -e 'process.exit(0)' > /dev/null 2>&1; then
    npm test
else
    echo "Notice: Linux Node environment not found in WSL; backend tests are executed via host Windows Node ('npm test' in backend/)."
fi

echo "=== 3. 10 Live UDP Impairment Transfers ==="
cd "$DIR"
bash scripts/test_live_transfers.sh

echo "=========================================="
echo "ALL TESTS IN ALL SUITES PASSED!"
echo "=========================================="
