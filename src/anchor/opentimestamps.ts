/**
 * OpenTimestamps Anchoring
 *
 * Provides Bitcoin timestamping for memory chain entries via OpenTimestamps protocol.
 * This adds an external layer of proof that entries existed at a specific time.
 */

import { readFile, writeFile, mkdir, readdir, access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import {
  submit as otsSubmit,
  upgrade as otsUpgrade,
  verify as otsVerify,
  read as otsRead,
  write as otsWrite,
  canUpgrade,
  canVerify,
  verifiers,
  type Timestamp,
} from '@lacrypta/typescript-opentimestamps';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { hashEntry } from '../chain/crypto.js';
import type { ChainEntry } from '../types.js';
import type {
  AnchorRecord,
  AnchorStatus,
  PendingAnchorsFile,
  AnchorSubmitResult,
  AnchorVerifyResult,
  AnchorStatusResult,
  AnchorOptions,
} from './types.js';

// Directory names
const ANCHORS_DIR = 'anchors';
const PENDING_FILE = 'pending.json';

// ============================================================================
// Directory Management
// ============================================================================

/**
 * Ensure the anchors directory exists
 */
async function ensureAnchorsDir(dataDir: string): Promise<string> {
  const anchorsDir = join(dataDir, ANCHORS_DIR);
  await mkdir(anchorsDir, { recursive: true });
  return anchorsDir;
}

/**
 * Get the path to an entry's .ots proof file
 */
function getOtsPath(anchorsDir: string, seq: number): string {
  return join(anchorsDir, `entry-${seq}.ots`);
}

/**
 * Get the path to the pending anchors file
 */
function getPendingPath(anchorsDir: string): string {
  return join(anchorsDir, PENDING_FILE);
}

/**
 * Check if a file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Pending Anchors Management
// ============================================================================

/**
 * Load pending anchors from file
 */
async function loadPendingAnchors(anchorsDir: string): Promise<PendingAnchorsFile> {
  const pendingPath = getPendingPath(anchorsDir);
  try {
    const content = await readFile(pendingPath, 'utf-8');
    return JSON.parse(content) as PendingAnchorsFile;
  } catch {
    return { version: 1, anchors: [] };
  }
}

/**
 * Save pending anchors to file
 */
async function savePendingAnchors(anchorsDir: string, pending: PendingAnchorsFile): Promise<void> {
  const pendingPath = getPendingPath(anchorsDir);
  await writeFile(pendingPath, JSON.stringify(pending, null, 2));
}

/**
 * Add a pending anchor record
 */
async function addPendingAnchor(anchorsDir: string, record: AnchorRecord): Promise<void> {
  const pending = await loadPendingAnchors(anchorsDir);
  // Remove any existing record for this seq
  pending.anchors = pending.anchors.filter((a) => a.seq !== record.seq);
  pending.anchors.push(record);
  await savePendingAnchors(anchorsDir, pending);
}

/**
 * Update a pending anchor record
 */
async function updatePendingAnchor(
  anchorsDir: string,
  seq: number,
  updates: Partial<AnchorRecord>
): Promise<void> {
  const pending = await loadPendingAnchors(anchorsDir);
  const index = pending.anchors.findIndex((a) => a.seq === seq);
  if (index !== -1) {
    pending.anchors[index] = { ...pending.anchors[index], ...updates };
    await savePendingAnchors(anchorsDir, pending);
  }
}

/**
 * Remove a pending anchor (after confirmation or failure)
 */
async function removePendingAnchor(anchorsDir: string, seq: number): Promise<void> {
  const pending = await loadPendingAnchors(anchorsDir);
  pending.anchors = pending.anchors.filter((a) => a.seq !== seq);
  await savePendingAnchors(anchorsDir, pending);
}

// ============================================================================
// Core Anchoring Functions
// ============================================================================

/**
 * Submit an entry for OpenTimestamps anchoring
 *
 * @param dataDir - Chain directory
 * @param entry - Chain entry to anchor
 * @param options - Anchor options
 * @returns Submit result with path to .ots file
 */
export async function submitAnchor(
  dataDir: string,
  entry: ChainEntry,
  options: AnchorOptions = {}
): Promise<AnchorSubmitResult> {
  const anchorsDir = await ensureAnchorsDir(dataDir);
  const otsPath = getOtsPath(anchorsDir, entry.seq);

  // Check if already anchored
  if (await fileExists(otsPath)) {
    return {
      success: false,
      seq: entry.seq,
      error: `Entry ${entry.seq} is already anchored`,
    };
  }

  // Compute the hash of the entry (same hash used for chain linking)
  const entryHash = hashEntry(entry);
  const hashHex = entryHash.slice(7); // Remove "sha256:" prefix
  const hashBytes = hexToBytes(hashHex);

  try {
    // Submit to OpenTimestamps calendars
    const { timestamp, errors } = await otsSubmit('sha256', hashBytes);

    if (errors.length > 0 && !canUpgrade(timestamp)) {
      // All calendars failed
      return {
        success: false,
        seq: entry.seq,
        error: `Failed to submit to calendars: ${errors.map((e: Error) => e.message).join(', ')}`,
      };
    }

    // Serialize and save the .ots file
    const otsBytes = otsWrite(timestamp);
    await writeFile(otsPath, Buffer.from(otsBytes));

    // Record as pending
    const record: AnchorRecord = {
      seq: entry.seq,
      entryHash,
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };
    await addPendingAnchor(anchorsDir, record);

    return {
      success: true,
      seq: entry.seq,
      otsPath,
    };
  } catch (err) {
    return {
      success: false,
      seq: entry.seq,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Batch submit multiple entries for anchoring
 *
 * @param dataDir - Chain directory
 * @param entries - Chain entries to anchor
 * @param options - Anchor options
 * @returns Array of submit results
 */
export async function submitAnchorsForEntries(
  dataDir: string,
  entries: ChainEntry[],
  options: AnchorOptions = {}
): Promise<AnchorSubmitResult[]> {
  const results: AnchorSubmitResult[] = [];

  for (const entry of entries) {
    const result = await submitAnchor(dataDir, entry, options);
    results.push(result);
  }

  return results;
}

/**
 * Upgrade pending anchors by checking with calendar servers
 *
 * @param dataDir - Chain directory
 * @returns Status result with upgraded anchors
 */
export async function upgradePendingAnchors(dataDir: string): Promise<AnchorStatusResult> {
  const anchorsDir = await ensureAnchorsDir(dataDir);
  const pending = await loadPendingAnchors(anchorsDir);

  const result: AnchorStatusResult = {
    total: 0,
    pending: 0,
    confirmed: 0,
    failed: 0,
    anchors: [],
    newlyConfirmed: 0,
  };

  for (const record of pending.anchors) {
    if (record.status !== 'pending') {
      continue;
    }

    const otsPath = getOtsPath(anchorsDir, record.seq);

    try {
      // Read current .ots file
      const otsBytes = await readFile(otsPath);
      const timestamp = otsRead(new Uint8Array(otsBytes));

      // Check if it can be upgraded (has pending leaves)
      if (!canUpgrade(timestamp)) {
        // Already upgraded, check if it can be verified
        if (canVerify(timestamp)) {
          // Try to verify
          const verifyResult = await verifyAnchor(dataDir, record.seq);
          if (verifyResult.status === 'confirmed') {
            await updatePendingAnchor(anchorsDir, record.seq, {
              status: 'confirmed',
              confirmedAt: new Date().toISOString(),
              blockHeight: verifyResult.blockHeight,
              blockTimestamp: verifyResult.blockTimestamp,
            });
            result.newlyConfirmed++;
            result.confirmed++;
            result.anchors.push({
              ...record,
              status: 'confirmed',
              confirmedAt: new Date().toISOString(),
              blockHeight: verifyResult.blockHeight,
              blockTimestamp: verifyResult.blockTimestamp,
            });
          } else {
            result.pending++;
            result.anchors.push(record);
          }
        } else {
          result.pending++;
          result.anchors.push(record);
        }
        continue;
      }

      // Try to upgrade
      const { timestamp: upgraded, errors } = await otsUpgrade(timestamp);

      // Save upgraded timestamp
      const upgradedBytes = otsWrite(upgraded);
      await writeFile(otsPath, Buffer.from(upgradedBytes));

      // Check if upgrade was successful (can now be verified)
      if (canVerify(upgraded)) {
        // Try to verify and get block info
        const verifyResult = await verifyAnchor(dataDir, record.seq);
        if (verifyResult.status === 'confirmed') {
          await updatePendingAnchor(anchorsDir, record.seq, {
            status: 'confirmed',
            confirmedAt: new Date().toISOString(),
            blockHeight: verifyResult.blockHeight,
            blockTimestamp: verifyResult.blockTimestamp,
          });
          result.newlyConfirmed++;
          result.confirmed++;
          result.anchors.push({
            ...record,
            status: 'confirmed',
            confirmedAt: new Date().toISOString(),
            blockHeight: verifyResult.blockHeight,
            blockTimestamp: verifyResult.blockTimestamp,
          });
        } else {
          result.pending++;
          result.anchors.push(record);
        }
      } else {
        result.pending++;
        result.anchors.push(record);
      }
    } catch (err) {
      // Mark as failed
      await updatePendingAnchor(anchorsDir, record.seq, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      result.failed++;
      result.anchors.push({
        ...record,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Update last check time
  pending.lastCheck = new Date().toISOString();
  await savePendingAnchors(anchorsDir, pending);

  result.total = result.pending + result.confirmed + result.failed;

  return result;
}

/**
 * Verify an anchor for a specific entry
 *
 * @param dataDir - Chain directory
 * @param seq - Sequence number of entry to verify
 * @returns Verification result
 */
export async function verifyAnchor(dataDir: string, seq: number): Promise<AnchorVerifyResult> {
  const anchorsDir = await ensureAnchorsDir(dataDir);
  const otsPath = getOtsPath(anchorsDir, seq);

  // Check if .ots file exists
  if (!(await fileExists(otsPath))) {
    return {
      seq,
      valid: false,
      status: 'failed',
      error: `No anchor file found for entry ${seq}`,
    };
  }

  try {
    // Read and parse .ots file
    const otsBytes = await readFile(otsPath);
    const timestamp = otsRead(new Uint8Array(otsBytes));

    // Check if it can be verified
    if (!canVerify(timestamp)) {
      return {
        seq,
        valid: true, // File is valid, just not yet confirmed
        status: 'pending',
      };
    }

    // Verify against blockchain
    const { attestations, errors } = await otsVerify(timestamp, verifiers);

    // Check if we got any attestations
    const timestamps = Object.keys(attestations).map(Number);
    if (timestamps.length === 0) {
      // No attestations found, check for errors
      const typedErrors = errors as Record<string, Error[]>;
      const allErrors: Error[] = [];
      for (const key of Object.keys(typedErrors)) {
        allErrors.push(...typedErrors[key]);
      }
      if (allErrors.length > 0) {
        return {
          seq,
          valid: false,
          status: 'failed',
          error: allErrors.map((e) => e.message).join(', '),
        };
      }
      return {
        seq,
        valid: true,
        status: 'pending',
      };
    }

    // Get the earliest attestation
    const earliestTimestamp = Math.min(...timestamps);
    const blockTimestamp = new Date(earliestTimestamp * 1000).toISOString();

    // We don't get block height directly from verification, but we have confirmation
    return {
      seq,
      valid: true,
      status: 'confirmed',
      blockTimestamp,
    };
  } catch (err) {
    return {
      seq,
      valid: false,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Get the status of all anchors
 *
 * @param dataDir - Chain directory
 * @returns Status of all anchors
 */
export async function getAnchorStatus(dataDir: string): Promise<AnchorStatusResult> {
  const anchorsDir = await ensureAnchorsDir(dataDir);

  // List all .ots files
  let otsFiles: string[] = [];
  try {
    const files = await readdir(anchorsDir);
    otsFiles = files.filter((f) => f.endsWith('.ots'));
  } catch {
    // Directory doesn't exist or empty
  }

  // Load pending records
  const pending = await loadPendingAnchors(anchorsDir);
  const pendingBySeq = new Map(pending.anchors.map((a) => [a.seq, a]));

  const result: AnchorStatusResult = {
    total: otsFiles.length,
    pending: 0,
    confirmed: 0,
    failed: 0,
    anchors: [],
    newlyConfirmed: 0,
  };

  for (const file of otsFiles) {
    // Extract seq from filename (entry-N.ots)
    const match = file.match(/^entry-(\d+)\.ots$/);
    if (!match) continue;

    const seq = parseInt(match[1], 10);
    const pendingRecord = pendingBySeq.get(seq);

    if (pendingRecord) {
      result.anchors.push(pendingRecord);
      switch (pendingRecord.status) {
        case 'pending':
          result.pending++;
          break;
        case 'confirmed':
          result.confirmed++;
          break;
        case 'failed':
          result.failed++;
          break;
      }
    } else {
      // No pending record - verify to determine status
      const verifyResult = await verifyAnchor(dataDir, seq);
      const record: AnchorRecord = {
        seq,
        entryHash: '', // Unknown without reading entry
        status: verifyResult.status,
        submittedAt: '', // Unknown
        confirmedAt: verifyResult.status === 'confirmed' ? new Date().toISOString() : undefined,
        blockHeight: verifyResult.blockHeight,
        blockTimestamp: verifyResult.blockTimestamp,
        error: verifyResult.error,
      };
      result.anchors.push(record);
      switch (verifyResult.status) {
        case 'pending':
          result.pending++;
          break;
        case 'confirmed':
          result.confirmed++;
          break;
        case 'failed':
          result.failed++;
          break;
      }
    }
  }

  // Sort by seq
  result.anchors.sort((a, b) => a.seq - b.seq);

  return result;
}

/**
 * Check if an entry has an anchor
 *
 * @param dataDir - Chain directory
 * @param seq - Sequence number
 * @returns True if entry has an anchor file
 */
export async function hasAnchor(dataDir: string, seq: number): Promise<boolean> {
  const anchorsDir = join(dataDir, ANCHORS_DIR);
  const otsPath = getOtsPath(anchorsDir, seq);
  return fileExists(otsPath);
}

/**
 * Get entries that don't have anchors
 *
 * @param dataDir - Chain directory
 * @param entries - All chain entries
 * @returns Entries without anchors
 */
export async function getUnanchoredEntries(
  dataDir: string,
  entries: ChainEntry[]
): Promise<ChainEntry[]> {
  const unanchored: ChainEntry[] = [];

  for (const entry of entries) {
    if (!(await hasAnchor(dataDir, entry.seq))) {
      unanchored.push(entry);
    }
  }

  return unanchored;
}
