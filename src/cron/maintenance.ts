/**
 * Chain Maintenance
 *
 * Weekly maintenance orchestrator that:
 * 1. Verifies chain integrity
 * 2. Updates decay tiers
 * 3. Runs garbage collection
 * 4. Anchors to blockchain if appropriate
 */

import * as path from 'path';
import type { MaintenanceResult, MaintenanceConfig, GCConfig } from './types.js';
import { updateDecayTiers, getDecayStats } from './decay.js';
import { runGC, getGCStats } from './gc.js';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_MAINTENANCE_CONFIG: Required<Omit<MaintenanceConfig, 'chainDir'>> = {
  runGC: true,
  gcConfig: {
    gcThreshold: 0.2,
    maxAgeDays: 30,
    protectedTiers: ['committed'],
    dryRun: false,
  },
  updateDecay: true,
  anchorIfNew: true,
  minEntriesForAnchor: 3,
};

// ============================================================================
// Chain Verification
// ============================================================================

/**
 * Verify chain integrity
 */
async function verifyChain(chainDir: string): Promise<{
  valid: boolean;
  entriesChecked: number;
  errors: string[];
}> {
  const { verifyChain } = await import('../chain/index.js');

  try {
    const result = await verifyChain(chainDir);

    return {
      valid: result.valid,
      entriesChecked: result.entriesChecked,
      errors: result.errors.map((e) => `[${e.seq}] ${e.type}: ${e.message}`),
    };
  } catch (error) {
    return {
      valid: false,
      entriesChecked: 0,
      errors: [`Verification failed: ${error}`],
    };
  }
}

// ============================================================================
// Anchoring
// ============================================================================

/**
 * Check if anchoring is appropriate
 */
async function shouldAnchor(
  chainDir: string,
  minEntries: number
): Promise<{ shouldAnchor: boolean; newEntries: number; reason: string }> {
  const { readChain } = await import('../chain/index.js');

  try {
    const entries = await readChain(chainDir);

    // Count committed entries
    const committedEntries = entries.filter((e) => e.tier === 'committed');

    // Find last anchored entry (from metadata)
    let lastAnchoredSeq = 0;
    for (const entry of entries) {
      if (entry.metadata?.anchored) {
        lastAnchoredSeq = entry.seq;
      }
    }

    // Count new committed entries since last anchor
    const newCommitted = committedEntries.filter((e) => e.seq > lastAnchoredSeq);

    if (newCommitted.length >= minEntries) {
      return {
        shouldAnchor: true,
        newEntries: newCommitted.length,
        reason: `${newCommitted.length} new committed entries since last anchor`,
      };
    }

    return {
      shouldAnchor: false,
      newEntries: newCommitted.length,
      reason: `Only ${newCommitted.length} new committed entries (need ${minEntries})`,
    };
  } catch (error) {
    return {
      shouldAnchor: false,
      newEntries: 0,
      reason: `Error checking: ${error}`,
    };
  }
}

/**
 * Anchor chain to blockchain
 *
 * Note: Anchoring requires additional configuration (wallet key, etc.)
 * that must be provided via environment or configuration.
 */
async function anchorChain(chainDir: string): Promise<{
  success: boolean;
  txHash?: string;
  error?: string;
}> {
  // Try OpenTimestamps first (simpler, no wallet required)
  try {
    const { readChain } = await import('../chain/index.js');
    const { submitAnchor } = await import('../anchor/opentimestamps.js');

    // Get the last entry to anchor
    const entries = await readChain(chainDir);
    if (entries.length === 0) {
      return { success: false, error: 'No entries to anchor' };
    }

    const lastEntry = entries[entries.length - 1];
    await submitAnchor(chainDir, lastEntry);

    return {
      success: true,
      txHash: 'opentimestamps-pending',
    };
  } catch (otsError) {
    // OpenTimestamps failed, try Base if configured
    const walletKey = process.env.WITNESS_WALLET_PRIVATE_KEY;
    const rpcUrl = process.env.BASE_RPC_URL;

    if (!walletKey || !rpcUrl) {
      return {
        success: false,
        error: `OTS failed: ${otsError}. Base not configured (missing WITNESS_WALLET_PRIVATE_KEY or BASE_RPC_URL)`,
      };
    }

    try {
      const { anchorToBase } = await import('../anchor/base.js');

      const config = {
        registryAddress: (process.env.WITNESS_REGISTRY_ADDRESS || '0x') as `0x${string}`,
        witnessTokenAddress: (process.env.WITNESS_TOKEN_ADDRESS || '0x') as `0x${string}`,
        rpcUrl,
        testnet: process.env.BASE_TESTNET === 'true',
      };

      const result = await anchorToBase(chainDir, config, walletKey as `0x${string}`);

      return {
        success: true,
        txHash: result.txHash,
      };
    } catch (baseError) {
      return {
        success: false,
        error: `Anchoring failed: OTS: ${otsError}, Base: ${baseError}`,
      };
    }
  }
}

// ============================================================================
// Main Maintenance Function
// ============================================================================

/**
 * Run weekly maintenance
 */
export async function runMaintenance(
  config: MaintenanceConfig
): Promise<MaintenanceResult> {
  const fullConfig = {
    ...DEFAULT_MAINTENANCE_CONFIG,
    ...config,
  };

  const result: MaintenanceResult = {
    chainValid: false,
    entriesVerified: 0,
    anchored: false,
    errors: [],
  };

  // Step 1: Verify chain integrity
  const verification = await verifyChain(fullConfig.chainDir);
  result.chainValid = verification.valid;
  result.entriesVerified = verification.entriesChecked;

  if (verification.errors.length > 0) {
    result.errors.push(...verification.errors);
  }

  // If chain is invalid, stop here
  if (!verification.valid) {
    result.errors.push('Chain verification failed. Maintenance aborted.');
    return result;
  }

  // Step 2: Update decay tiers
  if (fullConfig.updateDecay) {
    try {
      const { initIndex, closeIndex } = await import('../index/sqlite.js');
      const dbPath = path.join(fullConfig.chainDir, 'memory.db');
      const db = initIndex(dbPath);

      try {
        const decayResult = updateDecayTiers(db);
        result.decayResult = decayResult;
      } finally {
        closeIndex(db);
      }
    } catch (error) {
      result.errors.push(`Decay update failed: ${error}`);
    }
  }

  // Step 3: Run garbage collection
  if (fullConfig.runGC) {
    try {
      const { initIndex, closeIndex } = await import('../index/sqlite.js');
      const dbPath = path.join(fullConfig.chainDir, 'memory.db');
      const db = initIndex(dbPath);

      try {
        const gcResult = runGC(db, fullConfig.gcConfig);
        result.gcResult = gcResult;

        if (gcResult.errors.length > 0) {
          result.errors.push(...gcResult.errors);
        }
      } finally {
        closeIndex(db);
      }
    } catch (error) {
      result.errors.push(`GC failed: ${error}`);
    }
  }

  // Step 4: Anchor if appropriate
  if (fullConfig.anchorIfNew) {
    const anchorCheck = await shouldAnchor(
      fullConfig.chainDir,
      fullConfig.minEntriesForAnchor
    );

    if (anchorCheck.shouldAnchor) {
      const anchorResult = await anchorChain(fullConfig.chainDir);

      result.anchored = anchorResult.success;
      result.anchorTxHash = anchorResult.txHash;

      if (anchorResult.error) {
        result.errors.push(anchorResult.error);
      }
    }
  }

  return result;
}

// ============================================================================
// Maintenance Statistics
// ============================================================================

/**
 * Get maintenance statistics for reporting
 */
export async function getMaintenanceStats(
  chainDir: string
): Promise<{
  chainStats: {
    totalEntries: number;
    byType: Record<string, number>;
    byTier: Record<string, number>;
    lastAnchor?: string;
  };
  indexStats: {
    totalMemories: number;
    decayTiers: Record<string, number>;
    archived: number;
  };
}> {
  const { readChain } = await import('../chain/index.js');
  const { initIndex, closeIndex } = await import('../index/sqlite.js');

  // Chain stats
  const entries = await readChain(chainDir);

  const byType: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  let lastAnchor: string | undefined;

  for (const entry of entries) {
    byType[entry.type] = (byType[entry.type] || 0) + 1;
    byTier[entry.tier] = (byTier[entry.tier] || 0) + 1;

    if (entry.metadata?.anchored) {
      lastAnchor = entry.ts;
    }
  }

  // Index stats
  const dbPath = path.join(chainDir, 'memory.db');
  const db = initIndex(dbPath);

  let indexStats = {
    totalMemories: 0,
    decayTiers: {} as Record<string, number>,
    archived: 0,
  };

  try {
    const decayStats = getDecayStats(db);
    indexStats = {
      totalMemories: Object.values(decayStats.tierCounts).reduce((a, b) => a + b, 0),
      decayTiers: decayStats.tierCounts,
      archived: decayStats.tierCounts.archived || 0,
    };
  } finally {
    closeIndex(db);
  }

  return {
    chainStats: {
      totalEntries: entries.length,
      byType,
      byTier,
      lastAnchor,
    },
    indexStats,
  };
}

/**
 * Format maintenance result for reporting
 */
export function formatMaintenanceReport(result: MaintenanceResult): string {
  const lines: string[] = [
    '## Chain Maintenance Report',
    '',
    `**Chain Status:** ${result.chainValid ? 'Valid' : 'INVALID'}`,
    `**Entries Verified:** ${result.entriesVerified}`,
    '',
  ];

  if (result.decayResult) {
    lines.push('### Decay Tier Updates');
    lines.push(`- Moved to Hot: ${result.decayResult.movedToHot}`);
    lines.push(`- Moved to Warm: ${result.decayResult.movedToWarm}`);
    lines.push(`- Moved to Cold: ${result.decayResult.movedToCold}`);
    lines.push(`- Resisted decay (frequency): ${result.decayResult.frequencyResisted}`);
    lines.push('');
  }

  if (result.gcResult) {
    lines.push('### Garbage Collection');
    lines.push(`- Memories scored: ${result.gcResult.memoriesScored}`);
    lines.push(`- Memories archived: ${result.gcResult.memoriesArchived}`);
    lines.push(`- Memories retained: ${result.gcResult.memoriesRetained}`);
    lines.push('');
  }

  lines.push('### Anchoring');
  if (result.anchored) {
    lines.push(`- Status: Anchored`);
    if (result.anchorTxHash) {
      lines.push(`- Transaction: ${result.anchorTxHash}`);
    }
  } else {
    lines.push('- Status: Not anchored (not enough new entries or not configured)');
  }
  lines.push('');

  if (result.errors.length > 0) {
    lines.push('### Errors');
    for (const error of result.errors) {
      lines.push(`- ${error}`);
    }
  }

  return lines.join('\n');
}
