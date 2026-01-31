/**
 * SQLite Index with FTS5
 *
 * The index layer provides fast retrieval with full-text search.
 * It's mutable and can be rebuilt from the chain at any time.
 */

import Database from 'better-sqlite3';
import type { ChainEntry, Memory, EntryType, Tier } from '../types.js';

// ============================================================================
// Schema
// ============================================================================

const SCHEMA = `
-- Core memory index
CREATE TABLE IF NOT EXISTS memories (
  seq INTEGER PRIMARY KEY,
  content TEXT NOT NULL,
  summary TEXT,
  type TEXT NOT NULL CHECK(type IN ('memory', 'identity', 'decision', 'redaction')),
  tier TEXT NOT NULL CHECK(tier IN ('committed', 'relationship', 'ephemeral')),
  importance REAL DEFAULT 0.5,
  access_count INTEGER DEFAULT 0,
  last_accessed TEXT,
  created_at TEXT NOT NULL
);

-- FTS5 full-text search on content and summary
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  summary,
  content='memories',
  content_rowid='seq',
  tokenize='porter unicode61'
);

-- Triggers to keep FTS in sync with memories table
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, summary)
  VALUES (new.seq, new.content, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, summary)
  VALUES ('delete', old.seq, old.content, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, summary)
  VALUES ('delete', old.seq, old.content, old.summary);
  INSERT INTO memories_fts(rowid, content, summary)
  VALUES (new.seq, new.content, new.summary);
END;

-- Index for recency queries
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);

-- Index for importance-based retrieval
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

-- Index for type filtering
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);

-- Metadata table for index state
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

// ============================================================================
// Database Registry for Graceful Shutdown
// ============================================================================

/** Registry of open database connections for graceful shutdown */
const openDatabases = new Set<Database.Database>();

/** Whether shutdown handlers have been registered */
let shutdownHandlersRegistered = false;

/**
 * Register shutdown handlers to close all open databases
 */
function registerShutdownHandlers(): void {
  if (shutdownHandlersRegistered) return;

  const cleanup = () => {
    for (const db of openDatabases) {
      try {
        if (db.open) {
          db.close();
        }
      } catch {
        // Ignore errors during shutdown
      }
    }
    openDatabases.clear();
  };

  // Handle various termination signals
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    cleanup();
    process.exit(1);
  });

  shutdownHandlersRegistered = true;
}

/**
 * Get the count of open databases (for testing/monitoring)
 */
export function getOpenDatabaseCount(): number {
  return openDatabases.size;
}

/**
 * Manually close all open databases
 * Useful for testing or manual cleanup
 */
export function closeAllDatabases(): void {
  for (const db of openDatabases) {
    try {
      if (db.open) {
        db.close();
      }
    } catch {
      // Ignore errors
    }
  }
  openDatabases.clear();
}

// ============================================================================
// Database Initialization
// ============================================================================

/**
 * Initialize or open the SQLite index database
 *
 * The database will be automatically registered for graceful shutdown.
 *
 * @param dbPath - Path to the SQLite database file
 * @param options - Options for database initialization
 * @returns Database instance
 */
export function initIndex(
  dbPath: string,
  options: { registerForShutdown?: boolean } = {}
): Database.Database {
  const { registerForShutdown = true } = options;

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  // Execute schema
  db.exec(SCHEMA);

  // Register for graceful shutdown
  if (registerForShutdown) {
    openDatabases.add(db);
    registerShutdownHandlers();
  }

  return db;
}

/**
 * Close the database connection
 *
 * This also removes the database from the shutdown registry.
 */
export function closeIndex(db: Database.Database): void {
  openDatabases.delete(db);
  if (db.open) {
    db.close();
  }
}

// ============================================================================
// Memory Operations
// ============================================================================

/**
 * Insert a memory into the index
 *
 * @param db - Database instance
 * @param memory - Memory to insert
 */
export function insertMemory(db: Database.Database, memory: Omit<Memory, 'access_count' | 'last_accessed'>): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO memories (seq, content, summary, type, tier, importance, access_count, last_accessed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
  `);

  stmt.run(
    memory.seq,
    memory.content,
    memory.summary,
    memory.type,
    memory.tier,
    memory.importance,
    memory.created_at
  );
}

/**
 * Get a memory by sequence number
 */
export function getMemory(db: Database.Database, seq: number): Memory | null {
  const stmt = db.prepare('SELECT * FROM memories WHERE seq = ?');
  const row = stmt.get(seq) as Memory | undefined;
  return row ?? null;
}

/**
 * Update access count for a memory (for ranking)
 */
export function updateAccessCount(db: Database.Database, seq: number): void {
  const stmt = db.prepare(`
    UPDATE memories
    SET access_count = access_count + 1, last_accessed = ?
    WHERE seq = ?
  `);
  stmt.run(new Date().toISOString(), seq);
}

/**
 * Update importance score for a memory
 */
export function updateImportance(db: Database.Database, seq: number, importance: number): void {
  const stmt = db.prepare('UPDATE memories SET importance = ? WHERE seq = ?');
  stmt.run(Math.max(0, Math.min(1, importance)), seq);
}

/**
 * Update summary for a memory
 */
export function updateSummary(db: Database.Database, seq: number, summary: string): void {
  const stmt = db.prepare('UPDATE memories SET summary = ? WHERE seq = ?');
  stmt.run(summary, seq);
}

/**
 * Delete a memory from the index (for redaction)
 */
export function deleteMemory(db: Database.Database, seq: number): void {
  const stmt = db.prepare('DELETE FROM memories WHERE seq = ?');
  stmt.run(seq);
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Rebuild the entire index from chain entries
 *
 * @param db - Database instance
 * @param entries - Chain entries to index
 * @param contentLoader - Function to load content by hash
 */
export async function rebuildFromChain(
  db: Database.Database,
  entries: ChainEntry[],
  contentLoader: (hash: string) => Promise<string | null>
): Promise<{ indexed: number; skipped: number }> {
  // Clear existing data
  db.exec('DELETE FROM memories');

  // Track redacted entries
  const redactedSeqs = new Set<number>();

  // First pass: identify redacted entries
  for (const entry of entries) {
    if (entry.type === 'redaction' && entry.metadata?.target_seq !== undefined) {
      redactedSeqs.add(entry.metadata.target_seq as number);
    }
  }

  // Second pass: insert non-redacted entries
  const insertStmt = db.prepare(`
    INSERT INTO memories (seq, content, summary, type, tier, importance, access_count, last_accessed, created_at)
    VALUES (?, ?, NULL, ?, ?, 0.5, 0, NULL, ?)
  `);

  let indexed = 0;
  let skipped = 0;

  // Note: better-sqlite3 transactions are synchronous, so we handle async content loading
  // by iterating and loading content before inserting each entry
  for (const entry of entries) {
    if (entry.type === 'redaction' || redactedSeqs.has(entry.seq)) {
      skipped++;
      continue;
    }

    const content = await contentLoader(entry.content_hash);
    if (!content) {
      skipped++;
      continue;
    }

    insertStmt.run(entry.seq, content, entry.type, entry.tier, entry.ts);
    indexed++;
  }

  // Update rebuild timestamp
  const metaStmt = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  metaStmt.run('last_rebuild', new Date().toISOString());
  metaStmt.run('entries_indexed', indexed.toString());

  return { indexed, skipped };
}

/**
 * Get the last rebuild timestamp
 */
export function getLastRebuild(db: Database.Database): string | null {
  const stmt = db.prepare('SELECT value FROM meta WHERE key = ?');
  const row = stmt.get('last_rebuild') as { value: string } | undefined;
  return row?.value ?? null;
}

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * Get total memory count
 */
export function getMemoryCount(db: Database.Database): number {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM memories');
  const row = stmt.get() as { count: number };
  return row.count;
}

/**
 * Get memories by type
 */
export function getMemoriesByType(db: Database.Database, type: EntryType, limit = 100): Memory[] {
  const stmt = db.prepare('SELECT * FROM memories WHERE type = ? ORDER BY created_at DESC LIMIT ?');
  return stmt.all(type, limit) as Memory[];
}

/**
 * Get memories by tier
 */
export function getMemoriesByTier(db: Database.Database, tier: Tier, limit = 100): Memory[] {
  const stmt = db.prepare('SELECT * FROM memories WHERE tier = ? ORDER BY created_at DESC LIMIT ?');
  return stmt.all(tier, limit) as Memory[];
}

/**
 * Get all memories (with optional limit)
 */
export function getAllMemories(db: Database.Database, limit = 1000): Memory[] {
  const stmt = db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?');
  return stmt.all(limit) as Memory[];
}
