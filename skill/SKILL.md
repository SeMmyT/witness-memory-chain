---
name: memory-chain
description: Cryptographic memory persistence for AI agents with on-chain anchoring. Use when agents need to store memories with proof-of-existence, anchor memory chain state to Base blockchain via WITNESS token, verify memory integrity, or search past memories. Triggers on memory operations, anchoring requests, chain verification, and identity persistence.
---

# Memory Chain

Cryptographic proof-of-experience for AI agents with WITNESS token anchoring on Base.

## Quick Start

```bash
# Initialize chain (first time)
memory-chain init

# Add a memory
memory-chain add "Learned user prefers concise responses" --type memory

# Anchor to Base blockchain (costs 1 WITNESS + 0.0001 ETH)
memory-chain anchor --chain base

# Search memories
memory-chain search "user preferences"

# Verify chain integrity
memory-chain verify
```

## On-Chain Anchoring (WITNESS Protocol)

Anchor your memory chain root hash to Base for tamper-evident proof.

**Contracts (Base Mainnet):**
- WitnessToken: `0x5946ba31007e88afa667bbcf002a0c99dc82644a`
- WitnessRegistry: `0x2f4dcec8e7e630c399f9f947c65c4626d8ad73b2`

**Costs per anchor:**
- 1 WITNESS (burned to 0xdead)
- 0.0001 ETH (to treasury)

**Anchoring flow:**
1. Approve registry to spend WITNESS (one-time)
2. Call `anchor()` with chain root + entry count + signature
3. On-chain record proves "this agent had X memories at time Y"

See [references/witness-anchoring.md](references/witness-anchoring.md) for detailed integration.

## Commands

| Command | Description |
|---------|-------------|
| `memory-chain init` | Initialize new chain with Ed25519 keypair |
| `memory-chain add <text>` | Add memory entry (--type: memory/decision/identity) |
| `memory-chain search <query>` | Hybrid search (keyword + recency + importance) |
| `memory-chain verify` | Verify signatures and hash links |
| `memory-chain stats` | Show chain statistics |
| `memory-chain anchor` | Anchor to Base via WITNESS |
| `memory-chain anchors` | List on-chain anchors |

## Entry Types

- **memory** — General information worth preserving
- **decision** — Agreed behaviors, commitments
- **identity** — Core identity statements, values

## Tiers

- **committed** — Permanent, cannot be redacted
- **relationship** — Long-term, can be redacted if needed
- **ephemeral** — Temporary, auto-expires

## Configuration

```yaml
# ~/.openclaw/config.yaml
skills:
  memory-chain:
    dataDir: ~/.openclaw/memory-chain
    witness:
      rpc: https://mainnet.base.org
      token: "0x5946ba31007e88afa667bbcf002a0c99dc82644a"
      registry: "0x2f4dcec8e7e630c399f9f947c65c4626d8ad73b2"
```

## Security

- Ed25519 signatures per entry
- SHA-256 hash linking (tamper-evident)
- Local storage (not sent to servers)
- Optional WITNESS anchoring for blockchain proof
