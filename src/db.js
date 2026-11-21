'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.HIVE_DB || path.join(__dirname, '..', 'database', 'hive.db');
const BACKUP_DIR = path.join(__dirname, '..', 'database', 'backups');

let _db = null;

function getDb() {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _initSchema(_db);
  return _db;
}

function _initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      objective   TEXT,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'active',
      domain      TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      tags        TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS memories (
      id                   TEXT PRIMARY KEY,
      title                TEXT NOT NULL,
      content              TEXT NOT NULL,
      memory_type          TEXT NOT NULL,
      domain               TEXT,
      project_id           TEXT,
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL,
      source               TEXT,
      source_type          TEXT,
      source_ref           TEXT,
      confidence           REAL NOT NULL DEFAULT 0.5,
      trust_level          TEXT NOT NULL DEFAULT 'OBSERVED',
      status               TEXT NOT NULL DEFAULT 'active',
      importance           INTEGER NOT NULL DEFAULT 5,
      tags                 TEXT NOT NULL DEFAULT '[]',
      valid_from           INTEGER,
      valid_until          INTEGER,
      supersedes           TEXT,
      superseded_by        TEXT,
      user_confirmed       INTEGER NOT NULL DEFAULT 0,
      retrieval_keywords   TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS entities (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      description TEXT,
      aliases     TEXT NOT NULL DEFAULT '[]',
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS relationships (
      id          TEXT PRIMARY KEY,
      from_id     TEXT NOT NULL,
      rel_type    TEXT NOT NULL,
      to_id       TEXT NOT NULL,
      valid_from  INTEGER,
      valid_until INTEGER,
      confidence  REAL NOT NULL DEFAULT 0.5,
      notes       TEXT,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id          TEXT PRIMARY KEY,
      path        TEXT,
      source_type TEXT,
      hash        TEXT,
      description TEXT,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      action      TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id   TEXT NOT NULL,
      details     TEXT,
      timestamp   INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      id UNINDEXED,
      title,
      content,
      tags,
      retrieval_keywords,
      content='memories',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, id, title, content, tags, retrieval_keywords)
      VALUES (new.rowid, new.id, new.title, new.content, new.tags, COALESCE(new.retrieval_keywords, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, id, title, content, tags, retrieval_keywords)
      VALUES ('delete', old.rowid, old.id, old.title, old.content, old.tags, COALESCE(old.retrieval_keywords, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, id, title, content, tags, retrieval_keywords)
      VALUES ('delete', old.rowid, old.id, old.title, old.content, old.tags, COALESCE(old.retrieval_keywords, ''));
      INSERT INTO memories_fts(rowid, id, title, content, tags, retrieval_keywords)
      VALUES (new.rowid, new.id, new.title, new.content, new.tags, COALESCE(new.retrieval_keywords, ''));
    END;

    CREATE INDEX IF NOT EXISTS idx_memories_type    ON memories(memory_type);
    CREATE INDEX IF NOT EXISTS idx_memories_domain  ON memories(domain);
    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
    CREATE INDEX IF NOT EXISTS idx_memories_status  ON memories(status);
    CREATE INDEX IF NOT EXISTS idx_memories_trust   ON memories(trust_level);
    CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rel_from         ON relationships(from_id);
    CREATE INDEX IF NOT EXISTS idx_rel_to           ON relationships(to_id);
  `);

  const { v: schemaVersion } = db.prepare('SELECT MAX(version) as v FROM schema_version').get();
  const sv = schemaVersion || 0;

  if (sv < 1) {
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (1, ?)').run(Date.now());
  }
  // v2: last_accessed_at for decay/reinforce system
  if (sv < 2) {
    try { db.exec('ALTER TABLE memories ADD COLUMN last_accessed_at INTEGER'); } catch {}
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (2, ?)').run(Date.now());
  }
  // v3: embedding TEXT for semantic search (384-dim float array stored as JSON)
  if (sv < 3) {
    try { db.exec('ALTER TABLE memories ADD COLUMN embedding TEXT'); } catch {}
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (3, ?)').run(Date.now());
  }
  // v4: memory_entity_links — auto-extracted entity mentions per memory
  if (sv < 4) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entity_links (
        memory_id    TEXT NOT NULL,
        entity_id    TEXT NOT NULL,
        confidence   REAL NOT NULL DEFAULT 0.5,
        auto         INTEGER NOT NULL DEFAULT 1,
        created_at   INTEGER NOT NULL,
        PRIMARY KEY (memory_id, entity_id)
      );
      CREATE INDEX IF NOT EXISTS idx_mel_entity ON memory_entity_links(entity_id);
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (4, ?)').run(Date.now());
  }
  // v5: search_history — recent query log for autocomplete
  if (sv < 5) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS search_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        query       TEXT NOT NULL,
        searched_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sh_query ON search_history(query);
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (5, ?)').run(Date.now());
  }
  // v6: api_keys — hashed Bearer tokens for external tool access
  if (sv < 6) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT NOT NULL UNIQUE,
        key_hash     TEXT NOT NULL UNIQUE,
        created_at   INTEGER NOT NULL,
        last_used_at INTEGER
      );
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (6, ?)').run(Date.now());
  }
  // v7: webhooks — outbound HTTP POST on memory events
  if (sv < 7) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        url               TEXT NOT NULL UNIQUE,
        events            TEXT NOT NULL DEFAULT '["*"]',
        active            INTEGER NOT NULL DEFAULT 1,
        created_at        INTEGER NOT NULL,
        last_triggered_at INTEGER,
        last_status       TEXT
      );
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (7, ?)').run(Date.now());
  }
  // v8: memory_versions — snapshot of title/content on each update
  if (sv < 8) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_versions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id   TEXT NOT NULL,
        title       TEXT NOT NULL,
        content     TEXT NOT NULL,
        snapshot_at INTEGER NOT NULL,
        FOREIGN KEY(memory_id) REFERENCES memories(id)
      );
      CREATE INDEX IF NOT EXISTS idx_mv_memory ON memory_versions(memory_id, snapshot_at DESC);
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (8, ?)').run(Date.now());
  }
  // v9: search_bookmarks — named saved searches
  if (sv < 9) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS search_bookmarks (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        query      TEXT NOT NULL,
        mode       TEXT NOT NULL DEFAULT 'keyword',
        created_at INTEGER NOT NULL
      );
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (9, ?)').run(Date.now());
  }
  // v10: pinned column on memories
  if (sv < 10) {
    try { db.exec('ALTER TABLE memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0'); } catch {}
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (10, ?)').run(Date.now());
  }
  // v11: label column — color label for visual grouping (red/yellow/green/blue)
  if (sv < 11) {
    try { db.exec('ALTER TABLE memories ADD COLUMN label TEXT'); } catch {}
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (11, ?)').run(Date.now());
  }
  // v12: note column — short sticky comment shown below content preview
  if (sv < 12) {
    try { db.exec('ALTER TABLE memories ADD COLUMN note TEXT'); } catch {}
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (12, ?)').run(Date.now());
  }
  if (sv < 13) {
    try { db.exec('ALTER TABLE memories ADD COLUMN expires_at INTEGER'); } catch {}
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (13, ?)').run(Date.now());
  }
}

function closeDb() {
  if (_db) { _db.close(); _db = null; }
}

module.exports = { getDb, closeDb, DB_PATH, BACKUP_DIR };
