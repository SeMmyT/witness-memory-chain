/**
 * Command Reset Hook
 *
 * Auto-commits session summary on session reset (/reset command in Telegram).
 * This hook captures significant learnings from the session before it's cleared.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  addEntry,
  readChain,
} from '@witness/memory-chain';
import type { ChainEntryInput, EntryType, Tier } from '@witness/memory-chain';

/** Configuration for the auto-commit hook */
export interface ResetConfig {
  /** Data directory for memory chain (default: ~/.openclaw/memory-chain) */
  dataDir?: string;
  /** Enable auto-commit on reset (default: true) */
  enabled?: boolean;
  /** Minimum message count to trigger auto-commit (default: 3) */
  minMessages?: number;
  /** Keywords that trigger auto-commit regardless of significance (default: ['remember', 'note that', 'important']) */
  keywords?: string[];
  /** Entry type for auto-committed memories (default: 'memory') */
  entryType?: EntryType;
  /** Entry tier for auto-committed memories (default: 'relationship') */
  entryTier?: Tier;
}

/** Context provided by OpenClaw gateway on reset */
export interface ResetContext {
  /** Session ID being reset */
  sessionId?: string;
  /** User identifier */
  userId?: string;
  /** Chat ID */
  chatId?: string;
  /** Messages from the session */
  messages?: SessionMessage[];
  /** Skill configuration */
  config?: ResetConfig;
}

/** A message from the session */
export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

/** Result of the reset hook */
export interface ResetResult {
  /** Whether a memory was committed */
  committed: boolean;
  /** The committed memory content (if any) */
  content?: string;
  /** Sequence number of the committed entry (if any) */
  seq?: number;
  /** Reason for commit or skip */
  reason: string;
}

/**
 * Extract significant content from session messages
 *
 * Looks for:
 * - Explicit "remember" requests from user
 * - Important decisions or preferences
 * - Learning outcomes
 */
function extractSignificantContent(
  messages: SessionMessage[],
  keywords: string[]
): string | null {
  const userMessages = messages.filter((m) => m.role === 'user');
  const assistantMessages = messages.filter((m) => m.role === 'assistant');

  // Check for explicit remember requests
  for (const msg of userMessages) {
    const lower = msg.content.toLowerCase();
    for (const keyword of keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        // Found a keyword - try to extract the significant part
        const content = msg.content.trim();
        if (content.length > 10 && content.length < 500) {
          return `User request: ${content}`;
        }
      }
    }
  }

  // Look for preferences or decisions
  const preferencePatterns = [
    /i (?:prefer|like|want|need|use|always|never)/i,
    /my (?:preference|choice|decision|style|workflow)/i,
    /please (?:always|never|remember)/i,
  ];

  for (const msg of userMessages) {
    for (const pattern of preferencePatterns) {
      if (pattern.test(msg.content)) {
        const content = msg.content.trim();
        if (content.length > 10 && content.length < 500) {
          return `Preference: ${content}`;
        }
      }
    }
  }

  // If session had significant back-and-forth, summarize key topic
  if (userMessages.length >= 3 && assistantMessages.length >= 2) {
    // Try to extract the main topic from the first user message
    const firstMessage = userMessages[0].content.trim();
    if (firstMessage.length > 20 && firstMessage.length < 200) {
      return `Session topic: ${firstMessage}`;
    }
  }

  return null;
}

/**
 * Main reset hook function
 *
 * Called by OpenClaw gateway when user triggers /reset command.
 *
 * @param context - Context provided by the gateway
 * @returns Result indicating whether a memory was committed
 */
export async function reset(context: ResetContext): Promise<ResetResult> {
  const config = context.config ?? {};
  const dataDir = config.dataDir ?? join(homedir(), '.openclaw', 'memory-chain');
  const enabled = config.enabled ?? true;
  const minMessages = config.minMessages ?? 3;
  const keywords = config.keywords ?? ['remember', 'note that', 'important'];
  const entryType = config.entryType ?? 'memory';
  const entryTier = config.entryTier ?? 'relationship';

  // Check if auto-commit is enabled
  if (!enabled) {
    return {
      committed: false,
      reason: 'Auto-commit disabled',
    };
  }

  // Check if we have messages
  const messages = context.messages ?? [];
  if (messages.length < minMessages) {
    return {
      committed: false,
      reason: `Session too short (${messages.length} messages, need ${minMessages})`,
    };
  }

  // Check if chain exists
  try {
    await readChain(dataDir);
  } catch {
    return {
      committed: false,
      reason: 'Memory chain not initialized',
    };
  }

  // Extract significant content
  const significant = extractSignificantContent(messages, keywords);
  if (!significant) {
    return {
      committed: false,
      reason: 'No significant content found',
    };
  }

  // Commit the memory
  try {
    const input: ChainEntryInput = {
      type: entryType,
      tier: entryTier,
      content: significant,
      metadata: {
        source: 'auto-commit',
        sessionId: context.sessionId,
        userId: context.userId,
        chatId: context.chatId,
        timestamp: new Date().toISOString(),
      },
    };

    const entry = await addEntry(dataDir, input);

    return {
      committed: true,
      content: significant,
      seq: entry.seq,
      reason: 'Significant content auto-committed',
    };
  } catch (error) {
    console.error('[memory-chain] Reset hook error:', error);
    return {
      committed: false,
      reason: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// Export as default for OpenClaw hook loader
export default reset;
