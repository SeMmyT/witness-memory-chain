/**
 * Garbage Collection
 *
 * Archives low-relevance memories from the index.
 * Inspired by brain memory where weak access paths fade
 * while the underlying engram persists.
 *
 * CRITICAL: GC only affects the index (memory.db).
 * The chain (chain.jsonl) is NEVER modified.
 */

import type Database from 'better-sqlite3';
import type { Memory } from '../types.js';
import type { GCConfig, GCResult } from './types.js';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_GC_CONFIG: Required<GCConfig> = {
  gcThreshold: 0.2,
  maxAgeDays: 30,
  protectedTiers: ['committed'],
  dryRun: false,
};

// ============================================================================
// Relevance Scoring
// ============================================================================

/**
 * Calculate days since a date
 */
function daysSince(dateStr: string): number {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  return (now - date) / (1000 * 60 * 60 * 24);
}

/**
 * Normalize a value to 0-1 range
 */
function normalize(value: number, max: number): number {
  if (max === 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/**
 * Get tier boost multiplier
 *
 * Committed tier items get a significant boost to resist decay,
 * since they represent permanent commitments and identity.
 */
function getTierBoost(tier: string): number {
  switch (tier) {
    case 'committed':
      return 1.5; // 50% boost - committed items resist decay aggressively
    case 'relationship':
      return 1.0; // No boost
    case 'ephemeral':
      return 0.8; // 20% penalty - ephemeral items decay faster
    default:
      return 1.0;
  }
}

/**
 * Calculate relevance score for a memory
 *
 * Scoring formula:
 * - 30% recency (exponential decay, 7-day half-life)
 * - 40% access frequency (normalized against max)
 * - 30% importance
 * - Tier boost: committed (1.5x), relationship (1.0x), ephemeral (0.8x)
 *
 * @returns Score from 0 to 1 (can exceed 1 with tier boost)
 */
export function calculateRelevance(
  memory: Memory,
  maxAccessCount: number
): number {
  // Recency: exponential decay with 7-day half-life
  const age = daysSince(memory.created_at);
  const recency = Math.exp(-age * (Math.LN2 / 7)); // Half-life of 7 days

  // Access frequency: normalized
  const accessScore = normalize(memory.access_count, maxAccessCount);

  // Importance: already 0-1
  const importance = memory.importance;

  // Base weighted combination
  const baseScore = (
    0.30 * recency +
    0.40 * accessScore +
    0.30 * importance
  );

  // Apply tier boost (committed items resist decay)
  const tierBoost = getTierBoost(memory.tier);

  return baseScore * tierBoost;
}

/**
 * Calculate relevance scores for all GC candidates
 */
export function scoreMemories(
  memories: Memory[],
  maxAccessCount: number
): Array<{ memory: Memory; score: number }> {
  return memories.map((memory) => ({
    memory,
    score: calculateRelevance(memory, maxAccessCount),
  }));
}

// ============================================================================
// GC Candidate Selection
// ============================================================================

/**
 * Get memories eligible for GC
 *
 * Returns memories that:
 * - Are not in protected tiers (e.g., 'committed')
 * - Are not already archived
 * - Meet age criteria
 */
function getGCCandidates(
  db: Database.Database,
  config: Required<GCConfig>
): Memory[] {
  const { maxAgeDays, protectedTiers } = config;

  // Build tier exclusion clause
  const tierExclusion = protectedTiers.length > 0
    ? `AND tier NOT IN (${protectedTiers.map(() => '?').join(',')})`
    : '';

  const stmt = db.prepare(`
    SELECT * FROM memories
    WHERE decay_tier != 'archived'
      ${tierExclusion}
      AND (
        created_at < datetime('now', '-' || ? || ' days')
        OR decay_tier = 'cold'
      )
    ORDER BY last_accessed ASC NULLS FIRST, created_at ASC
  `);

  const params = [...protectedTiers, maxAgeDays];
  return stmt.all(...params) as Memory[];
}

/**
 * Get max access count for normalization
 */
function getMaxAccessCount(db: Database.Database): number {
  const stmt = db.prepare('SELECT MAX(access_count) as max FROM memories');
  const row = stmt.get() as { max: number | null };
  return row.max || 1;
}

// ============================================================================
// GC Execution
// ============================================================================

/**
 * Archive a memory (mark as archived in index)
 *
 * This removes the memory from active queries but preserves
 * the chain entry. The memory can be restored by rebuilding
 * the index from the chain.
 */
function archiveMemory(db: Database.Database, seq: number): void {
  const stmt = db.prepare('UPDATE memories SET decay_tier = ? WHERE seq = ?');
  stmt.run('archived', seq);
}

/**
 * Run garbage collection on the index
 *
 * Archives memories with low relevance scores.
 *
 * IMPORTANT: This only affects the index (memory.db).
 * The chain (chain.jsonl) is NEVER modified.
 */
export function runGC(
  db: Database.Database,
  config: GCConfig = {}
): GCResult {
  const fullConfig: Required<GCConfig> = {
    ...DEFAULT_GC_CONFIG,
    ...config,
  };

  const result: GCResult = {
    memoriesScored: 0,
    memoriesArchived: 0,
    memoriesRetained: 0,
    errors: [],
  };

  try {
    // Get candidates and max access count
    const candidates = getGCCandidates(db, fullConfig);
    const maxAccessCount = getMaxAccessCount(db);

    result.memoriesScored = candidates.length;

    if (candidates.length === 0) {
      return result;
    }

    // Score candidates
    const scored = scoreMemories(candidates, maxAccessCount);

    // Archive low-scoring memories
    const gcTransaction = db.transaction(() => {
      for (const { memory, score } of scored) {
        if (score < fullConfig.gcThreshold) {
          if (!fullConfig.dryRun) {
            archiveMemory(db, memory.seq);
          }
          result.memoriesArchived++;
        } else {
          result.memoriesRetained++;
        }
      }
    });

    gcTransaction();
  } catch (error) {
    result.errors.push(`GC failed: ${error}`);
  }

  return result;
}

// ============================================================================
// GC Statistics
// ============================================================================

/**
 * Get GC statistics for reporting
 */
export function getGCStats(
  db: Database.Database,
  config: GCConfig = {}
): {
  totalMemories: number;
  archivedMemories: number;
  gcCandidates: number;
  belowThreshold: number;
  protectedCount: number;
} {
  const fullConfig: Required<GCConfig> = {
    ...DEFAULT_GC_CONFIG,
    ...config,
  };

  // Total memories
  const totalStmt = db.prepare('SELECT COUNT(*) as count FROM memories');
  const total = (totalStmt.get() as { count: number }).count;

  // Archived memories
  const archivedStmt = db.prepare(
    'SELECT COUNT(*) as count FROM memories WHERE decay_tier = ?'
  );
  const archived = (archivedStmt.get('archived') as { count: number }).count;

  // Get candidates
  const candidates = getGCCandidates(db, fullConfig);
  const maxAccessCount = getMaxAccessCount(db);

  // Count below threshold
  const scored = scoreMemories(candidates, maxAccessCount);
  const belowThreshold = scored.filter((s) => s.score < fullConfig.gcThreshold).length;

  // Protected count
  const protectedTiers = fullConfig.protectedTiers;
  let protectedCount = 0;
  if (protectedTiers.length > 0) {
    const protectedStmt = db.prepare(`
      SELECT COUNT(*) as count FROM memories
      WHERE tier IN (${protectedTiers.map(() => '?').join(',')})
    `);
    protectedCount = (protectedStmt.get(...protectedTiers) as { count: number }).count;
  }

  return {
    totalMemories: total,
    archivedMemories: archived,
    gcCandidates: candidates.length,
    belowThreshold,
    protectedCount,
  };
}

// ============================================================================
// Recovery
// ============================================================================

/**
 * Restore an archived memory
 *
 * Moves it back to 'cold' tier so it can be accessed again.
 */
export function restoreMemory(db: Database.Database, seq: number): boolean {
  const stmt = db.prepare(`
    UPDATE memories
    SET decay_tier = 'cold'
    WHERE seq = ? AND decay_tier = 'archived'
  `);
  const result = stmt.run(seq);
  return result.changes > 0;
}

/**
 * Restore all archived memories
 *
 * Useful after a bad GC run or for recovery.
 */
export function restoreAllArchived(db: Database.Database): number {
  const stmt = db.prepare(`
    UPDATE memories
    SET decay_tier = 'cold'
    WHERE decay_tier = 'archived'
  `);
  return stmt.run().changes;
}

/**
 * Preview what GC would do without actually archiving
 */
export function previewGC(
  db: Database.Database,
  config: GCConfig = {}
): Array<{ seq: number; content: string; score: number; willArchive: boolean }> {
  const fullConfig: Required<GCConfig> = {
    ...DEFAULT_GC_CONFIG,
    ...config,
    dryRun: true,
  };

  const candidates = getGCCandidates(db, fullConfig);
  const maxAccessCount = getMaxAccessCount(db);
  const scored = scoreMemories(candidates, maxAccessCount);

  return scored.map(({ memory, score }) => ({
    seq: memory.seq,
    content: memory.content.slice(0, 100) + (memory.content.length > 100 ? '...' : ''),
    score: Math.round(score * 1000) / 1000,
    willArchive: score < fullConfig.gcThreshold,
  }));
}
