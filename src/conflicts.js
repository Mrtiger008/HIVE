'use strict';
const { getDb } = require('./db');

function _parse(m) {
  if (!m) return null;
  try { m.tags = JSON.parse(m.tags || '[]'); } catch { m.tags = []; }
  return m;
}

// Returns conflict candidates grouped by reason
function detect() {
  const db = getDb();

  // 1. Memories explicitly marked CONFLICTED
  const conflicted = db.prepare(
    "SELECT * FROM memories WHERE status = 'active' AND trust_level = 'CONFLICTED' ORDER BY updated_at DESC"
  ).all().map(_parse);

  // 2. Memory pairs linked with rel_type = 'contradicts'
  const contradictLinks = db.prepare(`
    SELECT r.id AS link_id, r.from_id, r.to_id, r.notes,
           mf.title AS from_title, mf.trust_level AS from_trust, mf.confidence AS from_conf,
           mt.title AS to_title, mt.trust_level AS to_trust, mt.confidence AS to_conf
    FROM relationships r
    JOIN memories mf ON mf.id = r.from_id AND mf.status = 'active'
    JOIN memories mt ON mt.id = r.to_id   AND mt.status = 'active'
    WHERE r.rel_type = 'contradicts'
  `).all();

  // 3. Memories that have been superseded but their superseder also exists (chain check)
  const superseded = db.prepare(`
    SELECT m.*, s.title AS superseded_by_title
    FROM memories m
    JOIN memories s ON s.id = m.superseded_by AND s.status = 'active'
    WHERE m.status = 'active'
  `).all().map(m => { _parse(m); return m; });

  return { conflicted, contradictLinks, superseded };
}

// Mark two memories as contradicting each other; adds a 'contradicts' link both ways if not present
function markConflict(id1, id2, notes = null) {
  const db = getDb();
  const existing = db.prepare(
    "SELECT id FROM relationships WHERE from_id = ? AND to_id = ? AND rel_type = 'contradicts'"
  ).get(id1, id2);
  if (existing) return existing;

  const { randomUUID } = require('crypto');
  const now = Date.now();
  const linkId = randomUUID();
  db.prepare(`
    INSERT INTO relationships (id, from_id, rel_type, to_id, confidence, notes, created_at)
    VALUES (?, ?, 'contradicts', ?, 0.8, ?, ?)
  `).run(linkId, id1, id2, notes, now);

  // Also set both memories to CONFLICTED trust level
  db.prepare("UPDATE memories SET trust_level = 'CONFLICTED', updated_at = ? WHERE id IN (?, ?)").run(now, id1, id2);

  return { id: linkId, from_id: id1, to_id: id2, rel_type: 'contradicts', notes };
}

// Resolve a conflict for a single memory
// action: 'archive' | 'trust' | 'downgrade'
function resolve(id, action) {
  const db = getDb();
  const m = _parse(db.prepare('SELECT * FROM memories WHERE id = ?').get(id));
  if (!m) throw new Error(`Memory not found: ${id}`);

  const now = Date.now();
  if (action === 'archive') {
    db.prepare("UPDATE memories SET status = 'archived', updated_at = ? WHERE id = ?").run(now, id);
  } else if (action === 'trust') {
    db.prepare("UPDATE memories SET trust_level = 'USER_CONFIRMED', updated_at = ? WHERE id = ?").run(now, id);
  } else if (action === 'downgrade') {
    db.prepare("UPDATE memories SET trust_level = 'OUTDATED', updated_at = ? WHERE id = ?").run(now, id);
  } else {
    throw new Error(`Unknown action: ${action}. Use archive, trust, or downgrade.`);
  }
  return { id, action, ok: true };
}

module.exports = { detect, markConflict, resolve };
