/**
 * Memory Chain Bootstrap Hook Handler
 *
 * Injects relevant memories into the agent's system prompt on session start.
 * Follows OpenClaw's HookHandler interface.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';

// Note: These imports require witness-memory-chain to be installed
// In production, this would be: import { ... } from 'witness-memory-chain';
import {
  initIndex,
  closeIndex,
  getMemoryCount,
  rebuildFromChain,
  readChain,
  createContentLoader,
  retrieveMemories,
  retrieveContext,
  formatMemoriesForPrompt,
} from 'witness-memory-chain';

/** OpenClaw HookEvent interface (subset of what we need) */
interface HookEvent {
  type: 'command' | 'session' | 'agent' | 'gateway';
  action: string;
  sessionKey: string;
  timestamp: Date;
  messages: string[];
  context: {
    sessionEntry?: unknown;
    sessionId?: string;
    sessionFile?: string;
    commandSource?: string;
    senderId?: string;
    workspaceDir?: string;
    bootstrapFiles?: WorkspaceBootstrapFile[];
    cfg?: unknown;
  };
}

interface WorkspaceBootstrapFile {
  name: string;
  content: string;
  path?: string;
}

/** HookHandler type */
type HookHandler = (event: HookEvent) => Promise<void> | void;

/**
 * Memory Chain Bootstrap Handler
 *
 * Triggered on agent:bootstrap event to inject memories into system prompt.
 */
const handler: HookHandler = async (event) => {
  // Only handle agent:bootstrap events
  if (event.type !== 'agent' || event.action !== 'bootstrap') {
    return;
  }

  // Get configuration from environment or use defaults
  const dataDir = process.env.MEMORY_CHAIN_DIR
    ? process.env.MEMORY_CHAIN_DIR.replace('~', homedir())
    : join(homedir(), '.openclaw', 'memory-chain');
  const maxTokens = parseInt(process.env.MEMORY_CHAIN_MAX_TOKENS ?? '2000', 10);
  const maxResults = parseInt(process.env.MEMORY_CHAIN_MAX_RESULTS ?? '20', 10);

  try {
    // Check if chain exists
    let entries;
    try {
      entries = await readChain(dataDir);
    } catch {
      // Chain doesn't exist - nothing to inject
      console.log('[memory-chain-bootstrap] No chain found, skipping');
      return;
    }

    if (entries.length === 0) {
      return;
    }

    // Initialize index
    const dbPath = join(dataDir, 'memory.db');
    const db = initIndex(dbPath);

    // Rebuild index if empty
    if (getMemoryCount(db) === 0) {
      const contentDir = join(dataDir, 'content');
      const contentLoader = createContentLoader(contentDir);
      await rebuildFromChain(db, entries, contentLoader);
    }

    // Retrieve relevant memories (general context on bootstrap)
    const memories = retrieveContext(db, { maxTokens, maxResults });

    closeIndex(db);

    if (memories.length === 0) {
      return;
    }

    // Format memories for prompt injection
    const memoryBlock = formatMemoriesForPrompt(memories);

    // Inject as a bootstrap file
    if (!event.context.bootstrapFiles) {
      event.context.bootstrapFiles = [];
    }

    event.context.bootstrapFiles.push({
      name: 'MEMORY_CHAIN.md',
      content: `# Memory Chain Context\n\nThe following memories were retrieved from your cryptographic Memory Chain:\n\n${memoryBlock}`,
    });

    console.log(`[memory-chain-bootstrap] Injected ${memories.length} memories`);
  } catch (error) {
    console.error('[memory-chain-bootstrap] Error:', error);
    // Don't throw - allow agent to continue without memories
  }
};

export default handler;
