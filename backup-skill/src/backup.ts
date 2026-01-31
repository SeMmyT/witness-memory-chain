/**
 * Backup and Restore Logic
 *
 * Creates encrypted archives of memory chain and handles restore operations.
 */

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import * as tar from 'tar';
import { encryptData, decryptData } from './encrypt.js';
import { GoogleDriveClient } from './gdrive.js';

/** Files and directories to include in backup */
const BACKUP_ITEMS = [
  'config.json',
  'chain.jsonl',
  'agent.pub', // Public key only (private key should not be backed up automatically)
  'content',
  'anchors',
];

/** Backup metadata */
export interface BackupMetadata {
  /** Backup creation timestamp */
  createdAt: string;
  /** Memory chain version */
  chainVersion: string;
  /** Agent name */
  agentName: string;
  /** Number of entries */
  entryCount: number;
  /** Total content size in bytes */
  contentSize: number;
  /** Backup format version */
  formatVersion: string;
}

/** Backup result */
export interface BackupResult {
  success: boolean;
  filename?: string;
  fileId?: string;
  size?: number;
  entryCount?: number;
  error?: string;
}

/** Restore result */
export interface RestoreResult {
  success: boolean;
  entryCount?: number;
  contentFiles?: number;
  error?: string;
}

/**
 * Create a tar.gz archive of the memory chain
 *
 * @param dataDir - Memory chain data directory
 * @param outputPath - Path for the output archive
 * @returns Metadata about the backup
 */
export async function createArchive(dataDir: string, outputPath: string): Promise<BackupMetadata> {
  // Read config for metadata
  let config: { agentName?: string; version?: string } = {};
  try {
    const configContent = await readFile(join(dataDir, 'config.json'), 'utf-8');
    config = JSON.parse(configContent);
  } catch {
    // Config may not exist
  }

  // Count entries
  let entryCount = 0;
  try {
    const chainContent = await readFile(join(dataDir, 'chain.jsonl'), 'utf-8');
    entryCount = chainContent.trim().split('\n').filter(Boolean).length;
  } catch {
    // Chain may not exist
  }

  // Calculate content size
  let contentSize = 0;
  const contentDir = join(dataDir, 'content');
  try {
    const files = await readdir(contentDir);
    for (const file of files) {
      const fileStat = await stat(join(contentDir, file));
      contentSize += fileStat.size;
    }
  } catch {
    // Content dir may not exist
  }

  // Determine which items exist
  const existingItems: string[] = [];
  for (const item of BACKUP_ITEMS) {
    try {
      await stat(join(dataDir, item));
      existingItems.push(item);
    } catch {
      // Item doesn't exist, skip
    }
  }

  if (existingItems.length === 0) {
    throw new Error('No backup items found. Is the memory chain initialized?');
  }

  // Create tar.gz archive
  await tar.create(
    {
      gzip: true,
      file: outputPath,
      cwd: dataDir,
    },
    existingItems
  );

  const metadata: BackupMetadata = {
    createdAt: new Date().toISOString(),
    chainVersion: config.version ?? 'unknown',
    agentName: config.agentName ?? 'unknown',
    entryCount,
    contentSize,
    formatVersion: '1.0.0',
  };

  return metadata;
}

/**
 * Extract a tar.gz archive to restore memory chain
 *
 * @param archivePath - Path to the archive
 * @param targetDir - Directory to extract to
 */
export async function extractArchive(archivePath: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });

  await tar.extract({
    file: archivePath,
    cwd: targetDir,
  });
}

/**
 * Create an encrypted backup
 *
 * @param dataDir - Memory chain data directory
 * @param password - Encryption password
 * @returns Encrypted backup as Buffer
 */
export async function createEncryptedBackup(
  dataDir: string,
  password: string
): Promise<{ data: Buffer; metadata: BackupMetadata }> {
  // Create temporary archive
  const tempPath = join(dataDir, '.backup-temp.tar.gz');

  try {
    const metadata = await createArchive(dataDir, tempPath);

    // Read the archive
    const archiveData = await readFile(tempPath);

    // Encrypt
    const encrypted = encryptData(archiveData, password);

    return { data: encrypted, metadata };
  } finally {
    // Clean up temp file
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Restore from an encrypted backup
 *
 * @param encryptedData - Encrypted backup data
 * @param password - Decryption password
 * @param targetDir - Directory to restore to
 */
export async function restoreEncryptedBackup(
  encryptedData: Buffer,
  password: string,
  targetDir: string
): Promise<RestoreResult> {
  // Create temp file for decrypted archive
  const tempPath = join(targetDir, '.restore-temp.tar.gz');

  try {
    // Decrypt
    const archiveData = decryptData(encryptedData, password);

    // Write to temp file
    await writeFile(tempPath, archiveData);

    // Extract
    await extractArchive(tempPath, targetDir);

    // Count restored items
    let entryCount = 0;
    try {
      const chainContent = await readFile(join(targetDir, 'chain.jsonl'), 'utf-8');
      entryCount = chainContent.trim().split('\n').filter(Boolean).length;
    } catch {
      // Chain may not exist
    }

    let contentFiles = 0;
    try {
      const files = await readdir(join(targetDir, 'content'));
      contentFiles = files.length;
    } catch {
      // Content dir may not exist
    }

    return {
      success: true,
      entryCount,
      contentFiles,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Clean up temp file
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Backup to Google Drive
 *
 * @param dataDir - Memory chain data directory
 * @param password - Encryption password
 * @param driveClient - Google Drive client
 * @param folderName - Folder name in Drive
 */
export async function backupToDrive(
  dataDir: string,
  password: string,
  driveClient: GoogleDriveClient,
  folderName: string
): Promise<BackupResult> {
  try {
    // Create encrypted backup
    const { data, metadata } = await createEncryptedBackup(dataDir, password);

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `memory-chain-backup-${metadata.agentName}-${timestamp}.enc`;

    // Find or create folder
    const folderId = await driveClient.findOrCreateFolder(folderName);

    // Upload
    const fileId = await driveClient.uploadFile(filename, data, folderId);

    return {
      success: true,
      filename,
      fileId,
      size: data.length,
      entryCount: metadata.entryCount,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Restore from Google Drive
 *
 * @param fileId - Drive file ID to restore from
 * @param password - Decryption password
 * @param targetDir - Directory to restore to
 * @param driveClient - Google Drive client
 */
export async function restoreFromDrive(
  fileId: string,
  password: string,
  targetDir: string,
  driveClient: GoogleDriveClient
): Promise<RestoreResult> {
  try {
    // Download encrypted backup
    const encryptedData = await driveClient.downloadFile(fileId);

    // Restore
    return await restoreEncryptedBackup(encryptedData, password, targetDir);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get backup status information
 */
export interface BackupStatus {
  /** Last backup timestamp (if any) */
  lastBackup?: string;
  /** Last backup file ID */
  lastBackupId?: string;
  /** Last backup size */
  lastBackupSize?: number;
  /** Number of backups in Drive */
  backupCount: number;
  /** Total backup storage used */
  totalStorageUsed: number;
  /** Next scheduled backup (if scheduled) */
  nextBackup?: string;
}

/**
 * Get backup status from Google Drive
 *
 * @param driveClient - Google Drive client
 * @param folderName - Backup folder name
 */
export async function getBackupStatus(
  driveClient: GoogleDriveClient,
  folderName: string
): Promise<BackupStatus> {
  const status: BackupStatus = {
    backupCount: 0,
    totalStorageUsed: 0,
  };

  try {
    const folderId = await driveClient.findOrCreateFolder(folderName);
    const backups = await driveClient.listBackups(folderId);

    status.backupCount = backups.length;

    if (backups.length > 0) {
      const latest = backups[0]; // Already sorted by date desc
      status.lastBackup = latest.modifiedTime ?? undefined;
      status.lastBackupId = latest.id ?? undefined;
      status.lastBackupSize = latest.size ? parseInt(latest.size, 10) : undefined;
    }

    // Calculate total storage
    for (const backup of backups) {
      if (backup.size) {
        status.totalStorageUsed += parseInt(backup.size, 10);
      }
    }
  } catch (error) {
    // Drive not authorized or other error - return empty status
    console.error('Failed to get backup status:', error);
  }

  return status;
}
