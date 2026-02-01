---
name: memory-chain-reset
description: "Auto-commits session summary to Memory Chain when session is reset"
metadata: {"openclaw":{"emoji":"💾","events":["command:reset"],"requires":{"bins":["node"]}}}
---

# Memory Chain Reset Hook

Automatically commits a summary of significant session content to your Memory Chain when you issue `/reset`.

## What It Does

1. Analyzes the session messages for significant content
2. Looks for explicit "remember" requests, preferences, or decisions
3. Commits relevant content to the Memory Chain
4. Preserves important learnings with cryptographic proof

## Configuration

In your OpenClaw config:

```json
{
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "memory-chain-reset": {
          "enabled": true,
          "env": {
            "MEMORY_CHAIN_DIR": "~/.openclaw/memory-chain",
            "MEMORY_CHAIN_MIN_MESSAGES": "3",
            "MEMORY_CHAIN_KEYWORDS": "remember,note that,important"
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

## Trigger Keywords

The hook looks for these patterns to identify significant content:
- "remember this", "note that", "important"
- "I prefer", "I like", "I want", "I need"
- "always", "never" (in context of preferences)

## How It Works

On `command:reset` event, the hook:
1. Scans session messages for significant content
2. Extracts preferences, decisions, or explicit remember requests
3. Commits to Memory Chain with `type: memory`, `tier: relationship`
4. Notifies user via `event.messages` if something was committed

Content committed with `tier: relationship` can be redacted later if needed.
