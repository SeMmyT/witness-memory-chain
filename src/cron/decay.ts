/**
 * Decay Tier Management
 *
 * Manages Hot/Warm/Cold tiers based on access patterns.
 * Inspired by brain memory consolidation where frequently
 * accessed memories are more easily recalled.
 *
 * Tiers:
 * - Hot: Recently accessed (last 7 days), prominent in MEMORY.md
 * - Warm: Moderately old (8-30 days) or high access count
 * - Cold: Old and rarely accessed (30+ days)
 * - Archived: Removed from index (but chain preserved)
 */

import type Database from 'better-sqlite3';
import type {
  DecayTier,
  DecayThresholds,
  DecayUpdateResult,
} from './types.js';
import { DEFAULT_DECAY_THRESHOLDS } from './types.js';

// ============================================================================
// Decay Tier Calculation
// ============================================================================

/**
 * Calculate what decay tier a memory should be in
 *
 * @param lastAccessed - ISO timestamp of last access (or null if never)
 * @param accessCount - Number of times accessed
 * @param thresholds - Decay thresholds
 */
export function calculateDecayTier(
  lastAccessed: string | null,
  accessCount: number,
  thresholds: DecayThresholds = DEFAULT_DECAY_THRESHOLDS
): DecayTier {
  // Never accessed -> cold
  if (!lastAccessed) {
    return 'cold';
  }

  const now = Date.now();
  const lastAccessTime = new Date(lastAccessed).getTime();
  const daysSinceAccess = (now - lastAccessTime) / (1000 * 60 * 60 * 24);

  // Hot: accessed recently
  if (daysSinceAccess <= thresholds.hotDays) {
    return 'hot';
  }

  // Warm: moderately old OR high access count resists decay
  if (daysSinceAccess <= thresholds.warmDays ||
      accessCount >= thresholds.frequencyResistThreshold) {
    return 'warm';
  }

  // Cold: old and rarely accessed
  return 'cold';
}

// ============================================================================
// Batch Updates
// ============================================================================

/**
 * Update decay tiers for all memories based on access patterns
 *
 * This is the main function called during weekly maintenance.
 */
export function updateDecayTiers(
  db: Database.Database,
  thresholds: DecayThresholds = DEFAULT_DECAY_THRESHOLDS
): DecayUpdateResult {
  const result: DecayUpdateResult = {
    movedToHot: 0,
    movedToWarm: 0,
    movedToCold: 0,
    frequencyResisted: 0,
  };

  const { hotDays, warmDays, frequencyResistThreshold } = thresholds;

  // Transaction for atomic update
  const updateTiers = db.transaction(() => {
    // Memories accessed within hotDays -> hot
    const hotStmt = db.prepare(`
      UPDATE memories
      SET decay_tier = 'hot'
      WHERE last_accessed > datetime('now', '-' || ? || ' days')
        AND decay_tier != 'hot'
        AND decay_tier != 'archived'
    `);
    result.movedToHot = hotStmt.run(hotDays).changes;

    // Memories accessed between hotDays and warmDays -> warm
    const warmStmt = db.prepare(`
      UPDATE memories
      SET decay_tier = 'warm'
      WHERE last_accessed <= datetime('now', '-' || ? || ' days')
        AND last_accessed > datetime('now', '-' || ? || ' days')
        AND decay_tier != 'warm'
        AND decay_tier != 'archived'
    `);
    result.movedToWarm = warmStmt.run(hotDays, warmDays).changes;

    // Memories not accessed in warmDays (or never accessed) -> cold
    const coldStmt = db.prepare(`
      UPDATE memories
      SET decay_tier = 'cold'
      WHERE (last_accessed <= datetime('now', '-' || ? || ' days') OR last_accessed IS NULL)
        AND decay_tier != 'cold'
        AND decay_tier != 'archived'
    `);
    result.movedToCold = coldStmt.run(warmDays).changes;

    // High-frequency memories resist decay (cold -> warm)
    const resistStmt = db.prepare(`
      UPDATE memories
      SET decay_tier = 'warm'
      WHERE decay_tier = 'cold'
        AND access_count >= ?
    `);
    result.frequencyResisted = resistStmt.run(frequencyResistThreshold).changes;

    // Subtract resisted from cold count (they were counted as moved to cold)
    result.movedToCold -= result.frequencyResisted;
  });

  updateTiers();

  return result;
}

// ============================================================================
// Tier Queries
// ============================================================================

/**
 * Get count of memories by decay tier
 */
export function getDecayTierCounts(
  db: Database.Database
): Record<DecayTier, number> {
  const stmt = db.prepare(`
    SELECT decay_tier, COUNT(*) as count
    FROM memories
    GROUP BY decay_tier
  `);

  const rows = stmt.all() as Array<{ decay_tier: string; count: number }>;

  const counts: Record<DecayTier, number> = {
    hot: 0,
    warm: 0,
    cold: 0,
    archived: 0,
  };

  for (const row of rows) {
    if (row.decay_tier in counts) {
      counts[row.decay_tier as DecayTier] = row.count;
    }
  }

  return counts;
}

/**
 * Get memories that could be promoted (cold with recent access)
 */
export function getPromotionCandidates(
  db: Database.Database,
  limit = 100
): Array<{ seq: number; lastAccessed: string; accessCount: number }> {
  const stmt = db.prepare(`
    SELECT seq, last_accessed as lastAccessed, access_count as accessCount
    FROM memories
    WHERE decay_tier = 'cold'
      AND last_accessed > datetime('now', '-7 days')
    ORDER BY last_accessed DESC
    LIMIT ?
  `);

  return stmt.all(limit) as Array<{
    seq: number;
    lastAccessed: string;
    accessCount: number;
  }>;
}

/**
 * Manually set decay tier for a memory
 *
 * Used when a memory is accessed or explicitly marked.
 */
export function setDecayTier(
  db: Database.Database,
  seq: number,
  tier: DecayTier
): void {
  const stmt = db.prepare('UPDATE memories SET decay_tier = ? WHERE seq = ?');
  stmt.run(tier, seq);
}

/**
 * Promote a memory to hot tier (accessed now)
 *
 * Also updates last_accessed and access_count.
 */
export function promoteToHot(db: Database.Database, seq: number): void {
  const stmt = db.prepare(`
    UPDATE memories
    SET decay_tier = 'hot',
        last_accessed = datetime('now'),
        access_count = access_count + 1
    WHERE seq = ?
  `);
  stmt.run(seq);
}

// ============================================================================
// Decay Statistics
// ============================================================================

/**
 * Get decay statistics for reporting
 */
export function getDecayStats(
  db: Database.Database
): {
  tierCounts: Record<DecayTier, number>;
  avgAccessCount: Record<DecayTier, number>;
  oldestAccess: Record<DecayTier, string | null>;
} {
  const tierCounts = getDecayTierCounts(db);

  // Average access count per tier
  const avgStmt = db.prepare(`
    SELECT decay_tier, AVG(access_count) as avg_count
    FROM memories
    GROUP BY decay_tier
  `);
  const avgRows = avgStmt.all() as Array<{ decay_tier: string; avg_count: number }>;
  const avgAccessCount: Record<DecayTier, number> = { hot: 0, warm: 0, cold: 0, archived: 0 };
  for (const row of avgRows) {
    if (row.decay_tier in avgAccessCount) {
      avgAccessCount[row.decay_tier as DecayTier] = Math.round(row.avg_count * 10) / 10;
    }
  }

  // Oldest access per tier
  const oldestStmt = db.prepare(`
    SELECT decay_tier, MIN(last_accessed) as oldest
    FROM memories
    WHERE last_accessed IS NOT NULL
    GROUP BY decay_tier
  `);
  const oldestRows = oldestStmt.all() as Array<{ decay_tier: string; oldest: string | null }>;
  const oldestAccess: Record<DecayTier, string | null> = { hot: null, warm: null, cold: null, archived: null };
  for (const row of oldestRows) {
    if (row.decay_tier in oldestAccess) {
      oldestAccess[row.decay_tier as DecayTier] = row.oldest;
    }
  }

  return {
    tierCounts,
    avgAccessCount,
    oldestAccess,
  };
}
