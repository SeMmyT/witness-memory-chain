---
name: memory-chain
version: 0.1.0
description: Cryptographic proof-of-experience for AI agents
author: openclaw
tags: [memory, crypto, persistence, identity, opentimestamps]
requires:
  - node: ">=20"
installer:
  - type: node
    package: "@openclaw/memory-chain"
hooks:
  agent:bootstrap:
    script: hooks/agent-bootstrap.ts
    description: Load and inject relevant memories on agent startup
  command:reset:
    script: hooks/command-reset.ts
    description: Auto-commit session summary on session reset
commands:
  memory:
    script: commands/memory.ts
    description: Manage memories via Telegram
---

# Memory Chain Skill for OpenClaw

Provides cryptographic proof-of-experience for AI agents running through OpenClaw gateway.

## Features

- **Hash Chain Integrity**: Ed25519 signatures with SHA-256 hash linking
- **Hybrid Retrieval**: FTS5 + recency + importance scoring
- **OpenTimestamps**: Bitcoin anchoring for tamper-evident timestamps
- **Auto-Commit**: Automatically save significant memories
- **Memory Injection**: Context-aware memory retrieval on agent startup

## Commands

### /memory search <query>
Search memories using hybrid retrieval scoring.

### /memory commit <text>
Manually commit a memory to the chain.

### /memory verify
Verify chain integrity (signatures, hashes, sequence).

### /memory stats
Show chain statistics (entries, types, anchors).

### /memory export
Export chain (DM only for security).

## Hooks

### agent:bootstrap
On agent startup, searches memories relevant to the current conversation context and injects them into the system prompt. Uses token budgeting to stay within limits.

### command:reset
On session reset (Telegram /reset command), summarizes the session and commits significant learnings to the chain. Configurable significance threshold.

## Configuration

Add to your OpenClaw config:

```json
{
  "skills": {
    "memory-chain": {
      "dataDir": "~/.openclaw/memory-chain",
      "autoCommit": {
        "onExplicitRequest": true,
        "onSignificance": true,
        "significanceThreshold": 0.7,
        "keywords": ["remember", "note that", "important"]
      },
      "retrieval": {
        "maxTokens": 2000,
        "maxResults": 20
      }
    }
  }
}
```

## Security

- Memories are stored locally (not sent to any server)
- Chain integrity verified via Ed25519 signatures
- Optional OpenTimestamps anchoring for external proof
- Export restricted to DM (no group chat exports)
