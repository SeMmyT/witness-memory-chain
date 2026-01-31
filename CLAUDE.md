# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Manager

**Always use pnpm** - do not use npm.

## Commands

```bash
pnpm build           # Compile TypeScript to dist/
pnpm lint            # Type-check without emitting (tsc --noEmit)
pnpm test            # Run tests in watch mode
pnpm test:run        # Run tests once (CI mode)
```

Run a single test file:
```bash
pnpm vitest run test/chain.test.ts
```

Run tests matching a pattern:
```bash
pnpm vitest run -t "verify chain"
```

## Architecture

Memory Chain uses a **dual-layer architecture** separating integrity (chain) from retrieval (index):

```
src/
├── chain/           # Chain Layer - cryptographic integrity
│   ├── index.ts     # Core ops: initChain, addEntry, verifyChain
│   ├── crypto.ts    # Ed25519 signing, SHA-256 hashing, key encryption
│   └── export.ts    # Chain export/import for backup and transfer
├── index/           # Index Layer - fast retrieval (rebuildable from chain)
│   ├── sqlite.ts    # SQLite + FTS5 schema, CRUD operations
│   └── retrieval.ts # Hybrid scoring, token budgeting, context injection
├── storage/
│   └── content-store.ts  # Content-addressable storage (SHA-256 naming)
├── anchor/
│   ├── opentimestamps.ts # Bitcoin timestamping via OpenTimestamps
│   └── types.ts
├── types.ts         # All TypeScript interfaces
├── compression.ts   # Extractive summarization for memory compression
├── metrics.ts       # Telemetry collection
├── index.ts         # Public API exports
└── cli.ts           # CLI commands (memory-chain init/add/verify/search/etc)
```

### Key Design Decisions

1. **Chain is append-only JSONL** - Human-readable, easy to debug, atomic appends via `proper-lockfile`

2. **Content stored separately** - Chain entries contain `content_hash`, actual content in `content/` directory. Enables deduplication and redaction without breaking chain integrity.

3. **Index is disposable** - SQLite database can be rebuilt from chain at any time via `rebuildFromChain()`

4. **Hybrid retrieval scoring** - Combines FTS5 keyword match (40%), recency (30%), importance (20%), access frequency (10%)

5. **Three memory tiers** - `committed` (permanent), `relationship` (redactable), `ephemeral` (session-scoped)

6. **Three key modes** - `raw` (file), `encrypted` (scrypt+AES-256-GCM), `env` (environment variable)

### Data Flow

```
addEntry(content) → sign with Ed25519 → hash-link to previous → append to chain.jsonl
                                                              → store content in content/{hash}
                                                              → update SQLite index
```

### Cryptographic Libraries

Uses audited `@noble/*` libraries (no homebrew crypto):
- `@noble/ed25519` - Signing
- `@noble/hashes` - SHA-256, scrypt

## Testing

Tests use Vitest with temporary directories. Each test file creates isolated data directories that are cleaned up after tests.

Test files mirror source structure:
- `chain.test.ts` - Chain init, add, verify, signatures, concurrent access
- `retrieval.test.ts` - Hybrid scoring, FTS5, token budgeting
- `content-store.test.ts` - Store, verify, redact, deduplication
- `anchor.test.ts` - OpenTimestamps submission/verification
- `compression.test.ts` - Summarization, entity extraction
- `metrics.test.ts` - Event recording

## Skill Integration

The `skill/` directory contains Claude Code skill integration for Telegram bots:
- `hooks/agent-bootstrap.ts` - Inject memories on agent startup
- `hooks/command-reset.ts` - Auto-commit session summary
- `commands/memory.ts` - `/memory` command handler
