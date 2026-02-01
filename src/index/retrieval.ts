/**
 * Hybrid Retrieval System
 *
 * Combines FTS5 keyword search with recency, importance, and access frequency
 * to provide ranked memory retrieval within a token budget.
 *
 * Based on SimpleMem research: "semantic lossless compression" achieves
 * 43% F1 with 30x fewer tokens than full context.
 */

import type Database from 'better-sqlite3';
import type {
  Memory,
  ScoredMemory,
  RetrievalOptions,
  ScoringWeights,
  FtsSearchResult,
  EntryType,
  Tier,
  DecayTier,
} from '../types.js';
import { DEFAULT_SCORING_WEIGHTS } from '../types.js';
import { updateAccessCount } from './sqlite.js';

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Check if text appears to be code
 */
function looksLikeCode(text: string): boolean {
  // Common code patterns
  const codePatterns = [
    /^(import|export|const|let|var|function|class|interface|type)\s/m,
    /[{}\[\]();]=>/,
    /^\s*(if|for|while|switch|try|catch)\s*\(/m,
    /\.(js|ts|py|go|rs|java|cpp|c|h|rb|php)$/,
    /^```[\s\S]*```$/m,
  ];
  return codePatterns.some((p) => p.test(text));
}

/**
 * Count non-ASCII characters (CJK, emoji, etc.)
 */
function countNonAscii(text: string): number {
  let count = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 127) {
      count++;
    }
  }
  return count;
}

/**
 * Estimate token count for text
 *
 * Uses a calibrated heuristic based on the characteristics of modern tokenizers:
 * - English text: ~4 characters per token
 * - Code: ~3 characters per token (more special characters = more tokens)
 * - CJK/Unicode: ~1.5 characters per token (often tokenized per character)
 * - Whitespace and punctuation add tokens
 *
 * This is calibrated against Claude's tokenizer for typical use cases.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }

  const nonAsciiCount = countNonAscii(text);
  const asciiCount = text.length - nonAsciiCount;

  // Base estimate
  let tokens: number;

  if (looksLikeCode(text)) {
    // Code has more special characters, which often become individual tokens
    // Estimate: ~3 chars per token for ASCII, ~1.5 for non-ASCII
    tokens = asciiCount / 3 + nonAsciiCount / 1.5;
  } else if (nonAsciiCount > text.length * 0.3) {
    // Significant non-ASCII content (likely CJK or emoji-heavy)
    // CJK characters are often 1 token each
    tokens = asciiCount / 4 + nonAsciiCount / 1.5;
  } else {
    // Mostly English text
    // Estimate: ~4 chars per token for ASCII, ~1.5 for non-ASCII
    tokens = asciiCount / 4 + nonAsciiCount / 1.5;
  }

  // Count extra tokens from whitespace splits (words generally = tokens)
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  // Adjust: if word count suggests more tokens, use that as a floor
  tokens = Math.max(tokens, wordCount * 0.8);

  // Add tokens for punctuation that typically gets its own token
  const punctuationCount = (text.match(/[.,!?;:'"()\[\]{}]/g) || []).length;
  tokens += punctuationCount * 0.3;

  // Round up and ensure at least 1 token for non-empty text
  return Math.max(1, Math.ceil(tokens));
}

// ============================================================================
// FTS5 Search
// ============================================================================

/**
 * Search memories using FTS5 keyword matching
 *
 * @param db - Database instance
 * @param query - Search query (supports FTS5 syntax)
 * @param limit - Maximum results
 * @returns Search results with BM25 rank scores
 */
/**
 * Sanitize a search term by removing potentially problematic characters
 * Handles Unicode control characters, zero-width characters, and other special chars
 */
function sanitizeSearchTerm(term: string): string {
  return term
    // Remove zero-width characters
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '')
    // Remove other Unicode control characters
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    // Remove combining diacritical marks that could be used for homoglyph attacks
    .replace(/[\u0300-\u036F]/g, '')
    // Keep only word characters (including Unicode letters and numbers) and basic punctuation
    .replace(/[^\p{L}\p{N}\p{M}'-]/gu, '')
    .trim();
}

export function searchByKeyword(
  db: Database.Database,
  query: string,
  limit = 50
): FtsSearchResult[] {
  // Escape special FTS5 characters and prepare query
  // First sanitize input to handle Unicode edge cases
  const terms = query
    .trim()
    .split(/\s+/)
    .map(sanitizeSearchTerm)
    .filter((term) => term.length > 0);

  if (terms.length === 0) {
    return [];
  }

  // Wrap each term in quotes for exact matching, with prefix matching
  const safeQuery = terms.map((term) => `"${term}"*`).join(' OR ');

  try {
    const stmt = db.prepare(`
      SELECT rowid as seq, rank
      FROM memories_fts
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    return stmt.all(safeQuery, limit) as FtsSearchResult[];
  } catch {
    // If FTS query fails, return empty results
    return [];
  }
}

/**
 * Get recent memories (within N days)
 */
export function getRecentMemories(
  db: Database.Database,
  days = 7,
  limit = 20
): Memory[] {
  const stmt = db.prepare(`
    SELECT * FROM memories
    WHERE created_at > datetime('now', '-' || ? || ' days')
    ORDER BY created_at DESC
    LIMIT ?
  `);

  return stmt.all(days, limit) as Memory[];
}

/**
 * Get most accessed memories
 */
export function getMostAccessedMemories(
  db: Database.Database,
  limit = 20
): Memory[] {
  const stmt = db.prepare(`
    SELECT * FROM memories
    WHERE access_count > 0
    ORDER BY access_count DESC
    LIMIT ?
  `);

  return stmt.all(limit) as Memory[];
}

/**
 * Get highest importance memories
 */
export function getHighImportanceMemories(
  db: Database.Database,
  minImportance = 0.7,
  limit = 20
): Memory[] {
  const stmt = db.prepare(`
    SELECT * FROM memories
    WHERE importance >= ?
    ORDER BY importance DESC
    LIMIT ?
  `);

  return stmt.all(minImportance, limit) as Memory[];
}

// ============================================================================
// Hybrid Scoring
// ============================================================================

/**
 * Calculate recency score (0-1)
 * Decays over time with a 7-day half-life
 */
function calculateRecencyScore(createdAt: string): number {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const ageMs = now - created;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Exponential decay with 7-day half-life
  const halfLife = 7;
  return Math.exp(-ageDays * (Math.LN2 / halfLife));
}

/**
 * Normalize FTS5 rank to 0-1 score
 * FTS5 BM25 ranks are negative (more negative = better match)
 */
function normalizeFtsRank(rank: number, minRank: number, maxRank: number): number {
  if (minRank === maxRank) return 1;
  // Convert to 0-1 where 1 is best match
  return (maxRank - rank) / (maxRank - minRank);
}

/**
 * Normalize access count to 0-1 score
 */
function normalizeAccessCount(count: number, maxCount: number): number {
  if (maxCount === 0) return 0;
  return count / maxCount;
}

/**
 * Get decay weight for a decay tier
 *
 * Hot memories get full weight, warm get reduced weight,
 * cold get further reduced, and archived get zero.
 */
function getDecayWeight(tier: DecayTier | undefined): number {
  switch (tier) {
    case 'hot':
      return 1.0;
    case 'warm':
      return 0.7;
    case 'cold':
      return 0.4;
    case 'archived':
      return 0; // Archived should not appear in results
    default:
      return 1.0; // Default to hot if tier not set
  }
}

/**
 * Merge and score results from multiple sources
 */
function mergeAndScore(
  db: Database.Database,
  ftsResults: FtsSearchResult[],
  recentMemories: Memory[],
  weights: ScoringWeights
): ScoredMemory[] {
  // Get all unique seq numbers
  const seqSet = new Set<number>();
  for (const r of ftsResults) seqSet.add(r.seq);
  for (const m of recentMemories) seqSet.add(m.seq);

  // Load all memories
  const memoryMap = new Map<number, Memory>();
  const stmt = db.prepare('SELECT * FROM memories WHERE seq = ?');

  for (const seq of seqSet) {
    const memory = stmt.get(seq) as Memory | undefined;
    if (memory) {
      memoryMap.set(seq, memory);
    }
  }

  // Calculate FTS score normalization bounds
  let minRank = 0;
  let maxRank = 0;
  if (ftsResults.length > 0) {
    minRank = Math.min(...ftsResults.map((r) => r.rank));
    maxRank = Math.max(...ftsResults.map((r) => r.rank));
  }

  // Find max access count for normalization
  const maxAccess = Math.max(...Array.from(memoryMap.values()).map((m) => m.access_count), 1);

  // Build FTS score map
  const ftsScoreMap = new Map<number, number>();
  for (const result of ftsResults) {
    ftsScoreMap.set(result.seq, normalizeFtsRank(result.rank, minRank, maxRank));
  }

  // Score each memory
  const scoredMemories: ScoredMemory[] = [];

  for (const [seq, memory] of memoryMap) {
    const ftsScore = ftsScoreMap.get(seq) ?? 0;
    const recencyScore = calculateRecencyScore(memory.created_at);
    const importanceScore = memory.importance;
    const accessScore = normalizeAccessCount(memory.access_count, maxAccess);

    const baseScore =
      weights.fts * ftsScore +
      weights.recency * recencyScore +
      weights.importance * importanceScore +
      weights.access * accessScore;

    // Apply decay weight based on memory tier
    const decayWeight = getDecayWeight(memory.decay_tier);
    const combinedScore = baseScore * decayWeight;

    scoredMemories.push({
      ...memory,
      score: combinedScore,
    });
  }

  // Sort by score descending
  scoredMemories.sort((a, b) => b.score - a.score);

  return scoredMemories;
}

// ============================================================================
// Token Budget Filling
// ============================================================================

/**
 * Fill token budget with highest-scored memories
 *
 * @param memories - Scored memories (already sorted by score)
 * @param maxTokens - Token budget
 * @returns Memories that fit within budget
 */
export function fillTokenBudget(memories: ScoredMemory[], maxTokens: number): ScoredMemory[] {
  const result: ScoredMemory[] = [];
  let tokens = 0;

  for (const memory of memories) {
    // Use summary if available, otherwise content
    const text = memory.summary ?? memory.content;
    const memTokens = estimateTokens(text);

    if (tokens + memTokens > maxTokens) {
      // Check if we can fit a truncated version
      const remainingTokens = maxTokens - tokens;
      if (remainingTokens > 50) {
        // At least 50 tokens worth keeping
        // We don't truncate, just skip - better to have complete memories
      }
      break;
    }

    result.push(memory);
    tokens += memTokens;
  }

  return result;
}

// ============================================================================
// Main Retrieval Function
// ============================================================================

/**
 * Retrieve relevant memories using hybrid scoring
 *
 * Combines:
 * - FTS5 keyword matching (40%)
 * - Recency boost (30%)
 * - Importance score (20%)
 * - Access frequency (10%)
 *
 * @param db - Database instance
 * @param query - Search query (can be empty for general retrieval)
 * @param options - Retrieval options
 * @returns Relevant memories within token budget
 */
export function retrieveMemories(
  db: Database.Database,
  query: string,
  options: RetrievalOptions = {}
): ScoredMemory[] {
  const {
    maxTokens = 2000,
    maxResults = 20,
    offset = 0,
    types,
    tiers,
    minImportance,
  } = options;

  const weights = DEFAULT_SCORING_WEIGHTS;

  // Get FTS results if query is provided (fetch more to account for offset)
  const fetchLimit = 50 + offset;
  const ftsResults = query.trim() ? searchByKeyword(db, query, fetchLimit) : [];

  // Get recent memories (fetch more to account for offset)
  const recentMemories = getRecentMemories(db, 7, 20 + offset);

  // Merge and score
  let scored = mergeAndScore(db, ftsResults, recentMemories, weights);

  // Apply filters
  if (types && types.length > 0) {
    scored = scored.filter((m) => types.includes(m.type));
  }

  if (tiers && tiers.length > 0) {
    scored = scored.filter((m) => tiers.includes(m.tier));
  }

  if (minImportance !== undefined) {
    scored = scored.filter((m) => m.importance >= minImportance);
  }

  // Apply pagination: skip offset items, then take maxResults
  scored = scored.slice(offset, offset + maxResults);

  // Fill token budget
  const result = fillTokenBudget(scored, maxTokens);

  // Update access counts for retrieved memories
  for (const memory of result) {
    updateAccessCount(db, memory.seq);
  }

  return result;
}

/**
 * Retrieve memories without a specific query (general context)
 *
 * Uses recency and importance for ranking when no search query is provided.
 */
export function retrieveContext(
  db: Database.Database,
  options: RetrievalOptions = {}
): ScoredMemory[] {
  const {
    maxTokens = 2000,
    maxResults = 20,
    offset = 0,
    types,
    tiers,
    minImportance,
  } = options;

  // Get recent and important memories (fetch more to account for offset)
  const fetchExtra = offset + maxResults;
  const recentMemories = getRecentMemories(db, 14, 30 + fetchExtra);
  const importantMemories = getHighImportanceMemories(db, 0.6, 20 + fetchExtra);

  // Merge into unique set
  const memoryMap = new Map<number, Memory>();
  for (const m of recentMemories) memoryMap.set(m.seq, m);
  for (const m of importantMemories) memoryMap.set(m.seq, m);

  // Score (no FTS component)
  const weights: ScoringWeights = {
    fts: 0,
    recency: 0.5,
    importance: 0.35,
    access: 0.15,
  };

  // Find max access count
  const maxAccess = Math.max(...Array.from(memoryMap.values()).map((m) => m.access_count), 1);

  let scored: ScoredMemory[] = [];
  for (const memory of memoryMap.values()) {
    const recencyScore = calculateRecencyScore(memory.created_at);
    const importanceScore = memory.importance;
    const accessScore = normalizeAccessCount(memory.access_count, maxAccess);

    const baseScore =
      weights.recency * recencyScore +
      weights.importance * importanceScore +
      weights.access * accessScore;

    // Apply decay weight based on memory tier
    const decayWeight = getDecayWeight(memory.decay_tier);
    const combinedScore = baseScore * decayWeight;

    scored.push({
      ...memory,
      score: combinedScore,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // Apply filters
  if (types && types.length > 0) {
    scored = scored.filter((m) => types.includes(m.type));
  }

  if (tiers && tiers.length > 0) {
    scored = scored.filter((m) => tiers.includes(m.tier));
  }

  if (minImportance !== undefined) {
    scored = scored.filter((m) => m.importance >= minImportance);
  }

  // Apply pagination: skip offset items, then take maxResults
  scored = scored.slice(offset, offset + maxResults);

  const result = fillTokenBudget(scored, maxTokens);

  // Update access counts
  for (const memory of result) {
    updateAccessCount(db, memory.seq);
  }

  return result;
}

// ============================================================================
// Context Injection Helpers
// ============================================================================

/**
 * Format memories for system prompt injection
 */
export function formatMemoriesForPrompt(memories: ScoredMemory[]): string {
  if (memories.length === 0) {
    return '';
  }

  const lines = memories.map((m) => {
    const text = m.summary ?? m.content;
    const typeLabel = m.type.charAt(0).toUpperCase() + m.type.slice(1);
    return `- [${typeLabel}] ${text}`;
  });

  return `## Relevant Memories\n\n${lines.join('\n')}`;
}

/**
 * Build system prompt with memory injection
 */
export function buildSystemPrompt(
  basePrompt: string,
  db: Database.Database,
  query: string,
  options: RetrievalOptions = {}
): string {
  const memories = query.trim()
    ? retrieveMemories(db, query, options)
    : retrieveContext(db, options);

  if (memories.length === 0) {
    return basePrompt;
  }

  const memoryBlock = formatMemoriesForPrompt(memories);
  return `${basePrompt}\n\n${memoryBlock}`;
}
