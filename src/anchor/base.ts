/**
 * Base Blockchain Anchor Provider
 *
 * Anchors memory chain state to Base L2 using the WitnessRegistry contract.
 * Requires $WITNESS tokens for anchoring fees.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  toHex,
  type PublicClient,
  type WalletClient,
  type Log,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { sign } from '@noble/ed25519';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hashEntry } from '../chain/crypto.js';
import { readChain, loadConfig, loadPrivateKey } from '../chain/index.js';
import type { ChainEntry, ChainConfig } from '../types.js';
import type {
  AnchorProvider,
  AnchorProviderType,
  ProviderSubmitResult,
  ProviderVerifyResult,
  ProviderAnchorRecord,
  ProviderCostEstimate,
  ProviderSubmitOptions,
  ProviderVerifyOptions,
} from './provider.js';

// ============================================================================
// Types
// ============================================================================

/** Configuration for Base anchoring */
export interface BaseAnchorConfig {
  /** WitnessRegistry contract address */
  registryAddress: `0x${string}`;
  /** WITNESS token address */
  witnessTokenAddress: `0x${string}`;
  /** RPC URL for Base */
  rpcUrl: string;
  /** Use testnet (Base Sepolia) instead of mainnet */
  testnet?: boolean;
}

/** Receipt from a successful anchor transaction */
export interface BaseAnchorReceipt {
  /** Transaction hash */
  txHash: `0x${string}`;
  /** Block number */
  blockNumber: bigint;
  /** Anchor index in the registry */
  anchorIndex: number;
  /** Chain root that was anchored */
  chainRoot: `0x${string}`;
  /** Entry count at anchor time */
  entryCount: number;
  /** Timestamp of anchor */
  timestamp: number;
  /** Gas used */
  gasUsed: bigint;
  /** ETH dust fee paid */
  ethDustFee: bigint;
}

/** On-chain anchor data */
export interface OnChainAnchor {
  chainRoot: `0x${string}`;
  entryCount: bigint;
  timestamp: bigint;
  blockNumber: bigint;
  signature: `0x${string}`;
}

/** Result of verifying against on-chain anchor */
export interface BaseVerificationResult {
  /** Whether local chain matches on-chain anchor */
  valid: boolean;
  /** On-chain anchor timestamp */
  anchoredAt: number;
  /** Entry count from anchor */
  entryCount: number;
  /** Block number of anchor */
  blockNumber: bigint;
  /** Chain root from on-chain */
  chainRoot: `0x${string}`;
  /** Local chain root for comparison */
  localRoot: `0x${string}`;
}

/** Stored anchor record */
interface StoredBaseAnchor {
  txHash: `0x${string}`;
  blockNumber: string; // bigint as string for JSON
  anchorIndex: number;
  chainRoot: `0x${string}`;
  entryCount: number;
  timestamp: string;
  agentPubKeyHash: `0x${string}`;
}

/** File format for stored anchors */
interface BaseAnchorsFile {
  version: 1;
  anchors: StoredBaseAnchor[];
}

// ============================================================================
// Contract ABIs
// ============================================================================

const REGISTRY_ABI = [
  {
    name: 'anchor',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'agentPubKeyHash', type: 'bytes32' },
      { name: 'chainRoot', type: 'bytes32' },
      { name: 'entryCount', type: 'uint64' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'getLatestAnchor',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentPubKeyHash', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'chainRoot', type: 'bytes32' },
          { name: 'entryCount', type: 'uint64' },
          { name: 'timestamp', type: 'uint64' },
          { name: 'blockNumber', type: 'uint64' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
  },
  {
    name: 'getAnchor',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentPubKeyHash', type: 'bytes32' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'chainRoot', type: 'bytes32' },
          { name: 'entryCount', type: 'uint64' },
          { name: 'timestamp', type: 'uint64' },
          { name: 'blockNumber', type: 'uint64' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
  },
  {
    name: 'getAnchorHistory',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'agentPubKeyHash', type: 'bytes32' },
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'chainRoot', type: 'bytes32' },
          { name: 'entryCount', type: 'uint64' },
          { name: 'timestamp', type: 'uint64' },
          { name: 'blockNumber', type: 'uint64' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
  },
  {
    name: 'anchorCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentPubKeyHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'anchorFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'ethDustFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'witnessToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

// Event topic for Anchored event
const ANCHORED_EVENT_TOPIC = keccak256(
  toBytes('Anchored(bytes32,bytes32,uint64,uint256,uint256)')
);

// ============================================================================
// File Management
// ============================================================================

const BASE_ANCHORS_DIR = 'anchors';
const BASE_ANCHORS_FILE = 'base-anchors.json';

async function ensureAnchorsDir(dataDir: string): Promise<string> {
  const dir = join(dataDir, BASE_ANCHORS_DIR);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function loadBaseAnchors(dataDir: string): Promise<BaseAnchorsFile> {
  const anchorsDir = await ensureAnchorsDir(dataDir);
  const filePath = join(anchorsDir, BASE_ANCHORS_FILE);
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as BaseAnchorsFile;
  } catch {
    return { version: 1, anchors: [] };
  }
}

async function saveBaseAnchors(dataDir: string, data: BaseAnchorsFile): Promise<void> {
  const anchorsDir = await ensureAnchorsDir(dataDir);
  const filePath = join(anchorsDir, BASE_ANCHORS_FILE);
  await writeFile(filePath, JSON.stringify(data, null, 2));
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Compute the chain root hash (tip of the chain)
 */
function computeChainRoot(entries: ChainEntry[]): `0x${string}` {
  if (entries.length === 0) {
    throw new Error('Cannot compute root of empty chain');
  }
  const lastEntry = entries[entries.length - 1];
  const hash = hashEntry(lastEntry);
  // Remove "sha256:" prefix and ensure it's a valid hex string
  const hexHash = hash.startsWith('sha256:') ? hash.slice(7) : hash;
  return `0x${hexHash}` as `0x${string}`;
}

/**
 * Compute the agent public key hash for the registry
 */
async function computeAgentPubKeyHash(dataDir: string): Promise<`0x${string}`> {
  const config = await loadConfig(dataDir);
  const keyPath = join(dataDir, 'keys', 'public.key');
  const pubKeyHex = await readFile(keyPath, 'utf-8');
  return keccak256(toBytes(`0x${pubKeyHex.trim()}`));
}

/**
 * Encode anchor data for Ed25519 signing
 */
function encodeAnchorData(
  chainRoot: `0x${string}`,
  entryCount: number,
  chainId: number
): Uint8Array {
  // Pack: chainRoot (32) + entryCount (8) + chainId (8) = 48 bytes
  const buffer = new ArrayBuffer(48);
  const view = new DataView(buffer);
  const arr = new Uint8Array(buffer);

  // chainRoot (32 bytes)
  const rootBytes = toBytes(chainRoot);
  arr.set(rootBytes.slice(0, 32), 0);

  // entryCount (8 bytes, big-endian)
  view.setBigUint64(32, BigInt(entryCount), false);

  // chainId (8 bytes, big-endian)
  view.setBigUint64(40, BigInt(chainId), false);

  return arr;
}

/**
 * Anchor the current chain state to Base blockchain
 */
export async function anchorToBase(
  dataDir: string,
  config: BaseAnchorConfig,
  walletPrivateKey: `0x${string}`
): Promise<BaseAnchorReceipt> {
  const chain = config.testnet ? baseSepolia : base;

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });

  const account = privateKeyToAccount(walletPrivateKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });

  // Load chain data
  const entries = await readChain(dataDir);
  if (entries.length === 0) {
    throw new Error('Chain is empty');
  }

  const chainRoot = computeChainRoot(entries);
  const entryCount = entries.length;
  const agentPubKeyHash = await computeAgentPubKeyHash(dataDir);

  // Load agent's Ed25519 private key for signing
  const agentPrivateKey = await loadPrivateKey(dataDir);

  // Sign anchor data
  const anchorData = encodeAnchorData(chainRoot, entryCount, chain.id);
  const signature = await sign(anchorData, agentPrivateKey);
  const signatureHex = `0x${toHex(signature).slice(2)}` as `0x${string}`;

  // Get fees from contract
  const [witnessFee, ethDustFee] = await Promise.all([
    publicClient.readContract({
      address: config.registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'anchorFee',
    }),
    publicClient.readContract({
      address: config.registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'ethDustFee',
    }),
  ]);

  // Approve WITNESS token spend if needed
  if (witnessFee > 0n) {
    const allowance = await publicClient.readContract({
      address: config.witnessTokenAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, config.registryAddress],
    });

    if (allowance < witnessFee) {
      // Approve enough for multiple future anchors
      const approveAmount = witnessFee * 100n;
      const approveTx = await walletClient.writeContract({
        address: config.witnessTokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [config.registryAddress, approveAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });
    }
  }

  // Submit anchor transaction with ETH dust fee
  const txHash = await walletClient.writeContract({
    address: config.registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'anchor',
    args: [agentPubKeyHash, chainRoot, BigInt(entryCount), signatureHex],
    value: ethDustFee,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Parse anchor index from event
  let anchorIndex = 0;
  const anchorEvent = receipt.logs.find(
    (log: Log) => log.topics[0] === ANCHORED_EVENT_TOPIC
  );
  if (anchorEvent && anchorEvent.topics[3]) {
    anchorIndex = Number(BigInt(anchorEvent.topics[3]));
  }

  const result: BaseAnchorReceipt = {
    txHash,
    blockNumber: receipt.blockNumber,
    anchorIndex,
    chainRoot,
    entryCount,
    timestamp: Date.now(),
    gasUsed: receipt.gasUsed,
    ethDustFee,
  };

  // Store locally
  const stored = await loadBaseAnchors(dataDir);
  stored.anchors.push({
    txHash,
    blockNumber: receipt.blockNumber.toString(),
    anchorIndex,
    chainRoot,
    entryCount,
    timestamp: new Date().toISOString(),
    agentPubKeyHash,
  });
  await saveBaseAnchors(dataDir, stored);

  return result;
}

/**
 * Verify local chain against on-chain anchor
 */
export async function verifyAgainstBase(
  dataDir: string,
  config: BaseAnchorConfig
): Promise<BaseVerificationResult> {
  const chain = config.testnet ? baseSepolia : base;

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });

  const agentPubKeyHash = await computeAgentPubKeyHash(dataDir);

  // Get latest on-chain anchor
  const onChainAnchor = (await publicClient.readContract({
    address: config.registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'getLatestAnchor',
    args: [agentPubKeyHash],
  })) as OnChainAnchor;

  // Compute local chain root
  const entries = await readChain(dataDir);
  const localRoot = computeChainRoot(entries);

  return {
    valid: localRoot === onChainAnchor.chainRoot,
    anchoredAt: Number(onChainAnchor.timestamp) * 1000,
    entryCount: Number(onChainAnchor.entryCount),
    blockNumber: onChainAnchor.blockNumber,
    chainRoot: onChainAnchor.chainRoot,
    localRoot,
  };
}

/**
 * Get anchor history from on-chain
 */
export async function getBaseAnchorHistory(
  dataDir: string,
  config: BaseAnchorConfig,
  offset = 0,
  limit = 100
): Promise<OnChainAnchor[]> {
  const chain = config.testnet ? baseSepolia : base;

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });

  const agentPubKeyHash = await computeAgentPubKeyHash(dataDir);

  return (await publicClient.readContract({
    address: config.registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'getAnchorHistory',
    args: [agentPubKeyHash, BigInt(offset), BigInt(limit)],
  })) as OnChainAnchor[];
}

/**
 * Get WITNESS token balance
 */
export async function getWitnessBalance(
  config: BaseAnchorConfig,
  address: `0x${string}`
): Promise<{ balance: bigint; formatted: string; symbol: string }> {
  const chain = config.testnet ? baseSepolia : base;

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });

  const [balance, decimals, symbol] = await Promise.all([
    publicClient.readContract({
      address: config.witnessTokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address],
    }),
    publicClient.readContract({
      address: config.witnessTokenAddress,
      abi: ERC20_ABI,
      functionName: 'decimals',
    }),
    publicClient.readContract({
      address: config.witnessTokenAddress,
      abi: ERC20_ABI,
      functionName: 'symbol',
    }),
  ]);

  const formatted = (Number(balance) / 10 ** decimals).toFixed(4);

  return { balance, formatted, symbol };
}

/**
 * Get current anchor fee (WITNESS tokens)
 */
export async function getAnchorFee(
  config: BaseAnchorConfig
): Promise<{ fee: bigint; formatted: string }> {
  const chain = config.testnet ? baseSepolia : base;

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });

  const [fee, decimals] = await Promise.all([
    publicClient.readContract({
      address: config.registryAddress,
      abi: REGISTRY_ABI,
      functionName: 'anchorFee',
    }),
    publicClient.readContract({
      address: config.witnessTokenAddress,
      abi: ERC20_ABI,
      functionName: 'decimals',
    }),
  ]);

  const formatted = (Number(fee) / 10 ** decimals).toFixed(4);

  return { fee, formatted };
}

/**
 * Get current ETH dust fee
 */
export async function getEthDustFee(
  config: BaseAnchorConfig
): Promise<{ fee: bigint; formatted: string }> {
  const chain = config.testnet ? baseSepolia : base;

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });

  const fee = await publicClient.readContract({
    address: config.registryAddress,
    abi: REGISTRY_ABI,
    functionName: 'ethDustFee',
  });

  // Format in ETH (18 decimals)
  const formatted = (Number(fee) / 1e18).toFixed(6);

  return { fee, formatted };
}

// ============================================================================
// Provider Implementation
// ============================================================================

/**
 * Base anchor provider implementing the AnchorProvider interface
 */
export class BaseAnchorProvider implements AnchorProvider {
  readonly type: AnchorProviderType = 'base';

  constructor(private config: BaseAnchorConfig) {}

  async submit(
    dataDir: string,
    _entry: ChainEntry | null,
    options?: ProviderSubmitOptions
  ): Promise<ProviderSubmitResult> {
    if (!options?.walletPrivateKey) {
      return {
        success: false,
        provider: this.type,
        error: 'Wallet private key required for Base anchoring',
      };
    }

    try {
      const receipt = await anchorToBase(dataDir, this.config, options.walletPrivateKey);
      return {
        success: true,
        provider: this.type,
        seq: receipt.entryCount,
        txHash: receipt.txHash,
      };
    } catch (error) {
      return {
        success: false,
        provider: this.type,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async verify(
    dataDir: string,
    _seq: number | null,
    _options?: ProviderVerifyOptions
  ): Promise<ProviderVerifyResult> {
    try {
      const result = await verifyAgainstBase(dataDir, this.config);
      return {
        valid: result.valid,
        provider: this.type,
        status: 'confirmed',
        blockNumber: result.blockNumber,
        timestamp: new Date(result.anchoredAt).toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Check if it's a "no anchors" error
      if (message.includes('No anchors')) {
        return {
          valid: false,
          provider: this.type,
          status: 'pending',
          error: 'No anchors found for this agent',
        };
      }
      return {
        valid: false,
        provider: this.type,
        status: 'failed',
        error: message,
      };
    }
  }

  async getStatus(dataDir: string, _seq?: number | null): Promise<ProviderAnchorRecord[]> {
    try {
      const stored = await loadBaseAnchors(dataDir);
      return stored.anchors.map((a) => ({
        provider: this.type,
        status: 'confirmed' as const,
        chainRoot: a.chainRoot,
        entryCount: a.entryCount,
        submittedAt: a.timestamp,
        confirmedAt: a.timestamp,
        blockNumber: BigInt(a.blockNumber),
        txHash: a.txHash,
      }));
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const chain = this.config.testnet ? baseSepolia : base;
      const publicClient = createPublicClient({
        chain,
        transport: http(this.config.rpcUrl),
      });

      // Try to read the anchor fee to verify contract is accessible
      await publicClient.readContract({
        address: this.config.registryAddress,
        abi: REGISTRY_ABI,
        functionName: 'anchorFee',
      });

      return true;
    } catch {
      return false;
    }
  }

  async estimateCost(count = 1): Promise<ProviderCostEstimate> {
    try {
      const { fee, formatted } = await getAnchorFee(this.config);
      return {
        provider: this.type,
        fee: fee * BigInt(count),
        feeFormatted: `${(parseFloat(formatted) * count).toFixed(4)} WITNESS`,
        available: true,
      };
    } catch {
      return {
        provider: this.type,
        fee: 0n,
        feeFormatted: 'Unknown',
        available: false,
      };
    }
  }
}
