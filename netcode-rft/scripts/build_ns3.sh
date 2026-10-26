#!/bin/bash
set -e

NS3_DIR="/home/muthu/ns-allinone-3.41/ns-3.41"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=========================================================="
echo " Building NetCode-RFT NS-3 Simulator & NetAnim Components"
echo "=========================================================="

if [ ! -d "$NS3_DIR" ]; then
    echo "ERROR: NS-3 installation not found at $NS3_DIR"
    exit 1
fi

echo "[1/3] Syncing repository ns3-simulator/ -> $NS3_DIR/scratch/netcode-rft/ ..."
mkdir -p "$NS3_DIR/scratch/netcode-rft"
cp -r "$PROJECT_DIR/ns3-simulator/"* "$NS3_DIR/scratch/netcode-rft/"

echo "[2/3] Building netcode-rft target with NS-3 build system ..."
cd "$NS3_DIR"
./ns3 build netcode-rft

echo "[3/3] Verifying NetAnim installation ..."
if [ -x "/usr/local/bin/netanim" ]; then
    echo "  NetAnim found at /usr/local/bin/netanim"
elif [ -x "$NS3_DIR/../netanim-3.109/NetAnim" ]; then
    echo "  NetAnim found at $NS3_DIR/../netanim-3.109/NetAnim"
else
    echo "  WARNING: NetAnim executable not found in standard paths."
fi

echo "=========================================================="
echo " NS-3 SIMULATOR BUILD COMPLETE & VERIFIED!"
echo " Binary: $NS3_DIR/build/scratch/netcode-rft/ns3.41-netcode-rft-default"
echo "=========================================================="
