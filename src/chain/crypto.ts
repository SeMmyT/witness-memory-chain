/**
 * Cryptographic utilities for the memory chain
 *
 * Uses @noble/ed25519 for signing and @noble/hashes for SHA-256.
 * These are audited, pure-JS implementations with no native dependencies.
 */

import { sha256 } from '@noble/hashes/sha256';
import { scrypt } from '@noble/hashes/scrypt';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import * as ed25519 from '@noble/ed25519';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import type { EncryptedKeyFile, EncryptionOptions } from '../types.js';

// Enable synchronous methods (required for ed25519 in Node.js)
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).crypto = webcrypto;
}

// ============================================================================
// Hashing
// ============================================================================

/**
 * Compute SHA-256 hash of data
 * @param data - String or Buffer to hash
 * @returns Hash in "sha256:hex" format
 */
export function sha256Hash(data: string | Uint8Array): string {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = sha256(input);
  return `sha256:${bytesToHex(hash)}`;
}

/**
 * Extract raw hex from prefixed hash
 * @param prefixedHash - Hash in "sha256:hex" format
 * @returns Raw hex string
 */
export function extractHashHex(prefixedHash: string): string {
  if (prefixedHash.startsWith('sha256:')) {
    return prefixedHash.slice(7);
  }
  return prefixedHash;
}

// ============================================================================
// Key Management
// ============================================================================

/** Key pair for signing */
export interface KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/**
 * Generate a new Ed25519 key pair
 * @returns Key pair with 32-byte private key and 32-byte public key
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  return { privateKey, publicKey };
}

/**
 * Derive public key from private key
 * @param privateKey - 32-byte private key
 * @returns 32-byte public key
 */
export async function getPublicKey(privateKey: Uint8Array): Promise<Uint8Array> {
  return ed25519.getPublicKeyAsync(privateKey);
}

/**
 * Serialize key to hex string
 * @param key - Key bytes
 * @returns Hex string
 */
export function keyToHex(key: Uint8Array): string {
  return bytesToHex(key);
}

/**
 * Deserialize key from hex string
 * @param hex - Hex string
 * @returns Key bytes
 */
export function hexToKey(hex: string): Uint8Array {
  return hexToBytes(hex);
}

// ============================================================================
// Signing
// ============================================================================

/**
 * Sign data with Ed25519 private key
 * @param data - String data to sign
 * @param privateKey - 32-byte private key
 * @returns Signature in "ed25519:hex" format
 */
export async function sign(data: string, privateKey: Uint8Array): Promise<string> {
  const message = new TextEncoder().encode(data);
  const signature = await ed25519.signAsync(message, privateKey);
  return `ed25519:${bytesToHex(signature)}`;
}

/**
 * Verify Ed25519 signature
 * @param data - Original string data
 * @param signature - Signature in "ed25519:hex" format
 * @param publicKey - 32-byte public key
 * @returns True if signature is valid
 */
export async function verifySignature(
  data: string,
  signature: string,
  publicKey: Uint8Array
): Promise<boolean> {
  try {
    const sigHex = signature.startsWith('ed25519:') ? signature.slice(8) : signature;
    const sigBytes = hexToBytes(sigHex);
    const message = new TextEncoder().encode(data);
    return await ed25519.verifyAsync(sigBytes, message, publicKey);
  } catch {
    return false;
  }
}

// ============================================================================
// Entry Signing
// ============================================================================

/**
 * Create canonical string representation of entry for signing
 * This ensures consistent signing regardless of JSON key order
 */
export function canonicalizeEntry(entry: {
  seq: number;
  ts: string;
  type: string;
  tier: string;
  content_hash: string;
  prev_hash: string | null;
  metadata?: Record<string, unknown>;
}): string {
  // Sort metadata keys for consistency
  const sortedMetadata = entry.metadata
    ? Object.keys(entry.metadata)
        .sort()
        .reduce(
          (acc, key) => {
            acc[key] = entry.metadata![key];
            return acc;
          },
          {} as Record<string, unknown>
        )
    : null;

  return JSON.stringify({
    seq: entry.seq,
    ts: entry.ts,
    type: entry.type,
    tier: entry.tier,
    content_hash: entry.content_hash,
    prev_hash: entry.prev_hash,
    metadata: sortedMetadata,
  });
}

/**
 * Compute the hash of an entry (for linking in the chain)
 * @param entry - Chain entry (without signature field)
 * @returns Hash in "sha256:hex" format
 */
export function hashEntry(entry: {
  seq: number;
  ts: string;
  type: string;
  tier: string;
  content_hash: string;
  prev_hash: string | null;
  signature: string;
  metadata?: Record<string, unknown>;
}): string {
  // Include signature in the hash for the chain link
  const canonical = JSON.stringify({
    seq: entry.seq,
    ts: entry.ts,
    type: entry.type,
    tier: entry.tier,
    content_hash: entry.content_hash,
    prev_hash: entry.prev_hash,
    signature: entry.signature,
    metadata: entry.metadata ?? null,
  });
  return sha256Hash(canonical);
}

// ============================================================================
// Key Encryption
// ============================================================================

/** Default scrypt parameters (OWASP recommended) */
const DEFAULT_SCRYPT_N = 16384; // 2^14
const DEFAULT_SCRYPT_R = 8;
const DEFAULT_SCRYPT_P = 1;

/**
 * Encrypt a private key with a password
 * @param privateKey - 32-byte private key to encrypt
 * @param password - Password for encryption
 * @param options - Encryption options
 * @returns Encrypted key file structure
 */
export function encryptPrivateKey(
  privateKey: Uint8Array,
  password: string,
  options: EncryptionOptions = {}
): EncryptedKeyFile {
  const n = options.scryptN ?? DEFAULT_SCRYPT_N;
  const r = options.scryptR ?? DEFAULT_SCRYPT_R;
  const p = options.scryptP ?? DEFAULT_SCRYPT_P;

  // Generate random salt and IV
  const salt = randomBytes(32);
  const iv = randomBytes(12); // 96-bit IV for GCM

  // Derive encryption key using scrypt
  const derivedKey = scrypt(password, salt, { N: n, r, p, dkLen: 32 });

  // Encrypt with AES-256-GCM
  const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    kdfParams: {
      n,
      r,
      p,
      salt: bytesToHex(salt),
    },
    ciphertext: bytesToHex(ciphertext),
    tag: bytesToHex(tag),
    iv: bytesToHex(iv),
  };
}

/**
 * Decrypt a private key with a password
 * @param encryptedKey - Encrypted key file structure
 * @param password - Password for decryption
 * @returns Decrypted 32-byte private key
 * @throws Error if decryption fails (wrong password or corrupted data)
 */
export function decryptPrivateKey(
  encryptedKey: EncryptedKeyFile,
  password: string
): Uint8Array {
  if (encryptedKey.version !== 1) {
    throw new Error(`Unsupported encrypted key version: ${encryptedKey.version}`);
  }
  if (encryptedKey.algorithm !== 'aes-256-gcm') {
    throw new Error(`Unsupported encryption algorithm: ${encryptedKey.algorithm}`);
  }
  if (encryptedKey.kdf !== 'scrypt') {
    throw new Error(`Unsupported KDF: ${encryptedKey.kdf}`);
  }

  const { n, r, p, salt } = encryptedKey.kdfParams;
  const saltBytes = hexToBytes(salt);
  const iv = hexToBytes(encryptedKey.iv);
  const ciphertext = hexToBytes(encryptedKey.ciphertext);
  const tag = hexToBytes(encryptedKey.tag);

  // Derive encryption key using scrypt
  const derivedKey = scrypt(password, saltBytes, { N: n, r, p, dkLen: 32 });

  // Decrypt with AES-256-GCM
  const decipher = createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(tag);

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return new Uint8Array(plaintext);
  } catch {
    throw new Error('Decryption failed: invalid password or corrupted data');
  }
}
