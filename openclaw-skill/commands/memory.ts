/**
 * Memory Command Handler
 *
 * Handles /memory Telegram command for memory chain operations.
 * Called by OpenClaw gateway when user sends /memory in Telegram.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  initChain,
  addEntry,
  readChain,
  verifyChain,
  getChainStats,
  loadConfig,
  exportChain,
  initIndex,
  closeIndex,
  getMemoryCount,
  rebuildFromChain,
  retrieveMemories,
  formatMemoriesForPrompt,
  createContentLoader,
  getStorageStats,
  getAnchorStatus,
} from 'witness-memory-chain';
import type { ChainEntryInput, EntryType, Tier } from 'witness-memory-chain';

/** Configuration for the memory command */
export interface MemoryCommandConfig {
  /** Data directory for memory chain (default: ~/.openclaw/memory-chain) */
  dataDir?: string;
  /** Maximum tokens for search results (default: 2000) */
  maxTokens?: number;
  /** Maximum search results (default: 20) */
  maxResults?: number;
  /** Allow export in group chats (default: false for security) */
  allowGroupExport?: boolean;
}

/** Context provided by OpenClaw gateway */
export interface CommandContext {
  /** The command arguments (text after /memory) */
  args: string;
  /** User ID */
  userId: string;
  /** Chat ID */
  chatId: string;
  /** Chat type (private, group, supergroup) */
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  /** Username (if available) */
  username?: string;
  /** Skill configuration */
  config?: MemoryCommandConfig;
}

/** Result of command execution */
export interface CommandResult {
  /** Response text to send back */
  response: string;
  /** Whether this is an error response */
  error?: boolean;
  /** Optional file to send (for export) */
  file?: {
    content: string;
    filename: string;
    mimeType: string;
  };
}

/**
 * Parse command arguments
 */
function parseArgs(args: string): { subcommand: string; rest: string } {
  const trimmed = args.trim();
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) {
    return { subcommand: trimmed.toLowerCase(), rest: '' };
  }
  return {
    subcommand: trimmed.slice(0, spaceIndex).toLowerCase(),
    rest: trimmed.slice(spaceIndex + 1).trim(),
  };
}

/**
 * Handle /memory search <query>
 */
async function handleSearch(
  query: string,
  dataDir: string,
  maxTokens: number,
  maxResults: number
): Promise<CommandResult> {
  if (!query) {
    return {
      response: 'Usage: /memory search <query>\n\nExample: /memory search user preferences',
      error: true,
    };
  }

  try {
    const entries = await readChain(dataDir);
    if (entries.length === 0) {
      return {
        response: 'No memories found. The chain is empty.',
      };
    }

    const dbPath = join(dataDir, 'memory.db');
    const db = initIndex(dbPath);

    // Rebuild index if empty
    if (getMemoryCount(db) === 0) {
      const contentDir = join(dataDir, 'content');
      const contentLoader = createContentLoader(contentDir);
      await rebuildFromChain(db, entries, contentLoader);
    }

    const results = retrieveMemories(db, query, { maxTokens, maxResults });
    closeIndex(db);

    if (results.length === 0) {
      return {
        response: `No memories found matching "${query}".`,
      };
    }

    // Format results
    const lines = results.map((m, i) => {
      const text = m.summary ?? m.content;
      const preview = text.length > 100 ? text.slice(0, 100) + '...' : text;
      return `${i + 1}. [#${m.seq}] ${preview} (score: ${m.score.toFixed(2)})`;
    });

    return {
      response: `Found ${results.length} memories:\n\n${lines.join('\n\n')}`,
    };
  } catch (error) {
    return {
      response: `Error searching: ${error instanceof Error ? error.message : String(error)}`,
      error: true,
    };
  }
}

/**
 * Handle /memory commit <text>
 */
async function handleCommit(
  content: string,
  dataDir: string,
  metadata: Record<string, unknown>
): Promise<CommandResult> {
  if (!content) {
    return {
      response: 'Usage: /memory commit <text>\n\nExample: /memory commit User prefers dark mode',
      error: true,
    };
  }

  try {
    // Check if chain exists, initialize if not
    try {
      await loadConfig(dataDir);
    } catch {
      // Chain doesn't exist - initialize it
      await initChain(dataDir, { agentName: 'TelegramAgent' });
    }

    const input: ChainEntryInput = {
      type: 'memory',
      tier: 'relationship',
      content,
      metadata: {
        ...metadata,
        source: 'telegram-command',
        timestamp: new Date().toISOString(),
      },
    };

    const entry = await addEntry(dataDir, input);

    return {
      response: `Memory committed as entry #${entry.seq}.\nHash: ${entry.content_hash.slice(0, 20)}...`,
    };
  } catch (error) {
    return {
      response: `Error committing: ${error instanceof Error ? error.message : String(error)}`,
      error: true,
    };
  }
}

/**
 * Handle /memory verify
 */
async function handleVerify(dataDir: string): Promise<CommandResult> {
  try {
    const result = await verifyChain(dataDir);

    if (result.entriesChecked === 0) {
      return {
        response: 'No memories found. The chain is empty.',
      };
    }

    const lines = [
      `Chain Integrity: ${result.valid ? 'VALID' : 'INVALID'}`,
      `Entries checked: ${result.entriesChecked}`,
    ];

    if (result.valid) {
      lines.push('Hash chain: OK');
      lines.push('Signatures: OK');
      lines.push('Sequence: OK');
    } else {
      lines.push('');
      lines.push('Errors:');
      for (const error of result.errors.slice(0, 5)) {
        lines.push(`  Entry #${error.seq}: ${error.type}`);
      }
      if (result.errors.length > 5) {
        lines.push(`  ... and ${result.errors.length - 5} more`);
      }
    }

    return {
      response: lines.join('\n'),
    };
  } catch (error) {
    return {
      response: `Error verifying: ${error instanceof Error ? error.message : String(error)}`,
      error: true,
    };
  }
}

/**
 * Handle /memory stats
 */
async function handleStats(dataDir: string): Promise<CommandResult> {
  try {
    let config;
    try {
      config = await loadConfig(dataDir);
    } catch {
      return {
        response: 'No memory chain found. Use /memory commit to create one.',
      };
    }

    const stats = await getChainStats(dataDir);
    const contentDir = join(dataDir, 'content');
    const storageStats = await getStorageStats(contentDir);
    const anchorStatus = await getAnchorStatus(dataDir);

    const lines = [
      `Memory Chain Statistics`,
      ``,
      `Agent: ${config.agentName}`,
      `Version: ${config.version}`,
      ``,
      `Total entries: ${stats.totalEntries}`,
      ``,
      `By type:`,
      ...Object.entries(stats.byType).map(([k, v]) => `  ${k}: ${v}`),
      ``,
      `By tier:`,
      ...Object.entries(stats.byTier).map(([k, v]) => `  ${k}: ${v}`),
      ``,
      `Storage:`,
      `  Files: ${storageStats.totalFiles}`,
      `  Size: ${(storageStats.totalBytes / 1024).toFixed(2)} KB`,
      ``,
      `Anchors (OpenTimestamps):`,
      `  Total: ${anchorStatus.total}`,
      `  Confirmed: ${anchorStatus.confirmed}`,
      `  Pending: ${anchorStatus.pending}`,
    ];

    return {
      response: lines.join('\n'),
    };
  } catch (error) {
    return {
      response: `Error getting stats: ${error instanceof Error ? error.message : String(error)}`,
      error: true,
    };
  }
}

/**
 * Handle /memory export
 */
async function handleExport(
  dataDir: string,
  chatType: string,
  allowGroupExport: boolean
): Promise<CommandResult> {
  // Security check: only allow export in private chats unless explicitly configured
  if (chatType !== 'private' && !allowGroupExport) {
    return {
      response: 'Export is only available in private chats for security reasons.',
      error: true,
    };
  }

  try {
    const exportData = await exportChain(dataDir, { includeContent: true });

    return {
      response: 'Memory chain exported.',
      file: {
        content: JSON.stringify(exportData, null, 2),
        filename: `memory-chain-export-${new Date().toISOString().split('T')[0]}.json`,
        mimeType: 'application/json',
      },
    };
  } catch (error) {
    return {
      response: `Error exporting: ${error instanceof Error ? error.message : String(error)}`,
      error: true,
    };
  }
}

/**
 * Handle /memory help
 */
function handleHelp(): CommandResult {
  const help = `Memory Chain Commands:

/memory search <query>
  Search memories using hybrid retrieval

/memory commit <text>
  Commit a new memory to the chain

/memory verify
  Verify chain integrity (signatures, hashes)

/memory stats
  Show chain statistics

/memory export
  Export chain (private chat only)

/memory help
  Show this help message`;

  return {
    response: help,
  };
}

/**
 * Main command handler
 *
 * Called by OpenClaw gateway when user sends /memory command.
 *
 * @param context - Context provided by the gateway
 * @returns Command result with response
 */
export async function memory(context: CommandContext): Promise<CommandResult> {
  const config = context.config ?? {};
  const dataDir = config.dataDir ?? join(homedir(), '.openclaw', 'memory-chain');
  const maxTokens = config.maxTokens ?? 2000;
  const maxResults = config.maxResults ?? 20;
  const allowGroupExport = config.allowGroupExport ?? false;

  const { subcommand, rest } = parseArgs(context.args);

  // Metadata for commit operations
  const metadata = {
    userId: context.userId,
    chatId: context.chatId,
    chatType: context.chatType,
    username: context.username,
  };

  switch (subcommand) {
    case 'search':
      return handleSearch(rest, dataDir, maxTokens, maxResults);

    case 'commit':
      return handleCommit(rest, dataDir, metadata);

    case 'verify':
      return handleVerify(dataDir);

    case 'stats':
      return handleStats(dataDir);

    case 'export':
      return handleExport(dataDir, context.chatType, allowGroupExport);

    case 'help':
    case '':
      return handleHelp();

    default:
      return {
        response: `Unknown subcommand: ${subcommand}\n\nUse /memory help for available commands.`,
        error: true,
      };
  }
}

// Export as default for OpenClaw command loader
export default memory;
