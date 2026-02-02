/**
 * Session History Client
 *
 * Provides access to the main session's conversation history
 * from isolated cron jobs via OpenClaw's sessions_history API.
 *
 * This enables the brain-inspired architecture where:
 * - Main session (hippocampus) encodes experiences
 * - Isolated crons (neocortex during sleep) consolidate memories
 *
 * ## Usage Contexts
 *
 * **Inside OpenClaw Crons (Primary)**:
 * The cron YAML prompts instruct the agent to use the `sessions_history` tool
 * directly. The agent calls `sessions_history(sessionKey, limit)` as a tool,
 * not via HTTP. This module is NOT used in that flow.
 *
 * **Outside OpenClaw (CLI/Testing)**:
 * When running checkpoint logic from CLI or tests (outside OpenClaw), this
 * HTTP client fetches session history from the OpenClaw API or falls back
 * to reading from a session buffer file.
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Inside OpenClaw Cron                                       │
 * │  Agent uses: sessions_history(sessionKey, limit) ← TOOL     │
 * │  This module: NOT USED                                      │
 * └─────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Outside OpenClaw (CLI, Tests, External Scripts)            │
 * │  Uses: fetchSessionHistory() ← HTTP CLIENT (this module)    │
 * │  Fallback: Session buffer file                              │
 * └─────────────────────────────────────────────────────────────┘
 * ```
 */

import type { SessionMessage, SessionHistoryOptions } from './types.js';

// ============================================================================
// OpenClaw API Client
// ============================================================================

/**
 * OpenClaw sessions_history API response
 */
interface SessionHistoryResponse {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: string;
    created_at?: string;
  }>;
  sessionKey: string;
  truncated?: boolean;
}

/**
 * Fetch session history from OpenClaw API
 *
 * This function is designed to be called from isolated cron jobs
 * to access the main session's conversation history.
 *
 * @param options - Session history options
 * @returns Array of session messages
 * @throws Error if API call fails or session not found
 */
export async function fetchSessionHistory(
  options: SessionHistoryOptions
): Promise<SessionMessage[]> {
  const { sessionKey, limit = 50, since } = options;

  // Build API URL
  // OpenClaw exposes this at a local endpoint for isolated sessions
  const baseUrl = process.env.OPENCLAW_API_URL || 'http://localhost:3030';
  const url = new URL('/api/sessions/history', baseUrl);

  url.searchParams.set('sessionKey', sessionKey);
  if (limit) url.searchParams.set('limit', limit.toString());
  if (since) url.searchParams.set('since', since);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // Auth token for isolated session access
        Authorization: `Bearer ${process.env.OPENCLAW_SESSION_TOKEN || ''}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Session not found, return empty
        return [];
      }
      throw new Error(`Sessions API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as SessionHistoryResponse;

    // Transform to SessionMessage format
    return data.messages
      .filter((m) => m.role !== 'system') // Skip system messages
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: m.timestamp || m.created_at || new Date().toISOString(),
      }));
  } catch (error) {
    // If the API is not available (e.g., local dev), use fallback
    if ((error as Error).message.includes('fetch failed') ||
        (error as Error).message.includes('ECONNREFUSED')) {
      console.warn('OpenClaw API not available, using fallback');
      return fetchFromSessionBuffer(options);
    }
    throw error;
  }
}

// ============================================================================
// Fallback: Session Buffer File
// ============================================================================

/**
 * Fallback method when API is not available
 *
 * Reads from a session buffer file that the main session
 * periodically exports to.
 */
async function fetchFromSessionBuffer(
  options: SessionHistoryOptions
): Promise<SessionMessage[]> {
  const { limit = 50, since } = options;

  // Session buffer location
  const bufferPath = process.env.SESSION_BUFFER_PATH ||
    `${process.env.HOME}/.openclaw/workspace/session-buffer.json`;

  const fs = await import('fs/promises');

  try {
    const content = await fs.readFile(bufferPath, 'utf-8');
    const buffer = JSON.parse(content) as {
      messages: SessionMessage[];
      exportedAt: string;
    };

    let messages = buffer.messages;

    // Filter by since timestamp
    if (since) {
      const sinceTime = new Date(since).getTime();
      messages = messages.filter((m) => new Date(m.timestamp).getTime() > sinceTime);
    }

    // Apply limit
    return messages.slice(-limit);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Buffer file doesn't exist yet
      return [];
    }
    throw error;
  }
}

// ============================================================================
// Session Buffer Export (for main session)
// ============================================================================

/**
 * Export session messages to buffer file
 *
 * This should be called from the main session (e.g., via heartbeat)
 * to make messages available to isolated crons.
 */
export async function exportToSessionBuffer(
  messages: SessionMessage[],
  bufferPath?: string
): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  const targetPath = bufferPath ||
    process.env.SESSION_BUFFER_PATH ||
    `${process.env.HOME}/.openclaw/workspace/session-buffer.json`;

  // Ensure directory exists
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const buffer = {
    messages,
    exportedAt: new Date().toISOString(),
    messageCount: messages.length,
  };

  await fs.writeFile(targetPath, JSON.stringify(buffer, null, 2), 'utf-8');
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the default session key for the main agent session
 */
export function getMainSessionKey(): string {
  return process.env.OPENCLAW_MAIN_SESSION_KEY || 'agent:main:main';
}

/**
 * Get the last checkpoint timestamp
 *
 * Used to only fetch messages since the last checkpoint.
 */
export async function getLastCheckpointTime(
  workspaceDir: string
): Promise<string | undefined> {
  const fs = await import('fs/promises');
  const path = await import('path');

  const metaPath = path.join(workspaceDir, 'memory', '.checkpoint-meta.json');

  try {
    const content = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(content) as { lastCheckpoint: string };
    return meta.lastCheckpoint;
  } catch {
    return undefined;
  }
}

/**
 * Update the last checkpoint timestamp
 */
export async function updateLastCheckpointTime(
  workspaceDir: string,
  timestamp: string = new Date().toISOString()
): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  const memoryDir = path.join(workspaceDir, 'memory');
  await fs.mkdir(memoryDir, { recursive: true });

  const metaPath = path.join(memoryDir, '.checkpoint-meta.json');
  const meta = { lastCheckpoint: timestamp };

  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Fetch recent session history since last checkpoint
 *
 * Convenience function that:
 * 1. Gets the last checkpoint time
 * 2. Fetches messages since then
 * 3. Updates the checkpoint time
 */
export async function fetchRecentHistory(
  workspaceDir: string,
  limit = 50
): Promise<SessionMessage[]> {
  const since = await getLastCheckpointTime(workspaceDir);

  const messages = await fetchSessionHistory({
    sessionKey: getMainSessionKey(),
    limit,
    since,
  });

  // Update checkpoint time if we got messages
  if (messages.length > 0) {
    const lastMessageTime = messages[messages.length - 1].timestamp;
    await updateLastCheckpointTime(workspaceDir, lastMessageTime);
  }

  return messages;
}
