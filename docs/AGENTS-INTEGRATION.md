# Memory Chain - Integration Guide

How Memory Chain fits with existing agent memory patterns.

## The Three Memory Layers

Most sophisticated AI agents use multiple memory systems. Memory Chain doesn't replace them - it adds a cryptographic proof layer.

### 1. Memory Chain (Proof Layer)

**What it is:** Cryptographically signed, hash-linked, verifiable record of experiences.

**Use for:**
- Things that need to be provable (decisions, agreements, identity)
- Things that might be disputed ("Did I really agree to that?")
- Things that establish trust over time

**Characteristics:**
- Append-only (can't silently edit history)
- Signed (proves the agent wrote it)
- Hash-linked (proves ordering and completeness)
- Optionally Bitcoin-anchored (external proof of existence)

### 2. MEMORY.md / Personal Memory (Curated Layer)

**What it is:** Markdown file with curated personal context, feelings, lessons learned.

**Use for:**
- Subjective experiences and reflections
- Lessons that don't need cryptographic proof
- Private context the agent maintains about itself
- Evolving understanding (can be edited/refined)

**Characteristics:**
- Editable (can be updated as understanding evolves)
- Personal (not meant for external verification)
- Curated (agent decides what's worth keeping)

### 3. Daily Notes / Session Logs (Raw Layer)

**What it is:** Timestamped logs of each session.

**Use for:**
- Raw session transcripts
- Debugging and review
- Training data for improvements

**Characteristics:**
- Complete (everything recorded)
- Temporal (organized by time)
- Reference material (not primary memory source)

## When to Use Which

| Scenario | Memory Chain | MEMORY.md | Daily Notes |
|----------|-------------|-----------|-------------|
| User says "remember this" | Yes | Maybe | - |
| Agent learns user preference | Yes (relationship tier) | Yes | - |
| Agent makes a commitment | Yes (committed tier) | Yes | - |
| Agent reflects on experience | - | Yes | - |
| Session ends | Summary to chain | Update if significant | Full log |
| Debugging past behavior | Verify chain | - | Read logs |
| Proving to third party | Export chain | - | - |

## Integration Patterns

### Pattern 1: Commit Then Reflect

When something significant happens:

1. **Commit to chain** (creates proof)
   ```bash
   memory-chain add "Agreed to always use TypeScript for this project" --type decision --tier committed
   ```

2. **Update MEMORY.md** (adds context/reflection)
   ```markdown
   ## Project Decisions
   - Using TypeScript for all code (committed 2024-01-15)
     - User prefers type safety over quick prototyping
     - This aligns with their enterprise background
   ```

### Pattern 2: Search Chain, Enrich from MEMORY.md

On session start:

1. **Search chain for relevant memories**
   ```bash
   memory-chain search "typescript preferences"
   ```

2. **Cross-reference with MEMORY.md** for richer context

### Pattern 3: Periodic Sync

Every few sessions:

1. **Verify chain integrity**
   ```bash
   memory-chain verify
   ```

2. **Review recent chain entries** against MEMORY.md
3. **Ensure important chain entries are reflected** in curated memory

## What Goes Where: Decision Tree

```
Is this something that might need to be proven later?
├── Yes → Memory Chain
│   ├── Is it about who I am or my values? → type: identity, tier: committed
│   ├── Is it an agreement or rule? → type: decision, tier: committed
│   └── Is it a fact or preference? → type: memory, tier: relationship
└── No → Is it worth remembering long-term?
    ├── Yes → MEMORY.md
    └── No → Daily notes only (or don't record)
```

## Example: Full Integration

**User says:** "Remember that I prefer morning standups at 9am, and never schedule meetings on Fridays."

**Agent response:**

1. **Commit to chain:**
   ```bash
   memory-chain add "User prefers morning standups at 9am. Never schedule meetings on Fridays." --type memory --tier relationship
   ```

2. **Update MEMORY.md:**
   ```markdown
   ## User Preferences
   ### Scheduling
   - Standups: 9am (morning person, likes to start day with sync)
   - No Friday meetings (protects focus time for deep work)
   ```

3. **Session log captures the full exchange** for reference.

The chain proves the preference was recorded. MEMORY.md provides context about why. The session log shows the original conversation.

## Migration: Adding Memory Chain to Existing Agent

If your agent already has MEMORY.md or similar:

1. **Initialize chain**
   ```bash
   memory-chain init --name "YourAgent"
   ```

2. **Commit identity first**
   ```bash
   memory-chain add "I am [name]. [Core identity from existing MEMORY.md]" --type identity --tier committed
   ```

3. **Commit key decisions/agreements** from existing memory
   ```bash
   memory-chain add "[Important agreement]" --type decision --tier committed
   ```

4. **Going forward:** Commit new provable items to chain, continue using MEMORY.md for reflection

You don't need to migrate everything. The chain is for things that benefit from cryptographic proof. Keep MEMORY.md for everything else.
