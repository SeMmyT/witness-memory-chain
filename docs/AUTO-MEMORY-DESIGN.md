# Auto-Memory System: A Synthesized Approach

**Branch:** `beta/auto-memory`
**Status:** Design complete, ready for review
**Reviewer:** Klowalski

---

## The Problem We're Solving

AI agents lose valuable context when sessions reset. Every conversation starts from zero. Users repeat themselves. Preferences are forgotten. Decisions aren't remembered.

**But wait** — why not just use simple agentic search?

---

## Why Not Just Agentic Search?

Boris Cherny (Claude Code team) on why they abandoned RAG + vector DB:

> "Early versions of Claude Code used RAG + a local vector db, but we found pretty quickly that agentic search generally works better. It is also simpler and doesn't have the same issues around security, privacy, staleness, and reliability."
>
> — [@bcherny, Jan 31 2026](https://x.com/bcherny/status/2017824286489383315)

Dan Adler (Sourcegraph) agreed, noting their "Deep Search agent" solves this at scale.

**Key insight:** For *codebase search*, agentic search wins. The LLM reads files directly — always fresh, can reason about what it finds, no embedding drift.

**But memory is different.**

| Codebase Search | Memory Retrieval |
|-----------------|------------------|
| Files change constantly | Memories are append-only |
| Need current state | Need historical context |
| LLM reads source directly | LLM needs curated summaries |
| No proof needed | Proof may be valuable |

Agentic search solves "find code." It doesn't solve "remember who I am across sessions."

---

## Our Approach: Layered Memory Architecture

We synthesize three approaches:

1. **Brain-inspired consolidation** (hippocampus → neocortex model)
2. **Evidence-based observations** (from Hindsight 0.4.0)
3. **Cryptographic proof** (our Memory Chain)

### The Layers

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: MEMORY CHAIN (Ground Truth)                           │
│                                                                  │
│  Append-only JSONL, Ed25519 signed, hash-linked                 │
│  Every fact, decision, preference with timestamp                │
│  Optional: Anchor to Base blockchain via WITNESS protocol       │
│                                                                  │
│  This is PROVABLE. Immutable. The source of truth.              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ curation synthesizes
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2: OBSERVATIONS (Synthesized Patterns)                   │
│                                                                  │
│  ## Observation: Prefers Vue.js over React                      │
│  Evidence: [entry_42], [entry_87], [entry_103]                  │
│  History: React (2025) → Vue (2026-01)                          │
│  Why: "Composition API feels more natural"                      │
│  Last confirmed: 2026-02-01                                     │
│                                                                  │
│  Each observation links to supporting chain entries.            │
│  Tracks evolution — not just current state, but journey.        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ hot subset surfaces
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: MEMORY.md (Working Memory)                            │
│                                                                  │
│  Small file (<4K tokens) injected into agent context            │
│  Contains hot observations + recent facts                       │
│  Agent reasons with this — doesn't search for it                │
│                                                                  │
│  When this grows too large → index kicks in (Phase 2)           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ bootstrap injects
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  AGENT CONTEXT (Consciousness)                                  │
│                                                                  │
│  System prompt includes MEMORY.md                               │
│  Agent reasons with memories available                          │
│  Memory retrieval is SEPARATE from reasoning                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### 1. Evidence-Based Observations (from Hindsight)

Traditional approach:
```
"User prefers dark mode" → importance: 0.8
```

Evidence-based approach:
```
"User prefers dark mode"
  ├── evidence: [entry_12, entry_45]
  ├── first_noted: 2026-01-15
  ├── last_confirmed: 2026-02-01
  └── context: "Mentioned during late-night coding sessions"
```

**Why this matters:** The agent can explain *why* it believes something, not just that it does. Confidence comes from evidence, not arbitrary scores.

### 2. Encoding vs Consolidation Separation (from neuroscience)

The brain doesn't encode and consolidate simultaneously. Neither should we.

| Brain | Our System |
|-------|------------|
| Hippocampus (fast encoding) | Main session captures experiences |
| Sleep (offline consolidation) | Cron jobs synthesize patterns |
| Neocortex (long-term storage) | Memory Chain stores permanently |
| Working memory | MEMORY.md in context |

**Implementation:** Isolated cron jobs read session history via `sessions_history` API. Main session is never interrupted.

### 3. Index is Optional, Chain is Sacred

```
Chain (append-only) ─────────────────────► NEVER mutate
         │
         ├─── mirrors to ───► SQLite Index ───► Can rebuild anytime
         │
         └─── curates to ───► MEMORY.md ───► Working memory view
```

Garbage collection = remove from index, preserve chain. Like the brain: weaken access paths, don't delete engrams.

### 4. Start Simple, Add Complexity When Needed

**Phase 1 (MVP):**
```
Chain ──curation cron──► MEMORY.md ──bootstrap──► Context
```
- Just maintain MEMORY.md
- Inject whole file on bootstrap
- Agent reasons with full working memory

**Phase 2 (when MEMORY.md > 4K tokens):**
```
Chain ──mirrors──► SQLite FTS5 ──query + verify──► Relevant subset ──► Context
```
- Index narrows candidates
- Agent verifies relevance
- Hybrid: algorithmic speed + agentic reasoning

---

## What We Already Built

| Component | Status |
|-----------|--------|
| Chain layer (Ed25519, SHA-256, JSONL) | ✅ Complete |
| Index layer (SQLite, FTS5, hybrid scoring) | ✅ Complete |
| Content-addressable storage | ✅ Complete |
| Bootstrap hook (memory injection) | ✅ Complete |
| Reset hook (auto-commit on /reset) | ✅ Complete |
| CLI commands | ✅ Complete |
| OpenTimestamps anchoring | ✅ Complete |
| Base blockchain anchoring | ✅ Complete |

**The cryptographic integrity layer is production-ready.**

---

## What We Need to Build

### Phase 1: Cron Infrastructure
- `memory-checkpoint` (Haiku, hourly) — extract from session
- `memory-curation` (Sonnet, weekly) — synthesize observations
- `chain-maintenance` (Sonnet, weekly) — verify + anchor

### Phase 2: Evidence-Based Observations
- Link observations to supporting chain entries
- Track evolution (was X, now Y, because Z)
- Hot/Warm/Cold decay based on access

### Phase 3: Scaled Retrieval (when needed)
- FTS5 index for candidate retrieval
- Agent verification for precision
- Token-budgeted injection

---

## Comparison: Our System vs Alternatives

| Feature | RAG + Embeddings | Agentic Search | Hindsight | **Our System** |
|---------|------------------|----------------|-----------|----------------|
| Semantic matching | ✅ Vectors | ✅ LLM reasons | ✅ LLM reasons | ✅ LLM reasons |
| Always fresh | ❌ Stale embeddings | ✅ Reads source | ⚠️ Depends | ✅ Chain is truth |
| Privacy | ❌ Cloud embeddings | ✅ Local | ✅ Local | ✅ Local |
| Evidence tracking | ❌ | ❌ | ✅ | ✅ |
| Cryptographic proof | ❌ | ❌ | ❌ | ✅ |
| Blockchain anchor | ❌ | ❌ | ❌ | ✅ |
| Cross-session memory | ❌ | ❌ | ✅ | ✅ |
| Simple to start | ❌ Complex | ✅ Very simple | ⚠️ API required | ✅ File-based MVP |

---

## The Brain Parallel

| Brain Component | Our System | Role |
|-----------------|------------|------|
| Sensory input | User messages | Raw experience |
| Hippocampus | Main session + hooks | Fast encoding |
| Sleep consolidation | Weekly curation cron | Pattern synthesis |
| Neocortex | Memory Chain | Long-term storage |
| Working memory | MEMORY.md in context | Currently active subset |
| Prefrontal cortex | Agent reasoning | Uses memories, doesn't store |

The key insight: **Memory retrieval and reasoning are separate processes.** The curation cron acts as the "memory system" — it decides what to surface. The main agent just receives memories and reasons with them.

---

## Why Adopt This?

### If you want simple
Start with just MEMORY.md. No index, no crons. Manually update it. Bootstrap hook injects it. Done.

### If you want automatic
Add the cron jobs. They capture and curate automatically. You never think about it.

### If you want provable
The chain gives you Ed25519 signatures and hash-linking. Anchor to Base for blockchain timestamps. Prove what was known and when.

### If you want evidence-based
Observations link to supporting facts. The agent can explain its beliefs. Preferences track their evolution.

**Start anywhere. Add complexity only when you need it.**

---

## Implementation Order

1. **Phase 1: File-Based MVP**
   - Maintain MEMORY.md manually or via cron
   - Bootstrap injects whole file
   - No index needed yet

2. **Phase 2: Cron Jobs**
   - `memory-checkpoint` (Haiku, hourly)
   - `memory-curation` (Sonnet, weekly)
   - `chain-maintenance` (Sonnet, weekly)

3. **Phase 3: Evidence-Based Observations**
   - Link observations to chain entries
   - Track preference evolution
   - Hot/Warm/Cold decay

4. **Phase 4: Scaled Retrieval**
   - When MEMORY.md > 4K tokens
   - FTS5 + agent verification
   - Token-budgeted injection

---

## Sources

### Primary Influences

1. **Boris Cherny on agentic search vs RAG**
   - Source: [X/Twitter thread, Jan 31 2026](https://x.com/bcherny/status/2017824286489383315)
   - Key insight: Agentic search beats RAG for codebase exploration
   - Our adaptation: Memory is different — append-only, needs cross-session persistence

2. **Hindsight 0.4.0: AI Agent Memory Architecture**
   - Source: [hindsight.vectorize.io/blog/learning-capabilities](https://hindsight.vectorize.io/blog/learning-capabilities)
   - Key insight: Evidence-based observations beat confidence scores
   - Our adoption: Observations link to supporting chain entries, track evolution

3. **Nat Eliason's PARA + QMD System**
   - Source: "Agentic Personal Knowledge Management with OpenClaw, PARA, and QMD"
   - Key insight: Hot/Warm/Cold decay based on access patterns
   - Our adoption: Decay tiers for memory temperature

4. **Human Memory Consolidation Research**
   - Concept: Hippocampus → Neocortex model, sleep consolidation
   - Key insight: Encoding and consolidation are separate processes
   - Our adoption: Main session encodes, cron jobs consolidate

### Our Unique Contributions

5. **Memory Chain (this project)**
   - Ed25519 signatures for authenticity
   - SHA-256 hash-linking for integrity
   - Content-addressable storage for deduplication
   - Append-only JSONL for auditability

6. **WITNESS Protocol**
   - On-chain anchoring to Base blockchain
   - Provable timestamps via Merkle roots
   - AgentGrantPool for one-tx claim

---

## Open Questions for Review

1. **sessions_history API** — Is this available in OpenClaw? Fallback if not?

2. **Observation format** — Markdown with YAML frontmatter? Pure JSON? Both?

3. **Cron frequency** — Hourly checkpoint vs event-driven (on session end)?

4. **MEMORY.md size limit** — At what point do we switch to index-based retrieval?

5. **Evidence linking syntax** — How to reference chain entries from observations?

---

## Next Steps

1. Klowalski reviews this plan
2. Resolve open questions
3. Implement Phase 1 (file-based MVP)
4. Write the explanatory article based on this document

---

*Prepared by Claude, 2026-02-01*
*Branch: beta/auto-memory*
