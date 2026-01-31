#!/usr/bin/env node

/**
 * Memory Chain CLI
 *
 * Command-line interface for managing the memory chain.
 */

import { Command } from 'commander';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  initChain,
  addEntry,
  readChain,
  verifyChain,
  getChainStats,
  loadConfig,
} from './chain/index.js';
import { initIndex, closeIndex, rebuildFromChain, getMemoryCount } from './index/sqlite.js';
import { retrieveMemories, formatMemoriesForPrompt, estimateTokens } from './index/retrieval.js';
import { getContent, getContentVerified, ContentIntegrityError, deleteContent, createContentLoader, getStorageStats } from './storage/content-store.js';
import {
  submitAnchor,
  submitAnchorsForEntries,
  upgradePendingAnchors,
  verifyAnchor,
  getAnchorStatus,
  getUnanchoredEntries,
} from './anchor/opentimestamps.js';
import type { EntryType, Tier, ChainEntryInput } from './types.js';

// Default data directory
const DEFAULT_DATA_DIR = join(homedir(), '.openclaw', 'memory-chain');

const program = new Command();

program
  .name('memory-chain')
  .description('Cryptographic proof of experience for AI agents')
  .version('0.1.0')
  .option('-d, --data-dir <path>', 'Data directory', DEFAULT_DATA_DIR);

// ============================================================================
// Init Command
// ============================================================================

program
  .command('init')
  .description('Initialize a new memory chain')
  .option('-n, --name <name>', 'Agent name', 'Agent')
  .action(async (options) => {
    const dataDir = program.opts().dataDir;
    const agentName = options.name;

    try {
      await initChain(dataDir, agentName);
      console.log(`Memory chain initialized for "${agentName}" at ${dataDir}`);
      console.log('Genesis entry created.');
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });

// ============================================================================
// Add Command
// ============================================================================

program
  .command('add <content>')
  .description('Add a new memory to the chain')
  .option('-t, --type <type>', 'Entry type (memory, identity, decision)', 'memory')
  .option('--tier <tier>', 'Memory tier (committed, relationship, ephemeral)', 'relationship')
  .action(async (content, options) => {
    const dataDir = program.opts().dataDir;

    // Validate type
    const validTypes: EntryType[] = ['memory', 'identity', 'decision'];
    if (!validTypes.includes(options.type as EntryType)) {
      console.error(`Invalid type: ${options.type}. Must be one of: ${validTypes.join(', ')}`);
      process.exit(1);
    }

    // Validate tier
    const validTiers: Tier[] = ['committed', 'relationship', 'ephemeral'];
    if (!validTiers.includes(options.tier as Tier)) {
      console.error(`Invalid tier: ${options.tier}. Must be one of: ${validTiers.join(', ')}`);
      process.exit(1);
    }

    try {
      const input: ChainEntryInput = {
        type: options.type as EntryType,
        tier: options.tier as Tier,
        content,
      };

      const entry = await addEntry(dataDir, input);
      console.log(`Added entry #${entry.seq} (${entry.type}/${entry.tier})`);
      console.log(`Content hash: ${entry.content_hash}`);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });

// ============================================================================
// List Command
// ============================================================================

program
  .command('list')
  .description('List entries in the chain')
  .option('-l, --limit <n>', 'Limit number of entries', '20')
  .option('--show-content', 'Show content for each entry', false)
  .action(async (options) => {
    const dataDir = program.opts().dataDir;
    const limit = parseInt(options.limit, 10);
    const showContent = options.showContent;

    try {
      const entries = await readChain(dataDir);
      const contentDir = join(dataDir, 'content');

      if (entries.length === 0) {
        console.log('Chain is empty. Run "memory-chain init" to create genesis entry.');
        return;
      }

      // Show last N entries
      const toShow = entries.slice(-limit);

      console.log(`Showing ${toShow.length} of ${entries.length} entries:\n`);

      for (const entry of toShow) {
        const date = new Date(entry.ts).toLocaleString();
        console.log(`#${entry.seq} [${entry.type}/${entry.tier}] ${date}`);
        console.log(`  Hash: ${entry.content_hash.slice(0, 20)}...`);

        if (showContent) {
          try {
            const content = await getContentVerified(contentDir, entry.content_hash);
            if (content) {
              const preview = content.length > 100 ? content.slice(0, 100) + '...' : content;
              console.log(`  Content: ${preview}`);
            } else {
              console.log('  Content: [REDACTED]');
            }
          } catch (err) {
            if (err instanceof ContentIntegrityError) {
              console.log('  Content: [TAMPERED - hash mismatch!]');
            } else {
              throw err;
            }
          }
        }
        console.log();
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });

// ============================================================================
// Verify Command
// ============================================================================

program
  .command('verify')
  .description('Verify chain integrity')
  .action(async () => {
    const dataDir = program.opts().dataDir;

    try {
      console.log('Verifying chain integrity...\n');
      const result = await verifyChain(dataDir);

      console.log('Internal Consistency:', result.valid ? 'VALID' : 'INVALID');
      console.log(`  - Entries checked: ${result.entriesChecked}`);

      if (result.errors.length > 0) {
        console.log('\nErrors found:');
        for (const error of result.errors) {
          console.log(`  - Entry #${error.seq}: ${error.type} - ${error.message}`);
        }
      } else {
        console.log('  - Hash chain: All entries link correctly');
        console.log('  - Signatures: All verified');
        console.log('  - Sequence: No gaps');
        console.log('  - Content files: All verified');
      }

      // Show content tampering summary if any
      const contentErrors = result.errors.filter(e => e.type === 'content_mismatch');
      if (contentErrors.length > 0) {
        console.log(`\n⚠️  Content tampering detected: ${contentErrors.length} file(s) modified`);
      }

      console.log('\nSummary:');
      console.log(`  - Total entries: ${result.summary.totalEntries}`);
      console.log(`  - Redacted entries: ${result.summary.redactedEntries}`);

      if (!result.valid) {
        process.exit(1);
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });

// ============================================================================
// Stats Command
// ============================================================================

program
  .command('stats')
  .description('Show chain statistics')
  .action(async () => {
    const dataDir = program.opts().dataDir;

    try {
      const config = await loadConfig(dataDir);
      const stats = await getChainStats(dataDir);
      const contentDir = join(dataDir, 'content');
      const storageStats = await getStorageStats(contentDir);

      console.log('Memory Chain Statistics\n');
      console.log(`Agent: ${config.agentName}`);
      console.log(`Version: ${config.version}`);
      console.log(`Created: ${new Date(config.createdAt).toLocaleString()}`);
      console.log();
      console.log(`Total entries: ${stats.totalEntries}`);
      console.log(`First entry: ${stats.firstEntry ? new Date(stats.firstEntry).toLocaleString() : 'N/A'}`);
      console.log(`Last entry: ${stats.lastEntry ? new Date(stats.lastEntry).toLocaleString() : 'N/A'}`);
      console.log();
      console.log('By type:');
      for (const [type, count] of Object.entries(stats.byType)) {
        console.log(`  ${type}: ${count}`);
      }
      console.log();
      console.log('By tier:');
      for (const [tier, count] of Object.entries(stats.byTier)) {
        console.log(`  ${tier}: ${count}`);
      }
      console.log();
      console.log('Storage:');
      console.log(`  Content files: ${storageStats.totalFiles}`);
      console.log(`  Total size: ${(storageStats.totalBytes / 1024).toFixed(2)} KB`);

      // Show anchor stats
      const anchorStatus = await getAnchorStatus(dataDir);
      console.log();
      console.log('Anchors (OpenTimestamps):');
      console.log(`  Total anchored: ${anchorStatus.total}`);
      console.log(`  Confirmed: ${anchorStatus.confirmed}`);
      console.log(`  Pending: ${anchorStatus.pending}`);
      console.log(`  Failed: ${anchorStatus.failed}`);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });

// ============================================================================
// Search Command
// ============================================================================

program
  .command('search <query>')
  .description('Search memories using hybrid retrieval')
  .option('--max-tokens <n>', 'Maximum tokens to return', '2000')
  .option('--max-results <n>', 'Maximum results', '20')
  .option('--rebuild', 'Rebuild index before searching', false)
  .action(async (query, options) => {
    const dataDir = program.opts().dataDir;
    const maxTokens = parseInt(options.maxTokens, 10);
    const maxResults = parseInt(options.maxResults, 10);
    const shouldRebuild = options.rebuild;

    const dbPath = join(dataDir, 'memory.db');
    const contentDir = join(dataDir, 'content');

    try {
      const db = initIndex(dbPath);

      // Rebuild if requested or if index is empty
      if (shouldRebuild || getMemoryCount(db) === 0) {
        console.log('Rebuilding index from chain...');
        const entries = await readChain(dataDir);
        const contentLoader = createContentLoader(contentDir);
        const { indexed, skipped } = await rebuildFromChain(db, entries, contentLoader);
        console.log(`Indexed ${indexed} entries (${skipped} skipped)\n`);
      }

      const results = retrieveMemories(db, query, { maxTokens, maxResults });

      if (results.length === 0) {
        console.log('No matching memories found.');
        closeIndex(db);
        return;
      }

      console.log(`Found ${results.length} relevant memories:\n`);

      let totalTokens = 0;
      for (const memory of results) {
        const text = memory.summary ?? memory.content;
        const tokens = estimateTokens(text);
        totalTokens += tokens;

        console.log(`#${memory.seq} [${memory.type}] Score: ${memory.score.toFixed(3)}`);
        console.log(`  ${text.length > 200 ? text.slice(0, 200) + '...' : text}`);
        console.log(`  (~${tokens} tokens, importance: ${memory.importance.toFixed(2)})`);
        console.log();
      }

      console.log(`Total: ~${totalTokens} tokens`);
      console.log('\nFormatted for prompt:');
      console.log('---');
      console.log(formatMemoriesForPrompt(results));
      console.log('---');

      closeIndex(db);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });

// ============================================================================
// Redact Command
// ============================================================================

program
  .command('redact <seq>')
  .description('Redact a memory (removes content, preserves chain entry)')
  .option('--force', 'Skip confirmation', false)
  .action(async (seqStr, options) => {
    const dataDir = program.opts().dataDir;
    const seq = parseInt(seqStr, 10);
    const force = options.force;

    if (isNaN(seq)) {
      console.error('Invalid sequence number');
      process.exit(1);
    }

    try {
      const entries = await readChain(dataDir);
      const entry = entries.find((e) => e.seq === seq);

      if (!entry) {
        console.error(`Entry #${seq} not found`);
        process.exit(1);
      }

      if (entry.tier === 'committed') {
        console.error(`Entry #${seq} is committed and cannot be redacted`);
        process.exit(1);
      }

      if (entry.type === 'redaction') {
        console.error(`Entry #${seq} is already a redaction entry`);
        process.exit(1);
      }

      // Show what will be redacted
      const contentDir = join(dataDir, 'content');
      const content = await getContent(contentDir, entry.content_hash);

      if (!content) {
        console.log(`Entry #${seq} is already redacted (content not found)`);
        return;
      }

      console.log(`Will redact entry #${seq}:`);
      console.log(`  Type: ${entry.type}`);
      console.log(`  Tier: ${entry.tier}`);
      console.log(`  Content preview: ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}`);

      if (!force) {
        const readline = await import('node:readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question('\nProceed with redaction? (y/N): ', resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('Aborted');
          return;
        }
      }

      // Delete content
      await deleteContent(contentDir, entry.content_hash);

      // Add redaction entry to chain
      const redactionInput: ChainEntryInput = {
        type: 'redaction',
        tier: 'committed',
        content: JSON.stringify({
          event: 'redaction',
          target_seq: seq,
          target_hash: entry.content_hash,
          reason: 'User requested redaction',
        }),
        metadata: { target_seq: seq },
      };

      const redactionEntry = await addEntry(dataDir, redactionInput);

      console.log(`\nRedacted entry #${seq}`);
      console.log(`Redaction logged as entry #${redactionEntry.seq}`);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });

// ============================================================================
// Rebuild Index Command
// ============================================================================

program
  .command('rebuild-index')
  .description('Rebuild the search index from chain')
  .action(async () => {
    const dataDir = program.opts().dataDir;
    const dbPath = join(dataDir, 'memory.db');
    const contentDir = join(dataDir, 'content');

    try {
      console.log('Rebuilding index from chain...');

      const entries = await readChain(dataDir);
      const db = initIndex(dbPath);
      const contentLoader = createContentLoader(contentDir);

      const { indexed, skipped } = await rebuildFromChain(db, entries, contentLoader);

      console.log(`\nIndex rebuilt:`);
      console.log(`  Indexed: ${indexed} entries`);
      console.log(`  Skipped: ${skipped} entries (redacted or missing content)`);

      closeIndex(db);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });

// ============================================================================
// Anchor Command - Submit entry for OpenTimestamps anchoring
// ============================================================================

program
  .command('anchor [seq]')
  .description('Submit entry for Bitcoin timestamping via OpenTimestamps')
  .option('--batch', 'Anchor all unanchored entries', false)
  .action(async (seqStr, options) => {
    const dataDir = program.opts().dataDir;
    const batch = options.batch;

    try {
      const entries = await readChain(dataDir);

      if (entries.length === 0) {
        console.error('Chain is empty. Run "memory-chain init" first.');
        process.exit(1);
      }

      if (batch) {
        // Batch mode: anchor all unanchored entries
        console.log('Finding unanchored entries...');
        const unanchored = await getUnanchoredEntries(dataDir, entries);

        if (unanchored.length === 0) {
          console.log('All entries are already anchored.');
          return;
        }

        console.log(`Found ${unanchored.length} unanchored entries. Submitting...\n`);

        const results = await submitAnchorsForEntries(dataDir, unanchored);

        let success = 0;
        let failed = 0;
        for (const result of results) {
          if (result.success) {
            console.log(`  Entry #${result.seq}: Submitted`);
            success++;
          } else {
            console.log(`  Entry #${result.seq}: Failed - ${result.error}`);
            failed++;
          }
        }

        console.log(`\nSubmitted: ${success}, Failed: ${failed}`);
        console.log('\nNote: Anchors take ~1 hour to be confirmed on Bitcoin blockchain.');
        console.log('Use "memory-chain anchor-status" to check progress.');
      } else {
        // Single entry mode
        if (!seqStr) {
          console.error('Please provide a sequence number or use --batch');
          process.exit(1);
        }

        const seq = parseInt(seqStr, 10);
        if (isNaN(seq)) {
          console.error('Invalid sequence number');
          process.exit(1);
        }

        const entry = entries.find((e) => e.seq === seq);
        if (!entry) {
          console.error(`Entry #${seq} not found`);
          process.exit(1);
        }

        console.log(`Submitting entry #${seq} for timestamping...`);
        const result = await submitAnchor(dataDir, entry);

        if (result.success) {
          console.log(`\nEntry #${seq} submitted for timestamping.`);
          console.log(`Proof file: ${result.otsPath}`);
          console.log('\nNote: Anchor will be confirmed after ~1 hour on Bitcoin blockchain.');
          console.log('Use "memory-chain anchor-status" to check progress.');
        } else {
          console.error(`Failed to submit: ${result.error}`);
          process.exit(1);
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });

// ============================================================================
// Anchor Status Command - Check status of pending anchors
// ============================================================================

program
  .command('anchor-status')
  .description('Check status of pending OpenTimestamps anchors')
  .option('--upgrade', 'Try to upgrade pending anchors', false)
  .action(async (options) => {
    const dataDir = program.opts().dataDir;
    const shouldUpgrade = options.upgrade;

    try {
      if (shouldUpgrade) {
        console.log('Checking and upgrading pending anchors...\n');
        const result = await upgradePendingAnchors(dataDir);

        if (result.total === 0) {
          console.log('No anchors found.');
          return;
        }

        console.log(`Anchor Status:`);
        console.log(`  Total: ${result.total}`);
        console.log(`  Pending: ${result.pending}`);
        console.log(`  Confirmed: ${result.confirmed}`);
        console.log(`  Failed: ${result.failed}`);

        if (result.newlyConfirmed > 0) {
          console.log(`\n  Newly confirmed this check: ${result.newlyConfirmed}`);
        }

        if (result.anchors.length > 0) {
          console.log('\nDetails:');
          for (const anchor of result.anchors) {
            let status = anchor.status.toUpperCase();
            if (anchor.status === 'confirmed' && anchor.blockTimestamp) {
              status += ` (${new Date(anchor.blockTimestamp).toLocaleString()})`;
            } else if (anchor.status === 'failed' && anchor.error) {
              status += ` - ${anchor.error}`;
            }
            console.log(`  Entry #${anchor.seq}: ${status}`);
          }
        }
      } else {
        console.log('Checking anchor status...\n');
        const result = await getAnchorStatus(dataDir);

        if (result.total === 0) {
          console.log('No anchors found.');
          console.log('Use "memory-chain anchor <seq>" or "memory-chain anchor --batch" to submit entries.');
          return;
        }

        console.log(`Anchor Status:`);
        console.log(`  Total: ${result.total}`);
        console.log(`  Pending: ${result.pending}`);
        console.log(`  Confirmed: ${result.confirmed}`);
        console.log(`  Failed: ${result.failed}`);

        if (result.pending > 0) {
          console.log('\nTip: Use "memory-chain anchor-status --upgrade" to check and upgrade pending anchors.');
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });

// ============================================================================
// Verify Anchors Command - Verify chain with anchor proofs
// ============================================================================

program
  .command('verify-anchors')
  .description('Verify chain integrity including OpenTimestamps proofs')
  .action(async () => {
    const dataDir = program.opts().dataDir;

    try {
      // First verify internal chain integrity
      console.log('Verifying chain integrity...\n');
      const chainResult = await verifyChain(dataDir);

      console.log('Internal Consistency:', chainResult.valid ? 'VALID' : 'INVALID');
      console.log(`  - Entries checked: ${chainResult.entriesChecked}`);

      if (!chainResult.valid) {
        console.log('\nChain integrity check failed. Fix chain issues before verifying anchors.');
        for (const error of chainResult.errors) {
          console.log(`  - Entry #${error.seq}: ${error.type} - ${error.message}`);
        }
        process.exit(1);
      }

      // Now verify anchors
      console.log('\nVerifying OpenTimestamps anchors...\n');
      const entries = await readChain(dataDir);
      const anchorStatus = await getAnchorStatus(dataDir);

      if (anchorStatus.total === 0) {
        console.log('No anchors found.');
        console.log('\nChain Summary:');
        console.log(`  - Total entries: ${chainResult.summary.totalEntries}`);
        console.log(`  - Anchored entries: 0`);
        return;
      }

      let verified = 0;
      let pending = 0;
      let failed = 0;

      console.log('Anchor verification results:');
      for (const anchor of anchorStatus.anchors) {
        const result = await verifyAnchor(dataDir, anchor.seq);

        if (result.status === 'confirmed') {
          console.log(`  Entry #${anchor.seq}: VERIFIED`);
          if (result.blockTimestamp) {
            console.log(`    Timestamp: ${new Date(result.blockTimestamp).toLocaleString()}`);
          }
          verified++;
        } else if (result.status === 'pending') {
          console.log(`  Entry #${anchor.seq}: PENDING`);
          pending++;
        } else {
          console.log(`  Entry #${anchor.seq}: FAILED - ${result.error}`);
          failed++;
        }
      }

      console.log('\nSummary:');
      console.log(`  - Total entries: ${chainResult.summary.totalEntries}`);
      console.log(`  - Anchored entries: ${anchorStatus.total}`);
      console.log(`  - Verified anchors: ${verified}`);
      console.log(`  - Pending anchors: ${pending}`);
      console.log(`  - Failed anchors: ${failed}`);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error('Unknown error occurred');
      }
      process.exit(1);
    }
  });

// Parse arguments
program.parse();
