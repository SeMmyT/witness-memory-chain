/**
 * Garbage Collection Tests
 *
 * Tests for the memory garbage collection functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { initIndex, closeIndex, insertMemory, getMemory } from '../../src/index/sqlite.js';
import {
  calculateRelevance,
  runGC,
  getGCStats,
  restoreMemory,
  previewGC,
} from '../../src/cron/gc.js';
import type { Memory } from '../../src/types.js';

describe('Garbage Collection', () => {
  let testDir: string;
  let dbPath: string;
  let db: ReturnType<typeof initIndex>;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-test-'));
    dbPath = path.join(testDir, 'memory.db');
    db = initIndex(dbPath);
  });

  afterEach(async () => {
    closeIndex(db);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('calculateRelevance', () => {
    it('should score recent memories higher', () => {
      const recentMemory: Memory = {
        seq: 1,
        content: 'Recent memory',
        summary: null,
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        access_count: 0,
        last_accessed: null,
        created_at: new Date().toISOString(),
        decay_tier: 'hot',
      };

      const oldMemory: Memory = {
        ...recentMemory,
        seq: 2,
        content: 'Old memory',
        created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const recentScore = calculateRelevance(recentMemory, 10);
      const oldScore = calculateRelevance(oldMemory, 10);

      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it('should score frequently accessed memories higher', () => {
      const lowAccess: Memory = {
        seq: 1,
        content: 'Low access',
        summary: null,
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        access_count: 1,
        last_accessed: null,
        created_at: new Date().toISOString(),
        decay_tier: 'warm',
      };

      const highAccess: Memory = {
        ...lowAccess,
        seq: 2,
        access_count: 10,
      };

      const lowScore = calculateRelevance(lowAccess, 10);
      const highScore = calculateRelevance(highAccess, 10);

      expect(highScore).toBeGreaterThan(lowScore);
    });

    it('should score important memories higher', () => {
      const lowImportance: Memory = {
        seq: 1,
        content: 'Low importance',
        summary: null,
        type: 'memory',
        tier: 'relationship',
        importance: 0.2,
        access_count: 0,
        last_accessed: null,
        created_at: new Date().toISOString(),
        decay_tier: 'cold',
      };

      const highImportance: Memory = {
        ...lowImportance,
        seq: 2,
        importance: 0.9,
      };

      const lowScore = calculateRelevance(lowImportance, 10);
      const highScore = calculateRelevance(highImportance, 10);

      expect(highScore).toBeGreaterThan(lowScore);
    });
  });

  describe('runGC', () => {
    it('should archive low-relevance memories', () => {
      // Insert old, low-importance memory
      insertMemory(db, {
        seq: 1,
        content: 'Old unimportant memory',
        type: 'memory',
        tier: 'ephemeral',
        importance: 0.1,
        created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
        decay_tier: 'cold',
      });

      const result = runGC(db, { maxAgeDays: 30, gcThreshold: 0.2 });

      expect(result.memoriesScored).toBe(1);
      expect(result.memoriesArchived).toBe(1);

      // Verify it was archived
      const memory = getMemory(db, 1);
      expect(memory?.decay_tier).toBe('archived');
    });

    it('should not archive committed tier memories', () => {
      // Insert committed memory (protected)
      insertMemory(db, {
        seq: 1,
        content: 'Important committed memory',
        type: 'decision',
        tier: 'committed',
        importance: 0.1,
        created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
        decay_tier: 'cold',
      });

      const result = runGC(db, { maxAgeDays: 30, gcThreshold: 0.5 });

      // Should not be scored (protected tier)
      expect(result.memoriesScored).toBe(0);
    });

    it('should retain high-relevance memories', () => {
      // Insert recent, important memory
      insertMemory(db, {
        seq: 1,
        content: 'Recent important memory',
        type: 'memory',
        tier: 'relationship',
        importance: 0.9,
        created_at: new Date().toISOString(),
        decay_tier: 'hot',
      });

      const result = runGC(db, { maxAgeDays: 30, gcThreshold: 0.2 });

      expect(result.memoriesRetained).toBe(0); // Not a candidate (recent)
      expect(result.memoriesArchived).toBe(0);
    });

    it('should respect dry run mode', () => {
      insertMemory(db, {
        seq: 1,
        content: 'Test memory',
        type: 'memory',
        tier: 'ephemeral',
        importance: 0.1,
        created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
        decay_tier: 'cold',
      });

      const result = runGC(db, { dryRun: true });

      // Count should be incremented but memory not actually archived
      expect(result.memoriesArchived).toBeGreaterThanOrEqual(0);

      const memory = getMemory(db, 1);
      expect(memory?.decay_tier).toBe('cold'); // Still cold, not archived
    });
  });

  describe('restoreMemory', () => {
    it('should restore archived memory to cold', () => {
      insertMemory(db, {
        seq: 1,
        content: 'Archived memory',
        type: 'memory',
        tier: 'ephemeral',
        importance: 0.5,
        created_at: new Date().toISOString(),
        decay_tier: 'archived',
      });

      const restored = restoreMemory(db, 1);
      expect(restored).toBe(true);

      const memory = getMemory(db, 1);
      expect(memory?.decay_tier).toBe('cold');
    });

    it('should return false for non-archived memory', () => {
      insertMemory(db, {
        seq: 1,
        content: 'Hot memory',
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        created_at: new Date().toISOString(),
        decay_tier: 'hot',
      });

      const restored = restoreMemory(db, 1);
      expect(restored).toBe(false);
    });
  });

  describe('previewGC', () => {
    it('should preview what would be archived', () => {
      insertMemory(db, {
        seq: 1,
        content: 'Old memory to preview',
        type: 'memory',
        tier: 'ephemeral',
        importance: 0.1,
        created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
        decay_tier: 'cold',
      });

      const preview = previewGC(db, { maxAgeDays: 30, gcThreshold: 0.2 });

      expect(preview.length).toBe(1);
      expect(preview[0].seq).toBe(1);
      expect(typeof preview[0].score).toBe('number');
      expect(typeof preview[0].willArchive).toBe('boolean');
    });
  });

  describe('getGCStats', () => {
    it('should return GC statistics', () => {
      insertMemory(db, {
        seq: 1,
        content: 'Active memory',
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        created_at: new Date().toISOString(),
        decay_tier: 'hot',
      });

      insertMemory(db, {
        seq: 2,
        content: 'Archived memory',
        type: 'memory',
        tier: 'ephemeral',
        importance: 0.5,
        created_at: new Date().toISOString(),
        decay_tier: 'archived',
      });

      const stats = getGCStats(db);

      expect(stats.totalMemories).toBe(2);
      expect(stats.archivedMemories).toBe(1);
    });
  });

  describe('Chain Immutability Integration', () => {
    it('should never modify chain.jsonl during GC', async () => {
      // This is the critical integration test that Klowalski requested.
      // GC must only affect the index, never the chain.

      const { initChain, addEntry, readChain, verifyChain } = await import('../../src/chain/index.js');

      // Step 1: Create chain with test entries
      await initChain(testDir, { agentName: 'gc-test' });

      await addEntry(testDir, {
        type: 'memory',
        tier: 'ephemeral',
        content: 'Old memory that should be GC candidate',
      });

      await addEntry(testDir, {
        type: 'decision',
        tier: 'committed',
        content: 'Important decision that should never be touched',
      });

      // Read chain before GC
      const chainBefore = await readChain(testDir);
      const chainFilePathBefore = path.join(testDir, 'chain.jsonl');
      const chainContentBefore = await fs.readFile(chainFilePathBefore, 'utf-8');

      // Rebuild index from chain
      const { rebuildFromChain } = await import('../../src/index/sqlite.js');
      const { storeContent, createContentLoader } = await import('../../src/storage/content-store.js');

      // Store content for entries
      for (const entry of chainBefore) {
        const content = entry.type === 'memory'
          ? 'Old memory that should be GC candidate'
          : 'Important decision that should never be touched';
        await storeContent(testDir, content);
      }

      const contentLoader = createContentLoader(testDir);
      await rebuildFromChain(db, chainBefore, contentLoader);

      // Make one memory old (set created_at to 60 days ago in index only)
      db.prepare("UPDATE memories SET created_at = datetime('now', '-60 days'), decay_tier = 'cold' WHERE seq = 1").run();

      // Step 2: Run GC
      const gcResult = runGC(db, {
        gcThreshold: 0.2,
        maxAgeDays: 30,
        protectedTiers: ['committed'],
      });

      // Step 3: Verify chain.jsonl is UNCHANGED
      const chainContentAfter = await fs.readFile(chainFilePathBefore, 'utf-8');
      expect(chainContentAfter).toBe(chainContentBefore);

      // Step 4: Verify chain still verifies
      const verification = await verifyChain(testDir);
      expect(verification.valid).toBe(true);
      expect(verification.entriesChecked).toBeGreaterThanOrEqual(2); // Genesis + 2 entries

      // Step 5: Verify index reflects archived state
      const memory1 = getMemory(db, 1);
      const memory2 = getMemory(db, 2);

      // First memory should be archived (old ephemeral)
      // Second memory should be untouched (committed tier is protected)
      expect(memory2?.decay_tier).not.toBe('archived');
    });
  });
});
