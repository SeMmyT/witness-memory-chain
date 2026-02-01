/**
 * Deduplication Helpers
 *
 * Prevents duplicate content from being captured by checking:
 * 1. Daily memory files (memory/YYYY-MM-DD.md)
 * 2. MEMORY.md (curated long-term memory)
 * 3. Chain index (existing chain entries)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { DuplicateCheckResult } from './types.js';

// ============================================================================
// Content Normalization
// ============================================================================

/**
 * Normalize content for comparison
 *
 * Normalizes whitespace, case, and punctuation to detect
 * semantically similar content even with minor variations.
 */
export function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .trim();
}

/**
 * Generate content hash for exact duplicate detection
 */
export function hashContent(content: string): string {
  const normalized = normalizeContent(content);
  const hash = sha256(new TextEncoder().encode(normalized));
  return bytesToHex(hash);
}

// ============================================================================
// Daily File Checking
// ============================================================================

/**
 * Get the path for today's daily memory file
 */
export function getDailyFilePath(workspaceDir: string, date: Date = new Date()): string {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(workspaceDir, 'memory', `${dateStr}.md`);
}

/**
 * Check if content exists in a daily file
 *
 * Uses normalized comparison to detect similar content.
 */
export async function existsInDailyFile(
  content: string,
  dailyFilePath: string
): Promise<{ exists: boolean; matchedContent?: string }> {
  try {
    const fileContent = await fs.readFile(dailyFilePath, 'utf-8');
    const normalizedInput = normalizeContent(content);

    // Split file into sections (separated by ##)
    const sections = fileContent.split(/^## /m);

    for (const section of sections) {
      if (!section.trim()) continue;

      // Extract content from section (skip timestamp line)
      const lines = section.split('\n').slice(1);
      const sectionContent = lines.join(' ');
      const normalizedSection = normalizeContent(sectionContent);

      // Check for similarity (normalized match)
      if (normalizedSection.includes(normalizedInput) || normalizedInput.includes(normalizedSection)) {
        return { exists: true, matchedContent: section.slice(0, 200) };
      }

      // Check for hash match
      if (hashContent(sectionContent) === hashContent(content)) {
        return { exists: true, matchedContent: section.slice(0, 200) };
      }
    }

    return { exists: false };
  } catch (error) {
    // File doesn't exist or can't be read
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false };
    }
    throw error;
  }
}

// ============================================================================
// MEMORY.md Checking
// ============================================================================

/**
 * Check if content exists in MEMORY.md
 */
export async function existsInMemoryMd(
  content: string,
  workspaceDir: string
): Promise<{ exists: boolean; matchedContent?: string }> {
  const memoryMdPath = path.join(workspaceDir, 'MEMORY.md');

  try {
    const fileContent = await fs.readFile(memoryMdPath, 'utf-8');
    const normalizedInput = normalizeContent(content);

    // Check each line/section
    const lines = fileContent.split('\n');

    for (const line of lines) {
      if (!line.trim() || line.startsWith('#')) continue;

      const normalizedLine = normalizeContent(line);

      // Check for similarity
      if (normalizedLine.includes(normalizedInput) || normalizedInput.includes(normalizedLine)) {
        return { exists: true, matchedContent: line.slice(0, 200) };
      }
    }

    return { exists: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false };
    }
    throw error;
  }
}

// ============================================================================
// Chain Index Checking
// ============================================================================

/**
 * Check if content exists in the chain index
 *
 * Uses the SQLite FTS5 index for efficient text search.
 */
export async function existsInChain(
  content: string,
  chainDir: string
): Promise<{ exists: boolean; matchedSeq?: number }> {
  // Dynamic import to avoid circular dependency
  const { initIndex, closeIndex } = await import('../index/sqlite.js');
  const { searchByKeyword } = await import('../index/retrieval.js');

  const dbPath = path.join(chainDir, 'memory.db');

  // Check if database exists
  try {
    await fs.access(dbPath);
  } catch {
    return { exists: false };
  }

  const db = initIndex(dbPath);

  try {
    // Extract key terms for search
    const terms = content
      .split(/\s+/)
      .filter((t) => t.length > 3)
      .slice(0, 5)
      .join(' ');

    if (!terms) {
      return { exists: false };
    }

    const results = searchByKeyword(db, terms, 5);

    if (results.length === 0) {
      return { exists: false };
    }

    // Get the top result and check similarity
    const { getMemory } = await import('../index/sqlite.js');

    for (const result of results) {
      const memory = getMemory(db, result.seq);
      if (memory) {
        const normalizedInput = normalizeContent(content);
        const normalizedMemory = normalizeContent(memory.content);

        // Check for significant overlap
        if (
          normalizedMemory.includes(normalizedInput) ||
          normalizedInput.includes(normalizedMemory) ||
          hashContent(content) === hashContent(memory.content)
        ) {
          return { exists: true, matchedSeq: memory.seq };
        }
      }
    }

    return { exists: false };
  } finally {
    closeIndex(db);
  }
}

// ============================================================================
// Main Deduplication Check
// ============================================================================

/**
 * Check if content is a duplicate across all sources
 *
 * Checks in order of likelihood:
 * 1. Today's daily file (most likely for recent captures)
 * 2. Chain index (for older captures)
 * 3. MEMORY.md (for curated content)
 */
export async function checkDuplicate(
  content: string,
  workspaceDir: string,
  chainDir: string,
  date: Date = new Date()
): Promise<DuplicateCheckResult> {
  // Check today's daily file first (most likely source)
  const dailyFilePath = getDailyFilePath(workspaceDir, date);
  const dailyCheck = await existsInDailyFile(content, dailyFilePath);

  if (dailyCheck.exists) {
    return {
      isDuplicate: true,
      foundIn: 'daily',
      matchedContent: dailyCheck.matchedContent,
    };
  }

  // Check chain index
  const chainCheck = await existsInChain(content, chainDir);

  if (chainCheck.exists) {
    return {
      isDuplicate: true,
      foundIn: 'chain',
      matchedContent: `Chain entry #${chainCheck.matchedSeq}`,
    };
  }

  // Check MEMORY.md
  const memoryCheck = await existsInMemoryMd(content, workspaceDir);

  if (memoryCheck.exists) {
    return {
      isDuplicate: true,
      foundIn: 'memory_md',
      matchedContent: memoryCheck.matchedContent,
    };
  }

  return { isDuplicate: false };
}

// ============================================================================
// Similarity Scoring
// ============================================================================

/**
 * Calculate similarity score between two strings (0-1)
 *
 * Uses Jaccard similarity on word sets.
 */
export function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeContent(a).split(' ').filter(Boolean));
  const wordsB = new Set(normalizeContent(b).split(' ').filter(Boolean));

  if (wordsA.size === 0 || wordsB.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      intersection++;
    }
  }

  const union = wordsA.size + wordsB.size - intersection;
  return intersection / union;
}

/**
 * Check if content is too similar to existing content
 *
 * @param threshold - Similarity threshold (0-1, default: 0.8)
 */
export async function isTooSimilar(
  content: string,
  existingContents: string[],
  threshold = 0.8
): Promise<{ similar: boolean; matchIndex?: number; similarity?: number }> {
  for (let i = 0; i < existingContents.length; i++) {
    const similarity = calculateSimilarity(content, existingContents[i]);
    if (similarity >= threshold) {
      return { similar: true, matchIndex: i, similarity };
    }
  }
  return { similar: false };
}
