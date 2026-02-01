/**
 * witness-memory-chain
 *
 * Cryptographic proof of experience for AI agents with efficient retrieval.
 *
 * Dual-layer architecture:
 * - Chain Layer: Append-only hash chain with Ed25519 signatures (integrity)
 * - Index Layer: SQLite + FTS5 for fast hybrid retrieval (retrieval)
 *
 * @example
 * ```typescript
 * import { initChain, addEntry, verifyChain } from '@openclaw/memory-chain';
 *
 * // Initialize a new chain
 * await initChain('~/.openclaw/memory-chain', 'MyAgent');
 *
 * // Add a memory
 * await addEntry('~/.openclaw/memory-chain', {
 *   type: 'memory',
 *   content: 'User prefers dark mode',
 * });
 *
 * // Verify integrity
 * const result = await verifyChain('~/.openclaw/memory-chain');
 * console.log(result.valid); // true
 * ```
 */

// Types
export type {
  EntryType,
  Tier,
  KeyMode,
  ChainEntry,
  ChainEntryInput,
  ChainConfig,
  VerificationResult,
  VerificationError,
  Memory,
  ScoredMemory,
  RetrievalOptions,
  ScoringWeights,
  FtsSearchResult,
  CompressionOptions,
  ExportOptions,
  ChainExport,
  EncryptionOptions,
  EncryptedKeyFile,
  MetricEventType,
  MetricEvent,
  MetricsCollector,
  ContentOptions,
  BaseAnchorConfig as BaseAnchorConfigType,
  AnchorProviderType as AnchorProviderTypeEnum,
} from './types.js';

export { DEFAULT_SCORING_WEIGHTS } from './types.js';

// Chain operations
export {
  initChain,
  addEntry,
  readChain,
  getLastEntry,
  verifyChain,
  getChainStats,
  loadConfig,
  loadPrivateKey,
  setPasswordProvider,
} from './chain/index.js';

export type { InitChainOptions, PasswordProvider, LoadPrivateKeyOptions } from './chain/index.js';

// Export/Import operations
export {
  exportChain,
  exportChainToFile,
  importChain,
  importChainFromFile,
  validateExport,
} from './chain/export.js';

export type { ImportResult } from './chain/export.js';

// Crypto utilities
export {
  sha256Hash,
  generateKeyPair,
  sign,
  verifySignature,
  keyToHex,
  hexToKey,
  encryptPrivateKey,
  decryptPrivateKey,
} from './chain/crypto.js';

// Index operations
export {
  initIndex,
  closeIndex,
  closeAllDatabases,
  getOpenDatabaseCount,
  insertMemory,
  getMemory,
  updateAccessCount,
  updateImportance,
  updateSummary,
  deleteMemory,
  rebuildFromChain,
  getLastRebuild,
  getMemoryCount,
  getMemoriesByType,
  getMemoriesByTier,
  getAllMemories,
} from './index/sqlite.js';

// Retrieval
export {
  retrieveMemories,
  retrieveContext,
  searchByKeyword,
  getRecentMemories,
  getMostAccessedMemories,
  getHighImportanceMemories,
  fillTokenBudget,
  estimateTokens,
  formatMemoriesForPrompt,
  buildSystemPrompt,
} from './index/retrieval.js';

// Content storage
export {
  storeContent,
  getContent,
  getContentVerified,
  contentExists,
  deleteContent,
  verifyContent,
  listContent,
  getStorageStats,
  createContentLoader,
  ContentIntegrityError,
} from './storage/content-store.js';

// Compression/Summarization
export {
  compressText,
  generateMemorySummary,
  extractEntities,
  findPronounReferents,
} from './compression.js';

// Metrics/Telemetry
export {
  InMemoryMetricsCollector,
  setMetricsCollector,
  getMetricsCollector,
  recordMetric,
  emitMetric,
  MetricTimer,
  startTimer,
  timeOperation,
  timeOperationSync,
  enableMetrics,
  disableMetrics,
  getMetricsSummary,
} from './metrics.js';

// OpenTimestamps Anchoring
export {
  submitAnchor,
  submitAnchorsForEntries,
  upgradePendingAnchors,
  verifyAnchor,
  getAnchorStatus,
  hasAnchor,
  getUnanchoredEntries,
} from './anchor/opentimestamps.js';

export type {
  AnchorStatus,
  AnchorRecord,
  PendingAnchorsFile,
  AnchorSubmitResult,
  AnchorVerifyResult,
  AnchorStatusResult,
  AnchorOptions,
  VerificationWithAnchorsResult,
} from './anchor/types.js';

// Base Blockchain Anchoring
export {
  anchorToBase,
  verifyAgainstBase,
  getBaseAnchorHistory,
  getWitnessBalance,
  getAnchorFee,
  BaseAnchorProvider,
} from './anchor/base.js';

export type {
  BaseAnchorConfig,
  BaseAnchorReceipt,
  OnChainAnchor,
  BaseVerificationResult,
} from './anchor/base.js';

// Provider Abstraction
export {
  registerProvider,
  getProvider,
  getAllProviders,
  hasProvider,
} from './anchor/provider.js';

export type {
  AnchorProviderType,
  AnchorProviderStatus,
  ProviderSubmitResult,
  ProviderVerifyResult,
  ProviderAnchorRecord,
  ProviderCostEstimate,
  ProviderSubmitOptions,
  ProviderVerifyOptions,
  AnchorProvider,
} from './anchor/provider.js';
