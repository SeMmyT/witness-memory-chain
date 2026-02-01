/**
 * Agent Bootstrap Hook
 *
 * Loads relevant memories on agent startup and injects them into the system prompt.
 * This hook is called by OpenClaw gateway when a new conversation begins.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  initIndex,
  closeIndex,
  getMemoryCount,
  rebuildFromChain,
} from '@witness/memory-chain';
import {
  readChain,
  loadConfig,
} from '@witness/memory-chain';
import {
  createContentLoader,
} from '@witness/memory-chain';
import {
  retrieveMemories,
  retrieveContext,
  formatMemoriesForPrompt,
} from '@witness/memory-chain';

/** Configuration for the memory injection hook */
export interface BootstrapConfig {
  /** Data directory for memory chain (default: ~/.openclaw/memory-chain) */
  dataDir?: string;
  /** Maximum tokens to inject (default: 2000) */
  maxTokens?: number;
  /** Maximum number of memories to retrieve (default: 20) */
  maxResults?: number;
  /** Whether to rebuild index on startup (default: false) */
  rebuildIndex?: boolean;
}

/** Context provided by OpenClaw gateway */
export interface BootstrapContext {
  /** Current conversation or user message for context-aware retrieval */
  userMessage?: string;
  /** User identifier (for logging) */
  userId?: string;
  /** Chat type (private, group, etc.) */
  chatType?: string;
  /** Existing system prompt to augment */
  systemPrompt?: string;
  /** Skill configuration */
  config?: BootstrapConfig;
}

/** Result of the bootstrap hook */
export interface BootstrapResult {
  /** Augmented system prompt with memories injected */
  systemPrompt: string;
  /** Number of memories injected */
  memoriesInjected: number;
  /** Estimated tokens used */
  tokensUsed: number;
}

/**
 * Main bootstrap hook function
 *
 * Called by OpenClaw gateway on agent startup to inject relevant memories.
 *
 * @param context - Context provided by the gateway
 * @returns Result with augmented system prompt
 */
export async function bootstrap(context: BootstrapContext): Promise<BootstrapResult> {
  const config = context.config ?? {};
  const dataDir = config.dataDir ?? join(homedir(), '.openclaw', 'memory-chain');
  const maxTokens = config.maxTokens ?? 2000;
  const maxResults = config.maxResults ?? 20;
  const rebuildIndex = config.rebuildIndex ?? false;

  const basePrompt = context.systemPrompt ?? '';

  try {
    // Check if chain exists
    let entries;
    try {
      entries = await readChain(dataDir);
    } catch {
      // Chain doesn't exist - return base prompt unchanged
      return {
        systemPrompt: basePrompt,
        memoriesInjected: 0,
        tokensUsed: 0,
      };
    }

    if (entries.length === 0) {
      return {
        systemPrompt: basePrompt,
        memoriesInjected: 0,
        tokensUsed: 0,
      };
    }

    // Initialize index
    const dbPath = join(dataDir, 'memory.db');
    const db = initIndex(dbPath);

    // Rebuild index if requested or if empty
    if (rebuildIndex || getMemoryCount(db) === 0) {
      const contentDir = join(dataDir, 'content');
      const contentLoader = createContentLoader(contentDir);
      await rebuildFromChain(db, entries, contentLoader);
    }

    // Retrieve relevant memories
    let memories;
    if (context.userMessage?.trim()) {
      // Context-aware retrieval based on user message
      memories = retrieveMemories(db, context.userMessage, { maxTokens, maxResults });
    } else {
      // General context retrieval (recent + important)
      memories = retrieveContext(db, { maxTokens, maxResults });
    }

    closeIndex(db);

    if (memories.length === 0) {
      return {
        systemPrompt: basePrompt,
        memoriesInjected: 0,
        tokensUsed: 0,
      };
    }

    // Format memories for prompt injection
    const memoryBlock = formatMemoriesForPrompt(memories);

    // Estimate tokens used (rough estimate: ~4 chars per token)
    const tokensUsed = Math.ceil(memoryBlock.length / 4);

    // Augment system prompt
    const augmentedPrompt = basePrompt
      ? `${basePrompt}\n\n${memoryBlock}`
      : memoryBlock;

    return {
      systemPrompt: augmentedPrompt,
      memoriesInjected: memories.length,
      tokensUsed,
    };
  } catch (error) {
    // On error, return base prompt unchanged
    console.error('[memory-chain] Bootstrap error:', error);
    return {
      systemPrompt: basePrompt,
      memoriesInjected: 0,
      tokensUsed: 0,
    };
  }
}

// Export as default for OpenClaw hook loader
export default bootstrap;
