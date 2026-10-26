#!/bin/bash
set -e

PROJECT_DIR="/mnt/f/CN_project/netcode-rft"
NS3_BIN="/home/muthu/ns-allinone-3.41/ns-3.41/build/scratch/netcode-rft/ns3.41-netcode-rft-default"
RESULTS_DIR="$PROJECT_DIR/results"
STORAGE_DIR="$PROJECT_DIR/storage"
mkdir -p "$RESULTS_DIR" "$STORAGE_DIR"

INPUT_FILE="$STORAGE_DIR/audit_payload.bin"
dd if=/dev/urandom of="$INPUT_FILE" bs=1024 count=8 status=none
ORIG_SHA=$(sha256sum "$INPUT_FILE" | awk '{print $1}')
echo "=========================================================="
echo " NETCODE-RFT NS-3 & NETANIM INDEPENDENT AUDIT SUITE"
echo " Payload: 8 KB (8,192 bytes)"
echo " SHA-256: $ORIG_SHA"
echo "=========================================================="

# Test 1: RLNC at 0% loss
echo -n "[AUDIT 1/4] NS-3 RLNC (0% Loss) ... "
RLNC_0_OUT="/tmp/audit_rlnc_0.bin"
RLNC_0_XML="$RESULTS_DIR/audit_rlnc_0_trace.xml"
"$NS3_BIN" --protocol=RLNC --loss=0 --seed=101 --file="$INPUT_FILE" --out="$RLNC_0_OUT" --trace="$RLNC_0_XML" > /tmp/audit_rlnc_0.log 2>&1
if cmp -s "$INPUT_FILE" "$RLNC_0_OUT"; then
    RECON_SHA=$(sha256sum "$RLNC_0_OUT" | awk '{print $1}')
    if [ "$ORIG_SHA" == "$RECON_SHA" ] && [ -s "$RLNC_0_XML" ]; then
        echo "PASSED (Bit-exact, SHA: ${RECON_SHA:0:16}..., XML: $(wc -c < "$RLNC_0_XML") bytes)"
    else
        echo "FAILED: SHA or XML invalid" && exit 1
    fi
else
    echo "FAILED: Bit mismatch" && exit 1
fi

# Test 2: RLNC at 20% loss (Testing Coding Recovery)
echo -n "[AUDIT 2/4] NS-3 RLNC (20% Loss) ... "
RLNC_20_OUT="/tmp/audit_rlnc_20.bin"
RLNC_20_XML="$RESULTS_DIR/audit_rlnc_20_trace.xml"
"$NS3_BIN" --protocol=RLNC --loss=20 --seed=202 --file="$INPUT_FILE" --out="$RLNC_20_OUT" --trace="$RLNC_20_XML" > /tmp/audit_rlnc_20.log 2>&1
if cmp -s "$INPUT_FILE" "$RLNC_20_OUT"; then
    RECON_SHA=$(sha256sum "$RLNC_20_OUT" | awk '{print $1}')
    DROPS=$(grep "Phy Drops:" /tmp/audit_rlnc_20.log | awk '{print $3}')
    if [ "$ORIG_SHA" == "$RECON_SHA" ] && [ -s "$RLNC_20_XML" ]; then
        echo "PASSED (Bit-exact, SHA: ${RECON_SHA:0:16}..., Drops: $DROPS fwd, XML: $(wc -c < "$RLNC_20_XML") bytes)"
    else
        echo "FAILED: SHA or XML invalid" && exit 1
    fi
else
    echo "FAILED: Bit mismatch" && exit 1
fi

# Test 3: RUDP at 0% loss
echo -n "[AUDIT 3/4] NS-3 RUDP (0% Loss) ... "
RUDP_0_OUT="/tmp/audit_rudp_0.bin"
RUDP_0_XML="$RESULTS_DIR/audit_rudp_0_trace.xml"
"$NS3_BIN" --protocol=RUDP --loss=0 --seed=303 --file="$INPUT_FILE" --out="$RUDP_0_OUT" --trace="$RUDP_0_XML" > /tmp/audit_rudp_0.log 2>&1
if cmp -s "$INPUT_FILE" "$RUDP_0_OUT"; then
    RECON_SHA=$(sha256sum "$RUDP_0_OUT" | awk '{print $1}')
    if [ "$ORIG_SHA" == "$RECON_SHA" ] && [ -s "$RUDP_0_XML" ]; then
        echo "PASSED (Bit-exact, SHA: ${RECON_SHA:0:16}..., XML: $(wc -c < "$RUDP_0_XML") bytes)"
    else
        echo "FAILED: SHA or XML invalid" && exit 1
    fi
else
    echo "FAILED: Bit mismatch" && exit 1
fi

# Test 4: RUDP at 20% loss (Testing Timeouts & ARQ Retransmissions)
echo -n "[AUDIT 4/4] NS-3 RUDP (20% Loss) ... "
RUDP_20_OUT="/tmp/audit_rudp_20.bin"
RUDP_20_XML="$RESULTS_DIR/audit_rudp_20_trace.xml"
"$NS3_BIN" --protocol=RUDP --loss=20 --seed=404 --file="$INPUT_FILE" --out="$RUDP_20_OUT" --trace="$RUDP_20_XML" > /tmp/audit_rudp_20.log 2>&1
if cmp -s "$INPUT_FILE" "$RUDP_20_OUT"; then
    RECON_SHA=$(sha256sum "$RUDP_20_OUT" | awk '{print $1}')
    RETRANS=$(grep "total_retransmissions" /tmp/audit_rudp_20.log | sed -E 's/.*total_retransmissions":([0-9]+).*/\1/')
    if [ "$ORIG_SHA" == "$RECON_SHA" ] && [ -s "$RUDP_20_XML" ]; then
        echo "PASSED (Bit-exact, SHA: ${RECON_SHA:0:16}..., Retrans: $RETRANS, XML: $(wc -c < "$RUDP_20_XML") bytes)"
    else
        echo "FAILED: SHA or XML invalid" && exit 1
    fi
else
    echo "FAILED: Bit mismatch" && exit 1
fi

echo "=========================================================="
echo " ALL 4 NS-3 SCENARIOS VERIFIED WITH 100% BIT-EXACT INTEGRITY!"
echo "=========================================================="
