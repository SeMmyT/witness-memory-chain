/**
 * Cron Job Types
 *
 * Types for the auto-memory system's cron jobs:
 * - memory-checkpoint: Hourly extraction from session history
 * - memory-curation: Weekly distillation to MEMORY.md
 * - chain-maintenance: Weekly verify + GC + anchor
 */

// ============================================================================
// Source and Decay Types
// ============================================================================

/** Source of a memory entry for priority handling */
export type MemorySource = 'auto' | 'manual' | 'curation';

/** Decay tier based on access patterns */
export type DecayTier = 'hot' | 'warm' | 'cold' | 'archived';

// ============================================================================
// Session History Types
// ============================================================================

/** A message from the session history API */
export interface SessionMessage {
  /** Message role */
  role: 'user' | 'assistant';
  /** Message content */
  content: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/** Options for fetching session history */
export interface SessionHistoryOptions {
  /** Session key (e.g., "agent:main:main") */
  sessionKey: string;
  /** Maximum messages to fetch */
  limit?: number;
  /** Only fetch messages after this timestamp (ISO 8601) */
  since?: string;
}

// ============================================================================
// Checkpoint Types
// ============================================================================

/** Significance classification for captured content */
export type SignificanceType = 'decision' | 'preference' | 'event' | 'explicit';

/** A captured memory item from checkpoint */
export interface CapturedItem {
  /** The content to capture */
  content: string;
  /** Why this was captured */
  significance: SignificanceType;
  /** Source of the capture */
  source: MemorySource;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Optional session ID for tracing */
  sessionId?: string;
}

/** Result of a checkpoint run */
export interface CheckpointResult {
  /** Number of items captured */
  capturedCount: number;
  /** Number of items skipped (not significant) */
  skippedCount: number;
  /** Number of duplicates found */
  duplicatesFound: number;
  /** Any errors encountered */
  errors: string[];
  /** The captured items */
  capturedItems: CapturedItem[];
  /** Daily file path written to */
  dailyFilePath?: string;
}

/** Configuration for checkpoint */
export interface CheckpointConfig {
  /** Workspace directory for memory files */
  workspaceDir: string;
  /** Chain directory for dedup checks */
  chainDir: string;
  /** Session key to fetch history from */
  sessionKey?: string;
  /** Maximum messages to process */
  maxMessages?: number;
}

// ============================================================================
// Deduplication Types
// ============================================================================

/** Result of a duplicate check */
export interface DuplicateCheckResult {
  /** Whether the content is a duplicate */
  isDuplicate: boolean;
  /** Where the duplicate was found */
  foundIn?: 'daily' | 'chain' | 'memory_md';
  /** The matching content (if found) */
  matchedContent?: string;
}

// ============================================================================
// Curation Types
// ============================================================================

/** A daily memory file */
export interface DailyFile {
  /** File path */
  path: string;
  /** Date of the file (YYYY-MM-DD) */
  date: string;
  /** File content */
  content: string;
  /** Parsed items from the file */
  items: CapturedItem[];
}

/** A curated item for MEMORY.md */
export interface CuratedItem {
  /** The distilled content */
  content: string;
  /** Category of the item */
  category: 'pattern' | 'lesson' | 'decision' | 'preference' | 'identity';
  /** Evidence chain entry references */
  evidence?: string[];
  /** When this pattern was first observed */
  firstObserved?: string;
  /** When this was last confirmed */
  lastConfirmed?: string;
}

/** Result of a curation run */
export interface CurationResult {
  /** Number of daily files processed */
  dailyFilesProcessed: number;
  /** Number of items distilled */
  itemsDistilled: number;
  /** Number of items committed to chain */
  chainCommits: number;
  /** Number of files archived */
  archivedFiles: number;
  /** Whether MEMORY.md was updated */
  memoryMdUpdated: boolean;
  /** Any errors encountered */
  errors: string[];
}

/** Configuration for curation */
export interface CurationConfig {
  /** Workspace directory for memory files */
  workspaceDir: string;
  /** Chain directory for commits */
  chainDir: string;
  /** Number of days to look back */
  lookbackDays?: number;
  /** Archive files older than this many days */
  archiveAfterDays?: number;
}

// ============================================================================
// Garbage Collection Types
// ============================================================================

/** Configuration for garbage collection */
export interface GCConfig {
  /** Relevance threshold for GC (0-1, default: 0.2) */
  gcThreshold?: number;
  /** Maximum age in days before eligible for GC (default: 30) */
  maxAgeDays?: number;
  /** Tiers protected from GC */
  protectedTiers?: string[];
  /** Dry run mode (don't actually archive) */
  dryRun?: boolean;
}

/** Result of a GC run */
export interface GCResult {
  /** Number of memories scored */
  memoriesScored: number;
  /** Number of memories archived */
  memoriesArchived: number;
  /** Number of memories retained */
  memoriesRetained: number;
  /** Any errors encountered */
  errors: string[];
}

// ============================================================================
// Decay Types
// ============================================================================

/** Decay tier thresholds */
export interface DecayThresholds {
  /** Days since last access to be considered hot (default: 7) */
  hotDays: number;
  /** Days since last access to be considered warm (default: 30) */
  warmDays: number;
  /** Access count threshold to resist decay */
  frequencyResistThreshold: number;
}

/** Default decay thresholds */
export const DEFAULT_DECAY_THRESHOLDS: DecayThresholds = {
  hotDays: 7,
  warmDays: 30,
  frequencyResistThreshold: 10,
};

/** Result of decay tier update */
export interface DecayUpdateResult {
  /** Memories moved to hot */
  movedToHot: number;
  /** Memories moved to warm */
  movedToWarm: number;
  /** Memories moved to cold */
  movedToCold: number;
  /** Memories that resisted decay due to frequency */
  frequencyResisted: number;
}

// ============================================================================
// Maintenance Types
// ============================================================================

/** Result of a maintenance run */
export interface MaintenanceResult {
  /** Chain verification passed */
  chainValid: boolean;
  /** Number of entries verified */
  entriesVerified: number;
  /** GC result */
  gcResult?: GCResult;
  /** Decay update result */
  decayResult?: DecayUpdateResult;
  /** Whether chain was anchored */
  anchored: boolean;
  /** Anchor transaction hash (if anchored) */
  anchorTxHash?: string;
  /** Any errors encountered */
  errors: string[];
}

/** Configuration for maintenance */
export interface MaintenanceConfig {
  /** Chain directory */
  chainDir: string;
  /** Run garbage collection */
  runGC?: boolean;
  /** GC configuration */
  gcConfig?: GCConfig;
  /** Update decay tiers */
  updateDecay?: boolean;
  /** Anchor if new committed entries */
  anchorIfNew?: boolean;
  /** Minimum new entries before anchoring */
  minEntriesForAnchor?: number;
}
