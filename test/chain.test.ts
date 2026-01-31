/**
 * Chain Tests
 *
 * Tests for chain initialization, entry addition, and verification.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initChain,
  addEntry,
  readChain,
  verifyChain,
  getLastEntry,
  getChainStats,
} from '../src/chain/index.js';
import {
  sha256Hash,
  generateKeyPair,
  sign,
  verifySignature,
  keyToHex,
  hexToKey,
} from '../src/chain/crypto.js';
import {
  exportChain,
  importChain,
  validateExport,
} from '../src/chain/export.js';

// Test directory
let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `memory-chain-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ============================================================================
// Crypto Tests
// ============================================================================

describe('Crypto', () => {
  it('should hash content consistently', () => {
    const content = 'Hello, World!';
    const hash1 = sha256Hash(content);
    const hash2 = sha256Hash(content);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('should generate different hashes for different content', () => {
    const hash1 = sha256Hash('content1');
    const hash2 = sha256Hash('content2');

    expect(hash1).not.toBe(hash2);
  });

  it('should generate valid key pairs', async () => {
    const { privateKey, publicKey } = await generateKeyPair();

    expect(privateKey).toBeInstanceOf(Uint8Array);
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(privateKey.length).toBe(32);
    expect(publicKey.length).toBe(32);
  });

  it('should sign and verify correctly', async () => {
    const { privateKey, publicKey } = await generateKeyPair();
    const data = 'Test message to sign';

    const signature = await sign(data, privateKey);
    const isValid = await verifySignature(data, signature, publicKey);

    expect(signature).toMatch(/^ed25519:[a-f0-9]{128}$/);
    expect(isValid).toBe(true);
  });

  it('should reject invalid signatures', async () => {
    const { privateKey, publicKey } = await generateKeyPair();
    const data = 'Test message to sign';

    const signature = await sign(data, privateKey);
    const isValid = await verifySignature('Different message', signature, publicKey);

    expect(isValid).toBe(false);
  });

  it('should convert keys to/from hex', async () => {
    const { privateKey } = await generateKeyPair();

    const hex = keyToHex(privateKey);
    const restored = hexToKey(hex);

    expect(hex).toMatch(/^[a-f0-9]{64}$/);
    expect(restored).toEqual(privateKey);
  });
});

// ============================================================================
// Chain Initialization Tests
// ============================================================================

describe('Chain Initialization', () => {
  it('should initialize a new chain', async () => {
    await initChain(testDir, 'TestAgent');

    // Check files exist
    const chainPath = join(testDir, 'chain.jsonl');
    const configPath = join(testDir, 'config.json');
    const privateKeyPath = join(testDir, 'agent.key');
    const publicKeyPath = join(testDir, 'agent.pub');

    const chainContent = await readFile(chainPath, 'utf-8');
    const configContent = await readFile(configPath, 'utf-8');

    expect(chainContent).toBeTruthy();
    expect(configContent).toBeTruthy();

    // Parse and verify genesis entry
    const genesis = JSON.parse(chainContent.trim());
    expect(genesis.seq).toBe(0);
    expect(genesis.type).toBe('identity');
    expect(genesis.tier).toBe('committed');
    expect(genesis.prev_hash).toBeNull();
    expect(genesis.signature).toMatch(/^ed25519:/);

    // Verify config
    const config = JSON.parse(configContent);
    expect(config.agentName).toBe('TestAgent');
    expect(config.version).toBe('1.0.0');
  });

  it('should reject initializing an existing chain', async () => {
    await initChain(testDir, 'TestAgent');

    await expect(initChain(testDir, 'AnotherAgent')).rejects.toThrow(
      /Chain already exists/
    );
  });

  it('should create content directory', async () => {
    await initChain(testDir, 'TestAgent');

    const contentDir = join(testDir, 'content');
    const { stat } = await import('node:fs/promises');
    const stats = await stat(contentDir);

    expect(stats.isDirectory()).toBe(true);
  });
});

// ============================================================================
// Entry Addition Tests
// ============================================================================

describe('Entry Addition', () => {
  beforeEach(async () => {
    await initChain(testDir, 'TestAgent');
  });

  it('should add a memory entry', async () => {
    const entry = await addEntry(testDir, {
      type: 'memory',
      content: 'User prefers dark mode',
    });

    expect(entry.seq).toBe(1);
    expect(entry.type).toBe('memory');
    expect(entry.tier).toBe('relationship'); // Default tier
    expect(entry.content_hash).toMatch(/^sha256:/);
    expect(entry.prev_hash).toMatch(/^sha256:/);
    expect(entry.signature).toMatch(/^ed25519:/);
  });

  it('should increment sequence numbers', async () => {
    const entry1 = await addEntry(testDir, { type: 'memory', content: 'First' });
    const entry2 = await addEntry(testDir, { type: 'memory', content: 'Second' });
    const entry3 = await addEntry(testDir, { type: 'memory', content: 'Third' });

    expect(entry1.seq).toBe(1);
    expect(entry2.seq).toBe(2);
    expect(entry3.seq).toBe(3);
  });

  it('should link entries via prev_hash', async () => {
    const entry1 = await addEntry(testDir, { type: 'memory', content: 'First' });
    const entry2 = await addEntry(testDir, { type: 'memory', content: 'Second' });

    // entry2's prev_hash should be computed from entry1
    expect(entry2.prev_hash).toBeTruthy();
    expect(entry2.prev_hash).not.toBe(entry1.prev_hash);
  });

  it('should support different entry types', async () => {
    const memory = await addEntry(testDir, { type: 'memory', content: 'Memory' });
    const identity = await addEntry(testDir, {
      type: 'identity',
      tier: 'committed',
      content: 'Identity',
    });
    const decision = await addEntry(testDir, {
      type: 'decision',
      tier: 'committed',
      content: 'Decision',
    });

    expect(memory.type).toBe('memory');
    expect(identity.type).toBe('identity');
    expect(decision.type).toBe('decision');
  });

  it('should support different tiers', async () => {
    const committed = await addEntry(testDir, {
      type: 'memory',
      tier: 'committed',
      content: 'Committed',
    });
    const relationship = await addEntry(testDir, {
      type: 'memory',
      tier: 'relationship',
      content: 'Relationship',
    });

    expect(committed.tier).toBe('committed');
    expect(relationship.tier).toBe('relationship');
  });

  it('should store content in content directory', async () => {
    const content = 'Test content for storage';
    await addEntry(testDir, { type: 'memory', content });

    const contentHash = sha256Hash(content);
    const hashHex = contentHash.slice(7); // Remove "sha256:" prefix
    const contentPath = join(testDir, 'content', hashHex);

    const storedContent = await readFile(contentPath, 'utf-8');
    expect(storedContent).toBe(content);
  });
});

// ============================================================================
// Chain Reading Tests
// ============================================================================

describe('Chain Reading', () => {
  beforeEach(async () => {
    await initChain(testDir, 'TestAgent');
  });

  it('should read all entries', async () => {
    await addEntry(testDir, { type: 'memory', content: 'First' });
    await addEntry(testDir, { type: 'memory', content: 'Second' });

    const entries = await readChain(testDir);

    expect(entries.length).toBe(3); // Genesis + 2 entries
    expect(entries[0].seq).toBe(0);
    expect(entries[1].seq).toBe(1);
    expect(entries[2].seq).toBe(2);
  });

  it('should get last entry', async () => {
    await addEntry(testDir, { type: 'memory', content: 'First' });
    await addEntry(testDir, { type: 'memory', content: 'Second' });

    const last = await getLastEntry(testDir);

    expect(last).not.toBeNull();
    expect(last!.seq).toBe(2);
  });

  it('should return empty array for non-existent chain', async () => {
    const nonExistent = join(testDir, 'nonexistent');
    const entries = await readChain(nonExistent);

    expect(entries).toEqual([]);
  });
});

// ============================================================================
// Chain Verification Tests
// ============================================================================

describe('Chain Verification', () => {
  beforeEach(async () => {
    await initChain(testDir, 'TestAgent');
    await addEntry(testDir, { type: 'memory', content: 'First' });
    await addEntry(testDir, { type: 'memory', content: 'Second' });
  });

  it('should verify a valid chain', async () => {
    const result = await verifyChain(testDir);

    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect hash chain tampering', async () => {
    // Manually modify the chain file
    const chainPath = join(testDir, 'chain.jsonl');
    const content = await readFile(chainPath, 'utf-8');
    const lines = content.trim().split('\n');

    // Modify the content_hash of the second entry
    const entry = JSON.parse(lines[1]);
    entry.content_hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    lines[1] = JSON.stringify(entry);

    const { writeFile } = await import('node:fs/promises');
    await writeFile(chainPath, lines.join('\n') + '\n');

    const result = await verifyChain(testDir);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.type === 'signature_invalid')).toBe(true);
  });

  it('should detect prev_hash tampering', async () => {
    const chainPath = join(testDir, 'chain.jsonl');
    const content = await readFile(chainPath, 'utf-8');
    const lines = content.trim().split('\n');

    // Modify the prev_hash of the third entry
    const entry = JSON.parse(lines[2]);
    entry.prev_hash = 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    lines[2] = JSON.stringify(entry);

    const { writeFile } = await import('node:fs/promises');
    await writeFile(chainPath, lines.join('\n') + '\n');

    const result = await verifyChain(testDir);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === 'hash_mismatch')).toBe(true);
  });

  it('should detect content file tampering', async () => {
    // Read the chain to get the content_hash of an entry
    const chainPath = join(testDir, 'chain.jsonl');
    const content = await readFile(chainPath, 'utf-8');
    const lines = content.trim().split('\n');
    const entry = JSON.parse(lines[1]); // First entry after genesis

    // Extract the hash hex (remove "sha256:" prefix)
    const hashHex = entry.content_hash.slice(7);
    const contentFilePath = join(testDir, 'content', hashHex);

    // Tamper with the content file (replace content with different content)
    const { writeFile } = await import('node:fs/promises');
    await writeFile(contentFilePath, 'I am FAKE content - tampered!');

    const result = await verifyChain(testDir);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.type === 'content_mismatch')).toBe(true);
    expect(result.errors.some((e) => e.message.includes('Content tampered'))).toBe(true);
  });

  it('should not fail for missing content (could be redacted)', async () => {
    // Read the chain to get the content_hash of an entry
    const chainPath = join(testDir, 'chain.jsonl');
    const content = await readFile(chainPath, 'utf-8');
    const lines = content.trim().split('\n');
    const entry = JSON.parse(lines[1]); // First entry after genesis

    // Extract the hash hex and delete the content file
    const hashHex = entry.content_hash.slice(7);
    const contentFilePath = join(testDir, 'content', hashHex);

    const { unlink } = await import('node:fs/promises');
    await unlink(contentFilePath);

    // Missing content is allowed (could be intentional redaction)
    const result = await verifyChain(testDir);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should provide summary statistics', async () => {
    const result = await verifyChain(testDir);

    expect(result.summary.totalEntries).toBe(3);
    expect(result.summary.firstEntry).toBe(0);
    expect(result.summary.lastEntry).toBe(2);
  });
});

// ============================================================================
// Chain Statistics Tests
// ============================================================================

describe('Chain Statistics', () => {
  beforeEach(async () => {
    await initChain(testDir, 'TestAgent');
    await addEntry(testDir, { type: 'memory', tier: 'relationship', content: 'Memory 1' });
    await addEntry(testDir, { type: 'memory', tier: 'relationship', content: 'Memory 2' });
    await addEntry(testDir, { type: 'decision', tier: 'committed', content: 'Decision' });
  });

  it('should return correct statistics', async () => {
    const stats = await getChainStats(testDir);

    expect(stats.totalEntries).toBe(4); // Genesis + 3 entries
    expect(stats.byType.identity).toBe(1);
    expect(stats.byType.memory).toBe(2);
    expect(stats.byType.decision).toBe(1);
    expect(stats.byTier.committed).toBe(2); // Genesis + Decision
    expect(stats.byTier.relationship).toBe(2);
  });
});

// ============================================================================
// Concurrent Access Tests
// ============================================================================

describe('Concurrent Access', () => {
  beforeEach(async () => {
    await initChain(testDir, 'TestAgent');
  });

  it('should handle concurrent additions with locking', async () => {
    // Add 10 entries concurrently
    const promises = Array.from({ length: 10 }, (_, i) =>
      addEntry(testDir, { type: 'memory', content: `Entry ${i}` })
    );

    const entries = await Promise.all(promises);

    // All entries should have unique sequence numbers
    const seqs = entries.map((e) => e.seq);
    const uniqueSeqs = new Set(seqs);

    expect(uniqueSeqs.size).toBe(10);

    // Verify chain integrity
    const result = await verifyChain(testDir);
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(11); // Genesis + 10 entries
  });
});

// ============================================================================
// Input Validation Tests
// ============================================================================

describe('Input Validation', () => {
  it('should reject content exceeding maximum size', async () => {
    await initChain(testDir, 'TestAgent');

    const largeContent = 'x'.repeat(1024 * 1024 + 1); // 1MB + 1 byte

    await expect(
      addEntry(testDir, { type: 'memory', content: largeContent })
    ).rejects.toThrow(/exceeds maximum size/);
  });

  it('should accept content at maximum size', async () => {
    await initChain(testDir, 'TestAgent');

    const maxContent = 'x'.repeat(1024 * 1024); // Exactly 1MB

    const entry = await addEntry(testDir, { type: 'memory', content: maxContent });
    expect(entry.seq).toBe(1);
  });

  it('should reject agent names exceeding maximum length', async () => {
    const longName = 'x'.repeat(257);

    await expect(initChain(testDir, longName)).rejects.toThrow(/exceeds maximum length/);
  });

  it('should reject empty agent names', async () => {
    await expect(initChain(testDir, '')).rejects.toThrow(/cannot be empty/);
  });

  it('should reject metadata with invalid values', async () => {
    await initChain(testDir, 'TestAgent');

    await expect(
      addEntry(testDir, {
        type: 'memory',
        content: 'test',
        metadata: { func: (() => {}) as unknown as string },
      })
    ).rejects.toThrow(/Invalid metadata value type/);
  });

  it('should reject metadata with non-finite numbers', async () => {
    await initChain(testDir, 'TestAgent');

    await expect(
      addEntry(testDir, {
        type: 'memory',
        content: 'test',
        metadata: { value: Infinity },
      })
    ).rejects.toThrow(/must be finite/);
  });

  it('should reject metadata with deeply nested objects', async () => {
    await initChain(testDir, 'TestAgent');

    // Create deeply nested object (7 levels, exceeds max depth of 5)
    const deepNested = { a: { b: { c: { d: { e: { f: { g: 'too deep' } } } } } } };

    await expect(
      addEntry(testDir, {
        type: 'memory',
        content: 'test',
        metadata: deepNested,
      })
    ).rejects.toThrow(/exceeds maximum nesting depth/);
  });

  it('should accept valid metadata with nested structures', async () => {
    await initChain(testDir, 'TestAgent');

    const validMetadata = {
      string: 'hello',
      number: 42,
      boolean: true,
      null: null,
      array: [1, 'two', true],
      nested: { a: { b: { c: 'ok' } } }, // 4 levels is OK
    };

    const entry = await addEntry(testDir, {
      type: 'memory',
      content: 'test',
      metadata: validMetadata,
    });

    expect(entry.metadata).toEqual(validMetadata);
  });

  it('should reject metadata with very long strings', async () => {
    await initChain(testDir, 'TestAgent');

    const longString = 'x'.repeat(10001);

    await expect(
      addEntry(testDir, {
        type: 'memory',
        content: 'test',
        metadata: { value: longString },
      })
    ).rejects.toThrow(/exceeds maximum length/);
  });
});

// ============================================================================
// Export/Import Tests
// ============================================================================

describe('Chain Export/Import', () => {
  beforeEach(async () => {
    await initChain(testDir, 'TestAgent');
    await addEntry(testDir, { type: 'memory', content: 'Memory 1' });
    await addEntry(testDir, { type: 'memory', content: 'Memory 2' });
  });

  it('should export chain with content', async () => {
    const exportData = await exportChain(testDir, { includeContent: true });

    expect(exportData.config.agentName).toBe('TestAgent');
    expect(exportData.entries.length).toBe(3); // Genesis + 2 entries
    expect(exportData.content).toBeDefined();
    expect(Object.keys(exportData.content!).length).toBeGreaterThan(0);
    expect(exportData.exportedAt).toBeDefined();
  });

  it('should export chain without content', async () => {
    const exportData = await exportChain(testDir, { includeContent: false });

    expect(exportData.entries.length).toBe(3);
    expect(exportData.content).toBeUndefined();
  });

  it('should filter export by sequence range', async () => {
    const exportData = await exportChain(testDir, { fromSeq: 1, toSeq: 2 });

    expect(exportData.entries.length).toBe(2);
    expect(exportData.entries[0].seq).toBe(1);
    expect(exportData.entries[1].seq).toBe(2);
  });

  it('should validate export data', async () => {
    const exportData = await exportChain(testDir);
    const errors = await validateExport(exportData);

    expect(errors.length).toBe(0);
  });

  it('should detect validation errors in invalid export', async () => {
    const invalidExport = {
      config: { agentName: 'Test', keyMode: 'raw' as const, createdAt: '', version: '1.0.0' },
      entries: [
        { seq: 0, ts: '', type: 'memory' as const, tier: 'committed' as const, content_hash: 'sha256:abc', prev_hash: null, signature: 'ed25519:sig' },
        { seq: 2, ts: '', type: 'memory' as const, tier: 'committed' as const, content_hash: 'sha256:def', prev_hash: 'sha256:abc', signature: 'ed25519:sig' }, // Gap in sequence
      ],
      exportedAt: '',
    };

    const errors = await validateExport(invalidExport);
    expect(errors.some((e) => e.includes('Sequence gap'))).toBe(true);
  });

  it('should import chain to new directory', async () => {
    const exportData = await exportChain(testDir, { includeContent: true });

    const importDir = join(testDir, 'imported');
    const result = await importChain(exportData, importDir);

    expect(result.success).toBe(true);
    expect(result.entriesImported).toBe(3);
    expect(result.contentImported).toBeGreaterThan(0);

    // Verify imported chain
    const verifyResult = await verifyChain(importDir);
    expect(verifyResult.valid).toBe(true);
  });

  it('should reject import to existing chain without overwrite', async () => {
    const exportData = await exportChain(testDir);

    // Try to import to same directory (already has a chain)
    const result = await importChain(exportData, testDir);

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes('already contains'))).toBe(true);
  });

  it('should allow import with overwrite option', async () => {
    const exportData = await exportChain(testDir, { includeContent: true });

    const result = await importChain(exportData, testDir, { overwrite: true });

    expect(result.success).toBe(true);
  });
});
