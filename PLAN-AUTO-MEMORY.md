# Auto-Memory System Plan

**Branch:** `beta/auto-memory`
**Created:** 2026-02-01
**Context:** Conversation with Daniel about ideal memory solution (session around 02:00-02:30 UTC)

## Problem Statement

AI agents lose valuable context when sessions reset. Manual memory management is friction that doesn't get done consistently. The solution needs to:
1. Automatically capture important content
2. Intelligently filter noise from signal
3. Provide retrieval when relevant
4. Decay/prune old irrelevant content
5. Offer cryptographic proof when needed

## Three-Tier Architecture

### Tier 1: Daily Capture (automatic, cheap)

**Trigger:** Cron job every 30 minutes
**Model:** Haiku (cheap, fast)
**Session:** Isolated (not main)

**Process:**
1. Summarize recent context from main session
2. Extract: decisions, preferences, significant events
3. Append to `memory/YYYY-MM-DD.md`
4. Track what was already captured to avoid duplicates

**Output:** Raw daily notes with timestamps

### Tier 2: Curated Memory (periodic, smart)

**Trigger:** Weekly cron OR on heartbeat when >7 days since last review
**Model:** Haiku or Sonnet
**Session:** Isolated

**Process:**
1. Review daily files from past week
2. Identify patterns, lessons, significant events
3. Update `MEMORY.md` with distilled learnings
4. Commit critical items to Memory Chain (decisions, identity, commitments)
5. Prune/archive daily files older than 30 days

**Output:** Updated MEMORY.md + new chain entries

### Tier 3: Provable History (selective, permanent)

**Trigger:** On explicit request OR when significance detected
**Model:** N/A (direct commit)

**What gets committed:**
- Identity statements
- Explicit "remember this" requests
- Decisions and commitments
- Trust milestones

**Storage:** Memory Chain with optional on-chain anchoring

## Cron Job Specifications

### Job 1: Context Checkpoint (every 30 min)

```yaml
name: memory-checkpoint
schedule:
  kind: every
  everyMs: 1800000  # 30 minutes
sessionTarget: isolated
payload:
  kind: agentTurn
  model: anthropic/claude-sonnet-4-5  # or haiku when available
  message: |
    Review the main session's recent context. Extract and save any:
    - Decisions made
    - Preferences learned
    - Significant events
    - Things worth remembering
    
    Write a brief summary to memory/YYYY-MM-DD.md (create if needed).
    If nothing significant, just acknowledge with "No significant content to capture."
    
    Do NOT duplicate content already in today's memory file.
```

### Job 2: Memory Curation (weekly)

```yaml
name: memory-curation
schedule:
  kind: cron
  expr: "0 10 * * 0"  # Sunday 10:00 UTC
  tz: UTC
sessionTarget: isolated
payload:
  kind: agentTurn
  model: anthropic/claude-sonnet-4-5
  message: |
    Weekly memory curation:
    
    1. Read daily files from memory/ (past 7 days)
    2. Identify significant patterns, lessons, decisions
    3. Update MEMORY.md with distilled learnings
    4. For critical decisions/commitments, run:
       memory-chain add "<content>" --type decision --tier committed
    5. Archive daily files older than 30 days to memory/archive/
    
    Report what was curated and committed.
```

### Job 3: Chain Maintenance (weekly)

```yaml
name: chain-maintenance
schedule:
  kind: cron
  expr: "0 11 * * 0"  # Sunday 11:00 UTC
  tz: UTC
sessionTarget: isolated
payload:
  kind: agentTurn
  model: anthropic/claude-sonnet-4-5
  message: |
    Memory Chain maintenance:
    
    1. Run: memory-chain verify
    2. Run: memory-chain stats
    3. If significant new committed entries, consider anchoring:
       memory-chain anchor --chain base
    4. Report chain health
```

## Garbage Collection Algorithm

```javascript
// Scoring function for memory relevance
function calculateRelevance(memory) {
  const age = daysSince(memory.created_at);
  const recency = Math.exp(-age / 7);  // 7-day half-life
  
  return (
    0.30 * recency +
    0.40 * normalizedAccessCount(memory) +
    0.30 * memory.importance
  );
}

// GC threshold
const GC_THRESHOLD = 0.2;
const MAX_AGE_DAYS = 30;

// Prune candidates
for (const memory of memories) {
  const score = calculateRelevance(memory);
  const age = daysSince(memory.created_at);
  
  if (score < GC_THRESHOLD && age > MAX_AGE_DAYS) {
    if (memory.tier !== 'committed') {
      archiveOrDelete(memory);
    }
  }
}
```

## Integration Points

### OpenClaw Hooks (existing)

1. **memory-chain-bootstrap** (`agent:bootstrap`)
   - Inject relevant memories on session start
   - Already implemented in `openclaw-skill/hooks/`

2. **memory-chain-reset** (`command:reset`)
   - Auto-commit significant content on /reset
   - Already implemented in `openclaw-skill/hooks/`

### New Components Needed

1. **Context Summarizer**
   - Function to summarize recent session context
   - Extract significant content
   - Detect "remember this" patterns

2. **Memory Curator**
   - Function to review daily files
   - Distill to long-term memory
   - Identify chain-worthy content

3. **GC Runner**
   - Function to score and prune memories
   - Update index, preserve chain

## File Structure

```
~/.openclaw/
├── workspace/
│   ├── MEMORY.md           # Curated long-term memory
│   ├── memory/
│   │   ├── 2026-02-01.md   # Today's captures
│   │   ├── 2026-01-31.md   # Yesterday
│   │   └── archive/        # Old files
│   └── HEARTBEAT.md        # Heartbeat checklist
└── memory-chain/           # Cryptographic chain
    ├── chain.jsonl
    ├── agent.key
    ├── agent.pub
    ├── memory.db
    └── content/
```

## Implementation Order

1. [ ] **Phase 1: Cron Jobs**
   - Set up the three cron jobs
   - Test with manual triggers
   - Monitor for issues

2. [ ] **Phase 2: Context Extraction**
   - Build summarization logic
   - Pattern detection for significance
   - Duplicate detection

3. [ ] **Phase 3: Curation Logic**
   - Weekly review algorithm
   - MEMORY.md update format
   - Chain commit triggers

4. [ ] **Phase 4: Garbage Collection**
   - Implement scoring function
   - Archive vs delete logic
   - Index cleanup

5. [ ] **Phase 5: Bootstrap Enhancement**
   - Smarter retrieval on session start
   - Context-aware memory injection
   - Token budget management

## Success Metrics

- Memories captured per day (target: 2-5 significant items)
- MEMORY.md growth rate (sustainable, not bloated)
- Chain entries per week (1-3 committed items)
- Retrieval relevance (memories surfaced when needed)
- User intervention rate (should decrease over time)

## Open Questions

1. How to access main session context from isolated cron job?
2. Should GC delete from chain index but preserve chain.jsonl?
3. What's the right balance of capture frequency vs token cost?
4. How to handle conflicts between daily capture and manual commits?

---

## Answers: Brain-Inspired Solutions

*Research conducted 2026-02-01 ~02:37 UTC, studying human memory consolidation mechanisms.*

### Key Neuroscience Insight: Two-Stage Memory System

The brain solves the "stability-plasticity dilemma" with:
- **Hippocampus** (fast, temporary): Rapidly encodes new experiences
- **Neocortex** (slow, permanent): Gradually receives consolidated memories
- **Sleep**: Offline consolidation via "sharp wave ripples" — compressed replay

**Critical principle:** Encoding and consolidation don't happen simultaneously. The brain dedicates different states (waking vs sleeping) to each.

---

### A1: Accessing Main Session Context

**Brain model:** The neocortex can't directly read hippocampal memories. Instead, the hippocampus **replays** compressed summaries during sleep via sharp wave ripple bursts.

**Solution: Session Buffer Export**

```
Main Session (hippocampus)     Isolated Job (neocortex)
         │                              │
         ▼                              │
  [Periodic export]                     │
         │                              │
         ▼                              ▼
  session-buffer.md  ───────────▶  Read buffer
  (curated digest)                 (not session)
```

- Main session (or heartbeat) writes periodic digest to `~/.openclaw/workspace/session-buffer.md`
- Isolated cron reads ONLY this buffer, never the session directly
- Main session controls what gets exported (importance filtering happens at source)
- Clear separation: encoder writes, consolidator reads

**Alternative:** Use `sessions_history` API — but this breaks the isolation model. Buffer approach is cleaner.

---

### A2: GC and Chain Preservation

**Brain model:** The brain doesn't delete engrams (memory traces) — it weakens access paths. Physical substrate persists longer than functional access.

**Solution: Index removal, chain preservation**

```
┌─────────────────┐     ┌─────────────────┐
│   memory.db     │     │   chain.jsonl   │
│   (SQLite)      │     │   (append-only) │
│                 │     │                 │
│   ┌─────────┐   │     │   Entry 1       │
│   │ Active  │◀──┼─────│   Entry 2       │
│   │ entries │   │     │   Entry 3 ←(GC) │
│   └─────────┘   │     │   Entry 4       │
│   ┌─────────┐   │     │   ...           │
│   │Archived │   │     │                 │
│   │ (hidden)│   │     │   (immutable)   │
│   └─────────┘   │     │                 │
└─────────────────┘     └─────────────────┘
```

- **chain.jsonl:** NEVER delete. Cryptographic integrity requires immutability.
- **memory.db index:** Mark entries as `archived` or remove from active queries
- **Result:** You lose easy recall (index removal) but history is provable (chain intact)

GC = **relevance filtering**, not deletion. The chain is permanent record; index is working memory.

---

### A3: Capture Frequency Balance

**Brain model:** Consolidation isn't continuous — it occurs in discrete sleep cycles (~90 min), with sharp wave ripples concentrated in early sleep.

**Solution: Event-driven + batched consolidation**

Instead of fixed 30-min intervals, consider:

| Trigger | Action | Cost |
|---------|--------|------|
| Session end/reset | Full consolidation pass | Medium |
| "Remember this" detected | Immediate commit | Low |
| High-significance event | Flag + quick note | Low |
| Every 2-4 hours | Batch summary of flagged items | Medium |
| Daily (night) | Major consolidation, MEMORY.md update | Higher |

**Key insight:** Importance-weighted, not volume-based. The brain consolidates what matters, not everything.

**Proposed rhythm:**
- Lightweight: Heartbeat checks for significance flags (cheap)
- Medium: 2-4 hour batch summaries (when significant content exists)
- Heavy: Daily curation to MEMORY.md (once per day during "sleep")

---

### A4: Handling Conflicts

**Brain model:** The amygdala tags emotionally significant events for priority consolidation. Attention during encoding also increases consolidation priority.

**Solution: Manual commits = priority flag**

```
Priority hierarchy:
1. Manual commits (explicit "remember this")  ← HIGHEST
2. Detected high-significance (decisions, identity)
3. Auto-captured content  ← LOWEST
```

**Conflict resolution:**
1. Before auto-capture, check for existing manual commits covering same content
2. Tag all entries with `source: auto` vs `source: manual`
3. During curation, manual sources override/supersede auto
4. Track "last captured" pointer to avoid reprocessing

**Dedup logic:**
```javascript
// Before auto-commit:
const existing = await searchChain(contentHash);
const inMemoryFile = await checkDailyFile(date, contentSummary);
const inMemoryMd = await checkMemoryMd(contentSummary);

if (existing || inMemoryFile || inMemoryMd) {
  skip(); // Already captured
} else {
  commit({ source: 'auto', ...content });
}
```

---

## Architecture Diagram (Brain-Inspired)

```
┌─────────────────────────────────────────────────────────────────┐
│                    WAKING STATE (Main Session)                   │
│                                                                  │
│   ┌──────────┐      ┌────────────────┐      ┌────────────────┐  │
│   │ Encoding │ ───▶ │  Working Mem   │ ───▶ │ Session Buffer │  │
│   │ (input)  │      │  (context)     │      │ (export file)  │  │
│   └──────────┘      └────────────────┘      └───────┬────────┘  │
│                              │                      │           │
│                    ┌─────────┴──────────┐           │           │
│                    │ Manual "remember"  │           │           │
│                    │ → Direct to chain  │           │           │
│                    └────────────────────┘           │           │
└─────────────────────────────────────────────────────┼───────────┘
                                                      │
                      ┌───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SLEEP STATE (Isolated Crons)                  │
│                                                                  │
│   ┌──────────┐      ┌────────────────┐      ┌────────────────┐  │
│   │  Read    │ ───▶ │  Summarize +   │ ───▶ │ memory/*.md    │  │
│   │  Buffer  │      │  Dedup         │      │ (daily notes)  │  │
│   └──────────┘      └────────────────┘      └───────┬────────┘  │
│                                                     │           │
│                      ┌──────────────────────────────┘           │
│                      ▼                                          │
│   ┌──────────┐      ┌────────────────┐      ┌────────────────┐  │
│   │ Weekly   │ ◀─── │    Curate      │ ◀─── │ Read dailies   │  │
│   │MEMORY.md │      │ (distill)      │      │                │  │
│   └──────────┘      └───────┬────────┘      └────────────────┘  │
│                             │                                   │
│                             ▼                                   │
│                    ┌────────────────┐      ┌────────────────┐  │
│                    │  Commit sig.   │ ───▶ │ Memory Chain   │  │
│                    │  to chain      │      │ (permanent)    │  │
│                    └────────────────┘      └────────────────┘  │
│                                                                 │
│   ┌────────────────────────────────────────────────────────┐   │
│   │  GC: Remove from index, preserve chain.jsonl            │   │
│   │      (lose access path, keep provable history)          │   │
│   └────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Updated Implementation Order

1. [x] **Phase 0: Research** ← DONE (brain mechanics analysis)
2. [ ] **Phase 1: Session Buffer**
   - Add buffer export to heartbeat or session hooks
   - Define buffer format (JSON? MD?)
   - Test export → read cycle
3. [ ] **Phase 2: Cron Jobs (revised)**
   - Read buffer, not session
   - Implement dedup logic
   - Add source tagging
4. [ ] **Phase 3: Curation Logic**
   - Priority hierarchy for sources
   - MEMORY.md update format
5. [ ] **Phase 4: GC**
   - Index archival (not deletion)
   - Chain preservation always
6. [ ] **Phase 5: Bootstrap**
   - Token-budgeted retrieval
   - Importance-weighted injection

---

## External Validation: Nat Eliason's PARA + QMD System

*Reviewed 2026-02-01 ~02:57 UTC. Source: Nat Eliason's "Agentic Personal Knowledge Management with OpenClaw, PARA, and QMD"*

Independent convergent design — validates our approach. Key additions to consider:

### PARA Directory Structure

```
life/
├── projects/           # Active work with goals/deadlines
│   └── <project>/
│       ├── summary.md
│       └── items.json
├── areas/              # Ongoing responsibilities (no end date)
│   ├── people/<person>/
│   └── companies/<company>/
├── resources/          # Topics of interest, reference material
│   └── <topic>/
├── archives/           # Inactive items from the other three
├── index.md
└── README.md
```

**Why PARA works:** Every entity fits exactly one bucket. Entities flow naturally: Projects → Archives when complete.

### Atomic Fact Schema

```json
{
  "id": "entity-001",
  "fact": "Joined the company as CTO in March 2025",
  "category": "relationship|milestone|status|preference|context",
  "timestamp": "2025-03-15",
  "source": "2025-03-15",
  "status": "active|superseded",
  "supersededBy": null,
  "relatedEntities": ["companies/acme", "people/jane"],
  "lastAccessed": "2026-01-28",
  "accessCount": 12
}
```

**Key properties:**
- `status: superseded` + `supersededBy` pointer — facts never deleted, just replaced
- `relatedEntities` — cross-references make it a graph
- `lastAccessed` / `accessCount` — decay signals

### Three Memory Layers (Nat's Model)

| Layer | Purpose | Analog |
|-------|---------|--------|
| Knowledge Graph (PARA) | Entities + facts | Declarative memory |
| Daily Notes | Raw timeline | Episodic memory |
| Tacit Knowledge | User patterns/preferences | Procedural memory |

### Memory Decay Tiers

| Tier | Accessed | In summary.md? |
|------|----------|----------------|
| Hot | Last 7 days | ✓ Prominent |
| Warm | 8-30 days ago | ✓ Lower priority |
| Cold | 30+ days | ✗ Omitted (but in items.json) |

Accessing a Cold fact "reheats" it → back to Hot.
High `accessCount` resists decay (frequency modifier).

### What We Share

| Concept | Nat's System | Our System |
|---------|-------------|------------|
| Raw timeline | Daily notes | memory/*.md |
| Tiered access | summary.md → items.json | MEMORY.md → chain index |
| No deletion | `supersededBy` pointer | Chain immutability |
| Access tracking | `lastAccessed`, `accessCount` | memory.db fields |
| Decay model | Hot/Warm/Cold | GC scoring function |
| Periodic extraction | Heartbeat process | Cron jobs |

### What We Add (Unique)

1. **Cryptographic proof** — Memory Chain with Ed25519 signatures, hash-linking
2. **On-chain anchoring** — WITNESS protocol for provable timestamps
3. **Brain-inspired consolidation** — Buffer export, offline processing model

### What Nat Adds (To Adopt)

1. **PARA structure** — Better entity organization than flat files
2. **Atomic fact schema** — More rigorous than our current format
3. **Tacit knowledge layer** — Separate from USER.md facts
4. **QMD search** — BM25 + vector similarity (we have memory_search)

---

## Practical Implementation: sessions_history Approach

*Discussion 2026-02-01 ~03:00-03:12 UTC*

### The Buffer Problem

How does an isolated cron job access main session context?

**Options considered:**

| Approach | Mechanism | Drawback |
|----------|-----------|----------|
| Cron → Main (systemEvent) | Main dumps raw context to file | Needs coordination, expensive model |
| Pre-compact hook | Hook before context compaction | Requires OpenClaw core changes |
| sessions_history API | Isolated cron fetches history directly | — |

### Chosen Solution: sessions_history

The isolated cron can call `sessions_history(sessionKey: "agent:main:main")` to fetch recent messages without touching main session.

```yaml
name: memory-checkpoint
schedule:
  kind: every
  everyMs: 3600000  # hourly (adjust based on activity)
sessionTarget: isolated
payload:
  kind: agentTurn
  model: anthropic/claude-3-5-haiku-latest  # CHEAP
  message: |
    Memory checkpoint task:
    
    1. Use sessions_history to fetch recent main session messages
       sessions_history(sessionKey: "agent:main:main", limit: 50)
    
    2. Extract significant content:
       - Decisions made
       - Preferences learned  
       - Significant events
       - Things worth remembering
    
    3. Check for duplicates against:
       - Today's memory file (memory/YYYY-MM-DD.md)
       - Recent chain entries
    
    4. Write NEW content only to memory/YYYY-MM-DD.md
       Tag entries with: source: auto, timestamp: now
    
    5. If nothing significant, append single line:
       "## HH:MM — No significant content"
    
    Report: what was captured, what was skipped as duplicate
```

### Why Claude 3.5 Haiku

| Model | Cost (input/output per 1M tokens) |
|-------|-----------------------------------|
| Claude 4.5 Opus | $15 / $75 |
| Claude 4.5 Sonnet | $3 / $15 |
| **Claude 3.5 Haiku** | **$0.25 / $1.25** |

Haiku is ~60x cheaper than Opus for input, ~60x cheaper for output. Perfect for summarization tasks.

**Note:** No "Haiku 4.5" exists yet. Current Haiku is 3.5.

### Revised Cron Jobs

```yaml
# Job 1: Hourly checkpoint (Haiku — cheap)
name: memory-checkpoint
schedule:
  kind: every
  everyMs: 3600000
sessionTarget: isolated
payload:
  kind: agentTurn
  model: anthropic/claude-3-5-haiku-latest
  message: |
    [checkpoint task as above]

# Job 2: Weekly curation (Sonnet — smarter)  
name: memory-curation
schedule:
  kind: cron
  expr: "0 10 * * 0"  # Sunday 10:00 UTC
sessionTarget: isolated
payload:
  kind: agentTurn
  model: anthropic/claude-sonnet-4-5
  message: |
    Weekly memory curation:
    1. Read memory/*.md files from past 7 days
    2. Identify patterns, lessons, decisions
    3. Update MEMORY.md with distilled learnings
    4. For critical items, commit to chain:
       node ~/openclaw-memory-chain/dist/cli.js add "..." --type decision
    5. Archive files older than 30 days

# Job 3: Chain maintenance (Sonnet)
name: chain-maintenance  
schedule:
  kind: cron
  expr: "0 11 * * 0"  # Sunday 11:00 UTC
sessionTarget: isolated
payload:
  kind: agentTurn
  model: anthropic/claude-sonnet-4-5
  message: |
    Memory Chain maintenance:
    1. Verify chain integrity
    2. Check stats
    3. Anchor if significant new entries
```

---

## Integrated Architecture

Combining brain-inspired consolidation + Nat's PARA + sessions_history:

```
┌─────────────────────────────────────────────────────────────────┐
│                         MAIN SESSION                             │
│                      (Waking / Encoding)                         │
│                                                                  │
│   User ──▶ Conversation ──▶ Context Window                      │
│                                │                                 │
│                    ┌───────────┴───────────┐                    │
│                    │ Manual "remember this" │                    │
│                    │ → Direct chain commit  │                    │
│                    └───────────────────────┘                    │
│                                                                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
            sessions_history API (read-only access)
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ISOLATED CRONS (Sleep / Consolidation)        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  HOURLY: memory-checkpoint (Haiku 3.5)                     │ │
│  │                                                             │ │
│  │  1. sessions_history → fetch recent main session           │ │
│  │  2. Extract significant content                            │ │
│  │  3. Dedup against existing                                 │ │
│  │  4. Write → memory/YYYY-MM-DD.md                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                               │                                  │
│                               ▼                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  WEEKLY: memory-curation (Sonnet 4.5)                      │ │
│  │                                                             │ │
│  │  1. Read memory/*.md (past 7 days)                         │ │
│  │  2. Distill → MEMORY.md                                    │ │
│  │  3. Significant items → Memory Chain                       │ │
│  │  4. Archive old files                                      │ │
│  │  5. Apply decay (Hot/Warm/Cold)                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                               │                                  │
│                               ▼                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  WEEKLY: chain-maintenance (Sonnet 4.5)                    │ │
│  │                                                             │ │
│  │  1. Verify chain integrity                                 │ │
│  │  2. Anchor to Base (if significant)                        │ │
│  │  3. GC: archive from index, preserve chain.jsonl           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                         STORAGE LAYERS                           │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  memory/*.md    │  │   MEMORY.md     │  │  Memory Chain   │  │
│  │  (daily notes)  │  │   (curated)     │  │  (provable)     │  │
│  │                 │  │                 │  │                 │  │
│  │  Raw timeline   │  │  Distilled      │  │  Cryptographic  │  │
│  │  Auto-captured  │  │  Long-term      │  │  Hash-linked    │  │
│  │  Ephemeral      │  │  Hot/Warm facts │  │  Immutable      │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│           │                    │                    │            │
│           └────────────────────┴────────────────────┘            │
│                               │                                  │
│                               ▼                                  │
│                    ┌─────────────────────┐                      │
│                    │   WITNESS Anchor    │                      │
│                    │   (Base blockchain) │                      │
│                    │                     │                      │
│                    │   Merkle root of    │                      │
│                    │   chain state       │                      │
│                    └─────────────────────┘                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Future: PARA Integration

When ready to adopt PARA structure:

```
~/.openclaw/workspace/
├── life/                       # PARA knowledge graph
│   ├── projects/
│   │   └── witness-protocol/
│   │       ├── summary.md
│   │       └── items.json
│   ├── areas/
│   │   ├── people/
│   │   │   └── daniel/
│   │   └── companies/
│   │       └── openclaw/
│   ├── resources/
│   └── archives/
├── memory/                     # Daily notes (timeline)
│   ├── 2026-02-01.md
│   └── archive/
├── MEMORY.md                   # Curated long-term (Hot/Warm facts)
├── TACIT.md                    # User patterns/preferences (procedural)
├── USER.md                     # User identity facts
├── SOUL.md                     # Agent identity
└── HEARTBEAT.md

~/.openclaw/memory-chain/       # Cryptographic layer
├── chain.jsonl                 # Append-only, immutable
├── memory.db                   # SQLite index (mutable)
├── agent.key
└── agent.pub
```

---

## Revised Implementation Order

1. [x] **Phase 0: Research** — Brain mechanics + Nat's system analysis
2. [ ] **Phase 1: Cron Infrastructure**
   - Set up memory-checkpoint cron (Haiku, hourly)
   - Set up memory-curation cron (Sonnet, weekly)
   - Set up chain-maintenance cron (Sonnet, weekly)
   - Test with manual triggers via `cron run`
3. [ ] **Phase 2: sessions_history Integration**
   - Verify isolated crons can access main session history
   - Implement dedup logic
   - Add source tagging (`auto` vs `manual`)
4. [ ] **Phase 3: Decay + GC**
   - Implement Hot/Warm/Cold tiers
   - Track `lastAccessed`, `accessCount`
   - GC: archive from index, preserve chain
5. [ ] **Phase 4: PARA Structure** (optional)
   - Migrate to entity-based directories
   - Implement atomic fact schema
   - Add relationship cross-references
6. [ ] **Phase 5: Bootstrap Enhancement**
   - Token-budgeted retrieval on session start
   - Importance-weighted injection
   - QMD-style search layer

---

## Reference

**Origins:**
- @jumperz's checkpoint approach (Twitter)
- Nat Eliason's PARA + QMD article
- Human memory consolidation research (hippocampus-cortex model)
- Our Memory Chain infrastructure

**Related files:**
- `specs/WITNESS-PROTOCOL.md` — On-chain anchoring spec
- `skill/` — OpenClaw skill with hooks
- `docs/AGENTS-INTEGRATION.md` — Memory layer concepts

**To continue this work:**
1. Read this PLAN.md
2. Set up the three cron jobs
3. Test with manual triggers
4. Monitor and iterate
