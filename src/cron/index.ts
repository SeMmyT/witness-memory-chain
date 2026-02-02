/**
 * Auto-Memory System Cron Module
 *
 * Exports all cron-related functionality:
 * - Checkpoint: Hourly extraction from session history
 * - Curation: Weekly distillation to MEMORY.md
 * - Maintenance: Weekly verify + GC + anchor
 * - Session History: Access main session from isolated crons
 * - Deduplication: Prevent duplicate captures
 * - Decay: Hot/Warm/Cold tier management
 * - GC: Garbage collection (archive low-relevance memories)
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Source and decay
  MemorySource,
  DecayTier,
  // Session history
  SessionMessage,
  SessionHistoryOptions,
  // Checkpoint
  SignificanceType,
  CapturedItem,
  CheckpointResult,
  CheckpointConfig,
  // Deduplication
  DuplicateCheckResult,
  // Curation
  DailyFile,
  CuratedItem,
  CurationResult,
  CurationConfig,
  // GC
  GCConfig,
  GCResult,
  // Decay
  DecayThresholds,
  DecayUpdateResult,
  // Maintenance
  MaintenanceResult,
  MaintenanceConfig,
} from './types.js';

export { DEFAULT_DECAY_THRESHOLDS } from './types.js';

// ============================================================================
// Checkpoint
// ============================================================================

export {
  classifySignificance,
  isWorthCapturing,
  extractSignificantContent,
  writeToDailyFile,
  runCheckpoint,
  parseDailyFile,
} from './checkpoint.js';

// ============================================================================
// Session History
// ============================================================================

export {
  fetchSessionHistory,
  exportToSessionBuffer,
  getMainSessionKey,
  getLastCheckpointTime,
  updateLastCheckpointTime,
  fetchRecentHistory,
} from './session-history.js';

// ============================================================================
// Deduplication
// ============================================================================

export {
  normalizeContent,
  hashContent,
  getDailyFilePath,
  existsInDailyFile,
  existsInMemoryMd,
  existsInChain,
  checkDuplicate,
  calculateSimilarity,
  isTooSimilar,
} from './dedup.js';

// ============================================================================
// Curation
// ============================================================================

export {
  listDailyFiles,
  readDailyFiles,
  distillItems,
  updateMemoryMd,
  archiveOldFiles,
  commitCriticalItems,
  runCuration,
} from './curation.js';

// ============================================================================
// Decay
// ============================================================================

export {
  calculateDecayTier,
  updateDecayTiers,
  getDecayTierCounts,
  getPromotionCandidates,
  setDecayTier,
  promoteToHot,
  getDecayStats,
} from './decay.js';

// ============================================================================
// Garbage Collection
// ============================================================================

export {
  calculateRelevance,
  scoreMemories,
  runGC,
  getGCStats,
  restoreMemory,
  restoreAllArchived,
  previewGC,
} from './gc.js';

// ============================================================================
// Maintenance
// ============================================================================

export {
  runMaintenance,
  getMaintenanceStats,
  formatMaintenanceReport,
} from './maintenance.js';
