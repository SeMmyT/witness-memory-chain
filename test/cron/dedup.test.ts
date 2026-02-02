/**
 * Deduplication Tests
 *
 * Tests for the content deduplication functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  normalizeContent,
  hashContent,
  getDailyFilePath,
  existsInDailyFile,
  existsInMemoryMd,
  calculateSimilarity,
  isTooSimilar,
} from '../../src/cron/dedup.js';

describe('Deduplication', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('normalizeContent', () => {
    it('should lowercase content', () => {
      expect(normalizeContent('Hello World')).toBe('hello world');
    });

    it('should collapse whitespace', () => {
      expect(normalizeContent('hello   world\n\ntest')).toBe('hello world test');
    });

    it('should remove punctuation', () => {
      expect(normalizeContent('Hello, World!')).toBe('hello world');
    });

    it('should handle empty strings', () => {
      expect(normalizeContent('')).toBe('');
    });
  });

  describe('hashContent', () => {
    it('should produce consistent hashes', () => {
      const hash1 = hashContent('Hello World');
      const hash2 = hashContent('Hello World');
      expect(hash1).toBe(hash2);
    });

    it('should normalize before hashing', () => {
      const hash1 = hashContent('Hello World');
      const hash2 = hashContent('hello   world');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different content', () => {
      const hash1 = hashContent('Hello');
      const hash2 = hashContent('World');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('getDailyFilePath', () => {
    it('should format path correctly', () => {
      const date = new Date('2026-02-01');
      const result = getDailyFilePath('/workspace', date);
      expect(result).toBe('/workspace/memory/2026-02-01.md');
    });

    it('should use current date by default', () => {
      const result = getDailyFilePath('/workspace');
      const today = new Date().toISOString().split('T')[0];
      expect(result).toContain(today);
    });
  });

  describe('existsInDailyFile', () => {
    it('should return false for non-existent file', async () => {
      const result = await existsInDailyFile('test', '/non/existent/file.md');
      expect(result.exists).toBe(false);
    });

    it('should find content in daily file', async () => {
      const filePath = path.join(testDir, 'test.md');
      await fs.writeFile(filePath, '## 10:00 — Decision\n\nI prefer Vue.js\n');

      const result = await existsInDailyFile('I prefer Vue.js', filePath);
      expect(result.exists).toBe(true);
    });

    it('should not find different content', async () => {
      const filePath = path.join(testDir, 'test.md');
      await fs.writeFile(filePath, '## 10:00 — Decision\n\nI prefer React\n');

      const result = await existsInDailyFile('I prefer Vue.js', filePath);
      expect(result.exists).toBe(false);
    });
  });

  describe('existsInMemoryMd', () => {
    it('should return false for non-existent MEMORY.md', async () => {
      const result = await existsInMemoryMd('test', testDir);
      expect(result.exists).toBe(false);
    });

    it('should find content in MEMORY.md', async () => {
      await fs.writeFile(path.join(testDir, 'MEMORY.md'), '- I prefer dark mode\n');

      const result = await existsInMemoryMd('I prefer dark mode', testDir);
      expect(result.exists).toBe(true);
    });
  });

  describe('calculateSimilarity', () => {
    it('should return 1 for identical content', () => {
      expect(calculateSimilarity('hello world', 'hello world')).toBe(1);
    });

    it('should return 0 for completely different content', () => {
      expect(calculateSimilarity('hello', 'goodbye')).toBe(0);
    });

    it('should return partial similarity for overlapping content', () => {
      const similarity = calculateSimilarity(
        'I prefer using Vue.js',
        'I prefer using React'
      );
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });

    it('should handle empty strings', () => {
      expect(calculateSimilarity('', 'hello')).toBe(0);
      expect(calculateSimilarity('hello', '')).toBe(0);
      expect(calculateSimilarity('', '')).toBe(0);
    });
  });

  describe('isTooSimilar', () => {
    it('should detect similar content above threshold', async () => {
      const existing = ['I prefer using Vue.js for frontend development'];
      const result = await isTooSimilar(
        'I prefer using Vue.js for frontend development',
        existing
      );
      expect(result.similar).toBe(true);
    });

    it('should not flag different content', async () => {
      const existing = ['I prefer using Vue.js'];
      const result = await isTooSimilar(
        'The weather is nice today',
        existing
      );
      expect(result.similar).toBe(false);
    });

    it('should respect custom threshold', async () => {
      const existing = ['I prefer Vue'];
      const result = await isTooSimilar('I prefer React', existing, 0.9);
      expect(result.similar).toBe(false);
    });
  });
});
