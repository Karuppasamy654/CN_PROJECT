#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE="$DIR/engine/bin/netcode_engine"
STORAGE="$DIR/storage"
mkdir -p "$STORAGE"

TEST_FILE="$STORAGE/benchmark_input.bin"
dd if=/dev/urandom of="$TEST_FILE" bs=1024 count=16 status=none
ORIG_SHA=$(sha256sum "$TEST_FILE" | awk '{print $1}')

echo "=== AUDIT 10 LIVE UDP TRANSFERS (ORIG_SHA: $ORIG_SHA) ==="

for PROTO in rlnc rudp; do
  for LOSS in 0 5 10 20 30; do
    RECON="$STORAGE/${PROTO}_${LOSS}_audit.bin"
    if [ "$PROTO" == "rudp" ]; then
      PORT=$((9500 + LOSS))
    else
      PORT=$((9400 + LOSS))
    fi
    rm -f "$RECON"
    
    OUT=$("$ENGINE" --transfer-id "audit-$PROTO-$LOSS" --protocol "$PROTO" --file "$TEST_FILE" --out "$RECON" --loss "$LOSS" --port "$PORT")
    RECON_SHA=$(sha256sum "$RECON" | awk '{print $1}')
    BYTE_EQUAL="FAIL"
    if cmp -s "$TEST_FILE" "$RECON"; then
      BYTE_EQUAL="PASS"
    fi
    HASH_MATCH="FAIL"
    if [ "$ORIG_SHA" == "$RECON_SHA" ]; then
      HASH_MATCH="PASS"
    fi
    METRICS=$(echo "$OUT" | grep "^METRICS_JSON:" | sed 's/^METRICS_JSON://')
    echo "AUDIT_ROW|$PROTO|$LOSS|$BYTE_EQUAL|$HASH_MATCH|$RECON_SHA|$METRICS"
  done
done
