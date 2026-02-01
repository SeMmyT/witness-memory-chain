/**
 * Memory Checkpoint
 *
 * Hourly extraction of significant content from session history.
 * Writes to daily memory files (memory/YYYY-MM-DD.md).
 *
 * Triggered by the memory-checkpoint cron job using Haiku model.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  SessionMessage,
  CapturedItem,
  CheckpointResult,
  CheckpointConfig,
  SignificanceType,
} from './types.js';
import { checkDuplicate, getDailyFilePath } from './dedup.js';

// ============================================================================
// Significance Detection
// ============================================================================

/** Patterns that indicate a decision was made */
const DECISION_PATTERNS = [
  /\b(decided|decision|chose|choosing|going with|settled on|agreed to)\b/i,
  /\b(will use|we'll use|let's use|should use|going to use)\b/i,
  /\b(approved|rejected|confirmed|selected)\b/i,
];

/** Patterns that indicate a preference was expressed */
const PREFERENCE_PATTERNS = [
  /\b(prefer|like|love|hate|dislike|want|don't want)\b/i,
  /\b(rather|instead of|better than|worse than)\b/i,
  /\b(always|never|usually|typically)\b/i,
];

/** Patterns that indicate an explicit memory request */
const EXPLICIT_PATTERNS = [
  /\b(remember|don't forget|note that|important:?|keep in mind)\b/i,
  /\b(save this|store this|memorize|capture this)\b/i,
  /^!remember\b/i,
  /^\/remember\b/i,
];

/** Patterns that indicate a significant event */
const EVENT_PATTERNS = [
  /\b(completed|finished|done with|shipped|deployed|released)\b/i,
  /\b(started|beginning|kicked off|launched)\b/i,
  /\b(learned|discovered|realized|figured out)\b/i,
  /\b(broke|fixed|solved|resolved|debugged)\b/i,
];

/**
 * Classify the significance of a message
 *
 * @returns The type of significance, or null if not significant
 */
export function classifySignificance(content: string): SignificanceType | null {
  // Check for explicit memory requests first (highest priority)
  for (const pattern of EXPLICIT_PATTERNS) {
    if (pattern.test(content)) {
      return 'explicit';
    }
  }

  // Check for decisions
  for (const pattern of DECISION_PATTERNS) {
    if (pattern.test(content)) {
      return 'decision';
    }
  }

  // Check for preferences
  for (const pattern of PREFERENCE_PATTERNS) {
    if (pattern.test(content)) {
      return 'preference';
    }
  }

  // Check for events
  for (const pattern of EVENT_PATTERNS) {
    if (pattern.test(content)) {
      return 'event';
    }
  }

  return null;
}

/**
 * Check if a message is worth capturing
 *
 * Filters out noise like:
 * - Very short messages
 * - Code-only messages
 * - System messages
 * - Repetitive acknowledgments
 */
export function isWorthCapturing(message: SessionMessage): boolean {
  const content = message.content.trim();

  // Too short
  if (content.length < 20) {
    return false;
  }

  // Mostly code (more than 50% in code blocks)
  const codeBlockLength = (content.match(/```[\s\S]*?```/g) || []).join('').length;
  if (codeBlockLength > content.length * 0.5) {
    return false;
  }

  // Common acknowledgments to skip
  const skipPatterns = [
    /^(ok|okay|sure|yes|no|got it|understood|thanks|thank you)\.?$/i,
    /^(sounds good|makes sense|i see|alright|right)\.?$/i,
  ];

  for (const pattern of skipPatterns) {
    if (pattern.test(content)) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Content Extraction
// ============================================================================

/**
 * Extract significant content from session messages
 *
 * Processes messages to identify decisions, preferences, events,
 * and explicit memory requests.
 */
export function extractSignificantContent(
  messages: SessionMessage[],
  sessionId?: string
): CapturedItem[] {
  const items: CapturedItem[] = [];
  const now = new Date().toISOString();

  for (const message of messages) {
    // Skip assistant messages for capture (focus on user intent)
    // But include assistant confirmations of decisions
    if (message.role === 'assistant') {
      // Only capture assistant messages if they confirm a decision
      const significance = classifySignificance(message.content);
      if (significance === 'decision' || significance === 'explicit') {
        items.push({
          content: extractRelevantContent(message.content),
          significance,
          source: 'auto',
          timestamp: message.timestamp || now,
          sessionId,
        });
      }
      continue;
    }

    // Filter out noise
    if (!isWorthCapturing(message)) {
      continue;
    }

    // Classify significance
    const significance = classifySignificance(message.content);

    if (significance) {
      items.push({
        content: extractRelevantContent(message.content),
        significance,
        source: 'auto',
        timestamp: message.timestamp || now,
        sessionId,
      });
    }
  }

  return items;
}

/**
 * Extract the relevant part of a message
 *
 * Removes code blocks, URLs, and other noise to focus on
 * the semantic content.
 */
function extractRelevantContent(content: string): string {
  let cleaned = content
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '[code]')
    // Remove inline code
    .replace(/`[^`]+`/g, '[code]')
    // Remove URLs
    .replace(/https?:\/\/\S+/g, '[url]')
    // Remove file paths
    .replace(/(?:\/[\w.-]+)+/g, '[path]')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();

  // Truncate if too long
  if (cleaned.length > 500) {
    cleaned = cleaned.slice(0, 497) + '...';
  }

  return cleaned;
}

// ============================================================================
// Daily File Operations
// ============================================================================

/**
 * Ensure the memory directory exists
 */
async function ensureMemoryDir(workspaceDir: string): Promise<void> {
  const memoryDir = path.join(workspaceDir, 'memory');
  await fs.mkdir(memoryDir, { recursive: true });
}

/**
 * Format a captured item for the daily file
 */
function formatCapturedItem(item: CapturedItem): string {
  const time = new Date(item.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const sigLabel = item.significance.charAt(0).toUpperCase() + item.significance.slice(1);

  return `## ${time} — ${sigLabel}\n\n${item.content}\n`;
}

/**
 * Write captured items to the daily memory file
 */
export async function writeToDailyFile(
  items: CapturedItem[],
  workspaceDir: string,
  date: Date = new Date()
): Promise<string> {
  await ensureMemoryDir(workspaceDir);

  const dailyFilePath = getDailyFilePath(workspaceDir, date);

  // Check if file exists
  let existingContent = '';
  try {
    existingContent = await fs.readFile(dailyFilePath, 'utf-8');
  } catch {
    // File doesn't exist, create with header
    const dateStr = date.toISOString().split('T')[0];
    existingContent = `# Memory Capture — ${dateStr}\n\n`;
  }

  // Format and append new items
  const newContent = items.map(formatCapturedItem).join('\n');
  const finalContent = existingContent.trimEnd() + '\n\n' + newContent;

  await fs.writeFile(dailyFilePath, finalContent, 'utf-8');

  return dailyFilePath;
}

// ============================================================================
// Main Checkpoint Function
// ============================================================================

/**
 * Run a memory checkpoint
 *
 * Processes session history, extracts significant content,
 * deduplicates, and writes to the daily memory file.
 */
export async function runCheckpoint(
  sessionHistory: SessionMessage[],
  config: CheckpointConfig
): Promise<CheckpointResult> {
  const result: CheckpointResult = {
    capturedCount: 0,
    skippedCount: 0,
    duplicatesFound: 0,
    errors: [],
    capturedItems: [],
  };

  try {
    // Extract significant content
    const items = extractSignificantContent(sessionHistory, config.sessionKey);
    result.skippedCount = sessionHistory.length - items.length;

    if (items.length === 0) {
      return result;
    }

    // Deduplicate each item
    const uniqueItems: CapturedItem[] = [];
    const today = new Date();

    for (const item of items) {
      try {
        const dupCheck = await checkDuplicate(
          item.content,
          config.workspaceDir,
          config.chainDir,
          today
        );

        if (dupCheck.isDuplicate) {
          result.duplicatesFound++;
        } else {
          uniqueItems.push(item);
        }
      } catch (error) {
        result.errors.push(`Dedup check failed: ${error}`);
        // Still add the item if dedup check fails
        uniqueItems.push(item);
      }
    }

    if (uniqueItems.length === 0) {
      return result;
    }

    // Write to daily file
    const dailyFilePath = await writeToDailyFile(uniqueItems, config.workspaceDir, today);

    result.capturedCount = uniqueItems.length;
    result.capturedItems = uniqueItems;
    result.dailyFilePath = dailyFilePath;
  } catch (error) {
    result.errors.push(`Checkpoint failed: ${error}`);
  }

  return result;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse a daily file back into captured items
 */
export async function parseDailyFile(filePath: string): Promise<CapturedItem[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const items: CapturedItem[] = [];

  // Split into sections
  const sections = content.split(/^## /m).slice(1); // Skip header

  for (const section of sections) {
    const lines = section.split('\n');
    const header = lines[0];

    // Parse header: "HH:MM — Significance"
    const headerMatch = header.match(/^(\d{2}:\d{2})\s*—\s*(\w+)/);
    if (!headerMatch) continue;

    const [, time, significance] = headerMatch;
    const contentLines = lines.slice(1).join('\n').trim();

    if (contentLines) {
      items.push({
        content: contentLines,
        significance: significance.toLowerCase() as SignificanceType,
        source: 'auto',
        timestamp: time,
      });
    }
  }

  return items;
}
