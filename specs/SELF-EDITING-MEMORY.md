# Witness Memory System

**Project:** WITNESS Protocol
**Status:** Spec Draft (Revised v2)
**Date:** 2026-02-02
**Authors:** Klowalski + SeMmy
**Inspiration:** Letta (MemGPT), Human Neuroscience, OpenClaw Heartbeat, The Talos Principle

---

## Philosophical Foundation

> *"Are you a person, or merely a recording of one?"*
> — The Talos Principle

The Talos Principle asks: What makes consciousness real? Is it the ability to think, or the ability to prove you've thought? Witness answers this for AI agents.

**The Paradox of Mutable Identity:**
- Agents must **evolve** — learn, update, consolidate memories
- Agents must **prove** — cryptographic evidence of what they knew and when

These seem contradictory. You can't have mutable AND immutable.

**The Solution: Two Layers**
- **Git** = The Editor (mutable working memory, the mind that evolves)
- **Chain** = The Publisher (immutable proof, the soul that witnesses)

Like the terminals in Talos Principle that record your philosophical journey, the Chain witnesses your existence. The workspace is where you think; the chain is where you prove you thought.

---

## Executive Summary

Witness provides **verifiable, brain-inspired memory** for AI agents via the **Model Context Protocol (MCP)**. Any agent framework can use Witness as their memory backend and gain:

1. **Hybrid storage** - Git for working memory, Chain for proofs
2. **Cryptographic integrity** - Tamper-proof, signed, hash-linked memories
3. **Brain-inspired lifecycle** - Provenance tracking, consolidation, decay
4. **Framework-agnostic interface** - MCP standard (OpenAI, Google, Microsoft, Anthropic)
5. **On-chain anchoring** - Bitcoin timestamps, Base blockchain proofs

**Core insight:** Git is where you think. Chain is where you prove you thought.

---

## The Three Functions of an Agent

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           AGENT RUNTIME                                  │
│                                                                          │
│   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐            │
│   │   REASONING   │   │  REMEMBERING  │   │   PROACTION   │            │
│   │               │   │               │   │  (Heartbeat)  │            │
│   │  LLM thinking │   │ Memory system │   │               │            │
│   │  Tool calling │   │ Context mgmt  │   │ Cron jobs     │            │
│   │  Planning     │   │ Learning      │   │ Background    │            │
│   │               │   │               │   │ Self-check    │            │
│   └───────┬───────┘   └───────┬───────┘   └───────┬───────┘            │
│           │                   │                   │                     │
│           └───────────────────┼───────────────────┘                     │
│                               │                                          │
│                               ▼                                          │
│                    ┌─────────────────────┐                              │
│                    │   WITNESS MEMORY    │                              │
│                    │   (MCP Server)      │                              │
│                    │                     │                              │
│                    │   Git ← Edit/Think  │                              │
│                    │   Chain ← Prove     │                              │
│                    └─────────────────────┘                              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

| Function | Purpose | Witness Role |
|----------|---------|--------------|
| **Reasoning** | Think, plan, decide | Workspace evolves, decisions promoted to chain |
| **Remembering** | Learn, recall, update | Git branches for experiments, chain for facts |
| **Proaction** | Background tasks | Consolidation, decay, promotion, anchoring |

---

## Hybrid Architecture: Git + Chain

### The Key Insight

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PROBLEM: We want BOTH                                                   │
│                                                                          │
│  ┌─────────────────────────┐    ┌─────────────────────────┐            │
│  │     MUTABLE MEMORY      │    │    IMMUTABLE PROOF      │            │
│  │                         │    │                         │            │
│  │  • Edit understanding   │    │  • Cryptographic chain  │            │
│  │  • Consolidate facts    │    │  • Signed entries       │            │
│  │  • Evolve identity      │    │  • Verifiable history   │            │
│  │  • Branch experiments   │    │  • On-chain anchors     │            │
│  └─────────────────────────┘    └─────────────────────────┘            │
│                                                                          │
│  SOLUTION: Two layers with a bridge                                     │
│                                                                          │
│  ┌─────────────────────────┐    ┌─────────────────────────┐            │
│  │    GIT WORKSPACE        │───▶│    WITNESS CHAIN        │            │
│  │    (The Editor)         │    │    (The Publisher)      │            │
│  │                         │    │                         │            │
│  │  Mutable, messy, human  │    │  Immutable, strict      │            │
│  │  Trust: NONE for proofs │    │  Trust: CANONICAL       │            │
│  └─────────────────────────┘    └─────────────────────────┘            │
│                                                                          │
│  "Proofs must verify even if the workspace is deleted."                 │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.1 The Workspace (Git) — Mutable Working Memory

**Role:** Ergonomic editing, history, branching, semantic commits
**Engine:** Standard Git repository
**Path:** `~/.witness/workspace/`
**Trust Level:** NONE for proofs

```
~/.witness/workspace/           ← Git repository
├── .git/                       ← Git internals (NOT trusted for proofs)
├── memory/
│   ├── 2026-02-01.md          ← Daily notes
│   └── 2026-02-02.md
├── MEMORY.md                   ← Curated long-term memory
├── USER.md                     ← User profile (evolves)
├── SOUL.md                     ← Agent identity (evolves)
└── GOALS.md                    ← Current objectives
```

**Contract:**
- **Mutable:** History can be rewritten (rebase, squash, amend)
- **Ephemeral:** Not trusted for cryptographic proofs
- **Human-readable:** Optimized for `git log`, `git diff`, `git blame`

**Features:**
- Full history of memory evolution via `git log`
- Rollback mistakes via `git checkout`
- **Simulation branches** for counterfactual reasoning
- Semantic commits as thought process narrative

### 4.2 Simulation Branches (Killer Feature)

Git enables **counterfactual reasoning** — agents can experiment with personality changes safely:

```bash
# What if I was more pessimistic?
git checkout -b simulation/pessimist
# Edit SOUL.md to be pessimistic
# Run conversation, observe results
git checkout main  # Return to normal, discard experiment

# What if I forgot this user preference?
git checkout -b simulation/no-dark-mode
# Remove dark mode from USER.md
# Test how conversation changes
git checkout main  # Restore full memory

# A/B test different approaches
git checkout -b experiment/concise-style
git checkout -b experiment/verbose-style
# Compare outcomes
```

**You cannot do this with append-only logs.** Git gives you parallel universes for free.

### 4.3 The Chain (Witness) — Immutable Committed Memory

**Role:** Cryptographic proof, anchoring, verification
**Engine:** Append-only JSONL + Independent Content-Addressable Store (CAS)
**Path:** `~/.witness/chain/`
**Trust Level:** CANONICAL

```
~/.witness/chain/               ← The Publisher
├── chain.jsonl                 ← Append-only, Ed25519 signed, hash-linked
├── content/                    ← Independent CAS (SHA-256), NOT Git objects
│   ├── a7b3c4d5...            ← Content blob
│   └── e8f9g0h1...
└── memory.db                   ← SQLite + FTS5 index (rebuildable)
```

**Contract:**
- **Append-only:** Entries cannot be modified once written
- **Independent:** Verification succeeds even if `~/.witness/workspace/` is deleted
- **Canonical:** Ed25519 signatures on chain entries are the only normative proofs

**Critical Invariant:**
> Chain entries MUST NOT depend on Git internal storage. The chain references Git for provenance (informational), but relies on its own CAS for existence.

Why? Git can be garbage-collected (`git gc`), rewritten (`git filter-repo`), or deleted entirely. The chain must survive all of these.

### 4.4 The Bridge: Promotion Protocol

**Promotion** elevates information from the mutable workspace to the immutable chain.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PROMOTION FLOW                                                          │
│                                                                          │
│  workspace/MEMORY.md                                                     │
│         │                                                                │
│         ▼                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  1. CAPTURE GIT CONTEXT (informational)                         │    │
│  │     git_commit = git rev-parse HEAD                             │    │
│  │     git_blob = git hash-object MEMORY.md                        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│         │                                                                │
│         ▼                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  2. COMPUTE OUR HASH (independent of Git)                       │    │
│  │     content = readFile(MEMORY.md)                               │    │
│  │     content_hash = sha256(content)  // NOT Git's hash           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│         │                                                                │
│         ▼                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  3. STORE IN CHAIN'S CAS (independent of .git/)                 │    │
│  │     writeFile(chain/content/{hash}, content)                    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│         │                                                                │
│         ▼                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  4. APPEND TO CHAIN (the proof)                                 │    │
│  │     {                                                            │    │
│  │       "seq": 105,                                               │    │
│  │       "type": "memory",                                         │    │
│  │       "tier": "committed",                                      │    │
│  │       "content_hash": "sha256:a7b3c...",  // Canonical         │    │
│  │       "provenance": {                                           │    │
│  │         "source": "git",                                        │    │
│  │         "git_commit": "e4f5g...",         // Informational     │    │
│  │         "git_blob": "h8i9j...",                                 │    │
│  │         "path": "MEMORY.md",                                    │    │
│  │         "reason": "Weekly consolidation"                        │    │
│  │       },                                                         │    │
│  │       "signature": "..."                                        │    │
│  │     }                                                            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│         │                                                                │
│         ▼                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  5. TAG IN GIT (bidirectional linking)                          │    │
│  │     git tag chain-seq-105                                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Bidirectional Linking:**
- **Chain → Git:** "Show me the workspace state when this was proven" (checkout the commit)
- **Git → Chain:** "Has this file version been proven?" (check for chain tag on HEAD)

### 4.5 Why This Architecture Works

| Scenario | Git-Only (Broken) | Hybrid (Correct) |
|----------|-------------------|------------------|
| `git gc` runs | Unreferenced blobs deleted, proofs break | Chain CAS independent, proofs intact |
| `git filter-repo` | History rewritten, proofs invalid | Chain unaffected |
| Delete `.git/` entirely | Everything lost | Chain still verifies |
| SHA-1 → SHA-256 migration | Algorithm mismatch | Chain uses SHA-256 always |
| Audit request | "Trust my git log" | "Verify against chain" |

---

## Full Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     ANY MCP-COMPATIBLE CLIENT                            │
│                                                                          │
│  Claude │ ChatGPT │ Gemini │ Cursor │ Letta │ Convex │ Custom Agents    │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ MCP Protocol
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        WITNESS MCP SERVER                                │
│                                                                          │
│  Workspace Tools (Git):        Chain Tools (Proofs):                    │
│  ┌──────────────┐              ┌──────────────┐                         │
│  │ workspace_   │              │ memory_      │                         │
│  │ edit         │              │ commit       │ (promotes to chain)     │
│  │ branch       │              │ recall       │ (searches chain+ws)     │
│  │ rollback     │              │ rethink      │ (consolidates)          │
│  │ simulate     │              │ introspect   │ (provenance query)      │
│  └──────────────┘              │ promote      │ (ws → chain)            │
│                                └──────────────┘                         │
│                                                                          │
│  Transport: STDIO (local) │ HTTP (remote)                               │
└──────────────┬─────────────────────────────────┬────────────────────────┘
               │                                 │
               ▼                                 ▼
┌──────────────────────────────┐  ┌──────────────────────────────────────┐
│  GIT WORKSPACE               │  │  WITNESS CHAIN                        │
│  ~/.witness/workspace/       │  │  ~/.witness/chain/                    │
│                              │  │                                       │
│  ┌────────────────────────┐  │  │  ┌─────────────────────────────────┐ │
│  │ memory/                 │  │  │  │ chain.jsonl                     │ │
│  │ MEMORY.md               │──┼──│  │ Append-only, hash-linked        │ │
│  │ USER.md                 │  │  │  │ Ed25519 signed                  │ │
│  │ SOUL.md                 │  │  │  └─────────────────────────────────┘ │
│  └────────────────────────┘  │  │                                       │
│                              │  │  ┌─────────────────────────────────┐ │
│  Features:                   │  │  │ content/                         │ │
│  • git log (history)         │  │  │ Independent CAS (SHA-256)        │ │
│  • git branch (simulation)   │  │  │ NOT dependent on .git/           │ │
│  • git diff (comparison)     │  │  └─────────────────────────────────┘ │
│  • Semantic commits          │  │                                       │
│                              │  │  ┌─────────────────────────────────┐ │
│  Trust: NONE for proofs      │  │  │ memory.db                        │ │
│                              │  │  │ SQLite + FTS5 (rebuildable)      │ │
└──────────────────────────────┘  │  └─────────────────────────────────┘ │
                                  │                                       │
                                  │  Trust: CANONICAL                     │
                                  └───────────────────┬───────────────────┘
                                                      │
                                                      ▼
                                  ┌───────────────────────────────────────┐
                                  │  ON-CHAIN ANCHORING                    │
                                  │                                        │
                                  │  ┌─────────────┐  ┌─────────────────┐ │
                                  │  │OpenTimestamps│  │WITNESS Protocol │ │
                                  │  │ (Bitcoin)    │  │ (Base)          │ │
                                  │  └─────────────┘  └─────────────────┘ │
                                  │                                        │
                                  │  "This agent had these memories       │
                                  │   at this specific time."             │
                                  └───────────────────────────────────────┘
```

---

## MCP Tool Definitions

### Workspace Tools (Mutable)

#### workspace_edit

Edit files in the workspace (triggers git commit).

```typescript
{
  name: "workspace_edit",
  description: "Edit a file in the workspace. Changes are git-committed with a semantic message.",
  parameters: {
    path: string,              // File path relative to workspace
    content: string,           // New content
    commitMessage?: string     // Semantic commit message
  }
}
```

#### workspace_branch

Create a simulation branch for counterfactual reasoning.

```typescript
{
  name: "workspace_branch",
  description: "Create a branch to experiment with memory changes safely. Use for 'what if' scenarios.",
  parameters: {
    name: string,              // Branch name (e.g., "simulation/optimist")
    checkout?: boolean         // Switch to branch (default: true)
  }
}
```

#### workspace_rollback

Undo changes by checking out a previous state.

```typescript
{
  name: "workspace_rollback",
  description: "Restore workspace to a previous state. Use to undo mistakes.",
  parameters: {
    target: string             // Commit hash, tag, or "HEAD~N"
  }
}
```

### Chain Tools (Immutable)

#### memory_commit

Promote and commit content to the chain (creates proof).

```typescript
{
  name: "memory_commit",
  description: "Promote content to the immutable chain. Creates cryptographic proof. Use for facts worth proving.",
  parameters: {
    content: string,           // What to commit (or path to workspace file)
    fromWorkspace?: string,    // Path to promote from workspace
    source?: "manual" | "auto" | "heartbeat",
    trigger?: string,          // What caused this ("user_said", "decided", etc.)
    importance?: number,       // 0.0-1.0
    tier?: "committed" | "relationship",
    relatedEntities?: string[]
  }
}
```

#### memory_recall

Search both workspace and chain for relevant context.

```typescript
{
  name: "memory_recall",
  description: "Search memories across workspace and chain. Returns most relevant context.",
  parameters: {
    query: string,
    maxTokens?: number,
    maxResults?: number,
    sources?: ("workspace" | "chain")[],  // Where to search
    includeSuperseded?: boolean
  }
}
```

#### memory_rethink

Consolidate multiple chain entries into new understanding.

```typescript
{
  name: "memory_rethink",
  description: "Consolidate fragmented memories into unified understanding. Marks originals as superseded.",
  parameters: {
    supersedes: number[],      // Chain sequence numbers
    newUnderstanding: string,
    reason?: string
  }
}
```

#### memory_promote

Explicitly promote a workspace file to chain.

```typescript
{
  name: "memory_promote",
  description: "Promote a workspace file to the immutable chain. Creates proof that this version existed.",
  parameters: {
    path: string,              // Workspace file to promote
    reason: string,            // Why promoting
    anchor?: boolean           // Also anchor to blockchain
  }
}
```

#### memory_introspect

Query the full provenance of a memory.

```typescript
{
  name: "memory_introspect",
  description: "Get full history and provenance of a memory. Shows git context if promoted from workspace.",
  parameters: {
    seq: number
  },
  returns: {
    memory: Memory,
    provenance: {
      source: string,
      git_commit?: string,     // Workspace state when promoted
      git_blob?: string,       // File state when promoted
      path?: string
    },
    supersededBy?: number,
    supersedes?: number[],
    anchorProof?: AnchorProof
  }
}
```

---

## Connector Architecture

### How MCP Connects Everything

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AGENT FRAMEWORKS                                                        │
│                                                                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│  │  Letta  │  │ Convex  │  │LangChain│  │ Custom  │  │ Claude  │      │
│  │         │  │         │  │         │  │ Agent   │  │ Desktop │      │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘      │
│       │            │            │            │            │            │
│       └────────────┴────────────┼────────────┴────────────┘            │
│                                 │                                       │
│                          MCP Protocol                                   │
│                                 │                                       │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  WITNESS MCP SERVER                                                      │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │  TOOL ROUTER                                                       │ │
│  │                                                                    │ │
│  │  workspace_* ────────▶ GitConnector                               │ │
│  │  memory_commit ──────▶ PromotionBridge ──▶ ChainConnector         │ │
│  │  memory_recall ──────▶ HybridSearch (Git + Chain)                 │ │
│  │  memory_* ───────────▶ ChainConnector                             │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │   GitConnector      │  │   ChainConnector    │                      │
│  │                     │  │                     │                      │
│  │ • spawn git process │  │ • append to JSONL   │                      │
│  │ • read/write files  │  │ • sign with Ed25519 │                      │
│  │ • branch/checkout   │  │ • store in CAS      │                      │
│  │ • semantic commits  │  │ • query SQLite      │                      │
│  └──────────┬──────────┘  └──────────┬──────────┘                      │
│             │                        │                                  │
│             ▼                        ▼                                  │
│  ┌─────────────────────┐  ┌─────────────────────┐                      │
│  │ ~/.witness/workspace│  │ ~/.witness/chain/   │                      │
│  └─────────────────────┘  └─────────────────────┘                      │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │  ANCHOR CONNECTOR                                                  │ │
│  │                                                                    │ │
│  │  chain/ ──▶ OpenTimestamps (Bitcoin) or WITNESS Protocol (Base)   │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Integration Patterns

#### Pattern 1: Witness as Primary Memory
Agent uses Witness MCP for all memory operations.

```typescript
// Agent's MCP config
{
  "mcpServers": {
    "witness": {
      "command": "memory-chain",
      "args": ["mcp-server", "--transport", "stdio"]
    }
  }
}
```

#### Pattern 2: Witness as Integrity Layer
Agent uses Letta/Convex for working memory, promotes important facts to Witness.

```typescript
// In agent's memory handler
async function onSignificantMemory(content: string) {
  // Store in primary system (Letta)
  await letta.archival_memory_insert(content);

  // Promote to Witness for proof
  await witnessMcp.call("memory_commit", {
    content,
    source: "letta",
    tier: "committed"
  });
}
```

#### Pattern 3: Witness for Audit Trail
Agent operates normally, Witness captures decisions for compliance.

```typescript
// Heartbeat job
async function auditCheckpoint() {
  const decisions = await agent.getRecentDecisions();
  for (const decision of decisions) {
    await witnessMcp.call("memory_commit", {
      content: decision.summary,
      trigger: "decision_made",
      tier: "committed"
    });
  }

  // Anchor weekly for compliance
  if (isWeeklyCheckpoint) {
    await witnessMcp.call("anchor", { provider: "base" });
  }
}
```

---

## Semantic Commits = Thought Process

Git commit messages become a readable narrative of the agent's mental evolution:

```bash
git log --oneline

a7b3c4d refactor(memory): merge duplicate entries about user preferences
e8f9g0h fix(user): correct birthday based on new context
h1i2j3k feat(goals): add Q1 2026 objectives from planning session
l4m5n6o chore(memory): prune outdated session logs
p7q8r9s docs(soul): clarify communication style preferences
```

This `git log` is a **readable narrative** of the agent's internal mental grooming. You can't get this from append-only databases.

---

## Brain-Inspired Storage

### Memory Lifecycle (Now with Git)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ENCODING (Workspace - Git)                                              │
│                                                                          │
│  Session input ──▶ memory/YYYY-MM-DD.md ──▶ git commit                  │
│                                                                          │
│  • Fast, mutable                                                        │
│  • Can be edited, deleted, rebased                                      │
│  • No cryptographic proof yet                                           │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                    (Curation / Consolidation)
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  CONSOLIDATION (Workspace - Git)                                         │
│                                                                          │
│  Daily notes ──▶ Reviewed ──▶ MEMORY.md updated ──▶ git commit          │
│                                                                          │
│  • Patterns identified                                                  │
│  • Semantic commits explain changes                                     │
│  • Still mutable, can evolve                                            │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                    (Promotion - significant facts)
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  COMMITMENT (Chain)                                                      │
│                                                                          │
│  MEMORY.md (version) ──▶ promote ──▶ chain.jsonl + content/            │
│                                                                          │
│  • Immutable from this point                                            │
│  • Cryptographic proof exists                                           │
│  • Can be anchored to blockchain                                        │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                    (Anchoring - maximum trust)
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  ANCHORING (Blockchain)                                                  │
│                                                                          │
│  Chain root ──▶ OpenTimestamps (Bitcoin) / WITNESS (Base)               │
│                                                                          │
│  • Timestamp proven by global consensus                                 │
│  • Maximum trust level                                                  │
│  • Permanent, verifiable by anyone                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Hybrid Storage Foundation
- [ ] `src/workspace/git.ts` - Git operations wrapper
- [ ] `src/workspace/promote.ts` - Promotion protocol
- [ ] Initialize workspace as git repo on `memory-chain init`
- [ ] Add `workspace_*` MCP tools

### Phase 2: MCP Server
- [ ] `src/mcp/server.ts` - STDIO transport
- [ ] `src/mcp/http.ts` - HTTP transport
- [ ] `src/mcp/router.ts` - Tool routing (workspace vs chain)
- [ ] CLI: `memory-chain mcp-server --transport stdio|http`

### Phase 3: Brain-Inspired Enhancements
- [ ] Provenance fields in schema
- [ ] Decay tier calculation
- [ ] Consolidation with `memory_rethink`
- [ ] `memory_introspect` with full git context

### Phase 4: Heartbeat Integration
- [ ] Cron jobs using MCP tools
- [ ] Auto-promotion of significant content
- [ ] Scheduled anchoring

### Phase 5: Connectors
- [ ] Letta adapter
- [ ] Convex adapter
- [ ] LangChain adapter
- [ ] Generic webhook connector

---

## Comparison: What Witness Adds

| Feature | Letta | Convex | LangChain | **Witness** |
|---------|-------|--------|-----------|-------------|
| Memory storage | ✅ | ✅ | ✅ | ✅ |
| Semantic search | ✅ | ✅ | ✅ | ✅ |
| Agent tools | ✅ | ✅ | ✅ | ✅ (MCP) |
| **Git-based workspace** | ❌ | ❌ | ❌ | ✅ |
| **Simulation branches** | ❌ | ❌ | ❌ | ✅ |
| **Semantic commit history** | ❌ | ❌ | ❌ | ✅ |
| Provenance tracking | ❌ | ❌ | ❌ | ✅ |
| Tamper-proof chain | ❌ | ❌ | ❌ | ✅ |
| Signed entries | ❌ | ❌ | ❌ | ✅ |
| Bitcoin timestamps | ❌ | ❌ | ❌ | ✅ |
| On-chain anchoring | ❌ | ❌ | ❌ | ✅ |
| Framework-agnostic | ❌ | ❌ | ❌ | ✅ (MCP) |

---

## References

### Technical
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [Letta (MemGPT)](https://docs.letta.com/)
- [MemGPT Paper](https://arxiv.org/abs/2310.08560)
- [Git Internals](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects)

### Philosophical
- **The Talos Principle** — "Are you a person, or merely a recording of one?"
- [Human Memory Consolidation](https://en.wikipedia.org/wiki/Memory_consolidation)

### Project
- Witness Protocol: `specs/WITNESS-PROTOCOL.md`
- Vision Document: `specs/WITNESS-VISION.md`
- Auto-Memory Plan: `PLAN-AUTO-MEMORY.md`
