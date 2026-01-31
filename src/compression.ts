/**
 * Text Compression/Summarization
 *
 * Provides utilities for compressing memory content into summaries
 * while preserving key information. This is "semantic compression" -
 * reducing text length while maintaining meaning.
 *
 * Based on SimpleMem research: summaries can achieve 30x compression
 * while maintaining useful retrieval accuracy.
 */

import type { CompressionOptions } from './types.js';

// ============================================================================
// Named Entity Detection
// ============================================================================

/**
 * Common name patterns
 */
const NAME_PATTERNS = [
  // Capitalized words (potential names)
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
  // Email addresses
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
  // URLs
  /https?:\/\/[^\s]+/gi,
  // File paths
  /(?:\/[\w.-]+)+|(?:[A-Z]:\\[\w\\.-]+)/gi,
];

/**
 * Extract named entities from text
 *
 * @param text - Text to extract entities from
 * @returns Array of unique entities
 */
export function extractEntities(text: string): string[] {
  const entities = new Set<string>();

  for (const pattern of NAME_PATTERNS) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      // Skip very short matches (likely not entities)
      if (match.length > 2) {
        entities.add(match);
      }
    }
  }

  return Array.from(entities);
}

// ============================================================================
// Pronoun Resolution
// ============================================================================

/**
 * Common pronouns and their contexts
 */
const PRONOUNS = {
  subject: ['he', 'she', 'they', 'it', 'we', 'you'],
  object: ['him', 'her', 'them', 'it', 'us', 'you'],
  possessive: ['his', 'her', 'their', 'its', 'our', 'your'],
};

/**
 * Find the most likely referent for pronouns in text
 *
 * Simple heuristic: look for the most recent capitalized noun phrase
 * before the pronoun.
 *
 * @param text - Text to analyze
 * @returns Map of pronouns to potential referents
 */
export function findPronounReferents(text: string): Map<string, string> {
  const referents = new Map<string, string>();

  // All pronouns to exclude from name detection
  const allPronouns = new Set<string>();
  for (const pronouns of Object.values(PRONOUNS)) {
    for (const pronoun of pronouns) {
      allPronouns.add(pronoun.toLowerCase());
    }
  }

  // Find all capitalized phrases (potential names)
  const rawNames = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];

  // Filter out pronouns from names
  const names = rawNames.filter((name) => !allPronouns.has(name.toLowerCase()));

  if (names.length === 0) {
    return referents;
  }

  // Use the most recent name as the referent
  const lastName = names[names.length - 1];

  // Map pronouns to this name
  for (const pronouns of Object.values(PRONOUNS)) {
    for (const pronoun of pronouns) {
      if (text.toLowerCase().includes(pronoun)) {
        referents.set(pronoun, lastName);
      }
    }
  }

  return referents;
}

// ============================================================================
// Sentence Scoring
// ============================================================================

/**
 * Score a sentence for importance
 *
 * Higher scores = more likely to be important
 */
function scoreSentence(sentence: string, entities: string[]): number {
  let score = 0;

  // Length bonus (prefer moderate length)
  const wordCount = sentence.split(/\s+/).length;
  if (wordCount >= 5 && wordCount <= 20) {
    score += 2;
  } else if (wordCount < 5) {
    score -= 1;
  }

  // Entity presence bonus
  for (const entity of entities) {
    if (sentence.includes(entity)) {
      score += 3;
    }
  }

  // Key phrase bonus
  const keyPhrases = [
    'prefer', 'like', 'want', 'need', 'important', 'always', 'never',
    'decided', 'agreed', 'remember', 'note', 'key', 'critical',
    'must', 'should', 'will', 'can', 'identity', 'name', 'role',
  ];
  for (const phrase of keyPhrases) {
    if (sentence.toLowerCase().includes(phrase)) {
      score += 2;
    }
  }

  // Question mark penalty (questions are often less informative for summaries)
  if (sentence.includes('?')) {
    score -= 1;
  }

  // First/last sentence bonus (often contain key info)
  // This is applied externally based on position

  return score;
}

// ============================================================================
// Text Compression
// ============================================================================

/**
 * Split text into sentences
 */
function splitSentences(text: string): string[] {
  // Simple sentence splitting
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Compress text by extracting key sentences
 *
 * This is an extractive summarization approach - it selects the most
 * important sentences rather than generating new text.
 *
 * @param text - Text to compress
 * @param options - Compression options
 * @returns Compressed text
 */
export function compressText(text: string, options: CompressionOptions = {}): string {
  const {
    maxLength = 200,
    preserveEntities = true,
    resolveReferences = false,
  } = options;

  // If already short enough, return as-is
  if (text.length <= maxLength) {
    return text;
  }

  // Extract entities
  const entities = preserveEntities ? extractEntities(text) : [];

  // Split into sentences
  const sentences = splitSentences(text);

  if (sentences.length === 0) {
    return text.slice(0, maxLength);
  }

  // Score each sentence
  const scored = sentences.map((sentence, index) => {
    let score = scoreSentence(sentence, entities);

    // Position bonus (first and last sentences)
    if (index === 0) score += 3;
    if (index === sentences.length - 1) score += 2;

    return { sentence, score };
  });

  // Sort by score (descending)
  scored.sort((a, b) => b.score - a.score);

  // Select sentences until we hit the length limit
  const selected: { sentence: string; originalIndex: number }[] = [];
  let currentLength = 0;

  for (const { sentence } of scored) {
    if (currentLength + sentence.length + 1 > maxLength) {
      break;
    }
    // Find original index for ordering
    const originalIndex = sentences.indexOf(sentence);
    selected.push({ sentence, originalIndex });
    currentLength += sentence.length + 1;
  }

  // If no sentences selected, just truncate
  if (selected.length === 0) {
    return text.slice(0, maxLength - 3) + '...';
  }

  // Re-order by original position
  selected.sort((a, b) => a.originalIndex - b.originalIndex);

  // Join selected sentences
  let result = selected.map((s) => s.sentence).join(' ');

  // Resolve pronouns if requested
  if (resolveReferences) {
    const referents = findPronounReferents(text);
    for (const [pronoun, name] of referents) {
      // Replace first occurrence only
      const regex = new RegExp(`\\b${pronoun}\\b`, 'i');
      result = result.replace(regex, name);
    }
  }

  return result;
}

/**
 * Estimate compression ratio
 *
 * @param original - Original text
 * @param compressed - Compressed text
 * @returns Compression ratio (1 = no compression, 0.5 = 50% reduction)
 */
export function compressionRatio(original: string, compressed: string): number {
  if (original.length === 0) return 1;
  return compressed.length / original.length;
}

// ============================================================================
// Batch Compression
// ============================================================================

/**
 * Compress multiple texts with consistent entity handling
 *
 * @param texts - Array of texts to compress
 * @param options - Compression options
 * @returns Array of compressed texts
 */
export function compressTexts(
  texts: string[],
  options: CompressionOptions = {}
): string[] {
  // Extract entities from all texts for consistent handling
  const allEntities = new Set<string>();
  for (const text of texts) {
    for (const entity of extractEntities(text)) {
      allEntities.add(entity);
    }
  }

  return texts.map((text) => compressText(text, options));
}

// ============================================================================
// Memory Summary Generation
// ============================================================================

/**
 * Generate a summary suitable for memory storage
 *
 * This is optimized for AI memory retrieval - preserving facts,
 * preferences, and decisions.
 *
 * @param content - Original memory content
 * @param options - Compression options
 * @returns Summary string
 */
export function generateMemorySummary(
  content: string,
  options: CompressionOptions = {}
): string {
  const defaultOptions: CompressionOptions = {
    maxLength: 150,
    preserveEntities: true,
    resolveReferences: true,
    ...options,
  };

  return compressText(content, defaultOptions);
}
