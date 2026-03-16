#!/usr/bin/env node
/**
 * Witness Memory Chain — MCP Server
 *
 * Exposes the cryptographic memory chain as MCP tools for Claude Desktop.
 * Runs via stdio transport, spawned by Claude Desktop.
 *
 * Tools:
 *   memory_add     — Add a signed memory to the chain
 *   memory_search  — Search memories with hybrid retrieval
 *   memory_list    — List recent chain entries
 *   memory_verify  — Verify chain integrity
 *   memory_stats   — Show chain statistics
 *   memory_recall  — Retrieve memories relevant to current context
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  addEntry,
  readChain,
  verifyChain,
  getChainStats,
  loadConfig,
} from './chain/index.js';
import {
  initIndex,
  closeIndex,
  rebuildFromChain,
  getMemoryCount,
} from './index/sqlite.js';
import {
  retrieveMemories,
  getRecentMemories,
  formatMemoriesForPrompt,
  estimateTokens,
} from './index/retrieval.js';
import { createContentLoader } from './storage/content-store.js';
import type { ChainEntry } from './types.js';

const DATA_DIR = process.env.MEMORY_CHAIN_DIR
  || `${process.env.HOME}/.claude/memory-chain`;

const server = new McpServer({
  name: 'witness-memory-chain',
  version: '0.1.0',
});

// Helper: ensure index is current
async function getIndex() {
  const dbPath = `${DATA_DIR}/memory.db`;
  const db = initIndex(dbPath);
  const count = getMemoryCount(db);

  // Rebuild if empty
  if (count === 0) {
    const entries = await readChain(DATA_DIR);
    const loader = createContentLoader(`${DATA_DIR}/content`);
    await rebuildFromChain(db, entries, loader);
  }

  return db;
}

// --- Tools ---

server.tool(
  'memory_add',
  'Add a new signed memory to the cryptographic chain. Use for important facts, decisions, preferences, or insights worth preserving across sessions.',
  {
    content: z.string().describe('The memory content to store'),
    type: z.enum(['memory', 'decision', 'identity']).default('memory')
      .describe('Entry type: memory (facts/preferences), decision (agreed behaviors), identity (core values)'),
    tier: z.enum(['committed', 'relationship', 'ephemeral']).default('relationship')
      .describe('Persistence tier: committed (permanent), relationship (redactable), ephemeral (temporary)'),
  },
  async ({ content, type, tier }) => {
    try {
      const entry = await addEntry(DATA_DIR, { type, tier, content });

      // Rebuild index with new entry
      const db = await getIndex();
      const entries = await readChain(DATA_DIR);
      const loader = createContentLoader(`${DATA_DIR}/content`);
      await rebuildFromChain(db, entries, loader);
      closeIndex(db);

      return {
        content: [{
          type: 'text' as const,
          text: `Added entry #${entry.seq} (${type}/${tier})\nContent hash: ${entry.content_hash}\nSigned with Ed25519, hash-linked to chain.`,
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'memory_search',
  'Search the memory chain using hybrid retrieval (keyword + recency + importance scoring). Returns the most relevant memories.',
  {
    query: z.string().describe('Search query'),
    max_results: z.number().default(10).describe('Maximum results to return'),
    max_tokens: z.number().default(2000).describe('Maximum tokens in response'),
  },
  async ({ query, max_results, max_tokens }) => {
    try {
      const db = await getIndex();
      const memories = retrieveMemories(db, query, {
        maxTokens: max_tokens,
        maxResults: max_results,
      });
      closeIndex(db);

      if (memories.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `No memories found for "${query}"` }],
        };
      }

      const formatted = formatMemoriesForPrompt(memories);
      return {
        content: [{ type: 'text' as const, text: formatted }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'memory_list',
  'List recent entries from the memory chain with their types, tiers, and content previews.',
  {
    limit: z.number().default(10).describe('Number of entries to show'),
  },
  async ({ limit }) => {
    try {
      const entries = await readChain(DATA_DIR);
      const loader = createContentLoader(`${DATA_DIR}/content`);

      const recent = entries.slice(-limit).reverse();
      const lines: string[] = [`Showing ${recent.length} of ${entries.length} entries:\n`];

      for (const entry of recent) {
        let content = '';
        try {
          if (entry.content_hash) {
            const loaded = await loader(entry.content_hash);
            if (loaded) {
              content = loaded.length > 120 ? loaded.slice(0, 120) + '...' : loaded;
            }
          }
        } catch {
          content = '[content unavailable]';
        }

        const date = new Date(entry.ts).toLocaleString();
        lines.push(`#${entry.seq} [${entry.type}/${entry.tier}] ${date}`);
        lines.push(`  ${content}`);
        lines.push('');
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'memory_verify',
  'Verify the cryptographic integrity of the entire memory chain. Checks signatures, hash links, sequence, and content files.',
  {},
  async () => {
    try {
      const result = await verifyChain(DATA_DIR);

      const lines = [
        `Chain Integrity: ${result.valid ? 'VALID' : 'INVALID'}`,
        `  Entries checked: ${result.entriesChecked}`,
      ];

      if (result.valid) {
        lines.push('  Hash chain: All entries link correctly');
        lines.push('  Signatures: All verified');
        lines.push('  Sequence: No gaps');
        lines.push('  Content files: All verified');
      }

      if (result.errors && result.errors.length > 0) {
        lines.push('\nErrors:');
        for (const err of result.errors) {
          lines.push(`  - ${err.message || err}`);
        }
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'memory_stats',
  'Show statistics about the memory chain: entry counts by type and tier, storage usage, anchor status.',
  {},
  async () => {
    try {
      const stats = await getChainStats(DATA_DIR);
      const config = await loadConfig(DATA_DIR);

      const lines = [
        `Memory Chain Statistics`,
        ``,
        `Agent: ${config.agentName}`,
        `Created: ${new Date(config.createdAt).toLocaleString()}`,
        ``,
        `Total entries: ${stats.totalEntries}`,
      ];

      if (stats.firstEntry) {
        lines.push(`First entry: ${new Date(stats.firstEntry).toLocaleString()}`);
      }
      if (stats.lastEntry) {
        lines.push(`Last entry: ${new Date(stats.lastEntry).toLocaleString()}`);
      }

      lines.push(`\nBy type:`);
      for (const [type, count] of Object.entries(stats.byType)) {
        lines.push(`  ${type}: ${count}`);
      }

      lines.push(`\nBy tier:`);
      for (const [tier, count] of Object.entries(stats.byTier)) {
        lines.push(`  ${tier}: ${count}`);
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'memory_recall',
  'Retrieve memories relevant to the current conversation context. Use this at the start of a conversation to load relevant prior knowledge.',
  {
    context: z.string().describe('Current conversation context or topic to find relevant memories for'),
    max_tokens: z.number().default(1500).describe('Maximum tokens to return'),
  },
  async ({ context, max_tokens }) => {
    try {
      const db = await getIndex();

      // Search for context-relevant memories
      const memories = retrieveMemories(db, context, {
        maxTokens: max_tokens,
        maxResults: 15,
      });

      // Also get recent memories for temporal context
      const recent = getRecentMemories(db, 7, 5);
      closeIndex(db);

      const lines: string[] = [];

      if (memories.length > 0) {
        lines.push('## Relevant Memories');
        lines.push(formatMemoriesForPrompt(memories));
      }

      if (recent.length > 0) {
        lines.push('\n## Recent Memories (last 7 days)');
        for (const m of recent) {
          const tokens = estimateTokens(m.content);
          lines.push(`- [${m.type}] ${m.content.slice(0, 150)}${m.content.length > 150 ? '...' : ''}`);
        }
      }

      if (lines.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No relevant memories found.' }],
        };
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err}` }],
        isError: true,
      };
    }
  },
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
