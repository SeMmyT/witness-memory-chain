/**
 * Memory Chain Reset Hook Handler
 *
 * Auto-commits session summary when /reset is issued.
 * Follows OpenClaw's HookHandler interface.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';

// Note: These imports require witness-memory-chain to be installed
import { addEntry, readChain } from 'witness-memory-chain';
import type { ChainEntryInput } from 'witness-memory-chain';

/** OpenClaw HookEvent interface (subset of what we need) */
interface HookEvent {
  type: 'command' | 'session' | 'agent' | 'gateway';
  action: string;
  sessionKey: string;
  timestamp: Date;
  messages: string[];
  context: {
    sessionEntry?: {
      messages?: SessionMessage[];
    };
    sessionId?: string;
    sessionFile?: string;
    commandSource?: string;
    senderId?: string;
    workspaceDir?: string;
    bootstrapFiles?: unknown[];
    cfg?: unknown;
  };
}

interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

/** HookHandler type */
type HookHandler = (event: HookEvent) => Promise<void> | void;

/**
 * Extract significant content from session messages
 */
function extractSignificantContent(
  messages: SessionMessage[],
  keywords: string[]
): string | null {
  const userMessages = messages.filter((m) => m.role === 'user');

  // Check for explicit remember requests
  for (const msg of userMessages) {
    const lower = msg.content.toLowerCase();
    for (const keyword of keywords) {
      if (lower.includes(keyword.toLowerCase())) {
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
  const assistantMessages = messages.filter((m) => m.role === 'assistant');
  if (userMessages.length >= 3 && assistantMessages.length >= 2) {
    const firstMessage = userMessages[0].content.trim();
    if (firstMessage.length > 20 && firstMessage.length < 200) {
      return `Session topic: ${firstMessage}`;
    }
  }

  return null;
}

/**
 * Memory Chain Reset Handler
 *
 * Triggered on command:reset to auto-commit significant content.
 */
const handler: HookHandler = async (event) => {
  // Only handle command:reset events
  if (event.type !== 'command' || event.action !== 'reset') {
    return;
  }

  // Get configuration from environment or use defaults
  const dataDir = process.env.MEMORY_CHAIN_DIR
    ? process.env.MEMORY_CHAIN_DIR.replace('~', homedir())
    : join(homedir(), '.openclaw', 'memory-chain');
  const minMessages = parseInt(process.env.MEMORY_CHAIN_MIN_MESSAGES ?? '3', 10);
  const keywords = (process.env.MEMORY_CHAIN_KEYWORDS ?? 'remember,note that,important').split(',');

  try {
    // Get session messages from context
    const messages = (event.context.sessionEntry as { messages?: SessionMessage[] })?.messages ?? [];

    if (messages.length < minMessages) {
      console.log(`[memory-chain-reset] Session too short (${messages.length} messages), skipping`);
      return;
    }

    // Check if chain exists
    try {
      await readChain(dataDir);
    } catch {
      console.log('[memory-chain-reset] No chain found, skipping');
      return;
    }

    // Extract significant content
    const significant = extractSignificantContent(messages, keywords);
    if (!significant) {
      console.log('[memory-chain-reset] No significant content found');
      return;
    }

    // Commit the memory
    const input: ChainEntryInput = {
      type: 'memory',
      tier: 'relationship',
      content: significant,
      metadata: {
        source: 'auto-commit',
        sessionId: event.context.sessionId,
        senderId: event.context.senderId,
        timestamp: new Date().toISOString(),
      },
    };

    const entry = await addEntry(dataDir, input);

    // Notify user
    event.messages.push(`💾 Memory committed to chain (seq: ${entry.seq})`);
    console.log(`[memory-chain-reset] Committed: ${significant.substring(0, 50)}...`);
  } catch (error) {
    console.error('[memory-chain-reset] Error:', error);
    // Don't throw - allow reset to continue
  }
};

export default handler;
