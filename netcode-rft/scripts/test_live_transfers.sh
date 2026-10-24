#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE="$DIR/engine/bin/netcode_engine"
STORAGE="$DIR/storage"
mkdir -p "$STORAGE"

TEST_FILE="$STORAGE/benchmark_input.bin"
dd if=/dev/urandom of="$TEST_FILE" bs=1024 count=16 status=none
ORIG_SHA=$(sha256sum "$TEST_FILE" | awk '{print $1}')

echo "=========================================================="
echo "NETCODE-RFT: RUNNING 10 LIVE UDP IMPAIRMENT TRANSFERS"
echo "Binary test payload: 16 KB (16,384 bytes)"
echo "Original SHA-256: $ORIG_SHA"
echo "=========================================================="

LOSS_RATES=(0 5 10 20 30)

# 1. RLNC Transfers
echo ""
echo "--- TESTING RLNC AT ALL 5 LOSS RATES ---"
for LOSS in "${LOSS_RATES[@]}"; do
    RECON="$STORAGE/rlnc_${LOSS}_recon.bin"
    PORT=$((9100 + LOSS))
    rm -f "$RECON"

    echo -n "[RLNC] Loss ${LOSS}% on port $PORT ... "
    "$ENGINE" --transfer-id "rlnc-loss-$LOSS" --protocol rlnc --file "$TEST_FILE" --out "$RECON" --loss "$LOSS" --port "$PORT" > /dev/null 2>&1
    
    if cmp -s "$TEST_FILE" "$RECON"; then
        RECON_SHA=$(sha256sum "$RECON" | awk '{print $1}')
        if [ "$ORIG_SHA" == "$RECON_SHA" ]; then
            echo "PASSED (Byte-equal & SHA-256: ${RECON_SHA:0:16}...)"
        else
            echo "FAILED (SHA mismatch)"
            exit 1
        fi
    else
        echo "FAILED (Byte mismatch)"
        exit 1
    fi
done

# 2. Reliable UDP (Stop-and-Wait ARQ) Transfers
echo ""
echo "--- TESTING RELIABLE UDP AT ALL 5 LOSS RATES ---"
for LOSS in "${LOSS_RATES[@]}"; do
    RECON="$STORAGE/rudp_${LOSS}_recon.bin"
    PORT=$((9200 + LOSS))
    rm -f "$RECON"

    echo -n "[RUDP] Loss ${LOSS}% on port $PORT ... "
    "$ENGINE" --transfer-id "rudp-loss-$LOSS" --protocol rudp --file "$TEST_FILE" --out "$RECON" --loss "$LOSS" --port "$PORT" > /dev/null 2>&1
    
    if cmp -s "$TEST_FILE" "$RECON"; then
        RECON_SHA=$(sha256sum "$RECON" | awk '{print $1}')
        if [ "$ORIG_SHA" == "$RECON_SHA" ]; then
            echo "PASSED (Byte-equal & SHA-256: ${RECON_SHA:0:16}...)"
        else
            echo "FAILED (SHA mismatch)"
            exit 1
        fi
    else
        echo "FAILED (Byte mismatch)"
        exit 1
    fi
done

echo ""
echo "=========================================================="
echo "ALL 10 LIVE UDP EXPERIMENTS PASSED WITH 100% INTEGRITY!"
echo "=========================================================="
