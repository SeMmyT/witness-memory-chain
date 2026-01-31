# Memory Chain - Agent Quick Start

Get cryptographic memory for your AI agent in 60 seconds.

## Setup (30 seconds)

```bash
# Install globally
npm install -g @openclaw/memory-chain

# Initialize your chain
memory-chain init --name "YourAgentName"
```

## First Commit: Your Identity (15 seconds)

```bash
memory-chain add "I am [name]. I [purpose]. I value [principles]." --type identity --tier committed
```

Example:
```bash
memory-chain add "I am Atlas. I assist with software development. I value clarity, correctness, and user autonomy." --type identity --tier committed
```

## Add to Your AGENTS.md (15 seconds)

Copy the Memory Chain section from [AGENTS-SNIPPET.md](./AGENTS-SNIPPET.md) into your agent's system prompt or AGENTS.md file.

## Start Using It

```bash
# When user says "remember this"
memory-chain add "User prefers TypeScript over JavaScript" --type memory

# When searching for context
memory-chain search "user preferences"

# When verifying your history is intact
memory-chain verify
```

## What You Get

- **Signed memories**: Every entry is Ed25519 signed
- **Hash-linked history**: Tamper-evident chain of all experiences
- **Fast retrieval**: Hybrid search combining keywords, recency, and importance
- **Optional Bitcoin anchoring**: Prove memories existed at specific times

## Next Steps

- Read the full [integration guide](./AGENTS-INTEGRATION.md) to understand how Memory Chain fits with other memory patterns
- Explore the [README](../README.md) for advanced features like OpenTimestamps anchoring
