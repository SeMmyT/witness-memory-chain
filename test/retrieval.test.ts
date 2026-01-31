/**
 * Retrieval Tests
 *
 * Tests for SQLite index and hybrid retrieval.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initIndex,
  closeIndex,
  insertMemory,
  getMemory,
  updateAccessCount,
  updateImportance,
  updateSummary,
  deleteMemory,
  rebuildFromChain,
  getMemoryCount,
  getAllMemories,
} from '../src/index/sqlite.js';
import {
  retrieveMemories,
  retrieveContext,
  searchByKeyword,
  getRecentMemories,
  fillTokenBudget,
  estimateTokens,
  formatMemoriesForPrompt,
} from '../src/index/retrieval.js';
import type { Memory, ScoredMemory, ChainEntry } from '../src/types.js';
import type Database from 'better-sqlite3';

// Test directory and database
let testDir: string;
let db: Database.Database;

beforeEach(async () => {
  testDir = join(tmpdir(), `memory-chain-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
  db = initIndex(join(testDir, 'memory.db'));
});

afterEach(async () => {
  closeIndex(db);
  await rm(testDir, { recursive: true, force: true });
});

// ============================================================================
// SQLite Index Tests
// ============================================================================

describe('SQLite Index', () => {
  it('should initialize database with schema', () => {
    // Check that tables exist
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
    `).all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('memories');
    expect(tableNames).toContain('memories_fts');
    expect(tableNames).toContain('meta');
  });

  it('should insert and retrieve memories', () => {
    const memory: Omit<Memory, 'access_count' | 'last_accessed'> = {
      seq: 1,
      content: 'User prefers dark mode',
      summary: null,
      type: 'memory',
      tier: 'relationship',
      importance: 0.5,
      created_at: new Date().toISOString(),
    };

    insertMemory(db, memory);
    const retrieved = getMemory(db, 1);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toBe('User prefers dark mode');
    expect(retrieved!.type).toBe('memory');
    expect(retrieved!.access_count).toBe(0);
  });

  it('should update access count', () => {
    insertMemory(db, {
      seq: 1,
      content: 'Test memory',
      summary: null,
      type: 'memory',
      tier: 'relationship',
      importance: 0.5,
      created_at: new Date().toISOString(),
    });

    updateAccessCount(db, 1);
    updateAccessCount(db, 1);
    updateAccessCount(db, 1);

    const memory = getMemory(db, 1);
    expect(memory!.access_count).toBe(3);
    expect(memory!.last_accessed).toBeTruthy();
  });

  it('should update importance', () => {
    insertMemory(db, {
      seq: 1,
      content: 'Test memory',
      summary: null,
      type: 'memory',
      tier: 'relationship',
      importance: 0.5,
      created_at: new Date().toISOString(),
    });

    updateImportance(db, 1, 0.9);

    const memory = getMemory(db, 1);
    expect(memory!.importance).toBe(0.9);
  });

  it('should update summary', () => {
    insertMemory(db, {
      seq: 1,
      content: 'A very long memory content that could be summarized',
      summary: null,
      type: 'memory',
      tier: 'relationship',
      importance: 0.5,
      created_at: new Date().toISOString(),
    });

    updateSummary(db, 1, 'Memory about long content');

    const memory = getMemory(db, 1);
    expect(memory!.summary).toBe('Memory about long content');
  });

  it('should delete memories', () => {
    insertMemory(db, {
      seq: 1,
      content: 'Test memory',
      summary: null,
      type: 'memory',
      tier: 'relationship',
      importance: 0.5,
      created_at: new Date().toISOString(),
    });

    deleteMemory(db, 1);

    const memory = getMemory(db, 1);
    expect(memory).toBeNull();
  });

  it('should count memories', () => {
    insertMemory(db, {
      seq: 1,
      content: 'Memory 1',
      summary: null,
      type: 'memory',
      tier: 'relationship',
      importance: 0.5,
      created_at: new Date().toISOString(),
    });
    insertMemory(db, {
      seq: 2,
      content: 'Memory 2',
      summary: null,
      type: 'memory',
      tier: 'relationship',
      importance: 0.5,
      created_at: new Date().toISOString(),
    });

    expect(getMemoryCount(db)).toBe(2);
  });
});

// ============================================================================
// FTS5 Search Tests
// ============================================================================

describe('FTS5 Search', () => {
  beforeEach(() => {
    // Insert test memories
    const memories = [
      { seq: 1, content: 'User prefers dark mode interface', type: 'memory' as const },
      { seq: 2, content: 'User likes coffee in the morning', type: 'memory' as const },
      { seq: 3, content: 'Project uses TypeScript and React', type: 'memory' as const },
      { seq: 4, content: 'Dark theme is enabled by default', type: 'memory' as const },
      { seq: 5, content: 'User identity: Software Engineer', type: 'identity' as const },
    ];

    for (const m of memories) {
      insertMemory(db, {
        seq: m.seq,
        content: m.content,
        summary: null,
        type: m.type,
        tier: 'relationship',
        importance: 0.5,
        created_at: new Date().toISOString(),
      });
    }
  });

  it('should find memories by keyword', () => {
    const results = searchByKeyword(db, 'dark', 10);

    expect(results.length).toBe(2);
    expect(results.some((r) => r.seq === 1)).toBe(true);
    expect(results.some((r) => r.seq === 4)).toBe(true);
  });

  it('should find memories by multiple keywords', () => {
    const results = searchByKeyword(db, 'user dark', 10);

    // Should find entries with either "user" or "dark"
    expect(results.length).toBeGreaterThan(0);
  });

  it('should return empty for no matches', () => {
    const results = searchByKeyword(db, 'nonexistent', 10);

    expect(results.length).toBe(0);
  });

  it('should rank results by relevance', () => {
    const results = searchByKeyword(db, 'dark mode', 10);

    // Entry 1 mentions both "dark" and "mode", should rank higher
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].seq).toBe(1);
  });

  it('should handle Unicode characters in search', () => {
    // Search with accented characters
    const results = searchByKeyword(db, 'café', 10);

    // Should not throw, return empty if no match
    expect(Array.isArray(results)).toBe(true);
  });

  it('should sanitize zero-width characters', () => {
    // Query with zero-width characters that should be stripped
    const results = searchByKeyword(db, 'dark\u200B\u200Cmode', 10);

    // Should find results as if query was "darkmode"
    expect(Array.isArray(results)).toBe(true);
  });

  it('should handle empty query after sanitization', () => {
    // Query with only special characters
    const results = searchByKeyword(db, '!@#$%^&*()', 10);

    expect(results).toEqual([]);
  });
});

// ============================================================================
// Hybrid Retrieval Tests
// ============================================================================

describe('Hybrid Retrieval', () => {
  beforeEach(() => {
    // Insert memories with varying recency and importance
    const now = new Date();

    const memories = [
      {
        seq: 1,
        content: 'User prefers dark mode',
        importance: 0.8,
        created_at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
      },
      {
        seq: 2,
        content: 'Old memory about light mode',
        importance: 0.3,
        created_at: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
      },
      {
        seq: 3,
        content: 'Very important identity marker',
        importance: 0.95,
        created_at: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days ago
      },
      {
        seq: 4,
        content: 'Recent but low importance memory',
        importance: 0.2,
        created_at: now.toISOString(), // Now
      },
    ];

    for (const m of memories) {
      insertMemory(db, {
        seq: m.seq,
        content: m.content,
        summary: null,
        type: 'memory',
        tier: 'relationship',
        importance: m.importance,
        created_at: m.created_at,
      });
    }
  });

  it('should retrieve memories with hybrid scoring', () => {
    const results = retrieveMemories(db, 'mode', { maxResults: 10 });

    expect(results.length).toBeGreaterThan(0);
    // Results should have scores
    expect(results[0].score).toBeDefined();
  });

  it('should respect maxResults limit', () => {
    const results = retrieveMemories(db, 'memory', { maxResults: 2 });

    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should filter by types', () => {
    // Add an identity memory
    insertMemory(db, {
      seq: 5,
      content: 'Identity: AI Assistant',
      summary: null,
      type: 'identity',
      tier: 'committed',
      importance: 0.9,
      created_at: new Date().toISOString(),
    });

    const results = retrieveMemories(db, 'identity', {
      types: ['identity'],
      maxResults: 10,
    });

    expect(results.every((r) => r.type === 'identity')).toBe(true);
  });

  it('should filter by minimum importance', () => {
    const results = retrieveMemories(db, '', {
      minImportance: 0.7,
      maxResults: 10,
    });

    expect(results.every((r) => r.importance >= 0.7)).toBe(true);
  });

  it('should retrieve context without query', () => {
    const results = retrieveContext(db, { maxResults: 10 });

    expect(results.length).toBeGreaterThan(0);
    // Should prioritize recent and important memories
    expect(results[0].score).toBeDefined();
  });

  it('should support pagination with offset', () => {
    // Add more memories for pagination test
    for (let i = 10; i < 20; i++) {
      insertMemory(db, {
        seq: i,
        content: `Pagination test memory ${i}`,
        summary: null,
        type: 'memory',
        tier: 'relationship',
        importance: 0.5 + (i % 5) * 0.1,
        created_at: new Date().toISOString(),
      });
    }

    // Get first page
    const page1 = retrieveContext(db, { maxResults: 5, offset: 0 });
    // Get second page
    const page2 = retrieveContext(db, { maxResults: 5, offset: 5 });

    expect(page1.length).toBe(5);
    expect(page2.length).toBe(5);

    // Pages should have different items
    const page1Seqs = new Set(page1.map((m) => m.seq));
    const page2Seqs = new Set(page2.map((m) => m.seq));

    // No overlap between pages
    for (const seq of page2Seqs) {
      expect(page1Seqs.has(seq)).toBe(false);
    }
  });
});

// ============================================================================
// Token Budget Tests
// ============================================================================

describe('Token Budget', () => {
  it('should estimate tokens for English text', () => {
    const text = 'This is a test sentence with about 40 characters.';
    const tokens = estimateTokens(text);

    // Should be reasonable for English text
    expect(tokens).toBeGreaterThanOrEqual(8);
    expect(tokens).toBeLessThanOrEqual(20);
  });

  it('should estimate more tokens for code', () => {
    const code = 'const x = { foo: "bar", baz: [1, 2, 3] };';
    const tokens = estimateTokens(code);

    // Code typically has more tokens due to special characters
    expect(tokens).toBeGreaterThanOrEqual(10);
  });

  it('should handle CJK characters', () => {
    const cjk = '这是一个测试句子'; // "This is a test sentence" in Chinese
    const tokens = estimateTokens(cjk);

    // CJK characters often tokenize to ~1 token each
    expect(tokens).toBeGreaterThanOrEqual(4);
  });

  it('should return 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should return at least 1 for non-empty text', () => {
    expect(estimateTokens('a')).toBeGreaterThanOrEqual(1);
  });

  it('should fill token budget without exceeding', () => {
    const memories: ScoredMemory[] = [
      {
        seq: 1,
        content: 'A'.repeat(100), // ~25 tokens
        summary: null,
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        access_count: 0,
        last_accessed: null,
        created_at: new Date().toISOString(),
        score: 0.9,
      },
      {
        seq: 2,
        content: 'B'.repeat(100), // ~25 tokens
        summary: null,
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        access_count: 0,
        last_accessed: null,
        created_at: new Date().toISOString(),
        score: 0.8,
      },
      {
        seq: 3,
        content: 'C'.repeat(100), // ~25 tokens
        summary: null,
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        access_count: 0,
        last_accessed: null,
        created_at: new Date().toISOString(),
        score: 0.7,
      },
    ];

    const result = fillTokenBudget(memories, 50);

    // Should fit 2 memories (~50 tokens)
    expect(result.length).toBe(2);
    expect(result[0].seq).toBe(1); // Highest scored first
    expect(result[1].seq).toBe(2);
  });

  it('should prefer summaries over content when available', () => {
    const memories: ScoredMemory[] = [
      {
        seq: 1,
        content: 'A'.repeat(1000), // ~250 tokens
        summary: 'Short summary', // ~3 tokens
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        access_count: 0,
        last_accessed: null,
        created_at: new Date().toISOString(),
        score: 0.9,
      },
    ];

    const result = fillTokenBudget(memories, 10);

    // Should fit because summary is used
    expect(result.length).toBe(1);
  });
});

// ============================================================================
// Format Tests
// ============================================================================

describe('Formatting', () => {
  it('should format memories for prompt injection', () => {
    const memories: ScoredMemory[] = [
      {
        seq: 1,
        content: 'User prefers dark mode',
        summary: null,
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        access_count: 0,
        last_accessed: null,
        created_at: new Date().toISOString(),
        score: 0.9,
      },
      {
        seq: 2,
        content: 'Identity: AI Assistant',
        summary: 'AI Assistant identity',
        type: 'identity',
        tier: 'committed',
        importance: 0.9,
        access_count: 0,
        last_accessed: null,
        created_at: new Date().toISOString(),
        score: 0.8,
      },
    ];

    const formatted = formatMemoriesForPrompt(memories);

    expect(formatted).toContain('## Relevant Memories');
    expect(formatted).toContain('[Memory] User prefers dark mode');
    expect(formatted).toContain('[Identity] AI Assistant identity'); // Uses summary
  });

  it('should return empty string for no memories', () => {
    const formatted = formatMemoriesForPrompt([]);

    expect(formatted).toBe('');
  });
});

// ============================================================================
// Index Rebuild Tests
// ============================================================================

describe('Index Rebuild', () => {
  it('should rebuild index from chain entries', async () => {
    const entries: ChainEntry[] = [
      {
        seq: 0,
        ts: new Date().toISOString(),
        type: 'identity',
        tier: 'committed',
        content_hash: 'sha256:genesis',
        prev_hash: null,
        signature: 'ed25519:sig',
      },
      {
        seq: 1,
        ts: new Date().toISOString(),
        type: 'memory',
        tier: 'relationship',
        content_hash: 'sha256:hash1',
        prev_hash: 'sha256:genesis',
        signature: 'ed25519:sig',
      },
      {
        seq: 2,
        ts: new Date().toISOString(),
        type: 'memory',
        tier: 'relationship',
        content_hash: 'sha256:hash2',
        prev_hash: 'sha256:hash1',
        signature: 'ed25519:sig',
      },
    ];

    const contentMap: Record<string, string> = {
      'sha256:genesis': 'Genesis content',
      'sha256:hash1': 'First memory content',
      'sha256:hash2': 'Second memory content',
    };

    const contentLoader = async (hash: string) => contentMap[hash] ?? null;

    const { indexed, skipped } = await rebuildFromChain(db, entries, contentLoader);

    expect(indexed).toBe(3);
    expect(skipped).toBe(0);
    expect(getMemoryCount(db)).toBe(3);
  });

  it('should skip redacted entries during rebuild', async () => {
    const entries: ChainEntry[] = [
      {
        seq: 0,
        ts: new Date().toISOString(),
        type: 'identity',
        tier: 'committed',
        content_hash: 'sha256:genesis',
        prev_hash: null,
        signature: 'ed25519:sig',
      },
      {
        seq: 1,
        ts: new Date().toISOString(),
        type: 'memory',
        tier: 'relationship',
        content_hash: 'sha256:hash1',
        prev_hash: 'sha256:genesis',
        signature: 'ed25519:sig',
      },
      {
        seq: 2,
        ts: new Date().toISOString(),
        type: 'redaction',
        tier: 'committed',
        content_hash: 'sha256:redact',
        prev_hash: 'sha256:hash1',
        signature: 'ed25519:sig',
        metadata: { target_seq: 1 },
      },
    ];

    const contentMap: Record<string, string> = {
      'sha256:genesis': 'Genesis content',
      'sha256:hash1': 'First memory content',
      'sha256:redact': 'Redaction entry',
    };

    const contentLoader = async (hash: string) => contentMap[hash] ?? null;

    const { indexed, skipped } = await rebuildFromChain(db, entries, contentLoader);

    // Genesis indexed, memory skipped (redacted), redaction skipped
    expect(indexed).toBe(1);
    expect(skipped).toBe(2);
  });
});
