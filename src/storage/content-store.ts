/**
 * Content-Addressable Storage
 *
 * Stores content separately from the chain, named by SHA-256 hash.
 * This enables:
 * - Deduplication (same content = same hash)
 * - Redaction (delete content file, chain entry remains)
 * - Efficient storage (content loaded on demand)
 */

import { readFile, writeFile, unlink, access, constants, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hash, extractHashHex } from '../chain/crypto.js';
import type { ContentOptions } from '../types.js';

/** Error thrown when content verification fails */
export class ContentIntegrityError extends Error {
  constructor(
    public readonly expectedHash: string,
    public readonly actualHash: string
  ) {
    super(`Content integrity check failed: expected ${expectedHash}, got ${actualHash}`);
    this.name = 'ContentIntegrityError';
  }
}

// ============================================================================
// Content Storage
// ============================================================================

/**
 * Store content and return its hash
 *
 * @param contentDir - Directory for content files
 * @param content - Content to store
 * @returns Content hash in "sha256:hex" format
 */
export async function storeContent(contentDir: string, content: string): Promise<string> {
  const hash = sha256Hash(content);
  const hashHex = extractHashHex(hash);
  const filePath = join(contentDir, hashHex);

  // Only write if doesn't exist (content-addressable = idempotent)
  try {
    await access(filePath, constants.F_OK);
    // File exists, content is already stored
  } catch {
    // File doesn't exist, write it
    await writeFile(filePath, content, { mode: 0o644 });
  }

  return hash;
}

/**
 * Get content by hash
 *
 * @param contentDir - Directory for content files
 * @param hash - Content hash (with or without "sha256:" prefix)
 * @param options - Options including verification
 * @returns Content string, or null if not found (redacted)
 * @throws ContentIntegrityError if verify is true and hash doesn't match
 */
export async function getContent(
  contentDir: string,
  hash: string,
  options: ContentOptions = {}
): Promise<string | null> {
  const hashHex = extractHashHex(hash);
  const filePath = join(contentDir, hashHex);

  try {
    const content = await readFile(filePath, 'utf-8');

    // Verify content integrity if requested
    if (options.verify) {
      const actualHash = sha256Hash(content);
      const normalizedExpected = hash.startsWith('sha256:') ? hash : `sha256:${hash}`;
      if (actualHash !== normalizedExpected) {
        throw new ContentIntegrityError(normalizedExpected, actualHash);
      }
    }

    return content;
  } catch (err) {
    // Re-throw integrity errors
    if (err instanceof ContentIntegrityError) {
      throw err;
    }
    return null;
  }
}

/**
 * Get content with mandatory verification
 *
 * This is a convenience function that always verifies content integrity.
 *
 * @param contentDir - Directory for content files
 * @param hash - Content hash (with or without "sha256:" prefix)
 * @returns Content string, or null if not found (redacted)
 * @throws ContentIntegrityError if hash doesn't match
 */
export async function getContentVerified(
  contentDir: string,
  hash: string
): Promise<string | null> {
  return getContent(contentDir, hash, { verify: true });
}

/**
 * Check if content exists
 *
 * @param contentDir - Directory for content files
 * @param hash - Content hash (with or without "sha256:" prefix)
 * @returns True if content exists
 */
export async function contentExists(contentDir: string, hash: string): Promise<boolean> {
  const hashHex = extractHashHex(hash);
  const filePath = join(contentDir, hashHex);

  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete content (for redaction)
 *
 * @param contentDir - Directory for content files
 * @param hash - Content hash (with or without "sha256:" prefix)
 */
export async function deleteContent(contentDir: string, hash: string): Promise<void> {
  const hashHex = extractHashHex(hash);
  const filePath = join(contentDir, hashHex);

  try {
    await unlink(filePath);
  } catch {
    // Ignore errors (file may already be deleted)
  }
}

/**
 * Verify content integrity
 *
 * @param contentDir - Directory for content files
 * @param hash - Expected content hash
 * @returns True if content exists and hash matches
 */
export async function verifyContent(contentDir: string, hash: string): Promise<boolean> {
  const content = await getContent(contentDir, hash);
  if (!content) return false;

  const actualHash = sha256Hash(content);
  return actualHash === hash || extractHashHex(actualHash) === extractHashHex(hash);
}

/**
 * List all content hashes in the store
 *
 * @param contentDir - Directory for content files
 * @returns Array of hash hex strings
 */
export async function listContent(contentDir: string): Promise<string[]> {
  try {
    const files = await readdir(contentDir);
    // Filter to only files that look like hashes (64 hex chars)
    return files.filter((f) => /^[a-f0-9]{64}$/.test(f));
  } catch {
    return [];
  }
}

/**
 * Get storage statistics
 *
 * @param contentDir - Directory for content files
 * @returns Stats about the content store
 */
export async function getStorageStats(contentDir: string): Promise<{
  totalFiles: number;
  totalBytes: number;
}> {
  const { stat } = await import('node:fs/promises');
  const hashes = await listContent(contentDir);

  let totalBytes = 0;
  for (const hash of hashes) {
    try {
      const filePath = join(contentDir, hash);
      const stats = await stat(filePath);
      totalBytes += stats.size;
    } catch {
      // Skip files we can't stat
    }
  }

  return {
    totalFiles: hashes.length,
    totalBytes,
  };
}

// ============================================================================
// Content Loader Factory
// ============================================================================

/**
 * Create a content loader function for index rebuilding
 *
 * @param contentDir - Directory for content files
 * @param options - Options including verification
 * @returns Async function that loads content by hash
 */
export function createContentLoader(
  contentDir: string,
  options: ContentOptions = {}
): (hash: string) => Promise<string | null> {
  return (hash: string) => getContent(contentDir, hash, options);
}
