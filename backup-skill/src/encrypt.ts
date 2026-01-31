/**
 * Backup Encryption
 *
 * Provides AES-256-GCM encryption for backup archives before upload.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { scrypt } from '@noble/hashes/scrypt';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/** Encryption parameters */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

// Scrypt parameters (OWASP recommended)
const SCRYPT_N = 16384; // 2^14
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/** Header for encrypted files */
const MAGIC_HEADER = Buffer.from('MCBAK01'); // Memory Chain Backup v1

/** Encrypted file format */
export interface EncryptedFile {
  /** Salt for key derivation (hex) */
  salt: string;
  /** Initialization vector (hex) */
  iv: string;
  /** GCM authentication tag (hex) */
  tag: string;
  /** Encrypted data (base64) */
  data: string;
}

/**
 * Derive encryption key from password using scrypt
 *
 * @param password - User password
 * @param salt - Salt bytes
 * @returns 32-byte encryption key
 */
function deriveKey(password: string, salt: Uint8Array): Uint8Array {
  return scrypt(password, salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    dkLen: KEY_LENGTH,
  });
}

/**
 * Encrypt data with password
 *
 * Uses AES-256-GCM with scrypt key derivation.
 *
 * @param data - Data to encrypt
 * @param password - Encryption password
 * @returns Encrypted buffer with header
 */
export function encryptData(data: Buffer, password: string): Buffer {
  // Generate random salt and IV
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);

  // Derive encryption key
  const key = deriveKey(password, salt);

  // Encrypt with AES-256-GCM
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Combine into single buffer: HEADER + SALT + IV + TAG + ENCRYPTED
  return Buffer.concat([
    MAGIC_HEADER,
    salt,
    iv,
    tag,
    encrypted,
  ]);
}

/**
 * Decrypt data with password
 *
 * @param encryptedBuffer - Encrypted buffer with header
 * @param password - Decryption password
 * @returns Decrypted data
 * @throws Error if decryption fails (wrong password or corrupted data)
 */
export function decryptData(encryptedBuffer: Buffer, password: string): Buffer {
  // Validate header
  const header = encryptedBuffer.subarray(0, MAGIC_HEADER.length);
  if (!header.equals(MAGIC_HEADER)) {
    throw new Error('Invalid backup file format');
  }

  let offset = MAGIC_HEADER.length;

  // Extract salt
  const salt = encryptedBuffer.subarray(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;

  // Extract IV
  const iv = encryptedBuffer.subarray(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;

  // Extract tag
  const tag = encryptedBuffer.subarray(offset, offset + TAG_LENGTH);
  offset += TAG_LENGTH;

  // Extract encrypted data
  const encrypted = encryptedBuffer.subarray(offset);

  // Derive encryption key
  const key = deriveKey(password, salt);

  // Decrypt with AES-256-GCM
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted;
  } catch {
    throw new Error('Decryption failed: invalid password or corrupted data');
  }
}

/**
 * Encrypt data to JSON format (for easier storage/transmission)
 *
 * @param data - Data to encrypt
 * @param password - Encryption password
 * @returns Encrypted file object
 */
export function encryptToJson(data: Buffer, password: string): EncryptedFile {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);

  const key = deriveKey(password, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    tag: bytesToHex(tag),
    data: encrypted.toString('base64'),
  };
}

/**
 * Decrypt data from JSON format
 *
 * @param encryptedFile - Encrypted file object
 * @param password - Decryption password
 * @returns Decrypted data
 */
export function decryptFromJson(encryptedFile: EncryptedFile, password: string): Buffer {
  const salt = hexToBytes(encryptedFile.salt);
  const iv = hexToBytes(encryptedFile.iv);
  const tag = hexToBytes(encryptedFile.tag);
  const encrypted = Buffer.from(encryptedFile.data, 'base64');

  const key = deriveKey(password, salt);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted;
  } catch {
    throw new Error('Decryption failed: invalid password or corrupted data');
  }
}

/**
 * Validate password strength
 *
 * @param password - Password to validate
 * @returns Error message if invalid, null if valid
 */
export function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters long';
  }
  if (password.length > 128) {
    return 'Password must be at most 128 characters long';
  }
  return null;
}
