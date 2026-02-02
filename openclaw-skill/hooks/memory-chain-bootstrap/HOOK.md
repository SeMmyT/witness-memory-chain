---
name: memory-chain-bootstrap
description: "Injects relevant memories from Memory Chain into agent system prompt on session start"
metadata: {"openclaw":{"emoji":"🧠","events":["agent:bootstrap"],"requires":{"bins":["node"]}}}
---

# Memory Chain Bootstrap Hook

Loads relevant memories from your cryptographic Memory Chain and injects them into the agent's system prompt when a conversation begins.

## What It Does

1. Reads your Memory Chain from `~/.openclaw/memory-chain/`
2. Uses hybrid retrieval (40% keyword, 30% recency, 20% importance, 10% access frequency)
3. Injects relevant memories into the system prompt
4. Respects token budget to avoid context overflow

## Configuration

In your OpenClaw config:

```json
{
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "memory-chain-bootstrap": {
          "enabled": true,
          "env": {
            "MEMORY_CHAIN_DIR": "~/.openclaw/memory-chain",
            "MEMORY_CHAIN_MAX_TOKENS": "2000",
            "MEMORY_CHAIN_MAX_RESULTS": "20"
          }
        }
      }
    }
  }
}
```

## Requirements

- Node.js installed
- Memory Chain initialized (`memory-chain init`)

## How It Works

On `agent:bootstrap` event, the hook:
1. Loads the chain from disk
2. Searches for memories relevant to the conversation context
3. Formats them as a memory block
4. Appends to the system prompt via `context.bootstrapFiles`

Memories are retrieved using the hybrid scoring system that balances keyword relevance, recency, importance, and access patterns.
