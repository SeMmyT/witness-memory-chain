/**
 * Chain Operations
 *
 * Core operations for the memory chain: init, add, read, verify.
 * The chain is stored as a JSONL file with atomic appends via proper-lockfile.
 */

import { readFile, writeFile, appendFile, mkdir, access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import {
  sha256Hash,
  generateKeyPair,
  sign,
  verifySignature,
  canonicalizeEntry,
  hashEntry,
  keyToHex,
  hexToKey,
  getPublicKey,
  encryptPrivateKey,
  decryptPrivateKey,
} from './crypto.js';
import { getContentVerified, ContentIntegrityError } from '../storage/content-store.js';
import type {
  ChainEntry,
  ChainEntryInput,
  ChainConfig,
  VerificationResult,
  VerificationError,
  Tier,
  KeyMode,
  EncryptionOptions,
  EncryptedKeyFile,
} from '../types.js';

// File names in the chain directory
const CHAIN_FILE = 'chain.jsonl';
const CONFIG_FILE = 'config.json';
const PRIVATE_KEY_FILE = 'agent.key';
const PRIVATE_KEY_ENCRYPTED_FILE = 'agent.key.enc';
const PUBLIC_KEY_FILE = 'agent.pub';
const CONTENT_DIR = 'content';

// Environment variable for key storage
const KEY_ENV_VAR = 'MEMORY_CHAIN_PRIVATE_KEY';

// Chain version
const CHAIN_VERSION = '1.0.0';

// Input validation limits
const MAX_CONTENT_SIZE = 1024 * 1024; // 1MB
const MAX_AGENT_NAME_LENGTH = 256;
const MAX_METADATA_DEPTH = 5;
const MAX_METADATA_STRING_LENGTH = 10000;

// ============================================================================
// Input Validation
// ============================================================================

/**
 * Validate that a value is a JSON-serializable primitive or nested structure
 * @param value - Value to validate
 * @param depth - Current recursion depth
 * @returns true if valid, throws Error if invalid
 */
function validateMetadataValue(value: unknown, depth = 0): boolean {
  if (depth > MAX_METADATA_DEPTH) {
    throw new Error(`Metadata exceeds maximum nesting depth of ${MAX_METADATA_DEPTH}`);
  }

  if (value === null) return true;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Metadata numbers must be finite');
    }
    return true;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_METADATA_STRING_LENGTH) {
      throw new Error(`Metadata string exceeds maximum length of ${MAX_METADATA_STRING_LENGTH}`);
    }
    return true;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      validateMetadataValue(item, depth + 1);
    }
    return true;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      validateMetadataValue((value as Record<string, unknown>)[key], depth + 1);
    }
    return true;
  }

  throw new Error(`Invalid metadata value type: ${typeof value}`);
}

/**
 * Validate metadata object
 * @param metadata - Metadata to validate
 */
function validateMetadata(metadata: Record<string, unknown> | undefined): void {
  if (metadata === undefined) return;

  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new Error('Metadata must be an object');
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (typeof key !== 'string') {
      throw new Error('Metadata keys must be strings');
    }
    validateMetadataValue(value, 0);
  }
}

/**
 * Validate content size
 * @param content - Content to validate
 */
function validateContent(content: string): void {
  if (typeof content !== 'string') {
    throw new Error('Content must be a string');
  }
  if (content.length > MAX_CONTENT_SIZE) {
    throw new Error(`Content exceeds maximum size of ${MAX_CONTENT_SIZE} bytes`);
  }
}

/**
 * Validate agent name
 * @param agentName - Agent name to validate
 */
function validateAgentName(agentName: string): void {
  if (typeof agentName !== 'string') {
    throw new Error('Agent name must be a string');
  }
  if (agentName.length === 0) {
    throw new Error('Agent name cannot be empty');
  }
  if (agentName.length > MAX_AGENT_NAME_LENGTH) {
    throw new Error(`Agent name exceeds maximum length of ${MAX_AGENT_NAME_LENGTH}`);
  }
}

// ============================================================================
// Directory Structure
// ============================================================================

/**
 * Ensure the chain directory structure exists
 */
async function ensureDirectories(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await mkdir(join(dataDir, CONTENT_DIR), { recursive: true });
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
// Key Management
// ============================================================================

/** Password provider function type */
export type PasswordProvider = () => Promise<string>;

/** Global password provider for encrypted keys */
let globalPasswordProvider: PasswordProvider | null = null;

/**
 * Set the global password provider for encrypted key operations
 * @param provider - Async function that returns the password
 */
export function setPasswordProvider(provider: PasswordProvider | null): void {
  globalPasswordProvider = provider;
}

/**
 * Load private key based on key mode
 * @param dataDir - Chain directory
 * @param keyMode - Key storage mode (defaults to config value if not specified)
 * @returns Decrypted private key
 */
export async function loadPrivateKey(dataDir: string, keyMode?: KeyMode): Promise<Uint8Array> {
  // If keyMode not specified, load from config
  if (!keyMode) {
    const config = await loadConfig(dataDir);
    keyMode = config.keyMode;
  }
  switch (keyMode) {
    case 'raw': {
      const keyPath = join(dataDir, PRIVATE_KEY_FILE);
      const hex = await readFile(keyPath, 'utf-8');
      return hexToKey(hex.trim());
    }

    case 'encrypted': {
      if (!globalPasswordProvider) {
        throw new Error('No password provider set. Call setPasswordProvider() before using encrypted keys.');
      }
      const encKeyPath = join(dataDir, PRIVATE_KEY_ENCRYPTED_FILE);
      const encKeyJson = await readFile(encKeyPath, 'utf-8');
      const encryptedKey = JSON.parse(encKeyJson) as EncryptedKeyFile;
      const password = await globalPasswordProvider();
      return decryptPrivateKey(encryptedKey, password);
    }

    case 'env': {
      const hexKey = process.env[KEY_ENV_VAR];
      if (!hexKey) {
        throw new Error(`Environment variable ${KEY_ENV_VAR} not set`);
      }
      return hexToKey(hexKey.trim());
    }

    default:
      throw new Error(`Unsupported key mode: ${keyMode}`);
  }
}

/**
 * Load public key from file
 */
async function loadPublicKey(dataDir: string): Promise<Uint8Array> {
  const keyPath = join(dataDir, PUBLIC_KEY_FILE);
  const hex = await readFile(keyPath, 'utf-8');
  return hexToKey(hex.trim());
}

/**
 * Save key pair to files
 * @param dataDir - Chain directory
 * @param privateKey - Private key bytes
 * @param publicKey - Public key bytes
 * @param keyMode - Storage mode for private key
 * @param encryptionOptions - Options for encrypted mode
 */
async function saveKeyPair(
  dataDir: string,
  privateKey: Uint8Array,
  publicKey: Uint8Array,
  keyMode: KeyMode = 'raw',
  encryptionOptions?: EncryptionOptions
): Promise<void> {
  const publicKeyPath = join(dataDir, PUBLIC_KEY_FILE);

  // Always save public key
  await writeFile(publicKeyPath, keyToHex(publicKey), { mode: 0o644 });

  switch (keyMode) {
    case 'raw': {
      const privateKeyPath = join(dataDir, PRIVATE_KEY_FILE);
      await writeFile(privateKeyPath, keyToHex(privateKey), { mode: 0o600 });
      break;
    }

    case 'encrypted': {
      if (!globalPasswordProvider) {
        throw new Error('No password provider set. Call setPasswordProvider() before using encrypted keys.');
      }
      const password = await globalPasswordProvider();
      const encryptedKey = encryptPrivateKey(privateKey, password, encryptionOptions);
      const encKeyPath = join(dataDir, PRIVATE_KEY_ENCRYPTED_FILE);
      await writeFile(encKeyPath, JSON.stringify(encryptedKey, null, 2), { mode: 0o600 });
      break;
    }

    case 'env': {
      // For env mode, we print the key and expect the user to set it
      console.log(`Set the following environment variable to use this chain:`);
      console.log(`${KEY_ENV_VAR}=${keyToHex(privateKey)}`);
      // Also save a backup raw key file (with warning)
      const backupPath = join(dataDir, PRIVATE_KEY_FILE + '.backup');
      await writeFile(backupPath, keyToHex(privateKey), { mode: 0o600 });
      console.log(`Backup key saved to: ${backupPath} (delete after setting env var)`);
      break;
    }
  }
}

// ============================================================================
// Config Management
// ============================================================================

/**
 * Load chain configuration
 */
export async function loadConfig(dataDir: string): Promise<ChainConfig> {
  const configPath = join(dataDir, CONFIG_FILE);
  const content = await readFile(configPath, 'utf-8');
  return JSON.parse(content) as ChainConfig;
}

/**
 * Save chain configuration
 */
async function saveConfig(dataDir: string, config: ChainConfig): Promise<void> {
  const configPath = join(dataDir, CONFIG_FILE);
  await writeFile(configPath, JSON.stringify(config, null, 2));
}

// ============================================================================
// Chain Initialization
// ============================================================================

/** Options for initializing a chain */
export interface InitChainOptions {
  /** Agent name (default: 'Agent') */
  agentName?: string;
  /** Key storage mode (default: 'raw') */
  keyMode?: KeyMode;
  /** Encryption options (only used when keyMode is 'encrypted') */
  encryptionOptions?: EncryptionOptions;
}

/**
 * Initialize a new memory chain
 *
 * Creates:
 * - Key pair (agent.key, agent.pub)
 * - Configuration (config.json)
 * - Genesis entry (chain.jsonl)
 * - Content directory
 *
 * @param dataDir - Directory to store chain data
 * @param optionsOrAgentName - Options object or agent name (for backwards compatibility)
 * @throws Error if chain already exists
 */
export async function initChain(
  dataDir: string,
  optionsOrAgentName: InitChainOptions | string = 'Agent'
): Promise<void> {
  // Handle backwards compatibility
  const options: InitChainOptions =
    typeof optionsOrAgentName === 'string'
      ? { agentName: optionsOrAgentName }
      : optionsOrAgentName;

  const agentName = options.agentName ?? 'Agent';
  const keyMode = options.keyMode ?? 'raw';

  // Validate input
  validateAgentName(agentName);

  const chainPath = join(dataDir, CHAIN_FILE);

  // Check if chain already exists
  if (await fileExists(chainPath)) {
    throw new Error(`Chain already exists at ${dataDir}`);
  }

  // Create directory structure
  await ensureDirectories(dataDir);

  // Generate key pair
  const { privateKey, publicKey } = await generateKeyPair();
  await saveKeyPair(dataDir, privateKey, publicKey, keyMode, options.encryptionOptions);

  // Create config
  const config: ChainConfig = {
    agentName,
    keyMode,
    createdAt: new Date().toISOString(),
    version: CHAIN_VERSION,
  };
  await saveConfig(dataDir, config);

  // Create genesis entry
  const genesisContent = JSON.stringify({
    event: 'genesis',
    agentName,
    message: `Memory chain initialized for ${agentName}`,
  });
  const contentHash = sha256Hash(genesisContent);

  const genesisEntry: Omit<ChainEntry, 'signature'> = {
    seq: 0,
    ts: new Date().toISOString(),
    type: 'identity',
    tier: 'committed',
    content_hash: contentHash,
    prev_hash: null,
    metadata: { genesis: true },
  };

  // Sign the entry
  const canonical = canonicalizeEntry(genesisEntry);
  const signature = await sign(canonical, privateKey);

  const signedEntry: ChainEntry = {
    ...genesisEntry,
    signature,
  };

  // Write genesis entry and content
  await writeFile(chainPath, JSON.stringify(signedEntry) + '\n');

  // Store genesis content
  const hashHex = contentHash.slice(7); // Remove "sha256:" prefix
  await writeFile(join(dataDir, CONTENT_DIR, hashHex), genesisContent);
}

// ============================================================================
// Chain Operations
// ============================================================================

/**
 * Read all entries from the chain
 */
export async function readChain(dataDir: string): Promise<ChainEntry[]> {
  const chainPath = join(dataDir, CHAIN_FILE);

  if (!(await fileExists(chainPath))) {
    return [];
  }

  const content = await readFile(chainPath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  return lines.map((line) => JSON.parse(line) as ChainEntry);
}

/**
 * Get the last entry in the chain
 */
export async function getLastEntry(dataDir: string): Promise<ChainEntry | null> {
  const entries = await readChain(dataDir);
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

/**
 * Add a new entry to the chain
 *
 * Uses file locking to ensure atomic appends.
 *
 * @param dataDir - Chain directory
 * @param input - Entry data
 * @returns The created entry
 */
export async function addEntry(dataDir: string, input: ChainEntryInput): Promise<ChainEntry> {
  // Validate input
  validateContent(input.content);
  validateMetadata(input.metadata);

  const chainPath = join(dataDir, CHAIN_FILE);

  if (!(await fileExists(chainPath))) {
    throw new Error(`Chain not initialized at ${dataDir}. Run 'memory-chain init' first.`);
  }

  // Acquire lock for atomic append
  const release = await lockfile.lock(chainPath, {
    retries: {
      retries: 10,
      factor: 2,
      minTimeout: 50,
      maxTimeout: 2000,
      randomize: true,
    },
  });

  try {
    // Load config to get key mode
    const config = await loadConfig(dataDir);

    // Load keys
    const privateKey = await loadPrivateKey(dataDir, config.keyMode);

    // Get last entry for linking
    const lastEntry = await getLastEntry(dataDir);
    if (!lastEntry) {
      throw new Error('Chain is empty - this should not happen');
    }

    // Compute hashes
    const contentHash = sha256Hash(input.content);
    const prevHash = hashEntry(lastEntry);

    // Create entry
    const tier: Tier = input.tier ?? 'relationship';
    const entry: Omit<ChainEntry, 'signature'> = {
      seq: lastEntry.seq + 1,
      ts: new Date().toISOString(),
      type: input.type,
      tier,
      content_hash: contentHash,
      prev_hash: prevHash,
      metadata: input.metadata,
    };

    // Sign
    const canonical = canonicalizeEntry(entry);
    const signature = await sign(canonical, privateKey);

    const signedEntry: ChainEntry = {
      ...entry,
      signature,
    };

    // Append to chain
    await appendFile(chainPath, JSON.stringify(signedEntry) + '\n');

    // Store content
    const hashHex = contentHash.slice(7);
    await writeFile(join(dataDir, CONTENT_DIR, hashHex), input.content);

    return signedEntry;
  } finally {
    await release();
  }
}

// ============================================================================
// Chain Verification
// ============================================================================

/**
 * Verify the integrity of the entire chain
 *
 * Checks:
 * - Hash chain links correctly
 * - All signatures are valid
 * - Sequence numbers are contiguous
 * - Timestamps are monotonically increasing
 */
export async function verifyChain(dataDir: string): Promise<VerificationResult> {
  const entries = await readChain(dataDir);
  const errors: VerificationError[] = [];
  let redactedCount = 0;

  if (entries.length === 0) {
    return {
      valid: true,
      entriesChecked: 0,
      errors: [],
      summary: {
        firstEntry: 0,
        lastEntry: 0,
        totalEntries: 0,
        redactedEntries: 0,
      },
    };
  }

  // Load public key
  const publicKey = await loadPublicKey(dataDir);

  // Verify each entry
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Check sequence
    if (entry.seq !== i) {
      errors.push({
        seq: entry.seq,
        type: 'sequence_gap',
        message: `Expected sequence ${i}, got ${entry.seq}`,
      });
    }

    // Check prev_hash for non-genesis entries
    if (i > 0) {
      const expectedPrevHash = hashEntry(entries[i - 1]);
      if (entry.prev_hash !== expectedPrevHash) {
        errors.push({
          seq: entry.seq,
          type: 'hash_mismatch',
          message: `prev_hash mismatch: expected ${expectedPrevHash}, got ${entry.prev_hash}`,
        });
      }
    } else {
      // Genesis entry should have null prev_hash
      if (entry.prev_hash !== null) {
        errors.push({
          seq: entry.seq,
          type: 'hash_mismatch',
          message: `Genesis entry should have null prev_hash`,
        });
      }
    }

    // Check timestamp ordering (must be strictly increasing)
    if (i > 0) {
      const prevTs = new Date(entries[i - 1].ts).getTime();
      const currTs = new Date(entry.ts).getTime();
      if (currTs <= prevTs) {
        errors.push({
          seq: entry.seq,
          type: 'timestamp_invalid',
          message: `Timestamp ${entry.ts} is not strictly after previous entry ${entries[i - 1].ts}`,
        });
      }
    }

    // Verify signature
    const canonical = canonicalizeEntry(entry);
    const validSig = await verifySignature(canonical, entry.signature, publicKey);
    if (!validSig) {
      errors.push({
        seq: entry.seq,
        type: 'signature_invalid',
        message: `Invalid signature for entry ${entry.seq}`,
      });
    }

    // Verify content hash matches stored content
    const contentDir = join(dataDir, CONTENT_DIR);
    try {
      await getContentVerified(contentDir, entry.content_hash);
      // content === null means file is missing (possibly redacted)
      // We only flag as error if content exists but hash doesn't match
      // Missing content could be intentional redaction - not an error
    } catch (err) {
      if (err instanceof ContentIntegrityError) {
        // Content exists but hash doesn't match - TAMPERING!
        errors.push({
          seq: entry.seq,
          type: 'content_mismatch',
          message: `Content tampered for entry ${entry.seq}: expected ${err.expectedHash}, got ${err.actualHash}`,
        });
      } else {
        throw err;
      }
    }

    // Count redacted entries (by type marker)
    if (entry.type === 'redaction') {
      redactedCount++;
    }
  }

  return {
    valid: errors.length === 0,
    entriesChecked: entries.length,
    errors,
    summary: {
      firstEntry: entries[0].seq,
      lastEntry: entries[entries.length - 1].seq,
      totalEntries: entries.length,
      redactedEntries: redactedCount,
    },
  };
}

/**
 * Get chain statistics
 */
export async function getChainStats(dataDir: string): Promise<{
  totalEntries: number;
  byType: Record<string, number>;
  byTier: Record<string, number>;
  firstEntry: string | null;
  lastEntry: string | null;
}> {
  const entries = await readChain(dataDir);

  const byType: Record<string, number> = {};
  const byTier: Record<string, number> = {};

  for (const entry of entries) {
    byType[entry.type] = (byType[entry.type] || 0) + 1;
    byTier[entry.tier] = (byTier[entry.tier] || 0) + 1;
  }

  return {
    totalEntries: entries.length,
    byType,
    byTier,
    firstEntry: entries[0]?.ts ?? null,
    lastEntry: entries[entries.length - 1]?.ts ?? null,
  };
}
