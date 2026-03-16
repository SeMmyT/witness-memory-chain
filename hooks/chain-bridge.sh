#!/usr/bin/env bash
# chain-bridge.sh — Writes a memory to the cryptographic chain.
# Called by other hooks (distill, valuable, sifr-stop) to persist
# important memories with Ed25519 signatures and hash-linking.
#
# Usage: chain-bridge.sh <type> <tier> <content>
#   type: memory | decision | identity
#   tier: committed | relationship | ephemeral
#   content: the memory text

set -uo pipefail

CHAIN_DIR="$HOME/.claude/memory-chain"
CHAIN_CLI="$HOME/codeprojects/memory-chain/dist/cli.js"

# Bail if chain not initialized
[ -f "$CHAIN_DIR/config.json" ] || exit 0
[ -f "$CHAIN_CLI" ] || exit 0

TYPE="${1:-memory}"
TIER="${2:-relationship}"
CONTENT="${3:-}"

[ -z "$CONTENT" ] && exit 0

# Write to chain (fire and forget, don't block the hook)
node "$CHAIN_CLI" add "$CONTENT" --type "$TYPE" --tier "$TIER" -d "$CHAIN_DIR" >/dev/null 2>&1 &

exit 0
