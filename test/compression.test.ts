/**
 * Compression Tests
 *
 * Tests for text compression/summarization utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  compressText,
  compressTexts,
  generateMemorySummary,
  extractEntities,
  findPronounReferents,
  compressionRatio,
} from '../src/compression.js';

// ============================================================================
// Entity Extraction Tests
// ============================================================================

describe('Entity Extraction', () => {
  it('should extract capitalized names', () => {
    const text = 'John Smith met with Alice Johnson yesterday.';
    const entities = extractEntities(text);

    expect(entities).toContain('John Smith');
    expect(entities).toContain('Alice Johnson');
  });

  it('should extract email addresses', () => {
    const text = 'Contact us at support@example.com for help.';
    const entities = extractEntities(text);

    expect(entities.some((e) => e.includes('support@example.com'))).toBe(true);
  });

  it('should extract URLs', () => {
    const text = 'Visit https://example.com/page for more info.';
    const entities = extractEntities(text);

    expect(entities.some((e) => e.includes('https://example.com'))).toBe(true);
  });

  it('should handle text without entities', () => {
    const text = 'this is all lowercase text without entities.';
    const entities = extractEntities(text);

    expect(entities.length).toBe(0);
  });
});

// ============================================================================
// Pronoun Resolution Tests
// ============================================================================

describe('Pronoun Resolution', () => {
  it('should find referents for pronouns', () => {
    const text = 'John went to the store. He bought groceries.';
    const referents = findPronounReferents(text);

    // Should have some referents (case may vary)
    expect(referents.size).toBeGreaterThan(0);
    // The referent should be John
    const values = Array.from(referents.values());
    expect(values.some((v) => v === 'John')).toBe(true);
  });

  it('should handle multiple names', () => {
    const text = 'Alice met Bob. She greeted him warmly.';
    const referents = findPronounReferents(text);

    // Should use the most recent name
    expect(referents.size).toBeGreaterThan(0);
  });

  it('should return empty map for text without names', () => {
    const text = 'someone went somewhere and did something.';
    const referents = findPronounReferents(text);

    expect(referents.size).toBe(0);
  });
});

// ============================================================================
// Text Compression Tests
// ============================================================================

describe('Text Compression', () => {
  it('should return short text unchanged', () => {
    const text = 'Short text.';
    const compressed = compressText(text, { maxLength: 100 });

    expect(compressed).toBe(text);
  });

  it('should compress long text to within maxLength', () => {
    const text = `
      This is a long piece of text that contains multiple sentences.
      It talks about important things like preferences and decisions.
      The user likes dark mode. They prefer TypeScript over JavaScript.
      This information should be preserved in the summary.
      Some sentences are less important and can be removed.
    `.trim();

    const compressed = compressText(text, { maxLength: 100 });

    expect(compressed.length).toBeLessThanOrEqual(100);
  });

  it('should preserve key sentences', () => {
    const text = 'The user prefers dark mode. Some random filler text. Another unimportant sentence.';
    const compressed = compressText(text, { maxLength: 100 });

    // Should keep the sentence with "prefers"
    expect(compressed.toLowerCase()).toContain('prefer');
  });

  it('should preserve entities when requested', () => {
    const text = 'John Smith said he likes Python. He uses it daily for work at Google.';
    const compressed = compressText(text, { maxLength: 150, preserveEntities: true });

    expect(compressed).toContain('John Smith');
  });

  it('should handle very long text gracefully', () => {
    const text = 'Word. '.repeat(1000);
    const compressed = compressText(text, { maxLength: 50 });

    expect(compressed.length).toBeLessThanOrEqual(53); // +3 for "..."
  });
});

// ============================================================================
// Memory Summary Tests
// ============================================================================

describe('Memory Summary', () => {
  it('should generate concise summaries', () => {
    const content = `
      User preferences discussion.
      The user mentioned they prefer dark mode interfaces.
      They also like to use keyboard shortcuts extensively.
      This was discussed in the context of IDE configuration.
      The user's name is Alex.
    `.trim();

    const summary = generateMemorySummary(content);

    expect(summary.length).toBeLessThanOrEqual(150);
    expect(summary.length).toBeGreaterThan(0);
  });

  it('should preserve key information', () => {
    const content = 'The user decided to use React for the frontend. This is important for the project.';
    const summary = generateMemorySummary(content);

    expect(summary.toLowerCase()).toContain('react');
  });
});

// ============================================================================
// Batch Compression Tests
// ============================================================================

describe('Batch Compression', () => {
  it('should compress multiple texts', () => {
    const texts = [
      'This is the first text with some important information.',
      'This is the second text. It mentions something different.',
      'Third text here. Short.',
    ];

    const compressed = compressTexts(texts, { maxLength: 50 });

    expect(compressed.length).toBe(3);
    expect(compressed.every((t) => t.length <= 53)).toBe(true); // +3 for "..."
  });
});

// ============================================================================
// Compression Ratio Tests
// ============================================================================

describe('Compression Ratio', () => {
  it('should calculate correct ratio', () => {
    const original = 'This is the original text';
    const compressed = 'Short';

    const ratio = compressionRatio(original, compressed);

    expect(ratio).toBeLessThan(1);
    expect(ratio).toBeCloseTo(compressed.length / original.length, 2);
  });

  it('should return 1 for empty original', () => {
    const ratio = compressionRatio('', 'any');

    expect(ratio).toBe(1);
  });

  it('should return 1 for identical texts', () => {
    const text = 'Same text';
    const ratio = compressionRatio(text, text);

    expect(ratio).toBe(1);
  });
});
