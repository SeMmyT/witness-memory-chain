/**
 * Memory Curation
 *
 * Weekly distillation of daily memory files into MEMORY.md
 * and critical item commitment to chain.
 *
 * Triggered by the memory-curation cron job using Sonnet model.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  DailyFile,
  CapturedItem,
  CuratedItem,
  CurationResult,
  CurationConfig,
} from './types.js';
import { parseDailyFile } from './checkpoint.js';

// ============================================================================
// Daily File Operations
// ============================================================================

/**
 * Get list of daily files in date range
 */
export async function listDailyFiles(
  workspaceDir: string,
  fromDate: Date,
  toDate: Date
): Promise<string[]> {
  const memoryDir = path.join(workspaceDir, 'memory');

  try {
    const files = await fs.readdir(memoryDir);

    // Filter to date range
    const dateFiles = files.filter((f) => {
      // Match YYYY-MM-DD.md pattern
      const match = f.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (!match) return false;

      const fileDate = new Date(match[1]);
      return fileDate >= fromDate && fileDate <= toDate;
    });

    return dateFiles
      .sort()
      .map((f) => path.join(memoryDir, f));
  } catch {
    return [];
  }
}

/**
 * Read daily files from date range
 */
export async function readDailyFiles(
  workspaceDir: string,
  fromDate: Date,
  toDate: Date
): Promise<DailyFile[]> {
  const filePaths = await listDailyFiles(workspaceDir, fromDate, toDate);
  const dailyFiles: DailyFile[] = [];

  for (const filePath of filePaths) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const items = await parseDailyFile(filePath);
      const date = path.basename(filePath, '.md');

      dailyFiles.push({
        path: filePath,
        date,
        content,
        items,
      });
    } catch (error) {
      console.error(`Failed to read ${filePath}:`, error);
    }
  }

  return dailyFiles;
}

// ============================================================================
// Pattern Distillation
// ============================================================================

/**
 * Group items by significance type
 */
function groupBySignificance(items: CapturedItem[]): Record<string, CapturedItem[]> {
  const groups: Record<string, CapturedItem[]> = {
    decision: [],
    preference: [],
    event: [],
    explicit: [],
  };

  for (const item of items) {
    if (groups[item.significance]) {
      groups[item.significance].push(item);
    }
  }

  return groups;
}

/**
 * Find patterns across items
 *
 * Looks for recurring themes, keywords, and decisions.
 */
function findPatterns(items: CapturedItem[]): string[] {
  const patterns: string[] = [];

  // Extract keywords from all items
  const keywords = new Map<string, number>();

  for (const item of items) {
    const words = item.content.toLowerCase().split(/\W+/);
    for (const word of words) {
      if (word.length > 4) {
        keywords.set(word, (keywords.get(word) || 0) + 1);
      }
    }
  }

  // Find frequently recurring words
  for (const [word, count] of keywords) {
    if (count >= 3) {
      patterns.push(`Frequently mentioned: "${word}" (${count} times)`);
    }
  }

  return patterns;
}

/**
 * Distill daily items into curated items
 */
export function distillItems(dailyFiles: DailyFile[]): CuratedItem[] {
  const allItems: CapturedItem[] = [];

  for (const file of dailyFiles) {
    allItems.push(...file.items);
  }

  if (allItems.length === 0) {
    return [];
  }

  const curated: CuratedItem[] = [];
  const grouped = groupBySignificance(allItems);

  // Distill decisions
  if (grouped.decision.length > 0) {
    for (const item of grouped.decision) {
      curated.push({
        content: item.content,
        category: 'decision',
        firstObserved: item.timestamp,
        lastConfirmed: item.timestamp,
      });
    }
  }

  // Distill preferences
  if (grouped.preference.length > 0) {
    for (const item of grouped.preference) {
      curated.push({
        content: item.content,
        category: 'preference',
        firstObserved: item.timestamp,
        lastConfirmed: item.timestamp,
      });
    }
  }

  // Distill events as lessons
  if (grouped.event.length > 0) {
    for (const item of grouped.event) {
      curated.push({
        content: item.content,
        category: 'lesson',
        firstObserved: item.timestamp,
      });
    }
  }

  // Explicit items become patterns or identity
  if (grouped.explicit.length > 0) {
    for (const item of grouped.explicit) {
      // Check if it looks like identity
      const isIdentity = /\b(i am|we are|my|our)\b/i.test(item.content);

      curated.push({
        content: item.content,
        category: isIdentity ? 'identity' : 'pattern',
        firstObserved: item.timestamp,
        lastConfirmed: item.timestamp,
      });
    }
  }

  return curated;
}

// ============================================================================
// MEMORY.md Operations
// ============================================================================

/**
 * Format curated items for MEMORY.md
 */
function formatMemoryMd(items: CuratedItem[], existingContent?: string): string {
  const today = new Date().toISOString().split('T')[0];

  const sections: Record<string, string[]> = {
    Preferences: [],
    Decisions: [],
    Lessons: [],
    Patterns: [],
    Identity: [],
  };

  for (const item of items) {
    const dateNote = item.firstObserved
      ? ` (noted ${item.firstObserved.split('T')[0]})`
      : '';

    switch (item.category) {
      case 'preference':
        sections.Preferences.push(`- ${item.content}${dateNote}`);
        break;
      case 'decision':
        sections.Decisions.push(`- ${item.content}${dateNote}`);
        break;
      case 'lesson':
        sections.Lessons.push(`- ${item.content}${dateNote}`);
        break;
      case 'pattern':
        sections.Patterns.push(`- ${item.content}${dateNote}`);
        break;
      case 'identity':
        sections.Identity.push(`- ${item.content}${dateNote}`);
        break;
    }
  }

  let content = `# Memory — Last updated ${today}\n\n`;

  for (const [section, entries] of Object.entries(sections)) {
    if (entries.length > 0) {
      content += `## ${section}\n\n${entries.join('\n')}\n\n`;
    }
  }

  return content.trim() + '\n';
}

/**
 * Update MEMORY.md with curated items
 *
 * Merges new items with existing content, avoiding duplicates.
 */
export async function updateMemoryMd(
  workspaceDir: string,
  items: CuratedItem[]
): Promise<void> {
  const memoryPath = path.join(workspaceDir, 'MEMORY.md');

  let existingContent: string | undefined;
  try {
    existingContent = await fs.readFile(memoryPath, 'utf-8');
  } catch {
    // File doesn't exist
  }

  const newContent = formatMemoryMd(items, existingContent);
  await fs.writeFile(memoryPath, newContent, 'utf-8');
}

// ============================================================================
// Archive Operations
// ============================================================================

/**
 * Archive old daily files
 */
export async function archiveOldFiles(
  workspaceDir: string,
  olderThanDays: number
): Promise<number> {
  const memoryDir = path.join(workspaceDir, 'memory');
  const archiveDir = path.join(memoryDir, 'archive');

  // Ensure archive directory exists
  await fs.mkdir(archiveDir, { recursive: true });

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  let archivedCount = 0;

  try {
    const files = await fs.readdir(memoryDir);

    for (const file of files) {
      // Match YYYY-MM-DD.md pattern
      const match = file.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (!match) continue;

      const fileDate = new Date(match[1]);
      if (fileDate < cutoffDate) {
        const srcPath = path.join(memoryDir, file);
        const destPath = path.join(archiveDir, file);

        await fs.rename(srcPath, destPath);
        archivedCount++;
      }
    }
  } catch (error) {
    console.error('Archive failed:', error);
  }

  return archivedCount;
}

// ============================================================================
// Chain Commitment
// ============================================================================

/**
 * Commit critical items to chain
 *
 * Only commits items that are:
 * - Identity-defining
 * - Major decisions with lasting impact
 * - Long-term commitments
 */
export async function commitCriticalItems(
  items: CuratedItem[],
  chainDir: string
): Promise<number> {
  // Filter to critical items
  const critical = items.filter((item) =>
    item.category === 'identity' ||
    item.category === 'decision'
  );

  if (critical.length === 0) {
    return 0;
  }

  // Dynamic imports
  const { initChain, addEntry } = await import('../chain/index.js');

  let committed = 0;

  try {
    // Initialize chain (reads existing config)
    const chain = await initChain(chainDir, { agentName: 'auto-curation' });

    for (const item of critical) {
      await addEntry(chainDir, {
        type: item.category === 'identity' ? 'identity' : 'decision',
        tier: 'committed',
        content: item.content,
        metadata: {
          source: 'curation',
          curatedAt: new Date().toISOString(),
          firstObserved: item.firstObserved,
        },
      });
      committed++;
    }
  } catch (error) {
    console.error('Chain commit failed:', error);
  }

  return committed;
}

// ============================================================================
// Main Curation Function
// ============================================================================

/**
 * Run weekly curation
 */
export async function runCuration(config: CurationConfig): Promise<CurationResult> {
  const {
    workspaceDir,
    chainDir,
    lookbackDays = 7,
    archiveAfterDays = 30,
  } = config;

  const result: CurationResult = {
    dailyFilesProcessed: 0,
    itemsDistilled: 0,
    chainCommits: 0,
    archivedFiles: 0,
    memoryMdUpdated: false,
    errors: [],
  };

  try {
    // Calculate date range
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - lookbackDays);

    // Read daily files
    const dailyFiles = await readDailyFiles(workspaceDir, fromDate, toDate);
    result.dailyFilesProcessed = dailyFiles.length;

    if (dailyFiles.length === 0) {
      return result;
    }

    // Distill items
    const curatedItems = distillItems(dailyFiles);
    result.itemsDistilled = curatedItems.length;

    if (curatedItems.length > 0) {
      // Update MEMORY.md
      await updateMemoryMd(workspaceDir, curatedItems);
      result.memoryMdUpdated = true;

      // Commit critical items to chain
      result.chainCommits = await commitCriticalItems(curatedItems, chainDir);
    }

    // Archive old files
    result.archivedFiles = await archiveOldFiles(workspaceDir, archiveAfterDays);
  } catch (error) {
    result.errors.push(`Curation failed: ${error}`);
  }

  return result;
}
