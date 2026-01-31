/**
 * Content Store Tests
 *
 * Tests for content-addressable storage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  storeContent,
  getContent,
  getContentVerified,
  contentExists,
  deleteContent,
  verifyContent,
  listContent,
  getStorageStats,
  createContentLoader,
  ContentIntegrityError,
} from '../src/storage/content-store.js';
import { sha256Hash, extractHashHex } from '../src/chain/crypto.js';

// Test directory
let contentDir: string;

beforeEach(async () => {
  contentDir = join(tmpdir(), `memory-chain-content-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(contentDir, { recursive: true });
});

afterEach(async () => {
  await rm(contentDir, { recursive: true, force: true });
});

// ============================================================================
// Storage Tests
// ============================================================================

describe('Content Storage', () => {
  it('should store content and return hash', async () => {
    const content = 'Test content for storage';
    const hash = await storeContent(contentDir, content);

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);

    // Verify hash matches content
    const expectedHash = sha256Hash(content);
    expect(hash).toBe(expectedHash);
  });

  it('should retrieve stored content', async () => {
    const content = 'Test content for retrieval';
    const hash = await storeContent(contentDir, content);

    const retrieved = await getContent(contentDir, hash);
    expect(retrieved).toBe(content);
  });

  it('should return null for non-existent content', async () => {
    const fakeHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    const content = await getContent(contentDir, fakeHash);

    expect(content).toBeNull();
  });

  it('should be idempotent (storing same content twice)', async () => {
    const content = 'Duplicate content';

    const hash1 = await storeContent(contentDir, content);
    const hash2 = await storeContent(contentDir, content);

    expect(hash1).toBe(hash2);

    // Should only have one file
    const files = await listContent(contentDir);
    expect(files.length).toBe(1);
  });

  it('should handle content with special characters', async () => {
    const content = 'Content with special chars: 日本語 émojis 🎉 newlines\n\ttabs';
    const hash = await storeContent(contentDir, content);

    const retrieved = await getContent(contentDir, hash);
    expect(retrieved).toBe(content);
  });

  it('should handle large content', async () => {
    const content = 'x'.repeat(1000000); // 1MB
    const hash = await storeContent(contentDir, content);

    const retrieved = await getContent(contentDir, hash);
    expect(retrieved).toBe(content);
  });
});

// ============================================================================
// Content Existence Tests
// ============================================================================

describe('Content Existence', () => {
  it('should return true for existing content', async () => {
    const content = 'Test content';
    const hash = await storeContent(contentDir, content);

    const exists = await contentExists(contentDir, hash);
    expect(exists).toBe(true);
  });

  it('should return false for non-existent content', async () => {
    const fakeHash = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
    const exists = await contentExists(contentDir, fakeHash);

    expect(exists).toBe(false);
  });

  it('should work with hash without prefix', async () => {
    const content = 'Test content';
    const hash = await storeContent(contentDir, content);
    const hashHex = extractHashHex(hash);

    const exists = await contentExists(contentDir, hashHex);
    expect(exists).toBe(true);
  });
});

// ============================================================================
// Deletion Tests
// ============================================================================

describe('Content Deletion', () => {
  it('should delete content', async () => {
    const content = 'Content to delete';
    const hash = await storeContent(contentDir, content);

    // Verify exists
    expect(await contentExists(contentDir, hash)).toBe(true);

    // Delete
    await deleteContent(contentDir, hash);

    // Verify deleted
    expect(await contentExists(contentDir, hash)).toBe(false);
    expect(await getContent(contentDir, hash)).toBeNull();
  });

  it('should not error when deleting non-existent content', async () => {
    const fakeHash = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';

    // Should not throw
    await expect(deleteContent(contentDir, fakeHash)).resolves.toBeUndefined();
  });
});

// ============================================================================
// Verification Tests
// ============================================================================

describe('Content Verification', () => {
  it('should verify content integrity', async () => {
    const content = 'Content to verify';
    const hash = await storeContent(contentDir, content);

    const isValid = await verifyContent(contentDir, hash);
    expect(isValid).toBe(true);
  });

  it('should detect tampered content', async () => {
    const content = 'Original content';
    const hash = await storeContent(contentDir, content);

    // Tamper with the file
    const hashHex = extractHashHex(hash);
    const filePath = join(contentDir, hashHex);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(filePath, 'Tampered content');

    const isValid = await verifyContent(contentDir, hash);
    expect(isValid).toBe(false);
  });

  it('should return false for missing content', async () => {
    const fakeHash = 'sha256:3333333333333333333333333333333333333333333333333333333333333333';
    const isValid = await verifyContent(contentDir, fakeHash);

    expect(isValid).toBe(false);
  });
});

// ============================================================================
// Listing Tests
// ============================================================================

describe('Content Listing', () => {
  it('should list all content hashes', async () => {
    await storeContent(contentDir, 'Content 1');
    await storeContent(contentDir, 'Content 2');
    await storeContent(contentDir, 'Content 3');

    const hashes = await listContent(contentDir);

    expect(hashes.length).toBe(3);
    expect(hashes.every((h) => /^[a-f0-9]{64}$/.test(h))).toBe(true);
  });

  it('should return empty array for empty directory', async () => {
    const hashes = await listContent(contentDir);
    expect(hashes).toEqual([]);
  });

  it('should filter out non-hash files', async () => {
    await storeContent(contentDir, 'Content');

    // Create a non-hash file
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(contentDir, 'not-a-hash.txt'), 'garbage');

    const hashes = await listContent(contentDir);

    expect(hashes.length).toBe(1);
    expect(hashes.every((h) => /^[a-f0-9]{64}$/.test(h))).toBe(true);
  });
});

// ============================================================================
// Statistics Tests
// ============================================================================

describe('Storage Statistics', () => {
  it('should return correct statistics', async () => {
    await storeContent(contentDir, 'A'.repeat(100));
    await storeContent(contentDir, 'B'.repeat(200));
    await storeContent(contentDir, 'C'.repeat(300));

    const stats = await getStorageStats(contentDir);

    expect(stats.totalFiles).toBe(3);
    expect(stats.totalBytes).toBe(600);
  });

  it('should handle empty directory', async () => {
    const stats = await getStorageStats(contentDir);

    expect(stats.totalFiles).toBe(0);
    expect(stats.totalBytes).toBe(0);
  });
});

// ============================================================================
// Content Loader Tests
// ============================================================================

describe('Content Loader', () => {
  it('should create working content loader', async () => {
    const content1 = 'First content';
    const content2 = 'Second content';

    const hash1 = await storeContent(contentDir, content1);
    const hash2 = await storeContent(contentDir, content2);

    const loader = createContentLoader(contentDir);

    const loaded1 = await loader(hash1);
    const loaded2 = await loader(hash2);

    expect(loaded1).toBe(content1);
    expect(loaded2).toBe(content2);
  });

  it('should return null for missing content', async () => {
    const loader = createContentLoader(contentDir);
    const fakeHash = 'sha256:4444444444444444444444444444444444444444444444444444444444444444';

    const loaded = await loader(fakeHash);
    expect(loaded).toBeNull();
  });

  it('should support verify option', async () => {
    const content = 'Content to verify with loader';
    const hash = await storeContent(contentDir, content);

    const loader = createContentLoader(contentDir, { verify: true });
    const loaded = await loader(hash);

    expect(loaded).toBe(content);
  });
});

// ============================================================================
// Verified Content Retrieval Tests
// ============================================================================

describe('Verified Content Retrieval', () => {
  it('should retrieve and verify content with getContent verify option', async () => {
    const content = 'Content for verification';
    const hash = await storeContent(contentDir, content);

    const retrieved = await getContent(contentDir, hash, { verify: true });
    expect(retrieved).toBe(content);
  });

  it('should retrieve and verify content with getContentVerified', async () => {
    const content = 'Content for verified retrieval';
    const hash = await storeContent(contentDir, content);

    const retrieved = await getContentVerified(contentDir, hash);
    expect(retrieved).toBe(content);
  });

  it('should throw ContentIntegrityError on tampered content', async () => {
    const content = 'Original content for tampering test';
    const hash = await storeContent(contentDir, content);

    // Tamper with the file
    const hashHex = extractHashHex(hash);
    const filePath = join(contentDir, hashHex);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(filePath, 'Tampered content');

    await expect(
      getContentVerified(contentDir, hash)
    ).rejects.toThrow(ContentIntegrityError);
  });

  it('should return null for missing content even with verify', async () => {
    const fakeHash = 'sha256:5555555555555555555555555555555555555555555555555555555555555555';

    const retrieved = await getContentVerified(contentDir, fakeHash);
    expect(retrieved).toBeNull();
  });

  it('should work with hash without prefix', async () => {
    const content = 'Content without prefix';
    const hash = await storeContent(contentDir, content);
    const hashHex = extractHashHex(hash);

    const retrieved = await getContentVerified(contentDir, hashHex);
    expect(retrieved).toBe(content);
  });
});
