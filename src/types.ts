/**
 * Memory Chain Types
 *
 * Dual-layer architecture:
 * - Chain Layer: Cryptographic proof of integrity (append-only)
 * - Index Layer: Fast retrieval + ranking (mutable, rebuildable)
 */

// ============================================================================
// Chain Layer Types (Integrity)
// ============================================================================

/** Entry types in the memory chain */
export type EntryType = 'memory' | 'identity' | 'decision' | 'redaction';

/** Memory tiers determine persistence and redaction policy */
export type Tier = 'committed' | 'relationship' | 'ephemeral';

/** Source of a memory entry for priority handling */
export type MemorySource = 'auto' | 'manual' | 'curation';

/** Decay tier based on access patterns (for garbage collection) */
export type DecayTier = 'hot' | 'warm' | 'cold' | 'archived';

/** Key storage modes for different deployment contexts */
export type KeyMode = 'raw' | 'encrypted' | 'env';

/** A single entry in the hash chain */
export interface ChainEntry {
  /** Sequence number (monotonically increasing) */
  seq: number;
  /** ISO 8601 timestamp */
  ts: string;
  /** Entry type */
  type: EntryType;
  /** Memory tier */
  tier: Tier;
  /** SHA-256 hash of content (sha256:hex format) */
  content_hash: string;
  /** Hash of previous entry (sha256:hex format, null for genesis) */
  prev_hash: string | null;
  /** Ed25519 signature of entry data */
  signature: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/** Input for creating a new chain entry */
export interface ChainEntryInput {
  type: EntryType;
  tier?: Tier;
  content: string;
  metadata?: Record<string, unknown>;
}

/** Result of chain verification */
export interface VerificationResult {
  valid: boolean;
  /** Total entries checked */
  entriesChecked: number;
  /** Errors found during verification */
  errors: VerificationError[];
  /** Summary of chain state */
  summary: {
    firstEntry: number;
    lastEntry: number;
    totalEntries: number;
    redactedEntries: number;
  };
}

/** A verification error */
export interface VerificationError {
  seq: number;
  type: 'hash_mismatch' | 'signature_invalid' | 'sequence_gap' | 'timestamp_invalid' | 'content_mismatch';
  message: string;
}

/** Chain configuration */
export interface ChainConfig {
  /** Agent name/identifier */
  agentName: string;
  /** Key storage mode */
  keyMode: KeyMode;
  /** Creation timestamp */
  createdAt: string;
  /** Chain version */
  version: string;
}

// ============================================================================
// Index Layer Types (Retrieval)
// ============================================================================

/** A memory record in the index (optimized for retrieval) */
export interface Memory {
  /** Sequence number (foreign key to chain) */
  seq: number;
  /** Full content text */
  content: string;
  /** Compressed summary for context injection */
  summary: string | null;
  /** Entry type */
  type: EntryType;
  /** Memory tier */
  tier: Tier;
  /** Importance score (0-1) */
  importance: number;
  /** Number of times accessed */
  access_count: number;
  /** Last access timestamp (ISO 8601) */
  last_accessed: string | null;
  /** Creation timestamp (ISO 8601) */
  created_at: string;
  /** Decay tier for garbage collection (hot/warm/cold/archived) */
  decay_tier: DecayTier;
  /** Source of this memory (auto/manual/curation) */
  source?: MemorySource;
}

/** Options for memory retrieval */
export interface RetrievalOptions {
  /** Maximum tokens to return (for context budget) */
  maxTokens?: number;
  /** Maximum number of results */
  maxResults?: number;
  /** Offset for pagination (skip first N results) */
  offset?: number;
  /** Filter by entry types */
  types?: EntryType[];
  /** Filter by tiers */
  tiers?: Tier[];
  /** Minimum importance score */
  minImportance?: number;
}

/** Weights for hybrid scoring */
export interface ScoringWeights {
  /** Weight for FTS5 keyword match score */
  fts: number;
  /** Weight for recency (how recent the memory is) */
  recency: number;
  /** Weight for importance score */
  importance: number;
  /** Weight for access frequency */
  access: number;
}

/** Default scoring weights */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  fts: 0.4,
  recency: 0.3,
  importance: 0.2,
  access: 0.1,
};

/** Result from FTS5 search with rank */
export interface FtsSearchResult {
  seq: number;
  rank: number;
}

/** A scored memory result */
export interface ScoredMemory extends Memory {
  /** Combined score from hybrid ranking */
  score: number;
}

// ============================================================================
// Compression Types (Phase 3)
// ============================================================================

/** Options for content compression */
export interface CompressionOptions {
  /** Maximum length for summary */
  maxLength?: number;
  /** Preserve named entities */
  preserveEntities?: boolean;
  /** Resolve pronouns to names */
  resolveReferences?: boolean;
}

// ============================================================================
// Export Types
// ============================================================================

/** Options for exporting the chain */
export interface ExportOptions {
  /** Include content in export */
  includeContent?: boolean;
  /** Only export hashes (for verification) */
  hashesOnly?: boolean;
  /** Filter by sequence range */
  fromSeq?: number;
  toSeq?: number;
}

/** Exported chain data */
export interface ChainExport {
  config: ChainConfig;
  entries: ChainEntry[];
  content?: Record<string, string>;
  /** Public key (hex encoded) for signature verification */
  publicKey?: string;
  exportedAt: string;
}

// ============================================================================
// Encryption Types
// ============================================================================

/** Options for encrypted key storage */
export interface EncryptionOptions {
  /** Encryption algorithm (currently only 'aes-256-gcm' supported) */
  algorithm?: 'aes-256-gcm';
  /** Key derivation function (currently only 'scrypt' supported) */
  kdf?: 'scrypt';
  /** Scrypt cost parameter (default: 2^14) */
  scryptN?: number;
  /** Scrypt block size (default: 8) */
  scryptR?: number;
  /** Scrypt parallelization (default: 1) */
  scryptP?: number;
}

/** Encrypted key file format */
export interface EncryptedKeyFile {
  /** Version of the encryption format */
  version: 1;
  /** Encryption algorithm used */
  algorithm: 'aes-256-gcm';
  /** Key derivation function */
  kdf: 'scrypt';
  /** KDF parameters */
  kdfParams: {
    n: number;
    r: number;
    p: number;
    salt: string; // hex
  };
  /** Encrypted private key (hex) */
  ciphertext: string;
  /** GCM authentication tag (hex) */
  tag: string;
  /** Initialization vector (hex) */
  iv: string;
}

// ============================================================================
// Metrics Types
// ============================================================================

/** Metrics event types */
export type MetricEventType =
  | 'chain_init'
  | 'entry_add'
  | 'chain_verify'
  | 'content_store'
  | 'content_read'
  | 'index_rebuild'
  | 'retrieval_query'
  | 'retrieval_context';

/** A single metrics event */
export interface MetricEvent {
  /** Event type */
  type: MetricEventType;
  /** Timestamp (ISO 8601) */
  timestamp: string;
  /** Duration in milliseconds (for timed operations) */
  durationMs?: number;
  /** Additional event-specific data */
  data?: Record<string, unknown>;
}

/** Metrics collector interface */
export interface MetricsCollector {
  /** Record a metric event */
  record(event: MetricEvent): void;
  /** Get all recorded events */
  getEvents(): MetricEvent[];
  /** Clear all events */
  clear(): void;
}

/** Options for content retrieval */
export interface ContentOptions {
  /** Verify content hash matches stored hash */
  verify?: boolean;
}

// ============================================================================
// Base Anchor Types
// ============================================================================

/** Configuration for Base blockchain anchoring */
export interface BaseAnchorConfig {
  /** WitnessRegistry contract address */
  registryAddress: `0x${string}`;
  /** WITNESS token address */
  witnessTokenAddress: `0x${string}`;
  /** RPC URL for Base */
  rpcUrl: string;
  /** Use testnet (Base Sepolia) instead of mainnet */
  testnet?: boolean;
}

/** Anchor provider type */
export type AnchorProviderType = 'opentimestamps' | 'base';
