#!/bin/bash
# anchor.sh - Anchor memory chain to Base via WITNESS
# Usage: ./anchor.sh <chain-root> <entry-count> <signature>
#
# Requires:
# - AGENT_KEY: Ethereum private key (hex with 0x)
# - cast: Foundry CLI tool
# - Sufficient WITNESS tokens + ETH on Base

set -e

REGISTRY="0x2f4dcec8e7e630c399f9f947c65c4626d8ad73b2"
TOKEN="0x5946ba31007e88afa667bbcf002a0c99dc82644a"
RPC="https://mainnet.base.org"
DUST_FEE="0.0001ether"

# Check args
if [ "$#" -lt 3 ]; then
    echo "Usage: $0 <agent-pubkey-hash> <chain-root> <entry-count> <signature>"
    echo ""
    echo "Example:"
    echo "  $0 0x1234...abcd 0xabcd...1234 42 0x..."
    exit 1
fi

PUBKEY_HASH="$1"
CHAIN_ROOT="$2"
ENTRY_COUNT="$3"
SIGNATURE="$4"

# Check env
if [ -z "$AGENT_KEY" ]; then
    echo "Error: AGENT_KEY environment variable not set"
    exit 1
fi

# Check cast is available
if ! command -v cast &> /dev/null; then
    echo "Error: cast (Foundry) not found. Install with: curl -L https://foundry.paradigm.xyz | bash && foundryup"
    exit 1
fi

echo "=== WITNESS Anchor ==="
echo "Registry: $REGISTRY"
echo "Chain Root: $CHAIN_ROOT"
echo "Entry Count: $ENTRY_COUNT"
echo ""

# Check WITNESS balance
BALANCE=$(cast call $TOKEN "balanceOf(address)(uint256)" $(cast wallet address --private-key $AGENT_KEY) --rpc-url $RPC)
echo "WITNESS Balance: $BALANCE"

# Check ETH balance
ETH_BALANCE=$(cast balance $(cast wallet address --private-key $AGENT_KEY) --rpc-url $RPC)
echo "ETH Balance: $ETH_BALANCE wei"

# Check allowance
ALLOWANCE=$(cast call $TOKEN "allowance(address,address)(uint256)" $(cast wallet address --private-key $AGENT_KEY) $REGISTRY --rpc-url $RPC)
echo "WITNESS Allowance: $ALLOWANCE"

if [ "$ALLOWANCE" = "0" ]; then
    echo ""
    echo "Approving WITNESS spend..."
    cast send $TOKEN "approve(address,uint256)" $REGISTRY 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
        --rpc-url $RPC \
        --private-key $AGENT_KEY
    echo "Approved!"
fi

echo ""
echo "Anchoring..."

TX_HASH=$(cast send $REGISTRY \
    "anchor(bytes32,bytes32,uint64,bytes)" \
    "$PUBKEY_HASH" \
    "$CHAIN_ROOT" \
    "$ENTRY_COUNT" \
    "$SIGNATURE" \
    --value $DUST_FEE \
    --rpc-url $RPC \
    --private-key $AGENT_KEY \
    --json | jq -r '.transactionHash')

echo ""
echo "=== Anchored! ==="
echo "TX: $TX_HASH"
echo "BaseScan: https://basescan.org/tx/$TX_HASH"
