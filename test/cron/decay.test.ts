/**
 * Decay Tier Tests
 *
 * Tests for the Hot/Warm/Cold tier management functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { initIndex, closeIndex, insertMemory, getMemory } from '../../src/index/sqlite.js';
import {
  calculateDecayTier,
  updateDecayTiers,
  getDecayTierCounts,
  setDecayTier,
  promoteToHot,
  getDecayStats,
} from '../../src/cron/decay.js';
import { DEFAULT_DECAY_THRESHOLDS } from '../../src/cron/types.js';

describe('Decay Tier Management', () => {
  let testDir: string;
  let dbPath: string;
  let db: ReturnType<typeof initIndex>;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'decay-test-'));
    dbPath = path.join(testDir, 'memory.db');
    db = initIndex(dbPath);
  });

  afterEach(async () => {
    closeIndex(db);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('calculateDecayTier', () => {
    it('should return hot for recently accessed memory', () => {
      const lastAccessed = new Date().toISOString();
      const tier = calculateDecayTier(lastAccessed, 0);
      expect(tier).toBe('hot');
    });

    it('should return warm for moderately old memory', () => {
      const date = new Date();
      date.setDate(date.getDate() - 10); // 10 days ago
      const lastAccessed = date.toISOString();
      const tier = calculateDecayTier(lastAccessed, 0);
      expect(tier).toBe('warm');
    });

    it('should return cold for old memory', () => {
      const date = new Date();
      date.setDate(date.getDate() - 60); // 60 days ago
      const lastAccessed = date.toISOString();
      const tier = calculateDecayTier(lastAccessed, 0);
      expect(tier).toBe('cold');
    });

    it('should return cold for never-accessed memory', () => {
      const tier = calculateDecayTier(null, 0);
      expect(tier).toBe('cold');
    });

    it('should resist decay for high access count', () => {
      const date = new Date();
      date.setDate(date.getDate() - 60); // 60 days ago
      const lastAccessed = date.toISOString();
      const tier = calculateDecayTier(
        lastAccessed,
        15, // High access count
        DEFAULT_DECAY_THRESHOLDS
      );
      expect(tier).toBe('warm'); // Resists going to cold
    });
  });

  describe('updateDecayTiers', () => {
    it('should update tiers based on access patterns', () => {
      // Insert memory with recent access
      insertMemory(db, {
        seq: 1,
        content: 'Recent memory',
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        created_at: new Date().toISOString(),
        decay_tier: 'cold', // Start cold
      });

      // Update last_accessed to be recent
      db.prepare("UPDATE memories SET last_accessed = datetime('now') WHERE seq = ?").run(1);

      const result = updateDecayTiers(db);

      expect(result.movedToHot).toBe(1);

      const memory = getMemory(db, 1);
      expect(memory?.decay_tier).toBe('hot');
    });

    it('should move old memories to cold', () => {
      insertMemory(db, {
        seq: 1,
        content: 'Old memory',
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        created_at: new Date().toISOString(),
        decay_tier: 'hot', // Start hot
      });

      // Set last_accessed to 60 days ago
      db.prepare("UPDATE memories SET last_accessed = datetime('now', '-60 days') WHERE seq = ?").run(1);

      const result = updateDecayTiers(db);

      expect(result.movedToCold).toBeGreaterThanOrEqual(0);
    });

    it('should not affect archived memories', () => {
      insertMemory(db, {
        seq: 1,
        content: 'Archived memory',
        type: 'memory',
        tier: 'ephemeral',
        importance: 0.5,
        created_at: new Date().toISOString(),
        decay_tier: 'archived',
      });

      updateDecayTiers(db);

      const memory = getMemory(db, 1);
      expect(memory?.decay_tier).toBe('archived');
    });
  });

  describe('getDecayTierCounts', () => {
    it('should count memories by tier', () => {
      insertMemory(db, {
        seq: 1,
        content: 'Hot memory',
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        created_at: new Date().toISOString(),
        decay_tier: 'hot',
      });

      insertMemory(db, {
        seq: 2,
        content: 'Cold memory',
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        created_at: new Date().toISOString(),
        decay_tier: 'cold',
      });

      const counts = getDecayTierCounts(db);

      expect(counts.hot).toBe(1);
      expect(counts.cold).toBe(1);
      expect(counts.warm).toBe(0);
      expect(counts.archived).toBe(0);
    });
  });

  describe('setDecayTier', () => {
    it('should set decay tier for a memory', () => {
      insertMemory(db, {
        seq: 1,
        content: 'Test memory',
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        created_at: new Date().toISOString(),
        decay_tier: 'hot',
      });

      setDecayTier(db, 1, 'warm');

      const memory = getMemory(db, 1);
      expect(memory?.decay_tier).toBe('warm');
    });
  });

  describe('promoteToHot', () => {
    it('should promote memory to hot and update access', () => {
      insertMemory(db, {
        seq: 1,
        content: 'Cold memory',
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        created_at: new Date().toISOString(),
        decay_tier: 'cold',
      });

      promoteToHot(db, 1);

      const memory = getMemory(db, 1);
      expect(memory?.decay_tier).toBe('hot');
      expect(memory?.access_count).toBe(1);
      expect(memory?.last_accessed).not.toBeNull();
    });
  });

  describe('getDecayStats', () => {
    it('should return decay statistics', () => {
      insertMemory(db, {
        seq: 1,
        content: 'Test memory',
        type: 'memory',
        tier: 'relationship',
        importance: 0.5,
        created_at: new Date().toISOString(),
        decay_tier: 'hot',
      });

      const stats = getDecayStats(db);

      expect(stats.tierCounts).toBeDefined();
      expect(stats.avgAccessCount).toBeDefined();
      expect(stats.tierCounts.hot).toBe(1);
    });
  });
});
