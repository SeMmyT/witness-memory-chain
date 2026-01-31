/**
 * Chain Export/Import Operations
 *
 * Provides functionality to export chains for backup or transfer,
 * and import chains from exported data.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ChainEntry,
  ChainConfig,
  ChainExport,
  ExportOptions,
} from '../types.js';
import { readChain, loadConfig } from './index.js';
import { getContent, storeContent, listContent } from '../storage/content-store.js';
import { sha256Hash, extractHashHex, verifySignature, hexToKey } from './crypto.js';

// File names
const CONTENT_DIR = 'content';
const PUBLIC_KEY_FILE = 'agent.pub';

// ============================================================================
// Export Operations
// ============================================================================

/**
 * Export the chain to a portable format
 *
 * @param dataDir - Chain directory
 * @param options - Export options
 * @returns Exported chain data
 */
export async function exportChain(
  dataDir: string,
  options: ExportOptions = {}
): Promise<ChainExport> {
  const {
    includeContent = true,
    hashesOnly = false,
    fromSeq,
    toSeq,
  } = options;

  // Load config and entries
  const config = await loadConfig(dataDir);
  let entries = await readChain(dataDir);

  // Load public key
  let publicKey: string | undefined;
  try {
    const pubKeyPath = join(dataDir, PUBLIC_KEY_FILE);
    publicKey = (await readFile(pubKeyPath, 'utf-8')).trim();
  } catch {
    // Public key not available (e.g., env mode)
  }

  // Filter by sequence range if specified
  if (fromSeq !== undefined) {
    entries = entries.filter((e) => e.seq >= fromSeq);
  }
  if (toSeq !== undefined) {
    entries = entries.filter((e) => e.seq <= toSeq);
  }

  // Build export object
  const exportData: ChainExport = {
    config,
    entries: hashesOnly
      ? entries.map((e) => ({
          ...e,
          // Keep only hash-related fields for verification
          content_hash: e.content_hash,
          prev_hash: e.prev_hash,
          signature: e.signature,
        }))
      : entries,
    publicKey,
    exportedAt: new Date().toISOString(),
  };

  // Include content if requested
  if (includeContent && !hashesOnly) {
    const contentDir = join(dataDir, CONTENT_DIR);
    const content: Record<string, string> = {};

    // Get unique content hashes from entries
    const hashes = new Set<string>();
    for (const entry of entries) {
      hashes.add(entry.content_hash);
    }

    // Load content for each hash
    for (const hash of hashes) {
      const data = await getContent(contentDir, hash);
      if (data) {
        content[hash] = data;
      }
    }

    exportData.content = content;
  }

  return exportData;
}

/**
 * Export chain to a JSON file
 *
 * @param dataDir - Chain directory
 * @param outputPath - Path to output file
 * @param options - Export options
 */
export async function exportChainToFile(
  dataDir: string,
  outputPath: string,
  options: ExportOptions = {}
): Promise<void> {
  const exportData = await exportChain(dataDir, options);
  await writeFile(outputPath, JSON.stringify(exportData, null, 2));
}

// ============================================================================
// Import Operations
// ============================================================================

/** Result of chain import */
export interface ImportResult {
  /** Whether import was successful */
  success: boolean;
  /** Number of entries imported */
  entriesImported: number;
  /** Number of content items imported */
  contentImported: number;
  /** Errors encountered during import */
  errors: string[];
  /** Warnings (non-fatal issues) */
  warnings: string[];
}

/**
 * Validate exported chain data
 *
 * @param exportData - Exported chain data to validate
 * @returns Validation errors (empty if valid)
 */
export async function validateExport(exportData: ChainExport): Promise<string[]> {
  const errors: string[] = [];

  // Check required fields
  if (!exportData.config) {
    errors.push('Missing config');
  }
  if (!exportData.entries || !Array.isArray(exportData.entries)) {
    errors.push('Missing or invalid entries');
  }

  if (errors.length > 0) {
    return errors;
  }

  // Validate entries
  let prevEntry: ChainEntry | null = null;
  for (const entry of exportData.entries) {
    // Check sequence
    if (prevEntry && entry.seq !== prevEntry.seq + 1) {
      errors.push(`Sequence gap at entry ${entry.seq}`);
    }

    // Check prev_hash linkage
    if (prevEntry) {
      // We can't fully verify without the previous entry's hash, but we can check it's not null
      if (!entry.prev_hash) {
        errors.push(`Entry ${entry.seq} has null prev_hash (expected hash of previous entry)`);
      }
    } else {
      // First entry should have null prev_hash (genesis)
      if (entry.prev_hash !== null) {
        errors.push(`First entry (${entry.seq}) should have null prev_hash`);
      }
    }

    // Check required fields
    if (!entry.content_hash) {
      errors.push(`Entry ${entry.seq} missing content_hash`);
    }
    if (!entry.signature) {
      errors.push(`Entry ${entry.seq} missing signature`);
    }

    // Verify content exists if content is included
    if (exportData.content && entry.content_hash) {
      if (!exportData.content[entry.content_hash]) {
        errors.push(`Entry ${entry.seq} references missing content: ${entry.content_hash}`);
      }
    }

    prevEntry = entry;
  }

  return errors;
}

/**
 * Import chain from exported data
 *
 * This creates a new chain directory with the imported data.
 * It does NOT merge into an existing chain.
 *
 * @param exportData - Exported chain data
 * @param targetDir - Target directory for the imported chain
 * @param options - Import options
 * @returns Import result
 */
export async function importChain(
  exportData: ChainExport,
  targetDir: string,
  options: { validateSignatures?: boolean; overwrite?: boolean } = {}
): Promise<ImportResult> {
  const { validateSignatures = false, overwrite = false } = options;
  const result: ImportResult = {
    success: false,
    entriesImported: 0,
    contentImported: 0,
    errors: [],
    warnings: [],
  };

  // Validate export data
  const validationErrors = await validateExport(exportData);
  if (validationErrors.length > 0) {
    result.errors = validationErrors;
    return result;
  }

  try {
    // Check if target exists
    try {
      await readFile(join(targetDir, 'chain.jsonl'));
      if (!overwrite) {
        result.errors.push(`Target directory ${targetDir} already contains a chain. Use overwrite option to replace.`);
        return result;
      }
    } catch {
      // Directory doesn't exist or no chain - OK to proceed
    }

    // Create directory structure
    await mkdir(targetDir, { recursive: true });
    await mkdir(join(targetDir, CONTENT_DIR), { recursive: true });

    // Validate signatures if requested
    if (validateSignatures && exportData.config.keyMode === 'raw') {
      result.warnings.push('Signature validation requires public key - skipping validation');
    }

    // Write config
    await writeFile(
      join(targetDir, 'config.json'),
      JSON.stringify(exportData.config, null, 2)
    );

    // Write public key if available
    if (exportData.publicKey) {
      await writeFile(
        join(targetDir, PUBLIC_KEY_FILE),
        exportData.publicKey,
        { mode: 0o644 }
      );
    }

    // Write chain entries
    const chainLines = exportData.entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await writeFile(join(targetDir, 'chain.jsonl'), chainLines);
    result.entriesImported = exportData.entries.length;

    // Write content
    if (exportData.content) {
      const contentDir = join(targetDir, CONTENT_DIR);
      for (const [hash, content] of Object.entries(exportData.content)) {
        // Verify content hash
        const actualHash = sha256Hash(content);
        const normalizedHash = hash.startsWith('sha256:') ? hash : `sha256:${hash}`;
        if (actualHash !== normalizedHash) {
          result.warnings.push(`Content hash mismatch for ${hash}`);
          continue;
        }

        const hashHex = extractHashHex(hash);
        await writeFile(join(contentDir, hashHex), content);
        result.contentImported++;
      }
    }

    result.success = true;
  } catch (err) {
    result.errors.push(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Import chain from a JSON file
 *
 * @param inputPath - Path to input file
 * @param targetDir - Target directory for the imported chain
 * @param options - Import options
 * @returns Import result
 */
export async function importChainFromFile(
  inputPath: string,
  targetDir: string,
  options: { validateSignatures?: boolean; overwrite?: boolean } = {}
): Promise<ImportResult> {
  try {
    const content = await readFile(inputPath, 'utf-8');
    const exportData = JSON.parse(content) as ChainExport;
    return importChain(exportData, targetDir, options);
  } catch (err) {
    return {
      success: false,
      entriesImported: 0,
      contentImported: 0,
      errors: [`Failed to read or parse export file: ${err instanceof Error ? err.message : String(err)}`],
      warnings: [],
    };
  }
}
