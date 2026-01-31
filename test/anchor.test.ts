/**
 * Anchor Tests
 *
 * Tests for OpenTimestamps anchoring functionality.
 * Note: These tests mock network calls since actual OTS submission requires calendar servers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initChain, addEntry, readChain } from '../src/chain/index.js';
import { hashEntry } from '../src/chain/crypto.js';
import {
  submitAnchor,
  getAnchorStatus,
  hasAnchor,
  getUnanchoredEntries,
  verifyAnchor,
} from '../src/anchor/opentimestamps.js';
import type { AnchorRecord, PendingAnchorsFile } from '../src/anchor/types.js';

// Test directory
let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `memory-chain-anchor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ============================================================================
// Anchor Types Tests
// ============================================================================

describe('Anchor Types', () => {
  it('should have correct PendingAnchorsFile structure', async () => {
    await initChain(testDir, 'TestAgent');

    const anchorsDir = join(testDir, 'anchors');
    await mkdir(anchorsDir, { recursive: true });

    const pending: PendingAnchorsFile = {
      version: 1,
      anchors: [
        {
          seq: 1,
          entryHash: 'sha256:abc123',
          status: 'pending',
          submittedAt: new Date().toISOString(),
        },
      ],
      lastCheck: new Date().toISOString(),
    };

    await writeFile(join(anchorsDir, 'pending.json'), JSON.stringify(pending));

    const content = await readFile(join(anchorsDir, 'pending.json'), 'utf-8');
    const parsed = JSON.parse(content) as PendingAnchorsFile;

    expect(parsed.version).toBe(1);
    expect(parsed.anchors).toHaveLength(1);
    expect(parsed.anchors[0].seq).toBe(1);
    expect(parsed.anchors[0].status).toBe('pending');
  });
});

// ============================================================================
// Has Anchor Tests
// ============================================================================

describe('hasAnchor', () => {
  beforeEach(async () => {
    await initChain(testDir, 'TestAgent');
    await addEntry(testDir, { type: 'memory', content: 'Test memory' });
  });

  it('should return false when no anchor exists', async () => {
    const result = await hasAnchor(testDir, 1);
    expect(result).toBe(false);
  });

  it('should return true when anchor file exists', async () => {
    // Create a mock .ots file
    const anchorsDir = join(testDir, 'anchors');
    await mkdir(anchorsDir, { recursive: true });
    await writeFile(join(anchorsDir, 'entry-1.ots'), 'mock ots data');

    const result = await hasAnchor(testDir, 1);
    expect(result).toBe(true);
  });
});

// ============================================================================
// Get Unanchored Entries Tests
// ============================================================================

describe('getUnanchoredEntries', () => {
  beforeEach(async () => {
    await initChain(testDir, 'TestAgent');
    await addEntry(testDir, { type: 'memory', content: 'Memory 1' });
    await addEntry(testDir, { type: 'memory', content: 'Memory 2' });
    await addEntry(testDir, { type: 'memory', content: 'Memory 3' });
  });

  it('should return all entries when none are anchored', async () => {
    const entries = await readChain(testDir);
    const unanchored = await getUnanchoredEntries(testDir, entries);

    expect(unanchored.length).toBe(4); // Genesis + 3 entries
  });

  it('should exclude anchored entries', async () => {
    // Create mock anchor for entry 1
    const anchorsDir = join(testDir, 'anchors');
    await mkdir(anchorsDir, { recursive: true });
    await writeFile(join(anchorsDir, 'entry-1.ots'), 'mock ots data');

    const entries = await readChain(testDir);
    const unanchored = await getUnanchoredEntries(testDir, entries);

    expect(unanchored.length).toBe(3);
    expect(unanchored.every((e) => e.seq !== 1)).toBe(true);
  });
});

// ============================================================================
// Get Anchor Status Tests
// ============================================================================

describe('getAnchorStatus', () => {
  beforeEach(async () => {
    await initChain(testDir, 'TestAgent');
  });

  it('should return empty status when no anchors exist', async () => {
    const status = await getAnchorStatus(testDir);

    expect(status.total).toBe(0);
    expect(status.pending).toBe(0);
    expect(status.confirmed).toBe(0);
    expect(status.failed).toBe(0);
    expect(status.anchors).toHaveLength(0);
  });

  it('should count anchors with pending.json records', async () => {
    const anchorsDir = join(testDir, 'anchors');
    await mkdir(anchorsDir, { recursive: true });

    // Create mock .ots files
    await writeFile(join(anchorsDir, 'entry-0.ots'), 'mock');
    await writeFile(join(anchorsDir, 'entry-1.ots'), 'mock');

    // Create pending.json with records
    const pending: PendingAnchorsFile = {
      version: 1,
      anchors: [
        {
          seq: 0,
          entryHash: 'sha256:abc',
          status: 'pending',
          submittedAt: new Date().toISOString(),
        },
        {
          seq: 1,
          entryHash: 'sha256:def',
          status: 'confirmed',
          submittedAt: new Date().toISOString(),
          confirmedAt: new Date().toISOString(),
        },
      ],
    };
    await writeFile(join(anchorsDir, 'pending.json'), JSON.stringify(pending));

    const status = await getAnchorStatus(testDir);

    expect(status.total).toBe(2);
    expect(status.pending).toBe(1);
    expect(status.confirmed).toBe(1);
  });
});

// ============================================================================
// Verify Anchor Tests (with mock data)
// ============================================================================

describe('verifyAnchor', () => {
  beforeEach(async () => {
    await initChain(testDir, 'TestAgent');
    await addEntry(testDir, { type: 'memory', content: 'Test memory' });
  });

  it('should return error when no anchor file exists', async () => {
    const result = await verifyAnchor(testDir, 1);

    expect(result.valid).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('No anchor file found');
  });
});

// ============================================================================
// Entry Hash Tests
// ============================================================================

describe('Entry Hashing for Anchors', () => {
  beforeEach(async () => {
    await initChain(testDir, 'TestAgent');
  });

  it('should generate consistent entry hashes', async () => {
    await addEntry(testDir, { type: 'memory', content: 'Test memory' });
    const entries = await readChain(testDir);
    const entry = entries[1];

    const hash1 = hashEntry(entry);
    const hash2 = hashEntry(entry);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('should generate different hashes for different entries', async () => {
    await addEntry(testDir, { type: 'memory', content: 'Memory 1' });
    await addEntry(testDir, { type: 'memory', content: 'Memory 2' });
    const entries = await readChain(testDir);

    const hash1 = hashEntry(entries[1]);
    const hash2 = hashEntry(entries[2]);

    expect(hash1).not.toBe(hash2);
  });
});

// ============================================================================
// Submit Anchor Tests (Integration - requires network)
// ============================================================================

describe('submitAnchor (integration)', () => {
  beforeEach(async () => {
    await initChain(testDir, 'TestAgent');
    await addEntry(testDir, { type: 'memory', content: 'Test memory for anchoring' });
  });

  // This test actually contacts OTS servers - skip in CI or when offline
  it.skip('should submit entry to OpenTimestamps calendars', async () => {
    const entries = await readChain(testDir);
    const entry = entries[1];

    const result = await submitAnchor(testDir, entry);

    expect(result.success).toBe(true);
    expect(result.seq).toBe(1);
    expect(result.otsPath).toBeDefined();

    // Check that .ots file was created
    const otsExists = await hasAnchor(testDir, 1);
    expect(otsExists).toBe(true);

    // Check pending record was created
    const status = await getAnchorStatus(testDir);
    expect(status.total).toBe(1);
    expect(status.pending).toBe(1);
  }, 30000); // 30s timeout for network request

  it('should reject already anchored entries', async () => {
    // Create mock anchor
    const anchorsDir = join(testDir, 'anchors');
    await mkdir(anchorsDir, { recursive: true });
    await writeFile(join(anchorsDir, 'entry-1.ots'), 'mock ots data');

    const entries = await readChain(testDir);
    const entry = entries[1];

    const result = await submitAnchor(testDir, entry);

    expect(result.success).toBe(false);
    expect(result.error).toContain('already anchored');
  });
});

// ============================================================================
// Anchors Directory Tests
// ============================================================================

describe('Anchors Directory', () => {
  beforeEach(async () => {
    await initChain(testDir, 'TestAgent');
  });

  it('should create anchors directory on first anchor operation', async () => {
    // Just check status - should create directory
    await getAnchorStatus(testDir);

    const anchorsDir = join(testDir, 'anchors');
    const files = await readdir(testDir);

    expect(files).toContain('anchors');
  });

  it('should store .ots files with correct naming convention', async () => {
    const anchorsDir = join(testDir, 'anchors');
    await mkdir(anchorsDir, { recursive: true });

    // Create some mock .ots files
    await writeFile(join(anchorsDir, 'entry-0.ots'), 'data');
    await writeFile(join(anchorsDir, 'entry-1.ots'), 'data');
    await writeFile(join(anchorsDir, 'entry-99.ots'), 'data');

    const files = await readdir(anchorsDir);
    const otsFiles = files.filter((f) => f.endsWith('.ots'));

    expect(otsFiles).toContain('entry-0.ots');
    expect(otsFiles).toContain('entry-1.ots');
    expect(otsFiles).toContain('entry-99.ots');
  });
});
