# Memory Chain Skill for OpenClaw

Cryptographic proof-of-experience for AI agents running through OpenClaw gateway.

## Installation

The skill is installed as part of the `witness-memory-chain` package:

```bash
npm install witness-memory-chain
```

Then enable it in your OpenClaw configuration.

## Features

### Hash Chain Integrity
Every memory is cryptographically signed with Ed25519 and linked via SHA-256 hash chain. This ensures:
- Tamper evidence (any modification breaks the chain)
- Non-repudiation (entries are signed by agent's key)
- Ordering proof (hash chain enforces sequence)

### Hybrid Retrieval
Memories are retrieved using a hybrid scoring system:
- **FTS5 keyword matching** (40%) - Full-text search with BM25 ranking
- **Recency boost** (30%) - Recent memories are weighted higher
- **Importance score** (20%) - User-assigned or auto-detected importance
- **Access frequency** (10%) - Frequently accessed memories bubble up

### OpenTimestamps Integration
Bitcoin timestamping provides external proof of memory existence:
- Anchors are submitted to OTS calendar servers
- After ~1 hour, proofs are confirmed on Bitcoin blockchain
- Even if keys are compromised, past timestamps remain valid

### Auto-Commit
The skill can automatically commit memories on:
- Explicit requests ("remember this", "note that")
- Session reset (summarizes significant learnings)
- Configurable keywords and thresholds

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/memory search <query>` | Search memories using hybrid retrieval |
| `/memory commit <text>` | Manually commit a memory |
| `/memory verify` | Verify chain integrity |
| `/memory stats` | Show chain statistics |
| `/memory export` | Export chain (DM only) |
| `/memory help` | Show help |

## Hooks

### agent:bootstrap
Injects relevant memories into the system prompt when a conversation starts.

**Configuration:**
- `maxTokens`: Maximum tokens to inject (default: 2000)
- `maxResults`: Maximum memories to retrieve (default: 20)
- `rebuildIndex`: Rebuild search index on startup (default: false)

### command:reset
Automatically commits a summary of significant learnings when the session is reset.

**Configuration:**
- `enabled`: Enable auto-commit on reset (default: true)
- `minMessages`: Minimum messages to trigger commit (default: 3)
- `keywords`: Keywords that trigger commit (default: ['remember', 'note that', 'important'])

## Configuration Example

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

## Data Storage

Memories are stored locally at `~/.openclaw/memory-chain/`:

```
~/.openclaw/memory-chain/
├── config.json       # Agent configuration
├── chain.jsonl       # Append-only hash chain
├── agent.key         # Ed25519 private key
├── agent.pub         # Ed25519 public key
├── memory.db         # SQLite search index
├── content/          # Content-addressable storage
│   └── <hash>        # Individual content files
└── anchors/          # OpenTimestamps proofs
    ├── entry-0.ots   # OTS proof files
    └── pending.json  # Pending anchor tracking
```

## Security Considerations

1. **Key Protection**: The `agent.key` file is sensitive. Protect it with appropriate file permissions (0600).

2. **Export Restrictions**: By default, `/memory export` only works in private chats to prevent accidental exposure.

3. **Local Storage**: All memories are stored locally. Nothing is sent to external servers except:
   - OTS calendar servers (for timestamping, only hashes are sent)

4. **Redaction**: Use the CLI's `redact` command to remove sensitive content while preserving chain integrity.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   OpenClaw Gateway                       │
│                                                          │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────┐  │
│  │ agent:boot   │  │ command:reset  │  │  /memory    │  │
│  │    hook      │  │     hook       │  │   command   │  │
│  └──────┬───────┘  └───────┬────────┘  └──────┬──────┘  │
└─────────┼──────────────────┼──────────────────┼─────────┘
          │                  │                  │
          ▼                  ▼                  ▼
     ┌────────────────────────────────────────────────┐
     │            witness-memory-chain              │
     │                                                 │
     │  ┌─────────┐  ┌─────────┐  ┌─────────────────┐ │
     │  │  Chain  │  │  Index  │  │ OpenTimestamps  │ │
     │  │  Layer  │  │  Layer  │  │    Anchoring    │ │
     │  └────┬────┘  └────┬────┘  └────────┬────────┘ │
     └───────┼────────────┼────────────────┼──────────┘
             │            │                │
             ▼            ▼                ▼
        chain.jsonl   memory.db      anchors/*.ots
```

## License

MIT
