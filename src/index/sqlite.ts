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
  created_at TEXT NOT NULL,
  decay_tier TEXT DEFAULT 'hot' CHECK(decay_tier IN ('hot', 'warm', 'cold', 'archived')),
  source TEXT DEFAULT 'manual' CHECK(source IN ('auto', 'manual', 'curation'))
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

-- Index for decay tier queries (GC and retrieval)
CREATE INDEX IF NOT EXISTS idx_memories_decay ON memories(decay_tier, last_accessed);

-- Index for source filtering
CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);

-- Metadata table for index state
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

// ============================================================================
// Database Initialization
// ============================================================================

/**
 * @deprecated Use getOpenDatabaseCount() is no longer needed - SQLite WAL handles cleanup
 */
export function getOpenDatabaseCount(): number {
  return 0;
}

/**
 * @deprecated closeAllDatabases() is no longer needed - SQLite WAL handles cleanup
 */
export function closeAllDatabases(): void {
  // No-op - kept for backward compatibility
}

/**
 * Initialize or open the SQLite index database
 *
 * SQLite WAL mode handles crashes gracefully, so explicit shutdown
 * handlers are not required.
 *
 * @param dbPath - Path to the SQLite database file
 * @param options - Options for database initialization (deprecated, kept for compatibility)
 * @returns Database instance
 */
export function initIndex(
  dbPath: string,
  _options: { registerForShutdown?: boolean } = {}
): Database.Database {
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent access and crash recovery
  db.pragma('journal_mode = WAL');

  // Execute schema
  db.exec(SCHEMA);

  // Run migrations for existing databases
  migrateSchema(db);

  return db;
}

/**
 * Migrate schema for existing databases
 *
 * Adds new columns if they don't exist. SQLite doesn't support
 * ALTER TABLE ADD COLUMN IF NOT EXISTS, so we check pragma table_info.
 */
function migrateSchema(db: Database.Database): void {
  // Get existing columns
  const columns = db.pragma('table_info(memories)') as Array<{ name: string }>;
  const columnNames = new Set(columns.map((c) => c.name));

  // Add decay_tier column if missing
  if (!columnNames.has('decay_tier')) {
    db.exec(`
      ALTER TABLE memories ADD COLUMN decay_tier TEXT DEFAULT 'hot'
        CHECK(decay_tier IN ('hot', 'warm', 'cold', 'archived'))
    `);
    // Create index for new column
    db.exec('CREATE INDEX IF NOT EXISTS idx_memories_decay ON memories(decay_tier, last_accessed)');
  }

  // Add source column if missing
  if (!columnNames.has('source')) {
    db.exec(`
      ALTER TABLE memories ADD COLUMN source TEXT DEFAULT 'manual'
        CHECK(source IN ('auto', 'manual', 'curation'))
    `);
    // Create index for new column
    db.exec('CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source)');
  }
}

/**
 * Close the database connection
 */
export function closeIndex(db: Database.Database): void {
  if (db.open) {
    db.close();
  }
}

// ============================================================================
// Memory Operations
// ============================================================================

/** Input for inserting a memory (without computed fields) */
export interface InsertMemoryInput {
  seq: number;
  content: string;
  summary?: string | null;
  type: EntryType;
  tier: Tier;
  importance?: number;
  created_at: string;
  decay_tier?: 'hot' | 'warm' | 'cold' | 'archived';
  source?: 'auto' | 'manual' | 'curation';
}

/**
 * Insert a memory into the index
 *
 * @param db - Database instance
 * @param memory - Memory to insert
 */
export function insertMemory(db: Database.Database, memory: InsertMemoryInput): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO memories (seq, content, summary, type, tier, importance, access_count, last_accessed, created_at, decay_tier, source)
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)
  `);

  stmt.run(
    memory.seq,
    memory.content,
    memory.summary ?? null,
    memory.type,
    memory.tier,
    memory.importance ?? 0.5,
    memory.created_at,
    memory.decay_tier ?? 'hot',
    memory.source ?? 'manual'
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
 * Uses a transaction for atomicity - if the process crashes mid-rebuild,
 * the index will be unchanged (not left in a partial state).
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
  // Track redacted entries
  const redactedSeqs = new Set<number>();

  // First pass: identify redacted entries
  for (const entry of entries) {
    if (entry.type === 'redaction' && entry.metadata?.target_seq !== undefined) {
      redactedSeqs.add(entry.metadata.target_seq as number);
    }
  }

  // Preload all content (async) before starting synchronous transaction
  const contentMap = new Map<string, string | null>();
  for (const entry of entries) {
    if (entry.type !== 'redaction' && !redactedSeqs.has(entry.seq)) {
      if (!contentMap.has(entry.content_hash)) {
        contentMap.set(entry.content_hash, await contentLoader(entry.content_hash));
      }
    }
  }

  // Synchronous transaction for atomicity
  let indexed = 0;
  let skipped = 0;

  const insertStmt = db.prepare(`
    INSERT INTO memories (seq, content, summary, type, tier, importance, access_count, last_accessed, created_at, decay_tier, source)
    VALUES (?, ?, NULL, ?, ?, 0.5, 0, NULL, ?, 'hot', 'manual')
  `);
  const metaStmt = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');

  const rebuildTransaction = db.transaction(() => {
    // Clear existing data
    db.exec('DELETE FROM memories');

    // Insert non-redacted entries
    for (const entry of entries) {
      if (entry.type === 'redaction' || redactedSeqs.has(entry.seq)) {
        skipped++;
        continue;
      }

      const content = contentMap.get(entry.content_hash);
      if (!content) {
        skipped++;
        continue;
      }

      insertStmt.run(entry.seq, content, entry.type, entry.tier, entry.ts);
      indexed++;
    }

    // Update rebuild timestamp
    metaStmt.run('last_rebuild', new Date().toISOString());
    metaStmt.run('entries_indexed', indexed.toString());
  });

  rebuildTransaction();

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

// ============================================================================
// Decay Tier Operations
// ============================================================================

/**
 * Update decay tier for a memory
 */
export function updateDecayTier(
  db: Database.Database,
  seq: number,
  decayTier: 'hot' | 'warm' | 'cold' | 'archived'
): void {
  const stmt = db.prepare('UPDATE memories SET decay_tier = ? WHERE seq = ?');
  stmt.run(decayTier, seq);
}

/**
 * Get memories by decay tier
 */
export function getMemoriesByDecayTier(
  db: Database.Database,
  decayTier: 'hot' | 'warm' | 'cold' | 'archived',
  limit = 100
): Memory[] {
  const stmt = db.prepare('SELECT * FROM memories WHERE decay_tier = ? ORDER BY created_at DESC LIMIT ?');
  return stmt.all(decayTier, limit) as Memory[];
}

/**
 * Get memories eligible for garbage collection
 *
 * Returns memories that:
 * - Are not in protected tiers (committed)
 * - Are not already archived
 * - Meet age or relevance criteria
 */
export function getGCCandidates(
  db: Database.Database,
  maxAgeDays: number,
  limit = 1000
): Memory[] {
  const stmt = db.prepare(`
    SELECT * FROM memories
    WHERE decay_tier != 'archived'
      AND tier != 'committed'
      AND (
        created_at < datetime('now', '-' || ? || ' days')
        OR decay_tier = 'cold'
      )
    ORDER BY last_accessed ASC NULLS FIRST, created_at ASC
    LIMIT ?
  `);
  return stmt.all(maxAgeDays, limit) as Memory[];
}

/**
 * Archive a memory (mark as archived in index)
 *
 * This removes the memory from active queries but preserves
 * the chain entry. The memory can be restored by rebuilding
 * the index from the chain.
 */
export function archiveMemory(db: Database.Database, seq: number): void {
  const stmt = db.prepare('UPDATE memories SET decay_tier = ? WHERE seq = ?');
  stmt.run('archived', seq);
}

/**
 * Bulk update decay tiers based on access patterns
 *
 * @returns Count of memories updated per tier
 */
export function updateAllDecayTiers(
  db: Database.Database,
  hotDays = 7,
  warmDays = 30,
  frequencyResistThreshold = 10
): { hot: number; warm: number; cold: number; resisted: number } {
  const result = { hot: 0, warm: 0, cold: 0, resisted: 0 };

  // Memories accessed within hotDays -> hot
  const hotStmt = db.prepare(`
    UPDATE memories
    SET decay_tier = 'hot'
    WHERE last_accessed > datetime('now', '-' || ? || ' days')
      AND decay_tier != 'archived'
  `);
  result.hot = hotStmt.run(hotDays).changes;

  // Memories accessed between hotDays and warmDays -> warm
  const warmStmt = db.prepare(`
    UPDATE memories
    SET decay_tier = 'warm'
    WHERE (last_accessed <= datetime('now', '-' || ? || ' days')
      AND last_accessed > datetime('now', '-' || ? || ' days'))
      AND decay_tier != 'archived'
  `);
  result.warm = warmStmt.run(hotDays, warmDays).changes;

  // Memories not accessed in warmDays -> cold
  const coldStmt = db.prepare(`
    UPDATE memories
    SET decay_tier = 'cold'
    WHERE (last_accessed <= datetime('now', '-' || ? || ' days') OR last_accessed IS NULL)
      AND decay_tier != 'archived'
  `);
  result.cold = coldStmt.run(warmDays).changes;

  // High-frequency memories resist decay (warm instead of cold)
  const resistStmt = db.prepare(`
    UPDATE memories
    SET decay_tier = 'warm'
    WHERE decay_tier = 'cold'
      AND access_count >= ?
  `);
  result.resisted = resistStmt.run(frequencyResistThreshold).changes;

  return result;
}

// ============================================================================
// Source Operations
// ============================================================================

/**
 * Get memories by source
 */
export function getMemoriesBySource(
  db: Database.Database,
  source: 'auto' | 'manual' | 'curation',
  limit = 100
): Memory[] {
  const stmt = db.prepare('SELECT * FROM memories WHERE source = ? ORDER BY created_at DESC LIMIT ?');
  return stmt.all(source, limit) as Memory[];
}
